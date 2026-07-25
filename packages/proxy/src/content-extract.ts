/**
 * Extraction de contenu pour le scan proxy local.
 * P0 : PDF texte + Office OOXML + texte
 * T2 : OCR images + PDF scannés (JPEG embarqués)
 * T3 : SQLite binaire (schéma + échantillon)
 */
import { ocrImageBuffer, ocrImageList, OCR_LIMITS } from "./ocr.js"
import { extractPdfEmbeddedImages } from "./pdf-images.js"
import { extractSqlite, isSqliteBuffer } from "./sqlite-extract.js"
import { unzipAll, stripXmlText, entryText } from "./zip-extract.js"

export type ExtractResult = {
  text: string
  truncated: boolean
  /** pdf | docx | pptx | xlsx | text | image | sqlite | unknown */
  kind: string
  pageCount?: number
  error?: string
  /** true si OCR a été tenté / serait utile */
  needsOcr?: boolean
  /** true si le texte vient de l’OCR */
  usedOcr?: boolean
  ocrImages?: number
  tableCount?: number
  rowSamples?: number
}

const MAX_PAGES = 80
const MAX_CHARS = 1_500_000
const MAX_OOXML_FILES = 250

function cap(
  text: string,
  truncated: boolean
): { text: string; truncated: boolean } {
  if (text.length > MAX_CHARS) {
    return { text: text.slice(0, MAX_CHARS), truncated: true }
  }
  return { text, truncated }
}

function isUseful(text: string): boolean {
  const t = text.replace(/\s+/g, " ").trim()
  if (t.length < 8) return false
  // Reject pure numeric garbage from bad PDF streams
  const digits = (t.match(/\d/g) || []).length
  if (digits / t.length > 0.75 && t.length > 40) return false
  return /[A-Za-zÀ-ÿ@._\-]{3,}/.test(t)
}

/** PDF literals fallback (no inflate of streams — avoids digit soup) */
function extractPdfLiterals(buf: Buffer): { text: string; truncated: boolean } {
  const raw = buf.toString("latin1")
  const parts: string[] = []
  const re = /\((?:\\.|[^\\)]){2,200}\)/g
  let m: RegExpExecArray | null
  let n = 0
  while ((m = re.exec(raw)) && n < 12_000) {
    const s = m[0]
      .slice(1, -1)
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "")
      .replace(/\\\(/g, "(")
      .replace(/\\\)/g, ")")
      .replace(/\\\\/g, "\\")
    if (/[A-Za-z0-9@._\-]{3,}/.test(s)) parts.push(s)
    n++
  }
  // Also try hex strings <...> with ASCII-ish
  const hexRe = /<([0-9A-Fa-f]{8,400})>/g
  let h: RegExpExecArray | null
  let hn = 0
  while ((h = hexRe.exec(raw)) && hn < 2000) {
    const hex = h[1]
    if (hex.length % 2 !== 0) continue
    try {
      const bytes = Buffer.from(hex, "hex")
      const s = bytes.toString("utf8")
      if (/[A-Za-z0-9@._\-]{4,}/.test(s) && isUseful(s)) parts.push(s)
    } catch {
      /* ignore */
    }
    hn++
  }
  const joined = parts.join("\n").trim()
  return cap(joined, false)
}

