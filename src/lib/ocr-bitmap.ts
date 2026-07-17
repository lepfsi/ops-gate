/**
 * OCR bitmap local (PNG/JPEG/WebP/…) via Tesseract.js.
 * Activé uniquement si policy scanImages = true.
 *
 * Peut tourner :
 *  - dans un content script (si le site autorise workers/WASM)
 *  - dans le service worker / background (OffscreenCanvas + blob)
 *
 * Limites perf :
 *  - max 4 Mo fichier source
 *  - redimensionnement max 1600 px (côté long)
 *  - timeout 30 s
 *  - worker réutilisé (singleton)
 */

const MAX_OCR_INPUT_BYTES = 4_000_000
const MAX_OCR_SIDE = 1600
const OCR_TIMEOUT_MS = 30_000
const MAX_OCR_TEXT = 100_000

export type OcrBitmapResult =
  | { ok: true; text: string; truncated: boolean; ms: number }
  | { ok: false; error: string }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let workerPromise: Promise<any> | null = null
let workerFailed = false

async function getWorker() {
  if (workerFailed) throw new Error("ocr_worker_unavailable")
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import("tesseract.js")
      // eng : pack léger (chiffres cartes, IBAN, secrets en clair)
      const worker = await createWorker("eng", 1, {})
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

/** Prépare une image redimensionnée → Blob PNG (meilleur contraste pour OCR) */
async function preparePngBlob(input: Blob): Promise<Blob> {
  if (typeof createImageBitmap !== "function") {
    throw new Error("imagebitmap_unsupported")
  }
  const bmp = await createImageBitmap(input)
  try {
    let w = bmp.width
    let h = bmp.height
    if (w < 8 || h < 8) throw new Error("image_too_small")
    const long = Math.max(w, h)
    if (long > MAX_OCR_SIDE) {
      const s = MAX_OCR_SIDE / long
      w = Math.max(1, Math.round(w * s))
      h = Math.max(1, Math.round(h * s))
    }

    // Service worker / background : OffscreenCanvas
    if (typeof OffscreenCanvas !== "undefined") {
      const canvas = new OffscreenCanvas(w, h)
      const ctx = canvas.getContext("2d")
      if (!ctx) throw new Error("canvas_unavailable")
      ctx.fillStyle = "#ffffff"
      ctx.fillRect(0, 0, w, h)
      ctx.drawImage(bmp, 0, 0, w, h)
      return await canvas.convertToBlob({ type: "image/png" })
    }

    // Document / content script
    const canvas = document.createElement("canvas")
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext("2d", { willReadFrequently: true })
    if (!ctx) throw new Error("canvas_unavailable")
    ctx.fillStyle = "#ffffff"
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(bmp, 0, 0, w, h)
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("toblob_failed"))),
        "image/png"
      )
    })
  } finally {
    bmp.close()
  }
}

/**
 * OCR d’un Blob / File image.
 */
export async function ocrBitmapBlob(input: Blob): Promise<OcrBitmapResult> {
  if (!input || input.size <= 0) return { ok: false, error: "empty" }
  if (input.size > MAX_OCR_INPUT_BYTES) {
    return { ok: false, error: "image_too_large" }
  }
  const mime = (input.type || "").toLowerCase()
  if (mime.includes("svg")) {
    return { ok: false, error: "use_svg_text_path" }
  }

  const t0 = Date.now()
  try {
    const prepared = await preparePngBlob(input)
    const worker = await getWorker()
    const result = (await withTimeout(
      worker.recognize(prepared),
      OCR_TIMEOUT_MS,
      "ocr_timeout"
    )) as { data?: { text?: string } }
    let text = String(result?.data?.text || "")
      .replace(/\s+/g, " ")
      .trim()
    let truncated = false
    if (text.length > MAX_OCR_TEXT) {
      text = text.slice(0, MAX_OCR_TEXT)
      truncated = true
    }
    return { ok: true, text, truncated, ms: Date.now() - t0 }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.warn("[OpsGate] OCR bitmap failed:", msg)
    return { ok: false, error: msg || "ocr_failed" }
  }
}

export async function ocrBitmapFile(file: File): Promise<OcrBitmapResult> {
  return ocrBitmapBlob(file)
}

/**
 * OCR depuis base64 (message background).
 * dataUrl ou raw base64 + mime optionnel.
 */
export async function ocrBitmapBase64(
  base64: string,
  mime = "image/png"
): Promise<OcrBitmapResult> {
  try {
    const raw = base64.includes(",")
      ? base64.split(",")[1] || ""
      : base64
    const bin = atob(raw)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    const blob = new Blob([bytes], { type: mime || "image/png" })
    return await ocrBitmapBlob(blob)
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "base64_decode_failed"
    }
  }
}

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

export const OCR_LIMITS = {
  maxInputBytes: MAX_OCR_INPUT_BYTES,
  maxSide: MAX_OCR_SIDE,
  timeoutMs: OCR_TIMEOUT_MS
}

/** File → base64 pour messaging (sans data: prefix pour taille) */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const s = String(reader.result || "")
      const i = s.indexOf(",")
      resolve(i >= 0 ? s.slice(i + 1) : s)
    }
    reader.onerror = () => reject(reader.error || new Error("read_failed"))
    reader.readAsDataURL(file)
  })
}
