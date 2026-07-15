/**
 * Persistance locale enroll proxy (token agent) — P2.
 * Fichier : packages/proxy/data/agent.json (gitignored via data/)
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import * as os from "node:os"
import * as crypto from "node:crypto"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const AGENT_STATE_PATH = path.resolve(
  __dirname,
  "..",
  "data",
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

export function loadAgentState(): AgentState | null {
  try {
    if (!fs.existsSync(AGENT_STATE_PATH)) return null
    const raw = JSON.parse(fs.readFileSync(AGENT_STATE_PATH, "utf8"))
    if (!raw?.agent_token || !raw?.api_base) return null
    return raw as AgentState
  } catch {
    return null
  }
}

export function saveAgentState(state: AgentState) {
  fs.mkdirSync(path.dirname(AGENT_STATE_PATH), { recursive: true })
  fs.writeFileSync(AGENT_STATE_PATH, JSON.stringify(state, null, 2), {
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
