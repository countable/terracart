#!/usr/bin/env python3
"""Publish actual-map captures and source provenance for the current Rogue renderer."""
from pathlib import Path
import argparse,json,shutil,html
from PIL import Image
ROOT=Path(__file__).resolve().parents[2]
p=argparse.ArgumentParser();p.add_argument('--input',type=Path,default=Path('/tmp/ra-complete'));p.add_argument('--out',type=Path,default=Path('/tmp/ra-complete/presentation'));args=p.parse_args();out=args.out;out.mkdir(parents=True,exist_ok=True)
sections=[]
for site,label in [('athalmer','Athalmer residential streets'),('forest','Mapped Kelowna woodland'),('shoreline','Gyro shoreline')]:
 cards=[]
 for state in ['unrestored','restored']:
  src=args.input/f'{site}-rogue-{state}.png'
  if not src.exists():continue
  shutil.copy2(src,out/src.name);im=Image.open(src);im.crop((0,96,352,448)).save(out/(src.stem+'-map.png'))
  audit=src.with_suffix('.json');shutil.copy2(audit,out/audit.name)
  data=json.loads(audit.read_text());coverage=data.get('objectArtAudit',{}).get('textures',{})
  cards.append(f'<figure><a href="{src.name}"><img src="{src.stem}-map.png" alt="{label} {state}"></a><figcaption>{state.title()} · <a href="{audit.name}">audit</a><pre>{html.escape(json.dumps(coverage,indent=2))}</pre></figcaption></figure>')
 sections.append(f'<section><h2>{label}</h2><div class="captures">'+''.join(cards)+'</div></section>')
manifest=json.loads((ROOT/'assets/ArtTrials/RogueObjects/manifest.json').read_text());source=[]
# Provenance retains archived source crops; this review lists only active exports.
manifest=[item for item in manifest if (ROOT/'assets/ArtTrials/RogueObjects'/(item['id']+'.png')).is_file()]
for item in manifest:
 name=item['id']+'.png';shutil.copy2(ROOT/'assets/ArtTrials/RogueObjects'/name,out/name)
 source.append(f'<figure><img class="sprite" src="{name}" alt="{item["id"]}"><figcaption>{item["id"]}<br>{Path(item["source"]).name}<br>{item["rect"]}</figcaption></figure>')
(out/'objects-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
shutil.copy2(ROOT/'assets/ArtTrials/RogueTerrain/manifest.json',out/'terrain-manifest.json')
shutil.copy2(ROOT/'assets/ArtTrials/RogueTerrain/tiles.png',out/'terrain.png')
(out/'index.html').write_text('''<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Rogue Adventure geographic profile</title><style>body{font:16px system-ui;background:#171b18;color:#e7e8d9;max-width:1100px;margin:auto;padding:24px}a{color:#d8c990}h1,h2{font-weight:550}.captures,.sources{display:flex;gap:20px;flex-wrap:wrap}figure{margin:0 0 20px;max-width:100%;padding:12px;background:#242a23}figure img{image-rendering:pixelated;max-width:100%;height:auto}.captures figure{width:352px}.captures img{width:352px}.sources figure{width:160px}.sprite{max-height:160px;object-fit:contain}pre{font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere}p{max-width:850px;line-height:1.5}</style><h1>Rogue Adventure on real-world geometry</h1><p>Native reference trees, eligible restored village houses, stone lamps, plain rocks and ladder-down hatch. The ground mixes source-native grass with irregular soil patches using stable world coordinates and cached autotile frames. DeepForest supplies existing real tree placements; the artwork changes, not their identities or locations.</p><p><a href="http://localhost:8000/index.html?deepforest=on">Open the game</a></p><p>These captures use the normal geographic loader, not authored mock scenes. Restoration runs the existing house/street APIs inside an isolated review save. Unrestored ruins retain authentic existing ruined art because the reference has no matching ruin; named ore deposits and special-zone architecture also retain meaningful existing artwork. No cliffs, benches, fences or standing grass clumps are added. Gameplay lighting is retained.</p>'''+''.join(sections)+'''<h2>Native source objects</h2><p><a href="objects-manifest.json">Exact source crops, assembly steps and SHA-256</a> · <a href="terrain-manifest.json">Terrain provenance</a></p><div class="sources">'''+''.join(source)+'''</div><h2>Eight native terrain families</h2><img style="image-rendering:pixelated;width:100%;max-width:768px" src="terrain.png" alt="Source-native masks for village grass, forest grass, olive and dark soil, water, sand, stone and brown soil"><p>Actual streets retain their vector geometry and existing RA Ancient paving (ordinary R01/R02 source crops [160,0,16,16] and [176,0,16,16]); the village reference’s earthen paths are represented by brown ground patchwork rather than replacing real roads. Profile art does not change movement, collisions, source landcover or saved object identity.</p>''')
print(out)
