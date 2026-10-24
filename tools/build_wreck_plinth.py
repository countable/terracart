#!/usr/bin/env python3
"""Build weathered stone and dark rubble for the shared broken-plinth atlas."""
from pathlib import Path
from PIL import Image, ImageDraw
import random

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/Objects/BuildingMaterials/wreck-plinth.png'
atlas = Image.new('RGBA', (512, 512), '#706758')
# Irregular, rounded fieldstones: clipped corners and soft, broken edge light.
wall = Image.new('RGBA', (256, 128), '#625e50')
draw = ImageDraw.Draw(wall)
rng = random.Random(223)
for row, y in enumerate(range(-2, 128, 6)):
    for x in range(-12 + (row % 2) * 6, 256, 12):
        w, h = rng.randrange(8, 12), rng.randrange(4, 6)
        c = rng.choice(['#8b8675', '#928b79', '#817e6e', '#99907e'])
        draw.polygon([(x+2,y),(x+w-2,y),(x+w,y+2),(x+w-1,y+h-1),
                      (x+w-3,y+h),(x+2,y+h),(x,y+h-2),(x,y+2)], fill=c)
        draw.line([(x+2,y+1),(x+w-3,y+1)], fill='#a09884')
        draw.point((x+3,y+2), fill='#777362')
        if rng.random() < .5:
            draw.line([(x+w-2,y+h-2),(x+w-4,y+h-1)], fill='#6e6b5d')
atlas.paste(wall, (0, 0))
cap = Image.new('RGBA', (16, 16), '#908875')
rng = random.Random(223)
draw = ImageDraw.Draw(cap)
for i in range(17):
    x, y = rng.randrange(16), rng.randrange(16)
    draw.rectangle((x, y, x + i % 2, y), fill='#7f7c6a' if i % 3 else '#9c927e')
for y in range(0, 128, 16):
    for x in range(256, 512, 16):
        atlas.paste(cap, (x, y))
# Low-contrast earth with sparse small rounded rubble, rather than bright gravel.
floor = Image.new('RGBA', (384, 384), '#48483f')
draw = ImageDraw.Draw(floor)
rng = random.Random(126)
for _ in range(2600):
    x, y = rng.randrange(384), rng.randrange(384)
    w, h = rng.randrange(2, 6), rng.randrange(1, 4)
    draw.rectangle((x,y,x+w,y+h), fill=rng.choice(['#45463d','#4b4b41','#4e4d43']))
for _ in range(620):
    x, y = rng.randrange(384), rng.randrange(384)
    w, h = rng.randrange(2, 6), rng.randrange(2, 4)
    draw.polygon([(x+1,y),(x+w-1,y),(x+w,y+1),(x+w-1,y+h),(x+1,y+h),(x,y+1)],
                 fill=rng.choice(['#5a584b','#605c4e','#545347']))
atlas.paste(floor, (0, 128))
ImageDraw.Draw(atlas).rectangle((508, 124, 511, 127), fill='white')
atlas.save(OUT)
print(OUT.relative_to(ROOT))
