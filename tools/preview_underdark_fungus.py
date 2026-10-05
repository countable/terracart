#!/usr/bin/env python3
"""Export the isolated fungal art study with the current cave texture painters."""
import argparse
import base64
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
html = (ROOT / 'tools/underdark-prototype/index.html').read_text()
for source, path in [('../../src/util.js', ROOT / 'src/util.js'),
                     ('../../src/textures.js', ROOT / 'src/textures.js'),
                     ('prototype.js', ROOT / 'tools/underdark-prototype/prototype.js')]:
    script = path.read_text().replace('</script', '<\\/script')
    html = html.replace(f'<script src="{source}"></script>', f'<script>\n{script}\n</script>')
sprite = ROOT / 'assets/Enemy/Spider/1Fullsheet_Spider.png'
html = html.replace('../../assets/Enemy/Spider/1Fullsheet_Spider.png',
                    'data:image/png;base64,' + base64.b64encode(sprite.read_bytes()).decode())
args.output.mkdir(parents=True, exist_ok=True)
(args.output / 'index.html').write_text(html)
print(args.output / 'index.html')
