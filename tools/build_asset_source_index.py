#!/usr/bin/env python3
"""Build the local asset-source index and a portable, deduplicated review gallery.

Usage: python3 tools/build_asset_source_index.py INVENTORY.json [...] --output DIR
Inventory inputs contain packs with folder, subjects, eligibility, notes and sheets.
"""
import argparse
from collections import defaultdict
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

def source_system(folder):
    name = folder.lower()
    for key, title in [
        ('rogue adventure', 'Rogue Adventure'), ('fantasy dreamland', 'Fantasy Dreamland'),
        ('pixel plains', 'Pixel Plains'), ('dungeon gathering', 'Dungeon Gathering'),
        ('sunnyside', 'Sunnyside World'), ('themed-tilesets', 'Themed tilesets (48px)'),
        ('recovered from git', 'Previous game art'), ('hex character', 'Hex Character Pack'),
        ('farm game', 'Farm Game'), ('farming game', 'Farm Game'),
        ('modular pixel houses', 'Modular Pixel Houses'), ('tower defense', 'Tower Defense'),
        ('rpg_pack', '16x16 RPG Pack'), ('dungeon_tileset', 'Dungeon Tileset')]:
        if key in name:
            return title
    parts = Path(folder).parts
    return parts[2] if len(parts) > 2 and parts[1] == '16x16' else parts[1]


