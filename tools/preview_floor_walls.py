"""Per-level solid cave wall variants in the game's wall geometry (textures.js makeCaveWallEdges):
cap with inward light falloff, a 3px lip on exposed edges, a south face on cells open to the south,
recessed side shading. Materials come from each level's art. Render test: a 10x10 map per level."""
import math, json, argparse, subprocess, sys
from pathlib import Path
from PIL import Image, ImageEnhance
R=str(Path(__file__).resolve().parents[1] / 'extra_assets') + '/'; TS=R+'themed-tilesets/'; GEN=R+'preview/generated/'
C=16; LIFT=1; TOP=C//2; FH=C+LIFT; FACE=FH-TOP          # Render at the sewer pack’s native 16px, then scale once to runtime 32px.
def cut(folder,file,x,y,w=1,h=1,px=48):
    im=Image.open(TS+folder+'/'+file).convert('RGBA').crop((x*px,y*px,(x+w)*px,(y+h)*px))
    return im.resize((w*C,h*C),Image.LANCZOS)
def bbox_cut(folder,file,b): return Image.open(TS+folder+'/'+file).convert('RGBA').crop((b[0],b[1],b[0]+b[2],b[1]+b[3])).resize((C,C),Image.LANCZOS)
def stock(file,n):
    im=Image.open(TS+'ground/'+file).convert('RGBA'); ax,ay=n%8,n//8
    return im.crop((ax*96+24,ay*144+72,ax*96+72,ay*144+120)).resize((C,C),Image.LANCZOS)
def gen(name): return Image.open(GEN+name).convert('RGBA').resize((C,C),Image.NEAREST)
def tone(im,b=1.0,c=1.0,s=1.0):
    im=ImageEnhance.Brightness(im).enhance(b); im=ImageEnhance.Contrast(im).enhance(c); return ImageEnhance.Color(im).enhance(s)
def band(im,y0):  # a FACE-tall horizontal band out of a face source, tiled to C wide
    if im.height<y0+FACE: y0=max(0,im.height-FACE)
    return im.crop((0,y0,C,y0+FACE))
def proc_cap(rgb):
    im=Image.new('RGBA',(C,C),rgb+(255,)); return im
# style per level: cap (C x C), face (C x FACE), lip colours (light, mid, dark), floor tile, a wall light prop on a face
SEWER_SHEET = Path(R) / '16x16/Sewers Tileset/Tilesets/sewers_tiles.png'
def sewer_tile(x, y, w=1, h=1):
    with Image.open(SEWER_SHEET) as sheet:
        return sheet.convert('RGBA').crop((x*16, y*16, (x+w)*16, (y+h)*16))

L1_face=cut('plague age','1.png',15,0,1,2)
L4_face=cut('Dwarven Underground Fortress','tile-B-05.png',6,12)
STYLE={
 'l1':dict(title='L1 sewer: ElvGames brick, water and pipes',
           cap=tone(sewer_tile(6,3),.80), face=band(sewer_tile(6,3),4),
           lip=('#66625e','#514d4a','#3d3937'), floor=stock('Tile_A2-2.png',9),
           light=None, src='ElvGames Sewers Tileset: brick (6,3), water frame centres, connected pipes; existing grey walkway retained'),
 'l2':dict(title='L2 natural caves: game rock (current)',cap=proc_cap((98,86,70)),face=None,lip=('#8d7d64','#7d6e58','#6f624e'),floor=stock('Tile_A2-1 (2).png',0),
           light=cut('medieval sewer','tile-B-01.png',2,6,1,2),src='the existing procedural wall (CAVE_WALL_TOP_RGB cap, pebble face): kept as the natural-cave baseline'),
 'l3':dict(title='L3 warrens: dry-stacked dark stone',cap=tone(bbox_cut('Goblin Lair','Auto-tile-A4-Walls-1.png',[696,72,48,48]),.8),face=band(bbox_cut('Goblin Lair','Auto-tile-A4-Walls-1.png',[696,168,48,48]),4),lip=('#7a6a52','#5e5140','#45392c'),floor=stock('Tile_A2-1 (2).png',0),
           light=cut('Medieval Dungeon-1','tile-B-01.png',0,4,1,2),src='cap and face: Goblin Lair A4 wall n7 (cobbled top, stacked stone face)'),
 'l4':dict(title='L4 dwarven stonework',cap=cut('Dwarven Underground Fortress','tile-B-05.png',8,13),face=band(L4_face,4),lip=('#b9b4aa','#9a958c','#77736b'),floor=cut('Dwarven Underground Fortress','tile-B-05.png',10,13),
           light=cut('Dwarven Underground Fortress','tile-B-01.png',4,8,1,2),src='cap: Dwarven tile-B-05 grey slab (8,13); face: brick band (6,12); lip: dressed stone'),
 'l6':dict(title='L6 black basalt, lava-veined',cap=gen('l6-black-floor.png'),face=band(gen('l6-black-lava-cracks.png').resize((C,C)),6),lip=('#5a4a46','#3e3230','#2a2120'),floor=gen('l6-ember-floor.png'),
           light=cut('Hell Underworld Tileset','tile-B-05.png',2,4,1,2) if False else None,src='cap: authored black basalt; face: authored basalt with lava cracks; glowing seam at the foot'),
 'l7':dict(title='L7 dragon temple masonry',cap=tone(stock('Tile_A2-2.png',9),.55,1.1,1.0),face=band(cut('Medieval Dragon Shrine','tile-B-02.png',8,10,1,2),6),lip=('#d4b062','#a8843e','#7a5e2a'),floor=stock('Tile_A2-2.png',9),
           light=cut('Medieval Dragon Shrine','tile-B-05.png',9,8,1,2),src='cap: dark basalt slab; face: Medieval Dragon Shrine vault brick (tile-B-02 8,10); lip: temple gold'),
}
MAP=["##########",
     "##########",
     "###....###",
     "##......##",
     "#...##...#",
     "#...##....",
     "#........#",
     "##..#...##",
     "###.....##",
     "####..####"]
