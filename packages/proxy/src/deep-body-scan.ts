/**
 * Deep scan d’un corps HTTP (T4) — multipart fichiers → même extracteurs que /scan-file.
 * Mode MITM : pas d’OCR lourd (timeout enforce), SQLite petit OK.
 */
import { detectSensitiveData, highestSeverity } from "@opsgate/engine"
import { extractContent } from "./content-extract.js"
import { log } from "./log.js"
import {
  getMultipartBoundary,
  guessMultipartBoundary,
  isMultipartContentType,
  parseMultipartBody,
  splitHttp11Request,
  type MultipartPart
} from "./multipart-parse.js"

export const DEEP_SCAN_LIMITS = {
  maxFiles: 6,
  maxPartBytes: 10_000_000,
  maxExtractChars: 400_000,
  /** OCR volontairement off en MITM (latence) */
  mitmMode: true as const,
  timeoutMs: 12_000
}

export type DeepScanResult = {
  /** Texte agrégé pour inspectText / journal */
  text: string
  fileNames: string[]
  fileCount: number
  extractedFiles: number
  truncated: boolean
  kinds: string[]
  detectionCount: number
  highestSeverity: string | null
  ruleIds: string[]
  /** true si au moins une part fichier a été extraite en profondeur */
  deep: boolean
  error?: string
  ms: number
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("deep_scan_timeout")), ms)
    p.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e) => {
        clearTimeout(t)
        reject(e)
      }
    )
  })
}

async function extractPart(
  part: MultipartPart
): Promise<{ text: string; kind: string; truncated: boolean }> {
  // Champ formulaire sans fichier
  if (!part.filename) {
    const t = part.body.toString("utf8")
    // skip binary noise
    if (/[\x00-\x08\x0e-\x1f]/.test(t.slice(0, 200))) {
      return { text: "", kind: "binary_field", truncated: false }
    }
    return {
      text: t.slice(0, 50_000),
      kind: "field",
      truncated: t.length > 50_000
    }
  }

  const r = await extractContent(
    part.body,
    part.filename,
    part.contentType,
    { mode: "mitm" }
  )
  return {
    text: (r.text || "").slice(0, 120_000),
    kind: r.kind || "file",
    truncated: !!r.truncated
  }
}

/**
 * Scan profond d’un body + content-type (ou raw HTTP/1.1).
 */
