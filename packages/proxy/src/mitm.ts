/**
 * MITM TLS borné allowlist — observe + enforce **par requête / stream** (P3).
 *
 * Enforce HTTP/1.1 :
 * - bufferise client→serveur, scanne, ne relaie qu’après scan propre ;
 * - soft-block 403 / soft-mask local 422 / soft-mask on-wire rewrite ;
 * - TLS keep-alive.
 *
 * Enforce HTTP/2 :
 * - demux frames, hold par stream jusqu’à END_STREAM ;
 * - sensible → RST_STREAM (connexion multiplexée conservée) ou mask on-wire DATA ;
 * - voir http2-mitm.ts / http2-frames.ts.
 */
import * as net from "node:net"
import * as tls from "node:tls"
import { getHostCert } from "./certs.js"
import { createHttp2Mitm, http2Enabled } from "./http2-mitm.js"
import { log } from "./log.js"
import {
  createStreamObserver,
  resolveFilterMode
} from "./observe.js"
import {
  resolveSoftMaskMode,
  rewriteHttpRequestMasked,
  type SoftMaskMode
} from "./soft-mask.js"
import { getProxyRemoteConfig } from "./sync.js"

const MAX_HOLD_BYTES = 512 * 1024
/** Idle client → fin de rafale requête → scan final + release / mask / soft-block */
const RELEASE_IDLE_MS = 100

