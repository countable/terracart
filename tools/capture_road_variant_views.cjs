#!/usr/bin/env node
const {chromium}=require('playwright-core');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
(async()=>{
 const out=path.join(root,'design/road-experiences/current-views');fs.mkdirSync(out,{recursive:true});
 const rows=JSON.parse(fs.readFileSync(path.join(root,'design/zone-variants/street-variants.json'),'utf8')).rows;
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM||'/usr/bin/chromium',args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:1600,height:1000},deviceScaleFactor:2});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto((process.argv[2]||'http://localhost:8765/design/zone-variants/index.html')+'?zoneWidth=20&zoneHeight=7#streets');
  await page.waitForFunction(()=>document.documentElement.dataset.artReady==='true'&&document.documentElement.dataset.tilesReady==='true');
  await page.locator('#show-lights').uncheck();
  for(const row of rows){
   const svg=page.locator(`#street-${row.id} > figure > svg`);
   const size=await svg.evaluate(s=>({w:s.viewBox.baseVal.width,h:s.viewBox.baseVal.height}));
   if(Math.abs(size.w-140)>.01||Math.abs(size.h-49)>.01)throw Error('Viewport differs: '+row.id);
   await svg.screenshot({path:path.join(out,row.id+'.png')});
  }
  if(errors.length)throw Error(errors.join('\n'));
  console.log(`Captured ${rows.length} current variant views at20×7 cells`);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
