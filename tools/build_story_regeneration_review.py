#!/usr/bin/env python3
"""Build a standalone before/after gallery without altering image pixels or game assets."""
import argparse
import hashlib
import json
import re
import shutil
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]


def metadata(path):
    with Image.open(path) as image:
        width, height = image.size
    return {'width': width, 'height': height, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}


def build(manifest, output, originals):
    jobs = json.loads(manifest.read_text())
    if isinstance(jobs, dict):
        jobs = jobs['jobs']
    recipes = json.loads((ROOT / 'docs/art/story-crop-recipes.json').read_text())
    output.mkdir(parents=True, exist_ok=True)
    for folder in ('before', 'after'):
        (output / folder).mkdir(exist_ok=True)
    rows, seen = [], set()
    for job in jobs:
        key = job['key']
        if not re.fullmatch(r'[a-z0-9_]+', key) or key in seen:
            raise ValueError(f'Invalid or repeated key: {key}')
        seen.add(key)
        row = {**job, 'before': None, 'crop': None, 'after': None}
        if not job.get('new_scene'):
            source = originals / (key + '.webp')
            before = output / 'before' / source.name
            shutil.copy2(source, before)
            row['before'] = {'url': 'before/' + source.name, **metadata(before)}
            row['crop'] = recipes[key]['crop']
        generated = Path(job['output_path']).expanduser() if job.get('output_path') else None
        if generated and not generated.is_absolute():
            generated = manifest.parent / generated
        if generated and generated.is_file():
            after = output / 'after' / (key + generated.suffix.lower())
            if after.resolve() != generated.resolve():
                shutil.copy2(generated, after)
            row['after'] = {'url': 'after/' + after.name, **metadata(after)}
            w, h = row['after']['width'], row['after']['height']
            row['after']['is_4_3'] = abs(w / h - 4 / 3) < 0.005
        rows.append(row)
    (output / 'manifest.json').write_text(json.dumps(rows, indent=2) + '\n')
    data = json.dumps(rows).replace('<', '\\u003c')
    (output / 'index.html').write_text(TEMPLATE.replace('__DATA__', data))
    ready = sum(row['after'] is not None for row in rows)
    print(f'Built {ready}/{len(rows)} completed comparisons: {output}')


