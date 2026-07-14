#!/usr/bin/env python3
"""Génère docs/GUIDE-UTILISATEUR.pdf depuis GUIDE-UTILISATEUR.md (fpdf2)."""
from __future__ import annotations

import re
from pathlib import Path

from fpdf import FPDF

ROOT = Path(__file__).resolve().parents[1]
MD = ROOT / "docs" / "GUIDE-UTILISATEUR.md"
OUT = ROOT / "docs" / "GUIDE-UTILISATEUR.pdf"

NAVY = (10, 17, 40)
TEAL = (43, 217, 197)
GRAY = (100, 116, 139)
INK = (15, 23, 42)


class GuidePDF(FPDF):
    def header(self) -> None:
        self.set_font("Helvetica", "B", 9)
        self.set_text_color(*GRAY)
        self.cell(0, 8, "OpsGate  |  Guide utilisateur V1", align="L")
        self.ln(4)
        self.set_draw_color(*TEAL)
        self.set_line_width(0.4)
        y = self.get_y()
        self.line(self.l_margin, y, self.w - self.r_margin, y)
        self.ln(6)

    def footer(self) -> None:
        self.set_y(-12)
        self.set_font("Helvetica", "", 8)
        self.set_text_color(*GRAY)
        self.cell(0, 8, f"Page {self.page_no()}/{{nb}}", align="C")


def clean(s: str) -> str:
    s = s.replace("\u2019", "'").replace("\u2018", "'")
    s = s.replace("\u201c", '"').replace("\u201d", '"')
    s = s.replace("\u2013", "-").replace("\u2014", "-")
    s = s.replace("\u2026", "...")
    s = s.replace("\u2265", ">=").replace("\u2264", "<=")
    s = s.replace("\u2192", "->").replace("\u00b7", "-")
    s = re.sub(r"\*\*([^*]+)\*\*", r"\1", s)
    s = re.sub(r"`([^`]+)`", r"\1", s)
    s = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", s)
    # latin-1 safe for core Helvetica
    return s.encode("latin-1", "replace").decode("latin-1")


def write_body(pdf: GuidePDF, text: str) -> None:
    pdf.set_x(pdf.l_margin)
    usable = pdf.w - pdf.l_margin - pdf.r_margin
    pdf.multi_cell(usable, 5.5, text)


def main() -> None:
    text = MD.read_text(encoding="utf-8")
    pdf = GuidePDF(format="A4")
    pdf.alias_nb_pages()
    pdf.set_auto_page_break(auto=True, margin=18)
    pdf.add_page()
    pdf.set_margins(16, 18, 16)
    pdf.set_auto_page_break(auto=True, margin=18)

    in_code = False
    for raw in text.splitlines():
        line = raw.rstrip()
        if line.startswith("```"):
            in_code = not in_code
            continue
        if in_code:
            pdf.set_font("Courier", "", 8)
            pdf.set_text_color(*INK)
            write_body(pdf, clean(line)[:120] or " ")
            continue
        if not line.strip():
            pdf.ln(2)
            continue
        if line.startswith("# "):
            pdf.set_font("Helvetica", "B", 16)
            pdf.set_text_color(*NAVY)
            write_body(pdf, clean(line[2:]))
            pdf.ln(2)
            continue
        if line.startswith("## "):
            pdf.ln(2)
            pdf.set_font("Helvetica", "B", 12)
            pdf.set_text_color(*NAVY)
            write_body(pdf, clean(line[3:]))
            pdf.ln(1)
            continue
        if line.startswith("### "):
            pdf.set_font("Helvetica", "B", 11)
            pdf.set_text_color(*INK)
            write_body(pdf, clean(line[4:]))
            continue
        if line.startswith("|") and re.search(r"^\|?\s*:?-{3,}", line.replace("|", " ").strip() or "-"):
            continue
        if set(line.replace("|", "").replace("-", "").replace(":", "").replace(" ", "")) == set():
            continue
        if line.startswith("|"):
            cells = [c.strip() for c in line.strip("|").split("|")]
            pdf.set_font("Helvetica", "", 8)
            pdf.set_text_color(*INK)
            write_body(pdf, clean(" | ".join(cells)))
            continue
        if line.startswith("- ") or re.match(r"^\d+\. ", line):
            pdf.set_font("Helvetica", "", 10)
            pdf.set_text_color(*INK)
            body = re.sub(r"^\d+\.\s*", "", line)
            if body.startswith("- "):
                body = body[2:]
            write_body(pdf, f"- {clean(body)}")
            continue
        if line.startswith("---"):
            continue
        if line.startswith(">"):
            pdf.set_font("Helvetica", "I", 10)
            pdf.set_text_color(*GRAY)
            write_body(pdf, clean(line.lstrip("> ").strip()))
            continue
        pdf.set_font("Helvetica", "", 10)
        pdf.set_text_color(*INK)
        write_body(pdf, clean(line))

    # Pilote recovery
    pdf.add_page()
    pdf.set_font("Helvetica", "B", 14)
    pdf.set_text_color(*NAVY)
    write_body(pdf, "Annexe - Pilote recovery one-time")
    pdf.ln(2)
    steps = [
        "1. Console (principal) > Admins & groupes > Generer N codes (ex. 10).",
        "2. Copier ou telecharger le .txt - affichage unique.",
        "3. Force-sync est lance auto apres generation.",
        "4. Sur l'agent, attendre sync (ou Synchroniser dans Options).",
        "5. Mettre l'agent offline > 2h (ou last sync ancien en test).",
        "6. Desinscription : username vendor + un code XXXX-XXXX-XXXX-XXXX.",
        "7. Code consomme : plus actif en console ; un second usage echoue.",
        "8. Stock bas (<5) : regenerer + force-sync.",
    ]
    pdf.set_font("Helvetica", "", 10)
    pdf.set_text_color(*INK)
    for s in steps:
        write_body(pdf, s)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    pdf.output(str(OUT))
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    main()
