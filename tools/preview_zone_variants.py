#!/usr/bin/env python3
"""Render zone patterns and shipping street dressing on synthetic straight roads.
Usage: python3 tools/preview_zone_variants.py [table.json] [output-directory]
Requires Node.js and Pillow; sprite frames come directly from shipped assets.
"""
import collections
import base64
import functools
import hashlib
import html
import io
import json
import math
import pathlib
import subprocess
import sys

from PIL import Image


@functools.lru_cache(maxsize=1)
def art_registry():
    helper = pathlib.Path(__file__).with_name('preview_variant_art.js')
    return json.loads(subprocess.check_output(['node', str(helper)], text=True))


@functools.lru_cache(maxsize=None)
def sprite_png(sheet, frame, preserve_frame=False):
    row = art_registry()['assets'][sheet]
    path = pathlib.Path(__file__).resolve().parents[1] / row['path'].split('?')[0]
    with Image.open(path) as source:
        image = source.convert('RGBA')
    if row['kind'] == 'spritesheet':
        w, h = row['frameWidth'], row['frameHeight']
        cols = image.width // w
        x, y = frame % cols * w, frame // cols * h
        assert y + h <= image.height, (sheet, frame)
        image = image.crop((x, y, x + w, y + h))
    # Match ASSETS.crops.onLoad; raw Crops.png has an opaque white key.
    if row['whiteKey']:
        image.putdata([(r, g, b, 0 if min(r, g, b) > 240 else a) for r, g, b, a in image.getdata()])
    bounds = image.getbbox()
    assert bounds, f'Blank art frame: {sheet}:{frame}'
    if not preserve_frame:
        image = image.crop(bounds)
    buf = io.BytesIO()
    image.save(buf, format='PNG')
    return 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode()


def material_art(material):
    """Resolve the same mature wildplant/object frames as render.js."""
    r = art_registry()
    if material.get('recordType') == 'surface_trap':
        return {'procedural': 'trap_hidden', 'source': 'src/textures.js · hidden trap scuff', 'alternates': ['trap_open']}
    kind = material['kind']
    if kind == 'wildplant':
        crop = material['crop']
        ov = r['crops'].get(crop)
        look = material.get('_plantArt') or material.get('_streetArt')
        if ov and look:
            ov = ov.get('looks', {}).get(look, ov)
        if ov and ov.get('custom'):
            sheet, frames = ov['sheet'], ov.get('frames', [ov.get('frame', 0)])
        elif ov and ov['sheet'] == 'springcrops':
            sheet, frames = 'springcrops', [ov['row'] * 14 + r['matureStage']]
        else:
            sheet, frames = 'crops', [r['cropRows'][crop] * r['cropColumns'] + r['matureStage']]
    elif kind == 'coindrop':
        sheet, frames = 'coin_drop', [0]
    elif kind == 'mineralrock':
        tier = material.get('yieldTier', 1)
        sheet, frames = 'mineralrock', [r['churchyardFrame'] if tier == 1 else r['mineralTiers'][str(tier)]['rockFrame']]
    elif kind == 'tree':
        species = material.get('species', 'maple')
        sheet = 'trees' if species == 'maple' else species + '_tree'
        # ZoneDressing sets variant=1; size-bearing maples render mature frame 3.
        stage = str(max(1, min(3, round(material.get('variant', 2)))))
        frames = [3 if material.get('size') or species != 'maple' else r['treeStages'][stage]['frame']]
    elif kind == 'fruittree':
        species = material.get('species', 'apple')
        sheet, frames = species + '_tree', [r['fruitFrames'][species]['mature']]
    else:
        sheet, frames = kind, [0]
    assert sheet in r['assets'], f'No shipping art for {material}'
    return {'sheet': sheet, 'frames': frames, 'preserveFrame': kind == 'tree',
            'source': r['assets'][sheet]['path'].split('?')[0] + ' · frame ' + ', '.join(map(str, frames))}


def art_image(art, extra='', frame=None):
    if art.get('procedural'):
        return f'<image data-procedural="{art["procedural"]}" {extra}/>'
    return f'<image href="{sprite_png(art["sheet"], art["frames"][0] if frame is None else frame, art.get("preserveFrame", False))}" {extra}/>'


def sprite_symbols(materials, prefix):
    return '<defs>' + ''.join(f'<symbol id="{prefix}-{name}" viewBox="0 0 1 1">' +
        art_image(material_art(m), 'width="1" height="1" preserveAspectRatio="xMidYMid meet"') +
        '</symbol>' for name, m in materials.items()) + '</defs>'


