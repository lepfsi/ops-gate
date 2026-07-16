#!/usr/bin/env python3
"""Génère docs/GUIDE-UTILISATEUR.pdf — charte DailyOps + BrandMark login MMC."""
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
    NAVY2,
    TEAL,
    TEAL_SOFT,
    WHITE,
    draw_brand_mark,
    draw_login_brand,
    font_name,
    register_fonts,
)

MD = ROOT / "docs" / "GUIDE-UTILISATEUR.md"
OUT = ROOT / "docs" / "GUIDE-UTILISATEUR.pdf"


class GuidePDF(FPDF):
    def header(self) -> None:
        if self.page_no() == 1:
            return
        self.set_fill_color(*NAVY)
        self.rect(0, 0, self.w, 15, "F")
        draw_brand_mark(self, self.l_margin, 2.5, 10)
        self.set_xy(self.l_margin + 14, 4)
        self.set_font(font_name(), "B", 9)
        self.set_text_color(*WHITE)
        self.cell(0, 7, "OpsGate  |  Guide utilisateur V1  |  DailyOps.Tech")
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
            f"Page {self.page_no() - 1}  ·  DailyOps.Tech  ·  Guide administrateur",
            align="C",
        )


def uw(pdf: FPDF) -> float:
    return pdf.w - pdf.l_margin - pdf.r_margin


def clean_md(s: str) -> str:
    s = s.replace("\u2019", "'").replace("\u2018", "'")
    s = s.replace("\u201c", '"').replace("\u201d", '"')
    s = s.replace("\u2013", "-").replace("\u2014", "-")
    s = s.replace("\u2026", "...")
    s = s.replace("\u2265", ">=").replace("\u2264", "<=")
    s = s.replace("\u2192", "->").replace("\u00b7", " · ")
    s = re.sub(r"\*\*([^*]+)\*\*", r"\1", s)
    s = re.sub(r"`([^`]+)`", r"\1", s)
    s = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", s)
    return s


