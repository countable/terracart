#!/usr/bin/env python3
"""Build the shared building material atlas from the generated source sheets.

Sources: extra_assets/inactive/assets/Objects/BuildingMaterials/source/materials-gen-{a,b}.png, each a
3x2 grid of 512px swatches generated in the style of the cottage references.
Output: reference-materials-v3.png, a 4x3 grid of seamless 96px tiles. Cell
order is BuildingLowPoly.MATERIAL_CELLS. Each tile is drawn 1:1 by the renderer,
so texel density is decided here, not by a downsample in the browser.

A periodic axis is cropped to whole pattern repeats; a free axis (plaster,
rubble, straw) wraps by cross-fading one band into the opposite edge.
"""
import os
import numpy as np
from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), '..', 'assets', 'Objects', 'BuildingMaterials')
SOURCE = os.path.join(os.path.dirname(__file__), '..', 'extra_assets', 'inactive', 'assets', 'Objects', 'BuildingMaterials', 'source')
TILE = 96
TRIM = 8  # generated cells carry a faint gutter line
FREE_REPEAT = {'flagstone': 2}  # tile repeats per 96px edge

# name, sheet, col, row, x repeats per tile (None = free axis), y repeats, colours
CELLS = [
    ('clay', 'a', 0, 0, 12, 'auto', 12),
    ('slate', 'a', 1, 0, 11, 'auto', 10),
    ('thatch', 'a', 2, 0, None, 9, 12),
    ('shingle', 'b', 0, 1, 6, 'auto', 12),
    ('glazed', 'b', 1, 1, 9, 'auto', 12),
    ('plaster', 'a', 0, 1, None, None, 8),
    ('boards', 'a', 1, 1, 8, None, 12),
    ('rubble', 'a', 2, 1, None, None, 12),
    ('brick', 'b', 0, 0, 3, 'auto', 12),
    ('clapboard', 'b', 1, 0, None, 12, 8),
    ('flagstone', 'b', 2, 0, None, None, 10),
    ('moss', 'b', 2, 1, None, None, 12),
]


def period(gray, axis, lo, hi):
    """Strongest autocorrelation lag along one axis within [lo, hi)."""
    g = gray - gray.mean()
    f = np.fft.rfft(g, axis=axis)
    ac = np.fft.irfft(f * np.conj(f), n=g.shape[axis], axis=axis)
    ac = ac.mean(axis=1 - axis)
    lag = lo + int(np.argmax(ac[lo:hi]))
    # Refine to the mean spacing of several repeats, not one noisy peak.
    n = max(1, (g.shape[axis] - 1) // lag)
    best = lag
    for k in range(n, 0, -1):
        span = int(np.argmax(ac[lag * k - 6:lag * k + 7])) + lag * k - 6
        if ac[span] > 0.5 * ac[lag]:
            best = span / k
            break
    return best


def wrap_free(img, axis, length):
    """Crop `length` along axis and fade the overflow band into the start."""
    a = np.asarray(img, dtype=np.float32)
    band = int(length * 0.18)
    a = np.moveaxis(a, axis, 0)
    out = a[:length].copy()
    for i in range(band):
        t = i / band
        out[i] = a[length + i] * (1 - t) + a[i] * t
    return np.moveaxis(out, 0, axis)


def build(name, sheet, col, row, rx, ry, colours, sheets):
    src = sheets[sheet]
    w, h = src.size[0] // 3, src.size[1] // 2
    cell = src.crop((col * w + TRIM, row * h + TRIM, (col + 1) * w - TRIM, (row + 1) * h - TRIM))
    a = np.asarray(cell, dtype=np.float32)
    gray = a.mean(axis=2)
    size = a.shape[1]
    px = period(gray, 1, 24, size // 2) if rx else None
    py = period(gray, 0, 24, size // 2) if ry not in (None,) else None
    # A periodic axis holds exactly its requested repeats; tiling in source
    # space first when the swatch has fewer. A free axis wraps most of it.
    def periodic(arr, axis, lag, reps):
        # Skip one repeat: generated swatches cut their first course short.
        start = int(round(lag)) if arr.shape[axis] >= 3 * lag else 0
        whole = int((arr.shape[axis] - start) // lag)
        seg = np.take(arr, range(start, start + int(round(whole * lag))), axis=axis)
        need = int(round(lag * reps))
        out = seg
        while out.shape[axis] < need:
            out = np.concatenate([out, seg], axis=axis)
        return np.take(out, range(need), axis=axis)
    arr = periodic(a, 1, px, rx) if px else wrap_free(a, 1, int(size / 1.2))
    if py and ry == 'auto':
        ry = max(1, round((px * rx) / py))  # keep the swatch's aspect
    arr = periodic(arr, 0, py, ry) if py else wrap_free(arr, 0, int(arr.shape[0] / 1.2))
    # Free swatches with very large features repeat at a smaller size.
    size_out = TILE // FREE_REPEAT.get(name, 1)
    small = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8)).resize((size_out, size_out), Image.BOX)
    full = Image.new('RGB', (TILE, TILE))
    for y in range(0, TILE, size_out):
        for x in range(0, TILE, size_out):
            full.paste(small, (x, y))
    # Posterise to a small ramp so clusters stay crisp at 1:1.
    full = full.quantize(colors=colours, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).convert('RGB')
    return full, (px, py)


def main():
    sheets = {k: Image.open(os.path.join(SOURCE, f'materials-gen-{k}.png')).convert('RGB') for k in 'ab'}
    atlas = Image.new('RGB', (TILE * 4, TILE * 3))
    for i, spec in enumerate(CELLS):
        tile, periods = build(*spec, sheets)
        atlas.paste(tile, ((i % 4) * TILE, (i // 4) * TILE))
        print(f'{spec[0]:10s} period {periods}')
    atlas.save(os.path.join(ROOT, 'reference-materials-v3.png'), optimize=True)


if __name__ == '__main__':
    main()
