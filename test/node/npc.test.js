// NPC generation must agree between players and survive live-tile edits.
(function () {
  const T = WorldGen.T;
  const N = 32, CELL_M = 7, EDGE_M = N * CELL_M;
  const scene = () => ({ tileEdgeM: EDGE_M, cellM: CELL_M, save: { caught: [], opened: [] } });
  const entry = (terrain = T.PARK) => ({
    cellsPerEdge: N,
    grid: new Uint8Array(N * N).fill(terrain),
    objects: [], genObjects: [], wildplants: [], roadMask: new Uint8Array(N * N),
  });
  const signature = (creatures) => JSON.stringify(creatures.map(c => ({
    id: c.id, x: c.x, y: c.y, name: c.name, role: c.role,
    npcVariant: c.npcVariant, tint: c.tint, zone: c.zone,
  })));

  test('NPC identities: names, role, art and tint remain fixed across regeneration', () => {
    const first = NPC.identity('npc_4_7_3_8', 'village');
    for (let i = 0; i < 100; i++) NPC.identity(`npc_${i}_2_9_1`, 'market');
    assert.eq(JSON.stringify(NPC.identity('npc_4_7_3_8', 'village')), JSON.stringify(first));
    assert.truthy(first.name && first.name.length >= 3, 'a pronounceable generated name');
    assert.includes(['scout', 'scholar', 'trader', 'merchant'], first.role);
    assert.inRange(first.tint, 0, 0xffffff);
    assert.truthy(Number.isInteger(first.npcVariant), 'art variant is a stable index');
  });

  test('NPC identities: scholars are uncommon and every behavior is represented', () => {
    const counts = {};
    for (let i = 0; i < 1000; i++) {
      const role = NPC.identity(`npc_12_6_${i}_9`, 'village').role;
      counts[role] = (counts[role] || 0) + 1;
    }
    for (const role of ['scout', 'scholar', 'trader', 'merchant']) assert.gt(counts[role] || 0, 0, role);
    assert.inRange(counts.scholar, 40, 180, 'book readers are roughly a tenth of the population');
  });

  test('NPC zones: inhabited areas and shrine woods differ from empty wilderness', () => {
    assert.eq(NPC.zoneFor(T.RESIDENTIAL), 'village');
    assert.eq(NPC.zoneFor(T.FARMLAND), 'farm');
    assert.eq(NPC.zoneFor(T.COMMERCIAL), 'market');
    assert.falsy(NPC.zoneFor(T.GRASS), 'ordinary wilderness has no NPC population');
    assert.eq(NPC.zoneFor(T.FOREST, true), 'shrine');
    for (let i = 0; i < 40; i++) {
      const person = NPC.identity(`npc_0_0_${i}_1`, 'shrine');
      const red = (person.tint >> 16) & 255, green = (person.tint >> 8) & 255;
      const blue = person.tint & 255;
      assert.gte(green, red, 'shrine residents have a green tint');
      assert.gte(green, blue, 'shrine residents have a green tint');
    }
  });

  test('NPC spawn: open inhabited tile produces forty unique seeded residents', () => {
    const e = entry(), s = scene();
    const first = NPC.spawn(s, e, 3, 5, { roadMask: e.roadMask, occupied: new Set(), pois: [] });
    assert.eq(first.length, 40);
    assert.eq(new Set(first.map(c => c.id)).size, 40);
    assert.truthy(first.every(c => c.kind === 'npc' && /^npc_3_5_\d+_\d+$/.test(c.id)));
    NPC.spawn(s, entry(), 8, 9, {});
    assert.eq(signature(NPC.spawn(s, e, 3, 5, { roadMask: e.roadMask, occupied: new Set(), pois: [] })), signature(first));
  });

  test('NPC spawn: generated ground, not player edits or unrelated random draws, determines identities', () => {
    const base = entry(), edited = entry(T.WATER), s = scene();
    edited.baseGrid = base.grid;
    const first = NPC.spawn(s, base, -2, 4, {});
    for (let i = 0; i < 100; i++) Math.random();
    assert.eq(signature(NPC.spawn(s, edited, -2, 4, {})), signature(first));
    assert.eq(NPC.spawn(s, entry(T.GRASS), -2, 4, {}).length, 0);
  });

  test('NPC spawn: a shrine creates a green community in otherwise empty forest', () => {
    const e = entry(T.FOREST), s = scene();
    assert.eq(NPC.spawn(s, e, 0, 0, {}).length, 0);
    const shrine = { id: 'shrine', kind: 'shrine', x: EDGE_M / 2, y: EDGE_M / 2 };
    e.genObjects.push(shrine);
    const residents = NPC.spawn(s, e, 0, 0, {});
    assert.gt(residents.length, 0);
    for (const c of residents) {
      assert.eq(c.zone, 'shrine');
      assert.lte(Math.hypot(c.x - shrine.x, c.y - shrine.y), 6 * CELL_M);
    }
  });

  test('NPC zones: grove and churchyard halos have elves; tar influence excludes residents', () => {
    for (const terrain of [T.GROVE, T.CHURCHYARD]) {
      const residents = NPC.spawn(scene(), entry(terrain), 0, 0, {});
      assert.eq(residents.length, NPC.COUNT);
      for (const c of residents) {
        assert.eq(c.zone, 'shrine');
        assert.truthy(/^(Ae|Eli|Gala|Syl)/.test(c.name), 'uses elvish name prefixes');
        assert.gte((c.tint >> 8) & 255, (c.tint >> 16) & 255);
        assert.gte((c.tint >> 8) & 255, c.tint & 255);
      }
    }
    for (const kind of ['grove', 'stones', 'tar']) {
      // Named zones cover unchanged underlying terrain as well as halos.
      const e = entry(T.PARK);
      e.zone = { idx: new Uint8Array(N * N).fill(1), s: new Uint8Array(N * N).fill(255), anchors: [{ kind }] };
      e.genObjects.push({ id: 'grove_shrine', kind: 'grove_shrine', x: EDGE_M / 2, y: EDGE_M / 2 });
      const residents = NPC.spawn(scene(), e, 0, 0, {});
      assert.eq(residents.length, kind === 'tar' ? 0 : NPC.COUNT);
      assert.truthy(residents.every(c => c.zone === 'shrine'));
    }
    assert.eq(NPC.spawn(scene(), entry(T.TAR_YARD), 0, 0, {}).length, 0);
  });

  test('NPC spawn: grove shrine landmarks attract elves outside their painted halo', () => {
    const e = entry(T.FOREST);
    e.genObjects.push({ id: 'grove_shrine', kind: 'grove_shrine', x: EDGE_M / 2, y: EDGE_M / 2 });
    const residents = NPC.spawn(scene(), e, 0, 0, {});
    assert.gt(residents.length, 0);
    assert.truthy(residents.every(c => c.zone === 'shrine'));
  });

  test('NPC shrine residents: restored wizard house adds four stable elves without rerolling neighbours', () => {
    const e = entry(), s = scene();
    const house = { kind: 'house', id: 'house_0_0_16_16', x: EDGE_M / 2, y: EDGE_M / 2 };
    e.objects.push(house);
    e._spawnOpts = { roadMask: e.roadMask, occupied: new Set([16 * N + 16]), pois: [] };
    e.creatures = NPC.spawn(s, e, 0, 0, e._spawnOpts);
    const ordinary = signature(e.creatures);
    s.houseShopRole = () => null;
    NPC.shrineResidents(s, e, 0, 0);
    assert.eq(signature(e.creatures), ordinary, 'ordinary house adds no shrine residents');
    s.houseShopRole = h => h.id === house.id ? 'wizard' : null;
    NPC.shrineResidents(s, e, 0, 0);
    const elves = e.creatures.filter(c => c.id.startsWith('npc_shrine_'));
    assert.eq(elves.length, 4);
    assert.eq(signature(e.creatures.filter(c => !c.id.startsWith('npc_shrine_'))), ordinary);
    for (const c of elves) {
      assert.eq(c.zone, 'shrine');
      assert.gte((c.tint >> 8) & 255, (c.tint >> 16) & 255);
      assert.gte((c.tint >> 8) & 255, c.tint & 255);
      assert.truthy(c.id.startsWith(`npc_shrine_${house.id}_`));
    }
    const populated = signature(e.creatures);
    NPC.shrineResidents(s, e, 0, 0);
    assert.eq(signature(e.creatures), populated, 'repeated restoration never duplicates or rerolls anyone');
    const rebuilt = Object.assign({}, e, { creatures: NPC.spawn(s, e, 0, 0, e._spawnOpts) });
    NPC.shrineResidents(s, rebuilt, 0, 0);
    assert.eq(signature(rebuilt.creatures), populated, 'tile regeneration restores identical residents');
  });

  test('NPC spawn: road bands, occupied cells and buildings stay empty', () => {
    const e = entry(), occupied = new Set();
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const i = y * N + x;
      if (x < 8) e.roadMask[i] = 1;
      else if (x < 16) occupied.add(i);
      else if (x < 24) e.grid[i] = T.BUILDING;
    }
    const residents = NPC.spawn(scene(), e, 0, 0, { roadMask: e.roadMask, occupied, pois: [] });
    assert.gt(residents.length, 0, 'fixture has open park ground');
    for (const c of residents) {
      const x = Math.floor(c.x / CELL_M), y = Math.floor(c.y / CELL_M), i = y * N + x;
      assert.eq(e.roadMask[i], 0);
      assert.falsy(occupied.has(i));
      assert.eq(e.grid[i], T.PARK);
    }
  });

  test('NPC movement: closed terrain prevents wandering, while open ground permits slow movement', () => {
    const make = () => NPC.spawn(scene(), entry(), 0, 0, {})[0];
    const open = make(), blocked = make(), road = make(), resting = make();
    resting._npcRestUntil = 160000;
    const start = { x: open.x, y: open.y };
    const openScene = Object.assign(scene(), {
      cellAt: () => ({ loaded: true, type: T.PARK, tx: 0, ty: 0, ix: 0, iy: 0 }),
      _cellBlocked: () => false,
    });
    const blockedScene = Object.assign({}, openScene, {
      cellAt: () => ({ loaded: true, type: T.BUILDING, tx: 0, ty: 0, ix: 0, iy: 0 }),
    });
    const roadScene = Object.assign({}, openScene, {
      cellAt: () => ({ loaded: true, type: T.PARK, underRoad: true }),
    });
    let distance = 0;
    for (let i = 0; i < 600; i++) {
      const x = open.x, y = open.y;
      NPC.tick(openScene, open, 100000 + i * 100, 0.1);
      NPC.tick(blockedScene, blocked, 100000 + i * 100, 0.1);
      NPC.tick(roadScene, road, 100000 + i * 100, 0.1);
      NPC.tick(openScene, resting, 100000 + i * 100, 0.1);
      const step = Math.hypot(open.x - x, open.y - y);
      assert.lte(step, NPC.WALK_MPS * 0.1 + 1e-9, 'a stroll, never faster than WALK_MPS');
      distance += step;
      assert.lte(Math.hypot(open.x - start.x, open.y - start.y), CELL_M * NPC.WANDER_CELLS + 1e-9, 'stays near home');
    }
    assert.lt(NPC.WALK_MPS, BRISK_WALK_MPS, 'a neighbour is never a fast mover');
    assert.gt(distance, 5, 'a minute on open ground is a visible walk, not a pixel a second');
    assert.eq(blocked.x, start.x, 'building prevents horizontal movement');
    assert.eq(blocked.y, start.y, 'building prevents vertical movement');
    assert.eq(road.x, start.x, 'drawn road band prevents horizontal movement');
    assert.eq(road.y, start.y, 'drawn road band prevents vertical movement');
    assert.eq(resting.x, start.x, 'rest timer pauses horizontal movement');
    assert.eq(resting.y, start.y, 'rest timer pauses vertical movement');
  });

  test('NPC simulation: the shared player bubble freezes distant residents', () => {
    const c = WorldGen.makeCreature('npc', CELL_M, 0, 'npc_0_0_1_0', NPC.identity('npc_0_0_1_0'));
    const s = Object.assign(scene(), {
      depth: 0, startWorldM: { x: 0, y: 0 }, playerM: { x: 0, y: 0 },
      save: { energy: 100, caught: [], planted: [], fires: [], released: [] },
      isUnnoticed: () => false, homeWorldPos: () => null, _castleWardPoints: () => [],
      playerToWorldCell: () => ({ tx: 0, ty: 0, ix: 0, iy: 0 }),
      cellAt: () => ({ loaded: true, type: T.PARK }),
      _nearAny: () => false, _cellBlocked: () => false,
    });
    const realNear = WorldGen.forEachItemNear, realTick = NPC.tick;
    let calls = 0;
    WorldGen.forEachItemNear = (kind, tx, ty, fn) => { if (kind === 'creatures') fn(c, 0, 0); };
    NPC.tick = () => { calls++; };
    try {
      __wander.call(s);
      assert.eq(calls, 1, 'nearby NPC receives its movement tick');
      c.x = (CREATURE_SIM_CELLS + 1) * CELL_M;
      __wander.call(s);
      assert.eq(calls, 1, 'distant NPC receives no movement tick');
    } finally {
      WorldGen.forEachItemNear = realNear;
      NPC.tick = realTick;
    }
  });

  test('NPC dialogue: daily sayings rotate without changing identity or behavior', () => {
    const s = scene(), day = Date.UTC(2026, 8, 28);
    for (const role of ['scholar', 'merchant', 'trader']) {
      const c = Object.assign({ id: 'npc_2_5_12_7', x: 0, y: 0 }, NPC.identity('npc_2_5_12_7'), { role });
      const before = JSON.stringify(c), morning = NPC.dialogue(s, c, day + 1000);
      assert.eq(JSON.stringify(NPC.dialogue(s, c, day + 80000000)), JSON.stringify(morning), role + ' stable within day');
      assert.truthy(NPC.dialogue(s, c, day + 86400000).body !== morning.body, role + ' changes tomorrow');
      assert.eq(JSON.stringify(c), before, 'conversation never changes identity');
      assert.truthy(morning.title.includes(c.name));
      if (role === 'scholar') assert.truthy(morning.body.includes('book'));
    }
  });

  test('NPC scout: shares nearby unopened chests and ignores already opened or distant chests', () => {
    const c = Object.assign({ id: 'npc_1_1_1_1', x: 0, y: 0 }, NPC.identity('npc_1_1_1_1'), { role: 'scout' });
    const s = Object.assign(scene(), { houseShopRole: () => null });
    const realWalk = WorldGen.forEachItemInBox, realAll = WorldGen.forEachItem;
    const cache = Array.from(WorldGen.tileCache.entries());
    WorldGen.tileCache.clear(); WorldGen.tileCache.set('0,0', {});
    const chests = [{ kind: 'chest', id: 'near', x: 25, y: 0 }, { kind: 'chest', id: 'far', x: 10000, y: 0 }];
    WorldGen.forEachItemInBox = (tile, kind, x0, y0, x1, y1, fn) => {
      if (kind === 'objects') chests.forEach(fn);
    };
    WorldGen.forEachItem = () => {};
    try {
      const talk = NPC.dialogue(s, c, Date.UTC(2026, 8, 28));
      assert.truthy(talk.body.includes('chest'));
      assert.truthy(talk.body.includes('east'), 'reports direction from the speaker');
      s.save.opened = ['near'];
      assert.falsy(NPC.dialogue(s, c, Date.UTC(2026, 8, 28)).body.includes('chest'), 'used and distant discoveries are excluded');
    } finally {
      WorldGen.forEachItemInBox = realWalk; WorldGen.forEachItem = realAll;
      WorldGen.tileCache.clear(); for (const [key, value] of cache) WorldGen.tileCache.set(key, value);
    }
  });
  test('NPC talk: a hidden static overlay does not swallow the tap', () => {
    // index.html keeps #story / #howto / … in the DOM as .game-modal at all
    // times; only a SHOWN dialog (scene._dialogOpen) may refuse the talk.
    const g = globalThis.document;
    globalThis.document = { querySelector: sel => (sel === '.game-modal' ? {} : null) };
    try {
      const shown = [];
      const s = { ...scene(), _dialogOpen: () => false, showMessageModal: m => shown.push(m) };
      const w = { id: 'npc_warden_1_2', kind: 'npc', x: 0, y: 0, ...NPC.warden('npc_warden_1_2'), _portrait: 'x' };
      NPC.interact(s, w, 0, 0);
      assert.eq(shown.length, 1, 'the warden speaks');
      assert.eq(shown[0].body, NPC.WARDEN_LINE);
      s._dialogOpen = () => true;
      NPC.interact(s, w, 0, 0);
      assert.eq(shown.length, 1, 'but not over an open dialog');
    } finally { globalThis.document = g; }
  });
})();
