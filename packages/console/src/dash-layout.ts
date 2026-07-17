/**
 * Layout dashboard libre (ordre + taille) — localStorage par navigateur.
 */

export type DashWidgetId =
  | "licenses"
  | "connectivity"
  | "protection"
  | "activity"
  | "timeline"
  | "threats"
  | "requesters"

export type DashWidgetLayout = {
  id: DashWidgetId
  /** Colonnes 1–3 (grille 3 colonnes) */
  w: 1 | 2 | 3
  /** Hauteur contenu en px */
  h: number
}

const KEY = "opsgate_dash_layout_v1"

export const DEFAULT_DASH_LAYOUT: DashWidgetLayout[] = [
  { id: "licenses", w: 1, h: 200 },
  { id: "connectivity", w: 1, h: 200 },
  { id: "protection", w: 1, h: 200 },
  { id: "activity", w: 1, h: 190 },
  { id: "timeline", w: 1, h: 190 },
  { id: "threats", w: 1, h: 210 },
  { id: "requesters", w: 1, h: 210 }
]

const VALID = new Set<DashWidgetId>(
  DEFAULT_DASH_LAYOUT.map((x) => x.id)
)

export function loadDashLayout(): DashWidgetLayout[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULT_DASH_LAYOUT.map((x) => ({ ...x }))
    const parsed = JSON.parse(raw) as DashWidgetLayout[]
    if (!Array.isArray(parsed) || !parsed.length) {
      return DEFAULT_DASH_LAYOUT.map((x) => ({ ...x }))
    }
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
    // Ajouter widgets manquants (mises à jour produit)
    for (const d of DEFAULT_DASH_LAYOUT) {
      if (!seen.has(d.id)) out.push({ ...d })
    }
    return out
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
  return layout.map((x) => {
    if (x.id !== id) return x
    const w =
      patch.w === 1 || patch.w === 2 || patch.w === 3 ? patch.w : x.w
    const h =
      patch.h !== undefined
        ? Math.min(520, Math.max(140, Math.floor(patch.h)))
        : x.h
    return { ...x, w, h }
  })
}
