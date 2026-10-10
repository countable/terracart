// THE SCROLL OF WIND (T1): every foe in reach takes 5 damage and is blown
// pushCells away from the reader — through Whirlwinds.impulse, the one
// knockback, extended with a distance and an any-ground mode.
(function () {
  function fixture(run, terrain = WorldGen.T.GRASS) {
    const W = WorldGen, key = W.tileKey(0, 0), previous = W.tileCache.get(key);
    const nearby = W.forEachItemNear, veto = W.privateVetoAt;
    const entry = { cellsPerEdge: 8, grid: new Uint8Array(64).fill(terrain),
      creatures: [], _spawnOpts: { roadMask: new Uint8Array(64), spawnWhy: new Uint16Array(64), occupied: new Set() } };
    W.tileCache.set(key, entry);
    W.privateVetoAt = () => false;
    W.forEachItemNear = (kind, tx, ty, fn) => entry.creatures.forEach(fn);
    const scene = { depth: 0, cellM: 8, tileEdgeM: 64, startWorldM: { x: 0, y: 0 },
      playerM: { x: 24, y: 24 }, save: { energy: 100, caught: [] }, _whirlwinds: [],
      cellAt(x, y) { const ix = Math.floor(x / 8), iy = Math.floor(y / 8);
        return { tx: 0, ty: 0, ix, iy, loaded: ix >= 0 && ix < 8 && iy >= 0 && iy < 8, type: entry.grid[iy * 8 + ix] }; },
      playerToWorldCell() { return { tx: 0, ty: 0 }; },
    };
    try { run(scene, entry); } finally {
      if (previous) W.tileCache.set(key, previous); else W.tileCache.delete(key);
      W.forEachItemNear = nearby; W.privateVetoAt = veto;
    }
  }
  const spec = () => CONSUMABLE_SPEC.wind_scroll;

  test('wind scroll: a T1 magic scroll that reads like the others', () => {
    const it = ITEM_BY_ID.wind_scroll;
    assert.truthy(it && it.kind === 'magic' && it.scroll, 'a magic scroll (so it gets its blank-scroll recipe once used)');
    assert.eq(BASE_TIER.wind_scroll, 1);
    assert.gt(PRICES.wind_scroll, 0);
    assert.eq(spec().damage, 5);
    assert.gt(spec().pushCells, 0);
    assert.eq(spec().verb, 'Read');
    assert.truthy(ITEM_EFFECTS.wind_scroll && ITEM_GUIDE_TIPS.wind_scroll, 'described');
    assert.eq(MINERAL_ICON_SHEET.wind_scroll.sheet, 'icon_wind_scroll');
    assert.truthy(/icon_wind_scroll: \{ url: 'assets\/Icons\/Items\/WindScroll\.png'/.test(SCENE_SRC), 'both icon tables');
    assert.truthy(/wind_scroll: \{ noun: 'scroll', clock: 'perf', scope: 'reach'/.test(SCENE_SRC), 'a cast row: the foes in reach');
    assert.truthy(/Whirlwinds\.impulse\(s, c, [^;]*\{ cells: CONSUMABLE_SPEC\.wind_scroll\.pushCells, anyGround: true \}\)/.test(SCENE_SRC),
      'the push is the one knockback');
    assert.truthy(LOOT_CONTEXTS['treasure:road'].favourite.ids.wind_scroll, 'a walking prize can offer it');
  });

  test('wind scroll: the gust blows a foe pushCells away on any ground; a whirlwind still keeps to grass', () => fixture((s, e) => {
    const foe = { kind: 'goblin', id: 'g', x: 28, y: 24 };
    e.creatures.push(foe);
    Whirlwinds.impulse(s, foe, { x: 24, y: 24, heading: 0 }, 0, false, { cells: spec().pushCells, anyGround: true });
    for (let now = 50; now <= 400; now += 50) Whirlwinds.pushStep(s, foe, 0.05, now);
    assert.lt(Math.abs(foe.x - (28 + spec().pushCells * s.cellM)), 1e-6, 'blown straight away from the reader');
    assert.eq(foe.y, 24);
    const leaf = { kind: 'goblin', id: 'h', x: 28, y: 24 };
    Whirlwinds.impulse(s, leaf, { x: 24, y: 24, heading: 0 }, 0, false);
    for (let now = 50; now <= 400; now += 50) Whirlwinds.pushStep(s, leaf, 0.05, now);
    assert.eq(leaf.x, 28, 'a whirlwind push still never leaves grass');
  }, WorldGen.T.ROCK));

  test('wind scroll: underground, the gust still plays out; a depth change cancels it', () => fixture((s, e) => {
    s.depth = 2;
    Whirlwinds.tick(s, 0, 0);   // settles the depth
    const foe = { kind: 'goblin', id: 'g', x: 28, y: 24, _hp: 10 };
    e.creatures.push(foe);
    Whirlwinds.impulse(s, foe, { x: 24, y: 24, heading: 0 }, 0, false, { cells: 1, anyGround: true });
    for (let now = 50; now <= 400; now += 50) Whirlwinds.tick(s, 0.05, now);
    assert.lt(Math.abs(foe.x - (28 + s.cellM)), 1e-6, 'pushed a cell in the cave');
    Whirlwinds.impulse(s, foe, { x: 24, y: 24, heading: 0 }, 500, false, { cells: 1, anyGround: true });
    s.depth = 3; Whirlwinds.tick(s, 0.05, 550);
    s.depth = 2; Whirlwinds.tick(s, 0.05, 600);
    assert.lt(Math.abs(foe.x - (28 + s.cellM)), 1e-6, 'a level change cancelled the second gust');
  }, WorldGen.T.ROCK));
})();
