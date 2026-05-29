"""Open-vocabulary object detection via Grounding DINO (HuggingFace).

Install: `pip install transformers torch torchvision pillow`.
Runs on CPU but slow; with a CUDA GPU expect ~1-3 s per 1024px tile.

We tile the mosaic into overlapping crops because Grounding DINO loses small
objects at low input resolution. NMS dedupes overlap.
"""
from . import geo

DEFAULT_PROMPTS = [
    "tree",
    "soccer goalpost",
    "dumpster",
    "trash bin",
    "shed",
    "swimming pool",
    "trampoline",
    "parked car",
    "pickup truck",
    "boat",
    "shipping container",
    "solar panel",
    "playground equipment",
    "tennis court",
    "basketball court",
    "picnic table",
    "satellite dish",
]

MODEL_ID = "IDEA-Research/grounding-dino-tiny"


def _load():
    import torch
    from transformers import AutoModelForZeroShotObjectDetection, AutoProcessor
    device = "cuda" if torch.cuda.is_available() else "cpu"
    processor = AutoProcessor.from_pretrained(MODEL_ID)
    model = AutoModelForZeroShotObjectDetection.from_pretrained(MODEL_ID).to(device)
    return processor, model, device


def _iou(a, b):
    ax0, ay0, ax1, ay1 = a
    bx0, by0, bx1, by1 = b
    ix0, iy0 = max(ax0, bx0), max(ay0, by0)
    ix1, iy1 = min(ax1, bx1), min(ay1, by1)
    iw, ih = max(0.0, ix1 - ix0), max(0.0, iy1 - iy0)
    inter = iw * ih
    if inter <= 0:
        return 0.0
    ua = (ax1 - ax0) * (ay1 - ay0) + (bx1 - bx0) * (by1 - by0) - inter
    return inter / ua if ua > 0 else 0.0


def _nms(dets, iou_thresh=0.5):
    dets = sorted(dets, key=lambda d: -d["score"])
    keep = []
    for d in dets:
        if any(d["label"] == k["label"] and _iou(d["box"], k["box"]) > iou_thresh
               for k in keep):
            continue
        keep.append(d)
    return keep


def detect_objects(image, origin_px, zoom, prompts=None,
                   tile_size=1024, overlap=192,
                   box_threshold=0.30, text_threshold=0.25,
                   progress=None):
    try:
        import torch  # noqa: F401
    except ImportError as e:
        raise RuntimeError(
            "Install with: pip install transformers torch torchvision pillow"
        ) from e
    import torch

    prompts = prompts or DEFAULT_PROMPTS
    text = ". ".join(p.strip().lower() for p in prompts) + "."

    processor, model, device = _load()

    W, H = image.size
    step = tile_size - overlap
    crops = []
    for y0 in range(0, max(1, H - overlap), step):
        for x0 in range(0, max(1, W - overlap), step):
            x1, y1 = min(x0 + tile_size, W), min(y0 + tile_size, H)
            crops.append((x0, y0, x1, y1))

    all_dets = []
    for i, (x0, y0, x1, y1) in enumerate(crops):
        crop = image.crop((x0, y0, x1, y1))
        inputs = processor(images=crop, text=text, return_tensors="pt").to(device)
        with torch.no_grad():
            outputs = model(**inputs)
        # transformers ≥ 4.40 renamed the threshold kwargs:
        # box_threshold → threshold, text_threshold dropped from this fn.
        # Try the new signature first, fall back to the old one.
        try:
            results = processor.post_process_grounded_object_detection(
                outputs,
                inputs.input_ids,
                threshold=box_threshold,
                text_threshold=text_threshold,
                target_sizes=[crop.size[::-1]],
            )[0]
        except TypeError:
            results = processor.post_process_grounded_object_detection(
                outputs,
                inputs.input_ids,
                box_threshold=box_threshold,
                text_threshold=text_threshold,
                target_sizes=[crop.size[::-1]],
            )[0]
        # Newer API uses `text_labels` instead of `labels`.
        label_key = "text_labels" if "text_labels" in results else "labels"
        for box, score, label in zip(results["boxes"], results["scores"], results[label_key]):
            bx0, by0, bx1, by1 = [float(v) for v in box.tolist()]
            all_dets.append({
                "box": (bx0 + x0, by0 + y0, bx1 + x0, by1 + y0),
                "score": float(score),
                "label": label,
            })
        if progress:
            progress(i + 1, len(crops))

    dets = _nms(all_dets)

    feats = []
    ox, oy = origin_px
    for d in dets:
        bx0, by0, bx1, by1 = d["box"]
        cx, cy = (bx0 + bx1) / 2.0, (by0 + by1) / 2.0
        lat, lon = geo.pixel_to_latlon(ox + cx, oy + cy, zoom)
        mpp = geo.meters_per_pixel(lat, zoom)
        feats.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [lon, lat]},
            "properties": {
                "source": "grounding_dino",
                "kind": d["label"],
                "score": round(d["score"], 3),
                "w_m": round((bx1 - bx0) * mpp, 2),
                "h_m": round((by1 - by0) * mpp, 2),
            },
        })
    return feats
