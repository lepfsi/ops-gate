/**
 * Navigation dossiers serveur (backup auto) — réservé admin principal.
 * Liste uniquement des répertoires (pas de lecture de fichiers).
 */
import { constants as fsConstants, promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"

const MAX_PATH = 512
const MAX_ENTRIES = 400

export type FsRoot = {
  path: string
  label: string
  kind: "drive" | "home" | "cwd" | "unc" | "root"
  reachable: boolean
}

export type FsListResult = {
  ok: boolean
  path: string
  parent: string | null
  entries: Array<{ name: string; path: string }>
  error?: string
}

export type FsVerifyResult = {
  ok: boolean
  path: string
  exists: boolean
  is_directory: boolean
  readable: boolean
  writable: boolean
  error?: string
  /** Chemin normalisé résolu */
  resolved?: string
}

function sanitizePathInput(raw: string): string | null {
  const s = String(raw || "").trim().slice(0, MAX_PATH)
  if (!s) return null
  // Interdire caractères de contrôle
  if (/[\x00-\x1f]/.test(s)) return null
  return s
}

/** Normalise un chemin utilisateur (Windows drive / UNC / Unix). */
export function normalizeUserPath(raw: string): string | null {
  const s = sanitizePathInput(raw)
  if (!s) return null
  // UNC \\server\share
  if (s.startsWith("\\\\") || s.startsWith("//")) {
    const unc = s.replace(/\//g, "\\")
    return path.normalize(unc)
  }
  // Windows drive D: or D:\
  if (/^[a-zA-Z]:$/.test(s)) {
    return path.normalize(s + "\\")
  }
  if (/^[a-zA-Z]:[\\/]/.test(s)) {
    return path.normalize(s)
  }
  if (path.isAbsolute(s)) {
    return path.normalize(s)
  }
  // Relatif → ancré cwd
  return path.resolve(process.cwd(), s)
}

async function pathReachable(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

/** Racines disponibles sur la machine où tourne l’API. */
export async function listFsRoots(): Promise<FsRoot[]> {
  const roots: FsRoot[] = []
  const platform = os.platform()

  if (platform === "win32") {
    // Lettres de lecteur A–Z
    const letters = "CDEFGHIJKLMNOPQRSTUVWXYZAB".split("")
    await Promise.all(
      letters.map(async (letter) => {
        const p = `${letter}:\\`
        const reachable = await pathReachable(p)
        if (reachable) {
          roots.push({
            path: p,
            label: `${letter}:`,
            kind: "drive",
            reachable: true
          })
        }
      })
    )
    // Trier C, D, E…
    roots.sort((a, b) => a.path.localeCompare(b.path))
  } else {
    roots.push({
      path: "/",
      label: "/",
      kind: "root",
      reachable: await pathReachable("/")
    })
  }

  // Raccourcis utiles
  const home = os.homedir()
  if (home) {
    const ok = await pathReachable(home)
    if (ok && !roots.some((r) => r.path === path.normalize(home))) {
      roots.push({
        path: path.normalize(home),
        label: platform === "win32" ? "Dossier utilisateur" : "Home",
        kind: "home",
        reachable: true
      })
    }
  }
  const cwd = process.cwd()
  if (cwd && !roots.some((r) => path.normalize(r.path) === path.normalize(cwd))) {
    roots.push({
      path: path.normalize(cwd),
      label: "Répertoire API (cwd)",
      kind: "cwd",
      reachable: true
    })
  }

  return roots
}

function parentPath(p: string): string | null {
  const norm = path.normalize(p)
  // Windows root C:\
  if (/^[a-zA-Z]:\\?$/i.test(norm.replace(/\\+$/, "") + "\\") || /^[a-zA-Z]:\\$/i.test(norm)) {
    const drive = norm.slice(0, 2) + "\\"
    if (path.normalize(norm) === path.normalize(drive)) return null
  }
  if (norm === path.sep || norm === "/") return null
  // UNC root \\server\share
  const unc = norm.match(/^\\\\[^\\]+\\[^\\]+\\?$/)
  if (unc) return null

  const parent = path.dirname(norm)
  if (parent === norm) return null
  return parent
}

/** Liste les sous-dossiers d’un chemin (pas les fichiers). */
export async function listFsDirectories(rawPath: string): Promise<FsListResult> {
  const resolved = normalizeUserPath(rawPath)
  if (!resolved) {
    return {
      ok: false,
      path: "",
      parent: null,
      entries: [],
      error: "invalid_path"
    }
  }

  try {
    const st = await fs.stat(resolved)
    if (!st.isDirectory()) {
      return {
        ok: false,
        path: resolved,
        parent: parentPath(resolved),
        entries: [],
        error: "not_a_directory"
      }
    }
  } catch (e) {
    return {
      ok: false,
      path: resolved,
      parent: parentPath(resolved),
      entries: [],
      error: e instanceof Error ? e.message : "unreachable"
    }
  }

  try {
    const names = await fs.readdir(resolved, { withFileTypes: true })
    const entries: Array<{ name: string; path: string }> = []
    for (const d of names) {
      if (entries.length >= MAX_ENTRIES) break
      // Skip hidden / system noise lightly
      if (d.name === "." || d.name === "..") continue
      if (d.name.startsWith("$")) continue // $Recycle.Bin, System Volume Information-ish
      let isDir = d.isDirectory()
      if (!isDir && d.isSymbolicLink()) {
        try {
          const st = await fs.stat(path.join(resolved, d.name))
          isDir = st.isDirectory()
        } catch {
          isDir = false
        }
      }
      if (!isDir) continue
      entries.push({
        name: d.name,
        path: path.join(resolved, d.name)
      })
    }
    entries.sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
    )
    return {
      ok: true,
      path: resolved,
      parent: parentPath(resolved),
      entries
    }
  } catch (e) {
    return {
      ok: false,
      path: resolved,
      parent: parentPath(resolved),
      entries: [],
      error: e instanceof Error ? e.message : "readdir_failed"
    }
  }
}

/**
 * Vérifie qu’un chemin est accessible en écriture.
 * Crée le dossier s’il n’existe pas (mkdir recursive) si createIfMissing.
 */
export async function verifyFsDirectory(
  rawPath: string,
  opts?: { createIfMissing?: boolean }
): Promise<FsVerifyResult> {
  const resolved = normalizeUserPath(rawPath)
  if (!resolved) {
    return {
      ok: false,
      path: "",
      exists: false,
      is_directory: false,
      readable: false,
      writable: false,
      error: "invalid_path"
    }
  }

  let exists = false
  let is_directory = false
  try {
    const st = await fs.stat(resolved)
    exists = true
    is_directory = st.isDirectory()
    if (!is_directory) {
      return {
        ok: false,
        path: resolved,
        resolved,
        exists: true,
        is_directory: false,
        readable: false,
        writable: false,
        error: "not_a_directory"
      }
    }
  } catch {
    exists = false
    if (opts?.createIfMissing) {
      try {
        await fs.mkdir(resolved, { recursive: true })
        exists = true
        is_directory = true
      } catch (e) {
        return {
          ok: false,
          path: resolved,
          resolved,
          exists: false,
          is_directory: false,
          readable: false,
          writable: false,
          error:
            e instanceof Error
              ? `create_failed: ${e.message.slice(0, 160)}`
              : "create_failed"
        }
      }
    } else {
      return {
        ok: false,
        path: resolved,
        resolved,
        exists: false,
        is_directory: false,
        readable: false,
        writable: false,
        error: "not_found"
      }
    }
  }

  let readable = false
  let writable = false
  try {
    await fs.access(resolved, fsConstants.R_OK)
    readable = true
  } catch {
    readable = false
  }

  // Test d’écriture réel (plus fiable que access W_OK sur Windows/NAS)
  const probe = path.join(
    resolved,
    `.opsgate-write-probe-${Date.now().toString(36)}.tmp`
  )
  try {
    await fs.writeFile(probe, "ok", "utf8")
    await fs.unlink(probe)
    writable = true
  } catch (e) {
    writable = false
    return {
      ok: false,
      path: resolved,
      resolved,
      exists: true,
      is_directory: true,
      readable,
      writable: false,
      error:
        e instanceof Error
          ? `not_writable: ${e.message.slice(0, 160)}`
          : "not_writable"
    }
  }

  return {
    ok: readable && writable,
    path: resolved,
    resolved,
    exists: true,
    is_directory: true,
    readable,
    writable
  }
}
