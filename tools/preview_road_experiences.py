#!/usr/bin/env python3
"""Pair road experience briefs with shipped story art and current layout captures."""
import html
import json
import shutil
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'design/road-experiences'
rows=json.loads((ROOT/'design/zone-variants/street-variants.json').read_text())['rows']
briefs=[]
for path in sorted((ROOT/'tools').glob('road-experience-*.json')):
    briefs.extend(json.loads(path.read_text()))
by_id={r['id']:r for r in briefs}
assert len(briefs)==len(by_id)==len(rows), 'One brief per road variant is required'
assert set(by_id)=={r['id'] for r in rows}
OUT.mkdir(parents=True,exist_ok=True)
(OUT/'story-art').mkdir(exist_ok=True)
def esc(value): return html.escape(value,quote=True)
def view(path,label,title):
    assert (OUT/path).exists(), f'Missing current view: {path}'
    return (f'<figure><figcaption>{label}</figcaption><button class="picture" data-image="{path}" '
            f'data-title="{title} · {label}" aria-label="Enlarge {title} · {label}">'
            f'<img src="{path}" alt="{title} · {label}" loading="lazy"></button></figure>')
cards=[]
for number,row in enumerate(rows,1):
    key=row['id'];brief=by_id[key];title=esc(row['title'])
    story=ROOT/'assets/art'/f'{row.get("art") or row["story"]}.webp'
    assert story.exists(), f'Missing story art: {key}'
    shutil.copy2(story,OUT/'story-art'/f'{key}.webp')
    pictures=view(f'story-art/{key}.webp','Original story art',title)+view(f'current-views/{key}.png','Current variant · restored · 20 × 7 cells',title)
    art=''.join(f'<li>{esc(cue)}</li>' for cue in brief['art'])
    mechanics=[]
    for action in brief['mechanics']:
        assert action['status'] in ('existing','proposed')
        label='In game' if action['status']=='existing' else 'Proposal'
        mechanics.append(f'<li class="{action["status"]}"><span class="badge">{label}</span>{esc(action["text"])}</li>')
    cards.append(f'''<article id="{key}" data-variant="{key}"><header><span class="number">{number:02}</span><h2>{title}</h2></header><div class="body"><div class="visuals">{pictures}</div><div class="brief"><h3>Feeling on entry</h3><p class="feeling">{esc(brief['feeling'])}</p><p class="arrival">{esc(brief['arrival'])}</p><h3>In-game art direction</h3><ul>{art}</ul><h3>Player actions</h3><ul class="mechanics">{''.join(mechanics)}</ul><p class="loop"><b>Play loop</b> {esc(brief['loop'])}</p></div></div></article>''')
