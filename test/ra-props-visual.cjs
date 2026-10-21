// Staged fixture inspection inside the actual loaded game renderer. Isolated save.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright-core');
const out=process.env.OUT_DIR||'/tmp/ra-fixtures-in-game';fs.mkdirSync(out,{recursive:true});
(async()=>{
console.log('LAUNCH');const env={...process.env};delete env.DISPLAY;
const browser=await chromium.launch({env,executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--ozone-platform=headless','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
console.log('BROWSER READY');const context=await browser.newContext({viewport:{width:900,height:1150},serviceWorkers:'block'}),page=await context.newPage(),errors=[];
page.on('pageerror',e=>errors.push(String(e)));
await page.addInitScript(()=>{window.__renderScaleCap=1;window.__DAYLIGHT=1;sessionStorage.setItem('terracart.safetySeen','1');localStorage.setItem('terracart.introSeen','1');localStorage.setItem('terracart.howtoSeen','1');});
await page.goto('http://localhost:8000/index.html?sandbox=true&artTrial=rogue&deepforest=on',{waitUntil:'domcontentloaded'});
console.log('PAGE READY');await page.waitForFunction(()=>window.__scene?._bootStatusDone,null,{timeout:120000});
await page.waitForFunction(()=>window.__scene?._bootOverlayGone,null,{timeout:120000});
console.log('BOOT READY');
await page.evaluate(()=>{
 const s=__scene;__game.loop.sleep();window.__chooseMode?.('hard');document.querySelectorAll('.game-modal,[id$="-modal"],#story,#howto').forEach(e=>e.style.display='none');s._syncModalGate?.();s.scene.pause();s._gpsSimulated=true;s._homeCapturePending=false;s._homeCaptureArmed=false;s._tickHomeZoom=()=>{};s._setRestZoom(1,1);s.ensureStarterTrailerObject=()=>{};s.ensureStarterShopId=()=>{};s._boot_still=false;s._activeCreatures=[];s.save.creatures=[];s._streetLamps=[];
 const p=s.playerToWorldCell(),e=WorldGen.tileCache.get(WorldGen.tileKey(p.tx,p.ty));window.__fixtureEntry=e;
 for(const entry of WorldGen.tileCache.values()){entry.objects=[];entry.wildplants=[];entry.traps=[];entry.creatures=[];entry.reefCorals=[];entry._chunkIdx={};}
 window.__fixtureCentre=viewAnchorWorldM(s);
 window.__fixtureGround=s.add.tileSprite(s.viewCenterX,s.viewCenterY,900,900,'ra_terrain_source',15).setTileScale(2).setDepth(-1);
 window.__fixtureKinds=Object.entries(Shrines.SHRINE_KINDS).filter(([k,v])=>Number.isInteger(v.frame)).sort((a,b)=>a[1].frame-b[1].frame).filter((row,i,all)=>all.findIndex(x=>x[1].frame===row[1].frame)===i);
 window.__fixtureBase=[{kind:'staircase',dir:'down',label:'Down'}, {kind:'staircase',dir:'up',label:'Up'}, {kind:'staircase',dir:'up',elevator:true,label:'Elevator'}, {kind:'grove_shrine',label:'Votive'}, {kind:'headstone',label:'Grave'}, {kind:'well',label:'Well'}, {kind:'gatepost',label:'Gatepost'}, {kind:'wildplant',crop:'barricade',label:'Barricade'}, {kind:'vista_scope',label:'Scope'}, {kind:'waystone',label:'Waystone'}, {kind:'_streetlamp',lit:false,label:'Unlit lamp'}, {kind:'_streetlamp',lit:true,label:'Lit lamp'}];
 window.__fixtureStage=(group,depth,repaired,angle)=>{
   s.depth=depth;s.save.elevators={repaired};s.mapRot=angle;s._huManualAngle=angle;
   const list=(group.startsWith('shrines')?__fixtureKinds.map(([shrineKind,v])=>({kind:'grove_shrine',shrineKind,label:shrineKind})):__fixtureBase).slice(group.endsWith('b')?6:0,group.endsWith('b')?12:6);
   s.save.planted=[];
   const rows=Math.ceil(list.length/3);
   const staged=list.map((o,i)=>({...o,id:'starter_fixture_'+i,x:__fixtureCentre.x+(i%3-1)*s.cellM*2,y:__fixtureCentre.y+(Math.floor(i/3)-(rows-1)/2)*s.cellM*2.25}));
   __fixtureEntry.objects=staged.filter(o=>o.kind!=='wildplant');__fixtureEntry.wildplants=staged.filter(o=>o.kind==='wildplant');__fixtureEntry._chunkIdx={};window.__fixtures=staged;
   s._applyMapZoom();s.drawObjects();
   const allowed=new Set([...s.objectPool.filter(sprite=>sprite._staticObject?.id?.startsWith('starter_fixture_')),...s.plantedPool,__fixtureGround]);
   const filter=child=>{if(child.list){let any=false;for(const nested of child.list)any=filter(nested)||any;child.setVisible(any);return any;}const keep=allowed.has(child)&&child.visible;child.setVisible(keep);return keep;};
   for(const child of s.children.list)filter(child);__fixtureGround.setVisible(true);
   const labels=staged.map(o=>{const p=s.worldMetersToScreen(o.x,o.y);return s.add.text(p.x,p.y+27,o.label,{fontSize:'8px',color:'#ffffff',backgroundColor:'#25251d'}).setOrigin(.5).setDepth(100);});
   const pass=Render.objectAppearance(s,new WeakMap());
   return staged.map(o=>{const a=o.kind==='wildplant'?{texKey:'barricade',frameVal:0,scl:4/3}:pass.resolveAppearance(o);return {id:o.id,label:o.label,kind:o.kind,dir:o.dir,elevator:o.elevator,shrineKind:o.shrineKind,x:o.x,y:o.y,key:a?.texKey,frame:a?.frameVal,scale:a?.scl,origin:a?.origin,dx:a?.dxPx,dy:a?.dyPx,foot:a?.foot,layer:a?.layer,bounds:SpriteLayout.ART_BOUNDS[a?.texKey+':'+(a?.frameVal??0)]};});
 };
});
for(const [group,depth,repaired,angle] of [['fixtures-a',0,false,0],['fixtures-a',0,true,0],['fixtures-b',0,false,0],['shrines-a',0,false,0],['shrines-b',0,false,0],['fixtures-a',0,true,Math.PI/4],['shrines-a',0,false,Math.PI/4],['fixtures-a',1,false,0],['fixtures-a',1,true,0]]){
 const name=`${group}-depth${depth}-${repaired?'repaired':'broken'}-${angle?'45':'north'}`;
 const data=await page.evaluate(args=>__fixtureStage(...args),[group,depth,repaired,angle]);
 await page.waitForTimeout(700);
 const shot=await page.evaluate(()=>new Promise(resolve=>{__game.loop.wake();setTimeout(()=>__game.renderer.snapshotArea(0,0,__game.scale.width,__game.scale.height,img=>{__game.loop.sleep();resolve(img.src)}),150)}));
 const metadata=await page.evaluate(()=>({renderer:__game.renderer.type,glError:__game.renderer.gl?.getError()??null,mapRotation:__scene.mapRot,cameraRotation:__scene.cameras.main.rotation,headingUp:__scene._headingUp,sprites:[...__scene.objectPool,...__scene.plantedPool].filter(s=>s.visible).map(s=>({key:s.texture.key,frame:s.frame.name,scale:[s.scaleX,s.scaleY],rotation:s.rotation,x:s.x,y:s.y,alpha:s.alpha})),canvas:[__game.scale.width,__game.scale.height]}));
 fs.writeFileSync(path.join(out,name+'.png'),Buffer.from(shot.split(',')[1],'base64'));fs.writeFileSync(path.join(out,name+'.json'),JSON.stringify({staged:true,group,depth,repaired,angle,objects:data,...metadata},null,2));
 assert(metadata.glError===0||metadata.glError===null);for(const a of data)assert(a.key&&a.bounds,`Missing art/bounds ${a.label}`);
 console.log('CAPTURE',name,data.length,'resolved',metadata.sprites.length,'sprites');
}
fs.writeFileSync(path.join(out,'errors.json'),JSON.stringify(errors,null,2));assert.deepEqual(errors,[]);await context.close();
}finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
