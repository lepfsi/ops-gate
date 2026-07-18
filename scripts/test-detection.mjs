/**
 * Tests de non-régression du moteur de règles OpsGate.
 * Usage: node scripts/test-detection.mjs
 *
 * Note: rejoue la logique critique (pas un import TS) pour rester sans toolchain.
 * Les cas doivent rester alignés avec src/lib/rules-engine.ts.
 */
import { readFileSync } from "fs"
import { dirname, join } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const rules = JSON.parse(
  readFileSync(
    join(__dirname, "..", "packages", "engine", "rules", "rules.json"),
    "utf8"
  )
)

function isValidLuhn(num) {
  const digits = num.replace(/\D/g, "")
  if (digits.length < 13 || digits.length > 19) return false
  if (/^(\d)\1+$/.test(digits)) return false
  let sum = 0
  let alt = false
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = parseInt(digits[i], 10)
    if (alt) {
      n *= 2
      if (n > 9) n -= 9
    }
    sum += n
    alt = !alt
  }
  return sum % 10 === 0
}

function isValidIban(raw) {
  const iban = raw.replace(/[\s.\-]/g, "").toUpperCase()
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false
  if (iban.length < 15 || iban.length > 34) return false
  const rearranged = iban.slice(4) + iban.slice(0, 4)
  let expanded = ""
  for (const ch of rearranged) {
    expanded +=
      ch >= "A" && ch <= "Z" ? String(ch.charCodeAt(0) - 55) : ch
  }
  let remainder = 0
  for (let i = 0; i < expanded.length; i += 7) {
    remainder = Number(String(remainder) + expanded.slice(i, i + 7)) % 97
  }
  return remainder === 1
}

function detect(text) {
  const hits = []
  for (const rule of rules) {
    const keywordRequired = [
      "ip-private-block",
      "license-key",
      // iban: checksum only (no keyword)
      "aws-secret-key",
      "huawei-vrp-config",
      "mikrotik-routeros",
      "palo-alto-config",
      "pfsense-opnsense",
      "wireguard-openvpn",
      "arista-eos",
      "azure-secrets",
      "gcp-service-account"
    ]
    if (keywordRequired.includes(rule.id) && rule.keywords?.length) {
      const lower = text.toLowerCase()
      if (!rule.keywords.some((k) => lower.includes(k.toLowerCase()))) continue
    }

    for (const pattern of rule.patterns) {
      try {
        const hasI = pattern.startsWith("(?i)")
        const src = hasI ? pattern.slice(4) : pattern
        const re = new RegExp(src, hasI ? "gi" : "g")
        let m
        while ((m = re.exec(text)) !== null) {
          const raw = m[0]
          if (rule.id === "credit-card" && !isValidLuhn(raw)) continue
          if (rule.id === "iban" && !isValidIban(raw)) continue
          if (
            rule.id === "password-assignment" &&
            /password\s*[=:]\s*(password|123456|changeme|test)\b/i.test(raw)
          )
            continue
          if (
            rule.id === "email-address" &&
            /@example\.(com|org|net)/i.test(raw)
          )
            continue
          hits.push(rule.id)
          break
        }
      } catch {
        // ignore
      }
    }
  }
  return [...new Set(hits)]
}

