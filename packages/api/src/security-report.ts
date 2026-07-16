/**
 * Rapport sécurité OpsGate — agrégats pour une période.
 * Consommé par la console + générateur PDF Python.
 */
import type { Agent, StoredEvent } from "./types"
import {
  briefAgent,
  connectivityBuckets,
  eventsByDayFrom
} from "./summary-helpers"
import { mergeMonitoringSettings } from "./types"
import {
  filterEventsRange,
  previousIsoWeekRange,
  startOfIsoWeek
} from "./events-export"

export type SecurityReportPayload = {
  schema_version: 1
  generated_at: string
  org_id: string
  org_name?: string
  period: {
    kind: "week" | "custom" | "all"
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
    online_ms: number
    offline_long_ms: number
  }
  brand: {
    product: string
    vendor: string
    colors: { navy: string; teal: string }
  }
}

function pct(n: number, total: number): number {
  if (!total) return 0
  return Math.round((n / total) * 1000) / 10
}

function sortCount(
  map: Map<string, number>,
  limit = 8
): Array<{ key: string; count: number }> {
  return [...map.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
}

export function resolveReportPeriod(
  range: string,
  from?: string | null,
  to?: string | null
): {
  kind: "week" | "custom" | "all"
  fromMs: number
  toMs: number
  from_ts: string
  to_ts: string
  label: string
} {
  const now = Date.now()
  if (range === "week") {
    const { from: f, to: t, weekKey } = previousIsoWeekRange(new Date())
    // Si la semaine précédente est vide d'activité récente, fallback semaine en cours
    return {
      kind: "week",
      fromMs: f.getTime(),
      toMs: t.getTime(),
      from_ts: f.toISOString(),
      to_ts: t.toISOString(),
      label: `Semaine ISO ${weekKey}`
    }
  }
  if (range === "current_week") {
    const from = startOfIsoWeek(new Date())
    const to = new Date()
    const y = from.getUTCFullYear()
    const onejan = new Date(Date.UTC(y, 0, 1))
    const week = Math.ceil(
      ((from.getTime() - onejan.getTime()) / 86400000 + onejan.getUTCDay() + 1) /
        7
    )
    return {
      kind: "week",
      fromMs: from.getTime(),
      toMs: to.getTime(),
      from_ts: from.toISOString(),
      to_ts: to.toISOString(),
      label: `Semaine en cours ${y}-W${String(week).padStart(2, "0")}`
    }
  }
  if (range === "custom" && from && to) {
    const fromMs = Date.parse(from.includes("T") ? from : `${from}T00:00:00.000Z`)
    const toMs = Date.parse(to.includes("T") ? to : `${to}T23:59:59.999Z`)
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs > toMs) {
      throw new Error("invalid_date_range")
    }
    return {
      kind: "custom",
      fromMs,
      toMs,
      from_ts: new Date(fromMs).toISOString(),
      to_ts: new Date(toMs).toISOString(),
      label: `${from.slice(0, 10)} → ${to.slice(0, 10)}`
    }
  }
  // all = 90 derniers jours par défaut (rapport lisible)
  const toMs = now
  const fromMs = now - 90 * 86400000
  return {
    kind: "all",
    fromMs,
    toMs,
    from_ts: new Date(fromMs).toISOString(),
    to_ts: new Date(toMs).toISOString(),
    label: "90 derniers jours"
  }
}

