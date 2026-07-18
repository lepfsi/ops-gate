/** Config proxy — P0 tunnel + P1 MITM + P2 control plane + multi-IA. */

export type ProxyConfig = {
  host: string
  port: number
  /** Hostnames IA (sans schéma). */
  allowlist: string[]
  /** observe = ne jamais modifier le trafic. */
  mode: "observe"
  /**
   * MITM TLS sur hosts allowlist (P1).
   * false = tunnel pur (P0). true = déchiffrement + observe engine.
   */
  mitm: boolean
  /** Control plane (P2) */
  apiBase: string
  orgCode: string
  /** Auto-enroll au démarrage serve si pas de token local */
  autoEnroll: boolean
}

/**
 * Allowlist multi-IA par défaut (alignée HostPicker extension).
 * MITM + filtrage uniquement sur ces hosts (+ sous-domaines).
 * Surcharge : OPSGATE_PROXY_ALLOWLIST=host1,host2 + policy enabled_hosts (sync).
 */
export const DEFAULT_ALLOWLIST = [
  // OpenAI / ChatGPT
  "chatgpt.com",
  "www.chatgpt.com",
  "chat.openai.com",
  "openai.com",
  "platform.openai.com",
  "ab.chatgpt.com",
  "cdn.oaistatic.com",
  "auth-cdn.oaistatic.com",
  "cdn.openai.com",
  // Anthropic
  "claude.ai",
  "www.claude.ai",
  // Google
  "gemini.google.com",
  "bard.google.com",
  "aistudio.google.com",
  "notebooklm.google.com",
  "labs.google",
  // Microsoft
  "copilot.microsoft.com",
  "www.bing.com",
  // xAI
  "grok.com",
  "www.grok.com",
  "grok.x.ai",
  // Autres grands
  "perplexity.ai",
  "www.perplexity.ai",
  "chat.deepseek.com",
  "deepseek.com",
  "www.deepseek.com",
  "chat.mistral.ai",
  "lechat.mistral.ai",
  "console.groq.com",
  "meta.ai",
  "www.meta.ai",
  "poe.com",
  "www.poe.com",
  "you.com",
  "www.you.com",
  "huggingface.co",
  "openrouter.ai",
  "together.ai",
  "fireworks.ai",
  "phind.com",
  "www.phind.com",
  "pi.ai",
  "character.ai",
  "www.character.ai",
  "blackbox.ai",
  "chat.lmsys.org",
  "lmarena.ai",
  "typingmind.com",
  "chat.qwen.ai",
  "writesonic.com",
  "jasper.ai",
  "copy.ai",
  "deepai.org",
  "sider.ai",
  "monica.im",
  "chatpdf.com",
  "consensus.app",
  "elicit.com"
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
  const mitmRaw = (env.OPSGATE_PROXY_MITM ?? "1").toLowerCase()
  const mitm = !(mitmRaw === "0" || mitmRaw === "false" || mitmRaw === "off")

  const autoRaw = (env.OPSGATE_PROXY_AUTO_ENROLL ?? "1").toLowerCase()
  const autoEnroll = !(
    autoRaw === "0" ||
    autoRaw === "false" ||
    autoRaw === "off"
  )

  return {
    host,
    port: Number.isFinite(port) && port > 0 ? port : 8888,
    allowlist,
    mode: "observe",
    mitm,
    apiBase: (
      env.OPSGATE_API_URL ||
      env.OPSGATE_API_BASE ||
      "http://127.0.0.1:8787"
    ).replace(/\/$/, ""),
    orgCode: (env.OPSGATE_ORG_CODE || "DEMO-OPSGATE").trim(),
    autoEnroll
  }
}
