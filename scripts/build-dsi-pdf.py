#!/usr/bin/env python3
"""Génère docs/DSI-FILTRAGE-DONNEES-SENSIBLES.pdf — charte DailyOps + BrandMark login MMC."""
from __future__ import annotations

import sys
from pathlib import Path

from fpdf import FPDF

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from pdf_brand import (  # noqa: E402
    GRAY,
    INK,
    MUTED,
    NAVY,
    NAVY2,
    SLATE,
    TEAL,
    TEAL_SOFT,
    WHITE,
    draw_brand_mark,
    draw_login_brand,
    font_name,
    register_fonts,
)

OUT = ROOT / "docs" / "DSI-FILTRAGE-DONNEES-SENSIBLES.pdf"


class DsiPDF(FPDF):
    def header(self) -> None:
        if self.page_no() == 1:
            return
        self.set_fill_color(*NAVY)
        self.rect(0, 0, self.w, 15, "F")
        draw_brand_mark(self, self.l_margin, 2.5, 10)
        self.set_xy(self.l_margin + 14, 4)
        self.set_font(font_name(), "B", 9)
        self.set_text_color(*WHITE)
        self.cell(0, 7, "OpsGate  |  Document DSI / RSSI  |  DailyOps.Tech")
        self.set_draw_color(*TEAL)
        self.set_line_width(1.3)
        self.line(0, 15, self.w, 15)
        self.set_y(20)

    def footer(self) -> None:
        if self.page_no() == 1:
            return
        self.set_y(-13)
        self.set_draw_color(*TEAL)
        self.set_line_width(0.5)
        self.line(self.l_margin, self.get_y(), self.w - self.r_margin, self.get_y())
        self.set_y(-10)
        self.set_font(font_name(), "", 8)
        self.set_text_color(*GRAY)
        self.cell(
            0,
            7,
            f"Page {self.page_no() - 1}  ·  DailyOps.Tech  ·  Confidentiel évaluation DSI",
            align="C",
        )


def uw(pdf: FPDF) -> float:
    return pdf.w - pdf.l_margin - pdf.r_margin


def ensure_space(pdf: FPDF, need: float) -> None:
    if pdf.get_y() + need > pdf.h - 18:
        pdf.add_page()


def h1(pdf: FPDF, text: str) -> None:
    ensure_space(pdf, 16)
    pdf.ln(3)
    pdf.set_font(font_name(), "B", 14)
    pdf.set_text_color(*NAVY)
    pdf.multi_cell(uw(pdf), 7, text)
    y = pdf.get_y()
    pdf.set_draw_color(*TEAL)
    pdf.set_line_width(1.0)
    pdf.line(pdf.l_margin, y + 0.5, pdf.l_margin + 32, y + 0.5)
    pdf.ln(3)


def h2(pdf: FPDF, text: str) -> None:
    # Assez d'espace pour le titre + au moins 3 lignes de suite (évite titres orphelins)
    ensure_space(pdf, 36)
    pdf.ln(2)
    pdf.set_font(font_name(), "B", 11)
    pdf.set_text_color(*NAVY2)
    pdf.multi_cell(uw(pdf), 6, text)
    pdf.ln(1)


def body(pdf: FPDF, text: str, size: int = 10) -> None:
    ensure_space(pdf, 10)
    pdf.set_font(font_name(), "", size)
    pdf.set_text_color(*INK)
    pdf.set_x(pdf.l_margin)
    pdf.multi_cell(uw(pdf), 5.3, text)


def bold(pdf: FPDF, text: str) -> None:
    ensure_space(pdf, 8)
    pdf.set_font(font_name(), "B", 10)
    pdf.set_text_color(*INK)
    pdf.set_x(pdf.l_margin)
    pdf.multi_cell(uw(pdf), 5.3, text)


def bullet(pdf: FPDF, text: str) -> None:
    ensure_space(pdf, 8)
    pdf.set_font(font_name(), "", 10)
    pdf.set_text_color(*INK)
    pdf.set_x(pdf.l_margin)
    pdf.multi_cell(uw(pdf), 5.2, f"  •  {text}")


def callout(pdf: FPDF, text: str) -> None:
    pdf.ln(2)
    ensure_space(pdf, 22)
    x, y = pdf.l_margin, pdf.get_y()
    w = uw(pdf)
    pdf.set_font(font_name(), "", 9)
    # fixed estimate
    nlines = max(2, int(len(text) / 90) + 1)
    h = 8 + nlines * 4.8
    pdf.set_fill_color(*TEAL_SOFT)
    pdf.rect(x, y, w, h, "F")
    pdf.set_fill_color(*TEAL)
    pdf.rect(x, y, 3.2, h, "F")
    pdf.set_xy(x + 7, y + 3)
    pdf.set_text_color(*NAVY)
    pdf.multi_cell(w - 12, 4.8, text)
    pdf.set_y(y + h + 3)


