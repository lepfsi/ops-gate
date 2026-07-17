/**
 * Soft-delete organisation + purge différée (RGPD / droit à l’effacement).
 *
 * Flux :
 *  1. Export DSAR (config + métadonnées agents / admins)
 *  2. Soft-delete (principal) → sessions coupées, agents révoqués, enroll bloqué
 *  3. Délai de grâce (défaut 30 j) → restore possible
 *  4. Hard purge CASCADE (cron) après purge_at
 *
 * Env : OPSGATE_GDPR_PURGE_DAYS=30
 */

import type { OpsGateStore } from "./store-types"
import type { Organization } from "./types"
import { buildOrgBackup } from "./org-backup"

export const GDPR_CONFIRM_PHRASE = "DELETE MY ORG"
export const GDPR_RESTORE_PHRASE = "RESTORE MY ORG"

export function gdprPurgeDays(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.OPSGATE_GDPR_PURGE_DAYS || 30)
  if (!Number.isFinite(n)) return 30
  return Math.min(365, Math.max(1, Math.floor(n)))
}

export function isOrgSoftDeleted(org: Organization | null | undefined): boolean {
  return !!(org?.deletedAt && String(org.deletedAt).trim())
}

/** Orgs protégées (seed / lab) — soft-delete interdit sans force */
export function isOrgDeleteProtected(org: Organization): boolean {
  const code = (org.orgCode || "").toUpperCase()
  if (code === "DEMO-OPSGATE") return true
  // PERSONAL seed : autorisé (compte personnel) sauf slug seed-only
  return false
}

export type GdprStatus = {
  deleted: boolean
  deleted_at: string | null
  purge_at: string | null
  delete_reason: string | null
  delete_requested_by: string | null
  days_until_purge: number | null
  can_restore: boolean
  purge_days_default: number
  protected: boolean
}

export function gdprStatusOf(org: Organization): GdprStatus {
  const deleted = isOrgSoftDeleted(org)
  const purgeAt = org.deletePurgeAt || null
  let days: number | null = null
  if (purgeAt) {
    days = Math.ceil((Date.parse(purgeAt) - Date.now()) / 86400000)
  }
  return {
    deleted,
    deleted_at: org.deletedAt || null,
    purge_at: purgeAt,
    delete_reason: org.deleteReason || null,
    delete_requested_by: org.deleteRequestedBy || null,
    days_until_purge: days,
    can_restore: deleted && (!purgeAt || Date.parse(purgeAt) > Date.now()),
    purge_days_default: gdprPurgeDays(),
    protected: isOrgDeleteProtected(org)
  }
}

/** Export portabilité (DSAR) — config + inventaire, pas de secrets */
export async function buildGdprExport(
  store: OpsGateStore,
  orgId: string
): Promise<Record<string, unknown> | null> {
  const org = await store.getOrg(orgId)
  if (!org) return null
  const backup = await buildOrgBackup(store, orgId)
  const agents = await store.listAgents(orgId)
  const admins = await store.listAdmins(orgId)
  let events_sample_count = 0
  try {
    const events = await store.listEvents(orgId, 5000)
    events_sample_count = events.length
  } catch {
    events_sample_count = 0
  }

  return {
    kind: "opsgate_gdpr_export",
    version: 1,
    exported_at: new Date().toISOString(),
    legal_note:
      "Export de portabilité / inventaire. Secrets SMTP/LDAP/Telegram non inclus. " +
      "Les journaux de détection (métadonnées) restent soumis à la rétention org.",
    organization: {
      id: org.id,
      name: org.name,
      org_code: org.orgCode,
      primary_email: org.primaryEmail,
      is_personal: !!org.isPersonal,
      created_at: org.createdAt,
      license_seats: org.licenseSeats ?? 0,
      deleted_at: org.deletedAt || null,
      delete_purge_at: org.deletePurgeAt || null
    },
    admins: admins.map((a) => ({
      id: a.id,
      email: a.email,
      label: a.label,
      is_principal: a.isPrincipal,
      active: a.active,
      created_at: a.createdAt
    })),
    agents: agents.map((a) => ({
      id: a.id,
      device_label: a.deviceLabel,
      host_name: a.hostName,
      enrolled_at: a.enrolledAt,
      last_seen_at: a.lastSeenAt,
      license_assigned: a.licenseAssigned
    })),
    config_backup: backup,
    events_listed_max: 5000,
    events_count_in_export_window: events_sample_count
  }
}

