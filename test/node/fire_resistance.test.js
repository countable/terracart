(function () {
  const ring = () => ({ energy: 100, inv: [{ id: 'ember_ring', count: 1 }] });

  test('Ember Ring: carried resistance reduces fire by 60% without stacking', () => {
    const save = ring();
    assert.eq(Conditions.fireDamage(save, 30), 12);
    save.inv[0].count = 2;
    assert.eq(Conditions.fireDamage(save, 30), 12);
    save.inv[0].count = 0;
    assert.eq(Conditions.fireDamage(save, 30), 30);
    assert.eq(Conditions.fireDamage({ inv: [{ id: 'stealth_ring', count: 1 }] }, 30), 30);
  });

  test('Ember Ring: one-point fire ticks retain exact resistance across reloads', () => {
    let save = ring();
    let damage = 0;
    for (let i = 0; i < 10; i++) {
      damage += Conditions.fireDamage(save, 1);
      save = JSON.parse(JSON.stringify(save));
      Conditions.normalize(save);
    }
    assert.eq(damage, 4);
    assert.eq(save.fireDamageRemainder, 0);
  });

  test('Ember Ring: burning uses resistance and delayed ticks match single ticks', () => {
    const slow = ring(), fast = ring(), plain = { energy: 100 };
    for (const save of [slow, fast, plain]) Conditions.apply(save, 'burning');
    Conditions.tick(slow, 10000, { burningExposure: true });
    Conditions.tick(plain, 10000, { burningExposure: true });
    for (let i = 0; i < 10; i++) Conditions.tick(fast, 1000, { burningExposure: true });
    assert.eq(plain.energy, 70);
    assert.eq(slow.energy, 88);
    assert.eq(fast.energy, slow.energy);
    assert.eq(fast.conditions.burning.remainingMs, plain.conditions.burning.remainingMs);
  });

  test('Ember Ring: poison is unaffected and zero fire cannot discharge saved fractions', () => {
    const save = ring();
    Conditions.fireDamage(save, 1);
    Conditions.apply(save, 'poison');
    Conditions.tick(save, 10000);
    assert.eq(save.energy, 95);
    for (const raw of [0, -1, NaN, Infinity]) assert.eq(Conditions.fireDamage(save, raw), 0);
    assert.eq(save.fireDamageRemainder, 0.4);
    save.inv = [];
    assert.eq(Conditions.fireDamage(save, 1), 1, 'removal does not charge a stale whole point');
  });

  test('fire damage: corrupt saved fractions cannot create damage or healing', () => {
    for (const value of [-1, 1, 100, NaN, Infinity, '0.4']) {
      const save = ring();
      save.fireDamageRemainder = value;
      Conditions.normalize(save);
      assert.eq(save.fireDamageRemainder, 0);
      assert.eq(Conditions.fireDamage(save, 5), 2);
    }
  });
})();

test('fire resistance: lava uses the same fractional reduction as burning', () => {
  const body = SCENE_SRC.match(/\n  _tickLava\(dt\) \{([\s\S]*?)\n  \}\n/)[1];
  const tick = new Function('dt', 'tileCellToAbs', body);
  const key = WorldGen.tileKey(19371, 29371), prior = WorldGen.tileCache.get(key);
  WorldGen.tileCache.set(key, { cellsPerEdge: 1, grid: new Uint8Array([WorldGen.T.CAVE_LAVA]) });
  try {
    for (const resistant of [false, true]) {
      const scene = { depth: 0, startWorldM: {},
        save: { energy: 100, inv: resistant ? [{ id: 'ember_ring', count: 1 }] : [] },
        playerToWorldCell: () => ({ tx: 19371, ty: 29371, cx: 0, cy: 0 }),
        _lastLavaFlashT: Infinity, _popEnergy() {}, _ignitePlayer() {},
        _losePlayerEnergy(n) { this.save.energy -= n; return n; } };
      for (let i = 0; i < 20; i++) tick.call(scene, .25, () => ({ cellIX: 0, cellIY: 0 }));
      assert.eq(scene.save.energy, resistant ? 96 : 90, 'five seconds of lava respects resistance');
    }
  } finally {
    if (prior) WorldGen.tileCache.set(key, prior); else WorldGen.tileCache.delete(key);
  }
});
