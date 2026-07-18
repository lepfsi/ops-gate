/**
 * Risk Score + Shadow AI Discovery (wireframes V3)
 */
import { useCallback, useEffect, useMemo, useState } from "react"
import { api } from "./api"

type Period = "7d" | "30d" | "90d"

type RiskUser = {
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

function scoreClass(score: number): string {
  if (score >= 70) return "risk-high"
  if (score >= 40) return "risk-med"
  return "risk-low"
}

function trendGlyph(t: string): string {
  if (t === "up") return "↑"
  if (t === "down") return "↓"
  return "→"
}

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "—"
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return "—"
  const diff = Date.now() - ms
  if (diff < 60_000) return "< 1 min"
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} min`
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} h`
  return `${Math.floor(diff / 86400_000)} j`
}

const FACTOR_LABELS: Record<string, string> = {
  high_detections: "Détections high",
  medium_detections: "Détections medium",
  send_anyway_high: "Send anyway (high)",
  send_anyway_medium: "Send anyway (medium)",
  send_anyway_low: "Send anyway (low)",
  mask_or_rewrite: "Mask / rewrite",
  cancel: "Annulations",
  shadow_unauthorized: "Shadow non autorisé",
  recurrence_days: "Récurrence"
}

export function RiskView({
  t,
  setError,
  setInfo
}: {
  t: (k: string, vars?: Record<string, string | number>) => string
  setError: (e: string | null) => void
  setInfo: (i: string | null) => void
}) {
  const [period, setPeriod] = useState<Period>("30d")
  const [summary, setSummary] = useState<RiskSummary | null>(null)
  const [users, setUsers] = useState<RiskUser[]>([])
  const [selected, setSelected] = useState<RiskUser | null>(null)
  const [detail, setDetail] = useState<{
    user: RiskUser
    recent_events: Array<{
      id: string
      ts?: string
      decision?: string
      hostname?: string
      highest_severity?: string
      detection_count?: number
      types?: string[]
    }>
  } | null>(null)
  const [busy, setBusy] = useState(false)
  const [minScore, setMinScore] = useState(0)
  const [shadowUnauth, setShadowUnauth] = useState(0)

  const load = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const [s, u, sh] = await Promise.all([
        api.riskSummary(period),
        api.riskUsers({ period, min_score: minScore, limit: 100 }),
        api.shadowAi({ period, status: "unauthorized" }).catch(() => null)
      ])
      setSummary(s as RiskSummary)
      setUsers((u.users || []) as RiskUser[])
      setShadowUnauth(
        (sh as { counts?: { unauthorized?: number } } | null)?.counts
          ?.unauthorized ?? 0
      )
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }, [period, minScore, setError])

  useEffect(() => {
    void load()
  }, [load])

  const openDetail = async (u: RiskUser) => {
    setSelected(u)
    setBusy(true)
    try {
      const d = await api.riskUserDetail(u.agent_id, period)
      setDetail(d as typeof detail)
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  const maxBucket = useMemo(() => {
    if (!summary) return 1
    return Math.max(
      1,
      summary.low_risk_users,
      summary.medium_risk_users,
      summary.high_risk_users
    )
  }, [summary])

  const top5 = useMemo(() => {
    if (summary?.top_risk_users?.length) return summary.top_risk_users.slice(0, 5)
    return [...users].sort((a, b) => b.score - a.score).slice(0, 5)
  }, [summary, users])

  const trendPts =
    summary && summary.previous_average_score != null
      ? summary.average_score - summary.previous_average_score
      : null

  return (
    <div className="card risk-page">
      <div className="risk-toolbar">
        <h2 style={{ margin: 0 }}>{t("risk.title")}</h2>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <select
            className="input"
            value={period}
            onChange={(e) => setPeriod(e.target.value as Period)}
            style={{ width: 110 }}>
            <option value="7d">7 j</option>
            <option value="30d">30 j</option>
            <option value="90d">90 j</option>
          </select>
          <select
            className="input"
            value={minScore}
            onChange={(e) => setMinScore(Number(e.target.value))}
            style={{ width: 130 }}>
            <option value={0}>{t("risk.filterAll")}</option>
            <option value={40}>{t("risk.filterMed")}</option>
            <option value={70}>{t("risk.filterHigh")}</option>
          </select>
          <button
            type="button"
            className="btn secondary"
            disabled={busy}
            onClick={() => void load()}>
            {t("common.refresh") || "Actualiser"}
          </button>
          <button
            type="button"
            className="btn secondary"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                await api.riskRecalculate(period)
                setInfo(t("risk.recalculated"))
                await load()
              } catch (e) {
                setError(String(e))
              } finally {
                setBusy(false)
              }
            }}>
            {t("risk.recalc")}
          </button>
        </div>
      </div>

      {summary && (
        <>
          <div className="risk-kpi-row">
            <div className={`risk-kpi ${scoreClass(summary.average_score)}`}>
              <div className="risk-kpi-label">{t("risk.avgScore")}</div>
              <div className="risk-kpi-value">
                {summary.average_score}
                <span className="risk-kpi-unit">/100</span>
              </div>
            </div>
            <div className="risk-kpi risk-high">
              <div className="risk-kpi-label">{t("risk.highUsers")}</div>
              <div className="risk-kpi-value">{summary.high_risk_users}</div>
            </div>
            <div className="risk-kpi">
              <div className="risk-kpi-label">Tendance</div>
              <div className="risk-kpi-value risk-kpi-trend">
                {trendGlyph(summary.trend)}
                {trendPts != null ? (
                  <span className="risk-kpi-sub">
                    {trendPts > 0 ? "+" : ""}
                    {trendPts} pts
                  </span>
                ) : null}
              </div>
            </div>
            <div className="risk-kpi">
              <div className="risk-kpi-label">Shadow</div>
              <div className="risk-kpi-value">{shadowUnauth}</div>
              <div className="risk-kpi-sub muted">non autorisés</div>
            </div>
          </div>

          <div className="risk-dist">
            <div className="risk-dist-title">Répartition</div>
            {(
              [
                ["Low", summary.low_risk_users, "risk-low"],
                ["Medium", summary.medium_risk_users, "risk-med"],
                ["High", summary.high_risk_users, "risk-high"]
              ] as const
            ).map(([label, n, cls]) => (
              <div key={label} className="risk-dist-row">
                <span className="risk-dist-label">{label}</span>
                <div className="risk-dist-track">
                  <div
                    className={`risk-dist-fill ${cls}`}
                    style={{ width: `${Math.round((n / maxBucket) * 100)}%` }}
                  />
                </div>
                <span className="risk-dist-n">{n}</span>
              </div>
            ))}
          </div>

          <div className="risk-top">
            <div className="risk-section-title">Top risque</div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>{t("risk.colUser")}</th>
                    <th>{t("risk.colScore")}</th>
                    <th>{t("risk.colTrend")}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {top5.map((u, i) => (
                    <tr key={u.agent_id}>
                      <td className="muted">{i + 1}</td>
                      <td>{u.label}</td>
                      <td>
                        <span className={`risk-badge ${scoreClass(u.score)}`}>
                          {u.score}
                        </span>
                      </td>
                      <td>{trendGlyph(u.trend)}</td>
                      <td>
                        <button
                          type="button"
                          className="btn secondary btn-sm"
                          onClick={() => {
                            const full =
                              users.find((x) => x.agent_id === u.agent_id) ||
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
                              } as RiskUser)
                            void openDetail(full)
                          }}>
                          Voir
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!top5.length && (
                    <tr>
                      <td colSpan={5} className="muted">
                        {t("risk.emptyUsers")}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      <div className="risk-split">
        <div>
          <div className="risk-section-title">{t("risk.usersList")}</div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th />
                  <th>{t("risk.colUser")}</th>
                  <th>{t("risk.colScore")}</th>
                  <th>{t("risk.colTrend")}</th>
                  <th>Activité</th>
                  <th>Shadow</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr
                    key={u.agent_id}
                    className={
                      selected?.agent_id === u.agent_id ? "row-active" : ""
                    }
                    style={{ cursor: "pointer" }}
                    onClick={() => void openDetail(u)}>
                    <td>
                      <span
                        className={`risk-dot ${scoreClass(u.score)}`}
                        title={scoreClass(u.score)}
                      />
                    </td>
                    <td>{u.label}</td>
                    <td>
                      <span className={`risk-badge ${scoreClass(u.score)}`}>
                        {u.score}
                      </span>
                    </td>
                    <td>{trendGlyph(u.trend)}</td>
                    <td className="muted" style={{ fontSize: 12 }}>
                      {relativeTime(u.last_event_at)}
                    </td>
                    <td>{u.tools?.length || 0}</td>
                  </tr>
                ))}
                {!users.length && (
                  <tr>
                    <td colSpan={6} className="muted">
                      {t("risk.emptyUsers")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="muted" style={{ fontSize: 11, marginTop: 8 }}>
            ● High (≥70) · Medium (40–69) · Low (&lt;40)
          </p>
        </div>

        <div className="risk-detail-panel">
          <div className="risk-section-title">{t("risk.detail")}</div>
          {!detail ? (
            <p className="muted">{t("risk.pickUser")}</p>
          ) : (
            <div className="form-stack" style={{ gap: 12 }}>
              <div className="row" style={{ gap: 10, alignItems: "center" }}>
                <strong style={{ fontSize: 15 }}>{detail.user.label}</strong>
                <span className={`risk-badge ${scoreClass(detail.user.score)}`}>
                  {detail.user.score}/100
                </span>
                <span className="muted" style={{ fontSize: 12 }}>
                  {trendGlyph(detail.user.trend)}
                  {detail.user.score_previous != null
                    ? ` vs ${detail.user.score_previous}`
                    : ""}
                </span>
              </div>

              <div>
                <div className="risk-section-title" style={{ marginBottom: 6 }}>
                  {t("risk.whyScore")}
                </div>
                <ul className="risk-factors">
                  {Object.entries(detail.user.factors || {})
                    .filter(([, v]) => v)
                    .map(([k, v]) => (
                      <li key={k}>
                        <span>{FACTOR_LABELS[k] || k}</span>
                        <strong>{v}</strong>
                      </li>
                    ))}
                  {!Object.values(detail.user.factors || {}).some(Boolean) && (
                    <li className="muted">Aucun facteur sur la période</li>
                  )}
                </ul>
              </div>

              <div>
                <div className="risk-section-title" style={{ marginBottom: 6 }}>
                  {t("risk.toolsUsed")}
                </div>
                <div className="risk-tools">
                  {(detail.user.tools || []).length
                    ? detail.user.tools.map((tool) => (
                        <span key={tool} className="risk-tool-chip">
                          {tool}
                        </span>
                      ))
                    : "—"}
                </div>
              </div>

              <div>
                <div className="risk-section-title" style={{ marginBottom: 6 }}>
                  {t("risk.recentEvents")}
                </div>
                <div className="table-wrap" style={{ maxHeight: 220, overflow: "auto" }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Décision</th>
                        <th>Hôte</th>
                        <th>Sévérité</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(detail.recent_events || []).map((e) => (
                        <tr key={e.id}>
                          <td className="mono" style={{ fontSize: 11 }}>
                            {(e.ts || "").slice(0, 16).replace("T", " ")}
                          </td>
                          <td>{e.decision}</td>
                          <td>{e.hostname}</td>
                          <td>{e.highest_severity}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <style>{`
        .risk-page { padding: 4px 2px 16px; }
        .risk-toolbar {
          display: flex; justify-content: space-between; align-items: center;
          flex-wrap: wrap; gap: 16px; margin-bottom: 22px;
        }
        .risk-toolbar .input { min-height: 38px; }
        .risk-kpi-row {
          display: grid; grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 16px; margin-bottom: 24px;
        }
        @media (max-width: 900px) {
          .risk-kpi-row { grid-template-columns: repeat(2, 1fr); }
        }
        .risk-kpi {
          padding: 18px 20px; border-radius: 12px;
          border: 1px solid var(--line, #e2e8f0);
          background: var(--surface-2, #f8fafc);
          min-height: 100px;
          box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
        }
        .risk-kpi-label {
          font-size: 11px; font-weight: 700; color: #64748b;
          text-transform: uppercase; letter-spacing: 0.05em;
        }
        .risk-kpi-value {
          font-size: 30px; font-weight: 800; margin-top: 10px; line-height: 1.1;
        }
        .risk-kpi-unit { font-size: 14px; font-weight: 650; color: #94a3b8; margin-left: 2px; }
        .risk-kpi-sub { display: block; font-size: 12px; font-weight: 600; margin-top: 6px; color: #64748b; }
        .risk-kpi-trend { display: flex; align-items: baseline; gap: 10px; }
        .risk-high { border-color: #fecaca; background: #fef2f2; }
        .risk-med { border-color: #fde68a; background: #fffbeb; }
        .risk-low { border-color: #a7f3d0; background: #ecfdf5; }
        .risk-dist {
          margin-bottom: 24px; padding: 18px 20px; border-radius: 12px;
          border: 1px solid var(--line, #e2e8f0); background: #fff;
        }
        .risk-dist-title, .risk-section-title {
          font-size: 12px; font-weight: 750; color: #475569;
          text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 14px;
        }
        .risk-dist-row {
          display: grid; grid-template-columns: 72px 1fr 40px;
          gap: 14px; align-items: center; margin-bottom: 12px;
        }
        .risk-dist-label { font-size: 13px; font-weight: 650; color: #334155; }
        .risk-dist-track {
          height: 12px; border-radius: 999px; background: #f1f5f9; overflow: hidden;
        }
        .risk-dist-fill { height: 100%; border-radius: 999px; min-width: 2px; }
        .risk-dist-fill.risk-low { background: #34d399; }
        .risk-dist-fill.risk-med { background: #fbbf24; }
        .risk-dist-fill.risk-high { background: #f87171; }
        .risk-dist-n { font-size: 13px; font-weight: 700; text-align: right; }
        .risk-top {
          margin-bottom: 28px; padding: 18px 20px; border-radius: 12px;
          border: 1px solid var(--line, #e2e8f0); background: #fff;
        }
        .risk-top .data-table th,
        .risk-top .data-table td,
        .risk-split .data-table th,
        .risk-split .data-table td {
          padding: 12px 16px;
          vertical-align: middle;
        }
        .risk-top .data-table th:nth-child(1),
        .risk-top .data-table td:nth-child(1) { width: 48px; }
        .risk-top .data-table th:nth-child(3),
        .risk-top .data-table td:nth-child(3) { width: 88px; text-align: center; }
        .risk-top .data-table th:nth-child(4),
        .risk-top .data-table td:nth-child(4) { width: 80px; text-align: center; }
        .risk-top .data-table th:nth-child(5),
        .risk-top .data-table td:nth-child(5) { width: 100px; text-align: right; }
        .risk-split {
          display: grid; grid-template-columns: 1.2fr 0.9fr; gap: 24px;
          align-items: start;
        }
        @media (max-width: 1000px) {
          .risk-split { grid-template-columns: 1fr; }
        }
        .risk-split > div {
          padding: 18px 20px; border-radius: 12px;
          border: 1px solid var(--line, #e2e8f0); background: #fff;
          min-height: 280px;
        }
        .risk-detail-panel {
          padding: 18px 20px !important; border-radius: 12px;
          border: 1px solid var(--line, #e2e8f0); background: #f8fafc !important;
        }
        .risk-split .data-table th:nth-child(1) { width: 36px; }
        .risk-split .data-table th:nth-child(3),
        .risk-split .data-table td:nth-child(3) { width: 88px; text-align: center; }
        .risk-split .data-table th:nth-child(4),
        .risk-split .data-table td:nth-child(4) { width: 72px; text-align: center; }
        .risk-split .data-table th:nth-child(5),
        .risk-split .data-table td:nth-child(5) { width: 100px; }
        .risk-split .data-table th:nth-child(6),
        .risk-split .data-table td:nth-child(6) { width: 72px; text-align: center; }
        .risk-badge {
          display: inline-block; padding: 4px 10px; border-radius: 999px;
          font-weight: 800; font-size: 12px; min-width: 36px; text-align: center;
        }
        .risk-badge.risk-high { background: #fee2e2; color: #b91c1c; }
        .risk-badge.risk-med { background: #fef3c7; color: #b45309; }
        .risk-badge.risk-low { background: #d1fae5; color: #047857; }
        .risk-dot {
          display: inline-block; width: 9px; height: 9px; border-radius: 50%;
        }
        .risk-dot.risk-high { background: #ef4444; }
        .risk-dot.risk-med { background: #f59e0b; }
        .risk-dot.risk-low { background: #10b981; }
        .row-active { background: rgba(45, 212, 191, 0.12); }
        .risk-factors {
          list-style: none; margin: 0; padding: 0;
          border: 1px solid #e2e8f0; border-radius: 10px; background: #fff;
        }
        .risk-factors li {
          display: flex; justify-content: space-between; gap: 14px;
          padding: 10px 14px; border-bottom: 1px solid #f1f5f9; font-size: 13px;
        }
        .risk-factors li:last-child { border-bottom: none; }
        .risk-tools { display: flex; flex-wrap: wrap; gap: 8px; }
        .risk-tool-chip {
          font-size: 11px; font-weight: 650; padding: 5px 10px;
          border-radius: 999px; background: #e2e8f0; color: #334155;
        }
      `}</style>
    </div>
  )
}

export function ShadowAiView({
  t,
  setError,
  setInfo
}: {
  t: (k: string, vars?: Record<string, string | number>) => string
  setError: (e: string | null) => void
  setInfo: (i: string | null) => void
}) {
  const [period, setPeriod] = useState<Period>("30d")
  const [status, setStatus] = useState<
    "all" | "authorized" | "unauthorized" | "unknown"
  >("all")
  const [q, setQ] = useState("")
  const [tools, setTools] = useState<ShadowTool[]>([])
  const [counts, setCounts] = useState({
    total: 0,
    authorized: 0,
    unauthorized: 0,
    unknown: 0
  })
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const r = await api.shadowAi({ period, status })
      setTools((r.tools || []) as ShadowTool[])
      setCounts(
        r.counts || { total: 0, authorized: 0, unauthorized: 0, unknown: 0 }
      )
      setSelected(new Set())
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }, [period, status, setError])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return tools
    return tools.filter(
      (x) =>
        x.tool.toLowerCase().includes(needle) ||
        (x.display_name || "").toLowerCase().includes(needle)
    )
  }, [tools, q])

  const setToolStatus = async (
    tool: string,
    next: "authorized" | "unauthorized" | "unknown"
  ) => {
    setBusy(true)
    try {
      await api.patchShadowAi(tool, next)
      setInfo(`${tool} → ${next}`)
      await load()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  const bulk = async (next: "authorized" | "unauthorized") => {
    if (!selected.size) return
    setBusy(true)
    try {
      for (const tool of selected) {
        await api.patchShadowAi(tool, next)
      }
      setInfo(`${selected.size} outil(s) → ${next}`)
      await load()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  const toggle = (tool: string) => {
    setSelected((prev) => {
      const n = new Set(prev)
      if (n.has(tool)) n.delete(tool)
      else n.add(tool)
      return n
    })
  }

  return (
    <div className="card shadow-page">
      <div className="risk-toolbar">
        <h2 style={{ margin: 0 }}>{t("shadow.title")}</h2>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <select
            className="input"
            value={period}
            onChange={(e) => setPeriod(e.target.value as Period)}
            style={{ width: 100 }}>
            <option value="7d">7 j</option>
            <option value="30d">30 j</option>
            <option value="90d">90 j</option>
          </select>
          <select
            className="input"
            value={status}
            onChange={(e) => setStatus(e.target.value as typeof status)}
            style={{ width: 140 }}>
            <option value="all">{t("shadow.filterAll")}</option>
            <option value="unauthorized">{t("shadow.filterUnauth")}</option>
            <option value="authorized">{t("shadow.filterAuth")}</option>
            <option value="unknown">{t("shadow.filterUnknown")}</option>
          </select>
          <input
            className="input"
            placeholder="Rechercher…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ width: 160 }}
          />
          <button
            type="button"
            className="btn secondary"
            disabled={busy}
            onClick={() => void load()}>
            {t("common.refresh") || "Actualiser"}
          </button>
        </div>
      </div>

      <div className="shadow-kpis">
        <div className="shadow-kpi">
          <span className="muted">{t("shadow.total")}</span>
          <strong>{counts.total}</strong>
        </div>
        <div className="shadow-kpi risk-high">
          <span className="muted">{t("shadow.unauth")}</span>
          <strong>{counts.unauthorized}</strong>
        </div>
        <div className="shadow-kpi risk-low">
          <span className="muted">{t("shadow.auth")}</span>
          <strong>{counts.authorized}</strong>
        </div>
        <div className="shadow-kpi">
          <span className="muted">{t("shadow.unknown")}</span>
          <strong>{counts.unknown}</strong>
        </div>
      </div>

      {selected.size > 0 && (
        <div className="shadow-bulk row" style={{ gap: 8, marginBottom: 12 }}>
          <span className="muted" style={{ fontSize: 13 }}>
            {selected.size} sélectionné(s)
          </span>
          <button
            type="button"
            className="btn secondary btn-sm"
            disabled={busy}
            onClick={() => void bulk("authorized")}>
            {t("shadow.markAuth")}
          </button>
          <button
            type="button"
            className="btn danger btn-sm"
            disabled={busy}
            onClick={() => void bulk("unauthorized")}>
            {t("shadow.markUnauth")}
          </button>
        </div>
      )}

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: 36 }} />
              <th>{t("shadow.colTool")}</th>
              <th>{t("shadow.colAgents")}</th>
              <th>{t("shadow.colEvents")}</th>
              <th>{t("shadow.colLast")}</th>
              <th>{t("shadow.colStatus")}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((tool) => (
              <tr key={tool.tool}>
                <td>
                  <input
                    type="checkbox"
                    checked={selected.has(tool.tool)}
                    onChange={() => toggle(tool.tool)}
                    aria-label={tool.tool}
                  />
                </td>
                <td>
                  <div style={{ fontWeight: 650 }}>
                    {tool.display_name || tool.tool}
                  </div>
                  <div className="mono muted" style={{ fontSize: 11 }}>
                    {tool.tool}
                  </div>
                </td>
                <td>{tool.agents_count}</td>
                <td>{tool.events_count}</td>
                <td className="muted" style={{ fontSize: 12 }}>
                  {relativeTime(tool.last_seen_at)}
                </td>
                <td>
                  <select
                    className="input"
                    style={{ width: 140, fontSize: 12 }}
                    value={tool.status}
                    disabled={busy}
                    onChange={(e) =>
                      void setToolStatus(
                        tool.tool,
                        e.target.value as ShadowTool["status"]
                      )
                    }>
                    <option value="authorized">Autorisé</option>
                    <option value="unauthorized">Non autorisé</option>
                    <option value="unknown">Inconnu</option>
                  </select>
                </td>
              </tr>
            ))}
            {!filtered.length && (
              <tr>
                <td colSpan={6} className="muted">
                  {t("shadow.empty")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <style>{`
        .shadow-page { padding: 4px 2px 16px; }
        .shadow-page .risk-toolbar {
          display: flex; justify-content: space-between; align-items: center;
          flex-wrap: wrap; gap: 16px; margin-bottom: 20px;
        }
        .shadow-page .risk-toolbar .input,
        .shadow-page .risk-toolbar select {
          min-height: 38px;
          margin: 0;
        }
        .shadow-page .risk-toolbar .row { gap: 12px !important; }
        .shadow-kpis {
          display: grid; grid-template-columns: repeat(4, minmax(0,1fr));
          gap: 16px; margin-bottom: 22px;
        }
        @media (max-width: 800px) {
          .shadow-kpis { grid-template-columns: repeat(2, 1fr); }
        }
        .shadow-kpi {
          padding: 16px 18px; border-radius: 12px;
          border: 1px solid var(--line, #e2e8f0); background: #f8fafc;
          display: flex; flex-direction: column; gap: 8px;
          min-height: 88px;
          box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
        }
        .shadow-kpi strong { font-size: 26px; font-weight: 800; line-height: 1.1; }
        .shadow-kpi.risk-high { border-color: #fecaca; background: #fef2f2; }
        .shadow-kpi.risk-low { border-color: #a7f3d0; background: #ecfdf5; }
        .shadow-page .table-wrap {
          border: 1px solid var(--line, #e2e8f0);
          border-radius: 12px;
          overflow: hidden;
          background: #fff;
        }
        .shadow-page .data-table { margin: 0; }
        .shadow-page .data-table th,
        .shadow-page .data-table td {
          padding: 14px 18px;
          vertical-align: middle;
        }
        .shadow-page .data-table th:nth-child(1),
        .shadow-page .data-table td:nth-child(1) { width: 44px; text-align: center; }
        .shadow-page .data-table th:nth-child(3),
        .shadow-page .data-table td:nth-child(3) { width: 110px; text-align: center; }
        .shadow-page .data-table th:nth-child(4),
        .shadow-page .data-table td:nth-child(4) { width: 110px; text-align: center; }
        .shadow-page .data-table th:nth-child(5),
        .shadow-page .data-table td:nth-child(5) { width: 120px; }
        .shadow-page .data-table th:nth-child(6),
        .shadow-page .data-table td:nth-child(6) { width: 160px; }
        .shadow-page .data-table select.input {
          min-height: 36px;
          width: 100%;
          max-width: 150px;
        }
        .shadow-bulk {
          margin-bottom: 16px !important;
          padding: 12px 16px;
          border-radius: 10px;
          background: #f8fafc;
          border: 1px solid var(--line, #e2e8f0);
          gap: 12px !important;
        }
      `}</style>
    </div>
  )
}
