import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode
} from "react"
import { createPortal } from "react-dom"

import {
  api,
  getApiBase,
  getToken,
  normalizeEvent,
  setApiBase,
  setToken,
  type AdminPermission,
  type AdminRow,
  type AgentRow,
  type EventRow,
  type GroupRow,
  type NotificationChannel,
  type NotificationChannelKind,
  type PackListItem,
  type PolicyDoc,
  type ProfileRow,
  type Summary,
  type UserRow
} from "./api"
import { BrandMark } from "./BrandMark"
import {
  parseConsoleHash,
  routesEqual,
  writeConsoleHash,
  type ConsoleRoute,
  type ConsoleTab,
  type DashSection,
  type GatewaySection,
  type SettingsSection
} from "./hash-route"
import { AI_HOST_PRESETS, HostPicker } from "./HostPicker"
import { getStoredLang, makeT, setStoredLang, type Lang } from "./i18n"
import { GatewayView } from "./GatewayViews"
import { RiskView, ShadowAiView } from "./RiskShadowViews"
import {
  addWidget,
  availableWidgets,
  DASH_WIDGET_META,
  loadDashLayout,
  moveWidget,
  patchWidget,
  removeWidget,
  resetDashLayout,
  saveDashLayout,
  type DashWidgetId,
  type DashWidgetLayout
} from "./dash-layout"
import {
  COMMON_TIMEZONES,
  TIMEZONE_OPTIONS,
  applyOrgTimezoneToPrefs,
  formatDateTimeAny,
  formatDateTimeIso,
  loadDateTimePrefs,
  saveDateTimePrefs,
  useDateTimePrefs,
  type DateFormatPref,
  type DateTimePrefs,
  type TimeFormatPref
} from "./datetime-prefs"
import { LiveClock } from "./LiveClock"
import { MfaQr } from "./MfaQr"

type Tab = ConsoleTab

const IDLE_MS = 5 * 60 * 1000

const ALL_PERMS: AdminPermission[] = [
  "console_access",
  "unenroll_agents",
  "manage_admins",
  "manage_policies",
  "manage_users",
  "email_password_reset"
]

const PERM_LABELS: Record<AdminPermission, string> = {
  console_access: "Accès console",
  unenroll_agents: "Désenrôler agents",
  manage_admins: "Gérer admins",
  manage_policies: "Policies / packs",
  manage_users: "Users / groupes / sièges agents",
  email_password_reset: "Réinit. mdp par e-mail (self)"
}

function readInitialRoute(): ConsoleRoute {
  try {
    const fromHash = parseConsoleHash(window.location.hash)
    if (fromHash) return fromHash
  } catch {
    /* ignore */
  }
  try {
    const t = sessionStorage.getItem("opsgate_console_tab") as Tab | null
    if (
      t &&
      [
        "summary",
        "policy",
        "msp",
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
      ].includes(t)
    ) {
      return { tab: t }
    }
  } catch {
    /* ignore */
  }
  return { tab: "summary", dashSection: "overview" }
}

export default function App() {
  const [sessionAdmin, setSessionAdmin] = useState<AdminRow | null>(null)
  const [authChecking, setAuthChecking] = useState(true)
  const initialRoute = useMemo(() => readInitialRoute(), [])
  const [tab, setTab] = useState<Tab>(() => initialRoute.tab)
  /** Sous-section tableau de bord (une seule nav latérale) */
  const [dashSection, setDashSection] = useState<DashSection>(
    () => initialRoute.dashSection || "overview"
  )
  /** Sous-onglets AI Security Gateway */
  const [gatewaySection, setGatewaySection] = useState<GatewaySection>(
    () => initialRoute.gatewaySection || "governance"
  )
  /** Menu latéral AI Security : déroulé / replié au clic */
  const [gatewayNavOpen, setGatewayNavOpen] = useState(
    () => initialRoute.tab === "gateway"
  )
  /** Évite boucle hashchange ↔ setState */
  const applyingHash = useRef(false)
  /** Dashboard plein écran : topbar + nav masquées ; Échap pour sortir */
  const [dashExpanded, setDashExpanded] = useState(false)
  const [apiBase, setApiBaseState] = useState(getApiBase())
  const [health, setHealth] = useState<string>("…")
  const [error, setErrorRaw] = useState<string | null>(null)
  const [info, setInfoRaw] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [inboxUnread, setInboxUnread] = useState(0)
  /** Pop-up messages user non acknowledge (status open) */
  const [inboxAlertOpen, setInboxAlertOpen] = useState(false)
  const [inboxAlertMsgs, setInboxAlertMsgs] = useState<
    import("./api").InboxMessage[]
  >([])
  const [inboxAlertBusy, setInboxAlertBusy] = useState(false)
  /** IDs snooze session (« Plus tard ») — sans mark-read → autres admins voient encore le pop-up */
  const inboxSnoozedRef = useRef<Set<string>>(new Set())
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    try {
      return localStorage.getItem("opsgate_theme") === "dark" ? "dark" : "light"
    } catch {
      return "light"
    }
  })
  const [lang, setLang] = useState<Lang>(() => getStoredLang())
  const t = useMemo(() => makeT(lang), [lang])
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    try {
      document.documentElement.lang = lang
    } catch {
      /* ignore */
    }
  }, [lang])

  /** Plein écran dashboard : API Fullscreen + CSS (navs masquées) */
  useEffect(() => {
    const root = document.documentElement
    if (dashExpanded) {
      root.classList.add("dash-fs-active")
      document.body.classList.add("dash-fs-active")
      if (!document.fullscreenElement) {
        const req =
          root.requestFullscreen?.bind(root) ||
          // @ts-expect-error webkit prefix
          root.webkitRequestFullscreen?.bind(root)
        if (req) void Promise.resolve(req()).catch(() => {})
      }
    } else {
      root.classList.remove("dash-fs-active")
      document.body.classList.remove("dash-fs-active")
      if (document.fullscreenElement) {
        void document.exitFullscreen().catch(() => {})
      }
    }
    return () => {
      root.classList.remove("dash-fs-active")
      document.body.classList.remove("dash-fs-active")
    }
  }, [dashExpanded])

  useEffect(() => {
    const exitFs = () => setDashExpanded(false)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Esc") {
        exitFs()
      }
    }
    const onFsChange = () => {
      // Sortie plein écran navigateur (souvent via Échap) → quitter le mode
      if (!document.fullscreenElement) {
        setDashExpanded(false)
      }
    }
    document.addEventListener("keydown", onKey)
    document.addEventListener("fullscreenchange", onFsChange)
    document.addEventListener("webkitfullscreenchange", onFsChange)
    return () => {
      document.removeEventListener("keydown", onKey)
      document.removeEventListener("fullscreenchange", onFsChange)
      document.removeEventListener("webkitfullscreenchange", onFsChange)
    }
  }, [])

  const clearToast = useCallback(() => {
    setErrorRaw(null)
    setInfoRaw(null)
    if (toastTimer.current) {
      clearTimeout(toastTimer.current)
      toastTimer.current = null
    }
  }, [])

  const setError = useCallback(
    (e: string | null) => {
      setInfoRaw(null)
      setErrorRaw(e)
      if (toastTimer.current) clearTimeout(toastTimer.current)
      if (e) {
        toastTimer.current = setTimeout(() => setErrorRaw(null), 6000)
      }
    },
    []
  )
  const setInfo = useCallback((i: string | null) => {
    setErrorRaw(null)
    setInfoRaw(i)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    if (i) {
      toastTimer.current = setTimeout(() => setInfoRaw(null), 4500)
    }
  }, [])

  const [summary, setSummary] = useState<Summary | null>(null)
  /** Snapshot V3 pour widgets dashboard (Risk 7j + Shadow + Proxy) */
  const [dashV3, setDashV3] = useState<{
    risk: {
      average_score: number
      previous_average_score: number | null
      trend: string
      users_count: number
      high_risk_users: number
      medium_risk_users: number
      low_risk_users: number
      top_risk_users?: Array<{ label: string; score: number; trend: string }>
    } | null
    shadow: {
      total: number
      unauthorized: number
      authorized: number
      unknown: number
    } | null
    proxy: {
      enabled: boolean
      mode: "observe" | "enforce"
      agents: number
      online: number
      observe_events: number
      block_events: number
    } | null
  }>({ risk: null, shadow: null, proxy: null })
  const [packs, setPacks] = useState<PackListItem[]>([])
  const [activeVersion, setActiveVersion] = useState<string | undefined>()
  const [agents, setAgents] = useState<AgentRow[]>([])
  const [events, setEvents] = useState<EventRow[]>([])
  const [policy, setPolicy] = useState<PolicyDoc | null>(null)
  const [profiles, setProfiles] = useState<ProfileRow[]>([])
  const [admins, setAdmins] = useState<AdminRow[]>([])
  const [users, setUsers] = useState<UserRow[]>([])
  const [groups, setGroups] = useState<GroupRow[]>([])
  const [disableRuleId, setDisableRuleId] = useState("email-address")
  const [publishNotes, setPublishNotes] = useState("console publish")
  const [primaryEmail, setPrimaryEmail] = useState("")
  const [orgCode, setOrgCode] = useState("")
  const [orgName, setOrgName] = useState("")
  const [orgId, setOrgId] = useState("")
  const [accessibleOrgs, setAccessibleOrgs] = useState<
    Array<{
      org_id: string
      org_code: string
      name: string
      is_principal: boolean
      current: boolean
    }>
  >([])
  const [switchBusy, setSwitchBusy] = useState(false)
  /** Multi-tenant sans MFA → bannière + bascule bloquée */
  const [mfaRequiredMultiOrg, setMfaRequiredMultiOrg] = useState(false)
  const [mfaEnabled, setMfaEnabled] = useState(false)
  /** Modal code MFA à chaque bascule de tenant */
  const [switchMfa, setSwitchMfa] = useState<{
    orgId: string
    name: string
  } | null>(null)
  const [switchMfaCode, setSwitchMfaCode] = useState("")
  const [switchMfaErr, setSwitchMfaErr] = useState<string | null>(null)
  /** Demande de connexion concurrente (consentement 10 s) */
  const [sessionChallenge, setSessionChallenge] = useState<{
    challenge_id: string
    seconds_left: number
    requester_hint: string
  } | null>(null)
  const [sessionReadOnly, setSessionReadOnly] = useState(false)
  const [orgSoftDeleted, setOrgSoftDeleted] = useState(false)
  const [orgPurgeAt, setOrgPurgeAt] = useState<string | null>(null)
  const [gdprShellConfirm, setGdprShellConfirm] = useState("")

  const refreshHealth = useCallback(async () => {
    try {
      const h = await api.health()
      setHealth(
        h.ok ? `API OK · ${new Date(h.ts).toLocaleTimeString("fr-FR")}` : "API ?"
      )
    } catch {
      setHealth("API offline")
    }
  }, [])

  useEffect(() => {
    if (theme === "dark") {
      document.documentElement.setAttribute("data-theme", "dark")
    } else {
      document.documentElement.removeAttribute("data-theme")
    }
    localStorage.setItem("opsgate_theme", theme)
  }, [theme])

  useEffect(() => {
    void (async () => {
      // SSO OIDC callback : token en fragment #opsgate_token=…
      try {
        const raw = window.location.hash.replace(/^#/, "")
        if (raw && raw.includes("opsgate_token=")) {
          const params = new URLSearchParams(raw)
          const tok = params.get("opsgate_token")
          if (tok) {
            setToken(tok)
            // Nettoyer le hash (ne pas laisser le token dans l’historique)
            const clean =
              window.location.pathname + window.location.search
            window.history.replaceState(null, "", clean)
          }
        }
      } catch {
        /* ignore */
      }
      if (!getToken()) {
        setAuthChecking(false)
        return
      }
      try {
        const me = await api.me()
        setSessionAdmin(me.admin)
        if (me.admin?.is_principal && me.admin.email) setPrimaryEmail(me.admin.email)
        else if (me.org?.primary_email) setPrimaryEmail(me.org.primary_email)
        if (me.org?.org_code) setOrgCode(me.org.org_code)
        if (me.org?.name) setOrgName(me.org.name)
        if (me.org?.id) setOrgId(me.org.id)
        // Dropdown multi-tenant uniquement si l’API confirme multi_org + >1 org
        const orgs = me.accessible_orgs || []
        setAccessibleOrgs(
          me.multi_org === true && orgs.length > 1
            ? orgs
            : me.org
              ? [
                  {
                    org_id: me.org.id,
                    org_code: me.org.org_code,
                    name: me.org.name,
                    is_principal: !!me.admin?.is_principal,
                    current: true
                  }
                ]
              : []
        )
        setMfaRequiredMultiOrg(!!me.mfa_required_multi_org)
        setMfaEnabled(!!me.mfa_enabled)
        setSessionReadOnly(!!me.read_only)
        setOrgSoftDeleted(!!me.org_soft_deleted || !!me.org?.deleted_at)
        setOrgPurgeAt(me.org_purge_at || me.org?.delete_purge_at || null)
      } catch {
        setToken(null)
        setSessionAdmin(null)
        setOrgCode("")
        setOrgName("")
        setOrgId("")
        setAccessibleOrgs([])
        setMfaRequiredMultiOrg(false)
        setMfaEnabled(false)
        setSessionReadOnly(false)
        setOrgSoftDeleted(false)
        setOrgPurgeAt(null)
      } finally {
        setAuthChecking(false)
      }
    })()
  }, [])

  // Poll demande de prise de session (autre navigateur)
  useEffect(() => {
    if (!sessionAdmin || !getToken()) return
    let cancelled = false
    const poll = async () => {
      try {
        const r = await api.pendingSessionChallenge()
        if (cancelled) return
        if (r.challenge && r.challenge.status === "pending") {
          setSessionChallenge({
            challenge_id: r.challenge.challenge_id,
            seconds_left: r.challenge.seconds_left,
            requester_hint: r.challenge.requester_hint || ""
          })
        } else if (
          r.challenge &&
          (r.challenge.status === "timeout" ||
            r.challenge.status === "accepted" ||
            r.challenge.status === "claimed")
        ) {
          // Session prise / timeout → se déconnecter
          setSessionChallenge(null)
          try {
            await api.logout("manual")
          } catch {
            /* ignore */
          }
          setToken(null)
          setSessionAdmin(null)
          setInfo(t("login.challengeKicked"))
        } else {
          setSessionChallenge(null)
        }
      } catch {
        /* ignore */
      }
    }
    void poll()
    const id = setInterval(() => void poll(), 1500)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [sessionAdmin, t, setInfo])

  const applyTenantSession = useCallback(
    (r: {
      admin: AdminRow
      org: {
        id: string
        name: string
        org_code: string
        primary_email?: string
      } | null
      accessible_orgs?: typeof accessibleOrgs
      token?: string
    }) => {
      if (r.token) setToken(r.token)
      setSessionAdmin(r.admin)
      if (r.org) {
        setOrgId(r.org.id)
        setOrgCode(r.org.org_code || "")
        setOrgName(r.org.name || "")
        if (r.org.primary_email) setPrimaryEmail(r.org.primary_email)
      }
      if (r.accessible_orgs) {
        const orgs = r.accessible_orgs
        setAccessibleOrgs(
          orgs.length > 1
            ? orgs
            : r.org
              ? [
                  {
                    org_id: r.org.id,
                    org_code: r.org.org_code,
                    name: r.org.name,
                    is_principal: !!r.admin?.is_principal,
                    current: true
                  }
                ]
              : orgs
        )
      }
    },
    []
  )

  /** Même hauteur de vue pour tous les modules (contenu haut ; header rarement utile) */
  const scrollConsoleTop = useCallback(() => {
    requestAnimationFrame(() => {
      const el = document.querySelector(".shell-body") as HTMLElement | null
      if (el) {
        const y = el.getBoundingClientRect().top + window.scrollY - 6
        window.scrollTo({ top: Math.max(0, y), behavior: "smooth" })
      } else {
        window.scrollTo({ top: 0, behavior: "smooth" })
      }
    })
  }, [])

  const currentRoute = useCallback((): ConsoleRoute => {
    if (tab === "summary") {
      return { tab, dashSection }
    }
    if (tab === "settings") {
      // settingsTab vit dans SettingsView - on lit le hash ou general
      const h = parseConsoleHash(window.location.hash)
      return {
        tab,
        settingsSection: h?.settingsSection || "general"
      }
    }
    if (tab === "gateway") {
      return { tab, gatewaySection }
    }
    return { tab }
  }, [tab, dashSection, gatewaySection])

  const applyRoute = useCallback(
    (route: ConsoleRoute, opts?: { scroll?: boolean }) => {
      setTab(route.tab)
      try {
        sessionStorage.setItem("opsgate_console_tab", route.tab)
      } catch {
        /* ignore */
      }
      if (route.tab === "summary") {
        setDashSection(route.dashSection || "overview")
        setDashExpanded(false)
      } else {
        setDashExpanded(false)
      }
      if (route.tab === "gateway") {
        setGatewaySection(route.gatewaySection || "governance")
        setGatewayNavOpen(true)
      }
      if (route.tab === "settings" && route.settingsSection) {
        try {
          sessionStorage.setItem(
            "opsgate_console_settings_tab",
            route.settingsSection
          )
        } catch {
          /* ignore */
        }
        window.dispatchEvent(
          new CustomEvent("opsgate-settings-tab", {
            detail: route.settingsSection
          })
        )
      }
      if (opts?.scroll !== false) scrollConsoleTop()
    },
    [scrollConsoleTop]
  )

  const goTab = useCallback(
    (t: Tab) => {
      let settingsSection: SettingsSection | undefined
      if (t === "settings") {
        try {
          const s = sessionStorage.getItem(
            "opsgate_console_settings_tab"
          ) as SettingsSection | null
          settingsSection = s || "general"
        } catch {
          settingsSection = "general"
        }
      }
      const route: ConsoleRoute =
        t === "summary"
          ? { tab: t, dashSection: "overview" }
          : t === "settings"
            ? { tab: t, settingsSection }
            : t === "gateway"
              ? { tab: t, gatewaySection: "governance" }
              : { tab: t }
      applyRoute(route)
      writeConsoleHash(route, "push")
    },
    [applyRoute]
  )

  const goGatewaySection = useCallback(
    (id: GatewaySection) => {
      setGatewayNavOpen(true)
      const route: ConsoleRoute = { tab: "gateway", gatewaySection: id }
      applyRoute(route, { scroll: false })
      writeConsoleHash(route, "push")
    },
    [applyRoute]
  )

  /** Clic parent AI Security : ouvre les sous-onglets, reclic les referme */
  const onGatewayNavClick = useCallback(() => {
    if (tab === "gateway" && gatewayNavOpen) {
      setGatewayNavOpen(false)
      return
    }
    setGatewayNavOpen(true)
    goTab("gateway")
  }, [tab, gatewayNavOpen, goTab])

  // Quitter AI Security via un autre onglet → replier le sous-menu
  useEffect(() => {
    if (tab !== "gateway") setGatewayNavOpen(false)
  }, [tab])

  const goDashSection = useCallback(
    (id: DashSection) => {
      const route: ConsoleRoute = { tab: "summary", dashSection: id }
      applyRoute(route, { scroll: false })
      writeConsoleHash(route, "push")
      if (id === "overview" || id === "licenses" || id === "connectivity") {
        scrollConsoleTop()
        return
      }
      const elId = id === "activity" ? "dash-activity" : "dash-rules"
      setTimeout(() => {
        document
          .getElementById(elId)
          ?.scrollIntoView({ behavior: "smooth", block: "start" })
      }, 30)
    },
    [applyRoute, scrollConsoleTop]
  )

  // Sync état → hash (remplace l’URL pour partage / F5)
  useEffect(() => {
    if (applyingHash.current) return
    if (!sessionAdmin) return
    const route = currentRoute()
    writeConsoleHash(route, "replace")
    try {
      sessionStorage.setItem("opsgate_console_tab", tab)
    } catch {
      /* ignore */
    }
  }, [tab, dashSection, gatewaySection, sessionAdmin, currentRoute])

  // Back / forward / lien collé
  useEffect(() => {
    const onHash = () => {
      const route = parseConsoleHash(window.location.hash)
      if (!route) return
      applyingHash.current = true
      applyRoute(route)
      requestAnimationFrame(() => {
        applyingHash.current = false
      })
    }
    window.addEventListener("hashchange", onHash)
    return () => window.removeEventListener("hashchange", onHash)
  }, [applyRoute])

  // Au premier login : si hash présent, l’appliquer
  useEffect(() => {
    if (!sessionAdmin) return
    const route = parseConsoleHash(window.location.hash)
    if (route && !routesEqual(route, currentRoute())) {
      applyingHash.current = true
      applyRoute(route)
      requestAnimationFrame(() => {
        applyingHash.current = false
      })
    } else if (!parseConsoleHash(window.location.hash)) {
      writeConsoleHash(currentRoute(), "replace")
    }
    // une fois session prête
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionAdmin?.id])

  // Badge non-lus + pop-up messages user (poll fréquent — l’admin ne refresh pas)
  useEffect(() => {
    if (!sessionAdmin || !getToken()) {
      setInboxUnread(0)
      setInboxAlertMsgs([])
      setInboxAlertOpen(false)
      return
    }
    let cancelled = false
    const tick = async () => {
      try {
        const [countR, listR] = await Promise.all([
          api.inboxUnreadCount(),
          api.inboxList({ status: "open", limit: 30 })
        ])
        if (cancelled) return
        setInboxUnread(countR.unread || 0)
        const open = (listR.messages || []).filter(
          (m) => m.status === "open" && !inboxSnoozedRef.current.has(m.id)
        )
        setInboxAlertMsgs(open)
        if (open.length > 0) setInboxAlertOpen(true)
        else setInboxAlertOpen(false)
      } catch {
        /* ignore */
      }
    }
    void tick()
    // 12 s : réactivité admin sans saturer l’API
    const id = window.setInterval(() => void tick(), 12_000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [sessionAdmin])

  const summaryRef = useRef<Summary | null>(null)
  useEffect(() => {
    summaryRef.current = summary
  }, [summary])

  const loadTab = useCallback(async (t: Tab) => {
    if (!getToken()) return
    setError(null)
    // Soft refresh dashboard : garder l’UI affichée pendant le rechargement
    const softDash = t === "summary" && !!summaryRef.current
    if (!softDash) setBusy(true)
    try {
      if (t === "summary") {
        const [sum, riskRaw, shadowRaw, agentsRes, monRes] = await Promise.all([
          api.summary(),
          api.riskSummary("7d").catch(() => null),
          api.shadowAi({ period: "7d" }).catch(() => null),
          api.agents().catch(() => null),
          api.monitoring().catch(() => null)
        ])
        setSummary(sum)
        const r = riskRaw as Record<string, unknown> | null
        const s = shadowRaw as {
          counts?: {
            total?: number
            unauthorized?: number
            authorized?: number
            unknown?: number
          }
        } | null
        const mon = monRes?.monitoring
        const agentList = agentsRes?.agents || []
        const proxyAgents = agentList.filter(
          (a) =>
            a.device_type === "proxy" ||
            (a.app_version || "").toLowerCase().startsWith("proxy")
        )
        const onlineMs = mon?.onlineMs || 15 * 60 * 1000
        const proxyOnline = proxyAgents.filter((a) => {
          const last = a.last_seen_at ? Date.parse(a.last_seen_at) : 0
          return last && Date.now() - last <= onlineMs
        }).length
        const dec = sum.by_decision || {}
        setDashV3({
          risk: r
            ? {
                average_score: Number(r.average_score ?? 0),
                previous_average_score:
                  r.previous_average_score == null
                    ? null
                    : Number(r.previous_average_score),
                trend: String(r.trend || "flat"),
                users_count: Number(r.users_count ?? 0),
                high_risk_users: Number(r.high_risk_users ?? 0),
                medium_risk_users: Number(r.medium_risk_users ?? 0),
                low_risk_users: Number(r.low_risk_users ?? 0),
                top_risk_users: Array.isArray(r.top_risk_users)
                  ? (r.top_risk_users as Array<{
                      label: string
                      score: number
                      trend: string
                    }>).slice(0, 5)
                  : []
              }
            : null,
          shadow: s?.counts
            ? {
                total: s.counts.total ?? 0,
                unauthorized: s.counts.unauthorized ?? 0,
                authorized: s.counts.authorized ?? 0,
                unknown: s.counts.unknown ?? 0
              }
            : null,
          proxy: mon
            ? {
                enabled: mon.proxy?.enabled !== false,
                mode: mon.proxy?.mode === "observe" ? "observe" : "enforce",
                agents: proxyAgents.length,
                online: proxyOnline,
                observe_events: Number(dec.observe || 0),
                block_events: Number(dec.block || 0)
              }
            : {
                enabled: true,
                mode: "enforce",
                agents: proxyAgents.length,
                online: proxyOnline,
                observe_events: Number(dec.observe || 0),
                block_events: Number(dec.block || 0)
              }
        })
      } else if (t === "policy") {
        const [p, pr, g] = await Promise.all([
          api.policy(),
          api.profiles(),
          api.groups()
        ])
        setPolicy(p.policy)
        setProfiles(pr.profiles || [])
        setGroups(g.groups || [])
      } else if (t === "people") {
        const [ad, u, g, pr] = await Promise.all([
          api.admins(),
          api.users(),
          api.groups(),
          api.profiles()
        ])
        setAdmins(ad.admins || [])
        setPrimaryEmail(ad.primary_email || "")
        setUsers(u.users || [])
        setGroups(g.groups || [])
        setProfiles(pr.profiles || [])
      } else if (t === "packs") {
        const p = await api.packs()
        setPacks(p.packs || [])
        setActiveVersion(p.active_version)
      } else if (t === "agents") {
        const [a, pr, u, g] = await Promise.all([
          api.agents(),
          api.profiles(),
          api.users(),
          api.groups()
        ])
        setAgents(a.agents || [])
        setProfiles(pr.profiles || [])
        setUsers(u.users || [])
        setGroups(g.groups || [])
      } else if (t === "events") {
        const e = await api.events()
        const raw = (e.events || []) as unknown as Record<string, unknown>[]
        setEvents(raw.map((r) => normalizeEvent(r)))
        // retention meta stockée pour EventsView via sessionStorage léger
        if (e.retention) {
          sessionStorage.setItem(
            "opsgate_events_retention",
            JSON.stringify(e.retention)
          )
        }
      } else if (t === "audit" || t === "moving") {
        const g = await api.groups()
        setGroups(g.groups || [])
      }
    } catch (e) {
      const msg = String(e)
      setError(msg)
      if (msg.includes("unauthorized") || msg.includes("session_invalid")) {
        setToken(null)
        setSessionAdmin(null)
      }
    } finally {
      setBusy(false)
    }
  }, [])

  const goMfaSettings = useCallback(() => {
    const route: ConsoleRoute = {
      tab: "settings",
      settingsSection: "general"
    }
    applyRoute(route)
    writeConsoleHash(route, "push")
  }, [applyRoute])

  /** Multi-tenant : ouvre le modal MFA (code 6 chiffres) avant bascule. */
  const switchTenant = useCallback(
    (targetOrgId: string) => {
      if (!targetOrgId || targetOrgId === orgId) return
      setError(null)
      if (accessibleOrgs.length > 1) {
        if (mfaRequiredMultiOrg || !mfaEnabled) {
          setError(t("msp.mfaSetupRequired"))
          goMfaSettings()
          return
        }
        const target = accessibleOrgs.find((o) => o.org_id === targetOrgId)
        setSwitchMfa({
          orgId: targetOrgId,
          name: target?.name || target?.org_code || targetOrgId
        })
        setSwitchMfaCode("")
        setSwitchMfaErr(null)
        return
      }
      // Mono-tenant : bascule directe (ne devrait pas apparaître en UI)
      void (async () => {
        setSwitchBusy(true)
        try {
          const r = await api.switchOrg(targetOrgId, { force: true })
          applyTenantSession(r)
          setInfo(
            t("msp.switched", {
              name: r.org?.name || r.org?.org_code || targetOrgId
            })
          )
          await loadTab(tab)
          void refreshHealth()
        } catch (e) {
          setError(String(e))
        } finally {
          setSwitchBusy(false)
        }
      })()
    },
    [
      orgId,
      accessibleOrgs,
      mfaRequiredMultiOrg,
      mfaEnabled,
      tab,
      applyTenantSession,
      loadTab,
      refreshHealth,
      goMfaSettings,
      t
    ]
  )

  const confirmSwitchWithMfa = useCallback(async () => {
    if (!switchMfa) return
    const code = switchMfaCode.replace(/\D/g, "").slice(0, 6)
    if (code.length !== 6) {
      setSwitchMfaErr(t("msp.mfaCodeHint"))
      return
    }
    setSwitchBusy(true)
    setSwitchMfaErr(null)
    setError(null)
    try {
      const r = await api.switchOrg(switchMfa.orgId, {
        force: true,
        totp_code: code
      })
      applyTenantSession(r)
      setSwitchMfa(null)
      setSwitchMfaCode("")
      setInfo(
        t("msp.switched", {
          name: r.org?.name || r.org?.org_code || switchMfa.orgId
        })
      )
      await loadTab(tab)
      void refreshHealth()
    } catch (e) {
      const err = e as Error & { code?: string }
      if (err.code === "mfa_setup_required_multi_org") {
        setSwitchMfa(null)
        setMfaRequiredMultiOrg(true)
        setMfaEnabled(false)
        setError(err.message || t("msp.mfaSetupRequired"))
        goMfaSettings()
      } else if (err.code === "mfa_invalid") {
        setSwitchMfaErr(err.message || t("msp.mfaInvalid"))
      } else if (err.code === "mfa_required") {
        setSwitchMfaErr(err.message || t("msp.mfaRequired"))
      } else {
        setSwitchMfaErr(String(e))
      }
    } finally {
      setSwitchBusy(false)
    }
  }, [
    switchMfa,
    switchMfaCode,
    tab,
    applyTenantSession,
    loadTab,
    refreshHealth,
    goMfaSettings,
    t
  ])

  useEffect(() => {
    if (!sessionAdmin) return
    void refreshHealth()
    void loadTab(tab)
    const id = setInterval(() => void refreshHealth(), 15000)
    return () => clearInterval(id)
  }, [tab, loadTab, refreshHealth, sessionAdmin])

  // Déconnexion auto après 5 min d’inactivité
  useEffect(() => {
    if (!sessionAdmin) return
    let timer: ReturnType<typeof setTimeout>
    const arm = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        void (async () => {
          try {
            await api.logout("idle")
          } catch {
            /* ignore */
          }
          setToken(null)
          setSessionAdmin(null)
          setInfo("Session expirée (5 min d’inactivité)")
        })()
      }, IDLE_MS)
    }
    const evs = ["mousemove", "keydown", "click", "scroll", "touchstart"] as const
    for (const e of evs) window.addEventListener(e, arm, { passive: true })
    arm()
    return () => {
      clearTimeout(timer)
      for (const e of evs) window.removeEventListener(e, arm)
    }
  }, [sessionAdmin])

  const saveApi = () => {
    setApiBase(apiBase)
    setInfo(`API base = ${getApiBase()}`)
    void refreshHealth()
    if (sessionAdmin) void loadTab(tab)
  }

  if (authChecking) {
    return (
      <div className="login-shell">
        <p className="muted">Vérification session…</p>
      </div>
    )
  }

  if (!sessionAdmin) {
    return (
      <LoginScreen
        apiBase={apiBase}
        setApiBaseState={setApiBaseState}
        onSaveApi={saveApi}
        health={health}
        t={t}
        onLoggedIn={async (admin) => {
          setSessionAdmin(admin)
          try {
            const me = await api.me()
            if (me.admin?.is_principal && me.admin.email) setPrimaryEmail(me.admin.email)
            else if (me.org?.primary_email) setPrimaryEmail(me.org.primary_email)
            if (me.org?.org_code) setOrgCode(me.org.org_code)
            if (me.org?.name) setOrgName(me.org.name)
            if (me.org?.id) setOrgId(me.org.id)
            const orgs = me.accessible_orgs || []
            setAccessibleOrgs(
              me.multi_org === true && orgs.length > 1
                ? orgs
                : me.org
                  ? [
                      {
                        org_id: me.org.id,
                        org_code: me.org.org_code,
                        name: me.org.name,
                        is_principal: !!me.admin?.is_principal,
                        current: true
                      }
                    ]
                  : []
            )
            setMfaRequiredMultiOrg(!!me.mfa_required_multi_org)
            setMfaEnabled(!!me.mfa_enabled)
            setSessionReadOnly(!!me.read_only)
          } catch {
            /* ignore */
          }
          setInfo(admin.must_change_password ? null : "Connecté")
        }}
      />
    )
  }

  /** Mode org soft-deleted : écran restore uniquement */
  if (orgSoftDeleted) {
    return (
      <div className="login-shell">
        <div className="card" style={{ maxWidth: 480, margin: "40px auto" }}>
          <BrandMark size={40} />
          <h2 style={{ marginTop: 12 }}>{t("gdpr.shellTitle")}</h2>
          <p className="muted" style={{ fontSize: 13 }}>
            {t("gdpr.shellHint")}
          </p>
          {orgPurgeAt && (
            <p style={{ fontSize: 13 }}>
              {t("gdpr.purgeAt")}:{" "}
              <strong className="mono">{String(orgPurgeAt).slice(0, 19)}</strong>
            </p>
          )}
          {error && <p className="error">{error}</p>}
          {info && <p className="ok">{info}</p>}
          <label className="field-label">{t("gdpr.restoreConfirm")}</label>
          <input
            className="input mono"
            value={gdprShellConfirm}
            onChange={(e) => setGdprShellConfirm(e.target.value)}
            placeholder="RESTORE MY ORG"
          />
          <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn"
              disabled={busy || gdprShellConfirm.trim() !== "RESTORE MY ORG"}
              onClick={async () => {
                setBusy(true)
                setError(null)
                try {
                  await api.gdprRestore(gdprShellConfirm.trim())
                  setOrgSoftDeleted(false)
                  setOrgPurgeAt(null)
                  setGdprShellConfirm("")
                  setInfo(t("gdpr.restored"))
                  window.location.reload()
                } catch (e) {
                  setError(String(e))
                } finally {
                  setBusy(false)
                }
              }}>
              {t("gdpr.restore")}
            </button>
            <button
              type="button"
              className="btn secondary"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                try {
                  const r = await api.gdprExport()
                  const blob = new Blob([JSON.stringify(r.export, null, 2)], {
                    type: "application/json"
                  })
                  const a = document.createElement("a")
                  a.href = URL.createObjectURL(blob)
                  a.download = `opsgate-gdpr-export-${orgCode || "org"}.json`
                  a.click()
                  URL.revokeObjectURL(a.href)
                  setInfo(t("gdpr.exported"))
                } catch (e) {
                  setError(String(e))
                } finally {
                  setBusy(false)
                }
              }}>
              {t("gdpr.export")}
            </button>
            <button
              type="button"
              className="btn secondary"
              onClick={async () => {
                try {
                  await api.logout()
                } catch {
                  /* ignore */
                }
                setToken(null)
                setSessionAdmin(null)
                setOrgSoftDeleted(false)
              }}>
              {t("nav.logout") || "Logout"}
            </button>
          </div>
        </div>
      </div>
    )
  }

  /** Popup 1ʳᵉ connexion (principal setup OU secondaire après reset) */
  const forcePwd = !!sessionAdmin.must_change_password

  const onPublish = async () => {
    setBusy(true)
    setError(null)
    setInfo(null)
    try {
      const ids = disableRuleId
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
      const res = await api.publishPack({
        notes: publishNotes,
        disable_rule_ids: ids.length ? ids : undefined,
        activate: true
      })
      setInfo(
        ids.length
          ? `Pack ${res.version} : ${res.rules_count} règles actives  -  désactivées : ${ids.join(", ")} (voir Audit → rule_disable)`
          : `Publié & activé ${res.version} (${res.rules_count} règles)`
      )
      await loadTab("packs")
      if (tab === "summary") await loadTab("summary")
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  const onActivate = async (version: string) => {
    setBusy(true)
    setError(null)
    setInfo(null)
    try {
      await api.activatePack(version)
      setInfo(`Pack ${version} activé`)
      await loadTab("packs")
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className={`app-shell${
        dashExpanded ? " app-shell--dash-fullscreen" : ""
      }`}>
      {forcePwd && (
        <ForcePasswordModal
          onDone={async () => {
            try {
              const me = await api.me()
              setSessionAdmin(me.admin)
              setInfo("Mot de passe Administrator mis à jour")
            } catch {
              setSessionAdmin({ ...sessionAdmin, must_change_password: false })
            }
          }}
        />
      )}
      {switchMfa && (
        <SwitchOrgMfaModal
          orgName={switchMfa.name}
          code={switchMfaCode}
          setCode={setSwitchMfaCode}
          err={switchMfaErr}
          busy={switchBusy}
          t={t}
          onCancel={() => {
            setSwitchMfa(null)
            setSwitchMfaCode("")
            setSwitchMfaErr(null)
          }}
          onConfirm={() => void confirmSwitchWithMfa()}
        />
      )}
      {sessionChallenge && (
        <SessionTakeoverModal
          challenge={sessionChallenge}
          t={t}
          onAccept={async () => {
            try {
              await api.respondSessionChallenge(
                sessionChallenge.challenge_id,
                "accept"
              )
              try {
                await api.logout("manual")
              } catch {
                /* ignore */
              }
              setToken(null)
              setSessionAdmin(null)
              setSessionChallenge(null)
              setInfo(t("login.challengeAcceptedLocal"))
            } catch (e) {
              setError(String(e))
            }
          }}
          onRefuse={async () => {
            try {
              await api.respondSessionChallenge(
                sessionChallenge.challenge_id,
                "refuse"
              )
              setSessionChallenge(null)
              setInfo(t("login.challengeRefusedLocal"))
            } catch (e) {
              setError(String(e))
            }
          }}
        />
      )}
      {!dashExpanded && (
      <header className="topbar">
        <div className="brand">
          <BrandMark size={36} />
          <div className="brand-text">
            <h1>OpsGate</h1>
            {/* Une seule org : nom/code statique. Dropdown uniquement si multi_org réel. */}
            {(orgName || orgCode) && (
              <div className="topbar-org-line">
                {accessibleOrgs.length > 1 ? (
                  <select
                    className="input topbar-org-select"
                    disabled={switchBusy || busy || !!switchMfa}
                    value={orgId}
                    onChange={(e) => switchTenant(e.target.value)}
                    title={t("msp.switchHint")}
                    aria-label={t("msp.org")}>
                    {accessibleOrgs.map((o) => (
                      <option key={o.org_id} value={o.org_id}>
                        {o.name}
                        {o.org_code ? ` (${o.org_code})` : ""}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span
                    className="topbar-org-static mono"
                    title={orgName || orgCode}>
                    {orgName || orgCode}
                    {orgName && orgCode ? ` · ${orgCode}` : ""}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="topbar-actions">
          <LiveClock className="topbar-clock mono" />
          <div className="topbar-api-group" title={health}>
            <span
              className={`api-status ${health.startsWith("API OK") ? "ok" : "bad"}`}>
              API
            </span>
            <input
              className="input topbar-api-input"
              value={apiBase}
              onChange={(e) => setApiBaseState(e.target.value)}
              onBlur={saveApi}
              placeholder="http://127.0.0.1:8787"
              title={apiBase}
            />
          </div>
          <button
            className="btn secondary btn-sm"
            type="button"
            disabled={busy}
            title={t("top.refresh")}
            onClick={() => {
              void refreshHealth()
              void loadTab(tab)
            }}>
            {t("dash.refresh")}
          </button>
          {tab === "summary" && (
            <>
              <button
                className="btn secondary btn-sm"
                type="button"
                title={t("dash.expand")}
                onClick={() => setDashExpanded(true)}>
                {t("dash.expand")}
              </button>
              <button
                className="btn btn-sm"
                type="button"
                disabled={busy}
                title={t("dash.forceSync")}
                onClick={async () => {
                  setBusy(true)
                  setError(null)
                  setInfo(null)
                  try {
                    const r = await api.forceSync()
                    setInfo(
                      `Force-sync epoch=${r.config_epoch} · ${r.agents} agent(s)`
                    )
                  } catch (e) {
                    setError(String(e))
                  } finally {
                    setBusy(false)
                  }
                }}>
                {t("dash.forceSync")}
              </button>
            </>
          )}
          <button
            className="btn secondary btn-sm"
            type="button"
            title="Clair / sombre"
            onClick={() => setTheme((th) => (th === "dark" ? "light" : "dark"))}>
            {theme === "dark" ? "☀" : "☾"}
          </button>
          <button
            className="btn secondary btn-sm"
            type="button"
            title={`${sessionAdmin.email}${sessionAdmin.is_principal ? " · Principal" : ""}`}
            onClick={async () => {
              try {
                await api.logout("manual")
              } catch {
                /* ignore */
              }
              setToken(null)
              setSessionAdmin(null)
            }}>
            {t("top.logout")}
          </button>
        </div>
      </header>
      )}

      {(error || info) && (
        <div
          className={`toast-stack ${error ? "toast-err" : "toast-ok"}`}
          role="status">
          <span>{error || info}</span>
          <button
            type="button"
            className="toast-dismiss"
            aria-label="Fermer"
            onClick={clearToast}>
            ×
          </button>
        </div>
      )}

      {mfaRequiredMultiOrg && !dashExpanded && (
        <div className="mfa-multi-banner" role="alert">
          <span>{t("msp.mfaBanner")}</span>
          <button
            type="button"
            className="btn btn-sm"
            onClick={goMfaSettings}>
            {t("msp.mfaBannerCta")}
          </button>
        </div>
      )}
      {sessionReadOnly && !dashExpanded && (
        <div className="readonly-banner" role="status">
          <span>{t("login.readOnlyBanner")}</span>
        </div>
      )}

      <div className="shell-body">
      {!dashExpanded && (
      <nav className="shell-nav" aria-label="Navigation principale">
        <div className="shell-nav-brand">
          <BrandMark size={28} />
          <div className="shell-nav-brand-text">
            <strong>OpsGate</strong>
            <span>Console</span>
          </div>
        </div>
        <div className="shell-nav-scroll">
        <button
          type="button"
          className={`shell-nav-item ${tab === "summary" ? "active" : ""}`}
          onClick={() => goTab("summary")}>
          {t("nav.dashboard")}
        </button>
        {accessibleOrgs.length > 1 && (
          <button
            type="button"
            className={`shell-nav-item ${tab === "msp" ? "active" : ""}`}
            onClick={() => goTab("msp")}>
            {t("nav.msp")}
          </button>
        )}
        <button
          type="button"
          className={`shell-nav-item ${tab === "policy" ? "active" : ""}`}
          onClick={() => goTab("policy")}>
          {t("nav.policy")}
        </button>
        <button
          type="button"
          className={`shell-nav-item ${tab === "people" ? "active" : ""}`}
          onClick={() => goTab("people")}>
          {t("nav.people")}
        </button>
        <button
          type="button"
          className={`shell-nav-item ${tab === "packs" ? "active" : ""}`}
          onClick={() => goTab("packs")}>
          {t("nav.packs")}
        </button>
        <button
          type="button"
          className={`shell-nav-item ${tab === "agents" || tab === "moving" ? "active" : ""}`}
          onClick={() => goTab("agents")}>
          {t("nav.agents")}
        </button>
        {(tab === "agents" || tab === "moving") && (
          <button
            type="button"
            className={`shell-nav-sub ${tab === "moving" ? "active" : ""}`}
            onClick={() => goTab("moving")}>
            {t("nav.moving")}
          </button>
        )}
        <button
          type="button"
          className={`shell-nav-item ${tab === "events" ? "active" : ""}`}
          onClick={() => goTab("events")}>
          {t("nav.events")}
        </button>
        <button
          type="button"
          className={`shell-nav-item ${tab === "gateway" ? "active" : ""} ${
            gatewayNavOpen && tab === "gateway" ? "open" : ""
          }`}
          aria-expanded={gatewayNavOpen && tab === "gateway"}
          onClick={onGatewayNavClick}>
          <span className="shell-nav-item-row">
            <span>{t("nav.gateway")}</span>
            <span
              className={`shell-nav-caret ${
                gatewayNavOpen && tab === "gateway" ? "is-open" : ""
              }`}
              aria-hidden>
              ▾
            </span>
          </span>
        </button>
        {gatewayNavOpen && (
          <div className="shell-nav-subgroup" role="group" aria-label={t("nav.gateway")}>
            <button
              type="button"
              className={`shell-nav-sub ${
                tab === "gateway" && gatewaySection === "governance"
                  ? "active"
                  : ""
              }`}
              onClick={() => goGatewaySection("governance")}>
              {t("gw.section.governance")}
            </button>
            <button
              type="button"
              className={`shell-nav-sub ${
                tab === "gateway" && gatewaySection === "usage" ? "active" : ""
              }`}
              onClick={() => goGatewaySection("usage")}>
              {t("gw.section.usage")}
            </button>
            <button
              type="button"
              className={`shell-nav-sub ${
                tab === "gateway" && gatewaySection === "data" ? "active" : ""
              }`}
              onClick={() => goGatewaySection("data")}>
              {t("gw.section.data")}
            </button>
            <button
              type="button"
              className={`shell-nav-sub ${
                tab === "gateway" && gatewaySection === "compliance"
                  ? "active"
                  : ""
              }`}
              onClick={() => goGatewaySection("compliance")}>
              {t("gw.section.compliance")}
            </button>
            <button
              type="button"
              className={`shell-nav-sub ${
                tab === "gateway" && gatewaySection === "intelligence"
                  ? "active"
                  : ""
              }`}
              onClick={() => goGatewaySection("intelligence")}>
              {t("gw.section.intelligence")}
            </button>
          </div>
        )}
        <button
          type="button"
          className={`shell-nav-item ${tab === "risk" ? "active" : ""}`}
          onClick={() => goTab("risk")}>
          {t("nav.risk")}
        </button>
        <button
          type="button"
          className={`shell-nav-item ${tab === "shadow" ? "active" : ""}`}
          onClick={() => goTab("shadow")}>
          {t("nav.shadow")}
        </button>
        <button
          type="button"
          className={`shell-nav-item ${tab === "audit" ? "active" : ""}`}
          onClick={() => goTab("audit")}>
          {t("nav.audit")}
        </button>
        <button
          type="button"
          className={`shell-nav-item ${tab === "settings" ? "active" : ""}`}
          onClick={() => goTab("settings")}>
          {t("nav.settings")}
        </button>
        </div>
        <div className="shell-nav-foot">
          <button
            type="button"
            className={`shell-nav-item ${tab === "support" ? "active" : ""}`}
            onClick={() => goTab("support")}>
            {t("nav.support")}
            {inboxUnread > 0 && (
              <span
                style={{
                  marginLeft: 6,
                  display: "inline-block",
                  minWidth: 18,
                  padding: "0 6px",
                  borderRadius: 999,
                  background: "#0f766e",
                  color: "#fff",
                  fontSize: 11,
                  fontWeight: 700,
                  lineHeight: "18px",
                  textAlign: "center"
                }}>
                {inboxUnread > 99 ? "99+" : inboxUnread}
              </span>
            )}
          </button>
          <button
            type="button"
            className={`shell-nav-item ${tab === "help" ? "active" : ""}`}
            onClick={() => goTab("help")}>
            {t("nav.help")}
          </button>
        </div>
      </nav>
      )}

      <main
        className={`shell-main${
          tab === "summary" && dashExpanded ? " shell-main--dash-expanded" : ""
        }`}>
      {busy &&
        tab !== "packs" &&
        tab !== "policy" &&
        /* Dashboard : ne pas flash « chargement » si données déjà en cache */
        !(tab === "summary" && summary) &&
        !dashExpanded && (
        <p className="muted">{t("common.loading")}</p>
      )}

      {tab === "summary" && (
        <SummaryView
          summary={summary}
          dashV3={dashV3}
          inboxUnread={inboxUnread}
          busy={busy}
          dashSection={dashSection}
          setDashSection={setDashSection}
          dashExpanded={dashExpanded}
          setDashExpanded={setDashExpanded}
          t={t}
          onRefresh={() => void loadTab("summary")}
          onGoRisk={() => goTab("risk")}
          onGoShadow={() => goTab("shadow")}
          onGoInbox={() => goTab("support")}
          onGoEventsProxy={() => {
            try {
              sessionStorage.setItem("opsgate_events_preset", "proxy")
            } catch {
              /* ignore */
            }
            goTab("events")
          }}
          onGoProxySettings={() => {
            try {
              sessionStorage.setItem(
                "opsgate_console_settings_tab",
                "monitoring"
              )
            } catch {
              /* ignore */
            }
            goTab("settings")
            window.dispatchEvent(
              new CustomEvent("opsgate-settings-tab", {
                detail: "monitoring"
              })
            )
          }}
          onForceSync={async () => {
            setBusy(true)
            setError(null)
            setInfo(null)
            try {
              const r = await api.forceSync()
              setInfo(
                `Force-sync epoch=${r.config_epoch} · ${r.agents} agent(s) · appliqué sous ~2 min`
              )
            } catch (e) {
              setError(String(e))
            } finally {
              setBusy(false)
            }
          }}
          onForceSyncAgent={async (agentId, offlineMs) => {
            setError(null)
            setInfo(null)
            // Offline = échec : l’agent ne poll pas, forcer l’epoch ne sert à rien maintenant
            if (offlineMs > 15 * 60 * 1000) {
              setError(
                `Force sync échoué  -  agent hors-ligne depuis ${Math.round(offlineMs / 60000)} min. ` +
                  `Il doit être online (dernier sync < 15 min) pour recevoir la config (poll ≤2 min).`
              )
              return
            }
            setBusy(true)
            try {
              const r = await api.forceSync()
              setInfo(
                `Force-sync OK · epoch=${r.config_epoch} · agent ${agentId.slice(0, 10)}… (prise d’effet ≤2 min)`
              )
            } catch (e) {
              setError(String(e))
            } finally {
              setBusy(false)
            }
          }}
          onRevokeAgent={async (id) => {
            if (!confirm(`Révoquer l’agent ${id.slice(0, 12)}… ?`)) return
            setBusy(true)
            setError(null)
            try {
              await api.revokeAgent(id)
              setInfo("Agent révoqué")
              await loadTab("summary")
              await loadTab("agents")
            } catch (e) {
              setError(String(e))
            } finally {
              setBusy(false)
            }
          }}
          onMerged={() => void loadTab("summary")}
          setError={setError}
          setInfo={setInfo}
          setBusy={setBusy}
        />
      )}

      {tab === "policy" && (
        <PolicyView
          policy={policy}
          profiles={profiles}
          groups={groups}
          busy={busy}
          onReload={() => void loadTab("policy")}
          setBusy={setBusy}
          setError={setError}
          setInfo={setInfo}
          t={t}
        />
      )}

      {tab === "people" && (
        <PeopleView
          sessionAdmin={sessionAdmin}
          admins={admins}
          users={users}
          groups={groups}
          profiles={profiles}
          busy={busy}
          onReload={() => void loadTab("people")}
          setBusy={setBusy}
          setError={setError}
          setInfo={setInfo}
          t={t}
        />
      )}

      {tab === "packs" && (
        <PacksView
          packs={packs}
          activeVersion={activeVersion}
          busy={busy}
          disableRuleId={disableRuleId}
          publishNotes={publishNotes}
          onDisableRuleId={setDisableRuleId}
          onPublishNotes={setPublishNotes}
          onPublish={onPublish}
          onActivate={onActivate}
          onDelete={async (version) => {
            setBusy(true)
            setError(null)
            try {
              await api.deletePack(version)
              setInfo(`Pack ${version} supprime`)
              await loadTab("packs")
            } catch (e) {
              setError(String(e))
            } finally {
              setBusy(false)
            }
          }}
        />
      )}
      {tab === "agents" && (
        <AgentsView
          agents={agents}
          profiles={profiles}
          users={users}
          groups={groups}
          busy={busy}
          setBusy={setBusy}
          setError={setError}
          setInfo={setInfo}
          onReload={() => void loadTab("agents")}
          onRevoke={async (id) => {
            setBusy(true)
            setError(null)
            setInfo(null)
            try {
              const r = (await api.revokeAgent(id)) as {
                message?: string
              }
              setInfo(
                r?.message ||
                  `Agent ${id} révoqué  -  l’extension repasse en local_only au prochain sync (≤ 2 min), sans mot de passe local.`
              )
              await loadTab("agents")
              await loadTab("summary")
              await loadTab("events")
            } catch (e) {
              setError(String(e))
            } finally {
              setBusy(false)
            }
          }}
          onAssign={async (agentId, profileId) => {
            setBusy(true)
            setError(null)
            setInfo(null)
            try {
              await api.assignAgentProfile(agentId, profileId)
              setInfo("Profil assigné  -  force-sync déclenché pour les agents")
              await loadTab("agents")
            } catch (e) {
              setError(String(e))
            } finally {
              setBusy(false)
            }
          }}
          onAssignUser={async (agentId, userId) => {
            setBusy(true)
            setError(null)
            setInfo(null)
            try {
              await api.assignAgentUser(agentId, userId)
              setInfo("Utilisateur lié  -  policy via groupes au prochain sync")
              await loadTab("agents")
            } catch (e) {
              setError(String(e))
            } finally {
              setBusy(false)
            }
          }}
        />
      )}
      {tab === "events" && (
        <EventsView
          events={events}
          setError={setError}
          setInfo={setInfo}
          t={t}
        />
      )}
      {tab === "gateway" && (
        <GatewayView
          t={t}
          setError={setError}
          setInfo={setInfo}
          section={gatewaySection}
          setSection={goGatewaySection}
          onOpenShadow={() => goTab("shadow")}
          onOpenRisk={() => goTab("risk")}
          onOpenEvents={() => goTab("events")}
          onOpenAudit={() => goTab("audit")}
          onOpenReports={() => {
            try {
              sessionStorage.setItem(
                "opsgate_console_settings_tab",
                "reports"
              )
            } catch {
              /* ignore */
            }
            goTab("settings")
            window.dispatchEvent(
              new CustomEvent("opsgate-settings-tab", {
                detail: "reports"
              })
            )
          }}
        />
      )}
      {tab === "risk" && (
        <RiskView t={t} setError={setError} setInfo={setInfo} />
      )}
      {tab === "shadow" && (
        <ShadowAiView t={t} setError={setError} setInfo={setInfo} />
      )}
      {tab === "moving" && (
        <MovingRulesView
          groups={groups}
          setBusy={setBusy}
          setError={setError}
          setInfo={setInfo}
          busy={busy}
        />
      )}
      {tab === "msp" && accessibleOrgs.length > 1 && (
        <MspPortfolioView
          currentOrgId={orgId}
          t={t}
          onSwitch={(id) => switchTenant(id)}
          switchBusy={switchBusy}
        />
      )}
      {tab === "audit" && sessionAdmin && (
        <AuditView isPrincipal={!!sessionAdmin.is_principal} t={t} />
      )}
      {tab === "settings" && (
        <SystemSettingsView
          busy={busy}
          setBusy={setBusy}
          setError={setError}
          setInfo={setInfo}
          orgCode={orgCode}
          orgName={orgName}
          primaryEmail={primaryEmail}
          lang={lang}
          setLang={(l) => {
            setLang(l)
            setStoredLang(l)
          }}
          multiOrg={accessibleOrgs.length > 1}
          onMfaChange={(enabled) => {
            setMfaEnabled(enabled)
            setMfaRequiredMultiOrg(
              accessibleOrgs.length > 1 && !enabled
            )
          }}
          t={t}
        />
      )}
      {tab === "support" && (
        <SupportView t={t} onUnreadChange={setInboxUnread} />
      )}
      {tab === "help" && <HelpView t={t} />}

      {inboxAlertOpen && inboxAlertMsgs.length > 0 && (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="inbox-alert-title">
          <div
            className="card modal-card"
            style={{ maxWidth: 520, maxHeight: "85vh", overflow: "auto" }}>
            <h2 id="inbox-alert-title" style={{ marginTop: 0 }}>
              {inboxAlertMsgs.length === 1
                ? t("inbox.alertTitle")
                : t("inbox.alertTitleN", { n: inboxAlertMsgs.length })}
            </h2>
            <p className="muted" style={{ fontSize: 13, lineHeight: 1.45 }}>
              {t("inbox.alertHint")}
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {inboxAlertMsgs.slice(0, 8).map((m) => (
                <div
                  key={m.id}
                  style={{
                    padding: 12,
                    borderRadius: 10,
                    border: "1px solid var(--line)",
                    background: "var(--surface-2, rgba(15,118,110,0.06))"
                  }}>
                  <div
                    className="muted"
                    style={{ fontSize: 11, marginBottom: 4 }}>
                    {t("inbox.alertFrom")}:{" "}
                    <strong style={{ color: "inherit" }}>
                      {m.device_label || m.agent_id.slice(0, 12)}
                    </strong>
                    {" · "}
                    {formatDateTimeIso(
                      m.created_at,
                      loadDateTimePrefs()
                    )}
                  </div>
                  <div style={{ fontWeight: 650, fontSize: 14 }}>
                    {m.subject}
                  </div>
                  <p
                    style={{
                      whiteSpace: "pre-wrap",
                      margin: "6px 0 0",
                      fontSize: 13,
                      lineHeight: 1.4
                    }}>
                    {m.body.length > 400 ? `${m.body.slice(0, 400)}…` : m.body}
                  </p>
                  {(m.context_hostname || m.context_url) && (
                    <p className="muted" style={{ fontSize: 11, margin: "6px 0 0" }}>
                      {m.context_hostname || m.context_url}
                    </p>
                  )}
                  <div
                    className="row"
                    style={{ gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={inboxAlertBusy}
                      onClick={async () => {
                        setInboxAlertBusy(true)
                        try {
                          await api.inboxMarkRead(m.id)
                          setInboxAlertMsgs((prev) => {
                            const next = prev.filter((x) => x.id !== m.id)
                            if (next.length === 0) setInboxAlertOpen(false)
                            return next
                          })
                          setInboxUnread((n) => Math.max(0, n - 1))
                        } catch (e) {
                          setError(String(e))
                        } finally {
                          setInboxAlertBusy(false)
                        }
                      }}>
                      {t("inbox.ack")}
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div
              className="row"
              style={{
                gap: 8,
                marginTop: 16,
                flexWrap: "wrap",
                justifyContent: "flex-end"
              }}>
              <button
                type="button"
                className="btn secondary btn-sm"
                disabled={inboxAlertBusy}
                onClick={() => {
                  for (const m of inboxAlertMsgs) {
                    inboxSnoozedRef.current.add(m.id)
                  }
                  setInboxAlertOpen(false)
                }}>
                {t("inbox.alertLater")}
              </button>
              <button
                type="button"
                className="btn secondary btn-sm"
                disabled={inboxAlertBusy}
                onClick={() => {
                  setInboxAlertOpen(false)
                  goTab("support")
                }}>
                {t("inbox.alertOpenInbox")}
              </button>
              {inboxAlertMsgs.length > 1 && (
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={inboxAlertBusy}
                  onClick={async () => {
                    setInboxAlertBusy(true)
                    try {
                      const ids = inboxAlertMsgs.map((m) => m.id)
                      await Promise.all(
                        ids.map((id) => api.inboxMarkRead(id).catch(() => null))
                      )
                      setInboxAlertMsgs([])
                      setInboxAlertOpen(false)
                      const r = await api.inboxUnreadCount()
                      setInboxUnread(r.unread || 0)
                    } catch (e) {
                      setError(String(e))
                    } finally {
                      setInboxAlertBusy(false)
                    }
                  }}>
                  {t("inbox.ackAll")}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <footer className="console-footer">
        OpsGate Console <strong>1.2.0</strong>
        {" · "}
        events metadata-only
        {" · "}
        DailyOps.Tech
      </footer>
      </main>
      </div>
    </div>
  )
}

function SessionTakeoverModal({
  challenge,
  t,
  onAccept,
  onRefuse
}: {
  challenge: {
    challenge_id: string
    seconds_left: number
    requester_hint: string
  }
  t: (k: string, vars?: Record<string, string | number>) => string
  onAccept: () => void
  onRefuse: () => void
}) {
  const [left, setLeft] = useState(challenge.seconds_left)
  useEffect(() => {
    setLeft(challenge.seconds_left)
  }, [challenge.seconds_left, challenge.challenge_id])
  useEffect(() => {
    const id = setInterval(() => {
      setLeft((n) => Math.max(0, n - 1))
    }, 1000)
    return () => clearInterval(id)
  }, [challenge.challenge_id])
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="card modal-card">
        <h2 style={{ marginTop: 0 }}>{t("login.takeoverTitle")}</h2>
        <p style={{ fontSize: 13, lineHeight: 1.45 }}>
          {t("login.takeoverHint", {
            hint: challenge.requester_hint || "-",
            n: left
          })}
        </p>
        <p className="muted" style={{ fontSize: 12 }}>
          {t("login.takeoverTimeout")}
        </p>
        <div
          className="row"
          style={{ gap: 8, marginTop: 14, flexWrap: "wrap" }}>
          <button
            className="btn danger"
            type="button"
            style={{ flex: 1, minWidth: 100 }}
            onClick={onRefuse}>
            {t("login.takeoverRefuse")}
          </button>
          <button
            className="btn"
            type="button"
            style={{ flex: 1, minWidth: 100 }}
            onClick={onAccept}>
            {t("login.takeoverAccept")}
          </button>
        </div>
      </div>
    </div>
  )
}

function SwitchOrgMfaModal({
  orgName,
  code,
  setCode,
  err,
  busy,
  t,
  onCancel,
  onConfirm
}: {
  orgName: string
  code: string
  setCode: (c: string) => void
  err: string | null
  busy: boolean
  t: (k: string, vars?: Record<string, string | number>) => string
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="card modal-card">
        <h2 style={{ marginTop: 0 }}>{t("msp.mfaSwitchTitle")}</h2>
        <p className="muted" style={{ fontSize: 13, lineHeight: 1.45 }}>
          {t("msp.mfaSwitchHint", { name: orgName })}
        </p>
        <label className="field-label">{t("mfa.code")}</label>
        <input
          className="input mono"
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          maxLength={6}
          placeholder="123456"
          value={code}
          disabled={busy}
          onChange={(e) =>
            setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
          }
          onKeyDown={(e) => {
            if (e.key === "Enter" && code.replace(/\D/g, "").length === 6) {
              e.preventDefault()
              onConfirm()
            }
            if (e.key === "Escape") {
              e.preventDefault()
              onCancel()
            }
          }}
        />
        {err && <p className="err">{err}</p>}
        <div
          className="row"
          style={{ gap: 8, marginTop: 14, flexWrap: "wrap" }}>
          <button
            className="btn secondary"
            type="button"
            disabled={busy}
            style={{ flex: 1, minWidth: 100 }}
            onClick={onCancel}>
            {t("msp.mfaSwitchCancel")}
          </button>
          <button
            className="btn"
            type="button"
            disabled={busy || code.replace(/\D/g, "").length !== 6}
            style={{ flex: 1, minWidth: 100 }}
            onClick={onConfirm}>
            {t("msp.mfaSwitchSubmit")}
          </button>
        </div>
      </div>
    </div>
  )
}

function ForcePasswordModal({ onDone }: { onDone: () => void }) {
  const [cur, setCur] = useState("")
  const [next, setNext] = useState("")
  const [next2, setNext2] = useState("")
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  return (
    <div className="modal-overlay">
      <div className="card modal-card">
        <h2 style={{ marginTop: 0 }}>Changer le mot de passe</h2>
        <label className="field-label">Mot de passe actuel</label>
        <input
          className="input"
          type="password"
          value={cur}
          onChange={(e) => setCur(e.target.value)}
          placeholder="Actuel (ex. 0000)"
        />
        <label className="field-label">Nouveau mot de passe (≥8)</label>
        <input
          className="input"
          type="password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
        <label className="field-label">Confirmer le nouveau mot de passe</label>
        <input
          className="input"
          type="password"
          value={next2}
          onChange={(e) => setNext2(e.target.value)}
        />
        {next && next2 && next !== next2 && (
          <p className="err">Les deux mots de passe ne correspondent pas.</p>
        )}
        {err && <p className="err">{err}</p>}
        <button
          className="btn"
          type="button"
          style={{ marginTop: 14, width: "100%" }}
          disabled={busy || next.length < 8 || next !== next2 || !cur}
          onClick={async () => {
            setBusy(true)
            setErr(null)
            try {
              await api.changePassword(cur, next, next2)
              onDone()
            } catch (e) {
              setErr(String(e))
            } finally {
              setBusy(false)
            }
          }}>
          Enregistrer et continuer
        </button>
      </div>
    </div>
  )
}

function SummaryView({
  summary,
  dashV3,
  inboxUnread = 0,
  busy,
  dashSection,
  setDashSection,
  dashExpanded,
  setDashExpanded,
  onRefresh,
  onForceSync,
  onMerged,
  onForceSyncAgent,
  onRevokeAgent,
  onGoRisk,
  onGoShadow,
  onGoInbox,
  onGoEventsProxy,
  onGoProxySettings,
  setError,
  setInfo,
  setBusy,
  t
}: {
  summary: Summary | null
  dashV3?: {
    risk: {
      average_score: number
      previous_average_score: number | null
      trend: string
      users_count: number
      high_risk_users: number
      medium_risk_users: number
      low_risk_users: number
      top_risk_users?: Array<{ label: string; score: number; trend: string }>
    } | null
    shadow: {
      total: number
      unauthorized: number
      authorized: number
      unknown: number
    } | null
    proxy?: {
      enabled: boolean
      mode: "observe" | "enforce"
      agents: number
      online: number
      observe_events: number
      block_events: number
    } | null
  }
  /** Messages user → admin non lus (status open) */
  inboxUnread?: number
  busy?: boolean
  dashSection: "overview" | "licenses" | "connectivity" | "activity" | "rules"
  setDashSection: (
    s: "overview" | "licenses" | "connectivity" | "activity" | "rules"
  ) => void
  dashExpanded: boolean
  setDashExpanded: (v: boolean) => void
  onRefresh: () => void
  onForceSync: () => void
  onForceSyncAgent?: (agentId: string, offlineMs: number) => void
  onRevokeAgent?: (agentId: string) => void
  onMerged?: () => void
  onGoRisk?: () => void
  onGoShadow?: () => void
  onGoInbox?: () => void
  onGoEventsProxy?: () => void
  onGoProxySettings?: () => void
  setError?: (e: string | null) => void
  setInfo?: (i: string | null) => void
  setBusy?: (b: boolean) => void
  t: (k: string, vars?: Record<string, string | number>) => string
}) {
  const dtPrefs = useDateTimePrefs()
  const [drill, setDrill] = useState<string | null>(null)
  const [drillEvents, setDrillEvents] = useState<EventRow[]>([])
  const [drillBusy, setDrillBusy] = useState(false)
  /** Panneau contextuel : unlicensed | grace | offline | decision | duplicates */
  const [panel, setPanel] = useState<string | null>(null)
  const [dashLayout, setDashLayout] = useState<DashWidgetLayout[]>(() =>
    loadDashLayout()
  )
  const [addMetricOpen, setAddMetricOpen] = useState(false)
  const [dragId, setDragId] = useState<DashWidgetId | null>(null)
  const [overId, setOverId] = useState<DashWidgetId | null>(null)
  const metricsToAdd = availableWidgets(dashLayout)
  const resizeRef = useRef<{
    id: DashWidgetId
    startX: number
    startY: number
    startW: 1 | 2 | 3
    startH: number
  } | null>(null)

  const persistLayout = useCallback((next: DashWidgetLayout[]) => {
    setDashLayout(next)
    saveDashLayout(next)
  }, [])

  const onWidgetDragStart = (id: DashWidgetId, e: DragEvent) => {
    setDragId(id)
    e.dataTransfer.effectAllowed = "move"
    e.dataTransfer.setData("text/plain", id)
  }
  const onWidgetDrop = (targetId: DashWidgetId) => {
    if (!dragId || dragId === targetId) {
      setDragId(null)
      setOverId(null)
      return
    }
    persistLayout(moveWidget(dashLayout, dragId, targetId))
    setDragId(null)
    setOverId(null)
  }
  const startResize = (
    id: DashWidgetId,
    w: 1 | 2 | 3,
    h: number,
    e: ReactPointerEvent
  ) => {
    e.preventDefault()
    e.stopPropagation()
    const start = {
      id,
      startX: e.clientX,
      startY: e.clientY,
      startW: w,
      startH: h
    }
    resizeRef.current = start
    const onMove = (ev: PointerEvent) => {
      const r = resizeRef.current
      if (!r) return
      const dx = ev.clientX - r.startX
      const dy = ev.clientY - r.startY
      let nw: 1 | 2 | 3 = r.startW
      if (dx > 90) nw = 3
      else if (dx > 40) nw = r.startW === 1 ? 2 : 3
      else if (dx < -90) nw = 1
      else if (dx < -40) nw = r.startW === 3 ? 2 : 1
      const nh = r.startH + dy
      setDashLayout((prev) => patchWidget(prev, r.id, { w: nw, h: nh }))
    }
    const onUp = () => {
      if (resizeRef.current) {
        setDashLayout((prev) => {
          saveDashLayout(prev)
          return prev
        })
      }
      resizeRef.current = null
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
  }

  const wrapWidget = (
    id: DashWidgetId,
    title: string,
    body: ReactNode,
    extraClass?: string
  ) => {
    const lay = dashLayout.find((x) => x.id === id) || {
      id,
      w: 1 as const,
      h: 200
    }
    const colSpan = lay.w
    return (
      <div
        key={id}
        id={
          id === "activity"
            ? "dash-activity"
            : id === "threats"
              ? "dash-rules"
              : undefined
        }
        className={`card dash-widget ${extraClass || ""} ${
          dragId === id ? "is-dragging" : ""
        } ${overId === id ? "is-drag-over" : ""}`}
        style={{
          gridColumn: `span ${colSpan}`,
          height: lay.h,
          minHeight: lay.h
        }}
        onDragOver={(e) => {
          e.preventDefault()
          setOverId(id)
        }}
        onDragLeave={() => setOverId((o) => (o === id ? null : o))}
        onDrop={(e) => {
          e.preventDefault()
          onWidgetDrop(id)
        }}>
        <div
          className="dash-widget-head"
          draggable
          onDragStart={(e) => onWidgetDragStart(id, e)}
          onDragEnd={() => {
            setDragId(null)
            setOverId(null)
          }}
          title={t("dash.dragHint")}>
          <h2>{title}</h2>
          <div className="dash-widget-head-actions">
            <button
              type="button"
              className="btn secondary btn-sm dash-widget-wbtn"
              title={t("dash.width")}
              onClick={(e) => {
                e.stopPropagation()
                const nw = (lay.w >= 3 ? 1 : ((lay.w + 1) as 1 | 2 | 3))
                persistLayout(patchWidget(dashLayout, id, { w: nw }))
              }}>
              {lay.w}×
            </button>
            <button
              type="button"
              className="btn secondary btn-sm dash-widget-wbtn"
              title={t("dash.removeWidget") || "Retirer"}
              onClick={(e) => {
                e.stopPropagation()
                persistLayout(removeWidget(dashLayout, id))
              }}>
              ×
            </button>
          </div>
        </div>
        <div className="dash-widget-body">{body}</div>
        <div
          className="dash-widget-resize"
          title={t("dash.resize")}
          onPointerDown={(e) => startResize(id, lay.w, lay.h, e)}
        />
      </div>
    )
  }

  if (!summary) {
    return (
      <div className="card empty">
        {t("dash.empty")}
        <div style={{ marginTop: 12 }}>
          <button className="btn secondary" type="button" onClick={onRefresh}>
            {t("common.retry")}
          </button>
        </div>
      </div>
    )
  }

  const decisions = summary.by_decision || {}
  const lic = summary.licenses || {
    licensed: 0,
    grace: 0,
    unlicensed: 0,
    seats: 0,
    seats_used: 0,
    seats_available: null as number | null
  }
  const conn = summary.connectivity || {
    online: 0,
    stale: 0,
    offline_long: 0,
    offline_long_alertable: 0,
    offline_long_ms: 2 * 60 * 60 * 1000,
    online_ms: 15 * 60 * 1000,
    schedule_active: false,
    within_work_hours: true
  }

  const scrollPanelTop = () => {
    // Panneaux listes (stale, unlicensed, décisions…) collés en haut du contenu
    setTimeout(() => {
      const el = document.querySelector(".shell-body") as HTMLElement | null
      if (el) {
        const y = el.getBoundingClientRect().top + window.scrollY - 6
        window.scrollTo({ top: Math.max(0, y), behavior: "smooth" })
      } else {
        window.scrollTo({ top: 0, behavior: "smooth" })
      }
      document
        .getElementById("dash-panel")
        ?.scrollIntoView({ behavior: "smooth", block: "start" })
    }, 40)
  }

  const openPanel = (p: string) => {
    setPanel(p)
    scrollPanelTop()
  }

  const openDecision = async (k: string) => {
    setDrill(k)
    setPanel("decision")
    setDashSection("overview")
    scrollPanelTop()
    setDrillBusy(true)
    setDrillEvents([])
    try {
      const r = await api.eventsByDecision(k)
      const list = (r.events || []).map((e) =>
        normalizeEvent(e as unknown as Record<string, unknown>)
      )
      setDrillEvents(list)
      if (list.length === 0 && (summary.by_decision?.[k] || 0) > 0) {
        setInfo?.(
          `Compteur « ${k} » = ${summary.by_decision?.[k]} mais liste vide  -  recharger l’API ou vérifier org DEMO-OPSGATE.`
        )
      }
    } catch (e) {
      setDrillEvents([])
      setError?.(String(e))
    } finally {
      setDrillBusy(false)
    }
  }

  const mergeDupGroup = async (
    fingerprint: string,
    agents: import("./api").SummaryAgentBrief[]
  ) => {
    if (agents.length < 2) return
    // Conserver le plus récent (last_seen)
    const sorted = [...agents].sort(
      (a, b) =>
        new Date(b.last_seen_at).getTime() - new Date(a.last_seen_at).getTime()
    )
    const keep = sorted[0]
    const merge = sorted.slice(1).map((a) => a.id)
    if (
      !confirm(
        `Fusionner ${agents.length} agents (fingerprint ${fingerprint.slice(0, 12)}…) ?\nConservé : ${keep.device_label || keep.id}\nSupprimés : ${merge.length}`
      )
    ) {
      return
    }
    setBusy?.(true)
    setError?.(null)
    try {
      const r = await api.mergeAgents(keep.id, merge)
      setInfo?.(
        `Fusion OK  -  conservé ${r.kept.slice(0, 12)}… · ${r.removed} supprimé(s)`
      )
      onMerged?.()
      setPanel(null)
    } catch (e) {
      setError?.(String(e))
    } finally {
      setBusy?.(false)
    }
  }

  const formatOffline = (ms: number) => {
    const h = Math.floor(ms / 3600000)
    const m = Math.floor((ms % 3600000) / 60000)
    if (h >= 48) return `${Math.floor(h / 24)} j`
    if (h >= 1) return `${h} h ${m} min`
    return `${m} min`
  }

  const maskN = decisions.mask_send || 0
  const rewriteN = decisions.secure_rewrite || 0
  const riskN = decisions.send_anyway || 0
  const cancelN = decisions.cancel || 0
  const observeN = decisions.observe || 0
  const blockN = decisions.block || 0
  const totalDec = maskN + rewriteN + riskN + cancelN + observeN + blockN
  const userActs = maskN + rewriteN + riskN + cancelN
  const rewriteShare = userActs
    ? Math.round((rewriteN / userActs) * 1000) / 10
    : 0
  const v3Risk = dashV3?.risk
  const v3Shadow = dashV3?.shadow
  const v3Proxy = dashV3?.proxy
  const maxRule = Math.max(
    1,
    ...(summary.top_rules || []).map((r) => r.count)
  )
  const maxInboxReq = Math.max(
    1,
    ...(summary.top_inbox_requesters || []).map((r) => r.count)
  )
  const maxDay = Math.max(
    1,
    ...(summary.events_by_day || []).map((d) => d.count)
  )
  const dups = summary.duplicate_fingerprints || []

  const renderAgentList = (
    list: import("./api").SummaryAgentBrief[] | undefined,
    empty: string
  ) => {
    if (!list?.length) return <div className="empty">{empty}</div>
    return (
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Label</th>
              <th>Host</th>
              <th>{t("dash.lastSync")}</th>
              <th>{t("dash.offlineFor")}</th>
              <th>{t("dash.license")}</th>
              <th>{t("common.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {list.map((a) => {
              const offline = a.offline_for_ms > 15 * 60 * 1000
              return (
                <tr key={a.id}>
                  <td>
                    <strong>{a.device_label || " - "}</strong>
                    <div className="mono muted" style={{ fontSize: 10 }}>
                      {a.id.slice(0, 16)}…
                    </div>
                  </td>
                  <td className="muted">{a.host_name || " - "}</td>
                  <td className="muted" style={{ fontSize: 12 }}>
                    {a.last_seen_at
                      ? new Date(a.last_seen_at).toLocaleString()
                      : " - "}
                  </td>
                  <td>{formatOffline(a.offline_for_ms)}</td>
                  <td>
                    <span
                      className={`badge ${
                        a.license_status === "unlicensed"
                          ? "high"
                          : a.license_status === "grace"
                            ? "medium"
                            : "active"
                      }`}>
                      {a.license_status === "unlicensed"
                        ? "UNLICENSED"
                        : a.license_status}
                    </span>
                  </td>
                  <td>
                    <div className="btn-group agent-actions">
                      <button
                        type="button"
                        className="btn secondary btn-sm"
                        disabled={busy || offline}
                        title={
                          offline
                            ? "Offline - force sync unavailable"
                            : "Force resync policy/pack"
                        }
                        onClick={() =>
                          onForceSyncAgent?.(a.id, a.offline_for_ms)
                        }>
                        Force sync
                      </button>
                      <button
                        type="button"
                        className="btn danger btn-sm"
                        disabled={busy}
                        title={t("dash.revoke")}
                        onClick={() => onRevokeAgent?.(a.id)}>
                        {t("dash.revoke")}
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <div className={dashExpanded ? "dash-fill" : undefined}>
      {/* Mode étendu uniquement : barre pour quitter le plein écran */}
      {dashExpanded && (
        <div className="dash-fill-toolbar">
          <div className="dash-fill-toolbar-title">
            <strong>{t("nav.dashboard")}</strong>
            <span className="muted dash-fs-hint">{t("dash.escHint")}</span>
          </div>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <button
              className="btn secondary btn-sm"
              type="button"
              disabled={busy}
              onClick={onRefresh}>
              {t("dash.refresh")}
            </button>
            <button
              className="btn secondary btn-sm"
              type="button"
              title={t("dash.escHint")}
              onClick={() => {
                setDashExpanded(false)
                setPanel(null)
              }}>
              {t("dash.collapse")}
            </button>
            <button
              className="btn btn-sm"
              type="button"
              disabled={busy}
              onClick={onForceSync}>
              {t("dash.forceSync")}
            </button>
          </div>
        </div>
      )}

      {/* Panneaux contextuels - masqués en mode étendu (graphiques seuls) */}
      {!dashExpanded && <div id="dash-panel">
      {panel === "online" && (
        <div className="card dash-context-panel">
          <h3 style={{ marginTop: 0 }}>
            {t("dash.panelOnline")}{" "}
            <button type="button" className="btn secondary btn-sm" onClick={() => setPanel(null)}>
              {t("common.close")}
            </button>
          </h3>
          {renderAgentList(summary.agents_online, t("dash.noOnline"))}
        </div>
      )}
      {panel === "licensed" && (
        <div className="card dash-context-panel">
          <h3 style={{ marginTop: 0 }}>
            {t("dash.panelLicensed")}{" "}
            <button type="button" className="btn secondary btn-sm" onClick={() => setPanel(null)}>
              {t("common.close")}
            </button>
          </h3>
          {renderAgentList(summary.agents_licensed, t("dash.noLicensed"))}
        </div>
      )}
      {panel === "unlicensed" && (
        <div className="card dash-context-panel">
          <h3 style={{ marginTop: 0 }}>
            {t("dash.panelUnlicensed")}{" "}
            <button type="button" className="btn secondary btn-sm" onClick={() => setPanel(null)}>
              {t("common.close")}
            </button>
          </h3>
          {renderAgentList(summary.agents_unlicensed, t("dash.noUnlicensed"))}
        </div>
      )}
      {panel === "grace" && (
        <div className="card dash-context-panel">
          <h3 style={{ marginTop: 0 }}>
            {t("dash.panelGrace")}{" "}
            <button type="button" className="btn secondary btn-sm" onClick={() => setPanel(null)}>
              {t("common.close")}
            </button>
          </h3>
          {renderAgentList(summary.agents_grace, t("dash.noGrace"))}
        </div>
      )}
      {panel === "stale" && (
        <div className="card dash-context-panel">
          <h3 style={{ marginTop: 0 }}>
            {t("dash.panelStale")}{" "}
            <button type="button" className="btn secondary btn-sm" onClick={() => setPanel(null)}>
              {t("common.close")}
            </button>
          </h3>
          <p className="muted" style={{ fontSize: 12 }}>
            {t("dash.staleHint")}
          </p>
          {renderAgentList(summary.agents_stale, t("dash.noStale"))}
        </div>
      )}
      {panel === "offline" && (
        <div className="card dash-context-panel">
          <h3 style={{ marginTop: 0 }}>
            {t("dash.panelOffline")}{" "}
            <button type="button" className="btn secondary btn-sm" onClick={() => setPanel(null)}>
              {t("common.close")}
            </button>
          </h3>
          {renderAgentList(
            summary.agents_offline_long,
            t("dash.allSynced")
          )}
        </div>
      )}
      {panel === "maintenance" && (
        <div className="card dash-context-panel">
          <h3 style={{ marginTop: 0 }}>
            {t("dash.panelMaintenance")}{" "}
            <button type="button" className="btn secondary btn-sm" onClick={() => setPanel(null)}>
              {t("common.close")}
            </button>
          </h3>
          {renderAgentList(
            summary.agents_maintenance,
            t("dash.allSynced")
          )}
        </div>
      )}
      {panel === "decision" && drill && (
        <div className="card dash-context-panel">
          <h3 style={{ fontSize: 14, marginTop: 0 }}>
            {t("dash.logsOf")} « {decisionLabelFr(drill)} »{" "}
            <button
              type="button"
              className="btn secondary btn-sm"
              onClick={() => {
                setPanel(null)
                setDrill(null)
              }}>
              {t("common.close")}
            </button>
          </h3>
          {drillBusy ? (
            <p className="muted">{t("common.loading")}</p>
          ) : drillEvents.length === 0 ? (
            <div className="empty">
              {t("dash.noLogOf")} « {decisionLabelFr(drill)} »
            </div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Quand</th>
                    <th>Label</th>
                    <th>Décision</th>
                    <th>Site</th>
                    <th>Sévérité</th>
                    <th>Détail</th>
                  </tr>
                </thead>
                <tbody>
                  {drillEvents.slice(0, 80).map((e) => (
                    <tr key={e.id || `${e.ts}-${e.decision}-${e.hostname}`}>
                      <td className="muted">
                        {e.ts ? formatDateTimeAny(e.ts, dtPrefs) : " - "}
                      </td>
                      <td>
                        <strong>
                          {(e.device_label || "")
                            .replace(/^OpsGate\s+Proxy\s*[-:]?\s*/i, "")
                            .trim() || " - "}
                        </strong>
                      </td>
                      <td>
                        <strong>{decisionLabelFr(e.decision)}</strong>
                        <div className="mono muted" style={{ fontSize: 10 }}>
                          {e.decision}
                          {e.source ? ` · ${e.source}` : ""}
                        </div>
                      </td>
                      <td className="muted" style={{ fontSize: 12 }}>
                        {e.hostname || " - "}
                      </td>
                      <td>
                        <span className={`badge ${e.highest_severity || "low"}`}>
                          {e.highest_severity || "low"}
                        </span>
                      </td>
                      <td className="muted" style={{ fontSize: 11 }}>
                        {eventDetailSummary(e)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      {panel === "duplicates" && (
        <div className="card dash-context-panel">
          <h3 style={{ marginTop: 0 }}>
            {t("dash.duplicates")}{" "}
            <button type="button" className="btn secondary btn-sm" onClick={() => setPanel(null)}>
              {t("common.close")}
            </button>
          </h3>
          {dups.map((d) => (
            <div key={d.fingerprint} style={{ marginBottom: 16 }}>
              <div className="row" style={{ marginBottom: 8 }}>
                <code className="mono" style={{ fontSize: 11 }}>
                  {d.fingerprint.slice(0, 28)}…
                </code>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={busy}
                  onClick={() => void mergeDupGroup(d.fingerprint, d.agents)}>
                  {t("dash.mergeKeepRecent")}
                </button>
              </div>
              {renderAgentList(d.agents, "")}
            </div>
          ))}
        </div>
      )}
      </div>}

      {/* Dashboard libre : ordre + taille mémorisés (localStorage) */}
      <div className={dashExpanded ? "dash-fill-body" : undefined}>
        <div className="dash-board-toolbar">
          <button
            type="button"
            className="btn secondary btn-sm"
            title={t("dash.resetLayoutHint")}
            onClick={() => persistLayout(resetDashLayout())}>
            {t("dash.resetLayout")}
          </button>
        </div>
        <div className="dash-board" id="dash-charts">
          {dashLayout.map((lay) => {
            if (lay.id === "licenses") {
              return wrapWidget(
                "licenses",
                t("nav.licenses"),
                <>
                  <div className="muted" style={{ fontSize: 11, marginBottom: 8 }}>
                    {t("dash.seats")} {lic.seats_used}
                    {lic.seats > 0
                      ? ` / ${lic.seats}`
                      : ` · ${t("dash.unlimited")}`}
                  </div>
                  <div className="dash-status-row">
                    <div
                      className="dash-donut"
                      aria-hidden
                      style={{
                        background: `conic-gradient(
                  var(--accent) 0 ${lic.licensed ? (lic.licensed / Math.max(1, summary.agents)) * 100 : 0}%,
                  #fbbf24 ${lic.licensed ? (lic.licensed / Math.max(1, summary.agents)) * 100 : 0}% ${(lic.licensed + lic.grace) / Math.max(1, summary.agents) * 100}%,
                  #ef4444 ${(lic.licensed + lic.grace) / Math.max(1, summary.agents) * 100}% 100%
                )`
                      }}>
                      <div className="dash-donut-inner">
                        <span className="dash-donut-num">{lic.unlicensed}</span>
                        <span className="dash-donut-lbl">
                          {t("dash.unlicShort")}
                        </span>
                      </div>
                    </div>
                    <ul className="dash-status-list">
                      <li>
                        <button
                          type="button"
                          className="dash-link-row"
                          onClick={() => openPanel("licensed")}>
                          <span className="dash-dot ok" /> {t("dash.licensed")}{" "}
                          <strong>{lic.licensed}</strong>
                        </button>
                      </li>
                      <li>
                        <button
                          type="button"
                          className="dash-link-row"
                          onClick={() => openPanel("grace")}>
                          <span className="dash-dot warn" /> {t("dash.grace")}{" "}
                          <strong>{lic.grace}</strong>
                        </button>
                      </li>
                      <li>
                        <button
                          type="button"
                          className="dash-link-row crit-text"
                          onClick={() => openPanel("unlicensed")}>
                          <span className="dash-dot crit" />{" "}
                          <strong>
                            {t("dash.unlicensed")} {lic.unlicensed}
                          </strong>
                        </button>
                      </li>
                    </ul>
                  </div>
                </>
              )
            }
            if (lay.id === "connectivity") {
              return wrapWidget(
                "connectivity",
                t("nav.connectivity"),
                <>
                  <ul className="dash-status-list">
                    <li>
                      <button
                        type="button"
                        className="dash-link-row"
                        onClick={() => openPanel("online")}>
                        <span className="dash-dot ok" />{" "}
                        {t("dash.onlineLt", {
                          n: Math.round(conn.online_ms / 60000)
                        })}{" "}
                        <strong>{conn.online}</strong>
                      </button>
                    </li>
                    <li>
                      <button
                        type="button"
                        className="dash-link-row"
                        onClick={() => openPanel("stale")}>
                        <span className="dash-dot warn" /> {t("dash.stale")}{" "}
                        <strong>{conn.stale ?? 0}</strong>
                      </button>
                    </li>
                    <li>
                      <button
                        type="button"
                        className="dash-link-row crit-text"
                        onClick={() => openPanel("offline")}>
                        <span className="dash-dot crit" />{" "}
                        {t("dash.offlineLongLabel")}{" "}
                        <strong>{conn.offline_long ?? 0}</strong>
                      </button>
                    </li>
                    {(conn.maintenance ?? 0) > 0 ||
                    (summary.agents_maintenance?.length ?? 0) > 0 ? (
                      <li>
                        <button
                          type="button"
                          className="dash-link-row"
                          onClick={() => openPanel("maintenance")}>
                          <span className="dash-dot warn" />{" "}
                          {t("dash.maintenance")}{" "}
                          <strong>
                            {conn.maintenance ??
                              summary.agents_maintenance?.length ??
                              0}
                          </strong>
                        </button>
                      </li>
                    ) : null}
                  </ul>
                  <p className="muted" style={{ fontSize: 11, marginBottom: 0 }}>
                    {t("dash.clickList")}
                  </p>
                </>
              )
            }
            if (lay.id === "protection") {
              return wrapWidget(
                "protection",
                t("dash.protection"),
                <div className="dash-status-row">
                  <div className="dash-donut" aria-hidden>
                    <div className="dash-donut-inner">
                      <span className="dash-donut-num">{summary.agents}</span>
                      <span className="dash-donut-lbl">
                        {t("dash.agentsLbl")}
                      </span>
                    </div>
                  </div>
                  <ul className="dash-status-list">
                    <li>
                      <span className="dash-dot ok" /> {t("dash.enrolled")}{" "}
                      <strong>{summary.agents}</strong>
                    </li>
                    <li>
                      <span className="dash-dot warn" /> Events{" "}
                      <strong>{summary.events_total}</strong>
                    </li>
                    <li>
                      <span className="dash-dot ok" /> {t("dash.rewriteShort")}{" "}
                      <strong>{rewriteN}</strong>
                    </li>
                    <li>
                      <span className="dash-dot crit" /> {t("dash.riskySends")}{" "}
                      <strong>{riskN}</strong>
                    </li>
                    <li className="muted" style={{ fontSize: 12 }}>
                      Pack{" "}
                      <strong className="mono">
                        {summary.active_rules_pack?.version || " - "}
                      </strong>
                    </li>
                  </ul>
                </div>
              )
            }
            if (lay.id === "activity") {
              return wrapWidget(
                "activity",
                t("dash.activity"),
                <div className="dash-bars dash-bars--compact">
                  {(
                    [
                      [
                        "secure_rewrite",
                        t("dash.rewrite"),
                        rewriteN,
                        "ok"
                      ],
                      ["mask_send", t("dash.mask"), maskN, "ok"],
                      ["send_anyway", t("dash.risky"), riskN, "crit"],
                      ["cancel", t("dash.cancel"), cancelN, "warn"],
                      ["observe", t("dash.observe"), observeN, "ok"],
                      ["block", t("dash.block"), blockN, "crit"]
                    ] as const
                  ).map(([k, label, n, tone]) => (
                    <button
                      key={k}
                      type="button"
                      className={`dash-bar-row ${drill === k ? "is-active" : ""}`}
                      onClick={() => void openDecision(k)}>
                      <span className="dash-bar-label">{label}</span>
                      <span className="dash-bar-track">
                        <span
                          className={`dash-bar-fill ${tone}`}
                          style={{
                            width: `${totalDec ? Math.max(4, (n / totalDec) * 100) : 0}%`
                          }}
                        />
                      </span>
                      <span className="dash-bar-n mono">{n}</span>
                    </button>
                  ))}
                </div>,
                "dash-widget--activity"
              )
            }
            if (lay.id === "ai_rewrite") {
              return wrapWidget(
                "ai_rewrite",
                t("dash.aiRewrite"),
                <div className="dash-v3">
                  <div className="dash-v3-hero">
                    <span className="dash-v3-num">{rewriteN}</span>
                    <span className="dash-v3-lbl">
                      {t("dash.rewriteCount")}
                    </span>
                  </div>
                  <ul className="dash-status-list">
                    <li>
                      <span className="dash-dot ok" /> {t("dash.mask")}{" "}
                      <strong>{maskN}</strong>
                    </li>
                    <li>
                      <span className="dash-dot crit" /> {t("dash.risky")}{" "}
                      <strong>{riskN}</strong>
                    </li>
                    <li>
                      <span className="dash-dot warn" /> {t("dash.rewriteShare")}{" "}
                      <strong>{rewriteShare}%</strong>
                    </li>
                  </ul>
                  <div className="dash-meter" aria-hidden>
                    <i
                      style={{
                        width: `${Math.min(100, rewriteShare)}%`
                      }}
                    />
                  </div>
                  <p className="muted" style={{ fontSize: 11, margin: "6px 0 0" }}>
                    {t("dash.rewriteHint")}
                  </p>
                </div>
              )
            }
            if (lay.id === "risk_snapshot") {
              const avg = v3Risk?.average_score ?? 0
              const trend = v3Risk?.trend || "flat"
              const trendG =
                trend === "up" ? "↑" : trend === "down" ? "↓" : "→"
              return wrapWidget(
                "risk_snapshot",
                t("dash.riskSnapshot"),
                <div className="dash-v3">
                  {v3Risk ? (
                    <>
                      <div className="dash-v3-hero">
                        <span className="dash-v3-num">{avg}</span>
                        <span className="dash-v3-lbl">
                          {t("dash.riskAvg")} · {trendG}
                        </span>
                      </div>
                      <ul className="dash-status-list">
                        <li>
                          <span className="dash-dot crit" /> High ≥70{" "}
                          <strong>{v3Risk.high_risk_users}</strong>
                        </li>
                        <li>
                          <span className="dash-dot warn" /> Med 40–69{" "}
                          <strong>{v3Risk.medium_risk_users}</strong>
                        </li>
                        <li>
                          <span className="dash-dot ok" /> Low{" "}
                          <strong>{v3Risk.low_risk_users}</strong>
                        </li>
                        <li className="muted" style={{ fontSize: 11 }}>
                          {t("dash.riskUsers", { n: v3Risk.users_count })} · 7 j
                        </li>
                      </ul>
                      {v3Risk.top_risk_users &&
                      v3Risk.top_risk_users.length > 0 ? (
                        <ol className="dash-rank" style={{ marginTop: 8 }}>
                          {v3Risk.top_risk_users.slice(0, 3).map((u, i) => (
                            <li key={`${u.label}-${i}`}>
                              <span className="dash-rank-i">{i + 1}.</span>
                              <span className="dash-rank-id" title={u.label}>
                                {u.label}
                              </span>
                              <strong className="dash-rank-n">{u.score}</strong>
                            </li>
                          ))}
                        </ol>
                      ) : null}
                      {onGoRisk ? (
                        <button
                          type="button"
                          className="btn secondary btn-sm"
                          style={{ marginTop: 8, width: "100%" }}
                          onClick={() => onGoRisk()}>
                          {t("dash.openRisk")}
                        </button>
                      ) : null}
                    </>
                  ) : (
                    <div className="empty">{t("dash.v3Loading")}</div>
                  )}
                </div>
              )
            }
            if (lay.id === "shadow_snapshot") {
              return wrapWidget(
                "shadow_snapshot",
                t("dash.shadowSnapshot"),
                <div className="dash-v3">
                  {v3Shadow ? (
                    <>
                      <div className="dash-v3-hero">
                        <span className="dash-v3-num">
                          {v3Shadow.unauthorized}
                        </span>
                        <span className="dash-v3-lbl">
                          {t("dash.shadowUnauth")}
                        </span>
                      </div>
                      <ul className="dash-status-list">
                        <li>
                          <span className="dash-dot ok" /> {t("dash.shadowAuth")}{" "}
                          <strong>{v3Shadow.authorized}</strong>
                        </li>
                        <li>
                          <span className="dash-dot warn" />{" "}
                          {t("dash.shadowUnknown")}{" "}
                          <strong>{v3Shadow.unknown}</strong>
                        </li>
                        <li>
                          <span className="dash-dot" /> {t("dash.shadowTotal")}{" "}
                          <strong>{v3Shadow.total}</strong>
                        </li>
                      </ul>
                      {onGoShadow ? (
                        <button
                          type="button"
                          className="btn secondary btn-sm"
                          style={{ marginTop: 8, width: "100%" }}
                          onClick={() => onGoShadow()}>
                          {t("dash.openShadow")}
                        </button>
                      ) : null}
                    </>
                  ) : (
                    <div className="empty">{t("dash.v3Loading")}</div>
                  )}
                </div>
              )
            }
            if (lay.id === "proxy_fleet") {
              const mode = v3Proxy?.mode || "enforce"
              const modeLabel =
                mode === "observe"
                  ? t("proxy.mode.observe")
                  : t("proxy.mode.enforce")
              return wrapWidget(
                "proxy_fleet",
                t("dash.proxyFleet"),
                <div className="dash-v3">
                  {v3Proxy ? (
                    <>
                      <div className="dash-v3-hero">
                        <span className="dash-v3-num">{v3Proxy.agents}</span>
                        <span className="dash-v3-lbl">
                          {t("dash.proxyAgents")} ·{" "}
                          <span
                            className={
                              v3Proxy.enabled
                                ? mode === "enforce"
                                  ? "dash-proxy-mode dash-proxy-mode--enforce"
                                  : "dash-proxy-mode dash-proxy-mode--observe"
                                : "dash-proxy-mode dash-proxy-mode--off"
                            }>
                            {v3Proxy.enabled
                              ? mode === "enforce"
                                ? "ENFORCE"
                                : "OBSERVE"
                              : "OFF"}
                          </span>
                        </span>
                      </div>
                      <ul className="dash-status-list">
                        <li>
                          <span className="dash-dot ok" /> {t("dash.proxyOnline")}{" "}
                          <strong>
                            {v3Proxy.online}/{v3Proxy.agents}
                          </strong>
                        </li>
                        <li>
                          <span className="dash-dot warn" />{" "}
                          {t("dash.observe")}{" "}
                          <strong>{v3Proxy.observe_events}</strong>
                        </li>
                        <li>
                          <span className="dash-dot crit" /> {t("dash.block")}{" "}
                          <strong>{v3Proxy.block_events}</strong>
                        </li>
                        <li className="muted" style={{ fontSize: 11 }}>
                          {modeLabel}
                        </li>
                      </ul>
                      <div className="row" style={{ gap: 6, marginTop: 8 }}>
                        {onGoEventsProxy ? (
                          <button
                            type="button"
                            className="btn btn-sm"
                            style={{ flex: 1 }}
                            onClick={() => onGoEventsProxy()}>
                            {t("dash.proxyEvents")}
                          </button>
                        ) : null}
                        {onGoProxySettings ? (
                          <button
                            type="button"
                            className="btn secondary btn-sm"
                            style={{ flex: 1 }}
                            onClick={() => onGoProxySettings()}>
                            {t("dash.proxySettings")}
                          </button>
                        ) : null}
                      </div>
                    </>
                  ) : (
                    <div className="empty">{t("dash.v3Loading")}</div>
                  )}
                </div>
              )
            }
            if (lay.id === "timeline") {
              return wrapWidget(
                "timeline",
                t("dash.events14"),
                <div className="dash-timeline">
                  {(summary.events_by_day || []).map((d) => {
                    /* px explicites : % height échoue si parent en height:auto (mode étendu) */
                    const barPx = Math.max(
                      4,
                      Math.round((d.count / maxDay) * (dashExpanded ? 140 : 96))
                    )
                    return (
                      <div
                        key={d.day}
                        className="dash-tl-col"
                        title={`${d.day}: ${d.count}`}>
                        <div className="dash-tl-bar-wrap">
                          <div
                            className="dash-tl-bar"
                            style={{ height: `${barPx}px` }}
                          />
                        </div>
                        <span className="dash-tl-lbl">
                          {d.day.slice(8)}
                          {dashExpanded ? (
                            <span className="dash-tl-n">{d.count}</span>
                          ) : null}
                        </span>
                      </div>
                    )
                  })}
                  {!(summary.events_by_day || []).length && (
                    <p className="muted">{t("dash.noSeries")}</p>
                  )}
                </div>,
                "dash-widget--timeline"
              )
            }
            if (lay.id === "threats") {
              if (dashExpanded) {
                return wrapWidget(
                  "threats",
                  t("dash.userDecisions"),
                  <div className="decision-grid decision-grid--compact">
                    {(
                      [
                        ["secure_rewrite", t("dash.rewrite")],
                        ["mask_send", t("dash.maskSend")],
                        ["send_anyway", t("dash.sendAnyway")],
                        ["cancel", t("dash.cancel")],
                        ["observe", t("dash.observe")],
                        ["block", t("dash.block")],
                        ["enroll", t("dash.enroll")],
                        ["unenroll", t("dash.unenroll")]
                      ] as const
                    ).map(([k, label]) => (
                      <button
                        key={k}
                        type="button"
                        className={`decision-btn decision-btn--${k} ${drill === k ? "is-active" : ""}`}
                        onClick={() => void openDecision(k)}>
                        <div className="decision-key">{label}</div>
                        <div className="decision-count">
                          {decisions[k] || 0}
                        </div>
                        <div className="decision-code mono">{k}</div>
                      </button>
                    ))}
                  </div>
                )
              }
              return wrapWidget(
                "threats",
                t("dash.topThreats"),
                summary.top_rules?.length ? (
                  <ol className="dash-rank">
                    {summary.top_rules.slice(0, 6).map((r, i) => (
                      <li key={r.rule_id}>
                        <span className="dash-rank-i">{i + 1}.</span>
                        <span className="mono dash-rank-id" title={r.rule_id}>
                          {r.rule_id}
                        </span>
                        <span className="dash-rank-bar-wrap">
                          <span
                            className="dash-rank-bar"
                            style={{
                              width: `${(r.count / maxRule) * 100}%`
                            }}
                          />
                        </span>
                        <strong className="dash-rank-n">{r.count}</strong>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <div className="empty">{t("dash.noEvents")}</div>
                )
              )
            }
            if (lay.id === "requesters") {
              return wrapWidget(
                "requesters",
                t("dash.topRequesters"),
                summary.top_inbox_requesters?.length ? (
                  <ol className="dash-rank">
                    {summary.top_inbox_requesters.slice(0, 8).map((r, i) => (
                      <li key={r.agent_id}>
                        <span className="dash-rank-i">{i + 1}.</span>
                        <span className="dash-rank-id" title={r.agent_id}>
                          {r.device_label || r.agent_id.slice(0, 12)}
                        </span>
                        <span className="dash-rank-bar-wrap">
                          <span
                            className="dash-rank-bar"
                            style={{
                              width: `${(r.count / maxInboxReq) * 100}%`,
                              background: "var(--teal, #2BD9C5)"
                            }}
                          />
                        </span>
                        <strong className="dash-rank-n">{r.count}</strong>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <div className="empty">{t("dash.noRequests")}</div>
                )
              )
            }
            if (lay.id === "inbox_unread") {
              const n = Math.max(0, Math.floor(inboxUnread || 0))
              return wrapWidget(
                "inbox_unread",
                t("dash.inboxUnread"),
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "stretch",
                    gap: 12,
                    height: "100%",
                    justifyContent: "center"
                  }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 14
                    }}>
                    <div
                      style={{
                        width: 56,
                        height: 56,
                        borderRadius: 14,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontWeight: 800,
                        fontSize: n > 99 ? 16 : 22,
                        background:
                          n > 0
                            ? "rgba(15, 118, 110, 0.18)"
                            : "var(--surface-2, #f1f5f9)",
                        color: n > 0 ? "#0f766e" : "var(--muted)",
                        border:
                          n > 0
                            ? "1px solid rgba(15, 118, 110, 0.35)"
                            : "1px solid var(--line)"
                      }}>
                      {n > 99 ? "99+" : n}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 15,
                          fontWeight: 700,
                          lineHeight: 1.25
                        }}>
                        {n === 0
                          ? t("dash.inboxUnreadNone")
                          : n === 1
                            ? t("inbox.alertTitle")
                            : t("inbox.alertTitleN", { n })}
                      </div>
                      <p
                        className="muted"
                        style={{ fontSize: 12, margin: "4px 0 0" }}>
                        {t("dash.inboxUnreadHint")}
                      </p>
                    </div>
                  </div>
                  {onGoInbox ? (
                    <button
                      type="button"
                      className={n > 0 ? "btn btn-sm" : "btn secondary btn-sm"}
                      onClick={() => onGoInbox()}>
                      {t("dash.inboxUnreadOpen")}
                    </button>
                  ) : null}
                </div>,
                n > 0 ? "dash-widget--inbox-hot" : "dash-widget--inbox"
              )
            }
            return null
          })}
          {dups.length > 0 && !dashExpanded && (
            <div className="card dash-widget" style={{ gridColumn: "span 1" }}>
              <div className="dash-widget-head">
                <h2>{t("dash.duplicates")}</h2>
                <button
                  type="button"
                  className="btn secondary btn-sm"
                  onClick={() => openPanel("duplicates")}>
                  {t("dash.view")}
                </button>
              </div>
              <p className="muted" style={{ fontSize: 12 }}>
                {dups.length} {t("dash.dupHint")}
              </p>
            </div>
          )}
        </div>

        {/* Ajouter des métriques au dashboard */}
        {!dashExpanded && (
          <div className="dash-add-metric">
            {!addMetricOpen ? (
              <button
                type="button"
                className="btn secondary dash-add-metric-btn"
                disabled={metricsToAdd.length === 0}
                onClick={() => setAddMetricOpen(true)}>
                + {t("dash.addMetric") || "Ajouter une métrique"}
              </button>
            ) : (
              <div className="card dash-add-metric-panel">
                <div
                  className="row"
                  style={{
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 10
                  }}>
                  <strong style={{ fontSize: 14 }}>
                    {t("dash.addMetricTitle") || "Choisir une métrique"}
                  </strong>
                  <button
                    type="button"
                    className="btn secondary btn-sm"
                    onClick={() => setAddMetricOpen(false)}>
                    {t("common.close") || "Fermer"}
                  </button>
                </div>
                {metricsToAdd.length === 0 ? (
                  <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                    {t("dash.addMetricEmpty") ||
                      "Toutes les métriques sont déjà affichées."}
                  </p>
                ) : (
                  <div className="dash-add-metric-grid">
                    {metricsToAdd.map((id) => (
                      <button
                        key={id}
                        type="button"
                        className="btn secondary dash-add-metric-item"
                        onClick={() => {
                          persistLayout(addWidget(dashLayout, id))
                          setAddMetricOpen(false)
                        }}>
                        + {t(DASH_WIDGET_META[id]?.labelKey || id)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Décisions utilisateur (vue normale uniquement) */}
      {!dashExpanded && (
      <div className="card">
        <h2>{t("dash.userDecisions")}</h2>
        <div className="decision-grid">
          {(
            [
              ["mask_send", t("dash.maskSend")],
              ["send_anyway", t("dash.sendAnyway")],
              ["cancel", t("dash.cancel")],
              ["observe", t("dash.observe")],
              ["block", t("dash.block")],
              ["enroll", t("dash.enroll")],
              ["unenroll", t("dash.unenroll")]
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              className={`decision-btn decision-btn--${k} ${drill === k ? "is-active" : ""}`}
              onClick={() => void openDecision(k)}>
              <div className="decision-key">{label}</div>
              <div className="decision-count">{decisions[k] || 0}</div>
              <div className="decision-code mono">{k}</div>
            </button>
          ))}
        </div>
      </div>
      )}
    </div>
  )
}

function SecurityReportPanel({
  t,
  setError,
  setInfo,
  busy,
  setBusy
}: {
  t: (k: string, vars?: Record<string, string | number>) => string
  setError: (e: string | null) => void
  setInfo: (i: string | null) => void
  busy: boolean
  setBusy: (b: boolean) => void
}) {
  const [range, setRange] = useState<
    "current_week" | "week" | "custom" | "all"
  >("current_week")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [preview, setPreview] = useState<
    import("./api").SecurityReport | null
  >(null)
  const [localBusy, setLocalBusy] = useState(false)

  const loadPreview = async () => {
    setLocalBusy(true)
    setError(null)
    try {
      const r = await api.securityReport({
        range,
        from: range === "custom" ? from : undefined,
        to: range === "custom" ? to : undefined
      })
      setPreview(r.report)
    } catch (e) {
      setError(String(e))
    } finally {
      setLocalBusy(false)
    }
  }

  const downloadPdf = async () => {
    if (range === "custom" && (!from || !to)) {
      setError("from/to required")
      return
    }
    setBusy(true)
    setError(null)
    try {
      const { blob, filename } = await api.securityReportPdf({
        range,
        from: range === "custom" ? from : undefined,
        to: range === "custom" ? to : undefined
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
      setInfo(t("rep.pdfOk"))
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  const k = preview?.kpis

  return (
    <div
      className="card"
      style={{
        marginTop: 20,
        borderLeft: "4px solid var(--accent)",
        maxWidth: 640
      }}>
      <h3 style={{ marginTop: 0 }}>{t("rep.securityTitle")}</h3>
      <p className="muted" style={{ fontSize: 12 }}>
        {t("rep.securityHint")}
      </p>
      <div className="form-stack" style={{ maxWidth: 480 }}>
        <label className="field-label">{t("rep.range")}</label>
        <select
          className="input"
          value={range}
          onChange={(e) =>
            setRange(e.target.value as typeof range)
          }>
          <option value="current_week">{t("rep.range.currentWeek")}</option>
          <option value="week">{t("rep.range.week")}</option>
          <option value="all">{t("rep.range.all")}</option>
          <option value="custom">{t("rep.range.custom")}</option>
        </select>
        {range === "custom" && (
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <div>
              <label className="field-label">{t("events.from")}</label>
              <input
                className="input"
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>
            <div>
              <label className="field-label">{t("events.to")}</label>
              <input
                className="input"
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
          </div>
        )}
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn secondary"
            disabled={localBusy || busy}
            onClick={() => void loadPreview()}>
            {localBusy ? "…" : t("rep.refreshPreview")}
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy || localBusy}
            onClick={() => void downloadPdf()}>
            {busy ? t("rep.pdfBusy") : t("rep.pdf")}
          </button>
        </div>
      </div>
      {preview && k && (
        <div style={{ marginTop: 16 }}>
          <div className="field-label">{t("rep.preview")}</div>
          <p className="muted" style={{ fontSize: 12, margin: "4px 0 10px" }}>
            {preview.period.label} · {preview.period.from_ts.slice(0, 10)} →{" "}
            {preview.period.to_ts.slice(0, 10)}
          </p>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))",
              gap: 8
            }}>
            {(
              [
                ["Events", k.events_total],
                ["Blocks", k.blocks],
                ["Mask", k.masks],
                ["Rewrite", k.secure_rewrites ?? 0],
                ["Risky", k.risky_sends],
                ["Observe", k.observes],
                ["Agents", k.agents_total],
                ["Online", k.agents_online],
                ["Unlic.", k.unlicensed]
              ] as const
            ).map(([lab, val]) => (
              <div
                key={lab}
                style={{
                  background: "var(--accent-soft)",
                  borderRadius: 8,
                  padding: "8px 10px",
                  borderLeft: "3px solid var(--accent)"
                }}>
                <div
                  style={{
                    fontSize: 18,
                    fontWeight: 700,
                    color: "var(--navy)"
                  }}>
                  {val}
                </div>
                <div className="muted" style={{ fontSize: 11 }}>
                  {lab}
                </div>
              </div>
            ))}
          </div>
          {preview.top_rules?.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div className="field-label">Top rules</div>
              <ul style={{ margin: "6px 0", paddingLeft: 18, fontSize: 12 }}>
                {preview.top_rules.slice(0, 5).map((r) => (
                  <li key={r.rule_id}>
                    <span className="mono">{r.rule_id}</span> · {r.count}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function DateTimePrefsPanel({
  t,
  setInfo
}: {
  t: (k: string) => string
  setInfo: (i: string | null) => void
}) {
  const [prefs, setPrefs] = useState<DateTimePrefs>(() => loadDateTimePrefs())

  // Rester aligné si un seed org (rare) ou un autre onglet met à jour les prefs
  useEffect(() => {
    const onPrefs = (e: Event) => {
      const d = (e as CustomEvent<DateTimePrefs>).detail
      setPrefs(d || loadDateTimePrefs())
    }
    window.addEventListener("opsgate-datetime-prefs", onPrefs)
    return () => window.removeEventListener("opsgate-datetime-prefs", onPrefs)
  }, [])

  const update = (patch: Partial<DateTimePrefs>) => {
    const next = { ...prefs, ...patch }
    setPrefs(next)
    // source "user" : verrouille le fuseau d’affichage (ne plus l’écraser au save settings)
    saveDateTimePrefs(next, "user")
    setInfo(t("dt.saved"))
  }

  return (
    <>
      <h3 style={{ marginTop: 24 }}>{t("dt.title")}</h3>
      <p className="muted" style={{ fontSize: 12, maxWidth: 480 }}>
        {t("dt.hint")}
      </p>
      <div className="form-stack" style={{ maxWidth: 420 }}>
        <label className="field-label">{t("dt.timezone")}</label>
        <select
          className="input"
          value={prefs.timezone}
          onChange={(e) => update({ timezone: e.target.value })}>
          {[
            ...new Set([prefs.timezone, ...COMMON_TIMEZONES])
          ].map((z) => {
            const lab =
              TIMEZONE_OPTIONS.find(([id]) => id === z)?.[1] || z
            return (
              <option key={z} value={z}>
                {lab}
              </option>
            )
          })}
        </select>
        <label className="field-label">{t("dt.dateFormat")}</label>
        <select
          className="input"
          value={prefs.dateFormat}
          onChange={(e) =>
            update({
              dateFormat: e.target.value as DateFormatPref
            })
          }>
          <option value="dmy">{t("dt.date.dmy")}</option>
          <option value="ymd">{t("dt.date.ymd")}</option>
          <option value="mdy">{t("dt.date.mdy")}</option>
        </select>
        <label className="field-label">{t("dt.timeFormat")}</label>
        <select
          className="input"
          value={prefs.timeFormat}
          onChange={(e) =>
            update({
              timeFormat: e.target.value as TimeFormatPref
            })
          }>
          <option value="24h">{t("dt.time.24h")}</option>
          <option value="12h">{t("dt.time.12h")}</option>
        </select>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="checkbox"
            checked={prefs.showSeconds}
            onChange={(e) => update({ showSeconds: e.target.checked })}
          />
          {t("dt.showSeconds")}
        </label>
        <p className="muted" style={{ fontSize: 12, margin: "4px 0 0" }}>
          {t("dt.preview")}:{" "}
          <span className="mono" style={{ fontWeight: 500 }}>
            {/* Aperçu discret du format choisi - pas une horloge « widget » */}
            <LiveClock />
          </span>
        </p>
      </div>
    </>
  )
}

/** Sélecteur de dossier sur le serveur API (portal body — hors overflow shell). */
function BackupFsPickerModal({
  t,
  initialPath,
  onCancel,
  onSelect
}: {
  t: (k: string, vars?: Record<string, string | number>) => string
  initialPath?: string
  onCancel: () => void
  onSelect: (path: string, createIfMissing: boolean) => void
}) {
  const [roots, setRoots] = useState<
    Array<{ path: string; label: string; kind: string; reachable: boolean }>
  >([])
  /** Dossier actuellement affiché (liste des enfants) */
  const [browsing, setBrowsing] = useState("")
  /** Dossier choisi pour validation */
  const [selected, setSelected] = useState(initialPath?.trim() || "")
  const [parent, setParent] = useState<string | null>(null)
  const [entries, setEntries] = useState<Array<{ name: string; path: string }>>(
    []
  )
  const [remote, setRemote] = useState("")
  const [createIfMissing, setCreateIfMissing] = useState(true)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  const openPath = async (p: string, alsoSelect = true) => {
    const target = p.trim()
    if (!target) return
    setLoading(true)
    setErr(null)
    try {
      const r = await api.backupFsList(target)
      if (!r.ok) {
        setErr(r.error || t("backup.fsError"))
        setBrowsing(r.path || target)
        setParent(r.parent ?? null)
        setEntries([])
        if (alsoSelect) setSelected(r.path || target)
      } else {
        setBrowsing(r.path)
        setParent(r.parent)
        setEntries(r.entries || [])
        if (alsoSelect) setSelected(r.path)
      }
    } catch (e) {
      setErr(String(e))
      setEntries([])
      if (alsoSelect) setSelected(target)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      setErr(null)
      try {
        const r = await api.backupFsRoots()
        if (cancelled) return
        setRoots(r.roots || [])
        const start =
          initialPath?.trim() ||
          r.roots?.find((x) => x.kind === "drive")?.path ||
          r.roots?.[0]?.path ||
          ""
        if (start) {
          await openPath(start, true)
        } else {
          setLoading(false)
        }
      } catch (e) {
        if (!cancelled) {
          setErr(String(e))
          setLoading(false)
        }
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        onCancel()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onCancel])

  const chosen = (selected || browsing || "").trim()
  const validateLabel =
    t("backup.fsValidate") === "backup.fsValidate"
      ? "Valider ce dossier"
      : t("backup.fsValidate")

  const confirm = () => {
    const path = chosen
    if (!path) return
    onSelect(path, createIfMissing)
  }

  const modal = (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="backup-fs-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        background: "rgba(15, 23, 42, 0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        boxSizing: "border-box"
      }}>
      <div
        className="card"
        style={{
          width: "min(640px, 96vw)",
          maxHeight: "min(92vh, 720px)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          margin: 0,
          boxShadow: "0 20px 50px rgba(0,0,0,0.35)",
          padding: 0
        }}
        onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div
          style={{
            padding: "14px 16px 8px",
            borderBottom: "1px solid var(--line)",
            flexShrink: 0
          }}>
          <div
            className="row"
            style={{
              justifyContent: "space-between",
              alignItems: "flex-start",
              gap: 8
            }}>
            <h2 id="backup-fs-title" style={{ margin: 0, fontSize: "1.1rem" }}>
              {t("backup.fsTitle")}
            </h2>
            <button
              type="button"
              className="btn secondary btn-sm"
              onClick={onCancel}
              aria-label={t("backup.fsCancel")}>
              ✕
            </button>
          </div>
          <p className="muted" style={{ fontSize: 12, margin: "6px 0 0" }}>
            {t("backup.fsHint")}
          </p>
        </div>

        {/* Corps scrollable */}
        <div
          style={{
            flex: "1 1 auto",
            minHeight: 0,
            overflow: "auto",
            padding: "12px 16px"
          }}>
          <div style={{ marginBottom: 10 }}>
            <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>
              {t("backup.fsRoots")}
            </div>
            <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
              {roots.map((r) => (
                <button
                  key={r.path}
                  type="button"
                  className={`btn btn-sm ${
                    browsing === r.path || selected === r.path
                      ? ""
                      : "secondary"
                  }`}
                  disabled={loading}
                  title={r.path}
                  onClick={() => void openPath(r.path, true)}>
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          <div
            className="row"
            style={{
              gap: 8,
              alignItems: "center",
              marginBottom: 8,
              flexWrap: "wrap"
            }}>
            <button
              type="button"
              className="btn secondary btn-sm"
              disabled={loading || !parent}
              onClick={() => parent && void openPath(parent, true)}>
              {t("backup.fsUp")}
            </button>
            <button
              type="button"
              className="btn secondary btn-sm"
              disabled={loading || !browsing}
              onClick={() => setSelected(browsing)}>
              {t("backup.fsUseCurrent")}
            </button>
            <span
              className="mono"
              style={{
                fontSize: 12,
                flex: 1,
                minWidth: 0,
                wordBreak: "break-all"
              }}>
              <span className="muted">{t("backup.fsCurrent")}: </span>
              {browsing || "—"}
            </span>
          </div>

          {err ? (
            <p className="err" style={{ fontSize: 12, margin: "0 0 8px" }}>
              {err}
            </p>
          ) : null}

          <div
            style={{
              minHeight: 120,
              maxHeight: 200,
              overflow: "auto",
              border: "1px solid var(--line)",
              borderRadius: 8,
              background: "var(--surface-2, rgba(0,0,0,0.03))"
            }}>
            {loading ? (
              <p className="muted" style={{ padding: 12, margin: 0 }}>
                {t("backup.fsLoading")}
              </p>
            ) : entries.length === 0 ? (
              <p className="muted" style={{ padding: 12, margin: 0 }}>
                {t("backup.fsEmpty")}
              </p>
            ) : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {entries.map((e) => {
                  const isSel = selected === e.path
                  return (
                    <li key={e.path}>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr auto",
                          gap: 4,
                          alignItems: "center",
                          borderBottom: "1px solid var(--line)",
                          background: isSel
                            ? "rgba(15, 118, 110, 0.14)"
                            : "transparent"
                        }}>
                        <button
                          type="button"
                          onClick={() => setSelected(e.path)}
                          onDoubleClick={() => void openPath(e.path, true)}
                          style={{
                            display: "block",
                            width: "100%",
                            textAlign: "left",
                            padding: "8px 12px",
                            border: "none",
                            background: "transparent",
                            cursor: "pointer",
                            font: "inherit",
                            color: "inherit",
                            fontSize: 13,
                            fontWeight: isSel ? 650 : 400
                          }}>
                          📁 {e.name}
                        </button>
                        <button
                          type="button"
                          className="btn secondary btn-sm"
                          disabled={loading}
                          style={{ marginRight: 8 }}
                          onClick={() => void openPath(e.path, true)}>
                          {t("backup.fsOpen")}
                        </button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          <div
            style={{
              marginTop: 10,
              padding: "8px 10px",
              borderRadius: 8,
              border: "1px solid var(--accent, #0f766e)",
              background: "rgba(15, 118, 110, 0.08)"
            }}>
            <div className="muted" style={{ fontSize: 11 }}>
              {t("backup.fsSelected")}
            </div>
            <div
              className="mono"
              style={{
                fontSize: 13,
                wordBreak: "break-all",
                fontWeight: 700
              }}>
              {chosen || "—"}
            </div>
          </div>

          <div style={{ marginTop: 10 }}>
            <label className="field-label">{t("backup.fsRemote")}</label>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <input
                className="input mono"
                style={{ flex: 1, minWidth: 160 }}
                value={remote}
                placeholder={t("backup.fsRemotePlaceholder")}
                onChange={(e) => setRemote(e.target.value)}
                spellCheck={false}
              />
              <button
                type="button"
                className="btn secondary btn-sm"
                disabled={loading || !remote.trim()}
                onClick={() => {
                  setSelected(remote.trim())
                  void openPath(remote.trim(), true)
                }}>
                {t("backup.fsGo")}
              </button>
            </div>
          </div>

          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 12,
              marginTop: 10
            }}>
            <input
              type="checkbox"
              checked={createIfMissing}
              onChange={(e) => setCreateIfMissing(e.target.checked)}
            />
            {t("backup.fsCreate")}
          </label>
        </div>

        {/* Pied de page FIXE : toujours visible */}
        <div
          style={{
            flexShrink: 0,
            padding: "12px 16px",
            borderTop: "2px solid var(--line)",
            background: "var(--surface, #fff)",
            display: "flex",
            gap: 10,
            justifyContent: "flex-end",
            flexWrap: "wrap",
            alignItems: "center",
            boxShadow: "0 -4px 12px rgba(0,0,0,0.06)"
          }}>
          <button
            type="button"
            className="btn secondary"
            onClick={onCancel}
            style={{ minWidth: 100 }}>
            {t("backup.fsCancel")}
          </button>
          <button
            type="button"
            className="btn"
            disabled={!chosen}
            onClick={confirm}
            style={{
              minWidth: 180,
              fontWeight: 700,
              fontSize: 14,
              padding: "10px 18px"
            }}>
            {validateLabel}
          </button>
        </div>
      </div>
    </div>
  )

  if (typeof document === "undefined") return null
  return createPortal(modal, document.body)
}

function SystemSettingsView({
  busy,
  setBusy,
  setError,
  setInfo,
  orgCode,
  orgName,
  primaryEmail,
  lang,
  setLang,
  multiOrg,
  onMfaChange,
  t
}: {
  busy: boolean
  setBusy: (b: boolean) => void
  setError: (e: string | null) => void
  setInfo: (i: string | null) => void
  orgCode: string
  orgName: string
  primaryEmail: string
  lang: Lang
  setLang: (l: Lang) => void
  multiOrg?: boolean
  onMfaChange?: (enabled: boolean) => void
  t: (k: string, vars?: Record<string, string | number>) => string
}) {
  const dtPrefs = useDateTimePrefs()
  const [settingsTab, setSettingsTab] = useState<SettingsSection>(() => {
    try {
      const h = parseConsoleHash(window.location.hash)
      if (h?.tab === "settings" && h.settingsSection) return h.settingsSection
      const s = sessionStorage.getItem(
        "opsgate_console_settings_tab"
      ) as SettingsSection | null
      if (
        s &&
        [
          "general",
          "logs",
          "license",
          "notifications",
          "monitoring",
          "ldap",
          "mail",
          "reports"
        ].includes(s)
      ) {
        return s
      }
    } catch {
      /* ignore */
    }
    return "general"
  })
  const [addLicOpen, setAddLicOpen] = useState(false)
  const [licenseKeyInput, setLicenseKeyInput] = useState("")
  const [licMode, setLicMode] = useState<"trial" | "full">("trial")
  const [licDaysLeft, setLicDaysLeft] = useState<number | null>(null)
  const [billingEnabled, setBillingEnabled] = useState(false)
  const [billingPortalOk, setBillingPortalOk] = useState(false)
  const [billingSubStatus, setBillingSubStatus] = useState<string | null>(null)
  const [billingQty, setBillingQty] = useState(5)
  const [billingNote, setBillingNote] = useState("")
  const [gdprDeleted, setGdprDeleted] = useState(false)
  const [gdprPurgeAt, setGdprPurgeAt] = useState<string | null>(null)
  const [gdprDaysLeft, setGdprDaysLeft] = useState<number | null>(null)
  const [gdprProtected, setGdprProtected] = useState(false)
  const [gdprConfirmPhrase, setGdprConfirmPhrase] = useState("DELETE MY ORG")
  const [gdprRestorePhrase, setGdprRestorePhrase] = useState("RESTORE MY ORG")
  const [gdprConfirmInput, setGdprConfirmInput] = useState("")
  const [gdprReason, setGdprReason] = useState("")
  const [agentUiLang, setAgentUiLang] = useState<"fr" | "en" | "auto">("fr")
  const [proxyEnabled, setProxyEnabled] = useState(true)
  const [proxyMode, setProxyMode] = useState<"observe" | "enforce">("enforce")
  const [onlineMin, setOnlineMin] = useState(15)
  const [offlineMin, setOfflineMin] = useState(120)
  const [schedOn, setSchedOn] = useState(false)
  const [tz, setTz] = useState("Europe/Paris")
  const [workStart, setWorkStart] = useState("08:00")
  const [workEnd, setWorkEnd] = useState("17:00")
  const [breakStart, setBreakStart] = useState("12:00")
  const [breakEnd, setBreakEnd] = useState("13:00")
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5])
  const [retentionDays, setRetentionDays] = useState(90)
  const [auditLegalDays, setAuditLegalDays] = useState(365)
  const [autoBackupOn, setAutoBackupOn] = useState(false)
  const [autoBackupInterval, setAutoBackupInterval] = useState<7 | 14 | 30>(7)
  const [autoBackupKeep, setAutoBackupKeep] = useState(8)
  const [autoBackupDirectory, setAutoBackupDirectory] = useState("")
  /** Chemin vérifié joignable+inscriptible côté serveur (null = pas encore vérifié) */
  const [autoBackupVerifiedPath, setAutoBackupVerifiedPath] = useState<
    string | null
  >(null)
  const [autoBackupVerifyBusy, setAutoBackupVerifyBusy] = useState(false)
  const [autoBackupVerifyMsg, setAutoBackupVerifyMsg] = useState<string | null>(
    null
  )
  const [autoBackupFsOpen, setAutoBackupFsOpen] = useState(false)
  const [autoBackupLast, setAutoBackupLast] = useState<string | null>(null)
  const [autoBackupLastOk, setAutoBackupLastOk] = useState<boolean | null>(
    null
  )
  const [autoBackupLastDetail, setAutoBackupLastDetail] = useState<
    string | null
  >(null)
  const [autoBackupDirResolved, setAutoBackupDirResolved] = useState("")
  const [autoBackupDbSet, setAutoBackupDbSet] = useState(false)
  const [schedExpOn, setSchedExpOn] = useState(false)
  const [schedExpEmails, setSchedExpEmails] = useState("")
  const [schedExpDay, setSchedExpDay] = useState(1)
  const [schedExpTime, setSchedExpTime] = useState("08:00")
  const [schedExpTz, setSchedExpTz] = useState("Europe/Paris")
  const [schedExpCsv, setSchedExpCsv] = useState(true)
  const [schedExpJson, setSchedExpJson] = useState(false)
  const [schedExpAttach, setSchedExpAttach] = useState(true)
  const [manualExportFmt, setManualExportFmt] = useState<"csv" | "json">("csv")
  const [exportArchives, setExportArchives] = useState<
    Array<{
      id: string
      kind: string
      format: string
      filename: string
      event_count: number
      created_at: string
      remaining_days: number
    }>
  >([])
  const [logDetection, setLogDetection] = useState(true)
  const [logProxy, setLogProxy] = useState(true)
  const [logLogin, setLogLogin] = useState(true)
  const [logAudit, setLogAudit] = useState(true)
  const [logAgentLife, setLogAgentLife] = useState(true)
  const [notifLicExp, setNotifLicExp] = useState(true)
  const [notifLicDays, setNotifLicDays] = useState(30)
  const [notifBrute, setNotifBrute] = useState(true)
  const [notifBruteThr, setNotifBruteThr] = useState(5)
  const [notifLockoutMail, setNotifLockoutMail] = useState(false)
  const [notifRecovery, setNotifRecovery] = useState(false)
  const [notifRecoveryThr, setNotifRecoveryThr] = useState(5)
  const [notifEmails, setNotifEmails] = useState("")
  const [notifChannels, setNotifChannels] = useState<NotificationChannel[]>([])
  const [siemOn, setSiemOn] = useState(false)
  const [siemHost, setSiemHost] = useState("")
  const [siemPort, setSiemPort] = useState(514)
  const [siemProto, setSiemProto] = useState<"udp" | "tcp">("udp")
  const [siemFormat, setSiemFormat] = useState<"rfc5424" | "cef">("rfc5424")
  const [siemFacility, setSiemFacility] = useState(16)
  const [siemApp, setSiemApp] = useState("OpsGate")
  const [quotaEventsDay, setQuotaEventsDay] = useState(0)
  const [quotaEventsMin, setQuotaEventsMin] = useState(0)
  const [quotaAgents, setQuotaAgents] = useState(0)
  const [ldapOn, setLdapOn] = useState(false)
  const [ldapUrl, setLdapUrl] = useState("ldaps://dc.example.com:636")
  const [ldapBindDn, setLdapBindDn] = useState("")
  const [ldapBindPwd, setLdapBindPwd] = useState("")
  const [ldapBaseDn, setLdapBaseDn] = useState("")
  const [ldapUserFilter, setLdapUserFilter] = useState(
    "(&(objectCategory=person)(objectClass=user)(!(userAccountControl:1.2.840.113556.1.4.803:=2)))"
  )
  const [ldapGroupFilter, setLdapGroupFilter] = useState("(objectClass=group)")
  const [ldapSyncUsers, setLdapSyncUsers] = useState(true)
  const [ldapSyncGroups, setLdapSyncGroups] = useState(true)
  const [ldapTlsInsecure, setLdapTlsInsecure] = useState(false)
  const [ldapPwdSet, setLdapPwdSet] = useState(false)
  const [ldapLastMsg, setLdapLastMsg] = useState("")
  const [smtpOn, setSmtpOn] = useState(false)
  const [smtpHost, setSmtpHost] = useState("")
  const [smtpPort, setSmtpPort] = useState(587)
  const [smtpSecure, setSmtpSecure] = useState(false)
  const [smtpUser, setSmtpUser] = useState("")
  const [smtpPass, setSmtpPass] = useState("")
  const [smtpFrom, setSmtpFrom] = useState("")
  const [smtpTlsInsecure, setSmtpTlsInsecure] = useState(false)
  const [smtpPwdSet, setSmtpPwdSet] = useState(false)
  const [smtpStatusLine, setSmtpStatusLine] = useState("")
  const [mfaSecret, setMfaSecret] = useState("")
  const [mfaOtpUrl, setMfaOtpUrl] = useState("")
  const [mfaCode, setMfaCode] = useState("")
  const [mfaPwd, setMfaPwd] = useState("")
  const [mfaOn, setMfaOn] = useState(false)
  const [licCompany, setLicCompany] = useState("")
  const [licAddress, setLicAddress] = useState("")
  const [licEmail, setLicEmail] = useState("")
  const [licExpires, setLicExpires] = useState("")
  const [licHash, setLicHash] = useState("")
  const [reportFormat, setReportFormat] = useState<"csv" | "json">(() => {
    try {
      return localStorage.getItem("opsgate_report_format") === "json"
        ? "json"
        : "csv"
    } catch {
      return "csv"
    }
  })
  const [licStats, setLicStats] = useState<{
    seats: number
    seats_used: number
    seats_available: number | null
    licensed_agents: number
    unlicensed_agents: number
  } | null>(null)
  const [loaded, setLoaded] = useState(false)

  // Charger SMTP seulement quand l’onglet mail est ouvert (évite lenteur)
  useEffect(() => {
    if (settingsTab !== "mail") return
    void (async () => {
      try {
        const ms = await api.mailStatus()
        setSmtpStatusLine(
          ms.configured
            ? `${t("mail.configured")} · ${ms.host || ""}:${ms.port || ""} · ${ms.from || ""}`
            : t("mail.notConfigured")
        )
        if (ms.smtp) {
          setSmtpOn(!!ms.smtp.enabled)
          setSmtpHost(ms.smtp.host || "")
          setSmtpPort(ms.smtp.port || 587)
          setSmtpSecure(!!ms.smtp.secure)
          setSmtpUser(ms.smtp.user || "")
          setSmtpFrom(ms.smtp.from || "")
          setSmtpTlsInsecure(!!ms.smtp.tlsInsecure)
          setSmtpPwdSet(!!ms.smtp.password_set)
        }
      } catch {
        /* ignore */
      }
    })()
  }, [settingsTab, t])

  // État MFA depuis /auth/me (obligatoire multi-tenant)
  useEffect(() => {
    void (async () => {
      try {
        const me = await api.me()
        const on = !!me.mfa_enabled
        setMfaOn(on)
        onMfaChange?.(on)
      } catch {
        /* ignore */
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        const r = await api.monitoring()
        const m = r.monitoring
        setAgentUiLang(
          m.agentUiLang === "en" || m.agentUiLang === "auto"
            ? m.agentUiLang
            : "fr"
        )
        setProxyEnabled(m.proxy?.enabled !== false)
        setProxyMode(m.proxy?.mode === "observe" ? "observe" : "enforce")
        setOnlineMin(Math.round((m.onlineMs || 900000) / 60000))
        setOfflineMin(Math.round((m.offlineLongMs || 7200000) / 60000))
        setSchedOn(!!m.schedule?.enabled)
        setTz(m.schedule?.timezone || "Europe/Paris")
        // Alignement affichage logs/messages sur le fuseau org
        if (m.schedule?.timezone) {
          applyOrgTimezoneToPrefs(m.schedule.timezone)
        }
        setWorkStart(m.schedule?.workStart || "08:00")
        setWorkEnd(m.schedule?.workEnd || "17:00")
        setDays(m.schedule?.workDays || [1, 2, 3, 4, 5])
        setRetentionDays(m.logRetentionDays ?? 90)
        setAuditLegalDays(m.auditLegalRetentionDays ?? 365)
        {
          const s = m.scheduledLogExport
          const enabled =
            s?.enabled === true ||
            (s?.enabled !== false && m.weeklyExportEnabled === true)
          setSchedExpOn(!!enabled)
          setSchedExpEmails((s?.recipientEmails || []).join("\n"))
          setSchedExpDay(s?.dayOfWeek ?? 1)
          setSchedExpTime(s?.timeLocal || "08:00")
          setSchedExpTz(
            s?.timezone || m.schedule?.timezone || "Europe/Paris"
          )
          const fmts = s?.formats || m.weeklyExportFormats || ["csv"]
          setSchedExpCsv(fmts.includes("csv"))
          setSchedExpJson(fmts.includes("json"))
          setSchedExpAttach(s?.attachFiles !== false)
        }
        {
          const ab = m.autoBackup as
            | {
                enabled?: boolean
                intervalDays?: number
                keepCount?: number
                directory?: string
                lastRunAt?: string | null
                lastRunOk?: boolean | null
                lastRunDetail?: string | null
              }
            | undefined
          setAutoBackupOn(!!ab?.enabled)
          setAutoBackupInterval(
            ab?.intervalDays === 14 || ab?.intervalDays === 30
              ? ab.intervalDays
              : 7
          )
          setAutoBackupKeep(
            typeof ab?.keepCount === "number" && ab.keepCount >= 1
              ? ab.keepCount
              : 8
          )
          setAutoBackupDirectory(
            typeof ab?.directory === "string" ? ab.directory : ""
          )
          setAutoBackupVerifiedPath(null)
          setAutoBackupVerifyMsg(null)
          setAutoBackupLast(ab?.lastRunAt || null)
          setAutoBackupLastOk(
            typeof ab?.lastRunOk === "boolean" ? ab.lastRunOk : null
          )
          setAutoBackupLastDetail(ab?.lastRunDetail || null)
        }
        try {
          const st = await api.orgBackupAutoStatus()
          setAutoBackupDirResolved(st.backup_dir || "")
          setAutoBackupDbSet(!!st.database_url_set)
          if (st.auto_backup) {
            setAutoBackupOn(!!st.auto_backup.enabled)
            setAutoBackupInterval(
              st.auto_backup.intervalDays === 14 ||
                st.auto_backup.intervalDays === 30
                ? st.auto_backup.intervalDays
                : 7
            )
            setAutoBackupKeep(st.auto_backup.keepCount || 8)
            setAutoBackupDirectory(st.auto_backup.directory || "")
            setAutoBackupVerifiedPath(null)
            setAutoBackupLast(st.auto_backup.lastRunAt || null)
            setAutoBackupLastOk(
              typeof st.auto_backup.lastRunOk === "boolean"
                ? st.auto_backup.lastRunOk
                : null
            )
            setAutoBackupLastDetail(st.auto_backup.lastRunDetail || null)
          }
        } catch {
          /* ignore */
        }
        const br = m.schedule?.breaks?.[0]
        if (br) {
          setBreakStart(br.start)
          setBreakEnd(br.end)
        }
        const lc = m.logCategories
        if (lc) {
          setLogDetection(lc.detectionEvents !== false)
          setLogProxy(lc.proxyEvents !== false)
          setLogLogin(lc.adminLogin !== false)
          setLogAudit(lc.adminAudit !== false)
          setLogAgentLife(lc.agentLifecycle !== false)
        }
        const n = m.notifications
        if (n) {
          setNotifLicExp(n.licenseExpiring !== false)
          setNotifLicDays(n.licenseExpiringDays ?? 30)
          setNotifBrute(n.loginBruteForce !== false)
          setNotifBruteThr(n.loginBruteForceThreshold ?? 5)
          setNotifLockoutMail(n.accountLockoutEmail === true)
          setNotifRecovery(n.recoveryLowStock === true)
          setNotifRecoveryThr(n.recoveryLowStockThreshold ?? 5)
          setNotifEmails((n.alertEmails || []).join("\n"))
          setNotifChannels(
            Array.isArray(n.channels)
              ? n.channels.map((ch) => ({
                  id: ch.id,
                  kind: ch.kind,
                  enabled: ch.enabled !== false,
                  label: ch.label || "",
                  emails: ch.emails,
                  botToken: ch.botToken || "",
                  chatId: ch.chatId || "",
                  webhookUrl: ch.webhookUrl || ""
                }))
              : []
          )
        }
        const si = m.siem
        if (si) {
          setSiemOn(!!si.enabled)
          setSiemHost(si.host || "")
          setSiemPort(si.port || 514)
          setSiemProto(si.protocol === "tcp" ? "tcp" : "udp")
          setSiemFormat(si.format === "cef" ? "cef" : "rfc5424")
          setSiemFacility(
            typeof si.facility === "number" ? si.facility : 16
          )
          setSiemApp(si.appName || "OpsGate")
        }
        setQuotaEventsDay(m.quotas?.maxEventsPerDay ?? 0)
        setQuotaEventsMin(m.quotas?.maxEventsPerMinute ?? 0)
        setQuotaAgents(m.quotas?.maxAgents ?? 0)
        const sm = m.smtp
        if (sm) {
          setSmtpOn(!!sm.enabled)
          setSmtpHost(sm.host || "")
          setSmtpPort(sm.port || 587)
          setSmtpSecure(!!sm.secure)
          setSmtpUser(sm.user || "")
          setSmtpFrom(sm.from || "")
          setSmtpTlsInsecure(!!sm.tlsInsecure)
          setSmtpPwdSet(!!sm.password_set)
        }
        // SMTP : pas de mailStatus ici (lent) - chargé à l'onglet mail
        const ld = m.ldap
        if (ld) {
          setLdapOn(!!ld.enabled)
          setLdapUrl(ld.url || "ldaps://dc.example.com:636")
          setLdapBindDn(ld.bindDn || "")
          setLdapBaseDn(ld.baseDn || "")
          if (ld.userFilter) setLdapUserFilter(ld.userFilter)
          if (ld.groupFilter) setLdapGroupFilter(ld.groupFilter)
          setLdapSyncUsers(ld.syncUsers !== false)
          setLdapSyncGroups(ld.syncGroups !== false)
          setLdapTlsInsecure(!!ld.tlsInsecure)
          setLdapLastMsg(ld.lastSyncMessage || "")
        }
        try {
          const st = await api.ldapStatus()
          setLdapPwdSet(!!st.ldap?.bind_password_set)
          if (st.ldap?.lastSyncMessage)
            setLdapLastMsg(st.ldap.lastSyncMessage)
        } catch {
          /* ignore */
        }
        setLoaded(true)
      } catch (e) {
        setError(String(e))
      }
      try {
        const l = await api.licenses()
        setLicStats({
          seats: l.seats,
          seats_used: l.seats_used,
          seats_available: l.seats_available,
          licensed_agents: l.licensed_agents,
          unlicensed_agents: l.unlicensed_agents
        })
        if (l.license) {
          setLicMode(l.license.mode === "full" ? "full" : "trial")
          setLicHash(l.license.license_key_hash || "")
          setLicCompany(l.license.company_name || orgName || "")
          setLicAddress(l.license.address || "")
          setLicEmail(l.license.contact_email || primaryEmail || "")
          setLicExpires(
            l.license.expires_at
              ? String(l.license.expires_at).slice(0, 10)
              : ""
          )
          setLicDaysLeft(
            typeof l.license.days_left === "number" ? l.license.days_left : null
          )
        }
      } catch {
        /* ignore */
      }
      try {
        const b = await api.billingStatus()
        setBillingEnabled(!!b.enabled && !!b.price_seat_configured)
        setBillingPortalOk(!!b.portal_available)
        setBillingSubStatus(b.subscription_status || null)
        if (
          typeof b.subscription_quantity === "number" &&
          b.subscription_quantity > 0
        ) {
          setBillingQty(b.subscription_quantity)
        } else if (typeof b.org_seats === "number" && b.org_seats > 0) {
          setBillingQty(b.org_seats)
        }
        setBillingNote(b.note || "")
        // Retour Stripe Checkout
        try {
          const q = new URLSearchParams(window.location.search)
          const bill = q.get("billing")
          if (bill === "success") {
            setInfo(t("lic.billingSuccess") || "Paiement Stripe enregistré")
          } else if (bill === "cancel") {
            setInfo(t("lic.billingCancel") || "Checkout Stripe annulé")
          }
        } catch {
          /* ignore */
        }
      } catch {
        setBillingEnabled(false)
      }
      try {
        const g = await api.gdprStatus()
        setGdprDeleted(!!g.deleted)
        setGdprPurgeAt(g.purge_at)
        setGdprDaysLeft(
          typeof g.days_until_purge === "number" ? g.days_until_purge : null
        )
        setGdprProtected(!!g.protected)
        if (g.confirm_phrase) setGdprConfirmPhrase(g.confirm_phrase)
        if (g.restore_phrase) setGdprRestorePhrase(g.restore_phrase)
      } catch {
        /* ignore */
      }
    })()
  }, [setError, orgName, primaryEmail, t, setInfo])

  const dayLabels: [number, string][] = [
    [1, "Lun"],
    [2, "Mar"],
    [3, "Mer"],
    [4, "Jeu"],
    [5, "Ven"],
    [6, "Sam"],
    [7, "Dim"]
  ]

  const seatRatio =
    licStats && licStats.seats > 0
      ? Math.min(1, licStats.seats_used / licStats.seats)
      : 0

  const verifyAutoBackupDir = async (
    dir: string,
    createIfMissing = true
  ): Promise<{ ok: boolean; path?: string; error?: string }> => {
    const p = dir.trim()
    if (!p) {
      return { ok: false, error: t("backup.autoDirRequired") }
    }
    setAutoBackupVerifyBusy(true)
    setAutoBackupVerifyMsg(null)
    try {
      const r = await api.backupFsVerify(p, createIfMissing)
      if (r.ok) {
        const resolved = r.resolved || r.path || p
        setAutoBackupDirectory(resolved)
        setAutoBackupVerifiedPath(resolved)
        setAutoBackupDirResolved(resolved)
        setAutoBackupVerifyMsg(t("backup.autoDirVerified"))
        return { ok: true, path: resolved }
      }
      setAutoBackupVerifiedPath(null)
      const err = r.error || t("backup.autoDirUnreachable")
      setAutoBackupVerifyMsg(err)
      return { ok: false, error: err }
    } catch (e) {
      setAutoBackupVerifiedPath(null)
      const err = String(e)
      setAutoBackupVerifyMsg(err)
      return { ok: false, error: err }
    } finally {
      setAutoBackupVerifyBusy(false)
    }
  }

  const saveMonitoring = async () => {
    setBusy(true)
    setError(null)
    try {
      // Backup auto : dossier obligatoire + vérif joignable avant save
      let backupDir = autoBackupDirectory.trim()
      if (autoBackupOn) {
        if (!backupDir) {
          setError(t("backup.autoDirRequired"))
          setBusy(false)
          return
        }
        if (
          !autoBackupVerifiedPath ||
          autoBackupVerifiedPath.trim().toLowerCase() !==
            backupDir.toLowerCase()
        ) {
          const v = await verifyAutoBackupDir(backupDir, true)
          if (!v.ok) {
            setError(v.error || t("backup.autoDirMustVerify"))
            setBusy(false)
            return
          }
          backupDir = v.path || backupDir
        }
      }

      const daysClamped = Math.min(
        3650,
        Math.max(1, Math.floor(retentionDays) || 90)
      )
      const legalClamped = Math.min(
        3650,
        Math.max(90, Math.floor(auditLegalDays) || 365)
      )
      setRetentionDays(daysClamped)
      setAuditLegalDays(legalClamped)
      await api.updateMonitoring({
        agentUiLang,
        proxy: {
          enabled: proxyEnabled,
          mode: proxyMode
        },
        onlineMs: onlineMin * 60 * 1000,
        offlineLongMs: offlineMin * 60 * 1000,
        logRetentionDays: daysClamped,
        auditLegalRetentionDays: legalClamped,
        auditWormEnabled: true,
        weeklyExportEnabled: schedExpOn,
        weeklyExportFormats: [
          ...(schedExpCsv ? (["csv"] as const) : []),
          ...(schedExpJson ? (["json"] as const) : [])
        ].length
          ? [
              ...(schedExpCsv ? (["csv"] as const) : []),
              ...(schedExpJson ? (["json"] as const) : [])
            ]
          : (["csv"] as const),
        scheduledLogExport: {
          enabled: schedExpOn,
          recipientEmails: schedExpEmails
            .split(/[\n,;]+/)
            .map((e) => e.trim().toLowerCase())
            .filter((e) => e.includes("@"))
            .slice(0, 20),
          dayOfWeek: schedExpDay,
          timeLocal: schedExpTime,
          timezone: schedExpTz,
          formats: [
            ...(schedExpCsv ? (["csv"] as const) : []),
            ...(schedExpJson ? (["json"] as const) : [])
          ].length
            ? [
                ...(schedExpCsv ? (["csv"] as const) : []),
                ...(schedExpJson ? (["json"] as const) : [])
              ]
            : (["csv"] as const),
          attachFiles: schedExpAttach
        },
        logCategories: {
          detectionEvents: logDetection,
          proxyEvents: logProxy,
          adminLogin: logLogin,
          adminAudit: logAudit,
          agentLifecycle: logAgentLife
        },
        autoBackup: {
          enabled: autoBackupOn,
          intervalDays: autoBackupInterval,
          keepCount: Math.min(60, Math.max(1, Math.floor(autoBackupKeep) || 8)),
          directory: backupDir
        },
        notifications: {
          licenseExpiring: notifLicExp,
          licenseExpiringDays: notifLicDays,
          loginBruteForce: notifBrute,
          loginBruteForceThreshold: notifBruteThr,
          accountLockoutEmail: notifLockoutMail,
          recoveryLowStock: notifRecovery,
          recoveryLowStockThreshold: notifRecoveryThr,
          alertEmails: notifEmails
            .split(/[\n,;]+/)
            .map((e) => e.trim().toLowerCase())
            .filter((e) => e.includes("@"))
            .slice(0, 20),
          channels: notifChannels.map((ch) => ({
            id: ch.id,
            kind: ch.kind,
            enabled: ch.enabled,
            label: ch.label || undefined,
            emails: ch.emails,
            botToken: ch.botToken || undefined,
            chatId: ch.chatId || undefined,
            webhookUrl: ch.webhookUrl || undefined
          }))
        },
        schedule: {
          enabled: schedOn,
          timezone: tz,
          workDays: days,
          workStart,
          workEnd,
          breaks:
            schedOn && breakStart && breakEnd
              ? [{ start: breakStart, end: breakEnd }]
              : []
        },
        siem: {
          enabled: siemOn,
          protocol: siemProto,
          host: siemHost.trim(),
          port: Math.min(65535, Math.max(1, Math.floor(siemPort) || 514)),
          facility: Math.min(23, Math.max(0, Math.floor(siemFacility) || 16)),
          format: siemFormat,
          appName: siemApp.trim() || "OpsGate"
        },
        quotas: {
          maxEventsPerDay: Math.max(0, Math.floor(quotaEventsDay) || 0),
          maxEventsPerMinute: Math.max(0, Math.floor(quotaEventsMin) || 0),
          maxAgents: Math.max(0, Math.floor(quotaAgents) || 0)
        },
        ldap: {
          enabled: ldapOn,
          url: ldapUrl.trim(),
          bindDn: ldapBindDn.trim(),
          ...(ldapBindPwd.trim()
            ? { bindPassword: ldapBindPwd.trim() }
            : {}),
          baseDn: ldapBaseDn.trim(),
          userFilter: ldapUserFilter.trim(),
          groupFilter: ldapGroupFilter.trim(),
          syncUsers: ldapSyncUsers,
          syncGroups: ldapSyncGroups,
          tlsInsecure: ldapTlsInsecure
        }
      })
      setLdapBindPwd("")
      if (ldapBindPwd.trim()) setLdapPwdSet(true)
      try {
        localStorage.setItem("opsgate_report_format", reportFormat)
        setStoredLang(lang)
      } catch {
        /* ignore */
      }
      // Fuseau org → affichage logs / messages (GMT+4, etc.)
      if (tz?.trim()) applyOrgTimezoneToPrefs(tz.trim())
      setInfo(t("settings.saved"))
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  // Deep-link / event parent → sous-onglet settings
  useEffect(() => {
    const onEvt = (e: Event) => {
      const id = (e as CustomEvent<SettingsSection>).detail
      if (id) setSettingsTab(id)
    }
    window.addEventListener("opsgate-settings-tab", onEvt)
    return () => window.removeEventListener("opsgate-settings-tab", onEvt)
  }, [])

  useEffect(() => {
    try {
      sessionStorage.setItem("opsgate_console_settings_tab", settingsTab)
    } catch {
      /* ignore */
    }
    writeConsoleHash(
      { tab: "settings", settingsSection: settingsTab },
      "replace"
    )
  }, [settingsTab])

  if (!loaded) {
    return <div className="card empty">{t("common.loading")}</div>
  }

  const settingsTabs: SettingsSection[] = [
    "general",
    "logs",
    "license",
    "notifications",
    "monitoring",
    "ldap",
    "mail",
    "reports"
  ]

  return (
    <>
      <div className="card">
        <h2>{t("settings.title")}</h2>
        <div className="settings-tabs" role="tablist">
          {settingsTabs.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={settingsTab === id}
              className={`settings-tab ${settingsTab === id ? "active" : ""}`}
              onClick={() => {
                setSettingsTab(id)
                writeConsoleHash(
                  { tab: "settings", settingsSection: id },
                  "push"
                )
              }}>
              {t(`settings.tab.${id}`)}
            </button>
          ))}
        </div>

        {settingsTab === "general" && (
        <div className="settings-section">
          <h3>{t("settings.lang")}</h3>
          <div className="form-stack" style={{ maxWidth: 420 }}>
            <label className="field-label">{t("settings.lang.ui")}</label>
            <select
              className="input"
              value={lang}
              onChange={(e) =>
                setLang(e.target.value === "en" ? "en" : "fr")
              }>
              <option value="fr">Français</option>
              <option value="en">English</option>
            </select>
            <p className="muted" style={{ fontSize: 12, margin: 0 }}>
              {t("settings.lang.hint")}
            </p>
          </div>

          <h3 style={{ marginTop: 28 }}>{t("settings.agentLang")}</h3>
          <div className="form-stack" style={{ maxWidth: 420 }}>
            <label className="field-label">{t("settings.agentLang")}</label>
            <select
              className="input"
              value={agentUiLang}
              onChange={(e) => {
                const v = e.target.value
                setAgentUiLang(
                  v === "en" || v === "auto" ? v : "fr"
                )
              }}>
              <option value="fr">{t("settings.agentLang.fr")}</option>
              <option value="en">{t("settings.agentLang.en")}</option>
              <option value="auto">{t("settings.agentLang.auto")}</option>
            </select>
            <p className="muted" style={{ fontSize: 12, margin: 0 }}>
              {t("settings.agentLang.hint")}
            </p>
          </div>

          <DateTimePrefsPanel t={t} setInfo={setInfo} />

          {/* RGPD soft-delete */}
          <h3 style={{ marginTop: 28 }}>{t("gdpr.title")}</h3>
          <div
            className="form-stack"
            style={{
              maxWidth: 520,
              padding: 12,
              border: "1px solid var(--line)",
              borderRadius: 4,
              background: gdprDeleted ? "rgba(239,68,68,0.08)" : "var(--surface-2)"
            }}>
            <p className="muted" style={{ fontSize: 12, margin: 0 }}>
              {t("gdpr.hint")}
            </p>
            {gdprDeleted ? (
              <>
                <p style={{ fontSize: 13, margin: "8px 0 0" }}>
                  <strong style={{ color: "#ef4444" }}>{t("gdpr.deleted")}</strong>
                  {gdprPurgeAt && (
                    <>
                      {" · "}
                      {t("gdpr.purgeAt")}:{" "}
                      <span className="mono">
                        {String(gdprPurgeAt).slice(0, 10)}
                      </span>
                      {gdprDaysLeft != null && (
                        <>
                          {" "}
                          ({gdprDaysLeft} {t("gdpr.days")})
                        </>
                      )}
                    </>
                  )}
                </p>
                <label className="field-label">{t("gdpr.restoreConfirm")}</label>
                <input
                  className="input mono"
                  value={gdprConfirmInput}
                  onChange={(e) => setGdprConfirmInput(e.target.value)}
                  placeholder={gdprRestorePhrase}
                />
                <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="btn"
                    disabled={busy || gdprConfirmInput.trim() !== gdprRestorePhrase}
                    onClick={async () => {
                      setBusy(true)
                      setError(null)
                      try {
                        await api.gdprRestore(gdprConfirmInput.trim())
                        setGdprDeleted(false)
                        setGdprPurgeAt(null)
                        setGdprDaysLeft(null)
                        setGdprConfirmInput("")
                        setInfo(t("gdpr.restored"))
                      } catch (e) {
                        setError(String(e))
                      } finally {
                        setBusy(false)
                      }
                    }}>
                    {t("gdpr.restore")}
                  </button>
                  <button
                    type="button"
                    className="btn secondary"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true)
                      try {
                        const r = await api.gdprExport()
                        const blob = new Blob(
                          [JSON.stringify(r.export, null, 2)],
                          { type: "application/json" }
                        )
                        const a = document.createElement("a")
                        a.href = URL.createObjectURL(blob)
                        a.download = `opsgate-gdpr-export-${orgCode || "org"}.json`
                        a.click()
                        URL.revokeObjectURL(a.href)
                        setInfo(t("gdpr.exported"))
                      } catch (e) {
                        setError(String(e))
                      } finally {
                        setBusy(false)
                      }
                    }}>
                    {t("gdpr.export")}
                  </button>
                </div>
              </>
            ) : (
              <>
                {gdprProtected && (
                  <p className="muted" style={{ fontSize: 12, margin: "6px 0 0" }}>
                    {t("gdpr.protected")}
                  </p>
                )}
                <button
                  type="button"
                  className="btn secondary"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true)
                    try {
                      const r = await api.gdprExport()
                      const blob = new Blob(
                        [JSON.stringify(r.export, null, 2)],
                        { type: "application/json" }
                      )
                      const a = document.createElement("a")
                      a.href = URL.createObjectURL(blob)
                      a.download = `opsgate-gdpr-export-${orgCode || "org"}.json`
                      a.click()
                      URL.revokeObjectURL(a.href)
                      setInfo(t("gdpr.exported"))
                    } catch (e) {
                      setError(String(e))
                    } finally {
                      setBusy(false)
                    }
                  }}>
                  {t("gdpr.export")}
                </button>
                <label className="field-label" style={{ marginTop: 8 }}>
                  {t("gdpr.reason")}
                </label>
                <input
                  className="input"
                  value={gdprReason}
                  onChange={(e) => setGdprReason(e.target.value)}
                  placeholder={t("gdpr.reasonPh")}
                />
                <label className="field-label">{t("gdpr.deleteConfirm")}</label>
                <input
                  className="input mono"
                  value={gdprConfirmInput}
                  onChange={(e) => setGdprConfirmInput(e.target.value)}
                  placeholder={gdprConfirmPhrase}
                />
                <button
                  type="button"
                  className="btn danger"
                  disabled={
                    busy ||
                    gdprProtected ||
                    gdprConfirmInput.trim() !== gdprConfirmPhrase
                  }
                  onClick={async () => {
                    if (
                      !confirm(
                        t("gdpr.deleteWarn") ||
                          "Supprimer l’organisation ? Agents et sessions seront révoqués."
                      )
                    )
                      return
                    setBusy(true)
                    setError(null)
                    try {
                      const r = await api.gdprSoftDelete(
                        gdprConfirmInput.trim(),
                        gdprReason.trim() || undefined
                      )
                      setGdprDeleted(true)
                      setGdprPurgeAt(r.purge_at || null)
                      setGdprConfirmInput("")
                      setInfo(
                        r.message ||
                          t("gdpr.deletedOk") ||
                          "Organisation marquée pour suppression"
                      )
                      // Session bientôt invalide - inviter à recharger
                      setTimeout(() => {
                        window.location.hash = "#/settings/general"
                        window.location.reload()
                      }, 1500)
                    } catch (e) {
                      setError(String(e))
                    } finally {
                      setBusy(false)
                    }
                  }}>
                  {t("gdpr.softDelete")}
                </button>
              </>
            )}
          </div>

          <h3 style={{ marginTop: 24 }}>{t("mfa.title")}</h3>
          <p className="muted" style={{ fontSize: 12 }}>
            {t("mfa.hint")}{" "}
            {mfaOn ? (
              <strong style={{ color: "var(--accent-ink)" }}>
                · {t("mfa.enabled")}
              </strong>
            ) : null}
          </p>
          {multiOrg ? (
            <p
              className="mfa-multi-notice"
              style={{ fontSize: 12, margin: "0 0 10px" }}>
              {t("msp.mfaForced")}
            </p>
          ) : null}
          <div className="form-stack" style={{ maxWidth: 480 }}>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                className="btn secondary"
                disabled={busy || mfaOn}
                onClick={async () => {
                  setBusy(true)
                  try {
                    const r = await api.mfaSetup()
                    setMfaSecret(r.secret)
                    setMfaOtpUrl(r.otpauth_url)
                    setInfo(r.message || "OK")
                  } catch (e) {
                    setError(String(e))
                  } finally {
                    setBusy(false)
                  }
                }}>
                {t("mfa.setup")}
              </button>
            </div>
            {mfaSecret && (
              <>
                <div
                  className="row"
                  style={{
                    gap: 20,
                    flexWrap: "wrap",
                    alignItems: "flex-start",
                    marginTop: 4
                  }}>
                  {mfaOtpUrl ? <MfaQr otpauthUrl={mfaOtpUrl} size={180} /> : null}
                  <div style={{ flex: "1 1 220px", minWidth: 200 }}>
                    <p className="muted" style={{ fontSize: 12, margin: "0 0 8px" }}>
                      {t("mfa.qrHint")}
                    </p>
                    <label className="field-label">{t("mfa.secret")}</label>
                    <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                      <input
                        className="input mono"
                        readOnly
                        value={mfaSecret}
                        style={{ flex: 1, minWidth: 160 }}
                      />
                      <button
                        type="button"
                        className="btn secondary btn-sm"
                        onClick={() => {
                          void navigator.clipboard.writeText(mfaSecret)
                          setInfo(t("mfa.secretCopied"))
                        }}>
                        {t("mfa.copySecret")}
                      </button>
                    </div>
                  </div>
                </div>
                <label className="field-label" style={{ marginTop: 12 }}>
                  {t("mfa.code")}
                </label>
                <input
                  className="input mono"
                  value={mfaCode}
                  onChange={(e) =>
                    setMfaCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                  placeholder="123456"
                />
                <button
                  type="button"
                  className="btn"
                  disabled={busy || mfaCode.length !== 6}
                  onClick={async () => {
                    setBusy(true)
                    try {
                      await api.mfaEnable(mfaCode)
                      setMfaOn(true)
                      setMfaSecret("")
                      setMfaOtpUrl("")
                      setMfaCode("")
                      onMfaChange?.(true)
                      setInfo(t("mfa.enabled"))
                    } catch (e) {
                      setError(String(e))
                    } finally {
                      setBusy(false)
                    }
                  }}>
                  {t("mfa.enable")}
                </button>
              </>
            )}
            {!multiOrg && (
              <>
                <label className="field-label">{t("mfa.password")}</label>
                <input
                  className="input"
                  type="password"
                  value={mfaPwd}
                  onChange={(e) => setMfaPwd(e.target.value)}
                />
                <label className="field-label">{t("mfa.code")}</label>
                <input
                  className="input mono"
                  value={mfaCode}
                  onChange={(e) =>
                    setMfaCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                />
                <button
                  type="button"
                  className="btn danger"
                  disabled={busy || !mfaPwd}
                  onClick={async () => {
                    setBusy(true)
                    try {
                      await api.mfaDisable(mfaPwd, mfaCode)
                      setMfaOn(false)
                      setMfaPwd("")
                      setMfaCode("")
                      onMfaChange?.(false)
                      setInfo(t("mfa.disabled"))
                    } catch (e) {
                      setError(String(e))
                    } finally {
                      setBusy(false)
                    }
                  }}>
                  {t("mfa.disable")}
                </button>
              </>
            )}
            {multiOrg && mfaOn ? (
              <p className="muted" style={{ fontSize: 12, margin: 0 }}>
                {t("msp.mfaCannotDisable")}
              </p>
            ) : null}
          </div>

          <PasskeySettingsPanel t={t} setError={setError} setInfo={setInfo} setBusy={setBusy} busy={busy} />

          <h3 style={{ marginTop: 28 }}>{t("backup.title")}</h3>
          <p className="muted" style={{ fontSize: 12 }}>
            {t("backup.hint")}
          </p>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn secondary"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                try {
                  const r = await api.orgBackupExport()
                  const blob = new Blob([JSON.stringify(r.backup, null, 2)], {
                    type: "application/json"
                  })
                  const url = URL.createObjectURL(blob)
                  const a = document.createElement("a")
                  a.href = url
                  a.download = `opsgate-org-backup-${new Date().toISOString().slice(0, 10)}.json`
                  a.click()
                  URL.revokeObjectURL(url)
                  setInfo(t("backup.exported"))
                } catch (e) {
                  setError(String(e))
                } finally {
                  setBusy(false)
                }
              }}>
              {t("backup.export")}
            </button>
            <label className="btn secondary" style={{ cursor: "pointer", margin: 0 }}>
              {t("backup.import")}
              <input
                type="file"
                accept="application/json,.json"
                style={{ display: "none" }}
                onChange={async (e) => {
                  const f = e.target.files?.[0]
                  e.target.value = ""
                  if (!f) return
                  if (
                    !confirm(t("backup.importConfirm"))
                  ) {
                    return
                  }
                  setBusy(true)
                  try {
                    const text = await f.text()
                    const json = JSON.parse(text)
                    const r = await api.orgBackupImport(json)
                    setInfo(
                      t("backup.imported", {
                        list: (r.applied || []).join(", ") || "-"
                      })
                    )
                  } catch (err) {
                    setError(String(err))
                  } finally {
                    setBusy(false)
                  }
                }}
              />
            </label>
          </div>
          <p className="muted" style={{ fontSize: 11, marginTop: 8 }}>
            {t("backup.dbHint")}
          </p>

          <h3 style={{ marginTop: 28 }}>{t("backup.autoTitle")}</h3>
          <p className="muted" style={{ fontSize: 12 }}>
            {t("backup.autoHint")}
          </p>
          <div className="form-stack" style={{ maxWidth: 520 }}>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 13
              }}>
              <input
                type="checkbox"
                checked={autoBackupOn}
                onChange={(e) => setAutoBackupOn(e.target.checked)}
              />
              {t("backup.autoEnable")}
            </label>
            <label className="field-label">{t("backup.autoInterval")}</label>
            <select
              className="input"
              value={autoBackupInterval}
              disabled={!autoBackupOn}
              onChange={(e) => {
                const v = Number(e.target.value)
                setAutoBackupInterval(
                  v === 14 || v === 30 ? (v as 14 | 30) : 7
                )
              }}>
              <option value={7}>{t("backup.autoInterval7")}</option>
              <option value={14}>{t("backup.autoInterval14")}</option>
              <option value={30}>{t("backup.autoInterval30")}</option>
            </select>
            <label className="field-label">{t("backup.autoKeep")}</label>
            <input
              className="input"
              type="number"
              min={1}
              max={60}
              disabled={!autoBackupOn}
              value={autoBackupKeep}
              onChange={(e) =>
                setAutoBackupKeep(Number(e.target.value) || 8)
              }
            />
            <label className="field-label">{t("backup.autoDir")}</label>
            <div
              className="row"
              style={{ gap: 8, flexWrap: "wrap", alignItems: "stretch" }}>
              <input
                className="input mono"
                type="text"
                style={{ flex: "1 1 220px", minWidth: 0 }}
                disabled={!autoBackupOn}
                value={autoBackupDirectory}
                placeholder={t("backup.autoDirPlaceholder")}
                onChange={(e) => {
                  setAutoBackupDirectory(e.target.value)
                  setAutoBackupVerifiedPath(null)
                  setAutoBackupVerifyMsg(null)
                }}
                spellCheck={false}
                readOnly={false}
              />
              <button
                type="button"
                className="btn secondary"
                disabled={!autoBackupOn || busy}
                onClick={() => setAutoBackupFsOpen(true)}>
                {t("backup.autoDirBrowse")}
              </button>
              <button
                type="button"
                className="btn secondary"
                disabled={
                  !autoBackupOn ||
                  busy ||
                  autoBackupVerifyBusy ||
                  !autoBackupDirectory.trim()
                }
                onClick={() =>
                  void verifyAutoBackupDir(autoBackupDirectory, true)
                }>
                {autoBackupVerifyBusy
                  ? t("backup.fsLoading")
                  : t("backup.autoDirVerify")}
              </button>
            </div>
            <p className="muted" style={{ fontSize: 11, margin: 0 }}>
              {t("backup.autoDirHint")}
            </p>
            {autoBackupVerifyMsg ? (
              <p
                className={
                  autoBackupVerifiedPath ? "ok" : "err"
                }
                style={{ fontSize: 12, margin: 0 }}>
                {autoBackupVerifiedPath ? "✓ " : "✗ "}
                {autoBackupVerifyMsg}
                {autoBackupVerifiedPath
                  ? ` · ${autoBackupVerifiedPath}`
                  : ""}
              </p>
            ) : null}
            <p className="muted" style={{ fontSize: 12, margin: 0 }}>
              {t("backup.autoLast")}:{" "}
              {autoBackupLast
                ? `${formatDateTimeIso(autoBackupLast, dtPrefs, { withSeconds: true })} · ${
                    autoBackupLastOk === false
                      ? "⚠"
                      : autoBackupLastOk
                        ? "OK"
                        : "—"
                  }${autoBackupLastDetail ? ` · ${autoBackupLastDetail}` : ""}`
                : t("backup.autoNever")}
            </p>
            {autoBackupDirResolved ? (
              <p className="muted mono" style={{ fontSize: 11, margin: 0 }}>
                → {autoBackupDirResolved}
                {!autoBackupDbSet
                  ? " · (DATABASE_URL absent → config JSON seulement)"
                  : " · + pg_dump"}
              </p>
            ) : null}
            {autoBackupFsOpen ? (
              <BackupFsPickerModal
                t={t}
                initialPath={autoBackupDirectory}
                onCancel={() => setAutoBackupFsOpen(false)}
                onSelect={async (selected, createIfMissing) => {
                  setAutoBackupDirectory(selected)
                  setAutoBackupFsOpen(false)
                  const v = await verifyAutoBackupDir(
                    selected,
                    createIfMissing
                  )
                  if (!v.ok) {
                    setError(v.error || t("backup.autoDirUnreachable"))
                  }
                }}
              />
            ) : null}
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                className="btn secondary"
                disabled={busy || autoBackupVerifyBusy}
                onClick={() =>
                  void saveMonitoring().then(() => {
                    if (!busy) setInfo(t("backup.autoSaved"))
                  })
                }>
                {t("backup.autoSave")}
              </button>
              <button
                type="button"
                className="btn"
                disabled={busy || autoBackupVerifyBusy}
                onClick={async () => {
                  setBusy(true)
                  setError(null)
                  try {
                    let dir = autoBackupDirectory.trim()
                    if (autoBackupOn) {
                      if (!dir) {
                        setError(t("backup.autoDirRequired"))
                        return
                      }
                      if (
                        !autoBackupVerifiedPath ||
                        autoBackupVerifiedPath.trim().toLowerCase() !==
                          dir.toLowerCase()
                      ) {
                        const v = await verifyAutoBackupDir(dir, true)
                        if (!v.ok) {
                          setError(
                            v.error || t("backup.autoDirMustVerify")
                          )
                          return
                        }
                        dir = v.path || dir
                      }
                    }
                    await api.updateMonitoring({
                      autoBackup: {
                        enabled: autoBackupOn,
                        intervalDays: autoBackupInterval,
                        keepCount: Math.min(
                          60,
                          Math.max(1, Math.floor(autoBackupKeep) || 8)
                        ),
                        directory: dir
                      }
                    })
                    const r = await api.orgBackupAutoRun()
                    setInfo(
                      r.ok
                        ? `${t("backup.autoRunOk")} · ${(r.files || []).join(", ") || r.detail}`
                        : r.detail || t("backup.autoRunOk")
                    )
                    const st = await api.orgBackupAutoStatus()
                    setAutoBackupDirResolved(st.backup_dir || "")
                    if (st.auto_backup) {
                      setAutoBackupDirectory(st.auto_backup.directory || "")
                      setAutoBackupLast(st.auto_backup.lastRunAt || null)
                      setAutoBackupLastOk(
                        typeof st.auto_backup.lastRunOk === "boolean"
                          ? st.auto_backup.lastRunOk
                          : null
                      )
                      setAutoBackupLastDetail(
                        st.auto_backup.lastRunDetail || null
                      )
                    }
                  } catch (e) {
                    setError(String(e))
                  } finally {
                    setBusy(false)
                  }
                }}>
                {t("backup.autoRunNow")}
              </button>
            </div>
          </div>
        </div>
        )}

        {settingsTab === "logs" && (
        <div className="settings-section">
          <h3>{t("settings.tab.logs")}</h3>
          <div className="form-stack" style={{ maxWidth: 520 }}>
            <label className="field-label">{t("logs.retention")}</label>
            <input
              className="input"
              type="number"
              min={1}
              max={3650}
              value={retentionDays}
              onChange={(e) =>
                setRetentionDays(Number(e.target.value) || 90)
              }
            />
            <p className="muted" style={{ fontSize: 12, margin: 0 }}>
              {t("logs.retentionHint")}
            </p>
            <label className="field-label" style={{ marginTop: 12 }}>
              {t("logs.auditLegal")}
            </label>
            <input
              className="input"
              type="number"
              min={90}
              max={3650}
              value={auditLegalDays}
              onChange={(e) =>
                setAuditLegalDays(Number(e.target.value) || 365)
              }
            />
            <p className="muted" style={{ fontSize: 12, margin: 0 }}>
              {t("logs.auditLegalHint")}
            </p>
            <p className="muted" style={{ fontSize: 12, margin: "8px 0 0" }}>
              {t("logs.exportRedirect")}
            </p>
            <div className="field-label" style={{ marginTop: 8 }}>
              {t("logs.types")}
            </div>
            <p className="muted" style={{ fontSize: 12, margin: 0 }}>
              {t("logs.typesHint")}
            </p>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={logDetection}
                onChange={(e) => setLogDetection(e.target.checked)}
              />
              {t("logs.detection")}
            </label>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={logProxy}
                onChange={(e) => setLogProxy(e.target.checked)}
              />
              {t("logs.proxy")}
            </label>
            <p className="muted" style={{ fontSize: 11, margin: "0 0 0 24px" }}>
              {t("logs.proxyHint")}
            </p>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={logLogin}
                onChange={(e) => setLogLogin(e.target.checked)}
              />
              {t("logs.login")}
            </label>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={logAudit}
                onChange={(e) => setLogAudit(e.target.checked)}
              />
              {t("logs.audit")}
            </label>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={logAgentLife}
                onChange={(e) => setLogAgentLife(e.target.checked)}
              />
              {t("logs.agents")}
            </label>
          </div>
        </div>
        )}

        {settingsTab === "notifications" && (
        <div className="settings-section">
          <h3>{t("notif.title")}</h3>
          <div className="form-stack" style={{ maxWidth: 560 }}>
            <p className="muted" style={{ fontSize: 12, margin: 0 }}>
              {t("notif.hint")}
            </p>
            <label className="field-label">{t("notif.recipients")}</label>
            <textarea
              className="input"
              rows={3}
              value={notifEmails}
              onChange={(e) => setNotifEmails(e.target.value)}
              placeholder={"soc@entreprise.com\nadmin@entreprise.com"}
            />
            <p className="muted" style={{ fontSize: 11, margin: 0 }}>
              {t("notif.recipientsHint")}
            </p>

            <h4 style={{ margin: "16px 0 6px", fontSize: 14 }}>
              {t("notif.channels")}
            </h4>
            <p className="muted" style={{ fontSize: 12, margin: 0 }}>
              {t("notif.channelsHint")}
            </p>
            {notifChannels.map((ch, idx) => (
              <div key={ch.id} className="notif-channel-card">
                <div
                  className="row"
                  style={{
                    gap: 8,
                    flexWrap: "wrap",
                    alignItems: "center",
                    marginBottom: 8
                  }}>
                  <label
                    style={{
                      display: "flex",
                      gap: 6,
                      alignItems: "center",
                      fontSize: 13
                    }}>
                    <input
                      type="checkbox"
                      checked={ch.enabled}
                      onChange={(e) => {
                        const next = [...notifChannels]
                        next[idx] = { ...ch, enabled: e.target.checked }
                        setNotifChannels(next)
                      }}
                    />
                    {t("notif.channelEnabled")}
                  </label>
                  <select
                    className="input"
                    style={{ maxWidth: 140 }}
                    value={ch.kind}
                    onChange={(e) => {
                      const kind = e.target.value as NotificationChannelKind
                      const next = [...notifChannels]
                      next[idx] = { ...ch, kind }
                      setNotifChannels(next)
                    }}>
                    <option value="telegram">Telegram</option>
                    <option value="slack">Slack</option>
                    <option value="webhook">Webhook</option>
                    <option value="email">E-mail</option>
                  </select>
                  <input
                    className="input"
                    style={{ flex: 1, minWidth: 120 }}
                    placeholder={t("notif.channelLabel")}
                    value={ch.label || ""}
                    onChange={(e) => {
                      const next = [...notifChannels]
                      next[idx] = { ...ch, label: e.target.value }
                      setNotifChannels(next)
                    }}
                  />
                  <button
                    type="button"
                    className="btn secondary btn-sm"
                    onClick={() =>
                      setNotifChannels(notifChannels.filter((_, i) => i !== idx))
                    }>
                    {t("notif.channelRemove")}
                  </button>
                </div>
                {ch.kind === "telegram" && (
                  <>
                    <label className="field-label">Bot token</label>
                    <input
                      className="input mono"
                      value={ch.botToken || ""}
                      onChange={(e) => {
                        const next = [...notifChannels]
                        next[idx] = { ...ch, botToken: e.target.value }
                        setNotifChannels(next)
                      }}
                      placeholder="123456:ABC-DEF…"
                    />
                    <label className="field-label">Chat ID</label>
                    <input
                      className="input mono"
                      value={ch.chatId || ""}
                      onChange={(e) => {
                        const next = [...notifChannels]
                        next[idx] = { ...ch, chatId: e.target.value }
                        setNotifChannels(next)
                      }}
                      placeholder="-100…"
                    />
                  </>
                )}
                {(ch.kind === "slack" || ch.kind === "webhook") && (
                  <>
                    <label className="field-label">
                      {ch.kind === "slack"
                        ? "Incoming Webhook URL"
                        : "Webhook URL"}
                    </label>
                    <input
                      className="input mono"
                      value={ch.webhookUrl || ""}
                      onChange={(e) => {
                        const next = [...notifChannels]
                        next[idx] = { ...ch, webhookUrl: e.target.value }
                        setNotifChannels(next)
                      }}
                      placeholder="https://…"
                    />
                  </>
                )}
                {ch.kind === "email" && (
                  <>
                    <label className="field-label">
                      {t("notif.channelEmails")}
                    </label>
                    <textarea
                      className="input"
                      rows={2}
                      value={(ch.emails || []).join("\n")}
                      onChange={(e) => {
                        const emails = e.target.value
                          .split(/[\n,;]+/)
                          .map((x) => x.trim().toLowerCase())
                          .filter((x) => x.includes("@"))
                        const next = [...notifChannels]
                        next[idx] = { ...ch, emails }
                        setNotifChannels(next)
                      }}
                      placeholder="alerts@entreprise.com"
                    />
                  </>
                )}
              </div>
            ))}
            <button
              type="button"
              className="btn secondary btn-sm"
              onClick={() =>
                setNotifChannels([
                  ...notifChannels,
                  {
                    id: `ch_${Date.now().toString(36)}`,
                    kind: "telegram",
                    enabled: true,
                    label: "",
                    botToken: "",
                    chatId: "",
                    webhookUrl: ""
                  }
                ])
              }>
              {t("notif.channelAdd")}
            </button>

            <h4 style={{ margin: "12px 0 4px", fontSize: 14 }}>
              {t("notif.events")}
            </h4>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={notifLicExp}
                onChange={(e) => setNotifLicExp(e.target.checked)}
              />
              {t("notif.licExp")}
            </label>
            {notifLicExp && (
              <div>
                <label className="field-label">{t("notif.licDays")}</label>
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={365}
                  value={notifLicDays}
                  onChange={(e) =>
                    setNotifLicDays(Number(e.target.value) || 30)
                  }
                  style={{ maxWidth: 120 }}
                />
              </div>
            )}
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={notifBrute}
                onChange={(e) => setNotifBrute(e.target.checked)}
              />
              {t("notif.brute")}
            </label>
            {notifBrute && (
              <div>
                <label className="field-label">{t("notif.bruteThr")}</label>
                <input
                  className="input"
                  type="number"
                  min={3}
                  max={50}
                  value={notifBruteThr}
                  onChange={(e) =>
                    setNotifBruteThr(Number(e.target.value) || 5)
                  }
                  style={{ maxWidth: 120 }}
                />
              </div>
            )}
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={notifLockoutMail}
                onChange={(e) => setNotifLockoutMail(e.target.checked)}
              />
              {t("notif.lockoutMail")}
            </label>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={notifRecovery}
                onChange={(e) => setNotifRecovery(e.target.checked)}
              />
              {t("notif.recovery")}
            </label>
            {notifRecovery && (
              <div>
                <label className="field-label">{t("notif.recoveryThr")}</label>
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={50}
                  value={notifRecoveryThr}
                  onChange={(e) =>
                    setNotifRecoveryThr(Number(e.target.value) || 5)
                  }
                  style={{ maxWidth: 120 }}
                />
              </div>
            )}
            <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
              {t("notif.smtpNote")}
            </p>
          </div>
        </div>
        )}

        {settingsTab === "license" && (
        <div className="settings-section">
          <h3>{t("settings.tab.license")}</h3>
          <div className="form-stack" style={{ maxWidth: 520 }}>
            <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
              <span
                className={`lic-status ${licMode === "full" ? "ok" : "grace"}`}>
                {licMode === "full" ? t("lic.full") : t("lic.trial")}
              </span>
              {licDaysLeft != null && (
                <span className="muted" style={{ fontSize: 13 }}>
                  {t("lic.daysLeft")}: <strong>{licDaysLeft}</strong>
                </span>
              )}
            </div>
            {licMode === "trial" && (
              <p className="muted" style={{ fontSize: 12, margin: 0 }}>
                {t("lic.trialHint")}
              </p>
            )}
            <label className="field-label">{t("lic.orgCode")}</label>
            <input className="input mono" value={orgCode || " - "} readOnly />
            <label className="field-label">{t("lic.company")}</label>
            <input className="input" value={licCompany || " - "} readOnly />
            <label className="field-label">{t("lic.address")}</label>
            <textarea
              className="input"
              rows={2}
              value={licAddress || " - "}
              readOnly
            />
            <label className="field-label">{t("lic.email")}</label>
            <input className="input" value={licEmail || " - "} readOnly />
            <label className="field-label">{t("lic.key")}</label>
            <input className="input mono" value={licHash || "TRIAL"} readOnly />
            <label className="field-label">{t("lic.expires")}</label>
            <input className="input" value={licExpires || " - "} readOnly />
            <p className="muted" style={{ fontSize: 12, margin: 0 }}>
              {t("lic.readonlyHint")}
            </p>
            <label className="field-label">{t("lic.seats")}</label>
            <p style={{ margin: 0, fontSize: 14 }}>
              <strong>
                {licStats
                  ? licStats.seats > 0
                    ? licStats.seats
                    : licMode === "trial"
                      ? "Trial"
                      : " - "
                  : " - "}
              </strong>
            </p>
            {licStats && licStats.seats > 0 && (
              <div className="seat-meter" aria-label="seats">
                <div className="seat-meter-track">
                  <div
                    className="seat-meter-fill"
                    style={{ width: `${Math.round(seatRatio * 100)}%` }}
                  />
                  <div
                    className="seat-meter-marker"
                    style={{ left: `${Math.round(seatRatio * 100)}%` }}>
                    <span className="seat-meter-count">
                      {licStats.seats_used}/{licStats.seats}
                    </span>
                  </div>
                </div>
                <div className="seat-meter-legend">
                  <span>0%</span>
                  <span>100%</span>
                </div>
              </div>
            )}

            {/* Portal personnel / billing Stripe */}
            <div
              className="form-stack"
              style={{
                marginTop: 12,
                padding: 12,
                border: "1px solid var(--line)",
                borderRadius: 4,
                background: "var(--surface-2)"
              }}>
              <h4 style={{ margin: "0 0 4px", fontSize: 14 }}>
                {t("lic.billingTitle")}
              </h4>
              <p className="muted" style={{ fontSize: 12, margin: 0 }}>
                {billingEnabled
                  ? t("lic.billingHint")
                  : t("lic.billingOff")}
              </p>
              {billingSubStatus && (
                <p style={{ fontSize: 13, margin: "6px 0 0" }}>
                  {t("lic.billingStatus")}:{" "}
                  <strong className="mono">{billingSubStatus}</strong>
                </p>
              )}
              {billingEnabled && (
                <>
                  <label className="field-label" style={{ marginTop: 8 }}>
                    {t("lic.billingQty")}
                  </label>
                  <input
                    className="input"
                    type="number"
                    min={1}
                    max={500}
                    value={billingQty}
                    onChange={(e) =>
                      setBillingQty(
                        Math.min(500, Math.max(1, Number(e.target.value) || 1))
                      )
                    }
                    style={{ maxWidth: 120 }}
                  />
                  <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      className="btn"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true)
                        setError(null)
                        try {
                          const r = await api.billingCheckout(billingQty)
                          if (r.url) {
                            window.location.href = r.url
                            return
                          }
                          setError("billing_no_url")
                        } catch (e) {
                          setError(String(e))
                        } finally {
                          setBusy(false)
                        }
                      }}>
                      {t("lic.billingCheckout")}
                    </button>
                    <button
                      type="button"
                      className="btn secondary"
                      disabled={busy || !billingPortalOk}
                      title={
                        billingPortalOk
                          ? undefined
                          : t("lic.billingPortalNeedCheckout")
                      }
                      onClick={async () => {
                        setBusy(true)
                        setError(null)
                        try {
                          const r = await api.billingPortal()
                          if (r.url) {
                            window.location.href = r.url
                            return
                          }
                          setError("billing_no_url")
                        } catch (e) {
                          setError(String(e))
                        } finally {
                          setBusy(false)
                        }
                      }}>
                      {t("lic.billingPortal")}
                    </button>
                  </div>
                </>
              )}
              {!billingEnabled && billingNote && (
                <p className="muted" style={{ fontSize: 11, marginTop: 6 }}>
                  {billingNote}
                </p>
              )}
            </div>

            {!addLicOpen ? (
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setAddLicOpen(true)}>
                  {t("lic.add")}
                </button>
                {licMode === "full" && (
                  <button
                    type="button"
                    className="btn danger"
                    disabled={busy}
                    onClick={async () => {
                      if (
                        !confirm(
                          "Supprimer la licence full et revenir en essai 30 j ?"
                        )
                      )
                        return
                      setBusy(true)
                      try {
                        await api.revokeLicense()
                        setLicMode("trial")
                        setLicCompany("")
                        setLicAddress("")
                        setLicEmail("")
                        setLicHash("TRIAL")
                        setLicExpires("")
                        setInfo(t("lic.revoked") || "Licence supprimée")
                        const l = await api.licenses()
                        setLicStats({
                          seats: l.seats,
                          seats_used: l.seats_used,
                          seats_available: l.seats_available,
                          licensed_agents: l.licensed_agents,
                          unlicensed_agents: l.unlicensed_agents
                        })
                        if (l.license) {
                          setLicDaysLeft(
                            typeof l.license.days_left === "number"
                              ? l.license.days_left
                              : null
                          )
                          setLicExpires(
                            l.license.expires_at
                              ? String(l.license.expires_at).slice(0, 10)
                              : ""
                          )
                        }
                      } catch (e) {
                        setError(String(e))
                      } finally {
                        setBusy(false)
                      }
                    }}>
                    {t("lic.revoke") || "Supprimer la licence"}
                  </button>
                )}
              </div>
            ) : (
              <div
                className="form-stack"
                style={{
                  padding: 12,
                  border: "1px solid var(--line)",
                  borderRadius: 4,
                  background: "var(--surface-2)"
                }}>
                <label className="field-label">{t("lic.add")}</label>
                <input
                  className="input mono"
                  value={licenseKeyInput}
                  onChange={(e) => setLicenseKeyInput(e.target.value)}
                  placeholder={t("lic.keyPlaceholder")}
                />
                <div className="row" style={{ gap: 8 }}>
                  <button
                    type="button"
                    className="btn"
                    disabled={busy || !licenseKeyInput.trim()}
                    onClick={async () => {
                      setBusy(true)
                      setError(null)
                      try {
                        const r = await api.activateLicense(
                          licenseKeyInput.trim()
                        )
                        setLicMode("full")
                        setLicCompany(r.license.company_name)
                        setLicAddress(r.license.address)
                        setLicEmail(r.license.contact_email)
                        setLicExpires(
                          String(r.license.expires_at).slice(0, 10)
                        )
                        setLicenseKeyInput("")
                        setAddLicOpen(false)
                        const l = await api.licenses()
                        setLicStats({
                          seats: l.seats,
                          seats_used: l.seats_used,
                          seats_available: l.seats_available,
                          licensed_agents: l.licensed_agents,
                          unlicensed_agents: l.unlicensed_agents
                        })
                        if (l.license) {
                          setLicHash(l.license.license_key_hash || "")
                          setLicDaysLeft(
                            typeof l.license.days_left === "number"
                              ? l.license.days_left
                              : null
                          )
                        }
                        setInfo(t("lic.activated"))
                      } catch (e) {
                        setError(String(e))
                      } finally {
                        setBusy(false)
                      }
                    }}>
                    {t("lic.activate")}
                  </button>
                  <button
                    type="button"
                    className="btn secondary"
                    onClick={() => {
                      setAddLicOpen(false)
                      setLicenseKeyInput("")
                    }}>
                    {t("lic.cancel")}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
        )}

        {settingsTab === "reports" && (
        <div className="settings-section">
          <h3>{t("settings.tab.reports")}</h3>

          {/* ── Export automatique des logs ── */}
          <div className="form-stack" style={{ maxWidth: 560, marginBottom: 24 }}>
            <h4 style={{ margin: "0 0 4px", fontSize: 15 }}>
              {t("rep.autoTitle")}
            </h4>
            <p className="muted" style={{ fontSize: 12, margin: 0 }}>
              {t("rep.autoHint")}
            </p>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={schedExpOn}
                onChange={(e) => setSchedExpOn(e.target.checked)}
              />
              {t("rep.autoEnable")}
            </label>
            {schedExpOn && (
              <>
                <label className="field-label">{t("rep.autoEmails")}</label>
                <textarea
                  className="input"
                  rows={3}
                  value={schedExpEmails}
                  onChange={(e) => setSchedExpEmails(e.target.value)}
                  placeholder={"admin@entreprise.com\nsoc@entreprise.com"}
                />
                <p className="muted" style={{ fontSize: 11, margin: 0 }}>
                  {t("rep.autoEmailsHint")}
                </p>
                <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
                  <div style={{ flex: "1 1 140px" }}>
                    <label className="field-label">{t("rep.autoDay")}</label>
                    <select
                      className="input"
                      value={schedExpDay}
                      onChange={(e) =>
                        setSchedExpDay(Number(e.target.value) || 1)
                      }>
                      <option value={1}>{t("rep.day.1")}</option>
                      <option value={2}>{t("rep.day.2")}</option>
                      <option value={3}>{t("rep.day.3")}</option>
                      <option value={4}>{t("rep.day.4")}</option>
                      <option value={5}>{t("rep.day.5")}</option>
                      <option value={6}>{t("rep.day.6")}</option>
                      <option value={7}>{t("rep.day.7")}</option>
                    </select>
                  </div>
                  <div style={{ flex: "1 1 120px" }}>
                    <label className="field-label">{t("rep.autoTime")}</label>
                    <input
                      className="input"
                      type="time"
                      value={schedExpTime}
                      onChange={(e) =>
                        setSchedExpTime(e.target.value || "08:00")
                      }
                    />
                  </div>
                  <div style={{ flex: "1 1 180px" }}>
                    <label className="field-label">{t("rep.autoTz")}</label>
                    <select
                      className="input"
                      value={schedExpTz}
                      onChange={(e) => setSchedExpTz(e.target.value)}>
                      {[
                        ...new Set([schedExpTz, ...COMMON_TIMEZONES])
                      ].map((z) => {
                        const lab =
                          TIMEZONE_OPTIONS.find(([id]) => id === z)?.[1] || z
                        return (
                          <option key={z} value={z}>
                            {lab}
                          </option>
                        )
                      })}
                    </select>
                  </div>
                </div>
                <div className="field-label">{t("rep.autoFormats")}</div>
                <div className="row" style={{ gap: 16, flexWrap: "wrap" }}>
                  <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input
                      type="checkbox"
                      checked={schedExpCsv}
                      onChange={(e) => setSchedExpCsv(e.target.checked)}
                    />
                    CSV
                  </label>
                  <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input
                      type="checkbox"
                      checked={schedExpJson}
                      onChange={(e) => setSchedExpJson(e.target.checked)}
                    />
                    JSON
                  </label>
                </div>
                <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    type="checkbox"
                    checked={schedExpAttach}
                    onChange={(e) => setSchedExpAttach(e.target.checked)}
                  />
                  {t("rep.autoAttach")}
                </label>
                <p className="muted" style={{ fontSize: 11, margin: 0 }}>
                  {t("rep.autoAttachHint")}
                </p>
                <p className="muted" style={{ fontSize: 12, margin: 0 }}>
                  {t("rep.autoSmtpNote")}
                </p>
                <button
                  type="button"
                  className="btn"
                  style={{ marginTop: 8 }}
                  disabled={busy || !schedExpEmails.trim()}
                  onClick={async () => {
                    setBusy(true)
                    setError(null)
                    try {
                      // Persiste e-mails / planning avant envoi
                      await api.updateMonitoring({
                        weeklyExportEnabled: true,
                        scheduledLogExport: {
                          enabled: true,
                          recipientEmails: schedExpEmails
                            .split(/[\n,;]+/)
                            .map((e) => e.trim().toLowerCase())
                            .filter((e) => e.includes("@"))
                            .slice(0, 20),
                          dayOfWeek: schedExpDay,
                          timeLocal: schedExpTime,
                          timezone: schedExpTz,
                          formats: [
                            ...(schedExpCsv ? (["csv"] as const) : []),
                            ...(schedExpJson ? (["json"] as const) : [])
                          ].length
                            ? [
                                ...(schedExpCsv ? (["csv"] as const) : []),
                                ...(schedExpJson ? (["json"] as const) : [])
                              ]
                            : (["csv"] as const),
                          attachFiles: schedExpAttach
                        }
                      })
                      setSchedExpOn(true)
                      const r = await api.runExportNow()
                      if ((r.mails_ok || 0) > 0) {
                        setInfo(
                          t("rep.runNowOk", {
                            n: r.mails_ok ?? 0,
                            week: r.weekKey || "?"
                          })
                        )
                      } else {
                        setError(r.hint || t("rep.runNowFail"))
                      }
                    } catch (e) {
                      setError(String(e))
                    } finally {
                      setBusy(false)
                    }
                  }}>
                  {t("rep.runNow")}
                </button>
                <p className="muted" style={{ fontSize: 11, margin: 0 }}>
                  {t("rep.runNowHint")}
                </p>
              </>
            )}
          </div>

          {/* ── Export manuel immédiat ── */}
          <div className="form-stack" style={{ maxWidth: 560, marginBottom: 24 }}>
            <h4 style={{ margin: "0 0 4px", fontSize: 15 }}>
              {t("rep.manualTitle")}
            </h4>
            <p className="muted" style={{ fontSize: 12, margin: 0 }}>
              {t("rep.manualHint")}
            </p>
            <label className="field-label">{t("rep.format")}</label>
            <select
              className="input"
              style={{ maxWidth: 200, display: "block" }}
              value={manualExportFmt}
              onChange={(e) => {
                const f = e.target.value === "json" ? "json" : "csv"
                setManualExportFmt(f)
                setReportFormat(f)
                try {
                  localStorage.setItem("opsgate_report_format", f)
                } catch {
                  /* ignore */
                }
              }}>
              <option value="csv">{t("rep.csv")}</option>
              <option value="json">{t("rep.json")}</option>
            </select>
            <div
              className="row"
              style={{
                gap: 10,
                flexWrap: "wrap",
                marginTop: 14,
                paddingTop: 4
              }}>
              <button
                type="button"
                className="btn btn-sm"
                disabled={busy}
                onClick={async () => {
                  setBusy(true)
                  try {
                    const r = await api.exportEvents("week", manualExportFmt)
                    const blob = new Blob([r.content], {
                      type:
                        manualExportFmt === "json"
                          ? "application/json"
                          : "text/csv;charset=utf-8"
                    })
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement("a")
                    a.href = url
                    a.download = r.filename
                    a.click()
                    URL.revokeObjectURL(url)
                    setInfo(
                      `${t("rep.downloaded")} · ${r.count} events · ${manualExportFmt.toUpperCase()}`
                    )
                  } catch (e) {
                    setError(String(e))
                  } finally {
                    setBusy(false)
                  }
                }}>
                {t("rep.downloadWeek")}
              </button>
              <button
                type="button"
                className="btn secondary btn-sm"
                disabled={busy}
                onClick={async () => {
                  setBusy(true)
                  try {
                    const r = await api.exportEvents("all", manualExportFmt)
                    const blob = new Blob([r.content], {
                      type:
                        manualExportFmt === "json"
                          ? "application/json"
                          : "text/csv;charset=utf-8"
                    })
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement("a")
                    a.href = url
                    a.download = r.filename
                    a.click()
                    URL.revokeObjectURL(url)
                    setInfo(
                      `${t("rep.downloaded")} · ${r.count} events · ${manualExportFmt.toUpperCase()}`
                    )
                  } catch (e) {
                    setError(String(e))
                  } finally {
                    setBusy(false)
                  }
                }}>
                {t("rep.downloadAll")}
              </button>
            </div>
          </div>

          {/* ── Archives générées ── */}
          <div className="form-stack" style={{ maxWidth: 640, marginBottom: 24 }}>
            <h4 style={{ margin: "0 0 4px", fontSize: 15 }}>
              {t("rep.archives")}
            </h4>
            <div className="row" style={{ gap: 8 }}>
              <button
                type="button"
                className="btn secondary btn-sm"
                disabled={busy}
                onClick={async () => {
                  setBusy(true)
                  try {
                    const r = await api.listEventExports()
                    setExportArchives(r.exports || [])
                    setInfo(
                      `${(r.exports || []).length} archive(s)`
                    )
                  } catch (e) {
                    setError(String(e))
                  } finally {
                    setBusy(false)
                  }
                }}>
                {t("rep.refreshArchives")}
              </button>
            </div>
            {exportArchives.length === 0 ? (
              <p className="muted" style={{ fontSize: 13 }}>
                {t("rep.noArchives")}
              </p>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>{t("rep.col.file")}</th>
                      <th>{t("rep.col.format")}</th>
                      <th>{t("rep.col.events")}</th>
                      <th>{t("rep.col.remaining")}</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {exportArchives.map((a) => (
                      <tr key={a.id}>
                        <td className="mono" style={{ fontSize: 12 }}>
                          {a.filename}
                        </td>
                        <td>{a.format.toUpperCase()}</td>
                        <td>{a.event_count}</td>
                        <td>{a.remaining_days} j</td>
                        <td>
                          <button
                            type="button"
                            className="btn btn-sm"
                            disabled={busy}
                            onClick={async () => {
                              setBusy(true)
                              try {
                                const r = await api.downloadEventExport(a.id)
                                const blob = new Blob([r.content], {
                                  type:
                                    r.format === "json"
                                      ? "application/json"
                                      : "text/csv;charset=utf-8"
                                })
                                const url = URL.createObjectURL(blob)
                                const el = document.createElement("a")
                                el.href = url
                                el.download = r.filename || a.filename
                                el.click()
                                URL.revokeObjectURL(url)
                                setInfo(t("rep.downloaded"))
                              } catch (e) {
                                setError(String(e))
                              } finally {
                                setBusy(false)
                              }
                            }}>
                            {t("rep.download")}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <SecurityReportPanel
            t={t}
            setError={setError}
            setInfo={setInfo}
            busy={busy}
            setBusy={setBusy}
          />
        </div>
        )}

        {settingsTab === "monitoring" && (
        <div className="settings-section">
          <h3>{t("settings.tab.monitoring")}</h3>
          <div className="form-stack" style={{ maxWidth: 520 }}>
            <h3 style={{ marginTop: 0, fontSize: 15 }}>{t("proxy.title")}</h3>
            <p className="muted" style={{ fontSize: 12, margin: 0 }}>
              {t("proxy.hint")}
            </p>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={proxyEnabled}
                onChange={(e) => setProxyEnabled(e.target.checked)}
              />
              {t("proxy.enabled")}
            </label>
            <label className="field-label">{t("proxy.mode")}</label>
            <select
              className="input"
              value={proxyMode}
              disabled={!proxyEnabled}
              onChange={(e) =>
                setProxyMode(
                  e.target.value === "observe" ? "observe" : "enforce"
                )
              }>
              <option value="observe">{t("proxy.mode.observe")}</option>
              <option value="enforce">{t("proxy.mode.enforce")}</option>
            </select>
            <p className="muted" style={{ fontSize: 11, margin: 0 }}>
              {proxyMode === "observe"
                ? t("proxy.mode.observeHint")
                : t("proxy.mode.enforceHint")}
            </p>
            <p className="muted" style={{ fontSize: 11, margin: 0 }}>
              {t("proxy.monitorHint")}
            </p>
            <hr style={{ border: "none", borderTop: "1px solid var(--line)", margin: "12px 0" }} />
            <label className="field-label">{t("mon.online")}</label>
            <input
              className="input"
              type="number"
              min={2}
              value={onlineMin}
              onChange={(e) => setOnlineMin(Number(e.target.value) || 15)}
            />
            <label className="field-label">{t("mon.offline")}</label>
            <input
              className="input"
              type="number"
              min={5}
              value={offlineMin}
              onChange={(e) => setOfflineMin(Number(e.target.value) || 120)}
            />
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={schedOn}
                onChange={(e) => setSchedOn(e.target.checked)}
              />
              {t("mon.schedule")}
            </label>
            {schedOn && (
              <>
                <label className="field-label">Fuseau horaire</label>
                <select
                  className="input"
                  value={tz}
                  onChange={(e) => setTz(e.target.value)}>
                  {[
                    ...new Map(
                      [
                        ...(tz
                          ? ([[tz, tz] as const] as Array<
                              readonly [string, string]
                            >)
                          : []),
                        ...TIMEZONE_OPTIONS
                      ].map((p) => [p[0], p] as const)
                    ).values()
                  ].map(([v, lab]) => (
                    <option key={v} value={v}>
                      {lab}
                    </option>
                  ))}
                </select>
                <label className="field-label">Jours travaillés</label>
                <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
                  {dayLabels.map(([d, lab]) => (
                    <label
                      key={d}
                      style={{
                        display: "flex",
                        gap: 4,
                        alignItems: "center"
                      }}>
                      <input
                        type="checkbox"
                        checked={days.includes(d)}
                        onChange={() =>
                          setDays((prev) =>
                            prev.includes(d)
                              ? prev.filter((x) => x !== d)
                              : [...prev, d].sort()
                          )
                        }
                      />
                      {lab}
                    </label>
                  ))}
                </div>
                <div className="row">
                  <div>
                    <label className="field-label">Début</label>
                    <input
                      className="input"
                      type="time"
                      value={workStart}
                      onChange={(e) => setWorkStart(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="field-label">Fin</label>
                    <input
                      className="input"
                      type="time"
                      value={workEnd}
                      onChange={(e) => setWorkEnd(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="field-label">Pause début</label>
                    <input
                      className="input"
                      type="time"
                      value={breakStart}
                      onChange={(e) => setBreakStart(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="field-label">Pause fin</label>
                    <input
                      className="input"
                      type="time"
                      value={breakEnd}
                      onChange={(e) => setBreakEnd(e.target.value)}
                    />
                  </div>
                </div>
              </>
            )}

            <hr style={{ border: 0, borderTop: "1px solid var(--line)", margin: "16px 0" }} />
            <h3 style={{ margin: "0 0 8px", fontSize: 15 }}>{t("siem.title")}</h3>
            <p className="muted" style={{ fontSize: 12, margin: 0 }}>
              {t("siem.hint")}
            </p>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={siemOn}
                onChange={(e) => setSiemOn(e.target.checked)}
              />
              {t("siem.enabled")}
            </label>
            {siemOn && (
              <>
                <label className="field-label">{t("siem.host")}</label>
                <input
                  className="input"
                  placeholder="siem.example.local"
                  value={siemHost}
                  onChange={(e) => setSiemHost(e.target.value)}
                />
                <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                  <div>
                    <label className="field-label">{t("siem.port")}</label>
                    <input
                      className="input"
                      type="number"
                      min={1}
                      max={65535}
                      value={siemPort}
                      onChange={(e) =>
                        setSiemPort(Number(e.target.value) || 514)
                      }
                    />
                  </div>
                  <div>
                    <label className="field-label">{t("siem.protocol")}</label>
                    <select
                      className="input"
                      value={siemProto}
                      onChange={(e) =>
                        setSiemProto(
                          e.target.value === "tcp" ? "tcp" : "udp"
                        )
                      }>
                      <option value="udp">UDP</option>
                      <option value="tcp">TCP</option>
                    </select>
                  </div>
                  <div>
                    <label className="field-label">{t("siem.format")}</label>
                    <select
                      className="input"
                      value={siemFormat}
                      onChange={(e) =>
                        setSiemFormat(
                          e.target.value === "cef" ? "cef" : "rfc5424"
                        )
                      }>
                      <option value="rfc5424">RFC 5424</option>
                      <option value="cef">CEF</option>
                    </select>
                  </div>
                </div>
                <label className="field-label">{t("siem.facility")}</label>
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={23}
                  value={siemFacility}
                  onChange={(e) =>
                    setSiemFacility(Number(e.target.value) || 16)
                  }
                />
                <label className="field-label">{t("siem.appName")}</label>
                <input
                  className="input"
                  value={siemApp}
                  onChange={(e) => setSiemApp(e.target.value)}
                />
              </>
            )}

            <hr style={{ border: 0, borderTop: "1px solid var(--line)", margin: "16px 0" }} />
            <h3 style={{ margin: "0 0 8px", fontSize: 15 }}>{t("siem.metrics")}</h3>
            <p className="muted" style={{ fontSize: 12, margin: 0 }}>
              {t("siem.metricsHint")}
            </p>
            <label className="field-label">{t("siem.metricsUrl")}</label>
            <input
              className="input mono"
              readOnly
              value={`${getApiBase().replace(/\/$/, "")}/metrics`}
            />

            <hr style={{ border: 0, borderTop: "1px solid var(--line)", margin: "16px 0" }} />
            <h3 style={{ margin: "0 0 8px", fontSize: 15 }}>{t("quota.title")}</h3>
            <p className="muted" style={{ fontSize: 12, margin: 0 }}>
              {t("quota.hint")}
            </p>
            <label className="field-label">{t("quota.eventsDay")}</label>
            <input
              className="input"
              type="number"
              min={0}
              value={quotaEventsDay}
              onChange={(e) =>
                setQuotaEventsDay(Number(e.target.value) || 0)
              }
            />
            <label className="field-label">{t("quota.eventsMin")}</label>
            <input
              className="input"
              type="number"
              min={0}
              value={quotaEventsMin}
              onChange={(e) =>
                setQuotaEventsMin(Number(e.target.value) || 0)
              }
            />
            <label className="field-label">{t("quota.agents")}</label>
            <input
              className="input"
              type="number"
              min={0}
              value={quotaAgents}
              onChange={(e) => setQuotaAgents(Number(e.target.value) || 0)}
            />
          </div>
        </div>
        )}

        {settingsTab === "mail" && (
          <div className="stack" style={{ gap: 10, marginTop: 12 }}>
            <h3 style={{ margin: 0, fontSize: 15 }}>{t("mail.title")}</h3>
            <p className="muted" style={{ fontSize: 12, margin: 0 }}>
              {t("mail.help")}
            </p>
            {smtpStatusLine && (
              <p style={{ fontSize: 13, margin: 0 }}>
                <strong>{t("mail.status")} :</strong> {smtpStatusLine}
              </p>
            )}
            <label className="row" style={{ gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={smtpOn}
                onChange={(e) => setSmtpOn(e.target.checked)}
              />
              {t("mail.enabled")}
            </label>
            <label className="field-label">{t("mail.host")}</label>
            <input
              className="input mono"
              value={smtpHost}
              onChange={(e) => setSmtpHost(e.target.value)}
              placeholder="smtp.office365.com"
              disabled={!smtpOn}
            />
            <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 120px" }}>
                <label className="field-label">{t("mail.port")}</label>
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={65535}
                  value={smtpPort}
                  onChange={(e) => setSmtpPort(Number(e.target.value) || 587)}
                  disabled={!smtpOn}
                />
              </div>
              <label
                className="row"
                style={{
                  gap: 8,
                  alignItems: "center",
                  marginTop: 22,
                  flex: "1 1 180px"
                }}>
                <input
                  type="checkbox"
                  checked={smtpSecure}
                  onChange={(e) => setSmtpSecure(e.target.checked)}
                  disabled={!smtpOn}
                />
                {t("mail.secure")}
              </label>
            </div>
            <label className="field-label">{t("mail.user")}</label>
            <input
              className="input mono"
              value={smtpUser}
              onChange={(e) => setSmtpUser(e.target.value)}
              placeholder="noreply@entreprise.com"
              disabled={!smtpOn}
              autoComplete="off"
            />
            <label className="field-label">{t("mail.password")}</label>
            <input
              className="input mono"
              type="password"
              value={smtpPass}
              onChange={(e) => setSmtpPass(e.target.value)}
              placeholder={
                smtpPwdSet ? "••••••••" : t("mail.passwordKeep")
              }
              disabled={!smtpOn}
              autoComplete="new-password"
            />
            <p className="muted" style={{ fontSize: 11, margin: 0 }}>
              {t("mail.passwordKeep")}
              {smtpPwdSet ? " · mot de passe déjà enregistré" : ""}
            </p>
            <label className="field-label">{t("mail.from")}</label>
            <input
              className="input"
              value={smtpFrom}
              onChange={(e) => setSmtpFrom(e.target.value)}
              placeholder="OpsGate <noreply@votre-domaine.com>"
              disabled={!smtpOn}
            />
            <p className="muted" style={{ fontSize: 11, margin: 0 }}>
              {t("mail.fromHelp")}
            </p>
            <label className="row" style={{ gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={smtpTlsInsecure}
                onChange={(e) => setSmtpTlsInsecure(e.target.checked)}
                disabled={!smtpOn}
              />
              {t("mail.tlsInsecure")}
            </label>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <button
                className="btn"
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true)
                  setError(null)
                  try {
                    const body: Parameters<typeof api.saveMailSettings>[0] = {
                      enabled: smtpOn,
                      host: smtpHost.trim(),
                      port: smtpPort,
                      secure: smtpSecure,
                      user: smtpUser.trim(),
                      from: smtpFrom.trim(),
                      tlsInsecure: smtpTlsInsecure
                    }
                    if (smtpPass.trim()) body.password = smtpPass.trim()
                    const r = await api.saveMailSettings(body)
                    setSmtpPass("")
                    setSmtpPwdSet(!!r.smtp.password_set)
                    setSmtpStatusLine(
                      r.status.configured
                        ? `${t("mail.configured")} · ${r.status.host || ""} · ${smtpFrom.trim() || "-"}`
                        : t("mail.notConfigured")
                    )
                    setInfo(t("mail.save") + " OK")
                  } catch (e) {
                    setError(String(e))
                  } finally {
                    setBusy(false)
                  }
                }}>
                {t("mail.save")}
              </button>
              <button
                className="btn secondary"
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true)
                  setError(null)
                  try {
                    const r = await api.testMail()
                    if (!r.ok || !r.verify?.ok) {
                      setError(
                        r.verify?.error || r.error || "SMTP verify failed"
                      )
                    } else {
                      setInfo(
                        `${t("mail.test")} OK (${r.verify.source || "-"})`
                      )
                    }
                  } catch (e) {
                    setError(String(e))
                  } finally {
                    setBusy(false)
                  }
                }}>
                {t("mail.test")}
              </button>
              <button
                className="btn secondary"
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true)
                  setError(null)
                  try {
                    const r = await api.testMail()
                    if (!r.verify?.ok) {
                      setError(r.verify?.error || "SMTP verify failed")
                    } else if (r.test_email && !r.test_email.ok) {
                      setError(
                        r.test_email.error || "Envoi test échoué"
                      )
                    } else {
                      setInfo(
                        `${t("mail.testSend")} OK` +
                          (r.test_email?.delivery
                            ? ` (${r.test_email.delivery})`
                            : "")
                      )
                    }
                  } catch (e) {
                    setError(String(e))
                  } finally {
                    setBusy(false)
                  }
                }}>
                {t("mail.testSend")}
              </button>
            </div>
          </div>
        )}

        {settingsTab === "ldap" && (
          <div className="stack" style={{ gap: 10, marginTop: 12 }}>
            <h3 style={{ margin: 0, fontSize: 15 }}>{t("ldap.title")}</h3>
            <p className="muted" style={{ fontSize: 12, margin: 0 }}>
              {t("ldap.hint")}
            </p>
            <label className="row" style={{ gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={ldapOn}
                onChange={(e) => setLdapOn(e.target.checked)}
              />
              {t("ldap.enabled")}
            </label>
            <label className="field-label">{t("ldap.url")}</label>
            <input
              className="input mono"
              value={ldapUrl}
              onChange={(e) => setLdapUrl(e.target.value)}
              placeholder="ldaps://dc.example.com:636"
            />
            <label className="field-label">{t("ldap.bindDn")}</label>
            <input
              className="input mono"
              value={ldapBindDn}
              onChange={(e) => setLdapBindDn(e.target.value)}
              placeholder="CN=svc-opsgate,OU=Service,DC=example,DC=com"
            />
            <label className="field-label">
              {t("ldap.bindPassword")}
              {ldapPwdSet ? ` (${t("ldap.passwordSet")})` : ""}
            </label>
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              value={ldapBindPwd}
              onChange={(e) => setLdapBindPwd(e.target.value)}
              placeholder={
                ldapPwdSet ? t("ldap.passwordKeep") : t("ldap.passwordNew")
              }
            />
            <label className="field-label">{t("ldap.baseDn")}</label>
            <input
              className="input mono"
              value={ldapBaseDn}
              onChange={(e) => setLdapBaseDn(e.target.value)}
              placeholder="DC=example,DC=com"
            />
            <label className="field-label">{t("ldap.userFilter")}</label>
            <input
              className="input mono"
              value={ldapUserFilter}
              onChange={(e) => setLdapUserFilter(e.target.value)}
            />
            <label className="field-label">{t("ldap.groupFilter")}</label>
            <input
              className="input mono"
              value={ldapGroupFilter}
              onChange={(e) => setLdapGroupFilter(e.target.value)}
            />
            <label className="row" style={{ gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={ldapSyncGroups}
                onChange={(e) => setLdapSyncGroups(e.target.checked)}
              />
              {t("ldap.syncGroups")}
            </label>
            <label className="row" style={{ gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={ldapSyncUsers}
                onChange={(e) => setLdapSyncUsers(e.target.checked)}
              />
              {t("ldap.syncUsers")}
            </label>
            <label className="row" style={{ gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={ldapTlsInsecure}
                onChange={(e) => setLdapTlsInsecure(e.target.checked)}
              />
              {t("ldap.tlsInsecure")}
            </label>
            {ldapLastMsg && (
              <p className="muted" style={{ fontSize: 12 }}>
                {t("ldap.lastSync")}: {ldapLastMsg}
              </p>
            )}
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <button
                className="btn secondary"
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true)
                  setError(null)
                  try {
                    await saveMonitoring()
                    const r = await api.ldapTest({
                      enabled: true,
                      url: ldapUrl.trim(),
                      bindDn: ldapBindDn.trim(),
                      bindPassword: ldapBindPwd.trim() || undefined,
                      baseDn: ldapBaseDn.trim(),
                      userFilter: ldapUserFilter,
                      groupFilter: ldapGroupFilter,
                      tlsInsecure: ldapTlsInsecure
                    })
                    setInfo(
                      r.ok
                        ? `${t("ldap.testOk")} (${r.entry_count ?? 0})`
                        : r.message
                    )
                    if (!r.ok) setError(r.message)
                  } catch (e) {
                    setError(String(e))
                  } finally {
                    setBusy(false)
                  }
                }}>
                {t("ldap.test")}
              </button>
              <button
                className="btn secondary"
                type="button"
                disabled={busy || !ldapOn}
                onClick={async () => {
                  setBusy(true)
                  setError(null)
                  try {
                    await saveMonitoring()
                    const r = await api.ldapSync(true)
                    setLdapLastMsg(r.message || "")
                    setInfo(
                      r.ok
                        ? `${t("ldap.dryOk")} g=${r.groups_seen} u=${r.users_seen}`
                        : r.message || t("ldap.fail")
                    )
                    if (!r.ok) setError(r.message || t("ldap.fail"))
                  } catch (e) {
                    setError(String(e))
                  } finally {
                    setBusy(false)
                  }
                }}>
                {t("ldap.dryRun")}
              </button>
              <button
                className="btn"
                type="button"
                disabled={busy || !ldapOn}
                onClick={async () => {
                  setBusy(true)
                  setError(null)
                  try {
                    await saveMonitoring()
                    const r = await api.ldapSync(false)
                    setLdapLastMsg(r.message || "")
                    setInfo(
                      r.ok
                        ? `${t("ldap.syncOk")} g=${r.groups_upserted}/${r.groups_seen} u=${r.users_upserted}/${r.users_seen}`
                        : r.message || t("ldap.fail")
                    )
                    if (!r.ok) setError(r.message || t("ldap.fail"))
                  } catch (e) {
                    setError(String(e))
                  } finally {
                    setBusy(false)
                  }
                }}>
                {t("ldap.sync")}
              </button>
            </div>
          </div>
        )}

        {settingsTab !== "license" && settingsTab !== "mail" && (
        <div className="row" style={{ marginTop: 8 }}>
          <button
            className="btn"
            type="button"
            disabled={busy}
            onClick={() => void saveMonitoring()}>
            {t("settings.save")}
          </button>
        </div>
        )}
      </div>
    </>
  )
}

function SupportView({
  t,
  onUnreadChange
}: {
  t: (k: string) => string
  onUnreadChange?: (n: number) => void
}) {
  const dtPrefs = useDateTimePrefs()
  const [filter, setFilter] = useState<
    "all" | "unread" | "open" | "read" | "replied" | "closed"
  >("all")
  const [messages, setMessages] = useState<import("./api").InboxMessage[]>([])
  const [unread, setUnread] = useState(0)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [replyDraft, setReplyDraft] = useState("")
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  const load = useCallback(async () => {
    setErr(null)
    try {
      const r = await api.inboxList({ status: filter, limit: 100 })
      setMessages(r.messages || [])
      setUnread(r.unread || 0)
      onUnreadChange?.(r.unread || 0)
    } catch (e) {
      setErr(String(e))
    }
  }, [filter, onUnreadChange])

  useEffect(() => {
    void load()
  }, [load])

  const catLabel = (c: string) => {
    const k = `inbox.cat.${c}` as const
    const v = t(k)
    return v === k ? c : v
  }
  const stLabel = (s: string) => {
    const k = `inbox.st.${s}` as const
    const v = t(k)
    return v === k ? s : v
  }

  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div
          className="row"
          style={{
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 8
          }}>
          <div>
            <h2 style={{ margin: 0 }}>{t("support.title")}</h2>
            <p className="muted" style={{ fontSize: 13, margin: "6px 0 0" }}>
              {t("support.intro")}
              {unread > 0 && (
                <strong style={{ marginLeft: 8, color: "var(--teal, #0f766e)" }}>
                  · {unread} {t("inbox.unreadBadge")}
                </strong>
              )}
            </p>
          </div>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <label className="row" style={{ gap: 6, fontSize: 13 }}>
              {t("inbox.filter")}
              <select
                className="input"
                style={{ width: 140 }}
                value={filter}
                onChange={(e) =>
                  setFilter(
                    e.target.value as
                      | "all"
                      | "unread"
                      | "open"
                      | "read"
                      | "replied"
                      | "closed"
                  )
                }>
                <option value="all">{t("inbox.all")}</option>
                <option value="unread">{t("inbox.unread")}</option>
                <option value="open">{t("inbox.open")}</option>
                <option value="read">{t("inbox.read")}</option>
                <option value="replied">{t("inbox.replied")}</option>
                <option value="closed">{t("inbox.closed")}</option>
              </select>
            </label>
            <button
              className="btn secondary btn-sm"
              type="button"
              disabled={busy}
              onClick={() => void load()}>
              {t("inbox.refresh")}
            </button>
          </div>
        </div>
        {err && <p className="err">{err}</p>}
        {info && <p className="ok">{info}</p>}
      </div>

      <div className="card">
        {messages.length === 0 ? (
          <p className="muted">{t("inbox.empty")}</p>
        ) : (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1.2fr 1.6fr 1fr 0.8fr 0.9fr",
                gap: 8,
                padding: "8px 12px",
                fontSize: 11,
                color: "var(--muted)",
                borderBottom: "1px solid var(--line)",
                fontWeight: 600
              }}>
              <span>{t("inbox.device")}</span>
              <span>{t("inbox.subject")}</span>
              <span>{t("inbox.category")}</span>
              <span>{t("inbox.status")}</span>
              <span>{t("inbox.date")}</span>
            </div>
            {messages.map((m) => {
              const open = expanded === m.id
              const isNew = m.status === "open"
              return (
                <div
                  key={m.id}
                  style={{ borderBottom: "1px solid var(--line)" }}>
                  <button
                    type="button"
                    onClick={async () => {
                      setExpanded(open ? null : m.id)
                      setReplyDraft("")
                      setInfo(null)
                      if (!open && m.status === "open") {
                        try {
                          await api.inboxMarkRead(m.id)
                          await load()
                        } catch {
                          /* ignore */
                        }
                      }
                    }}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1.2fr 1.6fr 1fr 0.8fr 0.9fr",
                      gap: 8,
                      width: "100%",
                      textAlign: "left",
                      padding: "10px 12px",
                      border: "none",
                      background: open
                        ? "var(--surface-2)"
                        : isNew
                          ? "rgba(43, 217, 197, 0.08)"
                          : "transparent",
                      cursor: "pointer",
                      font: "inherit",
                      color: "inherit",
                      fontWeight: isNew ? 650 : 400
                    }}>
                    <span style={{ fontSize: 13 }}>
                      {open ? "▼ " : "▶ "}
                      {m.device_label || m.agent_id.slice(0, 10)}
                    </span>
                    <span
                      style={{
                        fontSize: 13,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap"
                      }}>
                      {m.subject}
                    </span>
                    <span style={{ fontSize: 12 }}>{catLabel(m.category)}</span>
                    <span style={{ fontSize: 12 }}>{stLabel(m.status)}</span>
                    <span style={{ fontSize: 12 }}>
                      {formatDateTimeIso(m.created_at, dtPrefs)}
                    </span>
                  </button>
                  {open && (
                    <div
                      style={{
                        padding: "12px 16px 16px",
                        background: "var(--surface-2)",
                        fontSize: 13
                      }}>
                      <div className="muted" style={{ fontSize: 11 }}>
                        {t("inbox.body")}
                      </div>
                      <p style={{ whiteSpace: "pre-wrap", marginTop: 4 }}>
                        {m.body}
                      </p>
                      {(m.context_hostname || m.context_url) && (
                        <p className="muted" style={{ fontSize: 12 }}>
                          {t("inbox.context")}:{" "}
                          {m.context_hostname || m.context_url}
                        </p>
                      )}
                      {m.admin_reply && (
                        <div
                          style={{
                            marginTop: 12,
                            padding: 10,
                            borderRadius: 8,
                            background: "var(--surface, #fff)",
                            border: "1px solid var(--line)"
                          }}>
                          <div className="muted" style={{ fontSize: 11 }}>
                            {t("inbox.reply")}
                            {m.replied_by_admin_label
                              ? ` · ${m.replied_by_admin_label}`
                              : ""}
                          </div>
                          <p style={{ whiteSpace: "pre-wrap", margin: "4px 0 0" }}>
                            {m.admin_reply}
                          </p>
                        </div>
                      )}
                      {m.status !== "closed" && (
                        <div style={{ marginTop: 12 }}>
                          <label className="field-label">{t("inbox.reply")}</label>
                          <textarea
                            className="input"
                            rows={3}
                            value={replyDraft}
                            onChange={(e) => setReplyDraft(e.target.value)}
                            placeholder={t("inbox.replyPlaceholder")}
                          />
                          <div
                            className="row"
                            style={{ gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                            <button
                              className="btn btn-sm"
                              type="button"
                              disabled={busy || replyDraft.trim().length < 1}
                              onClick={async () => {
                                setBusy(true)
                                setErr(null)
                                try {
                                  await api.inboxReply(m.id, replyDraft.trim())
                                  setReplyDraft("")
                                  setInfo("Réponse envoyée")
                                  await load()
                                } catch (e) {
                                  setErr(String(e))
                                } finally {
                                  setBusy(false)
                                }
                              }}>
                              {t("inbox.sendReply")}
                            </button>
                            {m.status === "open" && (
                              <button
                                className="btn secondary btn-sm"
                                type="button"
                                disabled={busy}
                                title={t("inbox.alertHint")}
                                onClick={async () => {
                                  setBusy(true)
                                  try {
                                    await api.inboxMarkRead(m.id)
                                    await load()
                                  } catch (e) {
                                    setErr(String(e))
                                  } finally {
                                    setBusy(false)
                                  }
                                }}>
                                {t("inbox.ack")}
                              </button>
                            )}
                            <button
                              className="btn secondary btn-sm"
                              type="button"
                              disabled={busy}
                              onClick={async () => {
                                if (
                                  !confirm(
                                    m.admin_reply
                                      ? "Fermer ce fil ? (déjà répondu)"
                                      : "Fermer sans réponse ? L’utilisateur recevra une notification de clôture."
                                  )
                                )
                                  return
                                setBusy(true)
                                try {
                                  await api.inboxClose(m.id)
                                  setExpanded(null)
                                  setInfo(
                                    m.admin_reply
                                      ? "Fil fermé"
                                      : "Fil fermé - l’utilisateur sera notifié (popup)"
                                  )
                                  await load()
                                } catch (e) {
                                  setErr(String(e))
                                } finally {
                                  setBusy(false)
                                }
                              }}>
                              {t("inbox.close")}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </>
        )}
      </div>

      <div className="card help-card" style={{ marginTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>{t("support.contact")}</h3>
        <div className="help-grid">
          <div className="help-tile">
            <div className="help-tile-kicker">{t("support.ticket")}</div>
            <strong>{t("support.openTicket")}</strong>
            <p>
              <a href="mailto:contact@dailyops.tech?subject=%5BOpsGate%5D%20">
                contact@dailyops.tech
              </a>
            </p>
            <p className="muted" style={{ fontSize: 12 }}>
              {t("support.response")}
            </p>
          </div>
          <div className="help-tile">
            <div className="help-tile-kicker">{t("support.urgent")}</div>
            <strong>{t("support.recovery")}</strong>
            <p style={{ fontSize: 13 }}>{t("support.recoveryHint")}</p>
          </div>
        </div>
      </div>
    </div>
  )
}

function HelpView({ t }: { t: (k: string) => string }) {
  return (
    <div className="card help-card">
      <h2>{t("help.title")}</h2>
      <p className="muted" style={{ fontSize: 13, maxWidth: 560 }}>
        {t("help.intro")}
      </p>
      <div className="help-grid">
        <div className="help-tile">
          <div className="help-tile-kicker">{t("help.product")}</div>
          <strong>DailyOps.Tech</strong>
          <p>
            <a href="https://dailyops.tech" target="_blank" rel="noreferrer">
              dailyops.tech
            </a>
          </p>
          <p className="muted" style={{ fontSize: 12 }}>
            {t("help.productHint")}
          </p>
        </div>
        <div className="help-tile">
          <div className="help-tile-kicker">{t("help.docs")}</div>
          <strong>{t("help.userGuide")}</strong>
          <p style={{ fontSize: 13 }}>{t("help.userGuideHint")}</p>
          <p style={{ fontSize: 13, marginTop: 8 }}>{t("help.recoveryHint")}</p>
        </div>
        <div className="help-tile">
          <div className="help-tile-kicker">{t("help.legal")}</div>
          <strong>{t("help.privacy")}</strong>
          <p>
            <a
              href="https://dailyops.tech/privacy"
              target="_blank"
              rel="noreferrer">
              {t("help.privacyLink")}
            </a>
          </p>
        </div>
        <div className="help-tile">
          <div className="help-tile-kicker">{t("help.console")}</div>
          <strong>{t("help.shortcuts")}</strong>
          <ul className="help-list">
            <li>{t("help.shortcutSearch")}</li>
            <li>{t("help.shortcutTheme")}</li>
          </ul>
        </div>
      </div>
      <p className="muted" style={{ fontSize: 12, marginTop: 16 }}>
        OpsGate Console · V1 1.2
      </p>
    </div>
  )
}

function LoginScreen({
  apiBase,
  setApiBaseState,
  onSaveApi,
  health,
  onLoggedIn,
  t
}: {
  apiBase: string
  setApiBaseState: (v: string) => void
  onSaveApi: () => void
  health: string
  onLoggedIn: (a: AdminRow) => void
  t: (k: string, vars?: Record<string, string | number>) => string
}) {
  const [email, setEmail] = useState("admin@demo.local")
  const [password, setPassword] = useState("0000")
  const [totp, setTotp] = useState("")
  const [needMfa, setNeedMfa] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /** Challenge session concurrente (consentement 10 s) */
  const [challengeId, setChallengeId] = useState<string | null>(null)
  const [challengeLeft, setChallengeLeft] = useState(10)
  const [challengeStatus, setChallengeStatus] = useState<string | null>(null)
  /** Session concurrente via SSO OIDC */
  const [canForceOidc, setCanForceOidc] = useState(false)
  const [oidcEnabled, setOidcEnabled] = useState(false)
  const [oidcIssuer, setOidcIssuer] = useState<string | null>(null)
  const [ssoEnforce, setSsoEnforce] = useState(false)
  /** null | email | otp */
  const [resetStep, setResetStep] = useState<null | "email" | "otp">(null)
  const [resetEmail, setResetEmail] = useState("")
  const [otp, setOtp] = useState("")
  const [otpNew, setOtpNew] = useState("")
  const [devOtp, setDevOtp] = useState<string | null>(null)
  const [advanced, setAdvanced] = useState(false)
  /** Multi-tenant : choix d’org si le même email existe sur plusieurs orgs */
  const [orgChoices, setOrgChoices] = useState<
    Array<{ org_id: string; org_code: string; name: string }>
  >([])
  const [selectedOrgId, setSelectedOrgId] = useState("")

  useEffect(() => {
    void (async () => {
      try {
        setApiBase(apiBase)
        const st = await api.oidcStatus()
        setOidcEnabled(!!st.enabled)
        setOidcIssuer(st.issuer)
        setSsoEnforce(!!st.sso_enforce && !!st.enabled)
      } catch {
        setOidcEnabled(false)
        setSsoEnforce(false)
      }
    })()
  }, [apiBase])

  async function doLogin(opts?: {
    readOnly?: boolean
    orgId?: string
  }) {
    setApiBase(apiBase)
    const r = await api.login(email, password, {
      read_only: !!opts?.readOnly,
      totpCode: totp || undefined,
      org_id: opts?.orgId || selectedOrgId || undefined
    })
    setToken(r.token)
    setNeedMfa(false)
    setOrgChoices([])
    setSelectedOrgId("")
    setChallengeId(null)
    setChallengeStatus(null)
    onLoggedIn(r.admin)
    if (r.hint) setInfo(r.hint)
  }

  async function claimChallenge(id: string) {
    setBusy(true)
    setErr(null)
    try {
      setApiBase(apiBase)
      const r = await api.challengeClaim(id)
      setToken(r.token)
      setChallengeId(null)
      setChallengeStatus(null)
      setNeedMfa(false)
      if (r.hint) setInfo(r.hint)
      onLoggedIn(r.admin)
    } catch (e) {
      const err = e as Error & { code?: string }
      if (err.code === "challenge_refused") {
        setErr(t("login.challengeRefused"))
      } else if (err.code === "challenge_pending") {
        setErr(t("login.challengeWait"))
      } else {
        setErr(String(e))
      }
      setChallengeId(null)
    } finally {
      setBusy(false)
    }
  }

  // Poll challenge jusqu’à accept / refuse / timeout
  useEffect(() => {
    if (!challengeId) return
    let cancelled = false
    let claiming = false
    const tick = async () => {
      if (claiming || cancelled) return
      try {
        const r = await api.challengeStatus(challengeId)
        if (cancelled) return
        const st = r.challenge?.status || "pending"
        setChallengeStatus(st)
        setChallengeLeft(r.challenge?.seconds_left ?? 0)
        if (st === "accepted" || st === "timeout") {
          claiming = true
          const idToClaim = challengeId
          setChallengeId(null)
          await claimChallenge(idToClaim)
          return
        }
        if (st === "refused" || st === "expired" || st === "claimed") {
          setChallengeId(null)
          setErr(
            st === "refused"
              ? t("login.challengeRefused")
              : t("login.challengeExpired")
          )
        }
      } catch {
        /* ignore transient */
      }
    }
    void tick()
    const id = setInterval(() => void tick(), 1000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [challengeId])

  // Erreurs SSO renvoyées en fragment après callback IdP
  useEffect(() => {
    try {
      const raw = window.location.hash.replace(/^#/, "")
      if (!raw || !raw.includes("opsgate_oidc_error=")) return
      const params = new URLSearchParams(raw)
      const code = params.get("opsgate_oidc_error") || ""
      const detail = params.get("opsgate_oidc_detail") || ""
      const clean = window.location.pathname + window.location.search
      window.history.replaceState(null, "", clean)
      if (code === "session_already_active") {
        setCanForceOidc(true)
        if (detail.includes("@")) setEmail(detail)
        setErr(t("login.sessionActive"))
      } else if (code === "admin_not_found") {
        setErr(t("login.ssoNoAdmin", { email: detail || "?" }))
      } else if (code === "account_locked") {
        setErr(t("login.locked"))
      } else if (code === "domain_not_allowed") {
        setErr(t("login.ssoDomain", { email: detail || "?" }))
      } else if (code === "email_not_verified") {
        setErr(t("login.ssoEmailUnverified"))
      } else if (code === "jit_org_missing" || code === "jit_create_failed") {
        setErr(t("login.ssoJitFailed", { detail: detail || code }))
      } else if (code.startsWith("oidc_jwt_") || code.includes("jwks")) {
        setErr(t("login.ssoJwks", { code }))
      } else if (code === "oidc_not_configured") {
        setErr(t("login.ssoNotConfigured"))
      } else if (code === "rate_limited") {
        setErr(t("login.ssoRateLimited"))
      } else {
        setErr(
          t("login.ssoError", {
            code: code || "unknown",
            detail: detail ? `: ${detail}` : ""
          })
        )
      }
    } catch {
      /* ignore */
    }
  }, [t])

  const startOidc = (force?: boolean) => {
    setApiBase(apiBase)
    setBusy(true)
    setErr(null)
    window.location.href = api.oidcStartUrl({ force: !!force })
  }

  return (
    <div className="login-shell">
      <div className="card login-card">
        <div className="login-brand">
          <BrandMark size={44} />
          <div>
            <h1>{t("login.title")}</h1>
            <p>{t("login.subtitle")}</p>
          </div>
        </div>
        <p className="login-health muted">
          <span
            className={`api-status ${health.startsWith("API OK") ? "ok" : "bad"}`}>
            API
          </span>
          {health.startsWith("API OK") ? t("login.apiOk") : health}
        </p>
        {advanced && (
          <>
            <label className="field-label">{t("login.apiUrl")}</label>
            <div className="row">
              <input
                className="input"
                value={apiBase}
                onChange={(e) => setApiBaseState(e.target.value)}
              />
              <button
                className="btn secondary"
                type="button"
                onClick={onSaveApi}>
                OK
              </button>
            </div>
          </>
        )}
        {oidcEnabled && (
          <>
            <button
              className="btn"
              type="button"
              style={{ marginTop: 4, width: "100%" }}
              disabled={busy}
              onClick={() => startOidc(false)}
              title={oidcIssuer || undefined}>
              {t("login.sso")}
            </button>
            {canForceOidc && (
              <button
                className="btn secondary"
                type="button"
                style={{ marginTop: 8, width: "100%" }}
                disabled={busy}
                onClick={() => startOidc(true)}>
                {t("login.ssoForce")}
              </button>
            )}
            {!ssoEnforce && (
              <div
                className="login-or muted"
                style={{
                  textAlign: "center",
                  margin: "14px 0 6px",
                  fontSize: 12,
                  fontWeight: 600,
                  letterSpacing: "0.04em"
                }}>
                {t("login.orPassword")}
              </div>
            )}
            {ssoEnforce && (
              <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
                {t("login.ssoEnforceHint")}
              </p>
            )}
          </>
        )}
        {!ssoEnforce && (
          <>
            <label className="field-label">{t("login.email")}</label>
            <input
              className="input"
              style={{ width: "100%", minWidth: 0 }}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
            />
            <label className="field-label">{t("login.password")}</label>
            <input
              className="input"
              style={{ width: "100%", minWidth: 0 }}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
            {(needMfa || totp) && (
              <>
                <label className="field-label">{t("login.mfa")}</label>
                <input
                  className="input mono"
                  style={{ width: "100%", minWidth: 0 }}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="123456"
                  value={totp}
                  onChange={(e) =>
                    setTotp(e.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                />
              </>
            )}
            {orgChoices.length > 0 && (
              <>
                <label className="field-label">Organisation</label>
                <select
                  className="input"
                  value={selectedOrgId}
                  onChange={(e) => setSelectedOrgId(e.target.value)}>
                  <option value="">- Choisir -</option>
                  {orgChoices.map((o) => (
                    <option key={o.org_id} value={o.org_id}>
                      {o.name} ({o.org_code})
                    </option>
                  ))}
                </select>
                <p className="muted" style={{ fontSize: 12 }}>
                  Cet e-mail est admin de plusieurs organisations.
                </p>
              </>
            )}
            <button
              className="btn"
              type="button"
              style={{ marginTop: 12, width: "100%" }}
              disabled={busy || (orgChoices.length > 0 && !selectedOrgId)}
              onClick={async () => {
                setBusy(true)
                setErr(null)
                setChallengeId(null)
                try {
                  await doLogin({ orgId: selectedOrgId || undefined })
                } catch (e) {
                  const err = e as Error & {
                    code?: string
                    remaining_attempts?: number
                    challenge_id?: string
                    expires_in?: number
                    challenge?: { seconds_left?: number }
                    orgs?: Array<{
                      org_id: string
                      org_code: string
                      name: string
                    }>
                  }
                  const msg = String(e)
                  if (
                    err.code === "org_selection_required" ||
                    msg.includes("org_selection_required")
                  ) {
                    if (err.orgs?.length) {
                      setOrgChoices(err.orgs)
                      setSelectedOrgId(err.orgs[0]?.org_id || "")
                      setErr(
                        "Choisissez l’organisation pour continuer la connexion."
                      )
                      setBusy(false)
                      return
                    }
                  }
                  if (
                    err.code === "sso_required" ||
                    msg.includes("sso_required")
                  ) {
                    setErr(t("login.ssoRequired"))
                  } else if (
                    err.code === "mfa_required" ||
                    msg.includes("mfa_required")
                  ) {
                    setNeedMfa(true)
                    setErr(t("login.mfaRequired"))
                  } else if (
                    err.code === "mfa_invalid" ||
                    msg.includes("mfa_invalid")
                  ) {
                    setNeedMfa(true)
                    setErr(t("login.mfaInvalid"))
                  } else if (
                    err.code === "session_challenge_required" ||
                    err.challenge_id
                  ) {
                    const cid = err.challenge_id || ""
                    setChallengeId(cid)
                    setChallengeLeft(
                      err.challenge?.seconds_left ?? err.expires_in ?? 10
                    )
                    setChallengeStatus("pending")
                    setErr(t("login.challengeWait"))
                  } else if (
                    err.code === "session_already_active" ||
                    msg.includes("session_already_active")
                  ) {
                    setErr(t("login.sessionActive"))
                  } else if (
                    err.code === "account_locked" ||
                    msg.toLowerCase().includes("account_locked") ||
                    msg.toLowerCase().includes("verrouillé") ||
                    msg.toLowerCase().includes("locked")
                  ) {
                    setErr(t("login.locked"))
                  } else if (typeof err.remaining_attempts === "number") {
                    setErr(
                      `${t("login.invalid")}. ${t("login.attemptsLeft", {
                        n: err.remaining_attempts
                      })}`
                    )
                  } else if (
                    err.code === "invalid_credentials" ||
                    /invalid|invalide|identifiant/i.test(msg)
                  ) {
                    setErr(
                      msg.startsWith("Invalid")
                        ? msg
                        : `${t("login.invalid")}. ${msg}`
                    )
                  } else {
                    setErr(msg)
                  }
                } finally {
                  setBusy(false)
                }
              }}>
              {t("login.submit")}
            </button>
            <button
              className="btn secondary"
              type="button"
              style={{ marginTop: 8, width: "100%" }}
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                setErr(null)
                try {
                  setApiBase(apiBase)
                  const {
                    webauthnSupported,
                    toRequestOptions,
                    assertionToBody
                  } = await import("./webauthn-client")
                  if (!webauthnSupported()) {
                    setErr(t("passkey.unsupported"))
                    return
                  }
                  const opts = await api.webauthnLoginOptions(
                    email.trim() || undefined
                  )
                  const req = toRequestOptions(opts.publicKey)
                  const cred = (await navigator.credentials.get({
                    publicKey: req
                  })) as PublicKeyCredential | null
                  if (!cred) {
                    setErr(t("passkey.cancelled"))
                    return
                  }
                  const r = await api.webauthnLogin(
                    assertionToBody(opts.challenge_id, cred)
                  )
                  setToken(r.token)
                  setNeedMfa(false)
                  if (r.hint) setInfo(r.hint)
                  onLoggedIn(r.admin)
                } catch (e) {
                  setErr(String(e))
                } finally {
                  setBusy(false)
                }
              }}>
              {t("login.passkey")}
            </button>
          </>
        )}
        {challengeId && (
          <div className="login-challenge-box" style={{ marginTop: 12 }}>
            <p style={{ fontSize: 13, margin: "0 0 8px" }}>
              {t("login.challengeHint", { n: challengeLeft })}
            </p>
            <p className="muted" style={{ fontSize: 12, margin: "0 0 10px" }}>
              {t("login.challengeStatus", {
                status: challengeStatus || "pending"
              })}
            </p>
            <button
              className="btn secondary"
              type="button"
              style={{ width: "100%" }}
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                setErr(null)
                try {
                  await doLogin({
                    readOnly: true,
                    orgId: selectedOrgId || undefined
                  })
                  setChallengeId(null)
                } catch (e) {
                  setErr(String(e))
                } finally {
                  setBusy(false)
                }
              }}>
              {t("login.readOnly")}
            </button>
            <button
              type="button"
              className="btn secondary"
              style={{ width: "100%", marginTop: 6 }}
              disabled={busy}
              onClick={() => {
                setChallengeId(null)
                setChallengeStatus(null)
                setErr(null)
              }}>
              {t("login.challengeCancel")}
            </button>
          </div>
        )}
        <button
          type="button"
          className="login-advanced-toggle"
          onClick={() => setAdvanced((v) => !v)}>
          {advanced ? t("login.advancedHide") : t("login.advanced")}
        </button>
        <p className="login-footer-meta">OpsGate · V1</p>
        <p style={{ marginTop: 14, fontSize: 13 }}>
          <button
            type="button"
            style={{
              background: "none",
              border: "none",
              color: "var(--teal)",
              cursor: "pointer",
              padding: 0,
              textDecoration: "underline",
              fontWeight: 600
            }}
            onClick={() => {
              setResetStep("email")
              setResetEmail(email)
              setErr(null)
              setInfo(null)
            }}>
            Mot de passe oublié ?
          </button>
        </p>
        {err && <p className="err">{err}</p>}
        {info && <p className="ok">{info}</p>}
      </div>

      {resetStep && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15,23,42,0.5)",
            zIndex: 50,
            display: "grid",
            placeItems: "center",
            padding: 16
          }}>
          <div className="card" style={{ maxWidth: 400, width: "100%" }}>
            <h2 style={{ marginTop: 0 }}>
              {resetStep === "email"
                ? "Récupération du mot de passe"
                : "Saisir l’OTP"}
            </h2>
            {resetStep === "email" ? (
              <>
                <p className="muted">
                  Entrez l&apos;email de l&apos;Administrator principal.
                </p>
                <label className="field-label">Email</label>
                <input
                  className="input"
                  value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)}
                  autoFocus
                />
                <div className="row" style={{ marginTop: 12 }}>
                  <button
                    className="btn"
                    type="button"
                    disabled={busy || !resetEmail.includes("@")}
                    onClick={async () => {
                      setBusy(true)
                      setErr(null)
                      try {
                        const r = await api.requestPrincipalOtp(resetEmail)
                        setDevOtp(r.dev_otp || null)
                        setInfo(
                          r.mailed
                            ? r.message
                            : r.dev_otp
                              ? `${r.message} (lab OTP affiché ci-dessous)`
                              : r.message
                        )
                        setResetStep("otp")
                      } catch (e) {
                        setErr(String(e))
                      } finally {
                        setBusy(false)
                      }
                    }}>
                    Envoyer OTP
                  </button>
                  <button
                    className="btn secondary"
                    type="button"
                    onClick={() => setResetStep(null)}>
                    Annuler
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="muted">
                  Un code OTP a été envoyé par e-mail
                  {resetEmail ? (
                    <>
                      {" "}
                      à <code>{resetEmail}</code>
                    </>
                  ) : null}
                  {devOtp ? (
                    <>
                      {" "}
                      - lab uniquement : <code>{devOtp}</code>
                    </>
                  ) : (
                    " (vérifiez votre boîte de réception / spam)."
                  )}
                </p>
                <label className="field-label">OTP</label>
                <input
                  className="input"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                  autoFocus
                />
                <label className="field-label">Nouveau mot de passe (≥8)</label>
                <input
                  className="input"
                  type="password"
                  value={otpNew}
                  onChange={(e) => setOtpNew(e.target.value)}
                />
                <div className="row" style={{ marginTop: 12 }}>
                  <button
                    className="btn"
                    type="button"
                    disabled={busy || !otp || otpNew.length < 8}
                    onClick={async () => {
                      setBusy(true)
                      try {
                        await api.confirmPrincipalOtp(
                          otp,
                          otpNew,
                          resetEmail || undefined
                        )
                        setInfo("Mdp mis à jour  -  connectez-vous")
                        setPassword(otpNew)
                        setEmail(resetEmail)
                        setResetStep(null)
                        setOtp("")
                        setOtpNew("")
                      } catch (e) {
                        setErr(String(e))
                      } finally {
                        setBusy(false)
                      }
                    }}>
                    Confirmer
                  </button>
                  <button
                    className="btn secondary"
                    type="button"
                    onClick={() => setResetStep(null)}>
                    Fermer
                  </button>
                </div>
              </>
            )}
            {err && <p className="err">{err}</p>}
          </div>
        </div>
      )}
    </div>
  )
}

function PolicyView({
  policy,
  profiles,
  groups,
  busy,
  onReload,
  setBusy,
  setError,
  setInfo,
  t
}: {
  policy: PolicyDoc | null
  profiles: ProfileRow[]
  groups: GroupRow[]
  busy: boolean
  onReload: () => void
  setBusy: (b: boolean) => void
  setError: (e: string | null) => void
  setInfo: (i: string | null) => void
  t: (k: string, vars?: Record<string, string | number>) => string
}) {
  const [hosts, setHosts] = useState("")
  const [scanUploads, setScanUploads] = useState(true)
  const [scanConfigs, setScanConfigs] = useState(true)
  const [scanDatabases, setScanDatabases] = useState(true)
  const [scanImages, setScanImages] = useState(false)
  const [scanOffice, setScanOffice] = useState(true)
  const [warnMedia, setWarnMedia] = useState(true)
  const [eventReporting, setEventReporting] = useState(true)
  const [protectUnenroll, setProtectUnenroll] = useState(false)
  const [defaultAction, setDefaultAction] = useState("mask_recommend")
  const [msgAdminNotice, setMsgAdminNotice] = useState("")
  const [msgAlertTitle, setMsgAlertTitle] = useState("")
  const [msgAlertBody, setMsgAlertBody] = useState("")
  const [msgBlockTitle, setMsgBlockTitle] = useState("")
  const [msgBlockBody, setMsgBlockBody] = useState("")
  const [msgForceTitle, setMsgForceTitle] = useState("")
  const [msgForceBody, setMsgForceBody] = useState("")
  const [msgAlertTitleFile, setMsgAlertTitleFile] = useState("")
  const [msgAlertBodyFile, setMsgAlertBodyFile] = useState("")
  const [showMsgEditor, setShowMsgEditor] = useState(false)
  const [showSchedule, setShowSchedule] = useState(false)
  const [schedEnabled, setSchedEnabled] = useState(false)
  const [schedTz, setSchedTz] = useState("Europe/Paris")
  const [schedStart, setSchedStart] = useState("08:00")
  const [schedEnd, setSchedEnd] = useState("17:00")
  /** Policy org par défaut : repliée, Modifier pour éditer */
  const [editDefaultOpen, setEditDefaultOpen] = useState(false)

  // New profile form
  const [profName, setProfName] = useState("")
  const [profDept, setProfDept] = useState("")
  const [profHosts, setProfHosts] = useState(AI_HOST_PRESETS.join("\n"))
  // HostPicker edits via setProfHosts(hosts.join("\n"))
  const [profScan, setProfScan] = useState(true)
  const [profScanConfigs, setProfScanConfigs] = useState(true)
  const [profScanDatabases, setProfScanDatabases] = useState(true)
  const [profScanOffice, setProfScanOffice] = useState(true)
  const [profScanImages, setProfScanImages] = useState(false)
  const [profWarnMedia, setProfWarnMedia] = useState(true)
  const [profEvents, setProfEvents] = useState(true)
  const [profProtect, setProfProtect] = useState(false)
  const [profAction, setProfAction] = useState("mask_recommend")
  const [profEnabled, setProfEnabled] = useState(true)
  const [profPriority, setProfPriority] = useState(100)
  const [profGroups, setProfGroups] = useState<string[]>([])
  const [profMsgNotice, setProfMsgNotice] = useState("")
  const [profMsgAlertTitle, setProfMsgAlertTitle] = useState("")
  const [profMsgAlertBody, setProfMsgAlertBody] = useState("")
  const [profMsgBlockTitle, setProfMsgBlockTitle] = useState("")
  const [profMsgBlockBody, setProfMsgBlockBody] = useState("")
  const [profMsgForceTitle, setProfMsgForceTitle] = useState("")
  const [profMsgForceBody, setProfMsgForceBody] = useState("")
  const [profMsgAlertTitleFile, setProfMsgAlertTitleFile] = useState("")
  const [profMsgAlertBodyFile, setProfMsgAlertBodyFile] = useState("")
  const [showProfMsgs, setShowProfMsgs] = useState(false)
  const [showProfSchedule, setShowProfSchedule] = useState(false)
  const [profSchedEnabled, setProfSchedEnabled] = useState(false)
  const [profSchedTz, setProfSchedTz] = useState("Europe/Paris")
  const [profSchedStart, setProfSchedStart] = useState("08:00")
  const [profSchedEnd, setProfSchedEnd] = useState("17:00")
  const [editId, setEditId] = useState<string | null>(null)

  // Hooks TOUJOURS avant tout return conditionnel (sinon page Policy blanche)
  const sortedProfiles = useMemo(
    () =>
      [...(profiles || [])].sort(
        (a, b) =>
          (a.priority ?? 100) - (b.priority ?? 100) ||
          (a.name || "").localeCompare(b.name || "")
      ),
    [profiles]
  )

  useEffect(() => {
    if (!policy) return
    setHosts((policy.enabledHosts || []).join("\n"))
    setScanUploads(!!policy.scanUploads)
    const fs = policy.fileScan
    setScanConfigs(fs?.configs !== false)
    setScanDatabases(fs?.databases !== false)
    setScanImages(fs?.images === true)
    setScanOffice(fs?.office !== false)
    setWarnMedia(fs?.media_warn !== false)
    setEventReporting(!!policy.eventReporting)
    setProtectUnenroll(!!policy.protectUnenroll)
    setDefaultAction(policy.defaultAction || "mask_recommend")
    const um = policy.userMessages || {}
    setMsgAdminNotice(um.adminNotice || "")
    setMsgAlertTitle(um.alertTitle || "")
    setMsgAlertBody(um.alertBody || "")
    setMsgBlockTitle(um.blockTitle || "")
    setMsgBlockBody(um.blockBody || "")
    setMsgForceTitle(um.maskForceTitle || "")
    setMsgForceBody(um.maskForceBody || "")
    setMsgAlertTitleFile(um.alertTitleFile || "")
    setMsgAlertBodyFile(um.alertBodyFile || "")
    const ws = policy.workSchedule
    setSchedEnabled(!!ws?.enabled)
    setSchedTz(ws?.timezone || "Europe/Paris")
    setSchedStart(ws?.workStart || "08:00")
    setSchedEnd(ws?.workEnd || "17:00")
  }, [policy])

  const saveDefault = async () => {
    if (!policy) return
    setBusy(true)
    setError(null)
    setInfo(null)
    try {
      const user_messages: import("./api").PolicyUserMessages = {}
      if (msgAdminNotice.trim()) user_messages.adminNotice = msgAdminNotice.trim()
      if (msgAlertTitle.trim()) user_messages.alertTitle = msgAlertTitle.trim()
      if (msgAlertBody.trim()) user_messages.alertBody = msgAlertBody.trim()
      if (msgBlockTitle.trim()) user_messages.blockTitle = msgBlockTitle.trim()
      if (msgBlockBody.trim()) user_messages.blockBody = msgBlockBody.trim()
      if (msgForceTitle.trim()) user_messages.maskForceTitle = msgForceTitle.trim()
      if (msgForceBody.trim()) user_messages.maskForceBody = msgForceBody.trim()
      if (msgAlertTitleFile.trim())
        user_messages.alertTitleFile = msgAlertTitleFile.trim()
      if (msgAlertBodyFile.trim())
        user_messages.alertBodyFile = msgAlertBodyFile.trim()
      await api.updatePolicy({
        enabled_hosts: hosts
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean),
        scan_uploads: scanUploads,
        file_scan: {
          configs: scanConfigs,
          databases: scanDatabases,
          images: scanImages,
          office: scanOffice,
          media_warn: warnMedia
        },
        event_reporting: eventReporting,
        protect_unenroll: protectUnenroll,
        default_action: defaultAction,
        user_messages,
        work_schedule: {
          enabled: schedEnabled,
          timezone: schedTz,
          workDays: [1, 2, 3, 4, 5],
          workStart: schedStart,
          workEnd: schedEnd,
          breaks: []
        }
      })
      setInfo(t("policy.saved"))
      setEditDefaultOpen(false)
      onReload()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  const toggleId = (list: string[], id: string) =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id]

  if (!policy) {
    return (
      <div className="card empty">
        {t("policy.missing")}
        <div style={{ marginTop: 12 }}>
          <button className="btn secondary" type="button" onClick={onReload}>
            {t("common.retry")}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="pol-page">
      {/* Policy org par défaut : ligne distincte */}
      <div className="pol-card">
        <div className="pol-card-head">
          <div>
            <span className="pol-badge">{t("policy.defaultBadge")}</span>
            <strong className="pol-title">{t("policy.defaultTitle")}</strong>
            <div className="pol-meta">
              v{policy.version} · epoch {policy.configEpoch ?? "—"} ·{" "}
              {policy.defaultAction} · {(policy.enabledHosts || []).length}{" "}
              sites · pack {policy.rulesPackVersion}
            </div>
          </div>
          <button
            type="button"
            className="btn secondary btn-sm"
            onClick={() => setEditDefaultOpen((v) => !v)}>
            {editDefaultOpen ? t("common.hide") : t("common.edit")}
          </button>
        </div>
        {editDefaultOpen && (
          <div className="pol-card-body">
            <div className="pol-section-l">{t("policy.editDefault")}</div>
        <label className="field-label">{t("policy.aiSites")}</label>
        <p className="muted" style={{ fontSize: 12, margin: "0 0 8px", maxWidth: 560 }}>
          {t("policy.aiSitesHint")}
        </p>
        <HostPicker
          value={hosts
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean)}
          onChange={(list) => setHosts(list.join("\n"))}
        />

        <div className="pol-section-l" style={{ marginTop: 14 }}>
          {t("policy.protection") || "Protection"}
        </div>
        <div className="pol-toggles">
          <label className="pol-toggle">
            <input
              type="checkbox"
              checked={eventReporting}
              onChange={(e) => setEventReporting(e.target.checked)}
            />
            <span>{t("policy.eventReporting")}</span>
          </label>
          <label className="pol-toggle">
            <input
              type="checkbox"
              checked={protectUnenroll}
              onChange={(e) => setProtectUnenroll(e.target.checked)}
            />
            <span>{t("policy.protectUnenroll")}</span>
          </label>
        </div>

        <div className="pol-section-l" style={{ marginTop: 14 }}>
          {t("policy.fileScanTitle") || "Analyse des fichiers"}
        </div>
        <label className="pol-toggle pol-toggle-main">
          <input
            type="checkbox"
            checked={scanUploads}
            onChange={(e) => setScanUploads(e.target.checked)}
          />
          <span>
            <strong>{t("policy.scanUploads")}</strong>
            <em>{t("policy.scanHint")}</em>
          </span>
        </label>
        <div className={`pol-toggles pol-toggles-sub${scanUploads ? "" : " is-off"}`}>
          {(
            [
              [scanConfigs, setScanConfigs, t("policy.scanConfigs") || "Configurations (.conf, .json, .xml, .env…)"],
              [scanDatabases, setScanDatabases, t("policy.scanDatabases") || "Bases de données (.sql)"],
              [scanOffice, setScanOffice, t("policy.scanOffice") || "PDF / Office (DOCX, PPTX, XLSX)"],
              [scanImages, setScanImages, t("policy.scanImages") || "Images — OCR (Tesseract)"],
              [warnMedia, setWarnMedia, t("policy.warnMedia") || "Audio / vidéo (confirmation)"]
            ] as const
          ).map(([val, setVal, label], i) => (
            <label key={i} className="pol-toggle">
              <input
                type="checkbox"
                checked={!!val}
                disabled={!scanUploads}
                onChange={(e) => setVal(e.target.checked)}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
        <div className="policy-block">
          <label className="field-label">{t("policy.defaultAction")}</label>
          <select
            className="input"
            value={defaultAction}
            onChange={(e) => setDefaultAction(e.target.value)}>
            <option value="warn">warn</option>
            <option value="mask_recommend">mask_recommend</option>
            <option value="mask_force">mask_force</option>
            <option value="block">block</option>
          </select>
        </div>

        <div className="policy-block">
          <button
            type="button"
            className="btn secondary btn-sm"
            onClick={() => setShowSchedule((v) => !v)}>
            {showSchedule ? "Masquer horaires" : "Horaires (optionnel)"}
          </button>
          {showSchedule && (
            <div
              className="form-stack"
              style={{
                marginTop: 12,
                maxWidth: 480,
                padding: 12,
                background: "var(--surface-2)",
                borderRadius: 4,
                border: "1px solid var(--line)"
              }}>
              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={schedEnabled}
                  onChange={(e) => setSchedEnabled(e.target.checked)}
                />
                Activer pour cette policy (sinon planning Monitoring org)
              </label>
              <label className="field-label">Fuseau</label>
              <select
                className="input"
                value={schedTz}
                onChange={(e) => setSchedTz(e.target.value)}>
                {[...new Set([schedTz, ...COMMON_TIMEZONES])].map((z) => {
                  const lab =
                    TIMEZONE_OPTIONS.find(([id]) => id === z)?.[1] || z
                  return (
                    <option key={z} value={z}>
                      {lab}
                    </option>
                  )
                })}
              </select>
              <div className="row">
                <div>
                  <label className="field-label">Debut</label>
                  <input
                    className="input"
                    type="time"
                    value={schedStart}
                    onChange={(e) => setSchedStart(e.target.value)}
                  />
                </div>
                <div>
                  <label className="field-label">Fin</label>
                  <input
                    className="input"
                    type="time"
                    value={schedEnd}
                    onChange={(e) => setSchedEnd(e.target.value)}
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="policy-block">
          <button
            type="button"
            className="btn secondary btn-sm"
            onClick={() => setShowMsgEditor((v) => !v)}>
            {showMsgEditor ? "Masquer messages" : "Messages utilisateur"}
          </button>
          {showMsgEditor && (
            <div
              className="form-stack"
              style={{
                marginTop: 12,
                maxWidth: 640,
                padding: 14,
                background: "var(--surface-2)",
                borderRadius: 4,
                border: "1px solid var(--line)"
              }}>
            <label className="field-label">Notice admin</label>
            <textarea
              className="input"
              rows={2}
              placeholder="Cette restriction est appliquée par la politique…"
              value={msgAdminNotice}
              onChange={(e) => setMsgAdminNotice(e.target.value)}
            />
            <label className="field-label">Alerte  -  titre</label>
            <input
              className="input"
              value={msgAlertTitle}
              onChange={(e) => setMsgAlertTitle(e.target.value)}
              placeholder="Données sensibles détectées  -  action requise"
            />
            <label className="field-label">Alerte  -  corps</label>
            <textarea
              className="input"
              rows={2}
              value={msgAlertBody}
              onChange={(e) => setMsgAlertBody(e.target.value)}
            />
            <label className="field-label">Blocage total  -  titre</label>
            <input
              className="input"
              value={msgBlockTitle}
              onChange={(e) => setMsgBlockTitle(e.target.value)}
              placeholder="Envoi non autorisé par votre administrateur"
            />
            <label className="field-label">Blocage total  -  corps</label>
            <textarea
              className="input"
              rows={3}
              value={msgBlockBody}
              onChange={(e) => setMsgBlockBody(e.target.value)}
            />
            <label className="field-label">Masquage forcé  -  titre</label>
            <input
              className="input"
              value={msgForceTitle}
              onChange={(e) => setMsgForceTitle(e.target.value)}
            />
            <label className="field-label">Masquage forcé  -  corps</label>
            <textarea
              className="input"
              rows={2}
              value={msgForceBody}
              onChange={(e) => setMsgForceBody(e.target.value)}
            />
            <label className="field-label">
              Fichier joint  -  titre (si analyse fichiers active)
            </label>
            <input
              className="input"
              value={msgAlertTitleFile}
              onChange={(e) => setMsgAlertTitleFile(e.target.value)}
              placeholder="Fichier retenu - données sensibles"
            />
            <label className="field-label">Fichier joint  -  corps</label>
            <textarea
              className="input"
              rows={2}
              value={msgAlertBodyFile}
              onChange={(e) => setMsgAlertBodyFile(e.target.value)}
            />
            </div>
          )}
        </div>

        <div className="row" style={{ marginTop: 18 }}>
          <button
            className="btn"
            type="button"
            disabled={busy}
            onClick={() => void saveDefault()}>
            {t("policy.save")}
          </button>
          <button
            className="btn secondary"
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              setError(null)
              try {
                const r = await api.forceSync()
                setInfo(
                  `Force-sync epoch=${r.config_epoch} · ${r.agents} agent(s)`
                )
              } catch (e) {
                setError(String(e))
              } finally {
                setBusy(false)
              }
            }}>
            {t("policy.forceSync")}
          </button>
        </div>
          </div>
        )}
      </div>

      {/* Policies par département (priorité type firewall) */}
      <div className="pol-card" style={{ marginTop: 12 }}>
        <div className="pol-card-head">
          <strong className="pol-title">{t("policy.profilesTitle")}</strong>
        </div>
        <div className="pol-card-body">
        <p className="pol-meta" style={{ marginTop: 0 }}>
          {t("policy.profilesHint")}
        </p>
        {sortedProfiles.length === 0 ? (
          <div className="empty">{t("policy.noProfiles")}</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t("policy.prio")}</th>
                  <th>{t("policy.state")}</th>
                  <th>{t("policy.name")}</th>
                  <th>{t("policy.dept")}</th>
                  <th>{t("policy.action")}</th>
                  <th>{t("policy.hosts")}</th>
                  <th>{t("policy.upload")}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {sortedProfiles.map((p) => (
                  <tr
                    key={p.id}
                    className={p.enabled === false ? "row-disabled" : undefined}>
                    <td className="mono">{p.priority ?? 100}</td>
                    <td>
                      <span
                        className={`lic-status ${
                          p.enabled === false ? "grace" : "ok"
                        }`}>
                        {p.enabled === false ? "off" : "on"}
                      </span>
                    </td>
                    <td>
                      <strong>{p.name}</strong>
                    </td>
                    <td>{p.department || " - "}</td>
                    <td className="mono" style={{ fontSize: 11 }}>
                      {p.defaultAction}
                    </td>
                    <td>
                      <span className="host-count-pill">
                        {(p.enabledHosts || []).length} {t("policy.sites")}
                      </span>
                    </td>
                    <td>
                      {p.scanUploads ? (
                        <span
                          className="mono"
                          style={{ fontSize: 10 }}
                          title="configs / DB / office / OCR / media">
                          {[
                            p.fileScan?.configs !== false ? "cfg" : null,
                            p.fileScan?.databases !== false ? "db" : null,
                            p.fileScan?.office !== false ? "pdf" : null,
                            p.fileScan?.images === true ? "ocr" : null,
                            p.fileScan?.media_warn !== false ? "av" : null
                          ]
                            .filter(Boolean)
                            .join(" · ") || t("common.yes")}
                        </span>
                      ) : (
                        t("common.no")
                      )}
                    </td>
                    <td>
                      <button
                        className="btn secondary btn-sm"
                        type="button"
                        disabled={busy}
                        onClick={async () => {
                          setBusy(true)
                          try {
                            await api.updateProfile(p.id, {
                              enabled: p.enabled === false
                            })
                            setInfo(
                              p.enabled === false
                                ? t("policy.profileEnabled", { name: p.name })
                                : t("policy.profileDisabled", { name: p.name })
                            )
                            onReload()
                          } catch (e) {
                            setError(String(e))
                          } finally {
                            setBusy(false)
                          }
                        }}>
                        {p.enabled === false
                          ? t("common.enable")
                          : t("common.disable")}
                      </button>{" "}
                      <button
                        className="btn secondary btn-sm"
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setEditId(p.id)
                          setProfName(p.name)
                          setProfDept(p.department || "")
                          setProfHosts((p.enabledHosts || []).join("\n"))
                          setProfScan(!!p.scanUploads)
                          // Hérite de la policy org si le profil n’a pas de file_scan explicite
                          const pfs = p.fileScan || policy.fileScan
                          setProfScanConfigs(pfs?.configs !== false)
                          setProfScanDatabases(pfs?.databases !== false)
                          setProfScanOffice(pfs?.office !== false)
                          setProfScanImages(pfs?.images === true)
                          setProfWarnMedia(pfs?.media_warn !== false)
                          setProfEvents(!!p.eventReporting)
                          setProfProtect(!!p.protectUnenroll)
                          setProfAction(p.defaultAction || "mask_recommend")
                          setProfEnabled(p.enabled !== false)
                          setProfPriority(p.priority ?? 100)
                          setProfGroups([...(p.assignedGroupIds || [])])
                          setProfMsgNotice(p.userMessages?.adminNotice || "")
                          setProfMsgAlertTitle(p.userMessages?.alertTitle || "")
                          setProfMsgAlertBody(p.userMessages?.alertBody || "")
                          setProfMsgBlockTitle(p.userMessages?.blockTitle || "")
                          setProfMsgBlockBody(p.userMessages?.blockBody || "")
                          setProfMsgForceTitle(
                            p.userMessages?.maskForceTitle || ""
                          )
                          setProfMsgForceBody(
                            p.userMessages?.maskForceBody || ""
                          )
                          setProfMsgAlertTitleFile(
                            p.userMessages?.alertTitleFile || ""
                          )
                          setProfMsgAlertBodyFile(
                            p.userMessages?.alertBodyFile || ""
                          )
                          const pws = p.workSchedule
                          setProfSchedEnabled(!!pws?.enabled)
                          setProfSchedTz(pws?.timezone || "Europe/Paris")
                          setProfSchedStart(pws?.workStart || "08:00")
                          setProfSchedEnd(pws?.workEnd || "17:00")
                          setShowProfSchedule(!!pws?.enabled)
                          setShowProfMsgs(true)
                          setTimeout(() => {
                            document
                              .getElementById("policy-profile-form")
                              ?.scrollIntoView({
                                behavior: "smooth",
                                block: "start"
                              })
                          }, 50)
                        }}>
                        {t("common.edit")}
                      </button>{" "}
                      <button
                        className="btn danger btn-sm"
                        type="button"
                        disabled={busy}
                        onClick={async () => {
                          if (
                            !confirm(
                              t("policy.deleteConfirm", { name: p.name })
                            )
                          )
                            return
                          setBusy(true)
                          try {
                            await api.deleteProfile(p.id)
                            setInfo(
                              t("policy.profileDeleted", { name: p.name })
                            )
                            onReload()
                          } catch (e) {
                            setError(String(e))
                          } finally {
                            setBusy(false)
                          }
                        }}>
                        {t("common.delete")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 3. Créer / modifier profil */}
      <div className="card" id="policy-profile-form">
        <h2>{editId ? t("policy.editProfile") : t("policy.newProfile")}</h2>
        <div className="row" style={{ marginBottom: 8 }}>
          <input
            className="input"
            placeholder={t("common.name")}
            value={profName}
            onChange={(e) => setProfName(e.target.value)}
          />
          <input
            className="input"
            placeholder={t("policy.department")}
            value={profDept}
            onChange={(e) => setProfDept(e.target.value)}
          />
        </div>
        <div className="field-label">{t("policy.aiSitesShort")}</div>
        <HostPicker
          value={profHosts
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean)}
          onChange={(hosts) => setProfHosts(hosts.join("\n"))}
        />
        <div className="row" style={{ marginTop: 8, gap: 16, flexWrap: "wrap" }}>
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={profEvents}
              onChange={(e) => setProfEvents(e.target.checked)}
            />
            {t("policy.events")}
          </label>
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={profProtect}
              onChange={(e) => setProfProtect(e.target.checked)}
            />
            {t("policy.protectPwd")}
          </label>
          <select
            className="input"
            value={profAction}
            onChange={(e) => setProfAction(e.target.value)}>
            <option value="warn">warn</option>
            <option value="mask_recommend">mask_recommend</option>
            <option value="mask_force">mask_force</option>
            <option value="block">block</option>
          </select>
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            Priorité
            <input
              className="input"
              type="number"
              min={1}
              max={9999}
              value={profPriority}
              onChange={(e) =>
                setProfPriority(Number(e.target.value) || 100)
              }
              style={{ width: 80 }}
              title="Plus petit = plus prioritaire"
            />
          </label>
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={profEnabled}
              onChange={(e) => setProfEnabled(e.target.checked)}
            />
            Profil actif
          </label>
        </div>

        <div className="pol-section-l" style={{ marginTop: 14 }}>
          {t("policy.fileScanTitle") || "Analyse des fichiers"}
          <span className="pol-meta" style={{ marginLeft: 8, fontWeight: 500 }}>
            (profil — écrase la policy org à l’enregistrement)
          </span>
        </div>
        <label className="pol-toggle pol-toggle-main">
          <input
            type="checkbox"
            checked={profScan}
            onChange={(e) => setProfScan(e.target.checked)}
          />
          <span>
            <strong>{t("policy.scanFiles") || t("policy.scanUploads")}</strong>
            <em>{t("policy.scanHint")}</em>
          </span>
        </label>
        <div
          className={`pol-toggles pol-toggles-sub${profScan ? "" : " is-off"}`}>
          {(
            [
              [
                profScanConfigs,
                setProfScanConfigs,
                t("policy.scanConfigs")
              ],
              [
                profScanDatabases,
                setProfScanDatabases,
                t("policy.scanDatabases")
              ],
              [profScanOffice, setProfScanOffice, t("policy.scanOffice")],
              [profScanImages, setProfScanImages, t("policy.scanImages")],
              [profWarnMedia, setProfWarnMedia, t("policy.warnMedia")]
            ] as const
          ).map(([val, setVal, label], i) => (
            <label key={i} className="pol-toggle">
              <input
                type="checkbox"
                checked={!!val}
                disabled={!profScan}
                onChange={(e) => setVal(e.target.checked)}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
        <p className="pol-meta" style={{ marginTop: 6 }}>
          Détections type IBAN, mots de passe, clés API : pack de règles org
          (onglet Packs) — commun à tous les profils, pas un réglage par
          policy.
        </p>
        <div className="policy-block">
          <button
            type="button"
            className="btn secondary btn-sm"
            onClick={() => setShowProfSchedule((v) => !v)}>
            {showProfSchedule
              ? "Masquer horaires (profil)"
              : "Horaires (optionnel, profil)"}
          </button>
          {showProfSchedule && (
            <div
              className="form-stack"
              style={{
                marginTop: 12,
                maxWidth: 480,
                padding: 12,
                background: "var(--surface-2)",
                borderRadius: 4,
                border: "1px solid var(--line)"
              }}>
              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={profSchedEnabled}
                  onChange={(e) => setProfSchedEnabled(e.target.checked)}
                />
                Activer pour ce profil (sinon policy org / monitoring)
              </label>
              <label className="field-label">Fuseau</label>
              <select
                className="input"
                value={profSchedTz}
                onChange={(e) => setProfSchedTz(e.target.value)}>
                {[...new Set([profSchedTz, ...COMMON_TIMEZONES])].map((z) => {
                  const lab =
                    TIMEZONE_OPTIONS.find(([id]) => id === z)?.[1] || z
                  return (
                    <option key={z} value={z}>
                      {lab}
                    </option>
                  )
                })}
              </select>
              <div className="row">
                <div>
                  <label className="field-label">Debut</label>
                  <input
                    className="input"
                    type="time"
                    value={profSchedStart}
                    onChange={(e) => setProfSchedStart(e.target.value)}
                  />
                </div>
                <div>
                  <label className="field-label">Fin</label>
                  <input
                    className="input"
                    type="time"
                    value={profSchedEnd}
                    onChange={(e) => setProfSchedEnd(e.target.value)}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="policy-block">
          <button
            type="button"
            className="btn secondary btn-sm"
            onClick={() => setShowProfMsgs((v) => !v)}>
            {showProfMsgs
              ? "Masquer messages banner (profil)"
              : "Messages banner (override policy org)"}
          </button>
          {showProfMsgs && (
            <div
              className="form-stack"
              style={{
                marginTop: 12,
                maxWidth: 560,
                padding: 12,
                background: "var(--surface-2)",
                borderRadius: 4,
                border: "1px solid var(--line)"
              }}>
            <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
              Même jeu de champs que la policy org. Les valeurs non vides
              remplacent celles de la policy par défaut pour ce profil.
            </p>
            <label className="field-label">Mention « pas une erreur »</label>
            <textarea
              className="input"
              rows={2}
              value={profMsgNotice}
              onChange={(e) => setProfMsgNotice(e.target.value)}
            />
            <label className="field-label">Alerte  -  titre</label>
            <input
              className="input"
              value={profMsgAlertTitle}
              onChange={(e) => setProfMsgAlertTitle(e.target.value)}
            />
            <label className="field-label">Alerte  -  corps</label>
            <textarea
              className="input"
              rows={2}
              value={profMsgAlertBody}
              onChange={(e) => setProfMsgAlertBody(e.target.value)}
            />
            <label className="field-label">Blocage total  -  titre</label>
            <input
              className="input"
              value={profMsgBlockTitle}
              onChange={(e) => setProfMsgBlockTitle(e.target.value)}
            />
            <label className="field-label">Blocage total  -  corps</label>
            <textarea
              className="input"
              rows={2}
              value={profMsgBlockBody}
              onChange={(e) => setProfMsgBlockBody(e.target.value)}
            />
            <label className="field-label">Masquage forcé  -  titre</label>
            <input
              className="input"
              value={profMsgForceTitle}
              onChange={(e) => setProfMsgForceTitle(e.target.value)}
            />
            <label className="field-label">Masquage forcé  -  corps</label>
            <textarea
              className="input"
              rows={2}
              value={profMsgForceBody}
              onChange={(e) => setProfMsgForceBody(e.target.value)}
            />
            <label className="field-label">
              Fichier joint  -  titre (override, analyse fichiers)
            </label>
            <input
              className="input"
              value={profMsgAlertTitleFile}
              onChange={(e) => setProfMsgAlertTitleFile(e.target.value)}
            />
            <label className="field-label">Fichier joint  -  corps</label>
            <textarea
              className="input"
              rows={2}
              value={profMsgAlertBodyFile}
              onChange={(e) => setProfMsgAlertBodyFile(e.target.value)}
            />
            </div>
          )}
        </div>
        <div style={{ marginTop: 14 }}>
          <div className="field-label">Groupes soumis à cette policy</div>
          <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
            {groups.map((g) => (
              <label
                key={g.id}
                style={{ display: "flex", gap: 4, alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={profGroups.includes(g.id)}
                  onChange={() =>
                    setProfGroups(toggleId(profGroups, g.id))
                  }
                />
                {g.name}
              </label>
            ))}
            {groups.length === 0 && (
              <span className="muted">Créez des groupes dans Admins &amp; Groups</span>
            )}
          </div>
          <p className="muted" style={{ fontSize: 12 }}>
            Pas d&apos;affectation user-par-user ici (scalabilité). Liez les
            users aux groupes dans Admins &amp; Groups ; assignez les agents aux
            users.
          </p>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <button
            className="btn"
            type="button"
            disabled={busy || !profName.trim()}
            onClick={async () => {
              setBusy(true)
              setError(null)
              try {
                const user_messages: import("./api").PolicyUserMessages = {}
                const put = (
                  k: keyof import("./api").PolicyUserMessages,
                  v: string
                ) => {
                  if (v.trim()) user_messages[k] = v.trim()
                }
                put("adminNotice", profMsgNotice)
                put("alertTitle", profMsgAlertTitle)
                put("alertBody", profMsgAlertBody)
                put("blockTitle", profMsgBlockTitle)
                put("blockBody", profMsgBlockBody)
                put("maskForceTitle", profMsgForceTitle)
                put("maskForceBody", profMsgForceBody)
                put("alertTitleFile", profMsgAlertTitleFile)
                put("alertBodyFile", profMsgAlertBodyFile)
                const body = {
                  name: profName.trim(),
                  department: profDept || undefined,
                  enabled_hosts: profHosts
                    .split("\n")
                    .map((l) => l.trim())
                    .filter(Boolean),
                  scan_uploads: profScan,
                  file_scan: {
                    configs: profScanConfigs,
                    databases: profScanDatabases,
                    images: profScanImages,
                    office: profScanOffice,
                    media_warn: profWarnMedia
                  },
                  event_reporting: profEvents,
                  protect_unenroll: profProtect,
                  default_action: profAction,
                  enabled: profEnabled,
                  priority: profPriority,
                  assigned_group_ids: profGroups,
                  user_messages,
                  work_schedule: {
                    enabled: profSchedEnabled,
                    timezone: profSchedTz,
                    workDays: [1, 2, 3, 4, 5],
                    workStart: profSchedStart,
                    workEnd: profSchedEnd,
                    breaks: []
                  }
                }
                if (editId) {
                  await api.updateProfile(editId, body)
                  setInfo(`Profil « ${profName} » mis à jour`)
                } else {
                  await api.createProfile(body)
                  setInfo(`Profil « ${profName} » créé`)
                }
                setProfName("")
                setProfGroups([])
                // Reset : reprendre les défauts de la policy org
                setProfScan(!!policy.scanUploads)
                setProfScanConfigs(policy.fileScan?.configs !== false)
                setProfScanDatabases(policy.fileScan?.databases !== false)
                setProfScanOffice(policy.fileScan?.office !== false)
                setProfScanImages(policy.fileScan?.images === true)
                setProfWarnMedia(policy.fileScan?.media_warn !== false)
                setProfMsgNotice("")
                setProfMsgAlertTitle("")
                setProfMsgAlertBody("")
                setProfMsgBlockTitle("")
                setProfMsgBlockBody("")
                setProfMsgForceTitle("")
                setProfMsgForceBody("")
                setProfMsgAlertTitleFile("")
                setProfMsgAlertBodyFile("")
                setShowProfMsgs(false)
                setShowProfSchedule(false)
                setProfSchedEnabled(false)
                setEditId(null)
                onReload()
              } catch (e) {
                setError(String(e))
              } finally {
                setBusy(false)
              }
            }}>
            {editId ? "Enregistrer les modifications" : "Créer le profil"}
          </button>
          {editId && (
            <button
              className="btn secondary"
              type="button"
              onClick={() => {
                setEditId(null)
                setProfName("")
                setProfGroups([])
              }}>
              Annuler
            </button>
          )}
        </div>
        </div>
      </div>
      <style>{`
        .pol-page { display: flex; flex-direction: column; gap: 0; }
        .pol-card {
          border: 1px solid var(--line, #e2e8f0);
          border-radius: 10px;
          background: var(--surface, #fff);
          margin-bottom: 12px;
          overflow: hidden;
        }
        .pol-card-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 10px 14px;
          border-bottom: 1px solid var(--line, #e2e8f0);
          background: var(--surface-2, #f8fafc);
        }
        .pol-card-body { padding: 12px 14px 14px; }
        .pol-badge {
          display: inline-block;
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.03em;
          padding: 2px 7px;
          border-radius: 999px;
          background: #ccfbf1;
          color: #0f766e;
          margin-right: 8px;
        }
        .pol-title {
          font-size: 13px;
          font-weight: 700;
          color: var(--text, #0f172a);
        }
        .pol-meta {
          font-size: 11px;
          color: #64748b;
          margin-top: 3px;
        }
        .pol-section-l {
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.03em;
          color: #64748b;
          margin-bottom: 8px;
        }
        .pol-toggles {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
          gap: 6px 12px;
        }
        .pol-toggles-sub {
          margin-top: 8px;
          padding: 10px 12px;
          border-radius: 8px;
          border: 1px solid var(--line, #e2e8f0);
          background: var(--surface-2, #f8fafc);
        }
        .pol-toggles-sub.is-off { opacity: 0.45; pointer-events: none; }
        .pol-toggle {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          font-size: 12px;
          color: var(--text, #0f172a);
          cursor: pointer;
        }
        .pol-toggle input { margin-top: 2px; }
        .pol-toggle-main {
          padding: 8px 10px;
          border-radius: 8px;
          border: 1px solid var(--line, #e2e8f0);
          background: #fff;
        }
        .pol-toggle-main span { display: flex; flex-direction: column; gap: 2px; }
        .pol-toggle-main em {
          font-style: normal;
          font-size: 11px;
          color: #64748b;
          font-weight: 500;
        }
        .pol-page .field-label {
          font-size: 11px;
          margin-top: 10px;
          margin-bottom: 4px;
        }
        .pol-page .input {
          font-size: 12px;
          min-height: 32px;
        }
        .pol-page .table th {
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.03em;
          padding: 6px 10px;
        }
        .pol-page .table td { padding: 7px 10px; font-size: 12px; }
      `}</style>
    </div>
  )
}

function PacksView({
  packs,
  activeVersion,
  busy,
  disableRuleId,
  publishNotes,
  onDisableRuleId,
  onPublishNotes,
  onPublish,
  onActivate,
  onDelete
}: {
  packs: PackListItem[]
  activeVersion?: string
  busy: boolean
  disableRuleId: string
  publishNotes: string
  onDisableRuleId: (v: string) => void
  onPublishNotes: (v: string) => void
  onPublish: () => void
  onActivate: (v: string) => void
  onDelete: (v: string) => void
}) {
  return (
    <>
      <div className="card">
        <h2>Pack actif et publication</h2>
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
          Actif : <strong className="mono">{activeVersion || "-"}</strong>
          {" · "}
          historique plafonne a 12 versions inactives (prune auto)
        </p>
        <div className="row" style={{ marginBottom: 10, flexWrap: "wrap" }}>
          <input
            className="input"
            style={{ minWidth: 280 }}
            value={disableRuleId}
            onChange={(e) => onDisableRuleId(e.target.value)}
            placeholder="IDs a desactiver : email-address,phone-fr"
          />
          <input
            className="input"
            style={{ minWidth: 200 }}
            value={publishNotes}
            onChange={(e) => onPublishNotes(e.target.value)}
            placeholder="notes (ex. pilote RH)"
          />
          <button className="btn" type="button" disabled={busy} onClick={onPublish}>
            {busy ? "..." : "Publier et activer"}
          </button>
        </div>
      </div>

      <div className="card">
        <h2>Historique des versions</h2>
        {packs.length === 0 ? (
          <div className="empty">Aucun pack</div>
        ) : (
          <div className="table-wrap"><table className="table">
            <thead>
              <tr>
                <th>Version</th>
                <th>Rules</th>
                <th>Notes</th>
                <th>Publie</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {packs.map((p) => (
                <tr key={p.version}>
                  <td>
                    <span className="mono">{p.version}</span>{" "}
                    {p.active && <span className="badge active">active</span>}
                  </td>
                  <td>{p.rules_count}</td>
                  <td className="muted">{p.notes || "-"}</td>
                  <td className="muted">
                    {new Date(p.published_at).toLocaleString("fr-FR")}
                    <div className="mono">{p.checksum.slice(0, 12)}...</div>
                  </td>
                  <td>
                    <div className="btn-group">
                      {!p.active && (
                        <button
                          className="btn secondary btn-sm"
                          type="button"
                          disabled={busy}
                          onClick={() => onActivate(p.version)}>
                          Activer
                        </button>
                      )}
                      {!p.active && (
                        <button
                          className="btn danger btn-sm"
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            if (
                              !confirm(
                                `Supprimer le pack ${p.version} (non actif) ?`
                              )
                            ) {
                              return
                            }
                            onDelete(p.version)
                          }}>
                          Suppr.
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>
    </>
  )
}

function PeopleView({
  sessionAdmin,
  admins,
  users,
  groups,
  profiles,
  busy,
  onReload,
  setBusy,
  setError,
  setInfo,
  t
}: {
  sessionAdmin: AdminRow
  admins: AdminRow[]
  users: UserRow[]
  groups: GroupRow[]
  profiles: ProfileRow[]
  busy: boolean
  onReload: () => void
  setBusy: (b: boolean) => void
  setError: (e: string | null) => void
  setInfo: (i: string | null) => void
  t: (k: string, vars?: Record<string, string | number>) => string
}) {
  const [admLabel, setAdmLabel] = useState("Operator")
  const [admEmail, setAdmEmail] = useState("")
  const [admPwd, setAdmPwd] = useState("")
  const [admAsPrincipal, setAdmAsPrincipal] = useState(false)
  const [admPerms, setAdmPerms] = useState<AdminPermission[]>([
    "console_access",
    "unenroll_agents"
  ])
  const [editId, setEditId] = useState<string | null>(null)
  const [editEmail, setEditEmail] = useState("")
  const [editCur, setEditCur] = useState("")
  const [editPwd, setEditPwd] = useState("")
  const [editPwd2, setEditPwd2] = useState("")
  const [userName, setUserName] = useState("")
  const [userEmail, setUserEmail] = useState("")
  const [userGroups, setUserGroups] = useState<string[]>([])
  const [grpName, setGrpName] = useState("")
  const [grpDesc, setGrpDesc] = useState("")
  const [grpProfile, setGrpProfile] = useState("")
  const [otp, setOtp] = useState("")
  const [otpNewPwd, setOtpNewPwd] = useState("")
  const [devOtp, setDevOtp] = useState<string | null>(null)
  const [recoveryHint, setRecoveryHint] = useState<string | null>(null)
  const [rcActive, setRcActive] = useState(0)
  const [rcLow, setRcLow] = useState(false)
  const [rcRows, setRcRows] = useState<
    Array<{
      id: string
      label?: string
      created_at: string
      consumed_at?: string | null
      active: boolean
    }>
  >([])
  const [rcPlain, setRcPlain] = useState<Array<{ id: string; code: string }> | null>(
    null
  )
  const [rcCount, setRcCount] = useState(20)
  const [rcShowUsed, setRcShowUsed] = useState(false)
  const [grpEditId, setGrpEditId] = useState<string | null>(null)
  const [showGrpForm, setShowGrpForm] = useState(false)

  const isPrincipal = !!sessionAdmin.is_principal

  const loadRecoveryPool = useCallback(async () => {
    try {
      const r = await api.recoveryCodes()
      setRcActive(r.active_count)
      setRcLow(!!r.low_stock)
      setRcRows(r.codes || [])
    } catch {
      /* principal only */
    }
  }, [])

  useEffect(() => {
    if (isPrincipal) void loadRecoveryPool()
  }, [isPrincipal, loadRecoveryPool])

  const togglePerm = (p: AdminPermission) =>
    setAdmPerms((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]
    )

  return (
    <>
      <div className="card">
        <h2>{t("people.admins")}</h2>
        <div className="table-wrap"><table className="table">
          <thead>
            <tr>
              <th>{t("people.label")}</th>
              <th>{t("people.email")}</th>
              <th>{t("people.roles")}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {admins.map((a) => (
              <tr key={a.id} className={a.locked ? "row-disabled" : undefined}>
                <td>
                  <strong>{a.label}</strong>
                  {a.is_principal ? " · Principal" : ""}
                  {a.locked ? (
                    <span className="lic-status bad" style={{ marginLeft: 8 }}>
                      {t("people.locked")}
                    </span>
                  ) : null}
                </td>
                <td className="muted">{a.email}</td>
                <td className="cell-wide muted" style={{ fontSize: 12 }}>
                  {a.is_principal
                    ? t("people.fullAccess")
                    : (a.permissions || []).join(", ")}
                  {a.failed_login_count
                    ? ` · ${t("people.failures")} ${a.failed_login_count}`
                    : ""}
                </td>
                <td className="cell-actions">
                  <div className="btn-group">
                    {/* Modifier : soi-même ou principal sur tout admin */}
                    {(sessionAdmin.id === a.id || isPrincipal) && (
                      <button
                        className="btn secondary btn-sm"
                        type="button"
                        disabled={busy}
                        title={t("common.edit")}
                        onClick={() => {
                          setEditId(a.id)
                          setEditEmail(a.email)
                          setEditCur("")
                          setEditPwd("")
                          setEditPwd2("")
                        }}>
                        {t("common.edit")}
                      </button>
                    )}
                    {sessionAdmin.id !== a.id && isPrincipal && (
                      <button
                        className="btn secondary btn-sm"
                        type="button"
                        disabled={busy}
                        title={t("people.newPwd")}
                        onClick={() => {
                          const pwd = prompt(
                            `${t("people.newPwdPrompt")} ${a.label} (≥8) :`
                          )
                          if (!pwd || pwd.length < 8) return
                          setBusy(true)
                          void api
                            .resetSecondaryPassword(a.id, pwd)
                            .then(() => {
                              setInfo(
                                `${t("people.newPwdSet")} ${a.label}`
                              )
                              onReload()
                            })
                            .catch((e) => setError(String(e)))
                            .finally(() => setBusy(false))
                        }}>
                        {t("people.newPwd")}
                      </button>
                    )}
                    {a.locked && isPrincipal && (
                      <button
                        className="btn secondary btn-sm"
                        type="button"
                        disabled={busy}
                        title={t("people.unlock")}
                        onClick={async () => {
                          setBusy(true)
                          try {
                            await api.unlockAdmin(a.id)
                            setInfo(`${t("people.unlocked")} ${a.label}`)
                            onReload()
                          } catch (e) {
                            setError(String(e))
                          } finally {
                            setBusy(false)
                          }
                        }}>
                        {t("people.unlock")}
                      </button>
                    )}
                    {sessionAdmin.id !== a.id && isPrincipal && (
                      <button
                        className="btn danger btn-sm"
                        type="button"
                        disabled={busy}
                        onClick={async () => {
                          if (!confirm(`${t("common.delete")} ${a.label} ?`))
                            return
                          setBusy(true)
                          try {
                            await api.deleteAdmin(a.id)
                            setInfo(`${a.label} ${t("people.deleted")}`)
                            onReload()
                          } catch (e) {
                            setError(String(e))
                          } finally {
                            setBusy(false)
                          }
                        }}>
                        {t("common.delete")}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
        {editId && (
          <div className="card" style={{ marginTop: 12, background: "#f6f7f9" }}>
            <h3>
              {t("people.editAccount")}
              {editId !== sessionAdmin.id
                ? ` · ${admins.find((x) => x.id === editId)?.label || ""}`
                : ""}
            </h3>
            <label className="field-label">{t("people.email")}</label>
            <input
              className="input"
              value={editEmail}
              onChange={(e) => setEditEmail(e.target.value)}
            />
            {editId === sessionAdmin.id ? (
              <>
                <label className="field-label">{t("people.currentPwd")}</label>
                <input
                  className="input"
                  type="password"
                  value={editCur}
                  onChange={(e) => setEditCur(e.target.value)}
                />
                <label className="field-label">{t("people.newPwdOptional")}</label>
                <input
                  className="input"
                  type="password"
                  value={editPwd}
                  onChange={(e) => setEditPwd(e.target.value)}
                />
                <label className="field-label">{t("people.confirmPwd")}</label>
                <input
                  className="input"
                  type="password"
                  value={editPwd2}
                  onChange={(e) => setEditPwd2(e.target.value)}
                />
              </>
            ) : (
              <>
                <label className="field-label">{t("people.newPwdOptional")}</label>
                <input
                  className="input"
                  type="password"
                  value={editPwd}
                  onChange={(e) => setEditPwd(e.target.value)}
                  placeholder="≥8"
                />
              </>
            )}
            <div className="row" style={{ marginTop: 10 }}>
              <button
                className="btn"
                type="button"
                disabled={
                  busy ||
                  (editId === sessionAdmin.id && !editCur) ||
                  (editPwd.length > 0 &&
                    (editPwd.length < 8 ||
                      (editId === sessionAdmin.id && editPwd !== editPwd2)))
                }
                onClick={async () => {
                  setBusy(true)
                  try {
                    if (editId === sessionAdmin.id) {
                      if (editPwd) {
                        await api.changePassword(
                          editCur,
                          editPwd,
                          editPwd2,
                          editEmail
                        )
                      } else {
                        await api.updateAdminSelf(editId, {
                          email: editEmail,
                          current_password: editCur
                        })
                      }
                    } else {
                      // Principal modifie un autre admin
                      await api.updateAdmin(editId, {
                        email: editEmail,
                        ...(editPwd.length >= 6 ? { password: editPwd } : {})
                      })
                    }
                    setInfo(t("people.accountUpdated"))
                    setEditId(null)
                    setEditPwd("")
                    setEditPwd2("")
                    setEditCur("")
                    onReload()
                  } catch (e) {
                    setError(String(e))
                  } finally {
                    setBusy(false)
                  }
                }}>
                {t("common.save")}
              </button>
              <button
                className="btn secondary"
                type="button"
                onClick={() => {
                  setEditId(null)
                  setEditPwd("")
                  setEditPwd2("")
                  setEditCur("")
                }}>
                {t("common.cancel")}
              </button>
            </div>
          </div>
        )}
        <h3 style={{ fontSize: 14 }}>{t("people.newAdmin")}</h3>
        <div className="row" style={{ marginTop: 8, flexWrap: "wrap" }}>
          <input
            className="input"
            value={admLabel}
            onChange={(e) => setAdmLabel(e.target.value)}
            placeholder={t("people.label")}
          />
          <input
            className="input"
            value={admEmail}
            onChange={(e) => setAdmEmail(e.target.value)}
            placeholder="email"
          />
          <input
            className="input"
            type="password"
            value={admPwd}
            onChange={(e) => setAdmPwd(e.target.value)}
            placeholder={t("people.pwdMin")}
          />
        </div>
        {isPrincipal && (
          <label
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
              marginTop: 10
            }}>
            <input
              type="checkbox"
              checked={admAsPrincipal}
              onChange={(e) => {
                setAdmAsPrincipal(e.target.checked)
                if (e.target.checked) setAdmPerms([...ALL_PERMS])
              }}
            />
            {t("people.asPrincipal")}
          </label>
        )}
        {!admAsPrincipal && (
          <div className="row" style={{ marginTop: 8, flexWrap: "wrap", gap: 8 }}>
            {ALL_PERMS.map((p) => (
              <label
                key={p}
                style={{ display: "flex", gap: 4, alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={admPerms.includes(p)}
                  onChange={() => togglePerm(p)}
                />
                {PERM_LABELS[p] || p}
              </label>
            ))}
          </div>
        )}
        <button
          className="btn"
          type="button"
          style={{ marginTop: 10 }}
          disabled={
            busy || !admLabel.trim() || !admEmail.includes("@") || admPwd.length < 8
          }
          onClick={async () => {
            setBusy(true)
            try {
              await api.createAdmin({
                label: admLabel.trim(),
                email: admEmail.trim(),
                password: admPwd,
                permissions: admAsPrincipal ? ALL_PERMS : admPerms,
                is_principal: admAsPrincipal
              })
              setInfo(
                `${t("people.adminCreated")} ${admLabel}${admAsPrincipal ? " (Principal)" : ""}`
              )
              setAdmPwd("")
              setAdmEmail("")
              setAdmAsPrincipal(false)
              onReload()
            } catch (e) {
              const msg = String(e)
              if (
                msg.toLowerCase().includes("déjà inscrit") ||
                msg.includes("email_already_registered")
              ) {
                setError(t("people.emailTaken"))
              } else {
                setError(msg)
              }
            } finally {
              setBusy(false)
            }
          }}>
          {t("people.addAdmin")}
        </button>
      </div>

      <div className="card">
        <h2>{t("people.groups")}</h2>
        {groups.length === 0 ? (
          <div className="empty">{t("people.noGroups")}</div>
        ) : (
          <div className="table-wrap"><table className="table">
            <thead>
              <tr>
                <th>{t("common.name")}</th>
                <th>{t("common.description")}</th>
                <th>{t("people.policyProfile")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.id}>
                  <td>
                    <strong>{g.name}</strong>
                  </td>
                  <td className="muted" style={{ fontSize: 12 }}>
                    {g.description || " - "}
                  </td>
                  <td className="mono" style={{ fontSize: 12 }}>
                    {g.policyProfileId
                      ? profiles.find((p) => p.id === g.policyProfileId)
                          ?.name || g.policyProfileId
                      : " - "}
                  </td>
                  <td>
                    <div className="btn-group">
                      <button
                        className="btn secondary btn-sm"
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setGrpEditId(g.id)
                          setGrpName(g.name)
                          setGrpDesc(g.description || "")
                          setGrpProfile(g.policyProfileId || "")
                          setShowGrpForm(true)
                        }}>
                        {t("common.edit")}
                      </button>
                      <button
                        className="btn danger btn-sm"
                        type="button"
                        disabled={busy}
                        onClick={async () => {
                          if (!confirm(`${t("common.delete")} ${g.name}?`)) return
                          setBusy(true)
                          try {
                            await api.deleteGroup(g.id)
                            onReload()
                          } catch (e) {
                            setError(String(e))
                          } finally {
                            setBusy(false)
                          }
                        }}>
                        {t("common.delete")}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
        {!showGrpForm && !grpEditId ? (
          <button
            className="btn"
            type="button"
            style={{ marginTop: 12 }}
            onClick={() => {
              setShowGrpForm(true)
              setGrpEditId(null)
              setGrpName("")
              setGrpDesc("")
              setGrpProfile("")
            }}>
            {t("people.createGroup")}
          </button>
        ) : (
          <div className="form-stack" style={{ maxWidth: 520, marginTop: 12 }}>
            <div
              className="row"
              style={{ justifyContent: "space-between", alignItems: "center" }}>
              <strong style={{ fontSize: 14 }}>
                {grpEditId ? t("people.editGroup") : t("people.newGroup")}
              </strong>
              <button
                className="btn secondary btn-sm"
                type="button"
                onClick={() => {
                  setShowGrpForm(false)
                  setGrpEditId(null)
                  setGrpName("")
                  setGrpDesc("")
                  setGrpProfile("")
                }}>
                {t("common.close")}
              </button>
            </div>
            <label className="field-label">{t("common.name")}</label>
            <input
              className="input"
              value={grpName}
              onChange={(e) => setGrpName(e.target.value)}
              placeholder="Finance"
            />
            <label className="field-label">{t("common.description")}</label>
            <input
              className="input"
              value={grpDesc}
              onChange={(e) => setGrpDesc(e.target.value)}
              placeholder="…"
            />
            <label className="field-label">{t("people.policyProfile")}</label>
            <select
              className="input"
              value={grpProfile}
              onChange={(e) => setGrpProfile(e.target.value)}>
              <option value="">-</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <div className="row" style={{ marginTop: 10 }}>
              <button
                className="btn"
                type="button"
                disabled={busy || !grpName.trim()}
                onClick={async () => {
                  setBusy(true)
                  try {
                    if (grpEditId) {
                      await api.updateGroup(grpEditId, {
                        name: grpName.trim(),
                        description: grpDesc || undefined,
                        policy_profile_id: grpProfile || null
                      })
                      setInfo(t("people.groupUpdated"))
                    } else {
                      await api.createGroup({
                        name: grpName.trim(),
                        description: grpDesc || undefined,
                        policy_profile_id: grpProfile || null
                      })
                      setInfo(t("people.groupCreated"))
                    }
                    setGrpName("")
                    setGrpDesc("")
                    setGrpProfile("")
                    setGrpEditId(null)
                    setShowGrpForm(false)
                    onReload()
                  } catch (e) {
                    setError(String(e))
                  } finally {
                    setBusy(false)
                  }
                }}>
                {grpEditId ? "Enregistrer le groupe" : "Créer le groupe"}
              </button>
              <button
                className="btn secondary"
                type="button"
                onClick={() => {
                  setShowGrpForm(false)
                  setGrpEditId(null)
                  setGrpName("")
                  setGrpDesc("")
                  setGrpProfile("")
                }}>
                Annuler
              </button>
            </div>
          </div>
        )}
        <p className="muted" style={{ marginTop: 10 }}>
          Affectation auto agents → groupe : <strong>Agents → Règles auto</strong>.
          Agent licencié <em>sans</em> groupe = <strong>policy org par défaut</strong>.
          LDAP : V2.1.
        </p>
      </div>

      <div className="card">
        <h2>Utilisateurs</h2>
        {users.length === 0 ? (
          <div className="empty">Aucun user</div>
        ) : (
          <div className="table-wrap"><table className="table">
            <thead>
              <tr>
                <th>Nom</th>
                <th>Email</th>
                <th>Groupes</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.displayName}</td>
                  <td className="muted">{u.email || " - "}</td>
                  <td className="muted" style={{ fontSize: 12 }}>
                    {(u.groupIds || [])
                      .map(
                        (gid) => groups.find((g) => g.id === gid)?.name || gid
                      )
                      .join(", ") || " - "}
                  </td>
                  <td>
                    <button
                      className="btn danger"
                      type="button"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true)
                        try {
                          await api.deleteUser(u.id)
                          onReload()
                        } catch (e) {
                          setError(String(e))
                        } finally {
                          setBusy(false)
                        }
                      }}>
                      Suppr.
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
        <div className="row" style={{ marginTop: 12, flexWrap: "wrap" }}>
          <input
            className="input"
            value={userName}
            onChange={(e) => setUserName(e.target.value)}
            placeholder="Nom affiché"
          />
          <input
            className="input"
            value={userEmail}
            onChange={(e) => setUserEmail(e.target.value)}
            placeholder="email"
          />
        </div>
        <div className="row" style={{ marginTop: 8, flexWrap: "wrap", gap: 8 }}>
          {groups.map((g) => (
            <label
              key={g.id}
              style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={userGroups.includes(g.id)}
                onChange={() =>
                  setUserGroups((prev) =>
                    prev.includes(g.id)
                      ? prev.filter((x) => x !== g.id)
                      : [...prev, g.id]
                  )
                }
              />
              {g.name}
            </label>
          ))}
          <button
            className="btn"
            type="button"
            disabled={busy || !userName.trim()}
            onClick={async () => {
              setBusy(true)
              try {
                await api.createUser({
                  display_name: userName.trim(),
                  email: userEmail || undefined,
                  group_ids: userGroups
                })
                setUserName("")
                setUserEmail("")
                setUserGroups([])
                setInfo("User créé")
                onReload()
              } catch (e) {
                setError(String(e))
              } finally {
                setBusy(false)
              }
            }}>
            Créer user
          </button>
        </div>
      </div>

      {(isPrincipal ||
        sessionAdmin.permissions?.includes("email_password_reset")) && (
          <div className="card">
            <h2>OTP - mon compte</h2>
            <p className="muted" style={{ fontSize: 13 }}>
              Réinitialisation de <strong>votre</strong> mot de passe par e-mail
              (compte connecté). SMTP : Paramètres → E-mail / SMTP.
            </p>
            <button
              className="btn secondary"
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                try {
                  const r = await api.requestSessionOtp()
                  setDevOtp(r.dev_otp || null)
                  setInfo(
                    r.target_email_masked
                      ? `${r.message} → ${r.target_email_masked}`
                      : r.message
                  )
                } catch (e) {
                  setError(String(e))
                } finally {
                  setBusy(false)
                }
              }}>
              Demander OTP (e-mail)
            </button>
            {devOtp && (
              <p className="ok">
                Lab OTP : <code>{devOtp}</code>
              </p>
            )}
            <div className="row" style={{ marginTop: 10 }}>
              <input
                className="input"
                placeholder="OTP"
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
              />
              <input
                className="input"
                type="password"
                placeholder="Nouveau mdp ≥8"
                value={otpNewPwd}
                onChange={(e) => setOtpNewPwd(e.target.value)}
              />
              <button
                className="btn"
                type="button"
                disabled={busy || !otp || otpNewPwd.length < 8}
                onClick={async () => {
                  setBusy(true)
                  try {
                    await api.confirmSessionOtp(otp, otpNewPwd)
                    setInfo("Mot de passe mis à jour pour votre compte")
                    setOtp("")
                    setOtpNewPwd("")
                    setDevOtp(null)
                  } catch (e) {
                    setError(String(e))
                  } finally {
                    setBusy(false)
                  }
                }}>
                Confirmer
              </button>
            </div>
          </div>
      )}

      {isPrincipal && (
          <div className="card">
            <h2>Recovery concepteur: codes one-time</h2>
            <div className="row" style={{ gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
              <span className="host-count-pill">
                {rcActive} actif{rcActive !== 1 ? "s" : ""}
              </span>
              {rcLow && (
                <span className="badge high" style={{ fontSize: 11 }}>
                  stock bas
                </span>
              )}
              <span className="muted" style={{ fontSize: 12 }}>
                offline ≥ 2 h · username vendor
              </span>
            </div>
            <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
              <input
                className="input"
                type="number"
                min={1}
                max={50}
                value={rcCount}
                onChange={(e) => setRcCount(Number(e.target.value) || 20)}
                style={{ width: 90 }}
                title="Nombre de codes"
              />
              <button
                className="btn"
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true)
                  try {
                    const r = await api.generateRecoveryCodes(rcCount)
                    setRcPlain(r.codes)
                    setInfo(
                      `${r.created} code(s) générés  -  copiez-les maintenant, puis force-sync agents`
                    )
                    await loadRecoveryPool()
                    try {
                      await api.forceSync()
                    } catch {
                      /* force-sync best-effort */
                    }
                  } catch (e) {
                    setError(String(e))
                  } finally {
                    setBusy(false)
                  }
                }}>
                Générer
              </button>
              <button
                className="btn secondary"
                type="button"
                disabled={busy || rcActive === 0}
                onClick={async () => {
                  if (
                    !confirm(
                      "Invalider le pool ? TOUS les codes (actifs et utilisés) seront EFFACÉS définitivement."
                    )
                  )
                    return
                  setBusy(true)
                  try {
                    const r = await api.revokeRecoveryPool()
                    setRcPlain(null)
                    setInfo(
                      `Pool purgé · ${r.revoked} code(s) effacé(s)`
                    )
                    await loadRecoveryPool()
                    try {
                      await api.forceSync()
                    } catch {
                      /* ignore */
                    }
                  } catch (e) {
                    setError(String(e))
                  } finally {
                    setBusy(false)
                  }
                }}>
                Invalider le pool
              </button>
              <button
                className="btn secondary"
                type="button"
                disabled={busy}
                onClick={() => void loadRecoveryPool()}>
                Actualiser
              </button>
              <button
                className="btn secondary"
                type="button"
                disabled={busy}
                title="Secours transition uniquement - mode principal: codes one-time"
                onClick={async () => {
                  setBusy(true)
                  try {
                    const r = await api.recoveryInfo()
                    setRecoveryHint(r.recovery_password_hint)
                    setInfo(
                      "Secret env encore accepté en secours (transition). Mode principal: codes one-time."
                    )
                  } catch (e) {
                    setError(String(e))
                  } finally {
                    setBusy(false)
                  }
                }}>
                Secret env (secours)
              </button>
              <button
                type="button"
                className="btn secondary"
                onClick={() => setRcShowUsed((v) => !v)}>
                {rcShowUsed ? "Masquer utilisés" : "Afficher utilisés"}
              </button>
            </div>
            <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
              Mode principal: codes one-time. Invalider le pool{" "}
              <strong>efface tous les codes</strong> de ce pool (actifs et
              déjà utilisés). Le secret env{" "}
              <code>OPSGATE_VENDOR_RECOVERY</code> reste techniquement accepté
              en secours offline si le pool est vide (déprécié, retrait V2).
            </p>
            {rcPlain && rcPlain.length > 0 && (
              <div
                className="recovery-codes-once"
                style={{
                  marginTop: 12,
                  padding: 12,
                  background: "var(--surface-2)",
                  borderRadius: 2,
                  borderLeft: "3px solid var(--warn)",
                  borderTop: "1px solid var(--line)",
                  borderRight: "1px solid var(--line)",
                  borderBottom: "1px solid var(--line)"
                }}>
                <strong style={{ fontSize: 13 }}>
                  Affichage unique  -  stockez hors ligne
                </strong>
                <pre
                  className="mono"
                  style={{
                    fontSize: 13,
                    margin: "8px 0 0",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-all",
                    letterSpacing: "0.04em"
                  }}>
                  {rcPlain.map((c) => c.code).join("\n")}
                </pre>
                <div className="row" style={{ marginTop: 8, gap: 8 }}>
                  <button
                    type="button"
                    className="btn secondary btn-sm"
                    onClick={() => {
                      void navigator.clipboard.writeText(
                        rcPlain.map((c) => c.code).join("\n")
                      )
                      setInfo("Codes copiés")
                    }}>
                    Copier
                  </button>
                  <button
                    type="button"
                    className="btn secondary btn-sm"
                    onClick={() => {
                      const body = [
                        "# OpsGate recovery codes  -  usage unique",
                        `# Généré ${new Date().toISOString()}`,
                        "# Username agent: vendor | recovery | opsgate",
                        "# Uniquement si offline ≥ 2h",
                        "",
                        ...rcPlain.map((c) => c.code)
                      ].join("\n")
                      downloadTextFile(
                        `opsgate-recovery-codes-${new Date().toISOString().slice(0, 10)}.txt`,
                        body,
                        "text/plain;charset=utf-8"
                      )
                      setInfo("Fichier .txt téléchargé")
                    }}>
                    Télécharger .txt
                  </button>
                  <button
                    type="button"
                    className="btn secondary btn-sm"
                    onClick={() => setRcPlain(null)}>
                    Masquer
                  </button>
                </div>
              </div>
            )}
            {recoveryHint && (
              <p className="muted" style={{ marginTop: 10, fontSize: 12 }}>
                Secret env (secours) : <code>{recoveryHint}</code>
                {" · "}encore utilisable en transition; production = codes
                one-time uniquement.
              </p>
            )}
            {rcRows.filter((c) =>
              c.active ? true : rcShowUsed && !!c.consumed_at
            ).length > 0 && (
              <div className="table-wrap" style={{ marginTop: 12 }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Etat</th>
                      <th>Label</th>
                      <th>Cree</th>
                      <th>Consomme</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rcRows
                      .filter((c) =>
                        c.active ? true : rcShowUsed && !!c.consumed_at
                      )
                      .slice(0, 40)
                      .map((c) => (
                      <tr key={c.id}>
                        <td>
                          <span
                            className={`lic-status ${c.active ? "ok" : "grace"}`}>
                            {c.active ? "actif" : "utilisé"}
                          </span>
                        </td>
                        <td className="muted">{c.label || " - "}</td>
                        <td className="muted" style={{ fontSize: 12 }}>
                          {c.created_at
                            ? new Date(c.created_at).toLocaleString("fr-FR")
                            : " - "}
                        </td>
                        <td className="muted" style={{ fontSize: 12 }}>
                          {c.consumed_at
                            ? new Date(c.consumed_at).toLocaleString("fr-FR")
                            : " - "}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
      )}
    </>
  )
}

function AgentsView({
  agents,
  profiles,
  users,
  groups,
  busy,
  onRevoke,
  onAssign,
  onAssignUser,
  setBusy,
  setError,
  setInfo,
  onReload
}: {
  agents: AgentRow[]
  profiles: ProfileRow[]
  users: UserRow[]
  groups: GroupRow[]
  busy: boolean
  onRevoke: (id: string) => void
  onAssign: (agentId: string, profileId: string | null) => void
  onAssignUser: (agentId: string, userId: string | null) => void
  setBusy: (b: boolean) => void
  setError: (e: string | null) => void
  setInfo: (i: string | null) => void
  onReload: () => void
}) {
  const dtPrefs = useDateTimePrefs()
  const [stats, setStats] = useState<{
    licensed_agents: number
    unlicensed_agents: number
    grace_agents: number
    seats: number
    seats_used: number
    seats_available: number | null
  } | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [bulkGroup, setBulkGroup] = useState("")
  const [bulkProfile, setBulkProfile] = useState("")
  const [pageSize, setPageSize] = useState(50)
  const [page, setPage] = useState(1)
  const [searchQ, setSearchQ] = useState("")
  const [sortBy, setSortBy] = useState<
    "label" | "enrolled" | "last_seen" | "group" | "profile"
  >("label")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")
  const [filterStatus, setFilterStatus] = useState<
    "all" | "active" | "maintenance"
  >("all")
  const [filterGroup, setFilterGroup] = useState("")
  const [filterProfile, setFilterProfile] = useState("")

  useEffect(() => {
    void api.licenses().then(setStats).catch(() => setStats(null))
  }, [agents])

  const agentLabel = (a: AgentRow) =>
    (a.device_label || "")
      .replace(/^OpsGate Proxy\s*/i, "")
      .trim() ||
    a.host_name ||
    a.id

  const filteredAgents = useMemo(() => {
    const q = searchQ.trim().toLowerCase()
    let list = agents.filter((a) => {
      if (filterStatus === "active" && a.maintenance_mode) return false
      if (filterStatus === "maintenance" && !a.maintenance_mode) return false
      if (filterGroup && (a.group_id || "") !== filterGroup) return false
      if (filterProfile && (a.policy_profile_id || "") !== filterProfile)
        return false
      if (q) {
        const hay = [
          a.device_label,
          a.host_name,
          a.id,
          a.app_version,
          a.group_id
            ? groups.find((g) => g.id === a.group_id)?.name
            : "",
          a.policy_profile_id
            ? profiles.find((p) => p.id === a.policy_profile_id)?.name
            : "",
          a.maintenance_mode || "active"
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
    const dir = sortDir === "asc" ? 1 : -1
    list = [...list].sort((a, b) => {
      let cmp = 0
      if (sortBy === "label") {
        cmp = agentLabel(a).localeCompare(agentLabel(b), "fr", {
          sensitivity: "base"
        })
      } else if (sortBy === "enrolled") {
        cmp =
          new Date(a.enrolled_at).getTime() - new Date(b.enrolled_at).getTime()
      } else if (sortBy === "last_seen") {
        cmp =
          new Date(a.last_seen_at).getTime() -
          new Date(b.last_seen_at).getTime()
      } else if (sortBy === "group") {
        const ga =
          groups.find((g) => g.id === a.group_id)?.name || a.group_id || ""
        const gb =
          groups.find((g) => g.id === b.group_id)?.name || b.group_id || ""
        cmp = ga.localeCompare(gb, "fr", { sensitivity: "base" })
      } else if (sortBy === "profile") {
        const pa =
          profiles.find((p) => p.id === a.policy_profile_id)?.name ||
          a.policy_profile_id ||
          ""
        const pb =
          profiles.find((p) => p.id === b.policy_profile_id)?.name ||
          b.policy_profile_id ||
          ""
        cmp = pa.localeCompare(pb, "fr", { sensitivity: "base" })
      }
      return cmp * dir
    })
    return list
  }, [
    agents,
    searchQ,
    sortBy,
    sortDir,
    filterStatus,
    filterGroup,
    filterProfile,
    groups,
    profiles
  ])

  useEffect(() => {
    setPage(1)
  }, [
    filteredAgents.length,
    pageSize,
    searchQ,
    sortBy,
    sortDir,
    filterStatus,
    filterGroup,
    filterProfile
  ])

  const pagedAgents = useMemo(() => {
    const start = (page - 1) * pageSize
    return filteredAgents.slice(start, start + pageSize)
  }, [filteredAgents, page, pageSize])

  const toggleSel = (id: string) =>
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )

  const toggleSort = (col: typeof sortBy) => {
    if (sortBy === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortBy(col)
      setSortDir(col === "enrolled" || col === "last_seen" ? "desc" : "asc")
    }
  }

  const sortMark = (col: typeof sortBy) =>
    sortBy === col ? (sortDir === "asc" ? " ↑" : " ↓") : ""

  const exportAgents = (fmt: "csv" | "json") => {
    const rows = filteredAgents.map((a) => ({
      id: a.id,
      device_label: agentLabel(a),
      host_name: a.host_name || "",
      device_type: a.device_type || "extension",
      app_version: a.app_version || "",
      enrolled_at: a.enrolled_at,
      last_seen_at: a.last_seen_at,
      license_status: a.license_status || (a.licensed ? "licensed" : "unlicensed"),
      licensed: !!a.licensed,
      group_id: a.group_id || "",
      group_name:
        groups.find((g) => g.id === a.group_id)?.name || "",
      policy_profile_id: a.policy_profile_id || "",
      policy_profile_name:
        profiles.find((p) => p.id === a.policy_profile_id)?.name || "",
      user_id: a.user_id || "",
      user_name:
        users.find((u) => u.id === a.user_id)?.displayName || "",
      maintenance_mode: a.maintenance_mode || "",
      maintenance_note: a.maintenance_note || "",
      device_fingerprint: a.device_fingerprint || "",
      status: a.maintenance_mode ? `maintenance:${a.maintenance_mode}` : "active"
    }))
    const stamp = new Date().toISOString().slice(0, 10)
    if (fmt === "json") {
      downloadTextFile(
        `opsgate-agents-${stamp}.json`,
        JSON.stringify(rows, null, 2),
        "application/json"
      )
      setInfo(`Export JSON · ${rows.length} agent(s)`)
      return
    }
    const cols = [
      "id",
      "device_label",
      "host_name",
      "device_type",
      "app_version",
      "enrolled_at",
      "last_seen_at",
      "license_status",
      "licensed",
      "group_name",
      "group_id",
      "policy_profile_name",
      "policy_profile_id",
      "user_name",
      "user_id",
      "maintenance_mode",
      "maintenance_note",
      "status",
      "device_fingerprint"
    ] as const
    const esc = (v: unknown) => {
      const s = v == null ? "" : String(v)
      if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
      return s
    }
    const lines = [
      cols.join(","),
      ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))
    ]
    downloadTextFile(
      `opsgate-agents-${stamp}.csv`,
      "\uFEFF" + lines.join("\n"),
      "text/csv;charset=utf-8"
    )
    setInfo(`Export CSV · ${rows.length} agent(s)`)
  }

  return (
    <>
      <div className="card">
        <h2>
          Licences agents (sièges){" "}
          {stats && stats.unlicensed_agents > 0 && (
            <span className="badge danger-text" style={{ marginLeft: 8 }}>
              {stats.unlicensed_agents} UNLICENSED
            </span>
          )}
        </h2>
        {stats && (
          <div className="grid">
            <div className="stat">
              <div className="label">Sièges total</div>
              <div className="value">
                {stats.seats === 0 ? "∞" : stats.seats}
              </div>
            </div>
            <div className="stat">
              <div className="label">Utilisés</div>
              <div className="value">{stats.seats_used}</div>
            </div>
            <div className="stat">
              <div className="label">Disponibles</div>
              <div
                className="value"
                style={{
                  color:
                    stats.seats_available === 0
                      ? "#b91c1c"
                      : stats.seats_available !== null
                        ? "#047857"
                        : undefined
                }}>
                {stats.seats_available === null
                  ? "∞"
                  : stats.seats_available}
              </div>
            </div>
            <div className="stat">
              <div className="label">Unlicensed</div>
              <div
                className="value"
                style={{
                  color: stats.unlicensed_agents > 0 ? "#b91c1c" : undefined
                }}>
                {stats.unlicensed_agents}
              </div>
            </div>
            <div className="stat">
              <div className="label">Grace</div>
              <div className="value">{stats.grace_agents}</div>
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <div
          className="row"
          style={{
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 8,
            marginBottom: 8
          }}>
          <h2 style={{ margin: 0 }}>Agents enrollés</h2>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn secondary btn-sm"
              disabled={filteredAgents.length === 0}
              onClick={() => exportAgents("csv")}
              title="Exporte la vue filtrée (CSV)">
              Export CSV
            </button>
            <button
              type="button"
              className="btn secondary btn-sm"
              disabled={filteredAgents.length === 0}
              onClick={() => exportAgents("json")}
              title="Exporte la vue filtrée (JSON)">
              Export JSON
            </button>
            <label
              className="btn secondary btn-sm"
              style={{ cursor: "pointer", margin: 0 }}
              title="CSV : agent_id ou device_label ou host_name + group/profile/license">
              Import CSV…
              <input
                type="file"
                accept=".csv,text/csv"
                style={{ display: "none" }}
                onChange={async (e) => {
                  const f = e.target.files?.[0]
                  e.target.value = ""
                  if (!f) return
                  setBusy(true)
                  setError(null)
                  try {
                    const text = await f.text()
                    const dry = await api.importAgentsCsv(text, true)
                    const msg = `Aperçu : ${dry.matched} match · ${dry.updated} maj · ${dry.skipped} skip${
                      dry.errors?.length
                        ? ` · ${dry.errors.slice(0, 3).join(" ; ")}`
                        : ""
                    }\nAppliquer l’import ?`
                    if (!confirm(msg)) return
                    const r = await api.importAgentsCsv(text, false)
                    setInfo(
                      `Import CSV : ${r.updated} mis à jour · ${r.matched} match · ${r.skipped} ignorés`
                    )
                    onReload()
                  } catch (err) {
                    setError(String(err))
                  } finally {
                    setBusy(false)
                  }
                }}
              />
            </label>
          </div>
        </div>
        <div
          className="filters-bar"
          style={{
            marginBottom: 12,
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            alignItems: "center"
          }}>
          <input
            className="input"
            style={{ minWidth: 200, flex: "1 1 180px" }}
            placeholder="Rechercher (label, host, id, groupe…)"
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            aria-label="Rechercher un agent"
          />
          <select
            className="input"
            value={filterStatus}
            onChange={(e) =>
              setFilterStatus(e.target.value as typeof filterStatus)
            }
            title="Statut">
            <option value="all">Tous statuts</option>
            <option value="active">Actifs uniquement</option>
            <option value="maintenance">Maintenance uniquement</option>
          </select>
          <select
            className="input"
            value={filterGroup}
            onChange={(e) => setFilterGroup(e.target.value)}
            title="Groupe">
            <option value="">Tous groupes</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
          <select
            className="input"
            value={filterProfile}
            onChange={(e) => setFilterProfile(e.target.value)}
            title="Profil">
            <option value="">Tous profils</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <select
            className="input"
            value={`${sortBy}:${sortDir}`}
            onChange={(e) => {
              const [b, d] = e.target.value.split(":") as [
                typeof sortBy,
                "asc" | "desc"
              ]
              setSortBy(b)
              setSortDir(d)
            }}
            title="Tri">
            <option value="label:asc">Label A→Z</option>
            <option value="label:desc">Label Z→A</option>
            <option value="enrolled:desc">Enrôlement récent</option>
            <option value="enrolled:asc">Enrôlement ancien</option>
            <option value="last_seen:desc">Vu récemment</option>
            <option value="last_seen:asc">Vu il y a longtemps</option>
            <option value="group:asc">Groupe A→Z</option>
            <option value="profile:asc">Profil A→Z</option>
          </select>
          <span className="muted" style={{ fontSize: 12 }}>
            {filteredAgents.length}/{agents.length}
          </span>
        </div>
        {selected.length > 0 && (
          <div
            className="row"
            style={{
              marginBottom: 12,
              padding: 12,
              background: "var(--accent-soft)",
              borderRadius: 8,
              flexWrap: "wrap",
              gap: 8
            }}>
            <strong>{selected.length} sélectionné(s)</strong>
            <select
              className="input"
              value={bulkGroup}
              onChange={(e) => setBulkGroup(e.target.value)}>
              <option value="">→ Groupe…</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
            <select
              className="input"
              value={bulkProfile}
              onChange={(e) => setBulkProfile(e.target.value)}>
              <option value="">→ Profil (optionnel)</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <button
              className="btn btn-sm"
              type="button"
              disabled={busy || (!bulkGroup && !bulkProfile)}
              onClick={async () => {
                setBusy(true)
                try {
                  const r = await api.bulkAssignAgents({
                    agent_ids: selected,
                    group_id: bulkGroup || null,
                    policy_profile_id: bulkProfile
                      ? bulkProfile
                      : bulkGroup
                        ? undefined
                        : null
                  })
                  setInfo(`Bulk : ${r.updated} agent(s) mis à jour`)
                  setSelected([])
                  onReload()
                } catch (e) {
                  setError(String(e))
                } finally {
                  setBusy(false)
                }
              }}>
              Appliquer
            </button>
            <button
              className="btn secondary btn-sm"
              type="button"
              onClick={() => setSelected([])}>
              Tout désélectionner
            </button>
          </div>
        )}
        {agents.length === 0 ? (
          <div className="empty">Aucun agent</div>
        ) : filteredAgents.length === 0 ? (
          <div className="empty">Aucun agent ne correspond aux filtres</div>
        ) : (
          <>
          <PagerBar
            page={page}
            pageSize={pageSize}
            total={filteredAgents.length}
            onPage={setPage}
            onPageSize={setPageSize}
          />
          <div className="table-wrap table-wrap--scroll-x">
            <table className="table table-resizable table-agents">
            <thead>
              <tr>
                <th style={{ width: 40, minWidth: 36 }}>
                  <input
                    type="checkbox"
                    checked={
                      filteredAgents.length > 0 &&
                      selected.length === filteredAgents.length
                    }
                    onChange={(e) =>
                      setSelected(
                        e.target.checked
                          ? filteredAgents.map((a) => a.id)
                          : []
                      )
                    }
                  />
                </th>
                <th
                  className="col-label"
                  style={{ cursor: "pointer" }}
                  onClick={() => toggleSort("label")}
                  title="Trier par label">
                  Label appareil{sortMark("label")}
                </th>
                <th style={{ width: 100, minWidth: 80 }}>Licence</th>
                <th
                  style={{ cursor: "pointer", minWidth: 100 }}
                  onClick={() => toggleSort("group")}
                  title="Trier par groupe">
                  Groupe{sortMark("group")}
                </th>
                <th style={{ minWidth: 120 }}>User</th>
                <th
                  style={{ cursor: "pointer", minWidth: 120 }}
                  onClick={() => toggleSort("profile")}
                  title="Trier par profil">
                  Profil{sortMark("profile")}
                </th>
                <th
                  title="Congé / panne / hors site - hors alertes offline long"
                  style={{ width: 120, minWidth: 100 }}>
                  Maint.
                </th>
                <th
                  className="col-time"
                  style={{ cursor: "pointer", minWidth: 140 }}
                  onClick={() => toggleSort("last_seen")}
                  title="Trier par last seen">
                  Last seen{sortMark("last_seen")}
                </th>
                <th
                  style={{ cursor: "pointer", minWidth: 140 }}
                  onClick={() => toggleSort("enrolled")}
                  title="Trier par date d’enrôlement">
                  Enrôlé{sortMark("enrolled")}
                </th>
                <th style={{ minWidth: 200 }}></th>
              </tr>
            </thead>
            <tbody>
              {pagedAgents.map((a) => (
                <tr key={a.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.includes(a.id)}
                      onChange={() => toggleSel(a.id)}
                    />
                  </td>
                  <td>
                    <strong>{agentLabel(a)}</strong>
                    {a.device_type === "proxy" ||
                    (a.app_version || "").startsWith("proxy") ? (
                      <span
                        className="meta-tag"
                        style={{
                          marginLeft: 8,
                          background: "rgba(37, 99, 235, 0.12)",
                          color: "#1d4ed8",
                          border: "1px solid rgba(37, 99, 235, 0.25)"
                        }}
                        title="Agent proxy local (data-plane)">
                        Proxy
                      </span>
                    ) : null}
                    {a.maintenance_mode ? (
                      <span
                        className="meta-tag"
                        style={{
                          marginLeft: 6,
                          background: "rgba(217, 119, 6, 0.12)",
                          color: "#b45309",
                          border: "1px solid rgba(217, 119, 6, 0.3)",
                          fontSize: 10
                        }}
                        title={a.maintenance_note || a.maintenance_mode}>
                        {a.maintenance_mode === "leave"
                          ? "congé"
                          : a.maintenance_mode === "outage"
                            ? "panne"
                            : "remote"}
                      </span>
                    ) : null}
                    {a.ai_access_blocked || a.ai_access === "blocked" ? (
                      <span
                        className="meta-tag"
                        style={{
                          marginLeft: 6,
                          background: "rgba(239, 68, 68, 0.12)",
                          color: "#b91c1c",
                          border: "1px solid rgba(239, 68, 68, 0.3)",
                          fontSize: 10,
                          fontWeight: 700
                        }}
                        title={
                          a.ai_access_blocked_by
                            ? `IA bloquée · ${a.ai_access_blocked_by}`
                            : "Accès IA suspendu (sevrage)"
                        }>
                        AI blocked
                      </span>
                    ) : null}
                    <div className="mono muted" style={{ fontSize: 11 }}>
                      {a.id}
                      {a.app_version ? ` · ${a.app_version}` : ""}
                    </div>
                  </td>
                  <td>
                    {a.license_status === "unlicensed" ||
                    a.licensed === false ? (
                      <span className="lic-status bad">UNLICENSED</span>
                    ) : a.license_status === "grace" ? (
                      <span className="lic-status grace">grace</span>
                    ) : (
                      <span className="lic-status ok">licensed</span>
                    )}
                  </td>
                  <td className="muted" style={{ fontSize: 12 }}>
                    {a.group_id
                      ? groups.find((g) => g.id === a.group_id)?.name ||
                        a.group_id
                      : " - "}
                  </td>
                  <td className="cell-select">
                    <select
                      className="input"
                      disabled={busy}
                      value={a.user_id || ""}
                      onChange={(e) => {
                        const v = e.target.value
                        onAssignUser(a.id, v ? v : null)
                      }}>
                      <option value="">(aucun)</option>
                      {users.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.displayName}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="cell-select">
                    <select
                      className="input"
                      disabled={busy}
                      value={a.policy_profile_id || ""}
                      onChange={(e) => {
                        const v = e.target.value
                        onAssign(a.id, v ? v : null)
                      }}>
                      <option value="">(défaut)</option>
                      {profiles.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="cell-select">
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <select
                        className="input"
                        disabled={busy}
                        value={a.maintenance_mode || ""}
                        title="Mode maintenance - exclut des alertes hors-ligne prolongé"
                        onChange={async (e) => {
                          const v = e.target.value
                          const mode =
                            v === "leave" || v === "outage" || v === "remote"
                              ? v
                              : null
                          setBusy(true)
                          try {
                            await api.setAgentMaintenance(a.id, mode)
                            setInfo(
                              mode
                                ? `Maintenance « ${mode} » → ${a.device_label || a.id}`
                                : `Maintenance désactivée → ${a.device_label || a.id}`
                            )
                            onReload()
                          } catch (err) {
                            setError(String(err))
                          } finally {
                            setBusy(false)
                          }
                        }}>
                        <option value="">Actif</option>
                        <option value="leave">Congé / mission</option>
                        <option value="outage">Panne</option>
                        <option value="remote">Hors site</option>
                      </select>
                      <button
                        type="button"
                        className={
                          a.ai_access_blocked || a.ai_access === "blocked"
                            ? "btn secondary btn-sm"
                            : "btn danger btn-sm"
                        }
                        disabled={busy}
                        title="Sevrage IA : force block sur l’extension au prochain sync"
                        onClick={async () => {
                          const blocked = !(
                            a.ai_access_blocked || a.ai_access === "blocked"
                          )
                          if (
                            blocked &&
                            !window.confirm(
                              `Suspendre l’accès IA pour « ${a.device_label || a.id} » ? L’agent passera en block au prochain sync.`
                            )
                          ) {
                            return
                          }
                          setBusy(true)
                          try {
                            await api.setAgentAiAccess(a.id, blocked)
                            setInfo(
                              blocked
                                ? `Accès IA suspendu → ${a.device_label || a.id}`
                                : `Accès IA rétabli → ${a.device_label || a.id}`
                            )
                            onReload()
                          } catch (err) {
                            setError(String(err))
                          } finally {
                            setBusy(false)
                          }
                        }}>
                        {a.ai_access_blocked || a.ai_access === "blocked"
                          ? "Rétablir IA"
                          : "Bloquer IA"}
                      </button>
                    </div>
                  </td>
                  <td className="cell-narrow muted">
                    {formatDateTimeAny(a.last_seen_at, dtPrefs)}
                  </td>
                  <td className="cell-narrow muted" style={{ fontSize: 11 }}>
                    {a.enrolled_at
                      ? formatDateTimeAny(a.enrolled_at, dtPrefs)
                      : "-"}
                  </td>
                  <td className="cell-actions">
                    <div className="btn-group">
                      <button
                        className="btn secondary btn-sm"
                        type="button"
                        disabled={busy}
                        onClick={async () => {
                          setBusy(true)
                          try {
                            await api.setAgentLicense(a.id, true)
                            setInfo(
                              `Licence assignée à ${a.device_label || a.id}`
                            )
                            onReload()
                          } catch (e) {
                            setError(String(e))
                          } finally {
                            setBusy(false)
                          }
                        }}>
                        + licence
                      </button>
                      <button
                        className="btn secondary btn-sm"
                        type="button"
                        disabled={busy}
                        onClick={async () => {
                          setBusy(true)
                          try {
                            await api.setAgentLicense(a.id, false)
                            setInfo(
                              `Licence retirée ${a.device_label || a.id}`
                            )
                            onReload()
                          } catch (e) {
                            setError(String(e))
                          } finally {
                            setBusy(false)
                          }
                        }}>
                        − licence
                      </button>
                      <button
                        type="button"
                        className="btn danger btn-sm"
                        disabled={busy}
                        onClick={() => {
                          if (
                            confirm(
                              `Révoquer l’agent « ${a.device_label || a.id} » ?`
                            )
                          ) {
                            onRevoke(a.id)
                          }
                        }}>
                        Révoquer
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          <p className="muted" style={{ fontSize: 11, marginTop: 6 }}>
            Astuce : redimensionnez les colonnes (bord droit de l’en-tête) ·
            scrollbar horizontal en bas si débordement · Export = vue filtrée.
          </p>
          <PagerBar
            page={page}
            pageSize={pageSize}
            total={filteredAgents.length}
            onPage={setPage}
            onPageSize={setPageSize}
          />
          </>
        )}
      </div>
    </>
  )
}

function decisionLabelFr(d: string): string {
  switch (d) {
    case "secure_rewrite":
      return "Secure Rewrite"
    case "mask_send":
      return "Masquer et envoyer"
    case "send_anyway":
      return "Envoyer quand même"
    case "cancel":
      return "Annuler"
    case "enroll":
      return "Enrôlement"
    case "unenroll":
      return "Désenrôlement"
    case "observe":
      return "Observé (réseau proxy)"
    case "block":
      return "Bloqué au réseau (proxy)"
    default:
      return d || " - "
  }
}

function sourceLabelFr(s: string): string {
  switch (s) {
    case "proxy":
      return "proxy"
    case "file":
      return "fichier"
    case "system":
      return "système"
    case "prompt":
    case "text":
      return "prompt"
    default:
      return s || ""
  }
}

/** Libellés courts pour types / règles (évite « Carte bancaire, proxy_block, credit-card… ») */
function ruleShortLabel(id: string): string {
  const map: Record<string, string> = {
    "credit-card": "Carte bancaire",
    "generic-api-key": "Clé API",
    "aws-access-key": "AWS key",
    "aws-secret-key": "AWS secret",
    "private-key": "Clé privée",
    "password-assignment": "Mot de passe",
    "email-address": "E-mail",
    iban: "IBAN",
    "phone-fr": "Téléphone",
    "license-key": "Licence",
    "fortinet-config": "Fortinet",
    file_upload: "Upload",
    proxy_block: "Blocage proxy",
    detection: "Détection"
  }
  return map[id] || id.replace(/^system\./, "")
}

function eventDetailSummary(e: {
  types?: string[]
  rule_ids?: string[]
  file_names?: string[] | null
  decision?: string
  source?: string
}): string {
  const rules = (e.rule_ids || []).filter((r) => !r.startsWith("system."))
  const types = e.types || []
  // Priorité : règles métier, puis flags techniques (proxy_block, file_upload)
  const primary = rules.length
    ? rules.slice(0, 2).map(ruleShortLabel)
    : types
        .filter((t) => t !== "proxy_block" && t !== "file_upload")
        .slice(0, 2)
        .map(ruleShortLabel)
  const flags: string[] = []
  if (types.includes("proxy_block") || e.decision === "block") flags.push("bloqué")
  if (types.includes("file_upload") || (e.file_names && e.file_names.length)) {
    flags.push("fichier")
  }
  const parts = [...primary]
  if (flags.length) parts.push(flags.join(" · "))
  if (e.file_names?.length) {
    parts.push(e.file_names.slice(0, 2).join(", "))
  }
  return parts.filter(Boolean).join(" · ") || "-"
}

function downloadTextFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function PageSizeSelect({
  value,
  onChange
}: {
  value: number
  onChange: (n: number) => void
}) {
  return (
    <label className="row" style={{ gap: 6, alignItems: "center" }}>
      <span>Lignes</span>
      <select
        className="input"
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || 50)}>
        <option value={10}>10</option>
        <option value={50}>50</option>
        <option value={100}>100</option>
      </select>
    </label>
  )
}

function PagerBar({
  page,
  pageSize,
  total,
  onPage,
  onPageSize
}: {
  page: number
  pageSize: number
  total: number
  onPage: (p: number) => void
  onPageSize: (n: number) => void
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const safe = Math.min(Math.max(1, page), pages)
  const from = total === 0 ? 0 : (safe - 1) * pageSize + 1
  const to = Math.min(total, safe * pageSize)
  return (
    <div className="pager-bar">
      <span>
        {total === 0 ? "0 entrée" : `${from}-${to} / ${total}`}
      </span>
      <div className="row">
        <PageSizeSelect
          value={pageSize}
          onChange={(n) => {
            onPageSize(n)
            onPage(1)
          }}
        />
        <button
          type="button"
          className="btn secondary btn-sm"
          disabled={safe <= 1}
          onClick={() => onPage(safe - 1)}>
          Préc.
        </button>
        <span>
          {safe}/{pages}
        </span>
        <button
          type="button"
          className="btn secondary btn-sm"
          disabled={safe >= pages}
          onClick={() => onPage(safe + 1)}>
          Suiv.
        </button>
      </div>
    </div>
  )
}

function EventsView({
  events,
  setError,
  setInfo,
  t
}: {
  events: EventRow[]
  setError?: (e: string | null) => void
  setInfo?: (i: string | null) => void
  t: (k: string, vars?: Record<string, string | number>) => string
}) {
  const dtPrefs = useDateTimePrefs()
  const [decisionF, setDecisionF] = useState("")
  const [severityF, setSeverityF] = useState("")
  const [sourceF, setSourceF] = useState(() => {
    try {
      const p = sessionStorage.getItem("opsgate_events_preset")
      if (p === "proxy") {
        sessionStorage.removeItem("opsgate_events_preset")
        return "proxy"
      }
    } catch {
      /* ignore */
    }
    return ""
  })
  const [labelF, setLabelF] = useState("")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [exportFrom, setExportFrom] = useState("")
  const [exportTo, setExportTo] = useState("")
  const [showExportRange, setShowExportRange] = useState(false)
  const [pageSize, setPageSize] = useState(50)
  const [page, setPage] = useState(1)
  const [exportBusy, setExportBusy] = useState(false)

  // Deep-link / dashboard : preset source=proxy après navigation
  useEffect(() => {
    try {
      const p = sessionStorage.getItem("opsgate_events_preset")
      if (p === "proxy") {
        setSourceF("proxy")
        sessionStorage.removeItem("opsgate_events_preset")
      }
    } catch {
      /* ignore */
    }
  }, [events.length])
  const [manualFmt, setManualFmt] = useState<"csv" | "json">(() => {
    try {
      return localStorage.getItem("opsgate_report_format") === "json"
        ? "json"
        : "csv"
    } catch {
      return "csv"
    }
  })
  const searchRef = useRef<HTMLInputElement>(null)
  const [archives, setArchives] = useState<
    Array<{
      id: string
      kind: string
      filename: string
      event_count: number
      remaining_days: number
      created_at: string
      expires_at: string
    }>
  >([])

  useEffect(() => {
    void (async () => {
      try {
        const r = await api.listEventExports()
        setArchives(r.exports || [])
      } catch {
        /* ignore */
      }
    })()
  }, [events.length])

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "/" || ev.ctrlKey || ev.metaKey || ev.altKey) return
      const t = ev.target as HTMLElement | null
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT" ||
          t.isContentEditable)
      ) {
        return
      }
      ev.preventDefault()
      searchRef.current?.focus()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const decisions = useMemo(
    () =>
      [...new Set(events.map((e) => e.decision).filter(Boolean))].sort(),
    [events]
  )
  const severities = useMemo(
    () =>
      [
        ...new Set(events.map((e) => e.highest_severity).filter(Boolean))
      ].sort(),
    [events]
  )
  const sources = useMemo(
    () => [...new Set(events.map((e) => e.source).filter(Boolean))].sort(),
    [events]
  )

  const filtered = useMemo(() => {
    const q = labelF.trim().toLowerCase()
    const fromMs = dateFrom ? Date.parse(dateFrom + "T00:00:00") : null
    const toMs = dateTo ? Date.parse(dateTo + "T23:59:59.999") : null
    return events.filter((e) => {
      if (decisionF && e.decision !== decisionF) return false
      if (severityF && e.highest_severity !== severityF) return false
      if (sourceF && e.source !== sourceF) return false
      if (fromMs != null || toMs != null) {
        const t = Date.parse(e.ts)
        if (!Number.isFinite(t)) return false
        if (fromMs != null && t < fromMs) return false
        if (toMs != null && t > toMs) return false
      }
      if (q) {
        const hay = `${e.device_label || ""} ${e.hostname || ""} ${(e.types || []).join(" ")} ${(e.file_names || []).join(" ")}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [events, decisionF, severityF, sourceF, labelF, dateFrom, dateTo])

  useEffect(() => {
    setPage(1)
  }, [decisionF, severityF, sourceF, labelF, dateFrom, dateTo, pageSize])

  const pagedEvents = useMemo(() => {
    const start = (page - 1) * pageSize
    return filtered.slice(start, start + pageSize)
  }, [filtered, page, pageSize])

  const doExport = async (
    range: "week" | "all" | "custom",
    from?: string,
    to?: string
  ) => {
    setExportBusy(true)
    setError?.(null)
    try {
      const fmt = manualFmt
      if (range === "custom" && (!from || !to)) {
        setError?.("from/to required")
        setExportBusy(false)
        return
      }
      const r = await api.exportEvents(range, fmt, {
        from: range === "custom" ? from : undefined,
        to: range === "custom" ? to : undefined
      })
      downloadTextFile(
        r.filename,
        r.content,
        fmt === "json" ? "application/json" : "text/csv;charset=utf-8"
      )
      setInfo?.(
        `Export ${range}${from && to ? ` ${from}→${to}` : ""} · ${r.count} events · ${fmt.toUpperCase()}`
      )
      const list = await api.listEventExports()
      setArchives(list.exports || [])
    } catch (e) {
      setError?.(String(e))
    } finally {
      setExportBusy(false)
    }
  }

  return (
    <div className="card">
      <div
        className="row"
        style={{
          justifyContent: "space-between",
          alignItems: "flex-start",
          flexWrap: "wrap",
          gap: 10,
          marginBottom: 12
        }}>
        <h2 style={{ margin: 0 }}>{t("events.title")}</h2>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: 10
          }}>
          <label
            className="row"
            style={{ gap: 8, fontSize: 12, alignItems: "center" }}>
            {t("rep.format")}
            <select
              className="input"
              style={{ width: 100 }}
              value={manualFmt}
              onChange={(e) => {
                const f = e.target.value === "json" ? "json" : "csv"
                setManualFmt(f)
                try {
                  localStorage.setItem("opsgate_report_format", f)
                } catch {
                  /* ignore */
                }
              }}>
              <option value="csv">CSV</option>
              <option value="json">JSON</option>
            </select>
          </label>
          <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
            <button
              type="button"
              className="btn btn-sm"
              disabled={exportBusy}
              onClick={() => void doExport("week")}>
              {exportBusy ? "…" : t("rep.downloadWeek")}
            </button>
            <button
              type="button"
              className="btn secondary btn-sm"
              disabled={exportBusy}
              onClick={() => setShowExportRange((v) => !v)}>
              {t("events.exportCustom")}
            </button>
            <button
              type="button"
              className="btn secondary btn-sm"
              disabled={exportBusy}
              onClick={() => void doExport("all")}>
              {exportBusy ? "…" : t("rep.downloadAll")}
            </button>
          </div>
        </div>
      </div>
      {showExportRange && (
        <div
          className="filters-bar"
          style={{ marginBottom: 14 }}
          aria-label="Export range">
          <label className="field-label" style={{ margin: 0 }}>
            {t("events.from")}
          </label>
          <input
            className="input filter-date"
            type="date"
            value={exportFrom}
            onChange={(e) => setExportFrom(e.target.value)}
          />
          <label className="field-label" style={{ margin: 0 }}>
            {t("events.to")}
          </label>
          <input
            className="input filter-date"
            type="date"
            value={exportTo}
            onChange={(e) => setExportTo(e.target.value)}
          />
          <div className="filter-actions">
            <button
              type="button"
              className="btn btn-sm"
              disabled={exportBusy || !exportFrom || !exportTo}
              onClick={() =>
                void doExport("custom", exportFrom, exportTo)
              }>
              {t("events.export")}
            </button>
          </div>
        </div>
      )}
      {archives.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Archive</th>
                  <th>Events</th>
                  <th>Restant</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {archives.map((a) => (
                  <tr key={a.id}>
                    <td className="mono" style={{ fontSize: 12 }}>
                      {a.filename}
                    </td>
                    <td>{a.event_count}</td>
                    <td>{a.remaining_days} j</td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-sm"
                        title={t("rep.download")}
                        onClick={async () => {
                          try {
                            const r = await api.downloadEventExport(a.id)
                            downloadTextFile(
                              r.filename,
                              r.content,
                              r.format === "json"
                                ? "application/json"
                                : "text/csv;charset=utf-8"
                            )
                            setInfo?.(t("rep.downloaded"))
                          } catch (e) {
                            setError?.(String(e))
                          }
                        }}>
                        Télécharger
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {events.length === 0 ? (
        <div className="empty">
          <p style={{ marginTop: 0 }}>Aucun événement.</p>
          <p className="muted" style={{ fontSize: 12, maxWidth: 520 }}>
            Les détections proxy apparaissent en décision{" "}
            <strong>observe</strong> / source <strong>proxy</strong>. Avec API
            en mémoire, un redémarrage API efface tout : gardez API + proxy +
            console allumés, puis <strong>Refresh</strong> après un{" "}
            <code>events_batch_ok</code>.
          </p>
        </div>
      ) : (
        <>
          <div
            className="events-source-chips"
            role="group"
            aria-label={t("events.sourceChips")}>
            {(
              [
                ["", t("events.sourceAll"), events.length],
                [
                  "proxy",
                  t("events.sourceProxy"),
                  events.filter((e) => e.source === "proxy").length
                ],
                [
                  "prompt",
                  t("events.sourcePrompt"),
                  events.filter((e) => e.source === "prompt").length
                ],
                [
                  "file",
                  t("events.sourceFile"),
                  events.filter((e) => e.source === "file").length
                ],
                [
                  "system",
                  t("events.sourceSystem"),
                  events.filter((e) => e.source === "system").length
                ]
              ] as const
            ).map(([val, lab, n]) => (
              <button
                key={val || "all"}
                type="button"
                className={`events-chip${sourceF === val ? " is-on" : ""}${
                  val === "proxy" ? " events-chip--proxy" : ""
                }`}
                onClick={() => setSourceF(val)}
                title={lab}>
                <span>{lab}</span>
                <strong>{n}</strong>
              </button>
            ))}
          </div>
          <div className="filters-bar" role="search" aria-label="Filtres events">
            <select
              className="input"
              value={decisionF}
              onChange={(e) => setDecisionF(e.target.value)}
              title="Décision">
              <option value="">Décision</option>
              {decisions.map((d) => (
                <option key={d} value={d}>
                  {decisionLabelFr(d)}
                </option>
              ))}
            </select>
            <select
              className="input"
              value={severityF}
              onChange={(e) => setSeverityF(e.target.value)}
              title="Sévérité">
              <option value="">Sévérité</option>
              {severities.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select
              className="input"
              value={sourceF}
              onChange={(e) => setSourceF(e.target.value)}
              title="Source">
              <option value="">Source</option>
              {sources.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <input
              ref={searchRef}
              className="input filter-search"
              placeholder="Label / host / type… (/)"
              value={labelF}
              onChange={(e) => setLabelF(e.target.value)}
            />
            <input
              className="input filter-date"
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              title="Du"
              aria-label="Date début"
            />
            <input
              className="input filter-date"
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              title="Au"
              aria-label="Date fin"
            />
            <div className="filter-actions">
              <button
                className="btn secondary btn-sm"
                type="button"
                onClick={() => {
                  setDecisionF("")
                  setSeverityF("")
                  setSourceF("")
                  setLabelF("")
                  setDateFrom("")
                  setDateTo("")
                }}>
                Reset
              </button>
            </div>
          </div>
          <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
            {filtered.length} / {events.length} event(s)
          </p>
          {filtered.length === 0 ? (
            <div className="empty">Aucun event pour ces filtres</div>
          ) : (
            <>
            <PagerBar
              page={page}
              pageSize={pageSize}
              total={filtered.length}
              onPage={setPage}
              onPageSize={setPageSize}
            />
            <div className="table-wrap">
              <table className="table table-resizable">
                <thead>
                  <tr>
                    <th className="col-time">Quand</th>
                    <th>Label appareil</th>
                    <th>Décision</th>
                    <th>Acteur</th>
                    <th>Sévérité</th>
                    <th className="col-detail">Détail</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedEvents.map((e) => (
                    <tr key={e.id}>
                      <td className="muted">
                        {e.ts
                          ? formatDateTimeAny(e.ts, dtPrefs)
                          : " - "}
                      </td>
                      <td>
                        <strong>
                          {(e.device_label || "")
                            .replace(/^OpsGate\s+Proxy\s*[-:]?\s*/i, "")
                            .trim() || " - "}
                        </strong>
                        {e.source === "proxy" ? (
                          <span
                            className="meta-tag"
                            style={{
                              marginLeft: 6,
                              background: "rgba(37, 99, 235, 0.12)",
                              color: "#1d4ed8",
                              border: "1px solid rgba(37, 99, 235, 0.25)",
                              fontSize: 10
                            }}>
                            Proxy
                          </span>
                        ) : null}
                        {e.hostname && e.hostname !== "opsgate-agent" ? (
                          <div className="muted" style={{ fontSize: 11 }}>
                            site · {e.hostname}
                          </div>
                        ) : e.source === "system" ? (
                          <div className="muted" style={{ fontSize: 11 }}>
                            système
                          </div>
                        ) : null}
                      </td>
                      <td>
                        <strong>{decisionLabelFr(e.decision)}</strong>
                        <div className="muted" style={{ fontSize: 11 }}>
                          {e.decision}
                          {sourceLabelFr(e.source)
                            ? ` · ${sourceLabelFr(e.source)}`
                            : ""}
                        </div>
                      </td>
                      <td className="mono" style={{ fontSize: 12 }}>
                        {e.exit_actor ||
                          e.exit_admin_label ||
                          (e.source === "proxy"
                            ? "proxy"
                            : e.decision === "unenroll"
                              ? (e.types || []).find(
                                  (t) =>
                                    t.startsWith("admin:") ||
                                    t === "vendor_recovery" ||
                                    t === "free"
                                ) || " - "
                              : " - ")}
                      </td>
                      <td>
                        <span className={`badge ${e.highest_severity}`}>
                          {e.highest_severity}
                        </span>
                      </td>
                      <td className="muted" style={{ fontSize: 12 }}>
                        {eventDetailSummary(e)}
                        {e.rule_ids?.length ? (
                          <div
                            className="mono muted"
                            style={{ fontSize: 10 }}
                            title={e.rule_ids.join(", ")}>
                            {e.rule_ids.slice(0, 3).map(ruleShortLabel).join(" · ")}
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <PagerBar
              page={page}
              pageSize={pageSize}
              total={filtered.length}
              onPage={setPage}
              onPageSize={setPageSize}
            />
            </>
          )}
        </>
      )}
    </div>
  )
}

function PasskeySettingsPanel({
  t,
  setError,
  setInfo,
  setBusy,
  busy
}: {
  t: (k: string, vars?: Record<string, string | number>) => string
  setError: (e: string | null) => void
  setInfo: (i: string | null) => void
  setBusy: (b: boolean) => void
  busy: boolean
}) {
  const [creds, setCreds] = useState<
    Array<{ credential_id: string; label?: string; created_at?: string }>
  >([])
  const [enabled, setEnabled] = useState(false)
  const [supported, setSupported] = useState(false)

  const load = useCallback(async () => {
    try {
      const st = await api.webauthnStatus()
      setEnabled(!!st.enabled)
      const {
        webauthnSupported
      } = await import("./webauthn-client")
      setSupported(webauthnSupported())
      if (st.enabled) {
        const r = await api.webauthnCredentials()
        setCreds(r.credentials || [])
      }
    } catch {
      setEnabled(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (!enabled) {
    return (
      <>
        <h3 style={{ marginTop: 28 }}>{t("passkey.title")}</h3>
        <p className="muted" style={{ fontSize: 12 }}>
          {t("passkey.disabled")}
        </p>
      </>
    )
  }

  return (
    <>
      <h3 style={{ marginTop: 28 }}>{t("passkey.title")}</h3>
      <p className="muted" style={{ fontSize: 12 }}>
        {t("passkey.hint")}
      </p>
      {!supported && (
        <p className="err" style={{ fontSize: 12 }}>
          {t("passkey.unsupported")}
        </p>
      )}
      <ul style={{ fontSize: 13, paddingLeft: 18 }}>
        {creds.length === 0 ? (
          <li className="muted">{t("passkey.none")}</li>
        ) : (
          creds.map((c) => (
            <li key={c.credential_id} style={{ marginBottom: 6 }}>
              {c.label || t("passkey.defaultLabel")}{" "}
              <span className="muted mono" style={{ fontSize: 11 }}>
                {c.credential_id.slice(0, 12)}…
              </span>
              <button
                type="button"
                className="btn secondary btn-sm"
                style={{ marginLeft: 8 }}
                disabled={busy}
                onClick={async () => {
                  if (!confirm(t("passkey.deleteConfirm"))) return
                  setBusy(true)
                  try {
                    await api.webauthnDelete(c.credential_id)
                    setInfo(t("passkey.deleted"))
                    await load()
                  } catch (e) {
                    setError(String(e))
                  } finally {
                    setBusy(false)
                  }
                }}>
                {t("passkey.delete")}
              </button>
            </li>
          ))
        )}
      </ul>
      <button
        type="button"
        className="btn"
        disabled={busy || !supported}
        onClick={async () => {
          setBusy(true)
          setError(null)
          try {
            const {
              toCreationOptions,
              credentialPublicKeyJwk,
              bufToB64url
            } = await import("./webauthn-client")
            const opts = await api.webauthnRegisterOptions()
            const creation = toCreationOptions(opts.publicKey)
            const cred = (await navigator.credentials.create({
              publicKey: creation
            })) as PublicKeyCredential | null
            if (!cred) throw new Error(t("passkey.cancelled"))
            const jwk = await credentialPublicKeyJwk(cred)
            if (!jwk) throw new Error(t("passkey.noJwk"))
            const att = cred.response as AuthenticatorAttestationResponse
            await api.webauthnRegister({
              challenge_id: opts.challenge_id,
              credentialId: bufToB64url(cred.rawId),
              publicKeyJwk: jwk,
              transports: (
                att as AuthenticatorAttestationResponse & {
                  getTransports?: () => string[]
                }
              ).getTransports?.(),
              label: "Windows Hello / Passkey"
            })
            setInfo(t("passkey.added"))
            await load()
          } catch (e) {
            setError(String(e))
          } finally {
            setBusy(false)
          }
        }}>
        {t("passkey.add")}
      </button>
    </>
  )
}

function MspPortfolioView({
  currentOrgId,
  t,
  onSwitch,
  switchBusy
}: {
  currentOrgId: string
  t: (k: string, vars?: Record<string, string | number>) => string
  onSwitch: (orgId: string) => void
  switchBusy: boolean
}) {
  const [data, setData] = useState<Awaited<
    ReturnType<typeof api.mspOverview>
  > | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setBusy(true)
    setErr(null)
    try {
      setData(await api.mspOverview())
    } catch (e) {
      setErr(String(e))
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, currentOrgId])

  if (err && !data) {
    return (
      <div className="msp-portfolio">
        <div className="card msp-hero">
          <h2 style={{ margin: 0 }}>{t("msp.portfolio")}</h2>
          <p className="err" style={{ marginBottom: 0 }}>
            {err}
          </p>
        </div>
      </div>
    )
  }
  if (!data) {
    return (
      <div className="msp-portfolio">
        <div className="card msp-hero msp-skeleton">
          <div className="msp-skel-line msp-skel-title" />
          <div className="msp-kpis">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="msp-kpi msp-skel-block" />
            ))}
          </div>
        </div>
        <div className="msp-grid">
          {[0, 1, 2].map((i) => (
            <div key={i} className="card msp-org-card msp-skel-card" />
          ))}
        </div>
      </div>
    )
  }

  const totals = data.totals
  const seatPctTotal =
    totals.seats > 0
      ? Math.round((totals.seats_used / totals.seats) * 100)
      : null
  const onlinePct =
    totals.agents > 0
      ? Math.round((totals.online / totals.agents) * 100)
      : 0
  const offlineLong = totals.offline_long ?? 0
  const events7d = totals.events_7d ?? 0
  const attention = totals.attention ?? 0

  return (
    <div className="msp-portfolio">
      <div className="card msp-hero">
        <div className="msp-hero-top">
          <div className="msp-hero-title">
            <span className="msp-hero-badge" aria-hidden="true">
              MSP
            </span>
            <div>
              <h2 style={{ margin: 0 }}>{t("msp.portfolio")}</h2>
              <p className="msp-hero-sub">
                {t("msp.portfolioHint", { n: data.org_count })}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="btn secondary btn-sm"
            disabled={busy}
            onClick={() => void load()}>
            {busy ? t("common.loading") : t("top.refresh")}
          </button>
        </div>
        {err ? (
          <p className="err" style={{ margin: "8px 0 0", fontSize: 12 }}>
            {err}
          </p>
        ) : null}

        <div className="msp-kpis">
          <div className="msp-kpi">
            <span className="msp-kpi-l">{t("msp.statOrgs")}</span>
            <span className="msp-kpi-v">{data.org_count}</span>
            <span className="msp-kpi-s">{t("msp.statOrgsSub")}</span>
          </div>
          <div className="msp-kpi">
            <span className="msp-kpi-l">{t("msp.statAgents")}</span>
            <span className="msp-kpi-v">
              {totals.online}
              <span>/{totals.agents}</span>
            </span>
            <span className="msp-kpi-s">
              {t("msp.onlinePct", { n: onlinePct })}
            </span>
            <div className="msp-meter" aria-hidden="true">
              <i style={{ width: `${onlinePct}%` }} />
            </div>
          </div>
          <div className="msp-kpi">
            <span className="msp-kpi-l">{t("msp.statSeats")}</span>
            <span className="msp-kpi-v">
              {totals.seats_used}
              <span>/{totals.seats || "—"}</span>
            </span>
            <span className="msp-kpi-s">
              {seatPctTotal != null
                ? t("msp.seatsPct", { n: seatPctTotal })
                : t("msp.seatsUnlimited")}
            </span>
            {seatPctTotal != null ? (
              <div
                className={`msp-meter${seatPctTotal >= 90 ? " msp-meter--warn" : ""}`}
                aria-hidden="true">
                <i style={{ width: `${Math.min(100, seatPctTotal)}%` }} />
              </div>
            ) : null}
          </div>
          <div
            className={`msp-kpi${offlineLong > 0 ? " msp-kpi--warn" : ""}`}>
            <span className="msp-kpi-l">{t("msp.statOffline")}</span>
            <span className="msp-kpi-v">{offlineLong}</span>
            <span className="msp-kpi-s">{t("msp.statOfflineSub")}</span>
          </div>
          <div className="msp-kpi">
            <span className="msp-kpi-l">{t("msp.statEvents")}</span>
            <span className="msp-kpi-v">{events7d}</span>
            <span className="msp-kpi-s">{t("msp.statEventsSub")}</span>
          </div>
          <div
            className={`msp-kpi${attention > 0 ? " msp-kpi--alert" : " msp-kpi--ok"}`}>
            <span className="msp-kpi-l">{t("msp.statAttention")}</span>
            <span className="msp-kpi-v">{attention}</span>
            <span className="msp-kpi-s">
              {attention > 0
                ? t("msp.statAttentionSub")
                : t("msp.statAttentionOk")}
            </span>
          </div>
        </div>
      </div>

      <div className="msp-grid">
        {data.orgs.map((o) => {
          const offline = o.offline_long ?? 0
          const stale = o.stale ?? 0
          const days = o.license_days_left
          const seatsPct =
            typeof o.seats === "number" && o.seats > 0
              ? Math.round(((o.seats_used || 0) / o.seats) * 100)
              : null
          const agentPct =
            o.agents > 0 ? Math.round((o.online / o.agents) * 100) : 0
          const licTone =
            days != null && days < 0
              ? "bad"
              : days != null && days <= 30
                ? "warn"
                : "ok"
          return (
            <div
              key={o.org_id}
              className={[
                "card msp-org-card",
                o.current ? "msp-org-card--current" : "",
                o.needs_attention ? "msp-org-card--attention" : ""
              ]
                .filter(Boolean)
                .join(" ")}>
              <div className="msp-org-head">
                <div className="msp-org-id">
                  <strong className="msp-org-name">{o.name}</strong>
                  <div className="msp-org-codes">
                    <span className="mono">{o.org_code}</span>
                    {o.company_name && o.company_name !== o.name ? (
                      <span className="msp-org-company">{o.company_name}</span>
                    ) : null}
                  </div>
                </div>
                <div className="msp-org-badges">
                  {o.current ? (
                    <span className="msp-pill msp-pill--ok">
                      {t("msp.current")}
                    </span>
                  ) : null}
                  {o.is_principal ? (
                    <span className="msp-pill msp-pill--teal">
                      {t("msp.principal")}
                    </span>
                  ) : null}
                  {o.needs_attention ? (
                    <span className="msp-pill msp-pill--warn">
                      {t("msp.attention")}
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="msp-org-metrics">
                <div className="msp-org-metric">
                  <span className="msp-org-ml">{t("msp.agentsOnline")}</span>
                  <strong>
                    {o.online}/{o.agents}
                  </strong>
                  <div className="msp-meter msp-meter--sm" aria-hidden="true">
                    <i style={{ width: `${agentPct}%` }} />
                  </div>
                  <span className="msp-org-ms">
                    {stale > 0
                      ? t("msp.staleN", { n: stale })
                      : t("msp.onlinePct", { n: agentPct })}
                  </span>
                </div>
                <div className="msp-org-metric">
                  <span className="msp-org-ml">{t("msp.seats")}</span>
                  <strong>
                    {o.seats_used}/{o.seats || "—"}
                  </strong>
                  {seatsPct != null ? (
                    <div
                      className={`msp-meter msp-meter--sm${seatsPct >= 90 ? " msp-meter--warn" : ""}`}
                      aria-hidden="true">
                      <i style={{ width: `${Math.min(100, seatsPct)}%` }} />
                    </div>
                  ) : (
                    <div className="msp-meter msp-meter--sm msp-meter--empty" />
                  )}
                  <span className="msp-org-ms">
                    {seatsPct != null
                      ? t("msp.seatsPct", { n: seatsPct })
                      : t("msp.seatsUnlimited")}
                  </span>
                </div>
                <div className="msp-org-metric">
                  <span className="msp-org-ml">{t("msp.statOffline")}</span>
                  <strong className={offline > 0 ? "msp-val-warn" : undefined}>
                    {offline}
                  </strong>
                  <span className="msp-org-ms">{t("msp.offlineLongHint")}</span>
                </div>
                <div className="msp-org-metric">
                  <span className="msp-org-ml">{t("msp.statEvents")}</span>
                  <strong>{o.events_7d ?? 0}</strong>
                  <span className="msp-org-ms">{t("msp.statEventsSub")}</span>
                </div>
              </div>

              <div className={`msp-org-lic msp-org-lic--${licTone}`}>
                <div>
                  <span className="msp-org-ml">{t("msp.license")}</span>
                  <strong>
                    {o.license_mode}
                    {days != null
                      ? days < 0
                        ? ` · ${t("msp.expired")}`
                        : ` · ${t("msp.daysLeft", { n: days })}`
                      : ""}
                  </strong>
                </div>
                {days != null && days <= 30 ? (
                  <span className="msp-pill msp-pill--warn msp-pill--sm">
                    {days < 0 ? t("msp.expired") : t("msp.expiringSoon")}
                  </span>
                ) : null}
              </div>

              {!o.current ? (
                <button
                  type="button"
                  className="btn btn-sm msp-open-btn"
                  disabled={switchBusy}
                  onClick={() => onSwitch(o.org_id)}>
                  {t("msp.openTenant")}
                </button>
              ) : (
                <div className="msp-open-btn msp-open-btn--current">
                  {t("msp.viewingNow")}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function AuditView({
  isPrincipal,
  t
}: {
  isPrincipal: boolean
  t: (k: string, vars?: Record<string, string | number>) => string
}) {
  const dtPrefs = useDateTimePrefs()
  const [rows, setRows] = useState<
    Array<{
      id: string
      adminEmail?: string
      adminLabel?: string
      action: string
      detail?: string
      createdAt: string
      seq?: number
      entry_hash?: string
      prev_hash?: string
    }>
  >([])
  const [filter, setFilter] = useState("")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc")
  const [pageSize, setPageSize] = useState(50)
  const [page, setPage] = useState(1)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [legalDays, setLegalDays] = useState<number | null>(null)
  const [integrity, setIntegrity] = useState<{
    ok: boolean
    tip?: string
    checked: number
    with_hash: number
  } | null>(null)

  const load = useCallback(async () => {
    if (!isPrincipal) return
    setBusy(true)
    setErr(null)
    try {
      const r = await api.audit(filter || undefined)
      setRows(r.events || [])
      if (typeof r.legal_retention_days === "number") {
        setLegalDays(r.legal_retention_days)
      }
    } catch (e) {
      setErr(String(e))
    } finally {
      setBusy(false)
    }
  }, [filter, isPrincipal])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(() => {
    const fromMs = dateFrom ? Date.parse(dateFrom + "T00:00:00") : null
    const toMs = dateTo ? Date.parse(dateTo + "T23:59:59.999") : null
    let list = rows.filter((r) => {
      if (fromMs == null && toMs == null) return true
      const t = Date.parse(r.createdAt)
      if (!Number.isFinite(t)) return false
      if (fromMs != null && t < fromMs) return false
      if (toMs != null && t > toMs) return false
      return true
    })
    list = [...list].sort((a, b) => {
      const ta = Date.parse(a.createdAt) || 0
      const tb = Date.parse(b.createdAt) || 0
      return sortDir === "desc" ? tb - ta : ta - tb
    })
    return list
  }, [rows, dateFrom, dateTo, sortDir])

  useEffect(() => {
    setPage(1)
  }, [filter, dateFrom, dateTo, sortDir, pageSize])

  const pagedAudit = useMemo(() => {
    const start = (page - 1) * pageSize
    return filtered.slice(start, start + pageSize)
  }, [filtered, page, pageSize])

  if (!isPrincipal) {
    return (
      <div className="card">
        <h2>Audit administration</h2>
        <div className="empty">Réservé au principal</div>
      </div>
    )
  }

  const exportCsv = () => {
    const headers = [
      "created_at",
      "admin_label",
      "admin_email",
      "action",
      "detail",
      "seq",
      "entry_hash",
      "prev_hash"
    ]
    const lines = [headers.join(",")]
    for (const r of filtered) {
      const cells = [
        r.createdAt || "",
        r.adminLabel || "",
        r.adminEmail || "",
        r.action || "",
        (r.detail || "").replace(/"/g, '""'),
        r.seq != null ? String(r.seq) : "",
        r.entry_hash || "",
        r.prev_hash || ""
      ].map((c) => (/[",\n]/.test(c) ? `"${c}"` : c))
      lines.push(cells.join(","))
    }
    downloadTextFile(
      `opsgate-audit-${new Date().toISOString().slice(0, 10)}.csv`,
      lines.join("\n"),
      "text/csv;charset=utf-8"
    )
  }

  const verifyIntegrity = async () => {
    setBusy(true)
    try {
      const r = await api.auditIntegrity()
      setIntegrity({
        ok: r.ok,
        tip: r.tip,
        checked: r.checked,
        with_hash: r.with_hash
      })
      if (!r.ok) setErr(r.tip || r.broken_reason || "Chaîne invalide")
    } catch (e) {
      setErr(String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card">
      <div
        className="row"
        style={{
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 8,
          marginBottom: 12
        }}>
        <div>
          <h2 style={{ margin: 0 }}>Audit administration</h2>
          <p className="muted" style={{ fontSize: 12, margin: "4px 0 0" }}>
            <span className="lic-status ok" style={{ marginRight: 8 }}>
              WORM
            </span>
            {t("audit.wormHint")}
            {legalDays != null
              ? ` · ${t("audit.legalRetention", { n: legalDays })}`
              : ""}
          </p>
          {integrity && (
            <p
              style={{
                fontSize: 12,
                margin: "6px 0 0",
                color: integrity.ok
                  ? "var(--ok, #047857)"
                  : "var(--danger, #b91c1c)"
              }}>
              {integrity.ok
                ? t("audit.integrityOk", {
                    n: integrity.with_hash,
                    total: integrity.checked
                  })
                : integrity.tip || t("audit.integrityBad")}
            </p>
          )}
        </div>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn secondary btn-sm"
            disabled={busy}
            onClick={() => void verifyIntegrity()}>
            {t("audit.verify")}
          </button>
          <button
            type="button"
            className="btn secondary btn-sm"
            disabled={!filtered.length}
            onClick={exportCsv}>
            Export CSV
          </button>
        </div>
      </div>
      <div className="filters-bar" role="search" aria-label="Filtres audit">
        <select
          className="input"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          title="Action">
          <option value="">Toutes les actions</option>
          <option value="login">login</option>
          <option value="logout">logout</option>
          <option value="logout_idle">logout_idle</option>
          <option value="policy_update">policy_update</option>
          <option value="profile_upsert">profile_upsert</option>
          <option value="profile_delete">profile_delete</option>
          <option value="group_upsert">group_upsert</option>
          <option value="group_delete">group_delete</option>
          <option value="user_upsert">user_upsert</option>
          <option value="user_delete">user_delete</option>
          <option value="pack_publish">pack_publish</option>
          <option value="pack_activate">pack_activate</option>
          <option value="rule_disable">rule_disable</option>
          <option value="agent_revoke">agent_revoke</option>
          <option value="agent_assign">agent_assign</option>
          <option value="agent_license">agent_license</option>
          <option value="agent_merge">agent_merge</option>
          <option value="events_export">events_export</option>
          <option value="admin_create">admin_create</option>
          <option value="admin_update">admin_update</option>
          <option value="admin_delete">admin_delete</option>
          <option value="admin_password_reset">admin_password_reset</option>
          <option value="password_change">password_change</option>
          <option value="org_settings_update">org_settings_update</option>
          <option value="moving_rule_upsert">moving_rule_upsert</option>
          <option value="moving_rule_delete">moving_rule_delete</option>
          <option value="moving_rule_apply">moving_rule_apply</option>
          <option value="recovery_info_view">recovery_info_view</option>
          <option value="recovery_codes_generated">recovery_codes_generated</option>
          <option value="recovery_pool_revoked">recovery_pool_revoked</option>
        </select>
        <input
          className="input"
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          title="Du"
          aria-label="Date début"
        />
        <input
          className="input"
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          title="Au"
          aria-label="Date fin"
        />
        <select
          className="input"
          value={sortDir}
          onChange={(e) =>
            setSortDir(e.target.value === "asc" ? "asc" : "desc")
          }
          title="Tri date">
          <option value="desc">Date ↓ récent</option>
          <option value="asc">Date ↑ ancien</option>
        </select>
        <div className="filter-actions">
          <button
            className="btn secondary btn-sm"
            type="button"
            disabled={busy}
            onClick={() => void load()}>
            {busy ? "…" : "Actualiser"}
          </button>
          <button
            className="btn secondary btn-sm"
            type="button"
            onClick={() => {
              setFilter("")
              setDateFrom("")
              setDateTo("")
              setSortDir("desc")
            }}>
            Reset
          </button>
        </div>
      </div>
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
        {filtered.length} / {rows.length} entrée(s)
      </p>
      {err && <p className="err">{err}</p>}
      {filtered.length === 0 ? (
        <div className="empty">Aucun événement d’audit</div>
      ) : (
        <>
          <PagerBar
            page={page}
            pageSize={pageSize}
            total={filtered.length}
            onPage={setPage}
            onPageSize={setPageSize}
          />
          <div className="table-wrap">
            <table className="table table-resizable">
              <thead>
                <tr>
                  <th className="col-time">
                    <button
                      type="button"
                      className="btn secondary btn-sm"
                      style={{ padding: "2px 8px", fontSize: 12 }}
                      onClick={() =>
                        setSortDir((d) => (d === "desc" ? "asc" : "desc"))
                      }>
                      Quand {sortDir === "desc" ? "↓" : "↑"}
                    </button>
                  </th>
                  <th>Admin</th>
                  <th>Action</th>
                  <th className="col-detail">Détail</th>
                  <th title="Sceau WORM">Hash</th>
                </tr>
              </thead>
              <tbody>
                {pagedAudit.map((r) => (
                  <tr key={r.id}>
                    <td className="muted">
                      {r.createdAt
                        ? formatDateTimeIso(r.createdAt, dtPrefs)
                        : " - "}
                    </td>
                    <td>
                      {r.adminLabel || " - "}
                      {r.adminEmail ? (
                        <div className="muted" style={{ fontSize: 11 }}>
                          {r.adminEmail}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <code>{r.action}</code>
                    </td>
                    <td className="muted">{r.detail || " - "}</td>
                    <td
                      className="mono muted"
                      style={{ fontSize: 10 }}
                      title={r.entry_hash || ""}>
                      {r.seq != null ? `#${r.seq} ` : ""}
                      {r.entry_hash
                        ? r.entry_hash.slice(0, 10) + "…"
                        : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <PagerBar
            page={page}
            pageSize={pageSize}
            total={filtered.length}
            onPage={setPage}
            onPageSize={setPageSize}
          />
        </>
      )}
    </div>
  )
}

type CondDraft = import("./api").MovingCondition

const emptyCond = (): CondDraft => ({
  field: "device_label",
  op: "starts_with",
  value: ""
})

function MovingRulesView({
  groups,
  busy,
  setBusy,
  setError,
  setInfo
}: {
  groups: GroupRow[]
  busy: boolean
  setBusy: (b: boolean) => void
  setError: (e: string | null) => void
  setInfo: (i: string | null) => void
}) {
  const [rules, setRules] = useState<import("./api").MovingRuleRow[]>([])
  const [formOpen, setFormOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [conds, setConds] = useState<CondDraft[]>([emptyCond()])
  const [groupId, setGroupId] = useState("")
  const [priority, setPriority] = useState(100)
  const [onlyUnassigned, setOnlyUnassigned] = useState(false)
  const [condLogic, setCondLogic] = useState<"and" | "or">("and")
  const [permanent, setPermanent] = useState(false)
  const [enabled, setEnabled] = useState(true)

  const load = useCallback(async () => {
    try {
      const r = await api.movingRules()
      setRules(r.rules || [])
    } catch (e) {
      setError(String(e))
    }
  }, [setError])

  useEffect(() => {
    void load()
  }, [load])

  const resetForm = () => {
    setEditId(null)
    setName("")
    setConds([emptyCond()])
    setGroupId("")
    setPriority(100)
    setOnlyUnassigned(false)
    setCondLogic("and")
    setPermanent(false)
    setEnabled(true)
  }

  const openEdit = (r: import("./api").MovingRuleRow) => {
    setEditId(r.id)
    setName(r.name)
    setConds(
      r.conditions && r.conditions.length > 0
        ? r.conditions.map((c) => ({ ...c }))
        : [{ field: r.matchField, op: r.matchOp, value: r.matchValue }]
    )
    setGroupId(r.targetGroupId)
    setPriority(r.priority)
    setOnlyUnassigned(r.onlyIfUnassigned)
    setCondLogic(r.conditionLogic === "or" ? "or" : "and")
    setPermanent(!!r.permanent)
    setEnabled(r.enabled !== false)
    setFormOpen(true)
  }

  const condsOf = (r: import("./api").MovingRuleRow): CondDraft[] =>
    r.conditions && r.conditions.length > 0
      ? r.conditions
      : [{ field: r.matchField, op: r.matchOp, value: r.matchValue }]

  const swapPriority = async (idx: number, dir: -1 | 1) => {
    const j = idx + dir
    if (j < 0 || j >= rules.length) return
    const reordered = [...rules]
    const [item] = reordered.splice(idx, 1)
    reordered.splice(j, 0, item)
    setBusy(true)
    try {
      // Ré-étalonnage firewall : 10, 20, 30…
      for (let i = 0; i < reordered.length; i++) {
        const p = (i + 1) * 10
        if (reordered[i].priority !== p) {
          await api.patchMovingRule(reordered[i].id, { priority: p })
        }
      }
      setInfo("Ordre mis à jour")
      await load()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  const validConds = conds.filter((c) => c.value.trim())
  const activeCount = rules.filter((r) => r.enabled !== false).length
  const inactiveCount = rules.length - activeCount

  const fieldLabel = (f: string) =>
    f === "host_name" ? "Hostname" : "Label appareil"
  const opLabel = (op: string) => {
    if (op === "starts_with") return "commence par"
    if (op === "contains") return "contient"
    if (op === "equals") return "égal"
    if (op === "regex") return "regex"
    return op
  }

  const saveRule = async () => {
    setBusy(true)
    try {
      const body = {
        name: name.trim(),
        conditions: validConds.map((c) => ({
          ...c,
          value: c.value.trim()
        })),
        target_group_id: groupId,
        priority,
        only_if_unassigned: onlyUnassigned && !permanent,
        condition_logic: condLogic,
        permanent,
        enabled
      }
      if (editId) {
        const r = await api.patchMovingRule(editId, body)
        setInfo(
          `Règle mise à jour · ${r.agents_applied ?? 0} agent(s) déplacé(s)`
        )
      } else {
        const r = await api.createMovingRule(body)
        setInfo(
          `Règle créée · ${r.agents_applied ?? 0} agent(s) déplacé(s)`
        )
      }
      resetForm()
      setFormOpen(false)
      await load()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mv-page">
      {/* Hero */}
      <header className="mv-hero">
        <div className="mv-hero-glow" aria-hidden />
        <div className="mv-hero-inner">
          <div className="mv-hero-copy">
            <span className="mv-kicker">Automatisation flotte</span>
            <h1 className="mv-title">Règles de migration automatique</h1>
            <p className="mv-lead">
              Affectez les agents à un groupe dès qu’un label ou un hostname
              matche — priorité ordonnée, logique AND/OR, application
              permanente ou seulement si non assigné.
            </p>
            <div className="mv-stats">
              <div className="mv-stat">
                <span className="mv-stat-n">{rules.length}</span>
                <span className="mv-stat-l">règle{rules.length > 1 ? "s" : ""}</span>
              </div>
              <div className="mv-stat mv-stat--ok">
                <span className="mv-stat-n">{activeCount}</span>
                <span className="mv-stat-l">active{activeCount > 1 ? "s" : ""}</span>
              </div>
              <div className="mv-stat mv-stat--mute">
                <span className="mv-stat-n">{inactiveCount}</span>
                <span className="mv-stat-l">inactive{inactiveCount > 1 ? "s" : ""}</span>
              </div>
              <div className="mv-stat">
                <span className="mv-stat-n">{groups.length}</span>
                <span className="mv-stat-l">groupe{groups.length > 1 ? "s" : ""}</span>
              </div>
            </div>
          </div>
          <div className="mv-hero-actions">
            <button
              type="button"
              className="btn mv-btn-primary"
              disabled={busy}
              onClick={() => {
                resetForm()
                setFormOpen(true)
              }}>
              + Nouvelle règle
            </button>
            <button
              type="button"
              className="btn secondary mv-btn-ghost"
              disabled={busy || rules.length === 0}
              onClick={async () => {
                setBusy(true)
                try {
                  const r = await api.applyMovingRules()
                  setInfo(
                    `Ré-évaluation : ${r.applied} agent(s) affecté(s) / ${r.total}`
                  )
                } catch (e) {
                  setError(String(e))
                } finally {
                  setBusy(false)
                }
              }}>
              ↻ Ré-évaluer la flotte
            </button>
          </div>
        </div>
      </header>

      {/* Flow hint */}
      <div className="mv-flow" aria-hidden>
        <div className="mv-flow-step">
          <span className="mv-flow-ico">①</span>
          <span>Conditions</span>
        </div>
        <span className="mv-flow-arrow">→</span>
        <div className="mv-flow-step">
          <span className="mv-flow-ico">②</span>
          <span>Priorité</span>
        </div>
        <span className="mv-flow-arrow">→</span>
        <div className="mv-flow-step">
          <span className="mv-flow-ico">③</span>
          <span>Groupe cible</span>
        </div>
        <span className="mv-flow-arrow">→</span>
        <div className="mv-flow-step">
          <span className="mv-flow-ico">④</span>
          <span>Agents affectés</span>
        </div>
      </div>

      {/* Rules list */}
      <section className="mv-list-section">
        <div className="mv-list-head">
          <h2 className="mv-list-title">Pipeline de règles</h2>
          <p className="mv-list-sub muted">
            Plus haut = évalué en premier. Glissez l’ordre avec ↑ ↓ ou éditez la
            priorité.
          </p>
        </div>

        {rules.length === 0 ? (
          <div className="mv-empty">
            <div className="mv-empty-icon" aria-hidden>
              ⇄
            </div>
            <h3>Aucune règle pour l’instant</h3>
            <p className="muted">
              Créez votre première règle pour basculer automatiquement les
              agents vers le bon groupe (ex. label commence par{" "}
              <code>DIR-</code>).
            </p>
            <button
              type="button"
              className="btn mv-btn-primary"
              onClick={() => {
                resetForm()
                setFormOpen(true)
              }}>
              Créer ma première règle
            </button>
          </div>
        ) : (
          <ol className="mv-rules">
            {rules.map((r, idx) => {
              const gName =
                groups.find((g) => g.id === r.targetGroupId)?.name ||
                r.targetGroupId
              const cs = condsOf(r)
              const logic = r.conditionLogic === "or" ? "OR" : "AND"
              return (
                <li
                  key={r.id}
                  className={`mv-rule ${r.enabled === false ? "is-off" : ""}`}>
                  <div className="mv-rule-rail">
                    <span className="mv-rule-idx">{idx + 1}</span>
                    <div className="mv-rule-order">
                      <button
                        type="button"
                        className="mv-icon-btn"
                        disabled={busy || idx === 0}
                        title="Monter (plus prioritaire)"
                        onClick={() => void swapPriority(idx, -1)}>
                        ↑
                      </button>
                      <button
                        type="button"
                        className="mv-icon-btn"
                        disabled={busy || idx === rules.length - 1}
                        title="Descendre"
                        onClick={() => void swapPriority(idx, 1)}>
                        ↓
                      </button>
                    </div>
                  </div>
                  <div className="mv-rule-body">
                    <div className="mv-rule-top">
                      <div className="mv-rule-name-row">
                        <h3 className="mv-rule-name">{r.name}</h3>
                        <div className="mv-badges">
                          {r.enabled === false ? (
                            <span className="mv-badge mv-badge--off">Inactif</span>
                          ) : (
                            <span className="mv-badge mv-badge--on">Actif</span>
                          )}
                          {r.permanent ? (
                            <span className="mv-badge mv-badge--perm">
                              Permanent
                            </span>
                          ) : null}
                          {r.onlyIfUnassigned && !r.permanent ? (
                            <span className="mv-badge mv-badge--soft">
                              Si sans groupe
                            </span>
                          ) : null}
                          <span className="mv-badge mv-badge--logic">{logic}</span>
                        </div>
                      </div>
                      <div className="mv-rule-actions">
                        <label className="mv-prio" title="Priorité (petit = d’abord)">
                          <span>Prio</span>
                          <input
                            className="input mv-prio-input"
                            type="number"
                            defaultValue={r.priority}
                            key={`${r.id}-${r.priority}`}
                            disabled={busy}
                            onBlur={async (e) => {
                              const p = Number(e.target.value)
                              if (Number.isNaN(p) || p === r.priority) return
                              setBusy(true)
                              try {
                                await api.patchMovingRule(r.id, {
                                  priority: p
                                })
                                setInfo(`Priorité « ${r.name} » → ${p}`)
                                await load()
                              } catch (err) {
                                setError(String(err))
                              } finally {
                                setBusy(false)
                              }
                            }}
                          />
                        </label>
                        <button
                          type="button"
                          className="btn secondary btn-sm"
                          disabled={busy}
                          onClick={() => openEdit(r)}>
                          Modifier
                        </button>
                        <button
                          type="button"
                          className="btn danger btn-sm"
                          disabled={busy}
                          onClick={async () => {
                            if (
                              !confirm(
                                `Supprimer la règle « ${r.name} » ?`
                              )
                            )
                              return
                            setBusy(true)
                            try {
                              await api.deleteMovingRule(r.id)
                              setInfo("Règle supprimée")
                              await load()
                            } catch (e) {
                              setError(String(e))
                            } finally {
                              setBusy(false)
                            }
                          }}>
                          Suppr.
                        </button>
                      </div>
                    </div>
                    <div className="mv-rule-flow">
                      <div className="mv-chips">
                        {cs.map((c, i) => (
                          <span key={i} className="mv-chip">
                            <span className="mv-chip-f">{fieldLabel(c.field)}</span>
                            <span className="mv-chip-op">{opLabel(c.op)}</span>
                            <span className="mv-chip-v">« {c.value} »</span>
                          </span>
                        ))}
                      </div>
                      <span className="mv-then" aria-hidden>
                        →
                      </span>
                      <div className="mv-target">
                        <span className="mv-target-lbl">Groupe</span>
                        <strong>{gName}</strong>
                      </div>
                    </div>
                  </div>
                </li>
              )
            })}
          </ol>
        )}
      </section>

      {/* Formulaire création / édition */}
      {formOpen ? (
        <div
          className="mv-form-overlay"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setFormOpen(false)
              resetForm()
            }
          }}>
          <div className="mv-form-card" onClick={(e) => e.stopPropagation()}>
            <div className="mv-form-head">
              <div>
                <span className="mv-kicker">
                  {editId ? "Édition" : "Création"}
                </span>
                <h2 className="mv-form-title">
                  {editId ? "Modifier la règle" : "Nouvelle règle"}
                </h2>
              </div>
              <button
                type="button"
                className="mv-icon-btn mv-icon-btn--lg"
                aria-label="Fermer"
                onClick={() => {
                  setFormOpen(false)
                  resetForm()
                }}>
                ×
              </button>
            </div>

            <div className="mv-form-grid">
              <div className="mv-form-block">
                <label className="field-label">Nom de la règle</label>
                <input
                  className="input"
                  placeholder="ex. Direction · label DIR*"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <div className="mv-form-block mv-form-block--full">
                <div className="mv-form-block-head">
                  <label className="field-label" style={{ margin: 0 }}>
                    Conditions
                  </label>
                  <select
                    className="input mv-logic-select"
                    value={condLogic}
                    onChange={(e) =>
                      setCondLogic(e.target.value === "or" ? "or" : "and")
                    }>
                    <option value="and">ET (toutes)</option>
                    <option value="or">OU (au moins une)</option>
                  </select>
                </div>
                <div className="mv-cond-list">
                  {conds.map((c, i) => (
                    <div key={i} className="mv-cond-row">
                      <select
                        className="input"
                        value={c.field}
                        onChange={(e) => {
                          const next = [...conds]
                          next[i] = {
                            ...c,
                            field: e.target.value as CondDraft["field"]
                          }
                          setConds(next)
                        }}>
                        <option value="device_label">Label appareil</option>
                        <option value="host_name">Hostname / DNS PC</option>
                      </select>
                      <select
                        className="input"
                        value={c.op}
                        onChange={(e) => {
                          const next = [...conds]
                          next[i] = {
                            ...c,
                            op: e.target.value as CondDraft["op"]
                          }
                          setConds(next)
                        }}>
                        <option value="starts_with">commence par</option>
                        <option value="contains">contient</option>
                        <option value="equals">égal</option>
                        <option value="regex">regex</option>
                      </select>
                      <input
                        className="input"
                        placeholder="valeur (ex. DIR-)"
                        value={c.value}
                        onChange={(e) => {
                          const next = [...conds]
                          next[i] = { ...c, value: e.target.value }
                          setConds(next)
                        }}
                      />
                      <button
                        type="button"
                        className="mv-icon-btn"
                        disabled={conds.length <= 1}
                        title="Retirer"
                        onClick={() =>
                          setConds(conds.filter((_, j) => j !== i))
                        }>
                        −
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  className="btn secondary btn-sm"
                  onClick={() => setConds([...conds, emptyCond()])}>
                  + Ajouter une condition
                </button>
              </div>

              <div className="mv-form-block">
                <label className="field-label">
                  Priorité{" "}
                  <span className="muted">(petit = évalué d’abord)</span>
                </label>
                <input
                  className="input"
                  type="number"
                  value={priority}
                  onChange={(e) => setPriority(Number(e.target.value) || 0)}
                />
              </div>

              <div className="mv-form-block">
                <label className="field-label">Groupe cible</label>
                <select
                  className="input"
                  value={groupId}
                  onChange={(e) => setGroupId(e.target.value)}>
                  <option value="">Choisir un groupe…</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="mv-form-block mv-form-block--full mv-toggles">
                <label className="mv-toggle">
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(e) => setEnabled(e.target.checked)}
                  />
                  <span>
                    <strong>Règle active</strong>
                    <small>Désactivez pour garder la config sans l’évaluer</small>
                  </span>
                </label>
                <label className="mv-toggle">
                  <input
                    type="checkbox"
                    checked={permanent}
                    onChange={(e) => {
                      setPermanent(e.target.checked)
                      if (e.target.checked) setOnlyUnassigned(false)
                    }}
                  />
                  <span>
                    <strong>Permanent</strong>
                    <small>S’applique même si l’agent a déjà un groupe</small>
                  </span>
                </label>
                <label className={`mv-toggle ${permanent ? "is-disabled" : ""}`}>
                  <input
                    type="checkbox"
                    checked={onlyUnassigned && !permanent}
                    disabled={permanent}
                    onChange={(e) => setOnlyUnassigned(e.target.checked)}
                  />
                  <span>
                    <strong>Uniquement si sans groupe</strong>
                    <small>Ne touche pas aux agents déjà assignés</small>
                  </span>
                </label>
              </div>

              <p className="mv-form-hint muted">
                Exemple : label <em>contient</em> « mon » matche « mon-pc ». Après
                création ou modification, les agents enrollés sont réévalués
                automatiquement.
              </p>
            </div>

            <div className="mv-form-foot">
              <button
                type="button"
                className="btn secondary"
                onClick={() => {
                  resetForm()
                  setFormOpen(false)
                }}>
                Annuler
              </button>
              <button
                type="button"
                className="btn mv-btn-primary"
                disabled={
                  busy ||
                  !name.trim() ||
                  validConds.length === 0 ||
                  !groupId
                }
                onClick={() => void saveRule()}>
                {editId ? "Enregistrer les changements" : "Créer la règle"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
