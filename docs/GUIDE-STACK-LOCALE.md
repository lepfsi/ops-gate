# OpsGate — Guide stack locale (Docker, API, Console, Extension)

**Version** : V1 / 1.2  
**Public** : dev, démo, premier pilote local  

Ce document explique **comment utiliser** Postgres dans Docker, l’API, la console, et **comment ça agit** sur l’extension navigateur.

Compléments :

- Runbook court : [`RUNBOOK-OPS.md`](./RUNBOOK-OPS.md)  
- Privacy / modes : [`PRIVACY.md`](./PRIVACY.md)  
- Release V1 : [`RELEASE-v1.md`](./RELEASE-v1.md)  

---

## 1. Architecture (ce qui tourne où)

```
┌─────────────────────────────┐
│  Navigateur (Chrome/Edge)   │
│  Extension OpsGate          │  ← détection locale, bandeau, journal
│  (build/chrome-mv3-prod)    │
└──────────────┬──────────────┘
               │ HTTP (enroll, config, events)
               ▼
┌─────────────────────────────┐
│  API OpsGate :8787          │  ← control plane (pnpm api:dev)
└──────────────┬──────────────┘
               │ SQL
               ▼
┌─────────────────────────────┐
│  Docker : Postgres :5432    │  ← mémoire durable (admins, agents, events…)
│  conteneur opsgate-postgres │
└─────────────────────────────┘

  Console web :5173  ──HTTP──►  API :8787  (admin, pas l’extension)
```

| Composant | Rôle | Sans lui… |
|-----------|------|-----------|
| **Postgres (Docker)** | Stocke org, admins, agents, packs, events | L’API peut tourner en **memory** (tout perdu au restart) |
| **API** | Enroll, sync règles/policy, events, login console | Extension reste en **local_only** (pas d’org) |
| **Console** | Admin (policy, agents, packs, events) | Gestion uniquement via API manuelle |
| **Extension** | Intercepte les sites IA et détecte | Cœur produit ; marche **sans** cloud en local |

### Règle d’or

> L’extension **n’accède jamais Docker directement**.  
> Elle parle seulement à `http://127.0.0.1:8787` **une fois enrôlée**.

Docker = cerveau durable côté serveur.  
Extension = capteur sur le navigateur.  
Ils ne se croisent que si l’extension est **enrôlée** vers une API qui lit/écrit Postgres.

---

## 2. Procédures Docker / API / Console

### 2.1 Prérequis

- Node + pnpm installés (`pnpm install` à la racine du repo)
- **Docker Desktop** démarré (moteur Linux OK)
- Ports libres : `5432` (Postgres), `8787` (API), `5173` (console)

### 2.2 Démarrer Postgres

```powershell
cd C:\Users\Utilisateur\ops-gate
docker compose up -d
```

Vérifier :

```powershell
docker compose ps
# opsgate-postgres … (healthy)  0.0.0.0:5432->5432
```

Image par défaut : `postgres:17` (voir `docker-compose.yml`).  
Données persistées dans le volume Docker `ops-gate_opsgate_pg_data`.

### 2.3 Lancer l’API branchée sur Postgres

**Important** : sans `DATABASE_URL`, l’API utilise le store **memory** — Docker tourne pour rien.

PowerShell :

```powershell
$env:DATABASE_URL = "postgres://opsgate:opsgate@127.0.0.1:5432/opsgate"
pnpm api:dev
```

Logs attendus :

- `store=postgres`
- `V1 listening on http://127.0.0.1:8787`

Santé :

```powershell
curl http://127.0.0.1:8787/health
# { "ok": true, "store": "postgres", "version": "1.2.0", ... }
```

Variables utiles (voir aussi `.env.example`) :

| Variable | Défaut dev | Rôle |
|----------|------------|------|
| `DATABASE_URL` | *(absent = memory)* | Connexion Postgres |
| `PORT` | `8787` | Port API |
| `OPSGATE_SETUP_EMAIL` | `admin@demo.local` | Admin principal seed |
| `OPSGATE_SETUP_PASSWORD` | `0000` | Mdp setup (à changer) |
| `OPSGATE_VENDOR_RECOVERY` | démo | Break-glass offline |
| `OPSGATE_PERSONAL_LICENSE_KEYS` | clés démo | Licences perso |

### 2.4 Console admin

