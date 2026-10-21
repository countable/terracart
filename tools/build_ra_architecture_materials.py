#!/usr/bin/env python3
"""Extract local RA study materials; never install them into runtime assets."""
import argparse
import hashlib
import json
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'extra_assets/16x16/Rogue Adventure World/Rogue Adventure World [Sprites]/Tilesets'
RECIPES = [
    ('timber', 'RA_Village.png', [96, 224, 16, 16], 'Native vertical timber; transparent plank gaps filled with dominant opaque source pigment.'),
    ('stone', 'RA_Crypt.png', [160, 0, 16, 16], 'Two intact masonry courses; excludes the missing-stone cells from the initial study crop.'),
    ('stone-top', 'RA_Crypt.png', [112, 0, 16, 16], 'Quiet warm stone, used on narrow coping.'),
    ('temple', 'RA_Sanctuary.png', [0, 0, 16, 16], 'Native pale framed stone; cap/floor repeat candidate.'),
    ('temple-dark', 'RA_Sanctuary.png', [256, 0, 16, 16], 'Matching dark source stone.'),
    ('temple-side', 'RA_Sanctuary.png', [2, 2, 12, 12], 'Border removed from pale slab; nearest expansion to 16px for quiet faces.'),
    ('temple-dark-side', 'RA_Sanctuary.png', [258, 2, 12, 12], 'Border removed from matching dark slab.'),
    ('floor-stone', 'RA_Ruins.png', [32, 32, 32, 32], 'Native weathered paving repeat.'),
]

def build(out):
    materials = out / 'materials'
    materials.mkdir(parents=True, exist_ok=True)
    manifest = []
    board = Image.new('RGB', (960, 230 * 2), '#222b29')
    draw = ImageDraw.Draw(board)
    for i, (name, sheet, rect, note) in enumerate(RECIPES):
        path = SOURCE / sheet
        source = Image.open(path).convert('RGBA')
        x, y, w, h = rect
        crop = source.crop((x, y, x + w, y + h))
        size = 32 if name == 'floor-stone' else 16
        crop = crop.resize((size, size), Image.Resampling.NEAREST)
        if crop.getextrema()[3] != (255, 255):
            opaque = [(count, rgba) for count, rgba in crop.getcolors(size * size) if rgba[3] == 255]
            pigment = max(opaque)[1]
            background = Image.new('RGBA', crop.size, pigment)
            background.alpha_composite(crop)
            crop = background
        crop.save(materials / (name + '.png'))
        manifest.append(dict(id=name, source=str(path.relative_to(ROOT)), source_sha256=hashlib.sha256(path.read_bytes()).hexdigest(), rect=rect, output_size=[size, size], processing=note))
        bx, by = i % 4 * 240, i // 4 * 230
        draw.text((bx + 8, by + 8), name, fill='white')
        tile = crop.resize((32, 32), Image.Resampling.NEAREST)
        for yy in range(4):
            for xx in range(4):
                if xx * tile.width < 220 and yy * tile.height < 192:
                    board.paste(tile, (bx + 8 + xx * tile.width, by + 30 + yy * tile.height))
    board.save(out / 'material-repeat-board.png')
    viewer = (ROOT / 'tools/ra-architecture-preview.html').read_text()
    viewer = viewer.replace('src="game-loader.js"', 'src="/tools/game-loader.js"')
    viewer = viewer.replace('src="ra-architecture-preview.js"', 'src="preview.js"')
    (out / 'index.html').write_text(viewer)
    (out / 'preview.js').write_text((ROOT / 'tools/ra-architecture-preview.js').read_text())
    (out / 'materials.json').write_text(json.dumps(dict(credit='Rogue Adventure World by ElvGames', purpose='Local geometry experiment; not approved runtime materials', materials=manifest), indent=2) + '\n')

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, default=Path('/tmp/ra-architecture-geometry'))
    build(parser.parse_args().out)
