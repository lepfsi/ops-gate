/**
 * Scan fichiers lourds — contrat extension ↔ proxy.
 * POST /opsgate-proxy/scan-file
 *
 * P0 : PDF texte + Office OOXML + texte
 * T2 : OCR images + PDF scannés (JPEG embarqués)
 * T4 MITM multipart : deep-body-scan.ts (hors de ce endpoint)
 */
import { detectSensitiveData } from "@opsgate/engine"
import { extractContent } from "./content-extract.js"
import { log } from "./log.js"

export type ProxyScanStatus = "scanned" | "partial" | "timeout" | "failed"

export type ProxyScanResult = {
  status: ProxyScanStatus
  text: string
  truncated: boolean
  error?: string
  kind?: string
  pageCount?: number
  needsOcr?: boolean
  usedOcr?: boolean
  ocrImages?: number
  tableCount?: number
  rowSamples?: number
  detections?: Array<{
    ruleId: string
    type: string
    severity: string
    match: string
  }>
}

/** OCR multi-images peut dépasser 20 s — plafond global. */
const TIMEOUT_MS = 90_000

function decodeBase64(b64: string): Buffer {
  return Buffer.from(b64.replace(/\s/g, ""), "base64")
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
    // ~25 Mo binaire ≈ 33 Mo base64
    if (input.content_base64.length > 35_000_000) {
      return {
        status: "failed",
        text: "",
        truncated: true,
        error: "Fichier trop volumineux pour le scan proxy (>~25 Mo)."
      }
    }

    const buf = decodeBase64(input.content_base64)
    const extracted = await extractContent(
      buf,
      input.filename || "file",
      input.mime
    )

    if (Date.now() - started > TIMEOUT_MS) {
      return {
        status: "timeout",
        text: (extracted.text || "").slice(0, 50_000),
        truncated: true,
        kind: extracted.kind,
        pageCount: extracted.pageCount,
        needsOcr: extracted.needsOcr,
        usedOcr: extracted.usedOcr,
        ocrImages: extracted.ocrImages,
        tableCount: extracted.tableCount,
        rowSamples: extracted.rowSamples,
        error: "timeout_proxy_scan"
      }
    }

    if (!extracted.text.trim()) {
      log("warn", "file_scan_empty", {
        filename: input.filename,
        kind: extracted.kind,
        error: extracted.error,
        needsOcr: extracted.needsOcr,
        usedOcr: extracted.usedOcr,
        tableCount: extracted.tableCount,
        ms: Date.now() - started
      })
      return {
        status: "failed",
        text: "",
        truncated: extracted.truncated,
        kind: extracted.kind,
        pageCount: extracted.pageCount,
        needsOcr: extracted.needsOcr,
        usedOcr: extracted.usedOcr,
        ocrImages: extracted.ocrImages,
        tableCount: extracted.tableCount,
        rowSamples: extracted.rowSamples,
        error: extracted.error || "Aucun texte extrait"
      }
    }

    const detections = detectSensitiveData(extracted.text)
    log("info", "file_scan_ok", {
      filename: input.filename,
      kind: extracted.kind,
      bytes: buf.length,
      chars: extracted.text.length,
      detections: detections.length,
      truncated: extracted.truncated,
      usedOcr: extracted.usedOcr,
      ocrImages: extracted.ocrImages,
      tableCount: extracted.tableCount,
      rowSamples: extracted.rowSamples,
      ms: Date.now() - started
    })

    return {
      status: extracted.truncated ? "partial" : "scanned",
      text: extracted.text,
      truncated: extracted.truncated,
      kind: extracted.kind,
      pageCount: extracted.pageCount,
      needsOcr: extracted.needsOcr,
      usedOcr: extracted.usedOcr,
      ocrImages: extracted.ocrImages,
      tableCount: extracted.tableCount,
      rowSamples: extracted.rowSamples,
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
