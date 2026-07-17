import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import type { DetectionRule } from "@opsgate/engine"
import pg from "pg"

import {
  generateRecoveryCode,
  hashManagementPassword,
  hashRecoveryCode,
  hashToken,
  isValidPersonalLicenseKey,
  newId,
  newOtpCode,
  newToken,
  PRINCIPAL_DEFAULT_PASSWORD,
  PRINCIPAL_SETUP_EMAIL
} from "./crypto"
import {
  buildGlobalRulesPack,
  materializePack,
  nextFreeVersion,
  toPayload,
  validateRules
} from "./rules-pack"
import type {
  ActivatePackResult,
  AppendEventsResult,
  EffectivePolicyBundle,
  OpsGateStore,
  OrgSummary,
  PublishPackInput,
  PublishPackResult
} from "./store-types"
import type {
  AdminPermission,
  AdminSession,
  Agent,
  DetectionEventInput,
  ExitActor,
  OrgAdmin,
  OrgUser,
  Organization,
  Policy,
  PolicyProfile,
  RulesPackPayload,
  StoredEvent,
  StoredRulePack,
  UserGroup
} from "./types"
import { ALL_ADMIN_PERMISSIONS } from "./types"
import {
  getPgRlsMode,
  getRlsContext,
  queryWithRls,
  withBypassRls
} from "./pg-rls"

const { Pool } = pg

const __dirname = dirname(fileURLToPath(import.meta.url))

/** Pool proxy : chaque query/connect injecte le contexte RLS (ALS). */
function wrapPoolWithRls(pool: pg.Pool): pg.Pool {
  return new Proxy(pool, {
    get(target, prop, receiver) {
      if (prop === "query") {
        return (
          text: string | { text?: string; values?: unknown[] },
          values?: unknown[]
        ) => {
          if (typeof text === "string") {
            return queryWithRls(target, text, values)
          }
          const q = text?.text || ""
          const v = text?.values ?? values
          return queryWithRls(target, q, v)
        }
      }
      if (prop === "connect") {
        return async () => {
          const client = await target.connect()
          if (getPgRlsMode() === "off") return client
          const ctx = getRlsContext()
          try {
            await client.query(
              `SELECT set_config('app.rls_bypass', $1, false)`,
              [ctx.bypass ? "on" : "off"]
            )
            await client.query(
              `SELECT set_config('app.current_org_id', $1, false)`,
              [ctx.orgId || ""]
            )
          } catch {
            /* ignore */
          }
          const origRelease = client.release.bind(client)
          client.release = ((err?: Error | boolean) => {
            // Remet bypass pour ne pas polluer le pool
            const done = () => origRelease(err as Error | boolean | undefined)
            client
              .query(`SELECT set_config('app.rls_bypass', 'on', false)`)
              .then(done, done)
          }) as typeof client.release
          return client
        }
      }
      return Reflect.get(target, prop, receiver)
    }
  }) as pg.Pool
}

const DEFAULT_HOSTS = [
  "chatgpt.com",
  "chat.openai.com",
  "claude.ai",
  "gemini.google.com",
  "bard.google.com",
  "copilot.microsoft.com",
  "perplexity.ai",
  "chat.deepseek.com",
  "aistudio.google.com",
  "poe.com",
  "you.com",
  "chat.mistral.ai",
  "lechat.mistral.ai",
  "console.groq.com",
  "grok.x.ai",
  "grok.com",
  "huggingface.co",
  "phind.com",
  "meta.ai",
  "pi.ai",
  "character.ai",
  "notebooklm.google.com",
  "openrouter.ai",
  "together.ai",
  "fireworks.ai",
  "blackbox.ai",
  "chat.lmsys.org",
  "lmarena.ai",
  "typingmind.com",
  "chat.qwen.ai",
  "writesonic.com",
  "jasper.ai",
  "copy.ai",
  "notion.so",
  "platform.openai.com",
  "labs.google",
  "deepai.org",
  "sider.ai",
  "monica.im",
  "chatpdf.com",
  "consensus.app",
  "elicit.com"
]

function rowOrg(r: pg.QueryResultRow): Organization {
  let monitoring: Organization["monitoring"]
  try {
    const raw = r.monitoring_json
    if (raw) {
      const j = typeof raw === "string" ? JSON.parse(raw) : raw
      if (j && typeof j === "object") monitoring = j
    }
  } catch {
    /* ignore */
  }
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    orgCode: r.org_code,
    modeDefault: r.mode_default,
    eventPayloadPolicy: r.event_payload_policy,
    primaryEmail: r.primary_email || PRINCIPAL_SETUP_EMAIL,
    isPersonal: !!r.is_personal,
    licenseSeats:
      typeof r.license_seats === "number" ? r.license_seats : Number(r.license_seats) || 0,
    monitoring,
    createdAt: new Date(r.created_at).toISOString(),
    deletedAt: r.deleted_at ? new Date(r.deleted_at).toISOString() : null,
    deletePurgeAt: r.delete_purge_at
      ? new Date(r.delete_purge_at).toISOString()
      : null,
    deleteReason: r.delete_reason || null,
    deleteRequestedBy: r.delete_requested_by || null
  }
}

function parseJsonObj<T>(raw: unknown): T | undefined {
  try {
    if (!raw) return undefined
    const j = typeof raw === "string" ? JSON.parse(raw) : raw
    if (j && typeof j === "object") return j as T
  } catch {
    /* ignore */
  }
  return undefined
}

function rowPolicy(r: pg.QueryResultRow): Policy {
  const userMessages = parseJsonObj<Policy["userMessages"]>(
    r.user_messages_json
  )
  const workSchedule = parseJsonObj<Policy["workSchedule"]>(
    r.work_schedule_json
  )
  return {
    id: r.id,
    orgId: r.org_id,
    version: r.version,
    defaultAction: r.default_action,
    enabledHosts: r.enabled_hosts || [],
    scanUploads: r.scan_uploads,
    eventReporting: r.event_reporting,
    rulesPackVersion: r.rules_pack_version,
    managementPasswordHash: r.management_password_hash || "",
    protectUnenroll: !!r.protect_unenroll,
    configEpoch:
      typeof r.config_epoch === "number" ? r.config_epoch : r.version || 1,
    userMessages,
    workSchedule: workSchedule ?? null,
    updatedAt: new Date(r.updated_at).toISOString()
  }
}

function rowAgent(r: pg.QueryResultRow): Agent {
  const maint = r.maintenance_mode
  return {
    id: r.id,
    orgId: r.org_id,
    deviceLabel: r.device_label ?? undefined,
    hostName: r.host_name ?? undefined,
    enrolledAt: new Date(r.enrolled_at).toISOString(),
    tokenHash: r.token_hash,
    appVersion: r.app_version ?? undefined,
    lastSeenAt: new Date(r.last_seen_at).toISOString(),
    modeOverride: r.mode_override ?? undefined,
    policyProfileId: r.policy_profile_id ?? undefined,
    userId: r.user_id ?? undefined,
    licenseAssigned: r.license_assigned === true,
    unlicensedSince: r.unlicensed_since
      ? new Date(r.unlicensed_since).toISOString()
      : undefined,
    personalAccount: !!r.personal_account,
    lastConfigEpoch:
      typeof r.last_config_epoch === "number" ? r.last_config_epoch : undefined,
    groupId: r.group_id ?? undefined,
    deviceFingerprint: r.device_fingerprint ?? undefined,
    deviceType:
      r.device_type === "proxy" ? "proxy" : r.device_type === "extension" ? "extension" : undefined,
    maintenanceMode:
      maint === "leave" || maint === "outage" || maint === "remote"
        ? maint
        : null,
    maintenanceNote: r.maintenance_note ?? null
  }
}

function rowPack(r: pg.QueryResultRow): StoredRulePack {
  return {
    packId: r.pack_id,
    orgId: r.org_id,
    version: r.version,
    schemaVersion: r.schema_version,
    minEngineVersion: r.min_engine_version ?? undefined,
    checksum: r.checksum,
    signature: r.signature,
    rules: r.rules,
    notes: r.notes ?? undefined,
    publishedAt: new Date(r.published_at).toISOString(),
    publishedBy: r.published_by,
    active: r.active
  }
}

function asJsonArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String)
  if (typeof v === "string") {
    try {
      const p = JSON.parse(v)
      return Array.isArray(p) ? p.map(String) : []
    } catch {
      return v ? [v] : []
    }
  }
  return []
}

function rowEvent(r: pg.QueryResultRow): StoredEvent {
  return {
    id: r.id,
    orgId: r.org_id,
    agentId: r.agent_id ?? undefined,
    client_event_id: r.client_event_id,
    ts: new Date(r.ts).toISOString(),
    source: r.source,
    hostname: r.hostname,
    decision: r.decision,
    detection_count: r.detection_count,
    highest_severity: r.highest_severity,
    rule_ids: asJsonArray(r.rule_ids),
    types: asJsonArray(r.types),
    masked: r.masked ?? undefined,
    file_names: r.file_names
      ? asJsonArray(r.file_names)
      : null,
    device_label: r.device_label ?? undefined,
    exit_actor: r.exit_actor ?? undefined,
    exit_admin_id: r.exit_admin_id ?? undefined,
    exit_admin_label: r.exit_admin_label ?? undefined,
    schema_version: r.schema_version,
    receivedAt: new Date(r.received_at).toISOString()
  }
}

function rowAdmin(r: pg.QueryResultRow): OrgAdmin {
  let passwordHistory: string[] = []
  if (Array.isArray(r.password_history)) {
    passwordHistory = r.password_history.filter(
      (x: unknown) => typeof x === "string"
    )
  } else if (typeof r.password_history === "string") {
    try {
      const p = JSON.parse(r.password_history)
      if (Array.isArray(p)) passwordHistory = p.filter((x) => typeof x === "string")
    } catch {
      /* ignore */
    }
  }
  return {
    id: r.id,
    orgId: r.org_id,
    label: r.label,
    email: r.email,
    passwordHash: r.password_hash,
    passwordHistory,
    isPrincipal: !!r.is_principal,
    permissions: (r.permissions || []) as AdminPermission[],
    active: r.active !== false,
    mustChangePassword: !!r.must_change_password,
    failedLoginCount: Number(r.failed_login_count) || 0,
    lockedAt: r.locked_at ? new Date(r.locked_at).toISOString() : null,
    totpEnabled: !!r.totp_enabled,
    totpSecret: r.totp_secret ?? null,
    totpPendingSecret: r.totp_pending_secret ?? null,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString()
  }
}

function rowUser(r: pg.QueryResultRow): OrgUser {
  return {
    id: r.id,
    orgId: r.org_id,
    displayName: r.display_name,
    email: r.email ?? undefined,
    externalId: r.external_id ?? undefined,
    groupIds: r.group_ids || [],
    licenseManual:
      r.license_manual === null || r.license_manual === undefined
        ? null
        : !!r.license_manual,
    createdAt: new Date(r.created_at).toISOString()
  }
}

function rowGroup(r: pg.QueryResultRow): UserGroup {
  return {
    id: r.id,
    orgId: r.org_id,
    name: r.name,
    description: r.description ?? undefined,
    policyProfileId: r.policy_profile_id ?? undefined,
    grantsLicense: r.grants_license !== false,
    ldapExternalId: r.ldap_external_id ?? undefined,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString()
  }
}

function rowProfile(r: pg.QueryResultRow): PolicyProfile {
  const userMessages = parseJsonObj<PolicyProfile["userMessages"]>(
    r.user_messages_json
  )
  const workSchedule = parseJsonObj<PolicyProfile["workSchedule"]>(
    r.work_schedule_json
  )
  return {
    id: r.id,
    orgId: r.org_id,
    name: r.name,
    department: r.department ?? undefined,
    defaultAction: r.default_action,
    enabledHosts: r.enabled_hosts || [],
    scanUploads: r.scan_uploads !== false,
    eventReporting: r.event_reporting !== false,
    protectUnenroll: !!r.protect_unenroll,
    enabled: r.enabled !== false && r.enabled !== 0,
    priority:
      typeof r.priority === "number"
        ? r.priority
        : Number(r.priority) || 100,
    assignedGroupIds: r.assigned_group_ids || [],
    assignedUserIds: r.assigned_user_ids || [],
    userMessages,
    workSchedule: workSchedule ?? null,
    updatedAt: new Date(r.updated_at).toISOString()
  }
}

/**
 * Store Postgres V1 — control plane durable (admins, sessions, profiles, …).
 */
export class PgStore implements OpsGateStore {
  readonly kind = "postgres" as const
  private pool: pg.Pool

  private constructor(pool: pg.Pool) {
    this.pool = pool
  }

  /** Exposé pour WebAuthn / jobs qui partagent le pool */
  getPgPool(): pg.Pool {
    return this.pool
  }

  static async create(databaseUrl: string): Promise<PgStore> {
    const raw = new Pool({ connectionString: databaseUrl })
    const pool = wrapPoolWithRls(raw)
    const store = new PgStore(pool)
    // Migrate + seed toujours en bypass (cross-tenant / DDL)
    await withBypassRls(async () => {
      await store.migrate()
      await store.ensureSeed()
    })
    return store
  }

  private async migrate() {
    const sql = readFileSync(join(__dirname, "db", "schema.sql"), "utf8")
    await this.pool.query(sql)

    // Soft alters for installs that pre-date V1 full schema
    const alters = [
      `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS primary_email TEXT NOT NULL DEFAULT 'admin@demo.local'`,
      `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS is_personal BOOLEAN NOT NULL DEFAULT FALSE`,
      `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS license_seats INT NOT NULL DEFAULT 0`,
      `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`,
      `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS delete_purge_at TIMESTAMPTZ`,
      `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS delete_reason TEXT`,
      `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS delete_requested_by TEXT`,
      `CREATE TABLE IF NOT EXISTS org_ai_tools (
        org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        tool TEXT NOT NULL,
        display_name TEXT,
        status TEXT NOT NULL DEFAULT 'unknown',
        first_seen_at TIMESTAMPTZ,
        last_seen_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_by TEXT,
        PRIMARY KEY (org_id, tool)
      )`,
      `CREATE TABLE IF NOT EXISTS user_risk_scores (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        agent_id TEXT NOT NULL,
        score INT NOT NULL DEFAULT 0,
        score_previous INT,
        factors JSONB NOT NULL DEFAULT '{}',
        period_start TIMESTAMPTZ NOT NULL,
        period_end TIMESTAMPTZ NOT NULL,
        calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (org_id, agent_id, period_end)
      )`,
      `ALTER TABLE policies ADD COLUMN IF NOT EXISTS management_password_hash TEXT NOT NULL DEFAULT ''`,
      `ALTER TABLE policies ADD COLUMN IF NOT EXISTS config_epoch INT NOT NULL DEFAULT 1`,
      `ALTER TABLE policies ADD COLUMN IF NOT EXISTS protect_unenroll BOOLEAN NOT NULL DEFAULT FALSE`,
      `ALTER TABLE agents ADD COLUMN IF NOT EXISTS host_name TEXT`,
      `ALTER TABLE agents ADD COLUMN IF NOT EXISTS policy_profile_id TEXT`,
      `ALTER TABLE agents ADD COLUMN IF NOT EXISTS user_id TEXT`,
      `ALTER TABLE agents ADD COLUMN IF NOT EXISTS license_assigned BOOLEAN NOT NULL DEFAULT TRUE`,
      `ALTER TABLE agents ADD COLUMN IF NOT EXISTS unlicensed_since TIMESTAMPTZ`,
      `ALTER TABLE agents ADD COLUMN IF NOT EXISTS personal_account BOOLEAN NOT NULL DEFAULT FALSE`,
      `ALTER TABLE agents ADD COLUMN IF NOT EXISTS last_config_epoch INT`,
      `ALTER TABLE agents ADD COLUMN IF NOT EXISTS group_id TEXT`,
      `ALTER TABLE detection_events ADD COLUMN IF NOT EXISTS device_label TEXT`,
      `ALTER TABLE detection_events ADD COLUMN IF NOT EXISTS exit_actor TEXT`,
      `ALTER TABLE detection_events ADD COLUMN IF NOT EXISTS exit_admin_id TEXT`,
      `ALTER TABLE detection_events ADD COLUMN IF NOT EXISTS exit_admin_label TEXT`,
      `ALTER TABLE moving_rules ADD COLUMN IF NOT EXISTS conditions_json TEXT NOT NULL DEFAULT '[]'`,
      `ALTER TABLE moving_rules ADD COLUMN IF NOT EXISTS condition_logic TEXT NOT NULL DEFAULT 'and'`,
      `ALTER TABLE moving_rules ADD COLUMN IF NOT EXISTS permanent BOOLEAN NOT NULL DEFAULT FALSE`,
      `ALTER TABLE admin_sessions ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`,
      `ALTER TABLE admin_sessions ADD COLUMN IF NOT EXISTS read_only BOOLEAN NOT NULL DEFAULT FALSE`,
      // WORM audit : colonnes avant index (bases déjà créées sans seq)
      `ALTER TABLE admin_audit_events ADD COLUMN IF NOT EXISTS seq BIGINT`,
      `ALTER TABLE admin_audit_events ADD COLUMN IF NOT EXISTS entry_hash TEXT`,
      `ALTER TABLE admin_audit_events ADD COLUMN IF NOT EXISTS prev_hash TEXT`,
      `CREATE INDEX IF NOT EXISTS admin_audit_org_seq_idx ON admin_audit_events(org_id, seq DESC)`,
      // Nouveaux agents : pas de licence tant qu'aucun groupe (sauf assignation manuelle)
      `ALTER TABLE agents ALTER COLUMN license_assigned SET DEFAULT FALSE`,
      `ALTER TABLE policies ADD COLUMN IF NOT EXISTS user_messages_json TEXT NOT NULL DEFAULT '{}'`,
      `ALTER TABLE policy_profiles ADD COLUMN IF NOT EXISTS user_messages_json TEXT NOT NULL DEFAULT '{}'`,
      `ALTER TABLE policies ADD COLUMN IF NOT EXISTS work_schedule_json TEXT NOT NULL DEFAULT '{}'`,
      `ALTER TABLE policy_profiles ADD COLUMN IF NOT EXISTS work_schedule_json TEXT NOT NULL DEFAULT '{}'`,
      `ALTER TABLE policy_profiles ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT TRUE`,
      `ALTER TABLE policy_profiles ADD COLUMN IF NOT EXISTS priority INT NOT NULL DEFAULT 100`,
      `ALTER TABLE agents ADD COLUMN IF NOT EXISTS device_fingerprint TEXT`,
      `ALTER TABLE agents ADD COLUMN IF NOT EXISTS device_type TEXT NOT NULL DEFAULT 'extension'`,
      `ALTER TABLE agents ADD COLUMN IF NOT EXISTS maintenance_mode TEXT`,
      `ALTER TABLE agents ADD COLUMN IF NOT EXISTS maintenance_note TEXT`,
      `ALTER TABLE org_admins ADD COLUMN IF NOT EXISTS failed_login_count INT NOT NULL DEFAULT 0`,
      `ALTER TABLE org_admins ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ`,
      `ALTER TABLE org_admins ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT FALSE`,
      `ALTER TABLE org_admins ADD COLUMN IF NOT EXISTS totp_secret TEXT`,
      `ALTER TABLE org_admins ADD COLUMN IF NOT EXISTS totp_pending_secret TEXT`,
      `CREATE TABLE IF NOT EXISTS issued_licenses (
        id TEXT PRIMARY KEY,
        license_key TEXT NOT NULL UNIQUE,
        org_code TEXT NOT NULL,
        company_name TEXT NOT NULL,
        address TEXT NOT NULL DEFAULT '',
        contact_email TEXT NOT NULL DEFAULT '',
        seats INT NOT NULL DEFAULT 0,
        expires_at TIMESTAMPTZ NOT NULL,
        issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        revoked_at TIMESTAMPTZ
      )`,
      `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS monitoring_json TEXT NOT NULL DEFAULT '{}'`,
      `CREATE TABLE IF NOT EXISTS log_exports (
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
      )`,
      `CREATE TABLE IF NOT EXISTS recovery_codes (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        code_hash TEXT NOT NULL,
        label TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        consumed_at TIMESTAMPTZ,
        consumed_agent_id TEXT,
        active BOOLEAN NOT NULL DEFAULT TRUE
      )`,
      `CREATE TABLE IF NOT EXISTS user_inbox_messages (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        agent_id TEXT NOT NULL,
        device_label TEXT NOT NULL DEFAULT '',
        host_name TEXT,
        category TEXT NOT NULL DEFAULT 'question',
        subject TEXT NOT NULL,
        body TEXT NOT NULL,
        context_url TEXT,
        context_hostname TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        read_at TIMESTAMPTZ,
        replied_at TIMESTAMPTZ,
        closed_at TIMESTAMPTZ,
        admin_reply TEXT,
        replied_by_admin_id TEXT,
        replied_by_admin_label TEXT,
        user_acked_at TIMESTAMPTZ
      )`,
      `ALTER TABLE user_inbox_messages ADD COLUMN IF NOT EXISTS user_acked_at TIMESTAMPTZ`
    ]
    for (const q of alters) {
      await this.pool.query(q)
    }
    await this.pool
      .query(
        `CREATE INDEX IF NOT EXISTS log_exports_org_idx ON log_exports(org_id, created_at DESC)`
      )
      .catch(() => {
        /* ignore */
      })
    await this.pool
      .query(
        `CREATE INDEX IF NOT EXISTS recovery_codes_org_active_idx
         ON recovery_codes(org_id) WHERE active = TRUE AND consumed_at IS NULL`
      )
      .catch(() => {
        /* ignore */
      })
    await this.pool
      .query(
        `CREATE INDEX IF NOT EXISTS user_inbox_org_created_idx
         ON user_inbox_messages(org_id, created_at DESC)`
      )
      .catch(() => {
        /* ignore */
      })
    await this.pool
      .query(
        `CREATE INDEX IF NOT EXISTS user_inbox_org_status_idx
         ON user_inbox_messages(org_id, status)`
      )
      .catch(() => {
        /* ignore */
      })
    // Index anti-doublon : uniquement après ADD COLUMN device_fingerprint
    await this.pool
      .query(
        `CREATE INDEX IF NOT EXISTS agents_org_fp_idx
         ON agents(org_id, device_fingerprint)`
      )
      .catch((e) => {
        console.warn("[store:postgres] agents_org_fp_idx:", String(e))
      })
    // Heartbeat manquant sur vieilles sessions → baser sur created_at
    await this.pool
      .query(
        `UPDATE admin_sessions
         SET last_activity_at = created_at
         WHERE last_activity_at IS NULL
            OR last_activity_at > created_at + interval '1 minute'
               AND created_at < NOW() - interval '15 minutes'`
      )
      .catch(() => {
        /* ignore */
      })
    // Purge idle / expiré au démarrage (évite lockout admin fantôme)
    await this.pool
      .query(
        `DELETE FROM admin_sessions
         WHERE expires_at < NOW()
            OR COALESCE(last_activity_at, created_at) < NOW() - interval '10 minutes'`
      )
      .catch(() => {
        /* ignore */
      })
    // Events survivant à la révocation agent (CASCADE → SET NULL)
    await this.migrateEventsAgentFk()
    // Multi-tenant RLS (V2 P1) — skip si OPSGATE_PG_RLS=off
    await this.migrateRls()
    console.log("[store:postgres] schema migrated (V1 full control plane)")
  }