def solid(c,r): return 0<=r<10 and 0<=c<10 and MAP[r][c]=='#' or (r<0 or r>=10 or c<0 or c>=10)
def wall_cell(st,mask,variant):
    out=Image.new('RGBA',(C,FH)); cap=st['cap'].convert('RGBA'); capH=TOP if mask&4 else FH
    px=out.load(); cp=cap.load()
    for y in range(capH):
        for x in range(C):
            d=min(y if mask&1 else C, C-1-x if mask&2 else C, TOP-1-y if mask&4 else C, x if mask&8 else C,
                  math.hypot(x,max(0,TOP-y)) if mask&16 else C, math.hypot(C-1-x,max(0,TOP-y)) if mask&32 else C)
            light=1-0.24*min(1,d/(C*.38))
            r,g,b,a=cp[x,y%C]; px[x,y]=(int(r*light),int(g*light),int(b*light),255)
    if mask&4:
        if st['face'] is not None:
            out.paste(tone(st['face'].convert('RGBA'),.82),(0,TOP))
        else:  # the game's pebble face, approximated
            for y in range(TOP,FH):
                for x in range(C): px[x,y]=(48,42,36,255) if (x//4+y//4+variant)%2 else (58,51,43,255)
        for x in range(C): px[x,FH-1]=(21,19,16,255); px[x,FH-2]=tuple(int(v*.84) for v in px[x,FH-2][:3])+(255,)
        if st is STYLE.get('l6'):
            for x in range(C): px[x,FH-1]=(200,70,20,255)
    lip=[tuple(int(st['lip'][i][j:j+2],16) for j in (1,3,5))+(255,) for i in range(3)]
    def mark(vert,edge,inward,start,length):
        for k in range(3):
            for t in range(start,start+length):
                xx,yy=((edge+inward*k,t) if vert else (t,edge+inward*k))
                if 0<=xx<C and 0<=yy<FH: px[xx,yy]=lip[k]
    if mask&1: mark(False,0,1,0,C)
    if mask&4: mark(False,TOP-1,-1,0,C)
    if mask&8: mark(True,0,1,0,capH)
    if mask&2: mark(True,C-1,-1,0,capH)
    return out
def render(lid, water_frame=0, pipes=True):
    st=STYLE[lid]; img=Image.new('RGBA',(10*C,10*C+LIFT),(0,0,0,255))
    for r in range(10):
        for c in range(10):
            img.paste(st['floor'].convert('RGBA'),(c*C,r*C+LIFT))
    if lid=='l1':
        # Eight authored water phases. Use the inner tile for the channel and
        # its matching straight bank edges; no labels or neighbouring tiles.
        fx, fy = (water_frame % 3) * 5, (water_frame // 3) * 5
        surf = sewer_tile(2+fx,18+fy)
        north = sewer_tile(2+fx,16+fy).crop((0,0,C,5))
        south = sewer_tile(2+fx,20+fy).crop((0,11,C,16))
        for c in range(10):
            if not solid(c,6): img.paste(surf,(c*C,6*C+LIFT))
            if not solid(c,5) and not solid(c,6): img.alpha_composite(north,(c*C,6*C+LIFT-5))
            if not solid(c,7) and not solid(c,6): img.alpha_composite(south,(c*C,7*C+LIFT))
    for r in range(10):
        for c in range(10):
            if not solid(c,r): continue
            mask=(0 if solid(c,r-1) else 1)|(0 if solid(c+1,r) else 2)|(0 if solid(c,r+1) else 4)|(0 if solid(c-1,r) else 8)
            if not mask&4:
                if solid(c-1,r) and not solid(c-1,r+1): mask|=16
                if solid(c+1,r) and not solid(c+1,r+1): mask|=32
            v=((c*31)^r)&3
            cell=wall_cell(st,mask,v); img.alpha_composite(cell,(c*C,r*C))
            # Phase 1 previews isolate wall materials; lights are a later import.
    if lid == 'l1' and pipes:
        # West bend -> straight run -> east bend -> downward outlet.
        # The pipe atlas is connected on a 16px grid; never stretch a piece.
        for x,y,tx,ty in [(3,0,10,0),(4,0,10,2),(5,0,10,2),
                          (6,0,12,0),(3,1,11,3),(6,1,11,3),
                          (3,2,12,5),(6,2,13,5)]:
            img.alpha_composite(sewer_tile(tx,ty),(x*C,y*C))
        img.alpha_composite(sewer_tile(13,5),(4*C,5*C+4))
    return img.resize((img.width*2,img.height*2),Image.NEAREST)
def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--level', choices=list(STYLE), default='l1')
    args = parser.parse_args()
    lid = args.level
    if lid == 'l1':
        # Sewer now uses the production wall generator in the browser study;
        # keep one renderer for its table thumbnail, example and corner checks.
        subprocess.run([sys.executable, str(Path(__file__).with_name('render_sewer_preview.py'))], check=True)
        return
    render(lid).save(GEN + f'cavewall-{lid}.png')
    print(f'Rendered {lid}; other floor previews unchanged.')

if __name__ == '__main__':
    main()
