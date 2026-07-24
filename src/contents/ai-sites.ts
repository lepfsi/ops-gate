import type { PlasmoCSConfig } from "plasmo"
import type { DetectionRule } from "@opsgate/engine"

import { initRulesMemoryListener } from "~lib/agent-store"
import {
  isAdminReplyModalOpen,
  isBannerOpen,
  removeBanner,
  showAdminReplyModal,
  showAlertBanner,
  showToast,
  toastFromDecision
} from "~lib/banner"
import { ext, sendMessageWithRetry } from "~lib/browser-api"
import { mergeMessagesForLang, resolveAgentLang } from "~lib/i18n-agent"
import {
  detectTextSync,
  ensureRulesWarm,
  maskText,
  promptRiskOf,
  secureRewriteText
} from "~lib/detect"
import {
  buildMaskedFileList,
  mergeDetections,
  scanFiles,
  type FileScanResult
} from "~lib/file-scanner"
import { buildJournalPayload } from "~lib/storage"
import type {
  Detection,
  DetectionSource,
  OpsGateSettings,
  UserDecision
} from "~types"
import { DEFAULT_SETTINGS } from "~types"

// Pack règles org en mémoire (sync local_only si pas enrollé)
initRulesMemoryListener()
void ensureRulesWarm()

/**
 * Sites où le content script est injecté (figé au build / package store).
 * La Policy (enabledHosts) active ou non la protection parmi ces hosts.
 * Un domaine 100 % nouveau hors liste → rebuild extension (ou entrée produit).
 * Voir isExtensionEnabledHere().
 */
export const config: PlasmoCSConfig = {
  matches: [
    "https://chatgpt.com/*",
    "https://chat.openai.com/*",
    "https://claude.ai/*",
    "https://gemini.google.com/*",
    "https://bard.google.com/*",
    "https://copilot.microsoft.com/*",
    "https://www.bing.com/chat*",
    "https://perplexity.ai/*",
    "https://www.perplexity.ai/*",
    "https://*.perplexity.ai/*",
    "https://chat.deepseek.com/*",
    "https://www.deepseek.com/*",
    "https://deepseek.com/*",
    "https://*.deepseek.com/*",
    "https://aistudio.google.com/*",
    "https://poe.com/*",
    "https://www.poe.com/*",
    "https://you.com/*",
    "https://www.you.com/*",
    "https://chat.mistral.ai/*",
    "https://lechat.mistral.ai/*",
    "https://console.groq.com/*",
    "https://grok.x.ai/*",
    "https://grok.com/*",
    "https://www.grok.com/*",
    "https://huggingface.co/chat/*",
    "https://www.phind.com/*",
    "https://phind.com/*",
    "https://www.meta.ai/*",
    "https://meta.ai/*",
    "https://pi.ai/*",
    "https://character.ai/*",
    "https://www.character.ai/*",
    "https://notebooklm.google.com/*",
    "https://labs.google/*",
    "https://openrouter.ai/*",
    "https://together.ai/*",
    "https://fireworks.ai/*",
    "https://www.blackbox.ai/*",
    "https://blackbox.ai/*",
    "https://chat.lmsys.org/*",
    "https://lmarena.ai/*",
    "https://www.typingmind.com/*",
    "https://typingmind.com/*",
    "https://chat.qwen.ai/*",
    "https://writesonic.com/*",
    "https://www.jasper.ai/*",
    "https://jasper.ai/*",
    "https://www.copy.ai/*",
    "https://copy.ai/*",
    "https://www.notion.so/*",
    "https://notion.so/*",
    "https://platform.openai.com/*",
    "https://deepai.org/*",
    "https://sider.ai/*",
    "https://monica.im/*",
    "https://www.chatpdf.com/*",
    "https://chatpdf.com/*",
    "https://consensus.app/*",
    "https://elicit.com/*"
  ],
  run_at: "document_idle"
}

/** Skip la prochaine interception (après décision utilisateur) */
let bypassOnce = false
/** En attente de décision */
let pending = false

/** Settings en cache synchrone - ne jamais await avant preventDefault */
let settings: OpsGateSettings = { ...DEFAULT_SETTINGS }

async function refreshSettings() {
  try {
    const res = (await ext.runtime.sendMessage({ type: "GET_SETTINGS" })) as {
      ok?: boolean
      settings?: OpsGateSettings
    }
    if (res?.settings) {
      settings = res.settings
    }
  } catch {
    // background pas prêt → garder defaults
  }
}

void refreshSettings()
setInterval(() => void refreshSettings(), 8000)
ext.storage?.onChanged?.addListener((changes, area) => {
  if (area === "local" && changes.opsGateSettings?.newValue) {
    settings = { ...DEFAULT_SETTINGS, ...changes.opsGateSettings.newValue }
  }
  if (area === "local" && changes.opsGatePendingAdminReplies) {
    void maybeShowPendingAdminReply()
  }
})

/** Popup bloquant : réponses admin non acquittées */
async function maybeShowPendingAdminReply() {
  if (isAdminReplyModalOpen()) return
  try {
    // Préférer le cache background (rapide)
    const stored = await ext.storage.local.get("opsGatePendingAdminReplies")
    let list = (stored.opsGatePendingAdminReplies || []) as Array<{
      id: string
      subject: string
      body?: string
      admin_reply?: string | null
      replied_by_admin_label?: string | null
      replied_at?: string | null
    }>
    if (!list.length) {
      const r = (await ext.runtime.sendMessage({
        type: "LIST_PENDING_ADMIN_REPLIES"
      })) as {
        ok?: boolean
        messages?: typeof list
      }
      if (r?.ok && r.messages?.length) list = r.messages
    }
    const first = list.find((m) => m.admin_reply && m.admin_reply.trim())
    if (!first?.admin_reply) return

    showAdminReplyModal(
      {
        id: first.id,
        subject: first.subject,
        body: first.body,
        admin_reply: first.admin_reply,
        replied_by_admin_label: first.replied_by_admin_label,
        replied_at: first.replied_at
      },
      {
        onAck: async () => {
          const ack = (await ext.runtime.sendMessage({
            type: "ACK_ADMIN_REPLY",
            messageId: first.id
          })) as { ok?: boolean; error?: string }
          if (!ack?.ok) throw new Error(ack?.error || "Échec acquittement")
          // Enchaîner sur le message suivant s’il y en a
          setTimeout(() => void maybeShowPendingAdminReply(), 400)
        },
        onReply: async (text) => {
          const send = (await ext.runtime.sendMessage({
            type: "CONTACT_ADMIN",
            subject: first.subject.startsWith("Re:")
              ? first.subject
              : `Re: ${first.subject}`,
            body: text,
            category: "question"
          })) as { ok?: boolean; error?: string }
          if (!send?.ok) throw new Error(send?.error || "Échec envoi")
        }
      }
    )
  } catch (e) {
    console.warn("[OpsGate] pending admin reply:", e)
  }
}

