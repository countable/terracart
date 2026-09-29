#!/usr/bin/env python3
"""Render beach drafts with the same embedded game art as the live preview.
Usage: python3 tools/preview_beach_variants.py [output-directory]
"""
import html
import json
import pathlib
import shutil
import sys

from preview_zone_variants import art_gallery, art_script, art_styles, svg_for


def render(out):
    root = pathlib.Path(__file__).resolve().parents[1]
    data = json.loads((root / 'docs/beach-zone-variants.draft.json').read_text())
    out.mkdir(parents=True, exist_ok=True)
    cards = []
    for v in data['variants']:
        b, finds, guards = v['background'], v['finds'], v['guards']
        mix = ', '.join(f'{100*n:.2f}% {k}' for k, n in b['materialDensity'].items())
        guard = 'none' if guards['mode'] == 'none' else f'{guards["count"]} {guards["kind"]} at the find'
        fauna = ', '.join(f'{k} {chance*100:g}%' for k, chance in v['attracts'].items()) or 'no affinity'
        cards.append(f'''<article id="{v['id']}"><small>BEACH · DRAFT</small><h2>{html.escape(v['name'])}</h2>
<p>{mix}<br><b>{b['nominalDensity']*100:.2f}% ideal coverage</b></p>
<div class="visual">{svg_for(v,data)}{svg_for(v,data,True)}</div><p>{html.escape(v['atmosphere'])}</p>
<ul><li>Finds: {finds['count']} {finds['material']} · {finds['rarity']}</li><li>Guards: {guard}</li><li>Fauna: {fauna}</li></ul></article>''')
    css = '''*{box-sizing:border-box}body{background:#15252c;color:#e9e6d5;font:16px system-ui;max-width:1250px;margin:32px auto;padding:0 20px}h1{font-size:36px}p{line-height:1.6}a{color:#8ddddb}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,350px),1fr));gap:20px}article{padding:20px;border:1px solid #49626b;border-radius:12px;background:#20353c}svg{width:100%;display:block}.visual{display:grid;grid-template-columns:2fr 1fr;gap:12px;align-items:center}small{color:#b9c7c6}li{margin:8px 0;line-height:1.5}'''
    page = f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Beach zone drafts</title><style>{css}{art_styles()}</style></head><body>
<h1>Three beach zones</h1><p><b>Draft · not active in-game.</b> Sand defines its own zone and keeps its sandy ground. One beach variant spans that required sand footprint and optional directly adjoining parkland. Waterfront parks without sand stay ordinary parks. Patterns align along the shore and cover dry eligible ground.</p>
<p><a href="beach-zone-variants.draft.json">Declarative table</a> · <a href="beach-zone-variants.draft.md">Detection and placement contract</a> · <a href="index.html">Live zone previews</a></p>
<label class="art-switch"><input id="show-art" type="checkbox" checked> Show game art in patterns (off = colour geometry)</label>
{art_gallery(data['materials'], 'Beach material art')}
<p>Large diagrams show an ideal repeating pattern; small diagrams show decoration surrounding the POI (cross). Water is toward the top and land toward the bottom. Actual shore boundaries, tide reservations, vegetation and obstacles clip these patterns. Finds and guards are listed, not drawn. All three shell colours appear in the gallery; diagrams use one representative frame.</p>
<main class="cards">{''.join(cards)}</main><p>Shellwater grass and roses require vegetated landward ground. Daily tide pickups remain a single reserved shoreline stream; ordinary buried-X scatter is replaced within variant coverage. Beach POIs retain one daily grove gift. These drafts reuse shipped art; shoreline placement rules remain implementation work.</p>{art_script()}</body></html>'''
    (out / 'beach-drafts.html').write_text(page)
    for name in ['beach-zone-variants.draft.json', 'beach-zone-variants.draft.md']:
        shutil.copy2(root / 'docs' / name, out / name)
    print(f'Rendered {len(cards)} beach drafts with embedded art')


if __name__ == '__main__':
    render(pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else pathlib.Path('/tmp/zone-variants-preview'))