async function extractPdfPdfjs(
  buf: Buffer
): Promise<{ text: string; truncated: boolean; pageCount: number } | null> {
  try {
    // pdfjs-dist v4 ESM — legacy build works better under Node/tsx
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs")
    const data = new Uint8Array(buf)
    const loadingTask = pdfjs.getDocument({
      data,
      useSystemFonts: true,
      isEvalSupported: false,
      disableFontFace: true,
      useWorkerFetch: false,
      verbosity: 0
    })
    const doc = await loadingTask.promise
    const pageCount = doc.numPages
    const limit = Math.min(pageCount, MAX_PAGES)
    const parts: string[] = []
    let total = 0
    let charTrunc = false

    for (let i = 1; i <= limit; i++) {
      const page = await doc.getPage(i)
      const content = await page.getTextContent()
      let line = ""
      let lastY: number | null = null
      for (const item of content.items) {
        if (!("str" in item)) continue
        const it = item as {
          str: string
          transform?: number[]
          hasEOL?: boolean
        }
        const str = (it.str || "").replace(/\s+/g, " ")
        if (!str) continue
        const y = it.transform ? it.transform[5] : null
        if (lastY != null && y != null && Math.abs(lastY - y) > 4 && line.trim()) {
          parts.push(line.trim())
          total += line.length
          line = ""
        }
        line += (line && !line.endsWith(" ") ? " " : "") + str
        if (it.hasEOL) {
          parts.push(line.trim())
          total += line.length
          line = ""
        }
        if (y != null) lastY = y
      }
      if (line.trim()) {
        parts.push(line.trim())
        total += line.length
      }
      if (total >= MAX_CHARS) {
        charTrunc = true
        break
      }
    }

    try {
      await doc.destroy()
    } catch {
      /* ignore */
    }

    let text = parts
      .join("\n")
      .replace(/\u0000/g, "")
      .replace(/[\uFFFD]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
    if (text.length > MAX_CHARS) {
      text = text.slice(0, MAX_CHARS)
      charTrunc = true
    }
    if (pageCount > MAX_PAGES) charTrunc = true
    return { text, truncated: charTrunc, pageCount }
  } catch {
    return null
  }
}

async function ocrPdfEmbedded(buf: Buffer): Promise<ExtractResult | null> {
  const { images, truncated } = extractPdfEmbeddedImages(
    buf,
    OCR_LIMITS.maxImagesPerDoc
  )
  if (!images.length) return null
  const ocr = await ocrImageList(images)
  if (!ocr.ok || !ocr.text.trim()) {
    return {
      kind: "pdf",
      text: "",
      truncated,
      needsOcr: true,
      usedOcr: true,
      ocrImages: images.length,
      error: ocr.ok === false ? ocr.error : "ocr_empty_on_pdf_images"
    }
  }
  const c = cap(ocr.text, truncated || ocr.truncated)
  return {
    kind: "pdf",
    text: c.text,
    truncated: c.truncated,
    needsOcr: true,
    usedOcr: true,
    ocrImages: ocr.images
  }
}

export async function extractPdf(
  buf: Buffer,
  opts?: { mode?: "full" | "mitm" }
): Promise<ExtractResult> {
  const viaPdfjs = await extractPdfPdfjs(buf)
  if (viaPdfjs && isUseful(viaPdfjs.text)) {
    const c = cap(viaPdfjs.text, viaPdfjs.truncated)
    return {
      kind: "pdf",
      text: c.text,
      truncated: c.truncated,
      pageCount: viaPdfjs.pageCount
    }
  }

  const lit = extractPdfLiterals(buf)
  if (isUseful(lit.text)) {
    return {
      kind: "pdf",
      text: lit.text,
      truncated: lit.truncated,
      pageCount: viaPdfjs?.pageCount
    }
  }

  // MITM : pas d’OCR (latence) — renvoyer needsOcr pour /scan-file offload
  if (opts?.mode === "mitm") {
    const emb = extractPdfEmbeddedImages(buf, 1)
    return {
      kind: "pdf",
      text: "",
      truncated: false,
      pageCount: viaPdfjs?.pageCount,
      needsOcr: true,
      error: emb.images.length
        ? "PDF scanné (images) — OCR non exécuté en MITM (utilisez l’extension + proxy /scan-file)."
        : "PDF sans texte extractible en MITM."
    }
  }

  // PDF scanné / image-only → OCR des JPEG embarqués
  const viaOcr = await ocrPdfEmbedded(buf)
  if (viaOcr?.text?.trim()) {
    return {
      ...viaOcr,
      pageCount: viaPdfjs?.pageCount ?? viaOcr.ocrImages
    }
  }

  return {
    kind: "pdf",
    text: "",
    truncated: false,
    pageCount: viaPdfjs?.pageCount,
    needsOcr: true,
    usedOcr: !!viaOcr?.usedOcr,
    ocrImages: viaOcr?.ocrImages,
    error:
      viaOcr?.error ||
      "PDF sans texte extractible et sans images JPEG embarquées OCR-ables."
  }
}

export async function extractImage(
  buf: Buffer,
  opts?: { mode?: "full" | "mitm" }
): Promise<ExtractResult> {
  if (opts?.mode === "mitm") {
    return {
      kind: "image",
      text: "",
      truncated: false,
      needsOcr: true,
      error: "OCR image non exécuté en MITM (latence) — extension + /scan-file."
    }
  }
  if (buf.length > OCR_LIMITS.maxInputBytes) {
    return {
      kind: "image",
      text: "",
      truncated: true,
      needsOcr: true,
      error: `Image trop grande pour OCR proxy (>${Math.round(OCR_LIMITS.maxInputBytes / 1e6)} Mo).`
    }
  }
  const ocr = await ocrImageBuffer(buf, { label: "image" })
  if (!ocr.ok) {
    return {
      kind: "image",
      text: "",
      truncated: false,
      needsOcr: true,
      usedOcr: true,
      error: `OCR image échoué (${ocr.error}).`
    }
  }
  if (!ocr.text.trim()) {
    return {
      kind: "image",
      text: "",
      truncated: false,
      needsOcr: true,
      usedOcr: true,
      error: "OCR : peu ou pas de texte détecté dans l’image."
    }
  }
  const c = cap(ocr.text, ocr.truncated)
  return {
    kind: "image",
    text: c.text,
    truncated: c.truncated,
    needsOcr: true,
    usedOcr: true,
    ocrImages: 1
  }
}

function collectWt(xml: string): string {
  const wParts: string[] = []
  const re = /<(?:w:)?t\b[^>]*>([\s\S]*?)<\/(?:w:)?t>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) {
    const t = (m[1] || "")
      .replace(/<[^>]+>/g, "")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .trim()
    if (t) wParts.push(t)
  }
  return wParts.length ? wParts.join(" ") : stripXmlText(xml)
}

