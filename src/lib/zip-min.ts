/**
 * Lecteur ZIP robuste pour OOXML (DOCX/PPTX/XLSX) dans l’extension.
 * - Parse via **central directory** (fiable)
 * - Supporte data descriptors (bit 3) fréquents dans les .docx Word/LibreOffice
 * - deflate-raw via DecompressionStream (Chrome/Edge/Firefox)
 */

export type ZipEntry = { name: string; data: Uint8Array }

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("deflate_unsupported")
  }
  const ds = new DecompressionStream("deflate-raw")
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(ds)
  const ab = await new Response(stream).arrayBuffer()
  return new Uint8Array(ab)
}

function u16(v: DataView, o: number) {
  return v.getUint16(o, true)
}
function u32(v: DataView, o: number) {
  return v.getUint32(o, true)
}

function decodeName(bytes: Uint8Array, utf8Flag: boolean): string {
  try {
    return new TextDecoder(utf8Flag ? "utf-8" : "utf-8", {
      fatal: false
    }).decode(bytes)
  } catch {
    return String.fromCharCode(...bytes)
  }
}

/** Trouve la fin du central directory (EOCD) */
function findEocd(view: DataView): number {
  const len = view.byteLength
  // EOCD min 22 bytes ; comment max 64k → scan depuis la fin
  const min = Math.max(0, len - 22 - 0xffff)
  for (let i = len - 22; i >= min; i--) {
    if (u32(view, i) === 0x06054b50) return i
  }
  return -1
}

/**
 * Liste les entrées d’un ZIP (noms UTF-8 best-effort).
 * Préfère le central directory ; fallback local headers.
 */
export async function unzipAll(
  buf: ArrayBuffer,
  opts?: { maxFiles?: number; maxTotalBytes?: number }
): Promise<ZipEntry[]> {
  const maxFiles = opts?.maxFiles ?? 200
  const maxTotal = opts?.maxTotalBytes ?? 12_000_000
  const view = new DataView(buf)
  const u8 = new Uint8Array(buf)

  // ── Chemin A : central directory ──
  const eocd = findEocd(view)
  if (eocd >= 0) {
    const cdOffset = u32(view, eocd + 16)
    const cdCount = u16(view, eocd + 10)
    const out: ZipEntry[] = []
    let total = 0
    let pos = cdOffset

    for (let n = 0; n < cdCount && out.length < maxFiles; n++) {
      if (pos + 46 > view.byteLength) break
      if (u32(view, pos) !== 0x02014b50) break // central file header
      const flags = u16(view, pos + 8)
      const method = u16(view, pos + 10)
      let compSize = u32(view, pos + 20)
      let uncompSize = u32(view, pos + 24)
      const nameLen = u16(view, pos + 28)
      const extraLen = u16(view, pos + 30)
      const commentLen = u16(view, pos + 32)
      const localOff = u32(view, pos + 42)
      const nameBytes = u8.subarray(pos + 46, pos + 46 + nameLen)
      const utf8 = !!(flags & 0x800)
      const name = decodeName(nameBytes, utf8)
      pos += 46 + nameLen + extraLen + commentLen

      if (name.endsWith("/")) continue
      if (uncompSize === 0 && compSize === 0) continue
      if (total + Math.max(uncompSize, compSize) > maxTotal) continue

      // Local header
      if (localOff + 30 > view.byteLength) continue
      if (u32(view, localOff) !== 0x04034b50) continue
      const lFlags = u16(view, localOff + 6)
      const lMethod = u16(view, localOff + 8)
      let lComp = u32(view, localOff + 18)
      let lUncomp = u32(view, localOff + 22)
      const lNameLen = u16(view, localOff + 26)
      const lExtraLen = u16(view, localOff + 28)
      const dataStart = localOff + 30 + lNameLen + lExtraLen

      // Data descriptor : tailles dans CD font foi
      if (lFlags & 0x8) {
        lComp = compSize
        lUncomp = uncompSize
      } else {
        if (lComp === 0 && compSize > 0) lComp = compSize
        if (lUncomp === 0 && uncompSize > 0) lUncomp = uncompSize
      }

      if (dataStart + lComp > view.byteLength) continue
      const comp = u8.subarray(dataStart, dataStart + lComp)
      const m = lMethod || method

      let data: Uint8Array
      try {
        if (m === 0) data = comp.slice()
        else if (m === 8) data = await inflateRaw(comp)
        else continue
      } catch {
        continue
      }

      total += data.byteLength
      out.push({ name, data })
    }

    if (out.length > 0) return out
  }

  // ── Chemin B : local headers (fallback, + data descriptor) ──
  return unzipLocalFallback(view, u8, maxFiles, maxTotal)
}

