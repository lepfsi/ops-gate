/**
 * Audit admin WORM (Write Once Read Many) — chaîne d’intégrité SHA-256.
 *
 * Chaque entrée porte :
 *  - seq : monotony par org
 *  - prevHash : hash de l’entrée précédente (ou GENESIS)
 *  - entryHash : SHA-256(prevHash|seq|id|orgId|action|detail|adminId|createdAt)
 *
 * Objectif : détecter altération / suppression au milieu de la chaîne.
 * La rétention légale empêche la purge des audits avant N jours (voir monitoring).
 */
import { createHash } from "node:crypto"

export const AUDIT_GENESIS = "GENESIS"
export const DEFAULT_LEGAL_RETENTION_DAYS = 365
export const MIN_LEGAL_RETENTION_DAYS = 90
export const MAX_LEGAL_RETENTION_DAYS = 3650

export function clampLegalRetentionDays(n: unknown): number {
  const v = typeof n === "number" ? n : Number(n)
  if (!Number.isFinite(v)) return DEFAULT_LEGAL_RETENTION_DAYS
  return Math.min(
    MAX_LEGAL_RETENTION_DAYS,
    Math.max(MIN_LEGAL_RETENTION_DAYS, Math.floor(v))
  )
}

export function computeAuditEntryHash(input: {
  prevHash: string
  seq: number
  id: string
  orgId: string
  action: string
  detail?: string | null
  adminId?: string | null
  createdAt: string
}): string {
  const payload = [
    input.prevHash || AUDIT_GENESIS,
    String(input.seq),
    input.id,
    input.orgId,
    input.action,
    input.detail || "",
    input.adminId || "",
    input.createdAt
  ].join("|")
  return createHash("sha256").update(payload, "utf8").digest("hex")
}

export type AuditChainRow = {
  id: string
  orgId: string
  action: string
  detail?: string | null
  adminId?: string | null
  createdAt: string
  seq?: number | null
  entryHash?: string | null
  prevHash?: string | null
}

export type AuditIntegrityReport = {
  ok: boolean
  checked: number
  with_hash: number
  without_hash: number
  broken_at_id?: string
  broken_reason?: string
  tip?: string
}

/**
 * Vérifie la chaîne dans l’ordre chronologique (seq ASC ou createdAt ASC).
 * Les entrées sans hash (legacy) sont comptées mais n’invalident pas la chaîne
 * tant qu’aucune entrée hashée n’est corrompue après le premier hash.
 */
export function verifyAuditChain(rowsAsc: AuditChainRow[]): AuditIntegrityReport {
  let checked = 0
  let withHash = 0
  let withoutHash = 0
  let expectedPrev = AUDIT_GENESIS
  let lastSeq = 0
  let sawHashed = false

  for (const row of rowsAsc) {
    checked++
    const has =
      typeof row.entryHash === "string" &&
      row.entryHash.length === 64 &&
      typeof row.seq === "number"
    if (!has) {
      withoutHash++
      continue
    }
    withHash++
    if (!sawHashed) {
      // Première entrée hashée : prev peut être GENESIS même s’il y a du legacy avant
      expectedPrev = row.prevHash || AUDIT_GENESIS
      lastSeq = (row.seq || 1) - 1
      sawHashed = true
    }
    if (row.prevHash !== expectedPrev) {
      return {
        ok: false,
        checked,
        with_hash: withHash,
        without_hash: withoutHash,
        broken_at_id: row.id,
        broken_reason: "prev_hash_mismatch",
        tip: "Une entrée a été altérée ou réordonnée (prev_hash)."
      }
    }
    if (typeof row.seq === "number" && row.seq !== lastSeq + 1 && sawHashed && lastSeq > 0) {
      // seq doit être strictement croissant de 1 après le premier
      if (row.seq <= lastSeq) {
        return {
          ok: false,
          checked,
          with_hash: withHash,
          without_hash: withoutHash,
          broken_at_id: row.id,
          broken_reason: "seq_not_monotonic",
          tip: "Séquence d’audit non monotone — possible suppression/réécriture."
        }
      }
    }
    const recomputed = computeAuditEntryHash({
      prevHash: row.prevHash || AUDIT_GENESIS,
      seq: row.seq!,
      id: row.id,
      orgId: row.orgId,
      action: row.action,
      detail: row.detail,
      adminId: row.adminId,
      createdAt: row.createdAt
    })
    if (recomputed !== row.entryHash) {
      return {
        ok: false,
        checked,
        with_hash: withHash,
        without_hash: withoutHash,
        broken_at_id: row.id,
        broken_reason: "entry_hash_mismatch",
        tip: "Contenu d’une entrée modifié après écriture (WORM cassé)."
      }
    }
    expectedPrev = row.entryHash!
    lastSeq = row.seq!
  }

  return {
    ok: true,
    checked,
    with_hash: withHash,
    without_hash: withoutHash,
    tip:
      withoutHash > 0
        ? `${withoutHash} entrée(s) legacy sans sceau (antérieures au mode WORM).`
        : "Chaîne d’intégrité valide."
  }
}
