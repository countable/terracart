#!/usr/bin/env python3
"""Build the design directory; preserve review artifacts and use relative URLs.

Run with --output ~/.artifacts/dragon-hood-dashboards. The artifact server
must serve the checkout's tools, src, assets, docs and index.html read-only
alongside the saved review folders. Live tools load current game definitions;
saved visual audits remain snapshots and should be regenerated when needed.
The default output also gets a relative /design/ alias for a short bookmark.
Requires Python Markdown (python3 -m pip install Markdown).
"""
import argparse
import re
import os
from html import escape
from pathlib import Path
from urllib.parse import urljoin

STYLE = '''
:root{color-scheme:dark;background:#101919;color:#ecf3e9;font:16px/1.6 system-ui,sans-serif}*{box-sizing:border-box}body{margin:0}main{max-width:1180px;margin:auto;padding:80px 24px 32px}h1{font-size:clamp(32px,5vw,48px);line-height:1.15}h2{margin-top:32px}p{color:#afc1b7;max-width:850px}a{color:#c7e991}nav{display:flex;flex-wrap:wrap;gap:20px;margin:12px 0 24px}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.card{display:block;background:#192525;border:1px solid #344545;border-radius:12px;padding:22px;text-decoration:none;color:inherit}.card h2,.card h3{margin:0 0 8px}.card p{margin:0}.tag{font-size:12px;color:#c7e991}a:focus-visible,button:focus-visible{outline:3px solid #efca79;outline-offset:4px}button{font:inherit;padding:10px 16px;background:#192525;border:1px solid #52675f;border-radius:8px;color:inherit;cursor:pointer}button[aria-pressed=true]{background:#35482b;border-color:#c7e991}.view-controls{display:flex;gap:10px;flex-wrap:wrap;margin:20px 0}iframe{width:100%;height:78vh;min-height:500px;border:1px solid #344545;border-radius:8px;background:#101919}.wide{max-width:1700px;padding-top:32px}.note{border-left:3px solid #efca79;padding:10px 16px;background:#252a20}footer{margin-top:32px;border-top:1px solid #344545;padding-top:16px;font-size:13px}li{margin-bottom:10px}
@media(max-width:900px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:600px){.grid{grid-template-columns:1fr}}
'''
SANDBOX = '<section><h2>Try a biome in the sandbox</h2><p data-sandbox-directory></p></section><script src="../src/sandbox_destinations.js"></script><script src="../tools/sandbox-links.js"></script>'
NAV = '<nav aria-label="Design navigation"><a href="index.html">Design dashboards</a><a href="developer-tools.html">Developer tools</a><a href="archive.html">Archive</a></nav>'

def page(title, body, wide=False):
    return f'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dragon Hood · {escape(title)}</title><style>{STYLE}</style></head><body><main class="{"wide" if wide else ""}">{NAV}<h1>{escape(title)}</h1>{body}<footer>Live tools use current game definitions. Saved reviews are snapshots; their original findings and artwork are preserved.</footer></main></body></html>'

def card(url, title, description, tag=''):
    return f'<a class="card" href="{escape(url)}"><span class="tag">{escape(tag)}</span><h2>{escape(title)}</h2><p>{escape(description)}</p></a>'

def glossary_page():
    """Render the maintained glossary; requires Python's Markdown package."""
    import markdown
    source = Path(__file__).resolve().parents[1] / 'docs/design/glossary.md'
    body = markdown.markdown(source.read_text().split('\n', 1)[1], extensions=['tables', 'toc'])
    # Evidence paths are relative to the source doc, not the dashboard directory.
    body = re.sub(r'href="([^"]+)"', lambda m: 'href="' + escape(urljoin('/docs/design/', m[1]), quote=True) + '"', body)
    body = '<p><a href="../docs/design/glossary.md">Markdown source</a></p>' + body
    styles = '<style>table{border-collapse:collapse;width:100%;font-size:14px}th,td{border:1px solid #344545;padding:12px;text-align:left;vertical-align:top}th{background:#192525}td{min-width:160px}.glossary{overflow-x:auto}code{overflow-wrap:anywhere}main{padding-top:32px}</style>'
    return page('Game terminology glossary', '<div class="glossary">' + body + '</div>', True).replace('</head>', styles + '</head>')

