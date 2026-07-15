/** Config spike P0 — valeurs sûres par défaut (loopback, allowlist étroite). */

export type ProxyConfig = {
  host: string
  port: number
  /** Hostnames IA (sans schéma). */
  allowlist: string[]
  /** Mode P0 : observe_tunnel only. */
  mode: "observe"
}

export const DEFAULT_ALLOWLIST = [
  "chatgpt.com",
  "chat.openai.com",
  "claude.ai",
  "gemini.google.com",
  "grok.com",
  "www.grok.com",
  "grok.x.ai"
]

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ProxyConfig {
  const port = Number(env.OPSGATE_PROXY_PORT || 8888)
  const host = env.OPSGATE_PROXY_HOST || "127.0.0.1"
  const extra = (env.OPSGATE_PROXY_ALLOWLIST || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  const allowlist = [
    ...new Set([...DEFAULT_ALLOWLIST.map((h) => h.toLowerCase()), ...extra])
  ]
  return {
    host,
    port: Number.isFinite(port) && port > 0 ? port : 8888,
    allowlist,
    mode: "observe"
  }
}
