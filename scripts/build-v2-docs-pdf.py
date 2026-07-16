#!/usr/bin/env python3
"""
Génère les PDF V2 brandés DailyOps (FR + EN) :
  - Guide utilisateur V2
  - Documentation décideurs V2
  - Guide de test V2 (FR)

Usage:
  python scripts/build-v2-docs-pdf.py
"""
from __future__ import annotations

import re
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
    TEAL,
    WHITE,
    draw_brand_mark,
    draw_login_brand,
    font_name,
    register_fonts,
)

JOBS = [
    {
        "md": ROOT / "docs" / "GUIDE-UTILISATEUR-V2.md",
        "out": ROOT / "docs" / "GUIDE-UTILISATEUR-V2.pdf",
        "title": "OpsGate — Guide utilisateur V2",
        "subtitle": "Administrateurs · Formateurs · Référents sécurité",
        "lang": "FR",
    },
    {
        "md": ROOT / "docs" / "GUIDE-UTILISATEUR-V2-EN.md",
        "out": ROOT / "docs" / "GUIDE-UTILISATEUR-V2-EN.pdf",
        "title": "OpsGate — User & Admin Guide V2",
        "subtitle": "Administrators · Security champions · Trainers",
        "lang": "EN",
    },
    {
        "md": ROOT / "docs" / "DECIDEURS-V2-FR.md",
        "out": ROOT / "docs" / "DECIDEURS-V2-FR.pdf",
        "title": "OpsGate — Documentation décideurs V2",
        "subtitle": "DSI · RSSI · Architectes sécurité · Comités risques",
        "lang": "FR",
    },
    {
        "md": ROOT / "docs" / "DECIDEURS-V2-EN.md",
        "out": ROOT / "docs" / "DECIDEURS-V2-EN.pdf",
        "title": "OpsGate — Decision-maker documentation V2",
        "subtitle": "CIO · CISO · Security architects · Risk committees",
        "lang": "EN",
    },
    {
        "md": ROOT / "docs" / "GUIDE-TEST-V2.md",
        "out": ROOT / "docs" / "GUIDE-TEST-V2.pdf",
        "title": "OpsGate — Guide de test V2",
        "subtitle": "QA · Intégrateurs · Pilote DSI — étapes & commandes",
        "lang": "FR",
    },
]


class DocPDF(FPDF):
    def __init__(self, header_title: str = "OpsGate"):
        super().__init__()
        self._header_title = header_title
        self.set_auto_page_break(auto=True, margin=18)

    def header(self) -> None:
        if self.page_no() == 1:
            return
        self.set_fill_color(*NAVY)
        self.rect(0, 0, self.w, 15, "F")
        draw_brand_mark(self, self.l_margin, 2.5, 10)
        self.set_xy(self.l_margin + 14, 4)
        self.set_font(font_name(), "B", 9)
        self.set_text_color(*WHITE)
        self.cell(0, 7, self._header_title[:70])
        self.set_draw_color(*TEAL)
        self.set_line_width(1.2)
        self.line(0, 15, self.w, 15)
        self.set_y(20)

    def footer(self) -> None:
        if self.page_no() == 1:
            return
        self.set_y(-12)
        self.set_draw_color(*TEAL)
        self.set_line_width(0.4)
        self.line(self.l_margin, self.get_y(), self.w - self.r_margin, self.get_y())
        self.set_y(-10)
        self.set_font(font_name(), "", 8)
        self.set_text_color(*GRAY)
        self.cell(
            0,
            6,
            f"Page {self.page_no() - 1}  ·  DailyOps.Tech  ·  OpsGate V2",
            align="C",
        )


def clean(s: str) -> str:
    s = s.replace("\u2019", "'").replace("\u2018", "'")
    s = s.replace("\u201c", '"').replace("\u201d", '"')
    s = s.replace("\u2013", "-").replace("\u2014", "-")
    s = s.replace("\u2026", "...").replace("\u2192", "->")
    s = s.replace("\u00b7", " · ").replace("\u2265", ">=")
    s = re.sub(r"\*\*([^*]+)\*\*", r"\1", s)
    s = re.sub(r"`([^`]+)`", r"\1", s)
    s = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", s)
    return s


