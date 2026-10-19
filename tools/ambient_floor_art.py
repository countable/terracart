"""Inspected tileset crops for proposed ambient-layout studies, not runtime art.

Coordinates are native 16px tiles. Missing standalone pack paths resolve to the
same named sheet in the combined library; no scaling is applied. Optional manifest tints are shared with the runtime atlas.
"""
import base64
import functools
import io
import json
from pathlib import Path

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]


@functools.lru_cache(maxsize=1)
def _manifest():
    return json.loads((ROOT / 'tools/rockwall-floor-materials.json').read_text())


@functools.lru_cache(maxsize=None)
def _source(key):
    path = ROOT / 'extra_assets' / _manifest()['sheets'][key]
    if not path.exists():
        candidates = sorted(p for p in (ROOT / 'extra_assets/16x16').rglob(path.name)
                            if p.parent.name == 'Tilesets')
        if not candidates:
            raise FileNotFoundError(path)
        path = candidates[0]
    return path


@functools.lru_cache(maxsize=None)
def _crop(sheet, x, y, w=1, h=1, tint=None):
    with Image.open(_source(sheet)) as image:
        bounds = (x * 16, y * 16, (x+w) * 16, (y+h) * 16)
        if bounds[2] > image.width or bounds[3] > image.height:
            raise ValueError(f'Crop outside {sheet}: {bounds}')
        image = image.crop(bounds).convert('RGBA')
        if not image.getbbox():
            raise ValueError(f'Empty crop in {sheet}: {bounds}')
        if tint:
            alpha = image.getchannel('A')
            image = ImageOps.colorize(ImageOps.grayscale(image), (0, 0, 0), tint).convert('RGBA')
            image.putalpha(alpha)
        out = io.BytesIO()
        image.save(out, format='PNG')
    return 'data:image/png;base64,' + base64.b64encode(out.getvalue()).decode()


# Each crop was checked against a numbered contact sheet. Keep the literal art
# identity in the caption when it stands in for a proposed thematic object.
_PROPS = {
    1: {'box': ('sewer', 2, 10, 1, 1, 'sewer crate'),
        'default': ('sewer', 2, 10, 1, 1, 'sewer crate'),
        'barrel': ('sewer', 3, 10, 1, 1, 'sewer barrel'),
        'driftwood': ('sewer', 7, 11, 2, 1, 'sewer planks'),
        'mineralrock': ('sewer', 3, 6, 1, 1, 'cracked sewer slab'),
        'stakes': ('sewer', 10, 9, 1, 3, 'plank crossing')},
    2: {'default': ('mines', 16, 11, 1, 1, 'mine boulder'),
        'mineralrock': ('mines', 5, 33, 1, 1, 'ore-bearing boulder'),
        'crystal_cluster': ('mines', 18, 32, 1, 1, 'green mine crystal'),
        'mushroom': ('mines', 27, 30, 1, 1, 'cave mushrooms'),
        'box': ('mines', 28, 16, 1, 1, 'mine crate'),
        'barrel': ('mines', 20, 17, 1, 1, 'mine pot')},
    3: {'default': ('reborn', 16, 12, 1, 2, 'brown masonry pedestal'),
        'headstone': ('reborn', 17, 10, 1, 2, 'brown stone marker'),
        'box': ('reborn', 0, 29, 1, 1, 'wooden barrel'),
        'barrel': ('reborn', 0, 29, 1, 1, 'wooden barrel'),
        'market_stand': ('reborn', 0, 24, 2, 2, 'wooden supply shelf'),
        'firepit': ('reborn', 16, 28, 1, 2, 'brazier'),
        'crystal_cluster': ('reborn', 17, 16, 1, 1, 'blue gem')},
    4: {'default': ('dungeon', 9, 28, 1, 2, 'blue stone pedestal'),
        'headstone': ('dungeon', 10, 26, 1, 2, 'blue stone pedestal'),
        'box': ('dungeon', 7, 38, 1, 1, 'barrel supply stack'),
        'barrel': ('dungeon', 4, 38, 2, 1, 'banded barrels'),
        'market_stand': ('dungeon', 0, 33, 2, 2, 'supply shelf'),
        'crystal_cluster': ('dungeon', 22, 32, 1, 1, 'blue gem')},
    5: {'default': ('fungal', 0, 18, 1, 1, 'blue mushroom'),
        'mushroom': ('fungal', 0, 19, 2, 2, 'blue mushroom cluster'),
        'wildplant': ('fungal', 0, 17, 2, 1, 'small blue mushrooms'),
        'tree': ('fungal', 16, 27, 3, 3, 'large blue mushroom'),
        'shrine': ('fungal', 16, 22, 3, 3, 'large violet mushroom')},
    6: {'default': ('magma', 16, 11, 1, 1, 'plain basalt boulder'),
        'mineralrock': ('magma', 20, 11, 1, 1, 'lava-cracked boulder'),
        'headstone': ('magma', 17, 22, 1, 2, 'gem-inlaid basalt slab'),
        'crystal_cluster': ('magma', 20, 24, 1, 1, 'red magma crystal'),
        'box': ('magma', 28, 17, 1, 1, 'magma dungeon crate'),
        'barrel': ('magma', 21, 16, 1, 1, 'magma dungeon pot')},
    7: {'default': ('dreams', 31, 7, 1, 2, 'violet temple column'),
        'headstone': ('dreams', 27, 5, 1, 2, 'gold-inlaid temple pillar'),
        'box': ('dreams', 29, 7, 2, 2, 'gold-inlaid temple chest'),
        'coin_pile_6_10': ('dreams', 29, 7, 2, 2, 'gold-inlaid temple chest'),
        'shrine': ('dreams', 25, 7, 2, 2, 'temple wall idol'),
        'crystal_cluster': ('dreams', 23, 17, 1, 1, 'blue temple crystal'),
        'market_stand': ('dreams', 30, 13, 2, 1, 'violet temple bench')},
}


