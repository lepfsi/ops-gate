import { getRules, type DetectionRule } from "@opsgate/engine"

import { checksumJson } from "./crypto"
import { signPackChecksum } from "./signing"
import type { RulesPackPayload, StoredRulePack } from "./types"

const GLOBAL_PACK_ID = "opsgate-global"
const MAX_PACK_BYTES = 512 * 1024

export interface ValidateResult {
  ok: boolean
  errors: string[]
}

/** Valide un tableau de règles avant publication */
export function validateRules(rules: unknown): ValidateResult {
  const errors: string[] = []

  if (!Array.isArray(rules)) {
    return { ok: false, errors: ["rules_must_be_array"] }
  }
  if (rules.length === 0) {
    return { ok: false, errors: ["rules_empty"] }
  }

  const raw = JSON.stringify(rules)
  if (raw.length > MAX_PACK_BYTES) {
    errors.push(`rules_too_large:${raw.length}>${MAX_PACK_BYTES}`)
  }

  const ids = new Set<string>()
  rules.forEach((r, i) => {
    if (!r || typeof r !== "object") {
      errors.push(`rule[${i}]:not_object`)
      return
    }
    const rule = r as Partial<DetectionRule>
    if (!rule.id || typeof rule.id !== "string") {
      errors.push(`rule[${i}]:missing_id`)
    } else if (ids.has(rule.id)) {
      errors.push(`rule[${i}]:duplicate_id:${rule.id}`)
    } else {
      ids.add(rule.id)
    }
    if (!rule.name) errors.push(`rule[${i}]:missing_name`)
    if (!rule.category) errors.push(`rule[${i}]:missing_category`)
    if (!rule.severity) errors.push(`rule[${i}]:missing_severity`)
    if (!Array.isArray(rule.patterns) || rule.patterns.length === 0) {
      errors.push(`rule[${i}]:patterns_required`)
    } else {
      rule.patterns.forEach((p, j) => {
        if (typeof p !== "string") {
          errors.push(`rule[${i}].patterns[${j}]:not_string`)
          return
        }
        try {
          const hasI = p.startsWith("(?i)")
          const src = hasI ? p.slice(4) : p
          // eslint-disable-next-line no-new
          new RegExp(src, hasI ? "gi" : "g")
        } catch {
          errors.push(`rule[${i}].patterns[${j}]:invalid_regex`)
        }
      })
    }
  })

  return { ok: errors.length === 0, errors }
}

export function bumpVersion(prev?: string): string {
  if (!prev) return "1.0.0"
  const parts = prev.split(".").map((x) => Number(x))
  if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) {
    return `${parts[0]}.${parts[1]}.${parts[2] + 1}`
  }
  // fallback monotonic
  const n = Number(prev)
  if (Number.isFinite(n)) return String(n + 1)
  return "1.0.0"
}

/** Prochaine version libre à partir du pack actif (évite collision après rollback). */
export function nextFreeVersion(
  existingVersions: string[],
  activeVersion?: string
): string {
  const taken = new Set(existingVersions)
  let candidate = bumpVersion(activeVersion)
  let guard = 0
  while (taken.has(candidate) && guard < 1000) {
    candidate = bumpVersion(candidate)
    guard++
  }
  return candidate
}

export function materializePack(input: {
  orgId: string
  version: string
  rules: DetectionRule[]
  notes?: string
  publishedBy?: string
  active?: boolean
}): StoredRulePack {
  const checksum = checksumJson(input.rules)
  return {
    packId: GLOBAL_PACK_ID,
    orgId: input.orgId,
    version: input.version,
    schemaVersion: 1,
    minEngineVersion: "1.1.0",
    checksum,
    signature: signPackChecksum(checksum),
    rules: input.rules,
    notes: input.notes,
    publishedAt: new Date().toISOString(),
    publishedBy: input.publishedBy || "dev-admin",
    active: input.active ?? false
  }
}

/** Pack global depuis le moteur (seed). */
export function buildGlobalRulesPack(version = "1.0.0"): RulesPackPayload {
  const rules = getRules()
  const checksum = checksumJson(rules)
  return {
    version,
    checksum,
    signature: signPackChecksum(checksum),
    rules,
    notes: "Global pack from @opsgate/engine",
    pack_id: GLOBAL_PACK_ID,
    schema_version: 1
  }
}

export function toPayload(pack: StoredRulePack): RulesPackPayload {
  return {
    version: pack.version,
    checksum: pack.checksum,
    signature: pack.signature,
    rules: pack.rules,
    notes: pack.notes,
    pack_id: pack.packId,
    schema_version: pack.schemaVersion,
    published_at: pack.publishedAt
  }
}
