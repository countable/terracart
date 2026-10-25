#!/usr/bin/env python3
"""Export subdued FDR castle masonry from the approved native source crops."""
import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageDraw

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
    # Shared authored cel materials. Their stone courses, coping and heraldry
    # replace facade detail geometry; every tile is built once offline.
    stone = Image.new('RGBA', (32, 32), (246, 246, 246, 255))
    ink = ImageDraw.Draw(stone)
    for row in range(4):
        y = row * 8
        ink.line((0, y + 7, 31, y + 7), fill=(201, 201, 201, 255))
        ink.line((0, y, 31, y), fill=(255, 255, 255, 255))
        for x in range(-8 if row % 2 else 0, 32, 16):
            ink.line((x, y, x, y + 6), fill=(214, 214, 214, 255))
            if (row + x // 16) % 3 == 0:
                ink.rectangle((x + 2, y + 2, x + 13, y + 5), fill=(235, 235, 235, 255))
    wreck = stone.copy(); moss = ImageDraw.Draw(wreck)
    for poly in [[(0, 22), (6, 22), (6, 18), (9, 18), (9, 28), (13, 28), (13, 31), (0, 31)],
                 [(20, 31), (20, 26), (23, 26), (23, 23), (29, 23), (29, 29), (31, 29), (31, 31)],
                 [(27, 0), (31, 0), (31, 10), (29, 10), (29, 6), (25, 6), (25, 3), (27, 3)]]:
        moss.polygon(poly, fill=(157, 174, 114, 255))
    moss.rectangle((2, 25, 6, 28), fill=(181, 191, 138, 255))
    for x,y in [(0,22),(6,19),(8,27),(12,30),(20,26),(28,24),(30,29),(25,4)]:
        moss.point((x,y), fill=stone.getpixel((x,y)))
    for x,y in [(10,30),(17,29),(22,21),(28,12)]:
        moss.rectangle((x,y,x+1,y+1), fill=(173,184,129,255))
    deck = Image.new('RGBA', (32, 32), (224, 224, 224, 255)); rim = ImageDraw.Draw(deck)
    rim.rectangle((0, 0, 31, 31), outline=(185, 185, 185, 255), width=1)
    rim.rectangle((1, 1, 30, 30), outline=(255, 255, 255, 255), width=2)
    rim.rectangle((3, 3, 28, 28), outline=(209, 209, 209, 255), width=1)
    for y in [11, 20]: rim.line((5, y, 26, y), fill=(215, 215, 215, 255))
    # Transparent pale heraldry: one pixel-art sun/trident mark is sampled by
    # existing flat banner faces, never modeled as separate spikes or strokes.
    heraldry = Image.new('RGBA', (16, 16)); sigil = ImageDraw.Draw(heraldry)
    sigil.rectangle((7, 1, 8, 14), fill='white')
    sigil.line((3, 4, 3, 7, 7, 10, 12, 7, 12, 4), fill='white', width=2)
    sigil.rectangle((6, 3, 9, 6), fill='white')
    sun = Image.new('RGBA', (16, 16)); rays = ImageDraw.Draw(sun)
    rays.rectangle((5, 5, 10, 10), fill='white')
    for x, y, w, h in [(7, 1, 2, 3), (7, 12, 2, 3), (1, 7, 3, 2), (12, 7, 3, 2), (3, 3, 2, 2), (11, 3, 2, 2), (3, 11, 2, 2), (11, 11, 2, 2)]:
        rays.rectangle((x, y, x+w-1, y+h-1), fill='white')
    door = Image.new('RGBA', (24, 28), (236, 236, 236, 255)); frame = ImageDraw.Draw(door)
    frame.rectangle((0, 0, 23, 27), outline=(185, 185, 185, 255), width=1)
    frame.rectangle((3, 4, 20, 27), fill=(74, 74, 74, 255))
    frame.line((1, 1, 22, 1), fill=(255, 255, 255, 255))
    frame.line((3, 4, 20, 4), fill=(49, 49, 49, 255))
    for x in [5, 18]:
        for y in [8, 22]: frame.rectangle((x, y, x + 1, y + 1), fill=(108, 108, 108, 255))
    for slot, name, tile, wrap_x, wrap_y in [
        (0, 'lit-coping-and-inset-deck', deck, False, False),
        (1, 'pale-heraldry', heraldry, False, False),
        (5, 'closed-iron-door', door, False, False),
        (6, 'bastion-sun', sun, False, False),
        (13, 'quiet-stone', stone, True, True),
        (14, 'weathered-stone', wreck, True, True)]:
        rows = [row for row in rows if row['slot'] != slot]
        atlas.paste(padded(tile, wrap_x, wrap_y), (slot % 4 * SLOT, slot // 4 * SLOT))
        rows.append(dict(slot=slot, name=name, source='authored cel pixel material',
                         normalizedSize=list(tile.size),
                         atlasContentRect=[slot % 4 * SLOT + PAD, slot // 4 * SLOT + PAD, CONTENT, CONTENT],
                         gutterX='wrap' if wrap_x else 'clamp', gutterY='wrap' if wrap_y else 'clamp',
                         alphaRange=list(tile.getchannel('A').getextrema())))
    # Ground weathering is a transparent shared repeat painted onto the
    # existing courtyard canvas, so grass does not become individual geometry.
    grass = Image.new('RGBA', (64, 64)); patches = ImageDraw.Draw(grass)
    for poly in [[(0, 8), (10, 8), (10, 3), (20, 3), (20, 12), (25, 12), (25, 18), (17, 18), (17, 24), (5, 24), (5, 20), (0, 20)],
                 [(35, 35), (43, 35), (43, 29), (57, 29), (57, 38), (63, 38), (63, 48), (52, 48), (52, 54), (40, 54), (40, 46), (35, 46)],
                 [(8, 47), (16, 47), (16, 42), (24, 42), (24, 54), (18, 54), (18, 59), (8, 59)]]:
        patches.polygon(poly, fill=(100, 121, 66, 175))
    for x, y in [(7, 13), (15, 9), (45, 38), (49, 46), (12, 50)]:
        patches.rectangle((x, y, x+4, y+3), fill=(134, 148, 83, 160))
    grass.save(out / 'weathered-floor.png')
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
        processing='Legacy source crops plus authored restrained pixel materials for stone, moss, paving overlays, coping, doors and heraldry. Nearest-neighbour scaling and padded atlas packing; no generated imagery.',
        palette='Quiet cel stone, moss, inset decks, closed iron doors and heraldry share one preloaded atlas; basal shadows stay in geometry.',
        atlas=dict(size=[SIZE, SIZE], slotSize=SLOT, padding=PAD, contentSize=CONTENT,
                   whitePatch=[496, 496, 8, 8], unusedSlots='Transparent'),
        materials=rows,
        outputs={name: dict(sha256=digest(out / name), size=list(Image.open(out / name).size))
                 for name in ('atlas.png', 'floor.png', 'weathered-floor.png')},
        regenerate='python3 tools/build_fdr_castle_assets.py',
    )
    (out / 'sources.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(f'Exported {out / "atlas.png"} and native 16px floor')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, default=ROOT / 'assets/Objects/Castle/FDR')
    build(parser.parse_args().out)
