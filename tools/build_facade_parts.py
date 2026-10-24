#!/usr/bin/env python3
"""Build processed Pixel Plains facade crops and matching procedural hardware.

The licensed raw pack stays in ignored extra_assets/. Only recoloured, resized
runtime derivatives are kept in source/b4-facade; the sheet packer uses those
without needing the commercial pack. See provenance.json and the material README.
"""
from pathlib import Path
import json
from PIL import Image, ImageDraw, ImageColor
from build_approved_materials import STEAMPUNK_RAMPS
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'extra_assets/inactive/assets/Objects/BuildingMaterials/source/b4-facade'
INK='#32131e'
BRASS=['#795431','#b98546','#e7c47a']
WOOD=['#302731','#493529','#735039']
GLASS=['#375b67','#648b8b','#c7d4ba']
STONE=['#393e40','#515655','#6a6c63','#858575','#a0a08c']
PARTS={'porthole':(14,14),'smithDoor':(23,24),'cog':(14,14)}
GLYPHS={
'shop':['..####..','.##..##.','.##..##.','########','########','########','########','.######.'],
'trader':['...#....','########','.#.#..#.','.#.#..#.','##.#..##','##.#..##','...#....','.#####..'],
'supply':['..####..','.######.','.######.','........','.######.','.######.','........','..####..'],
'seed':['##....##','###..###','.######.','...##...','...##...','...##...','...##...','.######.'],
'pet':['.##..##.','.##..##.','........','##....##','##.##.##','..####..','..####..','...##...'],
'potion':['..####..','...##...','...##...','..####..','.######.','########','########','.######.'],
'relic':['.######.','########','.##..##.','.######.','..####..','..####..','...##...','........'],
'book':['###..###','#..##..#','#..##..#','#..##..#','#..##..#','#..##..#','###..###','..####..'],
}

# Original source coordinates, never the enlarged preview coordinates.
PP_CROPS = {
    'whitePlaster': ([379,82,23,26], (24,24), 'white'),
    'cream': ([267,82,23,26], (24,24), 'cream'),
    'boards': ([491,82,25,28], (24,24), 'wood'),
    'smithStone': ([267,82,23,26], (24,24), 'stone'),
    'houseDoor': ([291,84,27,28], (19,24), 'wood'),
    'timberWindow': ([176,136,16,16], (14,14), 'opening'),
    'brassWindow': ([176,136,16,16], (16,16), 'opening'),
    'shopWindow': ([695,133,82,23], (74,15), 'opening'),
    'shopDoor': ([705,165,30,27], (20,24), 'opening'),
    'signBoard': ([712,197,80,14], (20,18), 'sign'),
    **{f'awning{name}': ([33,258,30,23], (76,8), name)
       for name in ['blueSlate','verdigris','strawGreen','violet','red','plum']},
}
RAMPS = {'white':['#cfcdc3','#eeeee4','#faf6e9'],
         'cream':['#a59170','#b8a680','#cfbd96','#decca6','#e9d9b7'],
         'wood':WOOD, 'stone':STONE, **STEAMPUNK_RAMPS}

