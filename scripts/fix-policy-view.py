#!/usr/bin/env python3
from pathlib import Path

path = Path(__file__).resolve().parents[1] / "packages" / "console" / "src" / "App.tsx"
text = path.read_text(encoding="utf-8")
start = text.index("  return (\n    <>\n      {/* Policy org par défaut")
end = text.index("      {/* 3. Créer / modifier profil */}")
after = text[end:]

marker = '        <label className="field-label">Sites IA</label>'
idx = text.index(marker, start)
form_body = text[idx:end]
lines = form_body.splitlines()
while lines and lines[-1].strip() == "":
    lines.pop()
stripped = 0
while lines and lines[-1].strip() == "</div>" and stripped < 2:
    lines.pop()
    stripped += 1
fb = "\n".join(lines)

profiles_section = r"""
      {/* Policies par département (priorité type firewall) */}
      <div className="card">
        <h2>Policies par département</h2>
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
          Priorité : plus petit = plus prioritaire (comme un firewall). Désactiver
          conserve le profil sans l&apos;appliquer.
        </p>
        {sortedProfiles.length === 0 ? (
          <div className="empty">Aucun profil</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Prio</th>
                  <th>État</th>
                  <th>Nom</th>
                  <th>Dépt</th>
                  <th>Action</th>
                  <th>Hosts</th>
                  <th>Upload</th>
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
                        {(p.enabledHosts || []).length} sites
                      </span>
                    </td>
                    <td>{p.scanUploads ? "oui" : "non"}</td>
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
                                ? `Profil « ${p.name} » activé`
                                : `Profil « ${p.name} » désactivé`
                            )
                            onReload()
                          } catch (e) {
                            setError(String(e))
                          } finally {
                            setBusy(false)
                          }
                        }}>
                        {p.enabled === false ? "Activer" : "Désactiver"}
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
                        Modifier
                      </button>{" "}
                      <button
                        className="btn danger btn-sm"
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
            </table>
          </div>
        )}
      </div>

"""

new_return = f"""  return (
    <>
      {{/* Policy org par défaut : ligne distincte */}}
      <div className="card policy-default-card">
        <div className="policy-default-row">
          <div>
            <span className="policy-default-badge">Défaut</span>
            <strong style={{{{ marginLeft: 8 }}}}>Policy org par défaut</strong>
            <div className="muted" style={{{{ fontSize: 12, marginTop: 4 }}}}>
              v{{policy.version}} · epoch {{policy.configEpoch ?? " - "}} ·{{" "}}
              {{policy.defaultAction}} · {{(policy.enabledHosts || []).length}}{" "}
              sites · pack {{policy.rulesPackVersion}}
            </div>
          </div>
          <button
            type="button"
            className="btn secondary btn-sm"
            onClick={{() => setEditDefaultOpen((v) => !v)}}>
            {{editDefaultOpen ? "Masquer" : "Modifier"}}
          </button>
        </div>
        {{editDefaultOpen && (
          <div className="policy-default-editor">
            <h3 style={{{{ fontSize: "0.95rem", marginTop: 0 }}}}>
              Modifier la policy par défaut
            </h3>
{fb}
          </div>
        )}}
      </div>
{profiles_section}
"""

# Fix f-string - I used wrong braces. Write without f for JSX braces carefully.
new_return = (
    """  return (
    <>
      {/* Policy org par défaut : ligne distincte */}
      <div className="card policy-default-card">
        <div className="policy-default-row">
          <div>
            <span className="policy-default-badge">Défaut</span>
            <strong style={{ marginLeft: 8 }}>Policy org par défaut</strong>
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
            {editDefaultOpen ? "Masquer" : "Modifier"}
          </button>
        </div>
        {editDefaultOpen && (
          <div className="policy-default-editor">
            <h3 style={{ fontSize: "0.95rem", marginTop: 0 }}>
              Modifier la policy par défaut
            </h3>
"""
    + fb
    + """
          </div>
        )}
      </div>
"""
    + profiles_section
)

path.write_text(text[:start] + new_return + after, encoding="utf-8")
print("OK fixed PolicyView")
