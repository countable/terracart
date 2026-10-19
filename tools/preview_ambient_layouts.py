"""Static, tiled planning fixtures for the Nexus viewer's per-floor plan tab.

These compare the shared motif sampler and terrain generator using proposed
floor art; the previews do not change live spawn or terrain rules. Runtime definitions remain owned by their normal modules.
"""
import collections
import base64
import io
from PIL import Image
import functools
import html
import hashlib
import json
import subprocess
from pathlib import Path

from ambient_floor_art import art_for, floor_materials
from urllib.parse import quote

ROOT = Path(__file__).resolve().parents[1]


def ambient_layout_css():
    return '''.ambient-layout-toggle{display:flex;gap:6px;margin:8px 0}.ambient-layout-toggle button{padding:7px 12px;border:1px solid #687580;border-radius:5px;background:#263342;color:#e8edf1;cursor:pointer}.ambient-layout-toggle button[aria-pressed=true]{background:#a9d6cb;color:#10231e}.ambient-area{scroll-margin-top:90px;margin:28px 0}.ambient-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:14px}.ambient-card{margin:0;background:#171d27;border:1px solid #394456;border-radius:8px;padding:12px}.ambient-card h4{margin:0 0 10px}.ambient-card svg{width:100%;height:auto;image-rendering:pixelated;background:#20232b}.ambient-card p,.ambient-area>p{font-size:13px;line-height:1.5}.ambient-change{color:#f4cb70;text-decoration:underline dotted;text-underline-offset:3px}.ambient-spawn-key{display:flex;flex-wrap:wrap;gap:9px;align-items:center;font-size:12px}.ambient-spawn-key img{width:26px;height:26px;object-fit:contain;image-rendering:pixelated;vertical-align:middle}.ambient-caption{color:#abb7c8}.ambient-card .ambient-spec{font-size:12px;color:#bfc9d5}'''


def _swatch(color):
    out = io.BytesIO()
    Image.new('RGBA', (16, 16), color).save(out, format='PNG')
    return 'data:image/png;base64,' + base64.b64encode(out.getvalue()).decode()


def _blend_swatch(base, overlay):
    def decode(uri):
        return Image.open(io.BytesIO(base64.b64decode(uri.split(',', 1)[1]))).convert('RGBA')
    out = io.BytesIO()
    Image.blend(decode(base), decode(overlay), .65).save(out, format='PNG')
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


@functools.lru_cache(maxsize=None)
def _patterns(shape, depth, name):
    seed = int.from_bytes(hashlib.sha256(f'{depth}:{name}'.encode()).digest()[:4], 'big')
    payload = {'cells': _fixture(shape, depth, name), 'seed': seed}
    return json.loads(subprocess.check_output(['node', str(ROOT / 'tools/preview_ambient_patterns.js')], input=json.dumps(payload), text=True))


def _highlight(text, phrases):
    value = html.escape(text)
    for phrase in sorted(phrases, key=len, reverse=True):
        value = value.replace(html.escape(phrase), '<span class="ambient-change">' + html.escape(phrase) + '</span>')
    return value


