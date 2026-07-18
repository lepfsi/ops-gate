/**
 * OpsGate — 10-question technical due-diligence deck (FR + EN speaker notes).
 * Usage: node scripts/build-faq-due-diligence-pptx.mjs
 * Requires: pptxgenjs (run from dir with node_modules, or NODE_PATH)
 */
import { createRequire } from "module"
import { dirname, join } from "path"
import { fileURLToPath } from "url"
import { homedir } from "os"

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = join(__dirname, "..", "docs", "FAQ-DUE-DILIGENCE-10Q.pptx")
// Resolve pptxgenjs from temp install or local
const require = createRequire(import.meta.url)
let pptxgen
try {
  pptxgen = require("pptxgenjs")
} catch {
  const tempMod = join(
    process.env.TEMP || process.env.TMP || homedir(),
    "pptx-build",
    "node_modules",
    "pptxgenjs"
  )
  pptxgen = require(tempMod)
}

const NAVY = "0A1128"
const TEAL = "2BD9C5"
const TEAL_DIM = "0F766E"
const WHITE = "FFFFFF"
const ICE = "E2E8F0"
const MUTED = "94A3B8"
const CARD = "111827"
const SOFT = "1E293B"

const questions = [
  {
    n: "01",
    q: "Why browser DLP instead of CASB / network DLP?",
    qFr: "Pourquoi un DLP navigateur plutôt qu’un CASB ?",
    bullets: [
      "AI leaks happen in the DOM (paste / upload), not only on the wire",
      "Full-traffic MITM is costly; AI host allowlist is targeted",
      "Blocking whole sites fails UX — intercept send + mask / Secure Rewrite",
      "Position: AI-specific safety net, complementary to CASB — not a replacement"
    ]
  },
  {
    n: "02",
    q: "Does the raw secret leave the endpoint?",
    qFr: "Le secret brut quitte-t-il le poste ?",
    bullets: [
      "Detection runs in the extension (+ optional local proxy) on-device",
      "Default org policy: metadata_only (rule_ids, decision, host, severity)",
      "No prompt / content fields — API rejects forbidden schema fields",
      "Optional redacted previews only (max 5 × ~24 chars), never full text"
    ]
  },
  {
    n: "03",
    q: "How is the rule pack authenticated?",
    qFr: "Comment le pack de règles est-il authentifié ?",
    bullets: [
      "Published packs: JSON checksum + ed25519 signature",
      "Agent verifies SPKI public key before applying rules",
      "pack_verify_failed → no silent accept of tampered packs",
      "Prevents MITM or compromised server from injecting arbitrary rules"
    ]
  },
  {
    n: "04",
    q: "Multi-tenant isolation — prove it.",
    qFr: "Isolation multi-tenant — prouvez-le.",
    bullets: [
      "Postgres RLS on org_id (app.current_org_id)",
      "Agent tokens scoped to one org",
      "MSP: same admin email, MFA required on every tenant switch",
      "GDPR org soft-delete + export path — no cross-tenant token reuse"
    ]
  },
  {
    n: "05",
    q: "Is detection “just regex”?",
    qFr: "La détection n’est-elle que du regex ?",
    bullets: [
      "Patterns + validators: Luhn (cards), IBAN mod-97, placeholder filters",
      "Selective keyword gates for infra configs; anti phone-vs-IBAN FPs",
      "Secure Rewrite: structured replacements with consistent mapping",
      "Not document ML — auditable rule DLP; classification = later roadmap"
    ]
  },
  {
    n: "06",
    q: "How are you not HR spyware / a keylogger?",
    qFr: "En quoi n’êtes-vous pas un spyware RH ?",
    bullets: [
      "Scan at send/upload time — not continuous keystroke logging",
      "Content script only on declared AI hosts (enabled_hosts)",
      "local_only mode: zero org telemetry",
      "Governance DLP argument, not behavioral surveillance"
    ]
  },
  {
    n: "07",
    q: "Admin identity: MFA, SSO, break-glass?",
    qFr: "Identité admin : MFA, SSO, break-glass ?",
    bullets: [
      "TOTP MFA, passkeys/WebAuthn, OIDC, SAML SP, optional LDAP sync",
      "MSP multi-tenant: 6-digit MFA on every org switch",
      "Protected unenroll via admin password hashes",
      "Vendor recovery only if offline ≥ ~2h + one-time codes"
    ]
  },
  {
    n: "08",
    q: "Are logs forensically useful / immutable?",
    qFr: "Les logs sont-ils opposables / immuables ?",
    bullets: [
      "Admin audit WORM: SHA-256 hash chain, append-only, integrity check",
      "Detection events: retention configurable; SIEM CEF/syslog + Prometheus",
      "Security PDF report: decisions + V3 rewrite/risk/shadow section",
      "App-level seal (not tape WORM) — state it honestly"
    ]
  },
  {
    n: "09",
    q: "Local MITM proxy — isn’t that worse?",
    qFr: "Proxy MITM local — n’est-ce pas pire ?",
    bullets: [
      "MITM on the user machine with enterprise CA (GPO), AI allowlist only",
      "Soft-block per request (not permanent site ban); observe vs enforce",
      "Complements extension DOM path (source=prompt|file|proxy)",
      "Document CA trust, host scope, pinning edge cases in runbook"
    ]
  },
  {
    n: "10",
    q: "What are your honest product limits?",
    qFr: "Quelles sont vos limites honnêtes ?",
    bullets: [
      "Not full-channel DLP (USB, print, email) — do not oversell",
      "Off-browser AI / non-listed hosts = coverage gap",
      "Store listings live = ops (pre-GA); artifacts ready in monorepo",
      "Rewrite is operational risk reduction, not formal crypto anonymity"
    ]
  }
]

