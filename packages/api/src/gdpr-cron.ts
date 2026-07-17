/**
 * Cron purge hard des orgs soft-deleted dont delete_purge_at est dépassé.
 * Intervalle : OPSGATE_GDPR_CRON_MINUTES (défaut 60).
 */
import type { OpsGateStore } from "./store-types"
import { hardPurgeOrganization } from "./gdpr-org"

let timer: ReturnType<typeof setInterval> | null = null

export function startGdprCron(store: OpsGateStore) {
  if (timer) return
  const mins = Math.max(
    5,
    Number(process.env.OPSGATE_GDPR_CRON_MINUTES || 60) || 60
  )
  const tick = async () => {
    try {
      const due = await store.listOrgsDueForHardPurge()
      for (const org of due) {
        const r = await hardPurgeOrganization(store, org.id)
        if (r.ok) {
          console.log(`[gdpr-cron] hard purged org_id=${org.id} code=${org.orgCode}`)
        } else {
          console.warn(
            `[gdpr-cron] purge failed org=${org.orgCode}: ${r.error}`
          )
        }
      }
    } catch (e) {
      console.warn(
        "[gdpr-cron] tick error:",
        e instanceof Error ? e.message : e
      )
    }
  }
  void tick()
  timer = setInterval(() => void tick(), mins * 60_000)
  console.log(`[opsgate-api] GDPR hard-purge cron every ${mins} min`)
}