  /** Active FORCE ROW LEVEL SECURITY + policies org (voir db/rls.sql). */
  private async migrateRls() {
    if (getPgRlsMode() === "off") {
      console.log("[store:postgres] RLS skip (OPSGATE_PG_RLS=off)")
      return
    }
    try {
      const rlsSql = readFileSync(join(__dirname, "db", "rls.sql"), "utf8")
      await this.pool.query(rlsSql)
      console.log(
        `[store:postgres] RLS multi-tenant applied (mode=${getPgRlsMode()})`
      )
    } catch (e) {
      console.warn(
        "[store:postgres] RLS migrate failed:",
        e instanceof Error ? e.message : e
      )
    }
  }

  /** detection_events.agent_id : NOT NULL CASCADE → NULL SET NULL + unique org-level */
  private async migrateEventsAgentFk() {
    try {
      await this.pool.query(
        `ALTER TABLE detection_events ALTER COLUMN agent_id DROP NOT NULL`
      )
    } catch {
      /* already nullable */
    }
    // Drop old FKs / unique on (agent_id, client_event_id)
    const { rows: fks } = await this.pool.query<{ conname: string }>(
      `SELECT conname FROM pg_constraint
       WHERE conrelid = 'detection_events'::regclass
         AND contype = 'f'
         AND pg_get_constraintdef(oid) ILIKE '%agent_id%'`
    )
    for (const r of fks) {
      await this.pool.query(
        `ALTER TABLE detection_events DROP CONSTRAINT IF EXISTS ${r.conname}`
      )
    }
    const { rows: uniqs } = await this.pool.query<{ conname: string }>(
      `SELECT conname FROM pg_constraint
       WHERE conrelid = 'detection_events'::regclass
         AND contype = 'u'`
    )
    for (const r of uniqs) {
      await this.pool.query(
        `ALTER TABLE detection_events DROP CONSTRAINT IF EXISTS ${r.conname}`
      )
    }
    await this.pool.query(
      `ALTER TABLE detection_events
         ADD CONSTRAINT detection_events_agent_id_fkey
         FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE SET NULL`
    ).catch(() => {
      /* exists */
    })
    await this.pool.query(
      `ALTER TABLE detection_events
         ADD CONSTRAINT detection_events_org_client_event_unique
         UNIQUE (org_id, client_event_id)`
    ).catch(() => {
      /* exists */
    })
  }

  private async ensureSeed() {
    const { rows } = await this.pool.query(
      `SELECT id FROM organizations WHERE org_code = $1`,
      ["DEMO-OPSGATE"]
    )
    if (rows.length > 0) {
      await this.ensurePrincipalAdmin(rows[0].id)
      await this.ensureDefaultPack(rows[0].id)
      await this.ensurePersonalOrg()
      // PERSONAL ne doit pas avoir d'admin console (même email que DEMO → login ambigu)
      await this.scrubPersonalConsoleAdmins()
      await this.ensureSampleOrg()
      console.log("[store:postgres] demo org already present")
      return
    }

    const orgId = newId("org")
    const now = new Date().toISOString()
    const setupEmail = PRINCIPAL_SETUP_EMAIL.toLowerCase()
    const global = buildGlobalRulesPack("1.0.0")
    const pack = materializePack({
      orgId,
      version: global.version,
      rules: global.rules,
      notes: global.notes,
      publishedBy: "system-seed",
      active: true
    })
    const policyId = newId("pol")
    const engId = newId("prof")
    const financeId = newId("prof")
    const gEng = newId("grp")
    const gFin = newId("grp")
    const u1 = newId("usr")
    const u2 = newId("usr")
    const adminId = newId("adm")
    const mgmtHash = hashManagementPassword(PRINCIPAL_DEFAULT_PASSWORD)

    const client = await this.pool.connect()
    try {
      await client.query("BEGIN")
      await client.query(
        `INSERT INTO organizations (id, name, slug, org_code, mode_default, event_payload_policy, primary_email, is_personal, license_seats, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,false,25,$8)`,
        [
          orgId,
          "OpsGate Demo",
          "demo",
          "DEMO-OPSGATE",
          "org_managed",
          "metadata_only",
          setupEmail,
          now
        ]
      )
      await client.query(
        `INSERT INTO policies (id, org_id, version, default_action, enabled_hosts, scan_uploads, event_reporting, rules_pack_version, management_password_hash, protect_unenroll, config_epoch, updated_at)
         VALUES ($1,$2,1,$3,$4::jsonb,true,true,$5,$6,true,1,$7)`,
        [
          policyId,
          orgId,
          "mask_recommend",
          JSON.stringify(DEFAULT_HOSTS),
          pack.version,
          mgmtHash,
          now
        ]
      )
      await client.query(
        `INSERT INTO rule_packs (org_id, version, pack_id, schema_version, min_engine_version, checksum, signature, rules, notes, published_at, published_by, active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,true)`,
        [
          orgId,
          pack.version,
          pack.packId,
          pack.schemaVersion,
          pack.minEngineVersion ?? null,
          pack.checksum,
          pack.signature,
          JSON.stringify(pack.rules),
          pack.notes ?? null,
          pack.publishedAt,
          pack.publishedBy
        ]
      )
      await client.query(
        `INSERT INTO org_admins (id, org_id, label, email, password_hash, is_principal, permissions, active, must_change_password, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,true,$6::jsonb,true,true,$7,$7)`,
        [
          adminId,
          orgId,
          "Administrator",
          setupEmail,
          mgmtHash,
          JSON.stringify(ALL_ADMIN_PERMISSIONS),
          now
        ]
      )
      await client.query(
        `INSERT INTO policy_profiles (id, org_id, name, department, default_action, enabled_hosts, scan_uploads, event_reporting, protect_unenroll, assigned_group_ids, assigned_user_ids, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10::jsonb,$11::jsonb,$12)`,
        [
          engId,
          orgId,
          "Engineering",
          "engineering",
          "mask_recommend",
          JSON.stringify(DEFAULT_HOSTS),
          true,
          true,
          false,
          JSON.stringify([gEng]),
          JSON.stringify([]),
          now
        ]
      )
      await client.query(
        `INSERT INTO policy_profiles (id, org_id, name, department, default_action, enabled_hosts, scan_uploads, event_reporting, protect_unenroll, assigned_group_ids, assigned_user_ids, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10::jsonb,$11::jsonb,$12)`,
        [
          financeId,
          orgId,
          "Finance",
          "finance",
          "mask_force",
          JSON.stringify(["chatgpt.com", "claude.ai"]),
          false,
          true,
          true,
          JSON.stringify([gFin]),
          JSON.stringify([]),
          now
        ]
      )
      await client.query(
        `INSERT INTO user_groups (id, org_id, name, description, policy_profile_id, grants_license, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,true,$6,$6), ($7,$2,$8,$9,$10,true,$6,$6)`,
        [
          gEng,
          orgId,
          "Engineering",
          "Équipe technique",
          engId,
          now,
          gFin,
          "Finance",
          "Équipe finance — policy stricte",
          financeId
        ]
      )
      await client.query(
        `INSERT INTO org_users (id, org_id, display_name, email, group_ids, license_manual, created_at)
         VALUES ($1,$3,$4,$5,$6::jsonb,NULL,$9), ($2,$3,$7,$8,$10::jsonb,NULL,$9)`,
        [
          u1,
          u2,
          orgId,
          "Alice Demo",
          "alice@demo.local",
          JSON.stringify([gEng]),
          "Bob Finance",
          "bob@demo.local",
          now,
          JSON.stringify([gFin])
        ]
      )
      await client.query("COMMIT")
      console.log(
        `[store:postgres] Seeded DEMO-OPSGATE principal=${setupEmail} seats=25 rules=${pack.version}`
      )
    } catch (e) {
      await client.query("ROLLBACK")
      throw e
    } finally {
      client.release()
    }

    await this.ensurePersonalOrg()
    await this.scrubPersonalConsoleAdmins()
    await this.ensureSampleOrg()
  }

  /**
   * Clé Sample fixe (papier / tests)  -  toujours upsertée au démarrage.
   * Alphabet sans 0/O/1/I : OPS-SMPL-ENTR-PRSE-TEST
   */
  static readonly SAMPLE_LICENSE_KEY = "OPS-SMPL-ENTR-PRSE-TEST"

  /** Tenant d'exemple SAMPLE-OPSGATE (tests licence / multi-tenant) */
  private async ensureSampleOrg() {
    try {
      const { rows } = await this.pool.query(
        `SELECT id FROM organizations WHERE org_code = $1`,
        ["SAMPLE-OPSGATE"]
      )
      let orgId = rows[0]?.id as string | undefined
      if (!orgId) {
        orgId = newId("org")
        const now = new Date().toISOString()
        const policyId = newId("pol")
        const adminId = newId("adm")
        const email = "admin@sample.local"
        const hash = hashManagementPassword(PRINCIPAL_DEFAULT_PASSWORD)
        const mon = JSON.stringify({
          licenseDisplay: {
            companyName: "",
            address: "",
            contactEmail: "",
            expiresAt: null,
            mode: "trial",
            seats: 0,
            activatedAt: null,
            licenseKeyFingerprint: null
          }
        })
        await this.pool.query(
          `INSERT INTO organizations (id, name, slug, org_code, mode_default, event_payload_policy, primary_email, is_personal, license_seats, monitoring_json, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,false,0,$8,$9)`,
          [
            orgId,
            "Sample Enterprise",
            "sample",
            "SAMPLE-OPSGATE",
            "org_managed",
            "metadata_only",
            email,
            mon,
            now
          ]
        )
        await this.pool.query(
          `INSERT INTO policies (id, org_id, version, default_action, enabled_hosts, scan_uploads, event_reporting, rules_pack_version, management_password_hash, protect_unenroll, config_epoch, updated_at)
           VALUES ($1,$2,1,$3,$4::jsonb,true,true,$5,$6,true,1,$7)`,
          [
            policyId,
            orgId,
            "mask_recommend",
            JSON.stringify(DEFAULT_HOSTS),
            "1.0.0",
            hash,
            now
          ]
        )
        await this.pool.query(
          `INSERT INTO org_admins (id, org_id, label, email, password_hash, is_principal, permissions, active, must_change_password, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,true,$6::jsonb,true,false,$7,$7)`,
          [
            adminId,
            orgId,
            "Sample Admin",
            email,
            hash,
            JSON.stringify(ALL_ADMIN_PERMISSIONS),
            now
          ]
        )
        await this.ensureDefaultPack(orgId)
        console.log(
          `[store:postgres] Seeded SAMPLE-OPSGATE principal=${email} (trial 30j)`
        )
      } else {
        await this.ensureDefaultPack(orgId)
      }
      await this.ensureSampleLicense()
    } catch (e) {
      console.warn("[store:postgres] ensureSampleOrg skipped:", e)
    }
  }

  /** Garantit la clé Sample en base (évite license_not_found) */
  private async ensureSampleLicense() {
    const key = PgStore.SAMPLE_LICENSE_KEY
    const exp = new Date()
    exp.setFullYear(exp.getFullYear() + 1)
    const expiresAt = exp.toISOString()
    const issuedAt = new Date().toISOString()
    const id = newId("lic")
    await this.pool.query(
      `INSERT INTO issued_licenses (id, license_key, org_code, company_name, address, contact_email, seats, expires_at, issued_at, revoked_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NULL)
       ON CONFLICT (license_key) DO UPDATE SET
         org_code = EXCLUDED.org_code,
         company_name = EXCLUDED.company_name,
         address = EXCLUDED.address,
         contact_email = EXCLUDED.contact_email,
         seats = EXCLUDED.seats,
         expires_at = EXCLUDED.expires_at,
         revoked_at = NULL`,
      [
        id,
        key,
        "SAMPLE-OPSGATE",
        "Sample Enterprise",
        "42 Avenue Sample, 75008 Paris",
        "licence@sample.enterprise",
        50,
        expiresAt,
        issuedAt
      ]
    )
    console.log(`[store:postgres] SAMPLE license ready: ${key}`)
  }

  private async ensurePrincipalAdmin(orgId: string) {
    const org = await this.getOrg(orgId)
    // Org personnelle = pas de console admin (évite collision email avec DEMO)
    if (org?.isPersonal) return

    const { rows } = await this.pool.query(
      `SELECT id FROM org_admins WHERE org_id = $1 AND is_principal = TRUE LIMIT 1`,
      [orgId]
    )
    if (rows.length > 0) return
    const now = new Date().toISOString()
    const email = PRINCIPAL_SETUP_EMAIL.toLowerCase()
    const hash = hashManagementPassword(PRINCIPAL_DEFAULT_PASSWORD)
    await this.pool.query(
      `INSERT INTO org_admins (id, org_id, label, email, password_hash, is_principal, permissions, active, must_change_password, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,true,$6::jsonb,true,true,$7,$7)
       ON CONFLICT (org_id, email) DO NOTHING`,
      [
        newId("adm"),
        orgId,
        "Administrator",
        email,
        hash,
        JSON.stringify(ALL_ADMIN_PERMISSIONS),
        now
      ]
    )
    await this.pool.query(
      `UPDATE policies SET management_password_hash = $2 WHERE org_id = $1 AND (management_password_hash = '' OR management_password_hash IS NULL)`,
      [orgId, hash]
    )
  }

  /** Retire les admins console créés par erreur sur PERSONAL (events / login fantômes). */
  private async scrubPersonalConsoleAdmins() {
    const { rowCount: sessions } = await this.pool.query(
      `DELETE FROM admin_sessions
       WHERE org_id IN (SELECT id FROM organizations WHERE is_personal = TRUE)`
    )
    const { rowCount: admins } = await this.pool.query(
      `DELETE FROM org_admins
       WHERE org_id IN (SELECT id FROM organizations WHERE is_personal = TRUE)`
    )
    if ((admins ?? 0) > 0 || (sessions ?? 0) > 0) {
      console.log(
        `[store:postgres] scrubbed PERSONAL console admins=${admins ?? 0} sessions=${sessions ?? 0}`
      )
    }
  }

  private async ensurePersonalOrg() {
    const { rows } = await this.pool.query(
      `SELECT id FROM organizations WHERE org_code = $1`,
      ["PERSONAL"]
    )
    if (rows.length > 0) return

    const orgId = newId("org")
    const now = new Date().toISOString()
    const global = buildGlobalRulesPack("1.0.0")
    const pack = materializePack({
      orgId,
      version: global.version,
      rules: global.rules,
      notes: "personal-pack",
      publishedBy: "system-seed",
      active: true
    })
    const policyId = newId("pol")
    await this.pool.query(
      `INSERT INTO organizations (id, name, slug, org_code, mode_default, event_payload_policy, primary_email, is_personal, license_seats, created_at)
       VALUES ($1,'OpsGate Personal','personal','PERSONAL','org_managed','metadata_only',$2,true,1,$3)`,
      [orgId, PRINCIPAL_SETUP_EMAIL.toLowerCase(), now]
    )
    await this.pool.query(
      `INSERT INTO policies (id, org_id, version, default_action, enabled_hosts, scan_uploads, event_reporting, rules_pack_version, management_password_hash, protect_unenroll, config_epoch, updated_at)
       VALUES ($1,$2,1,'mask_recommend',$3::jsonb,true,false,$4,'',false,1,$5)`,
      [policyId, orgId, JSON.stringify(DEFAULT_HOSTS), pack.version, now]
    )
    await this.pool.query(
      `INSERT INTO rule_packs (org_id, version, pack_id, schema_version, min_engine_version, checksum, signature, rules, notes, published_at, published_by, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,true)`,
      [
        orgId,
        pack.version,
        pack.packId,
        pack.schemaVersion,
        pack.minEngineVersion ?? null,
        pack.checksum,
        pack.signature,
        JSON.stringify(pack.rules),
        pack.notes ?? null,
        pack.publishedAt,
        pack.publishedBy
      ]
    )
    console.log("[store:postgres] Seeded PERSONAL org")
  }

  async findOrgByCode(code: string) {
    const { rows } = await this.pool.query(
      `SELECT * FROM organizations WHERE org_code = $1`,
      [code.trim().toUpperCase()]
    )
    return rows[0] ? rowOrg(rows[0]) : undefined
  }

  async getOrg(id: string) {
    const { rows } = await this.pool.query(
      `SELECT * FROM organizations WHERE id = $1`,
      [id]
    )
    return rows[0] ? rowOrg(rows[0]) : undefined
  }

  async listOrgs() {
    const { rows } = await this.pool.query(
      `SELECT * FROM organizations ORDER BY created_at ASC NULLS LAST`
    )
    return rows.map(rowOrg)
  }

  async setOrgLicenseSeats(orgId: string, seats: number) {
    const n = Math.max(0, Math.floor(seats) || 0)
    await this.pool.query(
      `UPDATE organizations SET license_seats = $2 WHERE id = $1`,
      [orgId, n]
    )
    return this.getOrg(orgId)
  }

  async softDeleteOrg(
    orgId: string,
    meta: {
      deletedAt: string
      deletePurgeAt: string
      deleteReason?: string | null
      deleteRequestedBy?: string | null
    }
  ) {
    await this.pool.query(
      `UPDATE organizations SET
         deleted_at = $2::timestamptz,
         delete_purge_at = $3::timestamptz,
         delete_reason = $4,
         delete_requested_by = $5
       WHERE id = $1`,
      [
        orgId,
        meta.deletedAt,
        meta.deletePurgeAt,
        meta.deleteReason || null,
        meta.deleteRequestedBy || null
      ]
    )
    return this.getOrg(orgId)
  }

  async restoreOrg(orgId: string) {
    await this.pool.query(
      `UPDATE organizations SET
         deleted_at = NULL,
         delete_purge_at = NULL,
         delete_reason = NULL,
         delete_requested_by = NULL
       WHERE id = $1`,
      [orgId]
    )
    return this.getOrg(orgId)
  }

