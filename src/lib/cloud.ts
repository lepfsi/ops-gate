import type { DetectionRule } from "@opsgate/engine"

import {
  clearCloudState,
  getOrCreateInstallId,
  getSettings,
  setCachedRulesPack,
  setSettings
} from "~lib/agent-store"
import { ext } from "~lib/browser-api"
import { fetchApiPublicKey, verifyRulesPack } from "~lib/pack-verify"
import type { CachedRulesPack, OpsGateSettings } from "~types"

export interface EnrollResponse {
  agent_id: string
  agent_token: string
  org_id: string
  org_name?: string
  mode: string
  rules_pack_version?: string
  policy_etag?: string
  /** Compte personnel (abonnement) — renvoyé par l’API enroll */
  personal?: boolean
}

export interface ConfigResponse {
  etag?: string
  org: {
    id: string
    name: string
    mode: string
    event_payload_policy?: string
    personal?: boolean
  }
  policy: {
    version: number
    config_epoch?: number
    default_action: string
    enabled_hosts: string[]
    scan_uploads: boolean
    file_scan?: {
      configs?: boolean
      databases?: boolean
      images?: boolean
      office?: boolean
      media_warn?: boolean
    }
    event_reporting: boolean
    rules_pack_version: string
    protect_unenroll?: boolean
    user_messages?: Record<string, string>
    require_unenroll_password?: boolean
    admin_credentials?: Array<{
      id: string
      label: string
      email?: string
      password_hash: string
    }>
    management_password_hash?: string
    recovery_password_hash?: string
    recovery_offline_after_ms?: number
    recovery_codes?: Array<{ id: string; hash: string }>
    profile_id?: string | null
    profile_name?: string | null
    department?: string | null
    licensed?: boolean
    unlicensed_since?: string | null
    license_grace_ms?: number
    security_active?: boolean
    license_status?: "licensed" | "grace" | "unlicensed"
    updated_at: string
  }
  rules_pack: {
    version: string
    checksum: string
    signature?: string
    rules: DetectionRule[]
    notes?: string
  }
}

const EVENT_QUEUE_KEY = "opsGateEventQueue"
const MAX_QUEUE = 80

function apiUrl(base: string, path: string): string {
  return `${base.replace(/\/$/, "")}${path}`
}

async function getEventQueue(): Promise<Record<string, unknown>[]> {
  const data = await ext.storage.local.get(EVENT_QUEUE_KEY)
  return (data[EVENT_QUEUE_KEY] as Record<string, unknown>[]) || []
}

async function setEventQueue(events: Record<string, unknown>[]) {
  await ext.storage.local.set({
    [EVENT_QUEUE_KEY]: events.slice(-MAX_QUEUE)
  })
}

async function enqueueEvents(events: Record<string, unknown>[]) {
  const q = await getEventQueue()
  await setEventQueue([...q, ...events])
}