options=''.join(f'<option value="{r["id"]}">{i:02} · {esc(r["title"])}</option>' for i,r in enumerate(rows,1))
page='''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Road experiences</title><style>
*{box-sizing:border-box}body{margin:0;background:#111b16;color:#e4ebdc;font:16px/1.5 system-ui}main{max-width:1500px;margin:auto;padding:28px}nav{display:flex;gap:22px;flex-wrap:wrap}a{color:#c9dcba}h1{font-size:34px;margin:22px 0 8px}h2{font-size:24px;margin:0}h3{font-size:13px;text-transform:uppercase;letter-spacing:.07em;color:#afc0a6;margin:20px 0 7px}p{color:#c5d0c0;margin:8px 0}.intro{max-width:1000px}.controls{position:sticky;top:0;z-index:2;background:#18291f;padding:12px 28px;border-block:1px solid #3a4f3e;display:flex;gap:22px;align-items:center;flex-wrap:wrap}select{padding:8px;max-width:95vw;background:#263c2e;color:inherit;border:1px solid #526756;border-radius:6px;font:inherit}.cards{display:grid;gap:24px}article{overflow:hidden;border:1px solid #415642;border-radius:10px;background:#1b2c21;scroll-margin-top:85px}article[hidden]{display:none}header{display:flex;align-items:center;gap:14px;padding:18px 20px;border-bottom:1px solid #344a38}.number{font-weight:800;color:#dbc996;font-size:25px}.body{display:grid;grid-template-columns:.9fr 1.1fr;gap:28px;padding:20px}.visuals{min-width:0;display:flex;flex-direction:column;gap:20px}figure{margin:0;min-width:0}figcaption{font-size:13px;color:#aebfa9;margin-bottom:8px}.picture{display:block;padding:0;border:0;width:100%;cursor:zoom-in;background:#101812}.picture img{width:100%;height:auto;display:block}.brief{min-width:0}.brief h3:first-child{margin-top:0}.feeling{font-size:23px;line-height:1.35;color:#eee6c9;margin:4px 0 10px}.arrival{color:#b8c8b4;font-size:15px}ul{margin:6px 0;padding-left:21px}li{margin:8px 0;color:#d2dccb}.mechanics{list-style:none;padding:0}.mechanics li{padding-left:78px;position:relative}.badge{font-size:10px;text-transform:uppercase;letter-spacing:.04em;border:1px solid #597254;border-radius:4px;padding:2px 6px;position:absolute;left:0;top:3px;color:#bfd9b3}.proposed .badge{color:#e1c38b;border-color:#756644}.loop{border-top:1px solid #42573d;margin-top:20px;padding-top:14px;font-size:15px}.loop b{color:#e2d8ae;margin-right:8px}body:has(#show-proposals:not(:checked)) .proposed{display:none}dialog{padding:12px;border:1px solid #566c56;border-radius:9px;background:#111b16;color:#e4ebdc;max-width:96vw;max-height:96vh}dialog::backdrop{background:#000c}dialog img{max-width:92vw;max-height:82vh;width:auto;height:auto;display:block;margin:auto}dialog .bar{display:flex;gap:20px;align-items:center;justify-content:space-between;margin-bottom:8px}button{font:inherit}dialog button{padding:6px 14px;cursor:pointer;background:#2e4734;color:inherit;border:1px solid #607860;border-radius:5px}@media(max-width:850px){main{padding:14px}.body{grid-template-columns:1fr;padding:14px;gap:16px}.controls{position:static;padding:12px 14px}h1{font-size:28px}.feeling{font-size:21px}}
</style><body><main><nav><a href="/design/zone-variants/index.html#streets">Variant dashboard</a><a href="/mushroom-reference/">Numbered mushrooms</a></nav><h1>Road experiences</h1><p class="intro">What each place should make the player feel, and how its art and interactions can deliver that experience.</p><p class="intro">Original story art and current game previews anchor each brief. Art direction describes the target; mechanics marked “Proposal” are not implemented.</p></main><div class="controls"><label>Variant <select id="variant"><option value="">All 32 variants</option>'''+options+'''</select></label><label><input id="show-proposals" type="checkbox" checked>Show proposed mechanics</label></div><main class="cards">'''+''.join(cards)+'''</main><dialog id="experience-viewer"><div class="bar"><strong id="experience-title"></strong><a id="experience-download" download>Download image</a><button id="experience-close">Close</button></div><img id="experience-large" alt=""></dialog><script>
const select=document.getElementById('variant'),cards=[...document.querySelectorAll('article[data-variant]')];
function filter(){for(const card of cards)card.hidden=!!select.value&&card.dataset.variant!==select.value;history.replaceState(null,'',select.value?'#'+select.value:location.pathname);}
select.addEventListener('change',filter);if(cards.some(c=>c.id===location.hash.slice(1))){select.value=location.hash.slice(1);filter();}
const viewer=document.getElementById('experience-viewer');for(const button of document.querySelectorAll('[data-image]'))button.addEventListener('click',()=>{document.getElementById('experience-large').src=button.dataset.image;document.getElementById('experience-large').alt=button.dataset.title;document.getElementById('experience-title').textContent=button.dataset.title;document.getElementById('experience-download').href=button.dataset.image;viewer.showModal();});
document.getElementById('experience-close').addEventListener('click',()=>viewer.close());viewer.addEventListener('click',e=>{if(e.target===viewer)viewer.close()});
</script></body></html>'''
(OUT/'index.html').write_text(page)
(OUT/'experiences.json').write_text(json.dumps(briefs,indent=2)+'\n')
print(f'Published {len(cards)} road experience briefs')
