#!/usr/bin/env python3
"""Lighting CPU/GPU A/B scenarios with real sensor and GPS consumers.

Run against a local server. Uses isolated sandbox saves and a deterministic
lighting clock. Records lighting CPU submission, upload calls, lightmap PNGs,
full scene screenshots, and pixel differences. GPU fallback is reported as
unverified GPU coverage, never as a successful GPU performance comparison.
"""
import argparse
import asyncio
import base64
import json
from pathlib import Path
from PIL import Image, ImageChops, ImageStat
from playwright.async_api import async_playwright

SCENARIOS = ['day','night','torch-flicker','moving-torch','reach-movement','heading-pan-cover']
SETUP = r'''() => {
 const s=__scene;s.scene.pause();s._attachCompass();
 document.querySelectorAll('[id$="-modal"],#story,#howto').forEach(el=>el.remove());s._syncModalGate();
 const origin={...s.playerM},base=2000000000000;
 const b=window.lightProbe={clock:base,origin,samples:[],uploads:{},active:false,frames:0};
 Date.now=()=>b.clock;s._blasts=[];
 const origDraw=Lighting.draw;
 Lighting.draw=function(...args){const t=performance.now();const out=origDraw.apply(this,args);if(b.active)b.samples.push({cpuMs:performance.now()-t,painted:out===true});return out;};
 const refresh=s.lightTex.refresh;s.lightTex.refresh=function(...args){if(b.active)b.uploads.lightTextureRefresh=(b.uploads.lightTextureRefresh||0)+1;return refresh.apply(this,args);};
 b.hookedGL=new WeakSet();b.hookGL=function(gl){if(!gl||b.hookedGL.has(gl))return;b.hookedGL.add(gl);
  for(const key of ['texImage2D','texSubImage2D','bufferData','bufferSubData','drawArrays','drawElements']){const fn=gl[key];gl[key]=function(...args){if(b.active)b.uploads[key]=(b.uploads[key]||0)+1;return fn.apply(this,args);};}};
 const get=HTMLCanvasElement.prototype.getContext;
 HTMLCanvasElement.prototype.getContext=function(kind,...args){const ctx=get.call(this,kind,...args);if(kind==='webgl'||kind==='webgl2'||kind==='experimental-webgl')b.hookGL(ctx);return ctx;};
 b.hookGL(__game.renderer.gl);
 b.info=()=>{const st=s._lightingGPU||s._lightGPU||null;let status=null;
  try{status=typeof LightingGPU!=='undefined'?LightingGPU.status?.(s)??null:null;}catch(e){status={error:String(e)};}
  return {phaserRenderer:__game.renderer.type===Phaser.WEBGL?'WebGL':'Canvas',gpuModule:typeof LightingGPU!=='undefined',status,
    state:st?{active:st.active,enabled:st.enabled,error:String(st.error||''),reason:st.reason,stats:st.stats}:null,
    coverMax:Math.max(0,...(s._coverLightMask?.field||[]))};};
 b.frame=function(name,i,count){
  b.clock=base+i*100;
  window.__DAYLIGHT=name==='day'?1:0;
  s._torchUntil=['torch-flicker','moving-torch','heading-pan-cover'].includes(name)?base+100000:0;
  const move=name==='moving-torch'?i/count*s.cellM*1.4:name==='reach-movement'?(i<4?0:s.cellM*1.1):0;
  s._gpsSimulated=true;s._manualOffsetM={x:0,y:0};s.gpsM=null;s._applyGpsFix({x:origin.x+move,y:origin.y});
  s.peekM=name==='heading-pan-cover'?{x:Math.sin(i/count*Math.PI*2)*3,y:Math.cos(i/count*Math.PI*2)*3}:{x:0,y:0};
  const heading=name==='heading-pan-cover'?i/count*360:0;
  const e=new Event('deviceorientationabsolute');Object.defineProperties(e,{alpha:{value:(720-heading-(screen.orientation?.angle||0))%360},absolute:{value:true}});window.dispatchEvent(e);
  HeadingUp.tick(s,.1);s._applyMapZoom();
  s.drawCells();s.drawRoadGeometry();s.drawBuildingGeometry();
  const wx=s.startWorldM.x+origin.x,wy=s.startWorldM.y+origin.y;
  s._streetLamps=[{x:wx+2*s.cellM,y:wy,lit:true,glow:'#ffd080'},{x:wx-s.cellM,y:wy+2*s.cellM,lit:true,glow:'#70aaff'}];
  s.drawObjects();b.frames++;
  const st=s._lightingGPU||s._lightGPU;b.hookGL(st?.gl);
 };
 b.capture=()=>{const info=b.info();let source=s.lightTex.getSourceImage(),captureBackend='canvas';
  if(info.status?.active){
   const st=s._lightingGPU,out=st?.output,gl=st?.renderer?.gl;
   if(!out||!gl)throw new Error('GPU active without readable final lightmap framebuffer');
   const previous=gl.getParameter(gl.FRAMEBUFFER_BINDING),pixels=new Uint8Array(out.width*out.height*4);
   try{gl.bindFramebuffer(gl.FRAMEBUFFER,out.framebuffer.webGLFramebuffer);gl.readPixels(0,0,out.width,out.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);}
   finally{gl.bindFramebuffer(gl.FRAMEBUFFER,previous);}
   // lighting_gpu.js maps logical y=0 to GL bottom. readPixels already
   // returns logical top first; a conventional framebuffer row flip is wrong.
   source=document.createElement('canvas');source.width=out.width;source.height=out.height;
   source.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(pixels),out.width,out.height),0,0);
   captureBackend='gpu-framebuffer';
  }
  return {png:source.toDataURL('image/png'),captureBackend,info};};
 return b.info();
}'''

