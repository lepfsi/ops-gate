import type { Detection, DetectionRule } from "./types"
import { runRulesEngine } from "./rules-engine"

/**
 * Point d'entrée unique pour la détection de données sensibles.
 * @param customRules pack org optionnel (sinon règles embarquées)
 */
export function detectSensitiveData(
  text: string,
  customRules?: DetectionRule[] | null
): Detection[] {
  return runRulesEngine(text, customRules)
}
