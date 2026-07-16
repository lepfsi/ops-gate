"""Helpers branding DailyOps / OpsGate pour PDF (fpdf2).

Logo = même marque « porte / bouclier » que BrandMark.tsx (page login MMC).
"""
from __future__ import annotations

from pathlib import Path

from fpdf import FPDF

ROOT = Path(__file__).resolve().parents[1]
FONT_REG = Path(r"C:\Windows\Fonts\arial.ttf")
FONT_BOLD = Path(r"C:\Windows\Fonts\arialbd.ttf")
if not FONT_BOLD.exists():
    FONT_BOLD = FONT_REG

# Charte DailyOps.Tech
NAVY = (10, 17, 40)  # #0A1128
NAVY2 = (17, 28, 68)  # #111C44
TEAL = (43, 217, 197)  # #2BD9C5
TEAL_SOFT = (230, 250, 247)  # #E6FAF7
TEAL_INK = (13, 148, 136)  # #0d9488
INK = (15, 23, 42)
GRAY = (100, 116, 139)
WHITE = (255, 255, 255)
SLATE = (226, 232, 240)
MUTED = (148, 163, 184)


def register_fonts(pdf: FPDF) -> None:
    """Arial système pour accents FR (é, è, à…)."""
    if FONT_REG.exists():
        pdf.add_font("Brand", "", str(FONT_REG))
        pdf.add_font("Brand", "B", str(FONT_BOLD))
        pdf.add_font("Brand", "I", str(FONT_REG))
    else:
        # fallback Helvetica (sans accents)
        pass


def font_name() -> str:
    return "Brand" if FONT_REG.exists() else "Helvetica"


def _round_rect(pdf: FPDF, x: float, y: float, w: float, h: float, r: float, style: str = "F") -> None:
    """Carré arrondi compatible fpdf2 (API privée stable)."""
    try:
        from fpdf.enums import RenderStyle

        st = (
            RenderStyle.DF
            if style == "DF"
            else RenderStyle.D
            if style == "D"
            else RenderStyle.F
        )
        pdf._draw_rounded_rect(x, y, w, h, st, True, r)
    except Exception:
        pdf.rect(x, y, w, h, style=style if style in ("F", "D", "DF") else "F")


def draw_brand_mark(pdf: FPDF, x: float, y: float, size: float = 44) -> None:
    """
    Reproduit BrandMark.tsx (login MMC) :
    carré arrondi navy, porte/bouclier teal.
    """
    r = max(3.0, size * 0.22)
    # Fond navy
    pdf.set_fill_color(*NAVY)
    _round_rect(pdf, x, y, size, size, r, "F")
    # liseré teal
    pdf.set_draw_color(*TEAL)
    pdf.set_line_width(0.55)
    _round_rect(pdf, x + 0.5, y + 0.5, size - 1.0, size - 1.0, r * 0.85, "D")

    s = size / 32.0
    ox, oy = x, y

    def px(vx: float, vy: float) -> tuple[float, float]:
        return ox + vx * s, oy + vy * s

    pdf.set_draw_color(*TEAL)
    pdf.set_line_width(max(1.05, size * 0.055))
    left_x, top_y = px(8, 12)
    right_x, _ = px(24, 12)
    arch_top = px(16, 5)[1]
    bottom = px(8, 22)[1]
    pdf.line(left_x, bottom, left_x, top_y)
    pdf.line(right_x, bottom, right_x, top_y)
    arch_h = max(2.0, top_y - arch_top)
    arch_w = right_x - left_x
    pdf.ellipse(left_x, arch_top, arch_w, arch_h * 2, style="D")
    # masquer bas de l'ellipse
    pdf.set_fill_color(*NAVY)
    pdf.rect(left_x - 0.4, top_y, arch_w + 0.8, arch_h + 2, style="F")
    pdf.set_draw_color(*TEAL)
    pdf.set_line_width(max(1.05, size * 0.055))
    pdf.line(left_x, bottom, left_x, top_y)
    pdf.line(right_x, bottom, right_x, top_y)

    # Serrure
    lock_x, lock_y = px(12.8, 14.5)
    lock_w, lock_h = 6.4 * s, 4.2 * s
    pdf.set_fill_color(*TEAL)
    _round_rect(pdf, lock_x, lock_y, lock_w, lock_h, max(0.8, 1.2 * s), "F")
    base_x, base_y = px(12.5, 18.5)
    pdf.set_draw_color(226, 232, 240)
    pdf.set_line_width(max(0.75, size * 0.04))
    _round_rect(pdf, base_x, base_y, 7 * s, 7.2 * s, max(0.8, 1.5 * s), "D")


def draw_login_brand(
    pdf: FPDF,
    x: float,
    y: float,
    *,
    mark_size: float = 44,
    title: str = "OpsGate",
    subtitle: str = "Console MMC · DailyOps.Tech",
    light: bool = False,
) -> float:
    """Bloc marque comme page login : BrandMark + titre + sous-titre. Positionne le curseur sous le bloc."""
    draw_brand_mark(pdf, x, y, mark_size)
    tx = x + mark_size + 10
    fn = font_name()
    pdf.set_xy(tx, y + max(2, mark_size * 0.12))
    pdf.set_font(fn, "B", 18)
    pdf.set_text_color(*(WHITE if light else NAVY))
    pdf.cell(0, 9, title)
    pdf.set_xy(tx, y + max(14, mark_size * 0.42))
    pdf.set_font(fn, "", 10)
    pdf.set_text_color(*(TEAL if light else TEAL_INK))
    pdf.cell(0, 6, subtitle)
    bottom = y + mark_size + 6
    pdf.set_y(bottom)
    return bottom
