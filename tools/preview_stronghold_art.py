from pathlib import Path
from PIL import Image
import shutil,json,argparse
parser=argparse.ArgumentParser(description='Preview the six generated foundation wall pieces.');parser.add_argument('output',type=Path);args=parser.parse_args()
src=Path(__file__).resolve().parents[1]/'assets/Objects/Stronghold';out=args.output;out.mkdir(parents=True,exist_ok=True)
for p in src.iterdir():shutil.copy2(p,out/p.name)
frames=json.loads((src/'manifest.json').read_text())['frames'];pieces={f['name']:Image.open(src/(f['name']+'.png')) for f in frames}
im=Image.new('RGBA',(24*7,24*5))
for y in range(5):
 for x in range(7):
  name=None
  if y==0:name='top_left' if x==0 else 'top_right' if x==6 else 'horizontal'
  elif y==4:name='bottom_left' if x==0 else 'bottom_right' if x==6 else 'horizontal'
  elif x in (0,6):name='vertical'
  if name:im.alpha_composite(pieces[name],(x*24,y*24))
im.save(out/'assembled.png')
rows=''.join(f'<tr><td>{f["name"].replace("_"," ")}</td><td><img width="32" height="32" src="{f["name"]}.png"></td><td><img width="96" height="96" src="{f["name"]}.png"></td><td>{f["connections"]}</td></tr>' for f in frames)
(out/'index.html').write_text('''<!doctype html><html lang="en"><meta charset="utf-8"><title>Stronghold wall pieces</title><style>body{background:#1d2922;color:#efeede;font:16px system-ui;margin:32px}a{color:#a8d9d4}img{image-rendering:pixelated}table{border-collapse:collapse}td,th{padding:12px 24px;border-bottom:1px solid #536047;text-align:left}p{max-width:800px;line-height:1.5}.assembly{background:#3c4530;padding:24px;display:inline-block}</style><h1>Stronghold foundations — square-grid pieces</h1><p>Six generated candidates: horizontal, vertical and four right-angle corners. Exact 24×24 transparent frames, shown at 32px map scale. This is a zone-replacement for foundation stones; global stone art stays unchanged. Preview only.</p><p><a href="walls-24.png">Download 24px sheet</a> · <a href="manifest.json">Frame manifest</a> · <a href="source.png">Generated source</a> · <a href="../zone-object-review/">Object review</a></p><h2>Assembled foundation</h2><p>A 7×5-cell rectangle, enlarged 3× from its proposed map size. The generated shapes have been cropped and packed around cell midpoints; join alignment is shown here for review.</p><div class="assembly"><img src="assembled.png" width="672" height="480"></div><h2>Individual pieces</h2><table><thead><tr><th>Piece</th><th>32px map size</th><th>3× detail</th><th>Connects</th></tr></thead><tbody>'''+rows+'</tbody></table></html>')
