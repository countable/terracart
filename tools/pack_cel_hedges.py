"""Pack the approved v3 foliage swatches onto the existing cardinal hedge grid.

This is atlas production: crop/nearest-neighbour composite approved canopy and
front-face pixels. No new foliage, shading or palette is painted here.
"""
import json
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/Objects/Hedges'
SOURCE = OUT / 'approved-props-v3.png'


def tile_patch(patch, size):
    result = Image.new('RGBA', size)
    for y in range(0, size[1], patch.height):
        for x in range(0, size[0], patch.width):
            result.paste(patch, (x, y))
    return result


def frame(sheet, index):
    x, y = index % 8 * 24, index // 8 * 24
    return sheet.crop((x, y, x + 24, y + 24))


def build():
    source = Image.open(SOURCE).convert('RGBA')
    # Exclude rounded isolated end caps: these swatches are inside the canopy.
    horizontal = frame(source, 32).crop((7, 11, 17, 23)).resize((10, 16), Image.Resampling.NEAREST)
    vertical = frame(source, 43).crop((6, 7, 18, 12))
    h_texture = tile_patch(horizontal, (24, 16))
    v_texture = tile_patch(vertical, (12, 24))
    # The same interior column/row on both ends removes texture resets at joins.
    h_texture.paste(h_texture.crop((0, 0, 1, 16)), (23, 0))
    v_texture.paste(v_texture.crop((0, 0, 12, 1)), (0, 23))
    metadata = json.loads((OUT / 'manifest.json').read_text())
    atlas = Image.new('RGBA', (24 * len(metadata['frames']), 24))
    tiles = {}
    for row in metadata['frames']:
        connections = row['connections']
        im = Image.new('RGBA', (24, 24))
        left, right = (0 if 'W' in connections else 6), (24 if 'E' in connections else 18)
        im.paste(h_texture.crop((left, 0, right, 16)), (left, 4))
        if 'N' in connections:
            im.paste(v_texture.crop((0, 0, 12, 6)), (6, 0))
        if 'S' in connections:
            im.paste(v_texture.crop((0, 12, 12, 24)), (6, 12))
        if not set(connections) & set('EW'):
            top = 0 if 'N' in connections else 4
            bottom = 24 if 'S' in connections else 14
            im.paste(v_texture.crop((0, top, 12, bottom)), (6, top))
        tiles[connections] = im
        im.save(OUT / (row['name'] + '.png'))
        atlas.paste(im, (row['frame'] * 24, 0))
    atlas.save(OUT / 'hedges-24.png')
    frame(source, 47).save(OUT / 'single.png')
    # Assert every potential cardinal pair shares the full RGBA edge exactly.
    for direction, opposite, edge, other in [
        ('E', 'W', (23, 0, 24, 24), (0, 0, 1, 24)),
        ('S', 'N', (0, 23, 24, 24), (0, 0, 24, 1)),
    ]:
        for a, im in tiles.items():
            for b, neighbour in tiles.items():
                if direction in a and opposite in b:
                    assert im.crop(edge).tobytes() == neighbour.crop(other).tobytes(), (a, b)
    # Inspect real tiled corners, T junctions and cross joins at native/zoom size.
    layout = [['ES', 'EW', 'ESW', 'EW', 'WS'], ['NS', None, 'NS', None, 'NS'],
              ['NES', 'EW', 'NESW', 'EW', 'NSW'], ['NS', None, 'NS', None, 'NS'],
              ['NE', 'EW', 'NEW', 'EW', 'NW']]
    preview = Image.new('RGBA', (120, 120), '#89856c')
    for y, row in enumerate(layout):
        for x, mask in enumerate(row):
            if mask:
                preview.alpha_composite(tiles[mask], (x * 24, y * 24))
    preview.resize((720, 720), Image.Resampling.NEAREST).save('/tmp/cel-hedge-joins.png')
    print('Packed 15 connected frames; all E/W and N/S RGBA joins match exactly.')


if __name__ == '__main__':
    build()
