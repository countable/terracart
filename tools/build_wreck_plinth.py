#!/usr/bin/env python3
"""Build the wreck atlas from the approved Foundation v2 option B materials."""
from pathlib import Path
import argparse
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--ground-style', choices=('quiet', 'buried', 'worn'), default='quiet')
parser.add_argument('--output', type=Path, default=ROOT / 'assets/Objects/BuildingMaterials/wreck-plinth.png')
args = parser.parse_args()
OUT = args.output
walls = Image.open(ROOT / 'assets/Objects/Castle/FDR/atlas.png').convert('RGBA')


def random_values(seed):
    """The study's JavaScript LCG, for matching its caps and rubble scatter."""
    while True:
        seed = (seed * 1664525 + 1013904223) & 0xffffffff
        yield seed / 4294967296


stone = walls.crop((392, 8, 504, 120)).resize((16, 16), Image.Resampling.NEAREST)
cap = Image.new('RGBA', (16, 16), '#b6aa93')
draw = ImageDraw.Draw(cap)
rng = random_values(223)
for i in range(17):
    x, y = int(next(rng) * 16), int(next(rng) * 16)
    draw.rectangle((x, y, x + i % 2, y), fill='#a99d86' if i % 3 else '#c8bca5')

atlas = Image.new('RGBA', (512, 512), '#706758')
# Existing mesh UVs address wall faces in the left half and caps in the right.
for y in range(0, 128, 16):
    for x in range(0, 512, 16):
        atlas.paste(stone if x < 256 else cap, (x, y))

# Keep the study's 3D masonry, but simplify the ground into broad tarnish
# and a sparse scatter of chips from the same warm stone palette. No tiled
# grain, red brick flecks, or tiny alternating highlights remain.
floor = Image.new('RGBA', (240, 180), (95, 87, 74, 128))
draw = ImageDraw.Draw(floor)
rng = random_values(87)
for i in range(18):
    x, y = int(next(rng) * 240), int(next(rng) * 180)
    w, h = 10 + int(next(rng) * 22), 6 + int(next(rng) * 12)
    # Grime and worn areas expose more of the underlying terrain. Keep the
    # variation broad and low contrast, with no fine noise or hard patch edges.
    shade = (87, 79, 67, 100) if i % 2 else (98, 90, 76, 60 + i % 4 * 10)
    draw.polygon([(x-w, y-h//2), (x-w//2, y-h), (x+w//2, y-h),
                  (x+w, y), (x+w//2, y+h), (x-w//2, y+h)], fill=shade)
floor = floor.filter(ImageFilter.GaussianBlur(2))
# Adjust only the background before compositing the unchanged stone scatter.
r, g, b, alpha = floor.split()
floor = Image.merge('RGBA', (
    r.point(lambda v: round(v * .8)),
    g.point(lambda v: round(v * .8)),
    b.point(lambda v: round(v * .8)),
    alpha.point(lambda v: min(255, round(v * 1.2))),
))

# These are restrained mixtures of the wall cap, mortar and brown ground.
# Untouched ground stays 154/255 (60%); the broad worn patches are translucent.
styles = {
    'quiet': (90, 2, 4, [(151, 139, 117, 185), (130, 118, 99, 170), (100, 90, 75, 150)]),
    'buried': (65, 3, 6, [(132, 121, 102, 145), (120, 109, 92, 145), (105, 95, 80, 145)]),
    'worn': (35, 2, 5, [(145, 133, 112, 165), (126, 115, 96, 155), (104, 94, 79, 145)]),
}
count, lo, hi, palette = styles[args.ground_style]
rng = random_values(126)
scatter = Image.new('RGBA', floor.size)
draw = ImageDraw.Draw(scatter)
for i in range(count):
    x, y = int(next(rng) * 240), int(next(rng) * 180)
    w = lo + int(next(rng) * (hi-lo+1))
    h = max(2, int(w * .7))
    draw.polygon([(x+1,y), (x+w-1,y), (x+w,y+1), (x+w-1,y+h),
                  (x,y+h), (x,y+1)], fill=palette[i % len(palette)])
floor.alpha_composite(scatter)

# The study's L footprint bounds map to the existing 384px floor UV region.
# Its outline remains geometry-owned; the atlas supplies only the material.
floor = floor.crop((46, 40, 191, 137)).resize((384, 384), Image.Resampling.NEAREST)
atlas.paste(floor, (0, 128))
# Shared border mask: one repeating strip replaces individual dash geometry.
# White RGB lets the renderer tint the border independently of the wall palette.
dash = Image.new('RGBA', (66, 8), (255, 255, 255, 0))
draw = ImageDraw.Draw(dash)
for start, end in [(0, 7), (13, 18), (26, 34), (39, 45), (52, 56)]:
    draw.rectangle((start + 1, 0, end, 7), fill='white')
# Left padding repeats pixel63 (transparent); right repeats pixel0 (opaque).
draw.rectangle((65, 0, 65, 7), fill='white')
atlas.paste(dash, (399, 136))
ImageDraw.Draw(atlas).rectangle((508, 124, 511, 127), fill='white')
atlas.save(OUT)
print(OUT)
