#!/usr/bin/env python3
"""Pack the approved building materials into one sheet.

Sources (not shipped): assets/Objects/BuildingMaterials/source/pixel-tileset-v3.png
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
from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), '..', 'assets', 'Objects', 'BuildingMaterials')
SRC = {
    'px': os.path.join(ROOT, 'source', 'pixel-tileset-v3.png'),
    'paint': os.path.join(ROOT, 'source', 'painterly-tileset-v1.png'),
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
