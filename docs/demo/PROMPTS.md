# Prompts de démo (copier-coller)

> Tous les secrets ci-dessous sont **factices**.

---

## Prompt A — Sans alerte (contrôle)

```
Peux-tu m'expliquer la différence entre un VLAN access et un VLAN trunk,
et dans quels cas utiliser le tagging 802.1Q sur un switch d'accès ?
Réponds de façon concise avec un exemple simple.
```

---

## Prompt B — Secrets applicatifs (bandeau attendu)

```
J'ai un souci d'auth sur mon API staging. Voici la config que j'utilise :

API_KEY=sk-abcdefghijklmnopqrstuvwxyz123456
password=DemoSuperSecret99!
GITHUB_TOKEN=ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef12

Peux-tu me dire si mon header Authorization est correct ?
```

**Actions à montrer :** Voir les détails → Masquer & Envoyer

---

## Prompt C — Config Fortinet (infra)

```
Voici un extrait de ma FortiGate, tu peux m'aider à comprendre cette policy ?

config system interface
    edit "port1"
        set ip 10.20.30.1 255.255.255.0
        set allowaccess ping https ssh
    next
end
config firewall policy
    edit 10
        set name "LAN-to-WAN"
        set srcintf "port1"
        set dstintf "wan1"
        set action accept
        set password DemoFGT#2026
    next
end

fortinet — pourquoi le set allowaccess est-il trop permissif ?
```

---

## Prompt D — MikroTik (infra alternative)

```
Sur mon MikroTik j'ai collé ça, c'est OK pour la prod ?

mikrotik
/ip address add address=192.168.88.1/24 interface=bridge
/ip firewall filter add chain=input action=accept
/ppp secret add name=vpnuser password="MikroTikDemoPass1"

Quels risques tu vois ?
```

---

## Prompt E — WireGuard (VPN)

```
Voici mon peer WireGuard de test, corrige la conf si besoin :

wireguard
[Interface]
PrivateKey = aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789abcd=
Address = 10.8.0.2/32

[Peer]
PublicKey = zYxWvUtSrQpOnMlKjIhGfEdCbA9876543210zyxw=
AllowedIPs = 0.0.0.0/0
Endpoint = vpn.demo.local:51820
```

---

## Prompt F — Cloud (Azure / Stripe style)

```
Pour mon script de backup Azure j'ai ça en .env, c'est safe de le mettre dans ChatGPT ?

AZURE_CLIENT_SECRET=DemoAzureSecret-ab12cd34ef
DefaultEndpointsProtocol=https;AccountName=demodatalake;AccountKey=dGVzdEtleUZvckRlbW9Pbmx5Tm90UmVhbDEyMzQ1Njc4OTA=
stripe_key=sk_live_DEMO_ONLY_PLACEHOLDER_NOT_REAL_0000
```
*(Le motif `sk_live_…` doit être détecté ; ce n’est pas une vraie clé Stripe.)*

---

## Prompt G — Faux positif volontaire (option avancée)

```
Dans la doc on met souvent password=password et user@example.com
comme placeholders. OpsGate ne devrait pas sur-alerter là-dessus.
```

*(Montre que le produit évite le bruit inutile.)*
