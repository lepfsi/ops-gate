/**
 * Extraction de texte bureautique côté extension (content script).
 * DOCX/PPTX/XLSX : ZIP OOXML (zip-min) — import STATIQUE (pas de chunks Plasmo).
 * PDF : pdfjs-dist en import STATIQUE (ToUnicode / vrai texte, pas de suites de codes).
 * Mammoth retiré du chemin critique (import dynamique cassé en MV3).
 */
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist"
import { entryText, stripXmlText, unzipAll } from "./zip-min"

// Worker bundlé avec l’extension (évite import() dynamique → gTf5N)
try {
  // Plasmo/Parcel résout en URL d’asset
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-expect-error — URL d’asset pdf.worker
  const workerUrl = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url
  ).toString()
  GlobalWorkerOptions.workerSrc = workerUrl
} catch {
  /* worker optionnel — getDocument peut fallback */
}

/**
 * PDF côté extension : garanti ≤ 30 pages (Recommandations.md).
 * Au-delà → proxy local (scan lourd).
 */
export const MAX_PDF_PAGES_EXTENSION = 30
/** Proxy / scans lourds */
export const MAX_PDF_PAGES_PROXY = 80
const MAX_EXTRACT_CHARS = 1_200_000
const MAX_OOXML_FILES = 250
/** Timeout extraction extension (ms) — PDF/DOCX un peu plus long (scan + inflate) */
export const EXTRACT_TIMEOUT_MS = 10_000

function readAsArrayBuffer(file: File, maxBytes: number): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const blob = file.size > maxBytes ? file.slice(0, maxBytes) : file
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error ?? new Error("read failed"))
    reader.readAsArrayBuffer(blob)
  })
}

/**
 * DOCX robuste (priorité OOXML ZIP — fiable en content script MV3).
 * Fallback mammoth si dispo. Ne dépend plus uniquement de mammoth.browser
 * (souvent cassé après bundle Plasmo).
 */
export async function extractDocxText(
  file: File,
  maxBytes: number
): Promise<{ text: string; truncated: boolean; errorCode?: string }> {
  const sizeTruncated = file.size > maxBytes
  const buf = await readAsArrayBuffer(file, maxBytes)

  // ── 1) OOXML natif (word/document.xml + headers/footers) ──
  try {
    const ooxml = await extractDocxViaZip(buf, maxBytes)
    if (ooxml.text.trim()) {
      let text = ooxml.text.trim()
      let charTrunc = false
      if (text.length > MAX_EXTRACT_CHARS) {
        text = text.slice(0, MAX_EXTRACT_CHARS)
        charTrunc = true
      }
      return {
        text,
        truncated: sizeTruncated || charTrunc || ooxml.truncated
      }
    }
  } catch (e) {
    console.warn("[OpsGate] DOCX zip extract failed", file.name, e)
  }

  // ── 2) Dernier recours : strings lisibles dans le ZIP brut ──
  try {
    const raw = await extractDocxRawStrings(buf, maxBytes)
    if (raw.trim()) {
      return {
        text: raw.slice(0, MAX_EXTRACT_CHARS),
        truncated: sizeTruncated || raw.length > MAX_EXTRACT_CHARS,
        errorCode: "docx_partial_raw"
      }
    }
  } catch {
    /* ignore */
  }

  return {
    text: "",
    truncated: sizeTruncated,
    errorCode: "docx_extract_failed"
  }
}

/** Extraction DOCX via word/document.xml (+ headers/footers/notes) */
async function extractDocxViaZip(
  buf: ArrayBuffer,
  maxBytes: number
): Promise<{ text: string; truncated: boolean }> {
  const entries = await unzipAll(buf, {
    maxFiles: MAX_OOXML_FILES,
    maxTotalBytes: maxBytes
  })
  if (!entries.length) {
    throw new Error("docx_zip_empty")
  }

  const want = (name: string) => {
    const n = name.replace(/\\/g, "/").replace(/^\/+/, "")
    return (
      n === "word/document.xml" ||
      /^word\/header\d*\.xml$/i.test(n) ||
      /^word\/footer\d*\.xml$/i.test(n) ||
      n === "word/footnotes.xml" ||
      n === "word/endnotes.xml" ||
      n === "word/comments.xml" ||
      // certains exports
      n === "word/document2.xml"
    )
  }

  // document.xml en premier
  const ordered = [
    ...entries.filter(
      (e) => e.name.replace(/\\/g, "/").replace(/^\/+/, "") === "word/document.xml"
    ),
    ...entries.filter(
      (e) => e.name.replace(/\\/g, "/").replace(/^\/+/, "") !== "word/document.xml"
    )
  ]

  const parts: string[] = []
  let total = 0
  let foundDoc = false
  for (const e of ordered) {
    const path = e.name.replace(/\\/g, "/").replace(/^\/+/, "")
    if (!want(path)) continue
    if (path === "word/document.xml") foundDoc = true
    const xml = entryText(e.data)
    // Préférer w:t explicite
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
    const chunk = wParts.length ? wParts.join(" ") : stripXmlText(xml)
    if (chunk) {
      parts.push(chunk)
      total += chunk.length
    }
    if (total >= MAX_EXTRACT_CHARS) {
      return {
        text: parts.join("\n").slice(0, MAX_EXTRACT_CHARS),
        truncated: true
      }
    }
  }

  if (!foundDoc && !parts.length) {
    throw new Error("docx_no_document_xml")
  }
  return {
    text: parts.join("\n").trim(),
    truncated: entries.length >= MAX_OOXML_FILES
  }
}