  async hardDeleteOrg(orgId: string) {
    const { rowCount } = await this.pool.query(
      `DELETE FROM organizations WHERE id = $1`,
      [orgId]
    )
    return (rowCount ?? 0) > 0
  }

  async listOrgsDueForHardPurge() {
    const { rows } = await this.pool.query(
      `SELECT * FROM organizations
       WHERE deleted_at IS NOT NULL
         AND delete_purge_at IS NOT NULL
         AND delete_purge_at <= NOW()
       ORDER BY delete_purge_at ASC`
    )
    return rows.map(rowOrg)
  }

  async revokeAllOrgSessions(orgId: string) {
    const { rowCount } = await this.pool.query(
      `DELETE FROM admin_sessions WHERE org_id = $1`,
      [orgId]
    )
    return rowCount ?? 0
  }

  async ensureDefaultPack(
    orgId: string
  ): Promise<StoredRulePack | undefined> {
    const { rows: activeRows } = await this.pool.query(
      `SELECT * FROM rule_packs WHERE org_id = $1 AND active = TRUE LIMIT 1`,
      [orgId]
    )
    if (activeRows[0]) return rowPack(activeRows[0])
    const { rows: anyRows } = await this.pool.query(
      `SELECT * FROM rule_packs WHERE org_id = $1 ORDER BY published_at DESC LIMIT 1`,
      [orgId]
    )
    if (anyRows[0]) {
      await this.pool.query(
        `UPDATE rule_packs SET active = TRUE WHERE org_id = $1 AND version = $2`,
        [orgId, anyRows[0].version]
      )
      return rowPack({ ...anyRows[0], active: true })
    }
    const org = await this.getOrg(orgId)
    if (!org) return undefined
    const global = buildGlobalRulesPack("1.0.0")
    const pack = materializePack({
      orgId,
      version: global.version,
      rules: global.rules,
      notes: global.notes || "default-pack-auto",
      publishedBy: "system-ensure",
      active: true
    })
    await this.pool.query(
      `UPDATE rule_packs SET active = FALSE WHERE org_id = $1`,
      [orgId]
    )
    await this.pool.query(
      `INSERT INTO rule_packs (org_id, version, pack_id, schema_version, min_engine_version, checksum, signature, rules, notes, published_at, published_by, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,true)
       ON CONFLICT (org_id, version) DO UPDATE SET
         active = TRUE,
         checksum = EXCLUDED.checksum,
         signature = EXCLUDED.signature,
         rules = EXCLUDED.rules`,
      [
        orgId,
        pack.version,
        pack.packId,
        pack.schemaVersion,
        pack.minEngineVersion ?? null,
        pack.checksum,
        pack.signature,
        JSON.stringify(pack.rules),
        pack.notes ?? null,
        pack.publishedAt,
        pack.publishedBy
      ]
    )
    const policy = await this.getPolicy(orgId)
    if (policy) {
      await this.pool.query(
        `UPDATE policies SET rules_pack_version = $2 WHERE org_id = $1`,
        [orgId, pack.version]
      )
    }
    console.log(
      `[store:postgres] ensureDefaultPack org=${orgId.slice(0, 12)}… version=${pack.version}`
    )
    return pack
  }

