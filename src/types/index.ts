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

export type UserDecision =
  | "mask_send"
  | "secure_rewrite"
  | "send_anyway"
  | "cancel"
export type DetectionSource = "prompt" | "file"
export type AgentMode = "local_only" | "org_managed" | "org_managed_strict"
export type DefaultAction = "warn" | "mask_recommend" | "mask_force" | "block"

/** Messages banner/toast (sync policy org) */
export interface PolicyUserMessages {
  adminNotice: string
  alertTitle: string
  alertBody: string
  blockTitle: string
  blockBody: string
  maskForceTitle: string
  maskForceBody: string
  btnMask: string
  /** Secure Rewrite — action principale recommandée */
  btnSecureRewrite: string
  btnSendAnyway: string
  btnCancel: string
  btnBlockAck: string
  toastCancel: string
  toastMask: string
  toastSecureRewrite: string
  toastSendAnyway: string
  toastBlocked: string
  alertTitleFile: string
  alertBodyFile: string
}

export const DEFAULT_USER_MESSAGES: PolicyUserMessages = {
  adminNotice: "Politique de sécurité de votre organisation.",
  alertTitle: "Données sensibles détectées",
  alertBody: "Choisissez une action avant l'envoi.",
  blockTitle: "Envoi non autorisé",
  blockBody:
    "La politique bloque cet envoi. Contactez votre administrateur si besoin.",
  maskForceTitle: "Masquage obligatoire",
  maskForceBody: "L'envoi sans masquage n'est pas autorisé.",
  btnMask: "Masquer",
  btnSecureRewrite: "Secure Rewrite",
  btnSendAnyway: "Envoyer quand même",
  btnCancel: "Annuler",
  btnBlockAck: "Compris",
  toastCancel: "Envoi annulé.",
  toastMask: "Données masquées. Envoi en cours…",
  toastSecureRewrite: "Secure Rewrite appliqué. Envoi en cours…",
  toastSendAnyway: "Envoi journalisé.",
  toastBlocked: "Envoi bloqué. Aucune donnée transmise.",
  alertTitleFile: "Fichier : données sensibles",
  alertBodyFile: "Choisissez une action avant de joindre le fichier."
}

export function mergeUserMessages(
  partial?: Partial<PolicyUserMessages> | null
): PolicyUserMessages {
  if (!partial || typeof partial !== "object") {
    return { ...DEFAULT_USER_MESSAGES }
  }
  const out = { ...DEFAULT_USER_MESSAGES }
  for (const key of Object.keys(DEFAULT_USER_MESSAGES) as (keyof PolicyUserMessages)[]) {
    const v = partial[key]
    if (typeof v === "string" && v.trim()) out[key] = v.trim()
  }
  return out
}

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
  /** Scanner configs .conf .json .xml .ps1… (défaut true) */
  scanConfigs?: boolean
  /** Scanner .sql / warn .db (défaut true) */
  scanDatabases?: boolean
  /** OCR images — stub V1 (défaut false) */
  scanImages?: boolean
  /** Warning obligatoire audio/vidéo (défaut true) */
  warnMedia?: boolean
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
   * Hash break-glass concepteur legacy (stocké après sync).
   * Accepté seulement si offline ≥ recoveryOfflineAfterMs.
   */
  recoveryPasswordHash?: string
  /** Pool one-time (id + hash) — sync server ; splice local à l’usage */
  recoveryCodes?: Array<{ id: string; hash: string }>
  /** Seuil ms offline pour recovery vendor (défaut 2h) */
  recoveryOfflineAfterMs?: number
  /** Licence */
  licensed?: boolean
  licenseStatus?: "licensed" | "grace" | "unlicensed"
  unlicensedSince?: number
  licenseGraceMs?: number
  securityActive?: boolean
  /** Policy action effective (sync) */
  defaultAction?: DefaultAction
  /** Messages UX custom admin (partial) */
  userMessages?: Partial<PolicyUserMessages>
}

export type ExitActorInfo = {
  type: "admin" | "vendor_recovery" | "free"
  adminId?: string
  adminLabel?: string
  /** Si recovery one-time */
  recoveryCodeId?: string
}

export const DEFAULT_SETTINGS: OpsGateSettings = {
  enabled: true,
  scanUploads: true,
  scanConfigs: true,
  scanDatabases: true,
  scanImages: false,
  warnMedia: true,
  mode: "local_only",
  apiBaseUrl: "http://127.0.0.1:8787",
  eventReporting: false,
  managedLockActive: false,
  defaultAction: "mask_recommend",
  userMessages: { ...DEFAULT_USER_MESSAGES },
  enabledHosts: [
    "chatgpt.com",
    "chat.openai.com",
    "claude.ai",
    "gemini.google.com",
    "bard.google.com",
    "copilot.microsoft.com",
    "perplexity.ai",
    "chat.deepseek.com",
    "aistudio.google.com",
    "poe.com",
    "you.com",
    "chat.mistral.ai",
    "lechat.mistral.ai",
    "console.groq.com",
    "grok.x.ai",
    "grok.com",
    "huggingface.co",
    "phind.com",
    "meta.ai",
    "pi.ai",
    "character.ai",
    "notebooklm.google.com",
    "openrouter.ai",
    "together.ai",
    "fireworks.ai",
    "blackbox.ai",
    "chat.lmsys.org",
    "lmarena.ai",
    "typingmind.com",
    "chat.qwen.ai",
    "writesonic.com",
    "jasper.ai",
    "copy.ai",
    "notion.so",
    "platform.openai.com",
    "labs.google",
    "deepai.org",
    "sider.ai",
    "monica.im",
    "chatpdf.com",
    "consensus.app",
    "elicit.com"
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
  | {
      type: "CONTACT_ADMIN"
      subject: string
      body: string
      category?: "question" | "exception" | "block_appeal" | "other"
      contextUrl?: string
      contextHostname?: string
    }
  | { type: "LIST_ADMIN_MESSAGES" }
  | { type: "LIST_PENDING_ADMIN_REPLIES" }
  | { type: "ACK_ADMIN_REPLY"; messageId: string }
  /** OCR bitmap (Tesseract) — base64 sans préfixe data: */
  | {
      type: "OCR_BITMAP"
      base64: string
      mime?: string
      fileName?: string
    }
