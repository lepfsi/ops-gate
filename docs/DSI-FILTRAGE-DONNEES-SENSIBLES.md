<!--
  OpsGate — Document DSI / RSSI
  Charte DailyOps.Tech : navy #0A1128 · navy-2 #111C44 · accent teal #2BD9C5 · soft #E6FAF7 · ink #0F172A
-->

<div style="font-family: Inter, 'Segoe UI', system-ui, sans-serif; color: #0f172a; line-height: 1.55; max-width: 920px; margin: 0 auto;">

<div style="background: linear-gradient(135deg, #0A1128 0%, #111C44 55%, #0d1a3a 100%); color: #fff; border-radius: 16px; padding: 28px 32px 24px; margin-bottom: 28px; border-bottom: 4px solid #2BD9C5; box-shadow: 0 12px 40px rgba(10, 17, 40, 0.25);">
  <div style="display: flex; align-items: center; gap: 18px; flex-wrap: wrap;">
    <img src="../packages/console/public/brand/opsgate-logo-light.svg" alt="OpsGate" width="200" height="40" style="height: 40px; width: auto;" />
    <div style="flex: 1; min-width: 200px;">
      <div style="font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: #2BD9C5; font-weight: 700; margin-bottom: 6px;">DailyOps.Tech · Document décideurs</div>
      <h1 style="margin: 0; font-size: 1.55rem; font-weight: 750; letter-spacing: -0.03em; color: #fff;">OpsGate</h1>
      <p style="margin: 8px 0 0; font-size: 1.05rem; color: #e2e8f0; font-weight: 500;">Protégez les données de votre entreprise dans chaque interaction avec l’IA.</p>
    </div>
  </div>
  <div style="margin-top: 20px; display: flex; flex-wrap: wrap; gap: 10px;">
    <span style="background: rgba(43, 217, 197, 0.18); color: #5EF0DF; border: 1px solid rgba(43, 217, 197, 0.45); padding: 4px 12px; border-radius: 999px; font-size: 12px; font-weight: 650;">Public : DSI · RSSI · Comités sécurité</span>
    <span style="background: rgba(255,255,255,0.08); color: #cbd5e1; border: 1px solid rgba(255,255,255,0.12); padding: 4px 12px; border-radius: 999px; font-size: 12px;">Version produit V1.2+ / V2</span>
    <span style="background: rgba(255,255,255,0.08); color: #cbd5e1; border: 1px solid rgba(255,255,255,0.12); padding: 4px 12px; border-radius: 999px; font-size: 12px;">16 juillet 2026</span>
  </div>
</div>

<div style="background: #E6FAF7; border-left: 4px solid #2BD9C5; border-radius: 0 12px 12px 0; padding: 14px 18px; margin-bottom: 28px;">
  <strong style="color: #0A1128;">Ce document n’est pas le manuel administrateur.</strong>
  <span style="color: #334155;"> Il s’adresse aux organes décisionnels : que propose OpsGate, pourquoi l’adopter, puis — de façon claire — <em>quoi</em> est filtré et <em>comment</em> le blocage s’applique. Pour l’exploitation quotidienne, voir le guide utilisateur et le runbook proxy.</span>
</div>

---

## 1. La solution que nous proposons

### En une phrase

**OpsGate** est la plateforme **DailyOps.Tech** qui empêche (ou alerte avant) l’exfiltration involontaire de secrets, de données financières et de configurations d’infrastructure lorsque vos collaborateurs utilisent **ChatGPT, Claude, Gemini, Copilot, Grok** et les autres services d’IA générative.

### Le problème métier

L’IA est déjà dans l’entreprise. Les équipes collent dans les prompts :

- des **clés API** et secrets cloud ;
- des **IBAN** et **numéros de carte** ;
- des **extraits de config** firewall / routeur / VPN ;
- des fichiers `.env`, tokens Git, chaînes de connexion.

Une seule erreur = fuite vers un fournisseur tiers, hors de votre périmètre de contrôle. Les DLP « généraux » et les CASB lourds sont souvent **trop larges**, lents à déployer, ou **aveugles au contenu** réellement collé dans un chat IA.

