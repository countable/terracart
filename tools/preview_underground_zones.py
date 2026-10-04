"""Draft underground cards for the shared zone viewer; never runtime placement."""
import base64
import collections
import functools
import html
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'docs/underground-zone-variants.draft.json'


@functools.lru_cache(maxsize=None)
def _quarry_material(variant_id, material):
    data = json.loads((ROOT/'docs/zone-variants.json').read_text())
    variant = next(row for row in data['variants'] if row['id'] == variant_id)
    return {**data['materials'][material], 'previewArt': {
        'sheet':'zone_objects', 'frames':variant['materialFrames'][material]}}


def _image(material, x, y, unit, materials, helpers):
    row = materials[material]
    if 'gameMaterial' in row or 'quarryVariant' in row:
        definition = (_quarry_material(row['quarryVariant'],row['quarryMaterial']) if 'quarryVariant' in row else dict(row['gameMaterial']))
        if material == 'game_mushroom':
            mushroom = helpers['art_registry']()['crops']['mushroom']
            frames = mushroom['caveFrames']
            definition['previewArt'] = {'sheet':mushroom['sheet'], 'frames':[frames[(int(x/unit)+int(y/unit)) % len(frames)]]}
        uri = helpers['art_image'](helpers['material_art'](definition), f'class="sprite-cell" x="{x}" y="{y}" width="{unit}" height="{unit}"')
    else:
        source = 'data:image/png;base64,' + base64.b64encode((ROOT / row['path']).read_bytes()).decode()
        uri = f'<image class="sprite-cell" href="{source}" x="{x}" y="{y}" width="{unit}" height="{unit}"/>'
    label = html.escape(material.replace('_', ' '))
    return (f'<g class="proposal-prop" data-material="{material}"><title>{label} · proposed mechanic</title>'
            f'<rect class="geometry-cell" x="{x+1}" y="{y+1}" width="{unit-2}" height="{unit-2}" fill="{row["color"]}"/>'
            + uri + '</g>')


