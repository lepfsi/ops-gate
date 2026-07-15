# OpsGate  -  Guide utilisateur (V1)

**Public** : administrateurs console, pilotes, support  
**Version produit** : 1.2  
**Langue** : français  

Ce guide décrit l’usage quotidien d’OpsGate : extension, console, enrôlement, policies, licences, logs et recovery.  
Pour l’installation technique locale (Docker, ports), voir aussi [`GUIDE-STACK-LOCALE.md`](./GUIDE-STACK-LOCALE.md).

---

## 1. Vue d’ensemble

| Composant | Rôle |
|-----------|------|
| **Extension** | Détecte les données sensibles sur les sites IA, applique la policy, journalise les décisions |
| **API (control plane)** | Enrôlement, sync policy/packs, events, authentification console |
| **Console** | Administration : dashboard, policy, agents, packs, événements, audit |
| **Postgres** | Stockage durable (recommandé en pilote / prod) |

Sans **Postgres** (`DATABASE_URL` non défini), l’API utilise un store **mémoire** : **toutes les données sont perdues au redémarrage**.

---

## 2. Première connexion console

1. Démarrer l’API (et Postgres si utilisé).
2. Ouvrir la console (ex. `http://127.0.0.1:5173`).
3. Se connecter avec l’email principal et le mot de passe d’installation.
4. Changer le mot de passe à la première connexion si demandé.

**Mode avancé (login)** : le champ URL API est masqué par défaut ; l’activer uniquement pour pointer une autre instance.

Session unique par compte : une seconde connexion propose « Forcer la déconnexion ».

---

## 3. Enrôlement (extension)

### Organisation

1. Options de l’extension OpsGate.
2. Saisir l’**URL API** et le **code organisation** (ex. `DEMO-OPSGATE`).
3. Nommer l’appareil (label).
4. **Enrôler**.

Après un sync réussi :

- les policies sont **gérées** par l’org (non modifiables localement) ;
- la protection reste active hors ligne avec la **dernière policy** reçue.

### Personnel

Clé de licence personnelle → mode personnel (pas de télémétrie org vers la console DEMO).

### Désinscription

Si la policy l’exige : identifiant + mot de passe administrateur.  
Recovery concepteur : réservé au principal / support (voir §8).

---

## 4. Policy

### Policy org par défaut

S’applique aux agents **licenciés sans profil / groupe** spécifique.

- **Sites IA** : catalogue par groupes + sites personnalisés  
- **Action par défaut** : `warn` | `mask_recommend` | `mask_force` | `block`  
- **Collecte d’events** : on/off  
- **Messages utilisateur** : textes du bandeau (optionnel)

Enregistrer puis **Synchroniser** (ou attendre le poll ≤ 2 min).

### Policies par département (profils)

1. Créer un profil (ex. Finance).  
2. Assigner via **groupes** (ou agent).  
3. Les agents du groupe héritent du profil.

---

## 5. Licences

- Un **siège** = un agent protégé.  
- Sans siège : période de **grâce**, puis protection inactive (**unlicensed**).  
- L’assignation à un **groupe** (ou manuelle) active en général le siège.  
- Dashboard : listes Licensed / Grace / UNLICENSED.

---

## 6. Packs de règles

Un **pack** est le jeu de signatures de détection poussé aux agents sans rebuilder l’extension.

- **Publier** : nouvelle version (éventuellement sans certaines règles bruyantes).  
- **Activer** : version reçue au prochain sync.

---

## 7. Événements (logs) & export

Décisions typiques : `mask_send`, `send_anyway`, `cancel`, enroll / unenroll.

### Rétention

- Définie par l’**entreprise** (Monitoring → jours de rétention).  
- Au-delà : **purge automatique**.  
- **Exporter** la semaine ou tout l’historique avant purge (CSV).  
- Archive auto fin de semaine si activée (listes téléchargeables avec jours restants).

### Audit admin

Journal des actions console (policy, profils, admins, packs…).  
Réservé au **principal**. Export CSV disponible (symétrie events).

---

## 8. Recovery concepteur

| Phase | Pratique |
|-------|----------|
| Actuel | Secret fort `OPSGATE_VENDOR_RECOVERY` ; délai offline ≥ 2 h |
| Recommandé V1.x | **Pool de codes one-time** (voir [`RECOVERY-CONCEPTEUR.md`](./RECOVERY-CONCEPTEUR.md)) |

**OTP Administrator principal** et **Recovery** : bas de page **Admins & groupes** (principal uniquement).

---

## 9. Monitoring & horaires

- Seuils **online** / **not connected long time**  
- **Planning** (fuseau, jours, pauses) pour ne pas alerter hors heures  
- Rétention logs + archive hebdo  

Fuseaux : Europe, Cameroun (`Africa/Douala`), Madagascar (`Africa/Antananarivo`), etc.

---

## 10. Règles d’affectation

Règles auto (label / hostname → groupe), conditions en **AND**, priorité ordonnée.  
Appliquées à l’enroll et via « Ré-évaluer ».

---

## 11. Données & base  -  pourquoi tout peut « disparaître »

| Cause | Effet | Prévention |
|-------|--------|------------|
| API **sans** `DATABASE_URL` | Store **mémoire** → vide au restart | Toujours démarrer Postgres + exporter `DATABASE_URL` |
| `docker compose down -v` | Volume Postgres **détruit** | Ne pas utiliser `-v` en pilote |
| Nouveau volume / autre machine | DB « vide » + re-seed DEMO | Vérifier le volume Docker |
| Rétention logs courte | Events anciens **purgés** | Ajuster Monitoring ; exporter avant |
| Redémarrage API memory | Perte agents, events, admins custom | Passer à Postgres |

Le seed `DEMO-OPSGATE` ne s’exécute **que si** l’org n’existe pas encore : il **ne réécrit pas** une org déjà présente.

### Checklist démarrage durable

```powershell
docker compose up -d
$env:DATABASE_URL = "postgres://opsgate:opsgate@127.0.0.1:5432/opsgate"
pnpm api:dev
pnpm console:dev
```

Vérifier le log API : `store=postgres` (et non `memory`).

---

## 12. Raccourcis console (V1)

| Action | Détail |
|--------|--------|
| `/` | Focus recherche / filtre événements (onglet Événements) |

---

## 13. Support & docs liées

| Document | Contenu |
|----------|---------|
| [`GUIDE-STACK-LOCALE.md`](./GUIDE-STACK-LOCALE.md) | Docker, ports, build extension |
| [`RECOVERY-CONCEPTEUR.md`](./RECOVERY-CONCEPTEUR.md) | Pool one-time, offline |
| [`RULE-PACKS.md`](./RULE-PACKS.md) | Packs de règles |
| [`RUNBOOK-OPS.md`](./RUNBOOK-OPS.md) | Exploitation |
| [`PRIVACY.md`](./PRIVACY.md) | Modes & privacy |

---

*OpsGate V1 · Guide utilisateur · document de référence produit*