def _layout_panel(area, layer, name, number, helpers, mode):
    depth = int(layer['id'][1:])
    idea = area['ideas'][layer['id']]
    prefix = f"ambient-{layer['id']}-{area['id']}-{number}-{mode}"
    shape, prop = _recipe(area['id'], name, depth)
    patterns = _patterns(shape, depth, name)
    cells = [row[:] for row in patterns['tile']]
    if mode == 'generated':
        cells = [['ground' if cell == 'accent' else cell for cell in row] for row in cells]
        for point in patterns['generated']:
            x, y = point['cx'], point['cy']
            if cells[y][x] == 'ground': cells[y][x] = 'accent'
    palette = ['#607544', '#655c50', '#82725d', '#766655', '#73768b', '#564c6a', '#393232', '#7866a0'][depth]
    water = '#c85d25' if depth == 6 else '#326f79' if depth < 5 else '#575d9a'
    theme = floor_materials(depth)
    definitions = []
    if theme:
        for role in ('ground', 'face', 'road', 'water', 'groundBroken', 'groundGrate'):
            if not theme.get(role): continue
            size = 24 if depth == 1 and role.startswith('ground') else 16
            definitions.append(f'<pattern id="{prefix}-{role}" width="{size}" height="{size}" patternUnits="userSpaceOnUse"><image href="{theme[role]}" width="{size}" height="{size}"/></pattern>')
    tiles = []
    for y, row in enumerate(cells):
        for x, kind in enumerate(row):
            fill = (f'url(#{prefix}-water)' if theme and theme['water'] else water) if kind == 'water' else '#%02x%02x%02x' % tuple(theme['cap']) if kind == 'wall' and theme else '#343d32' if kind == 'wall' else f'url(#{prefix}-ground)' if theme else palette
            if depth == 1 and kind not in ('water', 'wall'):
                fill = f"url(#{prefix}-{patterns['sewerGround'][y][x]})"
            tiles.append(f'<rect x="{x*24}" y="{y*24}" width="24" height="24" fill="{fill}" stroke="#141925" stroke-opacity=".14"/>')
            if depth != 1 and kind in ('accent', 'path'):
                accent = f'url(#{prefix}-road)' if theme and depth != 1 else palette
                tiles.append(f'<rect x="{x*24}" y="{y*24}" width="24" height="24" fill="{accent}" opacity=".65"/>')
            if kind == 'wall' and theme:
                tiles.append(f'<rect x="{x*24}" y="{y*24+19}" width="24" height="5" fill="url(#{prefix}-face)"/>')
    positions = {'yard': [(2,1),(3,1),(8,7),(9,7)], 'patches': [(2,2),(8,6)], 'islands': [(2,2),(3,2),(8,6),(9,6)], 'pool': [(2,2),(9,2),(4,6),(8,7)], 'channel': [(2,1),(8,3),(2,7),(9,6)], 'pit': [(2,1),(9,1),(2,7),(9,7)], 'rows': [(2,2),(5,2),(8,2),(2,6),(5,6),(8,6)], 'ring': [(3,2),(6,1),(9,2),(3,6),(6,7),(9,6)],
                 'shore': [(5,1),(8,2),(5,7),(10,6)], 'hall': [(3,2),(8,2),(3,6),(8,6)],
                 'rooms': [(2,2),(6,2),(10,2),(2,7),(10,7)]}.get(shape, [(2,2),(8,2),(3,6),(9,6)])
    if mode == 'generated':
        positions = [(point['cx'], point['cy']) for point in patterns['generated']
                     if cells[point['cy']][point['cx']] not in ('water', 'wall')][:6]
    used = set()
    objects = []
    scenario_props, scenario_creatures = [], []
    prop_art = art_for(depth, prop, helpers)
    definitions.append(f'<symbol id="{prefix}-prop" viewBox="0 0 1 1"><image href="{prop_art["uri"]}" width="1" height="1" preserveAspectRatio="xMidYMid meet"/></symbol>')
    for x, y in positions:
        if cells[y][x] not in ('water', 'wall'):
            objects.append((y, f'<use href="#{prefix}-prop" x="{x*24-2}" y="{y*24-7}" width="29" height="31"/>'))
            used.add((x,y))
            scenario_props.append({'x': x, 'y': y, 'kind': prop, 'artKey': 'dressing', **({'pushable': True} if depth == 1 and prop == 'box' else {})})
    block_art = art_for(1, 'box', helpers) if depth == 1 and prop != 'box' else None
    if block_art:
        block_seats = [(6,4), (7,6)] + [(x,y) for y in range(1,8) for x in range(1,11)]
        placed = 0
        for x,y in block_seats:
            if (x,y) in used or cells[y][x] in ('water','wall'): continue
            objects.append((y, f'<image href="{block_art["uri"]}" x="{x*24-2}" y="{y*24-7}" width="29" height="31"/>'))
            scenario_props.append({'x': x, 'y': y, 'kind': 'box', 'artKey': 'block', 'pushable': True})
            used.add((x,y)); placed += 1
            if placed == 2: break
    creatures = _creatures(idea['spawn'], depth, name)
    seats = [(7,5),(3,4),(9,4),(5,7),(10,7),(6,3),(2,5),(8,7),(10,5)]
    seats += [(x, y) for y in range(1, 8) for x in range(1, 11) if (x, y) not in seats]
    for i, kind in enumerate(creatures):
        possible = [(x,y) for x,y in seats if (x,y) not in used and cells[y][x] not in ('water','wall')]
        if not possible: break
        x,y = possible[0]; used.add((x,y))
        scenario_creatures.append({'x': x, 'y': y, 'kind': kind})
        art = helpers['material_art']({'kind':kind})
        uri = helpers['sprite_png'](art['sheet'], art['frames'][0], False, art.get('tint',0xffffff))
        size = 35 if kind == 'red_dragon' else 25
        objects.append((y, f'<g class="monster-layer" data-creature="{kind}"><title>{kind.replace("_"," ")}</title><ellipse cx="{x*24+12}" cy="{y*24+21}" rx="10" ry="4" fill="#000" opacity=".35"/><image href="{uri}" x="{x*24+12-size/2}" y="{y*24+22-size}" width="{size}" height="{size}"/></g>'))
    legend = []
    for kind, count in collections.Counter(creatures).items():
        art = helpers['material_art']({'kind':kind})
        uri = helpers['sprite_png'](art['sheet'], art['frames'][0], False, art.get('tint',0xffffff))
        legend.append(f'<span><img src="{uri}" alt="">{html.escape(kind.replace("_"," "))}{" ×"+str(count) if count > 1 else ""}</span>')
    algorithm = ('Tile · repeat_motif — ZoneVariants.sample · authored 12 × 9 motif'
                 if mode == 'tile' else f"Generated · Hilbert fill — TerrainLayouts.generate + assign · seed {patterns['settings']['seed']}")
    detail = ('Authored floor footprint and prop seats.' if mode == 'tile'
              else 'Generated ground accents and prop seats inside the same floor footprint.')
    source = prop_art['source']
    source_label = Path(source).name if depth else source
    art_note = f'Art: {html.escape(prop_art["label"])} · {html.escape(source_label)}'
    if depth: art_note = f'<a href="http://localhost:8000/{quote(source)}">{art_note}</a>'
    if prop_art['proxy']: art_note += f' · material proxy for {html.escape(prop.replace("_", " "))}'
    if depth == 1: art_note += '<br>Pushable crates: stand beside a crate and tap it to push one cell.'
    if theme and any('water' in row for row in cells): art_note += '<br>' + html.escape(theme['water_label'])
    ground_uri = theme['ground'] if theme else _swatch(palette)
    accent_uri = theme['road'] if theme and depth != 1 else _swatch(palette)
    scenario = {'version': 1, 'id': prefix, 'title': f'{layer["id"]} · {name} · {mode}',
                'depth': depth, 'seed': patterns['settings']['seed'], 'mode': mode,
                'width': 12, 'height': 9, 'cells': [['lava' if depth == 6 and cell == 'water' else cell for cell in row] for row in cells], 'props': scenario_props,
                'creatures': scenario_creatures, 'art': {'tiles': {
                    'ground': ground_uri, 'accent': _blend_swatch(ground_uri, accent_uri),
                    'water': theme['water'] if theme and theme['water'] else _swatch(water)},
                    'props': {'dressing': {'uri': prop_art['uri']}, **({'block': {'uri': block_art['uri']}} if block_art else {})}}}
    payload = json.dumps(scenario, separators=(',', ':')).replace('<', '\\u003c')
    return (f'<div data-layout-panel="{mode}" id="{prefix}" {"hidden" if mode == "generated" else ""}>'
            f'<svg viewBox="0 0 288 216" role="img" aria-label="{html.escape(name)} {mode} layout"><defs>{"".join(definitions)}</defs>{"".join(tiles)}{"".join(s for _,s in sorted(objects,key=lambda row:row[0]))}</svg>'
            f'<div class="ambient-spawn-key">{"".join(legend)}</div><p class="ambient-spec"><b>{html.escape(algorithm)}</b><br>{detail}</p><p class="ambient-spec">{art_note}</p><script type="application/json" data-sandbox-scenario>{payload}</script></div>')


