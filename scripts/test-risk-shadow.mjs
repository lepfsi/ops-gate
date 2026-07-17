/**
 * Smoke risk-shadow formula (no DB required)
 * node packages/api/node_modules/tsx/dist/cli.mjs scripts/test-risk-shadow.mjs
 */
import { pathToFileURL } from "node:url"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")
function assert(c, m) {
  if (!c) {
    console.error("FAIL", m)
    process.exitCode = 1
  } else console.log("OK", m)
}

const {
  computeScoreFromEvents,
  normalizeAiTool,
  parsePeriod
} = await import(
  pathToFileURL(path.join(root, "packages/api/src/risk-shadow.ts")).href
)

assert(parsePeriod("7d") === "7d", "period 7d")
assert(parsePeriod("x") === "30d", "period default")
assert(normalizeAiTool("www.chatgpt.com") === "chatgpt.com", "normalize host")
assert(normalizeAiTool("") === "", "empty host")

const now = new Date().toISOString()
const events = [
  {
    id: "1",
    orgId: "o",
    agentId: "a1",
    receivedAt: now,
    ts: now,
    source: "prompt",
    hostname: "chatgpt.com",
    decision: "send_anyway",
    detection_count: 2,
    highest_severity: "high",
    rule_ids: [],
    types: [],
    client_event_id: "c1",
    schema_version: 1
  },
  {
    id: "2",
    orgId: "o",
    agentId: "a1",
    receivedAt: now,
    ts: now,
    source: "prompt",
    hostname: "poe.com",
    decision: "mask_send",
    detection_count: 1,
    highest_severity: "medium",
    rule_ids: [],
    types: [],
    client_event_id: "c2",
    schema_version: 1
  }
]

const unauth = new Set(["poe.com"])
const r = computeScoreFromEvents(events, unauth)
// high: 8*2=16 + send_anyway high 12 + medium 4 + shadow unauth 15 = 47
assert(r.score >= 40, `score ${r.score}`)
assert(r.tools.includes("chatgpt.com") && r.tools.includes("poe.com"), "tools")
assert(r.factors.shadow_unauthorized === 1, "shadow factor")
assert(r.factors.send_anyway_high === 1, "send_anyway factor")

console.log(
  process.exitCode ? "\nFAIL risk-shadow" : "\nAll risk-shadow smoke OK",
  "score=",
  r.score
)
process.exit(process.exitCode || 0)
