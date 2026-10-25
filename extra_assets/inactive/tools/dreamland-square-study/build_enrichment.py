#!/usr/bin/env python3
"""Native decorative source pieces and water-only fountain animation."""
from pathlib import Path
from PIL import Image, ImageDraw
import json, hashlib
ROOT=Path(__file__).resolve().parents[2]
BASE=ROOT/'extra_assets/16x16/Fantasy Dreamland World/Fantasy Dreamland Reborn'
OUT=ROOT/'assets/ArtTrials/DreamlandEnrichment';OUT.mkdir(parents=True,exist_ok=True)
rows=[('tree-tall','FDR_Grasslands.png',(192,256,32,48)),('shrub','FDR_Grasslands.png',(208,32,16,16)),('shrub-flower','FDR_Grasslands.png',(192,32,16,16)),('flower','FDR_Grasslands.png',(64,16,16,16)),('flowers','FDR_Grasslands.png',(64,48,16,16)),('short-grass','FDR_Grasslands.png',(0,16,16,16)),('slab','FDR_Village.png',(160,16,16,16)),('slab-split','FDR_Village.png',(176,16,16,16)),('slab-small','FDR_Village.png',(192,16,16,16)),('well','FDR_Village.png',(192,80,32,48)),('crate-stack','FDR_Village.png',(96,128,32,32))]
records=[]
for name,sheet,rect in rows:
 source=BASE/'Tilesets'/sheet;x,y,w,h=rect
 Image.open(source).convert('RGBA').crop((x,y,x+w,y+h)).save(OUT/(name+'.png'))
 records.append(dict(id=name,source=str(source.relative_to(ROOT)),rect=list(rect),sha256=hashlib.sha256(source.read_bytes()).hexdigest()))
fountain=Image.open(ROOT/'assets/ArtTrials/DreamlandObjects/fountain.png').convert('RGBA');w,h=fountain.size
anim=Image.new('RGBA',(w*4,h))
# Animate only blue pool pixels, using the same row's source water palette.
# Stone basin/sculpture alpha and pixels never move.
for frame in range(4):
 im=fountain.copy()
 for y in range(h):
  water=[x for x in range(w) if (lambda p:p[3] and p[2]>p[0]*1.3 and p[1]>p[0]*1.2)(fountain.getpixel((x,y)))]
  for i,x in enumerate(water):im.putpixel((x,y),fountain.getpixel((water[(i+frame)%len(water)],y)))
 anim.paste(im,(frame*w,0))
anim.save(OUT/'fountain-water.png');records.append(dict(id='fountain-water',source='assets/ArtTrials/DreamlandObjects/fountain.png',frameWidth=w,frameHeight=h,frames=4,method='Cycle existing water pixels within each blue-only row; basin and sculpture fixed.'))
# Contact sheet makes exact actor choices reviewable for authored scenes.
actors=sorted((BASE/'Characters').glob('*_idle.png'));board=Image.new('RGBA',(10*80,((len(actors)+9)//10)*100),(100,110,60,255));draw=ImageDraw.Draw(board)
for i,p in enumerate(actors):
 im=Image.open(p).convert('RGBA');sprite=im.crop((0,0,32,32));x=i%10*80;y=i//10*100
 board.alpha_composite(sprite.resize((64,64)),(x,y));draw.text((x,y+66),p.stem.replace('fdr_character_',''),fill='white')
board.save('/tmp/dreamland-actors.png')
(OUT/'manifest.json').write_text(json.dumps(records,indent=2)+'\n')
print('Exported native decoration crops and four water-only fountain frames',w,h)
