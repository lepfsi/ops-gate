import type { DetectionRule } from "@opsgate/engine"

export type OrgMode = "local_only" | "org_managed" | "org_managed_strict"
export type EventPayloadPolicy = "metadata_only" | "metadata_plus_redacted_match"
export type DefaultAction = "warn" | "mask_recommend" | "mask_force" | "block"

/**
 * Messages utilisateur affichés par l’extension (banner / toast).
 * Personnalisables par l’admin ; valeurs par défaut ci-dessous.
 * But : l’utilisateur comprend que c’est une policy admin, pas une erreur technique.
 */
export interface PolicyUserMessages {
  /** Mention permanente : décision de l’organisation / admin */
  adminNotice: string
  /** Alerte détection (warn / mask_recommend) */
  alertTitle: string
  alertBody: string
  /** Blocage total (defaultAction = block) */
  blockTitle: string
  blockBody: string
  /** Masquage obligatoire (mask_force) */
  maskForceTitle: string
  maskForceBody: string
  /** Libellés boutons */
  btnMask: string
  btnSendAnyway: string
  btnCancel: string
  btnBlockAck: string
  /** Toasts après décision */
  toastCancel: string
  toastMask: string
  toastSendAnyway: string
  toastBlocked: string
  /** Fichier (variantes courtes) */
  alertTitleFile: string
  alertBodyFile: string
}

