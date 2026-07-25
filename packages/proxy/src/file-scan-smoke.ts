/**
 * Smoke test local — extraction proxy sans serveur HTTP.
 * Usage: pnpm --filter @opsgate/proxy smoke:scan
 * OCR réel (télécharge packs Tesseract) : OPSGATE_SMOKE_OCR=1 pnpm --filter @opsgate/proxy smoke:scan
 */
import { scanFilePayload } from "./file-scan.js"
import { extractContent } from "./content-extract.js"
import { deepScanBody } from "./deep-body-scan.js"
import {
  getMultipartBoundary,
  parseMultipartBody
} from "./multipart-parse.js"
import { extractPdfEmbeddedImages } from "./pdf-images.js"

function zipStore(entries: Array<{ name: string; data: Buffer }>): Buffer {
  // Minimal ZIP (store method 0) for smoke DOCX-like payload
  const parts: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8")
    const local = Buffer.alloc(30 + name.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x800, 6) // utf8
    local.writeUInt16LE(0, 8) // store
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0, 12)
    local.writeUInt32LE(e.data.length, 18)
    local.writeUInt32LE(e.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    name.copy(local, 30)
    parts.push(local, e.data)

    const cd = Buffer.alloc(46 + name.length)
    cd.writeUInt32LE(0x02014b50, 0)
    cd.writeUInt16LE(20, 4)
    cd.writeUInt16LE(20, 6)
    cd.writeUInt16LE(0x800, 8)
    cd.writeUInt16LE(0, 10)
    cd.writeUInt32LE(e.data.length, 20)
    cd.writeUInt32LE(e.data.length, 24)
    cd.writeUInt16LE(name.length, 28)
    cd.writeUInt32LE(offset, 42)
    name.copy(cd, 46)
    central.push(cd)
    offset += local.length + e.data.length
  }
  const cdBuf = Buffer.concat(central)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(cdBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...parts, cdBuf, eocd])
}

