/**
 * OCR local (proxy) — Tesseract.js.
 * Tranche 2 : images upload + images embarquées PDF scannés.
 *
 * Limites (volontaires, process long-lived) :
 *  - fichier image ≤ 12 Mo
 *  - ≤ 6 images / PDF
 *  - timeout par image 25 s, total 75 s
 *  - langues : OPSGATE_OCR_LANG (défaut eng+fra)
 */
import { createWorker, type Worker } from "tesseract.js"
import { log } from "./log.js"

export const OCR_LIMITS = {
  maxInputBytes: 12_000_000,
  maxImagesPerDoc: 6,
  perImageMs: 25_000,
  totalMs: 75_000,
  maxTextChars: 200_000
} as const

export type OcrResult =
  | { ok: true; text: string; truncated: boolean; ms: number; images: number }
  | { ok: false; error: string; ms: number }

let workerPromise: Promise<Worker> | null = null
let workerFailed = false

function ocrLangs(): string {
  const env = (process.env.OPSGATE_OCR_LANG || "").trim()
  if (env) return env
  // eng+fra : secrets FR + docs mixtes (télécharge packs au 1er appel)
  return "eng+fra"
}

async function getWorker(): Promise<Worker> {
  if (workerFailed) throw new Error("ocr_worker_unavailable")
  if (!workerPromise) {
    workerPromise = (async () => {
      const langs = ocrLangs()
      log("info", "ocr_worker_init", { langs })
      const worker = await createWorker(langs, 1, {
        // logs silencieux sauf erreur
        logger: () => {}
      })
      return worker
    })().catch((e) => {
      workerFailed = true
      workerPromise = null
      throw e
    })
  }
  return workerPromise
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(label)), ms)
    p.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e) => {
        clearTimeout(t)
        reject(e)
      }
    )
  })
}

function isUsefulOcr(text: string): boolean {
  const t = text.replace(/\s+/g, " ").trim()
  if (t.length < 3) return false
  return /[A-Za-zÀ-ÿ0-9@._\-]{2,}/.test(t)
}

/**
 * OCR d’un buffer image (PNG/JPEG/WebP/BMP/GIF selon support Tesseract).
 */
export async function ocrImageBuffer(
  buf: Buffer,
  opts?: { label?: string }
): Promise<OcrResult> {
  const started = Date.now()
  if (!buf?.length) {
    return { ok: false, error: "image_empty", ms: 0 }
  }
  if (buf.length > OCR_LIMITS.maxInputBytes) {
    return {
      ok: false,
      error: `image_too_large (>${Math.round(OCR_LIMITS.maxInputBytes / 1e6)} Mo)`,
      ms: Date.now() - started
    }
  }

  try {
    const worker = await getWorker()
    const { data } = await withTimeout(
      worker.recognize(buf),
      OCR_LIMITS.perImageMs,
      "ocr_timeout"
    )
    let text = (data?.text || "")
      .replace(/\u0000/g, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
    let truncated = false
    if (text.length > OCR_LIMITS.maxTextChars) {
      text = text.slice(0, OCR_LIMITS.maxTextChars)
      truncated = true
    }
    const ms = Date.now() - started
    if (!isUsefulOcr(text)) {
      log("info", "ocr_little_text", {
        label: opts?.label,
        ms,
        chars: text.length
      })
      return { ok: true, text: text || "", truncated, ms, images: 1 }
    }
    log("info", "ocr_ok", {
      label: opts?.label,
      ms,
      chars: text.length
    })
    return { ok: true, text, truncated, ms, images: 1 }
  } catch (e) {
    const ms = Date.now() - started
    const error = e instanceof Error ? e.message : String(e)
    log("warn", "ocr_failed", { label: opts?.label, error, ms })
    return { ok: false, error, ms }
  }
}

/**
 * OCR d’une liste d’images (ex. pages PDF scannées extraites).
 */
export async function ocrImageList(
  images: Buffer[],
  opts?: { maxImages?: number }
): Promise<OcrResult> {
  const started = Date.now()
  const max = opts?.maxImages ?? OCR_LIMITS.maxImagesPerDoc
  const slice = images.slice(0, max)
  if (!slice.length) {
    return { ok: false, error: "no_images", ms: 0 }
  }

  const parts: string[] = []
  let truncated = images.length > max
  let okCount = 0

  for (let i = 0; i < slice.length; i++) {
    if (Date.now() - started > OCR_LIMITS.totalMs) {
      truncated = true
      break
    }
    const r = await ocrImageBuffer(slice[i], { label: `img_${i + 1}` })
    if (r.ok && r.text.trim()) {
      parts.push(r.text.trim())
      okCount++
      if (r.truncated) truncated = true
    }
  }

  const text = parts.join("\n\n").trim()
  const ms = Date.now() - started
  if (!text) {
    return {
      ok: false,
      error: okCount === 0 ? "ocr_no_text" : "ocr_empty",
      ms
    }
  }
  let out = text
  if (out.length > OCR_LIMITS.maxTextChars) {
    out = out.slice(0, OCR_LIMITS.maxTextChars)
    truncated = true
  }
  return { ok: true, text: out, truncated, ms, images: okCount }
}

/** Termine le worker (tests / shutdown optionnel). */
export async function terminateOcrWorker(): Promise<void> {
  if (!workerPromise) return
  try {
    const w = await workerPromise
    await w.terminate()
  } catch {
    /* ignore */
  }
  workerPromise = null
  workerFailed = false
}
