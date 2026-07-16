/**
 * Bureau concepteur DailyOps — émission de licences.
 * Accès : URL dédiée uniquement, jamais dans la nav client.
 *
 *   http://127.0.0.1:5173/?desk=vendor
 *   (ou #vendor-desk)
 *
 * Auth : clé X-OpsGate-Vendor-Key = OPSGATE_VENDOR_LICENSE_SECRET côté API.
 */
import { useCallback, useEffect, useState } from "react"

import { BrandMark } from "./BrandMark"
import { getApiBase, setApiBase } from "./api"

type Issued = {
  license_key: string
  org_code: string
  company_name: string
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

  if (!unlocked) {
    return (
      <div className="login-page">
        <div className="login-card card" style={{ maxWidth: 420 }}>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <BrandMark size={44} />
            <div>
              <h1 style={{ margin: 0, fontSize: 20 }}>Bureau concepteur</h1>
              <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                DailyOps · émission de licences (hors console client)
              </p>
            </div>
          </div>
          <p className="muted" style={{ fontSize: 13, marginTop: 16 }}>
            Cette page n’est pas liée depuis le produit client. URL réservée :
            <code className="mono"> ?desk=vendor</code>
          </p>
          <label className="field-label">URL API</label>
          <input
            className="input mono"
            value={apiUrl}
            onChange={(e) => setApiUrl(e.target.value)}
          />
          <label className="field-label">Clé vendor (secret serveur)</label>
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
                await vendorFetch("/v1/vendor/status", vendorKey.trim())
                // status is public-ish but list proves key
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
          <p className="muted" style={{ fontSize: 11, marginTop: 12 }}>
            Retour console client :{" "}
            <a href={window.location.pathname || "/"}>ouvrir sans ?desk=vendor</a>
          </p>
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
            <p>Émission de licences clients · DailyOps</p>
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

      <main className="shell-main" style={{ padding: 24, maxWidth: 960, margin: "0 auto" }}>
        {err && <p className="err">{err}</p>}
        {info && <p className="ok">{info}</p>}

        <div className="card" style={{ marginBottom: 16 }}>
          <h2 style={{ marginTop: 0 }}>Nouvelle licence</h2>
          <div className="form-stack">
            <label className="field-label">Code organisation</label>
            <input
              className="input mono"
              value={orgCode}
              onChange={(e) => setOrgCode(e.target.value.toUpperCase())}
              placeholder="ACME-2026"
            />
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
            <div className="row" style={{ gap: 12 }}>
              <div style={{ flex: 1 }}>
                <label className="field-label">Sièges</label>
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
            <label className="row" style={{ gap: 8, fontSize: 13 }}>
              <input
                type="checkbox"
                checked={provision}
                onChange={(e) => setProvision(e.target.checked)}
              />
              Créer le tenant si le code org n’existe pas
            </label>
            <button
              className="btn"
              type="button"
              disabled={
                busy || !orgCode.trim() || !company.trim() || !email.includes("@")
              }
              onClick={async () => {
                setBusy(true)
                setErr(null)
                setLastKey(null)
                try {
                  const r = await vendorFetch<{
                    license_key: string
                    tenant?: { created?: boolean; temp_password?: string | null }
                  }>("/v1/vendor/licenses", vendorKey, {
                    method: "POST",
                    body: JSON.stringify({
                      org_code: orgCode.trim(),
                      company_name: company.trim(),
                      address: address.trim(),
                      contact_email: email.trim(),
                      seats,
                      years,
                      provision_org: provision
                    })
                  })
                  setLastKey(r.license_key)
                  setInfo(
                    r.tenant?.created && r.tenant.temp_password
                      ? `Licence OK · tenant créé · mdp temp : ${r.tenant.temp_password}`
                      : "Licence générée"
                  )
                  await loadList(vendorKey)
                } catch (e) {
                  setErr(String(e))
                } finally {
                  setBusy(false)
                }
              }}>
              Générer la licence
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
              <div className="field-label">Clé à transmettre au client</div>
              <code className="mono" style={{ fontSize: 16 }}>
                {lastKey}
              </code>
              <button
                className="btn secondary"
                type="button"
                style={{ marginTop: 8 }}
                onClick={() => {
                  void navigator.clipboard.writeText(lastKey)
                  setInfo("Clé copiée")
                }}>
                Copier
              </button>
            </div>
          )}
        </div>

        <div className="card">
          <div
            className="row"
            style={{ justifyContent: "space-between", marginBottom: 8 }}>
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
            <div style={{ overflowX: "auto" }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Clé</th>
                    <th>Org</th>
                    <th>Société</th>
                    <th>Sièges</th>
                    <th>Exp.</th>
                    <th>Statut</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {list.map((row) => (
                    <tr key={row.license_key}>
                      <td className="mono" style={{ fontSize: 11 }}>
                        {row.license_key}
                      </td>
                      <td className="mono">{row.org_code}</td>
                      <td>{row.company_name}</td>
                      <td>{row.seats}</td>
                      <td>{String(row.expires_at).slice(0, 10)}</td>
                      <td>{row.status}</td>
                      <td>
                        {row.status === "active" && (
                          <button
                            className="btn danger"
                            type="button"
                            style={{ fontSize: 11, padding: "4px 8px" }}
                            disabled={busy}
                            onClick={async () => {
                              if (!confirm(`Révoquer ${row.license_key} ?`))
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
                                setInfo("Clé révoquée")
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
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
