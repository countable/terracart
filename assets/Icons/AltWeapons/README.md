# Alternate weapon icons

Each runtime PNG is a transparent 32×16 strip containing two identical 16×16
frames, matching the equipment icon contract. Directories `1`, `3`, and `5`
are Rusty, Fine, and Magic, respectively.

Dagger and lance are exported from the existing RPG icon pack at
`../RPG icons/Extras/16x16_RPG_Pack_v3.0_packed_no_background.png`. Exact
zero-based source cells are recorded in `tools/export_alt_weapons.py`.

Musket sprites were generated with OpenAI imagegen on October 2, 2026 after
searching existing CC0 packs, including Sogomn's **Weapons**:
https://opengameart.org/content/weapons-4 . That pack was inspected but is not
included: it lacked the three requested material treatments.

The generated three-column sheet was cropped to its visible sprites and
downsampled with nearest-neighbor sampling into `source/muskets.png`, a 48×16
input retained for the export script. Its columns are Rusty (brown/orange),
Fine (steel/wood), and Magic (blue/violet). The archived master lives at
`~/.artifacts/terracart-art/art-source/sprites/alt-weapons/muskets-master.png`.

Rebuild with `python3 tools/export_alt_weapons.py` (requires Pillow).
