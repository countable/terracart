#!/usr/bin/env python3
"""Validate batch reviews and export native crops for both comparison dashboards.

Review JSON is an input artifact, never an instruction to replace game artwork.
Each sheet must record the catalogue keys actually checked in every 64-target batch.
"""
import argparse
import hashlib
import json
import re
from collections import Counter
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]


def build(review_dir, output):
    targets = json.loads((review_dir / 'catalogue.json').read_text())
    catalogue = {target['key']: target for target in targets}
    expected_batches = {
        index + 1: [target['key'] for target in targets[start:start + 64]]
        for index, start in enumerate(range(0, len(targets), 64))
    }
    sheets = {
        sheet['id']: sheet
        for path in review_dir.glob('*-sheets.json')
        for sheet in json.loads(path.read_text())
    }
    exclusions_path = review_dir / 'rejected-candidates.json'
    exclusions = set(json.loads(exclusions_path.read_text())) if exclusions_path.exists() else set()
    entries = {}
    pixel_targets = set()
    coverage = []
    output.mkdir(parents=True, exist_ok=True)
    for path in sorted((review_dir / 'results').glob('*/*.json')):
        review = json.loads(path.read_text())
        if 'sheetId' not in review:
            continue
        sheet = sheets[review['sheetId']]
        source = ROOT / sheet['source']
        digest = hashlib.sha256(source.read_bytes()).hexdigest()
        if digest != sheet['sha256'] or review['sourceSHA256'] != digest:
            raise ValueError(f'Source changed: {source}')
        if review['source'] != sheet['source']:
            raise ValueError(f'Source mismatch: {path}')
        image = Image.open(source).convert('RGBA')
        batches = review.get('batches', [])
        if not review.get('exclusionReason'):
            if Counter(batch['batch'] for batch in batches) != Counter(expected_batches.keys()):
                raise ValueError(f'Incomplete batch coverage: {path}')
        row = {'sheetId': sheet['id'], 'source': sheet['source'],
               'sourceSystem': sheet['sourceSystem'], 'notes': review.get('visualReviewNotes', ''),
               'exclusionReason': review.get('exclusionReason'), 'checked': 0, 'proposals': 0}
        for batch in batches:
            if Counter(batch['checkedKeys']) != Counter(expected_batches[batch['batch']]):
                raise ValueError(f'Incorrect checked keys: {path}, batch {batch["batch"]}')
            row['checked'] += len(batch['checkedKeys'])
            seen = set()
            for candidate in batch['candidates']:
                key = candidate['key']
                if key not in batch['checkedKeys'] or key in seen:
                    raise ValueError(f'Unknown or duplicate candidate: {path}: {key}')
                seen.add(key)
                if candidate['classification'] not in ('match', 'conditional'):
                    raise ValueError(f'Invalid classification: {path}: {key}')
                crop = candidate['crop']
                x, y, width, height = crop
                if not all(isinstance(v, int) for v in crop) or min(x, y) < 0 or min(width, height) <= 0 or x + width > image.width or y + height > image.height:
                    raise ValueError(f'Invalid crop: {path}: {key}: {crop}')
                if max(width, height) > 16 and not candidate.get('sizeException'):
                    raise ValueError(f'Unexplained oversized crop: {path}: {key}')
                rejection_key = sheet['id'] + '|' + key + '|' + ','.join(map(str, crop))
                if rejection_key in exclusions:
                    continue
                frame = image.crop((x, y, x + width, y + height))
                if not frame.getbbox():
                    raise ValueError(f'Empty crop: {path}: {key}')
                row['proposals'] += 1
                rgba = hashlib.sha256(str(frame.size).encode() + frame.tobytes()).hexdigest()
                if (rgba, key) in pixel_targets:
                    continue
                pixel_targets.add((rgba, key))
                identity = hashlib.sha256((digest + str(crop) + candidate['classification']).encode()).hexdigest()[:20]
                entry = entries.get(identity)
                if entry is None:
                    system = sheet['sourceSystem']
                    pack = 'Rogue Adventure World' if system == 'Rogue Adventure' else system
                    item_pack = {'Rogue Adventure': 'rogue', 'Fantasy Dreamland': 'dreamland',
                                 'Dungeon Gathering': 'dungeon', 'Pixel Plains': 'plains',
                                 'Sunnyside World': 'sunnyside', '16x16 RPG Pack': 'rpg'}.get(system)
                    item_pack = item_pack or 'indexed_' + re.sub(r'[^a-z0-9]+', '_', system.lower())
                    filename = identity + '.png'
                    frame.save(output / filename)
                    entry = {'id': 'indexed-' + identity, 'pack': pack, 'itemPack': item_pack,
                             'name': catalogue[key]['name'], 'source': sheet['source'], 'sourceSHA256': digest,
                             'crop': crop, 'image': 'art-candidates/indexed/' + filename,
                             'targets': [], 'itemIds': [], 'nativeTileSize': 16,
                             'status': 'Needs review' if candidate['classification'] == 'conditional' else 'Candidate',
                             'note': '', 'targetEvidence': {}}
                    if system not in ('Rogue Adventure', 'Fantasy Dreamland'):
                        entry['group'] = 'smaller'
                    if candidate.get('sizeException'):
                        entry['sizeException'] = candidate['sizeException']
                    entries[identity] = entry
                target = catalogue[key]
                entry['targets' if target['catalogue'] == 'world' else 'itemIds'].append(target['id'])
                entry['targetEvidence'][key] = candidate['evidence']
                notes = list(dict.fromkeys(entry['targetEvidence'].values()))
                entry['note'] = ('Conditional option; ' if entry['status'] == 'Needs review' else '') + ' '.join(notes)
        coverage.append(row)
    counts = Counter(row['sheetId'] for row in coverage)
    if any(count > 1 for count in counts.values()):
        raise ValueError('Sheet reviewed more than once')
    manifest = {'schemaVersion': 1, 'batchSize': 64, 'catalogueSize': len(catalogue),
                'reviewNote': 'Native source crops for comparison only. Conditional options are explicitly labelled; game art is unchanged.',
                'entries': list(entries.values())}
    (output / 'alternatives.json').write_text(json.dumps(manifest, indent=2) + '\n')
    exported_names = {Path(entry['image']).name for entry in entries.values()}
    for old_crop in output.glob('*.png'):
        if old_crop.name not in exported_names:
            old_crop.unlink()
    report = {'expectedSheets': len(sheets), 'reviewedSheets': len(coverage),
              'missingSheets': [sheet for key, sheet in sheets.items() if key not in counts],
              'sheets': coverage, 'candidateCrops': len(entries),
              'worldTargets': len({target for entry in entries.values() for target in entry['targets']}),
              'itemTargets': len({target for entry in entries.values() for target in entry['itemIds']})}
    (output / 'coverage.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({key: value for key, value in report.items() if key not in ('sheets', 'missingSheets')}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('review_dir', type=Path)
    parser.add_argument('--output', type=Path, default=ROOT / 'tools/art-candidates/indexed')
    args = parser.parse_args()
    build(args.review_dir, args.output)
