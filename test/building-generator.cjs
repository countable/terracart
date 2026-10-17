const assert=require('node:assert/strict');
const {chromium}=require('playwright-core');
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
  try {
    const page=await browser.newPage({viewport:{width:960,height:900},deviceScaleFactor:1.5});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const base=process.env.PREVIEW_URL||'http://localhost:7731/tools/building-poly-preview.html';
    const signatures=[];
    for(const stories of [1,2,3]) {
      await page.goto(base+'?stories='+stories+'&detail=clean');
      await page.waitForFunction(()=>['ready','preview failed'].includes(document.title));
      assert.equal(await page.title(),'ready');
      const result=await page.evaluate(()=>{
        const scene=previewScene;
        const snapshot=()=>{
          const t=scene.textures.get('buildinggeom_overlay'),ctx=t.getContext();
          const pixels=ctx.getImageData(0,0,t.canvas.width,t.canvas.height).data;
          let hash=2166136261;for(const value of pixels)hash=Math.imul(hash^value,16777619);
          return hash>>>0;
        };
        const before=snapshot(),timings=[];
        for(let i=0;i<5;i++){scene._buildingGeomKey=null;const start=performance.now();BuildingOverlay.draw(scene);timings.push(performance.now()-start);}
        const after=snapshot();
        scene.save.restoredHouses['roof-0']='blacksmith';BuildingOverlay.draw(scene);const changed=snapshot();
        scene.save.restoredHouses['roof-0']='plain';BuildingOverlay.draw(scene);
        return{before,after,changed,restored:snapshot(),median:timings.sort((a,b)=>a-b)[2]};
      });
      assert.equal(result.before,result.after,'cached rebuilds preserve every rendered pixel');
      assert.notEqual(result.before,result.changed,'shop role changes update wall material');
      assert.equal(result.before,result.restored,'restoring the recipe restores exact appearance');
      signatures.push(result.before);
      await page.locator('#stage').screenshot({path:`/tmp/building-generator-${stories}.png`});
      console.log(`${stories} storeys: stable pixels, live material changes; cached redraw ${result.median.toFixed(1)} ms.`);
    }
    assert.equal(new Set(signatures).size,3,'each storey count changes the rendered building');
    await page.selectOption('#detail','detailed');
    await page.locator('#stage').screenshot({path:'/tmp/building-generator-dense.png'});
    await page.selectOption('#detail','clean');
    await page.selectOption('#roof','inset');
    await page.locator('#stage').screenshot({path:'/tmp/building-generator-inset.png'});
    assert.deepEqual(errors,[],'no browser rendering errors');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
