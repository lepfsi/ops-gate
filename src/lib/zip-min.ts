/**
 * Lecteur ZIP minimal (store + deflate) pour PPTX/XLSX dans l’extension.
 * Pas de dépendance — DecompressionStream (Chrome/Edge/Firefox modernes).
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

/** Liste les entrées d’un ZIP (noms en UTF-8 / CP437 best-effort) */
export async function unzipAll(
  buf: ArrayBuffer,
  opts?: { maxFiles?: number; maxTotalBytes?: number }
): Promise<ZipEntry[]> {
  const maxFiles = opts?.maxFiles ?? 200
  const maxTotal = opts?.maxTotalBytes ?? 8_000_000
  const view = new DataView(buf)
  const u8 = new Uint8Array(buf)
  const out: ZipEntry[] = []
  let offset = 0
  let total = 0

  while (offset + 30 < view.byteLength && out.length < maxFiles) {
    const sig = u32(view, offset)
    if (sig !== 0x04034b50) break // local file header
    const method = u16(view, offset + 8)
    const compSize = u32(view, offset + 18)
    const uncompSize = u32(view, offset + 22)
    const nameLen = u16(view, offset + 26)
    const extraLen = u16(view, offset + 28)
    const nameStart = offset + 30
    const nameBytes = u8.subarray(nameStart, nameStart + nameLen)
    let name = ""
    try {
      name = new TextDecoder("utf-8").decode(nameBytes)
    } catch {
      name = String.fromCharCode(...nameBytes)
    }
    const dataStart = nameStart + nameLen + extraLen
    const comp = u8.subarray(dataStart, dataStart + compSize)
    offset = dataStart + compSize

    if (name.endsWith("/") || uncompSize === 0) continue
    if (total + uncompSize > maxTotal) continue

    let data: Uint8Array
    if (method === 0) {
      data = comp.slice()
    } else if (method === 8) {
      try {
        data = await inflateRaw(comp)
      } catch {
        continue
      }
    } else {
      continue
    }
    total += data.byteLength
    out.push({ name, data })
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

/** Extraire balises texte XML Office (a:t, t, v, etc.) */
export function stripXmlText(xml: string): string {
  // enlever scripts/meta
  let s = xml
    .replace(/<\?xml[^?]*\?>/g, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
  const parts: string[] = []
  // Texte OOXML courant : <a:t>…</a:t>, <t>…</t>, <v>…</v>
  const re =
    /<(?:[a-zA-Z0-9]+:)?(?:t|v|a:t|t)\b[^>]*>([^<]*)<\/(?:[a-zA-Z0-9]+:)?(?:t|v|a:t|t)>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(s)) !== null) {
    const t = (m[1] || "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"').trim()
    if (t) parts.push(t)
  }
  if (parts.length) return parts.join(" ")
  // Fallback : strip tags
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim()
}
