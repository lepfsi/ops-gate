/**
 * Risk Score par prompt + helpers Simulation Mode (V3-B).
 */
import type { Detection, Severity } from "./types"

export type RiskLevel = "low" | "medium" | "high" | "critical"
export type RiskRecommendation =
  | "allow"
  | "mask"
  | "secure_rewrite"
  | "block"

export interface PromptRiskFactor {
  category: string
  label: string
  count: number
  contribution: number
  severity: Severity
}

export interface PromptRiskScore {
  score: number
  level: RiskLevel
  factors: PromptRiskFactor[]
  recommendation: RiskRecommendation
  recommendationLabel: string
  calculatedAt: string
}

export interface SimulationItem {
  label: string
  category: string
  severity: Severity
  /** Extrait tronqué (pas le secret complet si long) */
  example?: string
}

export interface SimulationResult {
  riskScore: PromptRiskScore
  detectedItems: SimulationItem[]
  impact: RiskLevel
  recommendation: string
  suggestedAction: RiskRecommendation
}

/** Seuil d’ouverture auto du Simulation Mode */
export const DEFAULT_SIMULATION_THRESHOLD = 40

function bucketCategory(d: Detection): { key: string; label: string; bonus: number } {
  const id = (d.ruleId || "").toLowerCase()
  const type = (d.type || "").toLowerCase()
  const blob = `${id} ${type}`

  if (
    /password|passwd|secret|credential|api-key|stripe|openai|anthropic|aws|azure|gcp|jwt|token|private-key|generic-api/i.test(
      blob
    )
  ) {
    return { key: "secrets", label: "Secrets / clés API / credentials", bonus: 10 }
  }
  if (
    /fortinet|cisco|juniper|mikrotik|palo|wireguard|vpn|network|hostname|device|ip-private|config/i.test(
      blob
    )
  ) {
    return {
      key: "infra",
      label: "Configurations réseau / infra",
      bonus: 12
    }
  }
  if (/email|iban|pii|phone|ssn|rh|personal|card|credit/i.test(blob)) {
    return { key: "pii", label: "Données personnelles / financières", bonus: 10 }
  }
  if (/source|code|path|repo|git/i.test(blob)) {
    return { key: "code", label: "Code / chemins sensibles", bonus: 8 }
  }
  return {
    key: d.category || "general",
    label: d.type || d.ruleId || "Donnée sensible",
    bonus: 0
  }
}

function severityPoints(s: Severity, categoryKey: string): number {
  // High : 15–25 selon catégorie
  if (s === "high") {
    if (categoryKey === "secrets") return 25
    if (categoryKey === "infra") return 22
    if (categoryKey === "pii") return 20
    return 18
  }
  if (s === "medium") return 8
  return 3
}

function levelFromScore(score: number): RiskLevel {
  if (score >= 80) return "critical"
  if (score >= 55) return "high"
  if (score >= 30) return "medium"
  return "low"
}

export type RiskUiLang = "fr" | "en"

function recommendationFor(
  score: number,
  level: RiskLevel,
  lang: RiskUiLang = "fr"
): { rec: RiskRecommendation; label: string } {
  const en = lang === "en"
  if (level === "critical" || score >= 80) {
    return {
      rec: "secure_rewrite",
      label: en
        ? "Anonymize before sending (Secure Rewrite strongly recommended)"
        : "Anonymiser avant envoi (Secure Rewrite fortement recommandé)"
    }
  }
  if (level === "high" || score >= 55) {
    return {
      rec: "secure_rewrite",
      label: en
        ? "Anonymize before sending (Secure Rewrite recommended)"
        : "Anonymiser avant envoi (Secure Rewrite recommandé)"
    }
  }
  if (level === "medium" || score >= 30) {
    return {
      rec: "mask",
      label: en
        ? "Mask or Secure Rewrite before sending"
        : "Masquer ou Secure Rewrite avant envoi"
    }
  }
  return {
    rec: "allow",
    label: en
      ? "Low risk — manual review is enough"
      : "Risque faible — vérification manuelle suffisante"
  }
}

