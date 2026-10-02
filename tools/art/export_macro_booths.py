#!/usr/bin/env python3
"""Slice the generated 3x3 sheet into chunky, alpha-preserving runtime frames."""
from pathlib import Path
import sys
from PIL import Image

KINDS = ['inn', 'chapel', 'apothecary', 'scriptorium', 'guildhall', 'curio', 'sundries', 'training', 'scholar']
source = Image.open(sys.argv[1]).convert('RGBA')
out = Path(__file__).resolve().parents[2] / 'assets/Objects/Generated'
sheet = Image.new('RGBA', (240, 240))
for i, kind in enumerate(KINDS):
    col, row = i % 3, i // 3
    crop = source.crop((round(col * source.width / 3), round(row * source.height / 3), round((col + 1) * source.width / 3), round((row + 1) * source.height / 3)))
    crop = crop.crop(crop.getchannel('A').point(lambda a: 255 if a >= 128 else 0).getbbox())
    # Author at 34x35 or smaller, then double pixels: the runtime scale is .54.
    factor = min(34 / crop.width, 35 / crop.height)
    small = crop.resize((round(crop.width * factor), round(crop.height * factor)), Image.Resampling.NEAREST)
    art = small.resize((small.width * 2, small.height * 2), Image.Resampling.NEAREST)
    frame = Image.new('RGBA', (80, 80))
    frame.paste(art, (12 + (68 - art.width) // 2, 70 - art.height))
    frame.save(out / f'{kind}_simple.png')
    sheet.paste(frame, (col * 80, row * 80))
sheet.save(out / 'macro_booths_simple.png')
print('Exported nine 80x80 frames and the 240x240 sprite sheet.')
