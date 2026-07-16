#!/usr/bin/env python3
"""
Génère les PDF V2 brandés DailyOps (FR + EN) — layout robuste.

Corrige : multi_cell qui décale x (texte coupé à droite), tableaux cassés,
pages quasi vides.

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
    TEAL_SOFT,
    WHITE,
    draw_brand_mark,
    font_name,
    register_fonts,
)

JOBS = [
    {
        "md": ROOT / "docs" / "GUIDE-UTILISATEUR-V2.md",
        "out": ROOT / "docs" / "GUIDE-UTILISATEUR-V2.pdf",
        "title": "OpsGate — Guide utilisateur V2",
        "subtitle": "Administrateurs · Formateurs · Referents securite",
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
        "title": "OpsGate — Documentation decideurs V2",
        "subtitle": "DSI · RSSI · Architectes securite · Comites risques",
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
        "subtitle": "QA · Integrateurs · Pilote DSI — etapes et commandes",
        "lang": "FR",
    },
]


class DocPDF(FPDF):
    def __init__(self, header_title: str = "OpsGate"):
        super().__init__(format="A4")
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
        # cell (not multi_cell) — stays on one line
        title = self._header_title
        if len(title) > 72:
            title = title[:69] + "..."
        self.cell(0, 7, title, new_x="LMARGIN", new_y="NEXT")
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
            new_x="LMARGIN",
            new_y="NEXT",
        )


def uw(pdf: FPDF) -> float:
    return pdf.w - pdf.l_margin - pdf.r_margin


def clean(s: str) -> str:
    s = s.replace("\u2019", "'").replace("\u2018", "'")
    s = s.replace("\u201c", '"').replace("\u201d", '"')
    s = s.replace("\u2013", "-").replace("\u2014", "-")
    s = s.replace("\u2026", "...").replace("\u2192", "->")
    s = s.replace("\u00b7", " · ").replace("\u2265", ">=")
    s = s.replace("\u2264", "<=").replace("\u2713", "OK")
    s = re.sub(r"\*\*([^*]+)\*\*", r"\1", s)
    s = re.sub(r"(?<!\*)\*([^*]+)\*(?!\*)", r"\1", s)  # italic
    s = re.sub(r"`([^`]+)`", r"\1", s)
    s = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", s)
    s = s.replace("\\*", "*").replace("\\_", "_")
    # fpdf2 traite \ comme échappement → chemins Windows
    s = s.replace("\\", "/")
    return s


def ensure_space(pdf: DocPDF, need: float = 14) -> None:
    """Saut de page si plus assez de place en bas."""
    if pdf.get_y() > pdf.h - pdf.b_margin - need:
        pdf.add_page()


def write_body(pdf: DocPDF, text: str, size: int = 10, style: str = "") -> None:
    """Paragraphe plein largeur, toujours depuis la marge gauche."""
    pdf.set_x(pdf.l_margin)
    pdf.set_font(font_name(), style, size)
    pdf.set_text_color(*INK)
    pdf.multi_cell(uw(pdf), 5.2, text, new_x="LMARGIN", new_y="NEXT")


def write_muted(pdf: DocPDF, text: str, size: int = 10) -> None:
    pdf.set_x(pdf.l_margin)
    pdf.set_font(font_name(), "I", size)
    pdf.set_text_color(*MUTED)
    pdf.multi_cell(uw(pdf), 5.0, text, new_x="LMARGIN", new_y="NEXT")


def write_heading(pdf: DocPDF, text: str, level: int = 2) -> None:
    ensure_space(pdf, 22 if level == 2 else 16)
    pdf.ln(3 if level == 2 else 2)
    pdf.set_x(pdf.l_margin)
    if level == 2:
        pdf.set_font(font_name(), "B", 13)
        pdf.set_text_color(*NAVY)
        pdf.multi_cell(uw(pdf), 7, text, new_x="LMARGIN", new_y="NEXT")
        y = pdf.get_y()
        pdf.set_draw_color(*TEAL)
        pdf.set_line_width(0.8)
        pdf.line(pdf.l_margin, y, pdf.l_margin + 36, y)
        pdf.ln(3)
    else:
        pdf.set_font(font_name(), "B", 11)
        pdf.set_text_color(*NAVY)
        pdf.multi_cell(uw(pdf), 6, text, new_x="LMARGIN", new_y="NEXT")
        pdf.ln(1)


def flush_table(pdf: DocPDF, rows: list[list[str]]) -> None:
    """Tableau simple : une ligne = une hauteur fixe (pas de multi_cell par cellule)."""
    if not rows:
        return
    headers = rows[0]
    body = rows[1:]
    n = max(1, len(headers))
    col_w = [uw(pdf) / n] * n
    x0 = pdf.l_margin

    ensure_space(pdf, 20)
    # header
    pdf.set_fill_color(*NAVY)
    pdf.set_text_color(*WHITE)
    pdf.set_font(font_name(), "B", 8)
    y0 = pdf.get_y()
    for i, h in enumerate(headers):
        pdf.set_xy(x0 + sum(col_w[:i]), y0)
        txt = clean(h)
        max_c = max(6, int(col_w[i] / 1.6))
        if len(txt) > max_c:
            txt = txt[: max_c - 1] + "…"
        pdf.cell(col_w[i], 6.5, txt, fill=True, border=0)
    pdf.set_y(y0 + 6.5)
    pdf.set_draw_color(*TEAL)
    pdf.set_line_width(0.5)
    pdf.line(x0, pdf.get_y(), x0 + uw(pdf), pdf.get_y())

    fill = False
    for row in body:
        ensure_space(pdf, 12)
        y0 = pdf.get_y()
        if fill:
            pdf.set_fill_color(*TEAL_SOFT)
            pdf.rect(x0, y0, uw(pdf), 6.2, "F")
        pdf.set_text_color(*INK)
        pdf.set_font(font_name(), "", 8)
        for i in range(n):
            cell = clean(row[i]) if i < len(row) else ""
            max_c = max(6, int(col_w[i] / 1.55))
            if len(cell) > max_c:
                cell = cell[: max_c - 1] + "…"
            pdf.set_xy(x0 + sum(col_w[:i]), y0 + 0.5)
            pdf.cell(col_w[i], 5.2, cell, border=0)
        pdf.set_y(y0 + 6.2)
        fill = not fill
    pdf.ln(2)
    pdf.set_x(pdf.l_margin)


def write_code_line(pdf: DocPDF, line: str) -> None:
    ensure_space(pdf, 10)
    pdf.set_x(pdf.l_margin)
    pdf.set_font(font_name(), "", 7.5)
    pdf.set_text_color(*INK)
    pdf.set_fill_color(245, 247, 250)
    # single-line cell with fill — multi_cell can mis-set x with fill
    txt = clean(line)
    if len(txt) > 110:
        txt = txt[:107] + "..."
    pdf.cell(uw(pdf), 4.5, "  " + txt, fill=True, new_x="LMARGIN", new_y="NEXT")


def cover(pdf: DocPDF, title: str, subtitle: str, lang: str) -> None:
    pdf.set_fill_color(*NAVY)
    pdf.rect(0, 0, pdf.w, pdf.h, "F")
    pdf.set_fill_color(*TEAL)
    pdf.rect(0, 0, pdf.w, 7, "F")
    pdf.rect(0, pdf.h - 9, pdf.w, 9, "F")

    mark = 52
    mx = (pdf.w - mark) / 2
    my = 50
    draw_brand_mark(pdf, mx, my, mark)

    pdf.set_y(my + mark + 16)
    pdf.set_font(font_name(), "B", 28)
    pdf.set_text_color(*WHITE)
    pdf.cell(0, 12, "OpsGate", align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(2)
    pdf.set_font(font_name(), "", 12)
    pdf.set_text_color(*TEAL)
    pdf.cell(0, 7, "DailyOps.Tech", align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(10)
    pdf.set_draw_color(*TEAL)
    pdf.set_line_width(1.2)
    mid = pdf.w / 2
    pdf.line(mid - 30, pdf.get_y(), mid + 30, pdf.get_y())
    pdf.ln(12)

    pdf.set_font(font_name(), "B", 15)
    pdf.set_text_color(*WHITE)
    # title may be long — multi_cell with forced LMARGIN
    pdf.set_x(pdf.l_margin + 10)
    pdf.multi_cell(
        pdf.w - 2 * pdf.l_margin - 20,
        8,
        title,
        align="C",
        new_x="LMARGIN",
        new_y="NEXT",
    )
    pdf.ln(4)
    pdf.set_font(font_name(), "", 11)
    pdf.set_text_color(*TEAL)
    pdf.set_x(pdf.l_margin + 10)
    pdf.multi_cell(
        pdf.w - 2 * pdf.l_margin - 20,
        6,
        subtitle,
        align="C",
        new_x="LMARGIN",
        new_y="NEXT",
    )
    pdf.ln(14)
    pdf.set_font(font_name(), "", 10)
    pdf.set_text_color(*MUTED)
    pdf.cell(
        0,
        6,
        f"DailyOps.Tech  ·  OpsGate V2  ·  {lang}",
        align="C",
        new_x="LMARGIN",
        new_y="NEXT",
    )


def render_md(pdf: DocPDF, text: str) -> None:
    in_code = False
    table_buf: list[list[str]] = []

    def end_table() -> None:
        nonlocal table_buf
        if table_buf:
            flush_table(pdf, table_buf)
            table_buf = []

    for raw in text.splitlines():
        line = raw.rstrip()

        if line.startswith("```"):
            end_table()
            in_code = not in_code
            if not in_code:
                pdf.ln(1)
            continue

        if in_code:
            write_code_line(pdf, line)
            continue

        # table rows
        if line.startswith("|"):
            if re.match(r"^\|?\s*:?-{3,}", line.replace("|", " ").strip()) or re.match(
                r"^\|[\s\-:|]+\|$", line
            ):
                continue  # separator
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            table_buf.append(cells)
            continue
        else:
            end_table()

        if not line.strip():
            pdf.ln(2)
            continue
        if line.startswith("# "):
            continue  # H1 = cover title
        if line.startswith("## "):
            write_heading(pdf, clean(line[3:]), 2)
            continue
        if line.startswith("### "):
            write_heading(pdf, clean(line[4:]), 3)
            continue
        if line.startswith("---"):
            pdf.ln(2)
            continue
        if line.startswith("- ") or line.startswith("* "):
            ensure_space(pdf, 10)
            write_body(pdf, "•  " + clean(line[2:]), 10)
            continue
        if re.match(r"^\d+\.\s", line):
            ensure_space(pdf, 10)
            write_body(pdf, clean(line), 10)
            continue
        if line.startswith("> "):
            ensure_space(pdf, 10)
            write_muted(pdf, clean(line[2:]), 10)
            continue
        # normal paragraph
        ensure_space(pdf, 10)
        write_body(pdf, clean(line), 10)

    end_table()


def build_one(job: dict) -> None:
    md_path: Path = job["md"]
    out: Path = job["out"]
    if not md_path.exists():
        print(f"SKIP missing {md_path}")
        return
    text = md_path.read_text(encoding="utf-8")
    pdf = DocPDF(header_title=job["title"])
    register_fonts(pdf)
    pdf.set_margins(16, 20, 16)
    pdf.add_page()
    cover(pdf, job["title"], job["subtitle"], job["lang"])
    pdf.add_page()
    render_md(pdf, text)
    out.parent.mkdir(parents=True, exist_ok=True)
    pdf.output(str(out))
    print(f"OK {out.name}  pages={pdf.page_no()}  {out.stat().st_size // 1024} KB")


def main() -> None:
    for job in JOBS:
        build_one(job)


if __name__ == "__main__":
    main()
