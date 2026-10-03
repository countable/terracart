(() => {
  const chest = (id, extra = {}) => ({ kind: 'chest', id, x: 10, y: 20, tierSeed: 2, ...extra });
  const disguise = () => {
    for (let i = 0; i < 1000; i++) {
      const o = chest('mimic_test_' + i);
      if (chestHidesMimic(o)) return o;
    }
    throw new Error('No mimic chest found');
  };

  test('mimic: stable fifteen percent of ordinary tier two surface chests', () => {
    let n = 0;
    for (let i = 0; i < 10000; i++) {
      const o = chest('mimic_distribution_' + i);
      const hidden = chestHidesMimic(o);
      assert.eq(hidden, chestHidesMimic({ ...o }), 'reloading keeps the disguise');
      if (hidden) n++;
    }
    assert.inRange(n, 1350, 1650);
    const o = disguise();
    for (const extra of [
      { tierSeed: 1 }, { tierSeed: 3 }, { depth: 1 },
      { fixedLoot: { id: 'wood', qty: 9 } }, { crate: true },
      { poiClass: 'atm' }, { poiClass: 'bicycle_parking' },
      { poiClass: 'lodging' }, { poiClass: 'place_of_worship' },
      { poiClass: 'bakery' }, { barrel: true },
    ]) assert.falsy(chestHidesMimic(chest(o.id, extra)), JSON.stringify(extra));
  });

  test('mimic: opening consumes the disguise once and never gives chest loot', () => {
    const o = disguise(), save = { opened: [], money: 0, relics: {}, armor: {} };
    let reveals = 0;
    const original = globalThis.pickReward;
    const scene = makeScene({ _revealMimic(c) { assert.eq(c.id, o.id); reveals++; return true; } });
    const ctx = makeCtx(scene, save);
    try {
      globalThis.pickReward = () => { throw new Error('A mimic must not roll chest loot'); };
      INTERACTABLES.chest.custom(ctx, o);
      assert.truthy(ctx.dirty);
      assert.eq(save.opened[0], o.id);
      INTERACTABLES.chest.custom(makeCtx(scene, JSON.parse(JSON.stringify(save))), o);
      assert.eq(reveals, 1);
      assert.eq(save.money, 0);
    } finally { globalThis.pickReward = original; }
  });

  test('mimic: previously offered held loot remains claimable', () => {
    const o = disguise();
    const save = { opened: [], money: 0, relics: {}, armor: {}, chestHold: { [o.id]: { id: 'potato', n: 1 } } };
    const scene = makeScene({ _revealMimic() { throw new Error('Held loot is already revealed'); }, showChestRewardModal() {} });
    INTERACTABLES.chest.custom(makeCtx(scene, save), o);
    assert.eq(scene.invCount('potato'), 1);
    assert.eq(save.opened[0], o.id);
  });

  test('mimic: reveal seats one hostile at its chest and refuses missing tiles', () => {
    const method = SCENE_CREATURES_SRC.match(/  _revealMimic\(o\) \{[\s\S]*?\n  \}/)[0];
    const reveal = new Function('WorldGen', 'performance', 'return function ' + method.trim())(WorldGen, { now: () => 100 });
    const scene = { depth: 0, tileEdgeM: 100, save: { caught: [] } }, o = chest('mimic_scene');
    const key = WorldGen.tileKey(0, 0), previous = WorldGen.tileCache.get(key);
    try {
      WorldGen.tileCache.delete(key);
      assert.falsy(reveal.call(scene, o));
      const entry = { creatures: [] };
      WorldGen.tileCache.set(key, entry);
      assert.truthy(reveal.call(scene, o));
      assert.truthy(reveal.call(scene, o));
      assert.eq(entry.creatures.length, 1);
      const c = entry.creatures[0];
      assert.eq(c.kind, 'mimic');
      assert.eq(c.x, o.x);
      assert.eq(c.y, o.y);
      assert.truthy(Combat.isEnemy(c));
      assert.truthy(c._hunting);
      assert.eq(scene.save.revealedMimics.length, 1);
      assert.eq(scene.save.revealedMimics[0].chestId, o.id);
      const restoreMethod = SCENE_CREATURES_SRC.match(/  _restoreMimics\(entry, tx, ty\) \{[\s\S]*?\n  \}/)[0];
      const restore = new Function('WorldGen', 'return function ' + restoreMethod.trim())(WorldGen);
      const reloaded = { ...scene, save: JSON.parse(JSON.stringify(scene.save)) };
      const freshEntry = { creatures: [] };
      restore.call(reloaded, freshEntry, 1, 0);
      assert.eq(freshEntry.creatures.length, 0, 'only its own tile restores the mimic');
      restore.call(reloaded, freshEntry, 0, 0);
      restore.call(reloaded, freshEntry, 0, 0);
      assert.eq(freshEntry.creatures.length, 1, 'reload restores once');
      assert.eq(freshEntry.creatures[0].id, c.id);
      reloaded.save.caught.push(c.id);
      const defeatedEntry = { creatures: [] };
      restore.call(reloaded, defeatedEntry, 0, 0);
      assert.eq(defeatedEntry.creatures.length, 0, 'defeated mimics stay defeated');
      assert.falsy(reveal.call({ ...scene, depth: 1 }, o));
    } finally {
      if (previous) WorldGen.tileCache.set(key, previous);
      else WorldGen.tileCache.delete(key);
    }
  });
})();
