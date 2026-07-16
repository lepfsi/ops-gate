/**
 * LDAP / Active Directory sync (V2 P2).
 * Importe groupes + users dans OpsGate (ldapExternalId / externalId).
 * Dépendance : ldapts (optionnelle à l'exécution si non installée).
 */
import type { OpsGateStore } from "./store-types"
import type { OrgLdapSettings } from "./types"

export type LdapSyncResult = {
  ok: boolean
  dry_run: boolean
  groups_seen: number
  groups_upserted: number
  users_seen: number
  users_upserted: number
  errors: string[]
  message?: string
  sample_groups?: string[]
  sample_users?: string[]
}

export type LdapTestResult = {
  ok: boolean
  message: string
  server?: string
  entry_count?: number
}

function resolveBindPassword(cfg: OrgLdapSettings): string {
  const env =
    process.env.OPSGATE_LDAP_BIND_PASSWORD?.trim() ||
    process.env.LDAP_BIND_PASSWORD?.trim() ||
    ""
  if (env) return env
  return (cfg.bindPassword || "").trim()
}

export function ldapConfigReady(cfg: OrgLdapSettings | null | undefined): {
  ready: boolean
  reason?: string
} {
  if (!cfg?.enabled) return { ready: false, reason: "ldap_disabled" }
  if (!cfg.url?.trim()) return { ready: false, reason: "url_required" }
  if (!cfg.bindDn?.trim()) return { ready: false, reason: "bind_dn_required" }
  if (!cfg.baseDn?.trim()) return { ready: false, reason: "base_dn_required" }
  if (!resolveBindPassword(cfg)) {
    return {
      ready: false,
      reason: "bind_password_required (config or OPSGATE_LDAP_BIND_PASSWORD)"
    }
  }
  return { ready: true }
}

/** Masque le secret pour l’API / console */
export function publicLdapView(cfg: OrgLdapSettings | null | undefined) {
  if (!cfg) return null
  const { bindPassword: _p, ...rest } = cfg
  return {
    ...rest,
    bind_password_set: !!(
      cfg.bindPassword ||
      process.env.OPSGATE_LDAP_BIND_PASSWORD ||
      process.env.LDAP_BIND_PASSWORD
    ),
    ready: ldapConfigReady(cfg).ready
  }
}

async function loadClient() {
  try {
    const mod = await import("ldapts")
    return mod
  } catch {
    throw new Error(
      "ldapts_not_installed — pnpm add ldapts dans packages/api"
    )
  }
}

function attrStr(
  entry: Record<string, unknown>,
  names: string[]
): string {
  for (const n of names) {
    const v = entry[n] ?? entry[n.toLowerCase()]
    if (v == null) continue
    if (Array.isArray(v)) {
      const first = v[0]
      if (first == null) continue
      if (Buffer.isBuffer(first)) return first.toString("utf8")
      return String(first)
    }
    if (Buffer.isBuffer(v)) return v.toString("utf8")
    return String(v)
  }
  return ""
}

function attrList(
  entry: Record<string, unknown>,
  names: string[]
): string[] {
  for (const n of names) {
    const v = entry[n] ?? entry[n.toLowerCase()]
    if (v == null) continue
    const arr = Array.isArray(v) ? v : [v]
    return arr.map((x) =>
      Buffer.isBuffer(x) ? x.toString("utf8") : String(x)
    )
  }
  return []
}

/** objectGUID binary → hex stable id */
function guidHex(entry: Record<string, unknown>): string {
  const raw = entry.objectGUID ?? entry.objectguid
  if (!raw) return ""
  const buf = Buffer.isBuffer(raw)
    ? raw
    : Array.isArray(raw) && Buffer.isBuffer(raw[0])
      ? raw[0]
      : null
  if (buf && buf.length >= 16) return buf.toString("hex")
  return ""
}