def pp_parts():
    source=ROOT/'extra_assets/Pixel Plains/PP Interiors Pack/Exterior set.png'
    sheet=Image.open(source).convert('RGBA'); result={}; provenance={}
    for name,(rect,size,material) in PP_CROPS.items():
        x,y,w,h=rect; im=sheet.crop((x,y,x+w,y+h)).resize(size,Image.Resampling.NEAREST)
        # Rank-map solid surface colours; hue-map glass separately from frames.
        colours=sorted(set(im.getdata()),key=lambda c:sum(c[:3]))
        colours=[c for c in colours if c[3]]
        mapping={}
        for i,c in enumerate(colours):
            r,g,b,_=c
            if material in ('opening','sign'):
                if g>r*1.1 and g>=b*.85:
                    glass=sorted([v for v in colours if v[1]>v[0]*1.1 and v[1]>=v[2]*.85],key=lambda v:sum(v[:3]))
                    rgb=GLASS[round(glass.index(c)*2/max(1,len(glass)-1))]
                else:
                    rgb=INK if r+g+b<300 else BRASS[0 if r+g+b<470 else 1 if r+g+b<620 else 2]
            else:
                ramp=RAMPS[material]
                # The source's dominant orange/white fill becomes our middle
                # material tone; isolated brick hints remain low contrast.
                if material in ('cream','stone'):rgb=ramp[min(2,i)]
                elif material=='white':rgb=ramp[min(1,i)]
                else:rgb=ramp[round(i*(len(ramp)-1)/max(1,len(colours)-1))]
            mapping[c]=ImageColor.getrgb(rgb)+(255,)
        im.putdata([mapping[c] if c[3] else (0,0,0,0) for c in im.getdata()])
        d=ImageDraw.Draw(im)
        if name=='houseDoor':
            d.rectangle((0,0,18,23),outline=INK)
            d.line((9,2,9,22),fill=WOOD[0])
            d.rectangle((10,14,11,15),fill=BRASS[1]);d.point((10,14),fill=BRASS[2])
        if name in ('shopDoor','shopWindow'):
            # One-texel ink and brass edges remain continuous after reduction.
            d.rectangle((0,0,size[0]-1,size[1]-1),outline=INK)
            d.line((1,1,size[0]-2,1),fill=BRASS[2]);d.line((1,2,1,size[1]-2),fill=BRASS[1])
            d.line((size[0]-2,2,size[0]-2,size[1]-2),fill=BRASS[0])
            if name=='shopDoor':
                d.rectangle((9,2,10,22),fill=BRASS[0]);d.rectangle((11,14,12,15),fill=BRASS[1]);d.point((11,14),fill=BRASS[2])
        if name=='signBoard':
            # Preserve the PP board silhouette/rim, removing every text pixel.
            d.rectangle((1,2,18,15),fill=WOOD[0])
            d.rectangle((0,0,19,17),outline=INK)
            d.line((1,1,18,1),fill=BRASS[2]);d.line((1,2,1,16),fill=BRASS[1])
            d.line((2,16,18,16),fill=BRASS[0])
        if name.startswith('awning'):
            # PP stall canopy, flattened onto the wall: no projecting mesh.
            d.line((0,0,75,0),fill=INK)
            d.line((0,7,75,7),fill=INK)
        if name in ('whitePlaster','cream','boards','smithStone'):
            # Tile the processed motif; do not stretch the source over a wall.
            tile=im
            im=Image.new('RGBA',(96,96))
            for yy in range(0,96,24):
                for xx in range(0,96,24):im.paste(tile,(xx,yy))
            if name=='smithStone':
                d=ImageDraw.Draw(im)
                for yy in range(0,96,12):
                    d.line((0,yy+11,95,yy+11),fill=STONE[0])
                    for xx in range(-12 if yy%24 else 0,96,24):
                        d.line((xx,yy,xx,yy+11),fill=STONE[0]);d.line((xx+1,yy,xx+22,yy),fill=STONE[3])
        result[name]=im
        provenance[name]={'source':'extra_assets/Pixel Plains/PP Interiors Pack/Exterior set.png','crop':rect,'texelSize':list(size),'outputSize':list(im.size),'material':material}
    return result,provenance

