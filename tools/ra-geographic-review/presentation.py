"""Publish current Rogue geographic captures without inactive profile comparisons."""
import argparse
import html
import json
from pathlib import Path
import shutil
from PIL import Image

p = argparse.ArgumentParser()
p.add_argument('--input', type=Path, default=Path('/tmp/ra-geographic'))
p.add_argument('--out', type=Path, default=Path('/tmp/ra-geographic/presentation'))
a = p.parse_args()
a.out.mkdir(parents=True, exist_ok=True)
cards = []
for before in sorted(a.input.glob('*-rogue-unrestored.png')):
    slug = before.name.removesuffix('-rogue-unrestored.png')
    figures = []
    for state in ['unrestored', 'restored']:
        source = a.input / f'{slug}-rogue-{state}.png'
        if not source.exists():
            continue
        cropped = f'{slug}-{state}-map.png'
        with Image.open(source) as image:
            image.crop((0, 96, 352, 448)).save(a.out / cropped)
        shutil.copy2(source, a.out / source.name)
        audit = source.with_suffix('.json')
        detail = ''
        if audit.exists():
            shutil.copy2(audit, a.out / audit.name)
            data = json.loads(audit.read_text())
            materials = ', '.join(f'{key}: {value}' for key, value in data.get('artAudit', {}).get('materials', {}).items())
            detail = f' · <a href="{html.escape(audit.name)}">renderer audit</a><p>{html.escape(materials)}</p>'
        figures.append(f'<figure><a href="{html.escape(source.name)}"><img src="{html.escape(cropped)}" alt="{html.escape(slug)} {state}"></a><figcaption>{state.title()}{detail}</figcaption></figure>')
    cards.append(f'<section><h2>{html.escape(slug.replace("-", " ").title())}</h2><div class="pair">{"".join(figures)}</div></section>')
for path in a.input.glob('*validation*.json'):
    if 'dreamland' not in path.name and 'baseline' not in path.name:
        shutil.copy2(path, a.out / path.name)
root = Path(__file__).resolve().parents[2]
shutil.copy2(root / 'assets/ArtTrials/RogueTerrain/tiles.png', a.out / 'source-tiles.png')
shutil.copy2(root / 'assets/ArtTrials/RogueTerrain/manifest.json', a.out / 'source-manifest.json')
page = '''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Rogue Adventure · Geographic review</title><style>body{max-width:1000px;margin:32px auto;padding:0 20px;background:#162018;color:#e0e7d5;font:16px/1.5 system-ui}a{color:#c0dfa0}section{margin:32px 0}.pair{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:16px}figure{margin:0}img{display:block;max-width:100%;image-rendering:pixelated}figcaption{margin:8px 0}</style><h1>Rogue Adventure on real-world geometry</h1><p><a href="http://localhost:8000/index.html?deepforest=on">Open the game</a></p><p>These captures use the current Rogue renderer and normal geographic loader. Restored and unrestored states share the same artwork profile, placement rules and gameplay lighting. Click a map to inspect its full screenshot.</p>CARDS<section><h2>Terrain sources</h2><img src="source-tiles.png" alt="Current Rogue terrain tiles"><p><a href="source-manifest.json">Source provenance</a></p></section></html>'''
(a.out / 'index.html').write_text(page.replace('CARDS', '\n'.join(cards)))
print(f'{len(cards)} Rogue geographic reviews written to {a.out}')
