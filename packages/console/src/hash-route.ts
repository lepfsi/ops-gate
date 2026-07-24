/**
 * Deep-links console OpsGate via hash (sans router lourd).
 *
 * Exemples :
 *   #/policy
 *   #/dashboard/licenses
 *   #/agents
 *   #/moving
 *   #/messages
 *   #/settings/mail
 *   #/settings/notifications
 *
 * Les fragments SSO (#opsgate_token=…, #opsgate_oidc_error=…) sont ignorés ici.
 */

export type ConsoleTab =
  | "summary"
  | "msp"
  | "policy"
  | "people"
  | "packs"
  | "agents"
  | "events"
  | "gateway"
  | "risk"
  | "shadow"
  | "audit"
  | "moving"
  | "settings"
  | "support"
  | "help"

/** Sous-onglets AI Security Gateway (roadmap) */
export type GatewaySection =
  | "governance"
  | "usage"
  | "data"
  | "compliance"
  | "intelligence"

export type DashSection =
  | "overview"
  | "licenses"
  | "connectivity"
  | "activity"
  | "rules"

export type SettingsSection =
  | "general"
  | "logs"
  | "license"
  | "notifications"
  | "monitoring"
  | "ldap"
  | "mail"
  | "reports"

export type ConsoleRoute = {
  tab: ConsoleTab
  dashSection?: DashSection
  settingsSection?: SettingsSection
  gatewaySection?: GatewaySection
}

const TABS = new Set<ConsoleTab>([
  "summary",
  "msp",
  "policy",
  "people",
  "packs",
  "agents",
  "events",
  "gateway",
  "risk",
  "shadow",
  "audit",
  "moving",
  "settings",
  "support",
  "help"
])

const GATEWAY = new Set<GatewaySection>([
  "governance",
  "usage",
  "data",
  "compliance",
  "intelligence"
])

const DASH = new Set<DashSection>([
  "overview",
  "licenses",
  "connectivity",
  "activity",
  "rules"
])

const SETTINGS = new Set<SettingsSection>([
  "general",
  "logs",
  "license",
  "notifications",
  "monitoring",
  "ldap",
  "mail",
  "reports"
])

/** Alias URL → tab canonique */
const TAB_ALIASES: Record<string, ConsoleTab> = {
  summary: "summary",
  dashboard: "summary",
  home: "summary",
  dash: "summary",
  policy: "policy",
  policies: "policy",
  people: "people",
  admins: "people",
  users: "people",
  packs: "packs",
  rules: "packs",
  agents: "agents",
  events: "events",
  gateway: "gateway",
  "ai-security": "gateway",
  "ai-gateway": "gateway",
  security: "gateway",
  risk: "risk",
  scores: "risk",
  shadow: "shadow",
  "shadow-ai": "shadow",
  audit: "audit",
  moving: "moving",
  "auto-rules": "moving",
  settings: "settings",
  params: "settings",
  parameters: "settings",
  support: "support",
  messages: "support",
  inbox: "support",
  msg: "support",
  help: "help"
}

const DASH_ALIASES: Record<string, DashSection> = {
  overview: "overview",
  home: "overview",
  licenses: "licenses",
  licence: "licenses",
  licencees: "licenses",
  connectivity: "connectivity",
  connection: "connectivity",
  offline: "connectivity",
  activity: "activity",
  decisions: "activity",
  rules: "rules",
  threats: "rules"
}

const SETTINGS_ALIASES: Record<string, SettingsSection> = {
  general: "general",
  logs: "logs",
  license: "license",
  licence: "license",
  notifications: "notifications",
  notif: "notifications",
  alerts: "notifications",
  monitoring: "monitoring",
  mon: "monitoring",
  ldap: "ldap",
  ad: "ldap",
  mail: "mail",
  smtp: "mail",
  email: "mail",
  reports: "reports",
  rapports: "reports"
}

