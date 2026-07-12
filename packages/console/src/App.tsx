import { useCallback, useEffect, useState } from "react"

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

type Tab = "summary" | "policy" | "people" | "packs" | "agents" | "events"

const AI_HOST_PRESETS = [
  "chatgpt.com",
  "chat.openai.com",
  "claude.ai",
  "gemini.google.com",
  "copilot.microsoft.com",
  "perplexity.ai",
  "chat.deepseek.com",
  "aistudio.google.com"
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
        const [a, pr, u] = await Promise.all([
          api.agents(),
          api.profiles(),
          api.users()
        ])
        setAgents(a.agents || [])
        setProfiles(pr.profiles || [])
        setUsers(u.users || [])
      } else if (t === "events") {
        const e = await api.events()
        const raw = (e.events || []) as unknown as Record<string, unknown>[]
        setEvents(raw.map((r) => normalizeEvent(r)))
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
      setInfo(`Publié & activé ${res.version} (${res.rules_count} règles)`)
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
                await api.logout()
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

      <nav className="tabs">
        {(
          [
            ["summary", "Tableau de bord"],
            ["policy", "Policy"],
            ["people", "Admins & groupes"],
            ["packs", "Packs de règles"],
            ["agents", "Agents"],
            ["events", "Événements"]
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`tab ${tab === id ? "active" : ""}`}
            onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </nav>

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
              await api.revokeAgent(id)
              setInfo(`Agent ${id} révoqué`)
              await loadTab("agents")
              await loadTab("summary")
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

      <footer className="console-footer">
        OpsGate Console <strong>1.2.0</strong> · early customer · privacy by
        design (events metadata-only)
      </footer>
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
  onForceSync
}: {
  summary: Summary | null
  busy?: boolean
  onRefresh: () => void
  onForceSync: () => void
}) {
  const [drill, setDrill] = useState<string | null>(null)
  const [drillEvents, setDrillEvents] = useState<EventRow[]>([])
  const [drillBusy, setDrillBusy] = useState(false)

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

  const openDecision = async (k: string) => {
    setDrill(k)
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

  return (
    <>
      <div className="hero-card card">
        <div className="hero-copy">
          <p className="hero-kicker">OpsGate Console · V1</p>
          <h2>Vue d&apos;ensemble</h2>
          <p className="muted">
            Agents protégés, events metadata-only, packs de règles versionnés.
            Force-sync pour pousser policy / mdp / profils (poll agent ~2&nbsp;min).
          </p>
        </div>
        <button
          className="btn"
          type="button"
          disabled={busy}
          onClick={onForceSync}>
          Forcer la synchronisation
        </button>
      </div>

      <div className="card">
        <h2>Indicateurs</h2>
        <div className="grid">
          <div className="stat">
            <div className="label">Agents</div>
            <div className="value">{summary.agents}</div>
          </div>
          <div className="stat">
            <div className="label">Événements</div>
            <div className="value">{summary.events_total}</div>
          </div>
          <div className="stat">
            <div className="label">Packs publiés</div>
            <div className="value">{summary.packs_published}</div>
          </div>
          <div className="stat">
            <div className="label">Pack actif</div>
            <div className="value" style={{ fontSize: 18 }}>
              {summary.active_rules_pack?.version || "—"}
            </div>
            <div className="muted">
              {summary.active_rules_pack
                ? `${summary.active_rules_pack.rules_count} règles`
                : ""}
            </div>
          </div>
          {typeof summary.admins_count === "number" ? (
            <div className="stat">
              <div className="label">Admins</div>
              <div className="value">{summary.admins_count}</div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="card">
        <h2>Décisions utilisateur</h2>
        <p className="muted">
          Cliquez une décision pour voir les agents / sites concernés.
        </p>
        <div className="decision-grid">
          {(
            [
              ["mask_send", "Masquer & envoyer"],
              ["send_anyway", "Envoyer quand même"],
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
        {drill && (
          <div style={{ marginTop: 16 }}>
            <h3 style={{ fontSize: 14 }}>
              Détail « {drill} »{" "}
              <button
                type="button"
                className="btn secondary"
                style={{ fontSize: 11, padding: "2px 8px" }}
                onClick={() => setDrill(null)}>
                Fermer
              </button>
            </h3>
            {drillBusy ? (
              <p className="muted">Chargement…</p>
            ) : drillEvents.length === 0 ? (
              <div className="empty">Aucun event pour cette décision</div>
            ) : (
              <div className="table-wrap"><table className="table">
                <thead>
                  <tr>
                    <th>Quand</th>
                    <th>Label appareil</th>
                    <th>Sévérité</th>
                    <th>Acteur</th>
                  </tr>
                </thead>
                <tbody>
                  {drillEvents.slice(0, 50).map((e) => (
                    <tr key={e.id}>
                      <td className="muted">
                        {e.ts
                          ? new Date(e.ts).toLocaleString("fr-FR")
                          : "—"}
                      </td>
                      <td>
                        <strong>{e.device_label || "—"}</strong>
                        {e.hostname && e.hostname !== "opsgate-agent" ? (
                          <div className="muted" style={{ fontSize: 11 }}>
                            site · {e.hostname}
                          </div>
                        ) : null}
                      </td>
                      <td>
                        <span className={`badge ${e.highest_severity}`}>
                          {e.highest_severity}
                        </span>
                      </td>
                      <td className="muted" style={{ fontSize: 12 }}>
                        {e.exit_actor || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
          </div>
        )}
      </div>

      <div className="card">
        <h2>Top règles</h2>
        {summary.top_rules?.length ? (
          <div className="table-wrap"><table className="table">
            <thead>
              <tr>
                <th>Rule ID</th>
                <th>Count</th>
              </tr>
            </thead>
            <tbody>
              {summary.top_rules.map((r) => (
                <tr key={r.rule_id}>
                  <td className="mono">{r.rule_id}</td>
                  <td>{r.count}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        ) : (
          <div className="empty">
            Aucun event encore — enrôle un agent et teste un prompt.
          </div>
        )}
      </div>
    </>
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
            try {
              setApiBase(apiBase)
              const r = await api.login(email, password)
              setToken(r.token)
              onLoggedIn(r.admin)
            } catch (e) {
              setErr(String(e))
            } finally {
              setBusy(false)
            }
          }}>
          Se connecter
        </button>
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
  const [otp, setOtp] = useState("")
  const [otpNewPwd, setOtpNewPwd] = useState("")
  const [devOtp, setDevOtp] = useState<string | null>(null)
  const [recoveryHint, setRecoveryHint] = useState<string | null>(null)

  // New profile form
  const [profName, setProfName] = useState("")
  const [profDept, setProfDept] = useState("")
  const [profHosts, setProfHosts] = useState(AI_HOST_PRESETS.join("\n"))
  const [profScan, setProfScan] = useState(true)
  const [profEvents, setProfEvents] = useState(true)
  const [profProtect, setProfProtect] = useState(false)
  const [profAction, setProfAction] = useState("mask_recommend")
  const [profGroups, setProfGroups] = useState<string[]>([])
  const [editId, setEditId] = useState<string | null>(null)

  useEffect(() => {
    if (!policy) return
    setHosts((policy.enabledHosts || []).join("\n"))
    setScanUploads(!!policy.scanUploads)
    setEventReporting(!!policy.eventReporting)
    setProtectUnenroll(!!policy.protectUnenroll)
    setDefaultAction(policy.defaultAction || "mask_recommend")
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
      await api.updatePolicy({
        enabled_hosts: hosts
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean),
        scan_uploads: scanUploads,
        event_reporting: eventReporting,
        protect_unenroll: protectUnenroll,
        default_action: defaultAction
      })
      setInfo(
        "Policy org enregistrée + epoch incrémenté. Agents sous ~2 min (ou Force sync)."
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
          Action par défaut
        </label>
        <select
          className="input"
          value={defaultAction}
          onChange={(e) => setDefaultAction(e.target.value)}>
          <option value="warn">warn</option>
          <option value="mask_recommend">mask_recommend</option>
          <option value="mask_force">mask_force</option>
          <option value="block">block</option>
        </select>

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
        <textarea
          className="input"
          rows={3}
          value={profHosts}
          onChange={(e) => setProfHosts(e.target.value)}
          style={{ width: "100%", fontFamily: "ui-monospace, monospace" }}
          placeholder="hosts"
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
                  assigned_group_ids: profGroups
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
          Uniquement sur agents <strong>offline &gt; 2h</strong> (sync 15 min).
          Les postes en contact reçoivent les nouveaux mdp admin via sync — pas de
          désinscription massive si le secret fuit.
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
      <div className="card">
        <h2>Publier un pack (clone actif)</h2>
        <p className="muted">
          Clone le pack actif et retire des rule ids (séparés par virgule). Active
          immédiatement — les agents voient la nouvelle version au prochain sync
          (force-sync recommandé).
        </p>
        <div className="row" style={{ marginBottom: 10 }}>
          <input
            className="input"
            style={{ minWidth: 280 }}
            value={disableRuleId}
            onChange={(e) => onDisableRuleId(e.target.value)}
            placeholder="email-address,phone-fr"
          />
          <input
            className="input"
            style={{ minWidth: 200 }}
            value={publishNotes}
            onChange={(e) => onPublishNotes(e.target.value)}
            placeholder="notes"
          />
          <button className="btn" type="button" disabled={busy} onClick={onPublish}>
            {busy ? "…" : "Publish & activate"}
          </button>
        </div>
        <p className="muted">
          Actif : <strong>{activeVersion || "—"}</strong>
        </p>
      </div>

      <div className="card">
        <h2>Versions</h2>
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
  const [grpProfile, setGrpProfile] = useState("")

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
                <th>Policy profil</th>
                <th>LDAP id</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.id}>
                  <td>
                    <strong>{g.name}</strong>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {g.description || ""}
                    </div>
                  </td>
                  <td className="mono" style={{ fontSize: 12 }}>
                    {g.policyProfileId
                      ? profiles.find((p) => p.id === g.policyProfileId)
                          ?.name || g.policyProfileId
                      : "—"}
                  </td>
                  <td className="muted">{g.ldapExternalId || "—"}</td>
                  <td>
                    <button
                      className="btn danger"
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
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
        <div className="row" style={{ marginTop: 12 }}>
          <input
            className="input"
            value={grpName}
            onChange={(e) => setGrpName(e.target.value)}
            placeholder="Nom groupe"
          />
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
          <button
            className="btn"
            type="button"
            disabled={busy || !grpName.trim()}
            onClick={async () => {
              setBusy(true)
              try {
                await api.createGroup({
                  name: grpName.trim(),
                  policy_profile_id: grpProfile || null
                })
                setGrpName("")
                setInfo("Groupe créé")
                onReload()
              } catch (e) {
                setError(String(e))
              } finally {
                setBusy(false)
              }
            }}>
            Créer groupe
          </button>
        </div>
        <p className="muted" style={{ marginTop: 10 }}>
          Roadmap : import LDAP (mapping groupe AD → policy profil, agents auto).
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

  useEffect(() => {
    void api.licenses().then(setStats).catch(() => setStats(null))
  }, [agents])

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
          Identifiant = label appareil. Assigner / retirer une{" "}
          <strong>licence siège</strong> par agent.
        </p>
        {agents.length === 0 ? (
          <div className="empty">
            Aucun agent. Code org <code>DEMO-OPSGATE</code> ou{" "}
            <code>PERSONAL</code>.
          </div>
        ) : (
          <div className="table-wrap"><table className="table">
            <thead>
              <tr>
                <th>Label appareil</th>
                <th>Licence</th>
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

function EventsView({ events }: { events: EventRow[] }) {
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
              Extension enrôlée avec le <strong>même</strong> code org (pas
              PERSONAL)
            </li>
            <li>
              Policy → <strong>Collecte events</strong> activée, puis sync agent
            </li>
            <li>Détection réelle sur un site IA (bandeau → décision)</li>
          </ul>
        </div>
      ) : (
        <div className="table-wrap"><table className="table">
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
            {events.map((e) => (
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
                  ) : null}
                </td>
                <td>
                  {e.decision}
                  {e.source === "system" ? " · system" : ""}
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
                  {e.rule_ids?.length ? (
                    <div className="mono" style={{ fontSize: 11 }}>
                      {e.rule_ids.join(", ")}
                    </div>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </div>
  )
}
