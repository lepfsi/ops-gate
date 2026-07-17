# Feature Spec — Secure Rewrite

**Version** : 1.0  
**Date** : 17 juillet 2026  
**Priorité** : P0 (fonctionnalité phare)  
**Statut** : Draft détaillé  

---

## 1. Vision

**Secure Rewrite** transforme OpsGate d’un simple détecteur en un assistant de sécurité intelligent.

L’utilisateur ne subit plus seulement une alerte : il obtient en un clic une version **utilisable et sécurisée** de son contenu.

> « Envoyez une version sécurisée de votre prompt en un clic. »

---

## 2. Flux Utilisateur

1. L’utilisateur saisit ou colle un contenu sensible.
2. OpsGate détecte des éléments à risque.
3. Une modal s’ouvre automatiquement (ou via bandeau).
4. L’utilisateur voit :
   - Le nombre de données sensibles
   - Le Risk Score
   - Un aperçu côte à côte (Original vs Version sécurisée)
5. Actions possibles :
   - **Utiliser la version sécurisée** (action principale)
   - Modifier manuellement la version proposée
   - Masquer classiquement et envoyer
   - Envoyer quand même
   - Annuler

---

## 3. Règles d’anonymisation détaillées

### 3.1 Principes directeurs

- Conserver le maximum de sens et de structure pour l’IA
- Préférer la **généralisation** à la suppression pure
- Être prévisible et explicable
- Ne jamais laisser de donnée sensible résiduelle

### 3.2 Tableau des règles

| Catégorie                    | Exemple original                      | Version Secure Rewrite           | Stratégie                          | Priorité |
|-----------------------------|---------------------------------------|----------------------------------|------------------------------------|----------|
| **IP privée**               | `192.168.10.45`                      | `10.x.x.x` ou `192.168.x.x`     | Masquage partiel intelligent       | Haute    |
| **IP publique**             | `203.0.113.42`                       | `[PUBLIC_IP]`                   | Placeholder                        | Haute    |
| **Mot de passe / Secret**   | `MyP@ssw0rd!2024`                    | `********`                      | Remplacement total                 | Critique |
| **Clé API (Stripe, etc.)**  | `sk_live_51N8...`                    | `sk_live_[REDACTED]`            | Préfixe conservé + redaction       | Critique |
| **AWS Access Key**          | `AKIAIOSFODNN7EXAMPLE`               | `AKIA[REDACTED]`                | Préfixe + redaction                | Critique |
| **Nom d’hôte / Firewall**   | `FW-PARIS-CORE-01`                   | `FW-01`                         | Généralisation                     | Haute    |
| **Nom d’utilisateur**       | `jean.dupont`                        | `user-01`                       | Pseudonymisation séquentielle      | Moyenne  |
| **Email interne**           | `jean.dupont@entreprise.com`         | `user@example.com`              | Domaine générique                  | Haute    |
| **Certificat / Thumbprint** | `A1:B2:C3:D4:...`                    | `[CERTIFICATE]`                 | Placeholder                        | Haute    |
| **Compte de service**       | `svc-backup-prod`                    | `svc-account-01`                | Généralisation                     | Moyenne  |
| **Chemin interne**          | `/opt/entreprise/secrets/`           | `/opt/app/secrets/`             | Généralisation du chemin           | Moyenne  |
| **Données RH / PII**        | Nom + matricule + salaire            | `[PERSONAL_DATA]`               | Placeholder fort                   | Critique |
| **Config Fortinet / Cisco** | Blocs complets                       | Version nettoyée                | Application récursive des règles   | Critique |
| **Token JWT / Bearer**      | `eyJhbGciOiJIUzI1NiIs...`            | `[JWT_TOKEN]`                   | Placeholder                        | Critique |

### 3.3 Règles avancées

- **Cohérence** : le même hostname ou la même IP doit toujours être remplacé par la même valeur dans un même document.
- **Contexte** : dans un bloc de configuration, on conserve la structure (interfaces, policies, etc.) tout en nettoyant les valeurs sensibles.
- **Code** : les commentaires et la structure du code sont préservés au maximum.

---

## 4. Wireframes détaillés

