# OpsGate Proxy — P0 (design + spike)

**Statut** : P0 en cours  
**Date** : 2026-07-15  
**Références** : [`PLATFORM-v1.1.md`](./PLATFORM-v1.1.md) §10 · [`PLATFORM-v2.md`](./PLATFORM-v2.md) Epic V2-A  

---

## 1. Objectif P0

Poser le **socle** du saut data-plane **proxy HTTPS local**, sans encore l’installer en prod ni faire du MITM TLS complet.

| Livrable | Description |
|----------|-------------|
| **Doc** | Threat model, flux PAC, stratégie TLS, hors-scope |
| **Package** | `packages/proxy` dans le monorepo |
| **Spike** | Proxy HTTP local + allowlist + logs structurés + PAC |
| **Engine** | Même `@opsgate/engine` via CLI `inspect` (chemin partagé prouvé) |

### Critères done P0

- [x] Document threat model + flux (`PROXY-P0.md`)  
- [x] `packages/proxy` buildable / runnable (`pnpm proxy:dev`)  
- [x] Listener `127.0.0.1:8888` + `/opsgate-proxy/health`  
- [x] Allowlist hosts (chatgpt, claude, gemini, grok, …)  
- [x] CONNECT : hors allowlist = tunnel ; allowlist = log *observe_tunnel*  
- [x] Fichier PAC généré (`pnpm proxy:pac`)  
- [x] `inspect` texte → détections `@opsgate/engine` (prouvé)  
- [ ] (P1) Inspection corps HTTPS sur 1 host (MITM borné)

---

## 2. Problème produit

L’extension MV3 dépend du **DOM** des sites IA. Si :

- l’UI change et casse le content-script,  
- l’utilisateur colle hors zone interceptée,  
- un client hors navigateur apparaît plus tard,

alors la détection extension ne voit plus le prompt.

Le **proxy local** est le **filet** : interception réseau **bornée** (allowlist IA), même moteur, mêmes events metadata-only.

---

## 3. Architecture cible (rappel)

```
Navigateur ──PAC──► 127.0.0.1:PORT (OpsGate Proxy)
                      │
                      ├─ host ∉ allowlist ──► tunnel direct (pas d’inspect)
                      │
                      └─ host ∈ allowlist
                            ├─ P0/P1 observe : log + (P1) parse corps JSON chat
                            └─ P2+ enforce : engine → warn/mask/block + event API
```

| Élément | Partagé avec extension |
|---------|------------------------|
| `@opsgate/engine` | Oui |
| Rule pack signé | Oui (P2) |
| Schéma DetectionEvent | Oui (`source: "proxy"`) |
| Banner UX | Non — proxy → log / notif OS / deep-link options |

---

## 4. Threat model (P0)

### 4.1 Acteurs

| Acteur | Confiance |
|--------|-----------|
| Utilisateur poste | Semi-trusted (peut désactiver PAC / proxy) |
| Process proxy local | Trusted code OpsGate |
| Sites IA allowlist | Untrusted input (corps HTTP) |
| Réseau entreprise | Untrusted |
| Control plane API | Trusted (TLS) |

### 4.2 Assets

- Metadata events (pas le prompt brut en clair en base)  
- Clés device / tokens enroll (P2)  
- Certificat TLS local de déchiffrement (P1+) — **secret machine**

### 4.3 Menaces & mitigations

| Menace | Mitigation P0→P2 |
|--------|------------------|
| Intercepter trop large (privacy) | **Allowlist stricte** hosts IA ; pas de MITM global |
| Fuite prompt vers API | Metadata-only ; jamais body complet en event |
| Cert MITM volé | Cert local user-store ; rotation ; doc ; pas d’export |
| Contournement (autre navigateur / direct) | Doc + MDM PAC (V2) ; proxy n’est **pas** un CASB |
| DoS local | Bind `127.0.0.1` only ; pas d’écoute 0.0.0.0 par défaut |
| Supply-chain règles | Pack signé ed25519 (existant) dès P2 |

### 4.4 Hors scope explicite (P0–P1)

