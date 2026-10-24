// Standalone browser contract test: node test/qa-bridge.test.js
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright-core');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || '/usr/bin/chromium', headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<button id="normal">Inventory</button><button disabled id="disabled">Unavailable</button>
      <details id="menu"><summary>Menu</summary><button id="inside">Inside menu</button>
      <details id="devtools" open><summary>Developer</summary><button id="debug-grant">Grant all</button></details></details>
      <button id="reset-save">Reset</button><div style="opacity:0"><button id="transparent">Invisible</button></div>`);
    await page.addScriptTag({ path: path.resolve('tools/qa/bridge.js') });
    let observation = await page.evaluate(() => GameplayQA.observe());
    assert.equal(observation.ready, false, 'startup observation needs no game scene');
    assert.deepEqual(observation.controls.map(c => c.label), ['Inventory', 'Unavailable', 'Menu']);
    const normal = observation.controls.find(c => c.domId === 'normal').id;
    const disabled = observation.controls.find(c => c.domId === 'disabled').id;
    assert.equal((await page.evaluate(id => GameplayQA.activate(id), disabled)).ok, false);
    await page.evaluate(() => { document.getElementById('menu').open = true; });
    observation = await page.evaluate(() => GameplayQA.observe());
    assert.ok(observation.controls.some(c => c.domId === 'inside'));
    assert.ok(!observation.controls.some(c => /Developer|Grant|Reset|Invisible/.test(c.label)), 'debug and hidden controls stay excluded');
    await page.evaluate(() => document.getElementById('normal').remove());
    assert.equal((await page.evaluate(id => GameplayQA.activate(id), normal)).ok, false, 'stale control is rejected');
    await page.evaluate(() => {
      const modal = document.createElement('div');
      modal.className = 'game-modal'; modal.innerText = 'SUPPLIES Potato Seed ×9 tap to continue';
      modal.addEventListener('click', () => { window.dismissed = true; modal.remove(); });
      document.body.appendChild(modal);
    });
    observation = await page.evaluate(() => GameplayQA.observe());
    assert.equal(observation.controls.length, 1, 'modal blocks background controls');
    assert.equal(observation.controls[0].label, 'Tap to continue');
    await page.evaluate(id => GameplayQA.activate(id), observation.controls[0].id);
    assert.equal(await page.evaluate(() => window.dismissed), true, 'normal modal click handler ran');
    await page.evaluate(() => {
      for (const [id, z] of [['shop', 10], ['story', 20]]) {
        const modal = document.createElement('div'); modal.className = 'game-modal'; modal.id = id;
        modal.style.cssText = `position:fixed;inset:0;background:white;z-index:${z}`;
        modal.innerHTML = `<button>${id}</button>`; document.body.appendChild(modal);
      }
    });
    observation = await page.evaluate(() => GameplayQA.observe());
    assert.deepEqual(observation.controls.map(c => c.label), ['story'], 'an overlapping story blocks shop controls');
    await page.evaluate(() => document.querySelectorAll('.game-modal').forEach(el => el.remove()));

    await page.evaluate(() => {
      const pad = document.createElement('div'); pad.id = 'move-pad';
      pad.setAttribute('aria-label', 'Joystick'); pad.style.cssText = 'width:60px;height:60px;background:silver';
      window.padPointers = [];
      for (const type of ['pointerdown', 'pointerup']) pad.addEventListener(type, event => padPointers.push(event.type));
      document.body.appendChild(pad);
    });
    observation = await page.evaluate(() => GameplayQA.observe());
    const padControl = observation.controls.find(c => c.domId === 'move-pad');
    assert.ok(padControl, 'normal joystick control is exposed');
    assert.equal((await page.evaluate(id => GameplayQA.activate(id), padControl.id)).ok, true);
    assert.deepEqual(await page.evaluate(() => padPointers), ['pointerdown', 'pointerup'], 'activation follows the actual pad pointer handlers');
    await page.evaluate(() => document.getElementById('move-pad').remove());

    await page.evaluate(() => {
      window.bodyPosition = { x: .5, y: .5 };
      window.positionWrites = 0;
      const objects = [
        { id: 'home', kind: 'house', x: .5, y: .5, role: 'trailer' },
        { id: 'wreck', kind: 'house', x: 1.5, y: .5, role: 'wreck', secretShop: 'wizard' },
        { id: 'hidden', kind: 'chest', x: 2.5, y: .5, name: 'Secret chest' },
      ];
      window.WorldGen = { T: { GRASS: 0, WATER: 3 }, tileCache: new Map([['tile', { objects,
        wildplants: [{ id: 'crop', crop: 'potato', x: .5, y: 1.5 }], creatures: [] }]]) };
      window.Houses = { displayRole: (save, o) => o.role };
      window.cropName = crop => crop === 'potato' ? 'Potato' : crop;
      window.Fog = { seen: (tx, ty, ix) => ix < 2 };
      window.worldMetersToAbsCell = (s, x, y) => ({ cellIX: Math.floor(x), cellIY: Math.floor(y) });
      window.absCellOffset = (s, x, y, dx, dy) => ({ cellIX: x + dx, cellIY: y + dy });
      window.absCellDelta = (s, ax, ay, bx, by) => ({ dx: bx - ax, dy: by - ay });
      window.absCellCenterMeters = (s, x, y) => ({ x: x + .5, y: y + .5 });
      window.cellKeyFromAbsCell = (x, y) => `${x},${y}`;
      window.playerWorldM = s => ({ ...s.playerM });
      window.__scene = {
        save: { money: 0, energy: 100, inv: [], planted: [], fires: [], scarecrows: [] },
        playerM: new Proxy(bodyPosition, { set(target, key, value) { window.positionWrites++; target[key] = value; return true; } }),
        cellM: 1, viewLeft: 0, viewTop: 0, viewSize: 200, tilledSet: new Set(['0,0']),
        worldMetersToScreen: (x, y) => ({ x: 100 + x * 25, y: 100 + y * 25 }),
        cellAt: (x, y) => ({ tx: 0, ty: 0, ix: Math.floor(x), iy: Math.floor(y), type: x >= 2 ? 3 : 0, underRoad: x >= 2 }),
        _dialogOpen: () => !!document.querySelector('.game-modal'),
        _gpsAwayM: () => 0, events: { on(event, callback) { window.afterStep = callback; } },
        handleWorldTap(x, y) { window.lastTap = { x, y }; }, children: { list: [] },
      };
    });
    observation = await page.evaluate(() => GameplayQA.observe());
    assert.equal(observation.targets.find(t => t.id === 'objects:home').name, 'Home');
    assert.equal(observation.targets.find(t => t.id === 'objects:wreck').role, 'wreck');
    assert.equal(observation.targets.find(t => t.id === 'wildplants:crop').name, 'Potato');
    assert.ok(!JSON.stringify(observation).includes('Secret chest'), 'fog hides object identity');
    const unknown = observation.cells.find(c => c.dx === 2 && c.dy === 0);
    assert.equal(unknown.terrain, 'unexplored');
    assert.equal(unknown.road, undefined, 'fog hides road type');
    assert.equal(unknown.tilled, undefined, 'fog hides cultivation state');
    assert.equal((await page.evaluate(id => GameplayQA.interact(id), unknown.id)).ok, false);
    assert.equal((await page.evaluate(() => GameplayQA.interact('objects:home'))).ok, true);
    assert.ok(await page.evaluate(() => window.lastTap), 'interaction uses the normal tap entrypoint');
    await page.evaluate(() => WorldGen.tileCache.get('tile').objects.shift());
    assert.equal((await page.evaluate(() => GameplayQA.interact('objects:home'))).ok, false, 'removed target cannot be tapped');

    const before = await page.evaluate(() => ({ ...bodyPosition }));
    await page.evaluate(() => { window.CompassModules = { isActive: () => false }; });
    const inactive = await page.evaluate(() => GameplayQA.beginMove('east'));
    assert.equal(inactive.ok, false, 'an inactive joystick fails immediately');
    assert.match(inactive.error, /Activate the joystick/);
    assert.equal(await page.evaluate(() => GameplayQA.movement().active), false);
    await page.evaluate(() => { CompassModules.isActive = () => true; });
    const move = await page.evaluate(() => GameplayQA.beginMove('east'));
    assert.equal(move.active, true);
    assert.deepEqual(move.destination, { cellIX: 1, cellIY: 0 });
    assert.deepEqual(await page.evaluate(() => ({ ...bodyPosition })), before, 'starting movement never teleports');
    assert.equal(await page.evaluate(() => __scene._movePadHeld), true);
    await page.evaluate(() => { bodyPosition.x = 1.05; afterStep(); });
    const stopped = await page.evaluate(() => GameplayQA.movement());
    assert.equal(stopped.active, false);
    assert.equal(stopped.reason, 'arrived');
    assert.equal(await page.evaluate(() => __scene._movePadHeld), false);
    assert.equal(await page.evaluate(() => positionWrites), 0, 'bridge never writes player position');
    // A slide may cross the other axis before the requested cell is reached.
    await page.evaluate(() => GameplayQA.beginMove('south'));
    await page.evaluate(() => { bodyPosition.x = 2.05; bodyPosition.y = .9; afterStep(); });
    const slid = await page.evaluate(() => GameplayQA.movement());
    assert.equal(slid.active, false, 'one adjacent cell crossing releases the stick even after sliding');
    assert.equal(slid.reason, 'cell-crossed');
    assert.equal(await page.evaluate(() => __scene._movePadHeld), false);
    await page.evaluate(() => { window.savedNow = Date.now; window.testNow = Date.now(); Date.now = () => testNow; });
    const blockedPosition = await page.evaluate(() => ({ ...bodyPosition }));
    await page.evaluate(() => { GameplayQA.beginMove('east'); testNow += 1999; afterStep(); });
    assert.equal(await page.evaluate(() => GameplayQA.movement().active), true);
    await page.evaluate(() => { testNow++; afterStep(); });
    assert.equal(await page.evaluate(() => GameplayQA.movement().reason), 'blocked');
    assert.deepEqual(await page.evaluate(() => ({ ...bodyPosition })), blockedPosition, 'blocked input does not rescue or move the player');
    await page.evaluate(() => {
      GameplayQA.beginMove('east'); testNow += 1500; bodyPosition.x += .1; afterStep();
      testNow += 1500; bodyPosition.x += .1; afterStep();
    });
    assert.equal(await page.evaluate(() => GameplayQA.movement().active), true, 'slow real progress resets the blocked timer');
    await page.evaluate(() => { GameplayQA.stopMove(); Date.now = savedNow; });
    assert.equal(await page.evaluate(() => positionWrites), 0, 'movement monitoring never writes position');
    await page.evaluate(() => {
      __scene._workProgress = { durationMs: 3000, startT: performance.now(), toolSlot: 'net' };
      GameplayQA.beginMove('east'); bodyPosition.x = 3.05; afterStep();
    });
    assert.equal(await page.evaluate(() => GameplayQA.movement().reason), 'arrived', 'game-permitted movement is monitored during ongoing work');
    assert.equal(await page.evaluate(() => __scene._workProgress.toolSlot), 'net', 'the bridge does not cancel or finish work');
    await page.evaluate(() => { __scene._workProgress = { durationMs: 3000, startT: performance.now() - 1000, toolSlot: 'axe' }; });
    const work = (await page.evaluate(() => GameplayQA.observe())).work;
    assert.ok(work.remainingMs > 1800 && work.remainingMs <= 2000);
    assert.equal(work.tool, 'axe');
    console.log('QA bridge contracts passed');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