TEMPLATE = r'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="artifact-review" content="disabled"><title>Story art · selected regenerations</title><style>
*{box-sizing:border-box}body{margin:0;background:#151d1c;color:#e2e0d4;font:16px/1.5 system-ui}main{max-width:1700px;padding:24px;margin:auto}h1{margin:0}a{color:#e1c589}button,input,select,textarea{font:inherit}button,select,input[type=search]{background:#26332e;color:inherit;border:1px solid #647568;border-radius:5px;padding:8px}button,label{cursor:pointer}input[type=checkbox]{width:20px;height:20px;vertical-align:middle;accent-color:#dabd77}.toolbar{position:sticky;top:0;z-index:2;background:#151d1cf5;border-block:1px solid #46574d;padding:12px 0;display:flex;gap:12px;align-items:center;flex-wrap:wrap}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,650px),1fr));gap:24px;margin:24px 0}article{background:#202b27;border:1px solid #42534a;border-radius:8px;overflow:hidden;scroll-margin-top:110px}article.rework{border-color:#edcb7d}article.approved{border-color:#87b9a0}.info{padding:14px}h2{font-size:17px;overflow-wrap:anywhere;margin:0}p{margin:8px 0 12px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:0 8px}.pair.single{grid-template-columns:1fr}.frame{aspect-ratio:4/3;position:relative;overflow:hidden;background:#0a0e0d}.frame.before img{position:absolute;max-width:none;height:auto}.frame.after img{width:100%;height:100%;object-fit:contain;display:block}.caption{font-size:13px;padding:6px 0;color:#c5c3af}.pending{display:grid;place-items:center;height:100%;color:#c5c3af}.choices{display:flex;gap:20px;flex-wrap:wrap}.warning{color:#edcb7d}textarea{width:100%;min-height:100px;background:#0e1613;color:inherit;padding:12px}button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid #edcb7d}[hidden]{display:none!important}@media(max-width:600px){main{padding:12px}.pair{grid-template-columns:1fr}.toolbar{position:static}article{scroll-margin-top:12px}}
</style></head><body><main><h1>Story art · selected regenerations</h1><p>Compare each original 4:3 crop with its revised painting, and review new story scenes. Mark approvals or further changes below. Choices save in this browser. Game assets and approved reference masters remain unchanged.</p><p><a href="../story-art-crop-review/">Original crop grid and approved references ↗</a> · <a href="manifest.json">Image dimensions, hashes and generation requests</a></p><div class="toolbar"><input id="search" type="search" aria-label="Find paintings" placeholder="Find a painting…"><select id="category" aria-label="Category"><option value="">All contexts</option></select><select id="status" aria-label="Review status"><option value="">All statuses</option><option value="unreviewed">Unreviewed</option><option value="approved">Approved</option><option value="rework">Needs changes</option><option value="pending">Generation pending</option></select><button id="copy">Copy rework keys</button><button id="download">Download review</button><span id="count" role="status"></span></div><div id="grid" class="grid"></div><label for="choices">Paintings needing further changes</label><textarea id="choices" readonly></textarea><p id="message" role="status"></p></main><script>
const rows=__DATA__, $=id=>document.getElementById(id), cards=[], storageKey='terracart.story-regeneration-review.v1';let review={};try{review=JSON.parse(localStorage.getItem(storageKey))||{};}catch{}
function text(tag,value){const el=document.createElement(tag);el.textContent=value;return el;}
function group(key){if(key.startsWith('booth_'))return 'Shops and booths';if(key.startsWith('chest_'))return 'Chests';if(key.startsWith('underground_'))return 'Underground';if(key.startsWith('zone_'))return 'Outdoor places';return 'Story and encounters';}
function imagePanel(row,kind){const panel=document.createElement('div'), frame=document.createElement('div');frame.className='frame '+kind;const data=row[kind];if(data){const img=new Image();img.src=data.url;img.alt=row.key.replaceAll('_',' ')+' — '+kind;img.loading='lazy';if(kind==='before'&&row.crop){const c=row.crop;img.style.width=(data.width/c.w*100)+'%';img.style.left=(-c.x/c.w*100)+'%';img.style.top=(-c.y/c.h*100)+'%';}else if(kind==='before'){img.style.width='100%';}frame.append(img);}else{const pending=text('div','Generation pending');pending.className='pending';frame.append(pending);}panel.append(frame);const caption=text('div',kind==='before'?'Before · original crop':row.new_scene?'New scene':'After · regenerated');caption.className='caption';if(data){const link=text('a','Open full image ↗');link.href=data.url;link.target='_blank';link.rel='noopener';caption.append(document.createElement('br'),link);if(kind==='after'&&!data.is_4_3){const note=text('div',`Ratio check: ${data.width} × ${data.height}; displayed without cropping.`);note.className='warning';caption.append(note);}}panel.append(caption);return panel;}
for(const row of rows){const card=document.createElement('article');card.id=row.key;card.dataset.key=row.key;card.dataset.group=row.new_scene?'New story art':group(row.key);card.dataset.pending=!row.after;const header=document.createElement('div');header.className='info';const title=text('h2','');const anchor=text('a',row.key);anchor.href='#'+row.key;title.append(anchor);header.append(title,text('p',row.request||''));const pair=document.createElement('div');pair.className=row.new_scene?'pair single':'pair';if(!row.new_scene)pair.append(imagePanel(row,'before'));pair.append(imagePanel(row,'after'));const controls=document.createElement('div');controls.className='info choices';for(const [value,labelText] of [['approved','Approve'],['rework','Needs changes']]){const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.dataset.status=value;input.disabled=!row.after;input.addEventListener('change',()=>{review[row.key]=input.checked?{status:value,sha256:row.after.sha256}:null;update();});label.append(input,document.createTextNode(' '+labelText));controls.append(label);}card.append(header,pair,controls);$('grid').append(card);cards.push({card,row});}
for(const name of [...new Set(cards.map(({card})=>card.dataset.group))].sort()){const option=text('option',name);option.value=name;$('category').append(option);}
function status(row){const saved=review[row.key];return !row.after?'pending':saved?.sha256===row.after.sha256?saved.status:'unreviewed';}
function update(){const query=$('search').value.trim().toLowerCase();let visible=0;const counts={approved:0,rework:0,pending:0,unreviewed:0};for(const {card,row} of cards){const state=status(row);counts[state]++;card.classList.toggle('approved',state==='approved');card.classList.toggle('rework',state==='rework');for(const input of card.querySelectorAll('input'))input.checked=input.dataset.status===state;card.hidden=(!(row.key+' '+(row.request||'')).toLowerCase().includes(query)||($('category').value&&card.dataset.group!==$('category').value)||($('status').value&&state!==$('status').value));if(!card.hidden)visible++;}$('count').textContent=`${visible} / ${rows.length} paintings · ${counts.approved} approved · ${counts.rework} need changes · ${counts.pending} pending`;$('choices').value=rows.filter(row=>status(row)==='rework').map(row=>row.key).join('\n');try{localStorage.setItem(storageKey,JSON.stringify(review));}catch{}}
for(const id of ['search','category','status'])$(id).addEventListener('input',update);
$('copy').onclick=async()=>{try{await navigator.clipboard.writeText($('choices').value);$('message').textContent='Rework keys copied.';}catch{$('choices').focus();$('choices').select();$('message').textContent='Copy the selected text from this box.';}};
$('download').onclick=()=>{const result=rows.map(row=>({key:row.key,status:status(row),sha256:row.after?.sha256||null,request:row.request}));const url=URL.createObjectURL(new Blob([JSON.stringify(result,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='story-art-regeneration-review.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};update();
</script></body></html>'''

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', required=True, type=Path)
    parser.add_argument('--output', type=Path, default=Path.home() / '.artifacts/story-art-selected-regens')
    parser.add_argument('--originals', type=Path, default=Path.home() / '.artifacts/story-art-crop-review/originals')
    args = parser.parse_args()
    build(args.manifest.expanduser().resolve(), args.output.expanduser(), args.originals.expanduser())
