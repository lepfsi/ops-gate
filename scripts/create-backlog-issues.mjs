/**
 * Crée les issues GitHub du backlog 90j à partir de BACKLOG-90J-import.csv
 *
 * Prérequis : GitHub CLI (`gh auth login`)
 * Usage (racine monorepo) :
 *   node scripts/create-backlog-issues.mjs           # dry-run
 *   node scripts/create-backlog-issues.mjs --apply    # crée les issues
 *   node scripts/create-backlog-issues.mjs --apply --prio P0
 */
import { readFileSync } from "fs"
import { dirname, join } from "path"
import { fileURLToPath } from "url"
import { execSync, spawnSync } from "child_process"

const __dirname = dirname(fileURLToPath(import.meta.url))
const csvPath = join(__dirname, "..", "docs", "BACKLOG-90J-import.csv")
const apply = process.argv.includes("--apply")
const prioFilter = (() => {
  const i = process.argv.indexOf("--prio")
  return i >= 0 ? process.argv[i + 1] : null
})()

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/)
  const headers = splitCsvLine(lines[0])
  return lines.slice(1).map((line) => {
    const cols = splitCsvLine(line)
    const row = {}
    headers.forEach((h, i) => {
      row[h] = cols[i] ?? ""
    })
    return row
  })
}

function splitCsvLine(line) {
  const out = []
  let cur = ""
  let inQ = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"'
        i++
      } else inQ = !inQ
    } else if (c === "," && !inQ) {
      out.push(cur)
      cur = ""
    } else cur += c
  }
  out.push(cur)
  return out
}

function hasGh() {
  try {
    execSync("gh --version", { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

const rows = parseCsv(readFileSync(csvPath, "utf8")).filter((r) => r.ID)
const selected = prioFilter
  ? rows.filter((r) => r.Priority === prioFilter)
  : rows

console.log(
  `${apply ? "APPLY" : "DRY-RUN"} · ${selected.length} tickets` +
    (prioFilter ? ` (prio=${prioFilter})` : "")
)

if (apply && !hasGh()) {
  console.error("GitHub CLI `gh` introuvable. Installez-le puis: gh auth login")
  process.exit(1)
}

for (const r of selected) {
  const labels = [
    r.Priority,
    ...String(r.Component || "")
      .split(";")
      .filter(Boolean)
      .map((c) => `component:${c.trim()}`),
    `type:${r.Type}`
  ]
  const body = [
    `**ID:** ${r.ID}`,
    `**Priority:** ${r.Priority}`,
    `**Component:** ${r.Component}`,
    `**Type:** ${r.Type}`,
    `**Estimate:** ${r.Estimate}`,
    `**Phase:** ${r.Phase}`,
    "",
    "### Description",
    r.Description,
    "",
    "### Acceptance",
    r.Acceptance,
    "",
    "---",
    "Source: `docs/BACKLOG-90J-P0-P2.md`"
  ].join("\n")

  const title = `${r.ID} · ${r.Title}`
  console.log(`- ${title}`)
  console.log(`  labels: ${labels.join(", ")}`)

  if (!apply) continue

  const args = [
    "issue",
    "create",
    "--title",
    title,
    "--body",
    body
  ]
  for (const lab of labels) {
    args.push("--label", lab)
  }
  const res = spawnSync("gh", args, { encoding: "utf8" })
  if (res.status !== 0) {
    console.error(res.stderr || res.stdout)
    // Labels manquants : retry sans labels
    const res2 = spawnSync(
      "gh",
      ["issue", "create", "--title", title, "--body", body],
      { encoding: "utf8" }
    )
    if (res2.status !== 0) {
      console.error("FAILED", r.ID, res2.stderr)
    } else {
      console.log("  →", (res2.stdout || "").trim(), "(sans labels)")
    }
  } else {
    console.log("  →", (res.stdout || "").trim())
  }
}

if (!apply) {
  console.log("\nPour créer sur GitHub: node scripts/create-backlog-issues.mjs --apply")
  console.log("P0 seulement: node scripts/create-backlog-issues.mjs --apply --prio P0")
  console.log("Linear: importer docs/BACKLOG-90J-import.csv")
}