def views(title, intro, entries, extra=''):
    controls=''.join(f'<button type="button" data-url="{escape(url)}" aria-pressed="{str(i==0).lower()}">{escape(label)}</button>' for i,(label,url) in enumerate(entries))
    label,url=entries[0]
    body=f'<p>{intro}</p>{extra}<div class="view-controls" aria-label="Choose view">{controls}</div><p><a id="open-view" href="{url}">Open {escape(label)} separately</a></p><iframe id="view" src="{url}" title="{escape(label)}" loading="lazy"></iframe>'
    body+='''<script>const buttons=[...document.querySelectorAll('[data-url]')];for(const button of buttons)button.addEventListener('click',()=>{for(const b of buttons)b.setAttribute('aria-pressed',String(b===button));const frame=document.getElementById('view');frame.src=button.dataset.url;frame.title=button.textContent;const link=document.getElementById('open-view');link.href=button.dataset.url;link.textContent='Open '+button.textContent+' separately';});</script>'''
    return page(title,body,True).replace('<meta charset="utf-8">', '<meta charset="utf-8"><meta name="artifact-review" content="disabled">', 1)

ARCHIVES = {
 'Monster and character history': [
 ('../enemy-roster-proposal-2026-09-28/archive.html','Original monster proposal and palette study','Historical roster and balance assumptions; includes retired enemies. Use Monsters for current data and palette review.'),
 ('../terracart-sprite-audit/enemy-preview.html','Saved enemy viewer','Snapshot retained for comparison; current animations and roster are in Monsters.'),
 ('../terracart-sprite-audit/index.html','Sprite cleanup completion','Implementation report, including old validation counts.'),
 ('../terracart-sprite-audit/default-comparison.html','Previous default and class comparison','The default-character decision has shipped.'),
 ('../terracart-sprite-audit/audit-before-cleanup.html','Pre-cleanup sprite inventory','Superseded inventory and cleanup recommendations.')],
 'Loot design and balance history': [
 ('../chest-theme-design/index.html','Themed chest design','Approved and implemented; original proposal wording is historical.'),
 ('../chest-balance/index.html','Chest balance simulation','The specialist rates and measured changes were approved. This is a past simulation, not current live output.')],
 'Art explorations and approvals': [
 ('../map-art-approved-reference/index.html','Map art approval reference','Archived before/after proposal.'),
 ('../sandbox-art-comparison/index.html','Sandbox before and after','Captured comparison from the art implementation.'),
 ('../bush-art-options/index.html','Bush options','Selection study; consult World art for the later shipping audit.'),
 ('../zone-variants/nature-art.html','Nature and ruins candidates','Mixed applied defaults and unselected alternatives; some descriptions predate later art changes.'),
 ('../zone-variants/beach-drafts.html','Beach drafts','Historical design; live zone definitions have since evolved.'),
 ('../zone-variants/grave-shrine-art.html','Grave and shrine candidates','Historical selection; headstone descriptions conflict with the later pillar selection.'),
 ('../zone-variants/stone-pillar-candidates.html','Stone pillar candidates','Later selection study retained for provenance.')],
 'Engineering reports': [
 ('../zone-variants/spawn-precedence-fixes.html','Spawn precedence fixes','One canonical link; the alternate audit HTML is byte-identical.'),
 ('../terracart-sandbox-2026-09-28/index.html','Sandbox mechanics probe','Findings at the recorded commit, not an assertion about current bugs.'),
 ('../terracart-perf-first-pass/report.html','First-pass performance validation','Historical implementation and benchmark evidence.')]
}

