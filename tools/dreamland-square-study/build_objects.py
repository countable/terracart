#!/usr/bin/env python3
"""Export native Dreamland village objects, with reproducible layer provenance.

Only source pixels are used. Transparent padding is trimmed for runtime seating;
all crop/assembly coordinates and the resulting offsets are recorded in manifest.
"""
from pathlib import Path
import argparse
import hashlib
import json
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
SOURCE = Path('extra_assets/16x16/Fantasy Dreamland World/Fantasy Dreamland Reborn/Tilesets')
VILLAGE = 'FDR_Village.png'
GRASSLANDS = 'FDR_Grasslands.png'
GROUND = 'FDR_Ground_Tiles.png'
REFERENCE = 'https://img.itch.zone/aW1hZ2UvMTU2NjQ2OC8xMTkyNzE0Ny5naWY=/original/dve1%2FL.gif'


def build(out, contact):
    out.mkdir(parents=True, exist_ok=True)
    sheets = {name: Image.open(ROOT / SOURCE / name).convert('RGBA') for name in (VILLAGE, GRASSLANDS, GROUND)}
    records = []
    images = []

    def export(name, size, layers, role, exclusions=()):
        image = Image.new('RGBA', size)
        provenance = []
        for sheet, rect, dest in layers:
            x, y, width, height = rect
            assert 0 <= x and 0 <= y and x + width <= sheets[sheet].width and y + height <= sheets[sheet].height
            image.alpha_composite(sheets[sheet].crop((x, y, x + width, y + height)), dest)
            provenance.append(dict(source=str(SOURCE / sheet), rect=list(rect), at=list(dest)))
        for rect in exclusions:
            image.paste((0, 0, 0, 0), rect)
        bounds = image.getbbox()
        assert bounds, name
        trimmed = image.crop(bounds)
        trimmed.save(out / (name + '.png'))
        records.append(dict(id=name, file=name + '.png', size=list(trimmed.size),
                            assemblySize=list(size), trimBounds=list(bounds), origin=[0.5, 1],
                            role=role, layers=provenance, excludedRects=list(exclusions)))
        images.append((name, trimmed))

    # The isolated long-gable house has an unrelated chimney fragment in its
    # upper-left blank corner. Exclude only that corner, outside the roof silhouette.
    house_layers = [(VILLAGE, (432,144,64,112), (0,0)),
                    (VILLAGE, (416,0,16,32), (24,48)),
                    (VILLAGE, (0,160,16,32), (24,80)),
                    (VILLAGE, (288,0,16,32), (8,76))]
    export('house', (64,112), house_layers, 'Reference red-roof house; existing ordinary building only.', [(0,0,16,16)])
    export('house-wide', (160,112), [
        (VILLAGE,(256,144,160,112),(0,0)),
        (VILLAGE,(416,0,16,32),(72,48)),
        (VILLAGE,(0,160,16,32),(72,80)),
        (VILLAGE,(288,0,16,32),(56,76)),
        (VILLAGE,(416,0,16,32),(16,64)),
        (VILLAGE,(416,0,16,32),(128,64)),
    ], 'Wide existing building footprint; native red roof and wall assembly.', [(128,0,160,16)])
    simple = [
        ('tree',GRASSLANDS,(96,256,32,48),'Reference mature round tree; preserve tree identity and growth state.'),
        ('tree-young',GRASSLANDS,(96,336,32,32),'Smaller native round tree.'),
        
        ('lamp',VILLAGE,(192,416,32,32),'Lit hanging lantern on wooden post; existing lamp only.'),
        ('lamp-unlit',VILLAGE,(192,384,32,32),'Unlit purple lantern; existing lamp only.'),
        ('fountain',VILLAGE,(144,416,48,48),'Reference octagonal fountain, native water and sculpture.'),
        ('crate',VILLAGE,(128,96,16,16),'Existing crate; native closed wooden crate.'),
        ('crate-stack',VILLAGE,(96,128,32,32),'Existing crate group; native stacked closed crates.'),
        ('sign',VILLAGE,(64,144,16,16),'Existing sign; native freestanding wooden board.'),
        ('well',VILLAGE,(192,80,32,48),'Existing well; native roofed water well.'),
        ('ground-base',VILLAGE,(16,0,16,16),'Exact reference olive base RGB155,178,62.'),
        ('ground-patch',GROUND,(0,0,48,48),'Native olive island with subtle lime boundary; place over same olive base.'),
        ('ground-patch-small',GROUND,(96,0,48,48),'Native smaller olive island with subtle lime boundary.'),
        ('ground-specks-a',GRASSLANDS,(0,16,16,16),'Tiny flat grass coloration, no flowers or tall grass.'),
        ('ground-specks-b',GRASSLANDS,(16,16,16,16),'Tiny flat grass coloration, no flowers or tall grass.'),
        ('ground-specks-c',GRASSLANDS,(32,16,16,16),'Tiny flat grass coloration, no flowers or tall grass.'),
    ]
    for name, sheet, rect, role in simple:
        export(name,(rect[2],rect[3]),[(sheet,rect,(0,0))],role)
    manifest = dict(reference=REFERENCE, method='Source-native crops and layered assemblies; no generated/recolored pixels.',
                    objects=records, sha256={str(SOURCE/name):hashlib.sha256((ROOT/SOURCE/name).read_bytes()).hexdigest() for name in sheets},
                    exclusions=['No fences, benches, cliffs, large grass clumps or new interactable spawns.',
                                'No barrel override: reference and village source provide no matching barrel.'])
    (out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    # Two complementary backgrounds expose accidental detached crop fragments.
    cell_w, cell_h = 350, 280
    board = Image.new('RGB',(cell_w*4,cell_h*((len(images)+3)//4)),(44,48,52)); draw = ImageDraw.Draw(board)
    for index,(name,im) in enumerate(images):
        x=(index%4)*cell_w;y=(index//4)*cell_h
        draw.rectangle((x,y+22,x+cell_w-1,y+cell_h-1),fill=(157,176,69))
        scale=min(3,(cell_w-16)//im.width,(cell_h-35)//im.height)
        big=im.resize((im.width*scale,im.height*scale),Image.Resampling.NEAREST)
        board.paste(big,(x+(cell_w-big.width)//2,y+28),big)
        draw.text((x+8,y+5),f'{name}: {im.width} x {im.height}',fill='white')
    board.save(contact)
    print(json.dumps({r['id']:r['size'] for r in records},indent=2))
    print('Contact sheet:', contact)


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out',type=Path,default=ROOT/'assets/ArtTrials/DreamlandObjects')
    parser.add_argument('--contact',type=Path,default=Path('/tmp/dreamland-objects-contact.png'))
    args=parser.parse_args()
    build(args.out,args.contact)