def render_review(packs, paths, plan, counts, index, output):
    esc = html.escape
    groups = defaultdict(list)
    for pack in packs:
        groups[pack['sourceSystem']].append(pack)
    plans = {s['name']: s for s in plan.get('systems', [])}
    sheet_lookup = {s['path']: s for p in packs for s in p['sheets']}
    # Review plans may use a byte-identical source which redirects to the canonical image.
    for pack in packs:
        for duplicate in pack['duplicates']:
            if duplicate['canonical'] in sheet_lookup:
                sheet_lookup[duplicate['path']] = sheet_lookup[duplicate['canonical']]
    md = ['# Asset source index', '', RULES, '', f'[Grouped source review]({BASE})', '',
          '## Consolidated review sets', '',
          'Grouped by source art system. Start with the recommended original sheets below. '
          'The complete inventory remains available for supplements and reference. '
          'Coverage notes distinguish proven containment from unverified overlap; '
          'these lists do not claim a globally optimal cover of every animation or character.', '',
          'Inventory: `index/source-inventory.json`. Review plan: `index/review-plan.json`. '
          'Historical 48px details: `index/themed-tilesets-reference.md` (outside current scope).', '']
    blocks = []

    def card(sheet, reason=''):
        url = sheet['reviewUrl']
        return (f'<article><a href="{url}"><img loading="lazy" src="{url}" alt="{esc(sheet["role"])}"></a>'
                f'<a href="{url}">{esc(sheet["path"])}</a><p>{esc(sheet["role"])} · '
                f'{sheet["width"]}×{sheet["height"]}</p><small>{esc(reason or sheet.get("notes", ""))}</small></article>')

    order = ['Rogue Adventure', 'Fantasy Dreamland', 'Pixel Plains', 'Dungeon Gathering', 'Sunnyside World']
    names = sorted(groups, key=lambda name: (order.index(name) if name in order else len(order), name))
    for name in names:
        group = groups[name]
        selection = plans.get(name, {})
        notes = selection.get('notes', 'No reduced sheet set verified for this system yet; see the complete inventory.')
        md += [f'## {name}', '', notes, '']
        primary = []
        for choice in selection.get('coreSheets', selection.get('sheets', [])):
            path = choice['path']
            if path not in sheet_lookup:
                raise ValueError(f'Review sheet missing from inventory: {path}')
            sheet = sheet_lookup[path]
            reason = choice.get('reason', '')
            coverage = choice.get('coverage', 'unverified')
            md.append(f'- [{path}]({sheet["reviewUrl"]}) — {coverage}: {reason}')
            primary.append(card(sheet, f'{coverage}: {reason}'))
        supplements = []
        if selection.get('supplementSheets'):
            md += ['', '### Completeness supplements', '']
        for choice in selection.get('supplementSheets', []):
            sheet = sheet_lookup[choice['path']]
            md.append(f'- [{sheet["path"]}]({sheet["reviewUrl"]}) — {choice.get("reason", "")}')
            supplements.append(card(sheet, choice.get('reason', '')))
        gaps = selection.get('gaps', [])
        for gap in gaps:
            md.append(f'- Coverage limit: {gap}')
        md += ['', '### Folders and full source inventory', '']
        folder_blocks = []
        for pack in group:
            folder, status = pack['folder'], pack['eligibility']
            subjects = ', '.join(pack['subjects'])
            md += [f'#### {folder}', '', f'**{status}** — {subjects}', '', pack['notes'], '']
            cards = []
            for sheet in pack['sheets']:
                inspected = 'Source visually inspected' if sheet.get('visualReviewed') else 'Object review pending'
                md.append(f'- [{sheet["path"]}]({sheet["reviewUrl"]}) — {sheet["role"]}; '
                          f'{sheet["width"]}×{sheet["height"]}. {inspected}.')
                cards.append(card(sheet))
            duplicates = []
            for duplicate in pack['duplicates']:
                url = duplicate['reviewUrl']
                state = 'removed copy' if duplicate.get('removed') else 'copy'
                md.append(f'- {state}: `{duplicate["path"]}` → [{duplicate["canonical"]}]({url})')
                duplicates.append(f'<li>{state}: {esc(duplicate["path"])} → '
                                  f'<a href="{url}">{esc(duplicate["canonical"])}</a></li>')
            md.append('')
            folder_blocks.append(f'<details class="pack" data-status="{status}"><summary>{esc(folder)} — '
                                 f'{status} · {len(cards)} sheets</summary><p>{esc(subjects)}</p>'
                                 f'<p>{esc(pack["notes"])}</p><div class="grid">{"".join(cards)}</div>'
                                 + (f'<details><summary>{len(duplicates)} duplicate references</summary>'
                                    f'<ul>{"".join(duplicates)}</ul></details>' if duplicates else '') + '</details>')
        status = 'native16' if any(p['eligibility'] == 'native16' for p in group) else group[0]['eligibility']
        blocks.append(f'<section data-status="{status}"><h2>{esc(name)}</h2><p>{esc(notes)}</p>'
                      f'<p>{len(primary)} recommended sheets · {len(group)} indexed folders</p>'
                      f'<div class="grid">{"".join(primary)}</div>'
                      + (f'<details><summary>{len(supplements)} completeness supplements</summary><div class="grid">{"".join(supplements)}</div></details>' if supplements else '')
                      + (f'<ul>{"".join("<li>" + esc(g) + "</li>" for g in gaps)}</ul>' if gaps else '')
                      + f'<details class="full"><summary>Complete inventory and duplicate references</summary>'
                      f'{"".join(folder_blocks)}</details></section>')
    index.write_text('\n'.join(md))
    page = """<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Asset source systems</title>
<style>body{font:16px system-ui;background:#16202a;color:#e6ecf1;margin:24px}a{color:#9cd5ff;overflow-wrap:anywhere}header{position:sticky;top:0;background:#16202a;padding:12px 0;z-index:1}input,select{font:inherit;padding:9px;max-width:90%}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px}article{background:#263440;padding:12px}img{display:block;width:100%;height:200px;object-fit:contain;image-rendering:pixelated;background:repeating-conic-gradient(#35424d 0% 25%,#29353e 0% 50%) 50%/16px 16px;margin-bottom:12px}section{border-top:1px solid #576774;padding:20px 0}small{color:#b5c3ce}h2,summary{overflow-wrap:anywhere}summary{cursor:pointer;padding:12px;background:#22313d}.pack{margin:10px 0}[hidden]{display:none!important}</style>
<h1>Asset source systems</h1><p>RULES</p><p>Start with these consolidated original sheets. Expand a system for its complete inventory. A smaller review set is not permission to delete unique source files. Coverage limits appear beside each selection.</p><p>COUNTS</p><p><a href="source-inventory.json">Full inventory</a> · <a href="review-plan.json">Reduced review plan</a> · <a href="duplicate-cleanup.json">Duplicate-folder cleanup proof</a> · <a href="/tools/world-art.html?alternatives=any">World comparisons</a> · <a href="/tools/items.html?alternatives=any">Item comparisons</a></p>
<header><input id="search" placeholder="Search art systems, subjects or sheets" aria-label="Search sources"> <select id="scope" aria-label="Source eligibility"><option value="native16">Native16 systems</option><option value="all">All art systems</option><option value="non16">Larger-format references</option><option value="excluded-user">Excluded by request</option><option value="unknown">Unverified</option><option value="out-of-scope">Outside object scope</option></select> <span id="count"></span></header>
BLOCKS
<script>const sections=[...document.querySelectorAll('section')];const search=document.getElementById('search'),scope=document.getElementById('scope'),count=document.getElementById('count');function filter(){let n=0;for(const s of sections){s.hidden=(scope.value!=='all'&&s.dataset.status!==scope.value)||!s.textContent.toLowerCase().includes(search.value.toLowerCase());if(!s.hidden)n++}count.textContent=n+' art systems shown'}search.oninput=scope.onchange=filter;filter();</script>"""
    if not (output / 'duplicate-cleanup.json').exists():
        page = page.replace('<a href="duplicate-cleanup.json">Duplicate-folder cleanup proof</a> · ', '')
    page = page.replace('RULES', esc(RULES)).replace('COUNTS', esc(str(counts))).replace('BLOCKS', '\n'.join(blocks))
    (output / 'index.html').write_text(page)
    (output / 'review-plan.json').write_text(json.dumps(plan, ensure_ascii=False, indent=2))
    (ROOT / 'extra_assets/index/review-plan.json').write_text(json.dumps(plan, ensure_ascii=False, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('inventories', nargs='+', type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--review-plan', type=Path, help='Source systems and reduced original-sheet review lists')
    args = parser.parse_args()
    inventories = [json.loads(src.read_text()) for src in args.inventories]
    packs = [p for inventory in inventories for p in inventory['packs']]
    packs.sort(key=lambda p: (p['eligibility'] != 'native16', p['folder'].lower()))
    plan = (json.loads(args.review_plan.read_text()) if args.review_plan
            else next((d['reviewPlan'] for d in inventories if d.get('reviewPlan')), {}))
    for pack in packs:
        pack['sourceSystem'] = pack.get('sourceSystem', source_system(pack['folder']))
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
    data = {'rules': RULES, 'packs': packs, 'reviewPlan': plan, 'counts': {
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
    cleanup = ROOT / 'extra_assets/index/duplicate-cleanup.json'
    if cleanup.exists():
        shutil.copyfile(cleanup, output / cleanup.name)
    render_review(packs, paths, plan, data['counts'], index, output)
    print(json.dumps(data['counts']))

if __name__ == '__main__':
    main()
