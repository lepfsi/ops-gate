# OpsGate Proxy — P3 foundations

**Statut** : fondations (pas encore installer MSI / enforce réel)  
**Date** : 2026-07-15  
**Prérequis** : P0–P2 livrés  

---

## 1. Objectif P3 (cible produit)

| Livrable | Statut fondations | Statut complet |
|----------|-------------------|----------------|
| Badge console « Proxy » | **Oui** (`device_type`) | — |
| `device_type` en base | **Oui** | — |
| Flags org `proxy.mode` observe/enforce | **Oui** (config agent) | Enforce réel = suite |
| Sync config / heartbeat | **Oui** (poll 2 min) | — |
| Helper install Windows (dev) | **Oui** (script PS1) | MSI signé = suite |
| Mode enforce mask/block | **Stub log only** | Suite P3.1 |
| Pack signé côté proxy | **epoch + version exposés** | Vérif ed25519 = suite |

---

## 2. Modèle

```
Agent {
  device_type: "extension" | "proxy"
}

OrgMonitoring.proxy {
  enabled: boolean
  mode: "observe" | "enforce"   // enforce = stub P3
}

GET /v1/agents/me/config → {
  proxy: { enabled, mode },
  policy: { config_epoch, enabled_hosts, ... },
  rules_pack: { version, ... }
}
```

---

## 3. Console

Liste Agents : badge **Proxy** si `device_type === "proxy"` (ou `app_version` préfixé `proxy`).

---

## 4. Helper install dev

```powershell
cd C:\Users\Utilisateur\ops-gate
.\scripts\install-proxy-windows.ps1
```

Actions : `proxy:gen-ca`, hint `certutil`, rappel PAC / Chrome flags.  
**Pas** un MSI enterprise (plus tard).

---

## 5. Suite P3.1 / P3.2

1. Enforce : réécrire / bloquer requêtes chat (très sensible, host par host)  
2. Vérif pack ed25519 dans le process proxy  
3. Installer MSIX/MSI + service Windows  
4. Dashboard KPI « proxies online »  

---

*OpsGate · Proxy P3 foundations*
