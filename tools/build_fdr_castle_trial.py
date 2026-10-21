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

def assemble_castle(source, out, palette, dx):
    """Tile-only reference; every visible pixel comes from the supplied sheet."""
    canvas = Image.new('RGBA', (320,288))
    ox, oy = 160, 164
    def crop(x,y,w,h): return source.crop((x+dx,y,x+dx+w,y+h))
    floor = crop(16,0,16,16)
    def fill(dest, tile, box):
        x,y,w,h=box
        for yy in range(y,y+h,tile.height):
            for xx in range(x,x+w,tile.width):
                dest.alpha_composite(tile.crop((0,0,min(tile.width,x+w-xx),min(tile.height,y+h-yy))), (xx,yy))
    fill(canvas,floor,(ox-100,oy-80,200,160))
    tower=crop(128,28,48,84)
    backing=Image.new('RGBA',tower.size)
    fill(backing,floor,(8,12,32,36))
    backing.alpha_composite(tower)
    tower=backing
    # Extend the centre tiles, preserving corners, native pixels and the base.
    wide=Image.new('RGBA',(80,84))
    for dest,src in [(0,0),(16,16),(32,16),(48,16),(64,32)]:
        wide.alpha_composite(tower.crop((src,0,src+16,84)),(dest,0))
    keep=Image.new('RGBA',(80,116))
    for dest,lo,hi in [(0,0,16),(16,16,32),(32,16,32),(48,32,52),(68,52,68),(84,52,68),(100,68,84)]:
        keep.alpha_composite(wide.crop((0,lo,80,hi)),(0,dest))
    keep.alpha_composite(source.crop((192,256 if dx==0 else 288,240,288 if dx==0 else 320)),(16,84))
    brick=crop(16,64,16,16)
    tooth=crop(128,28,16,16)
    side=crop(128,48,8,16)
    def horizontal(y):
        fill(canvas,brick,(ox-100,oy+y-24,200,24))
        fill(canvas,tooth,(ox-100,oy+y-32,200,16))
    horizontal(-80)
    # Side coping is a native vertical roof edge, with brick foot faces.
    for x in [-100,92]:
        fill(canvas,side,(ox+x,oy-104,8,160))
        fill(canvas,brick,(ox+x,oy+56,8,24))
    for x in [-80,80]: canvas.alpha_composite(tower,(ox+x-24,oy-60-60))
    canvas.alpha_composite(keep,(ox-40,oy+32-116))
    horizontal(80)
    canvas.alpha_composite(source.crop((192,256 if dx==0 else 288,240,288 if dx==0 else 320)),(ox-24,oy+48))
    for x in [-80,80]: canvas.alpha_composite(tower,(ox+x-24,oy+60-60))
    canvas.save(out / f'assembled-{palette}.png')
    canvas.resize((960,864),Image.Resampling.NEAREST).save(out / f'assembled-{palette}-large.png')


def build(out, ref):
    out.mkdir(parents=True, exist_ok=True)
    materials = out / 'materials'
    materials.mkdir(exist_ok=True)
    source = Image.open(SOURCE).convert('RGBA')
    rows = []
    for palette, dx in [('warm', 0), ('cool', 256)]:
        assemble_castle(source, out, palette, dx)
        door_y = 256 if palette == 'warm' else 288
        source.crop((192,door_y,240,door_y+32)).save(materials / f'{palette}-door.png')
        rows.append(dict(id=f'{palette}-door',rect=[192,door_y,48,32],processing='Unchanged native door and frame'))
        for name, rect, size in [('wall', (16+dx,64,16,16), (16,16)),
                                 ('cap', (130+dx,30,12,8), (16,16)),
                                 ('floor', (16+dx,0,16,16), (16,16))]:
            x,y,w,h = rect
            crop = source.crop((x,y,x+w,y+h)).resize(size, Image.Resampling.NEAREST)
            crop.save(materials / f'{palette}-{name}.png')
            rows.append(dict(id=f'{palette}-{name}', rect=rect, size=size,
                             processing='Native outlined capstone, nearest-neighbour normalized' if name=='cap' else 'Unchanged native pixels'))
    for name, rect in [('door',(192,256,48,32)),('window',(0,160,16,16))]:
        x,y,w,h = rect
        source.crop((x,y,x+w,y+h)).save(materials / f'{name}.png')
        rows.append(dict(id=name,rect=rect,size=[w,h],processing='Unchanged source decal; place once, never repeat'))
    (out/'assembly-layout.json').write_text(json.dumps(dict(
        source='FDR_Castle.png', sourcePixelToWorldUnit=1,
        canvas=[320,288], origin=[160,164], perimeter=[200,160],
        tower=dict(centres=[[-80,-60],[80,-60],[-80,60],[80,60]], footprint=[48,48], roofHeight=32, sourceCrop=[128,28,48,84]),
        keep=dict(centre=[0,0],footprint=[80,64],roofHeight=48),
        wall=dict(height=24, crownHeight=8, thickness=8),
        assembly='Native crops, repeated central strips, and alpha compositing only. Keep extends tower centre strips; doors use warm row256/cool row288. No generated imagery.',
        projection='Fixed south-facing source convention; 3D uses the game projection, so baked source shading and exact pixel alignment differ.'
    ),indent=2)+'\n')
    source.save(out / 'source-castle.png')
    reference=Image.new('RGBA',(512,184),'#303a3c')
    reference.alpha_composite(source.crop((0,0,256,176)),(0,8))
    reference.alpha_composite(source.crop((256,0,512,176)),(256,8))
    reference.resize((1024,368),Image.Resampling.NEAREST).save(out / 'source-reference.png')
    board=Image.new('RGBA',(768,240),'#303a3c');draw=ImageDraw.Draw(board)
    for i, row in enumerate([row for row in rows if row['id'].endswith(('-wall','-cap','-floor'))]):
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
