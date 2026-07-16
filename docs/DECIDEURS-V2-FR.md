# OpsGate — Documentation décideurs V2

**Pour** : DSI, RSSI, RSSI adjoint, architectes sécurité, comités risques  
**Version produit** : 1.2 / pré-GA V2  
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
| Fichiers | Uploads texte, PDF/DOCX (scan) |

**Privacy by design** : en mode local, rien ne quitte le poste. En mode organisation, ce sont des **métadonnées** (type de règle, décision, hostname) — pas le prompt complet par défaut.

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
| Mot de passe + MFA TOTP | Pilote / secours |
| **SSO OIDC** (Entra, Okta…) | Standard entreprise |
| **SAML 2.0** | IdP legacy / fédérations |
| **WebAuthn / passkeys** | Login sans mot de passe |
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

## 7. Conformité & risques résiduels

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

| Déjà livré (V1.x / V2 prep) | Suite |
|-----------------------------|--------|
| Extension multi-navigateur, proxy, SSO, MFA, LDAP, SIEM, MSI | WebAuthn prod multi-instance, SAML signature stricte, Safari App Store |

Contact : votre équipe DailyOps.Tech / commercial OpsGate.

---

*Document confidentiel — usage interne client & partenaires.*