def cover(pdf: GuidePDF) -> None:
    pdf.set_fill_color(*NAVY)
    pdf.rect(0, 0, pdf.w, pdf.h, "F")
    pdf.set_fill_color(*TEAL)
    pdf.rect(0, 0, pdf.w, 7, "F")
    pdf.rect(0, pdf.h - 9, pdf.w, 9, "F")

    mark = 56
    mx = (pdf.w - mark) / 2
    my = 52
    draw_brand_mark(pdf, mx, my, mark)

    pdf.set_y(my + mark + 14)
    pdf.set_font(font_name(), "B", 30)
    pdf.set_text_color(*WHITE)
    pdf.cell(0, 12, "OpsGate", align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(2)
    pdf.set_font(font_name(), "", 12)
    pdf.set_text_color(*TEAL)
    pdf.cell(0, 7, "DailyOps.Tech", align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(12)
    pdf.set_draw_color(*TEAL)
    pdf.set_line_width(1.3)
    mid = pdf.w / 2
    pdf.line(mid - 28, pdf.get_y(), mid + 28, pdf.get_y())
    pdf.ln(12)
    pdf.set_font(font_name(), "B", 16)
    pdf.set_text_color(*WHITE)
    pdf.cell(0, 9, "Guide utilisateur", align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font(font_name(), "", 11)
    pdf.set_text_color(*MUTED)
    pdf.cell(
        0,
        7,
        "Administrateurs console · pilotes · support",
        align="C",
        new_x="LMARGIN",
        new_y="NEXT",
    )
    pdf.ln(10)
    pdf.set_font(font_name(), "", 10)
    pdf.set_text_color(*TEAL)
    pdf.cell(0, 6, "Version produit 1.2", align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.set_text_color(*MUTED)
    pdf.cell(
        0,
        6,
        "Extension · Console MMC · Policies · Licences · Logs · Recovery",
        align="C",
        new_x="LMARGIN",
        new_y="NEXT",
    )
    pdf.add_page()


def write_body(pdf: GuidePDF, text: str, size: int = 10) -> None:
    pdf.set_x(pdf.l_margin)
    pdf.set_font(font_name(), "", size)
    pdf.set_text_color(*INK)
    pdf.multi_cell(uw(pdf), 5.3, text)


def main() -> None:
    if not MD.exists():
        raise SystemExit(f"Missing {MD}")

    text = MD.read_text(encoding="utf-8")
    pdf = GuidePDF(format="A4")
    pdf.set_auto_page_break(auto=True, margin=16)
    pdf.set_margins(16, 22, 16)
    register_fonts(pdf)
    pdf.add_page()
    cover(pdf)

    draw_login_brand(
        pdf,
        pdf.l_margin,
        pdf.get_y(),
        mark_size=34,
        title="OpsGate",
        subtitle="Guide administrateur · Console MMC",
        light=False,
    )
    pdf.ln(6)

    # intro callout
    y = pdf.get_y()
    pdf.set_fill_color(*TEAL_SOFT)
    pdf.rect(pdf.l_margin, y, uw(pdf), 18, "F")
    pdf.set_fill_color(*TEAL)
    pdf.rect(pdf.l_margin, y, 3.2, 18, "F")
    pdf.set_xy(pdf.l_margin + 7, y + 3)
    pdf.set_font(font_name(), "", 9)
    pdf.set_text_color(*NAVY)
    pdf.multi_cell(
        uw(pdf) - 12,
        4.6,
        "Usage quotidien d'OpsGate : extension, console, enrôlement, policies, "
        "licences, logs et recovery. Installation technique : GUIDE-STACK-LOCALE.md.",
    )
    pdf.set_y(y + 20)

    in_code = False
    table_buf: list[list[str]] = []

    def flush_table() -> None:
        nonlocal table_buf
        if not table_buf:
            return
        headers = table_buf[0]
        rows = table_buf[1:]
        table_buf = []
        n = max(1, len(headers))
        col_w = [uw(pdf) / n] * n
        pdf.ln(1)
        if pdf.get_y() > pdf.h - 30:
            pdf.add_page()
        pdf.set_fill_color(*NAVY)
        pdf.set_text_color(*WHITE)
        pdf.set_font(font_name(), "B", 8)
        x0 = pdf.l_margin
        for i, h in enumerate(headers):
            pdf.set_x(x0 + sum(col_w[:i]))
            pdf.cell(col_w[i], 6.5, clean_md(h)[:40], fill=True)
        pdf.ln(6.5)
        pdf.set_draw_color(*TEAL)
        pdf.set_line_width(0.6)
        pdf.line(x0, pdf.get_y(), x0 + uw(pdf), pdf.get_y())
        fill = False
        for row in rows:
            if pdf.get_y() > pdf.h - 18:
                pdf.add_page()
            if fill:
                pdf.set_fill_color(*TEAL_SOFT)
            else:
                pdf.set_fill_color(*WHITE)
            pdf.set_text_color(*INK)
            pdf.set_font(font_name(), "", 8)
            y0 = pdf.get_y()
            pdf.rect(x0, y0, uw(pdf), 6.2, "F")
            for i, c in enumerate(row):
                if i >= n:
                    break
                pdf.set_xy(x0 + sum(col_w[:i]), y0 + 0.6)
                txt = clean_md(c)
                max_c = max(8, int(col_w[i] / 1.7))
                if len(txt) > max_c:
                    txt = txt[: max_c - 1] + "…"
                pdf.cell(col_w[i], 5, txt)
            pdf.set_y(y0 + 6.2)
            fill = not fill
        pdf.ln(2)

    for raw in text.splitlines():
        line = raw.rstrip()

        # tables
        if line.startswith("|"):
            # separator row
            if re.match(r"^\|[\s|:-]+\|$", line.replace(" ", "") if False else line) or re.search(
                r"^\|?\s*:?-{2,}", line
            ):
                # |---|---|
                if set(line.replace("|", "").replace("-", "").replace(":", "").replace(" ", "")) == set():
                    continue
                if re.fullmatch(r"\|?[\s\-:|]+\|?", line):
                    continue
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            table_buf.append(cells)
            continue
        else:
            flush_table()

        if line.startswith("```"):
            in_code = not in_code
            continue
        if in_code:
            if pdf.get_y() > pdf.h - 16:
                pdf.add_page()
            pdf.set_font("Courier", "", 8)
            pdf.set_text_color(*INK)
            pdf.set_fill_color(248, 250, 252)
            pdf.set_x(pdf.l_margin)
            pdf.multi_cell(uw(pdf), 4.5, clean_md(line)[:140] or " ", fill=True)
            continue

        if not line.strip():
            pdf.ln(2)
            continue
        if line.startswith("# "):
            # skip main H1 (cover already has it)
            continue
        if line.startswith("## "):
            flush_table()
            if pdf.get_y() > pdf.h - 28:
                pdf.add_page()
            pdf.ln(3)
            pdf.set_font(font_name(), "B", 13)
            pdf.set_text_color(*NAVY)
            pdf.multi_cell(uw(pdf), 7, clean_md(line[3:]))
            y = pdf.get_y()
            pdf.set_draw_color(*TEAL)
            pdf.set_line_width(0.9)
            pdf.line(pdf.l_margin, y + 0.5, pdf.l_margin + 28, y + 0.5)
            pdf.ln(3)
            continue
        if line.startswith("### "):
            if pdf.get_y() > pdf.h - 20:
                pdf.add_page()
            pdf.ln(1)
            pdf.set_font(font_name(), "B", 11)
            pdf.set_text_color(*NAVY2)
            pdf.multi_cell(uw(pdf), 6, clean_md(line[4:]))
            pdf.ln(0.5)
            continue
        if line.startswith("---"):
            continue
        if line.startswith("> "):
            pdf.set_font(font_name(), "I", 10)
            pdf.set_text_color(*GRAY)
            write_body(pdf, clean_md(line[2:]), 10)
            continue
        if line.startswith("- ") or re.match(r"^\d+\.\s", line):
            if pdf.get_y() > pdf.h - 16:
                pdf.add_page()
            body = re.sub(r"^\d+\.\s*", "", line)
            if body.startswith("- "):
                body = body[2:]
            pdf.set_font(font_name(), "", 10)
            pdf.set_text_color(*INK)
            pdf.set_x(pdf.l_margin)
            prefix = "  •  " if line.startswith("- ") else "  "
            if re.match(r"^\d+\.\s", line):
                m = re.match(r"^(\d+)\.\s*(.*)", line)
                prefix = f"  {m.group(1)}. " if m else "  "
                body = m.group(2) if m else body
            pdf.multi_cell(uw(pdf), 5.2, prefix + clean_md(body))
            continue

        # bold-ish lines **meta**
        if line.startswith("**") and line.endswith("**"):
            pdf.set_font(font_name(), "B", 10)
            pdf.set_text_color(*INK)
            pdf.set_x(pdf.l_margin)
            pdf.multi_cell(uw(pdf), 5.3, clean_md(line))
            continue

        if pdf.get_y() > pdf.h - 16:
            pdf.add_page()
        write_body(pdf, clean_md(line), 10)

    flush_table()

    # closing brand strip
    pdf.ln(10)
    if pdf.get_y() > pdf.h - 40:
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
