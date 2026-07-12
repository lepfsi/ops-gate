import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify
} from "node:crypto"

const __dirname = dirname(fileURLToPath(import.meta.url))
const KEYS_DIR = join(__dirname, "..", "keys")
const PRIV_PATH = join(KEYS_DIR, "ed25519-private.pem")
const PUB_PATH = join(KEYS_DIR, "ed25519-public.pem")

export type SignMode = "ed25519" | "dev-unsigned"

function ensureKeys(): { privatePem: string; publicPem: string } {
  if (!existsSync(KEYS_DIR)) mkdirSync(KEYS_DIR, { recursive: true })

  if (!existsSync(PRIV_PATH) || !existsSync(PUB_PATH)) {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519")
    const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString()
    const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString()
    writeFileSync(PRIV_PATH, privatePem, "utf8")
    writeFileSync(PUB_PATH, publicPem, "utf8")
    console.log("[signing] Generated ed25519 keypair in packages/api/keys/")
    return { privatePem, publicPem }
  }

  return {
    privatePem: readFileSync(PRIV_PATH, "utf8"),
    publicPem: readFileSync(PUB_PATH, "utf8")
  }
}

let cached: { privatePem: string; publicPem: string } | null = null

function keys() {
  if (!cached) cached = ensureKeys()
  return cached
}

/** Payload signé = checksum SHA-256 hex des rules (canonique côté API). */
export function signPackChecksum(checksum: string): string {
  const { privatePem } = keys()
  const key = createPrivateKey(privatePem)
  const sig = sign(null, Buffer.from(checksum, "utf8"), key)
  return `ed25519:${sig.toString("base64url")}`
}

export function verifyPackChecksum(
  checksum: string,
  signature: string
): boolean {
  if (signature.startsWith("dev-unsigned:")) {
    return process.env.ALLOW_DEV_UNSIGNED === "1"
  }
  if (!signature.startsWith("ed25519:")) return false
  try {
    const { publicPem } = keys()
    const key = createPublicKey(publicPem)
    const sig = Buffer.from(signature.slice("ed25519:".length), "base64url")
    return verify(null, Buffer.from(checksum, "utf8"), key, sig)
  } catch {
    return false
  }
}

export function getPublicKeyPem(): string {
  return keys().publicPem
}

/** Export SPKI base64 (sans headers) pour l’agent navigateur */
export function getPublicKeySpkiBase64(): string {
  const { publicPem } = keys()
  const key = createPublicKey(publicPem)
  const der = key.export({ type: "spki", format: "der" }) as Buffer
  return der.toString("base64")
}
