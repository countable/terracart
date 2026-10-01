#!/usr/bin/env python3
"""Compare existing grave/shrine sprites without changing game assets.

Requires Pillow. The ignored reserve normally lives in the primary checkout:
python3 tools/preview_landmark_candidates.py --reserve-root /home/claude/terracart/unused_art --output /tmp/landmark-art
"""
import argparse
import base64
import html
import io
import json
import pathlib

from PIL import Image, ImageDraw


ROOT = pathlib.Path(__file__).resolve().parents[1]
FANTASY = 'Fantasy City ver1.3/Tiles/Above.png'
ROYAL = 'Medieval Fantasy Royal City/tile-B-03.png'
VERDANT = 'verdant-props-tileset-16x16/tiles/16x16/'

# Rectangles are source pixels: x, y, width, height. Manually inspected against
# the full source sheets; Fantasy City's sprites do not all start on its grid.
CANDIDATES = [
    dict(id='grave-current', group='Grave markers', title='Current · weathered stone pillar', current=True, approved=True, render_scale=1.6,
         path='assets/Objects/Generated/pillar_c.png', rect=(0, 0, 16, 16),
         note='Approved weathered stone pillar replacing the grave marker. Its visible stone stands 25.6 pixels tall at the 1.6× runtime scale.', provenance='generated'),
    dict(id='grave-verdant', group='Grave markers', title='Rounded grey headstone',
         path=VERDANT+'gravestone.png', rect=(0, 0, 16, 16),
         note='An unused alternative grave marker: a recognisable upright stone, without a cross. Same 16 × 16 source footprint as the current art.', provenance='verdant'),
    dict(id='grave-skull-a', group='Grave markers', title='Skull headstone · A',
         path=FANTASY, rect=(72, 256, 16, 16),
         note='Rounded purple-grey stone with a skull emblem. More explicit cemetery imagery; fits the existing 16 × 16 frame.', provenance='fantasy'),
    dict(id='grave-skull-b', group='Grave markers', title='Skull headstone · B',
         path=FANTASY, rect=(72, 272, 16, 16),
         note='A second complete skull-marker sprite from the row below. Suitable as an alternative look, not a clipped neighbour.', provenance='fantasy'),
    dict(id='shrine-current', group='Grove shrines', title='Previous · moss shrine', current=True, previous=True,
         path='assets/Objects/Generated/shrine.png', rect=(0, 0, 16, 24),
         note='The previous generated green-flame placeholder. It has been replaced by the approved green votive shrine.', provenance='generated'),
    dict(id='shrine-niche', group='Grove shrines', title='Arched stone niche · unused',
         path=FANTASY, rect=(136, 264, 16, 24),
         note='An unused alternative retained for comparison. The green votive was selected instead.', provenance='fantasy'),
    dict(id='shrine-statue', group='Grove shrines', title='Retired · stone figure', previous=True, render_scale=0.7,
         path='assets/Objects/Landmarks/shrine-figure.png', rect=(0, 0, 48, 48),
         note='Retired from grove shrine usage; the stone votive is now used. The 48 × 48 frame renders at 0.7×. Copied from Royal City tile-B-03.png, rectangle (192, 240, 48, 48), source frame 84.', provenance='royal'),
    dict(id='shrine-votive', group='Grove shrines', title='Current · green stone votive', current=True, approved=True, render_scale=1.6,
         path='assets/Objects/Landmarks/shrine-votive.png', rect=(0, 0, 16, 16),
         note='Retired from grove shrine usage; the stone votive is now used. The 16 × 16 frame renders at 1.6×. Copied from Fantasy City Above.png, rectangle (112, 256, 16, 16).' , provenance='fantasy'),

]

PROVENANCE = {
    'generated': 'assets/Objects/Generated/README.md identifies the previous cross headstone and moss shrine as gpt-image-2 placeholders, downsampled with binary alpha; it explicitly anticipates replacing them with hand art.',
    'verdant': 'unused_art/verdant-props-tileset-16x16/LICENSE.txt identifies Core Systems Asset Factory (2026) and permits game use and modification, with optional attribution. Its origin statement says the art was produced programmatically from hand-authored rules, without an image-generation model.',
    'fantasy': 'Existing local reserve: unused_art/Fantasy City ver1.3. No pack-specific licence or credit file was found in this local folder. Artwork authorship is not established by the filename.',
    'royal': 'Existing local reserve: unused_art/Medieval Fantasy Royal City. No pack-specific licence or credit file was found in this local folder.',
    'wizard': 'Already used by src/assets.js and src/render.js for wizard houses. This is an existing game asset, included only to distinguish its role from the grove shrine.',
    'miniworld': 'Existing local reserve: unused_art/MiniWorldSprites. Its local folder includes OtherLinks.docx, but no pack-specific licence file was found.',
}


