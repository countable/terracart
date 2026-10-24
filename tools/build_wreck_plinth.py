#!/usr/bin/env python3
"""Build the Foundation trace atlas from the art preview's native source tiles."""
from pathlib import Path
from PIL import Image, ImageDraw
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
# Ground stays flat; fine native chips carry the rubble detail.
floor = Image.new('RGBA', (384, 384), '#71695a')
for y in range(0, 384, 16):
    for x in range(0, 384, 16):
        tile = dirt.copy()
        tile.putalpha(tile.getchannel('A').point(lambda a: round(a * .75)))
        floor.alpha_composite(tile, (x, y))
floor = Image.alpha_composite(floor, Image.new('RGBA', floor.size, (119, 114, 99, 53)))
rng = random.Random(126)
for _ in range(3200):
    x, y = rng.randrange(384), rng.randrange(384)
    size = rng.randrange(4, 8)
    chip = grit.resize((size, max(3, round(size * .8))), Image.Resampling.NEAREST)
    chip.putalpha(chip.getchannel('A').point(lambda a: round(a * .72)))
    floor.alpha_composite(chip, (x, y))
atlas.paste(floor, (0, 128))
ImageDraw.Draw(atlas).rectangle((508, 124, 511, 127), fill='white')
atlas.save(OUT)
print(OUT.relative_to(ROOT))
