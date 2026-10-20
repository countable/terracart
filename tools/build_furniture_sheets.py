#!/usr/bin/env python3
"""Rebuild furniture world and icon sheets from checked-in art and source crops.

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
    cols, cell, icon_cell = (manifest[key] for key in
                             ('columns', 'worldCell', 'iconCell'))
    entries = list(manifest['items'])
    tiers = manifest['tierSheet']
    for row, kind in enumerate(tiers['rows']):
        for col, tier in enumerate(tiers['tiers']):
            entry = {'itemId': f'{kind}:{tier}',
                            'frame': tiers['firstFrame'] + row * tiers['columns'] + col,
                            'source': tiers['source'], 'box': [col * cell, row * cell, cell, cell],
                            'mode': 'native32', 'frameSize': [cell, cell]}
            # Stock replacements apply to every quality tier, including saved items.
            entry.update(tiers.get('rowSources', {}).get(kind, {}))
            entries.append(entry)
    # The roster's legacy source boxes identify the same tier cells as the
    # expanded catalog. Apply approved art to both without changing frame ids.
    for entry in entries:
        key = entry['itemId']
        if entry['source'] == tiers['source']:
            x, y, _, _ = entry['box']
            key = f"{tiers['rows'][y // cell]}:{tiers['tiers'][x // cell]}"
        source = manifest.get('approvedOverrides', {}).get(key)
        if source:
            entry.update(source=source, box=None, mode='native24',
                         frameSize=[cell, manifest['worldFrameHeight']])
    # Retain 64px world slots so light anchors and saved frame consumers stay aligned.
    height = manifest['worldFrameHeight']
    rows = (max(entry['frame'] for entry in entries) + cols) // cols
    world = Image.new('RGBA', (cols * cell, rows * height))
    icons = Image.new('RGBA', (cols * icon_cell, rows * icon_cell))
    for entry in entries:
        source = Image.open(ROOT / entry['source']).convert('RGBA')
        frame_w, frame_h = entry['frameSize']
        art = source
        if entry['box']:
            x, y, w, h = entry['box']
            art = source.crop((x, y, x + w, y + h))
        if entry['mode'] == 'native32':
            factor = 1
        elif entry['mode'] == 'native24':
            factor = cell / manifest['nativeCell']
        elif entry['mode'] == 'concept' or 'fit' in entry:
            bounds = art.getchannel('A').getbbox()
            if bounds is None:
                raise ValueError(f"Empty furniture source: {entry['itemId']}")
            art = art.crop(bounds)
            fit_w, fit_h = entry.get('fit', [frame_w - 2, frame_h - 2])
            factor = min(fit_w / art.width, fit_h / art.height)
        else:
            factor = cell / 48
        size = tuple(max(1, round(side * factor)) for side in art.size)
        resample = Image.Resampling.NEAREST if entry['mode'].startswith('native') else Image.Resampling.LANCZOS
        art = art.resize(size, resample)
        if frame_w > cell or art.width > frame_w or art.height > frame_h:
            raise ValueError(f"Art exceeds world frame: {entry['itemId']}")
        frame = Image.new('RGBA', (frame_w, frame_h))
        frame.alpha_composite(art, ((frame_w - art.width) // 2, frame_h - art.height))
        col, row = entry['frame'] % cols, entry['frame'] // cols
        world.alpha_composite(frame, (col * cell + (cell - frame_w) // 2,
                                      row * height + height - frame_h))
        # Fit the whole piece, excluding the shared frame's empty upper half.
        # Uprights keep their proportions instead of losing their tops or feet.
        icon_factor = min(icon_cell / art.width, icon_cell / art.height)
        icon_size = tuple(max(1, round(side * icon_factor)) for side in art.size)
        icon = art.resize(icon_size, resample)
        icons.alpha_composite(icon, (col * icon_cell + (icon_cell - icon.width) // 2,
                                     row * icon_cell + (icon_cell - icon.height) // 2))
    world.save(DEST / 'furniture-32.png')
    icons.save(DEST / 'furniture-icons-16.png')
    print(f"Built {len(entries)} furniture frames: {world.size}, icons {icons.size}")


if __name__ == '__main__':
    build()
