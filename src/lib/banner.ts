import type { Detection } from "@opsgate/engine"

import type {
  DefaultAction,
  DetectionSource,
  PolicyUserMessages,
  UserDecision
} from "../types"
import { DEFAULT_USER_MESSAGES, mergeUserMessages } from "../types"

const BANNER_ID = "opsgate-alert-banner"

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
    z-index: 2147483647;
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
`

export function removeBanner() {
  document.getElementById(BANNER_ID)?.remove()
}

export function isBannerOpen(): boolean {
  return !!document.getElementById(BANNER_ID)
}

export function showAlertBanner(
  detections: Detection[],
  onDecision: (decision: UserDecision) => void,
  options: BannerOptions = {}
): void {
  removeBanner()

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

  const primaryLabel = isFile
    ? msgs.btnMask.replace("Envoyer", "joindre")
    : msgs.btnMask
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

  const actionsHtml = isBlock
    ? `
      <button type="button" class="btn-primary" data-action="cancel">${escapeHtml(msgs.btnBlockAck)}</button>
      <button type="button" class="btn-secondary" data-action="toggle_details">Voir les détails</button>
    `
    : isForce
      ? `
      <button type="button" class="btn-accent" data-action="mask_send">${escapeHtml(primaryLabel)}</button>
      <button type="button" class="btn-secondary" data-action="toggle_details">Voir les détails</button>
      <button type="button" class="btn-ghost" data-action="cancel">${escapeHtml(cancelLabel)}</button>
    `
      : `
      <button type="button" class="btn-accent" data-action="mask_send">${escapeHtml(primaryLabel)}</button>
      <button type="button" class="btn-danger" data-action="send_anyway">${escapeHtml(allowLabel)}</button>
      <button type="button" class="btn-secondary" data-action="toggle_details">Voir les détails</button>
      <button type="button" class="btn-ghost" data-action="cancel">${escapeHtml(cancelLabel)}</button>
    `

  root.innerHTML = `
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
  let decided = false

  const decide = (decision: UserDecision) => {
    if (decided) return
    // En mode block, seul cancel est possible
    if (isBlock && decision !== "cancel") return
    if (isForce && decision === "send_anyway") return
    decided = true
    document.removeEventListener("keydown", onKey, true)
    removeBanner()
    try {
      onDecision(decision)
    } catch (err) {
      console.error("[OpsGate] Erreur décision bandeau:", err)
    }
  }

  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === "Escape") {
      ev.preventDefault()
      ev.stopPropagation()
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
        target.textContent = detailsOpen ? "Masquer les détails" : "Voir les détails"
        return
      }

      if (act === "mask_send" || act === "send_anyway" || act === "cancel") {
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
