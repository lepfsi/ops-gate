/**
 * Proxy HTTP(S) — P0 tunnel + P1 MITM observe (allowlist only).
 */
import * as net from "node:net"
import * as http from "node:http"
import { isAllowlisted } from "./allowlist.js"
import { caExists } from "./certs.js"
import type { ProxyConfig } from "./config.js"
import { log } from "./log.js"
import { mitmConnect } from "./mitm.js"
import { createStreamObserver } from "./observe.js"
import { generatePac } from "./pac.js"

function parseHostPort(
  hostHeader: string,
  defaultPort: number
): { host: string; port: number } {
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

function handleHttp(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  cfg: ProxyConfig
) {
  const url = req.url || "/"
  let target: URL
  try {
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

  const chunks: Buffer[] = []
  const observer =
    allowlisted && cfg.mitm
      ? createStreamObserver({ host })
      : null

  req.on("data", (c: Buffer) => {
    chunks.push(c)
    observer?.onClientData(c)
  })

  req.on("end", () => {
    observer?.flush()
    const body = Buffer.concat(chunks)
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
      log("warn", "http_relay_error", {
        host,
        error: String(err.message || err)
      })
      if (!res.headersSent) res.writeHead(502)
      res.end("Bad Gateway")
    })
    if (body.length) preq.write(body)
    preq.end()
  })
}

export function startProxyServer(cfg: ProxyConfig): http.Server {
  const server = http.createServer((req, res) => {
    const urlPath = (req.url || "").split("?")[0]
    if (urlPath === "/opsgate-proxy/health" || urlPath === "/healthz") {
      res.writeHead(200, { "content-type": "application/json" })
      res.end(
        JSON.stringify({
          ok: true,
          phase: "P1",
          mode: cfg.mode,
          mitm: cfg.mitm,
          ca_ready: caExists(),
          allowlist: cfg.allowlist,
          listen: `${cfg.host}:${cfg.port}`
        })
      )
      return
    }
    // PAC servi en HTTP (Chrome Windows ignore souvent file:///)
    if (
      urlPath === "/opsgate-proxy.pac" ||
      urlPath === "/opsgate-proxy/pac" ||
      urlPath === "/proxy.pac"
    ) {
      const pacHost = cfg.host === "0.0.0.0" ? "127.0.0.1" : cfg.host
      const body = generatePac({
        proxyHost: pacHost,
        proxyPort: cfg.port,
        allowlist: cfg.allowlist
      })
      res.writeHead(200, {
        "content-type": "application/x-ns-proxy-autoconfig",
        "cache-control": "no-store"
      })
      res.end(body)
      log("info", "pac_served", { path: urlPath })
      return
    }
    handleHttp(req, res, cfg)
  })

  server.on("connect", (req, clientSocket, head) => {
    const { host, port } = parseHostPort(req.url || "", 443)
    const allowlisted = isAllowlisted(host, cfg.allowlist)
    const sock = clientSocket as net.Socket
    const headBuf = (head as Buffer) || Buffer.alloc(0)

    if (allowlisted && cfg.mitm) {
      if (!caExists()) {
        log("error", "mitm_skipped_no_ca", {
          host,
          hint: "pnpm --filter @opsgate/proxy gen-ca"
        })
        tunnel(sock, headBuf, host, port, {
          allowlisted: true,
          mode: "observe_tunnel_fallback_no_ca"
        })
        return
      }
      log("info", "connect", {
        host,
        port,
        allowlisted: true,
        mode: "observe_mitm"
      })
      mitmConnect({
        clientSocket: sock,
        head: headBuf,
        targetHost: host,
        targetPort: port
      })
      return
    }

    const mode = allowlisted ? "observe_tunnel" : "direct_tunnel"
    log("info", "connect", { host, port, allowlisted, mode })
    tunnel(sock, headBuf, host, port, { allowlisted, mode })
  })

  server.on("clientError", (err, socket) => {
    log("debug", "client_error", { error: String(err.message || err) })
    try {
      socket.end("HTTP/1.1 400 Bad Request\r\n\r\n")
    } catch {
      /* ignore */
    }
  })

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      log("error", "listen_eaddrinuse", {
        host: cfg.host,
        port: cfg.port,
        hint:
          "Port already in use. Free it (PowerShell): Get-NetTCPConnection -LocalPort " +
          cfg.port +
          " | % { Stop-Process -Id $_.OwningProcess -Force }  — or set OPSGATE_PROXY_PORT=8889"
      })
      console.error(
        `\n[OpsGate] Port ${cfg.host}:${cfg.port} déjà utilisé (EADDRINUSE).\n` +
          `  Libérer : Get-NetTCPConnection -LocalPort ${cfg.port} | % { Stop-Process -Id $_.OwningProcess -Force }\n` +
          `  Ou autre port : $env:OPSGATE_PROXY_PORT=8889; pnpm proxy:dev\n`
      )
      process.exitCode = 1
      return
    }
    log("error", "listen_error", { error: String(err.message || err) })
    throw err
  })

  server.listen(cfg.port, cfg.host, () => {
    log("info", "listening", {
      host: cfg.host,
      port: cfg.port,
      phase: "P1",
      mitm: cfg.mitm,
      ca_ready: caExists(),
      allowlist_count: cfg.allowlist.length,
      allowlist: cfg.allowlist,
      note: cfg.mitm
        ? "MITM observe on allowlist — install CA (gen-ca + certutil)"
        : "MITM off — tunnel only (OPSGATE_PROXY_MITM=0)"
    })
  })

  return server
}
