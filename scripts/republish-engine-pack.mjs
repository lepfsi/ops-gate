/**
 * Republie le pack moteur (@opsgate/engine) pour toutes les orgs Postgres.
 * Corrige IBAN (checksum, patterns espacés, plus de keywords obligatoires côté pack).
 * Usage: node --import tsx scripts/republish-engine-pack.mjs
 */
import pg from "pg"
import { getRules } from "@opsgate/engine"
import { materializePack, nextFreeVersion } from "../packages/api/src/rules-pack.ts"

const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ||
    "postgres://opsgate:opsgate@127.0.0.1:5432/opsgate"
})

async function main() {
  const client = await pool.connect()
  try {
    await client.query("SET app.rls_bypass = on")
    const rules = getRules()
    const iban = rules.find((r) => r.id === "iban")
    console.log("IBAN rule from engine:", JSON.stringify(iban, null, 2))

    const { rows: orgs } = await client.query(`SELECT id, name FROM organizations`)
    for (const org of orgs) {
      const { rows: versions } = await client.query(
        `SELECT version, active FROM rule_packs WHERE org_id = $1`,
        [org.id]
      )
      const active = versions.find((v) => v.active)
      const next = nextFreeVersion(
        versions.map((v) => v.version),
        active?.version
      )
      const pack = materializePack({
        orgId: org.id,
        version: next,
        rules,
        notes: "IBAN fix: checksum + spaced patterns, no keyword gate (engine 1.2)",
        publishedBy: "system-iban-fix",
        active: true
      })

      await client.query(`UPDATE rule_packs SET active = FALSE WHERE org_id = $1`, [
        org.id
      ])
      await client.query(
        `INSERT INTO rule_packs (
          org_id, version, pack_id, schema_version, min_engine_version,
          checksum, signature, rules, notes, published_at, published_by, active
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,true)
        ON CONFLICT (org_id, version) DO UPDATE SET
          active = TRUE,
          checksum = EXCLUDED.checksum,
          signature = EXCLUDED.signature,
          rules = EXCLUDED.rules,
          notes = EXCLUDED.notes,
          published_at = EXCLUDED.published_at,
          published_by = EXCLUDED.published_by`,
        [
          pack.orgId,
          pack.version,
          pack.packId,
          pack.schemaVersion,
          pack.minEngineVersion ?? null,
          pack.checksum,
          pack.signature,
          JSON.stringify(pack.rules),
          pack.notes ?? null,
          pack.publishedAt,
          pack.publishedBy
        ]
      )
      await client.query(
        `UPDATE policies SET rules_pack_version = $2, config_epoch = config_epoch + 1, updated_at = now() WHERE org_id = $1`,
        [org.id, pack.version]
      )
      console.log(
        `OK ${org.name} (${org.id.slice(0, 12)}…) → pack ${pack.version} active, epoch++`
      )
    }
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})