export function extractDocx(buf: Buffer): ExtractResult {
  try {
    const entries = unzipAll(buf, {
      maxFiles: MAX_OOXML_FILES,
      maxTotalBytes: 20_000_000
    })
    if (!entries.length) {
      return {
        kind: "docx",
        text: "",
        truncated: false,
        error: "DOCX ZIP vide ou illisible"
      }
    }
    const want = (name: string) => {
      const n = name.replace(/\\/g, "/").replace(/^\/+/, "")
      return (
        n === "word/document.xml" ||
        n === "word/document2.xml" ||
        /^word\/header\d*\.xml$/i.test(n) ||
        /^word\/footer\d*\.xml$/i.test(n) ||
        n === "word/footnotes.xml" ||
        n === "word/endnotes.xml" ||
        n === "word/comments.xml"
      )
    }
    const ordered = [
      ...entries.filter(
        (e) =>
          e.name.replace(/\\/g, "/").replace(/^\/+/, "") === "word/document.xml"
      ),
      ...entries.filter(
        (e) =>
          e.name.replace(/\\/g, "/").replace(/^\/+/, "") !== "word/document.xml"
      )
    ]
    const parts: string[] = []
    let total = 0
    for (const e of ordered) {
      const path = e.name.replace(/\\/g, "/").replace(/^\/+/, "")
      if (!want(path)) continue
      const chunk = collectWt(entryText(e.data))
      if (chunk) {
        parts.push(chunk)
        total += chunk.length
      }
      if (total >= MAX_CHARS) break
    }
    const c = cap(parts.join("\n").trim(), total >= MAX_CHARS)
    if (!c.text) {
      return {
        kind: "docx",
        text: "",
        truncated: false,
        error: "DOCX sans texte extractible"
      }
    }
    return { kind: "docx", text: c.text, truncated: c.truncated }
  } catch (e) {
    return {
      kind: "docx",
      text: "",
      truncated: false,
      error: e instanceof Error ? e.message : "docx_error"
    }
  }
}

