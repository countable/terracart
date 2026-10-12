#!/usr/bin/env python3
"""Export the approved October 12 idols and mossy grave from retained masters.

Run after legacy shrine/zone packers. Preserve runtime frame IDs and dimensions;
use the review's three-pixel inset for each idol and the shared hard-alpha,
nearest-neighbour importer. The old geometric paired grave is untouched.
"""
import json
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools'))
from import_world_art_candidates import apply_imports, digest, IMPORTS

SOURCE = ROOT / 'assets/Objects/Approved/Sources/ArtRedo20261012'
REVIEW = 'ART-2026-10-12-APPROVED'


def main():
    master = SOURCE / 'idols.png'
    sheet = Image.open(master).convert('RGBA')
    entries = []
    for frame in range(10):
        x, y = frame % 5, frame // 5
        left, top = round(x * sheet.width / 5) + 3, round(y * sheet.height / 2) + 3
        rect = [left, top, left + round(sheet.width / 5) - 6, top + round(sheet.height / 2) - 6]
        crop = SOURCE / f'idol-{frame}.png'
        sheet.crop(rect).save(crop)
        entries.append({
            'reviewId': REVIEW, 'sheet': 'assets/Objects/Generated/shrines.png',
            'frame': frame, 'frameSize': [16, 24],
            'source': str(crop.relative_to(ROOT)), 'sourceSha256': digest(crop),
            'generatedSheet': str(master.relative_to(ROOT)),
            'generatedSheetSha256': digest(master), 'generatedRect': rect,
        })
    grave = SOURCE / 'mossy_grave.png'
    for target, frame, size in [
        ('assets/Objects/ZoneVariants/objects-24.png', 1, 24),
        ('assets/Objects/ZoneVariants/approved-24.png', 1, 24),
        ('assets/Objects/ZoneVariants/mossy_grave_pillar.png', 0, 24),
        ('assets/Objects/ZoneVariants/objects-16.png', 1, 16),
    ]:
        entries.append({
            'reviewId': REVIEW, 'sheet': target, 'frame': frame,
            'frameSize': [size, size], 'source': str(grave.relative_to(ROOT)),
            'sourceSha256': digest(grave),
        })
    spec = json.loads(IMPORTS.read_text())
    replaced = {(e['sheet'], e['frame']) for e in entries}
    spec['frames'] = [e for e in spec['frames'] if (e['sheet'], e['frame']) not in replaced] + entries
    approval = 'User approved mossy grave and all ten grid-aligned idols on 2026-10-12; retain old paired geometric grave.'
    if approval not in spec['approval']:
        spec['approval'] += ' ' + approval
    IMPORTS.write_text(json.dumps(spec, indent=2) + '\n')
    print(json.dumps(apply_imports(review_ids=[REVIEW]), indent=2))


if __name__ == '__main__':
    main()
