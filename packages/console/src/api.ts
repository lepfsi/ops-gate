const DEFAULT_API = "http://127.0.0.1:8787"
const TOKEN_KEY = "opsgate_admin_token"

export function getApiBase(): string {
  return localStorage.getItem("opsgate_api_base") || DEFAULT_API
}

export function setApiBase(url: string) {
  localStorage.setItem("opsgate_api_base", url.replace(/\/$/, ""))
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}

async function request<T>(
  path: string,
  opts: RequestInit & { auth?: boolean } = {}
): Promise<T> {
  const headers: Record<string, string> = {
    accept: "application/json",
    ...(opts.headers as Record<string, string>)
  }
  if (opts.auth !== false) {
    const tok = getToken()
    if (tok) headers["Authorization"] = `Bearer ${tok}`
  }
  if (opts.body && !headers["content-type"]) {
    headers["content-type"] = "application/json"
  }

  const res = await fetch(`${getApiBase()}${path}`, {
    ...opts,
    headers
  })

  if (res.status === 304) {
    return null as T
  }

  const text = await res.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }

  if (!res.ok) {
    const err =
      (data as {
        error?: string
        message?: string
        details?: string[]
        remaining_attempts?: number
        orgs?: Array<{ org_id: string; org_code: string; name: string }>
        challenge_id?: string
        expires_in?: number
        challenge?: {
          challenge_id: string
          status: string
          seconds_left: number
          deadline_at: number
        }
      }) || {}
    // Préférer le message humain (ex. e-mail déjà inscrit)
    const msg = err.message
      ? err.message
      : err.error
        ? `${err.error}${err.details ? ": " + err.details.join(", ") : ""}`
        : `HTTP ${res.status}`
    const e = new Error(msg) as Error & {
      code?: string
      remaining_attempts?: number
      orgs?: Array<{ org_id: string; org_code: string; name: string }>
      challenge_id?: string
      expires_in?: number
      challenge?: {
        challenge_id: string
        status: string
        seconds_left: number
        deadline_at: number
      }
    }
    e.code = err.error
    if (typeof err.remaining_attempts === "number") {
      e.remaining_attempts = err.remaining_attempts
    }
    if (err.orgs) e.orgs = err.orgs
    if (err.challenge_id) e.challenge_id = err.challenge_id
    if (typeof err.expires_in === "number") e.expires_in = err.expires_in
    if (err.challenge) e.challenge = err.challenge
    throw e
  }
  return data as T
}

export type SummaryAgentBrief = {
  id: string
  device_label?: string
  host_name?: string | null
  last_seen_at: string
  license_status: "licensed" | "grace" | "unlicensed"
  offline_for_ms: number
  group_id?: string | null
  device_fingerprint?: string | null
  maintenance_mode?: "leave" | "outage" | "remote" | null
}

export type Summary = {
  org_id: string
  agents: number
  events_total: number
  by_decision: Record<string, number>
  top_rules: { rule_id: string; count: number }[]
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
  licenses?: {
    licensed: number
    grace: number
    unlicensed: number
    seats: number
    seats_used: number
    seats_available: number | null
  }
  connectivity?: {
    online: number
    stale: number
    offline_long: number
    offline_long_alertable?: number
    maintenance?: number
    offline_long_ms: number
    online_ms: number
    schedule_active?: boolean
    within_work_hours?: boolean
    monitoring?: MonitoringSettings
  }
  events_by_day?: { day: string; count: number }[]
  agents_licensed?: SummaryAgentBrief[]
  agents_unlicensed?: SummaryAgentBrief[]
  agents_grace?: SummaryAgentBrief[]
  agents_offline_long?: SummaryAgentBrief[]
  agents_stale?: SummaryAgentBrief[]
  agents_online?: SummaryAgentBrief[]
  agents_maintenance?: SummaryAgentBrief[]
  duplicate_fingerprints?: Array<{
    fingerprint: string
    agents: SummaryAgentBrief[]
  }>
}

export type LogCategories = {
  detectionEvents: boolean
  adminLogin: boolean
  adminAudit: boolean
  agentLifecycle: boolean
  /** Events proxy (source=proxy) — décocher pour réduire le bruit */
  proxyEvents?: boolean
}

/** Message inbox user → admin */
export type InboxMessage = {
  id: string
  org_id: string
  agent_id: string
  device_label: string
  host_name?: string | null
  category: "question" | "exception" | "block_appeal" | "other"
  subject: string
  body: string
  context_url?: string | null
  context_hostname?: string | null
  status: "open" | "read" | "replied" | "closed"
  created_at: string
  read_at?: string | null
  replied_at?: string | null
  closed_at?: string | null
  admin_reply?: string | null
  replied_by_admin_id?: string | null
  replied_by_admin_label?: string | null
}

/** Rapport sécurité (dashboard compile) */
export type SecurityReport = {
  schema_version: 1
  generated_at: string
  org_id: string
  org_name?: string
  period: {
    kind: string
    from_ts: string
    to_ts: string
    label: string
  }
  kpis: {
    events_total: number
    agents_total: number
    agents_online: number
    agents_stale: number
    agents_offline_long: number
    agents_maintenance: number
    licensed: number
    unlicensed: number
    grace: number
    seats: number
    seats_used: number
    risky_sends: number
    blocks: number
    masks: number
    observes: number
    cancels: number
  }
  by_decision: Array<{ decision: string; count: number; pct: number }>
  by_severity: Array<{ severity: string; count: number; pct: number }>
  by_source: Array<{ source: string; count: number; pct: number }>
  events_by_day: Array<{ day: string; count: number }>
  top_rules: Array<{ rule_id: string; count: number }>
  top_hosts: Array<{ hostname: string; count: number }>
  top_devices: Array<{ device_label: string; count: number }>
  connectivity: {
    online: number
    stale: number
    offline_long: number
    maintenance: number
  }
}

export type NotificationChannelKind =
  | "email"
  | "telegram"
  | "slack"
  | "webhook"

export type NotificationChannel = {
  id: string
  kind: NotificationChannelKind
  enabled: boolean
  label?: string
  emails?: string[]
  botToken?: string
  chatId?: string
  webhookUrl?: string
}

