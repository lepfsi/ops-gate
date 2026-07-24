/**
 * AI Security Gateway — grand onglet console
 * 5 sous-onglets (roadmap) : gouvernance, usage, data, compliance, intelligence.
 * Réassemble l’existant (summary, shadow, risk, events) sans casser les onglets legacy.
 */
import { useCallback, useEffect, useMemo, useState } from "react"
import { api, type EventRow, type Summary } from "./api"

export type GatewaySection =
  | "governance"
  | "usage"
  | "data"
  | "compliance"
  | "intelligence"

type Period = "7d" | "30d" | "90d"

type RiskSummary = {
  period: Period
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

type ShadowTool = {
  tool: string
  display_name: string
  status: "authorized" | "unauthorized" | "unknown"
  events_count: number
  agents_count: number
  first_seen_at: string | null
  last_seen_at: string | null
}

type ShadowCounts = {
  total: number
  authorized: number
  unauthorized: number
  unknown: number
}

const SECTIONS: GatewaySection[] = [
  "governance",
  "usage",
  "data",
  "compliance",
  "intelligence"
]

function scoreClass(score: number): string {
  if (score >= 70) return "gw-risk-high"
  if (score >= 40) return "gw-risk-med"
  return "gw-risk-low"
}

function trendGlyph(t: string): string {
  if (t === "up") return "↑"
  if (t === "down") return "↓"
  return "→"
}

function riskLabel(
  t: (k: string, v?: Record<string, string | number>) => string,
  score: number
): string {
  if (score >= 70) return t("gw.risk.high")
  if (score >= 40) return t("gw.risk.medium")
  return t("gw.risk.low")
}

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "—"
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return "—"
  const diff = Date.now() - ms
  if (diff < 60_000) return "< 1 min"
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} min`
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} h`
  if (diff < 7 * 86400_000) return `${Math.floor(diff / 86400_000)} j`
  return new Date(ms).toLocaleDateString()
}

function appInitials(name: string): string {
  const clean = (name || "?").replace(/[^a-zA-Z0-9\s]/g, " ").trim()
  const parts = clean.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase()
  }
  return clean.slice(0, 2).toUpperCase() || "?"
}

function statusPriority(s: ShadowTool["status"]): number {
  if (s === "unauthorized") return 0
  if (s === "unknown") return 1
  return 2
}

type UsageStatusFilter = "all" | "review" | "unauthorized" | "unknown" | "authorized"

/** Forage gouvernance — données live pour le RSSI */
type GovDrillKind =
  | "who"
  | "what"
  | "risks"
  | "data"
  | "policy"
  | "bypass"
  | "protected"
  | "high"
  | "unauth"
  | "events"
  | "app"

type GovDrill = { kind: GovDrillKind; tool?: string }

type RiskUserRow = {
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

type Props = {
  t: (k: string, vars?: Record<string, string | number>) => string
  setError: (e: string | null) => void
  setInfo: (i: string | null) => void
  section: GatewaySection
  setSection: (s: GatewaySection) => void
  onOpenShadow?: () => void
  onOpenRisk?: () => void
  onOpenEvents?: () => void
  onOpenAudit?: () => void
  onOpenReports?: () => void
}

export function GatewayView({
  t,
  setError,
  setInfo,
  section,
  setSection,
  onOpenShadow,
  onOpenRisk,
  onOpenEvents,
  onOpenAudit,
  onOpenReports
}: Props) {
  const [period, setPeriod] = useState<Period>("30d")
  const [busy, setBusy] = useState(false)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [risk, setRisk] = useState<RiskSummary | null>(null)
  const [tools, setTools] = useState<ShadowTool[]>([])
  const [shadowCounts, setShadowCounts] = useState<ShadowCounts | null>(null)
  const [eventStats, setEventStats] = useState({
    total: 0,
    blocked: 0,
    rewrite: 0,
    mask: 0,
    sendAnyway: 0,
    cancel: 0,
    high: 0,
    medium: 0,
    low: 0
  })
  const [events, setEvents] = useState<EventRow[]>([])
  /** Cache risk users pour éviter rechargements Usage/Intel/Compliance */
  const [riskUsersCache, setRiskUsersCache] = useState<RiskUserRow[]>([])
  const [riskUsersPeriod, setRiskUsersPeriod] = useState<Period | null>(null)

  const load = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const [sum, riskSum, shadowRaw, evRaw, riskUsersRaw] = await Promise.all([
        api.summary().catch(() => null),
        fetchRiskSummary(period),
        api.shadowAi({ period, status: "all" }).catch(() => null),
        api.events().catch(() => null),
        api
          .riskUsers({ period, min_score: 0, limit: 200 })
          .catch(() => null)
      ])

      setSummary(sum)
      setRisk(riskSum)
      if (shadowRaw) {
        setTools((shadowRaw.tools || []) as ShadowTool[])
        setShadowCounts(shadowRaw.counts || null)
      } else {
        setTools([])
        setShadowCounts(null)
      }

      const list = (evRaw?.events || []) as EventRow[]
      setEvents(list)
      if (riskUsersRaw?.users) {
        setRiskUsersCache((riskUsersRaw.users || []) as RiskUserRow[])
        setRiskUsersPeriod(period)
      }
      const stats = {
        total: list.length,
        blocked: 0,
        rewrite: 0,
        mask: 0,
        sendAnyway: 0,
        cancel: 0,
        high: 0,
        medium: 0,
        low: 0
      }
      for (const e of list) {
        const d = String(e.decision || "").toLowerCase()
        const sev = String(e.highest_severity || "").toLowerCase()
        if (d.includes("block") || d === "blocked") stats.blocked++
        else if (d.includes("rewrite") || d === "secure_rewrite")
          stats.rewrite++
        else if (d.includes("mask")) stats.mask++
        else if (d.includes("send_anyway") || d === "allow") stats.sendAnyway++
        else if (d.includes("cancel")) stats.cancel++
        if (sev === "high") stats.high++
        else if (sev === "medium") stats.medium++
        else if (sev === "low") stats.low++
      }
      setEventStats(stats)
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }, [period, setError])

  useEffect(() => {
    void load()
  }, [load])

  const avgRisk = risk?.average_score ?? 0
  const prevRisk = risk?.previous_average_score
  const riskDelta =
    prevRisk != null && Number.isFinite(prevRisk)
      ? Math.round(((avgRisk - prevRisk) / Math.max(prevRisk, 1)) * 100)
      : null

  const unauthorizedTools = useMemo(
    () => tools.filter((x) => x.status === "unauthorized"),
    [tools]
  )
  const unknownTools = useMemo(
    () => tools.filter((x) => x.status === "unknown"),
    [tools]
  )

  const topRisks = useMemo(() => {
    type RiskItem = {
      title: string
      detail: string
      score: number
      drill: GovDrill
      cta: string
    }
    const items: RiskItem[] = []
    if (unauthorizedTools.length > 0) {
      items.push({
        title: t("gw.risk.unauthApps"),
        detail: t("gw.risk.unauthAppsDetail", {
          n: unauthorizedTools.length
        }),
        score: 90,
        drill: { kind: "unauth" },
        cta: t("gw.gov.drill.open")
      })
    }
    if (eventStats.high > 0) {
      items.push({
        title: t("gw.risk.highDetections"),
        detail: t("gw.risk.highDetectionsDetail", { n: eventStats.high }),
        score: 80,
        drill: { kind: "high" },
        cta: t("gw.gov.drill.open")
      })
    }
    if (eventStats.sendAnyway > 0) {
      items.push({
        title: t("gw.risk.sendAnyway"),
        detail: t("gw.risk.sendAnywayDetail", { n: eventStats.sendAnyway }),
        score: 70,
        drill: { kind: "bypass" },
        cta: t("gw.gov.drill.open")
      })
    }
    if ((risk?.high_risk_users || 0) > 0) {
      items.push({
        title: t("gw.risk.highUsers"),
        detail: t("gw.risk.highUsersDetail", {
          n: risk?.high_risk_users || 0
        }),
        score: 75,
        drill: { kind: "who" },
        cta: t("gw.gov.drill.open")
      })
    }
    if (items.length === 0) {
      items.push({
        title: t("gw.risk.none"),
        detail: t("gw.risk.noneDetail"),
        score: 10,
        drill: { kind: "risks" },
        cta: t("gw.gov.drill.open")
      })
    }
    return items.sort((a, b) => b.score - a.score).slice(0, 5)
  }, [unauthorizedTools, eventStats, risk, t])

  const sensitiveAttempts =
    eventStats.high + eventStats.medium + eventStats.low
  const protectedActions =
    eventStats.blocked + eventStats.rewrite + eventStats.mask + eventStats.cancel

  return (
    <div className="gw-page">
      <header className="gw-topbar" title={t("gw.lead")}>
        <div className="gw-topbar-brand">
          <span className="gw-topbar-kicker">{t("gw.kicker")}</span>
          <h1 className="gw-topbar-title">{t("gw.title")}</h1>
        </div>
        <div className="gw-topbar-actions">
          <select
            className="input gw-topbar-period"
            value={period}
            onChange={(e) =>
              setPeriod(
                e.target.value === "7d" || e.target.value === "90d"
                  ? e.target.value
                  : "30d"
              )
            }
            aria-label={t("gw.period.30d")}>
            <option value="7d">{t("gw.period.7d")}</option>
            <option value="30d">{t("gw.period.30d")}</option>
            <option value="90d">{t("gw.period.90d")}</option>
          </select>
          <button
            type="button"
            className="btn secondary btn-sm"
            disabled={busy}
            onClick={() => void load()}>
            {busy ? t("common.loading") : t("gw.refresh")}
          </button>
        </div>
      </header>

      <nav className="gw-subnav" aria-label={t("gw.title")}>
        {SECTIONS.map((id) => (
          <button
            key={id}
            type="button"
            className={`gw-subnav-item ${section === id ? "active" : ""}`}
            onClick={() => setSection(id)}>
            <span className="gw-subnav-num">
              {SECTIONS.indexOf(id) + 1}
            </span>
            {t(`gw.section.${id}`)}
          </button>
        ))}
      </nav>

      {section === "governance" && (
        <GovernancePanel
          t={t}
          period={period}
          summary={summary}
          risk={risk}
          avgRisk={avgRisk}
          riskDelta={riskDelta}
          shadowCounts={shadowCounts}
          eventStats={eventStats}
          events={events}
          sensitiveAttempts={sensitiveAttempts}
          protectedActions={protectedActions}
          topRisks={topRisks}
          tools={tools}
          setError={setError}
          onOpenUsage={() => setSection("usage")}
          onOpenData={() => setSection("data")}
          onOpenCompliance={() => setSection("compliance")}
          onOpenIntel={() => setSection("intelligence")}
          onOpenRisk={onOpenRisk}
          onOpenEvents={onOpenEvents}
          onOpenShadow={onOpenShadow}
        />
      )}

      {section === "usage" && (
        <UsagePanel
          t={t}
          period={period}
          tools={tools}
          counts={shadowCounts}
          summary={summary}
          events={events}
          riskUsersSeed={
            riskUsersPeriod === period ? riskUsersCache : undefined
          }
          busy={busy}
          setError={setError}
          setInfo={setInfo}
          onOpenShadow={onOpenShadow}
          onOpenRisk={onOpenRisk}
          onOpenEvents={onOpenEvents}
          onOpenIntel={() => setSection("intelligence")}
          onPatch={async (tool, status) => {
            try {
              await api.patchShadowAi(tool, status)
              setInfo(t("gw.usage.patched", { tool, status }))
              await load()
            } catch (e) {
              setError(String(e))
            }
          }}
          onBulkPatch={async (toolIds, status) => {
            try {
              for (const tool of toolIds) {
                await api.patchShadowAi(tool, status)
              }
              setInfo(
                t("gw.usage.bulkPatched", {
                  n: toolIds.length,
                  status: t(`gw.status.${status}`)
                })
              )
              await load()
            } catch (e) {
              setError(String(e))
            }
          }}
        />
      )}

      {section === "data" && (
        <DataPanel
          t={t}
          period={period}
          eventStats={eventStats}
          events={events}
          sensitiveAttempts={sensitiveAttempts}
          protectedActions={protectedActions}
          summary={summary}
          onOpenEvents={onOpenEvents}
        />
      )}

      {section === "compliance" && (
        <CompliancePanel
          t={t}
          period={period}
          summary={summary}
          risk={risk}
          avgRisk={avgRisk}
          riskDelta={riskDelta}
          eventStats={eventStats}
          events={events}
          tools={tools}
          shadowCounts={shadowCounts}
          sensitiveAttempts={sensitiveAttempts}
          protectedActions={protectedActions}
          riskUsersSeed={
            riskUsersPeriod === period ? riskUsersCache : undefined
          }
          setError={setError}
          onOpenAudit={onOpenAudit}
          onOpenReports={onOpenReports}
          onOpenEvents={onOpenEvents}
          onOpenUsage={() => setSection("usage")}
          onOpenData={() => setSection("data")}
        />
      )}

      {section === "intelligence" && (
        <IntelligencePanel
          t={t}
          period={period}
          risk={risk}
          avgRisk={avgRisk}
          riskDelta={riskDelta}
          tools={tools}
          unauthorizedTools={unauthorizedTools}
          unknownTools={unknownTools}
          eventStats={eventStats}
          events={events}
          riskUsersSeed={
            riskUsersPeriod === period ? riskUsersCache : undefined
          }
          setError={setError}
          setInfo={setInfo}
          onOpenRisk={onOpenRisk}
          onOpenShadow={onOpenShadow}
          onOpenUsage={() => setSection("usage")}
          onOpenData={() => setSection("data")}
          onOpenCompliance={() => setSection("compliance")}
        />
      )}
    </div>
  )
}

async function fetchRiskSummary(period: Period): Promise<RiskSummary | null> {
  try {
    const r = (await api.riskSummary(period)) as Record<string, unknown>
    if (r && typeof r.average_score === "number") {
      return r as unknown as RiskSummary
    }
    if (r?.summary && typeof (r.summary as RiskSummary).average_score === "number") {
      return r.summary as RiskSummary
    }
    // parfois { ok, summary }
    if (r?.ok && r.summary) return r.summary as RiskSummary
    return null
  } catch {
    return null
  }
}

/* ─── Panels ─── */

function decisionKind(d: string): string {
  const x = d.toLowerCase()
  if (x.includes("block")) return "block"
  if (x.includes("rewrite") || x === "secure_rewrite") return "rewrite"
  if (x.includes("mask")) return "mask"
  if (x.includes("send_anyway") || x === "allow") return "bypass"
  if (x.includes("cancel")) return "cancel"
  return "other"
}

