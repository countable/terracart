#!/usr/bin/env python3
"""Pack approved zone objects, used pots and connected hedge art."""
from pathlib import Path
import json
from PIL import Image
from connected_art import pack_connected
root=Path(__file__).resolve().parents[1]
out=root/'assets/Objects/ZoneVariants'
source=Image.open(out/'objects-24.png').convert('RGBA')
selection=json.loads((out/'selection.json').read_text())
approved=Image.new('RGBA',source.size)
for frame in selection['selectedFrames']:
 x,y=frame%8*24,frame//8*24
 tile=source.crop((x,y,x+24,y+24));approved.paste(tile,(x,y))
 name=json.loads((out/'manifest.json').read_text())['frames'][frame]['name']
 tile.save(out/(name+'.png'))
approved.save(out/'approved-24.png')
pots=Image.open(out/'pots-smashed-source.png').convert('RGBA')
pots.putalpha(pots.getchannel('A').point(lambda a:255 if a>=128 else 0))
pots=pots.crop(pots.getbbox());pots.thumbnail((22,18),Image.Resampling.NEAREST)
frame=Image.new('RGBA',(24,24));frame.alpha_composite(pots,((24-pots.width)//2,(24-pots.height)//2));frame.save(out/'pots_smashed.png')
hedges=root/'assets/Objects/Hedges';im=Image.open(hedges/'source.png').convert('RGBA')
# Keep the rounded canopy and its shaded front face at the 45-degree camera
# angle. Horizontal runs need more height than the ground footprint; cardinal
# arms still meet at the same centered tile edges.
specs=[('horizontal','EW'),('vertical','NS'),('top_left','ES'),('top_right','WS'),
 ('bottom_left','NE'),('bottom_right','NW'),('t_north','NEW'),('t_east','NES'),
 ('t_south','ESW'),('t_west','NSW'),('cross','NESW')]
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
for n,(name,connections) in enumerate(specs):
 x,y=n%4,n//4;tile=im.crop((round(x*im.width/4),round(y*im.height/3),round((x+1)*im.width/4),round((y+1)*im.height/3)))
 tile.putalpha(tile.getchannel('A').point(lambda a:255 if a>=128 else 0));tile=tile.crop(main_bounds(tile))
 # Connected ends continue into a neighbour rather than terminating in the
 # rounded source cap. Trim only those ends before fitting common arm bands.
 dx,dy=round(tile.width*.12),round(tile.height*.12)
 tile=tile.crop((dx if 'W' in connections else 0,dy if 'N' in connections else 0,tile.width-dx if 'E' in connections else tile.width,tile.height-dy if 'S' in connections else tile.height))
 frame=pack_connected(tile,connections,(6,18),(4,20));atlas.paste(frame,(n*24,0));frame.save(hedges/(name+'.png'))
 frames.append({'frame':n,'name':name,'connections':connections})
atlas.save(hedges/'hedges-24.png');(hedges/'manifest.json').write_text(json.dumps({'frameWidth':24,'frameHeight':24,'frames':frames},indent=2)+'\n')

# A disconnected hedge/end uses the matching compact bush from source slot12.
tile=im.crop((round(3*im.width/4),round(2*im.height/3),im.width,im.height))
tile.putalpha(tile.getchannel('A').point(lambda a:255 if a>=128 else 0));tile=tile.crop(main_bounds(tile));tile.thumbnail((22,22),Image.Resampling.NEAREST)
frame=Image.new('RGBA',(24,24));frame.alpha_composite(tile,((24-tile.width)//2,(24-tile.height)//2));frame.save(hedges/'single.png')
