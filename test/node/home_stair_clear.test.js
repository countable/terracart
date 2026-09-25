// NOTHING ELSE STANDS ON A LADDER. The guaranteed home up-staircase in every
// cave level (app.js _ensureHomeUpStair) clears whatever the cave build left
// on its cell — a rock, a chest, a mushroom, a down-stair — and runs BEFORE
// the cave spawn pass (see spawn_rebuild.test.js), so no monster, trap or coin
// is seated on it either. Lifted and run on a synthetic cave tile.

(function () {
const app = APP_JS_SRC;
const lift = (head) => {
  const a = app.indexOf('\n  ' + head + ' {');
  assert.truthy(a > 0, 'found ' + head);
  return app.slice(app.indexOf('{', a) + 1, app.indexOf('\n  }\n', a));
};
// The shared layer both per-player up-stairs go through, and the two callers.
const layBody = lift('_laySyntheticUpStair(entry, tx, ty, wx, wy, prefix)');
const homeBody = lift('_ensureHomeUpStair(entry, tx, ty)');
const ladderBody = lift('_ensureLadderUpStairs(entry, tx, ty)');
const self = (WorldGen, extra) => Object.assign({
  _laySyntheticUpStair(entry, tx, ty, wx, wy, prefix) {
    new Function('entry', 'tx', 'ty', 'wx', 'wy', 'prefix', 'WorldGen', layBody)
      .call(this, entry, tx, ty, wx, wy, prefix, WorldGen);
  },
}, extra);

test('home ladder: whatever was on its cell is gone, and the up-stair is there', () => {
  const N = 16, edge = 16;             // 1 m cells
  const at = (x, y) => ({ x: x + 0.5, y: y + 0.5 });
  const entry = {
    grid: new Array(N * N).fill(1), cellsPerEdge: N, tileEdgeM: edge, depth: 2,
    objects: [
      { kind: 'rock', ...at(5, 5) }, { kind: 'chest', ...at(5, 5) },
      { kind: 'staircase', dir: 'down', ...at(5, 5) },
      { kind: 'rock', id: 'next door', ...at(6, 5) },
    ],
    wildplants: [{ crop: 'mushroom', ...at(5, 5) }, { crop: 'mushroom', id: 'keep', ...at(4, 4) }],
  };
  const HomeArea = { worldM: at(5, 5) };
  const WorldGen = { makeObject: (kind, x, y, id, extra) => ({ kind, x, y, id, ...extra }) };
  new Function('entry', 'tx', 'ty', 'HomeArea', 'WorldGen', homeBody)
    .call(self(WorldGen), entry, 0, 0, HomeArea, WorldGen);
  const onCell = entry.objects.filter((o) => Math.floor(o.x) === 5 && Math.floor(o.y) === 5);
  assert.eq(onCell.length, 1, 'one thing on the home cell');
  assert.eq(onCell[0].kind + ':' + onCell[0].dir, 'staircase:up', 'and it is the ladder up');
  assert.truthy(entry.objects.some((o) => o.id === 'next door'), 'the neighbouring cell is untouched');
  assert.eq(entry.wildplants.map((w) => w.id).join(), 'keep', 'the mushroom on the ladder is gone, the other stays');
  assert.eq(entry.grid[5 * N + 5], 24, 'on cave floor');
});

test('home ladder: the stair is the PLAYER\'s, flagged _synthetic', () => {
  // Not part of the level's generated layer: spawnCaveCreatures neither
  // anchors on it nor lets it refuse a seat (CLAUDE.md "Every player sees the
  // SAME generated world"), and no level below mirrors it.
  const N = 8;
  const entry = { grid: new Array(N * N).fill(25), cellsPerEdge: N, tileEdgeM: N, depth: 1, objects: [] };
  const WorldGen = { makeObject: (kind, x, y, id, extra) => ({ kind, x, y, id, ...extra }) };
  new Function('entry', 'tx', 'ty', 'HomeArea', 'WorldGen', homeBody)
    .call(self(WorldGen), entry, 0, 0, { worldM: { x: 2.5, y: 3.5 } }, WorldGen);
  const st = entry.objects.find((o) => o.kind === 'staircase');
  assert.truthy(st && st._synthetic, 'the home up-stair is _synthetic');
  assert.truthy(/^homeup_1_0_0_2_3$/.test(st.id), 'id from tile + local cell: ' + (st && st.id));
});

test('starter ladder: every cave level gets its own way back up under it', () => {
  // The ladder is a `_synthetic` down-stair loadCaveTile ignores, so the up
  // end is laid here — at the ladder's cell, flagged the same way.
  const N = 8;
  const mk = () => ({ grid: new Array(N * N).fill(25), cellsPerEdge: N, tileEdgeM: N, objects: [] });
  const WorldGen = { makeObject: (kind, x, y, id, extra) => ({ kind, x, y, id, ...extra }) };
  const save = { starterHome: { placed: [
    { k: 'tree', x: 1.5, y: 1.5, id: 't' },
    { k: 'ladder', x: 6.5, y: 4.5, id: 'l' },
  ] } };
  for (const depth of [1, 3]) {
    const entry = Object.assign(mk(), { depth });
    new Function('entry', 'tx', 'ty', 'WorldGen', ladderBody)
      .call(self(WorldGen, { save }), entry, 0, 0, WorldGen);
    const ups = entry.objects.filter((o) => o.kind === 'staircase' && o.dir === 'up');
    assert.eq(ups.length, 1, 'one up-stair at depth ' + depth);
    assert.eq(Math.floor(ups[0].x) + ',' + Math.floor(ups[0].y), '6,4', 'at the ladder cell');
    assert.truthy(ups[0]._synthetic, 'a player overlay');
    assert.eq(entry.grid[4 * N + 6], 24, 'on floor');
  }
  // A tile the ladder isn't on is left alone.
  const other = Object.assign(mk(), { depth: 1 });
  new Function('entry', 'tx', 'ty', 'WorldGen', ladderBody)
    .call(self(WorldGen, { save }), other, 1, 0, WorldGen);
  assert.eq(other.objects.length, 0, 'no stair on a tile the ladder is not over');
});
})();
