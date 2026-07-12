import rulesData from "../rules/rules.json"
import type { Detection, DetectionRule, Severity } from "./types"

const rules = rulesData as DetectionRule[]

type CompiledRule = {
  rule: DetectionRule
  regexes: RegExp[]
}

function compileRules(ruleList: DetectionRule[]): CompiledRule[] {
  return ruleList.map((rule) => ({
    rule,
    regexes: rule.patterns
      .map((pattern) => {
        try {
          const hasInlineI = pattern.startsWith("(?i)")
          const source = hasInlineI ? pattern.slice(4) : pattern
          return new RegExp(source, hasInlineI ? "gi" : "g")
        } catch {
          console.warn(`[OpsGate] Invalid regex in rule ${rule.id}:`, pattern)
          return null
        }
      })
      .filter((r): r is RegExp => r !== null)
  }))
}

/** Pack embarqué compilé une fois */
const compiledDefault = compileRules(rules)

const SEVERITY_RANK: Record<Severity, number> = {
  low: 1,
  medium: 2,
  high: 3
}

const TEST_CARD_NUMBERS = new Set([
  "4111111111111111",
  "4242424242424242",
  "4000000000000002",
  "5555555555554444",
  "2223003122003222",
  "378282246310005",
  "371449635398431",
  "6011111111111117",
  "30569309025904"
])

const PLACEHOLDER_PASSWORDS = new Set([
  "password",
  "password123",
  "passw0rd",
  "123456",
  "12345678",
  "qwerty",
  "changeme",
  "secret",
  "******",
  "********",
  "yourpassword",
  "your_password",
  "xxx",
  "xxxx",
  "placeholder",
  "example",
  "test",
  "test123",
  "admin",
  "root"
])

const EXAMPLE_EMAIL_DOMAINS = new Set([
  "example.com",
  "example.org",
  "example.net",
  "test.com",
  "email.com",
  "domain.com",
  "sentry.wixpress.com"
])

export function getRules(): DetectionRule[] {
  return rules
}

function keywordsMatch(rule: DetectionRule, text: string): boolean {
  if (!rule.keywords || rule.keywords.length === 0) return true
  const lower = text.toLowerCase()
  return rule.keywords.some((kw) => lower.includes(kw.toLowerCase()))
}

function shouldApplyRule(rule: DetectionRule, text: string): boolean {
  if (rule.keywords && rule.keywords.length > 0) {
    const keywordRequired = [
      "ip-private-block",
      "license-key",
      "iban",
      "aws-secret-key",
      "huawei-vrp-config",
      "mikrotik-routeros",
      "palo-alto-config",
      "pfsense-opnsense",
      "wireguard-openvpn",
      "arista-eos",
      "azure-secrets",
      "gcp-service-account"
    ].includes(rule.id)
    if (keywordRequired) return keywordsMatch(rule, text)
  }
  return true
}

function truncateMatch(match: string, max = 48): string {
  const cleaned = match.replace(/\s+/g, " ").trim()
  return cleaned.length > max ? cleaned.slice(0, max) + "…" : cleaned
}

export function isValidLuhn(num: string): boolean {
  const digits = num.replace(/\D/g, "")
  if (digits.length < 13 || digits.length > 19) return false
  if (/^(\d)\1+$/.test(digits)) return false

  let sum = 0
  let alt = false
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = parseInt(digits[i], 10)
    if (alt) {
      n *= 2
      if (n > 9) n -= 9
    }
    sum += n
    alt = !alt
  }
  return sum % 10 === 0
}

export function isValidIban(raw: string): boolean {
  const iban = raw.replace(/\s+/g, "").toUpperCase()
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false
  if (iban.length < 15 || iban.length > 34) return false

  const rearranged = iban.slice(4) + iban.slice(0, 4)
  let expanded = ""
  for (const ch of rearranged) {
    if (ch >= "A" && ch <= "Z") {
      expanded += String(ch.charCodeAt(0) - 55)
    } else {
      expanded += ch
    }
  }

  let remainder = 0
  for (let i = 0; i < expanded.length; i += 7) {
    const block = String(remainder) + expanded.slice(i, i + 7)
    remainder = Number(block) % 97
  }
  return remainder === 1
}

