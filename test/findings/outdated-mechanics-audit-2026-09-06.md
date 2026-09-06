# Outdated-mechanics audit — 2026-09-06

What in the tree is a survivor of a mechanic that has since been replaced, and
what should be retired. Every claim below was verified by whole-tree grep
(`src/`, `test/`, `tools/`, `index.html`, `sw.js`); where deadness could not be
proved, it says so.

## Method

- `node test/node/run.js` → **1912 passed, 0 failed** (baseline, green).
- `node tools/sprite_audit.js` → **all clean** (23 sprites, 13 wheels, 2 crowns).
- **The browser harness was run**, which is new: it needs live OpenFreeMap
  tiles, and this environment's egress policy blocks `tiles.openfreemap.org`,
  so `test/run_tests.py` dies on `start tile never loaded`. Pointing it at
  `harness.html?sandbox=true` builds the start tile from `src/sandbox.js`
  instead and the suite runs offline: **106 passed, 30 failed (136 total)**.
  This is the single most useful thing in this document — see §1.
- Four parallel read-only sweeps over disjoint file sets, plus scripted sweeps
  for exports with no external reference and `save.*` fields written but never
  read.

---

## 1. The browser suite has rotted, because nothing can run it

`test/node/README.md` still says the browser harness is the home for anything
needing a live Phaser scene. It has not been run in a long time, and 30 of its
136 tests now fail. Twenty of those are the audit's biggest single cluster of
retired mechanics; ten are artifacts of the sandbox fixture.

**Retired mechanics still pinned by `test/tests.js`:**

| Tests | Subject | Status in `src/` |
|---|---|---|
| 11 (`tests.js:3096–3355`, the whole tail of the file) | **Magic Crafting Shrine** — `shrineLevelUpCost`, `shrineTransforms`, `shrineInteract`, `_trySpawnShrineOnTile`, `save.shrineLevel/shrine/shrineReplacedId`, `kind: 'shrine'` | **All zero hits.** `test/node/gear.test.js:134`: "The crafting shrine was removed — smelting is always available at the blacksmith." Only the `shrine` *texture key* survives, as wizard-tower art (`render.js:2575`). |
| 2 | **Watering-can charges** — `save.canCharges` 50→49, `p.canBoost` | Zero hits. `test/node/crops.test.js:243` **asserts their absence**: "the refill charge bank retired with the bonus it fed". The node suite and the browser suite assert opposite things. |
| 1 | Castle "always offers relics with no rate-limit" | Replaced by the daily rest/tax favour. |
| 1 | "a weapon shortens the [hunt] queue" — expects 4000 ms, gets 9000 | **Net-only hunting.** `interact.js:636–650`: the hunt wheel reads the `bugnet` slot; bare hands are 9000 ms. `interact.js:640` is the only surviving mention of the weapon rule. |
| 1 | Reach shape is a "rounded square" including (±1,±3) | Retired 16 m gate. Reach is now `coords.js:202` `reachCells()` — a Euclidean 2.5–5.5 cells, energy-gated, trimmed half a cell per depth. |
| 1 | `blacksmithRecipe`: ring T7 gem = ruby | `gear.js:106–107` `JEWELRY_FROST_TIER`/`JEWELRY_FROST_GEM`: **every** jewelry slot is cut around diamonds at T7. |
| 1 | Immature crop tap → `"Potato 2/5"` | Now `"💧 watered by hand — Potato Sprout — 15m"`. |
| 1 | cat + longgrass yuck consumes the item | Yuck now goes through `confirmFeed` (`interact.js:817`), so the first tap confirms. |
| 1 | tame cow + plant produce → milk | Behaviour changed; not re-derived here. |

**Not rot — sandbox-fixture artifacts** (the hand-laid sandbox map has no
starter wildplant/chest where these scan): 3 wildplant, 3 chest, 3 mineralrock
(a Phaser `add.text` null-context throw). One is **unresolved**: `REG #11:
chest position aligns with cellAt()` reports 12 chests off their resolved cell
centre. Sandbox seats objects at `tx*tileEdgeM + (ix+0.5)*cellM`
(`sandbox.js:396`) while `absCellCenterMeters` goes through `originPx`/`mPerPx`
— plausibly a fixture basis mismatch, but it could not be separated from a real
drift without a live-tile run.

