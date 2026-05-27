# satextract

Pull plausible map features (trees, props, structured POIs) out of satellite
imagery for a bbox and emit a single GeoJSON FeatureCollection the game can
consume.

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
python -m satextract.cli \
    --bbox 49.8735,-119.4955,49.8770,-119.4905 \
    --zoom 19 \
    --sources osm,trees,objects \
    --mosaic mosaic.png \
    --out features.geojson
```

bbox is `min_lat,min_lon,max_lat,max_lon`.

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

## Wiring into terracart

The game's `worldgen.js` already loads MVT tiles by `(z=14, x, y)`. To add a
satextract layer:

1. Run the CLI for the bbox of one MVT tile (or a few) and save the resulting
   GeoJSON next to the MVT cache.
2. In `worldgen.js`, after the existing POI / building pass, load the GeoJSON
   and for each feature project `(lon, lat)` into the same 5 m game-cell grid
   the MVT pipeline uses, then place a sprite keyed off `properties.kind`.
3. The `kind` strings are stable; map them in `assets.js` to existing sprites
   (e.g. `tree` → `Maple Tree.png`, `bench` → a new 16×16 sprite).

The two pipelines stay decoupled: MVT continues to drive terrain classes and
chest POIs; satextract just sprinkles extra props on top.

## Tuning

- **Resolution**: zoom 19 is a good default. Zoom 20 (where available) helps
  Grounding DINO see goalposts and dumpsters; zoom 18 is fine for trees.
- **Prompts**: pass `--prompts "a,b,c"` to override `objects.DEFAULT_PROMPTS`.
  Phrasing matters — "soccer goalpost" works better than "goal".
- **Thresholds**: edit `box_threshold` / `text_threshold` in `objects.py`.
  Lower to recall more, higher to cut noise.
- **Tile size**: Grounding DINO is run on 1024 px overlapping crops by
  default. Smaller crops find smaller objects but increase wall time.

## Limits

- DeepForest was trained on NEON 10 cm/px aerial imagery. Z19 satellite tiles
  are ~30 cm/px at this latitude — usable but noisier than the paper numbers.
- Grounding DINO-tiny is the fastest checkpoint and the weakest. Swap
  `MODEL_ID` in `objects.py` to `IDEA-Research/grounding-dino-base` for
  better recall at ~3× the runtime.
- OSM coverage is uneven. Dense urban areas are well-tagged; suburbs are
  spotty for street furniture and almost empty for dumpsters / sheds.
