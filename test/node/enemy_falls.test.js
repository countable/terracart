// Grounded foes fall through open floor gaps (HazardFalls.dropCreatures).
(function () {
  async function fixture(run, depth = 1) {
    const W = WorldGen, key = W.tileKey(0, 0), before = W.tileCache.get(key), cacheFor = W.tileCacheFor;
    const tile = () => ({ cellsPerEdge: 8, tileEdgeM: 64, grid: new Uint8Array(64).fill(W.T.CAVE_FLOOR),
      spawnWhy: new Uint32Array(64), objects: [], creatures: [], _spawned: true });
    const here = tile(), below = tile(), lower = new Map([[key, below]]);
    W.tileCache.set(key, here);
    W.tileCacheFor = d => d === depth + 1 ? lower : cacheFor(d);
    const scene = { depth, cellsPerTile: 8, cellM: 8, tileEdgeM: 64, mPerPx: 64 / W.TILE_PX,
      originPx: { x: 0, y: 0 }, startWorldM: { x: 0, y: 0 }, flashed: [],
      cellAt(x, y) { const tx = Math.floor(x / 64), ty = Math.floor(y / 64);
        const ix = Math.floor(x / 8) - tx * 8, iy = Math.floor(y / 8) - ty * 8;
        const e = W.tileCache.get(W.tileKey(tx, ty));
        return { tx, ty, ix, iy, cellIX: tx * 8 + ix, cellIY: ty * 8 + iy, loaded: !!e, type: e?.grid[iy * 8 + ix] }; },
      flashAtWorld(s) { this.flashed.push(s); } };
    try { await run({ scene, here, below, lower }); }
    finally { if (before) W.tileCache.set(key, before); else W.tileCache.delete(key); W.tileCacheFor = cacheFor; }
  }
  const foe = (x, y, extra) => WorldGen.makeCreature(Combat.enemyKinds().find(k => !SpriteLayout.creatureAirborne(k)), x, y, `foe_${x}_${y}`, extra);

  test('enemy falls: a foe on an L1 chasm drops to the spawned floor below, others stay', () => fixture(({ scene, here, below }) => {
    here.objects.push(WorldGen.makeObject('ground_hole', 28, 28, 'chasm_1_0_0_3_3', { depth: 1 }));
    const falling = foe(28, 28), beside = foe(44, 28), flier = foe(29, 29, { flightPotionUntil: Date.now() + 60000 });
    here.creatures.push(falling, beside);
    const fell = HazardFalls.dropCreatures(scene, [falling, beside]);
    assert.eq(fell.length, 1); assert.eq(fell[0], falling);
    assert.eq(here.creatures.length, 1); assert.eq(here.creatures[0], beside);
    assert.truthy(below.creatures.includes(falling), 'lands on the floor below');
    assert.truthy(Math.hypot(falling.x - 28, falling.y - 28) <= HazardFalls.LANDING_RADIUS * 8 * 1.5, 'near the hole');
    assert.eq(scene.flashed.length, 1);
    here.creatures.push(flier);
    assert.eq(HazardFalls.dropCreatures(scene, [flier]).length, 0, 'a flier crosses');
  }));

  test('enemy falls: an open sinkhole takes a surface foe; warning, blocked and closed gaps do not', () => fixture(({ scene, here, below }) => {
    const sinkhole = { type: 'sinkhole', phase: 'warning', footprintCells: [{ cellIX: 3, cellIY: 3 }] };
    scene._environmentHazards = new Map([[0, { caveins: [], sinkholes: [sinkhole] }]]);
    const c = foe(28, 28); here.creatures.push(c);
    for (const [phase, blocked] of [['warning', false], ['closed', false], ['open', true]]) {
      Object.assign(sinkhole, { phase, blocked });
      assert.eq(HazardFalls.dropCreatures(scene, [c]).length, 0, `${phase}${blocked ? ' blocked' : ''}`);
    }
    Object.assign(sinkhole, { phase: 'open', blocked: false });
    assert.eq(HazardFalls.dropCreatures(scene, [c]).length, 1);
    assert.eq(here.creatures.length, 0); assert.truthy(below.creatures.includes(c));
    assert.falsy((scene.save?.caught || []).includes(c.id), 'a fall is no kill');
  }, 0));

  test('enemy falls: with the floor below not yet spawned the foe is simply gone', () => fixture(({ scene, here, lower }) => {
    here.objects.push(WorldGen.makeObject('ground_hole', 28, 28, 'chasm_1_0_0_3_3', { depth: 1 }));
    lower.clear();
    const c = foe(28, 28); here.creatures.push(c);
    assert.eq(HazardFalls.dropCreatures(scene, [c]).length, 1);
    assert.eq(here.creatures.length, 0);
  }));

  test('enemy falls: the creature tick runs the drop pass after every mover', () => {
    const start = SCENE_SRC.indexOf('\n  wanderCreatures() {');
    const body = SCENE_SRC.slice(start, SCENE_SRC.indexOf('\n  }\n', start));
    const tick = body.lastIndexOf('tickCreature(c);'), drop = body.indexOf('HazardFalls.dropCreatures(this, activeCreatures)');
    assert.truthy(tick > 0 && drop > tick);
  });
})();