**Recommendation.** Delete the shrine block and the two watering-can blocks;
update the eight behaviour-changed tests; then **make `?sandbox=true` the
harness's default (or a CI mode)** so this suite is runnable without network.
An unrunnable suite is worse than no suite: it accumulates assertions that
contradict the shipping code and the node suite alike.

---

## 2. Dead code — proved unreferenced

| Anchor | Symbol | Evidence |
|---|---|---|
| `render.js:203` | `peekPxOf(scene)` | One hit tree-wide: its own definition. Every slid layer now positions from `overlayFrame`'s `fracX/fracY`. |
| `render.js:3476` | `_houseProduceWanted` | One hit. The produce-sign block inlines the same expression at `render.js:3600–3602`. |
| `render.js:790, 808` | `_washTint` / `Render.reachDimTint` | The only `Render.*` export with no production consumer. Its former consumer, `Render.spriteTint`, lost it in the lightmap change — and `lighting.test.js:433` now *asserts it is absent*. Kept alive solely by `wreck_dim.test.js:83,85`. |
| `worldgen.js:2361, 2368` | `_residential` object flag | 5 hits: two writes, one `delete` (`:3057`), two comments. **No read anywhere.** "Preserved for telemetry" that nothing collects, deleted before it can leave the tile. |
| `worldgen.js:3854` | `entry.fromCache` | Assigned, never read. (`tile_url.test.js:104` checks `fetchTileBytes`'s return value, not the entry field.) |
| `app.js:1369–1386` | `dragon_potion` strip + `save.gotDragonTestPowder` | `dragon_potion` exists nowhere else; the flag is write-only. Runs on every brand-new save, costing a boot-time `persistSave` to filter an id that cannot be present. Belongs in `savemigrate.js` per `app.js:1314–1318`, or gone. |
| `items.js:886` | `ITEM_EFFECTS.rock` | There is no item with `id: 'rock'`. The stone-fence placeable is **`rockfruit`** (`interact.js:1236`), whose display name is "Rock" — and which has **no `✦` line at all**. Re-key it. |
| `items.js:1231` | `pickDurationMs` | Back-compat alias; zero `src/` callers (everything uses `toolDurationMs(relics,'pick')`). Only `test/tests.js:2500` reads it. |
| `rarity.js:559–562` | `chestRelicAllowedTiers(progress)` | Returns `[1..7]` unconditionally; `progress` "kept for call-site compatibility" is unread and the sole caller (`rarity.js:569`) passes no argument. No call sites left to be compatible with. |
| `combat.js:246, 248` | `SHOT[].phaseMs` | `0` on both slots, self-documented as a no-op; its one reader is `app.js:6586` `now + 0`. |
| `util.js:397` + `index.html:165` | `UI_TREASURE_DEEP` / `--treasure-deep` | One hit each — the declarations. |
| `app.js:2499, 7126, 8557, 8657, 14450` | "debug pad" | Five comments; **no element, builder, CSS rule or toggle anywhere.** `app.js:2499` says the debug pad "is the only thing that ever takes [the stick's] slot"; `app.js:14168` says "Nothing takes its slot any more." |

**One-entry registry** (`textures.js:1249–1274, 1336–1346`, `loot.js:219`,
`render.js:3228–3236`): `PAD_SHAPES` has a single member, `round1`; the derived
`cols`/`rows` are always 1 so `setOrigin` is always `(0.5,0.5)`; `shape.round`
is never read; `padShapeKeyForPoi` is a boolean wearing a string.
`render.js:3231` already hardcodes `PAD_SHAPES.round1`. Three files carry a
lookup with a constant answer.

---

## 3. Drifted duplicates — the "one table both sides read" rule, broken

These are the shape CLAUDE.md warns about most (`roadOverlayWidthM`,
`PLAIN_ROCK_VARIANTS`). All three are live divergences, not stale prose.

### 3a. The creature TAP BOX has drifted from `CREATURE_ART` — a real gameplay bug

`interact.js:518–545` builds the creature tap box from its own hand-copied
table (`// keep in sync with render.js creaturePool`) plus a blanket
`ORIGIN_Y = 0.9`. The renderer draws from `SpriteLayout.CREATURE_ART`
(`render.js:3999–4007`). They no longer agree:

| kind | tap box `[fh, scale, lift]` | drawn `CREATURE_ART` |
|---|---|---|
| cow | 32, **1.50**, 0 | 32, **1.30**, 0 |
| butterfly | 16, 2.00, **8** | 16, 2.00, **15** |
| crow | 32, 1.30, **14** | 32, 1.30, **13** |

A cow's tap box is ~15% taller than the cow. `ORIGIN_Y = 0.9` is blanket where
`CREATURE_ART.foot` is per-kind (cow `32/32`, butterfly `12/16`). The history is
visible: `render.js:4024` still says "Bumped to 1.50" — the number moved into
the table and shrank, and only the tap box was left behind. And
`sprite_layout.js:217` claims "every consumer (… **interact.js's tap box**) goes
through it", which is false. Resolve the box through
`SpriteLayout.creatureArt(kind)`; keep only `HALF_W`, which has no equivalent.

### 3b. The campfire's repel ring is 4 cells; its light and warmth are 3

`app.js:1006` `FIRE_REST_R = 3` drives rest (`app.js:6271`) and light
(`lighting.js:136`), and `app.js:1012` states the invariant: "stand in the
light is stand in the warmth". The **ward** is a bare literal —
`app.js:7874` `this._nearAny('fires', tx, ty, 4)` — almost certainly copied
from the scarecrow's `4` nine lines above. `interact.js:1218` documents it as
"repels slimes within 4 m", wrong in both magnitude and unit (4 cells ≈ 28 m).
Home already gets this right on `HOME_R`. Either point the ward at
`FIRE_REST_R` or state deliberately that it is wider.

### 3c. Player-facing durations and tiers retyped instead of derived

`app.js:15388–15396` — five consumable descriptions hardcode `"1 min"`, one
hardcodes `"tier-9"`, one `"tier-8"`, one `"restore 40 energy"`; `app.js:11384`
hand-rolls `${Math.round(SHOP_CHARM_MS / MINUTE_MS)} min`. Their siblings in
the same table **do** derive (`shortDuration(FROST_POWDER_MS)`,
`${GROWTH_POWDER_R_M}m`), so this is a half-finished consolidation. The values
happen to match their constants today (`SPEED_POTION_AMULET_TIER = 9`,
`DRAGON_AMULET_TIER = 8`) — this is drift risk, not a live lie, and it is
exactly how `COFFEE_AMULET_BOOST` and the Bow/Staff tip went stale before.
`duration_notation.test.js` misses them because its banned patterns key on
`${var}` + a unit letter, not on the word `min`.

Related: `streets.js:179–213` `reachIntervals` and `worldgen.js:565–594`
`accumulateLineSpan` are two independent copies of the same Amanatides & Woo
traversal, down to identical variable names.

---

## 4. Stale docs over live code — the ones that would actively mislead

The codebase deliberately keeps tombstone comments for retired mechanics
(`render.js:117`, `assets.js:70–73`, `lighting.js:439–441`). Those earn their
space and are **not** findings. These do not: they describe rules the code no
longer follows.

- **Three "the player is camera-locked at viewCentre" comments** —
  `app.js:2177` (contact shadow), `:2194` (dragon timer), `:7135`
  (`_drawSwordSwing`). All three are the exact belief CLAUDE.md's camera rule
  exists to prevent, and all three sit above code that correctly calls
  `playerScreen()`.
- **`app.js:821–833`** — a `--- Tap reach (metres) ---` header with **no
  constant under it**, whose second half documents the retired 16 m gate and
  the "rounded square rather than a strict 3-cell diamond" shape. This is the
  same retired rule the browser test in §1 still asserts.
- **`interact.js:566, 1088, 164`** — "same 16m feet-cell limit", "the 3-cell
  cardinal reach", "its `REACH_FAR_M` lives in app.js" (present tense;
  `interact_tap.test.js:789` asserts the constant is gone).
