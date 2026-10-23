#!/usr/bin/env python3
"""Publish a reproducible, self-contained local architecture design study."""
import argparse
import hashlib
import json
import shutil
from pathlib import Path
from build_materials import build as build_materials

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]


def build(out):
    out.mkdir(parents=True, exist_ok=True)
    build_materials(out)
    shutil.copy2(out / 'materials.json', out / 'materials/provenance.json')
    for name in ['index.html', 'study.js', 'renderer.js', 'study.json']:
        shutil.copy2(HERE / name, out / name)
    lib = out / 'lib'
    lib.mkdir(exist_ok=True)
    modules = ['facade-materials.js', 'roof-materials.js', 'city-buildings.js']
    source_manifest = []
    for name in modules:
        path = ROOT / 'src/authored-buildings' / name
        shutil.copy2(path, lib / name)
        source_manifest.append(dict(path=str(path.relative_to(ROOT)), sha256=hashlib.sha256(path.read_bytes()).hexdigest()))
    # Preserve the actual pre-RA temple painter and original plank overlay.
    # Neither is approximated with a new tileset in the selected designs.
    temple = ROOT / 'src/temple_art.js'
    shutil.copy2(temple, lib / 'temple-art.js')
    texture = ROOT / 'src/textures.js'
    source = texture.read_text()
    plank = source.split('function drawWoodFloorTex(', 1)[1].split('\nfunction drawRockTex(', 1)[0]
    dot = source.split('function dot(', 1)[1].split('\nfunction blob(', 1)[0]
    (lib / 'original-surfaces.js').write_text(
        '// Exact shipping plank painter and its disc helper.\n'
        'window.buildingBackgroundColor = color => color;\n'
        'function dot(' + dot + '\nfunction drawWoodFloorTex(' + plank + '\n')
    for path in [temple, texture]:
        source_manifest.append(dict(path=str(path.relative_to(ROOT)), sha256=hashlib.sha256(path.read_bytes()).hexdigest()))
    walls = ROOT / 'src/wall_materials.js'
    shutil.copy2(walls, lib / 'wall-materials.js')
    source_manifest.append(dict(path=str(walls.relative_to(ROOT)), sha256=hashlib.sha256(walls.read_bytes()).hexdigest()))
    for name in ['city-storefront.png', 'city-gearhouse.png']:
        path = ROOT / 'assets/Objects/PPBuildings' / name
        shutil.copy2(path, out / name)
        source_manifest.append(dict(path=str(path.relative_to(ROOT)), sha256=hashlib.sha256(path.read_bytes()).hexdigest()))
    source_manifest.append(dict(path='assets/Objects/PPBuildings/manifest.json', credit='Steampunk City registered source-art textures; see project manifest for original registration.'))
    (out / 'sources.json').write_text(json.dumps(source_manifest, indent=2) + '\n')
    print(f'Study ready: {out}/index.html')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, default=Path('/tmp/temple-fort-study'))
    build(parser.parse_args().out)
