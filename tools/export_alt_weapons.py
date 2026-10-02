#!/usr/bin/env python3
"""Export alternate weapon icons from the game's RPG pack and musket sheet."""
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "assets/Icons/AltWeapons"
PACK = ROOT / "assets/Icons/RPG icons/Extras/16x16_RPG_Pack_v3.0_packed_no_background.png"


def strip(tile, path):
    """Gear's normal/alternate frame contract, with identical static frames."""
    out = Image.new("RGBA", (32, 16))
    out.paste(tile, (0, 0))
    out.paste(tile, (16, 0))
    path.parent.mkdir(parents=True, exist_ok=True)
    out.save(path)


def main():
    pack = Image.open(PACK).convert("RGBA")
    muskets = Image.open(DEST / "source/muskets.png").convert("RGBA")
    # Explicit source cells: never infer populated frames from sheet dimensions.
    for tier, cells in {
        1: {"Dagger": (4, 10), "Spear": (0, 21)},
        3: {"Dagger": (4, 13), "Spear": (3, 21)},
        5: {"Dagger": (4, 14), "Spear": (4, 21)},
    }.items():
        for name, (col, row) in cells.items():
            tile = pack.crop((col * 16, row * 16, col * 16 + 16, row * 16 + 16))
            strip(tile, DEST / str(tier) / f"{name}.png")
        col = {1: 0, 3: 1, 5: 2}[tier]
        strip(muskets.crop((col * 16, 0, col * 16 + 16, 16)), DEST / str(tier) / "Musket.png")


if __name__ == "__main__":
    main()