### Ce qu’OpsGate apporte

| Pilier | Bénéfice pour la DSI |
|--------|----------------------|
| **Protection au point d’usage** | Au moment du prompt / fichier, dans le navigateur — là où le risque se matérialise. |
| **Double filet** | **Extension** (expérience utilisateur : alerte, masquage, annulation) + **proxy local** (filet réseau sur les sites IA, mode observe ou enforce). |
| **Gouvernance centralisée** | Console MMC : policies, packs de règles, licences sièges, groupes, journal d’events, export audit. |
| **Privacy by design** | Pas de relecture des conversations chez le fournisseur IA ; détection locale + reporting des *décisions* et métadonnées, pas d’enregistrement des chats. |
| **Déploiement progressif** | Pilote technique (warn) → reinforce (mask / block / proxy enforce) sans tout bloquer le SI. |
| **Multi-IA** | Pas un verrou ChatGPT seul : catalogue large de services IA (Chromium aujourd’hui). |

### Architecture en vue décideur

```
┌─────────────────── Poste collaborateur ───────────────────┐
│  Navigateur (Chrome / Edge / Brave / Opera)               │
│     │                                                      │
│     ├─ Extension OpsGate  →  warn · mask · block (UX)      │
│     └─ Proxy OpsGate (opt.) → observe · enforce (réseau)   │
└────────────────────────────┬──────────────────────────────┘
                             │ events · policy · licences
                             ▼
              ┌──────────────────────────────┐
              │  Control plane OpsGate (API) │
              │  Console admin · MMC · packs  │
              │  Charte DailyOps navy + teal │
              └──────────────────────────────┘
```

---

## 2. Pourquoi choisir OpsGate

<div style="display: grid; gap: 12px; margin: 16px 0 24px;">

<div style="border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px 18px; border-top: 3px solid #2BD9C5;">
  <div style="color: #0A1128; font-weight: 750; font-size: 1.02rem; margin-bottom: 6px;">1. Spécialisé IA, pas un DLP générique</div>
  <div style="color: #475569; font-size: 0.95rem;">Conçu pour le risque <strong>prompt / fichier vers l’IA</strong> : sites ciblés, règles secrets + finance + configs réseau, modes adaptés au terrain (warn → mask → block).</div>
</div>

<div style="border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px 18px; border-top: 3px solid #2BD9C5;">
  <div style="color: #0A1128; font-weight: 750; font-size: 1.02rem; margin-bottom: 6px;">2. Preuve et pilotage pour le comité</div>
  <div style="color: #475569; font-size: 0.95rem;">Dashboard licences, connectivité agents, décisions (masquer / envoyer quand même / annuler / block proxy), export CSV/JSON pour l’audit — sans ouvrir le contenu des conversations chez OpenAI ou Anthropic.</div>
</div>

<div style="border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px 18px; border-top: 3px solid #2BD9C5;">
  <div style="color: #0A1128; font-weight: 750; font-size: 1.02rem; margin-bottom: 6px;">3. Adoption réaliste</div>
  <div style="color: #475569; font-size: 0.95rem;">Mode <strong>warn</strong> pour former et mesurer ; <strong>mask</strong> pour corriger sans bloquer le métier ; <strong>proxy enforce</strong> pour le filet réseau quand l’extension ne suffit pas. Maintenance agents (congés / panne) pour éviter les faux positifs ops.</div>
</div>

<div style="border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px 18px; border-top: 3px solid #2BD9C5;">
  <div style="color: #0A1128; font-weight: 750; font-size: 1.02rem; margin-bottom: 6px;">4. Éditeur DailyOps.Tech</div>
  <div style="color: #475569; font-size: 0.95rem;">Produit français / terrain ops & sécurité, charte visuelle navy <code style="background:#E6FAF7;color:#0A1128;padding:1px 6px;border-radius:4px;">#0A1128</code> + teal <code style="background:#E6FAF7;color:#0A1128;padding:1px 6px;border-radius:4px;">#2BD9C5</code>, formation et documentation DSI + admin sur le site DailyOps.tech.</div>
