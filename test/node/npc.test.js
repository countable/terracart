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
    npcVariant: c.npcVariant, tint: c.tint, culture: c.culture,
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

  test('NPC cultures: inhabited areas and shrine woods differ from empty wilderness', () => {
    assert.eq(NPC.cultureFor(T.RESIDENTIAL), 'village');
    assert.eq(NPC.cultureFor(T.FARMLAND), 'farm');
    assert.eq(NPC.cultureFor(T.COMMERCIAL), 'market');
    assert.falsy(NPC.cultureFor(T.GRASS), 'ordinary wilderness has no NPC population');
    assert.eq(NPC.cultureFor(T.FOREST, true), 'shrine');
    for (let i = 0; i < 40; i++) {
      const person = NPC.identity(`npc_0_0_${i}_1`, 'shrine');
      const red = (person.tint >> 16) & 255, green = (person.tint >> 8) & 255;
      const blue = person.tint & 255;
      assert.gte(green, red, 'shrine residents have a green tint');
      assert.gte(green, blue, 'shrine residents have a green tint');
    }
  });

  test('NPC spawn: open inhabited tile produces NPC.COUNT unique seeded residents', () => {
    const e = entry(), s = scene();
    const first = NPC.spawn(s, e, 3, 5, { roadMask: e.roadMask, occupied: new Set(), pois: [] });
    assert.eq(first.length, NPC.COUNT);
    assert.eq(new Set(first.map(c => c.id)).size, NPC.COUNT);
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
    const shrine = { id: 'shrine', kind: 'chest', poiClass: 'place_of_worship', x: EDGE_M / 2, y: EDGE_M / 2 };
    e.genObjects.push(shrine);
    const residents = NPC.spawn(s, e, 0, 0, {});
    assert.gt(residents.length, 0);
    for (const c of residents) {
      assert.eq(c.culture, 'shrine');
      assert.lte(Math.hypot(c.x - shrine.x, c.y - shrine.y), 6 * CELL_M);
    }
  });

  test('NPC cultures: groves have the fox people, churchyards the shrine neighbours; tar influence excludes residents', () => {
    for (const [terrain, culture, names] of [[T.GROVE, 'grove', /^(Ru|Vix|Tod|Sor)/], [T.CHURCHYARD, 'shrine', /^(Ae|Eli|Gala|Syl)/]]) {
      const residents = NPC.spawn(scene(), entry(terrain), 0, 0, {});
      assert.eq(residents.length, NPC.COUNT);
      for (const c of residents) {
        assert.eq(c.culture, culture);
        assert.truthy(names.test(c.name), `${culture} name prefixes`);
      }
    }
    for (const kind of ['grove', 'stones', 'tar']) {
      // Named zones cover unchanged underlying terrain as well as halos.
      const e = entry(T.PARK);
      e.zone = { idx: new Uint8Array(N * N).fill(1), s: new Uint8Array(N * N).fill(255), anchors: [{ kind }] };
      e.genObjects.push({ id: 'grove_shrine', kind: 'grove_shrine', x: EDGE_M / 2, y: EDGE_M / 2 });
      const residents = NPC.spawn(scene(), e, 0, 0, {});
      assert.eq(residents.length, kind === 'tar' ? 0 : NPC.COUNT);
      assert.truthy(residents.every(c => c.culture === (kind === 'grove' ? 'grove' : 'shrine')));
    }
    assert.eq(NPC.spawn(scene(), entry(T.TAR_YARD), 0, 0, {}).length, 0);
  });

  test('NPC spawn: grove shrine landmarks attract elves outside their painted halo', () => {
    const e = entry(T.FOREST);
    e.genObjects.push({ id: 'grove_shrine', kind: 'grove_shrine', x: EDGE_M / 2, y: EDGE_M / 2 });
    const residents = NPC.spawn(scene(), e, 0, 0, {});
    assert.gt(residents.length, 0);
    assert.truthy(residents.every(c => c.culture === 'shrine'));
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
      assert.eq(c.culture, 'shrine');
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
      assert.eq(talk.target.targetId, 'near');
      assert.eq(talk.target.type, 'object');
      assert.eq(s.save.wayfarerCompass, undefined, 'reading dialogue does not mark the map');
      c._portrait = 'portrait';
      let shown = 0;
      s.showMessageModal = () => {
        shown++;
        assert.eq(s.save.wayfarerCompass.targetId, 'near', 'marker exists when the conversation opens');
      };
      const before = Date.now();
      NPC.interact(s, c, 0, 0);
      assert.eq(shown, 1);
      assert.eq(s.save.wayfarerCompass.depth, 0);
      assert.inRange(s.save.wayfarerCompass.until - before, Scenic.TELESCOPE_DURATION_MS, Scenic.TELESCOPE_DURATION_MS + 1000);
      delete s.save.wayfarerCompass;
      s._dialogOpen = () => true;
      NPC.interact(s, c, 0, 0);
      assert.eq(s.save.wayfarerCompass, undefined, 'blocked conversation does not mark anything');
      s.save.opened = ['near'];
      assert.falsy(NPC.dialogue(s, c, Date.UTC(2026, 8, 28)).body.includes('chest'), 'used and distant discoveries are excluded');
      assert.eq(NPC.dialogue(s, c, Date.UTC(2026, 8, 28)).target, undefined, 'no candidate leaves no mark');
      s.save.opened = [];
      chests[0] = { kind: 'chest', id: 'inn', poiClass: 'lodging', x: 25, y: 0 };
      assert.eq(NPC.dialogue(s, c, Date.UTC(2026, 8, 28)).target, undefined, 'service buildings are not treasure sightings');
      WorldGen.forEachItem = (kind, fn) => fn({ kind: 'slime', id: 'foe', x: 5, y: 10 });
      const foeTalk = NPC.dialogue(s, c, Date.UTC(2026, 8, 28));
      assert.eq(foeTalk.target.targetId, 'foe');
      assert.eq(foeTalk.target.type, 'creature');
      c.kind = 'npc'; c._npcRestUntilEpoch = Date.now() + 10000;
      s._dialogOpen = () => false;
      s.showMessageModal = () => { shown++; };
      NPC.interact(s, c, 0, 0);
      assert.eq(s.save.wayfarerCompass, undefined, 'a resting neighbour gives no directions');

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
      assert.truthy(shown[0].body.includes(MemoryStory.HOME.body), 'the plea first');
      assert.eq(shown[0].okLabel, 'Next', 'a second panel follows');
      shown[0].onDismiss();
      assert.eq(shown.length, 2);
      assert.truthy(shown[1].body.includes(NPC.WARDEN_LINE), 'the introduction retains the safety explanation');
      assert.eq(shown[1].okLabel, 'OK');
      shown[1].onDismiss?.();
      assert.eq(shown.length, 2, 'and ends there');
      s._dialogOpen = () => true;
      NPC.interact(s, w, 0, 0);
      assert.eq(shown.length, 2, 'but not over an open dialog');
    } finally { globalThis.document = g; }
  });
})();