export function mitmConnect(opts: {
  clientSocket: net.Socket
  head: Buffer
  targetHost: string
  targetPort: number
}) {
  const { clientSocket, head, targetHost, targetPort } = opts
  let cleaned = false
  let upstream: tls.TLSSocket | null = null
  let tlsClient: tls.TLSSocket | null = null
  const observer = createStreamObserver({ host: targetHost })

  const cfgRemote = getProxyRemoteConfig()
  const enforceMode =
    cfgRemote.enabled !== false && resolveFilterMode() === "enforce"
  const maskMode: SoftMaskMode = resolveSoftMaskMode()

  /** Buffer d’une requête (reset après release / soft-block) */
  const hold: Buffer[] = []
  let holdBytes = 0
  let releaseTimer: ReturnType<typeof setTimeout> | null = null
  /** Pendant soft-block : on ignore le reste de la requête courante jusqu’à idle */
  let discardingRequest = false
  /**
   * On-wire : détection déjà vue — continuer à bufferiser jusqu’à idle
   * pour rewriter la requête complète (Content-Length).
   */
  let maskPending = false

  const cleanup = (why?: string) => {
    if (cleaned) return
    cleaned = true
    if (releaseTimer) {
      clearTimeout(releaseTimer)
      releaseTimer = null
    }
    hold.length = 0
    holdBytes = 0
    maskPending = false
    if (why) {
      log("debug", "mitm_cleanup", { host: targetHost, why })
    }
    try {
      tlsClient?.destroy()
    } catch {
      /* ignore */
    }
    try {
      upstream?.destroy()
    } catch {
      /* ignore */
    }
    try {
      if (!clientSocket.destroyed) clientSocket.destroy()
    } catch {
      /* ignore */
    }
  }

  const clearHold = () => {
    hold.length = 0
    holdBytes = 0
  }

  /** Reset pour la prochaine requête HTTP (keep-alive) */
  const beginNextRequest = () => {
    if (releaseTimer) {
      clearTimeout(releaseTimer)
      releaseTimer = null
    }
    clearHold()
    discardingRequest = false
    maskPending = false
    observer.reset()
  }

  /**
   * Soft-block / soft-mask local : refuse cette requête, garde la session TLS ouverte.
   * - preferLocal / maskMode local → 422 JSON (sans contacter l’amont)
   * - sinon → 403 text
   */
  const softBlockRequest = (reason: string, preferLocal = false) => {
    const respondLocal = maskMode === "local" || preferLocal

    log(
      "warn",
      respondLocal ? "mitm_request_soft_mask_local" : "mitm_request_blocked",
      {
        host: targetHost,
        reason,
        held_bytes: holdBytes,
        mask_mode: maskMode,
        mode: respondLocal ? "enforce_soft_mask_local" : "enforce_soft",
        note: "TLS kept open — next request allowed after reset"
      }
    )
    clearHold()
    maskPending = false
    discardingRequest = true

    if (!tlsClient || tlsClient.destroyed) {
      beginNextRequest()
      return
    }

    const alpn =
      typeof tlsClient.alpnProtocol === "string" ? tlsClient.alpnProtocol : ""
    try {
      if (!alpn || alpn === "http/1.1" || alpn === "http/1.0") {
        if (respondLocal) {
          const body = JSON.stringify({
            error: "opsgate_soft_mask",
            message:
              "OpsGate: contenu sensible retiré — renvoyez un message sans secrets.",
            blocked: true,
            mode:
              maskMode === "onwire" ? "onwire_fallback_local" : "local"
          })
          tlsClient.write(
            "HTTP/1.1 422 Unprocessable Entity\r\n" +
              "Content-Type: application/json; charset=utf-8\r\n" +
              `Content-Length: ${Buffer.byteLength(body)}\r\n` +
              "Connection: keep-alive\r\n" +
              "Cache-Control: no-store\r\n" +
              "X-OpsGate-Block: soft-mask\r\n" +
              "X-OpsGate-Block-Scope: request\r\n" +
              "\r\n" +
              body
          )
        } else {
          const body =
            "OpsGate: envoi bloqué — données sensibles détectées.\n" +
            "OpsGate: request blocked — sensitive data detected.\n\n" +
            "Le site reste accessible. Ne renvoyez pas le même contenu sensible.\n" +
            "The site remains available. Do not resend the same sensitive content.\n"
          tlsClient.write(
            "HTTP/1.1 403 Forbidden\r\n" +
              "Content-Type: text/plain; charset=utf-8\r\n" +
              `Content-Length: ${Buffer.byteLength(body)}\r\n` +
              "Connection: keep-alive\r\n" +
              "Cache-Control: no-store\r\n" +
              "X-OpsGate-Block: 1\r\n" +
              "X-OpsGate-Block-Scope: request\r\n" +
              "\r\n" +
              body
          )
        }
      } else {
        // HTTP/2 : pas de frames GOAWAY/RST propres ici — on coupe seulement ce socket
        log("info", "mitm_soft_block_h2_close_socket", {
          host: targetHost,
          note: "h2 multiplex hard; socket closed, browser will open new one"
        })
        cleanup("enforce_block_h2")
        return
      }
    } catch {
      /* ignore write errors */
    }

    if (releaseTimer) clearTimeout(releaseTimer)
    releaseTimer = setTimeout(() => {
      releaseTimer = null
      beginNextRequest()
      log("info", "mitm_ready_after_block", {
        host: targetHost,
        note: "site access restored for subsequent requests"
      })
    }, 150)
  }

  /** Soft-mask on-wire : rewrite body masqué puis forward amont. */
  const softMaskOnWire = (reason: string): boolean => {
    if (!upstream || upstream.destroyed) {
      softBlockRequest("onwire_no_upstream", true)
      return false
    }
    if (holdBytes === 0) {
      beginNextRequest()
      return false
    }
    const raw = Buffer.concat(hold)
    const result = rewriteHttpRequestMasked(raw)
    if (!result.ok) {
      log("warn", "mitm_onwire_rewrite_failed", {
        host: targetHost,
        reason: result.reason,
        trigger: reason,
        fallback: result.fallback
      })
      softBlockRequest(
        `onwire_${result.reason}`,
        result.fallback === "local"
      )
      return false
    }
    if (!result.changed) {
      // Rien de masquable dans le body → soft-block classique
      softBlockRequest("onwire_nothing_masked", maskMode !== "off")
      return false
    }
    try {
      upstream.write(result.data)
    } catch {
      cleanup("upstream_write_masked")
      return false
    }
    log("info", "mitm_request_soft_mask_onwire", {
      host: targetHost,
      trigger: reason,
      detection_count: result.detectionCount,
      rule_ids: result.ruleIds,
      bytes_in: result.bytesIn,
      bytes_out: result.bytesOut,
      mode: "enforce_soft_mask_onwire",
      note: "masked body forwarded to upstream — site UX preserved"
    })
    clearHold()
    maskPending = false
    observer.reset()
    return true
  }

  const handleSensitive = (reason: string): boolean => {
    if (maskMode === "onwire") {
      return softMaskOnWire(reason)
    }
    softBlockRequest(reason, maskMode === "local")
    return false
  }

  const flushHoldToUpstream = (): boolean => {
    if (cleaned || discardingRequest) return false
    // Scan final idle
    if (!observer.isBlocked()) {
      observer.flush()
    }
    if (observer.isBlocked() || maskPending) {
      return handleSensitive(
        maskPending ? "sensitive_data_mask_pending" : "sensitive_data_detected"
      )
    }
    if (!upstream || upstream.destroyed) return false
    if (holdBytes === 0) return true

    for (const b of hold) {
      try {
        upstream.write(b)
      } catch {
        cleanup("upstream_write")
        return false
      }
    }
    const n = holdBytes
    clearHold()
    observer.reset()
    log("debug", "mitm_hold_released", {
      host: targetHost,
      bytes: n,
      mode: enforceMode ? "enforce_clean" : "observe"
    })
    return true
  }

  const scheduleRelease = () => {
    if (!enforceMode || cleaned || discardingRequest) return
    if (releaseTimer) clearTimeout(releaseTimer)
    releaseTimer = setTimeout(() => {
      releaseTimer = null
      if (discardingRequest) {
        beginNextRequest()
        return
      }
      flushHoldToUpstream()
    }, RELEASE_IDLE_MS)
  }

  try {
    clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n")
  } catch (e) {
    log("warn", "mitm_write_200_failed", {
      host: targetHost,
      error: String(e)
    })
    clientSocket.destroy()
    return
  }

  let hostPem
  try {
    hostPem = getHostCert(targetHost)
  } catch (e) {
    log("error", "mitm_cert_failed", {
      host: targetHost,
      error: String(e)
    })
    cleanup("cert_failed")
    return
  }

  const pendingHead = head?.length ? head : null
  const h2ok = http2Enabled()
  /** Client ALPN : h2 autorisé même en enforce (stream-aware). */
  const alpnOffer = h2ok ? (["h2", "http/1.1"] as string[]) : ["http/1.1"]

  try {
    tlsClient = new tls.TLSSocket(clientSocket, {
      isServer: true,
      key: hostPem.key,
      cert: hostPem.cert,
      ALPNProtocols: alpnOffer,
      rejectUnauthorized: false
    })
  } catch (e) {
    log("error", "mitm_tls_server_create_failed", {
      host: targetHost,
      error: String(e)
    })
    cleanup("tls_server_create")
    return
  }

  tlsClient.on("error", (err) => {
    log("warn", "mitm_client_tls_error", {
      host: targetHost,
      error: String(err.message || err)
    })
    cleanup("client_tls_error")
  })

  let h2handles: ReturnType<typeof createHttp2Mitm> | null = null

  tlsClient.once("secure", () => {
    const alpn =
      typeof tlsClient!.alpnProtocol === "string" && tlsClient!.alpnProtocol
        ? tlsClient!.alpnProtocol
        : "http/1.1"

    const modeLabel = enforceMode ? "enforce_mitm" : "observe_mitm"
    const isH2 = alpn === "h2" || alpn === "h2-14" || alpn === "h2-16"

    // Amont : négocier le même ALPN (h2 si client h2)
    const upAlpn = isH2 ? (["h2", "http/1.1"] as string[]) : ["http/1.1"]

    upstream = tls.connect(
      {
        host: targetHost,
        port: targetPort,
        servername: targetHost,
        ALPNProtocols: upAlpn,
        rejectUnauthorized: true
      },
      () => {
        log("info", "mitm_established", {
          host: targetHost,
          port: targetPort,
          alpn_client: tlsClient?.alpnProtocol || null,
          alpn_upstream: upstream?.alpnProtocol || null,
          mode: modeLabel,
          block_scope: enforceMode
            ? isH2
              ? "h2_stream"
              : "request_soft"
            : "n/a",
          soft_mask: maskMode,
          http2: isH2
        })
      }
    )

    upstream.on("error", (err) => {
      log("warn", "mitm_upstream_tls_error", {
        host: targetHost,
        error: String(err.message || err)
      })
      cleanup("upstream_tls_error")
    })

    upstream.on("close", () => {
      if (!cleaned && !discardingRequest) {
        cleanup("upstream_close")
      }
    })

    // ── HTTP/2 path ──
    if (isH2) {
      h2handles = createHttp2Mitm({
        host: targetHost,
        tlsClient: tlsClient!,
        getUpstream: () => upstream,
        enforceMode,
        maskMode,
        onFatal: (why) => cleanup(why)
      })

      const onClientH2 = (chunk: Buffer) => {
        if (cleaned || !h2handles) return
        h2handles.onClientData(chunk)
      }
      tlsClient!.on("data", onClientH2)
      if (pendingHead?.length) onClientH2(pendingHead)

      upstream.on("data", (chunk: Buffer) => {
        if (cleaned || !h2handles) return
        h2handles.onUpstreamData(chunk)
      })

      tlsClient!.on("close", () => {
        h2handles?.destroy()
        cleanup("client_close_h2")
      })
      return
    }

    // ── HTTP/1.1 path (existant) ──
    const onClientChunk = (chunk: Buffer) => {
      if (cleaned) return

      if (discardingRequest) {
        scheduleRelease()
        return
      }

      if (enforceMode) {
        hold.push(chunk)
        holdBytes += chunk.length
        const block = observer.onClientData(chunk)
        if (block) {
          if (maskMode === "onwire") {
            maskPending = true
            if (holdBytes >= MAX_HOLD_BYTES) {
              softBlockRequest("enforce_buffer_overflow", true)
              return
            }
            scheduleRelease()
            return
          }
          softBlockRequest(
            "sensitive_data_detected",
            maskMode === "local"
          )
          return
        }
        if (holdBytes >= MAX_HOLD_BYTES) {
          softBlockRequest(
            "enforce_buffer_overflow",
            maskMode !== "off"
          )
          return
        }
        scheduleRelease()
        return
      }

      observer.onClientData(chunk)
      if (upstream && !upstream.destroyed) {
        try {
          upstream.write(chunk)
        } catch {
          cleanup("upstream_write")
        }
      }
    }

    tlsClient!.on("data", onClientChunk)

    if (pendingHead?.length) {
      onClientChunk(pendingHead)
    }

    upstream.on("data", (chunk: Buffer) => {
      if (tlsClient && !tlsClient.destroyed && !discardingRequest) {
        try {
          tlsClient.write(chunk)
        } catch {
          cleanup("client_write")
        }
      }
    })
  })

  tlsClient.on("close", () => {
    if (h2handles) {
      h2handles.destroy()
      cleanup("client_close")
      return
    }
    if (enforceMode && !cleaned && !observer.isBlocked() && holdBytes > 0) {
      flushHoldToUpstream()
    }
    cleanup("client_close")
  })
  clientSocket.on("error", () => cleanup("raw_socket_error"))
}
