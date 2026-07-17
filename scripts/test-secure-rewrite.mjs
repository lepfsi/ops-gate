/**
 * Smoke Secure Rewrite
 * node packages/api/node_modules/tsx/dist/cli.mjs scripts/test-secure-rewrite.mjs
 */
import { pathToFileURL } from "node:url"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, "..")

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg)
    process.exitCode = 1
  } else console.log("OK:", msg)
}

const { secureRewrite, estimateRiskScore } = await import(
  pathToFileURL(path.join(root, "packages/engine/src/secure-rewrite.ts")).href
)
const { detectSensitiveData } = await import(
  pathToFileURL(path.join(root, "packages/engine/src/detector.ts")).href
)

const text = `
Admin password is SuperSecret!99
API key sk_live_EXAMPLEONLY_NOT_A_REAL_KEY
Firewall FW-PARIS-CORE-01 has IP 192.168.10.45
Contact jean.dupont@entreprise.com
`
const detections = [
  {
    ruleId: "password-assignment",
    type: "Password",
    category: "general",
    severity: "high",
    match: "password is SuperSecret!99",
    actionDefault: "mask"
  },
  {
    ruleId: "stripe-keys",
    type: "Stripe key",
    category: "general",
    severity: "high",
    match: "sk_live_EXAMPLEONLY_NOT_A_REAL_KEY",
    actionDefault: "mask"
  },
  {
    ruleId: "ip-private-block",
    type: "Private IP",
    category: "infra",
    severity: "medium",
    match: "192.168.10.45",
    actionDefault: "warn"
  },
  {
    ruleId: "device-hostname",
    type: "Hostname",
    category: "infra",
    severity: "medium",
    match: "FW-PARIS-CORE-01",
    actionDefault: "warn"
  },
  {
    ruleId: "email-address",
    type: "Email",
    category: "general",
    severity: "low",
    match: "jean.dupont@entreprise.com",
    actionDefault: "warn"
  }
]
const r = secureRewrite(text, detections, { consistentMapping: true })
assert(!r.rewrittenText.includes("SuperSecret!99"), "password redacted")
assert(/password/i.test(r.rewrittenText), "keeps password keyword")
assert(
  !r.rewrittenText.includes("sk_live_EXAMPLEONLY_NOT_A_REAL_KEY"),
  "api key redacted"
)
assert(
  r.rewrittenText.includes("********") || r.rewrittenText.includes("[REDACTED]"),
  "has rewrite tokens"
)
assert(
  r.rewrittenText.includes("192.168.x.x") || r.rewrittenText.includes("10.x.x.x"),
  "private IP generalized"
)
assert(!r.rewrittenText.includes("jean.dupont@entreprise.com"), "email rewritten")
assert(!r.rewrittenText.includes("FW-PARIS-CORE-01"), "hostname rewritten")
assert(r.originalRiskScore > r.remainingRiskScore, "risk decreased")
assert(r.stats.totalReplacements >= 4, "multiple replacements")
assert(estimateRiskScore(detections) >= 40, "risk score non-trivial")

const text2 = "Host FW-PARIS-CORE-01 and again FW-PARIS-CORE-01"
const d2 = [
  {
    ruleId: "device-hostname",
    type: "Hostname",
    category: "infra",
    severity: "medium",
    match: "FW-PARIS-CORE-01",
    actionDefault: "warn"
  }
]
const r2 = secureRewrite(text2, d2, { consistentMapping: true })
assert(!r2.rewrittenText.includes("FW-PARIS-CORE-01"), "hostname gone")
const parts = r2.rewrittenText.match(/[a-z]+-device-\d+/gi) || []
assert(parts.length === 2 && parts[0] === parts[1], "consistent hostname mapping")

// fortinet structure
const fort = `config system interface
    edit "port1"
        set ip 192.168.10.45 255.255.255.0`
const df = detectSensitiveData(fort)
const rf = secureRewrite(fort, df, { consistentMapping: true })
assert(rf.rewrittenText.includes("config system interface"), "keeps fortinet structure")
assert(rf.rewrittenText.includes('edit "port1"'), "keeps edit port")
assert(rf.rewrittenText.includes("192.168.x.x"), "ip in config rewritten")
assert(!/CONF-\d+/.test(rf.rewrittenText), "no bogus CONF-NN")

// user first sample
const u1 =
  "password Admin@2024 secret key sk_live_EXAMPLEONLY01 and FW-PARIS-01 at 192.168.1.10"
const du = detectSensitiveData(u1)
const ru = secureRewrite(u1, du, { consistentMapping: true })
assert(ru.rewrittenText.includes("password"), "u1 keeps password word")
assert(ru.rewrittenText.includes("********"), "u1 password value")
assert(ru.rewrittenText.includes("sk_live_[REDACTED]"), "u1 stripe")
assert(ru.rewrittenText.includes("192.168.x.x"), "u1 ip")
assert(!ru.rewrittenText.includes("FW-PARIS-01"), "u1 hostname")
assert(!ru.rewrittenText.includes("Admin@2024"), "u1 secret gone")

console.log("\nSample rewrite:\n", r.rewrittenText)
console.log("\nUser sample:\n", ru.rewrittenText)
console.log(
  process.exitCode
    ? "\nSome secure-rewrite tests failed"
    : "\nAll secure-rewrite tests passed"
)
process.exit(process.exitCode || 0)
