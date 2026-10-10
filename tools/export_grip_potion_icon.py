#!/usr/bin/env python3
"""Export the Potion of Grip icon (assets/Icons/Items/GripPotion.png).

Frame 12 of Potions.png (the round red flask with sparkles) with every red
pixel hue-shifted to the Rust totem's light (shrines.js rust_totem,
0xff8c2a), so the bottle reads as the totem's Grip boon. Glass, cork and
outline keep their colours. Requires Pillow.
"""
import colorsys
import os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets/Icons/Items/Potions.png')
OUT = os.path.join(ROOT, 'assets/Icons/Items/GripPotion.png')
FRAME, COLS, SIZE = 12, 5, 16
TARGET_HUE = colorsys.rgb_to_hsv(0xff / 255, 0x8c / 255, 0x2a / 255)[0]

sheet = Image.open(SRC).convert('RGBA')
x, y = (FRAME % COLS) * SIZE, (FRAME // COLS) * SIZE
icon = sheet.crop((x, y, x + SIZE, y + SIZE))
px = icon.load()
for j in range(SIZE):
    for i in range(SIZE):
        r, g, b, a = px[i, j]
        if not a:
            continue
        h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
        # Saturated reds only: the liquid and the red sparkles.
        if s > 0.45 and (h < 0.06 or h > 0.94):
            nr, ng, nb = colorsys.hsv_to_rgb(TARGET_HUE, s, min(1.0, v * 1.05))
            px[i, j] = (round(nr * 255), round(ng * 255), round(nb * 255), a)
icon.save(OUT)
print('wrote', os.path.relpath(OUT, ROOT))
