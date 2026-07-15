#!/usr/bin/env python3
"""Génère assets/icons/icon-*.png marque porte/bouclier (enrollment)."""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets" / "icons"
BRAND = ROOT / "packages" / "console" / "public" / "brand"


def draw_mark(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # fond arrondi navy→teal
    pad = max(1, size // 16)
    # rectangle arrondi simplifié
    r = max(4, size // 5)
    d.rounded_rectangle(
        [pad, pad, size - pad - 1, size - pad - 1],
        radius=r,
        fill=(10, 17, 40, 255),
    )
    # accent bande basse
    d.rounded_rectangle(
        [pad, size // 2, size - pad - 1, size - pad - 1],
        radius=r,
        fill=(15, 118, 110, 255),
    )
    d.rounded_rectangle(
        [pad, pad, size - pad - 1, size // 2 + r],
        radius=r,
        fill=(10, 17, 40, 255),
    )
    # porte (arc)
    teal = (43, 217, 197, 255)
    light = (226, 232, 240, 255)
    cx, cy = size // 2, int(size * 0.42)
    arch_w = int(size * 0.42)
    arch_h = int(size * 0.38)
    # cadre porte
    left = cx - arch_w // 2
    right = cx + arch_w // 2
    top = cy - arch_h // 2
    bottom = int(size * 0.72)
    # arc haut
    d.arc(
        [left, top, right, top + arch_w],
        start=180,
        end=0,
        fill=teal,
        width=max(2, size // 16),
    )
    d.line([(left, cy), (left, bottom)], fill=teal, width=max(2, size // 16))
    d.line([(right, cy), (right, bottom)], fill=teal, width=max(2, size // 16))
    # serrure
    lock_s = max(3, size // 8)
    lx, ly = cx, int(size * 0.52)
    d.ellipse(
        [lx - lock_s, ly - lock_s, lx + lock_s, ly + lock_s // 2],
        fill=teal,
    )
    d.rectangle(
        [lx - lock_s, ly, lx + lock_s, ly + lock_s + 2],
        outline=light,
        width=max(1, size // 32),
    )
    return img


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    BRAND.mkdir(parents=True, exist_ok=True)
    for s in (16, 32, 48, 64, 128, 256, 512, 1024):
        im = draw_mark(s)
        im.save(OUT / f"icon-{s}.png")
        print("wrote", OUT / f"icon-{s}.png")
    master = draw_mark(512)
    master.save(ROOT / "assets" / "icon.png")
    print("wrote", ROOT / "assets" / "icon.png")
    for s, name in ((48, "icon-48.png"), (128, "icon-128.png")):
        draw_mark(s).save(BRAND / name)
        print("wrote", BRAND / name)


if __name__ == "__main__":
    main()
