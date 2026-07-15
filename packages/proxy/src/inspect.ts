/**
 * Chemin partagé engine — prouve que le proxy et l’extension utilisent le même détecteur.
 */
import {
  detectSensitiveData,
  highestSeverity,
  type Detection
} from "@opsgate/engine"

export type InspectResult = {
  detection_count: number
  highest_severity: string | null
  rule_ids: string[]
  types: string[]
  detections: Array<{
    ruleId: string
    type: string
    severity: string
    /** Preview redactée (P0 : jamais le match complet long) */
    preview: string
  }>
}

function redact(match: string, max = 24): string {
  if (match.length <= max) return match.slice(0, 4) + "…"
  return match.slice(0, 8) + "…" + match.slice(-4)
}

export function inspectText(text: string): InspectResult {
  const detections: Detection[] = detectSensitiveData(text)
  const rule_ids = [...new Set(detections.map((d) => d.ruleId))]
  const types = [...new Set(detections.map((d) => d.type))]
  return {
    detection_count: detections.length,
    highest_severity: detections.length ? highestSeverity(detections) : null,
    rule_ids,
    types,
    detections: detections.slice(0, 20).map((d) => ({
      ruleId: d.ruleId,
      type: d.type,
      severity: d.severity,
      preview: redact(d.match)
    }))
  }
}
