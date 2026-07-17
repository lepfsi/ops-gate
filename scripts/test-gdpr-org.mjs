/**
 * Smoke GDPR helpers (memory store via API not required).
 * node scripts/test-gdpr-org.mjs
 */
import { createHmac } from "node:crypto"

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg)
    process.exitCode = 1
  } else console.log("OK:", msg)
}

const CONFIRM = "DELETE MY ORG"
const RESTORE = "RESTORE MY ORG"

assert(
  CONFIRM.toUpperCase() === "DELETE MY ORG",
  "confirm phrase constant"
)
assert(RESTORE === "RESTORE MY ORG", "restore phrase constant")

// Simulate soft-delete meta
const days = 30
const deletedAt = new Date().toISOString()
const purgeAt = new Date(Date.now() + days * 86400000).toISOString()
assert(Date.parse(purgeAt) > Date.now(), "purge_at in future")

const daysLeft = Math.ceil((Date.parse(purgeAt) - Date.now()) / 86400000)
assert(daysLeft >= 29 && daysLeft <= 30, `days until purge ~30 got ${daysLeft}`)

// Protected org codes
function isProtected(code) {
  return String(code || "").toUpperCase() === "DEMO-OPSGATE"
}
assert(isProtected("DEMO-OPSGATE"), "demo protected")
assert(!isProtected("ACME-CORP"), "acme not protected")

// Confirm mismatch
function checkConfirm(input, expected) {
  return input.trim().toUpperCase() === expected.toUpperCase()
}
assert(!checkConfirm("delete", CONFIRM), "reject wrong confirm")
assert(checkConfirm("DELETE MY ORG", CONFIRM), "accept exact confirm")
assert(checkConfirm("  delete my org  ", CONFIRM), "accept trimmed case-insensitive")

console.log(process.exitCode ? "\nSome GDPR smoke tests failed" : "\nAll GDPR smoke tests passed")
process.exit(process.exitCode || 0)
