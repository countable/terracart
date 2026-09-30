#!/usr/bin/env python3
"""Capture the real sandbox before/after audit candidates, in an isolated browser.

Requires Pillow, Playwright, Chromium and a running local game server. The
after treatment changes browser textures only, never game files or user saves.
"""
import argparse
import asyncio
import base64
import json
import os
import subprocess
from pathlib import Path

from playwright.async_api import async_playwright
from preview_map_art import ROOT, PALETTE, raster


def plan(reserve):
    sprites = []
    for group in ['structures', 'interactables']:
        for row in json.loads((ROOT/'docs/art'/f'map-audit-{group}.json').read_text())['rows']:
            rec = row['recommendation']
            if rec['action'].startswith('keep'):
                continue
            palette = [p['hex'] if isinstance(p,dict) else PALETTE[p]['hex'] for p in rec.get('palette',[])]
            current = row['current']
            refs = current if isinstance(current,list) else [current]
            refs = [dict(ref, path=ref.get('path',ref.get('file',''))) for ref in refs]
            if isinstance(current,dict) and current.get('textureKeys'):
                refs += [dict(key=k) for k in current['textureKeys']]
            candidate = rec.get('candidate')
            swap = raster(candidate,reserve) if candidate and rec['action'].startswith('swap') else None
            sprites.append(dict(id=row['id'],refs=refs,palette=palette,candidate=swap['src'] if swap else None,
                                strength=rec.get('recolourStrength',.18),preserveLuminance=rec.get('preserveLuminance',True),mode=rec.get('recolourMode')))
    ground = {str(r['terrainId']):r['proposedColor'] for r in json.loads((ROOT/'docs/art/map-audit-ground.json').read_text())['rows'] if 'terrainId' in r and r.get('proposedColor')}
    buildings=json.loads((ROOT/'docs/art/map-building-preview.json').read_text())
    ground.update(buildings['claimed']['floors'])
    hedge=raster(dict(path='assets/Objects/Generated/hedge_end.png',rect=[0,0,16,16]),reserve)
    hedge['palette']=[PALETTE[k]['hex'] for k in ['ink','leaf_shadow','leaf_dark','leaf','leaf_light']]
    return dict(sprites=sprites,ground=ground,hedge=hedge,buildings=buildings,notes=[
        'Before is the current game, including the approved rustic defaults and new gold chest.',
        'After uses gentle colour transfer that preserves source shades, dark outlines and luminance contrast, plus lighter terrain bases.',
        'Rockfruit and shells retain their original art; macro booths, chapel and restored house sprites are unchanged.',
        'The sandbox buildings are claimed. The separate audit cards show the more weathered unclaimed fort treatment.',
        'Both captures use the same frozen sandbox, identical object positions, native pixels and neutral fullbright lighting.',
        'The clipped hedge is previewed only on residential/commercial shrub placements.',
        'The handmade sandbox has no zone-variant motifs or vector road/building polygons. Its existing tiled building mode is used for both views.',
        'Actors and player-planted crops remain unchanged; candidates absent from the sandbox cannot be evaluated here.',
    ])


async def capture(args):
    args.output.mkdir(parents=True,exist_ok=True)
    proposal=plan(args.reserve_root)
    async with async_playwright() as p:
        browser=await p.chromium.launch(headless=True,executable_path=os.environ.get('CHROMIUM_PATH'))
        page=await browser.new_page(viewport=dict(width=1100,height=900),device_scale_factor=1)
        errors=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        await page.add_init_script("sessionStorage.setItem('terracart.safetySeen','1');localStorage.setItem('terracart.introSeen','1')")
        await page.goto(args.url+'?sandbox=true',wait_until='domcontentloaded')
        await page.wait_for_function("window.__game?.scene.getScene('map')?._sandboxLabelData?.length",timeout=60000)
        await page.add_script_tag(content=(ROOT/'tools/sandbox_capture.js').read_text())
        info=await page.evaluate('setupSandboxCapture()')
        before=await page.evaluate('sandboxCapture.mosaic()')
        await page.add_script_tag(content=(ROOT/'tools/art_preview_colour.js').read_text())
        await page.add_script_tag(content=subprocess.check_output(['node','tools/export_map_art_painters.js'],cwd=ROOT,text=True))
        await page.add_script_tag(content=(ROOT/'tools/sandbox_candidate_art.js').read_text())
        applied=await page.evaluate('(plan)=>applySandboxCandidates(sandboxCapture.scene,plan)',proposal)
        after=await page.evaluate('sandboxCapture.mosaic()')
        assert before != after, 'Candidate substitution made no visual change'
        for name,uri in [('before',before),('after',after)]:
            (args.output/(name+'.png')).write_bytes(base64.b64decode(uri.split(',',1)[1]))
        # A static full-map comparison is useful outside the interactive page.
        pair=await page.evaluate('''async ([before,after])=>{
          const images=await Promise.all([before,after].map(async src=>{const i=new Image();i.src=src;await i.decode();return i;}));
          const w=images[0].width,h=images[0].height,c=document.createElement('canvas');c.width=w*2+32;c.height=h+72;
          const x=c.getContext('2d');x.fillStyle='#141b18';x.fillRect(0,0,c.width,c.height);x.fillStyle='#eee8d7';x.font='bold 28px sans-serif';
          x.fillText('BEFORE · current game',20,45);x.fillText('AFTER · candidate study',w+52,45);
          x.drawImage(images[0],0,72);x.drawImage(images[1],w+32,72);return c.toDataURL('image/png');
        }''',[before,after])
        (args.output/'comparison.png').write_bytes(base64.b64decode(pair.split(',',1)[1]))
        assert not errors,errors
        await browser.close()
    metadata=dict(info=info,applied=applied)
    (args.output/'capture.json').write_text(json.dumps(metadata,indent=2))
    html=(ROOT/'tools/sandbox_art_comparison.html').read_text().replace('__CAPTURE__',json.dumps(metadata).replace('<','\\u003c'))
    (args.output/'index.html').write_text(html)
    print(json.dumps(dict(output=str(args.output),spriteFrames=len(applied['changed']),errors=errors)))


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url',default='http://127.0.0.1:8767/')
    parser.add_argument('--reserve-root',type=Path,default=ROOT/'unused_art')
    parser.add_argument('--output',type=Path,required=True)
    asyncio.run(capture(parser.parse_args()))
