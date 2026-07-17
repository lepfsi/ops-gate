import {
  detectSensitiveData,
  maskSensitiveData,
  type Detection,
  type DetectionRule
} from "@opsgate/engine"

/**
 * Taille max lue par fichier texte (12 Mo).
 * Au-delà : scan du début uniquement + flag truncated.
 */
export const MAX_FILE_BYTES = 12_000_000

/** Extensions textuelles / config */
const TEXT_EXTENSIONS = new Set([
  "txt",
  "md",
  "markdown",
  "json",
  "csv",
  "tsv",
  "log",
  "conf",
  "cfg",
  "ini",
  "yaml",
  "yml",
  "xml",
  "env",
  "sh",
  "bash",
  "bat",
  "cmd",
  "ps1",
  "py",
  "js",
  "ts",
  "tsx",
  "jsx",
  "sql",
  "toml",
  "properties",
  "config",
  "cnf",
  "crt",
  "pem",
  "key",
  "pub",
  "csr",
  "tf",
  "hcl",
  "gitignore",
  "dockerignore",
  "env.local",
  "env.example",
  "rsc",
  "pcap", // metadata attempt only
  "rtf"
])

const CONFIG_EXTENSIONS = new Set([
  "log",
  "xml",
  "json",
  "conf",
  "cfg",
  "ini",
  "yaml",
  "yml",
  "ps1",
  "bat",
  "cmd",
  "env",
  "toml",
  "properties",
  "cnf",
  "pcap",
  "tf",
  "hcl"
])

const DB_EXTENSIONS = new Set(["sql", "db", "sqlite", "sqlite3", "mdb", "accdb"])

const OFFICE_EXTENSIONS = new Set([
  "pdf",
  "doc",
  "docx",
  "odt",
  "rtf",
  "ppt",
  "pptx",
  "odp",
  "xls",
  "xlsx",
  "xlsm",
  "ods",
  "csv"
])

const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "tif",
  "tiff"
])

const MEDIA_EXTENSIONS = new Set([
  "mp3",
  "wav",
  "m4a",
  "aac",
  "ogg",
  "flac",
  "mp4",
  "mov",
  "avi",
  "mkv",
  "webm",
  "wmv"
])

export type FileCategory =
  | "text"
  | "config"
  | "database"
  | "office"
  | "image"
  | "media"
  | "unknown"

export type FileScanStatus =
  | "scanned"
  | "unsupported"
  | "too_large_partial"
  | "empty"
  | "error"
  | "warn_confirm"
  | "office_warn"
  | "image_skipped"
  | "image_ocr_limited"
  | "image_ocr_failed"
  | "media_warn"

export interface FileScanOptions {
  /** Scanner configs (.conf, .json, .xml…) — défaut true */
  scanConfigs?: boolean
  /** Scanner SQL / tenter texte DB — défaut true */
  scanDatabases?: boolean
  /** OCR images — stub : non implémenté (warn / skip) */
  scanImages?: boolean
  /** Toujours demander confirmation pour audio/vidéo */
  warnMedia?: boolean
}

export interface FileScanResult {
  fileName: string
  fileSize: number
  status: FileScanStatus
  category: FileCategory
  text: string
  detections: Detection[]
  truncated: boolean
  /** Message UX (banner / toast) */
  userHint?: string
}

function extensionOf(name: string): string {
  const lower = name.toLowerCase()
  if (lower.endsWith(".env.local") || lower.endsWith(".env.example")) {
    return lower.split(".").slice(-2).join(".")
  }
  const i = lower.lastIndexOf(".")
  return i >= 0 ? lower.slice(i + 1) : ""
}

