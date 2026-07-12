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
    console.log(
      `[opsgate-api] Tip: set DATABASE_URL=postgres://... for durable store`
    )
  }

  serve({ fetch: app.fetch, port, hostname: "127.0.0.1" })
}

main().catch((err) => {
  console.error("[opsgate-api] fatal", err)
  process.exit(1)
})
