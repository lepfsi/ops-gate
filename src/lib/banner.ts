import type { Detection } from "@opsgate/engine"

import { ext } from "./browser-api"
import type {
  DefaultAction,
  DetectionSource,
  PolicyUserMessages,
  UserDecision
} from "../types"
import { DEFAULT_USER_MESSAGES, mergeUserMessages } from "../types"

const BANNER_ID = "opsgate-alert-banner"

/** Handler de décision du bandeau actif (pour forcer cancel si popup admin) */
let activeBannerDecision: ((d: UserDecision) => void) | null = null

const SEVERITY_COLOR: Record<string, string> = {
  high: "#dc2626",
  medium: "#d97706",
  low: "#2563eb"
}

export interface BannerOptions {
  source?: DetectionSource
  fileNames?: string[]
  note?: string
  /** Action policy effective */
  defaultAction?: DefaultAction
  /** Messages admin (partial OK) */
  userMessages?: Partial<PolicyUserMessages>
  orgName?: string
  /**
   * Affiche « Contacter l’admin » (agent enrôlé).
   * Défaut: true — l’API renverra not_enrolled si hors org.
   */
  contactAdminEnabled?: boolean
}

/** Styles isolés dans un Shadow DOM (évite que ChatGPT/Claude écrasent le rouge) */
const SHADOW_CSS = `
  :host {
    all: initial;
  }
  .wrap {
    position: fixed;
    top: 12px;
    left: 50%;
    transform: translateX(-50%);
    /* Sous le popup réponse admin (2147483647) */
    z-index: 2147483645;
    width: min(600px, calc(100vw - 24px));
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    font-size: 14px;
    color: #0f172a;
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    box-shadow: 0 12px 40px rgba(15, 23, 42, 0.22);
    overflow: hidden;
    animation: og-in 0.2s ease-out;
  }
  .wrap.mode-block {
    border-color: #fecaca;
  }
  .wrap.mode-force {
    border-color: #fde68a;
  }
  @keyframes og-in {
    from { opacity: 0; transform: translateX(-50%) translateY(-8px); }
    to { opacity: 1; transform: translateX(-50%) translateY(0); }
  }
  .header {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 14px 16px 10px;
    border-bottom: 1px solid #f1f5f9;
    background: linear-gradient(180deg, #fff7ed 0%, #ffffff 55%);
  }
  .wrap.mode-block .header {
    background: linear-gradient(180deg, #fef2f2 0%, #ffffff 55%);
  }
  .wrap.mode-force .header {
    background: linear-gradient(180deg, #fffbeb 0%, #ffffff 55%);
  }
  .badge {
    flex-shrink: 0;
    width: 36px;
    height: 36px;
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(145deg, #0a1128 0%, #0f766e 100%);
    box-shadow: inset 0 0 0 1px rgba(43, 217, 197, 0.4);
  }
  .badge svg { width: 22px; height: 22px; display: block; }
  .title {
    margin: 0;
    font-size: 15px;
    font-weight: 700;
    line-height: 1.3;
    color: #0f172a;
  }
  .sub {
    margin: 4px 0 0;
    color: #475569;
    font-size: 13px;
    line-height: 1.45;
  }
  .admin-notice {
    margin: 10px 0 0;
    padding: 8px 10px;
    border-radius: 8px;
    background: #ecfdf5;
    border: 1px solid #99f6e4;
    color: #0f766e;
    font-size: 12px;
    font-weight: 650;
    line-height: 1.4;
  }
  .wrap.mode-block .admin-notice {
    background: #fef2f2;
    border-color: #fecaca;
    color: #b91c1c;
  }
  .warn-line {
    margin: 8px 0 0;
    color: #b45309;
    font-size: 12px;
    font-weight: 650;
  }
  .pill {
    display: inline-block;
    margin-top: 6px;
    font-size: 11px;
    font-weight: 700;
    padding: 2px 8px;
    border-radius: 999px;
    background: #ffedd5;
    color: #9a3412;
  }
  .wrap.mode-block .pill {
    background: #fee2e2;
    color: #991b1b;
  }
  .details {
    display: none;
    padding: 0 16px 10px;
    max-height: 200px;
    overflow-y: auto;
    background: #fff;
  }
  .details.open { display: block; }
  .item {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    padding: 8px 10px;
    margin-top: 6px;
    background: #f8fafc;
    border-radius: 8px;
    font-size: 12px;
  }
  .sev {
    flex-shrink: 0;
    font-size: 10px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    padding: 2px 6px;
    border-radius: 4px;
    color: #fff;
  }
  .item-type { font-weight: 650; color: #0f172a; }
  .item-match {
    color: #64748b;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    word-break: break-all;
    margin-top: 2px;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding: 12px 16px 14px;
    background: #f8fafc;
    border-top: 1px solid #f1f5f9;
  }
  button {
    appearance: none;
    -webkit-appearance: none;
    border-radius: 8px;
    padding: 9px 13px;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    font-family: inherit;
    line-height: 1.2;
    transition: filter 0.12s, transform 0.05s;
  }
  button:hover { filter: brightness(0.97); }
  button:active { transform: translateY(1px); }
  .btn-primary {
    border: 1px solid #0a1128;
    background: #0a1128;
    color: #ffffff;
  }
  .btn-accent {
    border: 1px solid #0d9488;
    background: #2bd9c5;
    color: #0a1128;
  }
  .btn-danger {
    border: 2px solid #b91c1c;
    background: #dc2626;
    color: #ffffff;
    box-shadow: 0 1px 2px rgba(185, 28, 28, 0.25);
  }
  .btn-danger:hover {
    background: #b91c1c;
    filter: none;
  }
  .btn-secondary {
    border: 1px solid #cbd5e1;
    background: #ffffff;
    color: #334155;
  }
  .btn-ghost {
    border: 1px solid transparent;
    background: transparent;
    color: #64748b;
  }
  .btn-contact {
    border: 1px solid #0f766e;
    background: #ccfbf1;
    color: #0f766e;
    font-weight: 750;
  }
  .btn-contact:hover {
    background: #99f6e4;
    filter: none;
  }
  .wrap.mode-block .btn-contact {
    border-color: #0f766e;
    background: #ecfdf5;
  }
  /* Mode contact : le bandeau d’alerte cède la place au formulaire */
  .wrap.contact-mode .alert-main { display: none !important; }
  .wrap.contact-mode {
    width: min(560px, calc(100vw - 24px));
  }
  .contact-panel {
    display: none;
    padding: 16px 18px 18px;
    background: #f8fafc;
  }
  .wrap.contact-mode .contact-panel,
  .contact-panel.open { display: block; }
  .contact-panel .contact-title {
    margin: 0 0 4px;
    font-size: 16px;
    font-weight: 750;
    color: #0f172a;
  }
  .contact-panel .contact-hint {
    margin: 0 0 12px;
    font-size: 12px;
    color: #64748b;
    line-height: 1.4;
  }
  .contact-panel label {
    display: block;
    font-size: 11px;
    font-weight: 700;
    color: #64748b;
    margin: 0 0 4px;
  }
  .contact-panel input,
  .contact-panel textarea {
    width: 100%;
    box-sizing: border-box;
    margin-bottom: 10px;
    padding: 10px 12px;
    border-radius: 8px;
    border: 1px solid #cbd5e1;
    font-size: 14px;
    font-family: inherit;
    color: #0f172a;
    background: #fff;
    line-height: 1.45;
  }
  .contact-panel textarea {
    min-height: 180px;
    resize: vertical;
  }
  .post-contact-note {
    display: none;
    margin: 0;
    padding: 10px 12px;
    border-radius: 8px;
    background: #ecfdf5;
    border: 1px solid #99f6e4;
    color: #0f766e;
    font-size: 13px;
    font-weight: 650;
    line-height: 1.4;
  }
  .post-contact-note.visible { display: block; }
  .contact-status {
    margin: 0 0 8px;
    font-size: 12px;
    font-weight: 650;
    line-height: 1.35;
  }
  .contact-status.ok { color: #166534; }
  .contact-status.err { color: #b91c1c; }
  .contact-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  button:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
`