function addFooter(slide, page, total) {
  slide.addText("OpsGate · Technical due diligence · DailyOps.Tech", {
    x: 0.5,
    y: 5.25,
    w: 7.5,
    h: 0.25,
    fontSize: 10,
    fontFace: "Calibri",
    color: MUTED,
    margin: 0
  })
  slide.addText(`${page} / ${total}`, {
    x: 8.5,
    y: 5.25,
    w: 1,
    h: 0.25,
    fontSize: 10,
    fontFace: "Calibri",
    color: MUTED,
    align: "right",
    margin: 0
  })
}

const pres = new pptxgen()
pres.layout = "LAYOUT_16x9"
pres.author = "DailyOps.Tech"
pres.title = "OpsGate — Technical Due Diligence · 10 Questions"
pres.subject = "Security engineer FAQ deck"

const totalSlides = 2 + questions.length + 1 // title, agenda, 10 Q, close

// —— Title ——
{
  const s = pres.addSlide()
  s.addShape(pres.shapes.RECTANGLE, {
    x: 0,
    y: 0,
    w: 10,
    h: 5.625,
    fill: { color: NAVY }
  })
  s.addShape(pres.shapes.RECTANGLE, {
    x: 0,
    y: 0,
    w: 10,
    h: 0.12,
    fill: { color: TEAL }
  })
  s.addText("OPSGATE", {
    x: 0.6,
    y: 1.5,
    w: 8.8,
    h: 0.4,
    fontSize: 14,
    fontFace: "Calibri",
    color: TEAL,
    bold: true,
    charSpacing: 4,
    margin: 0
  })
  s.addText("Technical due diligence", {
    x: 0.6,
    y: 2.0,
    w: 8.8,
    h: 0.7,
    fontSize: 36,
    fontFace: "Calibri",
    color: WHITE,
    bold: true,
    margin: 0
  })
  s.addText("10 questions a security engineer will ask — with dense answers", {
    x: 0.6,
    y: 2.75,
    w: 8.5,
    h: 0.4,
    fontSize: 16,
    fontFace: "Calibri",
    color: ICE,
    margin: 0
  })
  s.addText(
    "Not marketing. Architecture-backed · V2 pre-GA + V3-P0 · DailyOps.Tech",
    {
      x: 0.6,
      y: 4.6,
      w: 8.5,
      h: 0.3,
      fontSize: 12,
      fontFace: "Calibri",
      color: MUTED,
      margin: 0
    }
  )
}

// —— Agenda ——
{
  const s = pres.addSlide()
  s.addShape(pres.shapes.RECTANGLE, {
    x: 0,
    y: 0,
    w: 10,
    h: 5.625,
    fill: { color: NAVY }
  })
  s.addText("How to use this deck", {
    x: 0.5,
    y: 0.35,
    w: 9,
    h: 0.45,
    fontSize: 28,
    fontFace: "Calibri",
    color: WHITE,
    bold: true,
    margin: 0
  })
  const cards = [
    {
      t: "Discovery / RFP",
      d: "Walk 10 questions cold. Full EN FAQ for written answers."
    },
    {
      t: "CISO warm-up",
      d: "Before demo: prove mastery, then show product."
    },
    {
      t: "Honest limits",
      d: "Slide 10 + trap answers build more trust than overclaim."
    },
    {
      t: "Deep dive",
      d: "docs/FAQ-DUE-DILIGENCE-TECHNIQUE(-EN).md"
    }
  ]
  cards.forEach((c, i) => {
    const col = i % 2
    const row = Math.floor(i / 2)
    const x = 0.5 + col * 4.6
    const y = 1.1 + row * 1.7
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x,
      y,
      w: 4.35,
      h: 1.45,
      fill: { color: SOFT },
      rectRadius: 0.1
    })
    s.addShape(pres.shapes.RECTANGLE, {
      x,
      y,
      w: 0.12,
      h: 1.45,
      fill: { color: TEAL }
    })
    s.addText(c.t, {
      x: x + 0.3,
      y: y + 0.25,
      w: 3.8,
      h: 0.35,
      fontSize: 16,
      fontFace: "Calibri",
      color: TEAL,
      bold: true,
      margin: 0
    })
    s.addText(c.d, {
      x: x + 0.3,
      y: y + 0.7,
      w: 3.8,
      h: 0.55,
      fontSize: 13,
      fontFace: "Calibri",
      color: ICE,
      margin: 0
    })
  })
  addFooter(s, 2, totalSlides)
}

