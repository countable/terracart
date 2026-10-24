#!/usr/bin/env python3
"""Adapt existing bush colours to RA foliage; preserve every source alpha/frame."""
from pathlib import Path
import hashlib
import json
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'extra_assets/inactive/assets/Objects/CelProps/bushes.png'
REFERENCE = ROOT / 'assets/ArtTrials/RogueObjects/tree-wide-a.png'
OUT = ROOT / 'assets/ArtTrials/RogueObjects'
# Actual dark-to-light canopy colours in the installed reference-selected RA tree.
RAMP = [(51, 47, 35), (102, 102, 61), (127, 127, 70), (153, 153, 76), (178, 178, 71), (204, 204, 71)]
STRENGTH = .80

def luminance(rgb):
    return sum(c * w for c, w in zip(rgb, (.2126, .7152, .0722)))

def recolour(pixel):
    *rgb, alpha = pixel
    if not alpha:
        return pixel
    # Interpolate the existing shading into the RA olive ramp. Retain a little
    # source colour so separate leaf clusters remain readable, without neon green.
    value = luminance(rgb)
    lower, upper = RAMP[0], RAMP[-1]
    for a, b in zip(RAMP, RAMP[1:]):
        if value <= luminance(b):
            lower, upper = a, b
            break
    t = max(0, min(1, (value - luminance(lower)) / (luminance(upper) - luminance(lower))))
    target = [a + (b - a) * t for a, b in zip(lower, upper)]
    return tuple(round(a * (1 - STRENGTH) + b * STRENGTH) for a, b in zip(rgb, target)) + (alpha,)

source = Image.open(SOURCE).convert('RGBA')
reference_colours = set(Image.open(REFERENCE).convert('RGB').getdata())
assert all(c in reference_colours for c in RAMP), 'RA source ramp has changed'
assert source.size == (192, 24), 'Keep the eight original 24px frames'
result = Image.new('RGBA', source.size)
result.putdata([recolour(p) for p in source.getdata()])
assert result.getchannel('A').tobytes() == source.getchannel('A').tobytes()
result.save(OUT / 'bushes-olive.png')
(OUT / 'bushes-olive.json').write_text(json.dumps({
    'source': str(SOURCE.relative_to(ROOT)),
    'sourceSHA256': hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
    'paletteReference': str(REFERENCE.relative_to(ROOT)),
    'paletteReferenceSHA256': hashlib.sha256(REFERENCE.read_bytes()).hexdigest(),
    'ramp': RAMP, 'strength': STRENGTH, 'frameSize': [24, 24], 'frames': 8,
    'method': 'Luminance-interpolated RA foliage ramp, 80% blend; original alpha and geometry unchanged. Berry overlays are added by the existing startup texture baker.'
}, indent=2) + '\n')
print('Exported RA olive bushes; all source alpha and eight frames preserved')
# Ordinary wild shrubs now use the separately selected Pixel Plains silhouette.
# Keep it distinct from berry canopies, applying only this same RA colour ramp.
SHRUB_SOURCE = ROOT / 'assets/Objects/SelectedFlora/selected_shrub.png'
shrub = Image.open(SHRUB_SOURCE).convert('RGBA')
assert shrub.size == (16, 16)
shrub_result = Image.new('RGBA', shrub.size)
shrub_result.putdata([recolour(p) for p in shrub.getdata()])
assert shrub_result.getchannel('A').tobytes() == shrub.getchannel('A').tobytes()
shrub_result.save(OUT / 'shrub-olive.png')
(OUT / 'shrub-olive.json').write_text(json.dumps({
    'source': str(SHRUB_SOURCE.relative_to(ROOT)),
    'sourceSHA256': hashlib.sha256(SHRUB_SOURCE.read_bytes()).hexdigest(),
    'sourceProvenance': 'assets/Objects/SelectedFlora/manifest.json: selected_shrub / ALT-0769, Pixel Plains Harvest Summer',
    'paletteReference': str(REFERENCE.relative_to(ROOT)),
    'paletteReferenceSHA256': hashlib.sha256(REFERENCE.read_bytes()).hexdigest(),
    'ramp': RAMP, 'strength': STRENGTH, 'frameSize': [16, 16], 'frames': 1,
    'method': 'Same RA foliage ramp as berry canopies; original silhouette and alpha unchanged.'
}, indent=2) + '\n')
print('Exported ordinary RA olive shrub; separate Pixel Plains silhouette preserved')