/** @type {{ name: string, text: string, expect: string[], reject?: string[] }[]} */
const cases = [
  {
    name: "OpenAI-like key",
    text: "key sk-abcdefghijklmnopqrstuvwxyz123456",
    expect: ["generic-api-key"]
  },
  {
    name: "AWS AKIA",
    text: "AKIAIOSFODNN7EXAMPLE",
    expect: ["aws-access-key"]
  },
  {
    name: "Password real",
    text: "password=SuperSecret99!",
    expect: ["password-assignment"]
  },
  {
    name: "Password placeholder (FP)",
    text: "password=password",
    expect: [],
    reject: ["password-assignment"]
  },
  {
    name: "Fortinet config",
    text: 'config system interface\nedit "port1"\nset ip 10.0.0.1',
    expect: ["fortinet-config"]
  },
  {
    name: "Cisco enable secret",
    text: "enable secret 5 $1$abcd$hash",
    expect: ["cisco-config"]
  },
  {
    name: "Normal chat",
    text: "Bonjour, peux-tu m'expliquer le VLAN trunking ?",
    expect: []
  },
  {
    name: "Email example.com ignored",
    text: "Contact user@example.com for info",
    expect: [],
    reject: ["email-address"]
  },
  {
    name: "Valid FR IBAN with context",
    text: "Mon IBAN est FR1420041010050500013M02606",
    expect: ["iban"]
  },
  {
    name: "Valid FR IBAN without keyword",
    text: "Virement vers FR1420041010050500013M02606 demain",
    expect: ["iban"]
  },
  {
    name: "Valid FR IBAN spaced",
    text: "FR76 3000 6000 0112 3456 7890 189",
    expect: ["iban"]
  },
  {
    name: "Random alnum not IBAN",
    text: "Code ref AB1234567890123456789012",
    expect: [],
    reject: ["iban"]
  },
  {
    name: "Private key block",
    text: "-----BEGIN RSA PRIVATE KEY-----\nMIIE...",
    expect: ["private-key"]
  },
  {
    name: "Connection string",
    text: "postgres://admin:p@ss@db.internal:5432/app",
    expect: ["connection-string"]
  },
  {
    name: "Huawei VRP",
    text: "huawei system-view\ninterface GigabitEthernet 0/0/1\nip address 10.1.1.1 255.255.255.0",
    expect: ["huawei-vrp-config"]
  },
  {
    name: "MikroTik RouterOS",
    text: "mikrotik /ip address add address=192.168.88.1/24 interface=bridge",
    expect: ["mikrotik-routeros"]
  },
  {
    name: "Palo Alto",
    text: "palo alto set deviceconfig system hostname fw01",
    expect: ["palo-alto-config"]
  },
  {
    name: "WireGuard private key",
    text: "wireguard [Interface]\nPrivateKey = aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789abcd=\nAddress = 10.0.0.2/32",
    expect: ["wireguard-openvpn"]
  },
  {
    name: "Stripe live key",
    // Construit en parties pour éviter le secret-scanning GitHub (pas une vraie clé)
    text: ["sk", "live", "DEMOONLYPLACEHOLDERNOTREAL000000"].join("_"),
    expect: ["stripe-keys"]
  },
  {
    name: "GCP service account json snippet",
    text: 'gcp {"type": "service_account", "private_key_id": "abc123def456", "private_key": "-----BEGIN',
    expect: ["gcp-service-account"]
  },
  {
    name: "JWT token",
    text: "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
    expect: ["jwt-token"]
  },
  {
    name: "Anthropic-like key",
    text: "Use sk-ant-api03-" + "x".repeat(40),
    expect: ["openai-anthropic-keys"]
  },
  {
    name: "HuggingFace token",
    text: "token hf_" + "a".repeat(30),
    expect: ["openai-anthropic-keys"]
  },
  {
    name: "GitLab PAT",
    text: "glpat-" + "A".repeat(24),
    expect: ["gitlab-discord-tokens"]
  },
  {
    name: "DATABASE_URL in prompt",
    text: "DATABASE_URL=postgres://user:secret@db:5432/app",
    expect: ["dotenv-secrets"]
  }
]

let failed = 0
for (const c of cases) {
  const hits = detect(c.text)
  const missing = (c.expect || []).filter((id) => !hits.includes(id))
  const unwanted = (c.reject || []).filter((id) => hits.includes(id))
  const extraExpectFail = missing.length > 0 || unwanted.length > 0

  // For expect=[], any high-noise hit is failure only if listed in reject or if expect empty and hits non-empty for pure negatives
  const pureNegativeFail =
    (c.expect || []).length === 0 &&
    !(c.reject || []).length &&
    hits.length > 0

  if (extraExpectFail || pureNegativeFail) {
    failed++
    console.log(`FAIL  ${c.name}`)
    console.log(`      hits=${JSON.stringify(hits)}`)
    if (missing.length) console.log(`      missing=${JSON.stringify(missing)}`)
    if (unwanted.length) console.log(`      unwanted=${JSON.stringify(unwanted)}`)
  } else {
    console.log(`OK    ${c.name}`)
  }
}

console.log("")
if (failed) {
  console.log(`${failed} test(s) failed`)
  process.exit(1)
}
console.log(`All ${cases.length} tests passed`)

