"""Draft underground cards for the shared zone viewer; never runtime placement."""
import base64
import collections
import html
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'docs/underground-zone-variants.draft.json'


def _image(material, x, y, unit, materials):
    row = materials[material]
    uri = 'data:image/png;base64,' + base64.b64encode((ROOT / row['path']).read_bytes()).decode()
    label = html.escape(material.replace('_', ' '))
    return (f'<g><title>{label} · proposed mechanic</title>'
            f'<rect class="geometry-cell" x="{x+1}" y="{y+1}" width="{unit-2}" height="{unit-2}" fill="{row["color"]}"/>'
            f'<image class="sprite-cell" href="{uri}" x="{x}" y="{y}" width="{unit}" height="{unit}"/></g>')


def _sample(row, data, helpers, detail=False):
    path = row['kind'] == 'path'
    width, height = ((9, 9) if detail else (12, 25) if path else (25, 25))
    unit = 10
    cx, cy = width // 2, height // 2
    prefix = 'underground-' + row['id'] + ('-detail' if detail else '-wide')
    parts = [f'<svg role="img" aria-label="{html.escape(row["name"])} proposed {"close-up" if detail else "pattern"}" viewBox="0 0 {width*unit} {height*unit}">',
             helpers['ground_pattern']('CAVE_FLOOR', prefix, unit),
             f'<rect width="100%" height="100%" fill="url(#{prefix})"/>']
    if path:
        motif_width, _ = row['motifCells']
        start = cx - motif_width // 2
        parts.append(f'<path d="M {cx*unit+unit/2} 0 V {height*unit}" stroke="#707668" stroke-opacity=".25" stroke-width="{10 if motif_width==3 else 20}"/>')
        parts.append(f'<path d="M {start*unit} 0 V {height*unit} M {(start+motif_width)*unit} 0 V {height*unit}" stroke="#a6b6a7" stroke-dasharray="2 3" stroke-opacity=".5"/>')
    parts.append('<g class="background">')
    mw, mh = row['motifCells']
    occupied = set()
    for y in range(height):
        for x in range(width):
            if path:
                rx = x - (cx - mw // 2)
                if not 0 <= rx < mw:
                    continue
                at = [rx, y % mh]
            else:
                # The centre and approach lanes take precedence over background slots.
                if abs(x-cx) <= 2 and abs(y-cy) <= 2 or x == cx or y == cy:
                    continue
                at = [x % mw, y % mh]
            for slot in row['slots']:
                if slot['at'] == at:
                    parts.append(_image(slot['material'], x*unit, y*unit, unit, data['previewMaterials']))
                    occupied.add((x,y))
    parts.append('</g>')
    if not path:
        parts.append('<g class="poi-layer">')
        if row['id'] == 'spring_cave':
            central = [(0,0,'cave_pool'),(-2,-1,'cave_shrooms'),(1,-2,'cave_shrooms'),(2,1,'stalagmite')]
        else:
            central = [(-2,-2,'rubble_pile'),(-1,-2,'barrel'),(2,-1,'barrel'),(-2,2,'rubble_pile')]
        for dx,dy,material in central:
            parts.append(_image(material,(cx+dx)*unit,(cy+dy)*unit,unit,data['previewMaterials']))
        parts.append(helpers['art_image']({'sheet':'chest','frames':[0]},f'class="sprite-cell" x="{(cx+1)*unit}" y="{(cy+1)*unit}" width="10" height="10"'))
        parts.append(f'<rect class="geometry-cell" x="{(cx+1)*unit+2}" y="{(cy+1)*unit+2}" width="6" height="6" fill="#e6c779"><title>Existing mirrored cache, only if one survives</title></rect>')
        parts.append('</g>')
    enemy = 'club_goblin' if row['id'] in ('goblin_warrens','warren_run') else 'cave_slime'
    if not path or row['id']=='warren_run':
        ex,ey = ((cx+3)*unit, (cy+2)*unit) if not path else ((cx-2)*unit,cy*unit)
        parts.append(helpers['creature_at'](enemy,ex,ey,unit,'Proposed depth-1 encounter seat; reallocated from existing budget'))
    parts.append(f'<path d="M 6 {height*unit-6} h 50" stroke="#e5ecdf"/><text x="6" y="{height*unit-10}" fill="#e5ecdf" font-size="5">35 m · 5 cells</text></svg>')
    return ''.join(parts)


def underground_section(helpers, out):
    data = json.loads(SOURCE.read_text())
    cards = {'nexus': [], 'path': []}
    for row in data['previewRows']:
        mw,mh = row['motifCells']
        assert 0 < mw <= 8 and 0 < mh <= 8
        assert len({tuple(s['at']) for s in row['slots']}) == len(row['slots'])
        for slot in row['slots']:
            assert 0 <= slot['at'][0] < mw and 0 <= slot['at'][1] < mh
            assert slot['material'] in data['previewMaterials']
        mix = collections.Counter(s['material'] for s in row['slots'])
        coverage = len(row['slots']) / (mw*mh) * 100
        mix_text = ', '.join(f'{count} {key.replace("_", " ")}' for key,count in mix.items())
        details = [('Source region / route',row['source']),('Depth','1–3 proposal; deeper floors retain ordinary caves.'),
                   ('Pattern',f'{mw} × {mh} cells; {mix_text}. Nominal occupancy before clipping and reserved approaches.'),
                   ('POI / rewards',row['poi']),('Connection',row['connection']),('Monsters',row['monsters']),
                   ('Lighting','Existing cave torches and player light. Additional glowing water or crystal art is not an enabled light source.'),
                   ('Fauna','No new surface fauna underground.'),
                   ('Art','Inspected unused Verdant Props sprites; existing chest and enemy art. Art and interactions are proposals.')]
        dl=''.join(f'<dt>{html.escape(k)}</dt><dd>{html.escape(v)}</dd>' for k,v in details)
        cap='Background + nexus arrangement' if row['kind']=='nexus' else 'Representative straight passage · not a live carved route'
        close='Nexus close-up' if row['kind']=='nexus' else 'Passage close-up'
        cards[row['kind']].append(f'<article id="underground-{row["id"]}"><header><small>Underground {row["kind"]} · draft · {mw} × {mh} motif</small><h2>{html.escape(row["name"])}</h2></header><p class="mix"><b>{coverage:.2f}% nominal motif occupancy</b><br>{html.escape(mix_text)}; nexus and encounter seats counted separately.</p><div class="visual"><figure>{_sample(row,data,helpers)}<figcaption>{cap}</figcaption></figure><figure class="detail">{_sample(row,data,helpers,True)}<figcaption>{close}<br>1 cell = 7 m</figcaption></figure></div><p>{html.escape(row["atmosphere"])}</p><dl>{dl}</dl></article>')
    # Keep the reviewed design alongside the preview without enabling it in runtime data.
    (out/'underground-zone-variants.draft.json').write_text(json.dumps(data,indent=2)+'\n')
    (out/'underground-art-license.txt').write_text((ROOT/'docs/art/underground-proposals/LICENSE.txt').read_text())
    checks=''.join(f'<li>{html.escape(item)}</li>' for item in data['checks'])
    return ('<section id="underground" data-view-panel hidden><h2>Underground · design proposals</h2>'
            '<nav class="page-nav" aria-label="Underground categories"><a href="#underground-nexus">Nexus (2)</a><a href="#underground-paths">Roads and paths (4)</a></nav>'
            '<p>Park POI regions become spring caves or goblin warrens. Public small roads and walking paths supply the connections. These six authored patterns use the same card format and art controls as the surface designs; they are not live cave generation.</p>'
            '<p><a href="underground-zone-variants.draft.json">Draft data and implementation contract</a> · <a href="underground-art-license.txt">Candidate art license</a></p>'
            '<details><summary>Placement, rewards and depth rules</summary><p>Walking paths already map to cave floor. Small-road passages require explicit carving beneath eligible minor, street and public service lines. Preserve stairs, water and building provenance, major-road boundaries and excluded access; reserve clear lanes before dressing.</p>'
            '<p>Regions keep stable surface POI identities at each depth, even when chest mirrors are pruned. Style at most one surviving mirror as the nexus cache, with existing tier rules. Finds, stores and encounter seats replace existing cave allocations. Junctions and tile fragments never mint another reward.</p>'
            '<p>Suggested spring : warren weights are 65 : 35 at depth 1, 40 : 60 at depth 2 and 25 : 75 at depth 3, before geographic affinities. Spring water refills a watering can through a proposed interaction; free healing is not part of this draft. Optional warren traps need a bypass and are not drawn as a repeating background slot.</p>'
            '<ul>'+checks+'</ul></details>'
            '<section id="underground-nexus"><h2>Underground nexus</h2><div class="cards">'+''.join(cards['nexus'])+'</div></section>'
            '<section id="underground-paths"><h2>Underground roads and paths</h2><div class="cards">'+''.join(cards['path'])+'</div></section></section>')
