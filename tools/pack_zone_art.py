#!/usr/bin/env python3
"""Export generated zone objects into exact map frames without smoothing."""
import json
from pathlib import Path
from PIL import Image
root = Path(__file__).resolve().parents[1]
out = root / 'assets/Objects/ZoneVariants'
source = Image.open(out / 'source.png').convert('RGBA')
rows = [
 'capped_grave_pillar mossy_grave_pillar diamond_grave_pillar rounded_headstone paired_grave_posts burial_slab broken_column fallen_column',
 'wall_straight wall_left wall_right wall_corner wall_crenellated foundation_wall wall_end fallen_lintel',
 'pots_terracotta pots_ochre pots_mossy pots_blue pots_cracked pots_pale barrel broken_barrel',
 'coral_pink coral_fan coral_teal coral_antler coral_plate coral_brain coral_tube coral_turquoise',
 'seaweed_green seaweed_red shell_rock reef_copper reef_iron reef_crystal shell_shrine amphora',
 'mushroom_red mushroom_shelf mushroom_pale mushroom_purple sapling berry_bush hedge_corner wildflowers',
 'hollow_log root_arch seed_shrine standing_stone fern seedpod birdbath mushroom_branch',
 'copper_ore iron_ore quartz sapphire diamond_shrine handcart column_drums tall_pillar',
]
frames = []
for size in (16, 24):
    atlas = Image.new('RGBA', (8 * size, 8 * size))
    for y, row in enumerate(rows):
        for x, name in enumerate(row.split()):
            tile = source.crop((round(x * source.width / 8), round(y * source.height / 8),
                                round((x + 1) * source.width / 8), round((y + 1) * source.height / 8)))
            tile.putalpha(tile.getchannel('A').point(lambda a: 255 if a >= 128 else 0))
            tile = tile.crop(tile.getbbox())
            tile.thumbnail((size - 2, size - 2), Image.Resampling.NEAREST)
            atlas.alpha_composite(tile, (x * size + (size - tile.width) // 2, y * size + (size - tile.height) // 2))
            if size == 24:
                frames.append({'frame': y * 8 + x, 'name': name, 'column': x, 'row': y})
    atlas.save(out / f'objects-{size}.png')
source.resize((1024, 1024), Image.Resampling.NEAREST).save(out / 'atlas-1024.png')
(out / 'manifest.json').write_text(json.dumps({'columns': 8, 'rows': 8, 'sizes': [16, 24], 'frames': frames}, indent=2) + '\n')
