#!/usr/bin/env python3
"""Export the three guild badge icons (items.js GUILD_BADGES).

Each badge is a heraldic crest from the game's RPG icon pack with its guild's
emblem stamped on the field: a hammer for the smiths, a coin for the
marketeers, a pair of exchanging arrows for the traders. Output: 16x16 single-frame PNGs in
assets/Icons/Items, the carried-treasure icon contract (carried_item_art test).
Rebuild with `python3 tools/export_guild_badges.py` (requires Pillow).
"""
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
PACK = ROOT / "assets/Icons/RPG icons/Extras/16x16_RPG_Pack_v3.0_packed_no_background.png"
DEST = ROOT / "assets/Icons/Items"

INK = {
    "o": (40, 22, 26, 255),     # outline, the crest border's own dark
    "L": (232, 236, 240, 255),  # steel light
    "S": (150, 156, 172, 255),  # steel shade
    "W": (178, 118, 64, 255),   # handle wood
    "G": (255, 224, 102, 255),  # gold
    "g": (200, 144, 48, 255),   # gold shade
    "w": (255, 250, 220, 255),  # gold glint
}

# Emblems are drawn over the crest field, top-left at (3, 3).
HAMMER = [
    "..oooooo..",
    ".oLLLLLLo.",
    ".oSSSSSSo.",
    "..ooWWoo..",
    "....oWo...",
    "....oWo...",
    "....oWo...",
    ".....o....",
]
COIN = [
    "...oooo...",
    "..oGwGGo..",
    ".oGwGGGgo.",
    ".oGGgGGgo.",
    ".oGGgGGgo.",
    ".oGGGGggo.",
    "..oggggo..",
    "...oooo...",
]
TRADE = [
    "..o.......",
    ".oGooooo..",
    "oGGGGGGGo.",
    ".oGooooo..",
    "..o....o..",
    "..oooooLo.",
    ".oLLLLLLLo",
    "..oooooLo.",
    ".......o..",
]

BADGES = {
    # id: (pack cell (col, row), emblem)
    "smiths_guild_badge": ((33, 20), HAMMER),  # red crest
    "marketeers_guild_badge": ((34, 19), COIN),        # green crest
    "traders_guild_badge": ((34, 20), TRADE),      # blue crest
}


def main():
    pack = Image.open(PACK).convert("RGBA")
    for name, ((col, row), emblem) in BADGES.items():
        tile = pack.crop((col * 16, row * 16, col * 16 + 16, row * 16 + 16))
        for y, line in enumerate(emblem):
            for x, ch in enumerate(line):
                if ch in INK:
                    tile.putpixel((3 + x, 3 + y), INK[ch])
        tile.save(DEST / f"{name}.png")


if __name__ == "__main__":
    main()
