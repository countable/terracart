"""Compare DeepForest-detected trees against OSM-mapped trees.

Reads a satextract FeatureCollection that contains both `deepforest` (kind=tree)
and `osm` features, isolates the trees from each source, and nearest-neighbour
matches them within a distance threshold. Writes a side-by-side summary +
per-tree match records to JSON.

Usage:
    python compare_trees_osm.py IN.geojson OUT.json [--match_m 8]
"""
import argparse
import json
import math


def _haversine_m(a_lon, a_lat, b_lon, b_lat):
    R = 6371000.0
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    dp = math.radians(b_lat - a_lat)
    dl = math.radians(b_lon - a_lon)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def _trees(features, source):
    out = []
    for f in features:
        p = f.get("properties", {})
        if p.get("kind") != "tree":
            continue
        if source == "deepforest" and p.get("source") not in ("deepforest", "trees"):
            continue
        if source == "osm" and p.get("source") != "osm":
            continue
        lon, lat = f["geometry"]["coordinates"][:2]
        out.append({"lon": lon, "lat": lat, "props": p})
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("infile")
    ap.add_argument("outfile")
    ap.add_argument("--match_m", type=float, default=8.0,
                    help="max distance (m) to call a detected tree the same as an OSM tree")
    args = ap.parse_args()

    fc = json.load(open(args.infile, encoding="utf-8"))
    feats = fc["features"]
    df = _trees(feats, "deepforest")
    osm = _trees(feats, "osm")

    # Greedy nearest-neighbour: for each OSM tree, claim the closest unused
    # detected tree within match_m.
    matched_pairs = []
    used_df = set()
    used_osm = set()
    for oi, o in enumerate(osm):
        best_i, best_d = None, None
        for di, d in enumerate(df):
            if di in used_df:
                continue
            dist = _haversine_m(o["lon"], o["lat"], d["lon"], d["lat"])
            if dist <= args.match_m and (best_d is None or dist < best_d):
                best_i, best_d = di, dist
        if best_i is not None:
            used_df.add(best_i)
            used_osm.add(oi)
            matched_pairs.append({
                "osm": {"lon": o["lon"], "lat": o["lat"],
                        "osm_id": o["props"].get("osm_id")},
                "deepforest": {"lon": df[best_i]["lon"], "lat": df[best_i]["lat"],
                               "score": df[best_i]["props"].get("score")},
                "dist_m": round(best_d, 2),
            })

    osm_only = [{"lon": o["lon"], "lat": o["lat"], "osm_id": o["props"].get("osm_id")}
                for oi, o in enumerate(osm) if oi not in used_osm]
    df_only = [{"lon": d["lon"], "lat": d["lat"], "score": d["props"].get("score")}
               for di, d in enumerate(df) if di not in used_df]

    summary = {
        "match_threshold_m": args.match_m,
        "deepforest_total": len(df),
        "osm_total": len(osm),
        "matched": len(matched_pairs),
        "deepforest_only": len(df_only),
        "osm_only": len(osm_only),
        "osm_recall_pct": round(100 * len(matched_pairs) / len(osm), 1) if osm else None,
        "details": {
            "matched_pairs": matched_pairs,
            "osm_only": osm_only,
            "deepforest_only_sample": df_only[:50],
        },
    }
    with open(args.outfile, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)

    print(f"DeepForest trees : {len(df)}")
    print(f"OSM trees        : {len(osm)}")
    print(f"Matched (<= {args.match_m} m): {len(matched_pairs)}")
    print(f"Detected-only    : {len(df_only)}")
    print(f"OSM-only         : {len(osm_only)}")
    if osm:
        print(f"OSM recall       : {summary['osm_recall_pct']}%")
    print(f"Wrote {args.outfile}")


if __name__ == "__main__":
    main()
