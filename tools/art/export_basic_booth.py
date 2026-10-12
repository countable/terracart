#!/usr/bin/env python3
"""Export one generated basic booth in the macro-booth pixel scale.

All seven legacy produce-family slots deliberately share the same artwork.
Their indices remain available to product-family logic in loot.js.
"""
import argparse
from pathlib import Path

from PIL import Image


def export(source_path, destination):
    source = Image.open(source_path).convert('RGBA')
    source.putalpha(source.getchannel('A').point(lambda a: 255 if a >= 128 else 0))
    bounds = source.getbbox()
    if bounds is None:
        raise ValueError('The basic booth source is empty')
    source = source.crop(bounds)
    factor = min(34 / source.width, 35 / source.height)
    small = source.resize((round(source.width * factor), round(source.height * factor)), Image.Resampling.NEAREST)
    art = small.resize((small.width * 2, small.height * 2), Image.Resampling.NEAREST)
    frame = Image.new('RGBA', (80, 80))
    frame.paste(art, (12 + (68 - art.width) // 2, 70 - art.height))
    sheet = Image.new('RGBA', (560, 80))
    for index in range(7):
        sheet.paste(frame, (80 * index, 0))
    destination.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(destination)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[2] / 'assets/Objects/Generated/market_stand_simple.png')
    args = parser.parse_args()
    export(args.source, args.output)
