#!/usr/bin/env python3
"""Build the shared broken-plinth atlas from native game and extra-asset tiles."""
from pathlib import Path
from PIL import Image, ImageDraw
import random

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/Objects/BuildingMaterials/wreck-plinth.png'
wall = Image.open(ROOT / 'assets/Objects/Castle/FDR/atlas.png').convert('RGBA').crop((392, 8, 504, 120)).resize((16, 16), Image.Resampling.NEAREST)
cavern = Image.open(ROOT / 'extra_assets/16x16/Rogue Adventure World/Rogue Adventure World [Sprites]/Tilesets/RA_Cavern_Full.png').convert('RGBA')
dirt = cavern.crop((224, 16, 240, 32))
grit = cavern.crop((272, 16, 288, 32))
atlas = Image.new('RGBA', (512, 512), '#706758')
for y in range(0, 128, 16):
    for x in range(0, 256, 16):
        atlas.paste(wall, (x, y))
cap = Image.new('RGBA', (16, 16), '#b6aa93')
rng = random.Random(223)
draw = ImageDraw.Draw(cap)
for i in range(17):
    x, y = rng.randrange(16), rng.randrange(16)
    draw.rectangle((x, y, x + i % 2, y), fill='#a99d86' if i % 3 else '#c8bca5')
for y in range(0, 128, 16):
    for x in range(256, 512, 16):
        atlas.paste(cap, (x, y))
# Sparse, small source-pixel chips over fine ground; no large painted timbers.
floor = Image.new('RGBA', (384, 384), '#706758')
for y in range(0, 384, 16):
    for x in range(0, 384, 16):
        floor.alpha_composite(dirt, (x, y))
floor = Image.blend(floor, Image.new('RGBA', floor.size, '#777263'), .18)
rng = random.Random(126)
for _ in range(1700):
    size = rng.randrange(4, 8)
    chip = grit.resize((size, max(3, size * 4 // 5)), Image.Resampling.NEAREST)
    chip.putalpha(chip.getchannel('A').point(lambda a: round(a * .72)))
    floor.alpha_composite(chip, (rng.randrange(384), rng.randrange(384)))
atlas.paste(floor, (0, 128))
ImageDraw.Draw(atlas).rectangle((508, 124, 511, 127), fill='white')
atlas.save(OUT)
print(OUT.relative_to(ROOT))