void maybeShowPendingAdminReply()
setInterval(() => void maybeShowPendingAdminReply(), 20_000)

/**
 * Journal local + report cloud via service worker.
 * Await + retries : le fire-and-forget MV3 perdait send_anyway / mask / rewrite
 * (SW endormi ou tué avant le POST /v1/events/batch).
 */
async function logDecision(
  decision: UserDecision,
  detections: Detection[],
  masked: boolean,
  source: DetectionSource = "prompt",
  fileNames?: string[]
): Promise<boolean> {
  const entry = buildJournalPayload(
    location.href,
    decision,
    detections,
    masked,
    source,
    fileNames
  )
  try {
    const r = await sendMessageWithRetry<{ ok?: boolean; error?: string }>(
      { type: "LOG_DETECTION", entry },
      3,
      140
    )
    if (r?.ok) {
      console.log("[OpsGate] decision logged", decision)
      return true
    }
    console.warn("[OpsGate] LOG_DETECTION not ok", decision, r)
    return false
  } catch (e) {
    console.error("[OpsGate] LOG_DETECTION failed", decision, e)
    return false
  }
}

/** Normalise un host policy (accepte domaine nu ou URL). */
function normalizePolicyHost(raw: string): string {
  let p = (raw || "").trim().toLowerCase()
  if (!p) return ""
  p = p.replace(/^https?:\/\//, "")
  p = p.split("/")[0] || ""
  p = p.replace(/^www\./, "")
  // drop port
  p = p.replace(/:\d+$/, "")
  return p
}

/** Hostname page matche un entry policy (exact ou sous-domaine). */
function hostInPolicyList(
  hostname: string,
  hosts: string[] | undefined
): boolean {
  const h = normalizePolicyHost(hostname)
  if (!h || !hosts?.length) return false
  return hosts.some((raw) => {
    const p = normalizePolicyHost(raw)
    if (!p) return false
    return h === p || h.endsWith("." + p)
  })
}

/**
 * Protection active ici ?
 * Source de vérité = Policy enabledHosts (sync org), pas la liste hardcodée.
 */
function isExtensionEnabledHere(): boolean {
  if (!settings.enabled) return false
  // Unlicensed après grace : protection désactivée
  if (settings.licenseStatus === "unlicensed") return false
  if (settings.securityActive === false) return false
  return hostInPolicyList(location.hostname, settings.enabledHosts)
}

/** Flag pour ignorer le prochain change sur un input file (après décision) */
let bypassFileOnce = false
let filePending = false

/** Élément visible (évite les ghost nodes SPA). */
function isVisibleEl(el: HTMLElement): boolean {
  if (el.offsetParent === null && el.getClientRects().length === 0) return false
  const st = window.getComputedStyle(el)
  if (st.display === "none" || st.visibility === "hidden" || st.opacity === "0")
    return false
  return true
}

function readEditableText(el: HTMLElement): string {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    return (el.value || "").trim()
  }
  return (el.innerText || el.textContent || "").trim()
}

/**
 * Composeurs multi-IA (ChatGPT, Claude, Gemini, DeepSeek, Perplexity, …).
 * Priorise les champs en bas de viewport (zone de saisie typique).
 */