def _wall_cells(row, width, height):
    """Include a one-cell border so clipped walls retain their true joins."""
    if row.get('layout', {}).get('type') == 'rooms':
        cells = set()
        for room in row['layout']['rooms']:
            x,y,w,h = room['bounds']
            cells.update((xx,yy) for yy in range(y,y+h) for xx in range(x,x+w)
                         if xx in (x,x+w-1) or yy in (y,y+h-1))
        for room in row['layout']['rooms']:
            cells.difference_update(map(tuple,room['doors']))
        # A close-up is a crop of the same plan, never a regenerated layout.
        dx,dy = (row['layout']['extentCells'][0]-width)//2,(row['layout']['extentCells'][1]-height)//2
        return {(x-dx,y-dy) for x,y in cells}
    slots = {tuple(at) for at in row.get('wallSlots', [])}
    if not slots:
        return set()
    mw, mh = row['motifCells']
    cx, cy = width // 2, height // 2
    cells = set()
    for y in range(-1, height + 1):
        for x in range(-1, width + 1):
            if row['kind'] == 'path':
                at = (x - (cx - mw // 2), y % mh)
            else:
                at = ((x-cx+3) % mw, (y-cy+3) % mh)
                if abs(x-cx) <= 2 and abs(y-cy) <= 2:
                    continue
            if at in slots:
                cells.add((x,y))
    return cells


def _wall_art(cells, width, height, unit, helpers):
    manifest = json.loads((ROOT/'assets/Objects/Stronghold/manifest.json').read_text())
    frames = {frozenset(f['connections']): f['frame'] for f in manifest['frames']}
    parts = []
    for x,y in sorted(cells, key=lambda cell: (cell[1],cell[0])):
        if not (0 <= x < width and 0 <= y < height):
            continue
        neighbors = frozenset(name for name,dx,dy in [('N',0,-1),('E',1,0),('S',0,1),('W',-1,0)] if (x+dx,y+dy) in cells)
        frame = frames.get(neighbors)
        if frame is None:
            continue
        parts.append(f'<g class="warren-wall"><title>Stone wall · structural · frame {frame}</title><rect class="geometry-cell" x="{x*unit}" y="{y*unit}" width="{unit}" height="{unit}" fill="#989986"/>' + helpers['art_image']({'sheet':'stronghold_wall','frames':[frame],'preserveFrame':True},f'class="sprite-cell" x="{x*unit}" y="{y*unit}" width="{unit}" height="{unit}"') + '</g>')
    return ''.join(parts)


def _spring_slots(row):
    layout = row['layout']
    out = []
    for ring in layout['rings']:
        radius = ring['radiusCells']
        bound = math.ceil(radius + layout['ringBandHalfWidthCells'])
        for dy in range(-bound,bound+1):
            for dx in range(-bound,bound+1):
                if abs(dx) <= layout['approachHalfWidthCells'] or abs(dy) <= layout['approachHalfWidthCells']:
                    continue
                if abs(math.hypot(dx,dy)-radius) <= layout['ringBandHalfWidthCells']:
                    out.append({'at':[dx,dy],'material':ring['material']})
    return out


def _spring_sample(row, data, helpers, detail=False):
    layout = row['layout']
    side,unit = (13 if detail else layout['extentCells'][0]),10
    centre = side//2
    c = (centre+.5)*unit
    prefix = 'spring-rings-' + ('detail' if detail else 'wide')
    parts = [f'<svg role="img" aria-label="Spring feeding a pool with concentric bank, mushrooms and stone" viewBox="0 0 {side*unit} {side*unit}">',
             helpers['ground_pattern']('CAVE_FLOOR',prefix,unit),
             helpers['ground_pattern']('WATER',prefix+'-water',unit),
             f'<rect width="100%" height="100%" fill="url(#{prefix})"/>', '<g class="background">']
    # The bank remains dry all around the pool; rings have four open approaches.
    radius = layout['poolRadiusCells']*unit
    parts.append(f'<circle class="spring-bank" cx="{c}" cy="{c}" r="{radius+unit}" fill="#8e8770" fill-opacity=".25"/>')
    parts.append(f'<circle class="spring-water" cx="{c}" cy="{c}" r="{radius}" fill="url(#{prefix}-water)" stroke="#669a9d" stroke-width="1"><title>Pool supplied by the central spring · refill from its reachable bank</title></circle>')
    for slot in _spring_slots(row):
        x,y = (centre+slot['at'][0])*unit,(centre+slot['at'][1])*unit
        if 0 <= x < side*unit and 0 <= y < side*unit:
            parts.append(_image(slot['material'],x,y,unit,data['previewMaterials'],helpers))
    parts.append('</g><g class="poi-layer">')
    parts.append(f'<circle cx="{c}" cy="{c}" r="{layout["sourceIslandRadiusCells"]*unit}" fill="#77786b" stroke="#a5a78f" stroke-width=".7"><title>Central spring source</title></circle>')
    parts.append(_image('cave_pool',centre*unit,centre*unit,unit,data['previewMaterials'],helpers))
    dx,dy=layout['cacheOffset'];x,y=(centre+dx)*unit,(centre+dy)*unit
    parts.append(helpers['art_image']({'sheet':'chest','frames':[0]},f'class="sprite-cell" x="{x}" y="{y}" width="10" height="10"'))
    parts.append(f'<rect class="geometry-cell" x="{x+2}" y="{y+2}" width="6" height="6" fill="#e6c779"><title>Existing mirrored cache · on the dry bank</title></rect></g>')
    dx,dy=layout['encounterOffset']
    parts.append(helpers['creature_at']('cave_slime',(centre+dx+.5)*unit,(centre+dy+.5)*unit,unit,'Outer encounter pocket; spring bank stays clear'))
    parts.append(f'<path d="M 6 {side*unit-6} h 50" stroke="#e5ecdf"/><text x="6" y="{side*unit-10}" fill="#e5ecdf" font-size="5">35 m · 5 cells</text></svg>')
    return ''.join(parts)


def _spring_card(row,data,helpers):
    mix=collections.Counter(s['material'] for s in _spring_slots(row))
    counts=', '.join(f'{n} {m.replace("_"," ")}' for m,n in mix.items())
    layout=row['layout']
    detail_rows=[('Source region',row['source']),('Depth','1–3 proposal; deeper floors retain ordinary caves.'),
        ('Pattern','One concentric composition around the spring, not a repeating motif. Pool radius 3 cells; mushroom ring at 5 cells; rock ring at 8 cells.'),
        ('POI / rewards',row['poi']),('Connection',row['connection']),('Monsters',row['monsters']),
        ('Water','Pool surrounds the source. The water is impassable; refilling uses the nearest reachable bank, not the distant centre.'),
        ('Placement','The clear bank and four radial openings take precedence over ring pieces. Pool and source share one POI identity; the cache stays dry.'),
        ('Lighting','Existing cave and player light; water does not add a new light source.'),
        ('Art','Game cave-floor and water textures, cave mushroom sprites and ordinary mineral-rock sprites. Only the spring-source prop is an archived candidate; bank and island outlines are preview geometry.')]
    dl=''.join(f'<dt>{html.escape(k)}</dt><dd>{html.escape(v)}</dd>' for k,v in detail_rows)
    return (f'<article id="underground-{row["id"]}"><header><small>Underground nexus · draft · concentric rings</small><h2>{html.escape(row["name"])}</h2></header>'
        f'<p class="mix"><b>Spring → pool → clear bank → mushrooms → stone</b><br>{counts} before terrain clipping; water and POI counted separately.</p>'
        f'<div class="visual"><figure>{_spring_sample(row,data,helpers)}<figcaption>Concentric spring chamber · four open approaches</figcaption></figure>'
        f'<figure class="detail">{_spring_sample(row,data,helpers,True)}<figcaption>Spring, pool and bank close-up<br>1 cell = 7 m</figcaption></figure></div>'
        f'<p>{html.escape(row["atmosphere"])}</p><dl>{dl}</dl></article>')


def _sample(row, data, helpers, detail=False):
    path = row['kind'] == 'path'
    width, height = ((9, 9) if detail else (12, 25) if path else (25, 25))
    unit = 10
    cx, cy = width // 2, height // 2
    prefix = 'underground-' + row['id'] + ('-detail' if detail else '-wide')
    parts = [f'<svg role="img" aria-label="{html.escape(row["name"])} proposed {"close-up" if detail else "pattern"}" viewBox="0 0 {width*unit} {height*unit}">',
             helpers['ground_pattern']('CAVE_FLOOR', prefix, unit),
             f'<rect width="100%" height="100%" fill="url(#{prefix})"/>']
    if row.get('waterChannel'):
        parts.append(helpers['ground_pattern']('WATER',prefix+'-water',unit))
        for y in range(height):
            # Keep the same crossing alignment in the cropped detail.
            world_y = y + (25-height)//2
            if world_y % row['waterChannel']['crossingEveryCells'] < row['waterChannel']['crossingWidthCells']:
                continue
            parts.append(f'<rect class="seep-water" x="{(cx-1)*unit}" y="{y*unit}" width="{2*unit}" height="{unit}" fill="url(#{prefix}-water)"/>')
    if path:
        motif_width, _ = row['motifCells']
        start = cx - motif_width // 2
        parts.append(f'<path d="M {cx*unit+(unit/2 if motif_width%2 else 0)} 0 V {height*unit}" stroke="#707668" stroke-opacity=".25" stroke-width="{10 if motif_width==3 else 20}"/>')
        parts.append(f'<path d="M {start*unit} 0 V {height*unit} M {(start+motif_width)*unit} 0 V {height*unit}" stroke="#a6b6a7" stroke-dasharray="2 3" stroke-opacity=".5"/>')
    parts.append('<g class="background">')
    mw, mh = row['motifCells']
    walls = _wall_cells(row, width, height)
    occupied = set()
    if row.get('layout',{}).get('type') == 'rooms':
        ox,oy = (row['layout']['extentCells'][0]-width)//2,(row['layout']['extentCells'][1]-height)//2
        for slot in row['layout'].get('props',[]):
            x,y = slot['at'][0]-ox,slot['at'][1]-oy
            if 0 <= x < width and 0 <= y < height:
                parts.append(_image(slot['material'],x*unit,y*unit,unit,data['previewMaterials'],helpers))
                occupied.add((x,y))
    for y in range(height):
        for x in range(width):
            if (x,y) in walls:
                continue
            if path:
                rx = x - (cx - mw // 2)
                if not 0 <= rx < mw:
                    continue
                world_y = y + (25-height)//2 if row.get('waterChannel') else y
                at = [rx, world_y % mh]
                if row.get('waterChannel') and rx in (mw//2-1,mw//2):
                    channel = row['waterChannel']
                    if world_y % channel['crossingEveryCells'] < channel['crossingWidthCells']:
                        continue
            else:
                # The centre and approach lanes take precedence over background slots.
                if abs(x-cx) <= 2 and abs(y-cy) <= 2 or x == cx or y == cy:
                    continue
                if row.get('layout',{}).get('type') == 'rooms':
                    continue
                at = [(x-cx+3) % mw, (y-cy+3) % mh] if row.get('walls') else [(x+(25-width)//2) % mw, (y+(25-height)//2) % mh]
            for slot in row['slots']:
                if slot['at'] == at:
                    parts.append(_image(slot['material'], x*unit, y*unit, unit, data['previewMaterials'],helpers))
                    occupied.add((x,y))
    parts.append(_wall_art(walls, width, height, unit, helpers))
    parts.append('</g>')
    if not path:
        parts.append('<g class="poi-layer">')
        if row.get('shrineKind'):
            shrine = helpers['art_registry']()['shrineKinds'][row['shrineKind']]
            art = {'sheet':shrine['art'],'frames':[0]} if shrine.get('art') in helpers['art_registry']()['assets'] else {'sheet':'shrines','frames':[shrine['frame']]}
            parts.append(f'<g class="nexus-shrine"><title>{html.escape(shrine["name"])} · {html.escape(shrine["boon"])}</title>')
            parts.append(helpers['art_image'](art,f'class="sprite-cell" x="{cx*unit}" y="{cy*unit}" width="{unit}" height="{unit}"'))
            parts.append(f'<rect class="geometry-cell" x="{cx*unit+1}" y="{cy*unit+1}" width="8" height="8" fill="#{shrine["light"]:06x}"/></g>')
        parts.append(helpers['art_image']({'sheet':'chest','frames':[0]},f'class="sprite-cell" x="{(cx+1)*unit}" y="{(cy+1)*unit}" width="10" height="10"'))
        parts.append(f'<rect class="geometry-cell" x="{(cx+1)*unit+2}" y="{(cy+1)*unit+2}" width="6" height="6" fill="#e6c779"><title>Existing mirrored cache, only if one survives</title></rect>')
        parts.append('</g>')
    enemy = 'club_goblin' if row['id'] in ('goblin_warrens','warren_run') else 'cave_slime'
    if not path or row['id']=='warren_run':
        ex,ey = ((cx+1)*unit, (cy+2)*unit) if not path else ((cx-3)*unit,(cy+2)*unit)
        if row.get('encounterOffset'):
            ex,ey = (cx+row['encounterOffset'][0])*unit,(cy+row['encounterOffset'][1])*unit
        parts.append(helpers['creature_at'](enemy,ex,ey,unit,'Proposed depth-1 encounter seat; reallocated from existing budget'))
    parts.append(f'<path d="M 6 {height*unit-6} h 50" stroke="#e5ecdf"/><text x="6" y="{height*unit-10}" fill="#e5ecdf" font-size="5">35 m · 5 cells</text></svg>')
    return ''.join(parts)


def underground_section(helpers, out):
    data = json.loads(SOURCE.read_text())
    cards = {'nexus': [], 'path': []}
    for row in data['previewRows']:
        if row.get('layout',{}).get('type') == 'concentric_rings':
            cards[row['kind']].append(_spring_card(row,data,helpers))
            continue
        mw,mh = row['motifCells']
        assert 0 < mw <= 8 and 0 < mh <= 8
        assert len({tuple(s['at']) for s in row['slots']}) == len(row['slots'])
        for slot in row['slots']:
            assert 0 <= slot['at'][0] < mw and 0 <= slot['at'][1] < mh
            assert slot['material'] in data['previewMaterials']
        mix = collections.Counter(s['material'] for s in row['slots'])
        coverage = len(row['slots']) / (mw*mh) * 100
        wall_text = f'; {len(_wall_cells(row,25,25))/625*100:.2f}% structural stone-wall footprint in overview' if row.get('walls') and row['kind']=='nexus' else f'; {len(row.get("wallSlots", []))/(mw*mh)*100:.2f}% structural stone-wall footprint' if row.get('walls') else ''
        mix_text = ', '.join(f'{count} {key.replace("_", " ")}' for key,count in mix.items())
        details = [('Source region / route',row['source']),('Depth',row.get('depthNote','1–3 proposal; deeper floors retain ordinary caves.')),
                   ('Pattern',f'{mw} × {mh} cells; {mix_text}. Nominal occupancy before clipping and reserved approaches.'),
                   ('POI / rewards',row['poi']),('Connection',row['connection']),('Monsters',row['monsters']),
                   ('Lighting','Existing cave torches and player light. Additional glowing water or crystal art is not an enabled light source.'),
                   ('Fauna','No new surface fauna underground.'),
                   ('Art',('Existing Stronghold stone wall set; ' if row.get('walls') else '') + 'game rock, cave mushroom, barrel, chest, shrine and enemy sprites. Layouts and interactions are proposals.')]
        if row.get('walls'):
            details.append(('Stone walls', 'Stronghold stone wall set; connected straight, corner, junction and end frames. Structural cave walls, not reward-bearing props. Doorways and through lanes stay open.'))
        if row.get('shrineKind'):
            shrine=helpers['art_registry']()['shrineKinds'][row['shrineKind']]
            details.append(('Shrine', f'{shrine["name"]} · {shrine["boon"]}; existing daily boon replaces the shrine gift. One stable shrine identity per region and depth.'))
        if row.get('artNote'):
            details.append(('Art note', row['artNote']))
        if row.get('layout',{}).get('type') == 'rooms':
            details[2] = ('Pattern','Room interiors range from 3 × 3 to 5 × 5 cells, excluding walls. This 25 × 25 cell sample fits 25 adjoining rooms with offset partitions, narrow rectangles and open door gaps. Barrels sit in room corners, clear of door approaches; the Ember shrine occupies an inner room.')
        dl=''.join(f'<dt>{html.escape(k)}</dt><dd>{html.escape(v)}</dd>' for k,v in details)
        overview = _sample(row,data,helpers)
        if row.get('layout',{}).get('type') == 'rooms':
            coverage = overview.count('class="proposal-prop"') / 625 * 100
            mix_text = ', '.join(f'{overview.count(chr(34)+key+chr(34))} {key.replace(chr(95), chr(32))}' for key in mix)
        cap='Connected rooms · 3×3 to 5×5 interiors' if row.get('layout',{}).get('type') == 'rooms' else 'Background + nexus arrangement' if row['kind']=='nexus' else 'Representative straight passage · not a live carved route'
        close='Nexus close-up' if row['kind']=='nexus' else 'Passage close-up'
        motif_label = 'generated rooms' if row.get('layout',{}).get('type') == 'rooms' else f'{mw} × {mh} motif'
        cards[row['kind']].append(f'<article id="underground-{row["id"]}"><header><small>Underground {row["kind"]} · draft · {motif_label}</small><h2>{html.escape(row["name"])}</h2></header><p class="mix"><b>{coverage:.2f}% object occupancy{wall_text}</b><br>{html.escape(mix_text)}; nexus and encounter seats counted separately.</p><div class="visual"><figure>{overview}<figcaption>{cap}</figcaption></figure><figure class="detail">{_sample(row,data,helpers,True)}<figcaption>{close}<br>1 cell = 7 m</figcaption></figure></div><p>{html.escape(row["atmosphere"])}</p><dl>{dl}</dl></article>')
    # Keep the reviewed design alongside the preview without enabling it in runtime data.
    (out/'underground-zone-variants.draft.json').write_text(json.dumps(data,indent=2)+'\n')
    (out/'underground-art-license.txt').write_text((ROOT/'docs/art/underground-proposals/LICENSE.txt').read_text())
    checks=''.join(f'<li>{html.escape(item)}</li>' for item in data['checks'])
    return ('<section id="underground" data-view-panel hidden><h2>Underground · design proposals</h2>'
            '<nav class="page-nav" aria-label="Underground categories"><a href="#underground-nexus">Nexus (4)</a><a href="#underground-paths">Roads and paths (5)</a></nav>'
            '<p>Park POI regions become spring caves, goblin warrens, mushroom caverns or gemstone caverns. Public small roads and walking paths supply the connections. These nine authored patterns use the same card format and art controls as the surface designs; they are not live cave generation.</p>'
            '<p><a href="underground-zone-variants.draft.json">Draft data and implementation contract</a> · <a href="underground-art-license.txt">Candidate art license</a></p>'
            '<details><summary>Placement, rewards and depth rules</summary><p>Walking paths already map to cave floor. Small-road passages require explicit carving beneath eligible minor, street and public service lines. Preserve stairs, water and building provenance, major-road boundaries and excluded access; reserve clear lanes before dressing. Seep Passage replaces underground route tiles with water, preserving dry side banks and crossings at required connections.</p>'
            '<p>Regions keep stable surface POI identities at each depth, even when chest mirrors are pruned. Style at most one surviving mirror as the nexus cache, with existing tier rules. Ordinary finds, stores and encounter seats replace existing cave allocations. Miners’ Way adds a sparse, finite bonus ore budget at the floor tier; route fragments do not multiply it. Junctions and tile fragments never mint another reward.</p>'
            '<p>Suggested spring : warren : mushroom : gemstone weights are 35 : 30 : 30 : 5 at depth 1, 20 : 45 : 25 : 10 at depth 2 and 15 : 55 : 20 : 10 at depth 3, before geographic affinities. Warrens and mushroom caverns have one daily shrine each, using the existing boon and ledger rules. Spring water refills a watering can through a proposed interaction; free healing is not part of this draft. Optional warren traps need a bypass and are not drawn as a repeating background slot.</p>'
            '<ul>'+checks+'</ul></details>'
            '<section id="underground-nexus"><h2>Underground nexus</h2><div class="cards">'+''.join(cards['nexus'])+'</div></section>'
            '<section id="underground-paths"><h2>Underground roads and paths</h2><div class="cards">'+''.join(cards['path'])+'</div></section></section>')
