/**
 * OIDC Authorization Code + PKCE (sans dépendance externe).
 * Discovery /.well-known/openid-configuration, state éphémère, échange code.
 */
import { createHash, randomBytes } from "node:crypto"

export type OidcConfig = {
  issuer: string
  clientId: string
  clientSecret: string
  redirectUri: string
  scopes: string
}

export type OidcDiscovery = {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  userinfo_endpoint?: string
  jwks_uri?: string
  end_session_endpoint?: string
}

export type OidcPending = {
  state: string
  codeVerifier: string
  nonce: string
  returnTo: string
  force: boolean
  createdAt: number
}

export type OidcClaims = {
  sub?: string
  email?: string
  email_verified?: boolean | string
  preferred_username?: string
  name?: string
  upn?: string
}

const STATE_TTL_MS = 10 * 60 * 1000
const pendingByState = new Map<string, OidcPending>()
let discoveryCache: { key: string; data: OidcDiscovery; at: number } | null =
  null
const DISCOVERY_TTL_MS = 60 * 60 * 1000

export function getOidcConfig(): OidcConfig | null {
  const issuer = process.env.OPSGATE_OIDC_ISSUER?.trim()
  const clientId = process.env.OPSGATE_OIDC_CLIENT_ID?.trim()
  if (!issuer || !clientId) return null
  const clientSecret = process.env.OPSGATE_OIDC_CLIENT_SECRET?.trim() || ""
  const redirectUri =
    process.env.OPSGATE_OIDC_REDIRECT_URI?.trim() ||
    `${defaultApiPublicBase()}/v1/auth/oidc/callback`
  const scopes =
    process.env.OPSGATE_OIDC_SCOPES?.trim() || "openid profile email"
  return { issuer, clientId, clientSecret, redirectUri, scopes }
}

function defaultApiPublicBase(): string {
  const base =
    process.env.OPSGATE_API_PUBLIC_URL?.trim() ||
    process.env.OPSGATE_PUBLIC_URL?.trim()
  if (base) return base.replace(/\/$/, "")
  const port = process.env.PORT || process.env.OPSGATE_API_PORT || "8787"
  return `http://127.0.0.1:${port}`
}

export function defaultConsoleReturnTo(): string {
  const consoleUrl =
    process.env.OPSGATE_CONSOLE_URL?.trim() ||
    process.env.OPSGATE_CONSOLE_PUBLIC_URL?.trim()
  if (consoleUrl) return consoleUrl.replace(/\/$/, "") + "/"
  return "http://127.0.0.1:5173/"
}

/** Domaines email autorisés (optionnel, CSV). Vide = tous. */
export function oidcAllowedDomains(): string[] {
  const raw = process.env.OPSGATE_OIDC_ALLOWED_DOMAINS?.trim()
  if (!raw) return []
  return raw
    .split(/[,;\s]+/)
    .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean)
}

export function isEmailDomainAllowed(email: string): boolean {
  const domains = oidcAllowedDomains()
  if (!domains.length) return true
  const at = email.lastIndexOf("@")
  if (at < 0) return false
  const domain = email.slice(at + 1).toLowerCase()
  return domains.includes(domain)
}

function b64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
}

export function generateCodeVerifier(): string {
  return b64url(randomBytes(32))
}

export function codeChallengeS256(verifier: string): string {
  return b64url(createHash("sha256").update(verifier, "utf8").digest())
}

export function generateState(): string {
  return b64url(randomBytes(24))
}

export function generateNonce(): string {
  return b64url(randomBytes(16))
}

function purgeExpiredPending(): void {
  const now = Date.now()
  for (const [k, v] of pendingByState) {
    if (now - v.createdAt > STATE_TTL_MS) pendingByState.delete(k)
  }
}

export function storePending(p: OidcPending): void {
  purgeExpiredPending()
  pendingByState.set(p.state, p)
}

export function takePending(state: string): OidcPending | null {
  purgeExpiredPending()
  const p = pendingByState.get(state)
  if (!p) return null
  pendingByState.delete(state)
  if (Date.now() - p.createdAt > STATE_TTL_MS) return null
  return p
}

export async function discoverOidc(issuer: string): Promise<OidcDiscovery> {
  const key = issuer.replace(/\/$/, "")
  if (
    discoveryCache &&
    discoveryCache.key === key &&
    Date.now() - discoveryCache.at < DISCOVERY_TTL_MS
  ) {
    return discoveryCache.data
  }
  const url = `${key}/.well-known/openid-configuration`
  const res = await fetch(url, {
    headers: { Accept: "application/json" }
  })
  if (!res.ok) {
    throw new Error(`oidc_discovery_failed:${res.status}`)
  }
  const data = (await res.json()) as OidcDiscovery
  if (!data.authorization_endpoint || !data.token_endpoint) {
    throw new Error("oidc_discovery_incomplete")
  }
  discoveryCache = { key, data, at: Date.now() }
  return data
}

