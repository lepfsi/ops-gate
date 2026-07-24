"""Helpers branding DailyOps / OpsGate pour PDF (fpdf2).

Logo = même marque « porte / bouclier » que BrandMark.tsx / opsgate-mark.svg
(fond dégradé navy→teal, glyph teal #2BD9C5 + lock slate clair).

Source couverture : assets/brand/Template.png

RÈGLES OBLIGATOIRES (prochains PDF) :
  1. Page de couverture = SANS footer (pas de bandeau bas type pages intérieures,
     pas de « Page X », pas de mini-logo footer).
  2. Pages intérieures = fond CLAIR (blanc), pas de blocs dark partout.
  3. Logo mark = couleurs produit (glyph TEAL, fond dégradé), jamais un carré
     noir opaque avec glyph illisible.

Les PDF déjà générés dans docs/*.pdf ne sont PAS regénérés automatiquement.
"""
from __future__ import annotations

from pathlib import Path

from fpdf import FPDF

ROOT = Path(__file__).resolve().parents[1]
BRAND_DIR = ROOT / "assets" / "brand"
TEMPLATE_COVER = BRAND_DIR / "Template.png"
FONT_REG = Path(r"C:\Windows\Fonts\arial.ttf")
FONT_BOLD = Path(r"C:\Windows\Fonts\arialbd.ttf")
if not FONT_BOLD.exists():
    FONT_BOLD = FONT_REG

# ---------------------------------------------------------------------------
# Charte produit (Template.png + BrandMark / opsgate-banner)
# ---------------------------------------------------------------------------
NAVY = (10, 17, 40)  # #0A1128 — titres, header fin pages intérieures
NAVY2 = (17, 28, 68)  # #111C44
# Fond couverture Template : teal profond (uniquement page 1)
COVER_BG = (11, 55, 62)
COVER_BG_DEEP = (8, 32, 42)
TEAL = (43, 217, 197)  # #2BD9C5 — accent + glyph logo
TEAL_MID = (15, 118, 110)  # #0F766E — bas du dégradé mark
TEAL_SOFT = (230, 250, 247)  # #E6FAF7 — callouts clairs
TEAL_INK = (13, 148, 136)  # #0d9488
INK = (15, 23, 42)
GRAY = (100, 116, 139)
WHITE = (255, 255, 255)
SLATE = (226, 232, 240)  # #E2E8F0 — corps serrure logo
MUTED = (148, 163, 184)

BRAND_ACCENT = TEAL
BRAND_COVER_BG = COVER_BG


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
    BrandMark produit (opsgate-mark.svg / BrandMark.tsx) :
    - fond dégradé navy → teal (#0A1128 → #0F766E), PAS un carré noir
    - porte + tête de serrure en TEAL #2BD9C5
    - corps de serrure en slate clair #E2E8F0
    """
    r = max(3.0, size * 0.22)
    # Dégradé approximé (2 bandes) — lisible même en petit
    pdf.set_fill_color(*NAVY)
    _round_rect(pdf, x, y, size, size, r, "F")
    pdf.set_fill_color(*TEAL_MID)
    # bas du mark (teinte teal)
    try:
        pdf.set_fill_color(*TEAL_MID)
        pdf.rect(x + 0.8, y + size * 0.52, size - 1.6, size * 0.42, style="F")
        # re-clip arrondi bas approximatif
        pdf.set_fill_color(*TEAL_MID)
    except Exception:
        pass
    # liseré teal semi
    pdf.set_draw_color(*TEAL)
    pdf.set_line_width(0.5)
    _round_rect(pdf, x + 0.5, y + 0.5, size - 1.0, size - 1.0, r * 0.85, "D")

    s = size / 32.0
    ox, oy = x, y

    def px(vx: float, vy: float) -> tuple[float, float]:
        return ox + vx * s, oy + vy * s

    # Glyph centré (viewBox 32 → scale dans le carré ~58%)
    # On dessine dans le repère mark complet (comme BrandMark 32x32 dans le carré)
    pdf.set_draw_color(*TEAL)
    pdf.set_line_width(max(1.0, size * 0.055))
    left_x, top_y = px(8, 12)
    right_x, _ = px(24, 12)
    arch_top = px(16, 5)[1]
    bottom = px(8, 22)[1]
    pdf.line(left_x, bottom, left_x, top_y)
    pdf.line(right_x, bottom, right_x, top_y)
    arch_h = max(2.0, top_y - arch_top)
    arch_w = right_x - left_x
    pdf.ellipse(left_x, arch_top, arch_w, arch_h * 2, style="D")
    # masquer bas de l'ellipse (fond mark)
    pdf.set_fill_color(*NAVY)
    pdf.rect(left_x - 0.4, top_y, arch_w + 0.8, arch_h + 1.5, style="F")
    # retirer les montants
    pdf.set_draw_color(*TEAL)
    pdf.set_line_width(max(1.0, size * 0.055))
    pdf.line(left_x, bottom, left_x, top_y)
    pdf.line(right_x, bottom, right_x, top_y)

    # Tête de serrure TEAL
    lock_x, lock_y = px(12.8, 14.5)
    lock_w, lock_h = 6.4 * s, 4.2 * s
    pdf.set_fill_color(*TEAL)
    _round_rect(pdf, lock_x, lock_y, lock_w, lock_h, max(0.8, 1.2 * s), "F")
    # Corps serrure SLATE clair
    base_x, base_y = px(12.5, 18.5)
    pdf.set_draw_color(*SLATE)
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
