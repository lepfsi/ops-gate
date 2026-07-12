export type Severity = "low" | "medium" | "high"
export type RuleCategory = "general" | "infra"
export type RuleAction = "warn" | "mask" | "block"

export interface DetectionRule {
  id: string
  name: string
  category: RuleCategory
  severity: Severity
  patterns: string[]
  keywords?: string[]
  action_default?: RuleAction
  description?: string
  /** Ignore rule if agent engine is older (future RulePack) */
  min_engine_version?: string
}

export interface Detection {
  ruleId: string
  type: string
  category: RuleCategory
  severity: Severity
  match: string
  description?: string
  actionDefault: RuleAction
}

/** Conteneur RulePack (control plane v1.1) */
export interface RulePack {
  schema_version: number
  pack_id: string
  version: string
  min_engine_version?: string
  published_at?: string
  notes?: string
  rules: DetectionRule[]
}
