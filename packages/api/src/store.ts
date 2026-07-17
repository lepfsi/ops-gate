import { MemoryStore } from "./memory-store"
import { PgStore } from "./pg-store"
import type { OpsGateStore } from "./store-types"

export type { OpsGateStore } from "./store-types"

let _store: OpsGateStore | null = null

export function getStore(): OpsGateStore {
  if (!_store) {
    throw new Error("Store not initialized — call initStore() first")
  }
  return _store
}

/** Alias used by app routes */
export const store: OpsGateStore = new Proxy({} as OpsGateStore, {
  get(_target, prop, receiver) {
    const s = getStore()
    const value = Reflect.get(s as object, prop, receiver)
    if (typeof value === "function") {
      return value.bind(s)
    }
    return value
  }
})

/**
 * Init store:
 * - DATABASE_URL set → Postgres
 * - sinon → memory (dev sans Docker)
 */
export async function initStore(): Promise<OpsGateStore> {
  const url = process.env.DATABASE_URL?.trim()
  if (url) {
    console.log("[store] Using Postgres")
    const pg = await PgStore.create(url)
    _store = pg
    // Passkeys multi-instance
    try {
      const { attachWebAuthnPool, webauthnProdChecks } = await import(
        "./webauthn"
      )
      attachWebAuthnPool(pg.getPgPool())
      const chk = webauthnProdChecks()
      if (!chk.ok) {
        for (const w of chk.warnings) {
          console.warn(`[webauthn] ${w}`)
        }
      }
    } catch {
      /* ignore */
    }
  } else {
    console.log("[store] DATABASE_URL not set — using memory store")
    _store = new MemoryStore()
  }
  return _store
}
