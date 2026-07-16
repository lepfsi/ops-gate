# Licences clients — émission & activation

## Qui fait quoi ?

| Acteur | Où | Action |
|--------|-----|--------|
| **DailyOps (vendeur)** | Console → **Licences clients** *ou* CLI | Génère une clé `OPS-XXXX-…` + coordonnées |
| **Client (admin principal)** | Console → Paramètres → **Gestion des licences** | Colle la clé → sièges + société activés |

Ce n’est **pas** la signature Authenticode du MSI. C’est une **clé métier** liée à un `org_code`.

---

## 1. Console (recommandé)

1. Connectez-vous en **administrateur principal** sur votre control plane.
2. Menu latéral → **Licences clients**.
3. Remplir :
   - Code organisation (ex. `ACME-2026`)
   - Raison sociale, adresse, email contact
   - Nombre de sièges, durée (années) ou date d’expiration
   - Option : **Créer le tenant** si le code n’existe pas encore
4. **Générer la licence** → copier la clé `OPS-…`
5. Transmettre au client : clé + code org (+ mdp temporaire si tenant créé).

Côté client :

1. Login console de **son** org  
2. Paramètres → Gestion des licences → **Ajouter une licence**  
3. Coller `OPS-…` → Activer  

Désactiver le bureau vendeur chez un client purement consommateur :

```powershell
$env:OPSGATE_VENDOR_UI = "off"
```

---

## 2. Ligne de commande

```powershell
cd C:\Users\Utilisateur\ops-gate
$env:DATABASE_URL = "postgres://opsgate:opsgate@127.0.0.1:5432/opsgate"

pnpm license:issue -- --org ACME-2026 --company "ACME SA" --address "12 rue Exemple, Paris" --email admin@acme.example --seats 50 --expires 2027-12-31
```

Sans `DATABASE_URL` : la clé s’affiche + un SQL `INSERT` à exécuter manuellement.

---

## 3. API (automation / scripts)

Header optionnel si secret configuré :

```
X-OpsGate-Vendor-Key: <OPSGATE_VENDOR_LICENSE_SECRET ou OPSGATE_LICENSE_SECRET>
```

Ou session console principal (Bearer).

```http
POST /v1/vendor/licenses
Content-Type: application/json

{
  "org_code": "ACME-2026",
  "company_name": "ACME SA",
  "address": "12 rue Exemple, Paris",
  "contact_email": "admin@acme.example",
  "seats": 50,
  "years": 1,
  "provision_org": true
}
```

```http
GET  /v1/vendor/licenses
POST /v1/vendor/licenses/revoke  { "license_key": "OPS-…" }
GET  /v1/vendor/status
```

---

## 4. Variables d’environnement

| Variable | Rôle |
|----------|------|
| `OPSGATE_LICENSE_SECRET` | Secret HMAC licences legacy OG1 + clé header vendor |
| `OPSGATE_VENDOR_LICENSE_SECRET` | Prioritaire pour le header vendor |
| `OPSGATE_VENDOR_UI` | `off` pour masquer l’émission aux principals |

---

## 5. Flux résumé

```
[Vous] génère OPS-… (org_code + société + sièges + email)
           │
           ▼  stockée dans issued_licenses
[Client] active la clé sur son org (code doit correspondre)
           │
           ▼  licenseDisplay full + licenseSeats
[Agents] sièges assignés via groupes / manuellement
```
