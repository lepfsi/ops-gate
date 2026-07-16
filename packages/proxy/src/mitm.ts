/**
 * MITM TLS borné allowlist — observe + enforce **par requête** (P3).
 *
 * Enforce :
 * - bufferise client→serveur, scanne, ne relaie qu’après scan propre ;
 * - si sensible : 403 **sur cette requête uniquement**, TLS conservé, site restant accessible ;
 * - ne détruit plus la connexion (sauf erreur technique).
 */
import * as net from "node:net"
import * as tls from "node:tls"
import { getHostCert } from "./certs.js"
import { log } from "./log.js"
import {
  createStreamObserver,
  resolveFilterMode
} from "./observe.js"
import { getProxyRemoteConfig } from "./sync.js"

const MAX_HOLD_BYTES = 512 * 1024
/** Idle client → fin de rafale requête → scan final + release ou soft-block */
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

  /** Buffer d’une requête (reset après release / soft-block) */
  const hold: Buffer[] = []
  let holdBytes = 0
  let releaseTimer: ReturnType<typeof setTimeout> | null = null
  /** Pendant soft-block : on ignore le reste de la requête courante jusqu’à idle */
  let discardingRequest = false

  const cleanup = (why?: string) => {
    if (cleaned) return
    cleaned = true
    if (releaseTimer) {
      clearTimeout(releaseTimer)
      releaseTimer = null
    }
    hold.length = 0
    holdBytes = 0
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
    observer.reset()
  }

  /**
   * Soft-block : refuse cette requête, garde la session TLS ouverte.
   * Le navigateur peut recharger le site immédiatement.
   */
  const softBlockRequest = (reason: string) => {
    log("warn", "mitm_request_blocked", {
      host: targetHost,
      reason,
      held_bytes: holdBytes,
      mode: "enforce_soft",
      note: "TLS kept open — next request allowed after reset"
    })
    clearHold()
    discardingRequest = true

    if (!tlsClient || tlsClient.destroyed) {
      beginNextRequest()
      return
    }

    const alpn =
      typeof tlsClient.alpnProtocol === "string" ? tlsClient.alpnProtocol : ""
    try {
      if (!alpn || alpn === "http/1.1" || alpn === "http/1.0") {
        const body =
          "OpsGate: envoi bloqué — données sensibles détectées.\n" +
          "OpsGate: request blocked — sensitive data detected.\n\n" +
          "Le site reste accessible. Ne renvoyez pas le même contenu sensible.\n" +
          "The site remains available. Do not resend the same sensitive content.\n"
        // keep-alive : le navigateur conserve l’origine, prochains GET/POST OK
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
      } else {
        // HTTP/2 : pas de frames GOAWAY/RST propres ici — on coupe seulement ce socket
        // (prochaine connexion navigateur = nouvel onglet/requête = OK)
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

    // Après un court délai, accepter à nouveau le trafic (fin de la requête abandonnée)
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

  const flushHoldToUpstream = (): boolean => {
    if (cleaned || discardingRequest) return false
    if (observer.isBlocked()) {
      softBlockRequest("sensitive_data_detected")
      return false
    }
    if (observer.flush()) {
      softBlockRequest("sensitive_data_detected")
      return false
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
    // prêt pour la requête suivante (keep-alive)
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

  try {
    tlsClient = new tls.TLSSocket(clientSocket, {
      isServer: true,
      key: hostPem.key,
      cert: hostPem.cert,
      // HTTP/1.1 en priorité : soft-block par requête fiable (keep-alive)
      ALPNProtocols: enforceMode ? ["http/1.1"] : ["http/1.1", "h2"],
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

  tlsClient.once("secure", () => {
    const alpn =
      typeof tlsClient!.alpnProtocol === "string" && tlsClient!.alpnProtocol
        ? tlsClient!.alpnProtocol
        : "http/1.1"

    const modeLabel = enforceMode ? "enforce_mitm" : "observe_mitm"

    upstream = tls.connect(
      {
        host: targetHost,
        port: targetPort,
        servername: targetHost,
        ALPNProtocols: [alpn, "http/1.1"],
        rejectUnauthorized: true
      },
      () => {
        log("info", "mitm_established", {
          host: targetHost,
          port: targetPort,
          alpn_client: tlsClient?.alpnProtocol || null,
          alpn_upstream: upstream?.alpnProtocol || null,
          mode: modeLabel,
          block_scope: enforceMode ? "request_soft" : "n/a"
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

    // Ne pas cleanup sur close upstream seul si on soft-block (upstream peut rester up)
    upstream.on("close", () => {
      if (!cleaned && !discardingRequest) {
        cleanup("upstream_close")
      }
    })

    const onClientChunk = (chunk: Buffer) => {
      if (cleaned) return

      // Soft-block en cours : on jette le reste de la requête, puis idle → reset
      if (discardingRequest) {
        scheduleRelease()
        return
      }

      if (enforceMode) {
        hold.push(chunk)
        holdBytes += chunk.length
        const block = observer.onClientData(chunk)
        if (block) {
          softBlockRequest("sensitive_data_detected")
          return
        }
        if (holdBytes >= MAX_HOLD_BYTES) {
          softBlockRequest("enforce_buffer_overflow")
          return
        }
        scheduleRelease()
        return
      }

      // observe : pass-through + journal
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
    if (enforceMode && !cleaned && !observer.isBlocked() && holdBytes > 0) {
      flushHoldToUpstream()
    }
    cleanup("client_close")
  })
  clientSocket.on("error", () => cleanup("raw_socket_error"))
}
