"""Native FD L01 lamp and authored broken-state derivative (no generated art)."""
from pathlib import Path
from PIL import Image
ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'extra_assets/16x16/Fantasy Dreamland World/Fantasy Dreamland Reborn/Tilesets/FDR_Village.png'
out = ROOT / 'assets/Objects/SelectedProps/selected_streetlamp.png'
lamp = Image.open(SOURCE).convert('RGBA').crop((192, 416, 224, 448))
broken = lamp.copy()
# Keep the original foot and lower shaft, cut away arm/lantern. Staggered
# severed wood edge is authored by removing pixels, never moving the foot.
for y in range(32):
    for x in range(32):
        if y < (21 if x % 2 else 22) or (x >= 12):
            broken.putpixel((x, y), (0, 0, 0, 0))
atlas = Image.new('RGBA', (64, 32)); atlas.paste(lamp, (0, 0)); atlas.paste(broken, (32, 0))
atlas.save(out)