  async issueShortLicense(input: {
    orgCode: string
    companyName: string
    address: string
    contactEmail: string
    seats: number
    expiresAt: string
    kind?: import("./license-keys").LicenseKind
  }) {
    const {
      generateShortLicenseKey,
      buildPayloadFromInput
    } = await import("./license-keys")
    const payload = buildPayloadFromInput(input)
    let key = generateShortLicenseKey()
    for (let i = 0; i < 5; i++) {
      const { rows } = await this.pool.query(
        `SELECT 1 FROM issued_licenses WHERE license_key = $1`,
        [key]
      )
      if (!rows[0]) break
      key = generateShortLicenseKey()
    }
    const id = newId("lic")
    await this.pool.query(
      `ALTER TABLE issued_licenses ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'full'`
    )
    const kind: "full" | "seat_topup" =
      payload.kind === "seat_topup" ? "seat_topup" : "full"
    await this.pool.query(
      `INSERT INTO issued_licenses (id, license_key, org_code, company_name, address, contact_email, seats, expires_at, issued_at, kind)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        id,
        key,
        payload.orgCode,
        payload.companyName,
        payload.address,
        payload.contactEmail,
        payload.seats,
        payload.expiresAt,
        payload.issuedAt,
        kind
      ]
    )
    return {
      licenseKey: key,
      payload: { ...payload, kind }
    }
  }

  async lookupIssuedLicense(licenseKey: string) {
    const { normalizeLicenseKey } = await import("./license-keys")
    const key = normalizeLicenseKey(licenseKey)
    const { rows } = await this.pool.query(
      `SELECT * FROM issued_licenses WHERE license_key = $1`,
      [key]
    )
    if (!rows[0]) return undefined
    const r = rows[0]
    return {
      id: r.id as string,
      licenseKey: r.license_key as string,
      v: 1 as const,
      orgCode: r.org_code as string,
      companyName: r.company_name as string,
      address: (r.address as string) || "",
      contactEmail: (r.contact_email as string) || "",
      seats: Number(r.seats) || 0,
      expiresAt: new Date(r.expires_at).toISOString(),
      issuedAt: new Date(r.issued_at).toISOString(),
      revokedAt: r.revoked_at ? new Date(r.revoked_at).toISOString() : null,
      kind: (r.kind === "seat_topup" ? "seat_topup" : "full") as
        | "full"
        | "seat_topup"
    }
  }

  async revokeIssuedLicense(licenseKey: string) {
    const { normalizeLicenseKey } = await import("./license-keys")
    const key = normalizeLicenseKey(licenseKey)
    const { rowCount } = await this.pool.query(
      `UPDATE issued_licenses SET revoked_at = NOW()
       WHERE license_key = $1 AND revoked_at IS NULL`,
      [key]
    )
    return (rowCount || 0) > 0
  }

  async listIssuedLicenses() {
    await this.pool.query(
      `ALTER TABLE issued_licenses ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'full'`
    )
    const { rows } = await this.pool.query(
      `SELECT * FROM issued_licenses ORDER BY issued_at DESC LIMIT 500`
    )
    return rows.map((r) => ({
      id: r.id as string,
      licenseKey: r.license_key as string,
      v: 1 as const,
      orgCode: r.org_code as string,
      companyName: r.company_name as string,
      address: (r.address as string) || "",
      contactEmail: (r.contact_email as string) || "",
      seats: Number(r.seats) || 0,
      expiresAt: new Date(r.expires_at).toISOString(),
      issuedAt: new Date(r.issued_at).toISOString(),
      revokedAt: r.revoked_at ? new Date(r.revoked_at).toISOString() : null,
      kind: (r.kind === "seat_topup" ? "seat_topup" : "full") as
        | "full"
        | "seat_topup"
    }))
  }

  async provisionTenant(input: {
    orgCode: string
    companyName: string
    contactEmail: string
    seats?: number
  }) {
    const code = input.orgCode.trim().toUpperCase()
    const email = input.contactEmail.trim().toLowerCase()
    const existing = await this.findOrgByCode(code)
    if (existing) {
      return {
        orgId: existing.id,
        orgCode: existing.orgCode,
        principalEmail: existing.primaryEmail || email,
        created: false
      }
    }
    const {
      PRINCIPAL_DEFAULT_PASSWORD,
      hashManagementPassword,
      newId
    } = await import("./crypto")
    const { buildGlobalRulesPack, materializePack } = await import(
      "./rules-pack"
    )
    const { ALL_ADMIN_PERMISSIONS } = await import("./types")
    const orgId = newId("org")
    const now = new Date().toISOString()
    const seats = Math.max(0, Math.floor(input.seats ?? 0))
    const slug = code
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "client"
    const global = buildGlobalRulesPack("1.0.0")
    const pack = materializePack({
      orgId,
      version: global.version,
      rules: global.rules,
      notes: "tenant-provision",
      publishedBy: "vendor-desk",
      active: true
    })
    const policyId = newId("pol")
    const adminId = newId("adm")
    const mgmtHash = hashManagementPassword(PRINCIPAL_DEFAULT_PASSWORD)
    const hosts = [
      "chatgpt.com",
      "chat.openai.com",
      "claude.ai",
      "gemini.google.com",
      "copilot.microsoft.com",
      "perplexity.ai",
      "grok.com"
    ]
    const client = await this.pool.connect()
    try {
      await client.query("BEGIN")
      await client.query(
        `INSERT INTO organizations (id, name, slug, org_code, mode_default, event_payload_policy, primary_email, is_personal, license_seats, created_at)
         VALUES ($1,$2,$3,$4,'org_managed','metadata_only',$5,false,$6,$7)`,
        [
          orgId,
          input.companyName.trim() || code,
          slug,
          code,
          email,
          seats,
          now
        ]
      )
      await client.query(
        `INSERT INTO policies (id, org_id, version, default_action, enabled_hosts, scan_uploads, event_reporting, rules_pack_version, management_password_hash, protect_unenroll, config_epoch, updated_at)
         VALUES ($1,$2,1,'mask_recommend',$3::jsonb,true,true,$4,$5,true,1,$6)`,
        [policyId, orgId, JSON.stringify(hosts), pack.version, mgmtHash, now]
      )
      await client.query(
        `INSERT INTO rule_packs (org_id, version, pack_id, schema_version, min_engine_version, checksum, signature, rules, notes, published_at, published_by, active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,true)`,
        [
          orgId,
          pack.version,
          pack.packId,
          pack.schemaVersion,
          pack.minEngineVersion ?? null,
          pack.checksum,
          pack.signature,
          JSON.stringify(pack.rules),
          pack.notes ?? null,
          pack.publishedAt,
          pack.publishedBy
        ]
      )
      await client.query(
        `INSERT INTO org_admins (id, org_id, label, email, password_hash, is_principal, permissions, active, must_change_password, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,true,$6::jsonb,true,true,$7,$7)`,
        [
          adminId,
          orgId,
          "Administrator",
          email,
          mgmtHash,
          JSON.stringify(ALL_ADMIN_PERMISSIONS),
          now
        ]
      )
      await client.query("COMMIT")
    } catch (e) {
      await client.query("ROLLBACK")
      throw e
    } finally {
      client.release()
    }
    return {
      orgId,
      orgCode: code,
      principalEmail: email,
      created: true,
      tempPassword: PRINCIPAL_DEFAULT_PASSWORD
    }
  }

  async updateOrgMonitoring(
    orgId: string,
    monitoring: Partial<import("./types").OrgMonitoringSettings>
  ) {
    const org = await this.getOrg(orgId)
    if (!org) return undefined
    const { mergeMonitoringSettings } = await import("./types")
    const next = mergeMonitoringSettings({
      ...org.monitoring,
      ...monitoring,
      schedule: monitoring.schedule
        ? {
            ...(org.monitoring?.schedule || {}),
            ...monitoring.schedule
          }
        : org.monitoring?.schedule,
      ldap: monitoring.ldap
        ? {
            ...(org.monitoring?.ldap || {}),
            ...monitoring.ldap
          }
        : org.monitoring?.ldap
    })
    await this.pool.query(
      `UPDATE organizations SET monitoring_json = $2 WHERE id = $1`,
      [orgId, JSON.stringify(next)]
    )
    return this.getOrg(orgId)
  }

  async mergeAgents(orgId: string, keepId: string, mergeIds: string[]) {
    const ids = [...new Set(mergeIds.filter((id) => id && id !== keepId))]
    if (!ids.length) return { ok: false as const, kept: keepId, removed: 0 }
    const keep = (await this.listAgents(orgId)).find((a) => a.id === keepId)
    if (!keep) return { ok: false as const, kept: keepId, removed: 0 }
    let removed = 0
    // Re-pointer events vers l’agent conservé (historique unifié)
    for (const mid of ids) {
      const other = (await this.listAgents(orgId)).find((a) => a.id === mid)
      if (!other) continue
      await this.pool.query(
        `UPDATE detection_events SET agent_id = $1 WHERE org_id = $2 AND agent_id = $3`,
        [keepId, orgId, mid]
      )
      // Conserver fingerprint / label utiles
      if (!keep.deviceFingerprint && other.deviceFingerprint) {
        await this.pool.query(
          `UPDATE agents SET device_fingerprint = $2 WHERE id = $1`,
          [keepId, other.deviceFingerprint]
        )
      }
      const { rowCount } = await this.pool.query(
        `DELETE FROM agents WHERE org_id = $1 AND id = $2`,
        [orgId, mid]
      )
      if ((rowCount ?? 0) > 0) removed++
    }
    // last_seen = le plus récent
    await this.pool.query(
      `UPDATE agents SET last_seen_at = NOW() WHERE id = $1`,
      [keepId]
    )
    await this.forceConfigSync(orgId)
    return { ok: true as const, kept: keepId, removed }
  }

  async getPolicy(orgId: string) {
    const { rows } = await this.pool.query(
      `SELECT * FROM policies WHERE org_id = $1`,
      [orgId]
    )
    return rows[0] ? rowPolicy(rows[0]) : undefined
  }

  async updatePolicy(
    orgId: string,
    patch: Partial<
      Pick<
        Policy,
        | "defaultAction"
        | "enabledHosts"
        | "scanUploads"
        | "eventReporting"
        | "rulesPackVersion"
        | "managementPasswordHash"
        | "protectUnenroll"
        | "configEpoch"
        | "userMessages"
        | "workSchedule"
      >
    >
  ) {
    const current = await this.getPolicy(orgId)
    if (!current) return undefined
    const nextConfigEpoch =
      typeof patch.configEpoch === "number"
        ? patch.configEpoch
        : (current.configEpoch || 1) + 1
    const nextUserMessages =
      patch.userMessages !== undefined
        ? { ...(current.userMessages || {}), ...patch.userMessages }
        : current.userMessages
    const next = {
      ...current,
      ...patch,
      userMessages: nextUserMessages,
      workSchedule:
        patch.workSchedule !== undefined
          ? patch.workSchedule
          : current.workSchedule,
      version: current.version + 1,
      configEpoch: nextConfigEpoch,
      updatedAt: new Date().toISOString()
    }
    await this.pool.query(
      `UPDATE policies SET
        version = $2,
        default_action = $3,
        enabled_hosts = $4::jsonb,
        scan_uploads = $5,
        event_reporting = $6,
        rules_pack_version = $7,
        management_password_hash = $8,
        updated_at = $9,
        config_epoch = $10,
        protect_unenroll = $11,
        user_messages_json = $12,
        work_schedule_json = $13
       WHERE org_id = $1`,
      [
        orgId,
        next.version,
        next.defaultAction,
        JSON.stringify(next.enabledHosts),
        next.scanUploads,
        next.eventReporting,
        next.rulesPackVersion,
        next.managementPasswordHash,
        next.updatedAt,
        next.configEpoch,
        !!next.protectUnenroll,
        JSON.stringify(next.userMessages || {}),
        JSON.stringify(next.workSchedule || {})
      ]
    )
    return next
  }

  async listAdmins(orgId: string) {
    const org = await this.getOrg(orgId)
    const { rows } = await this.pool.query(
      `SELECT * FROM org_admins WHERE org_id = $1 ORDER BY is_principal DESC, created_at ASC`,
      [orgId]
    )
    if (rows.length === 0) {
      if (org?.isPersonal) return []
      await this.ensurePrincipalAdmin(orgId)
      const again = await this.pool.query(
        `SELECT * FROM org_admins WHERE org_id = $1 ORDER BY is_principal DESC, created_at ASC`,
        [orgId]
      )
      return again.rows.map(rowAdmin)
    }
    return rows.map(rowAdmin)
  }

  async getPrincipalAdmin(orgId: string) {
    const { rows } = await this.pool.query(
      `SELECT * FROM org_admins WHERE org_id = $1 AND is_principal = TRUE LIMIT 1`,
      [orgId]
    )
    if (rows[0]) return rowAdmin(rows[0])
    await this.ensurePrincipalAdmin(orgId)
    const again = await this.pool.query(
      `SELECT * FROM org_admins WHERE org_id = $1 AND is_principal = TRUE LIMIT 1`,
      [orgId]
    )
    return again.rows[0] ? rowAdmin(again.rows[0]) : undefined
  }

  async listUnenrollAdmins(orgId: string) {
    return (await this.listAdmins(orgId)).filter(
      (a) =>
        a.active &&
        a.passwordHash &&
        (a.isPrincipal || a.permissions.includes("unenroll_agents"))
    )
  }

  async ensureAdminPasswordHistoryColumn() {
    await this.pool.query(`
      ALTER TABLE org_admins
        ADD COLUMN IF NOT EXISTS password_history JSONB NOT NULL DEFAULT '[]'::jsonb
    `)
  }

  async upsertAdmin(
    orgId: string,
    input: {
      id?: string
      label: string
      email: string
      password?: string
      active?: boolean
      isPrincipal?: boolean
      permissions?: AdminPermission[]
      mustChangePassword?: boolean
      unlock?: boolean
    }
  ) {
    await this.ensureAdminPasswordHistoryColumn()
    const org = await this.getOrg(orgId)
    if (!org) return undefined
    const now = new Date().toISOString()
    const email = input.email.trim().toLowerCase()
    if (!email.includes("@")) return undefined
    const {
      validatePasswordPolicy,
      pushPasswordHistory,
      hashManagementPassword: hashPw
    } = await import("./crypto")

    if (input.id) {
      const { rows } = await this.pool.query(
        `SELECT * FROM org_admins WHERE org_id = $1 AND id = $2`,
        [orgId, input.id]
      )
      if (!rows[0]) return undefined
      const prev = rowAdmin(rows[0])
      const dup = await this.pool.query(
        `SELECT id FROM org_admins WHERE org_id = $1 AND email = $2 AND id <> $3`,
        [orgId, email, prev.id]
      )
      if (dup.rows.length > 0) return undefined

      let passwordHash = prev.passwordHash
      let passwordHistory = prev.passwordHistory || []
      let mustChange =
        input.mustChangePassword !== undefined
          ? input.mustChangePassword
          : prev.mustChangePassword
      if (input.password) {
        const pol = validatePasswordPolicy(input.password, {
          currentHash: prev.passwordHash,
          history: prev.passwordHistory
        })
        if (!pol.ok) return undefined
        passwordHistory = pushPasswordHistory(
          prev.passwordHash,
          prev.passwordHistory
        )
        passwordHash = hashPw(input.password)
        if (input.mustChangePassword === undefined) mustChange = false
      }
      const isPrincipal =
        input.isPrincipal !== undefined ? !!input.isPrincipal : prev.isPrincipal
      const permissions = isPrincipal
        ? ALL_ADMIN_PERMISSIONS
        : input.permissions ?? prev.permissions
      const active = input.active !== undefined ? input.active : prev.active
      const label = input.label.trim() || prev.label
      let failedLoginCount = prev.failedLoginCount ?? 0
      let lockedAt = prev.lockedAt ?? null
      if (input.unlock) {
        failedLoginCount = 0
        lockedAt = null
      }

      const { rows: updated } = await this.pool.query(
        `UPDATE org_admins SET
          label=$3, email=$4, password_hash=$5, permissions=$6::jsonb,
          active=$7, must_change_password=$8, updated_at=$9,
          is_principal=$10, failed_login_count=$11, locked_at=$12,
          password_history=$13::jsonb
         WHERE org_id=$1 AND id=$2 RETURNING *`,
        [
          orgId,
          input.id,
          label,
          email,
          passwordHash,
          JSON.stringify(permissions),
          active,
          !!mustChange,
          now,
          isPrincipal,
          failedLoginCount,
          lockedAt,
          JSON.stringify(passwordHistory)
        ]
      )
      if (isPrincipal && input.password) {
        await this.pool.query(
          `UPDATE policies SET management_password_hash = $2 WHERE org_id = $1`,
          [orgId, passwordHash]
        )
      }
      // Sync e-mail install si principal change d’adresse
      if (isPrincipal && email !== (org.primaryEmail || "").toLowerCase()) {
        await this.pool.query(
          `UPDATE organizations SET primary_email = $2 WHERE id = $1`,
          [orgId, email]
        )
      }
      await this.forceConfigSync(orgId)
      return rowAdmin(updated[0])
    }

    if (!input.password) return undefined
    const pol = validatePasswordPolicy(input.password)
    if (!pol.ok) return undefined
    const exists = await this.pool.query(
      `SELECT id FROM org_admins WHERE org_id = $1 AND email = $2`,
      [orgId, email]
    )
    if (exists.rows.length > 0) return undefined

    const asPrincipal = !!input.isPrincipal
    let permissions = asPrincipal
      ? ALL_ADMIN_PERMISSIONS
      : input.permissions?.length
        ? input.permissions
        : (["console_access"] as AdminPermission[])
    if (!asPrincipal && !permissions.includes("console_access")) {
      permissions = ["console_access", ...permissions]
    }
    const id = newId("adm")
    const { rows } = await this.pool.query(
      `INSERT INTO org_admins (id, org_id, label, email, password_hash, is_principal, permissions, active, must_change_password, created_at, updated_at, failed_login_count, locked_at, password_history)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,false,$9,$9,0,NULL,'[]'::jsonb) RETURNING *`,
      [
        id,
        orgId,
        input.label.trim() || `admin`,
        email,
        hashPw(input.password),
        asPrincipal,
        JSON.stringify(permissions),
        input.active !== false,
        now
      ]
    )
    await this.forceConfigSync(orgId)
    return rowAdmin(rows[0])
  }

  async recordAdminLoginFailure(adminId: string, threshold: number) {
    const thr = Math.max(3, Math.min(50, Math.floor(threshold) || 5))
    const { rows } = await this.pool.query(
      `UPDATE org_admins SET
         failed_login_count = failed_login_count + 1,
         locked_at = CASE
           WHEN failed_login_count + 1 >= $2 THEN COALESCE(locked_at, NOW())
           ELSE locked_at
         END,
         updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [adminId, thr]
    )
    if (!rows[0]) return { locked: false, count: 0 }
    const a = rowAdmin(rows[0])
    return {
      locked: !!a.lockedAt,
      count: a.failedLoginCount || 0,
      admin: a
    }
  }

  async clearAdminLoginFailures(adminId: string) {
    await this.pool.query(
      `UPDATE org_admins SET failed_login_count = 0, locked_at = NULL, updated_at = NOW()
       WHERE id = $1`,
      [adminId]
    )
  }

  async unlockAdmin(orgId: string, adminId: string) {
    const { rows } = await this.pool.query(
      `UPDATE org_admins SET failed_login_count = 0, locked_at = NULL, updated_at = NOW()
       WHERE org_id = $1 AND id = $2 RETURNING *`,
      [orgId, adminId]
    )
    return rows[0] ? rowAdmin(rows[0]) : undefined
  }

  async findAdminsByEmail(email: string) {
    const emailNorm = email.trim().toLowerCase()
    const { rows } = await this.pool.query(
      `SELECT a.* FROM org_admins a
       INNER JOIN organizations o ON o.id = a.org_id
       WHERE lower(a.email) = $1 AND a.active = TRUE AND o.is_personal = FALSE
       ORDER BY a.is_principal DESC, a.created_at ASC`,
      [emailNorm]
    )
    return rows.map(rowAdmin)
  }

  async listAccessibleOrgsForEmail(email: string) {
    const emailNorm = (email || "").trim().toLowerCase()
    if (!emailNorm || !emailNorm.includes("@")) return []
    const { rows } = await this.pool.query(
      `SELECT o.id AS org_id, o.org_code, o.name,
              a.id AS admin_id, a.is_principal
       FROM org_admins a
       INNER JOIN organizations o ON o.id = a.org_id
       WHERE lower(a.email) = $1
         AND a.active = TRUE
         AND a.locked_at IS NULL
         AND COALESCE(o.is_personal, FALSE) = FALSE
         AND (
           a.is_principal = TRUE
           OR a.permissions @> '["console_access"]'::jsonb
         )
       ORDER BY o.name ASC`,
      [emailNorm]
    )
    return rows.map((r) => ({
      org_id: r.org_id as string,
      org_code: (r.org_code as string) || (r.org_id as string),
      name: (r.name as string) || (r.org_id as string),
      is_principal: !!r.is_principal,
      admin_id: r.admin_id as string
    }))
  }

  async switchAdminOrg(opts: {
    currentToken: string
    targetOrgId: string
    force?: boolean
  }) {
    const resolved = await this.resolveAdminSession(opts.currentToken)
    if (!resolved) return { ok: false as const, error: "session_invalid" }
    const targetOrgId = opts.targetOrgId.trim()
    if (!targetOrgId) return { ok: false as const, error: "org_id_required" }
    if (resolved.session.orgId === targetOrgId) {
      return {
        ok: true as const,
        session: resolved.session,
        admin: resolved.admin,
        forced: false
      }
    }
    const peers = await this.listAccessibleOrgsForEmail(resolved.admin.email)
    const hit = peers.find((p) => p.org_id === targetOrgId)
    if (!hit) return { ok: false as const, error: "org_not_accessible" }
    const { rows } = await this.pool.query(
      `SELECT * FROM org_admins WHERE org_id = $1 AND id = $2 AND active = TRUE`,
      [targetOrgId, hit.admin_id]
    )
    if (!rows[0]) return { ok: false as const, error: "admin_not_found" }
    const targetAdmin = rowAdmin(rows[0])
    if (targetAdmin.lockedAt) {
      return { ok: false as const, error: "account_locked" }
    }
    // Révoquer la session courante
    await this.pool.query(
      `DELETE FROM admin_sessions WHERE token_hash = $1`,
      [hashToken(opts.currentToken)]
    )
    return this.issueAdminSession(targetAdmin, {
      force: opts.force !== false
    })
  }

  async deleteAdmin(orgId: string, adminId: string) {
    const { rows } = await this.pool.query(
      `SELECT * FROM org_admins WHERE org_id = $1 AND id = $2`,
      [orgId, adminId]
    )
    if (!rows[0]) return false
    if (rows[0].is_principal) {
      const { rows: principals } = await this.pool.query(
        `SELECT id FROM org_admins WHERE org_id = $1 AND is_principal = TRUE AND active = TRUE`,
        [orgId]
      )
      if (principals.length <= 1) return false
    }
    await this.pool.query(`DELETE FROM admin_sessions WHERE admin_id = $1`, [
      adminId
    ])
    const { rowCount } = await this.pool.query(
      `DELETE FROM org_admins WHERE org_id = $1 AND id = $2`,
      [orgId, adminId]
    )
    if ((rowCount ?? 0) > 0) await this.forceConfigSync(orgId)
    return (rowCount ?? 0) > 0
  }

  /** Idle serveur 10 min sans heartbeat — évite lockout si onglet fermé sans logout. */
  private static readonly SESSION_IDLE_MS = 10 * 60 * 1000

  async setAdminTotp(
    orgId: string,
    adminId: string,
    fields: {
      totpEnabled?: boolean
      totpSecret?: string | null
      totpPendingSecret?: string | null
    }
  ) {
    const sets: string[] = [`updated_at = NOW()`]
    const vals: unknown[] = [orgId, adminId]
    let i = 3
    if (fields.totpEnabled !== undefined) {
      sets.push(`totp_enabled = $${i++}`)
      vals.push(!!fields.totpEnabled)
    }
    if (fields.totpSecret !== undefined) {
      sets.push(`totp_secret = $${i++}`)
      vals.push(fields.totpSecret)
    }
    if (fields.totpPendingSecret !== undefined) {
      sets.push(`totp_pending_secret = $${i++}`)
      vals.push(fields.totpPendingSecret)
    }
    const { rows } = await this.pool.query(
      `UPDATE org_admins SET ${sets.join(", ")}
       WHERE org_id = $1 AND id = $2 RETURNING *`,
      vals
    )
    return rows[0] ? rowAdmin(rows[0]) : undefined
  }

  async createAdminSession(
    email: string,
    password: string,
    opts?: {
      force?: boolean
      readOnly?: boolean
      totpCode?: string
      orgId?: string
      orgCode?: string
    }
  ) {
    const emailNorm = email.trim().toLowerCase()
    const hash = hashManagementPassword(password)
    const { rows } = await this.pool.query(
      `SELECT a.*, o.org_code, o.name AS org_name, o.is_personal
       FROM org_admins a
       INNER JOIN organizations o ON o.id = a.org_id
       WHERE lower(a.email) = $1
         AND a.active = TRUE
         AND a.password_hash = $2
       ORDER BY CASE WHEN o.is_personal THEN 1 ELSE 0 END ASC,
                a.is_principal DESC,
                a.created_at ASC`,
      [emailNorm, hash]
    )
    type Cand = {
      admin: OrgAdmin
      orgCode: string
      orgName: string
      personal: boolean
    }
    let candidates: Cand[] = rows
      .map((r) => ({
        admin: rowAdmin(r),
        orgCode: String(r.org_code || ""),
        orgName: String(r.org_name || ""),
        personal: !!r.is_personal
      }))
      .filter(
        (c) =>
          c.admin.isPrincipal ||
          c.admin.permissions.includes("console_access")
      )
    if (candidates.length === 0) {
      return { ok: false as const, error: "invalid_credentials" }
    }
    if (opts?.orgId) {
      candidates = candidates.filter((c) => c.admin.orgId === opts.orgId)
    } else if (opts?.orgCode) {
      const code = opts.orgCode.trim().toUpperCase()
      candidates = candidates.filter(
        (c) => c.orgCode.toUpperCase() === code
      )
    }
    if (candidates.length === 0) {
      return { ok: false as const, error: "invalid_credentials" }
    }
    if (candidates.length > 1 && !opts?.orgId && !opts?.orgCode) {
      return {
        ok: false as const,
        error: "org_selection_required" as const,
        orgs: candidates.map((c) => ({
          org_id: c.admin.orgId,
          org_code: c.orgCode,
          name: c.orgName
        }))
      }
    }
    const hit = candidates[0]!
    const admin = hit.admin
    if (admin.lockedAt) {
      return { ok: false as const, error: "account_locked" }
    }
    if (admin.totpEnabled && admin.totpSecret) {
      const code = (opts?.totpCode || "").trim()
      if (!code) return { ok: false as const, error: "mfa_required" }
      const { verifyTotp } = await import("./totp")
      if (!verifyTotp(admin.totpSecret, code)) {
        return { ok: false as const, error: "mfa_invalid" }
      }
    }
    return this.issueAdminSession(admin, {
      force: opts?.force,
      readOnly: opts?.readOnly
    })
  }

  async createAdminSessionOidc(
    email: string,
    opts?: { force?: boolean; readOnly?: boolean }
  ) {
    const emailNorm = email.trim().toLowerCase()
    const { rows } = await this.pool.query(
      `SELECT a.*
       FROM org_admins a
       INNER JOIN organizations o ON o.id = a.org_id
       WHERE lower(a.email) = $1
         AND a.active = TRUE
       ORDER BY CASE WHEN o.is_personal THEN 1 ELSE 0 END ASC,
                a.is_principal DESC,
                a.created_at ASC
       LIMIT 1`,
      [emailNorm]
    )
    if (!rows[0]) return { ok: false as const, error: "admin_not_found" }
    const admin = rowAdmin(rows[0])
    if (admin.lockedAt) {
      return { ok: false as const, error: "account_locked" }
    }
    if (!admin.isPrincipal && !admin.permissions.includes("console_access")) {
      return { ok: false as const, error: "no_console_access" }
    }
    // SSO : MFA local non exigé
    return this.issueAdminSession(admin, {
      force: opts?.force,
      readOnly: opts?.readOnly
    })
  }

  async issueAdminSessionDirect(opts: {
    orgId: string
    adminId: string
    force?: boolean
    readOnly?: boolean
  }) {
    const { rows } = await this.pool.query(
      `SELECT * FROM org_admins WHERE id = $1 AND org_id = $2 AND active = TRUE`,
      [opts.adminId, opts.orgId]
    )
    if (!rows[0]) return { ok: false as const, error: "admin_not_found" }
    const admin = rowAdmin(rows[0])
    if (admin.lockedAt) return { ok: false as const, error: "account_locked" }
    return this.issueAdminSession(admin, {
      force: opts.force,
      readOnly: opts.readOnly
    })
  }

  private async issueAdminSession(
    admin: OrgAdmin,
    opts?: { force?: boolean; readOnly?: boolean }
  ) {
    await this.clearAdminLoginFailures(admin.id)
    const idleSec = Math.floor(PgStore.SESSION_IDLE_MS / 1000)
    const readOnly = !!opts?.readOnly
    const force = !!opts?.force
    await this.pool.query(
      `DELETE FROM admin_sessions
       WHERE expires_at < NOW()
          OR COALESCE(last_activity_at, created_at) < NOW() - ($1 || ' seconds')::interval`,
      [String(idleSec)]
    )
    // Colonne read_only optionnelle (migration soft)
    await this.pool.query(
      `ALTER TABLE admin_sessions ADD COLUMN IF NOT EXISTS read_only BOOLEAN NOT NULL DEFAULT FALSE`
    ).catch(() => {
      /* ignore si pas de droits ALTER */
    })

    let forced = false
    if (force) {
      const del = await this.pool.query(
        `DELETE FROM admin_sessions WHERE admin_id = $1`,
        [admin.id]
      )
      forced = (del.rowCount || 0) > 0
    } else if (!readOnly) {
      // Session full : bloquer s’il existe déjà une full active
      const { rows: activeFull } = await this.pool.query(
        `SELECT 1 FROM admin_sessions
         WHERE admin_id = $1 AND expires_at > NOW()
           AND COALESCE(read_only, FALSE) = FALSE
         LIMIT 1`,
        [admin.id]
      )
      if (activeFull[0]) {
        return {
          ok: false as const,
          error: "session_already_active",
          orgId: admin.orgId,
          adminId: admin.id,
          adminEmail: admin.email
        }
      }
    }
    // readOnly : peut coexister ; on ne kick pas

    const token = `ogs_${newToken().replace(/^ogt_/, "")}`
    const tokenHash = hashToken(token)
    const now = Date.now()
    const expiresAt = now + 12 * 60 * 60 * 1000
    try {
      await this.pool.query(
        `INSERT INTO admin_sessions (token_hash, org_id, admin_id, expires_at, created_at, last_activity_at, read_only)
         VALUES ($1,$2,$3,to_timestamp($4/1000.0),NOW(),NOW(),$5)`,
        [tokenHash, admin.orgId, admin.id, expiresAt, readOnly]
      )
    } catch {
      // Fallback sans colonne read_only
      await this.pool.query(
        `INSERT INTO admin_sessions (token_hash, org_id, admin_id, expires_at, created_at, last_activity_at)
         VALUES ($1,$2,$3,to_timestamp($4/1000.0),NOW(),NOW())`,
        [tokenHash, admin.orgId, admin.id, expiresAt]
      )
    }
    const session: AdminSession = {
      token,
      orgId: admin.orgId,
      adminId: admin.id,
      expiresAt,
      createdAt: now,
      lastActivityAt: now,
      readOnly: readOnly || undefined
    }
    return { ok: true as const, session, admin, forced }
  }

  async revokeAllAdminSessions(adminId: string) {
    const r = await this.pool.query(
      `DELETE FROM admin_sessions WHERE admin_id = $1`,
      [adminId]
    )
    return r.rowCount || 0
  }

  async resolveAdminSession(token: string) {
    const tokenHash = hashToken(token)
    const { rows } = await this.pool.query(
      `SELECT * FROM admin_sessions WHERE token_hash = $1`,
      [tokenHash]
    )
    if (!rows[0]) return undefined
    const expiresAt = new Date(rows[0].expires_at).getTime()
    const lastAct = new Date(
      rows[0].last_activity_at || rows[0].created_at
    ).getTime()
    const now = Date.now()
    if (
      now > expiresAt ||
      now - lastAct > PgStore.SESSION_IDLE_MS
    ) {
      await this.pool.query(`DELETE FROM admin_sessions WHERE token_hash = $1`, [
        tokenHash
      ])
      return undefined
    }
    // Heartbeat
    await this.pool.query(
      `UPDATE admin_sessions SET last_activity_at = NOW() WHERE token_hash = $1`,
      [tokenHash]
    )
    const { rows: adminRows } = await this.pool.query(
      `SELECT * FROM org_admins WHERE id = $1 AND active = TRUE`,
      [rows[0].admin_id]
    )
    if (!adminRows[0]) {
      await this.pool.query(`DELETE FROM admin_sessions WHERE token_hash = $1`, [
        tokenHash
      ])
      return undefined
    }
    const admin = rowAdmin(adminRows[0])
    const session: AdminSession = {
      token,
      orgId: rows[0].org_id,
      adminId: rows[0].admin_id,
      expiresAt,
      createdAt: new Date(rows[0].created_at).getTime(),
      lastActivityAt: now,
      readOnly: rows[0].read_only === true ? true : undefined
    }
    return { session, admin }
  }

  async revokeAdminSession(token: string) {
    const { rowCount } = await this.pool.query(
      `DELETE FROM admin_sessions WHERE token_hash = $1`,
      [hashToken(token)]
    )
    return (rowCount ?? 0) > 0
  }

  async listUsers(orgId: string) {
    const { rows } = await this.pool.query(
      `SELECT * FROM org_users WHERE org_id = $1 ORDER BY created_at ASC`,
      [orgId]
    )
    return rows.map(rowUser)
  }

  async upsertUser(
    orgId: string,
    input: {
      id?: string
      displayName: string
      email?: string
      externalId?: string
      groupIds?: string[]
    }
  ) {
    const org = await this.getOrg(orgId)
    if (!org) return undefined
    if (input.id) {
      const { rows } = await this.pool.query(
        `SELECT * FROM org_users WHERE org_id = $1 AND id = $2`,
        [orgId, input.id]
      )
      if (!rows[0]) return undefined
      const prev = rowUser(rows[0])
      const { rows: updated } = await this.pool.query(
        `UPDATE org_users SET display_name=$3, email=$4, external_id=$5, group_ids=$6::jsonb
         WHERE org_id=$1 AND id=$2 RETURNING *`,
        [
          orgId,
          input.id,
          input.displayName,
          input.email ?? prev.email ?? null,
          input.externalId ?? prev.externalId ?? null,
          JSON.stringify(input.groupIds ?? prev.groupIds)
        ]
      )
      await this.forceConfigSync(orgId)
      return rowUser(updated[0])
    }
    const id = newId("usr")
    const { rows } = await this.pool.query(
      `INSERT INTO org_users (id, org_id, display_name, email, external_id, group_ids, created_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,NOW()) RETURNING *`,
      [
        id,
        orgId,
        input.displayName,
        input.email ?? null,
        input.externalId ?? null,
        JSON.stringify(input.groupIds || [])
      ]
    )
    return rowUser(rows[0])
  }

  async deleteUser(orgId: string, userId: string) {
    const { rowCount } = await this.pool.query(
      `DELETE FROM org_users WHERE org_id = $1 AND id = $2`,
      [orgId, userId]
    )
    if ((rowCount ?? 0) > 0) await this.forceConfigSync(orgId)
    return (rowCount ?? 0) > 0
  }

  async listGroups(orgId: string) {
    const { rows } = await this.pool.query(
      `SELECT * FROM user_groups WHERE org_id = $1 ORDER BY created_at ASC`,
      [orgId]
    )
    return rows.map(rowGroup)
  }

  async upsertGroup(
    orgId: string,
    input: {
      id?: string
      name: string
      description?: string
      policyProfileId?: string | null
      ldapExternalId?: string
    }
  ) {
    const org = await this.getOrg(orgId)
    if (!org) return undefined
    const now = new Date().toISOString()
    if (input.id) {
      const { rows } = await this.pool.query(
        `SELECT * FROM user_groups WHERE org_id = $1 AND id = $2`,
        [orgId, input.id]
      )
      if (!rows[0]) return undefined
      const prev = rowGroup(rows[0])
      const profileId =
        input.policyProfileId === null
          ? null
          : input.policyProfileId ?? prev.policyProfileId ?? null
      const { rows: updated } = await this.pool.query(
        `UPDATE user_groups SET name=$3, description=$4, policy_profile_id=$5, ldap_external_id=$6, updated_at=$7
         WHERE org_id=$1 AND id=$2 RETURNING *`,
        [
          orgId,
          input.id,
          input.name,
          input.description ?? prev.description ?? null,
          profileId,
          input.ldapExternalId ?? prev.ldapExternalId ?? null,
          now
        ]
      )
      await this.forceConfigSync(orgId)
      return rowGroup(updated[0])
    }
    const id = newId("grp")
    const { rows } = await this.pool.query(
      `INSERT INTO user_groups (id, org_id, name, description, policy_profile_id, grants_license, ldap_external_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,true,$6,$7,$7) RETURNING *`,
      [
        id,
        orgId,
        input.name,
        input.description ?? null,
        input.policyProfileId || null,
        input.ldapExternalId ?? null,
        now
      ]
    )
    await this.forceConfigSync(orgId)
    return rowGroup(rows[0])
  }

  async deleteGroup(orgId: string, groupId: string) {
    const { rowCount } = await this.pool.query(
      `DELETE FROM user_groups WHERE org_id = $1 AND id = $2`,
      [orgId, groupId]
    )
    if ((rowCount ?? 0) > 0) await this.forceConfigSync(orgId)
    return (rowCount ?? 0) > 0
  }

  async listProfiles(orgId: string) {
    const { rows } = await this.pool.query(
      `SELECT * FROM policy_profiles
       WHERE org_id = $1
       ORDER BY COALESCE(priority, 100) ASC, name ASC`,
      [orgId]
    )
    return rows.map(rowProfile)
  }

  async upsertProfile(
    orgId: string,
    input: {
      id?: string
      name: string
      department?: string
      defaultAction?: Policy["defaultAction"]
      enabledHosts?: string[]
      scanUploads?: boolean
      eventReporting?: boolean
      protectUnenroll?: boolean
      enabled?: boolean
      priority?: number
      assignedGroupIds?: string[]
      assignedUserIds?: string[]
      userMessages?: Partial<import("./types").PolicyUserMessages>
      workSchedule?: import("./types").WorkSchedule | null
    }
  ) {
    const org = await this.getOrg(orgId)
    if (!org) return undefined
    const now = new Date().toISOString()

    if (input.id) {
      const { rows } = await this.pool.query(
        `SELECT * FROM policy_profiles WHERE org_id = $1 AND id = $2`,
        [orgId, input.id]
      )
      if (!rows[0]) return undefined
      const prev = rowProfile(rows[0])
      const nextMsgs =
        input.userMessages !== undefined
          ? { ...(prev.userMessages || {}), ...input.userMessages }
          : prev.userMessages
      const next = {
        name: input.name,
        department: input.department ?? prev.department,
        defaultAction: input.defaultAction ?? prev.defaultAction,
        enabledHosts: input.enabledHosts ?? prev.enabledHosts,
        scanUploads:
          input.scanUploads !== undefined ? input.scanUploads : prev.scanUploads,
        eventReporting:
          input.eventReporting !== undefined
            ? input.eventReporting
            : prev.eventReporting,
        protectUnenroll:
          input.protectUnenroll !== undefined
            ? input.protectUnenroll
            : prev.protectUnenroll,
        enabled:
          input.enabled !== undefined ? input.enabled : prev.enabled !== false,
        priority:
          input.priority !== undefined
            ? Math.max(1, Math.floor(input.priority) || 100)
            : prev.priority ?? 100,
        assignedGroupIds: input.assignedGroupIds ?? prev.assignedGroupIds,
        assignedUserIds: input.assignedUserIds ?? prev.assignedUserIds,
        userMessages: nextMsgs,
        workSchedule:
          input.workSchedule !== undefined
            ? input.workSchedule
            : prev.workSchedule
      }
      const { rows: updated } = await this.pool.query(
        `UPDATE policy_profiles SET
          name=$3, department=$4, default_action=$5, enabled_hosts=$6::jsonb,
          scan_uploads=$7, event_reporting=$8, protect_unenroll=$9,
          assigned_group_ids=$10::jsonb, assigned_user_ids=$11::jsonb,
          user_messages_json=$12, work_schedule_json=$13, updated_at=$14,
          enabled=$15, priority=$16
         WHERE org_id=$1 AND id=$2 RETURNING *`,
        [
          orgId,
          input.id,
          next.name,
          next.department ?? null,
          next.defaultAction,
          JSON.stringify(next.enabledHosts),
          next.scanUploads,
          next.eventReporting,
          next.protectUnenroll,
          JSON.stringify(next.assignedGroupIds),
          JSON.stringify(next.assignedUserIds),
          JSON.stringify(next.userMessages || {}),
          JSON.stringify(next.workSchedule || {}),
          now,
          next.enabled,
          next.priority
        ]
      )
      const profile = rowProfile(updated[0])
      await this.applyProfileGroupAssignments(orgId, profile)
      await this.forceConfigSync(orgId)
      return profile
    }

    const id = newId("prof")
    const en = input.enabled !== false
    const prio =
      input.priority !== undefined
        ? Math.max(1, Math.floor(input.priority) || 100)
        : 100
    const { rows } = await this.pool.query(
      `INSERT INTO policy_profiles (id, org_id, name, department, default_action, enabled_hosts, scan_uploads, event_reporting, protect_unenroll, assigned_group_ids, assigned_user_ids, user_messages_json, work_schedule_json, updated_at, enabled, priority)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10::jsonb,$11::jsonb,$12,$13,$14,$15,$16) RETURNING *`,
      [
        id,
        orgId,
        input.name,
        input.department ?? null,
        input.defaultAction || "mask_recommend",
        JSON.stringify(input.enabledHosts || DEFAULT_HOSTS),
        input.scanUploads !== false,
        input.eventReporting !== false,
        !!input.protectUnenroll,
        JSON.stringify(input.assignedGroupIds || []),
        JSON.stringify(input.assignedUserIds || []),
        JSON.stringify(input.userMessages || {}),
        JSON.stringify(input.workSchedule || {}),
        now,
        en,
        prio
      ]
    )
    const profile = rowProfile(rows[0])
    await this.applyProfileGroupAssignments(orgId, profile)
    await this.forceConfigSync(orgId)
    return profile
  }

  private async applyProfileGroupAssignments(
    orgId: string,
    profile: PolicyProfile
  ) {
    const assigned = new Set(profile.assignedGroupIds || [])
    const groups = await this.listGroups(orgId)
    for (const g of groups) {
      if (assigned.has(g.id)) {
        await this.pool.query(
          `UPDATE user_groups SET policy_profile_id = $3, updated_at = NOW() WHERE org_id = $1 AND id = $2`,
          [orgId, g.id, profile.id]
        )
      } else if (g.policyProfileId === profile.id && !assigned.has(g.id)) {
        await this.pool.query(
          `UPDATE user_groups SET policy_profile_id = NULL, updated_at = NOW() WHERE org_id = $1 AND id = $2`,
          [orgId, g.id]
        )
      }
    }
  }

  async deleteProfile(orgId: string, profileId: string) {
    const { rowCount } = await this.pool.query(
      `DELETE FROM policy_profiles WHERE org_id = $1 AND id = $2`,
      [orgId, profileId]
    )
    if ((rowCount ?? 0) === 0) return false
    await this.pool.query(
      `UPDATE agents SET policy_profile_id = NULL WHERE org_id = $1 AND policy_profile_id = $2`,
      [orgId, profileId]
    )
    await this.pool.query(
      `UPDATE user_groups SET policy_profile_id = NULL WHERE org_id = $1 AND policy_profile_id = $2`,
      [orgId, profileId]
    )
    await this.forceConfigSync(orgId)
    return true
  }

  async assignAgentProfile(
    orgId: string,
    agentId: string,
    policyProfileId: string | null
  ) {
    if (policyProfileId) {
      const { rows } = await this.pool.query(
        `SELECT id FROM policy_profiles WHERE org_id = $1 AND id = $2`,
        [orgId, policyProfileId]
      )
      if (!rows[0]) return undefined
    }
    const { rows } = await this.pool.query(
      `UPDATE agents SET policy_profile_id = $3, last_seen_at = NOW()
       WHERE org_id = $1 AND id = $2 RETURNING *`,
      [orgId, agentId, policyProfileId]
    )
    if (!rows[0]) return undefined
    await this.forceConfigSync(orgId)
    return rowAgent(rows[0])
  }

  async assignAgentUser(orgId: string, agentId: string, userId: string | null) {
    if (userId) {
      const { rows } = await this.pool.query(
        `SELECT id FROM org_users WHERE org_id = $1 AND id = $2`,
        [orgId, userId]
      )
      if (!rows[0]) return undefined
    }
    const { rows } = await this.pool.query(
      `UPDATE agents SET user_id = $3, last_seen_at = NOW()
       WHERE org_id = $1 AND id = $2 RETURNING *`,
      [orgId, agentId, userId]
    )
    if (!rows[0]) return undefined
    await this.forceConfigSync(orgId)
    return rowAgent(rows[0])
  }

  async setAgentMaintenance(
    orgId: string,
    agentId: string,
    mode: "leave" | "outage" | "remote" | null,
    note?: string | null
  ) {
    const m =
      mode === "leave" || mode === "outage" || mode === "remote" ? mode : null
    const { rows } = await this.pool.query(
      `UPDATE agents SET maintenance_mode = $3, maintenance_note = $4, last_seen_at = NOW()
       WHERE org_id = $1 AND id = $2 RETURNING *`,
      [orgId, agentId, m, note?.trim() || null]
    )
    if (!rows[0]) return undefined
    return rowAgent(rows[0])
  }

  private async resolveProfileForAgent(
    orgId: string,
    agent: Agent | undefined
  ): Promise<PolicyProfile | null> {
    if (!agent) return null
    const list = (await this.listProfiles(orgId)).filter(
      (p) => p.enabled !== false
    )
    // Priorité firewall : plus petit priority d'abord
    const byPrio = (a: PolicyProfile, b: PolicyProfile) =>
      (a.priority ?? 100) - (b.priority ?? 100)
    if (agent.policyProfileId) {
      return list.find((p) => p.id === agent.policyProfileId) || null
    }
    if (agent.userId) {
      const users = await this.listUsers(orgId)
      const user = users.find((u) => u.id === agent.userId)
      if (user) {
        const byUser = list
          .filter((p) => (p.assignedUserIds || []).includes(user.id))
          .sort(byPrio)[0]
        if (byUser) return byUser
        const groups = await this.listGroups(orgId)
        const candidates: PolicyProfile[] = []
        for (const gid of user.groupIds || []) {
          for (const p of list) {
            if ((p.assignedGroupIds || []).includes(gid)) candidates.push(p)
          }
          const g = groups.find((x) => x.id === gid)
          if (g?.policyProfileId) {
            const p = list.find((x) => x.id === g.policyProfileId)
            if (p) candidates.push(p)
          }
        }
        if (candidates.length) {
          candidates.sort(byPrio)
          return candidates[0]
        }
      }
    }
    return null
  }

  async getEffectivePolicyForAgent(
    orgId: string,
    agentId: string
  ): Promise<EffectivePolicyBundle | undefined> {
    const policy = await this.getPolicy(orgId)
    if (!policy) return undefined
    const agents = await this.listAgents(orgId)
    const agent = agents.find((a) => a.id === agentId)
    const profile = await this.resolveProfileForAgent(orgId, agent)

    const effective = profile
      ? {
          defaultAction: profile.defaultAction,
          enabledHosts: profile.enabledHosts,
          scanUploads: profile.scanUploads,
          eventReporting: profile.eventReporting,
          protectUnenroll: profile.protectUnenroll,
          userMessages: {
            ...(policy.userMessages || {}),
            ...(profile.userMessages || {})
          },
          workSchedule:
            profile.workSchedule?.enabled
              ? profile.workSchedule
              : policy.workSchedule?.enabled
                ? policy.workSchedule
                : profile.workSchedule || policy.workSchedule || null
        }
      : {
          defaultAction: policy.defaultAction,
          enabledHosts: policy.enabledHosts,
          scanUploads: policy.scanUploads,
          eventReporting: policy.eventReporting,
          protectUnenroll: policy.protectUnenroll,
          userMessages: policy.userMessages || {},
          workSchedule: policy.workSchedule || null
        }

    const unenroll = await this.listUnenrollAdmins(orgId)
    const admins = unenroll.map((a) => ({
      id: a.id,
      label: a.label,
      email: a.email,
      password_hash: a.passwordHash
    }))
    const licensed = await this.isAgentLicensed(orgId, agentId)
    return { policy, profile, effective, admins, licensed }
  }

  async isAgentLicensed(orgId: string, agentId: string) {
    const { rows } = await this.pool.query(
      `SELECT license_assigned FROM agents WHERE org_id = $1 AND id = $2`,
      [orgId, agentId]
    )
    if (!rows[0]) return false
    return rows[0].license_assigned === true
  }

  async setAgentLicense(orgId: string, agentId: string, licensed: boolean) {
    const org = await this.getOrg(orgId)
    if (!org) return undefined
    if (licensed && org.licenseSeats && org.licenseSeats > 0) {
      const { rows: cnt } = await this.pool.query(
        `SELECT COUNT(*)::int AS n FROM agents
         WHERE org_id = $1 AND license_assigned = TRUE AND id <> $2`,
        [orgId, agentId]
      )
      if ((cnt[0]?.n || 0) >= org.licenseSeats) return undefined
    }
    const { rows } = await this.pool.query(
      `UPDATE agents SET
         license_assigned = $3,
         unlicensed_since = CASE WHEN $3 THEN NULL ELSE COALESCE(unlicensed_since, NOW()) END
       WHERE org_id = $1 AND id = $2 RETURNING *`,
      [orgId, agentId, licensed]
    )
    if (!rows[0]) return undefined
    await this.forceConfigSync(orgId)
    return rowAgent(rows[0])
  }

  async getLicenseStats(orgId: string) {
    const org = await this.getOrg(orgId)
    const agents = await this.listAgents(orgId)
    let licensed_agents = 0
    let unlicensed_agents = 0
    let grace_agents = 0
    const { LICENSE_GRACE_MS: graceMs } = await import("./summary-helpers")
    for (const a of agents) {
      if (a.licenseAssigned === true) {
        licensed_agents++
        continue
      }
      unlicensed_agents++
      if (a.unlicensedSince) {
        const age = Date.now() - new Date(a.unlicensedSince).getTime()
        if (age < graceMs) grace_agents++
      }
    }
    const seats = org?.licenseSeats ?? 0
    return {
      licensed_agents,
      unlicensed_agents,
      grace_agents,
      seats,
      seats_used: licensed_agents,
      seats_available: seats > 0 ? Math.max(0, seats - licensed_agents) : null
    }
  }

  async recordUnenrollAndRevoke(
    orgId: string,
    agentId: string,
    token: string,
    exit: ExitActor
  ) {
    const exitActor =
      exit.type === "admin"
        ? `admin:${exit.admin_label || exit.admin_id || "unknown"}`
        : exit.type
    await this.appendEvents(orgId, agentId, [
      {
        schema_version: 1,
        client_event_id: `unenroll-${agentId}-${Date.now()}`,
        ts: new Date().toISOString(),
        source: "system",
        hostname: "opsgate-agent",
        decision: "unenroll",
        detection_count: 0,
        highest_severity: "warning",
        rule_ids: ["system.unenroll"],
        types: ["unenroll", exitActor],
        exit_actor: exitActor,
        exit_admin_id: exit.admin_id,
        exit_admin_label: exit.admin_label
      }
    ])
    const ok = await this.revokeAgentByToken(token)
    return { ok, event_id: ok ? "recorded" : undefined }
  }

  async forceConfigSync(orgId: string) {
    const policy = await this.updatePolicy(orgId, {})
    if (!policy) return { ok: false as const, error: "policy_missing" }
    const agents = await this.listAgents(orgId)
    return {
      ok: true as const,
      configEpoch: policy.configEpoch,
      policyVersion: policy.version,
      agents: agents.length
    }
  }

  async ensurePasswordResetColumns() {
    await this.pool.query(`
      ALTER TABLE password_reset_challenges
        ADD COLUMN IF NOT EXISTS admin_id TEXT,
        ADD COLUMN IF NOT EXISTS target_email TEXT
    `)
  }

  async resolveAdminForPasswordReset(
    orgId: string,
    target?: { email?: string; adminId?: string }
  ) {
    if (target?.adminId) {
      const { rows } = await this.pool.query(
        `SELECT * FROM org_admins WHERE org_id = $1 AND id = $2 AND active = TRUE`,
        [orgId, target.adminId]
      )
      return rows[0] ? rowAdmin(rows[0]) : undefined
    }
    const email = (target?.email || "").trim().toLowerCase()
    if (email) {
      const { rows } = await this.pool.query(
        `SELECT * FROM org_admins WHERE org_id = $1 AND lower(email) = $2 AND active = TRUE`,
        [orgId, email]
      )
      return rows[0] ? rowAdmin(rows[0]) : undefined
    }
    return undefined
  }

  async requestPasswordResetOtp(
    orgId: string,
    target?: { email?: string; adminId?: string }
  ) {
    await this.ensurePasswordResetColumns()
    const admin = await this.resolveAdminForPasswordReset(orgId, target)
    if (!admin) {
      return { ok: false as const, error: "admin_not_found" }
    }
    const targetEmail = admin.email.trim()
    const otp = newOtpCode(6)
    const expiresIn = 10 * 60
    await this.pool.query(
      `INSERT INTO password_reset_challenges (org_id, code_hash, expires_at, created_at, admin_id, target_email)
       VALUES ($1, $2, to_timestamp($3/1000.0), NOW(), $4, $5)
       ON CONFLICT (org_id) DO UPDATE SET
         code_hash = EXCLUDED.code_hash,
         expires_at = EXCLUDED.expires_at,
         created_at = NOW(),
         admin_id = EXCLUDED.admin_id,
         target_email = EXCLUDED.target_email`,
      [
        orgId,
        hashManagementPassword(otp),
        Date.now() + expiresIn * 1000,
        admin.id,
        targetEmail
      ]
    )
    const org = await this.getOrg(orgId)
    const { mergeMonitoringSettings } = await import("./types")
    const mon = mergeMonitoringSettings(org?.monitoring)
    const {
      sendPasswordResetOtpEmail,
      shouldExposeDevOtp,
      maskEmail,
      isMailConfigured
    } = await import("./mail")
    let mailed = false
    let delivery: "smtp" | "log" | "failed" | "disabled" = "disabled"
    const sent = await sendPasswordResetOtpEmail({
      to: targetEmail,
      otp,
      expiresMin: Math.floor(expiresIn / 60),
      orgName: org?.name,
      smtp: mon.smtp
    })
    mailed = sent.ok && sent.delivery === "smtp"
    delivery = sent.delivery
    const expose = shouldExposeDevOtp(mon.smtp)
    if (expose) {
      console.log(
        `[opsgate-otp] DEV OTP admin=${admin.id} ${maskEmail(targetEmail)} = ${otp} (delivery=${delivery})`
      )
    }
    const masked = maskEmail(targetEmail)
    return {
      ok: true as const,
      expires_in_sec: expiresIn,
      mailed,
      delivery,
      dev_otp: expose ? otp : undefined,
      target_email_masked: masked,
      message: mailed
        ? `Un code OTP a été envoyé à ${masked}.`
        : delivery === "log"
          ? `SMTP non configuré : OTP journalisé côté serveur${expose ? " et affiché en lab" : ""}. Paramètres → E-mail / SMTP.`
          : delivery === "failed"
            ? `Échec d'envoi SMTP vers ${masked}. Vérifiez la config mail.`
            : isMailConfigured(mon.smtp)
              ? `OTP généré.`
              : `OTP généré sans e-mail (configurez Paramètres → E-mail / SMTP).`
    }
  }

  async confirmPasswordResetOtp(
    orgId: string,
    otp: string,
    newPassword: string,
    target?: { email?: string; adminId?: string }
  ) {
    await this.ensurePasswordResetColumns()
    const { rows } = await this.pool.query(
      `SELECT * FROM password_reset_challenges WHERE org_id = $1`,
      [orgId]
    )
    if (!rows[0]) return { ok: false as const, error: "no_challenge" }
    if (Date.now() > new Date(rows[0].expires_at).getTime()) {
      await this.pool.query(
        `DELETE FROM password_reset_challenges WHERE org_id = $1`,
        [orgId]
      )
      return { ok: false as const, error: "otp_expired" }
    }
    if (hashManagementPassword(otp.trim()) !== rows[0].code_hash) {
      return { ok: false as const, error: "otp_invalid" }
    }
    const chAdminId = (rows[0].admin_id as string) || ""
    const chEmail = ((rows[0].target_email as string) || "").toLowerCase()
    if (target?.adminId && chAdminId && target.adminId !== chAdminId) {
      return { ok: false as const, error: "admin_mismatch" }
    }
    if (
      target?.email &&
      chEmail &&
      target.email.trim().toLowerCase() !== chEmail
    ) {
      return { ok: false as const, error: "admin_mismatch" }
    }
    let adminId = chAdminId
    if (!adminId && target?.adminId) adminId = target.adminId
    if (!adminId && (chEmail || target?.email)) {
      const a = await this.resolveAdminForPasswordReset(orgId, {
        email: chEmail || target?.email
      })
      adminId = a?.id || ""
    }
    if (!adminId) {
      return { ok: false as const, error: "admin_missing_on_challenge" }
    }
    const { rows: admRows } = await this.pool.query(
      `SELECT * FROM org_admins WHERE id = $1 AND org_id = $2`,
      [adminId, orgId]
    )
    if (!admRows[0]) return { ok: false as const, error: "admin_not_found" }
    const prev = rowAdmin(admRows[0])
    const {
      validatePasswordPolicy,
      pushPasswordHistory,
      hashManagementPassword: hashPw
    } = await import("./crypto")
    const pol = validatePasswordPolicy(newPassword, {
      currentHash: prev.passwordHash,
      history: prev.passwordHistory
    })
    if (!pol.ok) return { ok: false as const, error: pol.error }
    const isPrincipal = prev.isPrincipal
    const hash = hashPw(newPassword)
    const history = pushPasswordHistory(prev.passwordHash, prev.passwordHistory)
    await this.ensureAdminPasswordHistoryColumn()
    await this.pool.query(
      `UPDATE org_admins SET password_hash = $2, must_change_password = FALSE, updated_at = NOW(), password_history = $3::jsonb
       WHERE id = $1`,
      [adminId, hash, JSON.stringify(history)]
    )
    if (isPrincipal) {
      await this.updatePolicy(orgId, { managementPasswordHash: hash })
      await this.pool.query(
        `UPDATE organizations SET primary_email = $2 WHERE id = $1`,
        [orgId, prev.email]
      )
    }
    await this.pool.query(
      `DELETE FROM password_reset_challenges WHERE org_id = $1`,
      [orgId]
    )
    return { ok: true as const }
  }

  async listPacks(orgId: string) {
    const { rows } = await this.pool.query(
      `SELECT * FROM rule_packs WHERE org_id = $1 ORDER BY published_at DESC`,
      [orgId]
    )
    return rows.map(rowPack)
  }

  async getPack(orgId: string, version: string) {
    const { rows } = await this.pool.query(
      `SELECT * FROM rule_packs WHERE org_id = $1 AND version = $2`,
      [orgId, version]
    )
    return rows[0] ? rowPack(rows[0]) : undefined
  }

  async getActivePack(orgId: string): Promise<StoredRulePack | undefined> {
    const { rows } = await this.pool.query(
      `SELECT * FROM rule_packs WHERE org_id = $1 AND active = TRUE LIMIT 1`,
      [orgId]
    )
    if (rows[0]) return rowPack(rows[0])
    const { rows: all } = await this.pool.query(
      `SELECT * FROM rule_packs WHERE org_id = $1 ORDER BY published_at DESC LIMIT 1`,
      [orgId]
    )
    if (all[0]) {
      await this.pool.query(
        `UPDATE rule_packs SET active = TRUE WHERE org_id = $1 AND version = $2`,
        [orgId, all[0].version]
      )
      return rowPack({ ...all[0], active: true })
    }
    return this.ensureDefaultPack(orgId)
  }

  async getActivePackPayload(
    orgId: string
  ): Promise<RulesPackPayload | undefined> {
    const pack = await this.getActivePack(orgId)
    return pack ? toPayload(pack) : undefined
  }

  async publishPack(input: PublishPackInput): Promise<PublishPackResult> {
    const policy = await this.getPolicy(input.orgId)
    if (!policy) return { ok: false, errors: ["policy_missing"] }

    let rules: DetectionRule[]
    if (input.rules) {
      const v = validateRules(input.rules)
      if (!v.ok) return { ok: false, errors: v.errors }
      rules = input.rules
    } else {
      let active = await this.getActivePack(input.orgId)
      if (!active) {
        active = await this.ensureDefaultPack(input.orgId)
      }
      if (!active) {
        const global = buildGlobalRulesPack("1.0.0")
        rules = global.rules
      } else {
        const disable = new Set(input.disableRuleIds || [])
        rules = active.rules.filter(
          (r: DetectionRule) => !disable.has(r.id)
        )
      }
      const v = validateRules(rules)
      if (!v.ok) return { ok: false, errors: v.errors }
    }

    const existing = await this.listPacks(input.orgId)
    const base = (await this.getActivePack(input.orgId))?.version
    const version = nextFreeVersion(
      existing.map((p) => p.version),
      base
    )

    const activate = input.activate !== false
    const pack = materializePack({
      orgId: input.orgId,
      version,
      rules,
      notes: input.notes,
      publishedBy: input.publishedBy,
      active: activate
    })

    const client = await this.pool.connect()
    try {
      await client.query("BEGIN")
      if (activate) {
        await client.query(
          `UPDATE rule_packs SET active = FALSE WHERE org_id = $1`,
          [input.orgId]
        )
      }
      await client.query(
        `INSERT INTO rule_packs (org_id, version, pack_id, schema_version, min_engine_version, checksum, signature, rules, notes, published_at, published_by, active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12)`,
        [
          pack.orgId,
          pack.version,
          pack.packId,
          pack.schemaVersion,
          pack.minEngineVersion ?? null,
          pack.checksum,
          pack.signature,
          JSON.stringify(pack.rules),
          pack.notes ?? null,
          pack.publishedAt,
          pack.publishedBy,
          pack.active
        ]
      )

      let nextPolicy = policy
      if (activate) {
        nextPolicy = {
          ...policy,
          version: policy.version + 1,
          configEpoch: (policy.configEpoch || 0) + 1,
          rulesPackVersion: pack.version,
          updatedAt: new Date().toISOString()
        }
        await client.query(
          `UPDATE policies SET version=$2, rules_pack_version=$3, config_epoch=$4, updated_at=$5 WHERE org_id=$1`,
          [
            input.orgId,
            nextPolicy.version,
            pack.version,
            nextPolicy.configEpoch,
            nextPolicy.updatedAt
          ]
        )
      }
      await client.query("COMMIT")
      if (activate) {
        await this.prunePacks(input.orgId, 12)
      }
      return { ok: true, pack, policy: nextPolicy }
    } catch (e) {
      await client.query("ROLLBACK")
      throw e
    } finally {
      client.release()
    }
  }

  async deletePack(orgId: string, version: string) {
    const pack = await this.getPack(orgId, version)
    if (!pack) return { ok: false, error: "not_found" }
    if (pack.active) return { ok: false, error: "cannot_delete_active" }
    await this.pool.query(
      `DELETE FROM rule_packs WHERE org_id = $1 AND version = $2 AND active = FALSE`,
      [orgId, version]
    )
    return { ok: true }
  }

  async prunePacks(orgId: string, keep = 12) {
    const n = Math.max(3, Math.min(50, keep))
    const { rows } = await this.pool.query(
      `SELECT version FROM rule_packs
       WHERE org_id = $1 AND active = FALSE
       ORDER BY published_at DESC`,
      [orgId]
    )
    const toDrop = rows.slice(n).map((r) => r.version as string)
    let deleted = 0
    for (const v of toDrop) {
      const r = await this.deletePack(orgId, v)
      if (r.ok) deleted++
    }
    return { deleted }
  }

  async activatePack(
    orgId: string,
    version: string
  ): Promise<ActivatePackResult> {
    const pack = await this.getPack(orgId, version)
    const policy = await this.getPolicy(orgId)
    if (!pack || !policy) return { ok: false, error: "org_missing" }

    const client = await this.pool.connect()
    try {
      await client.query("BEGIN")
      await client.query(
        `UPDATE rule_packs SET active = FALSE WHERE org_id = $1`,
        [orgId]
      )
      await client.query(
        `UPDATE rule_packs SET active = TRUE WHERE org_id = $1 AND version = $2`,
        [orgId, version]
      )
      const nextPolicy: Policy = {
        ...policy,
        version: policy.version + 1,
        configEpoch: (policy.configEpoch || 0) + 1,
        rulesPackVersion: pack.version,
        updatedAt: new Date().toISOString()
      }
      await client.query(
        `UPDATE policies SET version=$2, rules_pack_version=$3, config_epoch=$4, updated_at=$5 WHERE org_id=$1`,
        [
          orgId,
          nextPolicy.version,
          pack.version,
          nextPolicy.configEpoch,
          nextPolicy.updatedAt
        ]
      )
      await client.query("COMMIT")
      return { ok: true, pack: { ...pack, active: true }, policy: nextPolicy }
    } catch (e) {
      await client.query("ROLLBACK")
      throw e
    } finally {
      client.release()
    }
  }

  async enrollAgent(input: {
    orgId: string
    token: string
    deviceLabel?: string
    hostName?: string
    appVersion?: string
    userId?: string
    personalLicenseKey?: string
    deviceFingerprint?: string
    deviceType?: "extension" | "proxy"
  }): Promise<Agent & { replaced?: boolean }> {
    const now = new Date().toISOString()
    const tokenHash = hashToken(input.token)
    const label = (input.deviceLabel || "").trim()
    const fp = (input.deviceFingerprint || "").trim()
    const dtype =
      input.deviceType === "proxy" ? "proxy" : "extension"
    const org = await this.getOrg(input.orgId)
    const personal = !!org?.isPersonal

    // Licence org : false tant qu'aucun groupe (moving rule / bulk / admin manuel)
    // Personal : clé valide
    let assignLicense = false
    if (personal) {
      assignLicense = isValidPersonalLicenseKey(input.personalLicenseKey)
    }

    const rebind = async (existingId: string) => {
      const { rows } = await this.pool.query(
        `UPDATE agents SET
           token_hash = $2,
           app_version = COALESCE($3, app_version),
           device_label = COALESCE(NULLIF($4, ''), device_label),
           host_name = COALESCE($5, host_name),
           user_id = COALESCE($6, user_id),
           last_seen_at = $7,
           personal_account = $8,
           device_fingerprint = COALESCE(NULLIF($11, ''), device_fingerprint),
           device_type = COALESCE($12, device_type),
           license_assigned = CASE
             WHEN $9 THEN $10
             ELSE license_assigned
           END,
           unlicensed_since = CASE
             WHEN $9 AND $10 THEN NULL
             WHEN $9 AND NOT $10 THEN COALESCE(unlicensed_since, $7::timestamptz)
             ELSE unlicensed_since
           END
         WHERE id = $1
         RETURNING *`,
        [
          existingId,
          tokenHash,
          input.appVersion ?? null,
          label || null,
          input.hostName ?? null,
          input.userId ?? null,
          now,
          personal,
          personal,
          assignLicense,
          fp || null,
          dtype
        ]
      )
      const agent = { ...rowAgent(rows[0]), replaced: true as const }
      await this.pushSystemEvent(input.orgId, agent.id, "enroll", {
        types: ["enroll", "re_enroll"],
        device_label: agent.deviceLabel,
        rule_ids: ["system.enroll"]
      })
      await this.applyMovingRules(input.orgId, agent.id)
      const refreshed = (await this.listAgents(input.orgId)).find(
        (a) => a.id === agent.id
      )
      return { ...(refreshed || agent), replaced: true as const }
    }

    // Même empreinte d’installation (même extension) → re-enroll, pas un 2e agent.
    // Le label n’est PAS unique : Chrome + Edge avec le même nom = 2 agents.
    if (fp) {
      const { rows: byFp } = await this.pool.query(
        `SELECT id FROM agents WHERE org_id = $1 AND device_fingerprint = $2 LIMIT 1`,
        [input.orgId, fp]
      )
      if (byFp[0]) return rebind(byFp[0].id)
    }

    const agentId = newId("agt")
    const { rows } = await this.pool.query(
      `INSERT INTO agents (
         id, org_id, device_label, host_name, enrolled_at, token_hash, app_version,
         last_seen_at, user_id, license_assigned, unlicensed_since, personal_account,
         device_fingerprint, device_type
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$5,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [
        agentId,
        input.orgId,
        input.deviceLabel ?? null,
        input.hostName ?? null,
        now,
        tokenHash,
        input.appVersion ?? null,
        input.userId ?? null,
        personal ? assignLicense : false,
        personal && assignLicense ? null : now,
        personal,
        fp || null,
        dtype
      ]
    )
    const agent = { ...rowAgent(rows[0]), replaced: false as const }
    await this.pushSystemEvent(input.orgId, agent.id, "enroll", {
      device_label: agent.deviceLabel,
      rule_ids: ["system.enroll"]
    })
    await this.applyMovingRules(input.orgId, agent.id)
    const refreshed = (await this.listAgents(input.orgId)).find(
      (a) => a.id === agent.id
    )
    return { ...(refreshed || agent), replaced: false as const }
  }

  /** Groupe → siège auto si dispo */
  private async tryAssignLicenseForGroup(orgId: string, agentId: string) {
    const org = await this.getOrg(orgId)
    if (org?.isPersonal) return
    const { rows } = await this.pool.query(
      `SELECT * FROM agents WHERE org_id = $1 AND id = $2`,
      [orgId, agentId]
    )
    if (!rows[0] || !rows[0].group_id) return
    if (rows[0].license_assigned === true) return
    if (org?.licenseSeats && org.licenseSeats > 0) {
      const { rows: cnt } = await this.pool.query(
        `SELECT COUNT(*)::int AS n FROM agents
         WHERE org_id = $1 AND license_assigned = TRUE AND id <> $2`,
        [orgId, agentId]
      )
      if ((cnt[0]?.n || 0) >= org.licenseSeats) return
    }
    await this.pool.query(
      `UPDATE agents SET license_assigned = TRUE, unlicensed_since = NULL
       WHERE org_id = $1 AND id = $2`,
      [orgId, agentId]
    )
  }

  private async pushSystemEvent(
    orgId: string,
    agentId: string,
    decision: "enroll" | "unenroll",
    extra: Partial<DetectionEventInput> = {}
  ) {
    await this.appendEvents(orgId, agentId, [
      {
        schema_version: 1,
        client_event_id: `${decision}-${agentId}-${Date.now()}`,
        ts: new Date().toISOString(),
        source: "system",
        hostname: "opsgate-agent",
        decision,
        detection_count: 0,
        highest_severity: decision === "unenroll" ? "warning" : "low",
        rule_ids: extra.rule_ids || [`system.${decision}`],
        types: extra.types || [decision],
        masked: false,
        device_label: extra.device_label,
        exit_actor: extra.exit_actor,
        exit_admin_id: extra.exit_admin_id,
        exit_admin_label: extra.exit_admin_label
      }
    ])
  }

  async resolveAgentByToken(token: string): Promise<Agent | undefined> {
    const hash = hashToken(token)
    const { rows } = await this.pool.query(
      `UPDATE agents SET last_seen_at = NOW() WHERE token_hash = $1 RETURNING *`,
      [hash]
    )
    return rows[0] ? rowAgent(rows[0]) : undefined
  }

  async revokeAgentByToken(token: string): Promise<boolean> {
    const hash = hashToken(token)
    const { rows } = await this.pool.query(
      `SELECT * FROM agents WHERE token_hash = $1`,
      [hash]
    )
    if (!rows[0]) return false
    // Ne pas logger ici — recordUnenrollAndRevoke le fait avant
    const { rowCount } = await this.pool.query(
      `DELETE FROM agents WHERE token_hash = $1`,
      [hash]
    )
    return (rowCount ?? 0) > 0
  }

  async revokeAgentById(
    orgId: string,
    agentId: string,
    exit?: ExitActor
  ): Promise<boolean> {
    const { rows } = await this.pool.query(
      `SELECT * FROM agents WHERE id = $1 AND org_id = $2`,
      [agentId, orgId]
    )
    if (!rows[0]) return false
    const agent = rowAgent(rows[0])
    const exitActor =
      exit?.type === "admin"
        ? `admin:${exit.admin_label || exit.admin_id || "unknown"}`
        : exit?.type || "admin:console"
    // Event AVANT delete — agent_id passera à NULL (SET NULL), log conservé
    await this.pushSystemEvent(orgId, agentId, "unenroll", {
      types: ["unenroll", exitActor, "console_revoke"],
      device_label: agent.deviceLabel,
      rule_ids: ["system.unenroll"],
      exit_actor: exitActor,
      exit_admin_id: exit?.admin_id,
      exit_admin_label: exit?.admin_label
    })
    const { rowCount } = await this.pool.query(
      `DELETE FROM agents WHERE id = $1 AND org_id = $2`,
      [agentId, orgId]
    )
    return (rowCount ?? 0) > 0
  }

  async listAgents(orgId: string) {
    const { rows } = await this.pool.query(
      `SELECT * FROM agents WHERE org_id = $1 ORDER BY enrolled_at DESC`,
      [orgId]
    )
    return rows.map(rowAgent)
  }

  async appendEvents(
    orgId: string,
    agentId: string,
    events: DetectionEventInput[]
  ): Promise<AppendEventsResult> {
    const rejected: { index: number; reason: string }[] = []
    let accepted = 0
    const now = new Date().toISOString()

    for (let index = 0; index < events.length; index++) {
      const ev = events[index]
      const banned = ["prompt", "text", "content", "file_content"] as const
      let bad = false
      for (const key of banned) {
        if (key in (ev as object)) {
          rejected.push({ index, reason: `forbidden_field:${key}` })
          bad = true
          break
        }
      }
      if (bad) continue
      if (!ev.client_event_id || !ev.ts || !ev.hostname) {
        rejected.push({ index, reason: "missing_required_fields" })
        continue
      }

      // Normaliser sévérité (évite rejets côté consumers)
      let severity = ev.highest_severity || "low"
      if (ev.decision === "cancel") severity = "low"
      if (
        ev.decision === "unenroll" ||
        (ev.rule_ids || []).includes("system.unenroll")
      ) {
        severity = "warning"
      }

      try {
        const { rowCount } = await this.pool.query(
          `INSERT INTO detection_events (
            id, org_id, agent_id, client_event_id, ts, source, hostname, decision,
            detection_count, highest_severity, rule_ids, types, masked, file_names,
            device_label, exit_actor, exit_admin_id, exit_admin_label,
            schema_version, received_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13,$14::jsonb,$15,$16,$17,$18,$19,$20)
          ON CONFLICT (org_id, client_event_id) DO NOTHING`,
          [
            newId("evt"),
            orgId,
            agentId || null,
            ev.client_event_id,
            ev.ts,
            ev.source || "text",
            ev.hostname,
            ev.decision,
            ev.detection_count ?? 0,
            severity,
            JSON.stringify(ev.rule_ids || []),
            JSON.stringify(ev.types || []),
            ev.masked ?? null,
            ev.file_names ? JSON.stringify(ev.file_names) : null,
            ev.device_label ?? null,
            ev.exit_actor ?? null,
            ev.exit_admin_id ?? null,
            ev.exit_admin_label ?? null,
            ev.schema_version || 1,
            now
          ]
        )
        // DO NOTHING (duplicate) compte aussi comme accepté (idempotent)
        accepted++
        if (rowCount === 0) {
          /* duplicate — ok */
        } else {
          // Heartbeat last_seen (proxy / extension)
          try {
            await this.pool.query(
              `UPDATE agents SET last_seen_at = $2 WHERE id = $1 AND org_id = $3`,
              [agentId, now, orgId]
            )
          } catch {
            /* ignore */
          }
        }
      } catch (e) {
        const msg = String(e)
        // Si contrainte unique absente (migration partielle) : insert sans ON CONFLICT
        if (msg.includes("no unique") || msg.includes("ON CONFLICT")) {
          try {
            await this.pool.query(
              `INSERT INTO detection_events (
                id, org_id, agent_id, client_event_id, ts, source, hostname, decision,
                detection_count, highest_severity, rule_ids, types, masked, file_names,
                device_label, exit_actor, exit_admin_id, exit_admin_label,
                schema_version, received_at
              ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13,$14::jsonb,$15,$16,$17,$18,$19,$20)`,
              [
                newId("evt"),
                orgId,
                agentId || null,
                ev.client_event_id,
                ev.ts,
                ev.source || "text",
                ev.hostname,
                ev.decision,
                ev.detection_count ?? 0,
                severity,
                JSON.stringify(ev.rule_ids || []),
                JSON.stringify(ev.types || []),
                ev.masked ?? null,
                ev.file_names ? JSON.stringify(ev.file_names) : null,
                ev.device_label ?? null,
                ev.exit_actor ?? null,
                ev.exit_admin_id ?? null,
                ev.exit_admin_label ?? null,
                ev.schema_version || 1,
                now
              ]
            )
            accepted++
            continue
          } catch (e2) {
            rejected.push({ index, reason: String(e2) })
            continue
          }
        }
        console.error("[store:postgres] appendEvents failed", msg)
        rejected.push({ index, reason: msg })
      }
    }

    return { accepted, rejected }
  }

  async listEvents(orgId: string, limit = 50) {
    const { rows } = await this.pool.query(
      `SELECT * FROM detection_events WHERE org_id = $1 ORDER BY received_at DESC LIMIT $2`,
      [orgId, limit]
    )
    return rows.map(rowEvent)
  }

  async listOrgAiTools(orgId: string) {
    const { rows } = await this.pool.query(
      `SELECT * FROM org_ai_tools WHERE org_id = $1 ORDER BY tool ASC`,
      [orgId]
    )
    return rows.map((r) => ({
      orgId: r.org_id as string,
      tool: r.tool as string,
      displayName: r.display_name || undefined,
      status: (r.status || "unknown") as import("./types").OrgAiToolStatus,
      firstSeenAt: r.first_seen_at
        ? new Date(r.first_seen_at).toISOString()
        : null,
      lastSeenAt: r.last_seen_at
        ? new Date(r.last_seen_at).toISOString()
        : null,
      updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null,
      updatedBy: r.updated_by || null
    }))
  }

  async upsertOrgAiTool(
    orgId: string,
    input: {
      tool: string
      status: import("./types").OrgAiToolStatus
      displayName?: string
      updatedBy?: string
      touchSeen?: boolean
    }
  ) {
    const tool = String(input.tool || "")
      .trim()
      .toLowerCase()
      .replace(/^www\./, "")
    if (!tool) throw new Error("tool_required")
    const status =
      input.status === "authorized" || input.status === "unauthorized"
        ? input.status
        : "unknown"
    const now = new Date().toISOString()
    await this.pool.query(
      `INSERT INTO org_ai_tools (org_id, tool, display_name, status, first_seen_at, last_seen_at, updated_at, updated_by)
       VALUES ($1,$2,$3,$4,$5::timestamptz,$5::timestamptz,$5::timestamptz,$6)
       ON CONFLICT (org_id, tool) DO UPDATE SET
         status = EXCLUDED.status,
         display_name = COALESCE(EXCLUDED.display_name, org_ai_tools.display_name),
         updated_at = EXCLUDED.updated_at,
         updated_by = EXCLUDED.updated_by,
         last_seen_at = CASE
           WHEN $7::boolean THEN EXCLUDED.last_seen_at
           ELSE org_ai_tools.last_seen_at
         END,
         first_seen_at = COALESCE(org_ai_tools.first_seen_at, EXCLUDED.first_seen_at)`,
      [
        orgId,
        tool,
        input.displayName || null,
        status,
        now,
        input.updatedBy || null,
        !!input.touchSeen
      ]
    )
    const list = await this.listOrgAiTools(orgId)
    const hit = list.find((t) => t.tool === tool)
    if (!hit) throw new Error("upsert_failed")
    return hit
  }

  async purgeOldEvents(orgId: string, retentionDays: number) {
    if (!retentionDays || retentionDays < 7) return { deleted: 0 }
    const { rowCount } = await this.pool.query(
      `DELETE FROM detection_events
       WHERE org_id = $1
         AND COALESCE(ts, received_at) < NOW() - ($2 || ' days')::interval`,
      [orgId, String(retentionDays)]
    )
    return { deleted: rowCount || 0 }
  }

  async listLogExports(orgId: string) {
    await this.pool.query(
      `DELETE FROM log_exports WHERE org_id = $1 AND expires_at < NOW()`,
      [orgId]
    )
    const { rows } = await this.pool.query(
      `SELECT * FROM log_exports WHERE org_id = $1 ORDER BY created_at DESC LIMIT 20`,
      [orgId]
    )
    return rows.map(
      (r): import("./types").LogExportRecord => ({
        id: r.id,
        orgId: r.org_id,
        kind: r.kind,
        format: r.format,
        filename: r.filename,
        content: r.content,
        eventCount: r.event_count,
        fromTs: new Date(r.from_ts).toISOString(),
        toTs: new Date(r.to_ts).toISOString(),
        createdAt: new Date(r.created_at).toISOString(),
        expiresAt: new Date(r.expires_at).toISOString()
      })
    )
  }

  async getLogExport(orgId: string, exportId: string) {
    const { rows } = await this.pool.query(
      `SELECT * FROM log_exports WHERE org_id = $1 AND id = $2 AND expires_at > NOW()`,
      [orgId, exportId]
    )
    if (!rows[0]) return undefined
    const r = rows[0]
    return {
      id: r.id,
      orgId: r.org_id,
      kind: r.kind,
      format: r.format,
      filename: r.filename,
      content: r.content,
      eventCount: r.event_count,
      fromTs: new Date(r.from_ts).toISOString(),
      toTs: new Date(r.to_ts).toISOString(),
      createdAt: new Date(r.created_at).toISOString(),
      expiresAt: new Date(r.expires_at).toISOString()
    } as import("./types").LogExportRecord
  }

  async saveLogExport(
    orgId: string,
    input: Omit<
      import("./types").LogExportRecord,
      "id" | "orgId" | "createdAt"
    >
  ) {
    const id = newId("lexp")
    const now = new Date().toISOString()
    const content =
      input.content.length > 1_500_000
        ? input.content.slice(0, 1_500_000) + "\n…truncated"
        : input.content
    await this.pool.query(
      `INSERT INTO log_exports (
        id, org_id, kind, format, filename, content, event_count,
        from_ts, to_ts, created_at, expires_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        id,
        orgId,
        input.kind,
        input.format,
        input.filename,
        content,
        input.eventCount,
        input.fromTs,
        input.toTs,
        now,
        input.expiresAt
      ]
    )
    // garder 12 max
    await this.pool.query(
      `DELETE FROM log_exports
       WHERE org_id = $1 AND id NOT IN (
         SELECT id FROM log_exports WHERE org_id = $1
         ORDER BY created_at DESC LIMIT 12
       )`,
      [orgId]
    )
    return {
      id,
      orgId,
      kind: input.kind,
      format: input.format,
      filename: input.filename,
      content,
      eventCount: input.eventCount,
      fromTs: input.fromTs,
      toTs: input.toTs,
      createdAt: now,
      expiresAt: input.expiresAt
    }
  }

  async listRecoveryCodes(orgId: string) {
    // Actifs (pool valide) + consommés (audit). Les invalidés non utilisés sont purgés.
    const { rows } = await this.pool.query(
      `SELECT * FROM recovery_codes
       WHERE org_id = $1
         AND (consumed_at IS NOT NULL OR (active = TRUE AND consumed_at IS NULL))
       ORDER BY created_at DESC`,
      [orgId]
    )
    return rows.map(
      (r): import("./types").RecoveryCode => ({
        id: r.id,
        orgId: r.org_id,
        codeHash: r.code_hash,
        label: r.label ?? undefined,
        createdAt: new Date(r.created_at).toISOString(),
        consumedAt: r.consumed_at
          ? new Date(r.consumed_at).toISOString()
          : null,
        consumedAgentId: r.consumed_agent_id ?? null,
        active: !!r.active
      })
    )
  }

  async generateRecoveryCodes(orgId: string, count: number, label?: string) {
    const n = Math.min(50, Math.max(1, Math.floor(count) || 20))
    const plain: { id: string; code: string }[] = []
    const now = new Date().toISOString()
    const lbl = label || `batch-${now.slice(0, 10)}`
    for (let i = 0; i < n; i++) {
      const code = generateRecoveryCode()
      const id = newId("rc")
      await this.pool.query(
        `INSERT INTO recovery_codes (id, org_id, code_hash, label, created_at, active)
         VALUES ($1,$2,$3,$4,$5,true)`,
        [id, orgId, hashRecoveryCode(code), lbl, now]
      )
      plain.push({ id, code })
    }
    return { codes: plain, created: plain.length }
  }

  async getActiveRecoveryCodeHashes(orgId: string) {
    const { rows } = await this.pool.query(
      `SELECT id, code_hash FROM recovery_codes
       WHERE org_id = $1 AND active = TRUE AND consumed_at IS NULL`,
      [orgId]
    )
    return rows.map((r) => ({ id: r.id as string, hash: r.code_hash as string }))
  }

  async consumeRecoveryCode(orgId: string, codeId: string, agentId: string) {
    const { rowCount } = await this.pool.query(
      `UPDATE recovery_codes
       SET active = FALSE, consumed_at = NOW(), consumed_agent_id = $3
       WHERE org_id = $1 AND id = $2 AND active = TRUE AND consumed_at IS NULL`,
      [orgId, codeId, agentId]
    )
    return (rowCount || 0) > 0
  }

  async revokeRecoveryPool(orgId: string) {
    // Invalider le pool = effacer TOUS les codes (actifs + utilisés).
    const { rowCount } = await this.pool.query(
      `DELETE FROM recovery_codes WHERE org_id = $1`,
      [orgId]
    )
    return { revoked: rowCount || 0 }
  }

  private mapInboxRow(r: pg.QueryResultRow): import("./types").UserInboxMessage {
    return {
      id: r.id,
      orgId: r.org_id,
      agentId: r.agent_id,
      deviceLabel: r.device_label || "",
      hostName: r.host_name ?? null,
      category: (r.category || "question") as import("./types").InboxMessageCategory,
      subject: r.subject,
      body: r.body,
      contextUrl: r.context_url ?? null,
      contextHostname: r.context_hostname ?? null,
      status: (r.status || "open") as import("./types").InboxMessageStatus,
      createdAt: new Date(r.created_at).toISOString(),
      readAt: r.read_at ? new Date(r.read_at).toISOString() : null,
      repliedAt: r.replied_at ? new Date(r.replied_at).toISOString() : null,
      closedAt: r.closed_at ? new Date(r.closed_at).toISOString() : null,
      adminReply: r.admin_reply ?? null,
      repliedByAdminId: r.replied_by_admin_id ?? null,
      repliedByAdminLabel: r.replied_by_admin_label ?? null,
      userAckedAt: r.user_acked_at
        ? new Date(r.user_acked_at).toISOString()
        : null
    }
  }

  async createInboxMessage(input: {
    orgId: string
    agentId: string
    deviceLabel?: string
    hostName?: string | null
    category?: import("./types").InboxMessageCategory
    subject: string
    body: string
    contextUrl?: string | null
    contextHostname?: string | null
  }) {
    const subject = (input.subject || "").trim().slice(0, 120)
    const body = (input.body || "").trim().slice(0, 4000)
    if (subject.length < 3) {
      return { ok: false as const, error: "subject_too_short" }
    }
    if (body.length < 5) {
      return { ok: false as const, error: "body_too_short" }
    }
    const { rows: cntRows } = await this.pool.query(
      `SELECT COUNT(*)::int AS n FROM user_inbox_messages
       WHERE org_id = $1 AND agent_id = $2
         AND created_at >= NOW() - interval '24 hours'`,
      [input.orgId, input.agentId]
    )
    if ((cntRows[0]?.n as number) >= 15) {
      return { ok: false as const, error: "rate_limited" }
    }
    const allowed: import("./types").InboxMessageCategory[] = [
      "question",
      "exception",
      "block_appeal",
      "other"
    ]
    const cat = input.category || "question"
    const category = allowed.includes(cat) ? cat : "question"
    const id = newId("inbox")
    const now = new Date().toISOString()
    await this.pool.query(
      `INSERT INTO user_inbox_messages (
         id, org_id, agent_id, device_label, host_name, category,
         subject, body, context_url, context_hostname, status, created_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'open',$11)`,
      [
        id,
        input.orgId,
        input.agentId,
        (input.deviceLabel || "").trim() || "agent",
        input.hostName ?? null,
        category,
        subject,
        body,
        input.contextUrl?.trim() || null,
        input.contextHostname?.trim() || null,
        now
      ]
    )
    const msg = await this.getInboxMessage(input.orgId, id)
    if (!msg) return { ok: false as const, error: "create_failed" }
    return { ok: true as const, message: msg }
  }

  async listInboxMessages(
    orgId: string,
    opts?: {
      status?: import("./types").InboxMessageStatus | "all" | "unread"
      limit?: number
      agentId?: string
    }
  ) {
    const limit = Math.min(200, Math.max(1, opts?.limit || 50))
    const params: unknown[] = [orgId]
    let where = `org_id = $1`
    if (opts?.agentId) {
      params.push(opts.agentId)
      where += ` AND agent_id = $${params.length}`
    }
    const st = opts?.status || "all"
    if (st === "unread") {
      where += ` AND status = 'open'`
    } else if (st !== "all") {
      params.push(st)
      where += ` AND status = $${params.length}`
    }
    params.push(limit)
    const { rows } = await this.pool.query(
      `SELECT * FROM user_inbox_messages
       WHERE ${where}
       ORDER BY created_at DESC
       LIMIT $${params.length}`,
      params
    )
    return rows.map((r) => this.mapInboxRow(r))
  }

  async getInboxMessage(orgId: string, messageId: string) {
    const { rows } = await this.pool.query(
      `SELECT * FROM user_inbox_messages WHERE org_id = $1 AND id = $2`,
      [orgId, messageId]
    )
    return rows[0] ? this.mapInboxRow(rows[0]) : undefined
  }

  async markInboxRead(orgId: string, messageId: string) {
    await this.pool.query(
      `UPDATE user_inbox_messages
       SET status = CASE WHEN status = 'open' THEN 'read' ELSE status END,
           read_at = COALESCE(read_at, NOW())
       WHERE org_id = $1 AND id = $2`,
      [orgId, messageId]
    )
    return this.getInboxMessage(orgId, messageId)
  }

  async replyInboxMessage(
    orgId: string,
    messageId: string,
    reply: string,
    admin: { id: string; label: string }
  ) {
    const text = (reply || "").trim().slice(0, 4000)
    if (text.length < 1) return undefined
    const { rowCount } = await this.pool.query(
      `UPDATE user_inbox_messages
       SET status = 'replied',
           admin_reply = $3,
           replied_at = NOW(),
           read_at = COALESCE(read_at, NOW()),
           replied_by_admin_id = $4,
           replied_by_admin_label = $5,
           user_acked_at = NULL
       WHERE org_id = $1 AND id = $2`,
      [orgId, messageId, text, admin.id, admin.label]
    )
    if (!rowCount) return undefined
    return this.getInboxMessage(orgId, messageId)
  }

  async ackInboxMessage(orgId: string, messageId: string, agentId: string) {
    const { rowCount } = await this.pool.query(
      `UPDATE user_inbox_messages
       SET user_acked_at = NOW()
       WHERE org_id = $1 AND id = $2 AND agent_id = $3
         AND admin_reply IS NOT NULL AND admin_reply <> ''`,
      [orgId, messageId, agentId]
    )
    if (!rowCount) {
      return this.getInboxMessage(orgId, messageId)
    }
    return this.getInboxMessage(orgId, messageId)
  }

  async listPendingAdminReplies(orgId: string, agentId: string) {
    const { rows } = await this.pool.query(
      `SELECT * FROM user_inbox_messages
       WHERE org_id = $1 AND agent_id = $2
         AND admin_reply IS NOT NULL AND admin_reply <> ''
         AND user_acked_at IS NULL
       ORDER BY COALESCE(replied_at, created_at) DESC`,
      [orgId, agentId]
    )
    return rows.map((r) => this.mapInboxRow(r))
  }

  async closeInboxMessage(orgId: string, messageId: string) {
    const cur = await this.getInboxMessage(orgId, messageId)
    if (!cur) return undefined
    const systemClose =
      "Votre demande a été clôturée par l'administrateur (sans message de réponse)."
    const hadReply = !!(cur.adminReply && cur.adminReply.trim())
    const { rowCount } = await this.pool.query(
      `UPDATE user_inbox_messages
       SET status = 'closed',
           closed_at = NOW(),
           read_at = COALESCE(read_at, NOW()),
           admin_reply = CASE
             WHEN admin_reply IS NULL OR trim(admin_reply) = '' THEN $3
             ELSE admin_reply
           END,
           replied_at = CASE
             WHEN admin_reply IS NULL OR trim(admin_reply) = '' THEN NOW()
             ELSE replied_at
           END,
           replied_by_admin_label = CASE
             WHEN admin_reply IS NULL OR trim(admin_reply) = ''
               THEN COALESCE(replied_by_admin_label, 'Administrateur')
             ELSE replied_by_admin_label
           END,
           user_acked_at = CASE
             WHEN admin_reply IS NULL OR trim(admin_reply) = '' THEN NULL
             ELSE user_acked_at
           END
       WHERE org_id = $1 AND id = $2`,
      [orgId, messageId, systemClose]
    )
    if (!rowCount) return undefined
    void hadReply
    return this.getInboxMessage(orgId, messageId)
  }

  async countInboxUnread(orgId: string) {
    const { rows } = await this.pool.query(
      `SELECT COUNT(*)::int AS n FROM user_inbox_messages
       WHERE org_id = $1 AND status = 'open'`,
      [orgId]
    )
    return (rows[0]?.n as number) || 0
  }

  private parseMovingConditions(
    r: pg.QueryResultRow
  ): import("./types").MovingCondition[] {
    let parsed: import("./types").MovingCondition[] = []
    try {
      const raw = r.conditions_json
      if (raw) {
        const j = typeof raw === "string" ? JSON.parse(raw) : raw
        if (Array.isArray(j) && j.length > 0) {
          parsed = j
            .filter((c: { value?: string }) => c?.value?.trim())
            .map(
              (c: {
                field: import("./types").MovingMatchField
                op: import("./types").MovingMatchOp
                value: string
              }) => ({
                field: c.field,
                op: c.op,
                value: String(c.value).trim()
              })
            )
        }
      }
    } catch {
      /* legacy */
    }
    if (parsed.length === 0 && r.match_field && r.match_op && r.match_value) {
      parsed = [
        {
          field: r.match_field,
          op: r.match_op,
          value: r.match_value
        }
      ]
    }
    return parsed
  }

  private normalizeMovingConditions(input: {
    conditions?: import("./types").MovingCondition[]
    matchField?: import("./types").MovingMatchField
    matchOp?: import("./types").MovingMatchOp
    matchValue?: string
  }): import("./types").MovingCondition[] {
    if (input.conditions && input.conditions.length > 0) {
      return input.conditions
        .filter((c) => c.value?.trim())
        .map((c) => ({
          field: c.field,
          op: c.op,
          value: c.value.trim()
        }))
    }
    if (input.matchField && input.matchOp && input.matchValue?.trim()) {
      return [
        {
          field: input.matchField,
          op: input.matchOp,
          value: input.matchValue.trim()
        }
      ]
    }
    return []
  }

  async listMovingRules(orgId: string) {
    const { rows } = await this.pool.query(
      `SELECT * FROM moving_rules WHERE org_id = $1 ORDER BY priority ASC, created_at ASC`,
      [orgId]
    )
    return rows.map((r) => {
      const conditions = this.parseMovingConditions(r)
      const first = conditions[0] || {
        field: r.match_field,
        op: r.match_op,
        value: r.match_value
      }
      const permanent = r.permanent === true
      const logic = r.condition_logic === "or" ? "or" : "and"
      return {
        id: r.id,
        orgId: r.org_id,
        name: r.name,
        enabled: r.enabled !== false,
        conditions,
        conditionLogic: logic as "and" | "or",
        matchField: first.field,
        matchOp: first.op,
        matchValue: first.value,
        targetGroupId: r.target_group_id,
        priority: r.priority ?? 100,
        onlyIfUnassigned: permanent ? false : r.only_if_unassigned === true,
        permanent,
        createdAt: new Date(r.created_at).toISOString(),
        updatedAt: new Date(r.updated_at).toISOString()
      }
    })
  }

  async upsertMovingRule(
    orgId: string,
    input: {
      id?: string
      name: string
      enabled?: boolean
      conditions?: import("./types").MovingCondition[]
      matchField?: import("./types").MovingMatchField
      matchOp?: import("./types").MovingMatchOp
      matchValue?: string
      targetGroupId: string
      priority?: number
      onlyIfUnassigned?: boolean
      conditionLogic?: import("./types").MovingConditionLogic
      permanent?: boolean
    }
  ) {
    const org = await this.getOrg(orgId)
    if (!org) return undefined
    const conditions = this.normalizeMovingConditions(input)
    if (conditions.length === 0) return undefined
    const first = conditions[0]
    const condJson = JSON.stringify(conditions)
    const now = new Date().toISOString()
    const permanent = input.permanent === true
    const onlyUnassigned = permanent
      ? false
      : input.onlyIfUnassigned === true
    const logic = input.conditionLogic === "or" ? "or" : "and"
    // Soft columns
    await this.pool
      .query(
        `ALTER TABLE moving_rules ADD COLUMN IF NOT EXISTS condition_logic TEXT NOT NULL DEFAULT 'and'`
      )
      .catch(() => undefined)
    await this.pool
      .query(
        `ALTER TABLE moving_rules ADD COLUMN IF NOT EXISTS permanent BOOLEAN NOT NULL DEFAULT FALSE`
      )
      .catch(() => undefined)
    if (input.id) {
      const { rows } = await this.pool.query(
        `UPDATE moving_rules SET
          name=$3, enabled=$4, match_field=$5, match_op=$6, match_value=$7,
          conditions_json=$8, target_group_id=$9, priority=$10,
          only_if_unassigned=$11, updated_at=$12,
          condition_logic=$13, permanent=$14
         WHERE org_id=$1 AND id=$2 RETURNING *`,
        [
          orgId,
          input.id,
          input.name,
          input.enabled !== false,
          first.field,
          first.op,
          first.value,
          condJson,
          input.targetGroupId,
          input.priority ?? 100,
          onlyUnassigned,
          now,
          logic,
          permanent
        ]
      )
      if (!rows[0]) return undefined
      return (await this.listMovingRules(orgId)).find((r) => r.id === input.id)
    }
    const id = newId("mvr")
    try {
      await this.pool.query(
        `INSERT INTO moving_rules (id, org_id, name, enabled, match_field, match_op, match_value, conditions_json, target_group_id, priority, only_if_unassigned, created_at, updated_at, condition_logic, permanent)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12,$13,$14)`,
        [
          id,
          orgId,
          input.name,
          input.enabled !== false,
          first.field,
          first.op,
          first.value,
          condJson,
          input.targetGroupId,
          input.priority ?? 100,
          onlyUnassigned,
          now,
          logic,
          permanent
        ]
      )
    } catch {
      await this.pool.query(
        `INSERT INTO moving_rules (id, org_id, name, enabled, match_field, match_op, match_value, conditions_json, target_group_id, priority, only_if_unassigned, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12)`,
        [
          id,
          orgId,
          input.name,
          input.enabled !== false,
          first.field,
          first.op,
          first.value,
          condJson,
          input.targetGroupId,
          input.priority ?? 100,
          onlyUnassigned,
          now
        ]
      )
    }
    return (await this.listMovingRules(orgId)).find((r) => r.id === id)
  }

  async deleteMovingRule(orgId: string, ruleId: string) {
    const { rowCount } = await this.pool.query(
      `DELETE FROM moving_rules WHERE org_id = $1 AND id = $2`,
      [orgId, ruleId]
    )
    return (rowCount ?? 0) > 0
  }

  private matchMovingRule(
    value: string,
    op: string,
    pattern: string
  ): boolean {
    const v = value || ""
    const p = pattern || ""
    switch (op) {
      case "starts_with":
        return v.toLowerCase().startsWith(p.toLowerCase())
      case "contains":
        return v.toLowerCase().includes(p.toLowerCase())
      case "equals":
        return v.toLowerCase() === p.toLowerCase()
      case "regex":
        try {
          return new RegExp(p, "i").test(v)
        } catch {
          return false
        }
      default:
        return false
    }
  }

  private ruleMatchesAgent(
    rule: import("./types").MovingRule,
    agent: { deviceLabel?: string; hostName?: string }
  ): boolean {
    const conds =
      rule.conditions?.length > 0
        ? rule.conditions
        : [
            {
              field: rule.matchField,
              op: rule.matchOp,
              value: rule.matchValue
            }
          ]
    const matchOne = (c: import("./types").MovingCondition) => {
      const label = agent.deviceLabel || ""
      const host = agent.hostName || ""
      if (c.field === "host_name") {
        return (
          this.matchMovingRule(host, c.op, c.value) ||
          this.matchMovingRule(label, c.op, c.value)
        )
      }
      return (
        this.matchMovingRule(label, c.op, c.value) ||
        this.matchMovingRule(host, c.op, c.value)
      )
    }
    if (rule.conditionLogic === "or") return conds.some(matchOne)
    return conds.every(matchOne)
  }

  async applyMovingRules(orgId: string, agentId: string) {
    const agents = await this.listAgents(orgId)
    const agent = agents.find((a) => a.id === agentId)
    if (!agent) return { applied: false as const }
    const rules = (await this.listMovingRules(orgId)).filter((r) => r.enabled)
    for (const rule of rules) {
      if (!rule.permanent && rule.onlyIfUnassigned && agent.groupId) {
        continue
      }
      if (!this.ruleMatchesAgent(rule, agent)) continue
      const groups = await this.listGroups(orgId)
      const group = groups.find((g) => g.id === rule.targetGroupId)
      if (!group) continue
      const profileId = group.policyProfileId || null
      await this.pool.query(
        `UPDATE agents SET group_id = $3, policy_profile_id = COALESCE($4, policy_profile_id), last_seen_at = NOW()
         WHERE org_id = $1 AND id = $2`,
        [orgId, agentId, group.id, profileId]
      )
      await this.tryAssignLicenseForGroup(orgId, agentId)
      return {
        applied: true as const,
        ruleId: rule.id,
        groupId: group.id
      }
    }
    return { applied: false as const }
  }

  async importAgentsCsv(
    orgId: string,
    rows: Array<{
      agent_id?: string
      device_label?: string
      host_name?: string
      group_name?: string
      group_id?: string
      profile_name?: string
      profile_id?: string
      license?: boolean | null
    }>,
    opts?: { dryRun?: boolean }
  ) {
    const dry = !!opts?.dryRun
    const agents = await this.listAgents(orgId)
    const groups = await this.listGroups(orgId)
    const profiles = await this.listProfiles(orgId)
    let matched = 0
    let updated = 0
    let skipped = 0
    const errors: string[] = []
    const preview: Array<{ agent_id: string; changes: string[] }> = []

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!
      const line = i + 2
      let agent =
        (row.agent_id && agents.find((a) => a.id === row.agent_id)) ||
        undefined
      if (!agent && row.device_label?.trim()) {
        const lab = row.device_label.trim().toLowerCase()
        agent = agents.find(
          (a) => (a.deviceLabel || "").toLowerCase() === lab
        )
      }
      if (!agent && row.host_name?.trim()) {
        const h = row.host_name.trim().toLowerCase()
        agent = agents.find((a) => (a.hostName || "").toLowerCase() === h)
      }
      if (!agent) {
        skipped++
        errors.push(`L${line}: agent introuvable`)
        continue
      }
      matched++
      const changes: string[] = []
      let groupId: string | null | undefined =
        row.group_id !== undefined ? row.group_id.trim() || null : undefined
      if (groupId === undefined && row.group_name?.trim()) {
        const g = groups.find(
          (x) => x.name.toLowerCase() === row.group_name!.trim().toLowerCase()
        )
        if (!g) errors.push(`L${line}: groupe « ${row.group_name} » inconnu`)
        else groupId = g.id
      }
      let profileId: string | null | undefined =
        row.profile_id !== undefined
          ? row.profile_id.trim() || null
          : undefined
      if (profileId === undefined && row.profile_name?.trim()) {
        const p = profiles.find(
          (x) =>
            x.name.toLowerCase() === row.profile_name!.trim().toLowerCase()
        )
        if (!p) errors.push(`L${line}: profil « ${row.profile_name} » inconnu`)
        else profileId = p.id
      }
      if (groupId !== undefined) {
        changes.push(`group=${groupId ?? "null"}`)
        if (!dry) {
          const g = groups.find((x) => x.id === groupId)
          const autoProfile =
            profileId === undefined ? g?.policyProfileId || null : profileId
          await this.pool.query(
            `UPDATE agents SET group_id = $3,
               policy_profile_id = COALESCE($4, policy_profile_id),
               last_seen_at = NOW()
             WHERE org_id = $1 AND id = $2`,
            [orgId, agent.id, groupId, autoProfile]
          )
          if (groupId) await this.tryAssignLicenseForGroup(orgId, agent.id)
        }
      }
      if (profileId !== undefined) {
        changes.push(`profile=${profileId ?? "null"}`)
        if (!dry) {
          await this.pool.query(
            `UPDATE agents SET policy_profile_id = $3, last_seen_at = NOW()
             WHERE org_id = $1 AND id = $2`,
            [orgId, agent.id, profileId]
          )
        }
      }
      if (row.license === true || row.license === false) {
        changes.push(`license=${row.license}`)
        if (!dry) {
          await this.pool.query(
            `UPDATE agents SET license_assigned = $3,
               unlicensed_since = CASE WHEN $3 THEN NULL ELSE NOW() END
             WHERE org_id = $1 AND id = $2`,
            [orgId, agent.id, row.license]
          )
        }
      }
      if (changes.length) {
        updated++
        preview.push({ agent_id: agent.id, changes })
      } else skipped++
    }
    return {
      matched,
      updated,
      skipped,
      errors: errors.slice(0, 50),
      preview: dry ? preview.slice(0, 40) : undefined
    }
  }

  async bulkAssignAgents(
    orgId: string,
    agentIds: string[],
    opts: { policyProfileId?: string | null; groupId?: string | null }
  ) {
    let updated = 0
    let profileId = opts.policyProfileId
    if (opts.groupId) {
      const g = (await this.listGroups(orgId)).find((x) => x.id === opts.groupId)
      if (g?.policyProfileId && profileId === undefined) {
        profileId = g.policyProfileId
      }
    }
    for (const agentId of agentIds) {
      const sets: string[] = []
      const params: unknown[] = [orgId, agentId]
      if (opts.groupId !== undefined) {
        params.push(opts.groupId || null)
        sets.push(`group_id = $${params.length}`)
        if (opts.groupId) {
          // licence auto si sièges (appliqué après update)
        } else {
          // retrait groupe → retrait licence
          sets.push(`license_assigned = FALSE`)
          sets.push(
            `unlicensed_since = COALESCE(unlicensed_since, NOW())`
          )
        }
      }
      if (profileId !== undefined) {
        params.push(profileId)
        sets.push(`policy_profile_id = $${params.length}`)
      }
      if (!sets.length) continue
      sets.push("last_seen_at = NOW()")
      const { rowCount } = await this.pool.query(
        `UPDATE agents SET ${sets.join(", ")} WHERE org_id = $1 AND id = $2`,
        params
      )
      if ((rowCount ?? 0) > 0) {
        updated++
        if (opts.groupId) {
          await this.tryAssignLicenseForGroup(orgId, agentId)
        }
      }
    }
    if (updated > 0) await this.forceConfigSync(orgId)
    return { updated }
  }

  private async ensureAuditWormColumns() {
    try {
      await this.pool.query(`
        ALTER TABLE admin_audit_events
          ADD COLUMN IF NOT EXISTS seq BIGINT,
          ADD COLUMN IF NOT EXISTS entry_hash TEXT,
          ADD COLUMN IF NOT EXISTS prev_hash TEXT
      `)
      await this.pool.query(`
        CREATE INDEX IF NOT EXISTS admin_audit_org_seq_idx
          ON admin_audit_events(org_id, seq DESC)
      `)
    } catch {
      /* ignore si pas de droits ALTER */
    }
  }

  async appendAdminAudit(input: {
    orgId: string
    adminId?: string
    adminEmail?: string
    adminLabel?: string
    action: import("./types").AdminAuditAction
    detail?: string
    meta?: Record<string, unknown>
  }) {
    await this.ensureAuditWormColumns()
    const {
      AUDIT_GENESIS,
      computeAuditEntryHash
    } = await import("./audit-worm")
    const id = newId("aud")
    const createdAt = new Date().toISOString()
    // Dernière entrée WORM de l’org (seq max)
    const { rows: lastRows } = await this.pool.query(
      `SELECT seq, entry_hash FROM admin_audit_events
       WHERE org_id = $1 AND entry_hash IS NOT NULL
       ORDER BY seq DESC NULLS LAST, created_at DESC
       LIMIT 1`,
      [input.orgId]
    )
    const lastSeq = lastRows[0]?.seq != null ? Number(lastRows[0].seq) : 0
    const seq = lastSeq + 1
    const prevHash = lastRows[0]?.entry_hash || AUDIT_GENESIS
    const entryHash = computeAuditEntryHash({
      prevHash,
      seq,
      id,
      orgId: input.orgId,
      action: input.action,
      detail: input.detail,
      adminId: input.adminId,
      createdAt
    })
    try {
      await this.pool.query(
        `INSERT INTO admin_audit_events
           (id, org_id, admin_id, admin_email, admin_label, action, detail, meta, created_at, seq, entry_hash, prev_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,to_timestamp($9/1000.0),$10,$11,$12)`,
        [
          id,
          input.orgId,
          input.adminId ?? null,
          input.adminEmail ?? null,
          input.adminLabel ?? null,
          input.action,
          input.detail ?? null,
          JSON.stringify(input.meta || {}),
          Date.parse(createdAt),
          seq,
          entryHash,
          prevHash
        ]
      )
    } catch {
      // Fallback sans colonnes WORM
      await this.pool.query(
        `INSERT INTO admin_audit_events (id, org_id, admin_id, admin_email, admin_label, action, detail, meta, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,NOW())`,
        [
          id,
          input.orgId,
          input.adminId ?? null,
          input.adminEmail ?? null,
          input.adminLabel ?? null,
          input.action,
          input.detail ?? null,
          JSON.stringify(input.meta || {})
        ]
      )
    }
  }

  async listAdminAudit(
    orgId: string,
    opts?: { limit?: number; action?: string }
  ) {
    const limit = opts?.limit || 100
    const params: unknown[] = [orgId]
    let sql = `SELECT * FROM admin_audit_events WHERE org_id = $1`
    if (opts?.action) {
      params.push(opts.action)
      sql += ` AND action = $2`
    }
    sql += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`
    params.push(limit)
    const { rows } = await this.pool.query(sql, params)
    return rows.map((r) => ({
      id: r.id,
      orgId: r.org_id,
      adminId: r.admin_id ?? undefined,
      adminEmail: r.admin_email ?? undefined,
      adminLabel: r.admin_label ?? undefined,
      action: r.action,
      detail: r.detail ?? undefined,
      meta: r.meta || {},
      createdAt: new Date(r.created_at).toISOString(),
      seq: r.seq != null ? Number(r.seq) : undefined,
      entryHash: r.entry_hash ?? undefined,
      prevHash: r.prev_hash ?? undefined
    }))
  }

  async listAdminAuditAsc(orgId: string, limit = 5000) {
    const { rows } = await this.pool.query(
      `SELECT * FROM admin_audit_events
       WHERE org_id = $1
       ORDER BY COALESCE(seq, 0) ASC, created_at ASC
       LIMIT $2`,
      [orgId, limit]
    )
    return rows.map((r) => ({
      id: r.id,
      orgId: r.org_id,
      adminId: r.admin_id ?? undefined,
      adminEmail: r.admin_email ?? undefined,
      adminLabel: r.admin_label ?? undefined,
      action: r.action as import("./types").AdminAuditAction,
      detail: r.detail ?? undefined,
      meta: r.meta || {},
      createdAt: new Date(r.created_at).toISOString(),
      seq: r.seq != null ? Number(r.seq) : undefined,
      entryHash: r.entry_hash ?? undefined,
      prevHash: r.prev_hash ?? undefined
    }))
  }

  async summary(orgId: string): Promise<OrgSummary> {
    const orgForMon = await this.getOrg(orgId)
    const { mergeMonitoringSettings } = await import("./types")
    const mon = mergeMonitoringSettings(orgForMon?.monitoring)
    await this.purgeOldEvents(orgId, mon.logRetentionDays)

    const agents = await this.listAgents(orgId)
    const { rows: countRows } = await this.pool.query(
      `SELECT COUNT(*)::int AS n FROM detection_events WHERE org_id = $1`,
      [orgId]
    )
    const { rows: decRows } = await this.pool.query(
      `SELECT decision, COUNT(*)::int AS n FROM detection_events WHERE org_id = $1 GROUP BY decision`,
      [orgId]
    )
    const byDecision: Record<string, number> = {}
    for (const r of decRows) byDecision[r.decision] = r.n

    const topRules: { rule_id: string; count: number }[] = []
    const { rows: ruleRows } = await this.pool.query(
      `SELECT jsonb_array_elements_text(rule_ids) AS rule_id, COUNT(*)::int AS n
       FROM detection_events WHERE org_id = $1
       GROUP BY rule_id ORDER BY n DESC LIMIT 5`,
      [orgId]
    )
    for (const r of ruleRows) {
      topRules.push({ rule_id: r.rule_id, count: r.n })
    }
    if (topRules.length === 0) {
      const { rows: typeRows } = await this.pool.query(
        `SELECT jsonb_array_elements_text(types) AS rule_id, COUNT(*)::int AS n
         FROM detection_events WHERE org_id = $1
         GROUP BY rule_id ORDER BY n DESC LIMIT 5`,
        [orgId]
      )
      for (const r of typeRows) {
        topRules.push({ rule_id: r.rule_id, count: r.n })
      }
    }

    const activePack = await this.getActivePack(orgId)
    const { rows: packCount } = await this.pool.query(
      `SELECT COUNT(*)::int AS n FROM rule_packs WHERE org_id = $1`,
      [orgId]
    )
    const admins = await this.listAdmins(orgId)
    const groups = await this.listGroups(orgId)
    const users = await this.listUsers(orgId)

    const {
      briefAgent,
      connectivityBuckets,
      findDuplicateFingerprints
    } = await import("./summary-helpers")
    const orgMon = await this.getOrg(orgId)
    const licenseStats = await this.getLicenseStats(orgId)
    const agents_licensed: import("./store-types").SummaryAgentBrief[] = []
    const agents_unlicensed: import("./store-types").SummaryAgentBrief[] = []
    const agents_grace: import("./store-types").SummaryAgentBrief[] = []
    const allBriefs: import("./store-types").SummaryAgentBrief[] = []
    let licensedN = 0
    let graceN = 0
    let unlicensedN = 0
    const licMap = new Map<string, boolean>()
    const scheduleMap = new Map<
      string,
      import("./types").WorkSchedule | null | undefined
    >()
    for (const a of agents) {
      licMap.set(a.id, await this.isAgentLicensed(orgId, a.id))
      const eff = await this.getEffectivePolicyForAgent(orgId, a.id)
      scheduleMap.set(a.id, eff?.effective.workSchedule)
    }
    const conn = connectivityBuckets(
      agents,
      orgMon?.monitoring,
      (a) => !!licMap.get(a.id),
      (a) => scheduleMap.get(a.id)
    )
    for (const a of agents) {
      const lic = !!licMap.get(a.id)
      const b = briefAgent(a, lic)
      allBriefs.push(b)
      if (b.license_status === "licensed") {
        licensedN++
        agents_licensed.push(b)
      } else if (b.license_status === "grace") {
        graceN++
        agents_grace.push(b)
      } else {
        unlicensedN++
        agents_unlicensed.push(b)
      }
    }

    const { rows: dayRows } = await this.pool.query(
      `SELECT to_char(date_trunc('day', ts AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
              COUNT(*)::int AS n
       FROM detection_events
       WHERE org_id = $1 AND ts >= NOW() - INTERVAL '14 days'
       GROUP BY 1 ORDER BY 1 ASC`,
      [orgId]
    )
    const dayMap = new Map<string, number>()
    for (let i = 13; i >= 0; i--) {
      const d = new Date()
      d.setUTCDate(d.getUTCDate() - i)
      dayMap.set(d.toISOString().slice(0, 10), 0)
    }
    for (const r of dayRows) {
      if (dayMap.has(r.day)) dayMap.set(r.day, r.n)
    }

    const { rows: inboxTopRows } = await this.pool.query(
      `SELECT agent_id,
              COALESCE(NULLIF(trim(max(device_label)), ''), left(agent_id, 10)) AS device_label,
              COUNT(*)::int AS n
       FROM user_inbox_messages
       WHERE org_id = $1
       GROUP BY agent_id
       ORDER BY n DESC
       LIMIT 8`,
      [orgId]
    ).catch(() => ({ rows: [] as Array<{ agent_id: string; device_label: string; n: number }> }))
    const top_inbox_requesters = inboxTopRows.map((r) => ({
      agent_id: r.agent_id as string,
      device_label: (r.device_label as string) || String(r.agent_id).slice(0, 10),
      count: (r.n as number) || 0
    }))

    return {
      org_id: orgId,
      agents: agents.length,
      events_total: countRows[0]?.n || 0,
      by_decision: byDecision,
      top_rules: topRules,
      top_inbox_requesters,
      active_rules_pack: activePack
        ? {
            version: activePack.version,
            rules_count: activePack.rules.length,
            checksum: activePack.checksum
          }
        : null,
      packs_published: packCount[0]?.n || 0,
      admins_count: admins.length,
      groups_count: groups.length,
      users_count: users.length,
      licenses: {
        licensed: licensedN,
        grace: graceN,
        unlicensed: unlicensedN,
        seats: licenseStats.seats,
        seats_used: licenseStats.seats_used,
        seats_available: licenseStats.seats_available
      },
      connectivity: conn,
      events_by_day: [...dayMap.entries()].map(([day, count]) => ({
        day,
        count
      })),
      agents_licensed,
      agents_unlicensed,
      agents_grace,
      agents_offline_long: conn.agents_offline_long || [],
      agents_stale: conn.agents_stale,
      agents_online: conn.agents_online,
      agents_maintenance: conn.agents_maintenance || [],
      duplicate_fingerprints: findDuplicateFingerprints(allBriefs)
    }
  }
}