/**
 * Retire le bandeau d’alerte.
 * @param asCancel si true, notifie le content script (pending=false, cancel)
 */
export function removeBanner(asCancel = false) {
  const el = document.getElementById(BANNER_ID)
  if (asCancel && activeBannerDecision) {
    const fn = activeBannerDecision
    activeBannerDecision = null
    try {
      fn("cancel")
    } catch {
      /* ignore */
    }
  } else if (!el) {
    activeBannerDecision = null
  }
  el?.remove()
  if (!document.getElementById(BANNER_ID)) {
    // nettoyage si le decide() n’a pas déjà clear
    if (!asCancel) activeBannerDecision = null
  }
}

export function isBannerOpen(): boolean {
  return !!document.getElementById(BANNER_ID)
}

export function showAlertBanner(
  detections: Detection[],
  onDecision: (decision: UserDecision) => void,
  options: BannerOptions = {}
): void {
  // Remplace un bandeau existant sans double-cancel
  activeBannerDecision = null
  document.getElementById(BANNER_ID)?.remove()
  activeBannerDecision = onDecision

  const msgs = mergeUserMessages(options.userMessages || DEFAULT_USER_MESSAGES)
  const action: DefaultAction = options.defaultAction || "mask_recommend"
  const isBlock = action === "block"
  const isForce = action === "mask_force"
  const source = options.source ?? "prompt"
  const isFile = source === "file"
  const high = detections.filter((d) => d.severity === "high").length
  const medium = detections.filter((d) => d.severity === "medium").length
  const low = detections.filter((d) => d.severity === "low").length

  const summaryParts: string[] = []
  if (high) summaryParts.push(`${high} critique${high > 1 ? "s" : ""}`)
  if (medium) summaryParts.push(`${medium} moyenne${medium > 1 ? "s" : ""}`)
  if (low) summaryParts.push(`${low} faible${low > 1 ? "s" : ""}`)

  const fileLabel =
    options.fileNames && options.fileNames.length
      ? options.fileNames.length === 1
        ? options.fileNames[0]
        : `${options.fileNames.length} fichiers`
      : "fichier(s)"

  let title: string
  let sub: string
  let pill: string
  if (isBlock) {
    title = msgs.blockTitle
    sub = isFile
      ? `${msgs.blockBody} Fichier concerné : « ${escapeHtml(fileLabel)} » (${detections.length} élément${detections.length > 1 ? "s" : ""}).`
      : `${msgs.blockBody} (${detections.length} élément${detections.length > 1 ? "s" : ""} : ${summaryParts.join(", ") || "données sensibles"}).`
    pill = "Bloqué par la politique admin"
  } else if (isForce) {
    title = msgs.maskForceTitle
    sub = isFile
      ? `${msgs.maskForceBody} Fichier : « ${escapeHtml(fileLabel)} ».`
      : `${msgs.maskForceBody} (${summaryParts.join(", ") || detections.length + " détection(s)"}).`
    pill = "Masquage obligatoire · policy"
  } else {
    title = isFile ? msgs.alertTitleFile : msgs.alertTitle
    sub = isFile
      ? `${msgs.alertBodyFile} « ${escapeHtml(fileLabel)} » — ${detections.length} élément${detections.length > 1 ? "s" : ""} (${summaryParts.join(", ")}).`
      : `${msgs.alertBody} ${detections.length} élément${detections.length > 1 ? "s" : ""} (${summaryParts.join(", ")}).`
    pill = isFile ? "Fichier en attente · policy org" : "Alerte sécurité · policy org"
  }

  const orgBit = options.orgName
    ? ` Organisation : ${escapeHtml(options.orgName)}.`
    : ""

  const rewriteLabel = isFile
    ? "Secure Rewrite & joindre"
    : msgs.btnSecureRewrite || "Secure Rewrite & envoyer"
  const maskLabel = isFile
    ? "Masquer simplement & joindre"
    : msgs.btnMask || "Masquer simplement"
  const allowLabel = isFile
    ? "Joindre l’original (journalisé)"
    : msgs.btnSendAnyway
  const cancelLabel = isFile ? "Ne pas joindre" : msgs.btnCancel

  const modeClass = isBlock ? "mode-block" : isForce ? "mode-force" : ""

  const host = document.createElement("div")
  host.id = BANNER_ID
  host.setAttribute("role", "presentation")
  const shadow = host.attachShadow({ mode: "open" })

  const root = document.createElement("div")
  root.className = `wrap ${modeClass}`.trim()
  root.setAttribute("role", "alertdialog")
  root.setAttribute(
    "aria-label",
    isBlock
      ? "OpsGate — envoi non autorisé"
      : "OpsGate — données sensibles détectées"
  )

  // Toujours afficher le bouton (défaut true). Seul contactAdminEnabled: false le masque.
  const contactEnabled = options.contactAdminEnabled !== false
  const contactBtnHtml = contactEnabled
    ? `<button type="button" class="btn-contact" data-action="toggle_contact" title="Envoyer un message à l'administrateur">Contacter l'admin</button>`
    : ""

  // Secure Rewrite = action principale (sauf block)
  const actionsHtml = isBlock
    ? `
      <button type="button" class="btn-primary" data-action="cancel">${escapeHtml(msgs.btnBlockAck)}</button>
      ${contactBtnHtml}
      <button type="button" class="btn-secondary" data-action="toggle_details">Voir les détails</button>
    `
    : isForce
      ? `
      <button type="button" class="btn-accent" data-action="secure_rewrite" title="Anonymisation intelligente">${escapeHtml(rewriteLabel)}</button>
      <button type="button" class="btn-secondary" data-action="mask_send">${escapeHtml(maskLabel)}</button>
      ${contactBtnHtml}
      <button type="button" class="btn-secondary" data-action="toggle_details">Voir les détails</button>
      <button type="button" class="btn-ghost" data-action="cancel">${escapeHtml(cancelLabel)}</button>
    `
      : `
      <button type="button" class="btn-accent" data-action="secure_rewrite" title="Anonymisation intelligente">${escapeHtml(rewriteLabel)}</button>
      <button type="button" class="btn-secondary" data-action="mask_send">${escapeHtml(maskLabel)}</button>
      <button type="button" class="btn-danger" data-action="send_anyway">${escapeHtml(allowLabel)}</button>
      ${contactBtnHtml}
      <button type="button" class="btn-secondary" data-action="toggle_details">Voir les détails</button>
      <button type="button" class="btn-ghost" data-action="cancel">${escapeHtml(cancelLabel)}</button>
    `

  const hostname =
    typeof location !== "undefined" ? location.hostname || "" : ""
  const pageUrl =
    typeof location !== "undefined" ? (location.href || "").slice(0, 500) : ""
  const typeSummary = [
    ...new Set(detections.slice(0, 12).map((d) => d.type).filter(Boolean))
  ].join(", ")
  const prefillSubject = isBlock
    ? `Contestation de blocage · ${hostname || "site IA"}`
    : isForce
      ? `Demande suite à masquage obligatoire · ${hostname || "site IA"}`
      : `Question suite à une alerte · ${hostname || "site IA"}`
  const prefillCategory = isBlock
    ? "block_appeal"
    : isForce
      ? "exception"
      : "question"
  const prefillBody = [
    isBlock
      ? "Bonjour, je conteste ce blocage et demande une exception ou un éclaircissement."
      : "Bonjour, j’ai besoin d’aide concernant cette alerte OpsGate.",
    "",
    `Site : ${hostname}`,
    pageUrl ? `URL : ${pageUrl}` : "",
    typeSummary ? `Détections : ${typeSummary}` : "",
    options.fileNames?.length
      ? `Fichiers : ${options.fileNames.slice(0, 5).join(", ")}`
      : "",
    options.orgName ? `Organisation : ${options.orgName}` : ""
  ]
    .filter(Boolean)
    .join("\n")

  root.innerHTML = `
    <div class="alert-main">
      <div class="header">
        <div class="badge" title="OpsGate">
          <svg viewBox="0 0 32 32" aria-hidden="true">
            <path fill="none" stroke="#2bd9c5" stroke-width="2" stroke-linecap="round"
              d="M8 22V12c0-4 3.5-7 8-7s8 3 8 7v10"/>
            <path fill="#2bd9c5" d="M16 14.5c-1.8 0-3.2 1.3-3.2 3v1.2h6.4V17.5c0-1.7-1.4-3-3.2-3z"/>
            <path fill="none" stroke="#e2e8f0" stroke-width="1.6"
              d="M12.5 18.5h7v4.2c0 1.6-1.6 3-3.5 3s-3.5-1.4-3.5-3v-4.2z"/>
          </svg>
        </div>
        <div>
          <p class="title">${escapeHtml(title)}</p>
          <p class="sub">${sub}</p>
          <span class="pill">${escapeHtml(pill)}</span>
          <p class="admin-notice">${escapeHtml(msgs.adminNotice)}${orgBit}</p>
          <p class="post-contact-note" id="og-post-contact"></p>
          ${
            !isBlock && high > 0
              ? `<p class="warn-line">Éléments critiques détectés — le masquage est recommandé par la politique.</p>`
              : ""
          }
          ${options.note ? `<p class="sub" style="margin-top:6px">${escapeHtml(options.note)}</p>` : ""}
        </div>
      </div>
      <div class="details" id="og-details"></div>
      <div class="actions">${actionsHtml}</div>
    </div>
    ${
      contactEnabled
        ? `
    <div class="contact-panel" id="og-contact" data-category="${escapeHtml(prefillCategory)}">
      <p class="contact-title">Message à l'administrateur</p>
      <p class="contact-hint">Le bandeau d'alerte est masqué le temps de rédiger. Après envoi, les options reviendront.</p>
      <p class="contact-status" id="og-contact-status" hidden></p>
      <label for="og-contact-subject">Objet</label>
      <input id="og-contact-subject" type="text" maxlength="120" value="${escapeHtml(prefillSubject)}" />
      <label for="og-contact-body">Votre message</label>
      <textarea id="og-contact-body" maxlength="4000">${escapeHtml(prefillBody)}</textarea>
      <div class="contact-actions">
        <button type="button" class="btn-accent" data-action="send_contact">Envoyer à l'admin</button>
        <button type="button" class="btn-secondary" data-action="toggle_contact">Retour à l'alerte</button>
      </div>
    </div>`
        : ""
    }
  `

  const style = document.createElement("style")
  style.textContent = SHADOW_CSS
  shadow.appendChild(style)
  shadow.appendChild(root)

  const details = root.querySelector("#og-details") as HTMLElement
  details.innerHTML = detections
    .slice(0, 40)
    .map(
      (d) => `
      <div class="item">
        <span class="sev" style="background:${SEVERITY_COLOR[d.severity] ?? "#64748b"}">${d.severity}</span>
        <div>
          <div class="item-type">${escapeHtml(d.type)}${d.category === "infra" ? " · infra" : ""}</div>
          <div class="item-match">${escapeHtml(d.match)}</div>
        </div>
      </div>`
    )
    .join("")
  if (detections.length > 40) {
    details.innerHTML += `<div class="sub" style="padding:6px 10px">… et ${detections.length - 40} de plus</div>`
  }

  let detailsOpen = false
  let contactOpen = false
  let contactSending = false
  let decided = false

  const contactPanel = root.querySelector("#og-contact") as HTMLElement | null
  const contactStatus = root.querySelector(
    "#og-contact-status"
  ) as HTMLElement | null
  const contactSubject = root.querySelector(
    "#og-contact-subject"
  ) as HTMLInputElement | null
  const contactBody = root.querySelector(
    "#og-contact-body"
  ) as HTMLTextAreaElement | null
  const postContactNote = root.querySelector(
    "#og-post-contact"
  ) as HTMLElement | null

  const setContactStatus = (text: string, kind: "ok" | "err" | null) => {
    if (!contactStatus) return
    if (!text) {
      contactStatus.hidden = true
      contactStatus.textContent = ""
      contactStatus.classList.remove("ok", "err")
      return
    }
    contactStatus.hidden = false
    contactStatus.textContent = text
    contactStatus.classList.remove("ok", "err")
    if (kind) contactStatus.classList.add(kind)
  }

  const setContactOpen = (open: boolean) => {
    contactOpen = open
    // Masque tout le bandeau d’alerte → place libre pour écrire
    root.classList.toggle("contact-mode", open)
    contactPanel?.classList.toggle("open", open)
    if (open) {
      setContactStatus("", null)
      // reset send button if needed
      const sendBtn = root.querySelector(
        'button[data-action="send_contact"]'
      ) as HTMLButtonElement | null
      if (sendBtn) {
        sendBtn.disabled = false
        sendBtn.textContent = "Envoyer à l'admin"
      }
      contactSubject?.focus()
    }
  }

  const restoreAlertAfterContact = (sent: boolean) => {
    setContactOpen(false)
    if (!sent || !postContactNote) return
    postContactNote.classList.add("visible")
    if (isBlock) {
      postContactNote.textContent =
        "Message envoyé à l'administrateur. Cliquez sur « Compris » pour fermer, ou attendez sa réponse (popup)."
    } else if (isForce) {
      postContactNote.textContent =
        "Message envoyé. Choisissez une option ci-dessous pour continuer (masquage obligatoire), ou attendez la réponse admin."
    } else {
      postContactNote.textContent =
        "Message envoyé à l'administrateur. Choisissez une option ci-dessous si vous voulez continuer malgré tout, ou attendez sa réponse."
    }
  }

  const decide = (decision: UserDecision) => {
    if (decided) return
    // En mode block, seul cancel est possible
    if (isBlock && decision !== "cancel") return
    if (isForce && decision === "send_anyway") return
    decided = true
    document.removeEventListener("keydown", onKey, true)
    activeBannerDecision = null
    document.getElementById(BANNER_ID)?.remove()
    try {
      onDecision(decision)
    } catch (err) {
      console.error("[OpsGate] Erreur décision bandeau:", err)
    }
  }

  const sendContact = async () => {
    if (contactSending || !contactSubject || !contactBody) return
    const subject = contactSubject.value.trim()
    const body = contactBody.value.trim()
    if (subject.length < 3) {
      setContactStatus("Objet trop court (min. 3 caractères).", "err")
      return
    }
    if (body.length < 5) {
      setContactStatus("Message trop court (min. 5 caractères).", "err")
      return
    }
    contactSending = true
    const sendBtn = root.querySelector(
      'button[data-action="send_contact"]'
    ) as HTMLButtonElement | null
    if (sendBtn) {
      sendBtn.disabled = true
      sendBtn.textContent = "Envoi…"
    }
    setContactStatus("Envoi en cours…", null)
    try {
      const category =
        (contactPanel?.dataset.category as
          | "question"
          | "exception"
          | "block_appeal"
          | "other"
          | undefined) || "question"
      const r = (await ext.runtime.sendMessage({
        type: "CONTACT_ADMIN",
        subject,
        body,
        category,
        contextUrl: pageUrl || undefined,
        contextHostname: hostname || undefined
      })) as { ok?: boolean; error?: string } | undefined
      if (r?.ok) {
        // Restaure le bandeau d’alerte + options de continuation
        restoreAlertAfterContact(true)
        showToast(
          isBlock
            ? "Message envoyé. Fermez le bandeau ou attendez la réponse admin."
            : "Message envoyé. Choisissez une option pour continuer, ou attendez la réponse admin.",
          { tone: "success", title: "Envoyé à l'admin", durationMs: 4500 }
        )
      } else {
        const err = r?.error || "Échec d’envoi"
        const human =
          err === "not_enrolled"
            ? "Agent non enrôlé — contactez l'admin via la popup OpsGate une fois enrôlé."
            : err === "rate_limited" || err.includes("rate")
              ? "Trop de messages récemment. Réessayez plus tard."
              : err
        setContactStatus(human, "err")
        if (sendBtn) {
          sendBtn.disabled = false
          sendBtn.textContent = "Envoyer à l'admin"
        }
      }
    } catch (e) {
      setContactStatus(String(e), "err")
      if (sendBtn) {
        sendBtn.disabled = false
        sendBtn.textContent = "Envoyer à l'admin"
      }
    } finally {
      contactSending = false
    }
  }

  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === "Escape") {
      ev.preventDefault()
      ev.stopPropagation()
      // Si le formulaire contact est ouvert, revenir à l’alerte
      if (contactOpen) {
        setContactOpen(false)
        return
      }
      decide("cancel")
    }
  }

  root.addEventListener(
    "pointerdown",
    (e) => {
      e.stopPropagation()
    },
    true
  )
  // Laisser taper dans le formulaire sans déclencher le site hôte
  root.addEventListener(
    "keydown",
    (e) => {
      e.stopPropagation()
    },
    true
  )
  root.addEventListener(
    "click",
    (e) => {
      e.stopPropagation()
      e.stopImmediatePropagation()
      const target = (e.target as HTMLElement).closest(
        "button[data-action]"
      ) as HTMLButtonElement | null
      if (!target || !root.contains(target)) return
      e.preventDefault()
      const act = target.dataset.action
      if (!act) return

      if (act === "toggle_details") {
        detailsOpen = !detailsOpen
        details.classList.toggle("open", detailsOpen)
        target.textContent = detailsOpen
          ? "Masquer les détails"
          : "Voir les détails"
        return
      }

      if (act === "toggle_contact") {
        setContactOpen(!contactOpen)
        return
      }

      if (act === "send_contact") {
        void sendContact()
        return
      }

      if (
        act === "secure_rewrite" ||
        act === "mask_send" ||
        act === "send_anyway" ||
        act === "cancel"
      ) {
        decide(act as UserDecision)
      }
    },
    true
  )

  document.addEventListener("keydown", onKey, true)
  document.documentElement.appendChild(host)
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

