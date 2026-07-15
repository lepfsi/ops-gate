/**
 * Observe + enforce (P3) : scan trafic client→serveur décrypté.
 * - always journal (events API)
 * - enforce : signal block si sévérité medium/high (MITM coupe le flux)
 * - extrait noms de fichiers multipart (upload) comme l’extension file-scanner
 */
import * as crypto from "node:crypto"
import { inspectText } from "./inspect.js"
import { log } from "./log.js"
import { queueProxyEvent } from "./api-client.js"
import type { AgentState } from "./agent-state.js"
import { getProxyRemoteConfig } from "./sync.js"

const MAX_WINDOW = 96 * 1024
const MIN_INTERVAL_MS = 800
const MIN_CHUNK = 24

export type StreamObserver = {
  /** @returns true si le flux doit être coupé (enforce block) */
  onClientData: (chunk: Buffer) => boolean
  flush: () => void
}

type AgentStateGetter = () => AgentState | null

let getAgentState: AgentStateGetter = () => null

export function setAgentStateGetter(fn: AgentStateGetter) {
  getAgentState = fn
}

/** Noms de fichiers dans multipart / Content-Disposition */
export function extractFileNames(buf: string): string[] {
  const out: string[] = []
  const re =
    /filename\*?=(?:UTF-8''|")?([^";\r\n]+)"?|name="([^"]+\.(?:txt|csv|json|md|pdf|docx?|xlsx?|pptx?|xml|log|conf|env|pem|key|sql))"/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(buf)) !== null) {
    const name = (m[1] || m[2] || "").trim().replace(/^.*[/\\]/, "")
    if (name && name.length < 200) out.push(name)
  }
  return [...new Set(out)].slice(0, 10)
}

/** Extrait des fragments textuels utiles (JSON strings, ASCII, parties multipart). */
export function extractTextCandidates(buf: string): string[] {
  const out: string[] = []
  // Parties multipart : après headers, corps texte
  const parts = buf.split(/\r?\n\r?\n/)
  for (const p of parts) {
    if (p.length >= 20 && p.length < 8000 && !/[\x00-\x08\x0e-\x1f]/.test(p.slice(0, 200))) {
      if (!/^--/.test(p) && (p.includes("=") || p.includes(" ") || /[a-zA-Z]{4,}/.test(p))) {
        out.push(p.slice(0, 4000))
      }
    }
  }
  const reJson = /"((?:\\.|[^"\\]){8,2000})"/g
  let m: RegExpExecArray | null
  while ((m = reJson.exec(buf)) !== null) {
    try {
      out.push(JSON.parse(`"${m[1]}"`))
    } catch {
      out.push(m[1])
    }
  }
  const reAscii = /[A-Za-z0-9_$/:.=+@\- ]{20,}/g
  while ((m = reAscii.exec(buf)) !== null) {
    out.push(m[0])
  }
  return [...new Set(out)].slice(0, 50)
}

function resolveFilterMode(): "observe" | "enforce" {
  const env = (process.env.OPSGATE_PROXY_MODE || "").toLowerCase()
  if (env === "observe" || env === "enforce") return env
  const cfg = getProxyRemoteConfig()
  if (cfg.mode === "observe" || cfg.mode === "enforce") return cfg.mode
  return "enforce"
}

function shouldEnforceBlock(severity: string | null): boolean {
  const cfg = getProxyRemoteConfig()
  if (cfg.enabled === false) return false
  if (resolveFilterMode() !== "enforce") return false
  return severity === "high" || severity === "medium"
}

export function createStreamObserver(meta: {
  host: string
  direction?: "client_to_server"
}): StreamObserver {
  let window = ""
  let lastScan = 0
  const seenKeys = new Set<string>()
  let blocked = false

  const scan = (force = false): boolean => {
    if (blocked) return true
    const now = Date.now()
    if (!force && now - lastScan < MIN_INTERVAL_MS) return false
    if (window.length < MIN_CHUNK) return false
    lastScan = now

    const fileNames = extractFileNames(window)
    const candidates = extractTextCandidates(window)
    if (!candidates.length && !fileNames.length) return false

    const blob = candidates.join("\n").slice(0, 32_000)
    const result = inspectText(blob || window.slice(0, 8000))
    if (result.detection_count === 0) return false

    const key =
      result.rule_ids.sort().join(",") +
      ":" +
      result.highest_severity +
      ":" +
      fileNames.join(",")
    if (seenKeys.has(key)) return false
    seenKeys.add(key)
    if (seenKeys.size > 200) seenKeys.clear()

    const samples = result.detections.slice(0, 5).map((d) => ({
      ruleId: d.ruleId,
      severity: d.severity,
      preview: d.preview
    }))

    const enforce = shouldEnforceBlock(result.highest_severity)
    const decision = enforce ? "block" : "observe"
    const hasFile = fileNames.length > 0

    log("info", enforce ? "enforce_block" : "observe_detection", {
      host: meta.host,
      mode: enforce ? "enforce_mitm" : "observe_mitm",
      source: "proxy",
      decision,
      detection_count: result.detection_count,
      highest_severity: result.highest_severity,
      rule_ids: result.rule_ids,
      types: result.types,
      file_names: fileNames.length ? fileNames : undefined,
      samples
    })

    const state = getAgentState()
    if (state?.agent_token) {
      const sev = (result.highest_severity || "low") as
        | "low"
        | "medium"
        | "high"
      queueProxyEvent(state, {
        client_event_id: crypto.randomUUID(),
        ts: new Date().toISOString(),
        hostname: meta.host,
        decision,
        detection_count: result.detection_count,
        highest_severity:
          sev === "low" || sev === "medium" || sev === "high" ? sev : "high",
        rule_ids: result.rule_ids,
        types: [
          ...result.types,
          ...(hasFile ? ["file_upload"] : []),
          ...(enforce ? ["proxy_block"] : [])
        ],
        file_names: hasFile ? fileNames : null,
        redacted_matches: samples.map((s) => ({
          rule_id: s.ruleId,
          preview: s.preview
        }))
      })
    }

    if (enforce) {
      blocked = true
      return true
    }
    return false
  }

  return {
    onClientData(chunk: Buffer) {
      if (blocked) return true
      window += chunk.toString("utf8")
      if (window.length > MAX_WINDOW) {
        window = window.slice(window.length - MAX_WINDOW)
      }
      return scan(false)
    },
    flush() {
      scan(true)
      window = ""
    }
  }
}