- **`interact.js:485–490`** — the creature-handler contract says favourite food
  → *catch* (spends energy) and empty hand → *hint flash*. Neither is true:
  favourite food **tames in place** (`interact.js:743`, no energy) and an empty
  hand goes straight to the catch wheel (`:820`); there is no hint branch.
- **Net-only hunting left two stragglers** — `items.js:949` "hunt deer with a
  weapon relic" and `items.js:1311` the Staff "still counts toward the
  crow/deer hunt-speed max in interact.js". The `bugnet` entry twelve lines
  away (`items.js:1036`) correctly says "which weapons used to speed".
- **`interactables.js:148`** — acorn drops "5% bare-handed up to 25% with a
  Frost axe". Actual: `ACORN_P_BASE = 0.10`, `ACORN_P_FROST = 1.0` — 10% and
  **100%**.
- **`interact.js:860`** — wildplant wheels "3s with the matching relic, 10s
  bare-handed". Actual ladder: 9000 bare, 4000 Wood, 300 Frost.
- **`items.js:1235, 1243–1247`** — `steerSpeedMul` still quotes the retired
  15.5× ceiling and says "the Frost end is deliberately unchanged", directly
  contradicting `STEER_MUL_FROST = 24` declared beside it.
- **`items.js:938–948`** — the `ANIMAL_FOOD` contract describes `[0]`-as-
  favourite and "want seed"/"needs milk" hint flashes. The only consumers are
  two `animalLikesFood()` `includes()` tests; list order has no reader and the
  flashes do not exist.
