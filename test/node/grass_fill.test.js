(function () {
const W = WorldGen, T = W.T;
const N = 96, TX = 10, TY = 5, EDGE = N * 7, E = 4096;
const rect = (x0, y0, x1, y1) => [[{ x: x0, y: y0 }, { x: x1, y: y0 },
  { x: x1, y: y1 }, { x: x0, y: y1 }, { x: x0, y: y0 }]];
const poly = (cls, geom) => ({ type: 3, tags: { class: cls }, geom });
const build = (layers = [], edge = EDGE) => W.rasterizeTile(layers, N, TX, TY, edge);
const grass = (r) => r.wildplants.filter((p) => p.crop === 'longgrass' && p._biome === T.GRASS);
const signature = (r) => grass(r).map((p) => p.id).sort().join(',');
// Plants from an overlapping polygon can carry an id suffix; geometry, not
// id spelling, identifies their cell and the structures they compete with.
const cellKey = p => `${Math.floor((p.x - TX * EDGE) / (EDGE / N))}_${Math.floor((p.y - TY * EDGE) / (EDGE / N))}`;

test('grass fill: unmapped ground has sparse fill and dense circular stands', () => {
  const r = build(), plants = grass(r), occupied = new Set(plants.map(cellKey));
  assert.inRange(plants.length / (N * N), 0.10, 0.48, 'background plus modest stand coverage');
  let dense = 0, sparse = 0;
  for (let y = 3; y < N - 3; y++) for (let x = 3; x < N - 3; x++) {
    let seats = 0, filled = 0;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      if (dx * dx + dy * dy > 9) continue;
      seats++;
      if (occupied.has(`${x + dx}_${y + dy}`)) filled++;
    }
    if (filled / seats >= 0.85) dense++;
    if (filled / seats <= 0.30) sparse++;
  }
  assert.gt(dense, 10, 'many dense radius-three circular cores');
  assert.gt(sparse, N * N / 4, 'substantial randomly filled ground between stands');
  assert.eq(new Set(plants.map((p) => p.id)).size, plants.length, 'one pickup per cell');
});

test('grass fill: reloads and drawing-frame changes preserve every grass identity', () => {
  const expected = signature(build());
  assert.eq(signature(build()), expected);
  assert.eq(signature(build([], EDGE * 1.3)), expected, 'metres are a drawing frame, not a generation seed');
});

test('grass fill: overlapping mapped grass never adds a second longgrass scatter', () => {
  const cover = { name: 'landcover', features: [poly('grass', rect(0, 0, E, E))] };
  const once = build([cover]), twice = build([cover, cover]);
  assert.eq(signature(twice), signature(once), 'duplicating a polygon cannot densify grass');
  const bare = new Set(grass(build()).map((p) => p.id));
  assert.truthy(grass(once).every((p) => bare.has(p.id)), 'mapped flowers may occupy cells; longgrass uses the same candidates');
});

test('grass fill: final terrain, road masks, site restrictions and structures take precedence', () => {
  const r = build([
    { name: 'water', features: [poly('lake', rect(0, 0, 900, E))] },
    { name: 'building', features: [poly('', rect(1400, 1400, 1850, 1850))] },
    { name: 'landuse', features: [poly('military', rect(2900, 0, E, E)),
      poly('pitch', rect(1100, 2200, 2300, 3500))] },
    { name: 'transportation', features: [{ type: 2, tags: { class: 'primary' },
      geom: [[{ x: 2000, y: 0 }, { x: 2000, y: E }]] }] },
  ]);
  const plants = grass(r);
  assert.gt(plants.length, 0);
  const ids = new Set();
  const structures = new Set(r.objects.map(cellKey));
  for (const p of plants) {
    const [x, y] = cellKey(p).split('_').map(Number), idx = y * N + x;
    assert.eq(r.grid[idx], T.GRASS);
    assert.falsy(r.roadMask[idx], 'roads stay clear');
    assert.falsy(r.quietMask[idx], 'quiet military land stays clear');
    assert.falsy(structures.has(`${x}_${y}`), 'landmarks take their cells first');
    assert.falsy(ids.has(p.id), 'no duplicate pickups');
    ids.add(p.id);
  }
});
})();
