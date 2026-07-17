/**
 * Supprime les bundles hashés non référencés par le manifest (orphelins Plasmo).
 * node scripts/prune-extension-orphans.mjs build/chrome-mv3-prod
 */
import fs from "node:fs"
import path from "node:path"

const dir = path.resolve(process.argv[2] || "build/chrome-mv3-prod")
const manPath = path.join(dir, "manifest.json")
if (!fs.existsSync(manPath)) {
  console.error("no manifest")
  process.exit(1)
}
const m = JSON.parse(fs.readFileSync(manPath, "utf8"))
const keep = new Set(["manifest.json", "popup.html", "options.html"])

function add(p) {
  if (p && typeof p === "string") keep.add(p.replace(/^\//, ""))
}
add(m.background?.service_worker)
add(m.action?.default_popup)
add(m.options_ui?.page)
for (const v of Object.values(m.icons || {})) add(v)
for (const v of Object.values(m.action?.default_icon || {})) add(v)
for (const cs of m.content_scripts || []) {
  for (const js of cs.js || []) add(js)
  for (const css of cs.css || []) add(css)
}
for (const war of m.web_accessible_resources || []) {
  for (const r of war.resources || []) add(r)
}
// HTML may reference scripts
for (const name of ["popup.html", "options.html"]) {
  const p = path.join(dir, name)
  if (!fs.existsSync(p)) continue
  const html = fs.readFileSync(p, "utf8")
  for (const re of [/src="([^"]+)"/g, /href="([^"]+)"/g]) {
    let x
    while ((x = re.exec(html))) {
      const rel = x[1].replace(/^\//, "")
      if (!rel.startsWith("http")) keep.add(rel)
    }
  }
}

// Keep entire static/ tree for service worker deps
function walkKeep(rel) {
  const full = path.join(dir, rel)
  if (!fs.existsSync(full)) return
  const st = fs.statSync(full)
  if (st.isDirectory()) {
    for (const name of fs.readdirSync(full)) walkKeep(path.join(rel, name))
  } else {
    keep.add(rel.replace(/\\/g, "/"))
  }
}
walkKeep("static")

let removed = 0
for (const name of fs.readdirSync(dir)) {
  const full = path.join(dir, name)
  if (fs.statSync(full).isDirectory()) continue
  const rel = name
  if (keep.has(rel)) continue
  // only prune hashed leftover bundles
  if (
    /^(ocr-bitmap|tesseract\.js|office-extract|mammoth|pdf|zip-min)\.[a-f0-9]+\.js$/.test(
      rel
    ) ||
    /\.[a-f0-9]{8,}\.js$/.test(rel)
  ) {
    // if not in keep, remove
    if (!keep.has(rel)) {
      fs.unlinkSync(full)
      removed++
      console.log("pruned", rel)
    }
  }
}
console.log("pruned files:", removed)
