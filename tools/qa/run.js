#!/usr/bin/env node
'use strict';
// Persistent local browser session. POST JSON commands to the printed /command URL.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const os = require('node:os');
const crypto = require('node:crypto');
const { chromium } = require('playwright-core');
const ROOT = path.resolve(__dirname, '../..');
const OUT = path.resolve(process.argv[2] || path.join(os.homedir(),'.artifacts','gameplay-qa',new Date().toISOString().replace(/[:.]/g,'-')));
const PORT = Number(process.env.QA_PORT || 7732);
const RUN = { started: new Date().toISOString(), viewport: {width:390,height:844}, seed: 73129,
  location: {latitude:49.85438,longitude:-119.47870}, simulationBudgetMs:7200000,
  limitations: ['Single Easy-mode fixture location; no multiplayer or live GPS coverage.', 'Frozen simulation during agent reasoning; explicit reading/decision allowances are logged.', 'Movement, crop-stage and work timing have a separate parity verifier; combat/economy parity is not established.', 'Service workers are blocked; cache/offline behavior is not covered. Fixture misses are logged and fail their requests.', 'Boot and opening menus run in real time before start. Asset/network completion can proceed while simulation is paused.', 'Seeded randomness does not guarantee exact replay: wall-clock origin, native loading and frame ordering may differ.', 'Modal screenshots wait for bounded image decoding and 500ms of native CSS settling without advancing the installed simulation clock.'],
  screenshots:[], errors:[], fixtureMisses:[], actions:0 };
