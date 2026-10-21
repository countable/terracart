const assert=require('node:assert/strict'),fs=require('fs');
const {chromium}=require('playwright-core');
(async()=>{
 const env={...process.env};delete env.DISPLAY;
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,env,args:['--no-sandbox','--ozone-platform=headless','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const reports=[];fs.mkdirSync('/tmp/ra-live',{recursive:true});
 try {
  for(const theme of ['village','jungle']){
   const context=await browser.newContext({viewport:{width:1100,height:1000},serviceWorkers:'block'});
   const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));
   await page.goto('http://localhost:8017/?sandbox=true&headingUp=false&raPreview='+theme);
   await page.waitForFunction(()=>window.__raPreview?.ready,null,{timeout:120000});
   await page.waitForTimeout(1200);
   const before=await page.evaluate(()=>({player:{...__scene.playerM},active:__scene.scene.isActive(),visible:__scene.player.visible,time:__scene.time.now,tiles:__scene.noisePool.filter(n=>n.visible).map(n=>({cell:n.__raCell,key:n.texture.key,frame:n.frame.name}))}));
   assert(before.active,'scene not running');assert(before.visible,'player hidden');
   await page.keyboard.down('ArrowLeft');await page.waitForTimeout(2000);await page.keyboard.up('ArrowLeft');
   const after=await page.evaluate(()=>({player:{...__scene.playerM},time:__scene.time.now,tiles:__scene.noisePool.filter(n=>n.visible).map(n=>({cell:n.__raCell,key:n.texture.key,frame:n.frame.name})),gl:__game.renderer.gl.getError()}));
   assert(Math.hypot(before.player.x-after.player.x,before.player.y-after.player.y)>.1,'keyboard movement did not move player');assert(after.time>before.time,'game clock not progressing');assert.equal(after.gl,0);
   const prior=new Map(before.tiles.filter(n=>n.cell).map(n=>[n.cell.x+','+n.cell.y,n]));let checked=0;
   for(const tile of after.tiles){if(!tile.cell)continue;const old=prior.get(tile.cell.x+','+tile.cell.y);if(!old)continue;assert.equal(tile.key,old.key,'tile texture changed on movement');assert.equal(tile.frame,old.frame,'tile mask changed on movement');checked++;}assert(checked>25,'too few stable cells');
   let descentRoundTrip=null;
   if(theme==='village') {
    const takeStair=async dir=>page.evaluate(dir=>{
     const s=__scene,stair=[...WorldGen.tileCache.values()].flatMap(e=>e.objects||[]).find(o=>o.kind==='staircase'&&o.dir===dir);
     if(!stair)throw Error('Missing '+dir+' staircase');
     s.playerM={x:stair.x-s.startWorldM.x,y:stair.y-s.startWorldM.y-s.feetOffsetM};s.gpsM={...s.playerM};s.syncMoveTarget();
     return TAP_HANDLERS.find(h=>h.name==='staircase').try({scene:s,save:s.save,wm:{x:stair.x,y:stair.y},sx:0,sy:0});
    },dir);
    assert.equal(await takeStair('down'),true);
    await page.waitForFunction(()=>__scene.depth===1&&[...WorldGen.tileCache.values()].some(e=>e.objects?.some(o=>o.kind==='staircase'&&o.dir==='up')),null,{timeout:30000});
    assert.equal(await takeStair('up'),true);
    await page.waitForFunction(()=>__scene.depth===0&&[...WorldGen.tileCache.values()].some(e=>e.objects?.some(o=>o.id==='village-staircase-6')),null,{timeout:30000});
    descentRoundTrip=true;
   }
   await page.screenshot({path:'/tmp/ra-live/'+theme+'.png'});
   reports.push({theme,active:before.active,playerVisible:before.visible,movementMeters:Math.hypot(before.player.x-after.player.x,before.player.y-after.player.y),stableTiles:checked,descentRoundTrip,errors});
   assert.deepEqual(errors,[]);await context.close();
  }
  fs.writeFileSync('/tmp/ra-live/audit.json',JSON.stringify(reports,null,2));console.log(JSON.stringify(reports));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
