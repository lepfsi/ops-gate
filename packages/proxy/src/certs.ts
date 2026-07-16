/**
 * CA locale + certificats dynamiques par host (MITM allowlist — P1).
 * Stockage : <dataRoot>/ca/ (dev monorepo ou ProgramData en install MSI).
 */
import * as fs from "node:fs"
import * as path from "node:path"
import forge from "node-forge"
import { ensureProxyDataDirs, resolveProxyDataRoot } from "./paths.js"

export const DATA_DIR = path.join(resolveProxyDataRoot(), "ca")
export const CA_KEY_PATH = path.join(DATA_DIR, "ca-key.pem")
export const CA_CERT_PATH = path.join(DATA_DIR, "ca-cert.pem")

// Crée le dossier ca au premier import utile
ensureProxyDataDirs()

export type PemPair = { key: string; cert: string }

const hostCache = new Map<string, PemPair>()

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true })
}

export function caExists(): boolean {
  return fs.existsSync(CA_KEY_PATH) && fs.existsSync(CA_CERT_PATH)
}

export function loadCa(): PemPair {
  if (!caExists()) {
    throw new Error(
      "CA locale absente. Lancez : pnpm --filter @opsgate/proxy gen-ca"
    )
  }
  return {
    key: fs.readFileSync(CA_KEY_PATH, "utf8"),
    cert: fs.readFileSync(CA_CERT_PATH, "utf8")
  }
}

/** Génère une CA de développement (à installer dans le trust store utilisateur). */
export function generateCa(opts?: { force?: boolean }): PemPair {
  ensureDir(DATA_DIR)
  if (caExists() && !opts?.force) {
    return loadCa()
  }

  const keys = forge.pki.rsa.generateKeyPair(2048)
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = "01"
  cert.validity.notBefore = new Date()
  cert.validity.notAfter = new Date()
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 5)

  const attrs = [
    { name: "commonName", value: "OpsGate Local Dev CA" },
    { name: "organizationName", value: "OpsGate Dev" },
    { name: "countryName", value: "FR" }
  ]
  cert.setSubject(attrs)
  cert.setIssuer(attrs)
  cert.setExtensions([
    { name: "basicConstraints", cA: true, critical: true },
    {
      name: "keyUsage",
      keyCertSign: true,
      cRLSign: true,
      critical: true
    },
    {
      name: "subjectKeyIdentifier"
    }
  ])
  cert.sign(keys.privateKey, forge.md.sha256.create())

  const pair: PemPair = {
    key: forge.pki.privateKeyToPem(keys.privateKey),
    cert: forge.pki.certificateToPem(cert)
  }
  fs.writeFileSync(CA_KEY_PATH, pair.key, { mode: 0o600 })
  fs.writeFileSync(CA_CERT_PATH, pair.cert, { mode: 0o644 })
  // README d’install à côté
  fs.writeFileSync(
    path.join(DATA_DIR, "README.txt"),
    `OpsGate Local Dev CA (P1)
========================
Installer le certificat utilisateur (Windows) :

  certutil -addstore -user Root "${CA_CERT_PATH}"

Retirer :

  certutil -delstore -user Root "OpsGate Local Dev CA"

NE PAS utiliser cette CA en production. NE PAS committer ca-key.pem.
`,
    "utf8"
  )
  return pair
}

/** Cert leaf pour un hostname, signé par la CA locale. */
export function getHostCert(hostname: string): PemPair {
  const host = hostname.toLowerCase()
  const cached = hostCache.get(host)
  if (cached) return cached

  const ca = loadCa()
  const caKey = forge.pki.privateKeyFromPem(ca.key)
  const caCert = forge.pki.certificateFromPem(ca.cert)

  const keys = forge.pki.rsa.generateKeyPair(2048)
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = String(Date.now())
  cert.validity.notBefore = new Date()
  cert.validity.notAfter = new Date()
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1)

  const attrs = [
    { name: "commonName", value: host },
    { name: "organizationName", value: "OpsGate MITM Dev" }
  ]
  cert.setSubject(attrs)
  cert.setIssuer(caCert.subject.attributes)
  cert.setExtensions([
    { name: "basicConstraints", cA: false },
    {
      name: "keyUsage",
      digitalSignature: true,
      keyEncipherment: true
    },
    {
      name: "extKeyUsage",
      serverAuth: true
    },
    {
      name: "subjectAltName",
      altNames: [
        { type: 2, value: host }, // dNSName
        ...(host.startsWith("www.")
          ? []
          : [{ type: 2, value: "www." + host }])
      ]
    }
  ])
  cert.sign(caKey, forge.md.sha256.create())

  const pair: PemPair = {
    key: forge.pki.privateKeyToPem(keys.privateKey),
    cert: forge.pki.certificateToPem(cert)
  }
  hostCache.set(host, pair)
  return pair
}

export function caInstallHint(): string {
  return `Windows (utilisateur courant) :
  certutil -addstore -user Root "${CA_CERT_PATH}"

Puis redémarrer le navigateur. Vérifier : chrome://settings → certificats.
`
}
