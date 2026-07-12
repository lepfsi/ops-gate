/**
 * Parcours pilote automatisé (API) — v1.1
 * Usage: pnpm api:dev  puis  pnpm e2e
 */
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, "..")
const BASE = process.env.OPSGATE_API || "http://127.0.0.1:8787"

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, {
      cwd: root,
      stdio: "inherit",
      shell: true,
      env: process.env
    })
    p.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} exit ${code}`))
    )
  })
}

async function waitHealth(timeoutMs = 15000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`${BASE}/health`)
      if (r.ok) return r.json()
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 400))
  }
  throw new Error("API health timeout")
}

async function main() {
  console.log("=== OpsGate v1.1 e2e pilot ===\n")

  let startedApi = false
  let apiProc = null

  try {
    await waitHealth(2000)
    console.log("API already up\n")
  } catch {
    console.log("Starting API…")
    apiProc = spawn("pnpm", ["api:start"], {
      cwd: root,
      shell: true,
      stdio: "inherit",
      env: process.env
    })
    startedApi = true
    await waitHealth(20000)
  }

  const health = await fetch(`${BASE}/health`).then((r) => r.json())
  console.log(`Health OK store=${health.store} version=${health.version}\n`)

  await run("node", ["scripts/test-detection.mjs"])
  await run("node", ["scripts/smoke-api.mjs"])
  await run("node", ["scripts/test-event-schema.mjs"])

  console.log("\n=== E2E pilot passed (API layer) ===")
  console.log("Manual: extension enroll + console UI still recommended.\n")

  if (startedApi && apiProc) {
    apiProc.kill()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
