/**
 * TOTP RFC 6238 (HMAC-SHA1, 30s, 6 digits) — sans dépendance externe.
 * Compatible Google Authenticator / Microsoft Authenticator.
 */
import * as crypto from "node:crypto"

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"

export function generateTotpSecret(bytes = 20): string {
  const buf = crypto.randomBytes(bytes)
  return base32Encode(buf)
}

function base32Encode(buf: Buffer): string {
  let bits = 0
  let value = 0
  let out = ""
  for (const b of buf) {
    value = (value << 8) | b
    bits += 8
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31]
  return out
}

function base32Decode(s: string): Buffer {
  const clean = s.replace(/=+$/, "").toUpperCase().replace(/[^A-Z2-7]/g, "")
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const c of clean) {
    const idx = B32.indexOf(c)
    if (idx < 0) continue
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

export function totpCode(secretB32: string, step = 30, digits = 6, t = Date.now()): string {
  const key = base32Decode(secretB32)
  const counter = Math.floor(t / 1000 / step)
  const buf = Buffer.alloc(8)
  buf.writeBigUInt64BE(BigInt(counter))
  const hmac = crypto.createHmac("sha1", key).update(buf).digest()
  const offset = hmac[hmac.length - 1] & 0xf
  const bin =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)
  const mod = 10 ** digits
  return String(bin % mod).padStart(digits, "0")
}

/** Fenêtre ±1 step (tolérance horloge) */
export function verifyTotp(
  secretB32: string,
  code: string,
  window = 1
): boolean {
  const c = (code || "").replace(/\s/g, "")
  if (!/^\d{6}$/.test(c)) return false
  const now = Date.now()
  for (let w = -window; w <= window; w++) {
    if (totpCode(secretB32, 30, 6, now + w * 30_000) === c) return true
  }
  return false
}

export function otpauthUrl(opts: {
  secret: string
  email: string
  issuer?: string
}): string {
  const issuer = encodeURIComponent(opts.issuer || "OpsGate")
  const label = encodeURIComponent(`${opts.issuer || "OpsGate"}:${opts.email}`)
  return `otpauth://totp/${label}?secret=${opts.secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`
}
