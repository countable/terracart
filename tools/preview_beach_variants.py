#!/usr/bin/env python3
"""Render the beach draft table with cell grids and the landmark's true extent."""
import base64
import collections
import html
import json
import pathlib
import shutil
import sys

from PIL import Image
from preview_zone_variants import art_gallery, art_script, art_styles, background_at, sprite_symbols, sprite_cell

ROOT = pathlib.Path(__file__).resolve().parents[1]


def validate(data):
    policy = data['repeatPatternPolicy']
    for v in data['variants']:
        b = v['background']; w, h = b['repeatCells']
        assert 0 < w <= policy['maxCells'][0] and 0 < h <= policy['maxCells'][1]
        coords = [tuple(s['at']) for s in b['slots']]
        assert len(coords) == len(set(coords))
        assert all(0 <= x < w and 0 <= y < h for x, y in coords)
        counts = collections.Counter(s['material'] for s in b['slots'])
        assert abs(b['nominalDensity'] - len(coords) / (w*h)) < 1e-12
        assert b['materialDensity'] == {m: n/(w*h) for m, n in counts.items()}
        assert all(s['material'] in data['materials'] for s in b['slots'] + v['poi']['slots'])
        assert v['finds']['count'] == len(v['finds']['targets'])
        if v['poi'].get('art'):
            assert v['poi']['art']['extentCells'] == [3, 3]
            assert v['poi']['art']['interactionCount'] == 1
            assert set(map(tuple, v['poi']['footprint']['cells'])) == {(x,y) for x in range(-1,2) for y in range(-1,2)}
            assert not v['poi']['slots']
            assert (ROOT / v['poi']['art']['path']).is_file()


def ship_image(art, x, y):
    path = ROOT / art['path']
    with Image.open(path) as im:
        # Ignore the draft's faint alpha halo when fitting its visible hull to the extent.
        left, top, right, bottom = im.getchannel('A').point(lambda a: 255 if a >= 128 else 0).getbbox()
        width, height = im.size
    uri = 'data:image/png;base64,' + base64.b64encode(path.read_bytes()).decode()
    return f'<svg class="sprite-cell shipwreck" x="{x}" y="{y}" width="3" height="3" viewBox="{left} {top} {right-left} {bottom-top}" preserveAspectRatio="xMidYMid meet"><title>One shipwreck shrine · 3 × 3-cell maximum extent</title><image href="{uri}" width="{width}" height="{height}"/></svg>'


def diagram(v, data, motif=False):
    b, poi = v['background'], v['poi']
    w, h = b['repeatCells'] if motif else [11, 11]
    cx, cy = w//2, h//2
    prefix = f'beach-{v["id"]}-{int(motif)}'
    parts = [f'<svg role="img" aria-label="{html.escape(v["name"])} {"repeat motif" if motif else "shrine extent"}" viewBox="0 0 {w} {h}">',
             '<rect width="100%" height="100%" fill="#cfb982"/>', sprite_symbols(data['materials'], prefix)]
    reserved = set()
    if not motif:
        reserved = set(map(tuple, poi.get('footprint', {}).get('cells', [[0,0]])))
        reserved.update(tuple(s['at']) for s in poi['slots'])
        reserved.update(tuple(c) for c in poi.get('footprint', {}).get('approach', {}).get('clearCells', []))
    for y in range(h):
        for x in range(w):
            if (x-cx, y-cy) in reserved:
                continue
            gx, gy = (x,y) if motif else (x+b['poiOrigin']['cell'][0]-cx, y+b['poiOrigin']['cell'][1]-cy)
            material = background_at(v, gx, gy)
            if material:
                color = data['materials'][material]['color']
                parts.append(f'<rect class="geometry-cell" x="{x+.1}" y="{y+.1}" width=".8" height=".8" fill="{color}"><title>{material}</title></rect>')
                parts.append(sprite_cell(prefix, material, x+.1, y+.1, .8))
    if not motif:
        for slot in poi['slots']:
            x,y=slot['at'];parts.append(sprite_cell(prefix,slot['material'],cx+x+.1,cy+y+.1,.8))
        if poi.get('art'):
            parts.append(ship_image(poi['art'],cx-1,cy-1))
            parts.append(f'<rect class="extent" x="{cx-1}" y="{cy-1}" width="3" height="3" fill="none" stroke="#fff2b1" stroke-width=".06" stroke-dasharray=".18 .12"><title>3 × 3 reserved extent; one daily reward</title></rect>')
            parts.append(f'<path d="M {cx+.5} {cy+2.9} v -.7 m -.2 .2 l .2 -.2 .2 .2" stroke="#355f59" stroke-width=".12" fill="none"><title>Clear landward approach</title></path>')
        else:
            parts.append(f'<circle cx="{cx+.5}" cy="{cy+.5}" r=".35" fill="#fff5c9" stroke="#705c3e" stroke-width=".06"><title>Existing daily shrine anchor</title></circle>')
    parts.append('<g class="cell-grid" stroke="#775b35" stroke-opacity=".3" stroke-width=".025">')
    parts.extend(f'<path d="M {x} 0 V {h}"/>' for x in range(w+1))
    parts.extend(f'<path d="M 0 {y} H {w}"/>' for y in range(h+1))
    parts.append('</g></svg>')
    return ''.join(parts)


