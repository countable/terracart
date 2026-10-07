(() => {
  function tile(keys) {
    const coverage = new Uint16Array(25);
    keys.forEach((key, i) => { coverage[11 + i] = i + 1; });
    return { status: 'ready', _spawned: true, cellsPerEdge: 5,
      zone: { anchors: keys.map(key => ({ key })), coverage }, creatures: [],
      objects: keys.map((key, i) => ({ id: `temple-${key}`, kind: 'temple',
        templeZone: key, x: 9 + 6 * i, y: 15 })) };
  }
  function fixture(keys, run) {
    const oldCache = WorldGen.tileCache, oldHidden = globalThis.HiddenObjects;
    const entry = tile(keys), cache = new Map([[WorldGen.tileKey(0, 0), entry]]);
    WorldGen.tileCache = cache;
    const seen = [], scene = { save: {}, tileEdgeM: 30, depth: 0,
      playerToWorldCell: () => ({ tx: 0, ty: 0, cx: 2, cy: 2 }), showMessageModal() {} };
    globalThis.HiddenObjects = { ensureSpirit(s, o) { seen.push(o.templeZone); } };
    try { run({ entry, cache, scene, seen }); }
    finally { WorldGen.tileCache = oldCache; globalThis.HiddenObjects = oldHidden; }
  }

  test('temple observation: one park per call finishes its queue despite continuous walking', () => {
    fixture(['a', 'b', 'c'], ({ scene, seen }) => {
      let cell = 0;
      scene.playerToWorldCell = () => ({ tx: 0, ty: 0, cx: cell++, cy: 2 });
      Temples.observe(scene);
      assert.eq(seen.join(','), 'a');
      assert.truthy(Temples.hasPending(scene));
      Temples.observe(scene);
      assert.eq(seen.join(','), 'a,b', 'walking does not restart with the first park');
      Temples.observe(scene);
      assert.eq(seen.join(','), 'a,b,c');
      assert.falsy(Temples.hasPending(scene));
      Temples.observe(scene);
      assert.eq(seen.join(','), 'a,b,c,a', 'the completed pass keeps its original stamp');
    });
  });

  test('temple observation: queued park reads newly caught enemies before activation', () => {
    fixture(['a', 'b'], ({ entry, scene, seen }) => {
      entry.templeEnemySites = [{ id: 'b-foe', kind: 'slime', x: 15, y: 15 }];
      Temples.observe(scene);
      assert.eq(seen.join(','), 'a');
      assert.falsy(scene.save.temples?.b?.active);
      scene.save.caught = ['b-foe'];
      Temples.observe(scene);
      assert.truthy(scene.save.temples.b.active, 'the second park uses current caught data');
      assert.falsy(Temples.hasPending(scene));
    });
  });

  test('temple observation: queued park reads current tiles and the next pass detects replacements', () => {
    fixture(['a', 'b'], ({ cache, scene, seen }) => {
      Temples.observe(scene);
      const replacement = tile(['b']);
      replacement._spawned = false;
      cache.set(WorldGen.tileKey(0, 0), replacement);
      Temples.observe(scene);
      assert.eq(seen.join(','), 'a', 'an unspawned replacement cannot prove the queued park clear');
      assert.falsy(Temples.hasPending(scene));
      replacement._spawned = true;
      Temples.observe(scene);
      assert.eq(seen.join(','), 'a,b', 'a fresh pass sees replacement and spawn completion');
    });
  });

  test('temple observation: dialogs pause queued work and descending discards it', () => {
    fixture(['a', 'b'], ({ scene, seen }) => {
      Temples.observe(scene);
      scene._dialogOpen = () => true;
      Temples.observe(scene);
      assert.eq(seen.join(','), 'a');
      assert.truthy(Temples.hasPending(scene));
      scene.depth = 1;
      Temples.observe(scene);
      assert.falsy(Temples.hasPending(scene));
      scene.depth = 0;
      scene._dialogOpen = () => false;
      Temples.observe(scene);
      assert.eq(seen.join(','), 'a,a', 'returning to the surface starts a fresh pass');
    });
  });
})();
