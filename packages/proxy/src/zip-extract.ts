/**
 * Lecteur ZIP minimal (OOXML) — Node, sans dépendance externe.
 * Central directory + fallback local headers ; deflate via zlib.
 */
import { inflateRawSync } from "node:zlib"

export type ZipEntry = { name: string; data: Buffer }

function u16(buf: Buffer, o: number) {
  return buf.readUInt16LE(o)
}
function u32(buf: Buffer, o: number) {
  return buf.readUInt32LE(o)
}

function decodeName(bytes: Buffer, utf8Flag: boolean): string {
  try {
    return bytes.toString(utf8Flag ? "utf8" : "utf8")
  } catch {
    return bytes.toString("latin1")
  }
}

function findEocd(buf: Buffer): number {
  const len = buf.length
  const min = Math.max(0, len - 22 - 0xffff)
  for (let i = len - 22; i >= min; i--) {
    if (u32(buf, i) === 0x06054b50) return i
  }
  return -1
}

function inflate(comp: Buffer, method: number): Buffer | null {
  try {
    if (method === 0) return Buffer.from(comp)
    if (method === 8) return inflateRawSync(comp)
    return null
  } catch {
    return null
  }
}

export function unzipAll(
  buf: Buffer,
  opts?: { maxFiles?: number; maxTotalBytes?: number }
): ZipEntry[] {
  const maxFiles = opts?.maxFiles ?? 250
  const maxTotal = opts?.maxTotalBytes ?? 20_000_000

  const eocd = findEocd(buf)
  if (eocd >= 0) {
    const cdOffset = u32(buf, eocd + 16)
    const cdCount = u16(buf, eocd + 10)
    const out: ZipEntry[] = []
    let total = 0
    let pos = cdOffset

    for (let n = 0; n < cdCount && out.length < maxFiles; n++) {
      if (pos + 46 > buf.length) break
      if (u32(buf, pos) !== 0x02014b50) break
      const flags = u16(buf, pos + 8)
      const method = u16(buf, pos + 10)
      let compSize = u32(buf, pos + 20)
      let uncompSize = u32(buf, pos + 24)
      const nameLen = u16(buf, pos + 28)
      const extraLen = u16(buf, pos + 30)
      const commentLen = u16(buf, pos + 32)
      const localOff = u32(buf, pos + 42)
      const nameBytes = buf.subarray(pos + 46, pos + 46 + nameLen)
      const name = decodeName(nameBytes, !!(flags & 0x800))
      pos += 46 + nameLen + extraLen + commentLen

      if (name.endsWith("/")) continue
      if (uncompSize === 0 && compSize === 0) continue
      if (total + Math.max(uncompSize, compSize) > maxTotal) continue
      if (localOff + 30 > buf.length) continue
      if (u32(buf, localOff) !== 0x04034b50) continue

      const lFlags = u16(buf, localOff + 6)
      const lMethod = u16(buf, localOff + 8)
      let lComp = u32(buf, localOff + 18)
      const lNameLen = u16(buf, localOff + 26)
      const lExtraLen = u16(buf, localOff + 28)
      const dataStart = localOff + 30 + lNameLen + lExtraLen

      if (lFlags & 0x8) lComp = compSize
      else if (lComp === 0 && compSize > 0) lComp = compSize

      if (dataStart + lComp > buf.length) continue
      const comp = buf.subarray(dataStart, dataStart + lComp)
      const data = inflate(comp, lMethod || method)
      if (!data) continue
      total += data.length
      out.push({ name, data })
    }
    if (out.length > 0) return out
  }

  return unzipLocalFallback(buf, maxFiles, maxTotal)
}

function unzipLocalFallback(
  buf: Buffer,
  maxFiles: number,
  maxTotal: number
): ZipEntry[] {
  const out: ZipEntry[] = []
  let offset = 0
  let total = 0

  while (offset + 30 < buf.length && out.length < maxFiles) {
    if (u32(buf, offset) !== 0x04034b50) {
      offset++
      continue
    }
    const flags = u16(buf, offset + 6)
    const method = u16(buf, offset + 8)
    let compSize = u32(buf, offset + 18)
    const nameLen = u16(buf, offset + 26)
    const extraLen = u16(buf, offset + 28)
    const name = decodeName(
      buf.subarray(offset + 30, offset + 30 + nameLen),
      !!(flags & 0x800)
    )
    let dataStart = offset + 30 + nameLen + extraLen

    if (flags & 0x8) {
      // Data descriptor — search next local header or CD
      const next = findNextSig(buf, dataStart)
      if (next < 0) break
      compSize = next - dataStart
      // optional descriptor before next
    }

    if (dataStart + compSize > buf.length) break
    const comp = buf.subarray(dataStart, dataStart + compSize)
    const data = inflate(comp, method)
    offset = dataStart + compSize
    if (flags & 0x8 && offset + 16 <= buf.length && u32(buf, offset) === 0x08074b50) {
      offset += 16
    }
    if (!data || name.endsWith("/")) continue
    if (total + data.length > maxTotal) break
    total += data.length
    out.push({ name, data })
  }
  return out
}

function findNextSig(buf: Buffer, from: number): number {
  for (let i = from; i + 4 < buf.length; i++) {
    const s = u32(buf, i)
    if (s === 0x04034b50 || s === 0x02014b50 || s === 0x06054b50) return i
  }
  return -1
}

export function stripXmlText(xml: string): string {
  return xml
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim()
}

export function entryText(data: Buffer): string {
  return data.toString("utf8")
}
