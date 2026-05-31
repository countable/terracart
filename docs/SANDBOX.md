# Sandbox test world

Load with `?sandbox=true` (e.g. `index.html?sandbox=true`). Replaces the start
tile with a hand-laid **town + countryside** map that packs one of every biome,
interactable, and fauna into a single area you can walk in seconds. Source:
`src/sandbox.js`.

## Why scenes, not swatches

Worldgen never produces a pure "residential square" — a real residential
polygon is a *scene*: a road threads through it, houses (shop type set by the
address digit) line the road, yards carry flora, mineral rocks sit at the curb.
So each test area is a small realistic composite, and the connective **roads**
between them aren't filler — they cover the road / road_lg / road_md / path
biomes and their street-letter overlays.

## Layout (north → south)

```
Band 1  COUNTRYSIDE      FOREST · ORCHARD · ROCK
   ── Oak Road (road) ──
Band 2  WATER & PASTURE  BARNYARD · PETTING PADDOCK · BEACH(sand+water+pier+well) · WETLAND/GOLF
   ── Main Street (road_lg) ──
Band 3  CENTRE           PLAYER SPAWN(shrine+well+coins+treasure) · FARMLAND
   ── Mill Lane (road_md) ──
Band 4  TOWN             RESIDENTIAL ST(road+4 house types) · CIVIC(school/commerce/hospital+path) · SMALL HOUSE
   ── Garden Row (road) ──
Band 5  RECREATION       PARK · PLAYGROUND · PITCH · CASTLE · FORT
```

Total footprint ≈ 32 × 44 cells (≈ 160 m × 220 m at 5 m/cell), centred in the
start tile. The player teleports to the PLAYER SPAWN scene.

## Coverage matrix

### Biomes (terrain codes 0–23) — all 24 present

| Code | Name | Scene |
|---|---|---|
| 0 grass | BARNYARD / PLAZA / gutters |
| 1 forest | FOREST |
| 2 sand | BEACH |
| 3 water | BEACH |
| 4 farmland | FARMLAND |
| 5 residential | RESIDENTIAL ST |
| 6 park | RECREATION |
| 7 road | connective roads + residential street |
| 8 path | CIVIC (named "Garden Path") |
| 9 building | SMALL HOUSE |
| 10 rock | ROCK |
| 11 building_med | CASTLE+FORT (fort) |
| 12 building_large | CASTLE+FORT (castle) |
| 13 road_lg | Main Street spine |
| 14 road_md | Mill Lane |
| 15 school | CIVIC |
| 16 commercial | CIVIC |
| 17 industrial | CIVIC |
| 18 playground | RECREATION |
| 19 pitch | RECREATION |
| 20 wetland | MARSH |
| 21 golf | MARSH |
| 22 orchard | ORCHARD |
| 23 pier | BEACH |

### Interactable objects

| Kind | Variants covered | Scene |
|---|---|---|
| tree | maple stages 0–4, pine, birch, mahogany | FOREST |
| fruittree | apple, cherry, peach, banana, orange, mango, coconut, apricot | ORCHARD |
| mineralrock | required tiers T1–T7 (+ a curbside T1, industrial T2/T3) | ROCK / RESIDENTIAL / CIVIC |
| chest (pad) | farm+park+orchard (square3), shop (line3h), school (triangle), hospital (cross), bus (no pad), playground (line3v), pitch (square2) | CIVIC / RECREATION / etc. |
| house | blacksmith (addr 9), market (6), trader (8), plain/delivery (3) | RESIDENTIAL ST |
| tower | castle relic shop ×4 | CASTLE |
| well | watering-can refill ×2 | BEACH, PLAZA |
| shrine | smelt/forge UI | PLAZA |
| flora | flower variants 0–3, mushroom decals | BARNYARD/PARK/RESIDENTIAL |
| groundstack | wood ×2 | BARNYARD |
| wildplant | longgrass, shrub, nut, shell, mushroom, rockfruit (placed-rock ring) | various |
| coindrop | 3-coin burst | PLAZA |
| treasure | in-reach (N of spawn) + SW seam | PLAZA / SW tile |
| planted crop | all 5 growth stages + a double-yield mature one | FARMLAND |
| scarecrow | aversion ring (farm + beside a park crow) | FARMLAND / RECREATION |
| placed rock | pen ring + a lone one for the pickaxe cycle | BARNYARD / PLAZA |

### Fauna — all kinds present

| Kind | Path tested | Scene |
|---|---|---|
| chicken, cow, cat, dog | catch + produce | BARNYARD, FARMLAND |
| released_* (each tameable) | pet path, cat-follow, +50% double-produce | PETTING PADDOCK |
| rabbit, deer | wilderness (deer weapon-gated, drops meat) | FOREST |
| crow | pest (feather); scarecrow aversion | RECREATION |
| butterfly (wild) | **bug-net gate** (bare hands fail) | FOREST, RECREATION |
| slime | energy-drain pest | FOREST, BARNYARD |
| fish (minnow→goldenfish) | FISHING — stand on the BEACH pier, tap water | BEACH |

### Test kit granted on load

- Inventory: ~5 of every item (seeds → produce → animals → minerals → consumables).
- Gear: one of every relic + armor at **T3** — clears every action gate while
  staying *below* the T4–T7 rocks, so the "pickaxe too weak" branch is still
  demonstrable on the high-tier ROCK samples.
- All sandbox houses marked restored so shop sprites + signs render immediately.

## Notes

- Everything is **clobbered on every load** (inventory, gear, planted, released,
  placed rocks) for a predictable baseline.
- Scene-name captions float over each scene (white-on-black) to help orient.
- To extend: add a scene object, drop it into a `BANDS` row, and add its
  coverage to this matrix. The layout (sizes → positions) is computed from the
  scene `w`/`h`, so you never hand-place coordinates.
