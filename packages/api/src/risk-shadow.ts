/**
 * Shadow AI Discovery + Risk Score utilisateur (V3-C).
 * Calcul à la volée depuis detection_events + statut org_ai_tools.
 */
import type { OpsGateStore } from "./store-types"
import type { Agent, StoredEvent } from "./types"

export type RiskPeriod = "7d" | "30d" | "90d"
export type AiToolStatus = "authorized" | "unauthorized" | "unknown"

export type AgentRiskRow = {
  agent_id: string
  label: string
  score: number
  score_previous: number | null
  trend: "up" | "down" | "flat"
  factors: Record<string, number>
  tools: string[]
  events_count: number
  last_event_at: string | null
}

export type RiskSummary = {
  period: RiskPeriod
  average_score: number
  previous_average_score: number | null
  trend: "up" | "down" | "flat"
  users_count: number
  high_risk_users: number
  medium_risk_users: number
  low_risk_users: number
  top_risk_users: Array<{
    agent_id: string
    label: string
    score: number
    trend: "up" | "down" | "flat"
  }>
  calculated_at: string
}

export type ShadowAiToolRow = {
  tool: string
  display_name: string
  status: AiToolStatus
  events_count: number
  agents_count: number
  first_seen_at: string | null
  last_seen_at: string | null
  updated_at?: string | null
  updated_by?: string | null
}

export function parsePeriod(raw?: string | null): RiskPeriod {
  if (raw === "7d" || raw === "90d") return raw
  return "30d"
}

export function periodDays(p: RiskPeriod): number {
  if (p === "7d") return 7
  if (p === "90d") return 90
  return 30
}

export function periodStartIso(p: RiskPeriod, now = Date.now()): string {
  return new Date(now - periodDays(p) * 86400000).toISOString()
}

/** Hostname IA normalisé (tool key) */
export function normalizeAiTool(hostname: string | undefined | null): string {
  let h = (hostname || "").trim().toLowerCase()
  if (!h || h === "unknown" || h === "opsgate-agent") return ""
  h = h.replace(/^www\./, "")
  return h
}

function agentLabel(a: Agent | undefined, agentId: string): string {
  if (!a) return agentId
  return (
    a.deviceLabel ||
    a.hostName ||
    a.deviceFingerprint?.slice(0, 12) ||
    agentId
  )
}

function eventTime(e: StoredEvent): number {
  return Date.parse(e.ts || e.receivedAt || "") || 0
}

function severityOf(e: StoredEvent): "high" | "medium" | "low" {
  const s = (e.highest_severity || "").toLowerCase()
  if (s === "high") return "high"
  if (s === "medium") return "medium"
  return "low"
}

/**
 * Formule V1 — explicable (spec SHADOW-AI-RISK-SCORE).
 */
export function computeScoreFromEvents(
  events: StoredEvent[],
  unauthorizedTools: Set<string>
): { score: number; factors: Record<string, number>; tools: string[] } {
  const factors: Record<string, number> = {
    high_detections: 0,
    medium_detections: 0,
    low_detections: 0,
    send_anyway_high: 0,
    send_anyway_medium: 0,
    send_anyway_low: 0,
    mask_send: 0,
    cancel_bonus: 0,
    shadow_unauthorized: 0,
    high_recurrence: 0
  }

  let score = 0
  const tools = new Set<string>()
  const highDays = new Set<string>()

  for (const e of events) {
    const tool = normalizeAiTool(e.hostname)
    if (tool) tools.add(tool)

    const sev = severityOf(e)
    const count = Math.max(1, e.detection_count || 1)

    if (sev === "high") {
      factors.high_detections += count
      score += 8 * count
      const day = (e.ts || e.receivedAt || "").slice(0, 10)
      if (day) highDays.add(day)
    } else if (sev === "medium") {
      factors.medium_detections += count
      score += 4 * count
    } else {
      factors.low_detections += count
      score += 1 * count
    }

    const dec = (e.decision || "").toLowerCase()
    if (dec === "send_anyway") {
      if (sev === "high") {
        factors.send_anyway_high += 1
        score += 12
      } else if (sev === "medium") {
        factors.send_anyway_medium += 1
        score += 6
      } else {
        factors.send_anyway_low += 1
        score += 2
      }
    } else if (dec === "mask_send" || dec === "secure_rewrite") {
      factors.mask_send += 1
      // +0
    } else if (dec === "cancel") {
      factors.cancel_bonus += 1
      score -= 1
    }
  }

  // Shadow AI non autorisé (une fois par outil distinct)
  for (const t of tools) {
    if (unauthorizedTools.has(t)) {
      factors.shadow_unauthorized += 1
      score += 15
    }
  }

  if (highDays.size >= 3) {
    factors.high_recurrence = 1
    score += 10
  }

  score = Math.max(0, Math.min(100, Math.round(score)))
  return { score, factors, tools: [...tools].sort() }
}

function trendOf(cur: number, prev: number | null): "up" | "down" | "flat" {
  if (prev == null) return "flat"
  const d = cur - prev
  if (d >= 5) return "up"
  if (d <= -5) return "down"
  return "flat"
}

