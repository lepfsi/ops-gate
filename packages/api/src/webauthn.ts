/**
 * WebAuthn / Passkeys (console admin) — challenge store + verify ES256/RS256.
 * Sans dépendance externe (WebAuthn Level 2 subset).
 */
import {
  createHash,
  createPublicKey,
  createVerify,
  randomBytes,
  type KeyObject
} from "node:crypto"

export type WebAuthnChallenge = {
  id: string
  challenge: string
  adminId?: string
  orgId?: string
  purpose: "register" | "login"
  createdAt: number
  email?: string
}

const CHALLENGE_TTL_MS = 5 * 60 * 1000
const challenges = new Map<string, WebAuthnChallenge>()

function b64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
}

function b64urlToBuf(s: string): Buffer {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/")
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4))
  return Buffer.from(b64 + pad, "base64")
}

export function webauthnEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const v = (env.OPSGATE_WEBAUTHN || "1").toLowerCase().trim()
  return !(v === "0" || v === "false" || v === "off")
}

export function webauthnRpId(env: NodeJS.ProcessEnv = process.env): string {
  return (
    env.OPSGATE_WEBAUTHN_RP_ID?.trim() ||
    env.OPSGATE_CONSOLE_URL?.replace(/^https?:\/\//, "").split("/")[0] ||
    "localhost"
  )
}

export function webauthnOrigin(env: NodeJS.ProcessEnv = process.env): string {
  const c =
    env.OPSGATE_CONSOLE_URL?.trim() ||
    env.OPSGATE_WEBAUTHN_ORIGIN?.trim() ||
    "http://127.0.0.1:5173"
  try {
    return new URL(c).origin
  } catch {
    return "http://127.0.0.1:5173"
  }
}

function purgeChallenges() {
  const now = Date.now()
  for (const [k, v] of challenges) {
    if (now - v.createdAt > CHALLENGE_TTL_MS) challenges.delete(k)
  }
}

export function createWebAuthnChallenge(
  partial: Omit<WebAuthnChallenge, "id" | "challenge" | "createdAt">
): WebAuthnChallenge {
  purgeChallenges()
  const id = b64url(randomBytes(16))
  const challenge = b64url(randomBytes(32))
  const rec: WebAuthnChallenge = {
    ...partial,
    id,
    challenge,
    createdAt: Date.now()
  }
  challenges.set(id, rec)
  return rec
}

export function takeWebAuthnChallenge(id: string): WebAuthnChallenge | null {
  purgeChallenges()
  const c = challenges.get(id)
  if (!c) return null
  challenges.delete(id)
  if (Date.now() - c.createdAt > CHALLENGE_TTL_MS) return null
  return c
}

/** ClientRegistration: stocke credential public key COSE/JWK simplifié */
export type StoredWebAuthnCredential = {
  credentialId: string
  publicKeyJwk: Record<string, unknown>
  counter: number
  transports?: string[]
  createdAt: string
  label?: string
}

/**
 * Vérifie assertion WebAuthn (signature sur authenticatorData || clientDataHash).
 * clientDataJSON et authenticatorData en base64url.
 */
export function verifyWebAuthnAssertion(opts: {
  credential: StoredWebAuthnCredential
  clientDataJSON: string
  authenticatorData: string
  signature: string
  expectedChallenge: string
  expectedOrigin?: string
  expectedRpId?: string
}): { ok: true; newCounter: number } | { ok: false; error: string } {
  try {
    const clientData = JSON.parse(
      b64urlToBuf(opts.clientDataJSON).toString("utf8")
    ) as {
      type?: string
      challenge?: string
      origin?: string
    }
    if (clientData.type !== "webauthn.get") {
      return { ok: false, error: "webauthn_type" }
    }
    if (clientData.challenge !== opts.expectedChallenge) {
      return { ok: false, error: "webauthn_challenge" }
    }
    const origin = opts.expectedOrigin || webauthnOrigin()
    if (clientData.origin && clientData.origin !== origin) {
      // allow trailing slash mismatch
      if (clientData.origin.replace(/\/$/, "") !== origin.replace(/\/$/, "")) {
        return { ok: false, error: "webauthn_origin" }
      }
    }
    const authData = b64urlToBuf(opts.authenticatorData)
    if (authData.length < 37) return { ok: false, error: "webauthn_authdata" }
    // RP ID hash = first 32 bytes
    const rpId = opts.expectedRpId || webauthnRpId()
    const rpHash = createHash("sha256").update(rpId, "utf8").digest()
    if (!authData.subarray(0, 32).equals(rpHash)) {
      return { ok: false, error: "webauthn_rpid" }
    }
    const flags = authData[32]!
    if ((flags & 0x01) === 0) return { ok: false, error: "webauthn_up" } // user present
    const counter = authData.readUInt32BE(33)
    if (
      opts.credential.counter > 0 &&
      counter > 0 &&
      counter <= opts.credential.counter
    ) {
      return { ok: false, error: "webauthn_counter" }
    }
    const clientHash = createHash("sha256")
      .update(b64urlToBuf(opts.clientDataJSON))
      .digest()
    const signed = Buffer.concat([authData, clientHash])
    const sig = b64urlToBuf(opts.signature)
    let key: KeyObject
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      key = createPublicKey({
        key: opts.credential.publicKeyJwk as any,
        format: "jwk"
      })
    } catch {
      return { ok: false, error: "webauthn_pubkey" }
    }
    // ES256 (P-256) typical for passkeys
    const ok = createVerify("SHA256")
      .update(signed)
      .verify({ key, dsaEncoding: "ieee-p1363" }, sig)
    if (!ok) {
      // try RSA-SHA256
      const ok2 = createVerify("RSA-SHA256").update(signed).verify(key, sig)
      if (!ok2) return { ok: false, error: "webauthn_sig" }
    }
    return { ok: true, newCounter: counter || opts.credential.counter }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "webauthn_verify_failed"
    }
  }
}

