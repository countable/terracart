// Static review sprites use the current game art without its animation loop.
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.launch({executablePath:process.env.CHROMIUM || '/usr/bin/chromium',args:['--no-sandbox']});
  try {
    const page = await browser.newPage({viewport:{width:1440,height:1000}}), errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`${process.env.REVIEW_BASE_URL || 'http://localhost:8765'}/tools/map-review.html?tiers=1&geometry=off`);
    await page.waitForFunction(()=>window.__world&&!building&&gameArt._assets&&gameArt._sprites.length>0,null,{timeout:180000});
    const audit=await page.evaluate(()=>{
      const sprites=gameArt._sprites, creatures=sprites.filter(s=>s.category==='creature'&&s.o.kind!=='npc');
      const buildings=sprites.filter(s=>['house','tower','temple'].includes(s.o.kind));
      const scene={save:__world.scene.save,depth:__world.scene.depth,textures:gameArt._assets.textures,cellM:WorldGen.CELL_M};
      const roles=new WeakMap();
      for(const s of buildings)if(s.o.kind==='house')roles.set(s.o,Houses.displayRole(scene.save,s.o));
      const native=Render.objectAppearance(scene,roles);
      return {
        buildings:buildings.length,
        wrongBuilding:buildings.filter(s=>{
          const expected=native.resolveAppearance(s.o),actual=s.appearance;
          return !expected||!actual||actual.visible!==expected.visible
            ||(expected.visible&&!gameArt._assets.textures.exists(actual.texKey))
            ||['groundGeometry','texKey','frameVal','scl','scaleYMul','dxPx','dyPx'].some(key=>actual[key]!==expected[key])
            ||JSON.stringify(actual.origin)!==JSON.stringify(expected.origin);
        }).length,
        wrongPose:creatures.filter(s=>{const expected=SpriteLayout.creatureAppearance({...s.o,_attackUntil:0,_moveUntil:0},0);return s.appearance.frameVal!==expected.frame||s.appearance.flipX!==!!expected.flipX;}).length,
        wrongElite:creatures.filter(s=>Combat.isElite(s.o)&&!s.appearance.texKey.startsWith('elite-vivid-')).length,
        plates:sprites.filter(s=>s.o.kind==='pressure_plate').length,
        lamps:sprites.filter(s=>s.o.kind==='_streetlamp').length,
        wrongLamp:sprites.filter(s=>s.o.kind==='_streetlamp'&&s.appearance?.texKey!==(s.o.lit?'rogue_lamp':'rogue_lamp_unlit')).length,
        wrongPlate:sprites.filter(s=>s.o.kind==='pressure_plate'&&s.appearance?.texKey!=='cave_mechanisms').length,
        failures:gameArt._assets.failures,
      };
    });
    console.log(JSON.stringify({audit},null,2));
    assert.ok(audit.buildings>0);assert.ok(audit.lamps>0);
    assert.equal(audit.wrongLamp,0); // Sacred Grove no longer guarantees pressure paths in this region.
    await page.evaluate(()=>{gameArt.setRestoredLamps(true);});
    assert.equal(await page.evaluate(()=>gameArt._sprites.filter(s=>s.o.kind==='_streetlamp').some(s=>s.appearance.texKey!=='rogue_lamp')),false);
    assert.equal(audit.wrongBuilding,0);assert.equal(audit.wrongPose,0);assert.equal(audit.wrongElite,0);assert.equal(audit.wrongPlate,0);
    assert.deepEqual(audit.failures,[]);
    await page.evaluate(()=>{
      document.querySelector('#gameplayTiers').click();
      document.querySelector('#pathEndpoints').click();
      const row=MapReviewPaths.sections(__world).filter(row=>row.mapLabel).sort((a,b)=>b.lengthM-a.lengthM)[0];
      map.setView(toLL(row.midpoint.x*EDGE,row.midpoint.y*EDGE,EDGE),19);
    });
    await page.waitForFunction(()=>gameArt._canvasZoom===19&&!gameArt._groundJob&&document.querySelectorAll('.path-label').length>0);
    const labels=await page.locator('.path-label').allTextContents();
    const expectedLabels=await page.evaluate(()=>MapReviewPaths.sections(__world).map(row=>row.mapLabel).filter(Boolean));
    assert.ok(labels.every(label=>expectedLabels.includes(label)));
    if(process.env.REVIEW_SCREENSHOT)await page.screenshot({path:process.env.REVIEW_SCREENSHOT});
    await page.evaluate(()=>document.querySelector('#pathLabels').click());
    await page.waitForFunction(()=>document.querySelectorAll('.path-label').length===0);
    await page.evaluate(()=>document.querySelector('#pathLabels').click());
    await page.waitForFunction(()=>document.querySelectorAll('.path-label').length>0);
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({labels},null,2));
    console.log('Current native building art, lamps, creatures, path labels and display toggles passed.');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
