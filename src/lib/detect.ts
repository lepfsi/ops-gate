import {
  detectSensitiveData,
  maskSensitiveData,
  type Detection,
  type DetectionRule
} from "@opsgate/engine"

import {
  getActiveRules,
  getMemoryRules,
  refreshMemoryRules
} from "~lib/agent-store"

export async function ensureRulesWarm(): Promise<void> {
  await refreshMemoryRules()
}

/**
 * Détection avec pack org en cache si disponible, sinon règles embarquées.
 */
export async function detectText(text: string): Promise<{
  detections: Detection[]
  rules: DetectionRule[] | null
}> {
  const rules = await getActiveRules()
  const detections = detectSensitiveData(text, rules)
  return { detections, rules }
}

export function maskText(
  text: string,
  detections: Detection[],
  rules: DetectionRule[] | null
): string {
  return maskSensitiveData(text, detections, rules)
}

/** Sync path after ensureRulesWarm() — critical for preventDefault */
export function detectTextSync(text: string): {
  detections: Detection[]
  rules: DetectionRule[] | null
} {
  const rules = getMemoryRules()
  return {
    detections: detectSensitiveData(text, rules),
    rules
  }
}
