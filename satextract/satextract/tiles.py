"""Fetch Esri World Imagery tiles and stitch a mosaic for the bbox.

Esri World Imagery is free for non-commercial use; no API key required.
Tiles are cached on disk so reruns are cheap.
"""
import os
import time
import urllib.request

from PIL import Image

from . import geo

ESRI_URL = (
    "https://server.arcgisonline.com/ArcGIS/rest/services/"
    "World_Imagery/MapServer/tile/{z}/{y}/{x}"
)
USER_AGENT = "satextract/0.1 (https://github.com/countable/terracart)"


def fetch_tile(z, x, y, cache_dir, retries=3):
    path = os.path.join(cache_dir, f"{z}_{x}_{y}.jpg")
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return path
    url = ESRI_URL.format(z=z, x=x, y=y)
    last_err = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=30) as r:
                data = r.read()
            with open(path, "wb") as f:
                f.write(data)
            return path
        except Exception as e:
            last_err = e
            time.sleep(2 ** attempt)
    raise RuntimeError(f"Failed to fetch {url}: {last_err}")


def fetch_mosaic(bbox, zoom, cache_dir="tiles_cache", progress=None):
    """Returns (PIL.Image RGB mosaic, origin_pixel_xy, zoom).

    origin_pixel_xy is the global mercator pixel coord of the mosaic's
    top-left corner, used to convert detection pixel coords back to lat/lon.
    """
    os.makedirs(cache_dir, exist_ok=True)
    tx0, ty0, tx1, ty1 = geo.bbox_to_tile_range(bbox, zoom)
    nx, ny = tx1 - tx0 + 1, ty1 - ty0 + 1
    w, h = nx * geo.TILE_SIZE, ny * geo.TILE_SIZE
    mosaic = Image.new("RGB", (w, h))
    total = nx * ny
    done = 0
    for tx in range(tx0, tx1 + 1):
        for ty in range(ty0, ty1 + 1):
            path = fetch_tile(zoom, tx, ty, cache_dir)
            tile = Image.open(path).convert("RGB")
            mosaic.paste(
                tile,
                ((tx - tx0) * geo.TILE_SIZE, (ty - ty0) * geo.TILE_SIZE),
            )
            done += 1
            if progress:
                progress(done, total)
    origin_px = (tx0 * geo.TILE_SIZE, ty0 * geo.TILE_SIZE)
    return mosaic, origin_px, zoom
