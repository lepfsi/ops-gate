/**
 * Secure Rewrite — anonymisation intelligente (V3-A).
 * Conserve le sens / structure du texte tout en neutralisant les secrets.
 */
import type { Detection, Severity } from "./types"

export type RewriteStrategy =
  | "partial_mask"
  | "full_redact"
  | "prefix_keep"
  | "generalize"
  | "placeholder"
  | "pseudonymize"

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
  /** Même valeur d’origine → même remplacement (défaut true) */
  consistentMapping?: boolean
  /** 1 = doux · 2 = normal · 3 = strict (plus de placeholders forts) */
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

/** Score de risque simple 0–100 à partir des détections (transparence UX). */
export function estimateRiskScore(detections: Detection[]): number {
  if (!detections.length) return 0
  let score = 0
  const cats = new Set(detections.map((d) => d.ruleId))
  for (const d of detections) score += severityWeight(d.severity)
  // Bonus catégories très sensibles
  for (const id of cats) {
    if (
      /password|api-key|secret|jwt|aws|azure|gcp|token|private-key|credit-card/i.test(
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

function rewriteMatch(
  match: string,
  detection: Detection,
  maps: Maps,
  aggressiveness: 1 | 2 | 3
): { replacement: string; strategy: RewriteStrategy; category: string } {
  const id = (detection.ruleId || "").toLowerCase()
  const type = (detection.type || "").toLowerCase()
  const key = `${id}|${type}`

  // Mots de passe / secrets totaux
  if (
    /password|passwd|secret|credential|bearer|jwt|private.?key|ssh-key/i.test(
      key
    ) ||
    /password|secret/i.test(match) && match.length < 64
  ) {
    if (
      /password|passwd|secret|credential|jwt|private|token|key/i.test(id) ||
      /password|passwd|secret/i.test(type)
    ) {
      return {
        replacement: "********",
        strategy: "full_redact",
        category: "password"
      }
    }
  }

  // API keys — garder préfixe
  if (
    /api-key|openai|anthropic|stripe|github-token|generic-api|aws-access|aws-secret|azure|gcp|huggingface|slack-token/i.test(
      id
    )
  ) {
    if (/^sk[-_]/i.test(match) || /^pk[-_]/i.test(match)) {
      const pref = match.slice(0, Math.min(8, match.indexOf("_") + 1 || 7))
      return {
        replacement: `${pref}[REDACTED]`,
        strategy: "prefix_keep",
        category: "api_key"
      }
    }
    if (/^AKIA[A-Z0-9]{16}/i.test(match)) {
      return {
        replacement: "AKIA[REDACTED]",
        strategy: "prefix_keep",
        category: "aws_key"
      }
    }
    if (match.length > 12) {
      return {
        replacement: `${match.slice(0, 4)}[REDACTED]`,
        strategy: "prefix_keep",
        category: "api_key"
      }
    }
    return {
      replacement: "[API_KEY]",
      strategy: "placeholder",
      category: "api_key"
    }
  }

  // JWT
  if (/jwt|bearer/i.test(id) || /^eyJ[A-Za-z0-9_-]+\./.test(match)) {
    return {
      replacement: "[JWT_TOKEN]",
      strategy: "placeholder",
      category: "jwt"
    }
  }

  // Credit card
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

  // IBAN
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

  // Email
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

  // IP
  if (
    /ip-private|ip-address|ipv4|private-ip/i.test(id) ||
    /^\d{1,3}(\.\d{1,3}){3}$/.test(match)
  ) {
    if (maps.ip.has(match)) {
      return {
        replacement: maps.ip.get(match)!,
        strategy: "partial_mask",
        category: "ip"
      }
    }
    let rep: string
    if (isPrivateIp(match)) {
      if (match.startsWith("10.")) rep = "10.x.x.x"
      else if (match.startsWith("192.168.")) rep = "192.168.x.x"
      else if (match.startsWith("172.")) rep = "172.16.x.x"
      else rep = "10.x.x.x"
    } else {
      maps.ipSeq += 1
      rep = aggressiveness >= 2 ? "[PUBLIC_IP]" : `203.0.113.${maps.ipSeq}`
    }
    maps.ip.set(match, rep)
    return {
      replacement: rep,
      strategy: isPrivateIp(match) ? "partial_mask" : "placeholder",
      category: "ip"
    }
  }

  // Hostname / firewall names
  if (
    /hostname|host-name|fqdn|firewall|fortinet|device-name/i.test(id) ||
    /^(FW|RTR|SW|AP|SRV|DC)[-_][A-Z0-9_-]+$/i.test(match)
  ) {
    const k = match.toLowerCase()
    if (maps.host.has(k)) {
      return {
        replacement: maps.host.get(k)!,
        strategy: "generalize",
        category: "hostname"
      }
    }
    maps.hostSeq += 1
    const pref = match.match(/^[A-Za-z]+/)?.[0]?.toUpperCase() || "HOST"
    const rep = `${pref.slice(0, 4)}-${String(maps.hostSeq).padStart(2, "0")}`
    maps.host.set(k, rep)
    return { replacement: rep, strategy: "generalize", category: "hostname" }
  }

  // Username style
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

  // Certificate thumbprint
  if (/cert|thumbprint|fingerprint/i.test(id)) {
    return {
      replacement: "[CERTIFICATE]",
      strategy: "placeholder",
      category: "certificate"
    }
  }

  // Paths
  if (/path|directory|filepath/i.test(id) || /^\/(opt|home|var|etc)\//.test(match)) {
    return {
      replacement: match
        .replace(/\/home\/[^/]+/g, "/home/user")
        .replace(/\/Users\/[^/]+/g, "/Users/user")
        .replace(/entreprise|company|corp/gi, "app"),
      strategy: "generalize",
      category: "path"
    }
  }

  // Infra configs blocs — placeholder fort si match long
  if (
    /fortinet|cisco|juniper|mikrotik|palo|wireguard|openvpn|pfsense|arista|huawei/i.test(
      id
    )
  ) {
    if (match.length > 40) {
      return {
        replacement: "[NETWORK_CONFIG_REDACTED]",
        strategy: "placeholder",
        category: "infra_config"
      }
    }
  }

  // PII générique
  if (/pii|ssn|phone|national|rh|salary/i.test(id)) {
    return {
      replacement: "[PERSONAL_DATA]",
      strategy: "placeholder",
      category: "pii"
    }
  }

  // Défaut : placeholder lisible
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

/**
 * Génère une version intelligemment anonymisée du texte.
 */
export function secureRewrite(
  text: string,
  detections: Detection[],
  options?: SecureRewriteOptions
): RewriteResult {
  const originalRiskScore = estimateRiskScore(detections)
  if (!text || detections.length === 0) {
    return {
      rewrittenText: text || "",
      changes: [],
      originalRiskScore,
      remainingRiskScore: 0,
      stats: { totalReplacements: 0, byCategory: {} }
    }
  }

  const consistent = options?.consistentMapping !== false
  const aggressiveness = (options?.aggressiveness || 2) as 1 | 2 | 3
  const maps = emptyMaps()

  // Dédupliquer par match exact, garder la détection la plus sévère
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

  // Remplacements cohérents (plus longs d’abord)
  const pairs: Array<{
    original: string
    replacement: string
    strategy: RewriteStrategy
    category: string
    ruleId: string
  }> = []

  const sorted = [...byMatch.entries()].sort(
    (a, b) => b[0].length - a[0].length
  )

  const globalMap = new Map<string, string>()

  for (const [original, detection] of sorted) {
    if (consistent && globalMap.has(original)) {
      const replacement = globalMap.get(original)!
      pairs.push({
        original,
        replacement,
        strategy: "placeholder",
        category: detection.category || "general",
        ruleId: detection.ruleId
      })
      continue
    }
    const r = rewriteMatch(original, detection, maps, aggressiveness)
    if (consistent) globalMap.set(original, r.replacement)
    pairs.push({
      original,
      replacement: r.replacement,
      strategy: r.strategy,
      category: r.category,
      ruleId: detection.ruleId
    })
  }

  // Appliquer via split (évite regex sur contenus arbitraires)
  let rewritten = text
  // Ordonner encore par longueur pour éviter partial replace
  pairs.sort((a, b) => b.original.length - a.original.length)
  for (const p of pairs) {
    if (!p.original || p.original === p.replacement) continue
    if (!rewritten.includes(p.original)) continue
    rewritten = rewritten.split(p.original).join(p.replacement)
  }

  const byCategory: Record<string, number> = {}
  const changes: RewriteChange[] = []
  for (const p of pairs) {
    if (!text.includes(p.original)) continue
    changes.push({
      original: p.original,
      replacement: p.replacement,
      category: p.category,
      strategy: p.strategy,
      ruleId: p.ruleId
    })
    byCategory[p.category] = (byCategory[p.category] || 0) + 1
  }

  // Score restant : re-scan naïf — si le rewrite a bien enlevé les matches
  let remaining = 0
  for (const p of pairs) {
    if (rewritten.includes(p.original)) remaining += 15
  }
  // Traces de secrets encore visibles
  if (/sk[-_]live|AKIA[A-Z0-9]{16}|eyJ[A-Za-z0-9_-]{10,}\./.test(rewritten)) {
    remaining = Math.max(remaining, 40)
  }
  const remainingRiskScore = Math.min(100, remaining)

  return {
    rewrittenText: rewritten,
    changes,
    originalRiskScore,
    remainingRiskScore,
    stats: {
      totalReplacements: changes.length,
      byCategory
    }
  }
}
