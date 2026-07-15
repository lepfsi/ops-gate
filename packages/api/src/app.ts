import { Hono } from "hono"
import { cors } from "hono/cors"
import { secureHeaders } from "hono/secure-headers"

import type { DetectionRule } from "@opsgate/engine"

import {
  getVendorRecoveryHash,
  hashManagementPassword,
  newToken,
  PRINCIPAL_DEFAULT_PASSWORD,
  PRINCIPAL_SETUP_EMAIL,
  VENDOR_RECOVERY_PASSWORD
} from "./crypto"
import { toPayload, validateRules } from "./rules-pack"
import { getPublicKeyPem, getPublicKeySpkiBase64 } from "./signing"
import { getStore, store } from "./store"
import type {
  AdminPermission,
  DetectionEventInput,
  OrgAdmin,
  Policy
} from "./types"
import { ALL_ADMIN_PERMISSIONS } from "./types"

/** Vendor recovery uniquement si last sync > 2h (sync agent ~15 min) */
export const VENDOR_RECOVERY_OFFLINE_MS = 2 * 60 * 60 * 1000

type AgentVars = {
  Variables: {
    agentId: string
    orgId: string
  }
}

type AdminVars = {
  Variables: {
    adminId: string
    orgId: string
    admin: OrgAdmin
  }
}

