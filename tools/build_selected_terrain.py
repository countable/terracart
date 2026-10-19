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
        crop = Image.open(ROOT/entry['source']).convert('RGBA').crop((x,y,x+w,y+h))
        assert crop.getchannel('A').getextrema() == (255,255)
        sheet.paste(crop,(entry['frame']*16,0))
    sheet.save(OUT/'selected-terrain.png')
if __name__ == '__main__': main()
