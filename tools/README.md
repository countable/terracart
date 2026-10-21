# Developer tools

Run commands from the repository root. Tool paths stay stable so existing
scripts, imports and documentation continue to work. The game has no build step.

## Common commands

| Command | Result |
| --- | --- |
| `npm test` | Headless logic tests and static sprite, shell, cache, layout, vignette, modal and layer audits. |
| `npm run cache:check` | Check script hashes and service-worker shell version without writing. |
| `npm run cache:write` | Regenerate hashes in `index.html` and `sw.js` after runtime edits. |
| `npm run assets:inventory` | Report runtime-reference evidence and unused-image candidates; never deletes files. |
| `npm run assets:inventory -- --json` | Machine-readable inventory including file sizes and Git status. |
| `npm run test:browser` | Run the browser harness against a local server on port 7731. |
| `npm run test:viewers -- http://localhost:8000` | Smoke-test the main live design viewers and floor viewer against a running server. |
| `npm run test:browser:docker` | Build the browser-test container and run its server and harness. |
| `npm run test:relay` | Run the relay's own test suite. |
| `node tools/multiplayer-drift.js` | Measure shared-enemy movement drift under different timing, target inputs and terrain fixtures. |
| `node tools/multiplayer-health-drift.js` | Measure shared-enemy health and death disagreement under delayed, omitted and deferred messages. |
| `node tools/multiplayer-sync-drift.js` | Measure event-driven position correction and health recovery with two isolated clients. |

An inventory candidate may still be a generator input. Follow
[ASSET_INVENTORY.md](../docs/art/ASSET_INVENTORY.md) before moving or deleting art.

The multiplayer drift probes execute shipping logic with headless fixtures.
They measure controlled scenarios, not live browser or production-network
performance. Their output states units and assumptions; use it to compare
synchronization changes, alongside `npm test` and `npm run test:relay`.

## Wall material review

`tools/wall-material-preview.html` draws connected hedge and stronghold enclosures,
junctions, and fort palisades with the production material atlas and wall renderer.
The enclosure is one empty cell surrounded by eight occupied cell centres.
Use its heading slider or `?canvas` to compare renderer paths. Run
`node test/wall-material-browser.cjs` against the local server at port 8765;
`WALL_REVIEW_URL` overrides the page URL. It checks both renderers, shared atlas
reuse, retained geometry, pointed-tip visibility, and clearing obsolete walls.

## Rogue Adventure architecture trial

`tools/ra-architecture-preview.html` compares current and RA materials on the
production fort palisade, castle rampart and temple foundation/wall geometry.
Rectangle and concave fixtures share unchanged floor artwork and contextual
hall/tower sprites. This is a standalone material fixture, not a live map or a
production art replacement. Castle and fort floors are plain comparison fills;
temple floors use the native fallback painter. The trial preserves geometric
surfaces while adding UV boundary subdivisions to castle and temple faces.

Extract the installed ElvGames pack and save the viewer to the local artifact
server with:

```sh
python3 tools/build_ra_architecture_materials.py --out ~/.artifacts/ra-architecture-geometry
node tools/check_ra_architecture_geometry.cjs
```

Open `http://localhost:8765/ra-architecture-geometry/`; add `?canvas` for the
fallback renderer. The server must also expose the repository's root game
modules, as the shared artifact server does. The builder records source crops,
hashes and processing in `materials.json`. No source pack is committed or
installed into the game. `STUDY_URL`, `CHROMIUM` and `OUT_DIR` override the
browser checker defaults. It covers 32 footprint/state/family/temple combinations
per renderer, eight screenshot headings, and 361 heading updates with retained
geometry and no Canvas texture allocations, refreshes or pixel readback.

## Fantasy Dreamland castle trial

`tools/fdr-castle-preview.html` compares a castle assembled from native Fantasy
Dreamland Reborn tiles with matching retained 3D geometry. Four broad towers,
connecting walls, a gated courtyard and a central keep share dimensions and
native pixel scale. The fixed 2D view stays south-facing while the geometry rotates.
The builder repeats centre strips to enlarge the source tower into a keep;
`assembly-layout.json` records the source crop, dimensions and projection limits.

```sh
python3 tools/build_fdr_castle_trial.py --out ~/.artifacts/fdr-castle-trial --ref HEAD
node tools/check_fdr_castle_trial.cjs
```

