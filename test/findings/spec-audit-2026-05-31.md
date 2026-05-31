# Spec Audit — 2026-05-31

Audited the codebase (`src/*.js`, `index.html`) against `docs/spec.txt` using six
parallel subagents, each owning a disjoint set of spec sections and source files.
Findings below are grouped by severity. Line numbers reflect state at the time of
audit (branch `claude/code-audit-spec-7676q`).

Severity key:
- **BUG** — clearly broken / incorrect behavior, or a spec mechanic that is absent.
- **DIVERGENCE** — implemented, but differs from the spec's values/logic.
- **MINOR** — cosmetic, stale comment, or a small/ambiguous numeric mismatch.

---

## BUGS

### 1. Armor equip never bumps current energy (3 sites)
Spec (ENERGY & FOOD): "Equipping better armor bumps current energy by the delta too."
In all three equip paths the code sets `save.armor[slot] = {tier}` **before** computing
the delta from `getMaxEnergy()`, so the "new max" and "current max" read the same mutated
armor and the bump is always `0`.
- `interact.js:108-116` (`equipGearReward`)
- `app.js:4177-4181` (shop buy path)
- `app.js:4879-4883` (blacksmith forge path)

### 2. Catching an animal never spends energy
Spec (ENERGY & FOOD): "ENERGY_COST … catch 5." The animal-catch path
(`interact.js:557-570` → `app.js:2630-2653 catchCreature`) never calls
`spendEnergy`. The `catch:5` entry in `items.js:502` is dead — catching is free.

### 3. Path-stone reward mechanic is wrong
Spec (PATH STONES): "Every 10 consecutive claimed stones on the same named path
awards 1 coin (a 30-stone path pays 3 coins total; fewer than 10 pays nothing)."
`app.js:4593-4602` instead fires a single chest-style reward (`pickReward('chest:lowtier',
… tier:4)`) once the **entire** path is fully claimed (gated by `MIN_TRAIL = 8`). There is
no per-10 increment, no coin-per-10, and no "consecutive run" tracking (it tracks a set,
not a run). A 30-stone path pays one chest roll, not 3 coins; a partially walked 11-stone
path pays nothing.

### 4. Grassland half-time tilling is unimplemented
Spec (cells §, FARMING): "grassland biome cells till in half the time." Tilling
(`interact.js:1350-1389`) is an instant tap with only an energy cost; there is no time/work
component at all and no biome branch. `effectiveTillCost` (`items.js:666`) varies only by the
Hoe relic, never by terrain class. *(Independently confirmed by two agents.)*

### 5. Fauna can walk onto roads
Spec (fauna): "no fauna may move onto a building footing, or road." All three wander
cell-gates reject only water + buildings and omit every road tier (ROAD=7, ROAD_MD=14,
ROAD_LG=13) and PATH=8, so wandering fauna and crows freely cross roads.
- `app.js:2117`, `app.js:2217`, `app.js:2441`
- e.g. `if (dest.loaded && (dest.type === 3 || dest.type === 9 || dest.type === 11 || dest.type === 12)) continue;`
- (Initial spawn placement at `app.js:1115-1159` does avoid roads; only movement violates.)

### 6. Chest opens don't roll a flat 10% relic/armor
Spec (CHESTS): "10% of opens roll a RELIC or ARMOR instead of normal loot."
`interact.js:734-735` → `pickReward('chest:'+category, …)` uses each biome's
`classBias.relic` weight (ranging 2.5%–10% by category), never a uniform 10%.

### 7. Chests never produce ARMOR, and chest relics aren't milestone-gated
Spec (CHESTS): opens "roll a RELIC or ARMOR … gated by your harvest/catch milestones."
- The chest relic branch (`rarity.js:366-381` → `reconcileRelicOffer`) only ever returns a
  relic slot; ARMOR is never producible from a chest. The only armor-capable path
  (`rollGearUpgrade`) is wired solely to fishing (`interact.js:1257`).
- `chestRelicAllowedTiers(progress)` (`rarity.js:415`) exists but is never called from the
  chest path, so milestone gating (sunflower→Gold, etc.) is not applied to chest relics;
  tier is bounded only by per-chest `relicCap`.

### 8. Specialty sell bonus is never applied (and selling only works at home)
Spec (ECONOMY): "SELL: with a stack selected, tapping a house sells one. Sale price =
PRICES[id] × sword multiplier × the shop's specialty bonus."
- Selling is only possible at HOME (`app.js:3347-3351`); every other house is buy/trade-only.
- `Shops.shopSellBonus` (the +100% gem / +50% produce / +25% trader bonus, `shops.js:71-77`)
  is defined but never called anywhere.

---

## DIVERGENCES

