#!/usr/bin/env node
'use strict';
// Isolated validation fixtures only; this never touches the measured QA run.
// node tools/qa/verify-clock.js [/tmp/qa-clock-verification.json]
// QA_COMBAT_ONLY=1 runs only the isolated Wood Bow fixture.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const ROOT = path.resolve(__dirname, '../..');
const OUT = path.resolve(process.argv[2] || '/tmp/qa-clock-verification.json');
const COMBAT_ONLY = process.env.QA_COMBAT_ONLY === '1';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const server = http.createServer(async (req, res) => {
  const file = path.resolve(ROOT, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
  if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403); return res.end(); }
  try { const body = await fs.promises.readFile(file); res.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream'); res.end(body); }
  catch { res.writeHead(404); res.end(); }
});
let browser;
async function verifyBowCombat(page, advance) {
  const cadenceMs=await page.evaluate(() => {
    const s=__scene,p=playerWorldM(s);
    Energy.set(s.save,100);
    s.save.relics.bow={tier:1};s.save.activeWeapon='bow';
    Inventory.add(s.save,'wood',2);s.save.ammoShots=0;
    (s.save.storySeen ||= {})['tool:shoot']=true;
    s.compassDeg=null;s.facing={x:0,y:-1};
    s._shots=[];s._nextShotT={bow:performance.now()+500};
    const foe={id:'clock-bow-fixture',kind:'slime',x:p.x+s.cellM,y:p.y,_hp:1000};
    const cell=s.cellAt(foe.x,foe.y),entry=WorldGen.tileCache.get(WorldGen.tileKey(cell.tx,cell.ty));
    if(!entry)throw Error('Bow fixture tile missing');
    (entry.creatures ||= []).push(foe);
    // Isolate actual auto-fire, aiming, projectile flight and damage from AI.
    // This disposable target cannot move or attack; its HP prevents a kill.
    s.wanderCreatures=function(){this._activeCreatures=[foe];};
    s.drawObjects();
    window.qaCombat={foe,started:performance.now(),shots:[],hits:[]};
    const spawn=Combat.spawnShot;
    Combat.spawnShot=function(...args){
      const shot=spawn(...args);
      if(args[0]==='bow'&&shot)qaCombat.shots.push({at:performance.now()-qaCombat.started,vx:shot.vx,vy:shot.vy,damage:shot.damage});
      return shot;
    };
    const damage=s._damageEnemy;
    s._damageEnemy=function(target,...args){
      const before=Combat.hp(target),result=damage.call(this,target,...args);
      if(target===foe)qaCombat.hits.push({at:performance.now()-qaCombat.started,damage:before-Combat.hp(target)});
      return result;
    };
    return Combat.fireIntervalMs('bow')*Combat.playerAttackIntervalMul(s.save);
  });
  const snapshot=()=>page.evaluate(()=>({shots:qaCombat.shots.slice(),hits:qaCombat.hits.slice(),hp:Combat.hp(qaCombat.foe),
    facing:{...__scene.facing},ammoShots:__scene.save.ammoShots,wood:Inventory.count(__scene.save,'wood'),energy:__scene.save.energy,
    player:{...__scene.playerM},foe:{x:qaCombat.foe.x,y:qaCombat.foe.y}}));
  await advance(500+2*cadenceMs+200);
  const facingAway=await snapshot();
  // Same input as the movement stick: no direct aiming write in this phase.
  await page.evaluate(()=>{__scene._movePadHeld=true;__scene.joystickVec={x:1,y:0};});
  await advance(100);
  await page.evaluate(()=>{__scene._movePadHeld=false;__scene.joystickVec={x:0,y:0};});
  await advance(3*cadenceMs+200);
  return {cadenceMs,facingAway,facingToward:await snapshot()};
}
async function run(mode) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, geolocation: { latitude: 49.85438, longitude: -119.47870 }, permissions: ['geolocation'], serviceWorkers: 'block' });
  const errors = [], fixtureMisses = [];
  await context.route('**/*', async route => {
    const u = new URL(route.request().url());
    if (u.hostname === 'tiles.openfreemap.org') {
      const match = u.pathname.match(/\/14\/(\d+)\/(\d+)\.pbf$/);
      if (match) {
        const file = path.join(ROOT, 'test/fixtures', `${match[1]}_${match[2]}.pbf`);
        if (fs.existsSync(file)) return route.fulfill({ path: file, contentType: 'application/octet-stream' });
        fixtureMisses.push(u.pathname); return route.fulfill({ status: 504, body: '' });
      }
      return route.fulfill({ json: { tiles: ['https://tiles.openfreemap.org/planet/fixture/{z}/{x}/{y}.pbf'] } });
    }
    return u.hostname === '127.0.0.1' ? route.continue() : route.abort();
  });
  // Normal baseline deliberately has no virtual-clock injection.
  if (mode === 'accelerated') await context.addInitScript({ path: path.join(__dirname, 'clock.js') });
  await context.addInitScript(() => {
    localStorage.setItem('terracart.introSeen', '1');
    let seed = 73129;
    Math.random = () => ((seed = (Math.imul(1664525, seed) + 1013904223) >>> 0) / 4294967296);
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => {
    if (message.type() === 'error' && message.text().includes('update() frame error')) errors.push(message.text());
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html?overpass=off`);
  await page.locator('#safety-dismiss').click({ timeout: 30000 });
  await page.waitForFunction(() => window.__scene?.playerM && window.__scene?.save, { timeout: 60000 });
  await page.locator('#howto-easy').click({ timeout: 30000 });
  await page.waitForTimeout(6000);
  if (mode === 'accelerated') await page.evaluate(() => QAClock.install());
  const advance = async ms => mode === 'accelerated'
    ? page.evaluate(ms => QAClock.advance(ms), ms) : page.waitForTimeout(ms);
  if(COMBAT_ONLY){const combat=await verifyBowCombat(page,advance);await context.close();return{mode,combat,errors,fixtureMisses};}
  const snapshot = () => page.evaluate(() => ({
    time: performance.now(), wall: Date.now(), player: { ...__scene.playerM }, arrivalToleranceM: __scene.cellM * 0.15, manualOffset: { ...__scene._manualOffsetM }, energy: __scene.save.energy,
    frameSum: window.qaFrameSum, frames: window.qaFrames,
    crop: __scene.save.planted.find(p => p.id === 'clock-verification-crop'),
    work: !!__scene._workProgress, completionMs: window.qaWorkCompleteMs ?? null,
  }));
  await page.evaluate(() => {
    window.qaFrameSum = 0; window.qaFrames = 0;
    __scene.events.on('update', (_, dt) => { qaFrameSum += dt; qaFrames++; });
    // A real crop with 1.5s remaining tests the scene's growth scan without
    // making the verification itself wait four minutes. No tuning is changed.
    const p = playerWorldM(__scene);
    __scene.save.planted.push({ id: 'clock-verification-crop', x: p.x, y: p.y,
      crop: 'potato', stage: 0, watered_t: Date.now() - Crops.stageHoldMs('potato') + 1500 });
    Crops.invalidateSpatialIndex(__scene.save);
    __scene._movePadHeld = true; __scene.joystickVec = { x: 1, y: 0 };
  });
  const start = await snapshot();
  await advance(3000);
  await page.evaluate(() => { __scene._movePadHeld = false; __scene.joystickVec = { x: 0, y: 0 }; });
  const moved = await snapshot();
  await advance(20000);
  const drifted = await snapshot();
  await page.evaluate(() => {
    // Exercise the actual wheel and energy/rest gate in a disposable save.
    // This is a clock fixture, not a claim that a player completed a task.
    Energy.set(__scene.save, 60);
    __scene.spendEnergy(10);
    const p = playerWorldM(__scene), start = performance.now();
    __scene.startWorkProgress(p.x, p.y, () => { window.qaWorkCompleteMs = performance.now() - start; }, 1500);
  });
  const workStarted = await snapshot();
  await advance(2000);
  const worked = await snapshot();
  let pauseStable = null;
  if (mode === 'accelerated') {
    const before = await snapshot(); await page.waitForTimeout(1200);
    pauseStable = JSON.stringify(before) === JSON.stringify(await snapshot());
  }
  const combat=await verifyBowCombat(page,advance);
  await context.close();
  return { mode, combat, start, moved, drifted, workStarted, worked, pauseStable, errors, fixtureMisses };
}
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || '/usr/bin/chromium', headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const normal = await run('normal'), accelerated = await run('accelerated');
  const movementDifferenceM = COMBAT_ONLY ? null : Math.hypot(normal.moved.player.x - accelerated.moved.player.x, normal.moved.player.y - accelerated.moved.player.y);
  const checks = {
    ...(COMBAT_ONLY?{}:{
    movementWithinQuarterMeter: movementDifferenceM < 0.25,
    driftReturnsHome: [normal, accelerated].every(r => Math.hypot(r.drifted.player.x, r.drifted.player.y) <= r.drifted.arrivalToleranceM && Math.hypot(r.drifted.manualOffset.x, r.drifted.manualOffset.y) < 0.01),
    cropAdvancesExactlyOnce: [normal, accelerated].every(r => r.moved.crop.stage === 1 && r.drifted.crop.stage === 1 && r.moved.crop.watered_t === 0),
    workCompletesAtCorrectTime: [normal, accelerated].every(r => r.worked.completionMs >= 1500 && r.worked.completionMs < 1600 && !r.worked.work),
    workSuppressesRest: [normal, accelerated].every(r => r.workStarted.energy === 50 && r.worked.energy === 50),
    acceleratedClockExact: accelerated.worked.time - accelerated.start.time === 25000 && accelerated.worked.wall - accelerated.start.wall === 25000,
    pauseStable: accelerated.pauseStable,
    }),
    bowFacingAwayMisses: [normal,accelerated].every(r=>r.combat.facingAway.shots.length===3&&r.combat.facingAway.hits.length===0),
    bowStickTurnAimsEast: [normal,accelerated].every(r=>r.combat.facingToward.facing.x===1&&r.combat.facingToward.facing.y===0
      &&r.combat.facingToward.shots.slice(3).every(shot=>shot.vx===1&&shot.vy===0)),
    bowCadenceAndHitsMatch: normal.combat.facingToward.shots.length===accelerated.combat.facingToward.shots.length
      &&normal.combat.facingToward.hits.length===3&&accelerated.combat.facingToward.hits.length===3,
    bowDamageAmmoEnergyMatch: ['hp','ammoShots','wood','energy'].every(key=>normal.combat.facingToward[key]===accelerated.combat.facingToward[key]),
    noPageErrors: normal.errors.length + accelerated.errors.length === 0,
    noFixtureMisses: normal.fixtureMisses.length + accelerated.fixtureMisses.length === 0,
  };
  const result = { checks, movementDifferenceM, normal, accelerated,
    limitations: [COMBAT_ONLY?'Disposable saves equip a Wood Bow and ammunition for the stationary-target fixture.':'Disposable saves use one due-soon potato, a synthetic work wheel/energy spend, and the stationary-target bow fixture.',
      COMBAT_ONLY?'This invocation covers only the isolated Wood Bow case.':'Movement, GPS return, one crop stage, work completion, rest suppression, pause, and the isolated Wood Bow case are covered.',
      'The Wood Bow fixture freezes creature AI and uses a high-HP stationary slime; normal auto-fire, stick aiming, projectile flight, ammo and damage remain active.',
      'Hostile AI, enemy attacks, melee, moving-target combat, full crop lifecycle, resource economy, and long-session balance parity are not covered.'] };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ checks, movementDifferenceM, output: OUT }));
  assert.ok(Object.values(checks).every(Boolean), 'Clock browser parity failed; inspect output JSON');
})().catch(error => { console.error(error.message); process.exitCode = 1; })
  .finally(async () => { await browser?.close(); server.close(); });
