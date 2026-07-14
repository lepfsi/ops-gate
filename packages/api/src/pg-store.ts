import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import type { DetectionRule } from "@opsgate/engine"
import pg from "pg"

import {
  hashManagementPassword,
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

const { Pool } = pg

const __dirname = dirname(fileURLToPath(import.meta.url))

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
    createdAt: new Date(r.created_at).toISOString()
  }
}

function rowPolicy(r: pg.QueryResultRow): Policy {
  let userMessages: Policy["userMessages"]
  try {
    const raw = r.user_messages_json
    if (raw) {
      const j = typeof raw === "string" ? JSON.parse(raw) : raw
      if (j && typeof j === "object") userMessages = j
    }
  } catch {
    /* ignore */
  }
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
    updatedAt: new Date(r.updated_at).toISOString()
  }
}

function rowAgent(r: pg.QueryResultRow): Agent {
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
    deviceFingerprint: r.device_fingerprint ?? undefined
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
  return {
    id: r.id,
    orgId: r.org_id,
    label: r.label,
    email: r.email,
    passwordHash: r.password_hash,
    isPrincipal: !!r.is_principal,
    permissions: (r.permissions || []) as AdminPermission[],
    active: r.active !== false,
    mustChangePassword: !!r.must_change_password,
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
  let userMessages: PolicyProfile["userMessages"]
  try {
    const raw = r.user_messages_json
    if (raw) {
      const j = typeof raw === "string" ? JSON.parse(raw) : raw
      if (j && typeof j === "object") userMessages = j
    }
  } catch {
    /* ignore */
  }
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
    assignedGroupIds: r.assigned_group_ids || [],
    assignedUserIds: r.assigned_user_ids || [],
    userMessages,
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

  static async create(databaseUrl: string): Promise<PgStore> {
    const pool = new Pool({ connectionString: databaseUrl })
    const store = new PgStore(pool)
    await store.migrate()
    await store.ensureSeed()
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
      `ALTER TABLE admin_sessions ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`,
      // Nouveaux agents : pas de licence tant qu'aucun groupe (sauf assignation manuelle)
      `ALTER TABLE agents ALTER COLUMN license_assigned SET DEFAULT FALSE`,
      `ALTER TABLE policies ADD COLUMN IF NOT EXISTS user_messages_json TEXT NOT NULL DEFAULT '{}'`,
      `ALTER TABLE policy_profiles ADD COLUMN IF NOT EXISTS user_messages_json TEXT NOT NULL DEFAULT '{}'`,
      `ALTER TABLE agents ADD COLUMN IF NOT EXISTS device_fingerprint TEXT`
    ]
    for (const q of alters) {
      await this.pool.query(q)
    }
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
    console.log("[store:postgres] schema migrated (V1 full control plane)")
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
      await this.ensurePersonalOrg()
      // PERSONAL ne doit pas avoir d'admin console (même email que DEMO → login ambigu)
      await this.scrubPersonalConsoleAdmins()
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
        user_messages_json = $12
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
        JSON.stringify(next.userMessages || {})
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
    }
  ) {
    const org = await this.getOrg(orgId)
    if (!org) return undefined
    const now = new Date().toISOString()
    const email = input.email.trim().toLowerCase()
    if (!email.includes("@")) return undefined

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
      let mustChange =
        input.mustChangePassword !== undefined
          ? input.mustChangePassword
          : prev.mustChangePassword
      if (input.password) {
        const min = prev.isPrincipal ? 4 : 6
        if (input.password.length < min) return undefined
        passwordHash = hashManagementPassword(input.password)
        if (input.mustChangePassword === undefined) mustChange = false
      }
      const permissions = prev.isPrincipal
        ? ALL_ADMIN_PERMISSIONS
        : input.permissions ?? prev.permissions
      const active = input.active !== undefined ? input.active : prev.active
      const label = input.label.trim() || prev.label

      const { rows: updated } = await this.pool.query(
        `UPDATE org_admins SET
          label=$3, email=$4, password_hash=$5, permissions=$6::jsonb,
          active=$7, must_change_password=$8, updated_at=$9
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
          now
        ]
      )
      if (prev.isPrincipal) {
        await this.pool.query(
          `UPDATE policies SET management_password_hash = $2 WHERE org_id = $1`,
          [orgId, passwordHash]
        )
      }
      await this.forceConfigSync(orgId)
      return rowAdmin(updated[0])
    }

    if (input.isPrincipal) return undefined
    if (!input.password || input.password.length < 6) return undefined
    const exists = await this.pool.query(
      `SELECT id FROM org_admins WHERE org_id = $1 AND email = $2`,
      [orgId, email]
    )
    if (exists.rows.length > 0) return undefined

    let permissions = input.permissions?.length
      ? input.permissions
      : (["console_access"] as AdminPermission[])
    if (!permissions.includes("console_access")) {
      permissions = ["console_access", ...permissions]
    }
    const id = newId("adm")
    const { rows } = await this.pool.query(
      `INSERT INTO org_admins (id, org_id, label, email, password_hash, is_principal, permissions, active, must_change_password, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,false,$6::jsonb,$7,false,$8,$8) RETURNING *`,
      [
        id,
        orgId,
        input.label.trim() || `admin`,
        email,
        hashManagementPassword(input.password),
        JSON.stringify(permissions),
        input.active !== false,
        now
      ]
    )
    await this.forceConfigSync(orgId)
    return rowAdmin(rows[0])
  }

  async deleteAdmin(orgId: string, adminId: string) {
    const { rows } = await this.pool.query(
      `SELECT * FROM org_admins WHERE org_id = $1 AND id = $2`,
      [orgId, adminId]
    )
    if (!rows[0] || rows[0].is_principal) return false
    await this.pool.query(`DELETE FROM admin_sessions WHERE admin_id = $1`, [
      adminId
    ])
    const { rowCount } = await this.pool.query(
      `DELETE FROM org_admins WHERE org_id = $1 AND id = $2 AND is_principal = FALSE`,
      [orgId, adminId]
    )
    if ((rowCount ?? 0) > 0) await this.forceConfigSync(orgId)
    return (rowCount ?? 0) > 0
  }

  /** Idle serveur 10 min sans heartbeat — évite lockout si onglet fermé sans logout. */
  private static readonly SESSION_IDLE_MS = 10 * 60 * 1000

  async createAdminSession(
    email: string,
    password: string,
    opts?: { force?: boolean }
  ) {
    const emailNorm = email.trim().toLowerCase()
    const hash = hashManagementPassword(password)
    // Préférer l'org non-personnelle si le même email existe plusieurs fois
    // (bug : principal seedé sur PERSONAL → console vide d'events DEMO)
    const { rows } = await this.pool.query(
      `SELECT a.*
       FROM org_admins a
       INNER JOIN organizations o ON o.id = a.org_id
       WHERE lower(a.email) = $1
         AND a.active = TRUE
         AND a.password_hash = $2
       ORDER BY CASE WHEN o.is_personal THEN 1 ELSE 0 END ASC,
                a.is_principal DESC,
                a.created_at ASC
       LIMIT 1`,
      [emailNorm, hash]
    )
    if (!rows[0]) return { ok: false as const, error: "invalid_credentials" }
    const admin = rowAdmin(rows[0])
    if (!admin.isPrincipal && !admin.permissions.includes("console_access")) {
      return { ok: false as const, error: "no_console_access" }
    }
    // Purge : expirées OU idle serveur (last_activity / created)
    const idleSec = Math.floor(PgStore.SESSION_IDLE_MS / 1000)
    await this.pool.query(
      `DELETE FROM admin_sessions
       WHERE expires_at < NOW()
          OR COALESCE(last_activity_at, created_at) < NOW() - ($1 || ' seconds')::interval`,
      [String(idleSec)]
    )
    const { rows: active } = await this.pool.query(
      `SELECT 1 FROM admin_sessions
       WHERE admin_id = $1 AND expires_at > NOW()
       LIMIT 1`,
      [admin.id]
    )
    let forced = false
    if (active[0]) {
      if (opts?.force) {
        await this.pool.query(`DELETE FROM admin_sessions WHERE admin_id = $1`, [
          admin.id
        ])
        forced = true
      } else {
        return { ok: false as const, error: "session_already_active" }
      }
    }
    const token = `ogs_${newToken().replace(/^ogt_/, "")}`
    const tokenHash = hashToken(token)
    const now = Date.now()
    const expiresAt = now + 12 * 60 * 60 * 1000
    await this.pool.query(
      `INSERT INTO admin_sessions (token_hash, org_id, admin_id, expires_at, created_at, last_activity_at)
       VALUES ($1,$2,$3,to_timestamp($4/1000.0),NOW(),NOW())`,
      [tokenHash, admin.orgId, admin.id, expiresAt]
    )
    const session: AdminSession = {
      token,
      orgId: admin.orgId,
      adminId: admin.id,
      expiresAt,
      createdAt: now,
      lastActivityAt: now
    }
    return { ok: true as const, session, admin, forced }
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
      lastActivityAt: now
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
      `SELECT * FROM policy_profiles WHERE org_id = $1 ORDER BY updated_at ASC`,
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
      assignedGroupIds?: string[]
      assignedUserIds?: string[]
      userMessages?: Partial<import("./types").PolicyUserMessages>
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
        assignedGroupIds: input.assignedGroupIds ?? prev.assignedGroupIds,
        assignedUserIds: input.assignedUserIds ?? prev.assignedUserIds,
        userMessages: nextMsgs
      }
      const { rows: updated } = await this.pool.query(
        `UPDATE policy_profiles SET
          name=$3, department=$4, default_action=$5, enabled_hosts=$6::jsonb,
          scan_uploads=$7, event_reporting=$8, protect_unenroll=$9,
          assigned_group_ids=$10::jsonb, assigned_user_ids=$11::jsonb,
          user_messages_json=$12, updated_at=$13
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
          now
        ]
      )
      const profile = rowProfile(updated[0])
      await this.applyProfileGroupAssignments(orgId, profile)
      await this.forceConfigSync(orgId)
      return profile
    }

    const id = newId("prof")
    const { rows } = await this.pool.query(
      `INSERT INTO policy_profiles (id, org_id, name, department, default_action, enabled_hosts, scan_uploads, event_reporting, protect_unenroll, assigned_group_ids, assigned_user_ids, user_messages_json, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10::jsonb,$11::jsonb,$12,$13) RETURNING *`,
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
        now
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

  private async resolveProfileForAgent(
    orgId: string,
    agent: Agent | undefined
  ): Promise<PolicyProfile | null> {
    if (!agent) return null
    const list = await this.listProfiles(orgId)
    if (agent.policyProfileId) {
      return list.find((p) => p.id === agent.policyProfileId) || null
    }
    if (agent.userId) {
      const users = await this.listUsers(orgId)
      const user = users.find((u) => u.id === agent.userId)
      if (user) {
        const byUser = list.find((p) =>
          (p.assignedUserIds || []).includes(user.id)
        )
        if (byUser) return byUser
        const groups = await this.listGroups(orgId)
        for (const gid of user.groupIds || []) {
          const byGroup = list.find((p) =>
            (p.assignedGroupIds || []).includes(gid)
          )
          if (byGroup) return byGroup
          const g = groups.find((x) => x.id === gid)
          if (g?.policyProfileId) {
            const p = list.find((x) => x.id === g.policyProfileId)
            if (p) return p
          }
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
          }
        }
      : {
          defaultAction: policy.defaultAction,
          enabledHosts: policy.enabledHosts,
          scanUploads: policy.scanUploads,
          eventReporting: policy.eventReporting,
          protectUnenroll: policy.protectUnenroll,
          userMessages: policy.userMessages || {}
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
    const graceMs = 5 * 60 * 1000
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

  async requestPasswordResetOtp(orgId: string) {
    const otp = newOtpCode(6)
    const expiresIn = 10 * 60
    await this.pool.query(
      `INSERT INTO password_reset_challenges (org_id, code_hash, expires_at, created_at)
       VALUES ($1, $2, to_timestamp($3/1000.0), NOW())
       ON CONFLICT (org_id) DO UPDATE SET
         code_hash = EXCLUDED.code_hash,
         expires_at = EXCLUDED.expires_at,
         created_at = NOW()`,
      [orgId, hashManagementPassword(otp), Date.now() + expiresIn * 1000]
    )
    console.log(
      `[opsgate-otp] org=${orgId} password-reset OTP=${otp} (dev — would email admin)`
    )
    return {
      ok: true as const,
      expires_in_sec: expiresIn,
      dev_otp: otp,
      message:
        "OTP généré (mode dev : affiché ici + logs API). Prod : envoi email admin."
    }
  }

  async confirmPasswordResetOtp(
    orgId: string,
    otp: string,
    newPassword: string,
    _adminId?: string
  ) {
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
    if (!newPassword || newPassword.length < 6) {
      return { ok: false as const, error: "password_too_short" }
    }
    const principal = await this.getPrincipalAdmin(orgId)
    if (!principal) return { ok: false as const, error: "principal_missing" }
    const hash = hashManagementPassword(newPassword)
    await this.pool.query(
      `UPDATE org_admins SET password_hash = $2, must_change_password = FALSE, updated_at = NOW()
       WHERE id = $1`,
      [principal.id, hash]
    )
    await this.updatePolicy(orgId, { managementPasswordHash: hash })
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

  async getActivePack(orgId: string) {
    const { rows } = await this.pool.query(
      `SELECT * FROM rule_packs WHERE org_id = $1 AND active = TRUE LIMIT 1`,
      [orgId]
    )
    if (rows[0]) return rowPack(rows[0])
    const { rows: all } = await this.pool.query(
      `SELECT * FROM rule_packs WHERE org_id = $1 ORDER BY published_at DESC LIMIT 1`,
      [orgId]
    )
    return all[0] ? rowPack(all[0]) : undefined
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
      const active = await this.getActivePack(input.orgId)
      if (!active) return { ok: false, errors: ["no_active_pack_to_clone"] }
      const disable = new Set(input.disableRuleIds || [])
      rules = active.rules.filter((r) => !disable.has(r.id))
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
      return { ok: true, pack, policy: nextPolicy }
    } catch (e) {
      await client.query("ROLLBACK")
      throw e
    } finally {
      client.release()
    }
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
  }): Promise<Agent & { replaced?: boolean }> {
    const now = new Date().toISOString()
    const tokenHash = hashToken(input.token)
    const label = (input.deviceLabel || "").trim()
    const fp = (input.deviceFingerprint || "").trim()
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
          fp || null
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

    // 1) Fingerprint stable (même install extension, label peut changer)
    if (fp) {
      const { rows: byFp } = await this.pool.query(
        `SELECT id FROM agents WHERE org_id = $1 AND device_fingerprint = $2 LIMIT 1`,
        [input.orgId, fp]
      )
      if (byFp[0]) return rebind(byFp[0].id)
    }

    // 2) Même label
    if (label) {
      const { rows: existing } = await this.pool.query(
        `SELECT id FROM agents
         WHERE org_id = $1 AND lower(trim(device_label)) = lower(trim($2))
         LIMIT 1`,
        [input.orgId, label]
      )
      if (existing[0]) return rebind(existing[0].id)
    }

    const agentId = newId("agt")
    const { rows } = await this.pool.query(
      `INSERT INTO agents (
         id, org_id, device_label, host_name, enrolled_at, token_hash, app_version,
         last_seen_at, user_id, license_assigned, unlicensed_since, personal_account,
         device_fingerprint
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$5,$8,$9,$10,$11,$12) RETURNING *`,
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
        fp || null
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
      return {
        id: r.id,
        orgId: r.org_id,
        name: r.name,
        enabled: r.enabled !== false,
        conditions,
        matchField: first.field,
        matchOp: first.op,
        matchValue: first.value,
        targetGroupId: r.target_group_id,
        priority: r.priority ?? 100,
        onlyIfUnassigned: r.only_if_unassigned !== false,
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
    }
  ) {
    const org = await this.getOrg(orgId)
    if (!org) return undefined
    const conditions = this.normalizeMovingConditions(input)
    if (conditions.length === 0) return undefined
    const first = conditions[0]
    const condJson = JSON.stringify(conditions)
    const now = new Date().toISOString()
    if (input.id) {
      const { rows } = await this.pool.query(
        `UPDATE moving_rules SET
          name=$3, enabled=$4, match_field=$5, match_op=$6, match_value=$7,
          conditions_json=$8, target_group_id=$9, priority=$10,
          only_if_unassigned=$11, updated_at=$12
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
          input.onlyIfUnassigned !== false,
          now
        ]
      )
      if (!rows[0]) return undefined
      return (await this.listMovingRules(orgId)).find((r) => r.id === input.id)
    }
    const id = newId("mvr")
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
        input.onlyIfUnassigned !== false,
        now
      ]
    )
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
    return conds.every((c) => {
      const fieldVal =
        c.field === "host_name" ? agent.hostName || "" : agent.deviceLabel || ""
      return this.matchMovingRule(fieldVal, c.op, c.value)
    })
  }

  async applyMovingRules(orgId: string, agentId: string) {
    const agents = await this.listAgents(orgId)
    const agent = agents.find((a) => a.id === agentId)
    if (!agent) return { applied: false as const }
    const rules = (await this.listMovingRules(orgId)).filter((r) => r.enabled)
    for (const rule of rules) {
      if (rule.onlyIfUnassigned && (agent.policyProfileId || agent.groupId)) {
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

  async appendAdminAudit(input: {
    orgId: string
    adminId?: string
    adminEmail?: string
    adminLabel?: string
    action: import("./types").AdminAuditAction
    detail?: string
    meta?: Record<string, unknown>
  }) {
    await this.pool.query(
      `INSERT INTO admin_audit_events (id, org_id, admin_id, admin_email, admin_label, action, detail, meta, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,NOW())`,
      [
        newId("aud"),
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
      createdAt: new Date(r.created_at).toISOString()
    }))
  }

  async summary(orgId: string): Promise<OrgSummary> {
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
      findDuplicateFingerprints,
      OFFLINE_LONG_MS
    } = await import("./summary-helpers")
    const licenseStats = await this.getLicenseStats(orgId)
    const agents_unlicensed: import("./store-types").SummaryAgentBrief[] = []
    const agents_grace: import("./store-types").SummaryAgentBrief[] = []
    const agents_offline_long: import("./store-types").SummaryAgentBrief[] = []
    const allBriefs: import("./store-types").SummaryAgentBrief[] = []
    let licensedN = 0
    let graceN = 0
    let unlicensedN = 0
    for (const a of agents) {
      const lic = await this.isAgentLicensed(orgId, a.id)
      const b = briefAgent(a, lic)
      allBriefs.push(b)
      if (b.license_status === "licensed") licensedN++
      else if (b.license_status === "grace") {
        graceN++
        agents_grace.push(b)
      } else {
        unlicensedN++
        agents_unlicensed.push(b)
      }
      if (b.offline_for_ms > OFFLINE_LONG_MS) agents_offline_long.push(b)
    }
    agents_offline_long.sort((a, b) => b.offline_for_ms - a.offline_for_ms)

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

    return {
      org_id: orgId,
      agents: agents.length,
      events_total: countRows[0]?.n || 0,
      by_decision: byDecision,
      top_rules: topRules,
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
      connectivity: connectivityBuckets(agents),
      events_by_day: [...dayMap.entries()].map(([day, count]) => ({
        day,
        count
      })),
      agents_unlicensed,
      agents_grace,
      agents_offline_long,
      duplicate_fingerprints: findDuplicateFingerprints(allBriefs)
    }
  }
}
