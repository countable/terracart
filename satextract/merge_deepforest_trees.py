"""Merge filtered DeepForest tree detections into the game's satextract sidecar.

Idempotent: strips any previously-merged deepforest trees first, so re-running
never double-appends. OSM features are left untouched.

Usage:
    python satextract/merge_deepforest_trees.py \
        data/satextract_osm.geojson data/trees_detected_3586athalmer.geojson 0.4
"""
import json
import sys


def main():
    game_path = sys.argv[1]
    det_path = sys.argv[2]
    thresh = float(sys.argv[3]) if len(sys.argv) > 3 else 0.4

    game = json.load(open(game_path, encoding="utf-8"))
    det = json.load(open(det_path, encoding="utf-8"))

    before = len(game["features"])
    game["features"] = [f for f in game["features"]
                        if (f.get("properties") or {}).get("source") != "deepforest"]
    removed = before - len(game["features"])

    kept = 0
    for f in det["features"]:
        p = f.get("properties") or {}
        if p.get("kind") != "tree":
            continue
        if (p.get("score") or 0) < thresh:
            continue
        game["features"].append({
            "type": "Feature",
            "geometry": f["geometry"],
            "properties": {
                "source": "deepforest",
                "kind": "tree",
                "score": round(float(p["score"]), 4),
                "crown_m": p.get("crown_m"),
            },
        })
        kept += 1

    json.dump(game, open(game_path, "w", encoding="utf-8"))
    out = (f"removed_prior_deepforest={removed}\n"
           f"appended_deepforest(score>={thresh})={kept}\n"
           f"total_features={len(game['features'])}\n")
    with open("satextract/_merge_out.txt", "w", encoding="utf-8") as fh:
        fh.write(out)
    sys.stdout.write(out)


if __name__ == "__main__":
    main()
