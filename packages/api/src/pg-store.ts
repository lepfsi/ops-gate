import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import type { DetectionRule } from "@opsgate/engine"
import pg from "pg"

import {
  hashManagementPassword,
  hashToken,
  newId,
  newOtpCode,
  newToken,
  PRINCIPAL_DEFAULT_PASSWORD,
  PRINCIPAL_SETUP_EMAIL
} from "./crypto"
import {
  buildGlobalRulesPack,
  bumpVersion,
  materializePack,
  toPayload,
  validateRules
} from "./rules-pack"
import type {
  ActivatePackResult,
  AppendEventsResult,
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
  PasswordResetChallenge,
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

function rowOrg(r: pg.QueryResultRow): Organization {
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    orgCode: r.org_code,
    modeDefault: r.mode_default,
    eventPayloadPolicy: r.event_payload_policy,
    primaryEmail: r.primary_email || PRINCIPAL_SETUP_EMAIL,
    createdAt: new Date(r.created_at).toISOString()
  }
}

function rowPolicy(r: pg.QueryResultRow): Policy {
  return {
    id: r.id,
    orgId: r.org_id,
    version: r.version,
    defaultAction: r.default_action,
    enabledHosts: r.enabled_hosts,
    scanUploads: r.scan_uploads,
    eventReporting: r.event_reporting,
    rulesPackVersion: r.rules_pack_version,
    managementPasswordHash: r.management_password_hash || "",
    protectUnenroll: !!r.protect_unenroll,
    configEpoch:
      typeof r.config_epoch === "number" ? r.config_epoch : r.version || 1,
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
    licenseAssigned: r.license_assigned !== false,
    personalAccount: !!r.personal_account
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

function rowEvent(r: pg.QueryResultRow): StoredEvent {
  return {
    id: r.id,
    orgId: r.org_id,
    agentId: r.agent_id,
    client_event_id: r.client_event_id,
    ts: new Date(r.ts).toISOString(),
    source: r.source,
    hostname: r.hostname,
    decision: r.decision,
    detection_count: r.detection_count,
    highest_severity: r.highest_severity,
    rule_ids: r.rule_ids || [],
    types: r.types || [],
    masked: r.masked ?? undefined,
    file_names: r.file_names ?? null,
    schema_version: r.schema_version,
    receivedAt: new Date(r.received_at).toISOString()
  }
}

export class PgStore implements OpsGateStore {
  readonly kind = "postgres" as const
  private pool: pg.Pool
  /** Overlays pilot (migration SQL ultérieure) */
  private profiles = new Map<string, PolicyProfile[]>()
  private admins = new Map<string, OrgAdmin[]>()
  private users = new Map<string, OrgUser[]>()
  private groups = new Map<string, UserGroup[]>()
  private otpChallenges = new Map<string, PasswordResetChallenge>()
  private sessions = new Map<string, AdminSession>()
  private agentProfileOverride = new Map<string, string | undefined>()
  private agentUserOverride = new Map<string, string | undefined>()
  private configEpochOverlay = new Map<string, number>()
  private protectUnenrollOverlay = new Map<string, boolean>()

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
    // migrate douce si colonne absente (install PR5)
    await this.pool.query(`
      ALTER TABLE policies
      ADD COLUMN IF NOT EXISTS management_password_hash TEXT NOT NULL DEFAULT ''
    `)
    await this.pool.query(`
      ALTER TABLE policies
      ADD COLUMN IF NOT EXISTS config_epoch INT NOT NULL DEFAULT 1
    `)
    await this.pool.query(`
      ALTER TABLE policies
      ADD COLUMN IF NOT EXISTS protect_unenroll BOOLEAN NOT NULL DEFAULT FALSE
    `)
    console.log("[store:postgres] schema migrated")
  }

  private async ensureSeed() {
    const { rows } = await this.pool.query(
      `SELECT id FROM organizations WHERE org_code = $1`,
      ["DEMO-OPSGATE"]
    )
    if (rows.length > 0) {
      console.log("[store:postgres] demo org already present")
      return
    }

    const orgId = newId("org")
    const now = new Date().toISOString()
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

    const client = await this.pool.connect()
    try {
      await client.query("BEGIN")
      await client.query(
        `INSERT INTO organizations (id, name, slug, org_code, mode_default, event_payload_policy, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          orgId,
          "OpsGate Demo",
          "demo",
          "DEMO-OPSGATE",
          "org_managed",
          "metadata_only",
          now
        ]
      )
      await client.query(
        `INSERT INTO policies (id, org_id, version, default_action, enabled_hosts, scan_uploads, event_reporting, rules_pack_version, management_password_hash, updated_at)
         VALUES ($1,$2,1,$3,$4::jsonb,true,true,$5,$6,$7)`,
        [
          policyId,
          orgId,
          "mask_recommend",
          JSON.stringify([
            "chatgpt.com",
            "chat.openai.com",
            "claude.ai",
            "gemini.google.com"
          ]),
          pack.version,
          "", // mdp désinscription optionnel — défini via console
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
      await client.query("COMMIT")
      console.log(
        `[store:postgres] Seeded DEMO-OPSGATE rules=${pack.version} (${pack.rules.length})`
      )
    } catch (e) {
      await client.query("ROLLBACK")
      throw e
    } finally {
      client.release()
    }
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
    if (!rows[0]) return undefined
    const p = rowPolicy(rows[0])
    const overlay = this.configEpochOverlay.get(orgId)
    if (typeof overlay === "number") p.configEpoch = overlay
    if (this.protectUnenrollOverlay.has(orgId)) {
      p.protectUnenroll = !!this.protectUnenrollOverlay.get(orgId)
    }
    return p
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
      >
    >
  ) {
    const current = await this.getPolicy(orgId)
    if (!current) return undefined
    const nextConfigEpoch =
      typeof patch.configEpoch === "number"
        ? patch.configEpoch
        : (current.configEpoch || 1) + 1
    const next = {
      ...current,
      ...patch,
      version: current.version + 1,
      configEpoch: nextConfigEpoch,
      updatedAt: new Date().toISOString()
    }
    this.configEpochOverlay.set(orgId, next.configEpoch)
    if (typeof next.protectUnenroll === "boolean") {
      this.protectUnenrollOverlay.set(orgId, next.protectUnenroll)
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
        protect_unenroll = $11
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
        !!next.protectUnenroll
      ]
    )
    return next
  }

  async listAdmins(orgId: string) {
    let list = this.admins.get(orgId) || []
    if (list.length === 0) {
      // seed principal overlay
      const now = new Date().toISOString()
      list = [
        {
          id: newId("adm"),
          orgId,
          label: "Administrator",
          email: PRINCIPAL_SETUP_EMAIL.toLowerCase(),
          passwordHash: hashManagementPassword(PRINCIPAL_DEFAULT_PASSWORD),
          isPrincipal: true,
          permissions: [...ALL_ADMIN_PERMISSIONS],
          active: true,
          mustChangePassword: true,
          createdAt: now,
          updatedAt: now
        }
      ]
      this.admins.set(orgId, list)
    }
    return [...list]
  }

  async getPrincipalAdmin(orgId: string) {
    return (await this.listAdmins(orgId)).find((a) => a.isPrincipal)
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
    const list = await this.listAdmins(orgId)
    const now = new Date().toISOString()
    const email = input.email.trim().toLowerCase()
    if (!email.includes("@")) return undefined
    if (input.id) {
      const idx = list.findIndex((a) => a.id === input.id)
      if (idx < 0) return undefined
      const prev = list[idx]
      if (list.some((a) => a.id !== prev.id && a.email === email)) return undefined
      const next: OrgAdmin = {
        ...prev,
        label: input.label.trim() || prev.label,
        email,
        active: input.active !== undefined ? input.active : prev.active,
        permissions: prev.isPrincipal
          ? [...ALL_ADMIN_PERMISSIONS]
          : input.permissions ?? prev.permissions,
        mustChangePassword:
          input.mustChangePassword !== undefined
            ? input.mustChangePassword
            : prev.mustChangePassword,
        updatedAt: now
      }
      if (input.password) {
        const min = prev.isPrincipal ? 4 : 6
        if (input.password.length < min) return undefined
        next.passwordHash = hashManagementPassword(input.password)
        if (input.mustChangePassword === undefined) next.mustChangePassword = false
      }
      list[idx] = next
      this.admins.set(orgId, list)
      await this.forceConfigSync(orgId)
      return next
    }
    if (input.isPrincipal) return undefined
    if (!input.password || input.password.length < 6) return undefined
    if (list.some((a) => a.email === email)) return undefined
    const created: OrgAdmin = {
      id: newId("adm"),
      orgId,
      label: input.label.trim() || `admin${list.length + 1}`,
      email,
      passwordHash: hashManagementPassword(input.password),
      isPrincipal: false,
      permissions: input.permissions?.length
        ? input.permissions
        : ["console_access"],
      active: input.active !== false,
      mustChangePassword: false,
      createdAt: now,
      updatedAt: now
    }
    if (!created.permissions.includes("console_access")) {
      created.permissions = ["console_access", ...created.permissions]
    }
    list.push(created)
    this.admins.set(orgId, list)
    await this.forceConfigSync(orgId)
    return created
  }

  async deleteAdmin(orgId: string, adminId: string) {
    const list = await this.listAdmins(orgId)
    const target = list.find((a) => a.id === adminId)
    if (!target || target.isPrincipal) return false
    this.admins.set(
      orgId,
      list.filter((a) => a.id !== adminId)
    )
    for (const [tok, s] of this.sessions) {
      if (s.adminId === adminId) this.sessions.delete(tok)
    }
    await this.forceConfigSync(orgId)
    return true
  }

  async createAdminSession(email: string, password: string) {
    const emailNorm = email.trim().toLowerCase()
    const hash = hashManagementPassword(password)
    for (const orgId of this.admins.keys()) {
      const list = await this.listAdmins(orgId)
      const admin = list.find(
        (a) => a.active && a.email === emailNorm && a.passwordHash === hash
      )
      if (!admin) continue
      if (!admin.isPrincipal && !admin.permissions.includes("console_access")) {
        return { ok: false as const, error: "no_console_access" }
      }
      const token = `ogs_${newToken().replace(/^ogt_/, "")}`
      const session: AdminSession = {
        token,
        orgId,
        adminId: admin.id,
        expiresAt: Date.now() + 12 * 60 * 60 * 1000,
        createdAt: Date.now()
      }
      this.sessions.set(token, session)
      return { ok: true as const, session, admin }
    }
    // try seed org from DB
    const { rows } = await this.pool.query(
      `SELECT id FROM organizations WHERE org_code = $1`,
      ["DEMO-OPSGATE"]
    )
    if (rows[0]) {
      const list = await this.listAdmins(rows[0].id)
      const admin = list.find(
        (a) => a.active && a.email === emailNorm && a.passwordHash === hash
      )
      if (admin) {
        if (
          !admin.isPrincipal &&
          !admin.permissions.includes("console_access")
        ) {
          return { ok: false as const, error: "no_console_access" }
        }
        const token = `ogs_${newToken().replace(/^ogt_/, "")}`
        const session: AdminSession = {
          token,
          orgId: rows[0].id,
          adminId: admin.id,
          expiresAt: Date.now() + 12 * 60 * 60 * 1000,
          createdAt: Date.now()
        }
        this.sessions.set(token, session)
        return { ok: true as const, session, admin }
      }
    }
    return { ok: false as const, error: "invalid_credentials" }
  }

  async resolveAdminSession(token: string) {
    const session = this.sessions.get(token)
    if (!session) return undefined
    if (Date.now() > session.expiresAt) {
      this.sessions.delete(token)
      return undefined
    }
    const admin = (await this.listAdmins(session.orgId)).find(
      (a) => a.id === session.adminId && a.active
    )
    if (!admin) {
      this.sessions.delete(token)
      return undefined
    }
    return { session, admin }
  }

  async revokeAdminSession(token: string) {
    return this.sessions.delete(token)
  }

  async listUsers(orgId: string) {
    return [...(this.users.get(orgId) || [])]
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
    const list = this.users.get(orgId) || []
    if (input.id) {
      const idx = list.findIndex((u) => u.id === input.id)
      if (idx < 0) return undefined
      list[idx] = {
        ...list[idx],
        displayName: input.displayName,
        email: input.email ?? list[idx].email,
        externalId: input.externalId ?? list[idx].externalId,
        groupIds: input.groupIds ?? list[idx].groupIds
      }
      this.users.set(orgId, list)
      await this.forceConfigSync(orgId)
      return list[idx]
    }
    const created: OrgUser = {
      id: newId("usr"),
      orgId,
      displayName: input.displayName,
      email: input.email,
      externalId: input.externalId,
      groupIds: input.groupIds || [],
      createdAt: new Date().toISOString()
    }
    list.push(created)
    this.users.set(orgId, list)
    return created
  }

  async deleteUser(orgId: string, userId: string) {
    const list = this.users.get(orgId) || []
    const next = list.filter((u) => u.id !== userId)
    if (next.length === list.length) return false
    this.users.set(orgId, next)
    await this.forceConfigSync(orgId)
    return true
  }

  async listGroups(orgId: string) {
    return [...(this.groups.get(orgId) || [])]
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
    const list = this.groups.get(orgId) || []
    const now = new Date().toISOString()
    if (input.id) {
      const idx = list.findIndex((g) => g.id === input.id)
      if (idx < 0) return undefined
      list[idx] = {
        ...list[idx],
        name: input.name,
        description: input.description ?? list[idx].description,
        policyProfileId:
          input.policyProfileId === null
            ? undefined
            : input.policyProfileId ?? list[idx].policyProfileId,
        ldapExternalId: input.ldapExternalId ?? list[idx].ldapExternalId,
        updatedAt: now
      }
      this.groups.set(orgId, list)
      await this.forceConfigSync(orgId)
      return list[idx]
    }
    const created: UserGroup = {
      id: newId("grp"),
      orgId,
      name: input.name,
      description: input.description,
      policyProfileId: input.policyProfileId || undefined,
      ldapExternalId: input.ldapExternalId,
      createdAt: now,
      updatedAt: now
    }
    list.push(created)
    this.groups.set(orgId, list)
    await this.forceConfigSync(orgId)
    return created
  }

  async deleteGroup(orgId: string, groupId: string) {
    const list = this.groups.get(orgId) || []
    const next = list.filter((g) => g.id !== groupId)
    if (next.length === list.length) return false
    this.groups.set(orgId, next)
    await this.forceConfigSync(orgId)
    return true
  }

  async listProfiles(orgId: string) {
    return [...(this.profiles.get(orgId) || [])]
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
    }
  ) {
    const org = await this.getOrg(orgId)
    if (!org) return undefined
    const list = this.profiles.get(orgId) || []
    const now = new Date().toISOString()
    if (input.id) {
      const idx = list.findIndex((p) => p.id === input.id)
      if (idx < 0) return undefined
      const prev = list[idx]
      const next: PolicyProfile = {
        ...prev,
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
        updatedAt: now
      }
      list[idx] = next
      this.profiles.set(orgId, list)
      await this.forceConfigSync(orgId)
      return next
    }
    const created: PolicyProfile = {
      id: newId("prof"),
      orgId,
      name: input.name,
      department: input.department,
      defaultAction: input.defaultAction || "mask_recommend",
      enabledHosts: input.enabledHosts || [
        "chatgpt.com",
        "chat.openai.com",
        "claude.ai",
        "gemini.google.com"
      ],
      scanUploads: input.scanUploads !== false,
      eventReporting: input.eventReporting !== false,
      protectUnenroll: !!input.protectUnenroll,
      assignedGroupIds: input.assignedGroupIds || [],
      assignedUserIds: input.assignedUserIds || [],
      updatedAt: now
    }
    list.push(created)
    this.profiles.set(orgId, list)
    await this.forceConfigSync(orgId)
    return created
  }

  async deleteProfile(orgId: string, profileId: string) {
    const list = this.profiles.get(orgId) || []
    const next = list.filter((p) => p.id !== profileId)
    if (next.length === list.length) return false
    this.profiles.set(orgId, next)
    for (const [agentId, pid] of this.agentProfileOverride) {
      if (pid === profileId) this.agentProfileOverride.set(agentId, undefined)
    }
    await this.forceConfigSync(orgId)
    return true
  }

  async assignAgentProfile(
    orgId: string,
    agentId: string,
    policyProfileId: string | null
  ) {
    const agents = await this.listAgents(orgId)
    const agent = agents.find((a) => a.id === agentId)
    if (!agent) return undefined
    if (policyProfileId) {
      const list = this.profiles.get(orgId) || []
      if (!list.some((p) => p.id === policyProfileId)) return undefined
    }
    this.agentProfileOverride.set(agentId, policyProfileId || undefined)
    await this.forceConfigSync(orgId)
    return {
      ...agent,
      policyProfileId: policyProfileId || undefined
    }
  }

  async assignAgentUser(
    orgId: string,
    agentId: string,
    userId: string | null
  ) {
    const agents = await this.listAgents(orgId)
    const agent = agents.find((a) => a.id === agentId)
    if (!agent) return undefined
    if (userId) {
      const users = this.users.get(orgId) || []
      if (!users.some((u) => u.id === userId)) return undefined
    }
    this.agentUserOverride.set(agentId, userId || undefined)
    await this.forceConfigSync(orgId)
    return { ...agent, userId: userId || undefined }
  }

  async getEffectivePolicyForAgent(orgId: string, agentId: string) {
    const policy = await this.getPolicy(orgId)
    if (!policy) return undefined
    const list = this.profiles.get(orgId) || []
    let profile: PolicyProfile | null = null
    const profileId = this.agentProfileOverride.get(agentId)
    if (profileId) {
      profile = list.find((p) => p.id === profileId) || null
    } else {
      const userId = this.agentUserOverride.get(agentId)
      if (userId) {
        const user = (this.users.get(orgId) || []).find((u) => u.id === userId)
        if (user) {
          profile =
            list.find((p) => (p.assignedUserIds || []).includes(user.id)) ||
            null
          if (!profile) {
            for (const gid of user.groupIds || []) {
              profile =
                list.find((p) => (p.assignedGroupIds || []).includes(gid)) ||
                null
              if (profile) break
              const g = (this.groups.get(orgId) || []).find((x) => x.id === gid)
              if (g?.policyProfileId) {
                profile = list.find((x) => x.id === g.policyProfileId) || null
                if (profile) break
              }
            }
          }
        }
      }
    }
    const effective = profile
      ? {
          defaultAction: profile.defaultAction,
          enabledHosts: profile.enabledHosts,
          scanUploads: profile.scanUploads,
          eventReporting: profile.eventReporting,
          protectUnenroll: profile.protectUnenroll
        }
      : {
          defaultAction: policy.defaultAction,
          enabledHosts: policy.enabledHosts,
          scanUploads: policy.scanUploads,
          eventReporting: policy.eventReporting,
          protectUnenroll: policy.protectUnenroll
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

  private agentLicenseOverride = new Map<string, boolean>()

  async isAgentLicensed(orgId: string, agentId: string) {
    if (this.agentLicenseOverride.has(agentId)) {
      return this.agentLicenseOverride.get(agentId) !== false
    }
    return true // défaut licensed (démo)
  }

  async setAgentLicense(orgId: string, agentId: string, licensed: boolean) {
    const agents = await this.listAgents(orgId)
    const agent = agents.find((a) => a.id === agentId)
    if (!agent) return undefined
    this.agentLicenseOverride.set(agentId, licensed)
    await this.forceConfigSync(orgId)
    return { ...agent, licenseAssigned: licensed }
  }

  async getLicenseStats(orgId: string) {
    const agents = await this.listAgents(orgId)
    let licensed_agents = 0
    let unlicensed_agents = 0
    for (const a of agents) {
      if (await this.isAgentLicensed(orgId, a.id)) licensed_agents++
      else unlicensed_agents++
    }
    const seats = 0 // illimité en pg pilot sans colonne seats
    return {
      licensed_agents,
      unlicensed_agents,
      grace_agents: 0,
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
        highest_severity: "low",
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
    this.otpChallenges.set(orgId, {
      orgId,
      codeHash: hashManagementPassword(otp),
      expiresAt: Date.now() + expiresIn * 1000,
      createdAt: Date.now()
    })
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
    const ch = this.otpChallenges.get(orgId)
    if (!ch) return { ok: false as const, error: "no_challenge" }
    if (Date.now() > ch.expiresAt) {
      this.otpChallenges.delete(orgId)
      return { ok: false as const, error: "otp_expired" }
    }
    if (hashManagementPassword(otp.trim()) !== ch.codeHash) {
      return { ok: false as const, error: "otp_invalid" }
    }
    if (!newPassword || newPassword.length < 6) {
      return { ok: false as const, error: "password_too_short" }
    }
    const principal = await this.getPrincipalAdmin(orgId)
    if (!principal) return { ok: false as const, error: "principal_missing" }
    const hash = hashManagementPassword(newPassword)
    principal.passwordHash = hash
    principal.mustChangePassword = false
    principal.updatedAt = new Date().toISOString()
    await this.updatePolicy(orgId, { managementPasswordHash: hash })
    this.otpChallenges.delete(orgId)
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
    const version = bumpVersion(base)
    if (existing.some((p) => p.version === version)) {
      return { ok: false, errors: [`version_collision:${version}`] }
    }

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
          rulesPackVersion: pack.version,
          updatedAt: new Date().toISOString()
        }
        await client.query(
          `UPDATE policies SET version=$2, rules_pack_version=$3, updated_at=$4 WHERE org_id=$1`,
          [input.orgId, nextPolicy.version, pack.version, nextPolicy.updatedAt]
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
        rulesPackVersion: pack.version,
        updatedAt: new Date().toISOString()
      }
      await client.query(
        `UPDATE policies SET version=$2, rules_pack_version=$3, updated_at=$4 WHERE org_id=$1`,
        [orgId, nextPolicy.version, pack.version, nextPolicy.updatedAt]
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
  }): Promise<Agent & { replaced?: boolean }> {
    const now = new Date().toISOString()
    const tokenHash = hashToken(input.token)
    const label = (input.deviceLabel || "").trim()

    if (label) {
      const { rows: existing } = await this.pool.query(
        `SELECT * FROM agents
         WHERE org_id = $1 AND lower(trim(device_label)) = lower(trim($2))
         LIMIT 1`,
        [input.orgId, label]
      )
      if (existing[0]) {
        const { rows } = await this.pool.query(
          `UPDATE agents SET
             token_hash = $2,
             app_version = COALESCE($3, app_version),
             device_label = $4,
             last_seen_at = $5
           WHERE id = $1
           RETURNING *`,
          [
            existing[0].id,
            tokenHash,
            input.appVersion ?? null,
            label,
            now
          ]
        )
        return { ...rowAgent(rows[0]), replaced: true }
      }
    }

    const agent: Agent = {
      id: newId("agt"),
      orgId: input.orgId,
      deviceLabel: input.deviceLabel,
      hostName: input.hostName,
      enrolledAt: now,
      tokenHash,
      appVersion: input.appVersion,
      lastSeenAt: now,
      licenseAssigned: true
    }
    await this.pool.query(
      `INSERT INTO agents (id, org_id, device_label, enrolled_at, token_hash, app_version, last_seen_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        agent.id,
        agent.orgId,
        agent.deviceLabel ?? null,
        agent.enrolledAt,
        agent.tokenHash,
        agent.appVersion ?? null,
        agent.lastSeenAt
      ]
    )
    return { ...agent, replaced: false }
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
    // events: garder l'historique, détacher l'agent (SET NULL agent_id impossible si FK)
    // → on supprime l'agent ; events en CASCADE si ON DELETE CASCADE
    // schema has ON DELETE CASCADE on events.agent_id — history lost for that agent
    // better: ON DELETE SET NULL — for now CASCADE is ok for pilot; or delete agent only
    const { rowCount } = await this.pool.query(
      `DELETE FROM agents WHERE token_hash = $1`,
      [hash]
    )
    return (rowCount ?? 0) > 0
  }

  async revokeAgentById(orgId: string, agentId: string): Promise<boolean> {
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

      try {
        const res = await this.pool.query(
          `INSERT INTO detection_events (
            id, org_id, agent_id, client_event_id, ts, source, hostname, decision,
            detection_count, highest_severity, rule_ids, types, masked, file_names, schema_version, received_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13,$14::jsonb,$15,$16)
          ON CONFLICT (agent_id, client_event_id) DO NOTHING`,
          [
            newId("evt"),
            orgId,
            agentId,
            ev.client_event_id,
            ev.ts,
            ev.source,
            ev.hostname,
            ev.decision,
            ev.detection_count,
            ev.highest_severity,
            JSON.stringify(ev.rule_ids || []),
            JSON.stringify(ev.types || []),
            ev.masked ?? null,
            ev.file_names ? JSON.stringify(ev.file_names) : null,
            ev.schema_version || 1,
            now
          ]
        )
        // both insert and conflict count as accepted for idempotence
        accepted++
        void res
      } catch (e) {
        rejected.push({ index, reason: String(e) })
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

    const { rows: ruleRows } = await this.pool.query(
      `SELECT jsonb_array_elements_text(rule_ids) AS rule_id, COUNT(*)::int AS n
       FROM detection_events WHERE org_id = $1
       GROUP BY rule_id ORDER BY n DESC LIMIT 5`,
      [orgId]
    )
    // rule_ids may be empty from agent; fall back to types expansion not needed
    const topRules = ruleRows.map((r) => ({
      rule_id: r.rule_id,
      count: r.n
    }))

    // If rule_ids empty, aggregate from types
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
      packs_published: packCount[0]?.n || 0
    }
  }

  async close() {
    await this.pool.end()
  }
}
