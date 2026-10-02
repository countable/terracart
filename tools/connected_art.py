"""Normalize generated cardinal joins without flattening their painted depth."""
from statistics import median
from PIL import Image


def _arm_band(tile, connections, axis):
    """Measure the central band on the outer arms, away from the junction."""
    alpha = tile.getchannel('A')
    width, height = tile.size
    length, breadth = (height, width) if axis == 'x' else (width, height)
    ends = ('N', 'S') if axis == 'x' else ('W', 'E')
    starts, stops = [], []
    for direction, fraction in zip(ends, (0.18, 0.82)):
        if direction not in connections:
            continue
        middle = round((length - 1) * fraction)
        radius = max(1, round(length * 0.035))
        for along in range(max(0, middle - radius), min(length, middle + radius + 1)):
            opaque = [across for across in range(breadth)
                      if alpha.getpixel((across, along) if axis == 'x' else (along, across)) >= 128]
            if opaque:
                starts.append(opaque[0])
                stops.append(opaque[-1] + 1)
    if not starts:
        return round(breadth / 3), round(breadth * 2 / 3)
    return round(median(starts)), round(median(stops))


def _segments(length, band, destination, negative, positive, cross_arm):
    lo, hi = band
    d0, d1 = destination
    if negative and positive:
        if not cross_arm:
            return [(0, length, 0, 24)]
        return [(0, lo, 0, d0), (lo, hi, d0, d1), (hi, length, d1, 24)]
    if positive:
        return [(0, hi, d0, d1), (hi, length, d1, 24)]
    if negative:
        return [(0, lo, 0, d0), (lo, length, d0, d1)]
    return [(0, length, d0, d1)]


def pack_connected(tile, connections, x_band, y_band):
    """Return one 24px frame; resample arms separately from the junction.

    x_band/y_band are half-open destination spans shared by every frame.
    The input is already trimmed to one generated sprite with binary alpha.
    Only cropping and nearest-neighbour packing happen here; faces, shading
    and foliage all come from the generated source, never procedural paint.
    """
    xs = _segments(tile.width, _arm_band(tile, connections, 'x'), x_band,
                   'W' in connections, 'E' in connections, bool(set(connections) & set('NS')))
    ys = _segments(tile.height, _arm_band(tile, connections, 'y'), y_band,
                   'N' in connections, 'S' in connections, bool(set(connections) & set('EW')))
    frame = Image.new('RGBA', (24, 24))
    for sx0, sx1, dx0, dx1 in xs:
        for sy0, sy1, dy0, dy1 in ys:
            if sx1 <= sx0 or sy1 <= sy0 or dx1 <= dx0 or dy1 <= dy0:
                continue
            patch = tile.crop((sx0, sy0, sx1, sy1)).resize((dx1-dx0, dy1-dy0), Image.Resampling.NEAREST)
            frame.alpha_composite(patch, (dx0, dy0))
    return frame
