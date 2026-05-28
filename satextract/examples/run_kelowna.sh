#!/usr/bin/env bash
# Example run for an Athalmer Rd / Barnes Ave block in Kelowna, BC.
# Adjust the bbox to whatever neighborhood you want to extract.
set -euo pipefail
cd "$(dirname "$0")/.."

BBOX="49.8735,-119.4955,49.8770,-119.4905"
ZOOM=19

# 1) Cheapest first: free, instant, no GPU.
python -m satextract.cli \
    --bbox "$BBOX" --zoom "$ZOOM" \
    --sources osm \
    --out features_osm.geojson

# 2) Trees via DeepForest. ~CPU-minutes for a small bbox.
python -m satextract.cli \
    --bbox "$BBOX" --zoom "$ZOOM" \
    --sources trees \
    --mosaic mosaic.png \
    --out features_trees.geojson

# 3) Open-vocab via Grounding DINO. Heavy; use a GPU if you can.
python -m satextract.cli \
    --bbox "$BBOX" --zoom "$ZOOM" \
    --sources objects \
    --prompts "soccer goalpost,dumpster,trash bin,shed,trampoline,parked car,swimming pool,picnic table,shipping container,satellite dish" \
    --out features_objects.geojson
