/**
 * Secure Rewrite — anonymisation intelligente (V3-A).
 * Objectif : conserver le sens / la structure (configs, phrases) et ne
 * neutraliser que les **valeurs** sensibles (secrets, IP, clés, hosts).
 */
import type { Detection, Severity } from "./types"

export type RewriteStrategy =
  | "partial_mask"
  | "full_redact"
  | "prefix_keep"
  | "generalize"
  | "placeholder"
  | "pseudonymize"
  | "structure_preserve"

export interface RewriteChange {
  original: string
  replacement: string
  category: string
  strategy: RewriteStrategy
  ruleId: string
}

export interface RewriteResult {
  rewrittenText: string
  changes: RewriteChange[]
  originalRiskScore: number
  remainingRiskScore: number
  stats: {
    totalReplacements: number
    byCategory: Record<string, number>
  }
}

export interface SecureRewriteOptions {
  consistentMapping?: boolean
  aggressiveness?: 1 | 2 | 3
  language?: "fr" | "en"
}

type Maps = {
  host: Map<string, string>
  user: Map<string, string>
  ip: Map<string, string>
  email: Map<string, string>
  hostSeq: number
  userSeq: number
  ipSeq: number
  emailSeq: number
}

function emptyMaps(): Maps {
  return {
    host: new Map(),
    user: new Map(),
    ip: new Map(),
    email: new Map(),
    hostSeq: 0,
    userSeq: 0,
    ipSeq: 0,
    emailSeq: 0
  }
}

function severityWeight(s: Severity): number {
  if (s === "high") return 22
  if (s === "medium") return 10
  return 4
}

/** Délègue au score prompt V3-B (compat Secure Rewrite). */
export function estimateRiskScore(detections: Detection[]): number {
  // Import dynamique évité (cycle) — formule allégée alignée prompt-risk
  if (!detections.length) return 0
  let score = 0
  const cats = new Set(detections.map((d) => d.ruleId))
  for (const d of detections) score += severityWeight(d.severity)
  for (const id of cats) {
    if (
      /password|api-key|secret|jwt|aws|azure|gcp|token|private-key|credit-card|stripe/i.test(
        id
      )
    ) {
      score += 10
    } else if (/fortinet|cisco|wireguard|palo|vpn|ip-private|config/i.test(id)) {
      score += 12
    } else if (/email|iban|pii|ssn|phone/i.test(id)) {
      score += 8
    }
  }
  return Math.min(100, score)
}

function isPrivateIp(ip: string): boolean {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!m) return false
  const a = Number(m[1])
  const b = Number(m[2])
  if (a === 10) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 127) return true
  return false
}

function mapPrivateIp(ip: string, maps: Maps): string {
  if (maps.ip.has(ip)) return maps.ip.get(ip)!
  let rep: string
  if (ip.startsWith("10.")) rep = "10.x.x.x"
  else if (ip.startsWith("192.168.")) rep = "192.168.x.x"
  else if (ip.startsWith("172.")) rep = "172.16.x.x"
  else rep = "10.x.x.x"
  maps.ip.set(ip, rep)
  return rep
}

function mapDeviceHost(name: string, maps: Maps): string {
  const k = name.toLowerCase()
  if (maps.host.has(k)) return maps.host.get(k)!
  maps.hostSeq += 1
  // Format qui ne re-matche PAS le pattern FW-/RTR-… (évite double rewrite)
  const pref = name.match(/^[A-Za-z]+/)?.[0]?.toLowerCase() || "dev"
  const rep = `${pref.slice(0, 4)}-device-${String(maps.hostSeq).padStart(2, "0")}`
  maps.host.set(k, rep)
  return rep
}

/**
 * Ne redacte que la *valeur* du secret, garde le mot-clé password/…
 * Couvre : password=X, password: X, password is X, pwd "X", set password X
 */