def build(output):
    glossary = glossary_page()
    output.mkdir(parents=True,exist_ok=True)
    if output.name == 'dragon-hood-dashboards':
        alias = output.parent / 'design'
        # Older installs pointed this bookmark at the previous game's directory.
        if alias.is_symlink() and alias.readlink() != Path(output.name):
            alias.unlink()
        if not alias.exists() and not alias.is_symlink():
            alias.symlink_to(output.name, target_is_directory=True)
    # Promote the proposal bookmark while preserving its original review once.
    proposal = output.parent / 'enemy-roster-proposal-2026-09-28'
    if (proposal / 'index.html').is_file():
        archive = proposal / 'archive.html'
        if not archive.exists():
            archive.write_text((proposal / 'index.html').read_text())
        (proposal / 'index.html').write_text('<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Monsters</title><meta http-equiv="refresh" content="0;url=../tools/monster-roster.html"></head><body><a href="../tools/monster-roster.html">Open the live monster viewer</a></body></html>')
    primary=[
      ('glossary.html','Terminology glossary','Shared game concepts, preferred names, alternate terminology and unresolved distinctions.','Design reference'),
      ('chests.html','Chest index','Live POI sources, chest artwork, vista and cave rewards, and four-city expectations.','Live game data'),
      ('../tools/monster-roster.html','Monsters','Current roster, habitats, combat comparisons and palette review in the approved table viewer.','Live game data'),
      ('world-art.html','World art','Current artwork in a sortable table, filtered by zone and category.','Live game data'),
      ('zones.html','Zones','Special zones, road variants and basic tile previews, grouped by category.','Generated game data'),
      ('../tools/map-distribution.html','Map distribution','Compare current placements in Kelowna, Vancouver, Seattle and Berlin.','Live game data'),
      ('../tools/treasure-balancing.html','Treasure balancing','Roll rewards by location and tier; compare chest, treasure and fishing results.','Live game data'),
      ('../tools/items.html','Items','Current item catalogue, equipment and source information.','Live game data'),
      ('../tools/map-review.html','Map review','Inspect terrain, world generation and placements.','Live game data')]
    (output/'index.html').write_text(page('Design dashboards','<p>Design tables for reviewing the game. Older proposals, implementation reports and candidate studies are in the archive.</p><p><a href="../tools/treasure-balancing.html">Open treasure roll simulator →</a></p><div class="grid">'+''.join(card(*row) for row in primary)+'</div>'+SANDBOX).replace('<meta charset="utf-8">','<meta charset="utf-8"><meta name="artifact-review" content="disabled">',1).replace('padding:80px 24px 32px','padding:32px 24px 32px'))
    (output/'chests.html').write_text('<!doctype html><html lang="en"><meta charset="utf-8"><title>Chest index</title><meta http-equiv="refresh" content="0;url=../tools/chest-report.html"><a href="../tools/chest-report.html">Open the live chest index</a></html>')
    (output/'world-art.html').write_text('<!doctype html><html lang="en"><head><meta charset="utf-8"><title>World art</title><meta http-equiv="refresh" content="0;url=../tools/world-art.html"></head><body><a href="../tools/world-art.html">Open current world art</a></body></html>')
    (output/'zones.html').write_text('<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Zones</title><meta http-equiv="refresh" content="0;url=../zone-variants/index.html"></head><body><a href="../zone-variants/index.html">Open zones and road variants</a></body></html>')
    balance_links = [('../tools/map-distribution.html', 'Map distribution', 'Placement and value tables for Kelowna, Vancouver, Seattle and Berlin.'), ('../tools/treasure-balancing.html', 'Treasure balancing', 'Live reward simulator by location, tier and player equipment.')]
    (output/'balance.html').write_text(page('Balance', '<p>Choose the part of game balance to inspect.</p><div class="grid">'+''.join(card(*row) for row in balance_links)+'</div>').replace('<meta charset="utf-8">', '<meta charset="utf-8"><meta name="artifact-review" content="disabled">', 1).replace('padding:80px 24px 32px', 'padding:32px 24px 32px'))
    developer=[('../tools/building-poly-preview.html','Building footprints','Fixture preview using the current building renderer.'),('../tools/compass-test.html','Compass diagnostics','Device heading and orientation debugging.'),('../tools/poi-preview.html','Procedural POI ideas','Earlier procedural design experiments; not a shipping sprite catalogue.')]
    (output/'developer-tools.html').write_text(page('Developer tools','<p>Specialist diagnostics and experiments.</p><div class="grid">'+''.join(card(*r) for r in developer)+'</div>'))
    sections=[]
    for title,entries in ARCHIVES.items():
      anchor=title.lower().replace(' ','-')
      sections.append(f'<section id="{anchor}"><h2>{title}</h2><ul>'+''.join(f'<li><a href="{url}">{escape(label)}</a> — {escape(note)}</li>' for url,label,note in entries)+'</ul></section>')
    (output/'archive.html').write_text(page('Archive','<p class="note">Historical evidence and design explorations. References to “current”, “proposed”, test counts and outstanding decisions describe the original review. Use the main dashboards for ongoing work.</p>'+''.join(sections)))
    # Keep old bookmarks useful without changing the archived evidence itself.
    for entries in ARCHIVES.values():
        for url, label, note in entries:
            archived = (output / url).resolve()
            if not archived.is_file():
                continue
            old = archived.read_text()
            old = re.sub(r'<aside id="design-archive-notice".*?</aside>', '', old, flags=re.S)
            hub = os.path.relpath(output / 'index.html', archived.parent)
            current = os.path.relpath(output.parent / 'tools/monster-roster.html', archived.parent) if 'monster proposal' in label.lower() or label == 'Saved enemy viewer' else hub
            banner = f'<aside id="design-archive-notice" style="margin:72px 20px 16px;padding:16px;background:#252a20;color:#ecf3e9;border-left:3px solid #efca79;font:15px/1.5 system-ui"><strong>Archived review.</strong> {escape(note)} <a style="color:#c7e991" href="{current}">Open current dashboard →</a></aside>'
            updated = re.sub(r'(<body\b[^>]*>)', lambda m: m[1] + banner, old, count=1, flags=re.I)
            archived.write_text(updated)
    (output/'glossary.html').write_text(glossary)
    print(f'Wrote design directory pages to {output}')

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,default=Path.home()/'.artifacts/dragon-hood-dashboards')
    build(parser.parse_args().output)
