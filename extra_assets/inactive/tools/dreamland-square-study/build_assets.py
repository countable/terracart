#!/usr/bin/env python3
"""Export source-exact Dreamland village ground and reviewed object crops."""
from pathlib import Path
import json, hashlib, subprocess, argparse
from PIL import Image, ImageDraw
ROOT=Path(__file__).resolve().parents[2]
HERE=Path(__file__).resolve().parent
SRC=Path('extra_assets/16x16/Fantasy Dreamland World/Fantasy Dreamland Reborn/Tilesets')
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--out',type=Path,default=HERE/'assets')
OUT=parser.parse_args().out
OUT.mkdir(exist_ok=True,parents=True)
def corners(x,y):
 return dict(x=x,y=y,tileSize=16,inner=dict(nw=[x+80,y+32],ne=[x+48,y+32],sw=[x+80,y],se=[x+48,y]))
families=[
 dict(id='villageGrass',source='FDR_Ground_Tiles.png',options=corners(0,0)),
 dict(id='forestGrass',source='FDR_Ground_Tiles.png',options=corners(0,0)),
 dict(id='oliveSoil',source='FDR_Ground_Tiles.png',options=corners(0,128)),
 dict(id='darkSoil',source='FDR_Ground_Tiles.png',options=corners(96,128)),
 dict(id='water',source='FDR_Water_Tiles.png',options=corners(0,0)),
 dict(id='sand',source='FDR_Ground_Tiles.png',options=corners(192,128)),
]
resolver="const a=require('./tools/jungle-autotile.js');process.stdout.write(JSON.stringify(JSON.parse(process.argv[1]).map(r=>Array.from({length:16},(_,m)=>a.dualTiles(m,r.options)))));"
parts=json.loads(subprocess.check_output(['node','-e',resolver,json.dumps(families)],cwd=ROOT))
atlas=Image.new('RGBA',(256,112)); manifest=[]
for i,(family,masks) in enumerate(zip(families,parts)):
 source=Image.open(ROOT/SRC/family['source']).convert('RGBA');frames=[]
 for mask,tiles in enumerate(masks):
  tile=Image.new('RGBA',(16,16))
  for p in tiles: tile.alpha_composite(source.crop((p['sx'],p['sy'],p['sx']+16,p['sy']+16)))
  if mask==15: assert tile.getchannel('A').getextrema()==(255,255),family['id']
  atlas.alpha_composite(tile,(mask*16,i*16));frames.append(dict(mask=mask,rects=[[p['sx'],p['sy'],16,16] for p in tiles]))
 manifest.append(dict(family,source=str(SRC/family['source']),frames=frames))
# Paving has discrete authored stones rather than a solid connected border.
# Its four corners inherit the soil field through alpha; do not invent edge tiles.
village=Image.open(ROOT/SRC/'FDR_Village.png').convert('RGBA')
for mask in range(16):
 tile=Image.new('RGBA',(16,16));stone=village.crop((16,0,32,16));stone.alpha_composite(village.crop((0,16,16,32)))
 for q,(x,y) in enumerate([(0,0),(8,0),(0,8),(8,8)]):
  if mask&(1<<q):tile.alpha_composite(stone.crop((x,y,x+8,y+8)),(x,y))
 atlas.alpha_composite(tile,(mask*16,96))
manifest.append(dict(id='stone',source=str(SRC/'FDR_Village.png'),rect=[0,16,16,16],notes='Four occupancy quadrants of an authored stone; no cliff artwork.'))
# Keep native bank silhouettes at game scale, but fill quiet surfaces with
# 1:1 source speckles instead of magnifying every pixel to a 2px block.
# This is offline baking; runtime never reads pixels while walking.
native=atlas.resize((512,224),Image.Resampling.NEAREST)
flat=village.crop((32,0,48,16))
for family in [0,1]:
 for mask in range(16):
  for y in range(32):
   for x in range(32):
    pos=(mask*32+x,family*32+y)
    if native.getpixel(pos)==(155,178,62,255):
     # Coherent islands have a subtle lighter source-palette interior.
     pixel=flat.getpixel((x%16,y%16))
     if family==1 and pixel==(155,178,62,255):pixel=(165,188,73,255)
     native.putpixel(pos,pixel)
native.save(OUT/'terrain.png')
ground_detail=dict(source=str(SRC/'FDR_Village.png'),rect=[32,0,16,16],frameSize=32,notes='Source speckles at 1:1 pixels inside 2x native bank silhouettes; island fill uses source highlight palette.')
# Source path pieces preserve their proportions. Mix broad and split slabs.
road=Image.new('RGBA',(64,64));restored=Image.new('RGBA',(64,64));cells=[];restored_cells=[]
grass=village.crop((16,0,32,16))
for y in range(4):
 for x in range(4):
  sx,sy=([(0,16),(160,16),(16,16),(176,16),(32,16),(192,16),(64,16),(160,0)][(x+y*3)%8])
  road.alpha_composite(grass,(x*16,y*16));restored.alpha_composite(grass,(x*16,y*16))
  rx,ry=[(0,16),(160,16),(176,0)][(x+y*2)%3]
  restored.alpha_composite(village.crop((rx,ry,rx+16,ry+16)),(x*16,y*16));restored_cells.append(dict(at=[x*16,y*16],rect=[rx,ry,16,16]))
  road.alpha_composite(village.crop((sx,sy,sx+16,sy+16)),(x*16,y*16));cells.append(dict(at=[x*16,y*16],rect=[sx,sy,16,16]))
road.save(OUT/'path.png');restored.save(OUT/'path-restored.png')
crops=[
 dict(id='fountain',sheet='FDR_Village.png',rect=[144,416,48,48],role='Existing fountain only; never create an interactable from appearance.'),
 dict(id='hanging-lamp',sheet='FDR_Village.png',rect=[192,416,32,32],role='Existing streetlamp only; preserve light and interaction IDs.'),
 dict(id='round-tree-reference',sheet='FDR_Grasslands.png',rect=[96,256,32,64],role='Source study only. Keep live trees unchanged.'),
 dict(id='grass',sheet='FDR_Village.png',rect=[16,0,16,16],role='Flat ground; no interactable-looking grass clumps.'),
]
for c in crops:
 im=Image.open(ROOT/SRC/c['sheet']).convert('RGBA');x,y,w,h=c['rect'];im.crop((x,y,x+w,y+h)).save(OUT/(c['id']+'.png'));c['source']=str(SRC/c.pop('sheet'))
sources=sorted(set(r['source'] for r in manifest+crops))
result=dict(reference='https://img.itch.zone/aW1hZ2UvMTU2NjQ2OC8xMTkyNzE0Ny5naWY=/original/dve1%2FL.gif',families=manifest,groundDetail=ground_detail,path=dict(source=str(SRC/'FDR_Village.png'),cells=cells,restoredCells=restored_cells,underfill=[16,0,16,16]),objects=crops,sha256={s:hashlib.sha256((ROOT/s).read_bytes()).hexdigest() for s in sources})
(OUT/'manifest.json').write_text(json.dumps(result,indent=2)+'\n')
print('Exported 112 terrain frames, native path field, and 4 reviewed source crops')
