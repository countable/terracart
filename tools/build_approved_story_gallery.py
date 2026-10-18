#!/usr/bin/env python3
"""Publish the current approved story paintings and unchanged style references."""
import argparse
import json
import shutil
from html import escape
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]

def build(output):
    output.mkdir(parents=True, exist_ok=True)
    images = output / 'images'
    images.mkdir(exist_ok=True)
    manifest = json.loads((ROOT / 'docs/art/approved-story-art.json').read_text())
    methods = {r['key']: r['method'] for r in manifest['pieces'] + manifest.get('opening_frames', [])}
    cards = []
    for src in sorted((ROOT / 'assets/art').glob('*.webp')):
        shutil.copy2(src, images / src.name)
        cards.append(f'<figure data-key="{escape(src.stem)}"><a href="images/{src.name}"><img loading="lazy" src="images/{src.name}"></a><figcaption>{escape(src.stem)}<small>{methods.get(src.stem, "Preserved special panel")}</small></figcaption></figure>')
    refs = json.loads((ROOT / 'docs/art/story-style-references.json').read_text())
    archive = Path(refs['archive_root']).expanduser()
    refcards = []
    for ref in refs['references']:
        src = archive / ref['archive_path']
        name = 'reference-' + src.name
        if ref.get("preview_crop"):
            crop = ref["preview_crop"]
            Image.open(src).crop((crop["x"], crop["y"], crop["x"] + crop["w"], crop["y"] + crop["h"])).save(images / name, lossless=True)
        else:
            shutil.copy2(src, images / name)
        refcards.append(f'<figure><a href="images/{name}"><img src="images/{name}"></a><figcaption>{escape(ref["id"])}<small>{escape(ref["role"])}</small></figcaption></figure>')
    html = '''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Approved story art</title><style>body{background:#20251e;color:#eee8d4;font:16px system-ui;margin:24px}a{color:#dac58b}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px}figure{margin:0;background:#30362c;padding:10px}img{width:100%;height:auto}small{display:block;color:#bbc3ae;margin-top:6px}input{padding:12px;margin:20px 0;width:min(90%,420px)}[hidden]{display:none}</style><a href="../design/">Design dashboard</a><h1>Approved story art</h1><p>Current release: 135 original crops, 36 exports from 35 approved generations, two portrait nightmare frames, and four preserved special panels. Click an image for the full export.</p><h2>Style references</h2><div class="grid">'''+''.join(refcards)+'''</div><h2>Game paintings</h2><input aria-label="Filter paintings" placeholder="Filter by name"><div class="grid" id="paintings">'''+''.join(cards)+'''</div><script>document.querySelector('input').addEventListener('input',e=>{for(const el of document.querySelectorAll('[data-key]'))el.hidden=!el.dataset.key.includes(e.target.value.toLowerCase())})</script></html>'''
    (output / 'index.html').write_text(html)
    print(f'Published {len(cards)} paintings to {output}')

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=Path.home()/'.artifacts/story-art-final')
    build(parser.parse_args().output)
