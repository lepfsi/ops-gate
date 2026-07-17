/**
 * Bureau concepteur DailyOps - émission de licences.
 * Build: VITE_OPSGATE_VENDOR_DESK=true + URL ?desk=vendor
 * (ou dev: pnpm console:dev:vendor)
 */
import { useCallback, useEffect, useMemo, useState } from "react"

import { BrandMark } from "./BrandMark"
import { getApiBase, setApiBase } from "./api"

type Issued = {
  license_key: string
  kind?: string
  org_code: string
  company_name: string
  address?: string
  contact_email: string
  seats: number
  expires_at: string
  issued_at?: string
  status: string
}

async function vendorFetch<T>(
  path: string,
  key: string,
  init?: RequestInit
): Promise<T> {
  const base = getApiBase().replace(/\/$/, "")
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-OpsGate-Vendor-Key": key,
      ...(init?.headers || {})
    }
  })
  if (res.headers.get("content-type")?.includes("application/pdf")) {
    return res as unknown as T
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = (data as { error?: string; message?: string }) || {}
    throw new Error(err.message || err.error || `HTTP ${res.status}`)
  }
  return data as T
}

const emptyForm = () => ({
  kind: "full" as "full" | "seat_topup",
  orgCode: "",
  company: "",
  address: "",
  email: "",
  seats: 25,
  years: 1,
  provision: true
})

