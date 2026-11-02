// Actual renderer with isolated browser storage and a deterministic grass fixture.
const fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require('playwright-core');
const out=process.env.ART_OUTPUT||'/tmp/grass-native-runtime';fs.mkdirSync(out,{recursive:true});
(async()=>{
 const env={...process.env};delete env.DISPLAY;
 const browser=await chromium.launch({env,executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--ozone-platform=headless','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try{
 const page=await browser.newPage({viewport:{width:900,height:1000},serviceWorkers:'block'}),errors=[];
 page.on('pageerror',e=>errors.push(String(e)));
 await page.addInitScript(()=>{window.__renderScaleCap=1;window.__DAYLIGHT=1;sessionStorage.setItem('terracart.safetySeen','1');localStorage.setItem('terracart.introSeen','1');localStorage.setItem('terracart.howtoSeen','1');});
 await page.goto('http://localhost:8000/index.html?sandbox=true&deepforest=on',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__scene?._bootStatusDone,null,{timeout:120000});
 await page.waitForFunction(()=>window.__scene?._bootOverlayGone,null,{timeout:120000});
 console.log('BOOT READY');
 await page.evaluate(()=>{
 const s=__scene;__game.loop.sleep();window.__chooseMode?.('hard');document.querySelectorAll('.game-modal,[id$="-modal"],#story,#howto').forEach(e=>e.style.display='none');s._syncModalGate?.();s.scene.pause();s._gpsSimulated=true;s._homeCapturePending=false;s._homeCaptureArmed=false;s._tickHomeZoom=()=>{};s._setRestZoom(1,1);s.ensureStarterTrailerObject=()=>{};s.ensureStarterShopId=()=>{};s._boot_still=false;s._activeCreatures=[];s.save.creatures=[];s._streetLamps=[];
 const p=s.playerToWorldCell(),e=WorldGen.tileCache.get(WorldGen.tileKey(p.tx,p.ty));
 for(const t of WorldGen.tileCache.values()){t.objects=[];t.wildplants=[];t.traps=[];t.creatures=[];t.reefCorals=[];t._chunkIdx={};}
 const anchor=playerWorldM(s),cell=worldMetersToAbsCell(s,anchor.x,anchor.y),centre=absCellCenterMeters(s,cell.cellIX,cell.cellIY);
 window.__grassCentre=centre;window.__grassEntry=e;s.save.planted=[];s.save.picked=[];
 for(let y=-3;y<=3;y++)for(let x=-3;x<=3;x++)e.wildplants.push({kind:'wildplant',crop:'longgrass',id:`grass_fixture_${x}_${y}`,x:centre.x+x*s.cellM,y:centre.y+y*s.cellM});
 e.objects=[{kind:'chest',id:'grass_fixture_chest',x:centre.x+s.cellM,y:centre.y,crate:true}];e._chunkIdx={};s._applyMapZoom();s.drawObjects();
 const ground=s.add.graphics().setDepth(-1);ground.fillStyle(0x555c38).fillRect(s.viewLeft,s.viewTop,s.viewSize,s.viewSize);
 window.__grassIsolate=()=>{
  BuildingLowPoly.clear(s);for(const source of Object.keys(s._wallPerspective||{}))if(!['grass','looseProps'].includes(source))WallPerspective.clear(s,source);
  const allowed=new Set([ground,s.player,s._wallPerspective.grass.gfx,...s._wallPerspective.grass.parts,...s.objectPool.filter(p=>p._staticObject?.id?.startsWith('grass_fixture_')),...(s._wallPerspective.looseProps?.parts||[])]);
  const keep=c=>{if(c.list){let visible=false;for(const child of c.list)visible=keep(child)||visible;c.setVisible(visible);return visible;}const visible=allowed.has(c)&&c.visible;c.setVisible(visible);return visible;};
  for(const c of s.children.list)keep(c);ground.setVisible(true);s.player.setVisible(true);
 };
 __grassIsolate();
 });
 for(const angle of [0,Math.PI/4,Math.PI/2]){
 const data=await page.evaluate(a=>{const s=__scene;s.mapRot=a;s._huManualAngle=a;s.drawObjects();WallPerspective.update(s);const g=s._wallPerspective.grass;return {blocks:g?.blocks.length,triangles:g?.blocks.reduce((n,b)=>n+(b.materialFaces?.length||0),0),covered:s._playerSubmerged,gl:__game.renderer.gl?.getError()};},angle);
 assert.equal(data.blocks,49*4);assert.equal(data.triangles,49*16);assert.equal(data.covered,true);assert.equal(data.gl,0);
 await page.evaluate(()=>__grassIsolate());
 const shot=await page.evaluate(()=>new Promise(resolve=>{__game.loop.wake();setTimeout(()=>__game.renderer.snapshotArea(__scene.viewLeft,__scene.viewTop,__scene.viewSize,__scene.viewSize,img=>{__game.loop.sleep();resolve(img.src)}),180)}));
 fs.writeFileSync(`${out}/grass-${Math.round(angle*180/Math.PI)}.png`,Buffer.from(shot.split(',')[1],'base64'));console.log(data);
 }
 const cleared=await page.evaluate(()=>{
 const s=__scene;s.mapRot=0;s._huManualAngle=0;
 __grassEntry.wildplants=__grassEntry.wildplants.filter(p=>p.id!=='grass_fixture_1_0');__grassEntry._chunkIdx={};s._boot_still=false;s.drawObjects();WallPerspective.update(s);__grassIsolate();
 return {blocks:s._wallPerspective.grass.blocks.length,chest:s._wallPerspective.looseProps?.blocks.length||s.objectPool.filter(p=>p.visible&&p._staticObject?.id==='grass_fixture_chest').length};
 });
 assert.equal(cleared.blocks,48*4);assert.ok(cleared.chest>0,'chest remains a rendered object after clearing');
 const shot=await page.evaluate(()=>new Promise(resolve=>{__game.loop.wake();setTimeout(()=>__game.renderer.snapshotArea(__scene.viewLeft,__scene.viewTop,__scene.viewSize,__scene.viewSize,img=>{__game.loop.sleep();resolve(img.src)}),180)}));
 fs.writeFileSync(out+'/cleared.png',Buffer.from(shot.split(',')[1],'base64'));console.log('CLEARED',cleared);
 const patch=await page.evaluate(()=>{
 const s=__scene,mask=WorldGen.runSteps(WorldGen.grassFillSteps(10,5,96));
 let found=null;
 for(let y=4;y<92&&!found;y++)for(let x=4;x<92&&!found;x++){
  let count=0;for(let dy=-3;dy<=3;dy++)for(let dx=-3;dx<=3;dx++)count+=!!mask[(y+dy)*96+x+dx];
  if(count>=20&&count<=29)found={x,y,count};
 }
 if(!found)throw Error('no representative gappy patch');
 __grassEntry.wildplants=[];
 for(let y=-3;y<=3;y++)for(let x=-3;x<=3;x++)if(mask[(found.y+y)*96+found.x+x])__grassEntry.wildplants.push({kind:'wildplant',crop:'longgrass',id:`grass_patch_${x}_${y}`,x:__grassCentre.x+x*s.cellM,y:__grassCentre.y+y*s.cellM});
 __grassEntry._chunkIdx={};s._boot_still=false;s.drawObjects();WallPerspective.update(s);__grassIsolate();return found;
 });
 const patchShot=await page.evaluate(()=>new Promise(resolve=>{__game.loop.wake();setTimeout(()=>__game.renderer.snapshotArea(__scene.viewLeft,__scene.viewTop,__scene.viewSize,__scene.viewSize,img=>{__game.loop.sleep();resolve(img.src)}),180)}));
 fs.writeFileSync(out+'/clustered.png',Buffer.from(patchShot.split(',')[1],'base64'));console.log('CLUSTERED',patch);
 fs.writeFileSync(out+'/errors.json',JSON.stringify(errors));assert.deepEqual(errors,[]);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
