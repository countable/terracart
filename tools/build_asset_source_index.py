#!/usr/bin/env python3
"""Build the local asset-source index and a portable, deduplicated review gallery.

Usage: python3 tools/build_asset_source_index.py INVENTORY.json [...] --output DIR
Inventory inputs contain packs with folder, subjects, eligibility, notes and sheets.
"""
import argparse
import hashlib
import html
import json
from pathlib import Path
import shutil
from urllib.parse import quote

ROOT = Path(__file__).resolve().parents[1]
BASE = 'http://localhost:8765/asset-source-index/'
RULES = ('Use native 16×16 art only. Ordinary objects must fit 16×16; only trees and '
         'genuinely tall objects may exceed one cell. No cyan outlines or monochrome glyphs. '
         'Farm Game is excluded. Sheet inspection establishes source coverage, not exhaustive object matching.')

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('inventories', nargs='+', type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    packs = [p for src in args.inventories for p in json.loads(src.read_text())['packs']]
    packs.sort(key=lambda p: (p['eligibility'] != 'native16', p['folder'].lower()))
    output = args.output
    (output / 'sheets').mkdir(parents=True, exist_ok=True)
    canonical = {}
    paths = {}
    for pack in packs:
        pack['duplicates'] = pack.get('duplicates', []) + pack.pop('duplicateSheets', [])
        unique = []
        for sheet in pack['sheets']:
            src = ROOT / sheet['path']
            digest = hashlib.sha256(src.read_bytes()).hexdigest()
            if digest != sheet['sha256']:
                raise ValueError(f'Inventory hash mismatch: {src}')
            if digest in canonical:
                pack['duplicates'].append({'path': sheet['path'], 'canonical': canonical[digest]['path']})
                paths[sheet['path']] = canonical[digest]['reviewUrl']
                continue
            relative = 'sheets/' + digest + src.suffix.lower()
            shutil.copyfile(src, output / relative)
            sheet['reviewUrl'] = BASE + quote(relative)
            canonical[digest] = sheet
            paths[sheet['path']] = sheet['reviewUrl']
            unique.append(sheet)
        pack['sheets'] = unique
    for pack in packs:
        for dup in pack['duplicates']:
            dup['reviewUrl'] = paths.get(dup['canonical'], '')
    data = {'rules': RULES, 'packs': packs, 'counts': {
        'folders': len(packs), 'uniqueSheets': len(canonical),
        'native16Sheets': sum(len(p['sheets']) for p in packs if p['eligibility'] == 'native16'),
        'duplicateReferences': sum(len(p['duplicates']) for p in packs)}}
    index = ROOT / 'extra_assets/index.md'
    archive = ROOT / 'extra_assets/index/themed-tilesets-reference.md'
    if not archive.exists():
        archive.write_text('# Historical themed-tileset reference — outside current scope\n\n'
                           'Native 48px art is excluded. Any former resizing advice below is superseded '
                           'by the native16 rule in ../index.md.\n\n' + index.read_text())
    payload = json.dumps(data, ensure_ascii=False, indent=2)
    (ROOT / 'extra_assets/index/source-inventory.json').write_text(payload)
    (output / 'source-inventory.json').write_text(payload)
    md = ['# Asset source index', '', RULES, '', f'[Searchable source review]({BASE})', '',
          f"{len(packs)} folders; {len(canonical)} unique sheets. Exact-byte copies link to a canonical source. "
          'Distinct revisions are retained; visually similar sheets are not assumed identical.', '',
          'The source inventory is in `index/source-inventory.json`. Previous themed-pack detail is in '
          '`index/themed-tilesets-reference.md` (48px reference only).', '']
    blocks = []
    esc = html.escape
    for pack in packs:
        folder, status = pack['folder'], pack['eligibility']
        subjects = ', '.join(pack['subjects'])
        md += [f'## {folder}', '', f'**{status}** — {subjects}', '', pack['notes'], '']
        cards = []
        for s in pack['sheets']:
            inspected = 'Source visually inspected' if s.get('visualReviewed') else 'Object review pending'
            md.append(f"- [{s['path']}]({s['reviewUrl']}) — {s['role']}; {s['width']}×{s['height']}. {inspected}.")
            cards.append(f'<article><a href="{s["reviewUrl"]}"><img loading="lazy" src="{s["reviewUrl"]}" alt="{esc(s["role"])}"></a>'
                         f'<a href="{s["reviewUrl"]}">{esc(s["path"])}</a><p>{esc(s["role"])} · {s["width"]}×{s["height"]}</p>'
                         f'<small>{inspected}. {esc(s.get("notes", ""))}</small></article>')
        dup_html = []
        for d in pack['duplicates']:
            url = d['reviewUrl']
            md.append(f'- Copy `{d["path"]}` → [{d["canonical"]}]({url})')
            dup_html.append(f'<li>{esc(d["path"])} → <a href="{url}">{esc(d["canonical"])}</a></li>')
        md.append('')
        blocks.append(f'<section data-status="{status}"><h2>{esc(folder)}</h2><b>{status}</b><p>{esc(subjects)}</p>'
                      f'<p>{esc(pack["notes"])}</p><div class="grid">{"".join(cards)}</div>'
                      + (f'<details><summary>{len(dup_html)} identical copies — inspect originals above</summary><ul>{"".join(dup_html)}</ul></details>' if dup_html else '') + '</section>')
    index.write_text('\n'.join(md))
    page = '''<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Asset source index</title>
<style>body{font:16px system-ui;background:#16202a;color:#e6ecf1;margin:24px}a{color:#9cd5ff;overflow-wrap:anywhere}header{position:sticky;top:0;background:#16202a;padding:12px 0;z-index:1}input,select{font:inherit;padding:9px;max-width:90%}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px}article{background:#263440;padding:12px}img{display:block;width:100%;height:200px;object-fit:contain;image-rendering:pixelated;background:repeating-conic-gradient(#35424d 0% 25%,#29353e 0% 50%) 50%/16px 16px;margin-bottom:12px}section{border-top:1px solid #576774;padding:20px 0}small{color:#b5c3ce}h2{overflow-wrap:anywhere}[hidden]{display:none!important}</style>
<h1>Asset source index</h1><p>RULES</p><p>COUNTS</p><p><a href="source-inventory.json">Download source inventory</a> · <a href="/tools/world-art.html?alternatives=any">World comparisons</a> · <a href="/tools/items.html?alternatives=any">Item comparisons</a></p>
<header><input id="search" placeholder="Search subjects, packs or sheets" aria-label="Search sources"> <select id="scope" aria-label="Source eligibility"><option value="native16">Native16 candidates</option><option value="all">All indexed folders</option><option value="non16">Larger-format references</option><option value="excluded-user">Excluded by request</option><option value="unknown">Unverified</option><option value="out-of-scope">Outside object scope</option></select> <span id="count"></span></header>
BLOCKS
<script>const sections=[...document.querySelectorAll('section')];function filter(){let n=0;for(const s of sections){s.hidden=(scope.value!=='all'&&s.dataset.status!==scope.value)||!s.textContent.toLowerCase().includes(search.value.toLowerCase());if(!s.hidden)n++}count.textContent=n+' folders shown'}search.oninput=scope.onchange=filter;filter();</script>'''
    page = page.replace('RULES', esc(RULES)).replace('COUNTS', esc(str(data['counts']))).replace('BLOCKS', '\n'.join(blocks)).replace('<option>non16</option>', '')
    (output / 'index.html').write_text(page)
    print(json.dumps(data['counts']))

if __name__ == '__main__':
    main()
