#!/usr/bin/env python3
"""Rebuild the approved native terrain atlas from its recorded source crops."""
import json
from pathlib import Path
from PIL import Image
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/selected-terrain'
def main():
    entries = json.loads((OUT/'sources.json').read_text())['entries']
    sheet = Image.new('RGBA', (16 * len(entries), 16))
    assert sorted(e['frame'] for e in entries) == list(range(len(entries)))
    for entry in entries:
        x,y,w,h = entry['crop']
        assert (w,h) == (16,16)
        source = Image.open(ROOT/entry['source']).convert('RGBA')
        crop = source.crop((x,y,x+w,y+h))
        if entry.get('recipe') == 'interleaved-slab':
            crop = Image.new('RGBA', (16,16))
            # Complete native slabs, with no scaling or painted replacement marks.
            if entry['variant'] == 0:
                crop.paste(source.crop((384,456,400,464)), (0,0))
                crop.paste(source.crop((368,448,376,456)), (0,8))
                crop.paste(source.crop((368,448,376,456)), (8,8))
            else:
                crop.paste(source.crop((352,448,360,464)), (0,0))
                crop.paste(source.crop((368,448,376,456)), (8,0))
                crop.paste(source.crop((368,448,376,456)), (8,8))
        if entry.get('underlay'):
            underlay = Image.new('RGBA', (16,16), entry['underlay'])
            underlay.alpha_composite(crop)
            crop = underlay
        if entry.get('palette'):
            def recolor(pixel):
                r,g,b,a = pixel
                light = round(r*.2126 + g*.7152 + b*.0722)
                if entry['palette'] == 'churchyard-purple':
                    return (round(101+light*.25), round(81+light*.20), round(116+light*.30), a)
                if entry['palette'] == 'tar-smooth-grey':
                    grey = round(93+light*.035)
                    return (grey, grey, grey, a)
                if entry['palette'] == 'cold-slate':
                    return (max(0,light-7), light, min(255,light+7), a)
                shift = {'warm-stone': (6,2,-8), 'moss-stone': (-5,2,-6), 'olive-stone': (-2,4,-8)}.get(entry['palette'])
                if shift:
                    return tuple(max(0,min(255,c+d)) for c,d in zip((r,g,b),shift)) + (a,)
                return (round(light*.55), round(light*.57), round(light*.60), a)
            crop.putdata([recolor(p) for p in crop.getdata()])
        assert crop.getchannel('A').getextrema() == (255,255)
        sheet.paste(crop,(entry['frame']*16,0))
    sheet.save(OUT/'selected-terrain.png')
if __name__ == '__main__': main()
