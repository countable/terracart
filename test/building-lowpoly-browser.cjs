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
 rebuild();return {sheets,added};
});assert.equal(sharing.sheets,1);assert.equal(sharing.added,0);
const result=await page.evaluate(()=>{
 const s=reviewScene,state=s._lowpoly,original=state.faces.slice(),textures=s.textures.getTextureKeys().length,builds=state.builds;
 let refreshes=0;for(const texture of new Set(original.map(f=>f.texture))){const refresh=texture.refresh.bind(texture);texture.refresh=()=>{refreshes++;return refresh();};}
 const times=[];let maxDrift=0;
 for(let deg=0;deg<=360;deg++){s.mapRot=deg*Math.PI/180;const t=performance.now();BuildingLowPoly.update(s);times.push(performance.now()-t);
 for(const f of state.faces)for(let i=0;i<3;i++){const p=f.points[i],q=f.projected[i],dx=q.x-f.x-p.x,dy=q.y-f.y-p.y;maxDrift=Math.max(maxDrift,Math.abs(Math.cos(s.mapRot)*dx-Math.sin(s.mapRot)*dy),Math.abs(Math.sin(s.mapRot)*dx+Math.cos(s.mapRot)*dy+p.z));}}
 times.sort((a,b)=>a-b);return {refreshes,builds:state.builds-builds,textures:s.textures.getTextureKeys().length-textures,maxDrift,retained:original.every(f=>state.faces.includes(f)),p95:times[Math.floor(times.length*.95)],triangles:state.faces.length};
});
assert.equal(result.refreshes,0);assert.equal(result.builds,0);assert.equal(result.textures,0);assert(result.retained);assert(result.maxDrift<1e-6);
for(const angle of [0,37,90,180,270]){await page.locator('#angle').fill(String(angle));await page.waitForTimeout(100);await page.screenshot({path:`/tmp/lowpoly-${angle}.png`});}
for(const roof of ['inset','shallow','flat','styles']){await page.selectOption('#roof',roof);await page.locator('#angle').fill('25');await page.waitForTimeout(100);await page.screenshot({path:`/tmp/lowpoly-${roof}.png`});}
assert.deepEqual(errors,[]);console.log(JSON.stringify(result));
const game=await browser.newPage();const gameErrors=[];game.on('pageerror',e=>gameErrors.push(e.message));await game.goto('http://localhost:7731/index.html?sandbox=true&sandboxZone=restoration');await game.waitForFunction(()=>window.__scene?._bootOverlayGone,{},{timeout:60000});await game.waitForTimeout(500);const runtime=await game.evaluate(()=>{
 const scene=__scene,frame=overlayFrame(scene,()=>true),{entry,tx,ty}=frame.tiles[0],anchor=viewAnchorWorldM(scene);
 const x=anchor.x-tx*entry.tileEdgeM,y=anchor.y-ty*entry.tileEdgeM,m=scene.cellM;
 entry.buildingShapes.push({key:'lowpoly-browser-fixture',tier:9,ring:Float32Array.from([x-m,y-m,x+m,y-m,x+m,y+m,x,y+m,x,y,x-m,y])});
 BuildingOverlay.setEnabled(scene,true);scene._overlayFrameSeq++;scene.drawBuildingGeometry();scene.drawObjects();
 const state=scene._lowpoly;return {lowpoly:!!state,buildings:state?.buildings.length,covered:state?.keys.has('lowpoly-browser-fixture'),keys:[...state.keys],renderer:scene.game.renderer.type};
});console.log('game',runtime);assert(runtime.lowpoly&&runtime.buildings>0&&runtime.covered,'actual game renders the injected notched footprint');await game.evaluate(()=>document.querySelectorAll('#bootload,#story,#safety-card').forEach(e=>e.remove()));await game.waitForTimeout(100);await game.screenshot({path:'/tmp/lowpoly-game.png'});assert.deepEqual(gameErrors,[]);
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