function rewritePasswordPhrase(match: string): string {
  const redacted = match
    .replace(
      /(\b(?:password|passwd|pwd)\b)(\s*[=:]\s*)(['"]?)([^\s'"]{4,})(\3?)/gi,
      (_w, a: string, mid: string, q: string) => `${a}${mid}${q}********${q}`
    )
    .replace(
      /(\b(?:password|passwd|pwd)\b)(\s+(?:is|est)\s+)(['"]?)([^\s'"]{4,})(\3?)/gi,
      (_w, a: string, mid: string, q: string) => `${a}${mid}${q}********${q}`
    )
    .replace(
      /(\b(?:password|passwd|pwd)\b)(\s+)(['"])([^'"]{4,})(['"])/gi,
      (_w, a: string, mid: string, q1: string, _v: string, q2: string) =>
        `${a}${mid}${q1}********${q2}`
    )
    .replace(
      /(\b(?:password|passwd|pwd)\b)(\s+)(?!is\b|est\b|manager\b|reset\b|policy\b)([^\s'"]{6,})/gi,
      (_w, a: string, mid: string) => `${a}${mid}********`
    )
    .replace(
      /(\bmot\s+de\s+passe\b)(\s*[=:]\s*|\s+(?:est|is)\s+)(['"]?)([^\s'"]{4,})/gi,
      (_w, a: string, mid: string, q: string) => `${a}${mid}${q}********`
    )
    .replace(
      /(\bset\s+(?:passwd|password)\b)\s+(\S+)/gi,
      (_w, a: string) => `${a} ********`
    )
  return redacted === match ? "********" : redacted
}

/** Passe globale password sur tout le texte (filet de sécurité). */
function rewriteAllPasswordsInText(
  text: string,
  changes: RewriteChange[]
): string {
  let out = text

  const push = (original: string, replacement: string, ruleId: string) => {
    if (original === replacement) return replacement
    if (changes.some((c) => c.original === original && c.replacement === replacement)) {
      return replacement
    }
    changes.push({
      original,
      replacement,
      category: "password",
      strategy: "full_redact",
      ruleId
    })
    return replacement
  }

  // password=secret | password: secret
  out = out.replace(
    /\b((?:password|passwd|pwd)\s*[=:]\s*)(['"]?)([^\s'"]{4,})\2/gi,
    (full, prefix: string, q: string, value: string) => {
      if (/^\*+$/.test(value) || /REDACTED/i.test(value)) return full
      return push(full, `${prefix}${q}********${q}`, "heuristic-password-eq")
    }
  )
  // password is secret
  out = out.replace(
    /\b((?:password|passwd|pwd)\s+(?:is|est)\s+)(['"]?)([^\s'"]{4,})\2/gi,
    (full, prefix: string, q: string, value: string) => {
      if (/^\*+$/.test(value) || /REDACTED/i.test(value)) return full
      return push(full, `${prefix}${q}********${q}`, "heuristic-password-is")
    }
  )
  // mot de passe = secret
  out = out.replace(
    /\b((?:mot\s+de\s+passe)\s*[=:]\s*|(?:mot\s+de\s+passe)\s+(?:est|is)\s+)(['"]?)([^\s'"]{4,})\2/gi,
    (full, prefix: string, q: string, value: string) => {
      if (/^\*+$/.test(value) || /REDACTED/i.test(value)) return full
      return push(full, `${prefix}${q}********${q}`, "heuristic-password-fr")
    }
  )
  // set password secret
  out = out.replace(
    /\b(set\s+(?:passwd|password)\s+)(\S{4,})/gi,
    (full, prefix: string, value: string) => {
      if (/^\*+$/.test(value) || /REDACTED/i.test(value)) return full
      return push(full, `${prefix}********`, "heuristic-set-password")
    }
  )
  return out
}

function rewriteApiKeyToken(match: string): string {
  if (/^sk[-_]/i.test(match) || /^pk[-_]/i.test(match) || /^rk[-_]/i.test(match)) {
    // sk_live_… / sk_test_… → sk_live_[REDACTED]
    const m = match.match(/^(sk|pk|rk)(_(?:live|test)_)?/i)
    if (m) {
      const head = m[0]
      return `${head}[REDACTED]`
    }
    return `${match.slice(0, 3)}[REDACTED]`
  }
  if (/^AKIA[A-Z0-9]{12,}/i.test(match)) return "AKIA[REDACTED]"
  if (match.length > 12) return `${match.slice(0, 4)}[REDACTED]`
  return "[API_KEY]"
}

/**
 * Config infra (Fortinet, etc.) : garder la structure, masquer IP / secrets
 * **dans** le fragment — ne jamais remplacer toute la ligne par CONF-01.
 */
function rewriteInfraFragment(match: string, maps: Maps): string {
  let s = match
  // set password X
  s = s.replace(
    /(\bset\s+(?:password|passwd|private-key)\b)\s+(\S+)/gi,
    (_w, a: string) => `${a} ********`
  )
  // private IPs
  s = s.replace(
    /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3})\b/g,
    (ip) => mapPrivateIp(ip, maps)
  )
  // quoted secrets
  s = s.replace(
    /(\b(?:password|passwd|secret|community)\b\s+)(["'])([^"']{4,})\2/gi,
    (_w, a: string, q: string) => `${a}${q}********${q}`
  )
  return s
}

function rewriteMatch(
  match: string,
  detection: Detection,
  maps: Maps,
  aggressiveness: 1 | 2 | 3
): { replacement: string; strategy: RewriteStrategy; category: string } | null {
  const id = (detection.ruleId || "").toLowerCase()
  const type = (detection.type || "").toLowerCase()

  // ── Password : ne pas effacer le mot « password » ──
  if (
    /password-assignment|password|passwd/i.test(id) ||
    /mot de passe/i.test(type) ||
    /mot de passe/i.test(id)
  ) {
    let rep = rewritePasswordPhrase(match)
    // Si le match n’est que la valeur (sans mot-clé), encapsuler
    if (rep === match && !/\b(?:password|passwd|pwd|mot\s+de\s+passe)\b/i.test(match)) {
      rep = rewritePasswordPhrase(`password=${match}`)
    }
    if (rep === match) rep = "********"
    return {
      replacement: rep,
      strategy: "full_redact",
      category: "password"
    }
  }

  // ── API / cloud keys ──
  if (
    /api-key|openai|anthropic|stripe|github-token|generic-api|aws-access|aws-secret|azure|gcp|huggingface|slack-token/i.test(
      id
    )
  ) {
    return {
      replacement: rewriteApiKeyToken(match),
      strategy: "prefix_keep",
      category: "api_key"
    }
  }

  // ── JWT ──
  if (/jwt|bearer/i.test(id) || /^eyJ[A-Za-z0-9_-]+\./.test(match)) {
    return {
      replacement: "[JWT_TOKEN]",
      strategy: "placeholder",
      category: "jwt"
    }
  }

  // ── Card / IBAN ──
  if (/credit-card|card/i.test(id)) {
    const digits = match.replace(/\D/g, "")
    if (digits.length >= 13) {
      return {
        replacement: `XXXX-XXXX-XXXX-${digits.slice(-4)}`,
        strategy: "partial_mask",
        category: "card"
      }
    }
  }
  if (/iban/i.test(id)) {
    const clean = match.replace(/\s/g, "")
    if (clean.length > 8) {
      return {
        replacement: `${clean.slice(0, 4)} XXXX XXXX ${clean.slice(-4)}`,
        strategy: "partial_mask",
        category: "iban"
      }
    }
  }

  // ── Email ──
  if (/email/i.test(id) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(match)) {
    const lower = match.toLowerCase()
    if (maps.email.has(lower)) {
      return {
        replacement: maps.email.get(lower)!,
        strategy: "pseudonymize",
        category: "email"
      }
    }
    maps.emailSeq += 1
    const rep =
      aggressiveness >= 3
        ? "user@example.com"
        : `user-${String(maps.emailSeq).padStart(2, "0")}@example.com`
    maps.email.set(lower, rep)
    return { replacement: rep, strategy: "pseudonymize", category: "email" }
  }

  // ── IP (règle dédiée ou match pur IP) ──
  if (
    /ip-private|ip-address|ipv4|private-ip/i.test(id) ||
    (/^\d{1,3}(\.\d{1,3}){3}$/.test(match) && isPrivateIp(match))
  ) {
    const ip = match.trim()
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
      // match peut être plus large — déléguer fragment
      const rep = rewriteInfraFragment(match, maps)
      if (rep === match) return null
      return {
        replacement: rep,
        strategy: "structure_preserve",
        category: "ip"
      }
    }
    return {
      replacement: mapPrivateIp(ip, maps),
      strategy: "partial_mask",
      category: "ip"
    }
  }

  // ── Configs réseau (Fortinet/Cisco/…) : structure preserve — PAS hostname ──
  if (
    /fortinet|cisco|juniper|mikrotik|palo|wireguard|openvpn|pfsense|arista|huawei|network-cred/i.test(
      id
    )
  ) {
    const rep = rewriteInfraFragment(match, maps)
    // Lignes purement structurelles (config system interface, edit "port1") :
    // on les laisse si aucun secret n’a été trouvé dedans
    if (rep === match) return null
    return {
      replacement: rep,
      strategy: "structure_preserve",
      category: "infra_config"
    }
  }

  // ── Hostname / device name EXPLICITE uniquement (pas fortinet) ──
  if (
    /^(hostname|host-name|fqdn|device-name)$/i.test(id) ||
    /^(FW|RTR|SW|AP|SRV|DC|FWG|CORE)[-_][A-Z0-9][-A-Z0-9_]*$/i.test(match)
  ) {
    return {
      replacement: mapDeviceHost(match, maps),
      strategy: "generalize",
      category: "hostname"
    }
  }

  // ── Username ──
  if (/username|user-name|account|login/i.test(id)) {
    const k = match.toLowerCase()
    if (maps.user.has(k)) {
      return {
        replacement: maps.user.get(k)!,
        strategy: "pseudonymize",
        category: "username"
      }
    }
    maps.userSeq += 1
    const rep = `user-${String(maps.userSeq).padStart(2, "0")}`
    maps.user.set(k, rep)
    return { replacement: rep, strategy: "pseudonymize", category: "username" }
  }

  // ── Cert ──
  if (/cert|thumbprint|fingerprint/i.test(id)) {
    return {
      replacement: "[CERTIFICATE]",
      strategy: "placeholder",
      category: "certificate"
    }
  }

  // ── Paths ──
  if (/path|directory|filepath/i.test(id) || /^\/(opt|home|var|etc)\//.test(match)) {
    const rep = match
      .replace(/\/home\/[^/\s]+/g, "/home/user")
      .replace(/\/Users\/[^/\s]+/g, "/Users/user")
    if (rep === match) return null
    return { replacement: rep, strategy: "generalize", category: "path" }
  }

  // ── PII ──
  if (/pii|ssn|phone|national|rh|salary/i.test(id)) {
    return {
      replacement: "[PERSONAL_DATA]",
      strategy: "placeholder",
      category: "pii"
    }
  }

  // ── Défaut : placeholder seulement si le match ressemble à un secret ──
  if (match.length >= 12 && /[A-Za-z0-9+/=_-]{12,}/.test(match) && !/\s/.test(match)) {
    const slug = (detection.type || detection.ruleId || "SENSITIVE")
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_")
      .slice(0, 28)
    return {
      replacement: `[${slug}]`,
      strategy: "placeholder",
      category: detection.category || "general"
    }
  }

  // Phrase structurelle / trop générique → ne pas toucher
  return null
}

/**
 * Passe heuristique : masque ce que les règles n’ont pas encore couvert
 * (IP privées isolées, sk_live_ courts, noms FW-*, etc.)
 */
function heuristicPass(
  text: string,
  maps: Maps,
  changes: RewriteChange[]
): string {
  let out = text

  // Stripe / sk_ keys (y compris démos un peu courtes)
  out = out.replace(
    /\b((?:sk|pk|rk)_(?:live|test)_)([0-9a-zA-Z]{8,})\b/g,
    (_w, pref: string, rest: string) => {
      const original = pref + rest
      const replacement = `${pref}[REDACTED]`
      if (original !== replacement) {
        changes.push({
          original,
          replacement,
          category: "api_key",
          strategy: "prefix_keep",
          ruleId: "heuristic-stripe"
        })
      }
      return replacement
    }
  )

  // OpenAI-like sk-...
  out = out.replace(/\b(sk-[A-Za-z0-9]{16,})\b/g, (original) => {
    const replacement = `sk-[REDACTED]`
    changes.push({
      original,
      replacement,
      category: "api_key",
      strategy: "prefix_keep",
      ruleId: "heuristic-sk"
    })
    return replacement
  })

  // AWS access key
  out = out.replace(/\b(AKIA[A-Z0-9]{16})\b/g, (original) => {
    const replacement = "AKIA[REDACTED]"
    changes.push({
      original,
      replacement,
      category: "aws_key",
      strategy: "prefix_keep",
      ruleId: "heuristic-akia"
    })
    return replacement
  })

  // Private IPs (toujours, même hors règle keyword)
  out = out.replace(
    /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3})\b/g,
    (ip) => {
      const replacement = mapPrivateIp(ip, maps)
      if (ip !== replacement) {
        changes.push({
          original: ip,
          replacement,
          category: "ip",
          strategy: "partial_mask",
          ruleId: "heuristic-ip"
        })
      }
      return replacement
    }
  )

  // Device hostnames type FW-PARIS-01 — ignorer déjà anonymisés (*-device-NN)
  out = out.replace(
    /\b((?:FW|RTR|SW|AP|SRV|DC|FWG|CORE|HOST)[-_][A-Z0-9][-A-Z0-9_]{1,32})\b/gi,
    (name) => {
      if (/-device-\d+$/i.test(name)) return name
      const replacement = mapDeviceHost(name, maps)
      if (name !== replacement) {
        changes.push({
          original: name,
          replacement,
          category: "hostname",
          strategy: "generalize",
          ruleId: "heuristic-host"
        })
      }
      return replacement
    }
  )

  return out
}

export function secureRewrite(
  text: string,
  detections: Detection[],
  options?: SecureRewriteOptions
): RewriteResult {
  const originalRiskScore = estimateRiskScore(detections)
  if (!text) {
    return {
      rewrittenText: "",
      changes: [],
      originalRiskScore,
      remainingRiskScore: 0,
      stats: { totalReplacements: 0, byCategory: {} }
    }
  }

  const consistent = options?.consistentMapping !== false
  const aggressiveness = (options?.aggressiveness || 2) as 1 | 2 | 3
  const maps = emptyMaps()

  // Dédupliquer matches — garder sévérité max
  const byMatch = new Map<string, Detection>()
  for (const d of detections) {
    const m = d.match
    if (!m) continue
    const prev = byMatch.get(m)
    if (!prev) {
      byMatch.set(m, d)
      continue
    }
    const order = { high: 3, medium: 2, low: 1 }
    if (order[d.severity] > order[prev.severity]) byMatch.set(m, d)
  }

  const pairs: Array<{
    original: string
    replacement: string
    strategy: RewriteStrategy
    category: string
    ruleId: string
  }> = []

  const globalMap = new Map<string, string>()
  const sorted = [...byMatch.entries()].sort(
    (a, b) => b[0].length - a[0].length
  )

  for (const [original, detection] of sorted) {
    if (consistent && globalMap.has(original)) {
      const replacement = globalMap.get(original)!
      if (replacement !== original) {
        pairs.push({
          original,
          replacement,
          strategy: "placeholder",
          category: detection.category || "general",
          ruleId: detection.ruleId
        })
      }
      continue
    }
    const r = rewriteMatch(original, detection, maps, aggressiveness)
    if (!r || r.replacement === original) continue
    if (consistent) globalMap.set(original, r.replacement)
    pairs.push({
      original,
      replacement: r.replacement,
      strategy: r.strategy,
      category: r.category,
      ruleId: detection.ruleId
    })
  }

  // Appliquer (plus longs d’abord)
  let rewritten = text
  pairs.sort((a, b) => b.original.length - a.original.length)
  const applied: typeof pairs = []
  for (const p of pairs) {
    if (!p.original || p.original === p.replacement) continue
    let needle = p.original
    // Ancien match tronqué UI (… / ...) : retomber sur le préfixe
    if (/[….]{1,3}$/.test(needle) && !rewritten.includes(needle)) {
      needle = needle.replace(/[….]+$/, "").trim()
    }
    if (!needle || !rewritten.includes(needle)) {
      // Password / clé : tenter une passe locale sur le fragment
      if (/password|passwd|pwd|mot.de.passe/i.test(p.ruleId + p.category)) {
        const before = rewritten
        rewritten = rewriteAllPasswordsInText(rewritten, [])
        if (rewritten !== before) {
          applied.push({
            ...p,
            original: p.original,
            replacement: p.replacement
          })
        }
      }
      continue
    }
    rewritten = rewritten.split(needle).join(p.replacement)
    applied.push({ ...p, original: needle })
  }

  const changes: RewriteChange[] = applied
    .filter((p) => p.original !== p.replacement)
    .map((p) => ({
      original: p.original,
      replacement: p.replacement,
      category: p.category,
      strategy: p.strategy,
      ruleId: p.ruleId
    }))

  // Passe password globale (filet) puis IP / sk_ / FW-
  rewritten = rewriteAllPasswordsInText(rewritten, changes)
  rewritten = heuristicPass(rewritten, maps, changes)

  // Dédupliquer changes
  const uniqChanges = changes.filter(
    (c, i, arr) =>
      arr.findIndex(
        (x) => x.original === c.original && x.replacement === c.replacement
      ) === i
  )

  const byCategory: Record<string, number> = {}
  for (const c of uniqChanges) {
    byCategory[c.category] = (byCategory[c.category] || 0) + 1
  }

  // Score restant
  let remaining = 0
  if (
    /\bsk_(?:live|test)_[0-9a-zA-Z]{12,}\b/i.test(rewritten) ||
    /\bAKIA[A-Z0-9]{16}\b/.test(rewritten)
  ) {
    remaining += 40
  }
  if (
    /\b(?:10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[0-1])\.\d+\.\d+)\b/.test(
      rewritten
    )
  ) {
    remaining += 20
  }
  if (/\b(?:password|passwd)\s*[=:]\s*\S{6,}/i.test(rewritten)) {
    remaining += 30
  }
  const remainingRiskScore = Math.min(100, remaining)

  return {
    rewrittenText: rewritten,
    changes: uniqChanges,
    originalRiskScore,
    remainingRiskScore,
    stats: {
      totalReplacements: uniqChanges.length,
      byCategory
    }
  }
}