</div>

<div style="border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px 18px; border-top: 3px solid #2BD9C5;">
  <div style="color: #0A1128; font-weight: 750; font-size: 1.02rem; margin-bottom: 6px;">5. Trajectoire V2 alignée entreprise</div>
  <div style="color: #475569; font-size: 0.95rem;">Roadmap : SIEM / syslog, métriques Grafana, multi-navigateur (Firefox…), SSO/MFA, store — sans attendre pour sécuriser le risque IA dès aujourd’hui en V1.x.</div>
</div>

</div>

### Ce qu’OpsGate n’est pas (transparence)

| Non-objectif | Pourquoi c’est important de le dire |
|--------------|-------------------------------------|
| Appliance CASB / DLP sur **tout** le trafic Internet | Périmètre volontairement **IA** pour un déploiement rapide et un ROI clair. |
| Lecture des historiques de chat chez le fournisseur | Respect privacy ; pas de « session replay ». |
| Antivirus / EDR | Complément, pas remplacement de votre stack endpoint. |

---

## 3. Comment ça marche (vue décideur)

Une fois le « pourquoi » posé, le mécanisme en trois couches :

| Couche | Rôle | Bloque le réseau ? |
|--------|------|---------------------|
| **Extension navigateur** | Détecte dans le prompt et les fichiers ; dialogue (warn / mask / cancel / block policy) | Principalement **côté page** (empêche ou masque avant envoi DOM) |
| **Proxy local (option)** | MITM sur allowlist multi-IA ; journal `observe` ou coupe `enforce` | **Oui** en enforce si détection actionnable |
| **Control plane** | Policies, packs de règles, licences, MMC, exports | N/A (gouvernance) |

```
Utilisateur → Extension OpsGate → [Proxy OpsGate] → Site IA (HTTPS)
                 │                      │
                 │ warn / mask / cancel │ observe | enforce
                 ▼                      ▼
            Journal + API MMC      Events source=proxy
```

**Double filet** : un utilisateur en mode *warn* peut cliquer « Envoyer quand même » ; si le **proxy est en enforce**, la requête peut encore être **coupée** avant d’atteindre le fournisseur IA.

---

## 4. Ce qui est filtré (catalogue données sensibles)

Moteur commun **`@opsgate/engine`** (extension + proxy). Pack embarqué ; l’org peut publier / activer des packs (console).

### 4.1 Secrets applicatifs & cloud

| ID règle | Libellé | Sévérité | Action défaut | Exemple |
|----------|---------|----------|---------------|---------|
| `aws-access-key` | AWS Access Key | high | mask | `AKIA…` |
| `aws-secret-key` | AWS Secret Key | high | mask | `aws_secret_access_key=…` |
| `generic-api-key` | API Key / Token | high | mask | `api_key=…`, `sk-…`, `ghp_…` |
| `private-key` | Clé privée PEM | high | mask | `-----BEGIN PRIVATE KEY-----` |
| `password-assignment` | Mot de passe assigné | high | mask | `password=Secret123` |
| `connection-string` | URL avec credentials | high | mask | `postgres://user:pass@host` |
| `azure-secrets` | Secrets Azure | high | mask | AccountKey, ClientSecret |
| `gcp-service-account` | Compte de service GCP | high | mask | JSON service_account, `AIza…` |
| `stripe-keys` | Clés Stripe | high | mask | `sk_live_…` |
| `openai-anthropic-keys` | Clés vendors IA | high | mask | `sk-proj-…`, `sk-ant-…` |
| `gitlab-discord-tokens` | Tokens GitLab / GitHub / Discord | high | mask | `glpat-…` |
| `dotenv-secrets` | Fichier .env | high | mask | `DATABASE_URL=…` |
| `npm-pypi-tokens` | Tokens packages | high | mask | `npm_…`, `pypi-…` |
| `jwt-token` | JWT / Bearer long | medium | mask | Session navigateur : **pas de coupe proxy** |
| `license-key` | Clé de licence logicielle | medium | mask | `XXXX-XXXX-…` |

