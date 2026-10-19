#!/usr/bin/env python3
"""Export the hand-drawn petnip and waystone sprites.

Both are 16px frames so they share the apparent pixel size of their map
neighbours (the Props.png wildplants and the rocks-16 stones). Petnip had
borrowed a recoloured long-grass tuft; waystones borrowed the plain rock.

  assets/Objects/Handmade/petnip.png    16x16, 1 frame
  assets/Objects/Handmade/waystone.png  32x16, frame 0 dormant, frame 1 lit

Run from the repository root: python3 tools/art/export_petnip_waystone.py
"""
from pathlib import Path
from PIL import Image

OUT = Path('assets/Objects/Handmade')

# Catnip: paired soft leaves on a square stem under a lilac flower spike.
# Outline and greens follow the Props.png wildplant palette.
PETNIP_PAL = {
    'o': '#0a2e3b', 'D': '#2f6b45', 'G': '#5f9e57', 'L': '#93c47a',
    'H': '#c4e39a', 'S': '#3f7a3c', 'P': '#c9a8e8', 'p': '#8a5cc0',
    'q': '#5a3a8e', 'W': '#f1e6ff',
}
PETNIP = """
.......oo.......
......oWPo......
.....oPWPpo.....
.....opPpqo.....
....oWPoPWPo....
....oPpSDpqo....
..oo.oopDoo.oo..
.oLGo.oSDo.oGLo.
.oHLGooSDooGLHo.
..oGLGDSDGGLGo..
...ooDGSDDGoo...
.ooLGoGSDoGLGoo.
oLHLGGDSDGGLHLGo
oGLGGDoSDoDGGLDo
.oDDoo.oDo.ooDo.
..oo....oo...oo.
"""

# A leaning standing stone with a carved spiral and a mossy footing; stone
# tones are the rocks-16 plain rock's. 'r' is the carved groove; the lit
# frame fills it with Lighting.KINDS.waystone's colour and warms its rim.
STONE_PAL = {
    'o': '#1a1932', '1': '#adb6c3', '2': '#8d99af', '3': '#6b7794',
    '4': '#5f6983', '5': '#474e6e', 'r': '#2c2f4a', 'g': '#5a6b3c',
    'm': '#7f9248',
}
WAYSTONE = """
................
........oo......
.......o11o.....
......o1112o....
....oo211122o...
....o3222334o...
...o23rrr234o...
...o23r22r34o...
...o2r2rr2r4o...
...o2r22r234o...
...o23rr2344o...
...om233r344o...
..ogm23333445o..
..oggm4444mmgo..
...ooooooooooo..
................
"""
RUNE_LIT = '#ffedb8'
RIM_LIT = '#f2c86a'


def rgba(hex_colour):
    return tuple(int(hex_colour[i:i + 2], 16) for i in (1, 3, 5)) + (255,)


def paint(grid, pal):
    im = Image.new('RGBA', (16, 16), (0, 0, 0, 0))
    for y, row in enumerate(grid.strip('\n').split('\n')):
        for x, ch in enumerate(row):
            if ch in pal:
                im.putpixel((x, y), rgba(pal[ch]))
    return im


def lit_waystone():
    rows = WAYSTONE.strip('\n').split('\n')
    im = paint(WAYSTONE, {**STONE_PAL, 'r': RUNE_LIT})
    rim = rgba(RIM_LIT)
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            if ch not in '12345':
                continue
            near = any(0 <= y + dy < 16 and 0 <= x + dx < 16 and rows[y + dy][x + dx] == 'r'
                       for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))
            if near:
                r, g, b, _ = im.getpixel((x, y))
                im.putpixel((x, y), ((r + rim[0]) // 2, (g + rim[1]) // 2, (b + rim[2]) // 2, 255))
    return im


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    paint(PETNIP, PETNIP_PAL).save(OUT / 'petnip.png', optimize=True)
    sheet = Image.new('RGBA', (32, 16), (0, 0, 0, 0))
    sheet.alpha_composite(paint(WAYSTONE, STONE_PAL), (0, 0))
    sheet.alpha_composite(lit_waystone(), (16, 0))
    sheet.save(OUT / 'waystone.png', optimize=True)


if __name__ == '__main__':
    main()
