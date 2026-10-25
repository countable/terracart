"""Pack approved RA container frames; retain untouched atlas cells and baseline art."""
from pathlib import Path
from PIL import Image
import json
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'assets/ArtTrials/RogueProps/containers'
rows=json.loads((OUT/'source/manifest.json').read_text())
keys={'assets/Objects/SelectedProps/clay_pot.png':'clay_pot','extra_assets/inactive/assets/Objects/Approved/chest-tiers.png':'chest','assets/Objects/Wilderness/wood.png':'wood'}
assets={};bounds={}
for source,key in keys.items():
 im=Image.open(ROOT/source).convert('RGBA');fw=fh=16
 for r in rows:
  if r['original']!=source:continue
  patch=Image.open(ROOT/r['source']).convert('RGBA');assert patch.size==(fw,fh)
  x=r['frame']%(im.width//fw)*fw;y=r['frame']//(im.width//fw)*fh
  im.paste(patch,(x,y))
 path=OUT/(key+'.png');im.save(path)
 assets[key]={'kind':'spritesheet','path':str(path.relative_to(ROOT)),'frameWidth':fw,'frameHeight':fh,'width':im.width,'height':im.height}
 for f in range((im.width//fw)*(im.height//fh)):
  x=f%(im.width//fw)*fw;y=f//(im.width//fw)*fh;a=im.crop((x,y,x+fw,y+fh)).getchannel('A');box=a.point(lambda n:255 if n>=16 else 0).getbbox()
  if box:bounds[f'{key}:{f}']=dict(fw=fw,fh=fh,minX=box[0],minY=box[1],maxX=box[2],maxY=box[3])
(OUT/'mapping.json').write_text(json.dumps({'assets':assets,'bounds':bounds},indent=2)+'\n')
print('Exported RA containers: intact cream pot, seven chest tiers, three wood variants; crates and broken pots untouched.')
