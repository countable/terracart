#!/usr/bin/env python3
"""Build straight PP facade derivatives and optionally clean a generated master.

Raw licensed sheets and generated masters stay outside the shipping tree.
The packed sheet is written ONLY by build_approved_materials.py.
"""
from pathlib import Path
import argparse
import json
from PIL import Image, ImageColor, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'extra_assets/inactive/assets/Objects/BuildingMaterials/source/b4d-pp'
PACK = ROOT / 'extra_assets/Pixel Plains/PP Interiors Pack'
INK = '#32131e'
# Original-pixel [x,y,w,h]. Wall trims are excluded so motifs can repeat.
CROPS = {
    'whitePlaster': ('Exterior set.png', [379,83,23,24], [24,24]),
    'orangeBrick': ('Exterior set.png', [268,83,22,24], [24,24]),
    'boards': ('Exterior set.png', [491,84,22,24], [24,24]),
    'smithStone': ('Shop set.png', [128,80,32,32], [24,24]),
    'houseDoor': ('Exterior set.png', [291,84,26,28], [19,24]),
    'shopDoor': ('Exterior set.png', [705,165,30,27], [20,24]),
    'smithDoor': ('Exterior set.png', [291,84,26,28], [23,24]),
    'timberWindow': ('Exterior set.png', [176,136,16,16], [14,14]),
    'brassWindow': ('Exterior set.png', [176,136,16,16], [16,16]),
    'shopWindow': ('Exterior set.png', [695,133,82,23], [74,15]),
}
WALLS = ['whitePlaster','orangeBrick','boards','smithStone']
# Observed bounds in the generated 1024px master; omit its wall borders.
GENERATED = {
    'whitePlaster': [52,40,192,197], 'orangeBrick': [52,286,192,195],
    'boards': [52,533,192,196], 'smithStone': [52,777,192,197],
    'houseDoor': [351,33,196,211], 'shopDoor': [351,279,196,211],
    'smithDoor': [351,770,196,212],
    'timberWindow': [665,33,137,158], 'brassWindow': [665,279,137,158],
    'shopWindow': [665,279,137,158],
}
WOOD = ['#493529','#735039','#a47851']
GLASS = ['#375b67','#648b8b','#c7d4ba']
STONE = ['#515655','#6a6c63','#858575']
PALETTES = {
    'whitePlaster': ['#cfcdc3','#eeeee4','#faf6e9'],
    'orangeBrick': ['#be7957','#d9a075','#efbb85'],
    'boards': WOOD, 'smithStone': STONE,
    'houseDoor': [INK]+WOOD,
    'shopDoor': [INK]+WOOD,
    'smithDoor': [INK,'#393e40']+STONE+WOOD,
    'timberWindow': [INK]+WOOD+GLASS,
    'brassWindow': [INK]+WOOD+GLASS,
    'shopWindow': [INK]+WOOD+GLASS,
}

def crop(sheet, rect):
    x,y,w,h=rect
    return sheet.crop((x,y,x+w,y+h))

def wall(im, name):
    # One texel at the repeat edge matches the opposite edge. No palette remap.
    for y in range(24): im.putpixel((23,y),im.getpixel((0,y)))
    if name != 'boards':
        for x in range(24): im.putpixel((x,23),im.getpixel((x,0)))
    tiled=Image.new('RGBA',(96,96))
    for y in range(0,96,24):
        for x in range(0,96,24): tiled.paste(im,(x,y))
    return tiled

def clean_generated(im, name, size):
    # Reduce broad generated clusters without carrying gradients/AA into texels.
    im=im.convert('RGB').resize(tuple(size),Image.Resampling.BOX)
    palette=Image.new('P',(1,1))
    rgb=[ImageColor.getrgb(c) for c in PALETTES[name]]
    palette.putpalette([v for c in rgb for v in c]+list(rgb[-1])*(256-len(rgb)))
    im=im.quantize(palette=palette,dither=Image.Dither.NONE).convert('RGBA')
    if name not in WALLS:
        # Hand cleanup: one shared ink contour, continuous frame and mullions.
        d=ImageDraw.Draw(im); w,h=im.size
        d.rectangle((0,0,w-1,h-1),outline=INK)
        if 'Window' in name:
            # Broad shop display has two uninterrupted panes, no crossbar.
            d.line((w//2,2,w//2,h-3),fill=INK)
            if name != 'shopWindow': d.line((2,h//2,w-3,h//2),fill=INK)
        else:
            d.line((w//2,4,w//2,h-2),fill=INK)
            d.rectangle((w-7,h-9,w-5,h-7),outline=INK)
    return im

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--generated-master',type=Path)
    ap.add_argument('--generated-openings',type=Path)
    args=ap.parse_args();OUT.mkdir(parents=True,exist_ok=True)
    previous=OUT/'provenance.json'
    provenance=json.loads(previous.read_text()) if previous.exists() else {}
    provenance.update(credit='Pixel Plains Interiors Pack by Jose Javier (SnowHex)',
        straightProcessing='Nearest-neighbour only; original colours. Single CEL.ink outline substitution on openings; repeat-edge seam repair on walls.',
        generatedProcessing='Reference-conditioned generation; observed crops reduced with BOX, exact family palette, no dither; hand-clean single ink frames/mullions/handles. Binary alpha.',
        crops={})
    for name,(file,rect,size) in CROPS.items():
        im=crop(Image.open(PACK/file).convert('RGBA'),rect).resize(tuple(size),Image.Resampling.NEAREST)
        if name not in WALLS:
            # Only darkest existing outline tones change; all fills stay PP.
            ink=ImageColor.getrgb(INK)+(255,)
            im.putdata([ink if c[3] and max(c[:3])<115 and sum(c[:3])<230 else c for c in im.getdata()])
        if name in WALLS: im=wall(im,name)
        im.save(OUT/('A'+name+'.png'),optimize=True)
        provenance['crops'][name]={'source':'extra_assets/Pixel Plains/PP Interiors Pack/'+file,'crop':rect,'texelSize':size,'outputSize':list(im.size)}
    if args.generated_master:
        source=Image.open(args.generated_master)
        for name,rect in GENERATED.items():
            im=clean_generated(crop(source,rect),name,CROPS[name][2])
            if name in WALLS: im=wall(im,name)
            im.save(OUT/('B'+name+'.png'),optimize=True)
        provenance['generated']={'master':args.generated_master.name,'size':list(source.size),'crops':GENERATED,'palettes':PALETTES,'generationCount':1,'quality':'medium','tool':'/home/claude/bin/genimg','model':'gpt-image-2'}
    if args.generated_openings:
        source=Image.open(args.generated_openings)
        refined={'shopWindow':[64,64,618,152], 'shopDoor':[320,368,192,256],
                 'smithDoor':[64,680,256,280], 'timberWindow':[656,368,168,176],
                 'brassWindow':[656,368,168,176]}
        for name,rect in refined.items():
            im=clean_generated(crop(source,rect),name,CROPS[name][2])
            im.save(OUT/('B'+name+'.png'),optimize=True)
        provenance['generated']['crops'].update(refined)
        provenance['generated']['masterByPart']={name:(args.generated_openings.name if name in refined else provenance['generated']['master']) for name in CROPS}
        provenance['generated']['generationCount']=2
        provenance['generated']['palettes']=PALETTES
    previous.write_text(json.dumps(provenance,indent=2)+'\n')
    print('PP A derivatives built; B '+('cleaned from generated master' if args.generated_master else 'retained from processed inputs'))

if __name__=='__main__': main()