// —— 10 Q slides ——
questions.forEach((item, idx) => {
  const s = pres.addSlide()
  s.addShape(pres.shapes.RECTANGLE, {
    x: 0,
    y: 0,
    w: 10,
    h: 5.625,
    fill: { color: "0F172A" }
  })
  // left accent rail
  s.addShape(pres.shapes.RECTANGLE, {
    x: 0,
    y: 0,
    w: 0.15,
    h: 5.625,
    fill: { color: TEAL }
  })

  s.addText(`Q${item.n}`, {
    x: 0.5,
    y: 0.28,
    w: 1.5,
    h: 0.35,
    fontSize: 14,
    fontFace: "Calibri",
    color: TEAL,
    bold: true,
    charSpacing: 2,
    margin: 0
  })
  s.addText(item.q, {
    x: 0.5,
    y: 0.7,
    w: 9,
    h: 0.85,
    fontSize: 22,
    fontFace: "Calibri",
    color: WHITE,
    bold: true,
    margin: 0,
    valign: "top"
  })
  s.addText(item.qFr, {
    x: 0.5,
    y: 1.55,
    w: 9,
    h: 0.3,
    fontSize: 12,
    fontFace: "Calibri",
    color: MUTED,
    italic: true,
    margin: 0
  })

  item.bullets.forEach((b, bi) => {
    const y = 2.05 + bi * 0.7
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x: 0.5,
      y,
      w: 9,
      h: 0.58,
      fill: { color: SOFT },
      rectRadius: 0.06
    })
    s.addShape(pres.shapes.OVAL, {
      x: 0.7,
      y: y + 0.16,
      w: 0.26,
      h: 0.26,
      fill: { color: TEAL_DIM }
    })
    s.addText(String(bi + 1), {
      x: 0.7,
      y: y + 0.16,
      w: 0.26,
      h: 0.26,
      fontSize: 11,
      fontFace: "Calibri",
      color: WHITE,
      bold: true,
      align: "center",
      valign: "middle",
      margin: 0
    })
    s.addText(b, {
      x: 1.15,
      y: y + 0.1,
      w: 8.1,
      h: 0.4,
      fontSize: 13,
      fontFace: "Calibri",
      color: ICE,
      margin: 0,
      valign: "middle"
    })
  })

  s.addNotes(
    `FR Q: ${item.qFr}\n\nTalking points:\n${item.bullets.map((x, i) => `${i + 1}. ${x}`).join("\n")}\n\nDeep dive: docs/FAQ-DUE-DILIGENCE-TECHNIQUE.md / -EN.md`
  )
  addFooter(s, 3 + idx, totalSlides)
})

// —— Close ——
{
  const s = pres.addSlide()
  s.addShape(pres.shapes.RECTANGLE, {
    x: 0,
    y: 0,
    w: 10,
    h: 5.625,
    fill: { color: NAVY }
  })
  s.addShape(pres.shapes.RECTANGLE, {
    x: 0,
    y: 0,
    w: 10,
    h: 0.12,
    fill: { color: TEAL }
  })
  s.addText("Mastery checklist (cold)", {
    x: 0.5,
    y: 0.4,
    w: 9,
    h: 0.45,
    fontSize: 26,
    fontFace: "Calibri",
    color: WHITE,
    bold: true,
    margin: 0
  })
  const checks = [
    "Draw: extension ↔ engine ↔ API ↔ RLS ↔ proxy",
    "metadata_only vs redacted match",
    "mask · Secure Rewrite · block · send_anyway",
    "ed25519 pack signatures",
    "MFA on every MSP tenant switch",
    "Risk trend = period N vs N−1 (±5 pts)",
    "Admit limits: off-browser, pre-GA stores, rewrite ≠ crypto anonymity"
  ]
  checks.forEach((c, i) => {
    s.addText(
      [
        { text: "▸  ", options: { color: TEAL, bold: true } },
        { text: c, options: { color: ICE } }
      ],
      {
        x: 0.6,
        y: 1.05 + i * 0.48,
        w: 8.8,
        h: 0.42,
        fontSize: 15,
        fontFace: "Calibri",
        margin: 0
      }
    )
  })
  s.addText(
    "Full FAQ FR/EN · 10Q deck · contact@dailyops.tech",
    {
      x: 0.5,
      y: 5.15,
      w: 9,
      h: 0.25,
      fontSize: 11,
      fontFace: "Calibri",
      color: MUTED,
      margin: 0
    }
  )
}

await pres.writeFile({ fileName: OUT })
console.log("Wrote", OUT)
