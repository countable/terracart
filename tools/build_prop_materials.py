"""Extract opaque, padded mesh materials from the approved prop sprites.

No palette synthesis: transparent silhouette pixels extend the nearest authored
opaque texel. Native pixel clusters remain intact; runtime never reads pixels.
"""
from pathlib import Path
import hashlib
import json
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/Objects/LowPolyProps'
SIZE, STRIDE, PAD, COLS = 256, 20, 2, 8
SOURCES = {'crate': 'assets/Objects/SelectedProps/box.png',
           'rock': 'assets/Objects/Rocks/rocks-16.png'}

def opaque_crop(image, box, stone=False):
    crop = image.crop(box)
    pixels = crop.load()
    def material_pixel(x, y):
        r, g, b, a = pixels[x, y]
        if a != 255: return False
        if not stone: return True
        # A sprite's dark silhouette is not a stone surface: wrapping it onto
        # multiple facets would draw black rings through the boulder. Retain
        # authored interior texels and extend those into silhouette-only areas.
        return (r + g + b) / 3 >= 65 and all(
            0 <= xx < crop.width and 0 <= yy < crop.height and pixels[xx, yy][3] == 255
            for xx, yy in [(x-1,y), (x+1,y), (x,y-1), (x,y+1)])
    opaque = [(x, y) for y in range(crop.height) for x in range(crop.width) if material_pixel(x, y)]
    original = crop.copy()
    if not opaque:
        raise ValueError(f'Empty source crop: {box}')
    for y in range(crop.height):
        for x in range(crop.width):
            if (x, y) not in opaque:
                xx, yy = min(opaque, key=lambda p: ((p[0]-x)**2 + (p[1]-y)**2, p[1], p[0]))
                pixels[x, y] = original.getpixel((xx, yy))
    return crop.resize((16, 16), Image.Resampling.NEAREST)

def build():
    atlas = Image.new('RGBA', (SIZE, SIZE), (255, 255, 255, 255))
    entries = []
    for kind, rel in SOURCES.items():
        source = Image.open(ROOT / rel).convert('RGBA')
        for frame in range(4 if kind == 'crate' else 65):
            x, y = frame % (source.width // 16) * 16, frame // (source.width // 16) * 16
            for surface in (['side', 'lid'] if kind == 'crate' else ['stone']):
                # Crate surface excludes the transparent border and the lower
                # side on its lid. Stone uses its original full 16px pixel grid.
                crop = (x+1, y+1, x+14, y+(11 if surface == 'lid' else 15)) if kind == 'crate' else (x, y, x+16, y+16)
                tile = opaque_crop(source, crop, kind == 'rock')
                slot = len(entries); ox, oy = slot % COLS * STRIDE, slot // COLS * STRIDE
                for py in range(STRIDE):
                    for px in range(STRIDE):
                        atlas.putpixel((ox+px, oy+py), tile.getpixel((min(15,max(0,px-PAD)), min(15,max(0,py-PAD)))))
                entries.append({'slot': slot, 'kind': kind, 'frame': frame, 'surface': surface, 'source': rel, 'crop': crop})
    OUT.mkdir(parents=True, exist_ok=True)
    atlas.save(OUT / 'materials.png')
    (OUT / 'manifest.json').write_text(json.dumps({'size': SIZE, 'stride': STRIDE, 'padding': PAD, 'columns': COLS,
        'sources': {k: {'path': v, 'sha256': hashlib.sha256((ROOT/v).read_bytes()).hexdigest()} for k,v in SOURCES.items()},
        'entries': entries}, indent=2)+'\n')
    print(f'{len(entries)} source-textured materials -> {OUT.relative_to(ROOT)}')

if __name__ == '__main__':
    build()
