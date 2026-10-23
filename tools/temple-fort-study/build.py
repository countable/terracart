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
