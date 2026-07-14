import {
  canUseVendorRecovery,
  clearCloudState,
  exitCredentials,
  getSettings,
  initRulesMemoryListener,
  requiresAdminPassword,
  setSettings
} from "~lib/agent-store"
import {
  enrollAgent,
  flushEventQueue,
  revokeCurrentAgent,
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
import type { JournalEntry, OpsGateMessage } from "~types"

export {}

/** Poll fréquent : force-sync + révocation console appliqués sans visite poste */
const SYNC_ALARM = "opsgate-sync-config"
const SYNC_PERIOD_MIN = 2

chrome.runtime.onInstalled.addListener(() => {
  console.log("[OpsGate] Extension installée / mise à jour")
  void ensureSyncAlarm()
  void maybeAutoSync()
})

chrome.runtime.onStartup.addListener(() => {
  void ensureSyncAlarm()
  void maybeAutoSync()
})

initRulesMemoryListener()
void ensureSyncAlarm()

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SYNC_ALARM) {
    void maybeAutoSync()
  }
})

async function ensureSyncAlarm() {
  try {
    await chrome.alarms.create(SYNC_ALARM, {
      periodInMinutes: SYNC_PERIOD_MIN
    })
  } catch {
    // ignore
  }
}

async function maybeAutoSync() {
  const s = await getSettings()
  if (s.agentToken && s.mode !== "local_only") {
    const r = await syncConfig(s)
    console.log("[OpsGate] auto-sync", r.ok ? "ok" : r.error)
    if (r.ok) {
      const n = await flushEventQueue(r.settings)
      if (n > 0) console.log("[OpsGate] flushed events", n)
    } else {
      void flushPendingEvents()
    }
  }
}

chrome.runtime.onMessage.addListener(
  (message: OpsGateMessage, _sender, sendResponse) => {
    handleMessage(message)
      .then(sendResponse)
      .catch((err) => {
        console.error("[OpsGate] Message error:", err)
        sendResponse({ ok: false, error: String(err) })
      })
    return true
  }
)

async function handleMessage(message: OpsGateMessage): Promise<unknown> {
  switch (message.type) {
    case "PING":
      return { ok: true, version: chrome.runtime.getManifest().version }

    case "DETECT": {
      const { detections } = await detectText(message.text ?? "")
      return { ok: true, detections }
    }

    case "LOG_DETECTION": {
      // Journal local + report cloud (mask_send / send_anyway / cancel)
      const entry = await appendJournal(message.entry)
      // Relancer la file au cas où le POST précédent a échoué
      void flushPendingEvents()
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
            "Endpoint protégé. Modification de policy interdite. Désinscription via Options.",
          settings: current
        }
      }
      // Enrolled but not yet successful sync — still soft lock for most fields
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
        message: canUseVendorRecovery(current)
          ? "Identifiants incorrects (admin ou recovery vendor offline)."
          : "Identifiants incorrects. Recovery vendor : username « vendor » si offline > 2h."
      }
    }
    exit = matched
  }

  try {
    await revokeCurrentAgent(exit)
  } catch {
    /* ignore */
  }
  const settings = await clearCloudState()
  const who =
    exit.type === "admin"
      ? `admin « ${exit.adminLabel || exit.adminId} »`
      : exit.type === "vendor_recovery"
        ? "vendor recovery"
        : "sortie libre (policy non protégée)"
  return {
    ok: true,
    settings,
    exit_actor: exit,
    message: `Mode local_only. Désenrôlement enregistré (${who}).`
  }
}
