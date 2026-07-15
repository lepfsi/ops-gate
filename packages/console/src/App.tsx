import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react"

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
  type PackListItem,
  type PolicyDoc,
  type ProfileRow,
  type Summary,
  type UserRow
} from "./api"
import { BrandMark } from "./BrandMark"
import { AI_HOST_PRESETS, HostPicker } from "./HostPicker"
import { getStoredLang, makeT, setStoredLang, type Lang } from "./i18n"

type Tab =
  | "summary"
  | "policy"
  | "people"
  | "packs"
  | "agents"
  | "events"
  | "audit"
  | "moving"
  | "settings"
  | "support"
  | "help"

const IDLE_MS = 5 * 60 * 1000

const ALL_PERMS: AdminPermission[] = [
  "console_access",
  "unenroll_agents",
  "manage_admins",
  "manage_policies",
  "manage_users"
]

export default function App() {
  const [sessionAdmin, setSessionAdmin] = useState<AdminRow | null>(null)
  const [authChecking, setAuthChecking] = useState(true)
  const [tab, setTab] = useState<Tab>(() => {
    try {
      const t = sessionStorage.getItem("opsgate_console_tab") as Tab | null
      if (
        t &&
        [
          "summary",
          "policy",
          "people",
          "packs",
          "agents",
          "events",
          "audit",
          "moving",
          "settings",
          "support",
          "help"
        ].includes(t)
      ) {
        return t
      }
    } catch {
      /* ignore */
    }
    return "summary"
  })
  /** Sous-section tableau de bord (une seule nav latérale) */
  const [dashSection, setDashSection] = useState<
    "overview" | "licenses" | "connectivity" | "activity" | "rules"
  >("overview")
  /** Sous-liens dashboard dépliés / repliés */
  const [dashNavOpen, setDashNavOpen] = useState(true)
  /** Dashboard plein écran : topbar + nav masquées ; Échap pour sortir */
  const [dashExpanded, setDashExpanded] = useState(false)
  const [apiBase, setApiBaseState] = useState(getApiBase())
  const [health, setHealth] = useState<string>("…")
  const [error, setErrorRaw] = useState<string | null>(null)
  const [info, setInfoRaw] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
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
      if (!getToken()) {
        setAuthChecking(false)
        return
      }
      try {
        const me = await api.me()
        setSessionAdmin(me.admin)
        if (me.org?.primary_email) setPrimaryEmail(me.org.primary_email)
        if (me.org?.org_code) setOrgCode(me.org.org_code)
        if (me.org?.name) setOrgName(me.org.name)
      } catch {
        setToken(null)
        setSessionAdmin(null)
        setOrgCode("")
        setOrgName("")
      } finally {
        setAuthChecking(false)
      }
    })()
  }, [])

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

  const goTab = useCallback(
    (t: Tab) => {
      setTab(t)
      try {
        sessionStorage.setItem("opsgate_console_tab", t)
      } catch {
        /* ignore */
      }
      if (t === "summary") {
        setDashNavOpen(true)
        setDashSection("overview")
      } else {
        setDashExpanded(false)
      }
      scrollConsoleTop()
    },
    [scrollConsoleTop]
  )

  useEffect(() => {
    try {
      sessionStorage.setItem("opsgate_console_tab", tab)
    } catch {
      /* ignore */
    }
  }, [tab])

  const loadTab = useCallback(async (t: Tab) => {
    if (!getToken()) return
    setError(null)
    setBusy(true)
    try {
      if (t === "summary") {
        setSummary(await api.summary())
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
            if (me.org?.primary_email) setPrimaryEmail(me.org.primary_email)
            if (me.org?.org_code) setOrgCode(me.org.org_code)
            if (me.org?.name) setOrgName(me.org.name)
          } catch {
            /* ignore */
          }
          setInfo(admin.must_change_password ? null : "Connecté")
        }}
      />
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
      {!dashExpanded && (
      <header className="topbar">
        <div className="brand">
          <BrandMark size={40} />
          <div className="brand-text">
            <h1>OpsGate</h1>
            <p>
              {sessionAdmin.label} · {sessionAdmin.email}
              {sessionAdmin.is_principal ? " · Principal" : ""}
            </p>
          </div>
        </div>
        <div className="topbar-actions">
          <input
            className="input"
            value={apiBase}
            onChange={(e) => setApiBaseState(e.target.value)}
            placeholder="http://127.0.0.1:8787"
          />
          <button className="btn secondary btn-sm" type="button" onClick={saveApi}>
            {t("top.apply")}
          </button>
          <button
            className="btn secondary btn-sm"
            type="button"
            onClick={() => {
              void refreshHealth()
              void loadTab(tab)
            }}>
            {t("top.refresh")}
          </button>
          <button
            className="btn secondary btn-sm"
            type="button"
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

      <div className="shell-body">
      {!dashExpanded && (
      <nav className="shell-nav" aria-label="Navigation principale">
        <div className="shell-nav-brand">
          <BrandMark size={32} />
          <div className="shell-nav-brand-text">
            <strong>OpsGate</strong>
            <span>Console</span>
          </div>
        </div>
        <button
          type="button"
          className={`shell-nav-item ${tab === "summary" ? "active" : ""} ${
            tab === "summary" && dashNavOpen ? "open" : ""
          }`}
          onClick={() => {
            if (tab === "summary") {
              // Toggle sous-liens + même hauteur haute (contenu dashboard)
              setDashNavOpen((o) => !o)
              setDashSection("overview")
              scrollConsoleTop()
              return
            }
            goTab("summary")
          }}>
          {t("nav.dashboard")}{" "}
          {tab === "summary" ? (dashNavOpen ? "▾" : "▸") : ""}
        </button>
        {tab === "summary" && dashNavOpen && (
          <>
            {(
              [
                ["overview", "nav.overview"],
                ["licenses", "nav.licenses"],
                ["connectivity", "nav.connectivity"],
                ["activity", "nav.activity"],
                ["rules", "nav.rules"]
              ] as const
            ).map(([id, labelKey]) => (
              <button
                key={id}
                type="button"
                className={`shell-nav-sub ${dashSection === id ? "active" : ""}`}
                onClick={() => {
                  setTab("summary")
                  setDashSection(id)
                  // Overview / licences / stale → haut du contenu (pas le bas de page)
                  if (
                    id === "overview" ||
                    id === "licenses" ||
                    id === "connectivity"
                  ) {
                    scrollConsoleTop()
                    return
                  }
                  const elId =
                    id === "activity" ? "dash-activity" : "dash-rules"
                  setTimeout(() => {
                    document
                      .getElementById(elId)
                      ?.scrollIntoView({ behavior: "smooth", block: "start" })
                  }, 30)
                }}>
                {t(labelKey)}
              </button>
            ))}
          </>
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
        <div className="shell-nav-foot">
          <button
            type="button"
            className={`shell-nav-item ${tab === "support" ? "active" : ""}`}
            onClick={() => goTab("support")}>
            {t("nav.support")}
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
      {/* Bandeau API : scrolle avec le contenu ; masqué en mode dashboard étendu */}
      {!(tab === "summary" && dashExpanded) && (
      <div className="status-strip">
        <span>
          <span
            className={`api-status ${health.startsWith("API OK") ? "ok" : "bad"}`}
            title={health}>
            API
          </span>
          <strong>
            {health.startsWith("API OK") ? t("login.apiOk") : health}
          </strong>
        </span>
        {orgCode ? (
          <span title={orgName || orgCode}>
            Org · <strong className="mono">{orgCode}</strong>
          </span>
        ) : null}
        {primaryEmail ? <span>Install · {primaryEmail}</span> : null}
        <span className="meta-tag">V1 1.2</span>
        <button
          type="button"
          className="btn secondary btn-sm"
          title="Clair / sombre"
          onClick={() => setTheme((th) => (th === "dark" ? "light" : "dark"))}>
          {theme === "dark" ? t("top.themeLight") : t("top.themeDark")}
        </button>
      </div>
      )}

      {busy && tab !== "packs" && tab !== "policy" && !dashExpanded && (
        <p className="muted">{t("common.loading")}</p>
      )}

      {tab === "summary" && (
        <SummaryView
          summary={summary}
          busy={busy}
          dashSection={dashSection}
          setDashSection={setDashSection}
          dashExpanded={dashExpanded}
          setDashExpanded={setDashExpanded}
          t={t}
          onRefresh={() => void loadTab("summary")}
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
      {tab === "moving" && (
        <MovingRulesView
          groups={groups}
          setBusy={setBusy}
          setError={setError}
          setInfo={setInfo}
          busy={busy}
        />
      )}
      {tab === "audit" && sessionAdmin && (
        <AuditView isPrincipal={!!sessionAdmin.is_principal} />
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
          t={t}
        />
      )}
      {tab === "support" && <SupportView t={t} />}
      {tab === "help" && <HelpView t={t} />}

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
        <label className="field-label">Nouveau mot de passe (≥6)</label>
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
          disabled={busy || next.length < 6 || next !== next2 || !cur}
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
  setError,
  setInfo,
  setBusy,
  t
}: {
  summary: Summary | null
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
  setError?: (e: string | null) => void
  setInfo?: (i: string | null) => void
  setBusy?: (b: boolean) => void
  t: (k: string, vars?: Record<string, string | number>) => string
}) {
  const [drill, setDrill] = useState<string | null>(null)
  const [drillEvents, setDrillEvents] = useState<EventRow[]>([])
  const [drillBusy, setDrillBusy] = useState(false)
  /** Panneau contextuel : unlicensed | grace | offline | decision | duplicates */
  const [panel, setPanel] = useState<string | null>(null)

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
  const riskN = decisions.send_anyway || 0
  const cancelN = decisions.cancel || 0
  const observeN = decisions.observe || 0
  const totalDec = maskN + riskN + cancelN + observeN
  const maxRule = Math.max(
    1,
    ...(summary.top_rules || []).map((r) => r.count)
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
                            ? "Offline — force sync unavailable"
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
      {/* Barre compacte en mode étendu ; hero complet sinon */}
      {dashExpanded ? (
        <div className="dash-fill-toolbar">
          <div className="dash-fill-toolbar-title">
            <strong>{t("dash.status")}</strong>
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
      ) : (
      <div className="hero-card card">
        <div className="hero-copy">
          <p className="hero-kicker">{t("nav.dashboard")}</p>
          <h2>{t("dash.status")}</h2>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <button
            className="btn secondary"
            type="button"
            disabled={busy}
            onClick={onRefresh}>
            {t("dash.refresh")}
          </button>
          <button
            className="btn secondary"
            type="button"
            onClick={() => {
              setDashExpanded(true)
              setPanel(null)
              setDrill(null)
            }}>
            {t("dash.expand")}
          </button>
          <button
            className="btn"
            type="button"
            disabled={busy}
            onClick={onForceSync}>
            {t("dash.forceSync")}
          </button>
        </div>
      </div>
      )}

      {/* Panneaux contextuels — masqués en mode étendu (graphiques seuls) */}
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
      {panel === "stale" && (
        <div className="card dash-context-panel">
          <h3 style={{ marginTop: 0 }}>
            {t("dash.panelStale")}{" "}
            <button type="button" className="btn secondary btn-sm" onClick={() => setPanel(null)}>
              {t("common.close")}
            </button>
          </h3>
          {renderAgentList(summary.agents_stale, t("dash.noStale"))}
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
                        {e.ts ? new Date(e.ts).toLocaleString("fr-FR") : " - "}
                      </td>
                      <td>
                        <strong>{e.device_label || " - "}</strong>
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
                        {(e.types || []).join(", ") || " - "}
                        {e.file_names?.length
                          ? ` · fichiers: ${e.file_names.slice(0, 2).join(", ")}`
                          : ""}
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

      {/* Charts licences / activité — toujours visibles ; remplissent l’écran en mode étendu */}
      <div className={dashExpanded ? "dash-fill-body" : undefined}>
      <div id="dash-charts" />
      <div id="dash-licenses" className="dash-grid">
        <div className="card dash-widget">
          <div className="dash-widget-head">
            <h2>{t("nav.licenses")}</h2>
            <span className="muted" style={{ fontSize: 11 }}>
              {t("dash.seats")} {lic.seats_used}
              {lic.seats > 0 ? ` / ${lic.seats}` : ` · ${t("dash.unlimited")}`}
            </span>
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
                <span className="dash-donut-lbl">{t("dash.unlicShort")}</span>
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
        </div>

        <div className="card dash-widget">
          <div className="dash-widget-head">
            <h2>{t("nav.connectivity")}</h2>
            <span className="muted" style={{ fontSize: 11 }}>
              {t("dash.offlineLong")} &gt;{" "}
              {Math.round(conn.offline_long_ms / 3600000)} h
            </span>
          </div>
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
                <strong>{conn.stale}</strong>
              </button>
            </li>
            <li>
              <button
                type="button"
                className="dash-link-row crit-text"
                onClick={() => openPanel("offline")}>
                <span className="dash-dot crit" /> {t("dash.offlineLongLabel")}{" "}
                <strong>
                  {conn.schedule_active && !conn.within_work_hours
                    ? conn.offline_long_alertable ?? 0
                    : conn.offline_long}
                </strong>
                {conn.schedule_active && !conn.within_work_hours ? (
                  <span className="muted" style={{ fontSize: 11 }}>
                    {" "}
                    {t("dash.offHoursSilent")}
                  </span>
                ) : null}
              </button>
            </li>
          </ul>
          <p className="muted" style={{ fontSize: 11, marginBottom: 0 }}>
            &gt; {Math.round(conn.offline_long_ms / 60000)} min ·{" "}
            {conn.schedule_active
              ? conn.within_work_hours
                ? t("dash.workHours")
                : t("dash.offHours")
              : t("dash.scheduleOff")}
            . {t("dash.clickList")}
          </p>
        </div>

        <div className="card dash-widget">
          <div className="dash-widget-head">
            <h2>{t("dash.protection")}</h2>
          </div>
          <div className="dash-status-row">
            <div className="dash-donut" aria-hidden>
              <div className="dash-donut-inner">
                <span className="dash-donut-num">{summary.agents}</span>
                <span className="dash-donut-lbl">{t("dash.agentsLbl")}</span>
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
        </div>
      </div>

      <div id="dash-activity" className="dash-grid">
        <div className="card dash-widget">
          <div className="dash-widget-head">
            <h2>{t("dash.activity")}</h2>
            <span className="muted" style={{ fontSize: 11 }}>
              {t("dash.clickDetail")}
            </span>
          </div>
          <div className="dash-bars">
            {(
              [
                ["mask_send", t("dash.mask"), maskN, "ok"],
                ["send_anyway", t("dash.risky"), riskN, "crit"],
                ["cancel", t("dash.cancel"), cancelN, "warn"],
                ["observe", t("dash.observe"), observeN, "ok"]
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
                      width: `${totalDec ? Math.max(6, (n / totalDec) * 100) : 0}%`
                    }}
                  />
                </span>
                <span className="dash-bar-n mono">{n}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="card dash-widget" style={{ gridColumn: "span 2" }}>
          <div className="dash-widget-head">
            <h2>{t("dash.events14")}</h2>
            <span className="muted" style={{ fontSize: 11 }}>
              {t("dash.timeline")}
            </span>
          </div>
          <div className="dash-timeline">
            {(summary.events_by_day || []).map((d) => (
              <div key={d.day} className="dash-tl-col" title={`${d.day}: ${d.count}`}>
                <div className="dash-tl-bar-wrap">
                  <div
                    className="dash-tl-bar"
                    style={{
                      height: `${Math.max(4, (d.count / maxDay) * 100)}%`
                    }}
                  />
                </div>
                <span className="dash-tl-lbl">
                  {d.day.slice(8)}
                </span>
              </div>
            ))}
            {!(summary.events_by_day || []).length && (
              <p className="muted">{t("dash.noSeries")}</p>
            )}
          </div>
        </div>
      </div>

      <div id="dash-rules" className="dash-grid">
        {/* Mode étendu : Décisions utilisateur à la place des menaces/règles */}
        {dashExpanded ? (
          <div className="card dash-widget dash-widget--decisions">
            <div className="dash-widget-head">
              <h2>{t("dash.userDecisions")}</h2>
            </div>
            <div className="decision-grid decision-grid--compact">
              {(
                [
                  ["mask_send", t("dash.maskSend")],
                  ["send_anyway", t("dash.sendAnyway")],
                  ["cancel", t("dash.cancel")],
                  ["observe", t("dash.observe")],
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
        ) : (
          <div className="card dash-widget">
            <div className="dash-widget-head">
              <h2>{t("dash.topThreats")}</h2>
            </div>
            {summary.top_rules?.length ? (
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
                        style={{ width: `${(r.count / maxRule) * 100}%` }}
                      />
                    </span>
                    <strong className="dash-rank-n">{r.count}</strong>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="empty">{t("dash.noEvents")}</div>
            )}
          </div>
        )}
        {dups.length > 0 && !dashExpanded && (
          <div className="card dash-widget">
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

      </div>{/* end dash-fill-body */}

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
  t: (k: string) => string
}) {
  const [settingsTab, setSettingsTab] = useState<
    "general" | "logs" | "license" | "notifications" | "monitoring" | "reports"
  >("general")
  const [addLicOpen, setAddLicOpen] = useState(false)
  const [licenseKeyInput, setLicenseKeyInput] = useState("")
  const [licMode, setLicMode] = useState<"trial" | "full">("trial")
  const [licDaysLeft, setLicDaysLeft] = useState<number | null>(null)
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
  const [weeklyExport, setWeeklyExport] = useState(true)
  const [logDetection, setLogDetection] = useState(true)
  const [logLogin, setLogLogin] = useState(true)
  const [logAudit, setLogAudit] = useState(true)
  const [logAgentLife, setLogAgentLife] = useState(true)
  const [notifLicExp, setNotifLicExp] = useState(true)
  const [notifLicDays, setNotifLicDays] = useState(30)
  const [notifBrute, setNotifBrute] = useState(true)
  const [notifBruteThr, setNotifBruteThr] = useState(5)
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

  useEffect(() => {
    void (async () => {
      try {
        const r = await api.monitoring()
        const m = r.monitoring
        setOnlineMin(Math.round((m.onlineMs || 900000) / 60000))
        setOfflineMin(Math.round((m.offlineLongMs || 7200000) / 60000))
        setSchedOn(!!m.schedule?.enabled)
        setTz(m.schedule?.timezone || "Europe/Paris")
        setWorkStart(m.schedule?.workStart || "08:00")
        setWorkEnd(m.schedule?.workEnd || "17:00")
        setDays(m.schedule?.workDays || [1, 2, 3, 4, 5])
        setRetentionDays(m.logRetentionDays ?? 90)
        setWeeklyExport(m.weeklyExportEnabled !== false)
        const br = m.schedule?.breaks?.[0]
        if (br) {
          setBreakStart(br.start)
          setBreakEnd(br.end)
        }
        const lc = m.logCategories
        if (lc) {
          setLogDetection(lc.detectionEvents !== false)
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
    })()
  }, [setError, orgName, primaryEmail])

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

  const saveMonitoring = async () => {
    setBusy(true)
    setError(null)
    try {
      const daysClamped = Math.min(
        3650,
        Math.max(1, Math.floor(retentionDays) || 90)
      )
      setRetentionDays(daysClamped)
      await api.updateMonitoring({
        onlineMs: onlineMin * 60 * 1000,
        offlineLongMs: offlineMin * 60 * 1000,
        logRetentionDays: daysClamped,
        weeklyExportEnabled: weeklyExport,
        logCategories: {
          detectionEvents: logDetection,
          adminLogin: logLogin,
          adminAudit: logAudit,
          agentLifecycle: logAgentLife
        },
        notifications: {
          licenseExpiring: notifLicExp,
          licenseExpiringDays: notifLicDays,
          loginBruteForce: notifBrute,
          loginBruteForceThreshold: notifBruteThr
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
        }
      })
      try {
        localStorage.setItem("opsgate_report_format", reportFormat)
        setStoredLang(lang)
      } catch {
        /* ignore */
      }
      setInfo(`${t("settings.saved")} · ${daysClamped} j`)
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  if (!loaded) {
    return <div className="card empty">{t("common.loading")}</div>
  }

  const settingsTabs: Array<
    | "general"
    | "logs"
    | "license"
    | "notifications"
    | "monitoring"
    | "reports"
  > = [
    "general",
    "logs",
    "license",
    "notifications",
    "monitoring",
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
              onClick={() => setSettingsTab(id)}>
              {t(`settings.tab.${id === "general" ? "general" : id === "logs" ? "logs" : id === "license" ? "license" : id === "notifications" ? "notifications" : id === "monitoring" ? "monitoring" : "reports"}`)}
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
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={weeklyExport}
                onChange={(e) => setWeeklyExport(e.target.checked)}
              />
              {t("logs.weekly")}
            </label>
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
          <div className="form-stack" style={{ maxWidth: 520 }}>
            <p className="muted" style={{ fontSize: 12, margin: 0 }}>
              {t("notif.hint")}
            </p>
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
          <div className="form-stack" style={{ maxWidth: 420 }}>
            <label className="field-label">{t("rep.format")}</label>
            <select
              className="input"
              value={reportFormat}
              onChange={(e) =>
                setReportFormat(e.target.value === "json" ? "json" : "csv")
              }>
              <option value="csv">{t("rep.csv")}</option>
              <option value="json">{t("rep.json")}</option>
            </select>
          </div>
        </div>
        )}

        {settingsTab === "monitoring" && (
        <div className="settings-section">
          <h3>{t("settings.tab.monitoring")}</h3>
          <div className="form-stack" style={{ maxWidth: 520 }}>
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
                  {(
                    [
                      ["Europe/Paris", "GMT+1/+2 · Europe/Paris (France)"],
                      ["Europe/Brussels", "GMT+1/+2 · Europe/Brussels"],
                      ["Europe/London", "GMT+0/+1 · Europe/London"],
                      ["Africa/Douala", "GMT+1 · Africa/Douala (Cameroun)"],
                      ["Africa/Nairobi", "GMT+3 · Africa/Nairobi"],
                      [
                        "Africa/Antananarivo",
                        "GMT+3 · Africa/Antananarivo"
                      ],
                      ["America/New_York", "GMT−5/−4 · America/New_York"],
                      ["UTC", "GMT+0 · UTC"]
                    ] as const
                  ).map(([v, lab]) => (
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
          </div>
        </div>
        )}

        {settingsTab !== "license" && (
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

function SupportView({ t }: { t: (k: string) => string }) {
  return (
    <div className="card help-card">
      <h2>{t("support.title")}</h2>
      <p className="muted" style={{ fontSize: 13, maxWidth: 560 }}>
        {t("support.intro")}
      </p>
      <div className="help-grid">
        <div className="help-tile">
          <div className="help-tile-kicker">{t("support.contact")}</div>
          <strong>Email</strong>
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
          <div className="help-tile-kicker">{t("support.ticket")}</div>
          <strong>{t("support.openTicket")}</strong>
          <p style={{ fontSize: 13 }}>
            {t("support.subject")}{" "}
            <code>[OpsGate] code-org · …</code>
          </p>
          <ul className="help-list">
            <li>{t("support.orgCode")}</li>
            <li>{t("support.version")}</li>
            <li>{t("support.desc")}</li>
          </ul>
        </div>
        <div className="help-tile">
          <div className="help-tile-kicker">{t("support.urgent")}</div>
          <strong>{t("support.recovery")}</strong>
          <p style={{ fontSize: 13 }}>{t("support.recoveryHint")}</p>
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
  const [err, setErr] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /** Session concurrente détectée → proposer force login */
  const [canForce, setCanForce] = useState(false)
  /** null | email | otp */
  const [resetStep, setResetStep] = useState<null | "email" | "otp">(null)
  const [resetEmail, setResetEmail] = useState("")
  const [otp, setOtp] = useState("")
  const [otpNew, setOtpNew] = useState("")
  const [devOtp, setDevOtp] = useState<string | null>(null)
  const [advanced, setAdvanced] = useState(false)

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
        <button
          className="btn"
          type="button"
          style={{ marginTop: 12, width: "100%" }}
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            setErr(null)
            setCanForce(false)
            try {
              setApiBase(apiBase)
              const r = await api.login(email, password, false)
              setToken(r.token)
              onLoggedIn(r.admin)
            } catch (e) {
              const err = e as Error & {
                code?: string
                remaining_attempts?: number
              }
              const msg = String(e)
              if (
                err.code === "session_already_active" ||
                msg.includes("session_already_active")
              ) {
                setCanForce(true)
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
                // Fallback si remaining_attempts absent
                setErr(msg.startsWith("Invalid") ? msg : `${t("login.invalid")}. ${msg}`)
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
          type="button"
          className="login-advanced-toggle"
          onClick={() => setAdvanced((v) => !v)}>
          {advanced ? t("login.advancedHide") : t("login.advanced")}
        </button>
        <p className="login-footer-meta">OpsGate · V1</p>
        {canForce && (
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
                const r = await api.login(email, password, true)
                setToken(r.token)
                setCanForce(false)
                setInfo(r.hint || t("login.force"))
                onLoggedIn(r.admin)
              } catch (e) {
                setErr(String(e))
              } finally {
                setBusy(false)
              }
            }}>
            Forcer la déconnexion de l’autre session
          </button>
        )}
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
                        setInfo(r.message)
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
                  Un OTP a été envoyé à <code>{resetEmail}</code>
                  {devOtp ? (
                    <>
                      {" "}
                      (dev : <code>{devOtp}</code>)
                    </>
                  ) : null}
                  .
                </p>
                <label className="field-label">OTP</label>
                <input
                  className="input"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                  autoFocus
                />
                <label className="field-label">Nouveau mot de passe (≥6)</label>
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
                    disabled={busy || !otp || otpNew.length < 6}
                    onClick={async () => {
                      setBusy(true)
                      try {
                        await api.confirmPrincipalOtp(otp, otpNew)
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
    <>
      {/* Policy org par défaut : ligne distincte */}
      <div className="card policy-default-card">
        <div className="policy-default-row">
          <div>
            <span className="policy-default-badge">{t("policy.defaultBadge")}</span>
            <strong style={{ marginLeft: 8 }}>{t("policy.defaultTitle")}</strong>
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              v{policy.version} · epoch {policy.configEpoch ?? " - "} ·{" "}
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
          <div className="policy-default-editor">
            <h3 style={{ fontSize: "0.95rem", marginTop: 0 }}>
              {t("policy.editDefault")}
            </h3>
        <label className="field-label">{t("policy.aiSites")}</label>
        <HostPicker
          value={hosts
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean)}
          onChange={(list) => setHosts(list.join("\n"))}
        />

        <div className="row" style={{ marginTop: 14, gap: 20, flexWrap: "wrap" }}>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={scanUploads}
              onChange={(e) => setScanUploads(e.target.checked)}
            />
            {t("policy.scanUploads")}
          </label>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={eventReporting}
              onChange={(e) => setEventReporting(e.target.checked)}
            />
            {t("policy.eventReporting")}
          </label>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={protectUnenroll}
              onChange={(e) => setProtectUnenroll(e.target.checked)}
            />
            {t("policy.protectUnenroll")}
          </label>
        </div>
        <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
          {t("policy.scanHint")}
        </p>
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
                <option value="Europe/Paris">Europe/Paris</option>
                <option value="Africa/Douala">Africa/Douala</option>
                <option value="Africa/Nairobi">Africa/Nairobi</option>
                <option value="Africa/Antananarivo">Africa/Antananarivo</option>
                <option value="UTC">UTC</option>
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
      <div className="card">
        <h2>{t("policy.profilesTitle")}</h2>
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
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
                    <td>{p.scanUploads ? t("common.yes") : t("common.no")}</td>
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
              checked={profScan}
              onChange={(e) => setProfScan(e.target.checked)}
            />
            {t("policy.scanFiles")}
          </label>
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
                <option value="Europe/Paris">Europe/Paris</option>
                <option value="Africa/Douala">Africa/Douala</option>
                <option value="Africa/Nairobi">Africa/Nairobi</option>
                <option value="Africa/Antananarivo">Africa/Antananarivo</option>
                <option value="UTC">UTC</option>
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
    </>
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
                            `${t("people.newPwdPrompt")} ${a.label} (≥6) :`
                          )
                          if (!pwd || pwd.length < 6) return
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
                  placeholder="≥6"
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
                    (editPwd.length < 6 ||
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
                {p}
              </label>
            ))}
          </div>
        )}
        <button
          className="btn"
          type="button"
          style={{ marginTop: 10 }}
          disabled={
            busy || !admLabel.trim() || !admEmail.includes("@") || admPwd.length < 6
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
              <option value="">—</option>
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

      {isPrincipal && (
        <>
          <div className="card">
            <h2>OTP Administrator principal</h2>
            <button
              className="btn secondary"
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                try {
                  const r = await api.requestPrincipalOtp()
                  setDevOtp(r.dev_otp || null)
                  setInfo(r.message)
                } catch (e) {
                  setError(String(e))
                } finally {
                  setBusy(false)
                }
              }}>
              Demander OTP
            </button>
            {devOtp && (
              <p className="ok">
                OTP : <code>{devOtp}</code>
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
                placeholder="Nouveau mdp ≥6"
                value={otpNewPwd}
                onChange={(e) => setOtpNewPwd(e.target.value)}
              />
              <button
                className="btn"
                type="button"
                disabled={busy || !otp || otpNewPwd.length < 6}
                onClick={async () => {
                  setBusy(true)
                  try {
                    await api.confirmPrincipalOtp(otp, otpNewPwd)
                    setInfo("Mot de passe Administrator mis à jour")
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
        </>
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

  useEffect(() => {
    void api.licenses().then(setStats).catch(() => setStats(null))
  }, [agents])

  useEffect(() => {
    setPage(1)
  }, [agents.length, pageSize])

  const pagedAgents = useMemo(() => {
    const start = (page - 1) * pageSize
    return agents.slice(start, start + pageSize)
  }, [agents, page, pageSize])

  const toggleSel = (id: string) =>
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )

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
        <h2>Agents enrollés</h2>
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
        ) : (
          <>
          <PagerBar
            page={page}
            pageSize={pageSize}
            total={agents.length}
            onPage={setPage}
            onPageSize={setPageSize}
          />
          <div className="table-wrap"><table className="table">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    checked={
                      agents.length > 0 && selected.length === agents.length
                    }
                    onChange={(e) =>
                      setSelected(
                        e.target.checked ? agents.map((a) => a.id) : []
                      )
                    }
                  />
                </th>
                <th>Label appareil</th>
                <th>Licence</th>
                <th>Groupe</th>
                <th>User</th>
                <th>Profil</th>
                <th>Last seen</th>
                <th></th>
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
                    <strong>{a.device_label || " - "}</strong>
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
                  <td className="cell-narrow muted">
                    {new Date(a.last_seen_at).toLocaleString("fr-FR")}
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
          </table></div>
          <PagerBar
            page={page}
            pageSize={pageSize}
            total={agents.length}
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
      return "Observé (proxy)"
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
        {total === 0 ? "0 entrée" : `${from}–${to} / ${total}`}
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
  t: (k: string) => string
}) {
  const [decisionF, setDecisionF] = useState("")
  const [severityF, setSeverityF] = useState("")
  const [sourceF, setSourceF] = useState("")
  const [labelF, setLabelF] = useState("")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [exportFrom, setExportFrom] = useState("")
  const [exportTo, setExportTo] = useState("")
  const [showExportRange, setShowExportRange] = useState(false)
  const [pageSize, setPageSize] = useState(50)
  const [page, setPage] = useState(1)
  const [exportBusy, setExportBusy] = useState(false)
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
      let fmt: "csv" | "json" = "csv"
      try {
        if (localStorage.getItem("opsgate_report_format") === "json") {
          fmt = "json"
        }
      } catch {
        /* ignore */
      }
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
        `Export ${range}${from && to ? ` ${from}→${to}` : ""} · ${r.count} events`
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
        <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
          <button
            type="button"
            className="btn secondary btn-sm"
            disabled={exportBusy}
            onClick={() => void doExport("week")}>
            {exportBusy ? "…" : t("events.exportWeek")}
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
            {t("events.exportAll")}
          </button>
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
                        className="btn secondary btn-sm"
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
                        {e.ts ? new Date(e.ts).toLocaleString("fr-FR") : " - "}
                      </td>
                      <td>
                        <strong>{e.device_label || " - "}</strong>
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
                      <td className="muted">
                        {(e.types || []).join(", ")}
                        {e.rule_ids?.length ? (
                          <div className="mono" style={{ fontSize: 10 }}>
                            {e.rule_ids.slice(0, 4).join(", ")}
                          </div>
                        ) : null}
                        {e.file_names?.length ? (
                          <div style={{ fontSize: 11 }}>
                            fichiers · {e.file_names.slice(0, 3).join(", ")}
                            {e.masked === false
                              ? " (non masqué)"
                              : e.masked
                                ? " (masqué)"
                                : ""}
                          </div>
                        ) : null}
                        {e.rule_ids?.length ? (
                          <div className="mono" style={{ fontSize: 11 }}>
                            {e.rule_ids.join(", ")}
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

function AuditView({ isPrincipal }: { isPrincipal: boolean }) {
  const [rows, setRows] = useState<
    Array<{
      id: string
      adminEmail?: string
      adminLabel?: string
      action: string
      detail?: string
      createdAt: string
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

  const load = useCallback(async () => {
    if (!isPrincipal) return
    setBusy(true)
    setErr(null)
    try {
      const r = await api.audit(filter || undefined)
      setRows(r.events || [])
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
    const headers = ["created_at", "admin_label", "admin_email", "action", "detail"]
    const lines = [headers.join(",")]
    for (const r of filtered) {
      const cells = [
        r.createdAt || "",
        r.adminLabel || "",
        r.adminEmail || "",
        r.action || "",
        (r.detail || "").replace(/"/g, '""')
      ].map((c) =>
        /[",\n]/.test(c) ? `"${c}"` : c
      )
      lines.push(cells.join(","))
    }
    downloadTextFile(
      `opsgate-audit-${new Date().toISOString().slice(0, 10)}.csv`,
      lines.join("\n"),
      "text/csv;charset=utf-8"
    )
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
        <h2 style={{ margin: 0 }}>Audit administration</h2>
        <button
          type="button"
          className="btn secondary btn-sm"
          disabled={!filtered.length}
          onClick={exportCsv}>
          Export CSV
        </button>
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
                </tr>
              </thead>
              <tbody>
                {pagedAudit.map((r) => (
                  <tr key={r.id}>
                    <td className="muted">
                      {r.createdAt
                        ? new Date(r.createdAt).toLocaleString("fr-FR")
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
  const [onlyUnassigned, setOnlyUnassigned] = useState(true)
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
    setOnlyUnassigned(true)
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

  return (
    <>
      <div className="card">
        <h2>Règles d’affectation</h2>
        {rules.length === 0 ? (
          <div className="empty">Aucune règle</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Ordre</th>
                  <th>Nom</th>
                  <th>Conditions (AND)</th>
                  <th>Groupe</th>
                  <th>Prio</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rules.map((r, idx) => (
                  <tr
                    key={r.id}
                    style={
                      r.enabled
                        ? undefined
                        : {
                            background: "var(--warn-soft)",
                            opacity: 0.92
                          }
                    }>
                    <td>
                      <div className="row" style={{ gap: 4 }}>
                        <button
                          className="btn secondary btn-sm"
                          type="button"
                          disabled={busy || idx === 0}
                          title="Monter (plus prioritaire)"
                          onClick={() => void swapPriority(idx, -1)}>
                          ↑
                        </button>
                        <button
                          className="btn secondary btn-sm"
                          type="button"
                          disabled={busy || idx === rules.length - 1}
                          title="Descendre"
                          onClick={() => void swapPriority(idx, 1)}>
                          ↓
                        </button>
                      </div>
                    </td>
                    <td>
                      <strong
                        style={
                          r.enabled
                            ? undefined
                            : { textDecoration: "line-through", color: "var(--warn)" }
                        }>
                        {r.name}
                      </strong>
                      {!r.enabled && (
                        <span
                          className="badge warning"
                          style={{
                            marginLeft: 8,
                            fontWeight: 700,
                            letterSpacing: "0.04em"
                          }}
                          title="Cette règle n’est pas évaluée">
                          INACTIF
                        </span>
                      )}
                    </td>
                    <td className="mono" style={{ fontSize: 12 }}>
                      {condsOf(r).map((c, i) => (
                        <div key={i}>
                          {c.field} {c.op} « {c.value} »
                        </div>
                      ))}
                    </td>
                    <td>
                      {groups.find((g) => g.id === r.targetGroupId)?.name ||
                        r.targetGroupId}
                    </td>
                    <td>
                      <input
                        className="input"
                        type="number"
                        style={{ width: 72 }}
                        defaultValue={r.priority}
                        key={`${r.id}-${r.priority}`}
                        disabled={busy}
                        onBlur={async (e) => {
                          const p = Number(e.target.value)
                          if (Number.isNaN(p) || p === r.priority) return
                          setBusy(true)
                          try {
                            await api.patchMovingRule(r.id, { priority: p })
                            setInfo(`Priorité « ${r.name} » → ${p}`)
                            await load()
                          } catch (err) {
                            setError(String(err))
                          } finally {
                            setBusy(false)
                          }
                        }}
                      />
                    </td>
                    <td>
                      <div className="row" style={{ gap: 4 }}>
                        <button
                          className="btn secondary btn-sm"
                          type="button"
                          disabled={busy}
                          onClick={() => openEdit(r)}>
                          Modifier
                        </button>
                        <button
                          className="btn danger btn-sm"
                          type="button"
                          disabled={busy}
                          onClick={async () => {
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
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <button
          className="btn secondary"
          type="button"
          style={{ marginTop: 12 }}
          disabled={busy}
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
          Ré-évaluer tous les agents
        </button>
      </div>
      <div className="card">
        {!formOpen ? (
          <button
            className="btn"
            type="button"
            onClick={() => {
              resetForm()
              setFormOpen(true)
            }}>
            + Nouvelle règle
          </button>
        ) : (
          <>
            <div
              className="row"
              style={{ justifyContent: "space-between", marginBottom: 8 }}>
              <h2 style={{ margin: 0 }}>
                {editId ? "Modifier la règle" : "Nouvelle règle"}
              </h2>
              <button
                className="btn secondary btn-sm"
                type="button"
                onClick={() => {
                  setFormOpen(false)
                  resetForm()
                }}>
                Fermer
              </button>
            </div>
            <div className="form-stack" style={{ maxWidth: 560 }}>
              <label className="field-label">Nom</label>
              <input
                className="input"
                placeholder="ex. Direction (label DIR*)"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <label className="field-label">
                Conditions (AND  -  toutes doivent matcher)
              </label>
              {conds.map((c, i) => (
                <div
                  key={i}
                  className="row"
                  style={{ flexWrap: "wrap", gap: 6, alignItems: "center" }}>
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
                    placeholder="valeur"
                    value={c.value}
                    onChange={(e) => {
                      const next = [...conds]
                      next[i] = { ...c, value: e.target.value }
                      setConds(next)
                    }}
                  />
                  <button
                    className="btn secondary btn-sm"
                    type="button"
                    disabled={conds.length <= 1}
                    onClick={() =>
                      setConds(conds.filter((_, j) => j !== i))
                    }>
                    −
                  </button>
                </div>
              ))}
              <button
                className="btn secondary btn-sm"
                type="button"
                onClick={() => setConds([...conds, emptyCond()])}>
                + Condition
              </button>
              <label className="field-label">Priorité (plus petit = d’abord)</label>
              <input
                className="input"
                type="number"
                value={priority}
                onChange={(e) => setPriority(Number(e.target.value) || 0)}
              />
              <label className="field-label">Groupe cible</label>
              <select
                className="input"
                value={groupId}
                onChange={(e) => setGroupId(e.target.value)}>
                <option value=""> - </option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={onlyUnassigned}
                  onChange={(e) => setOnlyUnassigned(e.target.checked)}
                />
                Uniquement si agent pas encore assigné
              </label>
              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                />
                Règle active
              </label>
              <div className="row">
                <button
                  className="btn"
                  type="button"
                  disabled={
                    busy ||
                    !name.trim() ||
                    validConds.length === 0 ||
                    !groupId
                  }
                  onClick={async () => {
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
                        only_if_unassigned: onlyUnassigned,
                        enabled
                      }
                      if (editId) {
                        await api.patchMovingRule(editId, body)
                        setInfo("Règle mise à jour")
                      } else {
                        await api.createMovingRule(body)
                        setInfo("Règle créée")
                      }
                      resetForm()
                      setFormOpen(false)
                      await load()
                    } catch (e) {
                      setError(String(e))
                    } finally {
                      setBusy(false)
                    }
                  }}>
                  {editId ? "Enregistrer" : "Créer la règle"}
                </button>
                <button
                  className="btn secondary"
                  type="button"
                  onClick={() => {
                    resetForm()
                    setFormOpen(false)
                  }}>
                  Annuler
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  )
}
