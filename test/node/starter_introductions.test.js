(() => {
  const CELL = 7, N = 100, EDGE = N * CELL;
  const anchor = { x: 20.5 * CELL, y: 20.5 * CELL };
  function fixture(fn) {
    const mode = Difficulty.mode(), cache = WorldGen.tileCacheFor(0), previous = [...cache];
    Difficulty.setMode('easy'); cache.clear();
    const entry = { cellsPerEdge: N, grid: new Uint8Array(N * N).fill(WorldGen.T.GRASS),
      objects: [], genObjects: [], wildplants: [], creatures: [], buildingShapes: [], _spawned: true };
    entry._spawnOpts = WorldGen.spawnOptsOf(entry);
    cache.set(WorldGen.tileKey(0, 0), entry);
    const scene = { save: { starterCratesAt: { ...anchor }, caught: [], restoredHouses: {} },
      tileEdgeM: EDGE, cellM: CELL, depth: 0,
      _starterTrailAnchor() { return this.save.starterCratesAt; },
      homeWorldPos: () => anchor,
      viewLeft: 0, viewTop: 0, viewSize: 200,
      worldMetersToScreen: (x, y) => ({ x: 100 + (x - anchor.x) * 20 / CELL, y: 100 + (y - anchor.y) * 20 / CELL }),
    };
    try { fn(scene, entry); } finally {
      cache.clear(); for (const [key, value] of previous) cache.set(key, value);
      Difficulty.setMode(mode);
    }
  }
  function wreck(entry, id, x, y) {
    entry.objects.push({ kind: 'house', id, tier: 9, x, y });
    entry.buildingShapes.push({ key: id, tier: 9,
      ring: [x - CELL, y - CELL, x + CELL, y - CELL, x + CELL, y + CELL, x - CELL, y + CELL] });
    entry.genObjects = entry.objects.slice();
  }

  test('starter introductions: Easy chicken waits for completion, enters offscreen, and unlocks the next beat when visible', () => fixture((scene, entry) => {
    Starter.placeHomeGreeter(scene, entry, 0, 0);
    assert.eq(entry.creatures.length, 0, 'a fresh lesson cannot seat the bird');
    Quests.starterSkipAll(scene.save);
    Starter.placeHomeGreeter(scene, entry, 0, 0);
    assert.eq(entry.creatures.length, 1);
    const bird = entry.creatures[0], screen = scene.worldMetersToScreen(bird.x, bird.y);
    assert.gte(Math.hypot(screen.x - 100, screen.y - 100), 92, 'first seat is beyond the visible rim');
    assert.falsy(scene.save.starter.chickenArrived, 'a seat outside view does not release the weapon gift');
    const arrival = JSON.stringify(scene.save.starter.chickenArrival);
    entry.creatures = [];
    Starter.placeHomeGreeter(scene, entry, 0, 0);
    assert.eq(JSON.stringify(scene.save.starter.chickenArrival), arrival, 'rebuild retains the same arrival');
    const rebuilt = entry.creatures[0];
    rebuilt.x = rebuilt._homeX; rebuilt.y = rebuilt._homeY;
    Starter.tickIntroductions(scene);
    assert.truthy(scene.save.starter.chickenArrived, 'ordinary approach into view finishes the introduction');
    scene.save.caught.push(rebuilt.id); entry.creatures = [];
    Starter.placeHomeGreeter(scene, entry, 0, 0);
    assert.eq(entry.creatures.length, 0, 'catching remains durable across rebuilds');
  }));

  test('starter introductions: incidental Home chickens wait during lessons without changing their identity', () => fixture((scene) => {
    const bird = WorldGen.makeCreature('chicken', anchor.x + 9 * CELL, anchor.y, 'incidental_bird');
    assert.falsy(EnemySpawns.homeFaunaAllows(scene, bird));
    Quests.starterSkipAll(scene.save);
    assert.truthy(EnemySpawns.homeFaunaAllows(scene, bird));
    assert.eq(bird.id, 'incidental_bird');
  }));

  test('starter introductions: a sealed entrance waits, then a legal opening admits the chicken without reserving an isolated seat', () => fixture((scene, entry) => {
    Quests.starterSkipAll(scene.save);
    const ax = Math.floor(anchor.x / CELL), ay = Math.floor(anchor.y / CELL), radius = 4;
    for (let iy = ay - radius; iy <= ay + radius; iy++) {
      for (let ix = ax - radius; ix <= ax + radius; ix++) {
        if (Math.max(Math.abs(ix - ax), Math.abs(iy - ay)) === radius)
          entry.grid[iy * N + ix] = WorldGen.T.WATER;
      }
    }
    Starter.placeHomeGreeter(scene, entry, 0, 0);
    assert.eq(entry.creatures.length, 0, 'legal offscreen ground beyond the sealed moat is not reachable');
    assert.falsy(scene.save.starter.chickenArrival, 'an impossible entrance cannot reserve the introduction');
    assert.falsy(scene.save.starter.chickenArrived);
    entry.grid[(ay - radius) * N + ax] = WorldGen.T.GRASS;
    Starter.placeHomeGreeter(scene, entry, 0, 0);
    assert.eq(entry.creatures.length, 1, 'opening one creature-walkable route releases the entrance');
    const entrance = scene.save.starter.chickenArrival;
    assert.lt(entrance.cy, ay - radius, 'the bird starts on the connected side of the moat opening');
    const saved = JSON.stringify(entrance);
    entry.creatures = [];
    Starter.placeHomeGreeter(scene, entry, 0, 0);
    assert.eq(JSON.stringify(scene.save.starter.chickenArrival), saved, 'the checked route does not reroll on rebuild');
  }));

  test('starter introductions: one reachable wreck beyond the safe area holds a single thief until the first weapon is chosen', () => fixture((scene, entry) => {
    wreck(entry, 'too_near', anchor.x + 250, anchor.y);
    wreck(entry, 'onward', anchor.x + 410, anchor.y);
    const originalSid = Lairs.structureKey(0, 0, Math.floor((anchor.x + 410) / CELL), Math.floor(anchor.y / CELL));
    entry.creatures.push({ kind: 'slime', id: 'old_guard', lair: originalSid });
    entry._lairResident = new Set([originalSid]);
    Starter.tickIntroductions(scene);
    assert.eq(scene.save.starter.thiefWreck?.key, 'onward', 'quiet Home still excludes the nearer wreck');
    assert.falsy(entry.creatures.some(c => c.id === 'old_guard'), 'reservation removes an already awake ordinary garrison');
    assert.falsy(entry._lairResident.has(originalSid), 'the old resident claim cannot duplicate the authored one');
    const index = Lairs.buildIndex(entry, 0, 0, CELL, EDGE);
    const cand = [...index.buckets.values()].flat().find(c => c.key === 'onward');
    assert.eq(Starter.introductionLair(scene, cand), null, 'early exploration cannot wake the authored thief');
    const residency = { cellM: CELL, tileEdgeM: EDGE, playerM: { x: cand.wx, y: cand.wy },
      homeM: anchor, buildings: false, caughtSet: new Set(),
      candidateOverlay: c => Starter.introductionLair(scene, c) };
    Lairs.stepResidency([{ entry, tx: 0, ty: 0 }], residency);
    assert.eq(entry.creatures.length, 0, 'the shared wake loop honours a held candidate');
    scene.save.trail = { firstWeaponClaimed: true };
    Lairs.stepResidency([{ entry, tx: 0, ty: 0 }], residency);
    assert.eq(entry.creatures.length, 1, 'release wakes exactly one authored guard even with ordinary building lairs disabled');
    Lairs.stepResidency([{ entry, tx: 0, ty: 0 }], residency);
    assert.eq(entry.creatures.length, 1, 'another residency pass cannot duplicate it');
    const authored = Starter.introductionLair(scene, cand);
    const opts = { tileEdgeM: EDGE, spawnOpts: entry._spawnOpts, caughtSet: new Set() };
    const guards = Lairs.garrisonFor(entry, authored, opts);
    assert.eq(guards.length, 1); assert.eq(guards[0].kind, 'thief');
    assert.truthy(EnemySpawns.homeEligible(scene, guards[0]), 'the encounter respects both safe-area distances');
    const again = Lairs.garrisonFor(entry, Starter.introductionLair(scene, cand), opts);
    assert.eq(again[0].id, guards[0].id, 'reload and rebuild use the same defeated-id ledger');
    opts.caughtSet.add(guards[0].id);
    assert.eq(Lairs.garrisonFor(entry, authored, opts).length, 0, 'a defeated thief stays gone');
  }));

  test('starter introductions: a wreck across impassable water is not reserved', () => fixture((scene, entry) => {
    wreck(entry, 'across_water', anchor.x + 410, anchor.y);
    const wallX = 50;
    for (let iy = 0; iy < N; iy++) entry.grid[iy * N + wallX] = WorldGen.T.WATER;
    Starter.tickIntroductions(scene);
    assert.falsy(scene.save.starter.thiefWreck);
  }));

  test('starter introductions: a tile still loading retries its wreck reservation after spawning finishes', () => fixture((scene, entry) => {
    wreck(entry, 'loaded_later', anchor.x + 410, anchor.y);
    entry._spawned = false;
    Starter.tickIntroductions(scene);
    assert.falsy(scene.save.starter.thiefWreck);
    entry._spawned = true; scene._starterIntroductionsAt = 0;
    Starter.tickIntroductions(scene);
    assert.eq(scene.save.starter.thiefWreck?.key, 'loaded_later');
  }));

  test('starter introductions: legacy paid road prizes release later encounters without replacing pending choices', () => fixture((scene) => {
    scene.save.trail = { prizes: 1 };
    Starter.tickIntroductions(scene);
    assert.truthy(scene.save.trail.firstWeaponClaimed);
    assert.eq(scene.save.trail.prizes, 1, 'migration never banks or pays another prize');
    scene.save.trail = { prizes: 1, firstWeaponPending: true };
    Starter.tickIntroductions(scene);
    assert.falsy(scene.save.trail.firstWeaponClaimed, 'a new unclaimed choice remains pending');
  }));
})();
