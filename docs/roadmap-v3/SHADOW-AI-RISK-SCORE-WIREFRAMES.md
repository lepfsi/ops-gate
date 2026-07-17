# Wireframes — Shadow AI Discovery + Risk Score

**Date** : 17 juillet 2026  
**Feature** : Shadow AI + Risk Score  
**Statut** : Draft UI

---

## 1. Dashboard Risk (Vue d’ensemble)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  OpsGate Console                                              [Org] [User]  │
├────────────┬────────────────────────────────────────────────────────────────┤
│            │  Risk Overview                              Période: [30 jours ▼] │
│  Sidebar   │                                                                │
│            │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  Dashboard │  │ Score moyen  │  │ High Risk    │  │ Tendance     │  │ Outils       │
│  Agents    │  │     34       │  │     6        │  │   ↓ -7 pts   │  │ Shadow: 3    │
│  Events    │  │  /100        │  │  utilisateurs│  │  vs période  │  │ non autorisés│
│  Policies  │  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘
│  Risk  ←   │                                                                │
│  Shadow AI │  Répartition des risques                                       │
│  Settings  │  ████████████████████░░░░░░░░  Low (30)                        │
│            │  ████████░░░░░░░░░░░░░░░░░░░░  Medium (11)                     │
│            │  ███░░░░░░░░░░░░░░░░░░░░░░░░░  High (6)                        │
│            │                                                                │
│            │  Top 5 utilisateurs à risque                                   │
│            │  ┌────┬──────────────────────────┬───────┬──────────┬─────────┐│
│            │  │ #  │ Utilisateur              │ Score │ Tendance │ Action  ││
│            │  ├────┼──────────────────────────┼───────┼──────────┼─────────┤│
│            │  │ 1  │ Jean Dupont - Laptop     │  82   │   ↑      │ Voir →  ││
│            │  │ 2  │ Marie Martin - MacBook   │  76   │   →      │ Voir →  ││
│            │  │ 3  │ ...                      │  ...  │   ...    │ ...     ││
│            │  └────┴──────────────────────────┴───────┴──────────┴─────────┘│
│            │                                                                │
│            │  [Voir tous les utilisateurs]                                  │
└────────────┴────────────────────────────────────────────────────────────────┘
```

---

## 2. Page Liste des Utilisateurs (Risk)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Risk > Utilisateurs                                                        │
│                                                                             │
│  Filtres:  [Score min ▼] [Score max ▼] [Tendance ▼] [Période: 30j ▼]  🔍   │
│                                                                             │
│  ┌────┬────────────────────────────┬───────┬──────────┬────────────┬───────┐│
│  │    │ Utilisateur / Device       │ Score │ Tendance │ Dernière   │ Outils││
│  │    │                            │       │          │ activité   │ Shadow││
│  ├────┼────────────────────────────┼───────┼──────────┼────────────┼───────┤│
│  │ ●  │ Jean Dupont - Laptop       │  82   │   ↑ +11  │ Il y a 2h  │   2   ││
│  │ ●  │ Marie Martin - MacBook     │  76   │   →      │ Il y a 5h  │   1   ││
│  │ ○  │ Thomas Leroy - Desktop     │  41   │   ↓ -8   │ Hier       │   0   ││
│  │ ○  │ ...                        │  ...  │   ...    │ ...        │  ...  ││
│  └────┴────────────────────────────┴───────┴──────────┴────────────┴───────┘│
│                                                                             │
│  Légende: ● High (≥70)   ◐ Medium (40-69)   ○ Low (<40)                     │
│                                                                             │
│  Pagination:  < 1 2 3 ... >                                                 │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Page Détail Utilisateur

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Risk > Jean Dupont - Laptop                                                │
│                                                                             │
│  ┌────────────────────┐   Score actuel                                      │
│  │                    │   ┌──────────┐                                      │
│  │   Graphique        │   │    82    │  ↑ +11 pts vs période précédente     │
│  │   d’évolution      │   │   /100   │                                      │
│  │   (sparkline 30j)  │   └──────────┘                                      │
│  │                    │                                                     │
│  └────────────────────┘                                                     │
│                                                                             │
│  Pourquoi ce score ?                                                        │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ • 9 détections High                          → +72 pts                │  │
│  │ • 3 « Envoyer quand même » sur High          → +36 pts                │  │
│  │ • 1 outil non autorisé (poe.com)             → +15 pts                │  │
│  │ • Récurrence (High sur 4 jours différents)   → +10 pts                │  │
│  │ • Ajustements (mask + cancel)                → -5 pts                 │  │
│  │                                                       Total : 82      │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  Outils IA utilisés                                                         │
│  ┌────────────────────┬──────────┬──────────────┬───────────────────────┐   │
│  │ Outil              │ Statut   │ Interactions │ Dernière utilisation  │   │
│  ├────────────────────┼──────────┼──────────────┼───────────────────────┤   │
│  │ chatgpt.com        │ Autorisé │ 42           │ Il y a 2h             │   │
│  │ claude.ai          │ Autorisé │ 18           │ Hier                  │   │
│  │ poe.com            │ Non aut. │ 7            │ Il y a 3 jours        │   │
│  └────────────────────┴──────────┴──────────────┴───────────────────────┘   │
│                                                                             │
│  Derniers événements (résumé)                                               │
│  • 16/07 18:22 — High — Config Fortinet — send_anyway                       │
│  • 15/07 11:05 — High — Clé API — mask_send                                 │
│  • ...                                                                      │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Page Shadow AI (Inventaire)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Shadow AI                                                                  │
│                                                                             │
│  Période: [30 jours ▼]     Statut: [Tous ▼]                    🔍 Rechercher│
│                                                                             │
│  ┌────────────────────┬──────────────┬──────────┬────────────┬─────────────┐│
│  │ Outil              │ Utilisateurs │ Événements│ Dernière   │ Statut      ││
│  │                    │              │           │ activité   │             ││
│  ├────────────────────┼──────────────┼──────────┼────────────┼─────────────┤│
│  │ chatgpt.com        │ 38           │ 412       │ Il y a 12m │ Autorisé  ▼ ││
│  │ claude.ai          │ 29           │ 187       │ Il y a 1h  │ Autorisé  ▼ ││
│  │ gemini.google.com  │ 14           │ 63        │ Hier       │ Autorisé  ▼ ││
│  │ poe.com            │ 5            │ 23        │ Il y a 3j  │ Non aut. ▼  ││
│  │ character.ai       │ 2            │ 8         │ Il y a 5j  │ Inconnu  ▼  ││
│  └────────────────────┴──────────────┴──────────┴────────────┴─────────────┘│
│                                                                             │
│  Actions rapides:                                                           │
│  [Marquer la sélection comme Autorisé]  [Marquer comme Non autorisé]        │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Notes d’interaction

- **Badges de couleur** :
  - Rouge ≥ 70 (High)
  - Orange 40-69 (Medium)
  - Vert < 40 (Low)

- Cliquer sur un utilisateur ouvre la page détail.
- Changer le statut d’un outil dans Shadow AI impacte le calcul des scores futurs.
- Tous les tableaux sont triables et exportables (CSV).
- Possibilité d’ajouter un filtre « Afficher uniquement les High Risk ».

---

*Wireframes à utiliser comme référence pour le développement de la console.*