### 9. Tool work-wheel times don't match the spec ladder
Spec: wood 3s, copper 2.5s, iron 2s, gold 1.3s, platinum .8s, crimson .5s, frost .3s.
`items.js:684 toolDurationMs` uses `Math.max(500, 3000 - (tier-1)*750)` →
T1 3.0✓, T2 2.25, T3 1.5, T4 0.75, T5 0.5, T6 0.5✓, T7 0.5. Only Wood and Crimson match;
T5/T6/T7 all collapse to the 500ms floor, so Frost is no faster than Platinum.
`interact.js:362-364` hardcodes the same wrong formula for weapon-defeat times.

### 10. Bare-handed fishing fishes at full T1-rod odds
Spec (FISHING): only a rod improves the catch. `interact.js:1241` does
`const tier = save.relics?.rod?.tier || 1`, so a rod-less cast gets T1 skunk odds (0.50) and
T1 better-fish weighting. The cast *duration* is correct (9s tier-0), but catch quality with
bare hands equals owning a wooden rod.

### 11. Crow orbit ring is too tight
Spec (fauna): crows "orbit nearest crop at 1.5-3.5 cells." `app.js:2406-2408` orbits at
0.75-1.75 cells (`(0.75 + rand*1.0) * cellM`). The code's own comment even says
"radius ~0.75–1.75 cells," contradicting the spec.

### 12. Fauna simulation range is ~double spec
Spec: "animals simulate when within viewport range (~7-8 cells)." `app.js:1968`
`RANGE_M = (VIEW_CELLS + 4) * cellM` = 15 cells (crow detect radius likewise 15).

### 13. Flute lure is narrower than spec
Spec (CONSUMABLES): flute "lures wandering creatures within 15 cells toward you."
`app.js:2980-3007 playFlute()` only re-anchors `chicken` and `cow` (ignores cat/dog/rabbit/
deer/crow/butterfly), and uses a 30m = 6-cell radius, not 15 cells (75m).

### 14. Ghost energy cost is ~half the spec values
Spec (GEAR): ghost drains "~2/cell at T1, falling to ~0.3/cell at T7."
`items.js:704-707 ghostEnergyCost` returns 1.0/cell at T1 → 0.15/cell at T7
(used per-cell at `app.js:1570`).

### 15. Spec's chest yield/category tables are dead code
Spec (CHESTS) documents tier yields (T1=10/T2=5/T3=2; lowtier 3/2/1) and category
weightings (food 60/30/10, commerce 70/25/5, …). `loot.js TIER_YIELD = {1:5,2:3,3:1}` and
the entire `CATEGORY_LOOT`/`getLootConfig`/`DEFAULT_LOOT` set have no live consumer.
Quantities/tiers are actually driven by `rarity.js` (`tierQtyPerBump`, `chainSteps`,
`chestTierMod`), so none of the documented numbers are in effect.

### 16. Chest tier diamond colors don't match
Spec (CHESTS): T1 bronze, T2 silver, T3 gold, T4 cyan. `loot.js:264-269 CHEST_TIER_COLOR`
= `{1:null, 2:off-white, 3:light-blue, 4:violet}`. T1 draws no diamond (not bronze),
T3 is blue not gold, T4 is violet not cyan.

### 17. Bus/lowtier chests can never offer a Wood relic
Spec (GEAR): "bus chests cap at Wood." Lowtier chests map to `chestTier=1` and
`chestTierMod[1].relicCap = 0` (`loot.js:255-262`, `rarity.js:72`), so T1 chests offer no
relic at all — not even a Wood-capped one.

### 18. Residential interactable frontage uses 3 cells, not 2
Spec (Residential): interactables "must spawn within 2 spaces of a road or path, or public
area." `worldgen.js:81 SPAWN_FRONTAGE = 3` (Chebyshev) governs objects, wildplants,
parking-treasure, and the satextract yard check.

### 19. Residential mineralrock proximity test is stricter & narrower than other objects
Spec (Residential): same "within 2 spaces of a road/path or public area" rule.
`worldgen.js:1240 _mrNearRoadWithin(ix,iy,1)` keeps residential mineralrocks only within
Chebyshev radius **1**, and `_mrIsRoad` (`worldgen.js:1184-1187`) counts only roads/paths —
it omits the public anchors (parks/playgrounds/pitches/golf/sand/pier) that `PUBLIC_NEAR`
recognizes for every other interactable.

### 20. Orchard fruit pick yields 1-2, not +1
Spec (ORCHARD): tapping a ripe tree "picks the fruit (+1)." `interact.js:870` does
`addToInv(o.species, randInt(1, 2))`.

