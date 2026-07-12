/**
 * Types agent (extension).
 * Types détection = @opsgate/engine (source de vérité).
 */
export type {
  Severity,
  RuleCategory,
  RuleAction,
  DetectionRule,
  Detection
} from "@opsgate/engine"

export type UserDecision = "mask_send" | "send_anyway" | "cancel"
export type DetectionSource = "prompt" | "file"
export type AgentMode = "local_only" | "org_managed" | "org_managed_strict"

import type { DetectionRule, Severity } from "@opsgate/engine"

export interface JournalEntry {
  id: string
  timestamp: number
  url: string
  hostname: string
  decision: UserDecision
  detectionCount: number
  highestSeverity: Severity
  types: string[]
  ruleIds?: string[]
  masked: boolean
  source: DetectionSource
  fileNames?: string[]
}

export interface OpsGateSettings {
  enabled: boolean
  enabledHosts: string[]
  scanUploads: boolean
  mode: AgentMode
  apiBaseUrl: string
  orgId?: string
  orgName?: string
  agentId?: string
  /** Label appareil saisi à l'enrôlement (identifiant inventaire) */
  deviceLabel?: string
  /** Compte personnel (org PERSONAL) */
  personalAccount?: boolean
  agentToken?: string
  rulesPackVersion?: string
  rulesPackChecksum?: string
  eventReporting: boolean
  lastRulesSyncAt?: number
  lastSyncError?: string
  lastEventError?: string
  /** Dernier config_epoch reçu (force-sync console) */
  configEpoch?: number
  policyProfileId?: string
  policyProfileName?: string
  /**
   * true après AU MOINS un sync org réussi.
   * Verrouille les policies locales (pas de modif / désactivation utilisateur).
   * Ne force PAS un mdp de sortie — voir managementPasswordHash.
   */
  managedLockActive?: boolean
  /**
   * Hash legacy single admin (compat).
   * Préférer adminCredentials multi.
   */
  managementPasswordHash?: string
  /**
   * Multi-admins (admin1, admin2…) — hashes reçus au sync.
   */
  adminCredentials?: Array<{
    id: string
    label: string
    email?: string
    passwordHash: string
  }>
  /**
   * Policy effective exige un mdp de désinscription.
   */
  requireUnenrollPassword?: boolean
  protectUnenroll?: boolean
  /**
   * Hash break-glass concepteur (stocké après sync).
   * Accepté seulement si offline ≥ recoveryOfflineAfterMs.
   */
  recoveryPasswordHash?: string
  /** Seuil ms offline pour recovery vendor (défaut 2h) */
  recoveryOfflineAfterMs?: number
  /** Licence */
  licensed?: boolean
  licenseStatus?: "licensed" | "grace" | "unlicensed"
  unlicensedSince?: number
  licenseGraceMs?: number
  securityActive?: boolean
}

export type ExitActorInfo = {
  type: "admin" | "vendor_recovery" | "free"
  adminId?: string
  adminLabel?: string
}

export const DEFAULT_SETTINGS: OpsGateSettings = {
  enabled: true,
  scanUploads: true,
  mode: "local_only",
  apiBaseUrl: "http://127.0.0.1:8787",
  eventReporting: false,
  managedLockActive: false,
  enabledHosts: [
    "chatgpt.com",
    "chat.openai.com",
    "claude.ai",
    "gemini.google.com",
    "copilot.microsoft.com",
    "perplexity.ai",
    "chat.deepseek.com",
    "aistudio.google.com"
  ]
}

export interface CachedRulesPack {
  version: string
  checksum: string
  signature?: string
  rules: DetectionRule[]
  syncedAt: number
}

export type OpsGateMessage =
  | { type: "PING" }
  | { type: "DETECT"; text: string }
  | { type: "LOG_DETECTION"; entry: Omit<JournalEntry, "id" | "timestamp"> }
  | { type: "GET_SETTINGS" }
  | { type: "GET_JOURNAL" }
  | { type: "CLEAR_JOURNAL" }
  | { type: "SET_ENABLED"; enabled: boolean }
  | { type: "SET_SETTINGS"; partial: Partial<OpsGateSettings> }
  | {
      type: "ENROLL"
      orgCode: string
      deviceLabel?: string
      apiBaseUrl?: string
      personal?: boolean
      personalLicenseKey?: string
    }
  | { type: "SYNC_NOW" }
  | { type: "UNENROLL"; adminUsername?: string; adminPassword?: string }
  | {
      type: "RESET_LOCAL_ORG"
      adminUsername?: string
      adminPassword?: string
    }
  | { type: "GET_CLOUD_STATUS" }
