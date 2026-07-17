/**
 * Certificat PDF brandé DailyOps / OpsGate (navy #0A1128 + teal #2BD9C5).
 * PDF 1.4 sans dépendance externe.
 */

function pdfEscape(s: string): string {
  return String(s ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    // Helvetica win-ansi approx: strip non-latin
    .replace(/[^\x20-\x7E]/g, "?")
}

type TextLine = {
  text: string
  x: number
  y: number
  size: number
  /** 0=black, 1=white, 2=muted gray, 3=teal */
  color?: 0 | 1 | 2 | 3
  bold?: boolean
}

function colorOps(c: 0 | 1 | 2 | 3): string {
  if (c === 1) return "1 1 1 rg"
  if (c === 2) return "0.4 0.45 0.55 rg"
  if (c === 3) return "0.169 0.851 0.773 rg"
  return "0.06 0.09 0.16 rg"
}

function buildStream(lines: TextLine[]): string {
  const parts: string[] = []
  // Navy header bar
  parts.push("0.039 0.067 0.157 rg")
  parts.push("0 760 595 82 re")
  parts.push("f")
  // Teal accent under header
  parts.push("0.169 0.851 0.773 rg")
  parts.push("0 755 595 5 re")
  parts.push("f")
  // Light card background
  parts.push("0.97 0.98 0.99 rg")
  parts.push("40 280 515 420 re")
  parts.push("f")
  // Card border
  parts.push("0.88 0.91 0.94 RG")
  parts.push("0.8 w")
  parts.push("40 280 515 420 re")
  parts.push("S")
  // Teal left stripe on card
  parts.push("0.169 0.851 0.773 rg")
  parts.push("40 280 4 420 re")
  parts.push("f")
  // Footer bar
  parts.push("0.039 0.067 0.157 rg")
  parts.push("0 0 595 48 re")
  parts.push("f")
  parts.push("0.169 0.851 0.773 rg")
  parts.push("0 48 595 3 re")
  parts.push("f")

  parts.push("BT")
  for (const line of lines) {
    const font = line.bold ? "/F2" : "/F1"
    parts.push(colorOps(line.color ?? 0))
    parts.push(`${font} ${line.size} Tf`)
    parts.push(`1 0 0 1 ${line.x} ${line.y} Tm`)
    parts.push(`(${pdfEscape(line.text)}) Tj`)
  }
  parts.push("ET")
  return parts.join("\n")
}

/** Génère un Buffer PDF certificat licence brandé */
export function buildLicenseCertificatePdf(rec: {
  licenseKey: string
  orgCode: string
  companyName: string
  address: string
  contactEmail: string
  seats: number
  expiresAt: string
  issuedAt: string
  kind?: string
}): Buffer {
  const kindLabel =
    rec.kind === "seat_topup"
      ? "Pack de sieges additionnels (top-up)"
      : "Licence complete (full)"
  const exp = String(rec.expiresAt).slice(0, 10)
  const issued = String(rec.issuedAt).slice(0, 10)

  const lines: TextLine[] = [
    { text: "OpsGate", x: 50, y: 800, size: 22, color: 1, bold: true },
    { text: "DailyOps.Tech", x: 50, y: 780, size: 11, color: 3 },
    {
      text: "Certificat de licence",
      x: 50,
      y: 762,
      size: 12,
      color: 1
    },
    {
      text: "Document confidentiel  -  usage client / contrat",
      x: 320,
      y: 780,
      size: 8,
      color: 2
    },
    { text: "Type de licence", x: 56, y: 660, size: 9, color: 2 },
    { text: kindLabel, x: 56, y: 642, size: 12, bold: true },
    { text: "Cle de licence", x: 56, y: 610, size: 9, color: 2 },
    {
      text: rec.licenseKey,
      x: 56,
      y: 590,
      size: 13,
      bold: true,
      color: 0
    },
    { text: "Code organisation", x: 56, y: 555, size: 9, color: 2 },
    { text: rec.orgCode, x: 56, y: 537, size: 12, bold: true },
    { text: "Societe / client", x: 280, y: 555, size: 9, color: 2 },
    {
      text: (rec.companyName || "-").slice(0, 40),
      x: 280,
      y: 537,
      size: 11,
      bold: true
    },
    { text: "Adresse", x: 56, y: 500, size: 9, color: 2 },
    {
      text: (rec.address || "-").slice(0, 70),
      x: 56,
      y: 482,
      size: 10
    },
    { text: "Contact (e-mail)", x: 56, y: 448, size: 9, color: 2 },
    { text: rec.contactEmail || "-", x: 56, y: 430, size: 11 },
    { text: "Sieges", x: 56, y: 396, size: 9, color: 2 },
    { text: String(rec.seats), x: 56, y: 378, size: 14, bold: true, color: 3 },
    { text: "Emise le", x: 160, y: 396, size: 9, color: 2 },
    { text: issued, x: 160, y: 378, size: 11 },
    { text: "Expire le", x: 300, y: 396, size: 9, color: 2 },
    { text: exp, x: 300, y: 378, size: 11, bold: true },
    {
      text: "Activation : Console MMC  >  Parametres  >  Licences  >  Ajouter",
      x: 56,
      y: 330,
      size: 9,
      color: 2
    },
    {
      text: "Nouveau client : login = e-mail contact ci-dessus  /  mdp initial 0000 (a changer).",
      x: 56,
      y: 312,
      size: 9,
      color: 2
    },
    {
      text: "OpsGate  ·  DailyOps.Tech  ·  www.dailyops.tech",
      x: 50,
      y: 20,
      size: 9,
      color: 1
    },
    {
      text: "Proteger les donnees dans chaque interaction avec l'IA.",
      x: 280,
      y: 20,
      size: 8,
      color: 3
    }
  ]

  const stream = buildStream(lines)
  const streamLen = Buffer.byteLength(stream, "utf8")

  const objects: string[] = []
  objects.push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n")
  objects.push(
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n"
  )
  objects.push(
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>\nendobj\n"
  )
  objects.push(
    `4 0 obj\n<< /Length ${streamLen} >>\nstream\n${stream}\nendstream\nendobj\n`
  )
  objects.push(
    "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n"
  )
  objects.push(
    "6 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n"
  )

  let pdf = "%PDF-1.4\n"
  const offsets: number[] = [0]
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, "utf8"))
    pdf += obj
  }
  const xrefPos = Buffer.byteLength(pdf, "utf8")
  pdf += `xref\n0 ${objects.length + 1}\n`
  pdf += "0000000000 65535 f \n"
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`
  pdf += `startxref\n${xrefPos}\n%%EOF\n`
  return Buffer.from(pdf, "utf8")
}

export function certificateFilename(rec: {
  orgCode: string
  licenseKey: string
}): string {
  const code = (rec.orgCode || "ORG").replace(/[^A-Z0-9-]/gi, "_")
  const tail = rec.licenseKey.split("-").pop() || "KEY"
  return `OpsGate-Licence-${code}-${tail}.pdf`
}