function findComposerElements(): HTMLElement[] {
  const sels = [
    "#prompt-textarea",
    '[data-testid="prompt-textarea"]',
    "rich-textarea div[contenteditable='true']",
    "rich-textarea",
    'div[contenteditable="true"].ProseMirror',
    'div[contenteditable="true"]',
    '[role="textbox"]',
    "textarea",
    'div[class*="input" i][contenteditable="true"]',
    'div[class*="editor" i][contenteditable="true"]',
    'div[class*="composer" i] [contenteditable="true"]',
    'div[class*="prompt" i] [contenteditable="true"]'
  ]
  const seen = new Set<HTMLElement>()
  const out: HTMLElement[] = []
  for (const s of sels) {
    try {
      document.querySelectorAll<HTMLElement>(s).forEach((el) => {
        if (seen.has(el) || !isVisibleEl(el)) return
        // Skip OpsGate UI
        if (el.closest("#opsgate-alert-banner, #opsgate-admin-reply")) return
        seen.add(el)
        out.push(el)
      })
    } catch {
      /* selector invalide */
    }
  }
  // Bas de page d’abord (composer chat)
  out.sort(
    (a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top
  )
  return out
}

function getPromptText(fromEl?: Element | null): string {
  const host = location.hostname

  // ── Host-specific (prioritaire) ──
  const hostCandidates: HTMLElement[] = []
  if (host.includes("chatgpt.com") || host.includes("chat.openai.com")) {
    hostCandidates.push(
      ...([
        document.querySelector<HTMLElement>("#prompt-textarea"),
        document.querySelector<HTMLElement>('[data-testid="prompt-textarea"]'),
        document.querySelector<HTMLElement>(
          '#prompt-textarea [contenteditable="true"]'
        ),
        document.querySelector<HTMLElement>(
          'div[contenteditable="true"].ProseMirror'
        ),
        document.querySelector<HTMLElement>('form [contenteditable="true"]')
      ].filter(Boolean) as HTMLElement[])
    )
  } else if (host.includes("claude.ai")) {
    hostCandidates.push(
      ...([
        document.querySelector<HTMLElement>(
          'div[contenteditable="true"].ProseMirror'
        ),
        document.querySelector<HTMLElement>(
          'fieldset div[contenteditable="true"]'
        )
      ].filter(Boolean) as HTMLElement[])
    )
  } else if (host.includes("gemini.google.com") || host.includes("bard.google")) {
    hostCandidates.push(
      ...([
        document.querySelector<HTMLElement>(
          "rich-textarea div[contenteditable='true']"
        ),
        document.querySelector<HTMLElement>(
          'div[contenteditable="true"][aria-label]'
        )
      ].filter(Boolean) as HTMLElement[])
    )
  } else if (host.includes("deepseek")) {
    // DeepSeek : souvent <textarea> ou contenteditable bas de page
    hostCandidates.push(
      ...([
        document.querySelector<HTMLElement>(
          'textarea[class*="chat" i], textarea[placeholder], textarea'
        ),
        document.querySelector<HTMLElement>(
          'div[contenteditable="true"][class*="input" i]'
        ),
        document.querySelector<HTMLElement>('div[contenteditable="true"]')
      ].filter(Boolean) as HTMLElement[])
    )
  } else if (host.includes("perplexity")) {
    hostCandidates.push(
      ...([
        document.querySelector<HTMLElement>(
          'div[contenteditable="true"][role="textbox"]'
        ),
        document.querySelector<HTMLElement>(
          'div[contenteditable="true"][data-lexical-editor]'
        ),
        document.querySelector<HTMLElement>('div[contenteditable="true"]'),
        document.querySelector<HTMLElement>("textarea")
      ].filter(Boolean) as HTMLElement[])
    )
  } else if (host.includes("mistral") || host.includes("lechat")) {
    hostCandidates.push(
      ...([
        document.querySelector<HTMLElement>(
          'div[contenteditable="true"].ProseMirror'
        ),
        document.querySelector<HTMLElement>("textarea"),
        document.querySelector<HTMLElement>('div[contenteditable="true"]')
      ].filter(Boolean) as HTMLElement[])
    )
  } else if (
    host.includes("copilot.microsoft") ||
    host.includes("bing.com")
  ) {
    hostCandidates.push(
      ...([
        document.querySelector<HTMLElement>(
          '#searchbox, textarea[aria-label], textarea'
        ),
        document.querySelector<HTMLElement>('div[contenteditable="true"]')
      ].filter(Boolean) as HTMLElement[])
    )
  } else if (host.includes("grok")) {
    hostCandidates.push(
      ...([
        document.querySelector<HTMLElement>("textarea"),
        document.querySelector<HTMLElement>('div[contenteditable="true"]')
      ].filter(Boolean) as HTMLElement[])
    )
  }

  for (const ta of hostCandidates) {
    if (!isVisibleEl(ta)) continue
    const t = readEditableText(ta)
    if (t.length >= 3) return t
  }

  if (fromEl) {
    const editable = fromEl.closest(
      '[contenteditable="true"], textarea, [role="textbox"], input[type="text"]'
    ) as HTMLElement | null
    if (editable) {
      const t = readEditableText(editable)
      if (t.length >= 3) return t
    }
  }

  const active = document.activeElement as HTMLElement | null
  if (active) {
    if (
      active instanceof HTMLTextAreaElement ||
      active instanceof HTMLInputElement
    ) {
      const t = (active.value || "").trim()
      if (t.length >= 3) return t
    }
    if (active.isContentEditable || active.getAttribute("role") === "textbox") {
      const t = (active.innerText || active.textContent || "").trim()
      if (t.length >= 3) return t
    }
  }

  // Multi-IA : bas de page (composer)
  for (const el of findComposerElements()) {
    const t = readEditableText(el)
    if (t.length >= 3) return t
  }

  return ""
}

function setPromptText(text: string): boolean {
  const host = location.hostname
  const candidates: HTMLElement[] = []

  if (host.includes("chatgpt.com") || host.includes("chat.openai.com")) {
    const el =
      document.querySelector<HTMLElement>("#prompt-textarea") ||
      document.querySelector<HTMLElement>('[data-testid="prompt-textarea"]') ||
      document.querySelector<HTMLElement>(
        'div[contenteditable="true"].ProseMirror'
      )
    if (el) candidates.push(el)
  } else if (host.includes("claude.ai")) {
    const el =
      document.querySelector<HTMLElement>(
        'div[contenteditable="true"].ProseMirror'
      ) || document.querySelector<HTMLElement>('div[contenteditable="true"]')
    if (el) candidates.push(el)
  } else if (host.includes("gemini.google.com") || host.includes("bard.google")) {
    const el =
      document.querySelector<HTMLElement>(
        "rich-textarea div[contenteditable='true']"
      ) || document.querySelector<HTMLElement>('div[contenteditable="true"]')
    if (el) candidates.push(el)
  } else if (host.includes("deepseek") || host.includes("perplexity")) {
    const el =
      document.querySelector<HTMLElement>("textarea") ||
      document.querySelector<HTMLElement>(
        'div[contenteditable="true"][role="textbox"]'
      ) ||
      document.querySelector<HTMLElement>('div[contenteditable="true"]')
    if (el) candidates.push(el)
  }

  const active = document.activeElement as HTMLElement | null
  if (
    active &&
    (active.isContentEditable ||
      active instanceof HTMLTextAreaElement ||
      active.getAttribute("role") === "textbox")
  ) {
    candidates.unshift(active)
  }

  // Fallback multi-IA
  for (const el of findComposerElements()) {
    if (!candidates.includes(el)) candidates.push(el)
  }

  const target = candidates[0]
  if (!target) return false

  if (
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLInputElement
  ) {
    const proto =
      target instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype
    const desc = Object.getOwnPropertyDescriptor(proto, "value")
    desc?.set?.call(target, text)
    target.dispatchEvent(new Event("input", { bubbles: true }))
    target.dispatchEvent(new Event("change", { bubbles: true }))
    return true
  }

  target.focus()
  try {
    const sel = window.getSelection()
    const range = document.createRange()
    range.selectNodeContents(target)
    sel?.removeAllRanges()
    sel?.addRange(range)
    const ok = document.execCommand("insertText", false, text)
    if (!ok) {
      target.innerText = text
      target.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          inputType: "insertText",
          data: text
        })
      )
    }
  } catch {
    target.innerText = text
    target.dispatchEvent(new Event("input", { bubbles: true }))
  }
  return true
}