def sprite_cell(prefix, material, x, y, size, definition=None):
    if material == 'giant_mushroom':
        look = art_registry()['crops']['shrub']['looks']['giant_mushroom']
        factor = art_registry()['assets'][look['sheet']]['frameHeight'] * look['scale'] / 32
        x -= size * (factor - 1) / 2
        y -= size * (factor - 1)
        size *= factor
    if definition and definition.get('kind') == 'tree' and definition.get('size'):
        factor = 48 * art_registry()['treeSizes'][definition['size']] / 32
        x -= size * (factor - 1) / 2
        y -= size * (factor - 1)
        size *= factor
    return f'<use class="sprite-cell" href="#{prefix}-{material}" x="{x}" y="{y}" width="{size}" height="{size}"/>'


def art_gallery(materials, title='Material art', id_prefix=''):
    cards = []
    for name, m in materials.items():
        art = material_art(m)
        images = [art_image(art, 'width="64" height="64"', frame) for frame in art.get('frames', [None])]
        images += [art_image({'procedural': key}, 'width="64" height="64"') for key in art.get('alternates', [])]
        thumbs = ''.join(f'<svg viewBox="0 0 64 64" role="img" aria-label="{html.escape(name)} game art">{im}</svg>' for im in images)
        note = ' · hidden / sprung' if art.get('alternates') else ''
        if name == 'rubble':
            note = ' · mature wild rockfruit: a small cluster of grey stones'
        cards.append(f'<div class="art-item" id="art-{id_prefix}{name}"><div class="art-thumbs">{thumbs}</div><b>{html.escape(name.replace("_", " "))}</b><small>{html.escape(note.lstrip(" ·"))}</small><details><summary>Sprite source</summary><code>{html.escape(art["source"])}</code></details></div>')
    return f'<section class="art-gallery"><h2>{title}</h2><p>Actual game sprite frames, including find materials. Thumbnails and pattern cells are enlarged to fit; their size is schematic. Tree fruit overlays, lighting and animation are not simulated. Hover a pattern cell for its material; expand a source to see the sheet and frame.</p><div class="art-grid">{"".join(cards)}</div></section>'


def art_styles():
    return '''.art-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px}.art-item{background:#172820;border:1px solid #334a3a;border-radius:8px;padding:12px;overflow-wrap:anywhere}.art-item b,.art-item small{display:block}.art-thumbs{display:flex;flex-wrap:wrap;gap:4px;min-height:68px;align-items:center}.art-thumbs svg{width:64px;height:64px}.art-item details{font-size:11px;color:#a8bbaa;margin-top:8px}.art-item summary{cursor:pointer}.art-gallery{margin:28px 0}.sprite-cell{pointer-events:none}.sprite-cell,.art-thumbs image{image-rendering:pixelated}.geometry-cell{opacity:.12}body:has(#show-art:not(:checked)) .sprite-cell{display:none}body:has(#show-art:not(:checked)) .geometry-cell{opacity:1}.art-switch{display:inline-block;padding:10px 14px;background:#263b2d;border-radius:8px}'''


def art_script():
    r = art_registry()
    # Self-contained Canvas2D painters: no network, Phaser or external assets.
    code = f'const UI_LAMP_GLOW={json.dumps(r["lampGlow"])}, UI_LAMP_GOLD={json.dumps(r["lampGold"])};\n' + r['painters']
    code += '''
const baked = new Map();
const scene = {textures:{exists:key=>baked.has(key),createCanvas:(key,w,h)=>{
  const c=document.createElement('canvas');c.width=w;c.height=h;
  return {getContext:()=>c.getContext('2d'),refresh:()=>baked.set(key,c.toDataURL())};
}}};
makeTrapTextures(scene);
for(const image of document.querySelectorAll('[data-procedural]')){
  const key=image.dataset.procedural;
  if(!baked.has(key)&&key.startsWith('lamp:')){
    const c=document.createElement('canvas');c.width=c.height=LAMP_TEX_PX;
    paintLamp(c.getContext('2d'),LAMP_TEX_PX,key.slice(5));baked.set(key,c.toDataURL());
  }
  if(!baked.has(key))throw new Error('Missing preview painter: '+key);
  image.setAttribute('href',baked.get(key));
}
document.documentElement.dataset.artReady='true';
'''
    return '<script>(()=>{\n' + code.replace('</script', '<\\/script') + '\n})();</script>'


def cycle(material, bx, by):
    return material['cycle'][(bx + by) % len(material['cycle'])] if isinstance(material, dict) else material


