import { useEffect, useState } from "react"

import type { JournalEntry, OpsGateSettings } from "~types"
import { DEFAULT_SETTINGS } from "~types"

function severityColor(s: string) {
  if (s === "high") return "#dc2626"
  if (s === "medium") return "#d97706"
  return "#2563eb"
}

function decisionLabel(d: string, source?: string) {
  const isFile = source === "file"
  switch (d) {
    case "mask_send":
      return isFile ? "Fichier masqué" : "Masqué & envoyé"
    case "send_anyway":
      return isFile ? "Fichier joint tel quel" : "Envoyé tel quel"
    case "cancel":
      return isFile ? "Fichier retiré" : "Annulé"
    default:
      return d
  }
}

function formatTime(ts: number) {
  try {
    return new Date(ts).toLocaleString("fr-FR", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit"
    })
  } catch {
    return ""
  }
}

function IndexPopup() {
  const [settings, setSettings] = useState<OpsGateSettings>(DEFAULT_SETTINGS)
  const [journal, setJournal] = useState<JournalEntry[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = async () => {
    try {
      const [s, j] = await Promise.all([
        chrome.runtime.sendMessage({ type: "GET_SETTINGS" }),
        chrome.runtime.sendMessage({ type: "GET_JOURNAL" })
      ])
      if (s?.settings) setSettings(s.settings)
      if (j?.journal) setJournal(j.journal)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  const enrolled = !!(settings.agentToken && settings.orgId)
  const hardLock = !!settings.managedLockActive

  const toggleEnabled = async () => {
    if (enrolled || hardLock) return
    const next = !settings.enabled
    const res = await chrome.runtime.sendMessage({
      type: "SET_ENABLED",
      enabled: next
    })
    if (res?.settings) setSettings(res.settings)
  }

  const clearJournal = async () => {
    if (enrolled) return
    await chrome.runtime.sendMessage({ type: "CLEAR_JOURNAL" })
    setJournal([])
  }

  const openOptions = () => {
    chrome.runtime.openOptionsPage()
  }

  return (
    <div
      style={{
        width: 360,
        minHeight: 280,
        fontFamily:
          "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
        color: "#0f172a",
        background: "#fff"
      }}>
      <header
        style={{
          padding: "14px 16px",
          borderBottom: "1px solid #e2e8f0",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12
        }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 9,
              background: "linear-gradient(145deg, #0f172a 0%, #164e63 100%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "1px solid rgba(103,232,249,0.35)",
              flexShrink: 0
            }}>
            <svg width="18" height="18" viewBox="0 0 32 32" aria-hidden="true">
              <path
                fill="none"
                stroke="#67e8f9"
                strokeWidth="2.2"
                strokeLinecap="round"
                d="M8 22V12c0-4 3.5-7 8-7s8 3 8 7v10"
              />
              <path
                fill="#67e8f9"
                d="M16 14.5c-1.8 0-3.2 1.3-3.2 3v1.2h6.4V17.5c0-1.7-1.4-3-3.2-3z"
              />
            </svg>
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, letterSpacing: "-0.02em" }}>
              OpsGate
            </div>
            <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
              {settings.mode === "local_only"
                ? "Mode local"
                : settings.orgName || "Organisation"}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
          <button
            onClick={toggleEnabled}
            disabled={enrolled || hardLock}
            title={
              hardLock
                ? "Géré par l’organisation"
                : enrolled
                  ? "Géré par l’organisation"
                  : settings.enabled
                    ? "Désactiver"
                    : "Activer"
            }
            style={{
              border: "none",
              borderRadius: 999,
              padding: "6px 12px",
              fontSize: 12,
              fontWeight: 700,
              cursor: enrolled || hardLock ? "not-allowed" : "pointer",
              opacity: enrolled || hardLock ? 0.75 : 1,
              background: settings.enabled ? "#dcfce7" : "#f1f5f9",
              color: settings.enabled ? "#166534" : "#64748b"
            }}>
            {settings.enabled ? "Actif" : "Inactif"}
          </button>
          {hardLock && (
            <span style={{ fontSize: 10, fontWeight: 700, color: "#0f766e" }}>
              Géré
            </span>
          )}
          {enrolled && !hardLock && (
            <span style={{ fontSize: 10, fontWeight: 700, color: "#64748b" }}>
              Sync…
            </span>
          )}
        </div>
      </header>

      <section style={{ padding: "12px 16px" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 8
          }}>
          <h2 style={{ margin: 0, fontSize: 13, fontWeight: 650, color: "#334155" }}>
            Journal local
          </h2>
          {journal.length > 0 && !enrolled && (
            <button
              onClick={clearJournal}
              style={{
                border: "none",
                background: "transparent",
                color: "#94a3b8",
                fontSize: 11,
                cursor: "pointer",
                fontWeight: 600
              }}>
              Effacer
            </button>
          )}
        </div>

        {loading && (
          <p style={{ fontSize: 13, color: "#94a3b8" }}>Chargement…</p>
        )}

        {!loading && journal.length === 0 && (
          <div
            style={{
              padding: 16,
              background: "#f8fafc",
              borderRadius: 10,
              fontSize: 13,
              color: "#64748b",
              lineHeight: 1.45
            }}>
            Aucune détection récente
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 320, overflowY: "auto" }}>
          {journal.slice(0, 15).map((entry) => (
            <div
              key={entry.id}
              style={{
                padding: "10px 12px",
                border: "1px solid #e2e8f0",
                borderRadius: 10,
                background: "#fff"
              }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 8,
                  marginBottom: 4
                }}>
                <span style={{ fontWeight: 650, fontSize: 12 }}>{entry.hostname}</span>
                <span style={{ fontSize: 11, color: "#94a3b8" }}>
                  {formatTime(entry.timestamp)}
                </span>
              </div>
              <div style={{ fontSize: 12, color: "#475569" }}>
                <span
                  style={{
                    color: severityColor(entry.highestSeverity),
                    fontWeight: 700
                  }}>
                  {entry.detectionCount} détection{entry.detectionCount > 1 ? "s" : ""}
                </span>
                {" · "}
                {decisionLabel(entry.decision, entry.source)}
                {entry.source === "file" ? " · 📎" : ""}
              </div>
              <div
                style={{
                  marginTop: 4,
                  fontSize: 11,
                  color: "#94a3b8",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis"
                }}>
                {entry.fileNames?.length
                  ? entry.fileNames.join(", ") + " — "
                  : ""}
                {entry.types.join(", ")}
              </div>
            </div>
          ))}
        </div>
      </section>

      <footer
        style={{
          padding: "10px 16px 14px",
          borderTop: "1px solid #f1f5f9",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center"
        }}>
        <button
          onClick={openOptions}
          style={{
            border: "1px solid #e2e8f0",
            background: "#fff",
            borderRadius: 8,
            padding: "6px 10px",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
            color: "#334155"
          }}>
          Options
        </button>
        <span style={{ fontSize: 11, color: "#94a3b8" }}>
          {hardLock ? "Géré" : enrolled ? "Organisation" : "Local"}
        </span>
      </footer>
    </div>
  )
}

export default IndexPopup
