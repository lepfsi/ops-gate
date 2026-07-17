/**
 * SAML 2.0 SP foundations — metadata + ACS (assertion consumer).
 * Validation XML minimale (signature optionnelle en v1 : relay sur HTTPS IdP + cert PEM).
 * Sans dépendance lourde (parse regex/DOM-light).
 */
import { createVerify, randomBytes } from "node:crypto"
import { deflateRawSync } from "node:zlib"

export type SamlConfig = {
  enabled: boolean
  /** Entity ID du SP (OpsGate) */
  entityId: string
  /** ACS URL (POST) */
  acsUrl: string
  /** IdP SSO redirect URL */
  idpSsoUrl: string
  /** IdP Entity ID */
  idpEntityId: string
  /** Certificat IdP PEM (X509) pour vérif signature assertion */
  idpCertPem?: string
  /** Attribut email (défaut NameID ou email claim) */
  emailAttribute?: string
}

export function getSamlConfig(
  env: NodeJS.ProcessEnv = process.env
): SamlConfig | null {
  const idpSso = env.OPSGATE_SAML_IDP_SSO_URL?.trim()
  const idpEntity = env.OPSGATE_SAML_IDP_ENTITY_ID?.trim()
  if (!idpSso || !idpEntity) return null
  const api =
    env.OPSGATE_API_PUBLIC_URL?.trim() ||
    env.OPSGATE_PUBLIC_URL?.trim() ||
    `http://127.0.0.1:${env.PORT || 8787}`
  const base = api.replace(/\/$/, "")
  return {
    enabled: true,
    entityId:
      env.OPSGATE_SAML_SP_ENTITY_ID?.trim() || `${base}/v1/auth/saml/metadata`,
    acsUrl: env.OPSGATE_SAML_ACS_URL?.trim() || `${base}/v1/auth/saml/acs`,
    idpSsoUrl: idpSso,
    idpEntityId: idpEntity,
    idpCertPem: env.OPSGATE_SAML_IDP_CERT?.replace(/\\n/g, "\n"),
    emailAttribute: env.OPSGATE_SAML_EMAIL_ATTR?.trim() || "email"
  }
}

export function samlSpMetadataXml(cfg: SamlConfig): string {
  const entityId = escapeXml(cfg.entityId)
  const acs = escapeXml(cfg.acsUrl)
  return `<?xml version="1.0" encoding="UTF-8"?>
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${entityId}">
  <md:SPSSODescriptor AuthnRequestsSigned="false" WantAssertionsSigned="true"
      protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <md:NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress</md:NameIDFormat>
    <md:AssertionConsumerService
        Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"
        Location="${acs}"
        index="0"
        isDefault="true"/>
  </md:SPSSODescriptor>
</md:EntityDescriptor>
`
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function b64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
}

