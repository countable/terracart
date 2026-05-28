"""Web-Mercator tile math.

Slippy-map convention: tile (z, x, y) covers a square in EPSG:3857;
pixel (0, 0) is the NW corner of the world at zoom z.
"""
import math

TILE_SIZE = 256


def latlon_to_pixel(lat, lon, zoom):
    n = (2 ** zoom) * TILE_SIZE
    x = (lon + 180.0) / 360.0 * n
    sin_lat = math.sin(math.radians(lat))
    y = (0.5 - math.log((1 + sin_lat) / (1 - sin_lat)) / (4 * math.pi)) * n
    return x, y


def pixel_to_latlon(x, y, zoom):
    n = (2 ** zoom) * TILE_SIZE
    lon = x / n * 360.0 - 180.0
    lat_rad = math.atan(math.sinh(math.pi * (1 - 2 * y / n)))
    return math.degrees(lat_rad), lon


def bbox_to_tile_range(bbox, zoom):
    """bbox = (min_lat, min_lon, max_lat, max_lon). Returns inclusive (tx0, ty0, tx1, ty1)."""
    min_lat, min_lon, max_lat, max_lon = bbox
    x_nw, y_nw = latlon_to_pixel(max_lat, min_lon, zoom)
    x_se, y_se = latlon_to_pixel(min_lat, max_lon, zoom)
    return (
        int(x_nw // TILE_SIZE),
        int(y_nw // TILE_SIZE),
        int(x_se // TILE_SIZE),
        int(y_se // TILE_SIZE),
    )


def meters_per_pixel(lat, zoom):
    return 156543.03392 * math.cos(math.radians(lat)) / (2 ** zoom)
