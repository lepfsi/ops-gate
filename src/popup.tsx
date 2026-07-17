import { useEffect, useState } from "react"

import { ext } from "~lib/browser-api"
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
    case "secure_rewrite":
      return isFile ? "Fichier Secure Rewrite" : "Secure Rewrite"
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
  const [contactOpen, setContactOpen] = useState(false)
  const [subject, setSubject] = useState("")
  const [body, setBody] = useState("")
  const [category, setCategory] = useState<
    "question" | "exception" | "block_appeal" | "other"
  >("question")
  const [contactBusy, setContactBusy] = useState(false)
  const [contactMsg, setContactMsg] = useState<string | null>(null)
  const [contactErr, setContactErr] = useState<string | null>(null)
  const [myMessages, setMyMessages] = useState<
    Array<{
      id: string
      subject: string
      status: string
      created_at: string
      body?: string
      admin_reply?: string | null
      needs_user_ack?: boolean
      replied_by_admin_label?: string | null
    }>
  >([])
  const [ackBusy, setAckBusy] = useState(false)

  const refresh = async () => {
    try {
      const [s, j] = await Promise.all([
        ext.runtime.sendMessage({ type: "GET_SETTINGS" }),
        ext.runtime.sendMessage({ type: "GET_JOURNAL" })
      ])
      if (s?.settings) setSettings(s.settings)
      if (j?.journal) setJournal(j.journal)
      if (s?.settings?.agentToken && s?.settings?.orgId) {
        const m = await ext.runtime.sendMessage({ type: "LIST_ADMIN_MESSAGES" })
        if (m?.ok && m.messages) setMyMessages(m.messages)
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  const pendingAcks = myMessages.filter(
    (m) => !!m.admin_reply && m.needs_user_ack === true
  )

  useEffect(() => {
    void refresh()
  }, [])

  const enrolled = !!(settings.agentToken && settings.orgId)
  const hardLock = !!settings.managedLockActive

  const toggleEnabled = async () => {
    if (enrolled || hardLock) return
    const next = !settings.enabled
    const res = await ext.runtime.sendMessage({
      type: "SET_ENABLED",
      enabled: next
    })
    if (res?.settings) setSettings(res.settings)
  }

  const clearJournal = async () => {
    if (enrolled) return
    await ext.runtime.sendMessage({ type: "CLEAR_JOURNAL" })
    setJournal([])
  }

  const openOptions = () => {
    ext.runtime.openOptionsPage()
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
              background: "linear-gradient(145deg, #0a1128 0%, #0f766e 100%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "inset 0 0 0 1px rgba(43, 217, 197, 0.4)",
              flexShrink: 0
            }}>
            <svg width="18" height="18" viewBox="0 0 32 32" aria-hidden="true">
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

      {pendingAcks.length > 0 && (
        <section style={{ padding: "12px 16px 0" }}>
          {pendingAcks.slice(0, 2).map((m) => (
            <div
              key={m.id}
              style={{
                padding: 12,
                marginBottom: 10,
                borderRadius: 10,
                border: "1px solid #99f6e4",
                background: "#f0fdfa"
              }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "#0f766e",
                  marginBottom: 4
                }}>
                Réponse admin
                {m.replied_by_admin_label ? ` · ${m.replied_by_admin_label}` : ""}
              </div>
              <div style={{ fontWeight: 650, fontSize: 13, marginBottom: 6 }}>
                {m.subject}
              </div>
              <div
                style={{
                  fontSize: 12,
                  lineHeight: 1.45,
                  color: "#0f172a",
                  whiteSpace: "pre-wrap",
                  marginBottom: 10
                }}>
                {m.admin_reply}
              </div>
              <button
                type="button"
                disabled={ackBusy}
                onClick={async () => {
                  setAckBusy(true)
                  try {
                    await ext.runtime.sendMessage({
                      type: "ACK_ADMIN_REPLY",
                      messageId: m.id
                    })
                    await refresh()
                  } finally {
                    setAckBusy(false)
                  }
                }}
                style={{
                  border: "none",
                  borderRadius: 8,
                  padding: "8px 12px",
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: "pointer",
                  background: "#0a1128",
                  color: "#fff",
                  width: "100%"
                }}>
                OK, j'ai compris
              </button>
            </div>
          ))}
        </section>
      )}

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

      {enrolled && (
        <section
          style={{
            padding: "0 16px 12px",
            borderTop: "1px solid #f1f5f9"
          }}>
          <button
            type="button"
            onClick={() => {
              setContactOpen((v) => !v)
              setContactMsg(null)
              setContactErr(null)
            }}
            style={{
              width: "100%",
              marginTop: 10,
              border: "1px solid #99f6e4",
              background: contactOpen ? "#f0fdfa" : "#fff",
              borderRadius: 8,
              padding: "8px 10px",
              fontSize: 12,
              fontWeight: 650,
              cursor: "pointer",
              color: "#0f766e",
              textAlign: "left"
            }}>
            {contactOpen ? "▼ " : "▶ "}Contacter l’administrateur
          </button>
          {contactOpen && (
            <div style={{ marginTop: 10 }}>
              <label
                style={{
                  display: "block",
                  fontSize: 11,
                  fontWeight: 600,
                  color: "#64748b",
                  marginBottom: 4
                }}>
                Type
              </label>
              <select
                value={category}
                onChange={(e) =>
                  setCategory(
                    e.target.value as
                      | "question"
                      | "exception"
                      | "block_appeal"
                      | "other"
                  )
                }
                style={{
                  width: "100%",
                  marginBottom: 8,
                  padding: "6px 8px",
                  borderRadius: 6,
                  border: "1px solid #e2e8f0",
                  fontSize: 12
                }}>
                <option value="question">Question</option>
                <option value="exception">Demande d’exception</option>
                <option value="block_appeal">Contestation de blocage</option>
                <option value="other">Autre</option>
              </select>
              <label
                style={{
                  display: "block",
                  fontSize: 11,
                  fontWeight: 600,
                  color: "#64748b",
                  marginBottom: 4
                }}>
                Objet
              </label>
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Ex. Besoin d’accès temporaire"
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  marginBottom: 8,
                  padding: "6px 8px",
                  borderRadius: 6,
                  border: "1px solid #e2e8f0",
                  fontSize: 12
                }}
              />
              <label
                style={{
                  display: "block",
                  fontSize: 11,
                  fontWeight: 600,
                  color: "#64748b",
                  marginBottom: 4
                }}>
                Message
              </label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={3}
                placeholder="Décrivez votre besoin pour l’admin…"
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  marginBottom: 8,
                  padding: "6px 8px",
                  borderRadius: 6,
                  border: "1px solid #e2e8f0",
                  fontSize: 12,
                  resize: "vertical"
                }}
              />
              {contactErr && (
                <p style={{ fontSize: 12, color: "#dc2626", margin: "0 0 6px" }}>
                  {contactErr}
                </p>
              )}
              {contactMsg && (
                <p style={{ fontSize: 12, color: "#166534", margin: "0 0 6px" }}>
                  {contactMsg}
                </p>
              )}
              <button
                type="button"
                disabled={
                  contactBusy ||
                  subject.trim().length < 3 ||
                  body.trim().length < 5
                }
                onClick={async () => {
                  setContactBusy(true)
                  setContactErr(null)
                  setContactMsg(null)
                  try {
                    const r = await ext.runtime.sendMessage({
                      type: "CONTACT_ADMIN",
                      subject: subject.trim(),
                      body: body.trim(),
                      category
                    })
                    if (r?.ok) {
                      setContactMsg("Message envoyé à l’administrateur.")
                      setSubject("")
                      setBody("")
                      const m = await ext.runtime.sendMessage({
                        type: "LIST_ADMIN_MESSAGES"
                      })
                      if (m?.ok && m.messages) setMyMessages(m.messages)
                    } else {
                      setContactErr(r?.error || "Échec d’envoi")
                    }
                  } catch (e) {
                    setContactErr(String(e))
                  } finally {
                    setContactBusy(false)
                  }
                }}
                style={{
                  width: "100%",
                  border: "none",
                  borderRadius: 8,
                  padding: "8px 10px",
                  fontSize: 12,
                  fontWeight: 700,
                  cursor:
                    contactBusy || subject.trim().length < 3
                      ? "not-allowed"
                      : "pointer",
                  background: "#0f766e",
                  color: "#fff",
                  opacity:
                    contactBusy ||
                    subject.trim().length < 3 ||
                    body.trim().length < 5
                      ? 0.6
                      : 1
                }}>
                {contactBusy ? "Envoi…" : "Envoyer à l’admin"}
              </button>
              {myMessages.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 650,
                      color: "#64748b",
                      marginBottom: 6
                    }}>
                    Vos derniers messages
                  </div>
                  {myMessages.slice(0, 5).map((m) => (
                    <div
                      key={m.id}
                      style={{
                        padding: "8px 10px",
                        border: "1px solid #e2e8f0",
                        borderRadius: 8,
                        marginBottom: 6,
                        fontSize: 11,
                        background: "#fff"
                      }}>
                      <div style={{ fontWeight: 650 }}>{m.subject}</div>
                      <div style={{ color: "#94a3b8", marginTop: 2 }}>
                        {String(m.created_at).slice(0, 16).replace("T", " ")} ·{" "}
                        {m.status}
                      </div>
                      {m.admin_reply && (
                        <div
                          style={{
                            marginTop: 6,
                            padding: 6,
                            background: "#f0fdfa",
                            borderRadius: 6,
                            color: "#0f766e"
                          }}>
                          Admin : {m.admin_reply}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      )}

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