export function categorizeFile(file: File): FileCategory {
  const ext = extensionOf(file.name)
  if (MEDIA_EXTENSIONS.has(ext) || file.type.startsWith("audio/") || file.type.startsWith("video/")) {
    return "media"
  }
  if (IMAGE_EXTENSIONS.has(ext) || file.type.startsWith("image/")) {
    return "image"
  }
  if (OFFICE_EXTENSIONS.has(ext) || file.type.includes("pdf") || file.type.includes("officedocument")) {
    // csv is both office and text — treat as text scannable
    if (ext === "csv" || ext === "rtf") return "text"
    return "office"
  }
  if (DB_EXTENSIONS.has(ext)) return "database"
  if (CONFIG_EXTENSIONS.has(ext)) return "config"
  if (TEXT_EXTENSIONS.has(ext) || file.type.startsWith("text/")) return "text"
  return "unknown"
}

export function isScannableFile(file: File, opts: FileScanOptions = {}): boolean {
  const cat = categorizeFile(file)
  if (cat === "media") return false // warn only
  if (cat === "image") return !!opts.scanImages
  if (cat === "office") {
    // PDF / DOCX / PPTX / XLSX extraits ; legacy Office → warn only
    const ext = extensionOf(file.name)
    return (
      ext === "pdf" ||
      ext === "docx" ||
      ext === "pptx" ||
      ext === "xlsx" ||
      ext === "xlsm"
    )
  }
  if (cat === "database") {
    if (opts.scanDatabases === false) return false
    const ext = extensionOf(file.name)
    return ext === "sql" // binary .db not fully scannable
  }
  if (cat === "config") return opts.scanConfigs !== false
  if (cat === "text") return true
  return false
}

function readFileAsText(file: File, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const blob = file.size > maxBytes ? file.slice(0, maxBytes) : file
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ""))
    reader.onerror = () => reject(reader.error ?? new Error("read failed"))
    reader.readAsText(blob)
  })
}

/**
 * Scanne un fichier localement selon options policy.
 */
