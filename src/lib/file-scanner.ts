import {
  detectSensitiveData,
  maskSensitiveData,
  type Detection,
  type DetectionRule
} from "@opsgate/engine"

/** Taille max lue (MVP) — au-delà on scanne seulement le début */
export const MAX_FILE_BYTES = 1_500_000

/** Extensions / types textuels scannables en MVP */
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
  "env.example"
])

export type FileScanStatus =
  | "scanned"
  | "unsupported"
  | "too_large_partial"
  | "empty"
  | "error"

export interface FileScanResult {
  fileName: string
  fileSize: number
  status: FileScanStatus
  text: string
  detections: Detection[]
  /** true si le contenu a été tronqué pour le scan */
  truncated: boolean
}

function extensionOf(name: string): string {
  const lower = name.toLowerCase()
  // double extensions type .env.local
  if (lower.endsWith(".env.local") || lower.endsWith(".env.example")) {
    return lower.split(".").slice(-2).join(".")
  }
  const i = lower.lastIndexOf(".")
  return i >= 0 ? lower.slice(i + 1) : ""
}

export function isScannableFile(file: File): boolean {
  const ext = extensionOf(file.name)
  if (TEXT_EXTENSIONS.has(ext)) return true
  if (file.type.startsWith("text/")) return true
  if (
    file.type === "application/json" ||
    file.type === "application/xml" ||
    file.type === "application/x-yaml"
  ) {
    return true
  }
  // Fichiers sans extension mais petits : on tente
  if (!ext && file.size > 0 && file.size < 200_000) return true
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
 * Scanne un fichier localement. Ne remonte rien hors de l'extension.
 */
export async function scanFile(
  file: File,
  rules?: DetectionRule[] | null
): Promise<FileScanResult> {
  const base = {
    fileName: file.name,
    fileSize: file.size,
    text: "",
    detections: [] as Detection[],
    truncated: false
  }

  if (file.size === 0) {
    return { ...base, status: "empty" }
  }

  if (!isScannableFile(file)) {
    return { ...base, status: "unsupported" }
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
      truncated
    }
  } catch {
    return { ...base, status: "error" }
  }
}

export async function scanFiles(
  files: FileList | File[],
  rules?: DetectionRule[] | null
): Promise<FileScanResult[]> {
  const list = Array.from(files)
  const results: FileScanResult[] = []
  for (const f of list) {
    results.push(await scanFile(f, rules))
  }
  return results
}

/**
 * Reconstruit un FileList avec le contenu texte masqué pour les fichiers concernés.
 * Les fichiers non textuels / sans détection sont recopiés tels quels.
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
      // Si tronqué, on ne peut pas masquer tout le fichier de façon sûre :
      // on remplace quand même la portion lue + note
      const body =
        scan.truncated
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
        // Préfixe le match avec le nom de fichier pour le bandeau
        match: `${s.fileName}: ${d.match}`
      })
    }
  }
  // Dédup
  return all.filter(
    (d, i, arr) =>
      arr.findIndex((x) => x.ruleId === d.ruleId && x.match === d.match) === i
  )
}
