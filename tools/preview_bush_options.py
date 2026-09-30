#!/usr/bin/env python3
"""Build a standalone comparison of existing bush sprites; no runtime edits."""
import argparse
import json
import subprocess
from pathlib import Path

from preview_map_art import ROOT, raster

HTML = r'''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bush art options</title>
<style>
:root{color-scheme:dark;font:15px/1.5 system-ui;background:#202820;color:#efeadd}body{margin:0 auto;padding:28px;max-width:1450px}h1{margin:0 0 8px;font-size:30px}p{max-width:900px;color:#c8ccbc}a{color:#cfdb9b}.controls{display:flex;gap:18px;align-items:center;flex-wrap:wrap;margin:22px 0}select{font:inherit;padding:6px;background:#354134;color:inherit;border:1px solid #768265;border-radius:5px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(310px,1fr));gap:18px}article{padding:18px;background:#2a342b;border:1px solid #4b5746;border-radius:12px}h2{font-size:18px;margin:0}article p{font-size:14px;min-height:84px;margin:8px 0}.usage{font-size:12px;color:#d6dba8;min-height:36px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:10px}.sprite{height:135px;background:repeating-conic-gradient(#485047 0% 25%,#3e463d 0% 50%) 0/16px 16px;display:grid;place-items:center;overflow:hidden}canvas{image-rendering:pixelated;max-width:100%;object-fit:contain}.source-label{font-size:12px;margin:5px 0;color:#c4c8ba}.map{display:grid;place-items:center;min-height:100px;overflow:hidden;background:#202820}.path{font-size:11px;color:#9fab94;overflow-wrap:anywhere;margin-top:12px}details{margin-top:12px}summary{cursor:pointer}#status{font-size:12px;color:#afbf99}.palette{display:flex;gap:5px;margin:8px 0}.swatch{width:24px;height:18px;border:1px solid #849076}@media(max-width:400px){body{padding:14px}.grid{grid-template-columns:1fr}}
</style><h1>Bush art options</h1><p>Compare the current woodland bush, lighter restrained treatments and three alternate wild shapes. The clipped hedge stays reserved for managed planting. D is the selected ordinary-bush proposal, with slightly softer contrast. Shipping game art is unchanged.</p><p>Each map sample uses the same 32px cells and fits the visible bush within 22 × 24px without changing its proportions. Raw source pixels are shown beside the treatment. Backgrounds use the current ground proposals and actual game painters.</p><div class="palette" id="palette"></div><div class="controls"><label>Map scale <select id="zoom"><option value="1">Native 1×</option><option value="2" selected>2×</option><option value="3">3×</option></select></label><span id="status">Loading sprites…</span><a href="http://localhost:8765/sandbox-art-comparison/index.html">Sandbox comparison</a></div><main class="grid" id="cards"></main>
<script>__COLOUR__</script><script>__PAINTERS__</script><script>
const DATA=__DATA__;
function el(tag,text,cls){const e=document.createElement(tag);if(text)e.textContent=text;if(cls)e.className=cls;return e;}
function canvas(w,h){const c=document.createElement('canvas');c.width=w;c.height=h;return c;}
function bounds(c){const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let x0=c.width,y0=c.height,x1=0,y1=0;for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){if(d[(y*c.width+x)*4+3]>0){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x+1);y1=Math.max(y1,y+1);}}return[x0,y0,x1-x0,y1-y0];}
function mapSample(sprite,id){const c=canvas(96,64),cx=c.getContext('2d');cx.imageSmoothingEnabled=false;for(let y=0;y<2;y++)for(let x=0;x<3;x++){const tile=MapArtProcedural.render({kind:'biome',terrainId:id,proposed:true,variant:0});cx.drawImage(tile,x*32,y*32,32,32);}const b=bounds(sprite),scale=Math.min(DATA.mapFootprint.maxWidth/b[2],DATA.mapFootprint.maxHeight/b[3]),w=Math.round(b[2]*scale),h=Math.round(b[3]*scale);for(const [x,y]of[[16,28],[48,56],[80,28]])cx.drawImage(sprite,...b,x-Math.round(w/2),y-h,w,h);c.className='map-canvas';return c;}
async function main(){for(const colour of DATA.palette){const s=el('span',null,'swatch');s.style.background=colour;s.title=colour;document.querySelector('#palette').append(s);}for(const opt of DATA.options){const im=new Image();im.src=opt.image.src;await im.decode();const original=canvas(im.width,im.height);original.getContext('2d').drawImage(im,0,0);const treated=canvas(im.width,im.height);treated.getContext('2d').drawImage(im,0,0);ArtPreviewColour.recolour(treated,DATA.palette,{strength:opt.strength,mode:opt.mode,preserveLuminance:false});const article=el('article');article.dataset.option=opt.id;article.append(el('h2',opt.name),el('div',opt.usage,'usage'),el('p',opt.note));const pair=el('div',null,'pair');for(const [c,label]of[[original,'Source · native pixels ×3'],[treated,opt.strength?`Treatment · ${Math.round(opt.strength*100)}%${opt.mode==='bush-foliage'?' · contrast −10%':''}`:'Unchanged reference']]){const cell=el('div');const box=el('div',null,'sprite');const b=bounds(c),detail=canvas(b[2],b[3]);detail.getContext('2d').drawImage(c,...b,0,0,b[2],b[3]);detail.style.width=detail.width*3+'px';detail.style.height=detail.height*3+'px';box.append(detail);cell.append(box,el('div',label,'source-label'));pair.append(cell);}article.append(pair);for(const [id,label]of[[0,'Current grass proposal'],[1,'Current forest proposal']]){article.append(el('div',label,'source-label'));const box=el('div',null,'map');box.append(mapSample(treated,id));article.append(box);}const details=el('details');details.append(el('summary','Source and treatment'));details.append(el('div',opt.source,'path'),el('div',`${opt.mode}, strength ${opt.strength}. Source size ${im.width} × ${im.height}px.`, 'path'));article.append(details);document.querySelector('#cards').append(article);}zoom();document.querySelector('#status').textContent=DATA.options.length+' options · no game changes';document.body.dataset.ready='true';}
function zoom(){const z=Number(document.querySelector('#zoom').value);document.querySelectorAll('.map-canvas').forEach(c=>{c.style.width=c.width*z+'px';c.style.height=c.height*z+'px';});}document.querySelector('#zoom').addEventListener('change',zoom);main();
</script></html>'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--reserve-root', type=Path, default=Path('/home/claude/terracart/unused_art'))
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    data = json.loads((ROOT/'docs/art/bush-options.json').read_text())
    audit = json.loads((ROOT/'docs/art/map-audit-interactables.json').read_text())
    shrub = next(row for row in audit['rows'] if row['id'] == 'shrub')
    data['palette'] = [p['hex'] for p in shrub['recommendation']['palette']]
    for option in data['options']:
        option['image'] = raster(dict(path=option['source'], rect=option.get('rect')), args.reserve_root)
    painters = subprocess.check_output(['node', str(ROOT/'tools/export_map_art_painters.js')], text=True)
    html = HTML.replace('__COLOUR__', (ROOT/'tools/art_preview_colour.js').read_text()).replace('__PAINTERS__', painters).replace('__DATA__', json.dumps(data).replace('</', '<\\/'))
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output/'index.html').write_text(html)
    (args.output/'options.json').write_text(json.dumps(data, indent=2)+'\n')
    print(f'Wrote {len(data["options"])} options to {args.output}/index.html')


if __name__ == '__main__':
    main()
