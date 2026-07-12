/**
 * Vérifie un RulePack reçu de l'API (checksum + signature ed25519).
 * Utilise Web Crypto (Chrome 113+).
 */

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text)
  const hash = await crypto.subtle.digest("SHA-256", data)
  return [...new Uint8Array(hash)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function b64urlToBytes(b64url: string): Uint8Array {
  const pad = "=".repeat((4 - (b64url.length % 4)) % 4)
  const b64 = (b64url + pad).replace(/-/g, "+").replace(/_/g, "/")
  return b64ToBytes(b64)
}

export async function computeRulesChecksum(rules: unknown): Promise<string> {
  // Doit matcher packages/api checksumJson = sha256(JSON.stringify(rules))
  return sha256Hex(JSON.stringify(rules))
}

export async function fetchApiPublicKey(
  apiBaseUrl: string
): Promise<string | null> {
  try {
    const res = await fetch(
      `${apiBaseUrl.replace(/\/$/, "")}/v1/crypto/public-key`
    )
    if (!res.ok) return null
    const body = (await res.json()) as { public_key_spki_base64?: string }
    return body.public_key_spki_base64 || null
  } catch {
    return null
  }
}

export async function verifyRulesPack(input: {
  rules: unknown
  checksum: string
  signature?: string
  publicKeySpkiBase64: string | null
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const localChecksum = await computeRulesChecksum(input.rules)
  if (localChecksum !== input.checksum) {
    return { ok: false, error: "checksum_mismatch" }
  }

  const sig = input.signature || ""
  if (sig.startsWith("dev-unsigned:")) {
    // Accepté uniquement pour packs legacy — log
    console.warn("[OpsGate] Pack signed with dev-unsigned (legacy)")
    return { ok: true }
  }

  if (!sig.startsWith("ed25519:")) {
    return { ok: false, error: "unknown_signature_format" }
  }

  if (!input.publicKeySpkiBase64) {
    return { ok: false, error: "missing_public_key" }
  }

  try {
    const key = await crypto.subtle.importKey(
      "spki",
      b64ToBytes(input.publicKeySpkiBase64),
      { name: "Ed25519" },
      false,
      ["verify"]
    )
    const sigBytes = b64urlToBytes(sig.slice("ed25519:".length))
    const data = new TextEncoder().encode(input.checksum)
    const ok = await crypto.subtle.verify(
      { name: "Ed25519" },
      key,
      // @ts-expect-error BufferSource
      sigBytes,
      data
    )
    if (!ok) return { ok: false, error: "signature_invalid" }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: `verify_failed:${String(e)}` }
  }
}
