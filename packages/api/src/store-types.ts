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

/** Agent minimal pour drill-down dashboard */
export type SummaryAgentBrief = {
  id: string
  device_label?: string
  host_name?: string | null
  last_seen_at: string
  license_status: "licensed" | "grace" | "unlicensed"
  offline_for_ms: number
  group_id?: string | null
  device_fingerprint?: string | null
  /** leave | outage | remote — hors alertes offline prolongé */
  maintenance_mode?: "leave" | "outage" | "remote" | null
}

export type OrgSummary = {
  org_id: string
  agents: number
  events_total: number
  by_decision: Record<string, number>
  top_rules: { rule_id: string; count: number }[]
  /** Agents les plus demandeurs (messages inbox user→admin) */
  top_inbox_requesters?: Array<{
    agent_id: string
    device_label: string
    count: number
  }>
  active_rules_pack: {
    version: string
    rules_count: number
    checksum: string
  } | null
  packs_published: number
  admins_count?: number
  groups_count?: number
  users_count?: number
  /** Licences (sièges) */
  licenses?: {
    licensed: number
    grace: number
    unlicensed: number
    seats: number
    seats_used: number
    seats_available: number | null
  }
  /** Connexion / sync (last_seen) */
  connectivity?: {
    online: number
    stale: number
    offline_long: number
    /** Hors-ligne long ET heures de travail (alertes actives) */
    offline_long_alertable?: number
    /** Agents en mode maintenance (congé / panne / remote) */
    maintenance?: number
    offline_long_ms: number
    online_ms: number
    schedule_active?: boolean
    within_work_hours?: boolean
    monitoring?: import("./types").OrgMonitoringSettings
  }
  /** Events par jour (14 j) pour graphique temporel */
  events_by_day?: { day: string; count: number }[]
  /** Listes cliquables dashboard */
  agents_licensed?: SummaryAgentBrief[]
  agents_unlicensed?: SummaryAgentBrief[]
  agents_grace?: SummaryAgentBrief[]
  agents_offline_long?: SummaryAgentBrief[]
  agents_stale?: SummaryAgentBrief[]
  agents_online?: SummaryAgentBrief[]
  agents_maintenance?: SummaryAgentBrief[]
  /** Doublons potentiels (même fingerprint, labels différents) */
  duplicate_fingerprints?: Array<{
    fingerprint: string
    agents: SummaryAgentBrief[]
  }>
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
    userMessages?: Partial<import("./types").PolicyUserMessages>
    workSchedule?: import("./types").WorkSchedule | null
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
  /** Toutes les orgs (métriques Prometheus multi-tenant) */
  listOrgs(): Promise<Organization[]>
  /** Met à jour monitoring (seuils offline + schedule) */
  setOrgLicenseSeats(orgId: string, seats: number): Promise<Organization | undefined>

  /** Soft-delete RGPD (marque deleted_at + purge_at) */
  softDeleteOrg(
    orgId: string,
    meta: {
      deletedAt: string
      deletePurgeAt: string
      deleteReason?: string | null
      deleteRequestedBy?: string | null
    }
  ): Promise<Organization | undefined>
  /** Annule soft-delete si encore dans la fenêtre de grâce */
  restoreOrg(orgId: string): Promise<Organization | undefined>
  /** Purge hard CASCADE — irréversible */
  hardDeleteOrg(orgId: string): Promise<boolean>
  /** Orgs dont purge_at ≤ now */
  listOrgsDueForHardPurge(): Promise<Organization[]>
  /** Révoque toutes les sessions console de l’org */
  revokeAllOrgSessions(orgId: string): Promise<number>

  /** Pack de règles par défaut si aucun actif (évite agent 404) */
  ensureDefaultPack(orgId: string): Promise<import("./types").StoredRulePack | undefined>

  /** Licences courtes OPS-XXXX… préprogrammées */
  issueShortLicense(input: {
    orgCode: string
    companyName: string
    address: string
    contactEmail: string
    seats: number
    expiresAt: string
    kind?: import("./license-keys").LicenseKind
  }): Promise<{ licenseKey: string; payload: import("./license-keys").IssuedLicensePayload }>

  lookupIssuedLicense(
    licenseKey: string
  ): Promise<import("./license-keys").IssuedLicenseRecord | undefined>

  listIssuedLicenses(): Promise<import("./license-keys").IssuedLicenseRecord[]>

  revokeIssuedLicense(licenseKey: string): Promise<boolean>

  /**
   * Crée un tenant minimal (org + policy + pack + principal) si org_code absent.
   * Retourne tempPassword une seule fois si créé.
   */
  provisionTenant(input: {
    orgCode: string
    companyName: string
    contactEmail: string
    seats?: number
  }): Promise<{
    orgId: string
    orgCode: string
    principalEmail: string
    created: boolean
    tempPassword?: string
  }>

  updateOrgMonitoring(
    orgId: string,
    monitoring: Partial<import("./types").OrgMonitoringSettings>
  ): Promise<Organization | undefined>
  /** Fusionne agents doublons : conserve keepId, supprime mergeIds */
  mergeAgents(
    orgId: string,
    keepId: string,
    mergeIds: string[]
  ): Promise<{ ok: boolean; kept: string; removed: number }>
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
        | "userMessages"
        | "workSchedule"
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
      unlock?: boolean
    }
  ): Promise<OrgAdmin | undefined>
  /** MFA TOTP (V2 P1) */
  setAdminTotp(
    orgId: string,
    adminId: string,
    fields: {
      totpEnabled?: boolean
      totpSecret?: string | null
      totpPendingSecret?: string | null
    }
  ): Promise<OrgAdmin | undefined>
  deleteAdmin(orgId: string, adminId: string): Promise<boolean>
  recordAdminLoginFailure(
    adminId: string,
    threshold: number
  ): Promise<{ locked: boolean; count: number; admin?: OrgAdmin }>
  clearAdminLoginFailures(adminId: string): Promise<void>
  unlockAdmin(orgId: string, adminId: string): Promise<OrgAdmin | undefined>
  findAdminsByEmail(email: string): Promise<OrgAdmin[]>
  /**
   * Orgs accessibles pour un email admin (multi-tenant / MSP).
   * Exclut les orgs personnelles.
   */
  listAccessibleOrgsForEmail(email: string): Promise<
    Array<{
      org_id: string
      org_code: string
      name: string
      is_principal: boolean
      admin_id: string
    }>
  >
  /**
   * Bascule de tenant sans re-saisie mdp (session déjà authentifiée, même email).
   */
  switchAdminOrg(opts: {
    currentToken: string
    targetOrgId: string
    force?: boolean
  }): Promise<
    | {
        ok: true
        session: AdminSession
        admin: OrgAdmin
        forced?: boolean
      }
    | { ok: false; error: string }
  >
  /**
   * Login console.
   * @param force si true, révoque la session existante (legacy / claim challenge).
   * @param readOnly si true, session concurrente lecture seule (sans kick).
   */
  createAdminSession(
    email: string,
    password: string,
    opts?: {
      force?: boolean
      readOnly?: boolean
      totpCode?: string
      orgId?: string
      orgCode?: string
    }
  ): Promise<
    | {
        ok: true
        session: AdminSession
        admin: OrgAdmin
        forced?: boolean
      }
    | {
        ok: false
        error: string
        orgs?: Array<{ org_id: string; org_code: string; name: string }>
        /** Présent si session_already_active — pour challenge */
        orgId?: string
        adminId?: string
        adminEmail?: string
      }
  >
  /**
   * Login console via SSO OIDC (email claim IdP → admin existant).
   * Pas de mot de passe ni MFA local (l’IdP a déjà authentifié).
   */
  createAdminSessionOidc(
    email: string,
    opts?: { force?: boolean; readOnly?: boolean }
  ): Promise<
    | {
        ok: true
        session: AdminSession
        admin: OrgAdmin
        forced?: boolean
      }
    | {
        ok: false
        error: string
        orgId?: string
        adminId?: string
        adminEmail?: string
      }
  >
  /**
   * Émet une session après challenge accepté/timeout (sans re-saisie mdp).
   * force=true : révoque les autres sessions full.
   */
  issueAdminSessionDirect(opts: {
    orgId: string
    adminId: string
    force?: boolean
    readOnly?: boolean
  }): Promise<
    | {
        ok: true
        session: AdminSession
        admin: OrgAdmin
        forced?: boolean
      }
    | { ok: false; error: string }
  >
  resolveAdminSession(
    token: string
  ): Promise<{ session: AdminSession; admin: OrgAdmin } | undefined>
  revokeAdminSession(token: string): Promise<boolean>
  /** Révoque toutes les sessions d’un admin (prise de contrôle) */
  revokeAllAdminSessions(adminId: string): Promise<number>
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
      userMessages?: Partial<import("./types").PolicyUserMessages>
      workSchedule?: import("./types").WorkSchedule | null
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
  /** Mode maintenance (congé / panne / remote) — exclut des alertes offline long */
  setAgentMaintenance(
    orgId: string,
    agentId: string,
    mode: "leave" | "outage" | "remote" | null,
    note?: string | null
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

  /**
   * OTP reset pour un admin précis (email ou adminId).
   * Ne plus cibler aveuglément le premier principal DEMO.
   */
  requestPasswordResetOtp(
    orgId: string,
    target?: { email?: string; adminId?: string }
  ): Promise<
    | {
        ok: true
        expires_in_sec: number
        mailed: boolean
        delivery: "smtp" | "log" | "failed" | "disabled"
        dev_otp?: string
        message: string
        target_email_masked?: string
      }
    | { ok: false; error: string }
  >
  confirmPasswordResetOtp(
    orgId: string,
    otp: string,
    newPassword: string,
    target?: { email?: string; adminId?: string }
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
  deletePack(
    orgId: string,
    version: string
  ): Promise<{ ok: boolean; error?: string }>
  prunePacks(orgId: string, keep?: number): Promise<{ deleted: number }>

  enrollAgent(input: {
    orgId: string
    token: string
    deviceLabel?: string
    hostName?: string
    appVersion?: string
    userId?: string
    /** Clé licence personnelle (PERSONAL) */
    personalLicenseKey?: string
    /** Empreinte installation (anti-doublon) */
    deviceFingerprint?: string
    /** extension | proxy (P3) */
    deviceType?: "extension" | "proxy"
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

  /** Shadow AI — inventaire outils IA (statut authorized/unauthorized) */
  listOrgAiTools(orgId: string): Promise<import("./types").OrgAiTool[]>
  upsertOrgAiTool(
    orgId: string,
    input: {
      tool: string
      status: import("./types").OrgAiToolStatus
      displayName?: string
      updatedBy?: string
      touchSeen?: boolean
    }
  ): Promise<import("./types").OrgAiTool>

  /** Purge events plus vieux que retentionDays (défini par l’entreprise) */
  purgeOldEvents(
    orgId: string,
    retentionDays: number
  ): Promise<{ deleted: number }>
  /** Archives téléchargeables (semaine auto / manuel) */
  listLogExports(orgId: string): Promise<import("./types").LogExportRecord[]>
  getLogExport(
    orgId: string,
    exportId: string
  ): Promise<import("./types").LogExportRecord | undefined>
  saveLogExport(
    orgId: string,
    input: Omit<import("./types").LogExportRecord, "id" | "orgId" | "createdAt">
  ): Promise<import("./types").LogExportRecord>

  /** Recovery one-time codes (hashes only) */
  listRecoveryCodes(
    orgId: string
  ): Promise<import("./types").RecoveryCode[]>
  generateRecoveryCodes(
    orgId: string,
    count: number,
    label?: string
  ): Promise<{ codes: { id: string; code: string }[]; created: number }>
  getActiveRecoveryCodeHashes(
    orgId: string
  ): Promise<Array<{ id: string; hash: string }>>
  consumeRecoveryCode(
    orgId: string,
    codeId: string,
    agentId: string
  ): Promise<boolean>
  revokeRecoveryPool(orgId: string): Promise<{ revoked: number }>

  /** Inbox user → admin */
  createInboxMessage(input: {
    orgId: string
    agentId: string
    deviceLabel?: string
    hostName?: string | null
    category?: import("./types").InboxMessageCategory
    subject: string
    body: string
    contextUrl?: string | null
    contextHostname?: string | null
  }): Promise<
    | { ok: true; message: import("./types").UserInboxMessage }
    | { ok: false; error: string }
  >
  listInboxMessages(
    orgId: string,
    opts?: {
      status?: import("./types").InboxMessageStatus | "all" | "unread"
      limit?: number
      agentId?: string
    }
  ): Promise<import("./types").UserInboxMessage[]>
  getInboxMessage(
    orgId: string,
    messageId: string
  ): Promise<import("./types").UserInboxMessage | undefined>
  markInboxRead(
    orgId: string,
    messageId: string
  ): Promise<import("./types").UserInboxMessage | undefined>
  replyInboxMessage(
    orgId: string,
    messageId: string,
    reply: string,
    admin: { id: string; label: string }
  ): Promise<import("./types").UserInboxMessage | undefined>
  closeInboxMessage(
    orgId: string,
    messageId: string
  ): Promise<import("./types").UserInboxMessage | undefined>
  /** Agent acquitte la réponse admin (ferme le popup) */
  ackInboxMessage(
    orgId: string,
    messageId: string,
    agentId: string
  ): Promise<import("./types").UserInboxMessage | undefined>
  /** Réponses admin non acquittées pour cet agent */
  listPendingAdminReplies(
    orgId: string,
    agentId: string
  ): Promise<import("./types").UserInboxMessage[]>
  countInboxUnread(orgId: string): Promise<number>

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
  /** Audit en ordre chronologique (vérif chaîne WORM) */
  listAdminAuditAsc(
    orgId: string,
    limit?: number
  ): Promise<import("./types").AdminAuditEvent[]>

  /** Moving rules (auto-affectation agents → groupe) */
  listMovingRules(orgId: string): Promise<import("./types").MovingRule[]>
  upsertMovingRule(
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
  ): Promise<import("./types").MovingRule | undefined>
  /**
   * Import CSV agents : matche id / device_label / host_name et applique
   * groupe, profil, licence (ne crée pas d’agents — enroll requis).
   */
  importAgentsCsv(
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
  ): Promise<{
    matched: number
    updated: number
    skipped: number
    errors: string[]
    preview?: Array<{ agent_id: string; changes: string[] }>
  }>
  deleteMovingRule(orgId: string, ruleId: string): Promise<boolean>
  /** Évalue les règles et applique profil/groupe sur l'agent. Retourne true si match. */
  applyMovingRules(
    orgId: string,
    agentId: string
  ): Promise<{ applied: boolean; ruleId?: string; groupId?: string }>
  /** Bulk : assigne un profil et/ou un groupe à plusieurs agents */
  bulkAssignAgents(
    orgId: string,
    agentIds: string[],
    opts: { policyProfileId?: string | null; groupId?: string | null }
  ): Promise<{ updated: number }>
}
