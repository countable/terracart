#!/usr/bin/env python3
"""Extract Fantasy Dreamland castle materials for an isolated retained-3D trial."""
import argparse
import hashlib
import json
import io
import subprocess
import tarfile
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'extra_assets/16x16/Fantasy Dreamland World/Fantasy Dreamland Reborn/Tilesets/FDR_Castle.png'

def build(out, ref):
    out.mkdir(parents=True, exist_ok=True)
    materials = out / 'materials'
    materials.mkdir(exist_ok=True)
    source = Image.open(SOURCE).convert('RGBA')
    rows = []
    for palette, dx in [('warm', 0), ('cool', 256)]:
        for name, rect, size in [('wall', (16+dx,64,16,16), (16,16)),
                                 ('cap', (18+dx,2,12,12), (16,16)),
                                 ('floor', (16+dx,0,16,16), (16,16))]:
            x,y,w,h = rect
            crop = source.crop((x,y,x+w,y+h)).resize(size, Image.Resampling.NEAREST)
            if name == 'cap':
                # Use the source's pale edge pigment on horizontal coping; the
                # darker slab interior would erase the reference's bright crown.
                crop = Image.new('RGBA', size, source.getpixel((17+dx,1)))
            crop.save(materials / f'{palette}-{name}.png')
            rows.append(dict(id=f'{palette}-{name}', rect=rect, size=size,
                             processing=f'Solid horizontal coping in native edge pigment at [{17+dx},1]' if name=='cap' else 'Unchanged native pixels'))
    for name, rect in [('door',(192,256,48,32)),('window',(0,160,16,16))]:
        x,y,w,h = rect
        source.crop((x,y,x+w,y+h)).save(materials / f'{name}.png')
        rows.append(dict(id=name,rect=rect,size=[w,h],processing='Unchanged source decal; place once, never repeat'))
    source.save(out / 'source-castle.png')
    reference=Image.new('RGBA',(512,184),'#303a3c')
    reference.alpha_composite(source.crop((0,0,256,176)),(0,8))
    reference.alpha_composite(source.crop((256,0,512,176)),(256,8))
    reference.resize((1024,368),Image.Resampling.NEAREST).save(out / 'source-reference.png')
    board=Image.new('RGBA',(768,240),'#303a3c');draw=ImageDraw.Draw(board)
    for i, row in enumerate(rows[:6]):
        tile=Image.open(materials / (row['id']+'.png')).resize((32,32),Image.Resampling.NEAREST)
        bx=i*128;draw.text((bx+4,8),row['id'],fill='white')
        for y in range(4):
            for x in range(4):board.alpha_composite(tile,(bx+x*32,40+y*32))
    board.save(out / 'materials-board.png')
    (out/'sources.json').write_text(json.dumps(dict(credit='Fantasy Dreamland Reborn by ElvGames',source=str(SOURCE.relative_to(ROOT)),sha256=hashlib.sha256(SOURCE.read_bytes()).hexdigest(),materials=rows,scope='Opt-in architecture trial only; no runtime replacements'),indent=2)+'\n')
    # Pin the review to committed modules so concurrent development cannot
    # change a saved comparison or expose an in-progress merge to the browser.
    revision=subprocess.check_output(['git','rev-parse',ref],cwd=ROOT,text=True).strip()
    archive=subprocess.check_output(['git','archive',revision,'index.html','src','tools/game-loader.js'],cwd=ROOT)
    runtime=out/'runtime';runtime.mkdir(exist_ok=True)
    with tarfile.open(fileobj=io.BytesIO(archive)) as tar: tar.extractall(runtime,filter='data')
    loader=(runtime/'tools/game-loader.js').read_text().replace("fetch('../index.html'", "fetch('./runtime/index.html'").replace("s.src = '../' + src", "s.src = './runtime/' + src")
    (out/'runtime-loader.js').write_text(loader)
    (out/'runtime-revision.txt').write_text(revision+'\n')
    page=ROOT/'tools/fdr-castle-preview.html';script=ROOT/'tools/fdr-castle-preview.js'
    if page.exists():
        text=page.read_text().replace('src="game-loader.js"','src="runtime-loader.js"').replace('src="fdr-castle-preview.js"','src="preview.js"')
        (out/'index.html').write_text(text)
    if script.exists(): (out/'preview.js').write_text(script.read_text())

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out',type=Path,default=Path('/tmp/fdr-castle-trial'))
    parser.add_argument('--ref',default='HEAD',help='Committed renderer revision to snapshot')
    args=parser.parse_args()
    build(args.out,args.ref)
