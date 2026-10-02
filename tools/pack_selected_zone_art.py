#!/usr/bin/env python3
"""Pack approved zone objects, used pots and connected hedge art."""
from pathlib import Path
import json
from PIL import Image
root=Path(__file__).resolve().parents[1]
out=root/'assets/Objects/ZoneVariants'
source=Image.open(out/'objects-24.png').convert('RGBA')
selection=json.loads((out/'selection.json').read_text())
# Keep approved additions after the original 64 slots, so existing frame IDs
# stay fixed and rerunning the packer cannot drop the reviewed zone rocks.
additions=json.loads((out/'approved-additions.json').read_text())
last_frame=max([source.width//24 * (source.height//24)-1]+[r['frame'] for r in additions['frames']])
approved=Image.new('RGBA',(source.width, (last_frame//8+1)*24))
for frame in selection['selectedFrames']:
 x,y=frame%8*24,frame//8*24
 tile=source.crop((x,y,x+24,y+24));approved.paste(tile,(x,y))
 name=json.loads((out/'manifest.json').read_text())['frames'][frame]['name']
 tile.save(out/(name+'.png'))
for row in additions['frames']:
 tile=Image.open(out/row['source']).convert('RGBA')
 if tile.size != (24,24): raise ValueError(f"Expected 24px zone art: {row['source']}")
 approved.paste(tile,(row['frame']%8*24,row['frame']//8*24))
approved.save(out/'approved-24.png')
pots=Image.open(out/'pots-smashed-source.png').convert('RGBA')
pots.putalpha(pots.getchannel('A').point(lambda a:255 if a>=128 else 0))
pots=pots.crop(pots.getbbox());pots.thumbnail((22,18),Image.Resampling.NEAREST)
frame=Image.new('RGBA',(24,24));frame.alpha_composite(pots,((24-pots.width)//2,(24-pots.height)//2));frame.save(out/'pots_smashed.png')
hedges=root/'assets/Objects/Hedges';im=Image.open(hedges/'source.png').convert('RGBA')
# Full, clipped foliage occupies half a tile; all arms remain centered.
specs=[('horizontal',(24,12),(0,6),'EW'),('vertical',(12,24),(6,0),'NS'),
 ('top_left',(18,18),(6,6),'ES'),('top_right',(18,18),(0,6),'WS'),
 ('bottom_left',(18,18),(6,0),'NE'),('bottom_right',(18,18),(0,0),'NW'),
 ('t_north',(24,18),(0,0),'NEW'),('t_east',(18,24),(6,0),'NES'),
 ('t_south',(24,18),(0,6),'ESW'),('t_west',(18,24),(0,0),'NSW'),('cross',(24,24),(0,0),'NESW')]
def main_bounds(tile):
 a=tile.getchannel('A');w,h=tile.size;todo={y*w+x for y in range(h) for x in range(w) if a.getpixel((x,y))};best=[]
 while todo:
  seed=todo.pop();part=[seed];queue=[seed]
  while queue:
   i=queue.pop();x,y=i%w,i//w
   for dy in (-1,0,1):
    for dx in (-1,0,1):
     nx,ny=x+dx,y+dy;j=ny*w+nx
     if 0<=nx<w and 0<=ny<h and j in todo:todo.remove(j);queue.append(j);part.append(j)
  if len(part)>len(best):best=part
 return min(i%w for i in best),min(i//w for i in best),max(i%w for i in best)+1,max(i//w for i in best)+1
atlas=Image.new('RGBA',(24*len(specs),24));frames=[]
for n,(name,size,pos,connections) in enumerate(specs):
 x,y=n%4,n//4;tile=im.crop((round(x*im.width/4),round(y*im.height/3),round((x+1)*im.width/4),round((y+1)*im.height/3)))
 tile.putalpha(tile.getchannel('A').point(lambda a:255 if a>=128 else 0));tile=tile.crop(main_bounds(tile)).resize(size,Image.Resampling.NEAREST)
 frame=Image.new('RGBA',(24,24));frame.alpha_composite(tile,pos);atlas.paste(frame,(n*24,0));frame.save(hedges/(name+'.png'))
 frames.append({'frame':n,'name':name,'connections':connections})
atlas.save(hedges/'hedges-24.png');(hedges/'manifest.json').write_text(json.dumps({'frameWidth':24,'frameHeight':24,'frames':frames},indent=2)+'\n')

# A disconnected hedge/end uses the matching compact bush from source slot12.
tile=im.crop((round(3*im.width/4),round(2*im.height/3),im.width,im.height))
tile.putalpha(tile.getchannel('A').point(lambda a:255 if a>=128 else 0));tile=tile.crop(main_bounds(tile));tile.thumbnail((22,22),Image.Resampling.NEAREST)
frame=Image.new('RGBA',(24,24));frame.alpha_composite(tile,((24-tile.width)//2,(24-tile.height)//2));frame.save(hedges/'single.png')
