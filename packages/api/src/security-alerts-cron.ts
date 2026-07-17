/**
 * Cron d’alertes org (multi-canaux) :
 *  - licence bientôt expirée / expirée
 *  - stock recovery codes bas
 *
 * Lockout compte = envoi immédiat au moment du login (app.ts), pas ici.
 *
 * Intervalle : OPSGATE_ALERTS_CRON_MINUTES (défaut 60) ; 0 = off.
 */
import type { OpsGateStore } from "./store-types"
import { mergeMonitoringSettings } from "./types"

let timer: ReturnType<typeof setInterval> | null = null
let running = false

/** Dédoublonnage en mémoire (process) : clé → timestamp dernier envoi */
const lastSent = new Map<string, number>()

function alertsCronIntervalMs(env: NodeJS.ProcessEnv = process.env): number {
  const min = Number(env.OPSGATE_ALERTS_CRON_MINUTES ?? 60)
  if (!Number.isFinite(min) || min <= 0) return 0
  return Math.max(5, min) * 60_000
}

/** True si on n’a pas déjà notifié récemment (cooldown heures) */
function shouldSend(key: string, cooldownHours: number): boolean {
  const prev = lastSent.get(key) || 0
  const cool = cooldownHours * 3600_000
  if (Date.now() - prev < cool) return false
  lastSent.set(key, Date.now())
  return true
}

/**
 * Destinataires / canaux = config client (alertEmails + channels externes).
 * Pas d’auto-ajout des principaux.
 */
async function notifyContext(
  store: OpsGateStore,
  orgId: string
): Promise<{
  mon: ReturnType<typeof mergeMonitoringSettings>
  orgName: string
  orgCode: string
  hasTarget: boolean
}> {
  const org = await store.getOrg(orgId)
  const mon = mergeMonitoringSettings(org?.monitoring)
  const { hasAnyNotificationTarget } = await import("./notify-channels")
  return {
    mon,
    orgName: org?.name || orgId,
    orgCode: org?.orgCode || "",
    hasTarget: hasAnyNotificationTarget(mon.notifications)
  }
}

export function startSecurityAlertsCron(store: OpsGateStore): void {
  const interval = alertsCronIntervalMs()
  if (interval < 60_000) {
    console.log(
      "[opsgate-api] Security alerts cron off (set OPSGATE_ALERTS_CRON_MINUTES=60)"
    )
    return
  }
  if (timer) clearInterval(timer)
  console.log(
    `[opsgate-api] Security alerts cron every ${Math.round(interval / 60000)} min`
  )
  // Premier passage après 45 s (laisser le store/SMTP se stabiliser)
  setTimeout(() => void runSecurityAlertsOnce(store), 45_000)
  timer = setInterval(() => {
    void runSecurityAlertsOnce(store)
  }, interval)
}

export async function runSecurityAlertsOnce(store: OpsGateStore): Promise<{
  orgs: number
  license: number
  recovery: number
}> {
  if (running) return { orgs: 0, license: 0, recovery: 0 }
  running = true
  let orgs = 0
  let license = 0
  let recovery = 0
  try {
    const list = await store.listOrgs()
    const { dispatchOrgAlert } = await import("./notify-channels")
    for (const org of list) {
      if (org.isPersonal) continue
      orgs++
      const ctx = await notifyContext(store, org.id)
      const mon = ctx.mon
      const notif = mon.notifications
      if (!ctx.hasTarget) continue

      // ── Licence (si le client a coché l’événement) ───────
      if (notif?.licenseExpiring === true) {
        const expRaw = mon.licenseDisplay?.expiresAt
        if (expRaw) {
          const expMs = Date.parse(expRaw)
          if (Number.isFinite(expMs)) {
            const daysLeft = Math.ceil(
              (expMs - Date.now()) / (24 * 3600_000)
            )
            const window = Math.max(
              1,
              Math.floor(notif?.licenseExpiringDays ?? 30)
            )
            if (daysLeft <= window) {
              const dayKey = String(expRaw).slice(0, 10)
              const bucket =
                daysLeft < 0
                  ? "expired"
                  : daysLeft <= 7
                    ? "7d"
                    : daysLeft <= 14
                      ? "14d"
                      : "30d"
              const key = `license:${org.id}:${dayKey}:${bucket}`
              if (shouldSend(key, 20)) {
                const results = await dispatchOrgAlert({
                  notif,
                  smtp: mon.smtp || null,
                  payload: {
                    title:
                      daysLeft < 0
                        ? "Licence OpsGate expirée"
                        : "Licence OpsGate bientôt expirée",
                    text:
                      daysLeft < 0
                        ? `La licence de ${ctx.orgName} (${ctx.orgCode}) est expirée depuis ${Math.abs(daysLeft)} j (échéance ${expRaw}).`
                        : `La licence de ${ctx.orgName} (${ctx.orgCode}) expire dans ${daysLeft} j (échéance ${expRaw}).`,
                    orgName: ctx.orgName,
                    orgCode: ctx.orgCode
                  }
                })
                if (results.some((r) => r.ok)) license++
                console.log(
                  `[alerts] license ${bucket} org=${ctx.orgCode || org.id} daysLeft=${daysLeft} channels=${results.length}`
                )
              }
            }
          }
        }
      }

      // ── Recovery stock (si le client a coché l’événement) ─
      if (notif?.recoveryLowStock === true) {
        const thr = Math.max(
          1,
          Math.floor(notif?.recoveryLowStockThreshold ?? 5)
        )
        try {
          const codes = await store.listRecoveryCodes(org.id)
          const active = codes.filter((c) => c.active && !c.consumedAt).length
          if (active < thr) {
            const key = `recovery:${org.id}:${active}`
            if (shouldSend(key, 24)) {
              const results = await dispatchOrgAlert({
                notif,
                smtp: mon.smtp || null,
                payload: {
                  title: "Stock codes recovery bas",
                  text: `${ctx.orgName} (${ctx.orgCode}) : ${active} code(s) recovery actifs (seuil ${thr}).`,
                  orgName: ctx.orgName,
                  orgCode: ctx.orgCode
                }
              })
              if (results.some((r) => r.ok)) recovery++
              console.log(
                `[alerts] recovery low org=${ctx.orgCode || org.id} active=${active} thr=${thr}`
              )
            }
          }
        } catch {
          /* org sans recovery */
        }
      }
    }
  } finally {
    running = false
  }
  return { orgs, license, recovery }
}
