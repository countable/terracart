#!/usr/bin/env python3
"""Palette-map the installed RA rounded crowns, retaining every pixel and alpha."""
from pathlib import Path
import hashlib
import json
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/ArtTrials/RogueObjects'
# Muted fruit-species foliage, then a blossom palette for the existing lifecycle.
# Only olive leaf colours change; bark, roots, silhouette and alpha stay intact.
ROWS = {
    'apple': ('tree-rounded-2.png', [(45, 53, 31), (92, 111, 51), (146, 163, 67), (198, 201, 104)], [(78, 77, 54), (144, 143, 102), (207, 203, 164), (243, 235, 205)]),
    'worldpeach': ('tree-rounded-3.png', [(49, 54, 34), (107, 119, 58), (162, 172, 80), (209, 206, 118)], [(76, 57, 60), (143, 91, 105), (203, 135, 147), (241, 185, 185)]),
}

def leaf(rgb):
    r, g, b = rgb
    return min(r, g) > b * 1.18 and abs(r-g) < max(r,g) * .20 and g > 55

def recolor(rgb, ramp):
    value = (.2126*rgb[0] + .7152*rgb[1] + .0722*rgb[2]) / 220 * 3
    i = min(2, int(value)); t = min(1, max(0, value-i))
    return tuple(round(a+(b-a)*t) for a,b in zip(ramp[i],ramp[i+1]))

manifest = {}
for species, (filename, green, blossom) in ROWS.items():
    source = OUT / filename
    image = Image.open(source).convert('RGBA')
    # Same widest-row / half-width crown boundary as tools/sprite_audit.js.
    spans = []
    for y in range(image.height):
        xs = [x for x in range(image.width) if image.getpixel((x,y))[3] >= 16]
        if xs: spans.append((y, max(xs)-min(xs)+1))
    widest = max(width for y,width in spans)
    widest_y = next(y for y,width in spans if width == widest)
    crown_bottom = next(y for y,width in spans if y > widest_y and width < widest/2)
    for state, ramp in [('green', green), ('blossom', blossom)]:
        result = image.copy()
        result.putdata([recolor(p[:3], ramp)+(p[3],) if p[3] and i // image.width < crown_bottom and leaf(p[:3]) else p for i,p in enumerate(image.getdata())])
        assert result.getchannel('A').tobytes() == image.getchannel('A').tobytes()
        assert result.crop((0,crown_bottom,image.width,image.height)).tobytes() == image.crop((0,crown_bottom,image.width,image.height)).tobytes()
        name = f'fruit-{species}' + ('-blossom' if state == 'blossom' else '') + '.png'
        result.save(OUT / name)
        manifest[name] = {'source': str(source.relative_to(ROOT)), 'sourceSHA256': hashlib.sha256(source.read_bytes()).hexdigest(), 'palette': ramp, 'method': 'Olive foliage palette remap only; source pixels, alpha, bark and roots unchanged.'}
(OUT / 'fruit-trees.json').write_text(json.dumps(manifest, indent=2)+'\n')
print('Exported four RA fruit-tree canopies; original geometry and alpha retained.')
