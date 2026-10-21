#!/usr/bin/env python3
"""Pack approved floor swatches and native slab assemblies with provenance."""
import json
import base64
import io
from pathlib import Path
from PIL import Image
from ambient_floor_art import _crop

ROOT = Path(__file__).resolve().parents[1]
manifest = json.loads((ROOT / 'tools/rockwall-floor-materials.json').read_text())
refs, themes, offsets = [], [], []
width = 0
for source in manifest['themes']:
    theme = {k: source[k] for k in ('id', 'label', 'cap')}
    for role in ('face', 'faceAccent', 'ground', 'road', 'groundBroken', 'groundGrate',
                 'groundAccent', 'roadAccent', 'pad', 'water'):
        if role not in source:
            continue
        ref = source[role]
        if ref not in refs:
            offsets.append(width)
            refs.append(ref)
            width += ref.get('size', 16)
        theme[role] = offsets[refs.index(ref)] // 16
        if ref.get('size', 16) != 16:
            theme[role + 'Size'] = ref['size']
    themes.append(theme)

def crop(ref, size=(16, 16)):
    uri = _crop(ref['sheet'], ref['x'], ref['y'], size[0] / 16, size[1] / 16,
                tint=tuple(ref['tint']) if ref.get('tint') else None)
    return Image.open(io.BytesIO(base64.b64decode(uri.split(',', 1)[1]))).convert('RGBA')

strip = Image.new('RGBA', (width, max(r.get('size', 16) for r in refs)))
provenance = []
for x, ref in zip(offsets, refs):
    if 'assembly' in ref:
        tile = Image.new('RGBA', (ref['size'], ref['size']))
        for part in ref['assembly']:
            tile.paste(crop(part, part['size']), tuple(part['at']))
        detail = {'assembly': [{**p, 'source': manifest['sheets'][p['sheet']]} for p in ref['assembly']]}
    else:
        tile = crop(ref)
        detail = {'source': manifest['sheets'][ref['sheet']], 'x': ref['x'], 'y': ref['y'],
                  **({'tint': ref['tint']} if 'tint' in ref else {})}
    if tile.getchannel('A').getextrema() != (255, 255):
        raise ValueError(f'Floor crop must be opaque: {ref}')
    strip.paste(tile, (x, 0))
    provenance.append({'atlasX': x, 'size': tile.width, **detail,
                       **({'catalogId': ref['catalogId']} if 'catalogId' in ref else {})})

out = ROOT / 'assets/Objects/Cave'
strip.save(out / 'floor-wall-sources.png')
(out / 'floor-wall-sources.json').write_text(json.dumps({
    'credit': manifest['credit'], 'sourceCellPx': 16, 'tiles': provenance,
}, indent=2) + '\n')
module = ROOT / 'src/floor_wall_materials.js'
s = module.read_text()
a, rest = s.split('  // BEGIN GENERATED THEMES\n', 1)
_, b = rest.split('  // END GENERATED THEMES\n', 1)
module.write_text(a + '  // BEGIN GENERATED THEMES\n  const THEMES = ' + json.dumps(themes, separators=(',', ':')) + ';\n  // END GENERATED THEMES\n' + b)
print(f'Packed {len(refs)} approved swatches for {len(themes)} floors.')
