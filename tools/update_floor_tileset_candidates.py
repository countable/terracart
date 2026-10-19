#!/usr/bin/env python3
"""Refresh native 16px candidate groups in the existing floor table from row JSON.

Only marked candidate fragments are replaced; original picks and Phase 1 borders
are preserved. Crops use source tile coordinates, never generated artwork.
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
PREVIEW = ROOT / 'extra_assets/preview'
COLUMNS = {'buildings': 0, 'roads': 1, 'dressings': 2, 'ground': 4}
START = '<!-- native16-candidates:start -->'
END = '<!-- native16-candidates:end -->'


def group(content):
    return START + content + END


def crop(item):
    r = item['ref']
    assert r['px'] == 16 and r['w'] == 1 and r['h'] in (1, 2)
    path = ROOT / 'extra_assets' / r['pack'] / r['file']
    with Image.open(path) as source:
        x, y, w, h = [r[k] * 16 for k in ('x', 'y', 'w', 'h')]
        assert x >= 0 and y >= 0 and x + w <= source.width and y + h <= source.height, item
        tile = source.crop((x, y, x + w, y + h)).convert('RGBA')
        assert tile.getbbox(), item
        buffer = io.BytesIO()
        tile.save(buffer, format='PNG')
    href = quote('../' + r['pack'] + '/' + r['file'])
    coords = f"({r['x']},{r['y']}) {r['w']}×{r['h']}"
    trial = ('<br><strong>Applied wall material</strong>' if item.get('runtime_wall') else
             '<br><strong>3D viewer trial</strong>' if item.get('viewer_trial') else '')
    title = escape(f"Candidate: {item['name']} · {r['pack']}/{r['file']} · zero-based cell {coords} · ElvGames", quote=True)
    approved = ' class="approved-wall-pick"' if item.get('runtime_wall') else ''
    return (f'<figure{approved}><a href="{href}" target="_blank" rel="noopener" title="{title}">'
            f'<img class="t" src="data:image/png;base64,{base64.b64encode(buffer.getvalue()).decode()}" '
            f'style="--w:{r["w"]};--h:{r["h"]}" alt="{escape(item["name"], quote=True)}"></a>'
            f'<figcaption>{escape(item["name"])}<br>{coords}{trial}</figcaption></figure>')


def main():
    path = PREVIEW / 'level-table.html'
    original = path.read_text()
    picks = original.count('class="phase-one-pick')
    clean = re.sub(re.escape(START) + '.*?' + re.escape(END), '', original, flags=re.S)
    before, table = clean.split('id="asset-table">', 1)
    l2 = re.search(r'<tr><th scope="row">L2 .*?</tr>', table, re.S).group()
    for level in ('l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7'):
        data = json.loads((PREVIEW / 'data/table' / (level + '.json')).read_text())
        candidates = data['native16_candidates']['items']
        application = data.get('wall_application')
        pattern = r'<tr><th scope="row">' + level.upper() + r' .*?</tr>'
        match = re.search(pattern, table, re.S)
        assert match, level
        row = match.group()
        packs = sorted({it['ref']['pack'] for it in candidates})
        links = '<br>'.join(f'<a href="{quote("../" + pack + "/")}" target="_blank" rel="noopener">{escape(pack.removeprefix("16x16/"))}</a>' for pack in packs)
        row = row.replace('</th>', group('<div class="sets"><b>16px candidates · ElvGames</b><br>' + links + '</div>') + '</th>', 1)
        cells = list(re.finditer(r'<td[^>]*>.*?</td>', row, re.S))
        for column, index in sorted(COLUMNS.items(), key=lambda pair: pair[1], reverse=True):
            items = [it for it in candidates if it['column'] == column]
            if not items:
                continue
            cell = cells[index]
            scheme = ''
            if column == 'buildings' and application:
                cap = '#' + ''.join(f'{channel:02x}' for channel in application['cap'])
                scheme = (f'<div class="wall-application"><b>{escape(application["status"])}</b>'
                          f'<p>{escape(application["rule"])}</p>'
                          f'<span class="wall-cap" style="background:{cap}"></span> Top tone {cap}'
                          f'<br>{escape(application["geometry"])}'
                          '<br><a href="/tools/floor-viewer.html">Generated floor viewer</a> · '
                          '<a href="/tools/rockwall-3d-preview.html">Rotating wall study</a></div>')
            fragment = group('<div class="native16">' + scheme + '<div class="flabel">16px materials and candidates</div><div class="tiles">' + ''.join(map(crop, items)) + '</div></div>')
            row = row[:cell.end()-5] + fragment + row[cell.end()-5:]
        table = table[:match.start()] + row + table[match.end():]
        print(level, len(candidates), 'candidates')
    css = '.native16{border-top:1px dashed var(--line);margin-top:12px;padding-top:8px}.native16 .tiles{gap:10px;margin-top:7px}.native16 figcaption{max-width:84px}.approved-wall-pick{outline:2px solid white;outline-offset:3px;padding:4px}.wall-application{margin-bottom:12px;padding:8px;background:#ffffff08}.wall-application p{margin:6px 0}.wall-cap{display:inline-block;width:24px;height:16px;border:1px solid #aaa;vertical-align:middle;margin-right:6px}'
    before = before.replace('</head>', group('<style>' + css + '</style>') + '</head>')
    # Add legend before the existing gallery wrapper, outside its table layout.
    marker = '<div class="scroller" '
    pos = before.rfind(marker)
    assert pos >= 0
    before = before[:pos] + group('<p class="note">White boxes mark the existing Phase 1 picks and newly applied wall materials. Each floor’s wall note records its placement rule and top tone. Unboxed source-sheet samples remain candidates; “3D viewer trial” identifies ground, road or unused wall studies. Click a thumbnail for its source; coordinates are zero-based 16px cells (x,y). Art: ElvGames. L2 keeps the former L1 cave generation and gameplay, with the approved lighter Abandoned Mines wall material. L5 remains open with no rockwalls.</p>') + before[pos:]
    result = before + 'id="asset-table">' + table
    assert result.count('class="phase-one-pick') == picks
    assert re.sub(re.escape(START) + '.*?' + re.escape(END), '', re.search(r'<tr><th scope="row">L2 .*?</tr>', table, re.S).group(), flags=re.S) == l2
    path.write_text(result)


if __name__ == '__main__':
    main()
