(function () {
  const handler = TAP_HANDLERS.find(h => h.name === 'disarm-obstacle');
  function exercise(piece, { reach = true, keep = false, held = 'trap_disarm_kit', picked = [] } = {}) {
    const save = { inv: [{ id: held, count: 2 }], selSlot: 0, picked: [...picked], energy: 80 };
    const scene = Object.assign(makeScene(), { save, cellM: 5, cellPx: 32, cellsPerTile: 32,
      mPerPx: 5 / (WorldGen.TILE_PX / 32), originPx: { x: 0, y: 0 },
      startWorldM: { x: 0, y: 0 }, playerM: { x: 2.5, y: 2.5 }, feetOffsetM: 0, depth: 0,
      tileEdgeM: 1000, playerToWorldCell: () => ({ tx: 0, ty: 0 }), buildInventoryDOM() {} });
    const ctx = { scene, save, wm: { x: 2.5, y: 2.5 }, sx: 0, sy: 0 };
    const world = globalThis.WorldGen, reachable = globalThis.cellInReach, random = Math.random;
    let rolls = 0;
    try {
      globalThis.WorldGen = { ...world, forEachItem(layer, cb) {
        if (piece && layer === (piece.kind === 'wildplant' ? 'wildplants' : 'objects')) cb(piece);
      } };
      globalThis.cellInReach = () => reach;
      Math.random = () => { rolls++; return keep ? 0 : 0.999; };
      const result = handler.try(ctx);
      return { ctx, result, rolls };
    } finally { globalThis.WorldGen = world; globalThis.cellInReach = reachable; Math.random = random; }
  }
  test('trap kit: dismantles barricades and both spike appearances, permanently and without energy', () => {
    for (const piece of [
      { kind: 'wildplant', crop: 'barricade' },
      { kind: 'stakes', _street: 'barricade' },
      { kind: 'stakes', _street: 'burned' },
    ]) for (const keep of [false, true]) {
      const target = { ...piece, id: 'obstacle', x: 2.5, y: 2.5 };
      const { ctx, result, rolls } = exercise(target, { keep });
      assert.eq(result, true); assert.eq(rolls, 1);
      assert.eq(ctx.save.inv[0].count, keep ? 2 : 1);
      assert.eq(ctx.save.energy, 80); assert.truthy(ctx.dirty);
      const reloaded = JSON.parse(JSON.stringify(ctx.save));
      assert.truthy(isSpent({ ...target }, spentSets(ctx.scene, reloaded)), 'regenerated piece remains removed');
      assert.eq(exercise(target, { picked: reloaded.picked }).rolls, 0, 'repeat taps never spend another kit');
    }
  });
  test('trap kit: invalid, already removed, empty-hand and out-of-reach taps never consume or roll', () => {
    const piece = { kind: 'stakes', id: 'spikes', x: 2.5, y: 2.5 };
    for (const [target, opts] of [[null, {}], [{ ...piece, kind: 'tar' }, {}],
      [piece, { held: 'wood' }], [piece, { reach: false }], [piece, { picked: ['spikes'] }]]) {
      const { ctx, result, rolls } = exercise(target, opts);
      assert.falsy(result === true); assert.eq(rolls, 0); assert.eq(ctx.save.inv[0].count, 2);
      assert.falsy(ctx.dirty);
    }
  });
  test('trap kit: obstacle tap takes precedence over barricade axe work', () => {
    assert.lt(TAP_HANDLERS.indexOf(handler), TAP_HANDLERS.findIndex(h => h.name === 'wildplant'));
    assert.lt(TAP_HANDLERS.indexOf(handler), TAP_HANDLERS.findIndex(h => h.name === 'object'));
  });
  test('trap kit: removed spikes stop slowing immediately and after tile regeneration', () => {
    const start = APP_JS_SRC.indexOf('  _tickStreetFeet() {');
    const end = APP_JS_SRC.indexOf('\n  }', start);
    const tick = new Function(APP_JS_SRC.slice(APP_JS_SRC.indexOf('{', start) + 1, end));
    const world = globalThis.WorldGen;
    const piece = { kind: 'stakes', id: 'spikes', x: 2.5, y: 2.5 };
    const entry = { _spawned: true, cellsPerEdge: 32, objects: [piece], slowCells: new Map([[0, 'stakes']]) };
    const scene = { save: { picked: [] }, depth: 0, startWorldM: { x: 0, y: 0 }, cellM: 5,
      tileEdgeM: 160, playerToWorldCell: () => ({ tx: 0, ty: 0, cx: 0, cy: 0 }), flash() {} };
    try {
      globalThis.WorldGen = { ...world, tileCache: new Map([[world.tileKey(0, 0), entry]]) };
      tick.call(scene); assert.eq(scene._slowHere, 'stakes');
      scene.save.picked.push(piece.id); scene._streetFeetKey = null;
      tick.call(scene); assert.eq(scene._slowHere, null);
      entry.objects = [{ ...piece }]; scene._streetFeetKey = null;
      tick.call(scene); assert.eq(scene._slowHere, null);
    } finally { globalThis.WorldGen = world; }
  });
})();
