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
  if(process.env.SOURCE_PREVIEW){await page.route('**/preview.js',route=>route.fulfill({path:require('node:path').resolve('tools/fdr-castle-preview.js'),contentType:'application/javascript'}));await page.route('**/fdr-castle-trial/',route=>route.fulfill({body:fs.readFileSync('tools/fdr-castle-preview.html','utf8').replaceAll('game-loader.js','runtime-loader.js').replaceAll('fdr-castle-preview.js','preview.js'),contentType:'text/html'}));}
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
  let combinations=0;
  for(const palette of ['warm','cool']){
   const audit=await page.evaluate(palette=>{document.getElementById('palette').value=palette;fdrGeometryScene.rebuild();return fdrGeometryAudit},palette);
   const candidate=audit.panels[1];assert.equal(candidate.allMassesInside,true);assert.equal(candidate.keepInsideCourtyard,true);assert.equal(candidate.billboards,0);assert.equal(candidate.towers.length,4);assert.ok(candidate.keep);
   assert.equal(audit.panels[0].blocks,0,'native reference has no generated geometry');
   for(const tower of candidate.towers){assert.equal(tower.width,50);assert.equal(tower.depth,50);assert.equal(tower.height,40);}
   assert.equal(candidate.keep.width,82);assert.equal(candidate.keep.depth,66);assert.equal(candidate.keep.height,56);
   for(const angle of [0,45,90,135,180,225,270,315]){
    await page.locator('#angle').fill(String(angle));await page.waitForTimeout(70);
    assert.equal(await page.evaluate(()=>fdrGeometryScene.panels[0].root.rotation),0,'2D reference stays at authored heading');
    await page.locator('#game').screenshot({path:`${out}/${renderer}-${palette}-${angle}.png`});
   }
   combinations++;
  }
  assert.deepEqual(errors,[]);assert.deepEqual(failed,[]);results.push({renderer,combinations,rotation,errors,failed});await page.close();
 }}finally{await browser.close()}
 fs.writeFileSync(out+'/checks.json',JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify(results));
})().catch(e=>{console.error(e);process.exit(1)});