def render_md(pdf: DocPDF, text: str) -> None:
    w = pdf.w - pdf.l_margin - pdf.r_margin
    in_code = False
    for raw in text.splitlines():
        line = raw.rstrip()
        if line.startswith("```"):
            in_code = not in_code
            continue
        if in_code:
            pdf.set_font(font_name(), "", 8)
            pdf.set_text_color(*INK)
            pdf.set_fill_color(245, 247, 250)
            pdf.multi_cell(w, 4.2, clean(line)[:200], fill=True)
            continue
        if not line.strip():
            pdf.ln(2)
            continue
        if line.startswith("# "):
            continue  # title used on cover
        if line.startswith("## "):
            pdf.ln(3)
            pdf.set_font(font_name(), "B", 13)
            pdf.set_text_color(*NAVY)
            pdf.multi_cell(w, 7, clean(line[3:]))
            pdf.set_draw_color(*TEAL)
            pdf.set_line_width(0.6)
            y = pdf.get_y()
            pdf.line(pdf.l_margin, y, pdf.l_margin + 40, y)
            pdf.ln(3)
            continue
        if line.startswith("### "):
            pdf.ln(2)
            pdf.set_font(font_name(), "B", 11)
            pdf.set_text_color(*NAVY)
            pdf.multi_cell(w, 6, clean(line[4:]))
            pdf.ln(1)
            continue
        if line.startswith("|") and "---" not in line:
            # simple table row
            cells = [c.strip() for c in line.strip("|").split("|")]
            pdf.set_font(font_name(), "", 8)
            pdf.set_text_color(*INK)
            col_w = w / max(len(cells), 1)
            x0 = pdf.get_x()
            y0 = pdf.get_y()
            h = 5
            for i, cell in enumerate(cells):
                pdf.set_xy(x0 + i * col_w, y0)
                pdf.multi_cell(col_w, h, clean(cell)[:80], border=0)
            pdf.set_y(y0 + h + 1)
            continue
        if re.match(r"^\|?\s*-{3,}", line):
            continue
        if line.startswith("- ") or line.startswith("* "):
            pdf.set_font(font_name(), "", 10)
            pdf.set_text_color(*INK)
            pdf.multi_cell(w, 5, "  •  " + clean(line[2:]))
            continue
        if re.match(r"^\d+\.\s", line):
            pdf.set_font(font_name(), "", 10)
            pdf.set_text_color(*INK)
            pdf.multi_cell(w, 5, clean(line))
            continue
        if line.startswith("> "):
            pdf.set_font(font_name(), "I", 10)
            pdf.set_text_color(*MUTED)
            pdf.multi_cell(w, 5, clean(line[2:]))
            continue
        if line.startswith("---"):
            pdf.ln(2)
            continue
        pdf.set_font(font_name(), "", 10)
        pdf.set_text_color(*INK)
        pdf.multi_cell(w, 5, clean(line))


def build_one(job: dict) -> None:
    md_path: Path = job["md"]
    out: Path = job["out"]
    if not md_path.exists():
        print(f"SKIP missing {md_path}")
        return
    text = md_path.read_text(encoding="utf-8")
    pdf = DocPDF(header_title=job["title"])
    register_fonts(pdf)
    pdf.set_margins(16, 18, 16)
    pdf.add_page()
    # Cover
    pdf.set_fill_color(*NAVY)
    pdf.rect(0, 0, pdf.w, pdf.h, "F")
    draw_login_brand(pdf, pdf.w / 2 - 50, 40, mark_size=44, light=True, subtitle="DailyOps.Tech")
    pdf.set_y(110)
    pdf.set_font(font_name(), "B", 22)
    pdf.set_text_color(*WHITE)
    pdf.multi_cell(0, 10, job["title"], align="C")
    pdf.ln(4)
    pdf.set_font(font_name(), "", 12)
    pdf.set_text_color(*TEAL)
    pdf.multi_cell(0, 7, job["subtitle"], align="C")
    pdf.ln(8)
    pdf.set_font(font_name(), "", 10)
    pdf.set_text_color(180, 190, 210)
    pdf.multi_cell(0, 6, "DailyOps.Tech  ·  OpsGate V2  ·  " + job["lang"], align="C")
    # Body
    pdf.add_page()
    render_md(pdf, text)
    out.parent.mkdir(parents=True, exist_ok=True)
    pdf.output(str(out))
    print(f"OK {out} ({out.stat().st_size // 1024} KB)")


def main() -> None:
    for job in JOBS:
        build_one(job)


if __name__ == "__main__":
    main()
