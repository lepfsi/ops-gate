/**
 * T5 — Mask OOXML (DOCX/PPTX/XLSX) en préservant le format — côté proxy.
 * POST /opsgate-proxy/mask-file
 */
import {
  detectSensitiveData,
  maskSensitiveData,
  secureRewrite,
  type Detection,
  type RewriteChange
} from "@opsgate/engine"
import { inflateRawSync } from "node:zlib"
import { log } from "./log.js"

export type MaskFileResult = {
  status: "ok" | "fallback_txt" | "failed"
  /** base64 du fichier de sortie */
  content_base64?: string
  filename?: string
  mime?: string
  kind?: string
  changed?: boolean
  text?: string
  error?: string
}

const MAX_BYTES = 20_000_000

function extensionOf(name: string): string {
  const i = name.toLowerCase().lastIndexOf(".")
  return i >= 0 ? name.toLowerCase().slice(i + 1) : ""
}

function kindOf(name: string): "docx" | "pptx" | "xlsx" | null {
  const e = extensionOf(name)
  if (e === "docx") return "docx"
  if (e === "pptx") return "pptx"
  if (e === "xlsx" || e === "xlsm") return "xlsx"
  return null
}

const MIME = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
} as const

// ── minimal ZIP read (store + deflate) ──
type ZipEntry = { name: string; data: Buffer }

function u16(b: Buffer, o: number) {
  return b.readUInt16LE(o)
}
function u32(b: Buffer, o: number) {
  return b.readUInt32LE(o)
}

function findEocd(buf: Buffer): number {
  const min = Math.max(0, buf.length - 22 - 0xffff)
  for (let i = buf.length - 22; i >= min; i--) {
    if (u32(buf, i) === 0x06054b50) return i
  }
  return -1
}

function unzip(buf: Buffer): ZipEntry[] {
  const eocd = findEocd(buf)
  if (eocd < 0) return []
  const cdOffset = u32(buf, eocd + 16)
  const cdCount = u16(buf, eocd + 10)
  const out: ZipEntry[] = []
  let pos = cdOffset
  for (let n = 0; n < cdCount && out.length < 300; n++) {
    if (pos + 46 > buf.length || u32(buf, pos) !== 0x02014b50) break
    const method = u16(buf, pos + 10)
    let compSize = u32(buf, pos + 20)
    const nameLen = u16(buf, pos + 28)
    const extraLen = u16(buf, pos + 30)
    const commentLen = u16(buf, pos + 32)
    const localOff = u32(buf, pos + 42)
    const name = buf.subarray(pos + 46, pos + 46 + nameLen).toString("utf8")
    pos += 46 + nameLen + extraLen + commentLen
    if (name.endsWith("/")) continue
    if (localOff + 30 > buf.length || u32(buf, localOff) !== 0x04034b50) continue
    const lMethod = u16(buf, localOff + 8)
    let lComp = u32(buf, localOff + 18)
    const lNameLen = u16(buf, localOff + 26)
    const lExtraLen = u16(buf, localOff + 28)
    const dataStart = localOff + 30 + lNameLen + lExtraLen
    if (lComp === 0 && compSize > 0) lComp = compSize
    if (dataStart + lComp > buf.length) continue
    const comp = buf.subarray(dataStart, dataStart + lComp)
    const m = lMethod || method
    try {
      let data: Buffer
      if (m === 0) data = Buffer.from(comp)
      else if (m === 8) data = inflateRawSync(comp)
      else continue
      out.push({ name: name.replace(/\\/g, "/"), data })
    } catch {
      /* skip */
    }
  }
  return out
}

// ── ZIP store write ──
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[i] = c >>> 0
  }
  return t
})()

