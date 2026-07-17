/**
 * Smoke Risk Score prompt + Simulation
 * node packages/api/node_modules/tsx/dist/cli.mjs scripts/test-prompt-risk.mjs
 */
import { pathToFileURL } from "node:url"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg)
    process.exitCode = 1
  } else console.log("OK:", msg)
}

const { detectSensitiveData } = await import(
  pathToFileURL(path.join(root, "packages/engine/src/detector.ts")).href
)
const {
  calculatePromptRiskScore,
  buildSimulation,
  DEFAULT_SIMULATION_THRESHOLD
} = await import(
  pathToFileURL(path.join(root, "packages/engine/src/prompt-risk.ts")).href
)

const empty = calculatePromptRiskScore([])
assert(empty.score === 0 && empty.level === "low", "empty → low 0")

const text = `password is SuperSecret!99
Stripe sk_live_EXAMPLEONLY_NOT_A_REAL_KEY
FW-PARIS-01 at 192.168.10.45
config system interface
  set ip 192.168.1.1`
const dets = detectSensitiveData(text)
assert(dets.length >= 2, "has detections")
const risk = calculatePromptRiskScore(dets)
assert(risk.score >= 40, `score elevated (${risk.score})`)
assert(
  ["medium", "high", "critical"].includes(risk.level),
  `level not low (${risk.level})`
)
assert(risk.factors.length >= 1, "has factors")
assert(
  risk.recommendation === "secure_rewrite" || risk.recommendation === "mask",
  "recommends mask/rewrite"
)
assert(risk.score >= DEFAULT_SIMULATION_THRESHOLD, "above sim threshold")

const sim = buildSimulation(dets)
assert(sim.detectedItems.length >= 1, "sim items")
assert(sim.impact === risk.level, "impact matches level")
assert(sim.riskScore.score === risk.score, "sim embeds risk")
console.log("score", risk.score, risk.level, risk.recommendationLabel)
console.log(
  "items",
  sim.detectedItems.map((i) => i.label).join(" | ")
)

console.log(
  process.exitCode ? "\nSome prompt-risk tests failed" : "\nAll prompt-risk tests passed"
)
process.exit(process.exitCode || 0)