Open `http://localhost:8765/fdr-castle-trial/`; use `?canvas` for the fallback.
The builder snapshots committed renderer modules and records their revision in
`runtime-revision.txt`, isolating reviews from concurrent edits. `sources.json`
records ElvGames attribution, native crops and processing. Assemblies are saved
as `assembled-warm.png` and `assembled-cool.png`, plus enlarged copies.
This isolated fixture does not change live generation or collision; doors are
surface details. Tower corners intentionally project beyond the curtain walls.
The checker verifies both renderers and 361 headings without texture allocations,
refreshes or pixel readback. Captures go to `/tmp/fdr-castle-checks`; `OUT_DIR`,
`STUDY_URL` and `CHROMIUM` override defaults.

## Prerequisites

- Node.js runs the headless suite and most audits without browser packages.
  Install root dependencies with `npm ci` for Node Playwright tools. They use
  `playwright-core`, which does not install a browser.
- The local browser harness needs Python 3, the Python `playwright` package,
  and its Chromium installation (`python3 -m playwright install chromium`).
  Start `python3 -m http.server 7731` separately before running it. The Docker
  wrapper provides these dependencies and starts its own server.
- The browser harness also checks startup of the eight live design viewers:
  monsters, world art, chests, map distribution, treasure, items, map review
  and floors. Each must render its content without JavaScript or console
  errors. Optional tile-fetch fallbacks and generated review snapshots are
  outside this startup check; chests must render sources and reward tables,
  without waiting for the four-city background report. Run
  `npm run test:viewers -- http://localhost:8765` to check the artifact server
  too, including stale mounts. Set `PW_CHROMIUM` for a custom Chromium path
  when running the standalone viewer checks.
- Both browser-harness routes use MVT fixtures under `test/fixtures/`.
  `sh test/fetch_fixtures.sh` fetches them from OpenFreeMap when needed and
  requires network access; it rewrites the fixture files.
- Relay tests need Node.js 18+ and `npm --prefix server ci`.
- Python image previews generally need Pillow; browser captures additionally
  need Python Playwright and Chromium. Check each script's imports and `--help`
  for its specific requirements. Several previews also need local reserve art
  supplied through `--reserve-root`.

## Browser previews and balancing

Serve the repository with `python3 -m http.server 8000`, then open a page under
`http://localhost:8000/tools/`:

| Pages | Purpose |
| --- | --- |
| `map-review.html`, `map-distribution.html`, `building-poly-preview.html` | World placement, zone distribution and building geometry. |
| `floor-viewer.html` | Synthetic region through live surface coverage, nexus dressing and cave generation. |
| `world-art.html`, `enemy-preview.html`, `monster-roster.html`, `poi-preview.html` | World objects, creature art and points of interest. |
| `items.html`, `balancing.html`, `treasure-balancing.html` | Item catalog, economy and treasure comparisons. |
| `foliage_audit.html`, `map_art_dashboard.html`, `sandbox_art_comparison.html` | Art-review surfaces. |
| `compass-test.html` | Compass behavior. |

The item and world art dashboards compare current game art with curated Rogue
Adventure World and Fantasy Dreamland alternatives, plus a third alternatives
column for Dungeon Gathering, Pixel Plains and Sunnyside World, plus the native
16×16 RPG Pack item sheet in the item dashboard.
Open either dashboard with `?alternatives=any` to show all reviewed matches or
`?alternatives=smaller` for the smaller sets; pack filters narrow the review.
Source coordinates and fit notes accompany each candidate. Item mappings live in
`item-art-candidates.js`, world mappings in `world-art-alternatives.json`, and
review images in `art-candidates/`. These files are dashboard-only proposals;
they do not replace runtime art. World thumbnails remove transparent padding
with `art-preview-fit.js` while original-size crop links preserve source pixels
and dimensions. Use native 16px art variants, never the upscaled
32px/48px exports. Crops must fit 16×16 except trees and other tall objects
spanning more than one vertical cell; retain their original pixels.
Monochrome glyph and outline icons are excluded. Dreamland comparisons use its
coloured prop crops. Equipment samples include T1 silhouette studies and proposed
material-colour variants where the source pack provides suitable choices.

