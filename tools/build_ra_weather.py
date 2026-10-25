#!/usr/bin/env python3
"""Export Rogue Adventure water-drop frames for the live weather overlay."""
from pathlib import Path
import hashlib
import json
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path('extra_assets/16x16/Rogue Adventure World/Rogue Adventure World [Sprites]/Tilesets/RA_Atlantis_Animated01.png')
OUT = ROOT / 'assets/ArtTrials/RogueObjects'
RECT = (160, 16, 64, 16)  # Native frames 30-33: turquoise water-drop phases.


def build():
    source = Image.open(ROOT / SOURCE).convert('RGBA')
    crop = source.crop((RECT[0], RECT[1], RECT[0] + RECT[2], RECT[1] + RECT[3]))
    # Each source phase is a small water splash. Keep its right falling stroke
    # and clear the splash bulb, so native pixels read as diagonal rain.
    pixels = crop.load()
    for frame in range(4):
        for y in range(16):
            for x in range(16):
                if not (7 <= x <= 11 and 5 <= y <= 8):
                    pixels[frame * 16 + x, y] = (0, 0, 0, 0)
    bounds = crop.getbbox()
    assert bounds, 'rain crop is blank'
    OUT.mkdir(parents=True, exist_ok=True)
    crop.save(OUT / 'rain.png')
    manifest_path = OUT / 'manifest.json'
    rows = json.loads(manifest_path.read_text())
    row = {
        'id': 'rain', 'source': str(SOURCE), 'rect': list(RECT),
        'note': 'Right falling strokes from four native turquoise water-splash phases; the splash bulbs are cleared for diagonal rain.',
        'sourceSHA256': hashlib.sha256((ROOT / SOURCE).read_bytes()).hexdigest(),
        'bounds': {'fw': RECT[2], 'fh': RECT[3], 'minX': bounds[0], 'minY': bounds[1],
                   'maxX': bounds[2], 'maxY': bounds[3]},
        'frameWidth': 16, 'frameHeight': 16, 'sourceFrames': [30, 31, 32, 33],
        'keepWithinFrame': [7, 5, 11, 8],
    }
    rows = [existing for existing in rows if existing.get('id') != 'rain'] + [row]
    manifest_path.write_text(json.dumps(rows, indent=2) + '\n')
    print('Exported 4 Rogue Adventure weather frames')


if __name__ == '__main__':
    build()