(function () {
  const neighbour = () => ({ kind: 'npc', id: 'recovering_neighbour', name: 'Neighbour', role: 'scout', x: 3, y: 0 });
  const scene = () => ({ cellM: 7, depth: 0, save: { energy: 100, armor: {} },
    cellAt: () => ({ loaded: true, type: WorldGen.T.GRASS }),
    _cellBlocked: () => false, _nearAny: () => false, _shots: [],
    _losePlayerEnergy(n) { this.save.energy -= n; return n; } });

  test('NPC wounds: one hit rests for exactly a minute, survives regeneration, repeated hits do not extend it', () => {
    const s = scene(), c = neighbour(), now = Date.now();
    c._moving = true;
    assert.truthy(NPC.hit(s, c, now));
    assert.falsy(c._moving);
    assert.truthy(NPC.isDormant(c, now + 59999));
    assert.falsy(NPC.hit(s, c, now + 20000));
    assert.eq(s.save.npcRestUntil[c.id], now + 60000);
    const rebuilt = NPC.restore(s, neighbour());
    assert.truthy(NPC.isDormant(rebuilt, now + 59999));
    assert.falsy(NPC.isDormant(rebuilt, now + 60000));
    NPC.tick(s, c, 1000, 0.1);
    assert.eq(c.x, 3, 'wounded body never strolls');
    assert.eq(NPC.dialogue(s, c, now + 1).body, NPC.RESTING_LINE);
    assert.truthy(NPC.hit(s, c, now + 60000), 'recovered neighbours can be hit again');
  });

  test('NPC target selection: closer player wins; dormant, warded and hidden neighbours are ignored', () => {
    const s = scene(), c = neighbour(), foe = {kind: 'zombie', x: 0, y: 0};
    const row = EnemyRoster.get('zombie');
    s._npcCombatTargets = [c];
    assert.eq(NPC.enemyTarget(s, foe, row, 1, 0, false), null);
    assert.eq(NPC.enemyTarget(s, foe, row, 20, 0, false), c);
    assert.eq(NPC.enemyTarget(s, foe, row, 1, 0, true), c);
    s._npcWardContext = { home: {x:3,y:0}, castles:[], radius2:49 };
    assert.eq(NPC.enemyTarget(s, foe, row, 20, 0, false), null);
    s._npcWardContext = null;
    s._cellBlocked = () => true;
    assert.eq(NPC.enemyTarget(s, foe, row, 20, 0, false), null);
    s._cellBlocked = () => false;
    NPC.hit(s, c);
    assert.eq(NPC.enemyTarget(s, foe, row, 20, 0, false), null);
  });

  test('NPC melee: monster windup hits neighbour without draining player and cannot strike resting body', () => {
    const s = scene(), c = neighbour(), foe = {kind:'zombie', id:'attacker', x:0,y:0};
    const row = EnemyRoster.get('zombie');
    const initialHp = Combat.hp(c);
    rosterEnemyAttack(s, foe, row, 10000, c.x, c.y, false, 0.1, c);
    assert.lt(Combat.hp(c), initialHp, 'blight damages the neighbour during melee windup');
    assert.falsy(NPC.isDormant(c), 'the aura tick alone does not end the melee windup');
    assert.eq(foe._attackWindupUntil, 10000 + row.windupSeconds * 1000);
    rosterEnemyAttack(s, foe, row, 10000 + row.windupSeconds * 1000, c.x, c.y, false, 0.1, c);
    assert.truthy(NPC.isDormant(c));
    assert.eq(s.save.energy, 100);
    const deadline = c._npcRestUntilEpoch;
    rosterEnemyAttack(s, foe, row, 20000, c.x, c.y, false, 0.1, c);
    assert.eq(foe._attackWindupUntil, null);
    assert.eq(c._npcRestUntilEpoch, deadline);
  });

  test('NPC ranged attack: archer aims at neighbour and shot collision rests them', () => {
    const s = scene(), c = neighbour(), foe = {kind:'goblin_archer', id:'archer', x:0,y:0};
    c.x = 14;
    const row = EnemyRoster.get('goblin_archer');
    rosterEnemyAttack(s, foe, row, 10000, c.x, c.y, false, 0.1, c);
    rosterEnemyAttack(s, foe, row, 10000 + row.windupSeconds * 1000, c.x, c.y, false, 0.1, c);
    assert.eq(s._shots.length, 1);
    const shot = s._shots[0];
    assert.truthy(shot.hostile);
    assert.gt(shot.vx, 0);
    assert.eq(shot.vy, 0);
    const result = Combat.stepShots([shot], 14 / shot.speedMps, [], 3,
      target => NPC.hit(s, target), {cellM:7,hostileTargets:[c]});
    assert.eq(result.length, 0);
    assert.truthy(NPC.isDormant(c));
    assert.eq(s.save.energy, 100);
  });

  test('NPC target switch: changing victims cancels an already wound-up blow', () => {
    const s = scene(), c = neighbour(), foe = {kind:'brute',id:'brute',x:0,y:0};
    const row = EnemyRoster.get('brute');
    rosterEnemyAttack(s,foe,row,10000,3,0,false,0.1);
    rosterEnemyAttack(s,foe,row,10000 + row.windupSeconds * 1000,3,0,false,0.1,c);
    assert.falsy(NPC.isDormant(c), 'player windup cannot instantly hit a newly selected NPC');
    assert.eq(s.save.energy,100);
  });
})();

