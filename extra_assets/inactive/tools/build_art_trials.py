#!/usr/bin/env python3
"""Export the owner's tree/water trial crops, preserving native pixel sizes."""
import json
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
IDS = ['ALT-0168', 'ALT-0038', 'ALT-0176', 'ALT-0245', 'ALT-0131']

def main():
    registry = {row['id']: row for row in json.loads((ROOT / 'tools/art-alternative-ids.json').read_text())['entries']}
    destination = ROOT / 'assets/ArtTrials'
    destination.mkdir(exist_ok=True)
    rows = []
    for alternative in IDS:
        row = registry[alternative]
        x, y, width, height = row['crop']
        with Image.open(ROOT / row['source']) as source:
            if x < 0 or y < 0 or x + width > source.width or y + height > source.height:
                raise ValueError(f'{alternative}: crop outside source')
            crop = source.convert('RGBA').crop((x, y, x + width, y + height))
        bounds = crop.getchannel('A').getbbox()
        if not bounds:
            raise ValueError(f'{alternative}: empty crop')
        crop.save(destination / f'{alternative}.png')
        rows.append({**row, 'path': f'assets/ArtTrials/{alternative}.png', 'bounds': list(bounds)})
    (destination / 'manifest.json').write_text(json.dumps({'schemaVersion': 1, 'note': 'Opt-in runtime trials only; unchanged native-resolution registry crops.', 'entries': rows}, indent=2) + '\n')

if __name__ == '__main__':
    main()
