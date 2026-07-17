/**
 * Console V3 — Risk Score utilisateur + Shadow AI Discovery
 */
import { useCallback, useEffect, useState } from "react"
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

  const load = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const [s, u] = await Promise.all([
        api.riskSummary(period),
        api.riskUsers({ period, min_score: minScore, limit: 100 })
      ])
      setSummary(s as RiskSummary)
      setUsers((u.users || []) as RiskUser[])
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

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 style={{ margin: 0 }}>{t("risk.title")}</h2>
          <p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
            {t("risk.hint")}
          </p>
        </div>
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
            value={minScore}
            onChange={(e) => setMinScore(Number(e.target.value))}
            style={{ width: 120 }}>
            <option value={0}>{t("risk.filterAll")}</option>
            <option value={40}>{t("risk.filterMed")}</option>
            <option value={70}>{t("risk.filterHigh")}</option>
          </select>
          <button type="button" className="btn secondary" disabled={busy} onClick={() => void load()}>
            {t("common.refresh") || "Actualiser"}
          </button>
          <button
            type="button"
            className="btn"
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
        <div
          className="row"
          style={{ gap: 12, flexWrap: "wrap", marginTop: 16 }}>
          <div className={`risk-kpi ${scoreClass(summary.average_score)}`}>
            <div className="risk-kpi-label">{t("risk.avgScore")}</div>
            <div className="risk-kpi-value">{summary.average_score}</div>
            <div className="muted" style={{ fontSize: 12 }}>
              {trendGlyph(summary.trend)}{" "}
              {summary.previous_average_score != null
                ? `vs ${summary.previous_average_score}`
                : "—"}
            </div>
          </div>
          <div className="risk-kpi risk-high">
            <div className="risk-kpi-label">{t("risk.highUsers")}</div>
            <div className="risk-kpi-value">{summary.high_risk_users}</div>
          </div>
          <div className="risk-kpi risk-med">
            <div className="risk-kpi-label">{t("risk.medUsers")}</div>
            <div className="risk-kpi-value">{summary.medium_risk_users}</div>
          </div>
          <div className="risk-kpi risk-low">
            <div className="risk-kpi-label">{t("risk.lowUsers")}</div>
            <div className="risk-kpi-value">{summary.low_risk_users}</div>
          </div>
          <div className="risk-kpi">
            <div className="risk-kpi-label">{t("risk.usersCount")}</div>
            <div className="risk-kpi-value">{summary.users_count}</div>
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 20 }}>
        <div>
          <h3 style={{ marginTop: 0 }}>{t("risk.usersList")}</h3>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t("risk.colUser")}</th>
                  <th>{t("risk.colScore")}</th>
                  <th>{t("risk.colTrend")}</th>
                  <th>{t("risk.colEvents")}</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr
                    key={u.agent_id}
                    className={selected?.agent_id === u.agent_id ? "row-active" : ""}
                    style={{ cursor: "pointer" }}
                    onClick={() => void openDetail(u)}>
                    <td>{u.label}</td>
                    <td>
                      <span className={`risk-badge ${scoreClass(u.score)}`}>
                        {u.score}
                      </span>
                    </td>
                    <td>{trendGlyph(u.trend)}</td>
                    <td>{u.events_count}</td>
                  </tr>
                ))}
                {!users.length && (
                  <tr>
                    <td colSpan={4} className="muted">
                      {t("risk.emptyUsers")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h3 style={{ marginTop: 0 }}>{t("risk.detail")}</h3>
          {!detail ? (
            <p className="muted">{t("risk.pickUser")}</p>
          ) : (
            <div className="form-stack">
              <p style={{ margin: 0 }}>
                <strong>{detail.user.label}</strong>{" "}
                <span className={`risk-badge ${scoreClass(detail.user.score)}`}>
                  {detail.user.score}/100
                </span>
              </p>
              <p className="muted" style={{ fontSize: 12, margin: 0 }}>
                {t("risk.whyScore")}
              </p>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                {Object.entries(detail.user.factors || {})
                  .filter(([, v]) => v)
                  .map(([k, v]) => (
                    <li key={k}>
                      <code>{k}</code>: {v}
                    </li>
                  ))}
              </ul>
              <p style={{ fontSize: 13, margin: "8px 0 0" }}>
                <strong>{t("risk.toolsUsed")}:</strong>{" "}
                {detail.user.tools?.length
                  ? detail.user.tools.join(", ")
                  : "—"}
              </p>
              <h4 style={{ marginBottom: 6 }}>{t("risk.recentEvents")}</h4>
              <div className="table-wrap" style={{ maxHeight: 240, overflow: "auto" }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>TS</th>
                      <th>Decision</th>
                      <th>Host</th>
                      <th>Sev</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(detail.recent_events || []).map((e) => (
                      <tr key={e.id}>
                        <td className="mono" style={{ fontSize: 11 }}>
                          {(e.ts || "").slice(0, 19)}
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
          )}
        </div>
      </div>

      <style>{`
        .risk-kpi {
          min-width: 120px;
          padding: 12px 14px;
          border-radius: 8px;
          border: 1px solid var(--line, #e2e8f0);
          background: var(--surface-2, #f8fafc);
        }
        .risk-kpi-label { font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; }
        .risk-kpi-value { font-size: 28px; font-weight: 800; margin-top: 4px; }
        .risk-high { border-color: #fecaca; background: #fef2f2; }
        .risk-med { border-color: #fde68a; background: #fffbeb; }
        .risk-low { border-color: #a7f3d0; background: #ecfdf5; }
        .risk-badge {
          display: inline-block;
          padding: 2px 8px;
          border-radius: 999px;
          font-weight: 800;
          font-size: 12px;
        }
        .risk-badge.risk-high { background: #fee2e2; color: #b91c1c; }
        .risk-badge.risk-med { background: #fef3c7; color: #b45309; }
        .risk-badge.risk-low { background: #d1fae5; color: #047857; }
        .row-active { background: rgba(45, 212, 191, 0.12); }
        @media (max-width: 900px) {
          div[style*="grid-template-columns: 1fr 1fr"] {
            grid-template-columns: 1fr !important;
          }
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
  const [status, setStatus] = useState<"all" | "authorized" | "unauthorized" | "unknown">("all")
  const [tools, setTools] = useState<ShadowTool[]>([])
  const [counts, setCounts] = useState({
    total: 0,
    authorized: 0,
    unauthorized: 0,
    unknown: 0
  })
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const r = await api.shadowAi({ period, status })
      setTools((r.tools || []) as ShadowTool[])
      setCounts(
        r.counts || { total: 0, authorized: 0, unauthorized: 0, unknown: 0 }
      )
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }, [period, status, setError])

  useEffect(() => {
    void load()
  }, [load])

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

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 style={{ margin: 0 }}>{t("shadow.title")}</h2>
          <p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
            {t("shadow.hint")}
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
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
            onChange={(e) =>
              setStatus(e.target.value as typeof status)
            }
            style={{ width: 140 }}>
            <option value="all">{t("shadow.filterAll")}</option>
            <option value="unauthorized">{t("shadow.filterUnauth")}</option>
            <option value="authorized">{t("shadow.filterAuth")}</option>
            <option value="unknown">{t("shadow.filterUnknown")}</option>
          </select>
          <button type="button" className="btn secondary" disabled={busy} onClick={() => void load()}>
            {t("common.refresh") || "Actualiser"}
          </button>
        </div>
      </div>

      <div className="row" style={{ gap: 12, marginTop: 14, flexWrap: "wrap" }}>
        <span className="muted">{t("shadow.total")}: <strong>{counts.total}</strong></span>
        <span className="muted">{t("shadow.unauth")}: <strong>{counts.unauthorized}</strong></span>
        <span className="muted">{t("shadow.auth")}: <strong>{counts.authorized}</strong></span>
        <span className="muted">{t("shadow.unknown")}: <strong>{counts.unknown}</strong></span>
      </div>

      <div className="table-wrap" style={{ marginTop: 16 }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>{t("shadow.colTool")}</th>
              <th>{t("shadow.colStatus")}</th>
              <th>{t("shadow.colEvents")}</th>
              <th>{t("shadow.colAgents")}</th>
              <th>{t("shadow.colLast")}</th>
              <th>{t("shadow.colActions")}</th>
            </tr>
          </thead>
          <tbody>
            {tools.map((tool) => (
              <tr key={tool.tool}>
                <td className="mono">{tool.display_name || tool.tool}</td>
                <td>
                  <span className={`shadow-status ${tool.status}`}>
                    {tool.status}
                  </span>
                </td>
                <td>{tool.events_count}</td>
                <td>{tool.agents_count}</td>
                <td className="mono" style={{ fontSize: 11 }}>
                  {(tool.last_seen_at || "—").toString().slice(0, 19)}
                </td>
                <td>
                  <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      className="btn secondary"
                      style={{ fontSize: 11, padding: "4px 8px" }}
                      disabled={busy || tool.status === "authorized"}
                      onClick={() => void setToolStatus(tool.tool, "authorized")}>
                      {t("shadow.markAuth")}
                    </button>
                    <button
                      type="button"
                      className="btn danger"
                      style={{ fontSize: 11, padding: "4px 8px" }}
                      disabled={busy || tool.status === "unauthorized"}
                      onClick={() =>
                        void setToolStatus(tool.tool, "unauthorized")
                      }>
                      {t("shadow.markUnauth")}
                    </button>
                    <button
                      type="button"
                      className="btn secondary"
                      style={{ fontSize: 11, padding: "4px 8px" }}
                      disabled={busy || tool.status === "unknown"}
                      onClick={() => void setToolStatus(tool.tool, "unknown")}>
                      {t("shadow.markUnknown")}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!tools.length && (
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
        .shadow-status {
          font-size: 11px;
          font-weight: 800;
          padding: 2px 8px;
          border-radius: 999px;
          text-transform: uppercase;
        }
        .shadow-status.authorized { background: #d1fae5; color: #047857; }
        .shadow-status.unauthorized { background: #fee2e2; color: #b91c1c; }
        .shadow-status.unknown { background: #e2e8f0; color: #475569; }
      `}</style>
    </div>
  )
}
