import { serve } from "@hono/node-server"

import { createApp } from "./app"
import { assertProductionSecrets } from "./crypto"
import { initStore } from "./store"

const port = Number(process.env.PORT || 8787)

async function main() {
  assertProductionSecrets()
  const store = await initStore()
  const app = createApp()

  console.log(
    `[opsgate-api] V1 listening on http://127.0.0.1:${port} (store=${store.kind})`
  )
  console.log(`[opsgate-api] Health:  GET  /health`)
  console.log(`[opsgate-api] Metrics: GET  /metrics  (Prometheus)`)
  console.log(
    `[opsgate-api] Enroll:  POST /v1/enroll  { "org_code": "DEMO-OPSGATE" }`
  )
  console.log(
    `[opsgate-api] Config:  GET  /v1/agents/me/config  (Bearer token)`
  )
  console.log(`[opsgate-api] Dev admin header: X-OpsGate-Dev-Admin: demo`)
  if (store.kind === "memory") {
    console.warn(
      "[opsgate-api] ⚠ store=memory — AUCUNE persistance : redémarrage API = données perdues (admins, agents, events)."
    )
    console.warn(
      "[opsgate-api] Pour pilote/prod : docker compose up -d puis DATABASE_URL=postgres://opsgate:opsgate@127.0.0.1:5432/opsgate"
    )
  } else {
    console.log(
      "[opsgate-api] store=postgres — données durables (volume Docker opsgate_pg_data)"
    )
  }
  const redisUrl =
    process.env.OPSGATE_REDIS_URL?.trim() || process.env.REDIS_URL?.trim()
  if (redisUrl) {
    console.log(
      "[opsgate-api] Redis configuré — rate-limit/quotas multi-instance (fallback mémoire si down)"
    )
  } else {
    console.log(
      "[opsgate-api] Rate-limit/quotas = mémoire process (set OPSGATE_REDIS_URL pour multi-instance)"
    )
  }
  if (store.kind === "postgres") {
    const rls = (process.env.OPSGATE_PG_RLS || "on").toLowerCase()
    console.log(
      `[opsgate-api] Postgres RLS mode=${rls} (off|on|strict) — isolation org_id`
    )
  }
  try {
    const { getMailStatus } = await import("./mail")
    const m = getMailStatus()
    if (m.configured) {
      console.log(
        `[opsgate-api] SMTP mail=${m.host}:${m.port} from=${m.from} auth=${m.auth}`
      )
    } else {
      console.log(
        "[opsgate-api] SMTP non configuré (OPSGATE_SMTP_HOST) — OTP reset en LOG / lab dev_otp"
      )
    }
  } catch {
    /* ignore */
  }

  // LDAP cron multi-org (optionnel)
  try {
    const { startLdapCron } = await import("./ldap-cron")
    startLdapCron(store)
  } catch (e) {
    console.warn(
      "[opsgate-api] LDAP cron init skipped:",
      e instanceof Error ? e.message : e
    )
  }

  // Alertes e-mail : licence expire, recovery bas (lockout = immédiat au login)
  try {
    const { startSecurityAlertsCron } = await import("./security-alerts-cron")
    startSecurityAlertsCron(store)
  } catch (e) {
    console.warn(
      "[opsgate-api] Security alerts cron init skipped:",
      e instanceof Error ? e.message : e
    )
  }

  // Exports planifiés multi-formats (hebdo ISO — config client)
  try {
    const { startExportsCron } = await import("./exports-cron")
    startExportsCron(store)
  } catch (e) {
    console.warn(
      "[opsgate-api] Exports cron init skipped:",
      e instanceof Error ? e.message : e
    )
  }

  serve({ fetch: app.fetch, port, hostname: "127.0.0.1" })
}

main().catch((err) => {
  console.error("[opsgate-api] fatal", err)
  process.exit(1)
})
