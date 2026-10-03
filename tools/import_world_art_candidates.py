#!/usr/bin/env python3
"""Import approved review candidates into existing sheets without touching neighbours.

Run after legacy art generators/recolour bakers. Only manifest-listed frames are
replaced; geometry, unrelated frames, and asset registration remain unchanged.
The checked-in crops are from the generated originals, before review downsampling.
"""
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parents[1]
IMPORTS = ROOT / 'assets/Objects/Approved/world-art-imports.json'
APPROVED = ROOT / 'assets/Objects/Approved/manifest.json'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def candidate_frame(source, size):
    """Use the review packer's hard alpha, nearest pixels and bottom alignment."""
    tile = Image.open(source).convert('RGBA')
    tile.putalpha(tile.getchannel('A').point(lambda a: 255 if a >= 128 else 0))
    bounds = tile.getbbox()
    if not bounds:
        raise ValueError(f'Empty approved candidate: {source}')
    tile = tile.crop(bounds)
    tile.thumbnail((size[0] - 2, size[1] - 2), Image.Resampling.NEAREST)
    frame = Image.new('RGBA', size)
    frame.alpha_composite(tile, ((size[0] - tile.width) // 2, size[1] - 1 - tile.height))
    return frame


def apply_imports(root=ROOT):
    root = Path(root)
    manifest_path = root / IMPORTS.relative_to(ROOT)
    spec = json.loads(manifest_path.read_text())
    grouped = {}
    for entry in spec['frames']:
        grouped.setdefault(entry['sheet'], []).append(entry)
    report = []
    approved_path = root / APPROVED.relative_to(ROOT)
    approved = json.loads(approved_path.read_text())
    for name, entries in grouped.items():
        path = root / name
        before = Image.open(path).convert('RGBA')
        sheet = before.copy()
        selected = Image.new('L', sheet.size)
        for entry in entries:
            w, h = entry['frameSize']
            if sheet.width % w or sheet.height % h:
                raise ValueError(f'Invalid sheet geometry: {name}')
            cols = sheet.width // w
            frame = entry['frame']
            x, y = frame % cols * w, frame // cols * h
            if frame < 0 or y + h > sheet.height:
                raise ValueError(f'Frame outside sheet: {name} frame {frame}')
            source = root / entry['source']
            if digest(source) != entry['sourceSha256']:
                raise ValueError(f'Approved source changed: {source}')
            if entry.get('native'):
                native = Image.open(source).convert('RGBA')
                if native.size != (w, h):
                    raise ValueError(f'Native frame size mismatch: {source}')
                sheet.paste(native, (x, y))
            else:
                sheet.paste(candidate_frame(source, (w, h)), (x, y))
            selected.paste(255, (x, y, x + w, y + h))
        # Check all channels: RGBA.getbbox() alone can miss an RGB-only change.
        delta = ImageChops.difference(before, sheet)
        outside = ImageChops.invert(selected)
        assert all(not ImageChops.multiply(channel, outside).getbbox() for channel in delta.split())
        sheet.save(path)
        sha = digest(path)
        for record in approved['files']:
            if record['path'] == name:
                record['sha256'] = sha
                record['frameImports'] = [
                    {key: entry[key] for key in ('reviewId', 'frame', 'frameSize', 'source', 'sourceSha256')}
                    for entry in entries
                ]
        report.append({'sheet': name, 'frames': [e['frame'] for e in entries],
                       'size': list(sheet.size), 'sha256': sha, 'unselectedPixelsPreserved': True})
    approved_path.write_text(json.dumps(approved, indent=2) + '\n')
    return report


if __name__ == '__main__':
    print(json.dumps(apply_imports(), indent=2))
