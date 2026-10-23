// Browser checks exercise the real textured meshes and all comparison controls.
const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
(async()=>{
 const out=process.env.ART_OUTPUT||'/tmp/temple-fort-check';fs.mkdirSync(out,{recursive:true});
 const env={...process.env};delete env.DISPLAY;
 const browser=await chromium.launch({executablePath:'/usr/lib/chromium/chromium',env,args:['--no-sandbox','--ozone-platform=headless','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try{
 const page=await browser.newPage({viewport:{width:1500,height:1500}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});
 await page.goto(process.env.VIEWER_URL||'http://localhost:8765/temple-fort-study/');await page.waitForFunction(()=>window.ready,{}, {timeout:30000});
 const snapshot=()=>page.evaluate(()=>study.panels.map(p=>({id:p.recipe.id,faces:p.renderer.model.faceCount,uploads:p.renderer.uploads,finite:[...p.renderer.model.batches.values()].every(a=>a.every(Number.isFinite)),gl:p.renderer.gl.getError()})));
 const before=await snapshot();assert.equal(before.length,11);assert(before.every(p=>p.faces>10&&p.finite&&p.gl===0));
 assert.equal(await page.locator('#selected-designs canvas:visible').count(),2);
 assert.equal(await page.locator('#forts canvas:visible').count(),0,'older candidates begin collapsed');
 assert(await page.evaluate(()=>{
  const fort=study.panels.find(p=>p.recipe.id==='selected-fort').renderer.model;
  const temple=study.panels.find(p=>p.recipe.id==='selected-temple').renderer.model;
  const levels=key=>{const data=[...fort.batches].filter(([name])=>name.startsWith(key)).flatMap(([,values])=>values),zs=data.filter((_,i)=>i%6===2);return [Math.min(...zs),Math.max(...zs)];};
  const wood=fort.palisade;
  return wood.width===32/6&&wood.height===22.5&&wood.tip===8.5&&wood.posts.every(p=>p.width===32/6&&Math.abs(p.height-22.5*(p.index%2?1.1:1))<1e-8)
   &&Math.abs(levels('palisade-lower')[0]-3)<1e-8&&Math.abs(levels('palisade-lower')[1]-15.375)<1e-8&&Math.abs(levels('palisade-upper')[1]-27.75)<1e-8&&fort.selectedFort.sideStructures===false
   &&fort.batches.has('original-planks')&&fort.batches.has('dice')
   &&temple.temple.continuousBrim&&temple.temple.wallHeight===TempleArt.geometry.wallHeight&&temple.temple.wallThickness===3
   &&temple.batches.has('original-temple-pale-active')&&!temple.batches.has('temple-closed-door')&&!temple.batches.has('rune');
 }),'selected fort dimensions/shade boundary and original temple floor/brim');
 const closed=await page.evaluate(()=>study.panels.filter(p=>p.recipe.enclosure==='closed').map(p=>({id:p.recipe.id,sealed:p.renderer.model.sealedPortal,faces:p.renderer.model.faceCount})));
 assert.equal(closed.length,3);assert(closed.every(m=>m.sealed&&m.faces>50),'three enclosed temple meshes include sealed portals');
 // A ray from the interior at door height must hit masonry in all four
 // cardinal directions; a sky ray must hit a roof above the wall height.
 assert(await page.evaluate(()=>{
  function hit(o,d,v){const sub=(a,b)=>a.map((x,i)=>x-b[i]),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);const e1=sub(v[1],v[0]),e2=sub(v[2],v[0]),h=cross(d,e2),det=dot(e1,h);if(Math.abs(det)<1e-7)return false;const inv=1/det,s=sub(o,v[0]),u=dot(s,h)*inv;if(u<0||u>1)return false;const q=cross(s,e1),w=dot(d,q)*inv;if(w<0||u+w>1)return false;return dot(e2,q)*inv>1e-5;}
  return study.panels.filter(p=>p.recipe.enclosure==='closed').every(p=>{
   const triangles=[];for(const data of p.renderer.model.batches.values())for(let i=0;i<data.length;i+=18)triangles.push([data.slice(i,i+3),data.slice(i+6,i+9),data.slice(i+12,i+15)]);
   return [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1]].every(d=>triangles.some(t=>hit([0,0,18],d,t)));
  });
 }),'closed temple shells block rays at door height and overhead');
 const retained=await page.evaluate(()=>{window.initialBuffers=study.panels.map(p=>p.renderer.batches.map(b=>b.buffer));return study.panels.map(p=>p.renderer.uploads);});
 for(const angle of [0,45,90,135,180,225,270,315,360]){await page.locator('#heading').fill(String(angle));await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));assert((await snapshot()).every(p=>p.gl===0));}
 assert.deepEqual(await page.evaluate(()=>study.panels.map(p=>p.renderer.uploads)),retained,'rotation never uploads new textures');assert(await page.evaluate(()=>study.panels.every((p,i)=>p.renderer.batches.every((b,j)=>b.buffer===initialBuffers[i][j]))),'rotation retains vertex buffers');
 await page.locator('#heading').fill('0');await page.screenshot({path:path.join(out,'north-up.png'),fullPage:true});
 await page.locator('#selected-designs').screenshot({path:path.join(out,'comparison.png')});
 await page.locator('#heading').fill('35');await page.waitForTimeout(100);await page.screenshot({path:path.join(out,'rotated.png'),fullPage:true});
 await page.locator('[data-design="selected-temple"] button').click();await page.waitForTimeout(100);await page.screenshot({path:path.join(out,'selected-temple-detail.png')});await page.locator('#close').click();
 await page.locator('[data-design="selected-fort"] button').click();await page.waitForTimeout(100);await page.screenshot({path:path.join(out,'selected-fort-detail.png')});await page.locator('#close').click();
 for(const stone of ['pale','dark'])for(const condition of ['0','1'])for(const roofs of [true,false]){await page.selectOption('#stone',stone);await page.selectOption('#condition',condition);await page.locator('#roofs').setChecked(roofs);const state=await snapshot();assert(state.every(p=>p.finite&&p.gl===0));}
 await page.locator('#earlier summary').click();await page.waitForTimeout(100);assert.equal(await page.locator('#open-temples canvas:visible').count(),3);await page.locator('#earlier summary').click();
 await page.selectOption('#stone','pale');await page.selectOption('#condition','1');await page.locator('#roofs').check();
 await page.selectOption('#scale','1');await page.locator('#north').click();await page.screenshot({path:path.join(out,'game-scale.png'),fullPage:true});
 await page.click('#spin');const angle=await page.locator('#heading').inputValue();await page.waitForTimeout(150);assert.notEqual(await page.locator('#heading').inputValue(),angle,'auto rotation advances heading');await page.click('#spin');
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(out,'mobile.png'),fullPage:true});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile has no horizontal overflow');
 assert.deepEqual(errors,[]);const result={models:11,selectedDesigns:2,closedTemples:3,rotationHeadings:9,materialConditions:8,retainedGeometry:true,retainedTextures:true,errors,modelsAudit:before};fs.writeFileSync(path.join(out,'audit.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
