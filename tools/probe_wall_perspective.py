#!/usr/bin/env python3
"""Repeatable dense-castle CPU benchmark; serve each revision on a separate URL.

Example: python3 tools/probe_wall_perspective.py --url http://localhost:8000/index.html
--label candidate --output ~/.artifacts/wall-perspective. CPU submission timings
are not GPU completion times or a guarantee of target-phone performance.
"""
import argparse
import asyncio
import json
from pathlib import Path
from playwright.async_api import async_playwright

SETUP = r'''() => {
 const s=__scene, game=__game;
 document.querySelectorAll('[id$="-modal"],#story,#howto').forEach(el=>el.remove());
 s._syncModalGate();s._attachCompass();BuildingOverlay.setEnabled(s,true);
 const frame=overlayFrame(s, e=>!!e.buildingShapes), anchor=viewAnchorWorldM(s);
 const row=frame.tiles[0], e=row.entry, m=s.cellM;
 for(const t of frame.tiles)t.entry.buildingShapes=[];
 const cx=anchor.x-row.tx*e.tileEdgeM,cy=anchor.y-row.ty*e.tileEdgeM;
 // Nine separate polygon castles, all in the visible footprint. Each has
 // eight corners so the fixture covers oblique faces and joined corners.
 for(let y=-1;y<=1;y++)for(let x=-1;x<=1;x++){
   const a=cx+x*3*m,b=cy+y*3*m,r=m*1.15,k=m*.25;
   e.buildingShapes.push({key:`benchmark-${x}-${y}`,tier:12,
    ring:[a-r+k,b-r,a+r-k,b-r,a+r,b-r+k,a+r,b+r-k,
          a+r-k,b+r,a-r+k,b+r,a-r,b+r-k,a-r,b-r+k]});
 }
 s._buildingGeomKey=null;s.drawBuildingGeometry();
 const state=window.wallBenchmark={samples:[], active:false, calls:{}, times:{}, counters:{}};
 function wrap(obj,key,label){if(!obj||typeof obj[key]!=='function')return;
   const fn=obj[key];obj[key]=function(...args){if(!state.active)return fn.apply(this,args);
     const t=performance.now();try{return fn.apply(this,args);}finally{
      state.times[label]=(state.times[label]||0)+performance.now()-t;
      state.calls[label]=(state.calls[label]||0)+1;
      if(label.startsWith('walls.')&&typeof args[1]==='string'){const source=label+'.'+args[1];state.calls[source]=(state.calls[source]||0)+1;}}};
 }
 wrap(game.renderer,'render','renderer');wrap(BuildingOverlay,'draw','buildingDraw');
 wrap(HeadingUp,'_preRender','headingTransform');
 wrap(Phaser.Textures.CanvasTexture.prototype,'refresh','canvasTextureRefresh');
 wrap(s.textures,'createCanvas','textureCreateCanvas');
 for(const key of ['update','updateScene','render','begin','prism','finish'])wrap(window.WallPerspective,key,'walls.'+key);
 for(const key of ['update','updateScene','render'])wrap(window.WallGeometry,key,'walls.'+key);
 const gl=game.renderer.gl;
 if(gl)for(const key of ['texImage2D','texSubImage2D','bufferData','bufferSubData','drawArrays','drawElements']){
   const fn=gl[key];gl[key]=function(...args){if(state.active)state.counters[key]=(state.counters[key]||0)+1;return fn.apply(this,args);};
 }
 const create=document.createElement.bind(document);
 document.createElement=function(tag,...args){if(state.active&&tag==='canvas')state.counters.canvasCreates=(state.counters.canvasCreates||0)+1;return create(tag,...args);};
 let start=0,last=0,t0=performance.now();
 game.events.on('prestep',()=>{
   const t=performance.now(), deg=state.fixedHeading??((t-t0)*.06)%360;
   const event=new Event('deviceorientationabsolute');
   Object.defineProperties(event,{alpha:{value:(720-deg-(screen.orientation?.angle||0))%360},absolute:{value:true}});
   window.dispatchEvent(event);
   start=performance.now();state.times={};
 });
 game.events.on('postrender',()=>{const end=performance.now();if(state.active)state.samples.push({cpu:end-start,interval:last?end-last:0,heading:s.compassDeg,...state.times});last=end;});
 const ext=gl?.getExtension('WEBGL_debug_renderer_info');
 const testCanvas=document.createElement('canvas');
 let webglFailure=null;
 testCanvas.addEventListener('webglcontextcreationerror',e=>{webglFailure=e.statusMessage});
 const availableGL=testCanvas.getContext('webgl');
 state.info={renderer:game.renderer.type===Phaser.WEBGL?'WebGL':'Canvas',
   gpu:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):null,
   webglAvailable:!!availableGL,webglFailure,phaserWebglSupport:Phaser.Device?.Features?.webGL ?? null,
   userAgent:navigator.userAgent,hardwareConcurrency:navigator.hardwareConcurrency,
   canvas:[game.canvas.width,game.canvas.height],devicePixelRatio,castleCount:9,polygonEdges:72,
   legacyPieces:s._buildingUprightPieces?.length||0,
   wallObjectCount:s.buildingWallContainer?.list.length||0,
   retainedBlocks:Object.fromEntries(Object.entries(s._wallPerspective||{}).map(([k,v])=>[k,v.blocks.length])),
   fpsLimit:game.loop.fpsLimit||null};
 return state.info;
}'''

