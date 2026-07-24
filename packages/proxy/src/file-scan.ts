/**
 * Scan fichiers lourds (PDF étendu, etc.) — contrat extension ↔ proxy.
 * POST /opsgate-proxy/scan-file
 *
 * {
 *   status: "scanned" | "partial" | "timeout" | "failed",
 *   text: string,
 *   truncated: boolean,
 *   error?: string,
 *   detections?: ...
 * }
 */
import { detectSensitiveData } from "@opsgate/engine"
import { log } from "./log.js"

export type ProxyScanStatus = "scanned" | "partial" | "timeout" | "failed"

export type ProxyScanResult = {
  status: ProxyScanStatus
  text: string
  truncated: boolean
  error?: string
  detections?: Array<{
    ruleId: string
    type: string
    severity: string
    match: string
  }>
}

const MAX_PAGES = 80
const MAX_CHARS = 1_500_000
const TIMEOUT_MS = 12_000

function decodeBase64(b64: string): Buffer {
  return Buffer.from(b64.replace(/\s/g, ""), "base64")
}

/** Extraction PDF texte basique via pdfjs si dispo, sinon failed clair */
async function extractPdfBuffer(
  buf: Buffer
): Promise<{ text: string; truncated: boolean; error?: string }> {
  try {
    // Import dynamique : le package proxy peut ne pas bundler pdfjs
    // Fallback : scan texte brut (streams) pour PDF simples
    const raw = buf.toString("latin1")
    // Heuristique : extraire chaînes entre parenthèses PDF
    const parts: string[] = []
    const re = /\((?:\\.|[^\\)]){2,200}\)/g
    let m: RegExpExecArray | null
    let n = 0
    while ((m = re.exec(raw)) && n < 8000) {
      const s = m[0]
        .slice(1, -1)
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "")
        .replace(/\\\(/g, "(")
        .replace(/\\\)/g, ")")
        .replace(/\\\\/g, "\\")
      if (/[A-Za-z0-9@._-]{3,}/.test(s)) parts.push(s)
      n++
    }
    let text = parts.join("\n").trim()
    let truncated = false
    if (text.length > MAX_CHARS) {
      text = text.slice(0, MAX_CHARS)
      truncated = true
    }
    if (!text) {
      return {
        text: "",
        truncated: false,
        error:
          "PDF sans texte extractible (scanné/image) — OCR proxy P2 non activé dans ce build."
      }
    }
    // Estimer pages via /Type /Page
    const pageHits = (raw.match(/\/Type\s*\/Page[^s]/g) || []).length
    if (pageHits > MAX_PAGES) {
      truncated = true
      text = text.slice(0, Math.floor(text.length * (MAX_PAGES / pageHits)))
    }
    return { text, truncated }
  } catch (e) {
    return {
      text: "",
      truncated: false,
      error: e instanceof Error ? e.message : "extract_error"
    }
  }
}

export async function scanFilePayload(input: {
  filename: string
  mime?: string
  content_base64: string
}): Promise<ProxyScanResult> {
  const started = Date.now()
  try {
    if (!input.content_base64 || input.content_base64.length < 8) {
      return {
        status: "failed",
        text: "",
        truncated: false,
        error: "content_base64 manquant"
      }
    }
    // Limite ~25 Mo base64 ~ 33 Mo
    if (input.content_base64.length > 35_000_000) {
      return {
        status: "failed",
        text: "",
        truncated: true,
        error: "Fichier trop volumineux pour le scan proxy (>~25 Mo)."
      }
    }

    const buf = decodeBase64(input.content_base64)
    const name = (input.filename || "file").toLowerCase()
    const isPdf =
      name.endsWith(".pdf") || (input.mime || "").includes("pdf")

    let text = ""
    let truncated = false
    let err: string | undefined

    if (isPdf) {
      const r = await extractPdfBuffer(buf)
      text = r.text
      truncated = r.truncated
      err = r.error
    } else {
      // Texte / configs
      text = buf.toString("utf8")
      if (text.length > MAX_CHARS) {
        text = text.slice(0, MAX_CHARS)
        truncated = true
      }
    }

    if (Date.now() - started > TIMEOUT_MS) {
      return {
        status: "timeout",
        text: text.slice(0, 50_000),
        truncated: true,
        error: "timeout_proxy_scan"
      }
    }

    if (!text.trim()) {
      return {
        status: "failed",
        text: "",
        truncated,
        error: err || "Aucun texte extrait"
      }
    }

    const detections = detectSensitiveData(text)
    log("info", "file_scan_ok", {
      filename: input.filename,
      bytes: buf.length,
      detections: detections.length,
      ms: Date.now() - started
    })

    return {
      status: truncated ? "partial" : "scanned",
      text,
      truncated,
      detections: detections.slice(0, 40).map((d) => ({
        ruleId: d.ruleId,
        type: d.type,
        severity: d.severity,
        match: d.match.slice(0, 80)
      }))
    }
  } catch (e) {
    return {
      status: "failed",
      text: "",
      truncated: false,
      error: e instanceof Error ? e.message : String(e)
    }
  }
}
