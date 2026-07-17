# OpsGate

**Utilisez l’IA librement. Protégez vos données automatiquement.**

**Version : 1.2.x monorepo · maturité V2 functional / pre-GA** — synthèse [`docs/STATUS-V2.md`](docs/STATUS-V2.md) · cut V2 [`docs/RELEASE-v2.md`](docs/RELEASE-v2.md) · socle V1 [`docs/RELEASE-v1.md`](docs/RELEASE-v1.md)

OpsGate est une plateforme de **Data Loss Prevention légère** pour l’IA générative : extension navigateur (**Chrome / Edge / Firefox / Safari build**, Manifest V3), control plane (API + Console multi-tenant), **proxy local** multi-IA, SSO/MFA/passkeys, audit WORM.

**Statut produit** : [`docs/STATUS-V2.md`](docs/STATUS-V2.md) · **traces** : [`docs/CHANGELOG-TECHNIQUE.md`](docs/CHANGELOG-TECHNIQUE.md) · **backlog V2** : [`docs/V2-BACKLOG.md`](docs/V2-BACKLOG.md) · **V3 (après pre-GA)** : [`docs/V3-BACKLOG.md`](docs/V3-BACKLOG.md)

**Déploiement client** : [`DEPLOIEMENT-CLIENT.pdf`](docs/DEPLOIEMENT-CLIENT.pdf) · [EN](docs/DEPLOIEMENT-CLIENT-EN.pdf) · [md FR](docs/DEPLOIEMENT-CLIENT.md)  
**Décideurs (V2)** : [`DECIDEURS-V2-FR.pdf`](docs/DECIDEURS-V2-FR.pdf) · [`DECIDEURS-V2-EN.pdf`](docs/DECIDEURS-V2-EN.pdf)  
**Guides** : [`GUIDE-UTILISATEUR-V2.pdf`](docs/GUIDE-UTILISATEUR-V2.pdf) · [EN](docs/GUIDE-UTILISATEUR-V2-EN.pdf) · **Tests** : [`GUIDE-TEST-V2.pdf`](docs/GUIDE-TEST-V2.pdf)

En mode local, tout le traitement est **local**. En mode org, seules des **métadonnées** d’événements peuvent être centralisées (pas le prompt).

## Fonctionnalités (V1 + lot V2 embarqué)

- Interception des **prompts** (Entrée / bouton Envoyer)
- Interception des **uploads** : texte, **PDF/DOCX/PPTX/XLSX**, **OCR images** (Tesseract si policy)
- Détection **générale** : secrets, API keys, OpenAI/Anthropic/HF, mots de passe, PII, IBAN, cartes, Azure/GCP/Stripe, JWT, .env…
- Détection **infra** : Fortinet, Cisco, Juniper, **Huawei**, **MikroTik**, **Palo Alto**, pfSense/OPNsense, WireGuard/OpenVPN, Arista, credentials réseau
- Sites IA : ChatGPT, Claude, Gemini, **Copilot**, **Perplexity**, **DeepSeek**, **AI Studio**, Grok, etc.
- Bandeau non bloquant : masquer · envoyer quand même · détails · annuler
- **Proxy local** MITM multi-IA (MSI Windows, soft-block)
- Control plane : API + Console multi-tenant (RLS), **SSO OIDC/SAML**, **MFA TOTP**, **passkeys**, MSP
- Audit **WORM**, backup config/DB, notifs multi-canaux, export logs planifié, import CSV agents
- Journal local + activation ON/OFF
- Identité visuelle (icônes + wordmark dans `assets/`)

Détail avancement : [`docs/STATUS-V2.md`](docs/STATUS-V2.md)

## Installer en dev / test

### Chrome / Edge

```bash
pnpm install
pnpm build:chrome
# ou : pnpm build
```

1. Ouvrir `chrome://extensions` (ou `edge://extensions`)
2. Mode développeur = ON
3. **Charger l’extension non empaquetée**
4. Dossier : `build/chrome-mv3-prod`

### Firefox (121+)

```bash
pnpm build:firefox
```

1. Ouvrir `about:debugging#/runtime/this-firefox`
2. **Charger un module temporaire…**
3. Fichier : `build/firefox-mv3-prod/manifest.json`

Doc détaillée : [`docs/architecture/FIREFOX-MV3.md`](docs/architecture/FIREFOX-MV3.md)