export type NotificationSettings = {
  licenseExpiring: boolean
  licenseExpiringDays: number
  loginBruteForce: boolean
  loginBruteForceThreshold: number
  accountLockoutEmail?: boolean
  recoveryLowStock?: boolean
  recoveryLowStockThreshold?: number
  /** Destinataires e-mail (canal historique) */
  alertEmails?: string[]
  /** Canaux externes (Telegram, Slack, webhook…) */
  channels?: NotificationChannel[]
}

export type LicenseDisplay = {
  companyName: string
  address: string
  contactEmail: string
  expiresAt?: string | null
  mode?: "trial" | "full"
  seats?: number
  activatedAt?: string | null
  licenseKeyFingerprint?: string | null
}

export type SiEmSettings = {
  enabled: boolean
  protocol: "udp" | "tcp"
  host: string
  port: number
  facility: number
  format: "rfc5424" | "cef"
  appName?: string
}

export type MonitoringSettings = {
  onlineMs: number
  offlineLongMs: number
  schedule: {
    enabled: boolean
    timezone: string
    workDays: number[]
    workStart: string
    workEnd: string
    breaks?: Array<{ start: string; end: string }>
  }
  /** Rétention detection events (jours)  -  définie par l’entreprise */
  logRetentionDays?: number
  /** Rétention légale journal audit admin (min 90) */
  auditLegalRetentionDays?: number
  /** WORM audit toujours actif */
  auditWormEnabled?: boolean
  weeklyExportEnabled?: boolean
  weeklyExportFormats?: Array<"csv" | "json">
  weeklyExportNotifyEmail?: boolean
  /** Export auto logs — destinataires, jour, heure, formats (client) */
  scheduledLogExport?: {
    enabled: boolean
    recipientEmails: string[]
    dayOfWeek: number
    timeLocal: string
    timezone: string
    formats: Array<"csv" | "json">
    attachFiles: boolean
  }
  lastWeeklyExportAt?: string | null
  logCategories?: LogCategories
  notifications?: NotificationSettings
  licenseDisplay?: LicenseDisplay
  /** SIEM / Syslog (V2 P0) */
  siem?: SiEmSettings
  proxy?: { enabled: boolean; mode: "observe" | "enforce" }
  quotas?: {
    maxEventsPerDay: number
    maxEventsPerMinute?: number
    maxAgents?: number
  }
  ldap?: LdapSettings
  smtp?: SmtpSettings
}

export type SmtpSettings = {
  enabled: boolean
  host: string
  port: number
  secure: boolean
  user: string
  /** write-only ; never returned on GET */
  password?: string
  from: string
  tlsInsecure?: boolean
  password_set?: boolean
}

export type LdapSettings = {
  enabled: boolean
  url: string
  bindDn: string
  bindPassword?: string
  baseDn: string
  userFilter?: string
  groupFilter?: string
  syncUsers?: boolean
  syncGroups?: boolean
  dryRun?: boolean
  tlsInsecure?: boolean
  timeoutMs?: number
  sizeLimit?: number
  lastSyncAt?: string | null
  lastSyncMessage?: string | null
  lastSyncStats?: {
    groups_upserted?: number
    users_upserted?: number
    groups_seen?: number
    users_seen?: number
  } | null
}

export type PackListItem = {
  version: string
  active: boolean
  rules_count: number
  checksum: string
  signature: string
  notes?: string
  published_at: string
  published_by: string
}

export type AgentRow = {
  id: string
  device_label?: string
  host_name?: string | null
  app_version?: string
  enrolled_at: string
  last_seen_at: string
  policy_profile_id?: string | null
  user_id?: string | null
  group_id?: string | null
  personal_account?: boolean
  licensed?: boolean
  license_assigned?: boolean
  license_status?: "licensed" | "grace" | "unlicensed"
  unlicensed_since?: string | null
  device_fingerprint?: string | null
  /** extension | proxy (P3) */
  device_type?: "extension" | "proxy"
  maintenance_mode?: "leave" | "outage" | "remote" | null
  maintenance_note?: string | null
}

export type EventRow = {
  id: string
  ts: string
  source: string
  hostname: string
  decision: string
  detection_count: number
  highest_severity: string
  types: string[]
  masked?: boolean
  rule_ids?: string[]
  exit_actor?: string
  exit_admin_label?: string
  device_label?: string
  file_names?: string[] | null
}

export type PolicyUserMessages = {
  adminNotice?: string
  alertTitle?: string
  alertBody?: string
  blockTitle?: string
  blockBody?: string
  maskForceTitle?: string
  maskForceBody?: string
  btnMask?: string
  btnSendAnyway?: string
  btnCancel?: string
  btnBlockAck?: string
  toastCancel?: string
  toastMask?: string
  toastSendAnyway?: string
  toastBlocked?: string
  alertTitleFile?: string
  alertBodyFile?: string
}

export type WorkScheduleDoc = {
  enabled: boolean
  timezone: string
  workDays: number[]
  workStart: string
  workEnd: string
  breaks?: Array<{ start: string; end: string }>
}

export type PolicyFileScan = {
  configs: boolean
  databases: boolean
  images: boolean
  office: boolean
  media_warn: boolean
}

export type PolicyDoc = {
  id: string
  orgId: string
  version: number
  configEpoch?: number
  defaultAction: string
  enabledHosts: string[]
  scanUploads: boolean
  fileScan?: PolicyFileScan
  eventReporting: boolean
  protectUnenroll?: boolean
  rulesPackVersion: string
  managementPasswordHash: string
  userMessages?: PolicyUserMessages
  workSchedule?: WorkScheduleDoc | null
  updatedAt: string
}

export type ProfileRow = {
  id: string
  orgId: string
  name: string
  department?: string
  defaultAction: string
  enabledHosts: string[]
  scanUploads: boolean
  fileScan?: PolicyFileScan
  eventReporting: boolean
  protectUnenroll?: boolean
  enabled?: boolean
  priority?: number
  assignedGroupIds?: string[]
  assignedUserIds?: string[]
  userMessages?: PolicyUserMessages
  workSchedule?: WorkScheduleDoc | null
  updatedAt: string
}

export type AdminPermission =
  | "console_access"
  | "unenroll_agents"
  | "manage_admins"
  | "manage_policies"
  | "manage_users"
  | "email_password_reset"

export type AdminRow = {
  id: string
  label: string
  email: string
  is_principal: boolean
  permissions: AdminPermission[]
  active: boolean
  must_change_password?: boolean
  locked?: boolean
  locked_at?: string | null
  failed_login_count?: number
  mfa_enabled?: boolean
  created_at?: string
  updated_at?: string
}

