# OpsGate

**Utilisez l’IA librement. Protégez vos données automatiquement.**

**Version : 1.2.0 (V1 early-customer)** — voir [`docs/RELEASE-v1.md`](docs/RELEASE-v1.md) · pilote [`docs/RELEASE-v1.1.md`](docs/RELEASE-v1.1.md)

OpsGate est une extension navigateur (**Chrome / Edge / Firefox**, Manifest V3) de **Data Loss Prevention légère** pour ChatGPT, Claude et Gemini, avec control plane optionnel (API + Console) et **proxy local** multi-IA.

**Traces techniques (ne pas s’égarer)** : [`docs/CHANGELOG-TECHNIQUE.md`](docs/CHANGELOG-TECHNIQUE.md) · roadmap [`docs/V2-BACKLOG.md`](docs/V2-BACKLOG.md)

En mode local, tout le traitement est **local**. En mode org, seules des **métadonnées** d’événements peuvent être centralisées (pas le prompt).

## Fonctionnalités (V1 / 1.2)

- Interception des **prompts** (Entrée / bouton Envoyer)
- Interception des **uploads** (fichiers texte) avec quarantaine avant jointure
- Détection **générale** : secrets, API keys, OpenAI/Anthropic/HF, mots de passe, PII, IBAN, cartes, Azure/GCP/Stripe, JWT, .env…
- Détection **infra** : Fortinet, Cisco, Juniper, **Huawei**, **MikroTik**, **Palo Alto**, pfSense/OPNsense, WireGuard/OpenVPN, Arista, credentials réseau
- Sites IA : ChatGPT, Claude, Gemini, **Copilot**, **Perplexity**, **DeepSeek**, **AI Studio**
- Bandeau non bloquant : masquer · envoyer quand même · détails · annuler
- Control plane : API + Console + Postgres durable (admins, profils, licences)
- Journal local + activation ON/OFF
- Identité visuelle (icônes + wordmark dans `assets/`)

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

### Chrome Web Store + MDM

```bash
pnpm store:chrome
# → dist/chrome-store/opsgate-*-chrome.zip + policies MDM
```

Voir [`docs/architecture/CHROME-WEB-STORE-MDM.md`](docs/architecture/CHROME-WEB-STORE-MDM.md).

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
Runbook court : [`docs/RUNBOOK-OPS.md`](docs/RUNBOOK-OPS.md)  
**V2 (draft)** — proxy, SSO, MFA, multi-tenant, Chrome Store : [`docs/architecture/PLATFORM-v2.md`](docs/architecture/PLATFORM-v2.md) · [`docs/RELEASE-v2.md`](docs/RELEASE-v2.md)

Org démo : code **`DEMO-OPSGATE`**

## Spec produit

Voir **OpsGate - Spécification MVP v1.0** (Drive) et `README2.md` (notes dev).

## Hors scope V1

Proxy local, SSO SAML/OIDC, portal personnel cloud, LDAP, Chrome Web Store public, MFA, block forcé par défaut — voir [`docs/RELEASE-v1.md`](docs/RELEASE-v1.md).
