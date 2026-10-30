#!/usr/bin/env python3
"""Publish individual environment concept images against the current variant list."""
import html
import json
import shutil
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'design/road-environment-concepts'
rows=json.loads((ROOT/'design/zone-variants/street-variants.json').read_text())['rows']
OUT.mkdir(parents=True,exist_ok=True)
cards=[]
(OUT/'story-art').mkdir(exist_ok=True)
def view(path,label,title):
    if not (OUT/path).exists():
        return f'<figure><figcaption>{label}</figcaption><div class="pending">Preparing image…</div></figure>'
    return (f'<figure><figcaption>{label}</figcaption><button class="picture" data-image="{path}" '
            f'data-title="{title} · {label}" aria-label="Enlarge {title} · {label}">'
            f'<img src="{path}" alt="{title} · {label}" loading="lazy"></button></figure>')
for n,row in enumerate(rows,1):
    name=html.escape(row['title']); key=row['id']; image=OUT/'images'/f'{key}.webp'
    story=ROOT/'assets/art'/f'{row.get("art") or row["story"]}.webp'
    assert story.exists(), f'Missing story art: {key}'
    shutil.copy2(story,OUT/'story-art'/f'{key}.webp')
    title=f'{n:02} · {name}'
    views=(view(f'images/{key}.webp','New environment concept',title)
           +view(f'story-art/{key}.webp','Existing story art',title)
           +view(f'current-views/{key}.png','Current variant · restored · 20 × 7 cells',title))
    cards.append(f'<article id="{key}" data-variant="{key}"><header><span>{n:02}</span><h2>{name}</h2></header><div class="views">{views}</div><p>{html.escape(row["body"])}</p></article>')

ready=sum((OUT/'images'/f'{r["id"]}.webp').exists() for r in rows)
options=''.join(f'<option value="{r["id"]}">{i:02} · {html.escape(r["title"])}</option>' for i,r in enumerate(rows,1))
page='''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Road environments · concept art</title><style>
*{box-sizing:border-box}body{margin:0;background:#111b16;color:#e4ebdc;font:16px/1.5 system-ui}main{max-width:1600px;margin:auto;padding:28px}nav{display:flex;gap:22px;flex-wrap:wrap}a{color:#c9dcba}h1{font-size:34px;line-height:1.2;margin:22px 0 8px}h2{font-size:21px;margin:0}p{color:#bccbbd;margin:8px 0}.intro{max-width:900px}.controls{position:sticky;top:0;z-index:2;background:#18291f;padding:12px 28px;border-block:1px solid #3a4f3e;display:flex;gap:20px;align-items:center;flex-wrap:wrap}select{padding:8px;max-width:95vw;background:#263c2e;color:inherit;border:1px solid #526756;border-radius:6px;font:inherit}.grid{display:grid;grid-template-columns:1fr;gap:24px}.views{display:grid;grid-template-columns:1.2fr 1fr 1.2fr;gap:12px;padding:0 16px}figure{margin:0;min-width:0}figcaption{font-size:13px;color:#d4dec8;margin-bottom:8px}article{overflow:hidden;border:1px solid #415642;border-radius:10px;background:#1b2c21;scroll-margin-top:85px}article[hidden]{display:none}header{display:flex;align-items:center;gap:14px;padding:14px 18px}header span{font-weight:800;color:#dbc996;font-size:24px}article>p{padding:8px 18px 16px;margin:0;font-size:14px}.picture{display:block;height:330px;padding:0;border:0;width:100%;cursor:zoom-in;background:#101812}.picture img{width:100%;height:100%;object-fit:contain;display:block}.pending{height:330px;display:grid;place-items:center;color:#a9b8a9}dialog{padding:12px;border:1px solid #566c56;border-radius:9px;background:#111b16;color:#e4ebdc;max-width:96vw;max-height:96vh}dialog::backdrop{background:#000c}dialog img{max-width:92vw;max-height:82vh;width:auto;height:auto;display:block;margin:auto}dialog .bar{display:flex;gap:20px;align-items:center;justify-content:space-between;margin-bottom:8px}button{font:inherit}dialog button{padding:6px 14px;cursor:pointer;background:#2e4734;color:inherit;border:1px solid #607860;border-radius:5px}@media(max-width:800px){main{padding:14px}.grid{grid-template-columns:1fr;gap:18px}.views{grid-template-columns:1fr}.picture{height:auto}.picture img{height:auto}.controls{position:static;padding:12px 14px}h1{font-size:28px}}
</style><body><main><nav><a href="/design/zone-variants/index.html#streets">Variant dashboard</a><a href="/mushroom-reference/">Numbered mushrooms</a></nav><h1>Road environments</h1><p class="intro">Compare each new environment concept with its existing story illustration and current game layout. Concept art explores the environment’s feel. Current views are generated test-road previews using game sprites and placement rules, with light guides hidden.</p><p class="intro">The previous surface recommendations are discarded. Barricade’s upright torches are applied in-game.</p></main><div class="controls"><label>Variant <select id="variant"><option value="">All variants</option>'''+options+f'</select></label><span>{ready} / {len(rows)} images ready · click an image to enlarge</span></div><main class="grid">'+''.join(cards)+'''</main><dialog id="viewer"><div class="bar"><strong id="image-title"></strong><a id="download" download>Download image</a><button id="concept-close">Close</button></div><img id="large" alt=""></dialog><script>
const select=document.getElementById('variant'),cards=[...document.querySelectorAll('article[data-variant]')];
function filter(){for(const card of cards)card.hidden=!!select.value&&card.dataset.variant!==select.value;history.replaceState(null,'',select.value?'#'+select.value:location.pathname);}
select.addEventListener('change',filter);if(cards.some(c=>c.id===location.hash.slice(1))){select.value=location.hash.slice(1);filter();}
const viewer=document.getElementById('viewer');for(const button of document.querySelectorAll('[data-image]'))button.addEventListener('click',()=>{document.getElementById('large').src=button.dataset.image;document.getElementById('large').alt=button.dataset.title;document.getElementById('image-title').textContent=button.dataset.title;document.getElementById('download').href=button.dataset.image;viewer.showModal();});
document.getElementById('concept-close').addEventListener('click',()=>viewer.close());viewer.addEventListener('click',e=>{if(e.target===viewer)viewer.close()});
</script></body></html>'''
(OUT/'index.html').write_text(page)
print(f'{ready}/{len(rows)} concept images published')
