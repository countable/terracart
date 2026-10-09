(function () {
  const place = TAP_HANDLERS.find(h => h.name === 'place-barricade');
  function fixture(depth = 0) {
    const scene = Object.assign(makeScene(), {
      save: {}, depth, cellM: 5, cellsPerTile: 32, tileEdgeM: 160,
      mPerPx: 5 / (WorldGen.TILE_PX / 32), originPx: { x: 0, y: 0 },
      startWorldM: { x: 0, y: 0 }, tilledSet: new Set(), placedRockSet: new Set(),
      buildInventoryDOM() {},
    });
    SaveState.defaults(scene.save);
    scene.save.planted = [];
    scene.save.inv = [{ id: 'barricade', count: 2 }]; scene.save.selSlot = 0;
    const entry = { grid: new Uint8Array(1024).fill(depth ? WorldGen.T.CAVE_FLOOR : WorldGen.T.GRASS),
      cellsPerEdge: 32, objects: [], wildplants: [], traps: [] };
    const ctx = { scene, save: scene.save, sx: 0, sy: 0, cwmx: 2.5, cwmy: 2.5,
      cell: { tx: 0, ty: 0, ix: 0, iy: 0 }, cellKey: '0_0' };
    return { scene, entry, ctx };
  }
  function withTile(entry, fn) {
    const old = WorldGen.tileCache.get(WorldGen.tileKey(0, 0));
    WorldGen.tileCache.set(WorldGen.tileKey(0, 0), entry);
    try { return fn(); } finally {
      if (old) WorldGen.tileCache.set(WorldGen.tileKey(0, 0), old);
      else WorldGen.tileCache.delete(WorldGen.tileKey(0, 0));
    }
  }
  test('barricade: placement consumes one item, persists and restores only its own floor', () => {
    for (const depth of [0, 2]) {
      const { scene, entry, ctx } = fixture(depth);
      withTile(entry, () => assert.truthy(place.try(ctx)));
      assert.eq(scene.save.inv[0].count, 1); assert.truthy(ctx.dirty);
      assert.eq(entry.wildplants.length, 1);
      const piece = entry.wildplants[0];
      assert.eq(piece.crop, 'barricade'); assert.eq(piece.depth, depth);
      assert.truthy(piece.playerOwned); assert.truthy(isTrapKitObstacle(piece));
      scene.save = JSON.parse(JSON.stringify(scene.save));
      const reload = { objects: [], wildplants: [] };
      PlacedFloor.restoreBarricades(scene, reload, 0, 0, depth + 1);
      assert.eq(reload.wildplants.length, 0);
      PlacedFloor.restoreBarricades(scene, reload, 0, 0, depth);
      PlacedFloor.restoreBarricades(scene, reload, 0, 0, depth);
      assert.eq(reload.wildplants.length, 1, 'reload is idempotent');
      assert.eq(reload.wildplants[0].id, piece.id);
    }
  });
  test('barricade: player salvage refunds its wood cost without shiny windfalls', () => {
    const scene = makeScene({ awardShinyBonus() { throw new Error('crafted item shiny bonus'); } });
    const save = { relics: { axe: { tier: 8 } }, picked: [] };
    const piece = WorldGen.makeWildplant('barricade', 2.5, 2.5, 'placed-barricade', { playerOwned: true });
    runWildplantTimber(makeCtx(scene, save), piece);
    assert.eq(scene.invCount('wood'), HOME_RECIPES.find(r => r.id === 'barricade').cost[0].qty);
    assert.truthy(save.picked.includes(piece.id));
  });
  test('barricade: occupied and unsafe cells preserve inventory', () => {
    for (const block of [
      f => { f.entry.grid[0] = WorldGen.T.WATER; },
      f => { f.entry.grid[0] = WorldGen.T.ROAD_MD; },
      f => { f.entry.objects.push({ kind: 'tree', id: 'tree', x: 2.5, y: 2.5 }); },
      f => { f.entry.wildplants.push(WorldGen.makeWildplant('barricade', 2.5, 2.5, 'wild')); },
      f => { f.scene.save.planted.push({ x: 2.5, y: 2.5 }); },
      f => { f.scene.save.fires.push({ x: 2.5, y: 2.5 }); },
      f => { f.scene.save.scarecrows.push({ x: 2.5, y: 2.5 }); },
      f => { f.scene.save.magicTraps.push({ x: 2.5, y: 2.5 }); },
      f => { f.scene.tilledSet.add('0_0'); },
      f => { f.scene.placedRockSet.add('0_0'); },
      f => { f.entry.traps.push({ _ix: 0, _iy: 0 }); },
    ]) {
      const f = fixture(); block(f);
      withTile(f.entry, () => assert.truthy(place.try(f.ctx)));
      assert.eq(f.scene.save.inv[0].count, 2);
      assert.eq(f.scene.save.barricades.length, 0);
      assert.falsy(f.ctx.dirty);
    }
  });
  test('barricade: clearing and burning stay removed after reload; a cleared cell can be rebuilt', () => {
    for (const field of ['picked', 'burnedObjects']) {
      const { scene, entry, ctx } = fixture();
      withTile(entry, () => place.try(ctx));
      const piece = entry.wildplants[0]; scene.save[field] = [piece.id];
      assert.truthy(isSpent(piece, spentSets(scene, scene.save)));
      const reload = { objects: [], wildplants: [] };
      PlacedFloor.restoreBarricades(scene, reload, 0, 0);
      assert.eq(reload.wildplants.length, 0);
      withTile(entry, () => place.try(ctx));
      assert.eq(scene.save.barricades.length, 1);
      assert.eq(entry.wildplants.length, 1);
      assert.falsy(isSpent(entry.wildplants[0], spentSets(scene, scene.save)));
    }
  });
})();
