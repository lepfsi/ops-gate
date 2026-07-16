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
 */
export function sendMessage<T = unknown>(message: unknown): Promise<T> {
  const api = ext
  return new Promise((resolve, reject) => {
    try {
      const ret = api.runtime.sendMessage(message, (response: T) => {
        const err = api.runtime.lastError
        if (err) {
          reject(new Error(err.message || String(err)))
          return
        }
        resolve(response)
      })
      // Promise-based browser API
      if (ret && typeof (ret as Promise<T>).then === "function") {
        ;(ret as Promise<T>).then(resolve, reject)
      }
    } catch (e) {
      reject(e)
    }
  })
}