### 21. Castle re-roll button disabled despite spec
Spec (ECONOMY): "Castles/forts may show a re-roll button (cost $5 × 2^rerolls)."
`app.js:3456-3461` passes `allowReroll=false` for castles ("No re-roll at castles per
balance pass").

### 22. "Sell gear you own better of at half value" is unimplemented
Spec (ECONOMY) — there is no gear-selling path at all (gear isn't in the sell modal).

### 23. Ring chest-luck implemented differently
Spec (GEAR): "Ring: +5%/tier chance to bump chest loot up a tier." `items.js:688-690
ringTierBoost` (0.05×tier) is dead; the picker applies `ringLuck = 0.01×tier` (1%/tier) as a
reduction to the qty-vs-tier split, not a +5%/tier tier-up chance (`rarity.js:204,320`).

### 24. Unified-picker shop contexts are dead code
Spec implies the unified rarity picker drives shops. All `shop:*` LOOT_CONTEXTS in
`rarity.js:131-146` are unused; app.js builds offers via `buildShopOffer` /
`buildRelicOffer` / `peekOrBuildTraderOffer` (parallel logic — behavior exists, contexts don't).

---

## MINOR / COSMETIC

- **`pick` relic energy discount is dead** — `effectivePickCost` (`items.js:657-660`) is never
  called; mining energy uses inline `10+(tier-1)*4` (`interact.js:908`) with no pick discount.
  Pick tier still shortens the wheel. *(Spec's `10+(tier-1)*4` itself matches.)*
- **Stale comment: reach origin** — `interact.js:984` comment says reach is the "PLAYER'S CELL
  CENTRE (not their feet)", contradicting spec and the actual feet-based `playerReachCell`
  (`coords.js:48-56`). Behavior is correct; comment is wrong.
- **Advance-stage flash mislabel** — `interact.js:1160` flashes "🌱 Watered." when advancing a
  crop stage (should read as a growth advance). Behavior correct.
- **"10s" / "1.5-3.5 cells" stale comments** — `interact.js:586` comment says "10s bare-handed"
  (code is 9s); `app.js:2044` wander comment claims crow "ring 1.5-3.5 cells" (code orbits
  0.75-1.75). Behavior unaffected.
- **Coin-burst floor** — `app.js:2604-2605` clamps target to [8,12] then `min(target,
  candidates)`, so with <8 walkable cells a burst drops fewer than the spec's 8. Edge case.
- **rockfruit→gemfruit surprise = 10%** — `loot.js:282 chance:0.1`; spec says "small chance"
  with no number. Tuning note only.
- **Crow "2 full cycles" off-by-one (ambiguous)** — `app.js:2352-2360` requires 3 landings
  total (first arms `_destroyCyclesLeft=2`, 2nd/3rd decrement). Borderline reading of "land for
  2 cycles."
- **Building-distribution small-house floor edge case** — `worldgen.js:160-164
  enforceBuildingDistribution` `else if` band assignment can under-fill the small-house floor
  for very small building counts (n between ~5 and ~14). Large tiles unaffected.
- **Internal spec conflict (slime drain)** — the *fauna* section says slime drains 3 energy/sec
  within 1 cell; the *CREATURES* section says 1 energy every 3s within ~2.5m. The code
  (`app.js:2029-2040`) implements the **fauna** version: `STEAL_R = 1 cell (5m)`, 1000ms
  cooldown, 3 energy/tick. Flag the spec itself for inconsistency.

---

## Verified correct (high-confidence, no finding)

Viewport 11×11 & 5m cells; reach 3→2 (below 30% energy)→0 (at 0 energy); ENERGY_COST
till/plant/harvest/rockPlace + free pickups; FOOD_ENERGY table; armor max-energy per tier;
eat button + rainberry-waters-20m + pairy-compass-5min; offline energy pro-rate + indoor/home
faster regen; GPS↔WASD manual-override latch; compass facing + last-move fallback; work wheel
150ms swallow + cancel refund; debounced save + pagehide flush; building tier thresholds &
minimum-mix percentages; deterministic seeded rasterization; satextract sidecar; mining cave
vs ore drops + T4+ gems; rockfruit fence place/pickup; shrub→wood; broken-rock/chopped
persistence; fruit trees never destroyed + 8 seeded species + ~30min timer; fishing 5 energy /
6% boot / ~2% relic; stack cap 9→249 & 5-slots/page; full item/fish/fruit catalog; fauna step
~1 cell/5s; HP values; scarecrow 4-cell aversion; deer 20%/step within 1.5 cells; cat/dog chase
8 cells + 1.5-cell combat + feather drop; heal-to-full after 20 min; catch vs tame separation +
favourites; egg/milk feed + 1hr cooldown + 50% petted double; pest defeat work queue (no flee,
no energy); slime sapphire-tame + tame exemption; chicken flock-of-4 release; pet 10-min boost +
cat-follow-5min; butterfly requires net; 50 slimes/tile; 💗 marker; start money $25; buy 1/3
cash (1.2-3.0×) / 2/3 barter; re-roll $5×2^n; castle relics 4× minus bow/staff; castle tribute
(10 / 5-animal, per-castle, bag-gated); deals/hour (plain 1 / fort 5 / castle ∞); address-digit
specialties; 7 material tiers; relic slots & effects; bags 9→249; ghost speed 8×→24×; sword
0.5×→1.0×; bow/staff par at T7; milestone unlock tiers; starter blacksmith 3 wooden tools @5
wood; forge bar/jewelry/smelting recipes; magic shrine level-up + all 5 transforms.