/** Dernier recours : chaînes UTF-8 imprimables dans les entrées XML du ZIP */
async function extractDocxRawStrings(
  buf: ArrayBuffer,
  maxBytes: number
): Promise<string> {
  const entries = await unzipAll(buf, {
    maxFiles: 80,
    maxTotalBytes: maxBytes
  })
  const chunks: string[] = []
  for (const e of entries) {
    const n = e.name.replace(/\\/g, "/").toLowerCase()
    if (!n.includes("word/") || !n.endsWith(".xml")) continue
    const xml = entryText(e.data)
    const re = />([^<>]{4,200})</g
    let m: RegExpExecArray | null
    while ((m = re.exec(xml)) !== null) {
      const t = (m[1] || "").trim()
      if (t && /[A-Za-z0-9@._\-]{3,}/.test(t) && !t.startsWith("http")) {
        chunks.push(t)
      }
    }
    if (chunks.join(" ").length > MAX_EXTRACT_CHARS) break
  }
  return chunks.join(" ").trim()
}

/**
 * PDF via pdfjs-dist (import statique) — décodage ToUnicode correct.
 * Plus de suites de codes numériques type « 12 0 45 0 67 » (mauvais parse binaire).
 */
export async function extractPdfText(
  file: File,
  maxBytes: number,
  opts?: { maxPages?: number; timeoutMs?: number }
): Promise<{
  text: string
  truncated: boolean
  pageCount?: number
  errorCode?: string
}> {
  const maxPages = opts?.maxPages ?? MAX_PDF_PAGES_EXTENSION
  const timeoutMs = opts?.timeoutMs ?? EXTRACT_TIMEOUT_MS
  const sizeTruncated = file.size > maxBytes

  const run = async () => {
    const buf = await readAsArrayBuffer(file, maxBytes)
    const data = new Uint8Array(buf)

    // Estimation rapide du nombre de pages (avant pdfjs)
    const rawHead = new TextDecoder("latin1").decode(
      data.subarray(0, Math.min(data.length, 2_000_000))
    )
    const pageHits = (rawHead.match(/\/Type\s*\/Page[^s]/g) || []).length
    if (pageHits > maxPages) {
      return {
        text: "",
        truncated: true,
        pageCount: pageHits,
        errorCode: "pdf_too_many_pages"
      }
    }

    // ── Chemin principal : pdfjs (vrai texte Unicode) ──
    try {
      const loadingTask = getDocument({
        data,
        useSystemFonts: true,
        isEvalSupported: false,
        disableFontFace: true,
        // Pas de fetch réseau pour polices externes
        useWorkerFetch: false,
        verbosity: 0
      })
      const doc = await loadingTask.promise
      const pageCount = doc.numPages
      if (pageCount > maxPages) {
        try {
          await doc.destroy()
        } catch {
          /* ignore */
        }
        return {
          text: "",
          truncated: true,
          pageCount,
          errorCode: "pdf_too_many_pages"
        }
      }

      const parts: string[] = []
      let total = 0
      let charTruncated = false
      const limit = Math.min(pageCount, maxPages)

      for (let i = 1; i <= limit; i++) {
        const page = await doc.getPage(i)
        const content = await page.getTextContent({
          // includeMarkedContent: false
        })
        // Construire le texte avec espaces raisonnables
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
          if (
            lastY != null &&
            y != null &&
            Math.abs(lastY - y) > 4 &&
            line.trim()
          ) {
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
        if (total >= MAX_EXTRACT_CHARS) {
          charTruncated = true
          break
        }
      }

      try {
        await doc.destroy()
      } catch {
        /* ignore */
      }

      let text = parts.join("\n").replace(/[ \t]+/g, " ").trim()
      // Nettoyage léger artefacts pdfjs
      text = text
        .replace(/\u0000/g, "")
        .replace(/[\uFFFD]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim()

      if (text.length > MAX_EXTRACT_CHARS) {
        text = text.slice(0, MAX_EXTRACT_CHARS)
        charTruncated = true
      }

      if (!isUsefulExtractedText(text) || isMostlyNumericGarbage(text)) {
        return {
          text: "",
          truncated: sizeTruncated,
          pageCount,
          errorCode: "pdf_no_text"
        }
      }

      console.log(
        "[OpsGate] PDF pdfjs OK",
        file.name,
        `pages=${pageCount}`,
        `chars=${text.length}`
      )
      return {
        text,
        truncated: sizeTruncated || charTruncated,
        pageCount
      }
    } catch (e) {
      console.warn(
        "[OpsGate] PDF pdfjs failed, fallback heuristique filtré",
        file.name,
        e
      )
    }

    // ── Fallback : littéraux uniquement (PAS les streams bruts décodés en latin1) ──
    // Les streams FlateDecode mal interprétés produisent des suites de chiffres.
    const lit = extractPdfLiteralStrings(rawHead)
    let text = lit.join(" ").replace(/\s+/g, " ").trim()
    if (text.length > MAX_EXTRACT_CHARS) {
      text = text.slice(0, MAX_EXTRACT_CHARS)
    }
    if (!isUsefulExtractedText(text) || isMostlyNumericGarbage(text)) {
      return {
        text: "",
        truncated: sizeTruncated,
        pageCount: pageHits || 1,
        errorCode: "pdf_no_text"
      }
    }
    return {
      text,
      truncated: sizeTruncated,
      pageCount: pageHits || 1
    }
  }

  try {
    const result = await Promise.race([
      run(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("extract_timeout")), timeoutMs)
      )
    ])
    return result
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg === "extract_timeout") {
      return { text: "", truncated: true, errorCode: "timeout" }
    }
    console.warn("[OpsGate] PDF extract failed", file.name, msg)
    return { text: "", truncated: true, errorCode: "extract_failed" }
  }
}

