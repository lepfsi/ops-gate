/**
 * Client control plane pour le proxy — enroll + events batch (P2).
 */
import { log } from "./log.js"
import {
  loadAgentState,
  saveAgentState,
  proxyFingerprint,
  type AgentState
} from "./agent-state.js"
import * as os from "node:os"

export type EnrollOpts = {
  apiBase: string
  orgCode: string
  deviceLabel?: string
}

export async function enrollProxy(opts: EnrollOpts): Promise<AgentState> {
  const base = opts.apiBase.replace(/\/$/, "")
  const fp = proxyFingerprint(opts.orgCode)
  const body = {
    org_code: opts.orgCode,
    device_type: "proxy",
    device_label: opts.deviceLabel || `OpsGate Proxy (${os.hostname()})`,
    host_name: os.hostname(),
    app_version: "proxy-0.4.0-p3",
    device_fingerprint: fp
  }
  const res = await fetch(`${base}/v1/enroll`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body)
  })
  const data = (await res.json().catch(() => ({}))) as {
    error?: string
    message?: string
    agent_id?: string
    agent_token?: string
    org_id?: string
    org_name?: string
  }
  if (!res.ok) {
    throw new Error(
      data.message || data.error || `enroll HTTP ${res.status}`
    )
  }
  if (!data.agent_token || !data.agent_id || !data.org_id) {
    throw new Error("enroll_incomplete_response")
  }
  const state: AgentState = {
    agent_id: data.agent_id,
    agent_token: data.agent_token,
    org_id: data.org_id,
    org_name: data.org_name,
    api_base: base,
    org_code: opts.orgCode,
    device_label: body.device_label,
    enrolled_at: new Date().toISOString(),
    device_fingerprint: fp
  }
  saveAgentState(state)
  log("info", "proxy_enrolled", {
    agent_id: state.agent_id,
    org_id: state.org_id,
    org_code: opts.orgCode,
    api_base: base
  })
  return state
}

export type ProxyDetectionEvent = {
  schema_version: 1
  client_event_id: string
  ts: string
  source: "proxy"
  hostname: string
  decision: "observe"
  detection_count: number
  highest_severity: "low" | "medium" | "high"
  rule_ids: string[]
  types: string[]
  masked: false
  redacted_matches: Array<{ rule_id: string; preview: string }>
  device_label?: string
}

let queue: ProxyDetectionEvent[] = []
let flushTimer: ReturnType<typeof setTimeout> | null = null
let flushing = false

export function queueProxyEvent(
  state: AgentState,
  ev: Omit<ProxyDetectionEvent, "schema_version" | "source" | "decision" | "masked" | "device_label">
) {
  const full: ProxyDetectionEvent = {
    schema_version: 1,
    source: "proxy",
    decision: "observe",
    masked: false,
    device_label: state.device_label,
    ...ev
  }
  queue.push(full)
  // Flush rapide pour que la console (MMC) voie l’event sans attendre longtemps
  if (queue.length >= 5) {
    void flushEvents(state)
    return
  }
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = setTimeout(() => {
    flushTimer = null
    void flushEvents(state)
  }, 400)
}

export async function flushEvents(state: AgentState): Promise<void> {
  if (flushing || queue.length === 0) return
  flushing = true
  const batch = queue.splice(0, 50)
  try {
    const res = await fetch(
      `${state.api_base.replace(/\/$/, "")}/v1/events/batch`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          Authorization: `Bearer ${state.agent_token}`
        },
        body: JSON.stringify({ events: batch })
      }
    )
    const data = (await res.json().catch(() => ({}))) as {
      error?: string
      accepted?: number
      skipped?: boolean
    }
    if (!res.ok) {
      log("warn", "events_batch_failed", {
        status: res.status,
        error: data.error || res.statusText,
        n: batch.length
      })
      // remets en file (cap)
      queue = [...batch, ...queue].slice(0, 80)
    } else {
      log("info", "events_batch_ok", {
        accepted: data.accepted ?? batch.length,
        skipped: !!data.skipped,
        n: batch.length
      })
    }
  } catch (e) {
    log("warn", "events_batch_error", {
      error: String((e as Error).message || e),
      n: batch.length
    })
    queue = [...batch, ...queue].slice(0, 80)
  } finally {
    flushing = false
    if (queue.length > 0) {
      flushTimer = setTimeout(() => {
        flushTimer = null
        void flushEvents(state)
      }, 5000)
    }
  }
}

export function getOrLoadState(): AgentState | null {
  return loadAgentState()
}
