"""Build a comparison of normal geographic-game renders, without fixture maps."""
import argparse
import html
import json
from pathlib import Path
import shutil
from PIL import Image

p=argparse.ArgumentParser();p.add_argument('--input',type=Path,default=Path('/tmp/ra-geographic'));p.add_argument('--out',type=Path,default=Path('/tmp/ra-geographic/presentation'));a=p.parse_args();a.out.mkdir(parents=True,exist_ok=True)
cards=[]
for after in sorted(a.input.glob('*-rogue-unrestored.png')):
    slug=after.name.removesuffix('-rogue-unrestored.png')
    before=a.input/(slug+'-baseline-unrestored.png')
    if not before.exists():continue
    meta_path=after.with_suffix('.json');meta=json.loads(meta_path.read_text());audit=meta.get('artAudit',{})
    sources=[('baseline',before),('rogue',after)]
    dreamland=a.input/(slug+'-dreamland-unrestored.png')
    if dreamland.exists():sources.append(('dreamland',dreamland))
    for tag,source in sources:
        im=Image.open(source);im.crop((0,96,352,448)).save(a.out/(slug+'-'+tag+'.png'))
        shutil.copy(source,a.out/source.name)
        if source.with_suffix('.json').exists():shutil.copy(source.with_suffix('.json'),a.out/source.with_suffix('.json').name)
    extra=''
    if dreamland.exists():extra=f'<figure><a href="{dreamland.name}"><img src="{slug}-dreamland.png" alt="Dreamland geographic map at {slug}"></a><figcaption>Dreamland native transitions and paving</figcaption></figure>'
    materials=', '.join(f'{k}: {v}' for k,v in audit.get('materials',{}).items())
    cards.append(f'''<section><h2>{html.escape(slug.replace('-',' ').title())}</h2><div class="pair"><figure><a href="{slug}-baseline-unrestored.png"><img src="{slug}-baseline.png" alt="Original geographic map at {slug}"></a><figcaption>Current renderer</figcaption></figure><figure><a href="{slug}-rogue-unrestored.png"><img src="{slug}-rogue.png" alt="RA geographic map at {slug}"></a><figcaption>RA native transitions</figcaption></figure>{extra}</div><p class="small">{audit.get('drawnCells',0)} cells use the trial atlas. {html.escape(materials)}. <a href="{slug}-rogue-unrestored.json">Map and renderer audit</a></p></section>''')
if (a.input/'dreamland-validation.json').exists():shutil.copy(a.input/'dreamland-validation.json',a.out/'dreamland-validation.json')
if (a.input/'validation.json').exists():shutil.copy(a.input/'validation.json',a.out/'validation.json')
for path in a.input.glob('*comparison*.json'):shutil.copy(path,a.out/path.name)
for path in a.input.glob('*-boundary.json'):shutil.copy(path,a.out/path.name)
for path in a.input.glob('*-errors.json'):shutil.copy(path,a.out/path.name)
for path in a.input.glob('*-mobile-page.png'):shutil.copy(path,a.out/path.name)
root=Path(__file__).resolve().parents[2]
shutil.copy(root/'assets/ArtTrials/RogueTerrain/tiles.png',a.out/'source-tiles.png')
shutil.copy(root/'assets/ArtTrials/RogueTerrain/manifest.json',a.out/'source-manifest.json')
page='''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Rogue Adventure · Real geographic map</title><style>body{max-width:1000px;margin:32px auto;padding:0 20px;background:#162018;color:#e0e7d5;font:16px/1.5 system-ui}a{color:#c0dfa0}h1{line-height:1.2}h2{font-size:22px}section{margin:32px 0;border-top:1px solid #3d5039;padding-top:12px}.pair{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:16px}figure{margin:0}img{display:block;max-width:100%;width:100%;image-rendering:pixelated}figcaption{margin:8px 0}.small{font-size:13px;color:#b6c4ad}code{overflow-wrap:anywhere}@media(max-width:600px){.pair{grid-template-columns:1fr}}</style><h1>Tilesets on real-world geometry</h1><p><a href="http://localhost:8000/index.html?artTrial=dreamland&amp;deepforest=on">Open normal game with Dreamland terrain and paving</a> · <a href="dreamland-validation.json">Dreamland validation</a> · <a href="http://localhost:8765/dreamland-square-hooks/">Reference and source selection</a></p><p><a href="validation.json">Six-location validation report</a></p><p><a href="http://localhost:8000/index.html?artTrial=rogue&amp;deepforest=on">Open the normal geographic game with RA terrain</a></p><p>These captures use real Kelowna map data through the normal tile loader and world generator. The comparison changes terrain artwork and native transitions; geographic cells, roads, building models, trees, objects and gameplay retain their existing definitions.</p><p>Special nexus materials, exclusion ground and underground floors retain their current art. The normal lighting is preserved. Images below crop the map area from the actual renderer; click to see each complete capture.</p>CARDS<section><h2>Source tiles</h2><p>Seven source families, each with sixteen native corner masks. The renderer caches 2,401 combinations once, then selects frames from geographic neighbors.</p><img style="width:768px;max-width:100%" src="source-tiles.png" alt="RA source transition tiles"><p><a href="source-manifest.json">Exact sprite sources and coordinates</a></p></section></html>'''
(a.out/'index.html').write_text(page.replace('CARDS','\n'.join(cards)))
print(f'{len(cards)} geographic comparisons written to {a.out}')
