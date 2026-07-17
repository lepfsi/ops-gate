# Feature Spec — Shadow AI Discovery + Risk Score

**Statut** : Draft validé (17 juillet 2026)  
**Cible** : V2.x  
**Auteur** : Lead Dev + Product  
**Priorité** : P0 (fort impact commercial)

---

## 1. Vision & Objectifs

### Problème
Les organisations ne savent pas réellement quels outils d’IA sont utilisés en interne, ni quels utilisateurs exposent le plus de données sensibles.  
Le simple filtrage des prompts ne suffit plus : il faut de la **visibilité** et un **score de risque actionnable**.

### Solution
- **Shadow AI Discovery** : inventaire automatique des outils IA réellement utilisés.
- **Risk Score** : score dynamique (0-100) par utilisateur / équipe, basé sur le comportement réel.

### Phrase produit
> « Voyez enfin qui utilise réellement l’IA, et à quel point c’est risqué. »

### Objectifs mesurables
- Donner une visibilité claire de la surface d’attaque GenAI.
- Identifier rapidement les utilisateurs et équipes à fort risque.
- Fournir un argument commercial fort auprès des RSSI / DSI.
- Rester 100 % privacy-by-design (métadonnées uniquement).

---

## 2. Modèle de données

### 2.1 Enrichissement des Events existants

```ts
interface DetectionEvent {
  // champs existants...
  ai_tool: string;                    // hostname normalisé (chatgpt.com, claude.ai, ...)
  decision: "mask_send" | "send_anyway" | "cancel" | "blocked";
  max_severity: "low" | "medium" | "high";
  categories: string[];               // ["infra", "secrets", "pii", ...]
  source: "extension" | "proxy";
}
```

### 2.2 Table `user_risk_scores`

```sql
CREATE TABLE user_risk_scores (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES organizations(id),
  agent_id          UUID NOT NULL,
  score             INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
  score_previous    INTEGER,
  factors           JSONB NOT NULL,          -- détail transparent du calcul
  period_start      TIMESTAMPTZ NOT NULL,
  period_end        TIMESTAMPTZ NOT NULL,
  calculated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (org_id, agent_id, period_end)
);

CREATE INDEX idx_risk_scores_org_score ON user_risk_scores(org_id, score DESC);
CREATE INDEX idx_risk_scores_agent ON user_risk_scores(agent_id, calculated_at DESC);
```

### 2.3 Table `org_ai_tools` (statut des outils)

```sql
CREATE TABLE org_ai_tools (
  org_id          UUID NOT NULL,
  tool            TEXT NOT NULL,              -- hostname normalisé
  display_name    TEXT,
  status          TEXT NOT NULL DEFAULT 'unknown',  -- authorized | unauthorized | unknown
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by      UUID,

  PRIMARY KEY (org_id, tool)
);
```

---

## 3. Formule de Risk Score (V1)

Formule volontairement **simple, explicable et ajustable**.

```
Score = 0

// Détections (période glissante, ex: 30 jours)
+ chaque détection high     → +8
+ chaque détection medium   → +4
+ chaque détection low      → +1

// Décisions utilisateur
+ send_anyway sur high      → +12
+ send_anyway sur medium    → +6
+ send_anyway sur low       → +2
+ mask_send                 → +0
+ cancel                    → -1 (petit bonus)

// Shadow AI
+ usage d’un outil non autorisé → +15 (une fois par outil distinct)

// Récurrence
+ détections high sur ≥ 3 jours différents → +10

Score final = clamp(0, 100)
```

Le détail du calcul est stocké dans `factors` (JSONB) pour pouvoir afficher « Pourquoi ce score ? » dans la console.

**Évolutions futures possibles** :
- Coefficients configurables par organisation
- Décroissance temporelle (les événements anciens pèsent moins)
- Pondération par catégorie de données (infra > pii > low)

---

## 4. Spécification des Endpoints API

Tous les endpoints sont scopés par `org_id` via le token admin.

### 4.1 Risk Score

#### `GET /org/risk/summary`
Résumé global de l’organisation.

**Query**
- `period` : `7d` | `30d` | `90d` (défaut `30d`)

**Response 200**
```json
{
  "period": "30d",
  "average_score": 34,
  "previous_average_score": 41,
  "trend": "down",
  "users_count": 47,
  "high_risk_users": 6,
  "medium_risk_users": 11,
  "low_risk_users": 30,
  "top_risk_users": [
    {
      "agent_id": "uuid",
      "label": "Jean Dupont - Laptop",
      "score": 82,
      "trend": "up"
    }
  ],
  "calculated_at": "2026-07-17T12:00:00Z"
}
```

#### `GET /org/risk/users`
Liste paginée des utilisateurs avec score.

**Query**
- `period`, `min_score`, `max_score`, `sort`, `page`, `limit`

#### `GET /org/risk/users/:agentId`
Détail complet d’un utilisateur (score + facteurs + historique + outils utilisés).

### 4.2 Shadow AI

#### `GET /org/shadow-ai`
Inventaire des outils IA détectés.

**Query**
- `period`, `status` (`all` | `authorized` | `unauthorized` | `unknown`)

#### `PATCH /org/shadow-ai/:tool`
Mettre à jour le statut d’un outil (`authorized` / `unauthorized`).

### 4.3 Utilitaire

#### `POST /org/risk/recalculate`
Force le recalcul des scores (admin).

---

## 5. UI Console (description)

### 5.1 Dashboard principal
- KPI : Score moyen, tendance, nombre d’utilisateurs high risk
- Top 5 utilisateurs à risque
- Répartition Low / Medium / High

### 5.2 Page « Risk » / Utilisateurs
- Tableau triable et filtrable
- Badge de couleur selon le niveau de risque

### 5.3 Page détail utilisateur
- Score actuel + évolution
- Bloc « Pourquoi ce score ? » (facteurs détaillés)
- Liste des outils IA utilisés
- Derniers événements résumés

### 5.4 Page Shadow AI
- Tableau des outils détectés
- Action : marquer comme Autorisé / Non autorisé

---

## 6. Phasage d’implémentation

| Phase | Livrable                                      | Effort estimé     | Priorité |
|-------|-----------------------------------------------|-------------------|----------|
| 1     | Enrichissement events + calcul score + tables | 1,5 – 2 semaines  | P0       |
| 2     | Endpoints Risk + Shadow AI de base            | 1 semaine          | P0       |
| 3     | UI Dashboard + liste utilisateurs + détail    | 1 – 1,5 semaines  | P0       |
| 4     | Page Shadow AI + marquage statut + export     | 1 semaine          | P1       |
| 5     | Alertes (score > seuil) + métriques Grafana   | 0,5 – 1 semaine    | P1       |

---

## 7. Privacy & Principes

- Uniquement des **métadonnées** (jamais le contenu des prompts).
- Le scoring peut être désactivé par organisation (mode privacy max).
- Transparence : l’utilisateur admin peut toujours voir le détail du calcul (`factors`).
- Aligné avec le positionnement « privacy-by-design » d’OpsGate.

---

## 8. Métriques de succès

- % d’organisations qui consultent le dashboard Risk ≥ 1× / semaine
- Nombre d’outils Shadow AI découverts
- Réduction observable des comportements « send_anyway » sur les utilisateurs high risk
- Feedback qualitatif des RSSI / DSI lors des démos

---

## 9. Prochaines étapes

1. Validation finale de ce document
2. Création des migrations Postgres
3. Implémentation du calcul de score (job ou à la volée)
4. Développement des endpoints
5. Développement de l’UI console

---

*Document vivant — sera mis à jour au fur et à mesure de l’implémentation.*
