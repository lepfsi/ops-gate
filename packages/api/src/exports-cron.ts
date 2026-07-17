/**
 * Export automatique des logs events — config 100 % client :
 * destinataires e-mail, jour de la semaine, heure, fuseau, formats.
 *
 * Cron serveur : OPSGATE_EXPORTS_CRON_MINUTES (défaut 15) pour caler l’heure.
 * 0 = désactive le cron (export lazy GET /events reste possible).
 */
import {
  eventsToCsv,
  eventsToJson,
  filterEventsRange,
  previousIsoWeekRange
} from "./events-export"
import { sendScheduledExportReadyEmail } from "./mail"
import type { OpsGateStore } from "./store-types"
import {
  mergeMonitoringSettings,
  type ScheduledLogExportSettings
} from "./types"

let timer: ReturnType<typeof setInterval> | null = null
let running = false

/** Max total attachment size per mail (~1.2 Mo) */
const MAX_ATTACH_BYTES = 1_200_000

function exportsCronIntervalMs(env: NodeJS.ProcessEnv = process.env): number {
  const min = Number(env.OPSGATE_EXPORTS_CRON_MINUTES ?? 15)
  if (!Number.isFinite(min) || min <= 0) return 0
  return Math.max(5, min) * 60_000
}

/** Jour ISO 1=lun … 7=dim dans un fuseau IANA */
function isoWeekdayInTz(now: Date, timeZone: string): number {
  try {
    const wd = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short"
    }).format(now)
    const map: Record<string, number> = {
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
      Sun: 7
    }
    return map[wd] || 1
  } catch {
    const d = now.getUTCDay() || 7
    return d
  }
}

/** "HH:mm" local dans le fuseau */
function localHmm(now: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).formatToParts(now)
    const h = parts.find((p) => p.type === "hour")?.value || "00"
    const m = parts.find((p) => p.type === "minute")?.value || "00"
    return `${h.padStart(2, "0")}:${m.padStart(2, "0")}`
  } catch {
    return `${String(now.getUTCHours()).padStart(2, "0")}:${String(now.getUTCMinutes()).padStart(2, "0")}`
  }
}

/**
 * Fenêtre d’exécution : même jour + heure locale dans [time, time+cronInterval).
 * Évite double run si lastWeeklyExportAt contient déjà weekKey.
 */
export function isExportScheduleDue(
  cfg: ScheduledLogExportSettings,
  now = new Date(),
  windowMinutes = 20
): boolean {
  if (!cfg.enabled) return false
  if (!cfg.recipientEmails?.length && !cfg.formats?.length) {
    // sans destinataires on génère quand même l’archive console si enabled
  }
  const tz = cfg.timezone || "Europe/Paris"
  const day = isoWeekdayInTz(now, tz)
  if (day !== cfg.dayOfWeek) return false
  const nowHm = localHmm(now, tz)
  const [th, tm] = (cfg.timeLocal || "08:00").split(":").map(Number)
  const [nh, nm] = nowHm.split(":").map(Number)
  const targetMin = (th || 0) * 60 + (tm || 0)
  const nowMin = (nh || 0) * 60 + (nm || 0)
  // dans la fenêtre [target, target+windowMinutes)
  if (nowMin < targetMin) return false
  if (nowMin >= targetMin + windowMinutes) return false
  return true
}