def reason_card(pdf: FPDF, title: str, text: str) -> None:
    pdf.ln(1.5)
    ensure_space(pdf, 28)
    x, y = pdf.l_margin, pdf.get_y()
    w = uw(pdf)
    nlines = max(2, int(len(text) / 95) + 1)
    h = 16 + nlines * 4.6
    pdf.set_draw_color(*SLATE)
    pdf.set_line_width(0.3)
    pdf.set_fill_color(*WHITE)
    pdf.rect(x, y, w, h, "DF")
    pdf.set_fill_color(*TEAL)
    pdf.rect(x, y, w, 2.6, "F")
    pdf.set_xy(x + 6, y + 5)
    pdf.set_font(font_name(), "B", 10)
    pdf.set_text_color(*NAVY)
    pdf.multi_cell(w - 12, 5, title)
    pdf.set_x(x + 6)
    pdf.set_font(font_name(), "", 9)
    pdf.set_text_color(*GRAY)
    pdf.multi_cell(w - 12, 4.6, text)
    pdf.set_y(y + h + 2)


def table(pdf: FPDF, headers: list[str], rows: list[list[str]], col_w: list[float]) -> None:
    """Table simple 1 ligne / cellule (pas de multi_cell multi-page)."""
    pdf.ln(2)
    ensure_space(pdf, 14 + 6 * min(3, len(rows)))
    w = sum(col_w)
    # header
    pdf.set_fill_color(*NAVY)
    pdf.set_text_color(*WHITE)
    pdf.set_font(font_name(), "B", 8)
    x0 = pdf.l_margin
    for i, h in enumerate(headers):
        pdf.set_x(x0 + sum(col_w[:i]))
        pdf.cell(col_w[i], 7, h[:48], fill=True, border=0)
    pdf.ln(7)
    pdf.set_draw_color(*TEAL)
    pdf.set_line_width(0.7)
    pdf.line(x0, pdf.get_y(), x0 + w, pdf.get_y())

    fill = False
    for row in rows:
        ensure_space(pdf, 8)
        if fill:
            pdf.set_fill_color(*TEAL_SOFT)
        else:
            pdf.set_fill_color(*WHITE)
        pdf.set_text_color(*INK)
        pdf.set_font(font_name(), "", 8)
        y = pdf.get_y()
        # fond ligne
        pdf.rect(x0, y, w, 6.5, "F")
        for i, cell in enumerate(row):
            pdf.set_xy(x0 + sum(col_w[:i]), y + 0.8)
            # truncate to fit
            txt = str(cell)
            max_c = max(8, int(col_w[i] / 1.7))
            if len(txt) > max_c:
                txt = txt[: max_c - 1] + "…"
            pdf.cell(col_w[i], 5, txt, border=0)
        pdf.set_y(y + 6.5)
        fill = not fill
    pdf.ln(2)


