"""Draft underground cards for the shared zone viewer; never runtime placement."""
import base64
import collections
import functools
import html
import json
import math
import copy
import hashlib
import io
from PIL import Image
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'docs/data/underground-zone-variants.draft.json'


@functools.lru_cache(maxsize=None)
def _quarry_material(variant_id, material):
    data = json.loads((ROOT/'docs/data/zone-variants.json').read_text())
    variant = next(row for row in data['variants'] if row['id'] == variant_id)
    return {**data['materials'][material], 'previewArt': {
        'sheet':'zone_objects', 'frames':variant['materialFrames'][material]}}


def _image(material, x, y, unit, materials, helpers):
    row = materials[material]
    if 'caveArt' in row:
        manifest=json.loads((ROOT/'docs/art/underground-proposals/cave/manifest.json').read_text())
        entry=next(e for e in manifest['sheets']['cave_props']['entries'] if e['id']==row['caveArt'])
        uri=f'<image class="sprite-cell" href="{_cave_sprite(entry["frames"][0])}" x="{x}" y="{y}" width="{unit}" height="{unit}"/>'
    elif 'gameMaterial' in row or 'quarryVariant' in row:
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
    conceal = f' data-hidden-pit data-cell-x="{int(x/unit)}" data-cell-y="{int(y/unit)}" style="visibility:hidden"' if material == 'hidden_pit' else ''
    return (f'<g class="proposal-prop" data-material="{material}"{conceal}><title>{label} · proposed mechanic</title>'
            f'<rect class="geometry-cell" x="{x+1}" y="{y+1}" width="{unit-2}" height="{unit-2}" fill="{row["color"]}"/>'
            + uri + '</g>')


