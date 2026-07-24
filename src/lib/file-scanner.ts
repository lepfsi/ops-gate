import {
  detectSensitiveData,
  maskSensitiveData,
  secureRewrite,
  type Detection,
  type DetectionRule
} from "@opsgate/engine"

// Import STATIQUE obligatoire (content script Plasmo) :
// `await import("./office-extract")` produit des chunks hashés (ex. gTf5N)
// introuvables au runtime → « Cannot find module 'gTf5N' ».
import { extractOfficeText } from "./office-extract"

/**
 * Taille max lue par fichier (25 Mo).
 * Au-delà : scan du début uniquement + flag truncated.
 */
export const MAX_FILE_BYTES = 25_000_000

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
  /** Scanner configs (.conf, .json, .xml…) - défaut true */
  scanConfigs?: boolean
  /** Scanner SQL / tenter texte DB - défaut true */
  scanDatabases?: boolean
  /** OCR images (Tesseract) - défaut false */
  scanImages?: boolean
  /** PDF / DOCX / PPTX / XLSX - défaut true */
  scanOffice?: boolean
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
    // csv is both office and text - treat as text scannable
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
    // PDF / DOCX / PPTX / XLSX extraits si scanOffice !== false
    if (opts.scanOffice === false) return false
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
        "Fichier audio/vidéo : OpsGate ne scanne pas le contenu. Confirmez l’envoi - un log sera enregistré."
    }
  }

  if (category === "image") {
    if (!opts.scanImages) {
      return {
        ...base,
        status: "image_skipped",
        userHint:
          "Image non scannée (OCR désactivé en policy). Confirmez l’envoi - un log sera enregistré."
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
    // OCR bitmap (PNG/JPEG/WebP/…) - background d’abord (évite CSP page), puis local
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
          userHint: `Image trop grande pour OCR (> ${Math.round(OCR_LIMITS.maxInputBytes / 1_000_000)} Mo). Confirmez l’envoi - log enregistré.`
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
        userHint: `OCR indisponible (${errMsg}). Confirmez l’envoi - log enregistré.`
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
        userHint: `OCR en échec (${e instanceof Error ? e.message : "error"}). Confirmez l’envoi - log enregistré.`
      }
    }
  }

  if (category === "office") {
    const ext = extensionOf(file.name)
    if (opts.scanOffice === false) {
      return {
        ...base,
        status: "office_warn",
        userHint:
          "Documents Office/PDF non scannés (policy). Confirmez l'envoi - log enregistré."
      }
    }
    // PDF / DOCX / PPTX / XLSX
    if (
      ext === "pdf" ||
      ext === "docx" ||
      ext === "pptx" ||
      ext === "xlsx" ||
      ext === "xlsm"
    ) {
      try {
        const extracted = await extractOfficeText(file, MAX_FILE_BYTES)
        if (extracted?.errorCode === "pdf_too_many_pages") {
          // P1 : PDF > 30 pages → tenter proxy local
          const proxy = await tryProxyFileScan(file)
          if (proxy) return { ...base, ...proxy }
          return {
            ...base,
            status: "office_warn",
            userHint: `PDF trop long pour le navigateur (${extracted.pageCount || "?"} pages, max 30 ici). Installez le proxy OpsGate pour un scan complet, ou divisez le fichier.`
          }
        }
        if (extracted?.errorCode === "timeout") {
          const proxy = await tryProxyFileScan(file)
          if (proxy) return { ...base, ...proxy }
          return {
            ...base,
            status: "office_warn",
            userHint:
              "Analyse du document trop longue dans le navigateur. Réessayez un fichier plus léger, ou utilisez le proxy OpsGate pour les documents lourds."
          }
        }
        if (extracted?.errorCode === "docx_extract_failed") {
          const proxy = await tryProxyFileScan(file)
          if (proxy) return { ...base, ...proxy }
          const nameHits = detectSensitiveData(
            `${file.name} ${file.name.replace(/[_\-.]+/g, " ")}`,
            rules
          )
          return {
            ...base,
            status: "office_warn",
            detections: nameHits,
            userHint:
              "DOCX non lisible (structure ZIP/XML inhabituelle). Réenregistrez le fichier en « Word (.docx) » depuis Word/LibreOffice, ou activez le proxy OpsGate."
          }
        }
        if (extracted?.errorCode === "pdf_no_text") {
          return {
            ...base,
            status: "office_warn",
            userHint:
              "PDF sans texte extractible (scanné/image). Convertissez en DOCX texte, ou utilisez le proxy OpsGate avec OCR si policy."
          }
        }
        if (extracted?.text?.trim()) {
          const detections = detectSensitiveData(extracted.text, rules)
          console.log(
            "[OpsGate] office scan OK",
            file.name,
            `chars=${extracted.text.length}`,
            `detections=${detections.length}`,
            extracted.errorCode || ""
          )
          return {
            ...base,
            status: extracted.truncated || extracted.errorCode === "docx_partial_raw"
              ? "too_large_partial"
              : "scanned",
            text: extracted.text,
            detections,
            truncated:
              extracted.truncated || extracted.errorCode === "docx_partial_raw",
            userHint:
              extracted.errorCode === "docx_partial_raw"
                ? "DOCX lu en mode partiel (texte extrait des XML). Le contenu principal a été scanné."
                : extracted.truncated
                  ? `Document ${ext.toUpperCase()} partiellement scanné (limite taille / pages extension).`
                  : undefined
          }
        }
        // PDF/DOCX sans texte : ne jamais laisser passer en silence
        console.warn(
          "[OpsGate] office scan empty",
          file.name,
          extracted?.errorCode || "no_text"
        )
        return {
          ...base,
          status: "office_warn",
          userHint: extracted
            ? ext === "pdf"
              ? "PDF sans texte extractible (probablement scanné/image). Convertissez en DOCX texte ou activez l’OCR proxy."
              : `Document ${ext.toUpperCase()} sans texte extractible. Vérifiez qu’il contient du texte sélectionnable.`
            : `Extraction ${ext.toUpperCase()} impossible. Formats supportés : PDF texte ≤30 p., DOCX, PPTX, XLSX.`
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        console.warn("[OpsGate] office scan error", file.name, msg)
        // Plasmo chunk manquant (ne devrait plus arriver avec import statique)
        if (/Cannot find module|gTf5N|Loading chunk/i.test(msg)) {
          return {
            ...base,
            status: "office_warn",
            userHint:
              "Module d’analyse Office indisponible (rebuild extension requis : pnpm build:chrome). En attendant, le proxy OpsGate peut scanner le fichier."
          }
        }
        if (ext === "docx") {
          const proxy = await tryProxyFileScan(file)
          if (proxy) return { ...base, ...proxy }
          return {
            ...base,
            status: "office_warn",
            userHint: `Échec lecture DOCX (${msg.slice(0, 80)}). Réenregistrez le fichier en .docx standard, ou lancez le proxy OpsGate.`
          }
        }
        if (ext === "xlsx" || ext === "xlsm" || ext === "pptx") {
          const proxy = await tryProxyFileScan(file)
          if (proxy) return { ...base, ...proxy }
          return {
            ...base,
            status: "office_warn",
            userHint: `Échec lecture ${ext.toUpperCase()} (${msg.slice(0, 60)}). Réessayez après rebuild extension, ou activez le proxy.`
          }
        }
        return {
          ...base,
          status: "office_warn",
          userHint: `Extraction ${ext.toUpperCase()} en échec (${msg.slice(0, 60)}). Formats supportés : PDF texte, DOCX, PPTX, XLSX.`
        }
      }
    }
    // Legacy Office binaires (doc, xls, ppt) - non supportés
    return {
      ...base,
      status: "office_warn",
      userHint:
        "Format Office legacy (.doc / .xls / .ppt) non supporté. Enregistrez en DOCX, XLSX ou PPTX puis renvoyez."
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
          "Fichier base de données binaire (.db/.sqlite) : contenu non extrait. Confirmez l’envoi - log enregistré."
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

/**
 * Scan lourd via proxy local (contrat Recommandations.md).
 * POST http://127.0.0.1:8888/opsgate-proxy/scan-file
 * Body: { filename, mime, content_base64 }
 * Response: { status, text, truncated, error?, detections? }
 */
async function tryProxyFileScan(
  file: File
): Promise<Partial<FileScanResult> | null> {
  const bases = [
    "http://127.0.0.1:8888",
    "http://127.0.0.1:8899",
    (typeof localStorage !== "undefined" &&
      localStorage.getItem("opsgate_proxy_scan_url")) ||
      ""
  ].filter(Boolean) as string[]

  let b64: string
  try {
    const buf = await file.arrayBuffer()
    const bytes = new Uint8Array(buf)
    let binary = ""
    const chunk = 0x8000
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
    }
    b64 = btoa(binary)
  } catch {
    return null
  }

  for (const base of bases) {
    try {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), 12_000)
      const res = await fetch(`${base.replace(/\/$/, "")}/opsgate-proxy/scan-file`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          mime: file.type || "application/octet-stream",
          content_base64: b64
        }),
        signal: ctrl.signal
      })
      clearTimeout(t)
      if (!res.ok) continue
      const j = (await res.json()) as {
        status?: string
        text?: string
        truncated?: boolean
        error?: string
        detections?: Detection[]
      }
      if (j.status === "failed" || j.status === "timeout") {
        return {
          status: "office_warn",
          userHint:
            j.error ||
            `Proxy scan ${j.status}. Vérifiez que le proxy OpsGate est démarré (pnpm proxy:dev).`
        }
      }
      const text = (j.text || "").trim()
      if (!text) continue
      // Re-détection locale pour types Detection complets
      const detections = detectSensitiveData(text)
      return {
        status: j.truncated || j.status === "partial" ? "too_large_partial" : "scanned",
        text,
        detections,
        truncated: !!j.truncated || j.status === "partial",
        userHint: j.truncated
          ? "Scan proxy partiel (document volumineux)."
          : "Scan effectué via le proxy OpsGate local."
      }
    } catch {
      /* proxy absent */
    }
  }
  return null
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
 * Nom de sortie sûr après mask/rewrite.
 * IMPORTANT : ne jamais renvoyer du texte plat avec une extension .docx/.pdf —
 * les SPA (ChatGPT…) tentent de parser le format d’origine → « parsing failed ».
 */
