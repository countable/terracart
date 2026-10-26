// First extract authentic inputs: node tools/castle-real-inputs.cjs
// Actual production-tier castles from immutable Kelowna MVT fixtures in MapScene.
// FIXTURES=/tmp/real-castles-selected.json OUT_DIR=/tmp/castle-real-before \
// SOURCE_DIR=/tmp/castle-real-baseline/src ASSET_DIR=/tmp/castle-real-baseline/assets node tools/castle-real-geometry.cjs
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {chromium}=require('playwright-core');
const ROOT=path.resolve(__dirname,'..'),OUT=process.env.OUT_DIR||'/tmp/castle-real-before';
const fixture=JSON.parse(fs.readFileSync(process.env.FIXTURES||'/tmp/real-castles-selected.json','utf8'));
const selected=fixture.castles.filter(c=>!process.env.KEYS||process.env.KEYS.split(',').includes(c.key));
const angles=(process.env.ANGLES||'0,45,73,135,225').split(',').map(Number);
const states=(process.env.STATES||'wrecked,restored').split(',');
const renderers=(process.env.RENDERERS||'webgl,canvas').split(',');
const sourceDir=process.env.SOURCE_DIR,assetDir=process.env.ASSET_DIR;
const sources=['building_overlay.js','castle_styles.js','fdr_castle_geometry.js','fdr_castle_layout.js','fdr_castle_canvas.js','wall_surface_renderer.js','wall_perspective.js','polygon_geometry.js'];
const hashes=Object.fromEntries(sources.map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(path.join(sourceDir||path.join(ROOT,'src'),f))).digest('hex')]));
(async()=>{
 fs.mkdirSync(OUT,{recursive:true});
 const report={sourceHashes:hashes,gameShellHashes:Object.fromEntries(['index.html','src/app.js'].map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,f))).digest('hex')])),fixtureProvenance:fixture.provenance,tiles:fixture.tiles,cases:[],errors:[],requestFailures:[],httpFailures:[],limitations:['Production tier12 selection and original MVT rings, not synthetic replacements. Offline original tile fixtures preserve nearby mapped features and generated objects.','Camera uses normal widest game zoom (11 cells). Large castles require multiple camera positions; screenshots may deliberately show only part of a castle.','Claim state is overridden only for the selected castle in this isolated browser. Player moves to camera position for review. External Overpass enrichment is disabled; MVT and production procedural context remain.','Daylight is fixed for reproducible visibility. Browser renderer is explicitly selected; ordinary geometry and object generation remain unchanged.','Cyan diagnostic line is mapped ground boundary. Orange polygons show ground bases with vertices outside that boundary; green polygons are contained bases. Height projection is intentionally excluded from this containment test.']};
 const env={...process.env};delete env.DISPLAY;
 const browser=await chromium.launch({executablePath:'/usr/lib/chromium/chromium',env,args:['--no-sandbox','--ozone-platform=headless','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try{for(const renderer of renderers){
  const page=await browser.newPage({viewport:{width:700,height:1000},deviceScaleFactor:1,serviceWorkers:'block'});
  page.on('console',m=>{if(['warning','error'].includes(m.type()))console.log(m.type(),m.text().slice(0,350),m.location().url);});
  page.on('requestfailed',request=>{const failure={renderer,url:request.url(),error:request.failure()?.errorText};report.requestFailures.push(failure);console.log('REQUESTFAILED',JSON.stringify(failure));});
  page.on('response',response=>{if(response.status()>=400)report.httpFailures.push({renderer,url:response.url(),status:response.status()});});
  page.on('pageerror',e=>{report.errors.push({renderer,error:e.message});console.log('PAGEERROR',e.message)});
  await page.addInitScript(frameLat=>{window.__DAYLIGHT=1;localStorage.setItem('terracart.teleport',JSON.stringify({lat:frameLat,lon:-119.49,name:'Castle audit'}));sessionStorage.setItem('terracart.safetySeen','1');localStorage.setItem('terracart.introSeen','1');localStorage.setItem('terracart.howtoSeen','1');},fixture.frameLat);
  await page.route('**/*',async route=>{
   const u=new URL(route.request().url()),m=u.pathname.match(/\/14\/(\d+)\/(\d+)\.pbf$/);
   if(m){const f=path.join(ROOT,'test/fixtures',m[1]+'_'+m[2]+'.pbf');if(fs.existsSync(f))return route.fulfill({path:f,contentType:'application/octet-stream'});return route.fulfill({status:504,body:''});}
   if(/overpass/.test(u.hostname))return route.fulfill({contentType:'application/json',body:'{"elements":[]}'});
   if(u.pathname==='/src/app.js'){let body=fs.readFileSync(path.join(ROOT,'src/app.js'),'utf8').replace('type: Phaser.AUTO,',`type: Phaser.${renderer==='canvas'?'CANVAS':'WEBGL'},`);return route.fulfill({contentType:'application/javascript',body});}
   if(sourceDir&&u.pathname.startsWith('/src/')){const f=path.join(sourceDir,path.basename(u.pathname));if(fs.existsSync(f))return route.fulfill({contentType:'application/javascript',body:fs.readFileSync(f,'utf8')});}
   if(assetDir&&u.pathname.startsWith('/assets/')){const f=path.join(assetDir,u.pathname.slice(8));if(fs.existsSync(f))return route.fulfill({path:f});}
   return route.continue();
  });
  const url=(process.env.GAME_URL||'http://127.0.0.1:8877/index.html')+'?fakeGps=1&lat='+fixture.frameLat+'&lon=-119.49';
  await page.goto(url,{waitUntil:'domcontentloaded'});
  try{await page.waitForFunction(()=>window.__scene?._bootOverlayGone,null,{timeout:90000});}catch(error){await page.screenshot({path:path.join(OUT,'boot-failure.png')});console.log('BOOTSTATE',await page.evaluate(()=>({scene:!!window.__scene,boot:window.__scene?._bootOverlayGone,body:document.body.innerText.slice(0,5000),tiles:typeof WorldGen!=='undefined'?[...WorldGen.tileCache.keys()]:[]})));throw error;}
  await page.evaluate(()=>{__game.loop.stop();__scene.scene.pause();document.querySelectorAll('[id$="-modal"],#story,#howto,#bootload,#safety').forEach(e=>e.remove());__scene._syncModalGate();__scene._attachCompass();BuildingOverlay.setEnabled(__scene,true);});
  console.log(renderer,'booted');
  for(const item of selected){
   await page.evaluate(async item=>{const entry=await WorldGen.loadTile(item.tx,item.ty,START_LAT);await entry.promise;},item);
   const found=await page.evaluate(item=>{const e=WorldGen.tileCache.get(WorldGen.tileKey(item.tx,item.ty));return {found:!!e?.buildingShapes?.find(b=>b.key===item.key&&b.tier===12),count:e?.buildingShapes?.length,cellM:__scene.cellM,tileEdgeM:e?.tileEdgeM};},item);
   if(!found.found)throw Error('Real castle not generated '+item.key+' '+JSON.stringify(found));
   for(const state of states){
    const positions=process.env.POSITIONS?process.env.POSITIONS.split(','):['center',...(Math.max(item.metrics.widthM,item.metrics.depthM)>75?['northwest','southeast']:[])];
    for(const position of positions){
     const placed=await page.evaluate(({item,state,position})=>{
      const s=__scene,e=WorldGen.tileCache.get(WorldGen.tileKey(item.tx,item.ty)),shape=e.buildingShapes.find(b=>b.key===item.key&&b.tier===12);
      window.realCastleProbe={key:item.key,shape,entry:e,tx:item.tx,ty:item.ty};
      const raw=Array.from(shape.ring),xs=raw.filter((_,i)=>i%2===0),ys=raw.filter((_,i)=>i%2===1),left=Math.min(...xs),right=Math.max(...xs),top=Math.min(...ys),bottom=Math.max(...ys);
      const px=position==='northwest'?left+12:position==='southeast'?right-12:(left+right)/2,py=position==='northwest'?top+12:position==='southeast'?bottom-12:(top+bottom)/2;
      s.playerM={x:item.tx*e.tileEdgeM+px-s.startWorldM.x,y:item.ty*e.tileEdgeM+py-s.startWorldM.y};s.peekM={x:0,y:0};s._gpsManualOverride=true;s.syncMoveTarget?.();
      s.mapZoom=1;s._mapZoomRest=1;s._mapZoomReturning=false;s._homeIntro=null;s.mapRot=0;s._huManualAngle=0;
      if(!window.realCastleOriginalClaim)window.realCastleOriginalClaim=s.isClaimedKey.bind(s);
      s.isClaimedKey=k=>k===item.key?state==='restored':window.realCastleOriginalClaim(k);
      s._lastBorderIX=NaN;s._lastBorderIY=NaN;s._buildingGeomKey=null;s._roadGeomKey=null;s._overlayFrameSeq++;
      const rebuildStart=performance.now();s.drawCells();s.drawRoadGeometry();s._overlayFrameSeq++;s._buildingGeomKey=null;const buildingStart=performance.now();s.drawBuildingGeometry();const buildingRebuildMs=performance.now()-buildingStart;s.drawObjects();s._applyMapZoom();WallPerspective.update(s);__game.step(performance.now(),16);
      return {buildingRebuildMs,rebuildMs:performance.now()-rebuildStart,actualRing:raw,sourceRingMatches:raw.length===item.ring.length&&raw.every((n,i)=>Math.abs(n-item.ring[i])<.01),position,playerWorld:playerWorldM(s)};
     },{item,state,position});
     for(const angle of angles){
      await page.evaluate(angle=>{document.getElementById('castle-audit-svg')?.remove();const s=__scene;s.mapRot=angle*Math.PI/180;s._huManualAngle=s.mapRot;s._applyMapZoom();WallPerspective.update(s);__game.step(performance.now(),16);},angle);
      const measurement=await page.evaluate(()=>{
       const s=__scene,p=realCastleProbe,model=s._fdrCastleLayouts?.get(p.key),group=s._wallPerspective?.[model?'castles':'polygon'];
       const frame=overlayFrame(s,e=>!!e.buildingShapes),proj=overlayProjection(s,frame.fracX,frame.fracY);
       const ring=Array.from({length:p.shape.ring.length/2},(_,i)=>({x:proj.projX(p.tx*p.entry.tileEdgeM+p.shape.ring[i*2]),y:proj.projY(p.ty*p.entry.tileEdgeM+p.shape.ring[i*2+1])}));
       const ref=group?.gfx||s.buildingGeomContainer;
       const matrix=Phaser.GameObjects.GetCalcMatrix(ref,s.cameras.main).calc;
       const rect=__game.canvas.getBoundingClientRect(),kx=rect.width/__game.canvas.width,ky=rect.height/__game.canvas.height;
       const mapCrop={x:rect.left+s.viewLeft*RENDER_SCALE*kx,y:rect.top+s.viewTop*RENDER_SCALE*ky,width:s.viewSize*RENDER_SCALE*kx,height:s.viewSize*RENDER_SCALE*ky};
       const screen=q=>{const t=matrix.transformPoint(q.x,q.y);return {x:rect.left+t.x*kx,y:rect.top+t.y*ky}};
       const inside=q=>PolygonGeometry.pointInPolygon(ring,q,1e-4);
       const blocks=(group?.blocks||[]).filter(b=>b.building?.key===p.key),baseFaces=blocks.flatMap(b=>(b.materialFaces||[]).filter(f=>f.points.every(v=>v.z===0)));
       // Basal side faces expose the actual flared ground vertices even when no bottom cap is emitted.
       const bases=blocks.filter(b=>b.bottom===0).map(b=>{const vertices=(b.materialFaces||[]).flatMap(f=>f.points).filter(q=>q.z===0);const unique=vertices.length?[...new Map(vertices.map(q=>[q.x.toFixed(5)+','+q.y.toFixed(5),q])).values()]:b.points;const cx=unique.reduce((a,q)=>a+q.x,0)/unique.length,cy=unique.reduce((a,q)=>a+q.y,0)/unique.length;unique.sort((a,b)=>Math.atan2(a.y-cy,a.x-cx)-Math.atan2(b.y-cy,b.x-cx));return {points:unique.map(q=>({x:q.x,y:q.y})),outsideVertices:unique.filter(q=>!inside(q)).length};});
       const pointDistance=(q,a,b)=>{const dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((q.x-a.x)*dx+(q.y-a.y)*dy)/(dx*dx+dy*dy||1)));return Math.hypot(q.x-a.x-t*dx,q.y-a.y-t*dy)};
       const outside=bases.flatMap(b=>b.points.filter(q=>!inside(q))),maxOutsidePx=Math.max(0,...outside.map(q=>Math.min(...ring.map((a,i)=>pointDistance(q,a,ring[(i+1)%ring.length])))));
       const objects=frame.tiles.flatMap(t=>t.entry.objects||[]).filter(o=>o.kind!=='tower'&&o.id!==p.key&&Number.isFinite(o.x)&&Number.isFinite(o.y));
       const objectIntrusions=objects.map(o=>({o,q:{x:proj.projX(o.x),y:proj.projY(o.y)}})).filter(({q})=>!inside(q)&&bases.some(b=>b.outsideVertices&&PolygonGeometry.pointInPolygon(b.points,q,1e-4))).map(({o,q})=>({id:o.id,kind:o.kind,x:o.x,y:o.y,screen:screen(q)}));
       const drawnObjects=(s.objectPool||[]).filter(o=>o.visible&&o._staticObject).map(o=>({id:o._staticObject.id,kind:o._staticObject.kind,x:o._staticObject.x,y:o._staticObject.y}));
       const diagnostic={ring:ring.map(screen),bases:bases.map(b=>({outside:b.outsideVertices>0,points:b.points.map(screen)})),objectIntrusions};
       window.realCastleDiagnostic=diagnostic;
       return {mapCrop,fdr:!!model,family:model?.family||CastleStyles.renderStyle(p.key,false).id,vertices:ring.length,towers:model?.layout.towers.length||0,blocks:blocks.length,triangles:blocks.reduce((n,b)=>n+(b.materialFaces?.length||0),0),groundOutsideVertices:outside.length,maxGroundOverhangPx:maxOutsidePx,maxGroundOverhangM:maxOutsidePx*s.cellM/CELL_PX,objectIntrusions,visibleObjects:drawnObjects,finite:blocks.every(b=>Array.from(b.projected).every(Number.isFinite)),diagnostic};
      });
      const name=`${renderer}-${item.key}-${state}-${position}-${angle}`;
      await page.screenshot({path:path.join(OUT,name+'.png')});
      await page.screenshot({path:path.join(OUT,name+'-map.png'),clip:measurement.mapCrop});
      await page.evaluate(()=>{const d=realCastleDiagnostic;const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.id='castle-audit-svg';svg.setAttribute('width',innerWidth);svg.setAttribute('height',innerHeight);svg.style.cssText='position:fixed;inset:0;pointer-events:none;z-index:2147483647';const add=(pts,color,width)=>{const p=document.createElementNS(svg.namespaceURI,'polygon');p.setAttribute('points',pts.map(q=>q.x+','+q.y).join(' '));p.setAttribute('fill','none');p.setAttribute('stroke',color);p.setAttribute('stroke-width',width);svg.appendChild(p)};for(const b of d.bases)add(b.points,b.outside?'#ff7b34':'#77e096',1);add(d.ring,'#00edff',2);document.body.appendChild(svg);});
      await page.screenshot({path:path.join(OUT,name+'-boundary.png')});
      await page.screenshot({path:path.join(OUT,name+'-boundary-map.png'),clip:measurement.mapCrop});
      report.cases.push({renderer,key:item.key,state,position,angle,provenance:{tile:item.tile,mvtFeatureId:item.mvtFeatureId,ringIndex:item.ringIndex,centroid:item.centroid},...placed,...measurement,fullFile:name+'.png',boundaryFile:name+'-boundary.png'});
      fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2));
     }
    }
   }
   console.log(renderer,item.key,'captured');
  }
  if(process.env.NETWORK_WAIT_MS)await page.waitForTimeout(Number(process.env.NETWORK_WAIT_MS));
  await page.close();
 }
 report.passed=report.errors.length===0&&report.cases.length>0&&report.cases.every(c=>c.finite&&c.sourceRingMatches);
 }finally{fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2));await browser.close();}
 if(!report.passed)throw Error('Capture audit failed');
})().catch(e=>{console.error(e);process.exitCode=1});