export function extractPptx(buf: Buffer): ExtractResult {
  try {
    const entries = unzipAll(buf, {
      maxFiles: MAX_OOXML_FILES,
      maxTotalBytes: 20_000_000
    })
    const parts: string[] = []
    let total = 0
    for (const e of entries) {
      const n = e.name.replace(/\\/g, "/").toLowerCase()
      if (!n.includes("ppt/slides/") && !n.includes("ppt/notesslides/")) continue
      if (!n.endsWith(".xml")) continue
      const xml = entryText(e.data)
      // a:t text runs
      const runs: string[] = []
      const re = /<(?:a:)?t\b[^>]*>([\s\S]*?)<\/(?:a:)?t>/g
      let m: RegExpExecArray | null
      while ((m = re.exec(xml)) !== null) {
        const t = (m[1] || "").replace(/<[^>]+>/g, "").trim()
        if (t) runs.push(t)
      }
      const chunk = runs.length ? runs.join(" ") : stripXmlText(xml)
      if (chunk) {
        parts.push(chunk)
        total += chunk.length
      }
      if (total >= MAX_CHARS) break
    }
    const c = cap(parts.join("\n").trim(), total >= MAX_CHARS)
    if (!c.text) {
      return {
        kind: "pptx",
        text: "",
        truncated: false,
        error: "PPTX sans texte extractible"
      }
    }
    return { kind: "pptx", text: c.text, truncated: c.truncated }
  } catch (e) {
    return {
      kind: "pptx",
      text: "",
      truncated: false,
      error: e instanceof Error ? e.message : "pptx_error"
    }
  }
}

export function extractXlsx(buf: Buffer): ExtractResult {
  try {
    const entries = unzipAll(buf, {
      maxFiles: MAX_OOXML_FILES,
      maxTotalBytes: 20_000_000
    })
    const byName = new Map(
      entries.map((e) => [e.name.replace(/\\/g, "/").replace(/^\/+/, ""), e])
    )
    const shared: string[] = []
    const ss = byName.get("xl/sharedStrings.xml")
    if (ss) {
      const xml = entryText(ss.data)
      const re = /<(?:t)\b[^>]*>([\s\S]*?)<\/t>/g
      let m: RegExpExecArray | null
      while ((m = re.exec(xml)) !== null) {
        const t = (m[1] || "")
          .replace(/<[^>]+>/g, "")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&amp;/g, "&")
          .trim()
        if (t) shared.push(t)
      }
    }
    const parts: string[] = [...shared]
    let total = shared.join(" ").length
    for (const e of entries) {
      const n = e.name.replace(/\\/g, "/").toLowerCase()
      if (!n.includes("xl/worksheets/") || !n.endsWith(".xml")) continue
      const xml = entryText(e.data)
      // inlineStr or v values (numbers/strings)
      const re = /<(?:v|t)\b[^>]*>([\s\S]*?)<\/(?:v|t)>/g
      let m: RegExpExecArray | null
      while ((m = re.exec(xml)) !== null) {
        const t = (m[1] || "").trim()
        if (t) {
          // shared string index
          if (/^\d+$/.test(t) && shared[Number(t)]) {
            parts.push(shared[Number(t)])
          } else {
            parts.push(t)
          }
          total += t.length
        }
        if (total >= MAX_CHARS) break
      }
      if (total >= MAX_CHARS) break
    }
    const c = cap(parts.join("\n").trim(), total >= MAX_CHARS)
    if (!c.text) {
      return {
        kind: "xlsx",
        text: "",
        truncated: false,
        error: "XLSX sans texte extractible"
      }
    }
    return { kind: "xlsx", text: c.text, truncated: c.truncated }
  } catch (e) {
    return {
      kind: "xlsx",
      text: "",
      truncated: false,
      error: e instanceof Error ? e.message : "xlsx_error"
    }
  }
}

