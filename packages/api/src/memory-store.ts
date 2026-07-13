import type { DetectionRule } from "@opsgate/engine"

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
  PasswordResetChallenge,
  Policy,
  PolicyProfile,
  RulesPackPayload,
  StoredEvent,
  StoredRulePack,
  UserGroup
} from "./types"
import { ALL_ADMIN_PERMISSIONS } from "./types"

/**
 * Store mémoire — fallback si DATABASE_URL absent.
 */
export class MemoryStore implements OpsGateStore {
  readonly kind = "memory" as const

  private orgs = new Map<string, Organization>()
  private orgsByCode = new Map<string, string>()
  private policies = new Map<string, Policy>()
  private profiles = new Map<string, PolicyProfile[]>()
  private admins = new Map<string, OrgAdmin[]>()
  private users = new Map<string, OrgUser[]>()
  private groups = new Map<string, UserGroup[]>()
  private agents = new Map<string, Agent>()
  private agentsByTokenHash = new Map<string, string>()
  private events: StoredEvent[] = []
  private packs = new Map<string, StoredRulePack[]>()
  private otpChallenges = new Map<string, PasswordResetChallenge>()
  private sessions = new Map<string, AdminSession>()
  private adminAudit: import("./types").AdminAuditEvent[] = []
  private movingRules = new Map<string, import("./types").MovingRule[]>()

  constructor() {
    this.seed()
  }

