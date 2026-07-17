/**
 * Extraction de texte bureautique côté extension (content script).
 * PDF : pdfjs-dist · DOCX : mammoth · PPTX/XLSX : ZIP OOXML minimal
 * Échec → null (le scanner bascule en warn).
 */

/** PDF multi-pages : jusqu’à 120 pages (docs longs clients) */
const MAX_PDF_PAGES = 120
const MAX_EXTRACT_CHARS = 1_200_000
const MAX_OOXML_FILES = 250

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
 * PDF via pdfjs-dist v4 - worker URL résolu via import.meta.url.
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

export type OfficeExtractKind =
  | "pdf"
  | "docx"
  | "pptx"
  | "xlsx"
  | "unsupported"

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
  if (
    lower.endsWith(".pptx") ||
    mime?.includes("presentationml") ||
    mime?.includes("officedocument.presentationml")
  ) {
    return "pptx"
  }
  if (
    lower.endsWith(".xlsx") ||
    lower.endsWith(".xlsm") ||
    mime?.includes("spreadsheetml") ||
    mime?.includes("officedocument.spreadsheetml")
  ) {
    return "xlsx"
  }
  return "unsupported"
}

/** PPTX / XLSX : OOXML (ZIP + XML) */
export async function extractOoxmlZipText(
  file: File,
  maxBytes: number,
  kind: "pptx" | "xlsx"
): Promise<{ text: string; truncated: boolean }> {
  const sizeTruncated = file.size > maxBytes
  const buf = await readAsArrayBuffer(file, maxBytes)
  const { unzipAll, entryText, stripXmlText } = await import("./zip-min")
  const entries = await unzipAll(buf, {
    maxFiles: MAX_OOXML_FILES,
    maxTotalBytes: maxBytes
  })
  const parts: string[] = []
  let total = 0
  let charTruncated = false

  const want = (name: string) => {
    const n = name.replace(/\\/g, "/")
    if (kind === "pptx") {
      return (
        /^ppt\/slides\/slide\d+\.xml$/i.test(n) ||
        /^ppt\/notesSlides\/notesSlide\d+\.xml$/i.test(n) ||
        n === "ppt/presentation.xml"
      )
    }
    // xlsx : shared strings + feuilles
    return (
      n === "xl/sharedStrings.xml" ||
      /^xl\/worksheets\/sheet\d+\.xml$/i.test(n) ||
      n === "xl/workbook.xml"
    )
  }

  // sharedStrings d’abord pour XLSX
  const ordered =
    kind === "xlsx"
      ? [
          ...entries.filter((e) => e.name.replace(/\\/g, "/") === "xl/sharedStrings.xml"),
          ...entries.filter((e) => e.name.replace(/\\/g, "/") !== "xl/sharedStrings.xml")
        ]
      : entries

  let shared: string[] = []
  for (const e of ordered) {
    const path = e.name.replace(/\\/g, "/")
    if (!want(path)) continue
    const xml = entryText(e.data)
    if (path === "xl/sharedStrings.xml") {
      // <si><t>…</t></si>
      const re = /<t[^>]*>([^<]*)<\/t>/g
      let m: RegExpExecArray | null
      while ((m = re.exec(xml)) !== null) {
        shared.push(
          (m[1] || "")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&amp;/g, "&")
        )
      }
      if (shared.length) {
        const joined = shared.join(" ")
        parts.push(joined)
        total += joined.length
      }
      continue
    }
    // Cellules XLSX avec index shared string
    if (kind === "xlsx" && /^xl\/worksheets\//i.test(path) && shared.length) {
      const cellRe = /<c\b([^>]*)>(?:[\s\S]*?<v>([^<]*)<\/v>)?/g
      let cm: RegExpExecArray | null
      const cellTexts: string[] = []
      while ((cm = cellRe.exec(xml)) !== null) {
        const attrs = cm[1] || ""
        const v = cm[2]
        if (/\bt="s"/.test(attrs) && v != null) {
          const idx = Number(v)
          if (Number.isFinite(idx) && shared[idx]) cellTexts.push(shared[idx]!)
        } else if (v != null && v.trim()) {
          cellTexts.push(v.trim())
        }
      }
      // Aussi inline strings
      const isRe = /<is>[\s\S]*?<t[^>]*>([^<]*)<\/t>/g
      let im: RegExpExecArray | null
      while ((im = isRe.exec(xml)) !== null) {
        if (im[1]?.trim()) cellTexts.push(im[1].trim())
      }
      if (cellTexts.length) {
        const j = cellTexts.join(" ")
        parts.push(j)
        total += j.length
      } else {
        const t = stripXmlText(xml)
        if (t) {
          parts.push(t)
          total += t.length
        }
      }
    } else {
      const t = stripXmlText(xml)
      if (t) {
        parts.push(t)
        total += t.length
      }
    }
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
  return {
    text,
    truncated: sizeTruncated || charTruncated || entries.length >= MAX_OOXML_FILES
  }
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
    if (kind === "docx") {
      const r = await extractDocxText(file, maxBytes)
      return { ...r, kind }
    }
    if (kind === "pptx" || kind === "xlsx") {
      const r = await extractOoxmlZipText(file, maxBytes, kind)
      return { ...r, kind }
    }
    return null
  } catch (e) {
    console.warn("[OpsGate] office extract failed", file.name, e)
    return null
  }
}
