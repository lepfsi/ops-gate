/**
 * Préférences d’affichage date / heure (console — localStorage utilisateur).
 */

export type DateFormatPref = "dmy" | "ymd" | "mdy"
export type TimeFormatPref = "24h" | "12h"

export type DateTimePrefs = {
  /** Fuseau IANA pour l’horloge et l’affichage */
  timezone: string
  dateFormat: DateFormatPref
  timeFormat: TimeFormatPref
  /** Afficher les secondes dans l’horloge navbar */
  showSeconds: boolean
}

const KEY = "opsgate_datetime_prefs"

export const DEFAULT_DATETIME_PREFS: DateTimePrefs = {
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Paris",
  dateFormat: "dmy",
  timeFormat: "24h",
  showSeconds: true
}

export function loadDateTimePrefs(): DateTimePrefs {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULT_DATETIME_PREFS }
    const j = JSON.parse(raw) as Partial<DateTimePrefs>
    return {
      timezone:
        typeof j.timezone === "string" && j.timezone.trim()
          ? j.timezone.trim()
          : DEFAULT_DATETIME_PREFS.timezone,
      dateFormat:
        j.dateFormat === "ymd" || j.dateFormat === "mdy" || j.dateFormat === "dmy"
          ? j.dateFormat
          : "dmy",
      timeFormat: j.timeFormat === "12h" ? "12h" : "24h",
      showSeconds: j.showSeconds !== false
    }
  } catch {
    return { ...DEFAULT_DATETIME_PREFS }
  }
}

export function saveDateTimePrefs(p: DateTimePrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p))
    window.dispatchEvent(new CustomEvent("opsgate-datetime-prefs", { detail: p }))
  } catch {
    /* ignore */
  }
}

function dateOrder(fmt: DateFormatPref): string {
  if (fmt === "ymd") return "yyyy-MM-dd"
  if (fmt === "mdy") return "MM/dd/yyyy"
  return "dd/MM/yyyy"
}

/** Horloge live (date + heure selon prefs) */
export function formatClockNow(prefs: DateTimePrefs, now = new Date()): string {
  const tz = prefs.timezone || "Europe/Paris"
  try {
    const dateOpts: Intl.DateTimeFormatOptions = {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }
    const timeOpts: Intl.DateTimeFormatOptions = {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      second: prefs.showSeconds ? "2-digit" : undefined,
      hour12: prefs.timeFormat === "12h"
    }

    // Ordre de date via formatToParts
    const dParts = new Intl.DateTimeFormat("en-GB", dateOpts).formatToParts(now)
    const day = dParts.find((p) => p.type === "day")?.value || "01"
    const month = dParts.find((p) => p.type === "month")?.value || "01"
    const year = dParts.find((p) => p.type === "year")?.value || "1970"
    let dateStr: string
    if (prefs.dateFormat === "ymd") dateStr = `${year}-${month}-${day}`
    else if (prefs.dateFormat === "mdy") dateStr = `${month}/${day}/${year}`
    else dateStr = `${day}/${month}/${year}`

    const timeStr = new Intl.DateTimeFormat(
      prefs.timeFormat === "12h" ? "en-US" : "fr-FR",
      timeOpts
    ).format(now)

    return `${dateStr} · ${timeStr}`
  } catch {
    return now.toLocaleString()
  }
}

/** Formate une ISO date pour l’UI (events, etc.) */
export function formatDateTimeIso(
  iso: string | null | undefined,
  prefs: DateTimePrefs
): string {
  if (!iso) return "—"
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return String(iso)
  return formatClockNow(prefs, new Date(t))
}

export const COMMON_TIMEZONES = [
  "Europe/Paris",
  "Europe/Brussels",
  "Europe/London",
  "Africa/Douala",
  "Africa/Nairobi",
  "Africa/Abidjan",
  "America/New_York",
  "America/Montreal",
  "Asia/Dubai",
  "UTC"
] as const

// silence unused helper if tree-shaken
void dateOrder
