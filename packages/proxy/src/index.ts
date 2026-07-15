#!/usr/bin/env node
/**
 * OpsGate Proxy CLI — P0/P1
 *
 *   cd ops-gate
 *   pnpm proxy:gen-ca
 *   pnpm proxy:dev
 *   pnpm proxy:pac
 *   echo "sk-..." | pnpm proxy:inspect
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import {
  caExists,
  caInstallHint,
  CA_CERT_PATH,
  CA_KEY_PATH,
  DATA_DIR,
  generateCa
} from "./certs.js"
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
  console.log(`OpsGate Proxy P1 (MITM observe allowlist)

IMPORTANT: run from monorepo root (ops-gate/), not your home folder.

Usage:
  opsgate-proxy serve              Start proxy 127.0.0.1:8888
  opsgate-proxy gen-ca [--force]   Generate local Dev CA
  opsgate-proxy ca-path            Print CA cert path + install hint
  opsgate-proxy pac [outfile]      Write PAC file
  opsgate-proxy inspect [file|-]   Run @opsgate/engine on text
  opsgate-proxy health-url

Env:
  OPSGATE_PROXY_HOST=127.0.0.1
  OPSGATE_PROXY_PORT=8888
  OPSGATE_PROXY_ALLOWLIST=extra.com
  OPSGATE_PROXY_MITM=1             # 0 = tunnel only (P0 behavior)
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

  if (cmd === "gen-ca") {
    const force = argv.includes("--force")
    const pair = generateCa({ force })
    log("info", "ca_ready", {
      dir: DATA_DIR,
      cert: CA_CERT_PATH,
      key: CA_KEY_PATH,
      force
    })
    console.log(CA_CERT_PATH)
    console.log("\n" + caInstallHint())
    void pair
    return
  }

  if (cmd === "ca-path") {
    console.log("cert:", caExists() ? CA_CERT_PATH : "(missing — run gen-ca)")
    console.log("key: ", caExists() ? CA_KEY_PATH : "(missing)")
    console.log("dir: ", DATA_DIR)
    if (caExists()) console.log("\n" + caInstallHint())
    return
  }

  if (cmd === "serve") {
    if (cfg.mitm && !caExists()) {
      log("warn", "mitm_enabled_but_no_ca", {
        hint: "pnpm proxy:gen-ca then install CA with certutil"
      })
      console.error(
        "\n[OpsGate] MITM activé mais CA absente.\n" +
          "  1) pnpm proxy:gen-ca\n" +
          "  2) certutil -addstore -user Root <chemin-ca-cert.pem>\n" +
          "  3) relancer pnpm proxy:dev\n" +
          "Ou désactiver : $env:OPSGATE_PROXY_MITM=0\n"
      )
    }
    startProxyServer(cfg)
    return
  }

  if (cmd === "pac") {
    const out = argv[1] || path.join(pkgRoot, "opsgate-proxy.pac")
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