export async function buildOrgRisk(
  store: OpsGateStore,
  orgId: string,
  period: RiskPeriod
): Promise<{
  summary: RiskSummary
  users: AgentRiskRow[]
}> {
  const now = Date.now()
  const start = periodStartIso(period, now)
  const prevStart = periodStartIso(period, now - periodDays(period) * 86400000)
  const startMs = Date.parse(start)
  const prevStartMs = Date.parse(prevStart)

  const agents = await store.listAgents(orgId)
  const events = await store.listEvents(orgId, 8000)
  const toolStatuses = await store.listOrgAiTools(orgId)
  const unauthorized = new Set(
    toolStatuses.filter((t) => t.status === "unauthorized").map((t) => t.tool)
  )

  const byAgentCurrent = new Map<string, StoredEvent[]>()
  const byAgentPrev = new Map<string, StoredEvent[]>()

  for (const e of events) {
    const aid = e.agentId
    if (!aid) continue
    const t = eventTime(e)
    if (!t) continue
    if (t >= startMs) {
      const list = byAgentCurrent.get(aid) || []
      list.push(e)
      byAgentCurrent.set(aid, list)
    } else if (t >= prevStartMs && t < startMs) {
      const list = byAgentPrev.get(aid) || []
      list.push(e)
      byAgentPrev.set(aid, list)
    }
  }

  // Inclure tous les agents ayant des events sur la période (+ agents actifs)
  const agentIds = new Set<string>([
    ...agents.map((a) => a.id),
    ...byAgentCurrent.keys()
  ])

  const agentMap = new Map(agents.map((a) => [a.id, a]))
  const users: AgentRiskRow[] = []

  for (const aid of agentIds) {
    const curEv = byAgentCurrent.get(aid) || []
    if (curEv.length === 0 && !agentMap.has(aid)) continue
    // Agents sans event sur la période : score 0
    const cur = computeScoreFromEvents(curEv, unauthorized)
    const prevEv = byAgentPrev.get(aid) || []
    const prev =
      prevEv.length > 0
        ? computeScoreFromEvents(prevEv, unauthorized).score
        : null
    const last = curEv
      .map((e) => e.ts || e.receivedAt)
      .filter(Boolean)
      .sort()
      .reverse()[0]

    users.push({
      agent_id: aid,
      label: agentLabel(agentMap.get(aid), aid),
      score: curEv.length ? cur.score : 0,
      score_previous: prev,
      trend: trendOf(curEv.length ? cur.score : 0, prev),
      factors: cur.factors,
      tools: cur.tools,
      events_count: curEv.length,
      last_event_at: last || null
    })
  }

  users.sort((a, b) => b.score - a.score)

  const withEvents = users.filter((u) => u.events_count > 0)
  const scores = withEvents.map((u) => u.score)
  const avg =
    scores.length > 0
      ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
      : 0
  const prevScores = withEvents
    .map((u) => u.score_previous)
    .filter((x): x is number => typeof x === "number")
  const prevAvg =
    prevScores.length > 0
      ? Math.round(prevScores.reduce((a, b) => a + b, 0) / prevScores.length)
      : null

  const high = withEvents.filter((u) => u.score >= 70).length
  const medium = withEvents.filter((u) => u.score >= 40 && u.score < 70).length
  const low = withEvents.filter((u) => u.score < 40).length

  const summary: RiskSummary = {
    period,
    average_score: avg,
    previous_average_score: prevAvg,
    trend: trendOf(avg, prevAvg),
    users_count: withEvents.length || users.length,
    high_risk_users: high,
    medium_risk_users: medium,
    low_risk_users: low,
    top_risk_users: withEvents.slice(0, 5).map((u) => ({
      agent_id: u.agent_id,
      label: u.label,
      score: u.score,
      trend: u.trend
    })),
    calculated_at: new Date().toISOString()
  }

  return { summary, users }
}

export async function buildShadowAiInventory(
  store: OpsGateStore,
  orgId: string,
  period: RiskPeriod,
  statusFilter: "all" | AiToolStatus = "all"
): Promise<ShadowAiToolRow[]> {
  const startMs = Date.parse(periodStartIso(period))
  const events = await store.listEvents(orgId, 8000)
  const statuses = await store.listOrgAiTools(orgId)
  const statusMap = new Map(statuses.map((s) => [s.tool, s]))

  type Agg = {
    tool: string
    events: number
    agents: Set<string>
    first: string | null
    last: string | null
  }
  const agg = new Map<string, Agg>()

  for (const e of events) {
    const t = eventTime(e)
    if (!t || t < startMs) continue
    const tool = normalizeAiTool(e.hostname)
    if (!tool) continue
    let a = agg.get(tool)
    if (!a) {
      a = { tool, events: 0, agents: new Set(), first: null, last: null }
      agg.set(tool, a)
    }
    a.events += 1
    if (e.agentId) a.agents.add(e.agentId)
    const iso = e.ts || e.receivedAt
    if (iso) {
      if (!a.first || iso < a.first) a.first = iso
      if (!a.last || iso > a.last) a.last = iso
    }
  }

  // Inclure tools connus en base même sans event sur la période
  for (const s of statuses) {
    if (!agg.has(s.tool)) {
      agg.set(s.tool, {
        tool: s.tool,
        events: 0,
        agents: new Set(),
        first: s.firstSeenAt || null,
        last: s.lastSeenAt || null
      })
    }
  }

  const rows: ShadowAiToolRow[] = []
  for (const a of agg.values()) {
    const st = statusMap.get(a.tool)
    const status: AiToolStatus = st?.status || "unknown"
    if (statusFilter !== "all" && status !== statusFilter) continue
    rows.push({
      tool: a.tool,
      display_name: st?.displayName || a.tool,
      status,
      events_count: a.events,
      agents_count: a.agents.size,
      first_seen_at: a.first || st?.firstSeenAt || null,
      last_seen_at: a.last || st?.lastSeenAt || null,
      updated_at: st?.updatedAt || null,
      updated_by: st?.updatedBy || null
    })
  }

  rows.sort((a, b) => b.events_count - a.events_count || a.tool.localeCompare(b.tool))
  return rows
}
