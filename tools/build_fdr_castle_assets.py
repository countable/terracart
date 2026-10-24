#!/usr/bin/env python3
"""Export subdued FDR castle masonry from the approved native source crops."""
import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image

from build_fdr_castle_trial import SOURCE, FLOOR_SOURCE, ROOT

SIZE, SLOT, PAD, CONTENT = 512, 128, 8, 112
MATERIALS = [
    (2, 'cap', (130, 30, 12, 8), (16, 16)),
    (3, 'wall', (16, 64, 16, 16), None),
    (4, 'floor', (144, 48, 16, 16), None),
    (5, 'door', (192, 256, 48, 32), None),
    (6, 'window', (0, 160, 16, 16), None),
    (7, 'side-coping', (128, 48, 8, 16), None),
    (8, 'merlon-top', (131, 29, 10, 4), None),
    (9, 'merlon-face', (131, 33, 10, 4), None),
    (10, 'rim', (144, 76, 16, 4), None),
    (11, 'base', (128, 104, 16, 8), None),
    (12, 'right-coping', (168, 48, 8, 16), None),
]


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def padded(tile, wrap_x, wrap_y):
    """Match the approved preview: wrapped repeats, clamped decal borders."""
    # Canvas selects the lower texel when a destination centre lands exactly
    # between source texels. Pillow's tie rule differs for the 32px door rows.
    # Integer centre sampling preserves the approved browser atlas exactly.
    pixels = tile.load()
    xs = [max(0, ((2 * x + 1) * tile.width - 1) // (2 * CONTENT)) for x in range(CONTENT)]
    ys = [max(0, ((2 * y + 1) * tile.height - 1) // (2 * CONTENT)) for y in range(CONTENT)]
    content = Image.new('RGBA', (CONTENT, CONTENT))
    content.putdata([pixels[x, y] for y in ys for x in xs])
    result = Image.new('RGBA', (SLOT, SLOT))
    result.paste(content, (PAD, PAD))
    top = content.crop((0, CONTENT - PAD if wrap_y else 0, CONTENT,
                        CONTENT if wrap_y else 1))
    bottom = content.crop((0, 0 if wrap_y else CONTENT - 1, CONTENT,
                           PAD if wrap_y else CONTENT))
    result.paste(top.resize((CONTENT, PAD), Image.Resampling.NEAREST), (PAD, 0))
    result.paste(bottom.resize((CONTENT, PAD), Image.Resampling.NEAREST), (PAD, PAD + CONTENT))
    left_x = CONTENT if wrap_x else PAD
    right_x = PAD if wrap_x else PAD + CONTENT - 1
    left = result.crop((left_x, 0, left_x + (PAD if wrap_x else 1), SLOT))
    right = result.crop((right_x, 0, right_x + (PAD if wrap_x else 1), SLOT))
    result.paste(left.resize((PAD, SLOT), Image.Resampling.NEAREST), (0, 0))
    result.paste(right.resize((PAD, SLOT), Image.Resampling.NEAREST), (PAD + CONTENT, 0))
    return result



# Only the castle atlas is treated; the separately exported ground paving keeps
# its native pixels. Compression preserves average stone colour and pixel detail.
MASONRY_SLOTS = {2, 3, 7, 8, 9, 10, 11, 12}
SKY_SLOTS = {2, 4, 7, 8, 12}
CONTRAST, SKY_LIFT = 0.60, 0.07


def treatment(tile, slot):
    contrast = CONTRAST if slot in MASONRY_SLOTS else 1
    lift = SKY_LIFT if slot in SKY_SLOTS else 0
    pixels = list(tile.getdata())
    opaque = [p for p in pixels if p[3]]
    average = [sum(p[i] for p in opaque) / len(opaque) for i in range(3)]
    result = Image.new('RGBA', tile.size)
    result.putdata([tuple(round((average[i] + (p[i] - average[i]) * contrast) * (1 - lift)
                              + 255 * lift) for i in range(3)) + (p[3],) if p[3] else p
                    for p in pixels])
    return result, dict(contrast=contrast, skyLift=lift)


def build(out):
    out.mkdir(parents=True, exist_ok=True)
    source = Image.open(SOURCE).convert('RGBA')
    floor_source = Image.open(FLOOR_SOURCE).convert('RGBA')
    atlas = Image.new('RGBA', (SIZE, SIZE))
    rows = []
    for slot, name, rect, normalized in MATERIALS:
        x, y, w, h = rect
        native = (floor_source if name == 'floor' else source).crop((x, y, x + w, y + h))
        if name == 'floor':
            native.save(out / 'floor.png')
        tile, paint = treatment(native, slot)
        tile = tile.resize(normalized, Image.Resampling.NEAREST) if normalized else tile
        wrap_x, wrap_y = slot in (3, 4, 10), slot in (3, 4)
        ox, oy = slot % 4 * SLOT, slot // 4 * SLOT
        atlas.paste(padded(tile, wrap_x, wrap_y), (ox, oy))
        rows.append(dict(slot=slot, name=name, source='floor' if name == 'floor' else 'castle',
                         sourceRect=list(rect), normalizedSize=list(tile.size),
                         atlasContentRect=[ox + PAD, oy + PAD, CONTENT, CONTENT],
                         gutterX='wrap' if wrap_x else 'clamp', gutterY='wrap' if wrap_y else 'clamp',
                         alphaRange=list(native.getchannel('A').getextrema()), treatment=paint))
    # Shared retained renderer samples its untextured triangles at (500, 500).
    atlas.paste((255, 255, 255, 255), (496, 496, 504, 504))
    atlas.save(out / 'atlas.png')
    manifest = dict(
        credit='Fantasy Dreamland Reborn and Fantasy City by ElvGames',
        sources={
            'castle': dict(path=str(SOURCE.relative_to(ROOT)), sha256=digest(SOURCE),
                           license='extra_assets/16x16/Fantasy Dreamland World/License.txt'),
            'floor': dict(path=str(FLOOR_SOURCE.relative_to(ROOT)), sha256=digest(FLOOR_SOURCE)),
        },
        processing='Source crops with mean-preserving masonry contrast compression, a modest sky-facing material lift, nearest-neighbour scaling and padded atlas packing; no generated imagery.',
        palette='Warm source-derived palette; the renderer applies condition tint and one lower-half wall shade band.',
        atlas=dict(size=[SIZE, SIZE], slotSize=SLOT, padding=PAD, contentSize=CONTENT,
                   whitePatch=[496, 496, 8, 8], unusedSlots='Transparent'),
        materials=rows,
        outputs={name: dict(sha256=digest(out / name), size=list(Image.open(out / name).size))
                 for name in ('atlas.png', 'floor.png')},
        regenerate='python3 tools/build_fdr_castle_assets.py',
    )
    (out / 'sources.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(f'Exported {out / "atlas.png"} and native 16px floor')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, default=ROOT / 'assets/Objects/Castle/FDR')
    build(parser.parse_args().out)