async function unzipLocalFallback(
  view: DataView,
  u8: Uint8Array,
  maxFiles: number,
  maxTotal: number
): Promise<ZipEntry[]> {
  const out: ZipEntry[] = []
  let offset = 0
  let total = 0

  while (offset + 30 < view.byteLength && out.length < maxFiles) {
    const sig = u32(view, offset)
    if (sig !== 0x04034b50) {
      // Sauter data descriptor or padding
      if (sig === 0x08074b50) {
        offset += 16
        continue
      }
      if (sig === 0x02014b50 || sig === 0x06054b50) break
      offset++
      continue
    }
    const flags = u16(view, offset + 6)
    const method = u16(view, offset + 8)
    let compSize = u32(view, offset + 18)
    let uncompSize = u32(view, offset + 22)
    const nameLen = u16(view, offset + 26)
    const extraLen = u16(view, offset + 28)
    const nameStart = offset + 30
    const nameBytes = u8.subarray(nameStart, nameStart + nameLen)
    const name = decodeName(nameBytes, !!(flags & 0x800))
    const dataStart = nameStart + nameLen + extraLen

    // Data descriptor : tailles à 0 dans le header local
    if ((flags & 0x8) !== 0 || (compSize === 0 && uncompSize === 0)) {
      // Chercher le prochain signature après dataStart
      let found = -1
      for (let i = dataStart; i + 4 < view.byteLength; i++) {
        const s = u32(view, i)
        if (
          s === 0x08074b50 ||
          s === 0x04034b50 ||
          s === 0x02014b50 ||
          s === 0x06054b50
        ) {
          found = i
          break
        }
      }
      if (found < 0) break
      if (u32(view, found) === 0x08074b50) {
        // optional sig + crc + comp + uncomp
        compSize = u32(view, found + 8)
        uncompSize = u32(view, found + 12)
        const comp = u8.subarray(dataStart, dataStart + (found - dataStart))
        // sizes in descriptor should match; use descriptor sizes if set
        const realComp =
          compSize > 0 && compSize <= comp.length ? compSize : comp.length
        const slice = u8.subarray(dataStart, dataStart + realComp)
        offset = found + 16
        if (!name.endsWith("/") && slice.length) {
          try {
            let data: Uint8Array
            if (method === 0) data = slice.slice()
            else if (method === 8) data = await inflateRaw(slice)
            else continue
            if (total + data.byteLength <= maxTotal) {
              total += data.byteLength
              out.push({ name, data })
            }
          } catch {
            /* skip */
          }
        }
        continue
      }
      // next local without descriptor sizes — take until next header
      compSize = found - dataStart
      uncompSize = compSize
    }

    const comp = u8.subarray(dataStart, dataStart + compSize)
    offset = dataStart + compSize

    if (name.endsWith("/") || (uncompSize === 0 && compSize === 0)) continue
    if (total + Math.max(uncompSize, compSize) > maxTotal) continue

    try {
      let data: Uint8Array
      if (method === 0) data = comp.slice()
      else if (method === 8) data = await inflateRaw(comp)
      else continue
      total += data.byteLength
      out.push({ name, data })
    } catch {
      continue
    }
  }
  return out
}

export function entryText(data: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: false }).decode(data)
  } catch {
    return ""
  }
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

/** Extraire balises texte XML Office (w:t, a:t, t, v, etc.) */
export function stripXmlText(xml: string): string {
  let s = xml
    .replace(/<\?xml[^?]*\?>/g, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
  const parts: string[] = []
  // Word: w:t · Drawing: a:t · générique t/v
  const re =
    /<(?:[a-zA-Z0-9]+:)?(?:t|v)\b[^>]*>([\s\S]*?)<\/(?:[a-zA-Z0-9]+:)?(?:t|v)>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(s)) !== null) {
    const raw = (m[1] || "").replace(/<[^>]+>/g, "")
    const t = decodeXmlEntities(raw).trim()
    if (t) parts.push(t)
  }
  if (parts.length) return parts.join(" ")
  // Fallback : strip tags
  return decodeXmlEntities(
    s
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  )
}
