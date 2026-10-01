"""Seat PixelSerial's Old Man frames in the game's 48px NPC cells, without repainting.
Usage: python3 tools/art/import_orrin.py /path/to/old_man.png
Source rows: idle front/left/right/back, then walking front/left/right/back.
"""
from pathlib import Path
import sys
from PIL import Image
source = Image.open(sys.argv[1]).convert('RGBA')
assert source.size == (128, 256), source.size
out = Path(__file__).resolve().parents[2] / 'assets/NPC'
for action, offset in [('idle', 0), ('walk', 4)]:
    sheet = Image.new('RGBA', (192, 192))
    for row, source_row in enumerate([0, 3, 1, 2]):
        for col in range(4):
            frame = source.crop((col * 32, (source_row + offset) * 32, (col + 1) * 32, (source_row + offset + 1) * 32))
            # The source feet end at y=31; citizens stand at y=32.
            sheet.paste(frame, (col * 48 + 8, row * 48 + 1))
    sheet.save(out / f'Orrin_old_man_{action}.png')
