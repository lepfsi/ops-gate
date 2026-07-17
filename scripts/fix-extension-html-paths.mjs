/**
 * Plasmo émet parfois <script src="/popup.xxx.js">.
 * Certains Chrome rejettent le chargement si le chemin absolu pose problème
 * en mode unpacked — on normalise en relatif.
 */
import fs from "node:fs"
import path from "node:path"

const dir = path.resolve(process.argv[2] || "build/chrome-mv3-prod")
for (const name of ["popup.html", "options.html"]) {
  const p = path.join(dir, name)
  if (!fs.existsSync(p)) continue
  let html = fs.readFileSync(p, "utf8")
  const next = html.replace(
    /(src|href)="\/([^"]+)"/g,
    (_, attr, rel) => `${attr}="${rel}"`
  )
  if (next !== html) {
    fs.writeFileSync(p, next, "utf8")
    console.log("fixed absolute paths:", name)
  }
}
