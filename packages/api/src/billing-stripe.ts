/**
 * Billing Stripe — portal personnel / sièges (V2 functional pre-GA).
 *
 * Env :
 *   OPSGATE_STRIPE_SECRET_KEY=sk_…
 *   OPSGATE_STRIPE_PUBLISHABLE_KEY=pk_…
 *   OPSGATE_STRIPE_WEBHOOK_SECRET=whsec_…
 *   OPSGATE_STRIPE_PRICE_SEAT=price_…   (prix par siège, subscription)
 *   OPSGATE_CONSOLE_URL=https://console…
 *
 * Sans clé secrète → endpoints renvoient billing_not_configured.
 *
 * Flux :
 *   1. POST /v1/billing/checkout → Checkout Session (subscription)
 *   2. Webhook checkout.session.completed / customer.subscription.* → sièges
 *   3. POST /v1/billing/portal → Stripe Customer Portal (gérer abo)
 */

import { createHmac, timingSafeEqual } from "node:crypto"

export type StripeConfig = {
  secretKey: string
  publishableKey: string
  webhookSecret?: string
  priceSeat?: string
  consoleUrl: string
}

/** Snapshot billing stocké dans monitoring_json.stripeBilling */
export type OrgStripeBilling = {
  customerId?: string | null
  subscriptionId?: string | null
  subscriptionStatus?: string | null
  quantity?: number | null
  lastSessionId?: string | null
  lastEventAt?: string | null
  priceId?: string | null
}

export function getStripeConfig(
  env: NodeJS.ProcessEnv = process.env
): StripeConfig | null {
  const secretKey = (env.OPSGATE_STRIPE_SECRET_KEY || "").trim()
  if (!secretKey.startsWith("sk_")) return null
  return {
    secretKey,
    publishableKey: (env.OPSGATE_STRIPE_PUBLISHABLE_KEY || "").trim(),
    webhookSecret: (env.OPSGATE_STRIPE_WEBHOOK_SECRET || "").trim() || undefined,
    priceSeat: (env.OPSGATE_STRIPE_PRICE_SEAT || "").trim() || undefined,
    consoleUrl: (
      env.OPSGATE_CONSOLE_URL ||
      env.OPSGATE_PUBLIC_URL ||
      "http://127.0.0.1:5173"
    ).replace(/\/$/, "")
  }
}

export function billingPublicStatus(billing?: OrgStripeBilling | null) {
  const cfg = getStripeConfig()
  return {
    enabled: !!cfg,
    publishable_key: cfg?.publishableKey || null,
    price_seat_configured: !!cfg?.priceSeat,
    webhook_configured: !!cfg?.webhookSecret,
    portal_available: !!(cfg && billing?.customerId),
    subscription_status: billing?.subscriptionStatus || null,
    subscription_quantity: billing?.quantity ?? null,
    has_customer: !!billing?.customerId,
    note: cfg
      ? "Stripe actif — checkout + portal + webhook sièges"
      : "Définir OPSGATE_STRIPE_SECRET_KEY (+ PRICE_SEAT, WEBHOOK_SECRET) pour activer le billing"
  }
}

async function stripeForm(
  path: string,
  body: URLSearchParams,
  secretKey: string
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }> {
  try {
    const res = await fetch(`https://api.stripe.com/v1${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${secretKey}`,
        "content-type": "application/x-www-form-urlencoded"
      },
      body: body.toString()
    })
    const data = (await res.json()) as Record<string, unknown> & {
      error?: { message?: string }
    }
    if (!res.ok) {
      return {
        ok: false,
        error: data.error?.message || `stripe_http_${res.status}`
      }
    }
    return { ok: true, data }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "stripe_network"
    }
  }
}

/**
 * Crée une Checkout Session Stripe (subscription seats).
 * quantity = nombre de sièges abonnés.
 */
export async function createCheckoutSession(opts: {
  orgId: string
  orgCode: string
  customerEmail?: string
  customerId?: string | null
  quantity: number
  successPath?: string
  cancelPath?: string
}): Promise<
  | { ok: true; url: string; session_id: string }
  | { ok: false; error: string }
