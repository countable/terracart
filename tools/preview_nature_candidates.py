#!/usr/bin/env python3
"""Render a self-contained, read-only comparison of existing nature sprites.

Requires Pillow. Reserve assets are ignored and normally live in the main checkout.
python3 tools/preview_nature_candidates.py --reserve-root /home/claude/terracart/unused_art
"""
import argparse
import base64
import html
import io
import json
import math
import pathlib
import re

from PIL import Image, ImageDraw

ROOT = pathlib.Path(__file__).resolve().parents[1]
PROPS = 'assets/Objects/Wilderness/Props.png'
VERDANT = 'unused_art/verdant-props-tileset-16x16/tiles/16x16/'
FANTASY = 'unused_art/The Fan-tasy Tileset (Free) 1.5.7/The Fan-tasy Tileset (Free)/Art/'
PROVENANCE = {
    'shipped': 'Existing repository art; these source files are already shipped with the game. A separate pack licence was not located in this audit.',
    'reserve': 'art-source/sprites/README.md identifies Fantasy Mushroom.png as the former mushroom sheet, retained for future selection and no longer preloaded. A separate pack licence was not located.',
    'verdant': 'Core Systems Asset Factory, 2026. Local unused_art/verdant-props-tileset-16x16/LICENSE.txt permits game use and modification with optional attribution. The origin statement describes programmatic art made from hand-authored rules, without an image-generation model.',
    'fantasy': 'The Fan-tasy Tileset Free 1.5.7. Its local Free Trial Guide lists the included trees and props. An explicit licence grant was not located in the local PDFs.',
}


