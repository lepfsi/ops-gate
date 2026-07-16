/**
 * Exposition Prometheus text format 0.0.4
 * GET /metrics — scrapable par Grafana/Prometheus.
 */
import type { OpsGateStore } from "./store-types"
import { mergeMonitoringSettings } from "./types"
import { connectivityBuckets } from "./summary-helpers"
import { getProcessCounters } from "./siem"

function escLabel(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "")
}

function line(
  name: string,
  labels: Record<string, string>,
  value: number
): string {
  const parts = Object.entries(labels)
    .map(([k, v]) => `${k}="${escLabel(v)}"`)
    .join(",")
  return parts
    ? `${name}{${parts}} ${Number.isFinite(value) ? value : 0}`
    : `${name} ${Number.isFinite(value) ? value : 0}`
}

export async function renderPrometheusMetrics(
  store: OpsGateStore
): Promise<string> {
  const out: string[] = []
  const help = (name: string, h: string, type: string) => {
    out.push(`# HELP ${name} ${h}`)
    out.push(`# TYPE ${name} ${type}`)
  }

  help(
    "opsgate_up",
    "OpsGate API is up",
    "gauge"
  )
  out.push(line("opsgate_up", {}, 1))

  help(
    "opsgate_store_kind_info",
    "Store backend (1=active)",
    "gauge"
  )
  out.push(
    line("opsgate_store_kind_info", { kind: store.kind || "unknown" }, 1)
  )

  const ctr = getProcessCounters()
  help(
    "opsgate_events_accepted_total",
    "Detection events accepted by API (process lifetime)",
    "counter"
  )
  out.push(line("opsgate_events_accepted_total", {}, ctr.events_accepted))

  help(
    "opsgate_events_forwarded_siem_total",
    "Events forwarded to SIEM/syslog (process lifetime)",
    "counter"
  )
  out.push(
    line("opsgate_events_forwarded_siem_total", {}, ctr.events_forwarded_siem)
  )

  help(
    "opsgate_events_accepted_by_decision_total",
    "Accepted events by decision (process lifetime)",
    "counter"
  )
  for (const [decision, n] of Object.entries(ctr.events_by_decision)) {
    out.push(
      line("opsgate_events_accepted_by_decision_total", { decision }, n)
    )
  }

  // Per-org gauges from live store
  let orgs: Awaited<ReturnType<OpsGateStore["listOrgs"]>> = []
  if (typeof store.listOrgs === "function") {
    orgs = await store.listOrgs()
  }

  help("opsgate_orgs", "Number of organizations", "gauge")
  out.push(line("opsgate_orgs", {}, orgs.length))

  help("opsgate_agents", "Enrolled agents by org and status", "gauge")
  help("opsgate_agents_licensed", "Licensed agents by org", "gauge")
  help("opsgate_agents_unlicensed", "Unlicensed agents by org", "gauge")
  help("opsgate_seats", "License seats by org (0=unlimited)", "gauge")
  help("opsgate_seats_used", "Seats used by org", "gauge")
  help(
    "opsgate_events_stored",
    "Stored detection events count (recent list cap)",
    "gauge"
  )
  help(
    "opsgate_events_by_decision",
    "Stored events by decision (sample window)",
    "gauge"
  )
  help("opsgate_siem_enabled", "SIEM forward enabled for org", "gauge")

  for (const org of orgs) {
    const orgLabel = { org_id: org.id, org_code: org.orgCode || org.slug || "" }
    const mon = mergeMonitoringSettings(org.monitoring)
    const agents = await store.listAgents(org.id)
    const licMap = new Map<string, boolean>()
    for (const a of agents) {
      licMap.set(a.id, await store.isAgentLicensed(org.id, a.id))
    }
    const conn = connectivityBuckets(agents, mon, (a) => !!licMap.get(a.id))
    out.push(
      line("opsgate_agents", { ...orgLabel, status: "online" }, conn.online)
    )
    out.push(
      line("opsgate_agents", { ...orgLabel, status: "stale" }, conn.stale)
    )
    out.push(
      line(
        "opsgate_agents",
        { ...orgLabel, status: "offline_long" },
        conn.offline_long
      )
    )
    out.push(
      line(
        "opsgate_agents",
        { ...orgLabel, status: "maintenance" },
        conn.maintenance || 0
      )
    )
    out.push(line("opsgate_agents", { ...orgLabel, status: "total" }, agents.length))

    let licensed = 0
    let unlicensed = 0
    for (const a of agents) {
      if (licMap.get(a.id)) licensed++
      else unlicensed++
    }
    out.push(line("opsgate_agents_licensed", orgLabel, licensed))
    out.push(line("opsgate_agents_unlicensed", orgLabel, unlicensed))

    const stats = await store.getLicenseStats(org.id)
    out.push(line("opsgate_seats", orgLabel, stats.seats))
    out.push(line("opsgate_seats_used", orgLabel, stats.seats_used))

    const events = await store.listEvents(org.id, 2000)
    out.push(line("opsgate_events_stored", orgLabel, events.length))
    const byDec = new Map<string, number>()
    for (const e of events) {
      byDec.set(e.decision, (byDec.get(e.decision) || 0) + 1)
    }
    for (const [decision, n] of byDec) {
      out.push(
        line("opsgate_events_by_decision", { ...orgLabel, decision }, n)
      )
    }

    const siemOn = mon.siem?.enabled === true ? 1 : 0
    out.push(line("opsgate_siem_enabled", orgLabel, siemOn))
  }

  out.push("")
  return out.join("\n")
}
