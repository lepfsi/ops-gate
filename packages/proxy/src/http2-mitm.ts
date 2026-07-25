/**
 * MITM HTTP/2 stream-aware (enforce soft-block / soft-mask par stream).
 * Connexion multiplexée conservée : RST_STREAM sur le stream sensible uniquement.
 */
import type * as tls from "node:tls"
import {
  detectSensitiveData,
  maskSensitiveData
} from "@opsgate/engine"
import { createStreamObserver } from "./observe.js"
import { log } from "./log.js"
import {
  resolveSoftMaskMode,
  type SoftMaskMode
} from "./soft-mask.js"
import {
  FLAG_END_STREAM,
  H2_ERR,
  H2_FRAME,
  H2_PREFACE,
  dataPayloadBytes,
  encodeRstStream,
  frameHasEndStream,
  framesToBuffer,
  http2Enabled,
  isH2Preface,
  isImmediateForwardFrame,
  parseFrames,
  rewriteStreamDataMasked,
  type H2Frame
} from "./http2-frames.js"

/** Aligné T4 multipart (OPSGATE_PROXY_HOLD_MAX override possible via env côté h1) */
const MAX_STREAM_HOLD = (() => {
  const env = parseInt(process.env.OPSGATE_PROXY_HOLD_MAX || "", 10)
  if (Number.isFinite(env) && env >= 256 * 1024) return env
  return 6 * 1024 * 1024
})()
const STREAM_IDLE_MS = 200

const SKIP_MASK_RULES = new Set([
  "jwt-token",
  "email-address",
  "phone-fr",
  "ip-private-block"
])

type StreamState = {
  id: number
  held: H2Frame[]
  holdBytes: number
  endSeen: boolean
  observer: ReturnType<typeof createStreamObserver>
  idleTimer: ReturnType<typeof setTimeout> | null
  /** Stream bloqué : drop réponses amont */
  blocked: boolean
  /** Déjà forwardé (observe pass-through partiel) */
  released: boolean
  /** finalize async en cours */
  finalizing: boolean
}

export type Http2MitmHandles = {
  onClientData: (chunk: Buffer) => void
  onUpstreamData: (chunk: Buffer) => void
  destroy: () => void
}

