// Road junction safety zones use the same generated road geometry for the
// spawn gate and creature movement. Wide MD/LG junctions are hard exclusions;
// Small-road junctions suppress fast movers and player-facing hazards.
(function () {
const W = WorldGen;
const T = W.T;
const N = 64;
const CELL_M = 7;
const EDGE_M = N * CELL_M;
const EXTENT = 4096;
const MVT_PER_CELL = EXTENT / N;
const point = (x, y) => ({ x: (x + 0.5) * MVT_PER_CELL, y: (y + 0.5) * MVT_PER_CELL });
const line = (cells) => cells.map(([x, y]) => point(x, y));
const ring = (cells) => line(cells);
const whole = () => ring([[0, 0], [N - 1, 0], [N - 1, N - 1], [0, N - 1], [0, 0]]);
const grass = () => ({ name: 'landcover', features: [
  { type: 3, tags: { class: 'grass', subclass: 'grass' }, geom: [whole()] },
] });
const road = (cls, cells, tags = {}) => ({ type: 2, tags: { class: cls, ...tags }, geom: [line(cells)] });
const build = (...features) => W.rasterizeTile([
  grass(), { name: 'transportation', features },
], N, 0, 0, EDGE_M);
const idx = (x, y) => y * N + x;
const bits = (entry, x, y) => entry.roadClass[idx(x, y)] || 0;

// Crossing at the centre of cell 32,32. The diagonal offset cell 34,34 is
// beyond both bands but inside their overlap radius plus the two-cell buffer.
test('road junctions: an MD/LG crossing stamps a hard two-cell exclusion', () => {
  const e = build(
    road('primary', [[4, 32], [60, 32]]),
    road('secondary', [[32, 4], [32, 60]]),
  );
  const x = 34, y = 34, i = idx(x, y);
  assert.truthy(bits(e, x, y) & W.ROAD_CLASS_JUNCTION_EXCLUDE, 'two cells beyond the overlap is excluded');
  assert.falsy(e.roadMask[i], 'the buffer cell is off both road bands');
  assert.truthy(e.spawnWhy[i] & W.SPAWN_WHY.JUNCTION, 'the road class becomes the hard spawn reason');
  assert.falsy(W.isSpawnCell(e.grid, N, N, x, y, { roadClass: e.roadClass }, 'minor'),
    'the gate fallback also reads the hard road-class bit');
  for (const cls of W.SPAWN_CLASSES) {
    assert.falsy(W.isSpawnCell(e.grid, N, N, x, y, W.spawnOptsOf(e), cls), `${cls}: hard junction exclusion`);
  }
});

test('road junctions: an MD/LG road meeting a Small road is a full exclusion', () => {
  const e = build(
    road('primary', [[4, 32], [60, 32]]),
    road('minor', [[32, 4], [32, 60]]),
  );
  assert.truthy(bits(e, 34, 34) & W.ROAD_CLASS_JUNCTION_EXCLUDE, 'a Major-to-Small meeting uses the wide rule');
  assert.truthy(e.spawnWhy[idx(34, 34)] & W.SPAWN_WHY.JUNCTION, 'the meeting is hard-refused');
});

test('road junctions: a Small-road crossing suppresses fast movers and hazards', () => {
  const e = build(
    road('minor', [[4, 32], [60, 32]]),
    road('street', [[32, 4], [32, 60]]),
  );
  const x = 33, y = 33, i = idx(x, y), opts = W.spawnOptsOf(e);
  assert.truthy(bits(e, x, y) & W.ROAD_CLASS_JUNCTION_SOFT, 'one-cell diagonal buffer is suppressed');
  assert.falsy(bits(e, x, y) & W.ROAD_CLASS_JUNCTION_EXCLUDE, 'Small x Small is not hard');
  assert.falsy(e.roadMask[i], 'the suppression cell is off both road bands');
  assert.truthy(e.spawnWhy[i] & W.SPAWN_WHY.JUNCTION_SOFT, 'the road class becomes the typed spawn reason');
  assert.falsy(W.isSpawnCell(e.grid, N, N, x, y, { roadClass: e.roadClass }, 'hazard'),
    'the gate fallback also reads the typed road-class bit');
  assert.truthy(W.isSpawnCell(e.grid, N, N, x, y, { roadClass: e.roadClass }, 'enemy'),
    'the fallback keeps classes whose rows omit the typed reason');
  for (const cls of ['fastEnemy', 'fastFauna', 'hazard']) {
    assert.falsy(W.isSpawnCell(e.grid, N, N, x, y, opts, cls), `${cls}: refuses the Small-road junction`);
  }
  for (const cls of ['minor', 'fauna', 'npc', 'enemy']) {
    assert.truthy(W.isSpawnCell(e.grid, N, N, x, y, opts, cls), `${cls}: typed reason is not in its row`);
  }
});

test('road junctions: a near T-junction joins separately clipped ways', () => {
  const e = build(
    road('secondary', [[4, 32], [60, 32]]),
    road('minor', [[32, 5], [32, 31.75]]),
  );
  assert.truthy(bits(e, 32, 32) & W.ROAD_CLASS_JUNCTION_EXCLUDE,
    'an endpoint within half a cell of the main road stamps their meeting');
});

test('road junctions: grade-separated roads do not stamp a ground junction', () => {
  const e = build(
    road('primary', [[4, 32], [60, 32]], { brunnel: 'bridge' }),
    road('minor', [[32, 4], [32, 60]]),
  );
  const b = bits(e, 32, 32);
  assert.falsy(b & W.ROAD_CLASS_JUNCTION_EXCLUDE, 'the bridge crossing has no exclusion disk');
  assert.falsy(b & W.ROAD_CLASS_JUNCTION_SOFT, 'the bridge crossing has no soft disk');
});

test('road junctions: ROAD_CLASS_MAJOR_ROAD uses the half-covered threshold', () => {
  const xMvt = 20 * MVT_PER_CELL;
  const e = W.rasterizeTile([
    grass(),
    { name: 'transportation', features: [
      { type: 2, tags: { class: 'primary' }, geom: [[{ x: xMvt, y: 0 }, { x: xMvt, y: EXTENT }]] },
    ] },
  ], N, 0, 0, EDGE_M);
  assert.truthy(bits(e, 19, 30) & W.ROAD_CLASS_MAJOR_ROAD, 'the majority-covered west cell is direct road');
  assert.truthy(bits(e, 20, 30) & W.ROAD_CLASS_MAJOR_ROAD, 'the majority-covered east cell is direct road');
  assert.truthy(bits(e, 18, 30) & W.ROAD_CLASS_MAJOR_BAND, 'the west fringe is touched by the band');
  assert.falsy(bits(e, 18, 30) & W.ROAD_CLASS_MAJOR_ROAD, 'the under-half west fringe is not direct road');
  assert.truthy(bits(e, 21, 30) & W.ROAD_CLASS_MAJOR_BAND, 'the east fringe is touched by the band');
  assert.falsy(bits(e, 21, 30) & W.ROAD_CLASS_MAJOR_ROAD, 'the under-half east fringe is not direct road');
});

function movementScene(entry) {
  return {
    depth: 0, tileEdgeM: EDGE_M, cellM: CELL_M,
    cellAt: () => ({ loaded: true, type: T.GRASS }),
    _cellBlocked: () => false,
    _nearAny: () => false,
    placedRockSet: null,
  };
}
const centreM = (cell) => (cell + 0.5) * CELL_M;
function refused(bit, creature, alreadyInside = false) {
  const entry = { cellsPerEdge: N, grid: new Uint8Array(N * N).fill(T.GRASS),
    roadClass: new Uint8Array(N * N), creatures: [] };
  const fromX = 10, toX = 12, row = 10;
  entry.roadClass[idx(toX, row)] = bit;
  if (alreadyInside) entry.roadClass[idx(fromX, row)] = bit;
  const key = W.tileKey(0, 0), prior = W.tileCache.get(key);
  W.tileCache.set(key, entry);
  creature.x = centreM(fromX); creature.y = centreM(row);
  try {
    return creatureStepRefused(movementScene(entry), creature, centreM(toX), centreM(row));
  } finally {
    if (prior) W.tileCache.set(key, prior); else W.tileCache.delete(key);
  }
}

test('road junctions: every non-ally refuses exclusion; only fast movers refuse soft entry', () => {
  assert.truthy(refused(W.ROAD_CLASS_JUNCTION_EXCLUDE, { id: 'slow', kind: 'slime' }), 'slow hostile refuses the exclusion');
  assert.truthy(refused(W.ROAD_CLASS_JUNCTION_EXCLUDE, { id: 'fast', kind: 'goblin' }), 'fast hostile refuses the exclusion');
  assert.truthy(refused(W.ROAD_CLASS_JUNCTION_EXCLUDE, { id: 'wild', kind: 'deer' }), 'wild fauna refuses the exclusion');
  assert.truthy(refused(W.ROAD_CLASS_JUNCTION_SOFT, { id: 'fast', kind: 'goblin' }), 'fast hostile refuses entry to the soft buffer');
  assert.falsy(refused(W.ROAD_CLASS_JUNCTION_SOFT, { id: 'slow', kind: 'slime' }), 'slow hostile may enter the soft buffer');
  assert.falsy(refused(W.ROAD_CLASS_JUNCTION_SOFT, { id: 'fast-in', kind: 'goblin' }, true), 'a fast mover already inside may leave');
});
})();