export function extractPlainText(buf: Buffer): ExtractResult {
  // Strip BOM, try utf8 then latin1 if mostly binary
  // (SQLite magic est géré en amont dans extractContent)
  let text = buf.toString("utf8")
  if (text.includes("\uFFFD") && buf.length > 0) {
    // mixed binary — keep printable runs only
    const raw = buf.toString("latin1")
    const runs = raw.match(/[\x09\x0a\x0d\x20-\x7e\u00a0-\u00ff]{4,}/g) || []
    text = runs.join("\n")
  }
  text = text.replace(/^\uFEFF/, "")
  const c = cap(text.trim(), false)
  return {
    kind: "text",
    text: c.text,
    truncated: c.truncated || buf.length > MAX_CHARS
  }
}

export async function extractSqliteContent(buf: Buffer): Promise<ExtractResult> {
  const r = await extractSqlite(buf)
  if (!r.text.trim()) {
    return {
      kind: "sqlite",
      text: "",
      truncated: r.truncated,
      tableCount: r.tableCount,
      rowSamples: r.rowSamples,
      error: r.error || "SQLite sans contenu extractible"
    }
  }
  const c = cap(r.text, r.truncated)
  return {
    kind: "sqlite",
    text: c.text,
    truncated: c.truncated,
    tableCount: r.tableCount,
    rowSamples: r.rowSamples
  }
}

export function classifyName(
  filename: string,
  mime?: string
): "pdf" | "docx" | "pptx" | "xlsx" | "image" | "sqlite" | "text" {
  const name = (filename || "").toLowerCase()
  const m = (mime || "").toLowerCase()
  if (name.endsWith(".pdf") || m.includes("pdf")) return "pdf"
  if (name.endsWith(".docx") || m.includes("wordprocessingml")) return "docx"
  if (name.endsWith(".pptx") || m.includes("presentationml")) return "pptx"
  if (
    name.endsWith(".xlsx") ||
    name.endsWith(".xlsm") ||
    m.includes("spreadsheetml")
  )
    return "xlsx"
  if (
    /\.(png|jpe?g|gif|webp|bmp|tiff?)$/i.test(name) ||
    m.startsWith("image/")
  )
    return "image"
  if (
    /\.(db|sqlite|sqlite3|db3)$/i.test(name) ||
    m.includes("sqlite") ||
    m === "application/x-sqlite3" ||
    m === "application/vnd.sqlite3"
  )
    return "sqlite"
  return "text"
}

export async function extractContent(
  buf: Buffer,
  filename: string,
  mime?: string,
  opts?: { mode?: "full" | "mitm" }
): Promise<ExtractResult> {
  const mode = opts?.mode ?? "full"
  // Magic-first : un .bin SQLite reste scannable
  if (isSqliteBuffer(buf)) {
    // MITM : skip SQLite > 2 Mo (latence)
    if (mode === "mitm" && buf.length > 2_000_000) {
      return {
        kind: "sqlite",
        text: "",
        truncated: true,
        error: "SQLite trop grand pour deep scan MITM (>2 Mo)."
      }
    }
    return extractSqliteContent(buf)
  }
  const kind = classifyName(filename, mime)
  switch (kind) {
    case "pdf":
      return extractPdf(buf, { mode })
    case "docx":
      return extractDocx(buf)
    case "pptx":
      return extractPptx(buf)
    case "xlsx":
      return extractXlsx(buf)
    case "image":
      return extractImage(buf, { mode })
    case "sqlite":
      if (mode === "mitm" && buf.length > 2_000_000) {
        return {
          kind: "sqlite",
          text: "",
          truncated: true,
          error: "SQLite trop grand pour deep scan MITM (>2 Mo)."
        }
      }
      return extractSqliteContent(buf)
    default:
      return extractPlainText(buf)
  }
}
