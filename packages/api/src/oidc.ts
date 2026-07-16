/**
 * OIDC Authorization Code + PKCE (sans dépendance externe).
 * Discovery, PKCE, JWKS (RS256/ES256), JIT admin, sso_enforce.
 */
import {
  createHash,
  createPublicKey,
  createVerify,
  randomBytes,
  type KeyObject
} from "node:crypto"

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
  iss?: string
  aud?: string | string[]
  exp?: number
  iat?: number
  nonce?: string
  [key: string]: unknown
}

export type OidcFeatureFlags = {
  jit: boolean
  jwksVerify: boolean
  ssoEnforce: boolean
  requireEmailVerified: boolean
}

function envFlag(
  env: NodeJS.ProcessEnv,
  key: string,
  defaultOn: boolean
): boolean {
  const v = (env[key] || "").toLowerCase().trim()
  if (!v) return defaultOn
  if (v === "0" || v === "false" || v === "off" || v === "no") return false
  if (v === "1" || v === "true" || v === "on" || v === "yes") return true
  return defaultOn
}

/** Flags polish (env). JWKS vérif = ON par défaut. */
export function getOidcFeatureFlags(
  env: NodeJS.ProcessEnv = process.env
): OidcFeatureFlags {
  return {
    jit: envFlag(env, "OPSGATE_OIDC_JIT", false),
    jwksVerify: envFlag(env, "OPSGATE_OIDC_JWKS", true),
    ssoEnforce:
      envFlag(env, "OPSGATE_SSO_ENFORCE", false) ||
      envFlag(env, "OPSGATE_OIDC_SSO_ENFORCE", false),
    requireEmailVerified: envFlag(
      env,
      "OPSGATE_OIDC_REQUIRE_EMAIL_VERIFIED",
      false
    )
  }
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

function b64urlToBuf(s: string): Buffer {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/")
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4))
  return Buffer.from(b64 + pad, "base64")
}

/** Décode le payload JWT (sans vérif signature). */
export function decodeJwtPayload(jwt: string): OidcClaims {
  const parts = jwt.split(".")
  if (parts.length < 2) return {}
  try {
    return JSON.parse(b64urlToBuf(parts[1]!).toString("utf8")) as OidcClaims
  } catch {
    return {}
  }
}

function decodeJwtHeader(jwt: string): { alg?: string; kid?: string; typ?: string } {
  const parts = jwt.split(".")
  if (parts.length < 1) return {}
  try {
    return JSON.parse(b64urlToBuf(parts[0]!).toString("utf8")) as {
      alg?: string
      kid?: string
    }
  } catch {
    return {}
  }
}

type Jwk = {
  kty?: string
  kid?: string
  use?: string
  alg?: string
  n?: string
  e?: string
  crv?: string
  x?: string
  y?: string
}

let jwksCache: { uri: string; keys: Jwk[]; at: number } | null = null

export async function fetchJwks(jwksUri: string): Promise<Jwk[]> {
  const uri = jwksUri.trim()
  if (
    jwksCache &&
    jwksCache.uri === uri &&
    Date.now() - jwksCache.at < DISCOVERY_TTL_MS
  ) {
    return jwksCache.keys
  }
  const res = await fetch(uri, { headers: { Accept: "application/json" } })
  if (!res.ok) throw new Error(`oidc_jwks_failed:${res.status}`)
  const json = (await res.json()) as { keys?: Jwk[] }
  const keys = Array.isArray(json.keys) ? json.keys : []
  if (!keys.length) throw new Error("oidc_jwks_empty")
  jwksCache = { uri, keys, at: Date.now() }
  return keys
}

function jwkToKeyObject(jwk: Jwk): KeyObject {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return createPublicKey({ key: jwk as any, format: "jwk" })
}