### Publication stores (Chrome · Firefox · Safari)

```bash
pnpm store:all
# → dist/chrome-store/ · dist/firefox-amo/ · dist/safari-store/ · dist/STORES-INDEX.md

pnpm store:chrome    # CWS + MDM
pnpm store:firefox   # AMO + policies
pnpm store:safari    # prep Xcode / App Store
```

Guide unifié : [`docs/PUBLICATION-STORES.md`](docs/PUBLICATION-STORES.md)  
MDM Chrome : [`docs/architecture/CHROME-WEB-STORE-MDM.md`](docs/architecture/CHROME-WEB-STORE-MDM.md) · Firefox : [`docs/architecture/FIREFOX-AMO.md`](docs/architecture/FIREFOX-AMO.md)

> Ne chargez **pas** la racine du repo.

Hot reload :

```bash
pnpm dev              # Chrome
pnpm dev:firefox      # Firefox
```

## Tests de détection

```bash
pnpm test:rules
```

## Structure

```
src/
  background.ts          # service worker
  popup.tsx / options.tsx
  contents/ai-sites.ts   # interception sites IA
  lib/                   # detector, rules-engine, masker, banner, file-scanner
rules/rules.json         # règles configurables
```

## Sites supportés (injection content-script)

ChatGPT, Claude, Gemini/Bard, Copilot, Perplexity, DeepSeek, AI Studio, Poe, You.com, Mistral, Groq console, Grok (x.ai), HuggingFace Chat, Phind, Meta AI, Pi, Character.ai, NotebookLM — liste complète dans `package.json` / Options.

Voir aussi **packs de règles** : [`docs/RULE-PACKS.md`](docs/RULE-PACKS.md)

## Kit démo

```
docs/demo/
  SCRIPT-5MIN.md              # déroulé parlé
  PROMPTS.md                  # textes à coller
  CHECKLIST-PRESENTATEUR.md
  samples/                    # fichiers d'upload factices
```

## Architecture (v1.1+) — GO PRODUIT

Console admin + sync de règles + events opt-in (EU) ; proxy en v1.2 :

- [`docs/architecture/PRODUCT-GO-v1.1.md`](docs/architecture/PRODUCT-GO-v1.1.md) — décision  
- [`docs/architecture/PLATFORM-v1.1.md`](docs/architecture/PLATFORM-v1.1.md) — design validé  

### Packages

| Package | Rôle |
|---------|------|
| `@opsgate/engine` | Détection / masquage / règles |
| `@opsgate/api` | Control plane (`pnpm api:dev`) |
| `@opsgate/console` | Admin UI (`pnpm console:dev`) |

```bash
pnpm api:dev         # http://127.0.0.1:8787 (memory si pas de DATABASE_URL)
pnpm console:dev     # http://127.0.0.1:5173
pnpm api:smoke

# Postgres durable
docker compose up -d
# DATABASE_URL=postgres://opsgate:opsgate@127.0.0.1:5432/opsgate
```

**Guide complet Docker + API + extension** : [`docs/GUIDE-STACK-LOCALE.md`](docs/GUIDE-STACK-LOCALE.md)  
**Déploiement chez le client** : [`docs/DEPLOIEMENT-CLIENT.md`](docs/DEPLOIEMENT-CLIENT.md)  
Runbook court : [`docs/RUNBOOK-OPS.md`](docs/RUNBOOK-OPS.md)  
**V2 (functional / pre-GA)** : [`docs/STATUS-V2.md`](docs/STATUS-V2.md) · [`docs/RELEASE-v2.md`](docs/RELEASE-v2.md) · design [`docs/architecture/PLATFORM-v2.md`](docs/architecture/PLATFORM-v2.md)

Org démo : code **`DEMO-OPSGATE`**

## Spec produit

Voir **OpsGate - Spécification MVP v1.0** (Drive) et `README2.md` (notes dev).

## Hors scope / reste pre-GA

Publication réelle CWS/AMO/App Store, portal billing Stripe complet, SAML C14N exclusive stricte, OCR multilingue fr embarqué, HA multi-région — voir [`docs/STATUS-V2.md`](docs/STATUS-V2.md) · [`docs/V2-BACKLOG.md`](docs/V2-BACKLOG.md).
