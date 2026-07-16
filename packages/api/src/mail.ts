/**
 * Envoi d’e-mails transactionnels OpsGate (SMTP réel).
 *
 * Modèle simple :
 *   Le client configure SON SMTP dans la console
 *   (Paramètres → E-mail / SMTP : host, port, user, pass, From).
 *
 * Repli ops (optionnel) : variables OPSGATE_SMTP_* / SMTP_* sur le serveur
 * si aucune config org n’est active (lab / install sans UI encore faite).
 */
import nodemailer from "nodemailer"
import type { Transporter } from "nodemailer"

import type { OrgSmtpSettings } from "./types"

/** Fallback From uniquement si ni org ni env ne le définissent */
export const OPSGATE_DEFAULT_FROM = "OpsGate <noreply@localhost>"

export type MailDelivery = "smtp" | "log" | "failed" | "disabled"

export type SendMailResult =
  | { ok: true; delivery: "smtp"; messageId?: string }
  | { ok: true; delivery: "log" }
  | { ok: false; delivery: "failed" | "disabled"; error: string }

/** Config SMTP runtime (org ou env) */
export type SmtpRuntimeConfig = {
  host: string
  port: number
  secure: boolean
  user?: string
  pass?: string
  from: string
  tlsInsecure?: boolean
  source: "org" | "env"
}

function env(name: string, fallback = ""): string {
  return (process.env[name] || fallback).trim()
}

export function smtpFromEnv(
  e: NodeJS.ProcessEnv = process.env
): SmtpRuntimeConfig | null {
  const host = (e.OPSGATE_SMTP_HOST || e.SMTP_HOST || "").trim()
  if (!host) return null
  const port = Number(e.OPSGATE_SMTP_PORT || e.SMTP_PORT || 587)
  const secureRaw = (
    e.OPSGATE_SMTP_SECURE ||
    e.SMTP_SECURE ||
    ""
  ).toLowerCase()
  const secure =
    secureRaw === "1" ||
    secureRaw === "true" ||
    secureRaw === "on" ||
    port === 465
  const user = (e.OPSGATE_SMTP_USER || e.SMTP_USER || "").trim()
  const pass = (e.OPSGATE_SMTP_PASS || e.SMTP_PASS || "").trim()
  const from = (
    e.OPSGATE_SMTP_FROM ||
    e.SMTP_FROM ||
    OPSGATE_DEFAULT_FROM
  ).trim()
  const tlsInsecure =
    e.OPSGATE_SMTP_TLS_REJECT === "0" || e.OPSGATE_SMTP_TLS_REJECT === "false"
  return {
    host,
    port: Number.isFinite(port) && port > 0 ? port : 587,
    secure,
    user: user || undefined,
    pass: pass || undefined,
    from: from || OPSGATE_DEFAULT_FROM,
    tlsInsecure,
    source: "env"
  }
}

export function smtpFromOrg(
  smtp?: OrgSmtpSettings | null
): SmtpRuntimeConfig | null {
  if (!smtp || !smtp.enabled) return null
  const host = (smtp.host || "").trim()
  if (!host) return null
  const port = Number(smtp.port) || 587
  // From : celui saisi en console ; sinon user@host approximatif ; sinon fallback local
  let from = (smtp.from || "").trim()
  if (!from) {
    const u = (smtp.user || "").trim()
    from = u.includes("@")
      ? `OpsGate <${u}>`
      : OPSGATE_DEFAULT_FROM
  }
  return {
    host,
    port,
    secure: !!smtp.secure || port === 465,
    user: (smtp.user || "").trim() || undefined,
    pass: (smtp.password || "").trim() || undefined,
    from,
    tlsInsecure: !!smtp.tlsInsecure,
    source: "org"
  }
}

/** Org prioritaire si actif, sinon env */
export function resolveSmtp(
  orgSmtp?: OrgSmtpSettings | null,
  e: NodeJS.ProcessEnv = process.env
): SmtpRuntimeConfig | null {
  return smtpFromOrg(orgSmtp) || smtpFromEnv(e)
}

export function isMailConfigured(
  orgSmtp?: OrgSmtpSettings | null,
  e: NodeJS.ProcessEnv = process.env
): boolean {
  return !!resolveSmtp(orgSmtp, e)
}

