#!/usr/bin/env python3
"""Export stackable native terrain corners and selected-material transitions."""
from pathlib import Path
import hashlib
import json
import subprocess
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path('extra_assets/16x16/Rogue Adventure World/Rogue Adventure World [Sprites]/Tilesets')
OUT = ROOT / 'assets/ArtTrials/RogueTerrain'
OUT.mkdir(parents=True, exist_ok=True)

# This dependency-free registry is also loaded by the browser. The exporter
# reads exactly the same family order, material frames and source rectangles.
registry_script = "const fs=require('fs');const registry=new Function(fs.readFileSync('src/ground_materials.js','utf8')+';return GroundMaterials;')();process.stdout.write(JSON.stringify(registry));"
registry = json.loads(subprocess.check_output(['node','-e',registry_script], cwd=ROOT))
families = [row for row in registry['families'] if row.get('source')]
# Use the tested selector from the studies at export time. The running game
# needs only the exported atlas, never this tool or the original art pack.
resolver = "const a=require('./tools/jungle-autotile.js');const rows=JSON.parse(process.argv[1]);process.stdout.write(JSON.stringify(rows.map(r=>Array.from({length:16},(_,m)=>a.dualTiles(m,r.options)))));"
choices = json.loads(subprocess.check_output(['node','-e',resolver,json.dumps(families)], cwd=ROOT))
atlas = Image.new('RGBA',(256,len(registry['families'])*16))
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
def selected_family(name, material, center=None, variant=None):
    entry = next((e for e in selected_entries if e['id'] == material), None)
    if entry is not None:
        assert entry['frame'] == registry['selectedMaterialFrames'][material], material
    family_index = len(rows)
    if center is None:
        center = selected.crop((entry['frame']*16,0,(entry['frame']+1)*16,16))
    for mask in range(16):
        alpha = atlas.crop((mask*16,2*16,(mask+1)*16,3*16)).getchannel('A')
        tile = center.copy()
        tile.putalpha(alpha)
        atlas.paste(tile,(mask*16,family_index*16))
    rows.append(dict(id=name,index=family_index,selectedMaterial=material,
        selectedFrame=entry['frame'] if entry else None,maskFamily='oliveSoil',
        variant=variant,source='assets/selected-terrain/selected-terrain.png' if entry else 'src/textures.js:drawRockyGroundTex'))

for row in registry['families']:
    if row.get('selectedMaterial'):
        selected_family(row['id'],row['selectedMaterial'])

# Match drawRockyGroundTex at its native 16px scale, including its seeded RNG.
for row in registry['families']:
    if row.get('recipe') != 'rockyGround':
        continue
    variant = row['variant']
    center = Image.new('RGBA',(16,16),'#646351')
    draw = ImageDraw.Draw(center)
    state = 34001 + variant
    def rng():
        global state
        state = (state * 1664525 + 1013904223) & 0xffffffff
        return state / 0xffffffff
    for i in range(26):
        x,y,w = int(rng()*16),int(rng()*16),1+int(rng()*3)
        draw.rectangle((x,y,min(15,x+w-1),y),fill='#504f40' if i%3==0 else '#7a7964')
        if i%4==0: draw.point((x,y),fill='#919079')
    selected_family(row['id'],'ROCKY_GROUND',center,variant)
assert [row['id'] for row in rows] == [row['id'] for row in registry['families']]
atlas.save(OUT/'tiles.png')
manifest=dict(frameSize=16,columns=16,rows=len(rows),families=rows,notes='Native full-tile corners. Diagonal contacts remain separate. Water ripple pixels use the source dominant pigment as in the approved study; no cliffs, decorative grass, rocks or flowers are baked into walkable ground.')
(OUT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(f'Exported {len(rows)*16} frames to {OUT.relative_to(ROOT)}')
