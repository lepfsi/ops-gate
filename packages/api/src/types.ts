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
  /** Events de détection (prompt / fichier) */
  detectionEvents: boolean
  /** Connexions console (login / logout) */
  adminLogin: boolean
  /** Autres actions audit admin (policy, packs…) */
  adminAudit: boolean
  /** Cycle de vie agent (enroll / unenroll / revoke) */
  agentLifecycle: boolean
}

/** Notifications org (console + audit) */
export interface OrgNotificationSettings {
  /** Alerte si licence / sièges proches de l’expiration */
  licenseExpiring: boolean
  /** Jours avant expiration pour notifier */
  licenseExpiringDays: number
  /** Alerte après N échecs de mdp admin */
  loginBruteForce: boolean
  /** Seuil d’échecs consécutifs (défaut 5) */
  loginBruteForceThreshold: number
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
  /** Génère une archive téléchargeable chaque fin de semaine ISO */
  weeklyExportEnabled: boolean
  /** Dernière archive hebdo générée (ISO) */
  lastWeeklyExportAt?: string | null
  /** Quels types de logs garder (désactiver = plus d'écriture) */
  logCategories?: OrgLogCategories
  notifications?: OrgNotificationSettings
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

export const DEFAULT_LOG_CATEGORIES: OrgLogCategories = {
  detectionEvents: true,
  adminLogin: true,
  adminAudit: true,
  agentLifecycle: true
}

export const DEFAULT_NOTIFICATION_SETTINGS: OrgNotificationSettings = {
  licenseExpiring: true,
  licenseExpiringDays: 30,
  loginBruteForce: true,
  loginBruteForceThreshold: 5
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
  weeklyExportEnabled: true,
  lastWeeklyExportAt: null,
  logCategories: { ...DEFAULT_LOG_CATEGORIES },
  notifications: { ...DEFAULT_NOTIFICATION_SETTINGS },
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
    mode: "observe"
  }
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
  if (typeof partial.weeklyExportEnabled === "boolean") {
    base.weeklyExportEnabled = partial.weeklyExportEnabled
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

export const ALL_ADMIN_PERMISSIONS: AdminPermission[] = [
  "console_access",
  "unenroll_agents",
  "manage_admins",
  "manage_policies",
  "manage_users"
]

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
}

export interface AdminSession {
  token: string
  orgId: string
  adminId: string
  expiresAt: number
  createdAt: number
  /** Dernière activité API (heartbeat) — idle serveur */
  lastActivityAt: number
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
}

export interface PasswordResetChallenge {
  orgId: string
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
  /** Proxy P1/P2 : détection observée sans action utilisateur */
  | "observe"

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
  | "recovery_info_view"
  | "recovery_codes_generated"
  | "recovery_code_consumed"
  | "recovery_pool_revoked"
  | "events_export"
  | "login_failed"
  | "login_brute_force"
  | "account_locked"
  | "account_unlocked"

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
}

/**
 * Règle d'affectation automatique d'agents (inspiré Kaspersky « moving rules »).
 * Ex. : device_label starts_with "FIN" → groupe Finance (+ policy du groupe).
 * Plusieurs conditions = AND (toutes doivent matcher). Priorité plus petite = d'abord.
 */
export type MovingMatchField = "device_label" | "host_name"
export type MovingMatchOp = "starts_with" | "contains" | "equals" | "regex"

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
  /** Conditions AND — au moins une. Champs legacy ci-dessous = 1ère condition. */
  conditions: MovingCondition[]
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
  /** true = n'applique que si l'agent n'a pas encore de profil/groupe (défaut) */
  onlyIfUnassigned: boolean
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
