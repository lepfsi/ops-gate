/**
 * Soft-mask proxy — modes local (422) vs on-wire (rewrite body + forward).
 *
 * On-wire : masque les secrets dans le corps HTTP/1.1 (JSON / texte / multipart)
 * via @opsgate/engine (detect + mask), met à jour Content-Length, relaie l’amont.
 */
import {
  detectSensitiveData,
  maskSensitiveData,
  type Detection
} from "@opsgate/engine"

export type SoftMaskMode = "off" | "local" | "onwire"

/**
 * OPSGATE_PROXY_SOFT_MASK :
 * - unset / 0 / false / off → off (soft-block 403)
 * - local / 422 / json → réponse locale 422 (sans amont)
 * - 1 / true / on / onwire / wire / rewrite → rewrite on-wire (défaut soft-mask)
 */
export function resolveSoftMaskMode(
  env: NodeJS.ProcessEnv = process.env
): SoftMaskMode {
  const v = (env.OPSGATE_PROXY_SOFT_MASK || "").toLowerCase().trim()
  if (!v || v === "0" || v === "false" || v === "off" || v === "no") {
    return "off"
  }
  if (v === "local" || v === "422" || v === "json" || v === "neutral") {
    return "local"
  }
  if (
    v === "1" ||
    v === "true" ||
    v === "on" ||
    v === "onwire" ||
    v === "on-wire" ||
    v === "wire" ||
    v === "rewrite" ||
    v === "mask"
  ) {
    return "onwire"
  }
  // Toute autre valeur non vide : on-wire (opt-in soft-mask)
  return "onwire"
}

/** Règles session / bruit : ne pas masquer (comme observe NEVER_ENFORCE). */
const SKIP_MASK_RULES = new Set([
  "jwt-token",
  "email-address",
  "phone-fr",
  "ip-private-block"
])

export type RewriteResult =
  | {
      ok: true
      data: Buffer
      changed: boolean
      detectionCount: number
      ruleIds: string[]
      bytesIn: number
      bytesOut: number
    }
  | {
      ok: false
      reason: string
      fallback: "local" | "block"
    }

/**
 * Réécrit une requête HTTP/1.1 complète (headers + body) en masquant les secrets.
 * Entrée = octets bruts bufferisés par le MITM (latin1-safe).
 */
export function rewriteHttpRequestMasked(raw: Buffer): RewriteResult {
  const bytesIn = raw.length
  if (bytesIn < 16) {
    return { ok: false, reason: "request_too_small", fallback: "block" }
  }

  // latin1 = bijection octet ↔ char (préserve binaire hors body masqué)
  const rawStr = raw.toString("latin1")
  const sep = rawStr.indexOf("\r\n\r\n")
  if (sep < 0) {
    return { ok: false, reason: "no_http_headers", fallback: "local" }
  }

  const headRaw = rawStr.slice(0, sep)
  let bodyRaw = rawStr.slice(sep + 4)
  const lines = headRaw.split("\r\n")
  if (!lines[0] || !/^(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s/i.test(lines[0])) {
    // Peut être HTTP/2 binaire ou fragment — on ne rewrite pas
    return { ok: false, reason: "not_http11_request", fallback: "local" }
  }

  const headers: Array<{ name: string; value: string; raw: string }> = []
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!
    const c = line.indexOf(":")
    if (c < 0) continue
    const name = line.slice(0, c).trim()
    const value = line.slice(c + 1).trim()
    headers.push({ name, value, raw: line })
  }

  const getHeader = (n: string) =>
    headers.find((h) => h.name.toLowerCase() === n.toLowerCase())?.value

  const contentEncoding = (getHeader("content-encoding") || "").toLowerCase()
  if (
    contentEncoding &&
    contentEncoding !== "identity" &&
    contentEncoding !== "none"
  ) {
    // gzip/br : pas de décompress ici → fallback local
    return {
      ok: false,
      reason: `content_encoding_${contentEncoding}`,
      fallback: "local"
    }
  }

  const transferEncoding = (getHeader("transfer-encoding") || "").toLowerCase()
  if (transferEncoding.includes("chunked")) {
    const de = dechunkBody(bodyRaw)
    if (de == null) {
      return { ok: false, reason: "chunked_decode_failed", fallback: "local" }
    }
    bodyRaw = de
  }

  // Corps vide : rien à masquer (ex. GET)
  if (!bodyRaw || bodyRaw.length < 4) {
    return {
      ok: true,
      data: raw,
      changed: false,
      detectionCount: 0,
      ruleIds: [],
      bytesIn,
      bytesOut: bytesIn
    }
  }

  // Scan + mask sur le body (UTF-8 si possible pour JSON texte)
  const bodyForScan = bodyToScanString(bodyRaw, getHeader("content-type") || "")
  const allDetections = detectSensitiveData(bodyForScan)
  const detections = allDetections.filter((d) => !SKIP_MASK_RULES.has(d.ruleId))

  if (detections.length === 0) {
    // Détection peut être dans headers filtrés — pas de rewrite utile
    return {
      ok: true,
      data: raw,
      changed: false,
      detectionCount: 0,
      ruleIds: [],
      bytesIn,
      bytesOut: bytesIn
    }
  }

  const maskedScan = maskSensitiveData(bodyForScan, detections)
  if (maskedScan === bodyForScan) {
    return {
      ok: true,
      data: raw,
      changed: false,
      detectionCount: detections.length,
      ruleIds: [...new Set(detections.map((d) => d.ruleId))],
      bytesIn,
      bytesOut: bytesIn
    }
  }

  // Réappliquer le mask au body latin1 via les mêmes patterns (ASCII secrets)
  const maskedBodyLatin1 = maskBodyLatin1(bodyRaw, detections)
  if (maskedBodyLatin1 === bodyRaw) {
    // Fallback : si body était purement utf8-compatible, utiliser maskedScan en utf8→latin1
    const asLatin1 = Buffer.from(maskedScan, "utf8").toString("latin1")
    if (asLatin1 === bodyRaw) {
      return {
        ok: true,
        data: raw,
        changed: false,
        detectionCount: detections.length,
        ruleIds: [...new Set(detections.map((d) => d.ruleId))],
        bytesIn,
        bytesOut: bytesIn
      }
    }
    return rebuildRequest(lines[0]!, headers, asLatin1, detections, bytesIn)
  }

  return rebuildRequest(
    lines[0]!,
    headers,
    maskedBodyLatin1,
    detections,
    bytesIn
  )
}