export function createApp() {
  const app = new Hono()

  app.use("*", cors())
  app.use("*", secureHeaders())

  app.get("/", (c) =>
    c.json({
      name: "OpsGate API",
      version: "0.3.0",
      pr: "PR6-v1.1",
      version_product: "1.2.0",
      docs: "docs/architecture/PLATFORM-v1.1.md",
      health: "/health",
      v1: "/v1",
      store: getStore().kind
    })
  )

  app.get("/health", (c) =>
    c.json({
      ok: true,
      service: "opsgate-api",
      version: "1.2.0",
      ts: new Date().toISOString(),
      store: getStore().kind,
      features: [
        "enroll",
        "config",
        "events",
        "rulepack-publish",
        "postgres-or-memory",
        "ed25519-pack-signing",
        "force-sync",
        "policy-profiles",
        "vendor-recovery-offline-only",
        "password-otp-reset-principal",
        "console-auth"
      ]
    })
  )

  /** Clé publique pour vérifier les RulePacks côté agent */
  app.get("/v1/crypto/public-key", (c) =>
    c.json({
      alg: "Ed25519",
      encoding: "spki-base64",
      public_key_spki_base64: getPublicKeySpkiBase64(),
      public_key_pem: getPublicKeyPem()
    })
  )

  const v1 = new Hono<AgentVars>()

  v1.post("/enroll", async (c) => {
    let body: {
      org_code?: string
      /** Usage personnel → org PERSONAL */
      personal?: boolean
      device_label?: string
      host_name?: string
      app_version?: string
      /** Clé licence personnelle (ex: OPS-PERSONAL-DEMO-2026) */
      personal_license_key?: string
      /** Empreinte stable extension (anti-doublon re-enroll) */
      device_fingerprint?: string
    }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: "invalid_json" }, 400)
    }

    const orgCode = body.personal
      ? "PERSONAL"
      : body.org_code?.trim() || ""
    if (!orgCode) return c.json({ error: "org_code_required" }, 400)

    const org = await store.findOrgByCode(orgCode)
    if (!org) return c.json({ error: "org_not_found" }, 404)

    if (org.isPersonal && !body.personal_license_key?.trim()) {
      return c.json(
        {
          error: "personal_license_key_required",
          message:
            "Usage personnel : saisissez une clé de licence (démo : OPS-PERSONAL-DEMO-2026)."
        },
        400
      )
    }

    const policy = await store.getPolicy(org.id)
    if (!policy) return c.json({ error: "policy_missing" }, 500)

    const agentToken = newToken()
    const agent = await store.enrollAgent({
      orgId: org.id,
      token: agentToken,
      deviceLabel: body.device_label,
      hostName: body.host_name,
      appVersion: body.app_version,
      personalLicenseKey: body.personal_license_key,
      deviceFingerprint: body.device_fingerprint
    })

    if (org.isPersonal && !agent.licenseAssigned) {
      return c.json(
        {
          error: "invalid_personal_license_key",
          message:
            "Clé de licence invalide. Démo : OPS-PERSONAL-DEMO-2026 ou OPS-HOME-TRIAL."
        },
        400
      )
    }

    const etag = policyEtag(policy.version, policy.rulesPackVersion)

    return c.json({
      agent_id: agent.id,
      agent_token: agentToken,
      org_id: org.id,
      org_name: org.name,
      mode: org.modeDefault,
      personal: !!org.isPersonal,
      policy_etag: etag,
      rules_pack_version: policy.rulesPackVersion,
      replaced: !!agent.replaced,
      license_assigned: agent.licenseAssigned,
      message: agent.replaced
        ? "Existing installation re-enrolled (same fingerprint) — previous token revoked."
        : org.isPersonal
          ? "Personal account enrolled."
          : "Store agent_token securely. It is shown only once."
    })
  })

  v1.use("/agents/*", async (c, next) => {
    const header = c.req.header("Authorization") || ""
    const match = header.match(/^Bearer\s+(.+)$/i)
    if (!match) return c.json({ error: "unauthorized" }, 401)
    const agent = await store.resolveAgentByToken(match[1].trim())
    if (!agent) return c.json({ error: "invalid_token" }, 401)
    c.set("agentId", agent.id)
    c.set("orgId", agent.orgId)
    await next()
  })

  /**
   * Désenrôlement agent — audit exit_actor (admin1 / admin2 / vendor_recovery / free)
   * puis révocation token.
   */
  v1.post("/agents/me/revoke", async (c) => {
    const header = c.req.header("Authorization") || ""
    const match = header.match(/^Bearer\s+(.+)$/i)
    if (!match) return c.json({ error: "unauthorized" }, 401)
    const token = match[1].trim()
    const agent = await store.resolveAgentByToken(token)
    if (!agent) return c.json({ error: "invalid_token" }, 401)

    let body: {
      exit_actor?: "admin" | "vendor_recovery" | "free"
      admin_id?: string
      admin_label?: string
      recovery_code_id?: string
    } = {}
    try {
      body = await c.req.json()
    } catch {
      body = {}
    }

    const exit = {
      type: (body.exit_actor || "free") as "admin" | "vendor_recovery" | "free",
      admin_id: body.admin_id,
      admin_label: body.admin_label
    }

    if (
      exit.type === "vendor_recovery" &&
      body.recovery_code_id?.trim()
    ) {
      const ok = await store.consumeRecoveryCode(
        agent.orgId,
        body.recovery_code_id.trim(),
        agent.id
      )
      if (ok) {
        await store.appendAdminAudit({
          orgId: agent.orgId,
          action: "recovery_code_consumed",
          detail: `Code recovery consommé par agent ${agent.deviceLabel || agent.id.slice(0, 12)}…`,
          meta: {
            recovery_code_id: body.recovery_code_id,
            agent_id: agent.id
          }
        })
      }
    }

    const result = await store.recordUnenrollAndRevoke(
      agent.orgId,
      agent.id,
      token,
      exit
    )
    return c.json({
      ok: result.ok,
      agent_id: agent.id,
      event_id: result.event_id,
      exit_actor:
        exit.type === "admin"
          ? `admin:${exit.admin_label || exit.admin_id || "unknown"}`
          : exit.type
    })
  })

  v1.get("/agents/me/config", async (c) => {
    const orgId = c.get("orgId")
    const agentId = c.get("agentId")
    const org = await store.getOrg(orgId)
    // Garantit un pack actif (évite enrolled_but_sync_failed:http_404)
    let pack = await store.getActivePack(orgId)
    if (!pack) {
      pack = await store.ensureDefaultPack(orgId)
    }
    const effectiveBundle = await store.getEffectivePolicyForAgent(
      orgId,
      agentId
    )
    if (!org) {
      return c.json({ error: "org_not_found" }, 404)
    }
    if (!pack) {
      return c.json({ error: "no_rules_pack" }, 404)
    }
    if (!effectiveBundle) {
      return c.json({ error: "policy_not_found" }, 404)
    }

    const { policy, profile, effective, admins, licensed } = effectiveBundle
    // Grace licence 5 min
    const agent = await store
      .listAgents(orgId)
      .then((list) => list.find((a) => a.id === agentId))
    let unlicensedSince = agent?.unlicensedSince
    if (licensed) {
      unlicensedSince = undefined
      // clear on agent if store supports mutation via assign
      if (agent && agent.unlicensedSince) {
        agent.unlicensedSince = undefined
      }
    } else if (!unlicensedSince) {
      unlicensedSince = new Date().toISOString()
      if (agent) agent.unlicensedSince = unlicensedSince
    }
    const { LICENSE_GRACE_MS } = await import("./summary-helpers")
    const graceMs = LICENSE_GRACE_MS
    const unlicensedAge = unlicensedSince
      ? Date.now() - new Date(unlicensedSince).getTime()
      : 0
    const inGrace = !licensed && unlicensedAge < graceMs
    const securityActive = licensed || inGrace

    const payload = toPayload(pack)
    const etag = policyEtag(
      `${policy.version}.${policy.configEpoch}.${profile?.id || "default"}.${admins.length}.${licensed ? 1 : 0}`,
      pack.version
    )
    const inm = c.req.header("If-None-Match")
    if (inm && inm === etag) {
      return c.body(null, 304)
    }

    c.header("ETag", etag)
    c.header("Cache-Control", "private, max-age=30")

    // require_unenroll_password = policy/profil le demande ET au moins un admin hash
    const requireUnenroll =
      !!effective.protectUnenroll && admins.length > 0

    return c.json({
      etag,
      org: {
        id: org.id,
        name: org.name,
        mode: org.modeDefault,
        event_payload_policy: org.eventPayloadPolicy,
        personal: !!org.isPersonal
      },
      policy: {
        id: policy.id,
        version: policy.version,
        config_epoch: policy.configEpoch,
        default_action: effective.defaultAction,
        enabled_hosts: effective.enabledHosts,
        scan_uploads: effective.scanUploads,
        event_reporting: effective.eventReporting,
        rules_pack_version: pack.version,
        protect_unenroll: effective.protectUnenroll,
        /** Messages UX (merge defaults côté agent) */
        user_messages: effective.userMessages || policy.userMessages || {},
        require_unenroll_password: requireUnenroll,
        /** Admins avec droit unenroll (hashes) */
        admin_credentials: requireUnenroll ? admins : [],
        management_password_hash: requireUnenroll
          ? admins[0]?.password_hash || policy.managementPasswordHash || ""
          : "",
        /**
         * Recovery vendor legacy + pool one-time (hashes) — offline ≥ 2h.
         */
        recovery_password_hash: getVendorRecoveryHash(),
        recovery_offline_after_ms: VENDOR_RECOVERY_OFFLINE_MS,
        recovery_codes: await store.getActiveRecoveryCodeHashes(org.id),
        profile_id: profile?.id || null,
        profile_name: profile?.name || null,
        department: profile?.department || null,
        /** Licence */
        licensed,
        unlicensed_since: unlicensedSince || null,
        license_grace_ms: graceMs,
        security_active: securityActive,
        license_status: licensed
          ? "licensed"
          : inGrace
            ? "grace"
            : "unlicensed",
        updated_at: policy.updatedAt
      },
      rules_pack: payload
    })
  })

  v1.post("/events/batch", async (c) => {
    const header = c.req.header("Authorization") || ""
    const match = header.match(/^Bearer\s+(.+)$/i)
    if (!match) return c.json({ error: "unauthorized" }, 401)
    const agent = await store.resolveAgentByToken(match[1].trim())
    if (!agent) return c.json({ error: "invalid_token" }, 401)

    let body: { events?: DetectionEventInput[] }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: "invalid_json" }, 400)
    }

    const events = body.events || []
    if (!Array.isArray(events) || events.length === 0) {
      return c.json({ error: "events_required" }, 400)
    }
    if (events.length > 50) {
      return c.json({ error: "batch_too_large", max: 50 }, 400)
    }

    // Enrichir avec label appareil agent si manquant
    const enriched = events.map((ev) => ({
      ...ev,
      device_label: ev.device_label || agent.deviceLabel
    }))

    const cats = await orgLogCategories(agent.orgId)
    if (!cats.detectionEvents) {
      return c.json({
        ok: true,
        accepted: 0,
        skipped: true,
        reason: "log_category_detection_disabled"
      })
    }
    const result = await store.appendEvents(agent.orgId, agent.id, enriched)
    return c.json({ ok: true, ...result })
  })

  async function demoOrg() {
    return store.findOrgByCode("DEMO-OPSGATE")
  }

  function publicAdminView(a: OrgAdmin) {
    return {
      id: a.id,
      label: a.label,
      email: a.email,
      is_principal: a.isPrincipal,
      permissions: a.isPrincipal ? ALL_ADMIN_PERMISSIONS : a.permissions,
      active: a.active,
      must_change_password: !!a.mustChangePassword,
      locked: !!a.lockedAt,
      locked_at: a.lockedAt || null,
      failed_login_count: a.failedLoginCount || 0,
      created_at: a.createdAt,
      updated_at: a.updatedAt
    }
  }

  /** Events console en snake_case stable (mask_send / send_anyway / cancel…) */
  function publicEvent(e: import("./types").StoredEvent) {
    return {
      id: e.id,
      org_id: e.orgId,
      agent_id: e.agentId ?? null,
      client_event_id: e.client_event_id,
      ts: e.ts,
      source: e.source,
      hostname: e.hostname,
      decision: e.decision,
      detection_count: e.detection_count,
      highest_severity: e.highest_severity,
      rule_ids: e.rule_ids || [],
      types: e.types || [],
      masked: e.masked ?? null,
      file_names: e.file_names ?? null,
      device_label: e.device_label ?? null,
      exit_actor: e.exit_actor ?? null,
      exit_admin_id: e.exit_admin_id ?? null,
      exit_admin_label: e.exit_admin_label ?? null,
      schema_version: e.schema_version,
      received_at: e.receivedAt
    }
  }

  async function orgLogCategories(orgId: string) {
    const { mergeMonitoringSettings, DEFAULT_LOG_CATEGORIES } = await import(
      "./types"
    )
    const org = await store.getOrg(orgId)
    const mon = mergeMonitoringSettings(org?.monitoring)
    return mon.logCategories || DEFAULT_LOG_CATEGORIES
  }

  function isLoginAuditAction(
    action: import("./types").AdminAuditAction
  ): boolean {
    return (
      action === "login" ||
      action === "logout" ||
      action === "logout_idle" ||
      action === "login_failed" ||
      action === "login_brute_force"
    )
  }

  function isAgentLifecycleAction(
    action: import("./types").AdminAuditAction
  ): boolean {
    return (
      action === "agent_revoke" ||
      action === "agent_assign" ||
      action === "agent_license" ||
      action === "agent_merge" ||
      action === "recovery_code_consumed"
    )
  }

  async function audit(
    gate: { admin: OrgAdmin; orgId: string },
    action: import("./types").AdminAuditAction,
    detail: string,
    meta?: Record<string, unknown>
  ) {
    const cats = await orgLogCategories(gate.orgId)
    if (isLoginAuditAction(action) && !cats.adminLogin) return
    if (isAgentLifecycleAction(action) && !cats.agentLifecycle) return
    if (
      !isLoginAuditAction(action) &&
      !isAgentLifecycleAction(action) &&
      !cats.adminAudit
    ) {
      return
    }
    await store.appendAdminAudit({
      orgId: gate.orgId,
      adminId: gate.admin.id,
      adminEmail: gate.admin.email,
      adminLabel: gate.admin.label,
      action,
      detail,
      meta
    })
  }

  function adminHas(
    admin: OrgAdmin,
    perm: AdminPermission
  ): boolean {
    if (admin.isPrincipal) return true
    return admin.permissions.includes(perm)
  }

  /** Auth session Bearer ogs_… (console) */
  async function requireConsoleAuth(
    c: {
      req: { header: (n: string) => string | undefined }
    },
    perm?: AdminPermission
  ): Promise<
    | { ok: true; admin: OrgAdmin; orgId: string }
    | { ok: false; status: 401 | 403; error: string }
  > {
    const header = c.req.header("Authorization") || ""
    const match = header.match(/^Bearer\s+(.+)$/i)
    // Dev bypass legacy (désactivable)
    if (
      !match &&
      c.req.header("X-OpsGate-Dev-Admin") === "demo" &&
      process.env.OPSGATE_ALLOW_DEV_ADMIN === "1"
    ) {
      const org = await demoOrg()
      const principal = org
        ? await store.getPrincipalAdmin(org.id)
        : undefined
      if (principal && org) {
        return { ok: true, admin: principal, orgId: org.id }
      }
    }
    if (!match) return { ok: false, status: 401, error: "unauthorized" }
    const resolved = await store.resolveAdminSession(match[1].trim())
    if (!resolved) return { ok: false, status: 401, error: "session_invalid" }
    if (perm && !adminHas(resolved.admin, perm)) {
      return { ok: false, status: 403, error: "forbidden_permission" }
    }
    return {
      ok: true,
      admin: resolved.admin,
      orgId: resolved.session.orgId
    }
  }

  /** Login console */
  v1.post("/auth/login", async (c) => {
    let body: { email?: string; password?: string; force?: boolean }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: "invalid_json" }, 400)
    }
    if (!body.email || !body.password) {
      return c.json({ error: "email_password_required" }, 400)
    }
    const emailKey = body.email.trim().toLowerCase()
    // Compte déjà verrouillé ?
    try {
      const hits = await store.findAdminsByEmail(emailKey)
      const locked = hits.find((a) => a.lockedAt)
      if (locked) {
        return c.json(
          {
            error: "account_locked",
            message:
              "Compte verrouillé après trop d'échecs d'authentification. Un administrateur principal doit le déverrouiller."
          },
          403
        )
      }
    } catch {
      /* ignore */
    }
    const result = await store.createAdminSession(body.email, body.password, {
      force: !!body.force
    })
    if (!result.ok) {
      if (result.error === "invalid_credentials") {
        try {
          const hits = await store.findAdminsByEmail(emailKey)
          const hit = hits[0]
          if (hit) {
            const org = await store.getOrg(hit.orgId)
            const { mergeMonitoringSettings } = await import("./types")
            const mon = mergeMonitoringSettings(org?.monitoring)
            const thr =
              mon.notifications?.loginBruteForce !== false
                ? mon.notifications?.loginBruteForceThreshold ?? 5
                : 999
            const rec = await store.recordAdminLoginFailure(hit.id, thr)
            const cats = mon.logCategories
            if (cats?.adminLogin !== false) {
              await store.appendAdminAudit({
                orgId: hit.orgId,
                adminId: hit.id,
                adminEmail: hit.email,
                adminLabel: hit.label,
                action: "login_failed",
                detail: `Échec authentification (${rec.count}x)`
              })
            }
            if (rec.locked) {
              if (cats?.adminLogin !== false) {
                await store.appendAdminAudit({
                  orgId: hit.orgId,
                  adminId: hit.id,
                  adminEmail: hit.email,
                  adminLabel: hit.label,
                  action: "account_locked",
                  detail: `Compte verrouillé après ${rec.count} échecs (seuil ${thr})`
                })
              }
              return c.json(
                {
                  error: "account_locked",
                  remaining_attempts: 0,
                  message:
                    "Compte verrouillé après trop d'échecs. Un administrateur principal doit le déverrouiller."
                },
                403
              )
            }
            const remaining = Math.max(0, thr - rec.count)
            if (
              mon.notifications?.loginBruteForce !== false &&
              rec.count >= thr &&
              cats?.adminLogin !== false
            ) {
              await store.appendAdminAudit({
                orgId: hit.orgId,
                adminId: hit.id,
                adminEmail: hit.email,
                adminLabel: hit.label,
                action: "login_brute_force",
                detail: `Alerte: ${rec.count} échecs (seuil ${thr})`
              })
            }
            return c.json(
              {
                error: "invalid_credentials",
                remaining_attempts: remaining,
                message:
                  remaining > 0
                    ? `Invalid. Il vous reste ${remaining} essai${remaining > 1 ? "s" : ""}.`
                    : "Invalid."
              },
              401
            )
          }
        } catch {
          /* ignore */
        }
        return c.json(
          {
            error: "invalid_credentials",
            message: "Identifiants invalides."
          },
          401
        )
      }
      if (result.error === "account_locked") {
        return c.json(
          {
            error: "account_locked",
            remaining_attempts: 0,
            message:
              "Compte verrouillé. Un administrateur principal doit le déverrouiller."
          },
          403
        )
      }
      const status = result.error === "session_already_active" ? 409 : 401
      return c.json(
        {
          error: result.error,
          can_force: result.error === "session_already_active",
          message:
            result.error === "session_already_active"
              ? "Ce compte a déjà une session active (autre navigateur / onglet). Utilisez « Forcer la déconnexion » pour prendre la main, ou attendez l’idle serveur (~10 min sans activité API)."
              : undefined
        },
        status
      )
    }
    await audit(
      {
        admin: result.admin,
        orgId: result.session.orgId
      },
      "login",
      result.forced
        ? "Connexion console (prise de contrôle - session précédente révoquée)"
        : "Connexion console"
    )
    return c.json({
      ok: true,
      token: result.session.token,
      expires_at: result.session.expiresAt,
      admin: publicAdminView(result.admin),
      forced: !!result.forced,
      hint:
        result.admin.mustChangePassword
          ? "Changez le mot de passe par défaut (0000) dès que possible."
          : result.forced
            ? "L’autre session a été déconnectée."
            : undefined
    })
  })

  v1.post("/auth/logout", async (c) => {
    const header = c.req.header("Authorization") || ""
    const match = header.match(/^Bearer\s+(.+)$/i)
    let reason: "manual" | "idle" = "manual"
    try {
      const b = await c.req.json()
      if (b?.reason === "idle") reason = "idle"
    } catch {
      /* no body */
    }
    if (match) {
      const resolved = await store.resolveAdminSession(match[1].trim())
      if (resolved) {
        await store.appendAdminAudit({
          orgId: resolved.session.orgId,
          adminId: resolved.admin.id,
          adminEmail: resolved.admin.email,
          adminLabel: resolved.admin.label,
          action: reason === "idle" ? "logout_idle" : "logout",
          detail:
            reason === "idle"
              ? "Déconnexion automatique (inactivité)"
              : "Déconnexion manuelle"
        })
      }
      await store.revokeAdminSession(match[1].trim())
    }
    return c.json({ ok: true })
  })

  v1.get("/auth/me", async (c) => {
    const auth = await requireConsoleAuth(c, "console_access")
    if (!auth.ok) return c.json({ error: auth.error }, auth.status)
    const org = await store.getOrg(auth.orgId)
    return c.json({
      ok: true,
      admin: publicAdminView(auth.admin),
      org: org
        ? {
            id: org.id,
            name: org.name,
            org_code: org.orgCode,
            primary_email: org.primaryEmail
          }
        : null
    })
  })

  /** Setup info (public minimal — email principal masqué partiel) */
  v1.get("/auth/setup-info", async (c) => {
    const org = await demoOrg()
    if (!org) return c.json({ error: "no_demo_org" }, 404)
    const email = org.primaryEmail || PRINCIPAL_SETUP_EMAIL
    const masked =
      email.replace(/(^.).*(@.*$)/, (_, a, b) => a + "***" + b) || email
    return c.json({
      org_code: org.orgCode,
      primary_email_masked: masked,
      default_password_hint: PRINCIPAL_DEFAULT_PASSWORD,
      note: "Connectez-vous avec l'email principal et le mdp setup, puis changez-le."
    })
  })

  v1.get("/org/summary", async (c) => {
    const auth = await requireConsoleAuth(c, "console_access")
    if (!auth.ok) return c.json({ error: auth.error }, auth.status)
    // Side-effect soft : archive hebdo si activée (fin de semaine passée)
    void ensureWeeklyExportIfDue(auth.orgId).catch(() => {
      /* non bloquant */
    })
    return c.json(await store.summary(auth.orgId))
  })

  async function ensureWeeklyExportIfDue(orgId: string) {
    const org = await store.getOrg(orgId)
    if (!org) return
    const { mergeMonitoringSettings } = await import("./types")
    const mon = mergeMonitoringSettings(org.monitoring)
    if (!mon.weeklyExportEnabled) return
    const {
      previousIsoWeekRange,
      filterEventsRange,
      eventsToCsv
    } = await import("./events-export")
    const { from, to, weekKey } = previousIsoWeekRange()
    const last = mon.lastWeeklyExportAt
      ? Date.parse(mon.lastWeeklyExportAt)
      : 0
    // Une archive max par semaine ISO (clé dans lastWeeklyExportAt weekKey)
    if (last && mon.lastWeeklyExportAt?.includes(weekKey)) return
    // Ne générer que si on est au-delà de la fin de la semaine précédente
    if (Date.now() < to.getTime()) return
    const all = await store.listEvents(orgId, 5000)
    const slice = filterEventsRange(all, from.getTime(), to.getTime())
    if (slice.length === 0) {
      await store.updateOrgMonitoring(orgId, {
        lastWeeklyExportAt: `${weekKey}:${new Date().toISOString()}`
      })
      return
    }
    const content = eventsToCsv(slice)
    const filename = `opsgate-events-${weekKey}.csv`
    const expires = new Date(
      Date.now() + Math.max(mon.logRetentionDays, 30) * 86400000
    ).toISOString()
    await store.saveLogExport(orgId, {
      kind: "week",
      format: "csv",
      filename,
      content,
      eventCount: slice.length,
      fromTs: from.toISOString(),
      toTs: to.toISOString(),
      expiresAt: expires
    })
    await store.updateOrgMonitoring(orgId, {
      lastWeeklyExportAt: `${weekKey}:${new Date().toISOString()}`
    })
  }

  /** Paramètres monitoring (seuils offline + schedule) */
  v1.get("/org/monitoring", async (c) => {
    const _gate = await requireConsoleAuth(c, "console_access")
    if (!_gate.ok) return c.json({ error: _gate.error }, _gate.status)
    const org = await store.getOrg(_gate.orgId)
    if (!org) return c.json({ error: "no_org" }, 404)
    const { mergeMonitoringSettings } = await import("./types")
    return c.json({
      org_id: org.id,
      monitoring: mergeMonitoringSettings(org.monitoring)
    })
  })

  v1.patch("/org/monitoring", async (c) => {
    const _gate = await requireConsoleAuth(c, "manage_policies")
    if (!_gate.ok) return c.json({ error: _gate.error }, _gate.status)
    const org = await store.getOrg(_gate.orgId)
    if (!org) return c.json({ error: "no_org" }, 404)
    let body: Partial<import("./types").OrgMonitoringSettings>
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: "invalid_json" }, 400)
    }
    // Licence titulaire: uniquement via POST /license/activate (clé préprogrammée)
    if (body.licenseDisplay) {
      delete body.licenseDisplay
    }
    const updated = await store.updateOrgMonitoring(org.id, body)
    await store.appendAdminAudit({
      orgId: org.id,
      adminId: _gate.admin.id,
      adminEmail: _gate.admin.email,
      adminLabel: _gate.admin.label,
      action: "org_settings_update",
      detail: `Monitoring : offline ${Math.round((updated?.monitoring as { offlineLongMs?: number })?.offlineLongMs || 0) / 60000} min · schedule ${(updated?.monitoring as { schedule?: { enabled?: boolean } })?.schedule?.enabled ? "ON" : "OFF"}`
    })
    const { mergeMonitoringSettings } = await import("./types")
    return c.json({
      ok: true,
      monitoring: mergeMonitoringSettings(updated?.monitoring)
    })
  })

  /** Fusionner agents doublons */
  v1.post("/org/agents/merge", async (c) => {
    const _gate = await requireConsoleAuth(c, "manage_policies")
    if (!_gate.ok) return c.json({ error: _gate.error }, _gate.status)
    const org = await store.getOrg(_gate.orgId)
    if (!org) return c.json({ error: "no_org" }, 404)
    let body: { keep_id?: string; merge_ids?: string[] }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: "invalid_json" }, 400)
    }
    if (!body.keep_id || !Array.isArray(body.merge_ids) || !body.merge_ids.length) {
      return c.json({ error: "keep_id_and_merge_ids_required" }, 400)
    }
    const result = await store.mergeAgents(
      org.id,
      body.keep_id,
      body.merge_ids
    )
    if (!result.ok) return c.json({ error: "merge_failed" }, 400)
    await store.appendAdminAudit({
      orgId: org.id,
      adminId: _gate.admin.id,
      adminEmail: _gate.admin.email,
      adminLabel: _gate.admin.label,
      action: "agent_merge",
      detail: `Fusion agents → conservé ${result.kept}, supprimé ${result.removed}`,
      meta: { keep_id: result.kept, removed: result.removed }
    })
    return c.json({
      ok: true,
      kept: result.kept,
      removed: result.removed
    })
  })

  v1.get("/org/agents", async (c) => {
    const _gate = await requireConsoleAuth(c, "console_access")
    if (!_gate.ok) return c.json({ error: _gate.error }, _gate.status)
    const org = await store.getOrg(_gate.orgId)
    if (!org) return c.json({ error: "no_org" }, 404)
    const agentsRaw = await store.listAgents(org.id)
    const agents = await Promise.all(
      agentsRaw.map(async (a) => {
        const licensed = await store.isAgentLicensed(org.id, a.id)
        const { LICENSE_GRACE_MS: graceMs } = await import("./summary-helpers")
        let license_status: "licensed" | "grace" | "unlicensed" = "licensed"
        if (!licensed) {
          const since = a.unlicensedSince
            ? new Date(a.unlicensedSince).getTime()
            : Date.now()
          license_status =
            Date.now() - since < graceMs ? "grace" : "unlicensed"
        }
        return {
          id: a.id,
          group_id: a.groupId || null,
          device_label: a.deviceLabel,
          host_name: a.hostName || null,
          app_version: a.appVersion,
          enrolled_at: a.enrolledAt,
          last_seen_at: a.lastSeenAt,
          policy_profile_id: a.policyProfileId || null,
          user_id: a.userId || null,
          personal_account: !!a.personalAccount,
          licensed,
          license_assigned: a.licenseAssigned,
          license_status,
          unlicensed_since: a.unlicensedSince || null,
          device_fingerprint: a.deviceFingerprint || null
        }
      })
    )
    return c.json({ org_id: org.id, agents })
  })

  /** Events filtrés par décision (pour drill-down console) */
  v1.get("/org/events/by-decision/:decision", async (c) => {
    const _gate = await requireConsoleAuth(c, "console_access")
    if (!_gate.ok) return c.json({ error: _gate.error }, _gate.status)
    const org = await store.getOrg(_gate.orgId)
    if (!org) return c.json({ error: "no_org" }, 404)
    const decision = decodeURIComponent(c.req.param("decision") || "").trim()
    const all = await store.listEvents(org.id, 500)
    const events = all
      .filter((e) => String(e.decision || "") === decision)
      .map(publicEvent)
    return c.json({
      org_id: org.id,
      decision,
      count: events.length,
      events
    })
  })

  /** Assigner profil et/ou user à un agent */
  v1.patch("/org/agents/:agentId", async (c) => {
    const _gate = await requireConsoleAuth(c, "console_access")
    if (!_gate.ok) return c.json({ error: _gate.error }, _gate.status)
    const org = await store.getOrg(_gate.orgId)
    if (!org) return c.json({ error: "no_org" }, 404)
    let body: {
      policy_profile_id?: string | null
      user_id?: string | null
    }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: "invalid_json" }, 400)
    }
    let agent =
      body.policy_profile_id !== undefined
        ? await store.assignAgentProfile(
            org.id,
            c.req.param("agentId"),
            body.policy_profile_id
          )
        : (await store.listAgents(org.id)).find(
            (a) => a.id === c.req.param("agentId")
          )
    if (!agent) return c.json({ error: "agent_or_profile_not_found" }, 404)
    if (body.user_id !== undefined) {
      agent = await store.assignAgentUser(
        org.id,
        c.req.param("agentId"),
        body.user_id
      )
      if (!agent) return c.json({ error: "agent_or_user_not_found" }, 404)
    }
    await audit(
      _gate,
      "agent_assign",
      `Assign agent ${c.req.param("agentId").slice(0, 12)}… · profil=${agent.policyProfileId || "—"} · user=${agent.userId || "—"}`,
      {
        agent_id: agent.id,
        policy_profile_id: agent.policyProfileId,
        user_id: agent.userId
      }
    )
    return c.json({
      ok: true,
      agent: {
        id: agent.id,
        policy_profile_id: agent.policyProfileId || null,
        user_id: agent.userId || null
      }
    })
  })

  /** Admins (principal + secondaires) */
  v1.get("/org/admins", async (c) => {
    const _gate = await requireConsoleAuth(c, "console_access")
    if (!_gate.ok) return c.json({ error: _gate.error }, _gate.status)
    const org = await store.getOrg(_gate.orgId)
    if (!org) return c.json({ error: "no_org" }, 404)
    const admins = (await store.listAdmins(org.id)).map(publicAdminView)
    return c.json({
      org_id: org.id,
      primary_email: org.primaryEmail,
      admins
    })
  })

  v1.post("/org/admins", async (c) => {
    const _gate = await requireConsoleAuth(c, "manage_admins")
    if (!_gate.ok) return c.json({ error: _gate.error }, _gate.status)
    // Création principal : réservé aux principals
    const org = await store.getOrg(_gate.orgId)
    if (!org) return c.json({ error: "no_org" }, 404)
    let body: {
      label?: string
      email?: string
      password?: string
      permissions?: AdminPermission[]
      is_principal?: boolean
    }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: "invalid_json" }, 400)
    }
    if (
      !body.label?.trim() ||
      !body.email?.trim() ||
      !body.password ||
      body.password.length < 6
    ) {
      return c.json(
        { error: "label_email_password_min6_required" },
        400
      )
    }
    if (body.is_principal && !_gate.admin.isPrincipal) {
      return c.json({ error: "principal_only" }, 403)
    }
    const emailNorm = body.email.trim().toLowerCase()
    const emailTaken = (await store.listAdmins(org.id)).some(
      (a) => a.email.toLowerCase() === emailNorm
    )
    if (emailTaken) {
      return c.json(
        {
          error: "email_already_registered",
          message:
            "Cet e-mail est déjà inscrit comme administrateur. Choisissez une autre adresse."
        },
        409
      )
    }
    const admin = await store.upsertAdmin(org.id, {
      label: body.label.trim(),
      email: body.email.trim(),
      password: body.password,
      permissions: body.permissions,
      isPrincipal: !!body.is_principal
    })
    if (!admin) {
      return c.json(
        {
          error: "admin_create_failed",
          message: "Création impossible (e-mail invalide ou mot de passe trop court)."
        },
        400
      )
    }
    await audit(
      _gate,
      "admin_create",
      `Création admin « ${admin.label} » (${admin.email})${admin.isPrincipal ? " · Principal" : ""}`,
      { admin_id: admin.id, is_principal: admin.isPrincipal }
    )
    return c.json({ ok: true, admin: publicAdminView(admin) })
  })

  /** Déverrouiller un compte après lockout brute-force (principal) */
  v1.post("/org/admins/:adminId/unlock", async (c) => {
    const _gate = await requireConsoleAuth(c, "manage_admins")
    if (!_gate.ok) return c.json({ error: _gate.error }, _gate.status)
    if (!_gate.admin.isPrincipal) {
      return c.json({ error: "principal_only" }, 403)
    }
    const org = await store.getOrg(_gate.orgId)
    if (!org) return c.json({ error: "no_org" }, 404)
    const admin = await store.unlockAdmin(org.id, c.req.param("adminId"))
    if (!admin) return c.json({ error: "admin_not_found" }, 404)
    await audit(
      _gate,
      "account_unlocked",
      `Déverrouillage compte « ${admin.label} » (${admin.email})`,
      { admin_id: admin.id }
    )
    return c.json({ ok: true, admin: publicAdminView(admin) })
  })

  v1.patch("/org/admins/:adminId", async (c) => {
    const _gate = await requireConsoleAuth(c, "console_access")
    if (!_gate.ok) return c.json({ error: _gate.error }, _gate.status)
    const org = await store.getOrg(_gate.orgId)
    if (!org) return c.json({ error: "no_org" }, 404)
    let body: {
      label?: string
      email?: string
      password?: string
      password_confirm?: string
      current_password?: string
      active?: boolean
      permissions?: AdminPermission[]
      must_change_password?: boolean
    }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: "invalid_json" }, 400)
    }
    const existing = (await store.listAdmins(org.id)).find(
      (a) => a.id === c.req.param("adminId")
    )
    if (!existing) return c.json({ error: "admin_not_found" }, 404)

    const isSelf = _gate.admin.id === existing.id
    const canManage = adminHas(_gate.admin, "manage_admins")

    // Secondary self-edit email/mdp : exige current_password
    if (isSelf && !existing.isPrincipal) {
      if (!body.current_password) {
        return c.json({ error: "current_password_required" }, 400)
      }
      if (
        hashManagementPassword(body.current_password) !==
        _gate.admin.passwordHash
      ) {
        return c.json({ error: "current_password_invalid" }, 400)
      }
      if (body.password) {
        if (body.password !== body.password_confirm) {
          return c.json({ error: "password_confirm_mismatch" }, 400)
        }
        if (body.password.length < 6) {
          return c.json({ error: "password_too_short" }, 400)
        }
      }
      const admin = await store.upsertAdmin(org.id, {
        id: existing.id,
        label: body.label?.trim() || existing.label,
        email: body.email?.trim() || existing.email,
        password: body.password,
        mustChangePassword: false
      })
      await audit(
        _gate,
        "admin_update",
        `Self-update admin « ${admin?.label || existing.label} »`,
        { admin_id: existing.id, self: true }
      )
      return c.json({ ok: true, admin: admin ? publicAdminView(admin) : null })
    }

    if (!canManage) {
      return c.json({ error: "forbidden_permission" }, 403)
    }
    // Principal / manage_admins : peut changer perms ; mdp secondaire via reset-password
    if (body.password && !isSelf) {
      return c.json(
        {
          error: "use_reset_password_endpoint",
          message: "Utilisez POST …/reset-password (principal only)."
        },
        400
      )
    }
    const admin = await store.upsertAdmin(org.id, {
      id: existing.id,
      label: body.label?.trim() || existing.label,
      email: body.email?.trim() || existing.email,
      password: isSelf ? body.password : undefined,
      active: body.active,
      permissions: existing.isPrincipal
        ? ALL_ADMIN_PERMISSIONS
        : body.permissions ?? existing.permissions,
      mustChangePassword: body.must_change_password
    })
    await audit(
      _gate,
      "admin_update",
      `Modif admin « ${admin?.label || existing.label} »`,
      { admin_id: existing.id, fields: Object.keys(body), self: isSelf }
    )
    return c.json({
      ok: true,
      admin: admin ? publicAdminView(admin) : null
    })
  })

  /** Changer son propre mdp (actuel + nouveau + confirmation) */
  v1.post("/auth/change-password", async (c) => {
    const _gate = await requireConsoleAuth(c, "console_access")
    if (!_gate.ok) return c.json({ error: _gate.error }, _gate.status)
    let body: {
      current_password?: string
      new_password?: string
      new_password_confirm?: string
      email?: string
    }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: "invalid_json" }, 400)
    }
    if (!body.current_password || !body.new_password) {
      return c.json({ error: "passwords_required" }, 400)
    }
    if (body.new_password !== body.new_password_confirm) {
      return c.json({ error: "password_confirm_mismatch" }, 400)
    }
    if (body.new_password.length < 6) {
      return c.json({ error: "password_too_short" }, 400)
    }
    const curHash = hashManagementPassword(body.current_password)
    if (curHash !== _gate.admin.passwordHash) {
      return c.json({ error: "current_password_invalid" }, 400)
    }
    const admin = await store.upsertAdmin(_gate.orgId, {
      id: _gate.admin.id,
      label: _gate.admin.label,
      email: body.email?.trim() || _gate.admin.email,
      password: body.new_password,
      mustChangePassword: false
    })
    await audit(
      _gate,
      "password_change",
      `Changement de mot de passe (self)${body.email ? " + email" : ""}`
    )
    return c.json({ ok: true, admin: admin ? publicAdminView(admin) : null })
  })

  /**
   * Admin secondaire : modifier email/mdp avec ancien mdp.
   * Principal peut reset un secondaire sans l'ancien mdp.
   */
  v1.post("/org/admins/:adminId/reset-password", async (c) => {
    const _gate = await requireConsoleAuth(c, "manage_admins")
    if (!_gate.ok) return c.json({ error: _gate.error }, _gate.status)
    if (!_gate.admin.isPrincipal) {
      return c.json({ error: "principal_only" }, 403)
    }
    const org = await store.getOrg(_gate.orgId)
    if (!org) return c.json({ error: "no_org" }, 404)
    let body: { new_password?: string }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: "invalid_json" }, 400)
    }
    if (!body.new_password || body.new_password.length < 6) {
      return c.json({ error: "password_too_short" }, 400)
    }
    const existing = (await store.listAdmins(org.id)).find(
      (a) => a.id === c.req.param("adminId")
    )
    if (!existing) {
      return c.json({ error: "admin_not_found" }, 404)
    }
    // Principal peut reset n'importe quel autre compte (y compris principal)
    if (!_gate.admin.isPrincipal) {
      return c.json({ error: "principal_only" }, 403)
    }
    if (existing.id === _gate.admin.id) {
      return c.json({ error: "cannot_reset_self" }, 400)
    }
    const admin = await store.upsertAdmin(org.id, {
      id: existing.id,
      label: existing.label,
      email: existing.email,
      password: body.new_password,
      mustChangePassword: true,
      unlock: true
    })
    await audit(
      _gate,
      "admin_password_reset",
      `Reset mdp admin « ${existing.label} » (${existing.email}) + déverrouillage`,
      { admin_id: existing.id }
    )
    return c.json({
      ok: true,
      admin: admin ? publicAdminView(admin) : null,
      message: "Mdp réinitialisé — l'admin devra le changer à la prochaine connexion."
    })
  })

  v1.delete("/org/admins/:adminId", async (c) => {
    const _gate = await requireConsoleAuth(c, "manage_admins")
    if (!_gate.ok) return c.json({ error: _gate.error }, _gate.status)
    const org = await store.getOrg(_gate.orgId)
    if (!org) return c.json({ error: "no_org" }, 404)
    const existing = (await store.listAdmins(org.id)).find(
      (a) => a.id === c.req.param("adminId")
    )
    const ok = await store.deleteAdmin(org.id, c.req.param("adminId"))
    if (!ok) {
      return c.json(
        {
          error: "admin_delete_failed",
          message:
            "Suppression impossible (dernier principal, ou admin introuvable)."
        },
        400
      )
    }
    await audit(
      _gate,
      "admin_delete",
      `Suppression admin « ${existing?.label || c.req.param("adminId")} »`,
      { admin_id: c.req.param("adminId") }
    )
    return c.json({ ok: true })
  })

  /** Users */
  v1.get("/org/users", async (c) => {
    const _gate = await requireConsoleAuth(c, "console_access")
    if (!_gate.ok) return c.json({ error: _gate.error }, _gate.status)
    const org = await store.getOrg(_gate.orgId)
    if (!org) return c.json({ error: "no_org" }, 404)
    const users = await store.listUsers(org.id)
    return c.json({ org_id: org.id, users })
  })

  /** Licence siège agent (monétisation) */
  v1.patch("/org/agents/:agentId/license", async (c) => {
    const _gate = await requireConsoleAuth(c, "manage_users")
    if (!_gate.ok) return c.json({ error: _gate.error }, _gate.status)
    const org = await store.getOrg(_gate.orgId)
    if (!org) return c.json({ error: "no_org" }, 404)
    let body: { licensed?: boolean }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: "invalid_json" }, 400)
    }
    if (typeof body.licensed !== "boolean") {
      return c.json({ error: "licensed_boolean_required" }, 400)
    }
    const agent = await store.setAgentLicense(
      org.id,
      c.req.param("agentId"),
      body.licensed
    )
    if (!agent) {
      return c.json({ error: "agent_not_found_or_no_seats" }, 400)
    }
    await audit(
      _gate,
      "agent_license",
      `Licence agent ${agent.deviceLabel || agent.id.slice(0, 12)}… → ${body.licensed ? "ON" : "OFF"}`,
      { agent_id: agent.id, licensed: body.licensed }
    )
    return c.json({
      ok: true,
      agent_id: agent.id,
      license_assigned: agent.licenseAssigned
    })
  })

  v1.get("/org/licenses", async (c) => {
    const _gate = await requireConsoleAuth(c, "console_access")
    if (!_gate.ok) return c.json({ error: _gate.error }, _gate.status)
    const org = await store.getOrg(_gate.orgId)
    if (!org) return c.json({ error: "no_org" }, 404)
    const stats = await store.getLicenseStats(org.id)
    const { mergeMonitoringSettings } = await import("./types")
    const mon = mergeMonitoringSettings(org.monitoring)
    const lic = mon.licenseDisplay || {
      companyName: "",
      address: "",
      contactEmail: "",
      expiresAt: null,
      mode: "trial" as const
    }
    const mode = lic.mode === "full" ? "full" : "trial"
    // Trial 30 jours depuis création org si pas de full
    const trialEnds = new Date(Date.parse(org.createdAt) + 30 * 86400000)
    const expiresAt =
      mode === "full" && lic.expiresAt
        ? lic.expiresAt
        : trialEnds.toISOString()
    const company =
      mode === "full" && lic.companyName?.trim()
        ? lic.companyName.trim()
        : org.name
    const email =
      mode === "full" && lic.contactEmail?.trim()
        ? lic.contactEmail.trim()
        : org.primaryEmail
    const address = mode === "full" ? lic.address || "" : ""
    const license_key_hash =
      mode === "full" && lic.licenseKeyFingerprint
        ? `OG-${lic.licenseKeyFingerprint.slice(0, 8).toUpperCase()}-${lic.licenseKeyFingerprint.slice(8, 16).toUpperCase()}`
        : "TRIAL"
    const daysLeft = Math.ceil(
      (Date.parse(expiresAt) - Date.now()) / 86400000
    )
    return c.json({
      org_id: org.id,
      ...stats,
      license: {
        mode,
        company_name: company,
        address,
        contact_email: email,
        org_code: org.orgCode,
        license_key_hash,
        seats_total: stats.seats,
        seats_used: stats.seats_used,
        seats_available: stats.seats_available,
        expires_at: expiresAt,
        days_left: daysLeft,
        trial: mode === "trial",
        activated_at: lic.activatedAt || null
      }
    })
  })

  /** Active une licence (principal) — clé courte OPS-… ou legacy OG1… */
  v1.post("/org/license/activate", async (c) => {
    const _gate = await requireConsoleAuth(c, "manage_policies")
    if (!_gate.ok) return c.json({ error: _gate.error }, _gate.status)
    if (!_gate.admin.isPrincipal) {
      return c.json({ error: "principal_only" }, 403)
    }
    const org = await store.getOrg(_gate.orgId)
    if (!org) return c.json({ error: "no_org" }, 404)
    let body: { license_key?: string }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: "invalid_json" }, 400)
    }
    const key = body.license_key?.trim() || ""
    if (!key) return c.json({ error: "license_key_required" }, 400)
    const {
      parseShortKeyOrLegacy,
      licenseKeyFingerprint,
      normalizeLicenseKey
    } = await import("./license-keys")
    const parsed = parseShortKeyOrLegacy(key)
    let p: import("./license-keys").IssuedLicensePayload
    let displayKey = key
    if (parsed.kind === "error") {
      return c.json({ error: parsed.error }, 400)
    }
    if (parsed.kind === "short") {
      const rec = await store.lookupIssuedLicense(parsed.key)
      if (!rec) return c.json({ error: "license_not_found" }, 404)
      if (rec.revokedAt) return c.json({ error: "license_revoked" }, 400)
      if (Date.parse(rec.expiresAt) < Date.now()) {
        return c.json({ error: "license_expired" }, 400)
      }
      p = {
        v: 1,
        orgCode: rec.orgCode,
        companyName: rec.companyName,
        address: rec.address,
        contactEmail: rec.contactEmail,
        seats: rec.seats,
        expiresAt: rec.expiresAt,
        issuedAt: rec.issuedAt
      }
      displayKey = rec.licenseKey
    } else {
      p = parsed.payload
      displayKey = normalizeLicenseKey(key)
    }
    if (p.orgCode.toUpperCase() !== org.orgCode.toUpperCase()) {
      return c.json(
        {
          error: "org_code_mismatch",
          message:
            "Cette licence est liée à une autre organisation (code org)."
        },
        400
      )
    }
    const { mergeMonitoringSettings } = await import("./types")
    const prev = mergeMonitoringSettings(org.monitoring)
    await store.setOrgLicenseSeats(org.id, p.seats)
    await store.updateOrgMonitoring(org.id, {
      ...prev,
      licenseDisplay: {
        companyName: p.companyName,
        address: p.address,
        contactEmail: p.contactEmail,
        expiresAt: p.expiresAt,
        mode: "full",
        seats: p.seats,
        activatedAt: new Date().toISOString(),
        licenseKeyFingerprint: licenseKeyFingerprint(displayKey)
      }
    })
    await audit(
      _gate,
      "org_settings_update",
      `Licence full activée · ${p.companyName} · ${p.seats} sièges · exp ${p.expiresAt.slice(0, 10)}`,
      { seats: p.seats, org_code: p.orgCode }
    )
    const stats = await store.getLicenseStats(org.id)
    return c.json({
      ok: true,
      license: {
        mode: "full",
        company_name: p.companyName,
        address: p.address,
        contact_email: p.contactEmail,
        org_code: org.orgCode,
        seats_total: p.seats,
        seats_used: stats.seats_used,
        expires_at: p.expiresAt,
        license_key_display: displayKey
      }
    })
  })

  /** Supprime / repasse en trial (principal) */
  v1.post("/org/license/revoke", async (c) => {
    const _gate = await requireConsoleAuth(c, "manage_policies")
    if (!_gate.ok) return c.json({ error: _gate.error }, _gate.status)
    if (!_gate.admin.isPrincipal) {
      return c.json({ error: "principal_only" }, 403)
    }
    const org = await store.getOrg(_gate.orgId)
    if (!org) return c.json({ error: "no_org" }, 404)
    const { mergeMonitoringSettings } = await import("./types")
    const prev = mergeMonitoringSettings(org.monitoring)
    const fp = prev.licenseDisplay?.licenseKeyFingerprint
    // Révocation optionnelle de la clé en base si on a le full key (non stockée en clair)
    await store.setOrgLicenseSeats(org.id, 0)
    await store.updateOrgMonitoring(org.id, {
      ...prev,
      licenseDisplay: {
        companyName: "",
        address: "",
        contactEmail: "",
        expiresAt: null,
        mode: "trial",
        seats: 0,
        activatedAt: null,
        licenseKeyFingerprint: null
      }
    })
    await audit(
      _gate,
      "org_settings_update",
      `Licence full révoquée · retour trial 30j${fp ? ` · fp ${fp}` : ""}`
    )
    return c.json({ ok: true, mode: "trial" })
  })

  v1.post("/org/users", async (c) => {
    const _gate = await requireConsoleAuth(c, "console_access")
    if (!_gate.ok) return c.json({ error: _gate.error }, _gate.status)
    const org = await store.getOrg(_gate.orgId)
    if (!org) return c.json({ error: "no_org" }, 404)
    let body: {
      display_name?: string
      email?: string
      external_id?: string
      group_ids?: string[]
    }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: "invalid_json" }, 400)
    }
    if (!body.display_name?.trim()) {
      return c.json({ error: "display_name_required" }, 400)
    }
    const user = await store.upsertUser(org.id, {
      displayName: body.display_name.trim(),
      email: body.email,
      externalId: body.external_id,
      groupIds: body.group_ids
    })
    if (!user) return c.json({ error: "user_create_failed" }, 500)
    await audit(
      _gate,
      "user_upsert",
      `Création user « ${user.displayName} »`,
      { user_id: user.id, group_ids: user.groupIds }
    )
    return c.json({ ok: true, user })
  })

  v1.patch("/org/users/:userId", async (c) => {
    const _gate = await requireConsoleAuth(c, "console_access")
    if (!_gate.ok) return c.json({ error: _gate.error }, _gate.status)
    const org = await store.getOrg(_gate.orgId)
    if (!org) return c.json({ error: "no_org" }, 404)
    let body: {
      display_name?: string
      email?: string
      external_id?: string
      group_ids?: string[]
    }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: "invalid_json" }, 400)
    }
    const existing = (await store.listUsers(org.id)).find(
      (u) => u.id === c.req.param("userId")
    )
    if (!existing) return c.json({ error: "user_not_found" }, 404)
    const user = await store.upsertUser(org.id, {
      id: existing.id,
      displayName: body.display_name?.trim() || existing.displayName,
      email: body.email ?? existing.email,
      externalId: body.external_id ?? existing.externalId,
      groupIds: body.group_ids ?? existing.groupIds
    })
    if (!user) return c.json({ error: "user_update_failed" }, 500)
    await audit(
      _gate,
      "user_upsert",
      `Modif user « ${user.displayName} »`,
      { user_id: user.id, fields: Object.keys(body) }
    )
    return c.json({ ok: true, user })
  })

  v1.delete("/org/users/:userId", async (c) => {
    const _gate = await requireConsoleAuth(c, "console_access")
    if (!_gate.ok) return c.json({ error: _gate.error }, _gate.status)
    const org = await store.getOrg(_gate.orgId)
    if (!org) return c.json({ error: "no_org" }, 404)
    const existing = (await store.listUsers(org.id)).find(
      (u) => u.id === c.req.param("userId")
    )
    const ok = await store.deleteUser(org.id, c.req.param("userId"))
    if (!ok) return c.json({ error: "user_not_found" }, 404)
    await audit(
      _gate,
      "user_delete",
      `Suppression user « ${existing?.displayName || c.req.param("userId")} »`,
      { user_id: c.req.param("userId") }
    )
    return c.json({ ok: true })
  })

  /** Groups */
  v1.get("/org/groups", async (c) => {
    const _gate = await requireConsoleAuth(c, "console_access")
    if (!_gate.ok) return c.json({ error: _gate.error }, _gate.status)
    const org = await store.getOrg(_gate.orgId)
    if (!org) return c.json({ error: "no_org" }, 404)
    return c.json({ org_id: org.id, groups: await store.listGroups(org.id) })
  })

  v1.post("/org/groups", async (c) => {
    const _gate = await requireConsoleAuth(c, "console_access")
    if (!_gate.ok) return c.json({ error: _gate.error }, _gate.status)
    const org = await store.getOrg(_gate.orgId)
    if (!org) return c.json({ error: "no_org" }, 404)
    let body: {
      name?: string
      description?: string
      policy_profile_id?: string | null
      ldap_external_id?: string
    }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: "invalid_json" }, 400)
    }
    if (!body.name?.trim()) return c.json({ error: "name_required" }, 400)
    const group = await store.upsertGroup(org.id, {
      name: body.name.trim(),
      description: body.description,
      policyProfileId: body.policy_profile_id,
      ldapExternalId: body.ldap_external_id
    })
    if (!group) return c.json({ error: "group_create_failed" }, 500)
    await audit(
      _gate,
      "group_upsert",
      `Création groupe « ${group.name} »`,
      { group_id: group.id, policy_profile_id: group.policyProfileId }
    )
    return c.json({ ok: true, group })
  })

  v1.patch("/org/groups/:groupId", async (c) => {
    const _gate = await requireConsoleAuth(c, "console_access")
    if (!_gate.ok) return c.json({ error: _gate.error }, _gate.status)
    const org = await store.getOrg(_gate.orgId)
    if (!org) return c.json({ error: "no_org" }, 404)
    let body: {
      name?: string
      description?: string
      policy_profile_id?: string | null
      ldap_external_id?: string
    }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: "invalid_json" }, 400)
    }
    const existing = (await store.listGroups(org.id)).find(
      (g) => g.id === c.req.param("groupId")
    )
    if (!existing) return c.json({ error: "group_not_found" }, 404)
    const group = await store.upsertGroup(org.id, {
      id: existing.id,
      name: body.name?.trim() || existing.name,
      description: body.description ?? existing.description,
      policyProfileId:
        body.policy_profile_id === undefined
          ? existing.policyProfileId
          : body.policy_profile_id,
      ldapExternalId: body.ldap_external_id ?? existing.ldapExternalId
    })
    if (!group) return c.json({ error: "group_update_failed" }, 500)
    await audit(
      _gate,
      "group_upsert",
      `Modif groupe « ${group.name} »`,
      {
        group_id: group.id,
        policy_profile_id: group.policyProfileId,
        fields: Object.keys(body)
      }
    )
    return c.json({ ok: true, group })
  })

  v1.delete("/org/groups/:groupId", async (c) => {
    const _gate = await requireConsoleAuth(c, "console_access")
    if (!_gate.ok) return c.json({ error: _gate.error }, _gate.status)
    const org = await store.getOrg(_gate.orgId)
    if (!org) return c.json({ error: "no_org" }, 404)
    const existing = (await store.listGroups(org.id)).find(
      (g) => g.id === c.req.param("groupId")
    )
    const ok = await store.deleteGroup(org.id, c.req.param("groupId"))
    if (!ok) return c.json({ error: "group_not_found" }, 404)
    await audit(
      _gate,
      "group_delete",
      `Suppression groupe « ${existing?.name || c.req.param("groupId")} »`,
      { group_id: c.req.param("groupId") }
    )
    return c.json({ ok: true })
  })

  /** Force les agents à recharger la policy au prochain poll (1–2 min) */
  v1.post("/org/force-sync", async (c) => {
    const _gate = await requireConsoleAuth(c, "console_access")
    if (!_gate.ok) return c.json({ error: _gate.error }, _gate.status)
    const org = await store.getOrg(_gate.orgId)
    if (!org) return c.json({ error: "no_org" }, 404)
    const result = await store.forceConfigSync(org.id)
    if (!result.ok) return c.json({ error: result.error }, 500)
    // Intentionnel : force-sync n’est PAS audit-loggé (bruit opérationnel)
    return c.json({
      ok: true,
      config_epoch: result.configEpoch,
      policy_version: result.policyVersion,
      agents: result.agents,
      message:
        "config_epoch incrémenté. Les agents appliquent au prochain auto-sync (≤2 min)."
    })
  })

  v1.get("/org/profiles", async (c) => {
    const _gate = await requireConsoleAuth(c, "console_access")
    if (!_gate.ok) return c.json({ error: _gate.error }, _gate.status)
    const org = await store.getOrg(_gate.orgId)
    if (!org) return c.json({ error: "no_org" }, 404)
    const profiles = await store.listProfiles(org.id)
    return c.json({ org_id: org.id, profiles })
  })

  v1.post("/org/profiles", async (c) => {
    const _gate = await requireConsoleAuth(c, "console_access")
    if (!_gate.ok) return c.json({ error: _gate.error }, _gate.status)
    const org = await store.getOrg(_gate.orgId)
    if (!org) return c.json({ error: "no_org" }, 404)
    let body: {
      name?: string
      department?: string
      default_action?: Policy["defaultAction"]
      enabled_hosts?: string[]
      scan_uploads?: boolean
      event_reporting?: boolean
      protect_unenroll?: boolean
      enabled?: boolean
      priority?: number
      assigned_group_ids?: string[]
      assigned_user_ids?: string[]
      user_messages?: Partial<import("./types").PolicyUserMessages>
      work_schedule?: import("./types").WorkSchedule | null
    }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: "invalid_json" }, 400)
    }
    if (!body.name?.trim()) return c.json({ error: "name_required" }, 400)
    const profile = await store.upsertProfile(org.id, {
      name: body.name.trim(),
      department: body.department,
      defaultAction: body.default_action,
      enabledHosts: body.enabled_hosts,
      scanUploads: body.scan_uploads,
      eventReporting: body.event_reporting,
      protectUnenroll: body.protect_unenroll,
      enabled: body.enabled,
      priority: body.priority,
      assignedGroupIds: body.assigned_group_ids,
      assignedUserIds: body.assigned_user_ids,
      userMessages: body.user_messages,
      workSchedule: body.work_schedule
    })
    if (!profile) return c.json({ error: "profile_create_failed" }, 500)
    await audit(
      _gate,
      "profile_upsert",
      `Création profil « ${profile.name} » · action=${profile.defaultAction} · hosts=${(profile.enabledHosts || []).length} · events=${profile.eventReporting}`,
      {
        profile_id: profile.id,
        hosts_count: (profile.enabledHosts || []).length,
        default_action: profile.defaultAction
      }
    )
    return c.json({ ok: true, profile })
  })

  v1.patch("/org/profiles/:profileId", async (c) => {
    const _gate = await requireConsoleAuth(c, "console_access")
    if (!_gate.ok) return c.json({ error: _gate.error }, _gate.status)
    const org = await store.getOrg(_gate.orgId)
    if (!org) return c.json({ error: "no_org" }, 404)
    let body: {
      name?: string
      department?: string
      default_action?: Policy["defaultAction"]
      enabled_hosts?: string[]
      scan_uploads?: boolean
      event_reporting?: boolean
      protect_unenroll?: boolean
      enabled?: boolean
      priority?: number
      assigned_group_ids?: string[]
      assigned_user_ids?: string[]
      user_messages?: Partial<import("./types").PolicyUserMessages>
      work_schedule?: import("./types").WorkSchedule | null
    }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: "invalid_json" }, 400)
    }
    const existing = (await store.listProfiles(org.id)).find(
      (p) => p.id === c.req.param("profileId")
    )
    if (!existing) return c.json({ error: "profile_not_found" }, 404)
    const profile = await store.upsertProfile(org.id, {
      id: existing.id,
      name: body.name?.trim() || existing.name,
      department: body.department ?? existing.department,
      defaultAction: body.default_action ?? existing.defaultAction,
      enabledHosts: body.enabled_hosts ?? existing.enabledHosts,
      scanUploads:
        body.scan_uploads !== undefined
          ? body.scan_uploads
          : existing.scanUploads,
      eventReporting:
        body.event_reporting !== undefined
          ? body.event_reporting
          : existing.eventReporting,
      protectUnenroll:
        body.protect_unenroll !== undefined
          ? body.protect_unenroll
          : existing.protectUnenroll,
      enabled:
        body.enabled !== undefined ? body.enabled : existing.enabled,
      priority:
        body.priority !== undefined ? body.priority : existing.priority,
      userMessages:
        body.user_messages !== undefined
          ? body.user_messages
          : existing.userMessages,
      workSchedule:
        body.work_schedule !== undefined
          ? body.work_schedule
          : existing.workSchedule,
      assignedGroupIds: body.assigned_group_ids ?? existing.assignedGroupIds,
      assignedUserIds: body.assigned_user_ids ?? existing.assignedUserIds
    })
    if (!profile) return c.json({ error: "profile_update_failed" }, 500)
    const changed: string[] = []
    if (body.name !== undefined) changed.push(`name=${profile.name}`)
    if (body.default_action !== undefined)
      changed.push(`action=${profile.defaultAction}`)
    if (body.enabled_hosts !== undefined)
      changed.push(`hosts=${(profile.enabledHosts || []).length}`)
    if (body.scan_uploads !== undefined)
      changed.push(`uploads=${profile.scanUploads}`)
    if (body.event_reporting !== undefined)
      changed.push(`events=${profile.eventReporting}`)
    if (body.protect_unenroll !== undefined)
      changed.push(`protect=${profile.protectUnenroll}`)
    if (body.user_messages !== undefined) changed.push("messages_banner")
    if (body.assigned_group_ids !== undefined) changed.push("groupes")
    if (body.assigned_user_ids !== undefined) changed.push("users")
    await audit(
      _gate,
      "profile_upsert",
      `Modif profil « ${profile.name} » · ${changed.length ? changed.join(" · ") : "sans détail"}`,
      {
        profile_id: profile.id,
        fields: Object.keys(body),
        hosts_count: (profile.enabledHosts || []).length
      }
    )
    return c.json({ ok: true, profile })
  })

  v1.delete("/org/profiles/:profileId", async (c) => {
    const _gate = await requireConsoleAuth(c, "console_access")
    if (!_gate.ok) return c.json({ error: _gate.error }, _gate.status)
    const org = await store.getOrg(_gate.orgId)
    if (!org) return c.json({ error: "no_org" }, 404)
    const existing = (await store.listProfiles(org.id)).find(
      (p) => p.id === c.req.param("profileId")
    )
    const ok = await store.deleteProfile(org.id, c.req.param("profileId"))
    if (!ok) return c.json({ error: "profile_not_found" }, 404)
    await audit(
      _gate,
      "profile_delete",
      `Suppression profil « ${existing?.name || c.req.param("profileId")} »`,
      { profile_id: c.req.param("profileId") }
    )
    return c.json({ ok: true })
  })

  /**
   * OTP reset = Administrator principal uniquement (email primary).
   * Public (pas de session) — comme un reset login.
   */
  v1.post("/auth/password-reset/request", async (c) => {
    let body: { email?: string }
    try {
      body = await c.req.json()
    } catch {
      body = {}
    }
    const org = await demoOrg()
    if (!org) return c.json({ error: "no_demo_org" }, 404)
    const principal = await store.getPrincipalAdmin(org.id)
    const email = (body.email || "").trim().toLowerCase()
    if (
      email &&
      principal &&
      email !== principal.email &&
      email !== org.primaryEmail.toLowerCase()
    ) {
      // ne pas révéler si email existe
      return c.json({
        ok: true,
        message: "Si l'email correspond à l'Administrator, un OTP a été envoyé."
      })
    }
    const result = await store.requestPasswordResetOtp(org.id)
    return c.json(result)
  })

  v1.post("/auth/password-reset/confirm", async (c) => {
    const org = await demoOrg()
    if (!org) return c.json({ error: "no_demo_org" }, 404)
    let body: { otp?: string; new_password?: string }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: "invalid_json" }, 400)
    }
    if (!body.otp || !body.new_password) {
      return c.json({ error: "otp_and_new_password_required" }, 400)
    }
    const result = await store.confirmPasswordResetOtp(
      org.id,
      body.otp,
      body.new_password
    )
    if (!result.ok) return c.json({ error: result.error }, 400)
    return c.json({
      ok: true,
      message:
        "Mot de passe Administrator mis à jour. Les agents synchronisés le reçoivent au prochain poll (~15 min)."
    })
  })

  // Compat anciens chemins console
  v1.post("/org/password-reset/request", async (c) => {
    const org = await demoOrg()
    if (!org) return c.json({ error: "no_demo_org" }, 404)
    return c.json(await store.requestPasswordResetOtp(org.id))
  })
  v1.post("/org/password-reset/confirm", async (c) => {
    const org = await demoOrg()
    if (!org) return c.json({ error: "no_demo_org" }, 404)
    let body: { otp?: string; new_password?: string }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: "invalid_json" }, 400)
    }
    if (!body.otp || !body.new_password) {
      return c.json({ error: "otp_and_new_password_required" }, 400)
    }
    const result = await store.confirmPasswordResetOtp(
      org.id,
      body.otp,
      body.new_password
    )
    if (!result.ok) return c.json({ error: result.error }, 400)
    return c.json({ ok: true })
  })

  /** Pool recovery one-time — liste (pas de clair) */
  v1.get("/org/recovery-codes", async (c) => {
    const _gate = await requireConsoleAuth(c, "console_access")
    if (!_gate.ok) return c.json({ error: _gate.error }, _gate.status)
    if (!_gate.admin.isPrincipal) {
      return c.json({ error: "principal_only" }, 403)
    }
    const codes = await store.listRecoveryCodes(_gate.orgId)
    const active = codes.filter((c) => c.active && !c.consumedAt).length
    return c.json({
      org_id: _gate.orgId,
      active_count: active,
      low_stock: active < 5,
      codes: codes.map((c) => ({
        id: c.id,
        label: c.label,
        created_at: c.createdAt,
        consumed_at: c.consumedAt,
        consumed_agent_id: c.consumedAgentId,
        active: c.active && !c.consumedAt
      }))
    })
  })

  /** Génère N codes — clair renvoyé UNE FOIS */
  v1.post("/org/recovery-codes/generate", async (c) => {
    const _gate = await requireConsoleAuth(c, "console_access")
    if (!_gate.ok) return c.json({ error: _gate.error }, _gate.status)
    if (!_gate.admin.isPrincipal) {
      return c.json({ error: "principal_only" }, 403)
    }
    let body: { count?: number; label?: string } = {}
    try {
      body = await c.req.json()
    } catch {
      body = {}
    }
    const count = body.count ?? 20
    const result = await store.generateRecoveryCodes(
      _gate.orgId,
      count,
      body.label
    )
    await store.forceConfigSync(_gate.orgId)
    await audit(
      _gate,
      "recovery_codes_generated",
      `Génération ${result.created} code(s) recovery one-time`,
      { count: result.created }
    )
    return c.json({
      ok: true,
      created: result.created,
      codes: result.codes,
      note: "Copiez ces codes maintenant — ils ne seront plus jamais réaffichés."
    })
  })

  /** Invalide tout le pool actif */
  v1.post("/org/recovery-codes/revoke-pool", async (c) => {
    const _gate = await requireConsoleAuth(c, "console_access")
    if (!_gate.ok) return c.json({ error: _gate.error }, _gate.status)
    if (!_gate.admin.isPrincipal) {
      return c.json({ error: "principal_only" }, 403)
    }
    const { revoked } = await store.revokeRecoveryPool(_gate.orgId)
    await store.forceConfigSync(_gate.orgId)
    await audit(
      _gate,
      "recovery_pool_revoked",
      `Pool recovery purgé · ${revoked} code(s) effacé(s)`,
      { revoked }
    )
    return c.json({ ok: true, revoked })
  })

  /** Vendor recovery — info limitée au principal */
  v1.get("/org/recovery-info", async (c) => {
    const _gate = await requireConsoleAuth(c, "console_access")
    if (!_gate.ok) return c.json({ error: _gate.error }, _gate.status)
    if (!_gate.admin.isPrincipal) {
      return c.json({ error: "principal_only" }, 403)
    }
    await audit(
      _gate,
      "recovery_info_view",
      "Consultation info recovery concepteur (hint, pas le secret complet en prod)"
    )
    return c.json({
      ok: true,
      note:
        "Mode principal: codes one-time (pool). Secret env OPSGATE_VENDOR_RECOVERY encore accepté en secours offline (transition) si le pool est vide ; il sera retiré en V2. Offline ≥ 2h uniquement.",
      mode: "one_time_primary",
      legacy_env_usable: true,
      legacy_env_deprecated: true,
      recovery_password_hint: VENDOR_RECOVERY_PASSWORD,
      offline_after_ms: VENDOR_RECOVERY_OFFLINE_MS,
      env_override: "OPSGATE_VENDOR_RECOVERY"
    })
  })

  /** Admin : révoquer un agent — historique events conservé ; agent reçoit 401 au prochain sync */
  v1.delete("/org/agents/:agentId", async (c) => {
    const _gate = await requireConsoleAuth(c, "unenroll_agents")
    if (!_gate.ok) return c.json({ error: _gate.error }, _gate.status)
    const org = await store.getOrg(_gate.orgId)
    if (!org) return c.json({ error: "no_org" }, 404)
    const ok = await store.revokeAgentById(org.id, c.req.param("agentId"), {
      type: "admin",
      admin_id: _gate.admin.id,
      admin_label: _gate.admin.label
    })
    if (!ok) return c.json({ error: "agent_not_found" }, 404)
    // Bump epoch pour les autres agents ; le révoqué verra invalid_token → local_only
    await store.forceConfigSync(org.id)
    await store.appendAdminAudit({
      orgId: org.id,
      adminId: _gate.admin.id,
      adminEmail: _gate.admin.email,
      adminLabel: _gate.admin.label,
      action: "agent_revoke",
      detail: `Révocation agent ${c.req.param("agentId")}`
    })
    return c.json({
      ok: true,
      agent_id: c.req.param("agentId"),
      events_retained: true,
      message:
        "Agent révoqué. L’extension repasse en local_only au prochain sync (≤ 2 min) sans mot de passe local."
    })
  })

  v1.get("/org/audit", async (c) => {
    const _gate = await requireConsoleAuth(c, "console_access")
    if (!_gate.ok) return c.json({ error: _gate.error }, _gate.status)
    // Réservé au principal (pas les admins secondaires)
    if (!_gate.admin.isPrincipal) {
      return c.json({ error: "principal_only", message: "Audit réservé à l'Administrator principal." }, 403)
    }
    const org = await store.getOrg(_gate.orgId)
    if (!org) return c.json({ error: "no_org" }, 404)
    const action = c.req.query("action") || undefined
    const events = await store.listAdminAudit(org.id, {
      limit: 150,
      action
    })
    return c.json({ org_id: org.id, events })
  })

  // ── Moving rules (affectation auto agents → groupes) ──
  v1.get("/org/moving-rules", async (c) => {
    const _gate = await requireConsoleAuth(c, "console_access")
    if (!_gate.ok) return c.json({ error: _gate.error }, _gate.status)
    const org = await store.getOrg(_gate.orgId)
    if (!org) return c.json({ error: "no_org" }, 404)
    return c.json({ org_id: org.id, rules: await store.listMovingRules(org.id) })
  })

  v1.post("/org/moving-rules", async (c) => {
    const _gate = await requireConsoleAuth(c, "manage_policies")
    if (!_gate.ok) return c.json({ error: _gate.error }, _gate.status)
    const org = await store.getOrg(_gate.orgId)
    if (!org) return c.json({ error: "no_org" }, 404)
    let body: {
      name?: string
      enabled?: boolean
      conditions?: Array<{
        field: "device_label" | "host_name"
        op: "starts_with" | "contains" | "equals" | "regex"
        value: string
      }>
      match_field?: "device_label" | "host_name"
      match_op?: "starts_with" | "contains" | "equals" | "regex"
      match_value?: string
      target_group_id?: string
      priority?: number
      only_if_unassigned?: boolean
    }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: "invalid_json" }, 400)
    }
    const conditions =
      body.conditions && body.conditions.length > 0
        ? body.conditions
        : body.match_field && body.match_op && body.match_value?.trim()
          ? [
              {
                field: body.match_field,
                op: body.match_op,
                value: body.match_value.trim()
              }
            ]
          : []
    if (!body.name?.trim() || !body.target_group_id || conditions.length === 0) {
      return c.json({ error: "invalid_moving_rule" }, 400)
    }
    const rule = await store.upsertMovingRule(org.id, {
      name: body.name.trim(),
      enabled: body.enabled,
      conditions,
      targetGroupId: body.target_group_id,
      priority: body.priority,
      onlyIfUnassigned: body.only_if_unassigned
    })
    await store.appendAdminAudit({
      orgId: org.id,
      adminId: _gate.admin.id,
      adminEmail: _gate.admin.email,
      adminLabel: _gate.admin.label,
      action: "moving_rule_upsert",
      detail: `Création règle « ${rule?.name} » (prio ${rule?.priority}, ${conditions.length} cond.)`
    })
    return c.json({ ok: true, rule })
  })

  v1.patch("/org/moving-rules/:ruleId", async (c) => {
    const _gate = await requireConsoleAuth(c, "manage_policies")
    if (!_gate.ok) return c.json({ error: _gate.error }, _gate.status)
    const org = await store.getOrg(_gate.orgId)
    if (!org) return c.json({ error: "no_org" }, 404)
    let body: Record<string, unknown>
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: "invalid_json" }, 400)
    }
    const existing = (await store.listMovingRules(org.id)).find(
      (r) => r.id === c.req.param("ruleId")
    )
    if (!existing) return c.json({ error: "not_found" }, 404)
    const bodyConds = body.conditions as
      | Array<{
          field: "device_label" | "host_name"
          op: "starts_with" | "contains" | "equals" | "regex"
          value: string
        }>
      | undefined
    const conditions =
      bodyConds && bodyConds.length > 0
        ? bodyConds
        : existing.conditions?.length
          ? existing.conditions
          : [
              {
                field:
                  (body.match_field as typeof existing.matchField) ||
                  existing.matchField,
                op:
                  (body.match_op as typeof existing.matchOp) || existing.matchOp,
                value:
                  (body.match_value as string) || existing.matchValue
              }
            ]
    const rule = await store.upsertMovingRule(org.id, {
      id: existing.id,
      name: (body.name as string) || existing.name,
      enabled:
        body.enabled !== undefined ? !!body.enabled : existing.enabled,
      conditions,
      targetGroupId:
        (body.target_group_id as string) || existing.targetGroupId,
      priority:
        body.priority !== undefined
          ? Number(body.priority)
          : existing.priority,
      onlyIfUnassigned:
        body.only_if_unassigned !== undefined
          ? !!body.only_if_unassigned
          : existing.onlyIfUnassigned
    })
    await store.appendAdminAudit({
      orgId: org.id,
      adminId: _gate.admin.id,
      adminEmail: _gate.admin.email,
      adminLabel: _gate.admin.label,
      action: "moving_rule_upsert",
      detail: `Modif règle « ${rule?.name} » (prio ${rule?.priority})`
    })
    return c.json({ ok: true, rule })
  })

  v1.delete("/org/moving-rules/:ruleId", async (c) => {
    const _gate = await requireConsoleAuth(c, "manage_policies")
    if (!_gate.ok) return c.json({ error: _gate.error }, _gate.status)
    const org = await store.getOrg(_gate.orgId)
    if (!org) return c.json({ error: "no_org" }, 404)
    const ok = await store.deleteMovingRule(org.id, c.req.param("ruleId"))
    if (!ok) return c.json({ error: "not_found" }, 404)
    await store.appendAdminAudit({
      orgId: org.id,
      adminId: _gate.admin.id,
      adminEmail: _gate.admin.email,
      adminLabel: _gate.admin.label,
      action: "moving_rule_delete",
      detail: `Suppression règle ${c.req.param("ruleId")}`
    })
    return c.json({ ok: true })
  })

  v1.post("/org/moving-rules/apply-all", async (c) => {
    const _gate = await requireConsoleAuth(c, "manage_policies")
    if (!_gate.ok) return c.json({ error: _gate.error }, _gate.status)
    const org = await store.getOrg(_gate.orgId)
    if (!org) return c.json({ error: "no_org" }, 404)
    const agents = await store.listAgents(org.id)
    let applied = 0
    for (const a of agents) {
      const r = await store.applyMovingRules(org.id, a.id)
      if (r.applied) applied++
    }
    await store.appendAdminAudit({
      orgId: org.id,
      adminId: _gate.admin.id,
      adminEmail: _gate.admin.email,
      adminLabel: _gate.admin.label,
      action: "moving_rule_apply",
      detail: `Ré-évaluation ${applied}/${agents.length} agents`
    })
    await store.forceConfigSync(org.id)
    return c.json({ ok: true, applied, total: agents.length })
  })

  v1.post("/org/agents/bulk-assign", async (c) => {
    const _gate = await requireConsoleAuth(c, "manage_policies")
    if (!_gate.ok) return c.json({ error: _gate.error }, _gate.status)
    const org = await store.getOrg(_gate.orgId)
    if (!org) return c.json({ error: "no_org" }, 404)
    let body: {
      agent_ids?: string[]
      policy_profile_id?: string | null
      group_id?: string | null
    }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: "invalid_json" }, 400)
    }
    if (!body.agent_ids?.length) {
      return c.json({ error: "agent_ids_required" }, 400)
    }
    const result = await store.bulkAssignAgents(org.id, body.agent_ids, {
      policyProfileId: body.policy_profile_id,
      groupId: body.group_id
    })
    await store.appendAdminAudit({
      orgId: org.id,
      adminId: _gate.admin.id,
      adminEmail: _gate.admin.email,
      adminLabel: _gate.admin.label,
      action: "agent_assign",
      detail: `Bulk assign ${result.updated} agent(s)`,
      meta: body as Record<string, unknown>
    })
    return c.json({ ok: true, ...result })
  })

  v1.get("/org/events", async (c) => {
    const _gate = await requireConsoleAuth(c, "console_access")
    if (!_gate.ok) return c.json({ error: _gate.error }, _gate.status)
    const org = await store.getOrg(_gate.orgId)
    if (!org) return c.json({ error: "no_org" }, 404)
    const { mergeMonitoringSettings } = await import("./types")
    const mon = mergeMonitoringSettings(org.monitoring)
    await store.purgeOldEvents(org.id, mon.logRetentionDays)
    void ensureWeeklyExportIfDue(org.id).catch(() => {
      /* non bloquant */
    })
    const raw = await store.listEvents(org.id, 500)
    // snake_case stable — mask_send / send_anyway / cancel / enroll / unenroll
    const events = raw.map(publicEvent)
    const oldest = raw.length
      ? raw.reduce((a, b) =>
          Date.parse(a.ts) < Date.parse(b.ts) ? a : b
        ).ts
      : undefined
    const { daysUntilPurge } = await import("./events-export")
    const remaining = daysUntilPurge(oldest, mon.logRetentionDays)
    return c.json({
      org_id: org.id,
      events,
      count: events.length,
      retention: {
        days: mon.logRetentionDays,
        weekly_export_enabled: mon.weeklyExportEnabled,
        oldest_event_ts: oldest || null,
        days_until_oldest_purge: remaining,
        note:
          "La rétention est définie par l’entreprise (Monitoring). Exportez avant purge."
      }
    })
  })

  /** Export téléchargeable (semaine / tout / custom from-to) — CSV ou JSON */
  v1.get("/org/events/export", async (c) => {
    const _gate = await requireConsoleAuth(c, "console_access")
    if (!_gate.ok) return c.json({ error: _gate.error }, _gate.status)
    const org = await store.getOrg(_gate.orgId)
    if (!org) return c.json({ error: "no_org" }, 404)
    const range = (c.req.query("range") || "week") as "week" | "all" | "custom"
    const format = (c.req.query("format") || "csv") as "csv" | "json"
    const storeExport = c.req.query("store") === "1"
    const fromQ = c.req.query("from") || ""
    const toQ = c.req.query("to") || ""
    const { mergeMonitoringSettings } = await import("./types")
    const mon = mergeMonitoringSettings(org.monitoring)
    const {
      previousIsoWeekRange,
      filterEventsRange,
      eventsToCsv,
      eventsToJson,
      daysUntilPurge
    } = await import("./events-export")
    const all = await store.listEvents(org.id, 5000)
    let slice = all
    let fromTs = all.length
      ? all.reduce((a, b) =>
          Date.parse(a.ts) < Date.parse(b.ts) ? a : b
        ).ts
      : new Date().toISOString()
    let toTs = new Date().toISOString()
    let label = "all"
    if (range === "week") {
      const { from, to, weekKey } = previousIsoWeekRange()
      slice = filterEventsRange(all, from.getTime(), to.getTime())
      fromTs = from.toISOString()
      toTs = to.toISOString()
      label = weekKey
    } else if (range === "custom" || fromQ || toQ) {
      const fromMs = fromQ
        ? Date.parse(fromQ.length <= 10 ? fromQ + "T00:00:00.000Z" : fromQ)
        : 0
      const toMs = toQ
        ? Date.parse(toQ.length <= 10 ? toQ + "T23:59:59.999Z" : toQ)
        : Date.now()
      if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs > toMs) {
        return c.json({ error: "invalid_date_range" }, 400)
      }
      slice = filterEventsRange(all, fromMs, toMs)
      fromTs = new Date(fromMs).toISOString()
      toTs = new Date(toMs).toISOString()
      label = `${fromQ || "start"}_${toQ || "end"}`.replace(/[^\w.-]+/g, "-")
    }
    const content =
      format === "json" ? eventsToJson(slice) : eventsToCsv(slice)
    const filename = `opsgate-events-${label}.${format}`
    if (storeExport) {
      const rec = await store.saveLogExport(org.id, {
        kind: range === "week" ? "week" : "manual",
        format,
        filename,
        content,
        eventCount: slice.length,
        fromTs,
        toTs,
        expiresAt: new Date(
          Date.now() + Math.max(mon.logRetentionDays, 30) * 86400000
        ).toISOString()
      })
      await audit(
        _gate,
        "events_export",
        `Export ${range} ${format} · ${slice.length} events · stocké ${rec.id.slice(0, 10)}…`
      )
    } else {
      await audit(
        _gate,
        "events_export",
        `Export ${range} ${format} · ${slice.length} events (téléchargement direct)`
      )
    }
    const oldest = slice.length
      ? slice.reduce((a, b) =>
          Date.parse(a.ts) < Date.parse(b.ts) ? a : b
        ).ts
      : undefined
    return c.json({
      ok: true,
      filename,
      format,
      range,
      content,
      count: slice.length,
      from_ts: fromTs,
      to_ts: toTs,
      retention_days: mon.logRetentionDays,
      days_until_oldest_purge: daysUntilPurge(oldest, mon.logRetentionDays)
    })
  })

  /** Archives disponibles (hebdo auto + manuels stockés) */
  v1.get("/org/events/exports", async (c) => {
    const _gate = await requireConsoleAuth(c, "console_access")
    if (!_gate.ok) return c.json({ error: _gate.error }, _gate.status)
    void ensureWeeklyExportIfDue(_gate.orgId).catch(() => {
      /* ignore */
    })
    const list = await store.listLogExports(_gate.orgId)
    return c.json({
      org_id: _gate.orgId,
      exports: list.map((x) => ({
        id: x.id,
        kind: x.kind,
        format: x.format,
        filename: x.filename,
        event_count: x.eventCount,
        from_ts: x.fromTs,
        to_ts: x.toTs,
        created_at: x.createdAt,
        expires_at: x.expiresAt,
        remaining_days: Math.max(
          0,
          Math.ceil((Date.parse(x.expiresAt) - Date.now()) / 86400000)
        )
      }))
    })
  })

  v1.get("/org/events/exports/:exportId", async (c) => {
    const _gate = await requireConsoleAuth(c, "console_access")
    if (!_gate.ok) return c.json({ error: _gate.error }, _gate.status)
    const rec = await store.getLogExport(
      _gate.orgId,
      c.req.param("exportId")
    )
    if (!rec) return c.json({ error: "export_not_found" }, 404)
    return c.json({
      ok: true,
      id: rec.id,
      filename: rec.filename,
      format: rec.format,
      content: rec.content,
      event_count: rec.eventCount,
      from_ts: rec.fromTs,
      to_ts: rec.toTs,
      created_at: rec.createdAt,
      expires_at: rec.expiresAt,
      remaining_days: Math.max(
        0,
        Math.ceil((Date.parse(rec.expiresAt) - Date.now()) / 86400000)
      )
    })
  })

  v1.get("/org/policy", async (c) => {
    const _gate = await requireConsoleAuth(c, "console_access")
    if (!_gate.ok) return c.json({ error: _gate.error }, _gate.status)
    const org = await store.getOrg(_gate.orgId)
    if (!org) return c.json({ error: "no_org" }, 404)
    return c.json({ org, policy: await store.getPolicy(org.id) })
  })

  v1.patch("/org/policy", async (c) => {
    const _gate = await requireConsoleAuth(c, "console_access")
    if (!_gate.ok) return c.json({ error: _gate.error }, _gate.status)
    const org = await store.getOrg(_gate.orgId)
    if (!org) return c.json({ error: "no_org" }, 404)

    let body: {
      default_action?: Policy["defaultAction"]
      enabled_hosts?: string[]
      scan_uploads?: boolean
      event_reporting?: boolean
      protect_unenroll?: boolean
      user_messages?: Partial<import("./types").PolicyUserMessages>
      work_schedule?: import("./types").WorkSchedule | null
      /** Mot de passe admin en clair (hash only en base) */
      management_password?: string
    }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: "invalid_json" }, 400)
    }

    const patch: Parameters<typeof store.updatePolicy>[1] = {}
    if (body.default_action !== undefined)
      patch.defaultAction = body.default_action
    if (body.enabled_hosts !== undefined)
      patch.enabledHosts = body.enabled_hosts
    if (body.scan_uploads !== undefined) patch.scanUploads = body.scan_uploads
    if (body.event_reporting !== undefined)
      patch.eventReporting = body.event_reporting
    if (body.protect_unenroll !== undefined)
      patch.protectUnenroll = body.protect_unenroll
    if (body.user_messages !== undefined)
      patch.userMessages = body.user_messages
    if (body.work_schedule !== undefined)
      patch.workSchedule = body.work_schedule
    // string non vide ≥6 → active le mdp ; string vide → retire le mdp (sortie libre)
    if (typeof body.management_password === "string") {
      if (body.management_password.length === 0) {
        patch.managementPasswordHash = ""
      } else if (body.management_password.length >= 6) {
        patch.managementPasswordHash = hashManagementPassword(
          body.management_password
        )
      } else {
        return c.json(
          { error: "management_password_too_short", min: 6 },
          400
        )
      }
    }

    const policy = await store.updatePolicy(org.id, patch)
    const parts: string[] = []
    if (patch.defaultAction !== undefined)
      parts.push(`action=${patch.defaultAction}`)
    if (patch.enabledHosts)
      parts.push(`hosts=[${patch.enabledHosts.slice(0, 8).join(", ")}${patch.enabledHosts.length > 8 ? "…" : ""}] (${patch.enabledHosts.length})`)
    if (patch.scanUploads !== undefined)
      parts.push(`uploads=${patch.scanUploads}`)
    if (patch.eventReporting !== undefined)
      parts.push(`events=${patch.eventReporting}`)
    if (patch.protectUnenroll !== undefined)
      parts.push(`protect_unenroll=${patch.protectUnenroll}`)
    if (patch.userMessages !== undefined) {
      const keys = Object.keys(patch.userMessages || {})
      parts.push(
        keys.length
          ? `messages_banner=[${keys.join(",")}]`
          : "messages_banner=reset"
      )
    }
    if (patch.managementPasswordHash !== undefined)
      parts.push(
        patch.managementPasswordHash
          ? "mdp_désinscription=modifié"
          : "mdp_désinscription=retiré"
      )
    if (patch.rulesPackVersion)
      parts.push(`pack=${patch.rulesPackVersion}`)
    if (patch.configEpoch !== undefined)
      parts.push(`epoch=${patch.configEpoch}`)
    await audit(
      _gate,
      "policy_update",
      parts.length > 0
        ? `Policy org · ${parts.join(" · ")}`
        : "Mise à jour policy org",
      {
        fields: Object.keys(patch),
        hosts_count: patch.enabledHosts?.length,
        default_action: patch.defaultAction,
        event_reporting: patch.eventReporting
      }
    )
    return c.json({
      ok: true,
      policy: policy
        ? {
            ...policy,
            // ne jamais renvoyer le mdp en clair
            managementPasswordHash: policy.managementPasswordHash
              ? "[set]"
              : "[empty]"
          }
        : null
    })
  })

  v1.get("/org/rules/packs", async (c) => {
    const _gate = await requireConsoleAuth(c, "console_access")
    if (!_gate.ok) return c.json({ error: _gate.error }, _gate.status)
    const org = await store.getOrg(_gate.orgId)
    if (!org) return c.json({ error: "no_org" }, 404)

    const list = await store.listPacks(org.id)
    const active = await store.getActivePack(org.id)
    const packs = list.map((p) => ({
      version: p.version,
      active: p.active,
      rules_count: p.rules.length,
      checksum: p.checksum,
      signature: p.signature,
      notes: p.notes,
      published_at: p.publishedAt,
      published_by: p.publishedBy
    }))
    return c.json({
      org_id: org.id,
      active_version: active?.version,
      packs
    })
  })

  v1.get("/org/rules/packs/:version", async (c) => {
    const _gate = await requireConsoleAuth(c, "console_access")
    if (!_gate.ok) return c.json({ error: _gate.error }, _gate.status)
    const org = await store.getOrg(_gate.orgId)
    if (!org) return c.json({ error: "no_org" }, 404)
    const pack = await store.getPack(org.id, c.req.param("version"))
    if (!pack) return c.json({ error: "pack_not_found" }, 404)
    return c.json(toPayload(pack))
  })

  v1.post("/org/rules/packs", async (c) => {
    const _gate = await requireConsoleAuth(c, "console_access")
    if (!_gate.ok) return c.json({ error: _gate.error }, _gate.status)
    const org = await store.getOrg(_gate.orgId)
    if (!org) return c.json({ error: "no_org" }, 404)

    let body: {
      rules?: DetectionRule[]
      disable_rule_ids?: string[]
      notes?: string
      activate?: boolean
    }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: "invalid_json" }, 400)
    }

    if (body.rules) {
      const v = validateRules(body.rules)
      if (!v.ok) {
        return c.json({ error: "validation_failed", details: v.errors }, 400)
      }
    }

    const disabledIds = (body.disable_rule_ids || [])
      .map((s) => String(s).trim())
      .filter(Boolean)

    const result = await store.publishPack({
      orgId: org.id,
      rules: body.rules,
      disableRuleIds: disabledIds.length ? disabledIds : undefined,
      notes: body.notes,
      activate: body.activate,
      publishedBy: _gate.admin.email || _gate.admin.label || "admin"
    })

    if (!result.ok) {
      return c.json({ error: "publish_failed", details: result.errors }, 400)
    }

    const disabledNote =
      disabledIds.length > 0
        ? ` — RÈGLES DÉSACTIVÉES (${disabledIds.length}) : ${disabledIds.join(", ")}`
        : ""
    await store.appendAdminAudit({
      orgId: org.id,
      adminId: _gate.admin.id,
      adminEmail: _gate.admin.email,
      adminLabel: _gate.admin.label,
      action: disabledIds.length > 0 ? "rule_disable" : "pack_publish",
      detail: `Pack ${result.pack.version} publié${result.pack.active ? " & activé" : ""}${disabledNote}`,
      meta: {
        version: result.pack.version,
        rules_count: result.pack.rules.length,
        disabled_rule_ids: disabledIds,
        notes: body.notes || null
      }
    })
    // Double trace lisible si désactivation (filtre audit « rule_disable »)
    if (disabledIds.length > 0) {
      await store.appendAdminAudit({
        orgId: org.id,
        adminId: _gate.admin.id,
        adminEmail: _gate.admin.email,
        adminLabel: _gate.admin.label,
        action: "pack_publish",
        detail: `Pack ${result.pack.version} (${result.pack.rules.length} règles actives après retrait)`
      })
    }

    return c.json({
      ok: true,
      version: result.pack.version,
      active: result.pack.active,
      rules_count: result.pack.rules.length,
      disabled_rule_ids: disabledIds,
      checksum: result.pack.checksum,
      signature: result.pack.signature,
      policy_version: result.policy.version,
      notes: result.pack.notes
    })
  })

  v1.post("/org/rules/packs/:version/activate", async (c) => {
    const _gate = await requireConsoleAuth(c, "console_access")
    if (!_gate.ok) return c.json({ error: _gate.error }, _gate.status)
    const org = await store.getOrg(_gate.orgId)
    if (!org) return c.json({ error: "no_org" }, 404)

    const result = await store.activatePack(org.id, c.req.param("version"))
    if (!result.ok) {
      return c.json({ error: result.error }, 404)
    }
    return c.json({
      ok: true,
      version: result.pack.version,
      policy_version: result.policy.version,
      rules_count: result.pack.rules.length
    })
  })

  v1.delete("/org/rules/packs/:version", async (c) => {
    const _gate = await requireConsoleAuth(c, "console_access")
    if (!_gate.ok) return c.json({ error: _gate.error }, _gate.status)
    const org = await store.getOrg(_gate.orgId)
    if (!org) return c.json({ error: "no_org" }, 404)
    const version = c.req.param("version")
    const result = await store.deletePack(org.id, version)
    if (!result.ok) {
      return c.json({ error: result.error || "delete_failed" }, 400)
    }
    await audit(
      _gate,
      "pack_publish",
      `Suppression pack non actif ${version}`,
      { version }
    )
    return c.json({ ok: true, version })
  })

  app.route("/v1", v1)
  app.notFound((c) => c.json({ error: "not_found" }, 404))
  return app
}

function policyEtag(
  policyVersion: number | string,
  rulesVersion: string
): string {
  return `W/"pol-${policyVersion}-rules-${rulesVersion}"`
}