function isSendButton(el: Element | null): boolean {
  if (!el) return false
  // Ne jamais traiter les contrôles OpsGate comme un envoi IA
  if (
    el.closest(
      "#opsgate-alert-banner, #opsgate-toast, #opsgate-active-badge, #opsgate-admin-reply"
    )
  ) {
    return false
  }
  const btn = el.closest(
    "button, [role='button'], div[role='button'], a[role='button'], input[type='submit']"
  ) as HTMLElement | null
  if (!btn) return false
  if ((btn as HTMLButtonElement).disabled) return false

  const aria = (btn.getAttribute("aria-label") || "").toLowerCase()
  const testId = (btn.getAttribute("data-testid") || "").toLowerCase()
  const title = (btn.getAttribute("title") || "").toLowerCase()
  const dataAction = (btn.getAttribute("data-action") || "").toLowerCase()
  // innerText brut pour CJK (pas lowercased de façon fiable)
  const textRaw = (btn.innerText || btn.textContent || "").trim()
  const text = textRaw.toLowerCase()
  const combined = `${aria} ${testId} ${title} ${dataAction} ${text} ${textRaw}`

  // Exclusions explicites (sauf si « send » est aussi présent)
  if (
    /attach|upload|micro|voice|photo|speech|stop|dictat|file|image|plus|menu|settings|model|sidebar|search|regenerate|copy|share|like|dislike|thumb|new chat|nouveau/i.test(
      combined
    ) &&
    !/send|envoyer|submit|发送|提交|送出/i.test(combined)
  ) {
    return false
  }

  // Patterns multi-langue (EN / FR / ZH — DeepSeek)
  if (
    testId.includes("send") ||
    aria.includes("send") ||
    title.includes("send") ||
    dataAction.includes("send") ||
    /send[-_ ]?(prompt|message|query)?/i.test(combined) ||
    /envoyer|soumettre/i.test(combined) ||
    /发送|提交|送出/.test(textRaw) ||
    aria.includes("envoyer") ||
    title.includes("envoyer") ||
    aria.includes("send message") ||
    aria.includes("envoyer le message") ||
    aria.includes("submit") ||
    title.includes("submit")
  ) {
    return true
  }
  if (testId === "send-button" || testId === "composer-send-button") return true

  // Bouton submit dans un form de composer
  if (
    (btn.getAttribute("type") === "submit" || aria.includes("submit")) &&
    (btn.closest("form") || isNearComposer(btn))
  ) {
    return true
  }

  // Icône seule près du composer (ChatGPT / Claude / DeepSeek / Perplexity)
  if (btn.querySelector("svg") && isNearComposer(btn) && textRaw.length <= 6) {
    const form = btn.closest("form")
    if (form) {
      const buttons = Array.from(
        form.querySelectorAll("button, [role='button']")
      ).filter((b) => !(b as HTMLButtonElement).disabled)
      if (buttons[buttons.length - 1] === btn) return true
    }
    // Conteneur du composer le plus bas
    const composers = findComposerElements()
    for (const prompt of composers.slice(0, 3)) {
      const box =
        prompt.closest("form") ||
        prompt.parentElement?.parentElement ||
        prompt.parentElement
      if (box?.contains(btn)) return true
      // Bouton à droite / sous le champ (proximité)
      const br = btn.getBoundingClientRect()
      const cr = prompt.getBoundingClientRect()
      if (
        Math.abs(br.bottom - cr.bottom) < 100 &&
        br.left >= cr.left - 40 &&
        br.top >= cr.top - 80
      ) {
        return true
      }
    }
  }

  return false
}

function isNearComposer(el: Element): boolean {
  if (
    el.closest(
      'form, [class*="composer" i], [class*="prompt" i], [class*="input" i], [class*="editor" i], [class*="chat-input" i], [class*="query" i], [class*="ask" i], [class*="searchbox" i], [class*="bottom" i]'
    )
  ) {
    return true
  }
  const prompt =
    document.querySelector("#prompt-textarea") ||
    document.querySelector('[data-testid="prompt-textarea"]')
  if (
    prompt &&
    (prompt.contains(el) ||
      prompt.parentElement?.contains(el) ||
      prompt.closest("form")?.contains(el))
  ) {
    return true
  }
  for (const c of findComposerElements().slice(0, 6)) {
    if (c.contains(el) || c.parentElement?.contains(el)) return true
    const box =
      c.closest("form") || c.parentElement?.parentElement || c.parentElement
    if (box?.contains(el)) return true
    const br = (el as HTMLElement).getBoundingClientRect?.()
    const cr = c.getBoundingClientRect()
    if (
      br &&
      Math.abs(br.bottom - cr.bottom) < 140 &&
      Math.abs(br.left - cr.right) < 280
    ) {
      return true
    }
  }
  return false
}

function isInComposer(el: Element | null): boolean {
  if (!el) return false
  if (
    el.closest("#prompt-textarea") ||
    el.closest('[data-testid="prompt-textarea"]') ||
    el.closest('[contenteditable="true"]') ||
    el.closest('[role="textbox"]') ||
    el.closest("textarea") ||
    el.closest("form") ||
    el.closest("rich-textarea")
  ) {
    return true
  }
  // DeepSeek / Perplexity : input bas de page
  return isNearComposer(el)
}

/**
 * CRITIQUE : 100 % synchrone jusqu'à preventDefault.
 * Un await avant preventDefault laisse l'événement se terminer → l'envoi part.
 */