- **`coords.js:193`** — `save.reachUpgrades` "fed by the Magic Shrine and the
  wizard tower". Only feeder is `wizardLadder()` (`app.js:12628`).
- **`savemigrate.js:8, :18` + `app.js:1316–1317`** — all three name a "sapling
  review seed" migration. `migrate()` has no such path; no test covers one.
- **`rarity.js:4–5`** ("the legacy pickers stay alive until their call sites
  migrate") and **`items.js:1332`** ("loot.js `pickLoot` keeps working") — the
  migration finished; `pickLoot`/`pickTreasure`/`pickChestRelic` appear only in
  comments.
- **`sandbox.js:795` + `docs/SANDBOX.md:24, :79`** — the wizard tower opens the
  Discovery-badge ladder, not a "smelt/forge UI".
- **`mvt.js:265`** — promises gzip auto-decompress the body does not do.
- **`spec_pins.test.js:264–288`** — pins `INDEX_HTML_SAVE_KEY` against an
  inline `readActiveSaveRaw()` that index.html no longer has (renamed to
  `readActiveSlotData()` and rewritten without the fallback). That half of the
  assertion now passes vacuously; the `SAVES_KEY` half is still real.
- **`CLAUDE.md:605–607`** — says `RELIC_DEFS.bugnet.blurb` advertised "catch
  crows — the one animal a net cannot take (a crow is HUNTED)". Net-only
  hunting inverted this: the net **is** the crow tool now. The blurb and
  `books.test.js:360` are current; the QC note is the stale copy.

---

## 5. Bugs surfaced by the audit

### 5a. The venison migration reorders the inventory on **every** boot

`savemigrate.js:214–225` is not guarded on finding a `venison` stack. For any
save carrying `meat`, every boot lifts the meat stack out of `merged` and
re-appends it **last**, with a new object identity. `save.selSlot` is a
positional index into `save.inv` (`interact.js:35`, `app.js:11287, 15118,
15316`), so a player who quits with meat in slot 2 reloads with slot 2 pointing
at a different item. The neighbouring `golden_`/`flute` block (`:230–243`) does
the same job correctly — it rebuilds via a Map but pushes in encounter order.

Fix without retiring the migration: hoist the block behind
`if (save.inv.some(s => s?.id === 'venison'))`. That also drops a per-boot array
allocation for every save in the world.

### 5b. `_claimTrailReward`'s unreachable `else` is also wrong

`app.js:13380–13386`. `equipGearReward` is a top-level `interact.js` function
loaded before `app.js`, so the guard is always true in the browser and the
`else` is reachable only from `trail.test.js`. It is **not** equivalent: for
`reward.kind === 'armor'` it writes into `save.relics` (wrong bucket) and skips
`Gear.equip`'s max-energy bump — the very thing the comment above it promises.

### 5c. Two flashes still pinned to the viewport centre

`interact.js:841` ("🏃 it got away") and `interactables.js:548` ("Quest done —
see the castle.") both use `viewCenterX, viewCenterY - 60`. Every other flash
in those files places at the tap. This is the shape CLAUDE.md names as retired
for the energy pops; under a peek drag the viewport centre is two cells from
anyone. The escape flash in particular belongs on the animal's cell.

---

## 6. Needs a decision (not provable from code)

- **Old save migrations.** There is **no save schema version** anywhere
  (`grep schemaVersion|save.version|SAVE_SCHEMA` → zero). `SAVE_VERSION_KEY`
  lives in the localStorage *key*, never bumped; `save.startedAt` is
  deliberately stamped `0` for legacy saves, so it cannot date anything. Six
  migrations have no writer left and look ancient — `inv` string[]→`{id,count}`
  (`:189`), `save.stash` fold (`:194`), `save.discovery` counter (`:205`),
  `venison`→`meat` (`:214`), `golden_*`→`shiny_*` (`:230`), `released[].golden`
  (`:245`) — plus `coordSchema < 2` (`app.js:1504`), the one with a real
  version gate. "Nothing writes this shape" is proved; "no live save holds it"
  is not, and retiring any of them silently corrupts a veteran's bag. **If you
  want to retire old migrations at all, add `save.schema = N` first** so the
  next audit has the criterion this one lacked. (The recent ones — trail
  stones→metres, `pathStones`, `flute`→`honey` — are days old. Keep.)
- **The tiled building-art path** (`render.js:1589–1815, 2455–2470` + the whole
  tier-12 rampart pass, `app.js:1681, 1698`). ~230 lines of `drawCells` plus
  two Graphics layers, gated behind `if (POLY) continue;` where
  `BuildingOverlay.enabled()` is true unless `__POLY_BUILDINGS === false` —
  a flag nothing in `src/` or `index.html` ever sets. Unreachable in the
  shipping build, but deliberately so: `building_overlay.js` calls the A/B "the
  whole point of the layer" and CLAUDE.md's painter rule cites the rampart pass
  as documentation. Is the A/B still earning its keep?
- **`readBook()` + the `book:` row in `CONSUMABLE`** (`app.js:10513, 15388`).
  `addToInv` early-returns for books before `Inventory.add`, so a book never
  reaches `save.inv`; the only exercise hand-writes the stack. Reachable only
  by pre-auto-read saves.
- **`testtools.js`** — only `resetTestState` has an in-repo caller. The other
  17 exports (`VERIFY`'s 7 scenarios, `runAll`, `tapCellOffset`, `snapshot`,
  `teleportAdjacent`, `nearest*`) have zero callers, and the header defends
  them as live console/`preview_eval` tools — a purpose grep cannot see.
- **`gear.js:110` `JEWELRY_GEM.ring: 'ruby'`.** `Gear.buildRelicOffer` skips
  the ring outright ("never sold or forged anywhere else"), so this row is
  reached only by `gear.test.js`. Knock-on: **ruby is the only jewelry gem with
  no sink** — mined, sold, delivered, never consumed.
- **`interact.js:290` `TILL_BLOCKER_LINE.shrine` / `.trailer`.** `shrine` is
  never emitted as a kind. `trailer` is a render *role*, not a kind — the
  starter trailer is `{ kind: 'house' }` (`app.js:11777`) — so tilling beside
  your own home prints "A building stands here." and "Your own home stands
  here." is dead copy. `copy_voice.test.js:59, :246` measures both.
- **`difficulty.js:98`** — the header says "every easy multiplier is 1", but
  `EASY.trapCountMul = 10`. Amend the header to name the exception.
- **Naming vestiges.** `cobbleContainer`/`cobblePool` (`app.js:1618, 1815`) are
  fully load-bearing — 169 pooled Images so a handful of `T.PIER` cells can
  wear a plank (`render.js:1522`) — but the name now means the opposite of what
  it holds, and two comments exist to say so. Renaming touches `app.js`,
  `render.js`, `tools/layer_audit.js:58`, `test/perf.html:145`. Same for
  `PATH_STONE_DWELL_MS`, `BLAST_STONE_R_CELLS`, and
  `COBBLE_TYPES`/`isCobbleTerrain` (which `worldgen.js:703` already aliases to
  `isPavedTerrain` for two call sites — two names, one predicate).
- **Orphaned comment blocks** — docblocks that lost their declaration:
  `app.js:143–152` (`TILE_RETRY_*`, `RING_IDLE_TIMEOUT_MS`), `:645–652`
  (Dragon Powder, `NEAR_GPS_CELLS`), `:3696–3712` (`_scheduleTileRetry`),
  `:10399–10411` (`eatSelected`, `useHoney`).
- **`items.js:753`** — the hard-mode tip says "**only** your trailer starts you
  moving again". `app.js:10818` `featherRevive`: a Crow Feather does too, and
  `ITEM_EFFECTS.crow_feather` says so. `books.test.js` does not cover this tip.

---

## 7. Verified NOT dead — do not retire these

Listed so a future sweep doesn't re-flag them.

- **`test/node/path_cobbles.test.js`.** The strongest-looking lead, and it is
  live: every one of its 19 assertions checks `grid[]` terrain or `pathUnder`.
  `accumulateLineSpan` → `pathCross` → `paintLine` decides whether a cell
  **becomes `T.PATH` at all** (tillable/spawnable state), `pruneShortPathRuns`
  dissolves stub runs back to their under-biome, and `pathUnder` is read every
  frame at `render.js:1455`. Only the **filename and the word "cobble" in its
  prose** are stale — the second block already says "path cells".
- **The road-label / path-name wavefront** genuinely is gone; `pathNames` is one
  historical comment. Its replacement `roadLabels` is live.
- **`save.castlesLegacyOpen`** (`quests.js:122` → `app.js:13592`) — retiring it
  revokes castle access from saves that finished the old three-quest chain.
- **`ANIMAL_FOOD.slime`**, `TERRAIN_FLAVOR[WATER]`, the `shop:*` rows in
  `LOOT_CONTEXTS` — unreachable in play, all three say so, all three have
  reasons (secret preservation, sweep completeness, `tools/balancing.html:298`).
- **`WorldGen.setOverpassLive`**, `Quests.starterShow/starterDismissed`,
  `Shops.toRoman`, `fog.js seen()`, `Delivery.SCRIPTED_SINGLES`,
  `combat.js FAUNA_HP.cat/dog`, `Streets`/`Trail` exports flagged by a
  qualified-name sweep — all reached from `index.html`, `tools/`, or via
  destructuring in tests. **Any sweep of this tree must include `index.html`
  and `tools/`.**
- **`app.js:4709` the burned `rng()` draw** — a deliberate no-op keeping
  pre-salt chest seats stable. Textbook vestigial, genuinely load-bearing.
- **Tombstone comments** (`render.js:117`, `assets.js:70–73`,
  `lighting.js:439–441`) — house style for a retired mechanic, working as
  intended.
- **`index.html` is clean**: all 42 script tags resolve, `app.js` is injected
  via `APP_SRC`, `sw.js` scrapes both forms so the shell cache cannot drift,
  every DOM id has a handler, no dead CSS. Every `src/*.js` is loaded; no
  orphan modules. No `TODO`/`FIXME` anywhere in `src/`.

---

## Suggested order

1. **§5a** — the venison reorder is a live save-corrupting bug and a two-line fix.
2. **§3a** — the creature tap box is a live gameplay drift with a table to point at.
3. **§1** — delete the shrine + can-charges blocks, fix the eight changed tests,
   make sandbox mode the harness default so this can never rot silently again.
4. **§2** — the proved-dead symbols; mechanical, zero risk.
5. **§4** — comment sweep; zero risk, and it removes four statements that would
   actively mislead the next person to touch the camera rule or the reach gate.
6. **§3b, §3c, §5b, §5c** — small correctness and consolidation fixes.
7. **§6** — the calls that need a human: the migration cutoff (start with
   `save.schema`), the building A/B, the `cobble*` rename.
