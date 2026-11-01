// Luxury help uses real crop watering, path gates, persistent clocks and bag caps.
(() => {
  const N = 48, CELL = 2, EDGE = N * CELL;
  const EPOCH = Date.UTC(2026, 9, 22, 12);
  function fixture(role = 'wanderer', luxury = 2) {
    const save = { caught: [], opened: [], planted: [], inv: [], npcHomes: {}, houseLuxury: { roof: { score: luxury } } };
    const c = WorldGen.makeCreature('npc', 20.5 * CELL, 20.5 * CELL, 'helper',
      { ...NPC.identity('helper', 'village', role), homeX: 20.5 * CELL, homeY: 20.5 * CELL });
    save.npcHomes[c.id] = { houseId: 'roof', x: c.x, y: c.y, houseX: c.x, houseY: c.y };
    const entry = { cellsPerEdge: N, grid: new Uint8Array(N * N).fill(WorldGen.T.PARK),
      roadMask: new Uint8Array(N * N), spawnWhy: new Uint32Array(N * N),
      objects: [], creatures: [c], wildplants: [] };
    const scene = { save, depth: 0, cellM: CELL, cellsPerTile: N, tileEdgeM: EDGE,
      mPerPx: EDGE / WorldGen.TILE_PX, startWorldM: { x: 0, y: 0 }, originPx: { x: 0, y: 0 },
      cellAt(x, y) {
        const ix = Math.floor(x / CELL), iy = Math.floor(y / CELL);
        return { tx: 0, ty: 0, ix, iy, loaded: ix >= 0 && iy >= 0 && ix < N && iy < N,
          type: entry.grid[iy * N + ix], underRoad: !!entry.roadMask[iy * N + ix] };
      },
      _cellBlocked: () => false,
      addToInv(id, n) { return Inventory.add(this.save, id, n).accepted; },
      _burstAtWorld(kind, x, y) { this.bursts = (this.bursts || 0) + 1; this.lastBurst = { kind, x, y }; },
    };
    return { scene, save, c, entry };
  }
  function inWorld(f, run) {
    const cache = WorldGen.tileCache, previous = [...cache];
    cache.clear(); cache.set(WorldGen.tileKey(0, 0), f.entry);
    try { run(f); } finally { cache.clear(); for (const [k, v] of previous) cache.set(k, v); }
  }
  function crop(f, dx = 0, dy = 0, extra = {}) {
    const p = { crop: 'potato', stage: 0, watered_t: 0, x: f.c.homeX + dx * CELL, y: f.c.homeY + dy * CELL, ...extra };
    f.save.planted.push(p); return p;
  }
  function step(f, elapsed = 0, dt = 0.1) {
    return NPCBenefits.tick(f.scene, f.c, elapsed, dt, EPOCH + elapsed);
  }
  test('NPC benefits: only a housed, furnished resident receives luxury help', () => {
    const f = fixture('warden', 3);
    delete f.save.npcHomes.helper;
    assert.eq(NPCBenefits.visit(f.scene, f.c, EPOCH).message, '');
    assert.eq(Inventory.count(f.save, 'wood'), 0);
    f.save.npcHomes.helper = { houseId: 'roof' };
    f.save.houseLuxury.roof.score = 0;
    assert.eq(NPCBenefits.visit(f.scene, f.c, EPOCH).qty, 0);
    f.scene.depth = 1;
    assert.eq(NPCBenefits.summary(f.scene, f.c), '');
  });
  test('NPC benefits: the reward ladder climbs at 4, 12, 20 and 28 luxury', () => {
    assert.eq(JSON.stringify(NPCBenefits.REWARD_STEPS), JSON.stringify([4, 12, 20, 28]));
    const ladder = [[0, 0], [1, 1], [3, 1], [4, 2], [11, 2], [12, 3], [19, 3], [20, 4], [27, 4], [28, 5], [40, 5]];
    for (const [luxury, size] of ladder) assert.eq(NPCBenefits.rewardSize(luxury), size, `${luxury} luxury`);
    const f = fixture('warden', 12);
    assert.eq(NPCBenefits.summary(f.scene, f.c), '3 Wood each day. Visit or talk to collect.');
    assert.eq(NPCBenefits.visit(f.scene, f.c, EPOCH).qty, 3);
  });
  test('NPC benefits: each neighbour gives a distinct ladder-sized daily gift without missed-day banking', () => {
    for (const [role, id] of [['warden', 'wood'], ['witness', 'apple'], ['believer', 'flowers'], ['archaeologist', 'rubble'], ['miner', 'torch'], ['mason', 'berry']]) {
      const f = fixture(role, 3);
      const first = NPCBenefits.visit(f.scene, f.c, EPOCH);
      assert.eq(first.id, id); assert.eq(first.qty, 1, `${role}: one below the first rung`);
      assert.eq(Inventory.count(f.save, id), 1);
      f.save.houseLuxury.roof.score = 8;
      assert.eq(NPCBenefits.visit(f.scene, f.c, EPOCH + 1000).qty, 0, 'same day cannot repeat after furniture upgrade');
      Inventory.remove(f.save, id, 1);
      assert.eq(NPCBenefits.visit(f.scene, f.c, EPOCH + 8 * 86400000).qty, 2, 'only the current day is offered, at the ladder\'s size');
      assert.eq(Inventory.count(f.save, id), 2);
    }
  });
  test('NPC benefits: bag overflow retains the rest of today’s original gift across save reload', () => {
    const f = fixture('warden', 20), cap = Inventory.stackCapFor(f.save, 'wood');
    Inventory.add(f.save, 'wood', cap - 2);
    assert.eq(NPCBenefits.visit(f.scene, f.c, EPOCH).qty, 2, 'two of today\'s four fit');
    f.scene.save = f.save = JSON.parse(JSON.stringify(f.save));
    f.save.houseLuxury.roof.score = 28;
    assert.eq(NPCBenefits.visit(f.scene, f.c, EPOCH + 1).qty, 0, 'full bag cannot consume remaining gift');
    Inventory.remove(f.save, 'wood', 10);
    assert.eq(NPCBenefits.visit(f.scene, f.c, EPOCH + 2).qty, 2, 'only original uncollected portion remains');
  });
  test('NPC benefits: a full bag on the first visit still pins today’s gift quantity', () => {
    const f = fixture('warden', 4), cap = Inventory.stackCapFor(f.save, 'wood');
    Inventory.add(f.save, 'wood', cap);
    assert.eq(NPCBenefits.visit(f.scene, f.c, EPOCH).qty, 0);
    f.save.houseLuxury.roof.score = 12;
    f.scene.save = f.save = JSON.parse(JSON.stringify(f.save));
    Inventory.remove(f.save, 'wood', cap);
    assert.eq(NPCBenefits.visit(f.scene, f.c, EPOCH + 1).qty, 2,
      'the day pins the quantity at the luxury the first visit evaluated');
  });
  test('NPC benefits: a housed scout gives new directions every day, as many as the ladder earns', () => {
    const f = fixture('scout', 4), sighting = id => ({ o: { id, x: 0, y: 0 }, label: 'chest', d: 1 });
    const candidates = ['b', 'a', 'c'].map(sighting), ids = picks => picks.map(p => p.o.id).join();
    const DAY = 86400000;
    assert.eq(ids(NPCBenefits.directions(f.scene, f.c, candidates, EPOCH)), 'a,b', 'two at four luxury, fresh ones first by id');
    assert.eq(ids(NPCBenefits.directions(f.scene, f.c, candidates, EPOCH + 1000)), 'a,b', 'pinned for the day');
    f.save.houseLuxury.roof.score = 40;
    assert.eq(ids(NPCBenefits.directions(f.scene, f.c, candidates, EPOCH + 2000)), 'a,b', 'furniture added today does not re-roll today');
    f.save.houseLuxury.roof.score = 4;
    assert.eq(ids(NPCBenefits.directions(f.scene, f.c, candidates, EPOCH + DAY)), 'c,a', 'tomorrow: the one never given, then the longest ago');
    f.scene.save = f.save = JSON.parse(JSON.stringify(f.save));
    assert.eq(ids(NPCBenefits.directions(f.scene, f.c, candidates, EPOCH + DAY + 1)), 'c,a', 'the day survives reload');
    assert.eq(ids(NPCBenefits.directions(f.scene, f.c, candidates, EPOCH + 2 * DAY)), 'b,a');
    assert.eq(ids(NPCBenefits.directions(f.scene, f.c, [sighting('z')], EPOCH + 3 * DAY)), 'z', 'never more than there is to see');
    assert.eq(NPCBenefits.summary(f.scene, f.c), '2 new directions each day. Talk to hear them.');
    assert.eq(NPCBenefits.visit(f.scene, f.c, EPOCH).message, NPCBenefits.summary(f.scene, f.c), 'a visit hears the summary, not a berry');
    assert.eq(Inventory.count(f.save, 'berry'), 0);
    f.save.houseLuxury.roof.score = 0;
    assert.eq(NPCBenefits.directions(f.scene, f.c, candidates, EPOCH + 4 * DAY), null, 'a bare home: the unhoused daily pick');
    delete f.save.npcHomes.helper;
    assert.eq(NPCBenefits.directions(f.scene, f.c, candidates, EPOCH + 4 * DAY), null, 'unhoused: the unhoused daily pick');
  });
  test('NPC benefits: a housed scout\'s talk points at every direction of the day, with the story after', () => {
    const f = fixture('scout', 12);
    f.scene.houseShopRole = () => null;
    f.scene.showMessageModal = p => { f.scene.shown = p; };
    for (let i = 0; i < 9; i++) (f.save.discovered ||= {})[`m${i}`] = 1;   // act 1, the rumour due
    f.save.restoredHouses = {};
    const realWalk = WorldGen.forEachItemInBox, realAll = WorldGen.forEachItem;
    const cache = Array.from(WorldGen.tileCache.entries());
    WorldGen.tileCache.clear(); WorldGen.tileCache.set('0,0', {});
    WorldGen.forEachItemInBox = () => {};
    WorldGen.forEachItem = (kind, fn) => { for (const id of ['foe2', 'foe1', 'foe3', 'foe4']) fn({ kind: 'slime', id, x: 5, y: 10 }); };
    try {
      const talk = NPC.dialogue(f.scene, f.c, EPOCH);
      assert.eq(talk.targets.map(t => t.targetId).join(), 'foe1,foe2,foe3', 'three at twelve luxury');
      assert.eq(talk.target.targetId, 'foe1');
      assert.eq((talk.pages[0].match(/roams/g) || []).length, 3, 'one sighting line each');
      assert.eq(talk.pages.length, 3, 'directions, the rumour, the help summary');
      assert.truthy(/Old Tim/.test(talk.pages[1]), 'the story is a page after the directions, not instead');
      assert.eq(talk.pages[2], NPCBenefits.summary(f.scene, f.c));
      // The talk itself speaks for today: its marks are today's three.
      NPC.interact(f.scene, f.c, 0, 0);
      const today = NPC.dialogue(f.scene, f.c).targets.map(t => t.targetId);
      assert.eq(today.length, 3);
      assert.eq(f.save.wayfarerCompass.map(m => m.targetId).join(), today.join(), 'every direction of the day marks the rim');
      delete f.save.npcHomes.helper;
      const unhoused = NPC.dialogue(f.scene, f.c, EPOCH);
      assert.truthy(/Old Tim/.test(unhoused.body) && !/roams/.test(unhoused.body), 'unhoused, the story still replaces the daily pick');
    } finally {
      WorldGen.forEachItemInBox = realWalk; WorldGen.forEachItem = realAll;
      WorldGen.tileCache.clear(); for (const [key, value] of cache) WorldGen.tileCache.set(key, value);
    }
  });
  test('Tilly: watering uses crop rules without borrowing the player’s watering can', () => inWorld(fixture(), f => {
    const p = crop(f);
    f.save.relics = { watering_can: { tier: 7 } };
    assert.falsy(/Hey, I watered/.test(NPCBenefits.dialogue(f.scene, f.c, EPOCH)), 'no claim before actual work');
    assert.truthy(step(f));
    assert.eq(p.watered_t, EPOCH);
    assert.eq(p.stage, 0, 'no Frost can jump');
    assert.eq(p.hold_ms, Crops.stageHoldMs(p.crop));
    assert.eq(f.scene.lastBurst.kind, 'water'); assert.eq(f.scene.lastBurst.x, p.x);
    assert.eq(f.save.npcBenefits.helper.wateringUntil, EPOCH + 2 * NPCBenefits.MINUTE_MS);
    assert.eq(NPCBenefits.visit(f.scene, f.c, EPOCH).message, 'Hey, I watered your crops today.');
    assert.falsy(/Hey, I watered/.test(NPCBenefits.dialogue(f.scene, f.c, EPOCH + 86400000)), 'report expires with UTC day');
  }));
  test('Tilly: range is measured from her house and rejects mature, wet and underground crops', () => inWorld(fixture(), f => {
    const wet = crop(f, 0, 0, { watered_t: EPOCH - 1 });
    const ripe = crop(f, 0, 0, { stage: Crops.maxStage() });
    const cave = crop(f, 0, 0, { depth: 1 });
    const far = crop(f, 16);
    assert.falsy(step(f));
    assert.eq(f.save.npcBenefits.helper.wateringUntil, undefined);
    assert.eq(wet.watered_t, EPOCH - 1); assert.eq(ripe.watered_t, 0);
    assert.eq(cave.watered_t, 0); assert.eq(far.watered_t, 0);
    const near = crop(f, 15);
    step(f, 1000, 0);
    assert.gt(f.save.npcBenefits.helper.wateringUntil, EPOCH, 'closed 15-cell boundary is included');
    assert.eq(near.watered_t, 0, 'does not remotely water the boundary crop');
  }));
  test('Tilly: physically walks to crops beyond her normal stroll and returns home when work ends', () => inWorld(fixture('wanderer', 1), f => {
    const p = crop(f, 6);
    let furthest = f.c.x;
    for (let elapsed = 0; elapsed < 30000 && !p.watered_t; elapsed += 100) {
      step(f, elapsed); furthest = Math.max(furthest, f.c.x);
    }
    assert.gt(furthest, f.c.homeX + NPC.WANDER_CELLS * CELL, 'work leaves normal four-cell stroll');
    assert.gt(p.watered_t, 0, 'waters only after reaching the crop');
    const until = f.save.npcBenefits.helper.wateringUntil;
    for (let elapsed = until - EPOCH; elapsed < until - EPOCH + 30000; elapsed += 100) step(f, elapsed);
    assert.lte(Math.hypot(f.c.x - f.c.homeX, f.c.y - f.c.homeY), CELL, 'comes home without teleporting');
    assert.eq(f.save.npcBenefits.helper.nextWateringAt, until + NPCBenefits.HOUR_MS);
  }));
  test('Tilly: an exclusion barrier blocks work without watering through it', () => inWorld(fixture(), f => {
    const p = crop(f, 4);
    for (let iy = 0; iy < N; iy++) f.entry.spawnWhy[iy * N + 22] = WorldGen.SPAWN_WHY.TERRAIN;
    for (let elapsed = 0; elapsed < 5000; elapsed += 100) step(f, elapsed);
    assert.eq(p.watered_t, 0);
    assert.eq(f.c.x, f.c.homeX, 'no illegal movement through excluded cells');
    assert.falsy(/Hey, I watered/.test(NPCBenefits.dialogue(f.scene, f.c, EPOCH + 5000)));
  }));
  test('Tilly: loaded home chores continue past the player’s 12-cell creature bubble', () => inWorld(fixture('wanderer', 1), f => {
    const p = crop(f, 15), player = { x: f.c.x, y: f.c.y };
    assert.truthy(NPCBenefits.shouldSimulate(f.scene, f.c), 'idle furnished resident is scheduled before work begins');
    let beyondBubble = false;
    for (let elapsed = 0; elapsed < 110000; elapsed += 100) {
      const near = Math.hypot(f.c.x - player.x, f.c.y - player.y) <= 12 * CELL;
      if (!near) beyondBubble = true;
      assert.truthy(near || NPCBenefits.shouldSimulate(f.scene, f.c), 'both outbound work and returning remain eligible');
      step(f, elapsed);
    }
    assert.truthy(beyondBubble, 'resident actually passes the ordinary simulation boundary');
    assert.gt(p.watered_t, 0, 'reaches the 15-cell crop while the player stays home');
    assert.lte(Math.hypot(f.c.x - player.x, f.c.y - player.y), CELL, 'returns after the run expires');
    for (const c of [{ ...f.c, kind: 'slime' }, { ...f.c, role: 'warden' }, { ...f.c, id: 'unhoused' }]) {
      assert.falsy(NPCBenefits.shouldSimulate(f.scene, c), 'other far creatures keep their normal cull');
    }
    f.scene.cellAt = () => ({ loaded: false });
    assert.falsy(NPCBenefits.shouldSimulate(f.scene, f.c), 'unloaded homes never extend simulation');
    const source = ALL_SRC['scene_creatures.js'];
    assert.truthy(source.includes('ddx * ddx + ddy * ddy <= RANGE_SQ || homeChoreActive(c)'), 'refresh admits working residents');
    assert.eq((source.match(/ddx \* ddx \+ ddy \* ddy > RANGE_SQ && !homeChoreActive\(c\)/g) || []).length, 2,
      'both cached membership and per-creature execution keep the exception');
  }));
  test('Tilly: expired saved work never backfills watering and the hour’s rest survives reload', () => inWorld(fixture('wanderer', 1), f => {
    const p = crop(f);
    step(f, 0, 0);
    const until = f.save.npcBenefits.helper.wateringUntil;
    f.scene.save = f.save = JSON.parse(JSON.stringify(f.save));
    step(f, until - EPOCH + 1000, 0);
    assert.eq(f.save.planted[0].watered_t, 0, 'offline run produced no watering');
    assert.eq(f.save.npcBenefits.helper.wateringUntil, 0);
    step(f, until - EPOCH + NPCBenefits.HOUR_MS - 1, 0);
    assert.eq(f.save.npcBenefits.helper.wateringUntil, 0, 'waits a full hour after prior run ends');
    step(f, until - EPOCH + NPCBenefits.HOUR_MS, 0.1);
    assert.gt(f.save.planted[0].watered_t, 0, 'starts one real foreground run when due');
    assert.eq(p.watered_t, 0, 'only the reloaded live crop was watered');
  }));
  test('Tilly: the real creature scheduler admits distant home chores and keeps distant enemies frozen', () => inWorld(fixture(), f => {
    const { scene, save, c, entry } = f;
    Object.assign(save, { energy: 1000, armor: {}, fires: [], released: [] });
    Object.assign(scene, { playerM: { x: c.homeX, y: c.homeY }, viewCenterX: 0, viewCenterY: 0, _shots: [],
      isShadowActive: () => false, isUnnoticed: () => false, homeWorldPos: () => null,
      _castleWardPoints: () => [], playerToWorldCell: () => ({ tx: 0, ty: 0, ix: 20, iy: 20 }),
      _nearAny: () => false, _nextGhostT: Infinity, _cropRaidable: () => false,
    });
    c.x += 14 * CELL;
    const foe = WorldGen.makeCreature('slime', c.x, c.y + CELL, 'far_foe');
    entry.creatures.push(foe);
    const tick = NPC.tick;
    let visits = 0;
    NPC.tick = (s, resident) => { if (resident === c) visits++; };
    try {
      __wander.call(scene);
      __wander.call(scene);
      assert.eq(visits, 2, 'new and cached scheduler memberships execute distant Tilly');
      assert.truthy(scene._activeCreatures.includes(c));
      assert.falsy(scene._activeCreatures.includes(foe), 'enemy simulation radius stays unchanged');
    } finally { NPC.tick = tick; }
  }));
})();
