from pathlib import Path

from PIL import Image

candidates = [
    Path(
        r"C:\Users\Utilisateur\.grok\sessions\C%3A%5CUsers%5CUtilisateur\019f4d1a-227d-7793-a62d-90cde968089c\images\4.jpg"
    ),
    Path("assets/brand/opsgate-icon-refined.jpg"),
    Path("assets/icons/icon-128.png"),
]
src = next(p for p in candidates if p.exists())
img = Image.open(src).convert("RGBA")
out_dir = Path("assets/icons")
out_dir.mkdir(exist_ok=True)
for s in (16, 32, 48, 64, 128, 256, 512, 1024):
    r = img.resize((s, s), Image.Resampling.LANCZOS)
    if s == 512:
        r.save("assets/icon.png", "PNG")
    if s == 1024:
        r.save(out_dir / "icon-1024.png", "PNG")
    else:
        r.save(out_dir / f"icon-{s}.png", "PNG")
img.resize((48, 48), Image.Resampling.LANCZOS).save(
    "packages/console/public/brand/icon-48.png", "PNG"
)
img.resize((128, 128), Image.Resampling.LANCZOS).save(
    "packages/console/public/brand/icon-128.png", "PNG"
)
print("ok source=", src)
