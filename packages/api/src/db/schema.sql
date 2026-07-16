-- OpsGate Control Plane — V1 full Postgres schema
-- Idempotent: safe to re-run via migrate()

-- ── Organizations ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  org_code TEXT NOT NULL UNIQUE,
  mode_default TEXT NOT NULL,
  event_payload_policy TEXT NOT NULL,
  primary_email TEXT NOT NULL DEFAULT 'admin@demo.local',
  is_personal BOOLEAN NOT NULL DEFAULT FALSE,
  license_seats INT NOT NULL DEFAULT 0,
  /** Seuils offline + schedule horaires (JSON OrgMonitoringSettings) */
  monitoring_json TEXT NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Policies (org default) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS policies (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  version INT NOT NULL DEFAULT 1,
  default_action TEXT NOT NULL,
  enabled_hosts JSONB NOT NULL DEFAULT '[]',
  scan_uploads BOOLEAN NOT NULL DEFAULT TRUE,
  event_reporting BOOLEAN NOT NULL DEFAULT TRUE,
  rules_pack_version TEXT NOT NULL,
  management_password_hash TEXT NOT NULL DEFAULT '',
  protect_unenroll BOOLEAN NOT NULL DEFAULT FALSE,
  config_epoch INT NOT NULL DEFAULT 1,
  /** Messages end-user banner (JSON partial PolicyUserMessages) */
  user_messages_json TEXT NOT NULL DEFAULT '{}',
  /** Horaires optionnels (JSON WorkSchedule) */
  work_schedule_json TEXT NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id)
);

-- ── Policy profiles (department) ───────────────────────────────
CREATE TABLE IF NOT EXISTS policy_profiles (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  department TEXT,
  default_action TEXT NOT NULL,
  enabled_hosts JSONB NOT NULL DEFAULT '[]',
  scan_uploads BOOLEAN NOT NULL DEFAULT TRUE,
  event_reporting BOOLEAN NOT NULL DEFAULT TRUE,
  protect_unenroll BOOLEAN NOT NULL DEFAULT FALSE,
  assigned_group_ids JSONB NOT NULL DEFAULT '[]',
  assigned_user_ids JSONB NOT NULL DEFAULT '[]',
  user_messages_json TEXT NOT NULL DEFAULT '{}',
  work_schedule_json TEXT NOT NULL DEFAULT '{}',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  priority INT NOT NULL DEFAULT 100,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS policy_profiles_org_idx ON policy_profiles(org_id);

-- ── Admins ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS org_admins (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  is_principal BOOLEAN NOT NULL DEFAULT FALSE,
  permissions JSONB NOT NULL DEFAULT '[]',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, email)
);

CREATE INDEX IF NOT EXISTS org_admins_email_idx ON org_admins(email);

