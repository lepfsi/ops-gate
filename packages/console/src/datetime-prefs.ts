/**
 * Préférences d’affichage date / heure (console — localStorage utilisateur).
 * Toutes les dates UI (logs, inbox, events) doivent passer par formatDateTimeIso.
 */
import { useEffect, useState } from "react"

export type DateFormatPref = "dmy" | "ymd" | "mdy"
export type TimeFormatPref = "24h" | "12h"

export type DateTimePrefs = {
  /** Fuseau IANA pour l’horloge et l’affichage des logs */
  timezone: string
  dateFormat: DateFormatPref
  timeFormat: TimeFormatPref
  /** Afficher les secondes dans l’horloge navbar */
  showSeconds: boolean
}

const KEY = "opsgate_datetime_prefs"
/** Une fois posé, le fuseau d’affichage n’est plus écrasé par le schedule org. */
const USER_LOCK_KEY = "opsgate_datetime_prefs_user_lock"

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

/**
 * @param source `"user"` = choix console (protège contre l’écrasement org).
 *               `"org"` = seed depuis le schedule (ne pose pas le verrou).
 */
export function saveDateTimePrefs(
  p: DateTimePrefs,
  source: "user" | "org" = "user"
): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p))
    if (source === "user") {
      localStorage.setItem(USER_LOCK_KEY, "1")
    }
    window.dispatchEvent(new CustomEvent("opsgate-datetime-prefs", { detail: p }))
  } catch {
    /* ignore */
  }
}

function isDisplayTimezoneLockedByUser(): boolean {
  try {
    return localStorage.getItem(USER_LOCK_KEY) === "1"
  } catch {
    return false
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

/** Formate une ISO date pour l’UI (events, inbox, audit…) dans le fuseau admin */
export function formatDateTimeIso(
  iso: string | null | undefined,
  prefs: DateTimePrefs,
  opts?: { withSeconds?: boolean }
): string {
  if (!iso) return "—"
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return String(iso)
  const p = opts?.withSeconds
    ? prefs
    : { ...prefs, showSeconds: false }
  return formatClockNow(p, new Date(t))
}

/** Formate un timestamp ms / Date / ISO */
export function formatDateTimeAny(
  value: string | number | Date | null | undefined,
  prefs: DateTimePrefs
): string {
  if (value == null || value === "") return "—"
  if (value instanceof Date) return formatClockNow({ ...prefs, showSeconds: false }, value)
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "—"
    return formatClockNow({ ...prefs, showSeconds: false }, new Date(value))
  }
  return formatDateTimeIso(String(value), prefs)
}

/** Hook React : prefs live (navbar + logs) */
export function useDateTimePrefs(): DateTimePrefs {
  const [prefs, setPrefs] = useState<DateTimePrefs>(() => loadDateTimePrefs())
  useEffect(() => {
    const onPrefs = () => setPrefs(loadDateTimePrefs())
    window.addEventListener("opsgate-datetime-prefs", onPrefs)
    return () => window.removeEventListener("opsgate-datetime-prefs", onPrefs)
  }, [])
  return prefs
}

/**
 * Seed unique du fuseau d’affichage depuis le schedule org.
 * Ne s’applique que s’il n’y a encore aucune préférence d’affichage
 * (et pas de verrou utilisateur). Évite le retour forcé à Europe/Paris
 * (GMT+2) à chaque chargement / « Enregistrer » des paramètres.
 */
export function applyOrgTimezoneToPrefs(timezone: string): void {
  const tz = (timezone || "").trim()
  if (!tz) return
  if (isDisplayTimezoneLockedByUser()) return
  try {
    // Prefs déjà présentes (y compris sessions antérieures au verrou) → ne pas écraser
    if (localStorage.getItem(KEY)) return
  } catch {
    /* ignore */
  }
  const cur = loadDateTimePrefs()
  if (cur.timezone === tz) return
  saveDateTimePrefs({ ...cur, timezone: tz }, "org")
}

/** Labels lisibles (GMT) pour listes déroulantes console */
export const TIMEZONE_OPTIONS: ReadonlyArray<readonly [string, string]> = [
  ["Europe/Paris", "GMT+1/+2 · Europe/Paris (France)"],
  ["Europe/Brussels", "GMT+1/+2 · Europe/Brussels"],
  ["Europe/London", "GMT+0/+1 · Europe/London"],
  ["Europe/Moscow", "GMT+3 · Europe/Moscow"],
  ["Africa/Douala", "GMT+1 · Africa/Douala (Cameroun)"],
  ["Africa/Nairobi", "GMT+3 · Africa/Nairobi"],
  ["Africa/Abidjan", "GMT+0 · Africa/Abidjan"],
  ["Africa/Johannesburg", "GMT+2 · Africa/Johannesburg"],
  ["Africa/Antananarivo", "GMT+3 · Africa/Antananarivo"],
  ["Indian/Mauritius", "GMT+4 · Indian/Mauritius"],
  ["Indian/Reunion", "GMT+4 · Indian/Reunion"],
  ["Asia/Dubai", "GMT+4 · Asia/Dubai"],
  ["Asia/Tbilisi", "GMT+4 · Asia/Tbilisi"],
  ["Asia/Baku", "GMT+4 · Asia/Baku"],
  ["Asia/Yerevan", "GMT+4 · Asia/Yerevan"],
  ["Asia/Karachi", "GMT+5 · Asia/Karachi"],
  ["Asia/Kolkata", "GMT+5:30 · Asia/Kolkata"],
  ["Asia/Bangkok", "GMT+7 · Asia/Bangkok (Thaïlande)"],
  ["Asia/Jakarta", "GMT+7 · Asia/Jakarta (Indonésie)"],
  ["Asia/Ho_Chi_Minh", "GMT+7 · Asia/Ho_Chi_Minh (Vietnam)"],
  ["Asia/Singapore", "GMT+8 · Asia/Singapore"],
  ["Asia/Tokyo", "GMT+9 · Asia/Tokyo"],
  ["America/New_York", "GMT−5/−4 · America/New_York"],
  ["America/Montreal", "GMT−5/−4 · America/Montreal"],
  ["America/Sao_Paulo", "GMT−3 · America/Sao_Paulo"],
  ["UTC", "GMT+0 · UTC"]
] as const

export const COMMON_TIMEZONES = TIMEZONE_OPTIONS.map(([z]) => z)

// silence unused helper if tree-shaken
void dateOrder
