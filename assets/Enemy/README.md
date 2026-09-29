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

Current 16×16 enemies cycle the four front-idle frames. Plants also use
the attack frames declared by their roster rows; consolidation preserves both. `src/enemy_roster.js` owns sheet paths; `SpriteLayout.creatureArt`
owns the frames and rendering geometry. Add future animation states by naming
these frame ranges, without exporting duplicate PNG strips.

The 32×32 goblin and purple-slime sheets use different layouts; do not apply
this table to them. Goblins use their existing six-frame walk cycle.

Unused imported packs are still candidates, not part of the runtime roster.
Run `node tools/asset_inventory.js` to see references and unreferenced files.
