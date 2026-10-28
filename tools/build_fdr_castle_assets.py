#!/usr/bin/env python3
"""Export subdued FDR castle masonry from the approved native source crops."""
import argparse
import hashlib
import json
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw

from build_fdr_castle_trial import SOURCE, FLOOR_SOURCE, ROOT

SIZE, SLOT, PAD, CONTENT = 512, 128, 8, 112
MATERIALS = [
    (2, 'cap', (130, 30, 12, 8), (16, 16)),
    (3, 'wall', (16, 64, 16, 16), None),
    (4, 'floor', (144, 48, 16, 16), None),
    (5, 'door', (192, 256, 48, 32), None),
    (6, 'window', (0, 160, 16, 16), None),
    (7, 'side-coping', (128, 48, 8, 16), None),
    (8, 'merlon-top', (131, 29, 10, 4), None),
    (9, 'merlon-face', (131, 33, 10, 4), None),
    (10, 'rim', (144, 76, 16, 4), None),
    (11, 'base', (128, 104, 16, 8), None),
    (12, 'right-coping', (168, 48, 8, 16), None),
]


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def padded(tile, wrap_x, wrap_y):
    """Match the approved preview: wrapped repeats, clamped decal borders."""
    # Canvas selects the lower texel when a destination centre lands exactly
    # between source texels. Pillow's tie rule differs for the 32px door rows.
    # Integer centre sampling preserves the approved browser atlas exactly.
    pixels = tile.load()
    xs = [max(0, ((2 * x + 1) * tile.width - 1) // (2 * CONTENT)) for x in range(CONTENT)]
    ys = [max(0, ((2 * y + 1) * tile.height - 1) // (2 * CONTENT)) for y in range(CONTENT)]
    content = Image.new('RGBA', (CONTENT, CONTENT))
    content.putdata([pixels[x, y] for y in ys for x in xs])
    result = Image.new('RGBA', (SLOT, SLOT))
    result.paste(content, (PAD, PAD))
    top = content.crop((0, CONTENT - PAD if wrap_y else 0, CONTENT,
                        CONTENT if wrap_y else 1))
    bottom = content.crop((0, 0 if wrap_y else CONTENT - 1, CONTENT,
                           PAD if wrap_y else CONTENT))
    result.paste(top.resize((CONTENT, PAD), Image.Resampling.NEAREST), (PAD, 0))
    result.paste(bottom.resize((CONTENT, PAD), Image.Resampling.NEAREST), (PAD, PAD + CONTENT))
    left_x = CONTENT if wrap_x else PAD
    right_x = PAD if wrap_x else PAD + CONTENT - 1
    left = result.crop((left_x, 0, left_x + (PAD if wrap_x else 1), SLOT))
    right = result.crop((right_x, 0, right_x + (PAD if wrap_x else 1), SLOT))
    result.paste(left.resize((PAD, SLOT), Image.Resampling.NEAREST), (0, 0))
    result.paste(right.resize((PAD, SLOT), Image.Resampling.NEAREST), (PAD + CONTENT, 0))
    return result



# Only the castle atlas is treated; the separately exported ground paving keeps
# its native pixels. Compression preserves average stone colour and pixel detail.
MASONRY_SLOTS = {2, 3, 7, 8, 9, 10, 11, 12}
SKY_SLOTS = {2, 4, 7, 8, 12}
CONTRAST, SKY_LIFT = 0.60, 0.07


def treatment(tile, slot):
    contrast = CONTRAST if slot in MASONRY_SLOTS else 1
    lift = SKY_LIFT if slot in SKY_SLOTS else 0
    pixels = list(tile.getdata())
    opaque = [p for p in pixels if p[3]]
    average = [sum(p[i] for p in opaque) / len(opaque) for i in range(3)]
    result = Image.new('RGBA', tile.size)
    result.putdata([tuple(round((average[i] + (p[i] - average[i]) * contrast) * (1 - lift)
                              + 255 * lift) for i in range(3)) + (p[3],) if p[3] else p
                    for p in pixels])
    return result, dict(contrast=contrast, skyLift=lift)


def baked_top_light(tile, light_gain=1):
    """Paint soft overhead light into the 64-world-unit stone/foliage motif."""
    result = tile.copy()
    pixels = result.load()
    for y in range(tile.height):
        z = (tile.height - 1 - y) * 64 / (tile.height - 1)
        shade = .60 + .40 * min(1, z / 40) ** .5
        # A brighter constant material tint provides highlight headroom. Fade
        # its reciprocal out by the curtain crest, preserving the dark foot.
        shade *= 1 / light_gain + (1 - 1 / light_gain) * min(1, z / 24)
        for x in range(tile.width):
            r, g, b, alpha = pixels[x, y]
            pixels[x, y] = (round(r * shade), round(g * shade), round(b * shade), alpha)
    return result


def build(out):
    out.mkdir(parents=True, exist_ok=True)
    profiles = json.loads(subprocess.check_output(['node', '-e',
        "global.window=global;require('./src/castle_styles.js');console.log(JSON.stringify(Object.fromEntries(['citadel','bastion','archive'].flatMap(id=>[false,true].map(active=>[id+':'+Number(active),{...CastleStyles.renderStyle(id,active),wood:CastleStyles.get(id,active).wood}])))));"],
        cwd=ROOT, text=True))
    source = Image.open(SOURCE).convert('RGBA')
    floor_source = Image.open(FLOOR_SOURCE).convert('RGBA')
    atlas = Image.new('RGBA', (SIZE, SIZE))
    rows = []
    for slot, name, rect, normalized in MATERIALS:
        x, y, w, h = rect
        native = (floor_source if name == 'floor' else source).crop((x, y, x + w, y + h))
        if name == 'floor':
            native.save(out / 'floor.png')
        tile, paint = treatment(native, slot)
        tile = tile.resize(normalized, Image.Resampling.NEAREST) if normalized else tile
        wrap_x, wrap_y = slot in (3, 4, 10), slot in (3, 4)
        ox, oy = slot % 4 * SLOT, slot // 4 * SLOT
        atlas.paste(padded(tile, wrap_x, wrap_y), (ox, oy))
        rows.append(dict(slot=slot, name=name, source='floor' if name == 'floor' else 'castle',
                         sourceRect=list(rect), normalizedSize=list(tile.size),
                         atlasContentRect=[ox + PAD, oy + PAD, CONTENT, CONTENT],
                         gutterX='wrap' if wrap_x else 'clamp', gutterY='wrap' if wrap_y else 'clamp',
                         alphaRange=list(native.getchannel('A').getextrema()), treatment=paint))
    # Shared authored cel materials. Their stone courses, coping and heraldry
    # replace facade detail geometry; every tile is built once offline.
    def masonry(family, damaged=False, tower=False):
        # Stone repeats every32 units; vegetation spans128 independent units.
        # The224-unit tile packs that128-unit repeat into exactly64 atlas
        # texels, so phases still agree after nearest-neighbour reduction.
        tile = Image.new('RGBA', (32, 64), (238, 238, 238, 255))
        draw = ImageDraw.Draw(tile)
        height = 10 if family == 'bastion' or tower else 6
        mortar = 220 if family == 'archive' else 218 if family == 'citadel' else 197
        draw.rectangle((0, 0, 31, 63), fill=(mortar, mortar, mortar, 255))
        for row in range((64 + height - 1) // height):
            # Keep the ground course whole; only the unused high end of
            # this 64-unit material may contain a partial course.
            y = 64 - (row + 1) * height
            widths = [16, 16] if family == 'bastion' or tower else [8, 12, 12] if family == 'citadel' else [8, 8, 8, 8]
            x = -widths[0] // 2 if row % 2 else 0
            index = 0
            while x < 32:
                width = widths[index % len(widths)]
                shades = [246, 243, 250, 245, 240] if tower else [245, 235, 250, 240, 230]
                shade = shades[(row * 3 + (index % len(widths)) * 7) % 5]
                # One-pixel chamfers and short bevels keep the masonry from
                # reading as a grid of flat rectangles, like the wreck stone.
                left, right, bottom = x + 1, x + width - 1, y + height - 2
                draw.polygon([(left + 1, y), (right - 1, y), (right, y + 1),
                              (right, bottom - 1), (right - 1, bottom),
                              (left + 1, bottom), (left, bottom - 1), (left, y + 1)],
                             fill=(shade,) * 3 + (255,))
                draw.line((left + 2, y, right - 1, y),
                          fill=(min(255, shade + 18),) * 3 + (255,))
                draw.line((left + 1, bottom, right - 2, bottom),
                          fill=(max(0, mortar - 24),) * 3 + (255,))
                # Recessed mortar below the dark lower bevel; the next
                # course begins with its own narrow upward-facing highlight.
                draw.line((left, bottom + 1, right, bottom + 1),
                          fill=(max(0, mortar - 10),) * 3 + (255,))
                if (row * 3 + index) % 5 == 0:
                    draw.point((right - 1, y + 1), fill=(max(mortar, shade - 18),) * 3 + (255,))
                x += width; index += 1
        motif = Image.new('RGBA', (128, 64))
        for x in range(0, 128, 32):
            motif.paste(tile, (x, 0))
        if damaged:
            # Reserve material headroom for foliage while keeping bare stone
            # at its original value under the reciprocal renderer tint.
            headroom = profiles[family + ':0']['masonryWeatheredCompensation']
            motif = motif.point(lambda value: round(value / headroom))
            motif.putalpha(255)
            foliage = ImageDraw.Draw(motif)
            # Uneven connected growth from the foot, with long quiet gaps.
            # No circular blobs, diagonal ribbons, or per-brick repetition.
            patches = [
                [(2,63),(2,59),(7,59),(7,54),(10,54),(10,46),(14,46),
                 (14,51),(18,51),(18,57),(25,57),(25,60),(30,60),(30,63)],
                [(85,63),(85,60),(92,60),(92,55),(97,55),(97,48),(101,48),
                 (101,54),(107,54),(107,58),(116,58),(116,63)],
                [(45,19),(57,19),(57,23),(62,23),(62,29),(58,29),(58,39),
                 (61,39),(61,44),(57,44),(57,52),(53,52),(53,56),(49,56),
                 (49,46),(46,46),(46,37),(50,37),(50,31),(46,31),(46,26),(42,26),(42,22)],
                [(96,29),(108,29),(108,34),(113,34),(113,39),(107,39),
                 (107,45),(111,45),(111,49),(105,49),(105,54),(101,54),
                 (101,43),(97,43),(97,37),(93,37),(93,32)],
            ]
            if family == 'citadel':
                patches = [
                    [(4,63),(4,60),(9,60),(9,57),(13,57),(13,61),(20,61),(20,63)],
                    [(49,27),(55,27),(55,31),(59,31),(59,34),(54,34),(54,45),
                     (57,45),(57,49),(51,49),(51,43),(49,43)],
                ]
            for polygon in patches:
                foliage.polygon(polygon, fill=(119,153,83,255))
            # Small angular leaf groups soften selected junctions without
            # uniformly stippling the complete vegetation silhouette.
            marks = [(8,55,4,3),(12,48,3,4),(20,59,5,2),(95,57,4,3),
                     (100,51,2,5),(109,60,5,2),(47,22,4,3),(54,30,3,5)]
            if family == 'citadel':
                marks = [(8,60,4,2),(51,29,3,3),(54,33,2,3)]
            for x,y,w,h in marks:
                foliage.rectangle((x,y,x+w-1,y+h-1),fill=(139,166,99,255))
        # Shade growth and stone together; the renderer only supplies the
        # fixed family tint. No runtime gradient or per-building bake.
        motif = baked_top_light(motif, profiles[family + ':' + str(int(not damaged))]['masonryLightGain'])
        repeated = Image.new('RGBA', (224, 64))
        repeated.paste(motif, (0, 0))
        repeated.paste(motif.crop((0, 0, 96, 64)), (128, 0))
        return repeated

    stone = masonry('archive'); wreck = masonry('archive', True)
    citadel_stone = masonry('citadel'); citadel_wreck = masonry('citadel', True)
    bastion_stone = masonry('bastion'); bastion_wreck = masonry('bastion', True)
    archive_tower = masonry('archive', tower=True)
    archive_tower_wreck = masonry('archive', True, tower=True)
    deck = Image.new('RGBA', (32, 32), (216, 206, 179, 255)); rim = ImageDraw.Draw(deck)
    rim.rectangle((0, 0, 31, 31), outline=(185, 185, 185, 255), width=1)
    rim.rectangle((1, 1, 30, 30), outline=(255, 255, 255, 255), width=2)
    rim.rectangle((3, 3, 28, 28), outline=(177, 168, 145, 255), width=1)
    for row, y in enumerate([8, 14, 20, 26]):
        rim.line((4, y, 27, y), fill=(191, 180, 153, 255))
        for x in range(8 if row % 2 else 14, 28, 12):
            rim.line((x, y - 5, x, y - 1), fill=(198, 187, 160, 255))
    # Transparent pale heraldry: one pixel-art sun/trident mark is sampled by
    # existing flat banner faces, never modeled as separate spikes or strokes.
    heraldry = Image.new('RGBA', (16, 16)); sigil = ImageDraw.Draw(heraldry)
    sigil.rectangle((7, 1, 8, 14), fill='white')
    sigil.line((3, 4, 3, 7, 7, 10, 12, 7, 12, 4), fill='white', width=2)
    sigil.rectangle((6, 3, 9, 6), fill='white')
    sun = Image.new('RGBA', (16, 16)); rays = ImageDraw.Draw(sun)
    rays.rectangle((5, 5, 10, 10), fill='white')
    for x, y, w, h in [(7, 1, 2, 3), (7, 12, 2, 3), (1, 7, 3, 2), (12, 7, 3, 2), (3, 3, 2, 2), (11, 3, 2, 2), (3, 11, 2, 2), (11, 11, 2, 2)]:
        rays.rectangle((x, y, x+w-1, y+h-1), fill='white')
    # Leave the bottom fifth clear of the atlas's shared white patch.
    cloth = Image.new('RGBA', (16, 50)); hem = ImageDraw.Draw(cloth)
    hem.polygon([(0, 0), (15, 0), (15, 39), (8, 33), (7, 33), (0, 39)],
                fill=(174, 174, 174, 255))
    hem.polygon([(1, 2), (14, 2), (14, 36), (8, 31), (7, 31), (1, 36)],
                fill=(255, 255, 255, 255))
    hem.line((2, 3, 2, 33), fill=(226, 226, 226, 255))
    # Archive doors sit flush in the wall: no pale pictureframe surround.
    door = Image.new('RGBA', (24, 28), (65, 69, 67, 255)); frame = ImageDraw.Draw(door)
    frame.rectangle((0, 0, 23, 27), outline=(42, 46, 44, 255), width=1)
    frame.rectangle((2, 2, 10, 26), fill=(76, 80, 76, 255))
    frame.rectangle((13, 2, 21, 26), fill=(68, 73, 70, 255))
    frame.line((1, 1, 22, 1), fill=(100, 103, 95, 255))
    frame.line((11, 1, 11, 27), fill=(35, 39, 38, 255))
    military_door = Image.new('RGBA', (32, 40)); gate = ImageDraw.Draw(military_door)
    arch_outline = [(1, 39), (1, 13), (5, 6), (11, 2), (20, 2), (26, 6), (30, 13), (30, 39)]
    gate.polygon(arch_outline, fill=(139, 139, 139, 255))
    gate.line(arch_outline[1:-1], fill=(226, 226, 226, 255), width=2)
    gate.polygon([(5, 39), (5, 14), (8, 9), (13, 6), (18, 6), (23, 9), (26, 14), (26, 39)],
                 fill=(62, 60, 54, 255))
    for x in [8, 12, 19, 23]:
        gate.line((x, 14, x, 39), fill=(87, 83, 71, 255))
    for y in [19, 31]:
        gate.line((6, y, 25, y), fill=(37, 39, 38, 255), width=2)
    gate.line((15, 7, 15, 39), fill=(28, 31, 31, 255))
    # Existing roof triangles sample an opaque slope tile. The single lit
    # ridge and darker eave stay attached to world-space faces while rotating.
    roof = Image.new('RGBA', (64, 64), (238, 238, 238, 255))
    roof_ink = ImageDraw.Draw(roof)
    roof_ink.line((0, 63, 32, 0), fill=(255, 255, 255, 255), width=2)
    roof_ink.line((0, 63, 63, 63), fill=(220, 220, 220, 255), width=2)
    # Alpha cuts only the upper corners of each existing window quad.
    # Archive towers reuse one quad for two storeys; military towers sample
    # only the first arch (the top 40 percent of this same atlas content).
    window = Image.new('RGBA', (8, 40)); arch = ImageDraw.Draw(window)
    for y in [0, 24]:
        arch.rectangle((0, y+4, 7, y+15), fill='white')
        arch.rectangle((1, y+2, 6, y+4), fill='white')
        arch.rectangle((2, y+1, 5, y+2), fill='white')
        arch.rectangle((3, y, 4, y+1), fill='white')
    for slot, name, tile, wrap_x, wrap_y in [
        (0, 'lit-coping-and-inset-deck', deck, False, False),
        (1, 'pale-heraldry', heraldry, False, False),
        (3, 'citadel-slate', citadel_stone, True, False),
        (9, 'citadel-weathered-slate', citadel_wreck, True, False),
        (10, 'bastion-sandstone', bastion_stone, True, False),
        (4, 'bastion-weathered-sandstone', bastion_wreck, True, False),
        (11, 'archive-tower-ashlar', archive_tower, True, False),
        (12, 'archive-weathered-tower-ashlar', archive_tower_wreck, True, False),
        (5, 'closed-iron-door', door, False, False),
        (6, 'bastion-sun', sun, False, False),
        (7, 'arched-window', window, False, False),
        (8, 'roof-ridge-and-eave', roof, False, False),
        (13, 'quiet-stone', stone, True, False),
        (14, 'weathered-stone', wreck, True, False),
        (15, 'forked-banner-cloth', cloth, False, False)]:
        rows = [row for row in rows if row['slot'] != slot]
        atlas.paste(padded(tile, wrap_x, wrap_y), (slot % 4 * SLOT, slot // 4 * SLOT))
        rows.append(dict(slot=slot, name=name, source='authored cel pixel material',
                         normalizedSize=list(tile.size),
                         atlasContentRect=[slot % 4 * SLOT + PAD, slot // 4 * SLOT + PAD, CONTENT, CONTENT],
                         gutterX='wrap' if wrap_x else 'clamp', gutterY='wrap' if wrap_y else 'clamp',
                         alphaRange=list(tile.getchannel('A').getextrema())))
    # Four padded transparent facades share the existing military door slot.
    # The backed doorway stays centered; the banners occupy only its flanks.
    atlas.paste((0,0,0,0),(256,0,384,128));rows=[row for row in rows if row['slot']!=2]
    facade_frames=[]
    def tint(image,color):
        channels=(color>>16,(color>>8)&255,color&255)
        result=image.copy()
        result.putdata([tuple(round(pixel[c]*channels[c]/255) for c in range(3))+(pixel[3],)
                        for pixel in image.getdata()])
        return result
    def rgb(color):
        return (color>>16,(color>>8)&255,color&255,255)
    def entrance(family,active,style):
        result=tint(military_door,style['wall'])
        shape=[(5,39),(5,14),(8,9),(13,6),(18,6),(23,9),(26,14),(26,39)]
        mask=Image.new('L',(32,40));ImageDraw.Draw(mask).polygon(shape,fill=255)
        layer=Image.new('RGBA',(32,40),rgb(style['door']));paint=ImageDraw.Draw(layer)
        if family=='citadel' and not active:
            # Closed iron portcullis over an opaque dark backing.
            paint.rectangle((0,0,31,39),fill=rgb(style['door']//2&0x7f7f7f))
            for x in [8,13,18,23]:
                paint.rectangle((x,7,x+1,39),fill=rgb(style['side']))
                paint.line((x,10,x,39),fill=rgb(style['wall']))
            for y in [17,28]:paint.rectangle((5,y,26,y+1),fill=rgb(style['side']))
        else:
            paint.rectangle((0,0,15,39),fill=rgb(style['wood']['FACE']))
            paint.rectangle((16,0,31,39),fill=rgb(style['wood']['SHADOW']))
            for x in [9,14,19,24]:paint.line((x,7,x,39),fill=rgb(style['wood']['DARK']))
            for y in [20,33]:paint.line((5,y,26,y),fill=rgb(style['wood']['DARK']),width=2)
            paint.line((15,6,15,39),fill=rgb(style['door']))
        layer.putalpha(mask);result.alpha_composite(layer)
        return result
    keep_trident=Image.new('RGBA',(8,12));prongs=ImageDraw.Draw(keep_trident)
    prongs.rectangle((3,0,4,11),fill='white')
    prongs.rectangle((0,2,1,5),fill='white');prongs.rectangle((6,2,7,5),fill='white')
    prongs.line((1,5,1,6,3,8,4,8,6,6,6,5),fill='white',width=1)
    for family_index,family in enumerate(['citadel','bastion']):
        for active in [False,True]:
            style=profiles[family+':'+str(int(active))]
            height=style['geometry']['keepHeight']-4
            facade=Image.new('RGBA',(56,height))
            facade.alpha_composite(entrance(family,active,style).resize((22,25),Image.Resampling.NEAREST),(17,height-25))
            banner_height=28 if family=='citadel' else 22
            flag=tint(cloth.crop((0,0,16,40)),style['accent']).resize((10,banner_height),Image.Resampling.NEAREST)
            emblem=tint(keep_trident if family=='citadel' else sun,style['heraldry'])
            if family!='citadel':emblem=emblem.resize((6,6),Image.Resampling.NEAREST)
            for x in [2,44]:
                facade.alpha_composite(flag,(x,3));facade.alpha_composite(emblem,(x+(1 if family=='citadel' else 2),8))
            frame=facade.resize((48,48),Image.Resampling.NEAREST)
            ox,oy=268+int(active)*56,12+family_index*56
            for y in range(-2,50):
                for x in range(-2,50):
                    atlas.putpixel((ox+x,oy+y),frame.getpixel((max(0,min(47,x)),max(0,min(47,y)))))
            appearance='portcullis' if family=='citadel' and not active else 'closed-timber-leaves'
            facade_frames.append(dict(family=family,active=active,appearance=appearance,rect=[ox,oy,48,48]))
    rows.append(dict(slot=2,name='military-keep-facades',source='authored cel pixel material',
                     normalizedSize=[112,112],atlasContentRect=[264,8,112,112],
                     gutterX='clamp',gutterY='clamp',alphaRange=[0,255],frames=facade_frames))
    # Family paving is a transparent shared repeat over the condition-aware
    # courtyard color. Large Bastion slabs stay quiet; Archive has fine joints.
    bastion_floor = Image.new('RGBA', (64, 64)); sand = ImageDraw.Draw(bastion_floor)
    for x,y,w,h in [(0,0,16,16),(32,16,16,16),(16,48,16,16),(48,40,16,8)]:
        sand.rectangle((x,y,x+w-1,y+h-1),fill=(148,107,57,26))
    for x,y,w,h in [(16,0,16,8),(0,32,16,16),(48,0,16,16),(32,48,16,16)]:
        sand.rectangle((x,y,x+w-1,y+h-1),fill=(255,233,186,24))
    for x,y,w in [(2,16,12),(34,32,12),(18,48,10)]:
        sand.line((x,y,x+w,y),fill=(138,105,61,18))
    bastion_floor.save(out / 'bastion-floor.png')
    archive_floor = Image.new('RGBA', (64,64),(255,242,209,18)); paving = ImageDraw.Draw(archive_floor)
    for row in range(8):
        y=row*8
        for col,x in enumerate(range(-4 if row%2 else 0,64,8)):
            paving.rectangle((x+1,y+1,x+7,y+7),fill=(255,241,204,22+(row*3+col)%4*7))
            paving.line((x,y+7,x+7,y+7),fill=(116,102,75,45))
            paving.line((x,y,x,y+6),fill=(116,102,75,35))
    archive_floor.save(out / 'archive-floor.png')
    # Ground weathering is a transparent shared repeat painted onto the
    # existing courtyard canvas, so grass does not become individual geometry.
    grass = Image.new('RGBA', (64, 64)); patches = ImageDraw.Draw(grass)
    for poly in [[(0, 8), (10, 8), (10, 3), (20, 3), (20, 12), (25, 12), (25, 18), (17, 18), (17, 24), (5, 24), (5, 20), (0, 20)],
                 [(35, 35), (43, 35), (43, 29), (57, 29), (57, 38), (63, 38), (63, 48), (52, 48), (52, 54), (40, 54), (40, 46), (35, 46)],
                 [(8, 47), (16, 47), (16, 42), (24, 42), (24, 54), (18, 54), (18, 59), (8, 59)]]:
        patches.polygon(poly, fill=(100, 121, 66, 175))
    for x, y in [(7, 13), (15, 9), (45, 38), (49, 46), (12, 50)]:
        patches.rectangle((x, y, x+4, y+3), fill=(134, 148, 83, 160))
    # Break rectangular patch edges into small anchored leaf clusters. These
    # are baked into the existing ground decal, never additional geometry.
    original = grass.copy()
    for y in range(0, 64, 2):
        for x in range(0, 64, 2):
            if not original.getpixel((x, y))[3]:
                continue
            edge = any(not original.getpixel(((x+dx) % 64, (y+dy) % 64))[3]
                       for dx, dy in [(3, 0), (-3, 0), (0, 3), (0, -3)])
            noise = (x * 17 + y * 29 + x * y * 3) % 23
            if (edge and noise < 12) or noise == 0:
                patches.rectangle((x, y, x+1, y+1), fill=(0, 0, 0, 0))
    grass.save(out / 'weathered-floor.png')
    # The banner samples only y392..481.6 of slot15. Its unused lower-left
    # tail holds one opaque coping patch, with two-pixel clamped gutters.
    coping = Image.new('RGBA',(16,12),(235,235,235,255)); bevel=ImageDraw.Draw(coping)
    bevel.rectangle((0,0,15,11),outline=(172,172,172,255),width=1)
    bevel.line((1,1,14,1),fill='white',width=2)
    bevel.line((1,1,1,10),fill=(252,252,252,255),width=1)
    bevel.line((2,10,14,10),fill=(195,195,195,255),width=1)
    # Broken corner highlights round the visual edge without alpha holes.
    for x,y in [(1,1),(14,1),(1,10),(14,10)]:
        bevel.point((x,y), fill=(193,193,193,255))
    bevel.line((3,2,6,2),fill=(244,244,244,255))
    bevel.point((12,8),fill=(217,217,217,255))
    for y in range(16):
        for x in range(20):
            atlas.putpixel((392+x,486+y),coping.getpixel((max(0,min(15,x-2)),max(0,min(11,y-2)))))
    worn_coping=coping.copy();leaves=ImageDraw.Draw(worn_coping)
    leaves.polygon([(0,2),(4,2),(4,0),(7,0),(7,4),(5,4),(5,7),(2,7),(2,5),(0,5)],
                   fill=(157,180,96,255))
    leaves.rectangle((1,2,3,4),fill=(178,196,119,255))
    for y in range(16):
        for x in range(20):
            atlas.putpixel((416+x,486+y),worn_coping.getpixel((max(0,min(15,x-2)),max(0,min(11,y-2)))))
    # Shared retained renderer samples its untextured triangles at (500, 500).
    atlas.paste((255, 255, 255, 255), (496, 496, 504, 504))
    atlas.save(out / 'atlas.png')
    manifest = dict(
        credit='Fantasy Dreamland Reborn and Fantasy City by ElvGames',
        sources={
            'castle': dict(path=str(SOURCE.relative_to(ROOT)), sha256=digest(SOURCE),
                           license='extra_assets/16x16/Fantasy Dreamland World/License.txt'),
            'floor': dict(path=str(FLOOR_SOURCE.relative_to(ROOT)), sha256=digest(FLOOR_SOURCE)),
        },
        processing='Legacy source crops plus authored restrained pixel materials for stone, moss, paving overlays, coping, doors and heraldry. Nearest-neighbour scaling and padded atlas packing; no generated imagery.',
        palette='Quiet cel stone, moss, inset decks, closed iron doors and heraldry share one preloaded atlas. Soft faux overhead light is baked into stone and moss from dark foot to light upper courses; brick and coping bevels soften corners.',
        atlas=dict(size=[SIZE, SIZE], slotSize=SLOT, padding=PAD, contentSize=CONTENT,
                   whitePatch=[496, 496, 8, 8], copingPatch=[394,488,16,12], wornCopingPatch=[418,488,16,12], unusedSlots='Transparent'),
        materials=rows,
        outputs={name: dict(sha256=digest(out / name), size=list(Image.open(out / name).size))
                 for name in ('atlas.png', 'floor.png', 'weathered-floor.png', 'bastion-floor.png', 'archive-floor.png')},
        regenerate='python3 tools/build_fdr_castle_assets.py',
    )
    (out / 'sources.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(f'Exported {out / "atlas.png"} and native 16px floor')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, default=ROOT / 'assets/Objects/Castle/FDR')
    build(parser.parse_args().out)
