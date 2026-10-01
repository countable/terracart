#!/usr/bin/env python3
"""Generate the ground coin-stack sprites (assets/Objects/Approved/coin_*.png).

Every tier is built from one 9px coin so the stacks read as counted coins:
a bright top face with a glint, then per coin a reeded edge band and a dark
seam. Bigger tiers add stacks, loose coins and a sparkle. Colours are the
shared metallic ramp of Icons/coin.png. Render.COIN_PILES owns the amount
bands and display widths; each width must equal the PNG this writes.

    python3 tools/gen_coin_piles.py            # write the PNGs
    python3 tools/gen_coin_piles.py --preview  # also write a zoomed sheet
"""
import os
import sys
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets', 'Objects', 'Approved')

O = (3, 21, 20, 255)        # outline / seams
D = (22, 62, 62, 255)       # edge shadow
M = (44, 98, 98, 255)       # edge mid
L = (118, 172, 166, 255)    # face
B = (178, 224, 216, 255)    # face highlight
G = (236, 250, 244, 255)    # glint

W = 9  # coin width in pixels


def top_face():
    # A disc seen from above at a slant: widest across the middle, and its
    # lower rim drawn as a curve across the edge band below.
    return [
        '.OOOOOOO.',
        'OBGBBBLMO',
        'OLBBLLLMO',
        'MOLLLLMOD',
        'OMOOOOODO',
    ]


def edge_rows(last):
    # Reeded edge band, lit from the left, then the seam under the coin.
    return ['OBMLMLMDO', '.OOOOOOO.' if last else 'OOOOOOOOO']


def stack(n):
    """n coins; n == 1 is a single coin lying flat."""
    rows = top_face()
    for k in range(1, n):
        rows += edge_rows(k == n - 1)
    if n == 1:
        rows[-1] = '.OOOOOOO.'
    return rows


SPARKLE = {'small': [(0, 0)], 'cross': [(0, 0), (-1, 0), (1, 0), (0, -1), (0, 1)]}

# (name, parts, sparkle). Parts are (coins in the stack, x,
# bottom y); they paint back to front by bottom y, so lower = in front.
TIERS = [
    ('coin_single_ground', [(1, 0, 0)], None),
    ('coin_pile_2',        [(1, 0, 0), (1, 3, 2)], None),
    ('coin_pile_3',        [(2, 0, 0), (1, 4, 2)], None),
    ('coin_pile_4',        [(3, 0, 0), (1, 5, 2)], None),
    ('coin_pile_5',        [(3, 0, 0), (2, 5, 2)], None),
    ('coin_pile_6_10',     [(4, 0, 0), (3, 6, 1), (1, 2, 3)], 'small'),
    ('coin_pile_11_25',    [(5, 3, 0), (4, 0, 2), (3, 8, 2), (1, 4, 4)], 'cross'),
    ('coin_pile_26_50',    [(6, 4, 0), (5, 0, 2), (5, 9, 2), (2, 4, 3)], 'cross'),
    ('coin_pile_51',       [(6, 5, 0), (5, 0, 1), (5, 11, 1), (3, 2, 4), (3, 9, 4),
                            (1, 6, 5)], 'cross'),
]


def paint(canvas, rows, x, y):
    for j, row in enumerate(rows):
        for i, ch in enumerate(row):
            if ch == '.':
                continue
            canvas.putpixel((x + i, y + j), {'O': O, 'D': D, 'M': M, 'L': L, 'B': B, 'G': G}[ch])


def build(parts, sparkle):
    big = Image.new('RGBA', (64, 64), (0, 0, 0, 0))
    base = 50
    for n, x, by in sorted(parts, key=lambda p: p[2]):
        rows = stack(n)
        paint(big, rows, 8 + x, base + by - len(rows))
    box = big.getbbox()
    if sparkle:
        # Over the top-right of the tallest stack's face.
        n, x, by = max(parts, key=lambda p: p[0])
        top = base + by - len(stack(n))
        cx, cy = 8 + x + W - 1, top + 1
        for dx, dy in SPARKLE[sparkle]:
            big.putpixel((cx + dx, cy + dy), G)
        box = big.getbbox()
    art = big.crop(box)
    side = max(art.size)
    out = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    out.alpha_composite(art, ((side - art.width) // 2, (side - art.height + 1) // 2))
    return out


def main():
    images = []
    for name, parts, sparkle in TIERS:
        im = build(parts, sparkle)
        im.save(os.path.join(OUT, name + '.png'))
        images.append((name, im))
        print(f'{name}: {im.width}x{im.height}')
    if '--preview' in sys.argv:
        z = 8
        w = sum(im.width + 4 for _, im in images) + 4
        sheet = Image.new('RGBA', (w, 32), (89, 99, 56, 255))
        x = 4
        for _, im in images:
            sheet.alpha_composite(im, (x, 32 - im.height - 4))
            x += im.width + 4
        dest = sys.argv[sys.argv.index('--preview') + 1] if len(sys.argv) > sys.argv.index('--preview') + 1 else 'coin_preview.png'
        sheet.resize((w * z, 32 * z), Image.NEAREST).save(dest)


if __name__ == '__main__':
    main()
