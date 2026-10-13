"""Export the generated 4x4 portrait sheets as 80px RGBA cells and 320px atlases.

Run from any directory: python3 tools/art/import_portraits.py
The manifest retains the built-in image generation prompts and frame order.
Source artwork and transparency are preserved; nearest-neighbour sampling keeps
pixel edges crisp. The 80px cells display at 128px in the game for a chunky look.
"""
import json
from pathlib import Path

from PIL import Image


def main():
    folder = Path(__file__).resolve().parents[2] / 'assets' / 'portraits'
    manifest = json.loads((folder / 'manifest.json').read_text())
    cols, rows, size = (manifest[key] for key in ('columns', 'rows', 'frameSize'))
    for sheet, ids in manifest['sheets'].items():
        assert len(ids) == cols * rows, sheet
        with Image.open(folder / 'sources' / f'{sheet}.png') as source:
            source = source.convert('RGBA')
            # Generated source rows are slightly uneven. Measured boundaries
            # prevent the previous bust's shoulder edge leaking into a face.
            row_bounds = manifest.get('sourceRowBounds', {}).get(sheet,
                [round(y * source.height / rows) for y in range(rows + 1)])
            assert len(row_bounds) == rows + 1 and row_bounds[-1] == source.height, sheet
            atlas = Image.new('RGBA', (cols * size, rows * size), (0, 0, 0, 0))
            for i, character in enumerate(ids):
                x, y = i % cols, i // cols
                cell = source.crop((round(x * source.width / cols), row_bounds[y],
                                    round((x + 1) * source.width / cols), row_bounds[y + 1]))
                cell = cell.resize((size, size), Image.Resampling.NEAREST)
                cell.save(folder / f'{character}.png')
                atlas.paste(cell, (x * size, y * size))
            atlas.save(folder / f'{sheet}.png')


if __name__ == '__main__':
    main()
