#!/usr/bin/env python3
"""Bake purchased mountain boundaries at game scale; no source pack at runtime."""
from pathlib import Path
import hashlib
import json
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'extra_assets/top_down_mountain_edges_ITCH/PNG/SEPARATED_TILES/separate_tiles_all_rotations_slice_grey'
OUT = ROOT / 'assets/terrain'
# Muted RA-compatible warm shadows and olive-grey highlights. Quantized at
# export time to preserve pixel clusters rather than tinting every draw.
RAMP = [(44,43,35), (62,61,49), (80,79,64), (100,99,81), (122,121,100), (145,144,121), (168,167,143)]
QUADS = [(0,0,-1,-1,'top_left','bottom_right'), (1,0,1,-1,'top_right','bottom_left'),
         (0,1,-1,1,'bottom_left','top_right'), (1,1,1,1,'bottom_right','top_left')]
OFFSETS = [(-1,0),(1,0),(0,-1),(0,1),(-1,-1),(1,-1),(-1,1),(1,1)]
images, sources = {}, {}
def source(key):
    if key not in images:
        name = 'separate_tiles_outer_corner_var_02_bottom_leftll_rotations_slice_23' if key == 'outer_corner_var_02_bottom_left' else key
        path = SOURCE / (name + '.png')
        im = Image.open(path).convert('RGBA').resize((32,32), Image.Resampling.LANCZOS)
        pixels = []
        for r,g,b,a in im.getdata():
            lum = .2126*r + .7152*g + .0722*b
            # Source turquoise highlights are around luminance 173.
            tone = max(0,min(len(RAMP)-1,round((lum-35)/24)))
            pixels.append((*RAMP[tone],255 if a >= 128 else 0))
        im.putdata(pixels)
        images[key] = im
        sources[key] = hashlib.sha256(path.read_bytes()).hexdigest()
    return images[key]
def pieces(mask, variant):
    has = lambda dx,dy: bool(mask & (1 << OFFSETS.index((dx,dy))))
    absent = dict(left=not has(-1,0),right=not has(1,0),top=not has(0,-1),bottom=not has(0,1))
    missing = [k for k,v in absent.items() if v]
    concave = [q for q in QUADS if has(q[2],0) and has(0,q[3]) and not has(q[2],q[3])]
    corner = f'{variant%4+1:02}'
    edge = f'{variant%6+1:02}'
    whole = None
    if not missing and not concave: whole = f'fill_var_{edge}'
    elif not missing and len(concave)==1: whole = f'inner_corner_var_{corner}_{concave[0][5]}'
    elif not concave and len(missing)==1: whole = f'{missing[0]}_edge_var_{edge}'
    elif not concave and len(missing)==2:
        q = next((q for q in QUADS if absent['left' if q[2]<0 else 'right'] and absent['top' if q[3]<0 else 'bottom']),None)
        if q: whole = f'outer_corner_var_{corner}_{q[4]}'
    if whole: return [(whole,(0,0,32,32))]
    result=[]
    for x,y,dx,dy,outer,inner in QUADS:
        a,b=has(dx,0),has(0,dy)
        if not a and not b: key=f'outer_corner_var_{corner}_{outer}'
        elif not a or not b:
            side=('left' if dx<0 else 'right') if not a else ('top' if dy<0 else 'bottom')
            key=f'{side}_edge_var_{edge}'
        elif not has(dx,dy): key=f'inner_corner_var_{corner}_{inner}'
        else: key=f'fill_var_{edge}'
        result.append((key,(x*16,y*16,x*16+16,y*16+16)))
    return result

def main():
    OUT.mkdir(parents=True,exist_ok=True)
    atlas=Image.new('RGBA',(1024,1024))
    for variant in range(4):
        for mask in range(256):
            # TerrainTransitions supplies the live neighbouring ground below.
            # Preserve source transparency so narrow edges cannot stamp an
            # unrelated square of soil over that substrate.
            tile=Image.new('RGBA',(32,32))
            for key,box in pieces(mask,variant): tile.alpha_composite(source(key).crop(box),(box[0],box[1]))
            frame=variant*256+mask
            atlas.paste(tile,(frame%32*32,frame//32*32))
    atlas.save(OUT/'mountain-edges.png',optimize=True)
    (OUT/'mountain-edges.json').write_text(json.dumps(dict(source=str(SOURCE.relative_to(ROOT)),frameSize=32,columns=32,frames=1024,variants=4,neighbours=OFFSETS,palette=RAMP,sourceSHA256=sources,notes='Purchased pack; RA olive-grey palette. Transparent source exteriors reveal the runtime ground substrate. No stair or deep-notch edges. Full cells where possible, quarter corners for narrow/complex boundaries.'),indent=2)+'\n')
    print('Exported 1024 mountain edge frames')
if __name__ == '__main__': main()
