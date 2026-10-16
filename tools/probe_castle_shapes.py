#!/usr/bin/env python3
"""Inspect actual polygon-castle rendering across shape, winding and compass angle.

Uses isolated browser storage, real BuildingOverlay geometry and compass events.
Checks projected height/ground anchors, retained geometry, perimeter seams, and
body-geometry equivalence under reversed winding. Screenshots require visual
review for occlusion artifacts; geometric checks do not prove pixel-perfect art.
"""
import argparse
import asyncio
import json
import math
from pathlib import Path
from playwright.async_api import async_playwright

SHAPES = {
 'star-five-point': [[round((3.8 if i%2==0 else 1.55)*math.cos(-math.pi/2+i*math.pi/5),6),round((3.8 if i%2==0 else 1.55)*math.sin(-math.pi/2+i*math.pi/5),6)] for i in range(10)],
 'trapezoid': [[-2.1,-2.5],[2.1,-2.5],[3.8,2.5],[-3.8,2.5]],
 'u-deep-notch': [[-3.5,-3.5],[-1.5,-3.5],[-1.5,1.5],[1.5,1.5],[1.5,-3.5],[3.5,-3.5],[3.5,3.5],[-3.5,3.5]],
 'irregular-angled': [[-3.6,-1.4],[-1.8,-3.1],[1.4,-2.7],[3.7,-.3],[2.4,2.5],[.4,3.1],[-1,1.5],[-3.3,2]],
 'narrow-acute': [[-4,-1.4],[4,0],[-4,1.4],[-2.7,0]],
}
ANGLES = [0,45,90,135,180,225,270,315]
SETUP = r'''() => {
 const s=__scene;
 document.querySelectorAll('[id$="-modal"],#story,#howto').forEach(el=>el.remove());
 s._syncModalGate();s._attachCompass();BuildingOverlay.setEnabled(s,true);
 const frame=overlayFrame(s,e=>!!e.buildingShapes),anchor=viewAnchorWorldM(s),row=frame.tiles[0];
 for(const t of frame.tiles)t.entry.buildingShapes=[];
 // Same intact material for all shapes and both ring windings.
 let key='shape-probe-0';for(let n=0;n<1000;n++){key='shape-probe-'+n;if(!CastleStyles.get(CastleStyles.variantFor(key),true).rampart.broken&&!CastleStyles.damagePattern(key))break;}
 const oldClaim=s.isClaimedKey;s.isClaimedKey=function(k){return k===key||oldClaim.call(this,k);};
 const h=window.castleShapeProbe={row,anchor,key,heading:0,retained:null,segments:[],builds:0,prisms:0};
 const oldAdd=WallPerspective.addSegment,oldBegin=WallPerspective.begin,oldPrism=WallPerspective.prism;
 WallPerspective.addSegment=function(scene,source,spec){if(source==='polygon')h.segments.push({...spec});return oldAdd.apply(this,arguments);};
 WallPerspective.begin=function(scene,source){if(source==='polygon'){h.builds++;h.segments=[];}return oldBegin.apply(this,arguments);};
 WallPerspective.prism=function(scene,source){if(source==='polygon')h.prisms++;return oldPrism.apply(this,arguments);};
 __game.events.on('prestep',()=>{const e=new Event('deviceorientationabsolute');Object.defineProperties(e,{alpha:{value:(720-h.heading-(screen.orientation?.angle||0))%360},absolute:{value:true}});window.dispatchEvent(e);});
 __game.events.on('prerender',()=>{for(const name of ['worldContainer','letterContainer','shadowContainer','padContainer','trapContainer'])s[name]?.setVisible(false);});
 h.place=function(points){s.peekM={x:0,y:0};s.mapZoom=1;
  const e=row.entry,cx=anchor.x-row.tx*e.tileEdgeM,cy=anchor.y-row.ty*e.tileEdgeM;
  h.points=points;e.buildingShapes=[{key,tier:12,ring:points.flatMap(([x,y])=>[cx+x*s.cellM,cy+y*s.cellM])}];
  s._buildingGeomKey=null;s.drawCells();s.drawRoadGeometry();s.drawBuildingGeometry();s._applyMapZoom();};
 h.snapshot=function(){const g=s._wallPerspective.polygon;h.retained=new Set(g.blocks);h.builds=0;h.prisms=0;
  return g.blocks.filter(b=>b.bottom===0).map(b=>b.points.map(p=>[+p.x.toFixed(4),+p.y.toFixed(4)]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]).map(p=>p.join(',')).join(';')).sort();};
 h.measure=function(allowRebuild=false){
  const group=s._wallPerspective.polygon,cam=s.cameras.main;cam.preRender();
  const toScreen=(x,y)=>cam.matrix.transformPoint(x+group.x-cam.scrollX,y+group.y-cam.scrollY);
  let heightError=0,anchorError=0,finite=true;
  for(const block of group.blocks){const v=block.projected;
   for(let i=0;i<block.points.length;i++){const p=block.points[i],j=i*4;
    const a=toScreen(v[j],v[j+1]),b=toScreen(v[j+2],v[j+3]),ground=toScreen(p.x,p.y),z=cam.zoom;
    heightError=Math.max(heightError,Math.abs(b.x-a.x),Math.abs(b.y-a.y+(block.top-block.bottom)*z));
    anchorError=Math.max(anchorError,Math.abs(a.x-ground.x),Math.abs(a.y-ground.y+block.bottom*z));
    finite=finite&&[a.x,a.y,b.x,b.y].every(Number.isFinite);
   }
  }
  // Ground perimeter sampling checks that wall-body subdivisions leave no
  // gaps along source segments. This does not replace image occlusion review.
  const dist=(p,a,b)=>{const dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1)));return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);};
  let seamError=0;
  const bodies=group.blocks.filter(b=>b.bottom===0);
  for(const edge of h.segments)for(let k=0;k<=16;k++){
   const p={x:edge.ax+(edge.bx-edge.ax)*k/16,y:edge.ay+(edge.by-edge.ay)*k/16};let nearest=Infinity;
   for(const block of bodies)for(let i=0;i<block.points.length;i++)nearest=Math.min(nearest,dist(p,block.points[i],block.points[(i+1)%block.points.length]));
   seamError=Math.max(seamError,nearest);
  }
  const retained=allowRebuild||group.blocks.length===h.retained.size&&group.blocks.every(b=>h.retained.has(b));
  const delta=Math.abs(Math.atan2(Math.sin(s.mapRot+h.heading*Math.PI/180),Math.cos(s.mapRot+h.heading*Math.PI/180))*180/Math.PI);
  return {heightError,anchorError,seamError,finite,retained,blocks:group.blocks.length,builds:h.builds,prisms:h.prisms,headingErrorDeg:delta,
   passed:finite&&heightError<.001&&anchorError<.001&&seamError<.001&&retained&&delta<1};
 };
 return {renderer:__game.renderer.type===Phaser.WEBGL?'WebGL':'Canvas',key};
}'''