function setupRun() {
  if (['run.json', 'actions.jsonl'].some(file => fs.existsSync(path.join(OUT, file))))
    throw Error('Output directory already contains a QA run; choose a new directory.');
fs.mkdirSync(OUT,{recursive:true});
for (const file of ['index.html',...fs.readdirSync(path.join(ROOT,'src')).filter(f=>f.endsWith('.js')).map(f=>'src/'+f),...fs.readdirSync(path.join(ROOT,'test/fixtures')).map(f=>'test/fixtures/'+f)]) {
  (RUN.hashes ||= {})[file]=crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,file))).digest('hex');
}
fs.copyFileSync(path.join(__dirname,'bridge.js'),path.join(OUT,'bridge.js'));
fs.copyFileSync(path.join(__dirname,'clock.js'),path.join(OUT,'clock.js'));
}
let page, browser, installed=false, queue=Promise.resolve(), seq=0;
function boundedAdvance(ms, elapsed, budget) {
  if (!Number.isFinite(ms) || ms < 0) throw Error('Requested simulation duration must be finite and nonnegative.');
  return Math.min(ms, Math.max(0, budget - elapsed));
}
function requestAllowed(req) {
  const host = req.headers.host;
  if (![`127.0.0.1:${PORT}`, `localhost:${PORT}`].includes(host)) return false;
  if (req.headers.origin && req.headers.origin !== `http://${host}`) return false;
  return req.headers['sec-fetch-site'] !== 'cross-site';
}
function persist(){
  if(!RUN.completedAt && (RUN.simulatedMs||0)>=RUN.simulationBudgetMs)RUN.completedAt=new Date().toISOString();
  const file=path.join(OUT,'run.json');
  fs.writeFileSync(file+'.tmp',JSON.stringify(RUN,null,2));fs.renameSync(file+'.tmp',file);
}
function log(record){fs.appendFileSync(path.join(OUT,'actions.jsonl'),JSON.stringify(record)+'\n');}
async function observe(){
  const observation=await page.evaluate(()=>window.GameplayQA.observe());
  return {...observation,session:{id:RUN.started,clockStarted:installed,simulatedMs:RUN.simulatedMs||0,budgetMs:RUN.simulationBudgetMs}};
}
async function settleCapture() {
  const modal=await page.evaluate(()=>[...document.querySelectorAll('.game-modal')].some(el=>
    el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden'));
  if(!modal)return {modal:false,nativeSettleMs:0};
  const decoded=page.evaluate(async()=>{
    const modals=[...document.querySelectorAll('.game-modal')].filter(el=>el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden');
    const promises=[];
    for(const modal of modals)for(const el of [modal,...modal.querySelectorAll('*')]){
      if(el instanceof HTMLImageElement&&el.src)promises.push(el.decode().catch(()=>false));
      for(const match of getComputedStyle(el).backgroundImage.matchAll(/url\(["']?(.*?)["']?\)/g)){
        const image=new Image();image.src=match[1];promises.push(image.decode().catch(()=>false));
      }
    }
    return (await Promise.all(promises)).every(result=>result!==false);
  }).catch(()=>false);
  const imagesDecoded=await Promise.race([decoded,page.waitForTimeout(2000).then(()=>false)]);
  // Phaser/Date stay frozen. Browser image loading and CSS's 420ms art fade
  // use native presentation time and must settle before evidence is captured.
  await page.waitForTimeout(500);
  return {modal:true,imagesDecoded,nativeSettleMs:500};
}
async function capture(reason){
  const presentation=await settleCapture();
  const name=`${String(++seq).padStart(4,'0')}-${String(reason).replace(/[^a-z0-9_-]/gi,'-').slice(0,70)}.png`;
  await page.screenshot({path:path.join(OUT,name),animations:'allow',timeout:20000});
  const row={file:name,reason,action:RUN.actions,simulatedMs:RUN.simulatedMs||0,presentation};
  RUN.screenshots.push(row);
  fs.writeFileSync(path.join(OUT,name.replace('.png','.json')),JSON.stringify(await observe(),null,2));
  persist();return row;
}
async function maintenance(request){
  if(request?.action!=='reload-bridge'||typeof request.reason!=='string'||!request.reason.trim())
    throw Error('Maintenance requires action reload-bridge and a reason.');
  if(!installed)throw Error('Bridge maintenance requires a started, paused session.');
  const source=fs.readFileSync(path.join(__dirname,'bridge.js'),'utf8');
  const before=await page.evaluate(()=>{
    if(GameplayQA.movement().active)throw Error('Cannot reload the bridge during movement.');
    return {clock:QAClock.status(),save:JSON.stringify(__scene.save)};
  });
  await page.evaluate(source=>{
    const previous=window.GameplayQA;delete window.GameplayQA;
    try{(0,eval)(source);if(!window.GameplayQA)throw Error('Bridge did not install.');}
    catch(error){window.GameplayQA=previous;throw error;}
  },source);
  const after=await page.evaluate(()=>({clock:QAClock.status(),save:JSON.stringify(__scene.save)}));
  const revision={type:'bridge-reload',atAction:RUN.actions,simulatedMs:RUN.simulatedMs,at:new Date().toISOString(),
    reason:request.reason,sha256:crypto.createHash('sha256').update(source).digest('hex'),
    clockStable:['elapsedMs','performanceMs','wallMs','steps'].every(key=>before.clock[key]===after.clock[key]),
    saveStable:before.save===after.save};
  revision.file=`bridge-revision-${RUN.actions}-${(RUN.revisions||[]).length+1}.js`;
  fs.writeFileSync(path.join(OUT,revision.file),source);
  (RUN.revisions||=[]).push(revision);
  fs.appendFileSync(path.join(OUT,'maintenance.jsonl'),JSON.stringify(revision)+'\n');persist();
  if(!revision.clockStable||!revision.saveStable)throw Error('Bridge reload changed the clock or save; inspect maintenance.jsonl.');
  return {revision,observation:await observe()};
}
async function advance(ms, options={}){
  if(!installed) throw Error('Clock not installed: finish onboarding, then send start.');
  ms=boundedAdvance(Number(ms),RUN.simulatedMs||0,RUN.simulationBudgetMs);
  const r=await page.evaluate(async({ms,options})=>{
    const scene=window.__scene, wasDialog=scene?._dialogOpen(), wasWork=!!scene?._workProgress;
    const energy=scene?.save.energy;
    return window.QAClock.advance(ms,{...options,until:()=>
      (!wasDialog && scene?._dialogOpen()) || (wasWork && !scene?._workProgress) ||
      (scene?.save.energy < energy-10)});
  },{ms,options});
  RUN.simulatedMs=r.elapsedMs;return r;
}
async function command(c,before){
  const started=Date.now();let result;
  if(!c || typeof c !== 'object' || typeof c.action !== 'string')throw Error('A JSON action object is required.');
  if(installed && (RUN.simulatedMs||0)>=RUN.simulationBudgetMs && !['observe','capture','checkpoint'].includes(c.action))throw Error('The 120-minute simulation budget is complete.');
  if(c.reason && ['interact','activate'].includes(c.action))await capture('before-'+c.reason,before);
  switch(c.action){
    case 'observe':return before;
    case 'start':
      if(installed)throw Error('Clock already started.');
      result=await page.evaluate(()=>window.QAClock.install()); installed=true; RUN.simulatedMs=0;break;
    case 'move':
      if(!installed)throw Error('Clock not installed: finish onboarding, then send start.');
      result=await page.evaluate(d=>window.GameplayQA.beginMove(d),c.direction);
      if(result.ok){
        const moved=await page.evaluate(async(budget)=>{
          const timing=await window.QAClock.advance(Math.min(20000,budget),{render:true,until:()=>!window.GameplayQA.movement().active});
          const state=window.GameplayQA.movement();
          const movement=window.GameplayQA.stopMove(state.active?(timing.advancedMs>=budget?'budget-exhausted':'timeout'):state.reason);
          return {timing,movement};
        },RUN.simulationBudgetMs-(RUN.simulatedMs||0));
        RUN.simulatedMs=moved.timing.elapsedMs;result={...moved.movement,advancedMs:moved.timing.advancedMs};
      }
      break;
    case 'interact':result=await page.evaluate(t=>window.GameplayQA.interact(t),c.target);if(installed)await advance(100);break;
    case 'activate':result=await page.evaluate(t=>window.GameplayQA.activate(t),c.control);if(installed)await advance(100);else await page.waitForTimeout(300);break;
    case 'wait':result=await advance(Math.min(Number(c.seconds),300)*1000);break;
    case 'scroll': {
      const delta=Number(c.deltaY ?? 400);
      if(!Number.isFinite(delta))throw Error('scroll deltaY must be finite.');
      const point=await page.evaluate(()=>{
        const menus=[...document.querySelectorAll('.game-modal')].filter(el=>el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden');
        const rect=menus.at(-1)?.getBoundingClientRect();
        return rect?{x:Math.max(1,Math.min(innerWidth-1,rect.left+rect.width/2)),y:Math.max(1,Math.min(innerHeight-1,rect.top+rect.height/2))}:{x:innerWidth/2,y:innerHeight/2};
      });
      await page.mouse.move(point.x,point.y);
      await page.mouse.wheel(0,Math.max(-2000,Math.min(2000,delta)));
      // Wheel dispatch is asynchronous. Let native scrolling settle while the
      // virtual gameplay clock stays frozen, then charge an explicit allowance.
      await page.waitForTimeout(100);
      result={deltaY:Math.max(-2000,Math.min(2000,delta))};
      if(installed)await advance(100);break;
    }
    case 'capture':return capture(c.reason||'manual',before);
    case 'checkpoint':{
      const checkpoint=await page.evaluate(()=>window.GameplayQA.checkpoint());
      fs.writeFileSync(path.join(OUT,`checkpoint-${RUN.actions}.json`),JSON.stringify(checkpoint,null,2));result={saved:true};break;
    }
    default:throw Error('Unknown action');
  }
  RUN.actions++;
  const after=await observe();
  const entry={step:RUN.actions,command:c,result:result&&{...result,observation:undefined},simulatedMs:RUN.simulatedMs||0,wallMs:Date.now()-started,before,after};
  log(entry);
  if(c.reason || JSON.stringify(before.menus)!==JSON.stringify(after.menus) || RUN.actions%50===0){
    try{await capture(c.reason||'interaction',after);}
    catch(error){RUN.errors.push({type:'capture',message:String(error),step:RUN.actions});}
  }
  persist();return {step:RUN.actions,simulatedMs:RUN.simulatedMs||0,result:result&&{...result,observation:undefined},observation:after};
}
async function executeCommand(c) {
  const before=await observe();
  try { return await command(c,before); }
  catch(error) {
    // A browser exception can follow successful frames or an applied control.
    // Preserve the actual elapsed clock and state instead of silently losing it.
    if(installed) {
      try { RUN.simulatedMs=(await page.evaluate(()=>QAClock.status())).elapsedMs; } catch {}
      try { await page.evaluate(()=>GameplayQA.stopMove('command-error')); } catch {}
    }
    let after; try { after=await observe(); } catch {}
    RUN.actions++;
    log({step:RUN.actions,command:c,error:String(error),simulatedMs:RUN.simulatedMs||0,before,after});
    persist();throw error;
  }
}
const server=http.createServer(async(req,res)=>{
  if(!requestAllowed(req)){res.writeHead(403);res.end();return;}

  if(['/command','/maintenance'].includes(req.url) && req.method==='POST'){
    const chunks=[];let size=0;for await(const part of req){size+=part.length;if(size>100000){res.writeHead(413);res.end();return;}chunks.push(part);}
    const body=Buffer.concat(chunks).toString('utf8');
    const work=queue.then(()=>req.url==='/maintenance'?maintenance(JSON.parse(body)):executeCommand(JSON.parse(body))); queue=work.catch(()=>{});
    try{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(await work));}
    catch(e){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:String(e)}));}return;
  }
  let file;try{const url=new URL(req.url,'http://localhost');file=path.resolve(ROOT,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));}catch{res.writeHead(400);res.end();return;}
  if(!file.startsWith(ROOT+path.sep)||path.relative(ROOT,file).split(path.sep).some(part=>part.startsWith('.'))){res.writeHead(403);res.end();return;}
  try{const real=await fs.promises.realpath(file);if(!real.startsWith(ROOT+path.sep)||path.relative(ROOT,real).split(path.sep).some(part=>part.startsWith('.'))){res.writeHead(403);res.end();return;}const data=await fs.promises.readFile(real);res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');res.end(data);}
  catch{res.writeHead(404);res.end();}
});
async function main(){
  setupRun();
  await new Promise(resolve=>server.listen(PORT,'127.0.0.1',resolve));
  browser=await chromium.launch({executablePath:process.env.PW_CHROMIUM||'/usr/bin/chromium',headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
  const context=await browser.newContext({viewport:RUN.viewport,geolocation:RUN.location,permissions:['geolocation'],serviceWorkers:'block'});
  await context.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.hostname==='tiles.openfreemap.org'){
      const match=url.pathname.match(/\/14\/(\d+)\/(\d+)\.pbf$/);
      if(match){const file=path.join(ROOT,'test/fixtures',`${match[1]}_${match[2]}.pbf`);if(fs.existsSync(file))return route.fulfill({path:file,contentType:'application/octet-stream'});RUN.fixtureMisses.push(url.pathname);return route.fulfill({status:504,body:''});}
      return route.fulfill({json:{tiles:['https://tiles.openfreemap.org/planet/fixture/{z}/{x}/{y}.pbf']}});
    }
    if(!['127.0.0.1','localhost'].includes(url.hostname)&&url.protocol!=='data:') return route.abort();
    return route.continue();
  });
  await context.addInitScript({path:path.join(__dirname,'clock.js')});
  await context.addInitScript(({seed})=>{let state=seed>>>0;Math.random=()=>{state=(Math.imul(1664525,state)+1013904223)>>>0;return state/4294967296;};},{seed:RUN.seed});
  page=await context.newPage();
  page.on('pageerror',e=>{RUN.errors.push({type:'pageerror',message:String(e),step:RUN.actions});persist();});
  page.on('console',m=>{if(m.type()==='error'){RUN.errors.push({type:'console',message:m.text(),step:RUN.actions});persist();}});
  await page.goto(`http://127.0.0.1:${PORT}/index.html?overpass=off`,{waitUntil:'load',timeout:60000});
  await page.addScriptTag({path:path.join(__dirname,'bridge.js')});
  persist();console.log(JSON.stringify({ready:true,url:`http://127.0.0.1:${PORT}/command`,out:OUT,observation:await observe()}));
}
if(require.main===module){
  main().catch(e=>{console.error(e);process.exitCode=1;server.close();browser?.close();});
  process.on('SIGTERM',async()=>{persist();await browser?.close();server.close();process.exit(0);});
}
module.exports={boundedAdvance,requestAllowed};