```powershell
pnpm console:dev
```

- URL : http://127.0.0.1:5173  
- Login démo : `admin@demo.local` / `0000`  
- **Changez le mot de passe** à la première connexion (pilote externe)

Onglets principaux :

| Onglet | Usage |
|--------|--------|
| Tableau de bord | Stats, force-sync, décisions |
| Policy | Hosts IA, uploads, event reporting, mdp unenroll |
| Admins & groupes | Multi-admins, users, groupes |
| Packs de règles | Publier / activer un RulePack |
| Agents | Liste, licences sièges, profils |
| Événements | Metadata des détections (pas le prompt) |

### 2.5 Arrêt / redémarrage / wipe

| Action | Commande | Effet |
|--------|----------|--------|
| Stop Postgres | `docker compose stop` | Conteneur arrêté ; **données conservées** |
| Start Postgres | `docker compose start` | Reprend le volume |
| Restart API | Ctrl+C puis `pnpm api:dev` (+ `DATABASE_URL`) | Avec Postgres : **rien n’est perdu** |
| Stop + supprimer conteneur | `docker compose down` | Volume **conservé** par défaut |
| **Wipe total** DB | `docker compose down -v` | **Efface** orgs, agents, events, admins |

### 2.6 Valider la durabilité (go client)

```powershell
docker compose up -d
$env:DATABASE_URL = "postgres://opsgate:opsgate@127.0.0.1:5432/opsgate"
pnpm api:validate-pg
# → PASS: Postgres control plane survives API restart
```

Le script crée un admin marqueur, kill l’API, la relance, et vérifie que l’admin + la session + l’epoch survivent.

### 2.7 Sauvegarde Postgres

```powershell
docker exec opsgate-postgres pg_dump -U opsgate opsgate > backup.sql
```

---

## 3. Extension navigateur — comment l’utiliser

### 3.1 Builder et charger

```powershell
pnpm build
```

1. Chrome / Edge → `chrome://extensions`  
2. Mode développeur = ON  
3. **Charger l’extension non empaquetée**  
4. Dossier exact :

```
C:\Users\Utilisateur\ops-gate\build\chrome-mv3-prod
```

> Ne chargez **pas** la racine du repo `ops-gate\`.

Hot reload dev (optionnel) : `pnpm dev` → charger `build/chrome-mv3-dev` (arrêter le dev en cas d’erreur de package verrouillé).

### 3.2 Mode `local_only` (défaut — sans enroll)

L’extension est autonome :

| | |
|--|--|
| Règles | Embarquées dans l’extension |
| Journal | `chrome.storage.local` uniquement |
| Réseau OpsGate | **Aucun** |
| Docker / API | Peuvent être **éteints** : zéro impact |

Valeur : DLP local sur ChatGPT, Claude, Gemini, Copilot, Perplexity, DeepSeek, AI Studio, etc.

### 3.3 Mode org (après enroll) — lien avec Docker/API

Dans **Options** de l’extension :

1. URL API : `http://127.0.0.1:8787`  
2. Code organisation : **`DEMO-OPSGATE`**  
3. Label appareil (ex. `PC-Steve`)  
4. **Enrôler**

Usage personnel (standalone) :

1. Options → Usage personnel  
2. Clé : `OPS-PERSONAL-DEMO-2026`  
3. Org logique : `PERSONAL` (1 siège)

#### Flux après enroll

```
Enroll
  → API écrit l’agent en Postgres
  ← agent_token + 1er pack / policy

Toutes ~2 min (ou après force-sync console) :
  GET /v1/agents/me/config
  → hosts, scan uploads, pack de règles, mdp unenroll, epoch…

À chaque détection (si event_reporting = ON) :
  POST /v1/events/batch
  → metadata only en Postgres
  → visibles Console → Événements
```

### 3.4 Ce que l’admin fait → effet sur l’extension

| Action console / API | Effet sur l’extension |
|----------------------|------------------------|
| Change policy / hosts | Appliqué au **prochain sync** (~2 min) ou après **Forcer la synchronisation** |
| Publie un pack de règles | Nouvelles règles **sans rebuild** de l’extension |
| Force-sync | Bump `config_epoch` → agents rechargent plus vite |
| Révoque un agent | Token invalide ; poste plus géré par l’org |
| Retire licence siège | Grâce **5 min** puis protection désactivée côté agent |
| Pose un mdp de désinscription | Unenroll protégé (mdp admin / recovery selon policy) |