- TUN / driver kernel  
- MITM de tout le HTTPS d’entreprise  
- Appliance réseau  
- Remplacer l’extension pour le GTM  

---

## 5. Stratégie TLS (phases)

| Phase | Comportement HTTPS |
|-------|-------------------|
| **P0 (actuel)** | `CONNECT` tunnel transparent + **log hostname** (observe passif). Pas de lecture corps. |
| **P1** | MITM **uniquement** hosts allowlist : cert CA local installé (dev) ; parse `Content-Type` JSON/text chat APIs. Mode **observe** only. |
| **P2** | + enroll API, events `source=proxy`, pack sync, mode `observe \| enforce`. |
| **P3** | Installer Windows + helper PAC one-click + console « Proxy enrollé ». |

### Pourquoi pas MITM en P0 ?

- Complexité certs (génération CA, trust store Windows).  
- Besoin de valider d’abord le **chemin monorepo**, PAC, allowlist, logs, engine.  
- Spike P0 doit tourner en 1 commande sans privilèges admin.

---

## 6. Flux PAC

### 6.1 Principe

Le navigateur demande : « pour `url`, quel proxy ? »

```javascript
// Généré par packages/proxy (exemple)
function FindProxyForURL(url, host) {
  host = host.toLowerCase();
  // Allowlist IA → proxy local
  if (host === "chatgpt.com" || dnsDomainIs(host, ".chatgpt.com"))
    return "PROXY 127.0.0.1:8888";
  if (host === "chat.openai.com" || dnsDomainIs(host, ".openai.com"))
    return "PROXY 127.0.0.1:8888";
  // Tout le reste : direct (pas de filet, pas de risque)
  return "DIRECT";
}
```

### 6.2 Config navigateur (dev)

- Chrome : Paramètres → Système → Ouvrir les paramètres proxy de l’ordinateur, **ou**  
  `--proxy-pac-url=file:///…/opsgate-proxy.pac`  
- Edge : équivalent.  
- Doc détaillée dans `packages/proxy/README.md`.

### 6.3 Alternative dev sans PAC

Variable / flag navigateur :

```text
--proxy-server=127.0.0.1:8888
```

Moins propre (tout le trafic passe au proxy ; le process **refuse d’inspecter** hors allowlist et tunnelise).

---

## 7. Package monorepo

```
packages/proxy/
  package.json          # @opsgate/proxy
  src/
    index.ts            # CLI : serve | pac | inspect
    config.ts
    allowlist.ts
    pac.ts
    proxy-server.ts     # HTTP + CONNECT
    inspect.ts          # engine
  README.md
```

Scripts racine :

```bash
pnpm proxy:dev      # démarre le spike
pnpm proxy:pac      # régénère le PAC
pnpm proxy:inspect  # pipe texte → détections
```

---

## 8. Observabilité P0

Logs **JSON lines** stdout :

```json
{"ts":"…","level":"info","msg":"connect","host":"chatgpt.com","port":443,"allowlisted":true,"mode":"observe_tunnel"}
{"ts":"…","level":"info","msg":"connect","host":"example.com","port":443,"allowlisted":false,"mode":"direct_tunnel"}
{"ts":"…","level":"info","msg":"inspect","detections":2,"highest":"high","rule_ids":["generic-api-key"]}
```

Pas d’écriture disque des corps de requête en P0.

---

## 9. Roadmap immédiate post-P0

| Phase | Livrable |
|-------|----------|
| **P1** | CA locale + MITM allowlist + parse JSON chat 1 host (chatgpt) observe |
| **P2** | Enroll `device_type: proxy`, events API, pack sync, policy `proxy_mode` |
| **P3** | Installer + console status + PAC helper |

---

## 10. Décisions produit figées en P0

1. **Bind loopback only** (`127.0.0.1`) par défaut.  
2. **Allowlist** = source de vérité (fichier config + future policy).  
3. **Un seul engine** `@opsgate/engine`.  
4. **Events metadata-only** dès la première intégration API (P2).  
5. Proxy **complète** l’extension, ne la remplace pas en V1.X.

---

*OpsGate · Proxy P0 · coeur du prochain saut data-plane*
