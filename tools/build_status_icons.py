#!/usr/bin/env python3
"""Pack source-native supplemental effect icons; requires Pillow.

Run with --source-root /path/to/checkout containing extra_assets. Git worktrees
also discover that directory through the common git directory automatically.
Only complete, visually reviewed still frames are used; there is no recoloring,
resampling, animation, or generated replacement artwork.
"""
import argparse
import hashlib
import json
import subprocess
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/Icons/StatusEffects'
CELL = 32
COLS = 8
VFX = 'extra_assets/16x16/Buff and Debuff Pixel VFX/Buffs & Debuffs/'
SPELL = 'extra_assets/16x16/{0} Spells Pixel VFX/{0} Spells/'
RA = 'extra_assets/16x16/Item Icons [Rogue Adventure]/Item Icons/RA_Item_Icons_New.png'
RPG = 'extra_assets/16x16_RPG_Pack_v3.0_packed_no_background.png'


def effect(name):
    # Six columns of native 32px animation cells: frame 4 is a complete icon
    # before its exit fade. Avoid the tiny entrance frames and blank tails.
    return VFX + name + '.png', [128, 0, 32, 32]


def spell(family, name):
    return SPELL.format(family) + name + '.png', [128, 0, 32, 32]


def tile(source, col, row):
    return source, [col * 16, row * 16, 16, 16]


# Stable semantic ordering: condition rows, context rows, buff rows, shrine
# boons. Shared source rectangles intentionally share an atlas frame.
ICONS = {
    'burning': (*spell('Fire', 'Fireball'), 'Orange flame'),
    'poison': (*tile(RA, 27, 5), 'Purple poison flask'),
    'confused': (*effect('Slow_Glow'), 'Disorienting violet ring'),
    'jellyfish_stun': (*spell('Light', 'Lightning_Bolt01_Y'), 'Yellow electrical shock'),
    'frozen': (*spell('Ice', 'Frozen_Crystal'), 'Complete blue ice crystal'),
    'paralysis': (*spell('Light', 'Lightning_Bolt01'), 'Blue electrical shock'),
    'pinned': (*effect('Speed_Down'), 'Red immobilized boot'),
    'blinded': (*effect('Accurracy_Down'), 'Red impaired eye'),
    'slowed': (*effect('Slow'), 'Violet slowing ring'),
    'boss': (*tile(RA, 7, 30), 'Red horned boss visage'),
    'portal': (*effect('Haste'), 'Green return ring'),
    'dragon': (*tile(RA, 3, 30), 'Red horned dragon visage'),
    'shadow': (*tile(RA, 4, 26), 'Dark hood'),
    'moonbeam': (*tile(RA, 24, 23), 'Blue light feather'),
    'evertorch': ('extra_assets/Dungeon Gathering Full Ver. 1.1/Torch/Torch Blue.png', [0, 0, 16, 16], 'Enduring blue flame torch'),
    'torch': ('extra_assets/Pixel Plains/PP Interiors Pack/Torch 1.png', [0, 0, 16, 32], 'Lit flame torch'),
    'frostAura': (*spell('Ice', 'Frostball_Cast'), 'Frost orb and surrounding aura'),
    'blight': (*tile(RPG, 32, 12), 'Violet blight skull'),
    'speed': (*effect('Speed_Up'), 'Boot with increase arrow'),
    'protection': (*effect('Protect_Up'), 'Protective blue barrier'),
    'immortal': (*effect('Resistance_Up'), 'Resistance cycle with increase arrow'),
    'fireResistance': (*tile(RPG, 33, 20), 'Red protective shield'),
    'flight': (*tile(RPG, 29, 9), 'White wing'),
    'shrinking': (*tile(RA, 19, 22), 'Blue decrease arrow'),
    'giant': (*tile(RA, 17, 24), 'Gold increase arrow'),
    'stoneskin': (*effect('Defense_Up'), 'Armoured fist with increase arrow'),
    'shield': (*effect('Block_Up'), 'Shield with increase arrow'),
    'reach': (*effect('Aim_Up'), 'Extended targeting reticle'),
    'skeleton': (*tile(RPG, 31, 11), 'Bone skull'),
    'wraith': (*tile(RPG, 32, 10), 'Spirit skull'),
    'raven': (*tile(RA, 24, 25), 'Golden spirit feather'),
    'coffee': (*effect('Haste_Glow'), 'Energizing haste ring'),
    'dawnfruit': (*tile(RA, 21, 2), 'Bright golden fruit'),
    'lettuce': (*effect('Luck_Up'), 'Lucky green clover'),
    'fish': (*tile(RA, 16, 4), 'Blue fish'),
    'bike': (*effect('Speed_Up'), 'Travel speed boot'),
    'field_scope': (*tile(RA, 20, 22), 'Blue discovery reticle'),
    'wayfarer': (*tile(RA, 20, 24), 'Golden directions reticle'),
    'compass': (*tile(RA, 20, 26), 'Green compass reticle'),
    'treasure': (*tile(RPG, 31, 9), 'Treasure chest'),
    'mining': (*tile(RPG, 1, 10), 'Mining pick'),
    'hidden': (*tile(RA, 5, 26), 'Dark concealing hood'),
    'melee': (*effect('Attack_Up'), 'Sword with increase arrow'),
    'fortune': (*tile(RPG, 41, 17), 'Golden lucky clover'),
    'work': (*tile(RA, 22, 25), 'Golden working tool'),
    'regen': (*effect('Health_Up'), 'Mending heart with increase arrow'),
    'wand': (*effect('Magic_Up'), 'Magic wand with increase arrow'),
}