async def run_mode(browser,args,mode):
 context=await browser.new_context(viewport={'width':390,'height':844},service_workers='block')
 page=await context.new_page();result={'requestedGpu':mode,'scenarios':[],'checkpoints':[],'errors':[]}
 page.on('pageerror',lambda e:result['errors'].append(str(e)))
 await page.add_init_script("sessionStorage.setItem('terracart.safetySeen','1');localStorage.setItem('terracart.introSeen','1');localStorage.setItem('terracart.howtoSeen','1')")
 await page.goto(args.url+'?sandbox=true&sandboxZone=forest&gpuLighting='+('true' if mode else 'false'),wait_until='domcontentloaded')
 await page.wait_for_function('window.__scene?._bootOverlayGone',timeout=90000)
 result['environment']=await page.evaluate(SETUP)
 label='gpu' if mode else 'canvas'
 for name in SCENARIOS:
  await page.evaluate('(name)=>{lightProbe.active=false;lightProbe.frame(name,0,30)}',name)
  await page.evaluate('lightProbe.samples=[];lightProbe.uploads={};lightProbe.gpuStart=lightProbe.info().status;lightProbe.active=true')
  for i in range(args.frames):
   await page.evaluate('([name,i,n])=>lightProbe.frame(name,i,n)',[name,i,args.frames])
   await page.evaluate('()=>new Promise(requestAnimationFrame)')
   if name=='reach-movement' and i in [4,5]:
    point=await page.evaluate('lightProbe.capture()')
    checkpoint=f'reach-movement-step{i}'
    (args.output/f'{label}-{checkpoint}-lightmap.png').write_bytes(base64.b64decode(point.pop('png').split(',',1)[1]))
    result['checkpoints'].append({'name':checkpoint,**point})
  data=await page.evaluate('''() => {lightProbe.active=false;return {samples:lightProbe.samples,uploads:lightProbe.uploads,gpuStart:lightProbe.gpuStart,...lightProbe.capture()};}''')
  (args.output/f'{label}-{name}-lightmap.png').write_bytes(base64.b64decode(data.pop('png').split(',',1)[1]))
  await page.screenshot(path=str(args.output/f'{label}-{name}.png'))
  if not data['samples']:raise RuntimeError(f'{label}/{name}: no Lighting.draw samples; scene draw path did not invoke lighting')
  data['gpuDelta']={k:(data['info'].get('status') or {}).get(k,0)-(data.get('gpuStart') or {}).get(k,0) for k in ['uploads','uploadBytes','draws','frames']}
  values=sorted(x['cpuMs'] for x in data['samples']);data['cpuMs']={'mean':sum(values)/len(values),'p50':values[len(values)//2],'p95':values[min(len(values)-1,int(len(values)*.95))],'max':values[-1]}
  result['scenarios'].append({'name':name,**data})
  print(json.dumps({'mode':label,'name':name,'cpuMs':data['cpuMs'],'uploads':data['uploads'],'info':data['info']}),flush=True)
 await context.close();return result

async def main(args):
 args.output.mkdir(parents=True,exist_ok=True)
 async with async_playwright() as p:
  browser=await p.chromium.launch(headless=True,executable_path=args.chromium,args=args.browser_arg)
  results=[await run_mode(browser,args,mode) for mode in [False,True]]
  await browser.close()
 comparisons=[]
 for name in SCENARIOS+[x['name'] for x in results[0]['checkpoints'] if x['name'] in {y['name'] for y in results[1]['checkpoints']}]:
  a=Image.open(args.output/f'canvas-{name}-lightmap.png').convert('RGBA');b=Image.open(args.output/f'gpu-{name}-lightmap.png').convert('RGBA')
  diff=ImageChops.difference(a,b);stats=ImageStat.Stat(diff)
  comparisons.append({'name':name,'meanAbsChannelError':stats.mean,'maxChannelError':[x[1] for x in diff.getextrema()]})
 gpu_executed=all(x['info'].get('status',{}).get('active',False) for x in results[1]['scenarios'] if x['info'].get('status') is not None) and all(x['info'].get('status') is not None for x in results[1]['scenarios'])
 report={'gpuExecuted':gpu_executed,'pixelParityExact':all(max(x['maxChannelError'])==0 for x in comparisons),'browserErrors':sum(len(r['errors']) for r in results),'verdict':'GPU executed; inspect parity and timing before enabling by default' if gpu_executed else 'GPU validation blocked: requested backend fell back or was unavailable; these are Canvas fallback measurements','runs':results,'pixelComparisons':comparisons,'limitations':['CPU submission only; no GPU completion timing.','Paused simulation with deterministic100ms lighting-clock steps; not an FPS measurement.','GPU execution must be confirmed from runtime status; requesting the flag can fall back.']}
 (args.output/'report.json').write_text(json.dumps(report,indent=2)+'\n')
 html='<!doctype html><meta charset="utf-8"><title>GPU lighting review</title><style>body{font:16px system-ui;background:#181818;color:#ddd;margin:24px}section{display:flex;gap:12px;flex-wrap:wrap}img{width:300px}a{color:#9cf}</style><h1>GPU lighting A/B</h1><p>'+report['verdict']+'</p><p>See runtime status in the report: a requested GPU flag can fall back to Canvas. CPU submission timings are not phone/GPU-completion results.</p><p><a href="report.json">Full report</a></p>'
 for name in SCENARIOS:
  html+=f'<h2>{name}</h2><section>'
  for mode in ['canvas','gpu']:html+=f'<figure><figcaption>{mode if mode=="canvas" or gpu_executed else "GPU requested — Canvas fallback"}</figcaption><a href="{mode}-{name}.png"><img src="{mode}-{name}.png"></a><p><a href="{mode}-{name}-lightmap.png">Lightmap</a></p></figure>'
  html+='</section>'
  if name=='reach-movement':
   html+='<p>Movement checkpoints: '+ ' · '.join(f'<a href="{mode}-reach-movement-step{i}-lightmap.png">{mode} step{i}</a>' for mode in ['canvas','gpu'] for i in [4,5] if args.frames>i)+'</p>'
 (args.output/'index.html').write_text(html)
 if any(r['errors'] for r in results):raise SystemExit('Browser errors; see report')

if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--url',default='http://127.0.0.1:8138/index.html');p.add_argument('--chromium',default='/usr/bin/chromium');p.add_argument('--browser-arg',action='append',default=[]);p.add_argument('--frames',type=int,default=30);p.add_argument('--output',type=Path,default=Path.home()/'.artifacts/gpu-lighting');args=p.parse_args()
 if args.frames<=0:p.error('--frames must be positive')
 asyncio.run(main(args))
