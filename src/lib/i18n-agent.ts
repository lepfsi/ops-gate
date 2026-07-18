/**
 * i18n agent (banner + options) — FR / EN.
 * Source de vérité locale : settings.agentUiLang (sync org) ou navigateur si auto.
 * Ne pas confondre avec la langue de la console admin (préférence locale navigateur).
 */

export type AgentUiLangPref = "fr" | "en" | "auto"
export type AgentUiLang = "fr" | "en"

type Dict = Record<string, string>

const FR: Dict = {
  "banner.details": "Détails",
  "banner.sim": "Simuler",
  "banner.contact": "Contacter l’admin",
  "banner.contactTitle": "Envoyer un message à l’administrateur",
  "banner.cancel": "Annuler",
  "banner.sendAnyway": "Envoyer quand même",
  "banner.mask": "Masquer",
  "banner.rewrite": "Secure Rewrite",
  "banner.back": "Retour",
  "banner.send": "Envoyer",
  "banner.applySend": "Appliquer et envoyer",
  "banner.edit": "Éditer",
  "banner.close": "Fermer",
  "banner.journalized": "Action journalisée",
  "banner.notAttach": "Ne pas joindre",
  "banner.attachOriginal": "Joindre l’original",
  "banner.viewingSecure": "Secure Rewrite",
  "banner.riskLine": "Éléments critiques : Secure Rewrite recommandé.",
  "banner.pillAlert": "Alerte sécurité · policy org",
  "banner.pillFile": "Fichier en attente · policy org",
  "banner.pillBlock": "Bloqué par la politique admin",
  "banner.pillForce": "Masquage obligatoire · policy",
  "opt.lang": "Langue de l’interface",
  "opt.langHint":
    "Pilotée par l’organisation (fr / en / auto navigateur). En local seul : préférence de ce poste."
}

const EN: Dict = {
  "banner.details": "Details",
  "banner.sim": "Simulate",
  "banner.contact": "Contact admin",
  "banner.contactTitle": "Send a message to your administrator",
  "banner.cancel": "Cancel",
  "banner.sendAnyway": "Send anyway",
  "banner.mask": "Mask",
  "banner.rewrite": "Secure Rewrite",
  "banner.back": "Back",
  "banner.send": "Send",
  "banner.applySend": "Apply & send",
  "banner.edit": "Edit",
  "banner.close": "Close",
  "banner.journalized": "Action logged",
  "banner.notAttach": "Don’t attach",
  "banner.attachOriginal": "Attach original",
  "banner.viewingSecure": "Secure Rewrite",
  "banner.riskLine": "Critical items: Secure Rewrite recommended.",
  "banner.pillAlert": "Security alert · org policy",
  "banner.pillFile": "File pending · org policy",
  "banner.pillBlock": "Blocked by admin policy",
  "banner.pillForce": "Masking required · policy",
  "opt.lang": "Interface language",
  "opt.langHint":
    "Driven by your organization (fr / en / browser auto). Local-only: this device preference."
}

const CATALOGS: Record<AgentUiLang, Dict> = { fr: FR, en: EN }

/** Messages banner/toast par défaut (quand l’org n’a pas customisé user_messages). */
export const DEFAULT_MESSAGES_BY_LANG: Record<
  AgentUiLang,
  import("~types").PolicyUserMessages
> = {
  fr: {
    adminNotice:
      "Restriction appliquée par la politique de sécurité de votre organisation (OpsGate).",
    alertTitle: "Données sensibles détectées",
    alertBody:
      "Protection active avant envoi vers l'IA. Choisissez une action autorisée.",
    blockTitle: "Envoi non autorisé",
    blockBody:
      "La politique de votre organisation bloque cet envoi. Contactez l'administrateur si vous avez besoin d'une exception.",
    maskForceTitle: "Masquage obligatoire",
    maskForceBody:
      "Votre administrateur impose le masquage des données sensibles avant tout envoi.",
    btnMask: "Masquer simplement",
    btnSecureRewrite: "Secure Rewrite & envoyer",
    btnSendAnyway: "Envoyer quand même",
    btnCancel: "Annuler",
    btnBlockAck: "Compris",
    toastCancel: "Envoi annulé. Aucune donnée transmise.",
    toastMask: "Données masquées. Envoi en cours…",
    toastSecureRewrite: "Secure Rewrite appliqué. Envoi en cours…",
    toastSendAnyway: "Envoi journalisé pour votre administrateur.",
    toastBlocked: "Envoi bloqué. Aucune donnée transmise.",
    alertTitleFile: "Fichier : données sensibles",
    alertBodyFile:
      "Analyse du fichier avant envoi à l'IA. Choisissez une action autorisée."
  },
  en: {
    adminNotice:
      "This restriction is enforced by your organization's security policy (OpsGate).",
    alertTitle: "Sensitive data detected",
    alertBody:
      "Protection is active before sending to AI. Choose an allowed action.",
    blockTitle: "Sending not allowed",
    blockBody:
      "Your organization's policy blocks this send. Contact your administrator if you need an exception.",
    maskForceTitle: "Masking required",
    maskForceBody:
      "Your administrator requires sensitive data to be masked before any send.",
    btnMask: "Simple mask",
    btnSecureRewrite: "Secure Rewrite & send",
    btnSendAnyway: "Send anyway",
    btnCancel: "Cancel",
    btnBlockAck: "Got it",
    toastCancel: "Send cancelled. No data transmitted.",
    toastMask: "Data masked. Sending…",
    toastSecureRewrite: "Secure Rewrite applied. Sending…",
    toastSendAnyway: "Send logged for your administrator.",
    toastBlocked: "Send blocked. No data transmitted.",
    alertTitleFile: "File: sensitive data",
    alertBodyFile:
      "File analyzed before sending to AI. Choose an allowed action."
  }
}

export function browserAgentLang(): AgentUiLang {
  try {
    const nav =
      typeof navigator !== "undefined"
        ? navigator.language || (navigator as { userLanguage?: string }).userLanguage || "fr"
        : "fr"
    return nav.toLowerCase().startsWith("en") ? "en" : "fr"
  } catch {
    return "fr"
  }
}

/** Résout fr|en à partir de la préférence org (+ navigateur si auto). */
export function resolveAgentLang(
  pref?: AgentUiLangPref | string | null
): AgentUiLang {
  if (pref === "en" || pref === "fr") return pref
  if (pref === "auto") return browserAgentLang()
  return "fr"
}

export function tAgent(
  lang: AgentUiLang,
  key: string,
  vars?: Record<string, string | number>
): string {
  let s = CATALOGS[lang][key] || CATALOGS.fr[key] || key
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replace(new RegExp(`\\{${k}\\}`, "g"), String(v))
    }
  }
  return s
}

/**
 * Fusionne messages policy custom par-dessus les defaults de la langue résolue.
 * Si l’admin a customisé un champ (n’importe quelle langue), il prime.
 */
export function mergeMessagesForLang(
  lang: AgentUiLang,
  partial?: Partial<import("~types").PolicyUserMessages> | null
): import("~types").PolicyUserMessages {
  const base = { ...DEFAULT_MESSAGES_BY_LANG[lang] }
  if (!partial || typeof partial !== "object") return base
  for (const key of Object.keys(base) as (keyof typeof base)[]) {
    const v = partial[key]
    if (typeof v === "string" && v.trim()) base[key] = v.trim()
  }
  return base
}
