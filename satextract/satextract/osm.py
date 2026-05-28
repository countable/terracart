"""OpenStreetMap props via Overpass API.

These are already-curated point features — free, instant, no GPU. Run this
first; only fall back to CV models for things OSM doesn't cover well
(individual trees in unmapped areas, dumpsters, sheds).
"""
import json
import urllib.parse
import urllib.request

OVERPASS = "https://overpass-api.de/api/interpreter"

# Tag selectors worth pulling for in-game props. Add / trim as needed.
DEFAULT_SELECTORS = [
    'node["natural"="tree"]',
    'node["amenity"="bench"]',
    'node["amenity"="waste_basket"]',
    'node["amenity"="waste_disposal"]',
    'node["amenity"="recycling"]',
    'node["amenity"="fountain"]',
    'node["amenity"="bbq"]',
    'node["amenity"="vending_machine"]',
    'node["amenity"="bicycle_parking"]',
    'node["amenity"="post_box"]',
    'node["leisure"="picnic_table"]',
    'node["leisure"="playground"]',
    'node["leisure"="fitness_station"]',
    'node["historic"]',
    'node["tourism"="artwork"]',
    'node["tourism"="information"]',
    'node["man_made"]',
    'node["barrier"="bollard"]',
    'node["barrier"="gate"]',
    'node["highway"="street_lamp"]',
    'node["highway"="bus_stop"]',
    'node["highway"="traffic_signals"]',
    'node["power"="tower"]',
    'node["power"="pole"]',
    'way["leisure"="pitch"]',
    'way["leisure"="playground"]',
    'way["leisure"="swimming_pool"]',
]

KIND_KEYS = (
    "amenity", "leisure", "natural", "historic", "tourism",
    "man_made", "barrier", "highway", "power", "sport",
)


def query(bbox, selectors=DEFAULT_SELECTORS, timeout=60):
    min_lat, min_lon, max_lat, max_lon = bbox
    b = f"({min_lat},{min_lon},{max_lat},{max_lon})"
    parts = ";\n  ".join(s + b for s in selectors)
    ql = f"[out:json][timeout:{timeout}];\n(\n  {parts};\n);\nout center tags;"
    data = urllib.parse.urlencode({"data": ql}).encode()
    req = urllib.request.Request(
        OVERPASS, data=data, headers={"User-Agent": "satextract/0.1"}
    )
    with urllib.request.urlopen(req, timeout=timeout + 10) as r:
        return json.loads(r.read())


def to_features(overpass_json):
    feats = []
    for el in overpass_json.get("elements", []):
        if el["type"] == "node":
            lat, lon = el["lat"], el["lon"]
        elif "center" in el:
            lat, lon = el["center"]["lat"], el["center"]["lon"]
        else:
            continue
        tags = el.get("tags", {})
        kind = next((tags[k] for k in KIND_KEYS if k in tags), "unknown")
        feats.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [lon, lat]},
            "properties": {
                "source": "osm",
                "kind": kind,
                "osm_id": el["id"],
                "osm_type": el["type"],
                "tags": tags,
            },
        })
    return feats