export async function testLdapConnection(
  cfg: OrgLdapSettings
): Promise<LdapTestResult> {
  const ready = ldapConfigReady(cfg)
  if (!ready.ready) {
    return { ok: false, message: ready.reason || "not_ready" }
  }
  const { Client } = await loadClient()
  const client = new Client({
    url: cfg.url.trim(),
    timeout: cfg.timeoutMs || 10_000,
    connectTimeout: cfg.timeoutMs || 10_000,
    tlsOptions: cfg.tlsInsecure
      ? { rejectUnauthorized: false }
      : undefined
  })
  try {
    await client.bind(cfg.bindDn.trim(), resolveBindPassword(cfg))
    const filter = cfg.groupFilter || "(objectClass=group)"
    const { searchEntries } = await client.search(cfg.baseDn.trim(), {
      scope: "sub",
      filter,
      sizeLimit: 5,
      attributes: ["cn", "distinguishedName"]
    })
    await client.unbind().catch(() => undefined)
    return {
      ok: true,
      message: "Bind + search OK",
      server: cfg.url,
      entry_count: searchEntries?.length ?? 0
    }
  } catch (e) {
    try {
      await client.unbind()
    } catch {
      /* ignore */
    }
    return {
      ok: false,
      message: e instanceof Error ? e.message : String(e)
    }
  }
}

/**
 * Sync groupes puis users depuis AD/LDAP vers le store OpsGate.
 */
