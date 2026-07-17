import { createRequire } from "node:module"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { fileURLToPath } from "node:url"

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")
const det = await import(
  pathToFileURL(path.join(root, "packages/engine/src/detector.ts")).href
)
const rw = await import(
  pathToFileURL(path.join(root, "packages/engine/src/secure-rewrite.ts")).href
)

const samples = [
  // Clés factices (pas de vrais secrets — contournent le secret scanning)
  "password Admin@2024 secret key sk_live_EXAMPLEONLY01 and FW-PARIS-01 at 192.168.1.10",
  `password: SuperSecret!99

password is SuperSecret!99

Use this Stripe key sk_live_EXAMPLEONLY_NOT_A_REAL_KEY

config system interface
    edit "port1"
        set ip 192.168.10.45 255.255.255.0`,
]

for (const t of samples) {
  const d = det.detectSensitiveData(t)
  console.log("\n=== DETECTIONS", d.length)
  for (const x of d)
    console.log(" ", x.ruleId, JSON.stringify(x.match), x.severity)
  const r = rw.secureRewrite(t, d, {
    consistentMapping: true,
    aggressiveness: 2,
  })
  console.log("=== REWRITE OUT ===")
  console.log(r.rewrittenText)
  console.log(
    "changes:",
    r.changes
      .map(
        (c) =>
          `${c.category} ${JSON.stringify(c.original)} -> ${JSON.stringify(c.replacement)}`
      )
      .join("\n ")
  )
}
