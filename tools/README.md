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
| `npm run test:browser:docker` | Build the browser-test container and run its server and harness. |
| `npm run test:relay` | Run the relay's own test suite. |

An inventory candidate may still be a generator input. Follow
[ASSET_INVENTORY.md](../docs/ASSET_INVENTORY.md) before moving or deleting art.

## Prerequisites

- Node.js runs the headless suite and most audits without browser packages.
  Install root dependencies with `npm ci` for Node Playwright tools. They use
  `playwright-core`, which does not install a browser.
- The local browser harness needs Python 3, the Python `playwright` package,
  and its Chromium installation (`python3 -m playwright install chromium`).
  Start `python3 -m http.server 7731` separately before running it. The Docker
  wrapper provides these dependencies and starts its own server.
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
| `world-art.html`, `enemy-preview.html`, `monster-roster.html`, `poi-preview.html` | World objects, creature art and points of interest. |
| `items.html`, `balancing.html`, `treasure-balancing.html` | Item catalog, economy and treasure comparisons. |
| `foliage_audit.html`, `map_art_dashboard.html`, `sandbox_art_comparison.html` | Art-review surfaces. |
| `compass-test.html` | Compass behavior. |

Adjacent JavaScript and CSS files support these pages. Shared helpers include
`game-loader.js`, `balance-common.js`, `sortable-tables.js` and the catalog data
exporters; they are not separate commands.

## Art previews, generators and data

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

Read the scripts' headers for timing controls and fixture requirements.
Headless rendering timings depend on the machine and graphics backend.
