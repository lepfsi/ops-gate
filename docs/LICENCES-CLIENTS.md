# Licences clients — émission (vendeur) vs activation (client)

## Principe de séparation

| Qui | Voit / fait | Où |
|-----|-------------|-----|
| **DailyOps (vendeur / constructeur)** | **Génère** les clés `OPS-…` avec coordonnées client | **Hors** console produit : CLI ou API secrète |
| **Client final (admin org)** | **Active** une clé reçue ; voit sièges, société, expiration | Console MMC → Paramètres → **Gestion des licences** |

La console livrée au client **ne contient pas** de moteur d’émission de licences.  
Un admin client ne peut pas fabriquer de clés pour d’autres organisations.

```
[DailyOps ops]  pnpm license:issue  ou  POST /v1/vendor/licenses + secret
        │
        ▼  clé OPS-… stockée (issued_licenses)
[Client admin]  Paramètres → Licences → coller la clé
        │
        ▼  org en mode full + sièges
```

---

## Côté client final (produit vendu)

1. Recevoir de DailyOps : **code organisation** + clé `OPS-XXXX-XXXX-XXXX-XXXX`  
2. Se connecter à **sa** console (admin principal recommandé)  
3. **Paramètres → Gestion des licences → Ajouter une licence**  
4. Coller la clé → Activer  
5. Vérifier : société, email, sièges, date d’expiration (champs en lecture seule)  
6. Assigner les sièges aux agents / groupes  

Révoquer la licence full (retour essai 30 j) : même écran, **Supprimer la licence** (principal).

**Pas d’accès** à `/v1/vendor/*` depuis la session console client.

---

## Côté DailyOps (émission uniquement)

### Prérequis

- API avec Postgres (`DATABASE_URL`)  
- Secret fort (min. 12 caractères) :

```powershell
$env:OPSGATE_VENDOR_LICENSE_SECRET = "votre-secret-constructeur-long"
# ou, fallback :
$env:OPSGATE_LICENSE_SECRET = "votre-secret-constructeur-long"
```

Sans secret configuré, `POST /v1/vendor/licenses` répond `503 vendor_secret_not_configured`.

### A. CLI (recommandé au quotidien)

```powershell
cd C:\Users\Utilisateur\ops-gate
$env:DATABASE_URL = "postgres://opsgate:opsgate@127.0.0.1:5432/opsgate"

pnpm license:issue -- `
  --org ACME-2026 `
  --company "ACME SA" `
  --address "12 rue Exemple, 75008 Paris" `
  --email admin@acme.example `
  --seats 50 `
  --expires 2027-12-31
```

Sortie JSON : `key` (à envoyer au client), `payload`, `stored`.

Sans `DATABASE_URL` : la clé s’affiche + un `INSERT` SQL à exécuter sur Postgres.

### B. API HTTP (automation) — secret obligatoire

```http
POST /v1/vendor/licenses
X-OpsGate-Vendor-Key: <même valeur que OPSGATE_VENDOR_LICENSE_SECRET>
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

Autres endpoints (même header) :

| Méthode | Path | Rôle |
|---------|------|------|
| `GET` | `/v1/vendor/status` | `secret_configured`, pas de secret renvoyé |
| `GET` | `/v1/vendor/licenses` | Liste des clés émises |
| `POST` | `/v1/vendor/licenses/revoke` | `{ "license_key": "OPS-…" }` |

`provision_org: true` : crée le tenant (org + policy + pack + admin) **si** le `org_code` n’existe pas encore ; renvoie un mdp temporaire à communiquer une seule fois.

### Exemple curl

```powershell
$env:OPSGATE_VENDOR_LICENSE_SECRET = "votre-secret-constructeur-long"
# API déjà démarrée avec le même secret

curl -s http://127.0.0.1:8787/v1/vendor/licenses `
  -H "X-OpsGate-Vendor-Key: $env:OPSGATE_VENDOR_LICENSE_SECRET" `
  -H "Content-Type: application/json" `
  -d '{
    "org_code":"ACME-2026",
    "company_name":"ACME SA",
    "address":"Paris",
    "contact_email":"admin@acme.example",
    "seats":50,
    "years":1,
    "provision_org":true
  }'
```

---

## Variables d’environnement

| Variable | Qui | Rôle |
|----------|-----|------|
| `OPSGATE_VENDOR_LICENSE_SECRET` | Serveur DailyOps | Secret d’émission (prioritaire), header `X-OpsGate-Vendor-Key` |
| `OPSGATE_LICENSE_SECRET` | Serveur DailyOps | Fallback secret + HMAC licences legacy `OG1.…` |
| `DATABASE_URL` | Serveur | Stockage `issued_licenses` + tenants |

~~`OPSGATE_VENDOR_UI`~~ : **obsolète** — plus d’onglet console d’émission.

---

## Ce que le client voit encore (normal)

- Dashboard licences / sièges  
- Paramètres → **Gestion des licences** : statut essai ou full, activation d’une clé fournie  
- Assignation de sièges aux agents  

## Ce qu’il ne voit plus / jamais

- Génération de clés  
- Liste globale des licences de tous les clients  
- Secret constructeur  
- Endpoints `/v1/vendor/*` (refusés sans secret, indépendamment du login console)

---

## Sécurité opérationnelle

1. Ne **jamais** déployer `OPSGATE_VENDOR_LICENSE_SECRET` sur une instance **hébergée chez le client** s’il gère lui-même l’API — ou le garder uniquement sur votre control plane multi-tenant.  
2. Préférer un control plane DailyOps (SaaS / MSP) : vous émettez les clés ; le client n’a que l’activation.  
3. Rotation du secret : les clés `OPS-…` déjà en base restent valides (lookup par clé stockée) ; le secret protège l’**API d’émission**, pas le format court.  
4. Révoquer une clé émise n’enlève pas automatiquement le full d’une org déjà activée : le client (ou vous en support) doit aussi **Supprimer la licence** dans Paramètres.

---

## Fichiers code

| Fichier | Rôle |
|---------|------|
| `scripts/issue-license.mjs` | CLI émission |
| `packages/api/src/license-keys.ts` | Format clé + legacy |
| `packages/api/src/app.ts` | `/v1/vendor/*` (secret) + `/v1/org/license/activate` (client) |
| Console MMC | Activation uniquement (Paramètres → Licences) |

© DailyOps.Tech — OpsGate
