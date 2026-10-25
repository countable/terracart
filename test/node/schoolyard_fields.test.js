(function () {
  function withFieldWorld(fn) {
    const W = WorldGen, original = {
      cache: W.tileCache, privateVetoAt: W.privateVetoAt, isSpawnCell: W.isSpawnCell,
      spawnOptsOf: W.spawnOptsOf, footprintCells: SpawnOwnership.footprintCells,
      worldMetersToAbsCell,
    };
    const n = 12, scene = { depth: 0, cellsPerTile: n, tileEdgeM: n,
      mPerPx: n / W.TILE_PX, originPx: { x: 0, y: 0 }, startWorldM: { x: 0, y: 0 }, save: {} };
    W.tileCache = new Map();
    W.privateVetoAt = () => false;
    W.isSpawnCell = () => true;
    W.spawnOptsOf = () => ({});
    let footprintCalls = 0, projections = 0;
    worldMetersToAbsCell = function (...args) {
      projections++;
      return original.worldMetersToAbsCell(...args);
    };
    SpawnOwnership.footprintCells = function (...args) {
      footprintCalls++;
      return original.footprintCells.apply(this, args);
    };
    const entry = { _spawned: true, cellsPerEdge: n, grid: new Uint8Array(n * n), objects: [], wildplants: [] };
    W.tileCache.set(W.tileKey(0, 0), entry);
    const school = () => {
      const grid = new Uint8Array(n * n);
      for (let y = 3; y <= 7; y++) for (let x = 3; x <= 7; x++) grid[y * n + x] = W.T.SCHOOL;
      return grid;
    };
    try { fn({ scene, entry, school, calls: () => footprintCalls, projections: () => projections }); }
    finally {
      W.tileCache = original.cache;
      W.privateVetoAt = original.privateVetoAt;
      W.isSpawnCell = original.isSpawnCell;
      W.spawnOptsOf = original.spawnOptsOf;
      SpawnOwnership.footprintCells = original.footprintCells;
      worldMetersToAbsCell = original.worldMetersToAbsCell;
    }
  }

  test('schoolyard fields: no field skips distant occupancy work and discovers a replaced grid', () => {
    withFieldWorld(({ scene, entry, school, calls, projections }) => {
      entry.objects = Array.from({ length: 10000 }, (_, i) => ({ x: 1000 + i, y: 1000 }));
      assert.eq(SchoolyardFields.fields(scene).length, 0);
      assert.eq(SchoolyardFields.fields(scene).length, 0);
      assert.eq(calls(), 0, 'empty fields should never expand object footprints');
      entry.grid = school();
      const fields = SchoolyardFields.fields(scene);
      assert.eq(fields.length, 1);
      assert.eq(fields[0].cellIX, 5);
      assert.eq(fields[0].cellIY, 5);
      assert.eq(fields[0].cells.length, 25);
      assert.eq(projections(), 0, 'distant one-cell objects need no coordinate or footprint work');
    });
  });

  test('schoolyard fields: an outside anchor can occupy a flag across a tile seam', () => {
    withFieldWorld(({ scene, entry }) => {
      const n = scene.cellsPerTile;
      const next = { _spawned: true, cellsPerEdge: n, grid: new Uint8Array(n * n), objects: [] };
      for (let y = 3; y <= 7; y++) for (let x = 10; x <= 14; x++) {
        (x < n ? entry : next).grid[y * n + x % n] = WorldGen.T.SCHOOL;
      }
      WorldGen.tileCache.set(WorldGen.tileKey(1, 0), next);
      const field = SchoolyardFields.fields(scene)[0];
      assert.eq(field.cellIX, 12);
      entry.objects.push({ ...absCellCenterMeters(scene, 8, 5), footprintCells: { width: 9 } });
      assert.eq(SchoolyardFields.fields(scene).length, 0, 'large footprint must bypass anchor bounds rejection');
      entry.objects.pop();
      assert.eq(SchoolyardFields.fields(scene)[0].id, field.id);
    });
  });

  test('schoolyard fields: a newly spawned tile invalidates an empty result', () => {
    withFieldWorld(({ scene, entry, school }) => {
      entry.grid = school();
      entry._spawned = false;
      assert.eq(SchoolyardFields.fields(scene).length, 0);
      entry._spawned = true;
      assert.eq(SchoolyardFields.fields(scene).length, 1);
      WorldGen.tileCache.delete(WorldGen.tileKey(0, 0));
      assert.eq(SchoolyardFields.fields(scene).length, 0);
    });
  });

  test('schoolyard fields: placement and removal refresh occupancy without moving the flag', () => {
    withFieldWorld(({ scene, entry, school }) => {
      entry.grid = school();
      const field = SchoolyardFields.fields(scene)[0];
      const position = absCellCenterMeters(scene, field.cellIX, field.cellIY);
      scene.save.planted = [{ ...position, depth: 0 }];
      assert.eq(SchoolyardFields.fields(scene).length, 0);
      scene.save.planted.pop();
      assert.eq(SchoolyardFields.fields(scene)[0].id, field.id);
      entry.objects.push({ ...position, _footprintCells: { width: 3, height: 3 } });
      assert.eq(SchoolyardFields.fields(scene).length, 0);
      entry.objects.pop();
      assert.eq(SchoolyardFields.fields(scene)[0].cells.length, 25);
      scene.save.planted = [{ ...position, depth: 1 }];
      assert.eq(SchoolyardFields.fields(scene)[0].id, field.id);
    });
  });
})();
