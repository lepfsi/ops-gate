import { useEffect, useState, type CSSProperties } from "react"

import {
  formatClockNow,
  loadDateTimePrefs,
  type DateTimePrefs
} from "./datetime-prefs"

/** Horloge live qui suit les préférences date/heure console */
export function LiveClock({
  className,
  style,
  compact
}: {
  className?: string
  style?: CSSProperties
  /** Sans date, heure seule */
  compact?: boolean
}) {
  const [prefs, setPrefs] = useState<DateTimePrefs>(() => loadDateTimePrefs())
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const onPrefs = (e: Event) => {
      const d = (e as CustomEvent<DateTimePrefs>).detail
      if (d) setPrefs(d)
      else setPrefs(loadDateTimePrefs())
    }
    window.addEventListener("opsgate-datetime-prefs", onPrefs)
    return () => window.removeEventListener("opsgate-datetime-prefs", onPrefs)
  }, [])

  useEffect(() => {
    const tickMs = prefs.showSeconds ? 1000 : 15_000
    const id = window.setInterval(() => setNow(new Date()), tickMs)
    return () => window.clearInterval(id)
  }, [prefs.showSeconds])

  const label = compact
    ? formatClockNow({ ...prefs, dateFormat: prefs.dateFormat }, now).split(
        " · "
      )[1] || formatClockNow(prefs, now)
    : formatClockNow(prefs, now)

  return (
    <time
      className={className}
      dateTime={now.toISOString()}
      title={prefs.timezone}
      style={{
        fontVariantNumeric: "tabular-nums",
        whiteSpace: "nowrap",
        ...style
      }}>
      {label}
    </time>
  )
}
