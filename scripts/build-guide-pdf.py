#!/usr/bin/env python3
"""Génère docs/GUIDE-UTILISATEUR.pdf — charte DailyOps + BrandMark."""
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
    make_doc_pdf,
    render_markdown,
    reset_x,
    uw,
    write_callout,
)

JOBS = [
    {
        "md": ROOT / "docs" / "GUIDE-UTILISATEUR.md",
        "out": ROOT / "docs" / "GUIDE-UTILISATEUR.pdf",
        "header": "OpsGate  |  Guide utilisateur  |  DailyOps.Tech",
        "footer": "Guide administrateur",
        "title": "Guide utilisateur",
        "subtitle": "Administrateurs console · pilotes · support",
        "lang": "FR",
        "extra": [
            "Version produit 1.2",
            "Extension · Console MMC · Policies · Licences · Logs · Recovery",
        ],
        "brand_sub": "Guide administrateur · Console MMC",
        "callout": (
            "Usage quotidien d'OpsGate : extension, console, enrôlement, policies, "
            "licences, logs et recovery. Installation technique : GUIDE-STACK-LOCALE.md."
        ),
        "closing": "Protégez les données de votre entreprise dans chaque interaction avec l'IA.",
    },
    {
        "md": ROOT / "docs" / "GUIDE-UTILISATEUR-EN.md",
        "out": ROOT / "docs" / "GUIDE-UTILISATEUR-EN.pdf",
        "header": "OpsGate  |  User Guide  |  DailyOps.Tech",
        "footer": "User Guide",
        "title": "User Guide",
        "subtitle": "Console admins · pilots · support",
        "lang": "EN",
        "extra": [
            "Product version 1.2",
            "Extension · MMC console · Policies · Licenses · Logs · Recovery",
        ],
        "brand_sub": "Administrator guide · MMC console",
        "callout": (
            "Day-to-day OpsGate use: extension, console, enrollment, policies, "
            "licenses, logs and recovery. Local install: GUIDE-STACK-LOCALE.md."
        ),
        "closing": "Protect your company data in every interaction with AI.",
    },
]


def build_one(job: dict) -> None:
    md: Path = job["md"]
    out: Path = job["out"]
    if not md.exists():
        print(f"SKIP missing {md}")
        return

    text = md.read_text(encoding="utf-8")
    pdf = make_doc_pdf(job["header"], footer_extra=job["footer"])
    register_fonts(pdf)
    pdf.add_page()
    draw_cover(
        pdf,
        job["title"],
        job["subtitle"],
        lang=job["lang"],
        extra_lines=job["extra"],
    )
    pdf.add_page()

    draw_login_brand(
        pdf,
        pdf.l_margin,
        pdf.get_y(),
        mark_size=34,
        title="OpsGate",
        subtitle=job["brand_sub"],
        light=False,
    )
    pdf.ln(4)
    write_callout(pdf, job["callout"])
    render_markdown(pdf, text, skip_h1=True)

    pdf.ln(8)
    if pdf.get_y() > pdf.h - 45:
        pdf.add_page()
    y = pdf.get_y()
    pdf.set_fill_color(*NAVY)
    pdf.rect(pdf.l_margin, y, uw(pdf), 32, "F")
    pdf.set_fill_color(*TEAL)
    pdf.rect(pdf.l_margin, y, uw(pdf), 2.5, "F")
    draw_brand_mark(pdf, pdf.l_margin + 8, y + 7, 18)
    pdf.set_xy(pdf.l_margin + 32, y + 8)
    pdf.set_font(font_name(), "B", 9)
    pdf.set_text_color(*TEAL)
    pdf.cell(0, 5, "OPSGATE  ·  DAILYOPS.TECH")
    pdf.set_xy(pdf.l_margin + 32, y + 16)
    pdf.set_font(font_name(), "B", 10)
    pdf.set_text_color(*WHITE)
    pdf.multi_cell(uw(pdf) - 40, 5, job["closing"])
    reset_x(pdf)

    out.parent.mkdir(parents=True, exist_ok=True)
    pdf.output(str(out))
    print(f"OK {out.name}  pages={pdf.page_no()}  {out.stat().st_size // 1024} KB")


def main() -> None:
    for job in JOBS:
        build_one(job)


if __name__ == "__main__":
    main()
