/**
 * Layout dashboard libre (ordre + taille) - localStorage par navigateur.
 * Les widgets peuvent être retirés puis ré-ajoutés via « + Métrique ».
 * v3 : widgets AI Security (Secure Rewrite, Risk, Shadow).
 */

export type DashWidgetId =
  | "licenses"
  | "connectivity"
  | "protection"
  | "activity"
  | "timeline"
  | "threats"
  | "requesters"
  | "ai_rewrite"
  | "risk_snapshot"
  | "shadow_snapshot"
  | "proxy_fleet"

export type DashWidgetLayout = {
  id: DashWidgetId
  /** Colonnes 1–3 (grille 3 colonnes) */
  w: 1 | 2 | 3
  /** Hauteur contenu en px */
  h: number
}

const KEY = "opsgate_dash_layout_v4"
const KEY_V3 = "opsgate_dash_layout_v3"
const KEY_V2 = "opsgate_dash_layout_v2"
const KEY_V1 = "opsgate_dash_layout_v1"

export const DASH_WIDGET_META: Record<
  DashWidgetId,
  { labelKey: string; defaultW: 1 | 2 | 3; defaultH: number }
> = {
  licenses: { labelKey: "nav.licenses", defaultW: 1, defaultH: 200 },
  connectivity: { labelKey: "nav.connectivity", defaultW: 1, defaultH: 200 },
  protection: { labelKey: "dash.protection", defaultW: 1, defaultH: 200 },
  activity: { labelKey: "dash.activity", defaultW: 1, defaultH: 210 },
  timeline: { labelKey: "dash.events14", defaultW: 1, defaultH: 190 },
  threats: { labelKey: "dash.userDecisions", defaultW: 1, defaultH: 210 },
  requesters: { labelKey: "dash.topRequesters", defaultW: 1, defaultH: 210 },
  ai_rewrite: { labelKey: "dash.aiRewrite", defaultW: 1, defaultH: 200 },
  risk_snapshot: { labelKey: "dash.riskSnapshot", defaultW: 1, defaultH: 210 },
  shadow_snapshot: { labelKey: "dash.shadowSnapshot", defaultW: 1, defaultH: 200 },
  proxy_fleet: { labelKey: "dash.proxyFleet", defaultW: 1, defaultH: 210 }
}

export const ALL_DASH_WIDGET_IDS = Object.keys(
  DASH_WIDGET_META
) as DashWidgetId[]

export const DEFAULT_DASH_LAYOUT: DashWidgetLayout[] = ALL_DASH_WIDGET_IDS.map(
  (id) => ({
    id,
    w: DASH_WIDGET_META[id].defaultW,
    h: DASH_WIDGET_META[id].defaultH
  })
)

const VALID = new Set<DashWidgetId>(ALL_DASH_WIDGET_IDS)

function parseLayout(raw: string | null): DashWidgetLayout[] | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as DashWidgetLayout[]
    if (!Array.isArray(parsed)) return null
    const seen = new Set<string>()
    const out: DashWidgetLayout[] = []
    for (const item of parsed) {
      if (!item || !VALID.has(item.id as DashWidgetId)) continue
      if (seen.has(item.id)) continue
      seen.add(item.id)
      const w = item.w === 2 || item.w === 3 ? item.w : 1
      const h = Math.min(520, Math.max(140, Math.floor(Number(item.h) || 200)))
      out.push({ id: item.id as DashWidgetId, w, h })
    }
    return out
  } catch {
    return null
  }
}

/** Ajoute les widgets récents manquants en fin de layout (migration douce). */
function ensureNewWidgets(layout: DashWidgetLayout[]): DashWidgetLayout[] {
  const have = new Set(layout.map((x) => x.id))
  const next = [...layout]
  for (const id of [
    "ai_rewrite",
    "risk_snapshot",
    "shadow_snapshot",
    "proxy_fleet"
  ] as const) {
    if (!have.has(id)) {
      next.push({
        id,
        w: DASH_WIDGET_META[id].defaultW,
        h: DASH_WIDGET_META[id].defaultH
      })
    }
  }
  return next
}

export function loadDashLayout(): DashWidgetLayout[] {
  try {
    const rawV4 = localStorage.getItem(KEY)
    const rawV3 = localStorage.getItem(KEY_V3)
    const rawV2 = localStorage.getItem(KEY_V2)
    const rawV1 = localStorage.getItem(KEY_V1)
    const parsed =
      parseLayout(rawV4) ||
      parseLayout(rawV3) ||
      parseLayout(rawV2) ||
      parseLayout(rawV1)
    if (!parsed) return DEFAULT_DASH_LAYOUT.map((x) => ({ ...x }))
    // Tableau vide = utilisateur a retiré toutes les métriques (respecté)
    if (parsed.length === 0) return []
    const withNew = rawV4 ? parsed : ensureNewWidgets(parsed)
    if (!rawV4) saveDashLayout(withNew)
    return withNew
  } catch {
    return DEFAULT_DASH_LAYOUT.map((x) => ({ ...x }))
  }
}

export function saveDashLayout(layout: DashWidgetLayout[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(layout))
    window.dispatchEvent(
      new CustomEvent("opsgate-dash-layout", { detail: layout })
    )
  } catch {
    /* ignore */
  }
}

export function resetDashLayout(): DashWidgetLayout[] {
  const next = DEFAULT_DASH_LAYOUT.map((x) => ({ ...x }))
  saveDashLayout(next)
  return next
}

export function moveWidget(
  layout: DashWidgetLayout[],
  fromId: DashWidgetId,
  toId: DashWidgetId
): DashWidgetLayout[] {
  if (fromId === toId) return layout
  const next = [...layout]
  const fi = next.findIndex((x) => x.id === fromId)
  const ti = next.findIndex((x) => x.id === toId)
  if (fi < 0 || ti < 0) return layout
  const [item] = next.splice(fi, 1)
  next.splice(ti, 0, item)
  return next
}

export function patchWidget(
  layout: DashWidgetLayout[],
  id: DashWidgetId,
  patch: Partial<Pick<DashWidgetLayout, "w" | "h">>
): DashWidgetLayout[] {
  return layout.map((x) =>
    x.id === id
      ? {
          ...x,
          w: patch.w === 2 || patch.w === 3 || patch.w === 1 ? patch.w : x.w,
          h:
            patch.h != null
              ? Math.min(520, Math.max(140, Math.floor(patch.h)))
              : x.h
        }
      : x
  )
}

export function removeWidget(
  layout: DashWidgetLayout[],
  id: DashWidgetId
): DashWidgetLayout[] {
  return layout.filter((x) => x.id !== id)
}

export function addWidget(
  layout: DashWidgetLayout[],
  id: DashWidgetId
): DashWidgetLayout[] {
  if (layout.some((x) => x.id === id)) return layout
  const meta = DASH_WIDGET_META[id]
  return [
    ...layout,
    { id, w: meta.defaultW, h: meta.defaultH }
  ]
}

export function availableWidgets(
  layout: DashWidgetLayout[]
): DashWidgetId[] {
  const have = new Set(layout.map((x) => x.id))
  return ALL_DASH_WIDGET_IDS.filter((id) => !have.has(id))
}
