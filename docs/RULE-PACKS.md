# Packs de règles — à quoi ça sert ?

## En une phrase

Un **pack de règles** est la liste des signatures de détection (secrets, configs réseau, PII…) que les **agents enrollés** appliquent, **sans reconstruire** l’extension.

## Problème résolu

Sans packs :

1. Tu modifies `rules.json` dans le code  
2. Tu rebuild l’extension  
3. Tu redistribues à tous les postes  

Avec packs :

1. L’admin **publie** un pack depuis la console (ou l’API)  
2. Les agents **synchronisent** (poll ~2 min ou force-sync)  
3. Nouvelle détection **active** sur les postes  

## Vocabulaire

| Terme | Signification |
|--------|----------------|
| **Pack** | Snapshot versionné de règles (`1.0.0`, `1.0.1`…) |
| **Pack actif** | Version servie aux agents au `/config` |
| **Publier** | Créer une **nouvelle version** (souvent clone de l’active − règles désactivées) |
| **Activer** | Choisir quelle version publiée devient **active** |
| **Signature ed25519** | Garantit que le pack vient de ton control plane (anti-tamper) |

## Onglet console « Packs de règles »

### Voir la liste
- Versions publiées, checksum, notes, laquelle est **active**

### Publier un pack
1. Optionnel : IDs de règles à **désactiver** (ex. `email-address` si trop de faux positifs)  
2. Notes libres (ex. « désactive email pour pilote RH »)  
3. **Publier** → nouvelle version (ex. `1.0.0` → `1.0.1`) **activée** par défaut  

Cas d’usage typiques :
- Réduire les faux positifs sur un département  
- Ajouter temporairement des règles plus strictes (via API / JSON avancé)  
- Rollback : **Activer** une ancienne version  

### Ce que ce n’est **pas**
- Ce n’est **pas** un éditeur no-code de regex (V2+)  
- Ce n’est **pas** lié au Chrome Web Store  
- Ce n’est **pas** obligatoire en mode `local_only` (règles embarquées dans l’extension)

## Lien avec l’agent

```
Console « Publier pack 1.0.2 »
        │
        ▼
API stocke pack signé + met à jour policy.rulesPackVersion
        │
        ▼  (sync agent ≤ 2 min ou force-sync)
Extension vérifie signature + checksum
        │
        ▼
Détection utilise les nouvelles règles
```

## Mode personnel vs org

| Mode | Source des règles |
|------|-------------------|
| **Organisation** | Pack actif de l’org (console) |
| **Personnel** | Pack de l’org `PERSONAL` (seed API) |
| **local_only** | Règles embarquées dans l’extension |

## Pour les testeurs

1. Console → **Packs de règles** → noter la version active  
2. Publier en désactivant une règle bruyante  
3. Extension Options → **Synchroniser**  
4. Vérifier que le pack affiché a changé  
5. Retester un prompt qui déclenchait cette règle  

Voir aussi : [`architecture/RULEPACK-SCHEMA.md`](./architecture/RULEPACK-SCHEMA.md)
