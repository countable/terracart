// Geographic RA review: normal live MVT loader, no authored fixture or sandbox.
// Isolated browser contexts keep save state out of the user profile.
// GAME_URL, OUT_DIR, MOBILE=1, CASES control the run.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright-core');
const url=process.env.GAME_URL||'http://127.0.0.1:8000';
const out=process.env.OUT_DIR||'/tmp/ra-geographic';
const renderer='webgl';
const variant='rogue';
const mobile=process.env.MOBILE==='1';
const sites={forest:null,shoreline:[49.85485,-119.4920],athalmer:[49.85438,-119.47870],beach:[49.85485,-119.49104],quarry:[49.8524556,-119.4812736],park:[49.8594,-119.48714],churchyard:[49.88014,-119.48901]};
const monitors=new Set();
const cases=(process.env.CASES||Object.keys(sites).join(',')).split(',');
fs.mkdirSync(out,{recursive:true});
(async()=>{
 const env={...process.env};delete env.DISPLAY;
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM||'/usr/bin/chromium',headless:true,env,args:['--no-sandbox','--ozone-platform=headless','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try {for(const name of cases){
 const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:900,height:1150},serviceWorkers:'block'});
 let stage='BOOT';
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));
 page.on('response',r=>{if(r.status()>=400&&r.url().startsWith(url)&&!r.url().includes('favicon'))errors.push(`${r.status()} ${r.url()}`)});
 await page.addInitScript(()=>{window.__renderScaleCap=1;window.__DAYLIGHT=1;sessionStorage.setItem('terracart.safetySeen','1');localStorage.setItem('terracart.introSeen','1');localStorage.setItem('terracart.howtoSeen','1');});
 const monitor=setInterval(async()=>{try{console.log('PROGRESS',name,stage,await page.evaluate(()=>{const s=window.__scene;if(!s)return {scene:false};const c=s.playerToWorldCell();return {centre:[c.tx,c.ty],paused:s.scene.isPaused(),tiles:[...WorldGen.tileCache].map(([k,e])=>({key:k,status:e.status,spawned:!!e._spawned})),road:!!s._roadGeomKey,job:!!s._roadRebuildJob}}))}catch{}},15000);
 monitors.add(monitor);
 console.log('BOOT',renderer,name);
 await page.goto(url+'/index.html?headingUp=false&deepforest=on',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__scene?._bootStatusDone,null,{timeout:120000});
 await page.evaluate(()=>__game.loop.sleep());
 await page.waitForFunction(()=>window.__scene?._bootOverlayGone,null,{timeout:120000});
 stage='BOOT READY';console.log(stage,renderer,name);
 await page.evaluate(()=>{
   const s=__scene;window.__chooseMode?.('hard');
   window.__phase1Dismiss=()=>{document.querySelectorAll('.game-modal,[id$="-modal"],#story,#howto').forEach(e=>e.style.display='none');s._syncModalGate?.();s.scene.pause();};
   window.__phase1Dismiss();s._gpsSimulated=true;
   // Resolve the normal GPS grace period before choosing the fixed Home site.
   s._homeCapturePending=false;s._homeCaptureArmed=false;s._homeInitialHeading=0;
   if(s._homeCaptureTimer)clearTimeout(s._homeCaptureTimer);s._homeCaptureTimer=null;s._tickHomeZoom=()=>{};s._setRestZoom(1,1);
   window.__renderScaleCap=1;window.__onGameScaleChange?.();
   // Stop gameplay while the real async tile loader/spawner and renderer run.
   // Rendering remains active; no TEST_MODE or replacement world is installed.
   s.scene.pause();
   window.__phase1Redraw=()=>{
     window.__phase1Dismiss();Energy.set(s.save,Energy.maxEnergy(s.save));
     s._applyMapZoom();s.drawCells();s.drawRoadGeometry();s.drawBuildingGeometry();s.drawObjects();
     // drawObjects finishes with Lighting.draw after collecting this frame's sources.
     // Calling Lighting.draw again would collect the same lamps/player twice.
   };
 });
 async function settle(){
   await page.evaluate(()=>{const s=__scene;s._lastBorderIX=NaN;s._lastBorderIY=NaN;s._roadGeomKey=null;s._buildingGeomKey=null;window.__phase1Redraw();});
   await page.waitForFunction(()=>{window.__phase1Redraw();return !__scene._roadRebuildJob&&!!__scene._roadGeomKey&&!!__scene._buildingGeomKey},null,{timeout:120000,polling:'raf'});
   // Paused snapshots must finish the normal 600ms newly-mapped tile reveal.
   await page.waitForTimeout(650);
   await page.evaluate(()=>window.__phase1Redraw());
   console.log('SETTLED',name);
 }
 async function move(lat,lon){
   stage='LOAD '+lat+','+lon;console.log(stage,name);
   let loadTimeout;
   await Promise.race([page.evaluate(async({lat,lon})=>{const s=__scene;window.__phase1Dismiss();const p=lonLatToLocalM(s,lon,lat);s.playerM.x=p.x;s.playerM.y=p.y;s.gpsM={...p};s.peekM={x:0,y:0};s.syncMoveTarget?.();s._setRestZoom(1,1);await s.ensureTilesAround();
     // The normal background ring serially builds eight mostly invisible
     // tiles. Prioritize only the visible neighbours for this static capture,
     // using the exact same loader and sliced spawn pass as SceneGeo.
     ++s._tilePassSeq;
     const c=s.playerToWorldCell();
     for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
       const tx=c.tx+dx,ty=c.ty+dy;if(!overlayTileInView(s,tx,ty))continue;
       let e=await WorldGen.loadTile(tx,ty,START_LAT);if(e.status==='loading')await e.promise;
       e=WorldGen.tileCache.get(WorldGen.tileKey(tx,ty));
       if(!e?._spawned)await s._spawnInTileSliced(e,tx,ty);
     }
   },{lat,lon}),new Promise((_,reject)=>{loadTimeout=setTimeout(()=>reject(new Error('Visible tile loading exceeded 180s')),180000)})]).finally(()=>clearTimeout(loadTimeout));
   stage='VISIBLE READY';console.log(stage,name);
   await page.waitForFunction(()=>{const s=__scene,p=s.playerToWorldCell();for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){const tx=p.tx+dx,ty=p.ty+dy;if(!overlayTileInView(s,tx,ty))continue;const e=WorldGen.tileCache.get(WorldGen.tileKey(tx,ty));if(e?.status!=='ready'||!e._spawned||e._spawnPass)return false;}return true},null,{timeout:120000});
   await settle();
   const at=await page.evaluate(()=>localMToLonLat(__scene,__scene.playerM.x,__scene.playerM.y));
   assert(Math.abs(at.lat-lat)<.00001&&Math.abs(at.lon-lon)<.00001,'camera is at requested geographic site');
 }
 await move(...sites.athalmer);
 const initialHome=await page.evaluate(()=>{const s=__scene;s.ensureStarterShopId();s.ensureStarterTrailerObject();const p=s.homeWorldPos();return {id:s.save.starterShopId,x:p?.x,y:p?.y};});
 assert(initialHome.id&&Number.isFinite(initialHome.x)&&Number.isFinite(initialHome.y),'Home initialized at Athalmer before moving');
 console.log('HOME',name,initialHome);
 if(name==='forest'){
  sites.forest=await page.evaluate(()=>{
   const s=__scene;let best=null;
   for(const [key,e] of WorldGen.tileCache){
    const [,tx,ty]=key.split("/").map(Number);
    if(e.status!=='ready'||!e.grid)continue;
    const N=e.cellsPerEdge,cm=e.tileEdgeM/N;
    for(let i=0;i<e.grid.length;i++){
     if(e.grid[i]!==1)continue;
     const cx=i%N,cy=Math.floor(i/N);let score=0;
     for(let dy=-4;dy<=4;dy++)for(let dx=-4;dx<=4;dx++)if(cx+dx>=0&&cx+dx<N&&cy+dy>=0&&cy+dy<N&&e.grid[(cy+dy)*N+cx+dx]===1)score++;
     const x=tx*e.tileEdgeM+(cx+.5)*cm,y=ty*e.tileEdgeM+(cy+.5)*cm;
     const distance=Math.hypot(x-s.startWorldM.x,y-s.startWorldM.y);
     if(!best||score>best.score||(score===best.score&&distance<best.distance))best={x,y,score,distance};
    }
   }
   if(!best||!Number.isFinite(best.x))throw Error('No real mapped woodland in loaded tiles');
   const p=localMToLonLat(s,best.x-s.startWorldM.x,best.y-s.startWorldM.y);return [p.lat,p.lon];
  });
  console.log('MAPPED WOODLAND',sites.forest);
 }
 if(name!=='athalmer')await move(...sites[name]);
 async function capture(state){
 stage='DRAW '+state;await settle();
 const audit=await page.evaluate(()=>{const s=__scene,cut=0,visible=o=>{const p=s.worldMetersToScreen(o.x,o.y);return p.x>=0&&p.x<s.game.scale.width&&p.y>=cut&&p.y<s.game.scale.height};
 const objects=[...WorldGen.tileCache.values()].flatMap(e=>[...(e.objects||[]),...(e.wildplants||[])]).filter(visible).map(o=>({id:o.id,kind:o.kind,x:o.x,y:o.y,species:o.species,source:o._treeSource})).sort((a,b)=>String(a.id).localeCompare(String(b.id)));
 const terrain=[];for(const [k,e] of WorldGen.tileCache){if(!e.grid)continue;const [,tx,ty]=k.split('/').map(Number),N=e.cellsPerEdge,cm=e.tileEdgeM/N;for(let i=0;i<e.grid.length;i++){const x=tx*e.tileEdgeM+(i%N+.5)*cm,y=ty*e.tileEdgeM+(Math.floor(i/N)+.5)*cm;if(visible({x,y}))terrain.push({k,i,type:e.grid[i],under:e.roadUnder?.[i],path:e.pathUnder?.[i]});}}
 const home=s.homeWorldPos();
 return {home:{id:s.save.starterShopId,x:home?.x,y:home?.y},rogueTerrain:!!window.TerrainTransitions,sourceTemplate:WorldGen.tileUrlTemplate(), artAudit:window.TerrainTransitions?.status?.(s)||null,objectArtAudit:window.RogueObjects?.status?.(s)||null, tileSources:[...WorldGen.tileCache].filter(([k,e])=>e.status==='ready').map(([k,e])=>({key:k,layers:e.layers?.map(l=>({name:l.name,features:l.features?.length})),objects:e.objects?.length})), renderer:s.game.renderer.type,glError:s.game.renderer.gl?.getError(),testMode:!!window.__TEST_MODE,deepforest:true,daylight:Lighting.daylight(s),position:localMToLonLat(s,s.playerM.x,s.playerM.y),anchor:viewAnchorWorldM(s),canvasSize:[s.game.canvas.width,s.game.canvas.height],renderScale:RENDER_SCALE,lightKey:s.lightTex?.__lightKey,objects,terrain,lamps:s._streetLamps?.filter(visible).map(l=>({id:l.id,x:l.x,y:l.y,lit:l.lit,restored:l.restored})),buildingModels:s._lowpoly?.buildings.map(m=>({key:m.key,role:m.role,authored:m.authoredKey,visible:m.obj.visible,triangles:m.visibleTriangles?.length})),textures:s.textures.getTextureKeys().length};});
 const data=await page.evaluate(()=>new Promise(resolve=>{__scene.scene.pause();__game.loop.wake();setTimeout(()=>__game.renderer.snapshotArea(0,0,__game.scale.width,__game.scale.height,img=>{__game.loop.sleep();resolve(img.src)}),500)}));
 fs.writeFileSync(path.join(out,`${name}-${variant}${mobile?'-mobile':''}-${state}.png`),Buffer.from(data.split(',')[1],'base64'));fs.writeFileSync(path.join(out,`${name}-${variant}${mobile?'-mobile':''}-${state}.json`),JSON.stringify(audit,null,2));
 if(variant!=='baseline'){
   assert(audit.artAudit?.enabled&&audit.artAudit?.ready,'RA geographic textures ready');
   assert(audit.artAudit.drawnCells>0,'RA draws actual generated ground cells');
   const baselineFile=path.join(out,`${name}-baseline${mobile?'-mobile':''}-${state}.json`);
   if(fs.existsSync(baselineFile)){
     const baseline=JSON.parse(fs.readFileSync(baselineFile));
     const normalize=value=>JSON.parse(JSON.stringify(value));
     const ordered=xs=>normalize(xs).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
     assert.deepEqual(ordered(audit.terrain),ordered(baseline.terrain),'art preserves all visible terrain types and road/path underlays');
     assert.deepEqual(normalize(audit.objects),baseline.objects,'art preserves generated object identities and positions');
     assert.deepEqual(normalize(audit.lamps),baseline.lamps,'art preserves street lamp placement/state');
     // Opt-in profiles replace house presentation; generated identities and
     // positions above remain the parity contract, not procedural mesh counts.

   }
 }
 assert.deepEqual(audit.home,initialHome,'Home remains at its initial Athalmer location');assert.equal(audit.testMode,false);assert.equal(audit.renderer,renderer==='canvas'?1:2);if(renderer==='webgl')assert.equal(audit.glError,0);assert(audit.objects.length>0,'normal scene generated objects');
 console.log('CAPTURE',name,state,audit.objects.length,'objects',audit.lamps?.length,'lamps',audit.position);return audit;}
 const before=await capture('unrestored');
 if(process.env.RESTORED==='1') {
 await page.evaluate(()=>{const s=__scene,sv=s.save;for(const [key,e] of WorldGen.tileCache){if(e.status!=='ready')continue;for(const o of e.objects||[]){if(o.kind==='house'&&o.tier===9&&Houses.isHouseWreck(sv,o))Houses.restoreAs(sv,o,'plain');if(o.kind==='house'&&o.tier===11&&Houses.isFortLocked(sv,o))(sv.unlockedForts||={})[o.id]=true;if(o.castle)Houses.claimCastle(sv,o);}for(const layer of e.layers||[]){if(layer.name!=='transportation')continue;const scale=e.tileEdgeM/(layer.extent||4096);for(const f of layer.features||[]){if(f.type!==2||!f.geom||['rail','transit'].includes(f.tags?.class)||WorldGen.isParkingAisle(f.tags))continue;f.geom.forEach((line,i)=>{let len=0;for(let j=1;j<line.length;j++)len+=Math.hypot(line[j].x-line[j-1].x,line[j].y-line[j-1].y)*scale;if(len>0)Streets.restore(sv,key,Streets.lineKey(f,i),[[0,len]])})}}}s._buildingGeomKey=null;s._roadGeomKey=null;});
 await settle();
 const restored=await capture('restored');
 assert.deepEqual(restored.objects,before.objects,'restoration keeps geographic identities');
 }

 // Step across an actual tile boundary through the same loader. No world mutation.
 if(name==='athalmer'&&!mobile){
  const edge=await page.evaluate(()=>{const s=__scene,c=s.playerToWorldCell(),e=WorldGen.tileCache.get(WorldGen.tileKey(c.tx,c.ty));return {before:[c.tx,c.ty],destination:localMToLonLat(s,(c.tx+1)*e.tileEdgeM+e.tileEdgeM/e.cellsPerEdge-s.startWorldM.x,s.playerM.y)}});
  await move(edge.destination.lat,edge.destination.lon);
  const moved=await capture('tile-boundary');
  const afterCell=await page.evaluate(()=>{const c=__scene.playerToWorldCell();return [c.tx,c.ty]});
  assert.notDeepEqual(afterCell,edge.before,'loaded and rendered across geographic tile boundary');
  fs.writeFileSync(path.join(out,`${name}-${variant}-boundary.json`),JSON.stringify({before:edge.before,after:afterCell,terrain:moved.terrain.length},null,2));
 }
 await page.screenshot({path:path.join(out,`${name}-${variant}${mobile?'-mobile':''}-page.png`)});
 assert.deepEqual(errors,[],'browser errors');fs.writeFileSync(path.join(out,`${name}-${variant}${mobile?'-mobile':''}-errors.json`),JSON.stringify(errors));clearInterval(monitor);await context.close();
 }}finally{for(const monitor of monitors)clearInterval(monitor);await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
