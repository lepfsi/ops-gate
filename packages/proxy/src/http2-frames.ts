/**
 * HTTP/2 binary framing (RFC 7540) — parse / encode minimal pour MITM stream-aware.
 * Pas de HPACK : HEADERS opaques ; DATA scannable en clair (JSON IA typique).
 */

export const H2_PREFACE = Buffer.from("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n")

export const H2_FRAME = {
  DATA: 0x0,
  HEADERS: 0x1,
  PRIORITY: 0x2,
  RST_STREAM: 0x3,
  SETTINGS: 0x4,
  PUSH_PROMISE: 0x5,
  PING: 0x6,
  GOAWAY: 0x7,
  WINDOW_UPDATE: 0x8,
  CONTINUATION: 0x9
} as const

/** RST / GOAWAY error codes (subset) */
export const H2_ERR = {
  NO_ERROR: 0x0,
  PROTOCOL_ERROR: 0x1,
  INTERNAL_ERROR: 0x2,
  FLOW_CONTROL_ERROR: 0x3,
  CANCEL: 0x8,
  REFUSED_STREAM: 0x7,
  ENHANCE_YOUR_CALM: 0xb
} as const

export const FLAG_END_STREAM = 0x1
export const FLAG_END_HEADERS = 0x4
export const FLAG_PADDED = 0x8
export const FLAG_PRIORITY = 0x20

export type H2Frame = {
  length: number
  type: number
  flags: number
  streamId: number
  payload: Buffer
  /** Frame complète (header 9 + payload) */
  raw: Buffer
}

export function isH2Preface(buf: Buffer): boolean {
  if (buf.length < H2_PREFACE.length) return false
  return buf.subarray(0, H2_PREFACE.length).equals(H2_PREFACE)
}

export function encodeFrame(
  type: number,
  flags: number,
  streamId: number,
  payload: Buffer = Buffer.alloc(0)
): Buffer {
  const len = payload.length
  if (len > 0xffffff) throw new Error("h2_frame_too_large")
  const head = Buffer.alloc(9)
  head[0] = (len >> 16) & 0xff
  head[1] = (len >> 8) & 0xff
  head[2] = len & 0xff
  head[3] = type & 0xff
  head[4] = flags & 0xff
  // R bit reserved = 0
  head.writeUInt32BE(streamId & 0x7fffffff, 5)
  return Buffer.concat([head, payload])
}

export function encodeRstStream(
  streamId: number,
  errorCode: number = H2_ERR.CANCEL
): Buffer {
  const p = Buffer.alloc(4)
  p.writeUInt32BE(errorCode >>> 0, 0)
  return encodeFrame(H2_FRAME.RST_STREAM, 0, streamId, p)
}

export function encodeGoaway(
  lastStreamId: number,
  errorCode: number = H2_ERR.NO_ERROR
): Buffer {
  const p = Buffer.alloc(8)
  p.writeUInt32BE(lastStreamId & 0x7fffffff, 0)
  p.writeUInt32BE(errorCode >>> 0, 4)
  return encodeFrame(H2_FRAME.GOAWAY, 0, 0, p)
}

/**
 * Parse autant de frames que possible depuis buf.
 * @returns frames + reste non consommé
 */
export function parseFrames(buf: Buffer): { frames: H2Frame[]; rest: Buffer } {
  const frames: H2Frame[] = []
  let i = 0
  while (i + 9 <= buf.length) {
    const length = (buf[i]! << 16) | (buf[i + 1]! << 8) | buf[i + 2]!
    if (i + 9 + length > buf.length) break
    const type = buf[i + 3]!
    const flags = buf[i + 4]!
    const streamId = buf.readUInt32BE(i + 5) & 0x7fffffff
    const payload = buf.subarray(i + 9, i + 9 + length)
    const raw = buf.subarray(i, i + 9 + length)
    frames.push({
      length,
      type,
      flags,
      streamId,
      payload: Buffer.from(payload),
      raw: Buffer.from(raw)
    })
    i += 9 + length
  }
  return { frames, rest: buf.subarray(i) }
}

