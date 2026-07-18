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
  "root",
  // mots après « password … » qui ne sont pas des secrets
  "manager",
  "reset",
  "policy",
  "field",
  "length",
  "change",
  "strength",
  "complexity",
  "required",
  "prompt"
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
      // IBAN : détection par checksum (pas de keyword obligatoire)
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

/**
 * Aperçu UI uniquement. Ne pas utiliser pour rewrite/mask :
 * la troncature cassait Secure Rewrite (match absent du texte source).
 */
export function truncateMatchPreview(match: string, max = 48): string {
  const cleaned = match.replace(/\s+/g, " ").trim()
  return cleaned.length > max ? cleaned.slice(0, max) + "…" : cleaned
}

/** @deprecated utiliser truncateMatchPreview pour l’affichage */
function truncateMatch(match: string, max = 48): string {
  return truncateMatchPreview(match, max)
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
  const iban = raw.replace(/[\s.\-]/g, "").toUpperCase()
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

/** True si le match téléphone est une sous-séquence d’un IBAN valide du texte. */
function looksLikeIbanFragment(raw: string, fullText: string): boolean {
  const compact = fullText.replace(/[\s.\-]/g, "").toUpperCase()
  // Extraire candidats IBAN (pays + chiffres/lettres)
  const re = /[A-Z]{2}\d{2}[A-Z0-9]{11,30}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(compact)) !== null) {
    if (isValidIban(m[0])) {
      const phoneDigits = raw.replace(/\D/g, "")
      const ibanDigits = m[0].replace(/\D/g, "")
      if (phoneDigits.length >= 8 && ibanDigits.includes(phoneDigits)) {
        return true
      }
      // match brut collé sans espaces
      if (m[0].includes(raw.replace(/[\s.\-]/g, "").toUpperCase())) {
        return true
      }
    }
  }
  // Forme espacée type FR76 3000 6000 …
  const spaced = fullText.toUpperCase()
  const reSp =
    /\b[A-Z]{2}\d{2}(?:[\s.\-]*[A-Z0-9]{2,4}){3,10}\b/g
  let ms: RegExpExecArray | null
  while ((ms = reSp.exec(spaced)) !== null) {
    if (isValidIban(ms[0]) && ms[0].includes(raw.trim().toUpperCase().slice(0, 8))) {
      return true
    }
    const ibanDigits = ms[0].replace(/\D/g, "")
    const phoneDigits = raw.replace(/\D/g, "")
    if (phoneDigits.length >= 8 && ibanDigits.includes(phoneDigits)) return true
  }
  return false
}

function extractPasswordValue(match: string): string {
  // password: x | password = x | password is x | password SuperSecret1 | mot de passe est x
  const m =
    match.match(/[=:]\s*['"]?([^\s'"]+)/) ||
    match.match(/\bis\s+['"]?([^\s'"]+)/i) ||
    match.match(/\best\s*[:＝]?\s*['"]?([^\s'"]+)/i) ||
    match.match(/(?:password|passwd|pwd)\s+['"]([^'"]{6,})['"]/i) ||
    match.match(
      /(?:password|passwd|pwd)\s+(?!is\b)([^\s'"]{6,})/i
    )
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
      if ((raw.match(/\d/g) || []).length < 13 || digits.length > 19) return true
      // Préfixe carte courant (Visa 4, MC 5, Amex 3, Discover 6)
      if (!/^[3-6]/.test(digits)) return true
      // Rejeter suites monotones / zéros (IDs web, timestamps packés)
      if (/^(\d)\1{12,}$/.test(digits)) return true
      if (/^0{4,}/.test(digits) || /0{6,}/.test(digits)) return true
      // Format groupé type 4111 1111 1111 1111 ou 4111-1111-…
      const grouped =
        /(?:\d{4}[ -]){2,4}\d{1,7}/.test(raw.trim()) ||
        (/\d[ -]\d/.test(raw) && digits.length >= 13)
      // Contexte bancaire strict (limites de mot — « pan » ne matche plus « span/panel »)
      const lower = fullText.toLowerCase()
      const hasCtx =
        /\bvisa\b/.test(lower) ||
        /\bmastercard\b/.test(lower) ||
        /\bamex\b/.test(lower) ||
        /\bcarte\s*bancaire\b/.test(lower) ||
        /\bcredit\s*card\b/.test(lower) ||
        /\bcard\s*number\b/.test(lower) ||
        /\bcvv2?\b/.test(lower) ||
        /\b\d{3,4}\s*cvc\b/.test(lower) ||
        /\bpan\b/.test(lower) ||
        /\bpayment\b/.test(lower) ||
        /\bbilling\b/.test(lower)
      // Sans format groupé ET sans contexte → faux positif (très fréquent en HTTP/proxy)
      if (!grouped && !hasCtx) return true
      // Chiffres collés : contexte doit être à proximité du match (±120 car.)
      if (!grouped && hasCtx) {
        const needle = digits.slice(0, 8)
        const idx = lower.search(new RegExp(needle.split("").join("[\\s-]*")))
        if (idx >= 0) {
          const window = lower.slice(
            Math.max(0, idx - 120),
            idx + digits.length + 120
          )
          const near =
            /\bvisa\b|\bmastercard\b|\bamex\b|\bcarte\s*bancaire\b|\bcredit\s*card\b|\bcard\s*number\b|\bcvv2?\b|\bpan\b|\bpayment\b|\bbilling\b/.test(
              window
            )
          if (!near) return true
        } else {
          return true
        }
      }
      return false
    }
    case "iban": {
      // Checksum IBAN (mod 97) suffit : pas de keyword obligatoire
      // (évite que des sous-séquences soient classées téléphone)
      if (!isValidIban(raw)) return true
      return false
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
      // IBAN collés / espacés : sous-séquences numériques (ex. 0xxx dans FR76…)
      // ne doivent pas compter comme téléphone
      if (looksLikeIbanFragment(raw, fullText)) return true
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
    case "jwt-token": {
      // JWT de session navigateur (Authorization / cookie) ≠ secret collé dans un prompt
      const lower = fullText.toLowerCase()
      if (
        lower.includes("authorization:") ||
        lower.includes("bearer eyj") ||
        lower.includes("cookie:") ||
        lower.includes('"access_token"') ||
        lower.includes('"session-token"')
      ) {
        // Contexte header/session : ne pas traiter comme fuite utilisateur
        // (le proxy ignore déjà les headers ; ici pour extension/body JSON de session)
        if (!lower.includes("paste") && !lower.includes("coller")) {
          // Si le JWT est le seul contenu « collé » sans contexte de fuite volontaire
          // on laisse passer en FP si entouré de structure auth JSON typique
          if (
            /"authorization"\s*:/.test(lower) ||
            /"token"\s*:\s*"eyj/i.test(fullText)
          ) {
            return true
          }
        }
      }
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
          // Match complet requis pour Secure Rewrite / re-apply.
          // Tronquer uniquement à l’affichage (banner, toast).
          match: raw.replace(/\s+/g, " ").trim() || raw,
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
