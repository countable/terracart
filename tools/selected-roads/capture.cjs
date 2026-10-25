#!/usr/bin/env node
// Controlled road geometry in the actual Phaser scene. No map-review painter.
// Sources and assets load from the served checkout, without road-module overrides.
const fs = require('node:fs'), path = require('node:path'), crypto=require('node:crypto');
const { chromium } = require('playwright-core');
const ROOT = path.resolve(__dirname, '../..');
const OUT = process.env.OUT_DIR || '/home/claude/.artifacts/ancient-road-surfaces';
const LABEL = process.env.LABEL || 'selected';
const CELLS = Number(process.env.CELLS || 11);
const WIDTH = CELLS * 32;
const fixture = require('./fixture.json');
const roadSource=fs.readFileSync(path.join(ROOT,'src/road_overlay.js'),'utf8');
const sourceSha256=crypto.createHash('sha256').update(roadSource).digest('hex');
const materialSources=['src/road_surfaces.js','assets/Objects/RoadSurfaces/surfaces.png'];
const materialSha256=Object.fromEntries(materialSources.map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,file))).digest('hex')]));
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browserEnv={...process.env};delete browserEnv.DISPLAY;
  const browser = await chromium.launch({ env:browserEnv, executablePath: process.env.CHROMIUM || '/usr/bin/chromium', headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--ignore-gpu-blocklist', '--ozone-platform=headless', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({viewport:{width:900,height:1150},serviceWorkers:'block'});
    const errors = [];
    page.on('pageerror', e => { errors.push(String(e)); console.log('PAGEERROR',String(e)); });
    // Road sources, surfaces and assets load unchanged from the served game.
    await page.route('**/src/app.js*', route => route.fulfill({ contentType:'application/javascript',
      body:fs.readFileSync(path.join(ROOT,'src/app.js'),'utf8')
        .replace('const W = 352, H = 844;',`const W = ${WIDTH}, H = 844;`)
        .replace('const VIEW_CELLS = 11;',`const VIEW_CELLS = ${CELLS};`)
        .replace('type: Phaser.AUTO,','type: Phaser.WEBGL,') }));
    await page.addInitScript(() => {
      window.__DAYLIGHT = 1;
      window.__renderScaleCap = 1;
      sessionStorage.setItem('terracart.safetySeen','1');
      localStorage.setItem('terracart.introSeen','1');
      localStorage.setItem('terracart.howtoSeen','1');
    });
    await page.goto((process.env.GAME_URL || 'http://127.0.0.1:8002')+'/index.html?sandbox=true&headingUp=false', {waitUntil:'domcontentloaded'});
    await page.waitForFunction(() => window.__scene?._bootOverlayGone,null,{timeout:120000});
    console.log('BOOT');
    const boot = await page.evaluate(() => {
      const s=__scene;
      s.scene.pause(); s.anims.pauseAll(); s.tweens.pauseAll();
      s._tickHomeZoom=()=>{}; s._setRestZoom(1,1); s.mapZoom=1;s._applyMapZoom();
      window.__renderScaleCap=1; window.__onGameScaleChange?.();
      BuildingOverlay.setEnabled(s,false);
      s.ensureStarterTrailerObject=()=>{};s.ensureStarterShopId=()=>{};s._syncModalGate=()=>{};
      HomeVariant.anchor=()=>null;HomeVariant.contains=()=>false;
      s.save.planted=[];s.save.fires=[];s.save.furniture=[];s.save.floorTiles=[];s.save.firepit=null;
      s.save.chopped=[];s.save.spent=[];
      const pc=s.playerToWorldCell(),entry=WorldGen.tileCache.get(WorldGen.tileKey(pc.tx,pc.ty));
      window.__roadStudy={tx:pc.tx,ty:pc.ty,N:entry.cellsPerEdge,edge:entry.tileEdgeM};
      return {canvas:[__game.canvas.width,__game.canvas.height],renderer:__game.renderer.type,...__roadStudy};
    });
    const results=[];
    for (const study of fixture.cases.filter(study=>!process.env.CASES||process.env.CASES.split(',').includes(study.id))) {
      const data = await page.evaluate(study => {
        const s=__scene,{tx,ty,N,edge}=__roadStudy,cm=edge/N,cx=Math.floor(N/2),cy=Math.floor(N/2);
        const terrain=WorldGen.T[study.terrain || 'PARK'];
        if (terrain == null) throw Error('Unknown fixture terrain '+study.terrain);
        for (const entry of WorldGen.tileCache.values()) {
          entry.grid.fill(terrain);entry.layers=[];entry.objects=[];entry.wildplants=[];entry.creatures=[];
          entry.buildingShapes=[];entry.owners.fill(0);entry.zone=null;entry.zoneDress=null;entry.scenic=null;
          entry.scenicDress=null;entry.streetIndex=null;entry.homeStreetIndex=null;entry.streetDress=null;
          entry.streetArea=null;entry.streetAreaVariants=null;entry.extraTreasures=[];entry.parkingTreasures=[];
          entry.coinDrops=[];entry.traps=[];entry.streetLairs=[];entry.treasure=null;entry.streetGround=null;
          entry.roadUnder={};entry.pathUnder={};entry.slowCells=null;entry.streetMarks=null;
          entry._streetLamps=null;entry._lampCells=null;entry._objectIndex=null;entry._preCullLights=null;
        }
        const point=([x,y])=>({x:(cx+x+.5)*4096/N,y:(cy+y+.5)*4096/N});
        const features=study.roads.map((r,i)=>({id:20000+i,type:2,tags:{class:r.class,name:r.name,...r.tags},geom:[r.points.map(point)]}));
        const layers=[{name:'landuse',extent:4096,features:[{type:3,tags:{class:'park'},geom:[[[0,0],[4096,0],[4096,4096],[0,4096]].map(([x,y])=>({x,y}))]}]},
          {name:'transportation',extent:4096,features},
          {name:'transportation_name',extent:4096,features:features.map(f=>({...f,tags:{name:f.tags.name}}))}];
        const generated=WorldGen.rasterizeTile(layers,N,tx,ty,edge);
        const e={...WorldGen.tileCache.get(WorldGen.tileKey(tx,ty)),...generated,layers,tx,ty,cellsPerEdge:N,tileEdgeM:edge};
        e.objects=[];e.wildplants=[];e.creatures=[];e.zone=null;e.zoneDress=null;e.scenic=null;e.scenicDress=null;
        e.homeStreetIndex=null;e.streetDress=null;e._streetLamps=null;e._lampCells=null;e.buildingShapes=[];
        e.extraTreasures=[];e.parkingTreasures=[];e.coinDrops=[];e.traps=[];e.streetLairs=[];e.treasure=null;
        // Hold the substrate constant to isolate overlap compositing from the raster grid.
        e.grid.fill(terrain);e.streetGround=null;e.roadUnder={};e.pathUnder={};
        // These synthetic fixtures isolate road ink against alternate substrates;
        // remove only the map's suppression-buffer data, not renderer behavior.
        if(study.isolateTerrain)e.roadClass?.fill(0);
        const generatedRoadVariants=e.streetIndex.lines.map(rec=>({fi:rec.fi,size:rec.size,variant:rec.variant}));
        for (const rec of e.streetIndex.lines) {
          const r=study.roads[rec.fi],len=Streets.lineLengthM(rec.line,1);
          if(rec.size!=='major')rec.variant=r.variant;rec.variantRanges=null;rec.homeSuppressedRanges=[];rec.nexusSuppressedRanges=[];
          rec.variantSegments=r.segments?.map(p=>({a:p.from*len,b:p.to*len,variant:p.variant,key:r.name+'|'+p.variant,lengthM:(p.to-p.from)*len*edge/4096}));
        }
        WorldGen.tileCache.set(WorldGen.tileKey(tx,ty),e);
        s.save.streets={};
        study.roads.forEach((r,i)=>{const len=Streets.lineLengthM(features[i].geom[0],edge/4096);const spans=r.restoreRanges?.map(([a,b])=>[a*len,b*len]) || (r.restored?[[0,len]]:[]);if(spans.length)Streets.restore(s.save,WorldGen.tileKey(tx,ty),Streets.lineKey(features[i],0),spans);});
        const p={x:tx*edge+(cx+.5)*cm,y:ty*edge+(cy+.5)*cm};
        s.playerM={x:p.x-s.startWorldM.x,y:p.y-s.startWorldM.y};s.peekM={x:0,y:0};s.syncMoveTarget?.();
        s._streetLampKey=null;s._streetLamps=null;
                s.roadVariantSeams=study.seams!==false;
        s._lastBorderIX=NaN;s._lastBorderIY=NaN;s._roadGeomKey=null;s._roadRebuildJob=null;s._buildingGeomKey=null;
        s.drawCells();const roadStarted=performance.now();s.drawRoadGeometry();const roadRenderMs=performance.now()-roadStarted;s._updateStreetLamps();s.drawObjects();
        for (const key of ['fogContainer','lightMap','atmosGroundGfx','atmosRimGfx','reachGfx','auraContainer','fxContainer',
          'sparkContainer','labelContainer','letterContainer','_sandboxLabels','ghostGlowContainer','tierGfx','enemyHealthGfx',
          '_workProgressGfx','player','playerShadow','playerHalo','gpsGhost','blightAura','facingGfx','facingChevronGfx',
          'projGfx','swordSwingGfx','boltContainer','buildingGeomContainer','buildingWallContainer']) s[key]?.setVisible?.(false);
        s.creaturePool?.forEach(o=>o.setVisible(false));s.towerPool?.forEach(o=>o.setVisible(false));
        s.objectPool?.forEach(o=>{if(!['rogue_lamp','rogue_lamp_unlit'].includes(o.texture?.key))o.setVisible(false);});
        BuildingLowPoly.clear(s);
        document.querySelectorAll('.game-modal,[id$="-modal"],#story,#howto,#bootload,#safety-card').forEach(e=>e.style.display='none');
        return {case:study.id,terrain:study.terrain || 'PARK',terrainIsolated:!!study.isolateTerrain,generatedRoadVariants,roadRenderMs,baseImageAlpha:s._roadGeomTarget?._pass?.image?.alpha,restoredImageAlpha:s._roadRestoredTarget?._pass?.image?.alpha,roads:features.map((f,i)=>({name:f.tags.name,class:f.tags.class,restored:!!study.roads[i].restored,restoreRanges:study.roads[i].restoreRanges||null,widthM:WorldGen.roadOverlayWidthM(f.tags),styles:StreetVariants.lineStyles(e,f,i,0,edge/4096).map(p=>({a:p.a,b:p.b,variant:p.variant,surface:typeof RoadSurfaces!=='undefined'?RoadSurfaces.familyFor(f.tags):null,title:typeof RoadSurfaces!=='undefined'&&RoadSurfaces.familyFor(f.tags)==='md'?'Old Trade Road':typeof RoadSurfaces!=='undefined'&&RoadSurfaces.familyFor(f.tags)==='lg'?'Dimensional Rift':StreetVariants.VARIANT_BY_ID[p.variant]?.title||p.variant||'Plain road'}))})),lamps:(s._streetLamps||[]).map(l=>({id:l.id,lineKey:l.lineKey,x:l.x,y:l.y})),renderedLampCount:(s.objectPool||[]).filter(o=>o.visible&&['rogue_lamp','rogue_lamp_unlit'].includes(o.texture?.key)).length,allLampCount:RoadOverlay.lampSitesForTile(tx,ty,e).length,seams:study.seams!==false};
      },study);
      await page.waitForTimeout(300);
      const image = await page.evaluate(width => new Promise(resolve => {
        const s=__scene,scale=__game.canvas.width/width;
        __game.renderer.snapshotArea(Math.round(s.viewLeft*scale),Math.round(s.viewTop*scale),Math.round(s.viewSize*scale),Math.round(s.viewSize*scale),img=>resolve(img.src));
      }),WIDTH);
      const passAudit=await page.evaluate(()=>{
        const inspect=pass=>{
          // Expand the owning union by one pixel for edge antialiasing only.
          // Any stronger ink outside it is leaked decoration or an unbounded join.
          const mask=document.createElement('canvas');mask.width=mask.height=pass.size;
          const ctx=mask.getContext('2d');ctx.lineJoin='round';ctx.strokeStyle='#fff';ctx.fillStyle='#fff';
          for(const op of pass.ops){
            ctx.lineCap=op.cap || 'round';ctx.lineWidth=op.w+2;ctx.beginPath();ctx.moveTo(op.pts[0],op.pts[1]);
            for(let i=2;i<op.pts.length;i+=2)ctx.lineTo(op.pts[i],op.pts[i+1]);ctx.stroke();
            if(op.cap==='butt')for(const at of [op.startRound?0:-1,op.endRound?op.pts.length-2:-1]){
              if(at<0)continue;ctx.beginPath();ctx.arc(op.pts[at],op.pts[at+1],ctx.lineWidth/2,0,Math.PI*2);ctx.fill();
            }
          }
          const allowed=ctx.getImageData(0,0,pass.size,pass.size).data;
          const actual=pass.ctx.getImageData(0,0,pass.size,pass.size).data;
          let leakedPixels=0,paintedPixels=0;
          for(let i=3;i<actual.length;i+=4){if(actual[i]>8){paintedPixels++;if(!allowed[i])leakedPixels++;}}
          return {leakedPixels,paintedPixels,ops:pass.ops.length,decorOps:pass.decorOps.length};
        };
        return {base:inspect(__scene._roadGeomTarget._pass),restored:inspect(__scene._roadRestoredTarget._pass)};
      });
      data.passAudit=passAudit;
      const passes=await page.evaluate(()=>({base:__scene._roadGeomTarget._pass.ctx.canvas.toDataURL(),restored:__scene._roadRestoredTarget._pass.ctx.canvas.toDataURL()}));
      for(const [kind,url] of Object.entries(passes))fs.writeFileSync(path.join(OUT,`${LABEL}-${study.id}-${kind}-${CELLS}.png`),Buffer.from(url.split(',')[1],'base64'));
      const file=`${LABEL}-${study.id}-${CELLS}.png`;
      fs.writeFileSync(path.join(OUT,file),Buffer.from(image.split(',')[1],'base64'));
      if(study.cameraCheck){
        const camera=await page.evaluate(()=>({original:{phaseX:__scene._roadGeomTarget._pass.phaseX,phaseY:__scene._roadGeomTarget._pass.phaseY,ops:__scene._roadGeomTarget._pass.ops,decor:__scene._roadGeomTarget._pass.decorOps,restoredOps:__scene._roadRestoredTarget._pass.ops,restoredDecor:__scene._roadRestoredTarget._pass.decorOps}}));
        await page.evaluate(()=>{const s=__scene;window.__selectedRoadOrigin={...s.playerM};s.playerM.x+=s.cellM;RoadOverlay.invalidate(s);s._lastBorderIX=NaN;s._lastBorderIY=NaN;s.drawCells();s.drawRoadGeometry();});
        camera.shifted=await page.evaluate(()=>({phaseX:__scene._roadGeomTarget._pass.phaseX,phaseY:__scene._roadGeomTarget._pass.phaseY,ops:__scene._roadGeomTarget._pass.ops,decor:__scene._roadGeomTarget._pass.decorOps,restoredOps:__scene._roadRestoredTarget._pass.ops,restoredDecor:__scene._roadRestoredTarget._pass.decorOps}));
        fs.writeFileSync(path.join(OUT,`${LABEL}-${study.id}-camera.json`),JSON.stringify(camera,null,2));
        const moved=await page.evaluate(()=>__scene._roadGeomTarget._pass.ctx.canvas.toDataURL());
        fs.writeFileSync(path.join(OUT,`${LABEL}-${study.id}-shifted-base-${CELLS}.png`),Buffer.from(moved.split(',')[1],'base64'));
        await page.evaluate(()=>{const s=__scene;s.playerM={...__selectedRoadOrigin};RoadOverlay.invalidate(s);s._lastBorderIX=NaN;s._lastBorderIY=NaN;s.drawCells();s.drawRoadGeometry();});
        const returned=await page.evaluate(()=>__scene._roadGeomTarget._pass.ctx.canvas.toDataURL());
        fs.writeFileSync(path.join(OUT,`${LABEL}-${study.id}-returned-base-${CELLS}.png`),Buffer.from(returned.split(',')[1],'base64'));
      }
      results.push({...data,file});console.log('SNAP',file,'lamps',data.allLampCount);
    }
    const materialAudit=await page.evaluate(()=>{
      const inspect=tile=>{if(!tile)return null;const data=tile.getContext('2d').getImageData(0,0,tile.width,tile.height).data;let transparent=0,partial=0,opaque=0;for(let i=3;i<data.length;i+=4){if(!data[i])transparent++;else if(data[i]===255)opaque++;else partial++;}return {pixels:tile.width*tile.height,transparent,partial,opaque};};
      const cancellation=(()=>{
        const make=()=>{const c=document.createElement('canvas');c.width=c.height=64;return c.getContext('2d');};
        const reused=make(),fresh=make();
        const op=(x,y,color)=>({w:3,c:color,alpha:1,pts:[{x,y},{x:x+16,y}],
          clip:{points:[{x,y},{x:x+16,y}],width:12,startRound:false,endRound:false,owner:String(x),priority:16,bounds:[x-6,y-6,x+22,y+6]}});
        const abandoned=RoadOverlay.paintSurfaceDecorSteps(reused,[op(8,16,0xffffff)],64);
        abandoned.next(); // Leave the real Canvas clip saved across a yield.
        fresh.drawImage(reused.canvas,0,0);
        RoadOverlay.paintSurfaceDecor(reused,[op(40,48,0x99d9c2)],64);
        RoadOverlay.paintSurfaceDecor(fresh,[op(40,48,0x99d9c2)],64);
        const a=reused.getImageData(0,0,64,64).data,b=fresh.getImageData(0,0,64,64).data;
        let differentBytes=0;for(let i=0;i<a.length;i++)if(a[i]!==b[i])differentBytes++;
        return {differentBytes,replacementAlpha:a[(48*64+48)*4+3]};
      })();
      const endpointOwnership=(()=>{
        const canvas=document.createElement('canvas');canvas.width=canvas.height=160;
        const ctx=canvas.getContext('2d');
        const through={points:[{x:20,y:100},{x:100,y:100}],width:40,startRound:true,endRound:true,
          owner:'through',priority:80,bounds:[0,80,120,120],surface:'md'};
        const branch={points:[{x:100,y:100},{x:140,y:100}],width:20,startRound:true,endRound:true,
          owner:'branch',priority:40,bounds:[90,90,150,110],surface:'md'};
        RoadOverlay.paintSurfaceDecor(ctx,[
          {w:1,c:0x999999,alpha:1,pts:through.points,clip:through},
          {w:1,c:0xc7bda0,alpha:1,fill:true,pts:[{x:108,y:97},{x:112,y:97},{x:112,y:103},{x:108,y:103}],clip:branch},
        ],160);
        return {branchPaverAlpha:ctx.getImageData(110,100,1,1).data[3]};
      })();
      return {cancellation,endpointOwnership,surfaces:typeof RoadSurfaces==='undefined'?null:['md','lg'].flatMap(family=>[false,true].map(restored=>({family,restored,...inspect(RoadSurfaces.tile(family,restored))}))),
        shade:['lantern','confusion_path','greenway'].map(variant=>{const tile=RoadOverlay.selectedRoadTile(variant,false),pixels=tile.getContext('2d').getImageData(0,0,tile.width,tile.height).data;let min=255;for(let i=3;i<pixels.length;i+=4)min=Math.min(min,pixels[i]);const restored=inspect(RoadOverlay.selectedRoadTile(variant,true));return {variant,minAlpha:min,effectiveAlpha:min/255*.61,restoredClear:restored.transparent};}),
        fixedVariants:['secondary','primary'].map(cls=>({class:cls,value:StreetVariants.pavementVariantFor({class:cls},'orchard')}))};
    });
    const audit={label:LABEL,sourceSha256,materialSha256,cells:CELLS,source:'shipping served modules',boot,results,materialAudit,errors,webglError:await page.evaluate(()=>__game.renderer.gl?.getError()??null)};
    fs.writeFileSync(path.join(OUT,`${LABEL}-metadata-${CELLS}.json`),JSON.stringify(audit,null,2));
    if(errors.length||audit.webglError!==0||boot.renderer!==2) throw Error('Renderer audit failed '+JSON.stringify({boot,errors,webglError:audit.webglError}));
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
