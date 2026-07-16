/**
 * LDAP cron — sync planifiée multi-org (V2 P2).
 * Intervalle : OPSGATE_LDAP_CRON_MS (défaut 0 = off) ou OPSGATE_LDAP_CRON_MINUTES.
 */
import { syncLdapToStore } from "./ldap"
import type { OpsGateStore } from "./store-types"
import { mergeMonitoringSettings } from "./types"

let timer: ReturnType<typeof setInterval> | null = null
let running = false

export function ldapCronIntervalMs(
  env: NodeJS.ProcessEnv = process.env
): number {
  const ms = Number(env.OPSGATE_LDAP_CRON_MS || 0)
  if (ms > 0) return ms
  const min = Number(env.OPSGATE_LDAP_CRON_MINUTES || 0)
  if (min > 0) return min * 60_000
  return 0
}

export function startLdapCron(store: OpsGateStore): void {
  const interval = ldapCronIntervalMs()
  if (interval < 60_000) {
    console.log(
      "[opsgate-api] LDAP cron off (set OPSGATE_LDAP_CRON_MINUTES=60 to enable)"
    )
    return
  }
  if (timer) clearInterval(timer)
  console.log(
    `[opsgate-api] LDAP cron every ${Math.round(interval / 60000)} min`
  )
  // first run delayed
  timer = setInterval(() => {
    void runLdapCronOnce(store)
  }, interval)
}

export async function runLdapCronOnce(store: OpsGateStore): Promise<{
  orgs: number
  ok: number
  fail: number
}> {
  if (running) return { orgs: 0, ok: 0, fail: 0 }
  running = true
  let orgs = 0
  let ok = 0
  let fail = 0
  try {
    const list = await store.listOrgs()
    for (const org of list) {
      if (org.isPersonal) continue
      const mon = mergeMonitoringSettings(org.monitoring)
      const ldap = mon.ldap
      if (!ldap?.enabled) continue
      orgs++
      try {
        const result = await syncLdapToStore({
          store,
          orgId: org.id,
          cfg: ldap,
          dryRun: false
        })
        await store.updateOrgMonitoring(org.id, {
          ldap: {
            ...ldap,
            lastSyncAt: new Date().toISOString(),
            lastSyncMessage: `cron: ${result.message || ""}`,
            lastSyncStats: {
              groups_seen: result.groups_seen,
              groups_upserted: result.groups_upserted,
              users_seen: result.users_seen,
              users_upserted: result.users_upserted
            }
          }
        })
        if (result.ok) ok++
        else fail++
        console.log(
          `[ldap-cron] org=${org.orgCode || org.id} ok=${result.ok} ${result.message}`
        )
      } catch (e) {
        fail++
        console.warn(
          `[ldap-cron] org=${org.orgCode || org.id} error`,
          e instanceof Error ? e.message : e
        )
      }
    }
  } finally {
    running = false
  }
  return { orgs, ok, fail }
}

export function stopLdapCron(): void {
  if (timer) clearInterval(timer)
  timer = null
}
