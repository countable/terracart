#!/usr/bin/env python3
"""Pack the approved building materials into one sheet.

Sources (not shipped): extra_assets/inactive/assets/Objects/BuildingMaterials/source/pixel-tileset-v3.png
(the user's pixel tileset: plaster, timber, brick and stone walls; slate roof),
source/painterly-tileset-v1.png (red tile roof) and reference-materials-v3.png
(the generated seamless atlas: fish-scale clay and thatch, tinted to the role
colour at runtime). Output: approved-materials-v1.png, read by
BuildingLowPoly.tilesetSheet. Each crop is copied 1:1 with a 2px gutter; the
table it prints is SHEET_SRC's rectangles, so rerun this and paste the table
whenever a crop moves. Keep the two in step: approved_materials.test.js checks
every rectangle lies inside the sheet.
"""
import os
from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(__file__), '..', 'assets', 'Objects', 'BuildingMaterials')
SOURCE = os.path.join(os.path.dirname(__file__), '..', 'extra_assets', 'inactive', 'assets', 'Objects', 'BuildingMaterials', 'source')
SRC = {
    'px': os.path.join(SOURCE, 'pixel-tileset-v3.png'),
    'paint': os.path.join(SOURCE, 'painterly-tileset-v1.png'),
    'atlas': os.path.join(ROOT, 'reference-materials-v3.png'),
}
# Pixel tileset storey bands (y0, y1): the facade rows the wall crops sit in.
BANDS = {'top': (167, 247), 'mid': (247, 322), 'bot': (322, 399)}
GUTTER = 2
# One shelf per wall material: window, plain and door crops. ('px', band, x0, x1)
WALLS = [
    ('plaster', [('window', 'top', 212, 317), ('plain', 'mid', 170, 300), ('door', 'bot', 215, 320)]),
    ('timber', [('wall', 'mid', 0, 130), ('door', 'bot', 55, 160)]),  # window and plain share one crop
    ('brick', [('window', 'bot', 400, 500), ('plain', 'mid', 410, 540), ('door', 'bot', 465, 575)]),
    ('stone', [('window', 'top', 625, 715), ('plain', 'mid', 605, 715), ('door', 'bot', 625, 705)]),
]
# Roof crops: (name, source, box).
ROOFS = [
    ('clay', 'atlas', (0, 0, 96, 96)),
    ('thatch', 'atlas', (192, 0, 288, 96)),
    ('slate', 'px', (100, 527, 396, 596)),
    ('redtile', 'paint', (195, 240, 380, 385)),
]

# Authored against B2's approved building concepts. These surfaces are pure
# periodic fills; facade timbers, brass openings and emblems stay in celSheet.
# Five flat colours per cell, no resampling, lighting gradient or pixel noise.
STEAMPUNK_RAMPS = {
    'copper': ('#55352d', '#85503a', '#b46c40', '#d18b50', '#e9b76d'),
    'verdigris': ('#304948', '#46665e', '#638779', '#84a18a', '#b0b998'),
    'blueSlate': ('#283e4c', '#3d5869', '#54788a', '#7898a2', '#a6b9b8'),
    'violet': ('#443849', '#62506d', '#806b8c', '#a18aa6', '#c1adb9'),
    'red': ('#532e2c', '#813c33', '#a9533b', '#c4744d', '#dc9b65'),
    'plum': ('#463138', '#67434c', '#875a65', '#a7757a', '#c59895'),
    'strawGreen': ('#4e5038', '#71734e', '#969663', '#b6b17b', '#d0c79b'),
    'cream': ('#a59170', '#b8a680', '#cfbd96', '#decca6', '#e9d9b7'),
    'boards': ('#49362b', '#6d4b32', '#916644', '#ae8056', '#c69b69'),
    'smithStone': ('#393e40', '#515655', '#6a6c63', '#858575', '#a0a08c'),
}


