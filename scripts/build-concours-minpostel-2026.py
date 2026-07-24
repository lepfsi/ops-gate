#!/usr/bin/env python3
"""
Dossier de candidature — Concours National du Meilleur Projet TIC 2026
MINPOSTEL · Prix Spécial du Président de la République

Source branding : assets/brand/Template.png
Max 5 pages — critères art. 5.1 (contenu) + art. 5.2 (présélection).
"""
from __future__ import annotations

import sys
from pathlib import Path

from fpdf import FPDF
from fpdf.enums import XPos, YPos

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from pdf_brand import (  # noqa: E402
    COVER_BG,
    COVER_BG_DEEP,
    GRAY,
    INK,
    MUTED,
    NAVY,
    NAVY2,
    TEAL,
    TEAL_SOFT,
    WHITE,
    draw_brand_mark,
    font_name,
    register_fonts,
)

OUT = ROOT / "docs" / "CONCOURS-MINPOSTEL-2026-DailyOps-OpsGate.pdf"

# ── helpers layout ──────────────────────────────────────────────────────────

MARGIN = 14.0
CONTENT_TOP = 18.0
FOOTER_Y = 12.0


class ConcoursPDF(FPDF):
    def __init__(self) -> None:
        super().__init__(format="A4", unit="mm")
        self.set_auto_page_break(auto=True, margin=16)
        self.set_margins(MARGIN, CONTENT_TOP, MARGIN)
        register_fonts(self)
        self._page_label = "DailyOps.Tech  ·  OpsGate  ·  Candidature MINPOSTEL 2026"

    def header(self) -> None:
        if self.page_no() == 1:
            return
        self.set_fill_color(*NAVY)
        self.rect(0, 0, self.w, 12, "F")
        draw_brand_mark(self, MARGIN, 1.8, 8.5)
        self.set_xy(MARGIN + 11, 3.2)
        self.set_font(font_name(), "B", 8)
        self.set_text_color(*WHITE)
        self.cell(0, 5, "DailyOps.Tech  ·  OpsGate  ·  Document de projet", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        self.set_draw_color(*TEAL)
        self.set_line_width(1.0)
        self.line(0, 12, self.w, 12)
        self.set_y(CONTENT_TOP)

    def footer(self) -> None:
        if self.page_no() == 1:
            return
        y = self.h - FOOTER_Y
        self.set_draw_color(*TEAL)
        self.set_line_width(0.6)
        self.line(MARGIN, y, self.w - MARGIN, y)
        self.set_y(y + 1.5)
        self.set_font(font_name(), "", 7.5)
        self.set_text_color(*GRAY)
        self.cell(
            0,
            5,
            f"{self._page_label}   ·   Page {self.page_no() - 1}/4",
            align="C",
            new_x=XPos.LMARGIN,
            new_y=YPos.NEXT,
        )


def uw(pdf: FPDF) -> float:
    return pdf.w - pdf.l_margin - pdf.r_margin


def section_title(pdf: FPDF, num: str, title: str) -> None:
    pdf.ln(2)
    pdf.set_fill_color(*TEAL)
    pdf.rect(pdf.l_margin, pdf.get_y() + 0.5, 2.2, 6.5, "F")
    pdf.set_x(pdf.l_margin + 4)
    pdf.set_font(font_name(), "B", 11)
    pdf.set_text_color(*NAVY)
    pdf.cell(0, 7.5, f"{num}  {title}", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.ln(1)


def body(pdf: FPDF, text: str, *, size: float = 9.2, leading: float = 4.6) -> None:
    pdf.set_font(font_name(), "", size)
    pdf.set_text_color(*INK)
    pdf.set_x(pdf.l_margin)
    pdf.multi_cell(uw(pdf), leading, text, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.ln(1.2)


def bold_lead(pdf: FPDF, text: str) -> None:
    pdf.set_font(font_name(), "B", 9.5)
    pdf.set_text_color(*NAVY)
    pdf.set_x(pdf.l_margin)
    pdf.multi_cell(uw(pdf), 5, text, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.ln(0.8)


def callout(pdf: FPDF, title: str, text: str, *, tone: str = "teal") -> None:
    """Bandeau stratégique."""
    if tone == "navy":
        bg, accent, title_c, body_c = NAVY, TEAL, WHITE, (200, 220, 225)
    else:
        bg, accent, title_c, body_c = TEAL_SOFT, TEAL, TEAL_INK, INK
    x, y = pdf.l_margin, pdf.get_y()
    w = uw(pdf)
    # measure
    pdf.set_font(font_name(), "B", 8.5)
    # rough height
    h = 16 + (len(text) // 85) * 4.2
    h = max(18, min(h, 32))
    pdf.set_fill_color(*bg)
    pdf.rect(x, y, w, h, "F")
    pdf.set_fill_color(*accent)
    pdf.rect(x, y, 2.0, h, "F")
    pdf.set_xy(x + 5, y + 2.5)
    pdf.set_font(font_name(), "B", 8.2)
    pdf.set_text_color(*title_c)
    pdf.cell(w - 8, 4, title, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.set_x(x + 5)
    pdf.set_font(font_name(), "", 8)
    pdf.set_text_color(*body_c)
    pdf.multi_cell(w - 10, 3.8, text, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.set_y(y + h + 2.5)


def kpi_row(pdf: FPDF, items: list[tuple[str, str]]) -> None:
    n = len(items)
    gap = 2.5
    w = (uw(pdf) - gap * (n - 1)) / n
    y0 = pdf.get_y()
    x0 = pdf.l_margin
    h = 16
    for i, (val, lab) in enumerate(items):
        x = x0 + i * (w + gap)
        pdf.set_fill_color(*NAVY)
        pdf.rect(x, y0, w, h, "F")
        pdf.set_draw_color(*TEAL)
        pdf.set_line_width(0.5)
        pdf.line(x, y0 + h, x + w, y0 + h)
        pdf.set_xy(x + 2, y0 + 2)
        pdf.set_font(font_name(), "B", 11)
        pdf.set_text_color(*TEAL)
        pdf.cell(w - 4, 5, val, align="C")
        pdf.set_xy(x + 2, y0 + 8.5)
        pdf.set_font(font_name(), "", 6.5)
        pdf.set_text_color(*MUTED)
        pdf.cell(w - 4, 4, lab, align="C")
    pdf.set_y(y0 + h + 3)


def two_col(pdf: FPDF, left_title: str, left: str, right_title: str, right: str) -> None:
    gap = 3.5
    w = (uw(pdf) - gap) / 2
    y0 = pdf.get_y()
    x0 = pdf.l_margin

    def col(x: float, title: str, text: str) -> float:
        pdf.set_xy(x, y0)
        pdf.set_fill_color(247, 250, 252)
        # draw later after measure — fixed height box
        pdf.set_font(font_name(), "B", 8)
        pdf.set_text_color(*TEAL_INK)
        pdf.cell(w, 5, title, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        pdf.set_x(x)
        pdf.set_font(font_name(), "", 8)
        pdf.set_text_color(*INK)
        pdf.multi_cell(w, 3.7, text, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        return pdf.get_y()

    y1 = col(x0, left_title, left)
    y2 = col(x0 + w + gap, right_title, right)
    pdf.set_y(max(y1, y2) + 2)


# ── pages ───────────────────────────────────────────────────────────────────

def page_cover(pdf: ConcoursPDF) -> None:
    pdf.add_page()
    # Template cover
    pdf.set_fill_color(*COVER_BG)
    pdf.rect(0, 0, pdf.w, pdf.h * 0.58, "F")
    pdf.set_fill_color(*COVER_BG_DEEP)
    pdf.rect(0, pdf.h * 0.52, pdf.w, pdf.h * 0.48, "F")
    pdf.set_fill_color(*TEAL)
    pdf.rect(0, 0, pdf.w, 6.5, "F")

    footer_h = 16
    bar_h = 5.5
    pdf.set_fill_color(*TEAL)
    pdf.rect(0, pdf.h - footer_h - bar_h, pdf.w, bar_h, "F")

    mark = 48
    mx = (pdf.w - mark) / 2
    my = 28
    draw_brand_mark(pdf, mx, my, mark)

    pdf.set_y(my + mark + 8)
    pdf.set_font(font_name(), "B", 26)
    pdf.set_text_color(*WHITE)
    pdf.cell(0, 11, "DailyOps.Tech", align="C", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.set_font(font_name(), "", 11)
    pdf.set_text_color(*TEAL)
    pdf.cell(0, 6, "Startup en gestation  ·  Yaoundé, Cameroun", align="C", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.ln(6)
    pdf.set_draw_color(*TEAL)
    pdf.set_line_width(1.1)
    mid = pdf.w / 2
    pdf.line(mid - 26, pdf.get_y(), mid + 26, pdf.get_y())
    pdf.ln(8)

    pdf.set_font(font_name(), "B", 13)
    pdf.set_text_color(*WHITE)
    pdf.multi_cell(
        uw(pdf),
        6.5,
        "Document de projet — Concours National du Meilleur Projet TIC 2026",
        align="C",
        new_x=XPos.LMARGIN,
        new_y=YPos.NEXT,
    )
    pdf.ln(2)
    pdf.set_font(font_name(), "", 9.5)
    pdf.set_text_color(200, 220, 225)
    pdf.multi_cell(
        uw(pdf),
        5,
        "Thème officiel : Protéger le cyberespace des dérives de l'intelligence\n"
        "artificielle et promouvoir le patriotisme numérique",
        align="C",
        new_x=XPos.LMARGIN,
        new_y=YPos.NEXT,
    )
    pdf.ln(6)
    pdf.set_font(font_name(), "B", 12)
    pdf.set_text_color(*TEAL)
    pdf.cell(0, 6, "OpsGate", align="C", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.set_font(font_name(), "", 9)
    pdf.set_text_color(*WHITE)
    pdf.cell(
        0,
        5,
        "Produit phare — Sécurité des données face à l'IA générative",
        align="C",
        new_x=XPos.LMARGIN,
        new_y=YPos.NEXT,
    )
    pdf.ln(5)
    pdf.set_font(font_name(), "", 8.5)
    pdf.set_text_color(*MUTED)
    pdf.cell(
        0,
        4.5,
        "Porteur : Steve BA-NDOUWE  ·  steve.ba-ndouwe@dailyops.tech  ·  Solo founder",
        align="C",
        new_x=XPos.LMARGIN,
        new_y=YPos.NEXT,
    )
    pdf.cell(
        0,
        4.5,
        "MINPOSTEL  ·  Semaine de l'Innovation Numérique — 5e édition  ·  Yaoundé, juin–juillet 2026",
        align="C",
        new_x=XPos.LMARGIN,
        new_y=YPos.NEXT,
    )

    # footer band
    fy = pdf.h - footer_h
    pdf.set_fill_color(*NAVY)
    pdf.rect(0, fy, pdf.w, footer_h, "F")
    pdf.set_draw_color(*TEAL)
    pdf.set_line_width(1.0)
    pdf.line(0, fy, pdf.w, fy)
    draw_brand_mark(pdf, MARGIN, fy + 3, 10)
    pdf.set_xy(MARGIN + 13, fy + 4.5)
    pdf.set_font(font_name(), "B", 8)
    pdf.set_text_color(*WHITE)
    pdf.cell(0, 4, "Candidature  ·  Prix Spécial du Président de la République", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.set_x(MARGIN + 13)
    pdf.set_font(font_name(), "", 7)
    pdf.set_text_color(*MUTED)
    pdf.cell(0, 3.5, "www.ictinnovationweek.cm  ·  Confidentiel — usage concours uniquement")


def page_2(pdf: ConcoursPDF) -> None:
    pdf.add_page()
    section_title(pdf, "01", "Présentation de la start-up et du projet")
    bold_lead(
        pdf,
        "DailyOps.Tech est une start-up camerounaise en gestation, fondée à Yaoundé, "
        "qui construit des outils de confiance numérique pour l'Afrique.",
    )
    body(
        pdf,
        "Nous ne sommes pas encore une société établie au sens commercial mature : "
        "nous sommes une équipe fondatrice en phase de structuration, avec un produit "
        "déjà fonctionnel et démontrable. Notre conviction : l'innovation TIC africaine "
        "doit allier excellence technique, impact local et souveraineté des données.",
    )
    body(
        pdf,
        "OpsGate est le produit dérivé phare de DailyOps.Tech. C'est une plateforme de "
        "prévention de fuite de données (DLP) et d'AI security, conçue pour laisser les "
        "collaborateurs utiliser librement les outils d'IA générative (ChatGPT, Gemini, "
        "Claude, Copilot, DeepSeek, Perplexity…) sans exposer secrets métier, données "
        "clients, clés API ou configurations d'infrastructure.",
    )
    callout(
        pdf,
        "POSITIONNEMENT",
        "DailyOps.Tech = marque éditrice & vision ops/cybersécurité.  ·  "
        "OpsGate = produit concret, multi-composants (extension navigateur, proxy local, "
        "API multi-tenant, console d'administration), déjà au stade pré-GA démontrable.",
        tone="navy",
    )

    section_title(pdf, "02", "Problème à résoudre / opportunité de marché")
    body(
        pdf,
        "L'IA générative s'est imposée dans les administrations, banques, télécoms et "
        "PME camerounaises et africaines. En parallèle, les fuites involontaires se "
        "multiplient : un agent colle une clé API, un IBAN, un export client ou un "
        "fragment de config réseau dans ChatGPT. Les outils classiques (antivirus, "
        "pare-feu, CASB lourds) ne couvrent pas ce « dernier mètre » du navigateur.",
    )
    body(
        pdf,
        "Opportunité : un marché mondial de l'AI security en forte croissance, avec un "
        "angle encore peu adressé en Afrique francophone — des solutions souveraines, "
        "déployables en local, multi-tenant pour MSP et ministères, avec privacy by design "
        "(métadonnées plutôt que prompts complets).",
    )
    kpi_row(
        pdf,
        [
            ("DLP + IA", "Catégorie produit"),
            ("Pré-GA", "Maturité OpsGate"),
            ("CM", "Siège Yaoundé"),
            ("Solo", "Équipe fondatrice"),
        ],
    )

    section_title(pdf, "03", "Résumé du projet")
    body(
        pdf,
        "OpsGate intercepté les envois vers les sites d'IA, détecte les données sensibles "
        "via un moteur de règles (secrets, PII, configs réseau, fichiers PDF/Office, OCR), "
        "puis propose à l'utilisateur une action claire : Secure Rewrite (anonymiser "
        "intelligemment), masquer, bloquer, simuler le risque, ou journaliser selon la "
        "politique de l'organisation. Les administrateurs pilotent tout depuis une console "
        "centrale (groupes, profils, licences, Shadow AI, scores de risque, rapports PDF).",
    )
    callout(
        pdf,
        "ALIGNEMENT THÈME 2026",
        "« Protéger le cyberespace des dérives de l'IA et promouvoir le patriotisme "
        "numérique » — OpsGate transforme l'usage de l'IA d'un risque de fuite en un "
        "geste contrôlé, éthique et traçable pour les institutions camerounaises.",
    )


def page_3(pdf: ConcoursPDF) -> None:
    pdf.add_page()
    section_title(pdf, "04", "Facteur innovant")
    body(
        pdf,
        "L'innovation OpsGate n'est pas un simple bloqueur de sites. Elle combine "
        "plusieurs ruptures d'usage et d'architecture :",
    )
    body(
        pdf,
        "• Secure Rewrite — réécriture sécurisée du prompt pour garder l'utilité métier "
        "sans coller le secret (adoption > interdiction pure).\n"
        "• Score de risque + mode Simulation — l'utilisateur voit l'impact avant d'envoyer.\n"
        "• Shadow AI Discovery — inventaire des outils IA réellement utilisés (autorisés ou non).\n"
        "• Risk Score utilisateurs — qui prend le plus de risques, avec tendance.\n"
        "• Double filet extension + proxy local — défense en profondeur si le DOM change.\n"
        "• Privacy by design — en mode local rien ne quitte le poste ; en mode org, "
        "métadonnées plutôt que contenu intégral.",
    )
    callout(
        pdf,
        "INNOVATION DE PRODUIT + DE PROCÉDÉ",
        "Produit nouveau (AI DLP navigateur + gouvernance) et procédé (pipeline détection → "
        "décision UX → preuve admin) — pas une adaptation mineure d'un antivirus existant.",
        tone="navy",
    )

    section_title(pdf, "05", "Faisabilité technique & maturité")
    body(
        pdf,
        "Le projet n'est pas une idée sur papier : un monorepo opérationnel existe "
        "(extension Plasmo multi-navigateurs, moteur de règles TypeScript, API Hono, "
        "console Vite/React, proxy MITM, Postgres multi-tenant, packaging Chrome/Firefox/"
        "Safari, MSI proxy Windows). Maturité affichée : V2 fonctionnelle / pré-GA, avec "
        "différenciateurs V3 (Secure Rewrite, Risk, Shadow) en code et démontrables.",
    )
    two_col(
        pdf,
        "STACK MAÎTRISÉE",
        "TypeScript · Node · React · Postgres · extension navigateur · packaging store · "
        "scripts de déploiement client (MDM, docs FR/EN).",
        "PREUVE DE RÉALITÉ",
        "Console d'administration, enrôlement agents, events, audit, MFA, exports, "
        "rapports PDF sécurité — stack locale reproductible pour jury / bootcamp.",
    )

    section_title(pdf, "06", "Cibles et bénéficiaires")
    body(
        pdf,
        "• Primaires : DSI / RSSI d'entreprises (banques, télécoms, énergie, industries), "
        "administrations et établissements publics camerounais.\n"
        "• Secondaires : MSP / intégrateurs qui gèrent plusieurs clients (multi-tenant).\n"
        "• Utilisateurs finaux : collaborateurs qui utilisent l'IA au quotidien — protégés "
        "sans friction inutile.\n"
        "• Bénéficiaires sociétaux : citoyens dont les données ne fuient pas vers des "
        "services d'IA étrangers faute de garde-fous locaux.",
    )
    callout(
        pdf,
        "POUR LE CAMEROUN",
        "Former une culture d'usage responsable de l'IA dans les organisations, réduire "
        "la dépendance à des boîtes noires importées, et créer des compétences locales "
        "(intégration, support, formation) autour d'un produit conçu à Yaoundé.",
    )


def page_4(pdf: ConcoursPDF) -> None:
    pdf.add_page()
    section_title(pdf, "07", "Modèle économique et génération de revenus")
    body(
        pdf,
        "Phase actuelle : start-up en gestation — priorités = produit, pilotes, crédibilité "
        "technique. Le modèle économique est clair et standard pour un SaaS de sécurité :",
    )
    body(
        pdf,
        "1. Licences organisation (sièges agents) — abonnement annuel/mensuel.\n"
        "2. Offre MSP / multi-tenant — revente par intégrateurs et partenaires.\n"
        "3. Services d'intégration & formation — déploiement, policy, sensibilisation.\n"
        "4. (Horizon) Support premium, modules avancés (SIEM, packs de règles sectoriels).\n\n"
        "Go-to-market initial : pilotes ciblés au Cameroun (secteur privé + administrations), "
        "puis zone CEMAC / Afrique francophone via partenaires. Tarification progressive "
        "adaptée aux budgets locaux, avec mode local-only pour les entités très sensibles.",
    )
    callout(
        pdf,
        "PÉRENNITÉ",
        "Revenus récurrents (licences) + services d'intégration = viabilité. Le produit "
        "s'auto-renforce avec chaque pack de règles et chaque retour terrain — actif "
        "défendable sans dépendre d'une seule grosse vente one-shot.",
        tone="navy",
    )

    section_title(pdf, "08", "Impact socio-économique")
    body(
        pdf,
        "• Productivité : l'IA reste utilisable — on ne bloque pas l'innovation des équipes.\n"
        "• Emplois : intégration, support, formation, contenu de sensibilisation au Cameroun.\n"
        "• Inclusion numérique responsable : mêmes garde-fous pour PME et grandes entités.\n"
        "• Souveraineté : option d'hébergement control-plane local / on-prem client.\n"
        "• Confiance : traçabilité et rapports pour comités risques et audit.",
    )

    section_title(pdf, "09", "Utilisation de l'IA dans la solution")
    body(
        pdf,
        "OpsGate n'est pas un « wrapper ChatGPT ». L'IA est le terrain d'usage à sécuriser ; "
        "le cœur de valeur est la protection autour de ces usages :",
    )
    body(
        pdf,
        "• Détection heuristique et par règles des fuites potentielles vers les LLM.\n"
        "• Secure Rewrite — transformation intelligente du contenu sensible avant envoi.\n"
        "• Scores de risque explicables (pas une boîte noire opaque pour l'utilisateur).\n"
        "• Simulation pédagogique — éducation au risque au moment de l'action.\n"
        "• OCR local (Tesseract) pour documents scannés — sans envoyer l'image au cloud.\n\n"
        "Valeur ajoutée : automatisation de la protection, aide à la décision utilisateur, "
        "et gouvernance pour l'admin — exactement les axes du barème « Utilisation de l'IA ».",
    )

    section_title(pdf, "10", "Patriotisme numérique & cybersécurité")
    body(
        pdf,
        "Le projet répond directement au thème de la 5e Semaine de l'Innovation Numérique :",
    )
    body(
        pdf,
        "• Protection des données personnelles et professionnelles face aux dérives d'usage de l'IA.\n"
        "• Lutte contre la cyber-exposition involontaire (secrets, configs, identité).\n"
        "• Promotion d'un usage éthique et responsable du numérique au Cameroun.\n"
        "• Réduction de la dépendance exclusive à des outils étrangers sans couche locale.\n"
        "• Contribution à la confiance numérique des administrations et entreprises.",
    )
    callout(
        pdf,
        "CYBERSÉCURITÉ AU SERVICE DU PATRIOTISME NUMÉRIQUE",
        "Protéger ce que les Camerounais saisissent dans l'IA, c'est protéger la mémoire "
        "économique et institutionnelle du pays — sans renoncer à l'innovation.",
    )


def page_5(pdf: ConcoursPDF) -> None:
    pdf.add_page()
    section_title(pdf, "11", "Équipe de travail")
    bold_lead(pdf, "Porteur unique du projet : Steve BA-NDOUWE")
    body(
        pdf,
        "Fondateur de DailyOps.Tech · Solo founder pour l'instant · Yaoundé, Cameroun\n"
        "E-mail : steve.ba-ndouwe@dailyops.tech\n\n"
        "Profil : conception produit, architecture logicielle, cybersécurité opérationnelle, "
        "exécution full-stack (extension, API, console, packaging). Pas de groupe constitué "
        "à ce stade : la start-up est en gestation, avec une roadmap d'élargissement d'équipe "
        "(ingénierie, commercial, partenariats) après validation marché / concours.",
    )
    callout(
        pdf,
        "TRANSPARENCE — RÈGLEMENT ART. 5 & 7",
        "Candidat de nationalité camerounaise, résidant au Cameroun, porteur d'un projet "
        "innovant TIC. Start-up en gestation (pas une société de notoriété établie "
        "commercialisant déjà massivement). Un seul projet présenté. Engagement de "
        "sincérité des informations fournies.",
        tone="navy",
    )

    section_title(pdf, "12", "Feuille de route & scalabilité")
    body(
        pdf,
        "T0–3 mois : finaliser GA OpsGate, 1–2 pilotes Cameroun, documentation déploiement.\n"
        "3–9 mois : partenariats MSP, premiers revenus licences, recrutement technique ciblé.\n"
        "9–18 mois : déploiement CEMAC, packs sectoriels, renforcement hébergement souverain.\n\n"
        "Scalabilité : architecture multi-tenant déjà prévue ; extension navigateur = "
        "déploiement large à coût marginal faible ; proxy pour environnements contraints.",
    )

    section_title(pdf, "13", "Pourquoi ce projet mérite le Prix Spécial")
    body(
        pdf,
        "Parce qu'il touche un problème d'intérêt national (protection des données face à l'IA), "
        "avec un produit déjà démontrable, conçu par un Camerounais à Yaoundé, aligné sur le "
        "thème officiel du concours, et porteur d'emplois et de compétences locales. "
        "Ce n'est ni un simple site vitrine, ni une idée sans code : c'est une plateforme "
        "prête à être présentée, challengée et pilotée.",
    )
    callout(
        pdf,
        "DEMANDE AU JURY",
        "Nous sollicitons la présélection de DailyOps.Tech / OpsGate pour le bootcamp et le "
        "pitch final — avec démonstration live du produit, business model et go-to-market. "
        "Contact : steve.ba-ndouwe@dailyops.tech",
    )

    pdf.ln(4)
    # closing strip
    y = pdf.get_y()
    pdf.set_fill_color(*NAVY)
    pdf.rect(pdf.l_margin, y, uw(pdf), 22, "F")
    pdf.set_fill_color(*TEAL)
    pdf.rect(pdf.l_margin, y, 2.2, 22, "F")
    pdf.set_xy(pdf.l_margin + 6, y + 3)
    pdf.set_font(font_name(), "B", 9)
    pdf.set_text_color(*TEAL)
    pdf.cell(0, 5, "DailyOps.Tech  ·  OpsGate", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.set_x(pdf.l_margin + 6)
    pdf.set_font(font_name(), "", 8)
    pdf.set_text_color(*WHITE)
    pdf.multi_cell(
        uw(pdf) - 10,
        4,
        "Protéger l'usage de l'IA pour protéger la souveraineté numérique du Cameroun.\n"
        "Steve BA-NDOUWE — Yaoundé — steve.ba-ndouwe@dailyops.tech",
        new_x=XPos.LMARGIN,
        new_y=YPos.NEXT,
    )


def main() -> None:
    pdf = ConcoursPDF()
    page_cover(pdf)
    page_2(pdf)
    page_3(pdf)
    page_4(pdf)
    page_5(pdf)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    pdf.output(str(OUT))
    print(f"OK  {OUT}")
    print(f"Pages: {pdf.page_no()} (max 5 attendu)")


if __name__ == "__main__":
    main()
