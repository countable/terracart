// Geometry and deterministic sampling of the approved declarative zone table.
(function () {
const V = ZoneVariants;
const count = (row, x0, y0, w, h, seed) => {
  const result = {};
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    const material = V.sample(row, x, y, seed);
    if (material) result[material] = (result[material] || 0) + 1;
  }
  return result;
};
test('zone variants: all 16 rows select deterministically in their zone kind', () => {
  assert.eq(V.rows.length, 16);
  assert.eq(V.forKind('grove').length, 6);
  assert.eq(V.forKind('stones').length, 5);
  assert.eq(V.forKind('tar').length, 5);
  for (const kind of ['grove', 'stones', 'tar']) {
    const selected = new Set();
    for (let i = 0; i < 500; i++) {
      const anchor = { kind, gx: i * 317, gy: i * -71 };
      const row = V.pick(anchor);
      assert.eq(row.zone, kind);
      assert.eq(V.pick({ ...anchor, lx: 23, owned: false }), row, 'observer does not alter selection');
      selected.add(row.id);
    }
    assert.eq(selected.size, V.forKind(kind).length, 'every declared option is selectable');
  }
  assert.eq(V.pick({ kind: 'tar', variant: 'seep' }).id, 'seep');
  assert.eq(V.pick({ kind: 'unknown' }), null);
});
test('zone variants: repeated geometry preserves densities and phase across negative cells', () => {
  for (const row of V.rows.filter(v => v.background.type === 'repeat_motif')) {
    const b = row.background, [w, h] = b.repeatCells;
    // Four block phases include the full flower-bed color cycle.
    const counts = count(row, -2 * w, -h, 4 * w, h, 'anchor');
    const expected = Object.assign({}, b.materialDensity, b.hazardDensity);
    for (const [material, density] of Object.entries(expected)) {
      assert.eq(counts[material] / (4 * w * h), density, `${row.id}/${material}`);
    }
  }
  const formal = V.byId('formal_garden');
  for (let bx = -4; bx <= 4; bx++) {
    const material = V.sample(formal, bx * 10 + 1, -7, 'a');
    for (const [x, y] of [[1, 3], [2, 3], [1, 4], [2, 4]]) {
      assert.eq(V.sample(formal, bx * 10 + x, y - 10, 'b'), material, 'one species per bed');
    }
  }
});
test('zone variants: seeded scatter has declared mix without dependence on traversal order', () => {
  for (const id of ['meadow', 'flint_field']) {
    const row = V.byId(id), counts = count(row, -150, -150, 300, 300, 'one');
    for (const [material, density] of Object.entries(row.background.materialDensity)) {
      assert.lt(Math.abs((counts[material] || 0) / 90000 - density), 0.004, `${id}/${material}`);
    }
    let differences = 0;
    for (let y = 30; y >= -30; y--) for (let x = 30; x >= -30; x--) {
      const a = V.sample(row, x, y, 'one');
      assert.eq(V.sample(row, x, y, 'one'), a);
      if (V.sample(row, x, y, 'two') !== a) differences++;
    }
    assert.gt(differences, 100, 'different anchors produce different scatter');
  }
});
test('zone variants: continuous bounded grids have centered POIs and exact extent', () => {
  for (const [id, plots] of [['hedge_garden', 4], ['work_yard', 5]]) {
    const row = V.byId(id), b = row.background, edge = b.spacingCells * plots;
    assert.eq(b.plots[0], plots);
    const [ox, oy] = V.poiOrigin(row);
    assert.eq(ox % b.spacingCells, b.spacingCells / 2);
    assert.eq(oy % b.spacingCells, b.spacingCells / 2);
    assert.eq(V.sample(row, ox, oy), null, 'clear POI plot center');
    for (let i = 0; i <= edge; i++) for (let line = 0; line <= edge; line += b.spacingCells) {
      assert.truthy(V.sample(row, line, i), 'unbroken column');
      assert.truthy(V.sample(row, i, line), 'unbroken row');
    }
    for (const [x, y] of [[-1, 0], [0, -1], [edge + 1, 0], [0, edge + 1]]) {
      assert.eq(V.sample(row, x, y), null, 'finite footprint');
    }
    const counts = count(row, 0, 0, edge + 1, edge + 1);
    for (const [material, density] of Object.entries(b.materialDensity)) {
      assert.lt(Math.abs((counts[material] || 0) / ((edge + 1) ** 2) - density), 1e-10);
    }
  }
});
test('zone variants: Stone Garden is centered rings with every fifth stone iron', () => {
  const row = V.byId('stone_garden'), [x, y] = V.poiOrigin(row);
  assert.eq(x, row.background.centerCell[0]);
  assert.eq(y, row.background.centerCell[1]);
  const counts = count(row, 0, 0, 21, 21);
  assert.eq(counts.iron_ore, 12);
  assert.eq(counts.stone, 48);
  assert.eq(counts.grass, 30);
  assert.eq(V.sample(row, 10, 10), null);
  assert.eq(V.sample(row, 31, 7), null, 'rings do not repeat');
});
test('zone variants: anchor transforms preserve POI phase and invert for every rotation', () => {
  for (const row of V.rows) for (let q = 0; q < 4; q++) {
    const origin = V.poiOrigin(row);
    for (const xy of [[-5, 3], [0, 0], [17, -8]]) {
      const world = V.rotate(xy[0], xy[1], q);
      const restored = V.inverseRotate(world[0], world[1], q);
      assert.eq(restored[0], xy[0]);
      assert.eq(restored[1], xy[1]);
      assert.eq(V.sample(row, restored[0] + origin[0], restored[1] + origin[1], 'seed'),
        V.sample(row, xy[0] + origin[0], xy[1] + origin[1], 'seed'));
    }
  }
});
test('zone variants: finite finds keep exact budgets and pick requirements', () => {
  for (const row of V.rows) {
    const finds = V.findOffsets(row, 12);
    assert.eq(finds.length, row.finds.count);
    assert.eq(new Set(finds.map(f => `${f.dx},${f.dy}`)).size, finds.length);
    for (const find of finds) {
      assert.truthy(Number.isInteger(find.dx) && Number.isInteger(find.dy));
      assert.truthy(V.materials[find.material]);
    }
  }
  assert.eq(V.findOffsets(V.byId('black_ring'), 12).length, 2);
  assert.eq(V.byId('seep').finds.material, 'star');
  assert.eq(V.byId('seep').finds.count, 1);
  assert.eq(V.materials.crimson_ore.requiredTier, 5);
  assert.eq(V.materials.platinum_ore.requiredTier, 4);
  assert.eq(V.materials.gold_ore.requiredTier, 3);
  const workFind = V.findOffsets(V.byId('work_yard'), 12)[0];
  assert.eq(workFind.dx, 0);
  assert.eq(workFind.dy, 12);
});
test('zone variants: fauna affinities and material classes match their runtime lanes', () => {
  assert.eq(V.rows.filter(row => Object.keys(row.attracts).length).length, 8);
  assert.eq(V.materials.grave.spawnClass, 'headstone');
  assert.eq(ZoneVariantData.materials.grave.spawnClass, 'enemy', 'runtime adapts without mutating reviewed source');
  assert.eq(V.materials.trap.collection, 'traps');
  for (const row of V.rows) {
    for (const slot of [...row.poi.slots, ...row.poi.whenInsideBuilding.slots]) assert.truthy(V.materials[slot.material]);
    for (const value of Object.values(row.attracts)) assert.truthy(value > 0 && value <= 1);
    for (const material of Object.keys(count(row, -30, -30, 60, 60, 'materials'))) assert.truthy(V.materials[material]);
  }
});
})();
