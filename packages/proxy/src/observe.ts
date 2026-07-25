/**
 * Observe + enforce (P3) : scan trafic client→serveur décrypté.
 * - always journal (events API)
 * - enforce : signal block si sévérité medium/high (MITM ne doit PAS relayer)
 * - extrait noms de fichiers multipart (upload) comme l’extension file-scanner
 * - T4 : flushDeep() parse multipart + extracteurs (PDF/Office/SQLite) avant release
 *
 * Important : en enforce, le MITM doit bufferiser avant de relayer (voir mitm.ts).
 * Ici on décide block/observe sur chaque scan forcé.
 */
import * as crypto from "node:crypto"
import { deepScanBody, deepScanHttp11Raw } from "./deep-body-scan.js"
import { inspectText } from "./inspect.js"
import { log } from "./log.js"
import { queueProxyEvent } from "./api-client.js"
import type { AgentState } from "./agent-state.js"
import {
  getMultipartBoundary,
  isMultipartContentType,
  guessMultipartBoundary
} from "./multipart-parse.js"
import { resolveSoftMaskMode } from "./soft-mask.js"
import { getProxyRemoteConfig } from "./sync.js"

const MAX_WINDOW = 512 * 1024
const MIN_CHUNK = 8
/** Même host+règles : ne rejournalise pas avant ce délai (réduit la pluie de logs) */
const DEDUP_TTL_MS = 90_000

