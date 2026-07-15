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
      setErr("Code organisation requis.")
      return
    }
    if (kind === "personal" && !personalLicenseKey.trim()) {
      setErr("Clé de licence requise.")
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
        if (kind === "org" && isPers) {
          setErr("Échec d’enrôlement — mode organisation indisponible.")
          return
        }
        setMsg(
          isPers
            ? `Mode personnel activé — ${res.settings.orgName || "PERSONAL"}`
            : `Enrôlé — ${res.settings.orgName || res.settings.orgId}` +
                (res.settings.rulesPackVersion
                  ? ` · pack ${res.settings.rulesPackVersion}`
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
        setMsg(
          `Synchronisation réussie` +
            (res.settings.rulesPackVersion
              ? ` · pack ${res.settings.rulesPackVersion}`
              : "")
        )
      } else {
        if (res?.settings) setSettings(res.settings)
        setErr(
          res?.message ||
            res?.error ||
            (res?.requiresAdminPassword
              ? "Session invalide — désinscription requise."
              : "Échec de la synchronisation")
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
        setMsg(res.message || "Appareil désenrôlé.")
      } else {
        setErr(res?.message || res?.error || "Échec de la désinscription")
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
      setErr("Identifiant et mot de passe requis.")
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
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          {/* Même marque porte/bouclier que le bandeau sites IA */}
          <div
            aria-hidden
            style={{
              width: 44,
              height: 44,
              borderRadius: 10,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "linear-gradient(145deg, #0a1128 0%, #0f766e 100%)",
              boxShadow: "inset 0 0 0 1px rgba(43, 217, 197, 0.4)",
              flexShrink: 0
            }}>
            <svg width="26" height="26" viewBox="0 0 32 32">
              <path
                fill="none"
                stroke="#2bd9c5"
                strokeWidth="2"
                strokeLinecap="round"
                d="M8 22V12c0-4 3.5-7 8-7s8 3 8 7v10"
              />
              <path
                fill="#2bd9c5"
                d="M16 14.5c-1.8 0-3.2 1.3-3.2 3v1.2h6.4V17.5c0-1.7-1.4-3-3.2-3z"
              />
              <path
                fill="none"
                stroke="#e2e8f0"
                strokeWidth="1.6"
                d="M12.5 18.5h7v4.2c0 1.6-1.6 3-3.5 3s-3.5-1.4-3.5-3v-4.2z"
              />
            </svg>
          </div>
          <div>
            <h1 style={{ fontSize: 24, margin: "0 0 4px" }}>OpsGate</h1>
            <p style={{ color: "#64748b", margin: 0, fontSize: 14 }}>
              {hardLock
                ? "Géré par l’organisation"
                : softLock
                  ? "Enrôlé · synchronisation en cours"
                  : enrolled
                    ? "Appareil enrôlé"
                    : "Enrôlement · mode local"}
            </p>
          </div>
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
          <strong>Sans licence</strong> — protection inactive. Contactez votre
          administrateur.
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
          <strong>Période de grâce (24 h)</strong> — licence siège manquante.
          Contactez votre administrateur.
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
              Nom de l’appareil
            </label>
            <input
              value={deviceLabel}
              onChange={(e) => setDeviceLabel(e.target.value)}
              style={inputStyle}
              placeholder="mon-pc"
            />

            <div
              style={{
                marginTop: 18,
                padding: 14,
                borderRadius: 10,
                border: "1px solid #cbd5e1",
                background: "#f8fafc"
              }}>
              <strong style={{ fontSize: 14, color: "#0f172a" }}>
                Organisation
              </strong>
              <label style={{ ...labelStyle, marginTop: 10 }}>
                Code organisation
              </label>
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
                {busy ? "Enrôlement…" : "Enrôler"}
              </button>
            </div>

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
              <label style={{ ...labelStyle, marginTop: 10 }}>
                Clé de licence
              </label>
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
                {busy ? "Activation…" : "Activer"}
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
                {isPersonalUi ? "Personnel" : "Organisation"}
              </strong>
              <div style={{ marginTop: 6 }}>
                {settings.orgName || settings.orgId || "—"}
                {settings.rulesPackVersion
                  ? ` · pack ${settings.rulesPackVersion}`
                  : ""}
                {hardLock ? " · géré" : ""}
              </div>
            </div>
            <div style={{ fontSize: 13, color: "#334155", lineHeight: 1.55 }}>
              <div>
                Appareil : <code>{settings.deviceLabel || "—"}</code>
              </div>
              <div>
                Dernière sync :{" "}
                {settings.lastRulesSyncAt
                  ? new Date(settings.lastRulesSyncAt).toLocaleString("fr-FR")
                  : "—"}
              </div>
              {settings.lastSyncError === "revoked_remote" && (
                <div style={{ color: "#0f766e", fontWeight: 600 }}>
                  Appareil révoqué — mode local
                </div>
              )}
              {settings.lastSyncError &&
                settings.lastSyncError !== "revoked_remote" && (
                  <div style={{ color: "#b91c1c" }}>
                    Erreur de sync
                  </div>
                )}
            </div>

            <div
              style={{
                display: "flex",
                gap: 8,
                marginTop: 14,
                flexWrap: "wrap"
              }}>
              <button
                type="button"
                disabled={busy}
                onClick={onSync}
                style={btnPrimary}>
                {busy ? "…" : "Synchroniser"}
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
              <div style={{ fontWeight: 650, fontSize: 13, marginBottom: 10 }}>
                Désinscription
              </div>

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
                  <div
                    style={{
                      fontWeight: 650,
                      fontSize: 13,
                      marginBottom: 8
                    }}>
                    Identifiants administrateur
                  </div>
                  <label style={labelStyle}>Identifiant</label>
                  <input
                    type="text"
                    value={adminUsername}
                    onChange={(e) => setAdminUsername(e.target.value)}
                    style={inputStyle}
                    placeholder="Email ou label admin"
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
                      {busy ? "…" : "Confirmer"}
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
              Géré
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
          <div style={{ fontWeight: 650 }}>Extension active</div>
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
          <div style={{ fontWeight: 650 }}>Analyser les fichiers joints</div>
        </label>
        {(
          [
            ["scanConfigs", "Configurations"],
            ["scanDatabases", "Bases de données"],
            ["scanImages", "Images"],
            ["warnMedia", "Audio / vidéo"]
          ] as const
        ).map(([key, title]) => (
          <label
            key={key}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              marginTop: 12
            }}>
            <input
              type="checkbox"
              checked={
                key === "scanImages"
                  ? settings.scanImages === true
                  : key === "warnMedia"
                    ? settings.warnMedia !== false
                    : (settings as unknown as Record<string, unknown>)[key] !==
                      false
              }
              disabled={locked || settings.scanUploads === false}
              onChange={(e) =>
                void persistLocal({
                  ...settings,
                  [key]: e.target.checked
                })
              }
            />
            <div style={{ fontWeight: 650 }}>{title}</div>
          </label>
        ))}
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
          rows={12}
          style={{
            ...inputStyle,
            fontFamily: "ui-monospace, Menlo, monospace",
            minHeight: 180,
            background: locked ? "#f8fafc" : "#fff"
          }}
        />
      </section>

      <div style={{ marginTop: 20, textAlign: "center" }}>
        <button type="button" onClick={closePage} style={btnPrimary}>
          Fermer
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
