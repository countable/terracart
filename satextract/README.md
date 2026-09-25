# satextract

Pull plausible map features (trees, props, structured POIs) out of satellite
imagery for a bbox and emit a single GeoJSON FeatureCollection that Mending
Lane consumes as a sidecar (`data/satextract_osm.geojson`).

Three independent sources, each opt-in via `--sources`:

| source           | what it gives you                        | cost          | needs GPU |
|------------------|------------------------------------------|---------------|-----------|
| `osm`            | benches, monuments, playgrounds, pitches, fountains, bollards, street lamps, trees-that-someone-mapped | free, ~1 s    | no |
| `trees`          | individual tree crowns (DeepForest)      | free, ~CPU-min/km² | helpful |
| `objects`        | open-vocab detections (dumpsters, sheds, goalposts, pools…) | free, GPU-min/km² | yes (CPU works but slow) |

Imagery is **Esri World Imagery**, free for non-commercial use, no API key.
Tiles are cached on disk so reruns cost nothing.

## Install

```bash
cd satextract
python -m venv .venv && source .venv/bin/activate

# minimal install (OSM source only)
pip install -e .

# add trees
pip install -e ".[trees]"

# add open-vocab objects (downloads ~700 MB of torch + Grounding DINO weights on first run)
pip install -e ".[objects]"

# everything
pip install -e ".[all]"
```

## Run

```bash
# Rectangle (min_lat,min_lon,max_lat,max_lon)
python -m satextract.cli \
    --bbox 49.8735,-119.4955,49.8770,-119.4905 \
    --zoom 19 \
    --sources osm,trees,objects \
    --mosaic mosaic.png \
    --out features.geojson \
    --viz features.html

# Or a square around a point (handy for "around my house")
python -m satextract.cli \
    --center 49.8750,-119.4930 --radius_m 150 \
    --sources osm \
    --out around_home.geojson --viz around_home.html
```

`--viz` writes a self-contained Leaflet HTML page (Esri imagery + OSM
toggle, points coloured by source, popups with kind / score / tags).
Open it with `file://` — no server needed.

See `examples/run_kelowna.sh` for the screenshot's neighborhood.

## Output

A GeoJSON FeatureCollection of `Point` features in EPSG:4326. Each feature has:

```json
{
  "type": "Feature",
  "geometry": { "type": "Point", "coordinates": [lon, lat] },
  "properties": {
    "source": "osm" | "deepforest" | "grounding_dino",
    "kind":   "bench" | "tree" | "dumpster" | ...,
    "score":  0.71,           // present on CV sources
    "tags":   { ... }         // present on OSM source
  }
}
```

## How the game uses it

The sidecar is already wired in. `src/worldgen.js` fetches
`data/satextract_osm.geojson` once (`ensureSatextract` — bump its `?v=` when
you regenerate the file), bins the features by z14 tile
(`buildBinsFromGeoJSON`) and injects each tile's share after it rasterizes:
`natural=tree` points become choppable trees, tree rows become shrub
clusters, street furniture becomes low-tier POI chests (`src/loot.js`).
DeepForest crowns below a confidence floor are dropped on load; a crown's
`size` class drives the tree's size (`src/util.js`).

The static file only covers the pre-extracted bbox (around the default Home in
Kelowna). Outside it, the same feature shape comes from a live Overpass query
per tile (`fetchOverpassBin`, cached in IndexedDB, on by default; opt out with
`?overpass=off`). That revives OSM-tagged features only — the CV detections
stay exclusive to the static file.

To regenerate the file:

1. Run the CLI (`--sources osm`, plus `trees` if you want new crowns).
2. Fold classified DeepForest trees into the pristine OSM base with
   `python3 tools/build_tree_sidecar.py` (reads
   `data/satextract_osm.base.geojson` + `data/trees_z20_classified.geojson`,
   writes `data/satextract_osm.geojson`; idempotent). The older
   `satextract/merge_deepforest_trees.py` does the same merge from a raw
   detection file.
3. Bump the `?v=` in `ensureSatextract`.

`compare_trees_osm.py` / `compare_objects_osm.py` match CV detections against
OSM for evaluation; they are not part of the pipeline.

## Tuning

- **Resolution**: zoom 19 is a good default. Zoom 20 (where available) helps
  Grounding DINO see goalposts and dumpsters; zoom 18 is fine for trees.
- **Prompts**: pass `--prompts "a,b,c"` to override `objects.DEFAULT_PROMPTS`.
  Phrasing matters — "soccer goalpost" works better than "goal".
- **Thresholds**: `--box_threshold` (objects) and `--tree_score_thresh`
  (trees). Lower to recall more, higher to cut noise.
- **Model**: `--model base` swaps Grounding DINO-tiny for the SwinB checkpoint
  — much better recall at ~3–5× the runtime.
- **Tile size**: `--tile_size` (default 1024 px). Smaller crops find smaller
  objects but increase wall time.
- **Filtering**: `--exclude_kinds bus_stop,pitch,...` drops classes the game
  already gets from the vector tiles.

## Limits

- DeepForest was trained on NEON 10 cm/px aerial imagery. Z19 satellite tiles
  are ~30 cm/px at this latitude — usable but noisier than the paper numbers.
- Grounding DINO-tiny (the default) is the fastest checkpoint and the
  weakest; see `--model base` above.
- OSM coverage is uneven. Dense urban areas are well-tagged; suburbs are
  spotty for street furniture and almost empty for dumpsters / sheds.
