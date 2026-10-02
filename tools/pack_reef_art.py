#!/usr/bin/env python3
"""Pack the eight generated coral candidates into game-sized atlas frames."""
from pathlib import Path
from PIL import Image
root = Path(__file__).resolve().parents[1]
source = Image.open(root / 'assets/Objects/Reef/reef_atlas.png').convert('RGBA')
packed = Image.new('RGBA', (64 * 8, 64))
for frame in range(8):
    x, y = frame % 4, frame // 4
    tile = source.crop((round(x * source.width / 4), round(y * source.height / 4),
                        round((x + 1) * source.width / 4), round((y + 1) * source.height / 4)))
    tile = tile.crop(tile.getbbox())
    tile.thumbnail((56, 56), Image.Resampling.NEAREST)
    packed.alpha_composite(tile, (frame * 64 + (64 - tile.width) // 2, (64 - tile.height) // 2))
packed.save(root / 'assets/Objects/Reef/coral.png')
