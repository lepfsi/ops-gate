import type { DetectionRule } from "@opsgate/engine"

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
  private logExports = new Map<string, import("./types").LogExportRecord[]>()
  private recoveryCodes = new Map<string, import("./types").RecoveryCode[]>()
  private inboxMessages: import("./types").UserInboxMessage[] = []
  private orgAiTools = new Map<string, import("./types").OrgAiTool[]>()

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
      // Même couverture large que l’org démo (mode personnel)
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

  async listOrgs() {
    return [...this.orgs.values()]
  }

  async setOrgLicenseSeats(orgId: string, seats: number) {
    const org = this.orgs.get(orgId)
    if (!org) return undefined
    org.licenseSeats = Math.max(0, Math.floor(seats) || 0)
    return org
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
    const org = this.orgs.get(orgId)
    if (!org) return undefined
    org.deletedAt = meta.deletedAt
    org.deletePurgeAt = meta.deletePurgeAt
    org.deleteReason = meta.deleteReason || null
    org.deleteRequestedBy = meta.deleteRequestedBy || null
    return org
  }

  async restoreOrg(orgId: string) {
    const org = this.orgs.get(orgId)
    if (!org) return undefined
    org.deletedAt = null
    org.deletePurgeAt = null
    org.deleteReason = null
    org.deleteRequestedBy = null
    return org
  }

  async hardDeleteOrg(orgId: string) {
    const org = this.orgs.get(orgId)
    if (!org) return false
    this.orgs.delete(orgId)
    this.orgsByCode.delete(org.orgCode.toUpperCase())
    this.policies.delete(orgId)
    this.profiles.delete(orgId)
    this.groups.delete(orgId)
    this.users.delete(orgId)
    this.admins.delete(orgId)
    this.packs.delete(orgId)
    // agents
    for (const [id, a] of [...this.agents.entries()]) {
      if (a.orgId === orgId) {
        if (a.tokenHash) this.agentsByTokenHash.delete(a.tokenHash)
        this.agents.delete(id)
      }
    }
    this.events = this.events.filter((e) => e.orgId !== orgId)
    this.adminAudit = this.adminAudit.filter((e) => e.orgId !== orgId)
    this.movingRules.delete(orgId)
    this.logExports.delete(orgId)
    this.recoveryCodes.delete(orgId)
    this.inboxMessages = this.inboxMessages.filter((m) => m.orgId !== orgId)
    this.orgAiTools.delete(orgId)
    // sessions
    for (const [tok, s] of [...this.sessions.entries()]) {
      if (s.orgId === orgId) this.sessions.delete(tok)
    }
    return true
  }

  async listOrgsDueForHardPurge() {
    const now = Date.now()
    return [...this.orgs.values()].filter(
      (o) =>
        o.deletedAt &&
        o.deletePurgeAt &&
        Date.parse(o.deletePurgeAt) <= now
    )
  }

  async revokeAllOrgSessions(orgId: string) {
    let n = 0
    for (const [tok, s] of [...this.sessions.entries()]) {
      if (s.orgId === orgId) {
        this.sessions.delete(tok)
        n++
      }
    }
    return n
  }

  private issuedLicenses: import("./license-keys").IssuedLicenseRecord[] = []

  async ensureDefaultPack(
    orgId: string
  ): Promise<import("./types").StoredRulePack | undefined> {
    const list = this.packs.get(orgId) || []
    const existing = list.find((p) => p.active) || list[list.length - 1]
    if (existing) {
      existing.active = true
      return existing
    }
    const { buildGlobalRulesPack, materializePack } = await import(
      "./rules-pack"
    )
    const global = buildGlobalRulesPack("1.0.0")
    const pack = materializePack({
      orgId,
      version: global.version,
      rules: global.rules,
      notes: "default-pack-auto",
      publishedBy: "system-ensure",
      active: true
    })
    for (const p of list) p.active = false
    list.push(pack)
    this.packs.set(orgId, list)
    const pol = this.policies.get(orgId)
    if (pol) {
      pol.rulesPackVersion = pack.version
      this.policies.set(orgId, pol)
    }
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
    const key = generateShortLicenseKey()
    this.issuedLicenses.push({
      id: `lic_${Date.now()}`,
      licenseKey: key,
      ...payload,
      kind: payload.kind === "seat_topup" ? "seat_topup" : "full",
      revokedAt: null
    })
    return { licenseKey: key, payload }
  }

  async lookupIssuedLicense(licenseKey: string) {
    const { normalizeLicenseKey } = await import("./license-keys")
    const key = normalizeLicenseKey(licenseKey)
    return this.issuedLicenses.find((l) => l.licenseKey === key)
  }

  async revokeIssuedLicense(licenseKey: string) {
    const { normalizeLicenseKey } = await import("./license-keys")
    const key = normalizeLicenseKey(licenseKey)
    const rec = this.issuedLicenses.find((l) => l.licenseKey === key)
    if (!rec || rec.revokedAt) return false
    rec.revokedAt = new Date().toISOString()
    return true
  }

  async listIssuedLicenses() {
    return [...this.issuedLicenses].sort((a, b) =>
      b.issuedAt.localeCompare(a.issuedAt)
    )
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
    const org: import("./types").Organization = {
      id: orgId,
      name: input.companyName.trim() || code,
      slug: code.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 48),
      orgCode: code,
      modeDefault: "org_managed",
      eventPayloadPolicy: "metadata_only",
      primaryEmail: email,
      isPersonal: false,
      licenseSeats: seats,
      createdAt: now
    }
    const global = buildGlobalRulesPack("1.0.0")
    const pack = materializePack({
      orgId,
      version: global.version,
      rules: global.rules,
      notes: "tenant-provision",
      publishedBy: "vendor-desk",
      active: true
    })
    const policy: import("./types").Policy = {
      id: newId("pol"),
      orgId,
      version: 1,
      defaultAction: "mask_recommend",
      enabledHosts: [
        "chatgpt.com",
        "chat.openai.com",
        "claude.ai",
        "gemini.google.com",
        "copilot.microsoft.com",
        "perplexity.ai",
        "grok.com"
      ],
      scanUploads: true,
      eventReporting: true,
      rulesPackVersion: pack.version,
      managementPasswordHash: hashManagementPassword(PRINCIPAL_DEFAULT_PASSWORD),
      protectUnenroll: true,
      configEpoch: 1,
      updatedAt: now
    }
    const principal: import("./types").OrgAdmin = {
      id: newId("adm"),
      orgId,
      label: "Administrator",
      email,
      passwordHash: hashManagementPassword(PRINCIPAL_DEFAULT_PASSWORD),
      isPrincipal: true,
      permissions: [...ALL_ADMIN_PERMISSIONS],
      active: true,
      mustChangePassword: true,
      createdAt: now,
      updatedAt: now
    }
    this.orgs.set(orgId, org)
    this.orgsByCode.set(code, orgId)
    this.policies.set(orgId, policy)
    this.packs.set(orgId, [pack])
    this.admins.set(orgId, [principal])
    this.profiles.set(orgId, [])
    this.groups.set(orgId, [])
    this.users.set(orgId, [])
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
    const org = this.orgs.get(orgId)
    if (!org) return undefined
    const { mergeMonitoringSettings } = await import("./types")
    org.monitoring = mergeMonitoringSettings({
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
    return org
  }

  async mergeAgents(orgId: string, keepId: string, mergeIds: string[]) {
    const ids = [...new Set(mergeIds.filter((id) => id && id !== keepId))]
    if (!ids.length) return { ok: false as const, kept: keepId, removed: 0 }
    const keep = this.agents.get(keepId)
    if (!keep || keep.orgId !== orgId) {
      return { ok: false as const, kept: keepId, removed: 0 }
    }
    let removed = 0
    for (const mid of ids) {
      const other = this.agents.get(mid)
      if (!other || other.orgId !== orgId) continue
      for (const e of this.events) {
        if (e.orgId === orgId && e.agentId === mid) e.agentId = keepId
      }
      if (!keep.deviceFingerprint && other.deviceFingerprint) {
        keep.deviceFingerprint = other.deviceFingerprint
      }
      if (
        new Date(other.lastSeenAt).getTime() >
        new Date(keep.lastSeenAt).getTime()
      ) {
        keep.lastSeenAt = other.lastSeenAt
      }
      this.agentsByTokenHash.delete(other.tokenHash)
      this.agents.delete(mid)
      removed++
    }
    await this.forceConfigSync(orgId)
    return { ok: true as const, kept: keepId, removed }
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
        | "fileScan"
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
    const policy = this.policies.get(orgId)
    if (!policy) return undefined
    const { mergePolicyFileScan } = await import("./types")
    const next: Policy = {
      ...policy,
      ...patch,
      fileScan:
        patch.fileScan !== undefined
          ? mergePolicyFileScan({
              ...(policy.fileScan || {}),
              ...patch.fileScan
            })
          : mergePolicyFileScan(policy.fileScan),
      userMessages:
        patch.userMessages !== undefined
          ? { ...(policy.userMessages || {}), ...patch.userMessages }
          : policy.userMessages,
      workSchedule:
        patch.workSchedule !== undefined
          ? patch.workSchedule
          : policy.workSchedule,
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
      unlock?: boolean
    }
  ) {
    if (!this.orgs.has(orgId)) return undefined
    const list = this.admins.get(orgId) || []
    const now = new Date().toISOString()
    const email = input.email.trim().toLowerCase()
    if (!email.includes("@")) return undefined
    const { validatePasswordPolicy, pushPasswordHistory } = await import(
      "./crypto"
    )

    if (input.id) {
      const idx = list.findIndex((a) => a.id === input.id)
      if (idx < 0) return undefined
      const prev = list[idx]
      if (list.some((a) => a.id !== prev.id && a.email === email)) {
        return undefined
      }
      const isPrincipal =
        input.isPrincipal !== undefined ? !!input.isPrincipal : prev.isPrincipal
      const next: OrgAdmin = {
        ...prev,
        label: input.label.trim() || prev.label,
        email,
        active: input.active !== undefined ? input.active : prev.active,
        isPrincipal,
        permissions: isPrincipal
          ? [...ALL_ADMIN_PERMISSIONS]
          : input.permissions ?? prev.permissions,
        mustChangePassword:
          input.mustChangePassword !== undefined
            ? input.mustChangePassword
            : prev.mustChangePassword,
        failedLoginCount: input.unlock ? 0 : prev.failedLoginCount ?? 0,
        lockedAt: input.unlock ? null : prev.lockedAt ?? null,
        updatedAt: now
      }
      if (input.password) {
        const pol = validatePasswordPolicy(input.password, {
          currentHash: prev.passwordHash,
          history: prev.passwordHistory
        })
        if (!pol.ok) return undefined
        next.passwordHistory = pushPasswordHistory(
          prev.passwordHash,
          prev.passwordHistory
        )
        next.passwordHash = hashManagementPassword(input.password)
        if (input.mustChangePassword === undefined) {
          next.mustChangePassword = false
        }
      }
      list[idx] = next
      this.admins.set(orgId, list)
      // Sync e-mail install org si principal
      if (isPrincipal) {
        const org = this.orgs.get(orgId)
        if (org) org.primaryEmail = email
      }
      await this.syncLegacyMgmtHash(orgId)
      await this.forceConfigSync(orgId)
      return next
    }

    if (!input.password) return undefined
    const pol = validatePasswordPolicy(input.password)
    if (!pol.ok) return undefined
    if (list.some((a) => a.email === email)) return undefined

    const asPrincipal = !!input.isPrincipal
    const created: OrgAdmin = {
      id: newId("adm"),
      orgId,
      label: input.label.trim() || `admin${list.length + 1}`,
      email,
      passwordHash: hashManagementPassword(input.password),
      passwordHistory: [],
      isPrincipal: asPrincipal,
      permissions: asPrincipal
        ? [...ALL_ADMIN_PERMISSIONS]
        : input.permissions?.length
          ? input.permissions
          : ["console_access"],
      active: input.active !== false,
      mustChangePassword: false,
      failedLoginCount: 0,
      lockedAt: null,
      createdAt: now,
      updatedAt: now
    }
    if (!created.isPrincipal && !created.permissions.includes("console_access")) {
      created.permissions = ["console_access", ...created.permissions]
    }
    list.push(created)
    this.admins.set(orgId, list)
    await this.syncLegacyMgmtHash(orgId)
    await this.forceConfigSync(orgId)
    return created
  }

  async recordAdminLoginFailure(adminId: string, threshold: number) {
    const thr = Math.max(3, Math.min(50, Math.floor(threshold) || 5))
    for (const [orgId, list] of this.admins) {
      const idx = list.findIndex((a) => a.id === adminId)
      if (idx < 0) continue
      const prev = list[idx]
      const count = (prev.failedLoginCount || 0) + 1
      const locked = count >= thr
      const next: OrgAdmin = {
        ...prev,
        failedLoginCount: count,
        lockedAt: locked ? prev.lockedAt || new Date().toISOString() : prev.lockedAt,
        updatedAt: new Date().toISOString()
      }
      list[idx] = next
      this.admins.set(orgId, list)
      return { locked: !!next.lockedAt, count, admin: next }
    }
    return { locked: false, count: 0 }
  }

  async clearAdminLoginFailures(adminId: string) {
    for (const [orgId, list] of this.admins) {
      const idx = list.findIndex((a) => a.id === adminId)
      if (idx < 0) continue
      list[idx] = {
        ...list[idx],
        failedLoginCount: 0,
        lockedAt: null,
        updatedAt: new Date().toISOString()
      }
      this.admins.set(orgId, list)
      return
    }
  }

  async unlockAdmin(orgId: string, adminId: string) {
    const list = this.admins.get(orgId) || []
    const idx = list.findIndex((a) => a.id === adminId)
    if (idx < 0) return undefined
    list[idx] = {
      ...list[idx],
      failedLoginCount: 0,
      lockedAt: null,
      updatedAt: new Date().toISOString()
    }
    this.admins.set(orgId, list)
    return list[idx]
  }

  async findAdminsByEmail(email: string) {
    const emailNorm = email.trim().toLowerCase()
    const out: OrgAdmin[] = []
    for (const [orgId, list] of this.admins) {
      if (this.orgs.get(orgId)?.isPersonal) continue
      for (const a of list) {
        if (a.active && a.email === emailNorm) out.push(a)
      }
    }
    return out
  }

  async listAccessibleOrgsForEmail(email: string) {
    const emailNorm = (email || "").trim().toLowerCase()
    if (!emailNorm || !emailNorm.includes("@")) return []
    const out: Array<{
      org_id: string
      org_code: string
      name: string
      is_principal: boolean
      admin_id: string
    }> = []
    for (const [orgId, list] of this.admins) {
      const org = this.orgs.get(orgId)
      if (!org || org.isPersonal) continue
      // Uniquement un compte actif, non verrouillé, avec accès console
      const admin = list.find(
        (a) =>
          a.active &&
          !a.lockedAt &&
          a.email === emailNorm &&
          (a.isPrincipal ||
            (Array.isArray(a.permissions) &&
              a.permissions.includes("console_access")))
      )
      if (!admin) continue
      out.push({
        org_id: orgId,
        org_code: org.orgCode || orgId,
        name: org.name || orgId,
        is_principal: !!admin.isPrincipal,
        admin_id: admin.id
      })
    }
    out.sort((a, b) => a.name.localeCompare(b.name, "fr"))
    return out
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
    const email = resolved.admin.email
    const peers = await this.listAccessibleOrgsForEmail(email)
    const hit = peers.find((p) => p.org_id === targetOrgId)
    if (!hit) return { ok: false as const, error: "org_not_accessible" }
    const list = this.admins.get(targetOrgId) || []
    const targetAdmin = list.find((a) => a.id === hit.admin_id)
    if (!targetAdmin || !targetAdmin.active) {
      return { ok: false as const, error: "admin_not_found" }
    }
    if (targetAdmin.lockedAt) {
      return { ok: false as const, error: "account_locked" }
    }
    // Révoquer la session courante
    this.sessions.delete(opts.currentToken)
    const issued = await this.issueAdminSession(targetOrgId, targetAdmin, {
      force: opts.force !== false // défaut force pour bascule fluide
    })
    if (!issued.ok) return issued
    return issued
  }

  async deleteAdmin(orgId: string, adminId: string) {
    const list = this.admins.get(orgId) || []
    const target = list.find((a) => a.id === adminId)
    if (!target) return false
    if (target.isPrincipal) {
      const principals = list.filter((a) => a.isPrincipal && a.active)
      if (principals.length <= 1) return false
    }
    const next = list.filter((a) => a.id !== adminId)
    this.admins.set(orgId, next)
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

  /** Idle serveur : sans heartbeat console, la session expire (évite lockout fantôme). */
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
    const list = this.admins.get(orgId) || []
    const idx = list.findIndex((a) => a.id === adminId)
    if (idx < 0) return undefined
    const prev = list[idx]
    const next: OrgAdmin = {
      ...prev,
      totpEnabled:
        fields.totpEnabled !== undefined
          ? !!fields.totpEnabled
          : prev.totpEnabled,
      totpSecret:
        fields.totpSecret !== undefined ? fields.totpSecret : prev.totpSecret,
      totpPendingSecret:
        fields.totpPendingSecret !== undefined
          ? fields.totpPendingSecret
          : prev.totpPendingSecret,
      updatedAt: new Date().toISOString()
    }
    list[idx] = next
    this.admins.set(orgId, list)
    return next
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
    type Cand = {
      orgId: string
      admin: OrgAdmin
      personal: boolean
      orgCode: string
      orgName: string
    }
    const candidates: Cand[] = []
    for (const [orgId, list] of this.admins) {
      const admin = list.find(
        (a) => a.active && a.email === emailNorm && a.passwordHash === hash
      )
      if (!admin) continue
      if (!admin.isPrincipal && !admin.permissions.includes("console_access")) {
        continue
      }
      const org = this.orgs.get(orgId)
      candidates.push({
        orgId,
        admin,
        personal: !!org?.isPersonal,
        orgCode: org?.orgCode || orgId,
        orgName: org?.name || orgId
      })
    }
    candidates.sort((a, b) => Number(a.personal) - Number(b.personal))
    if (candidates.length === 0) {
      return { ok: false as const, error: "invalid_credentials" }
    }
    let filtered = candidates
    if (opts?.orgId) {
      filtered = candidates.filter((c) => c.orgId === opts.orgId)
    } else if (opts?.orgCode) {
      const code = opts.orgCode.trim().toUpperCase()
      filtered = candidates.filter(
        (c) => c.orgCode.toUpperCase() === code
      )
    }
    if (filtered.length === 0) {
      return { ok: false as const, error: "invalid_credentials" }
    }
    if (filtered.length > 1 && !opts?.orgId && !opts?.orgCode) {
      return {
        ok: false as const,
        error: "org_selection_required" as const,
        orgs: filtered.map((c) => ({
          org_id: c.orgId,
          org_code: c.orgCode,
          name: c.orgName
        }))
      }
    }
    const hit = filtered[0]!
    if (hit.admin.lockedAt) {
      return { ok: false as const, error: "account_locked" }
    }
    if (hit.admin.totpEnabled && hit.admin.totpSecret) {
      const code = (opts?.totpCode || "").trim()
      if (!code) {
        return { ok: false as const, error: "mfa_required" }
      }
      const { verifyTotp } = await import("./totp")
      if (!verifyTotp(hit.admin.totpSecret, code)) {
        return { ok: false as const, error: "mfa_invalid" }
      }
    }
    return this.issueAdminSession(hit.orgId, hit.admin, {
      force: opts?.force,
      readOnly: opts?.readOnly
    })
  }

  async createAdminSessionOidc(
    email: string,
    opts?: { force?: boolean; readOnly?: boolean }
  ) {
    const emailNorm = email.trim().toLowerCase()
    type Cand = { orgId: string; admin: OrgAdmin; personal: boolean }
    const candidates: Cand[] = []
    for (const [orgId, list] of this.admins) {
      const admin = list.find((a) => a.active && a.email === emailNorm)
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
    if (!hit) return { ok: false as const, error: "admin_not_found" }
    if (hit.admin.lockedAt) {
      return { ok: false as const, error: "account_locked" }
    }
    // SSO : MFA local non exigé (IdP a authentifié)
    return this.issueAdminSession(hit.orgId, hit.admin, {
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
    const admin = (this.admins.get(opts.orgId) || []).find(
      (a) => a.id === opts.adminId && a.active
    )
    if (!admin) return { ok: false as const, error: "admin_not_found" }
    if (admin.lockedAt) return { ok: false as const, error: "account_locked" }
    return this.issueAdminSession(opts.orgId, admin, {
      force: opts.force,
      readOnly: opts.readOnly
    })
  }

  private async issueAdminSession(
    orgId: string,
    admin: OrgAdmin,
    opts?: { force?: boolean; readOnly?: boolean }
  ) {
    await this.clearAdminLoginFailures(admin.id)
    const now = Date.now()
    const idleMs = MemoryStore.SESSION_IDLE_MS
    const readOnly = !!opts?.readOnly
    const force = !!opts?.force
    let forced = false
    let hasActiveFull = false
    for (const [tok, sess] of this.sessions) {
      if (sess.adminId !== admin.id) continue
      const last = sess.lastActivityAt || sess.createdAt
      if (now > sess.expiresAt || now - last > idleMs) {
        this.sessions.delete(tok)
        continue
      }
      if (force) {
        this.sessions.delete(tok)
        forced = true
        continue
      }
      // Lecture seule : coexiste avec une session full (pas de kick)
      if (readOnly) continue
      // Session full demandée alors qu’une full active existe
      if (!sess.readOnly) {
        hasActiveFull = true
      }
    }
    if (hasActiveFull && !force && !readOnly) {
      return {
        ok: false as const,
        error: "session_already_active",
        orgId,
        adminId: admin.id,
        adminEmail: admin.email
      }
    }
    const token = `ogs_${newToken().replace(/^ogt_/, "")}`
    const session: AdminSession = {
      token,
      orgId,
      adminId: admin.id,
      expiresAt: now + 12 * 60 * 60 * 1000,
      createdAt: now,
      lastActivityAt: now,
      readOnly: readOnly || undefined
    }
    this.sessions.set(token, session)
    return { ok: true as const, session, admin, forced }
  }

  async resolveAdminSession(token: string) {
    const session = this.sessions.get(token)
    if (!session) return undefined
    const now = Date.now()
    const last = session.lastActivityAt || session.createdAt
    if (
      now > session.expiresAt ||
      now - last > MemoryStore.SESSION_IDLE_MS
    ) {
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
    session.lastActivityAt = now
    return { session, admin }
  }

  async revokeAdminSession(token: string) {
    return this.sessions.delete(token)
  }

  async revokeAllAdminSessions(adminId: string) {
    let n = 0
    for (const [tok, sess] of this.sessions) {
      if (sess.adminId === adminId) {
        this.sessions.delete(tok)
        n++
      }
    }
    return n
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
    return [...(this.profiles.get(orgId) || [])].sort(
      (a, b) =>
        (a.priority ?? 100) - (b.priority ?? 100) ||
        a.name.localeCompare(b.name)
    )
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
      fileScan?: Partial<import("./types").PolicyFileScan>
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
    if (!this.orgs.has(orgId)) return undefined
    const { mergePolicyFileScan } = await import("./types")
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
        fileScan:
          input.fileScan !== undefined
            ? mergePolicyFileScan({
                ...(prev.fileScan || {}),
                ...input.fileScan
              })
            : mergePolicyFileScan(prev.fileScan),
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
        userMessages:
          input.userMessages !== undefined
            ? { ...(prev.userMessages || {}), ...input.userMessages }
            : prev.userMessages,
        workSchedule:
          input.workSchedule !== undefined
            ? input.workSchedule
            : prev.workSchedule,
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
      fileScan: mergePolicyFileScan(input.fileScan),
      eventReporting: input.eventReporting !== false,
      protectUnenroll: !!input.protectUnenroll,
      enabled: input.enabled !== false,
      priority:
        input.priority !== undefined
          ? Math.max(1, Math.floor(input.priority) || 100)
          : 100,
      assignedGroupIds: input.assignedGroupIds || [],
      assignedUserIds: input.assignedUserIds || [],
      userMessages: input.userMessages,
      workSchedule: input.workSchedule ?? null,
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

  async setAgentMaintenance(
    orgId: string,
    agentId: string,
    mode: "leave" | "outage" | "remote" | null,
    note?: string | null
  ) {
    const agent = this.agents.get(agentId)
    if (!agent || agent.orgId !== orgId) return undefined
    agent.maintenanceMode = mode || null
    agent.maintenanceNote = note?.trim() || null
    agent.lastSeenAt = new Date().toISOString()
    return agent
  }

  private resolveProfileForAgent(
    orgId: string,
    agent: Agent | undefined
  ): PolicyProfile | null {
    const list = (this.profiles.get(orgId) || []).filter(
      (p) => p.enabled !== false
    )
    if (!agent) return null
    const byPrio = (a: PolicyProfile, b: PolicyProfile) =>
      (a.priority ?? 100) - (b.priority ?? 100)

    // 1. Override manuel agent (si profil encore actif)
    if (agent.policyProfileId) {
      return list.find((p) => p.id === agent.policyProfileId) || null
    }

    // 2. Via user → groupes / assignation directe user (priorité firewall)
    if (agent.userId) {
      const user = (this.users.get(orgId) || []).find(
        (u) => u.id === agent.userId
      )
      if (user) {
        const byUser = list
          .filter((p) => (p.assignedUserIds || []).includes(user.id))
          .sort(byPrio)[0]
        if (byUser) return byUser
        const candidates: PolicyProfile[] = []
        for (const gid of user.groupIds || []) {
          for (const p of list) {
            if ((p.assignedGroupIds || []).includes(gid)) candidates.push(p)
          }
          const g = (this.groups.get(orgId) || []).find((x) => x.id === gid)
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
    const policy = this.policies.get(orgId)
    if (!policy) return undefined
    const agent = this.agents.get(agentId)
    const profile = this.resolveProfileForAgent(orgId, agent)

    const { resolveEffectiveFileScan } = await import("./types")
    const effective = profile
      ? {
          defaultAction: profile.defaultAction,
          enabledHosts: profile.enabledHosts,
          scanUploads: profile.scanUploads,
          fileScan: resolveEffectiveFileScan(policy.fileScan, profile.fileScan),
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
          fileScan: resolveEffectiveFileScan(policy.fileScan, null),
          eventReporting: policy.eventReporting,
          protectUnenroll: policy.protectUnenroll,
          userMessages: policy.userMessages || {},
          workSchedule: policy.workSchedule || null
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
    return agent.licenseAssigned === true
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
    const { LICENSE_GRACE_MS: graceMs } = await import("./summary-helpers")
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

  async resolveAdminForPasswordReset(
    orgId: string,
    target?: { email?: string; adminId?: string }
  ) {
    const list = this.admins.get(orgId) || []
    if (target?.adminId) {
      const a = list.find((x) => x.id === target.adminId && x.active)
      return a
    }
    const email = (target?.email || "").trim().toLowerCase()
    if (email) {
      return list.find((x) => x.active && x.email.toLowerCase() === email)
    }
    return undefined
  }

  async requestPasswordResetOtp(
    orgId: string,
    target?: { email?: string; adminId?: string }
  ) {
    const org = this.orgs.get(orgId)
    const admin = await this.resolveAdminForPasswordReset(orgId, target)
    if (!admin) {
      return { ok: false as const, error: "admin_not_found" }
    }
    const targetEmail = admin.email.trim()
    const otp = newOtpCode(6)
    const expiresIn = 10 * 60
    this.otpChallenges.set(orgId, {
      orgId,
      adminId: admin.id,
      targetEmail,
      codeHash: hashManagementPassword(otp),
      expiresAt: Date.now() + expiresIn * 1000,
      createdAt: Date.now()
    })
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
    if (!sent.ok && sent.delivery === "failed") {
      console.warn(
        `[opsgate-otp] email failed for ${maskEmail(targetEmail)} — OTP still valid in challenge`
      )
    }
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
    const ch = this.otpChallenges.get(orgId)
    if (!ch) return { ok: false as const, error: "no_challenge" }
    if (Date.now() > ch.expiresAt) {
      this.otpChallenges.delete(orgId)
      return { ok: false as const, error: "otp_expired" }
    }
    if (hashManagementPassword(otp.trim()) !== ch.codeHash) {
      return { ok: false as const, error: "otp_invalid" }
    }
    const { validatePasswordPolicy, pushPasswordHistory } = await import(
      "./crypto"
    )
    // Vérifie que le confirm cible le même admin que le challenge
    if (target?.adminId && target.adminId !== ch.adminId) {
      return { ok: false as const, error: "admin_mismatch" }
    }
    if (
      target?.email &&
      target.email.trim().toLowerCase() !== ch.targetEmail.toLowerCase()
    ) {
      return { ok: false as const, error: "admin_mismatch" }
    }
    const list = this.admins.get(orgId) || []
    const admin = list.find((a) => a.id === ch.adminId)
    if (!admin) return { ok: false as const, error: "admin_not_found" }
    const pol = validatePasswordPolicy(newPassword, {
      currentHash: admin.passwordHash,
      history: admin.passwordHistory
    })
    if (!pol.ok) return { ok: false as const, error: pol.error }
    admin.passwordHistory = pushPasswordHistory(
      admin.passwordHash,
      admin.passwordHistory
    )
    const hash = hashManagementPassword(newPassword)
    admin.passwordHash = hash
    admin.mustChangePassword = false
    admin.updatedAt = new Date().toISOString()
    if (admin.isPrincipal) {
      const org = this.orgs.get(orgId)
      if (org) org.primaryEmail = admin.email
      await this.syncLegacyMgmtHash(orgId)
      await this.updatePolicy(orgId, { managementPasswordHash: hash })
    }
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

  async getActivePack(
    orgId: string
  ): Promise<import("./types").StoredRulePack | undefined> {
    const list = this.packs.get(orgId) || []
    const active = list.find((p) => p.active) || list[list.length - 1]
    if (active) {
      if (!active.active) active.active = true
      return active
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
    const policy = this.policies.get(input.orgId)
    if (!policy) return { ok: false, errors: ["policy_missing"] }

    let rules: DetectionRule[]
    if (input.rules) {
      const v = validateRules(input.rules)
      if (!v.ok) return { ok: false, errors: v.errors }
      rules = input.rules
    } else {
      let active = await this.getActivePack(input.orgId)
      if (!active) active = await this.ensureDefaultPack(input.orgId)
      if (!active) {
        const { buildGlobalRulesPack } = await import("./rules-pack")
        rules = buildGlobalRulesPack("1.0.0").rules
      } else {
        const disable = new Set(input.disableRuleIds || [])
        rules = active.rules.filter(
          (r: import("@opsgate/engine").DetectionRule) => !disable.has(r.id)
        )
      }
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

    if (activate) {
      await this.prunePacks(input.orgId, 12)
    }
    return { ok: true, pack, policy: nextPolicy }
  }

  async deletePack(orgId: string, version: string) {
    const list = this.packs.get(orgId) || []
    const pack = list.find((p) => p.version === version)
    if (!pack) return { ok: false, error: "not_found" }
    if (pack.active) return { ok: false, error: "cannot_delete_active" }
    this.packs.set(
      orgId,
      list.filter((p) => p.version !== version)
    )
    return { ok: true }
  }

  async prunePacks(orgId: string, keep = 12) {
    const n = Math.max(3, Math.min(50, keep))
    const list = this.packs.get(orgId) || []
    const inactive = list
      .filter((p) => !p.active)
      .sort(
        (a, b) =>
          new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
      )
    const drop = new Set(inactive.slice(n).map((p) => p.version))
    if (!drop.size) return { deleted: 0 }
    this.packs.set(
      orgId,
      list.filter((p) => p.active || !drop.has(p.version))
    )
    return { deleted: drop.size }
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
    deviceFingerprint?: string
    deviceType?: "extension" | "proxy"
  }): Promise<Agent & { replaced?: boolean }> {
    const now = new Date().toISOString()
    const tokenHash = hashToken(input.token)
    const labelKey = (input.deviceLabel || "").trim().toLowerCase()
    const fp = (input.deviceFingerprint || "").trim()
    const dtype = input.deviceType === "proxy" ? "proxy" : "extension"
    const org = this.orgs.get(input.orgId)
    const personal = !!org?.isPersonal

    // Licence :
    // - personal : clé valide
    // - org : PAS de licence tant qu'aucun groupe (moving rule / admin).
    //   Évite qu'un externe avec le code org profite d'un siège + protection.
    let assignLicense = false
    if (personal) {
      assignLicense = isValidPersonalLicenseKey(input.personalLicenseKey)
    }

    const rebind = async (existing: import("./types").Agent) => {
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
        deviceFingerprint: fp || existing.deviceFingerprint,
        deviceType: dtype,
        licenseAssigned: personal
          ? assignLicense
          : existing.licenseAssigned === true,
        unlicensedSince: personal
          ? assignLicense
            ? undefined
            : now
          : existing.licenseAssigned
            ? existing.unlicensedSince
            : existing.unlicensedSince || now,
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
      return { ...this.agents.get(existing.id)!, replaced: true as const }
    }

    // Même empreinte d’installation → re-enroll (label peut changer).
    // Labels non uniques : deux navigateurs avec le même nom = deux agents.
    if (fp) {
      for (const existing of this.agents.values()) {
        if (
          existing.orgId === input.orgId &&
          (existing.deviceFingerprint || "").trim() === fp
        ) {
          return rebind(existing)
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
      licenseAssigned: personal ? assignLicense : false,
      personalAccount: personal,
      unlicensedSince: personal && assignLicense ? undefined : now,
      deviceFingerprint: fp || undefined,
      deviceType: dtype,
      replaced: false
    }
    this.agents.set(agent.id, agent)
    this.agentsByTokenHash.set(tokenHash, agent.id)
    this.pushSystemEvent(input.orgId, agent.id, "enroll", {
      device_label: agent.deviceLabel,
      rule_ids: ["system.enroll"]
    })
    await this.applyMovingRules(input.orgId, agent.id)
    return this.agents.get(agent.id)!
  }

  /** Si groupe présent et siège dispo → licence auto. Sinon retire si plus de groupe. */
  private async syncLicenseWithGroup(orgId: string, agentId: string) {
    const agent = this.agents.get(agentId)
    if (!agent || agent.orgId !== orgId || agent.personalAccount) return
    const org = this.orgs.get(orgId)
    if (agent.groupId) {
      if (agent.licenseAssigned) return
      if (org?.licenseSeats && org.licenseSeats > 0) {
        const used = [...this.agents.values()].filter(
          (a) => a.orgId === orgId && a.licenseAssigned && a.id !== agentId
        ).length
        if (used >= org.licenseSeats) return
      }
      agent.licenseAssigned = true
      agent.unlicensedSince = undefined
    } else if (agent.licenseAssigned) {
      // Sans groupe : admin peut re-licencer manuellement ; on ne retire ici
      // que si on retire le groupe via bulk (appel explicite revoke).
    }
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
      // Heartbeat agent (proxy / extension) sur chaque batch accepté
      const ag = this.agents.get(agentId)
      if (ag && ag.orgId === orgId) {
        ag.lastSeenAt = now
        this.agents.set(agentId, ag)
      }
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

  async countEventsSince(orgId: string, sinceIso: string): Promise<number> {
    const since = Date.parse(sinceIso)
    if (!Number.isFinite(since)) return 0
    return this.events.filter(
      (e) =>
        e.orgId === orgId &&
        Date.parse(e.receivedAt || e.ts || "") >= since
    ).length
  }

  async listOrgAiTools(orgId: string) {
    return [...(this.orgAiTools.get(orgId) || [])].sort((a, b) =>
      a.tool.localeCompare(b.tool)
    )
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
    const list = this.orgAiTools.get(orgId) || []
    const idx = list.findIndex((t) => t.tool === tool)
    const prev = idx >= 0 ? list[idx] : undefined
    const row: import("./types").OrgAiTool = {
      orgId,
      tool,
      displayName: input.displayName || prev?.displayName,
      status,
      firstSeenAt: prev?.firstSeenAt || now,
      lastSeenAt: input.touchSeen ? now : prev?.lastSeenAt || now,
      updatedAt: now,
      updatedBy: input.updatedBy || null
    }
    if (idx >= 0) list[idx] = row
    else list.push(row)
    this.orgAiTools.set(orgId, list)
    return row
  }

  async purgeOldEvents(orgId: string, retentionDays: number) {
    if (!retentionDays || retentionDays < 7) return { deleted: 0 }
    const cutoff = Date.now() - retentionDays * 86400000
    const before = this.events.length
    this.events = this.events.filter((e) => {
      if (e.orgId !== orgId) return true
      const t = Date.parse(e.ts || e.receivedAt)
      return !Number.isFinite(t) || t >= cutoff
    })
    return { deleted: before - this.events.length }
  }

  async listLogExports(orgId: string) {
    const now = Date.now()
    const list = (this.logExports.get(orgId) || []).filter(
      (x) => Date.parse(x.expiresAt) > now
    )
    this.logExports.set(orgId, list)
    return [...list].sort(
      (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)
    )
  }

  async getLogExport(orgId: string, exportId: string) {
    return (await this.listLogExports(orgId)).find((x) => x.id === exportId)
  }

  async saveLogExport(
    orgId: string,
    input: Omit<
      import("./types").LogExportRecord,
      "id" | "orgId" | "createdAt"
    >
  ) {
    const rec: import("./types").LogExportRecord = {
      ...input,
      // Cap contenu ~1.5 Mo pour éviter d’exploser la mémoire
      content:
        input.content.length > 1_500_000
          ? input.content.slice(0, 1_500_000) + "\n…truncated"
          : input.content,
      id: newId("lexp"),
      orgId,
      createdAt: new Date().toISOString()
    }
    const list = this.logExports.get(orgId) || []
    list.unshift(rec)
    // garder 12 archives max
    this.logExports.set(orgId, list.slice(0, 12))
    return rec
  }

  async listRecoveryCodes(orgId: string) {
    // Actifs (pool valide) + consommés (audit). Invalidés non utilisés exclus.
    return [...(this.recoveryCodes.get(orgId) || [])]
      .filter((c) => c.consumedAt || (c.active && !c.consumedAt))
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
  }

  async generateRecoveryCodes(orgId: string, count: number, label?: string) {
    const n = Math.min(50, Math.max(1, Math.floor(count) || 20))
    const list = this.recoveryCodes.get(orgId) || []
    const plain: { id: string; code: string }[] = []
    const now = new Date().toISOString()
    for (let i = 0; i < n; i++) {
      const code = generateRecoveryCode()
      const id = newId("rc")
      list.push({
        id,
        orgId,
        codeHash: hashRecoveryCode(code),
        label: label || `batch-${now.slice(0, 10)}`,
        createdAt: now,
        consumedAt: null,
        consumedAgentId: null,
        active: true
      })
      plain.push({ id, code })
    }
    this.recoveryCodes.set(orgId, list)
    return { codes: plain, created: plain.length }
  }

  async getActiveRecoveryCodeHashes(orgId: string) {
    return (this.recoveryCodes.get(orgId) || [])
      .filter((c) => c.active && !c.consumedAt)
      .map((c) => ({ id: c.id, hash: c.codeHash }))
  }

  async consumeRecoveryCode(orgId: string, codeId: string, agentId: string) {
    const list = this.recoveryCodes.get(orgId) || []
    const idx = list.findIndex((c) => c.id === codeId && c.active && !c.consumedAt)
    if (idx < 0) return false
    list[idx] = {
      ...list[idx],
      active: false,
      consumedAt: new Date().toISOString(),
      consumedAgentId: agentId
    }
    this.recoveryCodes.set(orgId, list)
    return true
  }

  async revokeRecoveryPool(orgId: string) {
    // Invalider le pool = effacer TOUS les codes (actifs + utilisés).
    const list = this.recoveryCodes.get(orgId) || []
    const revoked = list.length
    this.recoveryCodes.set(orgId, [])
    return { revoked }
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
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000
    const recent = this.inboxMessages.filter(
      (m) =>
        m.orgId === input.orgId &&
        m.agentId === input.agentId &&
        Date.parse(m.createdAt) >= dayAgo
    )
    if (recent.length >= 15) {
      return { ok: false as const, error: "rate_limited" }
    }
    const cat = input.category || "question"
    const allowed: import("./types").InboxMessageCategory[] = [
      "question",
      "exception",
      "block_appeal",
      "other"
    ]
    const category = allowed.includes(cat) ? cat : "question"
    const msg: import("./types").UserInboxMessage = {
      id: newId("inbox"),
      orgId: input.orgId,
      agentId: input.agentId,
      deviceLabel: (input.deviceLabel || "").trim() || "agent",
      hostName: input.hostName ?? null,
      category,
      subject,
      body,
      contextUrl: input.contextUrl?.trim() || null,
      contextHostname: input.contextHostname?.trim() || null,
      status: "open",
      createdAt: new Date().toISOString(),
      readAt: null,
      repliedAt: null,
      closedAt: null,
      adminReply: null,
      repliedByAdminId: null,
      repliedByAdminLabel: null,
      userAckedAt: null
    }
    this.inboxMessages.unshift(msg)
    // Cap mémoire org
    const orgMsgs = this.inboxMessages.filter((m) => m.orgId === input.orgId)
    if (orgMsgs.length > 500) {
      const dropIds = new Set(orgMsgs.slice(500).map((m) => m.id))
      this.inboxMessages = this.inboxMessages.filter((m) => !dropIds.has(m.id))
    }
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
    let list = this.inboxMessages.filter((m) => m.orgId === orgId)
    if (opts?.agentId) list = list.filter((m) => m.agentId === opts.agentId)
    const st = opts?.status || "all"
    if (st === "unread") {
      list = list.filter((m) => m.status === "open")
    } else if (st !== "all") {
      list = list.filter((m) => m.status === st)
    }
    return list
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, limit)
  }

  async getInboxMessage(orgId: string, messageId: string) {
    return this.inboxMessages.find(
      (m) => m.orgId === orgId && m.id === messageId
    )
  }

  async markInboxRead(orgId: string, messageId: string) {
    const idx = this.inboxMessages.findIndex(
      (m) => m.orgId === orgId && m.id === messageId
    )
    if (idx < 0) return undefined
    const cur = this.inboxMessages[idx]
    if (cur.status === "open") {
      this.inboxMessages[idx] = {
        ...cur,
        status: "read",
        readAt: new Date().toISOString()
      }
    } else if (!cur.readAt) {
      this.inboxMessages[idx] = {
        ...cur,
        readAt: new Date().toISOString()
      }
    }
    return this.inboxMessages[idx]
  }

  async replyInboxMessage(
    orgId: string,
    messageId: string,
    reply: string,
    admin: { id: string; label: string }
  ) {
    const text = (reply || "").trim().slice(0, 4000)
    if (text.length < 1) return undefined
    const idx = this.inboxMessages.findIndex(
      (m) => m.orgId === orgId && m.id === messageId
    )
    if (idx < 0) return undefined
    const now = new Date().toISOString()
    const cur = this.inboxMessages[idx]
    this.inboxMessages[idx] = {
      ...cur,
      status: "replied",
      adminReply: text,
      repliedAt: now,
      readAt: cur.readAt || now,
      repliedByAdminId: admin.id,
      repliedByAdminLabel: admin.label,
      // Nouvelle réponse → l’agent doit re-acquitter (popup)
      userAckedAt: null
    }
    return this.inboxMessages[idx]
  }

  async ackInboxMessage(orgId: string, messageId: string, agentId: string) {
    const idx = this.inboxMessages.findIndex(
      (m) =>
        m.orgId === orgId && m.id === messageId && m.agentId === agentId
    )
    if (idx < 0) return undefined
    const cur = this.inboxMessages[idx]
    if (!cur.adminReply) return cur
    this.inboxMessages[idx] = {
      ...cur,
      userAckedAt: new Date().toISOString()
    }
    return this.inboxMessages[idx]
  }

  async listPendingAdminReplies(orgId: string, agentId: string) {
    return this.inboxMessages
      .filter(
        (m) =>
          m.orgId === orgId &&
          m.agentId === agentId &&
          !!m.adminReply &&
          !m.userAckedAt
      )
      .sort((a, b) => Date.parse(b.repliedAt || b.createdAt) - Date.parse(a.repliedAt || a.createdAt))
  }

  async closeInboxMessage(orgId: string, messageId: string) {
    const idx = this.inboxMessages.findIndex(
      (m) => m.orgId === orgId && m.id === messageId
    )
    if (idx < 0) return undefined
    const now = new Date().toISOString()
    const cur = this.inboxMessages[idx]
    // Sans réponse écrite : notifier le client (popup) avec un message système
    const systemClose =
      "Votre demande a été clôturée par l'administrateur (sans message de réponse)."
    const hadReply = !!(cur.adminReply && cur.adminReply.trim())
    this.inboxMessages[idx] = {
      ...cur,
      status: "closed",
      closedAt: now,
      readAt: cur.readAt || now,
      adminReply: hadReply ? cur.adminReply : systemClose,
      repliedAt: hadReply ? cur.repliedAt : now,
      repliedByAdminLabel: hadReply
        ? cur.repliedByAdminLabel
        : cur.repliedByAdminLabel || "Administrateur",
      // Si l’agent n’a pas encore acquitté, le popup reste dû (réponse ou clôture)
      userAckedAt: cur.userAckedAt || null
    }
    // Nouvelle notif de clôture sans réponse préalable → forcer re-ack
    if (!hadReply) {
      this.inboxMessages[idx] = {
        ...this.inboxMessages[idx],
        userAckedAt: null
      }
    }
    return this.inboxMessages[idx]
  }

  async countInboxUnread(orgId: string) {
    return this.inboxMessages.filter(
      (m) => m.orgId === orgId && m.status === "open"
    ).length
  }

  async summary(orgId: string): Promise<OrgSummary> {
    const {
      briefAgent,
      connectivityBuckets,
      eventsByDayFrom,
      findDuplicateFingerprints
    } = await import("./summary-helpers")
    // Purge selon rétention entreprise
    const orgMon = this.orgs.get(orgId)
    const { mergeMonitoringSettings } = await import("./types")
    const mon = mergeMonitoringSettings(orgMon?.monitoring)
    await this.purgeOldEvents(orgId, mon.logRetentionDays)
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
    const byAgentInbox = new Map<
      string,
      { agent_id: string; device_label: string; count: number }
    >()
    for (const m of this.inboxMessages.filter((x) => x.orgId === orgId)) {
      const cur = byAgentInbox.get(m.agentId) || {
        agent_id: m.agentId,
        device_label: m.deviceLabel || m.agentId.slice(0, 10),
        count: 0
      }
      cur.count++
      if (m.deviceLabel) cur.device_label = m.deviceLabel
      byAgentInbox.set(m.agentId, cur)
    }
    const top_inbox_requesters = [...byAgentInbox.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 8)
    const active = await this.getActivePack(orgId)
    const packs = this.packs.get(orgId) || []
    const agents = [...this.agents.values()].filter((a) => a.orgId === orgId)
    const licenseStats = await this.getLicenseStats(orgId)
    const agents_licensed: import("./store-types").SummaryAgentBrief[] = []
    const agents_unlicensed: import("./store-types").SummaryAgentBrief[] = []
    const agents_grace: import("./store-types").SummaryAgentBrief[] = []
    const allBriefs: import("./store-types").SummaryAgentBrief[] = []
    let licensedN = 0
    let graceN = 0
    let unlicensedN = 0
    const licMap = new Map<string, boolean>()
    for (const a of agents) {
      licMap.set(a.id, await this.isAgentLicensed(orgId, a.id))
    }
    const scheduleMap = new Map<
      string,
      import("./types").WorkSchedule | null | undefined
    >()
    for (const a of agents) {
      const eff = await this.getEffectivePolicyForAgent(orgId, a.id)
      scheduleMap.set(a.id, eff?.effective.workSchedule)
    }
    const conn = connectivityBuckets(
      agents,
      mon,
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
    return {
      org_id: orgId,
      agents: agents.length,
      events_total: events.length,
      by_decision: byDecision,
      top_rules,
      top_inbox_requesters,
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
      users_count: (this.users.get(orgId) || []).length,
      licenses: {
        licensed: licensedN,
        grace: graceN,
        unlicensed: unlicensedN,
        seats: licenseStats.seats,
        seats_used: licenseStats.seats_used,
        seats_available: licenseStats.seats_available
      },
      connectivity: conn,
      events_by_day: eventsByDayFrom(events, 14),
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

  async appendAdminAudit(input: {
    orgId: string
    adminId?: string
    adminEmail?: string
    adminLabel?: string
    action: import("./types").AdminAuditAction
    detail?: string
    meta?: Record<string, unknown>
  }) {
    const {
      AUDIT_GENESIS,
      computeAuditEntryHash
    } = await import("./audit-worm")
    const orgRows = this.adminAudit.filter((e) => e.orgId === input.orgId)
    const last = orgRows[orgRows.length - 1]
    const seq = (last?.seq || 0) + 1
    const prevHash = last?.entryHash || AUDIT_GENESIS
    const id = newId("aud")
    const createdAt = new Date().toISOString()
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
    this.adminAudit.push({
      id,
      orgId: input.orgId,
      adminId: input.adminId,
      adminEmail: input.adminEmail,
      adminLabel: input.adminLabel,
      action: input.action,
      detail: input.detail,
      meta: input.meta,
      createdAt,
      seq,
      entryHash,
      prevHash
    })
    // WORM : pas de purge agressive — plafond mémoire large (rétention légale côté config)
    if (this.adminAudit.length > 50_000) {
      this.adminAudit = this.adminAudit.slice(-40_000)
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

  async listAdminAuditAsc(orgId: string, limit = 5000) {
    const list = this.adminAudit.filter((e) => e.orgId === orgId)
    return list.slice(-limit)
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
    return [...(this.movingRules.get(orgId) || [])]
      .map((r) => ({
        ...r,
        conditionLogic: r.conditionLogic === "or" ? ("or" as const) : ("and" as const),
        permanent: !!r.permanent
      }))
      .sort(
        (a, b) =>
          a.priority - b.priority || a.createdAt.localeCompare(b.createdAt)
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
      conditionLogic?: import("./types").MovingConditionLogic
      permanent?: boolean
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
      const permanent =
        input.permanent !== undefined
          ? input.permanent === true
          : !!list[idx].permanent
      list[idx] = {
        ...list[idx],
        name: input.name,
        enabled: input.enabled !== false,
        conditions,
        conditionLogic:
          input.conditionLogic === "or" || input.conditionLogic === "and"
            ? input.conditionLogic
            : list[idx].conditionLogic || "and",
        matchField: first.field,
        matchOp: first.op,
        matchValue: first.value,
        targetGroupId: input.targetGroupId,
        priority: input.priority ?? list[idx].priority,
        onlyIfUnassigned: permanent
          ? false
          : input.onlyIfUnassigned !== undefined
            ? input.onlyIfUnassigned === true
            : list[idx].onlyIfUnassigned,
        permanent,
        updatedAt: now
      }
      this.movingRules.set(orgId, list)
      return list[idx]
    }
    const permanent = input.permanent === true
    const created: import("./types").MovingRule = {
      id: newId("mvr"),
      orgId,
      name: input.name,
      enabled: input.enabled !== false,
      conditions,
      conditionLogic: input.conditionLogic === "or" ? "or" : "and",
      matchField: first.field,
      matchOp: first.op,
      matchValue: first.value,
      targetGroupId: input.targetGroupId,
      priority: input.priority ?? 100,
      onlyIfUnassigned: permanent ? false : input.onlyIfUnassigned === true,
      permanent,
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
    if (rule.conditionLogic === "or") {
      return conds.some(matchOne)
    }
    return conds.every(matchOne)
  }

  async applyMovingRules(orgId: string, agentId: string) {
    const agent = this.agents.get(agentId)
    if (!agent || agent.orgId !== orgId) return { applied: false as const }
    const rules = await this.listMovingRules(orgId)
    for (const rule of rules.filter((r) => r.enabled)) {
      // permanent = s’applique même si déjà groupé
      if (!rule.permanent && rule.onlyIfUnassigned && agent.groupId) {
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
      await this.syncLicenseWithGroup(orgId, agentId)
      return { applied: true as const, ruleId: rule.id, groupId: group.id }
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
    const agents = [...this.agents.values()].filter((a) => a.orgId === orgId)
    const groups = this.groups.get(orgId) || []
    const profiles = this.profiles.get(orgId) || []
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
      let groupId = row.group_id?.trim() || undefined
      if (!groupId && row.group_name?.trim()) {
        const g = groups.find(
          (x) => x.name.toLowerCase() === row.group_name!.trim().toLowerCase()
        )
        if (!g) {
          errors.push(`L${line}: groupe « ${row.group_name} » inconnu`)
        } else groupId = g.id
      }
      let profileId = row.profile_id?.trim() || undefined
      if (!profileId && row.profile_name?.trim()) {
        const p = profiles.find(
          (x) =>
            x.name.toLowerCase() === row.profile_name!.trim().toLowerCase()
        )
        if (!p) {
          errors.push(`L${line}: profil « ${row.profile_name} » inconnu`)
        } else profileId = p.id
      }
      if (groupId !== undefined) {
        changes.push(`group=${groupId || "null"}`)
        if (!dry) {
          agent.groupId = groupId || undefined
          const g = groups.find((x) => x.id === groupId)
          if (g?.policyProfileId && profileId === undefined) {
            agent.policyProfileId = g.policyProfileId
          }
        }
      }
      if (profileId !== undefined) {
        changes.push(`profile=${profileId || "null"}`)
        if (!dry) agent.policyProfileId = profileId || undefined
      }
      if (row.license === true || row.license === false) {
        changes.push(`license=${row.license}`)
        if (!dry) {
          agent.licenseAssigned = row.license
          if (!row.license) agent.unlicensedSince = new Date().toISOString()
          else agent.unlicensedSince = undefined
        }
      }
      if (changes.length) {
        updated++
        preview.push({ agent_id: agent.id, changes })
      } else {
        skipped++
      }
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
      const g = (this.groups.get(orgId) || []).find((x) => x.id === opts.groupId)
      if (g?.policyProfileId && profileId === undefined) {
        profileId = g.policyProfileId
      }
    }
    const org = this.orgs.get(orgId)
    for (const id of agentIds) {
      const a = this.agents.get(id)
      if (!a || a.orgId !== orgId) continue
      if (opts.groupId !== undefined) {
        a.groupId = opts.groupId || undefined
        if (opts.groupId) {
          // Groupe → licence auto si sièges
          if (!a.licenseAssigned) {
            let can = true
            if (org?.licenseSeats && org.licenseSeats > 0) {
              const used = [...this.agents.values()].filter(
                (x) => x.orgId === orgId && x.licenseAssigned && x.id !== id
              ).length
              can = used < org.licenseSeats
            }
            if (can) {
              a.licenseAssigned = true
              a.unlicensedSince = undefined
            }
          }
        } else {
          // Retrait du groupe → plus de licence (admin peut re-attribuer manuellement)
          a.licenseAssigned = false
          a.unlicensedSince = a.unlicensedSince || new Date().toISOString()
        }
      }
      if (profileId !== undefined) a.policyProfileId = profileId || undefined
      a.lastSeenAt = new Date().toISOString()
      updated++
    }
    if (updated > 0) await this.forceConfigSync(orgId)
    return { updated }
  }
}
