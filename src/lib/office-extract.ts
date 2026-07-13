/**
 * Extraction de texte PDF / DOCX côté extension (content script).
 * PDF : pdfjs-dist · DOCX : mammoth
 * Échec → null (le scanner bascule en warn).
 */

const MAX_PDF_PAGES = 40
const MAX_EXTRACT_CHARS = 500_000

function readAsArrayBuffer(file: File, maxBytes: number): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const blob = file.size > maxBytes ? file.slice(0, maxBytes) : file
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error ?? new Error("read failed"))
    reader.readAsArrayBuffer(blob)
  })
}

/** DOCX via mammoth (ZIP + document.xml) */
export async function extractDocxText(
  file: File,
  maxBytes: number
): Promise<{ text: string; truncated: boolean }> {
  const truncated = file.size > maxBytes
  const buf = await readAsArrayBuffer(file, maxBytes)
  // mammoth ships browser-friendly extractRawText
  const mammoth = await import("mammoth/mammoth.browser")
  const result = await mammoth.extractRawText({ arrayBuffer: buf })
  let text = (result.value || "").trim()
  if (text.length > MAX_EXTRACT_CHARS) {
    text = text.slice(0, MAX_EXTRACT_CHARS)
    return { text, truncated: true }
  }
  return { text, truncated }
}

/**
 * PDF via pdfjs-dist v4 — worker URL résolu via import.meta.url.
 */
export async function extractPdfText(
  file: File,
  maxBytes: number
): Promise<{ text: string; truncated: boolean }> {
  const sizeTruncated = file.size > maxBytes
  const buf = await readAsArrayBuffer(file, maxBytes)
  const pdfjs = await import("pdfjs-dist")

  try {
    // Plasmo/Parcel résout le worker en asset URL
    const workerUrl = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url
    ).toString()
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  } catch {
    // fallback CDN-less : laisser pdfjs tenter sans worker (petits PDF)
  }

  const data = new Uint8Array(buf)
  const loadingTask = pdfjs.getDocument({
    data,
    useSystemFonts: true,
    isEvalSupported: false,
    disableFontFace: true,
    verbosity: 0
  })
  const doc = await loadingTask.promise
  const pages = Math.min(doc.numPages, MAX_PDF_PAGES)
  const parts: string[] = []
  let total = 0
  let charTruncated = false

  for (let i = 1; i <= pages; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    const pageText = content.items
      .map((it) => ("str" in it ? String((it as { str: string }).str) : ""))
      .join(" ")
    parts.push(pageText)
    total += pageText.length
    if (total >= MAX_EXTRACT_CHARS) {
      charTruncated = true
      break
    }
  }

  let text = parts.join("\n").trim()
  if (text.length > MAX_EXTRACT_CHARS) {
    text = text.slice(0, MAX_EXTRACT_CHARS)
    charTruncated = true
  }

  const pageTruncated = doc.numPages > MAX_PDF_PAGES
  return {
    text,
    truncated: sizeTruncated || charTruncated || pageTruncated
  }
}

export type OfficeExtractKind = "pdf" | "docx" | "unsupported"

export function officeExtractKind(
  fileName: string,
  mime?: string
): OfficeExtractKind {
  const lower = fileName.toLowerCase()
  if (lower.endsWith(".pdf") || mime?.includes("pdf")) return "pdf"
  if (
    lower.endsWith(".docx") ||
    mime?.includes("wordprocessingml") ||
    mime?.includes("officedocument.wordprocessingml")
  ) {
    return "docx"
  }
  return "unsupported"
}

export async function extractOfficeText(
  file: File,
  maxBytes: number
): Promise<{ text: string; truncated: boolean; kind: OfficeExtractKind } | null> {
  const kind = officeExtractKind(file.name, file.type)
  if (kind === "unsupported") return null
  try {
    if (kind === "pdf") {
      const r = await extractPdfText(file, maxBytes)
      return { ...r, kind }
    }
    const r = await extractDocxText(file, maxBytes)
    return { ...r, kind }
  } catch (e) {
    console.warn("[OpsGate] office extract failed", file.name, e)
    return null
  }
}