### 4.1 Modal principale – Secure Rewrite

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Secure Rewrite                                            [×]           │
│                                                                          │
│  14 données sensibles détectées          Risk Score : 87/100             │
│  ████████████████████░░░░  High                                          │
│                                                                          │
│  ┌────────────────────────────┐    ┌────────────────────────────┐        │
│  │ ORIGINAL                   │    │ VERSION SÉCURISÉE          │        │
│  │                            │    │                            │        │
│  │ config system interface    │    │ config system interface    │        │
│  │     edit "port1"           │    │     edit "port1"           │        │
│  │         set ip 192.168.1.1 │ →  │         set ip 10.x.x.x    │        │
│  │         set allowaccess... │    │         set allowaccess... │        │
│  │     next                   │    │     next                   │        │
│  │ config user local          │    │ config user local          │        │
│  │     edit "admin"           │    │     edit "admin"           │        │
│  │         set passwd MyP@ss  │    │         set passwd ******  │        │
│  │     next                   │    │     next                   │        │
│  │                            │    │                            │        │
│  └────────────────────────────┘    └────────────────────────────┘        │
│                                                                          │
│  Modifications effectuées :                                              │
│  • 3 adresses IP privées → 10.x.x.x                                      │
│  • 1 mot de passe → ********                                             │
│  • 1 nom d’hôte → FW-01                                                  │
│                                                                          │
│  [ Utiliser la version sécurisée ]   [ Modifier ]   [ Annuler ]          │
└──────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Mode édition manuelle

L’utilisateur peut cliquer sur « Modifier » pour ajuster certains remplacements avant validation.

---

## 5. Interfaces TypeScript (Moteur)

```ts
// packages/engine/src/secure-rewrite.ts

export type RewriteStrategy =
  | "partial_mask"      // 192.168.1.1 → 10.x.x.x
  | "full_redact"       // password → ********
  | "prefix_keep"       // sk_live_xxx → sk_live_[REDACTED]
  | "generalize"        // FW-PARIS-01 → FW-01
  | "placeholder"       // email → user@example.com
  | "pseudonymize";     // jean.dupont → user-01

export interface RewriteChange {
  original: string;
  replacement: string;
  category: string;
  strategy: RewriteStrategy;
  startIndex: number;
  endIndex: number;
}

export interface RewriteResult {
  rewrittenText: string;
  changes: RewriteChange[];
  originalRiskScore: number;
  remainingRiskScore: number;
  stats: {
    totalReplacements: number;
    byCategory: Record<string, number>;
  };
}

export interface SecureRewriteOptions {
  /** Conserver la cohérence des remplacements dans le document */
  consistentMapping?: boolean;
  /** Niveau d’agressivité (1 = doux, 3 = strict) */
  aggressiveness?: 1 | 2 | 3;
  /** Langue principale du contenu */
  language?: "fr" | "en";
}

/**
 * Génère une version intelligemment anonymisée du texte.
 */
export function secureRewrite(
  text: string,
  detections: Detection[],
  options?: SecureRewriteOptions
): RewriteResult;
```

### Exemple d’utilisation

```ts
const result = secureRewrite(promptText, detections, {
  consistentMapping: true,
  aggressiveness: 2,
});

console.log(result.rewrittenText);
console.log(result.stats);
```

---

## 6. Journalisation

Lorsqu’un utilisateur choisit Secure Rewrite, l’événement doit contenir :

```ts
{
  decision: "secure_rewrite",
  original_risk_score: 87,
  remaining_risk_score: 12,
  replacements_count: 14,
  categories_rewritten: ["ip_private", "password", "hostname"],
  // ... autres métadonnées classiques
}
```

---

## 7. Cas limites

| Cas                              | Comportement attendu                                      |
|----------------------------------|-----------------------------------------------------------|
| Texte très long (> 10k caractères) | Traitement par chunks + aperçu limité à 150 lignes       |
| Contenu déjà partiellement masqué | Ne pas re-masquer ce qui l’est déjà                      |
| Faux positif                     | L’utilisateur peut restaurer une valeur via « Modifier » |
| Mélange FR / EN                  | Règles bilingues                                          |
| Code source                      | Préserver au maximum la syntaxe et les commentaires       |

---

## 8. Critères de succès

- Taux d’adoption de Secure Rewrite > 40 % sur les détections Medium/High
- Réduction visible des clics « Envoyer quand même »
- Feedback qualitatif en démo : « c’est magique / très utile »
- Temps de génération de la version sécurisée < 400 ms (cas médian)

---

## 9. Plan d’implémentation

1. Finaliser et valider le dictionnaire de règles
2. Implémenter `secureRewrite()` dans `@opsgate/engine`
3. Ajouter les tests unitaires et de non-régression
4. Développer la modal dans l’extension (React)
5. Brancher la journalisation
6. Tests utilisateurs internes

---

*Document vivant – à enrichir pendant l’implémentation.*