function handlePotentialSend(event: Event, sourceEl?: Element | null): void {
  if (bypassOnce) {
    bypassOnce = false
    return
  }
  if (pending || isBannerOpen()) {
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    return
  }

  if (!settings.enabled) return

  if (!isExtensionEnabledHere()) {
    // Pas de log bruyant : script injecté partout, policy décide
    return
  }
  const host = location.hostname

  const text = getPromptText(sourceEl)
  if (!text || text.length < 5) {
    if (text) {
      console.log(
        "[OpsGate] Intercept: texte trop court pour scan (",
        text.length,
        "car.)"
      )
    } else {
      console.log(
        "[OpsGate] Intercept: prompt vide sur",
        host,
        "— composer non lu (UI SPA ?)"
      )
    }
    return
  }

  const { detections, rules } = detectTextSync(text)
  if (detections.length === 0) {
    // Aide debug : l’envoi part car aucune règle n’a matché
    console.log(
      "[OpsGate] Intercept: aucune détection sur",
      text.length,
      "car. - envoi autorisé. Exemple qui marche: password: SuperSecret!99  ou  sk_live_51N8… (12+ car.)"
    )
    return
  }

  // Bloquer IMMÉDIATEMENT
  event.preventDefault()
  event.stopPropagation()
  event.stopImmediatePropagation()
  pending = true

  const pr = promptRiskOf(detections)
  console.log(
    "[OpsGate] Envoi bloqué -",
    detections.length,
    "détection(s):",
    detections.map((d) => d.type).join(", "),
    `risk=${pr.score}/${pr.level}`,
    settings.rulesPackVersion ? `pack=${settings.rulesPackVersion}` : "pack=embedded"
  )

  const action = settings.defaultAction || "mask_recommend"
  const agentLang = resolveAgentLang(settings.agentUiLang)
  const msgs = mergeMessagesForLang(agentLang, settings.userMessages)

  // Toujours proposer le contact admin sur le bandeau (l’API gère non-enrôlé).
  showAlertBanner(
    detections,
    (decision, meta) => {
      pending = false
      // Async : journaliser AVANT retriggerSend (sinon event perdu en course)
      void (async () => {
        try {
          if (action === "block" || decision === "cancel") {
            await logDecision("cancel", detections, false, "prompt")
            toastFromDecision(action === "block" ? "blocked" : "cancel", msgs)
            return
          }

          if (decision === "secure_rewrite") {
            const fromPreview = meta?.rewrittenText?.trim()
            const rw = fromPreview
              ? {
                  rewrittenText: fromPreview,
                  stats: { totalReplacements: meta?.replacementsCount ?? 0 },
                  originalRiskScore: meta?.originalRiskScore ?? 0,
                  remainingRiskScore: meta?.remainingRiskScore ?? 0
                }
              : secureRewriteText(text, detections, {
                  consistentMapping: true,
                  aggressiveness: 2
                })
            setPromptText(rw.rewrittenText)
            await logDecision("secure_rewrite", detections, true, "prompt")
            toastFromDecision("secure_rewrite", msgs)
            console.log(
              "[OpsGate] Secure Rewrite",
              rw.stats.totalReplacements,
              "remplacements · risque",
              rw.originalRiskScore,
              "→",
              rw.remainingRiskScore,
              fromPreview ? "(preview)" : ""
            )
            bypassOnce = true
            setTimeout(() => retriggerSend(sourceEl), 120)
            return
          }

          if (decision === "mask_send") {
            const masked = maskText(text, detections, rules)
            setPromptText(masked)
            await logDecision("mask_send", detections, true, "prompt")
            toastFromDecision("mask_send", msgs)
            bypassOnce = true
            setTimeout(() => retriggerSend(sourceEl), 120)
            return
          }

          // send_anyway - interdit en mask_force (banner le filtre déjà)
          if (action === "mask_force") {
            toastFromDecision("blocked", msgs)
            return
          }

          await logDecision("send_anyway", detections, false, "prompt")
          toastFromDecision("send_anyway", msgs)
          bypassOnce = true
          setTimeout(() => retriggerSend(sourceEl), 60)
        } catch (err) {
          console.error("[OpsGate] Décision prompt:", err)
          // Ne pas bloquer l’utilisateur si le journal échoue
          if (
            decision === "send_anyway" ||
            decision === "mask_send" ||
            decision === "secure_rewrite"
          ) {
            bypassOnce = true
            setTimeout(() => retriggerSend(sourceEl), 80)
          }
        }
      })()
    },
    {
      source: "prompt",
      sourceText: text,
      defaultAction: action,
      userMessages: settings.userMessages,
      agentUiLang: settings.agentUiLang,
      orgName: settings.orgName,
      contactAdminEnabled: true
    }
  )
}

// ---------- Uploads de fichiers ----------

/** Collecte récursive des input[type=file] (light DOM + open shadow roots) */
function collectFileInputs(root: Document | ShadowRoot | Element): HTMLInputElement[] {
  const out: HTMLInputElement[] = []
  const walk = (node: Document | ShadowRoot | Element) => {
    const list =
      "querySelectorAll" in node
        ? node.querySelectorAll<HTMLInputElement>('input[type="file"]')
        : []
    list.forEach((el) => out.push(el))
    const all =
      "querySelectorAll" in node ? node.querySelectorAll<HTMLElement>("*") : []
    all.forEach((el) => {
      if (el.shadowRoot) walk(el.shadowRoot)
    })
  }
  walk(root)
  return out
}

/** Inputs file encore présents dans le DOM (les SPA recyclent souvent les nœuds) */
function findLiveFileInputs(preferred?: HTMLInputElement | null): HTMLInputElement[] {
  const all = collectFileInputs(document)
  // Dédupliquer
  const uniq = Array.from(new Set(all)).filter((i) => i.isConnected)
  if (preferred?.isConnected) {
    return [preferred, ...uniq.filter((i) => i !== preferred)]
  }
  return uniq
}

function clearFileInput(input: HTMLInputElement) {
  try {
    bypassFileOnce = true
    input.value = ""
    // Ne PAS forcément dispatcher change ici — certains SPA vident le composer
  } catch {
    // ignore
  }
}

function clearAllFileInputs(preferred?: HTMLInputElement | null) {
  for (const input of findLiveFileInputs(preferred)) {
    clearFileInput(input)
  }
}

/**
 * Injecte des fichiers dans UN input (React/SPA).
 * Ne pas clear+dispatch change avant assign (casse ChatGPT/Claude).
 */
function injectFilesIntoInput(input: HTMLInputElement, files: File[]): boolean {
  if (!files.length) return false
  try {
    const dt = new DataTransfer()
    for (const f of files) {
      // Re-wrap File (certains SPA rejettent des File « gelés » hors d’un picker)
      try {
        dt.items.add(
          new File([f], f.name, {
            type: f.type || "application/octet-stream",
            lastModified: f.lastModified || Date.now()
          })
        )
      } catch {
        dt.items.add(f)
      }
    }

    bypassFileOnce = true
    let assigned = false
    try {
      input.files = dt.files
      assigned = !!(input.files && input.files.length > 0)
    } catch {
      assigned = false
    }
    if (!assigned) {
      try {
        Object.defineProperty(input, "files", {
          configurable: true,
          get: () => dt.files
        })
        assigned = true
      } catch {
        return false
      }
    }

    // Débloquer l’acceptation SPA
    try {
      input.dispatchEvent(
        new Event("focus", { bubbles: true, composed: true })
      )
    } catch {
      /* ignore */
    }
    bypassFileOnce = true
    input.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        composed: true,
        inputType: "insertFromPaste"
      })
    )
    bypassFileOnce = true
    input.dispatchEvent(new Event("change", { bubbles: true, composed: true }))

    const n = input.files?.length ?? 0
    return n > 0 || assigned
  } catch (err) {
    console.warn("[OpsGate] injectFilesIntoInput failed:", err)
    return false
  }
}

