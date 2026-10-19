#!/usr/bin/env python3
"""Pack the original db32 item icons without resizing or changing pixels."""
import hashlib
import json
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
PACK = ROOT / 'extra_assets/db32_rpg_items'
ATLAS = PACK / 'db32-items-atlas.png'
MAP = PACK / 'db32-items-atlas.json'
CELL = 16
COLUMNS = 16


def main():
    sources = sorted(p for p in PACK.glob('*.png') if p != ATLAS)
    if not sources:
        raise ValueError('No source icons found')
    atlas = Image.new('RGBA', (COLUMNS * CELL, ((len(sources) + COLUMNS - 1) // COLUMNS) * CELL))
    entries = []
    for i, path in enumerate(sources):
        with Image.open(path) as original:
            icon = original.convert('RGBA')
        if icon.size != (CELL, CELL):
            raise ValueError(f'Expected16×16: {path}')
        x, y = (i % COLUMNS) * CELL, (i // COLUMNS) * CELL
        atlas.paste(icon, (x, y))
        entries.append({'source': path.name, 'rect': [x, y, CELL, CELL],
                        'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
    atlas.save(ATLAS)
    with Image.open(ATLAS) as packed:
        for entry in entries:
            x, y, w, h = entry['rect']
            with Image.open(PACK / entry['source']) as original:
                assert packed.crop((x, y, x + w, y + h)).tobytes() == original.convert('RGBA').tobytes()
    MAP.write_text(json.dumps({'atlas': ATLAS.name, 'cellSize': CELL, 'columns': COLUMNS,
                               'width': atlas.width, 'height': atlas.height, 'items': entries}, indent=2) + '\n')
    print(f'{len(entries)} icons → {atlas.width}×{atlas.height}; every cell pixel-verified')


if __name__ == '__main__':
    main()