const ADMIN_REPLY_ID = "opsgate-admin-reply-modal"

export type AdminReplyPopupMessage = {
  id: string
  subject: string
  body?: string
  admin_reply: string
  replied_by_admin_label?: string | null
  replied_at?: string | null
}

export function isAdminReplyModalOpen(): boolean {
  return !!document.getElementById(ADMIN_REPLY_ID)
}

export function removeAdminReplyModal() {
  document.getElementById(ADMIN_REPLY_ID)?.remove()
}

/**
 * Popup bloquant : réponse admin jusqu’à OK (ack) ou Répondre.
 * Reste à l’écran tant que l’utilisateur n’acquitte pas.
 */
export function showAdminReplyModal(
  msg: AdminReplyPopupMessage,
  handlers: {
    onAck: () => void | Promise<void>
    onReply?: (text: string) => void | Promise<void>
  }
): void {
  removeAdminReplyModal()
  // La réponse admin prime sur l’alerte en cours : retire le bandeau
  // et libère pending côté content script (cancel).
  removeBanner(true)

  const host = document.createElement("div")
  host.id = ADMIN_REPLY_ID
  host.setAttribute("role", "presentation")
  const shadow = host.attachShadow({ mode: "open" })

  const style = document.createElement("style")
  style.textContent = `
    :host { all: initial; }
    .backdrop {
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      background: rgba(10, 17, 40, 0.55);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
      font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    }
    .card {
      width: min(520px, 100%);
      max-height: min(90vh, 640px);
      overflow: auto;
      background: #fff;
      border-radius: 14px;
      border: 1px solid #99f6e4;
      box-shadow: 0 20px 50px rgba(15, 23, 42, 0.35);
      color: #0f172a;
    }
    .head {
      display: flex;
      gap: 12px;
      align-items: flex-start;
      padding: 16px 18px 12px;
      background: linear-gradient(180deg, #ecfdf5 0%, #fff 70%);
      border-bottom: 1px solid #e2e8f0;
    }
    .badge {
      flex-shrink: 0;
      width: 36px; height: 36px; border-radius: 10px;
      background: linear-gradient(145deg, #0a1128 0%, #0f766e 100%);
      display: flex; align-items: center; justify-content: center;
      box-shadow: inset 0 0 0 1px rgba(43, 217, 197, 0.4);
    }
    .badge svg { width: 20px; height: 20px; }
    .title { margin: 0; font-size: 16px; font-weight: 750; }
    .sub { margin: 4px 0 0; font-size: 12px; color: #64748b; }
    .body { padding: 14px 18px; }
    .label { font-size: 11px; font-weight: 700; color: #64748b; margin: 0 0 6px; text-transform: uppercase; letter-spacing: 0.03em; }
    .bubble {
      background: #f0fdfa;
      border: 1px solid #99f6e4;
      border-radius: 10px;
      padding: 12px 14px;
      font-size: 14px;
      line-height: 1.5;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .yours {
      margin-top: 12px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 10px 12px;
      font-size: 12px;
      color: #475569;
      white-space: pre-wrap;
      max-height: 100px;
      overflow: auto;
    }
    .reply-box { display: none; margin-top: 12px; }
    .reply-box.open { display: block; }
    .reply-box textarea {
      width: 100%; box-sizing: border-box;
      min-height: 100px; padding: 10px 12px;
      border-radius: 8px; border: 1px solid #cbd5e1;
      font: inherit; font-size: 14px; resize: vertical;
    }
    .status { margin: 8px 0 0; font-size: 12px; font-weight: 650; }
    .status.err { color: #b91c1c; }
    .status.ok { color: #166534; }
    .actions {
      display: flex; flex-wrap: wrap; gap: 8px;
      padding: 12px 18px 16px;
      border-top: 1px solid #f1f5f9;
      background: #f8fafc;
    }
    button {
      appearance: none; border-radius: 8px; padding: 10px 14px;
      font-size: 13px; font-weight: 750; cursor: pointer; font-family: inherit;
    }
    .btn-ok {
      border: 1px solid #0a1128; background: #0a1128; color: #fff;
    }
    .btn-reply {
      border: 1px solid #0f766e; background: #ccfbf1; color: #0f766e;
    }
    .btn-send {
      border: 1px solid #0d9488; background: #2bd9c5; color: #0a1128;
    }
    .btn-cancel {
      border: 1px solid #cbd5e1; background: #fff; color: #334155;
    }
    button:disabled { opacity: 0.55; cursor: not-allowed; }
  `

  const who =
    msg.replied_by_admin_label?.trim() || "Votre administrateur"
  const when = msg.replied_at
    ? String(msg.replied_at).slice(0, 16).replace("T", " ")
    : ""
  const isClosure =
    /clôturée par l'administrateur|cloturee par l'administrateur|closed by/i.test(
      msg.admin_reply || ""
    )
  const titleText = isClosure
    ? "Demande clôturée par l'administrateur"
    : "Réponse de l'administrateur"
  const bodyLabel = isClosure ? "Notification" : "Message de l'admin"

  const card = document.createElement("div")
  card.className = "backdrop"
  card.innerHTML = `
    <div class="card" role="alertdialog" aria-label="${escapeHtml(titleText)}">
      <div class="head">
        <div class="badge" aria-hidden="true">
          <svg viewBox="0 0 32 32"><path fill="none" stroke="#2bd9c5" stroke-width="2" stroke-linecap="round" d="M8 22V12c0-4 3.5-7 8-7s8 3 8 7v10"/><path fill="#2bd9c5" d="M16 14.5c-1.8 0-3.2 1.3-3.2 3v1.2h6.4V17.5c0-1.7-1.4-3-3.2-3z"/><path fill="none" stroke="#e2e8f0" stroke-width="1.6" d="M12.5 18.5h7v4.2c0 1.6-1.6 3-3.5 3s-3.5-1.4-3.5-3v-4.2z"/></svg>
        </div>
        <div>
          <p class="title">${escapeHtml(titleText)}</p>
          <p class="sub">${escapeHtml(who)}${when ? " · " + escapeHtml(when) : ""}</p>
        </div>
      </div>
      <div class="body">
        <p class="label">Objet</p>
        <div style="font-weight:650;font-size:14px;margin-bottom:12px">${escapeHtml(msg.subject)}</div>
        <p class="label">${escapeHtml(bodyLabel)}</p>
        <div class="bubble">${escapeHtml(msg.admin_reply)}</div>
        ${
          msg.body
            ? `<p class="label" style="margin-top:12px">Votre message initial</p><div class="yours">${escapeHtml(msg.body)}</div>`
            : ""
        }
        <div class="reply-box" id="og-ar-reply">
          <p class="label">Votre réponse</p>
          <textarea id="og-ar-text" maxlength="4000" placeholder="Écrire une réponse à l'admin…"></textarea>
          <p class="status" id="og-ar-status" hidden></p>
        </div>
      </div>
      <div class="actions" id="og-ar-actions">
        <button type="button" class="btn-ok" data-act="ack">OK, j'ai compris</button>
        <button type="button" class="btn-reply" data-act="toggle_reply">Répondre</button>
      </div>
    </div>
  `

  shadow.appendChild(style)
  shadow.appendChild(card)

  const replyBox = card.querySelector("#og-ar-reply") as HTMLElement
  const replyText = card.querySelector("#og-ar-text") as HTMLTextAreaElement
  const statusEl = card.querySelector("#og-ar-status") as HTMLElement
  const actions = card.querySelector("#og-ar-actions") as HTMLElement
  let busy = false
  let replyOpen = false

  const setStatus = (t: string, kind?: "ok" | "err") => {
    if (!t) {
      statusEl.hidden = true
      statusEl.textContent = ""
      return
    }
    statusEl.hidden = false
    statusEl.textContent = t
    statusEl.className = "status" + (kind ? " " + kind : "")
  }

  const close = () => {
    host.remove()
  }

  card.addEventListener(
    "click",
    (e) => {
      e.stopPropagation()
      const btn = (e.target as HTMLElement).closest(
        "button[data-act]"
      ) as HTMLButtonElement | null
      if (!btn) return
      e.preventDefault()
      const act = btn.dataset.act
      if (act === "toggle_reply") {
        replyOpen = !replyOpen
        replyBox.classList.toggle("open", replyOpen)
        btn.textContent = replyOpen ? "Masquer la réponse" : "Répondre"
        if (replyOpen) {
          // Ajouter boutons envoyer / annuler reply si absents
          if (!actions.querySelector('[data-act="send_reply"]')) {
            const send = document.createElement("button")
            send.type = "button"
            send.className = "btn-send"
            send.dataset.act = "send_reply"
            send.textContent = "Envoyer la réponse"
            actions.appendChild(send)
          }
          replyText.focus()
        } else {
          actions.querySelector('[data-act="send_reply"]')?.remove()
        }
        return
      }
      if (act === "ack") {
        if (busy) return
        busy = true
        btn.disabled = true
        btn.textContent = "…"
        void Promise.resolve(handlers.onAck())
          .then(() => close())
          .catch((err) => {
            busy = false
            btn.disabled = false
            btn.textContent = "OK, j'ai compris"
            setStatus(String(err), "err")
            replyBox.classList.add("open")
          })
        return
      }
      if (act === "send_reply") {
        if (busy || !handlers.onReply) return
        const text = replyText.value.trim()
        if (text.length < 5) {
          setStatus("Réponse trop courte (min. 5 caractères).", "err")
          return
        }
        busy = true
        btn.disabled = true
        btn.textContent = "Envoi…"
        void Promise.resolve(handlers.onReply(text))
          .then(() =>
            Promise.resolve(handlers.onAck()).then(() => {
              close()
              showToast("Réponse envoyée à l'administrateur", {
                tone: "success",
                title: "Envoyé",
                durationMs: 4000
              })
            })
          )
          .catch((err) => {
            busy = false
            btn.disabled = false
            btn.textContent = "Envoyer la réponse"
            setStatus(String(err), "err")
          })
      }
    },
    true
  )

  // Bloquer Escape sans fermer (force lecture) — seul OK ferme
  card.addEventListener(
    "keydown",
    (e) => {
      e.stopPropagation()
      if ((e as KeyboardEvent).key === "Escape") {
        e.preventDefault()
      }
    },
    true
  )

  document.documentElement.appendChild(host)
}

