#!/usr/bin/env python3
"""Export approved ALT crops without resampling; retain unselected mechanism states."""
import json
from pathlib import Path
from PIL import Image
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/Objects/SelectedProps'
GROUPS = {
 'barrel': [6,112,124,213,150,138,172,177,132],
 'box': [134,450,527,151], 'clay_pot': [24,258], 'crystal_cluster': [64],
 'gas_mushroom_small': [78,79], 'signpost': [175], 'torch': [126],
 'selected_grave_pillar': [22],
}
entries = {e['id']:e for e in json.loads((ROOT/'tools/art-alternative-ids.json').read_text())['entries']}
def crop(n):
 e=entries[f'ALT-{n:04}']; x,y,w,h=e['crop']
 return Image.open(ROOT/e['source']).convert('RGBA').crop((x,y,x+w,y+h))
def main():
 OUT.mkdir(parents=True,exist_ok=True)
 assets={}; bounds={}; manifest={}
 for key, ids in GROUPS.items():
  cells=[crop(n) for n in ids]; w=max(c.width for c in cells); h=max(c.height for c in cells)
  sheet=Image.new('RGBA',(w*len(cells),h))
  for i,c in enumerate(cells): sheet.paste(c,(i*w,0))
  sheet.save(OUT/(key+'.png'))
  assets[key]={'kind':'spritesheet','path':f'assets/Objects/SelectedProps/{key}.png','frameWidth':w,'frameHeight':h}
  manifest[key]=[{'frame':i,**entries[f'ALT-{n:04}']} for i,n in enumerate(ids)]
  for i,c in enumerate(cells):
   x,y,x2,y2=c.getbbox();bounds[f'{key}:{i}']={'fw':w,'fh':h,'minX':x,'minY':y,'maxX':x2,'maxY':y2}
 # Keep all existing frame numbers for other puzzle mechanisms. Native16 crops
 # are centered in their established24 cells; extra pairs add the second looks.
 old=Image.open(ROOT/'assets/Objects/Cave/mechanisms.png').convert('RGBA')
 sheet=Image.new('RGBA',(96,120));sheet.paste(old,(0,0))
 replacements={0:29,1:29,2:30,3:30,5:30,6:30,14:31,15:31,16:32,17:32,18:398,19:398}
 manifest['cave_mechanisms']=[]
 for f,n in replacements.items():
  x,y=f%4*24,f//4*24;sheet.paste((0,0,0,0),(x,y,x+24,y+24));sheet.paste(crop(n),(x+4,y+4))
  manifest['cave_mechanisms'].append({'frame':f,**entries[f'ALT-{n:04}']})
 sheet.save(OUT/'cave_mechanisms.png')
 assets['cave_mechanisms']={'kind':'spritesheet','path':'assets/Objects/SelectedProps/cave_mechanisms.png','frameWidth':24,'frameHeight':24}
 (OUT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
 Path('/tmp/selected-props-integration.json').write_text(json.dumps({'assets':assets,'bounds':bounds,'mechanismFrames':{'switch':[0,1,18,19],'plate_main':[2,3,16,17]}},indent=2)+'\n')
if __name__=='__main__':main()
