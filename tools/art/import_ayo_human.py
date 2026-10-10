"""Bake Ayo's human-form sheets: Citizen_woman03 with white hair and slate clothes.
Usage: python3 tools/art/import_ayo_human.py
A stand-in until the reserved Super Retro World #2 is imported (assets/NPC/README.md).
Exact palette swaps only, so the outline, skin and shading clusters are untouched.
"""
from pathlib import Path
from PIL import Image

SWAP = {
    'cfaf49': 'eef0f2', 'a97950': 'b4bac6', '88644b': '868c9a',   # gold hair -> white
    '45876c': '6f7f9e', '2d5f4a': '444e6e', 'a4be9f': 'b9c4d8',   # green cloth -> slate
}
rgb = lambda h: tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))
SWAP = {rgb(k): rgb(v) for k, v in SWAP.items()}
npc = Path(__file__).resolve().parents[2] / 'assets/NPC'
for action in ('idle', 'walk'):
    im = Image.open(npc / f'Citizen_woman03_{action}.png').convert('RGBA')
    px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = px[x, y]
            if a and (r, g, b) in SWAP: px[x, y] = SWAP[(r, g, b)] + (a,)
    im.save(npc / f'Ayo_human_{action}.png', optimize=True)
