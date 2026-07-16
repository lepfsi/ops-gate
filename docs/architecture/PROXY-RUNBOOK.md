# OpsGate Proxy — quand est-ce que ça « joue son rôle » ?

## 1. Proxy ≠ Extension (important)

| | **Extension (V1)** | **Proxy (P1–P3)** |
|--|--------------------|-------------------|
| Où | Page web (DOM) | Réseau HTTPS (MITM allowlist) |
| Warn / banner orange | **Oui** | **Non** (jamais) |
| Mask / choix utilisateur | **Oui** (UI) | **Oui** si `OPSGATE_PROXY_SOFT_MASK=1` (on-wire rewrite) |
| Journal MMC | events `prompt` / `file` | events `source=proxy` |
| Filtre fort | selon policy | **enforce** = coupe la connexion |
| Fichiers | scan local (pdf/docx…) | texte/multipart partiel |

Donc : **tu ne verras jamais le « warn » extension via le seul proxy.**  
Pour le warn UI, l’**extension** doit être installée dans le navigateur (profil Chrome de test ou normal).

---

## 2. Checklist — tout doit être UP

Ordre recommandé (3 terminaux) :

### A. API (obligatoire pour enroll + events MMC)

```powershell
cd C:\Users\Utilisateur\ops-gate
pnpm api:dev
```

Attendu : `listening on http://127.0.0.1:8787`

⚠ `store=memory` → **redémarrer l’API = perte agents + events**.  
Après un restart API : refaire `pnpm proxy:enroll`.

### B. Proxy

```powershell
cd C:\Users\Utilisateur\ops-gate
pnpm proxy:status          # enrolled: true + ca_ready: true
# sinon :
pnpm proxy:gen-ca
certutil -addstore -user Root "C:\Users\Utilisateur\ops-gate\packages\proxy\data\ca\ca-cert.pem"
pnpm proxy:enroll
pnpm proxy:dev
```

Health :

```powershell
curl http://127.0.0.1:8888/opsgate-proxy/health
```

Attendu :

- `mitm: true`, `ca_ready: true`
- `filter_mode: "enforce"` (filtre) ou `"observe"` (journal seul)
- `enrolled` côté `pnpm proxy:status`

### C. Navigateur via le proxy

**Pourquoi les flags Chrome en pilote ?**  
Chrome n’utilise le proxy OpsGate que si le **système** (ou le profil) le configure. Sans ça, le trafic va **en direct** → aucun MITM, aucun log.

#### Option 1 — Pilote isolé (flags, profil temporaire)

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  --user-data-dir="$env:TEMP\opsgate-chrome-proxy-test" `
  --proxy-server="127.0.0.1:8888" `
  --disable-quic `
  "https://chatgpt.com"
```

#### Option 2 — Silencieux (PAC système Windows, pas de flags)

Proxy déjà lancé, puis :

```powershell
.\scripts\set-system-proxy-pac.ps1
# Désactiver :
.\scripts\set-system-proxy-pac.ps1 -Off
```

Le PAC n’envoie **que les sites IA** vers `127.0.0.1:8888` (le reste = DIRECT).  
Redémarrer Chrome/Edge une fois. Profil utilisateur normal, sans `--user-data-dir`.

#### Option 3 — Entreprise (production)

- **GPO / Intune / Chrome Enterprise** : `ProxyMode=pac_script`, `ProxyPacUrl=http://…/opsgate-proxy.pac`
- Ou proxy sortant d’entreprise qui pointe vers le module OpsGate (roadmap)

### C2. Enforce = block **par requête**, pas bannissement du site

Si des données sensibles sont détectées en **enforce** :

- seule **cette** requête (ex. envoi du prompt) reçoit un **403** ;
- la session TLS et le site restent utilisables juste après (recharge / nouvel envoi propre) ;
- ce n’est **pas** un blocage permanent du domaine.

### C3. Démarrage silencieux du proxy (sans terminal)

```powershell
.\scripts\start-proxy-silent.ps1          # fond + logs
.\scripts\start-proxy-silent.ps1 -Stop
```

**Production** : service Windows (NSSM / `sc.exe` / Task Scheduler au logon) plutôt que 3 fenêtres PowerShell — les terminaux ouverts sont le mode **dev**.

### D. Console (MMC)

```powershell
pnpm console:dev
```

Login `admin@demo.local` / `0000` (seed DEMO).  
Onglet **Événements** → Refresh après un test.  
Filtrer décision `observe` / `block` ou source `proxy`.

---

## 3. Modes proxy

| Variable | Effet |
|----------|--------|
| `$env:OPSGATE_PROXY_MODE="enforce"` | Défaut : agit si medium/high (block ou mask) |
| `$env:OPSGATE_PROXY_MODE="observe"` | Journal seul + event `observe` (pas de coupure) |
| `$env:OPSGATE_PROXY_SOFT_MASK="1"` | **On-wire** : body masqué puis forward amont + event `mask_send` |
| `$env:OPSGATE_PROXY_SOFT_MASK="local"` | 422 JSON local sans amont (h1) ; h2 → RST_STREAM |
| soft-mask unset | Soft-block **403** (h1) / **RST_STREAM** (h2) + event `block` |
| `$env:OPSGATE_PROXY_HTTP2="1"` | Défaut : ALPN h2 stream-aware |
| `$env:OPSGATE_PROXY_HTTP2="0"` | Forcer HTTP/1.1 only |

```powershell
$env:OPSGATE_PROXY_MODE="enforce"
$env:OPSGATE_PROXY_SOFT_MASK="1"
# $env:OPSGATE_PROXY_HTTP2="0"   # option : forcer h1
pnpm proxy:dev
```

---

## 4. Test minimal « ça marche »

1. API + proxy:dev + Chrome avec `--proxy-server`  
2. Terminal proxy doit montrer `connect` … `chatgpt.com` … `mitm_established`  
3. Dans le chat, envoie un secret détectable, ex. carte `4532 0151 1283 0366` ou clé `sk-proj-…`  
4. Logs : `observe_detection` **ou** `enforce_block` / `enforce_mask` / `mitm_request_soft_mask_onwire` + `events_batch_ok`  
5. MMC → Événements → ligne Proxy / observe, block ou **mask_send**  

Si étape 2 absente → Chrome n’utilise pas le proxy.  
Si 2 OK mais pas 4 → détection / contenu pas dans le flux scanné.  
Si 4 OK mais pas 5 → API redémarrée (memory) ou console pas refresh / mauvais org.

---

## 5. Ce n’est en général **pas** « cassé »

| Symptôme | Cause fréquente |
|----------|-----------------|
| Aucun log proxy | Chrome sans `--proxy-server` |
| Enroll OK mais events vides MMC | API memory redémarrée |
| Pas de banner warn | Normal sans extension |
| mitm_established mais pas de détection | Texte pas dans le flux (ou déjà chiffré côté app) |
| Certificat invalide | CA non installée (`certutil`) |

---

## 6. Rappel architecture

```
[Extension] —— warn/mask/block UI + events prompt/file
[Proxy]     —— observe/block réseau + events source=proxy
     \____________ même API / même org ____________/
```

Les deux se **complètent** ; le proxy ne remplace pas le warn de l’extension.
