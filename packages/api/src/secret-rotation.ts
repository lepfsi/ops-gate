/**
 * Rotation formalisée des secrets constructeur / vendor.
 *
 * Modèle dual-key (grace period) :
 *   OPSGATE_VENDOR_LICENSE_SECRET          = secret courant
 *   OPSGATE_VENDOR_LICENSE_SECRET_PREVIOUS = secret précédent (accepté temporairement)
 *
 * Même schéma pour :
 *   OPSGATE_LICENSE_SECRET / _PREVIOUS
 *   OPSGATE_VENDOR_RECOVERY / _PREVIOUS
 *
 * Runbook : générer nouveau secret → déployer en CURRENT, déplacer l’ancien en PREVIOUS
 * → mettre à jour les clients/scripts → retirer PREVIOUS après grace (ex. 7 j).
 */

export type SecretSlot =
  | "vendor_license"
  | "license"
  | "vendor_recovery"

function env(name: string): string {
  return (process.env[name] || "").trim()
}

export function vendorLicenseSecrets(): {
  current: string
  previous: string
} {
  const current =
    env("OPSGATE_VENDOR_LICENSE_SECRET") || env("OPSGATE_LICENSE_SECRET")
  const previous =
    env("OPSGATE_VENDOR_LICENSE_SECRET_PREVIOUS") ||
    env("OPSGATE_LICENSE_SECRET_PREVIOUS")
  return { current, previous }
}

export function vendorRecoverySecrets(): {
  current: string
  previous: string
} {
  return {
    current: env("OPSGATE_VENDOR_RECOVERY"),
    previous: env("OPSGATE_VENDOR_RECOVERY_PREVIOUS")
  }
}

/** True si `provided` matche le secret courant ou le précédent (rotation). */
export function matchRotatedSecret(
  provided: string,
  pair: { current: string; previous: string },
  minLen = 12
): boolean {
  const p = (provided || "").trim()
  if (!p || p.length < minLen) return false
  if (pair.current.length >= minLen && p === pair.current) return true
  if (pair.previous.length >= minLen && p === pair.previous) return true
  return false
}

export function matchVendorLicenseKey(provided: string): boolean {
  return matchRotatedSecret(provided, vendorLicenseSecrets(), 12)
}

export function matchVendorRecoverySecret(provided: string): boolean {
  return matchRotatedSecret(provided, vendorRecoverySecrets(), 8)
}

export function vendorSecretStatus() {
  const lic = vendorLicenseSecrets()
  const rec = vendorRecoverySecrets()
  return {
    vendor_license: {
      current_configured: lic.current.length >= 12,
      previous_configured: lic.previous.length >= 12,
      rotation_grace_active: lic.previous.length >= 12,
      env_current: "OPSGATE_VENDOR_LICENSE_SECRET | OPSGATE_LICENSE_SECRET",
      env_previous:
        "OPSGATE_VENDOR_LICENSE_SECRET_PREVIOUS | OPSGATE_LICENSE_SECRET_PREVIOUS"
    },
    vendor_recovery: {
      current_configured: rec.current.length >= 8,
      previous_configured: rec.previous.length >= 8,
      rotation_grace_active: rec.previous.length >= 8,
      env_current: "OPSGATE_VENDOR_RECOVERY",
      env_previous: "OPSGATE_VENDOR_RECOVERY_PREVIOUS"
    },
    runbook:
      "1) Générer secret fort 2) CURRENT=nouveau, PREVIOUS=ancien 3) Mettre à jour scripts/clients 4) Retirer PREVIOUS après grace"
  }
}