def cover(pdf: DsiPDF) -> None:
    pdf.set_fill_color(*NAVY)
    pdf.rect(0, 0, pdf.w, pdf.h, "F")
    pdf.set_fill_color(*TEAL)
    pdf.rect(0, 0, pdf.w, 7, "F")
    pdf.rect(0, pdf.h - 9, pdf.w, 9, "F")

    # BrandMark centré (même que login MMC)
    mark = 56
    mx = (pdf.w - mark) / 2
    my = 48
    draw_brand_mark(pdf, mx, my, mark)

    pdf.set_y(my + mark + 14)
    pdf.set_font(font_name(), "B", 30)
    pdf.set_text_color(*WHITE)
    pdf.cell(0, 12, "OpsGate", align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(2)
    pdf.set_font(font_name(), "", 12)
    pdf.set_text_color(*TEAL)
    pdf.cell(0, 7, "DailyOps.Tech", align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(10)
    pdf.set_font(font_name(), "B", 13)
    pdf.set_text_color(*WHITE)
    pdf.set_x(28)
    pdf.multi_cell(
        pdf.w - 56,
        7,
        "Protégez les données de votre entreprise\ndans chaque interaction avec l'IA.",
        align="C",
    )
    pdf.ln(10)
    pdf.set_draw_color(*TEAL)
    pdf.set_line_width(1.3)
    mid = pdf.w / 2
    pdf.line(mid - 28, pdf.get_y(), mid + 28, pdf.get_y())
    pdf.ln(12)
    pdf.set_font(font_name(), "B", 14)
    pdf.set_text_color(*WHITE)
    pdf.cell(0, 8, "Document DSI / RSSI", align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font(font_name(), "", 11)
    pdf.set_text_color(*MUTED)
    pdf.cell(
        0,
        7,
        "Données sensibles filtrées et bloquées",
        align="C",
        new_x="LMARGIN",
        new_y="NEXT",
    )
    pdf.ln(14)
    pdf.set_font(font_name(), "", 9)
    pdf.set_text_color(*TEAL)
    pdf.cell(
        0,
        6,
        "Public : DSI  ·  RSSI  ·  Comités sécurité",
        align="C",
        new_x="LMARGIN",
        new_y="NEXT",
    )
    pdf.set_text_color(*MUTED)
    pdf.cell(
        0,
        6,
        "Version produit V1.2+ / V2  ·  16 juillet 2026",
        align="C",
        new_x="LMARGIN",
        new_y="NEXT",
    )
    pdf.cell(
        0,
        6,
        "Confidentiel — usage évaluation interne",
        align="C",
        new_x="LMARGIN",
        new_y="NEXT",
    )
    pdf.add_page()


def main() -> None:
    pdf = DsiPDF()
    pdf.set_auto_page_break(auto=True, margin=16)
    pdf.set_margins(16, 22, 16)
    register_fonts(pdf)
    pdf.add_page()
    cover(pdf)

    # Login-style brand strip on page 2
    draw_login_brand(
        pdf,
        pdf.l_margin,
        pdf.get_y(),
        mark_size=36,
        title="OpsGate",
        subtitle="Console MMC · DailyOps.Tech",
        light=False,
    )
    pdf.ln(8)

    callout(
        pdf,
        "Ce document n'est pas le manuel administrateur. Il s'adresse aux organes décisionnels : "
        "que propose OpsGate, pourquoi l'adopter, puis quoi est filtré et comment le blocage s'applique.",
    )

    # 1
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
    w = uw(pdf)
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
        [52, w - 52],
    )

    # 2
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
        [58, w - 58],
    )

    # 3
    h1(pdf, "3. Comment ça marche (vue décideur)")
    table(
        pdf,
        ["Couche", "Rôle", "Bloque réseau ?"],
        [
            ["Extension navigateur", "Détecte prompt / fichiers ; warn mask cancel", "Côté page (DOM)"],
            ["Proxy local (option)", "MITM allowlist multi-IA ; observe ou enforce", "Oui en enforce"],
            ["Control plane", "Policies, packs, licences, MMC, exports", "Gouvernance"],
        ],
        [40, 78, w - 118],
    )
    body(
        pdf,
        "Double filet : un utilisateur en mode warn peut cliquer « Envoyer quand même » ; "
        "si le proxy est en enforce, la requête peut encore être coupée avant d'atteindre le fournisseur IA.",
    )

    # 4
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
        [50, 18, 20, w - 88],
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
        [52, 18, 20, w - 90],
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

    # 5
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
        [36, 58, w - 94],
    )
    h2(pdf, "Proxy local")
    table(
        pdf,
        ["Mode", "Effet"],
        [
            ["observe", "Journal MMC uniquement — ne coupe pas"],
            ["enforce", "Coupe si détection actionnable (hors JWT session, email, tél., IP seule)"],
        ],
        [32, w - 32],
    )
    callout(
        pdf,
        "Anti-casse sites IA : les JWT de session (Authorization: Bearer eyJ…) et cookies d'auth "
        "ne coupent pas l'accès au site — jetons techniques du navigateur, pas un secret collé dans le prompt.",
    )
    h2(pdf, "Forme du masquage")
    bullet(pdf, "Carte → XXXX-XXXX-XXXX-1234")
    bullet(pdf, "Clé API → préfixe + XXXX… + fin")
    bullet(pdf, "E-mail → aXXX@domaine")
    bullet(pdf, "IBAN → préfixe pays + XXXX + fin")

    # 6
    h1(pdf, "6. Périmètre multi-IA")
    body(
        pdf,
        "Filtrage proxy MITM sur allowlist (et sous-domaines) : ChatGPT/OpenAI, Claude, Gemini/Bard/AI Studio, "
        "Copilot, Grok, Perplexity, DeepSeek, Mistral, Groq, Meta AI, Poe, You.com, HuggingFace, OpenRouter, "
        "Together, Fireworks, Phind, etc. Hors allowlist = tunnel transparent (pas de déchiffrement OpsGate).",
    )

    # 7
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
        [46, w - 46],
    )

    # 8
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
        [38, w - 38],
    )

    # 9
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

    # 10
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
    print(f"Wrote {OUT} ({OUT.stat().st_size} bytes, {pdf.page_no()} pages)")


if __name__ == "__main__":
    main()
