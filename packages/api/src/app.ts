import { Hono } from "hono"
import { cors } from "hono/cors"
import { secureHeaders } from "hono/secure-headers"
import { fileURLToPath } from "node:url"

import type { DetectionRule } from "@opsgate/engine"

import {
  getVendorRecoveryHash,
  hashManagementPassword,
  MIN_PASSWORD_LENGTH,
  newToken,
  PRINCIPAL_DEFAULT_PASSWORD,
  PRINCIPAL_SETUP_EMAIL,
  validatePasswordPolicy,
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
import { ALL_ADMIN_PERMISSIONS, normalizeDeviceLabel } from "./types"

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

  /**
   * Postgres RLS : lie chaque requête HTTP au tenant (org_id) via AsyncLocalStorage.
   * Paths publics / enroll / login restent en bypass service.
   */
  app.use("*", async (c, next) => {
    const st = getStore()
    if (st.kind !== "postgres") return next()
    const {
      getPgRlsMode,
      pathNeedsRlsBypass,
      withBypassRls,
      withOrgRls
    } = await import("./pg-rls")
    if (getPgRlsMode() === "off") return next()

    const path = c.req.path || ""
    if (pathNeedsRlsBypass(path)) {
      return withBypassRls(() => next())
    }

    const header = c.req.header("Authorization") || ""
    const match = header.match(/^Bearer\s+(.+)$/i)
    if (!match) {
      // Pas de token : bypass (handlers renverront 401) — strict aussi pour ne pas bloquer 401
      return withBypassRls(() => next())
    }
    const token = match[1]!.trim()

    // Résolution token sous bypass (session peut être n’importe quel org)
    const orgId = await withBypassRls(async () => {
      try {
        const admin = await store.resolveAdminSession(token)
        if (admin) return admin.session.orgId
      } catch {
        /* ignore */
      }
      try {
        const agent = await store.resolveAgentByToken(token)
        if (agent) return agent.orgId
      } catch {
        /* ignore */
      }
      return null
    })

    if (orgId) return withOrgRls(orgId, () => next())
    return withBypassRls(() => next())
  })

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

  app.get("/health", async (c) => {
    const { redisStatus } = await import("./redis")
    const { rateLimitBackend } = await import("./rate-limit")
    const { getPgRlsMode } = await import("./pg-rls")
    const redis = redisStatus()
    return c.json({
      ok: true,
      service: "opsgate-api",
      version: "1.2.0",
      ts: new Date().toISOString(),
      store: getStore().kind,
      rate_limit_backend: await rateLimitBackend(),
      redis,
      pg_rls:
        getStore().kind === "postgres"
          ? { mode: getPgRlsMode(), enabled: getPgRlsMode() !== "off" }
          : { mode: "n/a", enabled: false },
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
        "smtp-mail",
        "console-auth",
        "siem-syslog",
        "prometheus-metrics",
        "security-report-pdf",
        "redis-rate-limit",
        "multi-tenant-quotas",
        "postgres-rls",
        "ldap-ad-sync",
        "ldap-cron",
        "webauthn",
        "saml-sp"
      ],
      mail: (await import("./mail")).getMailStatus()
    })
  })

  /**
   * Prometheus scrape endpoint (V2 P0).
   * Auth optionnelle : header Authorization: Bearer $OPSGATE_METRICS_TOKEN
   * ou ?token= si OPSGATE_METRICS_TOKEN est défini.
   */
  app.get("/metrics", async (c) => {
    const expected = process.env.OPSGATE_METRICS_TOKEN?.trim()
    if (expected) {
      const auth = c.req.header("Authorization") || ""
      const bearer = auth.match(/^Bearer\s+(.+)$/i)?.[1]?.trim()
      const q = c.req.query("token") || ""
      if (bearer !== expected && q !== expected) {
        return c.text("unauthorized\n", 401)
      }
    }
    try {
      const { renderPrometheusMetrics } = await import("./metrics")
      const body = await renderPrometheusMetrics(store)
      return c.text(body, 200, {
        "content-type": "text/plain; version=0.0.4; charset=utf-8",
        "cache-control": "no-store"
      })
    } catch (e) {
      return c.text(`# error ${String((e as Error).message || e)}\n`, 500)
    }
  })

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
      /**
       * Type d’agent (info product) — extension | proxy.
       * Stocké dans device_label prefix / app_version si besoin ; pas de colonne dédiée V1.
       */
      device_type?: "extension" | "proxy"
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
    if (org.deletedAt) {
      return c.json(
        {
          error: "org_soft_deleted",
          message:
            "Organisation en cours de suppression RGPD — nouvel enroll refusé."
        },
        403
      )
    }

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

    // Quota max agents (multi-tenant) — sauf re-enroll même fingerprint
    {
      const { mergeMonitoringSettings } = await import("./types")
      const mon = mergeMonitoringSettings(org.monitoring)
      const maxAgents = mon.quotas?.maxAgents ?? 0
      if (maxAgents > 0) {
        const existing = await store.listAgents(org.id)
        const fp =
          body.device_fingerprint ||
          (body.device_type === "proxy"
            ? `proxy:${body.host_name || "local"}:${org.id.slice(0, 8)}`
            : undefined)
        const isReenroll =
          !!fp &&
          existing.some(
            (a) => a.deviceFingerprint && a.deviceFingerprint === fp
          )
        if (!isReenroll && existing.length >= maxAgents) {
          return c.json(
            {
              error: "quota_agents_exceeded",
              max: maxAgents,
              used: existing.length,
              message: `Quota agents atteint (${existing.length}/${maxAgents}).`
            },
            429
          )
        }
      }
    }

    const agentToken = newToken()
    const isProxy = body.device_type === "proxy"
    const rawLabel =
      body.device_label ||
      body.host_name ||
      (isProxy ? "proxy-host" : undefined)
    const agent = await store.enrollAgent({
      orgId: org.id,
      token: agentToken,
      deviceLabel: normalizeDeviceLabel(rawLabel, body.host_name),
      hostName: body.host_name,
      appVersion:
        body.app_version ||
        (isProxy ? "proxy-p3" : undefined),
      personalLicenseKey: body.personal_license_key,
      deviceFingerprint:
        body.device_fingerprint ||
        (isProxy
          ? `proxy:${body.host_name || "local"}:${org.id.slice(0, 8)}`
          : undefined),
      deviceType: isProxy ? "proxy" : "extension"
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
      device_type: isProxy ? "proxy" : "extension",
      policy_etag: etag,
      rules_pack_version: policy.rulesPackVersion,
      replaced: !!agent.replaced,
      license_assigned: agent.licenseAssigned,
      message: agent.replaced
        ? "Existing installation re-enrolled (same fingerprint) — previous token revoked."
        : org.isPersonal
          ? "Personal account enrolled."
          : isProxy
            ? "Proxy enrolled. Store agent_token (shown once)."
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
    if (org?.deletedAt) {
      return c.json(
        {
          error: "org_soft_deleted",
          message: "Organisation en suppression RGPD — agent désactivé."
        },
        403
      )
    }
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

    const { mergeMonitoringSettings } = await import("./types")
    const mon = mergeMonitoringSettings(org.monitoring)

    return c.json({
      etag,
      org: {
        id: org.id,
        name: org.name,
        mode: org.modeDefault,
        event_payload_policy: org.eventPayloadPolicy,
        personal: !!org.isPersonal
      },
      /** P3 — flags proxy org (agents proxy / futur enforce) */
      proxy: {
        enabled: mon.proxy?.enabled !== false,
        mode: mon.proxy?.mode === "enforce" ? "enforce" : "observe"
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

  function serializeInboxMessage(m: import("./types").UserInboxMessage) {
    return {
      id: m.id,
      org_id: m.orgId,
      agent_id: m.agentId,
      device_label: m.deviceLabel,
      host_name: m.hostName ?? null,
      category: m.category,
      subject: m.subject,
      body: m.body,
      context_url: m.contextUrl ?? null,
      context_hostname: m.contextHostname ?? null,
      status: m.status,
      created_at: m.createdAt,
      read_at: m.readAt ?? null,
      replied_at: m.repliedAt ?? null,
      closed_at: m.closedAt ?? null,
      admin_reply: m.adminReply ?? null,
      replied_by_admin_id: m.repliedByAdminId ?? null,
      replied_by_admin_label: m.repliedByAdminLabel ?? null,
      user_acked_at: m.userAckedAt ?? null,
      needs_user_ack: !!(m.adminReply && !m.userAckedAt)
    }
  }

  /** Agent : envoyer un message à l’admin org (inbox) */
  v1.post("/agents/me/messages", async (c) => {
    const orgId = c.get("orgId")
    const agentId = c.get("agentId")
    const agents = await store.listAgents(orgId)
    const agent = agents.find((a) => a.id === agentId)
    let body: {
      subject?: string
      body?: string
      category?: string
      context_url?: string
      context_hostname?: string
    }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: "invalid_json" }, 400)
    }
    const catRaw = (body.category || "question").trim()
    const category = (
      ["question", "exception", "block_appeal", "other"].includes(catRaw)
        ? catRaw
        : "question"
    ) as import("./types").InboxMessageCategory
    const result = await store.createInboxMessage({
      orgId,
      agentId,
      deviceLabel: agent?.deviceLabel,
      hostName: agent?.hostName,
      category,
      subject: body.subject || "",
      body: body.body || "",
      contextUrl: body.context_url,
      contextHostname: body.context_hostname
    })
    if (!result.ok) {
      const status =
        result.error === "rate_limited"
          ? 429
          : result.error === "subject_too_short" ||
              result.error === "body_too_short"
            ? 400
            : 400
      return c.json(
        {
          error: result.error,
          message:
            result.error === "rate_limited"
              ? "Trop de messages (max 15 / 24 h). Réessayez plus tard."
              : result.error === "subject_too_short"
                ? "Objet trop court (min. 3 caractères)."
                : result.error === "body_too_short"
                  ? "Message trop court (min. 5 caractères)."
                  : result.error
        },
        status
      )
    }
    return c.json(
      { ok: true, message: serializeInboxMessage(result.message) },
      201
    )
  })

  /** Agent : lister ses messages (+ réponses admin) */
  v1.get("/agents/me/messages", async (c) => {
    const orgId = c.get("orgId")
    const agentId = c.get("agentId")
    const pendingOnly = c.req.query("pending_ack") === "1"
    if (pendingOnly) {
      const pending = await store.listPendingAdminReplies(orgId, agentId)
      return c.json({
        messages: pending.map(serializeInboxMessage),
        pending_ack: pending.length
      })
    }
    const limit = Math.min(
      50,
      Math.max(1, Number(c.req.query("limit") || 20) || 20)
    )
    const messages = await store.listInboxMessages(orgId, {
      agentId,
      limit
    })
    const pending = await store.listPendingAdminReplies(orgId, agentId)
    return c.json({
      messages: messages.map(serializeInboxMessage),
      pending_ack: pending.length
    })
  })

  /** Agent : acquitter la réponse admin (ferme le popup) */
  v1.post("/agents/me/messages/:id/ack", async (c) => {
    const orgId = c.get("orgId")
    const agentId = c.get("agentId")
    const id = c.req.param("id")
    const msg = await store.ackInboxMessage(orgId, id, agentId)
    if (!msg || msg.agentId !== agentId) {
      return c.json({ error: "not_found" }, 404)
    }
    return c.json({ ok: true, message: serializeInboxMessage(msg) })
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

    // Enrichir + normaliser label (sans préfixe « OpsGate Proxy »)
    const cleanAgentLabel = normalizeDeviceLabel(
      agent.deviceLabel,
      agent.hostName
    )
    const enriched = events.map((ev) => ({
      ...ev,
      device_label:
        normalizeDeviceLabel(ev.device_label, agent.hostName) ||
        cleanAgentLabel
    }))

    const cats = await orgLogCategories(agent.orgId)
    // Séparer bruit proxy vs détection extension
    const allProxy = enriched.every((e) => e.source === "proxy")
    const allExt = enriched.every((e) => e.source !== "proxy")
    if (allProxy && cats.proxyEvents === false) {
      return c.json({
        ok: true,
        accepted: 0,
        skipped: true,
        reason: "log_category_proxy_disabled"
      })
    }
    if (allExt && cats.detectionEvents === false) {
      return c.json({
        ok: true,
        accepted: 0,
        skipped: true,
        reason: "log_category_detection_disabled"
      })
    }
    // Batch mixte : filtrer
    let toStore = enriched
    if (cats.proxyEvents === false) {
      toStore = toStore.filter((e) => e.source !== "proxy")
    }
    if (cats.detectionEvents === false) {
      toStore = toStore.filter((e) => e.source === "proxy")
    }
    if (toStore.length === 0) {
      return c.json({
        ok: true,
        accepted: 0,
        skipped: true,
        reason: "log_categories_filtered_all"
      })
    }
    // Quotas multi-tenant (events/min + events/jour) + rate limit org
    {
      const orgQ = await store.getOrg(agent.orgId)
      const { mergeMonitoringSettings } = await import("./types")
      const monQ = mergeMonitoringSettings(orgQ?.monitoring)
      const {
        checkAndIncrEventQuota,
        checkAndIncrEventMinuteQuota,
        rateLimitCheck
      } = await import("./rate-limit")
      // Rate limit global events/org (env)
      const evPerMinEnv = Number(
        process.env.OPSGATE_RATE_EVENTS_PER_MIN || 0
      )
      if (evPerMinEnv > 0) {
        const rl = await rateLimitCheck(
          `events:${agent.orgId}`,
          evPerMinEnv,
          60_000
        )
        if (!rl.ok) {
          return c.json(
            {
              error: "rate_limited",
              retry_after_sec: rl.retryAfterSec,
              message: "Trop d’events pour cette org. Réessayez plus tard."
            },
            429
          )
        }
      }
      const maxMin = monQ.quotas?.maxEventsPerMinute ?? 0
      if (maxMin > 0) {
        const qMin = await checkAndIncrEventMinuteQuota(
          agent.orgId,
          toStore.length,
          maxMin
        )
        if (!qMin.ok) {
          return c.json(
            {
              error: "quota_exceeded_minute",
              used: qMin.used,
              max: qMin.max,
              message: `Quota burst atteint (${qMin.used}/${qMin.max} events/min).`
            },
            429
          )
        }
      }
      const max = monQ.quotas?.maxEventsPerDay ?? 0
      if (max > 0) {
        const q = await checkAndIncrEventQuota(
          agent.orgId,
          toStore.length,
          max
        )
        if (!q.ok) {
          return c.json(
            {
              error: "quota_exceeded",
              used: q.used,
              max: q.max,
              message: `Quota org atteint (${q.used}/${q.max} events/jour UTC).`
            },
            429
          )
        }
      }
    }

    const result = await store.appendEvents(agent.orgId, agent.id, toStore)
    // V2 P0 : compteurs Prometheus + forward SIEM (best-effort)
    try {
      const { recordAcceptedEvents, forwardEventsToSiem, recordSiemForwarded } =
        await import("./siem")
      recordAcceptedEvents(toStore as import("./types").StoredEvent[])
      const org = await store.getOrg(agent.orgId)
      const { mergeMonitoringSettings } = await import("./types")
      const mon = mergeMonitoringSettings(org?.monitoring)
      if (mon.siem?.enabled && mon.siem.host) {
        const stored = (toStore as import("./types").StoredEvent[]).map(
          (e, i) => ({
            ...e,
            orgId: agent.orgId,
            agentId: agent.id,
            id: `fwd-${i}`,
            receivedAt: new Date().toISOString()
          })
        )
        forwardEventsToSiem(stored, mon.siem, { orgId: agent.orgId })
        recordSiemForwarded(stored.length)
      }
    } catch {
      /* non bloquant */
    }
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
      mfa_enabled: !!a.totpEnabled,
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
      device_label: normalizeDeviceLabel(e.device_label) ?? null,
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
      req: {
        header: (n: string) => string | undefined
        method?: string
        path?: string
      }
    },
    perm?: AdminPermission
  ): Promise<
    | { ok: true; admin: OrgAdmin; orgId: string; readOnly: boolean }
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
        return { ok: true, admin: principal, orgId: org.id, readOnly: false }
      }
    }
    if (!match) return { ok: false, status: 401, error: "unauthorized" }
    const resolved = await store.resolveAdminSession(match[1].trim())
    if (!resolved) return { ok: false, status: 401, error: "session_invalid" }
    const readOnly = !!resolved.session.readOnly
    if (readOnly) {
      const method = String(
        c.req.method ||
          (c as { req?: { method?: string } }).req?.method ||
          ""
      ).toUpperCase()
      const path = String(
        c.req.path || (c as { req?: { path?: string } }).req?.path || ""
      )
      const allowedMut =
        path.includes("/auth/logout") ||
        path.includes("/auth/session/challenge")
      // Si method connue et mutante → bloquer (sauf logout / challenge)
      if (
        method &&
        method !== "GET" &&
        method !== "HEAD" &&
        method !== "OPTIONS" &&
        !allowedMut
      ) {
        return { ok: false, status: 403, error: "read_only_session" }
      }
    }
    if (perm && !adminHas(resolved.admin, perm)) {
      return { ok: false, status: 403, error: "forbidden_permission" }
    }
    // Lecture seule : droits d’écriture bloqués même si principal
    if (
      readOnly &&
      perm &&
      perm !== "console_access" &&
      perm !== "email_password_reset"
    ) {
      return { ok: false, status: 403, error: "read_only_session" }
    }
    // Soft-delete RGPD : seules les routes /org/gdpr/* (+ logout) restent accessibles
    {
      const org = await store.getOrg(resolved.session.orgId)
      if (org?.deletedAt) {
        const path = String(
          c.req.path || (c as { req?: { path?: string } }).req?.path || ""
        )
        const method = String(
          c.req.method ||
            (c as { req?: { method?: string } }).req?.method ||
            "GET"
        ).toUpperCase()
        const gdprOk =
          path.includes("/org/gdpr") ||
          path.includes("/auth/logout") ||
          path.includes("/auth/me")
        if (!gdprOk) {
          return {
            ok: false,
            status: 403,
            error: "org_soft_deleted"
          }
        }
        // Mutations hors restore/export interdites
        if (
          method !== "GET" &&
          method !== "HEAD" &&
          method !== "OPTIONS" &&
          !path.includes("/org/gdpr") &&
          !path.includes("/auth/logout")
        ) {
          return { ok: false, status: 403, error: "org_soft_deleted" }
        }
      }
    }
    return {
      ok: true,
      admin: resolved.admin,
      orgId: resolved.session.orgId,
      readOnly
    }
  }

  /** Login console (MFA TOTP optionnel : totp_code) */
  v1.post("/auth/login", async (c) => {
    // Rate limit par IP (V2 P1 multi-tenant)
    const ip =
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
      c.req.header("x-real-ip") ||
      "local"
    const { rateLimitCheck } = await import("./rate-limit")
    const rl = await rateLimitCheck(
      `login:${ip}`,
      Number(process.env.OPSGATE_RATE_LOGIN_PER_MIN || 30),
      60_000
    )
    if (!rl.ok) {
      return c.json(
        {
          error: "rate_limited",
          retry_after_sec: rl.retryAfterSec,
          message: "Trop de tentatives de connexion. Réessayez plus tard."
        },
        429
      )
    }
    // SSO enforce : refuser le login password si OIDC actif
    {
      const { getOidcConfig, getOidcFeatureFlags } = await import("./oidc")
      const flags = getOidcFeatureFlags()
      if (flags.ssoEnforce && getOidcConfig()) {
        return c.json(
          {
            error: "sso_required",
            message:
              "Connexion par mot de passe désactivée. Utilisez SSO (OIDC)."
          },
          403
        )
      }
    }
    let body: {
      email?: string
      password?: string
      force?: boolean
      /** Session concurrente lecture seule (sans kick de la session ouverte) */
      read_only?: boolean
      totp_code?: string
      org_id?: string
      org_code?: string
    }
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
      // force legacy encore accepté (claim challenge utilise issueAdminSessionDirect)
      force: !!body.force,
      readOnly: !!body.read_only,
      totpCode: body.totp_code,
      orgId: body.org_id?.trim(),
      orgCode: body.org_code?.trim()
    })
    if (!result.ok) {
      if (result.error === "org_selection_required") {
        return c.json(
          {
            error: "org_selection_required",
            message:
              "Cet e-mail est admin de plusieurs organisations. Choisissez l’organisation.",
            orgs: result.orgs || []
          },
          409
        )
      }
      if (result.error === "mfa_required") {
        return c.json(
          {
            error: "mfa_required",
            message: "Code d’authentification à deux facteurs requis."
          },
          401
        )
      }
      if (result.error === "mfa_invalid") {
        return c.json(
          {
            error: "mfa_invalid",
            message: "Code MFA invalide ou expiré."
          },
          401
        )
      }
      if (result.error === "session_already_active") {
        // Challenge consentement (10 s) plutôt que force brute
        const {
          createSessionChallenge,
          publicChallengeView,
          SESSION_CHALLENGE_TIMEOUT_SEC
        } = await import("./session-challenge")
        if (result.orgId && result.adminId) {
          const ch = createSessionChallenge({
            orgId: result.orgId,
            adminId: result.adminId,
            adminEmail: result.adminEmail || emailKey,
            requesterHint: ip
          })
          return c.json(
            {
              error: "session_challenge_required",
              challenge_id: ch.id,
              expires_in: SESSION_CHALLENGE_TIMEOUT_SEC,
              challenge: publicChallengeView(ch),
              message:
                "Une session est déjà ouverte. La session active doit accepter, ou vous serez connecté après 10 s (ou en lecture seule)."
            },
            409
          )
        }
        return c.json(
          {
            error: "session_already_active",
            message:
              "Une session est déjà active. Réessayez ou connectez-vous en lecture seule."
          },
          409
        )
      }
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
              // Alertes multi-canaux si le client a activé l’événement
              if (mon.notifications?.accountLockoutEmail === true) {
                try {
                  const { dispatchOrgAlert } = await import("./notify-channels")
                  void dispatchOrgAlert({
                    notif: mon.notifications,
                    smtp: mon.smtp || null,
                    payload: {
                      title: "Compte admin verrouillé",
                      text: `Le compte ${hit.email} (${hit.label}) a été verrouillé après ${rec.count} échecs (seuil ${thr}).`,
                      orgName: org?.name,
                      orgCode: org?.orgCode
                    }
                  })
                } catch (e) {
                  console.warn(
                    "[alerts] lockout notify failed:",
                    e instanceof Error ? e.message : e
                  )
                }
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
      return c.json({ error: result.error }, 401)
    }
    const loginOrg = await store.getOrg(result.session.orgId)
    const orgSoftDeleted = !!loginOrg?.deletedAt
    await audit(
      {
        admin: result.admin,
        orgId: result.session.orgId
      },
      "login",
      orgSoftDeleted
        ? "Connexion console (org soft-deleted RGPD — restore uniquement)"
        : result.session.readOnly
          ? "Connexion console (lecture seule)"
          : result.forced
            ? "Connexion console (session précédente révoquée)"
            : "Connexion console"
    )
    return c.json({
      ok: true,
      token: result.session.token,
      expires_at: result.session.expiresAt,
      admin: publicAdminView(result.admin),
      forced: !!result.forced,
      read_only: !!result.session.readOnly,
      mfa_enabled: !!result.admin.totpEnabled,
      org_soft_deleted: orgSoftDeleted,
      org_purge_at: loginOrg?.deletePurgeAt || null,
      hint: orgSoftDeleted
        ? "Organisation en suppression RGPD : exportez vos données ou restaurez avant la date de purge."
        : result.admin.mustChangePassword
          ? "Changez le mot de passe par défaut (0000) dès que possible."
          : result.session.readOnly
            ? "Session lecture seule : consultation uniquement (l’autre session reste active)."
            : result.forced
              ? "L’autre session a été déconnectée."
              : undefined
    })
  })

  /**
   * Poll statut d’un challenge de session (écran login, sans auth).
   * GET /v1/auth/challenge/:id
   */
  v1.get("/auth/challenge/:id", async (c) => {
    const { getSessionChallenge, publicChallengeView } = await import(
      "./session-challenge"
    )
    const ch = getSessionChallenge(c.req.param("id"))
    if (!ch) return c.json({ error: "challenge_not_found" }, 404)
    return c.json({ ok: true, challenge: publicChallengeView(ch) })
  })

  /**
   * Claim après acceptation / timeout → émet la session full (kick l’ancienne).
   * POST /v1/auth/challenge/:id/claim
   */
  v1.post("/auth/challenge/:id/claim", async (c) => {
    const {
      getSessionChallenge,
      markChallengeClaimed,
      publicChallengeView
    } = await import("./session-challenge")
    const ch = getSessionChallenge(c.req.param("id"))
    if (!ch) return c.json({ error: "challenge_not_found" }, 404)
    if (ch.status === "refused") {
      return c.json(
        {
          error: "challenge_refused",
          message: "La session ouverte a refusé la prise de contrôle."
        },
        403
      )
    }
    if (ch.status === "pending") {
      return c.json(
        {
          error: "challenge_pending",
          challenge: publicChallengeView(ch),
          message: "En attente de la session ouverte…"
        },
        409
      )
    }
    if (ch.status === "claimed" || ch.status === "expired") {
      return c.json({ error: "challenge_expired" }, 410)
    }
    // accepted | timeout
    const issued = await store.issueAdminSessionDirect({
      orgId: ch.orgId,
      adminId: ch.adminId,
      force: true,
      readOnly: false
    })
    if (!issued.ok) {
      return c.json({ error: issued.error }, 400)
    }
    markChallengeClaimed(ch.id)
    await audit(
      { admin: issued.admin, orgId: issued.session.orgId },
      "login",
      ch.status === "timeout"
        ? "Connexion après timeout challenge (10 s sans réponse)"
        : "Connexion après acceptation de la session ouverte"
    )
    return c.json({
      ok: true,
      token: issued.session.token,
      expires_at: issued.session.expiresAt,
      admin: publicAdminView(issued.admin),
      forced: true,
      read_only: false,
      hint:
        ch.status === "timeout"
          ? "Session ouverte déconnectée (aucune réponse en 10 s)."
          : "Session ouverte a accepté — vous prenez le contrôle."
    })
  })

  /**
   * Session ouverte : challenge en attente (poll).
   * GET /v1/auth/session/pending-challenge
   */
  v1.get("/auth/session/pending-challenge", async (c) => {
    const gate = await requireConsoleAuth(c, "console_access")
    if (!gate.ok) return c.json({ error: gate.error }, gate.status)
    const {
      getPendingChallengeForAdmin,
      publicChallengeView
    } = await import("./session-challenge")
    const ch = getPendingChallengeForAdmin(gate.admin.id)
    if (!ch) return c.json({ ok: true, challenge: null })
    return c.json({ ok: true, challenge: publicChallengeView(ch) })
  })

  /**
   * Session ouverte : accepter ou refuser le challenge.
   * POST /v1/auth/session/challenge/:id/respond { action: accept|refuse }
   */
  v1.post("/auth/session/challenge/:id/respond", async (c) => {
    const gate = await requireConsoleAuth(c, "console_access")
    if (!gate.ok) return c.json({ error: gate.error }, gate.status)
    let body: { action?: string }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: "invalid_json" }, 400)
    }
    const action =
      body.action === "refuse" ? "refuse" : body.action === "accept" ? "accept" : null
    if (!action) return c.json({ error: "action_required" }, 400)
    const { respondSessionChallenge, publicChallengeView } = await import(
      "./session-challenge"
    )
    const r = respondSessionChallenge(
      c.req.param("id"),
      action,
      gate.admin.id
    )
    if (!r.ok) return c.json({ error: r.error }, 400)
    // Si accept : la session reste jusqu’au claim (qui kick)
    // Si refuse : le demandeur ne peut pas claim
    if (action === "accept") {
      // Optionnel : se déconnecter immédiatement côté UI ; le claim fera le revoke
    }
    return c.json({
      ok: true,
      challenge: publicChallengeView(r.challenge),
      /** UI session ouverte : se déconnecter si accept/timeout */
      should_logout: action === "accept" || r.challenge.status === "timeout"
    })
  })

  /** MFA TOTP — démarrer le setup (génère secret pending) */
  v1.post("/org/admins/me/mfa/setup", async (c) => {
    const gate = await requireConsoleAuth(c, "console_access")
    if (!gate.ok) return c.json({ error: gate.error }, gate.status)
    const { generateTotpSecret, otpauthUrl } = await import("./totp")
    const secret = generateTotpSecret()
    await store.setAdminTotp(gate.orgId, gate.admin.id, {
      totpPendingSecret: secret
    })
    return c.json({
      ok: true,
      secret,
      otpauth_url: otpauthUrl({
        secret,
        email: gate.admin.email,
        issuer: "OpsGate"
      }),
      message:
        "Scannez le secret dans votre app Authenticator, puis confirmez avec POST …/mfa/enable { code }."
    })
  })

  /** MFA TOTP — activer (code de l’app) */
  v1.post("/org/admins/me/mfa/enable", async (c) => {
    const gate = await requireConsoleAuth(c, "console_access")
    if (!gate.ok) return c.json({ error: gate.error }, gate.status)
    let body: { code?: string }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: "invalid_json" }, 400)
    }
    const admin = (
      await store.listAdmins(gate.orgId)
    ).find((a) => a.id === gate.admin.id)
    const pending = admin?.totpPendingSecret
    if (!pending) {
      return c.json({ error: "mfa_setup_required" }, 400)
    }
    const { verifyTotp } = await import("./totp")
    if (!verifyTotp(pending, body.code || "")) {
      return c.json({ error: "mfa_invalid" }, 400)
    }
    await store.setAdminTotp(gate.orgId, gate.admin.id, {
      totpEnabled: true,
      totpSecret: pending,
      totpPendingSecret: null
    })
    await store.appendAdminAudit({
      orgId: gate.orgId,
      adminId: gate.admin.id,
      adminEmail: gate.admin.email,
      adminLabel: gate.admin.label,
      action: "mfa_enable",
      detail: "MFA TOTP activé"
    })
    return c.json({ ok: true, mfa_enabled: true })
  })

  /** MFA TOTP — désactiver (mot de passe + code). Interdit si multi-tenant. */
  v1.post("/org/admins/me/mfa/disable", async (c) => {
    const gate = await requireConsoleAuth(c, "console_access")
    if (!gate.ok) return c.json({ error: gate.error }, gate.status)
    const accessible = await store.listAccessibleOrgsForEmail(gate.admin.email)
    if (accessible.length > 1) {
      return c.json(
        {
          error: "mfa_required_multi_org",
          message:
            "Les comptes multi-tenant ne peuvent pas désactiver le MFA. Il protège le basculement entre organisations."
        },
        403
      )
    }
    let body: { password?: string; code?: string }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: "invalid_json" }, 400)
    }
    const { hashManagementPassword } = await import("./crypto")
    if (
      !body.password ||
      hashManagementPassword(body.password) !== gate.admin.passwordHash
    ) {
      return c.json({ error: "invalid_password" }, 401)
    }
    const admin = (
      await store.listAdmins(gate.orgId)
    ).find((a) => a.id === gate.admin.id)
    if (admin?.totpEnabled && admin.totpSecret) {
      const { verifyTotp } = await import("./totp")
      if (!verifyTotp(admin.totpSecret, body.code || "")) {
        return c.json({ error: "mfa_invalid" }, 401)
      }
    }
    await store.setAdminTotp(gate.orgId, gate.admin.id, {
      totpEnabled: false,
      totpSecret: null,
      totpPendingSecret: null
    })
    await store.appendAdminAudit({
      orgId: gate.orgId,
      adminId: gate.admin.id,
      adminEmail: gate.admin.email,
      adminLabel: gate.admin.label,
      action: "mfa_disable",
      detail: "MFA TOTP désactivé"
    })
    return c.json({ ok: true, mfa_enabled: false })
  })

  /**
   * SSO OIDC — Authorization Code + PKCE (V2 P1 complet).
   * Env : OPSGATE_OIDC_ISSUER, CLIENT_ID, CLIENT_SECRET, REDIRECT_URI,
   *       OPSGATE_CONSOLE_URL, OPSGATE_OIDC_ALLOWED_DOMAINS (opt).
   */
  v1.get("/auth/oidc/status", async (c) => {
    const { getOidcConfig, getOidcFeatureFlags } = await import("./oidc")
    const cfg = getOidcConfig()
    const flags = getOidcFeatureFlags()
    const enabled = !!cfg
    return c.json({
      enabled,
      issuer: cfg?.issuer ?? null,
      client_id: cfg?.clientId ?? null,
      redirect_uri: cfg?.redirectUri ?? null,
      scopes: cfg?.scopes ?? "openid profile email",
      start_path: "/v1/auth/oidc/start",
      callback_path: "/v1/auth/oidc/callback",
      flow: "authorization_code_pkce",
      jit: flags.jit,
      jwks_verify: flags.jwksVerify,
      sso_enforce: flags.ssoEnforce && enabled,
      require_email_verified: flags.requireEmailVerified,
      note: enabled
        ? flags.ssoEnforce
          ? "OIDC prêt · SSO enforce (login mot de passe désactivé)."
          : "OIDC prêt : start → IdP → callback → session."
        : "Définir OPSGATE_OIDC_ISSUER + OPSGATE_OIDC_CLIENT_ID (+ SECRET, REDIRECT_URI)."
    })
  })

  /** Démarre le flow OIDC (redirect navigateur vers l’IdP). */
  v1.get("/auth/oidc/start", async (c) => {
    const {
      getOidcConfig,
      discoverOidc,
      generateState,
      generateCodeVerifier,
      generateNonce,
      storePending,
      buildAuthorizeUrl,
      defaultConsoleReturnTo,
      sanitizeReturnTo,
      consoleRedirectWithError
    } = await import("./oidc")
    const cfg = getOidcConfig()
    const returnTo = sanitizeReturnTo(
      c.req.query("return_to") || defaultConsoleReturnTo()
    )
    const force = c.req.query("force") === "1" || c.req.query("force") === "true"
    if (!cfg) {
      return c.redirect(
        consoleRedirectWithError(returnTo, "oidc_not_configured"),
        302
      )
    }
    // Rate limit par IP (même bucket que login)
    const ip =
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
      c.req.header("x-real-ip") ||
      "local"
    const { rateLimitCheck } = await import("./rate-limit")
    const rl = await rateLimitCheck(
      `oidc:${ip}`,
      Number(process.env.OPSGATE_RATE_LOGIN_PER_MIN || 30),
      60_000
    )
    if (!rl.ok) {
      return c.redirect(
        consoleRedirectWithError(returnTo, "rate_limited"),
        302
      )
    }
    try {
      const discovery = await discoverOidc(cfg.issuer)
      const pending = {
        state: generateState(),
        codeVerifier: generateCodeVerifier(),
        nonce: generateNonce(),
        returnTo,
        force,
        createdAt: Date.now()
      }
      storePending(pending)
      const authorizeUrl = buildAuthorizeUrl(discovery, cfg, pending)
      return c.redirect(authorizeUrl, 302)
    } catch (e) {
      const msg = e instanceof Error ? e.message : "oidc_start_failed"
      return c.redirect(
        consoleRedirectWithError(returnTo, "oidc_start_failed", msg),
        302
      )
    }
  })

  /**
   * Callback IdP : code → tokens → email claim → session admin.
   * Redirige la console avec #opsgate_token=… (fragment).
   */
  v1.get("/auth/oidc/callback", async (c) => {
    const {
      getOidcConfig,
      getOidcFeatureFlags,
      discoverOidc,
      takePending,
      exchangeCode,
      decodeJwtPayload,
      verifyIdToken,
      fetchUserInfo,
      extractEmail,
      mergeClaims,
      isEmailDomainAllowed,
      isEmailVerified,
      resolveJitOrgId,
      defaultConsoleReturnTo,
      consoleRedirectWithToken,
      consoleRedirectWithError
    } = await import("./oidc")

    const errQ = c.req.query("error")
    const state = c.req.query("state") || ""
    const code = c.req.query("code") || ""
    const pending = state ? takePending(state) : null
    const returnTo = pending?.returnTo || defaultConsoleReturnTo()
    const flags = getOidcFeatureFlags()

    if (errQ) {
      return c.redirect(
        consoleRedirectWithError(
          returnTo,
          "idp_error",
          c.req.query("error_description") || errQ
        ),
        302
      )
    }
    if (!pending) {
      return c.redirect(
        consoleRedirectWithError(returnTo, "invalid_state"),
        302
      )
    }
    const cfg = getOidcConfig()
    if (!cfg) {
      return c.redirect(
        consoleRedirectWithError(returnTo, "oidc_not_configured"),
        302
      )
    }
    if (!code) {
      return c.redirect(
        consoleRedirectWithError(returnTo, "missing_code"),
        302
      )
    }

    try {
      const discovery = await discoverOidc(cfg.issuer)
      const tokens = await exchangeCode({
        discovery,
        cfg,
        code,
        codeVerifier: pending.codeVerifier
      })

      let claims: import("./oidc").OidcClaims = {}
      if (tokens.id_token) {
        if (flags.jwksVerify && discovery.jwks_uri) {
          try {
            claims = await verifyIdToken({
              idToken: tokens.id_token,
              discovery,
              clientId: cfg.clientId,
              expectedNonce: pending.nonce
            })
          } catch (ve) {
            const codeV =
              ve instanceof Error ? ve.message : "oidc_jwt_verify_failed"
            return c.redirect(
              consoleRedirectWithError(returnTo, codeV),
              302
            )
          }
        } else {
          claims = decodeJwtPayload(tokens.id_token)
          if (pending.nonce && claims.nonce && claims.nonce !== pending.nonce) {
            return c.redirect(
              consoleRedirectWithError(returnTo, "nonce_mismatch"),
              302
            )
          }
        }
      }
      if (tokens.access_token) {
        const ui = await fetchUserInfo(discovery, tokens.access_token)
        claims = mergeClaims(claims, ui)
      }
      const email = extractEmail(claims)
      if (!email) {
        return c.redirect(
          consoleRedirectWithError(returnTo, "email_claim_missing"),
          302
        )
      }
      if (!isEmailDomainAllowed(email)) {
        return c.redirect(
          consoleRedirectWithError(returnTo, "domain_not_allowed", email),
          302
        )
      }
      if (flags.requireEmailVerified && !isEmailVerified(claims)) {
        return c.redirect(
          consoleRedirectWithError(returnTo, "email_not_verified", email),
          302
        )
      }

      let result = await store.createAdminSessionOidc(email, {
        force: pending.force
      })

      // JIT : créer admin si absent
      let jitCreated = false
      if (!result.ok && result.error === "admin_not_found" && flags.jit) {
        const orgId = await resolveJitOrgId(store)
        if (!orgId) {
          return c.redirect(
            consoleRedirectWithError(returnTo, "jit_org_missing", email),
            302
          )
        }
        const label =
          (typeof claims.name === "string" && claims.name.trim()) ||
          email.split("@")[0] ||
          email
        // Mot de passe aléatoire inutilisable (SSO only) — 32 chars
        const { randomBytes } = await import("node:crypto")
        const junkPwd = randomBytes(24).toString("base64url")
        const admin = await store.upsertAdmin(orgId, {
          label: String(label).slice(0, 80),
          email,
          password: junkPwd,
          active: true,
          isPrincipal: false,
          permissions: ["console_access"],
          mustChangePassword: false
        })
        if (!admin) {
          return c.redirect(
            consoleRedirectWithError(returnTo, "jit_create_failed", email),
            302
          )
        }
        jitCreated = true
        await store.appendAdminAudit({
          orgId,
          adminId: admin.id,
          adminEmail: admin.email,
          adminLabel: admin.label,
          action: "admin_create",
          detail: "Admin créé par JIT OIDC",
          meta: { via: "oidc_jit", sub: claims.sub || undefined }
        })
        result = await store.createAdminSessionOidc(email, {
          force: pending.force
        })
      }

      if (!result.ok) {
        if (result.error === "session_already_active") {
          return c.redirect(
            consoleRedirectWithError(
              returnTo,
              "session_already_active",
              email
            ),
            302
          )
        }
        return c.redirect(
          consoleRedirectWithError(returnTo, result.error, email),
          302
        )
      }

      await audit(
        {
          admin: result.admin,
          orgId: result.session.orgId
        },
        "login",
        result.forced
          ? "Connexion console SSO OIDC (prise de contrôle)"
          : jitCreated
            ? "Connexion console SSO OIDC (JIT admin créé)"
            : "Connexion console SSO OIDC",
        {
          via: "oidc",
          issuer: cfg.issuer,
          sub: claims.sub || undefined,
          jit: jitCreated || undefined,
          jwks: flags.jwksVerify || undefined
        }
      )

      return c.redirect(
        consoleRedirectWithToken(returnTo, {
          token: result.session.token,
          expiresAt: result.session.expiresAt,
          email: result.admin.email
        }),
        302
      )
    } catch (e) {
      const msg = e instanceof Error ? e.message : "oidc_callback_failed"
      return c.redirect(
        consoleRedirectWithError(returnTo, "oidc_callback_failed", msg),
        302
      )
    }
  })

  // ── SAML 2.0 SP foundations ─────────────────────────────────
  v1.get("/auth/saml/status", async (c) => {
    const { getSamlConfig, samlStatusPayload } = await import("./saml")
    return c.json(samlStatusPayload(getSamlConfig()))
  })

  v1.get("/auth/saml/metadata", async (c) => {
    const { getSamlConfig, samlSpMetadataXml } = await import("./saml")
    const cfg = getSamlConfig()
    if (!cfg) return c.json({ error: "saml_not_configured" }, 404)
    return c.body(samlSpMetadataXml(cfg), 200, {
      "Content-Type": "application/samlmetadata+xml; charset=utf-8"
    })
  })

  v1.get("/auth/saml/start", async (c) => {
    const {
      getSamlConfig,
      buildSamlAuthnRequest
    } = await import("./saml")
    const {
      defaultConsoleReturnTo,
      sanitizeReturnTo,
      consoleRedirectWithError
    } = await import("./oidc")
    const returnTo = sanitizeReturnTo(
      c.req.query("return_to") || defaultConsoleReturnTo()
    )
    const cfg = getSamlConfig()
    if (!cfg) {
      return c.redirect(
        consoleRedirectWithError(returnTo, "saml_not_configured"),
        302
      )
    }
    const { redirectUrl } = buildSamlAuthnRequest(cfg)
    return c.redirect(redirectUrl, 302)
  })

  v1.post("/auth/saml/acs", async (c) => {
    const { getSamlConfig, parseSamlResponse } = await import("./saml")
    const {
      defaultConsoleReturnTo,
      consoleRedirectWithToken,
      consoleRedirectWithError,
      isEmailDomainAllowed,
      getOidcFeatureFlags,
      resolveJitOrgId
    } = await import("./oidc")
    const returnTo = defaultConsoleReturnTo()
    const cfg = getSamlConfig()
    if (!cfg) {
      return c.redirect(
        consoleRedirectWithError(returnTo, "saml_not_configured"),
        302
      )
    }
    let body: Record<string, string> = {}
    try {
      const ct = c.req.header("content-type") || ""
      if (ct.includes("application/x-www-form-urlencoded")) {
        const text = await c.req.text()
        body = Object.fromEntries(new URLSearchParams(text))
      } else {
        body = (await c.req.parseBody()) as Record<string, string>
      }
    } catch {
      return c.redirect(
        consoleRedirectWithError(returnTo, "saml_bad_body"),
        302
      )
    }
    const raw = body.SAMLResponse || body.samlresponse || ""
    if (!raw) {
      return c.redirect(
        consoleRedirectWithError(returnTo, "saml_missing_response"),
        302
      )
    }
    const parsed = parseSamlResponse(raw, cfg)
    if (!parsed.ok) {
      return c.redirect(
        consoleRedirectWithError(returnTo, parsed.error),
        302
      )
    }
    const email = parsed.email
    if (!isEmailDomainAllowed(email)) {
      return c.redirect(
        consoleRedirectWithError(returnTo, "domain_not_allowed", email),
        302
      )
    }
    let result = await store.createAdminSessionOidc(email, { force: false })
    const flags = getOidcFeatureFlags()
    if (!result.ok && result.error === "admin_not_found" && flags.jit) {
      const orgId = await resolveJitOrgId(store)
      if (orgId) {
        const { randomBytes } = await import("node:crypto")
        const admin = await store.upsertAdmin(orgId, {
          label: email.split("@")[0] || email,
          email,
          password: randomBytes(24).toString("base64url"),
          active: true,
          isPrincipal: false,
          permissions: ["console_access"]
        })
        if (admin) {
          result = await store.createAdminSessionOidc(email, { force: false })
        }
      }
    }
    if (!result.ok) {
      return c.redirect(
        consoleRedirectWithError(returnTo, result.error, email),
        302
      )
    }
    await audit(
      { admin: result.admin, orgId: result.session.orgId },
      "login",
      "Connexion console SSO SAML",
      { via: "saml", name_id: parsed.nameId }
    )
    return c.redirect(
      consoleRedirectWithToken(returnTo, {
        token: result.session.token,
        expiresAt: result.session.expiresAt,
        email: result.admin.email
      }),
      302
    )
  })

  // ── WebAuthn / Passkeys ─────────────────────────────────────
  v1.get("/auth/webauthn/status", async (c) => {
    const {
      webauthnEnabled,
      webauthnRpId,
      webauthnOrigin
    } = await import("./webauthn")
    return c.json({
      enabled: webauthnEnabled(),
      rp_id: webauthnRpId(),
      origin: webauthnOrigin()
    })
  })

  /** Challenge enregistrement (admin connecté) */
  v1.post("/org/admins/me/webauthn/register/options", async (c) => {
    const gate = await requireConsoleAuth(c, "console_access")
    if (!gate.ok) return c.json({ error: gate.error }, gate.status)
    const {
      webauthnEnabled,
      createWebAuthnChallenge,
      webauthnRpId,
      listWebAuthnCredentials
    } = await import("./webauthn")
    if (!webauthnEnabled()) return c.json({ error: "webauthn_disabled" }, 400)
    const ch = createWebAuthnChallenge({
      purpose: "register",
      adminId: gate.admin.id,
      orgId: gate.orgId,
      email: gate.admin.email
    })
    const existing = listWebAuthnCredentials(gate.admin.id)
    return c.json({
      ok: true,
      challenge_id: ch.id,
      publicKey: {
        challenge: ch.challenge,
        rp: { name: "OpsGate", id: webauthnRpId() },
        user: {
          id: Buffer.from(gate.admin.id).toString("base64url"),
          name: gate.admin.email,
          displayName: gate.admin.label || gate.admin.email
        },
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },
          { type: "public-key", alg: -257 }
        ],
        timeout: 60000,
        attestation: "none",
        excludeCredentials: existing.map((e) => ({
          type: "public-key",
          id: e.credentialId
        })),
        authenticatorSelection: {
          residentKey: "preferred",
          userVerification: "preferred"
        }
      }
    })
  })

  v1.post("/org/admins/me/webauthn/register", async (c) => {
    const gate = await requireConsoleAuth(c, "console_access")
    if (!gate.ok) return c.json({ error: gate.error }, gate.status)
    let body: {
      challenge_id?: string
      credentialId?: string
      publicKeyJwk?: Record<string, unknown>
      transports?: string[]
      label?: string
    }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: "invalid_json" }, 400)
    }
    const {
      takeWebAuthnChallenge,
      parseRegistrationPayload,
      addWebAuthnCredential,
      listWebAuthnCredentials
    } = await import("./webauthn")
    const ch = takeWebAuthnChallenge(body.challenge_id || "")
    if (!ch || ch.purpose !== "register" || ch.adminId !== gate.admin.id) {
      return c.json({ error: "invalid_challenge" }, 400)
    }
    const cred = parseRegistrationPayload(body)
    if (!cred) return c.json({ error: "invalid_credential" }, 400)
    addWebAuthnCredential(gate.admin.id, gate.orgId, cred)
    await store.appendAdminAudit({
      orgId: gate.orgId,
      adminId: gate.admin.id,
      adminEmail: gate.admin.email,
      adminLabel: gate.admin.label,
      action: "org_settings_update",
      detail: "Passkey WebAuthn enregistrée"
    })
    return c.json({
      ok: true,
      credentials: listWebAuthnCredentials(gate.admin.id).map((x) => ({
        credential_id: x.credentialId,
        label: x.label,
        created_at: x.createdAt
      }))
    })
  })

  v1.get("/org/admins/me/webauthn/credentials", async (c) => {
    const gate = await requireConsoleAuth(c, "console_access")
    if (!gate.ok) return c.json({ error: gate.error }, gate.status)
    const { listWebAuthnCredentials } = await import("./webauthn")
    return c.json({
      credentials: listWebAuthnCredentials(gate.admin.id).map((x) => ({
        credential_id: x.credentialId,
        label: x.label,
        created_at: x.createdAt
      }))
    })
  })

  v1.delete("/org/admins/me/webauthn/credentials/:id", async (c) => {
    const gate = await requireConsoleAuth(c, "console_access")
    if (!gate.ok) return c.json({ error: gate.error }, gate.status)
    const { removeWebAuthnCredential } = await import("./webauthn")
    const id = decodeURIComponent(c.req.param("id") || "")
    const ok = removeWebAuthnCredential(gate.admin.id, id)
    return c.json({ ok })
  })

  /** Challenge login (public) */
  v1.post("/auth/webauthn/login/options", async (c) => {
    const {
      webauthnEnabled,
      createWebAuthnChallenge,
      webauthnRpId
    } = await import("./webauthn")
    if (!webauthnEnabled()) return c.json({ error: "webauthn_disabled" }, 400)
    let body: { email?: string } = {}
    try {
      body = await c.req.json()
    } catch {
      body = {}
    }
    const ch = createWebAuthnChallenge({
      purpose: "login",
      email: body.email?.trim().toLowerCase()
    })
    // allowCredentials empty = discoverable credentials (resident keys)
    let allow: Array<{ type: string; id: string }> = []
    if (body.email) {
      const admins = await store.findAdminsByEmail(body.email)
      const { listWebAuthnCredentials } = await import("./webauthn")
      for (const a of admins) {
        for (const cr of listWebAuthnCredentials(a.id)) {
          allow.push({ type: "public-key", id: cr.credentialId })
        }
      }
    }
    return c.json({
      ok: true,
      challenge_id: ch.id,
      publicKey: {
        challenge: ch.challenge,
        timeout: 60000,
        rpId: webauthnRpId(),
        userVerification: "preferred",
        allowCredentials: allow.length ? allow : undefined
      }
    })
  })

  v1.post("/auth/webauthn/login", async (c) => {
    let body: {
      challenge_id?: string
      credentialId?: string
      clientDataJSON?: string
      authenticatorData?: string
      signature?: string
    }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: "invalid_json" }, 400)
    }
    const {
      takeWebAuthnChallenge,
      findWebAuthnCredential,
      verifyWebAuthnAssertion,
      updateWebAuthnCounter
    } = await import("./webauthn")
    const ch = takeWebAuthnChallenge(body.challenge_id || "")
    if (!ch || ch.purpose !== "login") {
      return c.json({ error: "invalid_challenge" }, 400)
    }
    const found = findWebAuthnCredential(body.credentialId || "")
    if (!found) return c.json({ error: "unknown_credential" }, 401)
    const ver = verifyWebAuthnAssertion({
      credential: found.credential,
      clientDataJSON: body.clientDataJSON || "",
      authenticatorData: body.authenticatorData || "",
      signature: body.signature || "",
      expectedChallenge: ch.challenge
    })
    if (!ver.ok) {
      return c.json({ error: ver.error }, 401)
    }
    updateWebAuthnCounter(found.adminId, found.credential.credentialId, ver.newCounter)
    const admins = await store.listAdmins(found.orgId)
    const admin = admins.find((a) => a.id === found.adminId && a.active)
    if (!admin) return c.json({ error: "admin_not_found" }, 401)
    const result = await store.createAdminSessionOidc(admin.email, {
      force: true
    })
    if (!result.ok) {
      return c.json({ error: result.error }, 401)
    }
    await audit(
      { admin: result.admin, orgId: result.session.orgId },
      "login",
      "Connexion console WebAuthn / passkey",
      { via: "webauthn" }
    )
    return c.json({
      ok: true,
      token: result.session.token,
      expires_at: result.session.expiresAt,
      admin: publicAdminView(result.admin)
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
    // Strict : uniquement les orgs où CET email a un compte admin console
    let accessible = await store.listAccessibleOrgsForEmail(auth.admin.email)
    // Garantir que l’org courante est présente si accessible
    if (
      org &&
      !org.isPersonal &&
      !accessible.some((o) => o.org_id === auth.orgId)
    ) {
      // Session valide sur cette org mais email non listé (edge) → org seule
      accessible = [
        {
          org_id: org.id,
          org_code: org.orgCode || org.id,
          name: org.name || org.id,
          is_principal: !!auth.admin.isPrincipal,
          admin_id: auth.admin.id
        }
      ]
    }
    // Mono-tenant : forcer une seule entrée (l’org de session) pour l’UI
    if (accessible.length <= 1) {
      accessible = org
        ? [
            {
              org_id: org.id,
              org_code: org.orgCode || org.id,
              name: org.name || org.id,
              is_principal: !!auth.admin.isPrincipal,
              admin_id: auth.admin.id
            }
          ]
        : accessible
    }
    return c.json({
      ok: true,
      admin: publicAdminView(auth.admin),
      org: org
        ? {
            id: org.id,
            name: org.name,
            org_code: org.orgCode,
            primary_email: org.primaryEmail,
            deleted_at: org.deletedAt || null,
            delete_purge_at: org.deletePurgeAt || null
          }
        : null,
      accessible_orgs: accessible.map((o) => ({
        org_id: o.org_id,
        org_code: o.org_code,
        name: o.name,
        is_principal: o.is_principal,
        current: o.org_id === auth.orgId
      })),
      multi_org: accessible.length > 1,
      /** Multi-tenant sans MFA → la console force la config Authenticator */
      mfa_required_multi_org:
        accessible.length > 1 && !auth.admin.totpEnabled,
      mfa_enabled: !!auth.admin.totpEnabled,
      read_only: !!auth.readOnly,
      org_soft_deleted: !!org?.deletedAt,
      org_purge_at: org?.deletePurgeAt || null
    })
  })

  /** Liste des tenants accessibles (même email admin) — MSP */
  v1.get("/auth/accessible-orgs", async (c) => {
    const auth = await requireConsoleAuth(c, "console_access")
    if (!auth.ok) return c.json({ error: auth.error }, auth.status)
    let list = await store.listAccessibleOrgsForEmail(auth.admin.email)
    // Mono-tenant : renvoyer uniquement l’org de session
    if (list.length <= 1) {
      const org = await store.getOrg(auth.orgId)
      list = org
        ? [
            {
              org_id: org.id,
              org_code: org.orgCode || org.id,
              name: org.name || org.id,
              is_principal: !!auth.admin.isPrincipal,
              admin_id: auth.admin.id
            }
          ]
        : list
    }
    return c.json({
      org_id: auth.orgId,
      multi_org: list.length > 1,
      orgs: list.map((o) => ({
        org_id: o.org_id,
        org_code: o.org_code,
        name: o.name,
        is_principal: o.is_principal,
        current: o.org_id === auth.orgId
      }))
    })
  })

  /**
   * Bascule de tenant (session déjà auth, même email).
   * Multi-tenant : MFA obligatoire (setup + code 6 chiffres à chaque bascule).
   * body: { org_id, force?, totp_code? }
   */
  v1.post("/auth/switch-org", async (c) => {
    const header = c.req.header("Authorization") || ""
    const match = header.match(/^Bearer\s+(.+)$/i)
    if (!match) return c.json({ error: "unauthorized" }, 401)
    const token = match[1].trim()
    const gate = await requireConsoleAuth(c, "console_access")
    if (!gate.ok) return c.json({ error: gate.error }, gate.status)
    let body: { org_id?: string; force?: boolean; totp_code?: string }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: "invalid_json" }, 400)
    }
    const target = (body.org_id || "").trim()
    if (!target) return c.json({ error: "org_id_required" }, 400)

    const accessible = await store.listAccessibleOrgsForEmail(gate.admin.email)
    const multiOrg = accessible.length > 1
    // Changement réel de tenant + multi-org → MFA obligatoire
    if (multiOrg && target !== gate.orgId) {
      if (!gate.admin.totpEnabled || !gate.admin.totpSecret) {
        return c.json(
          {
            error: "mfa_setup_required_multi_org",
            message:
              "Les comptes multi-tenant doivent activer le MFA (Authenticator) avant de changer d’organisation. Paramètres → Général → MFA."
          },
          403
        )
      }
      const code = (body.totp_code || "").trim()
      if (!code) {
        return c.json(
          {
            error: "mfa_required",
            message:
              "Saisissez le code à 6 chiffres de votre application Authenticator pour basculer d’organisation."
          },
          401
        )
      }
      const { verifyTotp } = await import("./totp")
      if (!verifyTotp(gate.admin.totpSecret, code)) {
        return c.json(
          {
            error: "mfa_invalid",
            message: "Code MFA invalide ou expiré."
          },
          401
        )
      }
    }

    const result = await store.switchAdminOrg({
      currentToken: token,
      targetOrgId: target,
      force: body.force !== false
    })
    if (!result.ok) {
      const status =
        result.error === "session_invalid"
          ? 401
          : result.error === "org_not_accessible"
            ? 403
            : result.error === "account_locked"
              ? 403
              : result.error === "session_already_active"
                ? 409
                : 400
      return c.json(
        {
          error: result.error,
          can_force: result.error === "session_already_active",
          message:
            result.error === "org_not_accessible"
              ? "Cette organisation n’est pas accessible avec votre compte."
              : result.error === "account_locked"
                ? "Compte verrouillé sur cette organisation."
                : undefined
        },
        status
      )
    }
    const org = await store.getOrg(result.session.orgId)
    await store.appendAdminAudit({
      orgId: result.session.orgId,
      adminId: result.admin.id,
      adminEmail: result.admin.email,
      adminLabel: result.admin.label,
      action: "login",
      detail: `Bascule multi-tenant → ${org?.orgCode || result.session.orgId}`
    })
    const accessibleAfter = await store.listAccessibleOrgsForEmail(
      result.admin.email
    )
    return c.json({
      ok: true,
      token: result.session.token,
      expires_at: result.session.expiresAt,
      admin: publicAdminView(result.admin),
      org: org
        ? {
            id: org.id,
            name: org.name,
            org_code: org.orgCode,
            primary_email: org.primaryEmail
          }
        : null,
      multi_org: accessibleAfter.length > 1,
      accessible_orgs: accessibleAfter.map((o) => ({
        org_id: o.org_id,
        org_code: o.org_code,
        name: o.name,
        is_principal: o.is_principal,
        current: o.org_id === result.session.orgId
      }))
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

  /**
   * Rapport sécurité (KPIs + charts) — JSON ou PDF.
   * range=week|current_week|custom|all  + from/to (ISO date) + format=json|pdf
   */
  v1.get("/org/reports/security", async (c) => {
    const auth = await requireConsoleAuth(c, "console_access")
    if (!auth.ok) return c.json({ error: auth.error }, auth.status)
    const org = await store.getOrg(auth.orgId)
    if (!org) return c.json({ error: "no_org" }, 404)

    const range = (c.req.query("range") || "current_week").toLowerCase()
    const format = (c.req.query("format") || "json").toLowerCase()
    const fromQ = c.req.query("from") || ""
    const toQ = c.req.query("to") || ""

    let period
    try {
      const { resolveReportPeriod, buildSecurityReport } = await import(
        "./security-report"
      )
      period = resolveReportPeriod(range, fromQ, toQ)
      const events = await store.listEvents(org.id, 5000)
      const agents = await store.listAgents(org.id)
      const licenseStats = await store.getLicenseStats(org.id)
      const report = await buildSecurityReport({
        orgId: org.id,
        orgName: org.name || org.orgCode,
        events,
        agents,
        monitoring: org.monitoring,
        licenseOf: (a) => store.isAgentLicensed(org.id, a.id),
        scheduleOf: async (a) => {
          const eff = await store.getEffectivePolicyForAgent(org.id, a.id)
          return eff?.effective.workSchedule
        },
        period,
        seats: {
          seats: licenseStats.seats,
          seats_used: licenseStats.seats_used
        }
      })

      if (format === "pdf") {
        const { spawnSync } = await import("node:child_process")
        const path = await import("node:path")
        const fs = await import("node:fs")
        const os = await import("node:os")
        // packages/api/src -> monorepo root
        const monoRoot = path.resolve(
          path.dirname(fileURLToPath(import.meta.url)),
          "../../.."
        )
        const script = path.join(monoRoot, "scripts", "build-security-report-pdf.py")
        if (!fs.existsSync(script)) {
          return c.json({ error: "pdf_script_missing", path: script }, 500)
        }
        const tmpJson = path.join(
          os.tmpdir(),
          `opsgate-report-${Date.now()}.json`
        )
        const tmpPdf = path.join(
          os.tmpdir(),
          `opsgate-report-${Date.now()}.pdf`
        )
        fs.writeFileSync(tmpJson, JSON.stringify(report), "utf8")
        const py = process.env.PYTHON || process.env.PYTHON_PATH || "python"
        const r = spawnSync(
          py,
          [script, tmpJson, "--out", tmpPdf],
          { encoding: "utf8", timeout: 60_000, maxBuffer: 20 * 1024 * 1024 }
        )
        try {
          fs.unlinkSync(tmpJson)
        } catch {
          /* ignore */
        }
        if (r.status !== 0 || !fs.existsSync(tmpPdf)) {
          return c.json(
            {
              error: "pdf_generation_failed",
              stderr: (r.stderr || "").slice(0, 800),
              stdout: (r.stdout || "").slice(0, 400)
            },
            500
          )
        }
        const pdfBuf = fs.readFileSync(tmpPdf)
        try {
          fs.unlinkSync(tmpPdf)
        } catch {
          /* ignore */
        }
        const stamp = (period.from_ts || "").slice(0, 10)
        const fname = `opsgate-security-report-${stamp || "period"}.pdf`
        await store.appendAdminAudit({
          orgId: org.id,
          adminId: auth.admin.id,
          adminEmail: auth.admin.email,
          adminLabel: auth.admin.label,
          action: "report_export",
          detail: `Rapport sécurité PDF · ${period.label}`
        }).catch(() => undefined)
        return new Response(pdfBuf, {
          status: 200,
          headers: {
            "content-type": "application/pdf",
            "content-disposition": `attachment; filename="${fname}"`,
            "cache-control": "no-store"
          }
        })
      }

      return c.json({ ok: true, report })
    } catch (e) {
      const msg = String((e as Error).message || e)
      if (msg.includes("invalid_date_range")) {
        return c.json({ error: "invalid_date_range" }, 400)
      }
      return c.json({ error: "report_failed", message: msg }, 500)
    }
  })

  async function ensureWeeklyExportIfDue(orgId: string) {
    const { runWeeklyExportForOrg } = await import("./exports-cron")
    await runWeeklyExportForOrg(store, orgId)
  }

  /** Paramètres monitoring (seuils offline + schedule) */
  v1.get("/org/monitoring", async (c) => {
    const _gate = await requireConsoleAuth(c, "console_access")
    if (!_gate.ok) return c.json({ error: _gate.error }, _gate.status)
    const org = await store.getOrg(_gate.orgId)
    if (!org) return c.json({ error: "no_org" }, 404)
    const { mergeMonitoringSettings } = await import("./types")
    const { publicLdapView } = await import("./ldap")
    const { publicSmtpView } = await import("./mail")
    const monitoring = mergeMonitoringSettings(org.monitoring)
    // Ne jamais renvoyer secrets en clair
    if (monitoring.ldap) {
      monitoring.ldap = {
        ...monitoring.ldap,
        bindPassword: undefined
      } as typeof monitoring.ldap
    }
    if (monitoring.smtp) {
      const pub = publicSmtpView(monitoring.smtp)
      monitoring.smtp = {
        enabled: pub.enabled,
        host: pub.host,
        port: pub.port,
        secure: pub.secure,
        user: pub.user,
        from: pub.from,
        tlsInsecure: pub.tlsInsecure,
        password: undefined
      } as typeof monitoring.smtp
      // password_set exposé à côté pour la console
      ;(monitoring.smtp as { password_set?: boolean }).password_set =
        pub.password_set
    }
    return c.json({
      org_id: org.id,
      monitoring,
      ldap_public: publicLdapView(monitoring.ldap),
      smtp_public: publicSmtpView(
        mergeMonitoringSettings(org.monitoring).smtp
      )
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
    // Billing Stripe: uniquement via webhook / checkout (pas PATCH client)
    if ((body as { stripeBilling?: unknown }).stripeBilling) {
      delete (body as { stripeBilling?: unknown }).stripeBilling
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
    const mon = mergeMonitoringSettings(updated?.monitoring)
    if (mon.ldap) mon.ldap = { ...mon.ldap, bindPassword: undefined } as typeof mon.ldap
    if (mon.smtp) mon.smtp = { ...mon.smtp, password: undefined } as typeof mon.smtp
    return c.json({
      ok: true,
      monitoring: mon
    })
  })

  /** LDAP / AD — statut (sans secret) */
  v1.get("/org/ldap/status", async (c) => {
    const gate = await requireConsoleAuth(c, "console_access")
    if (!gate.ok) return c.json({ error: gate.error }, gate.status)
    const org = await store.getOrg(gate.orgId)
    if (!org) return c.json({ error: "no_org" }, 404)
    const { mergeMonitoringSettings } = await import("./types")
    const { publicLdapView, ldapConfigReady } = await import("./ldap")
    const mon = mergeMonitoringSettings(org.monitoring)
    const cfg = mon.ldap
    const ready = ldapConfigReady(cfg)
    return c.json({
      org_id: org.id,
      ldap: publicLdapView(cfg),
      ready: ready.ready,
      ready_reason: ready.reason || null
    })
  })

  /** LDAP / AD — test bind + search léger */
  v1.post("/org/ldap/test", async (c) => {
    const gate = await requireConsoleAuth(c, "manage_policies")
    if (!gate.ok) return c.json({ error: gate.error }, gate.status)
    const org = await store.getOrg(gate.orgId)
    if (!org) return c.json({ error: "no_org" }, 404)
    const { mergeMonitoringSettings, DEFAULT_LDAP_SETTINGS } = await import(
      "./types"
    )
    let body: Partial<import("./types").OrgLdapSettings> = {}
    try {
      body = await c.req.json()
    } catch {
      body = {}
    }
    const mon = mergeMonitoringSettings(org.monitoring)
    const cfg = {
      ...DEFAULT_LDAP_SETTINGS,
      ...mon.ldap,
      ...body,
      // si body.bindPassword vide, garder le stocké
      bindPassword:
        body.bindPassword && body.bindPassword.length > 0
          ? body.bindPassword
          : mon.ldap?.bindPassword || ""
    }
    const { testLdapConnection } = await import("./ldap")
    const result = await testLdapConnection(cfg)
    return c.json(result, result.ok ? 200 : 400)
  })

  /** LDAP / AD — sync groupes + users */
  v1.post("/org/ldap/sync", async (c) => {
    const gate = await requireConsoleAuth(c, "manage_policies")
    if (!gate.ok) return c.json({ error: gate.error }, gate.status)
    const org = await store.getOrg(gate.orgId)
    if (!org) return c.json({ error: "no_org" }, 404)
    const { mergeMonitoringSettings, DEFAULT_LDAP_SETTINGS } = await import(
      "./types"
    )
    let body: { dry_run?: boolean } = {}
    try {
      body = await c.req.json()
    } catch {
      body = {}
    }
    const mon = mergeMonitoringSettings(org.monitoring)
    const cfg = {
      ...DEFAULT_LDAP_SETTINGS,
      ...mon.ldap
    }
    const { syncLdapToStore, ldapConfigReady } = await import("./ldap")
    const ready = ldapConfigReady(cfg)
    if (!ready.ready) {
      return c.json(
        { error: "ldap_not_ready", message: ready.reason },
        400
      )
    }
    const result = await syncLdapToStore({
      store,
      orgId: org.id,
      cfg,
      dryRun: !!body.dry_run
    })
    // Persister last sync meta (sans écraser le password)
    if (!body.dry_run || result.ok) {
      await store.updateOrgMonitoring(org.id, {
        ldap: {
          ...cfg,
          lastSyncAt: new Date().toISOString(),
          lastSyncMessage: result.message || null,
          lastSyncStats: {
            groups_seen: result.groups_seen,
            groups_upserted: result.groups_upserted,
            users_seen: result.users_seen,
            users_upserted: result.users_upserted
          }
        }
      })
    }
    await store.appendAdminAudit({
      orgId: org.id,
      adminId: gate.admin.id,
      adminEmail: gate.admin.email,
      adminLabel: gate.admin.label,
      action: "org_settings_update",
      detail: result.dry_run
        ? `LDAP dry-run : ${result.message}`
        : `LDAP sync : ${result.message}`,
      meta: {
        dry_run: result.dry_run,
        groups: result.groups_upserted,
        users: result.users_upserted
      }
    })
    return c.json(result, result.ok ? 200 : 502)
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
          device_label:
            normalizeDeviceLabel(a.deviceLabel, a.hostName) || a.deviceLabel,
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
          device_fingerprint: a.deviceFingerprint || null,
          device_type: a.deviceType === "proxy" ? "proxy" : "extension",
          maintenance_mode: a.maintenanceMode || null,
          maintenance_note: a.maintenanceNote || null
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

  /** Assigner profil et/ou user / maintenance à un agent */
  v1.patch("/org/agents/:agentId", async (c) => {
    const _gate = await requireConsoleAuth(c, "console_access")
    if (!_gate.ok) return c.json({ error: _gate.error }, _gate.status)
    const org = await store.getOrg(_gate.orgId)
    if (!org) return c.json({ error: "no_org" }, 404)
    let body: {
      policy_profile_id?: string | null
      user_id?: string | null
      maintenance_mode?: "leave" | "outage" | "remote" | null
      maintenance_note?: string | null
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
    if (body.maintenance_mode !== undefined) {
      const mode = body.maintenance_mode
      if (
        mode !== null &&
        mode !== "leave" &&
        mode !== "outage" &&
        mode !== "remote"
      ) {
        return c.json({ error: "invalid_maintenance_mode" }, 400)
      }
      agent = await store.setAgentMaintenance(
        org.id,
        c.req.param("agentId"),
        mode,
        body.maintenance_note
      )
      if (!agent) return c.json({ error: "agent_not_found" }, 404)
    }
    await audit(
      _gate,
      "agent_assign",
      `Assign agent ${c.req.param("agentId").slice(0, 12)}… · profil=${agent.policyProfileId || "—"} · user=${agent.userId || "—"} · maint=${agent.maintenanceMode || "off"}`,
      {
        agent_id: agent.id,
        policy_profile_id: agent.policyProfileId,
        user_id: agent.userId,
        maintenance_mode: agent.maintenanceMode || null
      }
    )
    return c.json({
      ok: true,
      agent: {
        id: agent.id,
        policy_profile_id: agent.policyProfileId || null,
        user_id: agent.userId || null,
        maintenance_mode: agent.maintenanceMode || null,
        maintenance_note: agent.maintenanceNote || null
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
    if (!body.label?.trim() || !body.email?.trim() || !body.password) {
      return c.json({ error: "label_email_password_required" }, 400)
    }
    const polCreate = validatePasswordPolicy(body.password)
    if (!polCreate.ok) {
      return c.json(
        {
          error: polCreate.error,
          message:
            polCreate.error === "password_too_short"
              ? `Mot de passe trop court (min. ${MIN_PASSWORD_LENGTH} caractères).`
              : "Mot de passe déjà utilisé récemment."
        },
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
        const polS = validatePasswordPolicy(body.password, {
          currentHash: existing.passwordHash,
          history: existing.passwordHistory
        })
        if (!polS.ok) {
          return c.json(
            {
              error: polS.error,
              message:
                polS.error === "password_too_short"
                  ? `Mot de passe trop court (min. ${MIN_PASSWORD_LENGTH} caractères).`
                  : "Mot de passe déjà utilisé récemment."
            },
            400
          )
        }
      }
      const admin = await store.upsertAdmin(org.id, {
        id: existing.id,
        label: body.label?.trim() || existing.label,
        email: body.email?.trim() || existing.email,
        password: body.password,
        mustChangePassword: false
      })
      if (!admin) return c.json({ error: "admin_update_failed" }, 400)
      await audit(
        _gate,
        "admin_update",
        `Self-update admin « ${admin?.label || existing.label} »`,
        { admin_id: existing.id, self: true }
      )
      return c.json({ ok: true, admin: publicAdminView(admin) })
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
    const curHash = hashManagementPassword(body.current_password)
    if (curHash !== _gate.admin.passwordHash) {
      return c.json({ error: "current_password_invalid" }, 400)
    }
    const pol = validatePasswordPolicy(body.new_password, {
      currentHash: _gate.admin.passwordHash,
      history: _gate.admin.passwordHistory
    })
    if (!pol.ok) {
      return c.json(
        {
          error: pol.error,
          message:
            pol.error === "password_too_short"
              ? `Mot de passe trop court (min. ${MIN_PASSWORD_LENGTH} caractères).`
              : "Ce mot de passe a déjà été utilisé. Choisissez-en un nouveau."
        },
        400
      )
    }
    const admin = await store.upsertAdmin(_gate.orgId, {
      id: _gate.admin.id,
      label: _gate.admin.label,
      email: body.email?.trim() || _gate.admin.email,
      password: body.new_password,
      mustChangePassword: false
    })
    if (!admin) {
      return c.json({ error: "password_update_failed" }, 400)
    }
    await audit(
      _gate,
      "password_change",
      `Changement de mot de passe (self)${body.email ? " + email" : ""}`
    )
    // Rafraîchir primary_email côté réponse me
    const org = await store.getOrg(_gate.orgId)
    return c.json({
      ok: true,
      admin: publicAdminView(admin),
      org_primary_email: org?.primaryEmail || null
    })
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
    if (!body.new_password) {
      return c.json({ error: "password_required" }, 400)
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
    const polR = validatePasswordPolicy(body.new_password, {
      currentHash: existing.passwordHash,
      history: existing.passwordHistory
    })
    if (!polR.ok) {
      return c.json(
        {
          error: polR.error,
          message:
            polR.error === "password_too_short"
              ? `Mot de passe trop court (min. ${MIN_PASSWORD_LENGTH} caractères).`
              : "Mot de passe déjà utilisé récemment."
        },
        400
      )
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
    // Notification e-mail (best-effort)
    try {
      const { mergeMonitoringSettings } = await import("./types")
      const mon = mergeMonitoringSettings(org.monitoring)
      const { sendPasswordChangedNotice } = await import("./mail")
      await sendPasswordChangedNotice({
        to: existing.email,
        adminLabel: existing.label,
        byEmail: _gate.admin.email,
        smtp: mon.smtp
      })
    } catch {
      /* ignore mail errors */
    }
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
        issuedAt: rec.issuedAt,
        kind: rec.kind || "full"
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
    const isTopup = p.kind === "seat_topup"
    if (isTopup) {
      // Pack de sièges : ajoute aux sièges existants, ne remplace pas la société
      const currentSeats = org.licenseSeats || 0
      const nextSeats = currentSeats + p.seats
      await store.setOrgLicenseSeats(org.id, nextSeats)
      const lic = prev.licenseDisplay
      await store.updateOrgMonitoring(org.id, {
        ...prev,
        licenseDisplay: {
          companyName: lic?.companyName || p.companyName || org.name,
          address: lic?.address || p.address || "",
          contactEmail: lic?.contactEmail || p.contactEmail || org.primaryEmail,
          expiresAt:
            lic?.mode === "full" && lic.expiresAt
              ? // garder la plus lointaine
                Date.parse(lic.expiresAt) > Date.parse(p.expiresAt)
                  ? lic.expiresAt
                  : p.expiresAt
              : p.expiresAt,
          mode: "full",
          seats: nextSeats,
          activatedAt: lic?.activatedAt || new Date().toISOString(),
          licenseKeyFingerprint:
            lic?.licenseKeyFingerprint || licenseKeyFingerprint(displayKey)
        }
      })
      await audit(
        _gate,
        "org_settings_update",
        `Top-up sièges +${p.seats} → total ${nextSeats} · clé ${displayKey.slice(0, 12)}…`,
        { seats_added: p.seats, seats_total: nextSeats }
      )
      const stats = await store.getLicenseStats(org.id)
      return c.json({
        ok: true,
        kind: "seat_topup",
        seats_added: p.seats,
        license: {
          mode: "full",
          company_name:
            prev.licenseDisplay?.companyName || p.companyName || org.name,
          seats_total: stats.seats,
          seats_used: stats.seats_used,
          expires_at: p.expiresAt
        }
      })
    }
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
      kind: "full",
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

  // ─── Vendor ONLY (DailyOps) : émission licences — PAS exposé à la console client ───
  /**
   * Auth exclusivement par secret constructeur (jamais la session admin client).
   * Header : X-OpsGate-Vendor-Key = OPSGATE_VENDOR_LICENSE_SECRET | OPSGATE_LICENSE_SECRET
   * Longueur min. 12. Sans secret configuré côté serveur → 503.
   */
  function requireVendorSecret(c: {
    req: { header: (n: string) => string | undefined }
  }):
    | { ok: true }
    | { ok: false; status: 401 | 403 | 503; error: string } {
    const current = (
      process.env.OPSGATE_VENDOR_LICENSE_SECRET ||
      process.env.OPSGATE_LICENSE_SECRET ||
      ""
    ).trim()
    const previous = (
      process.env.OPSGATE_VENDOR_LICENSE_SECRET_PREVIOUS ||
      process.env.OPSGATE_LICENSE_SECRET_PREVIOUS ||
      ""
    ).trim()
    if (current.length < 12) {
      return {
        ok: false,
        status: 503,
        error: "vendor_secret_not_configured"
      }
    }
    const vendorKey = (c.req.header("X-OpsGate-Vendor-Key") || "").trim()
    const okKey =
      !!vendorKey &&
      (vendorKey === current ||
        (previous.length >= 12 && vendorKey === previous))
    if (!okKey) {
      return { ok: false, status: 401, error: "vendor_key_required" }
    }
    return { ok: true }
  }

  // ── Billing Stripe (portal personnel / sièges) ───────────────
  v1.get("/billing/status", async (c) => {
    const { billingPublicStatus } = await import("./billing-stripe")
    const { mergeMonitoringSettings } = await import("./types")
    // Auth optionnelle : enrichit avec snapshot org si session console
    const gate = await requireConsoleAuth(c, "console_access")
    if (gate.ok) {
      const org = await store.getOrg(gate.orgId)
      const mon = mergeMonitoringSettings(org?.monitoring)
      return c.json({
        ...billingPublicStatus(mon.stripeBilling),
        org_id: org?.id || null,
        org_seats: org?.licenseSeats ?? 0,
        is_personal: !!org?.isPersonal
      })
    }
    return c.json(billingPublicStatus())
  })

  v1.post("/billing/checkout", async (c) => {
    const gate = await requireConsoleAuth(c, "console_access")
    if (!gate.ok) return c.json({ error: gate.error }, gate.status)
    if (!gate.admin.isPrincipal) {
      return c.json({ error: "principal_only" }, 403)
    }
    const org = await store.getOrg(gate.orgId)
    if (!org) return c.json({ error: "no_org" }, 404)
    let body: { quantity?: number }
    try {
      body = await c.req.json()
    } catch {
      body = {}
    }
    const { mergeMonitoringSettings } = await import("./types")
    const mon = mergeMonitoringSettings(org.monitoring)
    const { createCheckoutSession } = await import("./billing-stripe")
    const r = await createCheckoutSession({
      orgId: org.id,
      orgCode: org.orgCode || org.id,
      customerEmail: gate.admin.email,
      customerId: mon.stripeBilling?.customerId,
      quantity: body.quantity ?? Math.max(1, org.licenseSeats || 1)
    })
    if (!r.ok) return c.json({ error: r.error }, 503)
    await store.appendAdminAudit({
      orgId: org.id,
      adminId: gate.admin.id,
      adminEmail: gate.admin.email,
      adminLabel: gate.admin.label,
      action: "org_settings_update",
      detail: `Stripe checkout session ${r.session_id} qty=${body.quantity ?? 1}`
    })
    return c.json({ ok: true, url: r.url, session_id: r.session_id })
  })

  /** Customer Portal Stripe — gérer abonnement / CB */
  v1.post("/billing/portal", async (c) => {
    const gate = await requireConsoleAuth(c, "console_access")
    if (!gate.ok) return c.json({ error: gate.error }, gate.status)
    if (!gate.admin.isPrincipal) {
      return c.json({ error: "principal_only" }, 403)
    }
    const org = await store.getOrg(gate.orgId)
    if (!org) return c.json({ error: "no_org" }, 404)
    const { mergeMonitoringSettings } = await import("./types")
    const mon = mergeMonitoringSettings(org.monitoring)
    const customerId = mon.stripeBilling?.customerId
    if (!customerId) {
      return c.json(
        {
          error: "no_stripe_customer",
          hint: "Passez d'abord par Checkout pour créer le client Stripe"
        },
        400
      )
    }
    const { createBillingPortalSession } = await import("./billing-stripe")
    const r = await createBillingPortalSession({ customerId })
    if (!r.ok) return c.json({ error: r.error }, 503)
    await store.appendAdminAudit({
      orgId: org.id,
      adminId: gate.admin.id,
      adminEmail: gate.admin.email,
      adminLabel: gate.admin.label,
      action: "org_settings_update",
      detail: "Stripe customer portal session opened"
    })
    return c.json({ ok: true, url: r.url })
  })

  /**
   * Webhook Stripe (raw body + signature).
   * Config Dashboard : checkout.session.completed, customer.subscription.*
   */
  v1.post("/billing/webhook", async (c) => {
    const {
      getStripeConfig,
      verifyStripeWebhookSignature,
      interpretStripeEvent,
      mergeStripeBilling
    } = await import("./billing-stripe")
    const { mergeMonitoringSettings } = await import("./types")
    const cfg = getStripeConfig()
    if (!cfg?.webhookSecret) {
      return c.json({ error: "webhook_not_configured" }, 503)
    }
    const rawBody = await c.req.text()
    const sig = c.req.header("stripe-signature") || undefined
    if (!verifyStripeWebhookSignature(rawBody, sig, cfg.webhookSecret)) {
      return c.json({ error: "invalid_signature" }, 400)
    }
    let event: Record<string, unknown>
    try {
      event = JSON.parse(rawBody) as Record<string, unknown>
    } catch {
      return c.json({ error: "invalid_json" }, 400)
    }
    const applied = interpretStripeEvent(event)
    if (!applied.ok) {
      if (applied.skip) {
        return c.json({ ok: true, skipped: true, reason: applied.error })
      }
      return c.json({ error: applied.error }, 400)
    }
    const org = await store.getOrg(applied.orgId)
    if (!org) {
      console.warn(
        `[billing] webhook org_not_found id=${applied.orgId} action=${applied.action}`
      )
      return c.json({ ok: true, warning: "org_not_found" })
    }
    const prevMon = mergeMonitoringSettings(org.monitoring)
    const nextBilling = mergeStripeBilling(
      prevMon.stripeBilling,
      applied.billing
    )
    await store.setOrgLicenseSeats(org.id, applied.seats)
    const lic = prevMon.licenseDisplay || {
      companyName: "",
      address: "",
      contactEmail: "",
      mode: "trial" as const
    }
    // Sièges Stripe : mode full opérationnel si abo actif
    const active =
      nextBilling.subscriptionStatus === "active" ||
      nextBilling.subscriptionStatus === "trialing"
    await store.updateOrgMonitoring(org.id, {
      stripeBilling: nextBilling,
      licenseDisplay: {
        ...lic,
        mode: active || applied.seats > 0 ? "full" : lic.mode || "trial",
        seats: applied.seats,
        companyName: lic.companyName || org.name,
        contactEmail: lic.contactEmail || org.primaryEmail || "",
        activatedAt: lic.activatedAt || new Date().toISOString(),
        licenseKeyFingerprint:
          lic.licenseKeyFingerprint ||
          `stripe:${(nextBilling.subscriptionId || "sub").slice(0, 12)}`
      }
    })
    await store.appendAdminAudit({
      orgId: org.id,
      adminId: "stripe-webhook",
      adminEmail: "stripe@webhook",
      adminLabel: "Stripe",
      action: "org_settings_update",
      detail: `Stripe ${applied.action} → seats=${applied.seats} status=${nextBilling.subscriptionStatus}`
    })
    console.log(
      `[billing] ${applied.action} org=${org.orgCode || org.id} seats=${applied.seats}`
    )
    return c.json({ ok: true, org_id: org.id, seats: applied.seats })
  })

  /** Santé émission (scripts ops) — secret jamais renvoyé */
  v1.get("/vendor/status", async (c) => {
    const { vendorSecretStatus, vendorLicenseSecrets } = await import(
      "./secret-rotation"
    )
    const { current } = vendorLicenseSecrets()
    const st = vendorSecretStatus()
    return c.json({
      channel: "api_secret_or_cli",
      console_ui: false,
      secret_configured: current.length >= 12,
      rotation: st.vendor_license,
      hint: "Émission hors console client : pnpm license:issue ou POST /v1/vendor/licenses + X-OpsGate-Vendor-Key. Rotation dual-key : OPSGATE_VENDOR_LICENSE_SECRET_PREVIOUS."
    })
  })

  /** Liste des licences émises (vendeur DailyOps — secret only) */
  v1.get("/vendor/licenses", async (c) => {
    const access = requireVendorSecret(c)
    if (!access.ok) return c.json({ error: access.error }, access.status)
    const list = await store.listIssuedLicenses()
    return c.json({
      count: list.length,
      licenses: list.map((l) => ({
        id: l.id,
        license_key: l.licenseKey,
        kind: l.kind || "full",
        org_code: l.orgCode,
        company_name: l.companyName,
        address: l.address,
        contact_email: l.contactEmail,
        seats: l.seats,
        expires_at: l.expiresAt,
        issued_at: l.issuedAt,
        revoked_at: l.revokedAt || null,
        status: l.revokedAt
          ? "revoked"
          : Date.parse(l.expiresAt) < Date.now()
            ? "expired"
            : "active"
      }))
    })
  })

  /** Certificat PDF (brandé texte) pour envoi client */
  v1.post("/vendor/licenses/certificate", async (c) => {
    const access = requireVendorSecret(c)
    if (!access.ok) return c.json({ error: access.error }, access.status)
    let body: { license_key?: string }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: "invalid_json" }, 400)
    }
    const key = (body.license_key || "").trim()
    if (!key) return c.json({ error: "license_key_required" }, 400)
    const rec = await store.lookupIssuedLicense(key)
    if (!rec) return c.json({ error: "license_not_found" }, 404)
    const {
      buildLicenseCertificatePdf,
      certificateFilename
    } = await import("./license-certificate-pdf")
    const pdf = buildLicenseCertificatePdf({
      licenseKey: rec.licenseKey,
      orgCode: rec.orgCode,
      companyName: rec.companyName,
      address: rec.address,
      contactEmail: rec.contactEmail,
      seats: rec.seats,
      expiresAt: rec.expiresAt,
      issuedAt: rec.issuedAt,
      kind: rec.kind
    })
    const name = certificateFilename(rec)
    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${name}"`
      }
    })
  })

  /**
   * Émet une licence client OPS-XXXX-… (DailyOps only).
   * kind: full | seat_topup (pack de sièges additionnels)
   */
  v1.post("/vendor/licenses", async (c) => {
    const access = requireVendorSecret(c)
    if (!access.ok) return c.json({ error: access.error }, access.status)
    let body: {
      org_code?: string
      company_name?: string
      address?: string
      contact_email?: string
      seats?: number
      expires_at?: string
      years?: number
      provision_org?: boolean
      kind?: "full" | "seat_topup"
      /** Envoyer l’e-mail au contact (défaut: false — PDF manuel pour l’instant) */
      send_email?: boolean
    }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: "invalid_json" }, 400)
    }
    const orgCode = (body.org_code || "").trim().toUpperCase()
    const kind = body.kind === "seat_topup" ? "seat_topup" : "full"
    let companyName = (body.company_name || "").trim()
    let contactEmail = (body.contact_email || "").trim().toLowerCase()
    let address = (body.address || "").trim()
    const seats = Math.max(0, Math.floor(Number(body.seats) || 0))
    if (!orgCode || orgCode.length < 4) {
      return c.json({ error: "org_code_required", hint: "ex. ACME-2026" }, 400)
    }
    // Top-up : préremplir depuis l’org existante si champs vides
    if (kind === "seat_topup") {
      const org = await store.findOrgByCode(orgCode)
      if (!org) {
        return c.json(
          {
            error: "org_not_found",
            message: "Pour un top-up, le code org doit déjà exister."
          },
          400
        )
      }
      if (!companyName) companyName = org.name
      if (!contactEmail) contactEmail = org.primaryEmail || "licence@local"
      if (!address) address = ""
    }
    if (!companyName) {
      return c.json({ error: "company_name_required" }, 400)
    }
    if (!contactEmail || !contactEmail.includes("@")) {
      return c.json({ error: "contact_email_required" }, 400)
    }
    if (seats < 1) {
      return c.json({ error: "seats_min_1" }, 400)
    }
    let expiresAt = (body.expires_at || "").trim()
    if (!expiresAt) {
      const d = new Date()
      d.setFullYear(d.getFullYear() + Math.max(1, Math.floor(body.years || 1)))
      expiresAt = d.toISOString()
    } else if (expiresAt.length <= 10) {
      expiresAt = new Date(expiresAt + "T23:59:59.000Z").toISOString()
    }
    if (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) < Date.now()) {
      return c.json({ error: "invalid_expires_at" }, 400)
    }

    let provision: Awaited<ReturnType<typeof store.provisionTenant>> | null =
      null
    if (body.provision_org) {
      provision = await store.provisionTenant({
        orgCode,
        companyName,
        contactEmail,
        seats
      })
    }

    const issued = await store.issueShortLicense({
      orgCode,
      companyName,
      address,
      contactEmail,
      seats,
      expiresAt,
      kind
    })

    const { maskLicenseKey } = await import("./license-keys")
    console.log(
      `[vendor] license issued key=${maskLicenseKey(issued.licenseKey)} kind=${kind} org=${orgCode} seats=${seats} company=${companyName}`
    )

    // E-mail auto désactivé par défaut (PDF manuel). send_email: true pour activer plus tard.
    const sendEmail = body.send_email === true
    let mailResult: {
      ok: boolean
      delivery?: string
      error?: string
    } | null = null
    if (sendEmail && contactEmail.includes("@")) {
      try {
        const { sendLicenseIssuedEmail } = await import("./mail")
        const { PRINCIPAL_DEFAULT_PASSWORD } = await import("./crypto")
        const mailed = await sendLicenseIssuedEmail({
          to: contactEmail,
          licenseKey: issued.licenseKey,
          orgCode,
          companyName,
          seats,
          expiresAt,
          kind,
          tenantCreated: !!provision?.created,
          initialPassword: provision?.created
            ? provision.tempPassword || PRINCIPAL_DEFAULT_PASSWORD
            : null,
          consoleUrlHint: process.env.OPSGATE_CONSOLE_URL?.trim()
        })
        mailResult = {
          ok: mailed.ok,
          delivery: mailed.delivery,
          error: mailed.ok
            ? undefined
            : "error" in mailed
              ? mailed.error
              : undefined
        }
      } catch (e) {
        mailResult = {
          ok: false,
          error: e instanceof Error ? e.message : String(e)
        }
      }
    }

    const initialPwd = (
      await import("./crypto")
    ).PRINCIPAL_DEFAULT_PASSWORD

    return c.json({
      ok: true,
      license_key: issued.licenseKey,
      paper_format: issued.licenseKey,
      kind,
      payload: {
        org_code: issued.payload.orgCode,
        company_name: issued.payload.companyName,
        address: issued.payload.address,
        contact_email: issued.payload.contactEmail,
        seats: issued.payload.seats,
        expires_at: issued.payload.expiresAt,
        issued_at: issued.payload.issuedAt,
        kind
      },
      tenant: provision
        ? {
            org_id: provision.orgId,
            org_code: provision.orgCode,
            principal_email: provision.principalEmail,
            created: provision.created,
            temp_password: provision.tempPassword || null,
            note: provision.created
              ? `Tenant créé. Login : ${provision.principalEmail} / ${provision.tempPassword || initialPwd} (changement obligatoire).`
              : "Org déjà existante pour ce code — licence seulement."
          }
        : null,
      email: mailResult,
      client_steps:
        kind === "seat_topup"
          ? [
              "Se connecter avec le compte admin existant.",
              "Paramètres → Gestion des licences → Ajouter une licence.",
              `Coller la clé top-up ${issued.licenseKey}`,
              "Les sièges sont ajoutés au total de l’organisation."
            ]
          : [
              `Première connexion console : e-mail = ${contactEmail} (contact licence).`,
              `Mot de passe initial : ${initialPwd} (à changer immédiatement).`,
              "Paramètres → Gestion des licences → Ajouter une licence.",
              `Coller la clé ${issued.licenseKey}`,
              `Code organisation (agents) : ${orgCode}`
            ]
    })
  })

  /** Révoque une clé émise (ne désactive pas automatiquement l’org déjà activée) */
  v1.post("/vendor/licenses/revoke", async (c) => {
    const access = requireVendorSecret(c)
    if (!access.ok) return c.json({ error: access.error }, access.status)
    let body: { license_key?: string }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: "invalid_json" }, 400)
    }
    const key = (body.license_key || "").trim()
    if (!key) return c.json({ error: "license_key_required" }, 400)
    const ok = await store.revokeIssuedLicense(key)
    if (!ok) return c.json({ error: "not_found_or_already_revoked" }, 404)
    console.log(`[vendor] license revoked key=${key}`)
    return c.json({
      ok: true,
      note: "Clé invalidée pour futures activations. Org déjà en full : révoquer aussi dans Paramètres → Licences."
    })
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
   * OTP reset mdp — cible l’admin de l’e-mail saisi (plus le seed DEMO).
   * Public : body.email obligatoire.
   * Session console : POST /org/password-reset/* utilise l’admin connecté.
   */
  async function resolveAdminByEmailForReset(emailRaw: string) {
    const email = (emailRaw || "").trim().toLowerCase()
    if (!email || !email.includes("@")) {
      return { error: "email_required" as const }
    }
    const hits = await store.findAdminsByEmail(email)
    const active = hits.filter((a) => a.active)
    if (active.length === 0) {
      // anti-énumération
      return { soft: true as const, email }
    }
    // Préférer un principal si plusieurs (même email multi-org rare)
    const admin =
      active.find((a) => a.isPrincipal) || active[0]!
    const org = await store.getOrg(admin.orgId)
    if (!org) return { soft: true as const, email }
    return { org, admin, email }
  }

  v1.post("/auth/password-reset/request", async (c) => {
    let body: { email?: string }
    try {
      body = await c.req.json()
    } catch {
      body = {}
    }
    const email = (body.email || "").trim().toLowerCase()
    if (!email) {
      return c.json(
        { error: "email_required", message: "Saisissez l’e-mail du compte admin." },
        400
      )
    }
    const resolved = await resolveAdminByEmailForReset(email)
    if ("error" in resolved) {
      return c.json({ error: resolved.error }, 400)
    }
    if ("soft" in resolved && resolved.soft) {
      return c.json({
        ok: true,
        message:
          "Si un compte admin correspond à cet e-mail, un code OTP a été envoyé."
      })
    }
    if (!("org" in resolved) || !resolved.org || !resolved.admin) {
      return c.json({
        ok: true,
        message:
          "Si un compte admin correspond à cet e-mail, un code OTP a été envoyé."
      })
    }
    // Secondaire : besoin permission email_password_reset
    if (
      !resolved.admin.isPrincipal &&
      !resolved.admin.permissions.includes("email_password_reset")
    ) {
      return c.json({
        ok: true,
        message:
          "Si un compte admin correspond à cet e-mail, un code OTP a été envoyé."
      })
    }
    const result = await store.requestPasswordResetOtp(resolved.org.id, {
      email: resolved.admin.email,
      adminId: resolved.admin.id
    })
    if (!result.ok) {
      // ne pas révéler
      return c.json({
        ok: true,
        message:
          "Si un compte admin correspond à cet e-mail, un code OTP a été envoyé."
      })
    }
    return c.json(result)
  })

  v1.post("/auth/password-reset/confirm", async (c) => {
    let body: { otp?: string; new_password?: string; email?: string }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: "invalid_json" }, 400)
    }
    if (!body.otp || !body.new_password) {
      return c.json({ error: "otp_and_new_password_required" }, 400)
    }
    const email = (body.email || "").trim().toLowerCase()
    if (!email) {
      return c.json({ error: "email_required" }, 400)
    }
    const resolved = await resolveAdminByEmailForReset(email)
    if (!("org" in resolved) || !resolved.org || !resolved.admin) {
      return c.json({ error: "invalid_or_expired" }, 400)
    }
    const result = await store.confirmPasswordResetOtp(
      resolved.org.id,
      body.otp,
      body.new_password,
      { email: resolved.admin.email, adminId: resolved.admin.id }
    )
    if (!result.ok) return c.json({ error: result.error }, 400)
    return c.json({
      ok: true,
      message:
        "Mot de passe mis à jour. Connectez-vous avec le nouveau mot de passe."
    })
  })

  /**
   * Session console : reset pour l’admin CONNECTÉ (pas DEMO seed).
   */
  v1.post("/org/password-reset/request", async (c) => {
    const gate = await requireConsoleAuth(c, "console_access")
    if (!gate.ok) return c.json({ error: gate.error }, gate.status)
    // Secondaire : permission email_password_reset (principal : toujours)
    if (
      !gate.admin.isPrincipal &&
      !adminHas(gate.admin, "email_password_reset")
    ) {
      return c.json(
        {
          error: "forbidden_permission",
          message:
            "Réinit. mdp par e-mail non autorisée. Demandez à un administrateur principal."
        },
        403
      )
    }
    const result = await store.requestPasswordResetOtp(gate.orgId, {
      adminId: gate.admin.id,
      email: gate.admin.email
    })
    if (!result.ok) return c.json({ error: result.error }, 400)
    return c.json(result)
  })

  v1.post("/org/password-reset/confirm", async (c) => {
    const gate = await requireConsoleAuth(c, "console_access")
    if (!gate.ok) return c.json({ error: gate.error }, gate.status)
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
      gate.orgId,
      body.otp,
      body.new_password,
      { adminId: gate.admin.id, email: gate.admin.email }
    )
    if (!result.ok) return c.json({ error: result.error }, 400)
    return c.json({ ok: true, message: "Mot de passe mis à jour." })
  })

  /** Statut SMTP (org + env) — sans secrets */
  v1.get("/org/mail/status", async (c) => {
    const gate = await requireConsoleAuth(c, "console_access")
    if (!gate.ok) return c.json({ error: gate.error }, gate.status)
    const org = await store.getOrg(gate.orgId)
    if (!org) return c.json({ error: "no_org" }, 404)
    const { mergeMonitoringSettings } = await import("./types")
    const mon = mergeMonitoringSettings(org.monitoring)
    const { getMailStatus, publicSmtpView } = await import("./mail")
    // Pas de verify SMTP ici (lent) — uniquement via POST /org/mail/test
    const status = getMailStatus(mon.smtp)
    return c.json({
      org_id: org.id,
      ...status,
      smtp: publicSmtpView(mon.smtp)
    })
  })

  /**
   * Enregistre la config SMTP org (principal).
   * Body = OrgSmtpSettings ; password vide = conserver l’ancien.
   */
  v1.put("/org/mail/settings", async (c) => {
    const gate = await requireConsoleAuth(c, "manage_policies")
    if (!gate.ok) return c.json({ error: gate.error }, gate.status)
    if (!gate.admin.isPrincipal) {
      return c.json({ error: "principal_only" }, 403)
    }
    const org = await store.getOrg(gate.orgId)
    if (!org) return c.json({ error: "no_org" }, 404)
    let body: Partial<import("./types").OrgSmtpSettings>
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: "invalid_json" }, 400)
    }
    const { mergeMonitoringSettings } = await import("./types")
    const prev = mergeMonitoringSettings(org.monitoring)
    const updated = await store.updateOrgMonitoring(org.id, {
      ...prev,
      smtp: {
        ...(prev.smtp || {}),
        ...body
      } as import("./types").OrgSmtpSettings
    })
    await audit(
      gate,
      "org_settings_update",
      `SMTP ${body.enabled === false ? "désactivé" : "mis à jour"} · host=${(body.host || prev.smtp?.host || "").trim() || "—"}`
    )
    const mon = mergeMonitoringSettings(updated?.monitoring)
    const { publicSmtpView, getMailStatus } = await import("./mail")
    return c.json({
      ok: true,
      smtp: publicSmtpView(mon.smtp),
      status: getMailStatus(mon.smtp)
    })
  })

  /** Test connexion SMTP (principal) */
  v1.post("/org/mail/test", async (c) => {
    const gate = await requireConsoleAuth(c, "manage_policies")
    if (!gate.ok) return c.json({ error: gate.error }, gate.status)
    if (!gate.admin.isPrincipal) {
      return c.json({ error: "principal_only" }, 403)
    }
    const org = await store.getOrg(gate.orgId)
    if (!org) return c.json({ error: "no_org" }, 404)
    const { mergeMonitoringSettings } = await import("./types")
    const mon = mergeMonitoringSettings(org.monitoring)
    let body: { send_test_to?: string } = {}
    try {
      body = await c.req.json()
    } catch {
      body = {}
    }
    const { verifySmtpConnection, sendMail, publicSmtpView } = await import(
      "./mail"
    )
    const verify = await verifySmtpConnection(mon.smtp)
    if (!verify.ok) {
      return c.json(
        {
          ok: false,
          verify,
          smtp: publicSmtpView(mon.smtp),
          error: verify.error || "smtp_verify_failed"
        },
        400
      )
    }
    const to = (body.send_test_to || gate.admin.email || "").trim()
    let sent: { ok: boolean; delivery?: string; error?: string } | null = null
    if (to.includes("@")) {
      const { brandedEmailHtml } = await import("./mail")
      const safeName = org.name.replace(/</g, "")
      const r = await sendMail({
        to,
        subject: "OpsGate — test de configuration SMTP",
        text: [
          "OpsGate — test SMTP",
          "",
          "Ceci est un e-mail de test.",
          `Organisation : ${org.name}`,
          `Source SMTP : ${verify.source || "—"}`,
          "",
          "Si vous lisez ce message, la configuration e-mail fonctionne.",
          "",
          "— DailyOps.Tech / OpsGate"
        ].join("\n"),
        html: brandedEmailHtml({
          title: "Test de configuration SMTP",
          bodyHtml: `<p style="margin:0 0 12px">Si vous lisez ce message, l'envoi d'e-mails OpsGate fonctionne pour <strong>${safeName}</strong>.</p>
            <p style="color:#64748b;font-size:13px">Source : ${verify.source || "—"}</p>`
        }),
        smtp: mon.smtp
      })
      sent = {
        ok: r.ok,
        delivery: r.delivery,
        error: r.ok ? undefined : "error" in r ? r.error : undefined
      }
    }
    return c.json({
      ok: true,
      verify,
      test_email: sent,
      smtp: publicSmtpView(mon.smtp)
    })
  })

  /** Inbox admin : messages user → admin */
  v1.get("/org/inbox", async (c) => {
    const gate = await requireConsoleAuth(c, "console_access")
    if (!gate.ok) return c.json({ error: gate.error }, gate.status)
    const statusQ = (c.req.query("status") || "all").trim()
    const status = (
      ["all", "unread", "open", "read", "replied", "closed"].includes(statusQ)
        ? statusQ
        : "all"
    ) as import("./types").InboxMessageStatus | "all" | "unread"
    const limit = Math.min(
      200,
      Math.max(1, Number(c.req.query("limit") || 50) || 50)
    )
    const messages = await store.listInboxMessages(gate.orgId, {
      status,
      limit
    })
    const unread = await store.countInboxUnread(gate.orgId)
    return c.json({
      org_id: gate.orgId,
      unread,
      messages: messages.map(serializeInboxMessage)
    })
  })

  v1.get("/org/inbox/unread-count", async (c) => {
    const gate = await requireConsoleAuth(c, "console_access")
    if (!gate.ok) return c.json({ error: gate.error }, gate.status)
    const unread = await store.countInboxUnread(gate.orgId)
    return c.json({ org_id: gate.orgId, unread })
  })

  v1.post("/org/inbox/:id/read", async (c) => {
    const gate = await requireConsoleAuth(c, "console_access")
    if (!gate.ok) return c.json({ error: gate.error }, gate.status)
    const id = c.req.param("id")
    const msg = await store.markInboxRead(gate.orgId, id)
    if (!msg) return c.json({ error: "not_found" }, 404)
    await store.appendAdminAudit({
      orgId: gate.orgId,
      adminId: gate.admin.id,
      adminEmail: gate.admin.email,
      adminLabel: gate.admin.label,
      action: "inbox_read",
      detail: `Message lu : ${msg.subject.slice(0, 80)}`,
      meta: { message_id: id, agent_id: msg.agentId }
    })
    return c.json({ ok: true, message: serializeInboxMessage(msg) })
  })

  v1.post("/org/inbox/:id/reply", async (c) => {
    const gate = await requireConsoleAuth(c, "console_access")
    if (!gate.ok) return c.json({ error: gate.error }, gate.status)
    const id = c.req.param("id")
    let body: { reply?: string }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: "invalid_json" }, 400)
    }
    const reply = (body.reply || "").trim()
    if (reply.length < 1) {
      return c.json({ error: "reply_required" }, 400)
    }
    const msg = await store.replyInboxMessage(gate.orgId, id, reply, {
      id: gate.admin.id,
      label: gate.admin.label || gate.admin.email
    })
    if (!msg) return c.json({ error: "not_found" }, 404)
    await store.appendAdminAudit({
      orgId: gate.orgId,
      adminId: gate.admin.id,
      adminEmail: gate.admin.email,
      adminLabel: gate.admin.label,
      action: "inbox_reply",
      detail: `Réponse inbox → ${msg.deviceLabel || msg.agentId.slice(0, 12)} : ${msg.subject.slice(0, 60)}`,
      meta: { message_id: id, agent_id: msg.agentId }
    })
    return c.json({ ok: true, message: serializeInboxMessage(msg) })
  })

  v1.post("/org/inbox/:id/close", async (c) => {
    const gate = await requireConsoleAuth(c, "console_access")
    if (!gate.ok) return c.json({ error: gate.error }, gate.status)
    const id = c.req.param("id")
    const msg = await store.closeInboxMessage(gate.orgId, id)
    if (!msg) return c.json({ error: "not_found" }, 404)
    await store.appendAdminAudit({
      orgId: gate.orgId,
      adminId: gate.admin.id,
      adminEmail: gate.admin.email,
      adminLabel: gate.admin.label,
      action: "inbox_close",
      detail: `Message fermé : ${msg.subject.slice(0, 80)}`,
      meta: { message_id: id, agent_id: msg.agentId }
    })
    return c.json({ ok: true, message: serializeInboxMessage(msg) })
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
    const { mergeMonitoringSettings } = await import("./types")
    const mon = mergeMonitoringSettings(org.monitoring)
    return c.json({
      org_id: org.id,
      worm: true,
      legal_retention_days: mon.auditLegalRetentionDays ?? 365,
      events: events.map((e) => ({
        id: e.id,
        adminEmail: e.adminEmail,
        adminLabel: e.adminLabel,
        action: e.action,
        detail: e.detail,
        createdAt: e.createdAt,
        seq: e.seq,
        entry_hash: e.entryHash,
        prev_hash: e.prevHash
      }))
    })
  })

  /** Vérification intégrité chaîne WORM du journal d’audit */
  v1.get("/org/audit/integrity", async (c) => {
    const _gate = await requireConsoleAuth(c, "console_access")
    if (!_gate.ok) return c.json({ error: _gate.error }, _gate.status)
    if (!_gate.admin.isPrincipal) {
      return c.json({ error: "principal_only" }, 403)
    }
    const org = await store.getOrg(_gate.orgId)
    if (!org) return c.json({ error: "no_org" }, 404)
    const rows = await store.listAdminAuditAsc(org.id, 5000)
    const { verifyAuditChain } = await import("./audit-worm")
    const report = verifyAuditChain(
      rows.map((e) => ({
        id: e.id,
        orgId: e.orgId,
        action: e.action,
        detail: e.detail,
        adminId: e.adminId,
        createdAt: e.createdAt,
        seq: e.seq,
        entryHash: e.entryHash,
        prevHash: e.prevHash
      }))
    )
    return c.json({
      org_id: org.id,
      worm: true,
      ...report
    })
  })

  /**
   * Vue MSP multi-org — portfolio des tenants accessibles (même email admin).
   * GET /v1/auth/msp-overview
   */
  v1.get("/auth/msp-overview", async (c) => {
    const auth = await requireConsoleAuth(c, "console_access")
    if (!auth.ok) return c.json({ error: auth.error }, auth.status)
    const accessible = await store.listAccessibleOrgsForEmail(auth.admin.email)
    if (accessible.length <= 1) {
      return c.json({
        multi_org: false,
        org_count: accessible.length,
        orgs: [],
        totals: {
          agents: 0,
          online: 0,
          seats: 0,
          seats_used: 0,
          expiring_licenses: 0
        }
      })
    }
    const { mergeMonitoringSettings } = await import("./types")
    const orgs: Array<Record<string, unknown>> = []
    let tAgents = 0
    let tOnline = 0
    let tSeats = 0
    let tSeatsUsed = 0
    let tExpiring = 0
    for (const o of accessible) {
      const org = await store.getOrg(o.org_id)
      const mon = mergeMonitoringSettings(org?.monitoring)
      let sum: Awaited<ReturnType<typeof store.summary>> | null = null
      try {
        sum = await store.summary(o.org_id)
      } catch {
        sum = null
      }
      const lic = mon.licenseDisplay
      const expRaw = lic?.expiresAt
      let daysLeft: number | null = null
      if (expRaw) {
        const expMs = Date.parse(expRaw)
        if (Number.isFinite(expMs)) {
          daysLeft = Math.ceil((expMs - Date.now()) / (24 * 3600_000))
          if (daysLeft <= 30) tExpiring++
        }
      }
      const agents = sum?.agents ?? 0
      const online = sum?.connectivity?.online ?? 0
      const seats = sum?.licenses?.seats ?? lic?.seats ?? 0
      const seatsUsed = sum?.licenses?.seats_used ?? sum?.licenses?.licensed ?? 0
      tAgents += agents
      tOnline += online
      tSeats += typeof seats === "number" ? seats : 0
      tSeatsUsed += typeof seatsUsed === "number" ? seatsUsed : 0
      orgs.push({
        org_id: o.org_id,
        org_code: o.org_code,
        name: o.name,
        is_principal: o.is_principal,
        current: o.org_id === auth.orgId,
        agents,
        online,
        offline_long: sum?.connectivity?.offline_long ?? 0,
        seats,
        seats_used: seatsUsed,
        license_mode: lic?.mode || "trial",
        license_expires_at: expRaw || null,
        license_days_left: daysLeft,
        company_name: lic?.companyName || o.name
      })
    }
    return c.json({
      multi_org: true,
      org_count: orgs.length,
      current_org_id: auth.orgId,
      orgs,
      totals: {
        agents: tAgents,
        online: tOnline,
        seats: tSeats,
        seats_used: tSeatsUsed,
        expiring_licenses: tExpiring
      }
    })
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
      condition_logic?: "and" | "or"
      permanent?: boolean
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
      onlyIfUnassigned: body.only_if_unassigned,
      conditionLogic: body.condition_logic === "or" ? "or" : "and",
      permanent: body.permanent === true
    })
    // Appliquer immédiatement aux agents déjà enrollés
    let applied = 0
    if (rule?.enabled) {
      const agents = await store.listAgents(org.id)
      for (const a of agents) {
        const r = await store.applyMovingRules(org.id, a.id)
        if (r.applied) applied++
      }
    }
    await store.appendAdminAudit({
      orgId: org.id,
      adminId: _gate.admin.id,
      adminEmail: _gate.admin.email,
      adminLabel: _gate.admin.label,
      action: "moving_rule_upsert",
      detail: `Création règle « ${rule?.name} » (prio ${rule?.priority}, ${conditions.length} cond.) · appliquée à ${applied} agent(s)`
    })
    return c.json({ ok: true, rule, agents_applied: applied })
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
          : existing.onlyIfUnassigned,
      conditionLogic:
        body.condition_logic === "or" || body.condition_logic === "and"
          ? (body.condition_logic as "and" | "or")
          : existing.conditionLogic || "and",
      permanent:
        body.permanent !== undefined
          ? !!body.permanent
          : !!existing.permanent
    })
    let applied = 0
    if (rule?.enabled) {
      const agents = await store.listAgents(org.id)
      for (const a of agents) {
        const r = await store.applyMovingRules(org.id, a.id)
        if (r.applied) applied++
      }
    }
    await store.appendAdminAudit({
      orgId: org.id,
      adminId: _gate.admin.id,
      adminEmail: _gate.admin.email,
      adminLabel: _gate.admin.label,
      action: "moving_rule_upsert",
      detail: `Modif règle « ${rule?.name} » (prio ${rule?.priority}) · appliquée à ${applied} agent(s)`
    })
    return c.json({ ok: true, rule, agents_applied: applied })
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

  /**
   * Import CSV agents (assign groupe / profil / licence).
   * Colonnes : agent_id | device_label | host_name | group | group_id | profile | profile_id | license
   * POST { csv: string, dry_run?: boolean }
   */
  v1.post("/org/agents/import-csv", async (c) => {
    const gate = await requireConsoleAuth(c, "manage_policies")
    if (!gate.ok) return c.json({ error: gate.error }, gate.status)
    if (gate.readOnly) return c.json({ error: "read_only_session" }, 403)
    const org = await store.getOrg(gate.orgId)
    if (!org) return c.json({ error: "no_org" }, 404)
    let body: { csv?: string; dry_run?: boolean }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: "invalid_json" }, 400)
    }
    const csv = (body.csv || "").trim()
    if (!csv) return c.json({ error: "csv_required" }, 400)
    const lines = csv
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"))
    if (lines.length < 2) {
      return c.json({ error: "csv_empty", message: "Header + au moins 1 ligne" }, 400)
    }
    const parseRow = (line: string): string[] => {
      const cells: string[] = []
      let cur = ""
      let q = false
      for (let i = 0; i < line.length; i++) {
        const ch = line[i]!
        if (ch === '"') {
          if (q && line[i + 1] === '"') {
            cur += '"'
            i++
          } else q = !q
        } else if ((ch === "," || ch === ";") && !q) {
          cells.push(cur.trim())
          cur = ""
        } else cur += ch
      }
      cells.push(cur.trim())
      return cells
    }
    const header = parseRow(lines[0]!).map((h) =>
      h.toLowerCase().replace(/\s+/g, "_")
    )
    const idx = (names: string[]) => {
      for (const n of names) {
        const i = header.indexOf(n)
        if (i >= 0) return i
      }
      return -1
    }
    const iId = idx(["agent_id", "id", "agent"])
    const iLabel = idx(["device_label", "label", "name", "device"])
    const iHost = idx(["host_name", "hostname", "host"])
    const iGroup = idx(["group", "group_name", "groupe"])
    const iGroupId = idx(["group_id"])
    const iProf = idx(["profile", "profile_name", "profil"])
    const iProfId = idx(["profile_id", "policy_profile_id"])
    const iLic = idx(["license", "licensed", "licence"])
    if (iId < 0 && iLabel < 0 && iHost < 0) {
      return c.json(
        {
          error: "csv_columns",
          message:
            "Colonnes requises : agent_id et/ou device_label et/ou host_name"
        },
        400
      )
    }
    const rows = lines.slice(1).map((line) => {
      const c = parseRow(line)
      const licRaw = iLic >= 0 ? (c[iLic] || "").toLowerCase() : ""
      let license: boolean | null = null
      if (["1", "true", "yes", "y", "oui", "licensed"].includes(licRaw)) {
        license = true
      } else if (
        ["0", "false", "no", "n", "non", "unlicensed"].includes(licRaw)
      ) {
        license = false
      }
      return {
        agent_id: iId >= 0 ? c[iId] : undefined,
        device_label: iLabel >= 0 ? c[iLabel] : undefined,
        host_name: iHost >= 0 ? c[iHost] : undefined,
        group_name: iGroup >= 0 ? c[iGroup] : undefined,
        group_id: iGroupId >= 0 ? c[iGroupId] : undefined,
        profile_name: iProf >= 0 ? c[iProf] : undefined,
        profile_id: iProfId >= 0 ? c[iProfId] : undefined,
        license
      }
    })
    const result = await store.importAgentsCsv(org.id, rows, {
      dryRun: body.dry_run === true
    })
    if (body.dry_run !== true) {
      await store.appendAdminAudit({
        orgId: org.id,
        adminId: gate.admin.id,
        adminEmail: gate.admin.email,
        adminLabel: gate.admin.label,
        action: "agent_assign",
        detail: `Import CSV agents · matched=${result.matched} updated=${result.updated} skipped=${result.skipped}`
      })
    }
    return c.json({
      ok: true,
      dry_run: body.dry_run === true,
      ...result
    })
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

  /**
   * Lance immédiatement l’export planifié + e-mails (test / rattrapage).
   * POST /v1/org/exports/run-now
   */
  v1.post("/org/exports/run-now", async (c) => {
    const gate = await requireConsoleAuth(c, "console_access")
    if (!gate.ok) return c.json({ error: gate.error }, gate.status)
    if (gate.readOnly) {
      return c.json({ error: "read_only_session" }, 403)
    }
    const org = await store.getOrg(gate.orgId)
    if (!org) return c.json({ error: "no_org" }, 404)
    const mon = (await import("./types")).mergeMonitoringSettings(
      org.monitoring
    )
    const cfg = mon.scheduledLogExport
    if (!cfg?.enabled && !mon.weeklyExportEnabled) {
      return c.json(
        {
          error: "export_disabled",
          message:
            "Activez l’export automatique (Paramètres → Rapports) puis réessayez."
        },
        400
      )
    }
    const emails = (cfg?.recipientEmails || []).filter((e) =>
      String(e).includes("@")
    )
    if (!emails.length) {
      return c.json(
        {
          error: "no_recipients",
          message:
            "Aucun destinataire e-mail configuré pour l’export automatique."
        },
        400
      )
    }
    const { runWeeklyExportForOrg } = await import("./exports-cron")
    const r = await runWeeklyExportForOrg(store, org.id, { force: true })
    await store.appendAdminAudit({
      orgId: org.id,
      adminId: gate.admin.id,
      adminEmail: gate.admin.email,
      adminLabel: gate.admin.label,
      action: "events_export",
      detail: `Export planifié forcé (run-now) week=${r.weekKey || "?"} mails_ok=${r.mails_ok ?? 0}`
    })
    return c.json({
      ok: true,
      ...r,
      smtp_configured: !!(mon.smtp?.enabled && mon.smtp?.host),
      hint:
        (r.mails_ok || 0) > 0
          ? "E-mail(s) accepté(s) par le transport SMTP (ou log serveur si SMTP off)."
          : (r.mails_fail || 0) > 0
            ? "Échec envoi SMTP — vérifiez Paramètres → E-mail / SMTP (test d’envoi)."
            : "Aucun envoi — vérifiez destinataires et logs API [exports]."
    })
  })

  /** Statut export planifié (debug console) */
  v1.get("/org/exports/status", async (c) => {
    const gate = await requireConsoleAuth(c, "console_access")
    if (!gate.ok) return c.json({ error: gate.error }, gate.status)
    const org = await store.getOrg(gate.orgId)
    if (!org) return c.json({ error: "no_org" }, 404)
    const mon = (await import("./types")).mergeMonitoringSettings(
      org.monitoring
    )
    const cfg = mon.scheduledLogExport
    const { isExportScheduleDue } = await import("./exports-cron")
    const due = cfg ? isExportScheduleDue(cfg) : false
    return c.json({
      enabled: !!(cfg?.enabled || mon.weeklyExportEnabled),
      recipient_count: (cfg?.recipientEmails || []).length,
      recipients_masked: (cfg?.recipientEmails || []).map((e) => {
        const [u, d] = String(e).split("@")
        return `${(u || "").slice(0, 2)}***@${d || "?"}`
      }),
      day_of_week: cfg?.dayOfWeek ?? 1,
      time_local: cfg?.timeLocal || "08:00",
      timezone: cfg?.timezone || "Europe/Paris",
      formats: cfg?.formats || ["csv"],
      attach_files: cfg?.attachFiles !== false,
      last_weekly_export_at: mon.lastWeeklyExportAt || null,
      due_now: due,
      smtp_enabled: !!mon.smtp?.enabled,
      smtp_host: mon.smtp?.host || null,
      cron_env: process.env.OPSGATE_EXPORTS_CRON_MINUTES || "15"
    })
  })

  // ── GDPR soft-delete org ─────────────────────────────────────
  v1.get("/org/gdpr/status", async (c) => {
    const gate = await requireConsoleAuth(c, "console_access")
    if (!gate.ok) return c.json({ error: gate.error }, gate.status)
    const org = await store.getOrg(gate.orgId)
    if (!org) return c.json({ error: "no_org" }, 404)
    const { gdprStatusOf, GDPR_CONFIRM_PHRASE, GDPR_RESTORE_PHRASE } =
      await import("./gdpr-org")
    return c.json({
      ok: true,
      ...gdprStatusOf(org),
      confirm_phrase: GDPR_CONFIRM_PHRASE,
      restore_phrase: GDPR_RESTORE_PHRASE
    })
  })

  /** Export portabilité (DSAR) — JSON téléchargeable */
  v1.get("/org/gdpr/export", async (c) => {
    const gate = await requireConsoleAuth(c, "console_access")
    if (!gate.ok) return c.json({ error: gate.error }, gate.status)
    if (!gate.admin.isPrincipal) {
      return c.json({ error: "principal_only" }, 403)
    }
    const { buildGdprExport } = await import("./gdpr-org")
    const payload = await buildGdprExport(store, gate.orgId)
    if (!payload) return c.json({ error: "no_org" }, 404)
    await store.appendAdminAudit({
      orgId: gate.orgId,
      adminId: gate.admin.id,
      adminEmail: gate.admin.email,
      adminLabel: gate.admin.label,
      action: "org_settings_update",
      detail: "Export GDPR / portabilité"
    })
    return c.json({ ok: true, export: payload })
  })

  /**
   * Soft-delete : confirm = "DELETE MY ORG"
   * Bloque enroll + agents, sessions coupées, purge hard après N jours.
   */
  v1.post("/org/gdpr/soft-delete", async (c) => {
    const gate = await requireConsoleAuth(c, "console_access")
    if (!gate.ok) return c.json({ error: gate.error }, gate.status)
    if (gate.readOnly) return c.json({ error: "read_only_session" }, 403)
    if (!gate.admin.isPrincipal) {
      return c.json({ error: "principal_only" }, 403)
    }
    let body: { confirm?: string; reason?: string; force?: boolean }
    try {
      body = await c.req.json()
    } catch {
      body = {}
    }
    const { softDeleteOrganization, GDPR_CONFIRM_PHRASE } = await import(
      "./gdpr-org"
    )
    const r = await softDeleteOrganization(store, gate.orgId, {
      requestedByEmail: gate.admin.email,
      reason: body.reason,
      confirm: body.confirm || "",
      forceProtected: body.force === true && process.env.OPSGATE_ALLOW_DEMO_DELETE === "1"
    })
    if (!r.ok) {
      const status =
        r.error === "confirm_required"
          ? 400
          : r.error === "org_protected"
            ? 403
            : r.error === "already_deleted"
              ? 409
              : 400
      return c.json(
        {
          error: r.error,
          confirm_phrase: GDPR_CONFIRM_PHRASE
        },
        status
      )
    }
    return c.json({
      ok: true,
      ...r.status,
      agents_revoked: r.agents_revoked,
      sessions_revoked: r.sessions_revoked,
      message:
        "Organisation marquée pour suppression. Restauration possible jusqu’à purge_at. Agents et sessions révoqués."
    })
  })

  /** Restore avant purge hard — confirm = "RESTORE MY ORG" */
  v1.post("/org/gdpr/restore", async (c) => {
    const gate = await requireConsoleAuth(c, "console_access")
    if (!gate.ok) return c.json({ error: gate.error }, gate.status)
    if (!gate.admin.isPrincipal) {
      return c.json({ error: "principal_only" }, 403)
    }
    let body: { confirm?: string }
    try {
      body = await c.req.json()
    } catch {
      body = {}
    }
    const { restoreOrganization, GDPR_RESTORE_PHRASE } = await import(
      "./gdpr-org"
    )
    const r = await restoreOrganization(store, gate.orgId, {
      requestedByEmail: gate.admin.email,
      confirm: body.confirm || ""
    })
    if (!r.ok) {
      return c.json(
        { error: r.error, restore_phrase: GDPR_RESTORE_PHRASE },
        r.error === "confirm_required" ? 400 : 409
      )
    }
    return c.json({
      ok: true,
      ...r.status,
      message:
        "Organisation restaurée. Ré-enrôlez les agents (tokens révoqués lors du soft-delete)."
    })
  })

  // ── V3 Shadow AI + Risk Score utilisateur ────────────────────
  v1.get("/org/risk/summary", async (c) => {
    const gate = await requireConsoleAuth(c, "console_access")
    if (!gate.ok) return c.json({ error: gate.error }, gate.status)
    const { parsePeriod, buildOrgRisk } = await import("./risk-shadow")
    const period = parsePeriod(c.req.query("period"))
    const { summary } = await buildOrgRisk(store, gate.orgId, period)
    return c.json({ ok: true, ...summary })
  })

  v1.get("/org/risk/users", async (c) => {
    const gate = await requireConsoleAuth(c, "console_access")
    if (!gate.ok) return c.json({ error: gate.error }, gate.status)
    const { parsePeriod, buildOrgRisk } = await import("./risk-shadow")
    const period = parsePeriod(c.req.query("period"))
    const minScore = Number(c.req.query("min_score") || 0)
    const maxScore = Number(c.req.query("max_score") || 100)
    const page = Math.max(1, Number(c.req.query("page") || 1))
    const limit = Math.min(100, Math.max(1, Number(c.req.query("limit") || 50)))
    const { users, summary } = await buildOrgRisk(store, gate.orgId, period)
    let filtered = users.filter(
      (u) =>
        u.score >= (Number.isFinite(minScore) ? minScore : 0) &&
        u.score <= (Number.isFinite(maxScore) ? maxScore : 100)
    )
    const sort = (c.req.query("sort") || "score_desc").toLowerCase()
    if (sort === "score_asc") filtered.sort((a, b) => a.score - b.score)
    else if (sort === "label")
      filtered.sort((a, b) => a.label.localeCompare(b.label))
    else filtered.sort((a, b) => b.score - a.score)
    const total = filtered.length
    const start = (page - 1) * limit
    const slice = filtered.slice(start, start + limit)
    return c.json({
      ok: true,
      period,
      total,
      page,
      limit,
      average_score: summary.average_score,
      users: slice
    })
  })

  v1.get("/org/risk/users/:agentId", async (c) => {
    const gate = await requireConsoleAuth(c, "console_access")
    if (!gate.ok) return c.json({ error: gate.error }, gate.status)
    const agentId = c.req.param("agentId")
    const { parsePeriod, buildOrgRisk } = await import("./risk-shadow")
    const period = parsePeriod(c.req.query("period"))
    const { users } = await buildOrgRisk(store, gate.orgId, period)
    const row = users.find((u) => u.agent_id === agentId)
    if (!row) return c.json({ error: "not_found" }, 404)
    // Derniers events de l’agent
    const events = (await store.listEvents(gate.orgId, 500)).filter(
      (e) => e.agentId === agentId
    )
    return c.json({
      ok: true,
      period,
      user: row,
      recent_events: events.slice(0, 30).map((e) => ({
        id: e.id,
        ts: e.ts || e.receivedAt,
        decision: e.decision,
        hostname: e.hostname,
        highest_severity: e.highest_severity,
        detection_count: e.detection_count,
        types: e.types
      }))
    })
  })

  v1.get("/org/shadow-ai", async (c) => {
    const gate = await requireConsoleAuth(c, "console_access")
    if (!gate.ok) return c.json({ error: gate.error }, gate.status)
    const { parsePeriod, buildShadowAiInventory } = await import("./risk-shadow")
    const period = parsePeriod(c.req.query("period"))
    const statusRaw = (c.req.query("status") || "all").toLowerCase()
    const status =
      statusRaw === "authorized" ||
      statusRaw === "unauthorized" ||
      statusRaw === "unknown"
        ? statusRaw
        : "all"
    const tools = await buildShadowAiInventory(
      store,
      gate.orgId,
      period,
      status
    )
    return c.json({
      ok: true,
      period,
      tools,
      counts: {
        total: tools.length,
        authorized: tools.filter((t) => t.status === "authorized").length,
        unauthorized: tools.filter((t) => t.status === "unauthorized").length,
        unknown: tools.filter((t) => t.status === "unknown").length
      }
    })
  })

  v1.patch("/org/shadow-ai/:tool", async (c) => {
    const gate = await requireConsoleAuth(c, "manage_policies")
    if (!gate.ok) return c.json({ error: gate.error }, gate.status)
    if (gate.readOnly) return c.json({ error: "read_only_session" }, 403)
    const toolParam = decodeURIComponent(c.req.param("tool") || "")
    let body: { status?: string; display_name?: string }
    try {
      body = await c.req.json()
    } catch {
      body = {}
    }
    const status =
      body.status === "authorized" || body.status === "unauthorized"
        ? body.status
        : body.status === "unknown"
          ? "unknown"
          : null
    if (!status) {
      return c.json(
        { error: "status_required", hint: "authorized | unauthorized | unknown" },
        400
      )
    }
    try {
      const row = await store.upsertOrgAiTool(gate.orgId, {
        tool: toolParam,
        status,
        displayName: body.display_name,
        updatedBy: gate.admin.email
      })
      await store.appendAdminAudit({
        orgId: gate.orgId,
        adminId: gate.admin.id,
        adminEmail: gate.admin.email,
        adminLabel: gate.admin.label,
        action: "org_settings_update",
        detail: `Shadow AI tool ${row.tool} → ${row.status}`
      })
      return c.json({ ok: true, tool: row })
    } catch (e) {
      return c.json(
        { error: e instanceof Error ? e.message : "upsert_failed" },
        400
      )
    }
  })

  v1.post("/org/risk/recalculate", async (c) => {
    const gate = await requireConsoleAuth(c, "console_access")
    if (!gate.ok) return c.json({ error: gate.error }, gate.status)
    if (gate.readOnly) return c.json({ error: "read_only_session" }, 403)
    const { parsePeriod, buildOrgRisk } = await import("./risk-shadow")
    let body: { period?: string }
    try {
      body = await c.req.json()
    } catch {
      body = {}
    }
    const period = parsePeriod(body.period || c.req.query("period"))
    const { summary, users } = await buildOrgRisk(store, gate.orgId, period)
    await store.appendAdminAudit({
      orgId: gate.orgId,
      adminId: gate.admin.id,
      adminEmail: gate.admin.email,
      adminLabel: gate.admin.label,
      action: "org_settings_update",
      detail: `Risk recalculate period=${period} users=${users.length} avg=${summary.average_score}`
    })
    return c.json({
      ok: true,
      summary,
      users_count: users.length,
      note: "Scores calculés à la volée depuis les events (pas de cache obligatoire)."
    })
  })

  /**
   * Backup config org (JSON) — policy, profils, groupes, monitoring (sans secrets).
   * GET /v1/org/backup
   */
  v1.get("/org/backup", async (c) => {
    const gate = await requireConsoleAuth(c, "console_access")
    if (!gate.ok) return c.json({ error: gate.error }, gate.status)
    if (!gate.admin.isPrincipal) {
      return c.json(
        {
          error: "principal_only",
          message: "Export backup réservé au principal."
        },
        403
      )
    }
    const { buildOrgBackup } = await import("./org-backup")
    const payload = await buildOrgBackup(store, gate.orgId)
    if (!payload) return c.json({ error: "no_org" }, 404)
    await store.appendAdminAudit({
      orgId: gate.orgId,
      adminId: gate.admin.id,
      adminEmail: gate.admin.email,
      adminLabel: gate.admin.label,
      action: "org_settings_update",
      detail: "Export backup configuration org"
    })
    return c.json({ ok: true, backup: payload })
  })

  /**
   * Import backup config (merge prudent).
   * POST /v1/org/backup/import  body: backup JSON or { backup: ... }
   */
  v1.post("/org/backup/import", async (c) => {
    const gate = await requireConsoleAuth(c, "console_access")
    if (!gate.ok) return c.json({ error: gate.error }, gate.status)
    if (gate.readOnly) return c.json({ error: "read_only_session" }, 403)
    if (!gate.admin.isPrincipal) {
      return c.json({ error: "principal_only" }, 403)
    }
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: "invalid_json" }, 400)
    }
    const raw =
      body &&
      typeof body === "object" &&
      (body as { backup?: unknown }).backup
        ? (body as { backup: unknown }).backup
        : body
    const { importOrgBackup } = await import("./org-backup")
    const r = await importOrgBackup(store, gate.orgId, raw)
    if (!r.ok) return c.json({ error: r.error }, 400)
    await store.appendAdminAudit({
      orgId: gate.orgId,
      adminId: gate.admin.id,
      adminEmail: gate.admin.email,
      adminLabel: gate.admin.label,
      action: "org_settings_update",
      detail: `Import backup config · ${r.applied.join(", ")}`
    })
    return c.json({ ok: true, applied: r.applied })
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
