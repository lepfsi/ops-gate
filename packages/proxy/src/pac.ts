import { normalizeHost } from "./allowlist.js"

/**
 * Génère un fichier PAC : seul le trafic allowlist passe par le proxy local.
 */
export function generatePac(opts: {
  proxyHost: string
  proxyPort: number
  allowlist: string[]
}): string {
  const hosts = opts.allowlist.map(normalizeHost).filter(Boolean)
  // Domaines de base pour dnsDomainIs (ex. chat.openai.com → .openai.com)
  const apex = new Set<string>()
  for (const h of hosts) {
    apex.add(h)
    const parts = h.split(".")
    if (parts.length >= 2) {
      apex.add(parts.slice(-2).join(".")) // openai.com, chatgpt.com
    }
  }
  const domainList = [...apex]

  const conditions = domainList
    .map((h) => {
      return (
        `  if (host === ${JSON.stringify(h)} || dnsDomainIs(host, ${JSON.stringify("." + h)}) || shExpMatch(host, ${JSON.stringify("*." + h)})) {\n` +
        `    return PROXY_SPEC;\n` +
        `  }`
      )
    })
    .join("\n")

  return `// OpsGate Proxy PAC — généré (P1)
// Ne pas éditer à la main : pnpm proxy:pac
// Proxy: ${opts.proxyHost}:${opts.proxyPort}
// Astuce Chrome Windows : préférer http://${opts.proxyHost}:${opts.proxyPort}/opsgate-proxy.pac
// plutôt que file:/// (souvent ignoré).

var PROXY_SPEC = "PROXY ${opts.proxyHost}:${opts.proxyPort}";

function FindProxyForURL(url, host) {
  if (!host) return "DIRECT";
  host = host.toLowerCase();
  // Bypass loopback / proxy lui-même
  if (
    host === "127.0.0.1" ||
    host === "localhost" ||
    host === "[::1]" ||
    shExpMatch(host, "127.*")
  ) {
    return "DIRECT";
  }
${conditions}
  return "DIRECT";
}
`
}
