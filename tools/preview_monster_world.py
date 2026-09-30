#!/usr/bin/env python3
"""Self-contained review of the enabled imported enemies and remaining art gaps."""
import argparse
import base64
import html
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('output', type=Path)
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=True)
source = (ROOT / 'src/enemy_roster.js').read_text()
rows = json.loads(re.sub(r',\s*\]', ']', source.split('const ROWS = ', 1)[1].split(';\n  const ALL', 1)[0]))
new_paths = ('/Pirates/', '/Orcs/', '/Demons/', '/Dragons/', '/GiantCrab.png', '/Necromancer.png', '/Skeleton-Soldier.png')
selected = [r for r in rows if any(p in r['art']['path'] for p in new_paths) or r['id'] in ('plant', 'bone_plant', 'ghost')]
for row in selected:
    row['image'] = 'data:image/png;base64,' + base64.b64encode((ROOT / row['art']['path']).read_bytes()).decode()
variants = json.loads((ROOT / 'docs/zone-variants.json').read_text())['variants']
placements = []
for v in variants:
    g = v.get('guards', {})
    if not g.get('count'):
        continue
    kinds = g.get('kinds') or g.get('choices') or [g.get('kind')]
    placements.append('<tr><td>' + html.escape(v.get('name', v.get('label', v['id']))) + '</td><td>' + str(g['count']) + '</td><td>' + html.escape(', '.join(kinds)) + '</td></tr>')
