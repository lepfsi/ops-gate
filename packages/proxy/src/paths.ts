/**
 * Chemins data proxy — monorepo dev ou install MSI/portable.
 *
 * Priorité :
 * 1. OPSGATE_PROXY_DATA_DIR (absolu)
 * 2. %ProgramData%\OpsGate\Proxy (si install MSI / flag)
 * 3. <packageRoot>/data  (dev monorepo ou layout portable)
 */
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * Racine package :
 * - dev : packages/proxy (src/ → ..)
 * - bundle MSI : …/OpsGate/Proxy/bin/opsgate-proxy.mjs → ..
 */
export function packageRoot(): string {
  // src/ en dev → parent = packages/proxy
  // bin/ en prod → parent = install root
  return path.resolve(__dirname, "..")
}

export function resolveProxyDataRoot(): string {
  const env = process.env.OPSGATE_PROXY_DATA_DIR?.trim()
  if (env) {
    return path.resolve(env)
  }
  // Install MSI : binaries sous Program Files, data sous ProgramData
  if (
    process.env.OPSGATE_PROXY_USE_PROGRAMDATA === "1" ||
    process.env.OPSGATE_PROXY_USE_PROGRAMDATA === "true"
  ) {
    const pd =
      process.env.PROGRAMDATA ||
      path.join(os.homedir(), "AppData", "Local")
    return path.join(pd, "OpsGate", "Proxy")
  }
  // Heuristique : si on est sous Program Files, basculer ProgramData
  const root = packageRoot()
  const norm = root.replace(/\//g, "\\").toLowerCase()
  if (
    norm.includes("\\program files\\") ||
    norm.includes("\\program files (x86)\\")
  ) {
    const pd = process.env.PROGRAMDATA || "C:\\ProgramData"
    return path.join(pd, "OpsGate", "Proxy")
  }
  return path.join(root, "data")
}

export function ensureProxyDataDirs(): {
  root: string
  ca: string
  logs: string
} {
  const root = resolveProxyDataRoot()
  const ca = path.join(root, "ca")
  const logs = path.join(root, "logs")
  fs.mkdirSync(ca, { recursive: true })
  fs.mkdirSync(logs, { recursive: true })
  return { root, ca, logs }
}