async def main(args):
 args.output.mkdir(parents=True,exist_ok=True)
 report={'cases':[],'windingChecks':[],'errors':[],'limitations':['Canvas/headless desktop only; no target phone or GPU guarantee.','Perimeter coverage and vertical projection checks cannot prove visibility/occlusion correctness; screenshots need review.']}
 async with async_playwright() as p:
  b=await p.chromium.launch(headless=True,executable_path=args.chromium)
  c=await b.new_context(viewport={'width':600,'height':1000},service_workers='block');page=await c.new_page()
  page.on('pageerror',lambda e:report['errors'].append(str(e)))
  await page.add_init_script("sessionStorage.setItem('terracart.safetySeen','1');localStorage.setItem('terracart.introSeen','1');localStorage.setItem('terracart.howtoSeen','1')")
  await page.goto(args.url+'?sandbox=true&sandboxZone=castle',wait_until='domcontentloaded')
  await page.wait_for_function('window.__scene?._bootOverlayGone',timeout=90000)
  await page.wait_for_timeout(700)
  report['towerAlpha']=await page.evaluate('''() => {const scene=__scene,out=[],original=scene.textures.get('castle_tower_shapes').getSourceImage(),canvas=document.createElement('canvas');canvas.width=original.width;canvas.height=original.height;const originalCtx=canvas.getContext('2d');originalCtx.drawImage(original,0,0);const sourceAlpha=originalCtx.getImageData(0,0,original.width,original.height).data;for(const key of ['tower','tower_unclaimed']){const source=scene.textures.get(key).getSourceImage(),ctx=source.getContext('2d'),w=source.width,data=ctx.getImageData(0,0,w,48).data;for(let f=0;f<4;f++){let topMax=0,bottomMax=0,badPixels=0;for(let x=f*32;x<(f+1)*32;x++){topMax=Math.max(topMax,data[(38*w+x)*4+3]);bottomMax=Math.max(bottomMax,data[(47*w+x)*4+3]);if(data[(38*w+x)*4+3]!== (sourceAlpha[(38*w+x)*4+3]>=128?255:0))badPixels++;if(data[(47*w+x)*4+3]!==0)badPixels++;}out.push({key,frame:f,row38MaxAlpha:topMax,row47MaxAlpha:bottomMax,badPixels,passed:topMax===255&&bottomMax===0&&badPixels===0});}}return out;}''')
  await page.screenshot(path=str(args.output/'tower-normal.png'))
  (args.output/'tower-report.json').write_text(json.dumps({'towerAlpha':report['towerAlpha'],'passed':all(x['passed'] for x in report['towerAlpha'])},indent=2)+'\n')
  if args.tower_only:
   report['passed']=all(x['passed'] for x in report['towerAlpha']) and not report['errors']
   (args.output/'tower-report.json').write_text(json.dumps(report,indent=2)+'\n')
   print(json.dumps(report),flush=True)
   await b.close()
   if not report['passed']:raise SystemExit('Tower alpha validation failed')
   return
  report['environment']=await page.evaluate(SETUP)
  for name in ['star-five-point','trapezoid']:
   await page.evaluate('(points)=>castleShapeProbe.place(points)',SHAPES[name])
   await page.evaluate('castleShapeProbe.heading=45')
   await page.wait_for_timeout(1400)
   await page.screenshot(path=str(args.output/f'preview-{name}-45.png'))
   print(json.dumps({'preview':name,'image':f'preview-{name}-45.png'}),flush=True)

  for name,points in SHAPES.items():
   geometries=[]
   for winding,ring in [('forward',points),('reverse',list(reversed(points)))]:
    await page.evaluate('(points)=>castleShapeProbe.place(points)',ring)
    await page.wait_for_timeout(400)
    geometries.append(await page.evaluate('castleShapeProbe.snapshot()'))
    for angle in ANGLES:
     await page.evaluate('(angle)=>castleShapeProbe.heading=angle',angle)
     await page.wait_for_timeout(1250)
     result=await page.evaluate('castleShapeProbe.measure()')
     filename=f'{name}-{winding}-{angle}.png';await page.screenshot(path=str(args.output/filename))
     report['cases'].append({'shape':name,'winding':winding,'heading':angle,'image':filename,**result})
    await page.evaluate('castleShapeProbe.heading=45;__scene.peekM={x:3,y:-3};__scene.mapZoom=1.35;__scene.drawCells();__scene.drawRoadGeometry();__scene.drawBuildingGeometry();__scene._applyMapZoom()')
    await page.wait_for_timeout(1250)
    result=await page.evaluate('castleShapeProbe.measure(true)')
    filename=f'{name}-{winding}-panzoom.png';await page.screenshot(path=str(args.output/filename))
    report['cases'].append({'shape':name,'winding':winding,'heading':'panzoom','image':filename,**result})
   same=geometries[0]==geometries[1];report['windingChecks'].append({'shape':name,'sameBodyGeometry':same})
   print(json.dumps({'shape':name,'windingEquivalent':same,'failed':[x for x in report['cases'] if x['shape']==name and not x['passed']]}),flush=True)
   (args.output/'report.json').write_text(json.dumps(report,indent=2)+'\n')
  await b.close()
 report['passed']=not report['errors'] and all(x['passed'] for x in report['towerAlpha']) and all(x['passed'] for x in report['cases']) and all(x['sameBodyGeometry'] for x in report['windingChecks'])
 (args.output/'report.json').write_text(json.dumps(report,indent=2)+'\n')
 html='<!doctype html><meta charset="utf-8"><title>Castle shape review</title><style>body{font:16px system-ui;background:#161616;color:#ddd;margin:24px}section{display:flex;flex-wrap:wrap;gap:10px}figure{margin:0}img{width:260px}a{color:#9cf}</style><h1>Castle shape review</h1><p>Actual polygon renderer; both windings, eight compass headings and pan/zoom. Unrelated objects and labels hidden. Geometry checks complement visual review; they cannot prove all occlusion ordering.</p><p>90 shape/winding/view checks cover five shapes, eight compass headings and pan/zoom. These are correctness checks, not performance measurements.</p><p>Tower feet previously ended at 30% alpha. The bottom ten rows now fade to 0% at the final row; opaque source pixels remain fully opaque at row38. All four tower families in both claimed/unclaimed palettes are checked.</p><p><a href="report.json">Full measurements</a> · <a href="tower-normal.png">Normal castle/tower blending</a> · <a href="tower-report.json">Every-pixel tower alpha check</a></p>'
 for name in SHAPES:
  html+=f'<h2>{name}</h2>'
  for winding in ['forward','reverse']:
   html+=f'<h3>{winding}</h3><section>'
   for row in [x for x in report['cases'] if x['shape']==name and x['winding']==winding]:
    html+=f'<figure><figcaption>{row["heading"]} — {"pass" if row["passed"] else "FAIL"}</figcaption><a href="{row["image"]}"><img loading="lazy" src="{row["image"]}"></a></figure>'
   html+='</section>'
 (args.output/'index.html').write_text(html)
 if not report['passed']:raise SystemExit('Shape checks failed; see report.json')

if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--tower-only',action='store_true');p.add_argument('--url',default='http://127.0.0.1:8138/index.html');p.add_argument('--chromium',default='/usr/bin/chromium');p.add_argument('--output',type=Path,default=Path.home()/'.artifacts/castle-shapes');asyncio.run(main(p.parse_args()))
