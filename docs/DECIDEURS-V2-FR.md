# OpsGate — Documentation décideurs V2

**Pour** : DSI, RSSI, RSSI adjoint, architectes sécurité, comités risques  
**Version produit** : 1.2 / lot V2 (juillet 2026)  
**Maturité** : **V2 functional / pre-GA** — synthèse [`STATUS-V2.md`](./STATUS-V2.md)  
**Éditeur** : DailyOps.Tech  

---

## 1. Qu’est-ce que c’est ?

**OpsGate** est une solution de **prévention de fuite de données (DLP légère)** centrée sur l’usage des **outils d’IA générative** (ChatGPT, Claude, Gemini, Copilot, Perplexity, etc.).

Elle répond à une question simple :

> *Comment laisser les collaborateurs utiliser l’IA librement, sans exposer secrets, données clients ou configurations d’infrastructure ?*

OpsGate **n’est pas** un CASB réseau complet, ni un outil d’espionnage des conversations. C’est un **filet métier** : détection locale, actions claires (masquer / bloquer / journaliser), gouvernance centrale pour l’entreprise.

---

## 2. Comment ça marche ? (en 60 secondes)

```
Utilisateur ──► Site IA (navigateur)
                    │
         ┌──────────┼──────────┐
         ▼          ▼          ▼
    Extension   Proxy local   (option)
    (contenu)   (HTTPS MITM)
         │          │
         └────┬─────┘
              ▼
     Moteur de règles (@opsgate/engine)
     secrets · PII · configs réseau · clés cloud
              │
              ▼
     Banner / soft-block / soft-mask
              │
              ▼
     Console + API (événements métadonnées)
     SIEM · métriques · rapports PDF
```

1. **Détection** dans le navigateur (et/ou le proxy) avant envoi.  
2. **Décision** : masquer les secrets, bloquer, ou journaliser selon la policy.  
3. **Gouvernance** : admins définissent règles, groupes, profils, licences.  
4. **Preuve** : events, audit, exports, SIEM, PDF sécurité.

---

## 3. Ce que vous protégez

| Catégorie | Exemples |
|-----------|----------|
| Secrets applicatifs | Clés API OpenAI/Anthropic, AWS, Azure, GCP, Stripe, JWT |
| Identité / PII | Emails, IBAN, cartes (avec réduction de faux positifs) |
| Infrastructure | Fragments Fortinet, MikroTik, WireGuard, configs réseau |
| Fichiers | Uploads texte, PDF/DOCX/**PPTX/XLSX**, **OCR images** (Tesseract local) |

**Privacy by design** : en mode local, rien ne quitte le poste. En mode organisation, ce sont des **métadonnées** (type de règle, décision, hostname) — pas le prompt complet par défaut. OCR et parse fichiers restent **sur le poste**.

---

## 4. Architecture en couches

| Couche | Rôle | Pour le décideur |
|--------|------|------------------|
| **Extension** Chrome / Edge / Firefox / Safari* | UX, banner, enroll | Déploiement rapide |
| **Proxy local** | Filet si DOM cassé / multi-IA HTTPS | Défense en profondeur |
| **API + Postgres** | Control plane multi-tenant + RLS | Gouvernance, audit |
| **Console** | Pilotage DSI/SOC | Visibilité et policy |
| **SIEM / Prometheus** | Intégration SOC existant | Pas de silo |

\*Safari : build MV3 + packaging Apple (Xcode).

---

## 5. Identité & accès (admin)

| Mécanisme | Usage |
|-----------|--------|
| Mot de passe + MFA TOTP | Pilote / secours ; **forcé en multi-tenant** |
| **SSO OIDC** (Entra, Okta…) | Standard entreprise |
| **SAML 2.0** | IdP legacy ; signature IdP exigée en prod |
| **WebAuthn / passkeys** | Windows Hello, empreinte, clés FIDO2 |
| **Session concurrente** | Consentement 10 s / lecture seule (anti-takeover) |
| **SSO enforce** | Interdire le password local |
| **JIT** | Créer l’admin à la 1ʳᵉ connexion SSO |
| **LDAP / AD** | Sync groupes & users + cron |

---

## 6. Déploiement & industrialisation

| Canal | Description |
|-------|-------------|
| Sideload | `build/chrome-mv3-prod` (pilote) |
| **Chrome Web Store** + MDM force-install | Parc Windows géré |
| **Firefox AMO** + policies.json | ESR / enterprise |
| **MSI proxy** + Node portable | Service silencieux, PAC/GPO |
| Docker Postgres | Persistance durable |

---

## 7. Conformité, audit & continuité

| Capacité | Bénéfice décideur |
|----------|-------------------|
| **Audit WORM** (chaîne SHA-256) | Preuve d’intégrité des actions admin |
| **Rétention légale audit** (≥ 90 j) | Alignement exigences de conservation |
| **Backup config + Postgres** | Continuité d’activité / PRA léger |
| **Exports planifiés + SIEM** | Preuve opérationnelle pour le SOC |
| **MSP multi-org** | Un opérateur gouverne plusieurs clients |

**Réduit** : fuites accidentelles vers l’IA, absence de visibilité, contournement policy (lock + MDM).

**Ne remplace pas** : DLP réseau full, CASB cloud, EDR, classification LLM serveur.

**Recommandation** : OpsGate **complète** l’existant (EDR + proxy + SIEM), sur le risque **spécifique IA**.

---

## 8. Indicateurs de succès (KPI pilote 30–90 j)

- % postes avec extension force-installée  
- Nombre d’events « mask / block » / semaine  
- Temps de déploiement policy (force-sync < 2 min)  
- Incidents « secret collé dans ChatGPT » avant / après  
- Couverture multi-IA (liste hosts)  

---

## 9. Offre & suite produit

| Déjà livré (V1.x + lot V2) | Suite (pre-GA → GA) |
|---------------------------|---------------------|
| Extension multi-navigateur, proxy, SSO, MFA multi-tenant, passkeys, LDAP, SIEM, MSI | Publication store réelle (CWS/AMO/Apple), pilote client |
| Scan fichiers PDF/DOCX/PPTX/XLSX + OCR images | OCR multilingue élargi, Safari App Store public |
| Audit WORM, backup, notifications multi-canaux, MSP portfolio | Billing Stripe portal GA, soft-delete org GDPR full |

**Installation** : guide intégrateur [`DEPLOIEMENT-CLIENT.md`](./DEPLOIEMENT-CLIENT.md) (+ PDF FR/EN).  
**Avancement détaillé** : [`STATUS-V2.md`](./STATUS-V2.md) · [`V2-BACKLOG.md`](./V2-BACKLOG.md).

Contact : votre équipe DailyOps.Tech / commercial OpsGate.

---

*Document confidentiel — usage interne client & partenaires · 17 juillet 2026*