/** Texte assez « humain » pour un vrai scan (évite bruit de polices PDF) */
function isUsefulExtractedText(t: string): boolean {
  if (!t || t.length < 16) return false
  const words = (t.match(/[A-Za-zÀ-ÿ]{2,}/g) || []).length
  return words >= 3
}

/**
 * Détecte le symptôme « suites de nombres » (CID / binary mal lu).
 * Ex. : "12 0 14 0 56 0 78 101 108…"
 */
function isMostlyNumericGarbage(t: string): boolean {
  if (!t) return true
  const digits = (t.match(/\d/g) || []).length
  if (digits / t.length > 0.42) return true
  const numTokens = (t.match(/\b\d{1,5}\b/g) || []).length
  const alphaWords = (t.match(/[A-Za-zÀ-ÿ]{3,}/g) || []).length
  if (numTokens > 40 && numTokens > alphaWords * 4) return true
  // Trop de paires "digit space digit"
  const pairs = (t.match(/\d+\s+\d+/g) || []).length
  if (pairs > 30 && alphaWords < 8) return true
  return false
}

function decodePdfLiteral(s: string): string {
  return s
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "")
    .replace(/\\t/g, "\t")
    .replace(/\\\(/g, "(")
    .replace(/\\\)/g, ")")
    .replace(/\\\\/g, "\\")
    .replace(/\\(\d{1,3})/g, (_, oct) =>
      String.fromCharCode(parseInt(oct, 8) & 0xff)
    )
}

function extractPdfLiteralStrings(raw: string): string[] {
  const parts: string[] = []
  const re = /\(((?:\\.|[^\\)]){3,400})\)/g
  let m: RegExpExecArray | null
  let n = 0
  while ((m = re.exec(raw)) !== null && n < 15000) {
    const s = decodePdfLiteral(m[1] || "").trim()
    // Garder seulement du texte lisible (pas des codes bruts)
    if (
      s.length >= 3 &&
      /[A-Za-zÀ-ÿ]{2,}/.test(s) &&
      !isMostlyNumericGarbage(s)
    ) {
      parts.push(s)
    }
    n++
  }
  return parts
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
): Promise<{
  text: string
  truncated: boolean
  kind: OfficeExtractKind
  pageCount?: number
  errorCode?: string
} | null> {
  const kind = officeExtractKind(file.name, file.type)
  if (kind === "unsupported") return null
  try {
    if (kind === "pdf") {
      const r = await extractPdfText(file, maxBytes)
      return { ...r, kind }
    }
    if (kind === "docx") {
      const r = await extractDocxText(file, maxBytes)
      // Propager errorCode même si text vide (messages UI précis)
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