/**
 * Score de risque 0–100 pour un prompt (explicable, transparent).
 * @param opts.lang  Libellés recommendation FR/EN (défaut fr)
 */
export function calculatePromptRiskScore(
  detections: Detection[],
  opts?: { lang?: RiskUiLang }
): PromptRiskScore {
  const lang: RiskUiLang = opts?.lang === "en" ? "en" : "fr"
  if (!detections.length) {
    return {
      score: 0,
      level: "low",
      factors: [],
      recommendation: "allow",
      recommendationLabel:
        lang === "en" ? "No detections" : "Aucune détection",
      calculatedAt: new Date().toISOString()
    }
  }

  const buckets = new Map<
    string,
    { label: string; count: number; contribution: number; severity: Severity; bonus: number }
  >()

  let score = 0
  for (const d of detections) {
    const b = bucketCategory(d)
    const pts = severityPoints(d.severity, b.key)
    score += pts
    const prev = buckets.get(b.key)
    if (!prev) {
      buckets.set(b.key, {
        label: b.label,
        count: 1,
        contribution: pts,
        severity: d.severity,
        bonus: b.bonus
      })
    } else {
      prev.count += 1
      prev.contribution += pts
      const rank = { low: 1, medium: 2, high: 3 }
      if (rank[d.severity] > rank[prev.severity]) prev.severity = d.severity
    }
  }

  // Bonus présence de catégories sensibles (une fois par catégorie)
  for (const [, v] of buckets) {
    score += v.bonus
    v.contribution += v.bonus
  }

  score = Math.min(100, Math.max(0, score))
  const level = levelFromScore(score)
  const { rec, label } = recommendationFor(score, level, lang)

  const factors: PromptRiskFactor[] = [...buckets.entries()]
    .map(([category, v]) => ({
      category,
      label: v.label,
      count: v.count,
      contribution: Math.min(100, v.contribution),
      severity: v.severity
    }))
    .sort((a, b) => b.contribution - a.contribution)

  return {
    score,
    level,
    factors,
    recommendation: rec,
    recommendationLabel: label,
    calculatedAt: new Date().toISOString()
  }
}

function truncateExample(s: string, max = 42): string {
  const t = s.replace(/\s+/g, " ").trim()
  if (t.length <= max) return t
  return t.slice(0, max - 1) + "…"
}

/**
 * Simulation Mode : ce qui pourrait fuiter + impact + action suggérée.
 */
export function buildSimulation(
  detections: Detection[],
  opts?: { lang?: RiskUiLang }
): SimulationResult {
  const riskScore = calculatePromptRiskScore(detections, opts)
  const items: SimulationItem[] = []

  // Grouper par type pour la liste pédagogique
  const byType = new Map<string, Detection[]>()
  for (const d of detections) {
    const key = d.type || d.ruleId
    const list = byType.get(key) || []
    list.push(d)
    byType.set(key, list)
  }

  const rank: Record<Severity, number> = { low: 1, medium: 2, high: 3 }

  for (const [type, list] of byType) {
    const worst = list.reduce((a, b) =>
      rank[b.severity] > rank[a.severity] ? b : a
    )
    const cat = bucketCategory(worst)
    const example = list[0]?.match
      ? truncateExample(list[0].match)
      : undefined
    items.push({
      label: list.length > 1 ? `${type} (×${list.length})` : type,
      category: cat.key,
      severity: worst.severity,
      example
    })
  }

  items.sort((a, b) => rank[b.severity] - rank[a.severity])

  return {
    riskScore,
    detectedItems: items.slice(0, 24),
    impact: riskScore.level,
    recommendation: riskScore.recommendationLabel,
    suggestedAction: riskScore.recommendation
  }
}

/** Barre ASCII simple pour logs / debug */
export function riskScoreBar(score: number, width = 20): string {
  const filled = Math.round((Math.min(100, Math.max(0, score)) / 100) * width)
  return "█".repeat(filled) + "░".repeat(Math.max(0, width - filled))
}
