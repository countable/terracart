# Building materials

`approved-materials-v1.png` is the sole shipping wall/roof/facade atlas.
`python3 tools/build_approved_materials.py` packs processed source derivatives
with two-pixel gutters and prints the endpoint rectangles held in
`BuildingLowPoly.SHEET_SRC`. Never edit the packed PNG directly.
The sheet is 683×1049. Every pixel and crop in its previous 683×801 area is
unchanged, including all roofs, legacy materials and retained facade accessories.

## Restored Pixel Plains facade variants

`BuildingLowPoly.LOOK.facadeVariant='A'` ships; a recipe's `facadeVariant`
can override it with `B`. Both selections enter the shared cel-sheet cache key.
The choice applies only to restored Plain, Home, smithy and eight commerce roles.
Wrecks, wizard, turret, fort, castles and unrestored recipes retain their art.
No roof, mesh, footprint, storey, collision or camera changes are included.

- **A / straight:** Pixel Plains' own white, orange, plank, cool grey-lilac
  masonry, warm timber and mint glass colours. Scale nearest-neighbour; repair
  repeat seams and replace only clashing dark opening outlines with CEL.ink.
- **B / generated:** two successful medium `genimg` generations with PP crops
  as references. Observed master crops are reduced to exact texel sizes, then
  mapped without dithering to small material-family palettes. Frames, handles
  and mullions receive explicit pixel cleanup. No antialiased alpha remains.

A retains the source's sparse brick hints and clear glass most faithfully.
B is quieter and greyer but changes source proportions and loses some light
clusters after reduction. Its smith door is iron; A uses the PP timber door.

| Roles | Ground wall / matching chimney | Upper wall | Openings |
| --- | --- | --- | --- |
| Plain, Home | White plaster with brick hints | White plaster | Timber double door, four-pane windows; dark diagonal braces |
| Shop, trader, supply, seed, pet, potion, relic, book | Orange brick hints | White plaster | Glazed door/display, four-pane upper windows; roof-tinted awnings |
| Blacksmith | Stone masonry | Stone masonry | Full-height double door and retained cog; four-pane windows |

`recipe.shopWalls='plank'` selects horizontal planks on both shop floors and
its chimney. All eight commerce roles still share one facade family; roof and
awning colours distinguish their services. Chimney sides copy the building's
ground-wall texture at the same texel density, with soot directly below the
mouth, CEL.ink inside, and the building's trim on its existing cap.

Source credit: **Pixel Plains Interiors Pack by Jose Javier (SnowHex)**,
https://snowhex.itch.io/pp-interior-and-houses-pack.
The locally acquired licence permits project use and modification with credit;
it does not permit redistribution as an asset pack, tool or template.
Ship these processed game derivatives only; raw licensed sheets stay in
ignored `extra_assets/`. Generation references and raw masters remain research
artifacts, not runtime assets.

### Source crops and rebuilding

`source/b4d-pp/provenance.json` records source paths, original-pixel rectangles,
exact output sizes, generated master crops and palettes. The two house sheets
were inspected; selected walls/openings come from Exterior set, with the
smith's cool masonry selected from the Shop set floor. All coordinates below
are original-pixel `[x,y,w,h]`, not enlarged preview positions.

| Part | Source file | Crop `[x,y,w,h]` | Texture size |
| --- | --- | --- | --- |
| whitePlaster | Exterior set.png | `[379, 83, 23, 24]` | 24×24 → 96×96 repeat |
| orangeBrick | Exterior set.png | `[268, 83, 22, 24]` | 24×24 → 96×96 repeat |
| boards | Exterior set.png | `[491, 84, 22, 24]` | 24×24 → 96×96 repeat |
| smithStone | Shop set.png | `[128, 80, 32, 32]` | 24×24 → 96×96 repeat |
| houseDoor | Exterior set.png | `[291, 84, 26, 28]` | 19×24 |
| shopDoor | Exterior set.png | `[705, 165, 30, 27]` | 20×24 |
| smithDoor | Exterior set.png | `[291, 84, 26, 28]` | 23×24 |
| timberWindow | Exterior set.png | `[176, 136, 16, 16]` | 14×14 |
| brassWindow | Exterior set.png | `[176, 136, 16, 16]` | 16×16 |
| shopWindow | Exterior set.png | `[695, 133, 82, 23]` | 74×15 |

Build A from the locally licensed pack:

```sh
python3 tools/build_pp_facade_variants.py
python3 tools/build_approved_materials.py
```

