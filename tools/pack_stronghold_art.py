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
atlas=Image.new('RGBA',(144,24));frames=[]
for n,(name,size,pos,connections) in enumerate(specs):
 x,y=n%3,n//3
 tile=im.crop((round(x*im.width/3),round(y*im.height/2),round((x+1)*im.width/3),round((y+1)*im.height/2)))
 tile.putalpha(tile.getchannel('A').point(lambda a:255 if a>=128 else 0))
 tile=tile.crop(tile.getbbox()).resize(size,Image.Resampling.NEAREST)
 frame=Image.new('RGBA',(24,24));frame.alpha_composite(tile,pos)
 frame.save(out/(name+'.png'));atlas.paste(frame,(n*24,0))
 frames.append(dict(frame=n,name=name,connections=connections))
atlas.save(out/'walls-24.png')
(out/'manifest.json').write_text(json.dumps(dict(frameWidth=24,frameHeight=24,displayScale=4/3,frames=frames),indent=2)+'\n')