> {
  const cfg = getStripeConfig()
  if (!cfg) return { ok: false, error: "billing_not_configured" }
  if (!cfg.priceSeat) return { ok: false, error: "price_seat_not_configured" }
  const qty = Math.min(500, Math.max(1, Math.floor(opts.quantity) || 1))
  const success = `${cfg.consoleUrl}${opts.successPath || "/#/settings/license"}?billing=success`
  const cancel = `${cfg.consoleUrl}${opts.cancelPath || "/#/settings/license"}?billing=cancel`
  const body = new URLSearchParams()
  body.set("mode", "subscription")
  body.set("success_url", success)
  body.set("cancel_url", cancel)
  body.set("line_items[0][price]", cfg.priceSeat)
  body.set("line_items[0][quantity]", String(qty))
  body.set("client_reference_id", opts.orgId)
  body.set("metadata[org_id]", opts.orgId)
  body.set("metadata[org_code]", opts.orgCode)
  body.set("metadata[quantity]", String(qty))
  body.set("subscription_data[metadata][org_id]", opts.orgId)
  body.set("subscription_data[metadata][org_code]", opts.orgCode)
  body.set("subscription_data[metadata][quantity]", String(qty))
  body.set("allow_promotion_codes", "true")
  if (opts.customerId) {
    body.set("customer", opts.customerId)
  } else if (opts.customerEmail) {
    body.set("customer_email", opts.customerEmail)
  }

  const r = await stripeForm("/checkout/sessions", body, cfg.secretKey)
  if (!r.ok) return r
  const url = typeof r.data.url === "string" ? r.data.url : ""
  const id = typeof r.data.id === "string" ? r.data.id : ""
  if (!url || !id) return { ok: false, error: "stripe_session_incomplete" }
  return { ok: true, url, session_id: id }
}

/** Stripe Customer Portal — gérer moyen de paiement / résilier */
export async function createBillingPortalSession(opts: {
  customerId: string
  returnPath?: string
}): Promise<
  | { ok: true; url: string }
  | { ok: false; error: string }
> {
  const cfg = getStripeConfig()
  if (!cfg) return { ok: false, error: "billing_not_configured" }
  if (!opts.customerId?.trim()) return { ok: false, error: "no_stripe_customer" }
  const body = new URLSearchParams()
  body.set("customer", opts.customerId.trim())
  body.set(
    "return_url",
    `${cfg.consoleUrl}${opts.returnPath || "/#/settings/license"}`
  )
  const r = await stripeForm("/billing_portal/sessions", body, cfg.secretKey)
  if (!r.ok) return r
  const url = typeof r.data.url === "string" ? r.data.url : ""
  if (!url) return { ok: false, error: "stripe_portal_incomplete" }
  return { ok: true, url }
}

/**
 * Vérifie la signature Stripe-Signature (HMAC SHA-256, tolérance 5 min).
 * https://docs.stripe.com/webhooks/signatures
 */
