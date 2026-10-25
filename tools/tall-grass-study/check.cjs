const {chromium}=require('playwright-core');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const out=process.env.ART_OUTPUT||'/tmp/tall-grass-check';fs.mkdirSync(out,{recursive:true});
(async()=>{
 const env={...process.env};delete env.DISPLAY;
 const browser=await chromium.launch({env,executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--ozone-platform=headless','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try{
  const page=await browser.newPage({viewport:{width:1200,height:1250}}),errors=[];
  page.on('pageerror',e=>errors.push(String(e)));
  await page.goto(process.env.VIEWER_URL||'http://localhost:8765/tall-grass-study/');
  await page.waitForFunction(()=>window.grassStudy);
  await page.screenshot({path:out+'/grass.png',fullPage:true});
  for(const angle of [0,45,90,180,270]){
   await page.evaluate(a=>{grassStudy.state.heading=a*Math.PI/180;grassStudy.rebuild();},angle);
   assert.equal(await page.evaluate(()=>grassStudy.renderer.gl.getError()),0);
  }
  await page.evaluate(()=>{grassStudy.state.heading=0;grassStudy.rebuild();});
  const pt=await page.evaluate(()=>{const p=grassStudy.project(0,0,18),r=field.getBoundingClientRect();return {x:r.left+p.x*r.width/field.width,y:r.top+p.y*r.height/field.height};});
  await page.mouse.click(pt.x,pt.y);
  assert.deepEqual(await page.evaluate(()=>[...grassStudy.state.cleared]),['0,0']);
  assert.equal(await page.evaluate(()=>grassStudy.state.inventory),1);
  await page.mouse.click(pt.x,pt.y);
  assert.equal(await page.evaluate(()=>grassStudy.state.inventory),1,'repeat tap must not gather adjacent grass');
  await page.evaluate(()=>{grassStudy.state.player={x:0,y:0};grassStudy.rebuild();});
  assert.match(await page.locator('#study-status').textContent(),/In the open/);
  await page.screenshot({path:out+'/cleared.png',fullPage:true});
  await page.locator('#reset').click();
  await page.evaluate(()=>{grassStudy.state.player={x:-24,y:0};grassStudy.move(1,0,24);});
  assert.equal(await page.locator('#pop').textContent(),'oh!');
  assert.equal(await page.locator('#pop').isVisible(),true);
  await page.screenshot({path:out+'/discovery.png',fullPage:true});
  await page.evaluate(()=>{const p=grassStudy.project(96,64,18);grassStudy.pick(p.x,p.y);});
  assert.equal(await page.evaluate(()=>grassStudy.state.eggs),1);
  await page.locator('#reset').click();await page.selectOption('#cover','hedge');
  assert.match(await page.locator('#study-status').textContent(),/lower half hidden/);
  await page.screenshot({path:out+'/hedge.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:out+'/mobile.png',fullPage:true});
  assert.deepEqual(errors,[]);console.log('PASS: angles, cell picking, inventory, discovery pop, egg harvest, cover, hedge, mobile, WebGL and browser errors');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
