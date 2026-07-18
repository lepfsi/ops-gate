/**
 * Backup automatique système (dump DB + config org).
 *
 * - Intervalle 7 / 14 / 30 jours (config org monitoring.autoBackup + env)
 * - Export config org (JSON) + dump Postgres si DATABASE_URL + pg_dump
 * - Dossier : monitoring.autoBackup.directory (prioritaire) → env → défaut
 *
 * Env :
 *   OPSGATE_AUTO_BACKUP_DIR   (fallback si pas de dossier admin)
 *   OPSGATE_AUTO_BACKUP_CRON_MINUTES  (défaut 60, 0 = off)
 *   DATABASE_URL              (pour pg_dump)
 */
import { execFile } from "node:child_process"
import { promises as fs } from "node:fs"
import path from "node:path"
import { promisify } from "node:util"
import { buildOrgBackup } from "./org-backup"
import type { OpsGateStore } from "./store-types"
import {
  mergeMonitoringSettings,
  type AutoSystemBackupSettings,
  DEFAULT_AUTO_SYSTEM_BACKUP
} from "./types"

const execFileAsync = promisify(execFile)

let timer: ReturnType<typeof setInterval> | null = null
let running = false

/** Fallback global (env / cwd) — sans config admin */
export function defaultBackupDir(): string {
  const d = (process.env.OPSGATE_AUTO_BACKUP_DIR || "").trim()
  return d || path.resolve(process.cwd(), "backups", "auto")
}

/**
 * Résout le dossier de backup.
 * Priorité : chemin admin (absolu recommandé) → env → ./backups/auto
 */
export function resolveBackupDir(directory?: string | null): string {
  const raw = (directory || "").trim()
  if (raw) {
    // Windows drive / UNC / Unix abs / relatif → normalize
    if (path.isAbsolute(raw) || /^[a-zA-Z]:[\\/]/.test(raw) || raw.startsWith("\\\\")) {
      return path.normalize(raw)
    }
    // Relatif : ancré sur cwd API (explicite pour l’admin)
    return path.resolve(process.cwd(), raw)
  }
  return defaultBackupDir()
}

function cronIntervalMs(env: NodeJS.ProcessEnv = process.env): number {
  const min = Number(env.OPSGATE_AUTO_BACKUP_CRON_MINUTES ?? 60)
  if (!Number.isFinite(min) || min <= 0) return 0
  return Math.max(15, min) * 60_000
}

/**
 * Horodatage fichier YYYYMMDD-HHMMSS dans le fuseau org (schedule),
 * pas en UTC forcé — sinon les noms de backup affichent toujours GMT+0.
 */