def build_steampunk_cells():
    """96px periodic cells at the existing atlas's 6–12 texel course density."""
    cells = {}
    for name, p in STEAMPUNK_RAMPS.items():
        im = Image.new('RGBA', (96, 96), p[2])
        d = ImageDraw.Draw(im)
        if name == 'cream':
            # Quiet plaster: broad flat field; no pre-baked structural seams.
            for x, y in [(14, 18), (52, 37), (76, 73), (25, 81)]:
                d.rectangle((x, y, x + 3, y + 1), fill=p[3])
                d.rectangle((x + 2, y + 2, x + 5, y + 2), fill=p[1])
            d.rectangle((49, 63, 52, 64), fill=p[4])
            d.rectangle((80, 14, 82, 14), fill=p[0])
        elif name == 'boards':
            for x in range(0, 96, 12):
                d.rectangle((x, 0, x + 1, 95), fill=p[0])
                d.line((x + 2, 0, x + 2, 95), fill=p[4])
                for y in range(-48, 96, 48):
                    yy = y + (24 if (x // 12) % 2 else 0)
                    d.rectangle((x + 3, yy, x + 11, yy + 1), fill=p[1])
                    d.line((x + 6, yy + 12, x + 6, yy + 22), fill=p[3])
        elif name == 'verdigris':
            # Standing seams repeat every 24px; restrained copper-like patina.
            for x in range(0, 96, 24):
                d.rectangle((x, 0, x + 1, 95), fill=p[0])
                d.rectangle((x + 2, 0, x + 3, 95), fill=p[4])
                d.rectangle((x + 4, 0, x + 5, 95), fill=p[1])
                for y in range(0, 96, 32):
                    d.line((x + 6, y + 31, x + 23, y + 31), fill=p[1])
                    d.rectangle((x + 8, y + 4, x + 11, y + 5), fill=p[3])
        else:
            stone = name == 'smithStone'
            bw, bh = (24, 12) if stone else (16, 12)
            # Running bond wraps both axes: even row count and full tile widths.
            for row, y in enumerate(range(0, 96, bh)):
                for x in range(-bw, 96, bw):
                    xx = x + (bw // 2 if row % 2 else 0)
                    d.rectangle((xx, y, xx + bw - 1, y + bh - 1), fill=p[0])
                    d.rectangle((xx + 1, y + 1, xx + bw - 2, y + bh - 3), fill=p[2])
                    d.line((xx + 2, y + 1, xx + bw - 3, y + 1), fill=p[3])
                    d.line((xx + 2, y + 2, xx + 5, y + 2), fill=p[4])
                    d.line((xx + 1, y + bh - 3, xx + bw - 2, y + bh - 3), fill=p[1])
                    if not stone:
                        # Two-step shingle heel, broad enough to survive scale.
                        d.line((xx + 2, y + bh - 2, xx + bw - 3, y + bh - 2), fill=p[1])
        cells[name] = im
    return cells


def main():
    images = {k: Image.open(p).convert('RGBA') for k, p in SRC.items()}
    crops = []  # (label, image)
    shelves = []  # lists of crop indices
    for name, parts in WALLS:
        shelf = []
        for kind, band, x0, x1 in parts:
            y0, y1 = BANDS[band]
            crops.append((f'{name}.{kind}', images['px'].crop((x0, y0, x1, y1))))
            shelf.append(len(crops) - 1)
        shelves.append(shelf)
    shelf = []
    for name, src, box in ROOFS:
        crops.append((f'roof.{name}', images[src].crop(box)))
        shelf.append(len(crops) - 1)
    shelves.append(shelf)
    # Append shelves without moving a single legacy rectangle. No new row may
    # exceed the legacy sheet width (683), keeping excluded roles' UVs stable.
    kit = build_steampunk_cells()
    for name in ['cream','boards','smithStone']:
        kit[name] = Image.open(os.path.join(SOURCE, 'b4-facade', name + '.png')).convert('RGBA')
    names = list(kit)
    for start in range(0, len(names), 6):
        shelf = []
        for name in names[start:start + 6]:
            crops.append((f'steampunk.{name}', kit[name]))
            shelf.append(len(crops) - 1)
        shelves.append(shelf)
    # B4 facade-only additions stay on new shelves. Do not add white plaster
    # to STEAMPUNK_RAMPS: that would change the preceding shelf arrangement.
    white = Image.open(os.path.join(SOURCE, 'b4-facade', 'whitePlaster.png')).convert('RGBA')
    crops.append(('steampunk.whitePlaster', white))
    shelves.append([len(crops) - 1])
    shelf = []
    for name in ['houseDoor', 'porthole', 'shopDoor', 'shopWindow',
                 'smithDoor', 'cog', 'shop', 'trader', 'supply', 'seed',
                 'pet', 'potion', 'relic', 'book', 'timberWindow', 'brassWindow']:
        part = Image.open(os.path.join(SOURCE, 'b4-facade', name + '.png')).convert('RGBA')
        crops.append((f'parts.{name}', part))
        shelf.append(len(crops) - 1)
    shelves.append(shelf)
    shelf = []
    for name in ['blueSlate','verdigris','strawGreen','violet','red','plum']:
        part = Image.open(os.path.join(SOURCE, 'b4-facade', 'awning' + name + '.png')).convert('RGBA')
        crops.append((f'parts.awning{name}', part))
        shelf.append(len(crops) - 1)
    shelves.append(shelf)
    # B4d alternatives append after every existing crop: legacy/roof pixels and
    # coordinates stay byte-identical. Only processed game derivatives ship.
    for variant in ('A', 'B'):
        for names in (['whitePlaster','orangeBrick','boards','smithStone'],
                      ['houseDoor','shopDoor','smithDoor','timberWindow','brassWindow','shopWindow']):
            shelf = []
            for name in names:
                part = Image.open(os.path.join(SOURCE, 'b4d-pp', variant + name + '.png')).convert('RGBA')
                crops.append((f'facade.{variant}{name}', part))
                shelf.append(len(crops) - 1)
            shelves.append(shelf)
    # Shelf packing: each shelf is one row, as tall as its tallest crop.
    placed, y = {}, GUTTER
    width = 0
    for shelf in shelves:
        x, tallest = GUTTER, 0
        for i in shelf:
            w, h = crops[i][1].size
            placed[i] = (x, y, x + w, y + h)
            x += w + GUTTER
            tallest = max(tallest, h)
        width = max(width, x)
        y += tallest + GUTTER
    sheet = Image.new('RGBA', (width, y), (0, 0, 0, 0))
    for i, (label, im) in enumerate(crops):
        sheet.paste(im, placed[i][:2])
    out = os.path.join(ROOT, 'approved-materials-v1.png')
    sheet.save(out, optimize=True)
    print(f'{os.path.relpath(out)}: {sheet.size[0]}x{sheet.size[1]}')
    for i, (label, _) in enumerate(crops):
        print(f'  {label}: {list(placed[i])}')


if __name__ == '__main__':
    main()
