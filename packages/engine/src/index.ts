/**
 * @opsgate/engine
 * Moteur de détection OpsGate — partagé extension, futur proxy, tests, console.
 */

export type {
  Severity,
  RuleCategory,
  RuleAction,
  DetectionRule,
  Detection,
  RulePack
} from "./types"

export { detectSensitiveData } from "./detector"
export { maskSensitiveData } from "./masker"
export {
  secureRewrite,
  estimateRiskScore,
  type RewriteStrategy,
  type RewriteChange,
  type RewriteResult,
  type SecureRewriteOptions
} from "./secure-rewrite"
export {
  runRulesEngine,
  getRules,
  highestSeverity,
  isValidLuhn,
  isValidIban
} from "./rules-engine"