PILLAR_CANDIDATES = [
    dict(id='royal-short-pillar', title='Plain stone bollard',
         path=ROYAL, rect=(672, 288, 48, 48), provenance='royal',
         note='Best match for a plain upright pillar: a simple shaft, foot and rounded cap, with no figure, skull or cross. Complete standalone sprite. Fit to the existing grave-marker height, as in the small comparison.'),
    dict(id='verdant-plinth', title='Low square plinth',
         path=VERDANT+'statue_base.png', rect=(0, 0, 16, 16), provenance='verdant',
         note='The shortest and simplest option: a squat square stone pedestal. An intact, complete prop with no statue attached. Good if you want a low grave marker rather than a slender column.'),
    dict(id='verdant-broken-column', title='Short broken column',
         path=VERDANT+'broken_column.png', rect=(0, 0, 16, 16), provenance='verdant',
         note='A complete upright ruined-column sprite, with a jagged top and short fluted sides. More weathered than the plain bollard; no emblem.'),
    dict(id='verdant-basalt', title='Previous · low basalt column', current=True, previous=True,
         path='assets/Objects/Landmarks/headstone-basalt.png', rect=(0, 0, 16, 16), provenance='verdant',
         note='Previously used for headstones; now superseded by the weathered stone pillar. A complete low stone column with rough facets; visible art is 8 × 10 source pixels, rendered at 1.6×.'),
    dict(id='current-grave-reference', title='Previous cross marker · reference', current=True, previous=True,
         path='assets/Objects/Generated/headstone.png', rect=(0, 0, 16, 16), provenance='generated',
         note='The previous cross marker, retained for comparison. Now replaced by the weathered stone pillar.'),
]


def crop_for(row, reserve):
    path = ROOT / row['path'] if row.get('current') else reserve / row['path']
    with Image.open(path) as source:
        image = source.convert('RGBA')
    x, y, w, h = row['rect']
    assert x >= 0 and y >= 0 and x+w <= image.width and y+h <= image.height, path
    image = image.crop((x, y, x+w, y+h))
    assert image.getbbox(), f'Blank candidate: {path}'
    return image, path


def image_uri(image):
    buf = io.BytesIO()
    image.save(buf, format='PNG')
    return 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode()