/** Expose OTP en clair dans la réponse API (lab). Jamais en prod sauf flag explicite. */
export function shouldExposeDevOtp(
  orgSmtp?: OrgSmtpSettings | null,
  e: NodeJS.ProcessEnv = process.env
): boolean {
  const flag = (
    e.OPSGATE_MAIL_DEV_OTP ||
    e.OPSGATE_ALLOW_DEV_OTP ||
    ""
  ).toLowerCase()
  if (flag === "1" || flag === "true" || flag === "on") return true
  if ((e.NODE_ENV || "").toLowerCase() === "production") return false
  return !isMailConfigured(orgSmtp, e)
}

export function getMailStatus(
  orgSmtp?: OrgSmtpSettings | null,
  e: NodeJS.ProcessEnv = process.env
) {
  const cfg = resolveSmtp(orgSmtp, e)
  const envCfg = smtpFromEnv(e)
  const orgCfg = smtpFromOrg(orgSmtp)
  return {
    configured: !!cfg,
    source: cfg?.source || null,
    host: cfg?.host || null,
    port: cfg ? cfg.port : null,
    from: cfg?.from || null,
    auth: !!(cfg?.user),
    org_enabled: !!orgSmtp?.enabled,
    org_host: orgSmtp?.host || "",
    env_configured: !!envCfg,
    dev_otp_exposed: shouldExposeDevOtp(orgSmtp, e),
    mode: cfg ? ("smtp" as const) : ("log" as const),
    org_ready: !!orgCfg
  }
}

export function publicSmtpView(smtp?: OrgSmtpSettings | null) {
  const s = smtp || null
  return {
    enabled: !!s?.enabled,
    host: s?.host || "",
    port: s?.port || 587,
    secure: !!s?.secure,
    user: s?.user || "",
    from: s?.from || "",
    tlsInsecure: !!s?.tlsInsecure,
    password_set: !!(s?.password && s.password.length > 0)
  }
}