export async function scanFile(
  file: File,
  rules?: DetectionRule[] | null,
  opts: FileScanOptions = {}
): Promise<FileScanResult> {
  const category = categorizeFile(file)
  const base = {
    fileName: file.name,
    fileSize: file.size,
    category,
    text: "",
    detections: [] as Detection[],
    truncated: false
  }

  if (file.size === 0) {
    return { ...base, status: "empty" }
  }

  // Audio / vidéo : toujours warning + log décision
  if (category === "media" || opts.warnMedia !== false && MEDIA_EXTENSIONS.has(extensionOf(file.name))) {
    return {
      ...base,
      status: "media_warn",
      userHint:
        "Fichier audio/vidéo : OpsGate ne scanne pas le contenu. Confirmez l’envoi — un log sera enregistré."
    }
  }

  if (category === "image") {
    if (!opts.scanImages) {
      return {
        ...base,
        status: "image_skipped",
        userHint:
          "Image non scannée (OCR désactivé en policy). Confirmez l’envoi — un log sera enregistré."
      }
    }
    const ext = extensionOf(file.name)
    // SVG : texte XML direct (pas Tesseract)
    if (ext === "svg") {
      try {
        const svgText = await readFileAsText(file, MAX_FILE_BYTES)
        const plain = svgText
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim()
        if (plain.length > 8) {
          const detections = detectSensitiveData(plain, rules)
          return {
            ...base,
            status: "scanned",
            text: plain.slice(0, 200_000),
            detections
          }
        }
      } catch {
        /* fall through OCR / name */
      }
    }
    // OCR bitmap (PNG/JPEG/WebP/…) — background d’abord (évite CSP page), puis local
    try {
      const { OCR_LIMITS, fileToBase64, ocrBitmapFile } = await import(
        "./ocr-bitmap"
      )
      if (file.size > OCR_LIMITS.maxInputBytes) {
        const nameHits = detectSensitiveData(
          `${file.name} ${file.name.replace(/[_\-.]+/g, " ")}`,
          rules
        )
        return {
          ...base,
          status: "image_ocr_limited",
          detections: nameHits,
          userHint: `Image trop grande pour OCR (> ${Math.round(OCR_LIMITS.maxInputBytes / 1_000_000)} Mo). Confirmez l’envoi — log enregistré.`
        }
      }

      type OcrOut =
        | { ok: true; text: string; truncated: boolean }
        | { ok: false; error: string }

      let ocr: OcrOut
      // 1) Service worker (fiable sur sites à CSP strict)
      try {
        const { sendMessage } = await import("./browser-api")
        const b64 = await fileToBase64(file)
        const resp = (await sendMessage({
          type: "OCR_BITMAP",
          base64: b64,
          mime: file.type || "image/png",
          fileName: file.name
        })) as {
          ok?: boolean
          text?: string
          truncated?: boolean
          error?: string
        }
        if (resp?.ok && typeof resp.text === "string") {
          ocr = {
            ok: true,
            text: resp.text,
            truncated: !!resp.truncated
          }
        } else {
          throw new Error(resp?.error || "bg_ocr_failed")
        }
      } catch {
        // 2) Fallback content-script (lab / pages permissives)
        const local = await ocrBitmapFile(file)
        ocr =
          local.ok === true
            ? { ok: true, text: local.text, truncated: local.truncated }
            : { ok: false, error: local.ok === false ? local.error : "ocr_failed" }
      }

      if (ocr.ok === true && ocr.text.trim().length >= 3) {
        const detections = detectSensitiveData(ocr.text, rules)
        return {
          ...base,
          status: ocr.truncated ? "too_large_partial" : "scanned",
          text: ocr.text,
          detections,
          truncated: ocr.truncated,
          userHint: ocr.truncated
            ? "OCR partiel (texte tronqué)."
            : undefined
        }
      }
      if (ocr.ok === true && ocr.text.trim().length < 3) {
        return {
          ...base,
          status: "scanned",
          text: "",
          detections: [],
          userHint: "OCR : peu ou pas de texte détecté dans l’image."
        }
      }
      const nameHits = detectSensitiveData(
        `${file.name} ${file.name.replace(/[_\-.]+/g, " ")}`,
        rules
      )
      const errMsg = ocr.ok === false ? ocr.error : "error"
      return {
        ...base,
        status: "image_ocr_failed",
        detections: nameHits,
        userHint: `OCR indisponible (${errMsg}). Confirmez l’envoi — log enregistré.`
      }
    } catch (e) {
      const nameHits = detectSensitiveData(
        `${file.name} ${file.name.replace(/[_\-.]+/g, " ")}`,
        rules
      )
      return {
        ...base,
        status: "image_ocr_failed",
        detections: nameHits,
        userHint: `OCR en échec (${e instanceof Error ? e.message : "error"}). Confirmez l’envoi — log enregistré.`
      }
    }
  }

  if (category === "office") {
    const ext = extensionOf(file.name)
    // PDF / DOCX / PPTX / XLSX
    if (
      ext === "pdf" ||
      ext === "docx" ||
      ext === "pptx" ||
      ext === "xlsx" ||
      ext === "xlsm"
    ) {
      try {
        const { extractOfficeText } = await import("./office-extract")
        const extracted = await extractOfficeText(file, MAX_FILE_BYTES)
        if (extracted?.text?.trim()) {
          const detections = detectSensitiveData(extracted.text, rules)
          return {
            ...base,
            status: extracted.truncated ? "too_large_partial" : "scanned",
            text: extracted.text,
            detections,
            truncated: extracted.truncated,
            userHint: extracted.truncated
              ? `Document ${ext.toUpperCase()} partiellement scanné (taille / pages).`
              : undefined
          }
        }
        // extract fail / empty → warn confirm
        return {
          ...base,
          status: "office_warn",
          userHint: extracted
            ? `Document ${ext.toUpperCase()} sans texte extractible (scanne / image). Confirmez l’envoi — log enregistré.`
            : `Extraction ${ext.toUpperCase()} impossible. Confirmez l’envoi — log enregistré.`
        }
      } catch {
        return {
          ...base,
          status: "office_warn",
          userHint: `Extraction ${ext.toUpperCase()} en échec. Confirmez l’envoi — log enregistré.`
        }
      }
    }
    // Legacy Office binaires (doc, xls, ppt) — non supportés
    return {
      ...base,
      status: "office_warn",
      userHint:
        "Format Office legacy (doc/xls/ppt) non supporté — utilisez DOCX / XLSX / PPTX. Confirmez l’envoi — log avec type et nom enregistré."
    }
  }

  if (category === "database") {
    if (opts.scanDatabases === false) {
      return {
        ...base,
        status: "unsupported",
        userHint: "Fichiers base de données non scannés (policy)."
      }
    }
    const ext = extensionOf(file.name)
    if (ext !== "sql") {
      return {
        ...base,
        status: "warn_confirm",
        userHint:
          "Fichier base de données binaire (.db/.sqlite) : contenu non extrait. Confirmez l’envoi — log enregistré."
      }
    }
  }

  if (category === "config" && opts.scanConfigs === false) {
    return {
      ...base,
      status: "unsupported",
      userHint: "Fichiers de configuration non scannés (policy)."
    }
  }

  if (!isScannableFile(file, opts) && category !== "database") {
    return {
      ...base,
      status: "unsupported",
      userHint: "Type de fichier non scanné. Confirmez l’envoi pour journaliser."
    }
  }

  try {
    const truncated = file.size > MAX_FILE_BYTES
    const text = await readFileAsText(file, MAX_FILE_BYTES)
    if (!text.trim()) {
      return { ...base, status: "empty", truncated }
    }
    const detections = detectSensitiveData(text, rules)
    return {
      ...base,
      status: truncated ? "too_large_partial" : "scanned",
      text,
      detections,
      truncated,
      userHint: truncated
        ? `Fichier > ${Math.round(MAX_FILE_BYTES / 1e6)} Mo : seuls les premiers octets ont été scannés.`
        : undefined
    }
  } catch {
    return { ...base, status: "error", userHint: "Lecture du fichier impossible." }
  }
}