### 4.2 Données financières & PII

| ID | Libellé | Sévérité | Action défaut | Notes |
|----|---------|----------|---------------|-------|
| `credit-card` | **Carte bancaire (Visa / Mastercard / Amex…)** | high | mask | Luhn + anti-faux positifs |
| `iban` | **IBAN** | high | mask | Structure + contexte bancaire |
| `email-address` | E-mail | low | warn | PII légère |
| `phone-fr` | Téléphone FR / intl | low | warn | PII légère |

**Oui** : les cartes Visa / Mastercard sont des données sensibles au même titre que l’IBAN (sévérité high, masquage par défaut).

### 4.3 Infrastructure / réseau (configs collées dans un chat)

| ID | Équipement / techno | Sévérité |
|----|---------------------|----------|
| `fortinet-config` | Fortinet / FortiGate | high |
| `cisco-config` | Cisco IOS / NX-OS | high |
| `juniper-config` | Juniper Junos | high |
| `huawei-vrp-config` | Huawei VRP | high |
| `mikrotik-routeros` | MikroTik | high |
| `palo-alto-config` | Palo Alto PAN-OS | high |
| `pfsense-opnsense` | pfSense / OPNsense | high |
| `wireguard-openvpn` | VPN WireGuard / OpenVPN | high |
| `arista-eos` | Arista EOS | high |
| `network-credentials` | SNMP / RADIUS / PSK | high |
| `ssh-rdp-credentials` | SSH / RDP / OpenSSH | high |
| `kubernetes-secrets` | Secrets K8s / dockerconfig | high |
| `sftp-ftp-uris` | URI SFTP/FTP avec mdp | high |
| `cloud-iam-snippets` | IAM trop permissif / ARN | medium |
| `ip-private-block` | IP privées (contexte infra) | low (warn) |

---

## 5. Comment le blocage s’applique (clair pour le comité)

### 5.1 Modes policy extension

| Mode | Comportement utilisateur | Les données partent-elles vers l’IA ? |
|------|--------------------------|---------------------------------------|
| **warn** | Alerte ; choix mask / envoyer quand même / annuler | Si « envoyer quand même » → **oui** (sauf proxy enforce) |
| **mask_recommend** | Propose de masquer | Si mask → secrets **obfusqués** |
| **mask_force** | Masquage obligatoire | Secrets masqués ou envoi refusé |
| **block** | Envoi refusé côté page | **Non** (DOM) |

### 5.2 Proxy local

| Mode proxy | Effet |
|------------|--------|
| **observe** | Journal MMC uniquement — **ne coupe pas** |
| **enforce** | Coupe le flux client→serveur si détection **actionnable** (high / medium métier ; **hors** JWT de session, e-mail seul, téléphone, IP privée seule) |

**Anti-casse sites IA** : les JWT de session (`Authorization: Bearer eyJ…`) et cookies d’auth **ne coupent pas** l’accès au site — ce sont des jetons techniques du navigateur, pas un secret collé dans le prompt.

### 5.3 Forme du masquage (mask)

- Carte → `XXXX-XXXX-XXXX-1234`
- Clé API → préfixe + `XXXX…` + fin  
- E-mail → `aXXX@domaine`  
- IBAN → préfixe pays + XXXX + fin  

Pas un effacement total illisible : preuve d’action + usage métier encore possible sur le reste du texte.

---

## 6. Périmètre multi-IA

Filtrage proxy MITM sur **allowlist** (et sous-domaines), multi-fournisseurs :  
ChatGPT / OpenAI, Claude, Gemini / Bard / AI Studio, Copilot, Grok, Perplexity, DeepSeek, Mistral, Groq, Meta AI, Poe, You.com, HuggingFace, OpenRouter, Together, Fireworks, Phind, etc.

- **Extension** : catalogue HostPicker + hosts custom policy.  
- **Proxy** : allowlist par défaut + `OPSGATE_PROXY_ALLOWLIST` + hosts policy synchronisés.  
- **Hors allowlist** → tunnel transparent (pas de déchiffrement OpsGate).

