const {chromium}=require('playwright-core'),assert=require('node:assert/strict');
(async()=>{const env={...process.env};delete env.DISPLAY;
const browser=await chromium.launch({executablePath:'/usr/lib/chromium/chromium',env,args:['--no-sandbox','--ozone-platform=headless','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{const page=await browser.newPage({viewport:{width:1120,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto('http://localhost:7731/tools/building-lowpoly-preview.html');await page.waitForFunction(()=>window.ready);await page.selectOption('#roof','ridge');
const sharing=await page.evaluate(()=>{
 const scene=reviewScene,recipe={...recipes[0]},pts=[{x:0,y:0},{x:50,y:0},{x:50,y:50},{x:0,y:50}];
 const before=scene.textures.getTextureKeys().length;
 BuildingLowPoly.begin(scene);
 for(const stories of [1,2,3])BuildingLowPoly.add(scene,pts,{...recipe,stories},'ridge');
 const sheets=new Set(scene._lowpoly.faces.map(f=>f.texture)).size,added=scene.textures.getTextureKeys().length-before;
 const heights=scene._lowpoly.buildings.map(m=>m.height);
 const texture=scene._lowpoly.faces[0].texture;
 const material={key:texture.key,width:texture.getSourceImage().width,height:texture.getSourceImage().height,roofPeriod:texture.roofPeriod};
 const large=BuildingLowPoly.add(scene,[{x:0,y:0},{x:800,y:0},{x:800,y:800},{x:0,y:800}],recipe,'ridge');
 let wrapped=false;
 const roofPhase=large.faces.filter(f=>f.kind==='roof'&&!f.solid&&!f.rawUV).every(f=>f.points.every(p=>{
  const shifts=[p.u/1.3-p.tu*512,p.v/1.3-(p.tv*512-128)];
  return shifts.every(shift=>{if(Math.abs(shift)>1)wrapped=true;return Math.abs(shift/120-Math.round(shift/120))<1e-8;});
 }));
 rebuild();return {sheets,added,heights,material,sheetSize:BuildingLowPoly.LOOK.sheet,roofPhase,wrapped};
});assert.equal(sharing.sheets,1);assert.equal(sharing.added,0);
assert(sharing.material.key.startsWith('lowpoly:tileset-v2:'),'review uses approved materials');
assert(sharing.wrapped&&sharing.roofPhase,'large approved clay roofs retain tile phase across atlas wraps');
assert.equal(sharing.material.width,sharing.sheetSize);assert.equal(sharing.material.height,sharing.sheetSize);assert.equal(sharing.material.roofPeriod,360);
sharing.heights.forEach((height,i)=>assert(Math.abs(height-((i+1)*31.2+5))<1e-6));
const result=await page.evaluate(()=>{
 const s=reviewScene,state=s._lowpoly,original=state.faces.slice(),textures=s.textures.getTextureKeys().length,builds=state.builds;
 let refreshes=0;for(const texture of new Set(original.map(f=>f.texture))){const refresh=texture.refresh.bind(texture);texture.refresh=()=>{refreshes++;return refresh();};}
 const times=[];let maxDrift=0;
 for(let deg=0;deg<=360;deg++){s.mapRot=deg*Math.PI/180;const t=performance.now();BuildingLowPoly.update(s);times.push(performance.now()-t);
 for(const f of state.faces)for(let i=0;i<3;i++){const p=f.points[i],q=f.projected[i],dx=q.x-f.x-p.x,dy=q.y-f.y-p.y;maxDrift=Math.max(maxDrift,Math.abs(Math.cos(s.mapRot)*dx-Math.sin(s.mapRot)*dy),Math.abs(Math.sin(s.mapRot)*dx+Math.cos(s.mapRot)*dy+p.z*BuildingLowPoly.LOOK.heightScale));}}
 times.sort((a,b)=>a-b);return {refreshes,builds:state.builds-builds,textures:s.textures.getTextureKeys().length-textures,maxDrift,retained:original.every(f=>state.faces.includes(f)),p95:times[Math.floor(times.length*.95)],triangles:state.faces.length};
});
assert.equal(result.refreshes,0);assert.equal(result.builds,0);assert.equal(result.textures,0);assert(result.retained);assert(result.maxDrift<1e-6);
for(const angle of [0,37,90,180,270]){await page.locator('#angle').fill(String(angle));await page.waitForTimeout(100);await page.screenshot({path:`/tmp/lowpoly-${angle}.png`});}
for(const roof of ['inset','shallow','flat','styles']){await page.selectOption('#roof',roof);await page.locator('#angle').fill('25');await page.waitForTimeout(100);await page.screenshot({path:`/tmp/lowpoly-${roof}.png`});}
// The cross fixture previously exhausted the roof atlas and smeared its edge.
await page.selectOption('#footprints','cottages');await page.selectOption('#roof','ridge');
await page.locator('#angle').fill('37');await page.waitForTimeout(100);
const crossUV=await page.evaluate(()=>{
 const mesh=reviewScene._lowpoly.buildings[3];
 return mesh.faces.filter(f=>f.kind==='roof').every(f=>f.points.every((p,i)=>
  Math.abs(f.projected[i].v-(.25+p.v/(512*1.3)))<1e-8&&
  Math.abs(f.projected[i].u-p.u/(512*1.3))<1e-8));
});assert(crossUV,'cross-shaped roof retains unclamped texture coordinates');
await page.screenshot({path:'/tmp/lowpoly-pixel-cottages.png'});
console.log('pixel material',sharing,'cross UVs',crossUV);
assert.deepEqual(errors,[]);console.log(JSON.stringify(result));
const game=await browser.newPage();const gameErrors=[];game.on('pageerror',e=>gameErrors.push(e.message));await game.goto('http://localhost:7731/index.html?sandbox=true&sandboxZone=restoration');await game.waitForFunction(()=>window.__scene?._bootOverlayGone,{},{timeout:60000});await game.waitForTimeout(500);const runtime=await game.evaluate(()=>{
 const scene=__scene,frame=overlayFrame(scene,()=>true),{entry,tx,ty}=frame.tiles[0],anchor=viewAnchorWorldM(scene);
 const x=anchor.x-tx*entry.tileEdgeM,y=anchor.y-ty*entry.tileEdgeM,m=scene.cellM;
 entry.buildingShapes.push({key:'lowpoly-browser-fixture',tier:9,ring:Float32Array.from([x-m,y-m,x+m,y-m,x+m,y+m,x,y+m,x,y,x-m,y])});
 BuildingOverlay.setEnabled(scene,true);scene._overlayFrameSeq++;scene.drawBuildingGeometry();scene.drawObjects();
 const state=scene._lowpoly;return {lowpoly:!!state,buildings:state?.buildings.length,covered:state?.keys.has('lowpoly-browser-fixture'),keys:[...state.keys],renderer:scene.game.renderer.type,generated:scene.textures.exists('building_material_reference'),wizardKey:Render.houseTextureKey('wizard',{id:'test'},scene),turretKey:Render.houseTextureKey('turret',{id:'test'},scene),towerMeshes:state.buildings.filter(m=>['wizard','turret'].includes(m.role)).length};
});
// Check the live Phaser container order, including the north-up path.
const mixed=await game.evaluate(async()=>{
 const s=__scene,mesh=s._lowpoly.buildings.find(m=>m.obj.visible),objects=[];
 const previousPeers=s._peerUprightPieces;
 for(const dy of [-24,24]){
  const a=mesh.obj._huAnchor,o=s.add.image(a.x,a.y+dy,'__WHITE').setDisplaySize(12,70).setOrigin(.5,1);
  o._huAnchor={x:a.x,y:a.y+dy};s.worldContainer.add(o);objects.push(o);
 }
 const anchor=viewAnchorWorldM(s);
 s._peerUprightPieces=objects.map(o=>({sprite:o,rank:3,groundY:anchor.y+(o.y-s.viewCenterY)*s.cellM/CELL_PX}));
 const results=[];
 try{
  s.drawObjects();
  // Run the shipping pre-render synchronously so sensor easing cannot change
  // the requested heading between sorting and inspection.
  for(const angle of [0,.37,Math.PI/2+.1,Math.PI,Math.PI*1.5+.1]){
   s.mapRot=angle;HeadingUp._preRender(s);
   const list=s.worldContainer.list.filter(o=>o===mesh.obj||objects.includes(o));
   const key=o=>Math.sin(angle)*o._huAnchor.x+Math.cos(angle)*o._huAnchor.y;
   results.push({angle,ordered:list.every((o,i)=>!i||key(list[i-1])<=key(o)),count:list.length,rotation:mesh.obj.rotation});
   HeadingUp._postRender(s);
  }
 }finally{for(const o of objects)o.destroy();s._peerUprightPieces=previousPeers;}
 return results;
});
assert(mixed.every(r=>r.ordered&&r.count===3&&r.rotation===0),'live world interleaves buildings and billboards at every heading');
console.log('mixed ordering',mixed);
console.log('game',runtime);assert(runtime.generated);assert.equal(runtime.wizardKey,'shrine');assert.equal(runtime.turretKey,'tower');assert.equal(runtime.towerMeshes,0);assert(runtime.lowpoly&&runtime.buildings>0&&runtime.covered,'actual game renders the injected notched footprint');await game.evaluate(()=>document.querySelectorAll('#bootload,#story,#safety-card').forEach(e=>e.remove()));await game.waitForTimeout(100);await game.screenshot({path:'/tmp/lowpoly-game.png'});assert.deepEqual(gameErrors,[]);
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
