import type { DetectionRule } from "@opsgate/engine"

export type OrgMode = "local_only" | "org_managed" | "org_managed_strict"
export type EventPayloadPolicy = "metadata_only" | "metadata_plus_redacted_match"
export type DefaultAction = "warn" | "mask_recommend" | "mask_force" | "block"

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
 * - Principal : créé au setup, tous les droits, OTP reset sur primaryEmail.
 * - Secondaires : email + rôles spécifiques.
 */
export interface OrgAdmin {
  id: string
  orgId: string
  /** Label affiché / audit : Administrator, admin2, SOC… */
  label: string
  email: string
  passwordHash: string
  /** Super-admin setup — un seul par org */
  isPrincipal: boolean
  /** Rôles (principal ignore et a tout) */
  permissions: AdminPermission[]
  active: boolean
  createdAt: string
  updatedAt: string
  /** Forcer changement mdp après setup (mdp défaut 0000) */
  mustChangePassword?: boolean
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
  /** Groupes soumis à cette policy */
  assignedGroupIds: string[]
  /** Users soumis directement (hors groupe) */
  assignedUserIds: string[]
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
  /**
   * Epoch de force-sync (incrémenté depuis la console).
   */
  configEpoch: number
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

export type EventSource = "prompt" | "file" | "system" | "text"
export type EventDecision =
  | "mask_send"
  | "send_anyway"
  | "cancel"
  | "unenroll"
  | "enroll"

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

/** Journal d’audit console admin */
export type AdminAuditAction =
  | "login"
  | "logout"
  | "logout_idle"
  | "policy_update"
  | "admin_create"
  | "admin_update"
  | "admin_delete"
  | "agent_revoke"
  | "pack_publish"
  | "rule_disable"
  | "pack_activate"
  | "force_sync"
  | "profile_upsert"
  | "group_upsert"
  | "user_upsert"
  | "agent_assign"
  | "moving_rule_upsert"
  | "moving_rule_delete"
  | "moving_rule_apply"

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
