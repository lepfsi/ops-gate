/**
 * Risk Score + Shadow AI Discovery — dense console views (light polish)
 */
import { useCallback, useEffect, useMemo, useState } from "react"
import { api } from "./api"

type Period = "7d" | "30d" | "90d"
type TFn = (k: string, vars?: Record<string, string | number>) => string

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
  return `${Math.floor(diff / 86400_000)} d`
}

const FACTOR_KEYS: Record<string, string> = {
  high_detections: "risk.factor.highDet",
  medium_detections: "risk.factor.medDet",
  send_anyway_high: "risk.factor.sendHigh",
  send_anyway_medium: "risk.factor.sendMed",
  send_anyway_low: "risk.factor.sendLow",
  mask_or_rewrite: "risk.factor.mask",
  cancel: "risk.factor.cancel",
  shadow_unauthorized: "risk.factor.shadow",
  recurrence_days: "risk.factor.recurrence"
}

function factorLabel(t: TFn, key: string): string {
  const i18nKey = FACTOR_KEYS[key]
  return i18nKey ? t(i18nKey) : key
}

const SHARED_CSS = `
  .rs-page {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 14px 16px 16px;
    margin-bottom: 16px;
    box-shadow: var(--shadow);
  }
  .rs-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px 12px;
    flex-wrap: wrap;
    margin: -14px -16px 14px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--line);
    background:
      linear-gradient(90deg, rgba(43, 217, 197, 0.12), transparent 42%),
      var(--surface-2);
    border-radius: 12px 12px 0 0;
  }
  .rs-head h2 {
    margin: 0;
    font-size: 1rem;
    font-weight: 750;
    letter-spacing: -0.02em;
    color: var(--ink);
    line-height: 1.25;
  }
  .rs-tools {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }
  .rs-tools .input,
  .rs-tools select.input {
    height: 32px;
    min-height: 32px;
    padding: 0 9px;
    font-size: 12px;
    border-radius: 8px;
  }
  .rs-tools .btn {
    height: 32px;
    padding: 0 12px;
    font-size: 12px;
    border-radius: 8px;
  }
  .rs-kpis {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 10px;
    margin-bottom: 14px;
  }
  @media (max-width: 900px) {
    .rs-kpis { grid-template-columns: repeat(2, 1fr); }
  }
  .rs-kpi {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 12px 12px 11px;
    border-radius: 10px;
    border: 1px solid var(--line);
    background: var(--surface);
    min-height: 78px;
    box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
    border-left: 3px solid var(--accent);
  }
  .rs-kpi.rs-high {
    border-left-color: #ef4444;
    background: linear-gradient(180deg, #fef2f2 0%, var(--surface) 70%);
  }
  .rs-kpi.rs-med {
    border-left-color: #f59e0b;
    background: linear-gradient(180deg, #fffbeb 0%, var(--surface) 70%);
  }
  .rs-kpi.rs-low {
    border-left-color: #10b981;
    background: linear-gradient(180deg, #ecfdf5 0%, var(--surface) 70%);
  }
  .rs-kpi-l {
    font-size: 11px;
    font-weight: 650;
    color: var(--muted);
    letter-spacing: 0.01em;
  }
  .rs-kpi-v {
    font-size: 1.45rem;
    font-weight: 750;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.03em;
    line-height: 1.15;
    color: var(--ink);
  }
  .rs-kpi-v.rs-high { color: var(--danger); }
  .rs-kpi-v.rs-med { color: var(--warn); }
  .rs-kpi-v.rs-low { color: var(--ok); }
  .rs-kpi-v span {
    font-size: 12px;
    font-weight: 650;
    color: var(--gray);
    margin-left: 2px;
    letter-spacing: 0;
  }
  .rs-kpi-s {
    font-size: 11px;
    color: var(--muted);
    font-weight: 500;
    line-height: 1.3;
  }
  .rs-grid2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    margin-bottom: 12px;
  }
  @media (max-width: 960px) {
    .rs-grid2 { grid-template-columns: 1fr; }
  }
  .rs-panel {
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--surface);
    overflow: hidden;
    box-shadow: 0 1px 2px rgba(15, 23, 42, 0.03);
  }
  .rs-panel-h {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 9px 12px;
    border-bottom: 1px solid var(--line);
    background: linear-gradient(180deg, var(--surface-2), var(--surface));
  }
  .rs-panel-h strong {
    font-size: 11.5px;
    font-weight: 700;
    letter-spacing: 0.01em;
    color: var(--ink);
    text-transform: none;
  }
  .rs-panel-b { padding: 0; }
  .rs-dist { padding: 12px 12px 14px; display: flex; flex-direction: column; gap: 10px; }
  .rs-dist-row {
    display: grid;
    grid-template-columns: 72px 1fr 32px;
    gap: 10px;
    align-items: center;
  }
  .rs-dist-l { font-size: 12px; font-weight: 650; color: var(--ink-2); }
  .rs-dist-t {
    height: 9px;
    border-radius: 99px;
    background: #e8eef5;
    overflow: hidden;
  }
  .rs-dist-f { height: 100%; border-radius: 99px; min-width: 3px; }
  .rs-dist-f.rs-low { background: linear-gradient(90deg, #34d399, #10b981); }
  .rs-dist-f.rs-med { background: linear-gradient(90deg, #fbbf24, #f59e0b); }
  .rs-dist-f.rs-high { background: linear-gradient(90deg, #f87171, #ef4444); }
  .rs-dist-n {
    font-size: 12px;
    font-weight: 750;
    text-align: right;
    font-variant-numeric: tabular-nums;
    color: var(--ink);
  }
  .rs-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12.5px;
  }
  .rs-table th {
    text-align: left;
    font-size: 10.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
    padding: 8px 12px;
    border-bottom: 1px solid var(--line);
    background: var(--surface-2);
    white-space: nowrap;
  }
  .rs-table td {
    padding: 9px 12px;
    border-bottom: 1px solid #eef2f7;
    vertical-align: middle;
    color: var(--ink);
    font-variant-numeric: tabular-nums;
  }
  .rs-table tr:last-child td { border-bottom: none; }
  .rs-table tbody tr { cursor: pointer; transition: background 0.12s; }
  .rs-table tbody tr:hover { background: #f4faf9; }
  .rs-table tbody tr.is-on {
    background: var(--accent-soft);
    box-shadow: inset 3px 0 0 var(--accent);
  }
  .rs-table tbody tr.rs-row-unauth {
    background: linear-gradient(90deg, rgba(254, 242, 242, 0.85), transparent 40%);
  }
  .rs-table tbody tr.rs-row-unauth:hover {
    background: #fef2f2;
  }
  .rs-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 34px;
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 750;
    font-variant-numeric: tabular-nums;
  }
  .rs-badge.rs-high { background: #fee2e2; color: #b91c1c; border: 1px solid #fecaca; }
  .rs-badge.rs-med { background: #fef3c7; color: #b45309; border: 1px solid #fde68a; }
  .rs-badge.rs-low { background: #d1fae5; color: #047857; border: 1px solid #a7f3d0; }
  .rs-badge-lg {
    min-width: 42px;
    padding: 4px 10px;
    font-size: 14px;
  }
  .rs-dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    vertical-align: middle;
    box-shadow: 0 0 0 2px rgba(255,255,255,0.9);
  }
  .rs-dot.rs-high { background: #ef4444; }
  .rs-dot.rs-med { background: #f59e0b; }
  .rs-dot.rs-low { background: #10b981; }
  .rs-muted { color: var(--gray); font-size: 11.5px; }
  .rs-link {
    border: none;
    background: transparent;
    color: var(--accent-ink);
    font-size: 11.5px;
    font-weight: 700;
    cursor: pointer;
    padding: 2px 0;
  }
  .rs-link:hover { text-decoration: underline; }
  .rs-pager {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    padding: 8px 12px 10px;
    border-top: 1px solid var(--line);
    background: var(--surface-2);
  }
  .rs-page-btn {
    appearance: none;
    border: 1px solid var(--line);
    background: var(--surface);
    color: var(--ink-2);
    font-size: 11.5px;
    font-weight: 650;
    padding: 5px 12px;
    border-radius: 999px;
    cursor: pointer;
    font-family: inherit;
    transition: border-color 0.12s, color 0.12s, background 0.12s;
  }
  .rs-page-btn:hover:not(:disabled) {
    border-color: var(--accent);
    color: var(--accent-ink);
    background: var(--accent-soft);
  }
  .rs-page-btn:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .rs-page-ind {
    font-size: 11.5px;
    font-weight: 650;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
    min-width: 40px;
    text-align: center;
  }
  .rs-split {
    display: grid;
    grid-template-columns: minmax(0, 1.35fr) minmax(280px, 0.9fr);
    gap: 12px;
    align-items: start;
  }
  @media (max-width: 1000px) {
    .rs-split { grid-template-columns: 1fr; }
  }
  .rs-detail {
    border: 1px solid var(--line);
    border-radius: 10px;
    background:
      linear-gradient(180deg, rgba(43, 217, 197, 0.06), transparent 48%),
      var(--surface);
    padding: 12px 14px;
    min-height: 140px;
    box-shadow: 0 1px 2px rgba(15, 23, 42, 0.03);
  }
  .rs-detail-title {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
    flex-wrap: wrap;
    padding-bottom: 10px;
    border-bottom: 1px solid var(--line);
  }
  .rs-detail-title strong {
    font-size: 14px;
    font-weight: 750;
    color: var(--ink);
  }
  .rs-score-meter {
    height: 6px;
    border-radius: 99px;
    background: #e8eef5;
    overflow: hidden;
    margin: 0 0 10px;
  }
  .rs-score-meter > i {
    display: block;
    height: 100%;
    border-radius: 99px;
  }
  .rs-score-meter > i.rs-high { background: linear-gradient(90deg, #f87171, #ef4444); }
  .rs-score-meter > i.rs-med { background: linear-gradient(90deg, #fbbf24, #f59e0b); }
  .rs-score-meter > i.rs-low { background: linear-gradient(90deg, #34d399, #10b981); }
  .rs-section {
    margin-top: 12px;
  }
  .rs-section > .rs-sec-l {
    font-size: 10.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
    margin-bottom: 6px;
  }
  .rs-factors {
    list-style: none;
    margin: 0;
    padding: 0;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--surface);
    overflow: hidden;
  }
  .rs-factors li {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    padding: 7px 10px;
    font-size: 12px;
    border-bottom: 1px solid #eef2f7;
  }
  .rs-factors li:last-child { border-bottom: none; }
  .rs-factors li strong {
    color: var(--ink);
    font-variant-numeric: tabular-nums;
  }
  .rs-chips { display: flex; flex-wrap: wrap; gap: 5px; }
  .rs-chip {
    font-size: 11px;
    font-weight: 650;
    padding: 3px 9px;
    border-radius: 999px;
    background: var(--accent-soft);
    color: var(--accent-ink);
    border: 1px solid rgba(43, 217, 197, 0.28);
  }
  .rs-empty {
    padding: 20px 12px;
    text-align: center;
    color: var(--gray);
    font-size: 12.5px;
  }
  .rs-tool-name {
    font-weight: 700;
    font-size: 12.5px;
    color: var(--ink);
  }
  .rs-tool-host {
    font-family: var(--mono);
    font-size: 10.5px;
    color: var(--gray);
    margin-top: 1px;
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
  .rs-status.authorized { background: #d1fae5; color: var(--ok); }
  .rs-status.unauthorized { background: #fee2e2; color: var(--danger); }
  .rs-status.unknown { background: var(--line); color: var(--ink-2); }
  .rs-select-sm {
    height: 30px !important;
    min-height: 30px !important;
    padding: 0 8px !important;
    font-size: 11.5px !important;
    border-radius: 8px !important;
    max-width: 148px;
    font-weight: 650 !important;
  }
  .rs-select-sm.rs-high {
    border-color: #fecaca !important;
    background: #fef2f2 !important;
    color: var(--danger) !important;
  }
  .rs-select-sm.rs-low {
    border-color: #a7f3d0 !important;
    background: #ecfdf5 !important;
    color: var(--ok) !important;
  }
  .rs-select-sm.rs-med {
    border-color: #e2e8f0 !important;
    background: var(--surface-2) !important;
    color: var(--ink-2) !important;
  }
  .rs-bulk {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    padding: 9px 12px;
    margin-bottom: 10px;
    border-radius: 8px;
    border: 1px solid rgba(43, 217, 197, 0.35);
    background: var(--accent-soft);
    font-size: 12.5px;
    font-weight: 550;
  }
  .rs-bulk .rs-muted { color: var(--accent-ink); font-weight: 650; }
  .rs-legend {
    margin: 0;
    padding: 8px 12px 10px;
    font-size: 10.5px;
    color: var(--muted);
    border-top: 1px solid var(--line);
    background: var(--surface-2);
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
  const [userPage, setUserPage] = useState(0)
  const USERS_PAGE = 20

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

  useEffect(() => {
    setUserPage(0)
  }, [period, minScore, users.length])

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

  const userPages = Math.max(1, Math.ceil(users.length / USERS_PAGE))
  const pageSafe = Math.min(userPage, userPages - 1)
  const pageUsers = users.slice(
    pageSafe * USERS_PAGE,
    pageSafe * USERS_PAGE + USERS_PAGE
  )

  return (
    <div className="rs-page">
      <div className="rs-head">
        <h2>{t("risk.title")}</h2>
        <div className="rs-tools">
          <select
            className="input"
            value={period}
            onChange={(e) => setPeriod(e.target.value as Period)}
            style={{ width: 100 }}
            aria-label={t("gw.period.30d")}>
            <option value="7d">{t("gw.period.7d")}</option>
            <option value="30d">{t("gw.period.30d")}</option>
            <option value="90d">{t("gw.period.90d")}</option>
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
            {t("common.refresh")}
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
              <div className={`rs-kpi-v ${scoreClass(summary.average_score)}`}>
                {summary.average_score}
                <span>/100</span>
              </div>
              {summary.previous_average_score != null ? (
                <div className="rs-kpi-s">
                  {t("risk.prevAvg", { n: summary.previous_average_score })}
                </div>
              ) : null}
            </div>
            <div className="rs-kpi rs-high">
              <div className="rs-kpi-l">{t("risk.highUsers")}</div>
              <div className="rs-kpi-v rs-high">{summary.high_risk_users}</div>
              <div className="rs-kpi-s">
                {t("risk.medUsers")} {summary.medium_risk_users} ·{" "}
                {t("risk.lowUsers")} {summary.low_risk_users}
              </div>
            </div>
            <div className="rs-kpi" title={t("risk.trendHint")}>
              <div className="rs-kpi-l">{t("risk.colTrend")}</div>
              <div
                className={`rs-kpi-v ${
                  summary.trend === "up"
                    ? "rs-high"
                    : summary.trend === "down"
                      ? "rs-low"
                      : ""
                }`}>
                {trendGlyph(summary.trend)}
                {trendPts != null ? (
                  <span>
                    {trendPts > 0 ? "+" : ""}
                    {trendPts}
                  </span>
                ) : null}
              </div>
              <div className="rs-kpi-s">{t("risk.trendLegend")}</div>
            </div>
            <div className={`rs-kpi ${shadowUnauth > 0 ? "rs-high" : "rs-low"}`}>
              <div className="rs-kpi-l">{t("risk.usersCount")}</div>
              <div className="rs-kpi-v">{summary.users_count}</div>
              <div className="rs-kpi-s">
                {t("risk.shadowUnauth", { n: shadowUnauth })}
              </div>
            </div>
          </div>

          <div className="rs-grid2">
            <div className="rs-panel">
              <div className="rs-panel-h">
                <strong>{t("risk.distribution")}</strong>
                <span className="rs-muted">
                  {summary.users_count} {t("risk.usersCount").toLowerCase()}
                </span>
              </div>
              <div className="rs-dist">
                {(
                  [
                    [t("gw.risk.low"), summary.low_risk_users, "rs-low"],
                    [t("gw.risk.medium"), summary.medium_risk_users, "rs-med"],
                    [t("gw.risk.high"), summary.high_risk_users, "rs-high"]
                  ] as const
                ).map(([label, n, cls]) => (
                  <div key={cls} className="rs-dist-row">
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
                <strong>{t("risk.topRisk")}</strong>
              </div>
              <table className="rs-table">
                <thead>
                  <tr>
                    <th style={{ width: 28 }}>#</th>
                    <th>{t("risk.colUser")}</th>
                    <th style={{ width: 56 }}>{t("risk.colScore")}</th>
                    <th style={{ width: 40 }} />
                    <th style={{ width: 48 }} />
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
                          {t("risk.view")}
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
            <span className="rs-muted">
              {users.length
                ? t("risk.pageOf", {
                    from: pageSafe * USERS_PAGE + 1,
                    to: Math.min(users.length, (pageSafe + 1) * USERS_PAGE),
                    total: users.length
                  })
                : 0}
            </span>
          </div>
          <table className="rs-table">
            <thead>
              <tr>
                <th style={{ width: 22 }} />
                <th>{t("risk.colUser")}</th>
                <th style={{ width: 52 }}>{t("risk.colScore")}</th>
                <th style={{ width: 36 }} title={t("risk.trendHint")}>
                  {t("risk.colTrend")}
                </th>
                <th style={{ width: 64 }}>{t("risk.colActivity")}</th>
                <th style={{ width: 52 }}>{t("risk.colTools")}</th>
              </tr>
            </thead>
            <tbody>
              {pageUsers.map((u) => (
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
                  <td
                    className="rs-muted"
                    title={
                      u.score_previous != null
                        ? t("risk.trendUserHint", {
                            prev: u.score_previous,
                            cur: u.score
                          })
                        : t("risk.trendNoPrev")
                    }>
                    {trendGlyph(u.trend)}
                  </td>
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
          {userPages > 1 ? (
            <div className="rs-pager">
              <button
                type="button"
                className="rs-page-btn"
                disabled={pageSafe <= 0}
                onClick={() => setUserPage((p) => Math.max(0, p - 1))}>
                {t("risk.prev")}
              </button>
              <span className="rs-page-ind">
                {pageSafe + 1} / {userPages}
              </span>
              <button
                type="button"
                className="rs-page-btn"
                disabled={pageSafe >= userPages - 1}
                onClick={() =>
                  setUserPage((p) => Math.min(userPages - 1, p + 1))
                }>
                {t("risk.next")}
              </button>
            </div>
          ) : null}
          <p className="rs-legend">{t("risk.legend")}</p>
        </div>

        <div className="rs-detail">
          <div className="rs-section" style={{ marginTop: 0 }}>
            <div className="rs-sec-l">{t("risk.detail")}</div>
          </div>
          {!detail ? (
            <p className="rs-empty" style={{ paddingTop: 24 }}>
              {t("risk.pickUser")}
            </p>
          ) : (
            <>
              <div className="rs-detail-title">
                <strong>{detail.user.label}</strong>
                <span
                  className={`rs-badge rs-badge-lg ${scoreClass(detail.user.score)}`}>
                  {detail.user.score}
                </span>
                <span className="rs-muted">
                  {trendGlyph(detail.user.trend)}
                  {detail.user.score_previous != null
                    ? ` · ${detail.user.score_previous}`
                    : ""}
                </span>
              </div>
              <div className="rs-score-meter" aria-hidden>
                <i
                  className={scoreClass(detail.user.score)}
                  style={{
                    width: `${Math.max(4, Math.min(100, detail.user.score))}%`
                  }}
                />
              </div>

              <div className="rs-section">
                <div className="rs-sec-l">{t("risk.whyScore")}</div>
                <ul className="rs-factors">
                  {Object.entries(detail.user.factors || {})
                    .filter(([, v]) => v)
                    .map(([k, v]) => (
                      <li key={k}>
                        <span>{factorLabel(t, k)}</span>
                        <strong>{v}</strong>
                      </li>
                    ))}
                  {!Object.values(detail.user.factors || {}).some(Boolean) && (
                    <li className="rs-muted">{t("risk.noFactors")}</li>
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
                        <th>{t("risk.colDate")}</th>
                        <th>{t("risk.colDecision")}</th>
                        <th>{t("risk.colHost")}</th>
                        <th>{t("risk.colSeverity")}</th>
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

  const statusLabel = (s: ShadowTool["status"]) => {
    if (s === "authorized") return t("shadow.markAuth")
    if (s === "unauthorized") return t("shadow.markUnauth")
    return t("shadow.markUnknown")
  }

  const setToolStatus = async (
    tool: string,
    next: "authorized" | "unauthorized" | "unknown"
  ) => {
    setBusy(true)
    try {
      await api.patchShadowAi(tool, next)
      setInfo(t("shadow.updated", { tool, status: statusLabel(next) }))
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
      setInfo(
        t("shadow.bulkUpdated", {
          n: selected.size,
          status: statusLabel(next)
        })
      )
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
            style={{ width: 100 }}
            aria-label={t("gw.period.30d")}>
            <option value="7d">{t("gw.period.7d")}</option>
            <option value="30d">{t("gw.period.30d")}</option>
            <option value="90d">{t("gw.period.90d")}</option>
          </select>
          <select
            className="input"
            value={status}
            onChange={(e) => setStatus(e.target.value as typeof status)}
            style={{ width: 128 }}>
            <option value="all">{t("shadow.filterAll")}</option>
            <option value="unauthorized">{t("shadow.filterUnauth")}</option>
            <option value="authorized">{t("shadow.filterAuth")}</option>
            <option value="unknown">{t("shadow.filterUnknown")}</option>
          </select>
          <input
            className="input"
            placeholder={t("shadow.search")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ width: 148 }}
            aria-label={t("shadow.search")}
          />
          <button
            type="button"
            className="btn secondary"
            disabled={busy}
            onClick={() => void load()}>
            {t("common.refresh")}
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
          <div className="rs-kpi-v rs-high">{counts.unauthorized}</div>
        </div>
        <div className="rs-kpi rs-low">
          <div className="rs-kpi-l">{t("shadow.auth")}</div>
          <div className="rs-kpi-v rs-low">{counts.authorized}</div>
        </div>
        <div className="rs-kpi rs-med">
          <div className="rs-kpi-l">{t("shadow.unknown")}</div>
          <div className="rs-kpi-v">{counts.unknown}</div>
        </div>
      </div>

      {selected.size > 0 && (
        <div className="rs-bulk">
          <span className="rs-muted">
            {t("shadow.selected", { n: selected.size })}
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

      <div className="rs-panel">
        <table className="rs-table">
          <thead>
            <tr>
              <th style={{ width: 32 }} />
              <th>{t("shadow.colTool")}</th>
              <th style={{ width: 72 }}>{t("shadow.colAgents")}</th>
              <th style={{ width: 72 }}>{t("shadow.colEvents")}</th>
              <th style={{ width: 88 }}>{t("shadow.colLast")}</th>
              <th style={{ width: 148 }}>{t("shadow.colStatus")}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((tool) => (
              <tr
                key={tool.tool}
                style={{ cursor: "default" }}
                className={
                  tool.status === "unauthorized" ? "rs-row-unauth" : undefined
                }>
                <td>
                  <input
                    type="checkbox"
                    checked={selected.has(tool.tool)}
                    onChange={() => toggle(tool.tool)}
                    aria-label={tool.tool}
                  />
                </td>
                <td>
                  <div className="rs-tool-name">
                    {tool.display_name || tool.tool}
                  </div>
                  <div className="rs-tool-host">{tool.tool}</div>
                </td>
                <td>{tool.agents_count}</td>
                <td>{tool.events_count}</td>
                <td className="rs-muted">{relativeTime(tool.last_seen_at)}</td>
                <td>
                  <select
                    className={`input rs-select-sm ${
                      tool.status === "unauthorized"
                        ? "rs-high"
                        : tool.status === "authorized"
                          ? "rs-low"
                          : "rs-med"
                    }`}
                    value={tool.status}
                    disabled={busy}
                    onChange={(e) =>
                      void setToolStatus(
                        tool.tool,
                        e.target.value as ShadowTool["status"]
                      )
                    }>
                    <option value="authorized">{t("shadow.markAuth")}</option>
                    <option value="unauthorized">
                      {t("shadow.markUnauth")}
                    </option>
                    <option value="unknown">{t("shadow.markUnknown")}</option>
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