The packer can also run alone using the shipped processed A/B inputs; it does
not need the licensed pack or generation service. To reproduce B cleanup,
provide `--generated-master` and `--generated-openings` to the first script.
The masters are `generated-master.png` and `generated-openings-master.png` in
`~/.artifacts/terracart-steampunk/research/B4d-pp-textures/`; exact prompts and
CLI choices are recorded there in `generation-prompts.md`. Only two medium
requests were used. Generators did not honour exact requested grid positions;
observed bounds are recorded instead, then reduced to the exact runtime sizes.

| Part | A shipping `[x,y,w,h]` | B shipping `[x,y,w,h]` |
| --- | --- | --- |
| whitePlaster | `[2, 801, 96, 96]` | `[2, 925, 96, 96]` |
| orangeBrick | `[100, 801, 96, 96]` | `[100, 925, 96, 96]` |
| boards | `[198, 801, 96, 96]` | `[198, 925, 96, 96]` |
| smithStone | `[296, 801, 96, 96]` | `[296, 925, 96, 96]` |
| houseDoor | `[2, 899, 19, 24]` | `[2, 1023, 19, 24]` |
| shopDoor | `[23, 899, 20, 24]` | `[23, 1023, 20, 24]` |
| smithDoor | `[45, 899, 23, 24]` | `[45, 1023, 23, 24]` |
| timberWindow | `[70, 899, 14, 14]` | `[70, 1023, 14, 14]` |
| brassWindow | `[86, 899, 16, 16]` | `[86, 1023, 16, 16]` |
| shopWindow | `[104, 899, 74, 15]` | `[104, 1023, 74, 15]` |

### Retained roofs and accessories

The seven 96×96 restored roof cells keep their five-colour ramps and 288-texel
wrap: copper houses, blue shop/smithy, verdigris trader/supply, straw-green
seed/pet, violet potion, red relic and plum book. Existing legacy roof cells
and their optional tileset 360-texel wrap are unchanged.

`source/b4-facade/` and `tools/build_facade_parts.py` retain the previous
processed parts. Its role boards, glyphs, cog and six roof-tinted awnings are
still used by both variants; old remapped surfaces and openings remain packed
at their original coordinates. Provenance is in `pp-provenance.json` there.
The role board source is Exterior set `[712,197,80,14]`, with lettering erased
and a 12×12 glyph inside a 20×18 board. Awning source is Exterior set
`[33,258,30,23]`, flattened to 76×8 and recoloured to each roof ramp. The 18×18
cog is procedural. These parts are unchanged from B4c.

The facade grid stays 24 texels per storey and 39 per bay. House/shop/smith
entrances are 19×24 / 20×24 / 23×24. House and smith windows are 14×14; the two
house entrance windows fit at 12×12. Commerce upper windows are 16×16; its
74×15 display spans two bays, other bays use 35×15. Roof-tinted awnings are
76×8 or 37×8. The large shop sign occupies the upper storey and is not visible
on one-storey shops. Narrow L returns still fit complete opening bays.

Packed pixels are copied with nearest sampling and the existing face-lighting
pass; no new runtime pixel readback or per-frame baking is added. Legacy
sprites and the Canvas fallback keep their previous facades. Cache-bust and
run the node and building suites after changing runtime art/code.

## Reference atlas

`reference-materials-v3.png` is a 4x3 grid of seamless 96px tiles, drawn 1:1 by
`BuildingLowPoly` (cell order: `MATERIAL_CELLS`): clay, slate, thatch, shingle /
glazed, plaster, boards, rubble / brick, clapboard, flagstone, moss.

Build: `python3 tools/build_building_materials.py`. It reads the two generated
3x2 swatch sheets in `source/`, crops periodic axes to whole pattern repeats
(skipping the first, which generation cuts short), wraps free axes by
cross-fading, sets texel density per material, and posterises each tile.

Both sheets were generated with gpt-image-2 (`genimg --opaque --aspect 3:2
--quality high`). `materials-gen-a.png` used a side-by-side of the user's
`/tmp/houseref.webp` and `/tmp/more-houses.webp` as a STYLE reference only; no
reference pixels are embedded (the second reference is third-party game art).
`materials-gen-b.png` used `materials-gen-a.png` as its reference so the style
matches. Prompts: chunky crisp pixel art, saturated warm colours, 1-pixel dark
outline and short top highlight per tile/stone/board, 4-5 colour ramps, flat
front-on seamless swatches in exact equal cells with no gutters, objects or
text; sheet a: red fish-scale tiles, blue-grey slate, golden thatch, cream
plaster, honey vertical boards, grey rubble; sheet b: red-brown running-bond
brick, white clapboard, square flagstones, wooden shingles, teal glazed tiles,
mossy rubble.
