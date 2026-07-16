/**
 * Postgres RLS context (AsyncLocalStorage) + modes OPSGATE_PG_RLS.
 *
 * Modes :
 * - off    : pas d’injection de contexte (RLS policies absentes ou ignorées)
 * - on     : défaut (recommandé) — bypass service sauf withOrgRls / middleware org
 * - strict : fail-closed sans contexte ; login/enroll doivent withBypassRls
 */
import { AsyncLocalStorage } from "node:async_hooks"
import type pg from "pg"

export type RlsContext = {
  /** Tenant courant (organizations.id) */
  orgId?: string
  /** true = service cross-tenant (seed, login, metrics, enroll lookup) */
  bypass?: boolean
}

const als = new AsyncLocalStorage<RlsContext>()

export type PgRlsMode = "off" | "on" | "strict"

export function getPgRlsMode(
  env: NodeJS.ProcessEnv = process.env
): PgRlsMode {
  const v = (env.OPSGATE_PG_RLS || "on").toLowerCase().trim()
  if (v === "0" || v === "false" || v === "off" || v === "no") return "off"
  if (v === "strict" || v === "force") return "strict"
  return "on"
}

export function getRlsContext(): RlsContext {
  const cur = als.getStore()
  if (cur) return cur
  const mode = getPgRlsMode()
  if (mode === "strict") return { bypass: false, orgId: "" }
  // on / off : défaut bypass pour compat code non wrappé
  return { bypass: true }
}

export function withOrgRls<T>(orgId: string, fn: () => Promise<T>): Promise<T> {
  return als.run({ orgId, bypass: false }, fn)
}

export function withBypassRls<T>(fn: () => Promise<T>): Promise<T> {
  return als.run({ bypass: true, orgId: "" }, fn)
}

export function runWithRls<T>(
  ctx: RlsContext,
  fn: () => Promise<T>
): Promise<T> {
  return als.run(ctx, fn)
}

/**
 * Exécute une requête dans une transaction avec set_config LOCAL (RLS).
 * mode off → pool.query direct.
 */
export async function queryWithRls(
  pool: pg.Pool,
  text: string,
  params?: unknown[]
): Promise<pg.QueryResult> {
  if (getPgRlsMode() === "off") {
    return pool.query(text, params)
  }
  const ctx = getRlsContext()
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    await client.query(`SELECT set_config('app.rls_bypass', $1, true)`, [
      ctx.bypass ? "on" : "off"
    ])
    await client.query(`SELECT set_config('app.current_org_id', $1, true)`, [
      ctx.orgId || ""
    ])
    const res = await client.query(text, params)
    await client.query("COMMIT")
    return res
  } catch (e) {
    try {
      await client.query("ROLLBACK")
    } catch {
      /* ignore */
    }
    throw e
  } finally {
    client.release()
  }
}

/** Paths qui restent en bypass (pas de tenant encore / cross-tenant). */
export function pathNeedsRlsBypass(path: string): boolean {
  const p = path.split("?")[0] || ""
  if (p === "/" || p === "/health" || p === "/healthz" || p === "/metrics") {
    return true
  }
  const bypassPrefixes = [
    "/v1/auth/login",
    "/v1/auth/setup-info",
    "/v1/auth/oidc/",
    "/v1/auth/saml/",
    "/v1/auth/webauthn/",
    "/v1/auth/password-reset",
    "/v1/enroll",
    // Vendor desk : issued_licenses est global (pas d’org_id tenant)
    "/v1/vendor/"
  ]
  return bypassPrefixes.some((b) => p === b || p.startsWith(b))
}
