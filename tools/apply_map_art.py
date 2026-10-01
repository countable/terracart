#!/usr/bin/env python3
"""Bake approved map-art recipes into separate PNGs and wire their asset paths.

Source art remains intact. Re-running starts from the original sources recorded
in manifest.json, so colours are never applied twice. Pillow only loads/crops
source references; the shared Canvas2D review transform owns every recolour.
"""
import argparse
import asyncio
import base64
import hashlib
import io
import json
import os
from pathlib import Path
import re
import subprocess

from art_paths import RESERVE_ROOT
from PIL import Image
from playwright.async_api import async_playwright
from preview_map_art import ROOT, colours

DEST = ROOT/'assets/Objects/Approved'
MANIFEST = DEST/'manifest.json'
CONTEXT_KEYS = {'longgrass':'approved_wetland_reeds', 'shrub':'approved_clipped_hedge',
                'plain-rock':'approved_moss_rocks',
                'stakes':'approved_charred_stakes', 'rubble':'approved_masonry_rubble'}


def uri(image):
    out=io.BytesIO(); image.save(out,format='PNG')
    return 'data:image/png;base64,'+base64.b64encode(out.getvalue()).decode()


def asset_metadata():
    js="const fs=require('fs'),vm=require('vm');const s=fs.readFileSync('src/assets.js','utf8').split('// Player class and bicycle appearances')[0];process.stdout.write(vm.runInNewContext(s+';JSON.stringify(ASSETS)'));"
    return json.loads(subprocess.check_output(['node','-e',js],cwd=ROOT,text=True))


