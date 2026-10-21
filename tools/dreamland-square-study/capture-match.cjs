// Authored composition through normal Dreamland hooks, separate from geographic QA.
const fs=require('node:fs'),assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require('playwright-core');
const OUT=process.env.OUT_DIR||'/tmp/dreamland-match';fs.mkdirSync(OUT,{recursive:true});
(async()=>{
 const env={...process.env};delete env.DISPLAY;
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,env,args:['--no-sandbox','--ozone-platform=headless','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try{
 const context=await browser.newContext({viewport:{width:1000,height:1100},serviceWorkers:'block'}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(String(e)));
 // A wider camera for the comparison only. All art runs unmodified production hooks.
 await page.route('**/src/app.js*',r=>r.fulfill({contentType:'application/javascript',body:fs.readFileSync('src/app.js','utf8').replace('const W = 352, H = 844;','const W = 672, H = 844;').replace('const VIEW_CELLS = 11;','const VIEW_CELLS = 21;')}));
 await page.addInitScript(()=>{window.__renderScaleCap=1;window.__DAYLIGHT=1;sessionStorage.setItem('terracart.safetySeen','1');localStorage.setItem('terracart.introSeen','1');localStorage.setItem('terracart.howtoSeen','1');});
 await page.goto('http://127.0.0.1:8000/index.html?sandbox=true&headingUp=false&artTrial=dreamland');
 await page.waitForFunction(()=>window.__scene?._bootOverlayGone,null,{timeout:120000});
 await page.evaluate(()=>{
  const s=__scene;s.scene.pause();s._tickHomeZoom=()=>{};s._setRestZoom(1,1);s._applyMapZoom();window.__onGameScaleChange?.();
  s.ensureStarterTrailerObject=()=>{};s.ensureStarterShopId=()=>{};s.save.starterShopId=null;
  const pc=s.playerToWorldCell(),e=WorldGen.tileCache.get(WorldGen.tileKey(pc.tx,pc.ty)),N=e.cellsPerEdge,cm=e.tileEdgeM/N,cx=Math.floor(N/2),cy=Math.floor(N/2);
  const world=(x,y)=>({x:pc.tx*e.tileEdgeM+(cx+x+.5)*cm,y:pc.ty*e.tileEdgeM+(cy+y+.5)*cm});
  for(const en of WorldGen.tileCache.values()){
   en.grid.fill(0);en.objects=[];en.wildplants=[];en.creatures=[];en.layers=[];en.buildingShapes=[];en.owners.fill(0);
   for(const k of ['zone','zoneDress','scenic','scenicDress','streetIndex','streetDress','streetArea','treasure','streetGround','slowCells','streetMarks','_objectIndex','_preCullLights'])en[k]=null;
   for(const k of ['extraTreasures','parkingTreasures','coinDrops','traps','streetLairs'])en[k]=[];
   en.roadUnder={};en.pathUnder={};
  }
  for(let y=-15;y<=15;y++)for(let x=-15;x<=15;x++)if(Math.abs(x)<=1||Math.abs(y+1)<=1)e.grid[(cy+y)*N+cx+x]=17;
  const rows=[['house',-5,-3,{tier:9,area:cm*cm*12}],['house',5,-3,{tier:9,area:cm*cm*12}],['house',-7,7,{tier:9,area:cm*cm*12}],['house',7,7,{tier:11,area:cm*cm*24}],['tree',-5,1,{variant:3,size:'large'}],['tree',6,1,{variant:3,size:'large'}],['tree',3,6,{variant:3,size:'large'}],['well',0,2,{}],['chest',-3,-3,{crate:true}],['chest',4,-3,{crate:true}],['infoboard',-1,-3,{}]];
  e.objects=rows.map(([kind,x,y,props],i)=>({id:'dreamland-match-'+i,kind,...props,...world(x,y),tx:pc.tx,ty:pc.ty,_ix:cx+x,_iy:cy+y}));
  for(const o of e.objects)if(o.kind==='tree')while(isShiny(o.id,SHINY_RATE.tree))o.id+='x';
  for(const k of ['planted','fires','furniture','floorTiles','chopped','spent'])s.save[k]=[];s.save.firepit=null;s.save.restoredHouses={};s.save.unlockedForts={};
  const p=world(0,1);s.playerM={x:p.x-s.startWorldM.x,y:p.y-s.startWorldM.y};s.peekM={x:0,y:0};s.syncMoveTarget?.();s.mapZoom=1;s._setRestZoom(1,1);s._applyMapZoom();
  window.__dreamlandDraw=(restored)=>{
   s.save.restoredHouses=restored?Object.fromEntries(e.objects.filter(o=>o.kind==='house'&&o.tier===9).map(o=>[o.id,'plain'])):{};
   s.save.unlockedForts=restored?Object.fromEntries(e.objects.filter(o=>o.tier===11).map(o=>[o.id,true])):{};
   s._lastBorderIX=NaN;s._lastBorderIY=NaN;s._roadGeomKey=null;s._buildingGeomKey=null;
   s.drawCells();s.drawRoadGeometry();s.drawBuildingGeometry();
   s._streetLamps=[[-3,-2],[4,2],[-4,6]].map(([x,y],i)=>({id:'dreamland-match-lamp'+i,...world(x,y),lit:restored,tier:1}));
   s.drawObjects();
   // Reference comparison excludes gameplay chrome, while using actual normal art.
   for(const k of ['lightMap','shadowContainer','fogContainer','atmosGroundGfx','atmosRimGfx','reachGfx','auraContainer','fxContainer','sparkContainer','labelContainer','letterContainer','_sandboxLabels','ghostGlowContainer','tierGfx','enemyHealthGfx','_workProgressGfx','playerHalo','gpsGhost','blightAura','facingGfx','facingChevronGfx','projGfx','swordSwingGfx','boltContainer'])s[k]?.setVisible?.(false);
   s.creaturePool?.forEach(o=>o.setVisible(false));s.towerPool?.forEach(o=>o.setVisible(false));s.player.setVisible(false);
   document.querySelectorAll('.game-modal,[id$="-modal"],#story,#howto,#bootload,#safety-card').forEach(el=>el.style.display='none');
   return {objects:e.objects.map(o=>({id:o.id,kind:o.kind,x:o.x,y:o.y})),art:DreamlandObjects.status(s),ground:RATerrainTrial.status(s),gl:__game.renderer.gl.getError()};
  };
 });
 const results=[];
 for(const restored of [false,true]){
  const audit=await page.evaluate(r=>__dreamlandDraw(r),restored);results.push(audit);
  const data=await page.evaluate(()=>new Promise(resolve=>{__game.loop.wake();setTimeout(()=>__game.renderer.snapshotArea(16,__scene.viewCenterY-260,640,520,img=>{__game.loop.sleep();resolve(img.src)}),500)}));
  fs.writeFileSync(path.join(OUT,restored?'restored.png':'unrestored.png'),Buffer.from(data.split(',')[1],'base64'));
 }
 assert.deepEqual(results[0].objects,results[1].objects);assert.equal(results[1].gl,0);assert(results[1].art.textures.dreamland_house>=3);assert(results[1].art.textures.dreamland_tree>=3);assert(results[1].art.textures.dreamland_fountain>=1);assert(results[1].art.textures.dreamland_lamp>=3);assert(results[0].art.textures.dreamland_lamp_unlit>=3);assert.deepEqual(errors,[]);
 fs.writeFileSync(path.join(OUT,'audit.json'),JSON.stringify({authoredComposition:true,productionHooks:true,results,errors},null,2));console.log(JSON.stringify(results.map(r=>r.art)));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