export function safeRewrittenFileName(
  originalName: string,
  kind: "secure" | "masked"
): string {
  const base = originalName.replace(/\.[^.]+$/, "") || originalName
  return `${base}.opsgate-${kind}.txt`
}

/**
 * Reconstruit un DataTransfer avec le contenu texte masqué / rewrite.
 * @param previewRewrittenText texte édité dans le bandeau (prioritaire si 1 fichier sensible)
 */
export function buildMaskedFileList(
  original: FileList | File[],
  scans: FileScanResult[],
  rules?: DetectionRule[] | null,
  mode: "mask" | "secure_rewrite" = "mask",
  opts?: { previewRewrittenText?: string }
): DataTransfer {
  const dt = new DataTransfer()
  const files = Array.from(original)
  const byName = new Map(scans.map((s) => [s.fileName + ":" + s.fileSize, s]))
  const kind = mode === "secure_rewrite" ? "secure" : "masked"
  const sensitiveScans = scans.filter(
    (s) =>
      s.detections.length > 0 &&
      (s.status === "scanned" || s.status === "too_large_partial") &&
      s.text
  )

  // Preview bandeau (utilisateur a vu/édité le rewrite) — un seul fichier sensible
  const preview = (opts?.previewRewrittenText || "").trim()
  if (mode === "secure_rewrite" && preview && sensitiveScans.length === 1) {
    const only = sensitiveScans[0]
    let body = preview
    // Retirer en-tête agrégé « --- filename --- »
    const hdr = new RegExp(
      `^---\\s*${escapeRegExp(only.fileName)}\\s*---\\s*\\n?`,
      "i"
    )
    body = body.replace(hdr, "").trim()
    // Si multi-sections encore présentes, prendre le corps après le premier header
    if (body.includes("--- ") && body.includes(only.fileName)) {
      const idx = body.indexOf(only.fileName)
      if (idx >= 0) {
        const after = body.slice(idx + only.fileName.length)
        body = after.replace(/^[\s\-—]*\n?/, "").trim() || body
      }
    }
    if (only.truncated) {
      body +=
        "\n\n/* [OpsGate] Fichier tronqué au scan - vérifiez le reste manuellement */\n"
    }
    const outName = safeRewrittenFileName(only.fileName, "secure")
    dt.items.add(
      new File([body], outName, {
        type: "text/plain;charset=utf-8",
        lastModified: Date.now()
      })
    )
    // Autres fichiers non sensibles : originaux
    for (const file of files) {
      if (file.name === only.fileName && file.size === only.fileSize) continue
      dt.items.add(file)
    }
    return dt
  }

  for (const file of files) {
    const scan = byName.get(file.name + ":" + file.size)
    if (
      scan &&
      scan.detections.length > 0 &&
      (scan.status === "scanned" || scan.status === "too_large_partial") &&
      scan.text
    ) {
      const masked =
        mode === "secure_rewrite"
          ? secureRewrite(scan.text, scan.detections, {
              consistentMapping: true,
              aggressiveness: 2
            }).rewrittenText
          : maskSensitiveData(scan.text, scan.detections, rules)
      const body = scan.truncated
        ? masked +
          "\n\n/* [OpsGate] Fichier tronqué au scan - vérifiez le reste manuellement */\n"
        : masked
      // Toujours .txt — le site ne peut pas parser un faux .docx/.pdf
      const outName = safeRewrittenFileName(file.name, kind)
      dt.items.add(
        new File([body], outName, {
          type: "text/plain;charset=utf-8",
          lastModified: Date.now()
        })
      )
    } else {
      dt.items.add(file)
    }
  }
  return dt
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
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
