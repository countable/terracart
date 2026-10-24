// Real Phaser renderer and movement, in an isolated sandbox save.
const fs = require('node:fs'), assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const out = process.env.OUT_DIR || '/tmp/wall-smash';
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const env = {...process.env}; delete env.DISPLAY;
  const browser = await chromium.launch({ env, executablePath: '/usr/bin/chromium', headless: true,
    args: ['--no-sandbox', '--ozone-platform=headless', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 1000 }, serviceWorkers: 'block' });
    const errors = []; page.on('pageerror', e => errors.push(String(e)));
    await page.addInitScript(() => { window.__DAYLIGHT = 1; sessionStorage.setItem('terracart.safetySeen', '1'); localStorage.setItem('terracart.introSeen', '1'); localStorage.setItem('terracart.howtoSeen', '1'); });
    await page.goto((process.env.GAME_URL || 'http://127.0.0.1:8000') + '/index.html?sandbox=true', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__scene?._bootOverlayGone, null, { timeout: 120000 });
    const setup = await page.evaluate(() => {
      const s = __scene; __game.loop.sleep(); window.__chooseMode?.('hard');
      document.querySelectorAll('.game-modal,[id$="-modal"],#story,#howto').forEach(e => e.style.display = 'none');
      s._syncModalGate?.(); s.scene.pause(); s._gpsSimulated = true; s._homeCapturePending = false; s._homeCaptureArmed = false; s._tickHomeZoom = () => {}; s._setRestZoom(1, 1);
      s._busyWheel = () => false; s._stickPushed = () => false; s._followPaused = false; s._followSettled = false;
      const ax = s.startWorldM.x + s.playerM.x, ay = s.startWorldM.y + s.playerM.y + s.feetOffsetM;
      const pc = s.playerToWorldCell(), entry = WorldGen.tileCache.get(WorldGen.tileKey(pc.tx, pc.ty));
      const ox = pc.tx * entry.tileEdgeM, oy = pc.ty * entry.tileEdgeM, m = s.cellM;
      // A known footprint through the same overlay used by live buildings.
      for (const e of WorldGen.tileCache.values()) e.buildingShapes = [];
      entry.buildingShapes = [{ key: 'wall-smash-fixture', tier: 9, ring: Float32Array.from([ax+m*.1-ox,ay-m-oy,ax+m*2.1-ox,ay-m-oy,ax+m*2.1-ox,ay+m-oy,ax+m*.1-ox,ay+m-oy]) }];
      entry.objects.push({id:'wall-smash-fixture',kind:'house',tier:9,
        x:ax+m*1.1,y:ay,area:m*m*4});
      s.save.restoredHouses['wall-smash-fixture'] = 'plain';
      s._buildingGeomKey = null; s._targetM = { x: s.playerM.x + m * 4, y: s.playerM.y };
      window.__wallStart = {...s.playerM}; window.__wallNow = performance.now(); performance.now = () => __wallNow;
      window.__wallFxTime = __wallNow;
      window.__wallRender = () => {
        const delta = __wallNow - __wallFxTime;
        if (delta > 0) s._fxEmitters?.fx_dust?.preUpdate(__wallNow, delta);
        __wallFxTime = __wallNow; s._overlayFrameSeq = (s._overlayFrameSeq || 0) + 1; s.drawBuildingGeometry(); s.drawObjects(); };
      __wallRender();
      return { m, start: __wallStart, renderer: s.game.renderer.type, gl: !!document.createElement("canvas").getContext("webgl"), lowpoly: s._lowpoly?.buildings?.length, fixture: s._proceduralBuildings?.get("wall-smash-fixture") };
    });
    assert.equal(setup.renderer, 2, 'visual review must use the normal WebGL building renderer');
    const capture = async name => {
      const data = await page.evaluate(() => new Promise(resolve => { __game.loop.wake(); setTimeout(() => __game.renderer.snapshot(img => { __game.loop.sleep(); resolve(img.src); }), 100); }));
      fs.writeFileSync(`${out}/${name}.png`, Buffer.from(data.split(',')[1], 'base64'));
    };
    const clearance = await page.evaluate(() => {
      const s = __scene;
      s._targetM = {x:__wallStart.x + s.cellM*.1 + .5,y:__wallStart.y};
      for(let i=0;i<100 && !s._wallSmashPending;i++) s._followStep(.1);
      const atWall = {...s.playerM};
      __wallNow += 5000; s._followStep(.1); __wallRender();
      const heldNear = s.playerM.x === atWall.x && !(s._wallSmashes?.length);
      s._targetM = {x:__wallStart.x+s.cellM*4,y:__wallStart.y};
      return {heldNear,buildingRole:Houses.displayRole(s.save,{id:'wall-smash-fixture',kind:'house',tier:9})};
    });
    assert.equal(clearance.heldNear,true); assert.equal(clearance.buildingRole,'plain');
    await capture('before');
    const result = await page.evaluate(() => {
      const s = __scene;
      const old = {...s.playerM};
      s._followStep(.1); const held = s.playerM.x === old.x && !!s._wallSmashPending;
      __wallNow += 80; s._followStep(.1); const stillHeld = s.playerM.x === old.x;
      __wallNow += 40; s._followStep(.1); __wallRender();
      return { held, stillHeld, passed: s.playerM.x > old.x, effects: s._wallSmashes.length, dust: s._fxEmitters?.fx_dust?.getAliveParticleCount() > 0 };
    });
    assert.deepEqual(result, { held: true, stillHeld: true, passed: true, effects: 1, dust: true });
    await page.evaluate(() => { __wallNow += 150; __wallRender(); }); await capture('impact');
    await page.evaluate(() => { __wallNow += 850; __wallRender(); }); await capture('crack');
    const checks = await page.evaluate(() => {
      const s = __scene;
      __wallNow += 1000; __wallRender(); const cleaned = s._wallSmashes.length === 0;
      // Back across the same edge after cooldown: pause, then reverse away.
      s._targetM = {...__wallStart}; s._followSettled = false;
      for (let i = 0; i < 100 && !s._wallSmashPending; i++) s._followStep(.1);
      const exitHeld = !!s._wallSmashPending;
      s._targetM = {x:s.playerM.x + s.cellM, y:s.playerM.y}; s._followStep(.02);
      const cancel = !s._wallSmashPending;
      s.depth = 1; const underground = !WallSmash.hold(s, __wallStart.x, __wallStart.y); s.depth = 0;
      s._reducedMotion = true; s._wallSmashes.push({x:s.startWorldM.x+s.playerM.x,y:s.startWorldM.y+s.playerM.y+s.feetOffsetM,start:__wallNow}); __wallRender();
      s.flashAtWorld('SMASH!',s._wallSmashes[0].x,s._wallSmashes[0].y);
      const note = s._liveToasts.find(t => t.text === 'SMASH!');
      const reduced = note?.scaleX === 1 && note?.style.fontSize === TOAST_TIER.note.font;
      return {cleaned,exitHeld,cancel,underground,reduced};
    });
    assert(Object.values(checks).every(Boolean), JSON.stringify(checks));
    await capture('reduced-motion');
    const rotated = await page.evaluate(() => {
      const s = __scene; s.mapRot = Math.PI / 4; s._huManualAngle = s.mapRot;
      s._applyMapZoom(); __wallRender();
      const e = s._wallSmashes[0], p = s.worldMetersToScreen(e.x, e.y);
      return { anchored: e.gfx.x === p.x && e.gfx.y === p.y - 10,
        mapNote: !!s._liveToasts.find(t => t.text === 'SMASH!' && t._huAnchor) };
    });
    assert(Object.values(rotated).every(Boolean), JSON.stringify(rotated));
    await capture('rotated');
    const shared = await page.evaluate(() => {
      const s = __scene, x = s.startWorldM.x+s.playerM.x, y = s.startWorldM.y+s.playerM.y;
      const emitter = s._fxEmitters.fx_dust;
      s._reducedMotion = false;
      const dust = s._burstAtWorld('dust',x,y);
      const reused = s._fxEmitters.fx_dust === emitter;
      const restore = s._blastAt(x,y,{chips:'timber',sparks:'greenspark'});
      s._reducedMotion = true;
      const reduced = s._burstAtWorld('dust',x,y) === 0;
      return {dust: dust > 0,reused,restore: restore > 0,reduced};
    });
    assert(Object.values(shared).every(Boolean), JSON.stringify(shared));
    assert.deepEqual(errors, []);
    fs.writeFileSync(`${out}/results.json`, JSON.stringify({setup,clearance,result,checks,rotated,shared,errors}, null, 2));
    console.log(JSON.stringify({result,checks,errors}));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
