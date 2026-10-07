function nightRoadScene(bits, { depth = 0 } = {}) {
  WorldGen.tileCache.clear();
  const N = 4, tileEdgeM = 40;
  const roadClass = new Uint8Array(N * N);
  roadClass[1 * N + 1] = bits;
  WorldGen.tileCache.set(WorldGen.tileKey(0, 0), { cellsPerEdge: N, roadClass });
  return {
    depth,
    tileEdgeM,
    cellsPerTile: N,
    startWorldM: { x: 0, y: 0 },
    originPx: { x: 0, y: 0 },
    mPerPx: tileEdgeM / WorldGen.TILE_PX,
    playerM: { x: 15, y: 15 },
    save: { energy: 10, storySeen: {} },
  };
}

function liftedRoadSafetyClass() {
  const start = SCENE_SRC.indexOf('\n  _tickRoadSafety(dt, now = Date.now()) {');
  const end = SCENE_SRC.indexOf('\n  }\n', start);
  assert.gte(start, 0, '_tickRoadSafety ships');
  return new Function(`return class {${SCENE_SRC.slice(start, end + 4)}}`)();
}

function withDaylight(value, fn) {
  const old = globalThis.__DAYLIGHT;
  globalThis.__DAYLIGHT = value;
  try { return fn(); }
  finally {
    if (old == null) delete globalThis.__DAYLIGHT;
    else globalThis.__DAYLIGHT = old;
  }
}

test('night road: the MD/LG buffer is active only after dark on the surface', () => {
  const B = WorldGen.ROAD_CLASS_MAJOR_BUFFER;
  const V = WorldGen.ROAD_CLASS_MAJOR_VERGE;
  const scene = nightRoadScene(B);
  assert.truthy(RoadSafety.nightRoadZone(scene, 15, 15, 0, 0.49), 'buffer at night');
  assert.falsy(RoadSafety.nightRoadZone(scene, 15, 15, 0, 0.5), 'horizon is not night');
  assert.falsy(RoadSafety.nightRoadZone(scene, 15, 15, 0, 1), 'day');

  const object = { x: 15, y: 15 };
  assert.truthy(RoadSafety.objectHidden(scene, object, true), 'buffer object hidden');
  assert.falsy(RoadSafety.objectHidden(scene, object, false), 'day object visible');

  const verge = nightRoadScene(V);
  assert.falsy(RoadSafety.nightRoadZone(verge, 15, 15, 0, 0), 'plain verge stays open');
  assert.falsy(RoadSafety.objectHidden(verge, object, true), 'plain verge object stays visible');

  const cave = nightRoadScene(B, { depth: 1 });
  assert.falsy(RoadSafety.nightRoadZone(cave, 15, 15, 0, 0), 'underground road mirror is not a safety zone');
});

test('night road: fractional exposure banks whole pips and app spends through Energy.set', () => {
  const scene = nightRoadScene(WorldGen.ROAD_CLASS_MAJOR_BUFFER);
  assert.eq(RoadSafety.drainPips(scene, 1, true), 0, 'first half pip stays banked');
  assert.eq(RoadSafety.drainPips(scene, 1, true), 1, 'second half pays one pip');
  assert.eq(scene._nightRoadDrainAccum, 0, 'no residue after a whole pip');
  assert.eq(RoadSafety.drainPips(scene, 0.5, true), 0, 'partial exposure starts');
  assert.eq(RoadSafety.drainPips(scene, 0, false), 0, 'leaving pays nothing');
  assert.eq(scene._nightRoadDrainAccum, 0, 'leaving drops the partial pip');

  const K = liftedRoadSafetyClass();
  const live = Object.assign(new K(), nightRoadScene(WorldGen.ROAD_CLASS_MAJOR_BUFFER));
  live._bootOverlayGone = true;
  live._storySplashOnce = () => false;
  live._showSafetyCard = () => {};
  live._bankDrain = (lane, delta) => { live.bank = { lane, delta }; };
  live._losePlayerEnergy = (amount) => {
    const before = live.save.energy;
    Energy.set(live.save, before - amount);
    return before - live.save.energy;
  };
  withDaylight(0, () => {
    live._tickRoadSafety(1, Date.UTC(2026, 0, 1));
    live._tickRoadSafety(1, Date.UTC(2026, 0, 1));
  });
  assert.eq(live.save.energy, 9, 'one whole pip spent');
  assert.eq(live.bank.lane, 'nightroad');
  assert.eq(live.bank.delta, -1);
  const body = SCENE_SRC.match(/\n  _tickRoadSafety\(dt, now = Date\.now\(\)\) \{([\s\S]*?)\n  \}\n/)[1];
  assert.truthy(/RoadSafety\.drainPips\(this, dt, state\.nightZone\)/.test(body), 'shared fractional bank');
  assert.truthy(/this\._losePlayerEnergy\(pips\)/.test(body), 'Energy.set lane');
});

