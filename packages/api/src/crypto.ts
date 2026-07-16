import { createHash, randomBytes } from "node:crypto"

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex")
}

/** Hash du mot de passe admin (même algo côté agent pour vérif locale) */
export function hashManagementPassword(password: string): string {
  return sha256Hex(`opsgate-mgmt-v1:${password}`)
}

/** Politique mdp console : ≥ 8 caractères */
export const MIN_PASSWORD_LENGTH = 8

/** Historique max de hashes mdp (anti-réutilisation) */
export const PASSWORD_HISTORY_SIZE = 5

export function validatePasswordPolicy(
  password: string,
  opts?: { currentHash?: string; history?: string[] | null }
): { ok: true } | { ok: false; error: string } {
  const p = password || ""
  if (p.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: "password_too_short" }
  }
  const nextHash = hashManagementPassword(p)
  if (opts?.currentHash && nextHash === opts.currentHash) {
    return { ok: false, error: "password_reused" }
  }
  const hist = opts?.history || []
  if (hist.some((h) => h === nextHash)) {
    return { ok: false, error: "password_reused" }
  }
  return { ok: true }
}

/** Ajoute le hash courant à l’historique (avant remplacement) */
export function pushPasswordHistory(
  currentHash: string | undefined,
  history: string[] | undefined | null
): string[] {
  const prev = [...(history || [])]
  if (currentHash) prev.unshift(currentHash)
  // dédup + limite
  const out: string[] = []
  for (const h of prev) {
    if (h && !out.includes(h)) out.push(h)
    if (out.length >= PASSWORD_HISTORY_SIZE) break
  }
  return out
}

/**
 * Mdp défaut admin principal au setup — à changer immédiatement.
 * Surcharge : OPSGATE_SETUP_PASSWORD
 * En production : obligatoire via env (voir assertProductionSecrets).
 */
export const PRINCIPAL_DEFAULT_PASSWORD =
  process.env.OPSGATE_SETUP_PASSWORD || "0000"

/** Email principal seed / install — OPSGATE_SETUP_EMAIL */
export const PRINCIPAL_SETUP_EMAIL =
  process.env.OPSGATE_SETUP_EMAIL || "admin@demo.local"

/**
 * Token break-glass concepteur / vendor — UNIQUEMENT agents offline >2h.
 * Surchargeable via OPSGATE_VENDOR_RECOVERY.
 */
export const VENDOR_RECOVERY_PASSWORD =
  process.env.OPSGATE_VENDOR_RECOVERY || "OpsGate-Vendor-Recovery!"

const WEAK_SETUP = new Set(["0000", "admin", "password", "opsgate", "demo"])
const WEAK_VENDOR = new Set(["OpsGate-Vendor-Recovery!", "recovery", "vendor"])

/**
 * Refuse de démarrer en production avec secrets de démo.
 * NODE_ENV=production → OPSGATE_SETUP_PASSWORD + OPSGATE_VENDOR_RECOVERY requis et non faibles.
 */
export function assertProductionSecrets(): void {
  if (process.env.NODE_ENV !== "production") return
  const setup = process.env.OPSGATE_SETUP_PASSWORD || ""
  const vendor = process.env.OPSGATE_VENDOR_RECOVERY || ""
  const errors: string[] = []
  if (!setup || setup.length < 8 || WEAK_SETUP.has(setup)) {
    errors.push(
      "OPSGATE_SETUP_PASSWORD must be set (≥8 chars, not a demo default)"
    )
  }
  if (!vendor || vendor.length < 12 || WEAK_VENDOR.has(vendor)) {
    errors.push(
      "OPSGATE_VENDOR_RECOVERY must be set (≥12 chars, not the demo default)"
    )
  }
  if (!process.env.DATABASE_URL) {
    errors.push("DATABASE_URL is required in production (no memory store)")
  }
  if (errors.length) {
    throw new Error(
      `[opsgate-api] Production secrets check failed:\n- ${errors.join("\n- ")}`
    )
  }
}

export function getVendorRecoveryHash(): string {
  return hashManagementPassword(VENDOR_RECOVERY_PASSWORD)
}

/** Code recovery one-time affiché une fois : XXXX-XXXX-XXXX-XXXX */
export function generateRecoveryCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
  const parts: string[] = []
  for (let p = 0; p < 4; p++) {
    let chunk = ""
    const buf = randomBytes(4)
    for (let i = 0; i < 4; i++) {
      chunk += alphabet[buf[i]! % alphabet.length]
    }
    parts.push(chunk)
  }
  return parts.join("-")
}

export function hashRecoveryCode(code: string): string {
  const normalized = code.trim().toUpperCase().replace(/\s+/g, "")
  return hashManagementPassword(normalized)
}

/** Compat anciens scripts démo */
export const DEMO_MGMT_PASSWORD = PRINCIPAL_DEFAULT_PASSWORD

/**
 * Clés licence personnelles (pilot local).
 * Surcharge : OPSGATE_PERSONAL_LICENSE_KEYS=key1,key2
 */
export const PERSONAL_LICENSE_KEYS: string[] = (
  process.env.OPSGATE_PERSONAL_LICENSE_KEYS ||
  "OPS-PERSONAL-DEMO-2026,OPS-HOME-TRIAL"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)

export function isValidPersonalLicenseKey(key: string | undefined): boolean {
  if (!key?.trim()) return false
  const k = key.trim().toUpperCase()
  return PERSONAL_LICENSE_KEYS.some((x) => x.toUpperCase() === k)
}

/** OTP court pour reset mdp (console) */
export function newOtpCode(digits = 6): string {
  const max = 10 ** digits
  const n = randomBytes(4).readUInt32BE(0) % max
  return String(n).padStart(digits, "0")
}

export function newId(prefix = ""): string {
  const id = randomBytes(12).toString("hex")
  return prefix ? `${prefix}_${id}` : id
}

export function newToken(): string {
  // opaque agent bearer token (shown once at enroll)
  return `ogt_${randomBytes(24).toString("base64url")}`
}

export function hashToken(token: string): string {
  return sha256Hex(token)
}

export function checksumJson(value: unknown): string {
  return sha256Hex(JSON.stringify(value))
}
