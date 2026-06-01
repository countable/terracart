"""Rebuild data/satextract_osm.geojson from a pristine OSM base + the latest
classified DeepForest detections. Idempotent: always starts from the base, so
re-running never compounds. Run after regenerating trees_z20_classified.geojson.

    python3 tools/build_tree_sidecar.py
"""
import json, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = os.path.join(ROOT, 'data/satextract_osm.base.geojson')
CLS  = os.path.join(ROOT, 'data/trees_z20_classified.geojson')
OUT  = os.path.join(ROOT, 'data/satextract_osm.geojson')
# Detection bbox (lat/lon) — within it, base trees are replaced by classified.
LAT0, LAT1 = 49.851674997299995, 49.8570750027
LON0, LON1 = -119.48283618725074, -119.47446061274925
TREEK = {'tree', 'fruittree'}

def inbox(f):
    lon, lat = f['geometry']['coordinates']
    return LON0 <= lon <= LON1 and LAT0 <= lat <= LAT1

base = json.load(open(BASE)); cls = json.load(open(CLS))
kept = [f for f in base['features']
        if not (f['properties'].get('kind') in TREEK and inbox(f))]
base['features'] = kept + cls['features']
json.dump(base, open(OUT, 'w'))

from collections import Counter
c = Counter(f['properties'].get('kind') for f in base['features'])
sp = Counter(f['properties'].get('species') for f in cls['features'])
print(f"sidecar: {len(base['features'])} features  tree={c.get('tree')} "
      f"fruittree={c.get('fruittree')}  | classified species={dict(sp)}")
