"""Pack approved RA flora into original sheet layouts, without runtime recoloring.

The checked-in approved-flora inputs are the final reviewed native-size exports.
Only their listed frames change; frame identities and all other pixels survive.
Run from any directory with Python 3 and Pillow.
"""
import hashlib
import json
from pathlib import Path
from PIL import Image
from build_prop_materials import opaque_crop

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/ArtTrials/RogueProps'


def build():
    rows = json.loads((OUT / 'approved-flora/manifest.json').read_text())['entries']
    sheets = {}
    bounds = {}
    for row in rows:
        source = row['original']
        if source not in sheets:
            sheets[source] = {'image': Image.open(ROOT / source).convert('RGBA'),
                              'keys': row['keys'], 'frames': []}
        sheet = sheets[source]
        frame = row['frame']
        fw, fh = row['frameWidth'], row['frameHeight']
        art = Image.open(ROOT / row['input']).convert('RGBA')
        assert art.size == (fw, fh), row['id']
        cols = sheet['image'].width // fw
        x, y = frame % cols * fw, frame // cols * fh
        # Paste without an alpha mask: transparent pixels must replace the old
        # silhouette instead of leaving pieces of its previous shape behind.
        sheet['image'].paste(art, (x, y))
        sheet['frames'].append(frame)
        sheet.update(frameWidth=fw, frameHeight=fh)
        box = art.getchannel('A').point(lambda a: 255 if a >= 16 else 0).getbbox()
        assert box, row['id']
        for key in row['keys']:
            bounds[f'{key}:{frame}'] = dict(fw=fw, fh=fh,
                minX=box[0], minY=box[1], maxX=box[2], maxY=box[3])
    assets = {}
    for source, sheet in sheets.items():
        output = OUT / ('flora-' + sheet['keys'][0] + '.png')
        sheet['image'].save(output)
        for key in sheet['keys']:
            assets[key] = dict(path=str(output.relative_to(ROOT)), kind='spritesheet',
                frameWidth=sheet['frameWidth'], frameHeight=sheet['frameHeight'],
                width=sheet['image'].width, height=sheet['image'].height,
                changedFrames=sheet['frames'], original=source,
                sha256=hashlib.sha256(output.read_bytes()).hexdigest())
    # Rocks render as 3D meshes. Update just the two approved stone materials;
    # preserve every crate material and every other rock frame byte-for-byte.
    material = Image.open(ROOT / 'extra_assets/inactive/assets/Objects/LowPolyProps/materials.png').convert('RGBA')
    manifest = json.loads((ROOT / 'extra_assets/inactive/assets/Objects/LowPolyProps/manifest.json').read_text())
    stones = sheets['extra_assets/inactive/assets/Objects/Rocks/rocks-16.png']['image']
    for entry in manifest['entries']:
        if entry['kind'] != 'rock' or entry['frame'] not in (0, 20):
            continue
        tile = opaque_crop(stones, entry['crop'], True)
        slot, stride, cols, pad = entry['slot'], manifest['stride'], manifest['columns'], manifest['padding']
        ox, oy = slot % cols * stride, slot // cols * stride
        for y in range(stride):
            for x in range(stride):
                material.putpixel((ox+x, oy+y), tile.getpixel((min(15, max(0, x-pad)), min(15, max(0, y-pad)))))
    material.save(OUT / 'flora-lowpoly-materials.png')
    (OUT / 'flora-mapping.json').write_text(json.dumps(dict(assets=assets, bounds=bounds,
        lowpolyMaterials='assets/ArtTrials/RogueProps/flora-lowpoly-materials.png',
        notes=['Replace atlas-alias entries with standalone spritesheet descriptors.',
               'Update ICON_SHEETS URLs, dimensions and frame rectangles for these sources.',
               'Original plant frame indices and CROP_SPRITE semantics stay unchanged.',
               'Bramble is byte-identical because its approved preview changed no green pixels.',
               'Keep native RA plain-stone spec overrides unchanged.']), indent=2)+'\n')
    print(f'Packed {len(rows)} approved frames across {len(sheets)} flora sheets; two 3D stone materials updated.')


if __name__ == '__main__':
    build()