@functools.lru_cache(maxsize=None)
def _cave_sprite(frame):
    # Lossless copies of the approved sheet on main, bundled with this draft.
    folder = ROOT / 'docs/art/underground-proposals/cave'
    manifest = json.loads((folder/'manifest.json').read_text())
    w,h = manifest['frameWidth'],manifest['frameHeight']
    cols = manifest['sheets']['cave_props']['columns']
    with Image.open(folder/'props.png') as source:
        image = source.crop((frame%cols*w,frame//cols*h,(frame%cols+1)*w,(frame//cols+1)*h))
    out = io.BytesIO(); image.save(out,format='PNG')
    return 'data:image/png;base64,' + base64.b64encode(out.getvalue()).decode()


def _at_depth(row, data, depth):
    row = copy.deepcopy(row)
    row['previewDepth'] = depth
    materials = data['previewMaterials']
    eligible = sorted((m for m,r in materials.items() if 0 < r.get('gemTier',0) <= depth),
                      key=lambda m: materials[m]['gemTier'])
    for i,slot in enumerate(row['slots']):
        if materials[slot['material']].get('gemTier',0) > depth:
            slot['material'] = eligible[i % len(eligible)] if eligible else 'rock'
    return row


def _scatter_roll(row, x, y):
    key = f"{row['id']}:{row.get('previewDepth',2)}:{x}:{y}"
    return int.from_bytes(hashlib.sha256(key.encode()).digest()[:4],'big') / 2**32


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
    parts = [f'<svg data-spring-explore="{centre}" data-pool-radius="{layout["poolRadiusCells"]}" role="img" aria-label="Spring feeding a pool with concentric bank, mushrooms and stone" viewBox="0 0 {side*unit} {side*unit}">',
             helpers['ground_pattern']('CAVE_FLOOR',prefix,unit),
             helpers['ground_pattern']('WATER',prefix+'-water',unit),
             f'<rect width="100%" height="100%" fill="url(#{prefix})"/>', '<g class="background">']
    # The bank remains dry all around the pool; rings have four open approaches.
    radius = layout['poolRadiusCells']*unit
    parts.append(f'<circle class="spring-bank" cx="{c}" cy="{c}" r="{radius+unit}" fill="#8e8770" fill-opacity=".25"/>')
    parts.append(f'<circle class="spring-water" cx="{c}" cy="{c}" r="{radius}" fill="url(#{prefix}-water)" stroke="#669a9d" stroke-width="1"><title>Pool supplied by the central spring</title></circle>')
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
    for seat in row['encounters']['seats']:
        dx,dy=seat['at'];x,y=centre+dx,centre+dy
        if 0 <= x < side and 0 <= y < side:
            parts.append(f'<g class="hidden-encounter" data-cell-x="{x}" data-cell-y="{y}" style="visibility:hidden">')
            parts.append(helpers['creature_at']('skeleton',(x+.5)*unit,(y+.5)*unit,unit,'Dormant skeleton; reveals within one cell'))
            parts.append('</g>')
    parts.append('<circle class="spring-walker" r="3" fill="#f7eed0" stroke="#111" style="visibility:hidden"><title>Preview player position</title></circle>')
    parts.append(f'<path d="M 6 {side*unit-6} h 50" stroke="#e5ecdf"/><text x="6" y="{side*unit-10}" fill="#e5ecdf" font-size="5">35 m · 5 cells</text></svg>')
    return ''.join(parts)


def _spring_card(row,data,helpers):
    mix=collections.Counter(s['material'] for s in _spring_slots(row))
    counts=', '.join(f'{n} {m.replace("_"," ")}' for m,n in mix.items())
    layout=row['layout']
    detail_rows=[('Source region',row['source']),('Depth','Cave levels 1 and 2 only; deeper floors retain ordinary caves.'),
        ('Pattern','One concentric composition around the spring, not a repeating motif. Pool radius 3 cells; mushroom ring at 5 cells; rock ring at 8 cells.'),
        ('POI / rewards',row['poi']),('Connection',row['connection']),('Monsters',row['monsters']),
        ('Hidden encounters',row['encounters']['activation']),
        ('Mechanic status',row['encounters']['mechanicStatus']),
        ('Water','Pool surrounds the source. The water is impassable; a reachable dry bank circles it.'),
        ('Placement','The clear bank and four radial openings take precedence over ring pieces. Pool and source share one POI identity; the cache stays dry.'),
        ('Lighting','Existing cave and player light; water does not add a new light source.'),
        ('Art','Game cave-floor and water textures, cave mushroom sprites and ordinary mineral-rock sprites. Only the spring-source prop is an archived candidate; bank and island outlines are preview geometry.')]
    dl=''.join(f'<dt>{html.escape(k)}</dt><dd>{html.escape(v)}</dd>' for k,v in detail_rows)
    return (f'<article id="underground-{row["id"]}"><header><small>Underground nexus · draft · concentric rings</small><h2>{html.escape(row["name"])}</h2></header>'
        f'<p class="mix"><b>Spring → pool → clear bank → mushrooms → stone</b><br>{counts} before terrain clipping; water and POI counted separately.</p>'
        f'<div class="visual"><figure>{_spring_sample(row,data,helpers)}<figcaption>Concentric spring chamber · four open approaches</figcaption></figure>'
        f'<figure class="detail">{_spring_sample(row,data,helpers,True)}<figcaption>Spring, pool and bank close-up<br>1 cell = 7 m</figcaption></figure></div>'
        f'<p>Click a dry cell in either spring view to move the preview marker. Skeletons reveal only within one cell. <button type="button" data-reset-spring>Reset hidden skeletons</button></p><p>{html.escape(row["atmosphere"])}</p><dl>{dl}</dl></article>')


def _sample(row, data, helpers, detail=False):
    path = row['kind'] == 'path'
    width, height = ((9, 9) if detail else (12, 25) if path else (25, 25))
    unit = 10
    cx, cy = width // 2, height // 2
    prefix = 'underground-' + row['id'] + '-d' + str(row.get('previewDepth',1)) + ('-detail' if detail else '-wide')
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
    occupied = {(cx+2,cy)} if path and row.get('shrineKind') else set()
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
                reserve = row.get('centralReserveCells',2)
                if abs(x-cx) <= reserve and abs(y-cy) <= reserve or x == cx or y == cy:
                    continue
                if row.get('layout',{}).get('type') == 'rooms':
                    continue
                at = [(x-cx+3) % mw, (y-cy+3) % mh] if row.get('walls') else [(x+(25-width)//2) % mw, (y+(25-height)//2) % mh]
            for slot in row['slots']:
                if slot['at'] == at:
                    parts.append(_image(slot['material'], x*unit, y*unit, unit, data['previewMaterials'],helpers))
                    occupied.add((x,y))
    if row.get('scatterCoverage'):
        choices = row['scatterMaterials']
        for y in range(height):
            for x in range(width):
                # Crop coordinates stay aligned between overview and detail.
                wx,wy = x+(12-width)//2,y+(25-height)//2
                if (x,y) in occupied or (x,y) in walls or x in (cx-1,cx) or not cx-row['motifCells'][0]//2 <= x < cx+(row['motifCells'][0]+1)//2:
                    continue
                roll = _scatter_roll(row,wx,wy)
                if roll < row['scatterCoverage']:
                    material = choices[min(len(choices)-1,int(roll/row['scatterCoverage']*len(choices)))]
                    parts.append(_image(material,x*unit,y*unit,unit,data['previewMaterials'],helpers))
    if path and row.get('shrineKind'):
        shrine = helpers['art_registry']()['shrineKinds'][row['shrineKind']]
        art = {'sheet':shrine['art'],'frames':[0]} if shrine.get('art') in helpers['art_registry']()['assets'] else {'sheet':'shrines','frames':[shrine['frame']]}
        parts.append('<g class="route-shrine"><title>Example qualifying route: 50% chance once per route and depth</title>')
        parts.append(helpers['art_image'](art,f'class="sprite-cell" x="{(cx+2)*unit}" y="{cy*unit}" width="{unit}" height="{unit}"'))
        parts.append('</g>')
    parts.append(_wall_art(walls, width, height, unit, helpers))
    parts.append('</g>')
    if not path:
        parts.append('<g class="poi-layer">')
        if row.get('shrineKind'):
            shrine = helpers['art_registry']()['shrineKinds'][row['shrineKind']]
            art = {'sheet':shrine['art'],'frames':[0]} if shrine.get('art') in helpers['art_registry']()['assets'] else {'sheet':'shrines','frames':[shrine['frame']]}
            parts.append(f'<g class="nexus-shrine"><title>{html.escape(shrine["name"])} · {html.escape(shrine.get("boon", shrine.get("lever", "Blessing")))}</title>')
            parts.append(helpers['art_image'](art,f'class="sprite-cell" x="{cx*unit}" y="{cy*unit}" width="{unit}" height="{unit}"'))
            parts.append(f'<rect class="geometry-cell" x="{cx*unit+1}" y="{cy*unit+1}" width="8" height="8" fill="#{shrine["light"]:06x}"/></g>')
        if row.get('showCache',True):
            parts.append(helpers['art_image']({'sheet':'chest','frames':[0]},f'class="sprite-cell" x="{(cx+1)*unit}" y="{(cy+1)*unit}" width="10" height="10"'))
            parts.append(f'<rect class="geometry-cell" x="{(cx+1)*unit+2}" y="{(cy+1)*unit+2}" width="6" height="6" fill="#e6c779"><title>Existing mirrored cache, only if one survives</title></rect>')
        parts.append('</g>')
    if row.get('encounters'):
        ew,eh=row['encounters']['extentCells']
        ox,oy=ew//2-cx,eh//2-cy
        for seat in row['encounters']['seats']:
            x,y=seat['at'][0]-ox,seat['at'][1]-oy
            if 0 <= x < width and 0 <= y < height:
                parts.append(helpers['creature_at'](seat['kind'],(x+.5)*unit,(y+.5)*unit,unit,row['encounters']['countPolicy']))
    else:
        enemy = 'club_goblin' if row['id'] in ('goblin_warrens','warren_run') else 'cave_slime'
        if not path or row['id']=='warren_run':
            ex,ey = ((cx+1)*unit, (cy+2)*unit) if not path else ((cx-3)*unit,(cy+2)*unit)
            if row.get('encounterOffset'):
                ex,ey = (cx+row['encounterOffset'][0])*unit,(cy+row['encounterOffset'][1])*unit
            parts.append(helpers['creature_at'](enemy,ex,ey,unit,'Proposed depth-1 encounter seat; reallocated from existing budget'))
    parts.append(f'<path d="M 6 {height*unit-6} h 50" stroke="#e5ecdf"/><text x="6" y="{height*unit-10}" fill="#e5ecdf" font-size="5">35 m · 5 cells</text></svg>')
    return ''.join(parts)


def story_panel(row, helpers):
    story = helpers['art_registry']().get('undergroundStories', {}).get(row['id'])
    if not story:
        return ''
    path = ROOT / 'assets' / 'art' / (story['art'] + '.webp')
    import base64
    picture = base64.b64encode(path.read_bytes()).decode()
    return ('<figure class="underground-story" style="max-width:352px;margin:16px auto">'
            f'<img src="data:image/webp;base64,{picture}" alt="{html.escape(story["title"])}" style="width:100%;border-radius:12px">'
            f'<figcaption>{html.escape(story["body"])}</figcaption></figure>')


def _maze_passages(layout):
    """Match the layout lab's Mulberry32 DFS and dead-end braiding exactly."""
    mask = 0xffffffff
    state = layout['seed'] + 47291
    def random():
        nonlocal state
        state = (state + 0x6D2B79F5) & mask
        t = ((state ^ (state >> 15)) * (state | 1)) & mask
        t ^= (t + (((t ^ (t >> 7)) * (t | 61)) & mask)) & mask
        return ((t ^ (t >> 14)) & mask) / 4294967296
    width, height = layout['extentCells']
    step = layout['mazeStep']
    cols, rows = (width-3)//step+1, (height-3)//step+1
    total = cols*rows
    def coord(i):
        return (1+(i%cols)*step, 1+(i//cols)*step)
    def neighbors(i):
        x,y = i%cols,i//cols
        return ([i-1] if x else []) + ([i+1] if x<cols-1 else []) + ([i-cols] if y else []) + ([i+cols] if y<rows-1 else [])
    cells, links, degree = set(), set(), [0]*total
    def join(a,b):
        x,y = coord(a)
        tx,ty = coord(b)
        cells.add((x,y))
        while (x,y)!=(tx,ty):
            x += (tx>x)-(tx<x)
            y += (ty>y)-(ty<y)
            cells.add((x,y))
        links.add(tuple(sorted((a,b))))
        degree[a]+=1
        degree[b]+=1
    start = int(random()*total)
    seen, stack = {start}, [start]
    cells.add(coord(start))
    while stack:
        a = stack[-1]
        options = [b for b in neighbors(a) if b not in seen]
        if not options:
            stack.pop()
            continue
        b = options[int(random()*len(options))]
        seen.add(b)
        join(a,b)
        stack.append(b)
    for a in range(total):
        if degree[a]!=1 or random()>=layout['loops']/100:
            continue
        options = [b for b in neighbors(a) if tuple(sorted((a,b))) not in links]
        if options:
            join(a,options[int(random()*len(options))])
    return cells


def _maze_card(row, data, helpers):
    layout = row['layout']
    width,height = layout['extentCells']
    passages = _maze_passages(layout)
    fx,fy = row['focus']['at']
    reserved = {(x,y) for y in range(fy-1,fy+2) for x in range(fx-1,fx+2)}
    rocks = passages - reserved
    available = [(x,y) for y in range(2,height-2) for x in range(2,width-2)
                 if (x,y) not in rocks and abs(x-fx)+abs(y-fy)>4]
    seats = []
    for target in [(5,5),(width-6,5),(5,height-6),(width-6,height-6),(fx,5),(fx,height-6)]:
        seat = min((p for p in available if p not in seats),key=lambda p:(abs(p[0]-target[0])+abs(p[1]-target[1]),p[1],p[0]))
        seats.append(seat)
    views = []
    for depth, reward in [(1,'shrine'),(2,'treasure')]:
        prefix = f'underground-dungeon-maze-ground-{depth}'
        svg = (f'<svg role="img" aria-label="Dungeon Maze floor {depth}: mineable cave walls, monsters and {reward}" viewBox="0 0 {width*10} {height*10}">'
               + helpers['ground_pattern']('CAVE_FLOOR',prefix,10)
               + f'<rect width="100%" height="100%" fill="url(#{prefix})"/>'
                + helpers['ground_pattern']('CAVE_WALL',prefix+'-wall',10)
               + '<g class="background">' + ''.join(f'<rect class="maze-rock-wall" data-maze-terrain="CAVE_WALL" x="{x*10}" y="{y*10}" width="10" height="10" fill="url(#{prefix}-wall)"><title>Mineable cave rock wall</title></rect>' for x,y in sorted(rocks,key=lambda p:(p[1],p[0]))) + '</g>')
        kinds = row['encounterByDepth'][str(depth)]
        for i,(x,y) in enumerate(seats):
            svg += helpers['creature_at'](kinds[i%len(kinds)],(x+.5)*10,(y+.5)*10,10,f'Floor {depth} encounter in an open interior cell')
        if reward == 'shrine':
            shrine = helpers['art_registry']()['shrineKinds'][row['focus']['shrineKind']]
            art = {'sheet':shrine['art'],'frames':[0]} if shrine.get('art') in helpers['art_registry']()['assets'] else {'sheet':'shrines','frames':[shrine['frame']]}
        else:
            art = {'sheet':'chest','frames':[0]}
        svg += '<g class="poi-layer"><title>Grove focus · '+('shrine' if reward=='shrine' else 'T3 treasure')+' · one reward alternative</title>'
        svg += helpers['art_image'](art,f'class="sprite-cell" x="{fx*10}" y="{fy*10}" width="10" height="10"')
        svg += f'<rect class="geometry-cell" x="{fx*10+1}" y="{fy*10+1}" width="8" height="8" fill="#e6c779"/></g></svg>'
        views.append('<figure>'+svg+f'<figcaption>Floor {depth} · '+('shrine example' if reward=='shrine' else 'T3 treasure example')+'</figcaption></figure>')
    settings = 'types=configured&gx=34&gy=33&count=429&structure=100&distortion=0&variation=34&grouping=100&a=tree&b=none&c=none&d=none&e=none&points=false&guides=false&selection=density&inverted=false&clusterSize=true&decimation=0&mazeStep=3&loops=77&seed=2718&layouts=maze_braid&focus=maze_braid'
    details = [('Source region',row['source']),('Depth','Proposed for cave levels 1 and 2.'),
               ('Pattern',f'34 × 33 cells · spacing 3 · loops 77% · seed 2718. {len(rocks)} mineable cave-wall terrain cells after reserving a 3 × 3 focus clearing. Cave rock wall occupies the reference’s tree cells; the complementary spaces remain open. Mining can connect enclosed spaces.'),
               ('POI / rewards',row['poi']),('Connection',row['connection']),('Monsters',row['monsters'])]
    dl = ''.join(f'<dt>{html.escape(k)}</dt><dd>{html.escape(v)}</dd>' for k,v in details)
    return (f'<article id="underground-{row["id"]}"><header><small>Underground park nexus · draft · braided maze</small><h2>{row["name"]}</h2></header>'
            + '<div class="visual underground-depths" style="grid-template-columns:1fr 1fr">'+''.join(views)+'</div><p>Either reward alternative can occur on either floor. Cave-wall fill uses the linked maze; the grove focus is reserved first.</p>'
            + f'<p>{html.escape(row["atmosphere"])}</p><p><a href="layout-lab.html#{html.escape(settings,quote=True)}">Open the source maze in Layout Lab</a></p><dl>{dl}</dl></article>')


def underground_section(helpers, out):
    data = json.loads(SOURCE.read_text())
    cards = {'nexus': [], 'path': []}
    for row in data['previewRows']:
        if row.get('layout', {}).get('type') == 'maze_braid':
            cards[row['kind']].append(_maze_card(row,data,helpers))
            continue
        if row.get('layout',{}).get('type') == 'concentric_rings':
            cards[row['kind']].append(_spring_card(row,data,helpers).replace('</header>', '</header>' + story_panel(row, helpers), 1))
            continue
        mw,mh = row['motifCells']
        assert 0 < mw <= 8 and 0 < mh <= 8
        assert len({tuple(s['at']) for s in row['slots']}) == len(row['slots'])
        for slot in row['slots']:
            assert 0 <= slot['at'][0] < mw and 0 <= slot['at'][1] < mh
            assert slot['material'] in data['previewMaterials']
        mix = collections.Counter(s['material'] for s in _at_depth(row,data,row.get('depths',[1])[0])['slots'])
        coverage = len(row['slots']) / (mw*mh) * 100
        wall_text = f'; {len(_wall_cells(row,25,25))/625*100:.2f}% structural stone-wall footprint in overview' if row.get('walls') and row['kind']=='nexus' else f'; {len(row.get("wallSlots", []))/(mw*mh)*100:.2f}% structural stone-wall footprint' if row.get('walls') else ''
        mix_text = ', '.join(f'{count} {key.replace("_", " ")}' for key,count in mix.items())
        details = [('Source region / route',row['source']),('Depth',row.get('depthNote','Cave levels 1 and 2 only; deeper floors retain ordinary caves.')),
                   ('Pattern',f'{mw} × {mh} cells; {mix_text}. Nominal occupancy before clipping and reserved approaches.'),
                   ('POI / rewards',row['poi']),('Connection',row['connection']),('Monsters',row['monsters']),
                   ('Lighting','Existing cave torches and player light. Additional glowing water or crystal art is not an enabled light source.'),
                   ('Fauna','No new surface fauna underground.'),
                   ('Art',('Existing Stronghold stone wall set; ' if row.get('walls') else '') + 'game rock, cave mushroom, barrel, chest, shrine and enemy sprites. Layouts and interactions are proposals.')]
        if row.get('walls'):
            details.append(('Stone walls', 'Stronghold stone wall set; connected straight, corner, junction and end frames. Structural cave walls, not reward-bearing props. Doorways and through lanes stay open.'))
        if row.get('encounters'):
            details.append(('Encounter population',row['encounters']['countPolicy']))
        if row.get('shrineKind'):
            shrine=helpers['art_registry']()['shrineKinds'][row['shrineKind']]
            details.append(('Shrine', f'{shrine["name"]} · {shrine.get("boon", shrine.get("lever", "Blessing"))}; existing daily boon replaces the shrine gift. One stable shrine identity per region and depth.'))
        if row.get('shrineChance'):
            details.append(('Route shrine chance', '50% once per canonical connected route and depth, including existing path themes. The preview shows a qualifying route.'))
        if any(slot['material'] == 'hidden_pit' for slot in row['slots']):
            details.append(('Hidden pit preview', 'Click a cell next to or on a pit to reveal it. Pits remain discovered in this preview until reload.'))
        if row.get('scatterCoverage'):
            details.append(('Hazard scatter', '10% combined coverage on eligible floor, after reserved lanes and occupied cells. Inactive poison vents, stalagmites and separate fall-through holes.'))
        if row.get('artNote'):
            details.append(('Art note', row['artNote']))
        if row.get('layout',{}).get('type') == 'rooms':
            details[2] = ('Pattern','Room interiors range from 3 × 3 to 5 × 5 cells, excluding walls. This 25 × 25 cell sample fits 25 adjoining rooms with offset partitions, narrow rectangles and open door gaps. Barrels sit in room corners, clear of door approaches; the Ember shrine occupies an inner room.')
        dl=''.join(f'<dt>{html.escape(k)}</dt><dd>{html.escape(v)}</dd>' for k,v in details)
        views = [(depth,_sample(_at_depth(row,data,depth),data,helpers)) for depth in row.get('depths',[1,2])]
        overview = views[0][1]
        depth_views = ''.join(f'<figure>{svg}<figcaption>Cave level {depth} · gems capped at tier {depth}</figcaption></figure>' for depth,svg in views)
        if row.get('layout',{}).get('type') == 'rooms':
            coverage = overview.count('class="proposal-prop"') / 625 * 100
            mix_text = ', '.join(f'{overview.count(chr(34)+key+chr(34))} {key.replace(chr(95), chr(32))}' for key in mix)
        cap='Connected rooms · 3×3 to 5×5 interiors' if row.get('layout',{}).get('type') == 'rooms' else 'Background + nexus arrangement' if row['kind']=='nexus' else 'Representative straight passage · not a live carved route'
        close='Nexus close-up' if row['kind']=='nexus' else 'Passage close-up'
        motif_label = 'generated rooms' if row.get('layout',{}).get('type') == 'rooms' else f'{mw} × {mh} motif'
        coverage_label = '10% hazard scatter + ' + f'{coverage:.2f}% motif objects' if row.get('scatterCoverage') else f'{coverage:.2f}% object occupancy{wall_text}'
        cards[row['kind']].append(f'<article id="underground-{row["id"]}"><header><small>Underground {row["kind"]} · draft · {motif_label}</small><h2>{html.escape(row["name"])}</h2></header>{story_panel(row, helpers)}<p class="mix"><b>{coverage_label}</b><br>{html.escape(mix_text)}; nexus and encounter seats counted separately.</p><div class="visual underground-depths" style="grid-template-columns:1fr 1fr">{depth_views}</div><p>{html.escape(row["atmosphere"])}</p><dl>{dl}</dl></article>')
    # Keep the reviewed design alongside the preview without enabling it in runtime data.
    (out/'underground-zone-variants.draft.json').write_text(json.dumps(data,indent=2)+'\n')
    (out/'underground-art-license.txt').write_text((ROOT/'docs/art/underground-proposals/LICENSE.txt').read_text())
    checks=''.join(f'<li>{html.escape(item)}</li>' for item in data['checks'])
    return ('<section id="underground" data-view-panel hidden><h2>Underground · design proposals</h2>'
            '<nav class="page-nav" aria-label="Underground categories"><a href="#underground-nexus">Nexus and floor scatter</a><a href="#underground-paths">Paths and small roads</a></nav>'
            '<p>On cave levels 1 and 2 only, grove nexuses become spring caves, goblin warrens, mushroom caverns or gemstone caverns. Beneath quarries, Mine Tunnels form simple ore-rich deposits. Seep regions do not select these nexus variants. Underground nexuses have no temple buildings; houses and medium/large roads remain rock walls; eligible small roads receive underground passages. The requested Ember altar and Toad idol are standalone cave shrines. All paths on cave levels 1 and 2 receive an underground path theme, including paths outside parks. Small-road variants join the path themes; nearby terrain and nexus regions influence theme choice. These authored patterns use the same card format and art controls as the surface designs; they are not live cave generation.</p>'
            '<p>Level 2 mixes low-tier gems into unsuppressed rock scatter, with bonuses beneath beaches, commercial ground and small roads. Gemstone caverns and paths never exceed the current floor’s gem tier. Small-road hazards cover about 10% collectively. Holes show a falling story panel, cost 25% maximum energy and drop the player one floor; hidden pits reveal adjacent or underfoot and use surface-snare damage. All underground route variants have a 50% shrine chance.</p>'
            '<p><a href="underground-zone-variants.draft.json">Draft data and implementation contract</a> · <a href="underground-art-license.txt">Candidate art license</a></p>'
            '<details><summary>Placement, rewards and depth rules</summary><p>Path themes use the existing path geometry on cave levels 1 and 2 only. Cover all eligible paths; carve only explicitly eligible sm_road corridors, retaining medium/large roads and buildings as walls, and do not carry themes to level 3 or deeper. Preserve stairs, water and building provenance and excluded access; reserve clear lanes before dressing. Seep Passage replaces underground route tiles with water, preserving dry side banks and crossings at required connections.</p>'
            '<p>Regions keep stable surface POI identities at each depth, even when chest mirrors are pruned. Style at most one surviving mirror as the nexus cache, with existing tier rules. Ordinary finds and stores replace existing cave allocations. Warrens and mushroom caverns have explicit denser encounter budgets; route patrols and cubes are owned once per route. Named-zone skeleton, mushroom-monster and cube placements are deliberate level-1/2 exceptions to ambient roster depth rules. Miners’ Way adds a sparse, finite bonus ore budget at the floor tier; route fragments do not multiply it. Junctions and tile fragments never mint another reward.</p>'
            '<p>For grove anchors only, suggested spring : warren : mushroom : gemstone weights are 35 : 30 : 30 : 5 at depth 1, 20 : 45 : 25 : 10 at depth 2, before geographic affinities. Warrens and mushroom caverns have one daily shrine each, using the existing boon and ledger rules. Free healing is not part of this draft. Optional warren traps need a bypass and are not drawn as a repeating background slot.</p>'
            '<ul>'+checks+'</ul></details>'
            '<section id="underground-nexus"><h2>Underground nexus</h2><div class="cards">'+''.join(cards['nexus'])+'</div></section>'
            '<section id="underground-paths"><h2>Underground paths and small roads</h2><div class="cards">'+''.join(cards['path'])+'</div></section></section>' + _ambush_script() + _pit_script())


def _ambush_script():
    return """<script>(()=>{
const card=document.getElementById('underground-spring_cave');
if(!card)return;
for(const svg of card.querySelectorAll('[data-spring-explore]')){
  svg.style.cursor='crosshair';
  svg.addEventListener('click',event=>{
    const p=svg.createSVGPoint();p.x=event.clientX;p.y=event.clientY;
    const point=p.matrixTransform(svg.getScreenCTM().inverse());
    const x=Math.floor(point.x/10),y=Math.floor(point.y/10),centre=Number(svg.dataset.springExplore);
    if(Math.hypot(x-centre,y-centre)<=Number(svg.dataset.poolRadius))return;
    const blocked=[...svg.querySelectorAll('.proposal-prop image, .poi-layer image')].some(image=>Math.floor(Number(image.getAttribute('x'))/10)===x&&Math.floor(Number(image.getAttribute('y'))/10)===y);
    if(blocked)return;
    const marker=svg.querySelector('.spring-walker');marker.setAttribute('cx',(x+.5)*10);marker.setAttribute('cy',(y+.5)*10);marker.style.visibility='visible';
    for(const enemy of svg.querySelectorAll('.hidden-encounter')){
      if(Math.hypot(x-Number(enemy.dataset.cellX),y-Number(enemy.dataset.cellY))<=1){enemy.style.visibility='visible';enemy.dataset.revealed='true';}
    }
  });
}
document.addEventListener('click',event=>{
  const button=event.target.closest('[data-reset-spring]');
  if(!button)return;
  const current=button.closest('article');
  for(const enemy of current.querySelectorAll('.hidden-encounter')){enemy.style.visibility='hidden';delete enemy.dataset.revealed;}
  for(const marker of current.querySelectorAll('.spring-walker'))marker.style.visibility='hidden';
},true);
})();</script>"""


def _pit_script():
    return """<script>(()=>{
for(const svg of document.querySelectorAll('#underground svg')){
  if(!svg.querySelector('[data-hidden-pit]'))continue;
  svg.style.cursor='crosshair';
  svg.addEventListener('click',event=>{
    const p=svg.createSVGPoint();p.x=event.clientX;p.y=event.clientY;
    const at=p.matrixTransform(svg.getScreenCTM().inverse());
    const x=Math.floor(at.x/10),y=Math.floor(at.y/10);
    for(const pit of svg.querySelectorAll('[data-hidden-pit]')){
      if(Math.abs(x-Number(pit.dataset.cellX))<=1 && Math.abs(y-Number(pit.dataset.cellY))<=1)pit.style.visibility='visible';
    }
  });
}
})()</script>"""
