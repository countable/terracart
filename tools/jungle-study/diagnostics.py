#!/usr/bin/env python3
"""Render source-native dual-grid diagnostics. Requires Pillow and Node."""
from PIL import Image,ImageDraw
import json
from pathlib import Path
import subprocess,sys
repo=Path(__file__).resolve().parents[2]
out=Path(sys.argv[1]) if len(sys.argv)>1 else Path('/tmp/ra-jungle')
out.mkdir(parents=True,exist_ok=True)
root=repo/'extra_assets/16x16/Rogue Adventure World/Rogue Adventure World [Sprites]/Tilesets'
script=r"""
const A=require('./tools/jungle-autotile.js');
const options={olive:{x:80,y:528,inner:{nw:[144,544],ne:[128,544],sw:[144,528],se:[128,528]}},water:{x:0,y:64,inner:{nw:[32,48],ne:[0,48],sw:[32,16],se:[0,16]}}};
const specs=Object.fromEntries(Object.entries(options).map(([id,o])=>[id,Array.from({length:16},(_,mask)=>({mask,tiles:A.dualTiles(mask,o)}))]));
const rows=['...............','..###....#.....','..#.#...###....','..###....#.....','.........#.....','..#.#...###....','...#.....#.....','..#.#..........','...............'];
const layout=[];for(let y=0;y<rows.length-1;y++)for(let x=0;x<rows[0].length-1;x++)layout.push({x,y,mask:A.dualMaskAt(x,y,(x,y)=>rows[y]?.[x]==='#')});
console.log(JSON.stringify({specs,layout}));
"""
data=json.loads(subprocess.check_output(['node','-e',script],cwd=repo,text=True))
specs=data['specs']
board=Image.new('RGB',(672,510),'#212329');d=ImageDraw.Draw(board)
for group,(name,records) in enumerate(specs.items()):
 source=Image.open(root/('RA_Jungle.png' if name=='olive' else 'RA_Animated_Water.png')).convert('RGBA');d.text((15,10+group*250),name+' - full authored tiles / 16 dual-grid masks',fill='white')
 for record in records:
  tile=Image.new('RGBA',(16,16),(84,114,34,255))
  for q in record['tiles']:
   crop=source.crop((q['sx'],q['sy'],q['sx']+16,q['sy']+16));tile.alpha_composite(crop)
  x=15+(record['mask']%8)*82;y=40+group*250+(record['mask']//8)*100
  board.paste(tile.resize((64,64),Image.Resampling.NEAREST),(x,y));d.text((x,y+66),str(record['mask']),fill='white')
board.save(out/'dual-diagnostic.png')
layout=data['layout']
board=Image.new('RGB',(940,560),'#212329');d=ImageDraw.Draw(board)
for group,(name,records) in enumerate(specs.items()):
 source=Image.open(root/('RA_Jungle.png' if name=='olive' else 'RA_Animated_Water.png')).convert('RGBA');d.text((group*470+10,10),name+' - islands, hole, channel, diagonal contacts',fill='white')
 for loc in layout:
  tile=Image.new('RGBA',(16,16),(84,114,34,255))
  for q in records[loc['mask']]['tiles']:tile.alpha_composite(source.crop((q['sx'],q['sy'],q['sx']+16,q['sy']+16)))
  board.paste(tile.resize((32,32),Image.Resampling.NEAREST),(group*470+10+loc['x']*32,40+loc['y']*32))
board.crop((0,0,940,310)).save(out/'dual-layout.png')
