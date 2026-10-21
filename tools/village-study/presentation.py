"""Publish the verified renderer study as a portable static comparison."""
import argparse
import html
import json
from pathlib import Path
import shutil
import zipfile
from PIL import Image

parser = argparse.ArgumentParser()
parser.add_argument('--capture', type=Path, default=Path('/tmp/ra-building/verified'))
parser.add_argument('--reference', type=Path, default=Path('/tmp/ra-building/reference.gif'))
parser.add_argument('--out', type=Path, default=Path('/tmp/ra-building/presentation'))
args = parser.parse_args()
root = Path(__file__).resolve().parents[2]
out = args.out
out.mkdir(parents=True, exist_ok=True)
for path in args.capture.iterdir():
    if path.is_file() and path.suffix in ('.png', '.json'):
        shutil.copy(path, out / path.name)
    elif path.name == 'crops':
        shutil.copytree(path, out / 'crops', dirs_exist_ok=True)
reference = Image.open(args.reference)
reference.convert('RGB').crop((0, 0, 630, 360)).save(out / 'reference-scene.png')
shutil.copy(args.reference, out / 'reference.gif')
shutil.copy(root / 'tools/village-study/README.md', out / 'README.txt')
with zipfile.ZipFile(out / 'reproduce.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
    for folder in ['tools/village-study', 'tools/jungle-study', 'tools/ra-preview']:
        for path in sorted((root / folder).glob('*')):
            if path.is_file():
                archive.write(path, str(path.relative_to(root)))
    archive.write(root / 'tools/jungle-autotile.js', 'tools/jungle-autotile.js')
manifest = json.loads((root / 'tools/village-study/assets.json').read_text())
(out / 'asset-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
asset_list = html.escape(json.dumps(manifest, indent=2))
page = '''<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Rogue Adventure village · Renderer study</title>
<style>
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#171c17;color:#e4e7d5;font:16px/1.55 system-ui,sans-serif}main{max-width:1360px;margin:auto;padding:28px}h1{font-size:clamp(26px,4vw,40px);line-height:1.15}h2{font-size:21px}p{max-width:850px;color:#c4cbbb}a{color:#cedb9a}img{display:block;max-width:100%;image-rendering:pixelated}section{margin:32px 0}.pair{display:grid;grid-template-columns:1fr 1fr;gap:24px}figure{margin:0}figcaption{padding:10px 0;color:#c4cbbb}.frame{position:relative;max-width:630px;aspect-ratio:630/360;background:#10150f;overflow:hidden}.frame img{width:100%;height:100%;object-fit:contain}.overlay{position:absolute;inset:0;clip-path:inset(0 50% 0 0)}input{width:100%;max-width:630px}button{padding:8px 14px;margin:8px 8px 0 0;background:#303b28;border:1px solid #67774c;color:inherit;cursor:pointer;border-radius:5px}details{background:#242c20;padding:16px;border-radius:8px}pre{font:12px/1.4 monospace;white-space:pre-wrap;overflow-wrap:anywhere}summary{cursor:pointer}small{color:#a7b29b}.links{display:flex;flex-wrap:wrap;gap:18px}@media(max-width:760px){main{padding:18px}.pair{grid-template-columns:1fr}}
</style><main>
<small>ACTUAL GAME RENDERER · AUTHORED MAP INPUT</small>
<h1>Rogue Adventure village</h1>
<p><a href="http://localhost:8017/?sandbox=true&amp;headingUp=false&amp;raPreview=village">Open the playable village preview</a> · WASD/arrows or touch stick · temporary save</p>
<p>A flat village scene built from Rogue Adventure source art. Promotional graphics and cliffs are omitted. The central opening uses the reference’s RA stone-rimmed hatch on the game's ladder-down object. Lamps beside doors are specific to this fixture.</p>
<section class="pair">
<figure><a href="village.png"><img src="village.png" alt="Village recreated through the game renderer"></a><figcaption>Renderer output · flat terrain, no badges or footer.</figcaption></figure>
<figure><img src="reference-scene.png" alt="Original village reference cropped above the promotional footer"><figcaption>Reference scene · original cliffs and corner badges shown for comparison.</figcaption></figure>
</section>
<section><h2>Compare at the same scale</h2><p>Drag to reveal the renderer output over the reference. The composition keeps the original scene dimensions; terrain edges follow the native tile grid.</p>
<div class="frame"><img src="reference-scene.png" alt="Reference underneath"><div class="overlay"><img src="village.png" alt="Renderer output overlay"></div></div>
<label for="wipe">Renderer coverage</label><br><input id="wipe" type="range" min="0" max="100" value="50"><br><button data-value="0">Reference</button><button data-value="50">Half</button><button data-value="100">Renderer</button></section>
<section><h2>Implementation and checks</h2><p>The study uses the game's terrain and object rendering with a reproducible fake map. Source-native autotiling joins the ground. Existing staircase semantics provide the descent action; this scene does not change geographic building or lamp placement.</p>
<p>Rain and animation are not reproduced in this still. Native tile boundaries approximate the reference; the original elevation has been flattened.</p>
<div class="links"><a href="renderer-audit.json">Renderer audit</a><a href="fixture.json">Fake map input</a><a href="asset-manifest.json">Source crops</a><a href="reproduce.zip">Reproducible study code</a><a href="README.txt">Run instructions</a><a href="reference.gif">Original GIF</a></div></section>
<section><details><summary>Exact source asset manifest</summary><pre>ASSET_LIST</pre></details></section>
</main><script>const wipe=document.querySelector('#wipe'),over=document.querySelector('.overlay');function update(){over.style.clipPath=`inset(0 ${100-Number(wipe.value)}% 0 0)`}wipe.addEventListener('input',update);document.querySelectorAll('[data-value]').forEach(b=>b.addEventListener('click',()=>{wipe.value=b.dataset.value;update()}));update();</script></html>'''
(out / 'index.html').write_text(page.replace('ASSET_LIST', asset_list))
print(out)
