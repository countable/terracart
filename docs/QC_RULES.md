# QC Rules — Art & Asset Checklist

A checklist of the art/asset bugs that **actually recur** in this project. It
complements CLAUDE.md, which owns the mechanic invariants (seat pass, painter
rule, camera vs player, lighting, …) — where the two overlap, CLAUDE.md wins.
Source comments cite this file by section (`QC_RULES §1`, `§3`, `§4`), so keep
the numbering stable.

The single most common class of bug here is **the same item showing the wrong
art** (or no art) on one of its surfaces:

- **map** (in-world Phaser sprite)
- **inventory / item bar** (DOM CSS-background tile)
- **shops, traders, deliveries** (offer/sell modals)
- **tooltip / splash / pickup-toast popups**

These surfaces draw from different code paths, so art that looks right in one
place is routinely wrong in another. Walk this list before committing any
change that touches a sheet, frame index, item id, scale, or placement.

---

## 1. New / changed item icon — verify ALL surfaces

An item's icon resolves through `inventoryIconSource()` (items.js) →
`renderItemIcon()` (app.js), which clips a frame out of the module-scope
`ICON_SHEETS` table (app.js). A frame that exists in one table but not the
other renders as the **wrong sprite, not an error**.

- [ ] **Two-table rule:** a non-crop icon needs BOTH a row in
      `MINERAL_ICON_SHEET` (items.js) AND a matching `sheet` key in
      `ICON_SHEETS` (app.js). A missing sheet key silently falls through to
      `ICON_SHEETS.crops` → renders as a random crop. *(Real bugs: sapphire
      rendered as rainberry stage-4; bars rendered as a grass sprout.)*
      `test/node/run.js` hands the tests `pngDims` so the PNG behind each
      `ICON_SHEETS` row is checked against the size the row claims.
- [ ] **Sheet geometry matches the file:** `cols`, `srcW`, `srcH` equal the real
      PNG's column count and pixel dimensions. Frame math is
      `col = frame % cols; row = floor(frame / cols)` — a wrong `cols` shifts
      every frame.
- [ ] **Frame index points at non-empty art** — not a blank cell, a mask row,
      or a half-clipped neighbour. For wildplants this is automated:
      `tools/sprite_audit.js` › `wildFrameRows` decodes every frame a
      `CROP_SPRITE` entry declares.
- [ ] **List the frames, never count the cells.** A `CROP_SPRITE` entry
      declares `frames: [...]`, never a bare `variants` count (CLAUDE.md's
      frame-index rule). *(Real bug: `shell` declared `variants: 12` on a sheet
      with three shells — 62 % of beach shells drew nothing.)*
- [ ] **Inventory icon == map sprite** for the same item where both exist. If
      they differ on purpose, say so in a comment so it doesn't drift.
- [ ] **Render it in a shop/trader offer AND the inventory bar AND a pickup
      toast.** Baked snapshots in `window.ITEM_DATA_URLS` take priority over
      the sheet path, so a baked item can look right in one surface and wrong
      in another.
- [ ] **Items ALWAYS use game art, never emoji — in every context.** Emoji is
      for non-item UI only (energy ⚡, menu ☰, sparkle effects). A surface that
      can't host a sprite (plain-text Phaser toast) shows the item's **name**.
      `renderItemIcon`'s fallback is a neutral `·` / `?`, never `item.icon`, so
      a missing sprite shows as a gap; item rows carry no `icon:` field at all
      (`powders.test.js`, `torch.test.js`). An EMPTY inventory slot is not a
      missing sprite and must not wear the `·`.

## 2. Scale consistency (map)

- [ ] **New creature/object scale is sane against its neighbours.** Cross-check
      against the cow (the visual size anchor). Creature scale lives in
      `SpriteLayout.CREATURE_ART`, not a per-call literal.
- [ ] **A 32×32 sheet and a 16×16 sheet at the same `scale` are NOT the same
      display size.** Set scale relative to the frame size.

## 3. Placement / origin / depth (map)