/** Révoque le token courant + audit exit_actor (best-effort) */
export async function revokeCurrentAgent(exit?: {
  type: "admin" | "vendor_recovery" | "free"
  adminId?: string
  adminLabel?: string
  recoveryCodeId?: string
}): Promise<boolean> {
  const settings = await getSettings()
  if (!settings.agentToken || !settings.apiBaseUrl) return false
  try {
    const res = await fetch(apiUrl(settings.apiBaseUrl, "/v1/agents/me/revoke"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.agentToken}`,
        accept: "application/json",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        exit_actor: exit?.type || "free",
        admin_id: exit?.adminId,
        admin_label: exit?.adminLabel,
        recovery_code_id: exit?.recoveryCodeId
      })
    })
    return res.ok
  } catch {
    return false
  }
}

export async function enrollAgent(
  orgCode: string,
  deviceLabel?: string,
  personal?: boolean,
  personalLicenseKey?: string
): Promise<{ ok: true; settings: OpsGateSettings } | { ok: false; error: string }> {
  const settings = await getSettings()
  const base = settings.apiBaseUrl

  try {
    if (settings.agentToken) {
      await revokeCurrentAgent()
    }

    const isPersonal = personal === true
    const code = isPersonal ? "PERSONAL" : (orgCode || "").trim()
    if (!isPersonal && !code) {
      return { ok: false, error: "org_code_required" }
    }

    const fingerprint = await getOrCreateInstallId()
    const res = await fetch(apiUrl(base, "/v1/enroll"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        org_code: code,
        // strict boolean — ne jamais envoyer true pour un enroll org
        personal: isPersonal,
        device_label: deviceLabel || "browser-extension",
        personal_license_key: isPersonal
          ? personalLicenseKey?.trim()
          : undefined,
        app_version: ext.runtime.getManifest().version,
        device_fingerprint: fingerprint
      })
    })
    const body = (await res.json()) as EnrollResponse & {
      error?: string
      replaced?: boolean
    }
    if (!res.ok) {
      return { ok: false, error: body.error || `http_${res.status}` }
    }
    if (!body.agent_token || !body.agent_id) {
      return { ok: false, error: "invalid_enroll_response" }
    }

    // Toujours faire confiance à la réponse serveur (org.isPersonal)
    const enrolledPersonal = body.personal === true
    const next = await setSettings({
      mode: (body.mode as OpsGateSettings["mode"]) || "org_managed",
      orgId: body.org_id,
      orgName: body.org_name,
      agentId: body.agent_id,
      agentToken: body.agent_token,
      deviceLabel: deviceLabel || "browser-extension",
      personalAccount: enrolledPersonal,
      // Org : activer le reporting dès l’enroll (sync affirmera la policy)
      eventReporting: enrolledPersonal ? false : true,
      lastSyncError: undefined
    })

    const sync = await syncConfig(next)
    if (!sync.ok) {
      const syncErr = "error" in sync ? sync.error : "unknown"
      return { ok: false, error: `enrolled_but_sync_failed:${syncErr}` }
    }
    return { ok: true, settings: sync.settings }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

export async function syncConfig(
  settingsOverride?: OpsGateSettings
): Promise<
  | { ok: true; settings: OpsGateSettings; pack: CachedRulesPack }
  | {
      ok: false
      error: string
      recovered?: boolean
      requiresAdminPassword?: boolean
      settings?: OpsGateSettings
    }
> {
  const settings = settingsOverride || (await getSettings())
  if (!settings.agentToken) {
    return { ok: false, error: "not_enrolled" }
  }

  try {
    const res = await fetch(apiUrl(settings.apiBaseUrl, "/v1/agents/me/config"), {
      headers: {
        Authorization: `Bearer ${settings.agentToken}`,
        Accept: "application/json"
      }
    })

    if (res.status === 401 || res.status === 403) {
      // Révocation console (ou token mort) : sortir du mode managé SANS mdp local.
      // L’admin a déjà autorisé la sortie côté control plane.
      await clearCloudState()
      const next = await setSettings({
        lastSyncError: "revoked_remote",
        enabled: true
      })
      console.warn(
        "[OpsGate] Token invalide / agent révoqué — retour local_only (sans mdp)"
      )
      return {
        ok: false,
        error: "revoked_remote",
        recovered: true,
        settings: next
      }
    }
    if (!res.ok) {
      const err = `http_${res.status}`
      await setSettings({ lastSyncError: err })
      return { ok: false, error: err, settings }
    }

    const body = (await res.json()) as ConfigResponse

    const pubKey = await fetchApiPublicKey(settings.apiBaseUrl)
    const verified = await verifyRulesPack({
      rules: body.rules_pack.rules,
      checksum: body.rules_pack.checksum,
      signature: body.rules_pack.signature,
      publicKeySpkiBase64: pubKey
    })
    if (!verified.ok) {
      const verr = "error" in verified ? verified.error : "unknown"
      const err = `pack_verify_failed:${verr}`
      await setSettings({ lastSyncError: err })
      const needsPwd = !!(
        settings.managementPasswordHash &&
        settings.managementPasswordHash.trim().length > 0
      )
      return {
        ok: false,
        error: err,
        requiresAdminPassword: needsPwd,
        settings
      }
    }

    const pack: CachedRulesPack = {
      version: body.rules_pack.version,
      checksum: body.rules_pack.checksum,
      signature: body.rules_pack.signature,
      rules: body.rules_pack.rules,
      syncedAt: Date.now()
    }
    await setCachedRulesPack(pack)

    const hosts =
      body.policy.enabled_hosts?.length > 0
        ? body.policy.enabled_hosts
        : settings.enabledHosts

    const adminCredentials = (body.policy.admin_credentials || [])
      .filter((a) => a.password_hash?.trim())
      .map((a) => ({
        id: a.id,
        label: a.label,
        email: a.email,
        passwordHash: a.password_hash.trim()
      }))
    const rawHash = (body.policy.management_password_hash || "").trim()
    const mgmtHash =
      adminCredentials[0]?.passwordHash ||
      (rawHash.length > 0 ? rawHash : undefined)
    const rawRecovery = (body.policy.recovery_password_hash || "").trim()
    const recoveryHash = rawRecovery.length > 0 ? rawRecovery : undefined
    const recoveryCodes = (body.policy.recovery_codes || [])
      .filter((c) => c?.id && c?.hash)
      .map((c) => ({ id: String(c.id), hash: String(c.hash).trim() }))
    const requireUnenroll = !!body.policy.require_unenroll_password
    const protectUnenroll = !!body.policy.protect_unenroll

    const next = await setSettings({
      mode: (body.org.mode as OpsGateSettings["mode"]) || settings.mode,
      orgId: body.org.id,
      orgName: body.org.name,
      // Ne pas coller un ancien personalAccount=true (sticky) après enroll org
      personalAccount: body.org.personal === true,
      rulesPackVersion: pack.version,
      rulesPackChecksum: pack.checksum,
      // true par défaut pour org ; false seulement si policy coupe
      eventReporting:
        body.org.personal === true
          ? false
          : body.policy.event_reporting !== false,
      scanUploads: body.policy.scan_uploads !== false,
      // Sous-flags fichiers : pilotés par policy (sync écrase le local)
      scanConfigs: body.policy.file_scan?.configs !== false,
      scanDatabases: body.policy.file_scan?.databases !== false,
      scanImages: body.policy.file_scan?.images === true,
      scanOffice: body.policy.file_scan?.office !== false,
      warnMedia: body.policy.file_scan?.media_warn !== false,
      enabledHosts: hosts,
      lastRulesSyncAt: pack.syncedAt,
      lastSyncError: undefined,
      managedLockActive: body.org.personal !== true,
      managementPasswordHash: mgmtHash,
      adminCredentials:
        adminCredentials.length > 0 ? adminCredentials : undefined,
      requireUnenrollPassword: requireUnenroll,
      protectUnenroll,
      recoveryPasswordHash: recoveryHash,
      recoveryCodes: recoveryCodes.length > 0 ? recoveryCodes : [],
      recoveryOfflineAfterMs:
        body.policy.recovery_offline_after_ms || 2 * 60 * 60 * 1000,
      configEpoch: body.policy.config_epoch,
      policyProfileId: body.policy.profile_id || undefined,
      policyProfileName: body.policy.profile_name || undefined,
      licensed: body.policy.licensed !== false,
      licenseStatus: body.policy.license_status || "licensed",
      unlicensedSince: body.policy.unlicensed_since
        ? Date.parse(body.policy.unlicensed_since)
        : undefined,
      licenseGraceMs: body.policy.license_grace_ms || 24 * 60 * 60 * 1000,
      securityActive: body.policy.security_active !== false,
      defaultAction: (body.policy.default_action as OpsGateSettings["defaultAction"]) ||
        "mask_recommend",
      userMessages: body.policy.user_messages || {},
      // Si unlicensed après grace → désactive la protection locale
      enabled:
        body.policy.security_active === false
          ? false
          : body.policy.license_status === "unlicensed"
            ? false
            : true
    })

    // Après sync OK, vider la file d'events en attente
    void flushEventQueue(next)

    return { ok: true, settings: next, pack }
  } catch (e) {
    const error = String(e)
    await setSettings({ lastSyncError: error })
    return { ok: false, error }
  }
}

/**
 * Envoie un batch d'events. En cas d'échec → file locale pour retry.
 */
export async function reportEvents(
  events: Record<string, unknown>[]
): Promise<boolean> {
  const settings = await getSettings()
  if (events.length === 0) return false
  if (settings.mode === "local_only" || !settings.agentToken) {
    await setSettings({ lastEventError: "not_enrolled_or_local_only" })
    return false
  }
  // Personnel : pas de télémétrie cloud
  if (settings.personalAccount === true) {
    await setSettings({ lastEventError: "personal_no_telemetry" })
    return false
  }
  // Org : envoyer sauf coupure explicite policy (false).
  // undefined / true → on envoie (évite sticky false avant 1er sync).
  if (settings.eventReporting === false) {
    await setSettings({ lastEventError: "event_reporting_disabled" })
    return false
  }

  try {
    // File d’abord (persistance SW) puis POST — si le worker est tué
    // entre enqueue et réponse, le flush auto-sync récupère les events.
    await enqueueEvents(events)

    const res = await fetch(apiUrl(settings.apiBaseUrl, "/v1/events/batch"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.agentToken}`,
        "content-type": "application/json",
        accept: "application/json"
      },
      body: JSON.stringify({ events })
    })
    if (!res.ok) {
      const text = await res.text().catch(() => "")
      await setSettings({
        lastEventError: `http_${res.status}${text ? ":" + text.slice(0, 120) : ""}`
      })
      return false
    }
    // Retirer de la file les client_event_id acceptés (idempotent côté API)
    try {
      const q = await getEventQueue()
      const sent = new Set(
        events
          .map((e) => String((e as { client_event_id?: string }).client_event_id || ""))
          .filter(Boolean)
      )
      if (sent.size > 0) {
        await setEventQueue(
          q.filter(
            (e) =>
              !sent.has(
                String((e as { client_event_id?: string }).client_event_id || "")
              )
          )
        )
      }
    } catch {
      /* ignore queue prune */
    }
    // Même si accepted partiel, on considère le batch OK
    await setSettings({ lastEventError: undefined })
    // Tenter le reste de la file
    void flushEventQueue(settings)
    return true
  } catch (e) {
    // Déjà enqueued ci-dessus
    await setSettings({ lastEventError: String(e) })
    return false
  }
}