function bodyToScanString(bodyLatin1: string, contentType: string): string {
  const ct = contentType.toLowerCase()
  if (
    ct.includes("json") ||
    ct.includes("text/") ||
    ct.includes("xml") ||
    ct.includes("javascript") ||
    ct.includes("urlencoded") ||
    ct.includes("form-data") ||
    !ct
  ) {
    try {
      return Buffer.from(bodyLatin1, "latin1").toString("utf8")
    } catch {
      return bodyLatin1
    }
  }
  return bodyLatin1
}

/**
 * Masque en restant sur la vue latin1 (octets) pour ne pas casser le multipart binaire.
 * Les patterns secrets (PAN, IBAN, sk-…, etc.) sont ASCII → safe.
 */
function maskBodyLatin1(body: string, detections: Detection[]): string {
  return maskSensitiveData(body, detections)
}

function rebuildRequest(
  requestLine: string,
  headers: Array<{ name: string; value: string; raw: string }>,
  newBody: string,
  detections: Detection[],
  bytesIn: number
): RewriteResult {
  const skip = new Set([
    "content-length",
    "transfer-encoding",
    "content-encoding"
  ])
  const outHeaders: string[] = [requestLine]
  for (const h of headers) {
    if (skip.has(h.name.toLowerCase())) continue
    outHeaders.push(`${h.name}: ${h.value}`)
  }
  const bodyBuf = Buffer.from(newBody, "latin1")
  outHeaders.push(`Content-Length: ${bodyBuf.length}`)
  // Trace (debug / SIEM local) — les APIs IA ignorent en général
  outHeaders.push("X-OpsGate-Masked: 1")

  const head = outHeaders.join("\r\n") + "\r\n\r\n"
  const data = Buffer.concat([Buffer.from(head, "latin1"), bodyBuf])
  return {
    ok: true,
    data,
    changed: true,
    detectionCount: detections.length,
    ruleIds: [...new Set(detections.map((d) => d.ruleId))],
    bytesIn,
    bytesOut: data.length
  }
}

/** Décode un body Transfer-Encoding: chunked (HTTP/1.1). */
export function dechunkBody(chunked: string): string | null {
  let i = 0
  const parts: string[] = []
  const n = chunked.length
  while (i < n) {
    const lineEnd = chunked.indexOf("\r\n", i)
    if (lineEnd < 0) return null
    const sizeLine = chunked.slice(i, lineEnd).split(";", 1)[0]!.trim()
    const size = parseInt(sizeLine, 16)
    if (!Number.isFinite(size) || size < 0) return null
    i = lineEnd + 2
    if (size === 0) {
      // trailers éventuels — on s’arrête
      break
    }
    if (i + size > n) return null
    parts.push(chunked.slice(i, i + size))
    i += size
    if (chunked.startsWith("\r\n", i)) i += 2
    else if (i < n && chunked[i] === "\n") i += 1
    else return null
  }
  return parts.join("")
}

/** Auto-test minimal (callable depuis inspect CLI si besoin). */
export function selfTestSoftMask(): boolean {
  // PAN avec séparateurs (pattern credit-card engine) — Luhn-valid test Visa
  const card = "4532 0151 1283 0366"
  const body = JSON.stringify({ prompt: `pay with ${card}` })
  const raw =
    "POST /v1/chat HTTP/1.1\r\n" +
    "Host: api.example.com\r\n" +
    "Content-Type: application/json\r\n" +
    `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n` +
    "\r\n" +
    body
  const r = rewriteHttpRequestMasked(Buffer.from(raw, "utf8"))
  if (!r.ok || !r.changed) return false
  const s = r.data.toString("utf8")
  return !s.includes("4532 0151") && /XXXX/.test(s)
}
