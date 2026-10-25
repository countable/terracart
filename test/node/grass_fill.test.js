(function () {
const W = WorldGen, T = W.T;
const N = 96, TX = 10, TY = 5, EDGE = N * 7, E = 4096;
const rect = (x0, y0, x1, y1) => [[{ x: x0, y: y0 }, { x: x1, y: y0 },
  { x: x1, y: y1 }, { x: x0, y: y1 }, { x: x0, y: y0 }]];
const poly = (cls, geom) => ({ type: 3, tags: { class: cls }, geom });
const mappedGrass = {name:'landcover',features:[poly('grass',rect(0,0,E,E))]};
const build = (layers = [], edge = EDGE) => W.rasterizeTile([mappedGrass,...layers], N, TX, TY, edge);
const grass = (r) => r.wildplants.filter((p) => p.crop === 'longgrass' && p._biome === T.GRASS);
const signature = (r) => grass(r).map((p) => p.id).sort().join(',');
// Plants from an overlapping polygon can carry an id suffix; geometry, not
// id spelling, identifies their cell and the structures they compete with.
const cellKey = p => `${Math.floor((p.x - TX * EDGE) / (EDGE / N))}_${Math.floor((p.y - TY * EDGE) / (EDGE / N))}`;

test('grass fill: half-covered fields have dense stands, open gaps and stray tufts', () => {
  const r = build(), plants = grass(r), occupied = new Set(plants.map(cellKey));
  assert.inRange(occupied.size / (N * N), 0.45, 0.55, 'about half the ground carries grass');
  assert.eq(new Set(plants.map(p => p.id)).size, plants.length, 'one grass identity per cell');
  let dense = 0, sparse = 0, stray = 0;
  for (let y = 3; y < N - 3; y++) for (let x = 3; x < N - 3; x++) {
    let filled = 0, seats = 0, neighbours = 0;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      if (dx * dx + dy * dy > 9) continue;
      seats++;
      if (occupied.has(`${x + dx}_${y + dy}`)) {
        filled++;
        if ((dx || dy) && Math.abs(dx) <= 1 && Math.abs(dy) <= 1) neighbours++;
      }
    }
    if (filled / seats >= 0.85) dense++;
    if (filled / seats <= 0.20) sparse++;
    if (occupied.has(`${x}_${y}`) && neighbours <= 1) stray++;
  }
  assert.gt(dense, N * N / 10, 'substantial dense clumps');
  assert.gt(sparse, N * N / 10, 'substantial open gaps');
  assert.gt(stray, 20, 'isolated random grass between clumps');
});

test('grass fill: representative global tiles average half coverage deterministically', () => {
  let total = 0, cells = 0;
  for (const [tx, ty] of [[0,0],[1,0],[10,5],[-2,3],[100,100],[1301,940],[-120,-40],[200,600]]) {
    const mask = W.runSteps(W.grassFillSteps(tx, ty, N));
    const again = W.runSteps(W.grassFillSteps(tx, ty, N));
    assert.eq(mask.join(''), again.join(''), 'tile coordinates reproduce their pattern');
    const count = mask.reduce((sum, v) => sum + v, 0);
    assert.inRange(count / mask.length, 0.45, 0.55, 'representative tile stays near half');
    total += count; cells += mask.length;
  }
  assert.inRange(total / cells, 0.48, 0.52, 'global sample averages half coverage');
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
  const bare = new Set(grass(build()).map((p) => p.id.replace(/_grass$/, '')));
  assert.truthy(grass(once).every((p) => bare.has(p.id.replace(/_grass$/, ''))), 'grass-only cells preserve the old candidate identity');
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
  const structures = new Set(r.objects.filter(o => ['house', 'tower', 'temple'].includes(o.kind)).map(cellKey));
  for (const p of plants) {
    const [x, y] = cellKey(p).split('_').map(Number), idx = y * N + x;
    assert.eq(r.grid[idx], T.GRASS);
    assert.falsy(r.roadMask[idx], 'roads stay clear');
    assert.falsy(r.quietMask[idx], 'quiet military land stays clear');
    assert.falsy(structures.has(`${x}_${y}`), 'building anchors stay clear');
    assert.falsy(ids.has(p.id), 'no duplicate pickups');
    ids.add(p.id);
  }
});
test('grass fill: fields keep herbs below grass with separate persistent pickup IDs', () => {
  for (const [cls, type] of [['grass', T.GRASS], ['school', T.SCHOOL], ['pitch', T.PITCH]]) {
    const r = build([{ name: cls === 'grass' ? 'landcover' : 'landuse', features: [poly(cls, rect(0, 0, E, E))] }]);
    const cover = new Map(r.wildplants.filter(p => p.crop === 'longgrass' && p._biome === type).map(p => [cellKey(p), p]));
    const mask = W.runSteps(W.grassFillSteps(TX, TY, N));
    assert.eq(cover.size, mask.reduce((sum, v) => sum + v, 0), cls + ' uses the shared clustered mask');
    for (let i = 0; i < mask.length; i++) assert.eq(cover.has(`${i % N}_${Math.floor(i / N)}`), !!mask[i], 'all three terrains agree cell-for-cell');
    const herbs = r.wildplants.filter(p => p.crop !== 'longgrass' && p._biome === type);
    if (cls !== 'pitch') assert.gt(herbs.length, 0, 'ordinary herbs survive');
    const hidden = herbs.filter(herb => cover.has(cellKey(herb)));
    if (cls !== 'pitch') {
      assert.gt(hidden.length, 0, 'some herbs lie below the grass');
      assert.gt(herbs.length - hidden.length, 0, 'other herbs stay in the gaps');
    }
    for (const herb of herbs) {
      if (cover.has(cellKey(herb))) assert.truthy(cover.get(cellKey(herb)).id !== herb.id, 'grass and herb can be picked independently');
      assert.eq(herb.id, W.cellId('wp', TX, TY, ...cellKey(herb).split('_').map(Number)), 'old herb ID stays stable');
    }
    assert.eq(new Set(r.wildplants.map(p => p.id)).size, r.wildplants.length, 'no shared pickup IDs');
  }
});
})();