def art_for(depth, prop, helpers):
    """Return image URI plus truthful source/identity labels for a prop seat.

    The caller embeds ``uri`` in SVG <image>; ``label`` identifies the actual
    pictured crop. ``proxy`` flags semantic requests with no specific crop.
    """
    if not depth:
        material = ({'kind': 'wildplant', 'crop': 'mushroom' if prop == 'mushroom' else 'shrub'}
                    if prop in ('mushroom', 'wildplant') else {'kind': prop})
        art = helpers['material_art'](material)
        return dict(uri=helpers['sprite_png'](art['sheet'], art['frames'][0],
                    art.get('preserveFrame', False), art.get('tint', 0xffffff)),
                    label=prop.replace('_', ' '), source='Current surface game art', proxy=False)
    choices = _PROPS[depth]
    sheet, x, y, w, h, label = choices.get(prop, choices['default'])
    return dict(uri=_crop(sheet, x, y, w, h), label=label,
                source=str(_source(sheet).relative_to(ROOT)),
                proxy=prop not in choices, tile=[x, y, w, h])


def floor_materials(depth):
    """Return URI swatches for ground, road, face, water and their source labels.

    Non-sewer water is only a planning proxy: the approved library contains no
    selected water tile for those floors. L6 uses a real magma pool centre.
    """
    if not depth:
        return None
    theme = _manifest()['themes'][depth - 1]
    result = {'cap': theme['cap'], 'label': theme['label'], 'sources': {}}
    for role in ('ground', 'road', 'face', 'groundBroken', 'groundGrate'):
        if role not in theme: continue
        spec = theme[role]
        result[role] = _crop(spec['sheet'], spec['x'], spec['y'], tint=tuple(spec['tint']) if spec.get('tint') else None)
        result['sources'][role] = str(_source(spec['sheet']).relative_to(ROOT))
    if depth == 6:
        result['water'] = _crop('magma', 2, 19)
        result['water_label'] = 'Magma pool study'
    elif depth == 1:
        result['water'] = result['road']
        result['water_label'] = 'Sewer channel water'
    else:
        result['water'] = None
        result['water_label'] = 'Flat water marker; floor water art not selected'
    return result
