/**
 * MITM TLS borné allowlist — mode observe (P1).
 * Hors allowlist : ne pas appeler (tunnel transparent P0).
 */
import * as net from "node:net"
import * as tls from "node:tls"
import { getHostCert } from "./certs.js"
import { log } from "./log.js"
import { createStreamObserver } from "./observe.js"

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

  const cleanup = (why?: string) => {
    if (cleaned) return
    cleaned = true
    observer.flush()
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

  // Si des octets sont déjà dans head (rare), on les injecte via un push après handshake
  const pendingHead = head?.length ? head : null

  try {
    tlsClient = new tls.TLSSocket(clientSocket, {
      isServer: true,
      key: hostPem.key,
      cert: hostPem.cert,
      ALPNProtocols: ["h2", "http/1.1"],
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
          mode: "observe_mitm"
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

    upstream.on("close", () => cleanup("upstream_close"))

    // Client → upstream
    tlsClient!.on("data", (chunk: Buffer) => {
      observer.onClientData(chunk)
      if (upstream && !upstream.destroyed) {
        try {
          upstream.write(chunk)
        } catch {
          cleanup("upstream_write")
        }
      }
    })

    // Upstream → client
    upstream.on("data", (chunk: Buffer) => {
      if (tlsClient && !tlsClient.destroyed) {
        try {
          tlsClient.write(chunk)
        } catch {
          cleanup("client_write")
        }
      }
    })

    if (pendingHead && tlsClient && !tlsClient.destroyed) {
      // Normalement le handshake TLS démarre depuis le client, head est vide.
      void pendingHead
    }
  })

  tlsClient.on("close", () => cleanup("client_close"))
  clientSocket.on("error", () => cleanup("raw_socket_error"))
}
