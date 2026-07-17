import {
  clearCloudState,
  exitCredentials,
  getSettings,
  initRulesMemoryListener,
  requiresAdminPassword,
  setSettings
} from "~lib/agent-store"
import {
  ackAdminReply,
  enrollAgent,
  flushEventQueue,
  listMyAdminMessages,
  listPendingAdminReplies,
  revokeCurrentAgent,
  sendAdminMessage,
  syncConfig
} from "~lib/cloud"
import { detectText } from "~lib/detect"
import { matchExitPassword } from "~lib/mgmt-password"
import type { ExitActorInfo } from "~types"
import {
  appendJournal,
  clearJournal,
  flushPendingEvents,
  getJournal
} from "~lib/storage"
import { ext } from "~lib/browser-api"
import type { JournalEntry, OpsGateMessage } from "~types"

export {}

/** Poll fréquent : force-sync + révocation console appliqués sans visite poste */
const SYNC_ALARM = "opsgate-sync-config"
const SYNC_PERIOD_MIN = 2
/** Poll réponses admin (popup ack) */
const INBOX_ALARM = "opsgate-inbox-poll"
const INBOX_PERIOD_MIN = 1
const PENDING_REPLIES_KEY = "opsGatePendingAdminReplies"

ext.runtime.onInstalled.addListener(() => {
  console.log("[OpsGate] Extension installée / mise à jour")
  void ensureSyncAlarm()
  void maybeAutoSync()
  void pollPendingAdminReplies()
})

ext.runtime.onStartup.addListener(() => {
  void ensureSyncAlarm()
  void maybeAutoSync()
  void pollPendingAdminReplies()
})

initRulesMemoryListener()
void ensureSyncAlarm()
void pollPendingAdminReplies()

ext.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SYNC_ALARM) {
    void maybeAutoSync()
  }
  if (alarm.name === INBOX_ALARM) {
    void pollPendingAdminReplies()
  }
})

async function ensureSyncAlarm() {
  try {
    await ext.alarms.create(SYNC_ALARM, {
      periodInMinutes: SYNC_PERIOD_MIN
    })
  } catch {
    // ignore
  }
  try {
    await ext.alarms.create(INBOX_ALARM, {
      periodInMinutes: INBOX_PERIOD_MIN
    })
  } catch {
    // ignore
  }
}

async function maybeAutoSync() {
  const s = await getSettings()
  if (s.agentToken && s.mode !== "local_only") {
    const r = await syncConfig(s)
    if (r.ok) {
      console.log("[OpsGate] auto-sync", "ok")
      const n = await flushEventQueue(r.settings)
      if (n > 0) console.log("[OpsGate] flushed events", n)
      void pollPendingAdminReplies()
    } else {
      console.log(
        "[OpsGate] auto-sync",
        "error" in r ? r.error : "failed"
      )
      void flushPendingEvents()
    }
  }
}

/** Récupère les réponses admin non acquittées → badge + storage pour content scripts */
async function pollPendingAdminReplies() {
  const s = await getSettings()
  if (!s.agentToken || s.mode === "local_only") {
    try {
      await ext.storage.local.set({ [PENDING_REPLIES_KEY]: [] })
      await ext.action?.setBadgeText?.({ text: "" })
    } catch {
      /* ignore */
    }
    return
  }
  const r = await listPendingAdminReplies()
  const list = r.ok ? r.messages : []
  try {
    await ext.storage.local.set({ [PENDING_REPLIES_KEY]: list })
    const n = list.length
    if (ext.action?.setBadgeText) {
      await ext.action.setBadgeText({ text: n > 0 ? String(Math.min(n, 9)) : "" })
      if (n > 0 && ext.action.setBadgeBackgroundColor) {
        await ext.action.setBadgeBackgroundColor({ color: "#0f766e" })
      }
    }
  } catch {
    /* ignore */
  }
}