def source_root(explicit):
    if explicit:
        return Path(explicit).expanduser().resolve()
    if (ROOT / 'extra_assets').exists():
        return ROOT
    common = subprocess.check_output(
        ['git', 'rev-parse', '--git-common-dir'], cwd=ROOT, text=True).strip()
    return (ROOT / common).resolve().parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-root')
    args = parser.parse_args()
    sources = source_root(args.source_root)
    frames, unique, entries = {}, {}, []
    for semantic, (source, rect, meaning) in ICONS.items():
        key = (source, tuple(rect))
        if key in unique:
            frames[semantic] = unique[key]
            continue
        frame = len(entries)
        unique[key] = frames[semantic] = frame
        path = sources / source
        image = Image.open(path).convert('RGBA')
        x, y, w, h = rect
        assert x >= 0 and y >= 0 and x + w <= image.width and y + h <= image.height, source
        crop = image.crop((x, y, x + w, y + h))
        bounds = crop.getchannel('A').getbbox()
        assert bounds is not None, semantic + ': empty source frame'
        ink = crop.crop(bounds)
        assert max(ink.size) <= CELL, semantic + ': source frame exceeds cell'
        entries.append({'frame': frame, 'source': source,
                        'sourceSha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                        'crop': rect, 'inkBounds': list(bounds),
                        'destination': [(CELL - ink.width) // 2, (CELL - ink.height) // 2],
                        'meaning': meaning, '_ink': ink})
    width, height = COLS * CELL, ((len(entries) + COLS - 1) // COLS) * CELL
    atlas = Image.new('RGBA', (width, height))
    for entry in entries:
        x, y = entry['destination']
        atlas.paste(entry.pop('_ink'), ((entry['frame'] % COLS) * CELL + x,
                                      (entry['frame'] // COLS) * CELL + y))
    OUT.mkdir(parents=True, exist_ok=True)
    atlas.save(OUT / 'status-icons.png')
    metadata = {'src': 'assets/Icons/StatusEffects/status-icons.png', 'cellSize': CELL,
                'cols': COLS, 'width': width, 'height': height, 'frames': frames}
    manifest = {**metadata, 'method': 'Unscaled native source pixels, alpha-trimmed and centered; static frames only.',
                'credits': ['ElvGames: Buff and Debuff Pixel VFX, elemental Spell VFX, Rogue Adventure item icons.',
                            '16x16 RPG Pack v3.0: original supplemental packed source.',
                            'Dungeon Gathering Full Ver. 1.1: enduring blue flame torch.',
                            'Pixel Plains PP Interiors Pack: lit flame torch.'],
                'entries': entries}
    (OUT / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    (ROOT / 'src/status_icons.js').write_text(
        '// Generated by tools/build_status_icons.py; source crops and credits live in the atlas manifest.\n'
        'globalThis.StatusIcons = Object.freeze(' + json.dumps(metadata, indent=2) + ');\n')
    print(f'{len(frames)} semantic ids; {len(entries)} native frames; {width}x{height}, {CELL}px cells')


if __name__ == '__main__':
    main()
