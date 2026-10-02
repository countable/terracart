// THE MACRO STALLS — the in-building POIs that are places you come back to
// (loot.js MACRO_KIND_BY_CLASS / macroFor, src/macros.js, app.js
// presentMacro, interactables.js INTERACTABLES.chest). Pins:
//   • the census → kind table, and the stall winning the generic `shop` —
//     the MVT subclass read first (convenience / florist / coffee → a stall);
//   • never consumed: a tap writes nothing to save.opened, and isSpent never
//     hides one (not even an id a save opened while it was a crate);
//   • every day-gated kind is gated on the coin-burst ledger and opens again
//     on the next UTC day;
//   • every price is derived from items.js PRICES;
//   • the chapel pays a tier under the chest (+ the churchyard nexus);
//   • a tap credits a Scouting report aimed at its class;
//   • the Training Hall's cap (+25%) and its 24 h drill;
//   • the renderer draws a macro with the stall's numbers.
(function () {
  const pos = { x: 0, y: 0 };
  const poi = (poiClass, over) => ({ kind: 'chest', id: 'c_' + poiClass + '_' + (over && over.id || 1), poiClass, ...pos, ...over });
  const noHome = (fn) => {
    const prev = HomeArea.worldM;
    HomeArea.worldM = null;
    try { return fn(); } finally { HomeArea.worldM = prev; }
  };
  const DAY = 24 * 60 * 60 * 1000;
  const T0 = Date.UTC(2026, 8, 28, 10, 0, 0);
  const TIPS_BLOB_ALL = () => PLAY_TIPS.join(' ');

  // ── The table ─────────────────────────────────────────────────────────────
  test('macro: the census classes map to their eight kinds', () => {
    const want = {
      lodging: 'inn', place_of_worship: 'chapel',
      pharmacy: 'apothecary', dentist: 'apothecary', hospital: 'apothecary',
      library: 'scriptorium', college: 'scriptorium',
      town_hall: 'guildhall', police: 'guildhall', fire_station: 'guildhall',
      museum: 'curio', theatre: 'curio', cinema: 'curio',
      shop: 'sundries', sports_centre: 'training', yoga: 'training',
    };
    for (const [cls, kind] of Object.entries(want)) {
      const m = macroFor(poi(cls, { name: '' }));
      assert.truthy(m && m.kind === kind, `${cls} → ${kind} (got ${m && m.kind})`);
      assert.eq(m.texKey, 'macro_' + kind, `${cls}: texKey`);
      assert.truthy(MACRO_KINDS.includes(kind), `${kind} is listed`);
    }
    assert.eq(Object.keys(MACRO_KIND_BY_CLASS).length, Object.keys(want).length, 'no other class is a macro');
    assert.eq(new Set(Object.values(MACRO_KIND_BY_CLASS)).size, MACRO_KINDS.length, 'every kind has a class');
    for (const cls of ['school', 'park', 'memorial', 'bus', 'atm', 'restaurant', 'cemetery', 'art_gallery']) {
      assert.eq(macroFor(poi(cls)), null, `${cls} stays what it was`);
    }
  });

  test('macro: a cave mirror, a starter crate and a scripted chest are never macros', () => {
    assert.eq(macroFor(poi('lodging', { depth: 1 })), null, 'underground it is a chest');
    assert.eq(macroFor(poi('lodging', { crate: true })), null, 'a crate');
    assert.eq(macroFor(poi('museum', { fixedLoot: { id: 'wood', qty: 1 } })), null, 'a scripted chest');
    assert.eq(chestLook(poi('library', { depth: 2 })).texKey, 'chest', 'the look agrees');
  });

  test('macro: a shop is a produce stall when its subclass (or name) says so, Sundries otherwise', () => {
    const shop = (subclass, name = '') => poi('shop', { subclass, name, id: subclass + name });
    for (const [sub, item] of [['convenience', 'nut'], ['florist', 'flowers'], ['coffee', 'coffee'], ['confectionery', 'milk'], ['bakery', 'egg']]) {
      const o = shop(sub);
      const st = produceStandFor(o);
      assert.truthy(st && st.item === item, `shop/${sub} is a stall selling ${item} (got ${st && st.item})`);
      assert.eq(macroFor(o), null, `shop/${sub} is not Sundries`);
      assert.eq(chestLook(o).texKey, 'market_stand', `shop/${sub} looks like a stall`);
    }
    for (const sub of ['jewelry', 'beauty', 'shoes', 'mobile_phone', '']) {
      const o = shop(sub);
      assert.eq(produceStandFor(o), null, `shop/${sub || '(none)'} sells no produce`);
      assert.eq(macroFor(o).kind, 'sundries', `shop/${sub || '(none)'} is Sundries`);
    }
    // The sign still wins: a product word in the name beats the subclass.
    assert.eq(produceStandFor(shop('convenience', 'Fresh Fish Stop')).item, 'salmon', 'the name outranks the subclass');
    // The subclass only speaks for the generic shop — a butcher's subclass is its own.
    assert.eq(subclassProductFor({ poiClass: 'lodging', subclass: 'coffee' }), null, 'only a shop reads it');
    assert.truthy(/subclass: f\.tags\.subclass \|\| ''/.test(WORLDGEN_SRC), 'worldgen carries the MVT subclass onto the chest');
  });

  // ── Never consumed ────────────────────────────────────────────────────────
  test('macro: a tap routes to presentMacro and never touches save.opened', () => {
    for (const kind of MACRO_KINDS.filter((k) => k !== 'chapel')) {
      const cls = Object.keys(MACRO_KIND_BY_CLASS).find((c) => MACRO_KIND_BY_CLASS[c] === kind);
      const seen = [];
      const scene = makeScene({ presentMacro: (sx, sy, o, m) => seen.push(m.kind) });
      const save = { inv: [], opened: [], relics: {} };
      const o = poi(cls);
      runInteractable(makeCtx(scene, save), o);
      runInteractable(makeCtx(scene, save), o);
      assert.eq(seen.join(','), `${kind},${kind}`, `${kind}: every tap opens it`);
      assert.eq(save.opened.length, 0, `${kind}: nothing opened`);
    }
  });

  test('macro: isSpent never hides a macro or a stall — not the day ledger, not a legacy opened id', () => {
    const inn = poi('lodging');
    const stall = poi('cafe', { name: 'Bean There' });
    const plain = poi('memorial');
    const save = { opened: [inn.id, stall.id, plain.id], coinBurstClaimed: {} };
    Macros.markServiceToday(save, inn.id);
    const sets = spentSets(null, save);
    assert.falsy(isSpent(inn, sets), 'the inn stands after resting and after a legacy open');
    assert.falsy(isSpent(stall, sets), 'a stall is never spent');
    assert.truthy(isSpent(plain, sets), 'an opened chest still is');
  });

  // ── The day gate ──────────────────────────────────────────────────────────
  test('macro: the day ledger is the coin-burst one, pruned, and opens again tomorrow', () => {
    const save = {};
    assert.falsy(Macros.usedToday(save, 'c_x', T0));
    Macros.markToday(save, 'c_x', T0);
    assert.truthy(Macros.usedToday(save, 'c_x', T0), 'used today');
    assert.eq(save.coinBurstClaimed['c_x' + Delivery.dayKey(new Date(T0))], 1, 'keyed id + dayKey');
    assert.falsy(Macros.usedToday(save, 'c_x', T0 + DAY), 'free tomorrow');
    Macros.markToday(save, 'c_y', T0 + DAY);
    assert.eq(Object.keys(save.coinBurstClaimed).length, 2, 'yesterday is kept — the ledger holds a week');
    Macros.markToday(save, 'c_z', T0 + Macros.LEDGER_KEEP_DAYS * DAY);
    assert.eq(Object.keys(save.coinBurstClaimed).join(','), 'c_y' + Delivery.dayKey(new Date(T0 + DAY)) + ',c_z' + Delivery.dayKey(new Date(T0 + Macros.LEDGER_KEEP_DAYS * DAY)),
      'a take a week old is pruned on the next write');
  });

  test('macro: service use has a prefixed lane beside plain crate takes', () => {
    const id = 'c_1_2_3_4';
    const day = Delivery.dayKey(new Date(T0));
    const save = { coinBurstClaimed: { [id + day]: 1 } };
    assert.truthy(Macros.usedToday(save, id, T0), 'the carried plain key keeps its crate bare');
    assert.falsy(Macros.serviceUsedToday(save, id, T0), 'the carried chest opening leaves its service available');
    Macros.markServiceToday(save, id, T0);
    assert.truthy(Macros.serviceUsedToday(save, id, T0), 'service use spends only the service lane');
    assert.eq(save.coinBurstClaimed[Macros.serviceLedgerId(id) + day], 1, 'the service key is prefixed');
    assert.truthy(Macros.usedToday(save, id, T0), 'service use does not disturb the plain crate key');
    assert.falsy(Macros.serviceUsedToday(save, id, T0 + DAY), 'the service is available tomorrow');
  });

  // ── Inn ───────────────────────────────────────────────────────────────────
  test('inn: the price is the Vigor potion\'s coins per energy × INN_RATE, and it rests once a day', () => {
    assert.eq(VIGOR_POTION_ENERGY, 65, 'a Vigor restores 65');
    assert.eq(Macros.innCoinsPerEnergy(), PRICES.vigor_potion / VIGOR_POTION_ENERGY * Macros.INN_RATE, 'derived');
    assert.eq(Macros.INN_RATE, 0.5, 'half the potion (the Book says "half")');
    assert.eq(Macros.innPrice(0), 0, 'nothing to rest');
    assert.eq(Macros.innPrice(1), 1, 'never under a coin');
    assert.eq(Macros.innPrice(40), Math.ceil(40 * PRICES.vigor_potion / VIGOR_POTION_ENERGY * Macros.INN_RATE), 'a potion\'s worth');
    assert.lt(Macros.innPrice(40), PRICES.vigor_potion, 'cheaper than the potion');
    const o = poi('lodging');
    const save = { energy: 30, money: 100 };
    const r = Macros.innRest(save, o, 100, T0);
    assert.truthy(r.ok, 'rested');
    assert.eq(save.energy, 100, 'to full');
    assert.eq(r.gain, 70);
    assert.eq(save.money, 100 - Macros.innPrice(70), 'paid');
    assert.truthy(Macros.serviceUsedToday(save, o.id, T0), 'the inn spends the service lane');
    assert.falsy(Macros.usedToday(save, o.id, T0), 'the inn leaves the plain chest lane free');
    save.energy = 10;
    assert.eq(Macros.innRest(save, o, 100, T0 + 60000).why, 'used', 'once a day');
    assert.eq(save.energy, 10, 'nothing given the second time');
    assert.truthy(Macros.innRest(save, o, 100, T0 + DAY).ok, 'again tomorrow');
    assert.eq(Macros.innRest({ energy: 100, money: 9 }, o, 100, T0).why, 'full', 'at full it refuses');
    assert.eq(Macros.innRest({ energy: 0, money: 0 }, o, 100, T0).why, 'money', 'and it is paid for');
  });

  // ── Chapel ────────────────────────────────────────────────────────────────
  test('chapel: its alms roll one tier under the chest, and the churchyard nexus still adds its tier', () => noHome(() => {
    const plain = poi('place_of_worship');
    const nexus = poi('place_of_worship', { zoneNexus: 'stones', id: 2 });
    assert.eq(Macros.CHAPEL_TIER_DROP, 1);
    assert.eq(Macros.chapelRollTier(plain), Math.max(1, chestTier(plain) - 1), 'a tier humbler');
    assert.eq(Macros.chapelRollTier(nexus), chestTier(plain), 'inside a churchyard: the old chest tier');
    assert.eq(Macros.chapelRollTier(nexus) - Macros.chapelRollTier(plain), ZONE_NEXUS_TIER_BONUS, 'the nexus bonus applies');
  }));

  test('chapel: a tap pays through the chest ceremony at the chapel tier, once a day, never opened', () => noHome(() => {
    const o = poi('place_of_worship', { zoneNexus: 'stones' });
    const save = { inv: [], opened: [], relics: {}, money: 0 };
    const tiers = [];
    const flashes = [];
    let modals = 0;
    const scene = makeScene({
      flash: (m) => flashes.push(m),
      showChestRewardModal: (opts) => { modals++; assert.eq(opts.header, 'Chapel', 'names the place'); },
    });
    const real = globalThis.pickReward;
    globalThis.pickReward = (key, s, rng, opts) => { tiers.push(opts.tier); return { kind: 'item', id: 'wood', qty: 1 }; };
    try {
      runInteractable(makeCtx(scene, save), o);
      runInteractable(makeCtx(scene, save), o);
    } finally { globalThis.pickReward = real; }
    assert.eq(tiers.join(','), String(Macros.chapelRollTier(o)), 'one roll, at the chapel tier');
    assert.eq(modals, 1, 'one ceremony');
    assert.eq(save.opened.length, 0, 'the chapel is never opened');
    assert.truthy(Macros.serviceUsedToday(save, o.id), 'the service lane holds it');
    assert.truthy(/^The chapel is quiet\. \d+[smhd]\.$/.test(flashes[flashes.length - 1]), `the wait is shortDuration: ${flashes[flashes.length - 1]}`);
  }));

  // ── Quest credit ──────────────────────────────────────────────────────────
  for (const target of ['library', 'museum', 'place_of_worship']) {
    test(`macro: a Scouting report on "${target}" is credited by tapping its macro`, () => {
      const save = {
        inv: [], opened: [], relics: {},
        quests: { gen: 1, done: 0, slots: [
          { id: 'q0', slot: 0, gen: 0, verb: 'poi', event: 'poi', need: 1, have: 0, target, reward: 55 }, null, null,
        ] },
      };
      const scene = makeScene({ presentMacro: () => {}, _macroStory: () => false });
      const real = globalThis.pickReward;
      globalThis.pickReward = () => ({ kind: 'item', id: 'wood', qty: 1 });
      try { runInteractable(makeCtx(scene, save), poi(target)); } finally { globalThis.pickReward = real; }
      assert.truthy(macroFor(poi(target)), `${target} is a macro`);
      assert.eq(save.quests.slots[0].have, 1, 'credited on the tap');
    });
  }

  // ── Stalls: stock and prices ──────────────────────────────────────────────
  test('apothecary: one remedy and the antidote, priced like a stall', () => {
    const tiers = (id) => ITEM_BY_ID[id].baseTier ?? BASE_TIER[id];
    const seen = new Set();
    for (let i = 0; i < 60; i++) {
      const stock = Macros.apothecaryStock(poi('pharmacy', { id: i }));
      assert.eq(stock.length, 2, 'a potion and the cure');
      assert.truthy(Macros.APOTHECARY_POTIONS.includes(stock[0]), stock[0]);
      assert.eq(stock[1], 'antidote', 'the cure');
      seen.add(stock[0]);
      for (const id of stock) assert.lte(tiers(id), id === 'revive_potion' ? 4 : 2, `${id} stays in its remedy tier`);
    }
    assert.eq(seen.size, Macros.APOTHECARY_POTIONS.length, 'every remedy turns up somewhere');
    assert.eq(Macros.apothecaryStock(poi('dentist', { id: 7 }))[0], 'vigor_potion', 'a dentist is Healing');
    const o = poi('pharmacy', { id: 3 });
    assert.eq(Macros.apothecaryStock(o).join(), Macros.apothecaryStock({ ...o }).join(), 'the same for everyone');
    const save = { relics: {} };
    for (const id of Macros.apothecaryStock(o)) {
      assert.eq(Macros.stallPrice(save, id), ShopsMath.standPrice(save, PRICES[id]), `${id} at the stall price`);
    }
  });

  test('sundries: one supply item off the Supply Shop line, never the Book', () => {
    const line = Shops.THEME_POOL.supply();
    const seen = new Set();
    for (let i = 0; i < 80; i++) {
      const [id] = Macros.sundriesStock(poi('shop', { id: 'x' + i }));
      assert.truthy(line.includes(id) && id !== 'book', id);
      seen.add(id);
    }
    assert.eq(seen.size, line.length - 1, 'every other supply item turns up');
  });

  test('scriptorium: a plain stall — Books (and a torch) at the stall price, no free page', () => {
    assert.eq(Macros.SCRIPTORIUM_BOOK, 'book');
    assert.eq(Macros.scriptoriumStock().join(), 'book,torch', 'what the counter sells');
    const save = { relics: {} };
    for (const id of Macros.scriptoriumStock()) {
      assert.eq(Macros.stallPrice(save, id), ShopsMath.standPrice(save, PRICES[id]), `${id} at the stall price`);
    }
    assert.falsy(/_presentScriptorium/.test(SCENE_SRC), 'the free-page dialog is gone');
    assert.truthy(/case 'scriptorium': return this\._presentStallOffer\(sx, sy,\s*\{ \.\.\.dress, items: Macros\.scriptoriumStock\(\)/.test(SCENE_SRC),
      'the scriptorium opens the stall counter');
    assert.falsy(/_presentBookRead\(\)/.test(SCENE_SRC.slice(SCENE_SRC.indexOf('presentMacro('), SCENE_SRC.indexOf('buildingFlavorTitle('))),
      'no macro reads a Book page for free');
  });

  test('stalls: apothecary, sundries and scriptorium share the market stall\'s one counter', () => {
    // presentMarketStandOffer is _presentStallOffer with the stall's item —
    // the same price (standPrice), stepper cap (money and bag room) and no
    // stock limit; the three macro counters route to the very same method.
    assert.truthy(/presentMarketStandOffer\(sx, sy, stand\) \{\s*this\._presentStallOffer\(/.test(SCENE_SRC), 'the stall is the counter');
    for (const kind of ['apothecary', 'sundries', 'scriptorium']) {
      assert.truthy(new RegExp(`case '${kind}':\\s*return this\\._presentStallOffer\\(`).test(SCENE_SRC), `${kind} opens the counter`);
    }
    assert.truthy(/_presentStallOffer\(sx, sy, opts\) \{[\s\S]*?const unitPrice = ShopsMath\.standPrice\(this\.save, PRICES\[id\] \?\? 1\);/.test(SCENE_SRC),
      'priced by ShopsMath.standPrice');
  });

  // ── Guildhall ─────────────────────────────────────────────────────────────
  test('guildhall: a daily bounty — the hall\'s and the day\'s pack, sized by the weapon, paid from enemyBounty', () => {
    const o = poi('town_hall');
    const bare = { relics: {} };
    const a = Macros.bountyFor(bare, o, T0);
    assert.eq(a.kinds.join(), 'slime', 'no weapon: one slime');
    assert.eq(Macros.bountyFor(bare, { ...o }, T0 + 3600000).id, a.id, 'the same all day');
    assert.truthy(Macros.bountyFor(bare, o, T0 + DAY).id !== a.id, 'a new one tomorrow');
    for (let t = 0; t <= 7; t++) {
      const save = { relics: { sword: { tier: t } } };
      const b = Macros.bountyFor(save, o, T0);
      const rung = Macros.BOUNTY_LADDER[Math.min(2, Math.floor(t / Macros.BOUNTY_TIERS_PER_RUNG))];
      assert.eq(b.kinds.length, Math.min(3, 1 + Math.floor(t / Macros.BOUNTY_TIERS_PER_FOE)), `tier ${t}: the count`);
      for (const k of b.kinds) {
        assert.truthy(rung.includes(k), `tier ${t}: ${k} is on its rung`);
        assert.truthy(Combat.isEnemyKind(k), `${k} is an enemy`);
      }
      const wage = b.kinds.reduce((s, k) => s + Combat.enemyBounty(k, 0), 0);
      assert.eq(b.wage, wage, 'the wage is the kill lane\'s');
      assert.eq(b.pay, Math.max(1, Math.round(wage * Macros.BOUNTY_MATCH)), 'the reward matches it');
    }
    assert.eq(Macros.BOUNTY_MATCH, 1, 'the Book says "the same again"');
    assert.eq(Macros.bountyWeaponTier({ relics: { bow: { tier: 4 }, sword: { tier: 2 } } }), 4, 'the best weapon counts');
  });

  test('guildhall: the bounty is cleared only when every foe is in save.caught', () => {
    assert.falsy(Macros.bountyCleared({ caught: ['a'] }, ['a', 'b']));
    assert.truthy(Macros.bountyCleared({ caught: ['b', 'x', 'a'] }, ['a', 'b']));
    assert.falsy(Macros.bountyCleared({ caught: [] }, []), 'an empty pack is never cleared');
  });

  // findWalkableDestination's core (creature_ai.js walkableDestination) on a
  // synthetic tile: grass, a road band down one column, an occupied cell.
  const destWorld = (setup) => {
    const N = 20, edge = 140;   // 7 m cells
    const grid = new Uint8Array(N * N).fill(TERRAIN.GRASS);
    const roadMask = new Uint8Array(N * N);
    const occupied = new Set();
    setup && setup({ N, grid, roadMask, occupied });
    const entry = { grid, cellsPerEdge: N, roadMask, creatures: [], _spawnOpts: { roadMask, occupied, pois: [] } };
    const scene = { depth: 0, tileEdgeM: edge, cellM: edge / N };
    return { scene, entry, N, edge };
  };
  const withTile = (entry, fn) => {
    const realGet = WorldGen.tileCache.get;
    WorldGen.tileCache.get = (k) => (k === WorldGen.tileKey(0, 0) ? entry : undefined);
    try { return fn(); } finally { WorldGen.tileCache.get = realGet; }
  };

  test('findWalkableDestination: about `dist` cells off, deterministic, never on a road band or an occupied cell', () => {
    const { scene, entry } = destWorld();
    const P = { x: 70 + 3.5, y: 70 + 3.5 };   // cell (10, 10)
    const d = withTile(entry, () => walkableDestination(scene, P.x, P.y, 5, { seed: 'b1' }));
    assert.truthy(d, 'a cell');
    const r = Math.hypot(d.x - P.x, d.y - P.y) / scene.cellM;
    assert.inRange(r, 4, 6, `about five cells off (${r})`);
    const again = withTile(entry, () => walkableDestination(scene, P.x, P.y, 5, { seed: 'b1' }));
    assert.eq(`${again.ix},${again.iy}`, `${d.ix},${d.iy}`, 'the same seed, the same cell');
    // Block every cell on the first choice's column with road, and its row
    // with occupants: the answer moves off both, and still passes the rule.
    const w2 = destWorld(({ N, roadMask, occupied }) => {
      for (let i = 0; i < N; i++) { roadMask[i * N + d.ix] = 1; occupied.add(d.iy * N + i); }
    });
    const e = withTile(w2.entry, () => walkableDestination(w2.scene, P.x, P.y, 5, { seed: 'b1' }));
    assert.truthy(e, 'still a cell');
    assert.truthy(e.ix !== d.ix && e.iy !== d.iy, 'off the road band and the occupied row');
    assert.truthy(WorldGen.isSpawnCell(w2.entry.grid, 20, 20, e.ix, e.iy, w2.entry._spawnOpts), 'the shared spawn rule passes it');
    // Nothing free anywhere: null. Underground: null.
    const w3 = destWorld(({ roadMask }) => roadMask.fill(1));
    assert.eq(withTile(w3.entry, () => walkableDestination(w3.scene, P.x, P.y, 5, { seed: 'b1' })), null, 'all road: nowhere');
    assert.eq(withTile(entry, () => walkableDestination({ ...scene, depth: 1 }, P.x, P.y, 5, { seed: 'b1' })), null, 'surface only');
    // accept() may refuse: the answer is the next one that passes.
    const f = withTile(entry, () => walkableDestination(scene, P.x, P.y, 5, { seed: 'b1', accept: (x, y) => !(x === d.x && y === d.y) }));
    assert.truthy(f && (f.ix !== d.ix || f.iy !== d.iy), 'accept refuses a cell');
    assert.eq(walkableDestinationRings(3).join(), '3,2,4,1,5,6', 'the ring order: dist, nearer, farther');
    assert.truthy(/findWalkableDestination\(dist, opts\) \{[\s\S]*?this\.startWorldM\.x \+ this\.playerM\.x[\s\S]*?walkableDestination\(this, px, py, dist, opts\)/.test(SCENE_SRC),
      'the scene method measures from the FEET');
  });

  test('guildhall: the pack is seated at findWalkableDestination\'s cell, off the road, and pays once on clear', () => {
    // The app.js methods, run whole against a stub scene on the synthetic tile.
    const grab = (name) => {
      const at = SCENE_SRC.indexOf(`  ${name}(`);
      const open = SCENE_SRC.indexOf('{\n', at);
      const end = SCENE_SRC.indexOf('\n  }\n', open);
      const sig = SCENE_SRC.slice(at + 2, open).trim();
      return { args: sig.slice(sig.indexOf('(') + 1, sig.lastIndexOf(')')), body: SCENE_SRC.slice(open + 2, end) };
    };
    const mk = (name) => { const g = grab(name); return new Function(...g.args.split(',').map((x) => x.trim().replace(/ = .*/, '')), g.body); };
    const spawn = mk('_spawnGuildBounty');
    const onDefeat = mk('_guildBountyDefeat');
    const { scene: base, entry, N } = destWorld(({ N, roadMask }) => { for (let i = 0; i < N; i++) roadMask[i * N + 14] = 1; });
    const flashes = [];
    const stories = [];
    const scene = {
      ...base, startWorldM: { x: 0, y: 0 }, playerM: { x: 73.5, y: 73.5 },
      save: { caught: [], money: 0 },
      homeWorldPos: () => null,
      findWalkableDestination(dist, opts) { return walkableDestination(this, 73.5, 73.5, dist, opts); },
      flashLoot: (m) => flashes.push(m), updateHUD: () => {},
      _storySplashOnce: (k) => stories.push(k),
    };
    scene._guildBountyDefeat = onDefeat;
    const b = Macros.bountyFor({ relics: { sword: { tier: 7 } } }, poi('town_hall'), T0);
    assert.eq(b.kinds.length, 3, 'a full pack');
    const realPersist = globalThis.persistSave;
    globalThis.persistSave = () => {};
    try {
      withTile(entry, () => {
        const want = scene.findWalkableDestination(Macros.BOUNTY_DIST_CELLS, { seed: b.id, accept: () => true });
        const n = spawn.call(scene, b, T0);
        assert.eq(n, 3, 'three seated');
        const foes = entry.creatures;
        assert.eq(`${Math.floor(foes[0].x / 7)},${Math.floor(foes[0].y / 7)}`, `${want.ix},${want.iy}`, 'the first on the destination cell');
        const cells = new Set();
        for (const c of foes) {
          const ix = Math.floor(c.x / 7), iy = Math.floor(c.y / 7);
          assert.falsy(entry.roadMask[iy * N + ix], `${c.id} is off the road band`);
          assert.truthy(WorldGen.isSpawnCell(entry.grid, N, N, ix, iy, entry._spawnOpts), `${c.id} passes the spawn rule`);
          cells.add(ix + ',' + iy);
          assert.eq(c.bounty, b.id, 'tagged');
          assert.truthy(/^guildfoe_0_0_/.test(c.id), 'a session id the caught-prune knows');
          assert.truthy(Combat.isEnemy(c), 'an ordinary enemy');
        }
        assert.eq(cells.size, 3, 'none stacked');
        // Kill them through the lane's one mark; the reward lands on the last.
        for (const [i, c] of foes.entries()) {
          scene.save.caught.push(c.id);
          scene._guildBountyDefeat(c);
          assert.eq(scene.save.money, i < 2 ? 0 : b.pay, `after kill ${i + 1}`);
        }
        assert.eq(scene._guildBounty, null, 'forgotten once paid');
        scene._guildBountyDefeat(foes[2]);
        assert.eq(scene.save.money, b.pay, 'paid once');
        assert.eq(flashes.join('|'), `Bounty paid! +${b.pay}`);
        assert.eq(stories.join(), 'macro:bounty', 'the first bounty tells its story');
      });
    } finally { globalThis.persistSave = realPersist; }
    assert.truthy(/if \(victim\.bounty\) this\._guildBountyDefeat\(victim\);/.test(SCENE_SRC), 'resolveDefeat calls it');
    assert.truthy(/guildfoe\)_\(-\?\\d\+\)_/.test(SCENE_SRC), 'the caught-prune knows the prefix');
    assert.truthy(/this\._tickTraps\(dt\);\s*\/\/[^\n]*\n\s*this\._tickGuildBounty\(\);/.test(SCENE_SRC), 'the leash ticks');
  });

  // ── Curio hall ────────────────────────────────────────────────────────────
  test('curio: one shared list of things that keep — nothing that spoils or grows', () => {
    const list = Macros.curioCollection();
    assert.eq(list.length, Macros.CURIO_COLLECTION.length, 'every listed id is a real item');
    assert.inRange(list.length, 20, 30, 'a real collection');
    assert.eq(new Set(list).size, list.length, 'no duplicates');
    const keeps = new Set(['shell', 'crow_feather', 'rabbit_pelt', 'boot']);
    for (const id of list) {
      const it = ITEM_BY_ID[id];
      assert.falsy(id in FOOD_ENERGY, `${id} is not food`);
      assert.falsy(['seed', 'sapling', 'magic', 'animal'].includes(it.kind), `${id} is no seed, sapling, potion or animal`);
      assert.truthy(['mineral', 'supply', 'unique_relic'].includes(it.kind) || keeps.has(id), `${id} is a lasting thing (${it.kind})`);
    }
    for (const id of ['potato', 'apple', 'flowers', 'vigor_potion', 'egg', 'potato_seed', 'acorn']) {
      assert.falsy(Macros.curioEligible(id), `${id} is not collected`);
    }
    assert.eq(Macros.CURIO_MILESTONES.join(), '5,10,15', 'the milestones');
    assert.lte(Macros.CURIO_MILESTONES[2], list.length, 'the last is reachable');
  });

  test('curio: one of each, nothing paid, a milestone at 5 / 10 / 15 exactly once', () => {
    const save = { inv: [], money: 0 };
    const list = Macros.curioCollection();
    const hits = [];
    for (const [i, id] of list.entries()) {
      Inventory.add(save, id, 2);
      const r = Macros.curioDonate(save, id);
      assert.truthy(r.ok, id);
      assert.eq(r.count, i + 1);
      if (r.milestone) hits.push(r.milestone);
      assert.eq(Inventory.count(save, id), 1, `${id}: took ONE`);
      assert.eq(Macros.curioDonate(save, id).why, 'given', `${id}: once`);
    }
    assert.eq(hits.join(), '5,10,15', 'each milestone fires once, at its count');
    assert.eq(save.money, 0, 'nothing is paid');
    assert.eq(Macros.curioNextMilestone(7), 10);
    assert.eq(Macros.curioNextMilestone(15), null);
    assert.eq(Macros.curioMissing(save).length, 0, 'the collection is whole');
    assert.eq(Macros.curioDonate({ inv: [] }, 'iron_bar').why, 'none', 'you have to hold it');
    // A legacy paid-build donation off the list does not count.
    assert.eq(Macros.curioCount({ donated: ['potato', 'iron_bar'] }), 1);
    // The memory is the discovery ledger's, keyed per milestone — once per save.
    assert.eq(Macros.curioMilestoneKey(10), 'curio:10');
    assert.truthy(/if \(r\.milestone\) \{\s*this\._bankDiscovery\(Macros\.curioMilestoneKey\(r\.milestone\)/.test(SCENE_SRC), 'banked as a memory');
    const curioSrc = SCENE_SRC.slice(SCENE_SRC.indexOf('  _presentCurio(sx, sy, o, dress) {'), SCENE_SRC.indexOf('  // TRAINING HALL'));
    assert.truthy(curioSrc.length > 100 && !/addMoney/.test(curioSrc), 'the hall pays no coin');
  });

  // ── Training hall ─────────────────────────────────────────────────────────
  test('training: five disciplines in one table, each hall teaching one off its own id', () => {
    assert.eq(Combat.TRAINING_ORDER.join(), 'melee,ranged,magic,energy,speed');
    const K = Combat.TRAINING_KINDS;
    assert.eq([K.melee.per, K.ranged.per, K.magic.per, K.energy.per, K.speed.per].join(), '1,1,1,10,0.05', 'a level each');
    assert.eq([K.melee.drill, K.ranged.drill, K.magic.drill, K.energy.drill, K.speed.drill].join(), '5,5,5,50,0.25', 'a drill each');
    assert.eq(Combat.TRAINING_PERM_MAX, 5);
    const seen = {};
    for (let i = 0; i < 2000; i++) {
      const o = { id: `c_train_${i}` };
      const k = Macros.trainingKindFor(o);
      assert.eq(Macros.trainingKindFor({ id: o.id }), k, 'the world\'s: same hall, same discipline');
      seen[k] = (seen[k] || 0) + 1;
    }
    for (const k of Combat.TRAINING_ORDER) assert.inRange(seen[k], 300, 500, `${k} halls are about a fifth`);
    const o = { id: 'c_train_7' };
    assert.eq(Macros.stallLabel('training', o), `${K[Macros.trainingKindFor(o)].label} Training`, 'the sign names it');
    assert.eq(Macros.stallLabel('inn', o), 'Inn', 'other stalls keep their word');
  });

  test('training: a level costs $25 × its number and needs 2 × its number memories recovered', () => {
    const save = { money: 1e9 };
    assert.eq(Macros.lessonPricesAll().join(), '25,50,75,100,125', '25 × level');
    assert.eq(Macros.buyLesson(save, 'ranged', 1).why, 'memories', 'level 1 needs 2 memories');
    assert.eq(Macros.buyLesson(save, 'ranged', 1).need, 2);
    let paid = 0;
    for (let i = 0; i < 10; i++) { const r = Macros.buyLesson(save, 'ranged', 10); if (r.ok) paid += r.price; }
    assert.eq(Combat.trainingLevel(save, 'ranged'), 5, 'ten memories reach level 5');
    assert.eq(paid, 375);
    assert.eq(Macros.buyLesson(save, 'ranged', 99).why, 'cap');
    assert.eq(Macros.buyLesson(save, 'magic', 99).ok, true, 'each discipline is its own track');
    const s2 = { money: 1e9 };
    for (let i = 0; i < 5; i++) Macros.buyLesson(s2, 'melee', 5);
    assert.eq(Combat.trainingLevel(s2, 'melee'), 2, 'five memories stop at level 2 (level 3 needs 6)');
    assert.eq(Macros.buyLesson(save, 'nonsense', 99).why, 'kind');
  });

  test('training: bonuses land per discipline, drills add and lapse, old melee saves carry over', () => {
    const save = { money: 1e9, training: { melee: 2, ranged: 3, energy: 4, speed: 5 } };
    assert.eq(Combat.trainingBonus(save, 'melee', T0), 2);
    assert.eq(Combat.trainingBonus(save, 'ranged', T0), 3);
    assert.eq(Combat.trainingBonus(save, 'magic', T0), 0);
    assert.eq(Combat.trainingBonus(save, 'energy', T0), 40);
    assert.inRange(Combat.trainingIntervalMul(save, T0) - 1 / 1.25, -1e-12, 1e-12, 'five speed levels: a beat 1/1.25 as long');
    assert.eq(Macros.buyDrill(save, 'melee', T0).ok, true);
    assert.eq(Macros.buyDrill(save, 'melee', T0 + 1).why, 'active', 'one drill at a time per discipline');
    assert.eq(Macros.buyDrill(save, 'energy', T0).ok, true, 'but another discipline\'s may run');
    assert.eq(Combat.trainingBonus(save, 'melee', T0 + DAY - 1), 7, 'lessons and a drill add');
    assert.eq(Combat.trainingBonus(save, 'energy', T0 + 1), 90);
    assert.eq(Combat.trainingBonus(save, 'melee', T0 + DAY), 2, 'the drill is gone at 24 h');
    assert.eq(shortDuration(Macros.drillLeftMs(save, 'melee', T0 + DAY - 3600000)), '1h', 'shown in shortDuration');
    assert.eq(Macros.drillPrice(), 150);
    // A pre-Sep-2026 save: one melee track, capped, folded on the next purchase.
    const old = { money: 1e9, trainingPerm: 25, trainingBuffUntil: T0 + 1000 };
    assert.eq(Combat.trainingLevel(old, 'melee'), 5, 'an old +25% veteran reads as melee level 5');
    assert.truthy(Combat.trainingBuffActive(old, 'melee', T0), 'and keeps its running drill');
    Macros.buyLesson(old, 'magic', 99);
    assert.eq(old.trainingPerm, undefined, 'folded into the new fields');
    assert.eq(old.training.melee, 5);
    assert.eq(old.trainingDrills.melee, T0 + 1000);
    assert.eq(Energy.maxEnergy({ training: { energy: 3 } }) - Energy.maxEnergy({}), 30, 'stamina lifts the bar\'s cap');
  });

  test('training: each attack type reads its own discipline, and speed shortens every beat', () => {
    assert.truthy(/_attackFlat\(kind\) \{\s*return Combat\.TRAINING_KINDS\[kind\]\?\.unit === 'dmg' \? Combat\.trainingBonus\(this\.save, kind\) : 0;/.test(SCENE_SRC), '_attackFlat, by type');
    assert.truthy(/meleeSwingDamage\(this\.save\.relics, this\._attackMul\(\), this\.save\.playerClass\)\s*\+ this\._attackFlat\('melee'\);/.test(SCENE_SRC), 'melee blows take melee');
    assert.truthy(/\* dmgMul\s*\+ this\._attackFlat\(Combat\.TRAINING_SLOT_KIND\[slot\]\),/.test(SCENE_SRC), 'shots take their slot\'s');
    assert.eq(Combat.TRAINING_SLOT_KIND.bow, 'ranged'); assert.eq(Combat.TRAINING_SLOT_KIND.staff, 'magic');
    assert.truthy(/this\._nextBlowT = now \+ Combat\.MELEE_INTERVAL_MS \* Combat\.trainingIntervalMul\(this\.save\);/.test(SCENE_SRC), 'the melee beat');
    const body = SCENE_SRC.slice(SCENE_SRC.indexOf('  _presentTraining(sx, sy, o, dress) {'), SCENE_SRC.indexOf('  buildingFlavorTitle('));
    assert.truthy(/memories required/.test(body), 'the lesson states its requirement');
    assert.truthy(/Macros\.buyLesson\(this\.save, kind, this\.memoriesTotal\(\)\)/.test(body), 'gated on memories RECOVERED');
  });

  test('tips: places offer a story hint while service values remain owned', () => {
    for (const place of ['inn', 'guildhall', 'curio hall', 'training hall']) {
      assert.truthy(PLAY_TIPS.some(t => t.toLowerCase().includes(place)), `${place}: a story page`);
    }
    assert.eq(Macros.INN_RATE, 0.5);
    assert.eq(Macros.CHAPEL_TIER_DROP, 1);
    assert.eq(Macros.BOUNTY_MATCH, 1);
    assert.falsy(/scriptorium lends/i.test(TIPS_BLOB_ALL()), 'no free page');
  });

  // ── The picture ───────────────────────────────────────────────────────────
  test('macro: an inn has its host and each weapon discipline has matching art', () => {
    assert.eq(Macros.stallArt('inn'), 'kind_inn');
    const seen = new Set();
    const expected = { melee: 'tool_sword', ranged: 'tool_shoot', magic: 'tool_staff', energy: 'tool_sword', speed: 'tool_sword' };
    for (let id = 0; id < 100; id++) {
      const o = { id };
      const discipline = Macros.trainingKindFor(o);
      seen.add(discipline);
      assert.eq(Macros.stallArt('training', o), expected[discipline]);
    }
    assert.eq(seen.size, 5, 'all hall disciplines are exercised');
  });
  test('macro: each kind ships its 80×80 art and an ASSETS row under its texKey', () => {
    const files = { inn: 'inn', chapel: 'chapel', apothecary: 'apothecary', scriptorium: 'scriptorium',
      guildhall: 'guildhall', curio: 'curio', sundries: 'sundries', training: 'training' };
    for (const kind of MACRO_KINDS) {
      const rel = `assets/Objects/Generated/${files[kind]}.png`;
      const d = pngDims(rel);
      assert.truthy(d && d.w === 80 && d.h === 80, `${rel} is 80×80 (got ${JSON.stringify(d)})`);
      assert.truthy(new RegExp(`macro_${kind}: +\\{ kind: 'spritesheet', path: '${rel}', frameWidth: 80, frameHeight: 80 \\}`).test(ASSETS_SRC),
        `ASSETS.macro_${kind}`);
      const dlg = Macros.KIND_DIALOG[kind];
      assert.truthy(dlg && MODAL_KINDS[dlg.modal], `${kind}: a real modal kind`);
      assert.truthy(webpDims(`assets/art/${dlg.art}.webp`), `${kind}: its painting ships (${dlg.art})`);
      assert.truthy(Macros.KIND_STORY[kind], `${kind}: a first-visit story`);
    }
  });

  test('macro: drawn with the stall\'s numbers — foot-anchored, not seated, no pad, no gem', () => {
    for (const re of [
      /origin: \(o\) => \{ const L = chestLook\(o\);\s*return \(L\.stand \|\| L\.macro \|\| L\.wagon\) \? \[0\.5, 1\.0\]/,
      /\(L\.stand \|\| L\.macro\) \? 0\.54/,
      /dxPx: \(o\) => \{ const L = chestLook\(o\); return \(L\.stand \|\| L\.macro\) \? -0\.24/,
      /\(L\.stand \|\| L\.macro\) \? 19\.3/,
      /seat: \(o\) => \{ const L = chestLook\(o\); return !L\.stand && !L\.macro && !L\.coin && !L\.wagon; \}/,
      /if \(produceStandFor\(o\) \|\| macroFor\(o\)\) continue;/,
    ]) assert.truthy(re.test(RENDER_SRC), String(re));
  });

  // ── The chapel's copy (Sep 2026): the player LEAVES an offering and is GIVEN
  // a blessing — never takes alms from a box the keeper watches. A church
  // only: every other faith's place mints nothing (sensitive_places.test.js).
  test('macro: the chapel gives a blessing; nobody takes alms', () => {
    const story = Macros.KIND_STORY.chapel;
    assert.truthy(/blessing/i.test(story.body), `a blessing: ${story.body}`);
    assert.falsy(/\balms\b|\btake\b|watches you/i.test(story.title + ' ' + story.body), `no alms taken: ${story.body}`);
    assert.falsy(/alms box/i.test(INTERACTABLES_SRC), 'the bare flash names no alms box');
    assert.truthy(/'A quiet blessing\. Go well\.'/.test(INTERACTABLES_SRC), 'the empty roll is a blessing too');
    assert.lte('A quiet blessing. Go well.'.length, MAP_MSG_MAX);
    assert.eq(Macros.KIND_DIALOG.chapel.art, 'zone_stones', 'the chapel opens on the churchyard (a lore-free painting)');
  });

  test('macro: a chapel is minted for a church only — a synagogue, mosque or temple mints nothing', () => {
    const r = (tags) => WorldGen.rasterizeTile([
      { name: 'landcover', features: [{ type: 3, tags: { class: 'grass', subclass: 'park' },
        geom: [[{ x: -64, y: -64 }, { x: 4160, y: -64 }, { x: 4160, y: 4160 }, { x: -64, y: 4160 }, { x: -64, y: -64 }]] }] },
      { name: 'poi', features: [{ type: 1, tags, geom: [[{ x: 2048, y: 2048 }]] }] },
    ], 64, 0, 0, 640).objects.filter((o) => o.kind === 'chest');
    assert.eq(r({ class: 'place_of_worship', subclass: 'christian' }).map((o) => macroFor(o) && macroFor(o).kind).join(), 'chapel');
    for (const faith of ['jewish', 'muslim', 'buddhist', 'hindu']) {
      assert.eq(r({ class: 'place_of_worship', subclass: faith }).length, 0, `${faith}: no chest, no chapel`);
    }
    assert.eq(r({ class: 'place_of_worship' }).length, 0, 'no faith given and no church name: nothing');
  });
})();