/** Fragment réservé SSO / auth — ne pas traiter comme route */
export function isAuthFragment(raw: string): boolean {
  const h = (raw || "").replace(/^#/, "")
  return (
    h.includes("opsgate_token=") ||
    h.includes("opsgate_oidc_error=") ||
    h.includes("opsgate_oidc_")
  )
}

/**
 * Parse le hash courant.
 * Retourne null si vide, invalide ou fragment d’auth.
 */
export function parseConsoleHash(
  hash: string = typeof window !== "undefined" ? window.location.hash : ""
): ConsoleRoute | null {
  const raw = (hash || "").replace(/^#/, "").trim()
  if (!raw || isAuthFragment(raw)) return null

  // Accepte #/policy, #policy, #/dashboard/licenses
  const path = raw.replace(/^\//, "").split("?")[0].split("&")[0]
  if (!path) return { tab: "summary", dashSection: "overview" }

  const parts = path
    .split("/")
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean)
  if (parts.length === 0) return { tab: "summary", dashSection: "overview" }

  const tabKey = parts[0]
  const tab = TAB_ALIASES[tabKey]
  if (!tab || !TABS.has(tab)) return null

  if (tab === "summary") {
    const secKey = parts[1]
    const dashSection = secKey
      ? DASH_ALIASES[secKey] || (DASH.has(secKey as DashSection) ? (secKey as DashSection) : "overview")
      : "overview"
    return { tab, dashSection }
  }

  if (tab === "settings") {
    const secKey = parts[1]
    const settingsSection = secKey
      ? SETTINGS_ALIASES[secKey] ||
        (SETTINGS.has(secKey as SettingsSection)
          ? (secKey as SettingsSection)
          : "general")
      : "general"
    return { tab, settingsSection }
  }

  if (tab === "gateway") {
    const secKey = parts[1]
    const gatewaySection =
      secKey && GATEWAY.has(secKey as GatewaySection)
        ? (secKey as GatewaySection)
        : "governance"
    return { tab, gatewaySection }
  }

  return { tab }
}

/** Construit le hash (avec #) pour une route */
export function buildConsoleHash(route: ConsoleRoute): string {
  if (route.tab === "summary") {
    const sec = route.dashSection || "overview"
    if (sec === "overview") return "#/dashboard"
    return `#/dashboard/${sec}`
  }
  if (route.tab === "support") return "#/messages"
  if (route.tab === "settings") {
    const sec = route.settingsSection || "general"
    if (sec === "general") return "#/settings"
    return `#/settings/${sec}`
  }
  if (route.tab === "gateway") {
    const sec = route.gatewaySection || "governance"
    if (sec === "governance") return "#/gateway"
    return `#/gateway/${sec}`
  }
  return `#/${route.tab}`
}

/** Compare deux routes (évite rewrite hash inutile) */
export function routesEqual(a: ConsoleRoute, b: ConsoleRoute): boolean {
  if (a.tab !== b.tab) return false
  if (a.tab === "summary") {
    return (a.dashSection || "overview") === (b.dashSection || "overview")
  }
  if (a.tab === "settings") {
    return (
      (a.settingsSection || "general") === (b.settingsSection || "general")
    )
  }
  if (a.tab === "gateway") {
    return (
      (a.gatewaySection || "governance") === (b.gatewaySection || "governance")
    )
  }
  return true
}

/**
 * Écrit le hash sans polluer l’historique (replace) ou avec entrée (push).
 * Ne touche pas un fragment d’auth.
 */
export function writeConsoleHash(
  route: ConsoleRoute,
  mode: "replace" | "push" = "push"
): void {
  try {
    if (isAuthFragment(window.location.hash)) return
    const next = buildConsoleHash(route)
    const cur = window.location.hash || ""
    if (cur === next) return
    // Aussi égalité sémantique (ex. #/summary vs #/dashboard)
    const parsed = parseConsoleHash(cur)
    if (parsed && routesEqual(parsed, route)) return
    if (mode === "replace") {
      const url =
        window.location.pathname + window.location.search + next
      window.history.replaceState(null, "", url)
    } else {
      window.location.hash = next
    }
  } catch {
    /* ignore */
  }
}
