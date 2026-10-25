#!/usr/bin/env node
// Browser-only road concept study in the shipping Phaser renderer.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {chromium}=require('playwright-core');
const ROOT=path.resolve(__dirname,'../..');
const OUT=process.env.OUT_DIR||'/home/claude/.artifacts/road-treatments';
const URL=process.env.GAME_URL||'http://127.0.0.1:8002';
function patch(source){
 const marker='  function selectedRoadTile(variant, restored) {';
 if(!source.includes(marker))throw Error('Road tile hook changed');
 source=source.replace(marker,`  function studyVariant(tags, fallback) {
    const tier=WorldGen.classifyLine('transportation',tags||{});
    const family=tier===WorldGen.T.ROAD_LG?'lg':tier===WorldGen.T.ROAD_MD?'md':null;
    const id=family&&global.__roadConceptChoices?.[family];
    return id?'study:'+family+':'+id:fallback;
  }
${marker}
    if (variant?.startsWith('study:')) { const [,family,id]=variant.split(':');return global.RoadTreatments.materialFor(family,id,restored); }`);
 source=source.replace('const variant = global.StreetVariants?.pavementVariantFor(f.tags, style?.variant);','const variant = studyVariant(f.tags, global.StreetVariants?.pavementVariantFor(f.tags, style?.variant));');
 source=source.replace('const variant = global.StreetVariants?.pavementVariantFor(f.tags, style.variant);','const variant = studyVariant(f.tags, global.StreetVariants?.pavementVariantFor(f.tags, style.variant));');
 let n=0;
 source=source.replace(/for \(const part of homeRoadRuns\(scene, pts\)\) \{/g,match=>{
 const restored=n++>0;
 return match+`\n          if (variant?.startsWith('study:') && g.decorPath) { const [,family,id]=variant.split(':'); global.RoadTreatments.decorate(scene,g,part.pts.map(p=>({x:projX(p.x),y:projY(p.y)})),widthPx,family,id,${restored}); }`;
 });
 if(n!==2)throw Error('Expected two route decoration hooks, got '+n);
 return source;
}
(async()=>{
 fs.mkdirSync(OUT,{recursive:true});
 const env={...process.env};delete env.DISPLAY;
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM||'/usr/bin/chromium',env,headless:true,args:['--no-sandbox','--ozone-platform=headless','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist','--enable-unsafe-swiftshader']});
 try{
 const page=await browser.newPage({viewport:{width:900,height:1150},serviceWorkers:'block'}),errors=[];
 page.on('pageerror',e=>{errors.push(String(e));console.log('PAGEERROR',String(e));});
 let activeSource=fs.readFileSync(path.join(ROOT,'src/road_overlay.js'),'utf8');
 await page.route('**/src/road_overlay.js*',r=>r.fulfill({contentType:'application/javascript',body:patch(activeSource)}));
 await page.route('**/src/app.js*',r=>r.fulfill({contentType:'application/javascript',body:fs.readFileSync(path.join(ROOT,'src/app.js'),'utf8').replace('type: Phaser.AUTO,','type: Phaser.WEBGL,')}));
 await page.addInitScript(()=>{window.__DAYLIGHT=1;window.__renderScaleCap=1;sessionStorage.setItem('terracart.safetySeen','1');localStorage.setItem('terracart.introSeen','1');localStorage.setItem('terracart.howtoSeen','1');});
 await page.goto(URL+'/index.html?sandbox=true&headingUp=false',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__scene?._bootOverlayGone,null,{timeout:120000});
 console.log('BOOT');
 await page.addScriptTag({path:path.join(__dirname,'concepts.js')});
 await page.evaluate(()=>RoadTreatments.prepare());
 const boot=await page.evaluate(()=>{
  const s=__scene;s.scene.pause();s.anims.pauseAll();s.tweens.pauseAll();s._tickHomeZoom=()=>{};s._setRestZoom(1,1);s.mapZoom=1;s._applyMapZoom();window.__renderScaleCap=1;window.__onGameScaleChange?.();
  BuildingOverlay.setEnabled(s,false);s.ensureStarterTrailerObject=()=>{};s.ensureStarterShopId=()=>{};s._syncModalGate=()=>{};HomeVariant.anchor=()=>null;HomeVariant.contains=()=>false;
  Object.assign(s.save,{planted:[],fires:[],furniture:[],floorTiles:[],firepit:null,chopped:[],spent:[]});
  const pc=s.playerToWorldCell(),e=WorldGen.tileCache.get(WorldGen.tileKey(pc.tx,pc.ty));window.__roadStudy={tx:pc.tx,ty:pc.ty,N:e.cellsPerEdge,edge:e.tileEdgeM};
  return {renderer:__game.renderer.type,...__roadStudy};
 });
 const concepts=await page.evaluate(()=>RoadTreatments.CONCEPTS);
 fs.writeFileSync(path.join(OUT,'concepts.json'),JSON.stringify(concepts,null,2));
 const studies=[];
 for(const c of concepts)for(const restored of [false,true])studies.push({id:c.id,family:c.family,restored,choices:{[c.family]:c.id},layout:'single'});
 studies.unshift({id:'baseline-md',family:'md',restored:false,choices:{},layout:'single'},{id:'baseline-lg',family:'lg',restored:false,choices:{},layout:'single'});
 const md=concepts.find(c=>c.family==='md'),lg=concepts.find(c=>c.family==='lg');
 for(const restored of [false,true])studies.push({id:'paired',family:'pair',restored,choices:{md:md.id,lg:lg.id},layout:'pair'});
 const rows=[];
 for(const study of studies){
  const metadata=await page.evaluate(study=>{
   const s=__scene,{tx,ty,N,edge}=__roadStudy,cm=edge/N,cx=Math.floor(N/2),cy=Math.floor(N/2);
   window.__roadConceptChoices=study.choices;
   for(const e of WorldGen.tileCache.values()){
    e.grid.fill(WorldGen.T.PARK);e.layers=[];e.objects=[];e.wildplants=[];e.creatures=[];e.buildingShapes=[];e.owners.fill(0);e.zone=null;e.zoneDress=null;e.scenic=null;e.scenicDress=null;e.streetIndex=null;e.homeStreetIndex=null;e.streetDress=null;e.streetArea=null;e.streetAreaVariants=null;e.extraTreasures=[];e.parkingTreasures=[];e.coinDrops=[];e.traps=[];e.streetLairs=[];e.treasure=null;e.streetGround=null;e.roadUnder={};e.pathUnder={};e.slowCells=null;e.streetMarks=null;e._streetLamps=null;e._lampCells=null;e._objectIndex=null;e._preCullLights=null;
   }
   const road=(name,cls,variant,points,tags={})=>({name,class:cls,variant,points,tags});
   const roads=study.layout==='pair'?[
    road('Dimensional Rift','primary',null,[[-7,-2],[-2,-2],[2,-1],[7,-1]]),
    road('Old Trade Road','secondary',null,[[-3,-7],[-3,-3],[0,2],[2,7]]),
    road('Lantern Row','minor','lantern',[[-7,3],[7,3]]),
    road('Confusion Path','path','confusion_path',[[-7,5],[7,-5]],{subclass:'footway'})
   ]:[
    road(study.family==='md'?'Old Trade Road':'Dimensional Rift',study.family==='md'?'secondary':'primary',null,[[-8,-1],[-2,-1],[1,0],[8,0]]),
    road('Lantern Row','minor','lantern',[[2,-8],[2,8]]),
    road('Confusion Path','path','confusion_path',[[-8,4],[8,-4]],{subclass:'footway'})
   ];
   const point=([x,y])=>({x:(cx+x+.5)*4096/N,y:(cy+y+.5)*4096/N});
   const features=roads.map((r,i)=>({id:20000+i,type:2,tags:{class:r.class,name:r.name,...r.tags},geom:[r.points.map(point)]}));
   const layers=[{name:'landuse',extent:4096,features:[{type:3,tags:{class:'park'},geom:[[[0,0],[4096,0],[4096,4096],[0,4096]].map(([x,y])=>({x,y}))]}]},{name:'transportation',extent:4096,features},{name:'transportation_name',extent:4096,features:features.map(f=>({...f,tags:{name:f.tags.name}}))}];
   const generated=WorldGen.rasterizeTile(layers,N,tx,ty,edge);
   const e={...WorldGen.tileCache.get(WorldGen.tileKey(tx,ty)),...generated,layers,tx,ty,cellsPerEdge:N,tileEdgeM:edge};
   Object.assign(e,{objects:[],wildplants:[],creatures:[],zone:null,zoneDress:null,scenic:null,scenicDress:null,homeStreetIndex:null,streetDress:null,_streetLamps:null,_lampCells:null,buildingShapes:[],extraTreasures:[],parkingTreasures:[],coinDrops:[],traps:[],streetLairs:[],treasure:null,streetGround:null,roadUnder:{},pathUnder:{}});
   e.grid.fill(WorldGen.T.PARK);
   for(const rec of e.streetIndex.lines){rec.variant=roads[rec.fi].variant;rec.variantRanges=null;rec.variantSegments=null;rec.homeSuppressedRanges=[];rec.nexusSuppressedRanges=[];}
   WorldGen.tileCache.set(WorldGen.tileKey(tx,ty),e);
   s.save.streets={};
   roads.forEach((r,i)=>{if(study.restored)Streets.restore(s.save,WorldGen.tileKey(tx,ty),Streets.lineKey(features[i],0),[[0,Streets.lineLengthM(features[i].geom[0],edge/4096)]]);});
   const p={x:tx*edge+(cx+.5)*cm,y:ty*edge+(cy+.5)*cm};s.playerM={x:p.x-s.startWorldM.x,y:p.y-s.startWorldM.y};s.peekM={x:0,y:0};s.syncMoveTarget?.();s._streetLampKey=null;s._streetLamps=null;s.roadVariantSeams=false;s._lastBorderIX=NaN;s._lastBorderIY=NaN;s._roadGeomKey=null;s._roadRebuildJob=null;s._buildingGeomKey=null;
   s.drawCells();const at=performance.now();s.drawRoadGeometry();const rebuildMs=performance.now()-at;s._updateStreetLamps();s.drawObjects();
   for(const key of ['fogContainer','lightMap','atmosGroundGfx','atmosRimGfx','reachGfx','auraContainer','fxContainer','sparkContainer','labelContainer','letterContainer','_sandboxLabels','ghostGlowContainer','tierGfx','enemyHealthGfx','_workProgressGfx','player','playerShadow','playerHalo','gpsGhost','blightAura','facingGfx','facingChevronGfx','projGfx','swordSwingGfx','boltContainer','buildingGeomContainer','buildingWallContainer'])s[key]?.setVisible?.(false);
   s.creaturePool?.forEach(o=>o.setVisible(false));s.towerPool?.forEach(o=>o.setVisible(false));s.objectPool?.forEach(o=>{if(!['rogue_lamp','rogue_lamp_unlit'].includes(o.texture?.key))o.setVisible(false);});BuildingLowPoly.clear(s);
   document.querySelectorAll('.game-modal,[id$="-modal"],#story,#howto,#bootload,#safety-card').forEach(e=>e.style.display='none');
   return {rebuildMs,roads:roads.map(r=>({name:r.name,class:r.class,variant:r.variant,widthM:WorldGen.roadOverlayWidthM({...r.tags,class:r.class})})),lamps:RoadOverlay.lampSitesForTile(tx,ty,e).length};
  },study);
  await page.waitForTimeout(100);
  const image=await page.evaluate(()=>new Promise(resolve=>{const s=__scene,scale=__game.canvas.width/352;__game.renderer.snapshotArea(Math.round(s.viewLeft*scale),Math.round(s.viewTop*scale),Math.round(s.viewSize*scale),Math.round(s.viewSize*scale),im=>resolve(im.src));}));
  const file=`${study.family}-${study.id}-${study.restored?'restored':'weathered'}.png`;
  fs.writeFileSync(path.join(OUT,file),Buffer.from(image.split(',')[1],'base64'));rows.push({...study,...metadata,file});console.log('SNAP',file);
 }
 const swatches=await page.evaluate(()=>RoadTreatments.CONCEPTS.map(c=>({id:c.id,family:c.family,weathered:RoadTreatments.materialFor(c.family,c.id,false).toDataURL(),restored:RoadTreatments.materialFor(c.family,c.id,true).toDataURL()})));
 for(const s of swatches)for(const state of ['weathered','restored'])fs.writeFileSync(path.join(OUT,`swatch-${s.id}-${state}.png`),Buffer.from(s[state].split(',')[1],'base64'));
 const shadeAudit=await page.evaluate(()=>['lantern','confusion_path','greenway'].map(variant=>{
  const raw=RoadOverlay.selectedRoadTile(variant,false),restored=RoadOverlay.selectedRoadTile(variant,true);
  const data=raw.getContext('2d').getImageData(0,0,raw.width,raw.height).data;
  let minimum=255,gap=null;
  for(let i=3;i<data.length;i+=4)if(data[i]<minimum){minimum=data[i];gap=[...data.slice(i-3,i+1)];}
  const clean=restored.getContext('2d').getImageData(0,0,restored.width,restored.height).data;
  let clear=0;for(let i=3;i<clean.length;i+=4)if(clean[i]===0)clear++;
  const imageAlpha=__scene._roadGeomTarget._pass.image.alpha;
  return {variant,minMaterialAlpha:minimum,gap,baseImageAlpha:imageAlpha,effectiveShade:minimum/255*imageAlpha,restoredClearPixels:clear};
 }));
 if(shadeAudit.some(r=>Math.abs(r.effectiveShade-.2)>.005||!r.restoredClearPixels))throw Error('Variant shade audit failed '+JSON.stringify(shadeAudit));
 const audit={boot,errors,shadeAudit,webglError:await page.evaluate(()=>__game.renderer.gl?.getError()??null),sourceSha256:crypto.createHash('sha256').update(activeSource).digest('hex'),concepts,rows};
 fs.writeFileSync(path.join(OUT,'metadata.json'),JSON.stringify(audit,null,2));
 if(boot.renderer!==2||errors.length||audit.webglError!==0)throw Error('Renderer audit failed');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