function GovernancePanel({
  t,
  period,
  summary,
  risk,
  avgRisk,
  riskDelta,
  shadowCounts,
  eventStats,
  events,
  sensitiveAttempts,
  protectedActions,
  topRisks,
  tools,
  setError,
  onOpenUsage,
  onOpenData,
  onOpenCompliance,
  onOpenIntel,
  onOpenRisk,
  onOpenEvents,
  onOpenShadow
}: {
  t: Props["t"]
  period: Period
  summary: Summary | null
  risk: RiskSummary | null
  avgRisk: number
  riskDelta: number | null
  shadowCounts: ShadowCounts | null
  eventStats: {
    total: number
    blocked: number
    rewrite: number
    mask: number
    sendAnyway: number
    cancel: number
    high: number
    medium: number
    low: number
  }
  events: EventRow[]
  sensitiveAttempts: number
  protectedActions: number
  topRisks: Array<{
    title: string
    detail: string
    score: number
    drill: GovDrill
    cta: string
  }>
  tools: ShadowTool[]
  setError: (e: string | null) => void
  onOpenUsage: () => void
  onOpenData: () => void
  onOpenCompliance: () => void
  onOpenIntel: () => void
  onOpenRisk?: () => void
  onOpenEvents?: () => void
  onOpenShadow?: () => void
}) {
  const [drill, setDrill] = useState<GovDrill | null>(null)
  const [riskUsers, setRiskUsers] = useState<RiskUserRow[]>([])
  const [drillBusy, setDrillBusy] = useState(false)
  const [userDetail, setUserDetail] = useState<{
    agent_id: string
    raw: Record<string, unknown> | null
  } | null>(null)

  const apps = shadowCounts?.total ?? tools.length
  const users =
    risk?.users_count ?? summary?.users_count ?? summary?.agents ?? 0
  const unauth = shadowCounts?.unauthorized ?? 0
  const unknown = shadowCounts?.unknown ?? 0
  const authorized = shadowCounts?.authorized ?? 0
  const score = Math.round(avgRisk)
  const riskTone =
    score >= 70 ? "danger" : score >= 40 ? "warn" : score > 0 ? "ok" : "neutral"
  const protectRate =
    sensitiveAttempts > 0
      ? Math.round((protectedActions / Math.max(sensitiveAttempts, 1)) * 100)
      : protectedActions > 0
        ? 100
        : 0

  const topApps = useMemo(
    () =>
      [...tools]
        .sort((a, b) => (b.events_count || 0) - (a.events_count || 0))
        .slice(0, 6),
    [tools]
  )
  const maxAppEvents = Math.max(1, ...topApps.map((x) => x.events_count || 0))

  const openDrill = useCallback((d: GovDrill) => {
    setUserDetail(null)
    setDrill(d)
  }, [])

  // Charger les users risk dès qu’on ouvre un forage « who / risks »
  useEffect(() => {
    if (!drill || (drill.kind !== "who" && drill.kind !== "risks")) return
    let cancelled = false
    setDrillBusy(true)
    void (async () => {
      try {
        const r = await api.riskUsers({
          period,
          min_score: 0,
          limit: 100,
          sort: "score_desc"
        })
        if (!cancelled) {
          setRiskUsers((r.users || []) as RiskUserRow[])
        }
      } catch (e) {
        if (!cancelled) {
          setError(String(e))
          setRiskUsers([])
        }
      } finally {
        if (!cancelled) setDrillBusy(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [drill, period, setError])

  const openUserDetail = async (agentId: string) => {
    setDrillBusy(true)
    try {
      const d = await api.riskUserDetail(agentId, period)
      setUserDetail({ agent_id: agentId, raw: d as Record<string, unknown> })
    } catch (e) {
      setError(String(e))
    } finally {
      setDrillBusy(false)
    }
  }

  const questions: Array<{
    id: string
    q: string
    a: string
    meta: string
    drill: GovDrill
    tone?: "danger" | "warn" | "ok" | "neutral"
  }> = [
    {
      id: "who",
      q: t("gw.q.who"),
      a: t("gw.gov.ans.who", { n: users }),
      meta: t("gw.gov.meta.who"),
      drill: { kind: "who" },
      tone: users > 0 ? "neutral" : "warn"
    },
    {
      id: "what",
      q: t("gw.q.what"),
      a: t("gw.gov.ans.what", { n: apps, unauth }),
      meta: t("gw.gov.meta.what", { auth: authorized, unknown }),
      drill: { kind: "what" },
      tone: unauth > 0 ? "danger" : unknown > 0 ? "warn" : "ok"
    },
    {
      id: "risks",
      q: t("gw.q.risks"),
      a: t("gw.gov.ans.risks", {
        label: riskLabel(t, avgRisk),
        n: score
      }),
      meta:
        riskDelta != null
          ? t("gw.kpi.riskDelta", {
              d: `${riskDelta > 0 ? "+" : ""}${riskDelta}`
            })
          : t("gw.gov.meta.risks", {
              high: risk?.high_risk_users ?? 0
            }),
      drill: { kind: "risks" },
      tone: riskTone === "neutral" ? "warn" : riskTone
    },
    {
      id: "data",
      q: t("gw.q.data"),
      a: t("gw.gov.ans.data", {
        n: sensitiveAttempts,
        blocked: eventStats.blocked
      }),
      meta: t("gw.gov.meta.data", {
        rewrite: eventStats.rewrite + eventStats.mask,
        bypass: eventStats.sendAnyway
      }),
      drill: { kind: "data" },
      tone:
        eventStats.high > 0
          ? "danger"
          : sensitiveAttempts > 0
            ? "warn"
            : "ok"
    },
    {
      id: "policy",
      q: t("gw.q.policy"),
      a: t("gw.gov.ans.policy", {
        auth: authorized,
        total: apps || 0
      }),
      meta: t("gw.gov.meta.policy"),
      drill: { kind: "policy" },
      tone: apps > 0 && authorized === apps ? "ok" : "neutral"
    }
  ]

  return (
    <div className="gw-panel gw-gov">
      {/* Executive posture */}
      <section className={`gw-gov-hero gw-gov-hero--${riskTone}`}>
        <div className="gw-gov-hero-copy">
          <span className="gw-kicker">{t("gw.gov.kicker")}</span>
          <h2 className="gw-gov-hero-title">{t("gw.gov.heroTitle")}</h2>
          <p className="gw-gov-hero-lead">
            {riskTone === "danger"
              ? t("gw.gov.lead.danger")
              : riskTone === "warn"
                ? t("gw.gov.lead.warn")
                : riskTone === "ok"
                  ? t("gw.gov.lead.ok")
                  : t("gw.gov.lead.neutral")}
          </p>
          <div className="gw-gov-hero-actions">
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => openDrill({ kind: "who" })}>
              {t("gw.gov.drill.cta.who")}
            </button>
            <button
              type="button"
              className="btn secondary btn-sm"
              onClick={() => openDrill({ kind: "data" })}>
              {t("gw.gov.drill.cta.data")}
            </button>
            <button
              type="button"
              className="btn secondary btn-sm"
              onClick={() => openDrill({ kind: "unauth" })}>
              {t("gw.gov.drill.cta.unauth")}
            </button>
          </div>
        </div>

        <button
          type="button"
          className="gw-gov-gauge"
          onClick={() => openDrill({ kind: "risks" })}
          title={t("gw.kpi.orgRisk")}>
          <div className="gw-gov-gauge-ring">
            <svg viewBox="0 0 36 36" aria-hidden>
              <path
                className="gw-usage-ring-bg"
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
              />
              <path
                className={`gw-gov-gauge-fg gw-gov-gauge-fg--${riskTone}`}
                strokeDasharray={`${Math.min(100, Math.max(0, score))}, 100`}
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
              />
            </svg>
            <div className="gw-gov-gauge-num">
              <strong className={scoreClass(avgRisk)}>{score}</strong>
              <span>/100</span>
            </div>
          </div>
          <div className="gw-gov-gauge-meta">
            <span
              className={`gw-badge gw-gov-risk-badge gw-gov-risk-badge--${riskTone}`}>
              {riskLabel(t, avgRisk)}
            </span>
            <span className="muted">
              {riskDelta != null
                ? t("gw.kpi.riskDelta", {
                    d: `${riskDelta > 0 ? "+" : ""}${riskDelta}`
                  })
                : t(`gw.period.${period}`)}
            </span>
          </div>
        </button>
      </section>

      {/* 4 executive KPIs — live drill */}
      <div className="gw-gov-kpis">
        <button
          type="button"
          className="gw-gov-kpi"
          onClick={() => openDrill({ kind: "what" })}>
          <span className="gw-gov-kpi-l">{t("gw.gov.kpi.apps")}</span>
          <span className="gw-gov-kpi-v">{apps}</span>
          <span className="gw-gov-kpi-h">
            {unauth > 0
              ? t("gw.gov.kpi.appsUnauth", { n: unauth })
              : t("gw.gov.kpi.appsOk")}
          </span>
        </button>
        <button
          type="button"
          className="gw-gov-kpi"
          onClick={() => openDrill({ kind: "who" })}>
          <span className="gw-gov-kpi-l">{t("gw.gov.kpi.users")}</span>
          <span className="gw-gov-kpi-v">{users}</span>
          <span className="gw-gov-kpi-h">
            {(risk?.high_risk_users || 0) > 0
              ? t("gw.gov.kpi.usersHigh", { n: risk?.high_risk_users || 0 })
              : t("gw.gov.kpi.usersOk")}
          </span>
        </button>
        <button
          type="button"
          className="gw-gov-kpi"
          onClick={() => openDrill({ kind: "data" })}>
          <span className="gw-gov-kpi-l">{t("gw.gov.kpi.sensitive")}</span>
          <span className="gw-gov-kpi-v">{sensitiveAttempts}</span>
          <span className="gw-gov-kpi-h">
            {t("gw.gov.kpi.protectedLine", {
              n: protectedActions,
              pct: protectRate
            })}
          </span>
        </button>
        <button
          type="button"
          className={`gw-gov-kpi gw-gov-kpi--${riskTone}`}
          onClick={() => openDrill({ kind: "risks" })}>
          <span className="gw-gov-kpi-l">{t("gw.gov.kpi.risk")}</span>
          <span className={`gw-gov-kpi-v ${scoreClass(avgRisk)}`}>
            {riskLabel(t, avgRisk)}
          </span>
          <span className="gw-gov-kpi-h">{t("gw.kpi.score", { n: score })}</span>
        </button>
      </div>

      {/* Protection funnel + apps */}
      <div className="gw-gov-mid">
        <div className="gw-card gw-gov-funnel">
          <div className="gw-card-head">
            <h3>{t("gw.gov.funnelTitle")}</h3>
            <button
              type="button"
              className="btn secondary btn-sm"
              onClick={() => openDrill({ kind: "data" })}>
              {t("gw.gov.drill.open")}
            </button>
          </div>
          <div className="gw-gov-funnel-steps">
            <button
              type="button"
              className="gw-gov-funnel-step"
              onClick={() => openDrill({ kind: "events" })}>
              <span className="gw-gov-funnel-n">{eventStats.total}</span>
              <span className="gw-gov-funnel-l">{t("gw.gov.funnel.events")}</span>
            </button>
            <span className="gw-gov-funnel-arrow" aria-hidden>
              →
            </span>
            <button
              type="button"
              className="gw-gov-funnel-step"
              onClick={() => openDrill({ kind: "data" })}>
              <span className="gw-gov-funnel-n">{sensitiveAttempts}</span>
              <span className="gw-gov-funnel-l">
                {t("gw.gov.funnel.sensitive")}
              </span>
            </button>
            <span className="gw-gov-funnel-arrow" aria-hidden>
              →
            </span>
            <button
              type="button"
              className="gw-gov-funnel-step gw-gov-funnel-step--ok"
              onClick={() => openDrill({ kind: "protected" })}>
              <span className="gw-gov-funnel-n">{protectedActions}</span>
              <span className="gw-gov-funnel-l">
                {t("gw.gov.funnel.protected")}
              </span>
            </button>
            <span className="gw-gov-funnel-arrow" aria-hidden>
              →
            </span>
            <button
              type="button"
              className="gw-gov-funnel-step gw-gov-funnel-step--warn"
              onClick={() => openDrill({ kind: "bypass" })}>
              <span className="gw-gov-funnel-n">{eventStats.sendAnyway}</span>
              <span className="gw-gov-funnel-l">{t("gw.gov.funnel.bypass")}</span>
            </button>
          </div>
          <div className="gw-gov-sev">
            {(
              [
                ["high", eventStats.high, "high"],
                ["medium", eventStats.medium, "med"],
                ["low", eventStats.low, "low"]
              ] as const
            ).map(([key, n, tone]) => (
              <button
                key={key}
                type="button"
                className="gw-gov-sev-row gw-gov-sev-row--btn"
                onClick={() =>
                  openDrill({ kind: key === "high" ? "high" : "data" })
                }>
                <span>
                  {key === "high"
                    ? t("gw.data.high")
                    : key === "medium"
                      ? t("gw.data.medium")
                      : t("gw.risk.low")}
                </span>
                <div className="gw-gov-sev-bar">
                  <i
                    className={`gw-gov-sev-fill gw-gov-sev-fill--${tone}`}
                    style={{
                      width: `${Math.min(
                        100,
                        (n / Math.max(sensitiveAttempts, 1)) * 100
                      )}%`
                    }}
                  />
                </div>
                <strong>{n}</strong>
              </button>
            ))}
          </div>
        </div>

        <div className="gw-card gw-gov-topapps">
          <div className="gw-card-head">
            <h3>{t("gw.gov.topApps")}</h3>
            <button
              type="button"
              className="btn secondary btn-sm"
              onClick={() => openDrill({ kind: "what" })}>
              {t("gw.gov.drill.open")}
            </button>
          </div>
          {topApps.length === 0 ? (
            <p className="muted gw-gov-empty">{t("gw.usage.empty")}</p>
          ) : (
            <ul className="gw-gov-apps">
              {topApps.map((tool) => {
                const name = tool.display_name || tool.tool
                const pct = Math.max(
                  6,
                  Math.round(((tool.events_count || 0) / maxAppEvents) * 100)
                )
                return (
                  <li key={tool.tool}>
                    <button
                      type="button"
                      className="gw-gov-app-btn"
                      onClick={() =>
                        openDrill({ kind: "app", tool: tool.tool })
                      }>
                      <span
                        className={`gw-usage-avatar gw-usage-avatar--${tool.status}`}
                        aria-hidden>
                        {appInitials(name)}
                      </span>
                      <div className="gw-gov-app-body">
                        <div className="gw-gov-app-top">
                          <strong>{name}</strong>
                          <span className={`gw-badge gw-badge--${tool.status}`}>
                            {t(`gw.status.${tool.status}`)}
                          </span>
                        </div>
                        <div className="gw-usage-vol-bar">
                          <span style={{ width: `${pct}%` }} />
                        </div>
                        <span className="muted" style={{ fontSize: 11 }}>
                          {tool.events_count} {t("gw.usage.eventsShort")} ·{" "}
                          {tool.agents_count} {t("gw.usage.agentsShort")}
                        </span>
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>

      {/* 5 questions → live data */}
      <div className="gw-card gw-gov-questions">
        <div className="gw-card-head">
          <h3>{t("gw.governance.questions")}</h3>
        </div>
        <div className="gw-gov-qgrid">
          {questions.map((item, i) => (
            <button
              key={item.id}
              type="button"
              className={`gw-gov-qcard gw-gov-qcard--${item.tone || "neutral"}`}
              onClick={() => openDrill(item.drill)}>
              <span className="gw-gov-qnum">{i + 1}</span>
              <strong className="gw-gov-qq">{item.q}</strong>
              <span className="gw-gov-qa">{item.a}</span>
              <span className="gw-gov-qm muted">{item.meta}</span>
              <span className="gw-gov-qgo">{t("gw.gov.drill.inspect")} →</span>
            </button>
          ))}
        </div>
      </div>

      {/* Top risks → live drill */}
      <div className="gw-card">
        <div className="gw-card-head">
          <h3>{t("gw.governance.topRisks")}</h3>
          <button
            type="button"
            className="btn secondary btn-sm"
            onClick={() => openDrill({ kind: "risks" })}>
            {t("gw.gov.drill.open")}
          </button>
        </div>
        <ol className="gw-gov-risks">
          {topRisks.map((r, i) => (
            <li key={i} className={r.score >= 70 ? "is-hot" : ""}>
              <span className="gw-rank-i">{i + 1}</span>
              <button
                type="button"
                className="gw-gov-risk-body gw-gov-risk-body--btn"
                onClick={() => openDrill(r.drill)}>
                <div className="gw-gov-risk-top">
                  <strong>{r.title}</strong>
                  <span className={`gw-score ${scoreClass(r.score)}`}>
                    {r.score}
                  </span>
                </div>
                <p className="muted">{r.detail}</p>
                <div className="gw-gov-risk-bar">
                  <i style={{ width: `${Math.min(100, r.score)}%` }} />
                </div>
              </button>
              <button
                type="button"
                className="btn secondary btn-sm"
                onClick={() => openDrill(r.drill)}>
                {r.cta}
              </button>
            </li>
          ))}
        </ol>
      </div>

      {drill && (
        <GovDrillDrawer
          t={t}
          period={period}
          drill={drill}
          busy={drillBusy}
          risk={risk}
          avgRisk={avgRisk}
          riskDelta={riskDelta}
          tools={tools}
          events={events}
          riskUsers={riskUsers}
          summary={summary}
          userDetail={userDetail}
          onClose={() => {
            setDrill(null)
            setUserDetail(null)
          }}
          onOpenUser={openUserDetail}
          onClearUser={() => setUserDetail(null)}
          onOpenUsage={onOpenUsage}
          onOpenData={onOpenData}
          onOpenIntel={onOpenIntel}
          onOpenRisk={onOpenRisk}
          onOpenEvents={onOpenEvents}
          onOpenShadow={onOpenShadow}
        />
      )}
    </div>
  )
}

function GovDrillDrawer({
  t,
  period,
  drill,
  busy,
  risk,
  avgRisk,
  riskDelta,
  tools,
  events,
  riskUsers,
  summary,
  userDetail,
  onClose,
  onOpenUser,
  onClearUser,
  onOpenUsage,
  onOpenData,
  onOpenIntel,
  onOpenRisk,
  onOpenEvents,
  onOpenShadow
}: {
  t: Props["t"]
  period: Period
  drill: GovDrill
  busy: boolean
  risk: RiskSummary | null
  avgRisk: number
  riskDelta: number | null
  tools: ShadowTool[]
  events: EventRow[]
  riskUsers: RiskUserRow[]
  summary: Summary | null
  userDetail: { agent_id: string; raw: Record<string, unknown> | null } | null
  onClose: () => void
  onOpenUser: (id: string) => Promise<void>
  onClearUser: () => void
  onOpenUsage: () => void
  onOpenData: () => void
  onOpenIntel: () => void
  onOpenRisk?: () => void
  onOpenEvents?: () => void
  onOpenShadow?: () => void
}) {
  const title = t(`gw.gov.drill.title.${drill.kind}`, {
    app:
      tools.find((x) => x.tool === drill.tool)?.display_name ||
      drill.tool ||
      ""
  })
  const subtitle = t(`gw.gov.drill.sub.${drill.kind}`)

  const filteredEvents = useMemo(() => {
    const list = [...events]
    const match = (e: EventRow) => {
      const d = decisionKind(e.decision || "")
      const sev = String(e.highest_severity || "").toLowerCase()
      switch (drill.kind) {
        case "high":
          return sev === "high"
        case "data":
          return sev === "high" || sev === "medium" || sev === "low"
        case "protected":
          return (
            d === "block" || d === "rewrite" || d === "mask" || d === "cancel"
          )
        case "bypass":
          return d === "bypass"
        case "events":
          return true
        case "app":
          return (
            String(e.source || "")
              .toLowerCase()
              .includes((drill.tool || "").toLowerCase()) ||
            (e.types || []).some((x) =>
              String(x)
                .toLowerCase()
                .includes((drill.tool || "").toLowerCase())
            )
          )
        default:
          return false
      }
    }
    if (
      drill.kind === "high" ||
      drill.kind === "data" ||
      drill.kind === "protected" ||
      drill.kind === "bypass" ||
      drill.kind === "events" ||
      drill.kind === "app"
    ) {
      return list.filter(match).slice(0, 40)
    }
    return []
  }, [events, drill])

  const filteredTools = useMemo(() => {
    let list = [...tools]
    if (drill.kind === "unauth") {
      list = list.filter((x) => x.status === "unauthorized")
    } else if (drill.kind === "policy") {
      list = list.sort(
        (a, b) => statusPriority(a.status) - statusPriority(b.status)
      )
    } else if (drill.kind === "what") {
      list = list.sort((a, b) => (b.events_count || 0) - (a.events_count || 0))
    } else if (drill.kind === "app" && drill.tool) {
      list = list.filter((x) => x.tool === drill.tool)
    } else {
      return []
    }
    return list.slice(0, 40)
  }, [tools, drill])

  const sortedUsers = useMemo(() => {
    const list = [...riskUsers].sort((a, b) => b.score - a.score)
    if (drill.kind === "who" || drill.kind === "risks") {
      return list.slice(0, 40)
    }
    return []
  }, [riskUsers, drill.kind])

  const decisions = summary?.by_decision || {}
  const decisionEntries = Object.entries(decisions)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)

  const secondary = (() => {
    if (drill.kind === "who" || drill.kind === "risks") {
      return onOpenRisk
        ? { label: t("gw.intel.openRisk"), fn: onOpenRisk }
        : { label: t("gw.gov.cta.intel"), fn: onOpenIntel }
    }
    if (
      drill.kind === "what" ||
      drill.kind === "unauth" ||
      drill.kind === "policy" ||
      drill.kind === "app"
    ) {
      return onOpenShadow
        ? { label: t("gw.intel.openShadow"), fn: onOpenShadow }
        : { label: t("gw.gov.cta.usage"), fn: onOpenUsage }
    }
    return onOpenEvents
      ? { label: t("gw.data.openEvents"), fn: onOpenEvents }
      : { label: t("gw.gov.cta.data"), fn: onOpenData }
  })()

  const factors =
    userDetail?.raw &&
    (userDetail.raw.factors as Record<string, number> | undefined)

  return (
    <div className="gw-drill" role="dialog" aria-modal="true" aria-label={title}>
      <button
        type="button"
        className="gw-drill-backdrop"
        aria-label={t("common.close")}
        onClick={onClose}
      />
      <div className="gw-drill-panel">
        <header className="gw-drill-head">
          <div>
            <span className="gw-kicker">{t("gw.gov.drill.kicker")}</span>
            <h3 className="gw-drill-title">{title}</h3>
            <p className="muted gw-drill-sub">
              {subtitle} · {t(`gw.period.${period}`)}
              {busy ? ` · ${t("common.loading")}` : ""}
            </p>
          </div>
          <button
            type="button"
            className="btn secondary btn-sm"
            onClick={onClose}>
            {t("common.close")}
          </button>
        </header>

        <div className="gw-drill-body">
          {(drill.kind === "risks" || drill.kind === "who") && (
            <div className="gw-drill-summary">
              <div>
                <span className="muted">{t("gw.kpi.orgRisk")}</span>
                <strong className={scoreClass(avgRisk)}>
                  {riskLabel(t, avgRisk)} ({Math.round(avgRisk)}/100)
                </strong>
              </div>
              <div>
                <span className="muted">{t("gw.intel.highUsers")}</span>
                <strong>{risk?.high_risk_users ?? 0}</strong>
              </div>
              <div>
                <span className="muted">{t("gw.risk.medium")}</span>
                <strong>{risk?.medium_risk_users ?? 0}</strong>
              </div>
              <div>
                <span className="muted">{t("gw.compliance.riskEvo")}</span>
                <strong>
                  {riskDelta != null
                    ? `${riskDelta > 0 ? "↑" : riskDelta < 0 ? "↓" : "→"} ${Math.abs(riskDelta)}%`
                    : "—"}
                </strong>
              </div>
            </div>
          )}

          {(drill.kind === "who" || drill.kind === "risks") && (
            <>
              {userDetail ? (
                <div className="gw-drill-user-detail">
                  <div className="gw-card-head">
                    <h4>
                      {t("gw.gov.drill.userDetail")} ·{" "}
                      {userDetail.agent_id.slice(0, 16)}
                    </h4>
                    <button
                      type="button"
                      className="btn secondary btn-sm"
                      onClick={onClearUser}>
                      {t("gw.gov.drill.backList")}
                    </button>
                  </div>
                  {factors && Object.keys(factors).length > 0 ? (
                    <ul className="gw-drill-factors">
                      {Object.entries(factors)
                        .sort((a, b) => b[1] - a[1])
                        .map(([k, v]) => (
                          <li key={k}>
                            <code>{k}</code>
                            <strong>{v}</strong>
                          </li>
                        ))}
                    </ul>
                  ) : (
                    <p className="muted">{t("gw.gov.drill.noFactors")}</p>
                  )}
                  {Array.isArray(userDetail.raw?.recent_events) && (
                    <ul className="gw-drill-events">
                      {(
                        userDetail.raw?.recent_events as Array<
                          Record<string, unknown>
                        >
                      )
                        .slice(0, 12)
                        .map((e, i) => (
                          <li key={i}>
                            <span className="muted">
                              {relativeTime(String(e.ts || e.created_at || ""))}
                            </span>
                            <code>{String(e.decision || "—")}</code>
                            <span>
                              {String(e.highest_severity || e.severity || "—")}
                            </span>
                          </li>
                        ))}
                    </ul>
                  )}
                </div>
              ) : sortedUsers.length === 0 ? (
                <p className="muted">{t("gw.intel.noUsers")}</p>
              ) : (
                <div className="gw-drill-table-wrap">
                  <table className="gw-drill-table">
                    <thead>
                      <tr>
                        <th>{t("gw.gov.drill.col.user")}</th>
                        <th>{t("gw.gov.drill.col.score")}</th>
                        <th>{t("gw.gov.drill.col.trend")}</th>
                        <th>{t("gw.gov.drill.col.events")}</th>
                        <th>{t("gw.gov.drill.col.tools")}</th>
                        <th>{t("gw.gov.drill.col.last")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedUsers.map((u) => (
                        <tr
                          key={u.agent_id}
                          className="is-click"
                          onClick={() => void onOpenUser(u.agent_id)}>
                          <td>
                            <strong>{u.label || u.agent_id}</strong>
                            <div className="muted mono" style={{ fontSize: 10 }}>
                              {u.agent_id.slice(0, 14)}…
                            </div>
                          </td>
                          <td>
                            <span className={`gw-score ${scoreClass(u.score)}`}>
                              {Math.round(u.score)}
                            </span>
                          </td>
                          <td>
                            {trendGlyph(u.trend)}{" "}
                            {t(`gw.intel.userTrend.${u.trend}`)}
                          </td>
                          <td>{u.events_count}</td>
                          <td className="muted" style={{ fontSize: 11 }}>
                            {(u.tools || []).slice(0, 3).join(", ") || "—"}
                          </td>
                          <td>{relativeTime(u.last_event_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {(drill.kind === "what" ||
            drill.kind === "unauth" ||
            drill.kind === "policy" ||
            drill.kind === "app") && (
            <>
              {filteredTools.length === 0 ? (
                <p className="muted">{t("gw.usage.empty")}</p>
              ) : (
                <div className="gw-drill-table-wrap">
                  <table className="gw-drill-table">
                    <thead>
                      <tr>
                        <th>{t("gw.usage.col.app")}</th>
                        <th>{t("gw.usage.col.status")}</th>
                        <th>{t("gw.usage.col.events")}</th>
                        <th>{t("gw.usage.col.agents")}</th>
                        <th>{t("gw.usage.col.last")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredTools.map((tool) => (
                        <tr key={tool.tool}>
                          <td>
                            <strong>
                              {tool.display_name || tool.tool}
                            </strong>
                            <div className="muted mono" style={{ fontSize: 10 }}>
                              {tool.tool}
                            </div>
                          </td>
                          <td>
                            <span
                              className={`gw-badge gw-badge--${tool.status}`}>
                              {t(`gw.status.${tool.status}`)}
                            </span>
                          </td>
                          <td>{tool.events_count}</td>
                          <td>{tool.agents_count}</td>
                          <td>{relativeTime(tool.last_seen_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {drill.kind === "policy" && decisionEntries.length > 0 && (
                <div className="gw-drill-decisions">
                  <h4>{t("gw.data.fromSummary")}</h4>
                  <div className="gw-chips">
                    {decisionEntries.map(([k, v]) => (
                      <span key={k} className="gw-chip">
                        <code>{k}</code> {v}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {(drill.kind === "data" ||
            drill.kind === "high" ||
            drill.kind === "protected" ||
            drill.kind === "bypass" ||
            drill.kind === "events" ||
            drill.kind === "app") && (
            <>
              {filteredEvents.length === 0 ? (
                <p className="muted">{t("gw.gov.drill.noEvents")}</p>
              ) : (
                <div className="gw-drill-table-wrap">
                  <table className="gw-drill-table">
                    <thead>
                      <tr>
                        <th>{t("gw.gov.drill.col.when")}</th>
                        <th>{t("gw.gov.drill.col.device")}</th>
                        <th>{t("gw.gov.drill.col.decision")}</th>
                        <th>{t("gw.gov.drill.col.severity")}</th>
                        <th>{t("gw.gov.drill.col.types")}</th>
                        <th>{t("gw.gov.drill.col.source")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredEvents.map((e) => (
                        <tr key={e.id}>
                          <td>{relativeTime(e.ts)}</td>
                          <td>
                            <strong>
                              {e.device_label || e.hostname || "—"}
                            </strong>
                          </td>
                          <td>
                            <code>{e.decision || "—"}</code>
                          </td>
                          <td>
                            <span
                              className={
                                String(e.highest_severity).toLowerCase() ===
                                "high"
                                  ? "gw-risk-high"
                                  : String(e.highest_severity).toLowerCase() ===
                                      "medium"
                                    ? "gw-risk-med"
                                    : ""
                              }>
                              {e.highest_severity || "—"}
                            </span>
                          </td>
                          <td className="muted" style={{ fontSize: 11 }}>
                            {(e.types || []).slice(0, 4).join(", ") || "—"}
                          </td>
                          <td className="muted" style={{ fontSize: 11 }}>
                            {e.source || "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>

        <footer className="gw-drill-foot">
          <div className="gw-drill-foot-actions">
            <button
              type="button"
              className="btn secondary btn-sm"
              onClick={secondary.fn}>
              {secondary.label}
            </button>
            <button type="button" className="btn btn-sm" onClick={onClose}>
              {t("common.close")}
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}

function toolKeyMatch(a: string, b: string): boolean {
  const na = (a || "").toLowerCase().replace(/^www\./, "").trim()
  const nb = (b || "").toLowerCase().replace(/^www\./, "").trim()
  if (!na || !nb) return false
  return (
    na === nb ||
    na.endsWith("." + nb) ||
    nb.endsWith("." + na) ||
    na.includes(nb) ||
    nb.includes(na)
  )
}

type UsageDrill =
  | { kind: "app"; tool: string }
  | { kind: "agent"; agentId: string; tool?: string }
  | { kind: "highAgents" }

function UsagePanel({
  t,
  period,
  tools,
  counts,
  summary,
  events,
  riskUsersSeed,
  busy,
  setError,
  setInfo,
  onOpenShadow,
  onOpenRisk,
  onOpenEvents,
  onOpenIntel,
  onPatch,
  onBulkPatch
}: {
  t: Props["t"]
  period: Period
  tools: ShadowTool[]
  counts: ShadowCounts | null
  summary: Summary | null
  events: EventRow[]
  riskUsersSeed?: RiskUserRow[]
  busy: boolean
  setError: (e: string | null) => void
  setInfo: (i: string | null) => void
  onOpenShadow?: () => void
  onOpenRisk?: () => void
  onOpenEvents?: () => void
  onOpenIntel: () => void
  onPatch: (
    tool: string,
    status: "authorized" | "unauthorized" | "unknown"
  ) => Promise<void>
  onBulkPatch: (
    tools: string[],
    status: "authorized" | "unauthorized" | "unknown"
  ) => Promise<void>
}) {
  const [filter, setFilter] = useState<UsageStatusFilter>("all")
  const [q, setQ] = useState("")
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [patching, setPatching] = useState<string | null>(null)
  const [drill, setDrill] = useState<UsageDrill | null>(null)
  const [riskUsers, setRiskUsers] = useState<RiskUserRow[]>(
    () => riskUsersSeed || []
  )
  const [riskUsersLoaded, setRiskUsersLoaded] = useState(
    () => !!riskUsersSeed?.length
  )
  const [drillBusy, setDrillBusy] = useState(false)
  const [agentDetail, setAgentDetail] = useState<{
    agent_id: string
    user: RiskUserRow | null
    factors: Record<string, number>
    recent: Array<Record<string, unknown>>
  } | null>(null)
  const [profiles, setProfiles] = useState<
    Array<{ id: string; name: string; defaultAction: string }>
  >([])
  /** agent_id → ai access blocked */
  const [aiBlockedMap, setAiBlockedMap] = useState<Record<string, boolean>>({})

  const refreshAiBlockedMap = useCallback(async () => {
    try {
      const r = await api.agents()
      const map: Record<string, boolean> = {}
      for (const a of r.agents || []) {
        map[a.id] =
          a.ai_access_blocked === true || a.ai_access === "blocked"
      }
      setAiBlockedMap(map)
    } catch {
      /* non bloquant */
    }
  }, [])

  // Seed cache parent + profils / ai_access
  useEffect(() => {
    let cancelled = false
    if (riskUsersSeed?.length) {
      setRiskUsers(riskUsersSeed)
      setRiskUsersLoaded(true)
    }
    setDrillBusy(true)
    void (async () => {
      try {
        const needUsers = !riskUsersSeed?.length
        const [ru, pr] = await Promise.all([
          needUsers
            ? api.riskUsers({ period, min_score: 0, limit: 200 })
            : Promise.resolve(null),
          api.profiles().catch(() => null),
          refreshAiBlockedMap()
        ])
        if (cancelled) return
        if (ru?.users) {
          setRiskUsers((ru.users || []) as RiskUserRow[])
          setRiskUsersLoaded(true)
        } else if (!riskUsersSeed?.length) {
          setRiskUsersLoaded(true)
        }
        const list = (pr?.profiles || []) as Array<{
          id: string
          name: string
          defaultAction?: string
          default_action?: string
        }>
        setProfiles(
          list.map((p) => ({
            id: p.id,
            name: p.name,
            defaultAction: p.defaultAction || p.default_action || "log"
          }))
        )
      } catch (e) {
        if (!cancelled) {
          setError(String(e))
          setRiskUsersLoaded(true)
        }
      } finally {
        if (!cancelled) setDrillBusy(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [period, setError, refreshAiBlockedMap, riskUsersSeed])

  const total = counts?.total ?? tools.length
  const authorized = counts?.authorized ?? 0
  const unauthorized = counts?.unauthorized ?? 0
  const unknown = counts?.unknown ?? 0
  const reviewCount = unauthorized + unknown
  const classified = authorized + unauthorized
  const coveragePct =
    total > 0 ? Math.round((classified / Math.max(total, 1)) * 100) : 0
  const maxEvents = useMemo(
    () => Math.max(1, ...tools.map((x) => x.events_count || 0)),
    [tools]
  )

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return [...tools]
      .filter((tool) => {
        if (filter === "review") {
          if (tool.status === "authorized") return false
        } else if (filter !== "all" && tool.status !== filter) {
          return false
        }
        if (!needle) return true
        return (
          tool.tool.toLowerCase().includes(needle) ||
          (tool.display_name || "").toLowerCase().includes(needle)
        )
      })
      .sort((a, b) => {
        const sp = statusPriority(a.status) - statusPriority(b.status)
        if (sp !== 0) return sp
        return (b.events_count || 0) - (a.events_count || 0)
      })
  }, [tools, filter, q])

  useEffect(() => {
    setSelected(new Set())
  }, [filter, q, tools])

  const allVisibleSelected =
    filtered.length > 0 && filtered.every((x) => selected.has(x.tool))

  const toggleAll = () => {
    if (allVisibleSelected) {
      setSelected(new Set())
      return
    }
    setSelected(new Set(filtered.map((x) => x.tool)))
  }

  const toggleOne = (tool: string) => {
    setSelected((prev) => {
      const n = new Set(prev)
      if (n.has(tool)) n.delete(tool)
      else n.add(tool)
      return n
    })
  }

  const runPatch = async (
    tool: string,
    status: "authorized" | "unauthorized" | "unknown"
  ) => {
    setPatching(tool)
    try {
      await onPatch(tool, status)
    } finally {
      setPatching(null)
    }
  }

  const runBulk = async (
    status: "authorized" | "unauthorized" | "unknown"
  ) => {
    if (!selected.size) return
    setPatching("__bulk__")
    try {
      await onBulkPatch([...selected], status)
      setSelected(new Set())
    } finally {
      setPatching(null)
    }
  }

  const postureTone =
    unauthorized > 0 ? "danger" : reviewCount > 0 ? "warn" : "ok"

  const highRiskAgents = useMemo(
    () => riskUsers.filter((u) => u.score >= 70 && u.events_count > 0),
    [riskUsers]
  )

  const agentsForTool = useCallback(
    (toolId: string) => {
      // 1) depuis risk users (tools[])
      const fromRisk = riskUsers
        .filter((u) =>
          (u.tools || []).some((x) => toolKeyMatch(x, toolId))
        )
        .map((u) => {
          const toolEvents = events.filter(
            (e) =>
              e.agent_id === u.agent_id &&
              toolKeyMatch(e.hostname || e.source || "", toolId)
          )
          return {
            user: u,
            events_on_tool: toolEvents.length,
            high_on_tool: toolEvents.filter(
              (e) => String(e.highest_severity).toLowerCase() === "high"
            ).length,
            bypass_on_tool: toolEvents.filter(
              (e) => decisionKind(e.decision) === "bypass"
            ).length,
            last_on_tool:
              toolEvents
                .map((e) => e.ts)
                .filter(Boolean)
                .sort()
                .reverse()[0] || u.last_event_at
          }
        })
      // 2) agents vus dans events mais absents du risk set
      const seen = new Set(fromRisk.map((x) => x.user.agent_id))
      const fromEvents = new Map<string, EventRow[]>()
      for (const e of events) {
        if (!e.agent_id) continue
        if (!toolKeyMatch(e.hostname || e.source || "", toolId)) continue
        if (seen.has(e.agent_id)) continue
        const list = fromEvents.get(e.agent_id) || []
        list.push(e)
        fromEvents.set(e.agent_id, list)
      }
      const extras = [...fromEvents.entries()].map(([aid, list]) => ({
        user: {
          agent_id: aid,
          label:
            list[0]?.device_label || list[0]?.hostname || aid.slice(0, 12),
          score: 0,
          score_previous: null,
          trend: "flat" as const,
          factors: {},
          tools: [toolId],
          events_count: list.length,
          last_event_at: list.map((e) => e.ts).sort().reverse()[0] || null
        } satisfies RiskUserRow,
        events_on_tool: list.length,
        high_on_tool: list.filter(
          (e) => String(e.highest_severity).toLowerCase() === "high"
        ).length,
        bypass_on_tool: list.filter(
          (e) => decisionKind(e.decision) === "bypass"
        ).length,
        last_on_tool: list.map((e) => e.ts).sort().reverse()[0] || null
      }))
      return [...fromRisk, ...extras].sort(
        (a, b) => b.user.score - a.user.score || b.events_on_tool - a.events_on_tool
      )
    },
    [riskUsers, events]
  )

  const openApp = (toolId: string) => {
    setAgentDetail(null)
    setDrill({ kind: "app", tool: toolId })
  }

  const openAgent = async (agentId: string, tool?: string) => {
    setDrill({ kind: "agent", agentId, tool })
    setDrillBusy(true)
    try {
      const d = (await api.riskUserDetail(agentId, period)) as Record<
        string,
        unknown
      >
      const user =
        (d.user as RiskUserRow | undefined) ||
        riskUsers.find((u) => u.agent_id === agentId) ||
        null
      setAgentDetail({
        agent_id: agentId,
        user,
        factors: (user?.factors as Record<string, number>) || {},
        recent: Array.isArray(d.recent_events)
          ? (d.recent_events as Array<Record<string, unknown>>)
          : []
      })
    } catch (e) {
      setError(String(e))
      setAgentDetail({
        agent_id: agentId,
        user: riskUsers.find((u) => u.agent_id === agentId) || null,
        factors: {},
        recent: []
      })
    } finally {
      setDrillBusy(false)
    }
  }

  const restrictiveProfiles = profiles.filter((p) => {
    const a = p.defaultAction.toLowerCase()
    return (
      a.includes("block") ||
      a.includes("mask") ||
      a.includes("rewrite") ||
      a === "deny"
    )
  })

  const applyWeanProfile = async (agentId: string, profileId: string) => {
    setDrillBusy(true)
    try {
      await api.assignAgentProfile(agentId, profileId)
      const name =
        profiles.find((p) => p.id === profileId)?.name || profileId
      setInfo(t("gw.usage.wean.profileOk", { profile: name }))
    } catch (e) {
      setError(String(e))
    } finally {
      setDrillBusy(false)
    }
  }

  const setAiAccess = async (agentId: string, blocked: boolean) => {
    setDrillBusy(true)
    try {
      await api.setAgentAiAccess(agentId, blocked)
      setAiBlockedMap((m) => ({ ...m, [agentId]: blocked }))
      setInfo(
        blocked
          ? t("gw.usage.wean.blockOk")
          : t("gw.usage.wean.unblockOk")
      )
    } catch (e) {
      setError(String(e))
    } finally {
      setDrillBusy(false)
    }
  }

  return (
    <div className="gw-panel gw-usage">
      {/* Posture banner */}
      <section className={`gw-usage-posture gw-usage-posture--${postureTone}`}>
        <div className="gw-usage-posture-main">
          <span className="gw-kicker">{t("gw.usage.postureKicker")}</span>
          <h2 className="gw-usage-posture-title">
            {t("gw.usage.postureTitle", {
              apps: total,
              unauth: unauthorized,
              unknown
            })}
          </h2>
          <p className="gw-usage-posture-lead">
            {unauthorized > 0
              ? t("gw.usage.postureLeadUnauth", { n: unauthorized })
              : reviewCount > 0
                ? t("gw.usage.postureLeadReview", { n: reviewCount })
                : total > 0
                  ? t("gw.usage.postureLeadOk")
                  : t("gw.usage.postureLeadEmpty")}
          </p>
          <div className="gw-usage-posture-actions">
            {reviewCount > 0 && (
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setFilter("review")}>
                {t("gw.usage.reviewQueue", { n: reviewCount })}
              </button>
            )}
            {highRiskAgents.length > 0 && (
              <button
                type="button"
                className="btn danger btn-sm"
                onClick={() => {
                  setAgentDetail(null)
                  setDrill({ kind: "highAgents" })
                }}>
                {t("gw.usage.highAgentsCta", { n: highRiskAgents.length })}
              </button>
            )}
            {onOpenShadow && (
              <button
                type="button"
                className="btn secondary btn-sm"
                onClick={onOpenShadow}>
                {t("gw.usage.openShadow")}
              </button>
            )}
          </div>
        </div>
        <div className="gw-usage-coverage">
          <div className="gw-usage-coverage-ring" data-pct={coveragePct}>
            <svg viewBox="0 0 36 36" aria-hidden>
              <path
                className="gw-usage-ring-bg"
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
              />
              <path
                className="gw-usage-ring-fg"
                strokeDasharray={`${coveragePct}, 100`}
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
              />
            </svg>
            <div className="gw-usage-coverage-num">
              <strong>{coveragePct}%</strong>
              <span>{t("gw.usage.coverage")}</span>
            </div>
          </div>
          <p className="gw-usage-coverage-hint">
            {t("gw.usage.coverageHint", {
              classified,
              total: total || 0
            })}
          </p>
        </div>
      </section>

      {/* KPI strip */}
      <div className="gw-usage-stats">
        <button
          type="button"
          className={`gw-usage-stat ${filter === "all" ? "is-on" : ""}`}
          onClick={() => setFilter("all")}>
          <span className="gw-usage-stat-l">{t("gw.usage.total")}</span>
          <span className="gw-usage-stat-v">{total}</span>
          <span className="gw-usage-stat-h">{t(`gw.period.${period}`)}</span>
        </button>
        <button
          type="button"
          className={`gw-usage-stat gw-usage-stat--danger ${filter === "unauthorized" ? "is-on" : ""}`}
          onClick={() => setFilter("unauthorized")}>
          <span className="gw-usage-stat-l">{t("gw.usage.unauthorized")}</span>
          <span className="gw-usage-stat-v">{unauthorized}</span>
          <span className="gw-usage-stat-h">{t("gw.usage.stat.unauthHint")}</span>
        </button>
        <button
          type="button"
          className={`gw-usage-stat gw-usage-stat--warn ${filter === "unknown" ? "is-on" : ""}`}
          onClick={() => setFilter("unknown")}>
          <span className="gw-usage-stat-l">{t("gw.usage.unknown")}</span>
          <span className="gw-usage-stat-v">{unknown}</span>
          <span className="gw-usage-stat-h">{t("gw.usage.stat.unknownHint")}</span>
        </button>
        <button
          type="button"
          className={`gw-usage-stat gw-usage-stat--ok ${filter === "authorized" ? "is-on" : ""}`}
          onClick={() => setFilter("authorized")}>
          <span className="gw-usage-stat-l">{t("gw.usage.authorized")}</span>
          <span className="gw-usage-stat-v">{authorized}</span>
          <span className="gw-usage-stat-h">{t("gw.usage.stat.authHint")}</span>
        </button>
      </div>

      {/* Distribution bar */}
      {total > 0 && (
        <div className="gw-usage-dist">
          <div className="gw-usage-dist-head">
            <strong>{t("gw.usage.distTitle")}</strong>
            <span className="muted">
              {t("gw.usage.distHint", {
                agents: summary?.agents ?? "—"
              })}
            </span>
          </div>
          <div className="gw-usage-dist-bar" role="img" aria-label={t("gw.usage.distTitle")}>
            {authorized > 0 && (
              <span
                className="gw-usage-dist-seg gw-usage-dist-seg--ok"
                style={{ flex: authorized }}
                title={t("gw.status.authorized")}
              />
            )}
            {unknown > 0 && (
              <span
                className="gw-usage-dist-seg gw-usage-dist-seg--warn"
                style={{ flex: unknown }}
                title={t("gw.status.unknown")}
              />
            )}
            {unauthorized > 0 && (
              <span
                className="gw-usage-dist-seg gw-usage-dist-seg--danger"
                style={{ flex: unauthorized }}
                title={t("gw.status.unauthorized")}
              />
            )}
          </div>
          <div className="gw-usage-dist-legend">
            <span>
              <i className="gw-dot gw-dot--ok" /> {t("gw.status.authorized")}{" "}
              <strong>{authorized}</strong>
            </span>
            <span>
              <i className="gw-dot gw-dot--warn" /> {t("gw.status.unknown")}{" "}
              <strong>{unknown}</strong>
            </span>
            <span>
              <i className="gw-dot gw-dot--danger" />{" "}
              {t("gw.status.unauthorized")} <strong>{unauthorized}</strong>
            </span>
          </div>
        </div>
      )}

      {/* Inventory */}
      <div className="gw-card gw-usage-inventory">
        <div className="gw-usage-toolbar">
          <div className="gw-usage-filters">
            {(
              [
                ["all", t("gw.usage.filter.all")],
                ["review", t("gw.usage.filter.review")],
                ["unauthorized", t("gw.usage.filter.unauth")],
                ["unknown", t("gw.usage.filter.unknown")],
                ["authorized", t("gw.usage.filter.auth")]
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`gw-chip-btn ${filter === id ? "is-on" : ""} ${
                  id === "review" && reviewCount > 0 ? "gw-chip-btn--pulse" : ""
                }`}
                onClick={() => setFilter(id)}>
                {label}
                {id === "review" && reviewCount > 0 ? (
                  <em>{reviewCount}</em>
                ) : null}
              </button>
            ))}
          </div>
          <input
            className="input gw-usage-search"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("gw.usage.search")}
            aria-label={t("gw.usage.search")}
          />
        </div>

        {selected.size > 0 && (
          <div className="gw-usage-bulk">
            <span>
              {t("gw.usage.selected", { n: selected.size })}
            </span>
            <div className="gw-usage-bulk-actions">
              <button
                type="button"
                className="btn secondary btn-sm"
                disabled={busy || patching != null}
                onClick={() => void runBulk("authorized")}>
                {t("gw.usage.bulkAuth")}
              </button>
              <button
                type="button"
                className="btn danger btn-sm"
                disabled={busy || patching != null}
                onClick={() => void runBulk("unauthorized")}>
                {t("gw.usage.bulkUnauth")}
              </button>
              <button
                type="button"
                className="btn secondary btn-sm"
                disabled={busy || patching != null}
                onClick={() => void runBulk("unknown")}>
                {t("gw.usage.bulkUnknown")}
              </button>
            </div>
          </div>
        )}

        {filtered.length === 0 ? (
          <div className="gw-usage-empty">
            <strong>
              {tools.length === 0
                ? t("gw.usage.empty")
                : t("gw.usage.emptyFilter")}
            </strong>
            <p className="muted">{t("gw.usage.emptyHint")}</p>
          </div>
        ) : (
          <div className="gw-usage-list">
            <div className="gw-usage-list-head">
              <label className="gw-usage-check">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={toggleAll}
                  aria-label={t("gw.usage.selectAll")}
                />
              </label>
              <span>{t("gw.usage.col.app")}</span>
              <span className="gw-usage-col-vol">{t("gw.usage.col.volume")}</span>
              <span className="gw-usage-col-agents">{t("gw.usage.col.agents")}</span>
              <span className="gw-usage-col-last">{t("gw.usage.col.last")}</span>
              <span className="gw-usage-col-actions">{t("gw.usage.col.action")}</span>
            </div>
            {filtered.map((tool) => {
              const name = tool.display_name || tool.tool
              const volPct = Math.max(
                4,
                Math.round(((tool.events_count || 0) / maxEvents) * 100)
              )
              const rowBusy = patching === tool.tool || patching === "__bulk__"
              const agentsLive = riskUsersLoaded
                ? agentsForTool(tool.tool).length
                : tool.agents_count
              return (
                <div
                  key={tool.tool}
                  className={`gw-usage-row gw-usage-row--${tool.status} ${
                    selected.has(tool.tool) ? "is-selected" : ""
                  }`}>
                  <label className="gw-usage-check">
                    <input
                      type="checkbox"
                      checked={selected.has(tool.tool)}
                      onChange={() => toggleOne(tool.tool)}
                      aria-label={name}
                    />
                  </label>
                  <button
                    type="button"
                    className="gw-usage-app gw-usage-app--btn"
                    onClick={() => openApp(tool.tool)}>
                    <span
                      className={`gw-usage-avatar gw-usage-avatar--${tool.status}`}
                      aria-hidden>
                      {appInitials(name)}
                    </span>
                    <div className="gw-usage-app-copy">
                      <div className="gw-usage-app-name">
                        <strong>{name}</strong>
                        <span className={`gw-badge gw-badge--${tool.status}`}>
                          {t(`gw.status.${tool.status}`)}
                        </span>
                      </div>
                      <code className="gw-usage-app-id">{tool.tool}</code>
                    </div>
                  </button>
                  <div className="gw-usage-col-vol">
                    <div className="gw-usage-vol">
                      <div className="gw-usage-vol-bar">
                        <span style={{ width: `${volPct}%` }} />
                      </div>
                      <span className="gw-usage-vol-n">
                        {tool.events_count}{" "}
                        <span className="muted">
                          {t("gw.usage.eventsShort")}
                        </span>
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="gw-usage-col-agents gw-usage-col-meta gw-usage-meta-btn"
                    onClick={() => openApp(tool.tool)}>
                    <span className="gw-usage-meta-v">{agentsLive}</span>
                    <span className="muted">{t("gw.usage.agentsShort")}</span>
                  </button>
                  <div className="gw-usage-col-last gw-usage-col-meta">
                    <span className="gw-usage-meta-v">
                      {relativeTime(tool.last_seen_at)}
                    </span>
                    <span className="muted">{t("gw.usage.lastSeen")}</span>
                  </div>
                  <div className="gw-usage-col-actions">
                    <button
                      type="button"
                      className="btn secondary btn-sm"
                      onClick={() => openApp(tool.tool)}>
                      {t("gw.usage.act.inspect")}
                    </button>
                    {tool.status !== "authorized" && (
                      <button
                        type="button"
                        className="btn secondary btn-sm gw-usage-act-ok"
                        disabled={busy || rowBusy}
                        onClick={() => void runPatch(tool.tool, "authorized")}>
                        {t("gw.usage.act.allow")}
                      </button>
                    )}
                    {tool.status !== "unauthorized" && (
                      <button
                        type="button"
                        className="btn danger btn-sm"
                        disabled={busy || rowBusy}
                        onClick={() =>
                          void runPatch(tool.tool, "unauthorized")
                        }>
                        {t("gw.usage.act.deny")}
                      </button>
                    )}
                    {tool.status !== "unknown" && (
                      <button
                        type="button"
                        className="btn secondary btn-sm"
                        disabled={busy || rowBusy}
                        onClick={() => void runPatch(tool.tool, "unknown")}>
                        {t("gw.usage.act.reset")}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

      </div>

      {drill && (
        <UsageDrillDrawer
          t={t}
          period={period}
          drill={drill}
          busy={drillBusy || busy}
          tools={tools}
          events={events}
          highRiskAgents={highRiskAgents}
          agentsForTool={agentsForTool}
          agentDetail={agentDetail}
          restrictiveProfiles={restrictiveProfiles}
          onClose={() => {
            setDrill(null)
            setAgentDetail(null)
          }}
          onOpenApp={openApp}
          onOpenAgent={(id, tool) => void openAgent(id, tool)}
          onBackToApp={(tool) => {
            setAgentDetail(null)
            setDrill({ kind: "app", tool })
          }}
          onPatch={async (tool, status) => {
            await onPatch(tool, status)
          }}
          onWeanProfile={applyWeanProfile}
          onSetAiAccess={setAiAccess}
          aiBlockedMap={aiBlockedMap}
          onOpenRisk={onOpenRisk}
          onOpenEvents={onOpenEvents}
          onOpenIntel={onOpenIntel}
        />
      )}
    </div>
  )
}

function UsageDrillDrawer({
  t,
  period,
  drill,
  busy,
  tools,
  events,
  highRiskAgents,
  agentsForTool,
  agentDetail,
  restrictiveProfiles,
  aiBlockedMap,
  onClose,
  onOpenApp,
  onOpenAgent,
  onBackToApp,
  onPatch,
  onWeanProfile,
  onSetAiAccess,
  onOpenRisk,
  onOpenEvents,
  onOpenIntel
}: {
  t: Props["t"]
  period: Period
  drill: UsageDrill
  busy: boolean
  tools: ShadowTool[]
  events: EventRow[]
  highRiskAgents: RiskUserRow[]
  agentsForTool: (toolId: string) => Array<{
    user: RiskUserRow
    events_on_tool: number
    high_on_tool: number
    bypass_on_tool: number
    last_on_tool: string | null
  }>
  agentDetail: {
    agent_id: string
    user: RiskUserRow | null
    factors: Record<string, number>
    recent: Array<Record<string, unknown>>
  } | null
  restrictiveProfiles: Array<{ id: string; name: string; defaultAction: string }>
  aiBlockedMap: Record<string, boolean>
  onClose: () => void
  onOpenApp: (tool: string) => void
  onOpenAgent: (agentId: string, tool?: string) => void
  onBackToApp: (tool: string) => void
  onPatch: (
    tool: string,
    status: "authorized" | "unauthorized" | "unknown"
  ) => Promise<void>
  onWeanProfile: (agentId: string, profileId: string) => Promise<void>
  onSetAiAccess: (agentId: string, blocked: boolean) => Promise<void>
  onOpenRisk?: () => void
  onOpenEvents?: () => void
  onOpenIntel: () => void
}) {
  const appTool =
    drill.kind === "app"
      ? tools.find((x) => x.tool === drill.tool)
      : drill.kind === "agent" && drill.tool
        ? tools.find((x) => x.tool === drill.tool)
        : null

  const title =
    drill.kind === "app"
      ? t("gw.usage.drill.titleApp", {
          app: appTool?.display_name || drill.tool
        })
      : drill.kind === "highAgents"
        ? t("gw.usage.drill.titleHigh")
        : t("gw.usage.drill.titleAgent", {
            user:
              agentDetail?.user?.label ||
              drill.agentId.slice(0, 12) + "…"
          })

  const agents =
    drill.kind === "app" ? agentsForTool(drill.tool) : []

  const agentEvents = useMemo(() => {
    if (drill.kind !== "agent") return []
    let list = events.filter((e) => e.agent_id === drill.agentId)
    if (drill.tool) {
      const scoped = list.filter((e) =>
        toolKeyMatch(e.hostname || e.source || "", drill.tool || "")
      )
      if (scoped.length) list = scoped
    }
    return list.slice(0, 40)
  }, [drill, events])

  const score = agentDetail?.user?.score ?? 0
  const highRisk = score >= 70
  const mediumRisk = score >= 40 && score < 70
  const agentBlocked =
    drill.kind === "agent" ? !!aiBlockedMap[drill.agentId] : false

  return (
    <div className="gw-drill" role="dialog" aria-modal="true" aria-label={title}>
      <button
        type="button"
        className="gw-drill-backdrop"
        aria-label={t("common.close")}
        onClick={onClose}
      />
      <div className="gw-drill-panel gw-usage-drill">
        <header className="gw-drill-head">
          <div>
            <span className="gw-kicker">{t("gw.usage.drill.kicker")}</span>
            <h3 className="gw-drill-title">{title}</h3>
            <p className="muted gw-drill-sub">
              {drill.kind === "app"
                ? t("gw.usage.drill.subApp")
                : drill.kind === "highAgents"
                  ? t("gw.usage.drill.subHigh")
                  : t("gw.usage.drill.subAgent")}{" "}
              · {t(`gw.period.${period}`)}
              {busy ? ` · ${t("common.loading")}` : ""}
            </p>
          </div>
          <button
            type="button"
            className="btn secondary btn-sm"
            onClick={onClose}>
            {t("common.close")}
          </button>
        </header>

        <div className="gw-drill-body">
          {/* APP → agents */}
          {drill.kind === "app" && appTool && (
            <>
              <div className="gw-usage-drill-appbar">
                <span className={`gw-badge gw-badge--${appTool.status}`}>
                  {t(`gw.status.${appTool.status}`)}
                </span>
                <strong>{appTool.display_name || appTool.tool}</strong>
                <code className="muted">{appTool.tool}</code>
                <div className="gw-usage-drill-appacts">
                  {appTool.status !== "unauthorized" && (
                    <button
                      type="button"
                      className="btn danger btn-sm"
                      disabled={busy}
                      onClick={() =>
                        void onPatch(appTool.tool, "unauthorized")
                      }>
                      {t("gw.usage.act.deny")}
                    </button>
                  )}
                  {appTool.status !== "authorized" && (
                    <button
                      type="button"
                      className="btn secondary btn-sm gw-usage-act-ok"
                      disabled={busy}
                      onClick={() => void onPatch(appTool.tool, "authorized")}>
                      {t("gw.usage.act.allow")}
                    </button>
                  )}
                </div>
              </div>
              <p className="muted" style={{ fontSize: 12, margin: "0 0 10px" }}>
                {t("gw.usage.drill.agentsOnApp", { n: agents.length })}
              </p>
              {agents.length === 0 ? (
                <p className="muted">{t("gw.usage.drill.noAgents")}</p>
              ) : (
                <div className="gw-drill-table-wrap">
                  <table className="gw-drill-table">
                    <thead>
                      <tr>
                        <th>{t("gw.gov.drill.col.user")}</th>
                        <th>{t("gw.gov.drill.col.score")}</th>
                        <th>{t("gw.usage.drill.col.onApp")}</th>
                        <th>{t("gw.data.high")}</th>
                        <th>{t("gw.data.stat.bypass")}</th>
                        <th>{t("gw.gov.drill.col.last")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {agents.map((row) => (
                        <tr
                          key={row.user.agent_id}
                          className="is-click"
                          onClick={() =>
                            onOpenAgent(row.user.agent_id, drill.tool)
                          }>
                          <td>
                            <strong>
                              {row.user.label || row.user.agent_id}
                            </strong>
                            {aiBlockedMap[row.user.agent_id] ? (
                              <span className="gw-badge gw-badge--unauthorized" style={{ marginLeft: 6 }}>
                                {t("gw.usage.wean.badge")}
                              </span>
                            ) : null}
                            <div
                              className="muted mono"
                              style={{ fontSize: 10 }}>
                              {row.user.agent_id.slice(0, 14)}…
                            </div>
                          </td>
                          <td>
                            <span
                              className={`gw-score ${scoreClass(row.user.score)}`}>
                              {Math.round(row.user.score)}
                            </span>
                          </td>
                          <td>{row.events_on_tool}</td>
                          <td
                            className={
                              row.high_on_tool > 0 ? "gw-risk-high" : ""
                            }>
                            {row.high_on_tool}
                          </td>
                          <td
                            className={
                              row.bypass_on_tool > 0 ? "gw-risk-med" : ""
                            }>
                            {row.bypass_on_tool}
                          </td>
                          <td>{relativeTime(row.last_on_tool)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {/* HIGH RISK AGENTS across org */}
          {drill.kind === "highAgents" && (
            <>
              <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
                {t("gw.usage.drill.highIntro")}
              </p>
              {highRiskAgents.length === 0 ? (
                <p className="muted">{t("gw.intel.noUsers")}</p>
              ) : (
                <div className="gw-drill-table-wrap">
                  <table className="gw-drill-table">
                    <thead>
                      <tr>
                        <th>{t("gw.gov.drill.col.user")}</th>
                        <th>{t("gw.gov.drill.col.score")}</th>
                        <th>{t("gw.gov.drill.col.tools")}</th>
                        <th>{t("gw.gov.drill.col.events")}</th>
                        <th>{t("gw.gov.drill.col.last")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {highRiskAgents.map((u) => (
                        <tr
                          key={u.agent_id}
                          className="is-click"
                          onClick={() => onOpenAgent(u.agent_id)}>
                          <td>
                            <strong>{u.label || u.agent_id}</strong>
                            {aiBlockedMap[u.agent_id] ? (
                              <span className="gw-badge gw-badge--unauthorized" style={{ marginLeft: 6 }}>
                                {t("gw.usage.wean.badge")}
                              </span>
                            ) : null}
                          </td>
                          <td>
                            <span className={`gw-score ${scoreClass(u.score)}`}>
                              {Math.round(u.score)}
                            </span>
                          </td>
                          <td className="muted" style={{ fontSize: 11 }}>
                            {(u.tools || []).slice(0, 4).join(", ") || "—"}
                          </td>
                          <td>{u.events_count}</td>
                          <td>{relativeTime(u.last_event_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {/* AGENT detail + sevrage */}
          {drill.kind === "agent" && (
            <>
              {drill.tool && (
                <button
                  type="button"
                  className="btn secondary btn-sm"
                  style={{ marginBottom: 10 }}
                  onClick={() => onBackToApp(drill.tool!)}>
                  ← {t("gw.usage.drill.backApp")}
                </button>
              )}

              <div className="gw-drill-summary">
                <div>
                  <span className="muted">{t("gw.gov.drill.col.score")}</span>
                  <strong className={scoreClass(score)}>
                    {Math.round(score)}/100 · {riskLabel(t, score)}
                  </strong>
                </div>
                <div>
                  <span className="muted">{t("gw.gov.drill.col.trend")}</span>
                  <strong>
                    {trendGlyph(agentDetail?.user?.trend || "flat")}{" "}
                    {t(
                      `gw.intel.userTrend.${agentDetail?.user?.trend || "flat"}`
                    )}
                  </strong>
                </div>
                <div>
                  <span className="muted">{t("gw.gov.drill.col.events")}</span>
                  <strong>{agentDetail?.user?.events_count ?? "—"}</strong>
                </div>
                <div>
                  <span className="muted">{t("gw.gov.drill.col.tools")}</span>
                  <strong style={{ fontSize: 12 }}>
                    {(agentDetail?.user?.tools || []).slice(0, 4).join(", ") ||
                      "—"}
                  </strong>
                </div>
              </div>

              {/* Sevrage IA — kill switch agent */}
              {(highRisk || mediumRisk || agentBlocked) && (
                <div
                  className={`gw-usage-wean gw-usage-wean--${
                    agentBlocked || highRisk ? "danger" : "warn"
                  }`}>
                  <span className="gw-kicker">
                    {t("gw.usage.wean.kicker")}
                  </span>
                  <strong>
                    {agentBlocked
                      ? t("gw.usage.wean.titleBlocked")
                      : highRisk
                        ? t("gw.usage.wean.titleHigh")
                        : t("gw.usage.wean.titleMed")}
                  </strong>
                  <div className="gw-usage-wean-actions">
                    {agentBlocked ? (
                      <button
                        type="button"
                        className="btn btn-sm"
                        disabled={busy}
                        onClick={() =>
                          void onSetAiAccess(drill.agentId, false)
                        }>
                        {t("gw.usage.wean.unblock")}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn danger btn-sm"
                        disabled={busy}
                        onClick={() => {
                          if (
                            typeof window !== "undefined" &&
                            !window.confirm(t("gw.usage.wean.confirmBlock"))
                          ) {
                            return
                          }
                          void onSetAiAccess(drill.agentId, true)
                        }}>
                        {t("gw.usage.wean.block")}
                      </button>
                    )}
                    {drill.tool &&
                      tools.find((x) => x.tool === drill.tool)?.status !==
                        "unauthorized" && (
                        <button
                          type="button"
                          className="btn secondary btn-sm"
                          disabled={busy}
                          onClick={() =>
                            void onPatch(drill.tool!, "unauthorized")
                          }>
                          {t("gw.usage.wean.denyApp")}
                        </button>
                      )}
                    {restrictiveProfiles.length > 0 && (
                      <select
                        className="input"
                        style={{ maxWidth: 200, fontSize: 12 }}
                        defaultValue=""
                        disabled={busy}
                        onChange={(e) => {
                          const id = e.target.value
                          if (!id) return
                          void onWeanProfile(drill.agentId, id)
                          e.target.value = ""
                        }}>
                        <option value="">
                          {t("gw.usage.wean.pickProfile")}
                        </option>
                        {restrictiveProfiles.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} ({p.defaultAction})
                          </option>
                        ))}
                      </select>
                    )}
                    {onOpenRisk && (
                      <button
                        type="button"
                        className="btn secondary btn-sm"
                        onClick={onOpenRisk}>
                        {t("gw.intel.openRisk")}
                      </button>
                    )}
                  </div>
                </div>
              )}

              {Object.keys(agentDetail?.factors || {}).length > 0 && (
                <>
                  <h4 className="gw-usage-drill-h">
                    {t("gw.usage.drill.factors")}
                  </h4>
                  <ul className="gw-drill-factors">
                    {Object.entries(agentDetail!.factors)
                      .filter(([, v]) => Number(v) > 0)
                      .sort((a, b) => Number(b[1]) - Number(a[1]))
                      .map(([k, v]) => (
                        <li key={k}>
                          <code>{k}</code>
                          <strong>{v}</strong>
                        </li>
                      ))}
                  </ul>
                </>
              )}

              <h4 className="gw-usage-drill-h">
                {t("gw.usage.drill.actions")}
                {drill.tool
                  ? ` · ${appTool?.display_name || drill.tool}`
                  : ""}
              </h4>
              {agentEvents.length === 0 &&
              (agentDetail?.recent || []).length === 0 ? (
                <p className="muted">{t("gw.gov.drill.noEvents")}</p>
              ) : (
                <div className="gw-drill-table-wrap">
                  <table className="gw-drill-table">
                    <thead>
                      <tr>
                        <th>{t("gw.gov.drill.col.when")}</th>
                        <th>{t("gw.gov.drill.col.decision")}</th>
                        <th>{t("gw.gov.drill.col.severity")}</th>
                        <th>{t("gw.usage.col.app")}</th>
                        <th>{t("gw.gov.drill.col.types")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(agentEvents.length
                        ? agentEvents.map((e) => ({
                            ts: e.ts,
                            decision: e.decision,
                            sev: e.highest_severity,
                            host: e.hostname || e.source,
                            types: e.types
                          }))
                        : (agentDetail?.recent || []).map((e) => ({
                            ts: String(e.ts || ""),
                            decision: String(e.decision || ""),
                            sev: String(e.highest_severity || ""),
                            host: String(e.hostname || ""),
                            types: Array.isArray(e.types)
                              ? (e.types as string[])
                              : []
                          }))
                      ).map((e, i) => (
                        <tr key={i}>
                          <td>{relativeTime(e.ts)}</td>
                          <td>
                            <code>{e.decision || "—"}</code>
                          </td>
                          <td
                            className={
                              String(e.sev).toLowerCase() === "high"
                                ? "gw-risk-high"
                                : String(e.sev).toLowerCase() === "medium"
                                  ? "gw-risk-med"
                                  : ""
                            }>
                            {e.sev || "—"}
                          </td>
                          <td className="muted" style={{ fontSize: 11 }}>
                            {e.host || "—"}
                          </td>
                          <td className="muted" style={{ fontSize: 11 }}>
                            {(e.types || []).slice(0, 3).join(", ") || "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {(agentDetail?.user?.tools || []).length > 0 && (
                <>
                  <h4 className="gw-usage-drill-h">
                    {t("gw.usage.drill.otherApps")}
                  </h4>
                  <div className="gw-chips">
                    {(agentDetail?.user?.tools || []).map((tool) => (
                      <button
                        key={tool}
                        type="button"
                        className="gw-chip gw-chip--btn"
                        onClick={() => onOpenApp(tool)}>
                        <code>{tool}</code>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </div>

        <footer className="gw-drill-foot">
          <div className="gw-drill-foot-actions">
            {onOpenEvents && (
              <button
                type="button"
                className="btn secondary btn-sm"
                onClick={onOpenEvents}>
                {t("gw.data.openEvents")}
              </button>
            )}
            <button
              type="button"
              className="btn secondary btn-sm"
              onClick={onOpenIntel}>
              {t("gw.gov.cta.intel")}
            </button>
            <button type="button" className="btn btn-sm" onClick={onClose}>
              {t("common.close")}
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}

/** Famille d’actif DLP à partir des rule ids / types d’event (≠ inventaire apps) */
function classifyAssetFamily(types: string[]): "pii" | "secrets" | "business" | "other" {
  const blob = types.join(" ").toLowerCase()
  if (
    /password|passwd|secret|credential|api-key|api_key|token|jwt|ssh|aws|azure|private-key|stripe|openai|anthropic|generic-api/i.test(
      blob
    )
  ) {
    return "secrets"
  }
  if (
    /email|phone|iban|ssn|pii|personal|card|credit|rh|nom|téléphone|phone-number|email-address/i.test(
      blob
    )
  ) {
    return "pii"
  }
  if (
    /file|office|xlsx|docx|pdf|document|contract|code|source|excel|csv|upload/i.test(
      blob
    )
  ) {
    return "business"
  }
  return "other"
}

type DataDrill =
  | { kind: "sensitive" }
  | { kind: "high" }
  | { kind: "medium" }
  | { kind: "low" }
  | { kind: "block" }
  | { kind: "rewrite" }
  | { kind: "mask" }
  | { kind: "bypass" }
  | { kind: "cancel" }
  | { kind: "protected" }
  | { kind: "files" }
  | { kind: "pii" }
  | { kind: "secrets" }
  | { kind: "business" }
  | { kind: "type"; typeId: string }

function filterDataEvents(events: EventRow[], drill: DataDrill): EventRow[] {
  return events.filter((e) => {
    const sev = String(e.highest_severity || "").toLowerCase()
    const d = decisionKind(e.decision || "")
    const types = e.types || []
    const family = classifyAssetFamily(types)
    const hasFile = Array.isArray(e.file_names) && e.file_names.length > 0
    switch (drill.kind) {
      case "sensitive":
        return sev === "high" || sev === "medium" || sev === "low"
      case "high":
        return sev === "high"
      case "medium":
        return sev === "medium"
      case "low":
        return sev === "low"
      case "block":
        return d === "block"
      case "rewrite":
        return d === "rewrite"
      case "mask":
        return d === "mask"
      case "bypass":
        return d === "bypass"
      case "cancel":
        return d === "cancel"
      case "protected":
        return d === "block" || d === "rewrite" || d === "mask" || d === "cancel"
      case "files":
        return hasFile
      case "pii":
        return family === "pii"
      case "secrets":
        return family === "secrets"
      case "business":
        return family === "business" || hasFile
      case "type":
        return types.some(
          (x) =>
            String(x).toLowerCase() === drill.typeId.toLowerCase() ||
            String(x).toLowerCase().includes(drill.typeId.toLowerCase())
        )
      default:
        return false
    }
  })
}

function DataPanel({
  t,
  period,
  eventStats,
  events,
  sensitiveAttempts,
  protectedActions,
  onOpenEvents
}: {
  t: Props["t"]
  period: Period
  eventStats: {
    total: number
    blocked: number
    rewrite: number
    mask: number
    sendAnyway: number
    cancel: number
    high: number
    medium: number
    low: number
  }
  events: EventRow[]
  sensitiveAttempts: number
  protectedActions: number
  summary?: Summary | null
  onOpenEvents?: () => void
}) {
  const [drill, setDrill] = useState<DataDrill | null>(null)

  const protectRate =
    sensitiveAttempts > 0
      ? Math.round((protectedActions / Math.max(sensitiveAttempts, 1)) * 100)
      : protectedActions > 0
        ? 100
        : 0
  const anonymized = eventStats.rewrite + eventStats.mask
  const hardStop = eventStats.blocked + eventStats.cancel
  const bypass = eventStats.sendAnyway

  const dlpStats = useMemo(() => {
    let files = 0
    let pii = 0
    let secrets = 0
    let business = 0
    const typeCounts = new Map<string, number>()
    for (const e of events) {
      if (Array.isArray(e.file_names) && e.file_names.length > 0) files++
      const types = e.types || []
      const fam = classifyAssetFamily(types)
      if (fam === "pii") pii++
      else if (fam === "secrets") secrets++
      else if (fam === "business" || (e.file_names && e.file_names.length))
        business++
      for (const ty of types) {
        const k = String(ty || "").trim()
        if (!k) continue
        typeCounts.set(k, (typeCounts.get(k) || 0) + 1)
      }
    }
    const topTypes = [...typeCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
    return { files, pii, secrets, business, topTypes }
  }, [events])

  const postureTone =
    eventStats.high > 0 || bypass > Math.max(3, protectedActions)
      ? "danger"
      : sensitiveAttempts > 0
        ? "warn"
        : protectedActions > 0
          ? "ok"
          : "neutral"

  const assets = [
    {
      id: "pii" as const,
      icon: "PII",
      title: t("gw.data.pii"),
      ex: t("gw.data.piiEx"),
      count: dlpStats.pii,
      drill: { kind: "pii" as const }
    },
    {
      id: "secrets" as const,
      icon: "KEY",
      title: t("gw.data.secrets"),
      ex: t("gw.data.secretsEx"),
      count: dlpStats.secrets,
      drill: { kind: "secrets" as const }
    },
    {
      id: "business" as const,
      icon: "DOC",
      title: t("gw.data.business"),
      ex: t("gw.data.businessEx"),
      count: dlpStats.business + dlpStats.files,
      drill: { kind: "business" as const }
    }
  ]

  const actionCards: Array<{
    id: string
    label: string
    detail: string
    value: number
    tone: "danger" | "ok" | "warn" | "neutral"
    drill: DataDrill
  }> = [
    {
      id: "block",
      label: t("gw.data.act.block"),
      detail: t("gw.data.act.blockDetail"),
      value: eventStats.blocked,
      tone: "danger",
      drill: { kind: "block" }
    },
    {
      id: "rewrite",
      label: t("gw.data.act.rewrite"),
      detail: t("gw.data.act.rewriteDetail"),
      value: eventStats.rewrite,
      tone: "ok",
      drill: { kind: "rewrite" }
    },
    {
      id: "mask",
      label: t("gw.data.act.mask"),
      detail: t("gw.data.act.maskDetail"),
      value: eventStats.mask,
      tone: "ok",
      drill: { kind: "mask" }
    },
    {
      id: "confirm",
      label: t("gw.data.act.confirm"),
      detail: t("gw.data.act.confirmDetail"),
      value: eventStats.sendAnyway,
      tone: "warn",
      drill: { kind: "bypass" }
    },
    {
      id: "cancel",
      label: t("gw.data.act.cancel"),
      detail: t("gw.data.act.cancelDetail"),
      value: eventStats.cancel,
      tone: "neutral",
      drill: { kind: "cancel" }
    },
    {
      id: "files",
      label: t("gw.data.act.files"),
      detail: t("gw.data.act.filesDetail"),
      value: dlpStats.files,
      tone: "neutral",
      drill: { kind: "files" }
    }
  ]

  const sevMax = Math.max(
    1,
    eventStats.high,
    eventStats.medium,
    eventStats.low
  )
  const maxType = Math.max(1, ...dlpStats.topTypes.map(([, n]) => n))

  const drilled = drill ? filterDataEvents(events, drill).slice(0, 50) : []

  return (
    <div className="gw-panel gw-data">
      <section className={`gw-data-hero gw-data-hero--${postureTone}`}>
        <div className="gw-data-hero-copy">
          <span className="gw-kicker">{t("gw.data.kicker")}</span>
          <h2 className="gw-data-hero-title">{t("gw.data.heroTitle")}</h2>
          <p className="gw-data-hero-lead">
            {postureTone === "danger"
              ? t("gw.data.lead.danger", {
                  high: eventStats.high,
                  bypass
                })
              : postureTone === "warn"
                ? t("gw.data.lead.warn", { n: sensitiveAttempts })
                : postureTone === "ok"
                  ? t("gw.data.lead.ok", { n: protectedActions })
                  : t("gw.data.lead.neutral")}
          </p>
          <div className="gw-data-hero-actions">
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setDrill({ kind: "high" })}>
              {t("gw.data.drill.ctaHigh")}
            </button>
            <button
              type="button"
              className="btn secondary btn-sm"
              onClick={() => setDrill({ kind: "bypass" })}>
              {t("gw.data.drill.ctaBypass")}
            </button>
            <button
              type="button"
              className="btn secondary btn-sm"
              onClick={() => setDrill({ kind: "files" })}>
              {t("gw.data.drill.ctaFiles")}
            </button>
            <span className="gw-data-period muted">
              {t(`gw.period.${period}`)}
            </span>
          </div>
        </div>
        <button
          type="button"
          className="gw-data-rate"
          onClick={() => setDrill({ kind: "protected" })}>
          <div className="gw-usage-coverage-ring">
            <svg viewBox="0 0 36 36" aria-hidden>
              <path
                className="gw-usage-ring-bg"
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
              />
              <path
                className={`gw-data-rate-fg gw-data-rate-fg--${postureTone}`}
                strokeDasharray={`${Math.min(100, protectRate)}, 100`}
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
              />
            </svg>
            <div className="gw-usage-coverage-num">
              <strong>{protectRate}%</strong>
              <span>{t("gw.data.protectRate")}</span>
            </div>
          </div>
          <p className="gw-data-rate-hint">
            {t("gw.data.protectRateHint", {
              protected: protectedActions,
              attempts: sensitiveAttempts
            })}
          </p>
        </button>
      </section>

      {/* Scénario DLP uniquement (pas Usage) */}
      <div className="gw-data-scenario">
        <div className="gw-data-scenario-col">
          <span className="gw-data-scenario-l">{t("gw.data.scenario.user")}</span>
          <p>{t("gw.data.scenario.userLine")}</p>
        </div>
        <span className="gw-data-scenario-arrow" aria-hidden>
          →
        </span>
        <div className="gw-data-scenario-col gw-data-scenario-col--ok">
          <span className="gw-data-scenario-l">{t("gw.data.scenario.gate")}</span>
          <p>{t("gw.data.scenario.gateLine")}</p>
        </div>
      </div>

      {/* KPIs DLP — cliquables */}
      <div className="gw-data-stats">
        <button
          type="button"
          className="gw-data-stat"
          onClick={() => setDrill({ kind: "sensitive" })}>
          <span className="gw-data-stat-l">{t("gw.data.attempts")}</span>
          <span className="gw-data-stat-v">{sensitiveAttempts}</span>
          <span className="gw-data-stat-h">{t("gw.data.stat.attemptsHint")}</span>
        </button>
        <button
          type="button"
          className="gw-data-stat gw-data-stat--danger"
          onClick={() => setDrill({ kind: "high" })}>
          <span className="gw-data-stat-l">{t("gw.data.high")}</span>
          <span className="gw-data-stat-v">{eventStats.high}</span>
          <span className="gw-data-stat-h">{t("gw.data.stat.highHint")}</span>
        </button>
        <button
          type="button"
          className="gw-data-stat gw-data-stat--ok"
          onClick={() => setDrill({ kind: "block" })}>
          <span className="gw-data-stat-l">{t("gw.data.stat.hardStop")}</span>
          <span className="gw-data-stat-v">{hardStop}</span>
          <span className="gw-data-stat-h">{t("gw.data.stat.hardStopHint")}</span>
        </button>
        <button
          type="button"
          className="gw-data-stat gw-data-stat--ok"
          onClick={() => setDrill({ kind: "rewrite" })}>
          <span className="gw-data-stat-l">{t("gw.data.stat.anonymized")}</span>
          <span className="gw-data-stat-v">{anonymized}</span>
          <span className="gw-data-stat-h">{t("gw.data.stat.anonymizedHint")}</span>
        </button>
        <button
          type="button"
          className="gw-data-stat gw-data-stat--warn"
          onClick={() => setDrill({ kind: "bypass" })}>
          <span className="gw-data-stat-l">{t("gw.data.stat.bypass")}</span>
          <span className="gw-data-stat-v">{bypass}</span>
          <span className="gw-data-stat-h">{t("gw.data.stat.bypassHint")}</span>
        </button>
        <button
          type="button"
          className="gw-data-stat"
          onClick={() => setDrill({ kind: "files" })}>
          <span className="gw-data-stat-l">{t("gw.data.stat.files")}</span>
          <span className="gw-data-stat-v">{dlpStats.files}</span>
          <span className="gw-data-stat-h">{t("gw.data.stat.filesHint")}</span>
        </button>
      </div>

      <div className="gw-data-mid">
        <div className="gw-card">
          <div className="gw-card-head">
            <h3>{t("gw.data.assets")}</h3>
          </div>
          <div className="gw-data-assets">
            {assets.map((a) => (
              <button
                key={a.id}
                type="button"
                className={`gw-data-asset gw-data-asset--${a.id} gw-data-asset--btn`}
                onClick={() => setDrill(a.drill)}>
                <span className="gw-data-asset-icon" aria-hidden>
                  {a.icon}
                </span>
                <div>
                  <strong>
                    {a.title}{" "}
                    <em className="gw-data-asset-count">{a.count}</em>
                  </strong>
                  <p className="muted">{a.ex}</p>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="gw-card">
          <div className="gw-card-head">
            <h3>{t("gw.data.severityTitle")}</h3>
          </div>
          <div className="gw-data-sev-list">
            {(
              [
                ["high", eventStats.high, "high", { kind: "high" as const }],
                [
                  "medium",
                  eventStats.medium,
                  "med",
                  { kind: "medium" as const }
                ],
                ["low", eventStats.low, "low", { kind: "low" as const }]
              ] as const
            ).map(([key, n, tone, d]) => (
              <button
                key={key}
                type="button"
                className="gw-data-sev-row gw-data-sev-row--btn"
                onClick={() => setDrill(d)}>
                <div className="gw-data-sev-label">
                  <span
                    className={`gw-dot gw-dot--${
                      tone === "high"
                        ? "danger"
                        : tone === "med"
                          ? "warn"
                          : "ok"
                    }`}
                  />
                  <strong>
                    {key === "high"
                      ? t("gw.data.high")
                      : key === "medium"
                        ? t("gw.data.medium")
                        : t("gw.risk.low")}
                  </strong>
                </div>
                <div className="gw-data-sev-bar">
                  <i
                    className={`gw-gov-sev-fill gw-gov-sev-fill--${tone}`}
                    style={{
                      width: `${Math.max(
                        n > 0 ? 6 : 0,
                        Math.round((n / sevMax) * 100)
                      )}%`
                    }}
                  />
                </div>
                <strong className="gw-data-sev-n">{n}</strong>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="gw-card">
        <div className="gw-card-head">
          <h3>{t("gw.data.actions")}</h3>
        </div>
        <div className="gw-data-actions">
          {actionCards.map((a) => (
            <button
              key={a.id}
              type="button"
              className={`gw-data-action gw-data-action--${a.tone} gw-data-action--btn`}
              onClick={() => setDrill(a.drill)}>
              <span className="gw-data-action-v">{a.value}</span>
              <strong>{a.label}</strong>
              <span className="muted">{a.detail}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Types de détection — cœur DLP, pas apps */}
      <div className="gw-card">
        <div className="gw-card-head">
          <h3>{t("gw.data.typesTitle")}</h3>
        </div>
        {dlpStats.topTypes.length === 0 ? (
          <p className="muted gw-data-empty">{t("gw.data.noTypes")}</p>
        ) : (
          <ul className="gw-data-decisions">
            {dlpStats.topTypes.map(([k, v]) => (
              <li key={k}>
                <button
                  type="button"
                  className="gw-data-type-row"
                  onClick={() => setDrill({ kind: "type", typeId: k })}>
                  <code>{k}</code>
                  <div className="gw-usage-vol-bar">
                    <span
                      style={{
                        width: `${Math.max(4, Math.round((v / maxType) * 100))}%`
                      }}
                    />
                  </div>
                  <strong>{v}</strong>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {drill && (
        <div
          className="gw-drill"
          role="dialog"
          aria-modal="true"
          aria-label={t("gw.data.drill.kicker")}>
          <button
            type="button"
            className="gw-drill-backdrop"
            aria-label={t("common.close")}
            onClick={() => setDrill(null)}
          />
          <div className="gw-drill-panel">
            <header className="gw-drill-head">
              <div>
                <span className="gw-kicker">{t("gw.data.drill.kicker")}</span>
                <h3 className="gw-drill-title">
                  {drill.kind === "type"
                    ? t("gw.data.drill.titleType", { type: drill.typeId })
                    : t(`gw.data.drill.title.${drill.kind}`)}
                </h3>
                <p className="muted gw-drill-sub">
                  {t("gw.data.drill.sub")} · {t(`gw.period.${period}`)} ·{" "}
                  {drilled.length} {t("gw.data.drill.rows")}
                </p>
              </div>
              <button
                type="button"
                className="btn secondary btn-sm"
                onClick={() => setDrill(null)}>
                {t("common.close")}
              </button>
            </header>
            <div className="gw-drill-body">
              {drilled.length === 0 ? (
                <p className="muted">{t("gw.gov.drill.noEvents")}</p>
              ) : (
                <div className="gw-drill-table-wrap">
                  <table className="gw-drill-table">
                    <thead>
                      <tr>
                        <th>{t("gw.gov.drill.col.when")}</th>
                        <th>{t("gw.gov.drill.col.device")}</th>
                        <th>{t("gw.gov.drill.col.decision")}</th>
                        <th>{t("gw.gov.drill.col.severity")}</th>
                        <th>{t("gw.gov.drill.col.types")}</th>
                        <th>{t("gw.data.drill.col.files")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {drilled.map((e) => (
                        <tr key={e.id}>
                          <td>{relativeTime(e.ts)}</td>
                          <td>
                            <strong>
                              {e.device_label || e.hostname || "—"}
                            </strong>
                          </td>
                          <td>
                            <code>{e.decision || "—"}</code>
                          </td>
                          <td
                            className={
                              String(e.highest_severity).toLowerCase() ===
                              "high"
                                ? "gw-risk-high"
                                : String(e.highest_severity).toLowerCase() ===
                                    "medium"
                                  ? "gw-risk-med"
                                  : ""
                            }>
                            {e.highest_severity || "—"}
                          </td>
                          <td className="muted" style={{ fontSize: 11 }}>
                            {(e.types || []).slice(0, 4).join(", ") || "—"}
                          </td>
                          <td className="muted" style={{ fontSize: 11 }}>
                            {(e.file_names || []).slice(0, 2).join(", ") || "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <footer className="gw-drill-foot">
              <div className="gw-drill-foot-actions">
                {onOpenEvents && (
                  <button
                    type="button"
                    className="btn secondary btn-sm"
                    onClick={onOpenEvents}>
                    {t("gw.data.openEvents")}
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => setDrill(null)}>
                  {t("common.close")}
                </button>
              </div>
            </footer>
          </div>
        </div>
      )}
    </div>
  )
}

type CompDrill =
  | "coverage"
  | "journal"
  | "sensitive"
  | "blocked"
  | "protected"
  | "violations"
  | "bypass"
  | "risk"
  | "audit"
  | "integrity"
  | "exports"

type AuditRow = {
  id: string
  adminEmail?: string
  adminLabel?: string
  action: string
  detail?: string
  createdAt: string
  seq?: number
  entry_hash?: string
}

function CompliancePanel({
  t,
  period,
  summary,
  risk,
  avgRisk,
  riskDelta,
  eventStats,
  events,
  tools,
  shadowCounts,
  sensitiveAttempts,
  protectedActions,
  riskUsersSeed,
  setError,
  onOpenAudit,
  onOpenReports,
  onOpenEvents,
  onOpenUsage,
  onOpenData
}: {
  t: Props["t"]
  period: Period
  summary: Summary | null
  risk: RiskSummary | null
  avgRisk: number
  riskDelta: number | null
  eventStats: {
    total: number
    blocked: number
    rewrite: number
    mask: number
    sendAnyway: number
    cancel: number
    high: number
    medium: number
    low: number
  }
  events: EventRow[]
  tools: ShadowTool[]
  shadowCounts: ShadowCounts | null
  sensitiveAttempts: number
  protectedActions: number
  riskUsersSeed?: RiskUserRow[]
  setError: (e: string | null) => void
  onOpenAudit?: () => void
  onOpenReports?: () => void
  onOpenEvents?: () => void
  onOpenUsage: () => void
  onOpenData: () => void
}) {
  const [drill, setDrill] = useState<CompDrill | null>(null)
  const [auditRows, setAuditRows] = useState<AuditRow[]>([])
  const [auditMeta, setAuditMeta] = useState<{
    worm?: boolean
    legal_retention_days?: number
  }>({})
  const [integrity, setIntegrity] = useState<{
    ok: boolean
    checked: number
    with_hash: number
    without_hash: number
    broken_reason?: string
    tip?: string
  } | null>(null)
  const [riskUsers, setRiskUsers] = useState<RiskUserRow[]>(
    () => riskUsersSeed || []
  )
  const [busy, setBusy] = useState(false)

  const monthLabel = new Date().toLocaleString(undefined, {
    month: "long",
    year: "numeric"
  })
  const generatedAt = new Date().toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  })

  const usersMonitored =
    risk?.users_count ?? summary?.users_count ?? summary?.agents ?? 0
  const violations = shadowCounts?.unauthorized ?? 0
  const anonymized = eventStats.rewrite + eventStats.mask
  const score = Math.round(avgRisk)
  const riskTone =
    score >= 70 ? "danger" : score >= 40 ? "warn" : score > 0 ? "ok" : "neutral"

  const protectRate =
    sensitiveAttempts > 0
      ? Math.round((protectedActions / Math.max(sensitiveAttempts, 1)) * 100)
      : protectedActions > 0
        ? 100
        : 0

  const controlScore = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        (protectRate * 0.35 +
          (violations === 0 ? 100 : Math.max(0, 100 - violations * 12)) * 0.25 +
          (eventStats.sendAnyway === 0
            ? 100
            : Math.max(0, 100 - eventStats.sendAnyway * 8)) *
            0.2 +
          (100 - Math.min(100, score)) * 0.2)
      )
    )
  )
  const controlTone =
    controlScore >= 75 ? "ok" : controlScore >= 50 ? "warn" : "danger"

  const unauthTools = useMemo(
    () => tools.filter((x) => x.status === "unauthorized"),
    [tools]
  )

  const openDrill = useCallback(
    async (id: CompDrill) => {
      setDrill(id)
      if (id === "audit" || id === "integrity" || id === "exports") {
        setBusy(true)
        try {
          if (id === "audit") {
            const r = await api.audit()
            setAuditRows((r.events || []) as AuditRow[])
            setAuditMeta({
              worm: r.worm,
              legal_retention_days: r.legal_retention_days
            })
          } else if (id === "integrity") {
            const r = await api.auditIntegrity()
            setIntegrity({
              ok: r.ok,
              checked: r.checked,
              with_hash: r.with_hash,
              without_hash: r.without_hash,
              broken_reason: r.broken_reason,
              tip: r.tip
            })
          }
        } catch (e) {
          setError(String(e))
          if (id === "audit") setAuditRows([])
          if (id === "integrity") setIntegrity(null)
        } finally {
          setBusy(false)
        }
      }
      if (id === "coverage" || id === "risk") {
        if (riskUsersSeed?.length) {
          setRiskUsers(
            id === "risk"
              ? riskUsersSeed.filter((u) => u.score >= 40)
              : riskUsersSeed
          )
          return
        }
        setBusy(true)
        try {
          const r = await api.riskUsers({
            period,
            min_score: id === "risk" ? 40 : 0,
            limit: 100
          })
          setRiskUsers((r.users || []) as RiskUserRow[])
        } catch (e) {
          setError(String(e))
          setRiskUsers([])
        } finally {
          setBusy(false)
        }
      }
    },
    [period, setError, riskUsersSeed]
  )

  const checklist: Array<{
    id: CompDrill | "check"
    ok: boolean
    label: string
    detail: string
    drill: CompDrill
  }> = [
    {
      id: "events",
      ok: eventStats.total > 0,
      label: t("gw.comp.check.events"),
      detail: t("gw.comp.check.eventsDetail", { n: eventStats.total }),
      drill: "journal"
    },
    {
      id: "protect",
      ok: protectedActions > 0 || sensitiveAttempts === 0,
      label: t("gw.comp.check.protect"),
      detail: t("gw.comp.check.protectDetail", {
        n: protectedActions,
        pct: protectRate
      }),
      drill: "protected"
    },
    {
      id: "violations",
      ok: violations === 0,
      label: t("gw.comp.check.violations"),
      detail: t("gw.comp.check.violationsDetail", { n: violations }),
      drill: "violations"
    },
    {
      id: "bypass",
      ok: eventStats.sendAnyway === 0,
      label: t("gw.comp.check.bypass"),
      detail: t("gw.comp.check.bypassDetail", { n: eventStats.sendAnyway }),
      drill: "bypass"
    },
    {
      id: "risk",
      ok: score < 70,
      label: t("gw.comp.check.risk"),
      detail: t("gw.comp.check.riskDetail", {
        label: riskLabel(t, avgRisk),
        n: score
      }),
      drill: "risk"
    },
    {
      id: "exports",
      ok: true,
      label: t("gw.comp.check.exports"),
      detail: t("gw.comp.check.exportsDetail"),
      drill: "exports"
    }
  ]
  const checksOk = checklist.filter((c) => c.ok).length

  const reportLines: Array<{
    key: CompDrill
    label: string
    value: string
    tone?: string
  }> = [
    {
      key: "coverage",
      label: t("gw.compliance.usersMonitored"),
      value: String(usersMonitored || "—")
    },
    {
      key: "journal",
      label: t("gw.compliance.interactions"),
      value: String(eventStats.total)
    },
    {
      key: "sensitive",
      label: t("gw.compliance.sensitive"),
      value: String(sensitiveAttempts)
    },
    {
      key: "blocked",
      label: t("gw.compliance.blocked"),
      value: String(eventStats.blocked)
    },
    {
      key: "protected",
      label: t("gw.compliance.rewrite"),
      value: String(anonymized)
    },
    {
      key: "violations",
      label: t("gw.compliance.violations"),
      value: String(violations),
      tone: violations > 0 ? "gw-risk-high" : "gw-ok"
    },
    {
      key: "protected",
      label: t("gw.compliance.protected"),
      value: String(protectedActions),
      tone: "gw-ok"
    },
    {
      key: "risk",
      label: t("gw.compliance.riskEvo"),
      value:
        riskDelta != null
          ? `${riskDelta > 0 ? "↑" : riskDelta < 0 ? "↓" : "→"} ${Math.abs(riskDelta)}%`
          : `${riskLabel(t, avgRisk)} (${score}/100)`,
      tone:
        riskDelta != null
          ? riskDelta < 0
            ? "gw-ok"
            : riskDelta > 0
              ? "gw-risk-high"
              : ""
          : scoreClass(avgRisk)
    }
  ]

  const evidenceCards = [
    {
      id: "report" as const,
      title: t("gw.comp.ev.report"),
      detail: t("gw.comp.ev.reportDetail"),
      cta: t("gw.compliance.openReports"),
      primary: true,
      onClick: () => void openDrill("exports")
    },
    {
      id: "audit" as const,
      title: t("gw.comp.ev.audit"),
      detail: t("gw.comp.ev.auditDetail"),
      cta: t("gw.comp.drill.viewAudit"),
      primary: false,
      onClick: () => void openDrill("audit")
    },
    {
      id: "integrity" as const,
      title: t("gw.comp.ev.integrity"),
      detail: t("gw.comp.ev.integrityDetail"),
      cta: t("gw.comp.drill.viewIntegrity"),
      primary: false,
      onClick: () => void openDrill("integrity")
    },
    {
      id: "journal" as const,
      title: t("gw.comp.ev.events"),
      detail: t("gw.comp.ev.eventsDetail"),
      cta: t("gw.comp.drill.viewJournal"),
      primary: false,
      onClick: () => void openDrill("journal")
    }
  ]

  const evidenceEvents = useMemo(() => {
    if (!drill) return []
    if (drill === "journal") return events.slice(0, 40)
    if (drill === "sensitive") {
      return events
        .filter((e) => {
          const s = String(e.highest_severity || "").toLowerCase()
          return s === "high" || s === "medium" || s === "low"
        })
        .slice(0, 40)
    }
    if (drill === "blocked") {
      return events
        .filter((e) => decisionKind(e.decision) === "block")
        .slice(0, 40)
    }
    if (drill === "protected") {
      return events
        .filter((e) => {
          const d = decisionKind(e.decision)
          return d === "block" || d === "rewrite" || d === "mask" || d === "cancel"
        })
        .slice(0, 40)
    }
    if (drill === "bypass") {
      return events
        .filter((e) => decisionKind(e.decision) === "bypass")
        .slice(0, 40)
    }
    return []
  }, [drill, events])

  return (
    <div className="gw-panel gw-comp">
      <section className={`gw-comp-hero gw-comp-hero--${controlTone}`}>
        <div className="gw-comp-hero-copy">
          <span className="gw-kicker">{t("gw.comp.kicker")}</span>
          <h2 className="gw-comp-hero-title">{t("gw.comp.heroTitle")}</h2>
          <p className="gw-comp-hero-lead">
            {controlTone === "danger"
              ? t("gw.comp.lead.danger")
              : controlTone === "warn"
                ? t("gw.comp.lead.warn")
                : t("gw.comp.lead.ok")}
          </p>
          <div className="gw-comp-hero-actions">
            {onOpenReports && (
              <button
                type="button"
                className="btn btn-sm"
                onClick={onOpenReports}>
                {t("gw.comp.cta.export")}
              </button>
            )}
            <button
              type="button"
              className="btn secondary btn-sm"
              onClick={() => void openDrill("audit")}>
              {t("gw.comp.drill.viewAudit")}
            </button>
            <button
              type="button"
              className="btn secondary btn-sm"
              onClick={() => void openDrill("integrity")}>
              {t("gw.comp.drill.viewIntegrity")}
            </button>
          </div>
        </div>
        <button
          type="button"
          className="gw-comp-control"
          onClick={() => void openDrill("risk")}>
          <div className="gw-usage-coverage-ring">
            <svg viewBox="0 0 36 36" aria-hidden>
              <path
                className="gw-usage-ring-bg"
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
              />
              <path
                className={`gw-comp-control-fg gw-comp-control-fg--${controlTone}`}
                strokeDasharray={`${controlScore}, 100`}
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
              />
            </svg>
            <div className="gw-usage-coverage-num">
              <strong>{controlScore}</strong>
              <span>{t("gw.comp.controlScore")}</span>
            </div>
          </div>
          <p className="gw-comp-control-hint">
            {t("gw.comp.controlHint", { ok: checksOk, total: checklist.length })}
          </p>
        </button>
      </section>

      <div className="gw-comp-stats">
        {(
          [
            ["coverage", t("gw.compliance.usersMonitored"), usersMonitored || "—", ""],
            ["journal", t("gw.compliance.interactions"), eventStats.total, ""],
            ["sensitive", t("gw.compliance.sensitive"), sensitiveAttempts, ""],
            [
              "violations",
              t("gw.compliance.violations"),
              violations,
              violations > 0 ? "gw-comp-stat--danger" : "gw-comp-stat--ok"
            ],
            [
              "risk",
              t("gw.compliance.riskEvo"),
              riskDelta != null
                ? `${riskDelta > 0 ? "↑" : riskDelta < 0 ? "↓" : "→"}${Math.abs(riskDelta)}%`
                : riskLabel(t, avgRisk),
              `gw-comp-stat--${riskTone}`
            ],
            [
              "protected",
              t("gw.compliance.protected"),
              protectedActions,
              "gw-comp-stat--ok"
            ]
          ] as const
        ).map(([key, label, value, cls]) => (
          <button
            key={key}
            type="button"
            className={`gw-comp-stat ${cls}`}
            onClick={() => void openDrill(key)}>
            <span className="gw-comp-stat-l">{label}</span>
            <span
              className={`gw-comp-stat-v ${
                key === "risk" ? scoreClass(avgRisk) : ""
              }`}>
              {value}
            </span>
          </button>
        ))}
      </div>

      <article className="gw-comp-report">
        <header className="gw-comp-report-head">
          <div>
            <span className="gw-kicker">{t("gw.compliance.reportKicker")}</span>
            <h2 className="gw-comp-report-title">
              {t("gw.compliance.reportTitle", { month: monthLabel })}
            </h2>
            <p className="gw-comp-report-meta muted">
              {t("gw.comp.reportMeta", {
                period: t(`gw.period.${period}`),
                at: generatedAt
              })}
            </p>
          </div>
          <div className="gw-comp-report-stamp">
            <span
              className={`gw-badge gw-comp-stamp gw-comp-stamp--${controlTone}`}>
              {t(`gw.comp.stamp.${controlTone}`)}
            </span>
            <span className="muted">{t("gw.comp.confidential")}</span>
          </div>
        </header>

        <div className="gw-comp-report-body">
          {reportLines.map((line, i) => (
            <button
              key={`${line.key}-${i}`}
              type="button"
              className="gw-comp-report-line gw-comp-report-line--btn"
              onClick={() => void openDrill(line.key)}>
              <span className="gw-comp-report-label">{line.label}</span>
              <span className="gw-comp-report-dots" aria-hidden />
              <strong className={`gw-comp-report-value ${line.tone || ""}`}>
                {line.value}
              </strong>
            </button>
          ))}
        </div>

        <div className="gw-comp-report-summary">
          <div>
            <strong>{t("gw.comp.narrativeTitle")}</strong>
            <p className="muted">
              {t("gw.comp.narrative", {
                users: usersMonitored || 0,
                interactions: eventStats.total,
                protected: protectedActions,
                violations,
                risk: riskLabel(t, avgRisk)
              })}
            </p>
          </div>
          <div className="gw-comp-report-actions">
            {onOpenReports && (
              <button
                type="button"
                className="btn btn-sm"
                onClick={onOpenReports}>
                {t("gw.comp.cta.pdf")}
              </button>
            )}
            <button
              type="button"
              className="btn secondary btn-sm"
              onClick={() => void openDrill("journal")}>
              {t("gw.comp.drill.viewJournal")}
            </button>
          </div>
        </div>
        <p className="gw-comp-report-foot muted">{t("gw.compliance.proof")}</p>
      </article>

      <div className="gw-comp-mid">
        <div className="gw-card">
          <div className="gw-card-head">
            <h3>{t("gw.comp.checklistTitle")}</h3>
            <span className="gw-badge gw-badge--authorized">
              {checksOk}/{checklist.length}
            </span>
          </div>
          <ul className="gw-comp-check">
            {checklist.map((c) => (
              <li key={c.id} className={c.ok ? "is-ok" : "is-ko"}>
                <button
                  type="button"
                  className="gw-comp-check-btn"
                  onClick={() => void openDrill(c.drill)}>
                  <span className="gw-comp-check-mark" aria-hidden>
                    {c.ok ? "✓" : "!"}
                  </span>
                  <div>
                    <strong>{c.label}</strong>
                    <p className="muted">{c.detail}</p>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="gw-card">
          <div className="gw-card-head">
            <h3>{t("gw.comp.evidenceTitle")}</h3>
          </div>
          <div className="gw-comp-evidence">
            {evidenceCards.map((e) => (
              <div key={e.id} className="gw-comp-ev-card">
                <strong>{e.title}</strong>
                <p className="muted">{e.detail}</p>
                <button
                  type="button"
                  className={`btn btn-sm ${e.primary ? "" : "secondary"}`}
                  onClick={e.onClick}>
                  {e.cta}
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="gw-comp-board">
        <div>
          <span className="gw-kicker">{t("gw.comp.boardKicker")}</span>
          <strong>{t("gw.comp.boardTitle")}</strong>
          <p className="muted">{t("gw.comp.boardDetail")}</p>
        </div>
        {onOpenReports && (
          <button type="button" className="btn btn-sm" onClick={onOpenReports}>
            {t("gw.comp.cta.board")}
          </button>
        )}
      </div>

      {drill && (
        <div
          className="gw-drill"
          role="dialog"
          aria-modal="true"
          aria-label={t("gw.comp.drill.kicker")}>
          <button
            type="button"
            className="gw-drill-backdrop"
            aria-label={t("common.close")}
            onClick={() => setDrill(null)}
          />
          <div className="gw-drill-panel">
            <header className="gw-drill-head">
              <div>
                <span className="gw-kicker">{t("gw.comp.drill.kicker")}</span>
                <h3 className="gw-drill-title">
                  {t(`gw.comp.drill.title.${drill}`)}
                </h3>
                <p className="muted gw-drill-sub">
                  {t(`gw.comp.drill.sub.${drill}`)} · {t(`gw.period.${period}`)}
                  {busy ? ` · ${t("common.loading")}` : ""}
                </p>
              </div>
              <button
                type="button"
                className="btn secondary btn-sm"
                onClick={() => setDrill(null)}>
                {t("common.close")}
              </button>
            </header>
            <div className="gw-drill-body">
              {(drill === "coverage" || drill === "risk") && (
                <>
                  {riskUsers.length === 0 ? (
                    <p className="muted">{t("gw.intel.noUsers")}</p>
                  ) : (
                    <div className="gw-drill-table-wrap">
                      <table className="gw-drill-table">
                        <thead>
                          <tr>
                            <th>{t("gw.gov.drill.col.user")}</th>
                            <th>{t("gw.gov.drill.col.score")}</th>
                            <th>{t("gw.gov.drill.col.events")}</th>
                            <th>{t("gw.gov.drill.col.last")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {riskUsers.slice(0, 40).map((u) => (
                            <tr key={u.agent_id}>
                              <td>
                                <strong>{u.label || u.agent_id}</strong>
                              </td>
                              <td>
                                <span
                                  className={`gw-score ${scoreClass(u.score)}`}>
                                  {Math.round(u.score)}
                                </span>
                              </td>
                              <td>{u.events_count}</td>
                              <td>{relativeTime(u.last_event_at)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}

              {(drill === "journal" ||
                drill === "sensitive" ||
                drill === "blocked" ||
                drill === "protected" ||
                drill === "bypass") && (
                <>
                  {evidenceEvents.length === 0 ? (
                    <p className="muted">{t("gw.gov.drill.noEvents")}</p>
                  ) : (
                    <div className="gw-drill-table-wrap">
                      <table className="gw-drill-table">
                        <thead>
                          <tr>
                            <th>{t("gw.gov.drill.col.when")}</th>
                            <th>{t("gw.gov.drill.col.device")}</th>
                            <th>{t("gw.gov.drill.col.decision")}</th>
                            <th>{t("gw.gov.drill.col.severity")}</th>
                            <th>{t("gw.gov.drill.col.types")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {evidenceEvents.map((e) => (
                            <tr key={e.id}>
                              <td>{relativeTime(e.ts)}</td>
                              <td>
                                <strong>
                                  {e.device_label || e.hostname || "—"}
                                </strong>
                              </td>
                              <td>
                                <code>{e.decision || "—"}</code>
                              </td>
                              <td>{e.highest_severity || "—"}</td>
                              <td className="muted" style={{ fontSize: 11 }}>
                                {(e.types || []).slice(0, 3).join(", ") || "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}

              {drill === "violations" && (
                <>
                  {unauthTools.length === 0 ? (
                    <p className="muted">{t("gw.comp.drill.noViolations")}</p>
                  ) : (
                    <div className="gw-drill-table-wrap">
                      <table className="gw-drill-table">
                        <thead>
                          <tr>
                            <th>{t("gw.usage.col.app")}</th>
                            <th>{t("gw.usage.col.events")}</th>
                            <th>{t("gw.usage.col.agents")}</th>
                            <th>{t("gw.usage.col.last")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {unauthTools.map((tool) => (
                            <tr key={tool.tool}>
                              <td>
                                <strong>
                                  {tool.display_name || tool.tool}
                                </strong>
                                <div className="muted" style={{ fontSize: 10 }}>
                                  {tool.tool}
                                </div>
                              </td>
                              <td>{tool.events_count}</td>
                              <td>{tool.agents_count}</td>
                              <td>{relativeTime(tool.last_seen_at)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}

              {drill === "audit" && (
                <>
                  <div className="gw-drill-summary">
                    <div>
                      <span className="muted">WORM</span>
                      <strong>
                        {auditMeta.worm ? t("common.yes") : t("common.no")}
                      </strong>
                    </div>
                    <div>
                      <span className="muted">
                        {t("gw.comp.drill.retention")}
                      </span>
                      <strong>
                        {auditMeta.legal_retention_days != null
                          ? `${auditMeta.legal_retention_days} j`
                          : "—"}
                      </strong>
                    </div>
                  </div>
                  {auditRows.length === 0 ? (
                    <p className="muted">{t("gw.comp.drill.noAudit")}</p>
                  ) : (
                    <div className="gw-drill-table-wrap">
                      <table className="gw-drill-table">
                        <thead>
                          <tr>
                            <th>{t("gw.gov.drill.col.when")}</th>
                            <th>{t("gw.comp.drill.col.admin")}</th>
                            <th>{t("gw.comp.drill.col.action")}</th>
                            <th>{t("gw.comp.drill.col.detail")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {auditRows.slice(0, 50).map((row) => (
                            <tr key={row.id}>
                              <td>{relativeTime(row.createdAt)}</td>
                              <td>
                                <strong>
                                  {row.adminLabel || row.adminEmail || "—"}
                                </strong>
                              </td>
                              <td>
                                <code>{row.action}</code>
                              </td>
                              <td className="muted" style={{ fontSize: 11 }}>
                                {(row.detail || "—").slice(0, 80)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}

              {drill === "integrity" && (
                <div className="gw-comp-integrity">
                  {integrity == null ? (
                    <p className="muted">{t("common.loading")}</p>
                  ) : (
                    <>
                      <div
                        className={`gw-comp-integrity-badge ${
                          integrity.ok ? "is-ok" : "is-ko"
                        }`}>
                        {integrity.ok
                          ? t("gw.comp.drill.integrityOk")
                          : t("gw.comp.drill.integrityKo")}
                      </div>
                      <ul className="gw-bullets">
                        <li>
                          {t("gw.comp.drill.integrityChecked")} ·{" "}
                          <strong>{integrity.checked}</strong>
                        </li>
                        <li>
                          {t("gw.comp.drill.integrityHashed")} ·{" "}
                          <strong>{integrity.with_hash}</strong>
                        </li>
                        <li>
                          {t("gw.comp.drill.integrityPlain")} ·{" "}
                          <strong>{integrity.without_hash}</strong>
                        </li>
                        {integrity.broken_reason ? (
                          <li className="gw-risk-high">
                            {integrity.broken_reason}
                          </li>
                        ) : null}
                        {integrity.tip ? (
                          <li className="muted">{integrity.tip}</li>
                        ) : null}
                      </ul>
                    </>
                  )}
                </div>
              )}

              {drill === "exports" && (
                <div className="gw-comp-exports">
                  <p>{t("gw.comp.drill.exportsBody")}</p>
                  <div className="gw-usage-wean-actions">
                    {onOpenReports && (
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={onOpenReports}>
                        {t("gw.comp.cta.pdf")}
                      </button>
                    )}
                    {onOpenEvents && (
                      <button
                        type="button"
                        className="btn secondary btn-sm"
                        onClick={onOpenEvents}>
                        {t("gw.compliance.openEvents")}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
            <footer className="gw-drill-foot">
              <div className="gw-drill-foot-actions">
                {drill === "violations" && (
                  <button
                    type="button"
                    className="btn secondary btn-sm"
                    onClick={onOpenUsage}>
                    {t("gw.gov.cta.usage")}
                  </button>
                )}
                {(drill === "sensitive" ||
                  drill === "blocked" ||
                  drill === "protected" ||
                  drill === "bypass") && (
                  <button
                    type="button"
                    className="btn secondary btn-sm"
                    onClick={onOpenData}>
                    {t("gw.gov.cta.data")}
                  </button>
                )}
                {drill === "audit" && onOpenAudit && (
                  <button
                    type="button"
                    className="btn secondary btn-sm"
                    onClick={onOpenAudit}>
                    {t("gw.compliance.openAudit")}
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => setDrill(null)}>
                  {t("common.close")}
                </button>
              </div>
            </footer>
          </div>
        </div>
      )}
    </div>
  )
}

type IntelDrill =
  | { kind: "trend" }
  | { kind: "users"; minScore: number; band: "high" | "med" | "low" | "all" }
  | { kind: "agent"; agentId: string }
  | { kind: "emerging" }
  | { kind: "signal"; signal: "high" | "bypass" | "unauth" | "unknown" }
  | { kind: "radar" }

function IntelligencePanel({
  t,
  period,
  risk,
  avgRisk,
  riskDelta,
  tools,
  unauthorizedTools,
  unknownTools,
  eventStats,
  events,
  riskUsersSeed,
  setError,
  setInfo,
  onOpenRisk,
  onOpenShadow,
  onOpenUsage,
  onOpenData,
  onOpenCompliance
}: {
  t: Props["t"]
  period: Period
  risk: RiskSummary | null
  avgRisk: number
  riskDelta: number | null
  tools: ShadowTool[]
  unauthorizedTools: ShadowTool[]
  unknownTools: ShadowTool[]
  eventStats: {
    total: number
    high: number
    medium: number
    low: number
    sendAnyway: number
  }
  events: EventRow[]
  riskUsersSeed?: RiskUserRow[]
  setError: (e: string | null) => void
  setInfo: (i: string | null) => void
  onOpenRisk?: () => void
  onOpenShadow?: () => void
  onOpenUsage: () => void
  onOpenData: () => void
  onOpenCompliance: () => void
}) {
  const [drill, setDrill] = useState<IntelDrill | null>(null)
  const [riskUsers, setRiskUsers] = useState<RiskUserRow[]>(
    () => riskUsersSeed || []
  )
  const [busy, setBusy] = useState(false)
  const [aiBlockedMap, setAiBlockedMap] = useState<Record<string, boolean>>({})
  const [agentDetail, setAgentDetail] = useState<{
    agent_id: string
    user: RiskUserRow | null
    factors: Record<string, number>
    recent: Array<Record<string, unknown>>
  } | null>(null)

  const score = Math.round(avgRisk)
  const riskTone =
    score >= 70 ? "danger" : score >= 40 ? "warn" : score > 0 ? "ok" : "neutral"
  const emergingCount = unknownTools.length + unauthorizedTools.length
  const highUsers = risk?.high_risk_users ?? 0
  const medUsers = risk?.medium_risk_users ?? 0
  const lowUsers = risk?.low_risk_users ?? 0
  const usersTotal = risk?.users_count ?? highUsers + medUsers + lowUsers
  const userDistMax = Math.max(1, highUsers, medUsers, lowUsers)
  const signalTotal =
    eventStats.high + eventStats.sendAnyway + unauthorizedTools.length

  const emerging = useMemo(() => {
    return [...tools]
      .filter((x) => x.status === "unknown" || x.status === "unauthorized")
      .sort((a, b) => (b.events_count || 0) - (a.events_count || 0))
      .slice(0, 12)
  }, [tools])

  // Seed cache + ai_access map (évite re-fetch riskUsers si parent a déjà chargé)
  useEffect(() => {
    let cancelled = false
    if (riskUsersSeed?.length) setRiskUsers(riskUsersSeed)
    setBusy(true)
    void (async () => {
      try {
        const needUsers = !riskUsersSeed?.length
        const [ru, ag] = await Promise.all([
          needUsers
            ? api.riskUsers({ period, min_score: 0, limit: 200 })
            : Promise.resolve(null),
          api.agents().catch(() => null)
        ])
        if (cancelled) return
        if (ru?.users) setRiskUsers((ru.users || []) as RiskUserRow[])
        if (ag?.agents) {
          const map: Record<string, boolean> = {}
          for (const a of ag.agents) {
            map[a.id] =
              a.ai_access_blocked === true || a.ai_access === "blocked"
          }
          setAiBlockedMap(map)
        }
      } catch (e) {
        if (!cancelled) setError(String(e))
      } finally {
        if (!cancelled) setBusy(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [period, setError, riskUsersSeed])

  const sortedUsers = useMemo(
    () => [...riskUsers].sort((a, b) => b.score - a.score),
    [riskUsers]
  )
  const topUsers = useMemo(() => {
    if (sortedUsers.length) return sortedUsers.slice(0, 8)
    return (risk?.top_risk_users || []).map(
      (u) =>
        ({
          agent_id: u.agent_id,
          label: u.label,
          score: u.score,
          score_previous: null,
          trend: u.trend,
          factors: {},
          tools: [],
          events_count: 0,
          last_event_at: null
        }) as RiskUserRow
    )
  }, [sortedUsers, risk])
  const maxUserScore = Math.max(1, ...topUsers.map((u) => u.score || 0), score)

  const openUsers = (band: "high" | "med" | "low" | "all") => {
    const min =
      band === "high" ? 70 : band === "med" ? 40 : band === "low" ? 0 : 0
    setAgentDetail(null)
    setDrill({ kind: "users", minScore: min, band })
  }

  const openAgent = async (agentId: string) => {
    setDrill({ kind: "agent", agentId })
    setBusy(true)
    try {
      const d = (await api.riskUserDetail(agentId, period)) as Record<
        string,
        unknown
      >
      const user =
        (d.user as RiskUserRow | undefined) ||
        riskUsers.find((u) => u.agent_id === agentId) ||
        null
      setAgentDetail({
        agent_id: agentId,
        user,
        factors: (user?.factors as Record<string, number>) || {},
        recent: Array.isArray(d.recent_events)
          ? (d.recent_events as Array<Record<string, unknown>>)
          : []
      })
    } catch (e) {
      setError(String(e))
      setAgentDetail({
        agent_id: agentId,
        user: riskUsers.find((u) => u.agent_id === agentId) || null,
        factors: {},
        recent: []
      })
    } finally {
      setBusy(false)
    }
  }

  const setAiAccess = async (agentId: string, blocked: boolean) => {
    setBusy(true)
    try {
      await api.setAgentAiAccess(agentId, blocked)
      setAiBlockedMap((m) => ({ ...m, [agentId]: blocked }))
      setInfo(
        blocked ? t("gw.usage.wean.blockOk") : t("gw.usage.wean.unblockOk")
      )
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  const filteredUsers = useMemo(() => {
    if (!drill || drill.kind !== "users") return []
    if (drill.band === "high") return sortedUsers.filter((u) => u.score >= 70)
    if (drill.band === "med")
      return sortedUsers.filter((u) => u.score >= 40 && u.score < 70)
    if (drill.band === "low") return sortedUsers.filter((u) => u.score < 40)
    return sortedUsers
  }, [drill, sortedUsers])

  const signalEvents = useMemo(() => {
    if (!drill || drill.kind !== "signal") return []
    if (drill.signal === "high") {
      return events
        .filter((e) => String(e.highest_severity).toLowerCase() === "high")
        .slice(0, 40)
    }
    if (drill.signal === "bypass") {
      return events
        .filter((e) => decisionKind(e.decision) === "bypass")
        .slice(0, 40)
    }
    return []
  }, [drill, events])

  const insights = useMemo(() => {
    const items: Array<{
      title: string
      detail: string
      cta: string
      drill: IntelDrill
      tone: "danger" | "warn" | "ok" | "neutral"
    }> = []
    if (unauthorizedTools.length > 0) {
      items.push({
        title: t("gw.intel.rec.unauth"),
        detail: t("gw.intel.rec.unauthDetail", {
          n: unauthorizedTools.length
        }),
        cta: t("gw.intel.drill.inspect"),
        drill: { kind: "signal", signal: "unauth" },
        tone: "danger"
      })
    }
    if (highUsers > 0) {
      items.push({
        title: t("gw.intel.rec.highUsers"),
        detail: t("gw.intel.rec.highUsersDetail", { n: highUsers }),
        cta: t("gw.intel.drill.inspect"),
        drill: { kind: "users", minScore: 70, band: "high" },
        tone: "danger"
      })
    }
    if (eventStats.high > 0) {
      items.push({
        title: t("gw.intel.rec.highDet"),
        detail: t("gw.intel.rec.highDetDetail", { n: eventStats.high }),
        cta: t("gw.intel.drill.inspect"),
        drill: { kind: "signal", signal: "high" },
        tone: "warn"
      })
    }
    if (eventStats.sendAnyway > 0) {
      items.push({
        title: t("gw.intel.rec.bypass"),
        detail: t("gw.intel.rec.bypassDetail", { n: eventStats.sendAnyway }),
        cta: t("gw.intel.drill.inspect"),
        drill: { kind: "signal", signal: "bypass" },
        tone: "warn"
      })
    }
    if (unknownTools.length > 0) {
      items.push({
        title: t("gw.intel.rec.unknown"),
        detail: t("gw.intel.rec.unknownDetail", { n: unknownTools.length }),
        cta: t("gw.intel.drill.inspect"),
        drill: { kind: "signal", signal: "unknown" },
        tone: "warn"
      })
    }
    if (items.length === 0) {
      items.push({
        title: t("gw.intel.rec.ok"),
        detail: t("gw.intel.rec.okDetail"),
        cta: t("gw.intel.drill.inspect"),
        drill: { kind: "trend" },
        tone: "ok"
      })
    }
    return items.slice(0, 5)
  }, [
    unauthorizedTools.length,
    highUsers,
    eventStats.high,
    eventStats.sendAnyway,
    unknownTools.length,
    t
  ])

  const trendLabel =
    riskDelta != null
      ? riskDelta > 0
        ? t("gw.intel.trend.up", { n: Math.abs(riskDelta) })
        : riskDelta < 0
          ? t("gw.intel.trend.down", { n: Math.abs(riskDelta) })
          : t("gw.intel.trend.flat")
      : t("gw.intel.trend.na")

  const agentScore = agentDetail?.user?.score ?? 0
  const agentBlocked =
    drill?.kind === "agent" ? !!aiBlockedMap[drill.agentId] : false

  return (
    <div className="gw-panel gw-intel">
      <section className={`gw-intel-hero gw-intel-hero--${riskTone}`}>
        <div className="gw-intel-hero-copy">
          <span className="gw-kicker">{t("gw.intel.kicker")}</span>
          <h2 className="gw-intel-hero-title">{t("gw.intel.heroTitle")}</h2>
          <p className="gw-intel-hero-lead">
            {riskTone === "danger"
              ? t("gw.intel.lead.danger")
              : riskTone === "warn"
                ? t("gw.intel.lead.warn")
                : riskTone === "ok"
                  ? t("gw.intel.lead.ok")
                  : t("gw.intel.lead.neutral")}
          </p>
          <div className="gw-intel-hero-actions">
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => openUsers("high")}>
              {t("gw.intel.drill.ctaHighUsers")}
            </button>
            <button
              type="button"
              className="btn secondary btn-sm"
              onClick={() => setDrill({ kind: "radar" })}>
              {t("gw.intel.drill.ctaRadar")}
            </button>
            <button
              type="button"
              className="btn secondary btn-sm"
              onClick={() => setDrill({ kind: "emerging" })}>
              {t("gw.intel.drill.ctaEmerging")}
            </button>
            <span className="muted" style={{ fontSize: 12 }}>
              {t(`gw.period.${period}`)}
            </span>
          </div>
        </div>
        <button
          type="button"
          className="gw-intel-gauge"
          onClick={() => setDrill({ kind: "trend" })}>
          <div className="gw-usage-coverage-ring">
            <svg viewBox="0 0 36 36" aria-hidden>
              <path
                className="gw-usage-ring-bg"
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
              />
              <path
                className={`gw-gov-gauge-fg gw-gov-gauge-fg--${riskTone}`}
                strokeDasharray={`${Math.min(100, Math.max(0, score))}, 100`}
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
              />
            </svg>
            <div className="gw-usage-coverage-num">
              <strong className={scoreClass(avgRisk)}>{score}</strong>
              <span>/100</span>
            </div>
          </div>
          <div className="gw-intel-gauge-meta">
            <span
              className={`gw-badge gw-gov-risk-badge gw-gov-risk-badge--${riskTone}`}>
              {riskLabel(t, avgRisk)}
            </span>
            <span className="muted">{trendLabel}</span>
          </div>
        </button>
      </section>

      <div className="gw-intel-stats">
        <button
          type="button"
          className={`gw-intel-stat gw-intel-stat--${riskTone}`}
          onClick={() => setDrill({ kind: "trend" })}>
          <span className="gw-intel-stat-l">{t("gw.intel.orgScore")}</span>
          <span className={`gw-intel-stat-v ${scoreClass(avgRisk)}`}>
            {score}
          </span>
          <span className="gw-intel-stat-h">{trendLabel}</span>
        </button>
        <button
          type="button"
          className="gw-intel-stat gw-intel-stat--danger"
          onClick={() => openUsers("high")}>
          <span className="gw-intel-stat-l">{t("gw.intel.highUsers")}</span>
          <span className="gw-intel-stat-v">{highUsers}</span>
          <span className="gw-intel-stat-h">
            {t("gw.intel.stat.usersTotal", { n: usersTotal })}
          </span>
        </button>
        <button
          type="button"
          className="gw-intel-stat gw-intel-stat--warn"
          onClick={() => setDrill({ kind: "emerging" })}>
          <span className="gw-intel-stat-l">{t("gw.intel.emerging")}</span>
          <span className="gw-intel-stat-v">{emergingCount}</span>
          <span className="gw-intel-stat-h">
            {t("gw.intel.stat.appsTotal", { n: tools.length })}
          </span>
        </button>
        <button
          type="button"
          className="gw-intel-stat"
          onClick={() => setDrill({ kind: "radar" })}>
          <span className="gw-intel-stat-l">{t("gw.intel.stat.signals")}</span>
          <span className="gw-intel-stat-v">{signalTotal}</span>
          <span className="gw-intel-stat-h">{t("gw.intel.stat.signalsHint")}</span>
        </button>
      </div>

      <div className="gw-card">
        <div className="gw-card-head">
          <h3>{t("gw.intel.radarTitle")}</h3>
        </div>
        <div className="gw-intel-radar">
          {(
            [
              ["high", eventStats.high, "danger", "highHint"],
              ["bypass", eventStats.sendAnyway, "warn", "bypassHint"],
              [
                "unauth",
                unauthorizedTools.length,
                unauthorizedTools.length ? "danger" : "ok",
                "unauthHint"
              ],
              [
                "unknown",
                unknownTools.length,
                unknownTools.length ? "warn" : "ok",
                "unknownHint"
              ]
            ] as const
          ).map(([id, value, tone, hintKey]) => (
            <button
              key={id}
              type="button"
              className={`gw-intel-signal gw-intel-signal--${tone}`}
              onClick={() =>
                setDrill({
                  kind: "signal",
                  signal: id
                })
              }>
              <span className="gw-intel-signal-v">{value}</span>
              <strong>
                {id === "high"
                  ? t("gw.intel.signal.high")
                  : id === "bypass"
                    ? t("gw.intel.signal.sendAnyway")
                    : id === "unauth"
                      ? t("gw.intel.signal.unauth")
                      : t("gw.intel.signal.unknown")}
              </strong>
              <span className="muted">{t(`gw.intel.signal.${hintKey}`)}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="gw-card">
        <div className="gw-card-head">
          <h3>{t("gw.intel.distTitle")}</h3>
          <button
            type="button"
            className="btn secondary btn-sm"
            onClick={() => openUsers("all")}>
            {t("gw.intel.drill.allUsers")}
          </button>
        </div>
        <div className="gw-intel-dist">
          {(
            [
              ["high", highUsers, "high"],
              ["med", medUsers, "med"],
              ["low", lowUsers, "low"]
            ] as const
          ).map(([key, n, tone]) => (
            <button
              key={key}
              type="button"
              className="gw-intel-dist-row gw-intel-dist-row--btn"
              onClick={() => openUsers(key)}>
              <span>
                {key === "high"
                  ? t("gw.risk.high")
                  : key === "med"
                    ? t("gw.risk.medium")
                    : t("gw.risk.low")}
              </span>
              <div className="gw-data-sev-bar">
                <i
                  className={`gw-gov-sev-fill gw-gov-sev-fill--${tone}`}
                  style={{
                    width: `${Math.max(
                      n > 0 ? 6 : 0,
                      Math.round((n / userDistMax) * 100)
                    )}%`
                  }}
                />
              </div>
              <strong>{n}</strong>
            </button>
          ))}
        </div>
      </div>

      <div className="gw-intel-mid">
        <div className="gw-card">
          <div className="gw-card-head">
            <h3>{t("gw.intel.topUsers")}</h3>
            <button
              type="button"
              className="btn secondary btn-sm"
              onClick={() => openUsers("high")}>
              {t("gw.intel.drill.inspect")}
            </button>
          </div>
          {topUsers.length === 0 ? (
            <p className="muted gw-intel-empty">{t("gw.intel.noUsers")}</p>
          ) : (
            <ul className="gw-intel-users">
              {topUsers.map((u, i) => (
                <li key={u.agent_id}>
                  <button
                    type="button"
                    className="gw-intel-user-btn"
                    onClick={() => void openAgent(u.agent_id)}>
                    <span className="gw-rank-i">{i + 1}</span>
                    <div className="gw-intel-user-body">
                      <div className="gw-intel-user-top">
                        <strong>{u.label || u.agent_id}</strong>
                        <span className={`gw-score ${scoreClass(u.score)}`}>
                          {Math.round(u.score)}
                        </span>
                      </div>
                      <div className="gw-usage-vol-bar">
                        <span
                          style={{
                            width: `${Math.max(
                              6,
                              Math.round((u.score / maxUserScore) * 100)
                            )}%`
                          }}
                        />
                      </div>
                      <span className="muted" style={{ fontSize: 11 }}>
                        {trendGlyph(u.trend)}{" "}
                        {t(`gw.intel.userTrend.${u.trend}`)}
                        {aiBlockedMap[u.agent_id]
                          ? ` · ${t("gw.usage.wean.badge")}`
                          : ""}
                      </span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="gw-card">
          <div className="gw-card-head">
            <h3>{t("gw.intel.emergingApps")}</h3>
            <button
              type="button"
              className="btn secondary btn-sm"
              onClick={() => setDrill({ kind: "emerging" })}>
              {t("gw.intel.drill.inspect")}
            </button>
          </div>
          {emerging.length === 0 ? (
            <p className="muted gw-intel-empty">{t("gw.intel.noEmerging")}</p>
          ) : (
            <ul className="gw-intel-apps">
              {emerging.slice(0, 6).map((tool) => {
                const name = tool.display_name || tool.tool
                return (
                  <li key={tool.tool}>
                    <button
                      type="button"
                      className="gw-intel-app-btn"
                      onClick={() => setDrill({ kind: "emerging" })}>
                      <span
                        className={`gw-usage-avatar gw-usage-avatar--${tool.status}`}
                        aria-hidden>
                        {appInitials(name)}
                      </span>
                      <div className="gw-intel-app-body">
                        <div className="gw-gov-app-top">
                          <strong>{name}</strong>
                          <span className={`gw-badge gw-badge--${tool.status}`}>
                            {t(`gw.status.${tool.status}`)}
                          </span>
                        </div>
                        <span className="muted" style={{ fontSize: 11 }}>
                          {tool.events_count} {t("gw.usage.eventsShort")} ·{" "}
                          {tool.agents_count} {t("gw.usage.agentsShort")} ·{" "}
                          {relativeTime(tool.last_seen_at)}
                        </span>
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>

      <div className="gw-intel-ops">
        <div className="gw-intel-ops-head">
          <div>
            <span className="gw-kicker">OpsInsight</span>
            <h3>{t("gw.intel.opsInsight")}</h3>
          </div>
        </div>
        <div className="gw-intel-recs">
          {insights.map((rec, i) => (
            <div
              key={i}
              className={`gw-intel-rec gw-intel-rec--${rec.tone}`}>
              <div>
                <strong>{rec.title}</strong>
                <p className="muted">{rec.detail}</p>
              </div>
              <button
                type="button"
                className="btn secondary btn-sm"
                onClick={() => {
                  setAgentDetail(null)
                  setDrill(rec.drill)
                }}>
                {rec.cta}
              </button>
            </div>
          ))}
        </div>
      </div>

      {drill && (
        <div
          className="gw-drill"
          role="dialog"
          aria-modal="true"
          aria-label={t("gw.intel.drill.kicker")}>
          <button
            type="button"
            className="gw-drill-backdrop"
            aria-label={t("common.close")}
            onClick={() => {
              setDrill(null)
              setAgentDetail(null)
            }}
          />
          <div className="gw-drill-panel">
            <header className="gw-drill-head">
              <div>
                <span className="gw-kicker">{t("gw.intel.drill.kicker")}</span>
                <h3 className="gw-drill-title">
                  {drill.kind === "users"
                    ? t(`gw.intel.drill.title.users_${drill.band}`)
                    : drill.kind === "signal"
                      ? t(`gw.intel.drill.title.signal_${drill.signal}`)
                      : drill.kind === "agent"
                        ? t("gw.intel.drill.title.agent", {
                            user:
                              agentDetail?.user?.label ||
                              drill.agentId.slice(0, 12)
                          })
                        : t(`gw.intel.drill.title.${drill.kind}`)}
                </h3>
                <p className="muted gw-drill-sub">
                  {t("gw.intel.drill.sub")} · {t(`gw.period.${period}`)}
                  {busy ? ` · ${t("common.loading")}` : ""}
                </p>
              </div>
              <button
                type="button"
                className="btn secondary btn-sm"
                onClick={() => {
                  setDrill(null)
                  setAgentDetail(null)
                }}>
                {t("common.close")}
              </button>
            </header>
            <div className="gw-drill-body">
              {drill.kind === "trend" && (
                <div className="gw-drill-summary">
                  <div>
                    <span className="muted">{t("gw.intel.orgScore")}</span>
                    <strong className={scoreClass(avgRisk)}>
                      {score}/100 · {riskLabel(t, avgRisk)}
                    </strong>
                  </div>
                  <div>
                    <span className="muted">{t("gw.compliance.riskEvo")}</span>
                    <strong>{trendLabel}</strong>
                  </div>
                  <div>
                    <span className="muted">{t("gw.intel.highUsers")}</span>
                    <strong>{highUsers}</strong>
                  </div>
                  <div>
                    <span className="muted">{t("gw.intel.stat.signals")}</span>
                    <strong>{signalTotal}</strong>
                  </div>
                </div>
              )}

              {(drill.kind === "users" || drill.kind === "radar") && (
                <>
                  {drill.kind === "radar" && (
                    <div className="gw-drill-summary" style={{ marginBottom: 12 }}>
                      <div>
                        <span className="muted">{t("gw.intel.signal.high")}</span>
                        <strong>{eventStats.high}</strong>
                      </div>
                      <div>
                        <span className="muted">
                          {t("gw.intel.signal.sendAnyway")}
                        </span>
                        <strong>{eventStats.sendAnyway}</strong>
                      </div>
                      <div>
                        <span className="muted">
                          {t("gw.intel.signal.unauth")}
                        </span>
                        <strong>{unauthorizedTools.length}</strong>
                      </div>
                      <div>
                        <span className="muted">
                          {t("gw.intel.signal.unknown")}
                        </span>
                        <strong>{unknownTools.length}</strong>
                      </div>
                    </div>
                  )}
                  {(drill.kind === "users" ? filteredUsers : sortedUsers.slice(0, 30))
                    .length === 0 ? (
                    <p className="muted">{t("gw.intel.noUsers")}</p>
                  ) : (
                    <div className="gw-drill-table-wrap">
                      <table className="gw-drill-table">
                        <thead>
                          <tr>
                            <th>{t("gw.gov.drill.col.user")}</th>
                            <th>{t("gw.gov.drill.col.score")}</th>
                            <th>{t("gw.gov.drill.col.trend")}</th>
                            <th>{t("gw.gov.drill.col.tools")}</th>
                            <th>{t("gw.gov.drill.col.events")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(drill.kind === "users"
                            ? filteredUsers
                            : sortedUsers
                          )
                            .slice(0, 40)
                            .map((u) => (
                              <tr
                                key={u.agent_id}
                                className="is-click"
                                onClick={() => void openAgent(u.agent_id)}>
                                <td>
                                  <strong>{u.label || u.agent_id}</strong>
                                  {aiBlockedMap[u.agent_id] ? (
                                    <span
                                      className="gw-badge gw-badge--unauthorized"
                                      style={{ marginLeft: 6 }}>
                                      {t("gw.usage.wean.badge")}
                                    </span>
                                  ) : null}
                                </td>
                                <td>
                                  <span
                                    className={`gw-score ${scoreClass(u.score)}`}>
                                    {Math.round(u.score)}
                                  </span>
                                </td>
                                <td>
                                  {trendGlyph(u.trend)}{" "}
                                  {t(`gw.intel.userTrend.${u.trend}`)}
                                </td>
                                <td className="muted" style={{ fontSize: 11 }}>
                                  {(u.tools || []).slice(0, 3).join(", ") || "—"}
                                </td>
                                <td>{u.events_count}</td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}

              {drill.kind === "emerging" && (
                <>
                  {emerging.length === 0 ? (
                    <p className="muted">{t("gw.intel.noEmerging")}</p>
                  ) : (
                    <div className="gw-drill-table-wrap">
                      <table className="gw-drill-table">
                        <thead>
                          <tr>
                            <th>{t("gw.usage.col.app")}</th>
                            <th>{t("gw.usage.col.status")}</th>
                            <th>{t("gw.usage.col.events")}</th>
                            <th>{t("gw.usage.col.agents")}</th>
                            <th>{t("gw.usage.col.last")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {emerging.map((tool) => (
                            <tr key={tool.tool}>
                              <td>
                                <strong>
                                  {tool.display_name || tool.tool}
                                </strong>
                              </td>
                              <td>
                                <span
                                  className={`gw-badge gw-badge--${tool.status}`}>
                                  {t(`gw.status.${tool.status}`)}
                                </span>
                              </td>
                              <td>{tool.events_count}</td>
                              <td>{tool.agents_count}</td>
                              <td>{relativeTime(tool.last_seen_at)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}

              {drill.kind === "signal" &&
                (drill.signal === "high" || drill.signal === "bypass") && (
                  <>
                    {signalEvents.length === 0 ? (
                      <p className="muted">{t("gw.gov.drill.noEvents")}</p>
                    ) : (
                      <div className="gw-drill-table-wrap">
                        <table className="gw-drill-table">
                          <thead>
                            <tr>
                              <th>{t("gw.gov.drill.col.when")}</th>
                              <th>{t("gw.gov.drill.col.device")}</th>
                              <th>{t("gw.gov.drill.col.decision")}</th>
                              <th>{t("gw.gov.drill.col.severity")}</th>
                              <th>{t("gw.gov.drill.col.types")}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {signalEvents.map((e) => (
                              <tr key={e.id}>
                                <td>{relativeTime(e.ts)}</td>
                                <td>
                                  <strong>
                                    {e.device_label || e.hostname || "—"}
                                  </strong>
                                </td>
                                <td>
                                  <code>{e.decision || "—"}</code>
                                </td>
                                <td>{e.highest_severity || "—"}</td>
                                <td className="muted" style={{ fontSize: 11 }}>
                                  {(e.types || []).slice(0, 3).join(", ") || "—"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </>
                )}

              {drill.kind === "signal" &&
                (drill.signal === "unauth" || drill.signal === "unknown") && (
                  <>
                    <div className="gw-drill-table-wrap">
                      <table className="gw-drill-table">
                        <thead>
                          <tr>
                            <th>{t("gw.usage.col.app")}</th>
                            <th>{t("gw.usage.col.status")}</th>
                            <th>{t("gw.usage.col.events")}</th>
                            <th>{t("gw.usage.col.agents")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(drill.signal === "unauth"
                            ? unauthorizedTools
                            : unknownTools
                          ).map((tool) => (
                            <tr key={tool.tool}>
                              <td>
                                <strong>
                                  {tool.display_name || tool.tool}
                                </strong>
                              </td>
                              <td>
                                <span
                                  className={`gw-badge gw-badge--${tool.status}`}>
                                  {t(`gw.status.${tool.status}`)}
                                </span>
                              </td>
                              <td>{tool.events_count}</td>
                              <td>{tool.agents_count}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}

              {drill.kind === "agent" && agentDetail && (
                <>
                  <div className="gw-drill-summary">
                    <div>
                      <span className="muted">{t("gw.gov.drill.col.score")}</span>
                      <strong className={scoreClass(agentScore)}>
                        {Math.round(agentScore)}/100
                      </strong>
                    </div>
                    <div>
                      <span className="muted">{t("gw.gov.drill.col.trend")}</span>
                      <strong>
                        {trendGlyph(agentDetail.user?.trend || "flat")}{" "}
                        {t(
                          `gw.intel.userTrend.${agentDetail.user?.trend || "flat"}`
                        )}
                      </strong>
                    </div>
                    <div>
                      <span className="muted">{t("gw.gov.drill.col.events")}</span>
                      <strong>
                        {agentDetail.user?.events_count ?? "—"}
                      </strong>
                    </div>
                    <div>
                      <span className="muted">{t("gw.gov.drill.col.tools")}</span>
                      <strong style={{ fontSize: 12 }}>
                        {(agentDetail.user?.tools || [])
                          .slice(0, 4)
                          .join(", ") || "—"}
                      </strong>
                    </div>
                  </div>

                  {(agentScore >= 40 || agentBlocked) && (
                    <div
                      className={`gw-usage-wean gw-usage-wean--${
                        agentBlocked || agentScore >= 70 ? "danger" : "warn"
                      }`}>
                      <span className="gw-kicker">
                        {t("gw.usage.wean.kicker")}
                      </span>
                      <strong>
                        {agentBlocked
                          ? t("gw.usage.wean.titleBlocked")
                          : t("gw.usage.wean.titleHigh")}
                      </strong>
                      <div className="gw-usage-wean-actions">
                        {agentBlocked ? (
                          <button
                            type="button"
                            className="btn btn-sm"
                            disabled={busy}
                            onClick={() =>
                              void setAiAccess(drill.agentId, false)
                            }>
                            {t("gw.usage.wean.unblock")}
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn danger btn-sm"
                            disabled={busy}
                            onClick={() => {
                              if (
                                !window.confirm(t("gw.usage.wean.confirmBlock"))
                              )
                                return
                              void setAiAccess(drill.agentId, true)
                            }}>
                            {t("gw.usage.wean.block")}
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn secondary btn-sm"
                          onClick={onOpenUsage}>
                          {t("gw.gov.cta.usage")}
                        </button>
                      </div>
                    </div>
                  )}

                  {Object.keys(agentDetail.factors).length > 0 && (
                    <>
                      <h4 className="gw-usage-drill-h">
                        {t("gw.usage.drill.factors")}
                      </h4>
                      <ul className="gw-drill-factors">
                        {Object.entries(agentDetail.factors)
                          .filter(([, v]) => Number(v) > 0)
                          .sort((a, b) => Number(b[1]) - Number(a[1]))
                          .map(([k, v]) => (
                            <li key={k}>
                              <code>{k}</code>
                              <strong>{v}</strong>
                            </li>
                          ))}
                      </ul>
                    </>
                  )}

                  {(agentDetail.recent || []).length > 0 && (
                    <>
                      <h4 className="gw-usage-drill-h">
                        {t("gw.usage.drill.actions")}
                      </h4>
                      <div className="gw-drill-table-wrap">
                        <table className="gw-drill-table">
                          <thead>
                            <tr>
                              <th>{t("gw.gov.drill.col.when")}</th>
                              <th>{t("gw.gov.drill.col.decision")}</th>
                              <th>{t("gw.gov.drill.col.severity")}</th>
                              <th>{t("gw.gov.drill.col.source")}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {agentDetail.recent.slice(0, 20).map((e, i) => (
                              <tr key={i}>
                                <td>
                                  {relativeTime(String(e.ts || ""))}
                                </td>
                                <td>
                                  <code>{String(e.decision || "—")}</code>
                                </td>
                                <td>
                                  {String(e.highest_severity || "—")}
                                </td>
                                <td className="muted" style={{ fontSize: 11 }}>
                                  {String(e.hostname || "—")}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
            <footer className="gw-drill-foot">
              <div className="gw-drill-foot-actions">
                {drill.kind === "emerging" ||
                (drill.kind === "signal" &&
                  (drill.signal === "unauth" || drill.signal === "unknown")) ? (
                  <button
                    type="button"
                    className="btn secondary btn-sm"
                    onClick={onOpenUsage}>
                    {t("gw.gov.cta.usage")}
                  </button>
                ) : null}
                {drill.kind === "signal" &&
                (drill.signal === "high" || drill.signal === "bypass") ? (
                  <button
                    type="button"
                    className="btn secondary btn-sm"
                    onClick={onOpenData}>
                    {t("gw.gov.cta.data")}
                  </button>
                ) : null}
                {drill.kind === "trend" ? (
                  <button
                    type="button"
                    className="btn secondary btn-sm"
                    onClick={onOpenCompliance}>
                    {t("gw.gov.cta.compliance")}
                  </button>
                ) : null}
                {onOpenRisk && (
                  <button
                    type="button"
                    className="btn secondary btn-sm"
                    onClick={onOpenRisk}>
                    {t("gw.intel.openRisk")}
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    setDrill(null)
                    setAgentDetail(null)
                  }}>
                  {t("common.close")}
                </button>
              </div>
            </footer>
          </div>
        </div>
      )}
    </div>
  )
}