export function buildAuthorizeUrl(
  discovery: OidcDiscovery,
  cfg: OidcConfig,
  pending: OidcPending
): string {
  const u = new URL(discovery.authorization_endpoint)
  u.searchParams.set("response_type", "code")
  u.searchParams.set("client_id", cfg.clientId)
  u.searchParams.set("redirect_uri", cfg.redirectUri)
  u.searchParams.set("scope", cfg.scopes)
  u.searchParams.set("state", pending.state)
  u.searchParams.set("nonce", pending.nonce)
  u.searchParams.set("code_challenge", codeChallengeS256(pending.codeVerifier))
  u.searchParams.set("code_challenge_method", "S256")
  return u.toString()
}

export type TokenResponse = {
  access_token?: string
  id_token?: string
  token_type?: string
  expires_in?: number
  refresh_token?: string
  error?: string
  error_description?: string
}

export async function exchangeCode(opts: {
  discovery: OidcDiscovery
  cfg: OidcConfig
  code: string
  codeVerifier: string
}): Promise<TokenResponse> {
  const body = new URLSearchParams()
  body.set("grant_type", "authorization_code")
  body.set("code", opts.code)
  body.set("redirect_uri", opts.cfg.redirectUri)
  body.set("client_id", opts.cfg.clientId)
  body.set("code_verifier", opts.codeVerifier)
  if (opts.cfg.clientSecret) {
    body.set("client_secret", opts.cfg.clientSecret)
  }
  const res = await fetch(opts.discovery.token_endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json"
    },
    body: body.toString()
  })
  const json = (await res.json().catch(() => ({}))) as TokenResponse
  if (!res.ok || json.error) {
    const msg = json.error_description || json.error || `http_${res.status}`
    throw new Error(`oidc_token_error:${msg}`)
  }
  return json
}

/** Décode le payload JWT sans vérifier la signature (token reçu via TLS du token_endpoint). */
export function decodeJwtPayload(jwt: string): OidcClaims {
  const parts = jwt.split(".")
  if (parts.length < 2) return {}
  try {
    const b64 = parts[1]!.replace(/-/g, "+").replace(/_/g, "/")
    const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4))
    const json = Buffer.from(b64 + pad, "base64").toString("utf8")
    return JSON.parse(json) as OidcClaims
  } catch {
    return {}
  }
}

export async function fetchUserInfo(
  discovery: OidcDiscovery,
  accessToken: string
): Promise<OidcClaims> {
  if (!discovery.userinfo_endpoint) return {}
  const res = await fetch(discovery.userinfo_endpoint, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json"
    }
  })
  if (!res.ok) return {}
  return (await res.json().catch(() => ({}))) as OidcClaims
}

/** Extrait un email admin utilisable depuis claims OIDC. */
export function extractEmail(claims: OidcClaims): string | null {
  const candidates = [
    claims.email,
    claims.preferred_username,
    claims.upn
  ]
  for (const c of candidates) {
    if (!c || typeof c !== "string") continue
    const e = c.trim().toLowerCase()
    if (e.includes("@") && e.length >= 5) return e
  }
  return null
}

export function mergeClaims(...parts: OidcClaims[]): OidcClaims {
  const out: OidcClaims = {}
  for (const p of parts) {
    if (!p) continue
    Object.assign(out, p)
  }
  return out
}

/**
 * Redirige vers la console avec token en fragment (non envoyé au serveur console).
 * Erreurs : #opsgate_oidc_error=...
 */
export function consoleRedirectWithToken(
  returnTo: string,
  payload: {
    token: string
    expiresAt: number
    email?: string
  }
): string {
  const base = sanitizeReturnTo(returnTo)
  const hash = new URLSearchParams()
  hash.set("opsgate_token", payload.token)
  hash.set("opsgate_expires", String(payload.expiresAt))
  if (payload.email) hash.set("opsgate_email", payload.email)
  hash.set("opsgate_via", "oidc")
  const url = new URL(base)
  url.hash = hash.toString()
  return url.toString()
}

export function consoleRedirectWithError(
  returnTo: string,
  error: string,
  detail?: string
): string {
  const base = sanitizeReturnTo(returnTo)
  const hash = new URLSearchParams()
  hash.set("opsgate_oidc_error", error)
  if (detail) hash.set("opsgate_oidc_detail", detail.slice(0, 200))
  const url = new URL(base)
  url.hash = hash.toString()
  return url.toString()
}

/** Empêche open-redirect hors origines connues (console + localhost). */
export function sanitizeReturnTo(returnTo: string): string {
  const fallback = defaultConsoleReturnTo()
  let u: URL
  try {
    u = new URL(returnTo)
  } catch {
    return fallback
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return fallback
  const allowed = new Set<string>()
  try {
    allowed.add(new URL(fallback).origin)
  } catch {
    /* ignore */
  }
  const extra = process.env.OPSGATE_OIDC_RETURN_ORIGINS?.trim()
  if (extra) {
    for (const o of extra.split(/[,;\s]+/)) {
      const t = o.trim()
      if (!t) continue
      try {
        allowed.add(new URL(t).origin)
      } catch {
        allowed.add(t)
      }
    }
  }
  // Dev : accepter localhost / 127.0.0.1 quel que soit le port
  const host = u.hostname.toLowerCase()
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "[::1]" ||
    host.endsWith(".local")
  ) {
    return u.toString()
  }
  if (allowed.has(u.origin)) return u.toString()
  return fallback
}
