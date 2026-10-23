#!/usr/bin/env python3
"""Crop native Rogue Adventure tiles for the isolated temple/fort study."""
import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'extra_assets/16x16/Rogue Adventure World/Rogue Adventure World [Sprites]/Tilesets'
RECIPES = [
    ('temple-closed-door', 'RA_Temple.png', (672, 152, 16, 24), False, 'Native shut double door with framed sacred panel; no open doorway pixels.'),
    ('temple-pale', 'RA_Sanctuary.png', (0, 0, 16, 16), False, 'Framed pale slab for floor and coping.'),
    ('temple-dark', 'RA_Sanctuary.png', (256, 0, 16, 16), False, 'Native matching dark slab.'),
    ('temple-wall', 'RA_Sanctuary.png', (2, 2, 12, 12), False, 'Quiet pale stone face, native pixels with frame removed.'),
    ('temple-dark-wall', 'RA_Sanctuary.png', (258, 2, 12, 12), False, 'Quiet dark face, native pixels with frame removed.'),
    ('temple-warm-floor', 'RA_Temple.png', (144, 0, 16, 16), False, 'Warm intact temple paving already selected in world-art candidates.'),
    ('temple-worn-floor', 'RA_Temple.png', (16, 0, 16, 16), False, 'Matching rose weathered paving.'),
    ('temple-warm-wall', 'RA_Temple.png', (656, 48, 16, 16), False, 'Native warm brick face from the stair enclosure.'),
    ('temple-roof', 'RA_Temple.png', (736, 0, 16, 16), False, 'Native pale-gold banded tile for pitched stone roofs.'),
    ('temple-rose-roof', 'RA_Temple.png', (480, 0, 16, 16), False, 'Native rose counterpart of the banded roof tile.'),
    ('column-shaft', 'RA_Temple.png', (212, 64, 8, 16), False, 'Opaque interior of warm column shaft; repeat vertically on geometry.'),
    ('column-top', 'RA_Temple.png', (212, 36, 8, 8), False, 'Opaque interior of matching capital top.'),
    ('column-base', 'RA_Temple.png', (210, 100, 12, 8), True, 'Capital/base band; transparent corners filled from dominant source pigment.'),
    ('timber', 'RA_Village.png', (96, 224, 16, 16), True, 'Native vertical timber; transparent gaps filled from dominant source pigment.'),
    ('stone', 'RA_Crypt.png', (160, 0, 16, 16), False, 'Intact warm masonry courses.'),
    ('stone-top', 'RA_Crypt.png', (112, 0, 16, 16), False, 'Quiet warm stone for coping.'),
    ('paving', 'RA_Ruins.png', (64, 64, 32, 32), False, 'Opaque native weathered interior paving, avoiding the transparent perimeter.'),
    ('paving-edge', 'RA_Ruins.png', (32, 32, 32, 32), False, 'Original architecture-study paving crop; includes mossy perimeter and transparency, for edge decals only.'),
    ('grass', 'RA_Ground_Tiles.png', (80, 64, 16, 16), True, 'RA village grass interior; native source colours.'),
]


def build(out):
    materials = out / 'materials'
    materials.mkdir(parents=True, exist_ok=True)
    manifest = []
    width, cellw, cellh = 1000, 200, 210
    board = Image.new('RGB', (width, ((len(RECIPES) + 4) // 5) * cellh), '#242c2c')
    draw = ImageDraw.Draw(board)
    for i, (name, sheet, rect, fill_gaps, note) in enumerate(RECIPES):
        path = SOURCE / sheet
        source = Image.open(path).convert('RGBA')
        x, y, w, h = rect
        crop = source.crop((x, y, x + w, y + h))
        if fill_gaps and crop.getextrema()[3] != (255, 255):
            opaque = [(count, rgba) for count, rgba in crop.getcolors(w * h) if rgba[3] == 255]
            background = Image.new('RGBA', crop.size, max(opaque)[1])
            background.alpha_composite(crop)
            crop = background
        crop.save(materials / (name + '.png'))
        manifest.append(dict(id=name, source=str(path.relative_to(ROOT)),
            source_sha256=hashlib.sha256(path.read_bytes()).hexdigest(), rect=list(rect),
            output_size=list(crop.size), native_pixel_scale=1,
            alpha_range=list(crop.getchannel('A').getextrema()), processing=note))
        bx, by = i % 5 * cellw, i // 5 * cellh
        draw.text((bx + 8, by + 8), name, fill='white')
        draw.text((bx + 8, by + 25), f'{w} x {h} source pixels', fill='#b6c7bf')
        tile = crop.resize((w * 2, h * 2), Image.Resampling.NEAREST)
        for yy in range(0, 150, tile.height):
            for xx in range(0, 180, tile.width):
                part = tile.crop((0, 0, min(tile.width, 180 - xx), min(tile.height, 150 - yy)))
                board.paste(part, (bx + 8 + xx, by + 48 + yy), part)
    board.save(out / 'materials-board.png')
    (out / 'materials.json').write_text(json.dumps(dict(
        credit='Rogue Adventure World by ElvGames',
        purpose='Local temple and fort geometry study; no runtime replacement',
        license='extra_assets/16x16/Rogue Adventure World/License.txt',
        restrictions='Game use and modifications allowed with ElvGames credit. No training/generative AI, crypto/NFT, resale of packs, or claiming ownership.',
        texel_density='All PNGs preserve native source pixels. UV distance should use one shared world-units-per-source-pixel scale; do not stretch every crop to a fixed mesh size.',
        regenerate='python3 tools/temple-fort-study/build_materials.py --out ' + str(out),
        materials=manifest), indent=2) + '\n')
    print(f'Exported {len(manifest)} native material crops to {out}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, default=Path('/tmp/temple-fort-materials'))
    build(parser.parse_args().out)
