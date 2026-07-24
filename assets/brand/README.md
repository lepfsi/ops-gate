# OpsGate brand assets

| Fichier | Usage |
|---------|--------|
| **`Template.png`** | **Source de vérité couverture PDF (style + couleurs)** — prochains docs uniquement |
| **`packages/console/public/brand/opsgate-mark.svg`** | Marque porte/serrure produit (= BrandMark.tsx, PDF mark, enrôlement) |
| `../icon.png` + `../icons/icon-*.png` | Générés par `python scripts/gen-gate-icons.py` (resvg) pour l’extension |
| `opsgate-icon-refined.jpg` | Asset marketing alternatif (neon) — **pas** l’icône produit |
| `opsgate-icon-dailyops.jpg` | Variante flat gate/shield |
| `opsgate-wordmark.png` | Wordmark docs / démo |
| `opsgate-banner-1280.png` | Bannière 1280×720 (logo horizontal) |
| `packages/console/public/brand/favicon*` | Favicon onglet console |

## Charte PDF — `Template.png` (à partir de 2026-07)

**Important :** les PDF déjà présents sous `docs/*.pdf` **ne sont pas** regénérés automatiquement.
Cette charte s’applique aux **prochains** builds (`scripts/pdf_brand.py` + `pdf_md_render.draw_cover`).

### Couleurs (extraites du template)

| Token | Hex / RGB | Usage PDF |
|-------|-----------|-----------|
| Accent teal | `#2BD9C5` · `TEAL` | Barres haut/bas couverture, filets, accent |
| Cover mid | ≈ `#0B373E` · `COVER_BG` | Fond couverture (teal profond) |
| Cover deep | ≈ `#082028` · `COVER_BG_DEEP` | Bas de couverture |
| Navy | `#0A1128` · `NAVY` | Footer couverture, header pages intérieures, BrandMark |
| Navy-2 | `#111C44` · `NAVY2` | Dégradés secondaires |
| Ink | `#0F172A` | Corps de texte pages intérieures |
| Muted | `#94A3B8` | Légendes, tags |
| White | `#FFFFFF` | Titres sur fond sombre |

### Layout couverture (`draw_cover`) — règles strictes

1. Barre accent teal (haut)
2. Fond teal profond + BrandMark centré (couleurs produit, pas carré noir)
3. « OpsGate » blanc · « DailyOps.Tech » teal · filet teal
4. Titre + sous-titre document
5. Barre accent teal (bas) uniquement

**Interdit sur la couverture :**
- Footer type pages intérieures (« Page X », bandeau navy bas + mini-logo)
- Logo monochrome noir / glyph illisible

**Pages intérieures :** fond **clair** (blanc), header fin navy + filet teal, footer discret gris — **pas** de blocs dark partout.

Implémentation : `scripts/pdf_md_render.py` → `draw_cover()` / `make_doc_pdf()`.

### Charte UI console (inchangée)

DailyOps.Tech board (`docs/ChatGPT Image…png`) :

| Token | Hex |
|-------|-----|
| Accent teal | `#2BD9C5` |
| Near black | `#0A1128` |
| Deep blue | `#111C44` |
| Slate | `#1E293B` |
| Cool gray | `#94A3B8` |
| White | `#FFFFFF` |

### Concept marque OpsGate

Filtre de sécurité devant une **porte de sortie** (gate + shield).  
Ton : professionnel, ops / cybersécurité, non alarmiste.

### Régénérer un PDF (volontaire)

```bash
# Uniquement si vous voulez appliquer le nouveau template à un doc
python scripts/build-v2-docs-pdf.py
# ou un builder dédié (guide, DSI, security-report…)
```

Par défaut, laisser les PDF historiques tels quels jusqu’à une re-publication produit planifiée.