/** Fallback : simuler un drop de fichiers sur le composer */
function tryDropFilesOnComposer(files: File[]): boolean {
  try {
    const dt = new DataTransfer()
    for (const f of files) {
      try {
        dt.items.add(
          new File([f], f.name, {
            type: f.type || "application/octet-stream",
            lastModified: f.lastModified || Date.now()
          })
        )
      } catch {
        dt.items.add(f)
      }
    }
    const targets: EventTarget[] = []
    const composers = findComposerElements()
    for (const c of composers.slice(0, 3)) {
      targets.push(c)
      if (c.parentElement) targets.push(c.parentElement)
      const form = c.closest("form")
      if (form) targets.push(form)
    }
    const main =
      document.querySelector("main") ||
      document.querySelector('[class*="composer" i]') ||
      document.body
    if (main) targets.push(main)

    for (const t of targets) {
      try {
        bypassFileOnce = true
        t.dispatchEvent(
          new DragEvent("dragenter", {
            bubbles: true,
            cancelable: true,
            dataTransfer: dt
          })
        )
        bypassFileOnce = true
        t.dispatchEvent(
          new DragEvent("dragover", {
            bubbles: true,
            cancelable: true,
            dataTransfer: dt
          })
        )
        bypassFileOnce = true
        const dropped = t.dispatchEvent(
          new DragEvent("drop", {
            bubbles: true,
            cancelable: true,
            dataTransfer: dt
          })
        )
        if (dropped || true) {
          // drop a été livré — considérer comme tentative OK si un input a reçu
          const after = findLiveFileInputs()
          for (const inp of after) {
            if (inp.files && inp.files.length > 0) return true
          }
        }
      } catch {
        /* next target */
      }
    }
    return false
  } catch (e) {
    console.warn("[OpsGate] tryDropFilesOnComposer failed", e)
    return false
  }
}

/**
 * Remplace / (re)joint les pièces après scan.
 * Stratégie multi-tentatives pour SPA (ChatGPT, Claude, Gemini…).
 */
function replaceAttachments(
  files: File[],
  preferred?: HTMLInputElement | null
): boolean {
  if (!files.length) return false

  // 1) Injecter d’abord sur l’input d’origine (sans purge globale)
  if (preferred?.isConnected) {
    if (injectFilesIntoInput(preferred, files)) {
      console.log(
        "[OpsGate] Pièce jointe sur input d’origine:",
        files.map((f) => f.name).join(", ")
      )
      return true
    }
  }

  // 2) Autres inputs live
  const inputs = findLiveFileInputs(preferred)
  for (const target of inputs) {
    if (injectFilesIntoInput(target, files)) {
      console.log(
        "[OpsGate] Pièce jointe injectée:",
        files.map((f) => f.name).join(", ")
      )
      return true
    }
  }

  // 3) Drop sur composer
  if (tryDropFilesOnComposer(files)) {
    console.log(
      "[OpsGate] Pièce jointe via drop composer:",
      files.map((f) => f.name).join(", ")
    )
    return true
  }

  // 4) Dernier essai : clear soft + re-inject
  if (preferred?.isConnected) {
    clearFileInput(preferred)
    if (injectFilesIntoInput(preferred, files)) return true
  }

  console.warn(
    "[OpsGate] Aucun input[type=file] acceptant l’injection — l’utilisateur peut re-sélectionner le fichier (déjà scanné côté OpsGate)."
  )
  return false
}

function filesFromDataTransfer(dt: DataTransfer): File[] {
  return Array.from(dt.files)
}

/**
 * Pipeline fichier après quarantaine :
 * - clean → injecte une fois vers la page
 * - sensible → bandeau, puis injecte 0 ou 1 version selon décision
 */