export async function deepScanBody(
  body: Buffer,
  contentType: string,
  opts?: { host?: string }
): Promise<DeepScanResult> {
  const started = Date.now()
  const empty = (): DeepScanResult => ({
    text: "",
    fileNames: [],
    fileCount: 0,
    extractedFiles: 0,
    truncated: false,
    kinds: [],
    detectionCount: 0,
    highestSeverity: null,
    ruleIds: [],
    deep: false,
    ms: Date.now() - started
  })

  if (!body?.length || body.length < 8) return empty()

  let boundary =
    getMultipartBoundary(contentType) ||
    (isMultipartContentType(contentType) ? null : null)
  if (!boundary) boundary = guessMultipartBoundary(body)
  if (!boundary) {
    // Non-multipart : scan texte + tentative extract si magic
    const asText = body.toString("utf8")
    let text = asText
    if (text.includes("\uFFFD")) {
      text = body
        .toString("latin1")
        .match(/[\x09\x0a\x0d\x20-\x7e\u00a0-\u00ff]{8,}/g)
        ?.join("\n") || ""
    }
    // Magic SQLite / PDF small upload without multipart
    try {
      const r = await withTimeout(
        extractContent(body, "upload.bin", contentType, { mode: "mitm" }),
        DEEP_SCAN_LIMITS.timeoutMs
      )
      if (r.text?.trim() && r.kind !== "text") {
        text = (text + "\n" + r.text).slice(0, DEEP_SCAN_LIMITS.maxExtractChars)
        const dets = detectSensitiveData(text)
        return {
          text,
          fileNames: [],
          fileCount: 0,
          extractedFiles: 1,
          truncated: !!r.truncated,
          kinds: [r.kind],
          detectionCount: dets.length,
          highestSeverity: dets.length ? highestSeverity(dets) : null,
          ruleIds: [...new Set(dets.map((d) => d.ruleId))],
          deep: true,
          ms: Date.now() - started
        }
      }
    } catch {
      /* keep text path */
    }
    text = text.slice(0, DEEP_SCAN_LIMITS.maxExtractChars)
    const dets = detectSensitiveData(text)
    return {
      text,
      fileNames: [],
      fileCount: 0,
      extractedFiles: 0,
      truncated: body.length > DEEP_SCAN_LIMITS.maxExtractChars,
      kinds: ["text"],
      detectionCount: dets.length,
      highestSeverity: dets.length ? highestSeverity(dets) : null,
      ruleIds: [...new Set(dets.map((d) => d.ruleId))],
      deep: false,
      ms: Date.now() - started
    }
  }

  const parts = parseMultipartBody(body, boundary, {
    maxParts: 32,
    maxPartBytes: DEEP_SCAN_LIMITS.maxPartBytes
  })

  const fileParts = parts.filter((p) => p.filename)
  const fieldParts = parts.filter((p) => !p.filename)
  const fileNames = fileParts
    .map((p) => p.filename!)
    .filter(Boolean)
    .slice(0, 20)

  const chunks: string[] = []
  const kinds: string[] = []
  let truncated = false
  let extractedFiles = 0
  let total = 0

  // Champs texte d’abord (prompts)
  for (const p of fieldParts) {
    const t = p.body.toString("utf8")
    if (t.trim().length < 2) continue
    if (/[\x00-\x08]/.test(t.slice(0, 100))) continue
    const piece = t.slice(0, 40_000)
    chunks.push(piece)
    total += piece.length
    if (total >= DEEP_SCAN_LIMITS.maxExtractChars) {
      truncated = true
      break
    }
  }

  // Fichiers (cap)
  const toExtract = fileParts.slice(0, DEEP_SCAN_LIMITS.maxFiles)
  if (fileParts.length > DEEP_SCAN_LIMITS.maxFiles) truncated = true

  try {
    await withTimeout(
      (async () => {
        for (const p of toExtract) {
          if (total >= DEEP_SCAN_LIMITS.maxExtractChars) {
            truncated = true
            break
          }
          try {
            const r = await extractPart(p)
            if (r.truncated) truncated = true
            if (r.text.trim()) {
              chunks.push(
                `\n--- file:${p.filename} (${r.kind}) ---\n${r.text}`
              )
              total += r.text.length
              extractedFiles++
              kinds.push(r.kind)
            } else if (p.filename) {
              chunks.push(`\n--- file:${p.filename} (no_text) ---\n`)
              kinds.push("empty")
            }
          } catch (e) {
            log("warn", "deep_part_extract_failed", {
              host: opts?.host,
              file: p.filename,
              error: e instanceof Error ? e.message : String(e)
            })
          }
        }
      })(),
      DEEP_SCAN_LIMITS.timeoutMs
    )
  } catch (e) {
    truncated = true
    log("warn", "deep_scan_timeout_or_fail", {
      host: opts?.host,
      error: e instanceof Error ? e.message : String(e),
      files: fileNames.length
    })
  }

  let text = chunks.join("\n").slice(0, DEEP_SCAN_LIMITS.maxExtractChars)
  // Toujours inclure les noms de fichiers (règles sur noms)
  if (fileNames.length) {
    text = `files: ${fileNames.join(", ")}\n` + text
  }

  const dets = detectSensitiveData(text)
  const ms = Date.now() - started
  log("info", "deep_body_scan", {
    host: opts?.host,
    files: fileNames.length,
    extracted: extractedFiles,
    kinds,
    detections: dets.length,
    severity: dets.length ? highestSeverity(dets) : null,
    truncated,
    ms
  })

  return {
    text,
    fileNames,
    fileCount: fileNames.length,
    extractedFiles,
    truncated,
    kinds: [...new Set(kinds)],
    detectionCount: dets.length,
    highestSeverity: dets.length ? highestSeverity(dets) : null,
    ruleIds: [...new Set(dets.map((d) => d.ruleId))],
    deep: extractedFiles > 0 || fileNames.length > 0,
    ms
  }
}

/**
 * Scan d’une requête HTTP/1.1 complète bufferisée par le MITM.
 */
export async function deepScanHttp11Raw(
  raw: Buffer,
  opts?: { host?: string }
): Promise<DeepScanResult> {
  const split = splitHttp11Request(raw)
  if (!split) {
    // Peut être un fragment body seul
    return deepScanBody(raw, "", opts)
  }
  // chunked : best-effort dechunk simple
  let body = split.body
  if (/transfer-encoding:\s*chunked/i.test(split.head)) {
    const de = dechunk(body)
    if (de) body = de
  }
  return deepScanBody(body, split.contentType, opts)
}

function dechunk(body: Buffer): Buffer | null {
  try {
    const s = body.toString("latin1")
    const out: Buffer[] = []
    let i = 0
    while (i < s.length) {
      const lineEnd = s.indexOf("\r\n", i)
      if (lineEnd < 0) break
      const sizeLine = s.slice(i, lineEnd).split(";")[0]!.trim()
      const size = parseInt(sizeLine, 16)
      if (!Number.isFinite(size)) return null
      if (size === 0) break
      const dataStart = lineEnd + 2
      const dataEnd = dataStart + size
      if (dataEnd > body.length) return null
      out.push(body.subarray(dataStart, dataEnd))
      i = dataEnd + 2 // skip trailing CRLF
    }
    return out.length ? Buffer.concat(out) : body
  } catch {
    return null
  }
}
