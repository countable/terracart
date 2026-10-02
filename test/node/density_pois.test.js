// THE DENSITY POIs (Sep 2026) — what a POI class's COUNT on its tile does,
// beyond the chest tier (chest_tier.test.js):
//   • crates restock after density-scaled days (loot.js crateRestoreDays),
//     off the day ledger that now keeps a week (macros.js markToday /
//     daysSinceTaken / restockWaitMs);
//   • bins and recycling points are breakable barrels or clay pots, with
//     separate loot profiles and a fixed 70% empty chance;
//   • a bike rack lends the stick walk BIKE_RACK_SPEED_MUL for BIKE_RACK_MS
//     through the ONE speed lane (app.js _walkRelics → items.js
//     steerSpeedMul), once a UTC day;
//   • a gate is two posts round a daily spawn point (worldgen.js
//     gatePostsAt, lairs.js 'gate'), not a chest;
//   • an information POI is a notice board that reads one Book page
//     (INTERACTABLES.infoboard — the waystone's lane);
//   • road furniture that is no place mints nothing (SX_NOT_A_PLACE).
(function () {
  const DAY = 24 * 60 * 60 * 1000;
  const T0 = Date.UTC(2026, 8, 28, 12, 0, 0);
  const dayKeyAt = (t) => Delivery.dayKey(new Date(t));
  let seq = 0;
  const poi = (poiClass, over) => ({ kind: 'chest', id: `c_9_9_9_${++seq}`, poiClass, x: 0, y: 0, ...over });

  // ── Restock days ─────────────────────────────────────────────────────────
  test('restock: an ordinary crate is bare a day, one more per further 25 of its kind, a week at most', () => {
    const want = { 1: 1, 24: 1, 25: 1, 49: 1, 50: 2, 74: 2, 75: 3, 100: 4, 150: 6, 174: 6, 175: 7, 176: 7, 5000: 7 };
    for (const [n, d] of Object.entries(want)) assert.eq(crateRestoreDays({ poiDensity: Number(n) }), d, `${n} of a kind`);
    assert.eq(crateRestoreDays({}), 1, 'an unstamped crate restocks daily');
    assert.eq(CRATE_RESTORE_PER, CHEST_DENSITY_T1_AT, 'one day per "dense" — the tier table\'s number');
    assert.eq(CRATE_RESTORE_MAX_DAYS, 7, 'a week');
    assert.eq(Macros.LEDGER_KEEP_DAYS, CRATE_RESTORE_MAX_DAYS, 'the ledger keeps exactly as long as the longest restock');
  });

  test('restock: the ledger knows how long ago, and how long to wait', () => {
    const save = {};
    assert.eq(Macros.daysSinceTaken(save, 'c_a', T0), Infinity, 'never taken');
    Macros.markToday(save, 'c_a', T0);
    assert.eq(Macros.daysSinceTaken(save, 'c_a', T0), 0, 'today');
    assert.eq(Macros.daysSinceTaken(save, 'c_a', T0 + 2 * DAY), 2, 'two days on');
    assert.truthy(Macros.stillBare(save, 'c_a', 3, T0 + 2 * DAY), 'a three-day crate is still bare on day two');
    assert.falsy(Macros.stillBare(save, 'c_a', 3, T0 + 3 * DAY), 'and back on day three');
    assert.falsy(Macros.stillBare(save, 'c_a', 1, T0 + DAY), 'a daily one is back tomorrow');
    // The wait: the rest of today plus the whole days still to run.
    assert.eq(Macros.restockWaitMs(save, 'c_a', 3, T0), msToNextUtcDay(T0) + 2 * DAY, 'taken today, three days');
    assert.eq(Macros.restockWaitMs(save, 'c_a', 1, T0), msToNextUtcDay(T0), 'a daily one: midnight');
    assert.eq(Macros.restockWaitMs(save, 'c_a', 3, T0 + 3 * DAY), 0, 'nothing to wait for once back');
    assert.eq(shortDuration(Macros.restockWaitMs(save, 'c_a', 7, T0)), '7d', 'a week prints as days');
    // Pruned a week on.
    Macros.markToday(save, 'c_b', T0 + 7 * DAY);
    assert.falsy(('c_a' + dayKeyAt(T0)) in save.coinBurstClaimed, 'a week-old take is pruned');
    assert.truthy(('c_b' + dayKeyAt(T0 + 7 * DAY)) in save.coinBurstClaimed, 'the new one kept');
  });

  test('restock: a crowded crate stays bare its days — spent, unlit, and says how long', () => {
    const crate = poi('bus', { poiDensity: 80, tierSeed: 1 }); // density sets 3 days; the seed makes it a crate
    assert.eq(crateRestoreDays(crate), 3);
    assert.truthy(restocks(crate), 'a T1 bus stop restocks');
    const ago = (k) => spentSets(null, { coinBurstClaimed: { [crate.id + dayKeyAt(Date.now() - k * DAY)]: 1 } });
    assert.truthy(isSpent(crate, ago(0)) && isSpent(crate, ago(2)), 'bare today and two days on');
    assert.falsy(isSpent(crate, ago(3)), 'back on the third day');
    assert.falsy(poiLit(crate, ago(1)), 'dark while bare');
    assert.truthy(poiLit(crate, ago(3)), 'lit once back');
    // The tap refuses with the real wait.
    const save = { inv: [], opened: [], relics: {}, money: 0 };
    Macros.markToday(save, crate.id, Date.now() - DAY);
    const flashes = [];
    runInteractable(makeCtx(makeScene({ flash: (m) => flashes.push(m) }), save), crate);
    const wait = shortDuration(Macros.restockWaitMs(save, crate.id, 3));
    assert.eq(flashes[0], `The crate is bare. ${wait}.`, 'the refusal prints the wait');
    assert.truthy(/^The crate is bare\. [12]d\.$/.test(flashes[0]), `a day and a bit: ${flashes[0]}`);
  });

  test('restock: the pot of gold, the bike rack, the chapel and the shrine stay DAILY', () => {
    const pot = poi('atm', { poiDensity: 200 }), rack = poi('bicycle_parking', { poiDensity: 200 });
    const yday = spentSets(null, { coinBurstClaimed: { [pot.id + dayKeyAt(Date.now() - DAY)]: 1, [rack.id + dayKeyAt(Date.now() - DAY)]: 1 } });
    assert.falsy(isSpent(pot, yday), 'a pot taken yesterday is back, however crowded');
    assert.falsy(isSpent(rack, yday), 'so is a rack');
    assert.falsy(restocks(pot) || restocks(rack), 'neither is a crate');
    const src = INTERACTABLES_SRC;
    assert.truthy(/Macros\.serviceUsedToday\(save, o\.id\)\) \{\s*scene\.flash\(`The chapel is quiet/.test(src), 'the chapel reads the service-day gate');
    assert.truthy(/grove_shrine: \{[\s\S]{0,200}Macros\.dailyVisit\(ctx, o/.test(src), 'and the shrine');
  });

  // ── Barrels ──────────────────────────────────────────────────────────────
  test('barrel: clay pots keep their intact/broken pair, distinct rewards and shared restock', () => {
    const seen = new Set();
    for (let i = 0; i < 40; i++) {
      const b = poi('waste_basket', { id: `container_${i}`, poiDensity: 50 });
      const look = chestLook(b);
      seen.add(look.texKey);
      assert.eq(tillBlockerLine(b), look.texKey === 'clay_pot' ? 'A clay pot stands here.' : 'A barrel stands here.', 'blocker names the visible object');
      assert.eq(look.smashedKey, look.texKey + '_smashed', 'broken state matches the intact object');
      assert.truthy(SpriteLayout.ART_BOUNDS[look.texKey + ':0'], 'intact art seats in its cell');
      assert.truthy(SpriteLayout.ART_BOUNDS[look.smashedKey + ':0'], 'broken art seats in its cell');
      const reloaded = { ...b, _chestLook: undefined, x: 1234, y: -45, _smashed: true };
      assert.eq(chestLook(reloaded).texKey, look.texKey, 'reload, position and spent overlays keep the pair');
      assert.truthy(restocks(b), 'both use the recurring container ledger');
      assert.eq(crateRestoreDays(b), 2, 'same density-based restock');
      assert.eq(rollBarrel(b, () => 0).kind, 'empty', 'empty roll is still empty');
      assert.eq(barrelProfile(b).texKey, look.texKey, 'loot profile matches visible art');
    }
    assert.eq([...seen].sort().join(','), 'barrel,clay_pot', 'both cosmetic pairs occur');
  });

  test('barrel: a bin or a recycling point is a barrel, whatever its count; it restocks like a crate', () => {
    for (const cls of ['waste_basket', 'recycling']) {
      for (const n of [1, 5, 40]) {
        const b = poi(cls, { poiDensity: n });
        assert.truthy(isBarrel(b), `${cls} ×${n} is a barrel`);
        assert.includes(['barrel', 'clay_pot'], chestLook(b).texKey, 'wears a breakable container');
        assert.falsy(chestLook(b).box, 'not the crate look');
        assert.truthy(restocks(b), 'restocks');
      }
    }
    assert.eq(JSON.stringify([...BARREL_CLASSES].sort()), '["recycling","waste_basket"]');
    assert.falsy(isBarrel(poi('waste_basket', { depth: 1 })), 'never underground');
    assert.falsy(isBarrel(poi('bus')), 'a bus stop is no barrel');
  });

  test('breakables: exact category odds, tiers and density-independent loot', () => {
    const expected = {
      barrel: { empty: 700, supply: 100, mineral: 100, produce: 100 },
      clay_pot: { empty: 700, magic: 50, produce: 50, coin: 100, seed: 100 },
    };
    for (const art of BARREL_ART) {
      const o = Array.from({ length: 40 }, (_, i) => ({ id: `container_${i}` }))
        .find(o => barrelProfile(o).texKey === art.texKey);
      for (const density of [1, 50, 500]) {
        const counts = {};
        for (let i = 0; i < 1000; i++) {
          let first = true;
          const rng = () => first ? (first = false, (i + 0.5) / 1000) : 0.5;
          const result = rollBarrel({ ...o, poiDensity: density }, rng);
          let category = result.kind;
          if (result.kind === 'gold') { category = 'coin'; assert.eq(result.amount, 1); }
          if (result.kind === 'item') {
            const item = ITEM_BY_ID[result.id]; category = item.kind;
            assert.eq(result.qty, 1);
            const row = art.loot.find(row => row.kind === category);
            if (row.ids) assert.includes(row.ids, item.id);
            else assert.inRange(item.baseTier, row.minTier ?? 1, row.maxTier ?? Infinity);
          }
          counts[category] = (counts[category] || 0) + 1;
        }
        assert.eq(JSON.stringify(counts), JSON.stringify(expected[art.texKey]), art.texKey + ' odds at density ' + density);
      }
      for (const row of art.loot.filter(row => !['empty', 'coin'].includes(row.kind))) {
        const pool = barrelLootPool(row);
        assert.gt(pool.length, 0, 'every promised category has eligible items');
        for (const item of pool) {
          assert.eq(item.kind, row.kind);
          assert.falsy(item.uniqueJewelry || item.caveOnly || item.cooked || item.shiny);
          if (!row.ids) assert.inRange(item.baseTier, row.minTier ?? 1, row.maxTier ?? Infinity);
        }
      }
    }
  });

  test('barrel: a smash pays once, stands smashed while bare, and says what came out', () => {
    const b = poi('waste_basket', { poiDensity: 1 });
    const save = { inv: [], opened: [], relics: {}, money: 0 };
    const flashes = [], loots = [];
    const scene = makeScene({ flash: (m) => flashes.push(m), flashLoot: (m) => loots.push(m), coinIconEl: () => null });
    runInteractable(makeCtx(scene, save), b);
    assert.truthy(Macros.usedToday(save, b.id), 'the day ledger holds it');
    assert.eq(save.opened.length, 0, 'never save.opened');
    const said = [...flashes, ...loots];
    assert.eq(said.length, 1, 'one line');
    const messages = ['Empty.', '+1 coin', ...barrelProfile(b).loot.flatMap(row => barrelLootPool(row).map(item => '+1 ' + item.name))];
    assert.includes(messages, said[0], 'the line names an eligible reward');
    runInteractable(makeCtx(scene, save), b);
    assert.truthy(/^Smashed\. Back in \d+[smhd]\.$/.test(flashes[flashes.length - 1]), 'a second smash is refused with the wait');
    const sets = spentSets(null, save);
    assert.truthy(isSpent(b, sets), 'spent while bare');
    assert.falsy(poiLit(b, sets), 'and dark');
    // The renderer keeps it, smashed — one art per state.
    assert.truthy(/if \(o\.kind === 'chest' && isBarrel\(o\)\) \{ o\._smashed = spent; return true; \}/.test(RENDER_SRC),
      'render.js keeps a spent barrel on the draw list');
    assert.truthy(/\(L\.barrel && o\._smashed\) \? L\.smashedKey : L\.texKey/.test(RENDER_SRC), 'and draws it smashed');
    assert.truthy(/barrel_smashed: +\{ kind: 'spritesheet', path: 'assets\/Objects\/Approved\/barrel_smashed\.png'/.test(ASSETS_SRC),
      'the smashed art is loaded');
  });

  // ── Bike racks ───────────────────────────────────────────────────────────
  // app.js _walkRelics, lifted and run against a fake scene: the ONE lane
  // every stick speed reads.
  const liftWalkRelics = () => {
    const src = SCENE_SRC;
    const a = src.indexOf('\n  _walkRelics() {');
    const b = src.indexOf('\n  }\n', a);
    const body = src.slice(src.indexOf('{', a) + 1, b);
    return new Function('DRAGON_WALK_COST_TIER', 'SPEED_POTION_WALK_COST_TIER', 'COFFEE_BOOT_BOOST', 'BIKE_RACK_SPEED_MUL',
      `return function () {${body}\n};`)(CONSUMABLE_SPEC.dragon_powder.movementTier,
        CONSUMABLE_SPEC.speed_potion.movementTier, CONSUMABLE_SPEC.coffee.speedTierBoost,
        BIKE_RACK_SPEED_MUL);
  };

  test('bike rack: a tap lends the bike for three minutes, once a UTC day', () => {
    const rack = poi('bicycle_parking', { poiDensity: 12 });
    assert.truthy(isBikeRack(rack), 'a bike rack');
    assert.eq(chestLook(rack).texKey, 'bike_rack', 'wears its own art');
    const save = { inv: [], opened: [], relics: {}, money: 0 };
    const flashes = [];
    const scene = makeScene({ flash: (m) => flashes.push(m) });
    const before = Date.now();
    runInteractable(makeCtx(scene, save), rack);
    assert.inRange(save.bikeUntil - before, BIKE_RACK_MS, BIKE_RACK_MS + 1000, 'three minutes from now');
    assert.eq(BIKE_RACK_MS, 3 * 60 * 1000);
    assert.eq(flashes[0], bikeRackFlash(), 'says so');
    assert.truthy(Macros.usedToday(save, rack.id), 'the day ledger holds it');
    save.bikeUntil = 0;
    runInteractable(makeCtx(scene, save), rack);
    assert.eq(save.bikeUntil, 0, 'no second bike today');
    assert.truthy(/^Horse is out\. \d+[smhd]\.$/.test(flashes[1]), `the wait: ${flashes[1]}`);
    assert.truthy(poiLit(rack, spentSets(null, {})), 'lit while there');
    assert.falsy(poiLit(rack, spentSets(null, save)), 'dark once taken');
  });

  test('bike rack: +100% on the stick through the one speed lane, gone when it expires', () => {
    assert.eq(BIKE_RACK_SPEED_MUL, 2, '+100%');
    const walk = liftWalkRelics();
    const scene = (save) => ({ save, isDragonActive: () => false });
    const plain = walk.call(scene({ armor: { boots: { tier: 3 } }, relics: {} }));
    const biked = walk.call(scene({ armor: { boots: { tier: 3 } }, relics: {}, bikeUntil: Date.now() + 60000 }));
    const lapsed = walk.call(scene({ armor: { boots: { tier: 3 } }, relics: {}, bikeUntil: Date.now() - 1 }));
    assert.eq(steerSpeedMul(biked), 2 * steerSpeedMul(plain), 'the stick is twice as fast');
    assert.eq(steerSpeedMul(lapsed), steerSpeedMul(plain), 'and back to normal once it lapses');
    assert.eq(steerEnergyCost(biked), steerEnergyCost(plain), 'the cost per cell is untouched');
    assert.eq(biked.boots.tier, plain.boots.tier, 'a factor, not lent tiers');
    // A dragon's lent tiers and the bike stack: the lane multiplies whatever
    // the boots are.
    const dragon = walk.call({ save: { armor: {}, relics: {}, bikeUntil: Date.now() + 60000 }, isDragonActive: () => true });
    assert.eq(steerSpeedMul(dragon), 2 * steerSpeedMul({ boots: { tier: dragon.boots.tier } }), 'on top of the dragon');
  });

  test('bike rack: stick walking only — the GPS walk never reads the lane', () => {
    // Every steerSpeedMul reader in the scene is a stick path: the stick itself,
    // the drift back home and the follow cap while the stick is pushed. The
    // debug readout's `${steerSpeedMul(…)}` only prints it.
    const calls = SCENE_SRC.match(/(?<!\$\{)steerSpeedMul\([^)]*\)/g) || [];
    assert.eq(calls.length, 3, 'three readers');
    assert.truthy(/const step = WALK_M_S \* steerSpeedMul\(relics\) \* dt;/.test(SCENE_SRC), 'the stick (_steerManual)');
    assert.truthy(/const stickMul = this\._stickPushed\(\) \? steerSpeedMul\(this\._walkRelics\(\)\) : 1;/.test(SCENE_SRC),
      'the follow cap, only while the stick is pushed');
    assert.truthy(/const bike = \(this\.save\.bikeUntil \?\? 0\) > Date\.now\(\) \? BIKE_RACK_SPEED_MUL : 1;/.test(SCENE_SRC),
      '_walkRelics reads the loan');
    assert.truthy(/const boost = Math\.max\(bike, riding \? HORSE_RIDE\.speedMul : 1\);/.test(SCENE_SRC),
      'a ridden horse is the same kind of factor, never stacked on the loan');
    assert.falsy(/bikeUntil/.test(SCENE_SRC.replace(/_walkRelics\(\) \{[\s\S]*?\n  \}\n/, '')), 'nothing else in app.js reads it');
  });

  // ── Gates ────────────────────────────────────────────────────────────────
  const CPE = 64, EXT = 4096, CELL = EXT / CPE, EDGE = 640, CM = EDGE / CPE;
  const pt = (ix, iy) => [[{ x: (ix + 0.5) * CELL, y: (iy + 0.5) * CELL }]];
  const cellOf = (o) => ({ ix: Math.floor(o.x / CM), iy: Math.floor(o.y / CM) });
  const build = (feats, roads) => WorldGen.rasterizeTile(
    [...(roads ? [{ name: 'transportation', features: roads }] : []), { name: 'poi', features: feats }], CPE, 0, 0, EDGE);

  test('gate: no chest — two posts either side of a spawn point', () => {
    const r = build([{ type: 1, tags: { class: 'gate' }, geom: pt(20, 20) }]);
    assert.eq(r.objects.filter((o) => o.kind === 'chest').length, 0, 'a gate is no chest');
    const posts = r.objects.filter((o) => o.kind === 'gatepost');
    assert.eq(posts.length, 2, 'two posts');
    const cells = posts.map(cellOf);
    assert.eq(cells.map((c) => c.ix + ',' + c.iy).sort().join(' '), '19,20 21,20', 'either side of the gate');
    for (const p of posts) {
      assert.eq(p.gateSid, 'gate_0_0_20_20', 'both carry the gate\'s own id');
      assert.eq(cellOf({ x: p.gateX, y: p.gateY }).ix + ',' + cellOf({ x: p.gateX, y: p.gateY }).iy, '20,20', 'and its point');
      assert.falsy(INTERACTABLES.gatepost, 'a post is not tappable');
    }
    assert.falsy(WorldGen.POI_USEFUL.has('gate'), 'gate is off the chest list');
  });

  test('gate: across a way the posts stand on the fence line, off the road', () => {
    const road = { type: 2, tags: { class: 'minor' }, geom: [[{ x: 0, y: 20.5 * CELL }, { x: EXT, y: 20.5 * CELL }]] };
    const r = build([{ type: 1, tags: { class: 'gate' }, geom: pt(20, 20) }], [road]);
    const posts = r.objects.filter((o) => o.kind === 'gatepost');
    assert.eq(posts.length, 2, 'two posts');
    const cells = posts.map(cellOf);
    assert.truthy(cells.every((c) => c.ix === 20), 'north and south of an east-west way');
    for (const c of cells) assert.eq(r.roadMask[c.iy * CPE + c.ix], 0, 'never on the road');
  });

  test('gate: a foe rises there each UTC day — one guard, every mode, a slime or a goblin', () => {
    assert.eq(Lairs.capFor('gate', 0), 1, 'one guard');
    assert.eq(Lairs.capFor('gate', 1), 1, 'however strong');
    assert.truthy(Lairs.ALWAYS_AWAKE_TIERS.has('gate'), 'every mode');
    assert.truthy(Lairs.DAILY_TIERS.has('gate'), 'daily');
    assert.eq(Lairs.OCCUPANCY.gate.rate, 1, 'always held');
    for (const k of Lairs.KIND_ORDER.gate) assert.truthy(Combat.isEnemyKind(k), `${k} is a foe`);
    const r = build([{ type: 1, tags: { class: 'gate' }, geom: pt(20, 20) }]);
    const posts = r.objects.filter((o) => o.kind === 'gatepost');
    const occupied = new Set(r.objects.map((o) => { const c = cellOf(o); return c.iy * CPE + c.ix; }));
    const lair = { tier: 'gate', sid: posts[0].gateSid, lx: posts[0].gateX, ly: posts[0].gateY };
    const wake = (dayKey) => {
      const entry = { grid: r.grid, cellsPerEdge: CPE, buildingShapes: [], _spawnOpts: { roadMask: r.roadMask, occupied },
        streetLairs: [lair], creatures: [] };
      Lairs.stepResidency([{ entry, tx: 0, ty: 0 }], {
        cellM: CM, tileEdgeM: EDGE, playerM: { x: lair.lx, y: lair.ly }, homeM: { x: -1e6, y: 0 },
        caughtSet: new Set(), buildings: false, dayKey,
      });
      return entry.creatures;
    };
    const d1 = wake('20260928'), d2 = wake('20260929');
    assert.eq(d1.length, 1, 'one guard rises (easy — buildings off)');
    assert.eq(d1[0].id, `lair_${lair.sid}_20260928_0`, 'its id carries the day');
    assert.eq(d2[0].id, `lair_${lair.sid}_20260929_0`, 'tomorrow a fresh one');
    assert.eq(d1[0].kind, d2[0].kind, 'the same kind — the gate\'s own');
    assert.eq(d1[0].x + ',' + d1[0].y, d2[0].x + ',' + d2[0].y, 'in the same seat');
    assert.includes(Lairs.KIND_ORDER.gate, d1[0].kind, 'a slime or a goblin');
    const c = cellOf(d1[0]);
    assert.falsy(occupied.has(c.iy * CPE + c.ix), 'never on a post');
    // Yesterday's corpse is pruned from save.caught; today's is kept.
    assert.eq(Lairs.dailyGuardDay(d1[0].id), '20260928', 'the day reads back off the id');
    assert.eq(Lairs.dailyGuardDay('lair_wagon_1_2_3_4_0'), null, 'a wagon guard is no daily one');
    assert.truthy(/const gateDay = Lairs\.dailyGuardDay\(id\);\s*if \(gateDay\) return gateDay === Delivery\.dayKey\(\);/.test(SCENE_SRC),
      'scene_creatures.js prunes the other days');
    assert.truthy(/o\.kind !== 'gatepost' \|\| !o\.gateSid \|\| seen\.has\(o\.gateSid\)/.test(SCENE_SRC),
      'spawnInTile hands in one lair per gate');
    assert.truthy(/dayKey: utcDayKey\(\),/.test(SCENE_SRC), 'app.js hands the residency pass today');
  });

  test('gate: an Overpass bin\'s gates become posts; road furniture mints nothing', () => {
    const gj = { features: [
      { geometry: { type: 'Point', coordinates: [-119.47, 49.85] }, properties: { kind: 'gate', osm_id: 1 } },
      ...['traffic_signals', 'crossing', 'stop', 'fence', 'line', 'carport'].map((kind, i) =>
        ({ geometry: { type: 'Point', coordinates: [-119.47 + i * 1e-4, 49.851] }, properties: { kind, osm_id: 10 + i } })),
      { geometry: { type: 'Point', coordinates: [-119.471, 49.852] }, properties: { kind: 'bus_stop', osm_id: 99 } },
    ] };
    const bins = WorldGen.buildBinsFromGeoJSON(gj, 49.85);
    let gates = 0, chests = [];
    for (const b of bins.values()) { gates += b.gates.length; chests = chests.concat(b.chests); }
    assert.eq(gates, 1, 'the gate is a gate');
    assert.eq(chests.map((c) => c.poiClass).join(','), 'bus', 'only the bus stop is a chest');
    for (const cls of ['traffic_signals', 'crossing', 'stop', 'fence', 'powerline', 'carport', 'gate', 'information']) {
      assert.falsy(POI_CATEGORY[cls], `${cls} has no chest category`);
    }
    assert.eq([...WorldGen.SX_NOT_A_PLACE].sort().join(), 'carport,crossing,fence,powerline,stop,traffic_signals');
    // A bin cached BEFORE carries them as chests: injection drops them and
    // seats the gate.
    const N = 32, edge = 320;
    const entry = { grid: new Uint8Array(N * N).fill(WorldGen.T.GRASS), roadMask: new Uint8Array(N * N),
      cellsPerEdge: N, tileEdgeM: edge, objects: [], wildplants: [] };
    const old = { chests: [
      { kind: 'chest', lix: 5, liy: 5, poiClass: 'traffic_signals', id: 'sxc_1' },
      { kind: 'chest', lix: 10, liy: 10, poiClass: 'gate', id: 'sxc_2' },
      { kind: 'chest', lix: 20, liy: 20, poiClass: 'bus', id: 'sxc_3' },
    ] };
    WorldGen.injectTileBin(entry, old, 0, 0);
    assert.eq(entry.objects.filter((o) => o.kind === 'chest').map((o) => o.poiClass).join(','), 'bus', 'only the bus stop');
    assert.eq(entry.objects.filter((o) => o.kind === 'gatepost').length, 2, 'the gate stands as its posts');
  });

  // ── Notice boards ────────────────────────────────────────────────────────
  test('notice board: an information POI is a board, not a chest, and reads one page once', () => {
    const r = build([{ type: 1, tags: { class: 'information' }, geom: pt(12, 12) }]);
    assert.eq(r.objects.filter((o) => o.kind === 'chest').length, 0, 'no chest');
    const boards = r.objects.filter((o) => o.kind === 'infoboard');
    assert.eq(boards.length, 1, 'one board');
    assert.eq(boards[0].id, 'info_0_0_12_12', 'id off the tile and cell');
    const save = { opened: [] };
    let reads = 0, modal = null;
    const flashes = [];
    const scene = makeScene({ _bookRead: () => { reads++; return { body: 'page ' + reads }; },
      showMessageModal: (m) => { modal = m; }, flash: (m) => flashes.push(m) });
    runInteractable(makeCtx(scene, save), boards[0]);
    assert.eq(reads, 1, 'a page is read');
    assert.eq(modal && modal.body, 'page 1', 'the next page of the Book');
    assert.includes(save.opened, boards[0].id, 'spent in save.opened, the POI delta');
    runInteractable(makeCtx(scene, save), boards[0]);
    assert.eq(reads, 1, 'once per board');
    assert.eq(flashes[0], 'Read it already.');
    assert.truthy(/infoboard: pageStone\(/.test(INTERACTABLES_SRC), 'notice board keeps its one-time page lane');
    assert.truthy(/infoboard: \{ key: 'signpost'/.test(RENDER_SRC), 'drawn as the signpost');
  });

  // ── Migration ────────────────────────────────────────────────────────────
})();