export type StreamObserver = {
  /** @returns true si le flux doit être coupé (enforce block) — ne jamais relayer */
  onClientData: (chunk: Buffer) => boolean
  /** Scan final léger (sync). true = block */
  flush: () => boolean
  /**
   * T4 : scan profond async (multipart fichiers → extracteurs).
   * rawHttp11 = buffer hold complet (recommandé en enforce).
   */
  flushDeep: (rawHttp11?: Buffer) => Promise<boolean>
  isBlocked: () => boolean
  /**
   * Fichiers Office/PDF/SQLite détectés : on-wire mask non fiable → soft-block local.
   */
  preferLocalBlock: () => boolean
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
  /** Buffer binaire glissant pour deep scan (latin1-safe) */
  const rawChunks: Buffer[] = []
  let rawBytes = 0
  const seenLogKeys = new Set<string>()
  let blocked = false
  let deepDone = false
  let forceLocalBlock = false

  const appendRaw = (chunk: Buffer) => {
    rawChunks.push(chunk)
    rawBytes += chunk.length
    // garder jusqu’à 8 Mo pour multipart (au-delà : overflow géré par MITM hold)
    const maxRaw = 8 * 1024 * 1024
    while (rawBytes > maxRaw && rawChunks.length > 1) {
      const drop = rawChunks.shift()!
      rawBytes -= drop.length
    }
  }

  const rawConcat = (): Buffer =>
    rawChunks.length === 1 ? rawChunks[0]! : Buffer.concat(rawChunks)

  const emitDetection = (opts: {
    result: ReturnType<typeof inspectText>
    fileNames: string[]
    deep?: boolean
    kinds?: string[]
  }): boolean => {
    if (opts.result.detection_count === 0) return blocked

    const enforce = shouldEnforceBlock(
      opts.result.highest_severity,
      opts.result.rule_ids || []
    )
    const maskMode = resolveSoftMaskMode()
    // Fichiers binaires extraits : on-wire mask peu fiable → prefer block/local
    const preferHard =
      opts.deep &&
      opts.fileNames.length > 0 &&
      (opts.kinds || []).some((k) =>
        ["pdf", "docx", "xlsx", "pptx", "sqlite"].includes(k)
      )
    if (preferHard && enforce) forceLocalBlock = true
    const decision = !enforce
      ? "observe"
      : maskMode === "off" || preferHard
        ? "block"
        : "mask_send"
    const hasFile = opts.fileNames.length > 0
    const rulesKey = opts.result.rule_ids.slice().sort().join(",")
    const logKey = `${meta.host}|${rulesKey}|${decision}|${opts.fileNames.join(",")}|${opts.deep ? "deep" : "light"}`

    if (enforce) {
      blocked = true
    }

    const now = Date.now()
    const lastLog = globalLogDedup.get(logKey) || 0
    const skipLog =
      seenLogKeys.has(logKey) || now - lastLog < DEDUP_TTL_MS

    if (!skipLog) {
      seenLogKeys.add(logKey)
      globalLogDedup.set(logKey, now)
      pruneDedup(now)
      if (seenLogKeys.size > 80) seenLogKeys.clear()

      const samples = opts.result.detections.slice(0, 5).map((d) => ({
        ruleId: d.ruleId,
        severity: d.severity,
        preview: d.preview
      }))

      const primaryType = opts.result.types[0] || rulesKey || "detection"
      const types = [
        primaryType,
        ...(hasFile ? (["file_upload"] as const) : []),
        ...(opts.deep ? (["proxy_deep_scan"] as const) : []),
        ...(enforce
          ? decision === "block"
            ? (["proxy_block"] as const)
            : maskMode === "onwire"
              ? (["proxy_mask_onwire"] as const)
              : (["proxy_mask_local"] as const)
          : [])
      ]

      log(
        "info",
        enforce
          ? decision === "block"
            ? "enforce_block"
            : "enforce_mask"
          : "observe_detection",
        {
          host: meta.host,
          mode: enforce ? "enforce_mitm" : "observe_mitm",
          soft_mask: maskMode,
          source: "proxy",
          decision,
          deep: !!opts.deep,
          extract_kinds: opts.kinds,
          detection_count: opts.result.detection_count,
          highest_severity: opts.result.highest_severity,
          rule_ids: opts.result.rule_ids,
          types,
          file_names: hasFile ? opts.fileNames : undefined,
          samples
        }
      )

      const state = getAgentState()
      if (state?.agent_token) {
        const sev = (opts.result.highest_severity || "low") as
          | "low"
          | "medium"
          | "high"
        queueProxyEvent(state, {
          client_event_id: crypto.randomUUID(),
          ts: new Date().toISOString(),
          hostname: meta.host,
          decision,
          detection_count: opts.result.detection_count,
          highest_severity:
            sev === "low" || sev === "medium" || sev === "high" ? sev : "high",
          rule_ids: opts.result.rule_ids,
          types: [...types],
          file_names: hasFile ? opts.fileNames : null,
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

    return emitDetection({ result, fileNames })
  }

  const looksMultipart = (): boolean => {
    const head = window.slice(0, 4000)
    if (/content-type:\s*multipart\//i.test(head)) return true
    const body = materialForScan(window)
    return guessMultipartBoundary(Buffer.from(body.slice(0, 500), "latin1")) != null
  }

  return {
    onClientData(chunk: Buffer) {
      if (blocked) return true
      appendRaw(chunk)
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
    async flushDeep(rawHttp11?: Buffer) {
      if (blocked) return true
      if (deepDone) return blocked
      deepDone = true

      const raw = rawHttp11?.length ? rawHttp11 : rawConcat()
      if (raw.length < 32) return scan()

      // Skip deep si clairement pas d’upload / corps minuscule
      const headSample = raw.toString("latin1", 0, Math.min(raw.length, 2048))
      const ctMatch = /content-type:\s*([^\r\n]+)/i.exec(headSample)
      const ct = ctMatch?.[1]?.trim() || ""
      const hasMultipart =
        isMultipartContentType(ct) ||
        getMultipartBoundary(ct) != null ||
        looksMultipart() ||
        /filename\s*=/i.test(headSample) ||
        /filename\s*=/i.test(window.slice(0, 8000))

      // Toujours deep si multipart ou filename ; sinon scan léger suffit
      if (!hasMultipart && raw.length < 64_000) {
        return scan()
      }

      try {
        const deep = rawHttp11?.length
          ? await deepScanHttp11Raw(raw, { host: meta.host })
          : await deepScanBody(
              // H2 : DATA seul
              raw,
              ct,
              { host: meta.host }
            )

        if (deep.text.trim()) {
          // Injecter dans la fenêtre pour cohérence
          window =
            (window + "\n" + deep.text).slice(-(MAX_WINDOW))
          const result = inspectText(deep.text.slice(0, 48_000))
          if (result.detection_count > 0 || deep.detectionCount > 0) {
            // Prefer deeper rule set if inspect found less
            const merged =
              result.detection_count >= deep.detectionCount
                ? result
                : {
                    ...result,
                    detection_count: deep.detectionCount,
                    highest_severity: deep.highestSeverity,
                    rule_ids: deep.ruleIds,
                    types: deep.kinds.length
                      ? deep.kinds
                      : result.types,
                    detections: result.detections
                  }
            // Re-inspect for full Detection objects if deep had more
            const finalResult =
              deep.detectionCount > result.detection_count
                ? inspectText(deep.text.slice(0, 48_000))
                : merged
            return emitDetection({
              result: finalResult,
              fileNames: deep.fileNames,
              deep: deep.deep,
              kinds: deep.kinds
            })
          }
        }
      } catch (e) {
        log("warn", "flush_deep_failed", {
          host: meta.host,
          error: e instanceof Error ? e.message : String(e)
        })
      }

      return scan()
    },
    isBlocked() {
      return blocked
    },
    preferLocalBlock() {
      return forceLocalBlock
    },
    reset() {
      blocked = false
      deepDone = false
      forceLocalBlock = false
      window = ""
      rawChunks.length = 0
      rawBytes = 0
    }
  }
}
