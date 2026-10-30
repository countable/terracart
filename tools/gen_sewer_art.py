#!/usr/bin/env python3
"""Paint the sewer's generated art: the sewer rat sheet (assets/Enemy/Rat.png,
48x64 — three 16px frames by four rows: down, left, right, up) and the two
sewer fish icons (assets/Icons/Fish/Sewer/*.png, 16x16), in the mini monsters
idiom: a dark outline, three body tones, pink ears, nose and tail. Edit the
pixel maps below and rerun; never retouch the PNGs by hand.
  python3 tools/gen_sewer_art.py [preview.png]
"""
from PIL import Image
import sys
from pathlib import Path
ROOT = str(Path(__file__).resolve().parents[1])
T = (0,0,0,0)
RAT = {'.':T, 'o':(31,26,22,255), 'd':(92,58,40,255), 'm':(139,90,60,255), 'l':(181,122,82,255),
       'p':(227,160,160,255), 'w':(245,240,230,255), 'k':(31,26,22,255), 'n':(214,120,130,255)}
def paint(rows, pal, w=16, h=16):
    im = Image.new('RGBA', (w, h), T); px = im.load()
    for y, row in enumerate(rows):
        assert len(row) == w, (y, row)
        for x, ch in enumerate(row): px[x, y] = pal[ch]
    return im
def setpx(rows, pts, ch):
    rows = [list(r) for r in rows]
    for (y, x) in pts: rows[y][x] = ch
    return [''.join(r) for r in rows]

# ---- RAT, side view facing RIGHT (body rows 4-13) ----
side_body = [
"................",
"................",
"................",
"................",
"..........oo.oo.",
".........opoopo.",
"......ooooddddo.",
"....oommmmmmmmmo",
"...ommlllmmmwkmo",
"..ommmllmmmmmmmo",
".ommmmmmmmmmmmno",
".omlllmmmmmmddo.",
".oddddddddddoo..",
"................",
"................",
"................",
]
side_legs = ["..oo.oo..oo.oo..", ".oo...oo.oo...oo", "...oo.oo.oo.oo.."]
side_tails = [[(12,0),(13,0),(14,1),(14,2)], [(11,0),(12,0),(13,0),(14,0)], [(12,0),(13,1),(13,2),(13,3)]]
right = []
for f in range(3):
    rows = list(side_body); rows[13] = side_legs[f]
    rows = setpx(rows, side_tails[f], 'n')
    right.append(paint(rows, RAT))
left = [im.transpose(Image.FLIP_LEFT_RIGHT) for im in right]

# ---- RAT, facing DOWN (front) ----
down_body = [
"................",
"................",
"....oo....oo....",
"...opdo..odpo...",
"...oddooooddo...",
"....ommmmmmo....",
"...omwkmmwkmo...",
"...ommmnnmmmo...",
"..ommmmmmmmmmo..",
"..ommmmmmmmmmo..",
".ommmmmmmmmmmmo.",
".ommmllmmmmmmmo.",
".odmmmmmmmmmmdo.",
"..oddddddddddo..",
"................",
"................",
]
down_legs = ["...oo.oo.oo.oo..", "..oo...oo..oo.o.", "....oo.oo.oo.oo."]
down_tails = [[(13,15),(14,15),(15,14)], [(12,15),(13,15),(14,15)], [(14,15),(15,15),(15,14)]]
down = []
for f in range(3):
    rows = list(down_body); rows[14] = down_legs[f]
    rows = setpx(rows, down_tails[f], 'n')
    down.append(paint(rows, RAT))

# ---- RAT, facing UP (back) ----
up_body = [
"................",
"................",
"....oo....oo....",
"...opdo..odpo...",
"...oddooooddo...",
"....ommmmmmo....",
"...ommlllmmmo...",
"...ommlllmmmo...",
"..ommmmmmmmmmo..",
"..ommmmmmmmmmo..",
".ommmmmmmmmmmmo.",
".ommmmmmmmmmmmo.",
".odmmmmmmmmmmdo.",
"..odddddnddddo..",
"................",
"................",
]
up_legs = ["...oo.oo.oo.oo..", "..oo...oo..oo.o.", "....oo.oo.oo.oo."]
up_tails = [[(14,8),(15,8)], [(14,9),(15,10)], [(14,7),(15,6)]]
up = []
for f in range(3):
    rows = list(up_body); rows[14] = up_legs[f]
    rows = setpx(rows, up_tails[f], 'n')
    up.append(paint(rows, RAT))

sheet = Image.new('RGBA', (48, 64), T)
for r, frames in enumerate([down, left, right, up]):
    for c, im in enumerate(frames): sheet.paste(im, (c*16, r*16))
sheet.save(f'{ROOT}/assets/Enemy/Rat.png')

# ---- FISH ICONS (16x16, facing right) ----
CAVEFISH = {'.':T, 'o':(74,52,56,255), 'd':(176,138,138,255), 'm':(217,184,184,255), 'l':(241,222,222,255), 'f':(236,200,210,255)}
cavefish = [
"................",
"................",
"........oooo....",
".......offffo...",
"..o...offfffoo..",
".olo.olllllllo..",
".ollolllmmmmllo.",
"..olllllmmmmmlo.",
".ollolllmmmmllo.",
".olo.odddmmddo..",
"..o..oddddddo...",
"......oofffo....",
".......ooooo....",
"................",
"................",
"................",
]
paint(cavefish, CAVEFISH).save(f'{ROOT}/assets/Icons/Fish/Sewer/Blind Cavefish.png')
EEL = {'.':T, 'o':(20,26,20,255), 'd':(46,74,46,255), 'm':(78,122,58,255), 'l':(134,168,100,255), 'y':(232,208,96,255), 'k':(20,26,20,255)}
eel = [
"................",
"........ooooo...",
".......ommmmmo..",
"......ommykmmmo.",
"......ommmmmddo.",
".....ommlmddoo..",
"....ommlmddo....",
"...ommlmddo.....",
"..ommlmddo......",
".ommlmddo.......",
".ommddo.........",
".odddooo........",
"..odddddooo.....",
"...oodddddddo...",
".....ooooooo....",
"................",
]
paint(eel, EEL).save(f'{ROOT}/assets/Icons/Fish/Sewer/Sewer Eel.png')

# preview (optional)
if len(sys.argv) < 2: sys.exit(0)
S = 8
prev = Image.new('RGBA', (48*S + 40 + 2*16*S + 16, 64*S), (40,40,40,255))
prev.paste(sheet.resize((48*S, 64*S), Image.NEAREST), (0,0), sheet.resize((48*S, 64*S), Image.NEAREST))
for i, name in enumerate(['Blind Cavefish', 'Sewer Eel']):
    im = Image.open(f'{ROOT}/assets/Icons/Fish/Sewer/{name}.png').resize((16*S,16*S), Image.NEAREST)
    prev.paste(im, (48*S + 40 + i*(16*S+16), 0), im)
prev.save(sys.argv[1])