export async function syncLdapToStore(opts: {
  store: OpsGateStore
  orgId: string
  cfg: OrgLdapSettings
  dryRun?: boolean
}): Promise<LdapSyncResult> {
  const { store, orgId, cfg } = opts
  const dryRun = !!opts.dryRun || !!cfg.dryRun
  const errors: string[] = []
  const result: LdapSyncResult = {
    ok: true,
    dry_run: dryRun,
    groups_seen: 0,
    groups_upserted: 0,
    users_seen: 0,
    users_upserted: 0,
    errors,
    sample_groups: [],
    sample_users: []
  }

  const ready = ldapConfigReady(cfg)
  if (!ready.ready) {
    result.ok = false
    result.message = ready.reason
    errors.push(ready.reason || "not_ready")
    return result
  }

  const { Client } = await loadClient()
  const client = new Client({
    url: cfg.url.trim(),
    timeout: cfg.timeoutMs || 30_000,
    connectTimeout: cfg.timeoutMs || 15_000,
    tlsOptions: cfg.tlsInsecure
      ? { rejectUnauthorized: false }
      : undefined
  })

  /** DN normalisé (lower) → group id OpsGate */
  const dnToGroupId = new Map<string, string>()
  /** ldap external id → group id */
  const extToGroupId = new Map<string, string>()

  try {
    await client.bind(cfg.bindDn.trim(), resolveBindPassword(cfg))

    // ── Groups ──
    if (cfg.syncGroups !== false) {
      const gFilter = cfg.groupFilter || "(objectClass=group)"
      const { searchEntries: groups } = await client.search(cfg.baseDn.trim(), {
        scope: "sub",
        filter: gFilter,
        sizeLimit: cfg.sizeLimit || 2000,
        attributes: [
          "cn",
          "name",
          "distinguishedName",
          "objectGUID",
          "description",
          "member"
        ]
      })
      result.groups_seen = groups.length
      const existing = await store.listGroups(orgId)

      for (const raw of groups) {
        const entry = raw as unknown as Record<string, unknown>
        const dn =
          attrStr(entry, ["distinguishedName", "dn"]) ||
          String((raw as { dn?: string }).dn || "")
        const cn = attrStr(entry, ["cn", "name"]) || dn
        const guid = guidHex(entry)
        const extId = guid || dn
        if (!extId) {
          errors.push(`group_skip_no_id:${cn}`)
          continue
        }
        if (result.sample_groups!.length < 8) {
          result.sample_groups!.push(cn)
        }

        const prev = existing.find(
          (g) =>
            g.ldapExternalId === extId ||
            g.ldapExternalId === dn ||
            g.name.toLowerCase() === cn.toLowerCase()
        )

        if (dryRun) {
          result.groups_upserted++
          const fakeId = prev?.id || `dry_${extId.slice(0, 12)}`
          if (dn) dnToGroupId.set(dn.toLowerCase(), fakeId)
          extToGroupId.set(extId, fakeId)
          continue
        }

        const group = await store.upsertGroup(orgId, {
          id: prev?.id,
          name: cn.slice(0, 120),
          description:
            attrStr(entry, ["description"]) ||
            prev?.description ||
            `LDAP: ${dn.slice(0, 200)}`,
          policyProfileId: prev?.policyProfileId ?? null,
          ldapExternalId: extId
        })
        if (group) {
          result.groups_upserted++
          if (dn) dnToGroupId.set(dn.toLowerCase(), group.id)
          extToGroupId.set(extId, group.id)
        }
      }
    } else {
      // Charger mapping existant
      const existing = await store.listGroups(orgId)
      for (const g of existing) {
        if (g.ldapExternalId) extToGroupId.set(g.ldapExternalId, g.id)
      }
    }

    // ── Users ──
    if (cfg.syncUsers !== false) {
      const uFilter =
        cfg.userFilter ||
        "(&(objectCategory=person)(objectClass=user)(!(userAccountControl:1.2.840.113556.1.4.803:=2)))"
      const { searchEntries: users } = await client.search(cfg.baseDn.trim(), {
        scope: "sub",
        filter: uFilter,
        sizeLimit: cfg.sizeLimit || 5000,
        attributes: [
          "cn",
          "displayName",
          "mail",
          "userPrincipalName",
          "sAMAccountName",
          "objectGUID",
          "distinguishedName",
          "memberOf"
        ]
      })
      result.users_seen = users.length
      const existingUsers = await store.listUsers(orgId)

      for (const raw of users) {
        const entry = raw as unknown as Record<string, unknown>
        const dn =
          attrStr(entry, ["distinguishedName", "dn"]) ||
          String((raw as { dn?: string }).dn || "")
        const guid = guidHex(entry)
        const email =
          attrStr(entry, ["mail", "userPrincipalName"]) ||
          (attrStr(entry, ["sAMAccountName"])
            ? `${attrStr(entry, ["sAMAccountName"])}@ad.local`
            : "")
        const displayName =
          attrStr(entry, ["displayName", "cn", "sAMAccountName"]) ||
          email ||
          dn
        const extId =
          guid ||
          attrStr(entry, ["userPrincipalName", "sAMAccountName"]) ||
          dn
        if (!extId) {
          errors.push(`user_skip_no_id:${displayName}`)
          continue
        }
        if (result.sample_users!.length < 8) {
          result.sample_users!.push(
            email ? `${displayName} <${email}>` : displayName
          )
        }

        const memberOf = attrList(entry, ["memberOf"])
        const groupIds: string[] = []
        for (const gdn of memberOf) {
          const id = dnToGroupId.get(gdn.toLowerCase())
          if (id && !groupIds.includes(id)) groupIds.push(id)
        }

        const prev = existingUsers.find(
          (u) =>
            u.externalId === extId ||
            (email && u.email?.toLowerCase() === email.toLowerCase())
        )

        if (dryRun) {
          result.users_upserted++
          continue
        }

        const user = await store.upsertUser(orgId, {
          id: prev?.id,
          displayName: displayName.slice(0, 200),
          email: email ? email.slice(0, 200) : undefined,
          externalId: extId,
          groupIds: groupIds.length
            ? groupIds
            : prev?.groupIds?.length
              ? prev.groupIds
              : []
        })
        if (user) result.users_upserted++
      }
    }

    await client.unbind().catch(() => undefined)
    result.message = dryRun
      ? `Dry-run OK — ${result.groups_seen} groupes, ${result.users_seen} users (non écrits)`
      : `Sync OK — groupes ${result.groups_upserted}/${result.groups_seen}, users ${result.users_upserted}/${result.users_seen}`
    result.ok = errors.length < 50
    return result
  } catch (e) {
    try {
      await client.unbind()
    } catch {
      /* ignore */
    }
    result.ok = false
    result.message = e instanceof Error ? e.message : String(e)
    errors.push(result.message)
    return result
  }
}
