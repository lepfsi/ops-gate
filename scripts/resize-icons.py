#!/usr/bin/env python3
"""
Génère le jeu d’icônes extension à partir du logo adopté (porte + bouclier).

Source prioritaire : assets/brand/opsgate-icon-refined.jpg
Sortie : assets/icon.png + assets/icons/icon-*.png + brand console.
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]

SOURCES = [
    ROOT / "assets" / "brand" / "opsgate-icon-refined.jpg",
    ROOT / "assets" / "brand" / "opsgate-icon-dailyops.jpg",
    ROOT / "assets" / "icons" / "icon-1024.png",
]


def rounded_mask(size: int, radius: int | None = None) -> Image.Image:
    r = radius if radius is not None else max(2, size // 5)
    mask = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(mask)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=r, fill=255)
    return mask


def fit_square(img: Image.Image, size: int, pad_ratio: float = 0.06) -> Image.Image:
    """Centre le logo dans un carré sans le couper (padding léger)."""
    img = img.convert("RGBA")
    # Fond navy proche du logo
    canvas = Image.new("RGBA", (size, size), (10, 17, 40, 255))
    pad = max(1, int(size * pad_ratio))
    inner = size - 2 * pad
    # Conserve le ratio, scale pour rentrer entièrement
    w, h = img.size
    scale = min(inner / w, inner / h)
    nw, nh = max(1, int(w * scale)), max(1, int(h * scale))
    resized = img.resize((nw, nh), Image.Resampling.LANCZOS)
    x = (size - nw) // 2
    y = (size - nh) // 2
    canvas.paste(resized, (x, y), resized)
    # Coins arrondis (style app icon Chrome)
    mask = rounded_mask(size)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(canvas, (0, 0))
    out.putalpha(mask)
    return out


def main() -> None:
    src = next((p for p in SOURCES if p.exists()), None)
    if not src:
        raise SystemExit("Aucune source logo trouvée (opsgate-icon-refined.jpg)")

    master = Image.open(src).convert("RGBA")
    print("source =", src, master.size)

    out_dir = ROOT / "assets" / "icons"
    out_dir.mkdir(parents=True, exist_ok=True)
    brand = ROOT / "packages" / "console" / "public" / "brand"
    brand.mkdir(parents=True, exist_ok=True)

    sizes = (16, 32, 48, 64, 128, 256, 512, 1024)
    for s in sizes:
        # petits formats : un peu moins de padding pour lisibilité
        pad = 0.04 if s <= 32 else 0.06
        im = fit_square(master, s, pad_ratio=pad)
        path = out_dir / f"icon-{s}.png"
        im.save(path, "PNG", optimize=True)
        print("wrote", path)

    # Source Plasmo
    icon512 = fit_square(master, 512, pad_ratio=0.06)
    icon512.save(ROOT / "assets" / "icon.png", "PNG", optimize=True)
    print("wrote", ROOT / "assets" / "icon.png")

    fit_square(master, 48, 0.05).save(brand / "icon-48.png", "PNG", optimize=True)
    fit_square(master, 128, 0.06).save(brand / "icon-128.png", "PNG", optimize=True)
    print("wrote brand icons")
    print("ok")


if __name__ == "__main__":
    main()