/** Envoyer un message à l’admin org (inbox) */
export async function sendAdminMessage(input: {
  subject: string
  body: string
  category?: "question" | "exception" | "block_appeal" | "other"
  contextUrl?: string
  contextHostname?: string
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const settings = await getSettings()
  if (!settings.agentToken || !settings.apiBaseUrl) {
    return { ok: false, error: "not_enrolled" }
  }
  try {
    const res = await fetch(
      apiUrl(settings.apiBaseUrl, "/v1/agents/me/messages"),
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${settings.agentToken}`,
          "content-type": "application/json",
          accept: "application/json"
        },
        body: JSON.stringify({
          subject: input.subject,
          body: input.body,
          category: input.category || "question",
          context_url: input.contextUrl,
          context_hostname: input.contextHostname
        })
      }
    )
    const data = (await res.json().catch(() => ({}))) as {
      error?: string
      message?: string | { id?: string }
      ok?: boolean
    }
    if (!res.ok) {
      const human =
        typeof data.message === "string" ? data.message : undefined
      return {
        ok: false,
        error: human || data.error || `http_${res.status}`
      }
    }
    const id =
      typeof data.message === "object" && data.message?.id
        ? data.message.id
        : "ok"
    return { ok: true, id }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

export type AgentInboxMessage = {
  id: string
  subject: string
  body: string
  status: string
  category: string
  created_at: string
  admin_reply?: string | null
  replied_at?: string | null
  replied_by_admin_label?: string | null
  user_acked_at?: string | null
  needs_user_ack?: boolean
}

/** Lister les messages de cet agent (+ réponses admin) */
export async function listMyAdminMessages(limit = 10): Promise<{
  ok: boolean
  messages: AgentInboxMessage[]
  pending_ack?: number
  error?: string
}> {
  const settings = await getSettings()
  if (!settings.agentToken || !settings.apiBaseUrl) {
    return { ok: false, messages: [], error: "not_enrolled" }
  }
  try {
    const res = await fetch(
      apiUrl(
        settings.apiBaseUrl,
        `/v1/agents/me/messages?limit=${Math.min(50, limit)}`
      ),
      {
        headers: {
          Authorization: `Bearer ${settings.agentToken}`,
          accept: "application/json"
        }
      }
    )
    if (!res.ok) {
      return { ok: false, messages: [], error: `http_${res.status}` }
    }
    const data = (await res.json()) as {
      messages?: AgentInboxMessage[]
      pending_ack?: number
    }
    return {
      ok: true,
      messages: data.messages || [],
      pending_ack: data.pending_ack || 0
    }
  } catch (e) {
    return { ok: false, messages: [], error: String(e) }
  }
}

/** Réponses admin non acquittées (popup bloquant) */
export async function listPendingAdminReplies(): Promise<{
  ok: boolean
  messages: AgentInboxMessage[]
  error?: string
}> {
  const settings = await getSettings()
  if (!settings.agentToken || !settings.apiBaseUrl) {
    return { ok: false, messages: [], error: "not_enrolled" }
  }
  try {
    const res = await fetch(
      apiUrl(settings.apiBaseUrl, "/v1/agents/me/messages?pending_ack=1"),
      {
        headers: {
          Authorization: `Bearer ${settings.agentToken}`,
          accept: "application/json"
        }
      }
    )
    if (!res.ok) {
      return { ok: false, messages: [], error: `http_${res.status}` }
    }
    const data = (await res.json()) as { messages?: AgentInboxMessage[] }
    return { ok: true, messages: data.messages || [] }
  } catch (e) {
    return { ok: false, messages: [], error: String(e) }
  }
}

/** Acquitter une réponse admin (OK sur le popup) */
export async function ackAdminReply(
  messageId: string
): Promise<{ ok: boolean; error?: string }> {
  const settings = await getSettings()
  if (!settings.agentToken || !settings.apiBaseUrl) {
    return { ok: false, error: "not_enrolled" }
  }
  try {
    const res = await fetch(
      apiUrl(
        settings.apiBaseUrl,
        `/v1/agents/me/messages/${encodeURIComponent(messageId)}/ack`
      ),
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${settings.agentToken}`,
          accept: "application/json"
        }
      }
    )
    if (!res.ok) {
      return { ok: false, error: `http_${res.status}` }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

/** Flush file d'attente events (auto-sync / alarm) */
export async function flushEventQueue(
  settingsOverride?: OpsGateSettings
): Promise<number> {
  const settings = settingsOverride || (await getSettings())
  if (
    settings.mode === "local_only" ||
    !settings.agentToken ||
    settings.personalAccount === true ||
    settings.eventReporting === false
  ) {
    return 0
  }
  const q = await getEventQueue()
  if (q.length === 0) return 0

  try {
    const res = await fetch(apiUrl(settings.apiBaseUrl, "/v1/events/batch"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.agentToken}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ events: q })
    })
    if (res.ok) {
      await setEventQueue([])
      await setSettings({ lastEventError: undefined })
      return q.length
    }
    await setSettings({ lastEventError: `flush_http_${res.status}` })
    return 0
  } catch (e) {
    await setSettings({ lastEventError: String(e) })
    return 0
  }
}
