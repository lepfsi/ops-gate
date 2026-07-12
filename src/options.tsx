import { useCallback, useEffect, useState, type CSSProperties } from "react"

import type { OpsGateSettings } from "~types"
import { DEFAULT_SETTINGS } from "~types"

function OptionsPage() {
  const [settings, setSettings] = useState<OpsGateSettings>(DEFAULT_SETTINGS)
  const [orgCode, setOrgCode] = useState("DEMO-OPSGATE")
  const [deviceLabel, setDeviceLabel] = useState("mon-pc")
  const [personalLicenseKey, setPersonalLicenseKey] = useState(
    "OPS-PERSONAL-DEMO-2026"
  )
  const [adminUsername, setAdminUsername] = useState("")
  const [adminPassword, setAdminPassword] = useState("")
  /** true uniquement après clic sur « Désenrôler » si la policy exige un mdp */
  const [unenrollPromptOpen, setUnenrollPromptOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await chrome.runtime.sendMessage({ type: "GET_SETTINGS" })
      if (res?.settings) setSettings(res.settings)
    } catch (e) {
      console.error(e)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // À l’ouverture Options, resync policy si déjà enrollé (corrige flags events / personal)
  useEffect(() => {
    if (!settings.agentToken || !settings.orgId) return
    let cancelled = false
    void (async () => {
      try {
        const res = await chrome.runtime.sendMessage({ type: "SYNC_NOW" })
        if (!cancelled && res?.ok && res.settings) {
          setSettings(res.settings)
        }
      } catch {
        /* ignore */
      }
    })()
    return () => {
      cancelled = true
    }
    // une fois au mount / quand agent change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.agentId])

  const enrolled = !!(settings.agentToken && settings.orgId)
  /**
   * UI exclusive : si lock org actif, on n’affiche jamais le panneau personnel
   * (évite sticky personalAccount=true + managedLock en même temps).
   */
  const isPersonalUi =
    enrolled &&
    settings.personalAccount === true &&
    !settings.managedLockActive
  const isOrgUi = enrolled && !isPersonalUi
  /** Lock fort = au moins un sync org réussi (policies non modifiables) */
  const hardLock = !!settings.managedLockActive && isOrgUi
  /** Soft lock = enrôlé org mais pas encore de sync OK */
  const softLock = isOrgUi && !settings.managedLockActive
  const locked = hardLock || softLock
  /** Mdp de sortie si policy protégée + admins configurés (flag sync API) */
  const exitPasswordRequired = !!(
    isOrgUi &&
    (settings.requireUnenrollPassword ||
      (settings.protectUnenroll &&
        (settings.adminCredentials?.length ||
          settings.managementPasswordHash?.trim())))
  )

  const persistLocal = async (next: OpsGateSettings) => {
    if (locked) return
    setSettings(next)
    await chrome.runtime.sendMessage({
      type: "SET_SETTINGS",
      partial: next
    })
  }

  const runEnroll = async (kind: "org" | "personal") => {
    if (kind === "org" && !orgCode.trim()) {
      setErr("Saisissez un code organisation (ex. DEMO-OPSGATE).")
      return
    }
    if (kind === "personal" && !personalLicenseKey.trim()) {
      setErr("Saisissez une clé de licence personnelle.")
      return
    }
    setBusy(true)
    setMsg(null)
    setErr(null)
    setUnenrollPromptOpen(false)
    try {
      const res = await chrome.runtime.sendMessage({
        type: "ENROLL",
        orgCode: kind === "personal" ? "PERSONAL" : orgCode.trim(),
        deviceLabel,
        apiBaseUrl: settings.apiBaseUrl,
        // boolean strict — org = false explicite (évite sticky personnel)
        personal: kind === "personal",
        personalLicenseKey:
          kind === "personal" ? personalLicenseKey.trim() : undefined
      })
      if (res?.ok) {
        setSettings(res.settings)
        const isPers = res.settings.personalAccount === true
        const pwdOn =
          res.settings.managementPasswordHash &&
          String(res.settings.managementPasswordHash).trim().length > 0
        if (kind === "org" && isPers) {
          setErr(
            "Enroll demandé en organisation mais l’API a renvoyé un compte personnel. Vérifiez le code org et redémarrez l’API."
          )
          return
        }
        setMsg(
          `Enrôlé — ${res.settings.orgName || res.settings.orgId}` +
            (isPers ? " (personnel)" : " (organisation)") +
            `, pack ${res.settings.rulesPackVersion}.` +
            (isPers
              ? " Events cloud désactivés (privacy). Management via Options."
              : res.settings.eventReporting
                ? " Events activés → visibles console DEMO."
                : " Events off en policy — activez « Collecte events » en console.") +
            (!isPers && res.settings.managedLockActive
              ? pwdOn
                ? " Policies verrouillées ; désinscription protégée."
                : " Policies verrouillées."
              : "")
        )
      } else {
        setErr(res?.message || res?.error || "enroll_failed")
      }
    } catch (e) {
      setErr(String(e))
    } finally {
      setBusy(false)
    }
  }

  const onSync = async () => {
    setBusy(true)
    setMsg(null)
    setErr(null)
    try {
      const res = await chrome.runtime.sendMessage({ type: "SYNC_NOW" })
      if (res?.ok) {
        setSettings(res.settings)
        const pwdOn =
          res.settings.managementPasswordHash &&
          String(res.settings.managementPasswordHash).trim().length > 0
        setMsg(
          `Sync OK — pack ${res.settings.rulesPackVersion}.` +
            (pwdOn
              ? " Mdp de désinscription actif (policy)."
              : " Aucun mdp de désinscription dans la policy.")
        )
      } else {
        if (res?.settings) setSettings(res.settings)
        setErr(
          res?.message ||
            res?.error ||
            "sync_failed" +
              (res?.requiresAdminPassword
                ? " — token invalide : mdp de désinscription requis pour sortir."
                : "")
        )
      }
    } catch (e) {
      setErr(String(e))
    } finally {
      setBusy(false)
    }
  }

  const runExitOrg = async (username?: string, password?: string) => {
    setBusy(true)
    setMsg(null)
    setErr(null)
    try {
      const res = await chrome.runtime.sendMessage({
        type: "RESET_LOCAL_ORG",
        adminUsername: username,
        adminPassword: password
      })
      if (res?.ok && res.settings) {
        setSettings(res.settings)
        setAdminUsername("")
        setAdminPassword("")
        setUnenrollPromptOpen(false)
        setMsg(res.message || "Mode local_only.")
      } else {
        setErr(res?.message || res?.error || "exit_failed")
      }
    } catch (e) {
      setErr(String(e))
    } finally {
      setBusy(false)
    }
  }

  /** Clic désenrôler : username + mdp si policy l'exige */
  const onExitOrgClick = async () => {
    setMsg(null)
    setErr(null)
    if (exitPasswordRequired) {
      setUnenrollPromptOpen(true)
      return
    }
    await runExitOrg(undefined, undefined)
  }

  const onConfirmExitWithPassword = async () => {
    if (!adminUsername.trim() || !adminPassword.trim()) {
      setErr("Saisissez le nom d'utilisateur et le mot de passe.")
      return
    }
    await runExitOrg(adminUsername, adminPassword)
  }

  const closePage = () => {
    window.close()
    setTimeout(() => {
      setMsg("Vous pouvez fermer cet onglet (Ctrl+W).")
    }, 150)
  }

  return (
    <div
      style={{
        maxWidth: 640,
        margin: "40px auto",
        padding: "0 20px 48px",
        fontFamily:
          "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
        color: "#0f172a"
      }}>
      <header
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 16,
          marginBottom: 24
        }}>
        <div>
          <h1 style={{ fontSize: 24, margin: "0 0 4px" }}>OpsGate — Options</h1>
          <p style={{ color: "#64748b", margin: 0, fontSize: 14 }}>
            {hardLock
              ? "Endpoint protégé (mode org) — policies non modifiables par l’utilisateur."
              : softLock
                ? "Enrôlé — en attente du premier sync réussi (verrou policy ensuite)."
                : "Mode local. Enrolment org active la protection managée."}
          </p>
        </div>
        <button type="button" onClick={closePage} style={btnClose}>
          Fermer
        </button>
      </header>

      {settings.licenseStatus === "unlicensed" && (
        <div
          style={{
            border: "2px solid #dc2626",
            background: "#fef2f2",
            borderRadius: 12,
            padding: "12px 14px",
            marginBottom: 16,
            fontSize: 13,
            color: "#991b1b",
            lineHeight: 1.45
          }}>
          <strong style={{ color: "#dc2626" }}>UNLICENSED</strong> — aucune
          licence siège active pour cet agent. Protection désactivée après la
          grâce (5 min). Contactez votre admin OpsGate.
        </div>
      )}
      {settings.licenseStatus === "grace" && (
        <div
          style={{
            border: "1px solid #f59e0b",
            background: "#fffbeb",
            borderRadius: 12,
            padding: "12px 14px",
            marginBottom: 16,
            fontSize: 13,
            color: "#92400e",
            lineHeight: 1.45
          }}>
          <strong>Licence agent manquante — période de grâce</strong> (5 min).
          L’admin doit assigner un siège licence à cet appareil.
        </div>
      )}
      {isOrgUi && hardLock && settings.licenseStatus !== "unlicensed" && (
        <div
          style={{
            border: "1px solid #fca5a5",
            background: "#fef2f2",
            borderRadius: 12,
            padding: "12px 14px",
            marginBottom: 16,
            fontSize: 13,
            color: "#991b1b",
            lineHeight: 1.45
          }}>
          <strong>Protection endpoint active</strong> (modèle Kaspersky / Check
          Point) — mode <strong>organisation</strong>.
          <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
            <li>Policies non modifiables par l’utilisateur</li>
            <li>
              Désinscription :{" "}
              {exitPasswordRequired
                ? "username + mot de passe admin"
                : "libre (aucun mdp dans la policy)"}
            </li>
            <li>
              Hors ligne : dernière policy reste appliquée (pas de contournement
              via token mort)
            </li>
            <li>
              Events console :{" "}
              {settings.eventReporting === false
                ? "désactivés (policy)"
                : "activés"}
            </li>
          </ul>
        </div>
      )}

      <section
        style={{
          border: "1px solid #e2e8f0",
          borderRadius: 12,
          padding: 20,
          marginBottom: 16,
          background: locked ? "#f8fafc" : "#fff"
        }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Organisation</h2>
        <p style={{ fontSize: 13, color: "#64748b", marginTop: 0 }}>
          Mode : <strong>{settings.mode}</strong>
          {settings.orgName ? ` · ${settings.orgName}` : null}
          {settings.rulesPackVersion
            ? ` · pack ${settings.rulesPackVersion}`
            : " · règles embarquées"}
          {hardLock ? " · 🔒 policy lock" : null}
          {exitPasswordRequired ? " · 🔑 mdp sortie" : null}
        </p>

        {!enrolled ? (
          <>
            <label style={labelStyle}>URL API</label>
            <input
              value={settings.apiBaseUrl}
              onChange={(e) =>
                setSettings({ ...settings, apiBaseUrl: e.target.value })
              }
              onBlur={() =>
                void persistLocal({
                  ...settings,
                  apiBaseUrl: settings.apiBaseUrl
                })
              }
              style={inputStyle}
              placeholder="http://127.0.0.1:8787"
            />
            <label style={{ ...labelStyle, marginTop: 14 }}>
              Label appareil (commun)
            </label>
            <input
              value={deviceLabel}
              onChange={(e) => setDeviceLabel(e.target.value)}
              style={inputStyle}
              placeholder="mon-pc"
            />

            {/* ── Parcours organisation (events console) ── */}
            <div
              style={{
                marginTop: 18,
                padding: 14,
                borderRadius: 10,
                border: "1px solid #cbd5e1",
                background: "#f8fafc"
              }}>
              <strong style={{ fontSize: 14, color: "#0f172a" }}>
                Organisation (équipe)
              </strong>
              <p style={{ fontSize: 12, color: "#64748b", margin: "6px 0 10px" }}>
                Enrôlement <code>DEMO-OPSGATE</code> → events dans la{" "}
                <strong>console admin</strong>, policy & packs partagés.
              </p>
              <label style={labelStyle}>Code organisation</label>
              <input
                value={orgCode}
                onChange={(e) => setOrgCode(e.target.value)}
                style={inputStyle}
                placeholder="DEMO-OPSGATE"
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => void runEnroll("org")}
                style={{ ...btnPrimary, marginTop: 12, width: "100%" }}>
                {busy ? "Enrolment…" : "Enrôler dans l’organisation"}
              </button>
            </div>

            {/* ── Parcours personnel (pas d’events cloud) ── */}
            <div
              style={{
                marginTop: 12,
                padding: 14,
                borderRadius: 10,
                border: "1px solid #99f6e4",
                background: "#f0fdfa"
              }}>
              <strong style={{ fontSize: 14, color: "#134e4a" }}>
                Usage personnel
              </strong>
              <p style={{ fontSize: 12, color: "#0f766e", margin: "6px 0 10px" }}>
                Org <code>PERSONAL</code> — <strong>pas d’events</strong> vers la
                console DEMO (privacy). Gestion ici + API locale.
              </p>
              <label style={labelStyle}>Clé de licence</label>
              <input
                value={personalLicenseKey}
                onChange={(e) => setPersonalLicenseKey(e.target.value)}
                style={inputStyle}
                placeholder="OPS-PERSONAL-DEMO-2026"
                autoComplete="off"
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => void runEnroll("personal")}
                style={{
                  ...btnGhost,
                  marginTop: 12,
                  width: "100%",
                  borderColor: "#5eead4",
                  color: "#0f766e"
                }}>
                {busy ? "Enrolment…" : "Activer le mode personnel"}
              </button>
            </div>
          </>
        ) : (
          <div>
            <div
              style={{
                border: isPersonalUi ? "1px solid #99f6e4" : "1px solid #bfdbfe",
                background: isPersonalUi ? "#f0fdfa" : "#eff6ff",
                borderRadius: 10,
                padding: "12px 14px",
                marginBottom: 14,
                fontSize: 13,
                color: isPersonalUi ? "#134e4a" : "#1e3a8a",
                lineHeight: 1.5
              }}>
              <strong>
                {isPersonalUi ? "Mode personnel" : "Mode organisation"}
              </strong>
              <p style={{ margin: "6px 0 0" }}>
                Org : <code>{settings.orgName || settings.orgId || "—"}</code>
                {" · "}
                Events cloud :{" "}
                <strong>
                  {isPersonalUi
                    ? "désactivés (personnel)"
                    : settings.eventReporting === false
                      ? "désactivés (policy)"
                      : "activés"}
                </strong>
                {" · "}
                Pack : <code>{settings.rulesPackVersion || "—"}</code>
              </p>
            </div>
            {isPersonalUi ? (
              <div
                style={{
                  border: "1px solid #99f6e4",
                  background: "#f0fdfa",
                  borderRadius: 10,
                  padding: "12px 14px",
                  marginBottom: 14,
                  fontSize: 13,
                  color: "#134e4a",
                  lineHeight: 1.5
                }}>
                <strong>Abonnement personnel — console minimale</strong>
                <p style={{ margin: "8px 0 0" }}>
                  Pas de console web DEMO pour ce mode. Pour remonter des events
                  admin : désenrôlez puis{" "}
                  <strong>Enrôler dans l’organisation</strong> (
                  <code>DEMO-OPSGATE</code>).
                </p>
                <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
                  <li>Sites surveillés / scan uploads (section bas de page)</li>
                  <li>Sync des règles / pack PERSONAL</li>
                  <li>État licence : {settings.licenseStatus || "licensed"}</li>
                  <li>
                    Label appareil :{" "}
                    <code>{settings.deviceLabel || "—"}</code>
                  </li>
                </ul>
              </div>
            ) : null}
            <div style={{ fontSize: 13, color: "#334155", lineHeight: 1.55 }}>
              <div>
                Agent : <code>{settings.agentId}</code>
              </div>
              <div>
                Label : <code>{settings.deviceLabel || "—"}</code>
              </div>
              <div>
                Dernière sync :{" "}
                {settings.lastRulesSyncAt
                  ? new Date(settings.lastRulesSyncAt).toLocaleString("fr-FR")
                  : "jamais"}
              </div>
              {settings.lastSyncError && (
                <div style={{ color: "#b91c1c" }}>
                  Erreur sync : {settings.lastSyncError}
                  {hardLock
                    ? " — protection maintenue avec dernière policy."
                    : ""}
                </div>
              )}
              {settings.lastEventError && isOrgUi && (
                <div style={{ color: "#b91c1c" }}>
                  Erreur events : {settings.lastEventError}
                </div>
              )}
            </div>

            <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
              <button
                type="button"
                disabled={busy}
                onClick={onSync}
                style={btnPrimary}>
                {busy ? "Sync…" : "Synchroniser la policy"}
              </button>
              <button type="button" onClick={closePage} style={btnGhost}>
                Fermer
              </button>
            </div>

            <div
              style={{
                marginTop: 18,
                paddingTop: 16,
                borderTop: "1px solid #e2e8f0"
              }}>
              <div style={{ fontWeight: 650, fontSize: 13, marginBottom: 8 }}>
                Désinscription
              </div>
              <p style={{ fontSize: 12, color: "#64748b", margin: "0 0 10px" }}>
                {exitPasswordRequired
                  ? "Username (label ou email admin) + mot de passe requis. Recovery vendor : username « vendor » si offline > 2h."
                  : softLock
                    ? "Premier sync pas encore réussi — sortie libre."
                    : "Aucun mdp de désinscription dans la policy — sortie libre."}
              </p>

              {!unenrollPromptOpen ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void onExitOrgClick()}
                  style={{
                    ...btnGhost,
                    borderColor: "#fecaca",
                    color: "#b91c1b"
                  }}>
                  Désenrôler cet appareil
                </button>
              ) : (
                <div
                  style={{
                    border: "1px solid #fecaca",
                    background: "#fff7f7",
                    borderRadius: 10,
                    padding: 14
                  }}>
                  <div style={{ fontWeight: 650, fontSize: 13, marginBottom: 8 }}>
                    Confirmer la désinscription
                  </div>
                  <label style={labelStyle}>Nom d&apos;utilisateur</label>
                  <input
                    type="text"
                    value={adminUsername}
                    onChange={(e) => setAdminUsername(e.target.value)}
                    style={inputStyle}
                    placeholder="Administrator ou email admin"
                    autoComplete="username"
                    autoFocus
                  />
                  <label style={{ ...labelStyle, marginTop: 10 }}>
                    Mot de passe
                  </label>
                  <input
                    type="password"
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                    style={inputStyle}
                    placeholder="Mot de passe"
                    autoComplete="current-password"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        void onConfirmExitWithPassword()
                      }
                    }}
                  />
                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      marginTop: 12,
                      flexWrap: "wrap"
                    }}>
                    <button
                      type="button"
                      disabled={
                        busy ||
                        !adminUsername.trim() ||
                        !adminPassword.trim()
                      }
                      onClick={() => void onConfirmExitWithPassword()}
                      style={{
                        ...btnPrimary,
                        background: "#b91c1c"
                      }}>
                      {busy ? "…" : "Confirmer et désenrôler"}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setUnenrollPromptOpen(false)
                        setAdminUsername("")
                        setAdminPassword("")
                        setErr(null)
                      }}
                      style={btnGhost}>
                      Annuler
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {msg && (
          <p style={{ color: "#166534", fontWeight: 600, fontSize: 13 }}>
            {msg}
          </p>
        )}
        {err && (
          <p style={{ color: "#b91c1c", fontWeight: 600, fontSize: 13 }}>
            {err}
          </p>
        )}
      </section>

      <section
        style={{
          border: "1px solid #e2e8f0",
          borderRadius: 12,
          padding: 20,
          marginBottom: 16,
          opacity: locked ? 0.5 : 1,
          pointerEvents: locked ? "none" : "auto"
        }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginBottom: 12
          }}>
          <h2 style={{ fontSize: 15, margin: 0 }}>Réglages locaux</h2>
          {locked && (
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: "#991b1b",
                background: "#fee2e2",
                padding: "3px 8px",
                borderRadius: 999
              }}>
              Verrouillé
            </span>
          )}
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <input
            type="checkbox"
            checked={settings.enabled}
            disabled={locked}
            onChange={(e) =>
              void persistLocal({ ...settings, enabled: e.target.checked })
            }
          />
          <div>
            <div style={{ fontWeight: 650 }}>Extension active</div>
            <div style={{ fontSize: 13, color: "#64748b" }}>
              Désactivation interdite en mode géré
            </div>
          </div>
        </label>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginTop: 16,
            paddingTop: 16,
            borderTop: "1px solid #f1f5f9"
          }}>
          <input
            type="checkbox"
            checked={settings.scanUploads !== false}
            disabled={locked}
            onChange={(e) =>
              void persistLocal({ ...settings, scanUploads: e.target.checked })
            }
          />
          <div>
            <div style={{ fontWeight: 650 }}>Scanner les uploads</div>
            <div style={{ fontSize: 13, color: "#64748b" }}>Policy org</div>
          </div>
        </label>
      </section>

      <section
        style={{
          border: "1px solid #e2e8f0",
          borderRadius: 12,
          padding: 20,
          opacity: locked ? 0.5 : 1,
          pointerEvents: locked ? "none" : "auto"
        }}>
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Sites surveillés</h2>
        <textarea
          value={settings.enabledHosts.join("\n")}
          disabled={locked}
          readOnly={locked}
          onChange={(e) =>
            setSettings({
              ...settings,
              enabledHosts: e.target.value
                .split("\n")
                .map((l) => l.trim())
                .filter(Boolean)
            })
          }
          onBlur={() => {
            if (!locked) void persistLocal(settings)
          }}
          rows={5}
          style={{
            ...inputStyle,
            fontFamily: "ui-monospace, Menlo, monospace",
            minHeight: 100,
            background: locked ? "#f8fafc" : "#fff"
          }}
        />
      </section>

      <div style={{ marginTop: 20, textAlign: "center" }}>
        <button type="button" onClick={closePage} style={btnPrimary}>
          Fermer cette page
        </button>
      </div>
    </div>
  )
}

const labelStyle: CSSProperties = {
  display: "block",
  fontSize: 13,
  fontWeight: 600,
  marginBottom: 6
}

const inputStyle: CSSProperties = {
  width: "100%",
  fontSize: 13,
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid #cbd5e1",
  boxSizing: "border-box"
}

const btnPrimary: CSSProperties = {
  border: "none",
  borderRadius: 8,
  padding: "10px 14px",
  fontSize: 13,
  fontWeight: 650,
  cursor: "pointer",
  background: "#0f172a",
  color: "#fff"
}

const btnGhost: CSSProperties = {
  border: "1px solid #cbd5e1",
  borderRadius: 8,
  padding: "10px 14px",
  fontSize: 13,
  fontWeight: 650,
  cursor: "pointer",
  background: "#fff",
  color: "#334155"
}

const btnClose: CSSProperties = { ...btnGhost, flexShrink: 0 }

export default OptionsPage
