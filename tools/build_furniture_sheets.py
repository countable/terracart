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
    cols, cell, height, icon_cell = (manifest[key] for key in
                                    ('columns', 'worldCell', 'worldFrameHeight', 'iconCell'))
    rows = (len(manifest['items']) + cols - 1) // cols
    world = Image.new('RGBA', (cols * cell, rows * height))
    icons = Image.new('RGBA', (cols * icon_cell, rows * icon_cell))
    for entry in manifest['items']:
        source = Image.open(ROOT / entry['source']).convert('RGBA')
        if entry['mode'] == 'concept':
            bounds = source.getchannel('A').getbbox()
            if bounds is None:
                raise ValueError(f"Empty concept: {entry['itemId']}")
            art = source.crop(bounds)
            fit_w, fit_h = entry.get('fit', [cell - 2, cell - 2])
            factor = min(fit_w / art.width, fit_h / art.height)
        else:
            x, y, w, h = entry['box']
            art = source.crop((x, y, x + w, y + h))
            factor = cell / 48
        size = tuple(max(1, round(side * factor)) for side in art.size)
        art = art.resize(size, Image.Resampling.LANCZOS)
        if art.width > cell or art.height > height:
            raise ValueError(f"Art exceeds world frame: {entry['itemId']}")
        frame = Image.new('RGBA', (cell, height))
        frame.alpha_composite(art, ((cell - art.width) // 2, height - art.height))
        col, row = entry['frame'] % cols, entry['frame'] // cols
        world.alpha_composite(frame, (col * cell, row * height))
        # Fit the whole piece, excluding the shared frame's empty upper half.
        # Uprights keep their proportions instead of losing their tops or feet.
        icon_factor = min(icon_cell / art.width, icon_cell / art.height)
        icon_size = tuple(max(1, round(side * icon_factor)) for side in art.size)
        icon = art.resize(icon_size, Image.Resampling.LANCZOS)
        icons.alpha_composite(icon, (col * icon_cell + (icon_cell - icon.width) // 2,
                                     row * icon_cell + (icon_cell - icon.height) // 2))
    world.save(DEST / 'furniture-32.png')
    icons.save(DEST / 'furniture-icons-16.png')
    print(f"Built {len(manifest['items'])} furniture frames: {world.size}, icons {icons.size}")


if __name__ == '__main__':
    build()
