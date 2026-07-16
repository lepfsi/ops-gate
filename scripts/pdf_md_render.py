#!/usr/bin/env python3
"""
Rendu Markdown → PDF robuste (fpdf2).

Évite :
  - multi_cell avec x hors marge (texte coupé à droite / pages quasi vides)
  - tableaux qui orphelinent une cellule par page
  - troncatures agressives "…" sans wrapping
  - double saut de page (auto + manuel)
"""
from __future__ import annotations

import re
from typing import Callable

from fpdf import FPDF
from fpdf.enums import XPos, YPos

from pdf_brand import (
    GRAY,
    INK,
    MUTED,
    NAVY,
    TEAL,
    TEAL_SOFT,
    WHITE,
    font_name,
)

# Marges contenu (sous le bandeau header 15 mm)
CONTENT_TOP = 20.0
FOOTER_RESERVE = 16.0


def uw(pdf: FPDF) -> float:
    return pdf.w - pdf.l_margin - pdf.r_margin


def clean(s: str) -> str:
    """Nettoie markdown inline + caractères problématiques fpdf2."""
    if s is None:
        return ""
    s = str(s)
    s = s.replace("\u2019", "'").replace("\u2018", "'")
    s = s.replace("\u201c", '"').replace("\u201d", '"')
    s = s.replace("\u2013", "-").replace("\u2014", "-")
    s = s.replace("\u2026", "...").replace("\u2192", "->")
    s = s.replace("\u00b7", " · ").replace("\u2265", ">=")
    s = s.replace("\u2264", "<=").replace("\u2713", "OK")
    s = s.replace("\u00a0", " ")
    # markdown inline
    s = re.sub(r"\*\*([^*]+)\*\*", r"\1", s)
    s = re.sub(r"(?<!\*)\*([^*]+)\*(?!\*)", r"\1", s)
    s = re.sub(r"`([^`]+)`", r"\1", s)
    s = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", s)
    s = s.replace("\\*", "*").replace("\\_", "_")
    # fpdf2 traite \ comme échappement — chemins Windows
    s = s.replace("\\", "/")
    # espaces multiples (souvent après strip markdown)
    s = re.sub(r"[ \t]{2,}", " ", s)
    return s.strip()


def reset_x(pdf: FPDF) -> None:
    pdf.set_x(pdf.l_margin)


def usable_bottom(pdf: FPDF) -> float:
    return pdf.h - pdf.b_margin


def ensure_space(pdf: FPDF, need: float) -> None:
    """Saut de page si pas assez de place. Toujours remet x à la marge."""
    if pdf.get_y() + need > usable_bottom(pdf):
        pdf.add_page()
    reset_x(pdf)


def write_text(
    pdf: FPDF,
    text: str,
    *,
    size: float = 10,
    style: str = "",
    color: tuple[int, int, int] = INK,
    line_h: float = 5.2,
    indent: float = 0,
) -> None:
    """Paragraphe pleine largeur depuis la marge (+ indent optionnel)."""
    text = clean(text)
    if not text:
        return
    reset_x(pdf)
    pdf.set_font(font_name(), style, size)
    pdf.set_text_color(*color)
    w = uw(pdf) - indent
    if indent:
        pdf.set_x(pdf.l_margin + indent)
    # width explicite + retour marge gauche (évite x qui dérive)
    pdf.multi_cell(
        w,
        line_h,
        text,
        new_x=XPos.LMARGIN,
        new_y=YPos.NEXT,
    )


