#!/usr/bin/env python3
"""Build a standalone, non-destructive review of original story paintings."""
import argparse
import hashlib
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def build(output, archive):
    rows = json.loads((ROOT / 'docs/art/story-crop-recipes.json').read_text())
    output.mkdir(parents=True, exist_ok=True)
    (output / 'originals').mkdir(exist_ok=True)
    for key, row in rows.items():
        kind, path = row['source'].split(':', 1)
        source = (archive if kind == 'artifact' else ROOT) / path
        shutil.copy2(source, output / 'originals' / (key + '.webp'))
        row['url'] = 'originals/' + key + '.webp'
    refs = json.loads((ROOT / 'docs/art/story-style-references.json').read_text())
    (output / 'references').mkdir(exist_ok=True)
    for ref in refs['references']:
        source = archive / 'terracart-art' / ref['archive_path']
        assert hashlib.sha256(source.read_bytes()).hexdigest() == ref['sha256'], ref['id']
        target = output / 'references' / source.name
        shutil.copy2(source, target)
        ref['url'] = 'references/' + source.name
    html = TEMPLATE.replace('__DATA__', json.dumps(rows)).replace('__REFS__', json.dumps(refs['references']))
    (output / 'index.html').write_text(html)
    (output / 'crop-recipes.json').write_text(json.dumps(rows, indent=2) + '\n')
    print(f"Built {sum(bool(r['crop']) for r in rows.values())} crop previews; reference hashes verified: {output}")


