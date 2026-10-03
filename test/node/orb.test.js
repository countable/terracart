const orbMethodStart = APP_JS_SRC.indexOf('\n  useOrb() {');
const orbMethodEnd = APP_JS_SRC.indexOf('\n  }\n', orbMethodStart);
function orbActionFor(plants, rocks) {
  const world = { forEachItemNear(kind, tx, ty, visit) {
    for (const o of kind === 'wildplants' ? plants : rocks) visit(o);
  } };
  return new Function('WorldGen', 'return ({' + APP_JS_SRC.slice(orbMethodStart, orbMethodEnd + 4) + '}).useOrb')(world);
}
function orbFixture() {
  const plants = [], rocks = [];
  for (let i = 0; plants.length < 4 || rocks.length < 4; i++) {
    const id = `orb_secret_${i}`;
    if (plants.length < 4 && isNestBush('shrub', id)) plants.push({ id, crop: 'shrub', kind: 'wildplant', x: 0, y: 0 });
    const rock = { id: `rock_${id}`, kind: 'mineralrock', yieldTier: 1, x: 0, y: 0 };
    if (rocks.length < 4 && isGlintRock(rock)) rocks.push(rock);
  }
  const scene = {
    save: { inv: [{ id: 'orb', count: 1 }], selSlot: 0, picked: [plants[1].id] },
    brokenRockSet: new Set([rocks[1].id]),
    playerToWorldCell: () => ({ tx: 0, ty: 0 }),
    startWorldM: { x: 0, y: 0 }, playerM: { x: 0, y: 0 }, cellM: CELL_PX,
    viewLeft: 0, viewTop: 0, viewSize: 100, viewCenterX: 50, viewCenterY: 50,
    flash(message) { this.message = message; },
    flashAtPlayer(message) { this.message = message; },
    _selectedConsumable(id) { const sel = this.save.inv[this.save.selSlot]; return sel && sel.id === id && sel.count > 0 ? sel : null; },
  };
  plants[2].x = 1000; rocks[2].y = -1000;
  plants[3].crop = 'flowers'; rocks[3].yieldTier = 2;
  return { plants, rocks, scene, use: orbActionFor(plants, rocks) };
}
test('orb reveals only visible unspent secret bushes and rocks without consuming itself', () => {
  const { plants, rocks, scene, use } = orbFixture();
  const before = JSON.stringify(scene.save);
  assert.eq(use.call(scene), true);
  assert.eq(scene._orbReveal.size, 2);
  assert.truthy(scene._orbReveal.has(plants[0].id));
  assert.truthy(scene._orbReveal.has(rocks[0].id));
  assert.eq(JSON.stringify(scene.save), before, 'no inventory or reward ledger changes');
  assert.eq(use.call(scene), true, 'orb can be reused immediately');
  assert.eq(scene.save.inv[0].count, 1);
  scene.save.inv[0].count = 0;
  assert.eq(use.call(scene), false, 'empty stack cannot reveal');
  scene.save.inv[0] = { id: 'telescope', count: 1 };
  assert.eq(use.call(scene), false, 'must select the orb');
});
test('orb follows the peek camera when deciding which secrets are onscreen', () => {
  const { plants, rocks, scene, use } = orbFixture();
  scene.peekM = { x: 1000, y: 0 };
  use.call(scene);
  assert.eq(scene._orbReveal.size, 1);
  assert.truthy(scene._orbReveal.has(plants[2].id), 'peeked bush revealed');
  assert.falsy(scene._orbReveal.has(plants[0].id), 'offscreen player-area bush excluded');
  assert.falsy(scene._orbReveal.has(rocks[0].id), 'offscreen player-area rock excluded');
});
test('orb starts each existing cue immediately then resumes its natural beat', () => {
  const { plants, rocks, scene, use } = orbFixture();
  use.call(scene);
  for (const [o, phase, duration] of [[plants[0], nestBushPhase, NEST_BUSH_BEAT.showMs], [rocks[0], glintRockPhase, GLINT_ROCK_SHOW_MS]]) {
    const started = scene._orbReveal.get(o.id);
    assert.eq(phase(o.id, started, started), 0, 'cue starts now');
    assert.eq(phase(o.id, started + duration / 2, started), 0.5, 'existing cue animation progresses');
    for (const dt of [duration, duration + 1, 30000, 60000]) {
      assert.eq(phase(o.id, started + dt, started), phase(o.id, started + dt), 'natural beat resumes');
    }
  }
  assert.truthy(/nestBushPhase\(p\.wildId, _plantNow, scene\._orbReveal\?\.get\(p\.wildId\)\)/.test(RENDER_SRC), 'bush renderer receives forced cue');
  assert.truthy(/glintRockPhase\(it\.o\.id, _sparkNow, scene\._orbReveal\?\.get\(it\.o\.id\)\)/.test(RENDER_SRC), 'rock renderer receives forced cue');
});
test('orb does not reveal ordinary objects whose ids pass the glint hash', () => {
  const { rocks, scene } = orbFixture();
  const ordinary = ['tree', 'house'].map(kind => ({ ...rocks[0], kind }));
  const use = orbActionFor([], ordinary);
  assert.eq(use.call(scene), true);
  assert.eq(scene._orbReveal.size, 0, 'only mineral rocks can reveal a rock secret');
});


