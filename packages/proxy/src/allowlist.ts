/**
 * Matching allowlist hosts — aligné esprit policy extension (hostname + sous-domaines).
 */

export function normalizeHost(host: string): string {
  return host
    .trim()
    .toLowerCase()
    .replace(/^\.+/, "")
    .replace(/\.$/, "")
    .replace(/:\d+$/, "") // strip port if present
}

/**
 * true si host exact ou sous-domaine d’une entrée allowlist.
 * ex. www.chatgpt.com matche chatgpt.com
 */
export function isAllowlisted(host: string, allowlist: string[]): boolean {
  const h = normalizeHost(host)
  if (!h) return false
  for (const raw of allowlist) {
    const a = normalizeHost(raw)
    if (!a) continue
    if (h === a) return true
    if (h.endsWith("." + a)) return true
  }
  return false
}
