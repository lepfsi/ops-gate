/**
 * Client Redis minimal (RESP) — optionnel, sans dépendance npm.
 * URL : OPSGATE_REDIS_URL ou REDIS_URL (ex. redis://127.0.0.1:6379/0)
 *
 * Utilisé pour rate-limit + quotas multi-instance.
 * Si absent / down → fallback mémoire (rate-limit.ts).
 */
import * as net from "node:net"

export type RedisStatus = {
  enabled: boolean
  connected: boolean
  url_redacted: string | null
  last_error: string | null
}

let client: RedisClient | null = null
let lastError: string | null = null
let connectPromise: Promise<RedisClient | null> | null = null

export function getRedisUrl(): string | null {
  const u =
    process.env.OPSGATE_REDIS_URL?.trim() ||
    process.env.REDIS_URL?.trim() ||
    ""
  return u || null
}

export function redisStatus(): RedisStatus {
  const url = getRedisUrl()
  return {
    enabled: !!url,
    connected: !!(client && client.alive),
    url_redacted: url ? redactRedisUrl(url) : null,
    last_error: lastError
  }
}

function redactRedisUrl(url: string): string {
  try {
    const u = new URL(url)
    if (u.password) u.password = "***"
    return u.toString()
  } catch {
    return "redis://***"
  }
}

export async function getRedis(): Promise<RedisClient | null> {
  const url = getRedisUrl()
  if (!url) return null
  if (client?.alive) return client
  if (connectPromise) return connectPromise
  connectPromise = connectRedis(url)
    .then((c) => {
      client = c
      lastError = null
      return c
    })
    .catch((e) => {
      lastError = e instanceof Error ? e.message : String(e)
      client = null
      return null
    })
    .finally(() => {
      connectPromise = null
    })
  return connectPromise
}

async function connectRedis(url: string): Promise<RedisClient> {
  const parsed = new URL(url)
  if (parsed.protocol !== "redis:" && parsed.protocol !== "rediss:") {
    throw new Error("redis_url_protocol")
  }
  const host = parsed.hostname || "127.0.0.1"
  const port = Number(parsed.port || 6379)
  const db = parsed.pathname?.replace(/^\//, "")
  const password = parsed.password
    ? decodeURIComponent(parsed.password)
    : undefined
  const username = parsed.username
    ? decodeURIComponent(parsed.username)
    : undefined

  const c = new RedisClient({ host, port })
  await c.connect()
  if (password) {
    if (username && username !== "default") {
      await c.cmd("AUTH", username, password)
    } else {
      await c.cmd("AUTH", password)
    }
  }
  if (db && db !== "0") {
    await c.cmd("SELECT", db)
  }
  await c.cmd("PING")
  return c
}

type Pending = {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
}

export class RedisClient {
  alive = false
  private sock: net.Socket | null = null
  private buf = Buffer.alloc(0)
  private queue: Pending[] = []
  private readonly host: string
  private readonly port: number

  constructor(opts: { host: string; port: number }) {
    this.host = opts.host
    this.port = opts.port
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const s = net.createConnection({ host: this.host, port: this.port })
      this.sock = s
      const t = setTimeout(() => {
        s.destroy()
        reject(new Error("redis_connect_timeout"))
      }, 4000)
      s.once("connect", () => {
        clearTimeout(t)
        this.alive = true
        resolve()
      })
      s.on("data", (chunk) => this.onData(chunk))
      s.on("error", (err) => {
        lastError = String(err.message || err)
        this.failAll(err)
      })
      s.on("close", () => {
        this.alive = false
        this.sock = null
        this.failAll(new Error("redis_closed"))
      })
    })
  }

  private failAll(err: Error) {
    const q = this.queue.splice(0)
    for (const p of q) p.reject(err)
  }

  private onData(chunk: Buffer) {
    this.buf = Buffer.concat([this.buf, chunk])
    while (this.queue.length) {
      const parsed = tryParseResp(this.buf)
      if (!parsed) break
      this.buf = parsed.rest
      const p = this.queue.shift()!
      if (parsed.error) p.reject(new Error(parsed.error))
      else p.resolve(parsed.value)
    }
  }

  cmd(...parts: (string | number)[]): Promise<unknown> {
    if (!this.sock || !this.alive) {
      return Promise.reject(new Error("redis_not_connected"))
    }
    const payload = encodeResp(parts.map(String))
    return new Promise((resolve, reject) => {
      this.queue.push({ resolve, reject })
      this.sock!.write(payload, (err) => {
        if (err) {
          this.queue.pop()
          reject(err)
        }
      })
    })
  }

  async incr(key: string): Promise<number> {
    const v = await this.cmd("INCR", key)
    return Number(v)
  }

  async incrBy(key: string, n: number): Promise<number> {
    const v = await this.cmd("INCRBY", key, n)
    return Number(v)
  }

  async expire(key: string, sec: number): Promise<void> {
    await this.cmd("EXPIRE", key, sec)
  }

  async pttl(key: string): Promise<number> {
    return Number(await this.cmd("PTTL", key))
  }

  async get(key: string): Promise<string | null> {
    const v = await this.cmd("GET", key)
    if (v == null) return null
    return String(v)
  }

  close() {
    this.alive = false
    try {
      this.sock?.destroy()
    } catch {
      /* ignore */
    }
    this.sock = null
  }
}

function encodeResp(parts: string[]): Buffer {
  let s = `*${parts.length}\r\n`
  for (const p of parts) {
    const b = Buffer.from(p, "utf8")
    s += `$${b.length}\r\n${p}\r\n`
  }
  return Buffer.from(s, "utf8")
}

/**
 * Parse une valeur RESP depuis le début de buf.
 * Supporte : simple string, error, integer, bulk string (pas arrays imbriqués).
 */
function tryParseResp(
  buf: Buffer
): { value: unknown; error?: string; rest: Buffer } | null {
  if (buf.length < 2) return null
  const type = String.fromCharCode(buf[0]!)
  if (type === "+" || type === "-" || type === ":") {
    const end = buf.indexOf("\r\n")
    if (end < 0) return null
    const line = buf.subarray(1, end).toString("utf8")
    const rest = buf.subarray(end + 2)
    if (type === "+") return { value: line, rest }
    if (type === "-") return { value: null, error: line, rest }
    return { value: Number(line), rest }
  }
  if (type === "$") {
    const end = buf.indexOf("\r\n")
    if (end < 0) return null
    const len = Number(buf.subarray(1, end).toString("utf8"))
    if (len === -1) {
      return { value: null, rest: buf.subarray(end + 2) }
    }
    const start = end + 2
    const total = start + len + 2
    if (buf.length < total) return null
    const value = buf.subarray(start, start + len).toString("utf8")
    return { value, rest: buf.subarray(total) }
  }
  // Arrays not needed for our commands
  if (type === "*") {
    const end = buf.indexOf("\r\n")
    if (end < 0) return null
    // treat as error for unexpected
    return {
      value: null,
      error: "redis_array_unsupported",
      rest: buf.subarray(end + 2)
    }
  }
  return {
    value: null,
    error: `redis_unknown_type_${type}`,
    rest: buf.subarray(1)
  }
}

/** Prefixe clés OpsGate */
export function rkey(...parts: string[]): string {
  return ["opsgate", ...parts].join(":")
}
