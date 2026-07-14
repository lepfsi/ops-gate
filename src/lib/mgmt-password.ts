import type { ExitActorInfo } from "~types"
import type { ExitCredential } from "~lib/agent-store"

/**
 * Hash du mot de passe admin de sortie (doit matcher packages/api crypto.hashManagementPassword)
 */
export async function hashManagementPassword(password: string): Promise<string> {
  const data = new TextEncoder().encode(`opsgate-mgmt-v1:${password}`)
  const hash = await crypto.subtle.digest("SHA-256", data)
  return [...new Uint8Array(hash)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

export async function verifyAdminPassword(
  password: string,
  storedHash: string | undefined
): Promise<boolean> {
  if (!storedHash) return false
  const h = await hashManagementPassword(password)
  return h === storedHash
}

export async function verifyAnyPassword(
  password: string,
  storedHashes: string[]
): Promise<boolean> {
  if (!password || storedHashes.length === 0) return false
  const h = await hashManagementPassword(password)
  return storedHashes.some((s) => s && s === h)
}

/**
 * Username + password pour désenrôlement.
 * Username = label ou email admin.
 * Recovery : username "vendor" | "recovery" | "opsgate" + code one-time ou secret legacy.
 */
export async function matchExitPassword(
  password: string,
  credentials: ExitCredential[],
  username?: string
): Promise<ExitActorInfo | null> {
  if (!password || credentials.length === 0) return null
  // Codes recovery formatés XXXX-XXXX… → normaliser comme le serveur
  const normalizedPwd = password.trim().toUpperCase().replace(/\s+/g, "")
  const h = await hashManagementPassword(normalizedPwd)
  // Aussi essayer le hash du mot de passe tel quel (admins / legacy)
  const hRaw = await hashManagementPassword(password.trim())
  const user = (username || "").trim().toLowerCase()

  if (!user) {
    for (const c of credentials) {
      if (c.hash !== h && c.hash !== hRaw) continue
      if (c.kind === "admin") {
        return { type: "admin", adminId: c.id, adminLabel: c.label }
      }
      return {
        type: "vendor_recovery",
        recoveryCodeId: c.codeId
      }
    }
    return null
  }

  const isVendorUser =
    user === "vendor" || user === "recovery" || user === "opsgate"

  for (const c of credentials) {
    if (c.hash !== h && c.hash !== hRaw) continue
    if (c.kind === "recovery") {
      if (isVendorUser) {
        return {
          type: "vendor_recovery",
          recoveryCodeId: c.codeId
        }
      }
      continue
    }
    const labelOk = c.label?.toLowerCase() === user
    const emailOk = c.email?.toLowerCase() === user
    if (labelOk || emailOk) {
      return {
        type: "admin",
        adminId: c.id,
        adminLabel: c.label
      }
    }
  }
  return null
}