def recipes(reserve):
    previous=json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {}
    original=asset_metadata()
    original.update(previous.get('originalAssets',{}))
    for key in [*CONTEXT_KEYS.values(),'house_fort_unclaimed','potofgold']:
        original.pop(key,None)
    inputs={}; jobs={}; contexts=[]
    def source(name,tag):
        path=reserve/name.split('unused_art/',1)[1] if name.startswith('unused_art/') else ROOT/name
        if name.startswith('unused_art/'):
            vendored=DEST/'Sources'/(tag+Path(name).suffix)
            if path.exists():
                vendored.parent.mkdir(parents=True,exist_ok=True)
                if not vendored.exists() or vendored.read_bytes()!=path.read_bytes():vendored.write_bytes(path.read_bytes())
            path=vendored
        assert path.exists(), f'Missing original art: {path}'
        inputs[name]=dict(path=str(path.relative_to(ROOT)),sha256=hashlib.sha256(path.read_bytes()).hexdigest())
        return Image.open(path).convert('RGBA')
    def crop(ref,tag):
        name=ref.get('path',ref.get('file')); im=source(name,tag)
        if ref.get('rect'):
            x,y,w,h=ref['rect'];im=im.crop((x,y,x+w,y+h))
        if ref.get('whiteKey'):im.putdata([(r,g,b,0 if min(r,g,b)>240 else a) for r,g,b,a in im.getdata()])
        return uri(im)
    def treatment(rec):
        return dict(palette=[p['hex'] for p in colours(rec.get('palette',[]))],strength=rec.get('recolourStrength',.18),
                    mode=rec.get('recolourMode'),preserveLuminance=rec.get('preserveLuminance',True),
                    colourMap=rec.get('colourMap'),paletteStrength=rec.get('paletteStrength'))
    rows=[]
    for group in ['structures','interactables']:
        rows.extend(json.loads((ROOT/f'docs/art/map-audit-{group}.json').read_text())['rows'])
    # Raster ground recipes use the ground audit's source-frame declaration.
    for ground in json.loads((ROOT/'docs/art/map-audit-ground.json').read_text())['rows']:
        if not ground.get('palette') or ground.get('treatment') not in ['recolor','recolour']:
            continue
        refs=[]
        for ref in ground['sources']:
            if 'frame' not in ref or not ref.get('path'):
                continue
            im=source(ref['path'],ground['id']+'-original')
            w,h=ref['frameWidth'],ref['frameHeight'];frame=ref['frame'];cols=im.width//w
            refs.append(dict(path=ref['path'],rect=[frame%cols*w,frame//cols*h,w,h]))
        if refs:
            rows.append(dict(id=ground['id'],current=refs,recommendation=dict(
                action='recolour',palette=ground['palette'],recolourStrength=ground['recolourStrength'],
                preserveLuminance=ground.get('preserveLuminance',True))))
    seen=set()
    for row in rows:
        if row['id'] in seen:continue
        seen.add(row['id']);rec=row['recommendation']
        refs=row['current'] if isinstance(row['current'],list) else [row['current']]
        if row['id']=='gold-pot':
            contexts.append(dict(key='potofgold',keys=['potofgold'],kind='image',procedural=dict(kind='potofgold'),
                operations=[dict(row=row['id'],rect=[0,0,24,22],**treatment(rec))]))
        if not rec['action'].startswith('keep'):
            for ref in refs:
                name=ref.get('path',ref.get('file'))
                if not name:continue
                keys=[ref['key']] if ref.get('key') else [k for k,v in original.items() if v.get('path','').split('?')[0]==name]
                if not keys:raise ValueError(f'No registered asset for {row["id"]}: {name}')
                image=source(name,row['id']+'-original')
                key=keys[0]
                if name not in jobs:
                    allkeys=[k for k,v in original.items() if v.get('path','').split('?')[0]==name]
                    jobs[name]=dict(key=key,keys=allkeys,source=uri(image),sourcePath=name,operations=[],whiteKey=key=='crops')
                job=jobs[name];rects=[ref.get('rect') or [0,0,image.width,image.height]]
                if row.get('category')=='trees' and rec.get('recolourMode') in ['approved-apple','apple-foliage','pine-foliage']:
                    w,h=rects[0][2:];rects=[[x,y,w,h] for y in range(0,image.height,h) for x in range(0,image.width,w)]
                elif rec.get('recolourMode')=='crop-light' or rec.get('growthStages'):
                    if rects[0][0]==64:
                        rects=[[stage*16,rects[0][1],16,16] for stage in range(5)]
                # All seven functional produce counters share the same approved
                # treatment. Their contents, frame mapping and geometry stay put.
                if ref.get('frames',{}).get('count'):
                    frames=ref['frames'];w=frames['frameWidth'];h=frames['frameHeight']
                    rects=[[(i%(image.width//w))*w,(i//(image.width//w))*h,w,h] for i in range(frames['count'])]
                for rect in rects:
                    # Multiple source previews of one growth sheet describe one
                    # recipe, not repeated passes over the same pixels.
                    if any(o['row']==row['id'] and o['rect']==rect for o in job['operations']):continue
                    op=dict(row=row['id'],rect=rect,**treatment(rec))
                    if rec['action'].startswith('swap') and rec.get('candidate'):op['candidate']=crop(rec['candidate'],row['id']+'-candidate')
                    if row['id']=='building-wreck':op['stateShade']=ref['stateShade']
                    if row['id']=='building-fort':op.update(treatment(rec['stateTreatments']['claimed']))
                    job['operations'].append(op)
        if row['id']=='building-fort':
            state=rec['stateTreatments']['unclaimed'];ref=state['candidate'];im=source(ref.get('path',ref.get('file')),'fort-original')
            contexts.append(dict(key='house_fort_unclaimed',keys=['house_fort_unclaimed'],source=uri(im),sourcePath=ref.get('path',ref.get('file')),
                kind='image',operations=[dict(row='building-fort-unclaimed',rect=ref['rect'],stateShade=ref['stateShade'],**treatment(state))]))
        if row.get('zoneVariant'):
            variant=row['zoneVariant'];key=CONTEXT_KEYS[row['id']]
            if row['id']=='plain-rock':
                contexts.append(dict(key=key,keys=[key],baseKey='mineralrock',kind='spritesheet',frameWidth=16,frameHeight=16,
                    operations=[dict(row=row['id']+'-context',rect=r['rect'],palette=[],strength=0,moss=True) for r in refs]))
            else:
                src=crop(variant['candidate'],row['id']+'-context');im=Image.open(io.BytesIO(base64.b64decode(src.split(',',1)[1])))
                recvar={**rec,**{k:v for k,v in variant.items() if k in ['recolourStrength','recolourMode']}}
                op=dict(row=row['id']+'-context',rect=[0,0,*im.size],**treatment(recvar))
                if row['id'] not in ['shrub','stakes']:op.update(palette=[],strength=0)
                contexts.append(dict(key=key,keys=[key],source=src,sourcePath=variant['candidate'].get('path',variant['candidate'].get('file')),
                    kind='spritesheet',frameWidth=im.width,frameHeight=im.height,operations=[op]))
    return original,list(jobs.values())+contexts,inputs


def preserve_unselected_pixels(job, result, completed):
    """Undo Canvas alpha-rounding outside the explicitly approved rectangles."""
    source = completed.get(job.get('baseKey')) or job.get('source')
    if not source:
        return
    decode = lambda value: Image.open(io.BytesIO(base64.b64decode(value.split(',', 1)[1]))).convert('RGBA')
    original, rendered = decode(source), decode(result['uri'])
    if job.get('whiteKey'):
        # Match the existing crop loader's transparent-background conversion.
        original.putdata([(r,g,b,0 if min(r,g,b)>240 else a) for r,g,b,a in original.getdata()])
    assert original.size == rendered.size, job['key']
    for op in job['operations']:
        x,y,w,h = op['rect']
        box = (x,y,x+w,y+h)
        original.paste(rendered.crop(box), (x,y))
    if original.tobytes() != rendered.tobytes():
        result['uri'] = uri(original)


def wire_assets(original,jobs):
    path=ROOT/'src/assets.js';text=path.read_text()
    for job in jobs:
        target='assets/Objects/Approved/'+job['key']+'.png'
        for key in job['keys']:
            if key not in original:continue
            pattern=r'(\b'+re.escape(key)+r'\s*:\s*\{[\s\S]*?\bpath:\s*)([\'\"])([^\'\"]+)([\'\"])'
            text,n=re.subn(pattern,lambda m:m[1]+m[2]+target+m[4],text,count=1)
            if not n:raise ValueError('Asset registry key missing: '+key)
    extras=[]
    for job in jobs:
        if job['key'] in original:continue
        props={'kind':job.get('kind','image'),'path':'assets/Objects/Approved/'+job['key']+'.png'}
        if job['key']=='house_fort_unclaimed':props['unclaimedArt']=True
        if props['kind']=='spritesheet':props.update(frameWidth=job['frameWidth'],frameHeight=job['frameHeight'])
        extras.append('  '+job['key']+': '+json.dumps(props)+',')
    block='  // BEGIN approved map-art states and contexts\n'+'\n'.join(extras)+'\n  // END approved map-art states and contexts\n'
    text=re.sub(r'  // BEGIN approved map-art states and contexts\n[\s\S]*?  // END approved map-art states and contexts\n','',text)
    marker='};\n\n// Player class and bicycle appearances'
    assert marker in text
    text=text.replace(marker,block+marker,1)
    text=re.sub(r'(\bhouse_wreck:\s*\{)(?![^}]*unclaimedArt)',r'\1 unclaimedArt: true,',text)
    path.write_text(text)


async def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--reserve-root',type=Path,default=RESERVE_ROOT)
    parser.add_argument('--review-output',type=Path,default=Path('/tmp/approved-map-art-review'))
    args=parser.parse_args();DEST.mkdir(parents=True,exist_ok=True)
    original,jobs,inputs=recipes(args.reserve_root)
    async with async_playwright() as p:
        browser=await p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH'),headless=True)
        page=await browser.new_page();await page.add_script_tag(content=(ROOT/'tools/art_preview_colour.js').read_text())
        await page.add_script_tag(content=subprocess.check_output(['node','tools/export_map_art_painters.js'],cwd=ROOT,text=True))
        await page.add_script_tag(content=(ROOT/'tools/apply_map_art.js').read_text())
        baked=await page.evaluate('(jobs)=>bakeApprovedMapArt(jobs)',jobs)
        await browser.close()
    files=[];completed={}
    for job,result in zip(jobs,baked):
        preserve_unselected_pixels(job,result,completed)
        completed[job['key']]=result['uri']
        raw=base64.b64decode(result['uri'].split(',',1)[1]);name=job['key']+'.png';(DEST/name).write_bytes(raw)
        files.append(dict(key=job['key'],keys=job['keys'],path='assets/Objects/Approved/'+name,source=job.get('sourcePath'),
                          width=result['width'],height=result['height'],sha256=hashlib.sha256(raw).hexdigest(),
                          rows=sorted({op['row'] for op in job['operations']}),operations=job['operations']))
    original_used={key:original[key] for job in jobs for key in job['keys'] if key in original}
    previous=json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {}
    source_commit=previous.get('sourceCommit') or subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
    manifest=dict(version=1,sourceCommit=source_commit,
                  colourTransformSha256=hashlib.sha256((ROOT/'tools/art_preview_colour.js').read_bytes()).hexdigest(),originalAssets=original_used,inputs=inputs,files=files)
    MANIFEST.write_text(json.dumps(manifest,indent=2)+'\n');wire_assets(original,jobs)
    args.review_output.mkdir(parents=True,exist_ok=True)
    cards=[]
    for result in baked:
        cards.append('<article><h2>'+result['key']+'</h2><div><figure><img src="'+result['before']+'"><figcaption>Source</figcaption></figure><figure><img src="'+result['uri']+'"><figcaption>Applied</figcaption></figure></div></article>')
    (args.review_output/'index.html').write_text('<!doctype html><meta name="viewport" content="width=device-width"><title>Applied map art</title><style>body{background:#404738;color:#fff;font:16px system-ui}article{border:1px solid #999;margin:20px;padding:15px}div{display:flex;gap:20px}img{image-rendering:pixelated;max-width:40vw;min-width:96px}figure{margin:0}h2{font-size:18px}</style><h1>Applied map sprites · source and baked</h1>'+''.join(cards))
    print(json.dumps(dict(assets=len(files),manifest=str(MANIFEST),review=str(args.review_output/'index.html'))))


if __name__=='__main__':asyncio.run(main())
