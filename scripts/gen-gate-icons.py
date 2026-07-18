#!/usr/bin/env python3
"""
Génère les icônes extension à partir de la marque officielle OpsGate.

Source de vérité (même que PDF + page enrôlement + BrandMark.tsx) :
  packages/console/public/brand/opsgate-mark.svg

Ne PAS utiliser opsgate-icon-refined.jpg (autre asset marketing).
"""
from __future__ import annotations

import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SVG = ROOT / "packages" / "console" / "public" / "brand" / "opsgate-mark.svg"
OUT = ROOT / "assets" / "icons"
BRAND = ROOT / "packages" / "console" / "public" / "brand"
SIZES = (16, 32, 48, 64, 128, 256, 512, 1024)


def render_with_resvg(svg_bytes: bytes, size: int) -> bytes:
    """Node @resvg/resvg-js → PNG bytes (cwd = monorepo root)."""
    import subprocess
    import tempfile

    script = r"""
const { createRequire } = require('module');
const path = require('path');
const fs = require('fs');
const root = process.cwd();
const requireFromRoot = createRequire(path.join(root, 'package.json'));
const { Resvg } = requireFromRoot('@resvg/resvg-js');
const size = Number(process.argv[2]);
const svg = fs.readFileSync(0);
const resvg = new Resvg(svg, {
  fitTo: { mode: 'width', value: size },
  background: 'rgba(0,0,0,0)',
});
const png = resvg.render().asPng();
process.stdout.write(png);
"""
    path = ROOT / "scripts" / "_tmp_resvg_render.js"
    path.write_text(script, encoding="utf-8")
    try:
        proc = subprocess.run(
            ["node", str(path), str(size)],
            input=svg_bytes,
            capture_output=True,
            check=False,
            cwd=str(ROOT),
        )
        if proc.returncode != 0:
            raise RuntimeError(proc.stderr.decode("utf-8", errors="replace")[:800])
        if not proc.stdout.startswith(b"\x89PNG"):
            raise RuntimeError("resvg did not return PNG")
        return proc.stdout
    finally:
        path.unlink(missing_ok=True)


