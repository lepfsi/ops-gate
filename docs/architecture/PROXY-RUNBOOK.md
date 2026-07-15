# OpsGate Proxy — quand est-ce que ça « joue son rôle » ?

## 1. Proxy ≠ Extension (important)

| | **Extension (V1)** | **Proxy (P1–P3)** |
|--|--------------------|-------------------|
| Où | Page web (DOM) | Réseau HTTPS (MITM allowlist) |
| Warn / banner orange | **Oui** | **Non** (jamais) |
| Mask / choix utilisateur | **Oui** | **Non** |
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

### C. Navigateur **forcé** par le proxy

Ne pas utiliser le Chrome du bureau sans flags.

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  --user-data-dir="$env:TEMP\opsgate-chrome-proxy-test" `
  --proxy-server="127.0.0.1:8888" `
  --disable-quic `
  "https://chatgpt.com"
```

Sans `--proxy-server`, **aucun** trafic n’arrive au proxy → pas de log, pas d’event.

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
| `$env:OPSGATE_PROXY_MODE="enforce"` | Défaut recommandé : coupe le flux si medium/high + event `block` |
| `$env:OPSGATE_PROXY_MODE="observe"` | Journal seul + event `observe` (pas de coupure) |

```powershell
$env:OPSGATE_PROXY_MODE="enforce"
pnpm proxy:dev
```

---

## 4. Test minimal « ça marche »

1. API + proxy:dev + Chrome avec `--proxy-server`  
2. Terminal proxy doit montrer `connect` … `chatgpt.com` … `mitm_established`  
3. Dans le chat, envoie : `sk-abcdefghijklmnopqrstuvwxyz012345`  
4. Logs : `observe_detection` **ou** `enforce_block` + `events_batch_ok`  
5. MMC → Événements → ligne Proxy / observe ou block  

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