export function createHttp2Mitm(opts: {
  host: string
  tlsClient: tls.TLSSocket
  getUpstream: () => tls.TLSSocket | null
  enforceMode: boolean
  maskMode: SoftMaskMode
  onFatal: (why: string) => void
}): Http2MitmHandles {
  const { host, tlsClient, getUpstream, enforceMode, maskMode, onFatal } =
    opts

  let clientBuf = Buffer.alloc(0)
  let upBuf = Buffer.alloc(0)
  let clientPrefaceDone = false
  let upPrefaceDone = false
  /** Streams côté client qu’on a RST / bloqués */
  const blockedStreams = new Set<number>()
  const streams = new Map<number, StreamState>()
  let destroyed = false

  const safeWrite = (
    sock: tls.TLSSocket | null | undefined,
    data: Buffer,
    why: string
  ) => {
    if (!sock || sock.destroyed || !data.length) return
    try {
      sock.write(data)
    } catch (e) {
      log("warn", "h2_write_failed", { host, why, error: String(e) })
      onFatal(why)
    }
  }

  const getStream = (id: number): StreamState => {
    let s = streams.get(id)
    if (!s) {
      s = {
        id,
        held: [],
        holdBytes: 0,
        endSeen: false,
        observer: createStreamObserver({ host: `${host}#${id}` }),
        idleTimer: null,
        blocked: false,
        released: false,
        finalizing: false
      }
      streams.set(id, s)
    }
    return s
  }

  const clearStreamTimer = (s: StreamState) => {
    if (s.idleTimer) {
      clearTimeout(s.idleTimer)
      s.idleTimer = null
    }
  }

  const dropStream = (id: number) => {
    const s = streams.get(id)
    if (s) {
      clearStreamTimer(s)
      streams.delete(id)
    }
  }

  const maskDataBody = (body: Buffer): Buffer | null => {
    const text = body.toString("utf8")
    const dets = detectSensitiveData(text).filter(
      (d) => !SKIP_MASK_RULES.has(d.ruleId)
    )
    if (!dets.length) {
      // latin1 fallback for binary-safe
      const dets2 = detectSensitiveData(body.toString("latin1")).filter(
        (d) => !SKIP_MASK_RULES.has(d.ruleId)
      )
      if (!dets2.length) return null
      const masked = maskSensitiveData(body.toString("latin1"), dets2)
      if (masked === body.toString("latin1")) return null
      return Buffer.from(masked, "latin1")
    }
    const masked = maskSensitiveData(text, dets)
    if (masked === text) return null
    return Buffer.from(masked, "utf8")
  }

  const rstBoth = (streamId: number, reason: string) => {
    blockedStreams.add(streamId)
    const rst = encodeRstStream(streamId, H2_ERR.CANCEL)
    safeWrite(tlsClient, rst, "rst_client")
    const up = getUpstream()
    safeWrite(up, rst, "rst_upstream")
    log("warn", "h2_stream_rst", {
      host,
      stream_id: streamId,
      reason,
      mask_mode: maskMode,
      mode: "enforce_h2_stream"
    })
    dropStream(streamId)
  }

  const finalizeStream = (s: StreamState, why: string) => {
    if (s.released || s.blocked || s.finalizing) return
    s.finalizing = true
    clearStreamTimer(s)
    void finalizeStreamAsync(s, why)
  }

  const finalizeStreamAsync = async (s: StreamState, why: string) => {
    if (s.released || s.blocked) return

    // Scan léger
    s.observer.flush()

    // T4 : concat DATA payloads → deep multipart scan
    const dataParts: Buffer[] = []
    for (const f of s.held) {
      if (f.type === H2_FRAME.DATA) {
        const p = dataPayloadBytes(f)
        if (p.length) dataParts.push(p)
      }
    }
    const dataConcat =
      dataParts.length === 0
        ? Buffer.alloc(0)
        : dataParts.length === 1
          ? dataParts[0]!
          : Buffer.concat(dataParts)
    const dataConcatLen = dataConcat.length

    if (!s.observer.isBlocked() && dataConcatLen > 32) {
      try {
        await s.observer.flushDeep(dataConcat)
      } catch (e) {
        log("warn", "h2_flush_deep_error", {
          host,
          stream_id: s.id,
          error: e instanceof Error ? e.message : String(e)
        })
      }
    }

    const sensitive = s.observer.isBlocked()
    const preferLocal = s.observer.preferLocalBlock()

    if (!enforceMode || !sensitive) {
      const up = getUpstream()
      safeWrite(up, framesToBuffer(s.held), "h2_release_clean")
      s.released = true
      s.held = []
      s.holdBytes = 0
      dropStream(s.id)
      log("debug", "h2_stream_released", {
        host,
        stream_id: s.id,
        why,
        data_bytes: dataConcatLen
      })
      return
    }

    // ── Sensitive ──
    if (maskMode === "onwire" && !preferLocal) {
      const rewritten = rewriteStreamDataMasked(s.held, maskDataBody)
      if (rewritten) {
        const up = getUpstream()
        safeWrite(up, framesToBuffer(rewritten), "h2_mask_onwire")
        s.released = true
        log("info", "h2_stream_soft_mask_onwire", {
          host,
          stream_id: s.id,
          why,
          frames_in: s.held.length,
          frames_out: rewritten.length
        })
        dropStream(s.id)
        return
      }
      log("warn", "h2_onwire_fallback_rst", { host, stream_id: s.id })
    }

    s.blocked = true
    rstBoth(
      s.id,
      preferLocal
        ? `block_deep_file_${why}`
        : maskMode === "local" || maskMode === "onwire"
          ? `soft_mask_${maskMode}_${why}`
          : `block_${why}`
    )
  }

  const scheduleStreamIdle = (s: StreamState) => {
    clearStreamTimer(s)
    s.idleTimer = setTimeout(() => {
      s.idleTimer = null
      if (!s.endSeen && s.holdBytes > 0) {
        // Pas d'END_STREAM : décider quand même (rafale finie)
        finalizeStream(s, "idle")
      }
    }, STREAM_IDLE_MS)
  }

  const handleClientFrame = (frame: H2Frame) => {
    if (isImmediateForwardFrame(frame)) {
      if (frame.type === H2_FRAME.RST_STREAM) {
        blockedStreams.add(frame.streamId)
        dropStream(frame.streamId)
      }
      safeWrite(getUpstream(), frame.raw, "h2_ctrl_up")
      return
    }

    if (!enforceMode) {
      // observe : scan DATA + pass-through
      if (frame.type === H2_FRAME.DATA) {
        const s = getStream(frame.streamId)
        s.observer.onClientData(dataPayloadBytes(frame))
      }
      safeWrite(getUpstream(), frame.raw, "h2_observe_up")
      return
    }

    // enforce : buffer stream until END_STREAM / idle
    const s = getStream(frame.streamId)
    if (s.released || s.blocked || blockedStreams.has(frame.streamId)) {
      return
    }

    s.held.push(frame)
    s.holdBytes += frame.raw.length

    if (frame.type === H2_FRAME.DATA) {
      const payload = dataPayloadBytes(frame)
      if (payload.length && s.observer.onClientData(payload)) {
        // Early detect — wait for end or finalize now
        if (frameHasEndStream(frame)) {
          s.endSeen = true
          finalizeStream(s, "early_end")
          return
        }
        // keep buffering for onwire full body
        if (maskMode !== "onwire") {
          finalizeStream(s, "early_detect")
          return
        }
      }
    }

    if (frameHasEndStream(frame)) {
      s.endSeen = true
      finalizeStream(s, "end_stream")
      return
    }

    if (s.holdBytes >= MAX_STREAM_HOLD) {
      finalizeStream(s, "buffer_overflow")
      return
    }

    scheduleStreamIdle(s)
  }

  const handleUpstreamFrame = (frame: H2Frame) => {
    if (
      frame.streamId !== 0 &&
      (blockedStreams.has(frame.streamId) ||
        streams.get(frame.streamId)?.blocked)
    ) {
      // Drop response for blocked stream
      return
    }
    safeWrite(tlsClient, frame.raw, "h2_down")
  }

  const processClientBuf = () => {
    // Connection preface client → upstream
    if (!clientPrefaceDone) {
      if (clientBuf.length < H2_PREFACE.length) return
      if (!isH2Preface(clientBuf)) {
        log("warn", "h2_missing_preface_client", { host })
        // Maybe not h2 after all — pass raw (fallback)
        safeWrite(getUpstream(), clientBuf, "h2_fallback_raw")
        clientBuf = Buffer.alloc(0)
        clientPrefaceDone = true
        return
      }
      safeWrite(getUpstream(), H2_PREFACE, "h2_preface_up")
      clientBuf = clientBuf.subarray(H2_PREFACE.length)
      clientPrefaceDone = true
    }

    const { frames, rest } = parseFrames(clientBuf)
    clientBuf = rest
    for (const f of frames) handleClientFrame(f)
  }

  const processUpBuf = () => {
    // Upstream may not send preface (server); only client sends PRI
    // Some stacks still — just parse frames
    if (!upPrefaceDone) {
      if (upBuf.length >= H2_PREFACE.length && isH2Preface(upBuf)) {
        safeWrite(tlsClient, H2_PREFACE, "h2_preface_down")
        upBuf = upBuf.subarray(H2_PREFACE.length)
      }
      upPrefaceDone = true
    }
    const { frames, rest } = parseFrames(upBuf)
    upBuf = rest
    for (const f of frames) handleUpstreamFrame(f)
  }

  return {
    onClientData(chunk: Buffer) {
      if (destroyed) return
      clientBuf = Buffer.concat([clientBuf, chunk])
      if (clientBuf.length > 2 * 1024 * 1024) {
        log("warn", "h2_client_buf_overflow", { host })
        onFatal("h2_client_buf_overflow")
        return
      }
      processClientBuf()
    },
    onUpstreamData(chunk: Buffer) {
      if (destroyed) return
      upBuf = Buffer.concat([upBuf, chunk])
      if (upBuf.length > 2 * 1024 * 1024) {
        log("warn", "h2_up_buf_overflow", { host })
        onFatal("h2_up_buf_overflow")
        return
      }
      processUpBuf()
    },
    destroy() {
      destroyed = true
      for (const s of streams.values()) clearStreamTimer(s)
      streams.clear()
      clientBuf = Buffer.alloc(0)
      upBuf = Buffer.alloc(0)
    }
  }
}

export { http2Enabled }
