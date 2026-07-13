import type { DetectionRule } from "@opsgate/engine"

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

export type PublishPackInput = {
  orgId: string
  rules?: DetectionRule[]
  notes?: string
  publishedBy?: string
  activate?: boolean
  disableRuleIds?: string[]
}

export type PublishPackResult =
  | { ok: true; pack: StoredRulePack; policy: Policy }
  | { ok: false; errors: string[] }

export type ActivatePackResult =
  | { ok: true; pack: StoredRulePack; policy: Policy }
  | { ok: false; error: string }

export type AppendEventsResult = {
  accepted: number
  rejected: { index: number; reason: string }[]
}

export type OrgSummary = {
  org_id: string
  agents: number
  events_total: number
  by_decision: Record<string, number>
  top_rules: { rule_id: string; count: number }[]
  active_rules_pack: {
    version: string
    rules_count: number
    checksum: string
  } | null
  packs_published: number
  admins_count?: number
  groups_count?: number
  users_count?: number
}

export type EffectivePolicyBundle = {
  policy: Policy
  profile: PolicyProfile | null
  effective: {
    defaultAction: Policy["defaultAction"]
    enabledHosts: string[]
    scanUploads: boolean
    eventReporting: boolean
    protectUnenroll: boolean
  }
  /** Admins actifs (hash) pour l'agent — username = label ou email */
  admins: Array<{
    id: string
    label: string
    email: string
    password_hash: string
  }>
  /** Licence effective */
  licensed: boolean
}

/** Contrat store — memory ou postgres */
export interface OpsGateStore {
  readonly kind: "memory" | "postgres"

  findOrgByCode(code: string): Promise<Organization | undefined>
  getOrg(id: string): Promise<Organization | undefined>
  getPolicy(orgId: string): Promise<Policy | undefined>
  updatePolicy(
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
  ): Promise<Policy | undefined>

  /** Admins (principal + secondaires avec rôles) */
  listAdmins(orgId: string): Promise<OrgAdmin[]>
  getPrincipalAdmin(orgId: string): Promise<OrgAdmin | undefined>
  upsertAdmin(
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
  ): Promise<OrgAdmin | undefined>
  deleteAdmin(orgId: string, adminId: string): Promise<boolean>
  /** Login console */
  createAdminSession(
    email: string,
    password: string
  ): Promise<
    | {
        ok: true
        session: AdminSession
        admin: OrgAdmin
      }
    | { ok: false; error: string }
  >
  resolveAdminSession(
    token: string
  ): Promise<{ session: AdminSession; admin: OrgAdmin } | undefined>
  revokeAdminSession(token: string): Promise<boolean>
  /** Admins dont le mdp est valide pour désenrôlement endpoint */
  listUnenrollAdmins(orgId: string): Promise<OrgAdmin[]>

  /** Users & groups */
  listUsers(orgId: string): Promise<OrgUser[]>
  upsertUser(
    orgId: string,
    input: {
      id?: string
      displayName: string
      email?: string
      externalId?: string
      groupIds?: string[]
    }
  ): Promise<OrgUser | undefined>
  deleteUser(orgId: string, userId: string): Promise<boolean>

  listGroups(orgId: string): Promise<UserGroup[]>
  upsertGroup(
    orgId: string,
    input: {
      id?: string
      name: string
      description?: string
      policyProfileId?: string | null
      ldapExternalId?: string
    }
  ): Promise<UserGroup | undefined>
  deleteGroup(orgId: string, groupId: string): Promise<boolean>

  /** Profils départementaux */
  listProfiles(orgId: string): Promise<PolicyProfile[]>
  upsertProfile(
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
  ): Promise<PolicyProfile | undefined>
  deleteProfile(orgId: string, profileId: string): Promise<boolean>
  assignAgentProfile(
    orgId: string,
    agentId: string,
    policyProfileId: string | null
  ): Promise<Agent | undefined>
  assignAgentUser(
    orgId: string,
    agentId: string,
    userId: string | null
  ): Promise<Agent | undefined>

  getEffectivePolicyForAgent(
    orgId: string,
    agentId: string
  ): Promise<EffectivePolicyBundle | undefined>

  /** Licence siège agent */
  isAgentLicensed(orgId: string, agentId: string): Promise<boolean>
  setAgentLicense(
    orgId: string,
    agentId: string,
    licensed: boolean
  ): Promise<Agent | undefined>
  getLicenseStats(orgId: string): Promise<{
    licensed_agents: number
    unlicensed_agents: number
    grace_agents: number
    /** 0 = illimité */
    seats: number
    seats_used: number
    /** null si illimité */
    seats_available: number | null
  }>

  forceConfigSync(orgId: string): Promise<
    | { ok: true; configEpoch: number; policyVersion: number; agents: number }
    | { ok: false; error: string }
  >

  requestPasswordResetOtp(orgId: string): Promise<{
    ok: true
    expires_in_sec: number
    dev_otp?: string
    message: string
  }>
  confirmPasswordResetOtp(
    orgId: string,
    otp: string,
    newPassword: string,
    adminId?: string
  ): Promise<{ ok: true } | { ok: false; error: string }>

  /** Audit + revoke avec acteur de sortie */
  recordUnenrollAndRevoke(
    orgId: string,
    agentId: string,
    token: string,
    exit: ExitActor
  ): Promise<{ ok: boolean; event_id?: string }>

  listPacks(orgId: string): Promise<StoredRulePack[]>
  getPack(orgId: string, version: string): Promise<StoredRulePack | undefined>
  getActivePack(orgId: string): Promise<StoredRulePack | undefined>
  getActivePackPayload(orgId: string): Promise<RulesPackPayload | undefined>
  publishPack(input: PublishPackInput): Promise<PublishPackResult>
  activatePack(orgId: string, version: string): Promise<ActivatePackResult>

  enrollAgent(input: {
    orgId: string
    token: string
    deviceLabel?: string
    hostName?: string
    appVersion?: string
    userId?: string
    /** Clé licence personnelle (PERSONAL) */
    personalLicenseKey?: string
  }): Promise<Agent & { replaced?: boolean }>
  resolveAgentByToken(token: string): Promise<Agent | undefined>
  revokeAgentByToken(token: string): Promise<boolean>
  /** Révocation admin console — conserve les events (pas de wipe). */
  revokeAgentById(
    orgId: string,
    agentId: string,
    exit?: ExitActor
  ): Promise<boolean>
  listAgents(orgId: string): Promise<Agent[]>

  appendEvents(
    orgId: string,
    agentId: string,
    events: DetectionEventInput[]
  ): Promise<AppendEventsResult>
  listEvents(orgId: string, limit?: number): Promise<StoredEvent[]>
  summary(orgId: string): Promise<OrgSummary>

  appendAdminAudit(input: {
    orgId: string
    adminId?: string
    adminEmail?: string
    adminLabel?: string
    action: import("./types").AdminAuditAction
    detail?: string
    meta?: Record<string, unknown>
  }): Promise<void>
  listAdminAudit(
    orgId: string,
    opts?: { limit?: number; action?: string }
  ): Promise<import("./types").AdminAuditEvent[]>
}