def main():
    OUT.mkdir(parents=True,exist_ok=True)
    parts={name:Image.new('RGBA',size) for name,size in PARTS.items()}
    # Round window keeps the concept's large circular ring; clipped corners
    # remove baked plaster around the opening.
    im=parts['porthole']; d=ImageDraw.Draw(im); d.rectangle((0,0,13,13),fill=(0,0,0,0))
    d.ellipse((0,0,13,13),fill=INK); d.ellipse((1,1,12,12),fill=BRASS[0]); d.ellipse((1,1,11,11),fill=BRASS[1]); d.arc((1,1,11,11),180,290,fill=BRASS[2],width=1)
    d.ellipse((3,3,10,10),fill=INK); d.ellipse((4,4,9,9),fill=GLASS[0]); d.rectangle((4,4,8,6),fill=GLASS[1]); d.point((5,4),fill=GLASS[2]); d.line((6,4,6,9),fill=BRASS[0]); d.line((4,7,9,7),fill=BRASS[0])
    for x,y in [(5,1),(1,5),(10,5),(5,10)]:d.rectangle((x,y,x+1,y+1),fill=BRASS[2] if y<5 else BRASS[0])
    im=parts['smithDoor'];d=ImageDraw.Draw(im)
    d.rectangle((0,0,22,23),outline=INK);d.rectangle((1,1,21,22),outline=BRASS[0]);d.line((2,1,20,1),fill=BRASS[2]);d.line((1,2,1,21),fill=BRASS[1]);d.rectangle((3,3,19,21),fill=STONE[0]);d.rectangle((4,4,9,20),fill=STONE[1]);d.rectangle((13,4,18,20),fill=STONE[1]);d.line((11,3,11,21),fill=INK)
    for x in (3,18):
        for y in (4,18):d.rectangle((x,y,x+1,y+1),fill=BRASS[1]);d.point((x,y),fill=BRASS[2])
    for x in (8,13):d.rectangle((x,13,x+2,16),fill=INK);d.rectangle((x,13,x+1,14),fill=BRASS[1])
    # Eight teeth remain substantial at 14px; the concept cog's spokes are
    # simplified to a single hollow centre and 2px tooth clusters.
    im=parts['cog'];d=ImageDraw.Draw(im);d.rectangle((0,0,13,13),fill=(0,0,0,0));d.ellipse((1,1,12,12),fill=INK)
    for x,y,w,h in [(5,0,4,3),(5,11,4,3),(0,5,3,4),(11,5,3,4),(1,1,3,3),(10,1,3,3),(1,10,3,3),(10,10,3,3)]:d.rectangle((x,y,x+w-1,y+h-1),fill=INK)
    d.ellipse((2,2,11,11),fill=BRASS[1]);d.arc((2,2,11,11),175,285,fill=BRASS[2],width=1)
    for x,y in [(6,0),(6,11),(0,6),(11,6),(2,2),(10,2),(2,10),(10,10)]:d.rectangle((x,y,x+1,y+1),fill=BRASS[1])
    d.ellipse((4,4,9,9),fill=BRASS[0]);d.ellipse((5,5,8,8),fill=INK);d.point((3,3),fill=BRASS[2])
    parts['cog']=parts['cog'].resize((18,18),Image.Resampling.NEAREST)
    pp, provenance=pp_parts()
    parts.update({k:v for k,v in pp.items() if k!='signBoard'})
    for name,rows in GLYPHS.items():
        im=pp['signBoard'].copy()
        glyph=Image.new('RGBA',(8,8));d=ImageDraw.Draw(glyph)
        for y,row in enumerate(rows):
            for x,c in enumerate(row):
                if c=='#':d.point((x,y),fill=BRASS[2] if y<4 else BRASS[1])
        im.alpha_composite(glyph.resize((12,12),Image.Resampling.NEAREST),(4,3))
        parts[name]=im
    for name,im in parts.items():im.save(OUT/f'{name}.png',optimize=True)
    (OUT/'pp-provenance.json').write_text(json.dumps({'credit':'Pixel Plains Interiors Pack by Jose Javier (SnowHex)', 'resampling':'nearest-neighbour only; no dithering', 'crops':provenance},indent=2)+'\n')
    print(f'{len(parts)} facade parts/surfaces written: exact ramps, binary alpha')

if __name__=='__main__':main()
