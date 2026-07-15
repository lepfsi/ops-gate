#!/usr/bin/env node
/**
 * Constructeur : émet une licence courte OPS-XXXX-XXXX-XXXX-XXXX liée à un orgCode.
 *
 * Usage:
 *   node scripts/issue-license.mjs --org SAMPLE-OPSGATE --company "Sample Enterprise" ...
 *
 * Avec DATABASE_URL (et module pg disponible) : stocke en base.
 * Sinon : affiche la clé + SQL.
 */
import { createHash, randomBytes } from "node:crypto"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const ALPH = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
const require = createRequire(import.meta.url)
const __dirname = dirname(fileURLToPath(import.meta.url))

function arg(name, fallback = "") {
  const i = process.argv.indexOf(`--${name}`)
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1]
  return fallback
}

function shortKey() {
  const h = createHash("sha256").update(randomBytes(16)).digest()
  let out = ""
  for (let i = 0; i < 16; i++) out += ALPH[h[i] % ALPH.length]
  return `OPS-${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}-${out.slice(12, 16)}`
}

const orgCode = arg("org", "SAMPLE-OPSGATE").toUpperCase()
const companyName = arg("company", "Sample Enterprise")
const address = arg("address", "42 Avenue Sample, 75008 Paris")
const contactEmail = arg("email", "licence@sample.enterprise").toLowerCase()
const seats = Number(arg("seats", "50")) || 50
let expiresAt = arg("expires", "")
if (!expiresAt) {
  const d = new Date()
  d.setFullYear(d.getFullYear() + 1)
  expiresAt = d.toISOString()
} else if (expiresAt.length <= 10) {
  expiresAt = new Date(expiresAt + "T23:59:59.000Z").toISOString()
}

const key = shortKey()
const id = `lic_${randomBytes(8).toString("hex")}`
const issuedAt = new Date().toISOString()
const payload = {
  v: 1,
  orgCode,
  companyName,
  address,
  contactEmail,
  seats,
  expiresAt,
  issuedAt
}

const esc = (s) => String(s).replace(/'/g, "''")
const sql = `INSERT INTO issued_licenses (id, license_key, org_code, company_name, address, contact_email, seats, expires_at, issued_at)
VALUES ('${id}', '${key}', '${esc(orgCode)}', '${esc(companyName)}', '${esc(address)}', '${esc(contactEmail)}', ${seats}, '${expiresAt}', '${issuedAt}');`

async function tryStore() {
  const dbUrl = process.env.DATABASE_URL
  if (!dbUrl) return false
  let Pool
  try {
    ;({ Pool } = require(join(__dirname, "../packages/api/node_modules/pg")))
  } catch {
    try {
      ;({ Pool } = require("pg"))
    } catch {
      return false
    }
  }
  const pool = new Pool({ connectionString: dbUrl })
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS issued_licenses (
        id TEXT PRIMARY KEY,
        license_key TEXT NOT NULL UNIQUE,
        org_code TEXT NOT NULL,
        company_name TEXT NOT NULL,
        address TEXT NOT NULL DEFAULT '',
        contact_email TEXT NOT NULL DEFAULT '',
        seats INT NOT NULL DEFAULT 0,
        expires_at TIMESTAMPTZ NOT NULL,
        issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        revoked_at TIMESTAMPTZ
      )`)
    await pool.query(
      `INSERT INTO issued_licenses (id, license_key, org_code, company_name, address, contact_email, seats, expires_at, issued_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        id,
        key,
        orgCode,
        companyName,
        address,
        contactEmail,
        seats,
        expiresAt,
        issuedAt
      ]
    )
    return true
  } finally {
    await pool.end()
  }
}

const stored = await tryStore().catch(() => false)
console.log(
  JSON.stringify(
    {
      key,
      payload,
      stored,
      paper_format: key,
      note: stored
        ? "Clé en base : activez-la dans la console (principal) sur l'org correspondante."
        : "Pas de DATABASE_URL/pg : exécutez le SQL ci-dessous sur Postgres.",
      sql: stored ? undefined : sql
    },
    null,
    2
  )
)
