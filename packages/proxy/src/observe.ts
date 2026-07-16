/**
 * Observe + enforce (P3) : scan trafic client→serveur décrypté.
 * - always journal (events API)
 * - enforce : signal block si sévérité medium/high (MITM ne doit PAS relayer)
 * - extrait noms de fichiers multipart (upload) comme l’extension file-scanner
 *
 * Important : en enforce, le MITM doit bufferiser avant de relayer (voir mitm.ts).
 * Ici on décide block/observe sur chaque scan forcé.
 */
import * as crypto from "node:crypto"
import { inspectText } from "./inspect.js"
import { log } from "./log.js"
import { queueProxyEvent } from "./api-client.js"
import type { AgentState } from "./agent-state.js"
import { resolveSoftMaskMode } from "./soft-mask.js"
import { getProxyRemoteConfig } from "./sync.js"

const MAX_WINDOW = 256 * 1024
const MIN_CHUNK = 8
/** Même host+règles : ne rejournalise pas avant ce délai (réduit la pluie de logs) */
const DEDUP_TTL_MS = 90_000

export type StreamObserver = {
  /** @returns true si le flux doit être coupé (enforce block) — ne jamais relayer */
  onClientData: (chunk: Buffer) => boolean
  /** Scan final (idle / fin de requête). true = block */
  flush: () => boolean
  isBlocked: () => boolean
  /**
   * Réinitialise l’état pour la requête HTTP suivante (keep-alive).
   * Le site reste accessible : on bloque la requête sensible, pas la session.
   */
  reset: () => void
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

/**
 * Matériel scannable : corps HTTP / payload, pas les en-têtes d’auth de session.
 * Sinon chaque requête ChatGPT (Authorization: Bearer eyJ…) est « bloquée ».
 */
export function materialForScan(raw: string): string {
  let s = raw
  // Lignes d’auth / cookies (HTTP/1.1 et fragments h2 textuels)
  s = s.replace(
    /(?:^|[\r\n])(?:authorization|cookie|set-cookie|x-access-token|x-auth-token)\s*:[^\r\n]*/gi,
    "\n"
  )
  // Bearer JWT collé hors header
  s = s.replace(/\bBearer\s+eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/gi, " ")
  // Préférer le body après headers HTTP/1.1
  const split = s.indexOf("\r\n\r\n")
  if (split >= 0 && split < s.length - 8) {
    const body = s.slice(split + 4)
    if (body.length >= 8) return body
  }
  const splitLf = s.indexOf("\n\n")
  if (splitLf >= 0 && splitLf < s.length - 8) {
    const body = s.slice(splitLf + 2)
    if (body.length >= 8) return body
  }
  return s
}

/** Extrait des fragments textuels utiles (JSON strings, ASCII, parties multipart). */
export function extractTextCandidates(buf: string): string[] {
  const out: string[] = []
  const src = materialForScan(buf)
  // Parties multipart : après headers, corps texte
  const parts = src.split(/\r?\n\r?\n/)
  for (const p of parts) {
    if (
      p.length >= 20 &&
      p.length < 8000 &&
      !/[\x00-\x08\x0e-\x1f]/.test(p.slice(0, 200))
    ) {
      if (
        !/^--/.test(p) &&
        (p.includes("=") || p.includes(" ") || /[a-zA-Z]{4,}/.test(p))
      ) {
        out.push(p.slice(0, 4000))
      }
    }
  }
  const reJson = /"((?:\\.|[^"\\]){8,2000})"/g
  let m: RegExpExecArray | null
  while ((m = reJson.exec(src)) !== null) {
    try {
      out.push(JSON.parse(`"${m[1]}"`))
    } catch {
      out.push(m[1])
    }
  }
  // Aussi JSON non échappé long (payload ChatGPT / Claude)
  const reJsonLoose =
    /"(?:parts|content|input|prompt|message|text|query)"\s*:\s*"((?:\\.|[^"\\]){8,8000})"/gi
  while ((m = reJsonLoose.exec(src)) !== null) {
    try {
      out.push(JSON.parse(`"${m[1]}"`))
    } catch {
      out.push(m[1].replace(/\\n/g, "\n").replace(/\\"/g, '"'))
    }
  }
  const reAscii = /[A-Za-z0-9_$/:.=+@\- ]{16,}/g
  while ((m = reAscii.exec(src)) !== null) {
    // Skip JWT-looking ascii runs (session noise)
    if (/^eyJ[A-Za-z0-9_-]+\./.test(m[0])) continue
    out.push(m[0])
  }
  // Fenêtre brute (utile HTTP/2 + JSON compact) — sans headers auth déjà strip
  if (src.length >= 16) {
    out.push(src.slice(0, 16_000))
    if (src.length > 16_000) out.push(src.slice(-16_000))
  }
  return [...new Set(out)].slice(0, 80)
}

export function resolveFilterMode(): "observe" | "enforce" {
  const env = (process.env.OPSGATE_PROXY_MODE || "").toLowerCase()
  if (env === "observe" || env === "enforce") return env
  const cfg = getProxyRemoteConfig()
  if (cfg.mode === "observe" || cfg.mode === "enforce") return cfg.mode
  return "enforce"
}

/**
 * Règles qui ne doivent PAS couper le site (session navigateur, bruit auth).
 * JWT de session ChatGPT/Claude = normal, pas un secret collé par l’utilisateur.
 */
const NEVER_ENFORCE_RULES = new Set([
  "jwt-token",
  "email-address",
  "phone-fr",
  "ip-private-block"
])

function shouldEnforceBlock(
  severity: string | null,
  ruleIds: string[]
): boolean {
  const cfg = getProxyRemoteConfig()
  if (cfg.enabled === false) return false
  if (resolveFilterMode() !== "enforce") return false
  const actionable = ruleIds.filter((id) => !NEVER_ENFORCE_RULES.has(id))
  if (actionable.length === 0) return false
  // high toujours ; medium seulement s’il reste une règle « métier »
  if (severity === "high") return true
  if (severity === "medium") return true
  return false
}

/** Dédup journal uniquement (ne doit JAMAIS empêcher un block) */
const globalLogDedup = new Map<string, number>()

function pruneDedup(now: number) {
  if (globalLogDedup.size < 400) return
  for (const [k, t] of globalLogDedup) {
    if (now - t > DEDUP_TTL_MS) globalLogDedup.delete(k)
  }
  if (globalLogDedup.size > 500) globalLogDedup.clear()
}

export function createStreamObserver(meta: {
  host: string
  direction?: "client_to_server"
}): StreamObserver {
  let window = ""
  const seenLogKeys = new Set<string>()
  let blocked = false

  const scan = (): boolean => {
    if (blocked) return true
    if (window.length < MIN_CHUNK) return false

    const fileNames = extractFileNames(window)
    const candidates = extractTextCandidates(window)
    if (!candidates.length && !fileNames.length) return false

    const blob = candidates.join("\n").slice(0, 48_000)
    const scanBase = materialForScan(window).slice(0, 16_000)
    const result = inspectText(blob || scanBase)
    if (result.detection_count === 0) return false

    // Filtrer JWT pur : journal possible, jamais coupe site
    const enforce = shouldEnforceBlock(
      result.highest_severity,
      result.rule_ids || []
    )
    const maskMode = resolveSoftMaskMode()
    // on-wire / local soft-mask → décision journal mask_send ; sinon block
    const decision = !enforce
      ? "observe"
      : maskMode === "off"
        ? "block"
        : "mask_send"
    const hasFile = fileNames.length > 0
    const rulesKey = result.rule_ids.slice().sort().join(",")
    const logKey = `${meta.host}|${rulesKey}|${decision}|${fileNames.join(",")}`

    // ── HOLD / BLOCK d’abord (indépendant de la dédup journal) ──
    if (enforce) {
      blocked = true
    }

    // ── Journal (dédup seulement ici) ──
    const now = Date.now()
    const lastLog = globalLogDedup.get(logKey) || 0
    const skipLog =
      seenLogKeys.has(logKey) || now - lastLog < DEDUP_TTL_MS

    if (!skipLog) {
      seenLogKeys.add(logKey)
      globalLogDedup.set(logKey, now)
      pruneDedup(now)
      if (seenLogKeys.size > 80) seenLogKeys.clear()

      const samples = result.detections.slice(0, 5).map((d) => ({
        ruleId: d.ruleId,
        severity: d.severity,
        preview: d.preview
      }))

      const primaryType = result.types[0] || rulesKey || "detection"
      const types = [
        primaryType,
        ...(hasFile ? (["file_upload"] as const) : []),
        ...(enforce
          ? maskMode === "onwire"
            ? (["proxy_mask_onwire"] as const)
            : maskMode === "local"
              ? (["proxy_mask_local"] as const)
              : (["proxy_block"] as const)
          : [])
      ]

      log(
        "info",
        enforce
          ? maskMode === "off"
            ? "enforce_block"
            : "enforce_mask"
          : "observe_detection",
        {
          host: meta.host,
          mode: enforce ? "enforce_mitm" : "observe_mitm",
          soft_mask: maskMode,
          source: "proxy",
          decision,
          detection_count: result.detection_count,
          highest_severity: result.highest_severity,
          rule_ids: result.rule_ids,
          types,
          file_names: fileNames.length ? fileNames : undefined,
          samples
        }
      )

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
          types: [...types],
          file_names: hasFile ? fileNames : null,
          redacted_matches: samples.map((s) => ({
            rule_id: s.ruleId,
            preview: s.preview
          }))
        })
      }
    } else if (enforce) {
      log("debug", "enforce_block_deduped_log", {
        host: meta.host,
        note: "block/mask actif, journal déjà émis récemment"
      })
    }

    return blocked
  }

  return {
    onClientData(chunk: Buffer) {
      if (blocked) return true
      // latin1 conserve les octets (HTTP/2 binaire + JSON utf8 mélangés)
      window += chunk.toString("latin1")
      if (window.length > MAX_WINDOW) {
        window = window.slice(window.length - MAX_WINDOW)
      }
      return scan()
    },
    flush() {
      return scan()
    },
    isBlocked() {
      return blocked
    },
    reset() {
      blocked = false
      window = ""
      // keep seenLogKeys — dédup journal uniquement
    }
  }
}
