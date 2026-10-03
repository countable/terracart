#!/usr/bin/env python3
"""Rebuild coral frames from the native-size zone object atlas."""
from pathlib import Path
from PIL import Image
root = Path(__file__).resolve().parents[1]
source = Image.open(root / 'assets/Objects/ZoneVariants/objects-24.png')
packed = Image.new('RGBA', (24 * 8, 24))
for frame in range(8):
    packed.paste(source.crop((frame * 24, 72, (frame + 1) * 24, 96)), (frame * 24, 0))
packed.save(root / 'assets/Objects/Reef/coral.png')
