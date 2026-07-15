#!/usr/bin/env node
/**
 * OpsGate Proxy CLI — P0 spike
 *
 *   pnpm proxy:dev                 # serve 127.0.0.1:8888
 *   pnpm proxy:pac                 # écrit opsgate-proxy.pac
 *   pnpm proxy:inspect -- file.txt # engine partagé
 *   echo "sk-test..." | pnpm proxy:inspect
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { loadConfig } from "./config.js"
import { generatePac } from "./pac.js"
import { inspectText } from "./inspect.js"
import { startProxyServer } from "./proxy-server.js"
import { log } from "./log.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pkgRoot = path.resolve(__dirname, "..")

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const c of process.stdin) chunks.push(c as Buffer)
  return Buffer.concat(chunks).toString("utf8")
}

function printHelp() {
  console.log(`OpsGate Proxy P0

Usage:
  opsgate-proxy serve              Start local proxy (default 127.0.0.1:8888)
  opsgate-proxy pac [outfile]      Write PAC file
  opsgate-proxy inspect [file|-]   Run @opsgate/engine on text
  opsgate-proxy health-url         Print local health URL

Env:
  OPSGATE_PROXY_HOST=127.0.0.1
  OPSGATE_PROXY_PORT=8888
  OPSGATE_PROXY_ALLOWLIST=extra.com,other.ai
`)
}

async function main() {
  const argv = process.argv.slice(2)
  const cmd = argv[0] || "serve"
  const cfg = loadConfig()

  if (cmd === "help" || cmd === "-h" || cmd === "--help") {
    printHelp()
    return
  }

  if (cmd === "serve") {
    startProxyServer(cfg)
    // keep alive
    return
  }

  if (cmd === "pac") {
    const out =
      argv[1] || path.join(pkgRoot, "opsgate-proxy.pac")
    const pac = generatePac({
      proxyHost: cfg.host === "0.0.0.0" ? "127.0.0.1" : cfg.host,
      proxyPort: cfg.port,
      allowlist: cfg.allowlist
    })
    fs.writeFileSync(out, pac, "utf8")
    log("info", "pac_written", { path: out, hosts: cfg.allowlist.length })
    console.log(out)
    return
  }

  if (cmd === "inspect") {
    const file = argv[1]
    let text: string
    if (!file || file === "-") {
      text = await readStdin()
    } else {
      text = fs.readFileSync(file, "utf8")
    }
    if (!text.trim()) {
      log("warn", "inspect_empty", {})
      process.exitCode = 2
      return
    }
    const result = inspectText(text)
    log("info", "inspect", {
      detection_count: result.detection_count,
      highest_severity: result.highest_severity,
      rule_ids: result.rule_ids
    })
    console.log(JSON.stringify(result, null, 2))
    return
  }

  if (cmd === "health-url") {
    console.log(`http://${cfg.host}:${cfg.port}/opsgate-proxy/health`)
    return
  }

  console.error(`Unknown command: ${cmd}`)
  printHelp()
  process.exitCode = 1
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