def write_heading(pdf: FPDF, text: str, level: int = 2) -> None:
    text = clean(text)
    if not text:
        return
    need = 22 if level == 2 else 16
    ensure_space(pdf, need)
    pdf.ln(4 if level == 2 else 2.5)
    reset_x(pdf)
    if level == 2:
        pdf.set_font(font_name(), "B", 13)
        pdf.set_text_color(*NAVY)
        pdf.multi_cell(uw(pdf), 7, text, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        y = pdf.get_y()
        pdf.set_draw_color(*TEAL)
        pdf.set_line_width(0.85)
        pdf.line(pdf.l_margin, y + 0.5, pdf.l_margin + 34, y + 0.5)
        pdf.ln(3)
    else:
        pdf.set_font(font_name(), "B", 11)
        pdf.set_text_color(*NAVY)
        pdf.multi_cell(uw(pdf), 6, text, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        pdf.ln(1.2)


def _wrap_lines(pdf: FPDF, text: str, max_w: float, size: float, style: str = "") -> list[str]:
    """Découpe text en lignes qui tiennent dans max_w (mesure réelle font)."""
    text = clean(text)
    if not text:
        return [""]
    if max_w < 8:
        max_w = 8
    pdf.set_font(font_name(), style, size)
    # fpdf2 >= 2.7.4 : dry_run + output=LINES
    try:
        lines = pdf.multi_cell(
            max_w,
            4.0,
            text,
            new_x=XPos.LMARGIN,
            new_y=YPos.NEXT,
            dry_run=True,
            output="LINES",
        )
        if isinstance(lines, list) and lines:
            return [str(ln) if ln is not None else "" for ln in lines]
    except (TypeError, ValueError, Exception):
        pass
    # fallback manuel
    words = text.split(" ")
    out: list[str] = []
    cur = ""
    for w in words:
        trial = (cur + " " + w).strip() if cur else w
        if pdf.get_string_width(trial) <= max_w:
            cur = trial
        else:
            if cur:
                out.append(cur)
            if pdf.get_string_width(w) > max_w:
                chunk = ""
                for ch in w:
                    if pdf.get_string_width(chunk + ch) <= max_w:
                        chunk += ch
                    else:
                        if chunk:
                            out.append(chunk)
                        chunk = ch
                cur = chunk
            else:
                cur = w
    if cur:
        out.append(cur)
    return out or [""]


def _col_widths(pdf: FPDF, rows: list[list[str]], n: int) -> list[float]:
    """Largeurs de colonnes proportionnelles au contenu (min/max bornés)."""
    total = uw(pdf)
    # mesure caractères max par colonne
    weights: list[float] = []
    pdf.set_font(font_name(), "", 8)
    for i in range(n):
        maxlen = 4.0
        for row in rows:
            if i < len(row):
                maxlen = max(maxlen, float(len(clean(row[i]))))
        weights.append(maxlen)
    s = sum(weights) or 1.0
    # bornes : min 18 mm, max 55% de la largeur
    raw = [max(18.0, total * (w / s)) for w in weights]
    # renormalize
    rs = sum(raw)
    cols = [c * total / rs for c in raw]
    # cap very wide first columns
    for i in range(n):
        if cols[i] > total * 0.55:
            cols[i] = total * 0.55
    rs = sum(cols)
    return [c * total / rs for c in cols]


def flush_table(pdf: FPDF, rows: list[list[str]]) -> None:
    """
    Tableau avec wrapping multi-lignes par cellule.
    Une ligne logique = un seul bloc (pas de cellule orpheline sur page vide).
    """
    if not rows:
        return
    # normaliser nombre de colonnes
    n = max(len(r) for r in rows)
    norm: list[list[str]] = []
    for r in rows:
        rr = [clean(c) for c in r] + [""] * (n - len(r))
        norm.append(rr[:n])

    headers = norm[0]
    body = norm[1:]
    col_w = _col_widths(pdf, norm, n)
    x0 = pdf.l_margin
    pad = 1.5
    font_size = 8.0
    line_h = 4.0

    pdf.ln(2)
    ensure_space(pdf, 16)

    def draw_row(cells: list[str], *, header: bool, fill_alt: bool) -> None:
        # préparer lignes wrappées
        wrapped: list[list[str]] = []
        for i, cell in enumerate(cells):
            style = "B" if header else ""
            max_w = col_w[i] - 2 * pad
            wrapped.append(_wrap_lines(pdf, cell, max_w, font_size, style))
        nlines = max(1, max(len(wl) for wl in wrapped))
        row_h = max(6.2 if header else 5.8, nlines * line_h + 2.2)

        # garder la ligne entière sur une page
        if pdf.get_y() + row_h > usable_bottom(pdf):
            pdf.add_page()
            reset_x(pdf)

        y0 = pdf.get_y()
        # fond
        if header:
            pdf.set_fill_color(*NAVY)
            pdf.rect(x0, y0, uw(pdf), row_h, "F")
        elif fill_alt:
            pdf.set_fill_color(*TEAL_SOFT)
            pdf.rect(x0, y0, uw(pdf), row_h, "F")
        else:
            pdf.set_fill_color(*WHITE)
            pdf.rect(x0, y0, uw(pdf), row_h, "F")

        # séparateurs verticaux légers (évite l'effet "texte collé / coupé")
        if not header and n > 1:
            pdf.set_draw_color(210, 220, 230)
            pdf.set_line_width(0.2)
            for i in range(1, n):
                vx = x0 + sum(col_w[:i])
                pdf.line(vx, y0 + 0.4, vx, y0 + row_h - 0.4)

        # texte
        for i, lines in enumerate(wrapped):
            cx = x0 + sum(col_w[:i]) + pad
            pdf.set_font(font_name(), "B" if header else "", font_size)
            pdf.set_text_color(*(WHITE if header else INK))
            ty = y0 + 1.2
            for ln in lines:
                pdf.set_xy(cx, ty)
                # largeur fixe, ancré LEFT, x ne dérive pas hors cellule
                pdf.cell(
                    col_w[i] - 2 * pad,
                    line_h,
                    ln,
                    new_x=XPos.RIGHT,
                    new_y=YPos.TOP,
                )
                ty += line_h

        # bordure basse fine
        pdf.set_draw_color(226, 232, 240)
        pdf.set_line_width(0.25)
        pdf.line(x0, y0 + row_h, x0 + uw(pdf), y0 + row_h)

        pdf.set_y(y0 + row_h)
        reset_x(pdf)

        if header:
            pdf.set_draw_color(*TEAL)
            pdf.set_line_width(0.7)
            pdf.line(x0, pdf.get_y(), x0 + uw(pdf), pdf.get_y())

    draw_row(headers, header=True, fill_alt=False)
    for idx, row in enumerate(body):
        draw_row(row, header=False, fill_alt=(idx % 2 == 1))

    pdf.ln(2)
    reset_x(pdf)


def write_code_block(pdf: FPDF, lines: list[str]) -> None:
    """Bloc de code : fond unique, lignes wrappées, pas de page vide."""
    if not lines:
        return
    pdf.ln(1.5)
    font_size = 7.5
    line_h = 4.2
    pad = 3.0
    x0 = pdf.l_margin
    w = uw(pdf)

    # pré-wrap toutes les lignes
    wrapped_all: list[str] = []
    for raw in lines:
        txt = clean(raw) if raw.strip() else " "
        max_w = w - 2 * pad
        parts = _wrap_lines(pdf, txt, max_w, font_size, "")
        if not parts:
            parts = [" "]
        wrapped_all.extend(parts)

    # dessiner par page (si long)
    i = 0
    while i < len(wrapped_all):
        ensure_space(pdf, 12)
        y_start = pdf.get_y()
        avail = usable_bottom(pdf) - y_start - 2
        max_lines = max(1, int(avail / line_h))
        chunk = wrapped_all[i : i + max_lines]
        h = len(chunk) * line_h + 2 * pad * 0.5

        pdf.set_fill_color(245, 247, 250)
        pdf.set_draw_color(226, 232, 240)
        pdf.set_line_width(0.2)
        pdf.rect(x0, y_start, w, h + pad, "DF")

        pdf.set_font(font_name(), "", font_size)
        pdf.set_text_color(*INK)
        ty = y_start + pad * 0.5
        for ln in chunk:
            pdf.set_xy(x0 + pad, ty)
            pdf.cell(w - 2 * pad, line_h, ln, new_x=XPos.LMARGIN, new_y=YPos.TOP)
            ty += line_h

        pdf.set_y(y_start + h + pad + 1)
        reset_x(pdf)
        i += len(chunk)

    pdf.ln(1)
    reset_x(pdf)


def write_callout(pdf: FPDF, text: str) -> None:
    text = clean(text)
    if not text:
        return
    ensure_space(pdf, 18)
    x0 = pdf.l_margin
    w = uw(pdf)
    # mesurer hauteur
    lines = _wrap_lines(pdf, text, w - 14, 9, "")
    h = max(12.0, len(lines) * 4.8 + 6)
    if pdf.get_y() + h > usable_bottom(pdf):
        pdf.add_page()
        reset_x(pdf)
    y0 = pdf.get_y()
    pdf.set_fill_color(*TEAL_SOFT)
    pdf.rect(x0, y0, w, h, "F")
    pdf.set_fill_color(*TEAL)
    pdf.rect(x0, y0, 3.0, h, "F")
    pdf.set_font(font_name(), "", 9)
    pdf.set_text_color(*NAVY)
    ty = y0 + 3
    for ln in lines:
        pdf.set_xy(x0 + 7, ty)
        pdf.cell(w - 12, 4.8, ln, new_x=XPos.LMARGIN, new_y=YPos.TOP)
        ty += 4.8
    pdf.set_y(y0 + h + 3)
    reset_x(pdf)


def render_markdown(pdf: FPDF, text: str, *, skip_h1: bool = True) -> None:
    """
    Parse un sous-ensemble Markdown et le dessine.
    skip_h1: ignore # titre (souvent déjà sur la couverture).
    """
    in_code = False
    code_buf: list[str] = []
    table_buf: list[list[str]] = []

    def end_table() -> None:
        nonlocal table_buf
        if table_buf:
            flush_table(pdf, table_buf)
            table_buf = []

    def end_code() -> None:
        nonlocal code_buf, in_code
        if code_buf:
            write_code_block(pdf, code_buf)
            code_buf = []
        in_code = False

    for raw in text.splitlines():
        line = raw.rstrip()

        # fences
        if line.strip().startswith("```"):
            if in_code:
                end_code()
            else:
                end_table()
                in_code = True
                code_buf = []
            continue

        if in_code:
            code_buf.append(line)
            continue

        # tables
        if line.lstrip().startswith("|"):
            # separator |---|---|
            stripped = line.strip()
            if re.fullmatch(r"\|?[\s\-:|]+\|?", stripped):
                continue
            cells = [c.strip() for c in stripped.strip("|").split("|")]
            table_buf.append(cells)
            continue
        else:
            end_table()

        if not line.strip():
            pdf.ln(2.2)
            reset_x(pdf)
            continue

        if line.startswith("# "):
            if skip_h1:
                continue
            write_heading(pdf, line[2:], 2)
            continue
        if line.startswith("## "):
            write_heading(pdf, line[3:], 2)
            continue
        if line.startswith("### "):
            write_heading(pdf, line[4:], 3)
            continue
        if line.startswith("#### "):
            write_heading(pdf, line[5:], 3)
            continue
        if line.startswith("---"):
            pdf.ln(1)
            continue
        if line.startswith("> "):
            write_callout(pdf, line[2:])
            continue
        if line.startswith("- ") or line.startswith("* "):
            ensure_space(pdf, 10)
            write_text(pdf, "•  " + line[2:], size=10, line_h=5.2)
            continue
        m = re.match(r"^(\d+)\.\s+(.*)$", line)
        if m:
            ensure_space(pdf, 10)
            write_text(pdf, f"{m.group(1)}.  {m.group(2)}", size=10, line_h=5.2)
            continue
        # meta **label** : value
        if line.startswith("**") and "**" in line[2:]:
            ensure_space(pdf, 10)
            write_text(pdf, line, size=10, style="", line_h=5.2)
            continue

        ensure_space(pdf, 10)
        write_text(pdf, line, size=10, line_h=5.2)

    end_table()
    if in_code:
        end_code()


def make_doc_pdf(
    header_title: str,
    *,
    footer_extra: str = "OpsGate V2",
) -> FPDF:
    """FPDF A4 avec bandeau header/footer brandés."""

    class DocPDF(FPDF):
        def __init__(self) -> None:
            super().__init__(format="A4")
            self._header_title = header_title
            self._footer_extra = footer_extra
            self.set_auto_page_break(auto=True, margin=FOOTER_RESERVE)
            self.set_margins(16, CONTENT_TOP, 16)

        def header(self) -> None:
            if self.page_no() == 1:
                return
            from pdf_brand import draw_brand_mark

            self.set_fill_color(*NAVY)
            self.rect(0, 0, self.w, 15, "F")
            draw_brand_mark(self, self.l_margin, 2.5, 10)
            self.set_xy(self.l_margin + 14, 4.5)
            self.set_font(font_name(), "B", 9)
            self.set_text_color(*WHITE)
            title = self._header_title
            if len(title) > 70:
                title = title[:67] + "..."
            self.cell(0, 6, title, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
            self.set_draw_color(*TEAL)
            self.set_line_width(1.2)
            self.line(0, 15, self.w, 15)
            # position contenu sous le bandeau
            self.set_y(CONTENT_TOP)
            self.set_x(self.l_margin)

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
            # page_no()-1 car couverture = page 0 pour le lecteur
            self.cell(
                0,
                6,
                f"Page {self.page_no() - 1}  ·  DailyOps.Tech  ·  {self._footer_extra}",
                align="C",
                new_x=XPos.LMARGIN,
                new_y=YPos.NEXT,
            )

    return DocPDF()


def draw_cover(
    pdf: FPDF,
    title: str,
    subtitle: str,
    *,
    lang: str = "",
    extra_lines: list[str] | None = None,
) -> None:
    """Couverture pleine page navy + BrandMark."""
    from pdf_brand import draw_brand_mark

    pdf.set_fill_color(*NAVY)
    pdf.rect(0, 0, pdf.w, pdf.h, "F")
    pdf.set_fill_color(*TEAL)
    pdf.rect(0, 0, pdf.w, 7, "F")
    pdf.rect(0, pdf.h - 9, pdf.w, 9, "F")

    mark = 52
    mx = (pdf.w - mark) / 2
    my = 48
    draw_brand_mark(pdf, mx, my, mark)

    pdf.set_y(my + mark + 14)
    pdf.set_font(font_name(), "B", 28)
    pdf.set_text_color(*WHITE)
    pdf.cell(0, 12, "OpsGate", align="C", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.ln(2)
    pdf.set_font(font_name(), "", 12)
    pdf.set_text_color(*TEAL)
    pdf.cell(0, 7, "DailyOps.Tech", align="C", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.ln(10)
    pdf.set_draw_color(*TEAL)
    pdf.set_line_width(1.2)
    mid = pdf.w / 2
    pdf.line(mid - 30, pdf.get_y(), mid + 30, pdf.get_y())
    pdf.ln(12)

    pdf.set_font(font_name(), "B", 15)
    pdf.set_text_color(*WHITE)
    pdf.set_x(pdf.l_margin + 12)
    pdf.multi_cell(
        pdf.w - 2 * pdf.l_margin - 24,
        8,
        clean(title),
        align="C",
        new_x=XPos.LMARGIN,
        new_y=YPos.NEXT,
    )
    pdf.ln(4)
    pdf.set_font(font_name(), "", 11)
    pdf.set_text_color(*TEAL)
    pdf.set_x(pdf.l_margin + 12)
    pdf.multi_cell(
        pdf.w - 2 * pdf.l_margin - 24,
        6,
        clean(subtitle),
        align="C",
        new_x=XPos.LMARGIN,
        new_y=YPos.NEXT,
    )

    if extra_lines:
        pdf.ln(8)
        pdf.set_font(font_name(), "", 10)
        pdf.set_text_color(*MUTED)
        for el in extra_lines:
            pdf.cell(0, 5.5, clean(el), align="C", new_x=XPos.LMARGIN, new_y=YPos.NEXT)

    pdf.ln(12)
    pdf.set_font(font_name(), "", 10)
    pdf.set_text_color(*MUTED)
    tag = f"DailyOps.Tech  ·  OpsGate  ·  {lang}" if lang else "DailyOps.Tech  ·  OpsGate"
    pdf.cell(0, 6, tag, align="C", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