export type UserRow = {
  id: string
  orgId: string
  displayName: string
  email?: string
  externalId?: string
  groupIds: string[]
  licenseManual?: boolean | null
  licensed?: boolean
  createdAt: string
}

export type GroupRow = {
  id: string
  orgId: string
  name: string
  description?: string
  policyProfileId?: string
  ldapExternalId?: string
  createdAt: string
  updatedAt: string
}

export type MovingCondition = {
  field: "device_label" | "host_name"
  op: "starts_with" | "contains" | "equals" | "regex"
  value: string
}

export type MovingRuleRow = {
  id: string
  orgId: string
  name: string
  enabled: boolean
  conditions?: MovingCondition[]
  conditionLogic?: "and" | "or"
  matchField: "device_label" | "host_name"
  matchOp: "starts_with" | "contains" | "equals" | "regex"
  matchValue: string
  targetGroupId: string
  priority: number
  onlyIfUnassigned: boolean
  permanent?: boolean
}

export const api = {
  health: () =>
    request<{ ok: boolean; ts: string }>("/health", { auth: false }),

  setupInfo: () =>
    request<{
      org_code: string
      primary_email_masked: string
      default_password_hint: string
      note: string
    }>("/v1/auth/setup-info", { auth: false }),

  login: (
    email: string,
    password: string,
    opts?: {
      force?: boolean
      read_only?: boolean
      totpCode?: string
      org_id?: string
      org_code?: string
    }
  ) =>
    request<{
      ok: boolean
      token: string
      expires_at: number
      admin: AdminRow
      hint?: string
      forced?: boolean
      read_only?: boolean
      mfa_enabled?: boolean
    }>("/v1/auth/login", {
      method: "POST",
      auth: false,
      body: JSON.stringify({
        email,
        password,
        force: !!opts?.force,
        read_only: !!opts?.read_only,
        totp_code: opts?.totpCode || undefined,
        org_id: opts?.org_id,
        org_code: opts?.org_code
      })
    }),

  challengeStatus: (id: string) =>
    request<{
      ok: boolean
      challenge: {
        challenge_id: string
        status: string
        admin_email: string
        requester_hint: string
        seconds_left: number
        deadline_at: number
      }
    }>(`/v1/auth/challenge/${encodeURIComponent(id)}`, { auth: false }),

  challengeClaim: (id: string) =>
    request<{
      ok: boolean
      token: string
      expires_at: number
      admin: AdminRow
      hint?: string
      forced?: boolean
      read_only?: boolean
    }>(`/v1/auth/challenge/${encodeURIComponent(id)}/claim`, {
      method: "POST",
      auth: false,
      body: "{}"
    }),

  pendingSessionChallenge: () =>
    request<{
      ok: boolean
      challenge: {
        challenge_id: string
        status: string
        admin_email: string
        requester_hint: string
        seconds_left: number
        deadline_at: number
      } | null
    }>("/v1/auth/session/pending-challenge"),

  respondSessionChallenge: (id: string, action: "accept" | "refuse") =>
    request<{
      ok: boolean
      challenge: {
        challenge_id: string
        status: string
        seconds_left: number
      }
      should_logout?: boolean
    }>(`/v1/auth/session/challenge/${encodeURIComponent(id)}/respond`, {
      method: "POST",
      body: JSON.stringify({ action })
    }),

  mfaSetup: () =>
    request<{
      ok: boolean
      secret: string
      otpauth_url: string
      message?: string
    }>("/v1/org/admins/me/mfa/setup", { method: "POST", body: "{}" }),

  mfaEnable: (code: string) =>
    request<{ ok: boolean; mfa_enabled: boolean }>(
      "/v1/org/admins/me/mfa/enable",
      { method: "POST", body: JSON.stringify({ code }) }
    ),

  mfaDisable: (password: string, code: string) =>
    request<{ ok: boolean; mfa_enabled: boolean }>(
      "/v1/org/admins/me/mfa/disable",
      { method: "POST", body: JSON.stringify({ password, code }) }
    ),

  oidcStatus: () =>
    request<{
      enabled: boolean
      issuer: string | null
      client_id: string | null
      redirect_uri?: string | null
      scopes?: string
      start_path?: string
      callback_path?: string
      flow?: string
      jit?: boolean
      jwks_verify?: boolean
      sso_enforce?: boolean
      require_email_verified?: boolean
      note?: string
    }>("/v1/auth/oidc/status", { auth: false }),

  /** URL absolue pour démarrer le flow OIDC (navigateur). */
  oidcStartUrl: (opts?: { force?: boolean; returnTo?: string }) => {
    const base = getApiBase().replace(/\/$/, "")
    const q = new URLSearchParams()
    const returnTo =
      opts?.returnTo ||
      `${window.location.origin}${window.location.pathname || "/"}`
    q.set("return_to", returnTo)
    if (opts?.force) q.set("force", "1")
    return `${base}/v1/auth/oidc/start?${q.toString()}`
  },

  logout: (reason?: "manual" | "idle") =>
    request<{ ok: boolean }>("/v1/auth/logout", {
      method: "POST",
      body: JSON.stringify({ reason: reason || "manual" })
    }),

  audit: (action?: string) =>
    request<{
      org_id: string
      worm?: boolean
      legal_retention_days?: number
      events: Array<{
        id: string
        adminEmail?: string
        adminLabel?: string
        action: string
        detail?: string
        createdAt: string
        seq?: number
        entry_hash?: string
        prev_hash?: string
      }>
    }>(
      `/v1/org/audit${action ? `?action=${encodeURIComponent(action)}` : ""}`
    ),

  auditIntegrity: () =>
    request<{
      org_id: string
      worm: boolean
      ok: boolean
      checked: number
      with_hash: number
      without_hash: number
      broken_at_id?: string
      broken_reason?: string
      tip?: string
    }>("/v1/org/audit/integrity"),

  mspOverview: () =>
    request<{
      multi_org: boolean
      org_count: number
      current_org_id?: string
      orgs: Array<{
        org_id: string
        org_code: string
        name: string
        is_principal: boolean
        current: boolean
        agents: number
        online: number
        offline_long: number
        seats: number
        seats_used: number
        license_mode: string
        license_expires_at: string | null
        license_days_left: number | null
        company_name: string
      }>
      totals: {
        agents: number
        online: number
        seats: number
        seats_used: number
        expiring_licenses: number
      }
    }>("/v1/auth/msp-overview"),

  movingRules: () =>
    request<{ org_id: string; rules: MovingRuleRow[] }>(
      "/v1/org/moving-rules"
    ),

  createMovingRule: (body: {
    name: string
    conditions?: MovingCondition[]
    match_field?: string
    match_op?: string
    match_value?: string
    target_group_id: string
    priority?: number
    only_if_unassigned?: boolean
    condition_logic?: "and" | "or"
    permanent?: boolean
    enabled?: boolean
  }) =>
    request<{ ok: boolean; rule: MovingRuleRow; agents_applied?: number }>(
      "/v1/org/moving-rules",
      {
        method: "POST",
        body: JSON.stringify(body)
      }
    ),

  patchMovingRule: (
    id: string,
    body: {
      name?: string
      conditions?: MovingCondition[]
      match_field?: string
      match_op?: string
      match_value?: string
      target_group_id?: string
      priority?: number
      only_if_unassigned?: boolean
      condition_logic?: "and" | "or"
      permanent?: boolean
      enabled?: boolean
    }
  ) =>
    request<{ ok: boolean; rule: MovingRuleRow; agents_applied?: number }>(
      `/v1/org/moving-rules/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify(body) }
    ),

  importAgentsCsv: (csv: string, dry_run?: boolean) =>
    request<{
      ok: boolean
      dry_run?: boolean
      matched: number
      updated: number
      skipped: number
      errors: string[]
      preview?: Array<{ agent_id: string; changes: string[] }>
    }>("/v1/org/agents/import-csv", {
      method: "POST",
      body: JSON.stringify({ csv, dry_run: !!dry_run })
    }),

  deleteMovingRule: (id: string) =>
    request<{ ok: boolean }>(
      `/v1/org/moving-rules/${encodeURIComponent(id)}`,
      { method: "DELETE" }
    ),

  applyMovingRules: () =>
    request<{ ok: boolean; applied: number; total: number }>(
      "/v1/org/moving-rules/apply-all",
      { method: "POST" }
    ),

  bulkAssignAgents: (body: {
    agent_ids: string[]
    policy_profile_id?: string | null
    group_id?: string | null
  }) =>
    request<{ ok: boolean; updated: number }>("/v1/org/agents/bulk-assign", {
      method: "POST",
      body: JSON.stringify(body)
    }),

  me: () =>
    request<{
      ok: boolean
      admin: AdminRow
      org: {
        id: string
        name: string
        org_code: string
        primary_email: string
        deleted_at?: string | null
        delete_purge_at?: string | null
      } | null
      multi_org?: boolean
      mfa_required_multi_org?: boolean
      mfa_enabled?: boolean
      read_only?: boolean
      org_soft_deleted?: boolean
      org_purge_at?: string | null
      accessible_orgs?: Array<{
        org_id: string
        org_code: string
        name: string
        is_principal: boolean
        current: boolean
      }>
    }>("/v1/auth/me"),

  accessibleOrgs: () =>
    request<{
      org_id: string
      multi_org: boolean
      orgs: Array<{
        org_id: string
        org_code: string
        name: string
        is_principal: boolean
        current: boolean
      }>
    }>("/v1/auth/accessible-orgs"),

  /** Bascule de tenant (multi-org : totp_code obligatoire) */
  switchOrg: (org_id: string, opts?: { force?: boolean; totp_code?: string }) =>
    request<{
      ok: boolean
      token: string
      admin: AdminRow
      org: {
        id: string
        name: string
        org_code: string
        primary_email: string
      } | null
      multi_org?: boolean
      accessible_orgs?: Array<{
        org_id: string
        org_code: string
        name: string
        is_principal: boolean
        current: boolean
      }>
    }>("/v1/auth/switch-org", {
      method: "POST",
      body: JSON.stringify({
        org_id,
        force: opts?.force !== false,
        totp_code: opts?.totp_code || undefined
      })
    }),

  changePassword: (
    current_password: string,
    new_password: string,
    new_password_confirm: string,
    email?: string
  ) =>
    request<{ ok: boolean }>("/v1/auth/change-password", {
      method: "POST",
      body: JSON.stringify({
        current_password,
        new_password,
        new_password_confirm,
        email
      })
    }),

  resetSecondaryPassword: (adminId: string, new_password: string) =>
    request<{ ok: boolean; message?: string }>(
      `/v1/org/admins/${encodeURIComponent(adminId)}/reset-password`,
      {
        method: "POST",
        body: JSON.stringify({ new_password })
      }
    ),

  updateAdminSelf: (
    adminId: string,
    body: {
      email?: string
      current_password: string
      password?: string
      password_confirm?: string
      label?: string
    }
  ) =>
    request<{ ok: boolean }>(
      `/v1/org/admins/${encodeURIComponent(adminId)}`,
      { method: "PATCH", body: JSON.stringify(body) }
    ),

  /**
   * Forgot password (écran login) — public, email obligatoire.
   */
  requestPrincipalOtp: (email?: string) =>
    request<{
      ok: boolean
      expires_in_sec?: number
      mailed?: boolean
      delivery?: string
      dev_otp?: string
      target_email_masked?: string
      message: string
    }>("/v1/auth/password-reset/request", {
      method: "POST",
      auth: false,
      body: JSON.stringify({ email })
    }),

  confirmPrincipalOtp: (otp: string, new_password: string, email?: string) =>
    request<{ ok: boolean; message?: string }>(
      "/v1/auth/password-reset/confirm",
      {
        method: "POST",
        auth: false,
        body: JSON.stringify({
          otp,
          new_password,
          email: email || undefined
        })
      }
    ),

  /**
   * Reset pour l’admin de la session active (Paramètres).
   */
  requestSessionOtp: () =>
    request<{
      ok: boolean
      expires_in_sec?: number
      mailed?: boolean
      delivery?: string
      dev_otp?: string
      target_email_masked?: string
      message: string
    }>("/v1/org/password-reset/request", {
      method: "POST",
      body: "{}"
    }),

  confirmSessionOtp: (otp: string, new_password: string) =>
    request<{ ok: boolean; message?: string }>(
      "/v1/org/password-reset/confirm",
      {
        method: "POST",
        body: JSON.stringify({ otp, new_password })
      }
    ),

  summary: () => request<Summary>("/v1/org/summary"),

  agents: () =>
    request<{ org_id: string; agents: AgentRow[] }>("/v1/org/agents"),

  policy: () =>
    request<{ org: unknown; policy: PolicyDoc }>("/v1/org/policy"),

  updatePolicy: (body: {
    default_action?: string
    enabled_hosts?: string[]
    scan_uploads?: boolean
    file_scan?: Partial<PolicyFileScan>
    event_reporting?: boolean
    protect_unenroll?: boolean
    management_password?: string
    user_messages?: PolicyUserMessages
    work_schedule?: WorkScheduleDoc | null
  }) =>
    request<{ ok: boolean; policy: unknown }>("/v1/org/policy", {
      method: "PATCH",
      body: JSON.stringify(body)
    }),

  forceSync: () =>
    request<{
      ok: boolean
      config_epoch: number
      policy_version: number
      agents: number
      message: string
    }>("/v1/org/force-sync", { method: "POST" }),

  profiles: () =>
    request<{ org_id: string; profiles: ProfileRow[] }>("/v1/org/profiles"),

  createProfile: (body: {
    name: string
    department?: string
    default_action?: string
    enabled_hosts?: string[]
    scan_uploads?: boolean
    file_scan?: Partial<PolicyFileScan>
    event_reporting?: boolean
    protect_unenroll?: boolean
    enabled?: boolean
    priority?: number
    assigned_group_ids?: string[]
    user_messages?: PolicyUserMessages
    work_schedule?: WorkScheduleDoc | null
  }) =>
    request<{ ok: boolean; profile: ProfileRow }>("/v1/org/profiles", {
      method: "POST",
      body: JSON.stringify(body)
    }),

  updateProfile: (
    id: string,
    body: {
      name?: string
      department?: string
      default_action?: string
      enabled_hosts?: string[]
      scan_uploads?: boolean
      file_scan?: Partial<PolicyFileScan>
      event_reporting?: boolean
      user_messages?: PolicyUserMessages
      protect_unenroll?: boolean
      enabled?: boolean
      priority?: number
      assigned_group_ids?: string[]
      work_schedule?: WorkScheduleDoc | null
    }
  ) =>
    request<{ ok: boolean; profile: ProfileRow }>(
      `/v1/org/profiles/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify(body) }
    ),

  deleteProfile: (id: string) =>
    request<{ ok: boolean }>(`/v1/org/profiles/${encodeURIComponent(id)}`, {
      method: "DELETE"
    }),

  assignAgentProfile: (agentId: string, policyProfileId: string | null) =>
    request<{ ok: boolean }>(
      `/v1/org/agents/${encodeURIComponent(agentId)}`,
      {
        method: "PATCH",
        body: JSON.stringify({ policy_profile_id: policyProfileId })
      }
    ),

  assignAgentUser: (agentId: string, userId: string | null) =>
    request<{ ok: boolean }>(
      `/v1/org/agents/${encodeURIComponent(agentId)}`,
      {
        method: "PATCH",
        body: JSON.stringify({ user_id: userId })
      }
    ),

  setAgentMaintenance: (
    agentId: string,
    mode: "leave" | "outage" | "remote" | null,
    note?: string | null
  ) =>
    request<{ ok: boolean }>(
      `/v1/org/agents/${encodeURIComponent(agentId)}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          maintenance_mode: mode,
          maintenance_note: note ?? null
        })
      }
    ),

  admins: () =>
    request<{
      org_id: string
      primary_email: string
      admins: AdminRow[]
    }>("/v1/org/admins"),

  createAdmin: (body: {
    label: string
    email: string
    password: string
    permissions?: AdminPermission[]
    is_principal?: boolean
  }) =>
    request<{ ok: boolean; admin: AdminRow }>("/v1/org/admins", {
      method: "POST",
      body: JSON.stringify(body)
    }),

  unlockAdmin: (id: string) =>
    request<{ ok: boolean; admin: AdminRow }>(
      `/v1/org/admins/${encodeURIComponent(id)}/unlock`,
      { method: "POST", body: "{}" }
    ),

  updateAdmin: (
    id: string,
    body: {
      label?: string
      email?: string
      password?: string
      active?: boolean
      permissions?: AdminPermission[]
    }
  ) =>
    request<{ ok: boolean }>(`/v1/org/admins/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(body)
    }),

  deleteAdmin: (id: string) =>
    request<{ ok: boolean }>(`/v1/org/admins/${encodeURIComponent(id)}`, {
      method: "DELETE"
    }),

  users: () =>
    request<{
      org_id: string
      users: (UserRow & { licensed?: boolean })[]
    }>("/v1/org/users"),

  createUser: (body: {
    display_name: string
    email?: string
    group_ids?: string[]
  }) =>
    request<{ ok: boolean; user: UserRow }>("/v1/org/users", {
      method: "POST",
      body: JSON.stringify(body)
    }),

  setAgentLicense: (agentId: string, licensed: boolean) =>
    request<{ ok: boolean; license_assigned: boolean }>(
      `/v1/org/agents/${encodeURIComponent(agentId)}/license`,
      {
        method: "PATCH",
        body: JSON.stringify({ licensed })
      }
    ),

  licenses: () =>
    request<{
      org_id: string
      licensed_agents: number
      unlicensed_agents: number
      grace_agents: number
      seats: number
      seats_used: number
      seats_available: number | null
      license?: {
        mode?: "trial" | "full"
        company_name: string
        address: string
        contact_email: string
        org_code?: string
        license_key_hash: string
        seats_total: number
        seats_used: number
        seats_available: number | null
        expires_at: string | null
        days_left?: number
        trial?: boolean
        activated_at?: string | null
      }
    }>("/v1/org/licenses"),

  activateLicense: (licenseKey: string) =>
    request<{
      ok: boolean
      license: {
        mode: string
        company_name: string
        address: string
        contact_email: string
        org_code: string
        seats_total: number
        seats_used: number
        expires_at: string
        license_key_display?: string
      }
    }>("/v1/org/license/activate", {
      method: "POST",
      body: JSON.stringify({ license_key: licenseKey })
    }),

  revokeLicense: () =>
    request<{ ok: boolean; mode: string }>("/v1/org/license/revoke", {
      method: "POST",
      body: "{}"
    }),

  billingStatus: () =>
    request<{
      enabled: boolean
      publishable_key: string | null
      price_seat_configured: boolean
      webhook_configured?: boolean
      portal_available?: boolean
      subscription_status?: string | null
      subscription_quantity?: number | null
      has_customer?: boolean
      org_id?: string | null
      org_seats?: number
      is_personal?: boolean
      note?: string
    }>("/v1/billing/status"),

  billingCheckout: (quantity: number) =>
    request<{ ok: boolean; url: string; session_id: string }>(
      "/v1/billing/checkout",
      {
        method: "POST",
        body: JSON.stringify({ quantity })
      }
    ),

  billingPortal: () =>
    request<{ ok: boolean; url: string }>("/v1/billing/portal", {
      method: "POST",
      body: "{}"
    }),

  gdprStatus: () =>
    request<{
      ok: boolean
      deleted: boolean
      deleted_at: string | null
      purge_at: string | null
      delete_reason: string | null
      days_until_purge: number | null
      can_restore: boolean
      purge_days_default: number
      protected: boolean
      confirm_phrase: string
      restore_phrase: string
    }>("/v1/org/gdpr/status"),

  gdprExport: () =>
    request<{ ok: boolean; export: unknown }>("/v1/org/gdpr/export"),

  gdprSoftDelete: (confirm: string, reason?: string) =>
    request<{
      ok: boolean
      deleted: boolean
      purge_at: string | null
      agents_revoked: number
      sessions_revoked: number
      message?: string
      error?: string
    }>("/v1/org/gdpr/soft-delete", {
      method: "POST",
      body: JSON.stringify({ confirm, reason })
    }),

  gdprRestore: (confirm: string) =>
    request<{
      ok: boolean
      deleted: boolean
      message?: string
      error?: string
    }>("/v1/org/gdpr/restore", {
      method: "POST",
      body: JSON.stringify({ confirm })
    }),

  riskSummary: (period: "7d" | "30d" | "90d" = "30d") =>
    request<Record<string, unknown>>(
      `/v1/org/risk/summary?period=${encodeURIComponent(period)}`
    ),

  riskUsers: (opts?: {
    period?: "7d" | "30d" | "90d"
    min_score?: number
    max_score?: number
    page?: number
    limit?: number
    sort?: string
  }) => {
    const q = new URLSearchParams()
    q.set("period", opts?.period || "30d")
    if (opts?.min_score != null) q.set("min_score", String(opts.min_score))
    if (opts?.max_score != null) q.set("max_score", String(opts.max_score))
    if (opts?.page != null) q.set("page", String(opts.page))
    if (opts?.limit != null) q.set("limit", String(opts.limit))
    if (opts?.sort) q.set("sort", opts.sort)
    return request<{
      ok: boolean
      users: unknown[]
      total: number
      average_score?: number
    }>(`/v1/org/risk/users?${q.toString()}`)
  },

  riskUserDetail: (agentId: string, period: "7d" | "30d" | "90d" = "30d") =>
    request<Record<string, unknown>>(
      `/v1/org/risk/users/${encodeURIComponent(agentId)}?period=${encodeURIComponent(period)}`
    ),

  riskRecalculate: (period: "7d" | "30d" | "90d" = "30d") =>
    request<{ ok: boolean; summary: unknown; users_count: number }>(
      "/v1/org/risk/recalculate",
      {
        method: "POST",
        body: JSON.stringify({ period })
      }
    ),

  shadowAi: (opts?: {
    period?: "7d" | "30d" | "90d"
    status?: "all" | "authorized" | "unauthorized" | "unknown"
  }) => {
    const q = new URLSearchParams()
    q.set("period", opts?.period || "30d")
    q.set("status", opts?.status || "all")
    return request<{
      ok: boolean
      tools: unknown[]
      counts: {
        total: number
        authorized: number
        unauthorized: number
        unknown: number
      }
    }>(`/v1/org/shadow-ai?${q.toString()}`)
  },

  patchShadowAi: (
    tool: string,
    status: "authorized" | "unauthorized" | "unknown",
    display_name?: string
  ) =>
    request<{ ok: boolean; tool: unknown }>(
      `/v1/org/shadow-ai/${encodeURIComponent(tool)}`,
      {
        method: "PATCH",
        body: JSON.stringify({ status, display_name })
      }
    ),

  eventsByDecision: (decision: string) =>
    request<{ org_id: string; decision: string; events: EventRow[] }>(
      `/v1/org/events/by-decision/${encodeURIComponent(decision)}`
    ),

  events: () =>
    request<{
      org_id: string
      events: EventRow[]
      count?: number
      retention?: {
        days: number
        weekly_export_enabled: boolean
        oldest_event_ts: string | null
        days_until_oldest_purge: number | null
        note?: string
      }
    }>("/v1/org/events"),

  exportEvents: (
    range: "week" | "all" | "custom",
    format: "csv" | "json" = "csv",
    opts?: { from?: string; to?: string }
  ) => {
    const q = new URLSearchParams({ range, format })
    if (opts?.from) q.set("from", opts.from)
    if (opts?.to) q.set("to", opts.to)
    return request<{
      ok: boolean
      filename: string
      format: string
      content: string
      count: number
      retention_days: number
      days_until_oldest_purge: number | null
      from_ts?: string
      to_ts?: string
    }>(`/v1/org/events/export?${q.toString()}`)
  },

  /** Rapport sécurité (agrégats + charts). format=json */
  securityReport: (opts: {
    range?: "week" | "current_week" | "custom" | "all"
    from?: string
    to?: string
  }) => {
    const q = new URLSearchParams({
      range: opts.range || "current_week",
      format: "json"
    })
    if (opts.from) q.set("from", opts.from)
    if (opts.to) q.set("to", opts.to)
    return request<{ ok: boolean; report: SecurityReport }>(
      `/v1/org/reports/security?${q.toString()}`
    )
  },

  /** Télécharge le PDF rapport (blob). */
  securityReportPdf: async (opts: {
    range?: "week" | "current_week" | "custom" | "all"
    from?: string
    to?: string
  }): Promise<{ blob: Blob; filename: string }> => {
    const q = new URLSearchParams({
      range: opts.range || "current_week",
      format: "pdf"
    })
    if (opts.from) q.set("from", opts.from)
    if (opts.to) q.set("to", opts.to)
    const base = getApiBase()
    const token = getToken()
    const res = await fetch(
      `${base.replace(/\/$/, "")}/v1/org/reports/security?${q.toString()}`,
      {
        headers: {
          accept: "application/pdf",
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        }
      }
    )
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(
        (err as { message?: string; error?: string }).message ||
          (err as { error?: string }).error ||
          `HTTP ${res.status}`
      )
    }
    const cd = res.headers.get("content-disposition") || ""
    const m = /filename="?([^";]+)"?/i.exec(cd)
    const filename = m?.[1] || "opsgate-security-report.pdf"
    const blob = await res.blob()
    return { blob, filename }
  },

  listEventExports: () =>
    request<{
      org_id: string
      exports: Array<{
        id: string
        kind: string
        format: string
        filename: string
        event_count: number
        from_ts: string
        to_ts: string
        created_at: string
        expires_at: string
        remaining_days: number
      }>
    }>("/v1/org/events/exports"),

  runExportNow: () =>
    request<{
      ok: boolean
      generated?: number
      weekKey?: string
      reason?: string
      mails_ok?: number
      mails_fail?: number
      recipients?: number
      smtp_configured?: boolean
      hint?: string
    }>("/v1/org/exports/run-now", { method: "POST", body: "{}" }),

  exportStatus: () =>
    request<{
      enabled: boolean
      recipient_count: number
      recipients_masked: string[]
      day_of_week: number
      time_local: string
      timezone: string
      formats: string[]
      last_weekly_export_at: string | null
      due_now: boolean
      smtp_enabled: boolean
      smtp_host: string | null
      cron_env: string
    }>("/v1/org/exports/status"),

  orgBackupExport: () =>
    request<{ ok: boolean; backup: unknown }>("/v1/org/backup"),

  orgBackupImport: (backup: unknown) =>
    request<{ ok: boolean; applied: string[] }>("/v1/org/backup/import", {
      method: "POST",
      body: JSON.stringify({ backup })
    }),

  webauthnStatus: () =>
    request<{ enabled: boolean; rp_id: string; origin: string }>(
      "/v1/auth/webauthn/status",
      { auth: false }
    ),

  webauthnRegisterOptions: () =>
    request<{
      ok: boolean
      challenge_id: string
      publicKey: Record<string, unknown>
    }>("/v1/org/admins/me/webauthn/register/options", {
      method: "POST",
      body: "{}"
    }),

  webauthnRegister: (body: {
    challenge_id: string
    credentialId: string
    publicKeyJwk: Record<string, unknown>
    transports?: string[]
    label?: string
  }) =>
    request<{
      ok: boolean
      credentials: Array<{
        credential_id: string
        label?: string
        created_at?: string
      }>
    }>("/v1/org/admins/me/webauthn/register", {
      method: "POST",
      body: JSON.stringify(body)
    }),

  webauthnCredentials: () =>
    request<{
      credentials: Array<{
        credential_id: string
        label?: string
        created_at?: string
      }>
    }>("/v1/org/admins/me/webauthn/credentials"),

  webauthnDelete: (id: string) =>
    request<{ ok: boolean }>(
      `/v1/org/admins/me/webauthn/credentials/${encodeURIComponent(id)}`,
      { method: "DELETE" }
    ),

  webauthnLoginOptions: (email?: string) =>
    request<{
      ok: boolean
      challenge_id: string
      publicKey: Record<string, unknown>
    }>("/v1/auth/webauthn/login/options", {
      method: "POST",
      auth: false,
      body: JSON.stringify({ email: email || undefined })
    }),

  webauthnLogin: (body: {
    challenge_id: string
    credentialId: string
    clientDataJSON: string
    authenticatorData: string
    signature: string
  }) =>
    request<{
      ok: boolean
      token: string
      admin: AdminRow
      hint?: string
    }>("/v1/auth/webauthn/login", {
      method: "POST",
      auth: false,
      body: JSON.stringify(body)
    }),

  downloadEventExport: (id: string) =>
    request<{
      ok: boolean
      filename: string
      format: string
      content: string
      remaining_days: number
    }>(`/v1/org/events/exports/${encodeURIComponent(id)}`),

  deleteUser: (id: string) =>
    request<{ ok: boolean }>(`/v1/org/users/${encodeURIComponent(id)}`, {
      method: "DELETE"
    }),

  groups: () =>
    request<{ org_id: string; groups: GroupRow[] }>("/v1/org/groups"),

  createGroup: (body: {
    name: string
    description?: string
    policy_profile_id?: string | null
  }) =>
    request<{ ok: boolean; group: GroupRow }>("/v1/org/groups", {
      method: "POST",
      body: JSON.stringify(body)
    }),

  updateGroup: (
    id: string,
    body: {
      name?: string
      description?: string
      policy_profile_id?: string | null
    }
  ) =>
    request<{ ok: boolean; group: GroupRow }>(
      `/v1/org/groups/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify(body) }
    ),

  deleteGroup: (id: string) =>
    request<{ ok: boolean }>(`/v1/org/groups/${encodeURIComponent(id)}`, {
      method: "DELETE"
    }),

  packs: () =>
    request<{
      org_id: string
      active_version?: string
      packs: PackListItem[]
    }>("/v1/org/rules/packs"),

  publishPack: (body: {
    notes?: string
    disable_rule_ids?: string[]
    activate?: boolean
  }) =>
    request<{
      ok: boolean
      version: string
      rules_count: number
      checksum: string
    }>("/v1/org/rules/packs", {
      method: "POST",
      body: JSON.stringify(body)
    }),

  activatePack: (version: string) =>
    request<{ ok: boolean; version: string }>(
      `/v1/org/rules/packs/${encodeURIComponent(version)}/activate`,
      { method: "POST" }
    ),

  deletePack: (version: string) =>
    request<{ ok: boolean; version: string }>(
      `/v1/org/rules/packs/${encodeURIComponent(version)}`,
      { method: "DELETE" }
    ),

  monitoring: () =>
    request<{ org_id: string; monitoring: MonitoringSettings }>(
      "/v1/org/monitoring"
    ),

  ldapStatus: () =>
    request<{
      org_id: string
      ldap: LdapSettings & { bind_password_set?: boolean; ready?: boolean }
      ready: boolean
      ready_reason?: string | null
    }>("/v1/org/ldap/status"),

  ldapTest: (body?: Partial<LdapSettings>) =>
    request<{ ok: boolean; message: string; entry_count?: number }>(
      "/v1/org/ldap/test",
      { method: "POST", body: JSON.stringify(body || {}) }
    ),

  ldapSync: (dryRun?: boolean) =>
    request<{
      ok: boolean
      dry_run: boolean
      groups_seen: number
      groups_upserted: number
      users_seen: number
      users_upserted: number
      message?: string
      errors?: string[]
      sample_groups?: string[]
      sample_users?: string[]
    }>("/v1/org/ldap/sync", {
      method: "POST",
      body: JSON.stringify({ dry_run: !!dryRun })
    }),

  mailStatus: () =>
    request<{
      org_id: string
      configured: boolean
      source: string | null
      host: string | null
      port: number | null
      from: string | null
      auth: boolean
      org_enabled: boolean
      env_configured: boolean
      mode: string
      smtp: SmtpSettings
      verify?: { ok: boolean; error?: string; source?: string } | null
    }>("/v1/org/mail/status"),

  saveMailSettings: (body: Partial<SmtpSettings>) =>
    request<{
      ok: boolean
      smtp: SmtpSettings
      status: {
        configured: boolean
        source: string | null
        host: string | null
        mode: string
      }
    }>("/v1/org/mail/settings", {
      method: "PUT",
      body: JSON.stringify(body)
    }),

  testMail: (send_test_to?: string) =>
    request<{
      ok: boolean
      verify: { ok: boolean; error?: string; source?: string }
      test_email?: {
        ok: boolean
        delivery?: string
        error?: string
      } | null
      smtp: SmtpSettings
      error?: string
    }>("/v1/org/mail/test", {
      method: "POST",
      body: JSON.stringify({ send_test_to: send_test_to || undefined })
    }),

  updateMonitoring: (body: Partial<MonitoringSettings>) =>
    request<{ ok: boolean; monitoring: MonitoringSettings }>(
      "/v1/org/monitoring",
      { method: "PATCH", body: JSON.stringify(body) }
    ),

  mergeAgents: (keep_id: string, merge_ids: string[]) =>
    request<{ ok: boolean; kept: string; removed: number }>(
      "/v1/org/agents/merge",
      {
        method: "POST",
        body: JSON.stringify({ keep_id, merge_ids })
      }
    ),

  revokeAgent: (agentId: string) =>
    request<{ ok: boolean }>(`/v1/org/agents/${encodeURIComponent(agentId)}`, {
      method: "DELETE"
    }),

  /** Inbox user → admin */
  inboxList: (opts?: {
    status?: "all" | "unread" | "open" | "read" | "replied" | "closed"
    limit?: number
  }) => {
    const q = new URLSearchParams()
    if (opts?.status) q.set("status", opts.status)
    if (opts?.limit) q.set("limit", String(opts.limit))
    const qs = q.toString()
    return request<{
      org_id: string
      unread: number
      messages: InboxMessage[]
    }>(`/v1/org/inbox${qs ? `?${qs}` : ""}`)
  },

  inboxUnreadCount: () =>
    request<{ org_id: string; unread: number }>("/v1/org/inbox/unread-count"),

  inboxMarkRead: (id: string) =>
    request<{ ok: boolean; message: InboxMessage }>(
      `/v1/org/inbox/${encodeURIComponent(id)}/read`,
      { method: "POST" }
    ),

  inboxReply: (id: string, reply: string) =>
    request<{ ok: boolean; message: InboxMessage }>(
      `/v1/org/inbox/${encodeURIComponent(id)}/reply`,
      { method: "POST", body: JSON.stringify({ reply }) }
    ),

  inboxClose: (id: string) =>
    request<{ ok: boolean; message: InboxMessage }>(
      `/v1/org/inbox/${encodeURIComponent(id)}/close`,
      { method: "POST" }
    ),

  recoveryInfo: () =>
    request<{
      ok: boolean
      note: string
      mode?: string
      legacy_env_usable?: boolean
      legacy_env_deprecated?: boolean
      recovery_password_hint: string
      offline_after_ms: number
      env_override: string
    }>("/v1/org/recovery-info"),

  recoveryCodes: () =>
    request<{
      org_id: string
      active_count: number
      low_stock: boolean
      codes: Array<{
        id: string
        label?: string
        created_at: string
        consumed_at?: string | null
        consumed_agent_id?: string | null
        active: boolean
      }>
    }>("/v1/org/recovery-codes"),

  generateRecoveryCodes: (count = 20, label?: string) =>
    request<{
      ok: boolean
      created: number
      codes: Array<{ id: string; code: string }>
      note: string
    }>("/v1/org/recovery-codes/generate", {
      method: "POST",
      body: JSON.stringify({ count, label })
    }),

  revokeRecoveryPool: () =>
    request<{ ok: boolean; revoked: number }>(
      "/v1/org/recovery-codes/revoke-pool",
      { method: "POST", body: "{}" }
    )
}

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String)
  if (typeof v === "string") {
    try {
      const p = JSON.parse(v)
      if (Array.isArray(p)) return p.map(String)
    } catch {
      /* plain string */
    }
    return v ? [v] : []
  }
  return []
}

/** Normalise camelCase / snake_case / JSON-string arrays depuis l’API */
export function normalizeEvent(raw: Record<string, unknown>): EventRow {
  const files = raw.file_names ?? raw.fileNames
  const types = asStringArray(raw.types)
  const ruleIds = asStringArray(raw.rule_ids ?? raw.ruleIds)
  return {
    id: String(raw.id || ""),
    ts: String(raw.ts || raw.received_at || raw.receivedAt || ""),
    source: String(raw.source || ""),
    hostname: String(raw.hostname || ""),
    decision: String(raw.decision || ""),
    detection_count: Number(raw.detection_count ?? raw.detectionCount ?? 0),
    highest_severity: String(
      raw.highest_severity || raw.highestSeverity || "low"
    ),
    types,
    masked: Boolean(raw.masked),
    rule_ids: ruleIds,
    exit_actor: raw.exit_actor
      ? String(raw.exit_actor)
      : raw.exitActor
        ? String(raw.exitActor)
        : undefined,
    exit_admin_label: raw.exit_admin_label
      ? String(raw.exit_admin_label)
      : raw.exitAdminLabel
        ? String(raw.exitAdminLabel)
        : undefined,
    device_label: raw.device_label
      ? String(raw.device_label)
      : raw.deviceLabel
        ? String(raw.deviceLabel)
        : undefined,
    file_names: Array.isArray(files)
      ? files.map(String)
      : files
        ? asStringArray(files)
        : null
  }
}
