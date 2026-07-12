import rulesData from "../rules/rules.json"
import type { Detection, DetectionRule } from "./types"

const defaultRules = rulesData as DetectionRule[]

function slugify(name: string): string {
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 32)
}

/**
 * Masque les occurrences détectées avec des placeholders lisibles.
 * @param rulesSet pack utilisé pour rejouer les patterns (défaut = embarqué)
 */
export function maskSensitiveData(
  text: string,
  detections: Detection[],
  rulesSet?: DetectionRule[] | null
): string {
  if (!text || detections.length === 0) return text

  let result = text
  const ruleIds = new Set(detections.map((d) => d.ruleId))
  const pool = rulesSet && rulesSet.length > 0 ? rulesSet : defaultRules
  const rulesToMask = pool.filter((r) => ruleIds.has(r.id))

  for (const rule of rulesToMask) {
    const placeholder = `[${slugify(rule.name)}]`
    for (const pattern of rule.patterns) {
      try {
        const hasInlineI = pattern.startsWith("(?i)")
        const source = hasInlineI ? pattern.slice(4) : pattern
        const regex = new RegExp(source, hasInlineI ? "gi" : "g")
        result = result.replace(regex, (match) => {
          if (rule.id === "credit-card") {
            const digits = match.replace(/\D/g, "")
            if (digits.length < 13) return match
          }
          return placeholder
        })
      } catch {
        // ignore invalid
      }
    }
  }

  return result
}
