/**
 * SIEM / Syslog — envoi events détection (RFC 5424 ou CEF).
 * UDP (défaut) ou TCP. Fire-and-forget ; jamais bloquant pour le data-plane.
 */
import * as dgram from "node:dgram"
import * as net from "node:net"
import type { OrgSiEmSettings, StoredEvent } from "./types"

const APP = "OpsGate"
const VENDOR = "DailyOps"
const PRODUCT = "OpsGate"
const VERSION = "1.2"

/** PRI = facility * 8 + severity (0-7). facility 16 = local0 */
function pri(facility: number, severity: number): number {
  const f = Math.max(0, Math.min(23, facility | 0))
  const s = Math.max(0, Math.min(7, severity | 0))
  return f * 8 + s
}

function severityFromEvent(e: StoredEvent): number {
  // syslog: 0 emerg … 6 info, 7 debug
  if (e.decision === "block" || e.highest_severity === "high") return 3 // err
  if (e.decision === "send_anyway" || e.highest_severity === "medium") return 4 // warning
  if (e.decision === "mask_send" || e.decision === "observe") return 5 // notice
  return 6 // info
}

function cefSeverity(e: StoredEvent): number {
  if (e.decision === "block" || e.highest_severity === "high") return 8
  if (e.decision === "send_anyway" || e.highest_severity === "medium") return 6
  if (e.highest_severity === "low") return 3
  return 5
}

function escapeCef(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/=/g, "\\=").replace(/\n/g, " ")
}

function hostSafe(s: string): string {
  return (s || "opsgate").replace(/\s+/g, "_").slice(0, 64)
}

export function formatEventRfc5424(
  e: StoredEvent,
  opts: { facility: number; appName: string; hostname: string; orgId: string }
): string {
  const severity = severityFromEvent(e)
  const p = pri(opts.facility, severity)
  const ts = (e.ts || new Date().toISOString()).replace(/\.\d{3}Z$/, "Z")
  const msgid = (e.decision || "event").slice(0, 32)
  const sd = [
    `org_id="${opts.orgId}"`,
    `decision="${e.decision}"`,
    `source="${e.source}"`,
    `severity="${e.highest_severity}"`,
    `hostname="${(e.hostname || "").replace(/"/g, "")}"`,
    `device="${(e.device_label || "").replace(/"/g, "")}"`,
    `rules="${(e.rule_ids || []).join(",").replace(/"/g, "")}"`,
    `agent_id="${e.agentId || ""}"`
  ].join(" ")
  const msg = `opsgate detection decision=${e.decision} count=${e.detection_count}`
  return `<${p}>1 ${ts} ${hostSafe(opts.hostname)} ${hostSafe(opts.appName)} - ${msgid} [opsgate@32473 ${sd}] ${msg}`
}

export function formatEventCef(
  e: StoredEvent,
  opts: { orgId: string }
): string {
  const name = e.decision || "detection"
  const sev = cefSeverity(e)
  const ext = [
    `cs1=${escapeCef(opts.orgId)}`,
    `cs1Label=orgId`,
    `cs2=${escapeCef(e.source || "")}`,
    `cs2Label=source`,
    `cs3=${escapeCef(e.decision || "")}`,
    `cs3Label=decision`,
    `cs4=${escapeCef((e.rule_ids || []).join(","))}`,
    `cs4Label=ruleIds`,
    `dhost=${escapeCef(e.hostname || "")}`,
    `suser=${escapeCef(e.device_label || "")}`,
    `msg=${escapeCef(`detections=${e.detection_count}`)}`
  ].join(" ")
  return `CEF:0|${VENDOR}|${PRODUCT}|${VERSION}|${name}|${name}|${sev}|${ext}`
}

function sendUdp(host: string, port: number, lines: string[]): void {
  const sock = dgram.createSocket("udp4")
  let pending = lines.length
  const done = () => {
    pending--
    if (pending <= 0) {
      try {
        sock.close()
      } catch {
        /* ignore */
      }
    }
  }
  sock.on("error", () => {
    try {
      sock.close()
    } catch {
      /* ignore */
    }
  })
  for (const line of lines) {
    const buf = Buffer.from(line + "\n", "utf8")
    sock.send(buf, port, host, () => done())
  }
}

function sendTcp(host: string, port: number, lines: string[]): void {
  const sock = net.connect({ host, port }, () => {
    // RFC 6587 octet-counting ou newline — on envoie newline-framed
    sock.write(lines.map((l) => l + "\n").join(""), () => {
      sock.end()
    })
  })
  sock.setTimeout(5000, () => {
    try {
      sock.destroy()
    } catch {
      /* ignore */
    }
  })
  sock.on("error", () => {
    try {
      sock.destroy()
    } catch {
      /* ignore */
    }
  })
}

/**
 * Envoie les events vers le SIEM org (best-effort).
 */
export function forwardEventsToSiem(
  events: StoredEvent[],
  siem: OrgSiEmSettings | null | undefined,
  meta: { orgId: string }
): void {
  if (!siem?.enabled) return
  const host = (siem.host || "").trim()
  const port = Number(siem.port) || 0
  if (!host || port < 1 || port > 65535) return
  if (!events.length) return

  const facility = typeof siem.facility === "number" ? siem.facility : 16
  const appName = siem.appName || APP
  const format = siem.format === "cef" ? "cef" : "rfc5424"
  const protocol = siem.protocol === "tcp" ? "tcp" : "udp"

  const lines = events.slice(0, 50).map((e) =>
    format === "cef"
      ? formatEventCef(e, { orgId: meta.orgId })
      : formatEventRfc5424(e, {
          facility,
          appName,
          hostname: process.env.HOSTNAME || "opsgate-api",
          orgId: meta.orgId
        })
  )

  try {
    if (protocol === "tcp") sendTcp(host, port, lines)
    else sendUdp(host, port, lines)
  } catch {
    /* never throw into request path */
  }
}

/** Compteurs process pour rate (Prometheus) */
const counters = {
  events_forwarded_siem: 0,
  events_accepted: 0,
  events_by_decision: new Map<string, number>()
}

export function recordAcceptedEvents(events: StoredEvent[]) {
  counters.events_accepted += events.length
  for (const e of events) {
    const d = e.decision || "unknown"
    counters.events_by_decision.set(
      d,
      (counters.events_by_decision.get(d) || 0) + 1
    )
  }
}

export function recordSiemForwarded(n: number) {
  counters.events_forwarded_siem += n
}

export function getProcessCounters() {
  return {
    events_accepted: counters.events_accepted,
    events_forwarded_siem: counters.events_forwarded_siem,
    events_by_decision: Object.fromEntries(counters.events_by_decision)
  }
}