def _card(area, layer, name, number, helpers):
    idea = area['ideas'][layer['id']]
    title_class = ' class="ambient-change"' if any(name.lower() in phrase.lower() for phrase in idea.get('changes',{}).get('variants',[])) else ''
    prefix = f"ambient-{layer['id']}-{area['id']}-{number}"
    buttons = ''.join(f'<button type="button" data-layout-mode="{mode}" aria-controls="{prefix}-{mode}" aria-pressed="{str(mode == "tile").lower()}">{mode.title()}</button>' for mode in ('tile', 'generated'))
    return (f'<figure class="ambient-card"><h4{title_class}>{html.escape(name)}</h4>'
            f'<div class="ambient-layout-toggle" role="group" aria-label="Layout algorithm for {html.escape(name)}">{buttons}</div>'
            + ''.join(_layout_panel(area, layer, name, number, helpers, mode) for mode in ('tile', 'generated')) + '<button type="button" data-load-sandbox>Load in sandbox</button></figure>')


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
                 '<p class="ambient-caption">Compare authored Tile motifs with Generated Hilbert dressing using the shared layout methods. Creature seats illustrate the proposed candidates below; counts are for readability, not live density. L0 Nexus cards reuse the current Nexus review layouts unchanged; only the separate landcover cards are proposals. Gold dotted words change current behavior. Underground ground swatches are material studies; only L1 sewer channel water is integrated. L2 fixtures propose dressing only, preserving its existing terrain. L5 remains open.</p>']
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
