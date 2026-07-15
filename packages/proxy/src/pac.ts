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
  const conditions = hosts
    .map((h) => {
      // Exact + sous-domaines
      return (
        `  if (host === ${JSON.stringify(h)} || dnsDomainIs(host, ${JSON.stringify("." + h)})) {\n` +
        `    return PROXY_SPEC;\n` +
        `  }`
      )
    })
    .join("\n")

  return `// OpsGate Proxy PAC — généré (P0)
// Ne pas éditer à la main : pnpm proxy:pac
// Proxy: ${opts.proxyHost}:${opts.proxyPort}

var PROXY_SPEC = "PROXY ${opts.proxyHost}:${opts.proxyPort}";

function FindProxyForURL(url, host) {
  host = host.toLowerCase();
  // Bypass loopback
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
