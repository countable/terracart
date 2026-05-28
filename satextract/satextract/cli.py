"""CLI: bbox -> features.geojson (+ optional self-contained HTML viewer).

Usage:
    # rectangle
    python -m satextract.cli \
        --bbox 49.8730,-119.4960,49.8765,-119.4900 \
        --sources osm,trees,objects \
        --out features.geojson --viz features.html

    # or square around a point
    python -m satextract.cli \
        --center 49.8750,-119.4930 --radius_m 150 \
        --sources osm --viz around_home.html
"""
import argparse
import json
import math
import sys


def _progress(label):
    def cb(done, total):
        print(f"  {label}: {done}/{total}", file=sys.stderr, end="\r", flush=True)
        if done == total:
            print(file=sys.stderr)
    return cb


def _center_to_bbox(lat, lon, radius_m):
    dlat = radius_m / 111111.0
    dlon = radius_m / (111111.0 * math.cos(math.radians(lat)))
    return (lat - dlat, lon - dlon, lat + dlat, lon + dlon)


def main(argv=None):
    p = argparse.ArgumentParser(prog="satextract")
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--bbox", help="min_lat,min_lon,max_lat,max_lon")
    g.add_argument("--center", help="lat,lon (use with --radius_m)")
    p.add_argument("--radius_m", type=float, default=150,
                   help="half-side of the square bbox around --center (metres)")
    p.add_argument("--zoom", type=int, default=19)
    p.add_argument("--out", default="features.geojson")
    p.add_argument("--cache", default="tiles_cache")
    p.add_argument("--mosaic", default=None,
                   help="optional path to save the stitched satellite mosaic")
    p.add_argument("--sources", default="osm",
                   help="comma list of: osm, trees, objects")
    p.add_argument("--prompts", default=None,
                   help="comma list of Grounding DINO text prompts "
                        "(overrides defaults)")
    p.add_argument("--viz", default=None,
                   help="path to write a self-contained Leaflet HTML viewer")
    args = p.parse_args(argv)

    if args.bbox:
        bbox = tuple(float(x) for x in args.bbox.split(","))
        if len(bbox) != 4:
            p.error("--bbox needs 4 comma-separated floats")
    else:
        parts = [float(x) for x in args.center.split(",")]
        if len(parts) != 2:
            p.error("--center needs lat,lon")
        bbox = _center_to_bbox(parts[0], parts[1], args.radius_m)

    sources = {s.strip() for s in args.sources.split(",") if s.strip()}

    feats = []
    image = origin_px = None
    if sources & {"trees", "objects"}:
        from . import tiles
        print("Fetching satellite tiles…", file=sys.stderr)
        image, origin_px, _ = tiles.fetch_mosaic(
            bbox, args.zoom, args.cache, progress=_progress("tiles")
        )
        if args.mosaic:
            image.save(args.mosaic)
            print(f"  saved {args.mosaic}", file=sys.stderr)

    if "osm" in sources:
        from . import osm
        print("Querying OSM Overpass…", file=sys.stderr)
        feats += osm.to_features(osm.query(bbox))

    if "trees" in sources:
        from . import trees
        print("Running DeepForest…", file=sys.stderr)
        feats += trees.detect_trees(image, origin_px, args.zoom)

    if "objects" in sources:
        from . import objects
        print("Running Grounding DINO…", file=sys.stderr)
        prompts = None
        if args.prompts:
            prompts = [s.strip() for s in args.prompts.split(",") if s.strip()]
        feats += objects.detect_objects(
            image, origin_px, args.zoom, prompts=prompts,
            progress=_progress("dino"),
        )

    fc = {
        "type": "FeatureCollection",
        "bbox": [bbox[1], bbox[0], bbox[3], bbox[2]],
        "features": feats,
    }
    with open(args.out, "w") as f:
        json.dump(fc, f)

    if args.viz:
        from . import visualize
        visualize.render(fc, args.viz)
        print(f"  wrote {args.viz}", file=sys.stderr)

    by_kind = {}
    for ft in feats:
        k = ft["properties"].get("kind", "?")
        by_kind[k] = by_kind.get(k, 0) + 1
    print(f"\nWrote {len(feats)} features to {args.out}", file=sys.stderr)
    for k, n in sorted(by_kind.items(), key=lambda kv: -kv[1])[:25]:
        print(f"  {n:4d}  {k}", file=sys.stderr)


if __name__ == "__main__":
    main()
