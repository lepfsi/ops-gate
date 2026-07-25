/**
 * Extraction SQLite binaire (tranche 3).
 * sql.js (WASM) — pas de better-sqlite3 natif (MSI / multi-arch simple).
 *
 * Produit un texte scannable :
 *  - liste des tables + CREATE
 *  - échantillon de lignes (LIMIT)
 *  - valeurs textuelles pour detectSensitiveData
 */
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { log } from "./log.js"

export const SQLITE_LIMITS = {
  maxTables: 40,
  maxRowsPerTable: 50,
  maxCols: 64,
  maxCellChars: 500,
  maxTotalChars: 1_200_000,
  maxFileBytes: 25_000_000
} as const

export type SqliteExtractResult = {
  text: string
  truncated: boolean
  tableCount: number
  rowSamples: number
  error?: string
}

const SQLITE_MAGIC = Buffer.from("SQLite format 3\0")

export function isSqliteBuffer(buf: Buffer): boolean {
  if (!buf || buf.length < 16) return false
  return buf.subarray(0, 16).equals(SQLITE_MAGIC)
}

type SqlJsDatabase = {
  exec: (sql: string) => Array<{ columns: string[]; values: unknown[][] }>
  close: () => void
}

type SqlJsStatic = {
  Database: new (data?: ArrayLike<number> | Buffer | null) => SqlJsDatabase
}

let sqlJsPromise: Promise<SqlJsStatic> | null = null

async function loadSqlJs(): Promise<SqlJsStatic> {
  if (!sqlJsPromise) {
    sqlJsPromise = (async () => {
      const require = createRequire(import.meta.url)
      // CJS export
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const initSqlJs = require("sql.js") as (cfg?: {
        locateFile?: (f: string) => string
      }) => Promise<SqlJsStatic>

      const here = dirname(fileURLToPath(import.meta.url))
      // tsx: src/ ; runtime package: dist or src next to node_modules
      const candidates = [
        join(here, "../node_modules/sql.js/dist"),
        join(here, "../../node_modules/sql.js/dist"),
        join(process.cwd(), "node_modules/sql.js/dist"),
        join(process.cwd(), "packages/proxy/node_modules/sql.js/dist")
      ]

      const { existsSync } = await import("node:fs")
      let distDir = candidates.find((d) => existsSync(join(d, "sql-wasm.wasm")))
      if (!distDir) {
        // last resort: let sql.js default (may fail)
        distDir = candidates[0]
      }

      const SQL = await initSqlJs({
        locateFile: (file: string) => join(distDir!, file)
      })
      return SQL
    })().catch((e) => {
      sqlJsPromise = null
      throw e
    })
  }
  return sqlJsPromise
}

function cellToString(v: unknown): string {
  if (v == null) return ""
  if (typeof v === "string") return v
  if (typeof v === "number" || typeof v === "bigint") return String(v)
  if (v instanceof Uint8Array || Buffer.isBuffer(v)) {
    // BLOB : hex court + tentative utf8
    const b = Buffer.from(v)
    const asUtf = b.toString("utf8")
    if (
      asUtf.length > 0 &&
      !asUtf.includes("\uFFFD") &&
      /^[\x09\x0a\x0d\x20-\x7e\u00a0-\u00ff]*$/.test(asUtf.slice(0, 200))
    ) {
      return asUtf.slice(0, SQLITE_LIMITS.maxCellChars)
    }
    return `<blob:${b.length}b ${b.subarray(0, 12).toString("hex")}…>`
  }
  return String(v)
}

function quoteIdent(name: string): string {
  return `"${String(name).replace(/"/g, '""')}"`
}

/**
 * Ouvre un .db / .sqlite en mémoire et extrait schéma + échantillons.
 */
