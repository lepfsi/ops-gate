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
    }
    e.code = err.error
    if (typeof err.remaining_attempts === "number") {
      e.remaining_attempts = err.remaining_attempts
    }
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
}

export type Summary = {
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
}

export type NotificationSettings = {
  licenseExpiring: boolean
  licenseExpiringDays: number
  loginBruteForce: boolean
  loginBruteForceThreshold: number
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
  weeklyExportEnabled?: boolean
  lastWeeklyExportAt?: string | null
  logCategories?: LogCategories
  notifications?: NotificationSettings
  licenseDisplay?: LicenseDisplay
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

export type PolicyDoc = {
  id: string
  orgId: string
  version: number
  configEpoch?: number
  defaultAction: string
  enabledHosts: string[]
  scanUploads: boolean
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
  matchField: "device_label" | "host_name"
  matchOp: "starts_with" | "contains" | "equals" | "regex"
  matchValue: string
  targetGroupId: string
  priority: number
  onlyIfUnassigned: boolean
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

  login: (email: string, password: string, force?: boolean) =>
    request<{
      ok: boolean
      token: string
      expires_at: number
      admin: AdminRow
      hint?: string
      forced?: boolean
    }>("/v1/auth/login", {
      method: "POST",
      auth: false,
      body: JSON.stringify({ email, password, force: !!force })
    }),

  logout: (reason?: "manual" | "idle") =>
    request<{ ok: boolean }>("/v1/auth/logout", {
      method: "POST",
      body: JSON.stringify({ reason: reason || "manual" })
    }),

  audit: (action?: string) =>
    request<{
      org_id: string
      events: Array<{
        id: string
        adminEmail?: string
        adminLabel?: string
        action: string
        detail?: string
        createdAt: string
      }>
    }>(
      `/v1/org/audit${action ? `?action=${encodeURIComponent(action)}` : ""}`
    ),

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
    enabled?: boolean
  }) =>
    request<{ ok: boolean; rule: MovingRuleRow }>("/v1/org/moving-rules", {
      method: "POST",
      body: JSON.stringify(body)
    }),

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
      enabled?: boolean
    }
  ) =>
    request<{ ok: boolean; rule: MovingRuleRow }>(
      `/v1/org/moving-rules/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify(body) }
    ),

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
      } | null
    }>("/v1/auth/me"),

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

  requestPrincipalOtp: (email?: string) =>
    request<{
      ok: boolean
      expires_in_sec?: number
      dev_otp?: string
      message: string
    }>("/v1/auth/password-reset/request", {
      method: "POST",
      auth: false,
      body: JSON.stringify({ email })
    }),

  confirmPrincipalOtp: (otp: string, new_password: string) =>
    request<{ ok: boolean; message?: string }>(
      "/v1/auth/password-reset/confirm",
      {
        method: "POST",
        auth: false,
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
