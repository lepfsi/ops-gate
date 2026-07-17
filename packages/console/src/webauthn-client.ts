/**
 * Helpers navigateur WebAuthn / passkeys (Windows Hello, empreinte, Face ID…).
 */

function b64urlToBuf(s: string): ArrayBuffer {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/")
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4))
  const bin = atob(b64 + pad)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out.buffer
}

function bufToB64url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let bin = ""
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!)
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

export function webauthnSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    !!window.PublicKeyCredential &&
    typeof navigator.credentials?.create === "function"
  )
}

/** Convertit options API (base64url strings) → PublicKeyCredentialCreationOptions */
export function toCreationOptions(
  publicKey: Record<string, unknown>
): PublicKeyCredentialCreationOptions {
  const pk = { ...publicKey } as Record<string, unknown>
  const challenge = String(pk.challenge || "")
  const user = { ...(pk.user as Record<string, unknown>) }
  const exclude = Array.isArray(pk.excludeCredentials)
    ? (pk.excludeCredentials as Array<Record<string, unknown>>)
    : []
  return {
    ...pk,
    challenge: b64urlToBuf(challenge),
    user: {
      ...user,
      id: b64urlToBuf(String(user.id || "")),
      name: String(user.name || ""),
      displayName: String(user.displayName || user.name || "")
    },
    excludeCredentials: exclude.map((c) => ({
      type: "public-key" as const,
      id: b64urlToBuf(String(c.id || "")),
      transports: c.transports as AuthenticatorTransport[] | undefined
    })),
    pubKeyCredParams: (pk.pubKeyCredParams || [
      { type: "public-key", alg: -7 }
    ]) as PublicKeyCredentialParameters[],
    rp: pk.rp as PublicKeyCredentialRpEntity,
    timeout: typeof pk.timeout === "number" ? pk.timeout : 60000,
    attestation: (pk.attestation as AttestationConveyancePreference) || "none",
    authenticatorSelection:
      pk.authenticatorSelection as AuthenticatorSelectionCriteria | undefined
  }
}

export function toRequestOptions(
  publicKey: Record<string, unknown>
): PublicKeyCredentialRequestOptions {
  const pk = { ...publicKey } as Record<string, unknown>
  const allow = Array.isArray(pk.allowCredentials)
    ? (pk.allowCredentials as Array<Record<string, unknown>>)
    : undefined
  return {
    challenge: b64urlToBuf(String(pk.challenge || "")),
    timeout: typeof pk.timeout === "number" ? pk.timeout : 60000,
    rpId: typeof pk.rpId === "string" ? pk.rpId : undefined,
    userVerification:
      (pk.userVerification as UserVerificationRequirement) || "preferred",
    allowCredentials: allow?.length
      ? allow.map((c) => ({
          type: "public-key" as const,
          id: b64urlToBuf(String(c.id || ""))
        }))
      : undefined
  }
}

/** Extrait JWK public d’une attestation (subset ES256 / RS256) */
export async function credentialPublicKeyJwk(
  credential: PublicKeyCredential
): Promise<Record<string, unknown> | null> {
  try {
    const att = credential.response as AuthenticatorAttestationResponse
    // getPublicKey() si dispo (Chrome récent)
    const getPk = (
      att as AuthenticatorAttestationResponse & {
        getPublicKey?: () => ArrayBuffer | null
      }
    ).getPublicKey
    if (typeof getPk === "function") {
      const spki = getPk.call(att)
      if (spki) {
        const key = await crypto.subtle.importKey(
          "spki",
          spki,
          { name: "ECDSA", namedCurve: "P-256" },
          true,
          ["verify"]
        )
        const jwk = await crypto.subtle.exportKey("jwk", key)
        return jwk as Record<string, unknown>
      }
    }
  } catch {
    /* try RSA or fail */
  }
  try {
    const att = credential.response as AuthenticatorAttestationResponse
    const getPk = (
      att as AuthenticatorAttestationResponse & {
        getPublicKey?: () => ArrayBuffer | null
      }
    ).getPublicKey
    if (typeof getPk === "function") {
      const spki = getPk.call(att)
      if (spki) {
        const key = await crypto.subtle.importKey(
          "spki",
          spki,
          { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
          true,
          ["verify"]
        )
        return (await crypto.subtle.exportKey("jwk", key)) as Record<
          string,
          unknown
        >
      }
    }
  } catch {
    /* ignore */
  }
  return null
}

export function assertionToBody(
  challengeId: string,
  credential: PublicKeyCredential
) {
  const resp = credential.response as AuthenticatorAssertionResponse
  return {
    challenge_id: challengeId,
    credentialId: bufToB64url(credential.rawId),
    clientDataJSON: bufToB64url(resp.clientDataJSON),
    authenticatorData: bufToB64url(resp.authenticatorData),
    signature: bufToB64url(resp.signature)
  }
}

export { bufToB64url }
