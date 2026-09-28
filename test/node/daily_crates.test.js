// THE DAILY CRATE (Sep 2026) — interactables.js refillsDaily / poiLit.
//
// Most chests are offered ONCE (save.opened, forever). The low-tier CRATE (a
// surface POI chest wearing loot.js chestLook's `box`) refills every UTC day
// at its normal tier, spent by the coin-burst DAY LEDGER alone — the lane the
// golden cauldron, the chapel's alms and the grove shrine's gift already
// share. What still has something to take today wears the POI light
// (Lighting.KINDS.poi); once taken it goes dark until the day rolls. Pins:
//   • the predicate — what refills, and everything that never does (trunk,
//     wagon, nexus chest, cave copy, starter crate / relic chest, stall,
//     macro, cauldron, X mark, headstone);
//   • spent by today's ledger only (save.opened is ignored for a crate);
//   • the ceremony: open, bare for the rest of the day (a shortDuration wait
//     that fits a map line), open again the next day at the SAME tier, and
//     the chest quest credited once per open, never twice in a day;
//   • the glow on / off for a crate, the chapel and the shrine;
//   • the migration: opened crate ids read as opened on the migration day;
//   • the Book says so.
(function () {
  const pos = { x: 0, y: 0 };
  let seq = 0;
  const poi = (poiClass, over) => ({ kind: 'chest', id: `c_1_2_3_${++seq}`, poiClass, ...pos, ...over });
  const noHome = (fn) => {
    const prev = HomeArea.worldM;
    HomeArea.worldM = null;
    try { return fn(); } finally { HomeArea.worldM = prev; }
  };
  const DAY = 24 * 60 * 60 * 1000;
  const today = () => String(Delivery.dayKey());
  const yesterday = () => String(Delivery.dayKey(new Date(Date.now() - DAY)));
  const ledger = (entries) => ({ coinBurstClaimed: Object.fromEntries(entries.map(([id, d]) => [id + d, 1])) });

  test('daily crate: the predicate is the crate look, on the surface, off a real POI', () => {
    const bus = poi('bus');
    assert.eq(chestLook(bus).texKey, 'box', 'a bus stop is a crate');
    assert.truthy(refillsDaily(bus), 'a crate refills');
    assert.falsy(refillsDaily(poi('park')), 'a trunk (T2) is one-off');
    assert.falsy(refillsDaily(poi('bus', { banditStop: true })), 'a wagon is one-off');
    assert.falsy(refillsDaily(poi('fuel', { zoneNexus: 'tar' })), 'a nexus chest wears a finer gem and is one-off');
    assert.falsy(refillsDaily(poi('bus', { depth: 1 })), 'a cave copy is one-off');
    assert.falsy(refillsDaily(poi('bus', { caveOf: 'c_0_0_0_0' })), 'whatever carries the cave id');
    assert.falsy(refillsDaily({ kind: 'chest', id: 'chest_start_0_0_1', crate: true, fixedLoot: { id: 'wood', qty: 9 }, x: 0, y: 0 }),
      'a starter supply crate is one-off');
    assert.falsy(refillsDaily({ kind: 'chest', id: 'relic', name: 'Old Chest', fixedLoot: { kind: 'relic', slot: 'axe', tier: 1 }, x: 0, y: 0 }),
      'the starter relic chest is one-off');
    assert.falsy(refillsDaily(poi('atm')), 'a golden cauldron has its own burst');
    assert.falsy(refillsDaily(poi('place_of_worship')), 'a chapel is a place, not a crate');
    assert.falsy(refillsDaily(poi('lodging')), 'an inn neither');
    assert.falsy(refillsDaily({ kind: 'treasure', id: 't_park_0_0_1_1', x: 0, y: 0 }), 'an X mark never refills');
    assert.falsy(refillsDaily({ kind: 'headstone', id: 'hs_0_0_1_1', x: 0, y: 0 }), 'a headstone never refills');
  });

  test('daily crate: spent by TODAY\'s ledger alone; a trunk by save.opened forever', () => {
    const crate = poi('bus'), trunk = poi('park');
    const legacy = spentSets(null, { opened: [crate.id, trunk.id] });
    assert.falsy(isSpent(crate, legacy), 'save.opened is ignored for a crate');
    assert.truthy(isSpent(trunk, legacy), 'a trunk stays opened');
    assert.truthy(isSpent(crate, spentSets(null, ledger([[crate.id, today()]]))), 'taken today: spent');
    assert.falsy(isSpent(crate, spentSets(null, ledger([[crate.id, yesterday()]]))), 'taken yesterday: back');
  });

  test('daily crate: open, bare the rest of the day, open again tomorrow at the same tier', () => noHome(() => {
    const crate = poi('bus');
    const save = { inv: [], opened: [], relics: {}, money: 0 };
    const tiers = [], flashes = [], events = [];
    const scene = makeScene({ flash: (m) => flashes.push(m), questEvent: (e) => events.push(e) });
    const real = globalThis.pickReward;
    globalThis.pickReward = (key, s, rng, opts) => { tiers.push(opts.tier); return { kind: 'item', id: 'wood', qty: 1 }; };
    try {
      runInteractable(makeCtx(scene, save), crate);
      assert.eq(tiers.length, 1, 'one roll');
      assert.eq(save.opened.length, 0, 'never written to save.opened');
      assert.truthy(Macros.usedToday(save, crate.id), 'the day ledger holds it');
      assert.eq(events.join(','), 'chest', 'the chest quest is credited');
      runInteractable(makeCtx(scene, save), crate);
      assert.eq(tiers.length, 1, 'no second roll today');
      assert.eq(events.length, 1, 'no second credit today');
      const bare = flashes[flashes.length - 1];
      assert.truthy(/^The crate is bare\. \d+[smhd]\.$/.test(bare), `the wait is shortDuration: ${bare}`);
      assert.lte(`The crate is bare. ${shortDuration(DAY)}.`.length, MAP_MSG_MAX, 'fits a map line');
      // The day rolls: yesterday's entry is stale.
      save.coinBurstClaimed = { [crate.id + yesterday()]: 1 };
      runInteractable(makeCtx(scene, save), crate);
      assert.eq(tiers.length, 2, 'open again the next day');
      assert.eq(tiers[0], tiers[1], 'at the same tier — no refill penalty');
      assert.eq(tiers[1], chestRollTier(crate.poiClass, crate.x, crate.y, crate.depth, crate.zoneNexus), 'the chest\'s own tier');
      assert.eq(events.length, 2, 'credited once per day it is opened');
      assert.falsy((crate.id + yesterday()) in save.coinBurstClaimed, 'the ledger prunes other days');
    } finally { globalThis.pickReward = real; }
  }));

  test('daily crate: a trunk still opens once, for good', () => noHome(() => {
    const trunk = poi('park');
    const save = { inv: [], opened: [], relics: {}, money: 0 };
    const flashes = [];
    const scene = makeScene({ flash: (m) => flashes.push(m) });
    const real = globalThis.pickReward;
    globalThis.pickReward = () => ({ kind: 'item', id: 'wood', qty: 1 });
    try {
      runInteractable(makeCtx(scene, save), trunk);
      save.coinBurstClaimed = {};
      runInteractable(makeCtx(scene, save), trunk);
    } finally { globalThis.pickReward = real; }
    assert.eq(save.opened.join(','), trunk.id, 'in the delta');
    assert.eq(flashes[flashes.length - 1], 'Picked clean already.', 'and never again');
  }));

  test('daily glow: lit while today\'s take is there — crate, chapel, shrine', () => {
    const crate = poi('bus'), chapel = poi('place_of_worship'), inn = poi('lodging'), trunk = poi('park');
    const shrine = { kind: 'grove_shrine', id: 'sh_1_2_3_4', x: 0, y: 0 };
    const none = spentSets(null, {});
    for (const o of [crate, chapel, inn, trunk, shrine]) assert.truthy(poiLit(o, none), `${o.poiClass || o.kind}: lit when untouched`);
    const used = spentSets(null, { opened: [trunk.id], ...ledger([crate, chapel, inn, shrine].map((o) => [o.id, today()])) });
    assert.falsy(poiLit(crate, used), 'a crate taken today is dark');
    assert.falsy(poiLit(chapel, used), 'the chapel\'s alms taken today: dark');
    assert.falsy(isSpent(chapel, used), '(the chapel itself still stands)');
    assert.falsy(poiLit(shrine, used), 'the shrine\'s gift taken: dark');
    assert.truthy(poiLit(inn, used), 'an inn is a counter and stays lit');
    assert.falsy(poiLit(trunk, used), 'an opened trunk: dark for good');
    const stale = spentSets(null, ledger([crate, chapel, shrine].map((o) => [o.id, yesterday()])));
    for (const o of [crate, chapel, shrine]) assert.truthy(poiLit(o, stale), `${o.poiClass || o.kind}: lit again the next day`);
    assert.falsy(poiLit({ kind: 'chest', id: 'chest_start_0_0_1', crate: true, x: 0, y: 0 }, none), 'a loose starter crate is no place');
  });

  test('daily glow: the shrine wears the POI row through offerPoi; drawObjects asks poiLit', () => {
    const s = { cellM: 5, _lights: [] };
    assert.truthy(Lighting.offerPoi(s, 'sh_1', 0, 0, 30), 'offered');
    assert.eq(s._lights[0].kind, 'poi', 'the POI row — no second glow');
    assert.eq(s._lights[0].id, 'poi_sh_1', 'its own id beside the shrine light, so frameKey sees it come and go');
    const body = RENDER_SRC.slice(RENDER_SRC.indexOf('Render.drawObjects = function drawObjects(scene)'));
    assert.truthy(/o\.kind === 'grove_shrine' && poiLit\(o, spentIds\)\) LIGHTS\.offerPoi\(scene, o\.id, dx, dy, halfM\)/.test(body),
      'the shrine is offered off poiLit');
    assert.truthy(/const spentIds = \{/.test(body) && body.indexOf('const spentIds = {') < body.indexOf('poiLit(o, spentIds)'),
      'the frame sets are built before the walk that asks them');
  });

  test('daily crate: the migration carries opened crate ids onto today\'s ledger, once', () => {
    const save = { schema: 3, opened: ['c_1_2_3_4', 'sxc_12345', 'sxc_-1_2_3_4', 'c_1_2_3_4_d1', 'chest_start_0_0_1', 'hs_0_0_1_1', 'wy_9'] };
    const needs = SaveMigrate.migrate(save);
    assert.truthy(needs, 'persisted');
    assert.eq(save.schema, SaveMigrate.SAVE_SCHEMA, 'stamped');
    const keys = Object.keys(save.coinBurstClaimed).sort();
    assert.eq(keys.join(','), ['c_1_2_3_4', 'sxc_-1_2_3_4', 'sxc_12345'].map((id) => id + today()).sort().join(','),
      'only the surface POI ids, on the migration day');
    assert.eq(save.opened.length, 7, 'save.opened is left as it was');
    const crate = { ...poi('bus'), id: 'c_1_2_3_4' };
    assert.truthy(isSpent(crate, spentSets(null, save)), 'an old crate reads as opened today — no windfall');
    save.coinBurstClaimed = {};
    SaveMigrate.migrate(save);
    assert.eq(Object.keys(save.coinBurstClaimed).length, 0, 'runs once (the schema says so)');
    // Bounded: tomorrow's first write prunes the carried day.
    const s2 = { schema: 3, opened: ['c_1_2_3_4'] };
    SaveMigrate.carryOpenedCratesToLedger(s2, Date.now() - DAY);
    Macros.markToday(s2, 'c_9_9_9_9');
    assert.eq(Object.keys(s2.coinBurstClaimed).join(','), 'c_9_9_9_9' + today(), 'pruned on the next write');
  });

  test('daily crate: the Book tells it', () => {
    const blob = PLAY_TIPS.join(' ');
    assert.truthy(/crate refills every day/i.test(blob), 'crates refill daily');
    assert.truthy(/X mark gives once/i.test(blob), 'X marks never refill');
    assert.truthy(/glows still has something/i.test(blob), 'a glowing one is ready');
  });
})();