- [ ] **Object sits in its own cell.** Give its `RENDER_SPEC` entry
      `seat: true` and let `seatInCell` + `ART_BOUNDS` (sprite_layout.js) place
      it; regenerate bounds with `node tools/sprite_audit.js --emit-bounds`
      when art changes (CLAUDE.md's one-cell rule).
- [ ] **Overlays anchor to the sprite, not the cell corner** — labels, signs,
      footprints, produce-on-rock, the work wheel (crown rule).
- [ ] **Nothing on the ground draws over the player.** The player sprite sits
      at depth 10; ground decals go below it. Labels that must read over
      buildings draw above, so any label overlapping the player fades
      (`LABEL_OVER_PLAYER_ALPHA`, render.js).
- [ ] **One interactable per cell.** Every spawner passes `opts.occupied` and
      `opts.roadMask` to `WorldGen.isSpawnCell`; a second interactable in a
      cell is an untappable ghost.
- [ ] **Post-pass edits look up the RIGHT cell.** Index/coord drift in a
      post-processing pass places art on the wrong tile. Pack cells as
      `cy * w + cx`.

## 4. Item id vs display name vs sheet (data integrity)

- [ ] **Item id is stable for save-compat; display name can change freely.**
      *(id `longgrass` shows "Fern"; `rockfruit` shows "Rock".)* A raw internal
      id must never reach the screen — toasts and flashes print the name.
- [ ] **Don't hand out a removed item id.** Crates/loot/shops referencing a
      retired id give nothing or crash.
- [ ] **Crop sprite overrides are coherent:** a `CROP_SPRITE` row/frame must
      match the crop's actual sheet, and the seed/produce column logic must
      line up with that sheet's layout.

## 5. Shops / traders / deliveries (semantics, not just art)

- [ ] **Right shop does the right thing.** Selling is **Home-only**; themed
      shops (role `market`) sell one line for **cash**; traders **barter**
      (with re-roll); plain houses take **deliveries** (a full wanted set);
      forts run the slot machine. Don't add sell flows to non-Home shops.
- [ ] **Offer icons go through `renderItemIcon`** — never a hardcoded
      sheet/frame in a modal. Gear goes through `gearIconHTML()`. A dialog about
      a map object passes that object's sprite as `kindIcon` (CLAUDE.md).
- [ ] **A trader never offers to swap an item FOR the same item.**
- [ ] **Building sprite/label matches its role** (blacksmith / market / trader
      / wizard / fort / Home).

## 6. Tooltip / splash / pickup-toast popups

- [ ] **Toast icons use the DOM renderer**, appended as a child element — not a
      Phaser sprite (which needs preload and shows broken textures).
- [ ] **Dwell time is intentional** (~2 s for tooltip/splash). Don't regress it.
- [ ] **The safety splash's button is the sensor-permission gesture.**
      Compass/GPS permission is requested from that click — don't move the
      request off it or auto-dismiss the splash.
- [ ] **A message on the map is ≤ 30 characters** (`MAP_MSG_MAX`, CLAUDE.md).

## 7. Click targets & reachability (interaction)

The symptom: a target you can SEE, that looks in range, doesn't respond — or
responds with "too far" or the wrong action.

- [ ] **Lit ⇔ tappable.** `cellInReach()` (coords.js) is the single source for
      BOTH the lit plateau (lighting.js) and the tap gates (interact.js
      `tooFar`, cell-resolve). Never recompute reach in either place.
- [ ] **Reach is measured from the FEET.** The feet sit on the GPS fix
      (`feetOffsetM` is 0; the sprite is raised by `playerFeetNudgeY`), and
      `playerReachCell()` is the origin — never the camera anchor.
- [ ] **Handler priority can swallow a valid tap.** `TAP_HANDLERS`
      (interact.js) is priority-ordered and the first handler returning `true`
      consumes the tap. The `creature` handler claims any tap inside a
      creature's DRAWN box (vertically `SpriteLayout.creatureTapSpanPx`, read
      off `CREATURE_ART` — the row the renderer draws from, never a second
      table), so a tap on a tree behind an animal hits the
      animal. When adding/reordering handlers, confirm no visible, in-range
      target becomes unreachable. *(Real bug: fishing was dead while a watering
      can was owned — the since-retired `can-refill` handler claimed every
      water tap first; `interact_tap.test.js` pins the fix.)*
- [ ] **The TAP is the CELL.** Non-creature objects are hit through
      `sameAbsCell` against their data cell; the art must agree with it.
      `test/tests.js` › `one-interactable-per-cell invariant` and
      `REG #11: chest position aligns with cellAt()` guard it in the browser
      harness.

## 8. Before you commit

- [ ] **Run `node test/node/run.js`** (it includes `tools/sprite_audit.js`).
- [ ] **Cache-bust is derived, never typed:** the parent runs
      `node tools/cachebust.js --write` once after the last edit.
- [ ] **Drive the change in `?sandbox=true`** (docs/SANDBOX.md) and eyeball the
      item on every relevant surface (map, item bar, shop, toast).
- [ ] **Shared-logic invariants didn't drift.** Where one helper backs two
      behaviours (e.g. `cellInReach()` for the light AND the tap), confirm both
      still agree.
