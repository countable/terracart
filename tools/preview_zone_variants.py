#!/usr/bin/env python3
"""Render zone patterns and shipping street dressing on synthetic straight roads.
Usage: python3 tools/preview_zone_variants.py [table.json] [output-directory]
Requires Node.js and Pillow; sprite frames come directly from shipped assets.
"""
import collections
import copy
import datetime
import base64
import functools
import hashlib
import html
import io
import json
import math
import pathlib
import re
import subprocess
import sys

from PIL import Image
from preview_signature_candidates import signature_candidate
from preview_underground_zones import underground_section


@functools.lru_cache(maxsize=1)
def art_registry():
    helper = pathlib.Path(__file__).with_name('preview_variant_art.js')
    return json.loads(subprocess.check_output(['node', str(helper)], text=True))


@functools.lru_cache(maxsize=None)
def sprite_png(sheet, frame, preserve_frame=False, tint=0xffffff, palette_key=None):
    row = art_registry()['assets'][sheet]
    path = pathlib.Path(__file__).resolve().parents[1] / row['path'].split('?')[0]
    with Image.open(path) as source:
        image = source.convert('RGBA')
    if row['kind'] == 'spritesheet':
        w, h = row['frameWidth'], row['frameHeight']
        cols = image.width // w
        x, y = frame % cols * w, frame // cols * h
        rect = row.get('frameRects',{}).get(str(frame))
        if rect:
            x,y,w,h = rect['x'],rect['y'],rect['width'],rect['height']
        assert y + h <= image.height, (sheet, frame)
        image = image.crop((x, y, x + w, y + h))
    if sheet == 'stair_down':
        image = image.crop((0, 16, 32, 32))  # ASSETS.stair_down named down frame.
    # Match ASSETS.crops.onLoad; raw Crops.png has an opaque white key.
    if row['whiteKey']:
        image.putdata([(r, g, b, 0 if min(r, g, b) > 240 else a) for r, g, b, a in image.getdata()])
    palette = art_registry().get('enemyPalettes', {}).get(sheet)
    if palette_key:
        palette = next(row['palette'] for row in basic_signatures()['acceptedMechanics']['butterflies']['variants'] if row['id'] == palette_key)
    if palette:
        # Match assets.js recolorEnemyPixels: luminance ramp, not RGB tinting.
        stops = [tuple(bytes.fromhex(value.lstrip('#'))) for value in ['#000000', palette['shadow'], palette['mid'], palette['highlight']]]
        def recolor(pixel):
            r, g, b, alpha = pixel
            if not alpha:
                return pixel
            t = ((.2126*r + .7152*g + .0722*b) / 255) ** palette.get('gamma', 1) * 3
            segment = min(2, math.floor(t))
            fraction = t - segment
            return tuple(math.floor(a + (b-a)*fraction + .5) for a, b in zip(stops[segment], stops[segment+1])) + (alpha,)
        image.putdata([recolor(pixel) for pixel in image.getdata()])
    if tint != 0xffffff:
        tr, tg, tb = (tint >> 16) & 255, (tint >> 8) & 255, tint & 255
        image.putdata([(r*tr//255, g*tg//255, b*tb//255, a) for r,g,b,a in image.getdata()])
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
    if material.get('previewArt'): return material['previewArt']
    if material.get('recordType') == 'surface_trap':
        return {'procedural': 'trap_hidden', 'source': 'src/textures.js · hidden trap scuff', 'alternates': ['trap_open']}
    if material.get('barrelStyle'):
        return {'sheet': material['barrelStyle'], 'frames': [0]}
    kind = material['kind']
    if kind == 'wildplant' and material.get('gasEmitter') and material.get('crop') in r['gasMushrooms']:
        crop = 'giant_mushroom' if material.get('_zoneObjectFrame') == 40 else material['crop']
        art = r['gasMushrooms'][crop]
        return {'sheet': art['sheet'], 'frames': [art['frame']]}
    if material.get('_zoneObjectFrame') is not None:
        return {'sheet': 'zone_objects', 'frames': [material['_zoneObjectFrame']]}
    if kind == 'grove_shrine' and material.get('shrineKind'):
        return {'sheet': 'shrines', 'frames': [r['shrineKinds'][material['shrineKind']]['frame']]}
    if kind == 'zone_prop':
        return {'sheet': 'zone_objects', 'frames': [material['variant']]}
    if kind == 'headstone':
        return {'sheet': 'zone_objects', 'frames': [1]}
    if kind == 'stronghold_wall':
        return {'sheet': 'stronghold_wall', 'frames': [material.get('variant', 0)], 'preserveFrame': True}
    if kind in r['creatures']:
        creature = r['creatures'][kind]
        sheet, frames = creature['sheet'], [creature.get('directions', {}).get('down', {}).get('idle', [0])[0]]
    elif kind == 'wildplant':
        crop = material['crop']
        ov = r['crops'].get(crop)
        look = material.get('_plantArt') or material.get('_streetArt')
        if crop == 'shrub':
            if look == 'trimmed':
                look = 'clipped'
            if not look and not material.get('_cave') and material.get('_biome') in (5, 16):
                look = 'clipped'
        if look in r['contextLooks'] and r['contextLooks'][look]['crop'] == crop:
            ov = r['contextLooks'][look]
        elif ov and look:
            ov = ov.get('looks', {}).get(look, ov)
        if ov and ov.get('mature'):
            ov = ov['mature']
        if ov and ov.get('custom'):
            sheet, frames = ov['sheet'], ov.get('frames', [ov.get('frame', 0)])
        elif ov and ov.get('sheet') == 'springcrops':
            sheet, frames = 'springcrops', [ov['row'] * 14 + r['matureStage']]
        else:
            sheet, frames = 'crops', [r['cropRows'][crop] * r['cropColumns'] + r['matureStage']]
    elif kind == 'staircase':
        sheet, frames = ('stair_up' if material.get('dir') == 'up' else 'stair_down'), [0]
    elif kind == 'coindrop':
        sheet, frames = 'coin_drop', [0]
    elif kind == 'mineralrock':
        deposit = r['mineralDeposits'].get(material.get('deposit'))
        if deposit:
            sheet, frames = deposit['art']['sheet'], [deposit['art']['frame']]
        else:
            tier = material.get('yieldTier', 1)
            sheet = 'mineralrock'
            frames = [r['churchyardFrame'] if tier == 1 else r['mineralTiers'][str(tier)]['rockFrame']]
    elif kind == 'tree':
        species = material.get('species', 'maple')
        sheet = 'trees' if species == 'maple' else species + '_tree'
        # Explicit canopy sizes select authored growth frames for both species.
        stage = str(max(1, min(3, round(material.get('variant', 2)))))
        frames = [r['treeArt'][species][material['size']]['frame'] if material.get('size') else r['treeStages'][stage]['frame']]
    elif kind == 'fruittree':
        species = material.get('species', 'apple')
        sheet, frames = species + '_tree', [r['fruitFrames'][species]['mature']]
    else:
        sheet, frames = ('approved_charred_stakes' if kind == 'stakes' else kind), [0]
    assert sheet in r['assets'], f'No shipping art for {material}'
    return {'sheet': sheet, 'frames': frames, 'preserveFrame': kind == 'tree' or (kind == 'wildplant' and material.get('crop') in ('shrub', 'giant_mushroom')), 'tint': r['creatures'].get(kind, {}).get('tint', 0xffffff),
            'source': r['assets'][sheet]['path'].split('?')[0] + ' · frame ' + ', '.join(map(str, frames))}


def art_image(art, extra='', frame=None):
    if art.get('sheet') == 'chest':
        return f'<image data-chest-tier="{art["frames"][0] if frame is None else frame}" href="{sprite_png("chest", 0)}" {extra}/>'
    if art.get('procedural'):
        return f'<image data-procedural="{art["procedural"]}" {extra}/>'
    return f'<image href="{sprite_png(art["sheet"], art["frames"][0] if frame is None else frame, art.get("preserveFrame", False), art.get("tint", 0xffffff), art.get("paletteKey"))}" {extra}/>'


def sprite_symbols(materials, prefix):
    return '<defs>' + ''.join(f'<symbol id="{prefix}-{name}" viewBox="0 0 1 1">' +
        art_image(material_art(m), 'width="1" height="1" preserveAspectRatio="xMidYMid meet"') +
        '</symbol>' for name, m in materials.items()) + '</defs>'


def sprite_cell(prefix, material, x, y, size, definition=None):
    if definition and definition.get('kind') == 'wildplant' and definition.get('crop') in ('shrub', 'giant_mushroom'):
        art = material_art(definition)
        placement = art_registry()['plantPlacements'][art['sheet'] + ':' + str(art['frames'][0])]
        unit = size / .8 / art_registry()['cellPx']
        width, height = placement['width'] * unit, placement['height'] * unit
        cx, cy = x + size / 2, y + size / 2
        shadow = placement.get('shadow')
        shadow_svg = ''
        if shadow:
            for ring in range(12, 0, -1):
                t = ring / 12
                shadow_svg += f'<ellipse class="sprite-cell" cx="{cx}" cy="{cy + shadow["dyPx"] * unit}" rx="{shadow["width"] * unit * 30/64 * t}" ry="{shadow["height"] * unit * 15/32 * t}" fill="black" opacity="{shadow["alpha"] * (.05 + .16 * (1-t))}"/>'
        return shadow_svg + art_image(art, f'class="sprite-cell" x="{cx + placement["dxPx"] * unit - width / 2}" y="{cy + placement["dyPx"] * unit - height / 2}" width="{width}" height="{height}"')
    if definition and definition.get('kind') == 'tree' and definition.get('size'):
        factor = 48 * art_registry()['treeArt'][definition.get('species', 'maple')][definition['size']]['scale'] / 32
        x -= size * (factor - 1) / 2
        y -= size * (factor - 1)
        size *= factor
    glow = ''
    if definition and definition.get('kind') == 'wildplant':
        source = art_registry()['wildplantRules'].get(definition.get('crop'), {}).get('light')
        if source:
            light = art_registry()['lighting'][source]
            glow = light_guide(x+size/2,y+size/2,size/.8*light['radiusCells'],'#%06x' % light['colour'])
    if definition and definition.get('kind') == 'torch':
        light = art_registry()['lighting']['torch']
        glow = light_guide(x+size/2,y+size/2,size/.8*light['radiusCells'],'#%06x' % light['colour'])
    return glow + f'<use class="sprite-cell" href="#{prefix}-{material}" x="{x}" y="{y}" width="{size}" height="{size}"/>'


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
    return f'<section class="art-gallery"><h2>{title}</h2><p>Actual game sprite frames, including find materials. Thumbnails and pattern cells are enlarged to fit; their size is schematic. Tree fruit overlays and animation are not simulated; optional light guides show source colours and radii. Hover a pattern cell for its material; expand a source to see the sheet and frame.</p><div class="art-grid">{"".join(cards)}</div></section>'


def art_styles():
    return '''.art-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px}.art-item{background:#172820;border:1px solid #334a3a;border-radius:8px;padding:12px;overflow-wrap:anywhere}.art-item b,.art-item small{display:block}.art-thumbs{display:flex;flex-wrap:wrap;gap:4px;min-height:68px;align-items:center}.art-thumbs svg{width:64px;height:64px}.art-item details{font-size:11px;color:#a8bbaa;margin-top:8px}.art-item summary{cursor:pointer}.art-gallery{margin:28px 0}.sprite-cell{pointer-events:none}.sprite-cell,.art-thumbs image{image-rendering:pixelated}.geometry-cell{opacity:.12}body:has(#show-art:not(:checked)) .sprite-cell{display:none}body:has(#restored-pavement:checked) .pavement-worn,body:has(#restored-pavement:not(:checked)) .pavement-restored{display:none}body:has(#show-art:not(:checked)) .geometry-cell{opacity:1}body:has(#show-monsters:not(:checked)) .monster-layer,body:has(#show-lights:not(:checked)) .light-guide{display:none}.light-guide{pointer-events:none}.monster-layer{pointer-events:none}.art-switch{display:inline-block;padding:10px 14px;background:#263b2d;border-radius:8px}'''


def art_script():
    r = art_registry()
    # Self-contained Canvas2D painters: no network, Phaser or external assets.
    code = f'const UI_LAMP_GLOW={json.dumps(r["lampGlow"])}, UI_LAMP_GOLD={json.dumps(r["lampGold"])};\n' + r['painters']
    code += '\nconst WorldGen={PATH_CLASSES:new Set(' + json.dumps(r['pathClasses']) + '),T:{WATER:' + str(r['waterTerrain']) + '}};'
    code += '\nconst SpriteLayout={CELL_PX:' + str(r['cellPx']) + '};\n'
    code += r['variantSource'] + '\n' + r['roadPainter']
    code += '\nconst previewChestSheet=(()=>{'+r['chestPainter']+';return makeChestTierSheet;})();\n'
    code += '''
for(const image of document.querySelectorAll('[data-chest-tier]')) {
  const source=new Image();source.onload=()=>{
    const sheet=previewChestSheet(source),c=document.createElement('canvas');c.width=c.height=16;
    c.getContext('2d').drawImage(sheet,Number(image.dataset.chestTier)*16,0,16,16,0,0,16,16);
    image.setAttribute('href',c.toDataURL());image.dataset.chestReady='true';
  };source.src=image.getAttribute('href');
}
const baked = new Map();
const scene = {textures:{exists:key=>baked.has(key),createCanvas:(key,w,h)=>{
  const c=document.createElement('canvas');c.width=w;c.height=h;
  return {getContext:()=>c.getContext('2d'),refresh:()=>baked.set(key,c.toDataURL())};
}}};
makeTrapTextures(scene);
for(const image of document.querySelectorAll('[data-procedural]')){
  const key=image.dataset.procedural;
  if(!baked.has(key)&&key.startsWith('pavement:')){
    const [,variant,state,isPath]=key.split(':');
    const c=document.createElement('canvas');c.width=c.height=RoadOverlay.CLEAN_TILE_PX;
    RoadOverlay.paintPavementTile(c.getContext('2d'),RoadOverlay.CLEAN_TILE_PX,isPath==='true',state==='restored',variant);
    baked.set(key,c.toDataURL());
  }
  if(!baked.has(key)&&key.startsWith('lamp:')){
    const c=document.createElement('canvas');c.width=c.height=RoadOverlay.LAMP_TEX_PX;
    RoadOverlay.paintLamp(c.getContext('2d'),RoadOverlay.LAMP_TEX_PX,key.slice(5));baked.set(key,c.toDataURL());
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


@functools.lru_cache(maxsize=64)
def procedural_cells(settings):
    helper = pathlib.Path(__file__).with_name('preview_terrain_layout.js')
    points = json.loads(subprocess.check_output(['node', str(helper)], input=settings, text=True))
    return {(p['cx'], p['cy']): p for p in points}


def procedural_at(background, x, y):
    generator = background['generator']
    if background.get('repeat'):
        x, y = x % generator['width'], y % generator['height']
    settings = json.dumps({'generator': generator, 'materials': background['materials']}, sort_keys=True)
    return procedural_cells(settings).get((x, y))


def background_at(v, x, y):
    b = v['background']
    if b['type'] == 'procedural_layout':
        point = procedural_at(b, x, y)
        return point['material'] if point else None
    if b['type'] == 'seeded_scatter':
        density = b['nominalDensity']
        rows = b.get('rows')
        if rows:
            coordinate = x if rows['axis'] == 'vertical' else y
            if coordinate % rows['spacingCells'] >= rows['lineWidthCells']:
                return None
            density *= rows['spacingCells'] / rows['lineWidthCells']
        if hash_unit(v['id'], x, y, 'occupancy') >= density:
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
        for slot in b.get('slots', []):
            if slot['at'] == [x % step, y % step]:
                return cycle(slot['material'], x // step, y // step)
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
            material = cycle(slot['material'], x // w, y // h)
            keep = b.get('materialKeepChance', {}).get(material, 1)
            return material if keep >= 1 or hash_unit(v['id'], x, y, 'material-keep') < keep else None
    scatter = b.get('gapScatter')
    if scatter and hash_unit(v['id'], x, y, 'gap') < scatter['chance']:
        return scatter['material']
    return None


def validate(d):
    ids = [v['id'] for v in d['variants']]
    assert len(ids) == len(set(ids))
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
        assert v['finds']['count'] == len(v['finds']['targets']) and v['finds']['count'] >= 0
        if v['finds']['count']:
            assert v['finds']['material'] in d['materials']
        if v.get('generated'):
            assert not v['poi']['slots']
            if not v.get('quarryLayout'):
                assert not v['finds']['count'] and v['guards']['mode'] == 'none'
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
        if b['type'] == 'procedural_layout':
            generator = b['generator']
            width, height = generator['width'], generator['height']
            assert all(isinstance(n, int) and n >= 4 for n in (width, height))
            assert all(slot['material'] in d['materials'] and slot['share'] >= 0 for slot in b['materials'])
            counted = collections.Counter(background_at(v, x, y) for x in range(width) for y in range(height))
            for material, density in b['materialDensity'].items():
                assert abs(counted[material] / (width * height) - density) < 1e-9, (v['id'], material)
        elif b['type'] != 'seeded_scatter':
            period = (b['extentCells'][0] if b['type']=='concentric_rings' else b['spacingCells'] * b['plots'][0] + 1 if b['type']=='bounded_line_grid' else b.get('spacingCells', math.lcm(*b.get('repeatCells', [10]))) * 4)
            fixed = {**v, 'background': {k: value for k, value in b.items() if k not in ('gapScatter', 'materialKeepChance')}}
            if b['type'] == 'line_grid' and b.get('plotCenters'):
                fixed['background']['plotCenters'] = {**b['plotCenters'], 'excludePoiPlot': False}
            counted = collections.Counter(background_at(fixed, x, y) for x in range(period) for y in range(period))
            scatter = b.get('gapScatter')
            for material, density in {**b['materialDensity'], **b.get('hazardDensity',{})}.items():
                expected = counted[material] / period**2 * b.get('materialKeepChance', {}).get(material, 1)
                if scatter and material == scatter['material']:
                    expected += counted[None] / period**2 * scatter['chance']
                assert abs(expected - density) < 1e-9, (v['id'], material)


def treasure_mark(cx, cy):
    return f'<g class="treasure-mark"><circle cx="{cx}" cy="{cy}" r="4" fill="#c7b28a" opacity=".35"/><path d="M {cx-2.5} {cy-2.5} L {cx+2.5} {cy+2.5} M {cx+2.5} {cy-2.5} L {cx-2.5} {cy+2.5}" stroke="#2a1d10" stroke-width="1.1"><title>Extra buried treasure · one-off find</title></path></g>'


def light_guide(x, y, radius, color):
    # A guide to the real source radius/colour, not a day/night simulation.
    return f'<g class="light-guide"><circle cx="{x}" cy="{y}" r="{radius}" fill="{color}" fill-opacity=".09" stroke="{color}" stroke-opacity=".55" stroke-width=".6" stroke-dasharray="2 2"><title>Light extent guide</title></circle></g>'


def creature_at(kind, x, y, unit, label):
    art = material_art({'kind': kind})
    return f'<g class="monster-layer"><circle cx="{x}" cy="{y}" r="{unit*.52}" fill="#4a2527" fill-opacity=".75" stroke="#ff827b" stroke-width=".65"><title>{html.escape(label)}</title></circle>' + art_image(art, f'class="sprite-cell" x="{x-unit*.45}" y="{y-unit*.65}" width="{unit*.9}" height="{unit*.9}"') + '</g>'


def ground_pattern(terrain_name, prefix, unit):
    tile = next(t for t in art_registry()['terrainTiles'] if t['name'] == terrain_name)
    return (f'<defs><pattern id="{prefix}" patternUnits="userSpaceOnUse" width="{unit}" height="{unit}">'
            f'<rect width="{unit}" height="{unit}" fill="#{tile["color"]:06x}"/>'
            f'<image data-ground-type="{tile["type"]}" width="{unit}" height="{unit}"/></pattern></defs>')


def nexus_preview(svg, focus=None):
    """Show two thirds of the original cell span without rescaling the layout."""
    match = re.search(r'viewBox="([^"]+)"', svg)
    x, y, width, height = map(float, match.group(1).split())
    cropped_w, cropped_h = [max(1, round(span / 10 * 2 / 3)) * 10 for span in (width, height)]
    cx, cy = focus or (x + width / 2, y + height / 2)
    left = max(x, min(cx - cropped_w / 2, x + width - cropped_w))
    top = max(y, min(cy - cropped_h / 2, y + height - cropped_h))
    svg = svg[:match.start()] + f'viewBox="{left:g} {top:g} {cropped_w:g} {cropped_h:g}"' + svg[match.end():]
    # Percent-sized backgrounds otherwise shrink relative to the cropped view.
    return svg.replace('width="100%" height="100%"', f'width="{width:g}" height="{height:g}"')


def svg_for(v, d, detail=False, prefix="", ground=None, sample_cells=None):
    b = v['background']
    side = 9 if detail else (b['extentCells'][0] if b['type']=='concentric_rings' else b['spacingCells'] * b['previewPlots'][0] + 1 if b['type'] in ('line_grid', 'bounded_line_grid') else 25)
    if not detail and b['type'] == 'procedural_layout':
        side = max(b['generator']['width'], b['generator']['height'])
    if sample_cells is not None:
        side = sample_cells
    unit = 10
    center = side // 2
    aligned = b['type'] in ('line_grid','bounded_line_grid','concentric_rings','procedural_layout')
    poi_x, poi_y = b['poiOrigin']['cell']
    draw_x, draw_y = ([poi_x,poi_y] if aligned and not detail else [center,center])
    shipwreck = v['id'] == 'pirate_cove'
    shrine = v['zone'] in ('grove', 'beach')
    registry = art_registry()
    wreck = registry.get('shipwreckShrine')
    assert not shipwreck or wreck, 'Shipping shipwreck shrine art missing'
    reserve = (wreck.get('extentCells', 3) // 2) if shipwreck else 0
    def reserved(x, y):
        return shipwreck and (max(abs(x),abs(y)) <= reserve or (x == 0 and y == -reserve - 1))
    slots = [s for s in v['poi']['slots'] if not reserved(*s['at'])]
    parts = [f'<svg role="img" aria-label="{html.escape(v["name"])} {"POI pattern" if detail else "background and POI"}" viewBox="0 0 {side*unit} {side*unit}">', '<rect width="100%" height="100%" fill="#172820"/>']
    ground_id = f'{prefix}zone-ground-{v["id"]}-{int(detail)}'
    parts.append(ground_pattern(ground or v.get('ground') or ('SAND' if v['zone'] == 'beach' else registry['zoneKinds'][v['zone']]['terrain']), ground_id, unit))
    parts.append(f'<rect width="100%" height="100%" fill="url(#{ground_id})"/>')
    accent = registry['groundAccents'].get(v['id'])
    if accent:
        for y in range(side):
            for x in range(side):
                material = background_at(v, x + poi_x - draw_x, y + poi_y - draw_y)
                if accent.get('fullCoverage') or (v['id'] == 'silent_circle' and [x,y] == [draw_x,draw_y]) or (v['id'] == 'ancient_grove' and material in ('tree','shrub')):
                    parts.append(f'<rect x="{x*unit}" y="{y*unit}" width="{unit}" height="{unit}" fill="#{accent["color"]:06x}"/><image data-ground-type="{accent["terrain"]}" x="{x*unit}" y="{y*unit}" width="{unit}" height="{unit}"/>')
    art_prefix = f'{prefix}zone-art-{v["id"]}-{int(detail)}'
    materials = {name: dict(m, **({('_plantArt' if m['kind'] == 'wildplant' else '_objectArt'): v['materialLooks'][name]} if name in v.get('materialLooks', {}) else {})) for name, m in d['materials'].items() if m.get('recordType') != 'treasure'}
    for name, frames in v.get('materialFrames', {}).items():
        if name in materials: materials[name]['_zoneObjectFrame'] = frames[0]
    parts.append(sprite_symbols(materials, art_prefix))
    if not detail or b['type'] != 'seeded_scatter':
        parts.append('<g class="background">')
        for y in range(side):
            for x in range(side):
                if reserved(x-draw_x, y-draw_y):
                    continue
                gx, gy = x + poi_x - draw_x, y + poi_y - draw_y
                material = background_at(v, gx, gy)
                if material:
                    definition = materials[material]
                    if definition.get('recordType') == 'enemy':
                        parts.append(creature_at(definition['kind'], x*unit+5, y*unit+5, unit, 'Pattern carnivorous plant · persistent defeated state'))
                        continue
                    color = definition['color']
                    gap = 0 if b['type'] in ('line_grid','bounded_line_grid') and (gx % b['spacingCells'] == 0 or gy % b['spacingCells'] == 0) else 1
                    parts.append(f'<rect class="geometry-cell" x="{x*unit+gap}" y="{y*unit+gap}" width="{unit-2*gap}" height="{unit-2*gap}" fill="{color}"><title>{material}</title></rect>')
                    scale = procedural_at(b, gx, gy)['scale'] if b['type'] == 'procedural_layout' else 1
                    size = (unit - 2) * scale
                    parts.append(sprite_cell(art_prefix, material, x*unit+unit/2-size/2, y*unit+unit/2-size/2, size, definition))
        parts.append('</g>')
    if v.get('footpaths'):
        config = v['footpaths']
        parts.append('<g class="background pressure-footpaths">')
        protected = {(draw_x, draw_y), *((draw_x+s['at'][0], draw_y+s['at'][1]) for s in slots)}
        for y in range(side):
            for x in range(side):
                gx, gy = x + poi_x - draw_x, y + poi_y - draw_y
                if (x,y) in protected or background_at(v, gx, gy): continue
                if gx % config['spacingCells'] and gy % config['spacingCells']: continue
                if hash_unit(v['id'], gx, gy, 'footpath') < config['gapChance']: continue
                parts.append('<g><title>Pressure plate · raises one ghost and stays depressed</title>' +
                    art_image({'sheet': 'cave_mechanisms', 'frames': [2]},
                        f'class="sprite-cell" x="{x*unit}" y="{y*unit}" width="{unit}" height="{unit}"') + '</g>')
        parts.append('</g>')
    # Finite dressing has its own budget in the runtime row, outside the motif.
    if not detail and v.get('decorations'):
        seats = [(x, y) for y in range(2, side-2) for x in range(2, side-2)
                 if not reserved(x-draw_x, y-draw_y) and max(abs(x-draw_x), abs(y-draw_y)) > 3
                 and not background_at(v, x + poi_x - draw_x, y + poi_y - draw_y)]
        seats.sort(key=lambda cell: hash_unit(v['id'], *cell, 'decoration'))
        parts.append('<g class="background">')
        for decoration in v['decorations']:
            material = decoration['material']
            for _ in range(min(decoration['count'], len(seats))):
                x, y = seats.pop()
                if material == 'treasure_x':
                    parts.append(treasure_mark(x*unit+unit/2, y*unit+unit/2))
                else:
                    parts.append(sprite_cell(art_prefix, material, x*unit+1, y*unit+1, unit-2, materials[material]))
        parts.append('</g>')
    cx, cy = draw_x * unit + unit / 2, draw_y * unit + unit / 2
    parts.append('<g class="poi-layer">')
    for x,y in [(0,0)] + [slot['at'] for slot in slots]:
        parts.append(f'<rect x="{(draw_x+x)*unit}" y="{(draw_y+y)*unit}" width="10" height="10" fill="url(#{ground_id})"/>')
    for slot in slots:
        x, y = slot['at']; material = slot['material']; color = materials[material]['color']
        parts.append(f'<rect class="geometry-cell" x="{(draw_x+x)*unit+1}" y="{(draw_y+y)*unit+1}" width="8" height="8" fill="{color}"><title>POI: {material} ({x}, {y})</title></rect>')
        parts.append(sprite_cell(art_prefix, material, (draw_x+x)*unit+1, (draw_y+y)*unit+1, 8, materials[material]))
    light = registry['lighting']['shrine' if shrine else 'poi']
    color = '#%06x' % light['colour']
    parts.append(light_guide(cx,cy,unit*light['radiusCells'],color))
    if shrine:
        art = wreck if shipwreck else registry['groveShrines'][0]
        mapped = next((row for row in registry['shrineKinds'].values() if v['id'] in row.get('zoneVariants', [])), None)
        if not shipwreck and v.get('shrineFrame') is not None:
            art = {'key': 'zone_objects', 'frame': v['shrineFrame'], 'scale': 4 / 3}
        elif not shipwreck and mapped:
            art = {'key': 'shrines', 'frame': mapped['frame'], 'scale': 2}

        asset = registry['assets'][art['key']]
        # Preserve native sprite proportions and the shipping scale.
        width = asset.get('frameWidth',1536 if shipwreck else 48)*art['scale']/registry['cellPx']*unit
        height = asset.get('frameHeight',1024 if shipwreck else 48)*art['scale']/registry['cellPx']*unit
        parts.append(art_image({'sheet':art['key'],'frames':[art['frame']],'preserveFrame':True},f'class="sprite-cell" x="{cx-width/2}" y="{cy-height/2}" width="{width}" height="{height}"'))
    parts.append(f'<circle class="geometry-cell" cx="{cx}" cy="{cy}" r="4" fill="#fff6ca" stroke="#171b12" stroke-width=".8"><title>POI / settled interactable</title></circle>')
    parts.append('</g>')
    # Finds use the runtime radius-relative/plot-relative offsets. This ideal
    # anchor is unrotated; actual placement can relocate around blocked cells.
    targets = []
    radius = registry['zoneKinds'][v['zone']]['R'] / 7
    for target in v['finds']['targets']:
        if 'plot' in target:
            dx,dy = [math.floor((target['plot'][i]+.5)*b['spacingCells']-[poi_x,poi_y][i]+.5) for i in (0,1)]
        else:
            dx,dy = [math.floor(value*radius+.5) for value in target['radiusFraction']]
        targets.append((draw_x+dx, draw_y+dy))
    guard = v['guards']
    for n in range(guard.get('count',0)):
        if guard['mode'] not in ('guard_find','guard_poi'):
            continue
        x,y = (draw_x,draw_y) if guard['mode']=='guard_poi' else targets[n%len(targets)]
        if guard['mode']=='guard_find':
            material = v['finds']['targets'][n % len(targets)].get('material', v['finds']['material'])
            parts.append(sprite_cell(art_prefix, material, x*unit+1,y*unit+1,8,materials[material]))
            parts.append(f'<rect class="monster-layer" x="{x*unit}" y="{y*unit}" width="10" height="10" fill="none" stroke="#ffd68d" stroke-width=".6"><title>Guarded special find</title></rect>')
        dx,dy = guard['offsetCells'][n%len(guard['offsetCells'])]
        kinds = guard.get('choices') or guard.get('kinds') or [guard['kind']]
        kind = kinds[n%len(kinds)]
        parts.append(creature_at(kind,(x+dx)*unit+5,(y+dy)*unit+5,unit,kind.replace('_',' ')+' · declared guard offset; representative choice'))
    parts.append('</svg>')
    svg = ''.join(parts)
    return nexus_preview(svg, (cx, cy)) if not detail and sample_cells is None else svg


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
    if o.get('kind') == 'stakes' and o.get('_street') == 'burned':
        suffix += '_charred'
    return kind + suffix


def street_materials(rows):
    return {street_material_key(o): o for row in rows for o in row['objects']}


def street_svg(v, cell_m, detail=False):
    a, b = v['line']
    mid_x, mid_y = (a['x'] + b['x']) / 2, (a['y'] + b['y']) / 2
    left, top = a['x'] - cell_m * 5, mid_y - cell_m * 11
    width, height = v['lengthM'] + cell_m * 10, cell_m * 22
    if detail:
        left, top, width, height = mid_x - cell_m * 8, mid_y - cell_m * 5, cell_m * 16, cell_m * 10
    suffix = '-detail' if detail else ''
    pattern_id = f'street-grid-{v["id"]}{suffix}'
    parts = [f'<svg role="img" aria-label="{html.escape(v["title"])} generated street arrangement" viewBox="{left} {top} {width} {height}">',
             f'<defs><pattern id="{pattern_id}" width="{cell_m}" height="{cell_m}" patternUnits="userSpaceOnUse"><path d="M {cell_m} 0 H 0 V {cell_m}" fill="none" stroke="#bfd0b3" stroke-opacity=".08" stroke-width=".35"/></pattern></defs>',
             f'<rect x="{left}" y="{top}" width="{width}" height="{height}" fill="#172820"/>',
             f'<rect x="{left}" y="{top}" width="{width}" height="{height}" fill="url(#{pattern_id})"/>',
             f'<path d="M {a["x"]} {a["y"]} L {b["x"]} {b["y"]}" stroke="#786955" stroke-width="{v["roadWidthM"]}" stroke-linecap="round"/>',
             f'<path d="M {a["x"]} {a["y"]} L {b["x"]} {b["y"]}" stroke="#d5c3a2" stroke-opacity=".45" stroke-width=".5" stroke-dasharray="4 4"/>']
    # Rasterized terrain under the road uses the map's own palette and textures.
    terrain_tiles = {tile['type']: tile for tile in art_registry()['terrainTiles']}
    ground = []
    for terrain_type in sorted({v['baseTerrain']} | {cell['type'] for cell in v['groundCells']}):
        tile = terrain_tiles[terrain_type]
        pid = f'street-ground-{v["id"]}-{terrain_type}{suffix}'
        colour = f'#{tile["color"]:06x}'
        ground.append(f'<defs><pattern id="{pid}" patternUnits="userSpaceOnUse" width="{cell_m}" height="{cell_m}"><rect width="{cell_m}" height="{cell_m}" fill="{colour}"/><image data-ground-type="{terrain_type}" width="{cell_m}" height="{cell_m}"/></pattern></defs>')
    base_pid = f'street-ground-{v["id"]}-{v["baseTerrain"]}{suffix}'
    ground.append(f'<rect x="{left}" y="{top}" width="{width}" height="{height}" fill="url(#{base_pid})"/>')
    for cell in v['groundCells']:
        tile = terrain_tiles[cell['type']]
        pid = f'street-ground-{v["id"]}-{cell["type"]}{suffix}'
        ground.append(f'<rect class="terrain-cell" x="{cell["x"]}" y="{cell["y"]}" width="{cell_m}" height="{cell_m}" fill="url(#{pid})"><title>{tile["name"].replace("_", " ").title()} ground</title></rect>')
    parts[2:3] = ground
    # The same procedural pavement tiles as the game, in both restoration states.
    for state in ['worn', 'restored']:
        pid = f'pavement-{v["id"]}-{state}{suffix}'
        painter = f'pavement:{v["id"]}:{state}:{str(v["size"] == "path").lower()}'
        tile_size = cell_m
        parts.append(f'<defs><pattern id="{pid}" patternUnits="userSpaceOnUse" width="{tile_size}" height="{tile_size}">' + art_image({'procedural': painter}, f'width="{tile_size}" height="{tile_size}"') + '</pattern></defs>')
        parts.append(f'<path class="sprite-cell pavement-{state}" d="M {a["x"]} {a["y"]} L {b["x"]} {b["y"]}" stroke="url(#{pid})" stroke-width="{v["roadWidthM"]}" stroke-linecap="round"/>')
    # Shipping carpet strokes appear below the hedge/grass sprite layer.
    for stroke in v.get('carpetStrokes', []):
        points = ' '.join(f'{point["x"]},{point["y"]}' for point in stroke['points'])
        parts.append(f'<polyline class="sprite-cell carpet-deco" points="{points}" fill="none" stroke="{stroke["colour"]}" stroke-width="{stroke["width"]}" stroke-opacity="{stroke["alpha"]}"><title>Shipping verge carpet decoration</title></polyline>')
    art_prefix = f'street-art-{v["id"]}{suffix}'
    parts.append(sprite_symbols(street_materials([v]), art_prefix))
    for o in v['objects']:
        kind = o.get('crop', o['kind'])
        color = STREET_COLORS.get(kind, '#d4d4d4')
        size = cell_m * .8
        if o.get('_streetArt') and kind != 'shrub':
            registry = art_registry()
            look = registry['crops'][kind]['looks'][o['_streetArt']]
            size = cell_m * registry['assets'][look['sheet']]['frameWidth'] * look['scale'] / 32
        if kind == 'tree':
            stage = str(max(1, min(3, round(o.get('variant', 2)))))
            size = cell_m * 1.8 * art_registry()['treeStages'][stage]['scale'] / art_registry()['treeStages']['3']['scale']
        label = html.escape(kind + (f' ({o["species"]})' if o.get('species') else '') + (f' · growth stage {o["variant"]}' if kind == 'tree' and 'variant' in o else ''))
        parts.append(f'<rect class="geometry-cell" x="{o["x"]-size/2}" y="{o["y"]-size/2}" width="{size}" height="{size}" rx=".8" fill="{color}"><title>{label}</title></rect>')
        parts.append(sprite_cell(art_prefix, street_material_key(o), o['x']-size/2, o['y']-size/2, size, o))
    for o in v['lairs']:
        x, y, r = o['x'], o['y'], cell_m * .6
        kinds = art_registry()['lairs']['kinds'].get(o.get('tier', o['kind']), [])
        if kinds:
            count = art_registry()['lairs']['counts'].get(o.get('tier', o['kind']), 1)
            for n in range(count):
                offset = (n - (count - 1) / 2) * cell_m
                parts.append(creature_at(kinds[n % len(kinds)],x+offset,y,cell_m,f'Representative guard {n+1} of {count} at candidate anchor; actual seat may move'))
        parts.append(f'<path class="monster-layer" d="M {x} {y-r} L {x+r} {y} L {x} {y+r} L {x-r} {y} Z" fill="none" stroke="#ff827b" stroke-width="1.2"><title>{html.escape(o["kind"])}; candidate site, not a creature position</title></path>')
    for lamp in v['lamps']:
        parts.append(light_guide(lamp['x'],lamp['y'],cell_m*art_registry()['lighting']['cobble']['radiusCells'],lamp['glow']))
        parts.append(f'<circle class="geometry-cell" cx="{lamp["x"]}" cy="{lamp["y"]}" r="2.5" fill="{v["lampGlow"]}" stroke="#182019" stroke-width=".6"><title>Street lamp: {v["lampGlow"]}</title></circle>')
        lamp_size = cell_m * art_registry()['lampDrawCells']
        parts.append(art_image({'procedural': 'lamp:' + lamp['glow']}, f'class="sprite-cell" x="{lamp["x"]-lamp_size/2}" y="{lamp["y"]-lamp_size*art_registry()["lampGroundFrac"]}" width="{lamp_size}" height="{lamp_size}"'))
    for p in (a, b):
        parts.append(f'<circle cx="{p["x"]}" cy="{p["y"]}" r="2" fill="#e1d1b4"><title>Source line endpoint</title></circle>')
    if not detail:
        parts.append(f'<circle cx="{mid_x}" cy="{mid_y}" r="4" fill="none" stroke="#fff6ca" stroke-width="1"/><path d="M {mid_x-3} {mid_y} h 6 M {mid_x} {mid_y-3} v 6" stroke="#fff6ca" stroke-width=".8"><title>Road reference point; not a POI</title></path>')
    parts.append(f'<path d="M {left+7} {top+height-10} h {cell_m*5}" stroke="#c2cbb8"/><text x="{left+7}" y="{top+height-15}" fill="#c2cbb8" font-size="{2.2 if detail else 7}">{cell_m*5:g} m · 5 cells</text></svg>')
    return ''.join(parts)


def street_section(streets):
    cards = []
    for v in streets['rows']:
        props = len(v['objects'])
        mix = collections.Counter(o.get('crop', o['kind']) for o in v['objects'])
        inventory = ', '.join(f'{n} {kind}' for kind, n in mix.items()) or 'No extra verge props'
        fauna = 'Local inhabitants from habitat profiles'
        selection = 'Geography-selected path' if v['size'] == 'path' else f"{v['size']} street · {v['share']*100:g}% base share"
        tiers = sorted(set(o.get('tier',o['kind']) for o in v['lairs']))
        monsters = '; '.join(' or '.join(k.replace('_',' ') for k in art_registry()['lairs']['kinds'].get(t,[])) + f' · {art_registry()["lairs"]["counts"].get(t,1)} guard per eligible anchor' for t in tiers) or 'No variant-specific enemies'
        if tiers: monsters += '; stays defeated; placement and home safety can suppress guards'
        affinity = ', '.join(v.get('affinities', [])) or 'Neutral'
        affinity_details = f'<dt>Affinities</dt><dd>{html.escape(affinity)}</dd>' + (f'<dt>Selection</dt><dd data-affinity-row="{v["id"]}" data-road-size="{v["size"]}"></dd>' if v['size'] != 'path' else '')
        terrain_details = f'<dt>Terrain verge</dt><dd>{html.escape(v.get("terrain", "").replace("_", " ").title())} · {streets["terrainVergeCells"]:g} cells ({streets["cellM"]*streets["terrainVergeCells"]:g} m) beyond the road edge, on eligible ground. Special zones take precedence.</dd>'
        scenic_details = (f'<dt>Geography</dt><dd>{html.escape(v["selection"])}</dd><dt>Rewards</dt><dd>{html.escape(v["rewards"])}</dd>' if v['size'] == 'path' else '')
        cards.append(f'''<article id="street-{v['id']}"><p data-sandbox="road:{v['id']}"></p><header><small>{selection} · {v['rung']}</small><h2>{html.escape(v['title'])}</h2></header><p class="mix"><b>{props} props over {v['lengthM']:g} m · {props/v['lengthM']*100:.1f} per 100 m in this sample</b><br>{inventory}</p><figure>{street_svg(v, streets['cellM'])}<figcaption>Generated straight-road sample · {v['roadWidthM']:g} m carriageway · ⊕ road reference point, not a POI</figcaption></figure><details class="street-closeup"><summary>Pavement and lamp close-up</summary>{street_svg(v, streets['cellM'], True)}</details><p>{html.escape(v['body'])}</p><dl>{affinity_details}{terrain_details}{scenic_details}<dt>Placement</dt><dd>{html.escape(v['placement'])}</dd><dt>Lamps</dt><dd>{len(v['lamps'])} shown · {v['lampSpacingM']:g} m target spacing · <span class="swatch" style="background:{v['lampGlow']}"></span>{v['lampGlow']}</dd><dt>Monsters</dt><dd>{monsters}</dd><dt>Guard sites</dt><dd>{len(v['lairs'])} generated candidate sites · outlined diamonds</dd><dt>Slows</dt><dd>{', '.join(v['slowKinds']) or 'None'}</dd><dt>Fauna</dt><dd>{fauna}</dd><dt>Sample key</dt><dd>{v['sampleName']} · tile ({streets['fixture']['tx']}, {streets['fixture']['ty']})</dd></dl></article>''')
    legend = ''
    contexts = html.escape(json.dumps(streets['affinityContexts']), quote=True)
    affinity_controls = f'<div class="affinity-controls" data-affinity-contexts="{contexts}"><label>Surroundings <select id="affinity-context">' + ''.join(f'<option value="{key}">{key.title()}</option>' for key in streets['affinityContexts']) + '</select></label><p>Selection probabilities below are conditional on a road already being special, within its road size, with no street-name match. Change surroundings to compare soft preferences; the art fixtures stay the same. Scenic paths retain their geographic selection.</p></div>'
    affinity_script = """<script>(()=>{
const control=document.querySelector('[data-affinity-contexts]');
const contexts=JSON.parse(control.dataset.affinityContexts);
const select=document.getElementById('affinity-context');
function update(){for(const target of document.querySelectorAll('[data-affinity-row]')){
const row=contexts[select.value][target.dataset.roadSize].find(row=>row.id===target.dataset.affinityRow);
target.textContent=row.id==='golden' ? `Fixed rarity · ${(row.probability*100).toFixed(1)}% of special minor roads` : `${row.contextMultiplier.toFixed(2)}× surroundings weight · ${(row.probability*100).toFixed(1)}% of special ${target.dataset.roadSize} roads`;
}}
select.addEventListener('change',update);update();
})();</script>"""
    grouped = ''.join(f'<section id="roads-{size}"><h2>{label}</h2><div class="cards">' + ''.join(card for row, card in zip(streets['rows'], cards) if row['size'] == size) + '</div></section>' for size, label in [('minor', 'Minor roads'), ('major', 'Major roads'), ('path', 'Scenic paths')])
    return f'''<section id="streets"><h1>{len(streets['rows'])} street and path variants</h1><details><summary>How road samples are generated</summary><p>Every shipping street and scenic path row from <code>StreetVariants.STREET_VARIANTS</code>. Samples use the real road rasterizer, street/scenic dressing and lamp-placement pass on a {streets['rows'][0]['lengthM']:g} m straight road, with an empty occupancy set. Street samples begin on public park ground, then the shipping terrain pass paints each variant’s {streets['terrainVergeCells']:g}-cell verge before special-zone painting and surface dressing. Path fixtures provide actual water, greenway names or park polygons for the scenic classifier. Water appears blue in the promenade sample. Vista chests come from the generated scenic stretches, with their rules below. Props and lamps use their game art. With art switched off, squares are props and coloured circles are lamps. Tiny pale dots are source line ends, and outlined diamonds are guard candidate sites. The marked road midpoint is a reference point, not an interactable.</p><p>The independent rarity roll keeps {streets['plainShare']['minor']*100:g}% of minor keys and {streets['plainShare']['major']*100:g}% of major keys unthemed. Affinities and street names adjust the choice among special roads, without changing that rarity. Golden Road keeps its fixed 2% share of all minor keys. Long and tile-crossing roads retain their theme in deterministic patches, each at most {streets['maxVariantLengthM']:g} m, separated by plain gaps. Scenic paths use geography rather than the street-name roll, so their zero roll share is not a spawn probability. Rarity names come from the runtime table. Prop density is the observed sample, not an area-coverage target. Line-piece caps and spawn restrictions limit placement. Real terrain, occupied cells, bends and tile boundaries change the result. Fauna percentages relocate existing animals; guard sites are passed to the later lair spawner. Pavement and verge carpet decoration use the game’s painters, including carpet colour, width, soft edges and any symbols. Lamps show their restored art, configured colour and generated spacing; visit dimming is not simulated. A zone with a lamp tint overrides the street colour in the game.</p><p><b>{html.escape(streets['baseline']['title'])}</b> is the background story for every major road, not another variant row: {html.escape(streets['baseline']['body'])} About {streets['wagonStopShare']*100:.1f}% of eligible bus stops wear its wagon look. The separate {streets['rockStreetShare']*100:g}% minor-street rock roll (excluding hedgerows), ambient plants, café hoards and fauna are not drawn here.</p></details><p><a href="street-variants.json">Generated street geometry and runtime rows</a> · <a href="#zones">Back to zone variants</a></p>{legend}<label class="art-switch"><input id="restored-pavement" type="checkbox" checked> Restored pavement (off = worn)</label>{affinity_controls}{grouped}{affinity_script}</section>'''


@functools.lru_cache(maxsize=None)
def quarry_fixture(variant_id):
    helper = pathlib.Path(__file__).with_name('preview_quarry.js')
    return json.loads(subprocess.check_output(['node', str(helper)] + [variant_id], text=True))


def quarry_card(v, d):
    fixture = quarry_fixture(v['id'])
    source = pathlib.Path(__file__).resolve().parents[1] / 'docs/art/quarry-variants.draft.json'
    story_data = next(row for row in json.loads(source.read_text())['variants'] if row['id'] == v['id'])
    v = {**story_data, **v}
    unit, side = 10, fixture['side']
    prefix = v['id'] + '-art'
    definitions = {**d['materials'],
                   'tool_crate': {'kind':'box'}, 'barrel': {'kind':'barrel'}, 'goblin': {'kind':'goblin'}}
    names = {o['material'] for o in fixture['objects']}
    materials = {name: next(o for o in fixture['objects'] if o['material'] == name) for name in names if name != 'treasure_x'}
    parts = [f'<svg role="img" aria-label="{html.escape(v["name"])} layout" viewBox="0 0 {side*unit} {side*unit}">',
             '<rect width="100%" height="100%" fill="#172820"/>', sprite_symbols(materials, prefix)]
    parts.append(ground_pattern('RESIDENTIAL', prefix+'-outside', unit))
    parts.append(f'<rect width="100%" height="100%" fill="url(#{prefix}-outside)"/>')
    parts.append(ground_pattern('ROCK', prefix+'-ground', unit))
    ground = f'url(#{prefix}-ground)'
    for x,y in fixture['coverage']:
        parts.append(f'<rect x="{x*unit}" y="{y*unit}" width="{unit}" height="{unit}" fill="{ground}"/>')
    if fixture.get('terrain'):
        parts.append(ground_pattern('CAVE_LAVA', prefix+'-lava', unit))
    for terrain in fixture.get('terrain', []):
        x,y = terrain['cell']
        if terrain['kind'] == 'lava':
            parts.append(f'<rect class="lava-ground" x="{x*unit}" y="{y*unit}" width="{unit}" height="{unit}" fill="url(#{prefix}-lava)"><title>Lava · hazardous ground</title></rect>')
    for line in fixture['sourceLines']:
        points = ' '.join(f'{x*unit},{y*unit}' for x,y in line)
        parts.append(f'<polyline class="quarry-source" points="{points}" fill="none" stroke="#c3af76" stroke-width="1" stroke-dasharray="3 3"><title>Removed parking-lane source geometry</title></polyline>')
    for o in fixture['objects']:
        if o.get('coverRockId'): continue  # Still hidden beneath its intact rock.
        material = o['material']; x,y = o['cell']
        if material == 'treasure_x':
            parts.append(treasure_mark(x*unit+5, y*unit+5))
        else:
            parts.append(art_image(material_art(o), f'class="sprite-cell" x="{x*unit+1}" y="{y*unit+1}" width="{unit-2}" height="{unit-2}"'))
    parts.append('</svg>')
    labels = {'stone':'stone', 'crimson_ore':'Crimson ore', 'crystal':'Sapphire crystals',
              'copper_rock':'copper ore rocks', 'tool_crate':'one-off tool crates', 'chest':'T2 chests', 'clay_pot':'clay pots',
              'goblin':'lurking goblins', 'split_slime':'splitting slimes', 'treasure_x':'buried finds (covered marks hidden)', 'driftwood':'driftwood', 'stronghold_wall':'foundation walls', 'shrine':'daily shrine', 'stakes':'ground spikes (slow movement)'}
    counts = collections.Counter(o['material'] for o in fixture['objects'])
    actual = ' · '.join(f'{n} {labels.get(name,name)}' for name,n in counts.items())
    legend = []
    for name in counts:
        if name == 'treasure_x':
            swatch = '<span aria-hidden="true" style="color:#d5bd8d;font-size:22px">×</span>'
        else:
            swatch = '<svg viewBox="0 0 1 1" width="26" height="26" aria-hidden="true" style="width:26px;height:26px">'+art_image(material_art(materials[name]),'width="1" height="1"')+'</svg>'
        legend.append(f'<span style="display:inline-flex;align-items:center;gap:6px">{swatch}{html.escape(labels.get(name,name))}</span>')
    status = 'Implemented · runtime layout, forced variant comparison'
    metadata = ''.join(f'<dt>{label}</dt><dd>{html.escape(v[key])}</dd>' for label,key in [
        ('Layout','layoutDescription'), ('Hazards','hazardsDescription'),
        ('Lighting','lightingDescription'), ('After a visit','persistenceDescription')])
    if v.get('shrineChance') and v['layout'] != 'crater': metadata = metadata.replace(html.escape(v['lightingDescription']), 'Ember altar glow when present; nearby street lamps retain their ordinary behavior.')
    metadata += f'<dt>Guards</dt><dd>Up to {v["guards"].get("count", 0)} per complete site.</dd>'
    if v.get('buriedTreasureChance'):
        metadata += f'<dt>Buried finds</dt><dd>{v["buriedTreasureChance"]*100:g}% chance beneath each ordinary stone. Hidden until that stone is mined; each find pays once.</dd>'
    else:
        metadata += f'<dt>Finite finds</dt><dd>Up to {v["finds"]["count"]} per complete site; actual placements counted below.</dd>'
    rules = art_registry()['quarryRockRules']
    metadata += f'<dt>Mining</dt><dd>Ordinary quarry stones cost {rules["energyMul"]:g}× mining energy and yield {rules["stones"]} stone. The first mined surface rock guarantees the quarry’s assigned gem; later rocks have an additional {art_registry()["quarryGemChance"]*100:g}% chance for that gem.</dd>'
    if v['layout'] == 'crater':
        metadata += '<dt>Shrine</dt><dd>Ember altar on the dry centre of the lava pool. Cross hazardous lava to reach its daily boon.</dd>'
    elif v.get('shrineChance'):
        metadata += f'<dt>Shrine</dt><dd>{v["shrineChance"]*100:g}% chance of an Ember altar at each complete site, when a safe empty seat exists. Daily boon.</dd>'

    story = f'<p><strong>Place in the story.</strong> {html.escape(v["storyConnection"])}</p>'
    note = '<p><small>Copper ore rocks use normal mining; each one-off tool crate contains an iron pick.</small></p>' if v['layout']=='abandoned' else ''
    if v.get('buriedTreasureChance'): note += '<p>Covered treasure is counted below but its X stays hidden in the drawing until the covering rock is mined.</p>'
    if fixture.get('terrain'):
        actual += f' · {len(fixture["terrain"])} lava cells'
    shortfalls = [reason for row in fixture['diagnostics'] for reason in row.get('shortfalls', [])]
    if shortfalls:
        note += '<p>Placement shortfalls: ' + html.escape(', '.join(shortfalls)) + '</p>'
    return f'''<article id="{v['id']}"><p data-sandbox="{v['zone']}"></p><header><small>{status}</small><h2>{html.escape(v['name'])}</h2></header><p>{html.escape(v['atmosphere'])}</p><figure>{nexus_preview(''.join(parts))}<figcaption>Central footprint view · one cell = 7 m · variant forced for comparison</figcaption></figure><div style="display:flex;flex-wrap:wrap;gap:8px 16px;margin:16px 0;font-size:12px">{''.join(legend)}</div>{story}<dl>{metadata}</dl><details><summary>What is shown in this sample</summary><p>{actual}</p><p><a href="{v['id']}.json">Generated objects and placement diagnostics</a></p><p>All placements fit the same generated parking-lane coverage. Positions, hazards, finite finds and guards come directly from the shipping world generator. Variant selection is overridden to compare all four layouts; this footprint need not qualify for each variant in live play. Optional dashed lines show the removed source lanes.</p>{note}</details></article>'''


def quarry_draft_section(d):
    # Preserve the established preview URL while displaying each runtime row once.
    q = d['quarryLayouts']
    return f'<div id="quarry-drafts"><h3>Parking-lot remnants · four stories</h3><p>Runtime layouts on one shared fixture, with the variant forced for comparison. In live play, narrow lots use compact quarry layouts or readable ruined wall fragments. Craters require at least {q["largeSiteMinCells"]} usable cells and a clear {q["broadPatchSizeCells"]}×{q["broadPatchSizeCells"]}-cell pocket. Ruins use nominal {q["foundationSizeCells"]}×{q["foundationSizeCells"]}-cell foundations; readable wall fragments can stop at buildings or site edges. Short gaps join only with supporting source geometry; roads, paths and water separate sites, while building holes stay clear.</p><label class="art-switch"><input id="show-quarry-source" type="checkbox"> Show original parking lanes</label><style>.quarry-source{{display:none}}body:has(#show-quarry-source:checked) .quarry-source{{display:inline}}</style></div>'


@functools.lru_cache(maxsize=1)
def basic_density_proposals():
    path = pathlib.Path(__file__).resolve().parents[1] / 'docs/data/basic-zone-density-proposals.json'
    data = json.loads(path.read_text())
    for group in ['zones', 'parkCharacters']:
        for row in data[group].values():
            assert all(0 <= value <= 100 for value in row['targetPct'].values())
            assert sum(row['targetPct'].values()) <= 100
    return data


def basic_density_table(current, proposal):
    targets = dict(proposal['targetPct'])
    for key, value in current['elements'].items():
        if key.startswith('street_') or key in proposal.get('preserveElements', []):
            targets[key] = value['coveragePct']
    keys = list(dict.fromkeys([*current['elements'], *targets]))
    labels = {'tree': 'Trees', 'fruittree': 'Fruit trees', 'plain_rock': 'Plain stone',
              'ore_rock': 'Ore rocks', 'street_plain_rock': 'Street rubble', 'street_ore_rock': 'Street ore', 'longgrass': 'Long grass', 'shrub': 'Shrubs / hedges',
              'forgetmenot': 'Forget-me-nots', 'clay_pot': 'Clay pots', 'barrel': 'Salvage barrels'}
    rows = []
    for key in keys:
        now = current['elements'].get(key, {}).get('coveragePct', 0)
        target = targets.get(key, 0)
        label = labels.get(key, key.replace('_', ' ').capitalize())
        rows.append(f'<tr><th scope="row">{html.escape(label)}</th><td>{now:.2f}%</td><td>{target:.2f}%</td></tr>')
    now, target = current['coveragePct'], sum(targets.values())
    rows.append(f'<tr class="density-total"><th scope="row">Occupied cells</th><td>{now:.2f}%</td><td>{target:.2f}%</td></tr>')
    rows.append(f'<tr><th scope="row">Open cells</th><td>{100-now:.2f}%</td><td>{100-target:.2f}%</td></tr>')
    bars = ''.join(f'<div class="density-bar-row density-{label.lower()}"><span>{label}</span><span class="density-bar" role="img" aria-label="{label}: {value:.2f}% occupied"><i style="width:{value:.3f}%"></i></span></div>' for label, value in [('Current', now), ('Target', target)])
    return bars + '<table class="density-table"><thead><tr><th>Element</th><th>Current</th><th>Target</th></tr></thead><tbody>' + ''.join(rows) + '</tbody></table>'


def basic_density_summary(terrain):
    registry = art_registry()
    samples = [r for r in registry['basicCoverage']['rows'] if r['terrain'] == terrain]
    proposals = basic_density_proposals()
    if terrain in ('FARMLAND', 'GOLF'):
        assert samples and not samples[0]['occupiedCells'] and not samples[0]['eligibleCells']
        return f'<div class="density-block" data-density="{terrain}"><strong>Private ground · empty</strong><p>All generated spawns: <b>0%</b>. Edges and mapped POI rewards are excluded too; a road or nexus overlay cannot reopen this ground.</p></div>'
    if not samples:
        note = 'Cave population uses separate level-dependent rules; not measured by these surface samples. No changes proposed.' if terrain.startswith('CAVE_') else 'No ordinary stationary biome fill; no changes proposed. Mapped places and roaming creatures are separate.'
        return '<div class="density-block"><p>' + note + '</p></div>'
    row = samples[0]
    proposal = proposals['zones'][terrain]
    details = ''
    if terrain == 'PARK':
        row = {'elements': {}, 'coveragePct': 0}
        targets = {}
        for sample in samples:
            character = sample['character']
            weight = registry['parkCharacterShares'][character]
            plan = proposals['parkCharacters'][character]
            row['coveragePct'] += sample['coveragePct'] * weight
            for key, value in sample['elements'].items():
                row['elements'].setdefault(key, {'coveragePct': 0})['coveragePct'] += value['coveragePct'] * weight
            for key, value in plan['targetPct'].items():
                targets[key] = targets.get(key, 0) + value * weight
            details += f'<details class="park-density" data-park-density="{character}"><summary>{character.title()} park · {weight*100:g}% selection weight</summary><p>{html.escape(plan["intent"])}</p>{basic_density_table(sample, plan)}</details>'
        proposal = {**proposal, 'targetPct': targets}
        details = '<p><small>Above: average weighted by park-character selection. Individual characters:</small></p>' + details
    return f'<div class="density-block" data-density="{terrain}"><h4>Coverage · measured vs target</h4>{basic_density_table(row, proposal)}<p class="density-intent">{html.escape(proposal["intent"])}</p>{details}</div>'


@functools.lru_cache(maxsize=1)
def basic_signatures():
    data = json.loads((pathlib.Path(__file__).resolve().parents[1] / 'docs/data/basic-zone-signatures.json').read_text())
    for level in ['common', 'uncommon', 'rare']:
        ids = [row['slots'][level]['proposedThing']['id'] for row in data['zones'].values() if not row['excluded']]
        assert len(ids) == len(set(ids)), f'Duplicate {level} signature'
        alternatives = [row['slots'][level]['newItemAlternative']['id'] for row in data['zones'].values() if not row['excluded'] and row['slots'][level].get('newItemAlternative')]
        assert len(ids + alternatives) == len(set(ids + alternatives)), f'Duplicate {level} alternative'
    return data


def signature_status(slot):
    labels = {'existing_exclusive': 'Existing habitat', 'shared': 'Shared · gap', 'gap': 'New placement idea'}
    return f'<span class="signature-status {slot["currentStatus"]}">{labels[slot["currentStatus"]]}</span>'


@functools.lru_cache(maxsize=None)
def proposal_art_uri(relative_path):
    root = pathlib.Path(__file__).resolve().parents[1]
    path = (root / relative_path).resolve()
    assert path.is_relative_to(root / 'docs/art/proposal-art'), 'Proposal art must be checked into docs/art/proposal-art'
    with Image.open(path) as source:
        image = source.convert('RGBA')
    assert image.getbbox(), f'Blank proposal art: {relative_path}'
    buf = io.BytesIO()
    image.save(buf, format='PNG')
    return 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode()


def signature_proposal_details(slot, compact=False):
    parts = []
    art = slot.get('artProposal')
    if art:
        art_note = ('<br><small>Item icon; world sprite still needed.</small>' if 'inventory-sized icon' in art['note'] else '') if compact else '<br>' + html.escape(art['note'])
        parts.append(f'<p class="proposal-art"><img src="{proposal_art_uri(art["path"])}" width="64" height="64" alt="{html.escape(slot["proposedThing"]["label"], quote=True)} proposal sprite"><span><b>Unused art candidate</b>{art_note}</span></p>')
    interaction = slot.get('interactionProposal')
    if interaction:
        status = {'new_behavior': 'New behavior required', 'new_loot_profile_existing_opened_state': 'New loot and ambush; existing one-time state', 'existing_handler_new_placement': 'Existing interaction; new placement', 'existing_path_new_art': 'Existing POI path; new altar treatment'}[interaction['mechanicStatus']]
        requirements = '' if compact else ' ' + html.escape(interaction['requires'])
        parts.append(f'<p><b>Interaction:</b> {html.escape(interaction["action"])}</p><p><small>{status}.{requirements}</small></p>')
    return ''.join(parts)


def signature_candidate_visual(slot, terrain, compact=False):
    candidate = signature_candidate(slot, terrain)
    if not candidate:
        return signature_proposal_details(slot, compact)
    art = candidate.get('art') or material_art(candidate['material'])
    picture = '<svg class="signature-sprite" width="64" height="64" viewBox="0 0 64 64" role="img" aria-label="' + html.escape(slot['proposedThing']['label'], quote=True) + '">' + art_image(art, 'width="64" height="64"') + '</svg>'
    note = f'<small>{html.escape(candidate["note"])}</small>' if candidate.get('note') else ''
    return f'<div class="signature-existing-art">{picture}<p><b>Interaction:</b> {html.escape(candidate["mechanic"])}</p>{note}</div>'


def signature_alternative(slot, compact=False):
    alternate = slot.get('newItemAlternative')
    if not alternate:
        return ''
    proposed = {**alternate, 'proposedThing': {'label': alternate['label']}}
    return '<div class="signature-alternative"><h5>New item proposal · ' + html.escape(alternate['label']) + '</h5>' + signature_proposal_details(proposed, compact) + '</div>'


def signature_overview_cell(slot, terrain):
    return ('<td data-signature-candidate="' + html.escape(slot['proposedThing']['id'], quote=True) + '"><b>'
            + html.escape(slot['proposedThing']['label']) + '</b><br>' + signature_status(slot)
            + signature_candidate_visual(slot, terrain, True) + signature_alternative(slot, True) + '</td>')


def basic_signature_card(terrain):
    row = basic_signatures()['zones'][terrain]
    if row['excluded']:
        return '<p class="signature-note">No signature slots: keep this ground unpopulated.</p>'
    parts = ['<div class="signature-card"><h4>Distinctive finds · ideas</h4>']
    for level, slot in row['slots'].items():
        condition = f'<p><small>{html.escape(slot["condition"])}</small></p>' if slot.get('condition') else ''
        parts.append(f'<details data-signature-level="{level}" data-signature-status="{slot["currentStatus"]}"><summary><b>{level.title()}</b> · {html.escape(slot["proposedThing"]["label"])}<br>{signature_status(slot)}</summary><p><b>Current:</b> {html.escape(slot["currentEvidence"])}</p><p><b>Suggestion:</b> {html.escape(slot["proposalAction"])}</p>{condition}{signature_candidate_visual(slot, terrain)}{signature_alternative(slot)}</details>')
    return ''.join(parts) + '</div>'


def accepted_signature_directions():
    data = basic_signatures()
    accepted = data.get('acceptedMechanics', {})
    if not accepted:
        return ''
    hive = data['zones']['ORCHARD']['slots']['uncommon']
    hive_picture = f'<img src="{proposal_art_uri(hive["artProposal"]["path"])}" width="64" height="64" alt="Orchard hive">'
    butterflies = accepted.get('butterflies', {})
    variants = []
    for row in butterflies.get('variants', []):
        art = {'sheet': 'butterfly', 'frames': [0]}
        if row.get('palette'):
            art['paletteKey'] = row['id']
        picture = '<svg width="64" height="64" viewBox="0 0 64 64" role="img" aria-label="' + html.escape(row['label']) + '">' + art_image(art, 'width="64" height="64"') + '</svg>'
        variants.append('<figure data-butterfly-preview="' + row['id'] + '">' + picture + '<figcaption><b>' + html.escape(row['label']) + '</b><br>' + html.escape(', '.join(row['zones']).replace('_', ' ').title()) + '</figcaption></figure>')
    bone = accepted.get('boneCache', {})
    bone_slot = data['zones']['CAVE_FLOOR']['slots']['common']
    bone_proposal = bone_slot.get('newItemAlternative', bone_slot)
    bone_picture = f'<img src="{proposal_art_uri(bone_proposal["artProposal"]["path"])}" width="64" height="64" alt="Cave bone cache">'
    profiles = art_registry()['containerLootProfiles']
    def shipping_mix(name):
        return ', '.join(f'{row["w"]*100:g}% {row["kind"]}' for row in profiles[name])
    bone_mix = ', '.join(f'{row["percent"]:g}% {row["kind"]}' for row in bone.get('loot', []))
    spring_cards = []
    for proposal in data.get('poiProposals', []):
        adapted = {**proposal, 'proposedThing': {'label': proposal['label']}}
        spring_cards.append('<article class="accepted-direction" data-accepted="spring"><h4>' + html.escape(proposal['label']) + ' · POI altar</h4>' + signature_proposal_details(adapted, True) + '<p><b>Placement:</b> Underground mirror of a surface park POI. Keep its identity through deeper cave levels; reuse the existing daily-visit and shrine reward helpers. Replaces that POI’s ordinary cave chest. No uncommon floor scatter.</p></article>')
    return ('<section id="accepted-signature-directions"><h3>Accepted directions · mechanic and art review</h3><p>These are design specifications, not new live spawns. Hive and bone art are retained; the spring moves to the park POI’s underground mirror. Colored butterflies share the existing capture and pollination behavior.</p><div class="accepted-directions">'
        + '<article class="accepted-direction" data-accepted="hive"><h4>Orchard hive</h4>' + hive_picture + '<p>' + html.escape(butterflies.get('beeAudit', '')) + '</p><p>' + html.escape(hive['interactionProposal']['action']) + '</p><small>Hive interaction and honey rewards still need implementation. A bee creature would require new art and behavior. Orchard edges only.</small></article>'
        + '<article class="accepted-direction" data-accepted="butterflies"><h4>Butterfly colors by habitat</h4><div class="butterfly-preview-grid">' + ''.join(variants) + '</div><p>' + html.escape(butterflies.get('mechanic', '')) + '</p><small>Color previews use the existing butterfly sprite. Keep forest, orchard and golf exclusions. Captured colors must survive inventory and release.</small></article>'
        + '<article class="accepted-direction" data-accepted="bone"><h4>Cave bone cache</h4>' + bone_picture + '<p><b>Proposed loot:</b> ' + html.escape(bone_mix) + '.</p><p><b>Skeleton: 25%</b> on first search, independently of the loot roll. One skeleton at most; opening and defeat persist through reloads.</p><p><b>Cave supplies:</b> torch, rope or trap-disarming kit. Magic finds are Scrolls of Bones. No produce, seeds, coins or mineral pool.</p><details><summary>Compare existing containers</summary><p><b>Barrel:</b> ' + html.escape(shipping_mix('barrel')) + '.</p><p><b>Clay pot:</b> ' + html.escape(shipping_mix('clay_pot')) + '.</p></details></article>'
        + ''.join(spring_cards) + '</div></section><style>.accepted-directions{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:16px;margin:20px 0}.accepted-direction{padding:16px;min-width:0}.accepted-direction img,.accepted-direction svg{image-rendering:pixelated}.butterfly-preview-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.butterfly-preview-grid figure{margin:0}.accepted-direction h4{margin:0 0 12px}.accepted-direction p{font-size:13px}</style>')


def basic_signature_overview():
    data = basic_signatures()
    counts = collections.Counter(s['currentStatus'] for row in data['zones'].values() for s in row.get('slots', {}).values())
    rows = []
    for terrain, row in data['zones'].items():
        if row['excluded']:
            continue
        cells = ''.join(signature_overview_cell(row['slots'][level], terrain) for level in ['common', 'uncommon', 'rare'])
        rows.append(f'<tr><th><a href="#tile-{terrain.lower()}">{terrain.replace("_", " ").title()}</a></th>{cells}</tr>')
    return f'<details class="signature-overview" id="basic-signatures"><summary><strong>Common / uncommon / rare signature audit</strong> · {counts["existing_exclusive"]} existing habitats · {counts["shared"]} shared gaps · {counts["gap"]} placement ideas</summary><p>These are encounter-frequency proposals, separate from item quality and enemy tier. Each proposed thing is assigned to only one zone at the same encounter level. Existing habitat means the thing already has a distinctive ordinary habitat or stated context; it does not mean the proposed frequency band is enforced. Shared candidates need distribution changes; new placements need implementation. General chest loot, player planting and nexus contents do not establish basic-zone exclusivity. Each slot below shows its existing candidate or first proposal, with an art-backed new item alongside every unresolved shared slot. New-item mechanics are ideas, not live behavior.</p>{accepted_signature_directions()}<div class="signature-scroll"><table class="signature-table"><thead><tr><th>Zone</th><th>Common</th><th>Uncommon</th><th>Rare</th></tr></thead><tbody>{"".join(rows)}</tbody></table></div><p>Open a zone’s individual slots below for evidence, unused-art thumbnails and proposed interactions. Art proposals are not new live spawns; each states whether an existing interaction can be reused or new behavior is needed. <a href="basic-zone-signatures.json">Full audit</a> · <a href="proposal-art-license.txt">Proposal art licenses</a></p></details><style>.signature-overview{{margin:24px 0;padding:18px;border:1px solid #405745;border-radius:12px}}.signature-overview summary,.signature-card summary{{cursor:pointer}}.signature-scroll{{overflow:auto}}.signature-table{{width:100%;border-collapse:collapse;font-size:13px}}.signature-table td,.signature-table th{{text-align:left;padding:10px;border-bottom:1px solid #405745;min-width:280px;vertical-align:top}}.signature-table td{{width:30%}}.signature-table th{{min-width:100px}}.signature-sprite{{image-rendering:pixelated;display:block;margin:8px 0}}.signature-existing-art p{{margin:6px 0}}.signature-alternative{{border-top:1px dashed #6c7550;margin-top:16px;padding-top:8px}}.signature-alternative h5{{font-size:13px;color:#e6c779;margin:8px 0}}.signature-status{{display:inline-block;font-size:10px;margin:5px 0;color:#e6c779}}.signature-status.existing_exclusive{{color:#95d7d1}}.signature-status.gap{{color:#efb5a2}}.signature-card{{border-top:1px solid #405745;margin:16px 0;padding-top:4px}}.signature-card details{{margin:12px 0;font-size:13px}}.proposal-art{{display:flex;gap:12px;align-items:center}}.proposal-art img{{image-rendering:pixelated;flex:none}}.signature-card p,.signature-note{{font-size:12px}}</style>'


def basic_tile_section():
    cards = []
    for tile in art_registry()['basicTiles']:
        name = tile['name'].replace('_', ' ').title()
        examples = tile['examples'] + tile['creatureExamples']
        prefix = 'basic-' + tile['name'].lower()
        sample_height = max(144, math.ceil(len(examples)/4)*48)
        parts = [f'<svg data-basic-sample="{tile["name"]}" data-example-count="{len(examples)}" role="img" aria-label="{name}: representative spawned objects" viewBox="0 0 192 {sample_height}">',
                 ground_pattern(tile['name'], prefix, 32), f'<rect width="192" height="{sample_height}" fill="url(#{prefix})"/>']
        labels = []
        for i, example in enumerate(examples):
            label = example.get('crop') or example.get('species') or example['kind']
            if example['kind'] == 'mineralrock':
                label = 'beach rock' if example.get('_zoneObjectFrame') == 34 else 'plain rock' if example.get('caveVariant') is not None or example.get('yieldTier', 1) <= 1 else 'ore rock'
            if example.get('barrel'):
                label = 'clay pot' if example.get('barrelStyle') == 'clay_pot' else 'salvage barrel'
            label = label.replace('_', ' ')
            labels.append(label)
            x, y = (i % 4) * 48 + 8, (i // 4) * 48 + 8
            parts.append(f'<g data-example-kind="{example["kind"]}"><title>{html.escape(label)}</title>' + art_image(material_art(example), f'class="sprite-cell" x="{x}" y="{y}" width="32" height="32"') + '</g>')
        parts.append('</svg>')
        note = 'Examples: ' + ', '.join(dict.fromkeys(labels)) + '.' if labels else 'No ordinary objects or creatures spawn on this ground.'
        if tile['name'] == 'CAVE_FLOOR':
            note += ' Cave level 1: mushrooms and eligible cave enemies.'
        elif tile['name'] == 'PIER':
            note += ' Confirmed public piers only; private and unknown access exclude population.'
        elif tile['name'] == 'ORCHARD':
            note += ' Orchard edges only (about 14 m); interiors have no spawns. No rocks, bats, butterflies or spiders.'
        elif tile['name'] == 'PARK':
            note += ' One generated park character; other parks vary.'
        if tile['enemies']:
            note += ' Enemy appearance also depends on distance, time or cave depth.'
        cards.append(f'<article id="tile-{tile["name"].lower()}"><p data-sandbox="{tile["name"]}"></p><h3>{name}</h3>{"".join(parts)}<p>{html.escape(note)}</p>{basic_density_summary(tile["name"])}{basic_signature_card(tile["name"])}<small>Terrain {tile["type"]} · {tile["variants"]} texture variants</small></article>')
    return '<section id="basic-zones"><h2>Basic tile zones</h2><p>Shipping ground textures with representative spawned objects. Plants, trees and minerals come from the real world generator on small public-frontage terrain fixtures; wildlife and enemies use the owning spawn tables. Examples are arranged for visibility, not to predict density. Access restrictions, nearby buildings, roads and occupied cells still control live placement. Special nexus and road layouts have their own tabs.</p><p><strong>Measured coverage after tuning:</strong> percentage of eligible 7 m ground cells occupied by stationary plants, trees, rocks or pots. Current values come from eight generated public-frontage plots per terrain or park character, after spawn gates and collisions. They are comparison samples, not measured Kelowna coverage or visual canopy area. Roaming creatures above are not included in these percentages.</p><p><strong>Basic-zone updates are implemented.</strong> Targets are approximate occupied-cell budgets; the measured column shows what the generator actually placed. Ordinary street rubble is counted separately; it contains no ore and does not spawn in wetlands. Farm and golf have no spawns. Park splitting is deferred. The signature ideas below remain proposals. <a href="basic-zone-coverage.json">Measured counts and method</a> · <a href="basic-zone-density-proposals.json">Tuning targets</a></p>' + basic_signature_overview() + '<div class="tile-grid">' + ''.join(cards) + '</div></section>'


def basic_tile_script():
    registry = art_registry()
    script = registry['biomePainter'] + '\nconst tiles=' + json.dumps(registry['terrainTiles']) + ';'
    script += """
for (const canvas of document.querySelectorAll('[data-terrain]')) {
  const tile=tiles.find(row=>row.type===Number(canvas.dataset.terrain)),ctx=canvas.getContext('2d');
  ctx.fillStyle='#'+(tile.color??0x333333).toString(16).padStart(6,'0');
  ctx.fillRect(0,0,canvas.width,canvas.height);
  if(tile.variants)for(let y=0;y<3;y++)for(let x=0;x<6;x++) {
    const texture=document.createElement('canvas');texture.width=texture.height=32;
    drawBiomeTexture(texture.getContext('2d'),32,tile.type,(x+y)%tile.variants);
    ctx.drawImage(texture,x*32,y*32);
  }
}
const groundTextures = new Map();
for (const image of document.querySelectorAll('[data-ground-type]')) {
  const type=Number(image.dataset.groundType);
  if(!groundTextures.has(type)) {
    const tile=tiles.find(row=>row.type===type),texture=document.createElement('canvas');
    texture.width=texture.height=32;
    if(tile.variants)drawBiomeTexture(texture.getContext('2d'),32,type,0);
    groundTextures.set(type,texture.toDataURL());
  }
  image.setAttribute('href',groundTextures.get(type));
}
document.documentElement.dataset.tilesReady='true';
"""
    return '<script>(()=>{\n' + script.replace('</script', '<\\/script') + '\n})();</script>'


def beach_park_section(d):
    meadow = next((v for v in d['variants'] if v['id'] == 'marine_meadow'), None)
    if not meadow:
        return ''
    cards = []
    for beach in (v for v in d['variants'] if v['zone'] == 'beach'):
        prefix = 'adjoining-' + beach['id'] + '-'
        parts = [f'<svg role="img" aria-label="Marine Meadow adjoining {html.escape(beach["name"])} and water" viewBox="0 0 480 290">']
        for variant, x, width, ground in [(meadow, 0, 260, 'GRASS'), (beach, 260, 160, 'SAND')]:
            diagram = svg_for(variant, d, prefix=prefix, ground=ground, sample_cells=13)
            diagram = diagram.replace('width="100%" height="100%"', 'width="130" height="130"')
            diagram = diagram.replace('<svg role=', f'<svg x="{x}" y="25" width="{width}" height="260" style="overflow:hidden" role=', 1)
            # Thirteen rows at twice the old cell size; the eight-cell sand
            # strip keeps the meadow and waterline together in the close-up.
            if ground == 'SAND':
                diagram = diagram.replace('viewBox="0 0 130 130"', 'viewBox="25 0 80 130"', 1)
            parts.append(diagram)
        water_id = prefix + 'water'
        parts.append(ground_pattern('WATER', water_id, 20))
        parts.append(f'<rect x="420" y="25" width="60" height="260" fill="url(#{water_id})"/>')
        treasure = beach.get('shoreTreasure')
        tiers = [treasure['tier']] * treasure['count'] if treasure else beach.get('reef', {}).get('chestTiers', [])
        for i, tier in enumerate(tiers):
            y = 85 + i * 75
            parts.append(art_image({'sheet': 'chest', 'frames': [tier-1]}, f'class="sprite-cell" x="421" y="{y}" width="18" height="18"'))
            parts.append(f'<rect class="geometry-cell" x="421" y="{y}" width="18" height="18" fill="#f6d483"><title>T{tier} water-edge chest</title></rect>')
        parts.append('<g fill="#e5ecdf" font-size="11"><text x="8" y="16">Marine Meadow · grass</text>' + f'<text x="268" y="16">{html.escape(beach["name"])} · sand</text><text x="427" y="16">Water</text></g></svg>')
        chest_note = (' Water-edge finds: ' + ', '.join(f'T{tier}' for tier in tiers) + '.') if tiers else ''
        cards.append(f'<article id="adjoining-{beach["id"]}"><h3>Marine Meadow + {html.escape(beach["name"])}</h3><figure>{"".join(parts)}<figcaption>Close-up · 8-cell beach strip · one cell = 7 m</figcaption></figure><p>Grass keeps the meadow’s mixed coastal plants and objects; the adjoining sand keeps its beach identity.{chest_note}</p></article>')
    return '<section id="beach-parks"><h2>Beach parks · Marine Meadow</h2><p>A park adjoining a beach becomes a Marine Meadow. These representative layouts use the current grass, beach and shoreline definitions. Live boundaries, access restrictions and occupied cells clip placement; the samples do not reproduce a surveyed site.</p><div class="cards">' + ''.join(cards) + '</div></section>'


def viewer_navigation_script():
    return """<script>
(() => {
  const panels = [...document.querySelectorAll('[data-view-panel]')];
  const tabs = [...document.querySelectorAll('[data-view]')];
  function selectView() {
    const id = decodeURIComponent(location.hash.slice(1));
    const target = document.getElementById(id);
    const active = target?.closest('[data-view-panel]') || panels.find(p => p.id === 'basic-zones');
    for (const panel of panels) panel.hidden = panel !== active;
    for (const tab of tabs) {
      if (tab.dataset.view === active.id) tab.setAttribute('aria-current', 'page');
      else tab.removeAttribute('aria-current');
    }
    if (id === 'basic-signatures' && target) target.open = true;
    if (target && target !== active) requestAnimationFrame(() => target.scrollIntoView());
  }
  addEventListener('hashchange', selectView);
  selectView();
})();
</script>"""


def render(d, out):
    validate(d)
    d = {**d, 'variants': [v for v in d['variants'] if v.get('selectable', True) or v['id'] == 'marine_meadow']}
    helper = pathlib.Path(__file__).with_name('preview_street_variants.js')
    streets = json.loads(subprocess.check_output(['node', str(helper)], text=True))
    out.mkdir(parents=True, exist_ok=True)
    cards = []
    for v in d['variants']:
        b = v['background']
        if v.get('generated') == 'parking_lanes':
            cards.append(quarry_card(v, d))
            continue
        mix = ', '.join(f'{n*100:.2f}'.rstrip('0').rstrip('.') + f'% {m.replace("_", " ")}' for m,n in b['materialDensity'].items())
        hazards = b.get('hazardDensity', {})
        if hazards:
            mix += '; hazards: ' + ', '.join(f'{n*100:g}% {m}' for m,n in hazards.items())
        coverage_label = 'interactables + ' + f'{sum(hazards.values())*100:g}% hazards' if hazards else ('expected' if b['type']=='seeded_scatter' or b.get('gapScatter') else 'nominal')
        mode = {'concentric_rings':'Three concentric rings · POI at common center', 'bounded_line_grid':f'{b.get("plots",[0,0])[0]} × {b.get("plots",[0,0])[1]} plots · POI centered in a plot', 'line_grid':f'Lines every {b.get("spacingCells")} cells · repeat to zone edge', 'seeded_scatter':'Seeded scatter · no repeating tile', 'repeat_motif':'Repeating cell pattern', 'procedural_layout':'Shared procedural layout · repeat to zone edge'}[b['type']]
        fauna = 'Local inhabitants from habitat profiles'
        guard = v['guards']
        kinds = guard.get('kinds') or guard.get('choices') or [guard.get('kind', 'guard')]
        guard_text = 'None'
        if guard['mode'] in ('guard_find', 'guard_poi'):
            species = (' or ' if guard.get('choices') else ' + ').join(k.replace('_', ' ') for k in kinds)
            guard_text = f'{guard["count"]} ({species}) ' + ('at the POI' if guard['mode'] == 'guard_poi' else 'at the find')
            if guard.get('proximityCells'): guard_text += '; wakes on approach'
        elif guard['mode'] != 'none':
            guard_text = 'Ghosts on tombstone interaction'
        if guard.get('headstoneGhostChance'): guard_text += f'; {guard["headstoneGhostChance"]*100:g}% ghost chance on headstone interaction'
        if v.get('footpaths', {}).get('effect') == 'ghost':
            guard_text = ('' if guard_text == 'None' else guard_text + '; ') + 'One ghost per pressure plate; stays depressed after triggering'
        hazard = {**b.get('materialDensity', {}), **b.get('hazardDensity', {})}.get('carnivorous_plant', 0)
        if hazard and guard_text == 'None': guard_text = 'No finite guards'
        if hazard: guard_text += f'; static carnivorous plants on {hazard*100:.2f}% of motif cells'
        if guard.get('count') or hazard: guard_text += '; defeated guards/plants stay defeated'
        light = art_registry()['lighting']['shrine' if v['zone'] in ('grove','beach') else 'poi']
        light_color = '#%06x' % light['colour']
        light_text = f'{light["radiusCells"]:g}-cell ' + ('shrine glow; daily reward adds a POI light when available' if v['zone'] in ('grove','beach') else 'available-POI glow; consumed rewards extinguish it')
        find_counts = collections.Counter(t.get('material', v['finds']['material']) for t in v['finds']['targets'])
        find_text = ', '.join(f'{count} {material}' for material, count in find_counts.items())
        crops = {d['materials'][m].get('crop') for m in set(b['materialDensity']) | {slot['material'] for slot in v['poi']['slots']} | {v['finds']['material']}}
        for crop in sorted(c for c in crops if c):
            source = art_registry()['wildplantRules'].get(crop, {}).get('light')
            if source: light_text += f'; {crop} glow {art_registry()["lighting"][source]["radiusCells"]:g} cells'
        light_text += '; street lamps ' + (f'use zone tint {v["lampGlow"]} (overrides street)' if v.get('lampGlow') else 'retain street variant colour')
        shrine_row = next((r for r in art_registry()['shrineKinds'].values() if v['id'] in r.get('zoneVariants', [])), None)
        reward_row = art_registry()['shrineRewards'].get(v['id'])
        if reward_row:
            shrine_text = reward_row['name'] + ': ' + ('a full-screen coin burst, once per UTC day' if reward_row.get('fillScreen') else reward_row['reward'])
        elif shrine_row:
            shrine_text = shrine_row['name'] + ': ' + shrine_row.get('boon', shrine_row.get('lever', 'temporary')) + ' boon, once per UTC day'
        else:
            shrine_text = 'Daily treasure gift' if v['zone'] in ('grove', 'beach') else 'No additional shrine'
        reef_note = ''
        if v.get('reef'):
            reef = v['reef']
            reef_note = f'<p>Up to {reef["landOre"]["count"]} scattered pick-gated ore rocks on land; coral extends into nearby water with up to {len(reef["chestTiers"])} one-time T2–T3 chests within dry-shore reach.</p><svg viewBox="0 0 192 48">' + ''.join(f'<g transform="translate({i*48},0)">'+art_image({'sheet':'reef_coral','frames':[i]}, 'width="48" height="48"')+'</g>' for i in range(4)) + '</svg><p><a href="/zone-object-sheets/#live-mystic_reef">See the water treatment at a real site</a></p>'
        cards.append(f'''<article id="{v['id']}"><p data-sandbox="{v['zone']}"></p><header><small>{v['zone']} · {mode}</small><h2>{v['name']}</h2></header><p class="mix"><b>{b['nominalDensity']*100:.2f}% {coverage_label} coverage</b><br>{mix}</p><div class="visual"><figure>{svg_for(v,d)}<figcaption>Background + POI arrangement</figcaption></figure><figure class="detail">{svg_for(v,d,True)}<figcaption>Outdoor POI close-up<br>1 cell = 7 m</figcaption></figure></div><p>{v['atmosphere']}</p>{reef_note}<dl><dt>Traits</dt><dd>{html.escape(", ".join(art_registry()["zoneTraits"].get(v["id"], []))) or "Neutral"}</dd><dt>Alignment</dt><dd>{b["poiOrigin"]["role"].replace("_"," ")}</dd><dt>POI</dt><dd>{v['poi']['id'].replace('_',' ')}</dd><dt>Shrine</dt><dd>{html.escape(shrine_text)}</dd><dt>Finds</dt><dd>{html.escape(find_text)} · {v['finds']['rarity']}</dd><dt>Connection</dt><dd>{v['connection']['shape'].replace('_',' ')}</dd><dt>Monsters</dt><dd>{guard_text}</dd><dt>Lighting</dt><dd><span class="swatch" style="background:{light_color}"></span>{light_text}</dd><dt>Fauna</dt><dd>{fauna}</dd></dl></article>''')
    page = '''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Zone and street variants · pattern review</title><style>
*{box-sizing:border-box}html{scroll-behavior:smooth}section,article{scroll-margin-top:110px}section>h2{margin-top:32px}[hidden]{display:none!important}.view-tabs a[aria-current="page"]{background:#95d7d1;color:#101a15;font-weight:700}.page-nav a{padding:8px 12px;background:#23372b;border-radius:6px}.tile-grid{display:grid;align-items:start;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));gap:18px}.tile-grid canvas{width:100%;image-rendering:pixelated}.tile-grid article{padding:16px}.tile-grid h3{margin-top:0}.density-block{margin:18px 0;padding-top:12px;border-top:1px solid #405745}.density-block h4{margin:0 0 12px}.density-table{width:100%;border-collapse:collapse;font-size:12px;margin:12px 0}.density-table th,.density-table td{padding:6px 3px;border-bottom:1px solid #354b3d;text-align:right}.density-table th:first-child{text-align:left;font-weight:400}.density-table td:last-child{color:#e6c779}.density-total{font-weight:700}.density-bar-row{display:flex;gap:8px;align-items:center;font-size:11px;margin:5px 0}.density-bar-row>span:first-child{width:58px}.density-bar{flex:1;height:8px;background:#101a15;border-radius:3px;overflow:hidden}.density-bar i{display:block;height:100%;background:#95d7d1}.density-bar-row.density-target i{background:#e6c779}.density-intent{font-size:13px}.park-density{margin:12px 0;font-size:13px}.park-density summary{cursor:pointer}#streets{margin-top:56px}.swatch{display:inline-block;width:12px;height:12px;margin-right:5px}.page-nav{display:flex;flex-wrap:wrap;gap:20px;margin-bottom:24px}body{background:#101a15;color:#e5ecdf;font:16px system-ui;margin:32px auto;max-width:1420px;padding:0 24px}h1{font-size:34px}p{line-height:1.6}small,figcaption{font-size:12px;color:#b4c6b4}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,540px),1fr));gap:24px}article,.coverage{background:#1b2a21;padding:24px;border:1px solid #334a3a;border-radius:14px}article h2{margin:8px 0 0}article .mix{min-height:60px}.visual{display:grid;grid-template-columns:2fr 1fr;gap:16px;align-items:center}figure{margin:0}svg{width:100%;display:block}figcaption{margin-top:8px}.legend{display:flex;flex-wrap:wrap;gap:14px;margin:24px 0}.legend i{display:inline-block;width:12px;height:12px;margin-right:6px}a{color:#95d7d1}h2{font-size:23px}dl{display:grid;grid-template-columns:95px 1fr;gap:7px;font-size:14px}dt{color:#a8bbaa}dd{margin:0}.controls{display:flex;flex-wrap:wrap;gap:16px;position:sticky;top:0;background:#101a15ed;padding:16px 0;z-index:1}.coverage{display:grid;grid-template-columns:1fr 1fr;gap:24px}.coverage svg{max-height:250px}body:has(#show-poi:not(:checked)) figure:not(.detail) .poi-layer{display:none}body:has(#show-bg:not(:checked)) .background{display:none}@media(max-width:640px){.coverage{grid-template-columns:1fr}.visual{grid-template-columns:2fr 1fr}body{padding:0 12px}}</style></head><body>'''
    page = page.replace('</style>', art_styles() + '</style>')
    counts = collections.Counter(v['zone'] for v in d['variants'])
    category_names = {'grove': 'Groves and gardens', 'stones': 'Churchyards and stone', 'tar': 'Tar yards', 'beach': 'Beaches', 'quarry': 'Quarries'}
    categories = list(dict.fromkeys(v['zone'] for v in d['variants']))
    quick_links = ''.join(f'<a href="#category-{key}">{category_names.get(key, key.title())} ({counts[key]})</a>' for key in categories)
    if 'quarry' in categories:
        quick_links += '<a href="#quarry-drafts">Parking-lot stories (4)</a>'
    quick_links += '<a href="#beach-parks">Beach parks</a>'
    page += f'<h1>Zones and roads</h1><p>{len(d["variants"])} special zones · {len(streets["rows"])} road and path variants · basic terrain previews · <a href="/nexus-review/">See layouts at real sites</a></p><nav class="page-nav view-tabs" aria-label="Viewer sections"><a href="#basic-zones" data-view="basic-zones">Basic zones</a><a href="#streets" data-view="streets">Roads</a><a href="#zones" data-view="zones">Nexus</a><a href="#underground" data-view="underground">Underground</a></nav>'
    page += '<div class="controls"><label><input id="show-art" type="checkbox" checked> Game art</label><label><input id="show-monsters" type="checkbox" checked> Monsters</label><label><input id="show-lights" type="checkbox" checked> Light guides</label><label><input id="show-poi" type="checkbox" checked> POIs</label><label><input id="show-bg" type="checkbox" checked> Background</label></div>'
    generated_at = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%d %H:%M UTC')
    page += f'<p>Static snapshot generated {generated_at} from the checked-out game definitions and shipped art. This page does not fetch live game data; regenerate it after changes.</p>'
    page += '<section id="zones" data-view-panel hidden><h2>Nexus</h2><nav class="page-nav" aria-label="Nexus categories">' + quick_links + '</nav><p>Runtime definitions at generation time. Previews show representative patterns before terrain and occupied cells clip placement. <a href="zone-variants.json">Zone data</a></p>'
    for key in categories:
        page += f'<section id="category-{key}"><h2>{category_names.get(key, key.title())}</h2>'
        if key == 'quarry':
            page += quarry_draft_section(d)
        page += '<div class="cards">'
        page += ''.join(card for variant, card in zip(d['variants'], cards) if variant['zone'] == key)
        page += '</div></section>'
    page += beach_park_section(d) + '</section>' + street_section(streets).replace('<section id="streets">', '<section id="streets" data-view-panel hidden>') + basic_tile_section().replace('<section id="basic-zones">', '<section id="basic-zones" data-view-panel>') + underground_section(globals(), out) + viewer_navigation_script() + art_script() + basic_tile_script() + '</body></html>'
    (out/'index.html').write_text(page)
    def art_licenses(value):
        if isinstance(value, dict):
            if isinstance(value.get('artProposal'), dict) and value['artProposal'].get('license'):
                yield value['artProposal']['license']
            for child in value.values():
                yield from art_licenses(child)
        elif isinstance(value, list):
            for child in value:
                yield from art_licenses(child)
    repo = pathlib.Path(__file__).resolve().parents[1]
    license_paths = sorted(set(art_licenses(basic_signatures())))
    (out/'proposal-art-license.txt').write_text('\n\n'.join(path + '\n' + (repo/path).read_text() for path in license_paths))
    (out/'basic-zone-signatures.json').write_text(json.dumps(basic_signatures(), indent=2)+'\n')
    (out/'basic-zone-coverage.json').write_text(json.dumps(art_registry()['basicCoverage'], indent=2)+'\n')
    (out/'basic-zone-density-proposals.json').write_text(json.dumps(basic_density_proposals(), indent=2)+'\n')
    (out/'street-variants.json').write_text(json.dumps(streets, indent=2)+'\n')
    (out/'zone-variants.json').write_text(json.dumps(d,indent=2)+'\n')
    for variant in d['variants']:
        if variant.get('quarryLayout'):
            (out/(variant['id'] + '.json')).write_text(json.dumps(quarry_fixture(variant['id']), indent=2)+'\n')
    print(f'Validated and rendered {len(d["variants"])} zone variants: {dict(counts)}; {len(streets["rows"])} street variants')


if __name__ == '__main__':
    source = pathlib.Path(sys.argv[1]) if len(sys.argv)>1 else pathlib.Path(__file__).resolve().parents[1]/'docs/data/zone-variants.json'
    output = pathlib.Path(sys.argv[2]) if len(sys.argv)>2 else pathlib.Path('/tmp/zone-variants-preview')
    render(json.loads(source.read_text()), output)
