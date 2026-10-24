#!/usr/bin/env python3
"""Build the Foundation trace atlas from the art preview's native source tiles."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageEnhance
import random

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/Objects/BuildingMaterials/wreck-plinth.png'
village = Image.open(ROOT / 'extra_assets/themed-tilesets/Ruined Medieval Village/tile-B-03.png').convert('RGBA')
cavern = Image.open(ROOT / 'extra_assets/16x16/Rogue Adventure World/Rogue Adventure World [Sprites]/Tilesets/RA_Cavern_Full.png').convert('RGBA')
stone = village.crop((16, 18, 32, 28)).resize((10, 10), Image.Resampling.NEAREST)
dirt = cavern.crop((224, 16, 240, 32))
grit = cavern.crop((272, 16, 288, 32))
atlas = Image.new('RGBA', (512, 512), '#504b3d')
# Both caps and sides use the same weathered source stone as the preview.
for y in range(0, 128, 10):
    for x in range(0, 512, 10):
        atlas.alpha_composite(stone, (x, y))
# A translucent, uneven stain lets the original grass/earth show through.
# Stone caps remain opaque; only the ground region carries this alpha.
floor = Image.new('RGBA', (384, 384), (0, 0, 0, 0))
rng = random.Random(126)
mask = Image.new('L', floor.size, 22)
stains = ImageDraw.Draw(mask)
for _ in range(85):
    x, y = rng.randrange(384), rng.randrange(384)
    w, h = rng.randrange(15, 72), rng.randrange(10, 54)
    stains.ellipse((x-w, y-h, x+w, y+h), fill=rng.randrange(40, 105))
mask = mask.filter(ImageFilter.GaussianBlur(8))
for y in range(0, 384, 16):
    for x in range(0, 384, 16):
        tile = ImageEnhance.Brightness(dirt).enhance(.55)
        floor.alpha_composite(tile, (x, y))
floor.putalpha(mask)
# Match the study at footprint scale: the 384px atlas shrinks to roughly 145px.
# Larger source chips retain the study's 4–8px rubble clusters after that shrink.
# Their dark faded tones settle into the terrain instead of making a bright slab.
for _ in range(3200):
    x, y = rng.randrange(384), rng.randrange(384)
    size = rng.randrange(10, 21)
    chip = grit.resize((size, max(4, round(size * .8))), Image.Resampling.NEAREST)
    chip = ImageEnhance.Brightness(chip).enhance(.65)
    chip.putalpha(chip.getchannel('A').point(lambda a: round(a * .55)))
    floor.alpha_composite(chip, (x, y))
# Keep even overlapped rubble translucent.
alpha = floor.getchannel('A')
alpha = alpha.point(lambda a: min(a, 165))
floor.putalpha(alpha)
atlas.paste(floor, (0, 128))
ImageDraw.Draw(atlas).rectangle((508, 124, 511, 127), fill='white')
atlas.save(OUT)
print(OUT.relative_to(ROOT))
