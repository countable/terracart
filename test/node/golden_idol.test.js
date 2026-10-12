// THE GOLDEN IDOL (Shrines.SHRINE_KINDS.golden_idol): the Golden Road's
// coins are its daily spree — a coin on every free verge seat of its road
// (o.coinSeats, laid by street_variants.js), through app.js
// _coinBurstInteract's path mode.
(() => {
  const start = SCENE_SRC.indexOf('  _coinBurstInteract(sx, sy, poi) {');
  const end = SCENE_SRC.indexOf('  _coinCellsNearPlayer(count, r, taken) {', start);
  const burst = new Function('VIEW_CELLS','COIN_BURST_NEAR_PLAYER','COIN_BURST_NEAR_R','COIN_BURST_LIFE_MS','sameSideAs',
    'return ({'+SCENE_SRC.slice(start,end)+'})._coinBurstInteract;')(11,3,2,600000,() => true);
  function fixture() {
    const N = 16, edge = 80, save = {};
    const entry = { tx: 0, ty: 0, cellsPerEdge: N, grid: new Uint8Array(N * N).fill(WorldGen.T.GRASS),
      spawnWhy: new Uint16Array(N * N), roadMask: new Uint8Array(N * N), _spawnOpts: { occupied: new Set() }, coinDrops: [] };
    const scene = makeScene({ save, tileEdgeM: edge, cellM: 5, cellsPerTile: N, startWorldM: { x: 0, y: 0 }, originPx: { x: 0, y: 0 },
      mPerPx: edge / WorldGen.TILE_PX, playerM: { x: 7.5, y: 7.5 }, _coinBurstInteract: burst,
      _coinCellsNearPlayer: () => [], coinIconEl: () => null });
    // A verge row along y = 2 (cells 1..14), the idol on cell (0, 2): seats
    // reach far past the view, as a road does.
    const seats = [];
    for (let ix = 0; ix < 15; ix++) seats.push({ x: (ix + 0.5) * 5, y: 12.5, id: WorldGen.cellId('golden_coin', 0, 0, ix, 2) });
    const poi = { kind: 'grove_shrine', shrineKind: 'golden_idol', _shrineStreet: 'golden', id: 'idol_test', x: 2.5, y: 12.5, coinSeats: seats };
    return { scene, save, entry, poi };
  }
  const withCache = (fn) => {
    const old = new Map(WorldGen.tileCache); WorldGen.tileCache.clear();
    try { fn(); } finally { WorldGen.tileCache.clear(); for (const [k, v] of old) WorldGen.tileCache.set(k, v); }
  };

  test('golden idol: the Golden Road\'s shrine, a coin spree instead of a boon', () => {
    const row = Shrines.SHRINE_KINDS.golden_idol;
    assert.eq(Shrines.kindForStreet('golden'), 'golden_idol');
    assert.eq(Shrines.kindForStreet('hedgerow'), 'wishing_well', 'the wishing well keeps its hedgerow');
    assert.eq(row.reward, 'coins'); assert.truthy(row.path && row.fillScreen);
    assert.eq(row.streetChance, 1, 'every Golden Road gets its idol');
    assert.falsy(Shrines.grant({}, 'golden_idol'), 'no boon to grant');
    assert.eq(SpriteLayout.groveShrineArt({ id: 'x', shrineKind: 'golden_idol' }).frame, row.frame);
    assert.eq(Lighting.sourceKind({}, { kind: 'grove_shrine', shrineKind: 'golden_idol' }), 'shrine_golden_idol');
  });

  test('golden idol: a tap fills its road\'s free seats once a day, never its own cell or a taken one', () => withCache(() => {
    const { scene, save, entry, poi } = fixture();
    WorldGen.tileCache.set(WorldGen.tileKey(0, 0), entry);
    entry._spawnOpts.occupied.add(2 * 16 + 5);
    const existing = { id: 'existing', x: 32.5, y: 12.5, expiresAt: Date.now() + 600000 };
    entry.coinDrops.push(existing);
    INTERACTABLES.grove_shrine.custom(makeCtx(scene, save), poi);
    const coins = entry.coinDrops.filter((c) => c !== existing);
    const cells = coins.map((c) => Math.floor(c.x / 5)).sort((a, b) => a - b);
    assert.eq(cells.join(), '1,2,3,4,7,8,9,10,11,12,13,14', 'every free seat, far past the view');
    assert.truthy(coins.every((c) => c.y === 12.5), 'only on the road\'s seats');
    assert.truthy(Macros.usedToday(save, poi.id));
    INTERACTABLES.grove_shrine.custom(makeCtx(scene, save), poi);
    assert.eq(entry.coinDrops.length, coins.length + 1, 'once a UTC day');
  }));

  test('golden path idol: exact seats survive nexus coverage and pay only once daily', () => withCache(() => {
    const { scene, save, entry, poi } = fixture();
    poi.shrineKind = 'golden_path_idol'; poi._shrineStreet = 'golden_path';
    poi.coinSeats = [{ x: 17.1, y: 18.2 }, { x: 22.3, y: 23.4 }];
    entry.zone = { coverage: new Uint8Array(16 * 16).fill(1) };
    WorldGen.tileCache.set(WorldGen.tileKey(0, 0), entry);
    INTERACTABLES.grove_shrine.custom(makeCtx(scene, save), poi);
    assert.eq(entry.coinDrops.length, 2, 'path coins are allowed through a nexus');
    for (const seat of poi.coinSeats) assert.truthy(entry.coinDrops.some(c => c.x === seat.x && c.y === seat.y),
      'runtime keeps the exact path point');
    INTERACTABLES.grove_shrine.custom(makeCtx(scene, save), poi);
    assert.eq(entry.coinDrops.length, 2, 'no second daily payout');
  }));

  test('golden idol: with every seat taken the day is not spent', () => withCache(() => {
    const { scene, save, entry, poi } = fixture();
    WorldGen.tileCache.set(WorldGen.tileKey(0, 0), entry);
    for (let ix = 0; ix < 16; ix++) entry._spawnOpts.occupied.add(2 * 16 + ix);
    INTERACTABLES.grove_shrine.custom(makeCtx(scene, save), poi);
    assert.eq(entry.coinDrops.length, 0);
    assert.falsy(Macros.usedToday(save, poi.id));
  }));
})();
