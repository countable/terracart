// NOTHING ELSE STANDS ON A LADDER. The guaranteed home up-staircase in every
// cave level (app.js _ensureHomeUpStair) clears whatever the cave build left
// on its cell — a rock, a chest, a mushroom, a down-stair — and runs BEFORE
// the cave spawn pass (see spawn_rebuild.test.js), so no monster, trap or coin
// is seated on it either. Lifted and run on a synthetic cave tile.

(function () {
const app = APP_JS_SRC;
const a = app.indexOf('\n  _ensureHomeUpStair(entry, tx, ty) {');
assert.truthy(a > 0, 'found _ensureHomeUpStair');
const body = app.slice(app.indexOf('{', a) + 1, app.indexOf('\n  }\n', a));

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
  new Function('entry', 'tx', 'ty', 'HomeArea', 'WorldGen', body).call({}, entry, 0, 0, HomeArea, WorldGen);
  const onCell = entry.objects.filter((o) => Math.floor(o.x) === 5 && Math.floor(o.y) === 5);
  assert.eq(onCell.length, 1, 'one thing on the home cell');
  assert.eq(onCell[0].kind + ':' + onCell[0].dir, 'staircase:up', 'and it is the ladder up');
  assert.truthy(entry.objects.some((o) => o.id === 'next door'), 'the neighbouring cell is untouched');
  assert.eq(entry.wildplants.map((w) => w.id).join(), 'keep', 'the mushroom on the ladder is gone, the other stays');
  assert.eq(entry.grid[5 * N + 5], 24, 'on cave floor');
});
})();
