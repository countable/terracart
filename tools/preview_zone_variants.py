#!/usr/bin/env python3
"""Render the review table. No game world generation is invoked.
Usage: python3 tools/preview_zone_variants.py [table.json] [output-directory]
"""
import collections
import hashlib
import html
import json
import pathlib
import sys


def cycle(material, bx, by):
    return material['cycle'][(bx + by) % len(material['cycle'])] if isinstance(material, dict) else material


def hash_unit(variant, x, y, lane):
    # A representative stable preview seed, not the game's future hash API.
    digest = hashlib.sha256(f'preview|{variant}|{x}|{y}|{lane}'.encode()).digest()
    return int.from_bytes(digest[:4], 'big') / 2**32


def background_at(v, x, y):
    b = v['background']
    if b['type'] == 'seeded_scatter':
        if hash_unit(v['id'], x, y, 'occupancy') >= b['nominalDensity']:
            return None
        u = hash_unit(v['id'], x, y, 'material') * b['nominalDensity']
        for material, density in b['materialDensity'].items():
            u -= density
            if u < 0:
                return material
        return next(reversed(b['materialDensity']))
    if b['type'] == 'line_grid':
        step = b['spacingCells']
        horizontal, vertical = y % step == 0, x % step == 0
        if horizontal and vertical:
            return b['intersectionMaterial']
        if horizontal:
            return b['horizontalMaterial']
        if vertical:
            return b['verticalMaterial']
        if b.get('plotCenters') and x % step == step // 2 and y % step == step // 2:
            return cycle(b['plotCenters']['material'], x // step, y // step)
        return None
    w, h = b['repeatCells']
    for slot in b['slots']:
        if slot['at'] == [x % w, y % h]:
            return cycle(slot['material'], x // w, y // h)
    return None


def validate(d):
    ids = [v['id'] for v in d['variants']]
    assert len(ids) == len(set(ids))
    for v in d['variants']:
        b = v['background']
        assert abs(sum(b['materialDensity'].values()) - b['nominalDensity']) < 1e-9
        assert set(b['materialDensity']) <= d['materials'].keys()
        coords = [tuple(s['at']) for s in v['poi']['slots']]
        assert len(coords) == len(set(coords)) and (0, 0) not in coords
        assert all(s['material'] in d['materials'] for s in v['poi']['slots'])
        assert v['finds']['material'] in d['materials']
        assert len(v['finds']['targets']) in ([1] if v['finds']['rarity'] == 'rare' else [2, 3])
        if v['zone'] == 'tar':
            assert v['guards']['mode'] == 'none'
        if b['type'] == 'line_grid':
            step = b['spacingCells']
            assert all(background_at(v, x, 0) for x in range(step * 3 + 1))
            assert all(background_at(v, 0, y) for y in range(step * 3 + 1))
        # Derive coverage over a full four-cycle tile for deterministic motifs.
        if b['type'] != 'seeded_scatter':
            period = b.get('spacingCells', b.get('repeatCells', [10])[0]) * 4
            counted = collections.Counter(background_at(v, x, y) for x in range(period) for y in range(period))
            for material, density in b['materialDensity'].items():
                assert abs(counted[material] / period**2 - density) < 1e-9, (v['id'], material)


def svg_for(v, d, detail=False):
    b = v['background']
    side = 9 if detail else (b['spacingCells'] * 3 + 1 if b['type'] == 'line_grid' else 24)
    unit = 10
    center = side // 2
    parts = [f'<svg role="img" aria-label="{html.escape(v["name"])} {"POI pattern" if detail else "background and POI"}" viewBox="0 0 {side*unit} {side*unit}">', f'<rect width="100%" height="100%" fill="#172820"/>']
    if not detail:
        parts.append('<g class="background">')
        for y in range(side):
            for x in range(side):
                material = background_at(v, x, y)
                if material:
                    color = d['materials'][material]['color']
                    gap = 0 if b['type'] == 'line_grid' and (x % b['spacingCells'] == 0 or y % b['spacingCells'] == 0) else 1
                    parts.append(f'<rect x="{x*unit+gap}" y="{y*unit+gap}" width="{unit-2*gap}" height="{unit-2*gap}" fill="{color}"><title>{material}</title></rect>')
        parts.append('</g>')
    parts.append('<g class="poi-layer">')
    if not detail:
        parts.append(f'<rect x="{(center-3)*unit}" y="{(center-3)*unit}" width="70" height="70" fill="#172820" stroke="#d5b263" stroke-dasharray="3 3" stroke-width=".7"/>')
    for s in v['poi']['slots']:
        x, y = s['at']; color = d['materials'][s['material']]['color']
        parts.append(f'<rect x="{(center+x)*unit+1}" y="{(center+y)*unit+1}" width="8" height="8" fill="{color}"><title>POI: {s["material"]} ({x}, {y})</title></rect>')
    cx = cy = center * unit + unit / 2
    parts.append(f'<circle cx="{cx}" cy="{cy}" r="4" fill="#fff6ca" stroke="#171b12" stroke-width=".8"><title>POI / settled chest</title></circle><path d="M {cx-2.5} {cy} h 5 M {cx} {cy-2.5} v 5" stroke="#33291c" stroke-width="1"/>')
    parts.append('</g></svg>')
    return ''.join(parts)


def render(d, out):
    validate(d)
    out.mkdir(parents=True, exist_ok=True)
    cards = []
    for v in d['variants']:
        b = v['background']
        mix = ', '.join(f'{n*100:.2f}'.rstrip('0').rstrip('.') + f'% {m}' for m,n in b['materialDensity'].items())
        mode = {'line_grid':'3 × 3 plots · continuous lines', 'seeded_scatter':'Seeded scatter · no repeating tile', 'repeat_motif':'Repeating cell pattern'}[b['type']]
        guard = v['guards']; guard_text = 'None' if guard['mode'] == 'none' else (f'{guard["count"]} {guard["kind"]} at the find' if guard['mode']=='guard_find' else 'Ghosts on tombstone interaction')
        cards.append(f'''<article id="{v['id']}"><header><small>{v['zone']} · {mode}</small><h2>{v['name']}</h2></header><p class="mix"><b>{b['nominalDensity']*100:.2f}% {'expected' if b['type']=='seeded_scatter' else 'nominal'} coverage</b><br>{mix}</p><div class="visual"><figure>{svg_for(v,d)}<figcaption>Background + POI arrangement</figcaption></figure><figure class="detail">{svg_for(v,d,True)}<figcaption>POI close-up<br>● marked center · 1 cell = 7 m</figcaption></figure></div><p>{v['atmosphere']}</p><dl><dt>POI</dt><dd>{v['poi']['id'].replace('_',' ')}</dd><dt>Finds</dt><dd>{len(v['finds']['targets'])} {v['finds']['rarity']} · {v['finds']['material']}</dd><dt>Connection</dt><dd>{v['connection']['shape'].replace('_',' ')}</dd><dt>Guards</dt><dd>{guard_text}</dd></dl></article>''')
    legend = ''.join(f'<span><i style="background:{m["color"]}"></i>{name}</span>' for name,m in d['materials'].items())
    page = '''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Zone variants · pattern review</title><style>
*{box-sizing:border-box}body{background:#101a15;color:#e5ecdf;font:16px system-ui;margin:32px auto;max-width:1420px;padding:0 24px}h1{font-size:34px}p{line-height:1.6}small,figcaption{font-size:12px;color:#b4c6b4}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,540px),1fr));gap:24px}article,.coverage{background:#1b2a21;padding:24px;border:1px solid #334a3a;border-radius:14px}article h2{margin:8px 0 0}article .mix{min-height:60px}.visual{display:grid;grid-template-columns:2fr 1fr;gap:16px;align-items:center}figure{margin:0}svg{width:100%;display:block}figcaption{margin-top:8px}.legend{display:flex;flex-wrap:wrap;gap:14px;margin:24px 0}.legend i{display:inline-block;width:12px;height:12px;margin-right:6px}a{color:#95d7d1}h2{font-size:23px}dl{display:grid;grid-template-columns:95px 1fr;gap:7px;font-size:14px}dt{color:#a8bbaa}dd{margin:0}.controls{display:flex;gap:24px;position:sticky;top:0;background:#101a15ed;padding:16px 0;z-index:1}.coverage{display:grid;grid-template-columns:1fr 1fr;gap:24px}.coverage svg{max-height:250px}body:has(#show-poi:not(:checked)) figure:not(.detail) .poi-layer{display:none}body:has(#show-bg:not(:checked)) .background{display:none}@media(max-width:640px){.coverage{grid-template-columns:1fr}.visual{grid-template-columns:2fr 1fr}body{padding:0 12px}}</style></head><body>'''
    counts = collections.Counter(v['zone'] for v in d['variants'])
    page += f'<h1>{len(d["variants"])} zone variants</h1><p>Design for review · {counts["grove"]} groves, {counts["stones"]} churchyards, {counts["tar"]} tar yards. These definitions are not yet connected to live world generation.</p><p><a href="zone-variants.json">Complete JSON table</a> · <a href="zone-variants.md">Placement contract and summary</a></p>'
    page += '''<section class="coverage"><div><h2>Cover the union</h2><p><b>Influence footprint ∪ associated park footprint ∪ its placement fringe.</b> The fringe includes the full 30 m placement reach, beyond the 12–20 m painted band. Count overlap once; apply the existing spawn restrictions afterward.</p><p>Without an associated park, use the influence footprint alone. Nearby unrelated parks do not expand the zone. Special finds remain one set per anchor.</p></div><svg viewBox="0 0 420 230" role="img" aria-label="Diagram of the union of influence area and park with fringe"><rect x="25" y="35" width="250" height="160" rx="28" fill="#749762" fill-opacity=".4" stroke="#a2c483" stroke-dasharray="5 4"/><rect x="48" y="58" width="204" height="114" rx="8" fill="#426e44"/><circle cx="285" cy="118" r="90" fill="#679fac" fill-opacity=".4" stroke="#8ac9da"/><circle cx="285" cy="118" r="5" fill="#fff6ca"/><g fill="#fff" font-size="14" font-family="system-ui"><text x="98" y="117">Park footprint</text><text x="40" y="25">30 m placement fringe</text><text x="270" y="104">Influence</text><text x="297" y="136">POI</text><text x="98" y="218">Schematic · not to scale</text></g></svg></section>'''
    page += '<div class="legend">'+legend+'</div><p>Backgrounds are representative unclipped samples. Gold boxes show space reserved for the actual POI pattern; the light circle with a cross is the POI point. Close-ups use exact declared offsets. Finds, guards and connection routes are listed but not drawn. Obstacles and real zone boundaries will clip placement. Grid lines are unbroken except where POI space or an ineligible cell requires clearance.</p><div class="controls"><label><input id="show-poi" type="checkbox" checked> Show POI in background</label><label><input id="show-bg" type="checkbox" checked> Show background</label></div><main class="cards">'+''.join(cards)+'</main></body></html>'
    (out/'index.html').write_text(page)
    (out/'zone-variants.json').write_text(json.dumps(d,indent=2)+'\n')
    print(f'Validated and rendered {len(d["variants"])} variants: {dict(counts)}')


if __name__ == '__main__':
    source = pathlib.Path(sys.argv[1]) if len(sys.argv)>1 else pathlib.Path(__file__).resolve().parents[1]/'docs/zone-variants.json'
    output = pathlib.Path(sys.argv[2]) if len(sys.argv)>2 else pathlib.Path('/tmp/zone-variants-preview')
    render(json.loads(source.read_text()), output)