/** Parse attestation response simplifié : client fournit publicKeyJwk + credentialId */
export function parseRegistrationPayload(body: {
  credentialId?: string
  publicKeyJwk?: Record<string, unknown>
  transports?: string[]
  label?: string
}): StoredWebAuthnCredential | null {
  if (!body.credentialId || !body.publicKeyJwk) return null
  if (body.publicKeyJwk.kty !== "EC" && body.publicKeyJwk.kty !== "RSA") {
    return null
  }
  return {
    credentialId: body.credentialId,
    publicKeyJwk: body.publicKeyJwk,
    counter: 0,
    transports: body.transports,
    createdAt: new Date().toISOString(),
    label: body.label || "Passkey"
  }
}

/** Store process-local des passkeys (persistance DB = roadmap ; OK pilote mono-instance). */
const credsByAdmin = new Map<string, StoredWebAuthnCredential[]>()
const credIndex = new Map<
  string,
  { adminId: string; orgId: string }
>()

export function listWebAuthnCredentials(
  adminId: string
): StoredWebAuthnCredential[] {
  return [...(credsByAdmin.get(adminId) || [])]
}

export function addWebAuthnCredential(
  adminId: string,
  orgId: string,
  cred: StoredWebAuthnCredential
): void {
  const list = credsByAdmin.get(adminId) || []
  const next = list.filter((c) => c.credentialId !== cred.credentialId)
  next.push(cred)
  credsByAdmin.set(adminId, next)
  credIndex.set(cred.credentialId, { adminId, orgId })
}

export function findWebAuthnCredential(credentialId: string): {
  adminId: string
  orgId: string
  credential: StoredWebAuthnCredential
} | null {
  const idx = credIndex.get(credentialId)
  if (!idx) return null
  const cred = (credsByAdmin.get(idx.adminId) || []).find(
    (c) => c.credentialId === credentialId
  )
  if (!cred) return null
  return { ...idx, credential: cred }
}

export function updateWebAuthnCounter(
  adminId: string,
  credentialId: string,
  counter: number
): void {
  const list = credsByAdmin.get(adminId) || []
  const i = list.findIndex((c) => c.credentialId === credentialId)
  if (i < 0) return
  list[i] = { ...list[i]!, counter }
  credsByAdmin.set(adminId, list)
}

export function removeWebAuthnCredential(
  adminId: string,
  credentialId: string
): boolean {
  const list = credsByAdmin.get(adminId) || []
  const next = list.filter((c) => c.credentialId !== credentialId)
  if (next.length === list.length) return false
  credsByAdmin.set(adminId, next)
  credIndex.delete(credentialId)
  return true
}
