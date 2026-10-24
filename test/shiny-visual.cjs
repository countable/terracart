// Phaser pre-FX comparison using current Rogue source art and Render.setShine.
// The comparison changes only effects; both columns use the active art assets.
// OUT_DIR chooses screenshot output; standalone HTTP fixture never alters player saves.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const root = path.resolve(__dirname, '..'), out = process.env.OUT_DIR || '/tmp/shiny-review';
fs.mkdirSync(out, { recursive: true });
const mime = { '.js':'text/javascript', '.png':'image/png', '.html':'text/html', '.webp':'image/webp' };
const server = http.createServer((req,res) => {
  if (req.url === '/review.html') { res.setHeader('Content-Type', 'text/html'); res.end('<html></html>'); return; }
  const filename = path.resolve(root, '.' + decodeURIComponent(req.url.split('?')[0]));
  if (!filename.startsWith(root + '/')) { res.writeHead(403); res.end(); return; }
  fs.readFile(filename,(error,data) => { if(error){res.writeHead(404);res.end();return;} res.setHeader('Content-Type',mime[path.extname(filename)]||'application/octet-stream');res.end(data); });
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 const env={...process.env};delete env.DISPLAY;
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,env,args:['--no-sandbox','--ozone-platform=headless','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try {
  const source=fs.readFileSync(path.join(root,'src/render.js'),'utf8');
  const start=source.indexOf('const SHINE_SPEED ='),end=source.indexOf('// ── SPACE BENDS',start);
  assert(start>0&&end>start,'shipping shine block found');
  const shipping='const Render = window.Render = {}; const SHINY_TINT = 0xffd23a;\n'+source.slice(start,end);
  const results=[];
  for(const canvas of [false,true]){
   const page=await browser.newPage({viewport:{width:1080,height:850},serviceWorkers:'block'}),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
  page.on('response',response=>{if(response.status()>=400&&response.url().startsWith(base+'/assets/'))errors.push(`asset HTTP ${response.status()}: ${response.url()}`);});
  page.on('requestfailed',request=>{if(request.url().startsWith(base+'/assets/'))errors.push(`asset request failed: ${request.url()} ${request.failure()?.errorText}`);});
   await page.goto(base+'/review.html');
   await page.setContent('<html><head><style>body{margin:0;background:#181b1e}canvas{display:block}</style></head><body></body></html>');
   await page.addScriptTag({url:base+'/vendor/phaser.js'});
   await page.addScriptTag({content:shipping});
   await page.evaluate(({base,canvas})=>{
    const entries=[['Rock','rock','assets/ArtTrials/RogueObjects/stone.png',16,16],['Shrub','shrub','assets/ArtTrials/RogueObjects/bushes-olive.png',24,24],['Tree','tree','assets/ArtTrials/RogueObjects/tree-wide-a.png',64,80],['Chicken','chicken','assets/Farm Animals/Chicken Red.png',16,16]];
    class Review extends Phaser.Scene {
     preload(){for(const [label,key,url,frameWidth,frameHeight] of entries)this.load.spritesheet(key,base+'/'+url,{frameWidth,frameHeight});}
     create(){
      window.reviewScene=this;window.samples=[];
      Render.guardPreFxScissor();
      this.add.text(24,18,'SHINY OBJECT REVIEW',{fontFamily:'sans-serif',fontSize:'23px',fontStyle:'bold',color:'#f1e9d6'});
      this.add.text(24,50,canvas?'Canvas shader check only: no pre-FX. Map sparkle/light fallback is not shown here.':'WebGL: current Rogue source art, with original and current shiny effects side by side.',{fontFamily:'sans-serif',fontSize:'14px',color:'#b9c1c5'});
      for(let panel=0;panel<2;panel++){
       const x0=panel*540;this.add.rectangle(x0+270,420,532,680,panel?0x17252b:0x899568);
       this.add.text(x0+18,94,panel?'DARK GROUND':'DAYLIGHT GROUND',{fontFamily:'sans-serif',fontSize:'14px',fontStyle:'bold',color:panel?'#d8e1e3':'#172516'});
       ['Ordinary','Old shiny','Revised shiny'].forEach((name,col)=>this.add.text(x0+88+col*174,128,name,{fontFamily:'sans-serif',fontSize:'14px',color:panel?'#edf1e3':'#18200e'}).setOrigin(.5));
       entries.forEach(([label,key],row)=>{
        const y=220+row*155;
        this.add.text(x0+12,y+53,label,{fontFamily:'sans-serif',fontSize:'12px',color:panel?'#aebcbd':'#28311e'});
        for(let col=0;col<3;col++){
         const s=this.add.sprite(x0+88+col*174,y,key,0).setScale(key==='tree'?1.25:2);
         if(col===1){if(key==='chicken')s.setTint(0xffd23a);if(!canvas){s.preFX.setPadding(12);s.preFX.addGlow(0xffd23a,4,.5,false);s.preFX.addShine(.35,.35,3,false);}}
         if(col===2)Render.setShine(s,true,key);
         window.samples.push({sprite:s,col,key,panel});
        }
       });
      }
      this.add.text(24,800,'Fixed source frames. Same art, scale, ground and moment across each row.',{fontFamily:'sans-serif',fontSize:'14px',color:'#b9c1c5'});
      window.ready=true;
     }
    }
    window.reviewGame=new Phaser.Game({type:canvas?Phaser.CANVAS:Phaser.WEBGL,width:1080,height:850,pixelArt:true,antialias:false,backgroundColor:'#181b1e',render:{preserveDrawingBuffer:true},scene:Review});
   },{base,canvas});
   await page.waitForFunction(()=>window.ready,null,{timeout:30000});
   for(const [phase,delay] of [['start',450],['sweep',1100],['late',1600],['return',1700]]){await page.waitForTimeout(delay);await page.screenshot({path:path.join(out,`${canvas?'canvas':'webgl'}-${phase}.png`)});}
   const result=await page.evaluate(()=>{
    const revised=samples.filter(x=>x.col===2),s=revised[0].sprite;
    const hadGlow=!!s._shinyGlowFx;Render.setShine(s,false,'plain');
    const cleaned=!s._shineFx&&!s._shinyGlowFx;
    return {renderer:reviewGame.renderer.type,webgl:Phaser.WEBGL,canShine:Render.canShine(reviewScene),hadGlow,cleaned,glError:reviewGame.renderer.gl?.getError()??null,current:revised.map(x=>({key:x.key,tint:x.sprite.tintTopLeft,inner:x.sprite._shinyGlowFx?.innerStrength,outer:x.sprite._shinyGlowFx?.outerStrength,padding:x.sprite.preFX?.padding}))};
   });
   assert.equal(result.cleaned,true);assert(result.glError===null||result.glError===0);assert.deepEqual(errors,[]);
   if(!canvas){assert.equal(result.canShine,true);assert.equal(result.hadGlow,true);}
   results.push({...result,errors});await page.close();
  }
  if(process.env.LIVE_REVIEW==='1'){
   const page=await browser.newPage({viewport:{width:900,height:1150},serviceWorkers:'block'}),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
  page.on('response',response=>{if(response.status()>=400&&response.url().startsWith(base+'/assets/'))errors.push(`asset HTTP ${response.status()}: ${response.url()}`);});
  page.on('requestfailed',request=>{if(request.url().startsWith(base+'/assets/'))errors.push(`asset request failed: ${request.url()} ${request.failure()?.errorText}`);});
   await page.addInitScript(()=>{window.__renderScaleCap=1;window.__DAYLIGHT=1;sessionStorage.setItem('terracart.safetySeen','1');localStorage.setItem('terracart.introSeen','1');localStorage.setItem('terracart.howtoSeen','1');localStorage.setItem('terracart.graphicsFX','1');});
   await page.goto(base+'/index.html?sandbox=true&deepforest=on',{waitUntil:'domcontentloaded'});
   console.log('LIVE PAGE');
   await page.waitForFunction(()=>window.__scene?._bootStatusDone,null,{timeout:120000});
   await page.waitForFunction(()=>window.__scene?._bootOverlayGone,null,{timeout:120000});
   console.log('LIVE READY');
   await page.evaluate(()=>{
    const s=__scene;__game.loop.sleep();window.__chooseMode?.('hard');document.querySelectorAll('.game-modal,[id$="-modal"],#story,#howto').forEach(e=>e.style.display='none');s._syncModalGate?.();s.scene.pause();s._gpsSimulated=true;s._homeCapturePending=false;s._homeCaptureArmed=false;s._tickHomeZoom=()=>{};s._setRestZoom(1,1);s.ensureStarterTrailerObject=()=>{};s.ensureStarterShopId=()=>{};s._boot_still=false;
    const p=s.playerToWorldCell(),e=WorldGen.tileCache.get(WorldGen.tileKey(p.tx,p.ty)),centre=viewAnchorWorldM(s);
    for(const entry of WorldGen.tileCache.values()){entry.objects=[];entry.wildplants=[];entry.traps=[];entry.creatures=[];entry.reefCorals=[];entry._chunkIdx={};}
    const shinyId=(prefix,rate)=>{for(let i=0;i<100000;i++){const id=prefix+i;if(isShiny(id,rate))return id;}throw Error('No shiny fixture id');};
    const at=(dx,dy)=>({x:centre.x+dx*s.cellM,y:centre.y+dy*s.cellM});
    e.objects=[{id:shinyId('review_tree_',SHINY_RATE.tree),kind:'tree',stage:3,...at(-2,-1)}];
    e.wildplants=[{id:'fixture-shrub',wildId:shinyId('review_shrub_',SHINY_RATE.flora),kind:'wildplant',crop:'shrub',...at(0,-1)}, {id:'fixture-rubble',wildId:shinyId('review_rubble_',SHINY_RATE.flora),kind:'wildplant',crop:'rubble',...at(2,-1)}];
    s._activeCreatures=[{id:'review_chicken',kind:'chicken',shiny:true,depth:0,hp:10,...at(-1,1)},{id:'review_rabbit',kind:'rabbit',shiny:true,depth:0,hp:10,...at(1,1)}];
    s.save.creatures=s._activeCreatures;s.save.planted=[];
    window.reviewDraw=()=>{s._applyMapZoom();s.drawCells();s.drawRoadGeometry();s.drawBuildingGeometry();s.drawObjects();};
    reviewDraw();
   });
   for(const [name,angle] of [['north',0],['heading45',Math.PI/4]]){
    await page.evaluate(angle=>{const s=__scene;s.mapRot=angle;s._huManualAngle=angle;reviewDraw();__game.loop.wake();},angle);
    await page.waitForTimeout(800);
    await page.evaluate(()=>{reviewDraw();});
    await page.screenshot({path:path.join(out,'live-'+name+'.png')});
   }
   const state=await page.evaluate(()=>({renderer:__game.renderer.type,canShine:Render.canShine(__scene),glError:__game.renderer.gl?.getError(),mapRotation:__scene.mapRot,shinySprites:[...__scene.objectPool,...__scene.plantedPool,...__scene.creaturePool].filter(s=>s.visible&&s._shineFx).map(s=>({key:s.texture.key,frame:s.frame.name,tint:s.tintTopLeft}))}));
   fs.writeFileSync(path.join(out,'live-results.json'),JSON.stringify({...state,errors},null,2));
   assert(state.canShine);assert(state.shinySprites.length>=3);assert.equal(state.glError,0);assert.deepEqual(errors,[]);await page.close();
  }
  fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(results,null,2));
  console.log(JSON.stringify({out,renderers:results.map(r=>r.renderer),poolCleanup:results.every(r=>r.cleaned),errors:results.flatMap(r=>r.errors)}));
 } finally {await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
