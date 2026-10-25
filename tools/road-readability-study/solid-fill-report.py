#!/usr/bin/env python3
"""Verify and present actual-renderer MD/LG solid-bed captures."""
import html
import json
import sys
from pathlib import Path
from PIL import Image

root = Path(sys.argv[1] if len(sys.argv) > 1 else '/home/claude/.artifacts/mdlg-road-fill')
before = json.loads((root / 'before-metadata-11.json').read_text())
after = json.loads((root / 'after-metadata-11.json').read_text())
old = {(r['variant'], r['restored']): r for r in before['materialAlpha']}
checks = []
for row in after['materialAlpha']:
    key = row['variant'], row['restored']
    if row['variant'] == 'suppressed':
        passed = row['opaque'] == row['pixels']
        description = f"MD/LG cached material ({'restored' if row['restored'] else 'weathered'}): {row['opaque']}/{row['pixels']} pixels fully opaque"
    else:
        passed = row['transparent'] > 0 and row['transparent'] == old[key]['transparent']
        description = f"{row['variant']} ({'restored' if row['restored'] else 'weathered'}): {row['transparent']} fully transparent pixels retained"
    checks.append({'description': description, 'pass': passed})

for row in after['results']:
    # Actual source road canvas includes 64px padding on each side. Its road
    # center follows the center of the central cell (+16px).
    for layer in ['base'] + (['restored'] if row['case'].endswith('restored') else []):
        image = Image.open(root / f"after-{row['case']}-{layer}-11.png").convert('RGBA')
        center = image.width // 2 + 16
        box = (center-60, center-6, center+60, center+6)
        alpha = image.crop(box).getchannel('A')
        count = sum(v == 255 for v in alpha.getdata())
        checks.append({'description': f"{row['case']} actual {layer} road canvas: {count}/1440 interior pixels fully opaque", 'pass': count == 1440, 'region': box})

for name, data in [('before', before), ('after', after)]:
    checks.append({'description': f"{name}: actual Phaser WebGL, zero page/GL errors", 'pass': data['boot']['renderer'] == 2 and not data['errors'] and data['webglError'] == 0})
(root / 'checks.json').write_text(json.dumps(checks, indent=2))
for check in checks:
    print(('PASS' if check['pass'] else 'FAIL') + ' ' + check['description'])
if not all(check['pass'] for check in checks):
    raise SystemExit(1)

parts = ['''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Medium/Large road solid base</title><style>*{box-sizing:border-box}body{margin:0;background:#192019;color:#e7ebdf;font:16px/1.55 system-ui,sans-serif}main{max-width:860px;margin:auto;padding:32px 24px}h1,h2{color:white;line-height:1.2}h1{font-size:35px}h2{margin-top:38px}a{color:#c6dfa7}.pair{display:grid;grid-template-columns:1fr 1fr;gap:18px}figure{margin:0;padding:12px;background:#293326;border-radius:8px}figcaption{margin-bottom:10px;font-weight:600}img{display:block;width:100%;max-width:352px;margin:auto;image-rendering:pixelated}.note{padding:16px;border-left:4px solid #b9d18e;background:#2b3d27}small{color:#b4bfae}li{margin:9px 0}code{color:#cedfb6}@media(max-width:600px){.pair{grid-template-columns:1fr}}</style><main><small>Dragon Hood · actual Phaser WebGL · controlled native 11-cell fixtures</small><h1>Solid beds beneath Medium/Large road cobbles</h1><p class="note">Medium/Large roads now retain a continuous dark grey-turquoise bed between their cobbles, in both weathered and restored states. Small roads and paths keep their open-ground gaps. The road geometry, wider-road priority and terrain-grid painting rules are unchanged.</p><p>Each pair uses identical controlled geometry and daylight in the actual game renderer. Horizontal: the Medium or Large road's <strong>suppressed/rift</strong> pavement. Vertical: <strong>Lantern Row</strong> (5.5 m). Diagonal, upper-left to lower-right: <strong>Confusion Path</strong> (2 m). Each image is a native 352 × 352 game-map capture. Fixture assignments are explicit, not a randomly generated town.</p>''']
for case, title in [('md-weathered','Medium road · secondary · 9 m · weathered'), ('md-restored','Medium road · secondary · 9 m · restored'), ('lg-weathered','Large road · primary · 15 m · weathered'), ('lg-restored','Large road · primary · 15 m · restored')]:
    parts.append(f'<h2>{title}</h2><div class="pair">')
    for label in ['before', 'after']:
        filename = f'{label}-{case}-11.png'
        parts.append(f'<figure><figcaption>{label.title()}</figcaption><a href="{filename}"><img src="{filename}" alt="{label} {title}"></a></figure>')
    parts.append('</div>')
parts.append('<h2>What “solid” means here</h2><p>The cached MD/LG paving material has no transparent holes: its existing cobbles are drawn over a solid bed using the shared weathered rift colour <code>#485553</code>. The existing whole-road presentation alpha remains 0.61 before repair and 0.92 after repair. This creates a continuous bed without changing the road overlay’s overall brightness policy.</p><p>The dusty terrain/rift buffer beneath and beside the vector band is a separate grid-display treatment. This change does not paint new terrain cells or alter that buffer.</p><h2>Pixel verification</h2><ul>')
for check in checks:
    parts.append('<li><strong>PASS</strong> ' + html.escape(check['description']) + '</li>')
parts.append('</ul><p>Pixel reads are confined to this capture harness. The game bakes the road material once during asset preparation and reuses it during rendering.</p>')
parts.append(f'<p><small>Before source SHA-256: {before["sourceSha256"]}<br>After source SHA-256: {after["sourceSha256"]}</small></p><p><a href="before-metadata-11.json">Before metadata</a> · <a href="after-metadata-11.json">After metadata</a> · <a href="checks.json">Pixel checks</a></p></main></html>')
(root / 'index.html').write_text(''.join(parts))
print(root / 'index.html')