-- ── Admin sessions ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  admin_id TEXT NOT NULL REFERENCES org_admins(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  /** Heartbeat — idle serveur (ex. 10 min sans requête console) */
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS admin_sessions_admin_idx ON admin_sessions(admin_id);

-- ── Users & groups ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS org_users (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  email TEXT,
  external_id TEXT,
  group_ids JSONB NOT NULL DEFAULT '[]',
  license_manual BOOLEAN,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS org_users_org_idx ON org_users(org_id);

CREATE TABLE IF NOT EXISTS user_groups (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  policy_profile_id TEXT,
  grants_license BOOLEAN NOT NULL DEFAULT TRUE,
  ldap_external_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS user_groups_org_idx ON user_groups(org_id);

-- ── Agents ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  device_label TEXT,
  host_name TEXT,
  enrolled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  token_hash TEXT NOT NULL UNIQUE,
  app_version TEXT,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  mode_override TEXT,
  policy_profile_id TEXT,
  user_id TEXT,
  /** false par défaut : licence seulement si groupe (ou assignation admin manuelle) */
  license_assigned BOOLEAN NOT NULL DEFAULT FALSE,
  unlicensed_since TIMESTAMPTZ,
  personal_account BOOLEAN NOT NULL DEFAULT FALSE,
  last_config_epoch INT,
  group_id TEXT,
  /** Empreinte installation extension (anti-doublon re-enroll) */
  device_fingerprint TEXT,
  /** extension | proxy */
  device_type TEXT NOT NULL DEFAULT 'extension',
  /** leave | outage | remote — hors alertes offline prolongé */
  maintenance_mode TEXT,
  maintenance_note TEXT
);

CREATE INDEX IF NOT EXISTS agents_org_idx ON agents(org_id);
-- agents_org_fp_idx créé après soft-alter (bases existantes sans device_fingerprint)

-- ── Rule packs ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rule_packs (
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  pack_id TEXT NOT NULL,
  schema_version INT NOT NULL DEFAULT 1,
  min_engine_version TEXT,
  checksum TEXT NOT NULL,
  signature TEXT NOT NULL,
  rules JSONB NOT NULL,
  notes TEXT,
  published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_by TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (org_id, version)
);

CREATE INDEX IF NOT EXISTS rule_packs_active_idx ON rule_packs(org_id) WHERE active = TRUE;

-- ── Detection events ───────────────────────────────────────────
-- agent_id nullable + ON DELETE SET NULL : garder l'historique après
-- révocation / désinscription console (pas de CASCADE wipe).
CREATE TABLE IF NOT EXISTS detection_events (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  client_event_id TEXT NOT NULL,
  ts TIMESTAMPTZ NOT NULL,
  source TEXT NOT NULL,
  hostname TEXT NOT NULL,
  decision TEXT NOT NULL,
  detection_count INT NOT NULL,
  highest_severity TEXT NOT NULL,
  rule_ids JSONB NOT NULL DEFAULT '[]',
  types JSONB NOT NULL DEFAULT '[]',
  masked BOOLEAN,
  file_names JSONB,
  device_label TEXT,
  exit_actor TEXT,
  exit_admin_id TEXT,
  exit_admin_label TEXT,
  schema_version INT NOT NULL DEFAULT 1,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, client_event_id)
);

CREATE INDEX IF NOT EXISTS events_org_ts_idx ON detection_events(org_id, received_at DESC);
CREATE INDEX IF NOT EXISTS events_agent_idx ON detection_events(agent_id);

-- ── Recovery codes one-time (concepteur) ───────────────────────
CREATE TABLE IF NOT EXISTS recovery_codes (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  label TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  consumed_at TIMESTAMPTZ,
  consumed_agent_id TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS recovery_codes_org_active_idx
  ON recovery_codes(org_id) WHERE active = TRUE AND consumed_at IS NULL;

-- ── Archives export logs (semaine / manuel) ────────────────────
CREATE TABLE IF NOT EXISTS log_exports (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  format TEXT NOT NULL,
  filename TEXT NOT NULL,
  content TEXT NOT NULL,
  event_count INT NOT NULL DEFAULT 0,
  from_ts TIMESTAMPTZ NOT NULL,
  to_ts TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS log_exports_org_idx ON log_exports(org_id, created_at DESC);

-- ── Password reset OTP ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS password_reset_challenges (
  org_id TEXT PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Admin audit (console) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_audit_events (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  admin_id TEXT,
  admin_email TEXT,
  admin_label TEXT,
  action TEXT NOT NULL,
  detail TEXT,
  meta JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS admin_audit_org_ts_idx
  ON admin_audit_events(org_id, created_at DESC);

-- ── Moving rules (auto-assign agents → groups) ─────────────────
CREATE TABLE IF NOT EXISTS moving_rules (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  match_field TEXT NOT NULL,
  match_op TEXT NOT NULL,
  match_value TEXT NOT NULL,
  /** JSON array of {field,op,value} — AND logic; legacy match_* = first condition */
  conditions_json TEXT NOT NULL DEFAULT '[]',
  target_group_id TEXT NOT NULL,
  priority INT NOT NULL DEFAULT 100,
  only_if_unassigned BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS moving_rules_org_idx ON moving_rules(org_id);
