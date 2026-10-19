"""Static, tiled planning fixtures for the Nexus viewer's per-floor plan tab.

These compose existing sprite frames and approved wall materials, not live spawn
or terrain generation. Runtime definitions remain owned by their normal modules.
"""
import base64
import collections
import functools
import html
import hashlib
import io
import json
import re
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]


def ambient_layout_css():
    return '''.ambient-area{scroll-margin-top:90px;margin:28px 0}.ambient-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:14px}.ambient-card{margin:0;background:#171d27;border:1px solid #394456;border-radius:8px;padding:12px}.ambient-card h4{margin:0 0 10px}.ambient-card svg{width:100%;height:auto;image-rendering:pixelated;background:#20232b}.ambient-card p,.ambient-area>p{font-size:13px;line-height:1.5}.ambient-change{color:#f4cb70;text-decoration:underline dotted;text-underline-offset:3px}.ambient-spawn-key{display:flex;flex-wrap:wrap;gap:9px;align-items:center;font-size:12px}.ambient-spawn-key img{width:26px;height:26px;object-fit:contain;image-rendering:pixelated;vertical-align:middle}.ambient-caption{color:#abb7c8}.ambient-card .ambient-spec{font-size:12px;color:#bfc9d5}'''


@functools.lru_cache(maxsize=1)
def _themes():
    text = (ROOT / 'src/floor_wall_materials.js').read_text()
    return json.loads(re.search(r'const THEMES = (\[.*?\]);', text).group(1))


@functools.lru_cache(maxsize=None)
def _tile(index):
    with Image.open(ROOT / 'assets/Objects/Cave/floor-wall-sources.png') as sheet:
        image = sheet.crop((index * 16, 0, index * 16 + 16, 16))
    out = io.BytesIO()
    image.save(out, format='PNG')
    return 'data:image/png;base64,' + base64.b64encode(out.getvalue()).decode()


def _creatures(text, depth, variant):
    """Representative seats, not spawn budgets; exact proposed wording stays beside them."""
    if depth == 7:
        return ['red_dragon'] * 4 + ([] if 'hatchery' in variant.lower() or 'sleeping' in variant.lower() else ['red_demon'])
    words = text.lower()
    choices = [('vampire bat', 'vampire_bat'), ('skeleton soldier', 'skeleton_soldier'),
               ('mushroom monster', 'mushroom_monster'), ('fire elemental', 'fire_elemental'),
               ('cave slime', 'cave_slime'), ('giant crab', 'giant_crab'), ('jellyfish', 'jellyfish'),
               ('sea turtle', 'sea_turtle'), ('butterfl', 'butterfly'), ('rabbit', 'rabbit'),
               ('goblin', 'goblin'), ('spider', 'spider'), ('skeleton', 'skeleton'),
               ('zombie', 'zombie'), ('slime', 'slime'), ('bat', 'bat'), ('troll', 'troll'),
               ('infernal', 'red_demon'), ('undead', 'skeleton'), ('dog', 'dog'),
               ('cat', 'cat'), ('chicken', 'chicken'), ('cow', 'cow'), ('crab', 'crab'),
               ('deer', 'deer'), ('crow', 'crow')]
    selected = []
    for needle, kind in choices:
        if needle in words and kind not in selected:
            selected.append(kind)
            words = words.replace(needle, '')
    if depth:
        selected = [kind for kind in selected if kind != 'rabbit']
    # Surface variants have their own fauna; don't imply mushroom foes in orchards.
    if depth == 0 and 'mushroom' not in variant.lower():
        selected = [kind for kind in selected if kind != 'mushroom_monster']
    return selected[:4]


