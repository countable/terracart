#!/usr/bin/env python3
"""Pack generated orthogonal wall pieces into 24px square map frames."""
import json
from pathlib import Path
from PIL import Image
root=Path(__file__).resolve().parents[1]
out=root/'assets/Objects/Stronghold'
im=Image.open(out/'source.png').convert('RGBA')
# Center the six-pixel wall band on cell midpoint. Corner bends have two
# half-cell arms, so their bounding boxes occupy only one quadrant plus band.
specs=[('horizontal',(24,6),(0,9),'EW'),('vertical',(6,24),(9,0),'NS'),
       ('top_left',(15,15),(9,9),'ES'),('top_right',(15,15),(0,9),'WS'),
       ('bottom_left',(15,15),(9,0),'NE'),('bottom_right',(15,15),(0,0),'NW')]
base=im
junctions=Image.open(out/'junction-source.png').convert('RGBA')
specs += [('t_north',(24,15),(0,0),'NEW'),('t_east',(15,24),(9,0),'NES'),
          ('t_south',(24,15),(0,9),'ESW'),('t_west',(15,24),(0,0),'NSW'),
          ('cross',(24,24),(0,0),'NESW')]
def main_sprite_bounds(tile):
 # Generated art can cross a nominal source cell boundary. Use the largest
 # connected opaque component to exclude a neighboring object's stray sliver.
 alpha=tile.getchannel('A');width,height=tile.size
 opaque={y*width+x for y in range(height) for x in range(width) if alpha.getpixel((x,y))}
 largest=[]
 while opaque:
  seed=opaque.pop();component=[seed];queue=[seed]
  while queue:
   i=queue.pop();x,y=i%width,i//width
   for dy in (-1,0,1):
    for dx in (-1,0,1):
     nx,ny=x+dx,y+dy;j=ny*width+nx
     if 0<=nx<width and 0<=ny<height and j in opaque:
      opaque.remove(j);queue.append(j);component.append(j)
  if len(component)>len(largest):largest=component
 return (min(i%width for i in largest),min(i//width for i in largest),
         max(i%width for i in largest)+1,max(i//width for i in largest)+1)

atlas=Image.new('RGBA',(24*len(specs),24));frames=[]
for n,(name,size,pos,connections) in enumerate(specs):
 im=base if n<6 else junctions
 source_frame=n if n<6 else [2,1,0,3,4][n-6]
 x,y=source_frame%3,source_frame//3
 tile=im.crop((round(x*im.width/3),round(y*im.height/2),round((x+1)*im.width/3),round((y+1)*im.height/2)))
 tile.putalpha(tile.getchannel('A').point(lambda a:255 if a>=128 else 0))
 tile=tile.crop(main_sprite_bounds(tile)).resize(size,Image.Resampling.NEAREST)
 frame=Image.new('RGBA',(24,24));frame.alpha_composite(tile,pos)
 frame.save(out/(name+'.png'));atlas.paste(frame,(n*24,0))
 frames.append(dict(frame=n,name=name,connections=connections))
atlas.save(out/'walls-24.png')
(out/'manifest.json').write_text(json.dumps(dict(frameWidth=24,frameHeight=24,displayScale=4/3,frames=frames),indent=2)+'\n')
