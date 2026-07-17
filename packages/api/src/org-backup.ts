/**
 * Backup / restore configuration d’organisation (sans secrets en clair).
 * Fondamental sécu : export avant upgrade, import sur instance de secours.
 */
import type { OpsGateStore } from "./store-types"
import { mergeMonitoringSettings } from "./types"

export const ORG_BACKUP_VERSION = 1

export type OrgBackupPayload = {
  version: number
  kind: "opsgate_org_backup"
  exported_at: string
  org: {
    id: string
    name: string
    org_code: string
    primary_email?: string
  }
  policy?: unknown
  profiles?: unknown[]
  groups?: unknown[]
  users?: unknown[]
  moving_rules?: unknown[]
  monitoring?: unknown
  note?: string
}

function stripSecrets(mon: ReturnType<typeof mergeMonitoringSettings>) {
  const m = JSON.parse(JSON.stringify(mon)) as Record<string, unknown>
  if (m.smtp && typeof m.smtp === "object") {
    const s = m.smtp as Record<string, unknown>
    delete s.password
    s.password_set = !!(mon.smtp as { password?: string } | undefined)?.password
  }
  if (m.ldap && typeof m.ldap === "object") {
    const l = m.ldap as Record<string, unknown>
    delete l.bindPassword
  }
  if (m.notifications && typeof m.notifications === "object") {
    const n = m.notifications as {
      channels?: Array<Record<string, unknown>>
    }
    if (Array.isArray(n.channels)) {
      n.channels = n.channels.map((ch) => {
        const c = { ...ch }
        if (c.botToken) c.botToken = c.botToken ? "***" : undefined
        if (c.webhookUrl && String(c.webhookUrl).includes("hooks.slack")) {
          c.webhookUrl = String(c.webhookUrl).replace(
            /T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]+/,
            "***"
          )
        }
        return c
      })
    }
  }
  return m
}

export async function buildOrgBackup(
  store: OpsGateStore,
  orgId: string
): Promise<OrgBackupPayload | null> {
  const org = await store.getOrg(orgId)
  if (!org) return null
  const mon = mergeMonitoringSettings(org.monitoring)
  const policy = await store.getPolicy(orgId)
  const profiles = await store.listProfiles(orgId)
  const groups = await store.listGroups(orgId)
  const users = await store.listUsers(orgId)
  let moving: unknown[] = []
  try {
    moving = await store.listMovingRules(orgId)
  } catch {
    moving = []
  }
  return {
    version: ORG_BACKUP_VERSION,
    kind: "opsgate_org_backup",
    exported_at: new Date().toISOString(),
    org: {
      id: org.id,
      name: org.name,
      org_code: org.orgCode,
      primary_email: org.primaryEmail
    },
    policy: policy || null,
    profiles,
    groups,
    users,
    moving_rules: moving,
    monitoring: stripSecrets(mon),
    note: "Secrets SMTP/LDAP/Telegram non exportés en clair — reconfigurer après import."
  }
}

