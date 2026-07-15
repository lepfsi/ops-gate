/**
 * Proxy HTTP(S) P0 — CONNECT tunnel + classification allowlist.
 * HTTPS body inspection = P1 (MITM borné).
 */
import * as net from "node:net"
import * as http from "node:http"
import { isAllowlisted } from "./allowlist.js"
import type { ProxyConfig } from "./config.js"
import { log } from "./log.js"

function parseHostPort(
  hostHeader: string,
  defaultPort: number
): { host: string; port: number } {
  // IPv6 [addr]:port or host:port
  if (hostHeader.startsWith("[")) {
    const end = hostHeader.indexOf("]")
    const host = hostHeader.slice(1, end)
    const rest = hostHeader.slice(end + 1)
    const port = rest.startsWith(":")
      ? Number(rest.slice(1)) || defaultPort
      : defaultPort
    return { host, port }
  }
  const idx = hostHeader.lastIndexOf(":")
  if (idx > 0 && hostHeader.indexOf(":") === idx) {
    return {
      host: hostHeader.slice(0, idx),
      port: Number(hostHeader.slice(idx + 1)) || defaultPort
    }
  }
  return { host: hostHeader, port: defaultPort }
}

function tunnel(
  clientReq: http.IncomingMessage,
  clientSocket: net.Socket,
  head: Buffer,
  targetHost: string,
  targetPort: number,
  meta: { allowlisted: boolean; mode: string }
) {
  const upstream = net.connect(targetPort, targetHost, () => {
    clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n")
    if (head?.length) upstream.write(head)
    upstream.pipe(clientSocket)
    clientSocket.pipe(upstream)
  })

  upstream.on("error", (err) => {
    log("warn", "upstream_error", {
      host: targetHost,
      port: targetPort,
      error: String(err.message || err),
      ...meta
    })
    try {
      clientSocket.end()
    } catch {
      /* ignore */
    }
  })

  clientSocket.on("error", () => {
    try {
      upstream.destroy()
    } catch {
      /* ignore */
    }
  })
}

/**
 * HTTP plain (rare pour les sites IA) — on log + optionnellement inspecte body en observe.
 * P0 : log only, pas de rewrite.
 */
function handleHttp(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  cfg: ProxyConfig
) {
  const url = req.url || "/"
  let target: URL
  try {
    // Absolute-form for proxy requests
    target = new URL(url)
  } catch {
    res.writeHead(400)
    res.end("Bad URL")
    return
  }

  const host = target.hostname
  const allowlisted = isAllowlisted(host, cfg.allowlist)
  log("info", "http_request", {
    method: req.method,
    host,
    path: target.pathname,
    allowlisted,
    mode: allowlisted ? "observe_http" : "relay_http"
  })

  const headers: http.OutgoingHttpHeaders = { ...req.headers, host: target.host }
  delete headers["proxy-connection"]
  delete headers["Proxy-Connection"]

  const preq = http.request(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || 80,
      path: target.pathname + target.search,
      method: req.method,
      headers
    },
    (pres) => {
      res.writeHead(pres.statusCode || 502, pres.headers)
      pres.pipe(res)
    }
  )
  preq.on("error", (err) => {
    log("warn", "http_relay_error", { host, error: String(err.message || err) })
    if (!res.headersSent) res.writeHead(502)
    res.end("Bad Gateway")
  })
  req.pipe(preq)
}

export function startProxyServer(cfg: ProxyConfig): http.Server {
  const server = http.createServer((req, res) => {
    // Health local (jamais via PAC vers l’extérieur)
    if (req.url === "/opsgate-proxy/health" || req.url === "/healthz") {
      res.writeHead(200, { "content-type": "application/json" })
      res.end(
        JSON.stringify({
          ok: true,
          phase: "P0",
          mode: cfg.mode,
          allowlist: cfg.allowlist,
          listen: `${cfg.host}:${cfg.port}`
        })
      )
      return
    }
    handleHttp(req, res, cfg)
  })

  server.on("connect", (req, clientSocket, head) => {
    const { host, port } = parseHostPort(req.url || "", 443)
    const allowlisted = isAllowlisted(host, cfg.allowlist)
    const mode = allowlisted ? "observe_tunnel" : "direct_tunnel"

    log("info", "connect", {
      host,
      port,
      allowlisted,
      mode
    })

    // P0 : tunnel dans tous les cas (pas de MITM).
    // P1 : si allowlisted → TLS terminate + inspect JSON.
    tunnel(req, clientSocket as net.Socket, head as Buffer, host, port, {
      allowlisted,
      mode
    })
  })

  server.on("clientError", (err, socket) => {
    log("debug", "client_error", { error: String(err.message || err) })
    try {
      socket.end("HTTP/1.1 400 Bad Request\r\n\r\n")
    } catch {
      /* ignore */
    }
  })

  server.listen(cfg.port, cfg.host, () => {
    log("info", "listening", {
      host: cfg.host,
      port: cfg.port,
      allowlist_count: cfg.allowlist.length,
      allowlist: cfg.allowlist,
      note: "P0 CONNECT tunnel only — HTTPS body inspect = P1"
    })
  })

  return server
}