function stamp(timeZone?: string | null): string {
  const d = new Date()
  const tz = (timeZone || "").trim() || "UTC"
  try {
    // sv-SE → "2026-07-18 15:30:45" en heure locale du fuseau
    const local = d.toLocaleString("sv-SE", { timeZone: tz })
    const m = local.match(
      /(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/
    )
    if (m) return `${m[1]}${m[2]}${m[3]}-${m[4]}${m[5]}${m[6]}`
  } catch {
    /* fuseau invalide → UTC */
  }
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`
}

export function isAutoBackupDue(
  cfg: AutoSystemBackupSettings,
  now = new Date()
): boolean {
  if (!cfg.enabled) return false
  if (!cfg.lastRunAt) return true
  const last = Date.parse(cfg.lastRunAt)
  if (!Number.isFinite(last)) return true
  const intervalMs = cfg.intervalDays * 24 * 60 * 60 * 1000
  return now.getTime() - last >= intervalMs
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true })
}

async function pruneOld(dir: string, keep: number): Promise<void> {
  let entries: string[]
  try {
    entries = await fs.readdir(dir)
  } catch {
    return
  }
  // Groupes par stamp dans le nom backup-opsgate-YYYYMMDD-HHMMSS.*
  const stamps = new Set<string>()
  for (const e of entries) {
    const m = e.match(/backup-opsgate-(\d{8}-\d{6})/)
    if (m) stamps.add(m[1])
  }
  const sorted = [...stamps].sort().reverse()
  const drop = sorted.slice(Math.max(0, keep))
  for (const s of drop) {
    for (const e of entries) {
      if (e.includes(`backup-opsgate-${s}`)) {
        try {
          await fs.unlink(path.join(dir, e))
        } catch {
          /* ignore */
        }
      }
    }
  }
}

async function runPgDump(outFile: string): Promise<{ ok: boolean; detail: string }> {
  const url = (process.env.DATABASE_URL || "").trim()
  if (!url) {
    return { ok: false, detail: "DATABASE_URL manquant — dump SQL ignoré" }
  }
  try {
    await execFileAsync(
      "pg_dump",
      [url, "--no-owner", "--no-acl", "-F", "p", "-f", outFile],
      { timeout: 600_000, windowsHide: true }
    )
    return { ok: true, detail: `pg_dump → ${path.basename(outFile)}` }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, detail: `pg_dump échec: ${msg.slice(0, 200)}` }
  }
}

/**
 * Exécute un cycle de backup pour une org (config JSON + optionnel SQL global).
 * Le dump SQL n’est fait qu’une fois par tick (flag shared).
 */
export async function runAutoBackupForOrg(
  store: OpsGateStore,
  orgId: string,
  opts?: { force?: boolean; doSqlDump?: boolean }
): Promise<{
  ran: boolean
  ok: boolean
  detail: string
  files: string[]
}> {
  const org = await store.getOrg(orgId)
  if (!org || org.isPersonal) {
    return { ran: false, ok: false, detail: "org_skip", files: [] }
  }
  const mon = mergeMonitoringSettings(org.monitoring)
  const cfg: AutoSystemBackupSettings = {
    ...DEFAULT_AUTO_SYSTEM_BACKUP,
    ...(mon.autoBackup || {})
  }
  if (!opts?.force && !isAutoBackupDue(cfg)) {
    return { ran: false, ok: true, detail: "not_due", files: [] }
  }

  const dir = resolveBackupDir(cfg.directory)
  try {
    await ensureDir(dir)
  } catch (e) {
    const msg = e instanceof Error ? e.message.slice(0, 160) : String(e)
    await store.updateOrgMonitoring(orgId, {
      autoBackup: {
        ...cfg,
        lastRunAt: new Date().toISOString(),
        lastRunOk: false,
        lastRunDetail: `dossier inaccessible: ${dir} · ${msg}`
      }
    })
    return {
      ran: true,
      ok: false,
      detail: `dossier inaccessible: ${dir}`,
      files: []
    }
  }
  // Fuseau planning org (ex. Asia/Bangkok) pour le nom de fichier — lisible pour l’admin
  const orgTz =
    mon.schedule?.timezone ||
    mon.scheduledLogExport?.timezone ||
    "UTC"
  const ts = stamp(orgTz)
  const files: string[] = []
  const details: string[] = [`dir=${dir}`, `tz=${orgTz}`]
  let ok = true

  // 1) Config org JSON
  try {
    const payload = await buildOrgBackup(store, orgId)
    if (payload) {
      const name = `backup-opsgate-${ts}-org-${org.orgCode || orgId.slice(0, 8)}.json`
      const fp = path.join(dir, name)
      await fs.writeFile(fp, JSON.stringify(payload, null, 2), "utf8")
      files.push(name)
      details.push(`config ${name}`)
    } else {
      ok = false
      details.push("config_export_null")
    }
  } catch (e) {
    ok = false
    details.push(
      `config_err: ${e instanceof Error ? e.message.slice(0, 120) : String(e)}`
    )
  }

  // 2) Dump SQL (une fois par cycle global si demandé)
  if (opts?.doSqlDump !== false) {
    const sqlName = `backup-opsgate-${ts}.sql`
    const sqlPath = path.join(dir, sqlName)
    const dump = await runPgDump(sqlPath)
    details.push(dump.detail)
    if (dump.ok) {
      files.push(sqlName)
      try {
        const sha = await import("node:crypto").then((c) => {
          return fs.readFile(sqlPath).then((buf) =>
            c.createHash("sha256").update(buf).digest("hex")
          )
        })
        const hashName = `${sqlName}.sha256`
        await fs.writeFile(
          path.join(dir, hashName),
          `${sha}  ${sqlName}\n`,
          "utf8"
        )
        files.push(hashName)
      } catch {
        /* ignore hash */
      }
    } else if (!(process.env.DATABASE_URL || "").trim()) {
      // memory store / no DB — config only is OK
    } else {
      ok = false
    }
  }

  await pruneOld(dir, cfg.keepCount)

  const detail = details.join(" · ").slice(0, 500)
  await store.updateOrgMonitoring(orgId, {
    autoBackup: {
      ...cfg,
      lastRunAt: new Date().toISOString(),
      lastRunOk: ok,
      lastRunDetail: detail
    }
  })

  console.log(
    `[opsgate-backup] org=${org.orgCode || orgId} ok=${ok} ${detail}`
  )
  return { ran: true, ok, detail, files }
}

export async function runAutoBackupCronOnce(store: OpsGateStore): Promise<{
  orgs: number
  ran: number
}> {
  if (running) return { orgs: 0, ran: 0 }
  running = true
  let orgs = 0
  let ran = 0
  try {
    const list = await store.listOrgs()
    let sqlDone = false
    for (const org of list) {
      if (org.isPersonal) continue
      orgs++
      try {
        const mon = mergeMonitoringSettings(org.monitoring)
        const cfg = mon.autoBackup || DEFAULT_AUTO_SYSTEM_BACKUP
        if (!cfg.enabled) continue
        if (!isAutoBackupDue(cfg)) continue
        // Un seul pg_dump par tick (système global)
        const r = await runAutoBackupForOrg(store, org.id, {
          doSqlDump: !sqlDone
        })
        if (r.ran) {
          ran++
          if (r.files.some((f) => f.endsWith(".sql"))) sqlDone = true
        }
      } catch (e) {
        console.warn(
          "[opsgate-backup] org fail",
          org.id,
          e instanceof Error ? e.message : e
        )
      }
    }
  } finally {
    running = false
  }
  return { orgs, ran }
}

export function startAutoBackupCron(store: OpsGateStore): void {
  const interval = cronIntervalMs()
  if (interval < 60_000) {
    console.log(
      "[opsgate-api] Auto-backup cron off (set OPSGATE_AUTO_BACKUP_CRON_MINUTES=60)"
    )
    return
  }
  if (timer) clearInterval(timer)
  console.log(
    `[opsgate-api] Auto-backup cron every ${Math.round(interval / 60000)} min (default dir ${defaultBackupDir()})`
  )
  setTimeout(() => void runAutoBackupCronOnce(store), 90_000)
  timer = setInterval(() => {
    void runAutoBackupCronOnce(store)
  }, interval)
}

/** Dossier effectif pour une config (ou défaut global) */
export function getAutoBackupDir(directory?: string | null): string {
  return resolveBackupDir(directory)
}
