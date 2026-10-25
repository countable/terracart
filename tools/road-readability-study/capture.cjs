#!/usr/bin/env node
// Controlled road geometry in the actual Phaser scene. No map-review painter.
// Baseline: ROAD_SOURCE=/tmp/road-readability-baseline.js LABEL=before node tools/road-readability-study/capture.cjs
// Current:  LABEL=after node tools/road-readability-study/capture.cjs
const fs = require('node:fs'), path = require('node:path'), crypto=require('node:crypto');
const { chromium } = require('playwright-core');
const ROOT = path.resolve(__dirname, '../..');
const OUT = process.env.OUT_DIR || '/home/claude/.artifacts/road-readability-implementation';
const LABEL = process.env.LABEL || 'after';
const CELLS = Number(process.env.CELLS || 11);
const WIDTH = CELLS * 32;
const fixture = require('./fixture.json');
const roadSource=fs.readFileSync(process.env.ROAD_SOURCE||path.join(ROOT,'src/road_overlay.js'),'utf8');
const sourceSha256=crypto.createHash('sha256').update(roadSource).digest('hex');
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browserEnv={...process.env};delete browserEnv.DISPLAY;
  const browser = await chromium.launch({ env:browserEnv, executablePath: process.env.CHROMIUM || '/usr/bin/chromium', headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--ignore-gpu-blocklist', '--ozone-platform=headless', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({viewport:{width:900,height:1150},serviceWorkers:'block'});
    const errors = [];
    page.on('pageerror', e => { errors.push(String(e)); console.log('PAGEERROR',String(e)); });
    await page.route('**/src/road_overlay.js*', route => route.fulfill({
      contentType: 'application/javascript', body:roadSource }));
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
    await page.goto((process.env.GAME_URL || 'http://127.0.0.1:8000')+'/index.html?sandbox=true&headingUp=false', {waitUntil:'domcontentloaded'});
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
    for (const study of fixture.cases) {
      const data = await page.evaluate(study => {
        const s=__scene,{tx,ty,N,edge}=__roadStudy,cm=edge/N,cx=Math.floor(N/2),cy=Math.floor(N/2);
        for (const entry of WorldGen.tileCache.values()) {
          entry.grid.fill(WorldGen.T.PARK);entry.layers=[];entry.objects=[];entry.wildplants=[];entry.creatures=[];
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
        e.grid.fill(WorldGen.T.PARK);e.streetGround=null;e.roadUnder={};e.pathUnder={};
        for (const rec of e.streetIndex.lines) {
          const r=study.roads[rec.fi],len=Streets.lineLengthM(rec.line,1);
          rec.variant=r.variant;rec.variantRanges=null;rec.homeSuppressedRanges=[];rec.nexusSuppressedRanges=[];
          rec.variantSegments=r.segments?.map(p=>({a:p.from*len,b:p.to*len,variant:p.variant,key:r.name+'|'+p.variant,lengthM:(p.to-p.from)*len*edge/4096}));
        }
        WorldGen.tileCache.set(WorldGen.tileKey(tx,ty),e);
        s.save.streets={};
        study.roads.forEach((r,i)=>{if(r.restored) Streets.restore(s.save,WorldGen.tileKey(tx,ty),Streets.lineKey(features[i],0),[[0,Streets.lineLengthM(features[i].geom[0],edge/4096)]]);});
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
        return {case:study.id,roadRenderMs,roads:features.map((f,i)=>({name:f.tags.name,class:f.tags.class,restored:!!study.roads[i].restored,widthM:WorldGen.roadOverlayWidthM(f.tags),styles:StreetVariants.lineStyles(e,f,i,0,edge/4096).map(p=>({a:p.a,b:p.b,variant:StreetVariants.pavementVariantFor(f.tags,p.variant),title:StreetVariants.pavementVariantFor(f.tags,p.variant)==='suppressed'?'Major road (rift)':StreetVariants.VARIANT_BY_ID[p.variant]?.title||p.variant||'Plain road'}))})),lamps:(s._streetLamps||[]).map(l=>({id:l.id,lineKey:l.lineKey,x:l.x,y:l.y})),renderedLampCount:(s.objectPool||[]).filter(o=>o.visible&&['rogue_lamp','rogue_lamp_unlit'].includes(o.texture?.key)).length,allLampCount:RoadOverlay.lampSitesForTile(tx,ty,e).length,seams:study.seams!==false};
      },study);
      await page.waitForTimeout(300);
      const image = await page.evaluate(width => new Promise(resolve => {
        const s=__scene,scale=__game.canvas.width/width;
        __game.renderer.snapshotArea(Math.round(s.viewLeft*scale),Math.round(s.viewTop*scale),Math.round(s.viewSize*scale),Math.round(s.viewSize*scale),img=>resolve(img.src));
      }),WIDTH);
      const passes=await page.evaluate(()=>({base:__scene._roadGeomTarget._pass.ctx.canvas.toDataURL(),restored:__scene._roadRestoredTarget._pass.ctx.canvas.toDataURL()}));
      for(const [kind,url] of Object.entries(passes))fs.writeFileSync(path.join(OUT,`${LABEL}-${study.id}-${kind}-${CELLS}.png`),Buffer.from(url.split(',')[1],'base64'));
      const file=`${LABEL}-${study.id}-${CELLS}.png`;
      fs.writeFileSync(path.join(OUT,file),Buffer.from(image.split(',')[1],'base64'));
      results.push({...data,file});console.log('SNAP',file,'lamps',data.allLampCount);
    }
    const audit={label:LABEL,sourceSha256,cells:CELLS,source:process.env.ROAD_SOURCE||'src/road_overlay.js',boot,results,errors,webglError:await page.evaluate(()=>__game.renderer.gl?.getError()??null)};
    fs.writeFileSync(path.join(OUT,`${LABEL}-metadata-${CELLS}.json`),JSON.stringify(audit,null,2));
    if(errors.length||audit.webglError!==0||boot.renderer!==2) throw Error('Renderer audit failed '+JSON.stringify({boot,errors,webglError:audit.webglError}));
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
