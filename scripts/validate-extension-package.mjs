/**
 * Valide un build Plasmo (chrome/firefox/safari) avant chargement navigateur.
 * node scripts/validate-extension-package.mjs [build/chrome-mv3-prod]
 */
import fs from "node:fs"
import path from "node:path"

const dir = path.resolve(process.argv[2] || "build/chrome-mv3-prod")
const errors = []
const warnings = []

function exists(rel) {
  return fs.existsSync(path.join(dir, rel))
}

if (!exists("manifest.json")) {
  console.error("FAIL: no manifest.json in", dir)
  process.exit(1)
}

const m = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"))

if (m.manifest_version !== 3) errors.push("manifest_version must be 3")

const must = [
  m.background?.service_worker,
  m.action?.default_popup,
  m.options_ui?.page
].filter(Boolean)

for (const p of must) {
  if (!exists(p)) errors.push(`missing required file: ${p}`)
}

for (const [k, v] of Object.entries(m.icons || {})) {
  if (!exists(v)) errors.push(`missing icon ${k}: ${v}`)
}

for (const cs of m.content_scripts || []) {
  for (const js of cs.js || []) {
    if (!exists(js)) errors.push(`missing content_script: ${js}`)
  }
  for (const match of cs.matches || []) {
    if (/\s/.test(match)) errors.push(`match has whitespace: ${match}`)
    // Chrome rejects path * not at segment start in some cases; flag odd patterns
    if (match.includes("***")) errors.push(`invalid match: ${match}`)
  }
}

for (const war of m.web_accessible_resources || []) {
  for (const r of war.resources || []) {
    if (!exists(r)) errors.push(`missing web_accessible_resource: ${r}`)
  }
}

function checkHtml(name) {
  if (!exists(name)) return
  const html = fs.readFileSync(path.join(dir, name), "utf8")
  for (const re of [/src="([^"]+)"/g, /href="([^"]+\.js)"/g]) {
    let x
    while ((x = re.exec(html))) {
      const rel = x[1]
      if (rel.startsWith("http") || rel.startsWith("data:")) continue
      if (!exists(rel)) errors.push(`${name} references missing: ${rel}`)
    }
  }
}
checkHtml("popup.html")
checkHtml("options.html")

// SW smoke: file non vide + pas de syntaxe évidente cassée
const sw = m.background?.service_worker
if (sw && exists(sw)) {
  const code = fs.readFileSync(path.join(dir, sw), "utf8")
  if (code.length < 50) warnings.push("service worker suspiciously small")
  // Parcel runtime contains the string "Cannot find module" in its resolver — ignore.
}

// Manifest CSP: blob: in extension_pages often rejected by Chrome load
const csp = m.content_security_policy?.extension_pages || ""
if (/\bblob:\b/.test(csp)) {
  errors.push(
    "CSP extension_pages contains blob: — Chrome may refuse to load the extension"
  )
}
if (csp && !/script-src\s+'self'/.test(csp)) {
  warnings.push("CSP missing script-src 'self'")
}

// Orphan hashed ocr/tesseract (stale load)
const jsFiles = fs.readdirSync(dir).filter((f) => f.endsWith(".js"))
const ocr = jsFiles.filter((f) => f.startsWith("ocr-bitmap."))
const tess = jsFiles.filter((f) => f.startsWith("tesseract.js."))
if (ocr.length > 1) warnings.push(`multiple ocr-bitmap bundles: ${ocr.join(", ")}`)
if (tess.length > 1) warnings.push(`multiple tesseract bundles: ${tess.join(", ")}`)

console.log("dir:", dir)
console.log("name:", m.name, "v" + m.version)
console.log("errors:", errors.length ? errors : "NONE")
console.log("warnings:", warnings.length ? warnings : "NONE")
process.exit(errors.length ? 1 : 0)
