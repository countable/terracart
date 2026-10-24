#!/usr/bin/env python3
"""Export native RA terrain corners for the opt-in geographic renderer trial."""
from pathlib import Path
import hashlib
import json
import subprocess
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path('extra_assets/16x16/Rogue Adventure World/Rogue Adventure World [Sprites]/Tilesets')
OUT = ROOT / 'assets/ArtTrials/RogueTerrain'
OUT.mkdir(parents=True, exist_ok=True)

def regular(x, y):
    return dict(x=x, y=y, tileSize=16, inner=dict(nw=[x+32,y-16], ne=[x,y-16], sw=[x+32,y-48], se=[x,y-48]))

def jungle(x):
    return dict(x=x, y=528, tileSize=16, inner=dict(nw=[x+64,544], ne=[x+48,544], sw=[x+64,528], se=[x+48,528]))

families = [
    dict(id='villageGrass', source='RA_Ground_Tiles.png', options=regular(80,64)),
    dict(id='forestGrass', source='RA_Jungle.png', options=jungle(0)),
    dict(id='oliveSoil', source='RA_Jungle.png', options=jungle(80)),
    dict(id='darkSoil', source='RA_Jungle.png', options=jungle(160)),
    dict(id='water', source='RA_Animated_Water.png', options=dict(x=0,y=64,tileSize=16,inner=dict(nw=[32,48],ne=[0,48],sw=[32,16],se=[0,16])), calmWater=True),
    dict(id='sand', source='RA_Overworld_Ground.png', options=regular(144,48)),
    dict(id='stone', source='RA_Ground_Tiles.png', options=regular(272,64)),
    dict(id='brownSoil', source='RA_Ground_Tiles.png', options=regular(208,64)),
]
# Use the tested selector from the studies at export time. The running game
# needs only the exported atlas, never this tool or the original art pack.
resolver = "const a=require('./tools/jungle-autotile.js');const rows=JSON.parse(process.argv[1]);process.stdout.write(JSON.stringify(rows.map(r=>Array.from({length:16},(_,m)=>a.dualTiles(m,r.options)))));"
choices = json.loads(subprocess.check_output(['node','-e',resolver,json.dumps(families)], cwd=ROOT))
atlas = Image.new('RGBA',(256,(len(families)+2)*16))
rows = []
for family_index, (family, masks) in enumerate(zip(families, choices)):
    source_path = SOURCE / family['source']
    source = Image.open(ROOT / source_path).convert('RGBA')
    if family.get('calmWater'):
        pixels = list(source.getdata())
        source.putdata([(53,75,76,a) if a and g>r and b>=g*.85 and g>=70 else (r,g,b,a) for r,g,b,a in pixels])
    frames = []
    for mask, parts in enumerate(masks):
        tile = Image.new('RGBA',(16,16))
        for part in parts:
            x,y=part['sx'],part['sy']
            if x<0 or y<0 or x+16>source.width or y+16>source.height:
                raise ValueError((family['id'],mask,part))
            tile.alpha_composite(source.crop((x,y,x+16,y+16)))
        if mask == 0 and tile.getbbox() is not None:
            raise ValueError('Empty-mask pixels')
        if mask == 15 and tile.getchannel('A').getextrema() != (255,255):
            raise ValueError('Center must be opaque: '+family['id'])
        atlas.alpha_composite(tile,(mask*16,family_index*16))
        frames.append(dict(mask=mask, frame=family_index*16+mask, sourceRects=[[p['sx'],p['sy'],16,16] for p in parts]))
    rows.append(dict(id=family['id'],index=family_index,source=str(source_path),sourceSHA256=hashlib.sha256((ROOT/source_path).read_bytes()).hexdigest(),calmWater=family.get('calmWater',False),frames=frames))
# Reuse RA earth silhouettes with the selected, already-tinted interiors.
# Water remains the last composite layer, retaining its original bank pixels.
selected = Image.open(ROOT/'assets/selected-terrain/selected-terrain.png').convert('RGBA')
selected_entries = json.loads((ROOT/'assets/selected-terrain/sources.json').read_text())['entries']
for name, material in [('churchyard','G06-purple'), ('tarYard','G09-smooth-grey')]:
    entry = next(e for e in selected_entries if e['id'] == material)
    family_index = len(rows)
    center = selected.crop((entry['frame']*16,0,(entry['frame']+1)*16,16))
    for mask in range(16):
        alpha = atlas.crop((mask*16,2*16,(mask+1)*16,3*16)).getchannel('A')
        tile = center.copy()
        tile.putalpha(alpha)
        atlas.paste(tile,(mask*16,family_index*16))
    rows.append(dict(id=name,index=family_index,source='assets/selected-terrain/selected-terrain.png',
        selectedMaterial=material,selectedFrame=entry['frame'],maskFamily='oliveSoil',
        sourceSHA256=hashlib.sha256((ROOT/'assets/selected-terrain/selected-terrain.png').read_bytes()).hexdigest()))
atlas.save(OUT/'tiles.png')
manifest=dict(frameSize=16,columns=16,rows=len(rows),families=rows,notes='Native full-tile corners. Diagonal contacts remain separate. Water ripple pixels use the source dominant pigment as in the approved study; no cliffs, decorative grass, rocks or flowers are baked into walkable ground.')
(OUT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(f'Exported {len(rows)*16} frames to {OUT.relative_to(ROOT)}')