def render(out):
    source = ROOT / 'docs/data/beach-zone-variants.draft.json'
    data = json.loads(source.read_text())
    validate(data)
    out.mkdir(parents=True, exist_ok=True)
    cards = []
    for v in data['variants']:
        b, finds, guards = v['background'], v['finds'], v['guards']
        mix = ', '.join(f'{100*n:.2f}% {k}' for k,n in b['materialDensity'].items())
        guard = 'none' if guards['mode']=='none' else f'{guards["count"]} {guards["kind"]} at the find'
        fauna = ', '.join(f'nearest {quota[0]}–{quota[1]} {k}' for k,quota in v['attracts'].items()) or 'no affinity'
        size=' × '.join(map(str,b['repeatCells']))
        cards.append(f'''<article id="{v['id']}"><small>BEACH · DRAFT</small><h2>{html.escape(v['name'])}</h2>
<p><b>{size}-cell repeat · {b['nominalDensity']*100:.2f}% background fill</b><br>{mix}</p>
<div class="visual"><figure>{diagram(v,data)}<figcaption>Shrine in an 11 × 11-cell sample</figcaption></figure><figure>{diagram(v,data,True)}<figcaption>One {size} repeat</figcaption></figure></div>
<p>{html.escape(v['atmosphere'])}</p><ul><li>Finds: {finds['count']} {finds['material']}</li><li>Guards: {guard}</li><li>Fauna: {fauna}</li></ul></article>''')
    candidates=''.join(f'<li><b>{html.escape(a["name"])}</b>: '+(f'<a href="{a["url"]}">source pack</a>. {html.escape(a["notes"])}' if a.get('url') else html.escape(a['interaction']))+'</li>' for a in data['artCandidates'])
    css='''*{box-sizing:border-box}body{background:#15252c;color:#e9e6d5;font:16px/1.6 system-ui;max-width:1250px;margin:32px auto;padding:0 20px}h1{font-size:36px;line-height:1.15}a{color:#8ddddb}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,350px),1fr));gap:20px}article{padding:18px;border:1px solid #49626b;border-radius:12px;background:#20353c}svg{width:100%;display:block}.visual{display:grid;grid-template-columns:2fr 1fr;gap:12px;align-items:start}figure{margin:0}figcaption,small{font-size:12px;color:#b9c7c6}li{margin:8px 0}.shipwreck image{image-rendering:pixelated}.scale-check{display:flex;flex-wrap:wrap;align-items:start;gap:24px}.scale-check img{object-fit:contain;image-rendering:pixelated;background:#cfb982}body:has(#show-grid:not(:checked)) .cell-grid{display:none}'''
    ship_art=next(v['poi']['art'] for v in data['variants'] if v['poi'].get('art'))
    ship=ship_art['path']
    scale_checks=''.join(f'<figure><svg style="width:{px}px;height:{px}px;background:#cfb982" viewBox="0 0 3 3" role="img" aria-label="Shipwreck at {px} pixels">{ship_image(ship_art,0,0)}</svg><figcaption>{px} px</figcaption></figure>' for px in [48,72])
    page=f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Beach zone drafts</title><style>{css}{art_styles()}</style></head><body>
<h1>Three beach zones</h1><p><b>Draft · not active in-game.</b> Prefer 6 × 6 repeats, allow up to 8 × 8, and use smaller rectangles where they suit the pattern. Sand defines the beach; directly adjoining parkland may join its landward edge.</p>
<p><a href="beach-zone-variants.draft.json">Design table</a> · <a href="index.html">Other zones</a></p>
<label class="art-switch"><input id="show-art" type="checkbox" checked> Show game art</label> <label><input id="show-grid" type="checkbox" checked> Show cell grid</label>
<p>Water is toward the top; land is toward the bottom. Pirate Cove has one shipwreck shrine with a 3 × 3-cell maximum extent, one interaction, and one daily gift. Its dashed boundary reserves the whole extent; the arrow marks its landward approach. Finds and guards are listed, not drawn.</p>
<main class="cards">{''.join(cards)}</main>
<h2>Shipwreck at map size</h2><p>Read the silhouette at small size. These are 48 px and 72 px previews of the same draft asset; its world extent stays 3 × 3 cells. The final runtime sprite needs registration and a sizing pass.</p><div class="scale-check">{scale_checks}</div>
<h2>Art to enrich these beaches</h2><p>Keep every standing piece tied to an interaction. These candidates replace existing material seats or use the shrine's single reward; they add no free-standing decoration or extra loot.</p><ul>{candidates}</ul>
<p>The shipwreck is newly generated draft art. Existing shell colours can vary without adding pickups; salvage props need item and map art to agree before activation. External packs are research candidates, not purchased or imported assets.</p>
{art_gallery(data['materials'],'Existing beach material art')}
<p>Preserve the single daily tide stream and its waterline seats. Keep roses on vegetated landward ground. Whole-ship placement, beach ownership and runtime integration remain implementation work.</p>{art_script()}</body></html>'''
    (out/'beach-drafts.html').write_text(page)
    shutil.copy2(ROOT/ship,out/'shipwreck-shrine-draft.png')
    shutil.copy2(source, out/'beach-zone-variants.draft.json')
    print(f'Validated and rendered {len(cards)} beach drafts')


if __name__=='__main__':
    render(pathlib.Path(sys.argv[1]) if len(sys.argv)>1 else pathlib.Path('/tmp/zone-variants-preview'))
