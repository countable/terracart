// Visual/retention checks for the isolated FDR castle trial.
const {chromium}=require('playwright-core'),assert=require('node:assert/strict'),fs=require('node:fs');
(async()=>{
 const out=process.env.OUT_DIR||'/tmp/fdr-castle-checks';fs.mkdirSync(out,{recursive:true});
 const env={...process.env};delete env.DISPLAY;
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM||'/usr/lib/chromium/chromium',env,args:['--no-sandbox','--ozone-platform=headless','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const results=[];
 try{for(const renderer of ['webgl','canvas']){
  const page=await browser.newPage({viewport:{width:1320,height:1040},deviceScaleFactor:1});const errors=[],failed=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)failed.push([r.status(),r.url()])});
  await page.goto((process.env.STUDY_URL||'http://localhost:8765/fdr-castle-trial/')+(renderer==='canvas'?'?canvas':''));
  await page.waitForFunction(()=>window.ready===true,null,{timeout:30000});
  const rotation=await page.evaluate(()=>{
   const scene=fdrGeometryScene,panels=scene.panels,blocks=panels.map(p=>p.group.blocks.slice());
   let allocations=0,reads=0,refreshes=0;const create=scene.textures.createCanvas,read=CanvasRenderingContext2D.prototype.getImageData;
   scene.textures.createCanvas=function(...args){allocations++;return create.apply(this,args)};
   CanvasRenderingContext2D.prototype.getImageData=function(...args){reads++;return read.apply(this,args)};
   const textures=scene.textures.getTextureKeys().map(k=>scene.textures.get(k)).filter(t=>t.refresh),originals=textures.map(t=>t.refresh);
   textures.forEach(t=>{const refresh=t.refresh;t.refresh=function(...args){refreshes++;return refresh.apply(this,args)}});
   const keys=scene.textures.getTextureKeys().sort().join(',');let finite=true;
   try{for(let deg=0;deg<=360;deg++){document.getElementById('angle').value=deg;scene.update(0,0);for(const p of panels)for(const b of p.group.blocks){finite&&=[...b.projected].every(Number.isFinite);for(const f of b.materialFaces||[])finite&&=f.points.every(v=>[v.x,v.y,v.z,v.u,v.v].every(Number.isFinite));}}}
   finally{scene.textures.createCanvas=create;CanvasRenderingContext2D.prototype.getImageData=read;textures.forEach((t,i)=>t.refresh=originals[i]);}
   return {headings:361,allocations,reads,refreshes,finite,textureKeysStable:keys===scene.textures.getTextureKeys().sort().join(','),blocksRetained:panels.every((p,i)=>blocks[i].every(b=>p.group.blocks.includes(b)))};
  });
  assert.equal(rotation.allocations,0);assert.equal(rotation.reads,0);assert.equal(rotation.refreshes,0);for(const flag of ['finite','textureKeysStable','blocksRetained'])assert.equal(rotation[flag],true,flag);
  let combinations=0;const states={};
  for(const shape of ['rectangle','concave','narrow'])for(const condition of ['restored','weathered'])for(const family of ['citadel','ruin','bastion','archive'])for(const palette of ['warm','cool'])for(const keep of [false,true]){
   const audit=await page.evaluate(config=>{for(const [id,value] of Object.entries(config)){const el=document.getElementById(id);if(id==='keep')el.checked=value;else el.value=value}fdrGeometryScene.rebuild();return fdrGeometryAudit},{shape,condition,family,palette,keep});
   const candidate=audit.panels[1];assert.equal(candidate.allMassesInside,true);assert.equal(candidate.billboards,0);assert.ok(candidate.towers.length>=2);
   if(!keep||shape==='narrow')assert.equal(candidate.keep,null);else assert.ok(candidate.keep,'keep fits '+shape);
   const key=JSON.stringify({shape,family,palette,keep});if(condition==='restored')states[key]=candidate.blocks;else assert.equal(candidate.blocks,states[key],'restoration preserves structure and ruin damage');
   combinations++;
  }
  const select=async config=>page.evaluate(config=>{for(const [id,value] of Object.entries(config)){const el=document.getElementById(id);if(id==='keep')el.checked=value;else el.value=value}fdrGeometryScene.rebuild()},{shape:'rectangle',condition:'restored',family:'citadel',palette:'cool',keep:true,...config});
  await select({});
  for(const angle of [0,45,90,135,180,225,270,315]){await page.locator('#angle').fill(String(angle));await page.waitForTimeout(70);await page.locator('#game').screenshot({path:`${out}/${renderer}-${angle}.png`});}
  for(const shape of ['concave','narrow']){await select({shape,palette:'warm',family:'ruin',condition:'weathered'});await page.locator('#angle').fill('25');await page.waitForTimeout(80);await page.locator('#game').screenshot({path:`${out}/${renderer}-${shape}.png`});}
  await select({palette:'warm'});await page.locator('#angle').fill('20');await page.waitForTimeout(80);await page.locator('#game').screenshot({path:`${out}/${renderer}-warm.png`});
  assert.deepEqual(errors,[]);assert.deepEqual(failed,[]);results.push({renderer,combinations,rotation,errors,failed});await page.close();
 }}finally{await browser.close()}
 fs.writeFileSync(out+'/checks.json',JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify(results));
})().catch(e=>{console.error(e);process.exit(1)});
