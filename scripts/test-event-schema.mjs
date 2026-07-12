/**
 * Garantit qu'on n'accepte pas de prompts bruts dans /v1/events/batch
 * Nécessite API up : pnpm api:dev
 */
const BASE = process.env.OPSGATE_API || "http://127.0.0.1:8787"

async function main() {
  const health = await fetch(`${BASE}/health`)
  if (!health.ok) {
    console.error("API offline — skip or start pnpm api:dev")
    process.exit(1)
  }

  const en = await fetch(`${BASE}/v1/enroll`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      org_code: "DEMO-OPSGATE",
      device_label: "schema-test"
    })
  }).then((r) => r.json())

  const token = en.agent_token
  if (!token) throw new Error("enroll failed")

  const forbidden = ["prompt", "text", "content", "file_content"]
  let failed = 0

  for (const field of forbidden) {
    const res = await fetch(`${BASE}/v1/events/batch`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        events: [
          {
            schema_version: 1,
            client_event_id: `forbid-${field}-${Date.now()}`,
            ts: new Date().toISOString(),
            source: "prompt",
            hostname: "chatgpt.com",
            decision: "cancel",
            detection_count: 1,
            highest_severity: "high",
            rule_ids: ["x"],
            types: ["x"],
            [field]: "SECRET SHOULD NEVER BE STORED"
          }
        ]
      })
    })
    const body = await res.json()
    // accepted may be 0 with rejected entries
    const rejected = body.rejected || []
    const okReject =
      res.ok &&
      body.accepted === 0 &&
      rejected.some((r) => String(r.reason).includes("forbidden_field"))
    if (okReject) {
      console.log(`OK    reject field ${field}`)
    } else {
      failed++
      console.log(`FAIL  field ${field}`, body)
    }
  }

  // valid metadata-only must pass
  const good = await fetch(`${BASE}/v1/events/batch`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      events: [
        {
          schema_version: 1,
          client_event_id: `ok-${Date.now()}`,
          ts: new Date().toISOString(),
          source: "prompt",
          hostname: "chatgpt.com",
          decision: "mask_send",
          detection_count: 1,
          highest_severity: "high",
          rule_ids: ["generic-api-key"],
          types: ["API Key / Token"],
          masked: true
        }
      ]
    })
  }).then((r) => r.json())

  if (good.accepted >= 1) console.log("OK    metadata event accepted")
  else {
    failed++
    console.log("FAIL  metadata event", good)
  }

  // public key endpoint
  const pk = await fetch(`${BASE}/v1/crypto/public-key`).then((r) => r.json())
  if (pk.public_key_spki_base64) console.log("OK    public key endpoint")
  else {
    failed++
    console.log("FAIL  public key", pk)
  }

  if (failed) {
    console.log(`\n${failed} failed`)
    process.exit(1)
  }
  console.log("\nEvent schema + crypto checks passed")
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
