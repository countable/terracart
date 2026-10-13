#!/usr/bin/env python3
"""Export the Scroll of Moonbeam icon (assets/Icons/Items/MoonbeamScroll.png).

The Scroll of Thunder's parchment (ThunderScroll.png) with its bolt wiped
back to blank page and a gold crescent stamped on the left, throwing a pale
blue beam (white core) across to the right edge. Requires Pillow.
"""
import os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets/Icons/Items/ThunderScroll.png')
OUT = os.path.join(ROOT, 'assets/Icons/Items/MoonbeamScroll.png')
PAGE = (255, 255, 255, 255)
BOLT = (105, 70, 51, 255)
INK = {'Y': (240, 200, 72, 255), 'y': (196, 150, 46, 255),
       'B': (110, 176, 255, 255), 'W': (206, 234, 255, 255)}
# Stamped over the page, top-left at (6, 4).
STAMP = [
    '.Yy.....',
    'Yy..BBBB',
    'Yy.BWWWW',
    '.Yy.BBBB',
]

icon = Image.open(SRC).convert('RGBA')
px = icon.load()
for j in range(16):
    for i in range(16):
        if px[i, j] == BOLT:
            px[i, j] = PAGE
for j, row in enumerate(STAMP):
    for i, ch in enumerate(row):
        if ch in INK:
            px[6 + i, 4 + j] = INK[ch]
icon.save(OUT)
print('wrote', os.path.relpath(OUT, ROOT))
