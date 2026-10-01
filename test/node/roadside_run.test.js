// THE ROADSIDE RUN (creature_ai.js roadsideRunAngle): a retreat among houses
// runs along the street, on the retreating creature's own side, never into a
// yard. Unit checks on a synthetic residential street, then the REAL
// wanderCreatures (run.js __wander) driving a deer that bolts from a player
// standing between it and the road.
(function () {
const CELL = 7, N = 64, EDGE = N * CELL;
const T = WorldGen.T, W = WorldGen.SPAWN_WHY;
const ROAD_COL = 20;              // a north–south residential street
const YARD_COL = 25;              // everything east of here is behind the houses
const at = (col, row) => ({ x: (col + 0.5) * CELL, y: (row + 0.5) * CELL });
const colOf = (c) => Math.floor(c.x / CELL), rowOf = (c) => Math.floor(c.y / CELL);
function street({ lot = true, road = true, yard = true } = {}) {
  const grid = new Uint8Array(N * N).fill(lot ? T.RESIDENTIAL : T.GRASS);
  const roadMask = new Uint8Array(N * N), spawnWhy = new Uint16Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x;
    if (road && x === ROAD_COL) { grid[i] = T.ROAD; roadMask[i] = 1; }
    if (yard && x >= YARD_COL) spawnWhy[i] = W.BEHIND_HOUSE;
  }
  return { cellsPerEdge: N, grid, roadMask, spawnWhy, roadClass: new Uint8Array(N * N), creatures: [] };
}
function withTile(entry, fn) {
  const realGet = WorldGen.tileCache.get;
  WorldGen.tileCache.get = (k) => (k === WorldGen.tileKey(0, 0) ? entry : undefined);
  try { return fn(); } finally { WorldGen.tileCache.get = realGet; }
}
const withRandom = (v, fn) => { const r = Math.random; Math.random = () => v; try { return fn(); } finally { Math.random = r; } };
const scene = () => ({ cellM: CELL, tileEdgeM: EDGE, depth: 0 });
const deg = (a) => ((a * 180 / Math.PI) % 360 + 360) % 360;

test('roadside run: between houses, away from the player bends onto the street, on the creature\'s side', () => {
  withTile(street(), () => withRandom(0.5, () => {
    const c = at(22, 30);                                   // two cells east of the street
    const east = roadsideRunAngle(scene(), c, 0);           // "away" points straight at the yards
    assert.truthy(east != null, 'a street within reach bends the retreat');
    assert.lt(Math.abs(Math.cos(east)), 0.5, 'the run is along the street (north or south), not across the yards');
    const ne = roadsideRunAngle(scene(), c, -Math.PI / 4);
    assert.inRange(deg(ne), 180, 360, 'away to the north-east: the run takes the northward way');
    const se = roadsideRunAngle(scene(), c, Math.PI / 4);
    assert.inRange(deg(se), 0, 180, 'away to the south-east: the southward way');
    // Aimed up the verge on the EAST side (the creature's), not across the road.
    const target = { x: c.x + Math.cos(se) * 3 * CELL, y: c.y + Math.sin(se) * 3 * CELL };
    assert.gt(target.x, (ROAD_COL + 1) * CELL, 'stays on its own side of the street');
    // Deep in a yard (as far as the run looks) it first comes OUT to the roadside.
    const deep = at(ROAD_COL + 4, 30);
    const out = roadsideRunAngle(scene(), deep, 0);
    assert.truthy(out != null && Math.cos(out) < 0, 'a creature behind the houses heads back toward the street');
  }));
});

test('roadside run: open ground, no street near, or underground keeps the plain away angle', () => {
  withTile(street({ lot: false, yard: false }), () => {
    assert.eq(roadsideRunAngle(scene(), at(22, 30), 0), null, 'not among houses: no bend');
  });
  withTile(street({ road: false }), () => {
    assert.eq(roadsideRunAngle(scene(), at(22, 30), 0), null, 'no street within reach: no bend');
  });
  withTile(street(), () => {
    assert.eq(roadsideRunAngle({ ...scene(), depth: 3 }, at(22, 30), 0), null, 'caves have no streets');
    assert.eq(roadsideRunAngle(scene(), at(40, 30), 0), null, 'the street is more than four cells off');
    assert.eq(yardReasonAt(scene(), at(26, 30).x, at(26, 30).y), W.BEHIND_HOUSE, 'the yard reads the spawn gate\'s own reason');
    assert.eq(yardReasonAt(scene(), at(22, 30).x, at(22, 30).y), 0);
  });
});

// The REAL loop: a deer between the street and the houses, the player on the
// pavement beside it. Away from the player is straight into the yards.
function mkScene(entry, creature, feet) {
  const s = {
    cellM: CELL, depth: 0, tileEdgeM: EDGE,
    save: { energy: 1e6, money: 1e6, inv: [], caught: [], armor: {}, planted: [], fires: [], released: [], reachUpgrades: 0 },
    startWorldM: { x: 0, y: 0 }, playerM: { x: feet.x, y: feet.y }, feetOffsetM: 0,
    _starterTrailAnchor: () => ({ x: -1e6, y: 0 }),
    originPx: { x: 0, y: 0 }, mPerPx: CELL, cellsPerTile: WorldGen.TILE_PX,
    viewCenterX: 0, viewCenterY: 0, _shots: [], _laid: 0,
    isShadowActive: () => false,
    isUnnoticed() { return false; },
    homeWorldPos: () => null, _castleWardPoints: () => [],
    playerToWorldCell: () => ({ tx: 0, ty: 0, ix: 0, iy: 0 }),
    cellAt: (x, y) => {
      const ix = Math.floor(x / CELL), iy = Math.floor(y / CELL);
      const inside = ix >= 0 && iy >= 0 && ix < N && iy < N;
      return { loaded: inside, type: inside ? entry.grid[iy * N + ix] : 0, underRoad: inside && !!entry.roadMask[iy * N + ix], tx: 0, ty: 0, ix, iy };
    },
    _cellBlocked: () => false, _nearAny: () => false, placedRockSet: null,
    _damageEnemy: () => false, resolveDefeat: () => {},
    _popEnergy: () => {}, _warnIfTiring: () => {}, _flashPlayerHit: () => {}, _closeShopOnHit: () => {},
    _losePlayerEnergy: () => 0, _trapperLay() { this._laid++; }, _losePlayerToThief: () => 0,
    _cropRaidable: () => false,
    updateEnergyDOM: () => {}, flash: () => {}, _wildCrowTick: () => {},
  };
  s.creatures = [creature];
  return s;
}
function run(entry, creature, feet, seconds) {
  const s = mkScene(entry, creature, feet);
  const realNear = WorldGen.forEachItemNear, realNow = performance.now;
  const trace = [];
  WorldGen.forEachItemNear = (what, tx, ty, fn) => { if (what === 'creatures') for (const c of s.creatures.slice()) fn(c, 0, 0); };
  try {
    withTile(entry, () => {
      for (let ms = 0; ms < seconds * 1000; ms += 100) {
        const t = 1e6 + ms;
        performance.now = () => t;
        __wander.call(s);
        trace.push({ col: colOf(creature), row: rowOf(creature) });
      }
    });
  } finally { WorldGen.forEachItemNear = realNear; performance.now = realNow; }
  return trace;
}

test('roadside run: a deer bolting between houses runs the verge, never into the yards behind them', () => {
  const entry = street();
  const deer = { kind: 'deer', id: 'deer_0_0_1', x: at(22, 30).x, y: at(22, 30).y };
  const trace = run(entry, deer, at(21, 30), 25);
  assert.falsy(trace.some((p) => p.col >= YARD_COL), 'never behind the houses');
  assert.falsy(trace.some((p) => p.col <= ROAD_COL), 'never onto or across the street');
  assert.gte(Math.max(...trace.map((p) => Math.abs(p.row - 30))), 4, 'it ran ALONG the street');
  assert.lte(Math.max(...trace.map((p) => p.col)) - ROAD_COL, 4, 'and kept to the roadside');
});

test('roadside run: without the rule\'s ground — open grass — the same deer bolts straight away', () => {
  const entry = street({ lot: false, yard: false, road: false });
  const deer = { kind: 'deer', id: 'deer_0_0_1', x: at(22, 30).x, y: at(22, 30).y };
  const trace = run(entry, deer, at(21, 30), 10);
  assert.truthy(trace.some((p) => p.col >= YARD_COL), 'on open ground away from the player is simply east');
});
})();
