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

  const load = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const [sum, riskSum, shadowRaw, evRaw] = await Promise.all([
        api.summary().catch(() => null),
        fetchRiskSummary(period),
        api.shadowAi({ period, status: "all" }).catch(() => null),
        api.events().catch(() => null)
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
          shadowCounts={shadowCounts}
          sensitiveAttempts={sensitiveAttempts}
          protectedActions={protectedActions}
          onOpenAudit={onOpenAudit}
          onOpenReports={onOpenReports}
          onOpenEvents={onOpenEvents}
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
          <span className="muted" style={{ fontSize: 12 }}>
            {t("gw.gov.questionsHintLive")}
          </span>
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

      <div className="gw-gov-promise">
        <div>
          <strong>{t("gw.promise")}</strong>
          <p className="muted">{t("gw.promiseDetail")}</p>
        </div>
        <button
          type="button"
          className="btn secondary btn-sm"
          onClick={onOpenCompliance}>
          {t("gw.gov.cta.proof")}
        </button>
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
          <span className="muted">{t("gw.gov.drill.foot")}</span>
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
  const [riskUsers, setRiskUsers] = useState<RiskUserRow[]>([])
  const [riskUsersLoaded, setRiskUsersLoaded] = useState(false)
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

  // Précharger risk users dès l’entrée Usage (agents ↔ apps)
  useEffect(() => {
    let cancelled = false
    setDrillBusy(true)
    void (async () => {
      try {
        const [ru, pr] = await Promise.all([
          api.riskUsers({ period, min_score: 0, limit: 200 }),
          api.profiles().catch(() => null),
          refreshAiBlockedMap()
        ])
        if (cancelled) return
        setRiskUsers((ru.users || []) as RiskUserRow[])
        setRiskUsersLoaded(true)
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
          setRiskUsers([])
          setRiskUsersLoaded(true)
        }
      } finally {
        if (!cancelled) setDrillBusy(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [period, setError, refreshAiBlockedMap])

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
                      <span className="gw-usage-inspect">
                        {t("gw.usage.inspectAgents")} →
                      </span>
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

        <p className="gw-usage-foot muted">{t("gw.usage.policyNoteLive")}</p>
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
                  <p className="muted">{t("gw.usage.wean.explainLive")}</p>
                  <ul className="gw-usage-wean-split">
                    <li>
                      <strong>{t("gw.usage.wean.killSwitch")}</strong>
                      <span className="muted">
                        {t("gw.usage.wean.killSwitchDetail")}
                      </span>
                    </li>
                    <li>
                      <strong>{t("gw.usage.wean.usageOwns")}</strong>
                      <span className="muted">
                        {t("gw.usage.wean.usageOwnsDetail")}
                      </span>
                    </li>
                  </ul>
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
          <span className="muted">{t("gw.usage.drill.foot")}</span>
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

function DataPanel({
  t,
  period,
  eventStats,
  sensitiveAttempts,
  protectedActions,
  summary,
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
  sensitiveAttempts: number
  protectedActions: number
  summary: Summary | null
  onOpenEvents?: () => void
}) {
  const decisions = summary?.by_decision || {}
  const decisionEntries = useMemo(() => {
    return Object.entries(decisions)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
  }, [decisions])
  const maxDecision = Math.max(1, ...decisionEntries.map(([, v]) => v))

  const protectRate =
    sensitiveAttempts > 0
      ? Math.round((protectedActions / Math.max(sensitiveAttempts, 1)) * 100)
      : protectedActions > 0
        ? 100
        : 0
  const anonymized = eventStats.rewrite + eventStats.mask
  const hardStop = eventStats.blocked + eventStats.cancel
  const bypass = eventStats.sendAnyway

  const postureTone =
    eventStats.high > 0 || bypass > Math.max(3, protectedActions)
      ? "danger"
      : sensitiveAttempts > 0
        ? "warn"
        : protectedActions > 0 || eventStats.total > 0
          ? "ok"
          : "neutral"

  const assets = [
    {
      id: "pii",
      icon: "PII",
      title: t("gw.data.pii"),
      ex: t("gw.data.piiEx"),
      hint: t("gw.data.asset.piiHint")
    },
    {
      id: "secrets",
      icon: "KEY",
      title: t("gw.data.secrets"),
      ex: t("gw.data.secretsEx"),
      hint: t("gw.data.asset.secretsHint")
    },
    {
      id: "business",
      icon: "DOC",
      title: t("gw.data.business"),
      ex: t("gw.data.businessEx"),
      hint: t("gw.data.asset.businessHint")
    }
  ] as const

  const actionCards = [
    {
      id: "block",
      label: t("gw.data.act.block"),
      detail: t("gw.data.act.blockDetail"),
      value: eventStats.blocked,
      tone: "danger" as const
    },
    {
      id: "rewrite",
      label: t("gw.data.act.rewrite"),
      detail: t("gw.data.act.rewriteDetail"),
      value: eventStats.rewrite,
      tone: "ok" as const
    },
    {
      id: "mask",
      label: t("gw.data.act.mask"),
      detail: t("gw.data.act.maskDetail"),
      value: eventStats.mask,
      tone: "ok" as const
    },
    {
      id: "confirm",
      label: t("gw.data.act.confirm"),
      detail: t("gw.data.act.confirmDetail"),
      value: eventStats.sendAnyway,
      tone: "warn" as const
    },
    {
      id: "cancel",
      label: t("gw.data.act.cancel"),
      detail: t("gw.data.act.cancelDetail"),
      value: eventStats.cancel,
      tone: "neutral" as const
    },
    {
      id: "log",
      label: t("gw.data.act.log"),
      detail: t("gw.data.act.logDetail"),
      value: protectedActions,
      tone: "neutral" as const
    }
  ]

  const sevMax = Math.max(
    1,
    eventStats.high,
    eventStats.medium,
    eventStats.low
  )

  return (
    <div className="gw-panel gw-data">
      {/* Posture hero */}
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
            {onOpenEvents && (
              <button
                type="button"
                className="btn btn-sm"
                onClick={onOpenEvents}>
                {t("gw.data.openEvents")}
              </button>
            )}
            <span className="gw-data-period muted">{t(`gw.period.${period}`)}</span>
          </div>
        </div>
        <div className="gw-data-rate">
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
        </div>
      </section>

      {/* Scenario strip — commercial narrative */}
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

      {/* KPI strip */}
      <div className="gw-data-stats">
        <div className="gw-data-stat">
          <span className="gw-data-stat-l">{t("gw.data.attempts")}</span>
          <span className="gw-data-stat-v">{sensitiveAttempts}</span>
          <span className="gw-data-stat-h">{t("gw.data.stat.attemptsHint")}</span>
        </div>
        <div className="gw-data-stat gw-data-stat--danger">
          <span className="gw-data-stat-l">{t("gw.data.high")}</span>
          <span className="gw-data-stat-v">{eventStats.high}</span>
          <span className="gw-data-stat-h">{t("gw.data.stat.highHint")}</span>
        </div>
        <div className="gw-data-stat gw-data-stat--ok">
          <span className="gw-data-stat-l">{t("gw.data.stat.hardStop")}</span>
          <span className="gw-data-stat-v">{hardStop}</span>
          <span className="gw-data-stat-h">{t("gw.data.stat.hardStopHint")}</span>
        </div>
        <div className="gw-data-stat gw-data-stat--ok">
          <span className="gw-data-stat-l">{t("gw.data.stat.anonymized")}</span>
          <span className="gw-data-stat-v">{anonymized}</span>
          <span className="gw-data-stat-h">{t("gw.data.stat.anonymizedHint")}</span>
        </div>
        <div className="gw-data-stat gw-data-stat--warn">
          <span className="gw-data-stat-l">{t("gw.data.stat.bypass")}</span>
          <span className="gw-data-stat-v">{bypass}</span>
          <span className="gw-data-stat-h">{t("gw.data.stat.bypassHint")}</span>
        </div>
        <div className="gw-data-stat">
          <span className="gw-data-stat-l">{t("gw.kpi.events")}</span>
          <span className="gw-data-stat-v">{eventStats.total}</span>
          <span className="gw-data-stat-h">{t("gw.data.stat.eventsHint")}</span>
        </div>
      </div>

      {/* Assets + severity */}
      <div className="gw-data-mid">
        <div className="gw-card">
          <div className="gw-card-head">
            <h3>{t("gw.data.assets")}</h3>
            <span className="muted" style={{ fontSize: 12 }}>
              {t("gw.data.assetsHint")}
            </span>
          </div>
          <div className="gw-data-assets">
            {assets.map((a) => (
              <div key={a.id} className={`gw-data-asset gw-data-asset--${a.id}`}>
                <span className="gw-data-asset-icon" aria-hidden>
                  {a.icon}
                </span>
                <div>
                  <strong>{a.title}</strong>
                  <p className="muted">{a.ex}</p>
                  <span className="gw-data-asset-hint">{a.hint}</span>
                </div>
              </div>
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
                ["high", eventStats.high, "high"],
                ["medium", eventStats.medium, "med"],
                ["low", eventStats.low, "low"]
              ] as const
            ).map(([key, n, tone]) => (
              <div key={key} className="gw-data-sev-row">
                <div className="gw-data-sev-label">
                  <span className={`gw-dot gw-dot--${tone === "high" ? "danger" : tone === "med" ? "warn" : "ok"}`} />
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
                      width: `${Math.max(n > 0 ? 6 : 0, Math.round((n / sevMax) * 100))}%`
                    }}
                  />
                </div>
                <strong className="gw-data-sev-n">{n}</strong>
              </div>
            ))}
          </div>
          <p className="muted gw-data-sev-foot">{t("gw.data.severityHint")}</p>
        </div>
      </div>

      {/* Action catalog */}
      <div className="gw-card">
        <div className="gw-card-head">
          <h3>{t("gw.data.actions")}</h3>
          <span className="muted" style={{ fontSize: 12 }}>
            {t("gw.data.actionsHint")}
          </span>
        </div>
        <div className="gw-data-actions">
          {actionCards.map((a) => (
            <div
              key={a.id}
              className={`gw-data-action gw-data-action--${a.tone}`}>
              <span className="gw-data-action-v">{a.value}</span>
              <strong>{a.label}</strong>
              <span className="muted">{a.detail}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Decision breakdown from API summary */}
      <div className="gw-card">
        <div className="gw-card-head">
          <h3>{t("gw.data.fromSummary")}</h3>
          {onOpenEvents && (
            <button
              type="button"
              className="btn secondary btn-sm"
              onClick={onOpenEvents}>
              {t("gw.data.openEvents")}
            </button>
          )}
        </div>
        {decisionEntries.length === 0 ? (
          <p className="muted gw-data-empty">{t("gw.data.noDecisions")}</p>
        ) : (
          <ul className="gw-data-decisions">
            {decisionEntries.map(([k, v]) => (
              <li key={k}>
                <code>{k}</code>
                <div className="gw-usage-vol-bar">
                  <span
                    style={{
                      width: `${Math.max(4, Math.round((v / maxDecision) * 100))}%`
                    }}
                  />
                </div>
                <strong>{v}</strong>
              </li>
            ))}
          </ul>
        )}
        <p className="muted gw-data-foot">{t("gw.data.foot")}</p>
      </div>
    </div>
  )
}

function CompliancePanel({
  t,
  period,
  summary,
  risk,
  avgRisk,
  riskDelta,
  eventStats,
  shadowCounts,
  sensitiveAttempts,
  protectedActions,
  onOpenAudit,
  onOpenReports,
  onOpenEvents
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
  shadowCounts: ShadowCounts | null
  sensitiveAttempts: number
  protectedActions: number
  onOpenAudit?: () => void
  onOpenReports?: () => void
  onOpenEvents?: () => void
}) {
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

  // Simple posture score for board narrative (0–100, higher = better control)
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

  const checklist = [
    {
      id: "events",
      ok: eventStats.total > 0,
      label: t("gw.comp.check.events"),
      detail: t("gw.comp.check.eventsDetail", { n: eventStats.total })
    },
    {
      id: "protect",
      ok: protectedActions > 0 || sensitiveAttempts === 0,
      label: t("gw.comp.check.protect"),
      detail: t("gw.comp.check.protectDetail", {
        n: protectedActions,
        pct: protectRate
      })
    },
    {
      id: "violations",
      ok: violations === 0,
      label: t("gw.comp.check.violations"),
      detail: t("gw.comp.check.violationsDetail", { n: violations })
    },
    {
      id: "bypass",
      ok: eventStats.sendAnyway === 0,
      label: t("gw.comp.check.bypass"),
      detail: t("gw.comp.check.bypassDetail", { n: eventStats.sendAnyway })
    },
    {
      id: "risk",
      ok: score < 70,
      label: t("gw.comp.check.risk"),
      detail: t("gw.comp.check.riskDetail", {
        label: riskLabel(t, avgRisk),
        n: score
      })
    },
    {
      id: "exports",
      ok: true,
      label: t("gw.comp.check.exports"),
      detail: t("gw.comp.check.exportsDetail")
    }
  ]
  const checksOk = checklist.filter((c) => c.ok).length

  const reportLines: Array<{
    label: string
    value: string
    tone?: string
    dots?: boolean
  }> = [
    {
      label: t("gw.compliance.usersMonitored"),
      value: String(usersMonitored || "—")
    },
    {
      label: t("gw.compliance.interactions"),
      value: String(eventStats.total)
    },
    {
      label: t("gw.compliance.sensitive"),
      value: String(sensitiveAttempts)
    },
    {
      label: t("gw.compliance.blocked"),
      value: String(eventStats.blocked)
    },
    {
      label: t("gw.compliance.rewrite"),
      value: String(anonymized)
    },
    {
      label: t("gw.compliance.violations"),
      value: String(violations),
      tone: violations > 0 ? "gw-risk-high" : "gw-ok"
    },
    {
      label: t("gw.compliance.protected"),
      value: String(protectedActions),
      tone: "gw-ok"
    },
    {
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

  const evidence = [
    {
      id: "report",
      title: t("gw.comp.ev.report"),
      detail: t("gw.comp.ev.reportDetail"),
      cta: t("gw.compliance.openReports"),
      onClick: onOpenReports,
      primary: true
    },
    {
      id: "audit",
      title: t("gw.comp.ev.audit"),
      detail: t("gw.comp.ev.auditDetail"),
      cta: t("gw.compliance.openAudit"),
      onClick: onOpenAudit
    },
    {
      id: "events",
      title: t("gw.comp.ev.events"),
      detail: t("gw.comp.ev.eventsDetail"),
      cta: t("gw.compliance.openEvents"),
      onClick: onOpenEvents
    }
  ]

  return (
    <div className="gw-panel gw-comp">
      {/* Hero — proof narrative */}
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
            {onOpenAudit && (
              <button
                type="button"
                className="btn secondary btn-sm"
                onClick={onOpenAudit}>
                {t("gw.compliance.openAudit")}
              </button>
            )}
          </div>
        </div>
        <div className="gw-comp-control">
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
        </div>
      </section>

      {/* Snapshot KPIs */}
      <div className="gw-comp-stats">
        <div className="gw-comp-stat">
          <span className="gw-comp-stat-l">{t("gw.compliance.usersMonitored")}</span>
          <span className="gw-comp-stat-v">{usersMonitored || "—"}</span>
        </div>
        <div className="gw-comp-stat">
          <span className="gw-comp-stat-l">{t("gw.compliance.interactions")}</span>
          <span className="gw-comp-stat-v">{eventStats.total}</span>
        </div>
        <div className="gw-comp-stat">
          <span className="gw-comp-stat-l">{t("gw.compliance.sensitive")}</span>
          <span className="gw-comp-stat-v">{sensitiveAttempts}</span>
        </div>
        <div className={`gw-comp-stat ${violations > 0 ? "gw-comp-stat--danger" : "gw-comp-stat--ok"}`}>
          <span className="gw-comp-stat-l">{t("gw.compliance.violations")}</span>
          <span className="gw-comp-stat-v">{violations}</span>
        </div>
        <div className={`gw-comp-stat gw-comp-stat--${riskTone}`}>
          <span className="gw-comp-stat-l">{t("gw.compliance.riskEvo")}</span>
          <span className={`gw-comp-stat-v ${scoreClass(avgRisk)}`}>
            {riskDelta != null
              ? `${riskDelta > 0 ? "↑" : riskDelta < 0 ? "↓" : "→"}${Math.abs(riskDelta)}%`
              : riskLabel(t, avgRisk)}
          </span>
        </div>
        <div className="gw-comp-stat gw-comp-stat--ok">
          <span className="gw-comp-stat-l">{t("gw.compliance.protected")}</span>
          <span className="gw-comp-stat-v">{protectedActions}</span>
        </div>
      </div>

      {/* Formal AI Security Report */}
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
            <span className={`gw-badge gw-comp-stamp gw-comp-stamp--${controlTone}`}>
              {t(`gw.comp.stamp.${controlTone}`)}
            </span>
            <span className="muted">{t("gw.comp.confidential")}</span>
          </div>
        </header>

        <div className="gw-comp-report-body">
          {reportLines.map((line) => (
            <div key={line.label} className="gw-comp-report-line">
              <span className="gw-comp-report-label">{line.label}</span>
              <span className="gw-comp-report-dots" aria-hidden />
              <strong className={`gw-comp-report-value ${line.tone || ""}`}>
                {line.value}
              </strong>
            </div>
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
        <p className="gw-comp-report-foot muted">{t("gw.compliance.proof")}</p>
      </article>

      {/* Checklist + evidence sources */}
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
                <span className="gw-comp-check-mark" aria-hidden>
                  {c.ok ? "✓" : "!"}
                </span>
                <div>
                  <strong>{c.label}</strong>
                  <p className="muted">{c.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="gw-card">
          <div className="gw-card-head">
            <h3>{t("gw.comp.evidenceTitle")}</h3>
          </div>
          <div className="gw-comp-evidence">
            {evidence.map((e) => (
              <div key={e.id} className="gw-comp-ev-card">
                <strong>{e.title}</strong>
                <p className="muted">{e.detail}</p>
                {e.onClick && (
                  <button
                    type="button"
                    className={`btn btn-sm ${e.primary ? "" : "secondary"}`}
                    onClick={e.onClick}>
                    {e.cta}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Board message */}
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
    </div>
  )
}

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
  onOpenRisk?: () => void
  onOpenShadow?: () => void
  onOpenUsage: () => void
  onOpenData: () => void
  onOpenCompliance: () => void
}) {
  const score = Math.round(avgRisk)
  const riskTone =
    score >= 70 ? "danger" : score >= 40 ? "warn" : score > 0 ? "ok" : "neutral"
  const emergingCount = unknownTools.length + unauthorizedTools.length
  const highUsers = risk?.high_risk_users ?? 0
  const medUsers = risk?.medium_risk_users ?? 0
  const lowUsers = risk?.low_risk_users ?? 0
  const usersTotal = risk?.users_count ?? highUsers + medUsers + lowUsers
  const userDistMax = Math.max(1, highUsers, medUsers, lowUsers)

  const emerging = useMemo(() => {
    return [...tools]
      .filter((x) => x.status === "unknown" || x.status === "unauthorized")
      .sort((a, b) => (b.events_count || 0) - (a.events_count || 0))
      .slice(0, 8)
  }, [tools])

  const topUsers = risk?.top_risk_users?.slice(0, 8) || []
  const maxUserScore = Math.max(1, ...topUsers.map((u) => u.score || 0), score)

  const signals = [
    {
      id: "high",
      label: t("gw.intel.signal.high"),
      value: eventStats.high,
      tone: eventStats.high > 0 ? ("danger" as const) : ("ok" as const),
      hint: t("gw.intel.signal.highHint"),
      onClick: onOpenData
    },
    {
      id: "bypass",
      label: t("gw.intel.signal.sendAnyway"),
      value: eventStats.sendAnyway,
      tone: eventStats.sendAnyway > 0 ? ("warn" as const) : ("ok" as const),
      hint: t("gw.intel.signal.bypassHint"),
      onClick: onOpenData
    },
    {
      id: "unauth",
      label: t("gw.intel.signal.unauth"),
      value: unauthorizedTools.length,
      tone:
        unauthorizedTools.length > 0 ? ("danger" as const) : ("ok" as const),
      hint: t("gw.intel.signal.unauthHint"),
      onClick: onOpenUsage
    },
    {
      id: "unknown",
      label: t("gw.intel.signal.unknown"),
      value: unknownTools.length,
      tone: unknownTools.length > 0 ? ("warn" as const) : ("ok" as const),
      hint: t("gw.intel.signal.unknownHint"),
      onClick: onOpenUsage
    }
  ]

  const insights = useMemo(() => {
    const items: Array<{
      title: string
      detail: string
      cta: string
      onClick: () => void
      tone: "danger" | "warn" | "ok" | "neutral"
    }> = []
    if (unauthorizedTools.length > 0) {
      items.push({
        title: t("gw.intel.rec.unauth"),
        detail: t("gw.intel.rec.unauthDetail", {
          n: unauthorizedTools.length
        }),
        cta: t("gw.gov.cta.usage"),
        onClick: onOpenUsage,
        tone: "danger"
      })
    }
    if (highUsers > 0) {
      items.push({
        title: t("gw.intel.rec.highUsers"),
        detail: t("gw.intel.rec.highUsersDetail", { n: highUsers }),
        cta: t("gw.intel.openRisk"),
        onClick: () => onOpenRisk?.(),
        tone: "danger"
      })
    }
    if (eventStats.high > 0) {
      items.push({
        title: t("gw.intel.rec.highDet"),
        detail: t("gw.intel.rec.highDetDetail", { n: eventStats.high }),
        cta: t("gw.gov.cta.data"),
        onClick: onOpenData,
        tone: "warn"
      })
    }
    if (eventStats.sendAnyway > 0) {
      items.push({
        title: t("gw.intel.rec.bypass"),
        detail: t("gw.intel.rec.bypassDetail", { n: eventStats.sendAnyway }),
        cta: t("gw.gov.cta.data"),
        onClick: onOpenData,
        tone: "warn"
      })
    }
    if (unknownTools.length > 0) {
      items.push({
        title: t("gw.intel.rec.unknown"),
        detail: t("gw.intel.rec.unknownDetail", { n: unknownTools.length }),
        cta: t("gw.gov.cta.usage"),
        onClick: onOpenUsage,
        tone: "warn"
      })
    }
    if (items.length === 0) {
      items.push({
        title: t("gw.intel.rec.ok"),
        detail: t("gw.intel.rec.okDetail"),
        cta: t("gw.gov.cta.compliance"),
        onClick: onOpenCompliance,
        tone: "ok"
      })
    }
    return items.slice(0, 4)
  }, [
    unauthorizedTools.length,
    highUsers,
    eventStats.high,
    eventStats.sendAnyway,
    unknownTools.length,
    t,
    onOpenUsage,
    onOpenData,
    onOpenRisk,
    onOpenCompliance
  ])

  const trendLabel =
    riskDelta != null
      ? riskDelta > 0
        ? t("gw.intel.trend.up", { n: Math.abs(riskDelta) })
        : riskDelta < 0
          ? t("gw.intel.trend.down", { n: Math.abs(riskDelta) })
          : t("gw.intel.trend.flat")
      : t("gw.intel.trend.na")

  return (
    <div className="gw-panel gw-intel">
      {/* Hero */}
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
            {onOpenRisk && (
              <button type="button" className="btn btn-sm" onClick={onOpenRisk}>
                {t("gw.intel.openRisk")}
              </button>
            )}
            {onOpenShadow && (
              <button
                type="button"
                className="btn secondary btn-sm"
                onClick={onOpenShadow}>
                {t("gw.intel.openShadow")}
              </button>
            )}
            <span className="muted" style={{ fontSize: 12 }}>
              {t(`gw.period.${period}`)}
            </span>
          </div>
        </div>
        <button
          type="button"
          className="gw-intel-gauge"
          onClick={onOpenRisk}
          disabled={!onOpenRisk}>
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
            <span className={`gw-badge gw-gov-risk-badge gw-gov-risk-badge--${riskTone}`}>
              {riskLabel(t, avgRisk)}
            </span>
            <span className="muted">{trendLabel}</span>
          </div>
        </button>
      </section>

      {/* KPI strip */}
      <div className="gw-intel-stats">
        <div className={`gw-intel-stat gw-intel-stat--${riskTone}`}>
          <span className="gw-intel-stat-l">{t("gw.intel.orgScore")}</span>
          <span className={`gw-intel-stat-v ${scoreClass(avgRisk)}`}>
            {score}
          </span>
          <span className="gw-intel-stat-h">{trendLabel}</span>
        </div>
        <div className="gw-intel-stat gw-intel-stat--danger">
          <span className="gw-intel-stat-l">{t("gw.intel.highUsers")}</span>
          <span className="gw-intel-stat-v">{highUsers}</span>
          <span className="gw-intel-stat-h">
            {t("gw.intel.stat.usersTotal", { n: usersTotal })}
          </span>
        </div>
        <div className="gw-intel-stat gw-intel-stat--warn">
          <span className="gw-intel-stat-l">{t("gw.intel.emerging")}</span>
          <span className="gw-intel-stat-v">{emergingCount}</span>
          <span className="gw-intel-stat-h">
            {t("gw.intel.stat.appsTotal", { n: tools.length })}
          </span>
        </div>
        <div className="gw-intel-stat">
          <span className="gw-intel-stat-l">{t("gw.intel.stat.signals")}</span>
          <span className="gw-intel-stat-v">
            {eventStats.high + eventStats.sendAnyway + unauthorizedTools.length}
          </span>
          <span className="gw-intel-stat-h">{t("gw.intel.stat.signalsHint")}</span>
        </div>
      </div>

      {/* Signal radar */}
      <div className="gw-card">
        <div className="gw-card-head">
          <h3>{t("gw.intel.radarTitle")}</h3>
          <span className="muted" style={{ fontSize: 12 }}>
            {t("gw.intel.radarHint")}
          </span>
        </div>
        <div className="gw-intel-radar">
          {signals.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`gw-intel-signal gw-intel-signal--${s.tone}`}
              onClick={s.onClick}>
              <span className="gw-intel-signal-v">{s.value}</span>
              <strong>{s.label}</strong>
              <span className="muted">{s.hint}</span>
            </button>
          ))}
        </div>
      </div>

      {/* User risk distribution */}
      <div className="gw-card">
        <div className="gw-card-head">
          <h3>{t("gw.intel.distTitle")}</h3>
          {onOpenRisk && (
            <button
              type="button"
              className="btn secondary btn-sm"
              onClick={onOpenRisk}>
              {t("gw.intel.openRisk")}
            </button>
          )}
        </div>
        <div className="gw-intel-dist">
          {(
            [
              ["high", highUsers, "high"],
              ["med", medUsers, "med"],
              ["low", lowUsers, "low"]
            ] as const
          ).map(([key, n, tone]) => (
            <div key={key} className="gw-intel-dist-row">
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
                    width: `${Math.max(n > 0 ? 6 : 0, Math.round((n / userDistMax) * 100))}%`
                  }}
                />
              </div>
              <strong>{n}</strong>
            </div>
          ))}
        </div>
      </div>

      {/* Top users + emerging apps */}
      <div className="gw-intel-mid">
        <div className="gw-card">
          <div className="gw-card-head">
            <h3>{t("gw.intel.topUsers")}</h3>
            {onOpenRisk && (
              <button
                type="button"
                className="btn secondary btn-sm"
                onClick={onOpenRisk}>
                {t("gw.intel.openRisk")}
              </button>
            )}
          </div>
          {topUsers.length === 0 ? (
            <p className="muted gw-intel-empty">{t("gw.intel.noUsers")}</p>
          ) : (
            <ul className="gw-intel-users">
              {topUsers.map((u, i) => (
                <li key={u.agent_id}>
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
                      {t(`gw.intel.userTrend.${u.trend}`)} ·{" "}
                      {u.agent_id.slice(0, 10)}…
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="gw-card">
          <div className="gw-card-head">
            <h3>{t("gw.intel.emergingApps")}</h3>
            <div className="gw-intel-head-actions">
              <button
                type="button"
                className="btn secondary btn-sm"
                onClick={onOpenUsage}>
                {t("gw.gov.cta.usage")}
              </button>
              {onOpenShadow && (
                <button
                  type="button"
                  className="btn secondary btn-sm"
                  onClick={onOpenShadow}>
                  {t("gw.intel.openShadow")}
                </button>
              )}
            </div>
          </div>
          {emerging.length === 0 ? (
            <p className="muted gw-intel-empty">{t("gw.intel.noEmerging")}</p>
          ) : (
            <ul className="gw-intel-apps">
              {emerging.map((tool) => {
                const name = tool.display_name || tool.tool
                return (
                  <li key={tool.tool}>
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
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>

      {/* Recommendations / OpsInsight */}
      <div className="gw-intel-ops">
        <div className="gw-intel-ops-head">
          <div>
            <span className="gw-kicker">OpsInsight</span>
            <h3>{t("gw.intel.opsInsight")}</h3>
            <p className="muted">{t("gw.intel.opsInsightDetail")}</p>
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
                onClick={rec.onClick}>
                {rec.cta}
              </button>
            </div>
          ))}
        </div>
        <p className="muted gw-intel-foot">{t("gw.intel.foot")}</p>
      </div>
    </div>
  )
}