async def main(args):
 args.output.mkdir(parents=True,exist_ok=True)
 report={'label':args.label,'url':args.url,'runs':[],'errors':[],
  'limitations':['CPU submission only; no GPU fence timing.','Desktop headless browser, not target phone.','Heap delta is not allocation count.','Dense synthetic fixture uses nine eight-corner polygon castles.']}
 async with async_playwright() as p:
  browser=await p.chromium.launch(headless=True,executable_path=args.chromium,args=args.browser_arg)
  for run in range(args.repeats):
   context=await browser.new_context(viewport={'width':390,'height':844},service_workers='block')
   page=await context.new_page();page.on('pageerror',lambda e:report['errors'].append(str(e)))
   await page.add_init_script("sessionStorage.setItem('terracart.safetySeen','1');localStorage.setItem('terracart.introSeen','1');localStorage.setItem('terracart.howtoSeen','1')")
   await page.goto(args.url+'?sandbox=true&sandboxZone=castle',wait_until='domcontentloaded')
   await page.wait_for_function('window.__scene?._bootOverlayGone',timeout=90000)
   await page.wait_for_timeout(1000)
   info=await page.evaluate(SETUP)
   if args.tiled:
    await page.evaluate('BuildingOverlay.setEnabled(__scene,false);__scene.drawCells();__scene.drawBuildingGeometry()')
   await page.wait_for_timeout(args.warmup*1000)
   info=await page.evaluate('''() => {const s=__scene,b=wallBenchmark;b.info.mode=BuildingOverlay.enabled()?'polygon':'tiled';b.info.retainedBlocks=Object.fromEntries(Object.entries(s._wallPerspective||{}).map(([k,v])=>[k,v.blocks.length]));b.info.legacyPieces=s._buildingUprightPieces?.length||0;b.info.wallObjectCount=s.buildingWallContainer?.list.length||0;if(b.info.mode==='tiled'){b.info.castleCount=1;b.info.polygonEdges=null;}b.active=true;b.heapStart=performance.memory?.usedJSHeapSize;return b.info;}''')
   await page.wait_for_timeout(args.seconds*1000)
   data=await page.evaluate('''() => {const b=wallBenchmark;b.active=false;return {info:b.info,samples:b.samples,calls:b.calls,counters:b.counters,heapDelta:(performance.memory?.usedJSHeapSize||0)-(b.heapStart||0)}}''')
   summary={}
   for key in ['cpu','interval','renderer','buildingDraw','headingTransform','walls.update','walls.updateScene','walls.render','canvasTextureRefresh','textureCreateCanvas']:
    vals=sorted(s.get(key,0) for s in data['samples'])
    if vals:summary[key]={'mean':sum(vals)/len(vals),'p50':vals[len(vals)//2],'p95':vals[min(len(vals)-1,int(len(vals)*.95))],'max':vals[-1]}
   data['summaryMs']=summary
   headings=[s['heading'] for s in data['samples'] if s.get('heading') is not None]
   if not headings or max(headings)-min(headings)<300:raise RuntimeError('Compass sweep did not complete a revolution')
   if len(data['samples'])<args.seconds*15:raise RuntimeError('Too few rendered samples for comparison')
   report['runs'].append(data)
   if args.idle_check:
    await page.evaluate('wallBenchmark.fixedHeading=90')
    await page.wait_for_timeout(2500)
    await page.evaluate('''() => {window.wallIdleProbe={clears:0};for(const group of Object.values(__scene._wallPerspective||{})){if(!group.blocks.length)continue;const g=group.gfx,fn=g.clear;g.clear=function(...args){wallIdleProbe.clears++;return fn.apply(this,args);};}}''')
    await page.wait_for_timeout(700)
    idle=await page.evaluate('wallIdleProbe.clears')
    await page.evaluate('wallIdleProbe.clears=0;wallBenchmark.fixedHeading=180')
    await page.wait_for_timeout(1000)
    turning=await page.evaluate('wallIdleProbe.clears')
    data['idleCheck']={'idleClears':idle,'turningClears':turning,'passed':idle==0 and turning>0}
    if not data['idleCheck']['passed']:report['errors'].append('Wall command buffer reuse failed')
   await page.screenshot(path=str(args.output/f'{args.label}-{run}.png'))
   print(json.dumps({'label':args.label,'run':run,'info':info,'frames':len(data['samples']),'summaryMs':summary,'counters':data['counters']}),flush=True)
   if args.screenshots and run == args.repeats-1:
    for mode in ['polygon','tiled']:
     await page.evaluate('(on)=>{BuildingOverlay.setEnabled(__scene,on);__scene.drawCells();__scene.drawRoadGeometry();__scene.drawBuildingGeometry();__scene.drawObjects()}',mode=='polygon')
     for angle in [0,45,90,180,270]:
      await page.evaluate('(angle)=>wallBenchmark.fixedHeading=angle',angle)
      await page.wait_for_timeout(1300)
      await page.screenshot(path=str(args.output/f'{args.label}-{mode}-{angle}.png'))
     await page.evaluate('wallBenchmark.fixedHeading=90;__scene.peekM={x:7,y:-7};__scene.mapZoom=1.5;__scene.drawCells();__scene.drawRoadGeometry();__scene.drawBuildingGeometry();__scene.drawObjects();__scene._applyMapZoom()')
     await page.wait_for_timeout(1300)
     await page.screenshot(path=str(args.output/f'{args.label}-{mode}-peek-zoom.png'))
     await page.evaluate('__scene.peekM={x:0,y:0};__scene.mapZoom=1;__scene._applyMapZoom()')
   await context.close()
  await browser.close()
 (args.output/f'{args.label}.json').write_text(json.dumps(report,indent=2)+'\n')
 if report['errors']:raise SystemExit(str(report['errors']))

if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__)
 p.add_argument('--url',default='http://127.0.0.1:8000/index.html');p.add_argument('--label',default='candidate')
 p.add_argument('--chromium',default='/usr/bin/chromium');p.add_argument('--browser-arg',action='append',default=[])
 p.add_argument('--idle-check',action='store_true',help='Check stationary command-buffer reuse and repaint on a new heading')
 p.add_argument('--tiled',action='store_true',help='Benchmark the authored tiled castle instead of dense polygon fixture')
 p.add_argument('--screenshots',action='store_true')
 p.add_argument('--seconds',type=int,default=12);p.add_argument('--warmup',type=int,default=3);p.add_argument('--repeats',type=int,default=3)
 p.add_argument('--output',type=Path,default=Path.home()/'.artifacts/wall-perspective')
 asyncio.run(main(p.parse_args()))