export async function scanFiles(
  files: FileList | File[],
  rules?: DetectionRule[] | null,
  opts?: FileScanOptions
): Promise<FileScanResult[]> {
  const list = Array.from(files)
  const out: FileScanResult[] = []
  for (const f of list) {
    out.push(await scanFile(f, rules, opts))
  }
  return out
}

/**
 * Reconstruit un DataTransfer avec le contenu texte masqué pour les fichiers concernés.
 */
export function buildMaskedFileList(
  original: FileList | File[],
  scans: FileScanResult[],
  rules?: DetectionRule[] | null
): DataTransfer {
  const dt = new DataTransfer()
  const files = Array.from(original)
  const byName = new Map(scans.map((s) => [s.fileName + ":" + s.fileSize, s]))

  for (const file of files) {
    const scan = byName.get(file.name + ":" + file.size)
    if (
      scan &&
      scan.detections.length > 0 &&
      (scan.status === "scanned" || scan.status === "too_large_partial") &&
      scan.text
    ) {
      const masked = maskSensitiveData(scan.text, scan.detections, rules)
      const body = scan.truncated
        ? masked +
          "\n\n/* [OpsGate] Fichier tronqué au scan — vérifiez le reste manuellement */\n"
        : masked
      dt.items.add(
        new File([body], file.name, {
          type: file.type || "text/plain",
          lastModified: Date.now()
        })
      )
    } else {
      dt.items.add(file)
    }
  }
  return dt
}

export function mergeDetections(scans: FileScanResult[]): Detection[] {
  const all: Detection[] = []
  for (const s of scans) {
    for (const d of s.detections) {
      all.push({
        ...d,
        match: `${s.fileName}: ${d.match}`
      })
    }
  }
  return all.filter(
    (d, i, arr) =>
      arr.findIndex((x) => x.ruleId === d.ruleId && x.match === d.match) === i
  )
}