---

## 7. Journalisation & gouvernance

| Élément | Description |
|---------|-------------|
| **Events MMC** | `mask_send`, `send_anyway`, `cancel`, `observe`, `block`, enroll… |
| **Catégories de logs** | Désactivation possible des events proxy / détection (bruit) |
| **Rétention** | Configurable (défaut produit 90 j) |
| **Export** | CSV / JSON events ; CSV / JSON **agents** (inventaire) |
| **SIEM / Syslog / Grafana** | **Roadmap V2** |

---

## 8. Responsabilités (RACI simplifié)

| Acteur | Responsabilité |
|--------|----------------|
| **DSI / RSSI** | Valider périmètre (hosts IA, warn vs enforce), packs, rétention, future SIEM |
| **Admin OpsGate** | Console, licences, groupes, moving rules, monitoring — guide utilisateur |
| **Utilisateur** | Respecter les alertes ; ne pas coller de secrets dans les prompts |
| **DailyOps.Tech** | Produit OpsGate, training, runbooks, support |

---

## 9. Formation DailyOps.tech (plan)

À publier sur **[DailyOps.tech](https://dailyops.tech)** (parcours DSI + parcours admin) :

1. **Pourquoi OpsGate** (ce document, version courte)  
2. **Installer** : API + console + extension Chromium + proxy optionnel  
3. **Configurer** : code org, licences, hosts IA, policy, packs  
4. **Proxy** : CA, mode observe vs enforce  
5. **Dashboard** : en ligne / inactif / hors ligne, décisions, events  
6. **Exercices** : faux IBAN / carte test / clé AWS  
7. **Incidents** : 403 proxy, récupération d’accès, mode observe de secours  

---

## 10. Documents associés

| Document | Public |
|----------|--------|
| **Ce document** | DSI / RSSI / décideurs |
| `GUIDE-UTILISATEUR.md` (+ PDF / DOCX) | Admins & pilotes |
| `architecture/PROXY-RUNBOOK.md` | Ops technique proxy |
| `STATUS-V2.md` / `V2-BACKLOG.md` / `architecture/PLATFORM-v2.md` | Statut V2 + roadmap |
| Charte visuelle | Navy `#0A1128` · Teal `#2BD9C5` · Soft `#E6FAF7` · assets `packages/console/public/brand/` |

---

## 11. FAQ décideurs

**Q. Un utilisateur clique « Envoyer quand même » en mode warn — les données partent-elles ?**  
A. Côté page, oui. Si le **proxy est en enforce**, la requête peut encore être **coupée** : double filet.

**Q. Pourquoi un JWT peut apparaître dans les logs ?**  
A. C’est un **jeton de session** du site IA. Il **ne bloque plus l’accès** au site ; seuls les secrets collés dans le contenu utilisateur sont actionnables en enforce.

**Q. Peut-on prouver ce qui a été bloqué ?**  
A. Oui : journal MMC (`block` / `observe`, règles, horodatage, device). Export CSV pour audit.

**Q. Multi-navigateur ?**  
A. Chromium (Chrome, Edge, Brave, Opera) dès aujourd’hui. Firefox / Safari : V2.

---

<div style="margin-top: 36px; padding: 20px 24px; background: linear-gradient(135deg, #0A1128, #111C44); border-radius: 12px; border-top: 3px solid #2BD9C5; color: #e2e8f0; font-size: 0.9rem;">
  <div style="color: #2BD9C5; font-weight: 700; letter-spacing: 0.06em; font-size: 11px; text-transform: uppercase; margin-bottom: 8px;">OpsGate · DailyOps.Tech</div>
  <div style="font-weight: 650; color: #fff; margin-bottom: 6px;">Protégez les données de votre entreprise dans chaque interaction avec l’IA.</div>
  <div style="color: #94a3b8;">Contact & training : site DailyOps.tech · Document confidentiel usage interne / évaluation DSI</div>
</div>

</div>
