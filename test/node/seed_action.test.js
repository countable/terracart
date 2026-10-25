// Explicit seed actions own soil preparation; ordinary taps are non-destructive.
(() => {
  const handler = name => TAP_HANDLERS.find(h => h.name === name);
  function fixture(run, seedId = 'potato_seed') {
    const oldCache = WorldGen.tileCache, random = Math.random;
    WorldGen.tileCache = new Map(); Math.random = () => 0.999;
    const save = { inv: [{ id: seedId, count: 2 }, { id: 'onion_seed', count: 2 }], selSlot: 0,
      energy: 100, relics: { hoe: { tier: 2 } }, planted: [], fruittrees: [], picked: [], opened: [], chopped: [] };
    SaveState.defaults(save);
    const cell = { loaded: true, type: WorldGen.T.GRASS };
    const events = [], messages = [];
    let done, refund;
    const scene = { save, depth: 0, cellM: 5, tileEdgeM: 100, tilledSet: bindIdSet(save, 'tilled'), placedRockSet: new Set(),
      cellAt: () => cell, flash: text => messages.push(text), buildInventoryDOM() {},
      _busyWheel: liftSceneMethod('_busyWheel'),
      questEvent: event => events.push(event),
      spendEnergy(cost) { if (save.energy < cost) return false; Energy.set(save, save.energy - cost); return true; },
      startWorkProgress(x, y, callback, ms, cost) { done = callback; refund = cost; },
    };
    const ctx = { scene, save, cell, cellKey: 'plot', cwmx: 10, cwmy: 10, sx: 0, sy: 0, seedAction: true };
    try { run({ scene, save, cell, ctx, events, messages, complete: () => done(), pending: () => !!done, refund: () => refund }); }
    finally { WorldGen.tileCache = oldCache; Math.random = random; }
  }
  test('seed action: the HUD entry tills and plants at the body cell, independent of peek', () => fixture(f => {
    Object.assign(f.scene, { cellsPerTile: 32, tileEdgeM: 160, mPerPx: 160 / WorldGen.TILE_PX,
      startWorldM: { x: 0, y: 0 }, originPx: { x: 0, y: 0 }, playerM: { x: 12.5, y: 12.5 },
      _peekX: 100, _peekY: 100, worldMetersToScreen: () => ({ x: 20, y: 20 }) });
    assert.truthy(plantSelectedSeed(f.scene));
    f.complete();
    assert.eq(f.save.planted[0].x, 12.5); assert.eq(f.save.planted[0].y, 12.5);
    assert.eq(f.save.tilled[0], '2_2');
    assert.eq(Inventory.count(f.save, 'potato_seed'), 1);
  }));
  test('seed action: house repairs and manual work block planting before resolving the target', () => {
    for (const state of ['_wreckRepair', '_workProgress']) fixture(f => {
      f.scene[state] = {};
      f.scene.cellAt = () => { throw new Error('busy action must not resolve a planting target'); };
      assert.falsy(plantSelectedSeed(f.scene));
      assert.falsy(f.pending());
      assert.eq(f.save.energy, 100);
      assert.eq(Inventory.count(f.save, 'potato_seed'), 2);
      assert.eq(f.save.planted.length, 0);
      assert.eq(f.scene.tilledSet.size, 0);
    });
  });
  test('seed action: map taps never till, even with a seed held', () => fixture(f => {
    delete f.ctx.seedAction;
    assert.falsy(handler('till').try(f.ctx));
    assert.falsy(f.pending()); assert.eq(f.save.energy, 100); assert.eq(f.scene.tilledSet.size, 0);
  }));
  test('seed action: preparing soil plants and consumes the captured seed in one completion', () => fixture(f => {
    assert.truthy(handler('till').try(f.ctx));
    assert.truthy(f.pending());
    assert.eq(f.save.energy, 100 - effectiveTillCost(f.save.relics) - ENERGY_COST.plant);
    assert.eq(f.save.planted.length, 0); assert.eq(Inventory.count(f.save, 'potato_seed'), 2);
    f.save.selSlot = 1;
    f.complete();
    assert.eq(f.save.planted.length, 1); assert.eq(f.save.planted[0].crop, 'potato');
    assert.eq(f.save.planted[0].qualBoost, 2); assert.truthy(f.scene.tilledSet.has('plot'));
    assert.eq(Inventory.count(f.save, 'potato_seed'), 1); assert.eq(Inventory.count(f.save, 'onion_seed'), 2);
    assert.eq(f.events.join(','), 'till,plant');
    assert.eq(JSON.parse(JSON.stringify(f.save)).tilled[0], 'plot', 'bound soil set is persisted');
    assert.eq(f.save.planted[0].watered_t, 0, 'watering remains a separate action');
  }));
  test('seed action: invalidated seed, terrain, depth or occupancy refunds work without preparing soil', () => {
    for (const invalidate of [
      f => Inventory.remove(f.save, 'potato_seed', 2),
      f => { f.cell.type = WorldGen.T.WATER; },
      f => { f.cell.loaded = false; },
      f => { f.scene.depth = 1; },
      f => f.save.furniture.push({ itemId: 'table_oak', x: 10, y: 10 }),
    ]) fixture(f => {
      handler('till').try(f.ctx); invalidate(f); f.complete();
      assert.eq(f.save.energy, 100); assert.eq(f.save.planted.length, 0);
      assert.eq(f.scene.tilledSet.size, 0); assert.eq(f.events.length, 0);
    });
  });
  test('seed action: cancellation leaves seeds untouched and reserves the full energy refund', () => fixture(f => {
    handler('till').try(f.ctx);
    assert.eq(f.refund(), effectiveTillCost(f.save.relics) + ENERGY_COST.plant);
    assert.eq(Inventory.count(f.save, 'potato_seed'), 2);
    assert.eq(f.scene.tilledSet.size, 0);
  }));
  test('seed action: saplings use the same combined work and become trees', () => fixture(f => {
    handler('till').try(f.ctx); f.complete();
    assert.eq(f.save.fruittrees.length, 1); assert.eq(f.save.planted.length, 0);
    assert.eq(f.save.fruittrees[0].kind, 'tree'); assert.eq(Inventory.count(f.save, 'acorn'), 1);
    assert.eq(f.scene.tilledSet.size, 0);
  }, 'acorn'));
  test('seed action: only an actual watering advances the water event', () => fixture(f => {
    handler('till').try(f.ctx); f.complete();
    delete f.ctx.at;
    handler('planted').try(f.ctx);
    assert.eq(f.events.join(','), 'till,plant,water');
    handler('planted').try(f.ctx);
    assert.eq(f.events.join(','), 'till,plant,water', 'already watered crop emits nothing');
  }));
  test('seed action: inventory action is only shown for a stocked selected seed', () => {
    const nodes = {}, calls = [];
    const scene = { save: { inv: [{ id: 'potato_seed', count: 1 }, { id: 'wood', count: 1 }], selSlot: 0 },
      _hudActionButton(id, opts) { const button = { remove() { delete nodes[id]; } }; nodes[id] = button; calls.push(opts); return button; } };
    scene.syncSeedButton = liftSceneMethod('syncSeedButton', { document: { getElementById: id => nodes[id] },
      plantSelectedSeed: actual => { assert.eq(actual, scene); calls.push('plant'); } });
    scene.syncSeedButton(); assert.eq(nodes['seed-plant-btn'].textContent, 'Till & plant');
    calls[0].onClick(); assert.eq(calls[1], 'plant');
    scene.save.selSlot = 1; scene.syncSeedButton(); assert.falsy(nodes['seed-plant-btn']);
    scene.save.selSlot = 0; scene.save.inv[0].count = 0; scene.syncSeedButton(); assert.falsy(nodes['seed-plant-btn']);
  });
})();