def _recipe(area, name, depth):
    """Authored fixture choices: shape, decorative prop, and deliberate arrangement."""
    word = name.lower()
    shape = {'grove': 'islands', 'stones': 'ring', 'tar': 'yard', 'beach': 'shore',
             'quarry': 'pit', 'grass': 'patches', 'residential': 'rooms', 'commercial': 'hall'}[area]
    prop = {'grove': 'tree', 'stones': 'headstone', 'tar': 'barrel', 'beach': 'driftwood',
            'quarry': 'mineralrock', 'grass': 'wildplant', 'residential': 'box', 'commercial': 'market_stand'}[area]
    if depth and prop == 'tree':
        prop = 'wildplant'
    if any(w in word for w in ['mushroom', 'fungal', 'fungus']): prop = 'mushroom'
    elif any(w in word for w in ['crystal', 'gem', 'mineral spire']): prop = 'crystal_cluster'
    elif any(w in word for w in ['hoard', 'treasure', 'gold fleck']): prop = 'coin_pile_6_10'
    elif any(w in word for w in ['shrine', 'sacred']): prop, shape = 'shrine', 'ring'
    elif 'orchard' in word and depth == 0: prop, shape = 'fruittree', 'rows'
    elif any(w in word for w in ['root', 'charred', 'scrub']): prop = 'stakes' if depth else 'wildplant'
    elif any(w in word for w in ['crypt', 'tomb', 'memorial', 'ancestor']): prop, shape = 'headstone', 'rows'
    elif 'forge' in word: prop = 'firepit'
    elif 'workshop' in word: prop = 'barrel'
    elif any(w in word for w in ['supply', 'storage', 'depot', 'warehouse']): prop = 'box'
    elif any(w in word for w in ['market', 'trading']): prop = 'market_stand'
    if any(w in word for w in ['shore', 'bank', 'landing', 'strand', 'reef', 'cove', 'quay']): shape = 'shore'
    elif any(w in word for w in ['cistern', 'spring', 'sump', 'pool', 'seep', 'flood']): shape = 'pool'
    elif any(w in word for w in ['fissure', 'crack', 'culvert', 'drain']): shape = 'channel'
    elif any(w in word for w in ['market', 'trading']): shape = 'rows'
    elif any(w in word for w in ['workshop', 'loading', 'yard']): shape = 'yard'
    elif any(w in word for w in ['gallery', 'hall', 'depot', 'warehouse']): shape = 'hall'
    elif any(w in word for w in ['dwelling', 'barracks', 'cellar', 'basement', 'shelter', 'alcove', 'chamber', 'den', 'hatchery']): shape = 'rooms'
    elif any(w in word for w in ['pit', 'sinkhole', 'crater']): shape = 'pit'
    elif any(w in word for w in ['bare', 'low fungal', 'carpet', 'ash', 'silt', 'gravel', 'meadow']): shape = 'patches'
    if depth == 5 and shape in ('rooms', 'hall'): shape = 'islands'
    return shape, prop


