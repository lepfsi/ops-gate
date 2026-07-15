#!/usr/bin/env node
/**
 * OpsGate Proxy CLI — P0/P1/P2
 *
 *   cd ops-gate
 *   pnpm proxy:gen-ca
 *   pnpm proxy:enroll          # API doit tourner
 *   pnpm proxy:dev
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
import { enrollProxy, flushEvents, getOrLoadState } from "./api-client.js"
import {
  clearAgentState,
  loadAgentState,
  AGENT_STATE_PATH
} from "./agent-state.js"
import { setAgentStateGetter } from "./observe.js"
import { startConfigPoll } from "./sync.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pkgRoot = path.resolve(__dirname, "..")

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const c of process.stdin) chunks.push(c as Buffer)
  return Buffer.concat(chunks).toString("utf8")
}

function printHelp() {
  console.log(`OpsGate Proxy P2 (MITM observe + control plane)

Run from monorepo root (ops-gate/).

Usage:
  opsgate-proxy serve              Start proxy 127.0.0.1:8888
  opsgate-proxy enroll             Enroll as proxy agent (API)
  opsgate-proxy status             Show CA + enroll state
  opsgate-proxy logout             Clear local agent token
  opsgate-proxy gen-ca [--force]   Generate local Dev CA
  opsgate-proxy ca-path
  opsgate-proxy pac [outfile]
  opsgate-proxy inspect [file|-]
  opsgate-proxy health-url

Env:
  OPSGATE_PROXY_HOST=127.0.0.1
  OPSGATE_PROXY_PORT=8888
  OPSGATE_PROXY_ALLOWLIST=extra.com
  OPSGATE_PROXY_MITM=1
  OPSGATE_API_URL=http://127.0.0.1:8787
  OPSGATE_ORG_CODE=DEMO-OPSGATE
  OPSGATE_PROXY_AUTO_ENROLL=1      # enroll on serve if no token
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
    generateCa({ force })
    log("info", "ca_ready", {
      dir: DATA_DIR,
      cert: CA_CERT_PATH,
      key: CA_KEY_PATH,
      force
    })
    console.log(CA_CERT_PATH)
    console.log("\n" + caInstallHint())
    return
  }

  if (cmd === "ca-path") {
    console.log("cert:", caExists() ? CA_CERT_PATH : "(missing — run gen-ca)")
    console.log("key: ", caExists() ? CA_KEY_PATH : "(missing)")
    console.log("dir: ", DATA_DIR)
    if (caExists()) console.log("\n" + caInstallHint())
    return
  }

  if (cmd === "enroll") {
    const state = await enrollProxy({
      apiBase: cfg.apiBase,
      orgCode: cfg.orgCode
    })
    console.log(
      JSON.stringify(
        {
          ok: true,
          agent_id: state.agent_id,
          org_id: state.org_id,
          org_code: state.org_code,
          api_base: state.api_base,
          state_file: AGENT_STATE_PATH
        },
        null,
        2
      )
    )
    return
  }

  if (cmd === "logout") {
    clearAgentState()
    log("info", "proxy_logout", { path: AGENT_STATE_PATH })
    console.log("Local agent token cleared.")
    return
  }

  if (cmd === "status") {
    const st = loadAgentState()
    console.log(
      JSON.stringify(
        {
          ca_ready: caExists(),
          ca_cert: caExists() ? CA_CERT_PATH : null,
          enrolled: !!st,
          agent_id: st?.agent_id || null,
          org_id: st?.org_id || null,
          org_code: st?.org_code || null,
          api_base: st?.api_base || cfg.apiBase,
          device_label: st?.device_label || null,
          state_file: AGENT_STATE_PATH
        },
        null,
        2
      )
    )
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

    let agent = getOrLoadState()
    if (!agent && cfg.autoEnroll) {
      try {
        agent = await enrollProxy({
          apiBase: cfg.apiBase,
          orgCode: cfg.orgCode
        })
        console.log(
          `[OpsGate] Proxy enrolled → agent_id=${agent.agent_id} org=${agent.org_code}`
        )
      } catch (e) {
        log("warn", "auto_enroll_failed", {
          error: String((e as Error).message || e),
          api: cfg.apiBase,
          org: cfg.orgCode,
          hint: "Start API (pnpm api:dev) then: pnpm proxy:enroll"
        })
        console.error(
          `\n[OpsGate] Auto-enroll échoué (${cfg.apiBase} / ${cfg.orgCode}).\n` +
            `  Démarrez l’API puis : pnpm proxy:enroll\n` +
            `  Le proxy tourne quand même en observe local (sans events console).\n`
        )
      }
    } else if (agent) {
      log("info", "proxy_agent_loaded", {
        agent_id: agent.agent_id,
        org_id: agent.org_id
      })
    }

    setAgentStateGetter(() => getOrLoadState())

    const server = startProxyServer(cfg)
    // P3 foundation — heartbeat + flags proxy (observe|enforce stub)
    const stopPoll = startConfigPoll(() => getOrLoadState(), 120_000)

    const shutdown = () => {
      stopPoll()
      const st = getOrLoadState()
      if (st) void flushEvents(st)
      try {
        server.close()
      } catch {
        /* ignore */
      }
      process.exit(0)
    }
    process.on("SIGINT", shutdown)
    process.on("SIGTERM", shutdown)
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