function buildTransport(cfg: SmtpRuntimeConfig | null): Transporter | null {
  if (!cfg?.host) return null
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: cfg.user ? { user: cfg.user, pass: cfg.pass || "" } : undefined,
    tls: { rejectUnauthorized: !cfg.tlsInsecure }
  })
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
  /** Config SMTP (org) ; sinon env */
  smtp?: OrgSmtpSettings | null
  runtime?: SmtpRuntimeConfig | null
}): Promise<SendMailResult> {
  const to = (opts.to || "").trim()
  if (!to || !to.includes("@")) {
    return { ok: false, delivery: "disabled", error: "invalid_recipient" }
  }

  const cfg =
    opts.runtime || resolveSmtp(opts.smtp ?? null)
  const transport = buildTransport(cfg)
  if (!transport || !cfg) {
    console.log(
      `[opsgate-mail] LOG-ONLY → ${to}\n  Subject: ${opts.subject}\n  ${opts.text.slice(0, 400)}`
    )
    return { ok: true, delivery: "log" }
  }

  try {
    const info = await transport.sendMail({
      from: cfg.from,
      to,
      subject: opts.subject,
      text: opts.text,
      html: opts.html || plainToHtml(opts.text)
    })
    console.log(
      `[opsgate-mail] SMTP ok (${cfg.source}) → ${maskEmail(to)} id=${info.messageId || "?"}`
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

function escHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

/** Enveloppe brandée commune à TOUS les e-mails OpsGate */
export function brandedEmailHtml(opts: {
  title: string
  bodyHtml: string
  footerNote?: string
}): string {
  const foot =
    opts.footerNote ||
    "Message automatique OpsGate · DailyOps.Tech · ne pas répondre"
  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f1f5f9;font-family:Segoe UI,Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px">
    <tr><td align="center">
      <table width="480" style="background:#0A1128;border-radius:12px 12px 0 0;padding:20px 24px">
        <tr><td style="color:#2BD9C5;font-weight:700;font-size:18px">OpsGate</td></tr>
        <tr><td style="color:#94a3b8;font-size:12px">DailyOps.Tech</td></tr>
      </table>
      <table width="480" style="background:#ffffff;border-radius:0 0 12px 12px;padding:24px;border:1px solid #e2e8f0;border-top:0">
        <tr><td style="color:#0f172a;font-size:16px;font-weight:600;padding-bottom:14px">${escHtml(opts.title)}</td></tr>
        <tr><td style="color:#334155;font-size:14px;line-height:1.55">${opts.bodyHtml}</td></tr>
        <tr><td style="color:#94a3b8;font-size:11px;padding-top:20px;border-top:1px solid #e2e8f0;margin-top:16px">${escHtml(foot)}</td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`
}

function plainToHtml(text: string): string {
  const esc = escHtml(text).replace(/\n/g, "<br/>")
  return brandedEmailHtml({
    title: "OpsGate",
    bodyHtml: `<div style="white-space:pre-wrap">${esc}</div>`
  })
}

function otpHtml(opts: {
  title: string
  otp: string
  minutes: number
  footer?: string
}): string {
  const body = `
        <p style="margin:0 0 12px">Utilisez ce code à usage unique :</p>
        <p style="text-align:center;margin:16px 0">
          <span style="display:inline-block;letter-spacing:6px;font-size:28px;font-weight:700;color:#0A1128;background:#E6FAF7;padding:12px 20px;border-radius:8px;border:1px solid #2BD9C5">${escHtml(opts.otp)}</span>
        </p>
        <p style="color:#64748b;font-size:13px;margin:8px 0 0">Valable ${opts.minutes} minutes. Ne le partagez à personne.</p>
        <p style="color:#64748b;font-size:13px;margin:16px 0 0;padding:12px;background:#f8fafc;border-radius:6px;border-left:3px solid #2BD9C5">
          <strong>Sécurité :</strong> si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail.
          Votre mot de passe reste inchangé tant que le code n'est pas utilisé.
        </p>
        ${opts.footer ? `<p style="color:#94a3b8;font-size:12px;margin-top:16px">${escHtml(opts.footer)}</p>` : ""}`
  return brandedEmailHtml({ title: opts.title, bodyHtml: body })
}

/** OTP réinitialisation mot de passe administrateur */
export async function sendPasswordResetOtpEmail(opts: {
  to: string
  otp: string
  expiresMin?: number
  orgName?: string
  smtp?: OrgSmtpSettings | null
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
    "SÉCURITÉ : si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail.",
    "Votre mot de passe reste inchangé tant que le code n'est pas utilisé.",
    "",
    "— DailyOps.Tech / OpsGate"
  ]
    .filter(Boolean)
    .join("\n")

  return sendMail({
    to: opts.to,
    subject,
    text,
    smtp: opts.smtp,
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
  smtp?: OrgSmtpSettings | null
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
    smtp: opts.smtp,
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
  smtp?: OrgSmtpSettings | null
}): Promise<SendMailResult> {
  const subject = "OpsGate — notification de sécurité"
  const text = [
    "OpsGate — notification de sécurité",
    "",
    `Le mot de passe du compte${opts.adminLabel ? ` « ${opts.adminLabel} »` : ""} a été réinitialisé.`,
    opts.byEmail ? `Par : ${opts.byEmail}` : "",
    "Vous devrez le changer à la prochaine connexion.",
    "",
    "SÉCURITÉ : si vous n'êtes pas à l'origine de cette action, contactez immédiatement un administrateur principal et changez vos mots de passe.",
    "",
    "— DailyOps.Tech / OpsGate"
  ]
    .filter(Boolean)
    .join("\n")

  const bodyHtml = `
    <p style="margin:0 0 12px">Le mot de passe du compte${opts.adminLabel ? ` <strong>${escHtml(opts.adminLabel)}</strong>` : ""} a été réinitialisé.</p>
    ${opts.byEmail ? `<p style="margin:0 0 12px">Action effectuée par : <code>${escHtml(opts.byEmail)}</code></p>` : ""}
    <p style="margin:0 0 12px">Vous devrez le changer à la prochaine connexion.</p>
    <p style="color:#64748b;font-size:13px;margin:16px 0 0;padding:12px;background:#fef2f2;border-radius:6px;border-left:3px solid #ef4444">
      <strong>Sécurité :</strong> si vous n'êtes pas à l'origine de cette action, contactez immédiatement un administrateur principal.
    </p>`

  return sendMail({
    to: opts.to,
    subject,
    text,
    html: brandedEmailHtml({
      title: "Notification de sécurité",
      bodyHtml
    }),
    smtp: opts.smtp
  })
}

/** Test SMTP (health / admin) */
export async function verifySmtpConnection(
  orgSmtp?: OrgSmtpSettings | null
): Promise<{
  ok: boolean
  error?: string
  source?: "org" | "env"
}> {
  const cfg = resolveSmtp(orgSmtp)
  const transport = buildTransport(cfg)
  if (!transport || !cfg) return { ok: false, error: "smtp_not_configured" }
  try {
    await transport.verify()
    return { ok: true, source: cfg.source }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      source: cfg.source
    }
  }
}