async function main() {
  let failed = 0

  // 1) Plain text with fake secret
  {
    const text =
      "Contact support@example.com\nAWS key AKIAIOSFODNN7EXAMPLE\n"
    const r = await extractContent(Buffer.from(text, "utf8"), "notes.txt")
    if (!r.text.includes("AKIA")) {
      console.error("FAIL text extract")
      failed++
    } else console.log("OK  text extract", r.text.length, "chars")
  }

  // 2) Minimal DOCX-like ZIP with word/document.xml
  {
    const xml = `<?xml version="1.0"?>
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body><w:p><w:r><w:t>Secret card 4111111111111111 and password admin123!</w:t></w:r></w:p></w:body>
      </w:document>`
    const docx = zipStore([
      { name: "[Content_Types].xml", data: Buffer.from("<Types/>") },
      { name: "word/document.xml", data: Buffer.from(xml) }
    ])
    const r = await extractContent(docx, "memo.docx")
    if (!r.text.includes("4111111111111111")) {
      console.error("FAIL docx extract", r)
      failed++
    } else console.log("OK  docx extract", r.text.slice(0, 80))
  }

  // 3) scanFilePayload end-to-end on text
  {
    const body = "DATABASE_URL=postgres://user:s3cret@db.internal:5432/app\n"
    const r = await scanFilePayload({
      filename: "env.prod.txt",
      mime: "text/plain",
      content_base64: Buffer.from(body).toString("base64")
    })
    if (r.status !== "scanned" && r.status !== "partial") {
      console.error("FAIL scanFilePayload status", r)
      failed++
    } else {
      console.log(
        "OK  scanFilePayload",
        r.status,
        "detections=",
        r.detections?.length ?? 0
      )
    }
  }

  // 4) PDF with embedded JPEG (DCTDecode) — extract without full OCR
  {
    // Minimal JPEG (1×1) — enough for SOI/EOI detection
    const jpeg = Buffer.from(
      "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAA//2Q==",
      "base64"
    )
    const pdf = Buffer.from(
      `%PDF-1.4
1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj
2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj
3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R /Resources << /XObject << /Im0 5 0 R >> >> >>endobj
4 0 obj<< /Length 0 >>stream
endstream
endobj
5 0 obj<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>stream
`,
      "latin1"
    )
    const pdfFull = Buffer.concat([
      pdf,
      jpeg,
      Buffer.from("\nendstream\nendobj\ntrailer<< /Root 1 0 R >>\n%%EOF\n", "latin1")
    ])
    const emb = extractPdfEmbeddedImages(pdfFull, 3)
    if (emb.images.length < 1) {
      console.error("FAIL pdf embedded JPEG extract", emb)
      failed++
    } else {
      console.log(
        "OK  pdf embedded JPEG",
        emb.images.length,
        "image(s)",
        emb.images[0].length,
        "bytes"
      )
    }
  }

  // 5) SQLite binaire — créer une mini DB en mémoire via sql.js
  {
    try {
      const { createRequire } = await import("node:module")
      const { dirname, join } = await import("node:path")
      const { fileURLToPath } = await import("node:url")
      const { existsSync } = await import("node:fs")
      const require = createRequire(import.meta.url)
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const initSqlJs = require("sql.js") as (cfg?: {
        locateFile?: (f: string) => string
      }) => Promise<{
        Database: new () => {
          run: (s: string) => void
          export: () => Uint8Array
          close: () => void
        }
      }>
      const here = dirname(fileURLToPath(import.meta.url))
      const candidates = [
        join(here, "../node_modules/sql.js/dist"),
        join(process.cwd(), "node_modules/sql.js/dist"),
        join(process.cwd(), "packages/proxy/node_modules/sql.js/dist")
      ]
      const distDir =
        candidates.find((d) => existsSync(join(d, "sql-wasm.wasm"))) ||
        candidates[0]
      const SQL = await initSqlJs({
        locateFile: (f: string) => join(distDir, f)
      })
      const db = new SQL.Database()
      db.run(`CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        email TEXT,
        api_key TEXT
      )`)
      db.run(
        `INSERT INTO users (email, api_key) VALUES
         ('admin@corp.local', 'AKIAIOSFODNN7EXAMPLE'),
         ('user@example.com', 'sk-test-not-real-000')`
      )
      const exported = Buffer.from(db.export())
      db.close()

      const r = await extractContent(exported, "secrets.sqlite")
      if (r.kind !== "sqlite" || !r.text.includes("AKIAIOSFODNN7EXAMPLE")) {
        console.error("FAIL sqlite extract", {
          kind: r.kind,
          error: r.error,
          preview: r.text.slice(0, 200)
        })
        failed++
      } else {
        const scan = await scanFilePayload({
          filename: "secrets.sqlite",
          mime: "application/x-sqlite3",
          content_base64: exported.toString("base64")
        })
        console.log(
          "OK  sqlite extract",
          `tables=${r.tableCount}`,
          `rows=${r.rowSamples}`,
          `detections=${scan.detections?.length ?? 0}`
        )
      }
    } catch (e) {
      console.error(
        "FAIL sqlite smoke (sql.js install?)",
        e instanceof Error ? e.message : e
      )
      failed++
    }
  }

  // 6) Multipart deep scan (T4) — DOCX part + secret field
  {
    const xml = `<?xml version="1.0"?>
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body><w:p><w:r><w:t>AKIAIOSFODNN7EXAMPLE leak in docx</w:t></w:r></w:p></w:body>
      </w:document>`
    const docx = zipStore([
      { name: "[Content_Types].xml", data: Buffer.from("<Types/>") },
      { name: "word/document.xml", data: Buffer.from(xml) }
    ])
    const boundary = "----OpsGateBoundary7"
    const body = Buffer.from(
      [
        `--${boundary}`,
        'Content-Disposition: form-data; name="prompt"',
        "",
        "please review this file",
        `--${boundary}`,
        'Content-Disposition: form-data; name="file"; filename="secret.docx"',
        "Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "",
        ""
      ].join("\r\n"),
      "utf8"
    )
    const bodyFull = Buffer.concat([
      body,
      docx,
      Buffer.from(`\r\n--${boundary}--\r\n`, "utf8")
    ])
    const ct = `multipart/form-data; boundary=${boundary}`
    const b = getMultipartBoundary(ct)
    const parts = parseMultipartBody(bodyFull, b || boundary)
    if (parts.filter((p) => p.filename).length < 1) {
      console.error("FAIL multipart parse files", parts.length)
      failed++
    } else {
      const deep = await deepScanBody(bodyFull, ct, { host: "smoke" })
      if (
        !deep.fileNames.includes("secret.docx") ||
        !deep.text.includes("AKIAIOSFODNN7EXAMPLE")
      ) {
        console.error("FAIL deep multipart", {
          files: deep.fileNames,
          extracted: deep.extractedFiles,
          preview: deep.text.slice(0, 240),
          detections: deep.detectionCount
        })
        failed++
      } else {
        console.log(
          "OK  deep multipart",
          `files=${deep.fileCount}`,
          `extracted=${deep.extractedFiles}`,
          `detections=${deep.detectionCount}`,
          `${deep.ms}ms`
        )
      }
    }
  }

  // 7) T5 format-preserve mask DOCX
  {
    const xml = `<?xml version="1.0"?>
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body><w:p><w:r><w:t>Key AKIAIOSFODNN7EXAMPLE must be masked</w:t></w:r></w:p></w:body>
      </w:document>`
    const docx = zipStore([
      { name: "[Content_Types].xml", data: Buffer.from("<Types/>") },
      { name: "word/document.xml", data: Buffer.from(xml) }
    ])
    const { maskFilePayload } = await import("./format-preserve-mask.js")
    const r = maskFilePayload({
      filename: "leak.docx",
      content_base64: docx.toString("base64"),
      mode: "mask"
    })
    if (r.status !== "ok" || !r.content_base64) {
      console.error("FAIL format-preserve mask", r)
      failed++
    } else {
      const out = Buffer.from(r.content_base64, "base64")
      const asLatin = out.toString("latin1")
      if (
        asLatin.includes("AKIAIOSFODNN7EXAMPLE") ||
        !/\.docx$/i.test(r.filename || "")
      ) {
        console.error("FAIL mask still has secret or wrong name", {
          filename: r.filename,
          hasSecret: asLatin.includes("AKIAIOSFODNN7EXAMPLE")
        })
        failed++
      } else {
        console.log(
          "OK  format-preserve mask",
          r.filename,
          r.kind,
          `${out.length}b`
        )
      }
    }
  }

  // 8) Optional real OCR (network + first-time model download)
  if (process.env.OPSGATE_SMOKE_OCR === "1") {
    const jpeg = Buffer.from(
      "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAA//2Q==",
      "base64"
    )
    const r = await extractContent(jpeg, "smoke.jpg", "image/jpeg")
    console.log(
      "OK  OCR smoke (may be empty on 1×1)",
      "usedOcr=",
      r.usedOcr,
      "chars=",
      r.text.length,
      r.error || ""
    )
  } else {
    console.log("SKIP live OCR (set OPSGATE_SMOKE_OCR=1 to enable)")
  }

  if (failed) {
    console.error(`\n${failed} smoke check(s) failed`)
    process.exit(1)
  }
  console.log("\nAll smoke checks passed (P0–T5 format-preserve)")
}

void main()
