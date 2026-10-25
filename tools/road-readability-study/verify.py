#!/usr/bin/env python3
"""Compare actual game-renderer captures inside the wider road's interior."""
import json, os, sys
from PIL import Image, ImageChops
root = sys.argv[1] if len(sys.argv)>1 else '/home/claude/.artifacts/road-readability-implementation'
cells = int(os.environ.get('CELLS','11'))
reference=Image.open(f'{root}/after-wide-reference-base-{cells}.png').convert('RGBA')
size=reference.width
# The authored horizontal road is at the center of the central cell (+16px),
# width 9m = ~41 pixels. The texture includes the shipping 64px padding.
# Stay inside its opaque geometric band and away from edge lamps.
center=size//2+16
box=(center-65,center-15,center+65,center+15)
checks=[]
for name in ['crossing','restored-crossing']:
 image=Image.open(f'{root}/after-{name}-base-{cells}.png').convert('RGBA')
 diff=ImageChops.difference(reference.crop(box),image.crop(box))
 unequal=sum(1 for p in diff.getdata() if p!=(0,0,0,0))
 checks.append({'case':name,'region':box,'differentPixels':unequal,'pixels':130*30,'pass':unequal==0})
restored=Image.open(f'{root}/after-restored-crossing-restored-{cells}.png').convert('RGBA')
alpha=restored.crop(box).getchannel('A')
nonzero=sum(1 for p in alpha.getdata() if p)
checks.append({'case':'restored-layer-hidden-under-wide','differentPixels':nonzero,'pixels':130*30,'pass':nonzero==0})
seam=Image.open(f'{root}/after-seam-{cells}.png').convert('RGBA')
plain=Image.open(f'{root}/after-seam-off-{cells}.png').convert('RGBA')
diff=ImageChops.difference(seam,plain)
changed=sum(1 for p in diff.getdata() if p!=(0,0,0,0))
checks.append({'case':'seam-visible','differentPixels':changed,'pass':changed>0})
json.dump(checks,open(f'{root}/pixel-checks-{cells}.json','w'),indent=2)
print(json.dumps(checks,indent=2))
if not all(c['pass'] for c in checks):sys.exit(1)
