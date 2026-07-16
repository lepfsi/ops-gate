#!/usr/bin/env python3
"""Génère docs/DSI-FILTRAGE-DONNEES-SENSIBLES.pdf — charte DailyOps + BrandMark."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from pdf_brand import (  # noqa: E402
    NAVY,
    TEAL,
    WHITE,
    draw_brand_mark,
    draw_login_brand,
    font_name,
    register_fonts,
)
from pdf_md_render import (  # noqa: E402
    draw_cover,
    ensure_space,
    flush_table,
    make_doc_pdf,
    reset_x,
    uw,
    write_callout,
    write_heading,
    write_text,
)

OUT = ROOT / "docs" / "DSI-FILTRAGE-DONNEES-SENSIBLES.pdf"


def h1(pdf, text: str) -> None:
    write_heading(pdf, text, 2)


def h2(pdf, text: str) -> None:
    write_heading(pdf, text, 3)


def body(pdf, text: str) -> None:
    ensure_space(pdf, 10)
    write_text(pdf, text, size=10, line_h=5.3)


def bold(pdf, text: str) -> None:
    ensure_space(pdf, 8)
    write_text(pdf, text, size=10, style="B", line_h=5.3)


def bullet(pdf, text: str) -> None:
    ensure_space(pdf, 8)
    write_text(pdf, "•  " + text, size=10, line_h=5.2)


def table(pdf, headers: list[str], rows: list[list[str]], _col_w: list[float] | None = None) -> None:
    """Tableau multi-ligne ; col_w ignoré (calcul auto proportionnel)."""
    flush_table(pdf, [headers] + rows)


def reason_card(pdf, title: str, text: str) -> None:
    from pdf_md_render import _wrap_lines, usable_bottom
    from pdf_brand import SLATE, GRAY

    pdf.ln(1.5)
    x0 = pdf.l_margin
    w = uw(pdf)
    title_lines = _wrap_lines(pdf, title, w - 12, 10, "B")
    body_lines = _wrap_lines(pdf, text, w - 12, 9, "")
    h = 8 + len(title_lines) * 5 + len(body_lines) * 4.6 + 6
    if pdf.get_y() + h > usable_bottom(pdf):
        pdf.add_page()
        reset_x(pdf)
    y0 = pdf.get_y()
    pdf.set_draw_color(*SLATE)
    pdf.set_line_width(0.3)
    pdf.set_fill_color(*WHITE)
    pdf.rect(x0, y0, w, h, "DF")
    pdf.set_fill_color(*TEAL)
    pdf.rect(x0, y0, w, 2.6, "F")
    ty = y0 + 5
    pdf.set_font(font_name(), "B", 10)
    pdf.set_text_color(*NAVY)
    for ln in title_lines:
        pdf.set_xy(x0 + 6, ty)
        pdf.cell(w - 12, 5, ln)
        ty += 5
    pdf.set_font(font_name(), "", 9)
    pdf.set_text_color(*GRAY)
    for ln in body_lines:
        pdf.set_xy(x0 + 6, ty)
        pdf.cell(w - 12, 4.6, ln)
        ty += 4.6
    pdf.set_y(y0 + h + 2)
    reset_x(pdf)


def main() -> None:
    pdf = make_doc_pdf(
        "OpsGate  |  Document DSI / RSSI  |  DailyOps.Tech",
        footer_extra="Document DSI / RSSI",
    )
    register_fonts(pdf)
    pdf.add_page()
    draw_cover(
        pdf,
        "Document DSI / RSSI",
        "Données sensibles filtrées et bloquées",
        lang="FR",
        extra_lines=[
            "Protégez les données de votre entreprise dans chaque interaction avec l'IA.",
            "Public : DSI  ·  RSSI  ·  Comités sécurité",
            "Version produit V1.2+ / V2  ·  Confidentiel — usage évaluation interne",
        ],
    )
    pdf.add_page()

    draw_login_brand(
        pdf,
        pdf.l_margin,
        pdf.get_y(),
        mark_size=36,
        title="OpsGate",
        subtitle="Console MMC · DailyOps.Tech",
        light=False,
    )
    pdf.ln(6)

    write_callout(
        pdf,
        "Ce document n'est pas le manuel administrateur. Il s'adresse aux organes décisionnels : "
        "que propose OpsGate, pourquoi l'adopter, puis quoi est filtré et comment le blocage s'applique.",
    )

    h1(pdf, "1. La solution que nous proposons")
    h2(pdf, "En une phrase")
    body(
        pdf,
        "OpsGate est la plateforme DailyOps.Tech qui empêche (ou alerte avant) l'exfiltration "
        "involontaire de secrets, de données financières et de configurations d'infrastructure "
        "lorsque vos collaborateurs utilisent ChatGPT, Claude, Gemini, Copilot, Grok et les autres "
        "services d'IA générative.",
    )
    h2(pdf, "Le problème métier")
    body(
        pdf,
        "L'IA est déjà dans l'entreprise. Les équipes collent dans les prompts des clés API, "
        "des IBAN et numéros de carte, des extraits de config firewall / routeur / VPN, des "
        "fichiers .env et tokens Git. Une seule erreur = fuite vers un fournisseur tiers. "
        "Les DLP génériques et CASB lourds sont souvent trop larges, lents à déployer, ou "
        "aveugles au contenu réellement collé dans un chat IA.",
    )
    h2(pdf, "Ce qu'OpsGate apporte")
    table(
        pdf,
        ["Pilier", "Bénéfice pour la DSI"],
        [
            ["Protection au point d'usage", "Au moment du prompt / fichier, dans le navigateur."],
            ["Double filet", "Extension (warn / mask / block) + proxy local (observe / enforce)."],
            ["Gouvernance centralisée", "Console MMC : policies, packs, licences, journal, export."],
            ["Privacy by design", "Pas de relecture des conversations chez le fournisseur IA."],
            ["Déploiement progressif", "Pilote warn → mask / block / proxy enforce."],
            ["Multi-IA", "Pas un verrou ChatGPT seul : catalogue large de services IA."],
        ],
    )

    h1(pdf, "2. Pourquoi choisir OpsGate")
    reason_card(
        pdf,
        "1. Spécialisé IA, pas un DLP générique",
        "Conçu pour le risque prompt / fichier vers l'IA : sites ciblés, règles secrets + finance + configs réseau, modes adaptés au terrain (warn → mask → block).",
    )
    reason_card(
        pdf,
        "2. Preuve et pilotage pour le comité",
        "Dashboard licences, connectivité agents, décisions (masquer / envoyer quand même / annuler / block proxy), export CSV/JSON pour l'audit.",
    )
    reason_card(
        pdf,
        "3. Adoption réaliste",
        "Mode warn pour former et mesurer ; mask pour corriger sans bloquer le métier ; proxy enforce pour le filet réseau. Maintenance agents (congés / panne) pour éviter les faux positifs ops.",
    )
    reason_card(
        pdf,
        "4. Éditeur DailyOps.Tech",
        "Produit terrain ops & sécurité, charte navy #0A1128 + teal #2BD9C5, même marque que la page de login MMC (BrandMark porte/bouclier).",
    )
    reason_card(
        pdf,
        "5. Trajectoire V2 alignée entreprise",
        "Roadmap : SIEM / syslog, métriques Grafana, multi-navigateur (Firefox…), SSO/MFA, store — sécuriser le risque IA dès aujourd'hui en V1.x.",
    )
    h2(pdf, "Ce qu'OpsGate n'est pas")
    table(
        pdf,
        ["Non-objectif", "Pourquoi le dire"],
        [
            ["CASB / DLP sur tout Internet", "Périmètre volontairement IA pour ROI clair."],
            ["Lecture historiques fournisseur", "Respect privacy ; pas de session replay."],
            ["Antivirus / EDR", "Complément, pas remplacement de votre stack endpoint."],
        ],
    )

    h1(pdf, "3. Comment ça marche (vue décideur)")
    table(
        pdf,
        ["Couche", "Rôle", "Bloque réseau ?"],
        [
            ["Extension navigateur", "Détecte prompt / fichiers ; warn mask cancel", "Côté page (DOM)"],
            ["Proxy local (option)", "MITM allowlist multi-IA ; observe ou enforce", "Oui en enforce"],
            ["Control plane", "Policies, packs, licences, MMC, exports", "Gouvernance"],
        ],
    )
    body(
        pdf,
        "Double filet : un utilisateur en mode warn peut cliquer « Envoyer quand même » ; "
        "si le proxy est en enforce, la requête peut encore être coupée avant d'atteindre le fournisseur IA.",
    )

    h1(pdf, "4. Ce qui est filtré (catalogue)")
    body(
        pdf,
        "Moteur commun @opsgate/engine (extension + proxy). Pack embarqué ; l'org peut publier / activer des packs.",
    )
    h2(pdf, "4.1 Secrets applicatifs & cloud")
    table(
        pdf,
        ["Règle", "Sév.", "Action", "Exemple"],
        [
            ["AWS Access / Secret Key", "high", "mask", "AKIA…, aws_secret=…"],
            ["API Key / Token", "high", "mask", "api_key, sk-, ghp_, xox"],
            ["Clé privée PEM", "high", "mask", "BEGIN PRIVATE KEY"],
            ["Mot de passe assigné", "high", "mask", "password=Secret123"],
            ["URL connexion / Azure / GCP", "high", "mask", "postgres://, AccountKey"],
            ["Clés Stripe / vendors IA", "high", "mask", "sk_live_, sk-proj-"],
            ["Tokens GitLab / npm / .env", "high", "mask", "glpat-, npm_, DATABASE_URL"],
            ["JWT / Bearer session", "med.", "mask*", "eyJ… (*pas de coupe proxy)"],
            ["Clé de licence", "med.", "mask", "XXXX-XXXX-XXXX"],
        ],
    )
    h2(pdf, "4.2 Données financières & PII")
    table(
        pdf,
        ["Règle", "Sév.", "Action", "Notes"],
        [
            ["Carte bancaire (Visa/MC/Amex)", "high", "mask", "Luhn + anti-faux positifs"],
            ["IBAN", "high", "mask", "Structure + contexte bancaire"],
            ["E-mail", "low", "warn", "PII légère"],
            ["Téléphone FR / intl", "low", "warn", "PII légère"],
        ],
    )
    bold(
        pdf,
        "Oui : les cartes Visa / Mastercard sont des données sensibles au même titre que l'IBAN (sévérité high).",
    )
    h2(pdf, "4.3 Infrastructure / réseau")
    body(
        pdf,
        "Fortinet, Cisco, Juniper, Huawei, MikroTik, Palo Alto, pfSense/OPNsense, WireGuard/OpenVPN, "
        "Arista, SNMP/RADIUS/PSK, SSH/RDP, Secrets Kubernetes, URI SFTP/FTP avec mdp, IAM cloud "
        "(sévérité high sauf IP privées en warn et IAM medium).",
    )

    h1(pdf, "5. Comment le blocage s'applique")
    h2(pdf, "Modes policy extension")
    table(
        pdf,
        ["Mode", "Comportement", "Données vers l'IA ?"],
        [
            ["warn", "Alerte ; mask / envoyer / annuler", "Si envoyer → oui (sauf proxy enforce)"],
            ["mask_recommend", "Propose de masquer", "Secrets obfusqués si mask"],
            ["mask_force", "Masquage obligatoire", "Masqués ou envoi refusé"],
            ["block", "Envoi refusé côté page", "Non (DOM)"],
        ],
    )
    h2(pdf, "Proxy local")
    table(
        pdf,
        ["Mode", "Effet"],
        [
            ["observe", "Journal MMC uniquement — ne coupe pas"],
            ["enforce", "Coupe si détection actionnable (hors JWT session, email, tél., IP seule)"],
        ],
    )
    write_callout(
        pdf,
        "Anti-casse sites IA : les JWT de session (Authorization: Bearer eyJ…) et cookies d'auth "
        "ne coupent pas l'accès au site — jetons techniques du navigateur, pas un secret collé dans le prompt.",
    )
    h2(pdf, "Forme du masquage")
    bullet(pdf, "Carte → XXXX-XXXX-XXXX-1234")
    bullet(pdf, "Clé API → préfixe + XXXX… + fin")
    bullet(pdf, "E-mail → aXXX@domaine")
    bullet(pdf, "IBAN → préfixe pays + XXXX + fin")

    h1(pdf, "6. Périmètre multi-IA")
    body(
        pdf,
        "Filtrage proxy MITM sur allowlist (et sous-domaines) : ChatGPT/OpenAI, Claude, Gemini/Bard/AI Studio, "
        "Copilot, Grok, Perplexity, DeepSeek, Mistral, Groq, Meta AI, Poe, You.com, HuggingFace, OpenRouter, "
        "Together, Fireworks, Phind, etc. Hors allowlist = tunnel transparent (pas de déchiffrement OpsGate).",
    )

    h1(pdf, "7. Journalisation & gouvernance")
    table(
        pdf,
        ["Élément", "Description"],
        [
            ["Events MMC", "mask_send, send_anyway, cancel, observe, block, enroll…"],
            ["Catégories de logs", "Désactivation possible events proxy / détection"],
            ["Rétention", "Configurable (défaut produit 90 j)"],
            ["Export", "CSV/JSON events et agents (inventaire)"],
            ["SIEM / Syslog / Grafana", "Roadmap V2"],
        ],
    )

    h1(pdf, "8. Responsabilités (RACI simplifié)")
    table(
        pdf,
        ["Acteur", "Responsabilité"],
        [
            ["DSI / RSSI", "Périmètre hosts IA, warn vs enforce, packs, rétention, SIEM futur"],
            ["Admin OpsGate", "Console, licences, groupes, monitoring — guide utilisateur"],
            ["Utilisateur", "Respecter les alertes ; ne pas coller de secrets"],
            ["DailyOps.Tech", "Produit OpsGate, training, runbooks, support"],
        ],
    )

    h1(pdf, "9. Formation DailyOps.tech")
    body(pdf, "À publier sur DailyOps.tech (parcours DSI + parcours admin) :")
    for i, s in enumerate(
        [
            "Pourquoi OpsGate (ce document, version courte)",
            "Installer : API + console + extension Chromium + proxy optionnel",
            "Configurer : code org, licences, hosts IA, policy, packs",
            "Proxy : CA, mode observe vs enforce",
            "Dashboard : en ligne / inactif / hors ligne, décisions, events",
            "Exercices : faux IBAN / carte test / clé AWS",
            "Incidents : 403 proxy, récupération d'accès, mode observe de secours",
        ],
        1,
    ):
        bullet(pdf, f"{i}. {s}")

    h1(pdf, "10. FAQ décideurs")
    bold(pdf, "Q. « Envoyer quand même » en mode warn — les données partent-elles ?")
    body(
        pdf,
        "A. Côté page, oui. Si le proxy est en enforce, la requête peut encore être coupée : double filet.",
    )
    pdf.ln(1)
    bold(pdf, "Q. Pourquoi un JWT peut apparaître dans les logs ?")
    body(
        pdf,
        "A. Jeton de session du site IA. Il ne bloque plus l'accès au site ; seuls les secrets collés dans le contenu utilisateur sont actionnables en enforce.",
    )
    pdf.ln(1)
    bold(pdf, "Q. Peut-on prouver ce qui a été bloqué ?")
    body(pdf, "A. Oui : journal MMC (block / observe, règles, horodatage, device). Export CSV pour audit.")
    pdf.ln(1)
    bold(pdf, "Q. Multi-navigateur ?")
    body(pdf, "A. Chromium (Chrome, Edge, Brave, Opera) dès aujourd'hui. Firefox / Safari : V2.")

    # closing
    pdf.ln(8)
    ensure_space(pdf, 36)
    y = pdf.get_y()
    pdf.set_fill_color(*NAVY)
    pdf.rect(pdf.l_margin, y, uw(pdf), 34, "F")
    pdf.set_fill_color(*TEAL)
    pdf.rect(pdf.l_margin, y, uw(pdf), 2.5, "F")
    draw_brand_mark(pdf, pdf.l_margin + 8, y + 8, 18)
    pdf.set_xy(pdf.l_margin + 32, y + 9)
    pdf.set_font(font_name(), "B", 9)
    pdf.set_text_color(*TEAL)
    pdf.cell(0, 5, "OPSGATE  ·  DAILYOPS.TECH")
    pdf.set_xy(pdf.l_margin + 32, y + 17)
    pdf.set_font(font_name(), "B", 10)
    pdf.set_text_color(*WHITE)
    pdf.multi_cell(
        uw(pdf) - 40,
        5,
        "Protégez les données de votre entreprise dans chaque interaction avec l'IA.",
    )

    OUT.parent.mkdir(parents=True, exist_ok=True)
    pdf.output(str(OUT))
    print(f"OK {OUT.name}  pages={pdf.page_no()}  {OUT.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
