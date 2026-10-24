#!/usr/bin/env python3
"""Match visible reference ground to installed source tiles, never reuse screenshot pixels.

GIF quantization shifts source palette channels by up to a few levels. Matching
ignores non-ground colors (houses/actors), then selects a native crop per 16px
source cell at the measured (8,2) phase. Occluded ground remains an inference.
The reference is evidence only: exported data contains source paths/rectangles.
"""
from PIL import Image
import numpy as np,json
from pathlib import Path
import argparse
parser=argparse.ArgumentParser(description='Recover source-native ground tile placements at the reference grid phase; preserve separate object inventory.')
parser.add_argument('--reference',type=Path,required=True)
parser.add_argument('--layout',type=Path,default=Path(__file__).with_name('reference-layout.json'))
parser.add_argument('--preview',type=Path,default=Path('/tmp/dreamland-ground-reconstruction.png'))
args=parser.parse_args()
root=Path(__file__).resolve().parents[2];ref=np.array(Image.open(args.reference).convert('RGB'))[::2,::2];base=[155,178,62]
paths=['extra_assets/16x16/Fantasy Dreamland World/Fantasy Dreamland Reborn/Tilesets/'+n for n in ['FDR_Ground_Tiles.png','FDR_Village.png']]
candidates=[]
for path in paths:
 sheet=np.array(Image.open(root/path).convert('RGBA'))
 for y in range(0,192 if 'Ground' in path else 48,16):
  for x in range(0,192 if 'Ground' in path else 256,16):
   if 'Ground' in path and 48<=y<128:continue
   if 'Village' in path and y==0 and x<160:continue
   for bg in ([base,[178,135,89]] if 'Village' in path else [base]):
    a=sheet[y:y+16,x:x+16].copy();a[a[:,:,3]==0]=[*bg,255]
    candidates.append((path,x,y,a[:,:,:3],bg))
tiles=np.array([c[3] for c in candidates],dtype='int16');colors=set(tuple(x) for x in tiles.reshape(-1,3));palette=np.array(list(colors),dtype='int16');mask=np.zeros(ref.shape[:2],dtype=bool)
for color in palette:mask |= np.abs(ref.astype('int16')-color).sum(axis=2)<12
board=Image.new('RGB',(640,360),tuple(base));records=[]
for yy in range(-14,180,16):
 for xx in range(-8,320,16):
  x0=max(0,xx);y0=max(0,yy);x1=min(320,xx+16);y1=min(180,yy+16);q=ref[y0:y1,x0:x1].astype('int16');m=mask[y0:y1,x0:x1];t=tiles[:,y0-yy:y1-yy,x0-xx:x1-xx]
  score=(np.abs(t-q).sum(axis=3)*m).sum(axis=(1,2))/max(1,m.sum())
  best=int(np.argmin(score));path,x,y,a,bg=candidates[best]
  if m.sum()<24:continue
  records.append(dict(source=path,rect=[x,y,16,16],at=[xx*2,yy*2],background=bg,error=round(float(score[best]),2)))
  board.paste(Image.fromarray(a.astype('uint8')).resize((32,32),Image.Resampling.NEAREST),(xx*2,yy*2))
board.save(args.preview)
layout=json.loads(args.layout.read_text());layout['ground']=records;args.layout.write_text(json.dumps(layout,indent=2)+'\n')
