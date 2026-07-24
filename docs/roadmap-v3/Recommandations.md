# OpsGate – Brief technique pour Grok Build

**Date** : 21 juillet 2026  
**Objectif** : Document de handoff clair et priorisé  
**Destinataire** : Grok Build (implémentation)

---

## Partie 1 — 4 améliorations UX prioritaires

Ces 4 points concernent principalement **Secure Rewrite** et le **Simulation Mode**.  
Ils visent l’effet « waouh » et la clarté pour l’utilisateur final.

### 1. Rendu du texte sécurisé + Diff visuel (Secure Rewrite)

**Problème actuel**  
Le panneau « Sécurisé » ne montre pas clairement ce qui a changé. L’utilisateur a du mal à comprendre les modifications.

**À faire**
- Afficher Original et Sécurisé côte à côte (déjà en place)
- Ajouter un **diff visuel** :
  - Texte supprimé / modifié → fond rouge clair + barré
  - Texte ajouté / remplacé → fond vert clair
  - Texte inchangé → style normal
- Conserver la liste des modifications en bas (password, aws_key, etc.)

**Priorité** : Très haute  
**Impact** : Très fort (effet waouh immédiat)

---

### 2. Wording global — ton « Enable AI. Secure Data. »

**Problème actuel**  
Le ton est trop orienté alerte / blocage (« Sensitive data detected », « HIGH RISK », etc.).

**À faire**  
Passer à un ton plus **aidant et orienté solution** :

| Situation                        | Éviter                                      | Préférer                                                      |
|----------------------------------|---------------------------------------------|---------------------------------------------------------------|
| Détection                        | Sensitive data detected                     | Certaines informations sensibles ont été détectées            |
| Recommandation                   | Anonymize before sending                    | Nous pouvons anonymiser ce message pour vous                  |
| Score élevé                      | HIGH RISK                                   | Niveau de risque : Élevé + courte explication                 |
| Message de politique             | This restriction is enforced by policy      | OpsGate protège vos données selon la politique de l’organisation |

**Priorité** : Haute  
**Impact** : Fort (alignement avec le positionnement produit)

---

### 3. Simulation Mode plus explicative (sans surcharger)

**Problème actuel**  
On voit les éléments détectés, mais pas toujours **pourquoi** le score est élevé.

**À faire (version légère)**
- Garder l’affichage actuel des items
- Ajouter un élément discret :
  - Soit un lien **« Pourquoi ce score ? »** (dépliable)
  - Soit une icône `ⓘ` avec tooltip / petite explication
- Exemple de texte :
  > Ce message contient 1 clé API + 1 mot de passe → risque élevé de fuite de credentials.

**Règle** : ne rien afficher par défaut pour ne pas charger le bandeau.

**Priorité** : Haute  
**Impact** : Fort

---

### 4. Bouton « Edit / Ajuster » dans Secure Rewrite (version légère)

**Problème actuel**  
L’utilisateur ne peut pas facilement corriger un remplacement (ex. : restaurer un hostname).

**À faire (version non intrusive)**
- Ajouter un bouton discret **« Ajuster »** (ou icône crayon)
- Au clic → section **dépliable** (pas de nouveaux boutons permanents)
- Dans la section :
  - Liste des remplacements
  - Possibilité de restaurer la valeur originale
  - Possibilité de modifier manuellement un remplacement

**Règle** : rester optionnel. La majorité des utilisateurs cliqueront directement sur « Apply & send ».

**Priorité** : Moyenne  
**Impact** : Moyen (mais très apprécié des power users)

---

## Partie 2 — Basculement du scan de fichiers vers le Proxy

### Contexte

L’extraction de fichiers (PDF, DOCX, images/OCR…) est actuellement trop fragile et lente **uniquement dans l’extension**.  
On recentre les responsabilités.

### Périmètre réaliste (à respecter)

#### A. Ce que l’**extension garantit** (local, rapide)

| Format | Support | Limite | Temps cible |
|--------|---------|--------|-------------|
| Texte, configs, .sql, .env, .json, .md, .csv, code… | Garanti | 25 Mo (troncature) | < 1–2 s |
| DOCX (texte) | Garanti | ~15–20 Mo | < 2–3 s |
| PDF **texte** | Garanti | **≤ 30 pages** | < 3,5 s |
| Images / OCR | Non garanti | — | — |
| Anciens .doc / .xls / .ppt | Non supporté | — | Message clair |

