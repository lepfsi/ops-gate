/**
 * Rate limit in-memory (process) + quotas org (events/jour).
 * Prod multi-instance : remplacer par Redis plus tard.
 */

type Bucket = { count: number; resetAt: number }

const buckets = new Map<string, Bucket>()

export function rateLimitCheck(
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
  // prune occasionally
  if (buckets.size > 10_000) {
    for (const [k, v] of buckets) {
      if (now >= v.resetAt) buckets.delete(k)
    }
  }
  return { ok: true }
}

/** Compteurs events/jour par org (quota) */
const dayCounts = new Map<string, { day: string; n: number }>()

function utcDay(): string {
  return new Date().toISOString().slice(0, 10)
}

export function checkAndIncrEventQuota(
  orgId: string,
  n: number,
  maxPerDay: number
): { ok: true; remaining: number | null } | { ok: false; used: number; max: number } {
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

export function getEventQuotaUsed(orgId: string): number {
  const day = utcDay()
  const rec = dayCounts.get(orgId)
  if (!rec || rec.day !== day) return 0
  return rec.n
}
