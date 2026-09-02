# OpsGate - Notes de développement

Spec produit : **OpsGate - Spécification MVP v1.0** (Google Drive).

## Objectif MVP

Extension Chrome/Edge (Manifest V3) qui intercepte les prompts sur ChatGPT, Claude et Gemini, détecte les données sensibles (PII + secrets + configs infra), propose un masquage non bloquant, et journalise localement.

## Stack

- Plasmo + TypeScript + React
- Moteur regex + `rules/rules.json`
- Stockage : `chrome.storage.local`
- Traitement 100 % local

## Structure

> Plasmo utilise `src/` comme racine des entrypoints.  
> Le `tsconfig` doit résoudre `~*` vers `./src/*` (sinon build vide).

```
src/
  background.ts
  popup.tsx
  options.tsx
  contents/ai-sites.ts
  lib/   detector, rules-engine, masker, banner, storage
  types/
rules/rules.json
assets/icon.png
```

## Charger l’extension (IMPORTANT)

### Méthode stable (recommandée pour tester le blocage)

1. **Arrêter** tout `pnpm dev` en cours (Ctrl+C dans le terminal).
2. Builder :
   ```bash
   pnpm build
   ```
3. Chrome → `chrome://extensions`
4. **Mode développeur** = ON
5. **Charger l’extension non empaquetée**
6. Sélectionner **exactement** ce dossier (pas la racine du repo) :
   ```
   C:\Users\Utilisateur\ops-gate\build\chrome-mv3-prod
   ```
7. Vérifier que la carte affiche **OpsGate** (pas d’erreur rouge).
8. Ouvrir / recharger un onglet **https://chatgpt.com**
9. Coller un prompt test (voir plus bas) et cliquer Envoyer.

### Méthode dev (hot reload)

```bash
pnpm dev
```

Charger : `build\chrome-mv3-dev`  
⚠️ Ne charger **que** ce dossier, jamais `ops-gate\` à la racine.  
⚠️ Un `pnpm dev` qui tourne tout en rebuildant peut faire croire à Chrome que le package est « vide / invalide » (fichiers lockés). En cas d’erreur : stop dev → `pnpm build` → recharger le dossier **prod**.

## Prompt de test

```
Voici ma clé API: sk-abcdefghijklmnopqrstuvwxyz123456
et mon password=SuperSecret123!
config system interface
edit "port1"
```

Attendu : bandeau OpsGate en haut de page avant l’envoi.

## Test upload (Phase 3)

Créer un fichier `test-secret.txt` :

```
password=SuperSecret123
AKIAIOSFODNN7EXAMPLE
```

Le joindre sur ChatGPT/Claude/Gemini → bandeau « fichier » avec Masquer & Joindre / Joindre quand même / Retirer.

Types scannés MVP : txt, md, json, csv, log, conf, yaml, env, pem, sh, py, etc.  
PDF/images : non scannés (toast d’avertissement).

## Console debug

Sur la page ChatGPT, F12 → Console → chercher :
```
[OpsGate] Content script actif sur ...
```

Si absent : l’extension n’est pas injectée (mauvais dossier chargé, ou page non rechargée après install).

## Erreurs Chrome fréquentes

| Message | Cause | Fix |
|--------|--------|-----|
| Manifeste manquant / illisible / package vide | Mauvais dossier (racine repo) | Charger `build\chrome-mv3-prod` |
| Package invalide pendant `pnpm dev` | Rebuild en cours / lock Parcel | Stop dev, `pnpm build`, charger prod |
| Extension charge mais pas de bandeau | Onglet ouvert avant install | Recharger la page ChatGPT |
| SW error | Cache corrompu | Supprimer l’extension, recharger le dossier |

## Kit démo

Voir **`docs/demo/`** :

- Script 5 min, prompts copier-coller, checklist présentateur
- Samples d’upload dans `docs/demo/samples/`

## Architecture plateforme (post-MVP)

**Statut : GO PRODUIT v1.1** (11/07/2026) - voir [PRODUCT-GO-v1.1.md](./docs/architecture/PRODUCT-GO-v1.1.md)

| Doc | Contenu |
|-----|---------|
| [PLATFORM-v1.1.md](./docs/architecture/PLATFORM-v1.1.md) | Console, privacy, APIs, proxy v1.2, roadmap PR (**validé**) |
| [PRODUCT-GO-v1.1.md](./docs/architecture/PRODUCT-GO-v1.1.md) | Décision go + hors scope |
| [RULEPACK-SCHEMA.md](./docs/architecture/RULEPACK-SCHEMA.md) | Packs de règles signés |
| [EVENT-SCHEMA.md](./docs/architecture/EVENT-SCHEMA.md) | Events metadata-only |

| PR | Statut | Doc |
|----|--------|-----|
| PR0 engine | DONE | `docs/architecture/PR0-ENGINE.md` |
| PR1 API | DONE | `docs/architecture/PR1-API.md` |
| PR2 RulePack | DONE | `docs/architecture/PR2-RULEPACK.md` |
| PR3 agent sync | DONE | `docs/architecture/PR3-AGENT-SYNC.md` |
| PR4 Console | DONE | `docs/architecture/PR4-CONSOLE.md` |
| PR5 Postgres | DONE | `docs/architecture/PR5-POSTGRES.md` |
| PR6 v1.1 release | DONE | `docs/architecture/PR6-V1.1-RELEASE.md` |

**v1.1.0 pilot-ready** → [`docs/RELEASE-v1.1.md`](./docs/RELEASE-v1.1.md)  
**Endpoint lock** (mdp admin) → [`docs/architecture/ENDPOINT-LOCK.md`](./docs/architecture/ENDPOINT-LOCK.md)

```bash
pnpm api:dev
pnpm console:dev
pnpm build
pnpm e2e
```

## Phase 4 - Validation

- Checklist manuelle : `docs/VALIDATION.md`
- Tests règles : `pnpm test:rules`
- Version courante : **0.3.0**
- Brand : `assets/icon.png`, `assets/icons/*`, `assets/brand/*`

### Améliorations anti faux-positifs (0.2)

- IBAN : validation mod-97 + contexte bancaire
- Cartes : Luhn + exclusion cartes de test / suites triviales
- Mots de passe placeholder (`password=password`, etc.) ignorés
- E-mails `@example.com` ignorés
- IP privées / licences : keywords obligatoires

## Hors scope v1

Blocage forcé, admin multi-users, SSO, store public, proxy desktop.
