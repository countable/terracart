// Generated ruin furnishings use the ordinary furniture picker and durable pickup ledger.
(() => {
  function world(run) {
    const old = WorldGen.tileCache;
    const lamp = { kind: 'furniture', generatedFurniture: true, quarryRuin: 'quarry|ruin',
      itemId: 'lamp_floor', id: 'quarry|ruin|lamp', depth: 2, x: 2.5, y: 2.5 };
    const entry = { objects: [lamp] };
    const s = Object.assign(Object.create(SceneFurniture.prototype), {
      depth: 2, cellM: 5, cellsPerTile: 32, tileEdgeM: 160,
      startWorldM: { x: 0, y: 0 }, originPx: { x: 0, y: 0 }, mPerPx: 160 / WorldGen.TILE_PX,
      save: {}, flashAtPlayer() {}, _finishInventoryChange() {}, drawObjects() {},
      addToInv(id, qty, silent, opts) {
        this.lastGrant = opts;
        return Inventory.add(this.save, id, qty).accepted;
      },
    });
    SaveState.defaults(s.save);
    WorldGen.tileCache = new Map([['0_0', entry]]);
    try { run(s, lamp, entry); } finally { WorldGen.tileCache = old; }
  }
  test('quarry furniture: pickup is a wild find, spends one generated identity and survives regeneration', () => world((s, lamp, entry) => {
    assert.eq(s._placedFurniture({ ...lamp }), lamp, 'picker resolves the live generated record');
    assert.truthy(s.pickupFurniture(lamp));
    assert.eq(Inventory.count(s.save, lamp.itemId), 1);
    assert.eq(s.lastGrant.notWild, false, 'generated furnishings are found in the wild');
    assert.eq(s.save.picked.filter(id => id === lamp.id).length, 1);
    assert.eq(entry.objects.length, 0, 'live render object is removed');
    assert.falsy(s.pickupFurniture(lamp), 'stale picker cannot grant twice');
    s.save = JSON.parse(JSON.stringify(s.save));
    entry.objects.push({ ...lamp });
    assert.truthy(isSpent(entry.objects[0], spentSets(s)), 'regenerated identity stays spent');
    assert.eq(s._placedFurniture(lamp), null, 'regenerated object cannot reopen pickup');
    assert.eq(s.save.furniture.length, 0, 'generated pickup never creates a placement record');
  }));
  test('quarry furniture: full bag, rejected grant, wrong floor and missing object cannot consume it', () => world((s, lamp, entry) => {
    s.save.inv = [{ id: lamp.itemId, count: Inventory.stackCap(s.save) }];
    assert.falsy(s.pickupFurniture(lamp));
    assert.falsy(s.save.picked.includes(lamp.id));
    assert.eq(entry.objects.length, 1);
    s.save.inv = [];
    s.addToInv = () => 0;
    assert.falsy(s.pickupFurniture(lamp), 'rejected grant leaves object intact');
    assert.falsy(s.save.picked.includes(lamp.id));
    s.depth = 1; assert.eq(s._placedFurniture(lamp), null);
    s.depth = 2; entry.objects = []; assert.eq(s._placedFurniture(lamp), null);
  }));
  test('quarry furniture: lamps illuminate their underground floor until pickup', () => world((s, lamp) => {
    assert.eq(Lighting.sourceKind(s, lamp), 'furniture_lamp');
    assert.eq(Lighting.sourceKind(s, { ...lamp, itemId: 'table_oak' }), null);
    assert.eq(Lighting.sourceKind(s, { ...lamp, generatedFurniture: false }), null,
      'ordinary outdoor furniture still requires Home');
    s.depth = 0; assert.eq(Lighting.sourceKind(s, lamp), null);
    s.depth = 1; assert.eq(Lighting.sourceKind(s, lamp), null);
    s.depth = 2;
    s.save.picked.push(lamp.id);
    assert.eq(Lighting.sourceKind(s, lamp), null, 'spent lamp cannot light after regeneration');
  }));
})();
