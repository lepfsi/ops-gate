import type { PlasmoCSConfig } from "plasmo"
import type { DetectionRule } from "@opsgate/engine"

import { initRulesMemoryListener } from "~lib/agent-store"
import { isBannerOpen, removeBanner, showAlertBanner, showToast } from "~lib/banner"
import { detectTextSync, ensureRulesWarm, maskText } from "~lib/detect"
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

export const config: PlasmoCSConfig = {
  matches: [
    "https://chatgpt.com/*",
    "https://chat.openai.com/*",
    "https://claude.ai/*",
    "https://gemini.google.com/*",
    "https://copilot.microsoft.com/*",
    "https://www.bing.com/chat*",
    "https://perplexity.ai/*",
    "https://www.perplexity.ai/*",
    "https://chat.deepseek.com/*",
    "https://aistudio.google.com/*"
  ],
  run_at: "document_idle"
}

/** Skip la prochaine interception (après décision utilisateur) */
let bypassOnce = false
/** En attente de décision */
let pending = false

/** Settings en cache synchrone — ne jamais await avant preventDefault */
let settings: OpsGateSettings = { ...DEFAULT_SETTINGS }

async function refreshSettings() {
  try {
    const res = (await chrome.runtime.sendMessage({ type: "GET_SETTINGS" })) as {
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
chrome.storage?.onChanged?.addListener((changes, area) => {
  if (area === "local" && changes.opsGateSettings?.newValue) {
    settings = { ...DEFAULT_SETTINGS, ...changes.opsGateSettings.newValue }
  }
})

function logDecision(
  decision: UserDecision,
  detections: Detection[],
  masked: boolean,
  source: DetectionSource = "prompt",
  fileNames?: string[]
) {
  try {
    chrome.runtime.sendMessage({
      type: "LOG_DETECTION",
      entry: buildJournalPayload(
        location.href,
        decision,
        detections,
        masked,
        source,
        fileNames
      )
    })
  } catch {
    // ignore
  }
}

function isExtensionEnabledHere(): boolean {
  if (!settings.enabled) return false
  // Unlicensed après grace : protection désactivée
  if (settings.licenseStatus === "unlicensed") return false
  if (settings.securityActive === false) return false
  const host = location.hostname
  return settings.enabledHosts.some((h) => host === h || host.endsWith("." + h))
}

/** Flag pour ignorer le prochain change sur un input file (après décision) */
let bypassFileOnce = false
let filePending = false

function getPromptText(fromEl?: Element | null): string {
  const host = location.hostname

  if (host.includes("chatgpt.com") || host.includes("chat.openai.com")) {
    const ta =
      document.querySelector<HTMLElement>("#prompt-textarea") ||
      document.querySelector<HTMLElement>('[data-testid="prompt-textarea"]') ||
      document.querySelector<HTMLElement>('div[contenteditable="true"].ProseMirror') ||
      document.querySelector<HTMLElement>('div[contenteditable="true"]#prompt-textarea')
    if (ta) return (ta.innerText || ta.textContent || "").trim()
  }

  if (host.includes("claude.ai")) {
    const ta =
      document.querySelector<HTMLElement>('div[contenteditable="true"].ProseMirror') ||
      document.querySelector<HTMLElement>('fieldset div[contenteditable="true"]') ||
      document.querySelector<HTMLElement>('div[contenteditable="true"]')
    if (ta) return (ta.innerText || ta.textContent || "").trim()
  }

  if (host.includes("gemini.google.com")) {
    const ta =
      document.querySelector<HTMLElement>("rich-textarea div[contenteditable='true']") ||
      document.querySelector<HTMLElement>('div[contenteditable="true"][aria-label]') ||
      document.querySelector<HTMLElement>('div[contenteditable="true"]')
    if (ta) return (ta.innerText || ta.textContent || "").trim()
  }

  if (fromEl) {
    const editable = fromEl.closest(
      '[contenteditable="true"], textarea'
    ) as HTMLElement | null
    if (editable) {
      if (editable instanceof HTMLTextAreaElement) return editable.value.trim()
      return (editable.innerText || editable.textContent || "").trim()
    }
  }

  const active = document.activeElement as HTMLElement | null
  if (active) {
    if (active instanceof HTMLTextAreaElement) return active.value.trim()
    if (active.isContentEditable) return (active.innerText || "").trim()
  }

  // Dernier recours : tout contenteditable visible en bas de page
  const all = Array.from(
    document.querySelectorAll<HTMLElement>('[contenteditable="true"], textarea')
  )
  for (const el of all.reverse()) {
    const t =
      el instanceof HTMLTextAreaElement
        ? el.value.trim()
        : (el.innerText || "").trim()
    if (t.length >= 5) return t
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
      document.querySelector<HTMLElement>('div[contenteditable="true"].ProseMirror')
    if (el) candidates.push(el)
  } else if (host.includes("claude.ai")) {
    const el =
      document.querySelector<HTMLElement>('div[contenteditable="true"].ProseMirror') ||
      document.querySelector<HTMLElement>('div[contenteditable="true"]')
    if (el) candidates.push(el)
  } else if (host.includes("gemini.google.com")) {
    const el =
      document.querySelector<HTMLElement>("rich-textarea div[contenteditable='true']") ||
      document.querySelector<HTMLElement>('div[contenteditable="true"]')
    if (el) candidates.push(el)
  }

  const active = document.activeElement as HTMLElement | null
  if (active && (active.isContentEditable || active instanceof HTMLTextAreaElement)) {
    candidates.unshift(active)
  }

  const target = candidates[0]
  if (!target) return false

  if (target instanceof HTMLTextAreaElement) {
    const proto = HTMLTextAreaElement.prototype
    const desc = Object.getOwnPropertyDescriptor(proto, "value")
    desc?.set?.call(target, text)
    target.dispatchEvent(new Event("input", { bubbles: true }))
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
        new InputEvent("input", { bubbles: true, inputType: "insertText", data: text })
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
  if (el.closest("#opsgate-alert-banner, #opsgate-toast, #opsgate-active-badge")) {
    return false
  }
  const btn = el.closest(
    "button, [role='button'], div[role='button'], a[role='button']"
  ) as HTMLElement | null
  if (!btn) return false
  if ((btn as HTMLButtonElement).disabled) return false

  const aria = (btn.getAttribute("aria-label") || "").toLowerCase()
  const testId = (btn.getAttribute("data-testid") || "").toLowerCase()
  const title = (btn.getAttribute("title") || "").toLowerCase()
  const dataAction = (btn.getAttribute("data-action") || "").toLowerCase()
  const text = (btn.innerText || btn.textContent || "").trim().toLowerCase()

  if (
    testId.includes("send") ||
    aria.includes("send") ||
    title.includes("send") ||
    dataAction.includes("send")
  ) {
    return true
  }
  if (aria.includes("envoyer") || title.includes("envoyer")) return true
  if (aria.includes("send message") || aria.includes("envoyer le message")) return true

  // Bouton submit dans un form de composer
  if (
    (btn.getAttribute("type") === "submit" || aria.includes("submit")) &&
    (btn.closest("form") || isNearComposer(btn))
  ) {
    return true
  }

  // Icône seule près du composer (ChatGPT / Claude)
  if (btn.querySelector("svg") && isNearComposer(btn) && text.length <= 2) {
    // Exclure attach / mic / etc.
    if (
      aria.includes("attach") ||
      aria.includes("upload") ||
      aria.includes("micro") ||
      aria.includes("voice") ||
      aria.includes("photo") ||
      testId.includes("attach")
    ) {
      return false
    }
    // Souvent le bouton send est le dernier bouton du composer
    if (aria.includes("send") || testId.includes("send") || !aria) {
      // si pas d'aria bloquant et proche composer : considérer send si data-testid ou form
      if (testId.includes("send") || btn.closest("form")) return true
    }
  }

  return testId === "send-button" || testId === "composer-send-button"
}

function isNearComposer(el: Element): boolean {
  return !!(
    el.closest("form") ||
    el.closest('[class*="composer" i]') ||
    el.closest('[class*="prompt" i]') ||
    el.closest('[class*="input" i]') ||
    el.closest("#prompt-textarea")?.parentElement?.contains(el)
  )
}

function isInComposer(el: Element | null): boolean {
  if (!el) return false
  return !!(
    el.closest("#prompt-textarea") ||
    el.closest('[data-testid="prompt-textarea"]') ||
    el.closest('[contenteditable="true"]') ||
    el.closest("textarea") ||
    el.closest("form") ||
    el.closest("rich-textarea")
  )
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

  const host = location.hostname
  const allowed = settings.enabledHosts.some(
    (h) => host === h || host.endsWith("." + h)
  )
  if (!allowed) return

  const text = getPromptText(sourceEl)
  if (!text || text.length < 5) return

  const { detections, rules } = detectTextSync(text)
  if (detections.length === 0) return

  // Bloquer IMMÉDIATEMENT
  event.preventDefault()
  event.stopPropagation()
  event.stopImmediatePropagation()
  pending = true

  console.log(
    "[OpsGate] Envoi bloqué —",
    detections.length,
    "détection(s):",
    detections.map((d) => d.type).join(", "),
    settings.rulesPackVersion ? `pack=${settings.rulesPackVersion}` : "pack=embedded"
  )

  showAlertBanner(detections, (decision) => {
    pending = false

    if (decision === "cancel") {
      logDecision("cancel", detections, false, "prompt")
      showToast("Envoi annulé — vos données restent dans le champ")
      return
    }

    if (decision === "mask_send") {
      const masked = maskText(text, detections, rules)
      setPromptText(masked)
      logDecision("mask_send", detections, true, "prompt")
      showToast("Données masquées — envoi…")
      bypassOnce = true
      setTimeout(() => retriggerSend(sourceEl), 120)
      return
    }

    logDecision("send_anyway", detections, false, "prompt")
    showToast("Envoi sans masquage — attention aux données exposées")
    bypassOnce = true
    setTimeout(() => retriggerSend(sourceEl), 60)
  })
}

// ---------- Uploads de fichiers ----------

/** Inputs file encore présents dans le DOM (les SPA recyclent souvent les nœuds) */
function findLiveFileInputs(preferred?: HTMLInputElement | null): HTMLInputElement[] {
  const all = Array.from(
    document.querySelectorAll<HTMLInputElement>('input[type="file"]')
  )
  if (preferred && all.includes(preferred)) {
    return [preferred, ...all.filter((i) => i !== preferred)]
  }
  if (preferred && preferred.isConnected) {
    return [preferred, ...all.filter((i) => i !== preferred)]
  }
  return all
}

function clearFileInput(input: HTMLInputElement) {
  try {
    bypassFileOnce = true
    input.value = ""
    // Certains frameworks n'écoutent que InputEvent
    input.dispatchEvent(new Event("input", { bubbles: true }))
    input.dispatchEvent(new Event("change", { bubbles: true }))
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
 * Injecte des fichiers dans UN input (React/SPA) :
 * clear global d'abord (évite doublon original + masqué), puis assign.
 */
function injectFilesIntoInput(input: HTMLInputElement, files: File[]): boolean {
  try {
    const dt = new DataTransfer()
    for (const f of files) dt.items.add(f)

    bypassFileOnce = true
    try {
      input.value = ""
    } catch {
      // ignore
    }

    bypassFileOnce = true
    try {
      input.files = dt.files
    } catch {
      try {
        Object.defineProperty(input, "files", {
          configurable: true,
          value: dt.files
        })
      } catch {
        return false
      }
    }

    if (!input.files || input.files.length === 0) {
      return false
    }

    bypassFileOnce = true
    input.dispatchEvent(
      new InputEvent("input", { bubbles: true, composed: true, inputType: "insertFromPaste" })
    )
    bypassFileOnce = true
    input.dispatchEvent(new Event("change", { bubbles: true, composed: true }))

    return input.files.length > 0
  } catch (err) {
    console.warn("[OpsGate] injectFilesIntoInput failed:", err)
    return false
  }
}

/**
 * Remplace complètement les pièces jointes :
 * 1) vide tous les inputs (supprime l'original non contrôlé)
 * 2) injecte UNE seule fois la liste voulue
 */
function replaceAttachments(
  files: File[],
  preferred?: HTMLInputElement | null
): boolean {
  // Toujours purger d'abord pour éviter original + version contrôlée
  clearAllFileInputs(preferred)

  const inputs = findLiveFileInputs(preferred)
  if (inputs.length === 0) {
    console.warn("[OpsGate] Aucun input[type=file] pour injecter")
    return false
  }

  // Un seul input — sinon risque de multi-joindre le même fichier
  const target = inputs[0]
  const ok = injectFilesIntoInput(target, files)
  if (ok) {
    console.log("[OpsGate] Pièce jointe remplacée:", files.map((f) => f.name).join(", "))
  }
  return ok
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
    const scans = await scanFiles(frozen, rules)
    const detections = mergeDetections(scans)
    const fileNames = frozen.map((f) => f.name)
    const unsupported = scans.filter((s) => s.status === "unsupported")
    const partial = scans.filter((s) => s.status === "too_large_partial")

    // Rien de sensible → livrer le fichier une seule fois à la page
    if (detections.length === 0) {
      const ok = replaceAttachments(frozen, input)
      if (!ok) {
        showToast(
          "Impossible de joindre le fichier automatiquement après scan.",
          { tone: "warning", title: "Jointure échouée", durationMs: 5000 }
        )
      } else if (unsupported.length > 0) {
        showToast(
          `${unsupported.length} fichier(s) non analysable(s) (PDF/image…). Vérifiez-les manuellement.`,
          { tone: "warning", title: "Scan partiel", durationMs: 5000 }
        )
      }
      filePending = false
      return
    }

    // Sensible : rester en quarantaine (déjà vidé) + bandeau
    const notes: string[] = []
    if (partial.length) {
      notes.push("Certains gros fichiers n’ont été scannés qu’en partie.")
    }
    if (unsupported.length) {
      notes.push(
        `${unsupported.length} fichier(s) binaire(s) non analysé(s) en MVP.`
      )
    }

    showAlertBanner(
      detections,
      (decision) => {
        filePending = false
        const sensitiveScans = scans.filter((s) => s.detections.length > 0)

        try {
          if (decision === "cancel") {
            clearAllFileInputs(input)
            logDecision("cancel", detections, false, "file", fileNames)
            showToast("Aucune pièce jointe n’a été transmise à l’IA.", {
              tone: "success",
              title: "Fichier non joint",
              durationMs: 4000
            })
            return
          }

          if (decision === "mask_send") {
            const dt = buildMaskedFileList(
              frozen,
              scans as FileScanResult[],
              rules
            )
            const maskedFiles = filesFromDataTransfer(dt).map((f) => {
              const dot = f.name.lastIndexOf(".")
              const base = dot > 0 ? f.name.slice(0, dot) : f.name
              const ext = dot > 0 ? f.name.slice(dot) : ""
              return new File([f], `${base}.opsgate-masked${ext}`, {
                type: f.type || "text/plain",
                lastModified: Date.now()
              })
            })
            const ok = replaceAttachments(maskedFiles, input)
            logDecision("mask_send", detections, true, "file", fileNames)
            if (ok) {
              showToast(
                sensitiveScans.length > 1
                  ? "Seules les versions masquées sont jointes. L’original n’a pas été envoyé."
                  : "Seule la version masquée est jointe. L’original n’a pas été envoyé.",
                {
                  tone: "success",
                  title: "Masquage appliqué",
                  durationMs: 5500
                }
              )
            } else {
              clearAllFileInputs(input)
              downloadMaskedFallback(maskedFiles)
              showToast(
                "Réinjection refusée par la page. Un fichier masqué a été téléchargé — joignez-le manuellement.",
                {
                  tone: "warning",
                  title: "Action manuelle requise",
                  durationMs: 7000
                }
              )
            }
            return
          }

          // Joindre l'original (choix conscient)
          const ok = replaceAttachments(frozen, input)
          logDecision("send_anyway", detections, false, "file", fileNames)
          if (ok) {
            showToast(
              "Le fichier ORIGINAL non masqué est joint. Des secrets peuvent être lus par l’IA.",
              {
                tone: "danger",
                title: "Joint sans masquage",
                durationMs: 7000
              }
            )
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
      },
      {
        source: "file",
        fileNames,
        note: notes.length ? notes.join(" ") : undefined
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
    'button[aria-label*="send message" i]:not([disabled])'
  ]

  for (const sel of selectors) {
    try {
      const btn = document.querySelector<HTMLElement>(sel)
      if (btn && !(btn as HTMLButtonElement).disabled) {
        btn.click()
        return
      }
    } catch {
      // selector invalide sur vieux moteurs
    }
  }

  const editable =
    (sourceEl as HTMLElement)?.closest?.('[contenteditable="true"], textarea') ||
    document.querySelector("#prompt-textarea") ||
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
  el.title = "OpsGate actif — protection des prompts IA"
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
console.log("[OpsGate] Content script actif sur", location.hostname)
