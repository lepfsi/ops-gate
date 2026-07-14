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
        ? "Existing device re-enrolled (same label) — previous token revoked."
        : org.isPersonal
          ? "Personal account enrolled. Management local : Options + API locale (pas encore de portal cloud)."
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
    const pack = await store.getActivePack(orgId)
    const effectiveBundle = await store.getEffectivePolicyForAgent(
      orgId,
      agentId
    )
    if (!org || !pack || !effectiveBundle) {
      return c.json({ error: "not_found" }, 404)
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
    const graceMs = 5 * 60 * 1000
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
         * Recovery vendor — agent ne l'accepte que si offline > 2h
         * (évite désinscription massive si fuite du secret).
         */
        recovery_password_hash: getVendorRecoveryHash(),
        recovery_offline_after_ms: VENDOR_RECOVERY_OFFLINE_MS,
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
      created_at: a.createdAt,
      updated_at: a.updatedAt
    }
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
    const result = await store.createAdminSession(body.email, body.password, {
      force: !!body.force
    })
    if (!result.ok) {
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
    await store.appendAdminAudit({
      orgId: result.session.orgId,
      adminId: result.admin.id,
      adminEmail: result.admin.email,
      adminLabel: result.admin.label,
      action: "login",
      detail: result.forced
        ? "Connexion console (prise de contrôle — session précédente révoquée)"
        : "Connexion console"
    })
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
    return c.json(await store.summary(auth.orgId))
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
        const graceMs = 5 * 60 * 1000
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
    const decision = c.req.param("decision")
    const all = await store.listEvents(org.id, 500)
    const events = all.filter((e) => e.decision === decision)
    return c.json({ org_id: org.id, decision, events })
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
    const org = await store.getOrg(_gate.orgId)
    if (!org) return c.json({ error: "no_org" }, 404)
    let body: {
      label?: string
      email?: string
      password?: string
      permissions?: AdminPermission[]
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
    const admin = await store.upsertAdmin(org.id, {
      label: body.label.trim(),
      email: body.email.trim(),
      password: body.password,
      permissions: body.permissions
    })
    if (!admin) {
      return c.json(
        { error: "create_failed_email_exists_or_invalid" },
        400
      )
    }
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
    if (!existing || existing.isPrincipal) {
      return c.json({ error: "secondary_admin_only" }, 400)
    }
    const admin = await store.upsertAdmin(org.id, {
      id: existing.id,
      label: existing.label,
      email: existing.email,
      password: body.new_password,
      mustChangePassword: true
    })
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
    const ok = await store.deleteAdmin(org.id, c.req.param("adminId"))
    if (!ok) {
      return c.json(
        { error: "admin_not_found_or_is_principal" },
        400
      )
    }
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
    return c.json({ org_id: org.id, ...stats })
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
    return c.json({ ok: true, user })
  })

  v1.delete("/org/users/:userId", async (c) => {
    const _gate = await requireConsoleAuth(c, "console_access")
    if (!_gate.ok) return c.json({ error: _gate.error }, _gate.status)
    const org = await store.getOrg(_gate.orgId)
    if (!org) return c.json({ error: "no_org" }, 404)
    const ok = await store.deleteUser(org.id, c.req.param("userId"))
    if (!ok) return c.json({ error: "user_not_found" }, 404)
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
    return c.json({ ok: true, group })
  })

  v1.delete("/org/groups/:groupId", async (c) => {
    const _gate = await requireConsoleAuth(c, "console_access")
    if (!_gate.ok) return c.json({ error: _gate.error }, _gate.status)
    const org = await store.getOrg(_gate.orgId)
    if (!org) return c.json({ error: "no_org" }, 404)
    const ok = await store.deleteGroup(org.id, c.req.param("groupId"))
    if (!ok) return c.json({ error: "group_not_found" }, 404)
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
    await store.appendAdminAudit({
      orgId: org.id,
      adminId: _gate.admin.id,
      adminEmail: _gate.admin.email,
      adminLabel: _gate.admin.label,
      action: "force_sync",
      detail: `epoch=${result.configEpoch}`
    })
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
      assigned_group_ids?: string[]
      assigned_user_ids?: string[]
      user_messages?: Partial<import("./types").PolicyUserMessages>
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
      assignedGroupIds: body.assigned_group_ids,
      assignedUserIds: body.assigned_user_ids,
      userMessages: body.user_messages
    })
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
      assigned_group_ids?: string[]
      assigned_user_ids?: string[]
      user_messages?: Partial<import("./types").PolicyUserMessages>
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
      userMessages:
        body.user_messages !== undefined
          ? body.user_messages
          : existing.userMessages,
      assignedGroupIds: body.assigned_group_ids ?? existing.assignedGroupIds,
      assignedUserIds: body.assigned_user_ids ?? existing.assignedUserIds
    })
    return c.json({ ok: true, profile })
  })

  v1.delete("/org/profiles/:profileId", async (c) => {
    const _gate = await requireConsoleAuth(c, "console_access")
    if (!_gate.ok) return c.json({ error: _gate.error }, _gate.status)
    const org = await store.getOrg(_gate.orgId)
    if (!org) return c.json({ error: "no_org" }, 404)
    const ok = await store.deleteProfile(org.id, c.req.param("profileId"))
    if (!ok) return c.json({ error: "profile_not_found" }, 404)
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

  /** Vendor recovery — info limitée au principal */
  v1.get("/org/recovery-info", async (c) => {
    const _gate = await requireConsoleAuth(c, "console_access")
    if (!_gate.ok) return c.json({ error: _gate.error }, _gate.status)
    if (!_gate.admin.isPrincipal) {
      return c.json({ error: "principal_only" }, 403)
    }
    return c.json({
      ok: true,
      note:
        "Recovery vendor UNIQUEMENT si agent offline > 2h (sync toutes les 15 min). N'ouvre pas les postes synchronisés.",
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
    const raw = await store.listEvents(org.id, 300)
    // Normaliser snake_case pour la console (décisions mask_send / send_anyway / cancel)
    const events = raw.map((e) => ({
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
    }))
    return c.json({ org_id: org.id, events })
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
      /** Mot de passe admin en clair — stocké en hash uniquement (legacy / admin1) */
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
    await store.appendAdminAudit({
      orgId: org.id,
      adminId: _gate.admin.id,
      adminEmail: _gate.admin.email,
      adminLabel: _gate.admin.label,
      action: "policy_update",
      detail:
        parts.length > 0
          ? `Policy org · ${parts.join(" · ")}`
          : "Mise à jour policy org",
      meta: {
        fields: Object.keys(patch),
        hosts_count: patch.enabledHosts?.length
      }
    })
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