export async function softDeleteOrganization(
  store: OpsGateStore,
  orgId: string,
  opts: {
    requestedByEmail: string
    reason?: string
    confirm: string
    forceProtected?: boolean
  }
): Promise<
  | { ok: true; status: GdprStatus; agents_revoked: number; sessions_revoked: number }
  | { ok: false; error: string }
> {
  const org = await store.getOrg(orgId)
  if (!org) return { ok: false, error: "no_org" }
  if (isOrgSoftDeleted(org)) return { ok: false, error: "already_deleted" }
  if (
    opts.confirm.trim().toUpperCase() !== GDPR_CONFIRM_PHRASE.toUpperCase()
  ) {
    return {
      ok: false,
      error: "confirm_required",
    }
  }
  if (isOrgDeleteProtected(org) && !opts.forceProtected) {
    return { ok: false, error: "org_protected" }
  }

  const days = gdprPurgeDays()
  const deletedAt = new Date().toISOString()
  const purgeAt = new Date(Date.now() + days * 86400000).toISOString()

  const updated = await store.softDeleteOrg(orgId, {
    deletedAt,
    deletePurgeAt: purgeAt,
    deleteReason: (opts.reason || "").trim().slice(0, 500) || null,
    deleteRequestedBy: opts.requestedByEmail
  })
  if (!updated) return { ok: false, error: "soft_delete_failed" }

  // Couper sessions admin
  let sessions_revoked = 0
  try {
    sessions_revoked = await store.revokeAllOrgSessions(orgId)
  } catch {
    sessions_revoked = 0
  }

  // Révoquer agents (stop processing)
  let agents_revoked = 0
  try {
    const agents = await store.listAgents(orgId)
    for (const a of agents) {
      const ok = await store.revokeAgentById(orgId, a.id, {
        type: "admin",
        admin_id: "gdpr",
        admin_label: "GDPR soft-delete"
      })
      if (ok) agents_revoked++
    }
  } catch {
    /* ignore partial */
  }

  await store.appendAdminAudit({
    orgId,
    adminId: "gdpr",
    adminEmail: opts.requestedByEmail,
    adminLabel: "GDPR",
    action: "org_gdpr_soft_delete",
    detail: `Soft-delete org · purge_at=${purgeAt} · agents=${agents_revoked}`
  })

  return {
    ok: true,
    status: gdprStatusOf(updated),
    agents_revoked,
    sessions_revoked
  }
}

export async function restoreOrganization(
  store: OpsGateStore,
  orgId: string,
  opts: { requestedByEmail: string; confirm: string }
): Promise<
  | { ok: true; status: GdprStatus }
  | { ok: false; error: string }
> {
  const org = await store.getOrg(orgId)
  if (!org) return { ok: false, error: "no_org" }
  if (!isOrgSoftDeleted(org)) return { ok: false, error: "not_deleted" }
  if (
    opts.confirm.trim().toUpperCase() !== GDPR_RESTORE_PHRASE.toUpperCase()
  ) {
    return { ok: false, error: "confirm_required" }
  }
  if (org.deletePurgeAt && Date.parse(org.deletePurgeAt) <= Date.now()) {
    return { ok: false, error: "purge_window_elapsed" }
  }

  const updated = await store.restoreOrg(orgId)
  if (!updated) return { ok: false, error: "restore_failed" }

  await store.appendAdminAudit({
    orgId,
    adminId: "gdpr",
    adminEmail: opts.requestedByEmail,
    adminLabel: "GDPR",
    action: "org_gdpr_restore",
    detail: "Organisation restaurée avant purge hard"
  })

  return { ok: true, status: gdprStatusOf(updated) }
}

export async function hardPurgeOrganization(
  store: OpsGateStore,
  orgId: string
): Promise<{ ok: true; org_id: string } | { ok: false; error: string }> {
  const org = await store.getOrg(orgId)
  if (!org) return { ok: false, error: "no_org" }
  if (!isOrgSoftDeleted(org)) return { ok: false, error: "not_deleted" }
  if (org.deletePurgeAt && Date.parse(org.deletePurgeAt) > Date.now()) {
    return { ok: false, error: "purge_not_due" }
  }
  // Audit avant cascade (sera supprimé avec l’org — log process aussi)
  console.log(
    `[gdpr] hard purge org=${org.orgCode || orgId} deleted_at=${org.deletedAt}`
  )
  const ok = await store.hardDeleteOrg(orgId)
  if (!ok) return { ok: false, error: "hard_delete_failed" }
  return { ok: true, org_id: orgId }
}
