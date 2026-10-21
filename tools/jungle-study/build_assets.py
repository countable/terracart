#!/usr/bin/env python3
"""Extract reproducible source crops for the opt-in jungle renderer study."""
from pathlib import Path
import argparse
import json
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--out', type=Path, default=Path('/tmp/ra-jungle'))
args = parser.parse_args()
manifest = json.loads((HERE / 'assets.json').read_text())
out = args.out / 'crops'
out.mkdir(parents=True, exist_ok=True)
for item in manifest:
    x, y, w, h = item['rect']
    source = Image.open(ROOT / item['source']).convert('RGBA')
    if x < 0 or y < 0 or x + w > source.width or y + h > source.height:
        raise ValueError(f'Invalid crop: {item["id"]}')
    source.crop((x, y, x + w, y + h)).save(out / (item['id'] + '.png'))
print(f'Extracted {len(manifest)} source crops to {out}')
