"""The mesh atlas must retain authored pixels without alpha holes or atlas bleed."""
from pathlib import Path
from PIL import Image
import hashlib
import json
ROOT = Path(__file__).resolve().parents[1]
path = ROOT / 'extra_assets/inactive/assets/Objects/LowPolyProps'
manifest = json.loads((path/'manifest.json').read_text())
atlas = Image.open(path/'materials.png').convert('RGBA')
assert atlas.size == (manifest['size'], manifest['size'])
for source in manifest['sources'].values():
    assert hashlib.sha256((ROOT/source['path']).read_bytes()).hexdigest() == source['sha256'], 'Source changed: rebuild prop materials'
for entry in manifest['entries']:
    source = Image.open(ROOT/entry['source']).convert('RGBA').crop(entry['crop'])
    colors = {p for p in source.getdata() if p[3] == 255}
    slot, stride, pad, cols = entry['slot'], manifest['stride'], manifest['padding'], manifest['columns']
    x, y = slot % cols * stride, slot // cols * stride
    tile = atlas.crop((x, y, x+stride, y+stride))
    assert set(tile.getdata()) <= colors, f'{entry}: atlas must use exact authored opaque texels'
    assert len(set(tile.getdata())) > 1, 'A flat tint cannot replace an authored texture'
    for yy in range(stride):
        for xx in range(stride):
            assert tile.getpixel((xx, yy)) == tile.getpixel((max(pad,min(stride-pad-1,xx)), max(pad,min(stride-pad-1,yy)))), 'Padding must extend edge texels'
assert len(manifest['entries']) == 73
print('73 textured surfaces: exact source colors, source hashes, opacity and bleed padding passed.')