test('orb marks unopened visible chests and crates, never opened or offscreen treasure or service POIs', () => {
  const { scene } = orbFixture();
  const chest = id => ({ id, kind: 'chest', poiClass: 'park', poiDensity: 1, depth: 1, x: 0, y: 0 });
  const live = chest('treasure_live'), crate = { ...chest('treasure_crate'), crate: true };
  const opened = chest('treasure_opened');
  const left = { ...chest('treasure_left'), x: -1000 };
  const right = { ...chest('treasure_right'), x: 1000 };
  const up = { ...chest('treasure_up'), y: -1000 };
  const down = { ...chest('treasure_down'), y: 1000 };
  const service = { ...chest('service'), _chestLook: { texKey: 'market_stand' } };
  scene.save.opened = [opened.id];
  const before = JSON.stringify(scene.save);
  const use = orbActionFor([], [live, crate, opened, left, right, up, down, service]);
  assert.eq(use.call(scene), true);
  assert.eq([...scene._orbReveal.keys()].sort().join(), 'treasure_crate,treasure_live');
  assert.eq(JSON.stringify(scene.save), before, 'no opening, loot grant or item consumption');
  use.call(scene);
  assert.eq(scene.save.inv[0].count, 1, 'repeated reveal keeps reusable orb');
  scene.save.opened.push(live.id);
  use.call(scene);
  assert.falsy(scene._orbReveal.has(live.id), 'opened chest cannot be revealed again');
  assert.truthy(scene._orbReveal.has(crate.id));
});

test('orb chest reveal uses the peek view and only the current snapshot', () => {
  const { scene } = orbFixture();
  const near = { id: 'near_chest', kind: 'chest', depth: 1, poiDensity: 1, x: 0, y: 0 };
  const peeked = { ...near, id: 'peeked_chest', x: 1000 };
  const use = orbActionFor([], [near, peeked]);
  scene.peekM = { x: 1000, y: 0 };
  use.call(scene);
  assert.truthy(scene._orbReveal.has(peeked.id));
  assert.falsy(scene._orbReveal.has(near.id));
  scene.peekM = null;
  assert.falsy(scene._orbReveal.has(near.id), 'moving the camera does not add a new chest');
});

test('orb chest marker is visible immediately, expires, and stops when the chest is opened', () => {
  const start = RENDER_SRC.indexOf('function orbChestRevealPhase(');
  const end = RENDER_SRC.indexOf('\n}', start) + 2;
  const phase = new Function(RENDER_SRC.slice(start, end) + ';return orbChestRevealPhase;')();
  const o = { id: 'chest_phase', kind: 'chest', depth: 1, poiDensity: 1, x: 0, y: 0 };
  const reveals = new Map([[o.id, 1000]]), sets = { ...spentSets(null, {}), opened: new Set() };
  const duration = CONSUMABLE_SPEC.orb.chestRevealMs;
  assert.eq(phase(o, reveals, 1000, sets), 0);
  assert.eq(phase(o, reveals, 1000 + duration / 2, sets), 0.5);
  assert.eq(phase(o, reveals, 1000 + duration, sets), -1);
  assert.eq(phase(o, reveals, 999, sets), -1);
  assert.eq(phase({ ...o, id: 'unseen_chest' }, reveals, 1000, sets), -1);
  sets.opened.add(o.id);
  assert.eq(phase(o, reveals, 1001, sets), -1, 'opening cancels an existing marker');
  assert.truthy(RENDER_SRC.includes('orbChestRevealPhase(it.o, scene._orbReveal, _sparkNow, spentIds)'),
    'live renderer reads the captured reveal and current opened ledger');
  assert.truthy(RENDER_SRC.includes('glint: chestPhase, orbChest: true'),
    'marker uses the renderer-independent sparkle lane, including WebGL');
});
