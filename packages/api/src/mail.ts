/**
 * Envoi d’e-mails transactionnels OpsGate (SMTP réel).
 *
 * Config (env) :
 *   OPSGATE_SMTP_HOST       ex. smtp.office365.com / smtp.gmail.com / mailhog
 *   OPSGATE_SMTP_PORT       587 (STARTTLS) ou 465 (TLS)
 *   OPSGATE_SMTP_SECURE     "1" si port 465
 *   OPSGATE_SMTP_USER
 *   OPSGATE_SMTP_PASS
 *   OPSGATE_SMTP_FROM       ex. "OpsGate <noreply@dailyops.tech>"
 *   OPSGATE_SMTP_TLS_REJECT "0" pour lab self-signed
 *
 * Dev sans SMTP :
 *   OPSGATE_MAIL_DEV_OTP=1  → renvoie l’OTP dans la réponse API (lab uniquement)
 *
 * Sans host SMTP : log console uniquement (pas d’envoi réseau).
 */
import nodemailer from "nodemailer"
import type { Transporter } from "nodemailer"

export type MailDelivery = "smtp" | "log" | "failed" | "disabled"

export type SendMailResult =
  | { ok: true; delivery: "smtp"; messageId?: string }
  | { ok: true; delivery: "log" }
  | { ok: false; delivery: "failed" | "disabled"; error: string }

function env(name: string, fallback = ""): string {
  return (process.env[name] || fallback).trim()
}

export function isMailConfigured(
  e: NodeJS.ProcessEnv = process.env
): boolean {
  return !!(e.OPSGATE_SMTP_HOST || e.SMTP_HOST || "").trim()
}

/** Expose OTP en clair dans la réponse API (lab). Jamais en prod sauf flag explicite. */
export function shouldExposeDevOtp(
  e: NodeJS.ProcessEnv = process.env
): boolean {
  const flag = (
    e.OPSGATE_MAIL_DEV_OTP ||
    e.OPSGATE_ALLOW_DEV_OTP ||
    ""
  ).toLowerCase()
  if (flag === "1" || flag === "true" || flag === "on") return true
  if ((e.NODE_ENV || "").toLowerCase() === "production") return false
  // Lab : si pas de SMTP, autoriser dev_otp pour ne pas bloquer les tests
  return !isMailConfigured(e)
}

export function getMailStatus(e: NodeJS.ProcessEnv = process.env) {
  const host = (e.OPSGATE_SMTP_HOST || e.SMTP_HOST || "").trim()
  const port = Number(e.OPSGATE_SMTP_PORT || e.SMTP_PORT || 587)
  const from = (
    e.OPSGATE_SMTP_FROM ||
    e.SMTP_FROM ||
    "OpsGate <noreply@localhost>"
  ).trim()
  const user = (e.OPSGATE_SMTP_USER || e.SMTP_USER || "").trim()
  return {
    configured: !!host,
    host: host || null,
    port: host ? port : null,
    from,
    auth: !!user,
    dev_otp_exposed: shouldExposeDevOtp(e),
    mode: host ? ("smtp" as const) : ("log" as const)
  }
}

function buildTransport(): Transporter | null {
  const host = env("OPSGATE_SMTP_HOST") || env("SMTP_HOST")
  if (!host) return null
  const port = Number(env("OPSGATE_SMTP_PORT") || env("SMTP_PORT") || "587")
  const secureRaw = (
    env("OPSGATE_SMTP_SECURE") ||
    env("SMTP_SECURE") ||
    ""
  ).toLowerCase()
  const secure =
    secureRaw === "1" ||
    secureRaw === "true" ||
    secureRaw === "on" ||
    port === 465
  const user = env("OPSGATE_SMTP_USER") || env("SMTP_USER")
  const pass = env("OPSGATE_SMTP_PASS") || env("SMTP_PASS")
  const rejectUnauthorized = !(
    env("OPSGATE_SMTP_TLS_REJECT") === "0" ||
    env("OPSGATE_SMTP_TLS_REJECT") === "false"
  )

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: user ? { user, pass } : undefined,
    tls: { rejectUnauthorized }
  })
}

function brandFrom(): string {
  return (
    env("OPSGATE_SMTP_FROM") ||
    env("SMTP_FROM") ||
    "OpsGate <noreply@localhost>"
  )
}

export function maskEmail(email: string): string {
  const e = (email || "").trim()
  const at = e.indexOf("@")
  if (at < 1) return "***"
  const local = e.slice(0, at)
  const domain = e.slice(at + 1)
  const keep = Math.min(2, local.length)
  return `${local.slice(0, keep)}***@${domain}`
}

export async function sendMail(opts: {
  to: string
  subject: string
  text: string
  html?: string
}): Promise<SendMailResult> {
  const to = (opts.to || "").trim()
  if (!to || !to.includes("@")) {
    return { ok: false, delivery: "disabled", error: "invalid_recipient" }
  }

  const transport = buildTransport()
  if (!transport) {
    console.log(
      `[opsgate-mail] LOG-ONLY → ${to}\n  Subject: ${opts.subject}\n  ${opts.text.slice(0, 400)}`
    )
    return { ok: true, delivery: "log" }
  }

  try {
    const info = await transport.sendMail({
      from: brandFrom(),
      to,
      subject: opts.subject,
      text: opts.text,
      html: opts.html || plainToHtml(opts.text)
    })
    console.log(
      `[opsgate-mail] SMTP ok → ${maskEmail(to)} id=${info.messageId || "?"}`
    )
    return {
      ok: true,
      delivery: "smtp",
      messageId: info.messageId
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`[opsgate-mail] SMTP fail → ${maskEmail(to)}: ${msg}`)
    return { ok: false, delivery: "failed", error: msg }
  }
}

