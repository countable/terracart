#!/usr/bin/env python3
"""Bake rounded copies of the terrain transition masks.

The atlas holds one native row per ground family; this appends one rounded row
per family beneath them. TerrainTransitions draws the rounded row wherever a
grass family meets a non-grass one, so selection stays a frame offset with no
runtime geometry. Each rounded frame reuses its family's opaque centre and
re-derives the native edge ink, so no source pack is needed. Run alone to
refresh the rounded rows of the committed atlas in place.
"""
from pathlib import Path
import json
import subprocess
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/ArtTrials/RogueTerrain'

def registry():
    script = "const fs=require('fs');const registry=new Function(fs.readFileSync('src/ground_materials.js','utf8')+';return GroundMaterials;')();process.stdout.write(JSON.stringify(registry));"
    return json.loads(subprocess.check_output(['node', '-e', script], cwd=ROOT))

def inside(mask, x, y, radius):
    """Dual-grid quadrant fill with convex corners rounded and concave ones filleted."""
    px, py = x + .5, y + .5
    cx, cy = int(px > 8), int(py > 8)
    bit = lambda i: (mask >> i) & 1
    own, beside, above = bit(cy*2 + cx), bit(cy*2 + 1 - cx), bit((1 - cy)*2 + cx)
    u, v = abs(px - 8), abs(py - 8)
    # A stable one-pixel wobble keeps arcs as ragged as the hand-drawn edges;
    # keyed to the mirrored offsets so islands stay centred on their cells.
    iu, iv = int(u), int(v)
    jitter = ((iu*7 + iv*13 + iu*iv*3) % 5 - 2) / 2
    near = u < radius and v < radius
    arc = (u - radius)**2 + (v - radius)**2
    if own:
        return beside or above or not near or arc <= (radius + jitter)**2
    return bool(beside and above and near and arc > (radius - jitter)**2)

def edge_ink(atlas, row):
    """Native rim colour by distance from the edge, where the source draws one."""
    counts = {}
    for mask in range(1, 15):
        alpha = lambda x, y: atlas.getpixel((mask*16 + x, row*16 + y))[3] if 0 <= x < 16 and 0 <= y < 16 else 255
        for y in range(16):
            for x in range(16):
                pixel = atlas.getpixel((mask*16 + x, row*16 + y))
                if not pixel[3]:
                    continue
                d = min([max(abs(dx), abs(dy)) for dx in range(-2, 3) for dy in range(-2, 3)
                         if alpha(x + dx, y + dy) == 0] or [9])
                if d > 2:
                    continue
                key = None if pixel == atlas.getpixel((15*16 + x, row*16 + y)) else pixel
                counts.setdefault(d, {}).setdefault(key, 0)
                counts[d][key] += 1
    ink = {}
    for d, colours in counts.items():
        inked = {k: n for k, n in colours.items() if k}
        if inked and sum(inked.values()) * 5 >= sum(colours.values()) * 2:
            ink[d] = max(inked.items(), key=lambda kv: kv[1])[0]
    return ink

def add_rounded_rows(native, families, radius):
    count = len(families)
    atlas = Image.new('RGBA', (256, count*32))
    atlas.paste(native.crop((0, 0, 256, count*16)), (0, 0))
    for row, family in enumerate(families):
        top = (count + row) * 16
        if family.get('calmWater'):
            # Water banks are authored rock rims; keep them exactly.
            atlas.paste(native.crop((0, row*16, 256, row*16 + 16)), (0, top))
            continue
        ink = edge_ink(native, row)
        for mask in range(16):
            fill = [[inside(mask, x, y, radius) for x in range(16)] for y in range(16)]
            for y in range(16):
                for x in range(16):
                    if not fill[y][x]:
                        continue
                    d = min([max(abs(dx), abs(dy)) for dx in range(-2, 3) for dy in range(-2, 3)
                             if 0 <= x + dx < 16 and 0 <= y + dy < 16 and not fill[y + dy][x + dx]] or [9])
                    colour = ink.get(d) or native.getpixel((15*16 + x, row*16 + y))
                    atlas.putpixel((mask*16 + x, top + y), colour)
    return atlas

if __name__ == '__main__':
    reg = registry()
    radius = reg['atlas']['roundedRadius']
    native = Image.open(OUT/'tiles.png').convert('RGBA')
    add_rounded_rows(native, reg['families'], radius).save(OUT/'tiles.png')
    manifest_path = OUT/'manifest.json'
    manifest = json.loads(manifest_path.read_text())
    manifest['roundedRadius'] = radius
    manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
    print(f'Rounded {len(reg["families"])} families at radius {radius}')