export function verifyStripeWebhookSignature(
  rawBody: string,
  signatureHeader: string | undefined,
  secret: string,
  toleranceSec = 300
): boolean {
  if (!signatureHeader || !secret || !rawBody) return false
  const parts = Object.fromEntries(
    signatureHeader.split(",").map((p) => {
      const [k, ...rest] = p.trim().split("=")
      return [k, rest.join("=")]
    })
  ) as Record<string, string>
  const ts = parts.t
  const v1 = parts.v1
  if (!ts || !v1) return false
  const tsNum = Number(ts)
  if (!Number.isFinite(tsNum)) return false
  if (Math.abs(Date.now() / 1000 - tsNum) > toleranceSec) return false
  const signed = `${ts}.${rawBody}`
  const expected = createHmac("sha256", secret).update(signed, "utf8").digest("hex")
  try {
    const a = Buffer.from(expected, "utf8")
    const b = Buffer.from(v1, "utf8")
    if (a.length !== b.length) return false
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}

export type StripeWebhookApply =
  | {
      ok: true
      orgId: string
      seats: number
      billing: OrgStripeBilling
      action: string
    }
  | { ok: false; error: string; skip?: boolean }

/**
 * Interprète un event Stripe et calcule sièges + snapshot billing à persister.
 * Le caller applique setOrgLicenseSeats + updateOrgMonitoring.
 */
export function interpretStripeEvent(
  event: Record<string, unknown>
): StripeWebhookApply {
  const type = String(event.type || "")
  const dataObj = (event.data as { object?: Record<string, unknown> } | undefined)
    ?.object
  if (!dataObj) return { ok: false, error: "no_data_object", skip: true }

  if (type === "checkout.session.completed") {
    const meta = (dataObj.metadata || {}) as Record<string, string>
    const orgId =
      meta.org_id ||
      (typeof dataObj.client_reference_id === "string"
        ? dataObj.client_reference_id
        : "")
    if (!orgId) return { ok: false, error: "missing_org_id" }
    const qty = extractQuantity(dataObj)
    const customerId =
      typeof dataObj.customer === "string" ? dataObj.customer : null
    const subId =
      typeof dataObj.subscription === "string" ? dataObj.subscription : null
    return {
      ok: true,
      orgId,
      seats: qty,
      action: type,
      billing: {
        customerId,
        subscriptionId: subId,
        subscriptionStatus: "active",
        quantity: qty,
        lastSessionId:
          typeof dataObj.id === "string" ? dataObj.id : null,
        lastEventAt: new Date().toISOString(),
        priceId: null
      }
    }
  }

  if (
    type === "customer.subscription.updated" ||
    type === "customer.subscription.created" ||
    type === "customer.subscription.deleted"
  ) {
    const meta = (dataObj.metadata || {}) as Record<string, string>
    const orgId = meta.org_id || ""
    if (!orgId) return { ok: false, error: "missing_org_id", skip: true }
    const status =
      type === "customer.subscription.deleted"
        ? "canceled"
        : String(dataObj.status || "unknown")
    const qty =
      type === "customer.subscription.deleted" ? 0 : extractQuantity(dataObj)
    const customerId =
      typeof dataObj.customer === "string" ? dataObj.customer : null
    const subId = typeof dataObj.id === "string" ? dataObj.id : null
    const items = dataObj.items as
      | { data?: Array<{ price?: { id?: string }; quantity?: number }> }
      | undefined
    const priceId = items?.data?.[0]?.price?.id || null
    return {
      ok: true,
      orgId,
      seats: qty,
      action: type,
      billing: {
        customerId,
        subscriptionId: subId,
        subscriptionStatus: status,
        quantity: qty,
        lastSessionId: null,
        lastEventAt: new Date().toISOString(),
        priceId
      }
    }
  }

  return { ok: false, error: `unhandled_${type || "event"}`, skip: true }
}

function extractQuantity(obj: Record<string, unknown>): number {
  // Checkout session: line_items not always expanded — use metadata quantity or default
  if (typeof obj.metadata === "object" && obj.metadata) {
    const m = obj.metadata as Record<string, string>
    if (m.quantity) {
      const n = Number(m.quantity)
      if (Number.isFinite(n) && n > 0) return Math.min(500, Math.floor(n))
    }
  }
  // Subscription items
  const items = obj.items as
    | { data?: Array<{ quantity?: number }> }
    | undefined
  if (items?.data?.length) {
    const sum = items.data.reduce(
      (acc, it) => acc + (Number(it.quantity) || 0),
      0
    )
    if (sum > 0) return Math.min(500, sum)
  }
  // Checkout: amount_total / quantity sometimes in display_items (legacy)
  if (typeof obj.quantity === "number" && obj.quantity > 0) {
    return Math.min(500, Math.floor(obj.quantity))
  }
  return 1
}

/** Merge billing snapshot into monitoring.stripeBilling */
export function mergeStripeBilling(
  prev: OrgStripeBilling | null | undefined,
  next: OrgStripeBilling
): OrgStripeBilling {
  return {
    customerId: next.customerId ?? prev?.customerId ?? null,
    subscriptionId: next.subscriptionId ?? prev?.subscriptionId ?? null,
    subscriptionStatus:
      next.subscriptionStatus ?? prev?.subscriptionStatus ?? null,
    quantity:
      next.quantity !== undefined && next.quantity !== null
        ? next.quantity
        : (prev?.quantity ?? null),
    lastSessionId: next.lastSessionId ?? prev?.lastSessionId ?? null,
    lastEventAt: next.lastEventAt ?? prev?.lastEventAt ?? null,
    priceId: next.priceId ?? prev?.priceId ?? null
  }
}
