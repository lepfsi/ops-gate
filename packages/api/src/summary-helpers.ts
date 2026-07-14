import type { Agent } from "./types"
import type { SummaryAgentBrief } from "./store-types"

/** < 15 min = online (poll agent ~2 min) */
export const ONLINE_MS = 15 * 60 * 1000
/** > 2 h sans last_seen = hors ligne long (Kaspersky-style) */
export const OFFLINE_LONG_MS = 2 * 60 * 60 * 1000
export const LICENSE_GRACE_MS = 5 * 60 * 1000

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

export function connectivityBuckets(agents: Agent[]) {
  let online = 0
  let stale = 0
  let offline_long = 0
  const now = Date.now()
  for (const a of agents) {
    const age = now - new Date(a.lastSeenAt).getTime()
    if (age <= ONLINE_MS) online++
    else if (age <= OFFLINE_LONG_MS) stale++
    else offline_long++
  }
  return {
    online,
    stale,
    offline_long,
    offline_long_ms: OFFLINE_LONG_MS,
    online_ms: ONLINE_MS
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
