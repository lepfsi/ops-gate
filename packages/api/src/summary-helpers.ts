import type {
  Agent,
  OrgMonitoringSettings,
  WorkSchedule
} from "./types"
import {
  DEFAULT_MONITORING_SETTINGS,
  mergeMonitoringSettings
} from "./types"
import type { SummaryAgentBrief } from "./store-types"

export const LICENSE_GRACE_MS = 5 * 60 * 1000

/** Parse "HH:MM" → minutes from midnight */
function hmToMin(hm: string): number {
  const [h, m] = (hm || "0:0").split(":").map((x) => parseInt(x, 10) || 0)
  return h * 60 + m
}

/**
 * True si l’instant est dans les heures de travail (jours + plage − pauses).
 * Si schedule désactivé → toujours true (alertes 24/7).
 */
export function isWithinWorkSchedule(
  now: Date,
  schedule?: WorkSchedule | null
): boolean {
  if (!schedule?.enabled) return true
  const tz = schedule.timezone || "Europe/Paris"
  let weekday: number
  let minutes: number
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).formatToParts(now)
    const wd = parts.find((p) => p.type === "weekday")?.value || "Mon"
    const hour = parseInt(
      parts.find((p) => p.type === "hour")?.value || "0",
      10
    )
    const minute = parseInt(
      parts.find((p) => p.type === "minute")?.value || "0",
      10
    )
    const map: Record<string, number> = {
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
      Sun: 7
    }
    weekday = map[wd] || 1
    minutes = hour * 60 + minute
  } catch {
    return true
  }
  const days = schedule.workDays?.length
    ? schedule.workDays
    : DEFAULT_MONITORING_SETTINGS.schedule.workDays
  if (!days.includes(weekday)) return false
  const start = hmToMin(schedule.workStart || "08:00")
  const end = hmToMin(schedule.workEnd || "17:00")
  if (minutes < start || minutes >= end) return false
  for (const b of schedule.breaks || []) {
    const bs = hmToMin(b.start)
    const be = hmToMin(b.end)
    if (minutes >= bs && minutes < be) return false
  }
  return true
}

export function licenseStatusOf(
  licensed: boolean,
  unlicensedSince?: string
): "licensed" | "grace" | "unlicensed" {
  if (licensed) return "licensed"
  const since = unlicensedSince
    ? new Date(unlicensedSince).getTime()
    : Date.now()
  return Date.now() - since < LICENSE_GRACE_MS ? "grace" : "unlicensed"
}

export function briefAgent(
  a: Agent,
  licensed: boolean
): SummaryAgentBrief {
  const last = new Date(a.lastSeenAt).getTime()
  const offline = Math.max(0, Date.now() - last)
  return {
    id: a.id,
    device_label: a.deviceLabel,
    host_name: a.hostName || null,
    last_seen_at: a.lastSeenAt,
    license_status: licenseStatusOf(licensed, a.unlicensedSince),
    offline_for_ms: offline,
    group_id: a.groupId || null,
    device_fingerprint: a.deviceFingerprint || null
  }
}

export function connectivityBuckets(
  agents: Agent[],
  monitoring?: Partial<OrgMonitoringSettings> | null,
  licenseOf?: (a: Agent) => boolean,
  /** Schedule effectif par agent (profil/policy) ; sinon monitoring org */
  scheduleOf?: (a: Agent) => WorkSchedule | null | undefined
) {
  const mon = mergeMonitoringSettings(monitoring)
  const onlineMs = mon.onlineMs
  const offlineLongMs = mon.offlineLongMs
  const now = new Date()
  const orgInSchedule = isWithinWorkSchedule(now, mon.schedule)
  let online = 0
  let stale = 0
  let offline_long = 0
  let offline_long_alertable = 0
  const agents_stale: SummaryAgentBrief[] = []
  const agents_online: SummaryAgentBrief[] = []
  for (const a of agents) {
    const age = Date.now() - new Date(a.lastSeenAt).getTime()
    const lic = licenseOf ? licenseOf(a) : a.licenseAssigned === true
    const b = briefAgent(a, lic)
    const sch = scheduleOf?.(a)
    const inSchedule = isWithinWorkSchedule(
      now,
      sch && sch.enabled ? sch : mon.schedule
    )
    if (age <= onlineMs) {
      online++
      agents_online.push(b)
    } else if (age <= offlineLongMs) {
      stale++
      agents_stale.push(b)
    } else {
      offline_long++
      if (inSchedule) offline_long_alertable++
    }
  }
  agents_stale.sort((a, b) => b.offline_for_ms - a.offline_for_ms)
  return {
    online,
    stale,
    offline_long,
    offline_long_alertable,
    offline_long_ms: offlineLongMs,
    online_ms: onlineMs,
    schedule_active: !!mon.schedule.enabled,
    within_work_hours: orgInSchedule,
    monitoring: mon,
    agents_stale,
    agents_online
  }
}

export function eventsByDayFrom(
  events: Array<{ ts: string }>,
  days = 14
): { day: string; count: number }[] {
  const map = new Map<string, number>()
  const today = new Date()
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const key = d.toISOString().slice(0, 10)
    map.set(key, 0)
  }
  for (const e of events) {
    const key = (e.ts || "").slice(0, 10)
    if (map.has(key)) map.set(key, (map.get(key) || 0) + 1)
  }
  return [...map.entries()].map(([day, count]) => ({ day, count }))
}

export function findDuplicateFingerprints(
  briefs: SummaryAgentBrief[]
): Array<{ fingerprint: string; agents: SummaryAgentBrief[] }> {
  const byFp = new Map<string, SummaryAgentBrief[]>()
  for (const b of briefs) {
    const fp = (b.device_fingerprint || "").trim()
    if (!fp) continue
    const list = byFp.get(fp) || []
    list.push(b)
    byFp.set(fp, list)
  }
  return [...byFp.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([fingerprint, agents]) => ({ fingerprint, agents }))
}
