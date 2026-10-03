// Save-backed id sets keep the runtime membership view and persisted array
// together. This matters because a one-sided update otherwise works until the
// next reload, when the stale half wins.

let _saveCollectionSeq = 0;
function _saveCollectionName() {
  _saveCollectionSeq += 1;
  return `test_collections_${Date.now().toString(36)}_${_saveCollectionSeq}`;
}

test('save collections: add and delete keep the persisted array in lockstep', () => {
  const save = { tilled: ['1_1', '1_1', '2_2'] };
  const cells = bindIdSet(save, 'tilled');

  assert.eq(cells.size, 2, 'binding deduplicates the loaded array');
  assert.truthy(cells.has('1_1'), 'loaded id is present');
  assert.eq([...cells].join(','), '1_1,2_2', 'binding stays iterable in saved order');
  assert.eq([...cells.iterate()].join(','), '1_1,2_2', 'explicit iterator reads the same ids');

  cells.add('3_3');
  cells.add('3_3');
  assert.eq(save.tilled.join(','), '1_1,2_2,3_3', 'add writes one persisted id');
  assert.falsy(cells.delete('missing'), 'delete reports a missing id');
  assert.truthy(cells.delete('1_1'), 'delete reports a removed id');
  assert.eq(save.tilled.join(','), '2_2,3_3', 'delete removes the persisted id');
  assert.truthy(cells.clear(), 'clear reports a changed collection');
  assert.eq(save.tilled.length, 0, 'clear empties the persisted array');
  assert.falsy(cells.clear(), 'clearing an empty collection is a no-op');
});

test('save collections: mutations persist and a reload binds the same ids', () => {
  const id = createSave(_saveCollectionName());
  try {
    const save = { money: 1, placedRocks: ['4_4'] };
    const rocks = bindIdSet(save, 'placedRocks');
    rocks.add('5_5');
    flushSave();

    const loaded = loadSave();
    assert.eq(loaded.placedRocks.join(','), '4_4,5_5', 'mutation marked the save pending');
    const rebound = bindIdSet(loaded, 'placedRocks');
    assert.truthy(rebound.has('4_4') && rebound.has('5_5'), 'reload restores both ids');
    rebound.delete('4_4');
    flushSave();
    assert.eq(loadSave().placedRocks.join(','), '5_5', 'rebound deletion persists');
  } finally {
    flushSave();
    deleteSave(id);
  }
});

test('save collections: a missing or malformed array starts empty', () => {
  const save = { dugWalls: 'not-an-array' };
  const walls = bindIdSet(save, 'dugWalls');
  assert.eq(walls.size, 0, 'malformed input is empty');
  assert.eq(save.dugWalls.length, 0, 'save field is normalized to an array');
  walls.add('2:9_9');
  assert.truthy(walls.has('2:9_9'), 'normalized binding accepts ids');
  assert.eq(save.dugWalls[0], '2:9_9', 'normalized binding persists ids');
});

test('save collections: runtime callers mutate only the bound views', () => {
  const consumers = ['app.js', 'scene_create.js', 'scene_consumables.js', 'scene_venues.js', 'scene_streets.js', 'interact.js', 'interactables.js', 'render.js', 'sandbox.js', 'testtools.js'];
  const direct = /\.(?:tilled|brokenRocks|placedRocks|dugWalls)\s*=/;
  for (const name of consumers) {
    assert.falsy(direct.test(ALL_SRC[name]), `${name} hand-syncs a persisted id array`);
  }
  for (const field of ['tilled', 'brokenRocks', 'placedRocks', 'dugWalls']) {
    assert.truthy(ALL_SRC['scene_create.js'].includes(`bindIdSet(this.save, '${field}')`), `${field} binds at scene boot`);
  }
});
