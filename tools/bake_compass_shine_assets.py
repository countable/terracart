#!/usr/bin/env python3
"""Bake responsive production shine from each original chassis slice.

The game preserves the source layer ordering, CSS geometry and edge masks.
Only this offline build performs luminance processing, glow or pixel readback.
Run: python3 tools/bake_compass_shine_assets.py
"""
from pathlib import Path
from PIL import Image
from bake_compass_shine import bake

root = Path(__file__).resolve().parents[1]
art = root / 'assets/ui/compass'
out = art / 'shine'
out.mkdir(exist_ok=True)
for name in ['reference-carving-tile', 'reference-header', 'reference-footer', 'reference-shoulders', 'reference-join']:
    source = art / (name + '.webp')
    target = out / (name + '.webp')
    bake(source.read_bytes(), target)
    original = Image.open(source).convert('RGBA')
    glow = Image.open(target).convert('RGBA')
    # Retain holes in a source slice as well as its luminance-dependent emission.
    from PIL import ImageChops
    glow.putalpha(ImageChops.multiply(glow.getchannel('A'), original.getchannel('A')))
    glow.save(target, lossless=True)
Image.open(root / 'tools/compass-shine-baked/overhead-beam.png').save(out / 'overhead-beam.png')