export async function runWeeklyExportForOrg(
  store: OpsGateStore,
  orgId: string,
  opts?: { force?: boolean }
): Promise<{
  generated: number
  skipped: boolean
  weekKey?: string
  reason?: string
  mails_ok?: number
  mails_fail?: number
  recipients?: number
}> {
  const org = await store.getOrg(orgId)
  if (!org || org.isPersonal) {
    return { generated: 0, skipped: true, reason: "personal_or_missing" }
  }
  const mon = mergeMonitoringSettings(org.monitoring)
  const cfg: ScheduledLogExportSettings = mon.scheduledLogExport || {
    enabled: mon.weeklyExportEnabled,
    recipientEmails: [],
    dayOfWeek: 1,
    timeLocal: "08:00",
    timezone: mon.schedule?.timezone || "Europe/Paris",
    formats: mon.weeklyExportFormats || ["csv"],
    attachFiles: true
  }

  if (!cfg.enabled && !mon.weeklyExportEnabled) {
    return { generated: 0, skipped: true, reason: "disabled" }
  }

  if (!opts?.force && !isExportScheduleDue(cfg)) {
    return { generated: 0, skipped: true, reason: "not_due" }
  }

  // Semaine ISO précédente (logs de la semaine écoulée)
  const { from, to, weekKey } = previousIsoWeekRange()
  const last = mon.lastWeeklyExportAt || ""
  if (!opts?.force && last.includes(weekKey)) {
    return { generated: 0, skipped: true, reason: "already_done", weekKey }
  }
  // Ne pas exporter avant la fin de la semaine précédente (sauf force)
  if (!opts?.force && Date.now() < to.getTime()) {
    return { generated: 0, skipped: true, reason: "week_not_ended", weekKey }
  }

  const formats = (
    cfg.formats?.length ? cfg.formats : mon.weeklyExportFormats || ["csv"]
  ).filter((f): f is "csv" | "json" => f === "csv" || f === "json")
  const uniqFormats = [...new Set(formats.length ? formats : ["csv" as const])]

  const all = await store.listEvents(orgId, 5000)
  const slice = filterEventsRange(all, from.getTime(), to.getTime())
  const expires = new Date(
    Date.now() + Math.max(mon.logRetentionDays, 30) * 86400000
  ).toISOString()

  const files: Array<{
    filename: string
    content: string
    format: "csv" | "json"
  }> = []

  let generated = 0
  if (slice.length === 0) {
    // Archive minimale + e-mail « semaine vide » si destinataires (sinon l’admin croit que le mail est cassé)
    const emptyNote = [
      "# OpsGate export — aucun event sur la période",
      `week=${weekKey}`,
      `from=${from.toISOString()}`,
      `to=${to.toISOString()}`,
      `org=${org.orgCode || orgId}`
    ].join("\n")
    for (const format of uniqFormats) {
      const content =
        format === "json"
          ? JSON.stringify(
              {
                week: weekKey,
                from: from.toISOString(),
                to: to.toISOString(),
                events: [],
                note: "no_events"
              },
              null,
              2
            )
          : emptyNote
      const filename = `opsgate-events-${weekKey}.${format}`
      await store.saveLogExport(orgId, {
        kind: "week",
        format,
        filename,
        content,
        eventCount: 0,
        fromTs: from.toISOString(),
        toTs: to.toISOString(),
        expiresAt: expires
      })
      files.push({ filename, content, format })
      generated++
    }
  } else {
    for (const format of uniqFormats) {
      const content =
        format === "json" ? eventsToJson(slice) : eventsToCsv(slice)
      const filename = `opsgate-events-${weekKey}.${format}`
      await store.saveLogExport(orgId, {
        kind: "week",
        format,
        filename,
        content,
        eventCount: slice.length,
        fromTs: from.toISOString(),
        toTs: to.toISOString(),
        expiresAt: expires
      })
      files.push({ filename, content, format })
      generated++
    }
  }

  await store.updateOrgMonitoring(orgId, {
    lastWeeklyExportAt: `${weekKey}:${new Date().toISOString()}`
  })

  const recipients = (cfg.recipientEmails || [])
    .map((e) => String(e || "").trim().toLowerCase())
    .filter((e) => e.includes("@"))

  let mailsOk = 0
  let mailsFail = 0
  if (recipients.length) {
    let attachments:
      | Array<{ filename: string; content: string; contentType?: string }>
      | undefined
    if (cfg.attachFiles !== false) {
      let total = 0
      const acc: Array<{
        filename: string
        content: string
        contentType?: string
      }> = []
      for (const f of files) {
        total += Buffer.byteLength(f.content, "utf8")
        if (total > MAX_ATTACH_BYTES) {
          acc.length = 0
          break
        }
        acc.push({
          filename: f.filename,
          content: f.content,
          contentType:
            f.format === "json"
              ? "application/json"
              : "text/csv; charset=utf-8"
        })
      }
      if (acc.length) attachments = acc
    }

    for (const to of [...new Set(recipients)].slice(0, 20)) {
      try {
        const r = await sendScheduledExportReadyEmail({
          to,
          orgName: org.name || org.orgCode || orgId,
          weekKey,
          filenames: files.map((f) => f.filename),
          eventCount: slice.length,
          formats: uniqFormats,
          attachments,
          smtp: mon.smtp || null
        })
        if (r.ok) mailsOk++
        else {
          mailsFail++
          console.warn(
            `[exports] mail fail to=${to} delivery=${r.delivery} err=${r.error || "?"}`
          )
        }
      } catch (e) {
        mailsFail++
        console.warn(
          `[exports] mail error to=${to}`,
          e instanceof Error ? e.message : e
        )
      }
    }
  } else if (cfg.enabled) {
    console.warn(
      `[exports] org=${org.orgCode || orgId} enabled but no recipientEmails — configure Paramètres → Rapports`
    )
  }

  console.log(
    `[exports] week=${weekKey} org=${org.orgCode || orgId} events=${slice.length} formats=${uniqFormats.join("+")} mails_ok=${mailsOk} mails_fail=${mailsFail} recipients=${recipients.length}`
  )
  return {
    generated,
    skipped: false,
    weekKey,
    reason: slice.length === 0 ? "no_events" : undefined,
    mails_ok: mailsOk,
    mails_fail: mailsFail,
    recipients: recipients.length
  } as {
    generated: number
    skipped: boolean
    weekKey?: string
    reason?: string
    mails_ok?: number
    mails_fail?: number
    recipients?: number
  }
}

export function startExportsCron(store: OpsGateStore): void {
  const interval = exportsCronIntervalMs()
  if (interval < 60_000) {
    console.log(
      "[opsgate-api] Exports cron off (set OPSGATE_EXPORTS_CRON_MINUTES=15)"
    )
    return
  }
  if (timer) clearInterval(timer)
  console.log(
    `[opsgate-api] Exports cron every ${Math.round(interval / 60000)} min (client day/time/emails)`
  )
  setTimeout(() => void runExportsCronOnce(store), 60_000)
  timer = setInterval(() => {
    void runExportsCronOnce(store)
  }, interval)
}

export async function runExportsCronOnce(store: OpsGateStore): Promise<{
  orgs: number
  generated: number
}> {
  if (running) return { orgs: 0, generated: 0 }
  running = true
  let orgs = 0
  let generated = 0
  try {
    const list = await store.listOrgs()
    for (const org of list) {
      if (org.isPersonal) continue
      orgs++
      try {
        const r = await runWeeklyExportForOrg(store, org.id)
        generated += r.generated
      } catch (e) {
        console.warn(
          `[exports] org=${org.orgCode || org.id}`,
          e instanceof Error ? e.message : e
        )
      }
    }
  } finally {
    running = false
  }
  return { orgs, generated }
}