export type ToastTone = "info" | "success" | "warning" | "danger"

const TOAST_TONES: Record<
  ToastTone,
  { bg: string; border: string; color: string }
> = {
  info: { bg: "#0a1128", border: "#1e293b", color: "#fff" },
  success: { bg: "#0f766e", border: "#0d9488", color: "#f0fdfa" },
  warning: { bg: "#78350f", border: "#b45309", color: "#fffbeb" },
  danger: { bg: "#7f1d1d", border: "#b91c1c", color: "#fef2f2" }
}

export function showToast(
  message: string,
  options: { durationMs?: number; tone?: ToastTone; title?: string } | number = {}
) {
  const opts =
    typeof options === "number"
      ? { durationMs: options, tone: "info" as ToastTone }
      : options
  const durationMs = opts.durationMs ?? 4200
  const tone = opts.tone ?? "info"
  const colors = TOAST_TONES[tone]

  const id = "opsgate-toast"
  document.getElementById(id)?.remove()
  const host = document.createElement("div")
  host.id = id
  const shadow = host.attachShadow({ mode: "open" })
  const el = document.createElement("div")
  el.setAttribute("role", "status")

  if (opts.title) {
    const title = document.createElement("div")
    title.textContent = opts.title
    Object.assign(title.style, {
      fontWeight: "750",
      fontSize: "14px",
      marginBottom: "4px"
    })
    el.appendChild(title)
    const body = document.createElement("div")
    body.textContent = message
    Object.assign(body.style, {
      fontWeight: "500",
      fontSize: "13px",
      lineHeight: "1.4",
      opacity: "0.95"
    })
    el.appendChild(body)
  } else {
    el.textContent = message
  }

  Object.assign(el.style, {
    position: "fixed",
    bottom: "28px",
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: "2147483647",
    background: colors.bg,
    color: colors.color,
    border: `1px solid ${colors.border}`,
    padding: opts.title ? "14px 18px" : "12px 18px",
    borderRadius: "12px",
    fontFamily: "ui-sans-serif, system-ui, sans-serif",
    fontSize: "13px",
    fontWeight: "600",
    boxShadow: "0 12px 32px rgba(15,23,42,0.35)",
    maxWidth: "min(480px, calc(100vw - 28px))",
    textAlign: "left",
    lineHeight: "1.35"
  } as CSSStyleDeclaration)

  shadow.appendChild(el)
  document.documentElement.appendChild(host)
  setTimeout(() => host.remove(), durationMs)
}

/** Helper toasts depuis messages policy */
export function toastFromDecision(
  decision: UserDecision | "blocked",
  msgs?: Partial<PolicyUserMessages>
) {
  const m = mergeUserMessages(msgs)
  if (decision === "blocked" || decision === "cancel") {
    // cancel after block uses blocked message when mode block
  }
  switch (decision) {
    case "cancel":
      showToast(m.toastCancel, { tone: "info", title: "Politique OpsGate" })
      break
    case "mask_send":
      showToast(m.toastMask, { tone: "success", title: "Politique OpsGate" })
      break
    case "secure_rewrite":
      showToast(m.toastSecureRewrite || m.toastMask, {
        tone: "success",
        title: "Secure Rewrite"
      })
      break
    case "send_anyway":
      showToast(m.toastSendAnyway, {
        tone: "warning",
        title: "Action journalisée"
      })
      break
    case "blocked":
      showToast(m.toastBlocked, {
        tone: "danger",
        title: "Non autorisé par l’admin"
      })
      break
  }
}