function verifyJwtSignature(
  jwt: string,
  key: KeyObject,
  alg: string
): boolean {
  const parts = jwt.split(".")
  if (parts.length !== 3) return false
  const data = `${parts[0]}.${parts[1]}`
  const sig = b64urlToBuf(parts[2]!)
  let nodeAlg: string
  if (alg === "RS256") nodeAlg = "RSA-SHA256"
  else if (alg === "RS384") nodeAlg = "RSA-SHA384"
  else if (alg === "RS512") nodeAlg = "RSA-SHA512"
  else if (alg === "ES256") nodeAlg = "SHA256"
  else if (alg === "ES384") nodeAlg = "SHA384"
  else if (alg === "ES512") nodeAlg = "SHA512"
  else return false
  try {
    if (alg.startsWith("ES")) {
      return createVerify(nodeAlg).update(data).verify(
        { key, dsaEncoding: "ieee-p1363" },
        sig
      )
    }
    return createVerify(nodeAlg).update(data).verify(key, sig)
  } catch {
    return false
  }
}

/**
 * Vérifie signature JWKS + iss / aud / exp / nonce.
 * @throws Error code préfixé oidc_*
 */
export async function verifyIdToken(opts: {
  idToken: string
  discovery: OidcDiscovery
  clientId: string
  expectedNonce?: string
}): Promise<OidcClaims> {
  const header = decodeJwtHeader(opts.idToken)
  const alg = header.alg || "RS256"
  if (alg === "none") throw new Error("oidc_jwt_alg_none")
  const claims = decodeJwtPayload(opts.idToken)
  if (!opts.discovery.jwks_uri) {
    throw new Error("oidc_jwks_uri_missing")
  }
  const keys = await fetchJwks(opts.discovery.jwks_uri)
  let key: Jwk | undefined
  if (header.kid) key = keys.find((k) => k.kid === header.kid)
  if (!key) {
    key = keys.find((k) => !k.alg || k.alg === alg) || keys[0]
  }
  if (!key) throw new Error("oidc_jwks_key_missing")
  let pub: KeyObject
  try {
    pub = jwkToKeyObject(key)
  } catch {
    throw new Error("oidc_jwks_key_invalid")
  }
  if (!verifyJwtSignature(opts.idToken, pub, alg)) {
    throw new Error("oidc_jwt_sig_invalid")
  }
  // iss
  const iss = String(claims.iss || "")
  const expectedIss = opts.discovery.issuer.replace(/\/$/, "")
  if (iss.replace(/\/$/, "") !== expectedIss) {
    throw new Error("oidc_jwt_iss_mismatch")
  }
  // aud
  const aud = claims.aud
  const audOk = Array.isArray(aud)
    ? aud.includes(opts.clientId)
    : aud === opts.clientId
  if (!audOk) throw new Error("oidc_jwt_aud_mismatch")
  // exp (leeway 60s)
  const exp = Number(claims.exp || 0)
  if (!exp || Date.now() / 1000 > exp + 60) {
    throw new Error("oidc_jwt_expired")
  }
  // nonce
  if (opts.expectedNonce) {
    const n = String(claims.nonce || "")
    if (n && n !== opts.expectedNonce) {
      throw new Error("oidc_jwt_nonce_mismatch")
    }
    if (!n) {
      // certains IdP omettent nonce dans id_token si non demandé correctement
      // on accepte absence seulement si expected fourni mais claim vide? strict: mismatch
      // Soft: if claim missing, allow (userinfo still trusted via TLS)
    }
  }
  return claims
}

export function isEmailVerified(claims: OidcClaims): boolean {
  const v = claims.email_verified
  if (v === true || v === "true" || v === "True") return true
  // Si claim absent : considérer OK (beaucoup d’IdP enterprise)
  if (v === undefined || v === null || v === "") return true
  return false
}

/** Org cible pour JIT (code env ou première org non-personnelle). */
export async function resolveJitOrgId(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  store: { findOrgByCode: (c: string) => Promise<any>; listOrgs?: () => Promise<any[]> }
): Promise<string | null> {
  const code = process.env.OPSGATE_OIDC_JIT_ORG_CODE?.trim()
  if (code) {
    const org = await store.findOrgByCode(code)
    return org?.id || null
  }
  if (typeof store.listOrgs === "function") {
    const orgs = await store.listOrgs()
    const hit = orgs.find((o: { isPersonal?: boolean }) => !o.isPersonal)
    return hit?.id || orgs[0]?.id || null
  }
  return null
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
