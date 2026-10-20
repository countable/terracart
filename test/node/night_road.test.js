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

test('night road: the MD/LG buffer is active only after dark', () => {
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

  for (const { depth } of WorldGen.FLOOR_PROFILES) {
    const cave = nightRoadScene(B | WorldGen.ROAD_CLASS_MAJOR_ROAD, { depth });
    assert.truthy(RoadSafety.nightRoadZone(cave, 15, 15, 0, 0), `depth ${depth}: night zone`);
    assert.falsy(RoadSafety.nightRoadZone(cave, 15, 15, 0, 1), `depth ${depth}: daytime open`);
    assert.truthy(RoadSafety.objectHidden(cave, object, true), `depth ${depth}: hidden object`);
    assert.truthy(RoadSafety.majorRoadAt(cave, 15, 15), `depth ${depth}: road warning`);
    const state = RoadSafety.playerState(cave, 0, 0);
    assert.truthy(state.nightZone && state.majorRoad, `depth ${depth}: warning and drain active`);
  }
  for (const depth of [WorldGen.SKY_DEPTH, WorldGen.ARENA_DEPTH]) {
    const scene = nightRoadScene(B | WorldGen.ROAD_CLASS_MAJOR_ROAD, { depth });
    assert.falsy(RoadSafety.nightRoadZone(scene, 15, 15, 0, 0), `depth ${depth}: no night zone`);
    assert.falsy(RoadSafety.objectHidden(scene, object, true), `depth ${depth}: objects visible`);
    assert.falsy(RoadSafety.playerState(scene, 0, 0).majorRoad, `depth ${depth}: no road warning`);
  }
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
  const live = Object.assign(new K(), nightRoadScene(WorldGen.ROAD_CLASS_MAJOR_BUFFER, { depth: 1 }));
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
  const scene = Object.assign(new K(), nightRoadScene(WorldGen.ROAD_CLASS_MAJOR_BUFFER, { depth: 1 }));
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
  const scene = Object.assign(new K(), nightRoadScene(WorldGen.ROAD_CLASS_MAJOR_ROAD, { depth: 2 }));
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
  assert.truthy(/_ringRoadSafety\[si\] = WorldGen\.nightZoneBits\(/.test(RENDER_SRC), 'red cover reads the shared night-zone predicate');
  assert.truthy(/roadSafetyGfx[\s\S]*?GROUND_COLOR[\s\S]*?GROUND_ALPHA/.test(RENDER_SRC), 'cover uses the owning palette');
  assert.truthy(/RoadSafety\.objectHidden\(scene, o, hideNightRoadObjects\)/.test(RENDER_SRC), 'object pass hides the zone');
  assert.truthy(/RoadSafety\.objectHidden\(scene, wp, hideNightRoadObjects\)/.test(RENDER_SRC), 'plant pass hides the zone');
  assert.truthy(/RoadSafety\.objectHidden\(scene, tr, hideNightRoadTreasure\)/.test(RENDER_SRC), 'treasure pass hides the zone');
  assert.truthy(/name: 'night-road-hidden'[\s\S]*?RoadSafety\.nightRoadZone/.test(INTERACT_SRC), 'cell tap stops after creature taps');
  assert.truthy(/RoadSafety\.objectHidden\(scene, item\)/.test(INTERACT_SRC), 'item lookup skips hidden records');
  assert.truthy(/letterContainer\.add\(this\.roadSafetyGfx\)/.test(SCENE_SRC), 'ground wash sits below later road letters and world sprites');
});

(function () {
  const N = 64, scale = 4096 / N;
  const road = (cls, pts, tags = {}) => ({ type: 2, tags: { class: cls, ...tags },
    geom: [pts.map(([x, y]) => ({ x: (x + 0.5) * scale, y: (y + 0.5) * scale }))] });
  const build = (...features) => WorldGen.rasterizeTile([{ name: 'transportation', features }], N, 0, 0, N * 7);
  const bits = (e, x, y) => e.roadClass[y * N + x];
  test('night road: parallel roadside paths clear only their side and length of the buffer', () => {
    const main = road('primary', [[4, 32], [60, 32]]);
    const path = road('path', [[12, 34], [48, 34]]);
    const e = build(main, path);
    assert.falsy(WorldGen.nightZoneBits(bits(e, 30, 34)), 'path side is safe');
    assert.truthy(bits(e, 30, 34) & WorldGen.ROAD_CLASS_MAJOR_BUFFER, 'creature suppression remains');
    assert.truthy(WorldGen.nightZoneBits(bits(e, 30, 30)), 'opposite side remains dark');
    assert.truthy(WorldGen.nightZoneBits(bits(e, 30, 32)), 'carriageway remains dark');
    assert.truthy(WorldGen.nightZoneBits(bits(e, 54, 34)), 'beyond the path remains dark');
    const reversed = build(main, road('path', [[48, 34], [12, 34]]));
    assert.eq([...e.roadClass].join(), [...reversed.roadClass].join(), 'path direction does not matter');
    const both = build(main, path, road('path', [[12, 30], [48, 30]]));
    assert.falsy(WorldGen.nightZoneBits(bits(both, 30, 30)), 'both path sides can be safe');
  });
  test('night road: crossings and separated paths do not clear roadside darkness', () => {
    const main = road('primary', [[4, 32], [60, 32]]);
    for (const path of [road('path', [[30, 4], [30, 60]]),
      road('path', [[12, 34], [48, 34]], { brunnel: 'bridge' }),
      road('path', [[12, 40], [48, 40]])]) {
      assert.truthy(WorldGen.nightZoneBits(bits(build(main, path), 30, 34)), 'no adjoining parallel path');
    }
    const privatePath = build(main, road('path', [[12, 34], [48, 34]], { access: 'private' }));
    assert.truthy(WorldGen.nightZoneBits(bits(privatePath, 30, 34)), 'private paths do not grant an exemption');
    const e = build(main, road('path', [[12, 34], [48, 34]]), road('secondary', [[32, 4], [32, 60]]));
    assert.truthy(WorldGen.nightZoneBits(bits(e, 30, 34)), 'another road retains its own dark buffer');
  });
})();