def render_with_pil(size: int):
    """Fallback PIL : BrandMark exact (porte + serrure)."""
    from PIL import Image, ImageDraw

    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # Fond arrondi + dégradé navy → teal (comme BrandMark)
    radius = max(4, int(size * 0.22))
    # Gradient vertical simple
    for y in range(size):
        t = y / max(1, size - 1)
        # #0A1128 → #0F766E
        r = int(10 + (15 - 10) * t)
        g = int(17 + (118 - 17) * t)
        b = int(40 + (110 - 40) * t)
        d.line([(0, y), (size, y)], fill=(r, g, b, 255))
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, size - 1, size - 1], radius=radius, fill=255
    )
    bg = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    bg.paste(img, (0, 0))
    bg.putalpha(mask)
    img = bg
    d = ImageDraw.Draw(img)

    # Liseré teal
    inset = max(1, size // 64)
    d.rounded_rectangle(
        [inset, inset, size - 1 - inset, size - 1 - inset],
        radius=max(3, radius - 1),
        outline=(43, 217, 197, 90),
        width=max(1, size // 64),
    )

    # Glyph 32x32 à 58% centré (BrandMark)
    glyph = size * 0.58
    ox = (size - glyph) / 2
    oy = (size - glyph) / 2
    s = glyph / 32.0

    def P(x: float, y: float) -> tuple[float, float]:
        return ox + x * s, oy + y * s

    teal = (43, 217, 197, 255)
    light = (226, 232, 240, 255)
    stroke = max(2, int(round(2 * s)))

    # Arche porte : M8 22 V12 c0-4 3.5-7 8-7 s8 3 8 7 v10
    # Approximation : lignes verticales + arc haut
    left = P(8, 12)
    right = P(24, 12)
    bottom_l = P(8, 22)
    bottom_r = P(24, 22)
    # arc bounding box for ellipse half
    arch_left = P(8, 5)
    arch_right = P(24, 12)
    # ellipse for arch: from (8,5) to (24,19) roughly - cubic was c0-4 3.5-7 8-7
    # Control: from (8,12) curve to (16,5) to (24,12)
    box = [P(8, 5)[0], P(5, 5)[1], P(24, 5)[0], P(19, 5)[1]]
    # Use arc on upper half of ellipse [8,5]-[24,19]
    el = [P(8, 5)[0], P(5, 5)[1], P(24, 5)[0], P(19, 12)[1]]
    # Better ellipse: top at y=5, sides at y=12
    el = [P(8, 5)[0], P(5, 5)[1], P(24, 5)[0], P(19, 12)[1]]
    d.arc(el, start=180, end=0, fill=teal, width=stroke)
    d.line([P(8, 12), P(8, 22)], fill=teal, width=stroke)
    d.line([P(24, 12), P(24, 22)], fill=teal, width=stroke)

    # Tête serrure fill: M16 14.5 c-1.8 0-3.2 1.3-3.2 3 v1.2 h6.4 V17.5 c0-1.7-1.4-3-3.2-3z
    lock_top = [
        P(12.8, 17.5),
        P(12.8, 15.8),
        P(14.2, 14.5),
        P(16, 14.5),
        P(17.8, 14.5),
        P(19.2, 15.8),
        P(19.2, 17.5),
        P(19.2, 18.7),
        P(12.8, 18.7),
    ]
    # Rounded top via ellipse + rect
    d.ellipse(
        [P(12.8, 14.5)[0], P(14.5, 14.5)[1], P(19.2, 14.5)[0], P(18.7, 14.5)[1]],
        fill=teal,
    )
    d.rectangle(
        [P(12.8, 16.5), P(19.2, 18.7)],
        fill=teal,
    )

    # Corps serrure outline: M12.5 18.5 h7 v4.2 c0 1.6-1.6 3-3.5 3 s-3.5-1.4-3.5-3 v-4.2z
    body_stroke = max(1, int(round(1.6 * s)))
    x0, y0 = P(12.5, 18.5)
    x1, y1 = P(19.5, 18.5)
    y2 = P(19.5, 22.7)[1]
    # bottom rounded
    d.rounded_rectangle(
        [x0, y0, x1, P(19.5, 25.7)[1]],
        radius=max(1, int(1.5 * s)),
        outline=light,
        width=body_stroke,
    )

    return img


def save_png(path: Path, png_bytes: bytes | None = None, pil_img=None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if png_bytes is not None:
        path.write_bytes(png_bytes)
    elif pil_img is not None:
        pil_img.save(path, "PNG", optimize=True)
    else:
        raise ValueError("no image")
    print("wrote", path)


def main() -> None:
    if not SVG.exists():
        raise SystemExit(f"SVG manquant: {SVG}")

    svg_bytes = SVG.read_bytes()
    use_resvg = True
    try:
        render_with_resvg(svg_bytes, 64)
        print("renderer = @resvg/resvg-js")
    except Exception as e:
        use_resvg = False
        print("renderer = PIL fallback (", str(e)[:120], ")")

    OUT.mkdir(parents=True, exist_ok=True)
    BRAND.mkdir(parents=True, exist_ok=True)

    for s in SIZES:
        if use_resvg:
            save_png(OUT / f"icon-{s}.png", png_bytes=render_with_resvg(svg_bytes, s))
        else:
            save_png(OUT / f"icon-{s}.png", pil_img=render_with_pil(s))

    # Plasmo source
    if use_resvg:
        save_png(ROOT / "assets" / "icon.png", png_bytes=render_with_resvg(svg_bytes, 512))
    else:
        save_png(ROOT / "assets" / "icon.png", pil_img=render_with_pil(512))

    for s, name in ((48, "icon-48.png"), (128, "icon-128.png")):
        if use_resvg:
            save_png(BRAND / name, png_bytes=render_with_resvg(svg_bytes, s))
        else:
            save_png(BRAND / name, pil_img=render_with_pil(s))

    # Favicons console (même marque)
    favicon_svg = BRAND / "favicon.svg"
    fav_bytes = favicon_svg.read_bytes() if favicon_svg.exists() else svg_bytes
    for s, name in (
        (16, "favicon-16.png"),
        (32, "favicon-32.png"),
        (48, "favicon-48.png"),
        (32, "favicon.png"),
    ):
        if use_resvg:
            png = render_with_resvg(fav_bytes, s)
            save_png(BRAND / name, png_bytes=png)
            if name == "favicon.png":
                save_png(ROOT / "packages" / "console" / "public" / "favicon.png", png_bytes=png)
        else:
            im = render_with_pil(s)
            save_png(BRAND / name, pil_img=im)
            if name == "favicon.png":
                save_png(ROOT / "packages" / "console" / "public" / "favicon.png", pil_img=im)

    print("ok - marque BrandMark / enrolement / PDF / favicon")


if __name__ == "__main__":
    main()
