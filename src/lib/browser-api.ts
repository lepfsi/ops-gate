/**
 * Shim API extension cross-browser (Chrome MV3 + Firefox MV3).
 * Firefox expose `browser` (promises) et souvent `chrome` (callbacks).
 * On normalise vers un objet type chrome.* utilisé.
 */

type ChromeLike = typeof chrome

function pickApi(): ChromeLike {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any
  if (typeof g.chrome !== "undefined" && g.chrome?.runtime?.id) {
    return g.chrome as ChromeLike
  }
  if (typeof g.browser !== "undefined" && g.browser?.runtime) {
    // Firefox : browser est promise-based ; beaucoup d'APIs restent compatibles
    // si on utilise await sendMessage (chrome renvoie aussi thenable en MV3).
    return g.browser as ChromeLike
  }
  if (typeof g.chrome !== "undefined") {
    return g.chrome as ChromeLike
  }
  throw new Error("OpsGate: WebExtension API introuvable (chrome/browser)")
}

/** API extension unifiée — préférer `ext` plutôt que `chrome` global. */
export const ext: ChromeLike = /* @__PURE__ */ (() => {
  try {
    return pickApi()
  } catch {
    // Pendant le build / SSR Plasmo, chrome peut être absent
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (globalThis as any).chrome as ChromeLike
  }
})()

export function isFirefox(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = globalThis as any
    const ua = g.navigator?.userAgent || ""
    if (/Firefox\//i.test(ua)) return true
    // gecko runtime id check
    const br = g.browser || g.chrome
    return !!br?.runtime?.getBrowserInfo
  } catch {
    return false
  }
}

/**
 * sendMessage promisifié (Firefox browser.* + Chrome).
 * Utiliser systématiquement cette forme (callback) pour réveiller le SW MV3
 * et récupérer lastError — le fire-and-forget perd des messages.
 */
export function sendMessage<T = unknown>(message: unknown): Promise<T> {
  const api = ext
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      fn()
    }
    try {
      // Chrome callback style (MV3) — réveille le service worker
      const maybePromise = api.runtime.sendMessage(
        message,
        (response: T) => {
          const err = api.runtime.lastError
          if (err) {
            finish(() =>
              reject(new Error(err.message || String(err)))
            )
            return
          }
          finish(() => resolve(response))
        }
      ) as unknown
      // Firefox browser.* : renvoie souvent une Promise (sans callback fiable)
      if (
        maybePromise &&
        typeof (maybePromise as Promise<T>).then === "function"
      ) {
        ;(maybePromise as Promise<T>).then(
          (v) => finish(() => resolve(v)),
          (e) => finish(() => reject(e))
        )
      }
    } catch (e) {
      finish(() => reject(e))
    }
  })
}

/** sendMessage avec retries (SW endormi / extension reload). */
export async function sendMessageWithRetry<T = unknown>(
  message: unknown,
  attempts = 3,
  baseDelayMs = 120
): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await sendMessage<T>(message)
    } catch (e) {
      lastErr = e
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, baseDelayMs * (i + 1)))
      }
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error(String(lastErr || "sendMessage_failed"))
}
