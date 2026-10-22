// Run against a local game server. Exercise real context loss with authored
// shops and procedural wrecks in the same masked world render pass.
const assert=require('node:assert/strict');
const {chromium}=require('playwright-core');

(async()=>{
  const env={...process.env};delete env.DISPLAY;
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM||'/usr/bin/chromium',env,
    args:['--no-sandbox','--ozone-platform=headless','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  try{
    const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,serviceWorkers:'block'});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>{
      sessionStorage.setItem('terracart.safetySeen','1');
      localStorage.setItem('terracart.introSeen','1');localStorage.setItem('terracart.howtoSeen','1');
    });
    await page.goto((process.argv[2]||'http://localhost:7731')+'/index.html?sandbox=true&sandboxZone=restoration');
    await page.waitForFunction(()=>window.__scene?._bootOverlayGone,null,{timeout:90000});
    const fixture=await page.evaluate(()=>{
      const s=__scene;window.__chooseMode?.('hard');
      s._overlayFrameSeq++;s.drawBuildingGeometry();s.drawObjects();s.scene.pause();
      const r=s.game.renderer,gl=r.gl;
      window.__contextErrors=[];window.__restoreCount=0;
      const draw=gl.drawArrays.bind(gl);
      gl.drawArrays=(...args)=>{draw(...args);const code=gl.getError();
        if(code&&code!==gl.CONTEXT_LOST_WEBGL)__contextErrors.push(code);};
      r.on('restorewebgl',()=>{__restoreCount++;});
      window.__loseContext=gl.getExtension('WEBGL_lose_context');
      // Hash the actual backbuffer at frame end: a successful restoration
      // must reproduce the scene, including the compass viewport's mask.
      window.__frameHash=()=>new Promise(resolve=>__game.events.once('postrender',()=>{
        const pixels=new Uint8Array(r.width*r.height*4);gl.readPixels(0,0,r.width,r.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
        let hash=2166136261;for(const byte of pixels)hash=Math.imul(hash^byte,16777619);
        resolve(hash>>>0);
      }));
      return {renderer:r.type,extension:!!__loseContext,
        authored:s._lowpoly.buildings.filter(m=>m.faces[0]?.sourceArt).length,
        wrecks:s._lowpoly.buildings.filter(m=>m.role==='wreck').length};
    });
    assert.equal(fixture.renderer,2);assert(fixture.extension&&fixture.authored&&fixture.wrecks);
    // Let the retained render and modal pause settle before the first sample.
    await page.waitForTimeout(300);
    const baseline=await page.evaluate(()=>__frameHash());
    for(let cycle=1;cycle<=2;cycle++){
      await page.evaluate(()=>__loseContext.loseContext());
      await page.waitForFunction(()=>__game.renderer.contextLost);
      await page.evaluate(()=>__loseContext.restoreContext());
      await page.waitForFunction(cycle=>__restoreCount===cycle&&!__game.renderer.contextLost,cycle,{timeout:15000});
      const restored=await page.evaluate(()=>__frameHash());
      assert.equal(restored,baseline,'restored world pixels match the paused scene');
      assert.deepEqual(await page.evaluate(()=>__contextErrors),[],'restored buildings submit no invalid GL handles');
    }
    assert.deepEqual(errors,[]);
    console.log('PASS: mixed authored shops/wrecks survive two GPU resets with identical world pixels and no GL errors.',fixture);
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
