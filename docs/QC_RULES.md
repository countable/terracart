# QC Rules — Art & Asset Checklist

A checklist of things that **actually break** in this project, derived from the
commit history and play-test findings. The single most common class of bug here
is **the same item showing the wrong art** (or no art) on one of its surfaces:

- **map** (in-world Phaser sprite)
- **inventory / item bar** (DOM CSS-background tile)
- **shops, traders, deliveries** (offer/sell modals)
- **tooltip / splash / pickup-toast popups**

These four surfaces draw from different code paths, so art that looks right in
one place is routinely wrong in another. Walk this list before committing any
change that touches a sheet, frame index, item id, scale, or placement.

---

## 1. New / changed item icon — verify ALL surfaces

When you add an item or repoint its art, the icon resolves through
`inventoryIconSource()` (items.js) → `renderItemIcon()` `SHEETS` table (app.js).
A frame that exists in one table but not the other renders as the **wrong
sprite, not an error**.

- [ ] **Two-table rule:** a non-crop icon needs BOTH an entry in
      `MINERAL_ICON_SHEET` (items.js) AND a matching `sheet` key in the `SHEETS`
      table inside `renderItemIcon` (app.js ~line 4301). Missing the `SHEETS`
      entry silently falls through to `SHEETS.crops` → renders as a random crop.
      *(Real bugs: sapphire rendered as rainberry stage-4 "berry bush"; bars
      rendered as a grass sprout in smith/shrine modals.)*
- [ ] **Sheet geometry matches the file:** `cols`, `srcW`, `srcH` in the `SHEETS`
      entry equal the real PNG's column count and pixel dimensions. Frame math is
      `col = frame % cols; row = floor(frame / cols)` — a wrong `cols` shifts
      every frame.
- [ ] **Frame index points at non-empty art.** Confirm the chosen frame isn't a
      blank cell or a half-clipped neighbour. *(Real bugs: mushroom frame 0 was
      empty → switched to frame 2/35; frame 36 was a different clipped prop.)*
- [ ] **Inventory icon == map sprite** for the same item where both exist. If the
      world object uses a different sheet than the inventory icon, that's a
      deliberate choice — note it, don't let it drift. *(Real bug: shrub's
      inventory icon fell back to crops.png row 1 = pairy fruit; longgrass used a
      retired procedural texture.)*
- [ ] **Render it in a shop/trader offer AND the inventory bar AND a pickup
      toast.** Don't trust one surface. The pickup toast and offer modals both go
      through `renderItemIcon`, but `ITEM_DATA_URLS` (baked snapshots:
      longgrass/chicken/cow/wood/fauna) takes priority over the sheet path — so a
      baked item can look right as a toast and wrong in a shop, or vice-versa.
- [ ] **Items ALWAYS use game art, never emoji — in every context they appear.**
      Hard rule. An item must render as its sprite on every surface: map, the
      house delivery plaque, inventory/item bar, shop/trader/offer modals, and
      pickup/flash toasts. Emoji is reserved for non-item UI only (energy ⚡,
      currency 🪙, menu ☰, sparkle/burst effects). If a surface can't host a
      Phaser sprite or CSS-background tile (e.g. plain-text Phaser toasts),
      show the item's **name**, never its emoji. The `renderItemIcon` fallback
      returns a neutral `·`/`?` (NOT `item.icon`) precisely so a missing sprite
      source surfaces as a visible gap instead of silently masking as an emoji.
      *(Real bugs: scarecrow showed a 🪦 headstone; catch/trade/release/harvest
      toasts and house signs carried emoji item glyphs — all replaced with the
      sprite or name.)*

## 2. Scale consistency (map)

- [ ] **New creature/object scale is sane against its neighbours.** Sprites share
      cells; mismatched scale reads as "broken/giant". Cross-check against the
      cow (the visual size anchor). *(Endless real churn: chicken 2→1.5→0.75,
      deer/cow 1.1→1.65→1.3, fort scaled down ~3×, mushroom 32×32@2 was twice
      every other prop.)*
- [ ] **A 32×32 sheet and a 16×16 sheet at the same `scale` are NOT the same
      display size.** Set scale relative to the frame size, not copy-pasted from
      another entry.

## 3. Placement / origin / depth (map)

- [ ] **Object sits in its own tile.** Check the `origin` (e.g. `[0.5, 0.95]` for
      foot-anchored buildings/trees) and any y-nudge. *(Real bugs: trees lowered
      half a cell; houses sit 5px lower; seed centered in cell.)*
- [ ] **Overlays anchor to the sprite, not the cell corner** — labels, signs,
      footprints, water-timer, produce-on-rock. *(Real bugs: footprint y offset
      tuned to the feet; house signs moved to foot-of-building; rockfruit icon
      rendered on top of the rock tile.)*
- [ ] **Depth ordering:** player `setDepth(10)` so ground decals (footprints)
      can't draw over the character. New decals need a depth below sprites.
- [ ] **One interactable per cell.** Worldgen and OSM injection must enforce it;
      a second interactable in a cell creates an untappable/ghost object. *(Real
      bugs: "Enforce one-interactable-per-cell", OSM tree injection.)*
