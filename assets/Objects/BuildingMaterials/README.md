# Reference building materials

`reference-materials-v3.png` is the active atlas (see below). `reference-materials-v2.png` was the previous shared imagegen atlas, generated with the built-in image_gen tool using `/tmp/bldg2.gif` as the visual reference. The earlier `reference-materials-v1.png` used `/tmp/bldg.png` and is retained for comparison. Neither reference is embedded in the game.

Layout: three columns, two rows. Top: clay, slate, thatch. Bottom: plaster, timber, masonry. The renderer downsamples with nearest-neighbor sampling, applies role colors and the restricted palette once at material creation, and keeps doors/windows separate from the tiling surface. No geometry or per-frame texture uploads are added.

Final generation prompt:

Create a production pixel-art material atlas for a low-poly building game, matching the attached /tmp/bldg2.gif STYLE REFERENCE. The reference's defining qualities: flat warm beige plaster with virtually NO texture, crisp dark warm-brown timber, orderly scalloped slate and terracotta tiles made of solid pixel clusters, clean restrained 4-color ramps, no weathering or mottled noise. Produce a single opaque image with THREE EXACT EQUAL COLUMNS and TWO EXACT EQUAL ROWS, all cells touching with NO gutters, borders, labels or text. This is a flat orthographic UV MATERIAL SHEET, not buildings, not a village, no perspective, no grass, no doors or windows or objects. Each cell fills the whole rectangle and is designed to tile at its boundaries. TOP LEFT: warm burnt-orange terracotta roof tiles. TOP MIDDLE: muted blue-gray slate roof tiles. TOP RIGHT: warm straw thatch in tidy horizontal bands. BOTTOM LEFT: almost completely flat muted warm beige plaster, just two close colors and extremely sparse tiny deliberate pixels, no large stains. BOTTOM MIDDLE: dark warm-brown timber planks with very simple widely spaced horizontal seams, no grain noise. BOTTOM RIGHT: subdued warm-gray masonry with broad simple rectangular stones, quiet seams, no mottling. Roof swatches each have about eight regular horizontal staggered courses with 6 to 8 wide tiles per row; each tile has a small clean stepped or scalloped lower edge, a restrained short highlight and a small shadow edge. Pixel-perfect square corners and staircase diagonals, no blur, gradients, bevel rendering, random speckles or painterly shading. Use only 4 solid colors per roof, 2-3 per wall. Roofs medium contrast and walls low contrast. Aim for the legibility and deliberate clustering of the supplied GIF at its native small game resolution.

## v3 (active)

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
