/**
 * T5 — Mask / Secure Rewrite en préservant le format OOXML
 * (DOCX / PPTX / XLSX). PDF / images / SQLite → non supporté (fallback .txt).
 */
import {
  detectSensitiveData,
  maskSensitiveData,
  secureRewrite,
  type Detection,
  type DetectionRule,
  type RewriteChange
} from "@opsgate/engine"
import { unzipAll } from "./zip-min"
import { createZipStore } from "./zip-store"

export type FormatPreserveKind = "docx" | "pptx" | "xlsx"

export type FormatPreserveResult =
  | {
      ok: true
      blob: Blob
      fileName: string
      mime: string
      kind: FormatPreserveKind
      changed: boolean
    }
  | { ok: false; reason: string; fallbackTxt: true }

const MIME: Record<FormatPreserveKind, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
}

const MAX_BYTES = 20_000_000

function extensionOf(name: string): string {
  const i = name.toLowerCase().lastIndexOf(".")
  return i >= 0 ? name.toLowerCase().slice(i + 1) : ""
}

export function formatPreserveKind(
  fileName: string
): FormatPreserveKind | null {
  const ext = extensionOf(fileName)
  if (ext === "docx") return "docx"
  if (ext === "pptx") return "pptx"
  if (ext === "xlsx" || ext === "xlsm") return "xlsx"
  return null
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

function decodeXmlEntities(t: string): string {
  return t
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      const c = Number(n)
      return Number.isFinite(c) ? String.fromCharCode(c) : ""
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => {
      const c = parseInt(h, 16)
      return Number.isFinite(c) ? String.fromCharCode(c) : ""
    })
}

function applyLiteralChanges(text: string, changes: RewriteChange[]): string {
  if (!changes.length) return text
  let out = text
  const sorted = [...changes].sort(
    (a, b) => b.original.length - a.original.length
  )
  for (const c of sorted) {
    if (!c.original || c.original === c.replacement) continue
    if (!out.includes(c.original)) continue
    // split/join évite les regex sur secrets
    out = out.split(c.original).join(c.replacement)
  }
  return out
}

/**
 * Masque le contenu des balises texte OOXML (w:t, a:t, t).
 */
export function maskOoxmlXml(
  xml: string,
  transform: (plain: string) => string
): { xml: string; changed: boolean } {
  let changed = false
  // Word w:t · DrawingML a:t · sharedStrings/cell t
  const re =
    /(<(?:[a-zA-Z0-9]+:)?(?:t)\b[^>]*>)([\s\S]*?)(<\/(?:[a-zA-Z0-9]+:)?t>)/g
  const out = xml.replace(re, (_full, open: string, content: string, close: string) => {
    // Contenu avec sous-balises (rare) : ne pas toucher
    if (/</.test(content)) return `${open}${content}${close}`
    const plain = decodeXmlEntities(content)
    if (!plain) return `${open}${content}${close}`
    const next = transform(plain)
    if (next === plain) return `${open}${content}${close}`
    changed = true
    return `${open}${escapeXml(next)}${close}`
  })
  return { xml: out, changed }
}

function shouldTouchPath(kind: FormatPreserveKind, path: string): boolean {
  const n = path.replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase()
  if (kind === "docx") {
    return (
      n === "word/document.xml" ||
      n === "word/document2.xml" ||
      /^word\/header\d*\.xml$/.test(n) ||
      /^word\/footer\d*\.xml$/.test(n) ||
      n === "word/footnotes.xml" ||
      n === "word/endnotes.xml" ||
      n === "word/comments.xml"
    )
  }
  if (kind === "pptx") {
    return (
      n.startsWith("ppt/slides/") ||
      n.startsWith("ppt/notesSlides/".toLowerCase()) ||
      n.startsWith("ppt/notesslides/")
    ) && n.endsWith(".xml")
  }
  // xlsx
  return (
    n === "xl/sharedstrings.xml" ||
    (n.startsWith("xl/worksheets/") && n.endsWith(".xml"))
  )
}

