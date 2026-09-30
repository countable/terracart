#!/usr/bin/env python3
"""Export the approved default palette recipes. Requires Pillow + Playwright.

Uses the same canvas mapper as the review page, with no resizing or redrawing.
Original library assets remain intact. No optional zone recipes are exported.
"""
import asyncio
import base64
import io
import json
import os
from pathlib import Path

from PIL import Image
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / 'assets/Objects/Rustic'
SOURCES = {
    'default-grass': ('assets/Objects/Wilderness/Props.png', (160, 0, 16, 16)),
    'default-mushroom': ('assets/Objects/Wilderness/Props.png', (208, 0, 16, 16)),
    'default-bush': ('assets/Objects/Wilderness/bushes.png', (48, 0, 48, 32)),
    'default-tree': ('assets/Objects/Tree.png', (64, 0, 32, 48)),
    'default-grave': ('assets/Objects/Generated/pillar_c.png', (0, 0, 16, 16)),
    'default-clay-pot': ('assets/Objects/Generated/pot.png', (0, 0, 16, 16)),
    'broken-clay-pot': ('assets/Objects/Generated/pot_smashed.png', (0, 0, 16, 16)),
}


async def main():
    direction = json.loads((ROOT / 'docs/art/art-direction.json').read_text())
    plan = direction['spritePlan']
    recipes = plan['defaults'] + [c for c in plan['variants'] if c['id'] == 'broken-clay-pot']
    sources = dict(SOURCES)
    for stage in range(2):
        sources[f'tree-stage-{stage}'] = ('assets/Objects/Tree.png', (stage * 32, 0, 32, 48))
    originals, canvases = {}, []
    for ident, (path, (x, y, w, h)) in sources.items():
        original = Image.open(ROOT / path).convert('RGBA').crop((x, y, x+w, y+h))
        originals[ident] = original
        png = io.BytesIO()
        original.save(png, format='PNG')
        uri = 'data:image/png;base64,' + base64.b64encode(png.getvalue()).decode()
        recipe = 'default-tree' if ident.startswith('tree-stage-') else ident
        canvases.append(f'<canvas id="{ident}" data-recolour="{recipe}" data-source="{uri}"></canvas>')
    payload = json.dumps(dict(palette=direction['palette'], combos=recipes))
    page_html = '<select id="preview-ground"></select><p id="recolour-status"></p>' + ''.join(canvases)
    page_html += '<script id="recolour-data" type="application/json">' + payload + '</script>'
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, executable_path=os.environ.get("CHROMIUM_PATH"))
        page = await browser.new_page()
        await page.set_content(page_html)
        await page.add_script_tag(content=(ROOT / 'tools/nature_recolour.js').read_text())
        await page.wait_for_function("document.documentElement.dataset.recoloursReady || document.documentElement.dataset.recolourError")
        error = await page.evaluate('document.documentElement.dataset.recolourError')
        assert not error, error
        results = await page.locator('canvas').evaluate_all('(cs)=>Object.fromEntries(cs.map(c=>[c.id,c.toDataURL()]))')
        await browser.close()
    images = {}
    for ident, uri in results.items():
        image = Image.open(io.BytesIO(base64.b64decode(uri.split(',')[1]))).convert('RGBA')
        assert image.size == originals[ident].size
        assert image.getchannel('A').tobytes() == originals[ident].getchannel('A').tobytes()
        images[ident] = image
    DEST.mkdir(parents=True, exist_ok=True)
    props = Image.open(ROOT / 'assets/Objects/Wilderness/Props.png').convert('RGBA')
    props.paste(images['default-grass'], (160, 0))
    props.paste(images['default-mushroom'], (35 % 22 * 16, 35 // 22 * 16))
    props.save(DEST / 'Props.png')
    trees = Image.new('RGBA', (160, 48))
    for frame, ident in enumerate(['tree-stage-0', 'tree-stage-1', 'default-tree'], start=1):
        trees.paste(images[ident], (frame * 32, 0))
    trees.save(DEST / 'trees.png')
    for ident, filename in [('default-bush', 'bush'), ('default-grave', 'pillar_c'),
                            ('default-clay-pot', 'pot'), ('broken-clay-pot', 'pot_smashed')]:
        images[ident].save(DEST / (filename + '.png'))
    print('Exported six default recipes, matching tree growth and broken-pot state; alpha preserved.')


if __name__ == '__main__':
    asyncio.run(main())
