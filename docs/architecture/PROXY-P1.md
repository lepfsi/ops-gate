# OpsGate Proxy — P1 (MITM observe allowlist)

**Statut** : P1  
**Date** : 2026-07-15  
**Prérequis** : [`PROXY-P0.md`](./PROXY-P0.md)  

---

## 1. Objectif P1

Passer de « tunnel + log hostname » à **déchiffrement TLS borné** (allowlist only) en mode **observe** : le moteur `@opsgate/engine` voit des fragments de prompts/secrets **sans modifier** le trafic.

| Livrable | Description |
|----------|-------------|
| CA locale dev | `pnpm proxy:gen-ca` → `packages/proxy/data/ca/` |
| MITM allowlist | CONNECT → TLS terminate (cert leaf signé CA) → TLS upstream |
| Observe | Scan flux client→serveur (HTTP/1.1 + H2 best-effort) + engine |
| Hors allowlist | Tunnel transparent inchangé (P0) |

### Critères done P1

- [x] Génération CA + doc install Windows (`certutil`)  
- [x] Cert dynamique par host  
- [x] MITM sur allowlist, tunnel sinon  
- [x] Logs `observe_detection` (metadata + previews redactées)  
- [x] Flag `OPSGATE_PROXY_MITM=0` pour revenir au tunnel  
- [ ] (manuel) Test navigateur chatgpt.com avec CA installée  
- [ ] (P2) Events API `source=proxy` + enroll  

---

## 2. Flux

```
Browser --CONNECT chatgpt.com:443--> Proxy
  Proxy: 200 Connection Established
  Proxy ◄──TLS──► Browser   (cert forged CN=chatgpt.com, signé OpsGate Local Dev CA)
  Proxy ◄──TLS──► chatgpt.com (cert réel, validation OK)
  Client→Server bytes : window → extract text/JSON → detectSensitiveData → log
  (pas de rewrite, pas de block en P1)
```

---

## 3. Install CA (Windows, dev)

```powershell
cd C:\Users\Utilisateur\ops-gate
pnpm proxy:gen-ca
pnpm proxy:ca-path
# puis :
certutil -addstore -user Root "C:\Users\Utilisateur\ops-gate\packages\proxy\data\ca\ca-cert.pem"
```

Redémarrer le navigateur.  
Retirer : `certutil -delstore -user Root "OpsGate Local Dev CA"`

**Ne jamais** committer `ca-key.pem` ni déployer cette CA en production.

---

## 4. Run

```powershell
cd C:\Users\Utilisateur\ops-gate
pnpm proxy:gen-ca          # une fois
# installer CA (ci-dessus)
pnpm proxy:pac
pnpm proxy:dev

# Chrome dev :
# chrome.exe --proxy-pac-url=file:///C:/Users/Utilisateur/ops-gate/packages/proxy/opsgate-proxy.pac
```

Logs attendus :

```json
{"msg":"mitm_established","host":"chatgpt.com","mode":"observe_mitm"}
{"msg":"observe_detection","rule_ids":["generic-api-key"],"highest_severity":"high"}
```

---

## 5. Limites P1 (assumées)

| Sujet | Comportement |
|-------|----------------|
| HTTP/2 | Pas de parse frame complet : scan textuel du flux décrypté |
| Corps compressés (br/gzip) | Peut manquer des matches tant que non décompressé |
| WebSockets | Pas de logique dédiée |
| Enforce (mask/block) | **P2+** |
| Events control plane | **P2** |

---

## 6. Suite P2

1. Enroll `device_type: proxy` + token device  
2. POST events `source: "proxy"` (metadata-only)  
3. Sync pack signé + `config_epoch`  
4. Policy `proxy_mode: observe | enforce`  

---

*OpsGate · Proxy P1 · coeur data-plane*
