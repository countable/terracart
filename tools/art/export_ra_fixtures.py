#!/usr/bin/env python3
"""Pack approved RA fixture PNGs losslessly; no resampling or alpha cleanup.

Approved source exports live in extra_assets/inactive with their checksum manifest.
Regeneration requires that local source archive and Python/Pillow.
"""
from pathlib import Path
import hashlib
import json
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
DEST = ROOT / 'assets/ArtTrials/RogueProps/fixtures'
SOURCE = ROOT / 'extra_assets/inactive/assets/ArtTrials/RogueProps/fixtures/source'


def read(name):
    return Image.open(SOURCE / (name + '.png')).convert('RGBA')


def measure(image):
    alpha = image.getchannel('A')
    # Same alpha threshold as tools/sprite_audit.js. Keep exported pixels intact.
    bounds = alpha.point(lambda a: 255 if a >= 16 else 0).getbbox()
    histogram = alpha.histogram()
    x0, y0, x1, y1 = bounds
    return dict(fw=image.width, fh=image.height, minX=x0, minY=y0,
                maxX=x1, maxY=y1), dict(partial=sum(histogram[1:255]),
                                      belowBoundsThreshold=sum(histogram[1:16]))


def export(key, filename, frames, image=False):
    fw, fh = frames[0].size
    assert all(f.size == (fw, fh) for f in frames)
    sheet = Image.new('RGBA', (fw * len(frames), fh))
    for n, frame in enumerate(frames):
        # paste without a mask preserves semi-transparent pixels exactly.
        sheet.paste(frame, (n * fw, 0))
    path = DEST / (filename + '.png')
    sheet.save(path)
    asset = dict(kind='image' if image else 'spritesheet',
                 path=str(path.relative_to(ROOT)))
    if not image:
        asset.update(frameWidth=fw, frameHeight=fh)
    bounds, alpha = {}, {}
    for n, frame in enumerate(frames):
        identifier = key + ':' + ('__BASE' if image else str(n))
        bounds[identifier], alpha[identifier] = measure(frame)
        assert sheet.crop((n * fw, 0, (n+1)*fw, fh)).tobytes() == frame.tobytes()
    return dict(key=key, asset=asset, bounds=bounds, alpha=alpha)


def main():
    for row in json.loads((SOURCE / 'approved.json').read_text()):
        assert hashlib.sha256((SOURCE / (row['id']+'.png')).read_bytes()).hexdigest() == row['approvedSha256']
    rows = []
    for key, name, is_image in [
        ('rogue_ladder_down', 'ladder-down', True),
        ('rogue_ladder_up', 'ladder-up', True),
        ('rogue_lamp_unlit', 'lamp-unlit', True),
        ('selected_grave_pillar', 'grave', False),
        ('well', 'well', False), ('gatepost', 'gatepost', False),
        ('barricade', 'barricade', False),
        ('grove_votive', 'votive', False), ('vista_scope', 'scope', False),
    ]:
        rows.append(export(key, name, [read(name)], is_image))
    rows.append(export('rogue_elevators', 'elevators', [read('elevator-0'), read('elevator-1')]))
    rows.append(export('shrines', 'shrines', [read('shrine-'+str(n)) for n in range(11)]))
    original = Image.open(ROOT / 'extra_assets/inactive/assets/Objects/Handmade/waystone.png').convert('RGBA')
    rows.append(export('waystone', 'waystone', [read('waystone-0'), original.crop((16, 0, 32, 16))]))
    result = dict(assets=rows, notes=[
        'Install only under Rogue Adventure profile; keep all gameplay kind/frame identities.',
        'Separate elevator sheet preserves progression_tiles and every unrelated progression frame.',
        'Use shrine display scale 16/15 for new 24x36 votive rather than former 4/3.',
        'Access sprites remain scale 1; elevator sprites remain scale 1 with taller approved frames.',
        'All source alpha is preserved exactly, including generated partial-alpha edge pixels.',
        'Waystone lit frame 1 remains pixel-identical to the baseline source.'
    ])
    (DEST / 'manifest.json').write_text(json.dumps(result, indent=2)+'\n')
    print('Exported', len(rows), 'fixture textures; approved PNG hashes and all frame pixels verified.')


if __name__ == '__main__':
    main()
