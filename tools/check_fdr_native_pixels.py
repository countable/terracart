#!/usr/bin/env python3
"""Compare exposed masonry with the native tile assembly at one screen pixel per source pixel."""
import json
import sys
from pathlib import Path
from PIL import Image, ImageChops

capture = Path(sys.argv[1])
image = Image.open(capture).convert('RGB')
assert image.width == 1260 and image.height in (640,641), f'Native-scale capture required, got {image.size}'
# The two panels share a world origin and framing; the left is the source PNG.
reference = image.crop((155, 166, 475, 454))
candidate = image.crop((785, 166, 1105, 454))
regions = {
    'southwest_tower_masonry': (58, 220, 102, 238),
    'southeast_tower_masonry': (218, 220, 262, 238),
    'keep_left_masonry': (122, 154, 135, 184),
    'keep_right_masonry': (185, 154, 198, 184),
}
results = {}
for name, box in regions.items():
    expected = list(reference.crop(box).getdata())
    actual = list(candidate.crop(box).getdata())
    same = sum(a == b for a, b in zip(expected, actual))
    results[name] = dict(box=box, exactPixels=same, pixels=len(expected), exactFraction=same/len(expected))
board = Image.new('RGB', (960,288))
board.paste(reference, (0,0))
board.paste(candidate, (320,0))
board.paste(ImageChops.difference(reference,candidate), (640,0))
board.resize((1920,576), Image.Resampling.NEAREST).save(capture.with_name(capture.stem+'-difference.png'))
print(json.dumps(results))
assert all(row['exactFraction'] >= .99 for row in results.values()), 'Native masonry registration differs; inspect difference image'
