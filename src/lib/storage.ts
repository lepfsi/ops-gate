import { highestSeverity, type Detection, type Severity } from "@opsgate/engine"

import type {
  DetectionSource,
  JournalEntry,
  UserDecision
} from "~types"
import { reportEvents, flushEventQueue } from "~lib/cloud"
import { getSettings } from "~lib/agent-store"

// Re-export settings API from agent-store for backward compatibility
export {
  getSettings,
  setSettings,
  getCachedRulesPack,
  clearCloudState
} from "~lib/agent-store"

const JOURNAL_KEY = "opsGateJournal"
const MAX_JOURNAL = 100

export async function getJournal(): Promise<JournalEntry[]> {
  const data = await chrome.storage.local.get(JOURNAL_KEY)
  return (data[JOURNAL_KEY] as JournalEntry[]) ?? []
}

export async function clearJournal(): Promise<void> {
  await chrome.storage.local.set({ [JOURNAL_KEY]: [] })
}

export async function appendJournal(
  entry: Omit<JournalEntry, "id" | "timestamp">
): Promise<JournalEntry> {
  const journal = await getJournal()
  const full: JournalEntry = {
    ...entry,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now()
  }
  const next = [full, ...journal].slice(0, MAX_JOURNAL)
  await chrome.storage.local.set({ [JOURNAL_KEY]: next })

  // Fire-and-forget cloud event (metadata only) + file d'attente si échec
  void maybeReport(full)

  return full
}

async function maybeReport(entry: JournalEntry) {
  try {
    const settings = await getSettings()
    if (settings.mode === "local_only" || !settings.agentToken) return
    // Mode personnel : pas d’events cloud (privacy)
    if (settings.personalAccount === true) return
    // Org enrollée : envoyer sauf si policy a coupé explicitement le reporting.
    // Ne pas bloquer sur licence/security — une décision utilisateur doit remonter.
    if (settings.eventReporting === false) return

    // cancel → severity low (spec console)
    const severity =
      entry.decision === "cancel"
        ? "low"
        : entry.highestSeverity || "medium"
    // source API : prompt | file (legacy "text" accepté côté store)
    const source = entry.source === "file" ? "file" : "prompt"
    const payload = {
      schema_version: 1,
      client_event_id: entry.id,
      ts: new Date(entry.timestamp).toISOString(),
      source,
      hostname: entry.hostname || "unknown",
      decision: entry.decision, // mask_send | send_anyway | cancel
      detection_count: entry.detectionCount ?? 0,
      highest_severity: severity,
      rule_ids: entry.ruleIds?.length
        ? entry.ruleIds
        : entry.types?.length
          ? entry.types
          : [`decision.${entry.decision}`],
      types: entry.types?.length
        ? entry.types
        : [entry.decision],
      masked: !!entry.masked,
      file_names: entry.fileNames ?? null,
      // Identifiant appareil (label enroll) — pas le hostname du site IA
      device_label: settings.deviceLabel || undefined
    }

    const ok = await reportEvents([payload])
    if (!ok) {
      console.warn("[OpsGate] event report failed (queued)", entry.decision)
    }
  } catch (e) {
    console.warn("[OpsGate] event report error", e)
  }
}

/** Relance la file d'events en attente (sync / alarm) */
export async function flushPendingEvents(): Promise<void> {
  try {
    await flushEventQueue()
  } catch {
    // ignore
  }
}

export function buildJournalPayload(
  url: string,
  decision: UserDecision,
  detections: Detection[],
  masked: boolean,
  source: DetectionSource = "prompt",
  fileNames?: string[]
): Omit<JournalEntry, "id" | "timestamp"> {
  let hostname = ""
  try {
    hostname = new URL(url).hostname
  } catch {
    hostname = url
  }

  const types = [...new Set(detections.map((d) => d.type))]
  const ruleIds = [
    ...new Set(detections.map((d) => d.ruleId).filter(Boolean))
  ]
  const severity: Severity = highestSeverity(detections)

  return {
    url,
    hostname,
    decision,
    detectionCount: detections.length,
    highestSeverity: severity,
    types,
    ruleIds,
    masked,
    source,
    fileNames: fileNames?.length ? fileNames : undefined
  }
}