def render_pillars(reserve, out):
    """A separate page; does not regenerate the earlier shrine-choice gallery."""
    out.mkdir(parents=True, exist_ok=True)
    cards, records = [], []
    sheet = Image.new('RGB', (1250, 280), '#14241b')
    draw = ImageDraw.Draw(sheet)
    for i, row in enumerate(PILLAR_CANDIDATES):
        image, path = crop_for(row, reserve)
        uri = image_uri(image)
        x, y, w, h = row['rect']
        bounds = image.getbbox()
        marker = image.crop(bounds)
        # Compare visible shapes at a common 26px marker height (the current
        # 16px headstone frame × its 1.6 runtime scale, rounded for display).
        small_w = marker.width * 26 / marker.height
        small = image_uri(marker)
        badge = 'PREVIOUS' if row.get('previous') else 'CURRENT ART' if row.get('current') else 'UNUSED CANDIDATE'
        cards.append(f'''<article id="{row['id']}"><small>{badge}</small><h2>{row['title']}</h2>
<div class="comparison"><div class="zoom"><img src="{uri}" alt="{row['title']} at 4× source pixels" style="width:{w*4}px;height:{h*4}px"></div><div class="small"><img src="{small}" alt="{row['title']} at 26px visible height" style="width:{small_w:g}px;height:26px"><small>26px tall</small></div></div>
<p>{row['note']}</p><details><summary>Source, crop and provenance</summary><code>{html.escape(str(path))}</code><p>Source rectangle: x={x}, y={y}, width={w}, height={h} px. Visible alpha bounds inside it: {bounds}. Original colours and alpha preserved.</p><p>{html.escape(PROVENANCE[row['provenance']])}</p></details></article>''')
        records.append({**row, 'absoluteSource': str(path), 'alphaBounds': bounds, 'provenanceNote': PROVENANCE[row['provenance']]})
        shown = marker.copy()
        factor = min(6, 160 / max(shown.size))
        shown = shown.resize((round(shown.width*factor),round(shown.height*factor)),Image.Resampling.NEAREST)
        draw.text((i*250+12,12),row['title'].replace('·','/'),fill='#e5ecdf')
        sheet.paste(shown,(i*250+(250-shown.width)//2,50+(160-shown.height)//2),shown)
        draw.text((i*250+12,238),f'{w} x {h} source / 26px comparison in HTML',fill='#b4c6b4')
    css = '''*{box-sizing:border-box}body{font:16px system-ui;background:#101a15;color:#e5ecdf;max-width:1380px;margin:32px auto;padding:0 24px}p{line-height:1.6}a{color:#95d7d1}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,310px),1fr));gap:20px}article{background:#1b2a21;border:1px solid #334a3a;border-radius:12px;padding:20px;min-width:0}h2{font-size:22px}small,details{color:#b4c6b4;font-size:12px}.comparison{display:grid;grid-template-columns:1fr 70px;gap:12px;background:#14241b;padding:8px;border-radius:6px;align-items:center;height:210px}.zoom{display:flex;align-items:center;justify-content:center;height:194px}.zoom img{max-width:100%;object-fit:contain}.small{display:flex;flex-direction:column;align-items:center;gap:12px}img{image-rendering:pixelated}code{display:block;overflow-wrap:anywhere;margin-top:12px}summary{cursor:pointer}'''
    page = f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Short stone pillars · existing art</title><style>{css}</style></head><body>
<h1>Short plain stone pillars</h1><p>Yes — there are suitable existing sprites in <code style="display:inline">unused_art</code>. The <a href="grave-shrine-art.html#grave-current">weathered stone pillar</a> now replaces the headstone. The low basalt column below was the previous choice; these alternatives remain for comparison.</p><p>The previous basalt marker, three unused alternatives, and the previous cross marker are shown below. All are complete standalone sprites, not the base cut off a statue. Large views use 4× source pixels; small views normalise visible height to 26px to compare the silhouettes fairly. The weathered stone pillar is now used in game.</p><p><a href="stone-pillar-contact.png">Compact contact sheet</a> · <a href="index.html">Zone previews</a></p><main class="cards">{''.join(cards)}</main></body></html>'''
    (out/'stone-pillar-candidates.html').write_text(page)
    (out/'stone-pillar-candidates.json').write_text(json.dumps(records,indent=2)+'\n')
    sheet.save(out/'stone-pillar-contact.png')
    print(f'Rendered {len(records)} short-pillar comparisons: {out / "stone-pillar-candidates.html"}')


def render(reserve, out):
    out.mkdir(parents=True, exist_ok=True)
    records, sections, contact = [], {}, []
    for row in CANDIDATES:
        image, path = crop_for(row, reserve)
        records.append({**row, 'absoluteSource': str(path), 'provenanceNote': PROVENANCE[row['provenance']]})
        uri = image_uri(image)
        badge = 'PREVIOUS' if row.get('previous') else 'APPROVED · CURRENT' if row.get('approved') else 'CURRENT' if row.get('current') else 'FIRST PICK' if row.get('pick') else 'UNUSED CANDIDATE'
        x, y, w, h = row['rect']
        small_height = row['rect'][3]*row['render_scale'] if row.get('approved') else (38 if row['group'] == 'Grove shrines' else 26)
        small_width = row['rect'][2]*row['render_scale'] if row.get('approved') else 32
        small_label = f"runtime {row['render_scale']:g}×" if row.get('approved') else 'small comparison'
        zoom = min(4, 192 / max(image.size))
        card = f'''<article id="{row['id']}"><small>{badge}</small><h3>{html.escape(row['title'])}</h3>
<div class="comparison"><div class="large"><img alt="{html.escape(row['title'])}" src="{uri}" style="width:{w*zoom:g}px;height:{h*zoom:g}px"></div><div class="map-size"><img alt="Small comparison" src="{uri}" style="width:{small_width:g}px;height:{small_height:g}px"><small>{small_label}</small></div></div>
<p>{html.escape(row['note'])}</p><details><summary>Source and provenance</summary><code>{html.escape(str(path))}</code><p>Crop x={x}, y={y}, width={w}, height={h} px. Original alpha preserved; no recolouring or repainting.</p><p>{html.escape(PROVENANCE[row['provenance']])}</p></details></article>'''
        sections.setdefault(row['group'], []).append(card)
        if row['group'] != 'Related art · different roles':
            contact.append((row, image))
    styles = '''*{box-sizing:border-box}body{margin:32px auto;padding:0 24px;max-width:1380px;background:#101a15;color:#e5ecdf;font:16px system-ui}h1{font-size:34px}p{line-height:1.6}a{color:#95d7d1}nav{display:flex;flex-wrap:wrap;gap:20px}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:18px}article{padding:20px;border:1px solid #334a3a;border-radius:12px;background:#1b2a21}article h3{margin-top:7px}small{font-size:11px;color:#b4c6b4}article:has(>small:first-child){min-width:0}.comparison{display:grid;grid-template-columns:1fr 88px;gap:8px;height:210px;align-items:end;background:#14241b;border-radius:6px;padding:8px}.large{height:194px;display:flex;align-items:center;justify-content:center}.large img{max-width:100%;object-fit:contain}.map-size{height:72px;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:8px}img{image-rendering:pixelated;object-fit:contain}.map-size img{object-fit:contain}details{font-size:12px;color:#b4c6b4}summary{cursor:pointer}code{display:block;margin-top:12px;overflow-wrap:anywhere}section{margin-top:34px;scroll-margin-top:16px}.intro{max-width:1000px}.note{border-left:3px solid #79a956;padding-left:16px}'''
    page = f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Grave and shrine art · existing candidates</title><style>{styles}</style></head><body>
<h1>Grave and shrine art already available</h1><div class="intro"><p>The <a href="#shrine-votive">green votive</a> is the current grove shrine art. The oversized stone figure is retired. The previous moss placeholder and unused niche remain below for reference. The low basalt column is the approved current headstone; other grave markers remain for comparison.</p><p class="note">Grove shrine and headstone art have been updated to the approved choices. These are existing local assets, not newly generated art. Large images show source pixels enlarged up to 4×. The approved sprites’ small views show their runtime render scales; other small views are silhouette comparisons.</p><p>The ignored <code style="display:inline">unused_art</code> directory is in the primary checkout, <code style="display:inline">/home/claude/terracart</code>; it is absent from the two worktrees searched. Full source paths, crop coordinates and local provenance notes are inside each card. The existing texture called “shrine” is a different asset: assets/Objects/Houses/wizard.png, frame 3, used for wizard houses; the grove POI is grove_shrine.</p></div>
<nav><a href="#grave-markers">Graves</a><a href="#grove-shrines">Grove shrines</a><a href="index.html">Zone preview</a><a href="grave-shrine-contact.png">Compact contact sheet</a></nav>'''
    for group, cards in sections.items():
        anchor = {'Grave markers':'grave-markers', 'Grove shrines':'grove-shrines', 'Related art · different roles':'related-art'}[group]
        page += f'<section id="{anchor}"><h2>{group}</h2><div class="cards">{"".join(cards)}</div></section>'
    page += '<p>Also inspected: Zoria’s overworld/sprite sheets, the Fan-tasy props reserve, and other Royal City sheets. Zoria’s local readme declares CC-BY 4.0; its strongly NES-styled columns and stone idols were less consistent with the current art than the shortlisted candidates.</p></body></html>'
    (out/'grave-shrine-art.html').write_text(page)
    (out/'grave-shrine-candidates.json').write_text(json.dumps(records, indent=2)+'\n')
    # A compact, pixel-preserving review artifact: each source is fitted in a
    # labelled cell; runtime images are never edited or replaced.
    sheet = Image.new('RGB', (1200, 540), '#14241b')
    draw = ImageDraw.Draw(sheet)
    for i, (row, im) in enumerate(contact):
        x, y = (i%4)*300, (i//4)*270
        draw.text((x+12,y+10),row['title'].replace('·','/'),fill='#e5ecdf')
        factor = min(6, 190/max(im.size))
        shown = im.resize((round(im.width*factor),round(im.height*factor)), Image.Resampling.NEAREST)
        sheet.paste(shown,(x+(300-shown.width)//2,y+40+(190-shown.height)//2),shown)
        draw.text((x+12,y+243),f'{im.width} x {im.height} source pixels',fill='#b4c6b4')
    sheet.save(out/'grave-shrine-contact.png')
    print(f'Rendered {len(records)} existing-art comparisons: {out / "grave-shrine-art.html"}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--reserve-root', type=pathlib.Path, default=pathlib.Path('/home/claude/terracart/unused_art'))
    parser.add_argument('--output', type=pathlib.Path, default=pathlib.Path('/tmp/landmark-art'))
    parser.add_argument('--pillars', action='store_true', help='Render only the separate short-stone-pillar comparison')
    args = parser.parse_args()
    (render_pillars if args.pillars else render)(args.reserve_root, args.output)