export async function importOrgBackup(
  store: OpsGateStore,
  orgId: string,
  raw: unknown
): Promise<{ ok: true; applied: string[] } | { ok: false; error: string }> {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "invalid_payload" }
  }
  const p = raw as Partial<OrgBackupPayload>
  if (p.kind !== "opsgate_org_backup") {
    return { ok: false, error: "not_opsgate_backup" }
  }
  const org = await store.getOrg(orgId)
  if (!org) return { ok: false, error: "no_org" }

  const applied: string[] = []

  // Monitoring (sans écraser secrets absents)
  if (p.monitoring && typeof p.monitoring === "object") {
    const mon = p.monitoring as Record<string, unknown>
    const smtp = mon.smtp as Record<string, unknown> | undefined
    if (smtp) {
      delete smtp.password
      delete smtp.password_set
    }
    const ldap = mon.ldap as Record<string, unknown> | undefined
    if (ldap) delete ldap.bindPassword
    // Ne pas réimporter botToken "***"
    const notif = mon.notifications as
      | { channels?: Array<Record<string, unknown>> }
      | undefined
    if (notif?.channels) {
      notif.channels = notif.channels.map((ch) => {
        const c = { ...ch }
        if (c.botToken === "***") delete c.botToken
        if (typeof c.webhookUrl === "string" && c.webhookUrl.includes("***")) {
          delete c.webhookUrl
        }
        return c
      })
    }
    await store.updateOrgMonitoring(orgId, mon as never)
    applied.push("monitoring")
  }

  // Policy (champs sûrs uniquement)
  if (p.policy && typeof p.policy === "object") {
    try {
      const pol = p.policy as Record<string, unknown>
      await store.updatePolicy(orgId, {
        defaultAction: pol.defaultAction as never,
        enabledHosts: Array.isArray(pol.enabledHosts)
          ? (pol.enabledHosts as string[])
          : undefined,
        scanUploads:
          typeof pol.scanUploads === "boolean" ? pol.scanUploads : undefined,
        eventReporting:
          typeof pol.eventReporting === "boolean"
            ? pol.eventReporting
            : undefined,
        protectUnenroll:
          typeof pol.protectUnenroll === "boolean"
            ? pol.protectUnenroll
            : undefined,
        userMessages: pol.userMessages as never,
        workSchedule: pol.workSchedule as never
      })
      applied.push("policy")
    } catch {
      /* ignore policy shape mismatch */
    }
  }

  // Profiles
  if (Array.isArray(p.profiles)) {
    let n = 0
    for (const pr of p.profiles) {
      if (!pr || typeof pr !== "object") continue
      const o = pr as Record<string, unknown>
      const name = String(o.name || o.id || "").trim()
      if (!name) continue
      try {
        await store.upsertProfile(orgId, {
          id: typeof o.id === "string" ? o.id : undefined,
          name,
          department:
            typeof o.department === "string" ? o.department : undefined,
          defaultAction: o.defaultAction as never,
          enabledHosts: Array.isArray(o.enabledHosts)
            ? (o.enabledHosts as string[])
            : undefined,
          scanUploads:
            typeof o.scanUploads === "boolean" ? o.scanUploads : undefined,
          eventReporting:
            typeof o.eventReporting === "boolean"
              ? o.eventReporting
              : undefined,
          protectUnenroll:
            typeof o.protectUnenroll === "boolean"
              ? o.protectUnenroll
              : undefined,
          enabled: typeof o.enabled === "boolean" ? o.enabled : undefined,
          priority: typeof o.priority === "number" ? o.priority : undefined,
          assignedGroupIds: Array.isArray(o.assignedGroupIds)
            ? (o.assignedGroupIds as string[])
            : undefined,
          userMessages: o.userMessages as never,
          workSchedule: o.workSchedule as never
        })
        n++
      } catch {
        /* ignore one */
      }
    }
    applied.push(`profiles:${n}`)
  }

  // Groups
  if (Array.isArray(p.groups)) {
    let n = 0
    for (const g of p.groups) {
      if (!g || typeof g !== "object") continue
      const o = g as Record<string, unknown>
      const name = String(o.name || "").trim()
      if (!name) continue
      try {
        await store.upsertGroup(orgId, {
          id: typeof o.id === "string" ? o.id : undefined,
          name,
          description:
            typeof o.description === "string" ? o.description : undefined,
          policyProfileId:
            typeof o.policyProfileId === "string" || o.policyProfileId === null
              ? (o.policyProfileId as string | null)
              : undefined
        })
        n++
      } catch {
        /* ignore */
      }
    }
    applied.push(`groups:${n}`)
  }

  // Moving rules
  if (Array.isArray(p.moving_rules)) {
    let n = 0
    for (const r of p.moving_rules) {
      if (!r || typeof r !== "object") continue
      const o = r as Record<string, unknown>
      const name = String(o.name || "").trim()
      const targetGroupId = String(o.targetGroupId || "").trim()
      if (!name || !targetGroupId) continue
      try {
        await store.upsertMovingRule(orgId, {
          id: typeof o.id === "string" ? o.id : undefined,
          name,
          enabled: typeof o.enabled === "boolean" ? o.enabled : undefined,
          conditions: Array.isArray(o.conditions)
            ? (o.conditions as never)
            : undefined,
          matchField: o.matchField as never,
          matchOp: o.matchOp as never,
          matchValue:
            typeof o.matchValue === "string" ? o.matchValue : undefined,
          targetGroupId,
          priority: typeof o.priority === "number" ? o.priority : undefined,
          onlyIfUnassigned:
            typeof o.onlyIfUnassigned === "boolean"
              ? o.onlyIfUnassigned
              : undefined
        })
        n++
      } catch {
        /* ignore */
      }
    }
    applied.push(`moving_rules:${n}`)
  }

  return { ok: true, applied }
}
