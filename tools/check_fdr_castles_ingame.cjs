// Real MapScene/BuildingOverlay integration checks, with isolated browser saves.
const {chromium}=require('playwright-core');
const assert=require('node:assert/strict'),fs=require('node:fs');
const OUT=process.env.OUT_DIR||'/tmp/fdr-ingame-checks';
const URL=process.env.GAME_URL||'http://127.0.0.1:8118/index.html?sandbox=true&sandboxZone=castle&skipStory=true&skipTutorial=true';
const shapes={narrow:[[-100,-26],[100,-26],[100,26],[-100,26]],rectangle:[[-100,-80],[100,-80],[100,80],[-100,80]],concave:[[-100,-80],[100,-80],[100,-20],[20,-20],[20,80],[-100,80]],skewed:[[-100,-64],[70,-80],[104,62],[-66,80]],acute:[[-100,-64],[50,-80],[104,0],[20,28],[-42,80],[-96,44]]};
(async()=>{
 fs.mkdirSync(OUT,{recursive:true});const report={cases:[],errors:[],limitations:['Desktop headless Chromium; screenshots require visual review. Fixtures replace only browser-local buildingShapes.']};
 const env={...process.env};delete env.DISPLAY;
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM||'/usr/lib/chromium/chromium',env,args:['--no-sandbox','--ozone-platform=headless','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try{for(const renderer of (process.env.RENDERERS||'webgl,canvas').split(',')){
  const page=await browser.newPage({viewport:{width:700,height:1000},deviceScaleFactor:1,serviceWorkers:'block'});
  page.on('pageerror',error=>report.errors.push({renderer,message:error.message}));
  await page.addInitScript(()=>{sessionStorage.setItem('terracart.safetySeen','1');localStorage.setItem('terracart.introSeen','1');localStorage.setItem('terracart.howtoSeen','1');});
  await page.route('**/src/app.js*',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replace('type: Phaser.AUTO,',`type: Phaser.${renderer==='canvas'?'CANVAS':'WEBGL'},`)});});
  await page.goto(URL,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__scene?._bootOverlayGone,null,{timeout:90000});
  await page.waitForTimeout(350);
  await page.screenshot({path:`${OUT}/${renderer}-live-sandbox.png`});
  const live=await page.evaluate(()=>({renderer:__game.renderer.type,castles:__scene._fdrCastleLayouts?.size||0,blocks:__scene._wallPerspective?.castles?.blocks.length||0,atlas:__scene.textures.exists('fdr_castle_atlas'),legacyModelTowers:(__scene.towerPool||[]).filter(sprite=>sprite.visible&&__scene._fdrCastleLayouts?.has(sprite._staticObject?.castle)).length}));
  assert.equal(live.renderer,renderer==='canvas'?1:2);assert.equal(live.atlas,true);assert.equal(live.legacyModelTowers,0);report.cases.push({...live,renderer,stage:'live'});
  await page.evaluate(()=>{
   const s=__scene;__game.loop.stop();s.scene.pause();
   document.querySelectorAll('[id$="-modal"],#story,#howto').forEach(el=>el.remove());s._syncModalGate();s._attachCompass();BuildingOverlay.setEnabled(s,true);
   const frame=overlayFrame(s,e=>!!e.buildingShapes),anchor=viewAnchorWorldM(s),row=frame.tiles[0];
   if(!row)throw Error('No ready building overlay tile');
   for(const tile of frame.tiles)tile.entry.buildingShapes=[];
   const key='fdr-ingame-fixture',oldClaim=s.isClaimedKey;
   const probe=window.fdrIngameProbe={key,row,anchor,active:true};
   s.isClaimedKey=function(k){return k===key?probe.active:oldClaim.call(this,k);};
   probe.place=function(points,active){probe.active=active;s.peekM={x:0,y:0};s.mapZoom=1;s.mapRot=0;s._huManualAngle=0;
    const anchor=viewAnchorWorldM(s),e=row.entry,cx=anchor.x-row.tx*e.tileEdgeM,cy=anchor.y-row.ty*e.tileEdgeM;probe.anchor=anchor;
    e.buildingShapes=[{key,tier:12,ring:points.flatMap(([x,y])=>[cx+x/CELL_PX*s.cellM,cy+y/CELL_PX*s.cellM])}];
    s._buildingGeomKey=null;s.drawCells();s.drawRoadGeometry();s._overlayFrameSeq++;s._buildingGeomKey=null;s.drawBuildingGeometry();s._applyMapZoom();WallPerspective.update(s);
    const group=s._wallPerspective.castles;probe.retained=new Set(group.blocks);probe.tint=group.blocks.flatMap(b=>b.materialFaces||[])[0]?.color;
   };
   probe.turn=function(degrees){s.mapRot=degrees*Math.PI/180;s._huManualAngle=s.mapRot;s._applyMapZoom();WallPerspective.update(s);__game.step(performance.now(),16);};
   probe.measure=function(retention=true){const group=s._wallPerspective.castles,model=s._fdrCastleLayouts.get(key);if(!model)throw Error('Fixture not emitted: '+JSON.stringify({keys:[...s._fdrCastleLayouts.keys()],anchor:probe.anchor,row:[probe.row.tx,probe.row.ty],ring:probe.row.entry.buildingShapes,groupBlocks:group?.blocks.length,geomKey:s._buildingGeomKey}));
    const towerHits=model.layout.towers.map(t=>{const block=group.blocks.find(b=>b.building?.key===key&&Math.abs(b.x-t.x)<1e-4&&Math.abs(b.y-t.y)<1e-4&&b.top===t.height);const face=block?.materialFaces.find(f=>f.visible&&!f.normal);if(!face)return {expected:key,actual:null};const p=face.projected.reduce((p,q)=>({x:p.x+q.x/3,y:p.y+q.y/3}),{x:group.x,y:group.y});return {expected:key,actual:Render.buildingHit(s,p.x,p.y)};});
    const legacy=(s.towerPool||[]).filter(o=>o.visible&&o._staticObject?.castle===key).length;
    const suppressed=RENDER_SPEC.tower.key({kind:'tower',castle:key},s)===null;
    return {blocks:group.blocks.length,towers:model.layout.towers.length,keep:!!model.layout.keep,tint:group.blocks.flatMap(b=>b.materialFaces||[])[0]?.color,finite:group.blocks.every(b=>[...b.projected].every(Number.isFinite)),retained:!retention||group.blocks.length===probe.retained.size&&group.blocks.every(b=>probe.retained.has(b)),towerHits,legacy,suppressed,offset:{x:group.x,y:group.y}};
   };
  });
  for(const [shape,points] of Object.entries(shapes).filter(([name])=>!process.env.SHAPES||process.env.SHAPES.split(',').includes(name))){
   await page.evaluate(points=>fdrIngameProbe.place(points,true),points);
   let activeTint;
   for(const angle of [0,45,135,225]){
    await page.evaluate(angle=>fdrIngameProbe.turn(angle),angle);
    const result=await page.evaluate(()=>fdrIngameProbe.measure());activeTint=result.tint;
    report.cases.push({renderer,shape,angle,state:'claimed',...result});
    assert.ok(result.blocks>0);assert.ok(result.towers>0);assert.ok(result.finite&&result.retained&&result.suppressed);assert.equal(result.legacy,0);assert.ok(result.towerHits.every(h=>h.actual===h.expected),JSON.stringify(result.towerHits));
    await page.screenshot({path:`${OUT}/${renderer}-${shape}-${angle}.png`});
   }
   await page.evaluate(points=>{fdrIngameProbe.place(points,false);fdrIngameProbe.turn(45);},points);
   const weathered=await page.evaluate(()=>fdrIngameProbe.measure());assert.notEqual(weathered.tint,activeTint);report.cases.push({renderer,shape,state:'unclaimed',...weathered});
   await page.screenshot({path:`${OUT}/${renderer}-${shape}-unclaimed.png`});
   const pan=await page.evaluate(()=>{const s=__scene,before={...fdrIngameProbe.measure().offset};s.peekM={x:s.cellM*.3,y:-s.cellM*.2};s.drawCells();s.drawRoadGeometry();s._overlayFrameSeq++;s._buildingGeomKey=null;s.drawBuildingGeometry();s._applyMapZoom();fdrIngameProbe.turn(45);return {before,...fdrIngameProbe.measure(false)};});
   assert.ok(pan.finite);assert.ok(pan.towerHits.every(h=>h.actual===h.expected));assert.ok(Math.abs(pan.offset.x-pan.before.x)+Math.abs(pan.offset.y-pan.before.y)>.01);report.cases.push({renderer,shape,state:'pan',...pan});
   await page.screenshot({path:`${OUT}/${renderer}-${shape}-pan.png`});
   console.log(renderer,shape,'passed');
  }
  await page.close();
 }assert.deepEqual(report.errors,[]);report.passed=true;
 }catch(error){report.passed=false;report.failure=error.stack;throw error;}
 finally{fs.writeFileSync(`${OUT}/report.json`,JSON.stringify(report,null,2)+'\n');await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
