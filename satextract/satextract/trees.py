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

    # Color -> species heuristic. We sample a robust mean crown color from the
    # central 60% of each box (ignoring glare/white pixels). From that mean RGB:
    #   greenness = g - max(r, b);  brightness = (r + g + b) / 3
    #   PINE  = dark, green-dominant evergreen  (greenness >= 8 AND brightness < 105)
    #   MAPLE = everything else (lighter / warmer / yellower deciduous canopy)
    # Thresholds were tuned on this mosaic so neither class falls below ~20%.
    # A deterministic per-tree hash (seeded from lat/lon) then promotes ~6% of
    # trees to fruit trees (kind="fruittree"), ~85% apple / ~15% peach.
    GREENNESS_CUT = 8
    BRIGHTNESS_CUT = 105

    def sample_crown_color(arr_img, xmin, ymin, xmax, ymax):
        h, w = arr_img.shape[0], arr_img.shape[1]
        dx = (xmax - xmin) * 0.2
        dy = (ymax - ymin) * 0.2
        x0 = int(max(0, min(w - 1, round(xmin + dx))))
        x1 = int(max(0, min(w, round(xmax - dx))))
        y0 = int(max(0, min(h - 1, round(ymin + dy))))
        y1 = int(max(0, min(h, round(ymax - dy))))
        if x1 <= x0 or y1 <= y0:
            x0 = int(max(0, min(w - 1, round(xmin))))
            x1 = int(max(x0 + 1, min(w, round(xmax))))
            y0 = int(max(0, min(h - 1, round(ymin))))
            y1 = int(max(y0 + 1, min(h, round(ymax))))
        crop = arr_img[y0:y1, x0:x1, :3].reshape(-1, 3).astype(np.float64)
        if crop.shape[0] == 0:
            return (0, 0, 0)
        # ignore near-white (glare) pixels: all channels > 235
        keep = ~((crop[:, 0] > 235) & (crop[:, 1] > 235) & (crop[:, 2] > 235))
        sel = crop[keep] if keep.any() else crop
        mean = sel.mean(axis=0)
        return (int(round(mean[0])), int(round(mean[1])), int(round(mean[2])))

    feats = []
    if boxes is None or len(boxes) == 0:
        return feats
    ox, oy = origin_px
    n_pine = n_maple = 0
    for _, row in boxes.iterrows():
        score = float(row.get("score", 1.0))
        if score < score_thresh:
            continue
        cx = (row["xmin"] + row["xmax"]) / 2.0
        cy = (row["ymin"] + row["ymax"]) / 2.0
        lat, lon = geo.pixel_to_latlon(ox + cx, oy + cy, zoom)
        crown_px = max(row["xmax"] - row["xmin"], row["ymax"] - row["ymin"])
        crown_m = crown_px * geo.meters_per_pixel(lat, zoom)

        # Sampled crown color
        r, g, b = sample_crown_color(
            arr, row["xmin"], row["ymin"], row["xmax"], row["ymax"])
        crown_color = "#{:02x}{:02x}{:02x}".format(r, g, b)

        # Size class from crown diameter (m)
        if crown_m < 2.0:
            size = "small"
        elif crown_m < 3.5:
            size = "medium"
        else:
            size = "large"

        # Evergreen vs deciduous from mean color
        greenness = g - max(r, b)
        brightness = (r + g + b) / 3.0
        if greenness >= GREENNESS_CUT and brightness < BRIGHTNESS_CUT:
            species = "pine"
        else:
            species = "maple"

        # Deterministic fruit override seeded from lat/lon (stable across reruns)
        hh = (int(round(lat * 1e5)) * 73856093) ^ (int(round(lon * 1e5)) * 19349663)
        is_fruit = (hh % 100) < 6
        if is_fruit:
            kind = "fruittree"
            species = "peach" if (hh // 100 % 100) < 15 else "apple"
        else:
            kind = "tree"
            if species == "pine":
                n_pine += 1
            else:
                n_maple += 1

        feats.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [lon, lat]},
            "properties": {
                "source": "deepforest",
                "kind": kind,
                "species": species,
                "score": score,
                "crown_m": round(crown_m, 2),
                "size": size,
                "crown_color": crown_color,
            },
        })
    tot = n_pine + n_maple
    if tot:
        print("[trees] non-fruit split: pine={} ({:.0%}) maple={} ({:.0%})".format(
            n_pine, n_pine / tot, n_maple, n_maple / tot))
    return feats
