/**
 * Certificat PDF minimal (texte) pour transmission client.
 * Pas de dépendance externe — PDF 1.4 basique.
 */
import type { IssuedLicenseRecord } from "./license-keys"

function pdfEscape(s: string): string {
  return String(s)
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
}

function buildContentStream(lines: { text: string; size?: number; y: number }[]): string {
  const parts: string[] = ["BT"]
  for (const line of lines) {
    const size = line.size || 11
    parts.push(`/F1 ${size} Tf`)
    parts.push(`50 ${line.y} Td`)
    parts.push(`(${pdfEscape(line.text)}) Tj`)
    parts.push("0 0 Td") // reset? better use Tm
  }
  // Rewrite with absolute Tm
  const out: string[] = ["BT"]
  for (const line of lines) {
    const size = line.size || 11
    out.push(`/F1 ${size} Tf`)
    out.push(`1 0 0 1 50 ${line.y} Tm`)
    out.push(`(${pdfEscape(line.text)}) Tj`)
  }
  out.push("ET")
  return out.join("\n")
}

/** Génère un Buffer PDF certificat licence */
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

  const lines = [
    { text: "OpsGate  -  DailyOps.Tech", size: 16, y: 780 },
    { text: "Certificat de licence", size: 14, y: 755 },
    { text: "------------------------------------------------", y: 735 },
    { text: `Type          : ${kindLabel}`, y: 710 },
    { text: `Cle licence   : ${rec.licenseKey}`, size: 12, y: 690 },
    { text: `Code org      : ${rec.orgCode}`, y: 670 },
    { text: `Societe       : ${rec.companyName}`, y: 650 },
    { text: `Adresse       : ${rec.address || "-"}`, y: 630 },
    { text: `Contact       : ${rec.contactEmail}`, y: 610 },
    { text: `Sieges        : ${rec.seats}`, y: 590 },
    { text: `Emise le      : ${issued}`, y: 570 },
    { text: `Expire le     : ${exp}`, y: 550 },
    { text: "------------------------------------------------", y: 525 },
    {
      text: "Activation client : Console MMC > Parametres > Licences > Ajouter",
      size: 9,
      y: 500
    },
    {
      text: "Document confidentiel - usage interne evaluation / contrat.",
      size: 9,
      y: 480
    },
    { text: "www.dailyops.tech", size: 9, y: 450 }
  ]

  const stream = buildContentStream(lines)
  const streamBuf = Buffer.from(stream, "utf8")

  // Assemble PDF objects
  const objects: string[] = []
  objects.push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n")
  objects.push(
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n"
  )
  objects.push(
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n"
  )
  objects.push(
    `4 0 obj\n<< /Length ${streamBuf.length} >>\nstream\n${stream}\nendstream\nendobj\n`
  )
  objects.push(
    "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n"
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

export function certificateFilename(rec: { orgCode: string; licenseKey: string }): string {
  const code = (rec.orgCode || "ORG").replace(/[^A-Z0-9-]/gi, "_")
  const tail = rec.licenseKey.split("-").pop() || "KEY"
  return `OpsGate-Licence-${code}-${tail}.pdf`
}
