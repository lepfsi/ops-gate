# Packs de regles: role reel (exemples)

## En une phrase

Un **pack** est le fichier de signatures de detection (secrets, configs, PII...)
que l'extension applique. L'admin le change depuis la console **sans reconstruire**
l'extension ni la redistribuer.

## Analogie

Imagine un antivirus:
- le **moteur** (extension) reste installe;
- les **definitions** (pack) se mettent a jour via le serveur.

Publier un pack = pousser de nouvelles definitions.

## Ce que tu vois quand tu "crees" des packs

A chaque **Publier et activer**, le systeme:
1. clone le pack actif (ou le moteur de base);
2. retire eventuellement des regles dont tu as saisi les IDs;
3. cree une **nouvelle version** (ex. 1.0.0 -> 1.0.1);
4. la marque **active**;
5. les agents la telechargent au prochain sync (<= 2 min ou Force sync).

Tu ne "crees" pas un pack vide separe: tu **versions** la liste de regles.
L'historique s'allonge: d'ou **Suppr.** sur les versions non actives et
**prune auto** (garde l'active + 12 inactives recentes).

## Exemples basiques

### Exemple A: trop de faux positifs "email"

1. Note la version active (ex. `1.0.0`).
2. Dans "IDs a desactiver", saisis: `email-address`.
3. Notes: `pilote RH moins de bruit email`.
4. **Publier et activer** -> version `1.0.1` active, sans cette regle.
5. Extension Options: **Synchroniser**.
6. Un prompt avec un email ne declenche plus (ou moins) cette regle.

### Exemple B: revenir en arriere

1. Liste historique: `1.0.0` (inactive), `1.0.1` (active).
2. Sur `1.0.0`, cliquer **Activer**.
3. Force-sync: les agents reprennent `1.0.0`.

### Exemple C: nettoyer l'historique

1. Versions mortes inutiles: **Suppr.** (impossible sur l'active).
2. Ou laisse le prune: apres plusieurs publications, les plus vieilles
   inactives disparaissent automatiquement.

## Ce que le pack ne change **pas**

| Element | Ou ca se regle |
|---------|----------------|
| Sites IA (chatgpt, claude...) | **Policy** / profils |
| Action warn / mask / block | **Policy** |
| Messages banner | **Policy** |
| Qui a une licence | **Groupes / agents** |
| Horaires d'alerte offline | **Monitoring** org ou **horaires policy** |

Si tu publies 10 packs sans changer les IDs desactives, le contenu des regles
est quasi identique: d'ou l'impression que "rien ne change". Il faut soit
desactiver des regles bruyantes, soit (V2) enrichir le pack autrement.

## Lien technique (fichiers)

| Role | Emplacement |
|------|-------------|
| Moteur de regles de base | packages/engine + API rules-pack.ts |
| Stockage versions | table `rule_packs` / memory packs |
| Activer version | update `policies.rules_pack_version` + epoch |
| Agent recoit le pack | GET `/v1/agents/me/config` + verify signature |
| Console UI | packages/console PacksView |

## Mode local_only (pas d'enroll)

L'extension utilise ses regles **embarquees**. Les packs console ne s'appliquent
qu'aux agents **enrolles** sur l'API.

## Checklist test rapide

1. Pack actif affiche dans Options agent apres sync.
2. Publier en desactivant une regle connue.
3. Sync agent: le numero de pack change.
4. Retester le meme type de contenu.
5. Activer l'ancienne version si besoin.

Voir aussi: GUIDE-UTILISATEUR.md, CAHIER-CONCEPTEUR.md.
