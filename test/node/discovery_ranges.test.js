(function () {
  function scene() {
    const s = { save: { inv: [] }, depth: 0, tileEdgeM: 256, cellsPerTile: 16, cellM: 16,
      mPerPx: 1, originPx: { x: 0, y: 0 }, startWorldM: { x: 0, y: 0 },
      playerM: { x: 88, y: 88 }, playerToWorldCell: () => ({ tx: 0, ty: 0, cx: 5, cy: 5 }) };
    return s;
  }
  const object = (dx, dy = 0, props = {}) => ({ id: `discovery_${dx}_${dy}`, hidden: true,
    x: 88 + dx * 16, y: 88 + dy * 16, ...props });
  test('discovery: stealthy uses current vision disc, never camera or explored history', () => {
    const s = scene();
    s.cameraM = { x: 200, y: 200 };
    assert.truthy(HiddenObjects.reveal(s, object(Fog.REVEAL_CELLS, 0, { hidden: false, stealthy: true })));
    assert.falsy(HiddenObjects.reveal(s, object(Fog.REVEAL_CELLS, 1, { hidden: false, stealthy: true })));
    assert.falsy(HiddenObjects.reveal(s, object(Fog.REVEAL_CELLS + 1, 0, { hidden: false, stealthy: true })));
  });
  test('discovery: perception reveals hidden things at vision and stays discovered after removing ring', () => {
    const s = scene(), o = object(Fog.REVEAL_CELLS);
    assert.falsy(HiddenObjects.reveal(s, o));
    Inventory.add(s.save, 'perception_ring', 1);
    assert.truthy(HiddenObjects.reveal(s, o));
    Inventory.remove(s.save, 'perception_ring', 1);
    s.playerM.x = 0;
    assert.falsy(HiddenObjects.isHidden(s.save, o));
    const rebuilt = { ...o, _discovered: undefined };
    HiddenObjects.reveal(s, rebuilt);
    assert.truthy(rebuilt._discovered);
  });
  test('discovery: hidden enemies cannot be targeted or damaged before awakening', () => {
    const c = object(2, 0, { kind: 'skeleton' });
    assert.truthy(Combat.isConcealed(c));
    assert.falsy(Combat.isEnemy(c));
    assert.falsy(Combat.applySleep(c));
    assert.eq(Combat.damageDealt(c, 999), 0);
    assert.falsy(Combat.canBurn(c));
    c._discovered = true;
    assert.falsy(Combat.isConcealed(c));
    assert.truthy(Combat.isEnemy(c));
  });
  test('discovery: invisible enemies cannot intercept taps on their cell', () => {
    const s = scene(), c = object(2, 0, { kind: 'skeleton' });
    s.save.caught = [];
    const old = WorldGen.forEachItem;
    WorldGen.forEachItem = (layer, visit) => visit(c);
    try {
      const handler = TAP_HANDLERS.find(h => h.name === 'creature');
      assert.falsy(handler.try({ scene: s, save: s.save, wm: { x: c.x, y: c.y }, sx: 0, sy: 0 }));
    } finally { WorldGen.forEachItem = old; }
  });
  test('discovery: every X kind defaults to hidden, including hand-authored marks', () => {
    const s = scene(), tr = object(2, 0, { hidden: false, kind: 'treasure' });
    assert.truthy(HiddenObjects.isHidden(s.save, tr));
    assert.falsy(HiddenObjects.reveal(s, tr));
    s.playerM.x += 16;
    assert.truthy(HiddenObjects.reveal(s, tr));
  });
  test('discovery: adding perception while stationary invalidates discovery cache', () => {
    const s = scene(), tr = object(3);
    const key = WorldGen.tileKey(0, 0), old = WorldGen.tileCache.get(key);
    WorldGen.tileCache.set(key, { status: 'ready', objects: [], extraTreasures: [tr] });
    try {
      HiddenObjects.tick(s);
      assert.falsy(s.save.hiddenDiscoveries?.[tr.id]);
      Inventory.add(s.save, 'perception_ring', 1);
      HiddenObjects.tick(s);
      assert.truthy(s.save.hiddenDiscoveries?.[tr.id]);
    } finally {
      if (old) WorldGen.tileCache.set(key, old); else WorldGen.tileCache.delete(key);
    }
  });
})();