async function processQuarantinedFiles(
  frozen: File[],
  input?: HTMLInputElement | null
): Promise<void> {
  if (frozen.length === 0) return
  if (filePending || isBannerOpen()) return

  filePending = true
  try {
    const { rules: activeRules } = detectTextSync("") // warm rules ref
    const rules: DetectionRule[] | null = activeRules
    const scanOpts = {
      scanConfigs: settings.scanConfigs !== false,
      scanDatabases: settings.scanDatabases !== false,
      scanImages: settings.scanImages === true,
      scanOffice: settings.scanOffice !== false,
      warnMedia: settings.warnMedia !== false
    }
    const scans = await scanFiles(frozen, rules, scanOpts)
    const detections = mergeDetections(scans)
    const fileNames = frozen.map((f) => f.name)
    const warnOnly = scans.filter((s) =>
      [
        "unsupported",
        "media_warn",
        "office_warn",
        "image_skipped",
        "image_ocr_limited",
        "image_ocr_failed",
        "warn_confirm"
      ].includes(s.status)
    )
    const partial = scans.filter((s) => s.status === "too_large_partial")
    const needsConfirm =
      detections.length > 0 ||
      warnOnly.some((s) =>
        [
          "media_warn",
          "office_warn",
          "image_skipped",
          "image_ocr_limited",
          "image_ocr_failed",
          "warn_confirm"
        ].includes(s.status)
      )

    // Rien de sensible et pas de warning media/office → livrer
    if (!needsConfirm) {
      // Micro-délai : laisse le SPA recréer l’input file après preventDefault
      await new Promise((r) => setTimeout(r, 40))
      const ok = replaceAttachments(frozen, input)
      if (!ok) {
        // Scan OK mais SPA refuse l’injection — ne pas bloquer l’utilisateur
        showToast(
          "Fichier scanné (aucune donnée sensible). Si la pièce n’apparaît pas, re-sélectionnez-la une fois — le prochain envoi sera protégé.",
          {
            tone: "info",
            title: "Scan OK — jointure SPA",
            durationMs: 7000
          }
        )
        console.warn(
          "[OpsGate] Scan clean OK mais injection SPA échouée",
          fileNames
        )
      }
      filePending = false
      return
    }

    // Sensible ou warning type (media/office) → bandeau
    const notes: string[] = []
    if (partial.length) {
      notes.push("Certains gros fichiers n’ont été scannés qu’en partie.")
    }
    for (const w of warnOnly) {
      if (w.userHint) notes.push(`${w.fileName}: ${w.userHint}`)
    }

    // Si uniquement des warnings sans détection : bandeau synthétique
    const bannerDetections =
      detections.length > 0
        ? detections
        : ([
            {
              type: "Fichier à confirmer",
              ruleId: "file-confirm",
              severity: "medium" as const,
              match: warnOnly.map((w) => w.fileName).join(", "),
              index: 0
            }
          ] as unknown as Detection[])

    const fileAction = settings.defaultAction || "mask_recommend"
    const agentLang = resolveAgentLang(settings.agentUiLang)
    const fileMsgs = mergeMessagesForLang(agentLang, settings.userMessages)

    // Texte agrégé pour preview Secure Rewrite (fichiers scannés)
    const filePreviewText = scans
      .filter((s) => s.text && s.detections.length > 0)
      .map((s) => `--- ${s.fileName} ---\n${s.text}`)
      .join("\n\n")
      .slice(0, 120_000)

    showAlertBanner(
      bannerDetections,
      (decision, meta) => {
        filePending = false
        void (async () => {
          const sensitiveScans = scans.filter((s) => s.detections.length > 0)
          // Enrichir types pour le journal (extension + catégorie)
          const typeTags = [
            ...detections.map((d) => d.type),
            ...scans.map((s) => `file:${s.category}:${s.fileName}`)
          ]

          try {
            if (fileAction === "block" || decision === "cancel") {
              clearAllFileInputs(input)
              await logDecision(
                "cancel",
                bannerDetections,
                false,
                "file",
                fileNames
              )
              toastFromDecision(
                fileAction === "block" ? "blocked" : "cancel",
                fileMsgs
              )
              return
            }

            if (
              (decision === "mask_send" || decision === "secure_rewrite") &&
              detections.length > 0
            ) {
              // Secure Rewrite / mask : sortie toujours en .txt (pas de faux .docx/.pdf)
              const dt = buildMaskedFileList(
                frozen,
                scans as FileScanResult[],
                rules,
                decision === "secure_rewrite" ? "secure_rewrite" : "mask",
                {
                  previewRewrittenText:
                    decision === "secure_rewrite"
                      ? meta?.rewrittenText
                      : undefined
                }
              )
              // buildMaskedFileList produit déjà des noms .opsgate-secure.txt
              const maskedFiles = filesFromDataTransfer(dt)
              await new Promise((r) => setTimeout(r, 50))
              const ok = replaceAttachments(maskedFiles, input)
              await logDecision(decision, detections, true, "file", fileNames)
              if (ok) {
                toastFromDecision(decision, fileMsgs)
                showToast(
                  decision === "secure_rewrite"
                    ? "Fichier sécurisé joint en .txt (contenu anonymisé). Envoyez le message."
                    : "Fichier masqué joint en .txt. Envoyez le message.",
                  {
                    tone: "success",
                    title: "Pièce jointe prête",
                    durationMs: 5000
                  }
                )
              } else {
                clearAllFileInputs(input)
                downloadMaskedFallback(maskedFiles)
                showToast(
                  "La page a refusé la réinjection. Un fichier .txt sécurisé a été téléchargé — joignez-le manuellement puis envoyez.",
                  {
                    tone: "warning",
                    title: "Action manuelle requise",
                    durationMs: 8000
                  }
                )
              }
              void sensitiveScans
              return
            }

            if (fileAction === "mask_force") {
              clearAllFileInputs(input)
              toastFromDecision("blocked", fileMsgs)
              return
            }

            // Joindre l'original (choix conscient) - y compris confirm media/office
            const ok = replaceAttachments(frozen, input)
            await logDecision(
              "send_anyway",
              detections.length ? detections : bannerDetections,
              false,
              "file",
              fileNames
            )
            void typeTags
            if (ok) {
              toastFromDecision("send_anyway", fileMsgs)
            } else {
              showToast(
                "Impossible de re-joindre automatiquement. Re-sélectionnez le fichier si vous voulez l’envoyer.",
                {
                  tone: "warning",
                  title: "Échec de la jointure",
                  durationMs: 6500
                }
              )
            }
          } catch (err) {
            console.error("[OpsGate] Décision fichier:", err)
            showToast(
              "Vérifiez les pièces jointes avant d’envoyer le message.",
              {
                tone: "danger",
                title: "Erreur OpsGate",
                durationMs: 5000
              }
            )
          }
        })()
      },
      {
        source: "file",
        sourceText: filePreviewText || undefined,
        fileNames,
        note: notes.length ? notes.join(" ") : undefined,
        defaultAction: fileAction,
        userMessages: settings.userMessages,
        agentUiLang: settings.agentUiLang,
        orgName: settings.orgName,
        contactAdminEnabled: true
      }
    )
  } catch (err) {
    filePending = false
    console.error("[OpsGate] Scan fichier:", err)
    showToast("Erreur lors du scan du fichier", {
      tone: "danger",
      title: "Scan impossible",
      durationMs: 4500
    })
  }
}

function freezeFiles(files: FileList | File[]): File[] {
  return Array.from(files).map(
    (f) => new File([f], f.name, { type: f.type, lastModified: f.lastModified })
  )
}

/** Si la SPA refuse la réinjection, on offre le fichier masqué en local */
function downloadMaskedFallback(files: File[]) {
  for (const file of files) {
    try {
      const url = URL.createObjectURL(file)
      const a = document.createElement("a")
      a.href = url
      a.download = file.name.replace(/(\.[^.]+)?$/, "_masked$1")
      a.style.display = "none"
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 2000)
    } catch {
      // ignore
    }
  }
}

/**
 * Capture le change AVANT la page (phase capture) :
 * - copie les File en mémoire
 * - stoppe la propagation pour que React ne joigne pas l'original
 * - vide l'input
 * - scan puis injecte 0/1 fichier selon le résultat
 */
function onFileInputChange(e: Event) {
  if (bypassFileOnce) {
    bypassFileOnce = false
    return
  }
  if (!isExtensionEnabledHere() || settings.scanUploads === false) return

  const input = e.target as HTMLInputElement
  if (!input || input.type !== "file" || !input.files?.length) return

  const frozen = freezeFiles(input.files)

  // Empêcher la page d'attacher l'original non contrôlé
  e.stopPropagation()
  e.stopImmediatePropagation()
  if (typeof e.preventDefault === "function") e.preventDefault()

  try {
    bypassFileOnce = true
    input.value = ""
  } catch {
    // ignore
  }

  void processQuarantinedFiles(frozen, input)
}

