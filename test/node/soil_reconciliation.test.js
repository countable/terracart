// Soil repair is a tile/save lifecycle operation, independent of the viewport.
function soilScene(cells, planted = []) {
  const save = { tilled: Object.keys(cells), planted, tilledQuality: {} };
  for (const key of save.tilled) save.tilledQuality[key] = 3;
  const scene = {
    save, depth: 0, cellsPerTile: 4, mPerPx: 1,
    originPx: { x: 0, y: 0 }, startWorldM: { x: 0, y: 0 },
    tilledSet: bindIdSet(save, 'tilled'), queries: [],
    cellAt(x, y) {
      const c = worldMetersToAbsCell(this, x, y);
      const key = cellKeyFromAbsCell(c.cellIX, c.cellIY);
      this.queries.push(key);
      return { loaded: true, type: 1, ...cells[key] };
    },
  };
  return scene;
}

test('soil reconciliation: terrain, roads and lamps share eligibility and persist removal', () => {
  const scene = soilScene({ '0_0': {}, '1_0': { type: 9 },
    '2_0': { underRoad: true }, '3_0': { underLamp: true }, '4_0': { loaded: false, type: 9 } });
  assert.eq(Crops.reconcileTilled(scene), 3);
  assert.eq(scene.save.tilled.join(','), '0_0,4_0');
  assert.eq(Object.keys(scene.save.tilledQuality).join(','), '0_0,4_0');
  assert.eq(Crops.reconcileTilled(scene), 0, 'repeating reconciliation is harmless');
});

test('soil reconciliation: live surface crops retain soil until removed', () => {
  const scene = soilScene({ '0_0': { type: 9 }, '1_0': { underRoad: true } });
  const surface = absCellCenterMeters(scene, 0, 0);
  const underground = absCellCenterMeters(scene, 1, 0);
  scene.save.planted.push({ ...surface, crop: 'potato' }, { ...underground, crop: 'potato', depth: 1 });
  assert.eq(Crops.reconcileTilled(scene), 1, 'an underground crop cannot preserve surface soil');
  assert.truthy(scene.tilledSet.has('0_0'));
  scene.save.planted.splice(0, 1);
  Crops.invalidateSpatialIndex(scene.save);
  assert.eq(Crops.reconcileTilled(scene), 1, 'removing the crop exposes invalid empty soil');
  assert.eq(scene.save.tilled.length, 0);
});

test('soil reconciliation: streamed tiles repair only their own plots without a viewport', () => {
  const scene = soilScene({ '0_0': { type: 9 }, '4_0': { type: 9 } });
  assert.eq(Crops.reconcileTilled(scene, { tx: 1, ty: 0 }), 1);
  assert.eq(scene.queries.join(','), '4_0');
  assert.truthy(scene.tilledSet.has('0_0'));
  scene.depth = 1;
  assert.eq(Crops.reconcileTilled(scene), 0, 'cave terrain never clears surface soil');
  assert.eq(scene.queries.length, 1);
  scene.depth = 0;
  assert.eq(Crops.reconcileTilled(scene, { tx: 0, ty: 0 }), 1);
});
