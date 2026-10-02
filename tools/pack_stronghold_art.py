#!/usr/bin/env python3
"""Pack 45-degree elevated wall art into connected 24px square map frames."""
import json
from pathlib import Path
from PIL import Image
from connected_art import pack_connected
root=Path(__file__).resolve().parents[1]
out=root/'assets/Objects/Stronghold'
im=Image.open(out/'source.png').convert('RGBA')
# The footprint stays on the cardinal grid. The horizontal band's ten pixels
# preserve both the raised cap and its shaded front face; compressing it to
# the old six-pixel overhead footprint erased the camera elevation.
# Every E/W arm meets at y=6..15; every N/S arm meets at x=9..14.
specs=[('horizontal','EW'),('vertical','NS'),('top_left','ES'),('top_right','WS'),
       ('bottom_left','NE'),('bottom_right','NW'),('t_north','NEW'),
       ('t_east','NES'),('t_south','ESW'),('t_west','NSW'),('cross','NESW')]
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
for n,(name,connections) in enumerate(specs):
 x,y=n%4,n//4
 tile=im.crop((round(x*im.width/4),round(y*im.height/3),round((x+1)*im.width/4),round((y+1)*im.height/3)))
 tile.putalpha(tile.getchannel('A').point(lambda a:255 if a>=128 else 0))
 tile=tile.crop(main_sprite_bounds(tile))
 # Connection edges continue into a neighbour: crop their generated end caps
 # before packing, so round/chipped tips do not leave a gap at every tile.
 dx,dy=round(tile.width*0.10),round(tile.height*0.10)
 tile=tile.crop((dx if 'W' in connections else 0,dy if 'N' in connections else 0,
                 tile.width-(dx if 'E' in connections else 0),
                 tile.height-(dy if 'S' in connections else 0)))
 frame=pack_connected(tile,connections,(9,15),(6,16))
 frame.save(out/(name+'.png'));atlas.paste(frame,(n*24,0))
 frames.append(dict(frame=n,name=name,connections=connections))
atlas.save(out/'walls-24.png')
(out/'manifest.json').write_text(json.dumps(dict(frameWidth=24,frameHeight=24,displayScale=4/3,frames=frames),indent=2)+'\n')