**Règles extension :**
- Timeout strict **3,5 s**
- En cas d’échec → message précis (pas juste « Confirmez l’envoi »)
- Pas d’OCR obligatoire côté navigateur

#### B. Ce que le **proxy local (MSI)** doit prendre en charge

| Cas | Responsabilité | Temps cible | Priorité |
|-----|----------------|-------------|----------|
| PDF texte 31 → 80 pages | Proxy | ≤ 6–8 s | P1 |
| OCR images (si policy activée) | Proxy | ≤ 7 s | P1 |
| XLSX / PPTX volumineux | Proxy | ≤ 6 s | P2 |
| Fallback quand l’extension échoue | Proxy | — | P1 |

Le proxy devient le moteur de scan pour tout ce qui est lourd.

#### C. Best effort / Plus tard

- PDF > 80–100 pages → troncature + message
- PDF scannés (vraies images) → plus tard
- OCR multilingue avancé → plus tard
- Formats legacy (.doc, .xls, .ppt) → demander la version moderne
- Audio / Vidéo → warning uniquement (pas de scan de contenu)

### Logique de décision (simple)

```
Fichier reçu
    │
    ├─ Texte / config / .sql / petit DOCX / PDF ≤ 30 pages
    │       → Extension (garanti)
    │
    ├─ PDF > 30 pages  ou  Image (OCR demandé)  ou  Office lourd
    │       → Proxy local
    │
    └─ Échec / timeout / format non supporté
            → Message clair + confirmation + log
```

### Contrat attendu Extension ↔ Proxy

Le proxy doit pouvoir recevoir un fichier et renvoyer :

```ts
{
  status: "scanned" | "partial" | "timeout" | "failed",
  text: string,               // texte extrait
  truncated: boolean,
  error?: string,             // message technique si failed
  detections?: Detection[]    // optionnel
}
```

---

## Ordre d’implémentation recommandé

| Priorité | Sujet | Description |
|----------|-------|-------------|
| **P0** | UX Secure Rewrite | Diff visuel + meilleur rendu du texte sécurisé |
| **P0** | Messages d’erreur fichiers | Messages précis au lieu de « Confirmez l’envoi » générique |
| **P1** | Fiabiliser extraction extension | PDF ≤ 30 pages + DOCX stables |
| **P1** | Wording « Enable AI » | Uniformiser les textes des bandeaux |
| **P1** | Simulation explicative | « Pourquoi ce score ? » (version légère) |
| **P1** | Contrat + pipeline Proxy | Scan des fichiers lourds (PDF étendu + OCR) |
| **P2** | Bouton « Ajuster » | Version dépliable dans Secure Rewrite |
| **P2** | Helper natif (optionnel) | Uniquement si besoin de meilleures perfs OCR |

---

## Messages clés à retenir

1. **L’extension doit rester légère et fiable.**
2. **Le proxy devient le moteur des scans lourds.**
3. **On ne promet plus** « OCR magique + PDF 120 pages uniquement dans le navigateur ».
4. Les 4 améliorations UX (surtout le **diff visuel**) sont prioritaires pour l’effet produit.

---

---

## Statut implémentation (2026-07-21)

| Sujet | Statut | Où |
|-------|--------|-----|
| Diff visuel Secure Rewrite | ✅ | `highlightRewriteDiff` + banner `og-diff-*` |
| Wording Enable AI | ✅ | `i18n-agent.ts` + labels risk |
| Simulation « Pourquoi ce score ? » | ✅ | bouton dépliable `#og-sim-why` |
| Bouton Ajuster | ✅ | panel `#og-rewrite-adjust` + restore |
| PDF ≤ 30 p. extension + timeout 3,5 s | ✅ | `office-extract.ts` |
| Messages fichiers précis | ✅ | `file-scanner.ts` userHints |
| Contrat proxy scan-file | ✅ | `POST /opsgate-proxy/scan-file` + fallback extension |

*Fin du brief – OpsGate*