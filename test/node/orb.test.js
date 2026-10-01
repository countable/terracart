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
  for (const [o, phase, duration] of [[plants[0], nestBushPhase, 900], [rocks[0], glintRockPhase, 700]]) {
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
  const ordinary = ['tree', 'chest', 'house'].map(kind => ({ ...rocks[0], kind }));
  const use = orbActionFor([], ordinary);
  assert.eq(use.call(scene), true);
  assert.eq(scene._orbReveal.size, 0, 'only mineral rocks can reveal a rock secret');
});
