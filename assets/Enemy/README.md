# Enemy sheets

The 18 `1Fullsheet_*.png` files are the source and runtime art for the
16×16 enemy families. Each is 192×64: 12 columns and four rows. Their former
individual animation strips were verified as exact crops and removed.

| Animation | Front frames | Side frames | Back frames |
| --- | --- | --- | --- |
| Idle | 0–3 | 4–7 | 8–11 |
| Move | 12–15 | 16–19 | 20–23 |
| Attack | 24–27 | 28–31 | 32–35 |
| Death | 36–39 | 40–43 | 44–47 |

Full-sheet enemies select front, back and side poses from their movement or
attack direction. Side art faces left and is mirrored for right. Moving enemies
use move frames, stationary enemies use idle frames, and timed attacks use the
matching attack row. They retain their last facing when stopped.
`src/enemy_roster.js` explicitly opts each verified sheet into its layout;
`SpriteLayout.creatureAppearance` owns frame and mirror selection. Add animation
states here without exporting duplicate PNG strips.

The 32×32 goblin sheet instead has six front walk frames, six back walk frames,
and six right-facing side walk frames. Goblins walk without procedural bounce;
when idle they hold the first pose. Their sheet has no separate attack cycle.
Purple and fire slimes retain their existing hop/cycle and horizontal mirroring:
no directional layout is assumed for art that has not been verified.

Unused imported packs are still candidates, not part of the runtime roster.
Run `node tools/asset_inventory.js` to see references and unreferenced files.

## Preview at game scale

Serve the repository over HTTP and open `tools/enemy-preview.html`. The page
loads the game modules through `tools/game-loader.js` without starting a game.
It shows every roster variant plus the fire slime on a 32-pixel reference grid.
At 100% browser zoom, one CSS pixel represents one game logical pixel.

Direction, idle/move/attack, animation, and instance size controls feed the same
`SpriteLayout.creatureAppearance` and `creatureScale` helpers used by the game.
Sheet palettes, multiply tints and opacity also come from runtime definitions.
The captions distinguish authored directional states from legacy cycles; the
preview does not invent missing art. Scene lighting, shadows and temporary
combat flashes are outside this body preview.

Use **Export current view** to save a standalone HTML snapshot with its images
embedded. The snapshot preserves the selected frame and scale, and needs no
game files or server. The live tool retains the controls and animation.

Enemy sizes are tuned per roster row through `artScale`. The 16px enemies
previously drawn at 2× now draw at 1.5×; Giant Lich is 2.4× and Giant Skeleton
is 1.68×. Mini Spider, Giant Spider and Giant Plant retain their prior sizes
through explicit variant multipliers, so shrinking their parents does not
also shrink them. Instance multipliers still apply on top of these sizes.
Mini Vampire Bat is retired; the regular Vampire Bat retains its shared sheet.
