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
  "banner.riskLine": "Nous pouvons anonymiser les éléments critiques pour vous.",
  "banner.pillAlert": "Protection active · politique org",
  "banner.pillFile": "Fichier analysé · politique org",
  "banner.pillBlock": "Envoi non autorisé par la politique",
  "banner.pillForce": "Anonymisation requise · politique",
  "banner.whyScore": "Pourquoi ce score ?",
  "banner.whyScoreBody":
    "Ce message obtient {score}/100 (niveau {level}) car : {detail}.",
  "banner.whyScoreEmpty": "Score {score}/100 selon les détections actives.",
  "banner.original": "Original",
  "banner.secure": "Sécurisé",
  "banner.changes": "Modifications",
  "banner.changesNone": "Aucun remplacement listé (heuristiques déjà appliquées).",
  "banner.adjust": "Ajuster",
  "banner.adjustEmpty": "Aucun remplacement à ajuster.",
  "banner.restore": "Restaurer",
  "banner.orgName": " Organisation : {name}.",
  "banner.impact": "Impact estimé : {level}",
  "banner.riskScore": "Risque {n}/100",
  "banner.riskScoreLabel": "Risk Score : {n}/100",
  "banner.sev.high": "{n} critique{s}",
  "banner.sev.medium": "{n} moyenne{s}",
  "banner.sev.low": "{n} faible{s}",
  "banner.items": "{n} élément{s}",
  "banner.sensitiveData": "données sensibles",
  "banner.detections": "détection(s)",
  "banner.fileConcerned": "Fichier concerné : « {file} »",
  "banner.fileShort": "Fichier : « {file} »",
  "banner.rec.critical":
    "Nous pouvons anonymiser ce message pour vous (Secure Rewrite fortement recommandé)",
  "banner.rec.high":
    "Nous pouvons anonymiser ce message pour vous (Secure Rewrite recommandé)",
  "banner.rec.medium": "Nous pouvons masquer ou Secure Rewrite avant envoi",
  "banner.rec.low": "Niveau de risque faible — une vérification manuelle suffit",
  "banner.rec.none": "Aucune détection",
  "banner.contactMsgTitle": "Message à l'administrateur",
  "banner.contactMsgHint":
    "Le bandeau d'alerte est masqué le temps de rédiger. Après envoi, les options reviendront.",
  "banner.contactSend": "Envoyer à l'admin",
  "banner.originalRisk": "Risque original : {n}/100",
  "banner.afterRewrite": "Après rewrite : {n}/100",
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
  "banner.riskLine": "We can anonymize the critical items for you.",
  "banner.pillAlert": "Protection active · org policy",
  "banner.pillFile": "File analyzed · org policy",
  "banner.pillBlock": "Send not allowed by policy",
  "banner.pillForce": "Anonymization required · policy",
  "banner.whyScore": "Why this score?",
  "banner.whyScoreBody":
    "This message scores {score}/100 (level {level}) because: {detail}.",
  "banner.whyScoreEmpty": "Score {score}/100 based on active detections.",
  "banner.original": "Original",
  "banner.secure": "Secured",
  "banner.changes": "Changes",
  "banner.changesNone": "No listed replacements (heuristics already applied).",
  "banner.adjust": "Adjust",
  "banner.adjustEmpty": "No replacements to adjust.",
  "banner.restore": "Restore",
  "banner.orgName": " Organization: {name}.",
  "banner.impact": "Estimated impact: {level}",
  "banner.riskScore": "Risk {n}/100",
  "banner.riskScoreLabel": "Risk level: {n}/100",
  "banner.sev.high": "{n} critical",
  "banner.sev.medium": "{n} medium",
  "banner.sev.low": "{n} low",
  "banner.items": "{n} item{s}",
  "banner.sensitiveData": "sensitive data",
  "banner.detections": "detection(s)",
  "banner.fileConcerned": "File concerned: “{file}”",
  "banner.fileShort": "File: “{file}”",
  "banner.rec.critical":
    "We can anonymize this message for you (Secure Rewrite strongly recommended)",
  "banner.rec.high":
    "We can anonymize this message for you (Secure Rewrite recommended)",
  "banner.rec.medium": "We can mask or Secure Rewrite before sending",
  "banner.rec.low": "Low risk level — a quick manual check is enough",
  "banner.rec.none": "No detections",
  "banner.contactMsgTitle": "Message to administrator",
  "banner.contactMsgHint":
    "The alert banner is hidden while you write. Options will return after send.",
  "banner.contactSend": "Send to admin",
  "banner.originalRisk": "Original risk: {n}/100",
  "banner.afterRewrite": "After rewrite: {n}/100",
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
      "OpsGate protège vos données selon la politique de sécurité de votre organisation.",
    alertTitle: "Certaines informations sensibles ont été détectées",
    alertBody:
      "Enable AI. Secure Data. — choisissez une action pour continuer en sécurité.",
    blockTitle: "Envoi non autorisé pour le moment",
    blockBody:
      "La politique de votre organisation empêche cet envoi. Contactez l'administrateur pour une exception si besoin.",
    maskForceTitle: "Anonymisation requise",
    maskForceBody:
      "Votre administrateur demande d'anonymiser les données sensibles avant tout envoi — nous pouvons le faire pour vous.",
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
    alertTitleFile: "Fichier : informations sensibles détectées",
    alertBodyFile:
      "Nous avons analysé le fichier avant envoi à l'IA. Choisissez une action pour continuer en sécurité."
  },
  en: {
    adminNotice:
      "OpsGate protects your data according to your organization's security policy.",
    alertTitle: "Some sensitive information was detected",
    alertBody:
      "Enable AI. Secure Data. — choose an action to continue safely.",
    blockTitle: "Sending is not allowed right now",
    blockBody:
      "Your organization's policy prevents this send. Contact your administrator if you need an exception.",
    maskForceTitle: "Anonymization required",
    maskForceBody:
      "Your administrator asks to anonymize sensitive data before any send — we can do that for you.",
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
    alertTitleFile: "File: sensitive information detected",
    alertBodyFile:
      "We analyzed the file before sending to AI. Choose an action to continue safely."
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
 * Si l’admin a customisé un champ, il prime — SAUF s’il s’agit du stock FR
 * renvoyé par l’API (DEFAULT_USER_MESSAGES) alors que l’agent est en EN :
 * dans ce cas on garde le défaut EN (évite « Cette restriction… » en anglais).
 */
export function mergeMessagesForLang(
  lang: AgentUiLang,
  partial?: Partial<import("~types").PolicyUserMessages> | null
): import("~types").PolicyUserMessages {
  const base = { ...DEFAULT_MESSAGES_BY_LANG[lang] }
  if (!partial || typeof partial !== "object") return base
  // Stock FR connus (API types + defaults i18n) — ne pas les coller sur l’UI EN
  const frStock = DEFAULT_MESSAGES_BY_LANG.fr
  for (const key of Object.keys(base) as (keyof typeof base)[]) {
    const v = partial[key]
    if (typeof v !== "string" || !v.trim()) continue
    const trimmed = v.trim()
    if (lang === "en") {
      const stockFr = frStock[key]
      if (stockFr && trimmed === stockFr.trim()) continue
      // Variante API DEFAULT_USER_MESSAGES (souvent un peu différente)
      if (
        key === "adminNotice" &&
        /cette restriction est appliquée/i.test(trimmed)
      ) {
        continue
      }
      if (
        key === "alertTitle" &&
        /données sensibles détectées/i.test(trimmed)
      ) {
        continue
      }
      if (
        key === "alertBody" &&
        /votre administrateur a configuré opsgate/i.test(trimmed)
      ) {
        continue
      }
      if (
        key === "blockTitle" &&
        /envoi non autorisé/i.test(trimmed)
      ) {
        continue
      }
      if (
        key === "blockBody" &&
        /politique de sécurité de votre organisation bloque/i.test(trimmed)
      ) {
        continue
      }
      if (
        key === "maskForceTitle" &&
        /masquage obligatoire/i.test(trimmed)
      ) {
        continue
      }
      if (
        key === "maskForceBody" &&
        /impose le masquage des données sensibles/i.test(trimmed)
      ) {
        continue
      }
    }
    base[key] = trimmed
  }
  return base
}
