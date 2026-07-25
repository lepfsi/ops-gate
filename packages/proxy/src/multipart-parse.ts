/**
 * Parse multipart/form-data (HTTP body) — T4 MITM deep scan.
 * Boundary-based, binary-safe (Buffer).
 */

export type MultipartPart = {
  name?: string
  filename?: string
  contentType?: string
  /** Raw body of the part (no MIME headers) */
  body: Buffer
}

/** Extrait boundary depuis Content-Type */
export function getMultipartBoundary(contentType: string): string | null {
  if (!contentType) return null
  const m = /boundary\s*=\s*(?:"([^"]+)"|([^\s;]+))/i.exec(contentType)
  if (!m) return null
  const b = (m[1] || m[2] || "").trim()
  return b || null
}

export function isMultipartContentType(contentType: string): boolean {
  return /multipart\//i.test(contentType || "")
}

/**
 * Split requête HTTP/1.1 brute → headers + body.
 * Gère Content-Length ; body = reste après \r\n\r\n (chunked non décodé ici).
 */
export function splitHttp11Request(raw: Buffer): {
  head: string
  body: Buffer
  contentType: string
  method: string
  path: string
} | null {
  if (!raw?.length) return null
  const rawStr = raw.toString("latin1")
  const sep = rawStr.indexOf("\r\n\r\n")
  if (sep < 0) return null
  const head = rawStr.slice(0, sep)
  let body = raw.subarray(sep + 4)
  const lines = head.split("\r\n")
  const reqLine = lines[0] || ""
  const rm = /^(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s+(\S+)/i.exec(reqLine)
  if (!rm) return null

  let contentType = ""
  let contentLength = -1
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i]!.indexOf(":")
    if (c < 0) continue
    const name = lines[i]!.slice(0, c).trim().toLowerCase()
    const value = lines[i]!.slice(c + 1).trim()
    if (name === "content-type") contentType = value
    if (name === "content-length") contentLength = parseInt(value, 10) || -1
  }

  // Truncate body to Content-Length if present (ignore trailers)
  if (contentLength >= 0 && body.length > contentLength) {
    body = body.subarray(0, contentLength)
  }

  return {
    head,
    body,
    contentType,
    method: rm[1]!.toUpperCase(),
    path: rm[2]!
  }
}

/**
 * Parse un corps multipart. `boundary` sans les `--` préfixes.
 */
export function parseMultipartBody(
  body: Buffer,
  boundary: string,
  opts?: { maxParts?: number; maxPartBytes?: number }
): MultipartPart[] {
  const maxParts = opts?.maxParts ?? 24
  const maxPartBytes = opts?.maxPartBytes ?? 12_000_000
  if (!body?.length || !boundary) return []

  const delim = Buffer.from(`--${boundary}`, "latin1")
  const parts: MultipartPart[] = []
  let pos = indexOf(body, delim, 0)
  if (pos < 0) return []

  while (parts.length < maxParts) {
    // skip delimiter + optional CRLF
    pos += delim.length
    if (pos < body.length && body[pos] === 0x2d && body[pos + 1] === 0x2d) {
      break // --boundary--
    }
    if (body[pos] === 0x0d && body[pos + 1] === 0x0a) pos += 2
    else if (body[pos] === 0x0a) pos += 1

    const next = indexOf(body, delim, pos)
    if (next < 0) break
    // part ends before \r\n--boundary
    let partEnd = next
    if (partEnd >= 2 && body[partEnd - 2] === 0x0d && body[partEnd - 1] === 0x0a) {
      partEnd -= 2
    } else if (partEnd >= 1 && body[partEnd - 1] === 0x0a) {
      partEnd -= 1
    }

    const partBuf = body.subarray(pos, partEnd)
    const parsed = parseOnePart(partBuf, maxPartBytes)
    if (parsed) parts.push(parsed)
    pos = next
  }

  return parts
}

function indexOf(hay: Buffer, needle: Buffer, from: number): number {
  return hay.indexOf(needle, from)
}

function parseOnePart(
  partBuf: Buffer,
  maxPartBytes: number
): MultipartPart | null {
  if (partBuf.length < 4) return null
  const s = partBuf.toString("latin1")
  let headerEnd = s.indexOf("\r\n\r\n")
  let bodyStart = 0
  if (headerEnd >= 0) {
    bodyStart = headerEnd + 4
  } else {
    headerEnd = s.indexOf("\n\n")
    if (headerEnd < 0) {
      // pas de headers MIME — corps brut
      const body = partBuf.length > maxPartBytes ? partBuf.subarray(0, maxPartBytes) : partBuf
      return { body: Buffer.from(body) }
    }
    bodyStart = headerEnd + 2
  }

  const headerBlock = s.slice(0, headerEnd)
  let body = partBuf.subarray(bodyStart)
  if (body.length > maxPartBytes) {
    body = body.subarray(0, maxPartBytes)
  }

  let name: string | undefined
  let filename: string | undefined
  let contentType: string | undefined

  for (const line of headerBlock.split(/\r?\n/)) {
    const c = line.indexOf(":")
    if (c < 0) continue
    const hName = line.slice(0, c).trim().toLowerCase()
    const hVal = line.slice(c + 1).trim()
    if (hName === "content-disposition") {
      const nm = /(?:^|;)\s*name\s*=\s*(?:"([^"]*)"|([^;\s]+))/i.exec(hVal)
      if (nm) name = (nm[1] ?? nm[2] ?? "").trim() || undefined
      const fn =
        /filename\*\s*=\s*UTF-8''([^;\s]+)/i.exec(hVal) ||
        /filename\s*=\s*"([^"]*)"/i.exec(hVal) ||
        /filename\s*=\s*([^;\s]+)/i.exec(hVal)
      if (fn) {
        try {
          filename = decodeURIComponent((fn[1] || "").trim().replace(/^.*[/\\]/, ""))
        } catch {
          filename = (fn[1] || "").trim().replace(/^.*[/\\]/, "")
        }
        if (!filename) filename = undefined
      }
    }
    if (hName === "content-type") contentType = hVal
  }

  return {
    name,
    filename,
    contentType,
    body: Buffer.from(body)
  }
}

/**
 * Heuristique : corps qui ressemble à du multipart sans Content-Type (HTTP/2 DATA seul).
 */
export function guessMultipartBoundary(body: Buffer): string | null {
  if (!body?.length || body[0] !== 0x2d || body[1] !== 0x2d) return null
  // --BOUNDARY\r\n
  const s = body.toString("latin1", 0, Math.min(body.length, 200))
  const m = /^--([^\r\n]{1,70})\r?\n/.exec(s)
  if (!m) return null
  const b = m[1]!
  if (b.endsWith("--")) return null
  // Doit contenir Content-Disposition quelque part
  const head = body.toString("latin1", 0, Math.min(body.length, 8000))
  if (!/content-disposition/i.test(head)) return null
  return b
}