### 3.5 Ce que fait l’utilisateur sur un site IA

| Action | Où ça va |
|--------|----------|
| Prompt sensible → bandeau OpsGate | Toujours **local** (détection sur le poste) |
| « Masquer » / « Envoyer quand même » / « Annuler » | Journal local **+** event cloud si reporting ON |
| Contenu du prompt / fichier | **Jamais** stocké en Postgres (metadata only) |

**Privacy by design** : ce qui est assez sensible pour déclencher OpsGate n’est pas re-centralisé en clair « pour le dashboard ».

---

## 4. Routine quotidienne (dev / pilote local)

1. Démarrer **Docker Desktop**  
2. `docker compose up -d`  
3. `$env:DATABASE_URL=...` + `pnpm api:dev`  
4. `pnpm console:dev` (admin)  
5. Extension chargée (`pnpm build` si besoin) + enroll si org  
6. Tester un prompt sur un site IA supporté  
7. Vérifier **Événements** + **Agents** dans la console  

### Niveaux de maturité

| Niveau | Stack | Usage |
|--------|--------|--------|
| 1 | Extension seule | DLP local, démo rapide |
| 2 | + API memory | Démo org, **fragile** (wipe au restart API) |
| 3 | + API + **Postgres Docker** | Pilote réaliste, **persistance** |

---

## 5. Codes et identifiants démo

| Élément | Valeur |
|---------|--------|
| Org équipe | `DEMO-OPSGATE` (25 sièges seed) |
| Org personnelle | `PERSONAL` |
| Clé perso démo | `OPS-PERSONAL-DEMO-2026` |
| Admin console | `admin@demo.local` / `0000` |
| API locale | `http://127.0.0.1:8787` |
| Console locale | `http://127.0.0.1:5173` |

---

## 6. Pièges fréquents

| Symptôme | Cause probable | Fix |
|----------|----------------|-----|
| `store=memory` alors que Docker tourne | `DATABASE_URL` non exporté | Relancer l’API avec la variable |
| Extension ignore l’API | Pas d’enroll / mauvais URL | Options → enroll `DEMO-OPSGATE` |
| Sync / events en échec | API down | `pnpm api:dev` + health |
| Détection OK, console vide | Mauvaise org console (PERSONAL vs DEMO), mode PERSONNEL (`event_reporting=false`), ou policy events off | Bandeau console « Org · DEMO-OPSGATE » ; extension enroll DEMO ; Policy → collecte events ON ; sync |
| Extension « package vide » | Mauvais dossier chargé | Charger `build/chrome-mv3-prod` |
| Données disparues | `docker compose down -v` ou memory | Ne pas utiliser `-v` ; utiliser Postgres |
| `pack_verify_failed` | Clés ed25519 / API | Vérifier API up + clés `packages/api/keys` |

---

## 7. Schéma récapitulatif des responsabilités

```
Utilisateur final
  └─ Extension : intercepte UI IA, détecte, bandeau, journal local
       │
       │ (optionnel si enrollé)
       ▼
Control plane (API + Postgres)
  └─ Console : vision manager, policy, packs, licences, events metadata
```

| Question | Réponse |
|----------|---------|
| Où se fait la détection ? | **Sur le poste**, dans l’extension |
| Où sont les admins / agents ? | **Postgres** (si `DATABASE_URL`) |
| L’extension a-t-elle besoin de Docker ? | **Non**, sauf mode org géré |
| Docker suffit-il sans API ? | **Non** — l’extension ne se connecte pas à Postgres |
| Que se passe-t-il si le cloud/API est down ? | Détection **continue** avec le dernier pack en cache |

---

## 8. Commandes express

```powershell
cd C:\Users\Utilisateur\ops-gate

# Base durable
docker compose up -d
$env:DATABASE_URL = "postgres://opsgate:opsgate@127.0.0.1:5432/opsgate"

# Services
pnpm api:dev          # :8787
pnpm console:dev      # :5173
pnpm build            # extension

# Checks
curl http://127.0.0.1:8787/health
pnpm api:smoke
pnpm api:validate-pg
pnpm test
```

---

*Document aligné OpsGate V1 (1.2) — stack locale early customer.*