  private seed() {
    const orgId = newId("org")
    const now = new Date().toISOString()
    const global = buildGlobalRulesPack("1.0.0")
    const setupEmail = PRINCIPAL_SETUP_EMAIL

    const org: Organization = {
      id: orgId,
      name: "OpsGate Demo",
      slug: "demo",
      orgCode: "DEMO-OPSGATE",
      modeDefault: "org_managed",
      eventPayloadPolicy: "metadata_only",
      primaryEmail: setupEmail,
      // Démo : 25 sièges pour visualiser « utilisés / restants / total »
      licenseSeats: 25,
      createdAt: now
    }

    const pack = materializePack({
      orgId,
      version: global.version,
      rules: global.rules,
      notes: global.notes,
      publishedBy: "system-seed",
      active: true
    })

    const defaultHosts = [
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

    const policy: Policy = {
      id: newId("pol"),
      orgId,
      version: 1,
      defaultAction: "mask_recommend",
      enabledHosts: defaultHosts,
      scanUploads: true,
      eventReporting: true,
      rulesPackVersion: pack.version,
      managementPasswordHash: hashManagementPassword(PRINCIPAL_DEFAULT_PASSWORD),
      protectUnenroll: true,
      configEpoch: 1,
      updatedAt: now
    }

    const engId = newId("prof")
    const financeId = newId("prof")
    const gEng = newId("grp")
    const gFin = newId("grp")

    const profiles: PolicyProfile[] = [
      {
        id: engId,
        orgId,
        name: "Engineering",
        department: "engineering",
        defaultAction: "mask_recommend",
        enabledHosts: defaultHosts,
        scanUploads: true,
        eventReporting: true,
        protectUnenroll: false,
        assignedGroupIds: [gEng],
        assignedUserIds: [],
        updatedAt: now
      },
      {
        id: financeId,
        orgId,
        name: "Finance",
        department: "finance",
        defaultAction: "mask_force",
        enabledHosts: ["chatgpt.com", "claude.ai"],
        scanUploads: false,
        eventReporting: true,
        protectUnenroll: true,
        assignedGroupIds: [gFin],
        assignedUserIds: [],
        updatedAt: now
      }
    ]

    const groups: UserGroup[] = [
      {
        id: gEng,
        orgId,
        name: "Engineering",
        description: "Équipe technique",
        policyProfileId: engId,
        grantsLicense: true,
        createdAt: now,
        updatedAt: now
      },
      {
        id: gFin,
        orgId,
        name: "Finance",
        description: "Équipe finance — policy stricte",
        policyProfileId: financeId,
        grantsLicense: true,
        createdAt: now,
        updatedAt: now
      }
    ]

    const u1 = newId("usr")
    const u2 = newId("usr")
    const users: OrgUser[] = [
      {
        id: u1,
        orgId,
        displayName: "Alice Demo",
        email: "alice@demo.local",
        groupIds: [gEng],
        licenseManual: null,
        createdAt: now
      },
      {
        id: u2,
        orgId,
        displayName: "Bob Finance",
        email: "bob@demo.local",
        groupIds: [gFin],
        licenseManual: null,
        createdAt: now
      }
    ]

    // Admin principal setup — mdp défaut 0000 (à changer)
    const principal: OrgAdmin = {
      id: newId("adm"),
      orgId,
      label: "Administrator",
      email: setupEmail.toLowerCase(),
      passwordHash: hashManagementPassword(PRINCIPAL_DEFAULT_PASSWORD),
      isPrincipal: true,
      permissions: [...ALL_ADMIN_PERMISSIONS],
      active: true,
      mustChangePassword: true,
      createdAt: now,
      updatedAt: now
    }

    this.orgs.set(orgId, org)
    this.orgsByCode.set(org.orgCode.toUpperCase(), orgId)
    this.policies.set(orgId, policy)
    this.profiles.set(orgId, profiles)
    this.groups.set(orgId, groups)
    this.users.set(orgId, users)
    this.admins.set(orgId, [principal])
    this.packs.set(orgId, [pack])

    // Org personnelle (standalone / usage personnel)
    this.seedPersonalOrg()

    console.log(
      `[store:memory] Seeded org="${org.name}" code=${org.orgCode} principal=${setupEmail} defaultPassword=${PRINCIPAL_DEFAULT_PASSWORD} (change me)`
    )
  }

  private seedPersonalOrg() {
    const orgId = newId("org")
    const now = new Date().toISOString()
    const org: Organization = {
      id: orgId,
      name: "OpsGate Personal",
      slug: "personal",
      orgCode: "PERSONAL",
      modeDefault: "org_managed",
      eventPayloadPolicy: "metadata_only",
      primaryEmail: PRINCIPAL_SETUP_EMAIL,
      isPersonal: true,
      licenseSeats: 1,
      createdAt: now
    }
    const global = buildGlobalRulesPack("1.0.0")
    const pack = materializePack({
      orgId,
      version: global.version,
      rules: global.rules,
      notes: "personal-pack",
      publishedBy: "system-seed",
      active: true
    })
    const policy: Policy = {
      id: newId("pol"),
      orgId,
      version: 1,
      defaultAction: "mask_recommend",
      enabledHosts: [
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
        "blackbox.ai",
        "notion.so",
        "labs.google"
      ],
      scanUploads: true,
      eventReporting: false,
      rulesPackVersion: pack.version,
      managementPasswordHash: "",
      protectUnenroll: false,
      configEpoch: 1,
      updatedAt: now
    }
    this.orgs.set(orgId, org)
    this.orgsByCode.set("PERSONAL", orgId)
    this.policies.set(orgId, policy)
    this.profiles.set(orgId, [])
    this.groups.set(orgId, [])
    this.users.set(orgId, [])
    this.admins.set(orgId, [])
    this.packs.set(orgId, [pack])
    console.log(`[store:memory] Seeded PERSONAL org for standalone users`)
  }

  async findOrgByCode(code: string) {
    const id = this.orgsByCode.get(code.trim().toUpperCase())
    return id ? this.orgs.get(id) : undefined
  }

  async getOrg(id: string) {
    return this.orgs.get(id)
  }

  async getPolicy(orgId: string) {
    return this.policies.get(orgId)
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
    const policy = this.policies.get(orgId)
    if (!policy) return undefined
    const next: Policy = {
      ...policy,
      ...patch,
      version: policy.version + 1,
      configEpoch:
        typeof patch.configEpoch === "number"
          ? patch.configEpoch
          : policy.configEpoch + 1,
      updatedAt: new Date().toISOString()
    }
    this.policies.set(orgId, next)
    return next
  }

  async listAdmins(orgId: string) {
    return [...(this.admins.get(orgId) || [])]
  }

  async getPrincipalAdmin(orgId: string) {
    return (this.admins.get(orgId) || []).find((a) => a.isPrincipal)
  }

  async listUnenrollAdmins(orgId: string) {
    return (this.admins.get(orgId) || []).filter(
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
    if (!this.orgs.has(orgId)) return undefined
    const list = this.admins.get(orgId) || []
    const now = new Date().toISOString()
    const email = input.email.trim().toLowerCase()
    if (!email.includes("@")) return undefined

    if (input.id) {
      const idx = list.findIndex((a) => a.id === input.id)
      if (idx < 0) return undefined
      const prev = list[idx]
      // email unique
      if (list.some((a) => a.id !== prev.id && a.email === email)) {
        return undefined
      }
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
      // Principal mdp peut être court (0000) ; secondaires ≥6
      if (input.password) {
        const min = prev.isPrincipal ? 4 : 6
        if (input.password.length < min) return undefined
        next.passwordHash = hashManagementPassword(input.password)
        if (input.mustChangePassword === undefined) {
          next.mustChangePassword = false
        }
      }
      list[idx] = next
      this.admins.set(orgId, list)
      await this.syncLegacyMgmtHash(orgId)
      await this.forceConfigSync(orgId)
      return next
    }

    // Nouveau secondaire — pas de second principal
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
    await this.syncLegacyMgmtHash(orgId)
    await this.forceConfigSync(orgId)
    return created
  }

  async deleteAdmin(orgId: string, adminId: string) {
    const list = this.admins.get(orgId) || []
    const target = list.find((a) => a.id === adminId)
    if (!target || target.isPrincipal) return false // jamais supprimer le principal
    const next = list.filter((a) => a.id !== adminId)
    this.admins.set(orgId, next)
    // revoke sessions
    for (const [tok, s] of this.sessions) {
      if (s.adminId === adminId) this.sessions.delete(tok)
    }
    await this.syncLegacyMgmtHash(orgId)
    await this.forceConfigSync(orgId)
    return true
  }

  private async syncLegacyMgmtHash(orgId: string) {
    const principal = (this.admins.get(orgId) || []).find((a) => a.isPrincipal)
    const policy = this.policies.get(orgId)
    if (!policy) return
    policy.managementPasswordHash = principal?.passwordHash || ""
  }

  async createAdminSession(email: string, password: string) {
    const emailNorm = email.trim().toLowerCase()
    const hash = hashManagementPassword(password)
    type Cand = { orgId: string; admin: OrgAdmin; personal: boolean }
    const candidates: Cand[] = []
    for (const [orgId, list] of this.admins) {
      const admin = list.find(
        (a) => a.active && a.email === emailNorm && a.passwordHash === hash
      )
      if (!admin) continue
      if (!admin.isPrincipal && !admin.permissions.includes("console_access")) {
        continue
      }
      candidates.push({
        orgId,
        admin,
        personal: !!this.orgs.get(orgId)?.isPersonal
      })
    }
    candidates.sort((a, b) => Number(a.personal) - Number(b.personal))
    const hit = candidates[0]
    if (!hit) return { ok: false as const, error: "invalid_credentials" }
    // Un seul login actif par compte admin — le 2e doit attendre la déconnexion
    const now = Date.now()
    for (const [tok, sess] of this.sessions) {
      if (sess.adminId !== hit.admin.id) continue
      if (now > sess.expiresAt) {
        this.sessions.delete(tok)
        continue
      }
      return { ok: false as const, error: "session_already_active" }
    }
    const token = `ogs_${newToken().replace(/^ogt_/, "")}`
    const session: AdminSession = {
      token,
      orgId: hit.orgId,
      adminId: hit.admin.id,
      expiresAt: now + 12 * 60 * 60 * 1000,
      createdAt: now
    }
    this.sessions.set(token, session)
    return { ok: true as const, session, admin: hit.admin }
  }

  async resolveAdminSession(token: string) {
    const session = this.sessions.get(token)
    if (!session) return undefined
    if (Date.now() > session.expiresAt) {
      this.sessions.delete(token)
      return undefined
    }
    const admin = (this.admins.get(session.orgId) || []).find(
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
    if (!this.orgs.has(orgId)) return undefined
    const list = this.users.get(orgId) || []
    const now = new Date().toISOString()
    if (input.id) {
      const idx = list.findIndex((u) => u.id === input.id)
      if (idx < 0) return undefined
      const next: OrgUser = {
        ...list[idx],
        displayName: input.displayName,
        email: input.email ?? list[idx].email,
        externalId: input.externalId ?? list[idx].externalId,
        groupIds: input.groupIds ?? list[idx].groupIds
      }
      list[idx] = next
      this.users.set(orgId, list)
      await this.forceConfigSync(orgId)
      return next
    }
    const created: OrgUser = {
      id: newId("usr"),
      orgId,
      displayName: input.displayName,
      email: input.email,
      externalId: input.externalId,
      groupIds: input.groupIds || [],
      createdAt: now
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
    for (const a of this.agents.values()) {
      if (a.orgId === orgId && a.userId === userId) a.userId = undefined
    }
    // clean profile assignedUserIds
    const profiles = this.profiles.get(orgId) || []
    for (const p of profiles) {
      p.assignedUserIds = (p.assignedUserIds || []).filter((id) => id !== userId)
    }
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
      grantsLicense?: boolean
    }
  ) {
    if (!this.orgs.has(orgId)) return undefined
    const list = this.groups.get(orgId) || []
    const now = new Date().toISOString()
    if (input.id) {
      const idx = list.findIndex((g) => g.id === input.id)
      if (idx < 0) return undefined
      const next: UserGroup = {
        ...list[idx],
        name: input.name,
        description: input.description ?? list[idx].description,
        policyProfileId:
          input.policyProfileId === null
            ? undefined
            : input.policyProfileId ?? list[idx].policyProfileId,
        ldapExternalId: input.ldapExternalId ?? list[idx].ldapExternalId,
        grantsLicense:
          input.grantsLicense !== undefined
            ? input.grantsLicense
            : list[idx].grantsLicense,
        updatedAt: now
      }
      list[idx] = next
      this.groups.set(orgId, list)
      await this.syncProfileGroupLinks(orgId)
      await this.forceConfigSync(orgId)
      return next
    }
    const created: UserGroup = {
      id: newId("grp"),
      orgId,
      name: input.name,
      description: input.description,
      policyProfileId: input.policyProfileId || undefined,
      ldapExternalId: input.ldapExternalId,
      grantsLicense: input.grantsLicense !== false,
      createdAt: now,
      updatedAt: now
    }
    list.push(created)
    this.groups.set(orgId, list)
    await this.syncProfileGroupLinks(orgId)
    await this.forceConfigSync(orgId)
    return created
  }

  async deleteGroup(orgId: string, groupId: string) {
    const list = this.groups.get(orgId) || []
    const next = list.filter((g) => g.id !== groupId)
    if (next.length === list.length) return false
    this.groups.set(orgId, next)
    for (const u of this.users.get(orgId) || []) {
      u.groupIds = u.groupIds.filter((id) => id !== groupId)
    }
    for (const p of this.profiles.get(orgId) || []) {
      p.assignedGroupIds = (p.assignedGroupIds || []).filter(
        (id) => id !== groupId
      )
    }
    await this.forceConfigSync(orgId)
    return true
  }

  /** Aligne assignedGroupIds des profils avec group.policyProfileId */
  private async syncProfileGroupLinks(orgId: string) {
    const groups = this.groups.get(orgId) || []
    const profiles = this.profiles.get(orgId) || []
    for (const p of profiles) {
      p.assignedGroupIds = groups
        .filter((g) => g.policyProfileId === p.id)
        .map((g) => g.id)
    }
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
    if (!this.orgs.has(orgId)) return undefined
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
      await this.applyProfileGroupAssignments(orgId, next)
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
    await this.applyProfileGroupAssignments(orgId, created)
    await this.forceConfigSync(orgId)
    return created
  }

  private async applyProfileGroupAssignments(
    orgId: string,
    profile: PolicyProfile
  ) {
    const groups = this.groups.get(orgId) || []
    const assigned = new Set(profile.assignedGroupIds || [])
    for (const g of groups) {
      if (assigned.has(g.id)) {
        g.policyProfileId = profile.id
        g.updatedAt = new Date().toISOString()
      } else if (g.policyProfileId === profile.id && !assigned.has(g.id)) {
        g.policyProfileId = undefined
        g.updatedAt = new Date().toISOString()
      }
    }
  }

  async deleteProfile(orgId: string, profileId: string) {
    const list = this.profiles.get(orgId) || []
    const next = list.filter((p) => p.id !== profileId)
    if (next.length === list.length) return false
    this.profiles.set(orgId, next)
    for (const a of this.agents.values()) {
      if (a.orgId === orgId && a.policyProfileId === profileId) {
        a.policyProfileId = undefined
      }
    }
    for (const g of this.groups.get(orgId) || []) {
      if (g.policyProfileId === profileId) g.policyProfileId = undefined
    }
    await this.forceConfigSync(orgId)
    return true
  }

  async assignAgentProfile(
    orgId: string,
    agentId: string,
    policyProfileId: string | null
  ) {
    const agent = this.agents.get(agentId)
    if (!agent || agent.orgId !== orgId) return undefined
    if (policyProfileId) {
      const list = this.profiles.get(orgId) || []
      if (!list.some((p) => p.id === policyProfileId)) return undefined
    }
    agent.policyProfileId = policyProfileId || undefined
    agent.lastSeenAt = new Date().toISOString()
    await this.forceConfigSync(orgId)
    return agent
  }

  async assignAgentUser(
    orgId: string,
    agentId: string,
    userId: string | null
  ) {
    const agent = this.agents.get(agentId)
    if (!agent || agent.orgId !== orgId) return undefined
    if (userId) {
      const users = this.users.get(orgId) || []
      if (!users.some((u) => u.id === userId)) return undefined
    }
    agent.userId = userId || undefined
    agent.lastSeenAt = new Date().toISOString()
    await this.forceConfigSync(orgId)
    return agent
  }

  private resolveProfileForAgent(
    orgId: string,
    agent: Agent | undefined
  ): PolicyProfile | null {
    const list = this.profiles.get(orgId) || []
    if (!agent) return null

    // 1. Override manuel agent
    if (agent.policyProfileId) {
      return list.find((p) => p.id === agent.policyProfileId) || null
    }

    // 2. Via user → groupes / assignation directe user
    if (agent.userId) {
      const user = (this.users.get(orgId) || []).find(
        (u) => u.id === agent.userId
      )
      if (user) {
        const byUser = list.find((p) =>
          (p.assignedUserIds || []).includes(user.id)
        )
        if (byUser) return byUser
        for (const gid of user.groupIds || []) {
          const byGroup = list.find((p) =>
            (p.assignedGroupIds || []).includes(gid)
          )
          if (byGroup) return byGroup
          const g = (this.groups.get(orgId) || []).find((x) => x.id === gid)
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
    const policy = this.policies.get(orgId)
    if (!policy) return undefined
    const agent = this.agents.get(agentId)
    const profile = this.resolveProfileForAgent(orgId, agent)

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

    const unenrollAdmins = await this.listUnenrollAdmins(orgId)
    const admins = unenrollAdmins.map((a) => ({
      id: a.id,
      label: a.label,
      email: a.email,
      password_hash: a.passwordHash
    }))
    const licensed = await this.isAgentLicensed(orgId, agentId)

    return { policy, profile, effective, admins, licensed }
  }

  async isAgentLicensed(orgId: string, agentId: string) {
    const agent = this.agents.get(agentId)
    if (!agent || agent.orgId !== orgId) return false
    return agent.licenseAssigned !== false
  }

  async setAgentLicense(orgId: string, agentId: string, licensed: boolean) {
    const agent = this.agents.get(agentId)
    if (!agent || agent.orgId !== orgId) return undefined
    const org = this.orgs.get(orgId)
    if (licensed && org?.licenseSeats && org.licenseSeats > 0) {
      const used = [...this.agents.values()].filter(
        (a) => a.orgId === orgId && a.licenseAssigned && a.id !== agentId
      ).length
      if (used >= org.licenseSeats) return undefined
    }
    agent.licenseAssigned = licensed
    agent.unlicensedSince = licensed ? undefined : new Date().toISOString()
    await this.forceConfigSync(orgId)
    return agent
  }

  async getLicenseStats(orgId: string) {
    const org = this.orgs.get(orgId)
    const agents = [...this.agents.values()].filter((a) => a.orgId === orgId)
    let licensed_agents = 0
    let unlicensed_agents = 0
    let grace_agents = 0
    const graceMs = 5 * 60 * 1000
    for (const a of agents) {
      const ok = await this.isAgentLicensed(orgId, a.id)
      if (ok) {
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
    const seats_used = licensed_agents
    return {
      licensed_agents,
      unlicensed_agents,
      grace_agents,
      seats,
      seats_used,
      // 0 sièges configurés = illimité (démo)
      seats_available: seats > 0 ? Math.max(0, seats - seats_used) : null
    }
  }

  async forceConfigSync(orgId: string) {
    const policy = this.policies.get(orgId)
    if (!policy) return { ok: false as const, error: "policy_missing" }
    const next: Policy = {
      ...policy,
      version: policy.version + 1,
      configEpoch: policy.configEpoch + 1,
      updatedAt: new Date().toISOString()
    }
    this.policies.set(orgId, next)
    const agents = [...this.agents.values()].filter((a) => a.orgId === orgId)
      .length
    return {
      ok: true as const,
      configEpoch: next.configEpoch,
      policyVersion: next.version,
      agents
    }
  }

  async requestPasswordResetOtp(orgId: string) {
    const org = this.orgs.get(orgId)
    const principal = await this.getPrincipalAdmin(orgId)
    const targetEmail = principal?.email || org?.primaryEmail || ""
    const otp = newOtpCode(6)
    const expiresIn = 10 * 60
    this.otpChallenges.set(orgId, {
      orgId,
      codeHash: hashManagementPassword(otp),
      expiresAt: Date.now() + expiresIn * 1000,
      createdAt: Date.now()
    })
    console.log(
      `[opsgate-otp] PRINCIPAL password reset → ${targetEmail} OTP=${otp} (dev — would email)`
    )
    return {
      ok: true as const,
      expires_in_sec: expiresIn,
      dev_otp: otp,
      message: `OTP envoyé à l'email principal (${targetEmail || "—"}) pour reset Administrator. Prod : email réel.`
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
    // Principal : min 6 après reset (plus de 0000)
    if (!newPassword || newPassword.length < 6) {
      return { ok: false as const, error: "password_too_short" }
    }
    const principal = await this.getPrincipalAdmin(orgId)
    if (!principal) return { ok: false as const, error: "principal_missing" }
    const hash = hashManagementPassword(newPassword)
    principal.passwordHash = hash
    principal.mustChangePassword = false
    principal.updatedAt = new Date().toISOString()
    await this.syncLegacyMgmtHash(orgId)
    await this.updatePolicy(orgId, { managementPasswordHash: hash })
    this.otpChallenges.delete(orgId)
    return { ok: true as const }
  }

  async recordUnenrollAndRevoke(
    orgId: string,
    agentId: string,
    token: string,
    exit: ExitActor
  ) {
    const agent = this.agents.get(agentId)
    if (!agent || agent.orgId !== orgId) return { ok: false }

    const now = new Date().toISOString()
    const exitActor =
      exit.type === "admin"
        ? `admin:${exit.admin_label || exit.admin_id || "unknown"}`
        : exit.type

    const ev: StoredEvent = {
      id: newId("evt"),
      orgId,
      agentId,
      schema_version: 1,
      client_event_id: `unenroll-${agentId}-${Date.now()}`,
      ts: now,
      source: "system",
      hostname: "opsgate-agent",
      decision: "unenroll",
      detection_count: 0,
      highest_severity: "warning",
      rule_ids: ["system.unenroll"],
      types: ["unenroll", exitActor],
      masked: false,
      exit_actor: exitActor,
      exit_admin_id: exit.admin_id,
      exit_admin_label: exit.admin_label,
      device_label: agent.deviceLabel,
      receivedAt: now
    }
    this.events.push(ev)

    const hash = hashToken(token)
    this.agentsByTokenHash.delete(hash)
    this.agents.delete(agentId)

    return { ok: true, event_id: ev.id }
  }

  async listPacks(orgId: string) {
    return [...(this.packs.get(orgId) || [])].sort((a, b) =>
      b.publishedAt.localeCompare(a.publishedAt)
    )
  }

  async getPack(orgId: string, version: string) {
    return (this.packs.get(orgId) || []).find((p) => p.version === version)
  }

  async getActivePack(orgId: string) {
    const list = this.packs.get(orgId) || []
    return list.find((p) => p.active) || list[list.length - 1]
  }

  async getActivePackPayload(
    orgId: string
  ): Promise<RulesPackPayload | undefined> {
    const pack = await this.getActivePack(orgId)
    return pack ? toPayload(pack) : undefined
  }

  async publishPack(input: PublishPackInput): Promise<PublishPackResult> {
    const policy = this.policies.get(input.orgId)
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

    const versions = (this.packs.get(input.orgId) || []).map((p) => p.version)
    const base = (await this.getActivePack(input.orgId))?.version
    const version = nextFreeVersion(versions, base)

    const activate = input.activate !== false
    const pack = materializePack({
      orgId: input.orgId,
      version,
      rules,
      notes: input.notes,
      publishedBy: input.publishedBy,
      active: activate
    })

    const list = this.packs.get(input.orgId) || []
    if (activate) {
      for (const p of list) p.active = false
    }
    list.push(pack)
    this.packs.set(input.orgId, list)

    let nextPolicy = policy
    if (activate) {
      nextPolicy = {
        ...policy,
        version: policy.version + 1,
        configEpoch: (policy.configEpoch || 0) + 1,
        rulesPackVersion: pack.version,
        updatedAt: new Date().toISOString()
      }
      this.policies.set(input.orgId, nextPolicy)
    }

    return { ok: true, pack, policy: nextPolicy }
  }

  async activatePack(
    orgId: string,
    version: string
  ): Promise<ActivatePackResult> {
    const list = this.packs.get(orgId)
    const policy = this.policies.get(orgId)
    if (!list || !policy) return { ok: false, error: "org_missing" }
    const pack = list.find((p) => p.version === version)
    if (!pack) return { ok: false, error: "pack_not_found" }

    for (const p of list) p.active = p.version === version
    const nextPolicy: Policy = {
      ...policy,
      version: policy.version + 1,
      configEpoch: (policy.configEpoch || 0) + 1,
      rulesPackVersion: pack.version,
      updatedAt: new Date().toISOString()
    }
    this.policies.set(orgId, nextPolicy)
    return { ok: true, pack, policy: nextPolicy }
  }

  private pushSystemEvent(
    orgId: string,
    agentId: string,
    decision: "enroll" | "unenroll",
    extra: Partial<DetectionEventInput> = {}
  ) {
    const now = new Date().toISOString()
    const severity =
      decision === "unenroll" ? ("warning" as const) : ("low" as const)
    this.events.push({
      id: newId("evt"),
      orgId,
      agentId,
      schema_version: 1,
      client_event_id: `${decision}-${agentId}-${Date.now()}`,
      ts: now,
      source: "system",
      hostname: "opsgate-agent",
      decision,
      detection_count: 0,
      highest_severity: severity,
      rule_ids: [`system.${decision}`],
      types: [decision],
      masked: false,
      receivedAt: now,
      ...extra
    })
  }

  async enrollAgent(input: {
    orgId: string
    token: string
    deviceLabel?: string
    hostName?: string
    appVersion?: string
    userId?: string
    personalLicenseKey?: string
  }): Promise<Agent & { replaced?: boolean }> {
    const now = new Date().toISOString()
    const tokenHash = hashToken(input.token)
    const labelKey = (input.deviceLabel || "").trim().toLowerCase()
    const org = this.orgs.get(input.orgId)
    const personal = !!org?.isPersonal

    // Sièges / licence personnelle
    let assignLicense = true
    if (personal) {
      // Usage personnel : clé de licence obligatoire pour activer le siège
      assignLicense = isValidPersonalLicenseKey(input.personalLicenseKey)
    } else if (org?.licenseSeats && org.licenseSeats > 0) {
      const used = [...this.agents.values()].filter(
        (a) => a.orgId === input.orgId && a.licenseAssigned
      ).length
      assignLicense = used < org.licenseSeats
    }

    if (labelKey) {
      for (const existing of this.agents.values()) {
        if (
          existing.orgId === input.orgId &&
          (existing.deviceLabel || "").trim().toLowerCase() === labelKey
        ) {
          this.agentsByTokenHash.delete(existing.tokenHash)
          const replaced: Agent & { replaced?: boolean } = {
            ...existing,
            tokenHash,
            appVersion: input.appVersion ?? existing.appVersion,
            lastSeenAt: now,
            deviceLabel: input.deviceLabel || existing.deviceLabel,
            hostName: input.hostName ?? existing.hostName,
            userId: input.userId ?? existing.userId,
            personalAccount: personal,
            licenseAssigned:
              existing.licenseAssigned || assignLicense || personal,
            replaced: true
          }
          this.agents.set(existing.id, replaced)
          this.agentsByTokenHash.set(tokenHash, existing.id)
          this.pushSystemEvent(input.orgId, existing.id, "enroll", {
            types: ["enroll", "re_enroll"],
            device_label: replaced.deviceLabel,
            rule_ids: ["system.enroll"]
          })
          await this.applyMovingRules(input.orgId, existing.id)
          return replaced
        }
      }
    }

    const agent: Agent & { replaced?: boolean } = {
      id: newId("agt"),
      orgId: input.orgId,
      deviceLabel: input.deviceLabel,
      hostName: input.hostName,
      enrolledAt: now,
      tokenHash,
      appVersion: input.appVersion,
      lastSeenAt: now,
      userId: input.userId,
      licenseAssigned: personal ? true : assignLicense,
      personalAccount: personal,
      unlicensedSince: assignLicense || personal ? undefined : now,
      replaced: false
    }
    this.agents.set(agent.id, agent)
    this.agentsByTokenHash.set(tokenHash, agent.id)
    this.pushSystemEvent(input.orgId, agent.id, "enroll", {
      device_label: agent.deviceLabel,
      rule_ids: ["system.enroll"]
    })
    await this.applyMovingRules(input.orgId, agent.id)
    return agent
  }

  async resolveAgentByToken(token: string): Promise<Agent | undefined> {
    const hash = hashToken(token)
    const id = this.agentsByTokenHash.get(hash)
    if (!id) return undefined
    const agent = this.agents.get(id)
    if (!agent) return undefined
    agent.lastSeenAt = new Date().toISOString()
    return agent
  }

  async revokeAgentByToken(token: string): Promise<boolean> {
    const hash = hashToken(token)
    const id = this.agentsByTokenHash.get(hash)
    if (!id) return false
    this.agentsByTokenHash.delete(hash)
    this.agents.delete(id)
    return true
  }

  async revokeAgentById(
    orgId: string,
    agentId: string,
    exit?: ExitActor
  ): Promise<boolean> {
    const agent = this.agents.get(agentId)
    if (!agent || agent.orgId !== orgId) return false
    const exitActor =
      exit?.type === "admin"
        ? `admin:${exit.admin_label || exit.admin_id || "unknown"}`
        : exit?.type || "admin:console"
    this.pushSystemEvent(orgId, agentId, "unenroll", {
      types: ["unenroll", exitActor, "console_revoke"],
      device_label: agent.deviceLabel,
      rule_ids: ["system.unenroll"],
      exit_actor: exitActor,
      exit_admin_id: exit?.admin_id,
      exit_admin_label: exit?.admin_label
    })
    this.agentsByTokenHash.delete(agent.tokenHash)
    this.agents.delete(agentId)
    // events conservés en mémoire (agentId orphelin OK)
    return true
  }

  async listAgents(orgId: string) {
    return [...this.agents.values()].filter((a) => a.orgId === orgId)
  }

  async appendEvents(
    orgId: string,
    agentId: string,
    events: DetectionEventInput[]
  ): Promise<AppendEventsResult> {
    const rejected: { index: number; reason: string }[] = []
    let accepted = 0
    const now = new Date().toISOString()

    events.forEach((ev, index) => {
      const banned = ["prompt", "text", "content", "file_content"] as const
      for (const key of banned) {
        if (key in (ev as object)) {
          rejected.push({ index, reason: `forbidden_field:${key}` })
          return
        }
      }
      if (!ev.client_event_id || !ev.ts || !ev.hostname) {
        rejected.push({ index, reason: "missing_required_fields" })
        return
      }
      if (
        this.events.some(
          (e) => e.agentId === agentId && e.client_event_id === ev.client_event_id
        )
      ) {
        accepted++
        return
      }
      // Normalisation sévérité : cancel → low ; system.unenroll → warning
      let severity = ev.highest_severity
      if (ev.decision === "cancel") severity = "low"
      if (
        ev.decision === "unenroll" ||
        (ev.rule_ids || []).includes("system.unenroll")
      ) {
        severity = "warning"
      }
      this.events.push({
        ...ev,
        highest_severity: severity,
        id: newId("evt"),
        orgId,
        agentId,
        receivedAt: now
      })
      accepted++
    })

    if (this.events.length > 5000) {
      this.events = this.events.slice(-4000)
    }

    return { accepted, rejected }
  }

  async listEvents(orgId: string, limit = 50) {
    return this.events
      .filter((e) => e.orgId === orgId)
      .slice(-limit)
      .reverse()
  }

  async summary(orgId: string): Promise<OrgSummary> {
    const events = this.events.filter((e) => e.orgId === orgId)
    const byDecision: Record<string, number> = {}
    const byRule: Record<string, number> = {}
    for (const e of events) {
      byDecision[e.decision] = (byDecision[e.decision] || 0) + 1
      for (const r of e.rule_ids || []) {
        byRule[r] = (byRule[r] || 0) + 1
      }
      for (const t of e.types || []) {
        if (!e.rule_ids?.length) byRule[t] = (byRule[t] || 0) + 1
      }
    }
    const top_rules = Object.entries(byRule)
      .map(([rule_id, count]) => ({ rule_id, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
    const active = await this.getActivePack(orgId)
    const packs = this.packs.get(orgId) || []
    return {
      org_id: orgId,
      agents: [...this.agents.values()].filter((a) => a.orgId === orgId).length,
      events_total: events.length,
      by_decision: byDecision,
      top_rules,
      active_rules_pack: active
        ? {
            version: active.version,
            rules_count: active.rules.length,
            checksum: active.checksum
          }
        : null,
      packs_published: packs.length,
      admins_count: (this.admins.get(orgId) || []).length,
      groups_count: (this.groups.get(orgId) || []).length,
      users_count: (this.users.get(orgId) || []).length
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
    this.adminAudit.push({
      id: newId("aud"),
      orgId: input.orgId,
      adminId: input.adminId,
      adminEmail: input.adminEmail,
      adminLabel: input.adminLabel,
      action: input.action,
      detail: input.detail,
      meta: input.meta,
      createdAt: new Date().toISOString()
    })
    if (this.adminAudit.length > 2000) {
      this.adminAudit = this.adminAudit.slice(-1500)
    }
  }

  async listAdminAudit(
    orgId: string,
    opts?: { limit?: number; action?: string }
  ) {
    let list = this.adminAudit.filter((e) => e.orgId === orgId)
    if (opts?.action) {
      list = list.filter((e) => e.action === opts.action)
    }
    return list.slice(-(opts?.limit || 100)).reverse()
  }

  private normalizeMovingConditions(
    input: {
      conditions?: import("./types").MovingCondition[]
      matchField?: import("./types").MovingMatchField
      matchOp?: import("./types").MovingMatchOp
      matchValue?: string
    }
  ): import("./types").MovingCondition[] {
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
    return [...(this.movingRules.get(orgId) || [])].sort(
      (a, b) => a.priority - b.priority || a.createdAt.localeCompare(b.createdAt)
    )
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
    if (!this.orgs.has(orgId)) return undefined
    const conditions = this.normalizeMovingConditions(input)
    if (conditions.length === 0) return undefined
    const first = conditions[0]
    const list = this.movingRules.get(orgId) || []
    const now = new Date().toISOString()
    if (input.id) {
      const idx = list.findIndex((r) => r.id === input.id)
      if (idx < 0) return undefined
      list[idx] = {
        ...list[idx],
        name: input.name,
        enabled: input.enabled !== false,
        conditions,
        matchField: first.field,
        matchOp: first.op,
        matchValue: first.value,
        targetGroupId: input.targetGroupId,
        priority: input.priority ?? list[idx].priority,
        onlyIfUnassigned:
          input.onlyIfUnassigned !== undefined
            ? input.onlyIfUnassigned
            : list[idx].onlyIfUnassigned,
        updatedAt: now
      }
      this.movingRules.set(orgId, list)
      return list[idx]
    }
    const created: import("./types").MovingRule = {
      id: newId("mvr"),
      orgId,
      name: input.name,
      enabled: input.enabled !== false,
      conditions,
      matchField: first.field,
      matchOp: first.op,
      matchValue: first.value,
      targetGroupId: input.targetGroupId,
      priority: input.priority ?? 100,
      onlyIfUnassigned: input.onlyIfUnassigned !== false,
      createdAt: now,
      updatedAt: now
    }
    list.push(created)
    this.movingRules.set(orgId, list)
    return created
  }

  async deleteMovingRule(orgId: string, ruleId: string) {
    const list = this.movingRules.get(orgId) || []
    const next = list.filter((r) => r.id !== ruleId)
    if (next.length === list.length) return false
    this.movingRules.set(orgId, next)
    return true
  }

  private matchMovingRule(value: string, op: string, pattern: string): boolean {
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
    const agent = this.agents.get(agentId)
    if (!agent || agent.orgId !== orgId) return { applied: false as const }
    const rules = await this.listMovingRules(orgId)
    for (const rule of rules.filter((r) => r.enabled)) {
      if (rule.onlyIfUnassigned && (agent.policyProfileId || agent.groupId)) {
        continue
      }
      if (!this.ruleMatchesAgent(rule, agent)) continue
      const group = (this.groups.get(orgId) || []).find(
        (g) => g.id === rule.targetGroupId
      )
      if (!group) continue
      agent.groupId = group.id
      if (group.policyProfileId) agent.policyProfileId = group.policyProfileId
      agent.lastSeenAt = new Date().toISOString()
      return { applied: true as const, ruleId: rule.id, groupId: group.id }
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
      const g = (this.groups.get(orgId) || []).find((x) => x.id === opts.groupId)
      if (g?.policyProfileId && profileId === undefined) {
        profileId = g.policyProfileId
      }
    }
    for (const id of agentIds) {
      const a = this.agents.get(id)
      if (!a || a.orgId !== orgId) continue
      if (opts.groupId !== undefined) a.groupId = opts.groupId || undefined
      if (profileId !== undefined) a.policyProfileId = profileId || undefined
      a.lastSeenAt = new Date().toISOString()
      updated++
    }
    if (updated > 0) await this.forceConfigSync(orgId)
    return { updated }
  }
}
