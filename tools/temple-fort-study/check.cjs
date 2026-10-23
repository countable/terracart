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
 const snapshot=()=>page.evaluate(()=>study.panels.map(p=>({id:p.recipe.id,faces:p.renderer.model.faceCount,uploads:p.renderer.uploads,buffers:p.renderer.batches.map(b=>b.buffer),finite:[...p.renderer.model.batches.values()].every(a=>a.every(Number.isFinite)),gl:p.renderer.gl.getError()})));
 const before=await snapshot();assert.equal(before.length,6);assert(before.every(p=>p.faces>10&&p.finite&&p.gl===0));
 const retained=await page.evaluate(()=>{window.initialBuffers=study.panels.map(p=>p.renderer.batches.map(b=>b.buffer));return study.panels.map(p=>p.renderer.uploads);});
 for(const angle of [0,45,90,135,180,225,270,315,360]){await page.locator('#heading').fill(String(angle));await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));assert((await snapshot()).every(p=>p.gl===0));}
 assert.deepEqual(await page.evaluate(()=>study.panels.map(p=>p.renderer.uploads)),retained,'rotation never uploads new textures');assert(await page.evaluate(()=>study.panels.every((p,i)=>p.renderer.batches.every((b,j)=>b.buffer===initialBuffers[i][j]))),'rotation retains vertex buffers');
 await page.locator('#heading').fill('0');await page.screenshot({path:path.join(out,'north-up.png'),fullPage:true});
 await page.locator('#heading').fill('35');await page.waitForTimeout(100);await page.screenshot({path:path.join(out,'rotated.png'),fullPage:true});
 await page.locator('[data-design="continuous"] button').click();await page.waitForTimeout(100);await page.screenshot({path:path.join(out,'fort-detail.png')});await page.locator('#close').click();
 for(const stone of ['pale','dark'])for(const condition of ['0','1'])for(const roofs of [true,false]){await page.selectOption('#stone',stone);await page.selectOption('#condition',condition);await page.locator('#roofs').setChecked(roofs);const state=await snapshot();assert(state.every(p=>p.finite&&p.gl===0));}
 await page.selectOption('#stone','pale');await page.selectOption('#condition','1');await page.locator('#roofs').check();
 await page.selectOption('#scale','1');await page.locator('#north').click();await page.screenshot({path:path.join(out,'game-scale.png'),fullPage:true});
 await page.click('#spin');const angle=await page.locator('#heading').inputValue();await page.waitForTimeout(150);assert.notEqual(await page.locator('#heading').inputValue(),angle,'auto rotation advances heading');await page.click('#spin');
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(out,'mobile.png'),fullPage:true});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile has no horizontal overflow');
 assert.deepEqual(errors,[]);const result={models:6,rotationHeadings:9,materialConditions:8,retainedGeometry:true,retainedTextures:true,errors,modelsAudit:before};fs.writeFileSync(path.join(out,'audit.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
