/**
 * Billing Stripe — fondations V2.1 (portal personnel / sièges).
 *
 * Env :
 *   OPSGATE_STRIPE_SECRET_KEY=sk_…
 *   OPSGATE_STRIPE_PUBLISHABLE_KEY=pk_…
 *   OPSGATE_STRIPE_WEBHOOK_SECRET=whsec_…
 *   OPSGATE_STRIPE_PRICE_SEAT=price_…   (prix par siège)
 *   OPSGATE_CONSOLE_URL=https://console…
 *
 * Sans clé secrète → endpoints renvoient billing_not_configured.
 */

export type StripeConfig = {
  secretKey: string
  publishableKey: string
  webhookSecret?: string
  priceSeat?: string
  consoleUrl: string
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

export function billingPublicStatus() {
  const cfg = getStripeConfig()
  return {
    enabled: !!cfg,
    publishable_key: cfg?.publishableKey || null,
    price_seat_configured: !!cfg?.priceSeat,
    note: cfg
      ? "Stripe configuré — checkout Checkout Session via POST /v1/billing/checkout"
      : "Définir OPSGATE_STRIPE_SECRET_KEY (+ PRICE_SEAT) pour activer le billing V2.1"
  }
}

/**
 * Crée une Checkout Session Stripe (HTTP API, sans SDK).
 * quantity = sièges additionnels ou total selon price.
 */
export async function createCheckoutSession(opts: {
  orgId: string
  orgCode: string
  customerEmail?: string
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
  const success =
    `${cfg.consoleUrl}${opts.successPath || "/#/settings/license"}?billing=success`
  const cancel =
    `${cfg.consoleUrl}${opts.cancelPath || "/#/settings/license"}?billing=cancel`
  const body = new URLSearchParams()
  body.set("mode", "subscription")
  body.set("success_url", success)
  body.set("cancel_url", cancel)
  body.set("line_items[0][price]", cfg.priceSeat)
  body.set("line_items[0][quantity]", String(qty))
  body.set("client_reference_id", opts.orgId)
  body.set("metadata[org_id]", opts.orgId)
  body.set("metadata[org_code]", opts.orgCode)
  if (opts.customerEmail) body.set("customer_email", opts.customerEmail)

  try {
    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${cfg.secretKey}`,
        "content-type": "application/x-www-form-urlencoded"
      },
      body: body.toString()
    })
    const data = (await res.json()) as {
      id?: string
      url?: string
      error?: { message?: string }
    }
    if (!res.ok || !data.url || !data.id) {
      return {
        ok: false,
        error: data.error?.message || `stripe_http_${res.status}`
      }
    }
    return { ok: true, url: data.url, session_id: data.id }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "stripe_network"
    }
  }
}