export default function VendorDesk() {
  const [apiUrl, setApiUrl] = useState(getApiBase())
  const [vendorKey, setVendorKey] = useState(() => {
    try {
      return sessionStorage.getItem("opsgate_vendor_key") || ""
    } catch {
      return ""
    }
  })
  const [unlocked, setUnlocked] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [lastKey, setLastKey] = useState<string | null>(null)
  const [list, setList] = useState<Issued[]>([])
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [search, setSearch] = useState("")

  const loadList = useCallback(async (key: string) => {
    const r = await vendorFetch<{ licenses: Issued[] }>(
      "/v1/vendor/licenses",
      key
    )
    setList(r.licenses || [])
  }, [])

  useEffect(() => {
    document.title = "OpsGate"
  }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return list
    return list.filter(
      (L) =>
        L.org_code?.toLowerCase().includes(q) ||
        L.company_name?.toLowerCase().includes(q) ||
        L.contact_email?.toLowerCase().includes(q) ||
        L.license_key?.toLowerCase().includes(q)
    )
  }, [list, search])

  const stats = useMemo(() => {
    const now = Date.now()
    let expiring = 0
    let full = 0
    for (const L of list) {
      if (L.kind === "full" || !L.kind) full++
      const exp = Date.parse(L.expires_at)
      if (Number.isFinite(exp) && exp - now < 30 * 86400000 && exp > now) {
        expiring++
      }
    }
    return { total: list.length, full, expiring }
  }, [list])

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const pageItems = useMemo(() => {
    const start = (page - 1) * pageSize
    return filtered.slice(start, start + pageSize)
  }, [filtered, page, pageSize])

  useEffect(() => {
    if (page > pageCount) setPage(pageCount)
  }, [page, pageCount])

  function resetForm(options?: { clearLastKey?: boolean }) {
    setForm(emptyForm())
    if (options?.clearLastKey !== false) setLastKey(null)
  }

  function closeForm() {
    resetForm()
    setFormOpen(false)
  }

  async function downloadPdf(licenseKey: string) {
    const base = getApiBase().replace(/\/$/, "")
    const res = await fetch(`${base}/v1/vendor/licenses/certificate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-OpsGate-Vendor-Key": vendorKey
      },
      body: JSON.stringify({ license_key: licenseKey })
    })
    if (!res.ok) throw new Error(`PDF HTTP ${res.status}`)
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download =
      res.headers
        .get("Content-Disposition")
        ?.match(/filename="([^"]+)"/)?.[1] || "OpsGate-Licence.pdf"
    a.click()
    URL.revokeObjectURL(url)
  }

  if (!unlocked) {
    return (
      <div className="login-page">
        <div className="login-card card" style={{ maxWidth: 400 }}>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <BrandMark size={40} />
            <div>
              <h1 style={{ margin: 0, fontSize: 18 }}>OpsGate</h1>
              <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                Accès restreint
              </p>
            </div>
          </div>
          <label className="field-label" style={{ marginTop: 18 }}>
            Serveur
          </label>
          <input
            className="input mono"
            value={apiUrl}
            onChange={(e) => setApiUrl(e.target.value)}
            autoComplete="off"
          />
          <label className="field-label">Clé d'accès</label>
          <input
            className="input mono"
            type="password"
            value={vendorKey}
            onChange={(e) => setVendorKey(e.target.value)}
            placeholder="••••••••••••"
            autoComplete="off"
          />
          {err && <p className="err">{err}</p>}
          <button
            className="btn"
            type="button"
            style={{ width: "100%", marginTop: 12 }}
            disabled={busy || vendorKey.trim().length < 12}
            onClick={async () => {
              setBusy(true)
              setErr(null)
              try {
                setApiBase(apiUrl.trim())
                await loadList(vendorKey.trim())
                try {
                  sessionStorage.setItem(
                    "opsgate_vendor_key",
                    vendorKey.trim()
                  )
                } catch {
                  /* ignore */
                }
                setUnlocked(true)
              } catch (e) {
                setErr(String(e))
              } finally {
                setBusy(false)
              }
            }}>
            Continuer
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <BrandMark size={36} />
          <div className="brand-text">
            <h1>OpsGate</h1>
            <p>Administration</p>
          </div>
        </div>
        <div className="topbar-actions">
          <button
            className="btn secondary btn-sm"
            type="button"
            onClick={() => {
              try {
                sessionStorage.removeItem("opsgate_vendor_key")
              } catch {
                /* ignore */
              }
              window.location.href = window.location.pathname || "/"
            }}>
            Quitter
          </button>
        </div>
      </header>

      <main
        className="shell-main"
        style={{ padding: 24, maxWidth: 960, margin: "0 auto" }}>
        {err && <p className="err">{err}</p>}
        {info && <p className="ok">{info}</p>}

        <div
          className="row"
          style={{
            gap: 16,
            marginBottom: 16,
            flexWrap: "wrap",
            fontSize: 13
          }}>
          <span>
            <strong>{stats.total}</strong> licence(s)
          </span>
          <span>
            <strong>{stats.full}</strong> full
          </span>
          <span
            style={{
              color: stats.expiring > 0 ? "#b45309" : undefined
            }}>
            <strong>{stats.expiring}</strong> expirent ≤ 30 j
          </span>
        </div>

        {/* Bouton ouverture formulaire */}
        {!formOpen && (
          <div className="row" style={{ marginBottom: 16, gap: 8, flexWrap: "wrap" }}>
            <button
              className="btn"
              type="button"
              onClick={() => {
                resetForm({ clearLastKey: true })
                setFormOpen(true)
                setInfo(null)
                setErr(null)
              }}>
              + Générer une licence
            </button>
            <input
              className="input"
              style={{ minWidth: 200, flex: 1 }}
              placeholder="Rechercher org, société, e-mail, clé…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setPage(1)
              }}
            />
            <button
              className="btn secondary"
              type="button"
              disabled={busy}
              onClick={() => void loadList(vendorKey)}>
              Actualiser la liste
            </button>
          </div>
        )}

        {/* Formulaire (ouvert à la demande) */}
        {formOpen && (
          <div className="card" style={{ marginBottom: 16 }}>
            <div
              className="row"
              style={{
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 8
              }}>
              <h2 style={{ margin: 0 }}>Nouvelle licence</h2>
              <button
                className="btn secondary btn-sm"
                type="button"
                onClick={closeForm}>
                Fermer
              </button>
            </div>
            <div className="form-stack">
              <label className="field-label">Type</label>
              <select
                className="input"
                value={form.kind}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    kind:
                      e.target.value === "seat_topup" ? "seat_topup" : "full"
                  }))
                }>
                <option value="full">Licence complète (full)</option>
                <option value="seat_topup">
                  Top-up sièges (+N sur org existante)
                </option>
              </select>
              <p className="muted" style={{ fontSize: 12, margin: 0 }}>
                {form.kind === "seat_topup"
                  ? "Nouvelle clé qui ajoute des sièges (sans remplacer la full)."
                  : "Licence initiale + option création tenant."}
              </p>
              <label className="field-label">Code organisation</label>
              <input
                className="input mono"
                value={form.orgCode}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    orgCode: e.target.value.toUpperCase()
                  }))
                }
                placeholder="ACME-2026"
              />
              {form.kind === "full" && (
                <>
                  <label className="field-label">Société</label>
                  <input
                    className="input"
                    value={form.company}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, company: e.target.value }))
                    }
                  />
                  <label className="field-label">Adresse</label>
                  <input
                    className="input"
                    value={form.address}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, address: e.target.value }))
                    }
                  />
                  <label className="field-label">Email contact</label>
                  <input
                    className="input"
                    type="email"
                    value={form.email}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, email: e.target.value }))
                    }
                  />
                </>
              )}
              <div className="row" style={{ gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <label className="field-label">
                    {form.kind === "seat_topup"
                      ? "Sièges à ajouter"
                      : "Sièges"}
                  </label>
                  <input
                    className="input"
                    type="number"
                    min={1}
                    value={form.seats}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        seats: Number(e.target.value) || 1
                      }))
                    }
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label className="field-label">Durée (années)</label>
                  <input
                    className="input"
                    type="number"
                    min={1}
                    max={10}
                    value={form.years}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        years: Number(e.target.value) || 1
                      }))
                    }
                  />
                </div>
              </div>
              {form.kind === "full" && (
                <label className="row" style={{ gap: 8, fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={form.provision}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, provision: e.target.checked }))
                    }
                  />
                  Créer le tenant si le code org n’existe pas (login = email /
                  mdp 0000)
                </label>
              )}
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <button
                  className="btn"
                  type="button"
                  disabled={
                    busy ||
                    !form.orgCode.trim() ||
                    (form.kind === "full" &&
                      (!form.company.trim() || !form.email.includes("@")))
                  }
                  onClick={async () => {
                    setBusy(true)
                    setErr(null)
                    setLastKey(null)
                    try {
                      const r = await vendorFetch<{
                        license_key: string
                        kind?: string
                        tenant?: {
                          created?: boolean
                          temp_password?: string | null
                          principal_email?: string
                        }
                      }>("/v1/vendor/licenses", vendorKey, {
                        method: "POST",
                        body: JSON.stringify({
                          org_code: form.orgCode.trim(),
                          company_name: form.company.trim() || undefined,
                          address: form.address.trim() || undefined,
                          contact_email: form.email.trim() || undefined,
                          seats: form.seats,
                          years: form.years,
                          provision_org:
                            form.kind === "full" && form.provision,
                          kind: form.kind,
                          send_email: false
                        })
                      })
                      setLastKey(r.license_key)
                      setInfo(
                        r.tenant?.created
                          ? `Licence OK · tenant · login ${r.tenant.principal_email || form.email} / ${r.tenant.temp_password || "0000"} · téléchargez le PDF ci-dessous`
                          : `Licence générée (${r.kind || form.kind}) · téléchargez le PDF ci-dessous`
                      )
                      await loadList(vendorKey)
                      // Ferme et vide le formulaire ; conserve la dernière clé pour le bandeau PDF
                      resetForm({ clearLastKey: false })
                      setFormOpen(false)
                      setExpandedKey(r.license_key)
                      setPage(1)
                    } catch (e) {
                      setErr(String(e))
                    } finally {
                      setBusy(false)
                    }
                  }}>
                  Générer
                </button>
                <button
                  className="btn secondary"
                  type="button"
                  onClick={closeForm}>
                  Annuler
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Bandeau post-génération : clé + PDF (formulaire déjà fermé/vidé) */}
        {lastKey && !formOpen && (
          <div
            className="card"
            style={{
              marginBottom: 16,
              borderColor: "var(--teal, #2BD9C5)",
              borderWidth: 1
            }}>
            <div className="field-label">Dernière licence générée</div>
            <code
              className="mono"
              style={{ fontSize: 14, wordBreak: "break-all" }}>
              {lastKey}
            </code>
            <div
              className="row"
              style={{ gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              <button
                className="btn secondary btn-sm"
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(lastKey)
                  setInfo("Clé copiée")
                }}>
                Copier la clé
              </button>
              <button
                className="btn btn-sm"
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true)
                  try {
                    await downloadPdf(lastKey)
                    setInfo("PDF brandé téléchargé")
                  } catch (e) {
                    setErr(String(e))
                  } finally {
                    setBusy(false)
                  }
                }}>
                Télécharger le PDF brandé
              </button>
              <button
                className="btn secondary btn-sm"
                type="button"
                onClick={() => setLastKey(null)}>
                Masquer
              </button>
            </div>
          </div>
        )}

        {/* Liste compacte + expand + pagination */}
        <div className="card">
          <div
            className="row"
            style={{
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 12,
              flexWrap: "wrap",
              gap: 8
            }}>
            <h3 style={{ margin: 0 }}>
              Licences émises{" "}
              <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>
                ({list.length})
              </span>
            </h3>
            <label className="row" style={{ gap: 6, fontSize: 13 }}>
              Par page
              <select
                className="input"
                style={{ width: 80 }}
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value) || 10)
                  setPage(1)
                }}>
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
              </select>
            </label>
          </div>

          {list.length === 0 ? (
            <p className="muted">Aucune licence. Cliquez sur « Générer une licence ».</p>
          ) : (
            <>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1.2fr 1.4fr 1.6fr 0.7fr 0.9fr",
                  gap: 8,
                  padding: "8px 12px",
                  fontSize: 11,
                  color: "var(--muted)",
                  borderBottom: "1px solid var(--line)",
                  fontWeight: 600
                }}>
                <span>Organisation</span>
                <span>Société</span>
                <span>Email</span>
                <span>Sièges</span>
                <span>Expiration</span>
              </div>
              {pageItems.map((row) => {
                const open = expandedKey === row.license_key
                return (
                  <div
                    key={row.license_key}
                    style={{
                      borderBottom: "1px solid var(--line)"
                    }}>
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedKey(open ? null : row.license_key)
                      }
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1.2fr 1.4fr 1.6fr 0.7fr 0.9fr",
                        gap: 8,
                        width: "100%",
                        textAlign: "left",
                        padding: "10px 12px",
                        border: "none",
                        background: open
                          ? "var(--surface-2)"
                          : "transparent",
                        cursor: "pointer",
                        font: "inherit",
                        color: "inherit"
                      }}>
                      <span className="mono" style={{ fontSize: 12 }}>
                        {open ? "▼ " : "▶ "}
                        {row.org_code}
                      </span>
                      <span
                        style={{
                          fontSize: 13,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap"
                        }}>
                        {row.company_name}
                      </span>
                      <span
                        style={{
                          fontSize: 12,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap"
                        }}>
                        {row.contact_email}
                      </span>
                      <span style={{ fontSize: 13 }}>{row.seats}</span>
                      <span style={{ fontSize: 12 }}>
                        {String(row.expires_at).slice(0, 10)}
                        <span className="muted"> · {row.status}</span>
                      </span>
                    </button>
                    {open && (
                      <div
                        style={{
                          padding: "12px 16px 16px",
                          background: "var(--surface-2)",
                          fontSize: 13
                        }}>
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns:
                              "repeat(auto-fill, minmax(200px, 1fr))",
                            gap: 10,
                            marginBottom: 12
                          }}>
                          <div>
                            <div className="muted" style={{ fontSize: 11 }}>
                              Clé
                            </div>
                            <code
                              className="mono"
                              style={{
                                fontSize: 12,
                                wordBreak: "break-all"
                              }}>
                              {row.license_key}
                            </code>
                          </div>
                          <div>
                            <div className="muted" style={{ fontSize: 11 }}>
                              Type
                            </div>
                            {row.kind === "seat_topup" ? "Top-up" : "Full"}
                          </div>
                          <div>
                            <div className="muted" style={{ fontSize: 11 }}>
                              Adresse
                            </div>
                            {row.address || "-"}
                          </div>
                          <div>
                            <div className="muted" style={{ fontSize: 11 }}>
                              Émise
                            </div>
                            {row.issued_at
                              ? String(row.issued_at).slice(0, 10)
                              : "-"}
                          </div>
                        </div>
                        <div
                          className="row"
                          style={{ gap: 8, flexWrap: "wrap" }}>
                          <button
                            className="btn secondary btn-sm"
                            type="button"
                            onClick={() => {
                              void navigator.clipboard.writeText(
                                row.license_key
                              )
                              setInfo("Clé copiée")
                            }}>
                            Copier clé
                          </button>
                          <button
                            className="btn btn-sm"
                            type="button"
                            disabled={busy}
                            onClick={async () => {
                              setBusy(true)
                              try {
                                await downloadPdf(row.license_key)
                                setInfo("PDF brandé téléchargé")
                              } catch (e) {
                                setErr(String(e))
                              } finally {
                                setBusy(false)
                              }
                            }}>
                            Télécharger PDF
                          </button>
                          {row.status === "active" && (
                            <button
                              className="btn danger btn-sm"
                              type="button"
                              disabled={busy}
                              onClick={async () => {
                                if (
                                  !confirm(`Révoquer ${row.license_key} ?`)
                                )
                                  return
                                setBusy(true)
                                try {
                                  await vendorFetch(
                                    "/v1/vendor/licenses/revoke",
                                    vendorKey,
                                    {
                                      method: "POST",
                                      body: JSON.stringify({
                                        license_key: row.license_key
                                      })
                                    }
                                  )
                                  setInfo("Révoquée")
                                  setExpandedKey(null)
                                  await loadList(vendorKey)
                                } catch (e) {
                                  setErr(String(e))
                                } finally {
                                  setBusy(false)
                                }
                              }}>
                              Révoquer
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}

              <div
                className="row"
                style={{
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginTop: 14,
                  flexWrap: "wrap",
                  gap: 8
                }}>
                <span className="muted" style={{ fontSize: 12 }}>
                  Page {page} / {pageCount} · {list.length} licence
                  {list.length > 1 ? "s" : ""}
                </span>
                <div className="row" style={{ gap: 6 }}>
                  <button
                    className="btn secondary btn-sm"
                    type="button"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}>
                    Précédent
                  </button>
                  <button
                    className="btn secondary btn-sm"
                    type="button"
                    disabled={page >= pageCount}
                    onClick={() =>
                      setPage((p) => Math.min(pageCount, p + 1))
                    }>
                    Suivant
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  )
}
