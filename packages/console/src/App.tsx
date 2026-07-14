import { useCallback, useEffect, useMemo, useState } from "react"

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

const IDLE_MS = 5 * 60 * 1000

const AI_HOST_PRESETS = [
  "chatgpt.com",
  "chat.openai.com",
  "claude.ai",
  "gemini.google.com",
  "bard.google.com",
  "copilot.microsoft.com",
  "perplexity.ai",
  "chat.deepseek.com",
  "aistudio.google.com",
  "poe.com",
  "you.com",
  "chat.mistral.ai",
  "lechat.mistral.ai",
  "console.groq.com",
  "grok.x.ai",
  "grok.com",
  "huggingface.co",
  "phind.com",
  "meta.ai",
  "pi.ai",
  "character.ai",
  "notebooklm.google.com",
  "openrouter.ai",
  "together.ai",
  "fireworks.ai",
  "blackbox.ai",
  "chat.lmsys.org",
  "lmarena.ai",
  "typingmind.com",
  "chat.qwen.ai",
  "writesonic.com",
  "jasper.ai",
  "copy.ai",
  "notion.so",
  "platform.openai.com",
  "labs.google",
  "deepai.org",
  "sider.ai",
  "monica.im",
  "chatpdf.com",
  "consensus.app",
  "elicit.com"
]

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
  const [tab, setTab] = useState<Tab>("summary")
  const [apiBase, setApiBaseState] = useState(getApiBase())
  const [health, setHealth] = useState<string>("…")
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

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
          ? `Pack ${res.version} : ${res.rules_count} règles actives — désactivées : ${ids.join(", ")} (voir Audit → rule_disable)`
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
    <div className="app-shell">
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
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden>
            <img src="/brand/icon-48.png" alt="" />
          </div>
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
            Appliquer
          </button>
          <button
            className="btn secondary btn-sm"
            type="button"
            onClick={() => {
              void refreshHealth()
              void loadTab(tab)
            }}>
            Refresh
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
            Déconnexion
          </button>
        </div>
      </header>

      <div className="status-strip">
        <span>
          <span
            className={`status-dot ${health.startsWith("API OK") ? "" : "off"}`}
          />
          <strong>{health}</strong>
        </span>
        {orgCode ? (
          <span title={orgName || orgCode}>
            Org · <strong className="mono">{orgCode}</strong>
          </span>
        ) : null}
        {primaryEmail ? <span>Install · {primaryEmail}</span> : null}
        <span className="badge-v1">V1 · 1.2</span>
        <span>Control plane</span>
      </div>

      {error && <p className="err flash err">{error}</p>}
      {info && <p className="ok flash ok">{info}</p>}

      <div className="shell-body">
      <nav className="shell-nav" aria-label="Navigation principale">
        <button
          type="button"
          className={`shell-nav-item ${tab === "summary" ? "active" : ""}`}
          onClick={() => setTab("summary")}>
          Tableau de bord
        </button>
        <button
          type="button"
          className={`shell-nav-item ${tab === "policy" ? "active" : ""}`}
          onClick={() => setTab("policy")}>
          Policy
        </button>
        <button
          type="button"
          className={`shell-nav-item ${tab === "people" ? "active" : ""}`}
          onClick={() => setTab("people")}>
          Admins &amp; groupes
        </button>
        <button
          type="button"
          className={`shell-nav-item ${tab === "packs" ? "active" : ""}`}
          onClick={() => setTab("packs")}>
          Packs de règles
        </button>
        <button
          type="button"
          className={`shell-nav-item ${tab === "agents" || tab === "moving" ? "active" : ""}`}
          onClick={() => setTab("agents")}>
          Agents
        </button>
        {(tab === "agents" || tab === "moving") && (
          <button
            type="button"
            className={`shell-nav-sub ${tab === "moving" ? "active" : ""}`}
            onClick={() => setTab("moving")}>
            ↳ Règles auto
          </button>
        )}
        <button
          type="button"
          className={`shell-nav-item ${tab === "events" ? "active" : ""}`}
          onClick={() => setTab("events")}>
          Événements
        </button>
        <button
          type="button"
          className={`shell-nav-item ${tab === "audit" ? "active" : ""}`}
          onClick={() => setTab("audit")}>
          Audit admin
        </button>
        <button
          type="button"
          className={`shell-nav-item ${tab === "settings" ? "active" : ""}`}
          onClick={() => setTab("settings")}>
          Monitoring &amp; horaires
        </button>
      </nav>

      <main className="shell-main">
      {busy && tab !== "packs" && tab !== "policy" && (
        <p className="muted">Chargement…</p>
      )}

      {tab === "summary" && (
        <SummaryView
          summary={summary}
          busy={busy}
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
                  `Agent ${id} révoqué — l’extension repasse en local_only au prochain sync (≤ 2 min), sans mot de passe local.`
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
              setInfo("Profil assigné — force-sync déclenché pour les agents")
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
              setInfo("Utilisateur lié — policy via groupes au prochain sync")
              await loadTab("agents")
            } catch (e) {
              setError(String(e))
            } finally {
              setBusy(false)
            }
          }}
        />
      )}
      {tab === "events" && <EventsView events={events} />}
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
        <MonitoringSettingsView
          busy={busy}
          setBusy={setBusy}
          setError={setError}
          setInfo={setInfo}
        />
      )}

      <footer className="console-footer">
        OpsGate Console <strong>1.2.0</strong> · early customer · privacy by
        design (events metadata-only)
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
        <p className="muted">
          Première connexion ou après reset admin : définissez un nouveau mdp
          (saisi deux fois pour confirmation).
        </p>
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
  onRefresh,
  onForceSync,
  onMerged,
  setError,
  setInfo,
  setBusy
}: {
  summary: Summary | null
  busy?: boolean
  onRefresh: () => void
  onForceSync: () => void
  onMerged?: () => void
  setError?: (e: string | null) => void
  setInfo?: (i: string | null) => void
  setBusy?: (b: boolean) => void
}) {
  const [drill, setDrill] = useState<string | null>(null)
  const [drillEvents, setDrillEvents] = useState<EventRow[]>([])
  const [drillBusy, setDrillBusy] = useState(false)
  /** Panneau contextuel : unlicensed | grace | offline | decision | duplicates */
  const [panel, setPanel] = useState<string | null>(null)
  const [dashSection, setDashSection] = useState<
    "overview" | "licenses" | "connectivity" | "activity" | "rules"
  >("overview")

  if (!summary) {
    return (
      <div className="card empty">
        Pas de données. Lance <code>pnpm api:dev</code> puis Refresh.
        <div style={{ marginTop: 12 }}>
          <button className="btn secondary" type="button" onClick={onRefresh}>
            Retry
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

  const openDecision = async (k: string) => {
    setDrill(k)
    setPanel("decision")
    setDashSection("activity")
    setDrillBusy(true)
    try {
      const r = await api.eventsByDecision(k)
      setDrillEvents(
        (r.events || []).map((e) =>
          normalizeEvent(e as unknown as Record<string, unknown>)
        )
      )
    } catch {
      setDrillEvents([])
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
        `Fusion OK — conservé ${r.kept.slice(0, 12)}… · ${r.removed} supprimé(s)`
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
  const totalDec = maskN + riskN + cancelN
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
              <th>Dernier sync</th>
              <th>Hors ligne</th>
              <th>Licence</th>
            </tr>
          </thead>
          <tbody>
            {list.map((a) => (
              <tr key={a.id}>
                <td>
                  <strong>{a.device_label || "—"}</strong>
                  <div className="mono muted" style={{ fontSize: 10 }}>
                    {a.id.slice(0, 16)}…
                  </div>
                </td>
                <td className="muted">{a.host_name || "—"}</td>
                <td className="muted" style={{ fontSize: 12 }}>
                  {a.last_seen_at
                    ? new Date(a.last_seen_at).toLocaleString("fr-FR")
                    : "—"}
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
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <div className="dash-layout">
      <aside className="dash-sidebar" aria-label="Navigation tableau de bord">
        <div className="dash-sidebar-brand">
          <strong>OpsGate</strong>
          <span className="muted">Monitoring</span>
        </div>
        {(
          [
            ["overview", "Vue d’ensemble"],
            ["licenses", "Licences"],
            ["connectivity", "Connexion"],
            ["activity", "Activité"],
            ["rules", "Règles / menaces"]
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`dash-side-item ${dashSection === id ? "active" : ""}`}
            onClick={() => {
              setDashSection(id)
              setPanel(null)
            }}>
            {label}
            {id === "licenses" && lic.unlicensed > 0 ? (
              <span className="dash-side-badge">{lic.unlicensed}</span>
            ) : null}
            {id === "connectivity" && conn.offline_long > 0 ? (
              <span className="dash-side-badge warn">{conn.offline_long}</span>
            ) : null}
          </button>
        ))}
      </aside>

      <div className="dash-main">
      <div className="hero-card card">
        <div className="hero-copy">
          <p className="hero-kicker">Monitoring &amp; rapports · Tableau de bord</p>
          <h2>Statut de protection OpsGate</h2>
          <p className="muted">
            Widgets SOC (licences, hors-ligne, timeline) — charte DailyOps. Clic
            sur un statut pour lister les appareils.
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button
            className="btn secondary"
            type="button"
            disabled={busy}
            onClick={onRefresh}>
            Actualiser
          </button>
          <button
            className="btn"
            type="button"
            disabled={busy}
            onClick={onForceSync}>
            Forcer la synchronisation
          </button>
        </div>
      </div>

      {/* Licences + connexion — toujours visibles en overview / sections */}
      {(dashSection === "overview" || dashSection === "licenses") && (
      <div className="dash-grid">
        <div className="card dash-widget">
          <div className="dash-widget-head">
            <h2>Licences</h2>
            <span className="muted" style={{ fontSize: 11 }}>
              Sièges {lic.seats_used}
              {lic.seats > 0 ? ` / ${lic.seats}` : " · illimité"}
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
                <span className="dash-donut-lbl">unlic.</span>
              </div>
            </div>
            <ul className="dash-status-list">
              <li>
                <button
                  type="button"
                  className="dash-link-row"
                  onClick={() => setPanel("licensed")}>
                  <span className="dash-dot ok" /> Licensed{" "}
                  <strong>{lic.licensed}</strong>
                </button>
              </li>
              <li>
                <button
                  type="button"
                  className="dash-link-row"
                  onClick={() => setPanel("grace")}>
                  <span className="dash-dot warn" /> Grace{" "}
                  <strong>{lic.grace}</strong>
                </button>
              </li>
              <li>
                <button
                  type="button"
                  className="dash-link-row crit-text"
                  onClick={() => setPanel("unlicensed")}>
                  <span className="dash-dot crit" />{" "}
                  <strong>UNLICENSED {lic.unlicensed}</strong>
                </button>
              </li>
            </ul>
          </div>
        </div>

        <div className="card dash-widget">
          <div className="dash-widget-head">
            <h2>Connexion / sync</h2>
            <span className="muted" style={{ fontSize: 11 }}>
              Hors-ligne long &gt; {Math.round(conn.offline_long_ms / 3600000)} h
            </span>
          </div>
          <ul className="dash-status-list">
            <li>
              <span className="dash-dot ok" /> Online (&lt;{" "}
              {Math.round(conn.online_ms / 60000)} min){" "}
              <strong>{conn.online}</strong>
            </li>
            <li>
              <span className="dash-dot warn" /> Stale{" "}
              <strong>{conn.stale}</strong>
            </li>
            <li>
              <button
                type="button"
                className="dash-link-row crit-text"
                onClick={() => setPanel("offline")}>
                <span className="dash-dot crit" /> Not connected long time{" "}
                <strong>
                  {conn.schedule_active && !conn.within_work_hours
                    ? conn.offline_long_alertable ?? 0
                    : conn.offline_long}
                </strong>
                {conn.schedule_active && !conn.within_work_hours ? (
                  <span className="muted" style={{ fontSize: 11 }}>
                    {" "}
                    (hors horaires — alertes silencieuses)
                  </span>
                ) : null}
              </button>
            </li>
          </ul>
          <p className="muted" style={{ fontSize: 11, marginBottom: 0 }}>
            Seuil &gt; {Math.round(conn.offline_long_ms / 60000)} min ·{" "}
            {conn.schedule_active
              ? conn.within_work_hours
                ? "heures de travail actives"
                : "hors plage horaire (pas d’alerte)"
              : "schedule off · 24/7"}
            . Clic pour lister.
          </p>
        </div>

        <div className="card dash-widget">
          <div className="dash-widget-head">
            <h2>Statut protection</h2>
          </div>
          <div className="dash-status-row">
            <div className="dash-donut" aria-hidden>
              <div className="dash-donut-inner">
                <span className="dash-donut-num">{summary.agents}</span>
                <span className="dash-donut-lbl">agents</span>
              </div>
            </div>
            <ul className="dash-status-list">
              <li>
                <span className="dash-dot ok" /> Enrôlés{" "}
                <strong>{summary.agents}</strong>
              </li>
              <li>
                <span className="dash-dot warn" /> Events{" "}
                <strong>{summary.events_total}</strong>
              </li>
              <li>
                <span className="dash-dot crit" /> Envois risqués{" "}
                <strong>{riskN}</strong>
              </li>
              <li className="muted" style={{ fontSize: 12 }}>
                Pack{" "}
                <strong className="mono">
                  {summary.active_rules_pack?.version || "—"}
                </strong>
              </li>
            </ul>
          </div>
        </div>
      </div>
      )}

      {(dashSection === "overview" || dashSection === "activity") && (
      <div className="dash-grid">
        <div className="card dash-widget">
          <div className="dash-widget-head">
            <h2>Activité des décisions</h2>
            <span className="muted" style={{ fontSize: 11 }}>
              Clic = détail
            </span>
          </div>
          <div className="dash-bars">
            {(
              [
                ["mask_send", "Masquer", maskN, "ok"],
                ["send_anyway", "Risqué", riskN, "crit"],
                ["cancel", "Annuler", cancelN, "warn"]
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
            <h2>Events (14 jours)</h2>
            <span className="muted" style={{ fontSize: 11 }}>
              Timeline
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
              <p className="muted">Pas encore de série temporelle</p>
            )}
          </div>
        </div>
      </div>
      )}

      {(dashSection === "overview" || dashSection === "rules") && (
      <div className="dash-grid">
        <div className="card dash-widget">
          <div className="dash-widget-head">
            <h2>Menaces / règles les + fréquentes</h2>
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
            <div className="empty" style={{ padding: 16 }}>
              Aucun event encore — enrôlez un agent et testez un prompt.
            </div>
          )}
        </div>
        {dups.length > 0 && (
          <div className="card dash-widget">
            <div className="dash-widget-head">
              <h2>Doublons potentiels</h2>
              <button
                type="button"
                className="btn secondary btn-sm"
                onClick={() => setPanel("duplicates")}>
                Voir
              </button>
            </div>
            <p className="muted" style={{ fontSize: 12 }}>
              {dups.length} fingerprint(s) avec plusieurs agents — révoquez les
              entrées obsolètes dans Agents.
            </p>
          </div>
        )}
      </div>
      )}

      {/* Panneaux contextuels cliquables */}
      {panel === "licensed" && (
        <div className="card dash-context-panel">
          <h3 style={{ marginTop: 0 }}>
            Agents Licensed{" "}
            <button
              type="button"
              className="btn secondary btn-sm"
              onClick={() => setPanel(null)}>
              Fermer
            </button>
          </h3>
          {renderAgentList(summary.agents_licensed, "Aucun agent licensed")}
        </div>
      )}
      {panel === "unlicensed" && (
        <div className="card dash-context-panel">
          <h3 style={{ marginTop: 0 }}>
            Agents UNLICENSED{" "}
            <button
              type="button"
              className="btn secondary btn-sm"
              onClick={() => setPanel(null)}>
              Fermer
            </button>
          </h3>
          <p className="muted">
            Pas de siège / pas de groupe — protection inactive après grace.
          </p>
          {renderAgentList(
            summary.agents_unlicensed,
            "Aucun agent unlicensed"
          )}
        </div>
      )}
      {panel === "grace" && (
        <div className="card dash-context-panel">
          <h3 style={{ marginTop: 0 }}>
            Agents en grace (5 min){" "}
            <button
              type="button"
              className="btn secondary btn-sm"
              onClick={() => setPanel(null)}>
              Fermer
            </button>
          </h3>
          {renderAgentList(summary.agents_grace, "Aucun agent en grace")}
        </div>
      )}
      {panel === "offline" && (
        <div className="card dash-context-panel">
          <h3 style={{ marginTop: 0 }}>
            Not connected for long time (&gt;{" "}
            {Math.round(conn.offline_long_ms / 60000)} min){" "}
            <button
              type="button"
              className="btn secondary btn-sm"
              onClick={() => setPanel(null)}>
              Fermer
            </button>
          </h3>
          <p className="muted">
            Dernier sync trop ancien. Révoquez si obsolète. Les alertes
            « actives » respectent le planning (hors 17h–8h si schedule ON).
          </p>
          {renderAgentList(
            summary.agents_offline_long,
            "Tous les agents ont synchronisé récemment"
          )}
        </div>
      )}
      {panel === "duplicates" && (
        <div className="card dash-context-panel">
          <h3 style={{ marginTop: 0 }}>
            Doublons (même fingerprint){" "}
            <button
              type="button"
              className="btn secondary btn-sm"
              onClick={() => setPanel(null)}>
              Fermer
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
                  Fusionner (garder le + récent)
                </button>
              </div>
              {renderAgentList(d.agents, "")}
            </div>
          ))}
        </div>
      )}
      {panel === "decision" && drill && (
        <div className="card dash-context-panel">
          <h3 style={{ fontSize: 14, marginTop: 0 }}>
            Logs « {decisionLabelFr(drill)} »{" "}
            <span className="mono muted" style={{ fontSize: 11 }}>
              {drill}
            </span>{" "}
            <button
              type="button"
              className="btn secondary btn-sm"
              onClick={() => {
                setPanel(null)
                setDrill(null)
              }}>
              Fermer
            </button>
          </h3>
          {drillBusy ? (
            <p className="muted">Chargement…</p>
          ) : drillEvents.length === 0 ? (
            <div className="empty">Aucun event pour cette décision</div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Quand</th>
                    <th>Label appareil</th>
                    <th>Site</th>
                    <th>Sévérité</th>
                    <th>Détail</th>
                  </tr>
                </thead>
                <tbody>
                  {drillEvents.slice(0, 80).map((e) => (
                    <tr key={e.id}>
                      <td className="muted">
                        {e.ts
                          ? new Date(e.ts).toLocaleString("fr-FR")
                          : "—"}
                      </td>
                      <td>
                        <strong>{e.device_label || "—"}</strong>
                      </td>
                      <td className="muted" style={{ fontSize: 12 }}>
                        {e.hostname || "—"}
                      </td>
                      <td>
                        <span className={`badge ${e.highest_severity}`}>
                          {e.highest_severity}
                        </span>
                      </td>
                      <td className="muted" style={{ fontSize: 11 }}>
                        {(e.types || []).join(", ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div className="card">
        <h2>Décisions utilisateur</h2>
        <p className="muted">
          Cliquez <strong>Risqué</strong> (ou une autre décision) pour afficher
          les logs concernés juste au-dessus.
        </p>
        <div className="decision-grid">
          {(
            [
              ["mask_send", "Masquer & envoyer"],
              ["send_anyway", "Envoyer quand même (Risqué)"],
              ["cancel", "Annuler"],
              ["enroll", "Enrôlement"],
              ["unenroll", "Désinscription"]
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              className={`decision-btn ${drill === k ? "is-active" : ""}`}
              onClick={() => void openDecision(k)}>
              <div className="decision-key">{label}</div>
              <div className="decision-count">{decisions[k] || 0}</div>
              <div className="decision-code mono">{k}</div>
            </button>
          ))}
        </div>
      </div>
      </div>
    </div>
  )
}

function MonitoringSettingsView({
  busy,
  setBusy,
  setError,
  setInfo
}: {
  busy: boolean
  setBusy: (b: boolean) => void
  setError: (e: string | null) => void
  setInfo: (i: string | null) => void
}) {
  const [onlineMin, setOnlineMin] = useState(15)
  const [offlineMin, setOfflineMin] = useState(120)
  const [schedOn, setSchedOn] = useState(false)
  const [tz, setTz] = useState("Europe/Paris")
  const [workStart, setWorkStart] = useState("08:00")
  const [workEnd, setWorkEnd] = useState("17:00")
  const [breakStart, setBreakStart] = useState("12:00")
  const [breakEnd, setBreakEnd] = useState("13:00")
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5])
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
        const br = m.schedule?.breaks?.[0]
        if (br) {
          setBreakStart(br.start)
          setBreakEnd(br.end)
        }
        setLoaded(true)
      } catch (e) {
        setError(String(e))
      }
    })()
  }, [setError])

  const dayLabels: [number, string][] = [
    [1, "Lun"],
    [2, "Mar"],
    [3, "Mer"],
    [4, "Jeu"],
    [5, "Ven"],
    [6, "Sam"],
    [7, "Dim"]
  ]

  if (!loaded) {
    return <div className="card empty">Chargement des paramètres…</div>
  }

  return (
    <div className="card">
      <h2>Monitoring &amp; horaires de travail</h2>
      <p className="muted">
        Définissez après combien de temps sans sync un agent est « not connected
        for long time », et le planning pour ne pas alerter la nuit / week-end
        (PC éteints).
      </p>
      <div className="form-stack" style={{ maxWidth: 520 }}>
        <label className="field-label">Online si last_seen &lt; (minutes)</label>
        <input
          className="input"
          type="number"
          min={2}
          value={onlineMin}
          onChange={(e) => setOnlineMin(Number(e.target.value) || 15)}
        />
        <label className="field-label">
          Not connected long time si last_seen &gt; (minutes)
        </label>
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
          Activer le planning (alertes hors-ligne uniquement aux heures de
          travail)
        </label>
        {schedOn && (
          <>
            <label className="field-label">Fuseau</label>
            <input
              className="input"
              value={tz}
              onChange={(e) => setTz(e.target.value)}
              placeholder="Europe/Paris"
            />
            <label className="field-label">Jours travaillés</label>
            <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
              {dayLabels.map(([d, lab]) => (
                <label
                  key={d}
                  style={{ display: "flex", gap: 4, alignItems: "center" }}>
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
            </div>
            <div className="row">
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
        <button
          className="btn"
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            setError(null)
            try {
              await api.updateMonitoring({
                onlineMs: onlineMin * 60 * 1000,
                offlineLongMs: offlineMin * 60 * 1000,
                schedule: {
                  enabled: schedOn,
                  timezone: tz,
                  workDays: days,
                  workStart,
                  workEnd,
                  breaks:
                    breakStart && breakEnd
                      ? [{ start: breakStart, end: breakEnd }]
                      : []
                }
              })
              setInfo(
                "Paramètres monitoring enregistrés — le dashboard applique les seuils immédiatement."
              )
            } catch (e) {
              setError(String(e))
            } finally {
              setBusy(false)
            }
          }}>
          Enregistrer
        </button>
      </div>
    </div>
  )
}

function LoginScreen({
  apiBase,
  setApiBaseState,
  onSaveApi,
  health,
  onLoggedIn
}: {
  apiBase: string
  setApiBaseState: (v: string) => void
  onSaveApi: () => void
  health: string
  onLoggedIn: (a: AdminRow) => void
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

  return (
    <div className="login-shell">
      <div className="card login-card">
        <div className="login-brand">
          <div className="brand-mark" aria-hidden>
            <img src="/brand/icon-48.png" alt="" />
          </div>
          <div>
            <h1>OpsGate</h1>
            <p>Console admin · V1</p>
          </div>
        </div>
        <p className="muted" style={{ marginTop: 0 }}>
          Démo locale : <code>admin@demo.local</code> / <code>0000</code>
          <br />
          <span className="muted" style={{ fontSize: 12 }}>
            Changez le mot de passe à la première connexion (pilote externe).
          </span>
        </p>
        <label className="field-label">API</label>
        <div className="row">
          <input
            className="input"
            value={apiBase}
            onChange={(e) => setApiBaseState(e.target.value)}
          />
          <button className="btn secondary" type="button" onClick={onSaveApi}>
            OK
          </button>
        </div>
        <p className="muted">
          <span
            className={`status-dot ${health.startsWith("API OK") ? "" : "off"}`}
          />
          {health}
        </p>
        <label className="field-label">Email</label>
        <input
          className="input"
          style={{ width: "100%", minWidth: 0 }}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="username"
        />
        <label className="field-label">Mot de passe</label>
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
          style={{ marginTop: 16, width: "100%" }}
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
              const msg = String(e)
              if (msg.includes("session_already_active")) {
                setCanForce(true)
                setErr(
                  "Session déjà active sur ce compte (autre onglet / navigateur, ou session fantôme). Cliquez « Forcer la déconnexion » pour prendre la main, ou attendez ~10 min d’inactivité serveur."
                )
              } else {
                setErr(msg)
              }
            } finally {
              setBusy(false)
            }
          }}>
          Se connecter
        </button>
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
                setInfo(r.hint || "Session précédente révoquée.")
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
            Mot de passe oublié ? Réinitialiser mdp
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
                ? "Réinitialiser le mdp"
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
                        setInfo("Mdp mis à jour — connectez-vous")
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
  setInfo
}: {
  policy: PolicyDoc | null
  profiles: ProfileRow[]
  groups: GroupRow[]
  busy: boolean
  onReload: () => void
  setBusy: (b: boolean) => void
  setError: (e: string | null) => void
  setInfo: (i: string | null) => void
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
  const [showMsgEditor, setShowMsgEditor] = useState(false)
  const [otp, setOtp] = useState("")
  const [otpNewPwd, setOtpNewPwd] = useState("")
  const [devOtp, setDevOtp] = useState<string | null>(null)
  const [recoveryHint, setRecoveryHint] = useState<string | null>(null)

  // New profile form
  const [profName, setProfName] = useState("")
  const [profDept, setProfDept] = useState("")
  const [profHosts, setProfHosts] = useState(AI_HOST_PRESETS.join("\n"))
  // HostPicker edits via setProfHosts(hosts.join("\n"))
  const [profScan, setProfScan] = useState(true)
  const [profEvents, setProfEvents] = useState(true)
  const [profProtect, setProfProtect] = useState(false)
  const [profAction, setProfAction] = useState("mask_recommend")
  const [profGroups, setProfGroups] = useState<string[]>([])
  const [profMsgNotice, setProfMsgNotice] = useState("")
  const [profMsgBlockTitle, setProfMsgBlockTitle] = useState("")
  const [profMsgBlockBody, setProfMsgBlockBody] = useState("")
  const [showProfMsgs, setShowProfMsgs] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)

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
  }, [policy])

  if (!policy) {
    return (
      <div className="card empty">
        Policy introuvable. API démarrée ?
        <div style={{ marginTop: 12 }}>
          <button className="btn secondary" type="button" onClick={onReload}>
            Retry
          </button>
        </div>
      </div>
    )
  }

  const saveDefault = async () => {
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
      await api.updatePolicy({
        enabled_hosts: hosts
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean),
        scan_uploads: scanUploads,
        event_reporting: eventReporting,
        protect_unenroll: protectUnenroll,
        default_action: defaultAction,
        user_messages
      })
      setInfo(
        "Policy org + messages utilisateur enregistrés. Agents sous ~2 min (ou Force sync)."
      )
      onReload()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  const toggleId = (list: string[], id: string) =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id]

  return (
    <>
      <div className="card">
        <h2>Policy org par défaut</h2>
        <p className="muted">
          Version {policy.version} · epoch {policy.configEpoch ?? "—"} · pack{" "}
          {policy.rulesPackVersion}. Appliquée aux agents <strong>sans</strong>{" "}
          profil département.
        </p>

        <label className="field-label">Sites IA filtrés (1 host / ligne)</label>
        <textarea
          className="input"
          rows={5}
          value={hosts}
          onChange={(e) => setHosts(e.target.value)}
          style={{ width: "100%", fontFamily: "ui-monospace, monospace" }}
        />
        <div className="row" style={{ marginTop: 8, flexWrap: "wrap" }}>
          {AI_HOST_PRESETS.map((h) => (
            <button
              key={h}
              type="button"
              className="btn secondary"
              style={{ fontSize: 12, padding: "4px 8px" }}
              onClick={() => {
                const set = new Set(
                  hosts
                    .split("\n")
                    .map((x) => x.trim())
                    .filter(Boolean)
                )
                set.add(h)
                setHosts([...set].join("\n"))
              }}>
              + {h}
            </button>
          ))}
        </div>

        <div className="row" style={{ marginTop: 14, gap: 20, flexWrap: "wrap" }}>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={scanUploads}
              onChange={(e) => setScanUploads(e.target.checked)}
            />
            Scanner / autoriser uploads
          </label>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={eventReporting}
              onChange={(e) => setEventReporting(e.target.checked)}
            />
            Collecte d’events (télémétrie)
          </label>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={protectUnenroll}
              onChange={(e) => setProtectUnenroll(e.target.checked)}
            />
            Protéger désenrôlement par mdp admin
          </label>
        </div>
        <p className="muted" style={{ marginTop: 8 }}>
          La protection mdp n’est effective que si au moins un admin est créé
          (onglet Admins &amp; Groups). Sinon sortie libre.
        </p>

        <label className="field-label" style={{ marginTop: 12 }}>
          Action par défaut (mode de blocage)
        </label>
        <select
          className="input"
          value={defaultAction}
          onChange={(e) => setDefaultAction(e.target.value)}>
          <option value="warn">warn — alerte, choix libre</option>
          <option value="mask_recommend">
            mask_recommend — recommande le masquage (défaut)
          </option>
          <option value="mask_force">
            mask_force — masquage obligatoire (pas d’envoi tel quel)
          </option>
          <option value="block">
            block — envoi interdit (message admin explicite)
          </option>
        </select>
        <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
          Les messages doivent expliquer que c’est une <strong>décision admin</strong>,
          pas une erreur. Personnalisez-les ci-dessous ou laissez les défauts OpsGate.
        </p>

        <button
          type="button"
          className="btn secondary btn-sm"
          style={{ marginTop: 10 }}
          onClick={() => setShowMsgEditor((v) => !v)}>
          {showMsgEditor
            ? "Masquer les messages utilisateur"
            : "Personnaliser les messages utilisateur (banner)"}
        </button>
        {showMsgEditor && (
          <div
            className="form-stack"
            style={{
              marginTop: 12,
              maxWidth: 640,
              padding: 14,
              background: "var(--surface-2)",
              borderRadius: 10,
              border: "1px solid var(--line)"
            }}>
            <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>
              Champs vides = message par défaut OpsGate. Sync aux agents au prochain
              force-sync / poll.
            </p>
            <label className="field-label">Mention « pas une erreur » (toujours visible)</label>
            <textarea
              className="input"
              rows={2}
              placeholder="Cette restriction est appliquée par la politique…"
              value={msgAdminNotice}
              onChange={(e) => setMsgAdminNotice(e.target.value)}
            />
            <label className="field-label">Alerte — titre</label>
            <input
              className="input"
              value={msgAlertTitle}
              onChange={(e) => setMsgAlertTitle(e.target.value)}
              placeholder="Données sensibles détectées — action requise"
            />
            <label className="field-label">Alerte — corps</label>
            <textarea
              className="input"
              rows={2}
              value={msgAlertBody}
              onChange={(e) => setMsgAlertBody(e.target.value)}
            />
            <label className="field-label">Blocage total — titre</label>
            <input
              className="input"
              value={msgBlockTitle}
              onChange={(e) => setMsgBlockTitle(e.target.value)}
              placeholder="Envoi non autorisé par votre administrateur"
            />
            <label className="field-label">Blocage total — corps</label>
            <textarea
              className="input"
              rows={3}
              value={msgBlockBody}
              onChange={(e) => setMsgBlockBody(e.target.value)}
            />
            <label className="field-label">Masquage forcé — titre</label>
            <input
              className="input"
              value={msgForceTitle}
              onChange={(e) => setMsgForceTitle(e.target.value)}
            />
            <label className="field-label">Masquage forcé — corps</label>
            <textarea
              className="input"
              rows={2}
              value={msgForceBody}
              onChange={(e) => setMsgForceBody(e.target.value)}
            />
          </div>
        )}

        <div className="row" style={{ marginTop: 14 }}>
          <button
            className="btn"
            type="button"
            disabled={busy}
            onClick={() => void saveDefault()}>
            Enregistrer la policy
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
            Forcer sync agents
          </button>
        </div>
      </div>

      <div className="card">
        <h2>Profils département (policy1, policy2…)</h2>
        <p className="muted">
          Ex. Finance : pas d’upload, hosts restreints. Assigner ensuite dans
          l’onglet Agents.
        </p>
        {profiles.length === 0 ? (
          <div className="empty">Aucun profil</div>
        ) : (
          <div className="table-wrap"><table className="table">
            <thead>
              <tr>
                <th>Nom</th>
                <th>Dépt</th>
                <th>Hosts</th>
                <th>Upload</th>
                <th>Mdp exit</th>
                <th>Groupes / users</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {profiles.map((p) => (
                <tr key={p.id}>
                  <td>
                    <strong>{p.name}</strong>
                    <div className="mono muted" style={{ fontSize: 11 }}>
                      {p.id}
                    </div>
                  </td>
                  <td>{p.department || "—"}</td>
                  <td className="muted" style={{ fontSize: 12 }}>
                    {(p.enabledHosts || []).join(", ")}
                  </td>
                  <td>{p.scanUploads ? "oui" : "non"}</td>
                  <td>{p.protectUnenroll ? "🔒 oui" : "libre"}</td>
                  <td className="muted" style={{ fontSize: 11 }}>
                    Groupes: {(p.assignedGroupIds || []).length}
                  </td>
                  <td>
                    <button
                      className="btn secondary"
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
                        setProfGroups([...(p.assignedGroupIds || [])])
                        setProfMsgNotice(p.userMessages?.adminNotice || "")
                        setProfMsgBlockTitle(p.userMessages?.blockTitle || "")
                        setProfMsgBlockBody(p.userMessages?.blockBody || "")
                        setShowProfMsgs(!!p.userMessages)
                      }}>
                      Modifier
                    </button>{" "}
                    <button
                      className="btn danger"
                      type="button"
                      disabled={busy}
                      onClick={async () => {
                        if (!confirm(`Supprimer le profil ${p.name} ?`)) return
                        setBusy(true)
                        try {
                          await api.deleteProfile(p.id)
                          setInfo(`Profil ${p.name} supprimé`)
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

        <h3 style={{ fontSize: 14, marginTop: 20 }}>
          {editId ? "Modifier le profil" : "Nouveau profil"}
        </h3>
        <div className="row" style={{ marginBottom: 8 }}>
          <input
            className="input"
            placeholder="Nom (ex: Finance)"
            value={profName}
            onChange={(e) => setProfName(e.target.value)}
          />
          <input
            className="input"
            placeholder="Département"
            value={profDept}
            onChange={(e) => setProfDept(e.target.value)}
          />
        </div>
        <div className="field-label">Sites IA couverts</div>
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
            Uploads
          </label>
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={profEvents}
              onChange={(e) => setProfEvents(e.target.checked)}
            />
            Events
          </label>
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={profProtect}
              onChange={(e) => setProfProtect(e.target.checked)}
            />
            Protéger désenrôlement (mdp)
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
        </div>
        <button
          type="button"
          className="btn secondary btn-sm"
          style={{ marginTop: 10 }}
          onClick={() => setShowProfMsgs((v) => !v)}>
          {showProfMsgs
            ? "Masquer messages banner (profil)"
            : "Messages banner (override policy org)"}
        </button>
        {showProfMsgs && (
          <div
            className="form-stack"
            style={{
              marginTop: 10,
              maxWidth: 560,
              padding: 12,
              background: "var(--surface-2)",
              borderRadius: 8,
              border: "1px solid var(--line)"
            }}>
            <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
              Ces messages remplacent ceux de la policy org pour les agents de ce
              profil.
            </p>
            <label className="field-label">Mention admin</label>
            <textarea
              className="input"
              rows={2}
              value={profMsgNotice}
              onChange={(e) => setProfMsgNotice(e.target.value)}
            />
            <label className="field-label">Blocage — titre</label>
            <input
              className="input"
              value={profMsgBlockTitle}
              onChange={(e) => setProfMsgBlockTitle(e.target.value)}
            />
            <label className="field-label">Blocage — corps</label>
            <textarea
              className="input"
              rows={2}
              value={profMsgBlockBody}
              onChange={(e) => setProfMsgBlockBody(e.target.value)}
            />
          </div>
        )}
        <div style={{ marginTop: 10 }}>
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
                if (profMsgNotice.trim())
                  user_messages.adminNotice = profMsgNotice.trim()
                if (profMsgBlockTitle.trim())
                  user_messages.blockTitle = profMsgBlockTitle.trim()
                if (profMsgBlockBody.trim())
                  user_messages.blockBody = profMsgBlockBody.trim()
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
                  assigned_group_ids: profGroups,
                  user_messages
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
                setProfMsgBlockTitle("")
                setProfMsgBlockBody("")
                setShowProfMsgs(false)
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

      <div className="card">
        <h2>OTP Administrator principal</h2>
        <p className="muted">
          Le reset OTP se fait aussi sur l&apos;écran de login (email install).
          Ici : renvoyer un OTP si vous êtes déjà connecté (dev).
        </p>
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
          Demander OTP principal
        </button>
        {devOtp && (
          <p className="ok">
            OTP dev : <code>{devOtp}</code>
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
                setInfo("Mdp Administrator mis à jour")
                setOtp("")
                setOtpNewPwd("")
                setDevOtp(null)
              } catch (e) {
                setError(String(e))
              } finally {
                setBusy(false)
              }
            }}>
            Confirmer OTP
          </button>
        </div>
      </div>

      <div className="card">
        <h2>Recovery concepteur (principal only)</h2>
        <p className="muted">
          Uniquement sur agents <strong>offline &gt; 2h</strong> (poll sync ~2
          min). Les postes en contact reçoivent les nouveaux mdp admin via sync —
          pas de désinscription massive si le secret fuit.
        </p>
        <button
          className="btn secondary"
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            try {
              const r = await api.recoveryInfo()
              setRecoveryHint(r.recovery_password_hint)
              setInfo(r.note)
            } catch (e) {
              setError(String(e))
            } finally {
              setBusy(false)
            }
          }}>
          Afficher le recovery (principal)
        </button>
        {recoveryHint && (
          <p className="ok" style={{ marginTop: 10 }}>
            Recovery : <code>{recoveryHint}</code>
          </p>
        )}
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
  onActivate
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
}) {
  return (
    <>
      <div className="pack-help">
        <strong>À quoi sert un pack ?</strong> C’est le jeu de signatures de
        détection (secrets, configs…) poussé aux agents <em>sans rebuild</em> de
        l’extension. <strong>Publier</strong> = créer une nouvelle version
        (souvent l’active moins des règles bruyantes).{" "}
        <strong>Activer</strong> = choisir quelle version les agents reçoivent
        au sync. Doc : <code>docs/RULE-PACKS.md</code>
      </div>
      <div className="card">
        <h2>Publier un pack</h2>
        <p className="muted">
          Clone le pack actif, retire éventuellement des IDs de règles (ex. faux
          positifs), signe et active. Les agents appliquent au prochain sync
          (≤ 2 min) ou après <strong>Forcer la synchronisation</strong>.
        </p>
        <div className="row" style={{ marginBottom: 10 }}>
          <input
            className="input"
            style={{ minWidth: 280 }}
            value={disableRuleId}
            onChange={(e) => onDisableRuleId(e.target.value)}
            placeholder="IDs à désactiver : email-address,phone-fr"
          />
          <input
            className="input"
            style={{ minWidth: 200 }}
            value={publishNotes}
            onChange={(e) => onPublishNotes(e.target.value)}
            placeholder="notes (ex. pilote RH)"
          />
          <button className="btn" type="button" disabled={busy} onClick={onPublish}>
            {busy ? "…" : "Publier & activer"}
          </button>
        </div>
        <p className="muted">
          Les IDs saisis sont <strong>retirés</strong> du pack actif → journal
          d’audit <code>rule_disable</code> avec la liste exacte. Pack actif :{" "}
          <strong>{activeVersion || "—"}</strong>
        </p>
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
                <th>Publié</th>
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
                  <td className="muted">{p.notes || "—"}</td>
                  <td className="muted">
                    {new Date(p.published_at).toLocaleString("fr-FR")}
                    <div className="mono">{p.checksum.slice(0, 12)}…</div>
                  </td>
                  <td>
                    {!p.active && (
                      <button
                        className="btn secondary"
                        type="button"
                        disabled={busy}
                        onClick={() => onActivate(p.version)}>
                        Activer
                      </button>
                    )}
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
  setInfo
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
}) {
  const [admLabel, setAdmLabel] = useState("Operator")
  const [admEmail, setAdmEmail] = useState("")
  const [admPwd, setAdmPwd] = useState("")
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
  const [grpEditId, setGrpEditId] = useState<string | null>(null)

  const isPrincipal = !!sessionAdmin.is_principal

  const togglePerm = (p: AdminPermission) =>
    setAdmPerms((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]
    )

  return (
    <>
      <div className="card">
        <h2>Administrators</h2>
        <p className="muted">
          Utilisez <strong>Modifier</strong> sur votre ligne (ancien mdp +
          confirmation). <strong>Réinitialiser</strong> : réservé à
          l&apos;Administrator principal (force un nouveau mdp à la prochaine
          connexion).
        </p>
        <div className="table-wrap"><table className="table">
          <thead>
            <tr>
              <th>Label</th>
              <th>Email</th>
              <th>Rôles</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {admins.map((a) => (
              <tr key={a.id}>
                <td>
                  <strong>{a.label}</strong>
                  {a.is_principal ? " · Principal" : ""}
                </td>
                <td className="muted">{a.email}</td>
                <td className="cell-wide muted" style={{ fontSize: 12 }}>
                  {(a.permissions || []).join(", ")}
                </td>
                <td className="cell-actions">
                  <div className="btn-group">
                    {sessionAdmin.id === a.id && (
                      <button
                        className="btn secondary btn-sm"
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setEditId(a.id)
                          setEditEmail(a.email)
                          setEditCur("")
                          setEditPwd("")
                          setEditPwd2("")
                        }}>
                        Modifier
                      </button>
                    )}
                    {!a.is_principal && (
                      <button
                        className="btn secondary btn-sm"
                        type="button"
                        disabled={busy || !isPrincipal}
                        title={
                          isPrincipal
                            ? "Réinitialiser le mdp (l'admin devra le changer)"
                            : "Réservé à l'Administrator principal"
                        }
                        onClick={() => {
                          if (!isPrincipal) return
                          const pwd = prompt(
                            `Nouveau mdp temporaire pour ${a.label} (≥6) :`
                          )
                          if (!pwd || pwd.length < 6) return
                          setBusy(true)
                          void api
                            .resetSecondaryPassword(a.id, pwd)
                            .then(() => {
                              setInfo(
                                `Mdp de ${a.label} réinitialisé — popup obligatoire à sa prochaine connexion`
                              )
                              onReload()
                            })
                            .catch((e) => setError(String(e)))
                            .finally(() => setBusy(false))
                        }}>
                        Réinitialiser
                      </button>
                    )}
                    {!a.is_principal && isPrincipal && (
                      <button
                        className="btn danger btn-sm"
                        type="button"
                        disabled={busy}
                        onClick={async () => {
                          if (!confirm(`Supprimer ${a.label} ?`)) return
                          setBusy(true)
                          try {
                            await api.deleteAdmin(a.id)
                            setInfo(`${a.label} supprimé`)
                            onReload()
                          } catch (e) {
                            setError(String(e))
                          } finally {
                            setBusy(false)
                          }
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
        {editId && (
          <div className="card" style={{ marginTop: 12, background: "#f6f7f9" }}>
            <h3>Modifier mon compte</h3>
            <label className="field-label">Email</label>
            <input
              className="input"
              value={editEmail}
              onChange={(e) => setEditEmail(e.target.value)}
            />
            <label className="field-label">Mot de passe actuel</label>
            <input
              className="input"
              type="password"
              value={editCur}
              onChange={(e) => setEditCur(e.target.value)}
            />
            <label className="field-label">Nouveau mdp (optionnel)</label>
            <input
              className="input"
              type="password"
              value={editPwd}
              onChange={(e) => setEditPwd(e.target.value)}
            />
            <label className="field-label">Confirmer nouveau mdp</label>
            <input
              className="input"
              type="password"
              value={editPwd2}
              onChange={(e) => setEditPwd2(e.target.value)}
            />
            <div className="row" style={{ marginTop: 10 }}>
              <button
                className="btn"
                type="button"
                disabled={
                  busy ||
                  !editCur ||
                  (editPwd.length > 0 &&
                    (editPwd.length < 6 || editPwd !== editPwd2))
                }
                onClick={async () => {
                  setBusy(true)
                  try {
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
                    setInfo("Compte mis à jour")
                    setEditId(null)
                    onReload()
                  } catch (e) {
                    setError(String(e))
                  } finally {
                    setBusy(false)
                  }
                }}>
                Enregistrer
              </button>
              <button
                className="btn secondary"
                type="button"
                onClick={() => setEditId(null)}>
                Annuler
              </button>
            </div>
          </div>
        )}
        <h3 style={{ fontSize: 14 }}>Nouvel admin (secondaire)</h3>
        <div className="row" style={{ marginTop: 8, flexWrap: "wrap" }}>
          <input
            className="input"
            value={admLabel}
            onChange={(e) => setAdmLabel(e.target.value)}
            placeholder="Label"
          />
          <input
            className="input"
            value={admEmail}
            onChange={(e) => setAdmEmail(e.target.value)}
            placeholder="email (reset mdp)"
          />
          <input
            className="input"
            type="password"
            value={admPwd}
            onChange={(e) => setAdmPwd(e.target.value)}
            placeholder="Mdp ≥6"
          />
        </div>
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
                permissions: admPerms
              })
              setInfo(`Admin ${admLabel} créé`)
              setAdmPwd("")
              setAdmEmail("")
              onReload()
            } catch (e) {
              setError(String(e))
            } finally {
              setBusy(false)
            }
          }}>
          Ajouter admin
        </button>
      </div>

      <div className="card">
        <h2>Groupes d’utilisateurs</h2>
        <p className="muted">
          Liez un groupe à une policy profil. Futur : sync LDAP / groupes AD.
        </p>
        {groups.length === 0 ? (
          <div className="empty">Aucun groupe</div>
        ) : (
          <div className="table-wrap"><table className="table">
            <thead>
              <tr>
                <th>Nom</th>
                <th>Description</th>
                <th>Policy profil</th>
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
                    {g.description || "—"}
                  </td>
                  <td className="mono" style={{ fontSize: 12 }}>
                    {g.policyProfileId
                      ? profiles.find((p) => p.id === g.policyProfileId)
                          ?.name || g.policyProfileId
                      : "—"}
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
                        }}>
                        Modifier
                      </button>
                      <button
                        className="btn danger btn-sm"
                        type="button"
                        disabled={busy}
                        onClick={async () => {
                          if (!confirm(`Supprimer groupe ${g.name}?`)) return
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
                        Suppr.
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
        <div className="form-stack" style={{ maxWidth: 520, marginTop: 12 }}>
          <label className="field-label">Nom</label>
          <input
            className="input"
            value={grpName}
            onChange={(e) => setGrpName(e.target.value)}
            placeholder="Finance"
          />
          <label className="field-label">Description</label>
          <input
            className="input"
            value={grpDesc}
            onChange={(e) => setGrpDesc(e.target.value)}
            placeholder="Équipe finance — policy stricte"
          />
          <label className="field-label">Profil policy lié</label>
          <select
            className="input"
            value={grpProfile}
            onChange={(e) => setGrpProfile(e.target.value)}>
            <option value="">(pas de policy)</option>
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
                    setInfo("Groupe mis à jour")
                  } else {
                    await api.createGroup({
                      name: grpName.trim(),
                      description: grpDesc || undefined,
                      policy_profile_id: grpProfile || null
                    })
                    setInfo("Groupe créé")
                  }
                  setGrpName("")
                  setGrpDesc("")
                  setGrpProfile("")
                  setGrpEditId(null)
                  onReload()
                } catch (e) {
                  setError(String(e))
                } finally {
                  setBusy(false)
                }
              }}>
              {grpEditId ? "Enregistrer le groupe" : "Créer groupe"}
            </button>
            {grpEditId && (
              <button
                className="btn secondary"
                type="button"
                onClick={() => {
                  setGrpEditId(null)
                  setGrpName("")
                  setGrpDesc("")
                  setGrpProfile("")
                }}>
                Annuler
              </button>
            )}
          </div>
        </div>
        <p className="muted" style={{ marginTop: 10 }}>
          Affectation auto agents → groupe : onglet <strong>Règles auto</strong>{" "}
          (moving rules). LDAP : V2.1.
        </p>
      </div>

      <div className="card">
        <h2>Utilisateurs</h2>
        <p className="muted">
          Membres de groupes. Liez un agent à un user pour appliquer la policy du
          groupe.
        </p>
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
                  <td className="muted">{u.email || "—"}</td>
                  <td className="muted" style={{ fontSize: 12 }}>
                    {(u.groupIds || [])
                      .map(
                        (gid) => groups.find((g) => g.id === gid)?.name || gid
                      )
                      .join(", ") || "—"}
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

  useEffect(() => {
    void api.licenses().then(setStats).catch(() => setStats(null))
  }, [agents])

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
        <p className="muted">
          Un siège = un agent protégé. Sans siège : grâce 5 min puis protection
          désactivée. DEMO-OPSGATE : 25 sièges. PERSONAL : 1 siège (clé
          personnelle).
        </p>
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
        <p className="muted">
          Multi-sélection → bulk vers un <strong>groupe</strong> (hérite de sa
          policy) ou un profil. Code org = tenant commercial.
        </p>
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
          <div className="empty">
            Aucun agent. Code org <code>DEMO-OPSGATE</code> ou{" "}
            <code>PERSONAL</code>.
          </div>
        ) : (
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
              {agents.map((a) => (
                <tr key={a.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.includes(a.id)}
                      onChange={() => toggleSel(a.id)}
                    />
                  </td>
                  <td>
                    <strong>{a.device_label || "—"}</strong>
                    <div className="mono muted" style={{ fontSize: 11 }}>
                      {a.id}
                    </div>
                  </td>
                  <td>
                    {a.license_status === "unlicensed" ||
                    a.licensed === false ? (
                      <span style={{ color: "#dc2626", fontWeight: 700 }}>
                        UNLICENSED
                      </span>
                    ) : a.license_status === "grace" ? (
                      <span style={{ color: "#b45309", fontWeight: 650 }}>
                        grace
                      </span>
                    ) : (
                      <span className="badge active">licensed</span>
                    )}
                  </td>
                  <td className="muted" style={{ fontSize: 12 }}>
                    {a.group_id
                      ? groups.find((g) => g.id === a.group_id)?.name ||
                        a.group_id
                      : "—"}
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
    default:
      return d || "—"
  }
}

function EventsView({ events }: { events: EventRow[] }) {
  const [decisionF, setDecisionF] = useState("")
  const [severityF, setSeverityF] = useState("")
  const [sourceF, setSourceF] = useState("")
  const [labelF, setLabelF] = useState("")

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
    return events.filter((e) => {
      if (decisionF && e.decision !== decisionF) return false
      if (severityF && e.highest_severity !== severityF) return false
      if (sourceF && e.source !== sourceF) return false
      if (q) {
        const hay = `${e.device_label || ""} ${e.hostname || ""} ${(e.types || []).join(" ")} ${(e.file_names || []).join(" ")}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [events, decisionF, severityF, sourceF, labelF])

  return (
    <div className="card">
      <h2>Events (logs)</h2>
      <p className="muted">
        Identifiant appareil = <strong>label</strong> (enrôlement). Le site web
        (chatgpt.com…) n&apos;est pas l&apos;identifiant inventaire.
      </p>
      {events.length === 0 ? (
        <div className="empty">
          <p style={{ marginTop: 0 }}>
            Aucun event pour <strong>cette organisation</strong>.
          </p>
          <ul style={{ textAlign: "left", margin: "8px auto", maxWidth: 420 }}>
            <li>
              Console = org <code>DEMO-OPSGATE</code> (bandeau « Org · … »)
            </li>
            <li>
              Extension enrôlée org (pas PERSONAL) +{" "}
              <strong>Events cloud : activés</strong> dans Options
            </li>
            <li>
              Policy → Collecte events ON · puis <strong>Synchroniser</strong>
            </li>
            <li>
              L’enroll / unenroll / détections génèrent des events système ou
              détection
            </li>
            <li>
              Révoquer un agent <strong>conserve</strong> l’historique (ne
              l’efface plus)
            </li>
          </ul>
        </div>
      ) : (
        <>
          <div className="row" style={{ marginBottom: 12, flexWrap: "wrap" }}>
            <select
              className="input"
              value={decisionF}
              onChange={(e) => setDecisionF(e.target.value)}>
              <option value="">Toutes décisions</option>
              {decisions.map((d) => (
                <option key={d} value={d}>
                  {decisionLabelFr(d)} ({d})
                </option>
              ))}
            </select>
            <select
              className="input"
              value={severityF}
              onChange={(e) => setSeverityF(e.target.value)}>
              <option value="">Toutes sévérités</option>
              {severities.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select
              className="input"
              value={sourceF}
              onChange={(e) => setSourceF(e.target.value)}>
              <option value="">Toutes sources</option>
              {sources.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <input
              className="input"
              placeholder="Label / host / type…"
              value={labelF}
              onChange={(e) => setLabelF(e.target.value)}
            />
            <button
              className="btn secondary btn-sm"
              type="button"
              onClick={() => {
                setDecisionF("")
                setSeverityF("")
                setSourceF("")
                setLabelF("")
              }}>
              Reset
            </button>
          </div>
          <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
            {filtered.length} / {events.length} event(s)
          </p>
          {filtered.length === 0 ? (
            <div className="empty">Aucun event pour ces filtres</div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Quand</th>
                    <th>Label appareil</th>
                    <th>Décision</th>
                    <th>Acteur</th>
                    <th>Sévérité</th>
                    <th>Détail</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((e) => (
                    <tr key={e.id}>
                      <td className="muted">
                        {e.ts ? new Date(e.ts).toLocaleString("fr-FR") : "—"}
                      </td>
                      <td>
                        <strong>{e.device_label || "—"}</strong>
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
                          {e.source === "system"
                            ? " · système"
                            : e.source === "file"
                              ? " · fichier"
                              : e.source === "prompt" || e.source === "text"
                                ? " · prompt"
                                : e.source
                                  ? ` · ${e.source}`
                                  : ""}
                        </div>
                      </td>
                      <td className="mono" style={{ fontSize: 12 }}>
                        {e.exit_actor ||
                          e.exit_admin_label ||
                          (e.decision === "unenroll"
                            ? (e.types || []).find(
                                (t) =>
                                  t.startsWith("admin:") ||
                                  t === "vendor_recovery" ||
                                  t === "free"
                              ) || "—"
                            : "—")}
                      </td>
                      <td>
                        <span className={`badge ${e.highest_severity}`}>
                          {e.highest_severity}
                        </span>
                      </td>
                      <td className="muted">
                        {(e.types || []).join(", ")}
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

  if (!isPrincipal) {
    return (
      <div className="card">
        <h2>Audit administration</h2>
        <div className="empty">
          Réservé à l’<strong>Administrator principal</strong>. Les admins
          secondaires n’ont pas accès à ce journal.
        </div>
      </div>
    )
  }

  return (
    <div className="card">
      <h2>Audit administration</h2>
      <p className="muted">
        Connexions, déconnexions (manuel / auto), policy (détail des champs),
        packs, révocation, moving rules… Idle logout{" "}
        <strong>5 min</strong>.
      </p>
      <div className="row" style={{ marginBottom: 12 }}>
        <select
          className="input"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}>
          <option value="">Toutes les actions</option>
          <option value="login">login</option>
          <option value="logout">logout</option>
          <option value="logout_idle">logout_idle</option>
          <option value="policy_update">policy_update</option>
          <option value="pack_publish">pack_publish</option>
          <option value="rule_disable">rule_disable (règles désactivées)</option>
          <option value="agent_revoke">agent_revoke</option>
          <option value="force_sync">force_sync</option>
          <option value="admin_create">admin_create</option>
          <option value="moving_rule_upsert">moving_rule_upsert</option>
        </select>
        <button className="btn secondary" type="button" disabled={busy} onClick={() => void load()}>
          {busy ? "…" : "Actualiser"}
        </button>
      </div>
      {err && <p className="err">{err}</p>}
      {rows.length === 0 ? (
        <div className="empty">Aucun événement d’audit</div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Quand</th>
                <th>Admin</th>
                <th>Action</th>
                <th>Détail</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="muted">
                    {r.createdAt
                      ? new Date(r.createdAt).toLocaleString("fr-FR")
                      : "—"}
                  </td>
                  <td>
                    {r.adminLabel || "—"}
                    {r.adminEmail ? (
                      <div className="muted" style={{ fontSize: 11 }}>
                        {r.adminEmail}
                      </div>
                    ) : null}
                  </td>
                  <td>
                    <code>{r.action}</code>
                  </td>
                  <td className="muted">{r.detail || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/** Sélecteur d’hôtes IA : presets cliquables + customs + champ « + add AI » */
export function HostPicker({
  value,
  onChange
}: {
  value: string[]
  onChange: (hosts: string[]) => void
}) {
  const [custom, setCustom] = useState("")
  const set = new Set(value)
  const customHosts = value.filter((h) => !AI_HOST_PRESETS.includes(h))
  const toggle = (h: string) => {
    if (set.has(h)) onChange(value.filter((x) => x !== h))
    else onChange([...value, h])
  }
  const addCustom = () => {
    const h = custom
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split("/")[0]
      .split("?")[0]
    if (!h || !h.includes(".")) return
    if (!set.has(h)) onChange([...value, h])
    setCustom("")
  }
  return (
    <div>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
          marginBottom: 8
        }}>
        {AI_HOST_PRESETS.map((h) => (
          <button
            key={h}
            type="button"
            className={`btn btn-sm ${set.has(h) ? "accent" : "secondary"}`}
            onClick={() => toggle(h)}>
            {set.has(h) ? "✓ " : "+ "}
            {h}
          </button>
        ))}
        {customHosts.map((h) => (
          <button
            key={`custom-${h}`}
            type="button"
            className="btn btn-sm accent"
            title="Domaine personnalisé — cliquer pour retirer"
            onClick={() => toggle(h)}>
            ✓ {h}
          </button>
        ))}
      </div>
      <div className="row">
        <input
          className="input"
          placeholder="autre-domaine.ai"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              addCustom()
            }
          }}
        />
        <button
          type="button"
          className="btn secondary btn-sm"
          onClick={addCustom}>
          + Add AI
        </button>
      </div>
      {customHosts.length > 0 && (
        <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
          Domaines custom actifs : {customHosts.join(", ")}
        </p>
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
      <div className="pack-help">
        <strong>Règles d’affectation auto</strong> (inspiré Kaspersky{" "}
        <em>moving rules</em>) : multi-conditions en <strong>AND</strong> sur
        label / hostname. Priorité plus petite = évaluée en premier (style
        firewall). Déplacez ↑↓ ou éditez la prio. Appliqué à l’enroll et via «
        Ré-évaluer ».
      </div>
      <div className="card">
        <h2>Règles actives</h2>
        {rules.length === 0 ? (
          <div className="empty">Aucune règle — créez-en une ci-dessous</div>
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
                Conditions (AND — toutes doivent matcher)
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
                <option value="">—</option>
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
