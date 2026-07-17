# OpsGate – Roadmap Produit Claire

**Version** : 1.0  
**Date** : 17 juillet 2026  
**Objectif** : Avoir une feuille de route simple, priorisée et actionnable pour ne plus se disperser.

---

## Principe directeur

> On ne cherche pas à tout faire.  
> On cherche à livrer **peu de choses, mais très fortes**, qui donnent une identité claire au produit.

**Positionnement retenu :**  
**AI Security Platform** pour les PME  
Philosophie : *Enable AI. Secure Data.*

---

## État actuel (ce qui existe déjà ou est bien avancé)

| Élément                        | Statut          | Commentaire                              |
|--------------------------------|-----------------|------------------------------------------|
| Détection de secrets & configs | Solide          | Moteur regex + règles                    |
| Masquage basique               | Existant        | À faire évoluer vers Secure Rewrite      |
| Journalisation des events      | Existant        | Métadonnées only                         |
| Extension navigateur           | Fonctionnelle   | À enrichir                               |
| Idée Shadow AI + onglet        | Wireframé       | Très bon point de départ                 |
| Risk Score utilisateur         | Spécifié        | Prêt à implémenter                       |

---

## Roadmap priorisée

### Phase 1 – Fondations stables (en cours / court terme)
**Objectif** : Avoir un produit fiable et déjà différenciant.

- Stabiliser le moteur de détection
- Finaliser le **Shadow AI** (inventaire des outils IA utilisés)
- Implémenter le **Risk Score utilisateur** (comportement sur 7/30/90 jours)
- Mettre en place le dashboard de base avec :
  - Score moyen de l’organisation
  - Top utilisateurs à risque
  - Liste des outils Shadow AI

**Livrable principal** : Onglet Shadow AI + Risk Score utilisateur opérationnels.

---

### Phase 2 – Différenciation forte (Priorité absolue)
**Objectif** : Créer l’effet « waouh » et l’identité du produit.

Ordre recommandé d’implémentation :

1. **Secure Rewrite** (feature phare)
   - Anonymisation intelligente en un clic
   - Aperçu côte à côte
   - Intégration dans le flux de détection

2. **Risk Score par prompt**
   - Score instantané 0-100 avec détail
   - Affichage clair dans l’extension

3. **AI Simulation Mode**
   - Avant envoi : « Voici ce qui pourrait fuiter »
   - Recommandation + lien direct vers Secure Rewrite

**Pourquoi cet ordre ?**
- Secure Rewrite est la plus visible et la plus démonstrative
- Le Risk Score par prompt + Simulation Mode s’appuient naturellement dessus
- Ensemble, ils créent un parcours utilisateur très fort :  
  **Détection → Simulation → Secure Rewrite → Envoi sécurisé**

---

### Phase 3 – Visibilité & Gouvernance
**Objectif** : Donner aux DSI/RSSI ce qu’ils aiment (tableaux de bord + contrôle).

- Dashboard avancé (KPIs concrets)
- Analytics (Top utilisateurs, Top IA, tendances, secrets détectés…)
- Politiques par département / groupe
- AI Trust Score (évaluation des modèles IA : ChatGPT, Claude, etc.)
- Historique sécurisé des prompts (AI Prompt History)

---

### Phase 4 – Anticipation (Moyen / Long terme)
**Objectif** : Rester en avance sur le marché.

- **AI Agent Guard** (protection des agents autonomes)
- Classification intelligente (Public / Internal / Confidential / Restricted)
- Modules de gouvernance et conformité avancés

---

## Vue synthétique (priorités)

| Priorité | Fonctionnalité                  | Phase | Impact business | Effort |
|----------|----------------------------------|-------|------------------|--------|
| P0       | Shadow AI + Risk Score utilisateur | 1   | Élevé            | Moyen  |
| P0       | Secure Rewrite                   | 2     | Très élevé       | Moyen  |
| P0       | Risk Score par prompt            | 2     | Élevé            | Faible |
| P0       | AI Simulation Mode               | 2     | Très élevé       | Faible/Moyen |
| P1       | Dashboard avancé + Analytics     | 3     | Élevé            | Moyen  |
| P1       | Politiques par département       | 3     | Moyen            | Moyen  |
| P1       | AI Trust Score                   | 3     | Moyen/Élevé      | Moyen  |
| P2       | AI Agent Guard                   | 4     | Élevé (futur)    | Élevé  |
| P2       | Classification intelligente     | 4     | Élevé            | Élevé  |

---

## Ce qu’on ne fait pas maintenant

Pour éviter de s’égarer, on met volontairement de côté pour l’instant :
- Trop de règles de détection supplémentaires
- Des fonctionnalités « nice to have » non différenciantes
- Une refonte complète de l’architecture
- L’IA Agent Guard (trop tôt)

---

## Prochaine action concrète recommandée

1. Finaliser et livrer **Shadow AI + Risk Score utilisateur** (Phase 1)
2. Enchaîner directement sur **Secure Rewrite** (début de Phase 2)

Ces deux blocs donnent déjà une plateforme cohérente et vendable.

---

*Cette roadmap est volontairement simple. Elle doit servir de boussole.*
