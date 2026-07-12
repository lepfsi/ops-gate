import { createHash, randomBytes } from "node:crypto"

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex")
}

/** Hash du mot de passe admin (même algo côté agent pour vérif locale) */
export function hashManagementPassword(password: string): string {
  return sha256Hex(`opsgate-mgmt-v1:${password}`)
}

/**
 * Mdp défaut admin principal au setup — à changer immédiatement.
 * Surcharge : OPSGATE_SETUP_PASSWORD
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

export function getVendorRecoveryHash(): string {
  return hashManagementPassword(VENDOR_RECOVERY_PASSWORD)
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
