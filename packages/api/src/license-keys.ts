/**
 * Licences préprogrammées (liées à un orgCode).
 *
 * Format court (papier) : OPS-XXXX-XXXX-XXXX-XXXX
 *   → stocké en base (issued_licenses) avec métadonnées entreprise.
 *
 * Format legacy long encore accepté : OG1.<payload_b64>.<sig_b64>
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto"

export type IssuedLicensePayload = {
  v: 1
  orgCode: string
  companyName: string
  address: string
  contactEmail: string
  seats: number
  expiresAt: string
  issuedAt: string
}

export type IssuedLicenseRecord = IssuedLicensePayload & {
  id: string
  licenseKey: string
  revokedAt?: string | null
}

function licenseSecret(): string {
  return (
    process.env.OPSGATE_LICENSE_SECRET ||
    process.env.OPSGATE_VENDOR_RECOVERY ||
    "OpsGate-License-Demo-Secret-Change-Me"
  )
}

function b64url(buf: Buffer | string): string {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf, "utf8")
  return b
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "")
}

function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4))
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad
  return Buffer.from(b64, "base64")
}

function sign(payloadB64: string, secret: string): string {
  return b64url(createHmac("sha256", secret).update(payloadB64).digest())
}

/** Alphabet sans caractères ambigus (0/O, 1/I) */
const ALPH = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

/** Génère une clé courte OPS-XXXX-XXXX-XXXX-XXXX */
export function generateShortLicenseKey(): string {
  const bytes = randomBytes(10)
  let raw = ""
  for (let i = 0; i < 16; i++) {
    raw += ALPH[bytes[i % bytes.length] % ALPH.length]
  }
  // léger mélange
  const h = createHash("sha256").update(bytes).digest()
  let out = ""
  for (let i = 0; i < 16; i++) {
    out += ALPH[h[i] % ALPH.length]
  }
  return `OPS-${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}-${out.slice(12, 16)}`
}

export function normalizeLicenseKey(key: string): string {
  return (key || "").trim().toUpperCase().replace(/\s+/g, "")
}

export function isShortLicenseKey(key: string): boolean {
  return /^OPS-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/i.test(
    normalizeLicenseKey(key)
  )
}

/** Legacy long key (constructeur OG1) */
export function issueLegacyLicenseKey(
  input: Omit<IssuedLicensePayload, "v" | "issuedAt"> & {
    issuedAt?: string
  }
): string {
  const payload: IssuedLicensePayload = {
    v: 1,
    orgCode: input.orgCode.trim().toUpperCase(),
    companyName: input.companyName.trim(),
    address: input.address.trim(),
    contactEmail: input.contactEmail.trim().toLowerCase(),
    seats: Math.max(0, Math.floor(input.seats) || 0),
    expiresAt: input.expiresAt,
    issuedAt: input.issuedAt || new Date().toISOString()
  }
  const payloadB64 = b64url(JSON.stringify(payload))
  const sig = sign(payloadB64, licenseSecret())
  return `OG1.${payloadB64}.${sig}`
}

/** @deprecated alias */
export function issueLicenseKey(
  input: Omit<IssuedLicensePayload, "v" | "issuedAt"> & { issuedAt?: string }
): string {
  return issueLegacyLicenseKey(input)
}

export function verifyLegacyLicenseKey(
  key: string
):
  | { ok: true; payload: IssuedLicensePayload }
  | { ok: false; error: string } {
  const raw = (key || "").trim()
  if (!raw.startsWith("OG1.")) {
    return { ok: false, error: "invalid_format" }
  }
  const parts = raw.split(".")
  if (parts.length !== 3) return { ok: false, error: "invalid_format" }
  const [, payloadB64, sig] = parts
  const expect = sign(payloadB64, licenseSecret())
  try {
    const a = Buffer.from(sig)
    const b = Buffer.from(expect)
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return { ok: false, error: "invalid_signature" }
    }
  } catch {
    return { ok: false, error: "invalid_signature" }
  }
  try {
    const json = b64urlDecode(payloadB64).toString("utf8")
    const payload = JSON.parse(json) as IssuedLicensePayload
    if (payload.v !== 1 || !payload.orgCode || !payload.companyName) {
      return { ok: false, error: "invalid_payload" }
    }
    if (!payload.expiresAt || !Number.isFinite(Date.parse(payload.expiresAt))) {
      return { ok: false, error: "invalid_expiry" }
    }
    if (Date.parse(payload.expiresAt) < Date.now()) {
      return { ok: false, error: "license_expired" }
    }
    return { ok: true, payload }
  } catch {
    return { ok: false, error: "invalid_payload" }
  }
}

/** Vérifie format court (existence en base à faire côté store) */
export function parseShortKeyOrLegacy(
  key: string
):
  | { kind: "short"; key: string }
  | { kind: "legacy"; payload: IssuedLicensePayload }
  | { kind: "error"; error: string } {
  const raw = (key || "").trim()
  if (isShortLicenseKey(raw)) {
    return { kind: "short", key: normalizeLicenseKey(raw) }
  }
  if (raw.startsWith("OG1.")) {
    const v = verifyLegacyLicenseKey(raw)
    if (!v.ok) return { kind: "error", error: v.error }
    return { kind: "legacy", payload: v.payload }
  }
  return { kind: "error", error: "invalid_format" }
}

export function licenseKeyFingerprint(key: string): string {
  return createHash("sha256")
    .update(normalizeLicenseKey(key))
    .digest("hex")
    .slice(0, 16)
}

export function buildPayloadFromInput(
  input: Omit<IssuedLicensePayload, "v" | "issuedAt"> & { issuedAt?: string }
): IssuedLicensePayload {
  return {
    v: 1,
    orgCode: input.orgCode.trim().toUpperCase(),
    companyName: input.companyName.trim(),
    address: input.address.trim(),
    contactEmail: input.contactEmail.trim().toLowerCase(),
    seats: Math.max(0, Math.floor(input.seats) || 0),
    expiresAt: input.expiresAt,
    issuedAt: input.issuedAt || new Date().toISOString()
  }
}
