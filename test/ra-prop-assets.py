"""Verify approved sprite packing without touching generated assets (Pillow)."""
import json
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
PROPS = ROOT / 'assets/ArtTrials/RogueProps'
# Source manifests and their crops are archived provenance.
ARCHIVED_PROPS = ROOT / 'extra_assets/inactive/assets/ArtTrials/RogueProps'


def read(path):
    return Image.open(ROOT / path).convert('RGBA')


def frame(image, number, width=16, height=16):
    cols = image.width // width
    x, y = number % cols * width, number // cols * height
    return image.crop((x, y, x+width, y+height))


flora = json.loads((ROOT / 'extra_assets/inactive/assets/ArtTrials/RogueProps/approved-flora/manifest.json').read_text())['entries']
mapping = json.loads((PROPS / 'flora-mapping.json').read_text())['assets']
for row in flora:
    output = read(mapping[row['keys'][0]]['path'])
    expected = read(row['input'])
    actual = frame(output, row['frame'], row['frameWidth'], row['frameHeight'])
    assert actual.tobytes() == expected.tobytes(), row['id']
    if 'RA canopy colors' in row['proposal']['method']:
        original = frame(read(row['original']), row['frame'], row['frameWidth'], row['frameHeight'])
        assert original.getchannel('A').tobytes() == actual.getchannel('A').tobytes(), row['id']
for key, row in mapping.items():
    original, actual = read(row['original']), read(row['path'])
    assert original.size == actual.size, key
    fw, fh = row['frameWidth'], row['frameHeight']
    for n in range(original.width // fw * (original.height // fh)):
        if n not in row['changedFrames']:
            assert frame(original, n, fw, fh).tobytes() == frame(actual, n, fw, fh).tobytes(), (key, n)

# Mesh materials must preserve all crate slots and every unapproved rock frame.
manifest = json.loads((ROOT / 'extra_assets/inactive/assets/Objects/LowPolyProps/manifest.json').read_text())
original = read('extra_assets/inactive/assets/Objects/LowPolyProps/materials.png')
actual = read(PROPS / 'flora-lowpoly-materials.png')
for row in manifest['entries']:
    if row['kind'] == 'rock' and row['frame'] in (0, 20):
        continue
    s = manifest['stride']
    x, y = row['slot'] % manifest['columns'] * s, row['slot'] // manifest['columns'] * s
    box = (x, y, x+s, y+s)
    assert original.crop(box).tobytes() == actual.crop(box).tobytes(), row

containers = json.loads((ARCHIVED_PROPS / 'containers/source/manifest.json').read_text())
for row in containers:
    key = 'clay_pot' if row['id'].startswith('pot-') else 'chest' if row['id'].startswith('chest-') else 'wood'
    assert frame(read(PROPS / f'containers/{key}.png'), row['frame']).tobytes() == read(row['source']).tobytes(), row['id']
# The untouched intact-pot variant is separate from approved recolor frame 1.
assert frame(read('assets/Objects/SelectedProps/clay_pot.png'), 0).tobytes() == frame(read(PROPS / 'containers/clay_pot.png'), 0).tobytes()

fixtures = json.loads((ARCHIVED_PROPS / 'fixtures/source/approved.json').read_text())
for row in fixtures:
    name, n = row['id'], 0
    if name.startswith('shrine-'):
        filename, n = 'shrines', int(name.split('-')[1])
    elif name.startswith('elevator-'):
        filename, n = 'elevators', int(name.split('-')[1])
    elif name == 'waystone-0':
        filename = 'waystone'
    else:
        filename = name
    expected = read(ARCHIVED_PROPS / f'fixtures/source/{name}.png')
    actual = frame(read(PROPS / f'fixtures/{filename}.png'), n, *expected.size)
    assert actual.tobytes() == expected.tobytes(), name
assert frame(read('extra_assets/inactive/assets/Objects/Handmade/waystone.png'), 1).tobytes() == frame(read(PROPS / 'fixtures/waystone.png'), 1).tobytes()
print('Approved RA pixels, foliage silhouettes, untouched atlas frames, crate mesh materials and fixture packing passed.')