In `map-review.html`, clicking bare ground opens terrain, underlying landcover, zone influence,
variant, zone nexus pattern, spawn restrictions and tile/cell coordinates.
The gameplay tier is included when its overlay is enabled.
Click a road or path for its source name/type, rendered variant and width,
assignment length, affinity context, name influences and source feature IDs.
At crossings the popup includes up to three nearby routes; ground details remain expandable.
Map review trims buffered road/path geometry to its owning tile before drawing,
variant counts, and click inspection. Neighboring buffer copies have no local
path assignment and must not appear as additional plain paths.
The game-art layer also draws seeded Spider Path webs on the ground.
Pirate Cove sand has a warm terracotta tint in game art and terrain codes.
The tint follows the exact variant coverage cells, leaving ordinary beach sand,
water and paths unchanged.

In `map-review.html`, the Overlays section toggles path endpoint dots
and path names (visible from zoom 17; unnamed or numeric-only labels are hidden).
White dots mark retained natural/source endpoints without a theme change;
orange marks inferred boundaries and tile cuts, and yellow marks theme transitions.
Boundary selection balances source endpoints, terrain affinity and a soft 300 m
length target. Forks and true ends remain even when sections are shorter.
Removed endpoints are hidden; dots do not necessarily mark trail ends.
Click a dot for source feature IDs and, at section boundaries, the variant,
assignment length, section key and tile.
The street overlay and distribution report use those same assignment sections;
MD roads appear as Old Trade Road and LG roads as Ancient Highway.

`rockwall-3d-preview.html` compares the original north-up cave sprites with the
shared runtime wall materials and full-cell WebGL prisms. Its ground tiles and
sewer pipes remain trial arrangements. `build_floor_wall_materials.py` packs the
approved crops from `rockwall-floor-materials.json` into the tracked
`assets/Objects/Cave/floor-wall-sources.png` strip, records source attribution,
and updates the theme data in `src/floor_wall_materials.js`. Run it after
changing approved material choices; it requires the local `extra_assets` library.
The game, floor viewer and 3D comparison use that shared module.

In `floor-viewer.html`, the variant buttons wrap through the selected floor’s
nexus catalog and rebuild the region with that choice. Natural selection uses
the normal seeded picks. Surface choices apply to the matching nexus kind;
cave choices come from that floor’s profile. Floors without authored nexus
variants disable the buttons. Proposed mode uses the displayed source floor’s
catalog. Placement still obeys the live spawn gates and available space.
Parking-lot quarries receive the selected quarry layout before footprint fitting;
lots that cannot fit it retain the live fitter's fallback.
The sample lot's aisle buffer stays inside the tile so it previews complete
layouts rather than the fixed scatter for incomplete edge fragments. Its southern
buffer is separated from the church halo so the viewer retains a Quarry example;
adjoining church parking is absorbed into Old Stones in normal generation.
Surface street choices cycle small-road themes and path-section themes, including
scenic looks. Medium and large roads keep their fixed identities. Forced path
themes preserve the geographic scenic intervals used for distance credit.
The seed field and New seed button rebuild the region with different review
rolls; Reset restores seed 0, the original generation. The URL retains the
seed for sharing and reloading, and floor/variant changes keep it. This viewer
explicitly builds building garrisons, which gameplay normally wakes near the
player. The preview-only Home safety slider defaults to 50 m, draws a ring
around the labelled Home, and hides enemies seated inside it on the surface.
Set it to 0 to inspect every generated seat; caves are unaffected. It redraws
without rerolling and keeps its radius in the `safetyM` URL parameter. This
simple preview filter does not simulate the game's tier bands, Easy-mode
quiet Home, or daylight rules.
The visible region is 60×35 square cells, backed by the generator’s square tile;
all authored sites lie inside that window. Labels are shown above the canvas
and can be toggled. Cave floors without visible authored areas label the
surface geography as “Below…” instead.

Adjacent JavaScript and CSS files support these pages. Shared helpers include
`game-loader.js`, `balance-common.js`, `sortable-tables.js` and the catalog data
exporters; they are not separate commands.

## Art previews, generators and data

`preview_zone_variants.py` includes shipping path weights, slime paving and guards, and permanent seeded spider webs in its street showcase. Geyser paths show their seeded vents in the active phase and describe their daily shrine. Walking-path samples use half the road sample length and twice the visual scale.

