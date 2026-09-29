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
    dict(id='grave-current', group='Grave markers', title='Current · cross marker', current=True,
         path='assets/Objects/Generated/headstone.png', rect=(0, 0, 16, 16),
         note='The small cross currently placed in Old Stones zones.', provenance='generated'),
    dict(id='grave-verdant', group='Grave markers', title='Rounded grey headstone', pick=True,
         path=VERDANT+'gravestone.png', rect=(0, 0, 16, 16),
         note='My first pick for a quieter grave marker: a recognisable upright stone, without a cross. Same 16 × 16 source footprint as the current art.', provenance='verdant'),
    dict(id='grave-skull-a', group='Grave markers', title='Skull headstone · A',
         path=FANTASY, rect=(72, 256, 16, 16),
         note='Rounded purple-grey stone with a skull emblem. More explicit cemetery imagery; fits the existing 16 × 16 frame.', provenance='fantasy'),
    dict(id='grave-skull-b', group='Grave markers', title='Skull headstone · B',
         path=FANTASY, rect=(72, 272, 16, 16),
         note='A second complete skull-marker sprite from the row below. Suitable as an alternative look, not a clipped neighbour.', provenance='fantasy'),
    dict(id='shrine-current', group='Grove shrines', title='Current · moss shrine', current=True,
         path='assets/Objects/Generated/shrine.png', rect=(0, 0, 16, 24),
         note='The small green-flame grove shrine that gives the daily gift. This is the zone POI, not the wizard tower.', provenance='generated'),
    dict(id='shrine-niche', group='Grove shrines', title='Arched stone niche', pick=True,
         path=FANTASY, rect=(136, 264, 16, 24),
         note='My first pick for a more detailed shrine: a complete arched niche with a figure and pale offerings at its foot. Matches the current 16 × 24 source footprint.', provenance='fantasy'),
    dict(id='shrine-statue', group='Grove shrines', title='Stone figure on a plinth',
         path=ROYAL, rect=(192, 240, 48, 48),
         note='A larger, softer stone statue. Strong landmark silhouette; would need sizing work to remain a single-cell POI. Source tile: column 4, row 5 (zero-based), frame 84 on a 16-column grid.', provenance='royal'),
    dict(id='shrine-votive', group='Grove shrines', title='Small green stone votive',
         path=FANTASY, rect=(112, 256, 16, 16),
         note='A compact stone surround with green at its centre. A possible low shrine or offering point; less immediately legible than the arched niche.', provenance='fantasy'),

]

PROVENANCE = {
    'generated': 'assets/Objects/Generated/README.md identifies the current headstone and grove shrine as gpt-image-2 placeholders, downsampled with binary alpha; it explicitly anticipates replacing them with hand art.',
    'verdant': 'unused_art/verdant-props-tileset-16x16/LICENSE.txt identifies Core Systems Asset Factory (2026) and permits game use and modification, with optional attribution. Its origin statement says the art was produced programmatically from hand-authored rules, without an image-generation model.',
    'fantasy': 'Existing local reserve: unused_art/Fantasy City ver1.3. No pack-specific licence or credit file was found in this local folder. Artwork authorship is not established by the filename.',
    'royal': 'Existing local reserve: unused_art/Medieval Fantasy Royal City. No pack-specific licence or credit file was found in this local folder.',
    'wizard': 'Already used by src/assets.js and src/render.js for wizard houses. This is an existing game asset, included only to distinguish its role from the grove shrine.',
    'miniworld': 'Existing local reserve: unused_art/MiniWorldSprites. Its local folder includes OtherLinks.docx, but no pack-specific licence file was found.',
}


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


def render(reserve, out):
    out.mkdir(parents=True, exist_ok=True)
    records, sections, contact = [], {}, []
    for row in CANDIDATES:
        image, path = crop_for(row, reserve)
        records.append({**row, 'absoluteSource': str(path), 'provenanceNote': PROVENANCE[row['provenance']]})
        uri = image_uri(image)
        badge = 'CURRENT' if row.get('current') else 'FIRST PICK' if row.get('pick') else 'UNUSED CANDIDATE'
        x, y, w, h = row['rect']
        small_height = 38 if row['group'] == 'Grove shrines' else 26
        zoom = min(4, 192 / max(image.size))
        card = f'''<article id="{row['id']}"><small>{badge}</small><h3>{html.escape(row['title'])}</h3>
<div class="comparison"><div class="large"><img alt="{html.escape(row['title'])}" src="{uri}" style="width:{w*zoom:g}px;height:{h*zoom:g}px"></div><div class="map-size"><img alt="Small comparison" src="{uri}" style="width:32px;height:{small_height}px"><small>small comparison</small></div></div>
<p>{html.escape(row['note'])}</p><details><summary>Source and provenance</summary><code>{html.escape(str(path))}</code><p>Crop x={x}, y={y}, width={w}, height={h} px. Original alpha preserved; no recolouring or repainting.</p><p>{html.escape(PROVENANCE[row['provenance']])}</p></details></article>'''
        sections.setdefault(row['group'], []).append(card)
        if row['group'] != 'Related art · different roles':
            contact.append((row, image))
    styles = '''*{box-sizing:border-box}body{margin:32px auto;padding:0 24px;max-width:1380px;background:#101a15;color:#e5ecdf;font:16px system-ui}h1{font-size:34px}p{line-height:1.6}a{color:#95d7d1}nav{display:flex;flex-wrap:wrap;gap:20px}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:18px}article{padding:20px;border:1px solid #334a3a;border-radius:12px;background:#1b2a21}article h3{margin-top:7px}small{font-size:11px;color:#b4c6b4}article:has(>small:first-child){min-width:0}.comparison{display:grid;grid-template-columns:1fr 88px;gap:8px;height:210px;align-items:end;background:#14241b;border-radius:6px;padding:8px}.large{height:194px;display:flex;align-items:center;justify-content:center}.large img{max-width:100%;object-fit:contain}.map-size{height:72px;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:8px}img{image-rendering:pixelated;object-fit:contain}.map-size img{object-fit:contain}details{font-size:12px;color:#b4c6b4}summary{cursor:pointer}code{display:block;margin-top:12px;overflow-wrap:anywhere}section{margin-top:34px;scroll-margin-top:16px}.intro{max-width:1000px}.note{border-left:3px solid #79a956;padding-left:16px}'''
    page = f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Grave and shrine art · existing candidates</title><style>{styles}</style></head><body>
<h1>Grave and shrine art already available</h1><div class="intro"><p>Yes — the unused reserve contains alternatives to both current placeholders. My picks are the <a href="#grave-verdant">rounded grey headstone</a> and the <a href="#shrine-niche">arched stone niche</a>. The niche retains the grove shrine’s 16 × 24 source footprint; the headstone retains the grave’s 16 × 16 footprint.</p><p class="note">Comparison only: no grave or shrine art has been replaced. These are crops of existing local assets, not newly generated art. Large images show source pixels enlarged up to 4×; the small views compare compact marker silhouettes, not a finished in-game scale.</p><p>The ignored <code style="display:inline">unused_art</code> directory is in the primary checkout, <code style="display:inline">/home/claude/terracart</code>; it is absent from the two worktrees searched. Full source paths, crop coordinates and local provenance notes are inside each card. The existing texture called “shrine” is a different asset: assets/Objects/Houses/wizard.png, frame 3, used for wizard houses; the grove POI is grove_shrine.</p></div>
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
    args = parser.parse_args()
    render(args.reserve_root, args.output)