ext.runtime.onMessage.addListener(
  (message: OpsGateMessage, _sender, sendResponse) => {
    handleMessage(message)
      .then(sendResponse)
      .catch((err) => {
        console.error("[OpsGate] Message error:", err)
        sendResponse({ ok: false, error: String(err) })
      })
    // true = réponse async (Chrome + Firefox MV3)
    return true
  }
)

async function handleMessage(message: OpsGateMessage): Promise<unknown> {
  switch (message.type) {
    case "PING":
      return { ok: true, version: ext.runtime.getManifest().version }

    case "DETECT": {
      const { detections } = await detectText(message.text ?? "")
      return { ok: true, detections }
    }

    case "OCR_BITMAP": {
      // Tesseract dans le service worker (évite CSP des sites IA)
      try {
        const { ocrBitmapBase64 } = await import("~lib/ocr-bitmap")
        const r = await ocrBitmapBase64(
          message.base64 || "",
          message.mime || "image/png"
        )
        if (r.ok === true) {
          return {
            ok: true,
            text: r.text,
            truncated: r.truncated,
            ms: r.ms
          }
        }
        return { ok: false, error: r.ok === false ? r.error : "ocr_failed" }
      } catch (e) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : "ocr_failed"
        }
      }
    }

    case "LOG_DETECTION": {
      // Journal local + report cloud (mask_send / send_anyway / cancel / secure_rewrite)
      // appendJournal attend le POST (ou enqueue) - ne pas fire-and-forget ici.
      const entry = await appendJournal(message.entry)
      // Relancer la file au cas où d’autres events étaient en attente
      try {
        await flushPendingEvents()
      } catch {
        /* ignore */
      }
      return { ok: true, entry }
    }

    case "GET_SETTINGS": {
      return { ok: true, settings: await getSettings() }
    }

    case "SET_SETTINGS": {
      const current = await getSettings()
      if (current.managedLockActive) {
        // Seule l'URL API peut être mise à jour (pour retenter le sync)
        const keys = Object.keys(message.partial)
        const onlyApi =
          keys.length === 1 && message.partial.apiBaseUrl !== undefined
        if (onlyApi) {
          return {
            ok: true,
            settings: await setSettings({
              apiBaseUrl: message.partial.apiBaseUrl
            })
          }
        }
        return {
          ok: false,
          error: "org_managed_locked",
          message:
            "Paramètres gérés par l’organisation. Désinscription via Options.",
          settings: current
        }
      }
      // Enrolled but not yet successful sync - still soft lock for most fields
      if (current.agentToken && current.orgId) {
        const keys = Object.keys(message.partial)
        const onlyApi =
          keys.length === 1 && message.partial.apiBaseUrl !== undefined
        if (!onlyApi) {
          return {
            ok: false,
            error: "org_managed_locked",
            settings: current
          }
        }
      }
      return { ok: true, settings: await setSettings(message.partial) }
    }

    case "GET_JOURNAL": {
      return { ok: true, journal: await getJournal() }
    }

    case "CLEAR_JOURNAL": {
      const current = await getSettings()
      if (current.managedLockActive) {
        return { ok: false, error: "org_managed_locked", settings: current }
      }
      await clearJournal()
      return { ok: true }
    }

    case "SET_ENABLED": {
      const current = await getSettings()
      if (current.managedLockActive || (current.agentToken && current.orgId)) {
        // Endpoint protection : on ne laisse pas désactiver
        return {
          ok: false,
          error: "org_managed_locked",
          message: "Impossible de désactiver un agent géré.",
          settings: current
        }
      }
      return {
        ok: true,
        settings: await setSettings({ enabled: message.enabled })
      }
    }

    case "ENROLL": {
      if (message.apiBaseUrl) {
        await setSettings({ apiBaseUrl: message.apiBaseUrl })
      }
      // Si déjà sous lock, exiger mdp pour changer d'org
      const current = await getSettings()
      if (requiresAdminPassword(current)) {
        return {
          ok: false,
          error: "admin_password_required",
          message:
            "Déjà protégé par un mdp de désinscription org. Désenrôlez d’abord (Options), puis ré-enrôlez."
        }
      }
      // Partial enroll sans lock : nettoyer avant
      if (current.agentToken && !current.managedLockActive) {
        try {
          await revokeCurrentAgent()
        } catch {
          /* ignore */
        }
        await clearCloudState()
        if (message.apiBaseUrl) {
          await setSettings({ apiBaseUrl: message.apiBaseUrl })
        }
      }
      return enrollAgent(
        message.orgCode,
        message.deviceLabel,
        // strict : seul true active le mode personnel
        message.personal === true,
        message.personal === true ? message.personalLicenseKey : undefined
      )
    }

    case "SYNC_NOW": {
      return syncConfig()
    }

    case "UNENROLL":
    case "RESET_LOCAL_ORG": {
      return exitManagedMode(
        "adminPassword" in message ? message.adminPassword : undefined,
        "adminUsername" in message ? message.adminUsername : undefined
      )
    }

    case "GET_CLOUD_STATUS": {
      const settings = await getSettings()
      return {
        ok: true,
        enrolled: !!(settings.agentToken && settings.orgId),
        managedLockActive: !!settings.managedLockActive,
        requiresAdminPassword: requiresAdminPassword(settings),
        mode: settings.mode,
        orgName: settings.orgName,
        orgId: settings.orgId,
        agentId: settings.agentId,
        rulesPackVersion: settings.rulesPackVersion,
        lastRulesSyncAt: settings.lastRulesSyncAt,
        lastSyncError: settings.lastSyncError,
        eventReporting: settings.eventReporting,
        apiBaseUrl: settings.apiBaseUrl
      }
    }

    case "CONTACT_ADMIN": {
      const r = await sendAdminMessage({
        subject: message.subject,
        body: message.body,
        category: message.category,
        contextUrl: message.contextUrl,
        contextHostname: message.contextHostname
      })
      return r
    }

    case "LIST_ADMIN_MESSAGES": {
      return listMyAdminMessages(15)
    }

    case "LIST_PENDING_ADMIN_REPLIES": {
      const r = await listPendingAdminReplies()
      if (r.ok) {
        try {
          await ext.storage.local.set({
            opsGatePendingAdminReplies: r.messages
          })
        } catch {
          /* ignore */
        }
      }
      return r
    }

    case "ACK_ADMIN_REPLY": {
      const r = await ackAdminReply(message.messageId)
      if (r.ok) void pollPendingAdminReplies()
      return r
    }

    default:
      return { ok: false, error: "Unknown message type" }
  }
}

