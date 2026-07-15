/**
 * P3 foundations — sync config control plane + heartbeat last_seen.
 * Enforce (mask/block) : stub log only.
 */
import { log } from "./log.js"
import type { AgentState } from "./agent-state.js"

export type ProxyRemoteConfig = {
  enabled: boolean
  mode: "observe" | "enforce"
  config_epoch?: number
  rules_pack_version?: string
  enabled_hosts?: string[]
}

let lastConfig: ProxyRemoteConfig = {
  enabled: true,
  mode: "observe"
}

export function getProxyRemoteConfig(): ProxyRemoteConfig {
  return lastConfig
}

/**
 * Poll GET /v1/agents/me/config — met à jour last_seen côté API + flags proxy org.
 */
export async function syncProxyConfig(state: AgentState): Promise<ProxyRemoteConfig | null> {
  try {
    const res = await fetch(
      `${state.api_base.replace(/\/$/, "")}/v1/agents/me/config`,
      {
        headers: {
          accept: "application/json",
          Authorization: `Bearer ${state.agent_token}`
        }
      }
    )
    if (res.status === 304) {
      log("debug", "config_not_modified", {})
      return lastConfig
    }
    if (!res.ok) {
      log("warn", "config_sync_failed", { status: res.status })
      return null
    }
    const data = (await res.json()) as {
      proxy?: { enabled?: boolean; mode?: string }
      policy?: {
        config_epoch?: number
        enabled_hosts?: string[]
        rules_pack_version?: string
      }
      rules_pack?: { version?: string }
    }
    lastConfig = {
      enabled: data.proxy?.enabled !== false,
      mode: data.proxy?.mode === "enforce" ? "enforce" : "observe",
      config_epoch: data.policy?.config_epoch,
      rules_pack_version:
        data.rules_pack?.version || data.policy?.rules_pack_version,
      enabled_hosts: data.policy?.enabled_hosts
    }
    log("info", "config_synced", {
      mode: lastConfig.mode,
      enabled: lastConfig.enabled,
      config_epoch: lastConfig.config_epoch ?? null,
      rules_pack_version: lastConfig.rules_pack_version ?? null,
      hosts: lastConfig.enabled_hosts?.length ?? 0
    })
    if (lastConfig.mode === "enforce") {
      log("warn", "enforce_stub", {
        note: "P3 foundation — enforce not applied yet (observe only)"
      })
    }
    return lastConfig
  } catch (e) {
    log("warn", "config_sync_error", {
      error: String((e as Error).message || e)
    })
    return null
  }
}

/** Intervalle de sync (ms) — défaut 2 min */
export function startConfigPoll(
  getState: () => AgentState | null,
  intervalMs = 120_000
): () => void {
  const tick = () => {
    const st = getState()
    if (st) void syncProxyConfig(st)
  }
  tick()
  const id = setInterval(tick, intervalMs)
  return () => clearInterval(id)
}