export const DEFAULT_USER_MESSAGES: PolicyUserMessages = {
  adminNotice:
    "Cette restriction est appliquée par la politique de sécurité de votre organisation (administrée via OpsGate). Ce n’est pas une erreur technique.",
  alertTitle: "Données sensibles détectées — action requise",
  alertBody:
    "Votre administrateur a configuré OpsGate pour protéger les données de l’entreprise avant envoi vers l’IA. Choisissez une action autorisée ci-dessous.",
  blockTitle: "Envoi non autorisé par votre administrateur",
  blockBody:
    "La politique de sécurité de votre organisation bloque cet envoi vers l’IA. Ce n’est pas un bug : l’accès est volontairement restreint. Contactez votre administrateur IT si vous avez besoin d’une exception.",
  maskForceTitle: "Masquage obligatoire (politique admin)",
  maskForceBody:
    "Votre administrateur impose le masquage des données sensibles avant tout envoi. L’envoi « tel quel » n’est pas autorisé.",
  btnMask: "Masquer & Envoyer",
  btnSendAnyway: "Envoyer quand même",
  btnCancel: "Annuler",
  btnBlockAck: "Compris — ne pas envoyer",
  toastCancel: "Envoi annulé — vos données n’ont pas été transmises à l’IA.",
  toastMask: "Données masquées selon la politique — envoi en cours…",
  toastSendAnyway:
    "Envoi sans masquage — action journalisée pour votre administrateur.",
  toastBlocked:
    "Envoi bloqué par la politique de votre organisation. Aucune donnée n’a été envoyée.",
  alertTitleFile: "Fichier retenu — données sensibles",
  alertBodyFile:
    "Votre administrateur a configuré OpsGate pour analyser les fichiers avant envoi à l’IA. Choisissez une action autorisée."
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

/** Horaires d’entreprise pour alertes « hors-ligne long » */
export interface WorkBreak {
  start: string // "12:00"
  end: string // "13:00"
}

export interface WorkSchedule {
  enabled: boolean
  /** IANA, ex. Europe/Paris */
  timezone: string
  /** 1=lundi … 7=dimanche (ISO) */
  workDays: number[]
  workStart: string // "08:00"
  workEnd: string // "17:00"
  breaks?: WorkBreak[]
}

/** Catégories de journaux activables (false = plus enregistrées) */
export interface OrgLogCategories {
  /** Events de détection extension (prompt / fichier) */
  detectionEvents: boolean
  /** Connexions console (login / logout) */
  adminLogin: boolean
  /** Autres actions audit admin (policy, packs…) */
  adminAudit: boolean
  /** Cycle de vie agent (enroll / unenroll / revoke) */
  agentLifecycle: boolean
  /**
   * Events issus du proxy local (source=proxy).
   * false = plus d’écriture (réduit le bruit en MMC).
   */
  proxyEvents?: boolean
}

/** Canaux d’alerte externes (email, Telegram, Slack, webhook générique) */
export type NotificationChannelKind =
  | "email"
  | "telegram"
  | "slack"
  | "webhook"

/**
 * Un canal de notification configuré par le client.
 * Secrets (bot token, webhooks) stockés dans monitoring org — protéger la DB.
 */
export interface OrgNotificationChannel {
  id: string
  kind: NotificationChannelKind
  enabled: boolean
  /** Libellé UI (ex. « SOC Telegram ») */
  label?: string
  /** email : destinataires de ce canal (sinon alertEmails global) */
  emails?: string[]
  /** telegram : token bot @BotFather */
  botToken?: string
  /** telegram : chat_id (groupe ou user) */
  chatId?: string
  /** slack Incoming Webhook URL ou webhook générique */
  webhookUrl?: string
}

/**
 * Notifications org — 100 % pilotées par le client (console Paramètres).
 * OpsGate n’impose pas les destinataires : le client choisit événements,
 * seuils, e-mails et canaux externes. Sans destinataire → pas d’envoi (audit seul).
 */
export interface OrgNotificationSettings {
  /** Alerte si licence / sièges proches de l’expiration */
  licenseExpiring: boolean
  /** Jours avant expiration pour notifier */
  licenseExpiringDays: number
  /** Alerte après N échecs de mdp admin (audit + option e-mail) */
  loginBruteForce: boolean
  /** Seuil d’échecs consécutifs (défaut 5) */
  loginBruteForceThreshold: number
  /** E-mail quand un compte admin est verrouillé */
  accountLockoutEmail: boolean
  /** E-mail si stock recovery codes bas */
  recoveryLowStock: boolean
  /** Seuil codes recovery actifs (défaut 5) */
  recoveryLowStockThreshold: number
  /**
   * Destinataires des alertes e-mail (un par ligne / virgule).
   * Vide = aucun envoi e-mail automatique (le client doit les renseigner).
   * Les canaux Telegram/Slack/webhook sont indépendants.
   */
  alertEmails: string[]
  /**
   * Canaux externes (Telegram, Slack, webhook…).
   * L’e-mail reste le canal historique via alertEmails + SMTP.
   */
  channels?: OrgNotificationChannel[]
}

/** Infos licence affichées console (contrat / facturation) */
export interface OrgLicenseDisplay {
  companyName: string
  address: string
  contactEmail: string
  /** Date d'expiration ISO ou vide */
  expiresAt?: string | null
  /** trial = 30 j post-création / full = clé constructeur activée */
  mode?: "trial" | "full"
  /** Sièges issus de la clé (full) */
  seats?: number
  activatedAt?: string | null
  /** Empreinte de la clé activée (pas le secret) */
  licenseKeyFingerprint?: string | null
}

/** Seuils monitoring dashboard (admin configurable) */
export interface OrgMonitoringSettings {
  /** last_seen < onlineMs → online */
  onlineMs: number
  /** last_seen > offlineLongMs → not connected long time */
  offlineLongMs: number
  schedule: WorkSchedule
  /**
   * Rétention des detection events (jours) - définie par l'entreprise.
   * Au-delà, purge auto (export avant si weeklyExportEnabled).
   */
  logRetentionDays: number
  /**
   * @deprecated Préférer scheduledLogExport.enabled
   * Conservé pour compat (miroir de scheduledLogExport.enabled).
   */
  weeklyExportEnabled: boolean
  /** @deprecated → scheduledLogExport.formats */
  weeklyExportFormats?: Array<"csv" | "json">
  /** @deprecated → scheduledLogExport (e-mails dédiés) */
  weeklyExportNotifyEmail?: boolean
  /**
   * Export automatique des logs events — 100 % configuré par le client :
   * e-mails destinataires, jour, heure, fuseau, formats.
   */
  scheduledLogExport?: ScheduledLogExportSettings
  /** Dernière archive hebdo générée (ISO + weekKey) */
  lastWeeklyExportAt?: string | null
  /** Quels types de logs garder (désactiver = plus d'écriture) */
  logCategories?: OrgLogCategories
  notifications?: OrgNotificationSettings
  /**
   * Rétention légale du journal d’audit admin (jours).
   * Min 90 / défaut 365. Les audits ne sont pas purgés avant cette échéance.
   * Indépendant de logRetentionDays (events détection).
   */
  auditLegalRetentionDays?: number
  /** Toujours true en pratique — sceau hash chaîne WORM sur chaque entrée audit */
  auditWormEnabled?: boolean
  /** Titulaire licence (entreprise) */
  licenseDisplay?: OrgLicenseDisplay
  /**
   * Proxy local org (P3 foundations).
   * mode observe = events only ; enforce = futur mask/block (stub P3).
   */
  proxy?: {
    enabled: boolean
    mode: "observe" | "enforce"
  }
  /**
   * SIEM / Syslog (V2 P0) — forward des detection events.
   * format rfc5424 (défaut) ou cef (ArcSight/Splunk).
   */
  siem?: OrgSiEmSettings
  /**
   * Quotas multi-tenant (V2 P1).
   * 0 = illimité pour chaque champ.
   */
  quotas?: OrgQuotaSettings
  /**
   * LDAP / Active Directory sync (V2 P2).
   * Bind password : préférer env OPSGATE_LDAP_BIND_PASSWORD.
   */
  ldap?: OrgLdapSettings
  /**
   * SMTP transactionnel (OTP reset mdp, notifications).
   * Prioritaire sur OPSGATE_SMTP_* env si enabled + host renseigné.
   * Mot de passe : non renvoyé en API (comme LDAP bind).
   */
  smtp?: OrgSmtpSettings
}

/** Config SMTP org — saisie client dans Paramètres → E-mail / SMTP */
export interface OrgSmtpSettings {
  enabled: boolean
  host: string
  port: number
  /** true = TLS implicite (465) */
  secure: boolean
  user: string
  /** stocké en monitoring_json ; jamais exposé en GET */
  password?: string
  /** Expéditeur visible (ex. OpsGate <noreply@entreprise.com>) */
  from: string
  /** lab : accepter certificat auto-signé */
  tlsInsecure?: boolean
}

export const DEFAULT_SMTP_SETTINGS: OrgSmtpSettings = {
  enabled: false,
  host: "",
  port: 587,
  secure: false,
  user: "",
  password: "",
  from: "",
  tlsInsecure: false
}

/** Config sync LDAP/AD → users & groups OpsGate */
export interface OrgLdapSettings {
  enabled: boolean
  /** ldaps://dc.example.com:636 ou ldap://... */
  url: string
  bindDn: string
  /** Optionnel si OPSGATE_LDAP_BIND_PASSWORD est défini */
  bindPassword?: string
  baseDn: string
  /** Filtre users AD (défaut : users actifs) */
  userFilter?: string
  /** Filtre groupes (défaut objectClass=group) */
  groupFilter?: string
  syncUsers?: boolean
  syncGroups?: boolean
  /** dry-run : lit AD sans écrire le store */
  dryRun?: boolean
  /** rejectUnauthorized: false pour lab */
  tlsInsecure?: boolean
  timeoutMs?: number
  sizeLimit?: number
  lastSyncAt?: string | null
  lastSyncMessage?: string | null
  lastSyncStats?: {
    groups_upserted?: number
    users_upserted?: number
    groups_seen?: number
    users_seen?: number
  } | null
}

export const DEFAULT_LDAP_SETTINGS: OrgLdapSettings = {
  enabled: false,
  url: "",
  bindDn: "",
  bindPassword: "",
  baseDn: "",
  userFilter:
    "(&(objectCategory=person)(objectClass=user)(!(userAccountControl:1.2.840.113556.1.4.803:=2)))",
  groupFilter: "(objectClass=group)",
  syncUsers: true,
  syncGroups: true,
  dryRun: false,
  tlsInsecure: false,
  timeoutMs: 30_000,
  sizeLimit: 5000,
  lastSyncAt: null,
  lastSyncMessage: null,
  lastSyncStats: null
}

export interface OrgQuotaSettings {
  /** Max detection events acceptés / jour UTC (0 = off) */
  maxEventsPerDay: number
  /** Max events / minute (burst) — 0 = off */
  maxEventsPerMinute?: number
  /**
   * Max agents actifs (extension + proxy) par org — 0 = off.
   * Re-enroll même fingerprint ne consomme pas de siège supplémentaire.
   */
  maxAgents?: number
}

export const DEFAULT_QUOTA_SETTINGS: OrgQuotaSettings = {
  maxEventsPerDay: 0,
  maxEventsPerMinute: 0,
  maxAgents: 0
}

/** Forward Syslog / SIEM (par org) */
export interface OrgSiEmSettings {
  enabled: boolean
  /** udp (défaut) | tcp */
  protocol: "udp" | "tcp"
  host: string
  port: number
  /** Syslog facility 0–23 (défaut 16 = local0) */
  facility: number
  format: "rfc5424" | "cef"
  /** APP-NAME RFC5424 (défaut OpsGate) */
  appName?: string
}

export const DEFAULT_SIEM_SETTINGS: OrgSiEmSettings = {
  enabled: false,
  protocol: "udp",
  host: "",
  port: 514,
  facility: 16,
  format: "rfc5424",
  appName: "OpsGate"
}

/** Code recovery one-time (hash only en base ; clair affiché une fois) */
export interface RecoveryCode {
  id: string
  orgId: string
  codeHash: string
  label?: string
  createdAt: string
  consumedAt?: string | null
  consumedAgentId?: string | null
  active: boolean
}

/**
 * Export planifié des logs (events) — choix client exclusif.
 * Jour 1=lundi … 7=dimanche (ISO). Heure locale du fuseau IANA.
 */
export interface ScheduledLogExportSettings {
  enabled: boolean
  /** Destinataires admin qui reçoivent l’export chaque semaine */
  recipientEmails: string[]
  /** 1=lundi … 7=dimanche */
  dayOfWeek: number
  /** HH:mm local (ex. "08:00") */
  timeLocal: string
  /** IANA, ex. Europe/Paris */
  timezone: string
  /** Formats générés et joints si possible */
  formats: Array<"csv" | "json">
  /**
   * Joindre les fichiers au mail si taille raisonnable.
   * Sinon e-mail de notification + téléchargement console.
   */
  attachFiles: boolean
}

export const DEFAULT_SCHEDULED_LOG_EXPORT: ScheduledLogExportSettings = {
  enabled: false,
  recipientEmails: [],
  dayOfWeek: 1,
  timeLocal: "08:00",
  timezone: "Europe/Paris",
  formats: ["csv"],
  attachFiles: true
}

/** Archive d’export logs (semaine / manuel) — téléchargeable avant purge */
export interface LogExportRecord {
  id: string
  orgId: string
  kind: "week" | "all" | "manual"
  format: "csv" | "json"
  filename: string
  /** Contenu texte (CSV ou JSON) — limité en taille côté store */
  content: string
  eventCount: number
  fromTs: string
  toTs: string
  createdAt: string
  /** Date après laquelle l’archive peut être purgée (rétention exports) */
  expiresAt: string
}

/**
 * Nettoie le label appareil (retire l’ancien préfixe « OpsGate Proxy »).
 * Affichage + stockage events : hostname seul pour les agents proxy.
 */
export function normalizeDeviceLabel(
  label?: string | null,
  hostName?: string | null
): string | undefined {
  let s = (label || "").trim()
  s = s.replace(/^OpsGate\s+Proxy\s*[-:–—]?\s*/i, "").trim()
  if (!s) s = (hostName || "").trim()
  return s || undefined
}

export const DEFAULT_LOG_CATEGORIES: OrgLogCategories = {
  detectionEvents: true,
  adminLogin: true,
  adminAudit: true,
  agentLifecycle: true,
  /** Proxy : on par défaut ; désactiver si trop de bruit en pilote */
  proxyEvents: true
}

export const DEFAULT_NOTIFICATION_SETTINGS: OrgNotificationSettings = {
  licenseExpiring: true,
  licenseExpiringDays: 30,
  loginBruteForce: true,
  loginBruteForceThreshold: 5,
  /** Off par défaut tant que le client n’a pas listé de destinataires */
  accountLockoutEmail: false,
  recoveryLowStock: false,
  recoveryLowStockThreshold: 5,
  alertEmails: [],
  channels: []
}

export const DEFAULT_MONITORING_SETTINGS: OrgMonitoringSettings = {
  onlineMs: 15 * 60 * 1000,
  offlineLongMs: 2 * 60 * 60 * 1000,
  schedule: {
    enabled: false,
    timezone: "Europe/Paris",
    workDays: [1, 2, 3, 4, 5],
    workStart: "08:00",
    workEnd: "17:00",
    breaks: [{ start: "12:00", end: "13:00" }]
  },
  logRetentionDays: 90,
  weeklyExportEnabled: false,
  weeklyExportFormats: ["csv"],
  weeklyExportNotifyEmail: false,
  scheduledLogExport: { ...DEFAULT_SCHEDULED_LOG_EXPORT },
  lastWeeklyExportAt: null,
  logCategories: { ...DEFAULT_LOG_CATEGORIES },
  notifications: { ...DEFAULT_NOTIFICATION_SETTINGS },
  auditLegalRetentionDays: 365,
  auditWormEnabled: true,
  licenseDisplay: {
    companyName: "",
    address: "",
    contactEmail: "",
    expiresAt: null,
    mode: "trial",
    seats: 0,
    activatedAt: null,
    licenseKeyFingerprint: null
  },
  proxy: {
    enabled: true,
    /** enforce = le proxy coupe les flux medium/high (filtre, y compris uploads textuels) */
    mode: "enforce"
  },
  siem: { ...DEFAULT_SIEM_SETTINGS },
  quotas: { ...DEFAULT_QUOTA_SETTINGS },
  ldap: { ...DEFAULT_LDAP_SETTINGS },
  smtp: { ...DEFAULT_SMTP_SETTINGS }
}

export function mergeMonitoringSettings(
  partial?: Partial<OrgMonitoringSettings> | null
): OrgMonitoringSettings {
  const base: OrgMonitoringSettings = {
    ...DEFAULT_MONITORING_SETTINGS,
    schedule: { ...DEFAULT_MONITORING_SETTINGS.schedule },
    logCategories: { ...DEFAULT_LOG_CATEGORIES },
    notifications: { ...DEFAULT_NOTIFICATION_SETTINGS },
    licenseDisplay: { ...DEFAULT_MONITORING_SETTINGS.licenseDisplay! }
  }
  if (!partial || typeof partial !== "object") return base
  if (typeof partial.onlineMs === "number" && partial.onlineMs >= 60_000) {
    base.onlineMs = partial.onlineMs
  }
  if (
    typeof partial.offlineLongMs === "number" &&
    partial.offlineLongMs >= 5 * 60_000
  ) {
    base.offlineLongMs = partial.offlineLongMs
  }
  if (
    typeof partial.logRetentionDays === "number" &&
    partial.logRetentionDays >= 1 &&
    partial.logRetentionDays <= 3650
  ) {
    base.logRetentionDays = Math.floor(partial.logRetentionDays)
  }
  if (typeof partial.auditLegalRetentionDays === "number") {
    // 90 j min · 3650 max — rétention légale audit (indépendante des events)
    const next = Math.min(
      3650,
      Math.max(90, Math.floor(partial.auditLegalRetentionDays))
    )
    base.auditLegalRetentionDays = next
  }
  // WORM audit : toujours actif (sceau hash chaîne)
  base.auditWormEnabled = true
  if (typeof partial.weeklyExportEnabled === "boolean") {
    base.weeklyExportEnabled = partial.weeklyExportEnabled
  }
  if (Array.isArray(partial.weeklyExportFormats)) {
    const formats = partial.weeklyExportFormats.filter(
      (f): f is "csv" | "json" => f === "csv" || f === "json"
    )
    base.weeklyExportFormats = formats.length ? formats : ["csv"]
  }
  if (typeof partial.weeklyExportNotifyEmail === "boolean") {
    base.weeklyExportNotifyEmail = partial.weeklyExportNotifyEmail
  }
  // Config planifiée dédiée (prioritaire)
  {
    const legEnabled = base.weeklyExportEnabled
    const legFormats = base.weeklyExportFormats || ["csv"]
    const fromPartial = partial.scheduledLogExport
    const merged: ScheduledLogExportSettings = {
      ...DEFAULT_SCHEDULED_LOG_EXPORT,
      // legacy mirror
      enabled: legEnabled,
      formats: legFormats,
      ...(fromPartial && typeof fromPartial === "object" ? fromPartial : {})
    }
    if (typeof fromPartial?.enabled === "boolean") {
      merged.enabled = fromPartial.enabled
      base.weeklyExportEnabled = fromPartial.enabled
    } else if (typeof partial.weeklyExportEnabled === "boolean") {
      merged.enabled = partial.weeklyExportEnabled
    }
    if (Array.isArray(fromPartial?.formats)) {
      const formats = fromPartial!.formats.filter(
        (f): f is "csv" | "json" => f === "csv" || f === "json"
      )
      merged.formats = formats.length ? formats : ["csv"]
      base.weeklyExportFormats = merged.formats
    } else if (Array.isArray(partial.weeklyExportFormats)) {
      merged.formats = base.weeklyExportFormats || ["csv"]
    }
    if (Array.isArray(fromPartial?.recipientEmails)) {
      merged.recipientEmails = fromPartial!.recipientEmails
        .map((e) => String(e || "").trim().toLowerCase())
        .filter((e) => e.includes("@"))
        .slice(0, 20)
    }
    if (
      typeof fromPartial?.dayOfWeek === "number" &&
      fromPartial.dayOfWeek >= 1 &&
      fromPartial.dayOfWeek <= 7
    ) {
      merged.dayOfWeek = Math.floor(fromPartial.dayOfWeek)
    }
    if (
      typeof fromPartial?.timeLocal === "string" &&
      /^\d{1,2}:\d{2}$/.test(fromPartial.timeLocal.trim())
    ) {
      const [hh, mm] = fromPartial.timeLocal.trim().split(":")
      const h = Math.min(23, Math.max(0, Number(hh) || 0))
      const m = Math.min(59, Math.max(0, Number(mm) || 0))
      merged.timeLocal = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
    }
    if (
      typeof fromPartial?.timezone === "string" &&
      fromPartial.timezone.trim()
    ) {
      merged.timezone = fromPartial.timezone.trim()
    }
    if (typeof fromPartial?.attachFiles === "boolean") {
      merged.attachFiles = fromPartial.attachFiles
    }
    base.scheduledLogExport = merged
  }
  if (partial.lastWeeklyExportAt !== undefined) {
    base.lastWeeklyExportAt = partial.lastWeeklyExportAt
  }
  if (partial.logCategories && typeof partial.logCategories === "object") {
    base.logCategories = {
      ...DEFAULT_LOG_CATEGORIES,
      ...partial.logCategories
    }
  }
  if (partial.notifications && typeof partial.notifications === "object") {
    base.notifications = {
      ...DEFAULT_NOTIFICATION_SETTINGS,
      ...partial.notifications
    }
    if (
      typeof partial.notifications.licenseExpiringDays === "number" &&
      partial.notifications.licenseExpiringDays >= 1 &&
      partial.notifications.licenseExpiringDays <= 365
    ) {
      base.notifications.licenseExpiringDays = Math.floor(
        partial.notifications.licenseExpiringDays
      )
    }
    if (
      typeof partial.notifications.loginBruteForceThreshold === "number" &&
      partial.notifications.loginBruteForceThreshold >= 3 &&
      partial.notifications.loginBruteForceThreshold <= 50
    ) {
      base.notifications.loginBruteForceThreshold = Math.floor(
        partial.notifications.loginBruteForceThreshold
      )
    }
    if (
      typeof partial.notifications.recoveryLowStockThreshold === "number" &&
      partial.notifications.recoveryLowStockThreshold >= 1 &&
      partial.notifications.recoveryLowStockThreshold <= 50
    ) {
      base.notifications.recoveryLowStockThreshold = Math.floor(
        partial.notifications.recoveryLowStockThreshold
      )
    }
    if (Array.isArray(partial.notifications.alertEmails)) {
      base.notifications.alertEmails = partial.notifications.alertEmails
        .map((e) => String(e || "").trim().toLowerCase())
        .filter((e) => e.includes("@"))
        .slice(0, 20)
    }
    if (Array.isArray(partial.notifications.channels)) {
      base.notifications.channels = partial.notifications.channels
        .filter((ch) => ch && typeof ch === "object")
        .slice(0, 12)
        .map((ch, i) => {
          const kind = String(ch.kind || "").toLowerCase()
          const k: NotificationChannelKind =
            kind === "telegram" || kind === "slack" || kind === "webhook"
              ? kind
              : "email"
          const id =
            typeof ch.id === "string" && ch.id.trim()
              ? ch.id.trim().slice(0, 64)
              : `ch_${k}_${i}_${Date.now().toString(36)}`
          const emails = Array.isArray(ch.emails)
            ? ch.emails
                .map((e) => String(e || "").trim().toLowerCase())
                .filter((e) => e.includes("@"))
                .slice(0, 20)
            : undefined
          return {
            id,
            kind: k,
            enabled: ch.enabled !== false,
            label:
              typeof ch.label === "string"
                ? ch.label.trim().slice(0, 80)
                : undefined,
            emails,
            botToken:
              typeof ch.botToken === "string"
                ? ch.botToken.trim().slice(0, 200)
                : undefined,
            chatId:
              typeof ch.chatId === "string"
                ? ch.chatId.trim().slice(0, 80)
                : undefined,
            webhookUrl:
              typeof ch.webhookUrl === "string"
                ? ch.webhookUrl.trim().slice(0, 500)
                : undefined
          } satisfies OrgNotificationChannel
        })
    }
  }
  if (partial.licenseDisplay && typeof partial.licenseDisplay === "object") {
    base.licenseDisplay = {
      companyName:
        typeof partial.licenseDisplay.companyName === "string"
          ? partial.licenseDisplay.companyName
          : base.licenseDisplay!.companyName,
      address:
        typeof partial.licenseDisplay.address === "string"
          ? partial.licenseDisplay.address
          : base.licenseDisplay!.address,
      contactEmail:
        typeof partial.licenseDisplay.contactEmail === "string"
          ? partial.licenseDisplay.contactEmail
          : base.licenseDisplay!.contactEmail,
      expiresAt:
        partial.licenseDisplay.expiresAt !== undefined
          ? partial.licenseDisplay.expiresAt
          : base.licenseDisplay!.expiresAt,
      mode:
        partial.licenseDisplay.mode === "full" ||
        partial.licenseDisplay.mode === "trial"
          ? partial.licenseDisplay.mode
          : base.licenseDisplay!.mode,
      seats:
        typeof partial.licenseDisplay.seats === "number"
          ? partial.licenseDisplay.seats
          : base.licenseDisplay!.seats,
      activatedAt:
        partial.licenseDisplay.activatedAt !== undefined
          ? partial.licenseDisplay.activatedAt
          : base.licenseDisplay!.activatedAt,
      licenseKeyFingerprint:
        partial.licenseDisplay.licenseKeyFingerprint !== undefined
          ? partial.licenseDisplay.licenseKeyFingerprint
          : base.licenseDisplay!.licenseKeyFingerprint
    }
  }
  if (partial.siem && typeof partial.siem === "object") {
    const s = partial.siem
    base.siem = {
      ...DEFAULT_SIEM_SETTINGS,
      ...base.siem,
      enabled: s.enabled === true,
      protocol: s.protocol === "tcp" ? "tcp" : "udp",
      host: typeof s.host === "string" ? s.host.trim() : base.siem?.host || "",
      port:
        typeof s.port === "number" && s.port >= 1 && s.port <= 65535
          ? Math.floor(s.port)
          : base.siem?.port || 514,
      facility:
        typeof s.facility === "number" && s.facility >= 0 && s.facility <= 23
          ? Math.floor(s.facility)
          : base.siem?.facility ?? 16,
      format: s.format === "cef" ? "cef" : "rfc5424",
      appName:
        typeof s.appName === "string" && s.appName.trim()
          ? s.appName.trim().slice(0, 48)
          : base.siem?.appName || "OpsGate"
    }
  }
  if (partial.quotas && typeof partial.quotas === "object") {
    const q = partial.quotas
    base.quotas = {
      maxEventsPerDay:
        typeof q.maxEventsPerDay === "number" && q.maxEventsPerDay >= 0
          ? Math.floor(q.maxEventsPerDay)
          : base.quotas?.maxEventsPerDay ?? 0,
      maxEventsPerMinute:
        typeof q.maxEventsPerMinute === "number" && q.maxEventsPerMinute >= 0
          ? Math.floor(q.maxEventsPerMinute)
          : base.quotas?.maxEventsPerMinute ?? 0,
      maxAgents:
        typeof q.maxAgents === "number" && q.maxAgents >= 0
          ? Math.floor(q.maxAgents)
          : base.quotas?.maxAgents ?? 0
    }
  }
  if (partial.ldap && typeof partial.ldap === "object") {
    const l = partial.ldap
    const prev = base.ldap || DEFAULT_LDAP_SETTINGS
    base.ldap = {
      ...DEFAULT_LDAP_SETTINGS,
      ...prev,
      enabled: l.enabled !== undefined ? !!l.enabled : prev.enabled,
      url: typeof l.url === "string" ? l.url.trim() : prev.url,
      bindDn: typeof l.bindDn === "string" ? l.bindDn.trim() : prev.bindDn,
      // empty string keeps previous secret
      bindPassword:
        typeof l.bindPassword === "string" && l.bindPassword.length > 0
          ? l.bindPassword
          : prev.bindPassword || "",
      baseDn: typeof l.baseDn === "string" ? l.baseDn.trim() : prev.baseDn,
      userFilter:
        typeof l.userFilter === "string" && l.userFilter.trim()
          ? l.userFilter.trim()
          : prev.userFilter,
      groupFilter:
        typeof l.groupFilter === "string" && l.groupFilter.trim()
          ? l.groupFilter.trim()
          : prev.groupFilter,
      syncUsers: l.syncUsers !== undefined ? !!l.syncUsers : prev.syncUsers,
      syncGroups:
        l.syncGroups !== undefined ? !!l.syncGroups : prev.syncGroups,
      dryRun: l.dryRun !== undefined ? !!l.dryRun : prev.dryRun,
      tlsInsecure:
        l.tlsInsecure !== undefined ? !!l.tlsInsecure : prev.tlsInsecure,
      timeoutMs:
        typeof l.timeoutMs === "number" && l.timeoutMs > 0
          ? Math.floor(l.timeoutMs)
          : prev.timeoutMs,
      sizeLimit:
        typeof l.sizeLimit === "number" && l.sizeLimit > 0
          ? Math.floor(l.sizeLimit)
          : prev.sizeLimit,
      lastSyncAt:
        l.lastSyncAt !== undefined ? l.lastSyncAt : prev.lastSyncAt,
      lastSyncMessage:
        l.lastSyncMessage !== undefined
          ? l.lastSyncMessage
          : prev.lastSyncMessage,
      lastSyncStats:
        l.lastSyncStats !== undefined ? l.lastSyncStats : prev.lastSyncStats
    }
  }
  if (partial.smtp && typeof partial.smtp === "object") {
    const s = partial.smtp
    const prev = base.smtp || DEFAULT_SMTP_SETTINGS
    base.smtp = {
      ...DEFAULT_SMTP_SETTINGS,
      ...prev,
      enabled: s.enabled !== undefined ? !!s.enabled : prev.enabled,
      host: typeof s.host === "string" ? s.host.trim() : prev.host,
      port:
        typeof s.port === "number" && s.port >= 1 && s.port <= 65535
          ? Math.floor(s.port)
          : prev.port,
      secure: s.secure !== undefined ? !!s.secure : prev.secure,
      user: typeof s.user === "string" ? s.user.trim() : prev.user,
      // empty keeps previous secret
      password:
        typeof s.password === "string" && s.password.length > 0
          ? s.password
          : prev.password || "",
      from: typeof s.from === "string" ? s.from.trim() : prev.from,
      tlsInsecure:
        s.tlsInsecure !== undefined ? !!s.tlsInsecure : prev.tlsInsecure
    }
  }
  if (partial.schedule && typeof partial.schedule === "object") {
    base.schedule = {
      ...DEFAULT_MONITORING_SETTINGS.schedule,
      ...partial.schedule,
      workDays:
        Array.isArray(partial.schedule.workDays) &&
        partial.schedule.workDays.length
          ? partial.schedule.workDays.map(Number)
          : DEFAULT_MONITORING_SETTINGS.schedule.workDays,
      breaks: Array.isArray(partial.schedule.breaks)
        ? partial.schedule.breaks
        : DEFAULT_MONITORING_SETTINGS.schedule.breaks
    }
  }
  if (partial.proxy && typeof partial.proxy === "object") {
    base.proxy = {
      enabled:
        typeof partial.proxy.enabled === "boolean"
          ? partial.proxy.enabled
          : base.proxy!.enabled,
      mode:
        partial.proxy.mode === "enforce" || partial.proxy.mode === "observe"
          ? partial.proxy.mode
          : base.proxy!.mode
    }
  }
  return base
}

export interface Organization {
  id: string
  name: string
  slug: string
  /** Code court pour enrollment agent (ex: DEMO-OPSGATE) */
  orgCode: string
  modeDefault: OrgMode
  eventPayloadPolicy: EventPayloadPolicy
  /**
   * Email principal install (reset admin principal + notifications produit).
   */
  primaryEmail: string
  /** Org personnelle (standalone users / mini cloud) */
  isPersonal?: boolean
  /** Sièges licences agents (0 = illimité démo) */
  licenseSeats?: number
  /** Seuils offline + planning horaires */
  monitoring?: Partial<OrgMonitoringSettings>
  createdAt: string
}

/** Permissions console / actions admin (hors principal qui a tout) */
export type AdminPermission =
  | "console_access"
  | "unenroll_agents"
  | "manage_admins"
  | "manage_policies"
  | "manage_users"
  /** Secondaire : peut demander un OTP e-mail pour réinit. son propre mdp */
  | "email_password_reset"

export const ALL_ADMIN_PERMISSIONS: AdminPermission[] = [
  "console_access",
  "unenroll_agents",
  "manage_admins",
  "manage_policies",
  "manage_users",
  "email_password_reset"
]

export const ADMIN_PERMISSION_LABELS: Record<AdminPermission, string> = {
  console_access: "Accès console",
  unenroll_agents: "Désenrôler agents",
  manage_admins: "Gérer les admins",
  manage_policies: "Gérer policies / packs",
  manage_users: "Gérer users / groupes / licences agents",
  email_password_reset: "Réinit. mdp par e-mail (self)"
}

/**
 * Administrateur org.
 * - Principal(s) : full access (plusieurs autorisés).
 * - Secondaires : email + rôles spécifiques.
 */
export interface OrgAdmin {
  id: string
  orgId: string
  /** Label affiché / audit : Administrator, admin2, SOC… */
  label: string
  email: string
  passwordHash: string
  /**
   * Hashes des mots de passe précédents (anti-réutilisation).
   * Ne jamais renvoyer à la console.
   */
  passwordHistory?: string[]
  /** Super-admin : tous les droits (plusieurs par org possibles) */
  isPrincipal: boolean
  /** Rôles (principal ignore et a tout) */
  permissions: AdminPermission[]
  active: boolean
  createdAt: string
  updatedAt: string
  /** Forcer changement mdp après setup (mdp défaut 0000) */
  mustChangePassword?: boolean
  /** Compteur échecs login consécutifs */
  failedLoginCount?: number
  /** Verrouillage après seuil d’échecs (ISO) — null = non verrouillé */
  lockedAt?: string | null
  /** MFA TOTP activé (V2 P1) */
  totpEnabled?: boolean
  /** Secret base32 (stocké côté serveur — protéger la DB) */
  totpSecret?: string | null
  /** Secret en attente de confirmation (setup) */
  totpPendingSecret?: string | null
}

export interface AdminSession {
  token: string
  orgId: string
  adminId: string
  expiresAt: number
  createdAt: number
  /** Dernière activité API (heartbeat) — idle serveur */
  lastActivityAt: number
  /**
   * Session concurrente en lecture seule (si une session pleine est déjà active).
   * Interdit les mutations (POST/PUT/PATCH/DELETE hors logout).
   */
  readOnly?: boolean
}

/** Utilisateur logique (pré-LDAP) — lié à des groupes */
export interface OrgUser {
  id: string
  orgId: string
  displayName: string
  email?: string
  /** Futur : objectGUID / sAMAccountName LDAP */
  externalId?: string
  groupIds: string[]
  /**
   * Licence manuelle (priorité sur héritage groupe).
   * null/undefined = pas d'override manuel → hérite des groupes.
   */
  licenseManual?: boolean | null
  createdAt: string
}

/** Groupe d'utilisateurs — peut recevoir une policy profil */
export interface UserGroup {
  id: string
  orgId: string
  name: string
  description?: string
  /** Policy profil appliquée aux membres (si pas d'override agent) */
  policyProfileId?: string
  /** Membres de ce groupe reçoivent une licence (si pas de refuse manuel) */
  grantsLicense?: boolean
  /** Futur : DN / SID groupe AD */
  ldapExternalId?: string
  createdAt: string
  updatedAt: string
}

/** Pool licences org (pilot) */
export interface LicensePool {
  orgId: string
  /** Si 0 = illimité en démo */
  seats: number
  updatedAt: string
}

/**
 * Profil de policy (département / équipe / policy1, policy2…).
 */
export interface PolicyProfile {
  id: string
  orgId: string
  name: string
  /** Ex: finance, engineering, default */
  department?: string
  defaultAction: DefaultAction
  enabledHosts: string[]
  /** false = pas d'upload de fichiers autorisé pour ce profil */
  scanUploads: boolean
  eventReporting: boolean
  /**
   * Si true : désenrôlement protégé par mdp admin (si au moins un admin actif).
   * Si false : sortie libre même si des admins existent.
   */
  protectUnenroll: boolean
  /** false = profil désactivé (non appliqué, conservé) */
  enabled?: boolean
  /**
   * Priorité type firewall : plus petit = prioritaire (1 avant 100).
   * En cas de multi-match groupes, le plus bas gagne.
   */
  priority?: number
  /** Groupes soumis à cette policy */
  assignedGroupIds: string[]
  /** Users soumis directement (hors groupe) */
  assignedUserIds: string[]
  /** Messages banner (override policy org si définis) */
  userMessages?: Partial<PolicyUserMessages>
  /**
   * Horaires de ce profil (optionnel).
   * Si enabled, remplace le planning org pour les alertes offline de ces agents.
   */
  workSchedule?: WorkSchedule | null
  updatedAt: string
}

export interface Policy {
  id: string
  orgId: string
  version: number
  defaultAction: DefaultAction
  enabledHosts: string[]
  scanUploads: boolean
  eventReporting: boolean
  /** Version du pack actuellement servi aux agents */
  rulesPackVersion: string
  /**
   * Legacy single-hash (migré vers OrgAdmin si possible).
   * Conservé pour compat agents / OTP.
   */
  managementPasswordHash: string
  /**
   * Si true : policy org défaut protège le désenrôlement (mdp admin requis).
   */
  protectUnenroll: boolean
  /** Horaires policy org (optionnel, fallback monitoring org) */
  workSchedule?: WorkSchedule | null
  /**
   * Epoch de force-sync (incrémenté depuis la console).
   */
  configEpoch: number
  /** Messages UX end-user (banner) — partial OK, merge avec defaults */
  userMessages?: Partial<PolicyUserMessages>
  updatedAt: string
}

export interface Agent {
  id: string
  orgId: string
  deviceLabel?: string
  /**
   * Hostname machine (futur DNS / inventaire).
   * En pilot : optionnel, renseigné par l'agent si dispo.
   */
  hostName?: string
  enrolledAt: string
  /** SHA-256 hex of bearer token */
  tokenHash: string
  appVersion?: string
  lastSeenAt: string
  modeOverride?: OrgMode
  /** Profil de policy assigné manuellement — priorité haute */
  policyProfileId?: string
  /** Utilisateur lié (assignation console / futur LDAP) */
  userId?: string
  /** Groupe d'affectation (moving rule ou manuel bulk) */
  groupId?: string
  /** Dernier config_epoch appliqué (info admin) */
  lastConfigEpoch?: number
  /**
   * Licence siège agent (monétisation).
   * true = siège consommé ; false = pas de licence → grace 5 min puis unlicensed.
   */
  licenseAssigned: boolean
  /** Premier moment sans licence (grace 5 min) */
  unlicensedSince?: string
  /** Compte personnel (org PERSONAL) — mini policies self-service */
  personalAccount?: boolean
  /**
   * Empreinte stable de l’installation extension (anti-doublon).
   * Même PC / rebuild → même fingerprint → ré-enroll du même agent.
   */
  deviceFingerprint?: string
  /** extension (défaut) | proxy (data-plane local P2+) */
  deviceType?: "extension" | "proxy"
  /**
   * Mode maintenance (P3) — exclus des alertes « hors ligne prolongé ».
   * leave = congés/mission · outage = panne · remote = hors site volontaire
   */
  maintenanceMode?: "leave" | "outage" | "remote" | null
  maintenanceNote?: string | null
}

export interface PasswordResetChallenge {
  orgId: string
  /** Admin dont le mdp sera réinitialisé (pas forcément le seed DEMO) */
  adminId: string
  targetEmail: string
  codeHash: string
  expiresAt: number
  createdAt: number
}

/** Pack immuable une fois publié */
export interface StoredRulePack {
  packId: string
  orgId: string
  version: string
  schemaVersion: number
  minEngineVersion?: string
  checksum: string
  signature: string
  rules: DetectionRule[]
  notes?: string
  publishedAt: string
  publishedBy: string
  /** true si c'est le pack actif de l'org */
  active: boolean
}

export interface RulesPackPayload {
  version: string
  checksum: string
  signature: string
  rules: DetectionRule[]
  notes?: string
  pack_id?: string
  schema_version?: number
  published_at?: string
}

export type EventSource = "prompt" | "file" | "system" | "text" | "proxy"
export type EventDecision =
  | "mask_send"
  | "send_anyway"
  | "cancel"
  | "unenroll"
  | "enroll"
  /** Proxy : détection observée (pas de blocage) */
  | "observe"
  /** Proxy enforce : flux coupé suite à détection */
  | "block"

/** low | medium | high | warning (system.unenroll) */
export type EventSeverity = "low" | "medium" | "high" | "warning"

export interface DetectionEventInput {
  schema_version: number
  client_event_id: string
  ts: string
  source: EventSource
  hostname: string
  decision: EventDecision
  detection_count: number
  highest_severity: EventSeverity
  rule_ids: string[]
  types: string[]
  masked?: boolean
  file_names?: string[] | null
  redacted_matches?: unknown
  /** Qui a autorisé le désenrôlement : admin:admin1 | vendor_recovery | free */
  exit_actor?: string
  exit_admin_id?: string
  exit_admin_label?: string
  /** Label agent / user pour audit */
  device_label?: string
  user_display_name?: string
}

export interface StoredEvent extends DetectionEventInput {
  id: string
  orgId: string
  /** Null si l’agent a été révoqué (historique conservé) */
  agentId?: string
  receivedAt: string
}

/** Journal d’audit console admin — toute mutation console doit logger */
export type AdminAuditAction =
  | "login"
  | "logout"
  | "logout_idle"
  | "policy_update"
  | "admin_create"
  | "admin_update"
  | "admin_delete"
  | "admin_password_reset"
  | "password_change"
  | "agent_revoke"
  | "agent_license"
  | "pack_publish"
  | "rule_disable"
  | "pack_activate"
  | "force_sync"
  | "profile_upsert"
  | "profile_delete"
  | "group_upsert"
  | "group_delete"
  | "user_upsert"
  | "user_delete"
  | "agent_assign"
  | "moving_rule_upsert"
  | "moving_rule_delete"
  | "moving_rule_apply"
  | "org_settings_update"
  | "agent_merge"
  | "report_export"
  | "mfa_enable"
  | "mfa_disable"
  | "recovery_info_view"
  | "recovery_codes_generated"
  | "recovery_code_consumed"
  | "recovery_pool_revoked"
  | "events_export"
  | "login_failed"
  | "login_brute_force"
  | "account_locked"
  | "account_unlocked"
  | "inbox_reply"
  | "inbox_close"
  | "inbox_read"

/** Message utilisateur → admin (inbox type Kaspersky) */
export type InboxMessageStatus = "open" | "read" | "replied" | "closed"
export type InboxMessageCategory =
  | "question"
  | "exception"
  | "block_appeal"
  | "other"

export interface UserInboxMessage {
  id: string
  orgId: string
  agentId: string
  deviceLabel: string
  hostName?: string | null
  category: InboxMessageCategory
  subject: string
  body: string
  contextUrl?: string | null
  contextHostname?: string | null
  status: InboxMessageStatus
  createdAt: string
  readAt?: string | null
  repliedAt?: string | null
  closedAt?: string | null
  adminReply?: string | null
  repliedByAdminId?: string | null
  repliedByAdminLabel?: string | null
  /** Agent a vu / acquitté la réponse admin (popup OK) */
  userAckedAt?: string | null
}

export interface AdminAuditEvent {
  id: string
  orgId: string
  adminId?: string
  adminEmail?: string
  adminLabel?: string
  action: AdminAuditAction
  detail?: string
  meta?: Record<string, unknown>
  createdAt: string
  /** WORM : numéro de séquence monotony par org */
  seq?: number
  /** WORM : SHA-256 de l’entrée */
  entryHash?: string
  /** WORM : hash de l’entrée précédente (GENESIS pour la 1ʳᵉ) */
  prevHash?: string
}

/**
 * Règle d'affectation automatique d'agents (inspiré Kaspersky « moving rules »).
 * Ex. : device_label starts_with "FIN" → groupe Finance (+ policy du groupe).
 * Plusieurs conditions : AND (défaut) ou OR. Priorité plus petite = d'abord.
 */
export type MovingMatchField = "device_label" | "host_name"
export type MovingMatchOp = "starts_with" | "contains" | "equals" | "regex"
/** Combinaison des conditions multi */
export type MovingConditionLogic = "and" | "or"

export interface MovingCondition {
  field: MovingMatchField
  op: MovingMatchOp
  value: string
}

export interface MovingRule {
  id: string
  orgId: string
  name: string
  enabled: boolean
  /** Conditions multi — au moins une. */
  conditions: MovingCondition[]
  /** and = toutes (défaut V1.x) · or = au moins une */
  conditionLogic: MovingConditionLogic
  /** @deprecated use conditions[0] */
  matchField: MovingMatchField
  /** @deprecated use conditions[0] */
  matchOp: MovingMatchOp
  /** @deprecated use conditions[0] */
  matchValue: string
  /** Groupe cible (hérite policyProfileId du groupe si présent) */
  targetGroupId: string
  /** Priorité : plus petit = évalué en premier (style firewall) */
  priority: number
  /** true = n'applique que si l'agent n'a pas encore de groupe (défaut) */
  onlyIfUnassigned: boolean
  /**
   * true = permanent : s’applique même si l’agent a déjà un groupe
   * (écrase onlyIfUnassigned). Utile pour règles prioritaires.
   */
  permanent: boolean
  createdAt: string
  updatedAt: string
}

/** Identité du secret utilisé pour sortir */
export type ExitActorType = "admin" | "vendor_recovery" | "free"

export interface ExitActor {
  type: ExitActorType
  admin_id?: string
  admin_label?: string
}
