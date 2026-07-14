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

  serve({ fetch: app.fetch, port, hostname: "127.0.0.1" })
}

main().catch((err) => {
  console.error("[opsgate-api] fatal", err)
  process.exit(1)
})