function plainToHtml(text: string): string {
  const esc = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
  return `<pre style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.5;color:#0f172a;white-space:pre-wrap">${esc}</pre>`
}

function otpHtml(opts: {
  title: string
  otp: string
  minutes: number
  footer?: string
}): string {
  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f1f5f9;font-family:Segoe UI,Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px">
    <tr><td align="center">
      <table width="480" style="background:#0A1128;border-radius:12px 12px 0 0;padding:20px 24px">
        <tr><td style="color:#2BD9C5;font-weight:700;font-size:18px">OpsGate</td></tr>
        <tr><td style="color:#94a3b8;font-size:12px">DailyOps.Tech</td></tr>
      </table>
      <table width="480" style="background:#ffffff;border-radius:0 0 12px 12px;padding:24px;border:1px solid #e2e8f0;border-top:0">
        <tr><td style="color:#0f172a;font-size:16px;font-weight:600;padding-bottom:12px">${opts.title}</td></tr>
        <tr><td style="color:#334155;font-size:14px;padding-bottom:16px">Utilisez ce code à usage unique :</td></tr>
        <tr><td align="center" style="padding:16px 0">
          <span style="display:inline-block;letter-spacing:6px;font-size:28px;font-weight:700;color:#0A1128;background:#E6FAF7;padding:12px 20px;border-radius:8px;border:1px solid #2BD9C5">${opts.otp}</span>
        </td></tr>
        <tr><td style="color:#64748b;font-size:13px;padding-top:8px">Valable ${opts.minutes} minutes. Ne le partagez à personne.</td></tr>
        ${
          opts.footer
            ? `<tr><td style="color:#94a3b8;font-size:12px;padding-top:16px">${opts.footer}</td></tr>`
            : ""
        }
      </table>
    </td></tr>
  </table>
</body></html>`
}

/** OTP réinitialisation mot de passe administrateur */
export async function sendPasswordResetOtpEmail(opts: {
  to: string
  otp: string
  expiresMin?: number
  orgName?: string
}): Promise<SendMailResult> {
  const minutes = opts.expiresMin ?? 10
  const subject = "OpsGate — code de réinitialisation du mot de passe"
  const text = [
    "OpsGate — réinitialisation du mot de passe",
    opts.orgName ? `Organisation : ${opts.orgName}` : "",
    "",
    `Votre code OTP : ${opts.otp}`,
    `Valable ${minutes} minutes.`,
    "",
    "Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail.",
    "— DailyOps.Tech / OpsGate"
  ]
    .filter(Boolean)
    .join("\n")

  return sendMail({
    to: opts.to,
    subject,
    text,
    html: otpHtml({
      title: "Réinitialisation du mot de passe",
      otp: opts.otp,
      minutes,
      footer: opts.orgName
        ? `Organisation : ${opts.orgName}`
        : "Console d’administration OpsGate"
    })
  })
}

/** OTP générique (login e-mail optionnel, défis divers) */
export async function sendGenericOtpEmail(opts: {
  to: string
  otp: string
  purpose: string
  expiresMin?: number
}): Promise<SendMailResult> {
  const minutes = opts.expiresMin ?? 10
  const subject = `OpsGate — code ${opts.purpose}`
  const text = [
    `OpsGate — ${opts.purpose}`,
    "",
    `Votre code OTP : ${opts.otp}`,
    `Valable ${minutes} minutes.`,
    "",
    "— DailyOps.Tech / OpsGate"
  ].join("\n")

  return sendMail({
    to: opts.to,
    subject,
    text,
    html: otpHtml({
      title: opts.purpose,
      otp: opts.otp,
      minutes
    })
  })
}

/** Notification mdp réinitialisé par un admin (pas d’OTP) */
export async function sendPasswordChangedNotice(opts: {
  to: string
  adminLabel?: string
  byEmail?: string
}): Promise<SendMailResult> {
  const subject = "OpsGate — mot de passe réinitialisé"
  const text = [
    "OpsGate — notification de sécurité",
    "",
    `Le mot de passe du compte${opts.adminLabel ? ` « ${opts.adminLabel} »` : ""} a été réinitialisé.`,
    opts.byEmail ? `Par : ${opts.byEmail}` : "",
    "Vous devrez le changer à la prochaine connexion.",
    "",
    "Si vous n'êtes pas à l'origine de cette action, contactez votre administrateur principal.",
    "— DailyOps.Tech / OpsGate"
  ]
    .filter(Boolean)
    .join("\n")

  return sendMail({ to: opts.to, subject, text })
}

/** Test SMTP (health / admin) */
export async function verifySmtpConnection(): Promise<{
  ok: boolean
  error?: string
}> {
  const transport = buildTransport()
  if (!transport) return { ok: false, error: "smtp_not_configured" }
  try {
    await transport.verify()
    return { ok: true }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e)
    }
  }
}