function extractPasswordValue(match: string): string {
  const m = match.match(/[=:]\s*['"]?([^\s'"]+)/)
  return (m?.[1] || "").toLowerCase()
}

function isPlaceholderEmail(email: string): boolean {
  const lower = email.toLowerCase()
  if (lower.startsWith("noreply@") || lower.startsWith("no-reply@")) return true
  if (lower.includes("user@") || lower.includes("name@")) return true
  const domain = lower.split("@")[1] || ""
  return EXAMPLE_EMAIL_DOMAINS.has(domain)
}

function isFalsePositive(ruleId: string, raw: string, fullText: string): boolean {
  switch (ruleId) {
    case "credit-card": {
      const digits = raw.replace(/\D/g, "")
      if (!isValidLuhn(digits)) return true
      if (TEST_CARD_NUMBERS.has(digits)) return true
      if ((raw.match(/\d/g) || []).length < 13) return true
      return false
    }
    case "iban": {
      if (!isValidIban(raw)) return true
      const lower = fullText.toLowerCase()
      const hasBankCtx =
        lower.includes("iban") ||
        lower.includes("bic") ||
        lower.includes("swift") ||
        lower.includes("rib") ||
        lower.includes("bancaire") ||
        lower.includes("bank account")
      return !hasBankCtx
    }
    case "password-assignment": {
      const val = extractPasswordValue(raw)
      if (!val || val.length < 6) return true
      if (PLACEHOLDER_PASSWORDS.has(val)) return true
      if (/^\*+$/.test(val) || /^\.+$/.test(val) || /^x+$/i.test(val)) return true
      return false
    }
    case "email-address": {
      if (isPlaceholderEmail(raw)) return true
      return false
    }
    case "phone-fr": {
      const digits = raw.replace(/\D/g, "")
      if (digits.length < 10 || digits.length > 15) return true
      if (/^0{5,}/.test(digits) || /^1{8,}/.test(digits)) return true
      return false
    }
    case "generic-api-key": {
      const lower = raw.toLowerCase()
      if (
        lower.includes("your-api-key") ||
        lower.includes("xxx") ||
        lower.includes("placeholder")
      ) {
        return true
      }
      if (/sk-test/i.test(raw) && raw.length < 20) return true
      return false
    }
    default:
      return false
  }
}

/**
 * Exécute le moteur sur un texte.
 * @param customRules pack org (API) — sinon pack embarqué
 */
export function runRulesEngine(
  text: string,
  customRules?: DetectionRule[] | null
): Detection[] {
  if (!text || text.length < 3) return []

  const compiled =
    customRules && customRules.length > 0
      ? compileRules(customRules)
      : compiledDefault

  const detections: Detection[] = []

  for (const { rule, regexes } of compiled) {
    if (!shouldApplyRule(rule, text)) continue

    for (const regex of regexes) {
      regex.lastIndex = 0
      let m: RegExpExecArray | null
      let guard = 0
      while ((m = regex.exec(text)) !== null) {
        guard++
        if (guard > 50) break

        const raw = m[0]
        if (!raw) continue
        if (isFalsePositive(rule.id, raw, text)) continue

        detections.push({
          ruleId: rule.id,
          type: rule.name,
          category: rule.category,
          severity: rule.severity,
          match: truncateMatch(raw),
          description: rule.description,
          actionDefault: rule.action_default ?? "warn"
        })
      }
    }
  }

  const unique = detections.filter(
    (d, i, arr) =>
      arr.findIndex((x) => x.ruleId === d.ruleId && x.match === d.match) === i
  )

  unique.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity])

  return unique
}

export function highestSeverity(detections: Detection[]): Severity {
  if (detections.length === 0) return "low"
  return detections.reduce(
    (max, d) => (SEVERITY_RANK[d.severity] > SEVERITY_RANK[max] ? d.severity : max),
    "low" as Severity
  )
}
