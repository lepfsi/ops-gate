# OpsGate

**Utilisez l’IA librement. Protégez vos données automatiquement.**

**Version : 1.1.0 (pilot-ready)** — voir [`docs/RELEASE-v1.1.md`](docs/RELEASE-v1.1.md)

OpsGate est une extension navigateur (Chrome / Edge, Manifest V3) de **Data Loss Prevention légère** pour ChatGPT, Claude et Gemini, avec control plane optionnel (API + Console).

En mode local, tout le traitement est **local**. En mode org, seules des **métadonnées** d’événements peuvent être centralisées (pas le prompt).

## Fonctionnalités (v1.1)

- Interception des **prompts** (Entrée / bouton Envoyer)
- Interception des **uploads** (fichiers texte) avec quarantaine avant jointure
- Détection **générale** : secrets, API keys, mots de passe, PII, IBAN, cartes, Azure/GCP/Stripe, JWT…
- Détection **infra** : Fortinet, Cisco, Juniper, **Huawei**, **MikroTik**, **Palo Alto**, pfSense/OPNsense, WireGuard/OpenVPN, Arista, credentials réseau
- Bandeau non bloquant : masquer · envoyer quand même · détails · annuler
- Journal local + activation ON/OFF
- Identité visuelle (icônes + wordmark dans `assets/`)

## Installer en dev / test

```bash
pnpm install
pnpm build
```

1. Ouvrir `chrome://extensions`
2. Mode développeur = ON
3. **Charger l’extension non empaquetée**
4. Choisir le dossier :

```
build/chrome-mv3-prod
```

> Ne chargez **pas** la racine du repo.

Hot reload :

```bash
pnpm dev
```

Puis charger `build/chrome-mv3-dev` (arrêter `pnpm dev` en cas d’erreur de package verrouillé).

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

## Sites supportés

- chatgpt.com / chat.openai.com
- claude.ai
- gemini.google.com

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

Org démo : code **`DEMO-OPSGATE`**

## Spec produit

Voir **OpsGate - Spécification MVP v1.0** (Drive) et `README2.md` (notes dev).

## Hors scope v1

Blocage forcé, admin multi-users / SSO, proxy desktop, Chrome Web Store (après validation).