async function exitManagedMode(
  adminPassword?: string,
  adminUsername?: string
) {
  const current = await getSettings()
  let exit: ExitActorInfo = { type: "free" }

  // Username + password si policy protégée
  if (requiresAdminPassword(current)) {
    if (!adminPassword || !adminUsername?.trim()) {
      return {
        ok: false,
        error: "admin_credentials_required",
        message:
          "Saisissez le nom d'utilisateur admin (label ou email) et le mot de passe."
      }
    }
    const matched = await matchExitPassword(
      adminPassword,
      exitCredentials(current),
      adminUsername
    )
    if (!matched) {
      return {
        ok: false,
        error: "admin_password_invalid",
        message: "Identifiants incorrects."
      }
    }
    exit = matched
  }

  // Burn one-time recovery code locally (même si offline / revoke échoue)
  if (exit.type === "vendor_recovery" && exit.recoveryCodeId) {
    const remaining = (current.recoveryCodes || []).filter(
      (c) => c.id !== exit.recoveryCodeId
    )
    await setSettings({ recoveryCodes: remaining })
  }

  try {
    await revokeCurrentAgent(exit)
  } catch {
    /* ignore */
  }
  const settings = await clearCloudState()
  return {
    ok: true,
    settings,
    exit_actor: exit,
    message: "Appareil désenrôlé."
  }
}
