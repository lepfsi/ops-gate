export type LogLevel = "debug" | "info" | "warn" | "error"

export function log(
  level: LogLevel,
  msg: string,
  fields: Record<string, unknown> = {}
) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg,
    component: "opsgate-proxy",
    phase: "P1",
    ...fields
  })
  if (level === "error") console.error(line)
  else console.log(line)
}
