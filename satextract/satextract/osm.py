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
#
# Curated for things suburban mappers ACTUALLY tag. Tags that exist in OSM
# but are too sparse to be useful (e.g. `natural=rock`, `amenity=parking_space`
# per-spot) are intentionally skipped — they'd inflate the query without
# adding signal.
DEFAULT_SELECTORS = [
    # Vegetation
    'node["natural"="tree"]',
    'way["natural"="tree_row"]',     # hedgerows, lined driveways
    'way["natural"="shrubbery"]',
    # Street furniture
    'node["amenity"="bench"]',
    'node["amenity"="waste_basket"]',
    'node["amenity"="waste_disposal"]',
    'node["amenity"="recycling"]',
    'node["amenity"="fountain"]',
    'node["amenity"="bbq"]',
    'node["amenity"="vending_machine"]',
    'node["amenity"="bicycle_parking"]',
    'node["amenity"="post_box"]',
    'node["amenity"="telephone"]',
    'node["amenity"="drinking_water"]',
    'node["amenity"="shelter"]',     # bus / picnic shelters
    # Leisure
    'node["leisure"="picnic_table"]',
    'node["leisure"="playground"]',
    'node["leisure"="fitness_station"]',
    'way["leisure"="pitch"]',
    'way["leisure"="playground"]',
    'way["leisure"="swimming_pool"]',
    'way["leisure"="garden"]',
    # Heritage / signage
    'node["historic"]',
    'node["tourism"="artwork"]',
    'node["tourism"="information"]',
    'node["man_made"]',
    'way["man_made"="storage_tank"]',
    'way["man_made"="silo"]',
    # Barriers / boundaries — fence is the big new one for suburban yards
    'node["barrier"="bollard"]',
    'node["barrier"="gate"]',
    'way["barrier"="fence"]',
    'way["barrier"="hedge"]',
    'way["barrier"="wall"]',
    'way["barrier"="retaining_wall"]',
    # Lighting / signage / signals
    'node["highway"="street_lamp"]',
    'node["highway"="bus_stop"]',
    'node["highway"="traffic_signals"]',
    'node["highway"="give_way"]',
    'node["highway"="stop"]',
    'node["highway"="crossing"]',
    'node["highway"="speed_camera"]',
    # Power infra
    'node["power"="tower"]',
    'node["power"="pole"]',
    'way["power"="line"]',
    'way["power"="minor_line"]',
    # Outbuildings — sheds + garages
    'way["building"="shed"]',
    'way["building"="garage"]',
    'way["building"="carport"]',
    'way["building"="greenhouse"]',
    # Parking lots / driveways — useful as ground-cover hints (not per-spot)
    'way["amenity"="parking"]',
    # Waterways — small streams + drainage
    'way["waterway"="stream"]',
    'way["waterway"="ditch"]',
]

KIND_KEYS = (
    "amenity", "leisure", "natural", "historic", "tourism",
    "man_made", "barrier", "highway", "power", "sport",
    # Added: streams / creeks / culverts hit `waterway`, sheds / garages /
    # carports hit `building`. Without these in the priority list those
    # features came back tagged but with kind="unknown".
    "waterway", "building",
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
