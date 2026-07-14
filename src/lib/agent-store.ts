import type { DetectionRule } from "@opsgate/engine"

import type { CachedRulesPack, OpsGateSettings } from "~types"
import { DEFAULT_SETTINGS } from "~types"

const SETTINGS_KEY = "opsGateSettings"
const RULES_KEY = "opsGateRulesPack"
/** Empreinte stable d’installation (survit unenroll / rebuild API) */
const INSTALL_ID_KEY = "opsGateInstallId"

/**
 * ID stable local à l’installation de l’extension.
 * Utilisé comme device_fingerprint côté control plane pour éviter les doublons
 * quand le label change après rebuild.
 */
export async function getOrCreateInstallId(): Promise<string> {
  const data = await chrome.storage.local.get(INSTALL_ID_KEY)
  const existing = data[INSTALL_ID_KEY] as string | undefined
  if (existing && existing.length >= 8) return existing
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? `ogf_${crypto.randomUUID()}`
      : `ogf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`
  await chrome.storage.local.set({ [INSTALL_ID_KEY]: id })
  return id
}

export async function getSettings(): Promise<OpsGateSettings> {
  const data = await chrome.storage.local.get(SETTINGS_KEY)
  return { ...DEFAULT_SETTINGS, ...(data[SETTINGS_KEY] as Partial<OpsGateSettings>) }
}

export async function setSettings(
  partial: Partial<OpsGateSettings>
): Promise<OpsGateSettings> {
  const current = await getSettings()
  const next = { ...current, ...partial }
  // Endpoint protection : si lock actif, forcer enabled
  if (next.managedLockActive) {
    next.enabled = true
  }
  await chrome.storage.local.set({ [SETTINGS_KEY]: next })
  return next
}

export async function getCachedRulesPack(): Promise<CachedRulesPack | null> {
  const data = await chrome.storage.local.get(RULES_KEY)
  return (data[RULES_KEY] as CachedRulesPack) ?? null
}

export async function setCachedRulesPack(
  pack: CachedRulesPack
): Promise<void> {
  await chrome.storage.local.set({ [RULES_KEY]: pack })
}

export async function clearCloudState(): Promise<OpsGateSettings> {
  await chrome.storage.local.remove(RULES_KEY)
  return setSettings({
    mode: "local_only",
    orgId: undefined,
    orgName: undefined,
    agentId: undefined,
    deviceLabel: undefined,
    personalAccount: undefined,
    agentToken: undefined,
    rulesPackVersion: undefined,
    rulesPackChecksum: undefined,
    eventReporting: false,
    lastRulesSyncAt: undefined,
    lastSyncError: undefined,
    managedLockActive: false,
    managementPasswordHash: undefined,
    adminCredentials: undefined,
    requireUnenrollPassword: false,
    protectUnenroll: false,
    recoveryPasswordHash: undefined,
    recoveryOfflineAfterMs: undefined,
    configEpoch: undefined,
    policyProfileId: undefined,
    policyProfileName: undefined,
    lastEventError: undefined,
    enabled: true
  })
}

/**
 * Règles effectives :
 * - Si lock org + pack en cache → pack (même token mort / offline)
 * - Sinon pack si enrollé
 * - Sinon null = embarqué
 */
export async function getActiveRules(): Promise<DetectionRule[] | null> {
  const settings = await getSettings()
  const pack = await getCachedRulesPack()

  if (settings.managedLockActive && pack?.rules?.length) {
    return pack.rules
  }
  if (settings.mode === "local_only" || !settings.agentToken) {
    return null
  }
  if (pack?.rules?.length) return pack.rules
  return null
}

let memoryRules: DetectionRule[] | null = null

export function getMemoryRules(): DetectionRule[] | null {
  return memoryRules
}

export async function refreshMemoryRules(): Promise<DetectionRule[] | null> {
  memoryRules = await getActiveRules()
  return memoryRules
}

export function initRulesMemoryListener() {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return
    if (changes[RULES_KEY] || changes[SETTINGS_KEY]) {
      void refreshMemoryRules()
    }
  })
  void refreshMemoryRules()
}

/**
 * true = policy effective protège le désenrôlement ET au moins un admin hash
 * (flag calculé côté API : require_unenroll_password).
 */
export function requiresAdminPassword(settings: OpsGateSettings): boolean {
  if (settings.requireUnenrollPassword === true) return true
  if (
    settings.protectUnenroll &&
    (settings.adminCredentials?.length ||
      settings.managementPasswordHash?.trim())
  ) {
    return true
  }
  return false
}

/** Seuil offline pour autoriser vendor recovery (défaut 2h, override API) */
export function recoveryOfflineAfterMs(settings: OpsGateSettings): number {
  return settings.recoveryOfflineAfterMs ?? 2 * 60 * 60 * 1000
}

/**
 * Vendor recovery UNIQUEMENT si :
 * - lock/policy active
 * - pas de contact serveur depuis ≥ 2h (ou lastSyncError + âge last sync ≥ 2h)
 * Les postes synchronisés reçoivent les nouveaux mdp admin via poll 15 min.
 */
export function canUseVendorRecovery(settings: OpsGateSettings): boolean {
  if (!settings.managedLockActive && !settings.requireUnenrollPassword) {
    return false
  }
  const hasPool = (settings.recoveryCodes || []).some((c) => c.hash?.trim())
  const hasLegacy = !!settings.recoveryPasswordHash?.trim()
  if (!hasPool && !hasLegacy) return false
  const last = settings.lastRulesSyncAt || 0
  if (!last) {
    return !!settings.lastSyncError
  }
  const age = Date.now() - last
  return age >= recoveryOfflineAfterMs(settings)
}

export type ExitCredential =
  | {
      kind: "admin"
      id: string
      label: string
      email?: string
      hash: string
    }
  | { kind: "recovery"; hash: string; codeId?: string }

/**
 * Credentials de sortie :
 * - toujours les admins unenroll
 * - recovery one-time + legacy vendor si offline > 2h
 */
export function exitCredentials(settings: OpsGateSettings): ExitCredential[] {
  const list: ExitCredential[] = []
  for (const a of settings.adminCredentials || []) {
    if (a.passwordHash?.trim()) {
      list.push({
        kind: "admin",
        id: a.id,
        label: a.label,
        email: a.email,
        hash: a.passwordHash.trim()
      })
    }
  }
  if (list.length === 0 && settings.managementPasswordHash?.trim()) {
    list.push({
      kind: "admin",
      id: "legacy",
      label: "Administrator",
      email: "admin@demo.local",
      hash: settings.managementPasswordHash.trim()
    })
  }
  if (canUseVendorRecovery(settings)) {
    for (const rc of settings.recoveryCodes || []) {
      if (rc.hash?.trim()) {
        list.push({
          kind: "recovery",
          hash: rc.hash.trim(),
          codeId: rc.id
        })
      }
    }
    if (settings.recoveryPasswordHash?.trim()) {
      list.push({
        kind: "recovery",
        hash: settings.recoveryPasswordHash.trim()
      })
    }
  }
  return list
}

/** Protection active si licencié ou en grace 5 min */
export function isSecurityActive(settings: OpsGateSettings): boolean {
  if (settings.securityActive === false) return false
  if (settings.licensed !== false && settings.licenseStatus !== "unlicensed") {
    return true
  }
  if (settings.licenseStatus === "grace") return true
  if (settings.licenseStatus === "unlicensed") return false
  return settings.enabled !== false
}

/** @deprecated prefer exitCredentials */
export function exitPasswordHashes(settings: OpsGateSettings): string[] {
  return exitCredentials(settings).map((c) => c.hash)
}