export async function buildSecurityReport(input: {
  orgId: string
  orgName?: string
  events: StoredEvent[]
  agents: Agent[]
  monitoring?: unknown
  licenseOf: (a: Agent) => Promise<boolean> | boolean
  scheduleOf?: (
    a: Agent
  ) =>
    | import("./types").WorkSchedule
    | null
    | undefined
    | Promise<import("./types").WorkSchedule | null | undefined>
  period: ReturnType<typeof resolveReportPeriod>
  seats?: { seats: number; seats_used: number }
}): Promise<SecurityReportPayload> {
  const slice = filterEventsRange(
    input.events,
    input.period.fromMs,
    input.period.toMs
  )
  const total = slice.length
  const byDecision = new Map<string, number>()
  const bySev = new Map<string, number>()
  const bySource = new Map<string, number>()
  const byRule = new Map<string, number>()
  const byHost = new Map<string, number>()
  const byDevice = new Map<string, number>()

  for (const e of slice) {
    byDecision.set(e.decision, (byDecision.get(e.decision) || 0) + 1)
    bySev.set(
      e.highest_severity || "low",
      (bySev.get(e.highest_severity || "low") || 0) + 1
    )
    bySource.set(e.source || "unknown", (bySource.get(e.source || "unknown") || 0) + 1)
    for (const r of e.rule_ids || []) {
      if (r.startsWith("system.")) continue
      byRule.set(r, (byRule.get(r) || 0) + 1)
    }
    if (e.hostname && e.hostname !== "opsgate-agent") {
      byHost.set(e.hostname, (byHost.get(e.hostname) || 0) + 1)
    }
    const lab = (e.device_label || "").replace(/^OpsGate\s+Proxy\s*/i, "").trim()
    if (lab) byDevice.set(lab, (byDevice.get(lab) || 0) + 1)
  }

  const mon = mergeMonitoringSettings(
    input.monitoring as Parameters<typeof mergeMonitoringSettings>[0]
  )
  const licMap = new Map<string, boolean>()
  for (const a of input.agents) {
    licMap.set(a.id, !!(await input.licenseOf(a)))
  }
  const scheduleMap = new Map<
    string,
    import("./types").WorkSchedule | null | undefined
  >()
  if (input.scheduleOf) {
    for (const a of input.agents) {
      scheduleMap.set(a.id, await input.scheduleOf(a))
    }
  }
  const conn = connectivityBuckets(
    input.agents,
    mon,
    (a) => !!licMap.get(a.id),
    (a) => scheduleMap.get(a.id)
  )

  let licensed = 0
  let unlicensed = 0
  let grace = 0
  for (const a of input.agents) {
    const b = briefAgent(a, !!licMap.get(a.id))
    if (b.license_status === "licensed") licensed++
    else if (b.license_status === "grace") grace++
    else unlicensed++
  }

  // events_by_day for period (clip to max 31 days display)
  const daySpan = Math.min(
    31,
    Math.max(
      1,
      Math.ceil((input.period.toMs - input.period.fromMs) / 86400000) + 1
    )
  )
  const events_by_day = eventsByDayFrom(slice, daySpan)

  const toArr = (map: Map<string, number>, keyName: string) =>
    sortCount(map, 10).map((x) => ({
      [keyName]: x.key,
      count: x.count,
      pct: pct(x.count, total)
    }))

  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    org_id: input.orgId,
    org_name: input.orgName,
    period: {
      kind: input.period.kind,
      from_ts: input.period.from_ts,
      to_ts: input.period.to_ts,
      label: input.period.label
    },
    kpis: {
      events_total: total,
      agents_total: input.agents.length,
      agents_online: conn.online,
      agents_stale: conn.stale,
      agents_offline_long: conn.offline_long,
      agents_maintenance: conn.maintenance || 0,
      licensed,
      unlicensed,
      grace,
      seats: input.seats?.seats ?? 0,
      seats_used: input.seats?.seats_used ?? licensed,
      risky_sends: byDecision.get("send_anyway") || 0,
      blocks: byDecision.get("block") || 0,
      masks: byDecision.get("mask_send") || 0,
      observes: byDecision.get("observe") || 0,
      cancels: byDecision.get("cancel") || 0
    },
    by_decision: toArr(byDecision, "decision") as SecurityReportPayload["by_decision"],
    by_severity: toArr(bySev, "severity") as SecurityReportPayload["by_severity"],
    by_source: toArr(bySource, "source") as SecurityReportPayload["by_source"],
    events_by_day,
    top_rules: sortCount(byRule, 8).map((x) => ({
      rule_id: x.key,
      count: x.count
    })),
    top_hosts: sortCount(byHost, 6).map((x) => ({
      hostname: x.key,
      count: x.count
    })),
    top_devices: sortCount(byDevice, 6).map((x) => ({
      device_label: x.key,
      count: x.count
    })),
    connectivity: {
      online: conn.online,
      stale: conn.stale,
      offline_long: conn.offline_long,
      maintenance: conn.maintenance || 0,
      online_ms: conn.online_ms,
      offline_long_ms: conn.offline_long_ms
    },
    brand: {
      product: "OpsGate",
      vendor: "DailyOps.Tech",
      colors: { navy: "#0A1128", teal: "#2BD9C5" }
    }
  }
}
