-- OpsGate Control Plane — PR5 Postgres schema

CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  org_code TEXT NOT NULL UNIQUE,
  mode_default TEXT NOT NULL,
  event_payload_policy TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS policies (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  version INT NOT NULL DEFAULT 1,
  default_action TEXT NOT NULL,
  enabled_hosts JSONB NOT NULL DEFAULT '[]',
  scan_uploads BOOLEAN NOT NULL DEFAULT TRUE,
  event_reporting BOOLEAN NOT NULL DEFAULT FALSE,
  rules_pack_version TEXT NOT NULL,
  management_password_hash TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id)
);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  device_label TEXT,
  enrolled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  token_hash TEXT NOT NULL UNIQUE,
  app_version TEXT,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  mode_override TEXT
);

CREATE INDEX IF NOT EXISTS agents_org_idx ON agents(org_id);

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

CREATE TABLE IF NOT EXISTS detection_events (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
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
  schema_version INT NOT NULL DEFAULT 1,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (agent_id, client_event_id)
);

CREATE INDEX IF NOT EXISTS events_org_ts_idx ON detection_events(org_id, received_at DESC);