TEMPLATE = r'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="artifact-review" content="disabled"><title>Story art · crop review</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#151d1c;color:#e2e0d4;font:16px/1.5 system-ui}main{max-width:1600px;margin:auto;padding:24px}h1{margin:0}p{max-width:900px}a{color:#e1c589}button,input,select,textarea{font:inherit}button,select,input[type=search]{background:#26332e;color:inherit;border:1px solid #647568;border-radius:5px;padding:8px}button{cursor:pointer}label{cursor:pointer}input[type=checkbox]{width:20px;height:20px;vertical-align:middle;accent-color:#dabd77}.toolbar{position:sticky;top:0;z-index:2;background:#151d1cf5;border-block:1px solid #46574d;padding:12px 0;display:flex;gap:12px;align-items:center;flex-wrap:wrap}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,300px),1fr));gap:20px;margin:22px 0}article{background:#202b27;border:1px solid #42534a;border-radius:8px;overflow:hidden}article.selected{border-color:#edcb7d;box-shadow:0 0 0 2px #edcb7d}.frame{aspect-ratio:4/3;position:relative;overflow:hidden;background:#0a0e0d}.frame img{position:absolute;max-width:none;height:auto}.originals .frame{aspect-ratio:auto}.originals .frame img{position:static!important;width:100%!important;height:auto!important}.info{padding:12px}h2{font-size:15px;overflow-wrap:anywhere;margin:0 0 8px}.note{font-size:13px;color:#c5c3af;margin:8px 0}summary{cursor:pointer;padding:12px;background:#25332c}.references img,.exceptions img{width:100%;height:auto;display:block}.references{max-width:1100px}textarea{width:100%;min-height:110px;background:#0e1613;color:inherit;padding:12px}button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid #edcb7d}[hidden]{display:none!important}
</style></head><body><main>
<h1>Story art · original crops</h1><p>Pick the paintings that still need regeneration. These 4:3 previews use original pixels, including preserved originals from before the square remakes. Tight crops remove old text zones; check that important subjects still fit. Game assets and approved reference masters are unchanged.</p>
<details><summary>Approved references — unchanged</summary><div id="references" class="grid references"></div></details>
<div class="toolbar"><input id="search" type="search" aria-label="Find paintings" placeholder="Find chapel, memory, cave…"><select id="category" aria-label="Category"><option value="">All contexts</option></select><label><input id="originals" type="checkbox"> Show full originals</label><label><input id="selected-only" type="checkbox"> Selected only</label><button id="copy">Copy selected keys</button><button id="download">Download choices</button><span id="count" role="status"></span></div>
<p class="note">Chapel introduction is preselected for the requested pixel-style correction. Choices save in this browser. Copy the selected keys back into our conversation when ready.</p>
<div id="grid" class="grid"></div><label for="choices">Selected regeneration targets</label><textarea id="choices" readonly></textarea><p id="message" role="status"></p>
<details><summary>Preserved opening panels and UI art — excluded from cropping</summary><div id="exceptions" class="grid exceptions"></div></details>
</main><script>
const rows=__DATA__, refs=__REFS__, storageKey='terracart.story-crop-review.v1';
let selected=new Set(['booth_chapel_intro']);try{const saved=JSON.parse(localStorage.getItem(storageKey));if(Array.isArray(saved))selected=new Set(saved.filter(k=>rows[k]?.crop));}catch{}
const $=id=>document.getElementById(id), cards=[];
function group(key){if(key.startsWith('booth_'))return 'Shops and booths';if(/^(story|memory|npc)_/.test(key))return 'Story and characters';if(/^(farm|barehand|restore|harvest|plant)/.test(key))return 'Work and restoration';if(/^(cave|shrine|nexus|tower|castle)/.test(key))return 'Places and exploration';return 'Encounters and rewards';}
function text(tag,value){const el=document.createElement(tag);el.textContent=value;return el;}
function originalLink(url){const a=text('a','Open original ↗');a.href=url;a.target='_blank';a.rel='noopener';return a;}
for(const ref of refs){const card=document.createElement('article'),img=new Image();img.src=ref.url;img.alt=ref.id;img.loading='lazy';card.append(img,text('h2',ref.id),text('p',ref.role));$('references').append(card);}
for(const [key,row] of Object.entries(rows)){
 const card=document.createElement('article'),frame=document.createElement('div'),img=new Image(),info=document.createElement('div');card.dataset.key=key;card.dataset.group=group(key);img.src=row.url;img.alt=key.replaceAll('_',' ');img.loading='lazy';info.className='info';info.append(text('h2',key));
 if(!row.crop){card.append(img,info);info.append(text('p',row.exception),originalLink(row.url));$('exceptions').append(card);continue;}
 frame.className='frame';const c=row.crop;img.style.width=(row.width/c.w*100)+'%';img.style.left=(-c.x/c.w*100)+'%';img.style.top=(-c.y/c.h*100)+'%';frame.append(img);
 const label=document.createElement('label'),checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.checked=selected.has(key);checkbox.addEventListener('change',()=>{checkbox.checked?selected.add(key):selected.delete(key);update();});label.append(checkbox,document.createTextNode(' Regenerate'));info.append(label,document.createElement('br'),originalLink(row.url));if(row.note){const note=text('p',row.note);note.className='note';info.append(note);}card.append(frame,info);$('grid').append(card);cards.push(card);
}
for(const name of [...new Set(cards.map(c=>c.dataset.group))].sort()){const o=text('option',name);o.value=name;$('category').append(o);}
function update(){const query=$('search').value.trim().toLowerCase().replaceAll(' ','_');let visible=0;for(const card of cards){const picked=selected.has(card.dataset.key);card.classList.toggle('selected',picked);card.hidden=(!card.dataset.key.includes(query)||($('category').value&&card.dataset.group!==$('category').value)||($('selected-only').checked&&!picked));if(!card.hidden)visible++;}$('grid').classList.toggle('originals',$('originals').checked);$('count').textContent=`${visible} / ${cards.length} paintings · ${selected.size} selected`;$('choices').value=[...selected].sort().join('\n');try{localStorage.setItem(storageKey,JSON.stringify([...selected]));}catch{}}
for(const id of ['search','category','originals','selected-only'])$(id).addEventListener('input',update);
$('copy').onclick=async()=>{try{await navigator.clipboard.writeText($('choices').value);$('message').textContent='Selected keys copied.';}catch{$('choices').focus();$('choices').select();$('message').textContent='Select and copy the keys from this box.';}};
$('download').onclick=()=>{const result={regenerate:[...selected].sort(),crops:Object.fromEntries(Object.entries(rows).filter(([,r])=>r.crop).map(([k,r])=>[k,{source:r.source,...r.crop}]))};const url=URL.createObjectURL(new Blob([JSON.stringify(result,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='story-art-choices.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};update();
</script></body></html>'''


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=Path.home() / '.artifacts/story-art-crop-review')
    parser.add_argument('--archive', type=Path, default=Path.home() / '.artifacts')
    args = parser.parse_args()
    build(args.output, args.archive)
