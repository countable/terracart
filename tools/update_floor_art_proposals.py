#!/usr/bin/env python3
"""Insert reviewed native-16 objects into the existing floor table.

Source coordinates own ALT identities; reruns retain IDs and browser selections.
The preview is local/ignored; the manifest and this builder retain the review.
"""
import base64
import io
import json
import re
from html import escape
from pathlib import Path
from urllib.parse import quote

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
PAGE = ROOT / 'extra_assets/preview/level-table.html'
START = '<!-- floor-object-proposals:start -->'
END = '<!-- floor-object-proposals:end -->'
COLUMNS = {'dressings': 2, 'mechanics': 3, 'unique': 6}


def marked(text):
    return START + text + END


def main():
    manifest = json.loads((ROOT / 'tools/floor-art-proposals.json').read_text())
    registry_path = ROOT / 'tools/art-alternative-ids.json'
    registry = json.loads(registry_path.read_text())
    ids = {(entry['source'], *entry['crop']): entry['id'] for entry in registry['entries']}
    next_id = max(int(entry['id'].split('-')[1]) for entry in registry['entries']) + 1
    original = PAGE.read_text()
    page = re.sub(re.escape(START) + '.*?' + re.escape(END), '', original, flags=re.S)
    before, table = page.split('id="asset-table">', 1)
    count = 0
    for floor in manifest['floors']:
        level = floor['level']
        match = re.search(r'<tr><th scope="row">' + level.upper() + r' .*?</tr>', table, re.S)
        if not match:
            raise ValueError('Missing floor: ' + level)
        row = match.group()
        cards = {column: [] for column in COLUMNS}
        for item in floor['items']:
            ref = item['ref']
            assert ref['px'] == 16 and ref['w'] == 1 and ref['h'] in (1, 2), item['name']
            assert not re.search(r'\bchest\b', item['name'], re.I), item['name']
            source = 'extra_assets/' + ref['pack'] + '/' + ref['file']
            crop = [ref[k] * 16 for k in ('x', 'y', 'w', 'h')]
            key = (source, *crop)
            if key not in ids:
                ids[key] = f'ALT-{next_id:04d}'
                registry['entries'].append({'id': ids[key], 'source': source, 'crop': crop})
                next_id += 1
            alt = ids[key]
            with Image.open(ROOT / source) as sheet:
                x, y, w, h = crop
                assert x >= 0 and y >= 0 and x+w <= sheet.width and y+h <= sheet.height, item['name']
                tile = sheet.crop((x, y, x+w, y+h)).convert('RGBA')
                assert tile.getbbox(), item['name']
                buffer = io.BytesIO()
                tile.save(buffer, format='PNG')
            image = base64.b64encode(buffer.getvalue()).decode()
            name = escape(item['name'])
            label = escape(f"{level.upper()} · {item['name']}", quote=True)
            variants = item['nexus_variants']
            if isinstance(variants, list):
                variants = ', '.join(variants)
            implementation = item['implementation']
            details = ''.join(f'<p><b>{heading}</b> {escape(str(value))}</p>' for heading, value in [
                ('Use:', item['purpose']), ('Fit:', item['fit']),
                ('Placement / nexus:', variants), ('Gameplay status:', implementation)])
            cards[item['column']].append(
                f'<article class="floor-art-card" id="{level}-{alt}">'
                f'<button class="art-choice" type="button" aria-pressed="false" '
                f'data-art-domain="floor" data-art-target="{level}" data-art-label="{label}" '
                f'data-art-alt="{alt}" aria-label="Select {alt}: {label}">'
                f'<code>{alt}</code><img class="t" src="data:image/png;base64,{image}" '
                f'style="--w:{ref["w"]};--h:{ref["h"]}" alt="{name}">'
                f'<strong>{name}</strong></button>{details}'
                f'<details><summary>Source · ({ref["x"]}, {ref["y"]}) · {w}×{h}px</summary>'
                f'<a href="http://localhost:8000/{quote(source)}" target="_blank" rel="noopener">'
                f'{escape(ref["pack"] + "/" + ref["file"])}</a>'
                f'<p>Zero-based 16px cells. {escape(item["source_evidence"])}</p></details></article>')
            count += 1
        cells = list(re.finditer(r'<td[^>]*>.*?</td>', row, re.S))
        for column, index in sorted(COLUMNS.items(), key=lambda pair: pair[1], reverse=True):
            if not cards[column]:
                continue
            fragment = marked('<section class="floor-art-proposals"><h3>16px object proposals</h3>'
                              + ''.join(cards[column]) + '</section>')
            cell = cells[index]
            insert = cell.start() + cell.group().index('>') + 1
            row = row[:insert] + fragment + row[insert:]
        row = row.replace('</th>', marked('<p class="floor-context">' + escape(floor['context']) + '</p>') + '</th>', 1)
        table = table[:match.start()] + row + table[match.end():]
    css = (ROOT / 'tools/art-selections.css').read_text() + '''
    :root{--ink:var(--fg)} .art-selections{box-sizing:border-box;max-width:1000px;position:sticky;top:8px;z-index:10;max-height:50vh;overflow:auto}
    .art-selections textarea{box-sizing:border-box}.selection-actions{flex-wrap:wrap}
    .floor-art-proposals{min-width:210px;max-width:310px;border-bottom:2px solid var(--accent);padding-bottom:12px;margin-bottom:16px}
    .floor-art-proposals h3{font:600 14px var(--body);color:var(--accent)}
    .floor-art-card{margin:10px 0;padding:9px;background:var(--panel);border:1px solid var(--line);border-radius:6px}
    .floor-art-card .art-choice{display:grid;gap:7px;justify-items:start;box-sizing:border-box}
    .floor-art-card p,.floor-art-card details,.floor-context{font:12px/1.5 var(--body);text-align:left;color:var(--muted);margin:7px 0}
    .floor-art-card details{overflow-wrap:anywhere}.floor-art-card a{color:var(--accent)}
    .floor-art-card summary{cursor:pointer}.floor-art-card code{color:var(--accent)}
    '''
    before = before.replace('</head>', marked('<style>' + css + '</style>') + '</head>')
    before = before.replace('<div class="controls">', marked(
        f'<p class="note"><strong>{count} reviewed native-16 object proposals.</strong> '
        'Click a sprite to select it; click again to remove it. Copy IDs for a compact list or Copy list for floor context. '
        'Selections persist in this browser. Source approval covers the sheet; these object uses remain proposals. '
        'Legacy samples remain below each new group. No chest variants are included in this review.</p>') + '<div class="controls">', 1)
    result = before + 'id="asset-table">' + table
    script = (ROOT / 'tools/art-selections.js').read_text()
    result = result.replace('</body>', marked('<script>' + script + '</script>') + '</body>')
    registry_path.write_text(json.dumps(registry, indent=2) + '\n')
    PAGE.write_text(result)
    print(f'Rendered {count} proposals across {len(manifest["floors"])} floors; stable ALT IDs registered.')


if __name__ == '__main__':
    main()
