(() => {
  test('enemy concealment: stable independent rolls leave ordinary encounters visible', () => {
    for (const [kind, rule] of Object.entries(EnemySpawns.CONCEALMENT)) {
      let hidden = 0, stealthy = 0, visible = 0;
      for (let i = 0; i < 1000; i++) {
        const id = `enemy_ambush_${i}`, a = EnemySpawns.concealment(kind, id);
        assert.eq(JSON.stringify(a), JSON.stringify(EnemySpawns.concealment(kind, id)));
        if (a.hidden) hidden++; else if (a.stealthy) stealthy++; else visible++;
      }
      assert.gt(visible, 300);
      if (rule.hidden) assert.gt(hidden, 100);
      if (rule.stealthy) assert.gt(stealthy, 100);
    }
    assert.eq(JSON.stringify(EnemySpawns.concealment('orc', 'ordinary')), '{}');
    for (const kind of ['skeleton', 'skeleton_soldier', 'zombie']) {
      for (const theme of ['ordered_graves', 'overgrown_graves']) {
        assert.truthy(EnemySpawns.concealment(kind, 'grave', theme).hidden);
      }
    }
  });

  test('enemy concealment: saved discoveries hydrate before creature activity', () => {
    const c = { id: 'ambush', kind: 'skeleton', hidden: true, x: 0, y: 0 };
    const scene = { save: { hiddenDiscoveries: { ambush: true } } };
    assert.falsy(enemyConcealmentTick(scene, c));
    assert.truthy(c._discovered);
    assert.truthy(Combat.isEnemy(c));
  });

  test('enemy concealment: authored guard hook is grove-only and gates AI before burrowing', () => {
    assert.truthy(SCENE_SRC.includes("guard.zone === 'grove' ? EnemySpawns.concealment"));
    const concealment = SCENE_SRC.indexOf('enemyConcealmentTick(this, c)');
    const burrowing = SCENE_SRC.indexOf('enemyBurrowTick(this, c,');
    assert.gte(concealment, 0, 'concealment hook exists');
    assert.gte(burrowing, 0, 'burrowing hook exists');
    assert.lt(concealment, burrowing);
  });
})();
