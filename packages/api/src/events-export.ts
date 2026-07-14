/** Export CSV/JSON + fenêtres semaine ISO pour logs detection */

import type { StoredEvent } from "./types"

export function startOfIsoWeek(d = new Date()): Date {
  const x = new Date(d)
  const day = x.getUTCDay() || 7 // 1=lun … 7=dim
  x.setUTCDate(x.getUTCDate() - day + 1)
  x.setUTCHours(0, 0, 0, 0)
  return x
}

export function previousIsoWeekRange(now = new Date()): {
  from: Date
  to: Date
  weekKey: string
} {
  const thisWeek = startOfIsoWeek(now)
  const to = new Date(thisWeek.getTime() - 1) // fin dimanche précédent
  const from = startOfIsoWeek(to)
  const y = from.getUTCFullYear()
  const onejan = new Date(Date.UTC(y, 0, 1))
  const week = Math.ceil(
    ((from.getTime() - onejan.getTime()) / 86400000 + onejan.getUTCDay() + 1) /
      7
  )
  return {
    from,
    to,
    weekKey: `${y}-W${String(week).padStart(2, "0")}`
  }
}

export function filterEventsRange(
  events: StoredEvent[],
  fromMs: number,
  toMs: number
): StoredEvent[] {
  return events.filter((e) => {
    const t = Date.parse(e.ts || e.receivedAt)
    if (!Number.isFinite(t)) return false
    return t >= fromMs && t <= toMs
  })
}

function csvEscape(v: unknown): string {
  const s = v == null ? "" : String(v)
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

export function eventsToCsv(events: StoredEvent[]): string {
  const headers = [
    "id",
    "ts",
    "received_at",
    "decision",
    "source",
    "hostname",
    "device_label",
    "detection_count",
    "highest_severity",
    "types",
    "rule_ids",
    "masked",
    "file_names",
    "exit_actor",
    "agent_id"
  ]
  const lines = [headers.join(",")]
  for (const e of events) {
    lines.push(
      [
        e.id,
        e.ts,
        e.receivedAt,
        e.decision,
        e.source,
        e.hostname,
        e.device_label || "",
        e.detection_count,
        e.highest_severity,
        (e.types || []).join("|"),
        (e.rule_ids || []).join("|"),
        e.masked == null ? "" : e.masked ? "1" : "0",
        (e.file_names || []).join("|"),
        e.exit_actor || "",
        e.agentId || ""
      ]
        .map(csvEscape)
        .join(",")
    )
  }
  return lines.join("\n")
}

export function eventsToJson(events: StoredEvent[]): string {
  return JSON.stringify(
    events.map((e) => ({
      id: e.id,
      ts: e.ts,
      received_at: e.receivedAt,
      decision: e.decision,
      source: e.source,
      hostname: e.hostname,
      device_label: e.device_label ?? null,
      detection_count: e.detection_count,
      highest_severity: e.highest_severity,
      types: e.types || [],
      rule_ids: e.rule_ids || [],
      masked: e.masked ?? null,
      file_names: e.file_names ?? null,
      exit_actor: e.exit_actor ?? null,
      agent_id: e.agentId ?? null
    })),
    null,
    2
  )
}

export function daysUntilPurge(
  oldestTs: string | undefined,
  retentionDays: number
): number | null {
  if (!oldestTs || !retentionDays) return null
  const oldest = Date.parse(oldestTs)
  if (!Number.isFinite(oldest)) return null
  const purgeAt = oldest + retentionDays * 86400000
  return Math.ceil((purgeAt - Date.now()) / 86400000)
}
