/**
 * Valide la durabilité Postgres V1 : écritures → kill API → redémarrage → relecture.
 *
 * Prérequis :
 *   docker compose up -d
 *   DATABASE_URL=postgres://opsgate:opsgate@127.0.0.1:5432/opsgate
 *
 * Usage :
 *   node scripts/validate-pg-restart.mjs
 */
import { spawn } from "node:child_process"
import { dirname, join } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import { fileURLToPath } from "node:url"

const BASE = process.env.OPSGATE_API || "http://127.0.0.1:8787"
const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgres://opsgate:opsgate@127.0.0.1:5432/opsgate"
const EMAIL = process.env.OPSGATE_SETUP_EMAIL || "admin@demo.local"
const PASSWORD = process.env.OPSGATE_SETUP_PASSWORD || "0000"
const PORT = Number(process.env.PORT || 8787)
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")

function log(msg) {
  console.log(msg)
}

async function req(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      "content-type": "application/json",
      ...(opts.headers || {})
    }
  })
  const text = await res.text()
  let body
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  return { status: res.status, body }
}

async function waitHealth(timeoutMs = 30000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    try {
      const h = await req("/health")
      if (h.status === 200 && h.body?.ok) return h.body
    } catch {
      /* retry */
    }
    await sleep(400)
  }
  throw new Error("API health timeout")
}

function startApi() {
  const child = spawn(
    process.platform === "win32" ? "pnpm.cmd" : "pnpm",
    ["--filter", "@opsgate/api", "start"],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        DATABASE_URL,
        PORT: String(PORT),
        NODE_ENV: "development"
      },
      stdio: ["ignore", "pipe", "pipe"],
      shell: true
    }
  )
  child.stdout?.on("data", (d) => {
    const s = String(d)
    if (s.includes("listening") || s.includes("fatal") || s.includes("error")) {
      process.stdout.write(`[api] ${s}`)
    }
  })
  child.stderr?.on("data", (d) => process.stderr.write(`[api:err] ${d}`))
  return child
}

async function killApi(child) {
  if (!child || child.killed) return
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      shell: true
    })
  } else {
    child.kill("SIGTERM")
  }
  await sleep(800)
}

async function main() {
  log("=== OpsGate V1 — validate Postgres restart ===\n")
  log(`DATABASE_URL=${DATABASE_URL.replace(/:[^:@/]+@/, ":***@")}`)

  let api = startApi()
  let health
  try {
    health = await waitHealth(45000)
  } catch (e) {
    await killApi(api)
    throw e
  }

  log(`1) API up store=${health.store} version=${health.version}`)
  if (health.store !== "postgres") {
    await killApi(api)
    throw new Error(
      `Expected store=postgres, got ${health.store}. Is DATABASE_URL set and Postgres up?`
    )
  }

  // Login
  const login = await req("/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: EMAIL, password: PASSWORD })
  })
  if (login.status !== 200 || !login.body?.token) {
    await killApi(api)
    throw new Error(`login failed: ${login.status} ${JSON.stringify(login.body)}`)
  }
  const auth = { Authorization: `Bearer ${login.body.token}` }
  log(`2) Login OK (${EMAIL})`)

  // Create a secondary admin (durable marker)
  const markerLabel = `pg-validate-${Date.now().toString(36)}`
  const markerEmail = `${markerLabel}@validate.local`
  const create = await req("/v1/org/admins", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      label: markerLabel,
      email: markerEmail,
      password: "Validate1!",
      permissions: ["console_access"]
    })
  })
  if (create.status !== 200 && create.status !== 201) {
    // some APIs return 200 with body
    if (!create.body?.admin && !create.body?.id) {
      await killApi(api)
      throw new Error(
        `create admin failed: ${create.status} ${JSON.stringify(create.body)}`
      )
    }
  }
  const adminId = create.body?.admin?.id || create.body?.id
  log(`3) Created admin marker ${markerEmail} id=${adminId || "?"}`)

  // Force sync epoch
  const fs = await req("/v1/org/force-sync", { method: "POST", headers: auth })
  const epochBefore = fs.body?.config_epoch
  log(`4) Force-sync epoch=${epochBefore}`)

  // List admins before restart
  const before = await req("/v1/org/admins", { headers: auth })
  const labelsBefore = (before.body?.admins || []).map((a) => a.label || a.email)
  if (!labelsBefore.some((l) => String(l).includes("pg-validate"))) {
    await killApi(api)
    throw new Error(`marker admin not in list before restart: ${labelsBefore}`)
  }
  log(`5) Admins before restart: ${labelsBefore.length}`)

  // RESTART
  log("6) Killing API process…")
  await killApi(api)
  await sleep(1000)

  api = startApi()
  health = await waitHealth(45000)
  log(`7) API restarted store=${health.store}`)
  if (health.store !== "postgres") {
    await killApi(api)
    throw new Error(`After restart store=${health.store}, expected postgres`)
  }

  // Re-login (old session should still work if sessions persisted)
  const sessionCheck = await req("/v1/auth/me", { headers: auth })
  let auth2 = auth
  if (sessionCheck.status === 200) {
    log("8) Session survived restart ✓")
  } else {
    log("8) Session expired — re-login (sessions may have TTL cleanup)")
    const login2 = await req("/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: EMAIL, password: PASSWORD })
    })
    if (login2.status !== 200) {
      await killApi(api)
      throw new Error("re-login failed after restart")
    }
    auth2 = { Authorization: `Bearer ${login2.body.token}` }
  }

  const after = await req("/v1/org/admins", { headers: auth2 })
  const labelsAfter = (after.body?.admins || []).map((a) => a.label || a.email)
  if (!labelsAfter.some((l) => String(l).includes("pg-validate"))) {
    await killApi(api)
    throw new Error(
      `FAIL: marker admin LOST after restart. After=${JSON.stringify(labelsAfter)}`
    )
  }
  log(`9) Marker admin still present after restart ✓ (${labelsAfter.length} admins)`)

  const pol = await req("/v1/org/policy", { headers: auth2 })
  const epochAfter = pol.body?.policy?.configEpoch ?? pol.body?.policy?.config_epoch
  log(
    `10) Policy epoch after restart=${epochAfter} (before force was ${epochBefore})`
  )

  // cleanup marker admin if we have id
  if (adminId) {
    await req(`/v1/org/admins/${adminId}`, {
      method: "DELETE",
      headers: auth2
    })
    log("11) Cleaned up marker admin")
  }

  await killApi(api)
  log("\n=== PASS: Postgres control plane survives API restart ===\n")
}

main().catch(async (e) => {
  console.error("\nFAIL:", e.message || e)
  process.exit(1)
})
