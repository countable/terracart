(function () {
  const W = WorldGen, N = 16, cellM = 7, edge = N * cellM;
  function fixture(run) {
    const prior = new Map(W.tileCache);
    W.tileCache.clear();
    const entry = { status: 'ready', depth: 0, cellsPerEdge: N, tileEdgeM: edge,
      grid: new Uint8Array(N * N).fill(W.T.PARK), objects: [], wildplants: [],
      roadMask: new Uint8Array(N * N), spawnWhy: new Uint32Array(N * N),
      zone: { coverage: new Uint8Array(N * N).fill(1), anchors: [{ variant: 'mushroom_grove' }] } };
    W.tileCache.set(W.tileKey(0, 0), entry);
    const scene = { depth: 0, cellsPerTile: N, cellM, tileEdgeM: edge, mPerPx: edge / W.TILE_PX,
      originPx: { x: 0, y: 0 }, startWorldM: { x: 0, y: 0 }, playerM: { x: 59.5, y: 59.5 }, save: {} };
    try { run(scene, entry); } finally { W.tileCache.clear(); for (const [k, v] of prior) W.tileCache.set(k, v); }
  }
  const advance = (scene, ms) => { for (let t = 0; t < ms; t += 100) MushroomGas.tick(scene, Math.min(100, ms - t) / 1000); };
  const mass = scene => [...MushroomGas.state(scene).gases.confusion.cells.values()].reduce((sum, c) => sum + c.density, 0);
  const plant = (x, y) => W.makeWildplant('mushroom', (x + .5) * cellM, (y + .5) * cellM, `gas_test_${x}_${y}`);

  test('mushroom gas: concealed source selection is stable, grove-only and respects hard exclusions', () => fixture((s, e) => {
    const populate = () => Array.from({ length: N * N }, (_, i) => plant(i % N, Math.floor(i / N)));
    e.wildplants = populate();
    MushroomGas.prepare(e, 0, 0);
    const sources = e.wildplants.filter(p => p.gasEmitter);
    assert.inRange(sources.length, 20, 80);
    assert.truthy(sources.every(p => p.hidden && p.depth === 0));
    const ids = sources.map(p => p.id).join();
    e.wildplants = []; MushroomGas.prepare(e, 0, 0);
    e.wildplants.push(...populate()); MushroomGas.prepare(e, 0, 0);
    assert.eq(e.wildplants.filter(p => p.gasEmitter).map(p => p.id).join(), ids, 'sliced appends still prepare sources');
    e.zone.anchors[0].variant = 'meadow';
    e.wildplants = populate(); MushroomGas.prepare(e, 0, 0);
    assert.falsy(e.wildplants.some(p => p.gasEmitter));
    e.zone.anchors[0].variant = 'mushroom_grove';
    for (const mask of [e.roadMask, e.spawnWhy]) {
      mask.fill(mask === e.roadMask ? 1 : W.SPAWN_WHY.RESTRICTED);
      e.wildplants = populate(); MushroomGas.prepare(e, 0, 0);
      assert.falsy(e.wildplants.some(p => p.gasEmitter), 'forbidden cells never become gas sources');
      mask.fill(0);
    }
  }));

  test('mushroom gas: approaching reveals a source, emits a burst, and harvesting stops further bursts', () => fixture((s, e) => {
    const p = { ...plant(8, 8), gasEmitter: true, hidden: true };
    e.wildplants = [p]; e._gasPreparedPlants = e.wildplants; e._gasPreparedCount = 1;
    s.playerM = { x: 10.5, y: 10.5 };
    advance(s, 500); assert.eq(mass(s), 0, 'source waits for body proximity');
    s.playerM = { x: p.x, y: p.y };
    advance(s, 200);
    assert.falsy(HiddenObjects.isHidden(s.save, p));
    assert.eq(mass(s), MushroomGas.CONFIG.burstMass);
    assert.eq(s.save.conditions.confused.remainingMs, 5000);
    assert.falsy(s.save.conditions.paralysis);
    s.save.picked = [p.id];
    assert.falsy(MushroomGas.sourcePresent(s, p));
    advance(s, 60000);
    assert.eq(mass(s), 0, 'harvested source stops and outdoor gas disperses');
  }));

  test('mushroom gas: one outdoor puff reaches five cells and naturally dissipates within five seconds', () => fixture(s => {
    MushroomGas.emit(s, 8, 8);
    const footprint = new Set(['8,8', '7,8', '9,8', '8,7', '8,9']);
    const sizes = [];
    for (let second = 0; second < 10; second++) {
      for (let frame = 0; frame < 10; frame++) {
        Conditions.tick(s.save, 100);
        MushroomGas.tick(s, .1);
        for (const key of MushroomGas.state(s).gases.confusion.cells.keys()) {
          assert.truthy(footprint.has(key), 'thin gas disappears before reaching a second ring');
        }
      }
      sizes.push(MushroomGas.cells(s).length);
      if (second === 0) assert.truthy(Conditions.active(s.save, 'confused'));
    }
    assert.eq(sizes.slice(0, 5).join(), '5,5,5,1,0');
    assert.eq(mass(s), 0);
    assert.falsy(Conditions.active(s.save, 'confused'), 'single-puff confusion ends within ten seconds');
  }));

  test('gas kinds: every kind fully clears below the same threshold in a sealed room', () => fixture((s, e) => {
    e.grid.fill(W.T.CAVE_WALL); e.grid[8 * N + 8] = W.T.PARK;
    for (const kind of Object.keys(MushroomGas.KINDS))
      MushroomGas.emit(s, 8, 8, Gas.DEFAULTS.minDensity / 2, kind);
    advance(s, 1000);
    assert.eq(MushroomGas.cells(s).length, 0);
    for (const gas of Object.values(MushroomGas.state(s).gases)) assert.eq(gas.cells.size, 0);
  }));

  test('confusion gas: dose duration scales with density up to the shared condition limit', () => fixture(s => {
    const st = MushroomGas.state(s), doses = [];
    s._applyCondition = (kind, opts) => doses.push({ kind, ...opts });
    for (const density of [.3, .15, .03, .6, 1.2, 6]) {
      st.gases.confusion.cells.clear();
      MushroomGas.emit(s, 8, 8, density);
      st.elapsedMs += MushroomGas.CONFIG.contactMs;
      MushroomGas.contact(s, st);
    }
    assert.eq(doses.map(d => d.durationMs).join(), '5000,2500,500,10000,20000,60000');
    assert.truthy(doses.every(d => d.kind === 'confused'));
  }));

  test('confusion gas: concentrated clouds can reach full steering takeover through the condition lifecycle', () => fixture(s => {
    MushroomGas.emit(s, 8, 8, 1.5);
    MushroomGas.contact(s, MushroomGas.state(s));
    assert.eq(s.save.conditions.confused.remainingMs, 25000);
    Conditions.normalize(s.save);
    assert.eq(s.save.conditions.confused.remainingMs, 25000, 'reload preserves high-density confusion');
  }));

  test('mushroom gas: contact refreshes five seconds without shortening stronger confusion', () => fixture(s => {
    MushroomGas.emit(s, 8, 8);
    const st = MushroomGas.state(s);
    MushroomGas.contact(s, st);
    assert.eq(s.save.conditions.confused.remainingMs, 5000);
    Conditions.tick(s.save, 1000);
    st.elapsedMs += 1000; MushroomGas.contact(s, st);
    assert.eq(s.save.conditions.confused.remainingMs, 5000);
    Conditions.apply(s.save, 'confused');
    st.elapsedMs += 1000; MushroomGas.contact(s, st);
    assert.eq(s.save.conditions.confused.remainingMs, 10000);
    s.playerM = { x: 10.5, y: 10.5 };
    Conditions.tick(s.save, 10000); MushroomGas.contact(s, st);
    assert.falsy(Conditions.active(s.save, 'confused'), 'expires after leaving the cloud');
  }));

  test('gas kinds: each vent gas applies its own condition; paralysis re-arms so the player can walk out', () => fixture(s => {
    const st = MushroomGas.state(s);
    const cell = worldMetersToAbsCell(s, playerWorldM(s).x, playerWorldM(s).y + (s.feetOffsetM || 0));
    for (const kind of ['poison', 'paralysis']) MushroomGas.emit(s, cell.cellIX, cell.cellIY, undefined, kind);
    MushroomGas.contact(s, st);
    assert.falsy(Conditions.active(s.save, 'confused'), 'kinds never mix: no confusion from other gases');
    assert.eq(s.save.conditions.poison.remainingMs, MushroomGas.KINDS.poison.durationMs);
    assert.eq(s.save.conditions.paralysis.remainingMs, MushroomGas.KINDS.paralysis.durationMs);
    // Still standing in the cloud: poison renews each second, paralysis does
    // not until its re-arm gap has passed, so its hold runs out first.
    const { durationMs, rearmMs } = MushroomGas.KINDS.paralysis;
    for (let t = 1000; t < rearmMs; t += 1000) {
      Conditions.tick(s.save, 1000); st.elapsedMs += 1000; MushroomGas.contact(s, st);
    }
    assert.falsy(Conditions.active(s.save, 'paralysis'), 'the paralysis lapses inside the cloud');
    assert.gt(rearmMs - durationMs, 2000, 'a free window of over two seconds to step out');
    assert.eq(s.save.conditions.poison.remainingMs, MushroomGas.KINDS.poison.durationMs);
    st.elapsedMs += 1000; MushroomGas.contact(s, st);
    assert.truthy(Conditions.active(s.save, 'paralysis'), 'after the gap the cloud doses again');
  }));

  test('mushroom gas: masonry contains gas, roads do not, and mining opens sealed rooms', () => fixture((s, e) => {
    const read = () => MushroomGas.terrainReader(s);
    e.grid[8 * N + 9] = W.T.ROAD;
    assert.eq(read()(9, 8), 'open');
    e.grid[8 * N + 9] = W.T.BUILDING;
    assert.eq(read()(9, 8), 'wall');
    e.grid.fill(W.T.CAVE_WALL);
    for (let y = 6; y <= 10; y++) for (let x = 6; x <= 10; x++) e.grid[y * N + x] = W.T.PARK;
    MushroomGas.emit(s, 8, 8, .1);
    advance(s, 30000);
    assert.eq(mass(s), 0, 'sealed thin gas dissipates without mining an exit');
    for (let x = 11; x < N; x++) e.grid[8 * N + x] = W.T.PARK;
    advance(s, 2000);
    assert.eq(mass(s), 0, 'opened passage lets the thin cloud dissipate');
  }));

  test('mushroom gas: field pauses across depth changes and foreground suspension', () => fixture(s => {
    MushroomGas.emit(s, 8, 8);
    const original = MushroomGas.cells(s);
    assert.eq(MushroomGas.cells(s), original, 'renderer reuses the array until gas changes');
    s.depth = 1;
    advance(s, 3000);
    assert.eq(MushroomGas.cells(s).length, 0);
    s.depth = 0;
    assert.eq(MushroomGas.cells(s), original);
    const st = MushroomGas.state(s);
    MushroomGas.tick(s, 3600);
    assert.eq(st.elapsedMs, MushroomGas.CONFIG.maxFrameMs, 'no hour of offline diffusion or emission');
  }));
})();
