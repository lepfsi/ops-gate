/**
 * Rate limit + quotas multi-tenant.
 * - Défaut : mémoire process
 * - Si OPSGATE_REDIS_URL / REDIS_URL : partagé multi-instance (fallback mémoire si down)
 */

import { getRedis, rkey } from "./redis"

type Bucket = { count: number; resetAt: number }

const buckets = new Map<string, Bucket>()

/** Compteurs events/jour par org (mémoire) */
const dayCounts = new Map<string, { day: string; n: number }>()
/** Burst events/minute par org (mémoire) */
const minuteCounts = new Map<string, { window: number; n: number }>()

function utcDay(): string {
  return new Date().toISOString().slice(0, 10)
}

function minuteBucket(): number {
  return Math.floor(Date.now() / 60_000)
}

/**
 * Rate limit générique (login, API, events…).
 * key : identifiant stable (ex. login:ip, events:orgId)
 */
export async function rateLimitCheck(
  key: string,
  limit: number,
  windowMs: number
): Promise<{ ok: true } | { ok: false; retryAfterSec: number }> {
  if (limit <= 0) return { ok: true }

  const redis = await getRedis().catch(() => null)
  if (redis?.alive) {
    try {
      const rk = rkey("rl", key)
      const n = await redis.incr(rk)
      if (n === 1) {
        await redis.expire(rk, Math.max(1, Math.ceil(windowMs / 1000)))
      }
      if (n > limit) {
        const pttl = await redis.pttl(rk)
        return {
          ok: false,
          retryAfterSec: Math.max(1, Math.ceil((pttl > 0 ? pttl : windowMs) / 1000))
        }
      }
      return { ok: true }
    } catch {
      /* fallback memory */
    }
  }

  return rateLimitCheckMemory(key, limit, windowMs)
}

/** Sync wrapper legacy — préfère rateLimitCheck async */
export function rateLimitCheckSync(
  key: string,
  limit: number,
  windowMs: number
): { ok: true } | { ok: false; retryAfterSec: number } {
  return rateLimitCheckMemory(key, limit, windowMs)
}

function rateLimitCheckMemory(
  key: string,
  limit: number,
  windowMs: number
): { ok: true } | { ok: false; retryAfterSec: number } {
  if (limit <= 0) return { ok: true }
  const now = Date.now()
  let b = buckets.get(key)
  if (!b || now >= b.resetAt) {
    b = { count: 0, resetAt: now + windowMs }
    buckets.set(key, b)
  }
  b.count++
  if (b.count > limit) {
    return {
      ok: false,
      retryAfterSec: Math.max(1, Math.ceil((b.resetAt - now) / 1000))
    }
  }
  if (buckets.size > 10_000) {
    for (const [k, v] of buckets) {
      if (now >= v.resetAt) buckets.delete(k)
    }
  }
  return { ok: true }
}

export async function checkAndIncrEventQuota(
  orgId: string,
  n: number,
  maxPerDay: number
): Promise<
  { ok: true; remaining: number | null } | { ok: false; used: number; max: number }
> {
  if (!maxPerDay || maxPerDay <= 0) {
    return { ok: true, remaining: null }
  }

  const redis = await getRedis().catch(() => null)
  if (redis?.alive) {
    try {
      const day = utcDay()
      const rk = rkey("quota", "events_day", orgId, day)
      // INCRBY puis vérifier — race légère acceptable ; rollback si dépassement
      const used = await redis.incrBy(rk, n)
      if (used === n) {
        await redis.expire(rk, 48 * 3600)
      }
      if (used > maxPerDay) {
        // rollback best-effort
        try {
          await redis.incrBy(rk, -n)
        } catch {
          /* ignore */
        }
        return { ok: false, used: used - n, max: maxPerDay }
      }
      return { ok: true, remaining: maxPerDay - used }
    } catch {
      /* fallback */
    }
  }

  return checkAndIncrEventQuotaMemory(orgId, n, maxPerDay)
}

function checkAndIncrEventQuotaMemory(
  orgId: string,
  n: number,
  maxPerDay: number
):
  | { ok: true; remaining: number | null }
  | { ok: false; used: number; max: number } {
  if (!maxPerDay || maxPerDay <= 0) {
    return { ok: true, remaining: null }
  }
  const day = utcDay()
  let rec = dayCounts.get(orgId)
  if (!rec || rec.day !== day) {
    rec = { day, n: 0 }
    dayCounts.set(orgId, rec)
  }
  if (rec.n + n > maxPerDay) {
    return { ok: false, used: rec.n, max: maxPerDay }
  }
  rec.n += n
  return { ok: true, remaining: maxPerDay - rec.n }
}

/** Burst : max events / minute glissante (fenêtre 60s fixe) */
export async function checkAndIncrEventMinuteQuota(
  orgId: string,
  n: number,
  maxPerMinute: number
): Promise<
  { ok: true; remaining: number | null } | { ok: false; used: number; max: number }
> {
  if (!maxPerMinute || maxPerMinute <= 0) {
    return { ok: true, remaining: null }
  }

  const redis = await getRedis().catch(() => null)
  if (redis?.alive) {
    try {
      const win = minuteBucket()
      const rk = rkey("quota", "events_min", orgId, String(win))
      const used = await redis.incrBy(rk, n)
      if (used === n) await redis.expire(rk, 120)
      if (used > maxPerMinute) {
        try {
          await redis.incrBy(rk, -n)
        } catch {
          /* ignore */
        }
        return { ok: false, used: used - n, max: maxPerMinute }
      }
      return { ok: true, remaining: maxPerMinute - used }
    } catch {
      /* fallback */
    }
  }

  const win = minuteBucket()
  let rec = minuteCounts.get(orgId)
  if (!rec || rec.window !== win) {
    rec = { window: win, n: 0 }
    minuteCounts.set(orgId, rec)
  }
  if (rec.n + n > maxPerMinute) {
    return { ok: false, used: rec.n, max: maxPerMinute }
  }
  rec.n += n
  return { ok: true, remaining: maxPerMinute - rec.n }
}

export async function getEventQuotaUsed(orgId: string): Promise<number> {
  const redis = await getRedis().catch(() => null)
  if (redis?.alive) {
    try {
      const v = await redis.get(rkey("quota", "events_day", orgId, utcDay()))
      return v ? Number(v) || 0 : 0
    } catch {
      /* fallback */
    }
  }
  const day = utcDay()
  const rec = dayCounts.get(orgId)
  if (!rec || rec.day !== day) return 0
  return rec.n
}

/** Backend actif pour diagnostics */
export async function rateLimitBackend(): Promise<"redis" | "memory"> {
  const r = await getRedis().catch(() => null)
  return r?.alive ? "redis" : "memory"
}
