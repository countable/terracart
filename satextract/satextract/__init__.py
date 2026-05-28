"""Satellite feature extraction for terracart worldgen.

Pulls features from three independent sources and merges them into one
GeoJSON FeatureCollection (EPSG:4326) the game can consume:

  - OSM Overpass    -> structured props already mapped by humans
  - DeepForest      -> individual tree crowns
  - Grounding DINO  -> open-vocabulary detections (dumpsters, sheds, etc.)

Each source is independent; run the ones you have weights / API access for.
"""
