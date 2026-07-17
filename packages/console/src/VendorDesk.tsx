/**
 * Bureau concepteur DailyOps — émission de licences.
 * Build: VITE_OPSGATE_VENDOR_DESK=true + URL ?desk=vendor
 */
import { useCallback, useEffect, useState } from "react"

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
  if (
    res.headers.get("content-type")?.includes("application/pdf")
  ) {
    return res as unknown as T
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = (data as { error?: string; message?: string }) || {}
    throw new Error(err.message || err.error || `HTTP ${res.status}`)
  }
  return data as T
}

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

  const [kind, setKind] = useState<"full" | "seat_topup">("full")
  const [orgCode, setOrgCode] = useState("")
  const [company, setCompany] = useState("")
  const [address, setAddress] = useState("")
  const [email, setEmail] = useState("")
  const [seats, setSeats] = useState(25)
  const [years, setYears] = useState(1)
  const [provision, setProvision] = useState(true)
  const [lastKey, setLastKey] = useState<string | null>(null)
  const [list, setList] = useState<Issued[]>([])

  const loadList = useCallback(async (key: string) => {
    const r = await vendorFetch<{ licenses: Issued[] }>(
      "/v1/vendor/licenses",
      key
    )
    setList(r.licenses || [])
  }, [])

  useEffect(() => {
    document.title = "OpsGate · Bureau concepteur"
  }, [])

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
        <div className="login-card card" style={{ maxWidth: 420 }}>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <BrandMark size={44} />
            <div>
              <h1 style={{ margin: 0, fontSize: 20 }}>Bureau concepteur</h1>
              <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                DailyOps · licences (hors produit client)
              </p>
            </div>
          </div>
          <p className="muted" style={{ fontSize: 13, marginTop: 16 }}>
            Build interne : <code>VITE_OPSGATE_VENDOR_DESK=true</code>
            <br />
            URL : <code>?desk=vendor</code>
          </p>
          <label className="field-label">URL API</label>
          <input
            className="input mono"
            value={apiUrl}
            onChange={(e) => setApiUrl(e.target.value)}
          />
          <label className="field-label">Clé vendor</label>
          <input
            className="input mono"
            type="password"
            value={vendorKey}
            onChange={(e) => setVendorKey(e.target.value)}
            placeholder="OPSGATE_VENDOR_LICENSE_SECRET"
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
            Déverrouiller
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
            <h1>OpsGate · Concepteur</h1>
            <p>Licences clients · DailyOps</p>
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
        style={{ padding: 24, maxWidth: 1100, margin: "0 auto" }}>
        {err && <p className="err">{err}</p>}
        {info && <p className="ok">{info}</p>}

        <div className="card" style={{ marginBottom: 16 }}>
          <h2 style={{ marginTop: 0 }}>Nouvelle licence</h2>
          <div className="form-stack">
            <label className="field-label">Type</label>
            <select
              className="input"
              value={kind}
              onChange={(e) =>
                setKind(e.target.value === "seat_topup" ? "seat_topup" : "full")
              }>
              <option value="full">Licence complète (full)</option>
              <option value="seat_topup">
                Top-up sièges (+N sur org existante)
              </option>
            </select>
            <p className="muted" style={{ fontSize: 12, margin: 0 }}>
              {kind === "seat_topup"
                ? "Génère une clé qui ajoute des sièges à l’org (sans remplacer la licence full)."
                : "Licence initiale : sièges + société + activation full."}
            </p>
            <label className="field-label">Code organisation</label>
            <input
              className="input mono"
              value={orgCode}
              onChange={(e) => setOrgCode(e.target.value.toUpperCase())}
              placeholder="ACME-2026"
            />
            {kind === "full" && (
              <>
                <label className="field-label">Société</label>
                <input
                  className="input"
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                />
                <label className="field-label">Adresse</label>
                <input
                  className="input"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                />
                <label className="field-label">Email contact</label>
                <input
                  className="input"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </>
            )}
            <div className="row" style={{ gap: 12 }}>
              <div style={{ flex: 1 }}>
                <label className="field-label">
                  {kind === "seat_topup" ? "Sièges à ajouter" : "Sièges"}
                </label>
                <input
                  className="input"
                  type="number"
                  min={1}
                  value={seats}
                  onChange={(e) => setSeats(Number(e.target.value) || 1)}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label className="field-label">Durée (années)</label>
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={10}
                  value={years}
                  onChange={(e) => setYears(Number(e.target.value) || 1)}
                />
              </div>
            </div>
            {kind === "full" && (
              <label className="row" style={{ gap: 8, fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={provision}
                  onChange={(e) => setProvision(e.target.checked)}
                />
                Créer le tenant si le code org n’existe pas
              </label>
            )}
            <button
              className="btn"
              type="button"
              disabled={
                busy ||
                !orgCode.trim() ||
                (kind === "full" &&
                  (!company.trim() || !email.includes("@")))
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
                    email?: { ok?: boolean; delivery?: string; error?: string }
                  }>("/v1/vendor/licenses", vendorKey, {
                    method: "POST",
                    body: JSON.stringify({
                      org_code: orgCode.trim(),
                      company_name: company.trim() || undefined,
                      address: address.trim() || undefined,
                      contact_email: email.trim() || undefined,
                      seats,
                      years,
                      provision_org: kind === "full" && provision,
                      kind,
                      send_email: true
                    })
                  })
                  setLastKey(r.license_key)
                  const loginHint =
                    r.tenant?.created
                      ? `OK · tenant · login ${r.tenant.principal_email || email} / ${r.tenant.temp_password || "0000"}`
                      : `Licence générée (${r.kind || kind})`
                  const mailHint = r.email?.ok
                    ? `· e-mail brandé envoyé (${r.email.delivery || "smtp"})`
                    : r.email?.delivery
                      ? `· e-mail: ${r.email.delivery}`
                      : "· e-mail non envoyé (configurer OPSGATE_SMTP_* sur l’API)"
                  setInfo(`${loginHint} ${mailHint}`)
                  await loadList(vendorKey)
                } catch (e) {
                  setErr(String(e))
                } finally {
                  setBusy(false)
                }
              }}>
              Générer
            </button>
          </div>
          {lastKey && (
            <div
              style={{
                marginTop: 14,
                padding: 12,
                background: "var(--surface-2)",
                borderRadius: 8
              }}>
              <div className="field-label">Clé client</div>
              <code className="mono" style={{ fontSize: 15, wordBreak: "break-all" }}>
                {lastKey}
              </code>
              <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                <button
                  className="btn secondary"
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(lastKey)
                    setInfo("Clé copiée")
                  }}>
                  Copier
                </button>
                <button
                  className="btn secondary"
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true)
                    try {
                      await downloadPdf(lastKey)
                      setInfo("PDF téléchargé")
                    } catch (e) {
                      setErr(String(e))
                    } finally {
                      setBusy(false)
                    }
                  }}>
                  Télécharger PDF
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="card">
          <div
            className="row"
            style={{
              justifyContent: "space-between",
              marginBottom: 12,
              flexWrap: "wrap",
              gap: 8
            }}>
            <h3 style={{ margin: 0 }}>Licences émises</h3>
            <button
              className="btn secondary"
              type="button"
              disabled={busy}
              onClick={() => void loadList(vendorKey)}>
              Actualiser
            </button>
          </div>
          {list.length === 0 ? (
            <p className="muted">Aucune licence.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {list.map((row) => (
                <div
                  key={row.license_key}
                  style={{
                    border: "1px solid var(--line)",
                    borderRadius: 8,
                    padding: 12,
                    background: "var(--surface-2)"
                  }}>
                  <div
                    className="row"
                    style={{
                      justifyContent: "space-between",
                      flexWrap: "wrap",
                      gap: 8
                    }}>
                    <code
                      className="mono"
                      style={{ fontSize: 13, wordBreak: "break-all" }}>
                      {row.license_key}
                    </code>
                    <span className="badge" style={{ fontSize: 11 }}>
                      {row.kind === "seat_topup" ? "top-up" : "full"} ·{" "}
                      {row.status}
                    </span>
                  </div>
                  <div
                    style={{
                      marginTop: 8,
                      fontSize: 13,
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
                      gap: 6
                    }}>
                    <div>
                      <span className="muted">Org</span>
                      <div className="mono">{row.org_code}</div>
                    </div>
                    <div>
                      <span className="muted">Société</span>
                      <div>{row.company_name}</div>
                    </div>
                    <div>
                      <span className="muted">Contact</span>
                      <div style={{ wordBreak: "break-all" }}>
                        {row.contact_email}
                      </div>
                    </div>
                    <div>
                      <span className="muted">Sièges</span>
                      <div>{row.seats}</div>
                    </div>
                    <div>
                      <span className="muted">Expiration</span>
                      <div>{String(row.expires_at).slice(0, 10)}</div>
                    </div>
                  </div>
                  <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                    <button
                      className="btn secondary btn-sm"
                      type="button"
                      onClick={() => {
                        void navigator.clipboard.writeText(row.license_key)
                        setInfo("Clé copiée")
                      }}>
                      Copier clé
                    </button>
                    <button
                      className="btn secondary btn-sm"
                      type="button"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true)
                        try {
                          await downloadPdf(row.license_key)
                        } catch (e) {
                          setErr(String(e))
                        } finally {
                          setBusy(false)
                        }
                      }}>
                      PDF / Imprimer
                    </button>
                    {row.status === "active" && (
                      <button
                        className="btn danger btn-sm"
                        type="button"
                        disabled={busy}
                        onClick={async () => {
                          if (!confirm(`Révoquer ${row.license_key} ?`)) return
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
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