def prop(ident, title, group, frame, note, current=False, recommended=False):
    return dict(id=ident, title=title, group=group, path=PROPS,
                rect=(frame % 22 * 16, frame // 22 * 16, 16, 16),
                frame=frame, note=note, current=current,
                recommended=recommended, provenance='shipped')


def candidates():
    rows = [
        prop('grass-current', 'Current long grass', 'grass', 10, 'Bright upright green tuft.', current=True),
        prop('grass-green', 'Pale green tuft', 'grass', 32, 'Closest match: the existing tuft silhouette in a lighter green.'),
        prop('grass-golden', 'Golden tuft', 'grass', 54, 'Warm, dry-grass colour variant of the same upright tuft.'),
        dict(id='grass-fern', title='Low woodland fern', group='grass', path=VERDANT+'fern.png', rect=(0, 0, 16, 16), provenance='verdant', note='Complete low fern, with subdued greens and a broad, symmetrical spread.'),
        dict(id='grass-leafy', title='Leafy green sprig', group='grass', path=FANTASY+'Props/Plant_2.png', rect=(0, 0, 15, 11), provenance='fantasy', recommended=True, note='A distinct alternative: loose green leaves around a central stem. Softer shading than the current grass.'),
        prop('mushroom-current', 'Current surface mushroom', 'mushrooms', 35, 'Small lime-green cap and pale stem.', current=True),
        prop('mushroom-cave-a', 'Current cave mushroom A', 'mushrooms', 127, 'The first luminous blue underground variant; static art shown without its runtime light.', current=True),
        prop('mushroom-cave-b', 'Current cave mushroom B', 'mushrooms', 128, 'The second luminous blue underground variant; static art shown without its runtime light.', current=True),
        prop('mushroom-red', 'Red spotted toadstool', 'mushrooms', 13, 'Best style match: a clear red cap with pale spots, in the same 16 × 16 source format.', recommended=True),
        prop('mushroom-brown', 'Brown woodland cap', 'mushrooms', 55, 'A plain, dark brown cap and short stem. More subdued than the current green.'),
        prop('mushroom-cluster', 'Peach mushroom cluster', 'mushrooms', 108, 'Several connected orange-peach caps make a fuller, varied cluster.'),
        dict(id='mushroom-verdant', title='Plain brown pair', group='mushrooms', path=VERDANT+'mushrooms.png', rect=(0, 0, 16, 16), provenance='verdant', note='Two simple brown mushrooms, with restrained shading and no spots.'),
        dict(id='mushroom-reserve-red', title='Tall red pair', group='mushrooms', path='art-source/sprites/Fantasy Mushroom.png', rect=(32, 0, 32, 48), provenance='reserve', note='Complete paired mushrooms from the reserve sheet. The whole sprite needs a 32 × 48 rectangle; a 32 × 32 grid would clip it. Giant mushroom trees are excluded here.'),
    ]
    for kind, path in [('maple', 'assets/Objects/Maple Tree.png'), ('pine', 'assets/Objects/Wilderness/Pine Tree.png'), ('birch', 'assets/Objects/Wilderness/Birch Tree.png'), ('mahogany', 'assets/Objects/Wilderness/Mahogany Tree.png')]:
        rows.append(dict(id='tree-current-'+kind, title='Current '+kind, group='trees', path=path, rect=(96, 0, 32, 48), frame=3, current=True, provenance='shipped', note='The complete mature tree, using runtime frame 3.'))
    for ident, title, path, rect, note in [
        ('tree-tall-green', 'Open green broadleaf', 'assets/Objects/Tree.png', (64, 0, 32, 48), 'Best style match: a branching green tree with an open trunk and a flatter crown than maple.'),
        ('tree-tall-teal', 'Open teal broadleaf', 'assets/Objects/Tree.png', (64, 48, 32, 48), 'A darker teal palette on the same complete branching tree.'),
        ('tree-autumn-birch', 'Red autumn birch', 'assets/Objects/Wilderness/Birch Tree.png', (128, 0, 32, 48), 'A red autumn crown above a white birch trunk, in the existing mature-tree footprint.'),
        ('tree-emerald-broadleaf', 'Soft emerald broadleaf', FANTASY+'Trees and Bushes/Tree_Emerald_2.png', (0, 0, 46, 63), 'Whole tree with softer foliage and a broad warm trunk. Larger source pixels require a deliberate runtime scale.'),
        ('tree-emerald-pine', 'Wide emerald evergreen', FANTASY+'Trees and Bushes/Tree_Emerald_1.png', (0, 0, 64, 63), 'Whole evergreen with wide, layered boughs. A softer style and wider silhouette than current pine.'),
    ]:
        rows.append(dict(id=ident, title=title, group='trees', path=path, rect=rect, note=note, provenance='fantasy' if path.startswith('unused_art/') else 'shipped', recommended=ident == 'tree-tall-green'))
    return rows


def crop(row, reserve):
    path = reserve / row['path'][len('unused_art/'):] if row['path'].startswith('unused_art/') else ROOT / row['path']
    with Image.open(path) as source:
        image = source.convert('RGBA')
    x, y, w, h = row['rect']
    assert 0 <= x < x+w <= image.width and 0 <= y < y+h <= image.height, path
    image = image.crop((x, y, x+w, y+h))
    assert image.getbbox(), f'Blank crop: {row["id"]}'
    return image


def data_uri(image):
    output = io.BytesIO()
    image.save(output, format='PNG')
    return 'data:image/png;base64,' + base64.b64encode(output.getvalue()).decode()


def current_crop_scales():
    """Fail clearly if this comparison's current source-frame references drift."""
    source = (ROOT / 'src/items.js').read_text()
    scales = {}
    for kind, frame in [('longgrass', 10), ('mushroom', 35)]:
        body = re.search(r'\b'+kind+r':\s*\{([^}]+)\}', source).group(1)
        assert re.search(r"sheet:\s*'props'", body) and re.search(r'frame:\s*'+str(frame)+r'\b', body), kind
        scales[kind] = float(re.search(r'scale:\s*([\d.]+)', body).group(1))
        if kind == 'mushroom':
            assert re.search(r'caveFrames:\s*\[127,\s*128\]', body)
    return scales


def render(reserve, output):
    output.mkdir(parents=True, exist_ok=True)
    rows = candidates()
    scales = current_crop_scales()
    cards = {}
    images = {}
    for row in rows:
        im = images[row['id']] = crop(row, reserve)
        bounds = im.getbbox()
        row['visible_bounds'] = bounds
        uri = data_uri(im)
        is_tree = row['group'] == 'trees'
        target_h = 48 if is_tree else 16 * scales['longgrass' if row['group'] == 'grass' else 'mushroom']
        ratio = min(target_h / im.height, (48 if is_tree else 24) / im.width)
        badge = 'CURRENT' if row.get('current') else ('RECOMMENDED' if row.get('recommended') else 'ALTERNATIVE')
        native_zoom = 3 if is_tree else 4
        card = f'''<article id="{row['id']}"><div class="badge">{badge}</div><h3>{html.escape(row['title'])}</h3><code>{row['id']}</code>
<div class="native"><img alt="{html.escape(row['title'])}" src="{uri}" width="{im.width*native_zoom}" height="{im.height*native_zoom}"></div>
<div class="caption">Native frame ×{native_zoom} · {im.width} × {im.height} px</div>
<div class="small"><img alt="Small comparison: {html.escape(row['title'])}" src="{uri}" style="width:{im.width*ratio:.3f}px;height:{im.height*ratio:.3f}px"></div>
<div class="caption">{'48 px frame-height fit' if is_tree else f'{target_h:.3f} px frame-height fit'}</div>
<p>{html.escape(row['note'])}</p><details><summary>Source rectangle &amp; provenance</summary><p class="path">{html.escape(row['path'])}</p><p>x, y, width, height: <code>{row['rect']}</code>{'; frame '+str(row['frame']) if 'frame' in row else ''}. Visible bounds: <code>{bounds}</code>.</p><p>{html.escape(PROVENANCE[row['provenance']])}</p></details></article>'''
        cards.setdefault(row['group'], []).append(card)
    sections = ''.join(f'<section id="{group}"><h2>{title}</h2><p>{intro}</p><div class="grid">{"".join(cards[group])}</div></section>' for group, title, intro in [
        ('grass', 'Grass & ferns', 'Collectible tufts and ferns, rather than ground terrain. Try grass-leafy for a new silhouette; grass-green keeps the current style.'),
        ('mushrooms', 'Mushrooms', 'Surface and both cave looks are shown first. Mushroom-red is the clearest same-style alternative; mushroom-verdant is a quiet woodland option.'),
        ('trees', 'Whole trees', 'The four current mature trees precede five complete alternatives. Tree-tall-green preserves the existing pixel style; tree-autumn-birch adds a distinct seasonal palette.'),
    ])
    page = f'''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Nature art candidates</title><style>
*{{box-sizing:border-box}}body{{margin:0;background:#14231f;color:#e7efe8;font:16px/1.5 system-ui,sans-serif}}main{{max-width:1440px;margin:auto;padding:28px}}h1{{font-size:36px;margin-bottom:8px}}h2{{margin-top:48px}}h3{{margin:8px 0;font-size:18px}}p{{color:#c3d3c7}}a{{color:#e6c780}}nav{{display:flex;gap:22px;flex-wrap:wrap}}.grid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));gap:16px}}article{{background:#1e332b;border:1px solid #48614e;border-radius:14px;padding:18px;min-width:0}}.badge{{font-size:11px;letter-spacing:1px;color:#e5cb81}}code{{font-size:12px;overflow-wrap:anywhere}}.native{{height:206px;display:flex;align-items:center;justify-content:center;margin-top:18px;background:#7f9174;border-radius:8px}}img{{image-rendering:pixelated;object-fit:contain}}.small{{height:64px;display:flex;align-items:center;justify-content:center;margin-top:16px;background:#7f9174;border:1px dashed #a5b396;border-radius:8px}}.caption{{font-size:12px;color:#aebfb2;text-align:center;margin-top:5px}}details{{font-size:12px;border-top:1px solid #48614e;padding-top:12px}}summary{{cursor:pointer}}.path{{overflow-wrap:anywhere}}.intro{{max-width:1000px}}@media(max-width:600px){{main{{padding:16px}}h1{{font-size:28px}}}}
</style><main><nav><a href="index.html">Zone previews</a><a href="#grass">Grass</a><a href="#mushrooms">Mushrooms</a><a href="#trees">Trees</a><a href="nature-contact.png">Contact sheet</a></nav><h1>Nature art candidates</h1><div class="intro"><p>Existing artwork only: current game sprites, unused frames, and local unused_art reserves. These are comparison choices; this page does not change the game.</p><p>The large view preserves native pixels at an integer zoom. The small view fits each frame into a common category height, capped in width. Current grass uses CROP_SPRITE scale {scales['longgrass']}; all current mushrooms use {scales['mushroom']}. Their small views therefore match those frame scales. Tree comparisons use a common 48 px frame height, not runtime camera zoom. Source margins are retained.</p></div>{sections}<p>All {len(rows)} sprite crops are embedded in this page. Coordinates are source pixels (x, y, width, height). Whole silhouettes were visually checked against their sheets. Local provenance is listed per card; no new art was generated.</p></main></html>'''
    (output / 'nature-art.html').write_text(page)
    (output / 'nature-candidates.json').write_text(json.dumps(rows, indent=2)+'\n')
    columns, cell_w, cell_h = 5, 240, 260
    contact = Image.new('RGB', (columns*cell_w, math.ceil(len(rows)/columns)*cell_h), '#819477')
    draw = ImageDraw.Draw(contact)
    for index, row in enumerate(rows):
        x, y = (index % columns)*cell_w, (index//columns)*cell_h
        im = images[row['id']]
        zoom = min(3 if row['group'] == 'trees' else 6, 190//im.height)
        enlarged = im.resize((im.width*zoom, im.height*zoom), Image.Resampling.NEAREST)
        contact.paste(enlarged, (x+(cell_w-enlarged.width)//2, y+30+(190-enlarged.height)//2), enlarged)
        draw.text((x+8, y+8), 'CURRENT' if row.get('current') else 'ALTERNATIVE', fill='#203027')
        draw.text((x+8, y+226), row['id'], fill='#13201a')
        draw.text((x+8, y+242), str(tuple(row['rect'])), fill='#13201a')
    contact.save(output / 'nature-contact.png')
    print(f'{len(rows)} verified nonempty crops: {output / "nature-art.html"}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--reserve-root', type=pathlib.Path, default=ROOT/'unused_art')
    parser.add_argument('--output', type=pathlib.Path, default=pathlib.Path.home()/'.artifacts/zone-variants')
    args = parser.parse_args()
    render(args.reserve_root, args.output)
