"""Compare Grounding DINO open-vocab detections against OSM near a point.

Answers: "what did the CV model find that OSM does NOT map here?"

Reads a satextract FeatureCollection containing both `grounding_dino` and `osm`
features, cleans up DINO's garbled multi-token labels, buckets each detection
into a canonical kind, and decides per detection whether OSM already has an
equivalent feature within `--match_m`. Anything with no OSM equivalent nearby
is a "novel" detection -- a gap in OSM coverage.

Usage:
    python compare_objects_osm.py IN.geojson OUT.json [--match_m 25] [--min_score 0.3]
"""
import argparse
import json
import math
from collections import defaultdict

# Canonical DINO kinds we prompt for. _canonical() matches longest-first so a
# concatenated label ("tennis court court", "swimming pool garden pond") is
# attributed to its most specific phrase. Add new prompts here too.
CANONICAL = [
    "soccer goalpost", "shipping container", "playground equipment",
    "basketball court", "satellite dish", "swimming pool", "picnic table",
    "pickup truck", "storage tank", "tennis court", "water tank",
    "parked car", "trampoline", "solar panel", "greenhouse", "dumpster",
    "trash bin", "boat", "shed", "grave",
    # car-free "visually interesting" vocabulary
    "garden shed", "garden pond", "grain silo", "swing set", "fire pit",
    "hot tub", "gazebo", "pergola", "sandbox", "statue", "fountain",
]

# Canonical DINO kind -> set of OSM `kind` values that mean the same real thing.
# If an OSM feature of a compatible kind sits within match_m, OSM already has it.
# Kinds with an empty set are things OSM essentially never maps -> always novel.
OSM_EQUIV = {
    "parked car":          set(),                # OSM maps lots, not cars
    "pickup truck":        set(),
    "swimming pool":       {"swimming_pool"},
    "tennis court":        {"pitch"},
    "basketball court":    {"pitch"},
    "soccer goalpost":     {"pitch"},
    "picnic table":        {"picnic_table"},
    "dumpster":            {"waste_disposal", "recycling"},
    "trash bin":           {"waste_basket", "waste_disposal"},
    "shed":                {"shed"},
    "greenhouse":          {"greenhouse"},
    "playground equipment": {"playground"},
    "storage tank":        {"storage_tank", "silo"},
    "water tank":          {"storage_tank"},
    "solar panel":         set(),
    "trampoline":          set(),
    "satellite dish":      set(),
    "shipping container":  set(),
    "boat":                set(),
    "grave":               {"grave_yard", "cemetery"},
    # car-free vocabulary
    "garden shed":         {"shed"},
    "garden pond":         set(),
    "grain silo":          {"silo", "storage_tank"},
    "swing set":           {"playground"},
    "fire pit":            set(),
    "hot tub":             set(),
    "gazebo":              set(),
    "pergola":             set(),
    "sandbox":             {"playground"},
    "statue":              {"artwork", "memorial"},
    "fountain":            {"fountain"},
}


def _haversine_m(a_lon, a_lat, b_lon, b_lat):
    R = 6371000.0
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    dp = math.radians(b_lat - a_lat)
    dl = math.radians(b_lon - a_lon)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


_CANON_BY_LEN = sorted(CANONICAL, key=len, reverse=True)


def _canonical(raw):
    """Map a (possibly garbled) DINO label to a canonical kind, or None."""
    s = (raw or "").lower().replace("#", "").strip()
    for c in _CANON_BY_LEN:        # most specific phrase wins
        if c in s:
            return c
    # last resort: token overlap
    toks = set(s.split())
    for c in _CANON_BY_LEN:
        if toks & set(c.split()):
            return c
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("infile")
    ap.add_argument("outfile")
    ap.add_argument("--match_m", type=float, default=25.0,
                    help="max distance (m) to call a detection 'already in OSM'")
    ap.add_argument("--min_score", type=float, default=0.30,
                    help="drop DINO detections below this confidence")
    args = ap.parse_args()

    fc = json.load(open(args.infile, encoding="utf-8"))
    feats = fc["features"]

    osm = []
    dino = []
    for f in feats:
        p = f.get("properties", {})
        lon, lat = f["geometry"]["coordinates"][:2]
        if p.get("source") == "osm":
            osm.append({"lon": lon, "lat": lat, "kind": p.get("kind")})
        elif p.get("source") == "grounding_dino":
            score = p.get("score") or 0.0
            if score < args.min_score:
                continue
            canon = _canonical(p.get("kind"))
            if canon is None:
                continue
            dino.append({"lon": lon, "lat": lat, "canon": canon,
                         "raw": p.get("kind"), "score": score})

    osm_by_kind = defaultdict(list)
    for o in osm:
        osm_by_kind[o["kind"]].append(o)

    # Per detection: matched (OSM has an equivalent nearby) vs novel.
    per_kind = defaultdict(lambda: {"detected": 0, "matched": 0, "novel": 0,
                                    "scores": [], "novel_pts": []})
    for d in dino:
        rec = per_kind[d["canon"]]
        rec["detected"] += 1
        rec["scores"].append(d["score"])
        equiv = OSM_EQUIV.get(d["canon"], set())
        matched = False
        for k in equiv:
            for o in osm_by_kind.get(k, []):
                if _haversine_m(d["lon"], d["lat"], o["lon"], o["lat"]) <= args.match_m:
                    matched = True
                    break
            if matched:
                break
        if matched:
            rec["matched"] += 1
        else:
            rec["novel"] += 1
            rec["novel_pts"].append({"lon": round(d["lon"], 6),
                                     "lat": round(d["lat"], 6),
                                     "score": round(d["score"], 3),
                                     "raw": d["raw"]})

    rows = []
    for kind, rec in per_kind.items():
        equiv = sorted(OSM_EQUIV.get(kind, set()))
        osm_here = sum(len(osm_by_kind.get(k, [])) for k in equiv)
        rows.append({
            "kind": kind,
            "detected": rec["detected"],
            "mean_score": round(sum(rec["scores"]) / len(rec["scores"]), 3),
            "osm_equivalent_kinds": equiv or ["(none — OSM doesn't map this)"],
            "osm_features_of_that_kind_here": osm_here,
            "already_in_osm": rec["matched"],
            "novel_gap": rec["novel"],
            "novel_points": rec["novel_pts"],
        })
    rows.sort(key=lambda r: -r["novel_gap"])

    summary = {
        "match_threshold_m": args.match_m,
        "min_score": args.min_score,
        "osm_total_features": len(osm),
        "dino_total_detections": len(dino),
        "dino_novel_total": sum(r["novel_gap"] for r in rows),
        "by_kind": rows,
    }
    with open(args.outfile, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)

    print(f"OSM features here        : {len(osm)}")
    print(f"DINO detections (>= {args.min_score}) : {len(dino)}")
    print(f"Novel (not in OSM)       : {summary['dino_novel_total']}")
    print()
    print(f"{'kind':22s} {'found':>5s} {'inOSM':>5s} {'GAP':>5s} {'score':>6s}")
    print("-" * 50)
    for r in rows:
        print(f"{r['kind']:22s} {r['detected']:5d} {r['already_in_osm']:5d} "
              f"{r['novel_gap']:5d} {r['mean_score']:6.2f}")
    print(f"\nWrote {args.outfile}")


if __name__ == "__main__":
    main()