test('NPC resting merchant: wound dialogue replaces trading', () => {
  const c = { kind:'npc',id:'resting_merchant',name:'Merchant',role:'merchant',roleLabel:'Peddler',_portrait:'portrait' };
  const shown = [];
  const s = {save:{},_dialogOpen:()=>false,showMessageModal:m=>shown.push(m),
    shopReadiness:()=>{throw new Error('resting merchant cannot trade');}};
  NPC.hit(s,c);
  NPC.interact(s,c,0,0);
  assert.eq(shown.length,1);
  assert.eq(shown[0].body, NPC.RESTING_LINE);
  assert.truthy(/resting my wounds/.test(NPC.RESTING_LINE));
});

test('NPC targeting: membership scan is throttled and rebuilds on depth change', () => {
  const s={save:{},depth:0,cellM:7};
  const c={kind:'npc',id:'near',x:3,y:0}, far={kind:'npc',id:'far',x:1000,y:0};
  const real=WorldGen.forEachItemNear;
  let scans=0;
  WorldGen.forEachItemNear=(kind,tx,ty,fn)=>{scans++; fn(c); fn(far);};
  try {
    NPC.prepareTargets(s,{tx:0,ty:0},0,0,84,1000);
    for(let now=1001;now<1250;now++) NPC.prepareTargets(s,{tx:0,ty:0},0,0,84,now);
    assert.eq(scans,1);
    assert.eq(s._npcCombatTargets.length,1);
    NPC.prepareTargets(s,{tx:0,ty:0},0,0,84,1250);
    assert.eq(scans,2);
    s.depth=1;
    NPC.prepareTargets(s,{tx:0,ty:0},0,0,84,1251);
    assert.eq(scans,3,'surface neighbours cannot become cave targets');
  } finally {WorldGen.forEachItemNear=real;}
});
