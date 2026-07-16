/**
 * Matching allowlist hosts — aligné esprit policy extension (hostname + sous-domaines).
 * Base config + hosts policy (sync control plane) + env.
 */

export function normalizeHost(host: string): string {
  return host
    .trim()
    .toLowerCase()
    .replace(/^\.+/, "")
    .replace(/\.$/, "")
    .replace(/:\d+$/, "") // strip port if present
}

/** Hosts additionnels issus de la policy org (enabled_hosts) */
let runtimeHosts: string[] = []

export function setRuntimeAllowlist(hosts: string[] | undefined | null) {
  runtimeHosts = (hosts || [])
    .map(normalizeHost)
    .filter(Boolean)
}

export function getRuntimeAllowlist(): string[] {
  return [...runtimeHosts]
}

/**
 * true si host exact ou sous-domaine d’une entrée allowlist.
 * ex. www.chatgpt.com matche chatgpt.com
 */
export function isAllowlisted(host: string, allowlist: string[]): boolean {
  const h = normalizeHost(host)
  if (!h) return false
  const pool = [...allowlist, ...runtimeHosts]
  for (const raw of pool) {
    const a = normalizeHost(raw)
    if (!a) continue
    if (h === a) return true
    if (h.endsWith("." + a)) return true
  }
  return false
}
