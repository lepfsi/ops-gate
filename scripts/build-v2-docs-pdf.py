#!/usr/bin/env python3
"""
Génère les PDF V2 brandés DailyOps (FR + EN).

Usage:
  python scripts/build-v2-docs-pdf.py
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from pdf_brand import register_fonts  # noqa: E402
from pdf_md_render import draw_cover, make_doc_pdf, render_markdown  # noqa: E402

JOBS = [
    {
        "md": ROOT / "docs" / "GUIDE-UTILISATEUR-V2.md",
        "out": ROOT / "docs" / "GUIDE-UTILISATEUR-V2.pdf",
        "title": "OpsGate — Guide utilisateur V2",
        "subtitle": "Administrateurs · Formateurs · Referents securite",
        "lang": "FR",
        "footer": "Guide utilisateur V2",
    },
    {
        "md": ROOT / "docs" / "GUIDE-UTILISATEUR-V2-EN.md",
        "out": ROOT / "docs" / "GUIDE-UTILISATEUR-V2-EN.pdf",
        "title": "OpsGate — User & Admin Guide V2",
        "subtitle": "Administrators · Security champions · Trainers",
        "lang": "EN",
        "footer": "User Guide V2",
    },
    {
        "md": ROOT / "docs" / "DECIDEURS-V2-FR.md",
        "out": ROOT / "docs" / "DECIDEURS-V2-FR.pdf",
        "title": "OpsGate — Documentation decideurs V2",
        "subtitle": "DSI · RSSI · Architectes securite · Comites risques",
        "lang": "FR",
        "footer": "Decideurs V2",
    },
    {
        "md": ROOT / "docs" / "DECIDEURS-V2-EN.md",
        "out": ROOT / "docs" / "DECIDEURS-V2-EN.pdf",
        "title": "OpsGate — Decision-maker documentation V2",
        "subtitle": "CIO · CISO · Security architects · Risk committees",
        "lang": "EN",
        "footer": "Decision-makers V2",
    },
    {
        "md": ROOT / "docs" / "GUIDE-TEST-V2.md",
        "out": ROOT / "docs" / "GUIDE-TEST-V2.pdf",
        "title": "OpsGate — Guide de test V2",
        "subtitle": "QA · Integrateurs · Pilote DSI — etapes et commandes",
        "lang": "FR",
        "footer": "Guide de test V2",
    },
    {
        "md": ROOT / "docs" / "DEPLOIEMENT-CLIENT.md",
        "out": ROOT / "docs" / "DEPLOIEMENT-CLIENT.pdf",
        "title": "OpsGate — Installation & deploiement client",
        "subtitle": "Integrateurs · Admin systeme · Pilote DSI/RSSI",
        "lang": "FR",
        "footer": "Deploiement client",
    },
    {
        "md": ROOT / "docs" / "DEPLOIEMENT-CLIENT-EN.md",
        "out": ROOT / "docs" / "DEPLOIEMENT-CLIENT-EN.pdf",
        "title": "OpsGate — Customer installation & deployment",
        "subtitle": "Integrators · System admins · Pilot CIO/CISO teams",
        "lang": "EN",
        "footer": "Customer deployment",
    },
]


def build_one(job: dict) -> None:
    md_path: Path = job["md"]
    out: Path = job["out"]
    if not md_path.exists():
        print(f"SKIP missing {md_path}")
        return
    text = md_path.read_text(encoding="utf-8")
    pdf = make_doc_pdf(job["title"], footer_extra=job["footer"])
    register_fonts(pdf)
    pdf.add_page()
    draw_cover(pdf, job["title"], job["subtitle"], lang=job["lang"])
    pdf.add_page()
    render_markdown(pdf, text, skip_h1=True)
    out.parent.mkdir(parents=True, exist_ok=True)
    pdf.output(str(out))
    print(f"OK {out.name}  pages={pdf.page_no()}  {out.stat().st_size // 1024} KB")


def main() -> None:
    for job in JOBS:
        build_one(job)


if __name__ == "__main__":
    main()