- [ ] **Post-pass edits look up the RIGHT cell.** Index/coord drift in a
      post-processing pass places art on the wrong tile. *(Real bugs: "residential
      rocks post-pass was looking up the WRONG cell"; "houses rendering as tilled
      soil after GPS jump".)*

## 4. Item id vs display name vs sheet (data integrity)

- [ ] **Item id is stable for save-compat; display name can change freely.**
      Renaming art does NOT mean renaming the id. *(Real bugs: id `longgrass`
      shows "Fern"; `rockfruit` shows "Rock".)*
- [ ] **Don't hand out a removed item id.** Crates/loot/shops referencing a
      retired id give nothing or crash. *(Real bug: starter crate gave removed
      'tree' item → fixed to 'wood'.)*
- [ ] **Crop sprite overrides are coherent:** `CROP_SPRITE` (springcrops vs
      crops vs custom-prop) row/frame must match the crop's actual sheet, and the
      seed/produce column logic (`col 7 seed / col 8 produce` for springcrops;
      `col 8 / col 7` for crops.png) must line up.

## 5. Shops / traders / deliveries (semantics, not just art)

- [ ] **Right shop does the right thing.** Selling is **Home-only**; markets pay
      **cash**; traders **barter** (with re-roll); plain houses buy a **full
      wanted set** at full price. Don't reintroduce sell flows in non-Home shops.
- [ ] **Offer icons go through `renderItemIcon`** so shop/trader/inventory stay in
      sync — never hardcode a sheet/frame in a modal. Same for gear:
      `gearIconHTML()` keeps Stats + Offer modals identical.
- [ ] **A trader never offers to swap an item FOR the same item.** Guard the
      barter roll.
- [ ] **Building sprite/label matches its role** (blacksmith/market/trader/fort/
      Home) and the label color/placement convention is intact.

## 6. Tooltip / splash / pickup-toast popups

- [ ] **Toast icon uses the DOM renderer**, appended as a child element — not a
      Phaser sprite (which needs preload and shows broken textures).
- [ ] **Dwell time is intentional.** Tooltip/splash hold ~2s (user feedback:
      "a little too quick"). Don't regress the timing.
- [ ] **The safety splash's dismiss button is the sensor-permission gesture.**
      Compass/GPS permission is gated behind that click — don't move permission
      requests off it or auto-dismiss the splash.

## 7. Click targets & reachability (interaction)

The symptom class: a target you can SEE, that looks in range, doesn't respond —
or responds with a "too far" flash or the wrong action. Several distinct causes,
all real bugs that have shipped here:

- [ ] **Reach outline ⇔ tap-accept must agree.** `cellInReach()` is the single
      source of truth for BOTH the lit reach silhouette (render.js) AND the tap
      "too far" gate (interact.js). If a cell that's *inside the range indicator*
      flashes "can't reach", or an unlit cell accepts a tap, the two callers have
      diverged — never recompute reach independently in either place.
- [ ] **Reach is FEET-anchored, not the sprite head.** `playerReachCell()` /
      the tap proximity tests measure from the player's feet cell (`feetOffsetM`
      ≈ 3.75 m south of the body), not the sprite centre. A tap on the visible
      head can miss. Keep the tap target and the reach origin on the same anchor.
- [ ] **Handler priority can swallow a valid tap.** `TAP_HANDLERS` is
      priority-ordered; the first handler that returns `true` consumes the tap.
      A creature within `REACH_CREATURE_M` (4 m) claims the tap before
      wildplant/object/cell — so tapping a tree next to a chicken can flash
      "needs Rainberry" instead of chopping. A passive handler can also shadow a
      later one entirely. When adding/reordering handlers, confirm no visible,
      in-range target becomes unreachable. *(Real bug: fishing was dead while a
      watering can was owned — `can-refill` claimed every water tap first.)*
- [ ] **No invisible cell collision.** A second interactable dropped on an
      occupied cell becomes an untappable ghost (the tap resolves to the first).
      Enforce one-per-cell at worldgen/injection time (see §3). The
      `one-interactable-per-cell` test in `test/tests.js` guards this — run it.
- [ ] **Coordinate basis stays consistent.** `cellAt()`,
      `worldMetersToAbsCell()`, and the object's stored cell must agree, or a tap
      lands on a neighbour cell. *(REG #11 chest-centre test guards chest coords;
      a GPS-jump once put houses on the wrong cell. NOTE: these tile-iterating
      tests are timing-flaky in the headless preview — re-run before trusting a
      red.)*

## 8. Before you commit

- [ ] **Bump the `?v=NN` cache-bust** in `index.html` for every changed JS module
      (parent agent only — see CLAUDE.md). Stale cache = "my fix didn't work".
- [ ] **Drive the change in `/?sandbox=true`** and eyeball the item on all
      relevant surfaces (map, item bar, shop, toast). The interaction sweep
      (`test/findings/`) is the model: walk every path the change touches.
- [ ] **Shared-logic invariants didn't drift.** Where one helper backs two
      behaviours (e.g. `cellInReach()` for the visual outline AND the tap test),
      confirm both still agree.
