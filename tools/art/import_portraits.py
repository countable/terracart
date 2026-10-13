"""Export the generated 4x4 portrait sheets as 128px cells and 512px atlases.

Run from any directory: python3 tools/art/import_portraits.py
The manifest retains the built-in image generation prompts and frame order.
Source artwork is preserved; nearest-neighbour sampling keeps pixel edges crisp.
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
            source = source.convert('RGB')
            atlas = Image.new('RGB', (cols * size, rows * size))
            for i, character in enumerate(ids):
                x, y = i % cols, i // cols
                cell = source.crop((round(x * source.width / cols), round(y * source.height / rows),
                                    round((x + 1) * source.width / cols), round((y + 1) * source.height / rows)))
                cell = cell.resize((size, size), Image.Resampling.NEAREST)
                cell.save(folder / f'{character}.png')
                atlas.paste(cell, (x * size, y * size))
            atlas.save(folder / f'{sheet}.png')


if __name__ == '__main__':
    main()