export async function extractSqlite(buf: Buffer): Promise<SqliteExtractResult> {
  if (!buf?.length) {
    return {
      text: "",
      truncated: false,
      tableCount: 0,
      rowSamples: 0,
      error: "sqlite_empty"
    }
  }
  if (buf.length > SQLITE_LIMITS.maxFileBytes) {
    return {
      text: "",
      truncated: true,
      tableCount: 0,
      rowSamples: 0,
      error: `SQLite trop volumineux (>${Math.round(SQLITE_LIMITS.maxFileBytes / 1e6)} Mo) pour le scan proxy.`
    }
  }
  if (!isSqliteBuffer(buf)) {
    return {
      text: "",
      truncated: false,
      tableCount: 0,
      rowSamples: 0,
      error: "Pas un fichier SQLite (magic « SQLite format 3 » absent)."
    }
  }

  let db: SqlJsDatabase | null = null
  try {
    const SQL = await loadSqlJs()
    db = new SQL.Database(new Uint8Array(buf))

    const master = db.exec(
      "SELECT name, type, sql FROM sqlite_master WHERE type IN ('table','view') ORDER BY type, name"
    )
    const rows = master[0]?.values || []
    const parts: string[] = []
    parts.push(`# SQLite extract`)
    parts.push(`# size_bytes=${buf.length}`)
    parts.push(`# objects=${rows.length}`)

    let tableCount = 0
    let rowSamples = 0
    let truncated = false
    let total = parts.join("\n").length

    const push = (line: string) => {
      if (total + line.length + 1 > SQLITE_LIMITS.maxTotalChars) {
        truncated = true
        return false
      }
      parts.push(line)
      total += line.length + 1
      return true
    }

    for (const row of rows) {
      if (tableCount >= SQLITE_LIMITS.maxTables) {
        truncated = true
        break
      }
      if (truncated) break

      const name = String(row[0] ?? "")
      const type = String(row[1] ?? "table")
      const sql = row[2] != null ? String(row[2]) : ""
      if (!name || name.startsWith("sqlite_")) continue

      tableCount++
      if (!push(`\n## ${type} ${name}`)) break
      if (sql && !push(sql.slice(0, 4000))) break

      if (type !== "table") continue

      // Sample rows
      try {
        const q = `SELECT * FROM ${quoteIdent(name)} LIMIT ${SQLITE_LIMITS.maxRowsPerTable}`
        const res = db.exec(q)
        if (!res[0]) {
          push(`(empty)`)
          continue
        }
        const cols = res[0].columns.slice(0, SQLITE_LIMITS.maxCols)
        const values = res[0].values
        push(`# columns: ${cols.join(" | ")}`)
        push(`# sample_rows: ${values.length}`)

        for (const vr of values) {
          if (truncated) break
          rowSamples++
          const cells: string[] = []
          for (let c = 0; c < cols.length; c++) {
            const col = cols[c]
            let val = cellToString(vr[c])
            if (val.length > SQLITE_LIMITS.maxCellChars) {
              val = val.slice(0, SQLITE_LIMITS.maxCellChars) + "…"
              truncated = true
            }
            // Ligne type CSV-ish scannable
            cells.push(`${col}=${val}`)
          }
          if (!push(cells.join(" | "))) break
        }

        // Y a-t-il plus de lignes ?
        try {
          const cnt = db.exec(
            `SELECT COUNT(*) FROM ${quoteIdent(name)}`
          )
          const n = Number(cnt[0]?.values?.[0]?.[0] ?? 0)
          if (n > values.length) {
            push(`# … +${n - values.length} row(s) non échantillonnées`)
            truncated = true
          }
        } catch {
          /* ignore count errors */
        }
      } catch (e) {
        push(
          `# sample_error: ${e instanceof Error ? e.message : String(e)}`
        )
      }
    }

    if (tableCount === 0 && !truncated) {
      // empty db or only system tables — still scan printable leftovers
      push("# (aucune table utilisateur)")
    }

    const text = parts.join("\n").trim()
    log("info", "sqlite_extract_ok", {
      bytes: buf.length,
      tables: tableCount,
      rows: rowSamples,
      chars: text.length,
      truncated
    })
    return { text, truncated, tableCount, rowSamples }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    log("warn", "sqlite_extract_failed", { error, bytes: buf.length })
    return {
      text: "",
      truncated: false,
      tableCount: 0,
      rowSamples: 0,
      error: `sqlite_open_failed: ${error}`
    }
  } finally {
    try {
      db?.close()
    } catch {
      /* ignore */
    }
  }
}
