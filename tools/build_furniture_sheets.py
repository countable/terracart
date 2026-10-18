#!/usr/bin/env python3
"""Rebuild furniture frames from licensed input crops and checked-in concepts.

Run from any directory with Python 3 and Pillow. The themed sheets remain
read-only art inputs under extra_assets; only the selected crops ship.
"""
import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / 'assets/Objects/Furniture'


def build():
    manifest = json.loads((DEST / 'manifest.json').read_text())
    cols, cell, icon_cell = (manifest[key] for key in ('columns', 'worldCell', 'iconCell'))
    rows = (len(manifest['items']) + cols - 1) // cols
    world = Image.new('RGBA', (cols * cell, rows * cell))
    icons = Image.new('RGBA', (cols * icon_cell, rows * icon_cell))
    for entry in manifest['items']:
        source = Image.open(ROOT / entry['source']).convert('RGBA')
        if entry['mode'] == 'concept':
            bounds = source.getchannel('A').getbbox()
            if bounds is None:
                raise ValueError(f"Empty concept: {entry['itemId']}")
            art = source.crop(bounds)
            factor = (cell - 2) / max(art.size)
        else:
            x, y, w, h = entry['box']
            art = source.crop((x, y, x + w, y + h))
            factor = cell / 48
        size = tuple(max(1, round(side * factor)) for side in art.size)
        art = art.resize(size, Image.Resampling.LANCZOS)
        frame = Image.new('RGBA', (cell, cell))
        frame.alpha_composite(art, ((cell - art.width) // 2, cell - art.height))
        col, row = entry['frame'] % cols, entry['frame'] // cols
        world.alpha_composite(frame, (col * cell, row * cell))
        icons.alpha_composite(frame.resize((icon_cell, icon_cell), Image.Resampling.LANCZOS),
                              (col * icon_cell, row * icon_cell))
    world.save(DEST / 'furniture-32.png')
    icons.save(DEST / 'furniture-icons-16.png')
    print(f"Built {len(manifest['items'])} furniture frames: {world.size}, icons {icons.size}")


if __name__ == '__main__':
    build()