function outName(original: string, kind: "masked" | "secure"): string {
  const base = original.replace(/\.[^.]+$/, "") || original
  const ext = extensionOf(original) || "docx"
  return `${base}.opsgate-${kind}.${ext === "xlsm" ? "xlsx" : ext}`
}

/**
 * Produit un fichier Office masqué en gardant l’extension OOXML.
 */
export async function maskOfficePreserveFormat(
  file: File,
  opts: {
    mode: "mask" | "secure_rewrite"
    rules?: DetectionRule[] | null
    /** Detections déjà connues (scan) — optionnel */
    detections?: Detection[]
  }
): Promise<FormatPreserveResult> {
  const kind = formatPreserveKind(file.name)
  if (!kind) {
    return {
      ok: false,
      reason: "format_not_supported",
      fallbackTxt: true
    }
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, reason: "file_too_large", fallbackTxt: true }
  }

  try {
    const ab = await file.arrayBuffer()
    const entries = await unzipAll(ab, {
      maxFiles: 300,
      maxTotalBytes: MAX_BYTES
    })
    if (!entries.length) {
      return { ok: false, reason: "zip_empty", fallbackTxt: true }
    }

    // Mapping Secure Rewrite : calculé une fois sur tout le texte extrait des XML ciblés
    let changes: RewriteChange[] = []
    if (opts.mode === "secure_rewrite") {
      const parts: string[] = []
      for (const e of entries) {
        const path = e.name.replace(/\\/g, "/")
        if (!shouldTouchPath(kind, path)) continue
        const xml = new TextDecoder("utf-8", { fatal: false }).decode(e.data)
        // collect plain runs
        const re =
          /<(?:[a-zA-Z0-9]+:)?t\b[^>]*>([\s\S]*?)<\/(?:[a-zA-Z0-9]+:)?t>/g
        let m: RegExpExecArray | null
        while ((m = re.exec(xml)) !== null) {
          if (m[1] && !/</.test(m[1])) {
            const t = decodeXmlEntities(m[1]).trim()
            if (t) parts.push(t)
          }
        }
      }
      const full = parts.join("\n")
      const dets =
        opts.detections?.length
          ? opts.detections
          : detectSensitiveData(full, opts.rules)
      if (dets.length) {
        changes = secureRewrite(full, dets, {
          consistentMapping: true,
          aggressiveness: 2
        }).changes
      }
    }

    const transform = (plain: string): string => {
      if (opts.mode === "secure_rewrite" && changes.length) {
        return applyLiteralChanges(plain, changes)
      }
      const dets = detectSensitiveData(plain, opts.rules)
      if (!dets.length) return plain
      return maskSensitiveData(plain, dets, opts.rules)
    }

    let anyChanged = false
    const outEntries: Array<{ name: string; data: Uint8Array }> = []

    for (const e of entries) {
      const path = e.name.replace(/\\/g, "/")
      if (!shouldTouchPath(kind, path)) {
        outEntries.push({ name: path, data: e.data })
        continue
      }
      const xml = new TextDecoder("utf-8", { fatal: false }).decode(e.data)
      const { xml: next, changed } = maskOoxmlXml(xml, transform)
      if (changed) anyChanged = true
      outEntries.push({
        name: path,
        data: new TextEncoder().encode(next)
      })
    }

    if (!anyChanged) {
      // Rien modifié dans les XML — fallback txt pour ne pas renvoyer l’original sensible
      return {
        ok: false,
        reason: "no_xml_text_changed",
        fallbackTxt: true
      }
    }

    const zip = createZipStore(outEntries)
    const label = opts.mode === "secure_rewrite" ? "secure" : "masked"
    const fileName = outName(file.name, label)
    return {
      ok: true,
      blob: new Blob([zip], { type: MIME[kind] }),
      fileName,
      mime: MIME[kind],
      kind,
      changed: true
    }
  } catch (e) {
    return {
      ok: false,
      reason: e instanceof Error ? e.message : "office_mask_failed",
      fallbackTxt: true
    }
  }
}

export function isFormatPreserveSupported(fileName: string): boolean {
  return formatPreserveKind(fileName) != null
}