def _fixture(shape, depth, name):
    offset = int.from_bytes(hashlib.sha256(name.encode()).digest()[:2], 'big')
    cells = [['ground' for _ in range(12)] for _ in range(9)]
    for y in range(9):
        for x in range(12):
            edge = x in (0, 11) or y in (0, 8)
            if depth and depth != 5 and edge and not (y in (4, 5) or x in (5, 6)):
                cells[y][x] = 'wall'
            if shape == 'shore' and x < 3 + ((y + offset) // 3 % 2): cells[y][x] = 'water'
            if shape == 'pool' and 4 <= x <= 7 and 2 <= y <= 4: cells[y][x] = 'water'
            if shape == 'channel' and x in (4, 5) and y != 5: cells[y][x] = 'water'
            if shape == 'rooms' and depth != 5 and x in (4, 8) and y not in (4, 5): cells[y][x] = 'wall'
            if shape == 'hall' and depth != 5 and x in (2, 9) and y in (2, 6): cells[y][x] = 'wall'
            if shape == 'pit' and 3 <= x <= 8 and 2 <= y <= 6 and (x in (3, 8) or y in (2, 6)) and (x,y) != (5,6): cells[y][x] = 'accent'
            if shape in ('patches', 'islands') and (x*3 + y*5 + offset) % 11 < 3: cells[y][x] = 'accent'
            if shape == 'yard' and y in (3, 6): cells[y][x] = 'path'
            # The L4 road buffer stays visibly broad through every fixture.
            if depth == 4 and y in (4, 5, 6): cells[y][x] = 'path'
    return cells


def _material(prop):
    return {'kind': 'wildplant', 'crop': 'mushroom' if prop == 'mushroom' else 'shrub'} if prop in ('wildplant', 'mushroom') else {'kind': prop}


def _highlight(text, phrases):
    value = html.escape(text)
    for phrase in sorted(phrases, key=len, reverse=True):
        value = value.replace(html.escape(phrase), '<span class="ambient-change">' + html.escape(phrase) + '</span>')
    return value


def _card(area, layer, name, number, helpers):
    depth = int(layer['id'][1:])
    idea = area['ideas'][layer['id']]
    prefix = f"ambient-{layer['id']}-{area['id']}-{number}"
    shape, prop = _recipe(area['id'], name, depth)
    cells = _fixture(shape, depth, name)
    palette = ['#607544', '#655c50', '#82725d', '#766655', '#73768b', '#564c6a', '#393232', '#7866a0'][depth]
    water = '#c85d25' if depth == 6 else '#326f79' if depth < 5 else '#575d9a'
    theme = _themes()[depth - 1] if depth else None
    definitions = []
    if theme:
        for role in ('ground', 'face'):
            definitions.append(f'<pattern id="{prefix}-{role}" width="16" height="16" patternUnits="userSpaceOnUse"><image href="{_tile(theme[role])}" width="16" height="16"/></pattern>')
    tiles = []
    for y, row in enumerate(cells):
        for x, kind in enumerate(row):
            fill = water if kind == 'water' else '#%02x%02x%02x' % tuple(theme['cap']) if kind == 'wall' and theme else '#343d32' if kind == 'wall' else f'url(#{prefix}-ground)' if theme else palette
            tiles.append(f'<rect x="{x*24}" y="{y*24}" width="24" height="24" fill="{fill}" stroke="#141925" stroke-opacity=".14"/>')
            if kind in ('accent', 'path'):
                tiles.append(f'<rect x="{x*24}" y="{y*24}" width="24" height="24" fill="{palette}" opacity=".65"/>')
            if kind == 'wall' and theme:
                tiles.append(f'<rect x="{x*24}" y="{y*24+19}" width="24" height="5" fill="url(#{prefix}-face)"/>')
    positions = {'yard': [(2,1),(3,1),(8,7),(9,7)], 'patches': [(2,2),(8,6)], 'islands': [(2,2),(3,2),(8,6),(9,6)], 'pool': [(2,2),(9,2),(4,6),(8,7)], 'channel': [(2,1),(8,3),(2,7),(9,6)], 'pit': [(2,1),(9,1),(2,7),(9,7)], 'rows': [(2,2),(5,2),(8,2),(2,6),(5,6),(8,6)], 'ring': [(3,2),(6,1),(9,2),(3,6),(6,7),(9,6)],
                 'shore': [(5,1),(8,2),(5,7),(10,6)], 'hall': [(3,2),(8,2),(3,6),(8,6)],
                 'rooms': [(2,2),(6,2),(10,2),(2,7),(10,7)]}.get(shape, [(2,2),(8,2),(3,6),(9,6)])
    used = set()
    objects = []
    art = helpers['material_art'](_material(prop))
    definitions.append(f'<symbol id="{prefix}-prop" viewBox="0 0 1 1">{helpers["art_image"](art, "width=\"1\" height=\"1\"")}</symbol>')
    for x, y in positions:
        if cells[y][x] not in ('water', 'wall'):
            objects.append((y, f'<use href="#{prefix}-prop" x="{x*24-2}" y="{y*24-7}" width="29" height="31"/>'))
            used.add((x,y))
    creatures = _creatures(idea['spawn'], depth, name)
    seats = [(7,5),(3,4),(9,4),(5,7),(10,7),(6,3),(2,5),(8,7),(10,5)]
    for i, kind in enumerate(creatures):
        possible = [(x,y) for x,y in seats if (x,y) not in used and cells[y][x] not in ('water','wall')]
        if not possible: break
        x,y = possible[0]; used.add((x,y))
        art = helpers['material_art']({'kind':kind})
        uri = helpers['sprite_png'](art['sheet'], art['frames'][0], False, art.get('tint',0xffffff))
        size = 35 if kind == 'red_dragon' else 25
        objects.append((y, f'<g class="monster-layer" data-creature="{kind}"><title>{kind.replace("_"," ")}</title><ellipse cx="{x*24+12}" cy="{y*24+21}" rx="10" ry="4" fill="#000" opacity=".35"/><image href="{uri}" x="{x*24+12-size/2}" y="{y*24+22-size}" width="{size}" height="{size}"/></g>'))
    legend = []
    for kind, count in collections.Counter(creatures).items():
        art = helpers['material_art']({'kind':kind})
        uri = helpers['sprite_png'](art['sheet'], art['frames'][0], False, art.get('tint',0xffffff))
        legend.append(f'<span><img src="{uri}" alt="">{html.escape(kind.replace("_"," "))}{" ×"+str(count) if count > 1 else ""}</span>')
    title_class = ' class="ambient-change"' if any(name.lower() in phrase.lower() for phrase in idea.get('changes',{}).get('variants',[])) else ''
    return (f'<figure class="ambient-card"><h4{title_class}>{html.escape(name)}</h4><svg viewBox="0 0 288 216" role="img" aria-label="{html.escape(name)} static tiled planning fixture"><defs>{"".join(definitions)}</defs>{"".join(tiles)}{"".join(s for _,s in sorted(objects,key=lambda row:row[0]))}</svg>'
            f'<div class="ambient-spawn-key">{"".join(legend)}</div><p class="ambient-spec">{shape.title()} fixture · {html.escape(prop.replace("_"," "))} dressing · 12 × 9 tiles</p></figure>')


def ambient_floor_sections(helpers=None):
    """Return floor-id -> HTML, suitable for separately loaded floor fragments.

    The caller can pass its existing art helpers to share registry/cache work.
    """
    if helpers is None:
        from preview_zone_variants import art_registry, art_image, material_art, sprite_png
        helpers = dict(art_registry=art_registry, art_image=art_image, material_art=material_art, sprite_png=sprite_png)
    data = json.loads((ROOT / 'docs/art/ambient-layer-plan.json').read_text())
    result = {}
    for layer in data['layers']:
        parts = [f'<h2>{html.escape(layer["id"] + " · " + layer["name"])}</h2><p>{html.escape(layer["known"])}</p>',
                 '<p class="ambient-caption">Static tiled planning fixtures using shipped sprite frames. Creature seats illustrate the proposed candidates below; counts are for readability, not live density. L0 Nexus cards reuse the current Nexus review layouts unchanged; only the separate landcover cards are proposals. Gold dotted words change current behavior. Underground ground swatches are material studies; only L1 sewer channel water is integrated. L2 fixtures propose dressing only, preserving its existing terrain. L5 remains open.</p>']
        for area in data['areas']:
            idea = area['ideas'][layer['id']]
            if layer['id'] == 'L0' and area.get('surfaceVariants'):
                current = ''.join(f'<div data-current-variant="{v["id"]}"><a href="#{v["id"]}">View current {html.escape(v["name"])} layout</a></div>' for v in area['surfaceVariants'])
                parts.append(f'<section class="ambient-area" id="ambient-L0-{area["id"]}"><h3>{html.escape(area["name"])}</h3><p><b>Current Nexus layouts · retained.</b> These are the existing generated previews, not proposed replacements.</p><div class="cards">{current}</div></section>')
                continue
            names = []
            if not names:
                names = [n.strip().removeprefix('Keep ').removesuffix(' identities') for n in idea['variants'].split(' / ')]
            spawn = _highlight(idea['spawn'], idea.get('changes',{}).get('spawn',[]))
            variants = _highlight(idea['variants'], idea.get('changes',{}).get('variants',[]))
            parts.append(f'<section class="ambient-area" id="ambient-{layer["id"]}-{area["id"]}"><h3>{html.escape(area["name"])}</h3><p><b>Spawn direction:</b> {spawn}<br><b>Visual / layout direction:</b> {variants}</p><div class="ambient-cards">' + ''.join(_card(area, layer, name, i, helpers) for i,name in enumerate(names)) + '</div></section>')
        result[layer['id']] = ''.join(parts)
    return result
