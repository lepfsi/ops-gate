/**
 * Persistance locale enroll proxy (token agent) — P2.
 * Fichier : <dataRoot>/agent.json (dev monorepo ou ProgramData MSI).
 */
import * as fs from "node:fs"
import * as path from "node:path"
import * as os from "node:os"
import * as crypto from "node:crypto"
import { ensureProxyDataDirs, resolveProxyDataRoot } from "./paths.js"

ensureProxyDataDirs()
export const AGENT_STATE_PATH = path.join(
  resolveProxyDataRoot(),
  "agent.json"
)

export type AgentState = {
  agent_id: string
  agent_token: string
  org_id: string
  org_name?: string
  api_base: string
  org_code: string
  device_label: string
  enrolled_at: string
  device_fingerprint: string
}

/** Retire l’ancien préfixe « OpsGate Proxy » du label local. */
export function cleanProxyLabel(label?: string | null): string {
  const s = (label || "")
    .replace(/^OpsGate\s+Proxy\s*[-:–—]?\s*/i, "")
    .trim()
  return s || os.hostname() || "proxy-host"
}

export function loadAgentState(): AgentState | null {
  try {
    if (!fs.existsSync(AGENT_STATE_PATH)) return null
    const raw = JSON.parse(fs.readFileSync(AGENT_STATE_PATH, "utf8"))
    if (!raw?.agent_token || !raw?.api_base) return null
    const state = raw as AgentState
    const cleaned = cleanProxyLabel(state.device_label)
    if (cleaned !== state.device_label) {
      state.device_label = cleaned
      try {
        saveAgentState(state)
      } catch {
        /* ignore rewrite */
      }
    }
    return state
  } catch {
    return null
  }
}

export function saveAgentState(state: AgentState) {
  const toSave = {
    ...state,
    device_label: cleanProxyLabel(state.device_label)
  }
  fs.mkdirSync(path.dirname(AGENT_STATE_PATH), { recursive: true })
  fs.writeFileSync(AGENT_STATE_PATH, JSON.stringify(toSave, null, 2), {
    mode: 0o600,
    encoding: "utf8"
  })
}

export function clearAgentState() {
  try {
    if (fs.existsSync(AGENT_STATE_PATH)) fs.unlinkSync(AGENT_STATE_PATH)
  } catch {
    /* ignore */
  }
}

/** Empreinte stable machine pour re-enroll du même proxy. */
export function proxyFingerprint(orgCode: string): string {
  const material = [
    "opsgate-proxy",
    os.hostname(),
    os.platform(),
    os.arch(),
    orgCode.trim().toUpperCase()
  ].join("|")
  return crypto.createHash("sha256").update(material).digest("hex").slice(0, 40)
}
