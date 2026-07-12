/**
 * Smoke test API PR1+PR2
 * Usage: pnpm api:dev  puis  pnpm api:smoke
 */
const BASE = process.env.OPSGATE_API || "http://127.0.0.1:8787"
const ADMIN = { "X-OpsGate-Dev-Admin": "demo" }

async function req(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      "content-type": "application/json",
      ...(opts.headers || {})
    }
  })
  const text = await res.text()
  let body
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  return { status: res.status, headers: res.headers, body }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

let failed = 0
function ok(name) {
  console.log(`OK    ${name}`)
}
function fail(name, err) {
  failed++
  console.log(`FAIL  ${name}: ${err.message || err}`)
}

async function main() {
  console.log(`Smoke API → ${BASE}\n`)

  try {
    const h = await req("/health")
    assert(h.status === 200 && h.body?.ok === true, `health ${h.status}`)
    ok(`GET /health (store=${h.body?.store || "?"})`)
  } catch (e) {
    fail("GET /health", e)
    console.log("\nIs the API running?  pnpm api:dev")
    process.exit(1)
  }

  let token
  let agentId
  try {
    const en = await req("/v1/enroll", {
      method: "POST",
      body: JSON.stringify({
        org_code: "DEMO-OPSGATE",
        device_label: "smoke-test",
        app_version: "0.3.0-smoke"
      })
    })
    assert(en.status === 200, `enroll status ${en.status}`)
    assert(en.body?.agent_token, "no agent_token")
    token = en.body.agent_token
    agentId = en.body.agent_id
    ok(`POST /v1/enroll (pack ${en.body.rules_pack_version})`)
  } catch (e) {
    fail("POST /v1/enroll", e)
  }

  let v1Count
  try {
    const cfg = await req("/v1/agents/me/config", {
      headers: { Authorization: `Bearer ${token}` }
    })
    assert(cfg.status === 200, `config ${cfg.status}`)
    assert(Array.isArray(cfg.body?.rules_pack?.rules), "no rules")
    v1Count = cfg.body.rules_pack.rules.length
    assert(v1Count > 0, "empty rules")
    ok(`GET config v1 (${v1Count} rules, ver=${cfg.body.rules_pack.version})`)

    const etag = cfg.headers.get("etag")
    if (etag) {
      const notMod = await req("/v1/agents/me/config", {
        headers: {
          Authorization: `Bearer ${token}`,
          "If-None-Match": etag
        }
      })
      assert(notMod.status === 304, `expected 304 got ${notMod.status}`)
      ok("GET config 304 If-None-Match")
    }
  } catch (e) {
    fail("GET config", e)
  }

  // --- PR2: list packs ---
  try {
    const list = await req("/v1/org/rules/packs", { headers: ADMIN })
    assert(list.status === 200, `list ${list.status}`)
    assert(list.body?.packs?.length >= 1, "no packs")
    assert(list.body.active_version, "no active_version")
    ok(
      `GET /org/rules/packs (active=${list.body.active_version}, n=${list.body.packs.length})`
    )
  } catch (e) {
    fail("GET packs", e)
  }

  // --- PR2: publish clone disabling one rule ---
  let newVersion
  try {
    const pub = await req("/v1/org/rules/packs", {
      method: "POST",
      headers: ADMIN,
      body: JSON.stringify({
        disable_rule_ids: ["email-address"],
        notes: "smoke: disable email rule",
        activate: true
      })
    })
    assert(pub.status === 200 && pub.body?.ok, `publish ${pub.status} ${JSON.stringify(pub.body)}`)
    newVersion = pub.body.version
    assert(pub.body.rules_count === v1Count - 1, `expected ${v1Count - 1} got ${pub.body.rules_count}`)
    ok(`POST publish pack ${newVersion} (${pub.body.rules_count} rules)`)
  } catch (e) {
    fail("POST publish", e)
  }

  // --- agent sees new pack ---
  try {
    const cfg2 = await req("/v1/agents/me/config", {
      headers: { Authorization: `Bearer ${token}` }
    })
    assert(cfg2.status === 200, `config2 ${cfg2.status}`)
    assert(cfg2.body.rules_pack.version === newVersion, "agent not on new pack")
    assert(
      !cfg2.body.rules_pack.rules.some((r) => r.id === "email-address"),
      "email rule still present"
    )
    ok(`Agent config synced to ${newVersion}`)
  } catch (e) {
    fail("agent sync after publish", e)
  }

  // --- validation reject ---
  try {
    const bad = await req("/v1/org/rules/packs", {
      method: "POST",
      headers: ADMIN,
      body: JSON.stringify({
        rules: [{ id: "x", name: "bad", patterns: ["("] }],
        notes: "should fail"
      })
    })
    assert(bad.status === 400, `expected 400 got ${bad.status}`)
    ok("POST publish invalid regex → 400")
  } catch (e) {
    fail("invalid publish", e)
  }

  // --- reactivate 1.0.0 ---
  try {
    const act = await req("/v1/org/rules/packs/1.0.0/activate", {
      method: "POST",
      headers: ADMIN
    })
    assert(act.status === 200 && act.body?.ok, `activate ${act.status}`)
    const cfg3 = await req("/v1/agents/me/config", {
      headers: { Authorization: `Bearer ${token}` }
    })
    assert(cfg3.body.rules_pack.version === "1.0.0", "not back to 1.0.0")
    assert(
      cfg3.body.rules_pack.rules.some((r) => r.id === "email-address"),
      "email rule missing after rollback"
    )
    ok("Activate 1.0.0 rollback works")
  } catch (e) {
    fail("activate rollback", e)
  }

  // --- re-enroll same device label must not create a 2nd agent ---
  try {
    const en2 = await req("/v1/enroll", {
      method: "POST",
      body: JSON.stringify({
        org_code: "DEMO-OPSGATE",
        device_label: "smoke-test",
        app_version: "0.3.0-smoke-re"
      })
    })
    assert(en2.status === 200, `re-enroll ${en2.status}`)
    assert(en2.body?.replaced === true, "expected replaced:true on same label")
    token = en2.body.agent_token
    const agents = await req("/v1/org/agents", { headers: ADMIN })
    const smokeAgents = (agents.body?.agents || []).filter(
      (a) => a.device_label === "smoke-test"
    )
    assert(smokeAgents.length === 1, `expected 1 smoke-test agent, got ${smokeAgents.length}`)
    ok("Re-enroll same label replaces agent (no duplicate)")
  } catch (e) {
    fail("re-enroll idempotent", e)
  }

  try {
    const batch = await req("/v1/events/batch", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        events: [
          {
            schema_version: 1,
            client_event_id: `smoke-${Date.now()}`,
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
    })
    assert(batch.status === 200 && batch.body?.accepted >= 1, "batch fail")
    ok("POST /v1/events/batch")
  } catch (e) {
    fail("events batch", e)
  }

  try {
    const sum = await req("/v1/org/summary", { headers: ADMIN })
    assert(sum.status === 200, `summary ${sum.status}`)
    assert(sum.body?.active_rules_pack?.version, "no active pack in summary")
    ok(
      `GET summary (packs=${sum.body.packs_published}, active=${sum.body.active_rules_pack.version})`
    )
  } catch (e) {
    fail("summary", e)
  }

  // --- revoke at end ---
  try {
    const rev = await req("/v1/agents/me/revoke", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` }
    })
    assert(rev.status === 200 && rev.body?.ok, `revoke ${rev.status}`)
    const agentsAfter = await req("/v1/org/agents", { headers: ADMIN })
    const left = (agentsAfter.body?.agents || []).filter(
      (a) => a.device_label === "smoke-test"
    )
    assert(left.length === 0, "smoke-test agent still listed after revoke")
    ok("POST /agents/me/revoke removes agent from console list")
  } catch (e) {
    fail("revoke", e)
  }

  console.log("")
  if (failed) {
    console.log(`${failed} check(s) failed`)
    process.exit(1)
  }
  console.log(`All smoke checks passed (agent ${agentId})`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
