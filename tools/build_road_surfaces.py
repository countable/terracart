#!/usr/bin/env python3
"""Bake neutral stone/soil grain; RoadSurfaces lays paving along each road."""
import json
import math
import random
import re
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/Objects/RoadSurfaces'
PREFIX = 'extra_assets/16x16/Rogue Adventure World/Rogue Adventure World [Sprites]/Tilesets/'
SOURCES = {
    'gravel': {'path': PREFIX + 'RA_Ground_Tiles.png', 'crop': [32, 208, 16, 16]},
    'grit': {'path': PREFIX + 'RA_Ground_Tiles.png', 'crop': [224, 208, 16, 16]},
    'mineral': {'path': PREFIX + 'RA_Ground_Tiles.png', 'crop': [352, 208, 16, 16]},
    'crust': {'path': PREFIX + 'RA_Hell.png', 'crop': [32, 112, 16, 16]},
    'rune': {'path': PREFIX + 'RA_Ancient.png', 'crop': [304, 16, 16, 16]},
}

def crop(name):
    spec = SOURCES[name]
    x, y, w, h = spec['crop']
    return Image.open(ROOT / spec['path']).convert('RGBA').crop((x, y, x+w, y+h))

def toned(name, color, contrast):
    image = crop(name)
    pixels = list(image.getdata())
    luminance = lambda p: p[0]*.2126 + p[1]*.7152 + p[2]*.0722
    mean = sum(luminance(p) for p in pixels) / len(pixels)
    image.putdata([tuple(max(0, min(255, round(v + (luminance(p)-mean)*contrast))) for v in color)+(255,) for p in pixels])
    return image

def repeat(source, size=128):
    tile = source.resize((32, 32), Image.Resampling.NEAREST)
    image = Image.new('RGBA', (size, size))
    for y in range(0, size, 32):
        for x in range(0, size, 32):
            image.paste(tile, (x, y))
    return image

def medium(restored):
    lift = 8 if restored else 0
    # Quiet mineral bedding, without vegetation or a baked directional grid.
    # Route-aligned setts and dividing bands belong to RoadSurfaces.decorate.
    image = repeat(toned('gravel', [119+lift, 111+lift, 96+lift], .28))
    grit = repeat(toned('grit', [124+lift, 116+lift, 103+lift], .24))
    image = Image.blend(image, grit, .18)
    if not restored:
        # Missing paving exposes the terrain inside the vector band.
        # These are stable world-phased holes, not standing scenery or loot.
        draw = ImageDraw.Draw(image)
        rng = random.Random(71309)
        for _ in range(8):
            x, y = rng.randrange(128), rng.randrange(128)
            radius = rng.randrange(2, 5)
            pts = [(x+round(math.cos(a)*radius*rng.uniform(.6, 1.2)), y+round(math.sin(a)*radius*rng.uniform(.6, 1.2))) for a in [0, 1, 2, 3, 4, 5]]
            for ox in (-128, 0, 128):
                for oy in (-128, 0, 128):
                    draw.polygon([(px+ox, py+oy) for px, py in pts], fill=(0, 0, 0, 0))
    return image

def rune_rows():
    image = crop('rune')
    rows = []
    mask = Image.new('RGBA', (16, 16))
    pixels = image.load()
    for y in range(16):
        start = None
        for x in range(17):
            if x < 16:
                r, g, b, a = pixels[x, y]
                green = a > 0 and g > r*1.13 and g > b*1.03 and g > 65
            else:
                green = False
            if green:
                mask.putpixel((x, y), (255, 255, 255, 255))
                if start is None: start = x
            elif start is not None:
                rows.append([start, x, y]); start = None
    return rows, mask

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    frames = [medium(False), medium(True), repeat(toned('crust', [32,47,47], .32)), repeat(toned('mineral', [43,52,60], .24))]
    sheet = Image.new('RGBA', (512, 128))
    for i, frame in enumerate(frames): sheet.paste(frame, (i*128, 0))
    sheet.save(OUT / 'surfaces.png')
    rows, mask = rune_rows(); mask.save(OUT / 'rune-mask.png')
    manifest = {'schemaVersion': 1, 'tileSize': 128, 'sourceArt': SOURCES,
        'frames': [{'family': f, 'restored': r, 'x': i*128, 'y': 0, 'width': 128, 'height': 128} for i, (f,r) in enumerate([('md',False),('md',True),('lg',False),('lg',True)])],
        'runeRows': rows, 'recipes': {'md': 'neutral low-contrast mineral bedding, G07 plus 18% G08 grit; road-aligned ancient pavers are geometry; weathered holes use seed71309; no vegetation', 'lgWeathered': 'fine broken slate plates over turquoise dimensional scar Hell crust', 'lgRestored': 'ancient dimensional conduit mineral bed with fine joints, paired channels and small native rune silhouette'}}
    (OUT / 'sources.json').write_text(json.dumps(manifest, indent=2)+'\n')
    module = ROOT / 'src/road_surfaces.js'
    if module.exists():
        text = module.read_text()
        text = re.sub(r'/\* RUNE_ROWS_START \*/[\s\S]*?/\* RUNE_ROWS_END \*/', '/* RUNE_ROWS_START */\n  const RUNE_ROWS = '+json.dumps(rows, separators=(',', ':'))+';\n  /* RUNE_ROWS_END */', text)
        module.write_text(text)
    print(f'Built {OUT.relative_to(ROOT)}/surfaces.png and native rune mask')

if __name__ == '__main__': main()
