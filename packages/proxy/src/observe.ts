/**
 * Observe P1 : scan du trafic client→serveur décrypté (sans rewrite).
 * Fonctionne sur HTTP/1.1 et HTTP/2 en cherchant du texte / JSON dans le flux.
 */
import { inspectText } from "./inspect.js"
import { log } from "./log.js"

const MAX_WINDOW = 64 * 1024
const MIN_INTERVAL_MS = 1500
const MIN_CHUNK = 32

export type StreamObserver = {
  onClientData: (chunk: Buffer) => void
  flush: () => void
}

/** Extrait des fragments textuels utiles (JSON strings, ASCII long). */
export function extractTextCandidates(buf: string): string[] {
  const out: string[] = []
  // Chaînes JSON "..."
  const reJson = /"((?:\\.|[^"\\]){8,2000})"/g
  let m: RegExpExecArray | null
  while ((m = reJson.exec(buf)) !== null) {
    try {
      out.push(JSON.parse(`"${m[1]}"`))
    } catch {
      out.push(m[1])
    }
  }
  // Blocs ASCII lisibles
  const reAscii = /[A-Za-z0-9_$/:.=+@\- ]{20,}/g
  while ((m = reAscii.exec(buf)) !== null) {
    out.push(m[0])
  }
  // Dédup grossier
  return [...new Set(out)].slice(0, 40)
}

export function createStreamObserver(meta: {
  host: string
  direction?: "client_to_server"
}): StreamObserver {
  let window = ""
  let lastScan = 0
  const seenKeys = new Set<string>()

  const scan = (force = false) => {
    const now = Date.now()
    if (!force && now - lastScan < MIN_INTERVAL_MS) return
    if (window.length < MIN_CHUNK) return
    lastScan = now

    const candidates = extractTextCandidates(window)
    if (!candidates.length) return

    // Joindre pour un passage engine (limite taille)
    const blob = candidates.join("\n").slice(0, 24_000)
    const result = inspectText(blob)
    if (result.detection_count === 0) return

    const key = result.rule_ids.sort().join(",") + ":" + result.highest_severity
    if (seenKeys.has(key)) return
    seenKeys.add(key)
    // Eviter explosion mémoire des clés
    if (seenKeys.size > 200) seenKeys.clear()

    log("info", "observe_detection", {
      host: meta.host,
      mode: "observe_mitm",
      source: "proxy",
      detection_count: result.detection_count,
      highest_severity: result.highest_severity,
      rule_ids: result.rule_ids,
      types: result.types,
      // previews redactées uniquement
      samples: result.detections.slice(0, 5).map((d) => ({
        ruleId: d.ruleId,
        severity: d.severity,
        preview: d.preview
      }))
    })
  }

  return {
    onClientData(chunk: Buffer) {
      // Prefer utf8; binary noise is ok, extractors are tolerant
      window += chunk.toString("utf8")
      if (window.length > MAX_WINDOW) {
        window = window.slice(window.length - MAX_WINDOW)
      }
      scan(false)
    },
    flush() {
      scan(true)
      window = ""
    }
  }
}