page = '''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Monster world — implementation and art review</title>
<style>
*{box-sizing:border-box}body{margin:32px auto;max-width:1200px;padding:0 20px;background:#17221d;color:#edf1e8;font:16px/1.5 system-ui}h1{font-size:32px}h2{font-size:22px}a{color:#acd9c5}.summary,.gap,article{padding:18px;background:#24352b;border:1px solid #46604e;border-radius:10px;margin:14px 0}.gap{border-color:#b99b58}#gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px}article{margin:0}article h3{margin:0}canvas{display:block;margin:auto;background:repeating-linear-gradient(0deg,#1b2921 0 31px,#314439 31px 32px);image-rendering:pixelated}small{color:#bacbb9}.controls{position:sticky;top:0;background:#17221df0;padding:12px;z-index:1;display:flex;gap:16px;flex-wrap:wrap}select,button{font:inherit;padding:5px}table{border-collapse:collapse;width:100%;font-size:14px}th,td{padding:9px;border-bottom:1px solid #46604e;text-align:left}.tag{color:#eac675}pre{white-space:pre-wrap;font:14px/1.6 system-ui}
</style>
<h1>Monster world</h1><p>Implemented habitats, enemy art, and remaining art decisions. Source sprites below are the imported runtime files. Warnings and spell effects are drawn by the game.</p>
<div class="summary"><b>Enabled:</b> 19 imported enemy types; 8 of the original 16 composed zones have signature encounters, plus three beach variants. Five street variants have their own enemies. Hungry Marsh and Orc Stronghold are finite habitat sites; Dragon Roost is a single-dragon cave encounter. Demons begin at depth 5; dragons at depth 9. Fourteen size/tint variants remain save-compatible but leave random pools.</div>
<div class="gap"><h2>Art to review</h2><ul>
<li><b>Pirate Cove shrine:</b> uses the shipwreck art as one daily shrine, reserving a 3 × 3 dry-sand footprint and approach. Narrow beaches keep the smaller accessible shrine.</li>
<li><b>Spear Goblin strike:</b> the supplied attack extends beyond its 16px body frame. Movement is animated; attacks currently hold the body pose. Needs a taller-frame animation adapter or an aligned export.</li>
<li><b>Giant Crab claw:</b> no dedicated attack cycle in the supplied sheet. The attack uses its existing pose and combat windup.</li>
<li><b>Dragon breath, bomb blast, summoning and healing:</b> gameplay uses visible geometric warnings and flashes. Bespoke pixel effects would improve the presentation.</li>
<li><b>New place identity:</b> Hungry Marsh, Orc Stronghold and Dragon Roost use existing terrain and creature art. Distinct signs, nest or camp art remain optional visual improvements.</li>
<li><b>Beach presentation:</b> beach stories reuse the grove painting; motifs use stable quarter turns, not shoreline alignment. Map classification requires an explicit beach POI tag.</li>
</ul></div>
<h2>Imported creatures and retained stationary plants</h2><p>Display enlarged to inspect pixels. This gallery previews supplied frames, not combat timing or gameplay scale.</p>
<div class="controls"><label>Direction <select id="direction"><option>down</option><option>up</option><option>left</option><option>right</option></select></label><label>State <select id="state"><option>idle</option><option>move</option><option>attack</option></select></label><label><input id="animate" type="checkbox" checked> Animate</label></div><div id="gallery"></div>
<h2>Finite zone encounters</h2><table><thead><tr><th>Variant</th><th>Guards</th><th>Species</th></tr></thead><tbody>PLACEMENTS</tbody></table>
<p>Roads: Gone to seed → plant; Orchard Lane → farmer goblin; The barricade → spear goblin, with archer support on Hard; Toadstool Lane → spider; Burned Row → existing fire slime. Other streets keep their existing habitat rules.</p>
<details><summary>Implementation notes</summary><pre>NOTES</pre></details>
<script>
const rows=DATA;const cards=[];const gallery=document.querySelector('#gallery');
for(const row of rows){const el=document.createElement('article');const title=document.createElement('h3');title.textContent=row.name;const info=document.createElement('small');info.textContent=`Tier ${row.tier} · ${row.movement.pattern}`;const canvas=document.createElement('canvas');canvas.width=192;canvas.height=144;const note=document.createElement('div');note.className='tag';el.append(title,info,canvas,note);gallery.append(el);const image=new Image();image.src=row.image;cards.push({row,image,canvas,note});}
let clock=0,last=0;function draw(now){if(document.querySelector('#animate').checked)clock+=now-last;last=now;const dir=document.querySelector('#direction').value,state=document.querySelector('#state').value;
for(const c of cards){const a=c.row.art;let frames=a.directions?.[dir]?.[state];let fallback=false;if(!frames&&a.directionLayout==='enemy48'){const d={down:0,left:4,right:4,up:8}[dir];const s={idle:0,move:12,attack:24}[state];frames=[0,1,2,3].map(n=>s+d+n);}if(!frames){frames=a.directions?.[dir]?.idle||[0];fallback=state==='attack';}const f=frames[Math.floor(clock/(a.frameMs||180))%frames.length];const ctx=c.canvas.getContext('2d');ctx.clearRect(0,0,192,144);ctx.imageSmoothingEnabled=false;if(c.image.complete&&c.image.naturalWidth){const cols=c.image.naturalWidth/a.frameWidth;const scale=a.frameWidth>16?3:5;ctx.drawImage(c.image,f%cols*a.frameWidth,Math.floor(f/cols)*a.frameHeight,a.frameWidth,a.frameHeight,(192-a.frameWidth*scale)/2,132-a.frameHeight*scale,a.frameWidth*scale,a.frameHeight*scale);}c.note.textContent=fallback?'Attack pose fallback — art gap':'';}requestAnimationFrame(draw);}requestAnimationFrame(draw);
</script></html>'''
page = page.replace('PLACEMENTS', ''.join(placements)).replace('NOTES', html.escape((ROOT / 'docs/monster-world.md').read_text())).replace('DATA', json.dumps(selected).replace('</', '<\\/'))
(args.output / 'index.html').write_text(page)
(args.output / 'monster-world.md').write_text((ROOT / 'docs/monster-world.md').read_text())
print(f'Wrote {len(selected)} creature previews to {args.output}')
