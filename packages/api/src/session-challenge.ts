/**
 * Défis de session concurrente :
 * - Un 2ᵉ login crée un challenge (10 s).
 * - La session ouverte accepte / refuse.
 * - Sans réponse → timeout = acceptation auto (déconnexion de l’ancienne).
 * - Le demandeur peut aussi ouvrir une session lecture seule sans challenge.
 */
import { randomBytes } from "node:crypto"

export type ChallengeStatus =
  | "pending"
  | "accepted"
  | "refused"
  | "timeout"
  | "claimed"
  | "expired"

export type SessionChallenge = {
  id: string
  orgId: string
  adminId: string
  adminEmail: string
  /** IP ou hint demandeur (affiché à la session ouverte) */
  requesterHint: string
  status: ChallengeStatus
  createdAt: number
  /** Après cette date, auto-accept (timeout) si encore pending */
  deadlineAt: number
  /** Expiration dure (plus de claim possible) */
  expiresAt: number
}

const CHALLENGES = new Map<string, SessionChallenge>()
const TIMEOUT_MS = 10_000
const HARD_EXPIRE_MS = 90_000

function newId(): string {
  return `sch_${randomBytes(18).toString("hex")}`
}

function gc(): void {
  const now = Date.now()
  for (const [id, ch] of CHALLENGES) {
    if (now > ch.expiresAt + 30_000) CHALLENGES.delete(id)
  }
}

/** Crée un challenge pending pour un admin qui a déjà une session active. */
export function createSessionChallenge(opts: {
  orgId: string
  adminId: string
  adminEmail: string
  requesterHint?: string
}): SessionChallenge {
  gc()
  // Annuler d’anciens challenges pending du même admin
  for (const [id, ch] of CHALLENGES) {
    if (
      ch.adminId === opts.adminId &&
      (ch.status === "pending" || ch.status === "accepted" || ch.status === "timeout")
    ) {
      if (ch.status === "pending") {
        ch.status = "expired"
      }
      // laisser les acceptés non claimés un moment
      if (ch.status === "accepted" || ch.status === "timeout") {
        /* keep until claim/expire */
      } else {
        CHALLENGES.delete(id)
      }
    }
  }
  const now = Date.now()
  const ch: SessionChallenge = {
    id: newId(),
    orgId: opts.orgId,
    adminId: opts.adminId,
    adminEmail: opts.adminEmail,
    requesterHint: (opts.requesterHint || "nouvelle connexion").slice(0, 120),
    status: "pending",
    createdAt: now,
    deadlineAt: now + TIMEOUT_MS,
    expiresAt: now + HARD_EXPIRE_MS
  }
  CHALLENGES.set(ch.id, ch)

  // Auto-timeout → acceptation (libère la session pour le demandeur)
  setTimeout(() => {
    const cur = CHALLENGES.get(ch.id)
    if (!cur || cur.status !== "pending") return
    cur.status = "timeout"
  }, TIMEOUT_MS)

  return ch
}

export function getSessionChallenge(id: string): SessionChallenge | undefined {
  const ch = CHALLENGES.get(id)
  if (!ch) return undefined
  const now = Date.now()
  if (now > ch.expiresAt && ch.status !== "claimed") {
    ch.status = "expired"
  }
  // Lazy timeout si le timer a loupé (reload process)
  if (ch.status === "pending" && now >= ch.deadlineAt) {
    ch.status = "timeout"
  }
  return ch
}

/** Challenge pending pour un admin (session ouverte) */
export function getPendingChallengeForAdmin(
  adminId: string
): SessionChallenge | undefined {
  const now = Date.now()
  for (const ch of CHALLENGES.values()) {
    if (ch.adminId !== adminId) continue
    if (now > ch.expiresAt) {
      if (ch.status !== "claimed") ch.status = "expired"
      continue
    }
    if (ch.status === "pending") {
      if (now >= ch.deadlineAt) {
        ch.status = "timeout"
        continue
      }
      return ch
    }
  }
  return undefined
}

export function respondSessionChallenge(
  id: string,
  action: "accept" | "refuse",
  responderAdminId: string
):
  | { ok: true; challenge: SessionChallenge }
  | { ok: false; error: string } {
  const ch = getSessionChallenge(id)
  if (!ch) return { ok: false, error: "challenge_not_found" }
  if (ch.adminId !== responderAdminId) {
    return { ok: false, error: "challenge_forbidden" }
  }
  if (ch.status === "timeout") {
    // Déjà auto-accepté : l’UI peut afficher déconnexion
    return { ok: true, challenge: ch }
  }
  if (ch.status !== "pending") {
    return { ok: false, error: "challenge_not_pending" }
  }
  ch.status = action === "accept" ? "accepted" : "refused"
  return { ok: true, challenge: ch }
}

/** Marque claimé après émission de session (une seule fois). */
export function markChallengeClaimed(id: string): SessionChallenge | undefined {
  const ch = getSessionChallenge(id)
  if (!ch) return undefined
  if (ch.status !== "accepted" && ch.status !== "timeout") return undefined
  ch.status = "claimed"
  return ch
}

export function publicChallengeView(ch: SessionChallenge) {
  const now = Date.now()
  return {
    challenge_id: ch.id,
    status: ch.status,
    admin_email: ch.adminEmail,
    requester_hint: ch.requesterHint,
    seconds_left: Math.max(0, Math.ceil((ch.deadlineAt - now) / 1000)),
    deadline_at: ch.deadlineAt,
    created_at: ch.createdAt
  }
}

export const SESSION_CHALLENGE_TIMEOUT_SEC = Math.round(TIMEOUT_MS / 1000)