def hash_unit(variant, x, y, lane):
    # A representative stable preview seed, independent of the game's scatter seed.
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
    if b['type'] in ('line_grid', 'bounded_line_grid'):
        step = b['spacingCells']
        if b['type'] == 'bounded_line_grid' and not (0 <= x <= b['plots'][0] * step and 0 <= y <= b['plots'][1] * step):
            return None
        horizontal, vertical = y % step == 0, x % step == 0
        if horizontal and vertical:
            return b['intersectionMaterial']
        if horizontal:
            return b['horizontalMaterial']
        if vertical:
            return b['verticalMaterial']
        if b.get('plotCenters') and x % step == step // 2 and y % step == step // 2:
            if b['plotCenters'].get('excludePoiPlot') and [x // step, y // step] == b['poiPlot']:
                return None
            return cycle(b['plotCenters']['material'], x // step, y // step)
        return None
    if b['type'] == 'concentric_rings':
        if not (0 <= x < b['extentCells'][0] and 0 <= y < b['extentCells'][1]):
            return None
        return next((slot['material'] for slot in b['slots'] if slot['at']==[x,y]),None)
    w, h = b['repeatCells']
    for slot in b['slots']:
        if slot['at'] == [x % w, y % h]:
            return cycle(slot['material'], x // w, y // h)
    scatter = b.get('gapScatter')
    if scatter and hash_unit(v['id'], x, y, 'gap') < scatter['chance']:
        return scatter['material']
    return None


def validate(d):
    ids = [v['id'] for v in d['variants']]
    assert len(ids) == len(set(ids))
    affinities = [v for v in d['variants'] if v.get('attracts')]
    assert len(affinities) == (len(d['variants']) + 1) // 2, 'half the variants (rounded up) have fauna affinities'
    for v in affinities:
        assert set(v['attracts']) <= {'rabbit','butterfly','deer','crow'}
        assert all(0 < chance <= 1 for chance in v['attracts'].values())
    for v in d['variants']:
        b = v['background']
        origin = b['poiOrigin']['cell']
        assert len(origin)==2 and all(isinstance(c,int) for c in origin)
        if b['type']=='repeat_motif':
            assert all(0 <= origin[i] < b['repeatCells'][i] for i in (0,1))
        if b.get('ring'):
            assert origin == b['ring']['centerCell']
        if b.get('cluster'):
            assert origin == b['cluster']['centerCell']
        assert abs(sum(b['materialDensity'].values()) - b['nominalDensity']) < 1e-9
        assert set(b['materialDensity']) <= d['materials'].keys()
        coords = [tuple(s['at']) for s in v['poi']['slots']]
        assert len(coords) == len(set(coords)) and (0, 0) not in coords
        assert all(s['material'] in d['materials'] for s in v['poi']['slots'])
        if not v['poi'].get('clearing'):
            assert all(max(abs(c) for c in slot['at']) == 1 for slot in v['poi']['slots']), 'outdoor POI slots touch the POI'
        assert all(slot['material'] in d['materials'] for slot in v['poi'].get('whenInsideBuilding',{}).get('slots',[]))
        assert v['finds']['material'] in d['materials']
        assert v['finds']['count'] == len(v['finds']['targets']) and v['finds']['count'] > 0
        if v['zone'] == 'tar':
            assert v['guards']['mode'] == 'none'
        if b['type'] in ('line_grid', 'bounded_line_grid'):
            step = b['spacingCells']
            assert all(background_at(v, x, 0) for x in range(step * 3 + 1))
            assert all(background_at(v, 0, y) for y in range(step * 3 + 1))
        if b['type'] == 'bounded_line_grid':
            step = b['spacingCells']
            assert step % 2 == 0, 'exact cell-centered POI needs even line spacing'
            assert all(0 <= b['poiPlot'][axis] < b['plots'][axis] for axis in (0,1))
            px, py = [plot*step+step//2 for plot in b['poiPlot']]
            assert background_at(v, px, py) is None, 'POI center stays clear'
            assert all(background_at(v, px+dx, py+dy) for dx,dy in [(0,-step//2),(step//2,0),(0,step//2),(-step//2,0)])
            assert all(background_at(v, px+s['at'][0], py+s['at'][1]) is None for s in v['poi']['slots']), 'POI decoration stays inside its room'
        # Derive coverage over a full four-cycle tile for deterministic motifs.
        if b['type'] != 'seeded_scatter':
            period = (b['extentCells'][0] if b['type']=='concentric_rings' else b['spacingCells'] * b['plots'][0] + 1 if b['type']=='bounded_line_grid' else b.get('spacingCells', math.lcm(*b.get('repeatCells', [10, 10]))) * 4)
            fixed = {**v, 'background': {k: value for k, value in b.items() if k != 'gapScatter'}}
            if b['type'] == 'line_grid' and b.get('plotCenters'):
                fixed['background']['plotCenters'] = {**b['plotCenters'], 'excludePoiPlot': False}
            counted = collections.Counter(background_at(fixed, x, y) for x in range(period) for y in range(period))
            scatter = b.get('gapScatter')
            for material, density in {**b['materialDensity'], **b.get('hazardDensity',{})}.items():
                expected = counted[material] / period**2
                if scatter and material == scatter['material']:
                    expected += counted[None] / period**2 * scatter['chance']
                assert abs(expected - density) < 1e-9, (v['id'], material)


def svg_for(v, d, detail=False):
    b = v['background']
    side = 9 if detail else (b['extentCells'][0] if b['type']=='concentric_rings' else b['spacingCells'] * b['previewPlots'][0] + 1 if b['type'] in ('line_grid', 'bounded_line_grid') else 25)
    unit = 10
    center = side // 2
    aligned = b['type'] in ('line_grid','bounded_line_grid','concentric_rings')
    poi_x, poi_y = b['poiOrigin']['cell']
    draw_x, draw_y = ([poi_x,poi_y] if aligned and not detail else [center,center])
    parts = [f'<svg role="img" aria-label="{html.escape(v["name"])} {"POI pattern" if detail else "background and POI"}" viewBox="0 0 {side*unit} {side*unit}">', f'<rect width="100%" height="100%" fill="#172820"/>']
    art_prefix = f'zone-art-{v["id"]}-{int(detail)}'
    parts.append(sprite_symbols(d['materials'], art_prefix))
    if not detail or b['type'] != 'seeded_scatter':
        parts.append('<g class="background">')
        for y in range(side):
            for x in range(side):
                gx, gy = x + poi_x - draw_x, y + poi_y - draw_y
                material = background_at(v, gx, gy)
                if material:
                    color = d['materials'][material]['color']
                    gap = 0 if b['type'] in ('line_grid','bounded_line_grid') and (gx % b['spacingCells'] == 0 or gy % b['spacingCells'] == 0) else 1
                    parts.append(f'<rect class="geometry-cell" x="{x*unit+gap}" y="{y*unit+gap}" width="{unit-2*gap}" height="{unit-2*gap}" fill="{color}"><title>{material}</title></rect>')
                    parts.append(sprite_cell(art_prefix, material, x*unit+1, y*unit+1, unit-2, d['materials'][material]))
        parts.append('</g>')
    parts.append('<g class="poi-layer">')
    # Replace only actual POI cells, not a square cut out of the motif.
    for x,y in [(0,0)] + [slot['at'] for slot in v['poi']['slots']]:
        parts.append(f'<rect x="{(draw_x+x)*unit}" y="{(draw_y+y)*unit}" width="10" height="10" fill="#172820"/>')
    for s in v['poi']['slots']:
        x, y = s['at']; color = d['materials'][s['material']]['color']
        parts.append(f'<rect class="geometry-cell" x="{(draw_x+x)*unit+1}" y="{(draw_y+y)*unit+1}" width="8" height="8" fill="{color}"><title>POI: {s["material"]} ({x}, {y})</title></rect>')
        parts.append(sprite_cell(art_prefix, s['material'], (draw_x+x)*unit+1, (draw_y+y)*unit+1, 8, d['materials'][s['material']]))
    cx, cy = draw_x * unit + unit / 2, draw_y * unit + unit / 2
    parts.append(f'<circle cx="{cx}" cy="{cy}" r="4" fill="#fff6ca" stroke="#171b12" stroke-width=".8"><title>POI / settled interactable</title></circle><path d="M {cx-2.5} {cy} h 5 M {cx} {cy-2.5} v 5" stroke="#33291c" stroke-width="1"/>')
    parts.append('</g></svg>')
    return ''.join(parts)


STREET_COLORS = {
    'hedge': '#79a956', 'longgrass': '#a1bb69', 'shrub': '#427f52',
    'mushroom': '#4fd8c4', 'forgetmenot': '#84c9f5', 'fruittree': '#ffa6c9',
    'waystone': '#d3c9ae', 'barricade': '#d08d4e', 'tar': '#554356', 'stakes': '#a8adb3',
}


def street_material_key(o):
    kind = o.get('crop', o['kind'])
    suffix = ('_' + o.get('species', 'apple')) if kind in ('tree', 'fruittree') else ''
    if kind == 'tree':
        suffix += '_stage_' + str(o.get('variant', 2))
    if o.get('_streetArt'):
        suffix += '_' + o['_streetArt']
    return kind + suffix


def street_materials(rows):
    return {street_material_key(o): o for row in rows for o in row['objects']}


def street_svg(v, cell_m):
    a, b = v['line']
    mid_x, mid_y = (a['x'] + b['x']) / 2, (a['y'] + b['y']) / 2
    left, top = a['x'] - cell_m * 5, mid_y - cell_m * 11
    width, height = v['lengthM'] + cell_m * 10, cell_m * 22
    pattern_id = f'street-grid-{v["id"]}'
    parts = [f'<svg role="img" aria-label="{html.escape(v["title"])} generated street arrangement" viewBox="{left} {top} {width} {height}">',
             f'<defs><pattern id="{pattern_id}" width="{cell_m}" height="{cell_m}" patternUnits="userSpaceOnUse"><path d="M {cell_m} 0 H 0 V {cell_m}" fill="none" stroke="#bfd0b3" stroke-opacity=".08" stroke-width=".35"/></pattern></defs>',
             f'<rect x="{left}" y="{top}" width="{width}" height="{height}" fill="#172820"/>',
             f'<rect x="{left}" y="{top}" width="{width}" height="{height}" fill="url(#{pattern_id})"/>',
             f'<path d="M {a["x"]} {a["y"]} L {b["x"]} {b["y"]}" stroke="#786955" stroke-width="{v["roadWidthM"]}" stroke-linecap="round"/>',
             f'<path d="M {a["x"]} {a["y"]} L {b["x"]} {b["y"]}" stroke="#d5c3a2" stroke-opacity=".45" stroke-width=".5" stroke-dasharray="4 4"/>']
    for area in v.get('geography', []):
        points = ' '.join(f'{p["x"]},{p["y"]}' for p in area['points'])
        parts.insert(4, f'<polygon points="{points}" fill="#315c67"><title>Qualifying shore water used by the scenic classifier</title></polygon>')
    art_prefix = f'street-art-{v["id"]}'
    parts.append(sprite_symbols(street_materials([v]), art_prefix))
    for o in v['objects']:
        kind = o.get('crop', o['kind'])
        color = STREET_COLORS.get(kind, '#d4d4d4')
        size = cell_m * .8
        if o.get('_streetArt'):
            registry = art_registry()
            look = registry['crops'][kind]['looks'][o['_streetArt']]
            size = cell_m * registry['assets'][look['sheet']]['frameWidth'] * look['scale'] / 32
        if kind == 'tree':
            stage = str(max(1, min(3, round(o.get('variant', 2)))))
            size = cell_m * 1.8 * art_registry()['treeStages'][stage]['scale'] / art_registry()['treeStages']['3']['scale']
        label = html.escape(kind + (f' ({o["species"]})' if o.get('species') else '') + (f' · growth stage {o["variant"]}' if kind == 'tree' and 'variant' in o else ''))
        parts.append(f'<rect class="geometry-cell" x="{o["x"]-size/2}" y="{o["y"]-size/2}" width="{size}" height="{size}" rx=".8" fill="{color}"><title>{label}</title></rect>')
        parts.append(sprite_cell(art_prefix, street_material_key(o), o['x']-size/2, o['y']-size/2, size))
    for o in v['lairs']:
        x, y, r = o['x'], o['y'], cell_m * .6
        parts.append(f'<path d="M {x} {y-r} L {x+r} {y} L {x} {y+r} L {x-r} {y} Z" fill="none" stroke="#ff827b" stroke-width="1.2"><title>{html.escape(o["kind"])}; candidate site, not a creature position</title></path>')
    for lamp in v['lamps']:
        parts.append(f'<circle class="geometry-cell" cx="{lamp["x"]}" cy="{lamp["y"]}" r="2.5" fill="{v["lampGlow"]}" stroke="#182019" stroke-width=".6"><title>Street lamp: {v["lampGlow"]}</title></circle>')
        parts.append(art_image({'procedural': 'lamp:' + lamp['glow']}, f'class="sprite-cell" x="{lamp["x"]-cell_m}" y="{lamp["y"]-cell_m}" width="{cell_m*2}" height="{cell_m*2}"'))
    for p in (a, b):
        parts.append(f'<circle cx="{p["x"]}" cy="{p["y"]}" r="2" fill="#e1d1b4"><title>Source line endpoint</title></circle>')
    parts.append(f'<circle cx="{mid_x}" cy="{mid_y}" r="4" fill="none" stroke="#fff6ca" stroke-width="1"/><path d="M {mid_x-3} {mid_y} h 6 M {mid_x} {mid_y-3} v 6" stroke="#fff6ca" stroke-width=".8"><title>Road reference point; not a POI</title></path>')
    parts.append(f'<path d="M {left+7} {top+height-10} h {cell_m*5}" stroke="#c2cbb8"/><text x="{left+7}" y="{top+height-15}" fill="#c2cbb8" font-size="7">{cell_m*5:g} m · 5 cells</text></svg>')
    return ''.join(parts)


def street_section(streets):
    cards = []
    for v in streets['rows']:
        props = len(v['objects'])
        mix = collections.Counter(o.get('crop', o['kind']) for o in v['objects'])
        inventory = ', '.join(f'{n} {kind}' for kind, n in mix.items()) or 'No extra verge props'
        fauna = ', '.join(f'{kind} {chance*100:g}%' for kind, chance in v.get('attracts', {}).items()) or 'No street affinity'
        selection = 'Geography-selected path' if v['size'] == 'path' else f"{v['size']} street · {v['share']*100:g}% base share"
        scenic_details = (f'<dt>Geography</dt><dd>{html.escape(v["selection"])}</dd><dt>Rewards</dt><dd>{html.escape(v["rewards"])}</dd>' if v['size'] == 'path' else '')
        cards.append(f'''<article id="street-{v['id']}"><header><small>{selection} · {v['rung']}</small><h2>{html.escape(v['title'])}</h2></header><p class="mix"><b>{props} props over {v['lengthM']:g} m · {props/v['lengthM']*100:.1f} per 100 m in this sample</b><br>{inventory}</p><figure>{street_svg(v, streets['cellM'])}<figcaption>Generated straight-road sample · {v['roadWidthM']:g} m carriageway · ⊕ road reference point, not a POI</figcaption></figure><p>{html.escape(v['body'])}</p><dl>{scenic_details}<dt>Placement</dt><dd>{html.escape(v['placement'])}</dd><dt>Lamps</dt><dd>{len(v['lamps'])} shown · {v['lampSpacingM']:g} m target spacing · <span class="swatch" style="background:{v['lampGlow']}"></span>{v['lampGlow']}</dd><dt>Guard sites</dt><dd>{len(v['lairs'])} generated candidate sites · outlined diamonds</dd><dt>Slows</dt><dd>{', '.join(v['slowKinds']) or 'None'}</dd><dt>Fauna</dt><dd>{fauna}</dd><dt>Sample key</dt><dd>{v['sampleName']} · tile ({streets['fixture']['tx']}, {streets['fixture']['ty']})</dd></dl></article>''')
    legend = art_gallery(street_materials(streets['rows']), 'Street prop art', 'street-')
    legend += '<div class="legend art-thumbs">' + ''.join(f'<span><svg viewBox="0 0 64 64">{art_image({"procedural": "lamp:"+v["lampGlow"]}, chr(32).join(["width=64","height=64"]))}</svg>{html.escape(v["title"])}</span>' for v in streets['rows']) + '</div>'
    return f'''<section id="streets"><h1>{len(streets['rows'])} street and path variants</h1><p>Every shipping street and scenic path row from <code>StreetVariants.STREET_VARIANTS</code>. Samples use the real road rasterizer, street/scenic dressing and lamp-placement pass on a {streets['rows'][0]['lengthM']:g} m straight road, with an empty occupancy set. Street samples use public park ground; path fixtures provide actual water, greenway names or park polygons for the scenic classifier. Water appears blue in the promenade sample. Vista chests come from the generated scenic stretches, with their rules below. Props and lamps use their game art. With art switched off, squares are props and coloured circles are lamps. Tiny pale dots are source line ends, and outlined diamonds are guard candidate sites. The marked road midpoint is a reference point, not an interactable.</p><p>Minor roads have a fixed 40% theme roll; names change identity, not incidence. Golden Road is 2% of all minor keys. For neutral names: {streets['plainShare']['minor']*100:g}% of minor keys and {streets['plainShare']['major']*100:g}% of major keys remain unthemed. Long and tile-crossing roads retain their theme in deterministic patches, each at most {streets['maxVariantLengthM']:g} m, separated by plain gaps. Scenic paths use geography rather than the street-name roll, so their zero roll share is not a spawn probability. Rarity names come from the runtime table. Prop density is the observed sample, not an area-coverage target. Line-piece caps and spawn restrictions limit placement. Real terrain, occupied cells, bends and tile boundaries change the result. Fauna percentages relocate existing animals; guard sites are passed to the later lair spawner. Lamps show their configured colour; restoration and visit brightness are not simulated.</p><p><b>{html.escape(streets['baseline']['title'])}</b> is the background story for every major road, not another variant row: {html.escape(streets['baseline']['body'])} About {streets['wagonStopShare']*100:.1f}% of eligible bus stops wear its wagon look. The separate {streets['rockStreetShare']*100:g}% minor-street rock roll (excluding hedgerows), ambient plants, café hoards and fauna are not drawn here.</p><p><a href="street-variants.json">Generated street geometry and runtime rows</a> · <a href="#zones">Back to zone variants</a></p>{legend}<div class="cards">{''.join(cards)}</div></section>'''


def render(d, out):
    validate(d)
    helper = pathlib.Path(__file__).with_name('preview_street_variants.js')
    streets = json.loads(subprocess.check_output(['node', str(helper)], text=True))
    out.mkdir(parents=True, exist_ok=True)
    cards = []
    for v in d['variants']:
        b = v['background']
        mix = ', '.join(f'{n*100:.2f}'.rstrip('0').rstrip('.') + f'% {m.replace("_", " ")}' for m,n in b['materialDensity'].items())
        hazards = b.get('hazardDensity', {})
        if hazards:
            mix += '; hazards: ' + ', '.join(f'{n*100:g}% {m}' for m,n in hazards.items())
        coverage_label = 'interactables + ' + f'{sum(hazards.values())*100:g}% hazards' if hazards else ('expected' if b['type']=='seeded_scatter' or b.get('gapScatter') else 'nominal')
        mode = {'concentric_rings':'Three concentric rings · POI at common center', 'bounded_line_grid':f'{b.get("plots",[0,0])[0]} × {b.get("plots",[0,0])[1]} plots · POI centered in a plot', 'line_grid':f'Lines every {b.get("spacingCells")} cells · repeat to zone edge', 'seeded_scatter':'Seeded scatter · no repeating tile', 'repeat_motif':'Repeating cell pattern'}[b['type']]
        fauna = ', '.join(f'{kind} {chance*100:g}%' for kind,chance in v.get('attracts',{}).items()) or 'No zone affinity'
        guard = v['guards']; guard_text = 'None' if guard['mode'] == 'none' else (f'{guard["count"]} {guard["kind"]} at the find' if guard['mode']=='guard_find' else 'Ghosts on tombstone interaction')
        cards.append(f'''<article id="{v['id']}"><header><small>{v['zone']} · {mode}</small><h2>{v['name']}</h2></header><p class="mix"><b>{b['nominalDensity']*100:.2f}% {coverage_label} coverage</b><br>{mix}</p><div class="visual"><figure>{svg_for(v,d)}<figcaption>Background + POI arrangement</figcaption></figure><figure class="detail">{svg_for(v,d,True)}<figcaption>Outdoor POI close-up<br>● marked center · 1 cell = 7 m</figcaption></figure></div><p>{v['atmosphere']}</p><dl><dt>Alignment</dt><dd>{b["poiOrigin"]["role"].replace("_"," ")}</dd><dt>POI</dt><dd>{v['poi']['id'].replace('_',' ')}</dd><dt>Finds</dt><dd>{len(v['finds']['targets'])} {v['finds']['rarity']} · {v['finds']['material']}</dd><dt>Connection</dt><dd>{v['connection']['shape'].replace('_',' ')}</dd><dt>Guards</dt><dd>{guard_text}</dd><dt>Fauna</dt><dd>{fauna}</dd></dl></article>''')
    legend = art_gallery(d['materials'])
    legend += art_gallery({row['name']: {'kind': row['key']} for row in art_registry()['groveShrines']}, 'Grove POI art', 'poi-')
    page = '''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Zone and street variants · pattern review</title><style>
*{box-sizing:border-box}html{scroll-behavior:smooth}section{scroll-margin-top:70px}#streets{margin-top:56px}.swatch{display:inline-block;width:12px;height:12px;margin-right:5px}.page-nav{display:flex;flex-wrap:wrap;gap:20px;margin-bottom:24px}body{background:#101a15;color:#e5ecdf;font:16px system-ui;margin:32px auto;max-width:1420px;padding:0 24px}h1{font-size:34px}p{line-height:1.6}small,figcaption{font-size:12px;color:#b4c6b4}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,540px),1fr));gap:24px}article,.coverage{background:#1b2a21;padding:24px;border:1px solid #334a3a;border-radius:14px}article h2{margin:8px 0 0}article .mix{min-height:60px}.visual{display:grid;grid-template-columns:2fr 1fr;gap:16px;align-items:center}figure{margin:0}svg{width:100%;display:block}figcaption{margin-top:8px}.legend{display:flex;flex-wrap:wrap;gap:14px;margin:24px 0}.legend i{display:inline-block;width:12px;height:12px;margin-right:6px}a{color:#95d7d1}h2{font-size:23px}dl{display:grid;grid-template-columns:95px 1fr;gap:7px;font-size:14px}dt{color:#a8bbaa}dd{margin:0}.controls{display:flex;gap:24px;position:sticky;top:0;background:#101a15ed;padding:16px 0;z-index:1}.coverage{display:grid;grid-template-columns:1fr 1fr;gap:24px}.coverage svg{max-height:250px}body:has(#show-poi:not(:checked)) figure:not(.detail) .poi-layer{display:none}body:has(#show-bg:not(:checked)) .background{display:none}@media(max-width:640px){.coverage{grid-template-columns:1fr}.visual{grid-template-columns:2fr 1fr}body{padding:0 12px}}</style></head><body>'''
    page = page.replace('</style>', art_styles() + '</style>')
    counts = collections.Counter(v['zone'] for v in d['variants'])
    page += f'<nav class="page-nav"><a href="#zones">Zone variants</a><a href="#streets">Street variants</a><a href="#art-rubble">Rubble art</a><a href="art-direction.html">Palette and style</a><a href="nature-art.html">Nature and ruins candidates</a></nav><label class="art-switch"><input id="show-art" type="checkbox" checked> Show game art in patterns (off = colour geometry)</label><section id="zones"><h1>{len(d["variants"])} zone variants</h1><p>Runtime pattern table · {counts["grove"]} groves, {counts["stones"]} churchyards, {counts["tar"]} tar yards. These definitions drive live world generation. The diagrams show ideal geometry before terrain and occupied cells clip it.</p><p><a href="zone-variants.json">Complete JSON table</a> · <a href="zone-variants.md">Placement contract and summary</a></p>'
    page += '''<section class="coverage"><div><h2>Geometry first</h2><p>Density follows recognizable shapes; 15% is a guide, not a cap. Hedge Garden repeats to the zone edge; its preview shows 4 × 4 plots. Work Yard has a fixed 5 × 5 arrangement. Both grids have lines four cells apart. The POI fixes the phase of the entire grid.</p><h2>Cover the union</h2><p><b>Influence footprint ∪ associated park footprint ∪ its placement fringe.</b> The fringe includes the full 30 m placement reach, beyond the 12–20 m painted band. Count overlap once; apply the existing spawn restrictions afterward.</p><p>Without an associated park, use the influence footprint alone. Nearby unrelated parks do not expand the zone. Special finds remain one set per anchor.</p></div><svg viewBox="0 0 420 230" role="img" aria-label="Diagram of the union of influence area and park with fringe"><rect x="25" y="35" width="250" height="160" rx="28" fill="#749762" fill-opacity=".4" stroke="#a2c483" stroke-dasharray="5 4"/><rect x="48" y="58" width="204" height="114" rx="8" fill="#426e44"/><circle cx="285" cy="118" r="90" fill="#679fac" fill-opacity=".4" stroke="#8ac9da"/><circle cx="285" cy="118" r="5" fill="#fff6ca"/><g fill="#fff" font-size="14" font-family="system-ui"><text x="98" y="117">Park footprint</text><text x="40" y="25">30 m placement fringe</text><text x="270" y="104">Influence</text><text x="297" y="136">POI</text><text x="98" y="218">Schematic · not to scale</text></g></svg></section>'''
    page += legend+'<p>Backgrounds are representative unclipped samples. Hedge Garden shows a 4 × 4 sample of its repeating grid, with the POI at the center of plot (2, 2), counting from the top left. Work Yard shows its 5 × 5 footprint, with the POI in plot (3, 3). Every repeating motif is phased from its declared POI origin, not the image corner. The close-ups include the surrounding pattern. Only occupied POI slots replace background cells; no square clearing is cut out. The light circle with a cross is the POI point. Close-ups show the outdoor arrangement. Meadow has a radius-three grass disk; Flint Field has a radius-two flint disk. Both have one-cell rims of bushes or rubble; other variants use the eight cells touching the POI. Building POIs retain their wider frontage arrangement in the table. Finds, guards, fauna affinities and connection routes are listed but not drawn. Fauna percentages are chances to relocate existing animals onto eligible ground, not extra spawn rates. Obstacles and real zone boundaries will clip placement. Grid lines are unbroken except where POI space or an ineligible cell requires clearance.</p><div class="controls"><label><input id="show-poi" type="checkbox" checked> Show POI in background</label><label><input id="show-bg" type="checkbox" checked> Show background</label></div><main class="cards">'+''.join(cards)+'</main></section>'+street_section(streets)+art_script()+'</body></html>'
    (out/'index.html').write_text(page)
    (out/'street-variants.json').write_text(json.dumps(streets, indent=2)+'\n')
    (out/'zone-variants.json').write_text(json.dumps(d,indent=2)+'\n')
    print(f'Validated and rendered {len(d["variants"])} zone variants: {dict(counts)}; {len(streets["rows"])} street variants')


if __name__ == '__main__':
    source = pathlib.Path(sys.argv[1]) if len(sys.argv)>1 else pathlib.Path(__file__).resolve().parents[1]/'docs/zone-variants.json'
    output = pathlib.Path(sys.argv[2]) if len(sys.argv)>2 else pathlib.Path('/tmp/zone-variants-preview')
    render(json.loads(source.read_text()), output)
