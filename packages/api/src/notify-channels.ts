/**
 * Dispatch d’alertes multi-canaux (e-mail, Telegram, Slack, webhook).
 * 100 % piloté par OrgNotificationSettings du client.
 */
import { sendMail } from "./mail"
import type {
  OrgNotificationChannel,
  OrgNotificationSettings,
  OrgSmtpSettings
} from "./types"

export type AlertPayload = {
  /** Titre court (Telegram / Slack title) */
  title: string
  /** Corps texte plain */
  text: string
  /** HTML optionnel pour e-mail */
  html?: string
  orgName?: string
  orgCode?: string
}

export type ChannelSendResult = {
  channelId: string
  kind: string
  ok: boolean
  error?: string
}

function enabledChannels(
  notif?: OrgNotificationSettings | null
): OrgNotificationChannel[] {
  const list = notif?.channels || []
  return list.filter((c) => c && c.enabled !== false)
}

async function sendTelegram(
  ch: OrgNotificationChannel,
  payload: AlertPayload
): Promise<ChannelSendResult> {
  const token = (ch.botToken || "").trim()
  const chatId = (ch.chatId || "").trim()
  if (!token || !chatId) {
    return {
      channelId: ch.id,
      kind: "telegram",
      ok: false,
      error: "botToken/chatId manquants"
    }
  }
  const text = `*${escapeMd(payload.title)}*\n\n${escapeMd(payload.text)}${
    payload.orgName ? `\n\n_${escapeMd(payload.orgName)}_` : ""
  }`
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${encodeURIComponent(token)}/sendMessage`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: "Markdown",
          disable_web_page_preview: true
        })
      }
    )
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      return {
        channelId: ch.id,
        kind: "telegram",
        ok: false,
        error: `HTTP ${res.status} ${body.slice(0, 120)}`
      }
    }
    return { channelId: ch.id, kind: "telegram", ok: true }
  } catch (e) {
    return {
      channelId: ch.id,
      kind: "telegram",
      ok: false,
      error: e instanceof Error ? e.message : String(e)
    }
  }
}

function escapeMd(s: string): string {
  return String(s || "").replace(/([_*`\[\]])/g, "\\$1")
}

async function sendWebhook(
  ch: OrgNotificationChannel,
  payload: AlertPayload,
  kind: "slack" | "webhook"
): Promise<ChannelSendResult> {
  const url = (ch.webhookUrl || "").trim()
  if (!url || !/^https?:\/\//i.test(url)) {
    return {
      channelId: ch.id,
      kind,
      ok: false,
      error: "webhookUrl invalide"
    }
  }
  const body =
    kind === "slack"
      ? {
          text: `*${payload.title}*\n${payload.text}${
            payload.orgName ? `\n_${payload.orgName}_` : ""
          }`
        }
      : {
          title: payload.title,
          text: payload.text,
          org_name: payload.orgName || null,
          org_code: payload.orgCode || null,
          source: "OpsGate",
          ts: new Date().toISOString()
        }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    })
    if (!res.ok) {
      const t = await res.text().catch(() => "")
      return {
        channelId: ch.id,
        kind,
        ok: false,
        error: `HTTP ${res.status} ${t.slice(0, 120)}`
      }
    }
    return { channelId: ch.id, kind, ok: true }
  } catch (e) {
    return {
      channelId: ch.id,
      kind,
      ok: false,
      error: e instanceof Error ? e.message : String(e)
    }
  }
}

async function sendEmailChannel(
  ch: OrgNotificationChannel | null,
  notif: OrgNotificationSettings | null | undefined,
  smtp: OrgSmtpSettings | null | undefined,
  payload: AlertPayload
): Promise<ChannelSendResult[]> {
  const emails = (
    ch?.emails?.length
      ? ch.emails
      : notif?.alertEmails || []
  )
    .map((e) => String(e || "").trim().toLowerCase())
    .filter((e) => e.includes("@"))
  const uniq = [...new Set(emails)].slice(0, 20)
  if (!uniq.length) {
    return ch
      ? [
          {
            channelId: ch.id,
            kind: "email",
            ok: false,
            error: "aucun destinataire e-mail"
          }
        ]
      : []
  }
  const results: ChannelSendResult[] = []
  for (const to of uniq) {
    try {
      const r = await sendMail({
        to,
        subject: `[OpsGate] ${payload.title}`,
        text: payload.text,
        html:
          payload.html ||
          `<p><strong>${escapeHtml(payload.title)}</strong></p><pre style="font-family:inherit;white-space:pre-wrap">${escapeHtml(payload.text)}</pre>`,
        smtp: smtp || null
      })
      results.push({
        channelId: ch?.id || "email_default",
        kind: "email",
        ok: r.ok,
        error: r.ok ? undefined : r.error
      })
    } catch (e) {
      results.push({
        channelId: ch?.id || "email_default",
        kind: "email",
        ok: false,
        error: e instanceof Error ? e.message : String(e)
      })
    }
  }
  return results
}

function escapeHtml(s: string): string {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

/**
 * Envoie une alerte sur tous les canaux configurés + e-mail legacy (alertEmails).
 * Les canaux `email` dédiés s’ajoutent ; s’il n’y a aucun canal email mais
 * des alertEmails, on envoie via le canal e-mail par défaut.
 */
export async function dispatchOrgAlert(opts: {
  notif?: OrgNotificationSettings | null
  smtp?: OrgSmtpSettings | null
  payload: AlertPayload
  /** Si false, n’envoie pas le canal e-mail (défaut true) */
  includeEmail?: boolean
}): Promise<ChannelSendResult[]> {
  const notif = opts.notif
  const channels = enabledChannels(notif)
  const results: ChannelSendResult[] = []
  const includeEmail = opts.includeEmail !== false

  let emailChannelUsed = false
  for (const ch of channels) {
    if (ch.kind === "email") {
      if (!includeEmail) continue
      emailChannelUsed = true
      results.push(
        ...(await sendEmailChannel(ch, notif, opts.smtp, opts.payload))
      )
    } else if (ch.kind === "telegram") {
      results.push(await sendTelegram(ch, opts.payload))
    } else if (ch.kind === "slack") {
      results.push(await sendWebhook(ch, opts.payload, "slack"))
    } else if (ch.kind === "webhook") {
      results.push(await sendWebhook(ch, opts.payload, "webhook"))
    }
  }

  // Legacy alertEmails si aucun canal email dédié
  if (
    includeEmail &&
    !emailChannelUsed &&
    (notif?.alertEmails || []).length > 0
  ) {
    results.push(
      ...(await sendEmailChannel(null, notif, opts.smtp, opts.payload))
    )
  }

  return results
}

/** True s’il existe au moins un moyen de livraison (e-mail ou canal externe) */
export function hasAnyNotificationTarget(
  notif?: OrgNotificationSettings | null
): boolean {
  if ((notif?.alertEmails || []).some((e) => String(e).includes("@"))) {
    return true
  }
  return enabledChannels(notif).some((ch) => {
    if (ch.kind === "email") {
      return (ch.emails || []).some((e) => String(e).includes("@"))
    }
    if (ch.kind === "telegram") return !!(ch.botToken && ch.chatId)
    if (ch.kind === "slack" || ch.kind === "webhook") return !!ch.webhookUrl
    return false
  })
}