function onDrop(e: DragEvent) {
  if (!isExtensionEnabledHere() || settings.scanUploads === false) return
  if (!e.dataTransfer?.files?.length) return

  // Intercepter le drop pour éviter le double chargement
  const frozen = freezeFiles(e.dataTransfer.files)
  if (frozen.length === 0) return

  e.stopPropagation()
  e.stopImmediatePropagation()
  e.preventDefault()

  const input =
    findLiveFileInputs().find((i) => true) ||
    document.querySelector<HTMLInputElement>('input[type="file"]')

  // Vider tout input file existant
  clearAllFileInputs(input)

  void processQuarantinedFiles(frozen, input)
}

// Empêcher le drop navigateur par défaut sur la zone (pour pouvoir intercepter)
document.addEventListener(
  "dragover",
  (e) => {
    if (!isExtensionEnabledHere() || settings.scanUploads === false) return
    if (e.dataTransfer?.types?.includes("Files")) {
      e.preventDefault()
    }
  },
  true
)

function retriggerSend(sourceEl?: Element | null) {
  const selectors = [
    'button[data-testid="send-button"]:not([disabled])',
    'button[data-testid="composer-send-button"]:not([disabled])',
    'button[aria-label*="Send" i]:not([disabled])',
    'button[aria-label*="Envoyer" i]:not([disabled])',
    'button[aria-label*="send message" i]:not([disabled])',
    'button[aria-label*="Submit" i]:not([disabled])',
    'button[title*="Send" i]:not([disabled])',
    'button[type="submit"]:not([disabled])'
  ]

  for (const sel of selectors) {
    try {
      const btn = document.querySelector<HTMLElement>(sel)
      if (btn && !(btn as HTMLButtonElement).disabled && isNearComposer(btn)) {
        btn.click()
        return
      }
    } catch {
      // selector invalide sur vieux moteurs
    }
  }

  // Dernier bouton SVG près du composer (DeepSeek / Perplexity / multi-IA)
  const composers = findComposerElements()
  for (const c of composers.slice(0, 2)) {
    const box =
      c.closest("form") ||
      c.parentElement?.parentElement ||
      c.parentElement
    if (!box) continue
    const buttons = Array.from(
      box.querySelectorAll<HTMLElement>("button, [role='button']")
    ).filter((b) => !(b as HTMLButtonElement).disabled)
    const last = buttons[buttons.length - 1]
    if (last) {
      last.click()
      return
    }
  }

  const editable =
    (sourceEl as HTMLElement)?.closest?.(
      '[contenteditable="true"], textarea, [role="textbox"]'
    ) ||
    document.querySelector("#prompt-textarea") ||
    findComposerElements()[0] ||
    document.querySelector('[contenteditable="true"]')

  if (editable) {
    ;(editable as HTMLElement).focus()
    editable.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true
      })
    )
  }
}

function showActiveBadge() {
  const id = "opsgate-active-badge"
  if (document.getElementById(id)) return
  const el = document.createElement("div")
  el.id = id
  el.title = "OpsGate actif - protection des prompts IA"
  el.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 32 32" aria-hidden="true">
      <path fill="none" stroke="#67e8f9" stroke-width="2.2" stroke-linecap="round"
        d="M8 22V12c0-4 3.5-7 8-7s8 3 8 7v10"/>
      <path fill="#67e8f9" d="M16 14.5c-1.8 0-3.2 1.3-3.2 3v1.2h6.4V17.5c0-1.7-1.4-3-3.2-3z"/>
    </svg>`
  Object.assign(el.style, {
    position: "fixed",
    bottom: "12px",
    right: "12px",
    zIndex: "2147483646",
    width: "30px",
    height: "30px",
    borderRadius: "9px",
    background: "linear-gradient(145deg, #0f172a 0%, #164e63 100%)",
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0 4px 14px rgba(15,23,42,0.4)",
    opacity: "0.92",
    pointerEvents: "none",
    border: "1px solid rgba(103,232,249,0.35)"
  } as CSSStyleDeclaration)
  document.documentElement.appendChild(el)
}

// --- Listeners (capture, phase capture = avant la page) ---

document.addEventListener(
  "click",
  (e) => {
    if (!isExtensionEnabledHere()) return
    const target = e.target as Element
    if (isSendButton(target)) {
      handlePotentialSend(e, target)
    }
  },
  true
)

// pointerdown capture : certains UIs envoient avant le click complet
document.addEventListener(
  "pointerdown",
  (e) => {
    if (!isExtensionEnabledHere()) return
    const target = e.target as Element
    if (isSendButton(target)) {
      // Pré-scan : si sensible, bloquer aussi le pointerdown
      if (bypassOnce || pending || isBannerOpen()) return
      if (!settings.enabled) return
      const text = getPromptText(target)
      if (text.length >= 5 && detectTextSync(text).detections.length > 0) {
        handlePotentialSend(e, target)
      }
    }
  },
  true
)

document.addEventListener(
  "keydown",
  (e) => {
    if (!isExtensionEnabledHere()) return
    if (e.key !== "Enter" || e.shiftKey || e.isComposing) return
    const target = e.target as Element
    if (!isInComposer(target)) return
    handlePotentialSend(e, target)
  },
  true
)

document.addEventListener(
  "submit",
  (e) => {
    if (!isExtensionEnabledHere()) return
    handlePotentialSend(e, e.target as Element)
  },
  true
)

// Uploads : change + drop
document.addEventListener("change", onFileInputChange, true)
document.addEventListener("drop", onDrop, true)

// Observer les input file ajoutés dynamiquement (SPA)
const mo = new MutationObserver((mutations) => {
  for (const m of mutations) {
    for (const node of Array.from(m.addedNodes)) {
      if (!(node instanceof Element)) continue
      if (node instanceof HTMLInputElement && node.type === "file") {
        node.addEventListener("change", onFileInputChange, true)
      }
      node.querySelectorAll?.('input[type="file"]').forEach((el) => {
        el.addEventListener("change", onFileInputChange, true)
      })
    }
  }
})
mo.observe(document.documentElement, { childList: true, subtree: true })

window.addEventListener("pagehide", () => {
  removeBanner()
  pending = false
  filePending = false
})

showActiveBadge()
void refreshSettings().then(() => {
  const ok = isExtensionEnabledHere()
  console.log(
    "[OpsGate] Content script actif sur",
    location.hostname,
    ok ? "· protection ON" : "· protection OFF (host hors policy / disabled)",
    "hosts=",
    (settings.enabledHosts || []).slice(0, 12).join(",") +
      ((settings.enabledHosts || []).length > 12 ? "…" : "")
  )
  if (!ok) {
    document.getElementById("opsgate-active-badge")?.remove()
  }
})
