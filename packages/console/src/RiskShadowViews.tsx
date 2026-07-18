/**
 * Risk Score + Shadow AI Discovery — UI console pro (dense, soignée)
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
  if (score >= 70) return "rs-high"
  if (score >= 40) return "rs-med"
  return "rs-low"
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

const SHARED_CSS = `
  .rs-page {
    background: var(--surface, #fff);
    border: 1px solid var(--line, #e2e8f0);
    border-radius: 10px;
    padding: 14px 16px 16px;
    margin-bottom: 16px;
  }
  .rs-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    margin-bottom: 12px;
    padding-bottom: 10px;
    border-bottom: 1px solid var(--line, #e2e8f0);
  }
  .rs-head h2 {
    margin: 0;
    font-size: 15px;
    font-weight: 700;
    letter-spacing: -0.01em;
    color: var(--text, #0f172a);
  }
  .rs-tools {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }
  .rs-tools .input,
  .rs-tools select.input {
    height: 30px;
    min-height: 30px;
    padding: 0 8px;
    font-size: 12px;
    border-radius: 6px;
  }
  .rs-tools .btn {
    height: 30px;
    padding: 0 10px;
    font-size: 12px;
    border-radius: 6px;
  }
  .rs-kpis {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 8px;
    margin-bottom: 12px;
  }
  @media (max-width: 900px) {
    .rs-kpis { grid-template-columns: repeat(2, 1fr); }
  }
  .rs-kpi {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 8px 10px;
    border-radius: 8px;
    border: 1px solid var(--line, #e2e8f0);
    background: var(--surface-2, #f8fafc);
    min-height: 0;
  }
  .rs-kpi.rs-high { border-color: #fecaca; background: #fef2f2; }
  .rs-kpi.rs-med { border-color: #fde68a; background: #fffbeb; }
  .rs-kpi.rs-low { border-color: #a7f3d0; background: #ecfdf5; }
  .rs-kpi-l {
    font-size: 10px;
    font-weight: 600;
    color: #64748b;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }
  .rs-kpi-v {
    font-size: 18px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    line-height: 1.2;
    color: var(--text, #0f172a);
  }
  .rs-kpi-v span {
    font-size: 11px;
    font-weight: 600;
    color: #94a3b8;
    margin-left: 2px;
  }
  .rs-kpi-s {
    font-size: 11px;
    color: #64748b;
    font-weight: 500;
  }
  .rs-grid2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    margin-bottom: 10px;
  }
  @media (max-width: 960px) {
    .rs-grid2 { grid-template-columns: 1fr; }
  }
  .rs-panel {
    border: 1px solid var(--line, #e2e8f0);
    border-radius: 8px;
    background: var(--surface, #fff);
    overflow: hidden;
  }
  .rs-panel-h {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 7px 10px;
    border-bottom: 1px solid var(--line, #e2e8f0);
    background: var(--surface-2, #f8fafc);
  }
  .rs-panel-h strong {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: #475569;
  }
  .rs-panel-b { padding: 0; }
  .rs-dist { padding: 8px 10px; display: flex; flex-direction: column; gap: 6px; }
  .rs-dist-row {
    display: grid;
    grid-template-columns: 56px 1fr 28px;
    gap: 8px;
    align-items: center;
  }
  .rs-dist-l { font-size: 11px; font-weight: 600; color: #475569; }
  .rs-dist-t {
    height: 6px;
    border-radius: 99px;
    background: #e2e8f0;
    overflow: hidden;
  }
  .rs-dist-f { height: 100%; border-radius: 99px; min-width: 2px; }
  .rs-dist-f.rs-low { background: #34d399; }
  .rs-dist-f.rs-med { background: #fbbf24; }
  .rs-dist-f.rs-high { background: #f87171; }
  .rs-dist-n {
    font-size: 11px;
    font-weight: 700;
    text-align: right;
    font-variant-numeric: tabular-nums;
    color: #334155;
  }
  .rs-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }
  .rs-table th {
    text-align: left;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: #64748b;
    padding: 6px 10px;
    border-bottom: 1px solid var(--line, #e2e8f0);
    background: transparent;
    white-space: nowrap;
  }
  .rs-table td {
    padding: 6px 10px;
    border-bottom: 1px solid #f1f5f9;
    vertical-align: middle;
    color: var(--text, #0f172a);
    font-variant-numeric: tabular-nums;
  }
  .rs-table tr:last-child td { border-bottom: none; }
  .rs-table tbody tr { cursor: pointer; transition: background 0.1s; }
  .rs-table tbody tr:hover { background: #f8fafc; }
  .rs-table tbody tr.is-on { background: rgba(45, 212, 191, 0.1); }
  .rs-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 28px;
    padding: 1px 6px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .rs-badge.rs-high { background: #fee2e2; color: #b91c1c; }
  .rs-badge.rs-med { background: #fef3c7; color: #b45309; }
  .rs-badge.rs-low { background: #d1fae5; color: #047857; }
  .rs-dot {
    display: inline-block;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    vertical-align: middle;
  }
  .rs-dot.rs-high { background: #ef4444; }
  .rs-dot.rs-med { background: #f59e0b; }
  .rs-dot.rs-low { background: #10b981; }
  .rs-muted { color: #94a3b8; font-size: 11px; }
  .rs-link {
    border: none;
    background: transparent;
    color: #0f766e;
    font-size: 11px;
    font-weight: 650;
    cursor: pointer;
    padding: 0;
  }
  .rs-link:hover { text-decoration: underline; }
  .rs-split {
    display: grid;
    grid-template-columns: minmax(0, 1.35fr) minmax(260px, 0.9fr);
    gap: 10px;
    align-items: start;
  }
  @media (max-width: 1000px) {
    .rs-split { grid-template-columns: 1fr; }
  }
  .rs-detail {
    border: 1px solid var(--line, #e2e8f0);
    border-radius: 8px;
    background: var(--surface-2, #f8fafc);
    padding: 10px 12px;
    min-height: 120px;
  }
  .rs-detail-title {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
    flex-wrap: wrap;
  }
  .rs-detail-title strong {
    font-size: 13px;
    font-weight: 700;
  }
  .rs-section {
    margin-top: 10px;
  }
  .rs-section > .rs-sec-l {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: #64748b;
    margin-bottom: 5px;
  }
  .rs-factors {
    list-style: none;
    margin: 0;
    padding: 0;
    border: 1px solid var(--line, #e2e8f0);
    border-radius: 6px;
    background: #fff;
    overflow: hidden;
  }
  .rs-factors li {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    padding: 5px 8px;
    font-size: 11px;
    border-bottom: 1px solid #f1f5f9;
  }
  .rs-factors li:last-child { border-bottom: none; }
  .rs-chips { display: flex; flex-wrap: wrap; gap: 4px; }
  .rs-chip {
    font-size: 10px;
    font-weight: 600;
    padding: 2px 7px;
    border-radius: 999px;
    background: #e2e8f0;
    color: #334155;
  }
  .rs-empty {
    padding: 16px 10px;
    text-align: center;
    color: #94a3b8;
    font-size: 12px;
  }
  .rs-status {
    display: inline-flex;
    align-items: center;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.02em;
    padding: 2px 7px;
    border-radius: 999px;
  }
  .rs-status.authorized { background: #d1fae5; color: #047857; }
  .rs-status.unauthorized { background: #fee2e2; color: #b91c1c; }
  .rs-status.unknown { background: #e2e8f0; color: #475569; }
  .rs-select-sm {
    height: 28px !important;
    min-height: 28px !important;
    padding: 0 6px !important;
    font-size: 11px !important;
    border-radius: 6px !important;
    max-width: 132px;
  }
  .rs-bulk {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    padding: 6px 10px;
    margin-bottom: 8px;
    border-radius: 6px;
    border: 1px solid var(--line, #e2e8f0);
    background: var(--surface-2, #f8fafc);
    font-size: 12px;
  }
  .rs-legend {
    margin: 6px 0 0;
    font-size: 10px;
    color: #94a3b8;
  }
`

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
    <div className="rs-page">
      <div className="rs-head">
        <h2>{t("risk.title")}</h2>
        <div className="rs-tools">
          <select
            className="input"
            value={period}
            onChange={(e) => setPeriod(e.target.value as Period)}
            style={{ width: 84 }}>
            <option value="7d">7 j</option>
            <option value="30d">30 j</option>
            <option value="90d">90 j</option>
          </select>
          <select
            className="input"
            value={minScore}
            onChange={(e) => setMinScore(Number(e.target.value))}
            style={{ width: 110 }}>
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
          <div className="rs-kpis">
            <div className={`rs-kpi ${scoreClass(summary.average_score)}`}>
              <div className="rs-kpi-l">{t("risk.avgScore")}</div>
              <div className="rs-kpi-v">
                {summary.average_score}
                <span>/100</span>
              </div>
            </div>
            <div className="rs-kpi rs-high">
              <div className="rs-kpi-l">{t("risk.highUsers")}</div>
              <div className="rs-kpi-v">{summary.high_risk_users}</div>
            </div>
            <div className="rs-kpi">
              <div className="rs-kpi-l">Tendance</div>
              <div className="rs-kpi-v">
                {trendGlyph(summary.trend)}
                {trendPts != null ? (
                  <span>
                    {trendPts > 0 ? "+" : ""}
                    {trendPts}
                  </span>
                ) : null}
              </div>
            </div>
            <div className="rs-kpi">
              <div className="rs-kpi-l">Shadow</div>
              <div className="rs-kpi-v">{shadowUnauth}</div>
              <div className="rs-kpi-s">non autorisés</div>
            </div>
          </div>

          <div className="rs-grid2">
            <div className="rs-panel">
              <div className="rs-panel-h">
                <strong>Répartition</strong>
                <span className="rs-muted">{summary.users_count} users</span>
              </div>
              <div className="rs-dist">
                {(
                  [
                    ["Low", summary.low_risk_users, "rs-low"],
                    ["Medium", summary.medium_risk_users, "rs-med"],
                    ["High", summary.high_risk_users, "rs-high"]
                  ] as const
                ).map(([label, n, cls]) => (
                  <div key={label} className="rs-dist-row">
                    <span className="rs-dist-l">{label}</span>
                    <div className="rs-dist-t">
                      <div
                        className={`rs-dist-f ${cls}`}
                        style={{
                          width: `${Math.round((n / maxBucket) * 100)}%`
                        }}
                      />
                    </div>
                    <span className="rs-dist-n">{n}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rs-panel">
              <div className="rs-panel-h">
                <strong>Top risque</strong>
              </div>
              <table className="rs-table">
                <thead>
                  <tr>
                    <th style={{ width: 28 }}>#</th>
                    <th>{t("risk.colUser")}</th>
                    <th style={{ width: 56 }}>{t("risk.colScore")}</th>
                    <th style={{ width: 40 }} />
                    <th style={{ width: 40 }} />
                  </tr>
                </thead>
                <tbody>
                  {top5.map((u, i) => (
                    <tr key={u.agent_id}>
                      <td className="rs-muted">{i + 1}</td>
                      <td>{u.label}</td>
                      <td>
                        <span className={`rs-badge ${scoreClass(u.score)}`}>
                          {u.score}
                        </span>
                      </td>
                      <td className="rs-muted">{trendGlyph(u.trend)}</td>
                      <td>
                        <button
                          type="button"
                          className="rs-link"
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
                      <td colSpan={5} className="rs-empty">
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

      <div className="rs-split">
        <div className="rs-panel">
          <div className="rs-panel-h">
            <strong>{t("risk.usersList")}</strong>
            <span className="rs-muted">{users.length}</span>
          </div>
          <table className="rs-table">
            <thead>
              <tr>
                <th style={{ width: 22 }} />
                <th>{t("risk.colUser")}</th>
                <th style={{ width: 52 }}>{t("risk.colScore")}</th>
                <th style={{ width: 36 }}>{t("risk.colTrend")}</th>
                <th style={{ width: 64 }}>Activité</th>
                <th style={{ width: 48 }}>Shadow</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr
                  key={u.agent_id}
                  className={
                    selected?.agent_id === u.agent_id ? "is-on" : undefined
                  }
                  onClick={() => void openDetail(u)}>
                  <td>
                    <span className={`rs-dot ${scoreClass(u.score)}`} />
                  </td>
                  <td>{u.label}</td>
                  <td>
                    <span className={`rs-badge ${scoreClass(u.score)}`}>
                      {u.score}
                    </span>
                  </td>
                  <td className="rs-muted">{trendGlyph(u.trend)}</td>
                  <td className="rs-muted">{relativeTime(u.last_event_at)}</td>
                  <td className="rs-muted">{u.tools?.length || 0}</td>
                </tr>
              ))}
              {!users.length && (
                <tr>
                  <td colSpan={6} className="rs-empty">
                    {t("risk.emptyUsers")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <p className="rs-legend" style={{ padding: "0 10px 8px" }}>
            ● High (≥70) · Medium (40–69) · Low (&lt;40)
          </p>
        </div>

        <div className="rs-detail">
          <div className="rs-sec-l rs-section" style={{ marginTop: 0 }}>
            <span className="rs-kpi-l">{t("risk.detail")}</span>
          </div>
          {!detail ? (
            <p className="rs-empty" style={{ paddingTop: 24 }}>
              {t("risk.pickUser")}
            </p>
          ) : (
            <>
              <div className="rs-detail-title">
                <strong>{detail.user.label}</strong>
                <span className={`rs-badge ${scoreClass(detail.user.score)}`}>
                  {detail.user.score}
                </span>
                <span className="rs-muted">
                  {trendGlyph(detail.user.trend)}
                  {detail.user.score_previous != null
                    ? ` vs ${detail.user.score_previous}`
                    : ""}
                </span>
              </div>

              <div className="rs-section">
                <div className="rs-sec-l">{t("risk.whyScore")}</div>
                <ul className="rs-factors">
                  {Object.entries(detail.user.factors || {})
                    .filter(([, v]) => v)
                    .map(([k, v]) => (
                      <li key={k}>
                        <span>{FACTOR_LABELS[k] || k}</span>
                        <strong>{v}</strong>
                      </li>
                    ))}
                  {!Object.values(detail.user.factors || {}).some(Boolean) && (
                    <li className="rs-muted">Aucun facteur</li>
                  )}
                </ul>
              </div>

              <div className="rs-section">
                <div className="rs-sec-l">{t("risk.toolsUsed")}</div>
                <div className="rs-chips">
                  {(detail.user.tools || []).length
                    ? detail.user.tools.map((tool) => (
                        <span key={tool} className="rs-chip">
                          {tool}
                        </span>
                      ))
                    : "—"}
                </div>
              </div>

              <div className="rs-section">
                <div className="rs-sec-l">{t("risk.recentEvents")}</div>
                <div
                  className="rs-panel"
                  style={{ maxHeight: 160, overflow: "auto" }}>
                  <table className="rs-table">
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
                        <tr key={e.id} style={{ cursor: "default" }}>
                          <td className="rs-muted">
                            {(e.ts || "").slice(0, 16).replace("T", " ")}
                          </td>
                          <td>{e.decision}</td>
                          <td className="rs-muted">{e.hostname}</td>
                          <td className="rs-muted">{e.highest_severity}</td>
                        </tr>
                      ))}
                      {!(detail.recent_events || []).length && (
                        <tr>
                          <td colSpan={4} className="rs-empty">
                            —
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
      <style>{SHARED_CSS}</style>
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
    <div className="rs-page">
      <div className="rs-head">
        <h2>{t("shadow.title")}</h2>
        <div className="rs-tools">
          <select
            className="input"
            value={period}
            onChange={(e) => setPeriod(e.target.value as Period)}
            style={{ width: 84 }}>
            <option value="7d">7 j</option>
            <option value="30d">30 j</option>
            <option value="90d">90 j</option>
          </select>
          <select
            className="input"
            value={status}
            onChange={(e) => setStatus(e.target.value as typeof status)}
            style={{ width: 120 }}>
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
            style={{ width: 140 }}
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

      <div className="rs-kpis">
        <div className="rs-kpi">
          <div className="rs-kpi-l">{t("shadow.total")}</div>
          <div className="rs-kpi-v">{counts.total}</div>
        </div>
        <div className="rs-kpi rs-high">
          <div className="rs-kpi-l">{t("shadow.unauth")}</div>
          <div className="rs-kpi-v">{counts.unauthorized}</div>
        </div>
        <div className="rs-kpi rs-low">
          <div className="rs-kpi-l">{t("shadow.auth")}</div>
          <div className="rs-kpi-v">{counts.authorized}</div>
        </div>
        <div className="rs-kpi">
          <div className="rs-kpi-l">{t("shadow.unknown")}</div>
          <div className="rs-kpi-v">{counts.unknown}</div>
        </div>
      </div>

      {selected.size > 0 && (
        <div className="rs-bulk">
          <span className="rs-muted">{selected.size} sélectionné(s)</span>
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

      <div className="rs-panel">
        <table className="rs-table">
          <thead>
            <tr>
              <th style={{ width: 32 }} />
              <th>{t("shadow.colTool")}</th>
              <th style={{ width: 72 }}>{t("shadow.colAgents")}</th>
              <th style={{ width: 72 }}>{t("shadow.colEvents")}</th>
              <th style={{ width: 88 }}>{t("shadow.colLast")}</th>
              <th style={{ width: 140 }}>{t("shadow.colStatus")}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((tool) => (
              <tr key={tool.tool} style={{ cursor: "default" }}>
                <td>
                  <input
                    type="checkbox"
                    checked={selected.has(tool.tool)}
                    onChange={() => toggle(tool.tool)}
                    aria-label={tool.tool}
                  />
                </td>
                <td>
                  <div style={{ fontWeight: 650, fontSize: 12 }}>
                    {tool.display_name || tool.tool}
                  </div>
                  <div className="rs-muted" style={{ fontFamily: "ui-monospace, monospace" }}>
                    {tool.tool}
                  </div>
                </td>
                <td>{tool.agents_count}</td>
                <td>{tool.events_count}</td>
                <td className="rs-muted">{relativeTime(tool.last_seen_at)}</td>
                <td>
                  <select
                    className="input rs-select-sm"
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
                <td colSpan={6} className="rs-empty">
                  {t("shadow.empty")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <style>{SHARED_CSS}</style>
    </div>
  )
}
