#!/usr/bin/env python3
"""Export approved dashboard choices at native resolution, without repainting."""
import json
from pathlib import Path
from PIL import Image
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/Objects/SelectedFlora'
CHOICES = {
    'flint': ['ALT-0063'], 'selected_longgrass': ['ALT-0026'],
    'selected_mushroom': ['ALT-0077', 'ALT-0217'],
    'selected_rubble': ['ALT-0209'], 'selected_shrub': ['ALT-0769'],
    'zone_berry_bush': ['ALT-0770', 'ALT-0772'],
}
def main():
    registry = {e['id']: e for e in json.loads((ROOT/'tools/art-alternative-ids.json').read_text())['entries']}
    OUT.mkdir(parents=True, exist_ok=True)
    manifest = {'selections': [], 'preservedFrames': []}
    for key, ids in CHOICES.items():
        frames = []
        for alt in ids:
            source = registry[alt]; x,y,w,h = source['crop']; assert (w,h)==(16,16)
            frames.append(Image.open(ROOT/source['source']).convert('RGBA').crop((x,y,x+w,y+h)))
            manifest['selections'].append({'key': key, 'frame': len(frames)-1, **source})
        if key == 'selected_mushroom':
            original = Image.open(ROOT/'assets/Objects/Approved/props.png').convert('RGBA')
            for frame in [127,128]:
                x,y = (frame%22)*16,(frame//22)*16
                frames.append(original.crop((x,y,x+16,y+16)))
                manifest['preservedFrames'].append({'key':key,'frame':len(frames)-1,'source':'assets/Objects/Approved/props.png','sourceFrame':frame})
        sheet = Image.new('RGBA',(16*len(frames),16))
        for i,frame in enumerate(frames): sheet.paste(frame,(16*i,0))
        sheet.save(OUT/(key+'.png'))
    (OUT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
if __name__ == '__main__': main()