/** AuthnRequest minimal (redirect binding, deflate+base64) */
export function buildSamlAuthnRequest(cfg: SamlConfig): {
  redirectUrl: string
  id: string
} {
  const id = `_${randomBytes(16).toString("hex")}`
  const issueInstant = new Date().toISOString()
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"
    xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"
    ID="${id}"
    Version="2.0"
    IssueInstant="${issueInstant}"
    Destination="${escapeXml(cfg.idpSsoUrl)}"
    AssertionConsumerServiceURL="${escapeXml(cfg.acsUrl)}"
    ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST">
  <saml:Issuer>${escapeXml(cfg.entityId)}</saml:Issuer>
  <samlp:NameIDPolicy Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress" AllowCreate="true"/>
</samlp:AuthnRequest>`
  // HTTP-Redirect : DEFLATE raw then base64
  const deflated = deflateRawSync(Buffer.from(xml, "utf8"))
  const SAMLRequest = deflated.toString("base64")
  const u = new URL(cfg.idpSsoUrl)
  u.searchParams.set("SAMLRequest", SAMLRequest)
  u.searchParams.set("RelayState", b64url(Buffer.from(id)))
  return { redirectUrl: u.toString(), id }
}

export type SamlParseResult =
  | { ok: true; email: string; nameId: string; attributes: Record<string, string> }
  | { ok: false; error: string }

/** Parse Response base64 (POST ACS) — extraction NameID + AttributeStatement */
export function parseSamlResponse(
  b64: string,
  cfg: SamlConfig
): SamlParseResult {
  let xml: string
  try {
    xml = Buffer.from(b64, "base64").toString("utf8")
  } catch {
    return { ok: false, error: "saml_b64" }
  }
  if (!/saml(p)?:Response/i.test(xml) && !/<Response[\s>]/i.test(xml)) {
    return { ok: false, error: "saml_not_response" }
  }
  // Status success
  if (/StatusCode[^>]+Value="[^"]*Requester"/i.test(xml)) {
    return { ok: false, error: "saml_status_requester" }
  }
  if (
    !/StatusCode[^>]+Value="[^"]*Success"/i.test(xml) &&
    !/StatusCode\s+Value="urn:oasis:names:tc:SAML:2.0:status:Success"/i.test(
      xml
    )
  ) {
    // some IdP omit full path — soft warn
    if (!/Success/i.test(xml)) {
      return { ok: false, error: "saml_status_not_success" }
    }
  }
  // Signature IdP : obligatoire en prod (ou OPSGATE_SAML_REQUIRE_SIGNATURE=1)
  // si un certificat est fourni. Soft en lab sans cert.
  const requireSig =
    process.env.OPSGATE_SAML_REQUIRE_SIGNATURE === "1" ||
    process.env.OPSGATE_SAML_REQUIRE_SIGNATURE === "true" ||
    (process.env.NODE_ENV === "production" && !!cfg.idpCertPem)
  if (cfg.idpCertPem) {
    const sigOk = verifyXmlSignatureSoft(xml, cfg.idpCertPem)
    if (sigOk === false) {
      return { ok: false, error: "saml_sig_invalid" }
    }
    if (requireSig && sigOk == null) {
      return { ok: false, error: "saml_sig_required" }
    }
  } else if (requireSig) {
    return { ok: false, error: "saml_idp_cert_required" }
  }
  const nameId =
    xml.match(/<saml:NameID[^>]*>([^<]+)<\/saml:NameID>/i)?.[1] ||
    xml.match(/<NameID[^>]*>([^<]+)<\/NameID>/i)?.[1] ||
    ""
  const attributes: Record<string, string> = {}
  const attrRe =
    /<(?:saml:)?Attribute\s+Name="([^"]+)"[^>]*>[\s\S]*?<(?:saml:)?AttributeValue[^>]*>([^<]*)<\/(?:saml:)?AttributeValue>/gi
  let m: RegExpExecArray | null
  while ((m = attrRe.exec(xml)) !== null) {
    attributes[m[1]!] = m[2]!.trim()
  }
  const emailAttr = cfg.emailAttribute || "email"
  let email =
    attributes[emailAttr] ||
    attributes["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"] ||
    attributes["mail"] ||
    attributes["emailAddress"] ||
    ""
  if (!email && nameId.includes("@")) email = nameId
  email = email.trim().toLowerCase()
  if (!email.includes("@")) {
    return { ok: false, error: "saml_email_missing" }
  }
  return { ok: true, email, nameId: nameId || email, attributes }
}

/**
 * Signature check over SignedInfo.
 * Tries exclusive C14N (with InclusiveNamespaces PrefixList) then raw SignedInfo.
 * Returns null if no signature block; false if verify fails; true if ok.
 */
function verifyXmlSignatureSoft(
  xml: string,
  certPem: string
): boolean | null {
  const sigVal = xml.match(
    /<(?:ds:)?SignatureValue[^>]*>([^<]+)<\/(?:ds:)?SignatureValue>/i
  )?.[1]
  const signedInfo = xml.match(
    /(<(?:ds:)?SignedInfo[\s\S]*?<\/(?:ds:)?SignedInfo>)/i
  )?.[1]
  if (!sigVal || !signedInfo) return null
  const sig = Buffer.from(sigVal.replace(/\s+/g, ""), "base64")
  const candidates = [
    exclusiveC14nSignedInfo(signedInfo, xml),
    stripXmlnsNoise(signedInfo),
    signedInfo
  ]
  const algos = ["RSA-SHA256", "RSA-SHA1", "sha256", "sha1"] as const
  for (const payload of candidates) {
    if (!payload) continue
    for (const algo of algos) {
      try {
        const verifier = createVerify(algo)
        verifier.update(payload)
        verifier.end()
        if (verifier.verify(certPem, sig)) return true
      } catch {
        /* try next */
      }
    }
  }
  return false
}

/**
 * Exclusive C14N (approximation) for SignedInfo — covers common IdP layouts.
 * - Collect InclusiveNamespaces PrefixList from CanonicalizationMethod
 * - Declare needed xmlns on SignedInfo root
 * - Sort attributes, collapse whitespace between tags
 */
function exclusiveC14nSignedInfo(signedInfo: string, fullXml: string): string {
  try {
    const prefixList =
      signedInfo.match(
        /InclusiveNamespaces[^>]*PrefixList="([^"]*)"/i
      )?.[1] ||
      fullXml.match(
        /InclusiveNamespaces[^>]*PrefixList="([^"]*)"/i
      )?.[1] ||
      ""
    const prefixes = prefixList
      .split(/\s+/)
      .map((p) => p.trim())
      .filter(Boolean)

    // Map prefix → namespace URI from full document (and SignedInfo)
    const nsMap = new Map<string, string>()
    const nsRe = /xmlns:([A-Za-z_][\w.-]*)\s*=\s*"([^"]+)"/g
    let m: RegExpExecArray | null
    const search = fullXml + "\n" + signedInfo
    while ((m = nsRe.exec(search)) !== null) {
      if (!nsMap.has(m[1]!)) nsMap.set(m[1]!, m[2]!)
    }
    // default ds namespace often present
    if (!nsMap.has("ds")) {
      nsMap.set("ds", "http://www.w3.org/2000/09/xmldsig#")
    }
    if (!nsMap.has("saml") && /saml:/i.test(signedInfo)) {
      nsMap.set("saml", "urn:oasis:names:tc:SAML:2.0:assertion")
    }
    if (!nsMap.has("samlp") && /samlp:/i.test(signedInfo)) {
      nsMap.set("samlp", "urn:oasis:names:tc:SAML:2.0:protocol")
    }

    // Strip existing xmlns from SignedInfo (re-inject exclusive set)
    let body = signedInfo
      .replace(/\s+xmlns(?::[A-Za-z_][\w.-]*)?="[^"]*"/g, "")
      .replace(/>\s+</g, "><")
      .trim()

    // Build xmlns attrs (lexicographic by attribute name for C14N)
    const xmlnsAttrs: string[] = []
    // default xmlns if element uses unprefixed ds-like names rarely
    for (const p of prefixes.length ? prefixes : collectUsedPrefixes(body)) {
      const uri = nsMap.get(p)
      if (uri) xmlnsAttrs.push(`xmlns:${p}="${uri}"`)
    }
    // Always ensure ds is present on SignedInfo
    if (!xmlnsAttrs.some((a) => a.startsWith("xmlns:ds=")) && nsMap.has("ds")) {
      xmlnsAttrs.push(`xmlns:ds="${nsMap.get("ds")}"`)
    }
    xmlnsAttrs.sort()

    body = body.replace(
      /^<((?:ds:)?SignedInfo)(\s|>)/,
      (_, name: string, end: string) => {
        const attrs = xmlnsAttrs.length ? " " + xmlnsAttrs.join(" ") : ""
        return end === ">"
          ? `<${name}${attrs}>`
          : `<${name}${attrs} `
      }
    )
    // Sort attributes on each start-tag (simple pairs)
    body = body.replace(/<([A-Za-z_][\w:.-]*)([^>]*)>/g, (all, name, attrs) => {
      if (!attrs || !String(attrs).trim()) return all
      if (String(attrs).endsWith("/")) {
        // self-closing
        const inner = String(attrs).slice(0, -1).trim()
        const sorted = sortXmlAttributes(inner)
        return `<${name}${sorted ? " " + sorted : ""}/>`
      }
      const sorted = sortXmlAttributes(String(attrs).trim())
      return `<${name}${sorted ? " " + sorted : ""}>`
    })
    return body
  } catch {
    return signedInfo
  }
}

function collectUsedPrefixes(xml: string): string[] {
  const set = new Set<string>()
  const re = /\b([A-Za-z_][\w.-]*):[A-Za-z_]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) {
    if (m[1] !== "xmlns") set.add(m[1]!)
  }
  return [...set]
}

function sortXmlAttributes(attrStr: string): string {
  if (!attrStr.trim()) return ""
  const attrs: string[] = []
  const re = /([A-Za-z_][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g
  let m: RegExpExecArray | null
  while ((m = re.exec(attrStr)) !== null) {
    const val = m[3] !== undefined ? m[3] : m[4]
    attrs.push(`${m[1]}="${val}"`)
  }
  attrs.sort((a, b) => {
    // C14N: namespace decls first (xmlns), then other attrs by name
    const an = a.split("=")[0]!
    const bn = b.split("=")[0]!
    const aNs = an === "xmlns" || an.startsWith("xmlns:")
    const bNs = bn === "xmlns" || bn.startsWith("xmlns:")
    if (aNs !== bNs) return aNs ? -1 : 1
    return an < bn ? -1 : an > bn ? 1 : 0
  })
  return attrs.join(" ")
}

function stripXmlnsNoise(xml: string): string {
  return xml.replace(/>\s+</g, "><").trim()
}

export function samlStatusPayload(cfg: SamlConfig | null) {
  if (!cfg) {
    return {
      enabled: false,
      note: "Set OPSGATE_SAML_IDP_SSO_URL + OPSGATE_SAML_IDP_ENTITY_ID"
    }
  }
  return {
    enabled: true,
    entity_id: cfg.entityId,
    acs_url: cfg.acsUrl,
    idp_sso_url: cfg.idpSsoUrl,
    idp_entity_id: cfg.idpEntityId,
    metadata_path: "/v1/auth/saml/metadata",
    start_path: "/v1/auth/saml/start",
    cert_configured: !!cfg.idpCertPem
  }
}
