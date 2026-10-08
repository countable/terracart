(function () {
  const ID = 'tome_frost_aura', T0 = 1700000000000;
  function lift(name, deps = {}) {
    const start = SCENE_SRC.indexOf('\n  ' + name + '(');
    const end = SCENE_SRC.indexOf('\n  }\n', start);
    return new Function(...Object.keys(deps), 'return ({' + SCENE_SRC.slice(start, end + 4) + '})[' + JSON.stringify(name) + ']')(...Object.values(deps));
  }
  test('frost tome: scholar awards the tier-six reusable book', () => {
    assert.eq(BASE_TIER[ID], 6);
    assert.truthy(isTome(ID));
    assert.includes(Macros.scholarShelf(), ID);
    const shelf = Macros.scholarShelf(), index = shelf.indexOf(ID);
    const save = { scholarTomes: index, booksRead: (index + 1) * Macros.SCHOLAR_BOOKS_PER_PRIZE };
    assert.eq(Macros.scholarNext(save).id, ID);
    assert.truthy(CONSUMABLE_SPEC[ID].usable({ tomeUsable: id => id === ID }));
  });
  test('frost tome: reading uses its own cooldown and the buff path without consuming the book', () => {
    const old = Date.now; Date.now = () => T0;
    try {
      const s = { save: { inv: [{ id: ID, count: 1 }], selSlot: 0 },
        selected: true, ready: true, saved: 0,
        _selectedConsumable(id) { return this.selected && id === ID; },
        _tomeReady() { return this.ready; }, flashAtPlayer() {},
        _spendScroll() { throw new Error('a tome cannot be consumed'); } };
      const deps = { TIMED_BUFF_HOOKS: {}, persistSave: () => s.saved++ };
      for (const name of ['_useConsumable', '_useTimedBuff', '_readTome', '_tomeSpent']) s[name] = lift(name, deps);
      assert.truthy(s._useConsumable(ID));
      assert.eq(Buffs.until('frostAura', s.save, s), T0 + 30000);
      assert.eq(s.save.tomeMagicCd[ID], T0 + CONSUMABLE_SPEC[ID].cooldownMs);
      assert.eq(s.save.inv[0].count, 1);
      assert.eq(s.saved, 1);
      s.ready = false;
      assert.falsy(s._useConsumable(ID));
      assert.eq(Buffs.until('frostAura', s.save, s), T0 + 30000);
      s.ready = true; s.selected = false;
      assert.falsy(s._useConsumable(ID));
      assert.eq(s.saved, 1);
    } finally { Date.now = old; }
  });
  test('frost aura: radius includes its boundary, excludes caster, and never refreshes active frost', () => {
    const source = { id: 'caster', kind: 'npc', x: 100, y: 200 };
    const friend = { id: 'released_cow', kind: 'cow', x: 106, y: 208 };
    const npc = { id: 'npc', kind: 'npc', x: 100, y: 201 };
    const far = { id: 'slime', kind: 'slime', x: 110.01, y: 200 };
    const targets = [source, friend, npc, far];
    Combat.applyFrostAura(source, targets, 10, {}, T0);
    assert.falsy(Combat.isChilled(source, T0));
    assert.truthy(Combat.isChilled(friend, T0 + 9999));
    assert.truthy(Combat.isChilled(npc, T0 + 9999));
    assert.falsy(Combat.isChilled(far, T0));
    Combat.applyFrostAura(source, targets, 10, {}, T0 + 9000);
    assert.falsy(Combat.isChilled(friend, T0 + 10000));
    Combat.applyFrostAura(source, targets, 10, { radiusCells: 2 }, T0 + 10000);
    assert.truthy(Combat.isChilled(far, T0 + 10000));
  });
  test('frost tome: aura follows player feet, skips caught creatures, and expires', () => {
    const old = Date.now; let now = T0; Date.now = () => now;
    try {
      const near = { id: 'near', kind: 'npc', x: 100, y: 201 };
      const far = { id: 'far', kind: 'slime', x: 200, y: 201 };
      const caught = { id: 'caught', kind: 'cow', x: 100, y: 201 };
      const s = { save: { caught: ['caught'] }, cellM: 10,
        startWorldM: { x: 100, y: 200 }, playerM: { x: 0, y: 0 },
        playerToWorldCell: () => ({ tx: 0, ty: 0 }) };
      s.tick = lift('_tickFrostAura', { WorldGen: { forEachItemNear: (kind, tx, ty, visit) => [near, far, caught].forEach(visit) } });
      Buffs.extend(s.save, s, 'frostAura', 30000, T0);
      s.tick();
      assert.truthy(Combat.isChilled(near, T0));
      assert.falsy(Combat.isChilled(caught, T0));
      assert.falsy(Conditions.active(s.save, 'frozen'));
      s.playerM.x = 100; s.tick();
      assert.truthy(Combat.isChilled(far, T0));
      now = T0 + 30000; s.tick();
      assert.falsy(Combat.isChilled(far, now));
    } finally { Date.now = old; }
  });
})();