`preview_*.py` and `preview_*_art.js` produce art reviews; the detailed workflows
and source manifests live in [docs/art/README.md](../docs/art/README.md).
For example, with Pillow, Node and the required reserve art available:

```sh
python3 tools/preview_map_art.py --reserve-root /path/to/reserve-art --output ~/.artifacts/map-art-audit
python3 tools/preview_foliage_audit.py --output ~/.artifacts/foliage-audit
```

`export_map_art_painters.js` and `export_foliage_audit.js` export runtime rendering
data for those reviews. `sandbox_capture.js` and `sandbox_candidate_art.js`
support sandbox captures. `build_dashboard_directory.py` indexes generated
review pages.

Design dashboards use `src/sandbox_destinations.js` and `sandbox-links.js` for
links into authored sandbox biomes. After replacing `index.html`, an artifact
server with a single-file Docker bind mount may still serve the old inode;
recreate that server (`docker compose -f ~/.config/artifact-server/compose.yaml
up -d --force-recreate`) to refresh it.

These commands write source, shipped assets or data; read their usage before
running them:

- `gen_story_art.js` calls the image API using `OPENAI_API_KEY`, uses Python
  Pillow to resize outputs, and retains full-resolution painting masters locally.
- `art_thumbs.js` rebuilds the inline thumbnail data in `src/art_thumbs.js`.
- `apply_map_art.py`, `apply_map_art.js`, `apply_nature_recolours.py`,
  `nature_recolour.js`, `cook_icons.js` and `gen_coin_piles.py` prepare or apply art.
- `zone_variant_data.js --write` regenerates `src/zone_variant_data.js` from
  the zone JSON; use `--check` to verify it without writing.
- `build_tree_sidecar.py` rebuilds the runtime GeoJSON from the base OSM and
  classified-tree inputs in `data/`.
- `zone_economy.py` refreshes the economy report; `simulate-chest-themes.js`
  evaluates loot balance. `tree_review.py` supports tree-data inspection.

## Audits and performance

The headless runner includes `sprite_audit.js`, `shell_audit.js`,
`cachebust.js`, `layout_audit.js`, `vignette_audit.js`, `modal_audit.js` and
`layer_audit.js`; see [test/node/README.md](../test/node/README.md) for coverage.
`bench_crops.js` measures crop work.

`perf_loop.js` profiles the render loop and `perf_live.js` profiles live play.
Both use Node Playwright, accept `PW_CHROMIUM` for a browser executable, and
start their own HTTP server. Examples:

```sh
mkdir -p ~/.artifacts/performance
PW_CHROMIUM=/path/to/chromium node tools/perf_loop.js ~/.artifacts/performance/loop.json
PW_CHROMIUM=/path/to/chromium node tools/perf_live.js ~/.artifacts/performance/live
```

`benchmark-cover.js` compares a baseline Git revision's `Lighting.coverFrame`
with the working tree in one live sandbox Chromium page. Both versions use
current visibility rules, alternating identical dense surface and cave
fixtures. It measures retained-blocker movement, cold rebuilds, and stationary
cache hits; JSON includes raw samples, median/p95, source hashes and hardware.
The primary metric covers CPU work and canvas paint commands, without pixel
readbacks, GPU uploads or a full-frame FPS claim. `CPU_THROTTLE=4` adds a
synthetic slowdown, not a phone measurement.

```sh
node tools/benchmark-cover.js BASELINE_GIT_REF ~/.artifacts/performance/cover.json
```

Read the scripts' headers for timing controls and fixture requirements.
Headless rendering timings depend on the machine and graphics backend.

### Walking and loot draft

Open `tools/loot-walk.html` for a two-section Kelowna walking-distance table and
sampled treasure distributions. It loads saved JSON only; no game startup or
simulation runs in the browser. Regenerate both snapshots together with
`node tools/loot-walk-model.js` after generation or reward changes.

The nine fixture tiles provide a finite surface census. A 40 m search corridor
with 70% fresh-route efficiency estimates encounters over walkable area; the
road-prize ladder uses keyboard/stick restoration credit. Samples execute the
shipping reward and enemy payout functions with fixed starting gear and zero
luck. This is an exploration estimate, excluding guaranteed starter supplies,
caves, quest rewards, combat costs and inventory limits. Story gates show their
action/memory requirements because this model does not simulate story progress.
