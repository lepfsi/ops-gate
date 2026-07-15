# OpsGate Proxy — P2 (control plane)

**Statut** : P2  
**Date** : 2026-07-15  
**Prérequis** : [`PROXY-P0.md`](./PROXY-P0.md) · [`PROXY-P1.md`](./PROXY-P1.md)

---

## 1. Objectif P2

Brancher le proxy sur le **control plane** sans casser l’extension V1 :

| Livrable | Description |
|----------|-------------|
| Enroll | `POST /v1/enroll` avec `device_type: "proxy"` |
| Token local | `packages/proxy/data/agent.json` (gitignored) |
| Events | `POST /v1/events/batch` — `source: "proxy"`, `decision: "observe"` |
| Console | Events visibles comme les autres (filtre source) |

L’extension **continue** d’exister. Le proxy est un **2ᵉ agent** sur le même org.

---

## 2. Flux

```
Proxy observe_detection
  → queue locale (batch ≤2s / 10 events)
  → POST /v1/events/batch  Authorization: Bearer <agent_token>
  → store detection_events (source=proxy)
  → Console Events
```

---

## 3. Run

```powershell
cd C:\Users\Utilisateur\ops-gate

# Terminal A — API
pnpm api:dev

# Terminal B — proxy
pnpm proxy:gen-ca          # si besoin
pnpm proxy:enroll          # ou auto au serve
pnpm proxy:dev
pnpm proxy:status
```

Env :

| Variable | Défaut |
|----------|--------|
| `OPSGATE_API_URL` | `http://127.0.0.1:8787` |
| `OPSGATE_ORG_CODE` | `DEMO-OPSGATE` |
| `OPSGATE_PROXY_AUTO_ENROLL` | `1` |

---

## 4. Event wire

Voir [`EVENT-SCHEMA.md`](./EVENT-SCHEMA.md) — `source: proxy`, `decision: observe`, `redacted_matches` previews only.

---

## 5. Suite P3

- Installer Windows + helper PAC  
- Console : badge « Proxy enrollé », last_seen  
- Mode `enforce` (mask/block)  
- Sync pack signé côté proxy  

---

*OpsGate · Proxy P2 · control plane*