function crc32(data: Buffer): number {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) {
    c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

function zipStore(entries: ZipEntry[]): Buffer {
  const parts: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8")
    const crc = crc32(e.data)
    const local = Buffer.alloc(30 + name.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x800, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(e.data.length, 18)
    local.writeUInt32LE(e.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    name.copy(local, 30)
    parts.push(local, e.data)
    const cd = Buffer.alloc(46 + name.length)
    cd.writeUInt32LE(0x02014b50, 0)
    cd.writeUInt16LE(20, 4)
    cd.writeUInt16LE(20, 6)
    cd.writeUInt16LE(0x800, 8)
    cd.writeUInt32LE(crc, 16)
    cd.writeUInt32LE(e.data.length, 20)
    cd.writeUInt32LE(e.data.length, 24)
    cd.writeUInt16LE(name.length, 28)
    cd.writeUInt32LE(offset, 42)
    name.copy(cd, 46)
    central.push(cd)
    offset += local.length + e.data.length
  }
  const cdBuf = Buffer.concat(central)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(cdBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...parts, cdBuf, eocd])
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

function decodeXml(t: string): string {
  return t
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

function applyChanges(text: string, changes: RewriteChange[]): string {
  let out = text
  const sorted = [...changes].sort(
    (a, b) => b.original.length - a.original.length
  )
  for (const c of sorted) {
    if (c.original && out.includes(c.original)) {
      out = out.split(c.original).join(c.replacement)
    }
  }
  return out
}

function maskXml(xml: string, transform: (s: string) => string): {
  xml: string
  changed: boolean
} {
  let changed = false
  const re =
    /(<(?:[a-zA-Z0-9]+:)?(?:t)\b[^>]*>)([\s\S]*?)(<\/(?:[a-zA-Z0-9]+:)?t>)/g
  const next = xml.replace(
    re,
    (_f, open: string, content: string, close: string) => {
      if (/</.test(content)) return `${open}${content}${close}`
      const plain = decodeXml(content)
      if (!plain) return `${open}${content}${close}`
      const m = transform(plain)
      if (m === plain) return `${open}${content}${close}`
      changed = true
      return `${open}${escapeXml(m)}${close}`
    }
  )
  return { xml: next, changed }
}

function shouldTouch(kind: string, path: string): boolean {
  const n = path.replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase()
  if (kind === "docx") {
    return (
      n === "word/document.xml" ||
      /^word\/header\d*\.xml$/.test(n) ||
      /^word\/footer\d*\.xml$/.test(n) ||
      n === "word/footnotes.xml" ||
      n === "word/comments.xml"
    )
  }
  if (kind === "pptx") {
    return (
      (n.startsWith("ppt/slides/") || n.startsWith("ppt/notesslides/")) &&
      n.endsWith(".xml")
    )
  }
  return (
    n === "xl/sharedstrings.xml" ||
    (n.startsWith("xl/worksheets/") && n.endsWith(".xml"))
  )
}

export function maskFilePayload(input: {
  filename: string
  mime?: string
  content_base64: string
  mode?: "mask" | "secure_rewrite"
}): MaskFileResult {
  try {
    const kind = kindOf(input.filename)
    if (!kind) {
      return {
        status: "fallback_txt",
        error: "format_not_supported_use_txt",
        kind: extensionOf(input.filename) || "unknown"
      }
    }
    if (!input.content_base64 || input.content_base64.length < 8) {
      return { status: "failed", error: "content_base64 manquant" }
    }
    if (input.content_base64.length > 35_000_000) {
      return { status: "failed", error: "payload_too_large" }
    }
    const buf = Buffer.from(input.content_base64.replace(/\s/g, ""), "base64")
    if (buf.length > MAX_BYTES) {
      return { status: "failed", error: "file_too_large" }
    }

    const entries = unzip(buf)
    if (!entries.length) {
      return { status: "fallback_txt", error: "zip_empty" }
    }

    const mode = input.mode === "secure_rewrite" ? "secure_rewrite" : "mask"
    let changes: RewriteChange[] = []
    if (mode === "secure_rewrite") {
      const parts: string[] = []
      for (const e of entries) {
        if (!shouldTouch(kind, e.name)) continue
        const xml = e.data.toString("utf8")
        const re =
          /<(?:[a-zA-Z0-9]+:)?t\b[^>]*>([\s\S]*?)<\/(?:[a-zA-Z0-9]+:)?t>/g
        let m: RegExpExecArray | null
        while ((m = re.exec(xml)) !== null) {
          if (m[1] && !/</.test(m[1])) {
            const t = decodeXml(m[1]).trim()
            if (t) parts.push(t)
          }
        }
      }
      const full = parts.join("\n")
      const dets = detectSensitiveData(full)
      if (dets.length) {
        changes = secureRewrite(full, dets, {
          consistentMapping: true,
          aggressiveness: 2
        }).changes
      }
    }

    const transform = (plain: string) => {
      if (mode === "secure_rewrite" && changes.length) {
        return applyChanges(plain, changes)
      }
      const dets = detectSensitiveData(plain)
      if (!dets.length) return plain
      return maskSensitiveData(plain, dets)
    }

    let any = false
    const out: ZipEntry[] = []
    for (const e of entries) {
      if (!shouldTouch(kind, e.name)) {
        out.push(e)
        continue
      }
      const { xml, changed } = maskXml(e.data.toString("utf8"), transform)
      if (changed) any = true
      out.push({ name: e.name, data: Buffer.from(xml, "utf8") })
    }

    if (!any) {
      // fallback : texte extrait masqué
      const textParts: string[] = []
      for (const e of entries) {
        if (!shouldTouch(kind, e.name)) continue
        const xml = e.data.toString("utf8")
        const re =
          /<(?:[a-zA-Z0-9]+:)?t\b[^>]*>([\s\S]*?)<\/(?:[a-zA-Z0-9]+:)?t>/g
        let m: RegExpExecArray | null
        while ((m = re.exec(xml)) !== null) {
          if (m[1] && !/</.test(m[1])) {
            const t = decodeXml(m[1]).trim()
            if (t) textParts.push(transform(t))
          }
        }
      }
      const text = textParts.join("\n")
      return {
        status: "fallback_txt",
        text,
        filename: `${input.filename.replace(/\.[^.]+$/, "")}.opsgate-${mode === "secure_rewrite" ? "secure" : "masked"}.txt`,
        mime: "text/plain;charset=utf-8",
        kind,
        error: "no_xml_text_changed"
      }
    }

    const zip = zipStore(out)
    const label = mode === "secure_rewrite" ? "secure" : "masked"
    const ext = kind === "xlsx" ? "xlsx" : kind
    const filename = `${input.filename.replace(/\.[^.]+$/, "")}.opsgate-${label}.${ext}`
    log("info", "mask_file_ok", {
      filename: input.filename,
      kind,
      mode,
      out_bytes: zip.length
    })
    return {
      status: "ok",
      content_base64: zip.toString("base64"),
      filename,
      mime: MIME[kind],
      kind,
      changed: true
    }
  } catch (e) {
    return {
      status: "failed",
      error: e instanceof Error ? e.message : String(e)
    }
  }
}

// silence unused Detection import if tree-shaken poorly
void (null as unknown as Detection)
