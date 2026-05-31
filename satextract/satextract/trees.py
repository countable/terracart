"""Tree-crown detection via DeepForest.

Install: `pip install deepforest`. First run downloads ~150 MB of weights.
DeepForest was trained on ~10 cm/px NEON imagery; works on Z19-Z20 satellite
tiles, drops off below that.
"""
from . import geo


def detect_trees(image, origin_px, zoom, score_thresh=0.30,
                 patch_size=400, patch_overlap=0.10, device=None,
                 batch_size=None):
    try:
        from deepforest import main as df_main
    except ImportError as e:
        raise RuntimeError(
            "DeepForest not installed. Try: pip install deepforest"
        ) from e
    import numpy as np

    model = df_main.deepforest()
    try:
        model.load_model("weecology/deepforest-tree")
    except Exception:
        model.use_release()

    # Pick the device: explicit `device` wins, else auto-use CUDA when present.
    if device is None:
        try:
            import torch
            device = "cuda" if torch.cuda.is_available() else "cpu"
        except Exception:
            device = "cpu"
    if device.startswith("cuda"):
        model.config["accelerator"] = "cuda"
        model.config["devices"] = 1
    else:
        model.config["accelerator"] = "cpu"
    if batch_size:
        model.config["batch_size"] = batch_size
    # The model's internal score_thresh pre-filters boxes before our own cut.
    # Keep it just under our requested bar so a low `score_thresh` actually
    # surfaces the extra low-confidence crowns instead of being clipped at 0.1.
    model.config["score_thresh"] = min(model.config.get("score_thresh", 0.1),
                                       score_thresh, 0.05)

    arr = np.array(image)
    # DeepForest >= 2.x dropped the `return_plot` kwarg — predict_tile now
    # always returns a DataFrame of boxes. Older callers that passed it
    # crash with `TypeError: unexpected keyword argument 'return_plot'`.
    boxes = model.predict_tile(
        image=arr,
        patch_size=patch_size,
        patch_overlap=patch_overlap,
    )

    feats = []
    if boxes is None or len(boxes) == 0:
        return feats
    ox, oy = origin_px
    for _, row in boxes.iterrows():
        score = float(row.get("score", 1.0))
        if score < score_thresh:
            continue
        cx = (row["xmin"] + row["xmax"]) / 2.0
        cy = (row["ymin"] + row["ymax"]) / 2.0
        lat, lon = geo.pixel_to_latlon(ox + cx, oy + cy, zoom)
        crown_px = max(row["xmax"] - row["xmin"], row["ymax"] - row["ymin"])
        crown_m = crown_px * geo.meters_per_pixel(lat, zoom)
        feats.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [lon, lat]},
            "properties": {
                "source": "deepforest",
                "kind": "tree",
                "score": score,
                "crown_m": round(crown_m, 2),
            },
        })
    return feats