/** DATA payload utile (sans padding) */
export function dataPayloadBytes(frame: H2Frame): Buffer {
  if (frame.type !== H2_FRAME.DATA) return Buffer.alloc(0)
  let p = frame.payload
  if (frame.flags & FLAG_PADDED) {
    if (p.length < 1) return Buffer.alloc(0)
    const pad = p[0]!
    p = p.subarray(1, p.length - pad)
  }
  return p
}

export function frameHasEndStream(frame: H2Frame): boolean {
  if (frame.type === H2_FRAME.DATA || frame.type === H2_FRAME.HEADERS) {
    return (frame.flags & FLAG_END_STREAM) !== 0
  }
  return false
}

/** Frames de contrôle / forward immédiat (ne pas bufferiser avec le stream) */
export function isImmediateForwardFrame(frame: H2Frame): boolean {
  if (frame.streamId === 0) return true
  switch (frame.type) {
    case H2_FRAME.WINDOW_UPDATE:
    case H2_FRAME.RST_STREAM:
    case H2_FRAME.PING:
    case H2_FRAME.SETTINGS:
    case H2_FRAME.GOAWAY:
      return true
    default:
      return false
  }
}

/**
 * Réécrit les frames d'un stream : masque les payloads DATA, conserve HEADERS.
 * @returns null si rien à changer ou échec
 */
export function rewriteStreamDataMasked(
  frames: H2Frame[],
  maskBody: (body: Buffer) => Buffer | null
): H2Frame[] | null {
  const dataFrames = frames.filter((f) => f.type === H2_FRAME.DATA)
  if (!dataFrames.length) return null

  const parts = dataFrames.map((f) => dataPayloadBytes(f))
  const concat = Buffer.concat(parts)
  if (concat.length < 4) return null

  const masked = maskBody(concat)
  if (!masked || masked.equals(concat)) return null

  // Rebuild : un seul DATA frame (ou plusieurs si >16KB) avec flags END_STREAM du dernier
  const lastData = dataFrames[dataFrames.length - 1]!
  const endStream = (lastData.flags & FLAG_END_STREAM) !== 0
  const newDataFrames: H2Frame[] = []
  const CHUNK = 16 * 1024
  let offset = 0
  let idx = 0
  const totalChunks = Math.max(1, Math.ceil(masked.length / CHUNK) || 1)
  while (offset < masked.length || (masked.length === 0 && idx === 0)) {
    const slice =
      masked.length === 0
        ? Buffer.alloc(0)
        : masked.subarray(offset, Math.min(offset + CHUNK, masked.length))
    offset += slice.length || 1
    const isLast = masked.length === 0 || offset >= masked.length
    const flags = isLast && endStream ? FLAG_END_STREAM : 0
    const raw = encodeFrame(
      H2_FRAME.DATA,
      flags,
      lastData.streamId,
      slice
    )
    newDataFrames.push({
      length: slice.length,
      type: H2_FRAME.DATA,
      flags,
      streamId: lastData.streamId,
      payload: slice,
      raw
    })
    idx++
    if (masked.length === 0) break
    if (idx > totalChunks + 2) break
  }

  const out: H2Frame[] = []
  let dataReplaced = false
  for (const f of frames) {
    if (f.type === H2_FRAME.DATA) {
      if (!dataReplaced) {
        out.push(...newDataFrames)
        dataReplaced = true
      }
      // skip original DATA
    } else {
      out.push(f)
    }
  }
  return out
}

export function framesToBuffer(frames: H2Frame[]): Buffer {
  return Buffer.concat(frames.map((f) => f.raw))
}

export function http2Enabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const v = (env.OPSGATE_PROXY_HTTP2 || "1").toLowerCase().trim()
  return !(v === "0" || v === "false" || v === "off" || v === "no")
}
