# Function inventory

Generated survey of every function across the JS source files.
LOC counts opening brace through matching close (inclusive).
Tiny nested closures inside larger functions are intentionally skipped.

## Totals

| File         | Lines | Functions |
|--------------|------:|----------:|
| app.js       |  2226 |       ~34 |
| worldgen.js  |   946 |        23 |
| textures.js  |   649 |        29 |
| loot.js      |   235 |         3 |
| mvt.js       |   176 |        13 |
| items.js     |   134 |         1 |
| sw.js        |    93 |         — |
| crops.js     |    65 |         1 |
| save.js      |    46 |         3 |
| tilemap.js   |    24 |         — |
| **Total**    |**4594**|     **~107** |

`sw.js` is event-listener-only; `tilemap.js` is a data module.

---

## worldgen.js

| Function              | Description                                                | LOC |
|-----------------------|------------------------------------------------------------|----:|
| buildingTier          | Classify buildings by area and height into tier categories |   6 |
| lonLatToWorldPx       | Convert lon/lat to world-pixel coords at zoom z            |   6 |
| metersPerPixel        | Calculate meter-per-pixel scale factor at lat/zoom         |   2 |
| classifyPolygon       | Map OSM polygon layer/tags to terrain type enum            |  35 |
| classifyLine          | Map OSM line layer/tags to road/path terrain type          |   7 |
| roadWidthM            | Determine road width in meters by class tag                |   9 |
| paintCell             | Paint single cell in grid with priority-based collision    |   5 |
| paintPolygon          | Rasterize polygon rings into grid using scanline fill      |  36 |
| paintLine             | Stamp disk along polyline using Bresenham algorithm        |  21 |
| openIDB               | Open IndexedDB for tile caching with schema v1             |   9 |
| idbGet                | Async fetch from IndexedDB by key                          |  11 |
| idbPut                | Async store to IndexedDB with error swallow                |   9 |
| fetchTileBytes        | Fetch MVT tile bytes with IndexedDB cache fallback         |  11 |
| makeRng               | Create deterministic seeded PRNG (mulberry32)              |   9 |
| ringSignedArea        | Compute signed area of polygon ring                        |   6 |
| ringCentroid          | Calculate centroid of polygon ring with fallback           |  13 |
| pointInRings          | Raycasting point-in-polygon test for rings                 |  13 |
| bboxOf                | Compute axis-aligned bounding box of rings                 |   8 |
| rasterizeTile         | Rasterize MVT tile into game-cell grid with objects        | 542 |
| tileEdgeMeters        | Calculate tile edge length in meters at latitude           |   3 |
| cellsPerEdgeForLat    | Compute cells-per-tile edge based on latitude              |   2 |
| loadTile              | Load/cache/rasterize MVT tile async with dedup             |  45 |
| tileXYForLonLat       | Convert lon/lat to web-mercator tile indices               |   7 |

## textures.js

| Function                | Description                                              | LOC |
|-------------------------|----------------------------------------------------------|----:|
| seededRand              | Create seeded PRNG for stable texture randomization      |   6 |
| drawGrassTex            | Paint short lawn with green specks and roots             |  13 |
| drawForestTex           | Paint leaf-litter clumps and bright specks               |  14 |
| drawSandTex             | Paint fine sand grains in warm tones                     |   8 |
| drawFarmlandTex         | Paint parallel furrow rows with subtle shading           |  14 |
| drawParkTex             | Paint grass base with tiny flower accents                |  10 |
| drawTilledTex           | Paint ploughed soil with horizontal furrows              |  15 |
| drawWaterTex            | Paint ripple highlights on transparent background        |  16 |
| drawResidentialTex      | Paint concrete with aggregate flecks                     |  18 |
| drawPathTex             | Paint scattered pebbles in dark/light dots               |  12 |
| drawBuildingTex         | Paint packed rounded cobbles in grid                     |  18 |
| drawRockTex             | Paint jagged cracks and highlights on stone              |  17 |
| drawLongGrassTex        | Paint procedural tall-grass blade sprite                 |  22 |
| drawPlinth              | Paint stone plinth base for statue                       |   5 |
| drawSignpostStatue      | Paint signpost/post stone sculpture                      |  11 |
| drawChapelStatue        | Paint chapel/steeple stone sculpture                     |  10 |
| drawBookStatue          | Paint stacked-books stone sculpture                      |  11 |
| drawStockpotStatue      | Paint pot/vessel stone sculpture                         |  13 |
| drawPotionStatue        | Paint potion-bottle stone sculpture                      |  15 |
| drawWheatSheafStatue    | Paint wheat-bundle stone sculpture                       |  11 |
| drawBouquetStatue       | Paint flower-bouquet stone sculpture                     |  12 |
| drawMarketStallStatue   | Paint market-stall/stand stone sculpture                 |  15 |
| drawFlowerTuftStatue    | Paint flower-tuft stone sculpture                        |   8 |
| drawFlora               | Draw decorative flora sprites (flowers, pebbles, …)      |  52 |
| makeFloraTextures       | Bake procedural flora sprites into texture cache         |  12 |
| makeBiomeTextures       | Bake procedural biome textures with seeded variants      |  19 |
| makePadTexture          | Bake concrete-pad POI texture with embossed statue       |  40 |
| makePadShapeTexture     | Bake shape-based concrete-pad texture with outline       |  43 |
| makeAllPadShapes        | Bake all POI pad shape textures                          |   2 |

## crops.js

| Function   | Description                                       | LOC |
|------------|---------------------------------------------------|----:|
| frameRect  | Convert frame index to pixel offset on spritesheet |   5 |

