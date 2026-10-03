test('monster taps: hostile and charmed creatures show only their name within the map copy budget', () => {
  const original = { world: globalThis.WorldGen, reach: globalThis.cellInReach,
    cell: globalThis.worldMetersToAbsCell };
  const handler = TAP_HANDLERS.find(h => h.name === 'creature');
  try {
    globalThis.cellInReach = () => true;
    globalThis.worldMetersToAbsCell = () => ({ cellIX: 0, cellIY: 0 });
    for (const kind of Combat.enemyKinds()) {
      if (SpriteLayout.isSummoned(kind)) continue;
      for (const charmed of [false, true]) {
        const target = { kind, id: `test_${kind}`, x: 0, y: 0,
          _charmUntil: charmed ? Date.now() + 60000 : 0 };
        globalThis.WorldGen = { ...original.world,
          forEachItem: (layer, visit) => { if (layer === 'creatures') visit(target); } };
        const messages = [], save = { caught: [], inv: [], selSlot: -1 };
        const scene = Object.assign(makeScene(), { save, cellM: 7, cellPx: 32,
          flash: text => messages.push(text),
          startCombat: () => { throw new Error('A name tap must not start combat'); } });
        const span = SpriteLayout.creatureTapSpanPx(kind);
        const wm = { x: 0, y: (span.top + span.bottom) / 2 * scene.cellM / scene.cellPx };
        assert.eq(handler.try({ scene, save, wm, sx: 0, sy: 0 }), true, kind);
        assert.eq(messages.length, 1, kind);
        assert.eq(messages[0], Combat.monster(kind)?.name || itemName(kind), kind);
        assert.lte([...messages[0]].length, MAP_MSG_MAX, kind);
      }
    }
  } finally {
    globalThis.WorldGen = original.world;
    globalThis.cellInReach = original.reach;
    globalThis.worldMetersToAbsCell = original.cell;
  }
});
