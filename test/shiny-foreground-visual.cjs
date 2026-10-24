// Regression for gold flooding a foreground tree while player occlusion fades it.
// Uses current Rogue tree art, shipping Render.setShine and fadeObjectOverPlayer.
// OUT_DIR chooses screenshot output; standalone HTTP fixture never alters player saves.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const root = path.resolve(__dirname, '..'), out = process.env.OUT_DIR || '/tmp/shiny-foreground';
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
  const fadeStart=source.indexOf('Render.fadeObjectOverPlayer =');
  const fadeEnd=source.indexOf('\n};',fadeStart)+3;
  const fadeSource=source.slice(fadeStart,fadeEnd);
  const results=[];
  const page=await browser.newPage({viewport:{width:1100,height:620},serviceWorkers:'block'}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('response',response=>{if(response.status()>=400&&response.url().startsWith(base+'/assets/'))errors.push(`asset HTTP ${response.status()}: ${response.url()}`);});
  page.on('requestfailed',request=>{if(request.url().startsWith(base+'/assets/'))errors.push(`asset request failed: ${request.url()} ${request.failure()?.errorText}`);});
  await page.goto(base+'/review.html');
  await page.setContent('<html><head><style>body{margin:0;background:#181b1e}canvas{display:block}</style></head><body></body></html>');
  await page.addScriptTag({url:base+'/vendor/phaser.js'});
  await page.addScriptTag({content:shipping+'\nconst WorldLayers={GROUND_DECAL:-1}; const SpriteLayout={ART_BOUNDS:{}}; const isBuilding=()=>false;\n'+fadeSource});
  await page.evaluate(({base})=>{
   class Review extends Phaser.Scene {
    preload(){this.load.image('rogue_tree_wide_a',base+'/assets/ArtTrials/RogueObjects/tree-wide-a.png');}
    create(){
     window.reviewScene=this;window.samples=[];Render.guardPreFxScissor();
     this.add.text(24,18,'FOREGROUND SHINY TREE: OCCLUSION REGRESSION',{fontFamily:'sans-serif',fontSize:'21px',fontStyle:'bold',color:'#f1e9d6'});
     this.add.text(24,52,'Current Rogue tree art. Shipping fadeObjectOverPlayer and shine effects; old bug forced only in middle column.',{fontFamily:'sans-serif',fontSize:'13px',color:'#b9c1c5'});
     for(let panel=0;panel<2;panel++){
      const x0=panel*550;this.add.rectangle(x0+275,320,542,460,panel?0x17252b:0x899568);
      ['Opaque shiny','Foreground: old bug','Foreground: fixed'].forEach((text,col)=>this.add.text(x0+92+col*182,120,text,{fontFamily:'sans-serif',fontSize:'13px',color:panel?'#edf1e3':'#18200e'}).setOrigin(.5));
      for(let col=0;col<3;col++){
       const x=x0+92+col*182,y=400;
       this.add.rectangle(x,y-55,14,32,0x3388cc).setDepth(0);
       const s=this.add.sprite(x,y,'rogue_tree_wide_a').setOrigin(.5,1).setScale(2).setDepth(1);
       const appearance={texKey:s.texture.key,frameVal:'__BASE',spec:{},layer:1};
       Render.setShine(s,true,'tree-'+col);
       Render.fadeObjectOverPlayer(s,appearance,col===0?null:{x0:x-7,x1:x+7,y0:y-72,y1:y-40},0,1);
       if(col===1)s._shinyGlowFx.active=true;
       this.add.text(x,y+35,'alpha '+s.alpha+' / glow '+s._shinyGlowFx.active,{fontFamily:'sans-serif',fontSize:'12px',color:panel?'#b9c1c5':'#18200e'}).setOrigin(.5);
       samples.push({sprite:s,col,panel,appearance});
      }
     }
     this.add.text(24,576,'Blue marker behind each tree represents the player. The fixed foreground keeps transparency and the moving glint.',{fontFamily:'sans-serif',fontSize:'13px',color:'#b9c1c5'});
     window.ready=true;
    }
   }
   window.reviewGame=new Phaser.Game({type:Phaser.WEBGL,width:1100,height:620,pixelArt:true,antialias:false,backgroundColor:'#181b1e',render:{preserveDrawingBuffer:true},scene:Review});
  },{base});
  await page.waitForFunction(()=>window.ready,null,{timeout:30000});
  for(const [phase,delay] of [['start',450],['sweep',1100],['late',1600],['return',2900]]){await page.waitForTimeout(delay);await page.screenshot({path:path.join(out,'foreground-'+phase+'.png')});}
  const result=await page.evaluate(()=>{
   const states=samples.map(({sprite:s,col,panel})=>({col,panel,alpha:s.alpha,glow:s._shinyGlowFx.active,shine:s._shineFx.active}));
   const fixed=samples.find(x=>x.col===2),s=fixed.sprite;
   Render.fadeObjectOverPlayer(s,fixed.appearance,null,0,1);
   const restored={alpha:s.alpha,glow:s._shinyGlowFx.active};
   return {states,restored,glError:reviewGame.renderer.gl.getError()};
  });
  assert.equal(result.glError,0);assert.deepEqual(errors,[]);
  for(const state of result.states){assert.equal(state.alpha,state.col===0?1:.5);assert.equal(state.glow,state.col!==2);assert.equal(state.shine,true);}
  assert.deepEqual(result.restored,{alpha:1,glow:true});
  results.push({...result,errors});await page.close();
  fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(results,null,2));
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
    e.objects=[{id:shinyId('review_tree_',SHINY_RATE.tree),kind:'tree',stage:3,...at(0,.35)}];
    e.wildplants=[{id:'fixture-shrub',wildId:shinyId('review_shrub_',SHINY_RATE.flora),kind:'wildplant',crop:'nettle',...at(0,-1)}, {id:'fixture-rubble',wildId:shinyId('review_rubble_',SHINY_RATE.flora),kind:'wildplant',crop:'rubble',...at(2,-1)}];
    s._activeCreatures=[{id:'review_chicken',kind:'chicken',shiny:true,depth:0,hp:10,...at(-1,1)},{id:'review_rabbit',kind:'rabbit',shiny:true,depth:0,hp:10,...at(1,1)}];
    s.save.creatures=s._activeCreatures;s.save.planted=[];
    window.reviewDraw=()=>{s._applyMapZoom();s.drawCells();s.drawRoadGeometry();s.drawBuildingGeometry();s.drawObjects();};
    reviewDraw();
   });
   for(const [name,angle] of [['north-fixed',0],['north-bug',0],['heading45-fixed',Math.PI/4]]){
    await page.evaluate(angle=>{const s=__scene;s.mapRot=angle;s._huManualAngle=angle;reviewDraw();__game.loop.wake();},angle);
    await page.waitForTimeout(800);
    await page.evaluate(name=>{reviewDraw();if(name==='north-bug')for(const s of __scene.objectPool)if(s.visible&&s._shinyGlowFx)s._shinyGlowFx.active=true;},name);
    await page.waitForTimeout(100);
    await page.screenshot({path:path.join(out,'live-'+name+'.png')});
   }
   const state=await page.evaluate(()=>({renderer:__game.renderer.type,canShine:Render.canShine(__scene),glError:__game.renderer.gl?.getError(),mapRotation:__scene.mapRot,shinySprites:[...__scene.objectPool,...__scene.plantedPool,...__scene.creaturePool].filter(s=>s.visible&&s._shineFx).map(s=>({key:s.texture.key,frame:s.frame.name,tint:s.tintTopLeft,alpha:s.alpha,glow:s._shinyGlowFx?.active}))}));
   fs.writeFileSync(path.join(out,'live-results.json'),JSON.stringify({...state,errors},null,2));
   assert(state.canShine);assert(state.shinySprites.length>=3);
   const foreground=state.shinySprites.find(s=>s.key.startsWith('rogue_tree_'));
   assert(foreground,'active Rogue profile resolves the ordinary tree');
   assert.equal(foreground.alpha,.5);assert.equal(foreground.glow,false);assert.equal(foreground.tint,0xffffff);
   assert.equal(state.glError,0);assert.deepEqual(errors,[]);await page.close();
  }
  fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(results,null,2));
  console.log(JSON.stringify({out,results}));
 } finally {await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