## items.js

| Function            | Description                                          | LOC |
|---------------------|------------------------------------------------------|----:|
| inventoryIconSource | Resolve spritesheet frame for item inventory icon    |  22 |

## loot.js

| Function       | Description                                        | LOC |
|----------------|----------------------------------------------------|----:|
| rusticifyName  | Transform modern POI names to medieval equivalents |  22 |
| pickTreasure   | Pick random treasure from weighted tier distribution|  10 |
| pickLoot       | Pick random loot by POI category/tier weights      |  16 |

## save.js

| Function     | Description                                          | LOC |
|--------------|------------------------------------------------------|----:|
| loadSave     | Sync load from localStorage with error fallback      |   4 |
| flushSave    | Force synchronous write of pending save              |   5 |
| persistSave  | Debounce save writes with configurable window        |   5 |

## mvt.js

| Function        | Description                                          | LOC |
|-----------------|------------------------------------------------------|----:|
| Reader          | Protobuf stream reader (varint/string/bytes)          |   — |
| readVarint      | Read unsigned varint from buffer                     |   9 |
| readSVarint     | Read signed varint (zigzag decoded)                  |   3 |
| readString      | Read UTF-8 string with length prefix                 |   7 |
| readDouble      | Read 64-bit double from buffer                       |   5 |
| readFloat       | Read 32-bit float from buffer                        |   5 |
| readBytes       | Read byte slice with length prefix                   |   5 |
| skip            | Skip field by wire type                              |   6 |
| readValue       | Parse protobuf Value message (oneof)                 |  16 |
| decodeGeometry  | Decode MVT command stream to point/line rings        |  32 |
| decodeFeature   | Parse MVT Feature message with geometry+tags         |  25 |
| decodeLayer     | Parse MVT Layer message with deferred feature parse  |  24 |
| decodeTile      | Decode MVT tile root message into layers             |  13 |

## tilemap.js

Data-only file — no functions.

## sw.js

Service worker with event listeners — no exportable functions.

## app.js

| Function                  | Description                                              | LOC |
|---------------------------|----------------------------------------------------------|----:|
| makePlaqueTextures        | Bake per-crop wooden sign with crop icon                 |  34 |
| constructor (MapScene)    | Initialize Phaser scene                                  |   2 |
| preload                   | Load spritesheets and images for world/ui                |  58 |
| create                    | Init gameplay state, layers, pools, physics              | 250 |
| setupLifecycle            | Manage wake-lock and visibility-based pauses             |  36 |
| startGps                  | Begin geolocation watch with easing                      |  28 |
| startCompass              | Listen for device orientation events                     |  27 |
| showBanner                | Toggle offline banner visibility                         |   1 |
| playerToWorldCell         | Convert player meters to tile/cell coords                |  11 |
| worldMetersToAbsCell      | Convert world meters to absolute cell index              |   9 |
| absCellCenterMeters       | Convert absolute cell index to center meters             |   8 |
| playerAbsCell             | Get player's absolute cell index                         |   7 |
| ensureTilesAround         | Async load 3x3 tile neighborhood around player           |  20 |
| spawnInTile               | Spawn creatures and treasure for tile on first load      |  64 |
| update                    | Tick: movement, animation, tile loading, render          |  87 |
| wanderCreatures           | Wander chickens/cows in steps with home bias             |  49 |
| neighborNonRoadColor      | Walk ring to find adjacent non-road terrain color        |  20 |
| drawCells                 | Render viewport of cells with terrain/tilling/roads      | 262 |
| worldMetersToScreen       | Convert world meters to viewport screen coords           |   6 |
| screenToWorldMeters       | Convert screen coords to world meters                    |   8 |
| drawObjects               | Render objects/creatures/flora with sorting              | 254 |
| renderPool                | Sprite-pool renderer for batch display                   |  16 |
| handleWorldTap            | Process all tap interactions (cells, creatures, chests)  | 394 |
| cellAt                    | Lookup cell type/loaded state at world meters            |  10 |
| catchCreature             | Add creature to inventory on catch                       |   6 |
| teleportNextPoi           | Debug: jump to next-nearest decorated POI chest          |  66 |
| flash                     | Show brief popup message at xy                           |   9 |
| flashLoot                 | Show scaled loot popup at viewport center                |  39 |
| updateHUD                 | Render coords/tile/gps debug info                        |  19 |
| shopInteract              | Show sell/buy modal for house tap                        |  66 |
| buildShopOffer            | Generate cash or barter offer for seed purchase          |  41 |
| showOfferModal            | Render yes/no transaction confirmation dialog            |  39 |
| addToInv                  | Add item count to inventory stack                        |  11 |
| buildInventoryDOM         | Render inventory bar with paging and selection           |  91 |
| refreshInventoryHighlight | Update selected slot border color                        |  12 |

---

## Refactor candidates (longest functions)

Functions ≥ 100 LOC, worth breaking up:

| File         | Function        | LOC | Notes                                                 |
|--------------|-----------------|----:|-------------------------------------------------------|
| worldgen.js  | rasterizeTile   | 542 | Polygon/line painting + object spawning + occupancy   |
| app.js       | handleWorldTap  | 394 | Big router across all tap-priority branches           |
| app.js       | drawCells       | 262 | Per-cell terrain + tilling + roads + letters          |
| app.js       | drawObjects     | 254 | All world objects, creatures, planted, flora          |
| app.js       | create          | 250 | Scene setup — pools, masks, inputs, GPS, compass      |
