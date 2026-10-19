#!/usr/bin/env python3
"""Pack the approved 16px floor swatches; retain their source attribution."""
import json
import base64
import io
from pathlib import Path
from PIL import Image
from ambient_floor_art import _crop

ROOT = Path(__file__).resolve().parents[1]
manifest = json.loads((ROOT / 'tools/rockwall-floor-materials.json').read_text())
refs, themes = [], []
for source in manifest['themes']:
    theme = {k: source[k] for k in ('id', 'label', 'cap')}
    for role in ('face', 'faceAccent', 'ground', 'road', 'groundBroken', 'groundGrate'):
        if role not in source:
            continue
        ref = source[role]
        if ref not in refs:
            refs.append(ref)
        theme[role] = refs.index(ref)
    themes.append(theme)
strip = Image.new('RGBA', (16 * len(refs), 16))
for i, ref in enumerate(refs):
    uri = _crop(ref['sheet'], ref['x'], ref['y'], tint=tuple(ref['tint']) if ref.get('tint') else None)
    strip.paste(Image.open(io.BytesIO(base64.b64decode(uri.split(',', 1)[1]))), (i * 16, 0))

out = ROOT / 'assets/Objects/Cave'
strip.save(out / 'floor-wall-sources.png')
(out / 'floor-wall-sources.json').write_text(json.dumps({
    'credit': manifest['credit'], 'sourceCellPx': 16,
    'tiles': [{'source': manifest['sheets'][r['sheet']], 'x': r['x'], 'y': r['y'], **({'tint': r['tint']} if 'tint' in r else {})} for r in refs],
}, indent=2) + '\n')
module = ROOT / 'src/floor_wall_materials.js'
s = module.read_text()
a, rest = s.split('  // BEGIN GENERATED THEMES\n', 1)
_, b = rest.split('  // END GENERATED THEMES\n', 1)
module.write_text(a + '  // BEGIN GENERATED THEMES\n  const THEMES = ' + json.dumps(themes, separators=(',', ':')) + ';\n  // END GENERATED THEMES\n' + b)
print(f'Packed {len(refs)} approved swatches for {len(themes)} floors.')