test('night road: the story panel is once per save with exact safety copy', () => {
  const K = liftedRoadSafetyClass();
  const scene = Object.assign(new K(), nightRoadScene(WorldGen.ROAD_CLASS_MAJOR_BUFFER));
  scene._bootOverlayGone = true;
  scene._bankDrain = () => {};
  scene._losePlayerEnergy = () => 0;
  scene._showSafetyCard = () => {};
  let shown = 0;
  scene._storySplashOnce = (key, row) => {
    if (scene.save.storySeen[key]) return false;
    scene.save.storySeen[key] = 1;
    shown++;
    assert.eq(row.body, "Major roads at night are dangerous. It's best you ascend (turn off device) to avoid energy drain and accidents.");
    return true;
  };
  withDaylight(0, () => {
    scene._tickRoadSafety(0, Date.UTC(2026, 0, 1));
    scene._tickRoadSafety(0, Date.UTC(2026, 0, 1));
  });
  assert.eq(shown, 1);
  assert.eq(scene.save.storySeen['road:night'], 1);
});

test('night road: majority-covered carriageway warning is once per UTC day', () => {
  const K = liftedRoadSafetyClass();
  const scene = Object.assign(new K(), nightRoadScene(WorldGen.ROAD_CLASS_MAJOR_ROAD));
  scene._bootOverlayGone = true;
  scene._bankDrain = () => {};
  scene._losePlayerEnergy = () => 0;
  scene._storySplashOnce = () => false;
  const cards = [];
  scene._showSafetyCard = which => cards.push(which);
  const day = Date.UTC(2026, 0, 2, 12);
  withDaylight(1, () => {
    scene._tickRoadSafety(0, day);
    scene._tickRoadSafety(0, day + 1000);
  });
  assert.eq(cards.join(','), 'road');
  assert.truthy(Macros.usedToday(scene.save, 'safety:roadstand', day));
  assert.eq(RoadSafety.ROAD_WARNING.lines[0], 'Do not play when standing on the road.');
  assert.truthy(/RoadSafety\.NIGHT_DAYLIGHT/.test(SCENE_SRC), 'dusk card shares the horizon');
});

test('night road: rendering and taps share the hidden-object predicate', () => {
  assert.truthy(/_ringRoadSafety[\s\S]*?ROAD_CLASS_MAJOR_BUFFER/.test(RENDER_SRC), 'red cover reads every buffer cell');
  assert.truthy(/roadSafetyGfx[\s\S]*?GROUND_COLOR[\s\S]*?GROUND_ALPHA/.test(RENDER_SRC), 'cover uses the owning palette');
  assert.truthy(/RoadSafety\.objectHidden\(scene, o, hideNightRoadObjects\)/.test(RENDER_SRC), 'object pass hides the zone');
  assert.truthy(/RoadSafety\.objectHidden\(scene, wp, hideNightRoadObjects\)/.test(RENDER_SRC), 'plant pass hides the zone');
  assert.truthy(/RoadSafety\.objectHidden\(scene, tr, hideNightRoadTreasure\)/.test(RENDER_SRC), 'treasure pass hides the zone');
  assert.truthy(/name: 'night-road-hidden'[\s\S]*?RoadSafety\.nightRoadZone/.test(INTERACT_SRC), 'cell tap stops after creature taps');
  assert.truthy(/RoadSafety\.objectHidden\(scene, item\)/.test(INTERACT_SRC), 'item lookup skips hidden records');
  assert.truthy(/letterContainer\.add\(this\.roadSafetyGfx\)/.test(SCENE_SRC), 'ground wash sits below later road letters and world sprites');
});
