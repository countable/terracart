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
  test('macro: the census classes map to their nine kinds', () => {
    const want = {
      lodging: 'inn', place_of_worship: 'chapel',
      pharmacy: 'apothecary', dentist: 'apothecary', hospital: 'apothecary',
      library: 'scriptorium', college: 'scriptorium', school: 'scholar',
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
    for (const cls of ['university', 'park', 'memorial', 'bus', 'atm', 'restaurant', 'cemetery', 'art_gallery']) {
      assert.eq(macroFor(poi(cls)), null, `${cls} stays what it was`);
    }
  });

  test('macro: schools use the reusable scholar counter, not a chest', () => {
    const school = poi('school');
    assert.eq(chestLook(school).texKey, 'macro_scholar');
    assert.eq(macroFor(school).kind, 'scholar');
    assert.eq(macroFor(poi('school', { depth: 1 })), null, 'underground mirror remains a chest');
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
    assert.eq(save.coinBurstClaimed['c_x' + utcDayKey(new Date(T0))], 1, 'keyed id + dayKey');
    assert.falsy(Macros.usedToday(save, 'c_x', T0 + DAY), 'free tomorrow');
    Macros.markToday(save, 'c_y', T0 + DAY);
    assert.eq(Object.keys(save.coinBurstClaimed).length, 2, 'yesterday is kept — the ledger holds a week');
    Macros.markToday(save, 'c_z', T0 + Macros.LEDGER_KEEP_DAYS * DAY);
    assert.eq(Object.keys(save.coinBurstClaimed).join(','), 'c_y' + utcDayKey(new Date(T0 + DAY)) + ',c_z' + utcDayKey(new Date(T0 + Macros.LEDGER_KEEP_DAYS * DAY)),
      'a take a week old is pruned on the next write');
  });

  test('macro: service use has a prefixed lane beside plain crate takes', () => {
    const id = 'c_1_2_3_4';
    const day = utcDayKey(new Date(T0));
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
  test('inn: the price is the Healing potion\'s coins per energy × INN_RATE, and it rests once a day', () => {
    assert.eq(HEALING_POTION_ENERGY, 65, 'a Healing potion restores 65');
    assert.eq(Macros.innCoinsPerEnergy(), PRICES.healing_potion / HEALING_POTION_ENERGY * Macros.INN_RATE, 'derived');
    assert.eq(Macros.INN_RATE, 0.5, 'half the potion (the Book says "half")');
    assert.eq(Macros.innPrice(0), 0, 'nothing to rest');
    assert.eq(Macros.innPrice(1), 1, 'never under a coin');
    assert.eq(Macros.innPrice(40), Math.ceil(40 * PRICES.healing_potion / HEALING_POTION_ENERGY * Macros.INN_RATE), 'a potion\'s worth');
    assert.lt(Macros.innPrice(40), PRICES.healing_potion, 'cheaper than the potion');
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
      showChestRewardModal: (opts) => {
        modals++;
        assert.eq(opts.header, Macros.KIND_TRANSACTION.chapel.title, 'confirms the blessing');
        assert.eq(opts.art, Macros.KIND_TRANSACTION.chapel.art, 'shows the completed blessing');
      },
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
    assert.truthy(/^The chapel is quiet — \d+[smhd]$/.test(flashes[flashes.length - 1]), `the wait is shortDuration: ${flashes[flashes.length - 1]}`);
  }));

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
      const remedyTiers = { healing_potion: 2, revival_potion: 3, protection_potion: 2, reach_potion: 4, antidote: 1 };
      for (const id of stock) assert.eq(tiers(id), remedyTiers[id], `${id} stays in its remedy tier`);
    }
    assert.eq(seen.size, Macros.APOTHECARY_POTIONS.length, 'every remedy turns up somewhere');
    assert.eq(Macros.apothecaryStock(poi('dentist', { id: 7 }))[0], 'healing_potion', 'a dentist is Healing');
    const o = poi('pharmacy', { id: 3 });
    assert.eq(Macros.apothecaryStock(o).join(), Macros.apothecaryStock({ ...o }).join(), 'the same for everyone');
    const save = { relics: {} };
    for (const id of Macros.apothecaryStock(o)) {
      assert.eq(Macros.stallPrice(save, id), ShopsMath.standPrice(save, PRICES[id]), `${id} at the stall price`);
    }
  });

  test('sundries: one supply item off the Supply Shop line or one gear line, never the Book', () => {
    const line = [...Shops.THEME_POOL.supply(), ...Macros.SUNDRIES_GEAR.map(g => 'gear:' + g)];
    assert.falsy(line.includes('book'), 'the Supply Shop leaves the Book to the Bookshop');
    const seen = new Set();
    for (let i = 0; i < 160; i++) {
      const [id] = Macros.sundriesStock(poi('shop', { id: 'x' + i }));
      assert.truthy(line.includes(id) && id !== 'book', id);
      seen.add(id);
    }
    assert.eq(seen.size, line.length, 'every supply item and gear line turns up');
  });

  test('sundries gear: the next rung above what is held, at three times list before the stall discount', () => {
    const save = { relics: {}, armor: {}, inv: [] };
    const lance = Macros.sundriesGear(save, 'gear:lance');
    assert.eq(lance.kind, 'relic'); assert.eq(lance.slot, 'lance'); assert.eq(lance.tier, 1, 'Rusty first');
    assert.eq(lance.price, ShopsMath.standPrice(save, gearPrice('relic', 'lance', 1) * Macros.SUNDRIES_GEAR_PRICE_MUL));
    save.relics.lance = { tier: 1 };
    assert.eq(Macros.sundriesGear(save, 'gear:lance').tier, 3, 'Fine over a Rusty one (no T2 rung)');
    save.relics.lance = { tier: 5 };
    assert.eq(Macros.sundriesGear(save, 'gear:lance'), null, 'nothing past Magic');
    assert.eq(Macros.sundriesGear(save, 'gear:shield').id, 'wood_shield');
    save.inv.push({ id: 'wood_shield', count: 1 });
    const metal = Macros.sundriesGear(save, 'gear:shield');
    assert.eq(metal.id, 'metal_shield', 'the Metal Shield over a carried Wood one');
    assert.eq(metal.price, ShopsMath.standPrice(save, itemValue('metal_shield') * 3));
    save.inv.push({ id: 'gold_shield', count: 1 });
    assert.eq(Macros.sundriesGear(save, 'gear:shield'), null, 'the Gold Shield is the finest');
    for (const line of ['dagger', 'musket']) assert.eq(Macros.sundriesGear(save, 'gear:' + line).tier, 1);
  });

  test('scriptorium: a plain stall — Books (and a torch) at the stall price, no free page', () => {
    assert.eq(Macros.SCRIPTORIUM_BOOK, 'book');
    assert.eq(Macros.scriptoriumStock().join(), 'book,torch', 'what the counter sells');
    const save = { relics: {} };
    for (const id of Macros.scriptoriumStock()) {
      assert.eq(Macros.stallPrice(save, id), ShopsMath.standPrice(save, PRICES[id]), `${id} at the stall price`);
    }
    assert.falsy(/_presentScriptorium/.test(SCENE_SRC), 'the free-page dialog is gone');
    // presentMacro routes by the kind's `present` column (Macros.KIND_DIALOG);
    // a stall with a `stock` opens the shared counter with that stock.
    assert.truthy(/if \(!d\.stock\) return this\[d\.present\]\(sx, sy, o, dress\);[\s\S]{0,400}?const opts = \{ \.\.\.dress, items: stock, title: d\.title \};/.test(SCENE_SRC),
      'the scriptorium opens the stall counter');
    assert.falsy(/_presentBookRead\(\)/.test(SCENE_SRC.slice(SCENE_SRC.indexOf('presentMacro('), SCENE_SRC.indexOf('buildingFlavorTitle('))),
      'no macro reads a Book page for free');
  });

  test('stalls: apothecary, sundries and scriptorium share the market stall\'s one counter', () => {
    // presentMarketStandOffer is _presentStallOffer with the stall's item —
    // the same price (standPrice), purchase limits (money and bag room) and no
    // stock limit; the three macro counters route to the very same method.
    assert.truthy(/presentMarketStandOffer\(sx, sy, stand\) \{\s*this\._presentStallOffer\(/.test(SCENE_SRC), 'the stall is the counter');
    assert.truthy(/if \(!d\?\.present\) return undefined;/.test(SCENE_SRC) && !/case 'apothecary'/.test(SCENE_SRC),
      'the counters route by the row, never a switch');
    // Sundries' stock may name a gear line ('gear:<slot>', Macros.SUNDRIES_GEAR);
    // that entry opens its own buy (_presentStallGear — a rung of equipment,
    // not a stack) off the same row, never a switch of its own.
    assert.truthy(/_presentStallGear\(sx, sy, \{[^}]*entry: stock\[0\] \}\)/.test(SCENE_SRC),
      'a gear line at the sundries counter opens the gear buy');
    assert.truthy(/_presentStallOffer\(sx, sy, opts\) \{[\s\S]*?const listPrice = ShopsMath\.listPrice\(this\.save, id\);\s*const unitPrice = ShopsMath\.standPrice\(this\.save, listPrice\);/.test(SCENE_SRC),
      'priced by ShopsMath.standPrice off the list price (the Book\'s ladder rides in listPrice)');
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
    assert.truthy(/findWalkableDestination\(dist, opts\) \{\s*const \{ x: px, y: py \} = playerWorldM\(this\);\s*return walkableDestination\(this, px, py, dist, opts\)/.test(SCENE_SRC),
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
    const LEDGER = SCENE_SRC.match(/\nconst GUILD_BOUNTY_LEDGER = [^\n]+/)[0];
    const mk = (name) => { const g = grab(name); return new Function(...g.args.split(',').map((x) => x.trim().replace(/ = .*/, '')), LEDGER + '\n' + g.body); };
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
      _macroTransaction: (k) => stories.push(k),
      moneyHTML: (n) => `<coin>${n}</coin>`,
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
        assert.eq(stories.join(), 'guildhall', 'the completed bounty shows one receipt');
      });
    } finally { globalThis.persistSave = realPersist; }
    assert.truthy(/\(s, v\) => \{ if \(v\.bounty\) s\._guildBountyDefeat\(v\); \}/.test(SCENE_SRC) && /for \(const tell of KILL_LEDGERS\) tell\(this, victim, source\);/.test(SCENE_SRC),
      'resolveDefeat calls it (a KILL_LEDGERS row)');
    assert.truthy(/guildfoe\)_\(-\?\\\\d\+\)_/.test(SCENE_SRC), 'the caught-prune knows the prefix');
    assert.truthy(/this\._tickTraps\(dt\);\s*\/\/[^\n]*\n\s*this\._tickGuildBounty\(\);/.test(SCENE_SRC), 'the leash ticks');
  });

  // ── Curio hall ────────────────────────────────────────────────────────────
  test('curio: one shared list of things that keep — nothing that spoils or grows', () => {
    const list = Macros.curioCollection();
    assert.eq(list.length, Macros.CURIO_COLLECTION.length, 'every listed id is a real item');
    assert.inRange(list.length, 20, 30, 'a real collection');
    assert.eq(new Set(list).size, list.length, 'no duplicates');
    const keeps = new Set(['shell', 'crow_feather', 'rabbit_pelt', 'old_boot']);
    for (const id of list) {
      const it = ITEM_BY_ID[id];
      assert.falsy(id in FOOD_ENERGY, `${id} is not food`);
      assert.falsy(['seed', 'sapling', 'magic', 'animal'].includes(it.kind), `${id} is no seed, sapling, potion or animal`);
      assert.truthy(['mineral', 'supply', 'unique_relic'].includes(it.kind) || keeps.has(id), `${id} is a lasting thing (${it.kind})`);
    }
    for (const id of ['potato', 'apple', 'flowers', 'healing_potion', 'egg', 'potato_seed', 'acorn']) {
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
    const save = SaveState.defaults({ money: 1e9 });
    assert.eq(Macros.lessonPricesAll().join(), '25,50,75,100,125', '25 × level');
    assert.eq(Macros.buyLesson(save, 'ranged', 1).why, 'memories', 'level 1 needs 2 memories');
    assert.eq(Macros.buyLesson(save, 'ranged', 1).need, 2);
    let paid = 0;
    for (let i = 0; i < 10; i++) { const r = Macros.buyLesson(save, 'ranged', 10); if (r.ok) paid += r.price; }
    assert.eq(Combat.trainingLevel(save, 'ranged'), 5, 'ten memories reach level 5');
    assert.eq(paid, 375);
    assert.eq(Macros.buyLesson(save, 'ranged', 99).why, 'cap');
    assert.eq(Macros.buyLesson(save, 'magic', 99).ok, true, 'each discipline is its own track');
    const s2 = SaveState.defaults({ money: 1e9 });
    for (let i = 0; i < 5; i++) Macros.buyLesson(s2, 'melee', 5);
    assert.eq(Combat.trainingLevel(s2, 'melee'), 2, 'five memories stop at level 2 (level 3 needs 6)');
    assert.eq(Macros.buyLesson(save, 'nonsense', 99).why, 'kind');
  });

  test('training: bonuses land per discipline, drills add and lapse, old melee saves carry over', () => {
    const save = SaveState.defaults({ money: 1e9, training: { melee: 2, ranged: 3, energy: 4, speed: 5 } });
    assert.eq(Combat.trainingBonus(save, 'melee', T0), 2);
    assert.eq(Combat.trainingBonus(save, 'ranged', T0), 3);
    assert.eq(Combat.trainingBonus(save, 'magic', T0), 0);
    assert.eq(Combat.trainingBonus(save, 'energy', T0), 40);
    assert.inRange(Combat.trainingIntervalMul(save, T0) - 1 / 1.25, -1e-12, 1e-12, 'five speed levels: a beat 1/1.25 as long');
    assert.eq(Macros.buyDrill(save, 'melee', T0).ok, true);
    assert.eq(Macros.buyDrill(save, 'melee', T0 + 1).ok, true, 'a drill bought while one runs is not refused');
    assert.eq(save.trainingDrills.melee, T0 + 2 * DAY, 'it extends: another day on top of what is left (Buffs.laterOf)');
    save.trainingDrills.melee = T0 + DAY;
    assert.eq(Macros.buyDrill(save, 'energy', T0).ok, true, 'another discipline\'s may run beside it');
    assert.eq(Combat.trainingBonus(save, 'melee', T0 + DAY - 1), 7, 'lessons and a drill add');
    assert.eq(Combat.trainingBonus(save, 'energy', T0 + 1), 90);
    assert.eq(Combat.trainingBonus(save, 'melee', T0 + DAY), 2, 'the drill is gone at 24 h');
    assert.eq(shortDuration(Macros.drillLeftMs(save, 'melee', T0 + DAY - 3600000)), '1h', 'shown in shortDuration');
    assert.eq(Macros.drillPrice(), 150);
    assert.eq(Energy.maxEnergy({ training: { energy: 3 } }) - Energy.maxEnergy({}), 30, 'stamina lifts the bar\'s cap');
  });

  test('training: each attack type reads its own discipline, and speed shortens every beat', () => {
    assert.truthy(/_attackFlat\(kind\) \{\s*const training = Combat\.TRAINING_KINDS\[kind\]\?\.unit === 'dmg' \? Combat\.trainingBonus\(this\.save, kind\) : 0;/.test(SCENE_SRC), '_attackFlat, by type');
    assert.truthy(/meleeSwingDamage\(this\.save\.relics, this\._attackMul\(\), this\.save\.playerClass, Gear\.activeWeapon\(this\.save\), isRiding\(this\.save\)\)\s*\+ this\._attackFlat\('melee'\)\)/.test(SCENE_SRC), 'melee blows take melee');
    assert.truthy(/\* dmgMul\s*\+ this\._attackFlat\(Combat\.TRAINING_SLOT_KIND\[slot\]\),/.test(SCENE_SRC), 'shots take their slot\'s');
    assert.eq(Combat.TRAINING_SLOT_KIND.bow, 'ranged'); assert.eq(Combat.TRAINING_SLOT_KIND.staff, 'magic');
    assert.truthy(/this\._nextBlowT = now \+ Combat\.meleeIntervalMs\(Gear\.activeWeapon\(this\.save\), isRiding\(this\.save\)\) \* Combat\.playerAttackIntervalMul\(this\.save\);/.test(SCENE_SRC), 'the melee beat');
    const body = SCENE_SRC.slice(SCENE_SRC.indexOf('  _presentTraining(sx, sy, o, dress) {'), SCENE_SRC.indexOf('  buildingFlavorTitle('));
    assert.truthy(/memories required/.test(body), 'the lesson states its requirement');
    assert.truthy(/Macros\.buyLesson\(this\.save, kind, this\.memoriesTotal\(\)\)/.test(body), 'gated on memories RECOVERED');
  });

  test('tips: places offer a story hint while service values remain owned', () => {
    for (const place of ['inn', 'guildhall', 'curio hall', 'training hall', 'book club']) {
      assert.truthy(PLAY_TIPS.some(t => t.toLowerCase().includes(place)), `${place}: a story page`);
    }
    assert.eq(Macros.INN_RATE, 0.5);
    assert.eq(Macros.CHAPEL_TIER_DROP, 1);
    assert.eq(Macros.BOUNTY_MATCH, 1);
    assert.falsy(/scriptorium lends/i.test(TIPS_BLOB_ALL()), 'no free page');
  });

  // ── The picture ───────────────────────────────────────────────────────────
  test('macro: every booth has dedicated, distinct introduction and transaction paintings', () => {
    const seen = new Set();
    for (const kind of MACRO_KINDS) {
      assert.eq(Macros.stallArt(kind), `booth_${kind}_intro`);
      const success = Macros.KIND_TRANSACTION[kind];
      assert.eq(success.art, `booth_${kind}_used`);
      assert.truthy(success.title);
      for (const stem of [Macros.stallArt(kind), success.art]) {
        assert.falsy(seen.has(stem), `${stem} is dedicated to one booth and stage`);
        seen.add(stem);
        const d = webpDims(`assets/art/${stem}.webp`);
        assert.truthy(d, `${stem} ships`);
        assert.truthy(Math.abs(d.w / d.h - 352 / 448) < 0.01, `${stem} fits the dialog`);
      }
    }
    assert.eq(seen.size, 18);
  });
  test('macro: each kind ships its 80×80 art and an ASSETS row under its texKey', () => {
    for (const kind of MACRO_KINDS) {
      const rel = `assets/Objects/Generated/${kind}_simple.png`;
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
    assert.eq(Macros.KIND_DIALOG.chapel.art, 'booth_chapel_intro', 'the chapel has its own respectful booth painting');
  });

  // ── The scholar's booth: the BOOK CLUB (Oct 2026) ─────────────────────────
  // One shelf for every school, humblest first; found books read earn it.
  test('scholar: the shelf contains every tome once, humblest first, independent of chests', () => {
    const shelf = Macros.scholarShelf();
    const tomes = ITEMS.filter(item => isTome(item.id)).map(item => item.id);
    assert.eq(shelf.length, 8);
    assert.eq(new Set(shelf).size, shelf.length, 'one of each per cycle');
    for (const id of shelf) assert.truthy(isTome(id), `${id} is a tome`);
    for (const id of tomes) assert.includes(shelf, id);
    for (let i = 1; i < shelf.length; i++) {
      assert.lte(itemValue(shelf[i - 1]), itemValue(shelf[i]), 'ascending value');
    }
    assert.falsy(shelf.includes('book'), 'a prize never earns its own reading credit');
    assert.eq(Macros.scholarShelf().join(), shelf.join(), 'the same shelf every time, every school');
  });

  test('scholar: every three books earns a tome, with a repeating shelf', () => {
    const shelf = Macros.scholarShelf();
    const per = Macros.SCHOLAR_BOOKS_PER_PRIZE;
    assert.eq(per, 3);
    const save = {};
    assert.eq(Macros.booksRead(save), 0, 'a fresh save has read nothing');
    let next = Macros.scholarNext(save, shelf);
    assert.eq(next.id, shelf[0]); assert.eq(next.booksAt, per); assert.falsy(next.ready, 'unread: not ready');
    assert.eq(Macros.scholarClaim(save, shelf).why, 'unread', 'nothing to collect yet');
    save.booksRead = per - 1;
    assert.falsy(Macros.scholarNext(save, shelf).ready, 'one short');
    save.booksRead = per;
    assert.truthy(Macros.scholarNext(save, shelf).ready, 'the third book earns the first prize');
    let r = Macros.scholarClaim(save, shelf);
    assert.truthy(r.ok && r.id === shelf[0], 'the humblest prize first');
    assert.eq(Macros.scholarTaken(save), 1);
    assert.eq(Macros.scholarClaim(save, shelf).why, 'unread', 'the same reading pays once');
    assert.eq(Macros.scholarNext(save, shelf).id, shelf[1], 'then the next up the shelf');
    // Read far ahead: the prizes still come one at a time, in order.
    save.booksRead = per * shelf.length + 100;
    for (let i = 1; i < shelf.length; i++) {
      r = Macros.scholarClaim(save, shelf);
      assert.truthy(r.ok && r.id === shelf[i], `prize ${i} is ${shelf[i]}`);
    }
    assert.eq(Macros.scholarNext(save, shelf).id, shelf[0], 'the next cycle starts with the first tome');
    assert.eq(Macros.scholarNext(save, shelf).booksAt, (shelf.length + 1) * per);
    assert.eq(Macros.scholarClaim(save, shelf).id, shelf[0]);
    assert.eq(Macros.scholarTaken(save), shelf.length + 1);
    assert.eq(Macros.scholarClaim(save, []).why, 'bare', 'an empty catalog has no reward');
    // Garbage in the ledger reads as nothing, never as a free shelf.
    assert.eq(Macros.booksRead({ booksRead: 'lots' }), 0);
    assert.eq(Macros.scholarTaken({ scholarTomes: -3 }), 0);
  });


  test('scholar: legacy mixed prizes never skip tome rewards and reading credit survives', () => {
    const save = { booksRead: 12, scholarPrizes: 20 };
    assert.eq(Macros.scholarTaken(save), 0);
    assert.eq(Macros.scholarNext(save).booksAt, 3);
    for (let i = 0; i < 4; i++) assert.truthy(Macros.scholarClaim(save).ok);
    assert.eq(Macros.scholarNext(save).booksAt, 15);
    assert.falsy(Macros.scholarNext(save).ready);
    assert.eq(save.booksRead, 12);
    assert.eq(save.scholarPrizes, 20);
    assert.eq(save.scholarTomes, 4);
    const reload = JSON.parse(JSON.stringify(save));
    assert.eq(Macros.scholarNext(reload).booksAt, 15);
  });

  test('scholar: every Book read counts — found or bought — and the counter is the brake', () => {
    // addToInv's Book branch credits save.booksRead for every read, with no
    // wild-finds test: a bought Book is a read Book.
    const i = SCENE_SRC.indexOf("if (id === 'book') {");
    const branch = SCENE_SRC.slice(i, SCENE_SRC.indexOf('return n;', i));
    assert.truthy(/if \(!silent\) \{[\s\S]*this\.save\.booksRead = \(this\.save\.booksRead \|\| 0\) \+ n;/.test(branch),
      'every non-silent Book read is the club\'s reading');
    assert.falsy(/notWild[\s\S]*booksRead|booksRead[^\n]*notWild/.test(branch), 'no purchase test on the reading');
    // The brake: the Book's list price climbs ×BOOK_PRICE_GROWTH per Book
    // bought, to a cap, at EVERY counter — one lane, ShopsMath.listPrice.
    const base = PRICES.book;
    assert.eq(ShopsMath.listPrice({}, 'book'), base, 'the first Book is the catalogue price');
    const save = {};
    ShopsMath.bookBought(save);
    assert.eq(save.booksBought, 1);
    assert.eq(ShopsMath.listPrice(save, 'book'), Math.ceil(base * ShopsMath.BOOK_PRICE_GROWTH), 'the second climbs');
    assert.eq(ShopsMath.listPrice(save, 'torch'), PRICES.torch, 'nothing else does');
    assert.eq(ShopsMath.listPrice(save, 'chicken', 99), 99, 'a passed base (itemValue) is honoured');
    ShopsMath.bookBought(save, 40);
    assert.eq(ShopsMath.listPrice(save, 'book'), base * ShopsMath.BOOK_PRICE_CAP_MUL, 'capped');
    assert.gt(ShopsMath.listPrice(save, 'book'), 300, 'and dear');
    assert.eq(Macros.stallPrice(save, 'book'), ShopsMath.standPrice(save, ShopsMath.listPrice(save, 'book')), 'the stall reads the ladder');
    assert.truthy(/const listPrice = ShopsMath\.listPrice\(this\.save, id\);\s*const unitPrice = ShopsMath\.standPrice\(this\.save, listPrice\);/.test(SCENE_SRC),
      'the stall counter prices off the ladder');
    assert.truthy(/const want = 1;/.test(SCENE_SRC), 'and sells a Book one at a time');
    assert.truthy(/this\.buildShopOffer\(id, units \* ShopsMath\.listPrice\(this\.save, id, itemValue\(id\)\), \{ house \}\)/.test(SCENE_SRC),
      'the themed shop prices off the ladder');
    assert.eq((SCENE_SRC.match(/if \(id === 'book'\) ShopsMath\.bookBought\(this\.save, (?:take|buyQty)\);/g) || []).length, 2,
      'both counters climb the ladder on a sale');
    // A tome prize is handed over notWild and persisted together with its claim.
    const pres = SCENE_SRC.slice(SCENE_SRC.indexOf('_presentScholar(sx, sy, o, dress) {'));
    assert.truthy(/this\.addToInv\(next\.id, 1, false, \{ notWild: true, deferRefresh: true \}\)/.test(pres.slice(0, pres.indexOf('\n  }\n'))),
      'the prize is handed over notWild');
    assert.truthy(/if \(!d\.stock\) return this\[d\.present\]\(sx, sy, o, dress\);/.test(SCENE_SRC), 'presentMacro routes it by the row');
    assert.eq(Macros.KIND_DIALOG.scholar.label, 'Book Club');
    assert.lte('Tome collected'.length, MAP_MSG_MAX);
    assert.truthy(/book club/i.test(Macros.KIND_STORY.scholar.body) && /join/i.test(Macros.KIND_STORY.scholar.body), 'the story is the joining');
  });

  test('bookshop: the Book Shop card, from the 15th restoration, is a market that sells only the Book, outside the line cycle', () => {
    assert.eq(Houses.STORY_RESTORES.bookshop, 15);
    assert.eq(Houses.buildOption('bookshop').from, 15, 'on offer from the 15th rebuild');
    assert.eq(Houses.buildOption('bookshop').role, 'market', 'stored as a shop');
    assert.eq(Shops.THEME_LABEL.book, 'Book Shop');
    assert.eq(Shops.themedStock('book', 1).join(), 'book', 'the Book and nothing else');
    assert.falsy(Shops.THEMES.includes('book'), 'not a line of the cycle');
    // Stamped at restore time, once, on the explicit pick.
    const save = SaveState.defaults({ restoredHouses: {} });
    const rh = save.restoredHouses;
    const h = (id) => ({ kind: 'house', tier: 9, id });
    assert.eq(Houses.restoreAs(save, h('h0'), 'plain').key, 'plain');
    assert.eq(Houses.restoreAs(save, h('h1'), 'bookshop'), null, 'not on offer yet');
    const shopKey = () => Houses.buildOptions(save, null).find((r) => r.role === 'market' && r.key !== 'bookshop').key;
    for (let i = 1; i < 14; i++) Houses.restoreAs(save, h('h' + i), i % 3 === 0 ? shopKey() : 'plain');
    assert.eq(save.bookshopId, undefined, 'an ordinary market is not it');
    assert.eq(Houses.restoreAs(save, h('b'), 'bookshop').key, 'bookshop');
    assert.eq(save.bookshopId, 'b', 'the pick is');
    assert.eq(rh.b, 'market');
    assert.eq(Houses.restoreAs(save, h('m'), 'bookshop'), null, 'once per save');
    assert.eq(Houses.restoreAs(save, h('m'), shopKey()).role, 'market');
    assert.eq(Shops.lineFor(save, { id: 'b' }).theme, 'book');
    assert.eq(Shops.lineFor(save, { id: 'b' }).tier, 1);
    // Outside the cycle: the markets before it keep their order, and the one
    // after it takes the line the bookshop would otherwise have spent.
    const markets = Object.keys(rh).filter((id) => rh[id] === 'market' && id !== 'b');
    markets.forEach((id, n) => assert.eq(Shops.shopOrder(save, { id }), n, `${id} keeps place ${n}`));
    const lines = Shops.marketLines(save), mine = lines.find((r) => r.id === 'm');
    assert.eq(mine.tier, 1, 'a picked T1 line is T1 however many stand on it (the stamped rank)');
    assert.truthy(/const row = Houses\.restoreAs\(this\.save, house, key, \{ hammer \}\);/.test(SCENE_SRC), 'the restore path freezes the pick');
    assert.truthy(/return Shops\.lineFor\(this\.save, house\);/.test(SCENE_SRC), 'marketTheme reads lineFor');
    assert.falsy(/Shops\.themeAt\(Shops\.shopOrder/.test(SCENE_SRC), 'and nothing reads the cycle directly');
    // A save past the slot before the bookshop existed: no old shop is re-labelled.
    const old = { restoredHouses: {} };
    for (let i = 0; i < 20; i++) old.restoredHouses['o' + i] = i % 2 ? 'market' : 'plain';
    assert.eq(Shops.lineFor(old, { id: 'o15' }).theme, Shops.themeAt(Shops.shopOrder(old, { id: 'o15' })).theme, 'no old shop is re-labelled');
    assert.eq(Houses.restoreAs(old, h('n'), 'bookshop').key, 'bookshop');
    assert.eq(old.bookshopId, 'n');
  });

  test('chest themes: the Book is in every tier-2 roll at the owner\'s share', () => {
    assert.eq(ChestThemes.BOOK_T2_SHARE, 20);
    for (const theme of Object.keys(ChestThemes.themes)) {
      for (const depth of [0, 1]) {
        const w = ChestThemes.weights(theme, 2, { depth, tier: 2 });
        assert.inRange(Object.values(w).reduce((a, b) => a + b, 0), 99.999, 100.001, `${theme} d${depth} conserves`);
        assert.gte((w.books || 0) + (w.plainBook || 0), ChestThemes.BOOK_T2_SHARE - 1e-9, `${theme} d${depth}: books ≥ ${ChestThemes.BOOK_T2_SHARE}`);
        assert.falsy(w.books && w.plainBook, `${theme} d${depth}: one book lane, not two`);
      }
      // The share's lane is the plain Book at every roll tier a T2 chest can
      // climb to: a row with its own books lane keeps it (the Book at T1/T2,
      // a tome only from T3), a row without gets plainBook (the Book always).
      assert.eq(ChestThemes.eligible('books', 2, { theme }).join(), 'book', `${theme}: the Book, not a tome`);
      for (const t of [1, 2, 3, 5]) assert.eq(ChestThemes.eligible('plainBook', t, { theme }).join(), 'book', `${theme}: plainBook at T${t}`);
    }
    assert.eq(ChestThemes.weights('food', 2, { tier: 2 }).plainBook, ChestThemes.BOOK_T2_SHARE, 'a row without a book lane gets the plain Book');
    assert.eq(ChestThemes.weights('worship', 2, { tier: 2 }).books, ChestThemes.BOOK_T2_SHARE, 'a row with one is topped up');
    assert.gt(ChestThemes.weights('school', 2).books, ChestThemes.BOOK_T2_SHARE, 'a row already past the share is left alone');
    assert.falsy(ChestThemes.weights('food', 1).books, 'a T1 chest is untouched');
    assert.falsy(ChestThemes.weights('food', 3, { tier: 3 }).books, 'so is a T3 chest');
    assert.eq(ChestThemes.weights('food', 1, { tier: 2 }).plainBook, ChestThemes.BOOK_T2_SHARE, 'a T2 chest rolling at T1 still carries it');
    assert.eq(ChestThemes.weights('culture', 2, { tier: 2 }).uniqueRelics, 5, 'the rare-finds lane keeps its exact share');
    // Measured: a fifth of tier-2 rolls from a theme that never carried it.
    let books = 0; const N = 4000;
    let x = 0xB00C2; const rng = () => { x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
    for (let i = 0; i < N; i++) {
      const r = pickReward('chest:food', { relics: {}, armor: {} }, rng, { tier: 2 });
      if (r && r.kind === 'item' && r.id === 'book') books++;
    }
    assert.inRange(books / N, 0.15, 0.25, 'about a fifth of T2 food chests hand a Book: ' + (books / N).toFixed(3));
  });

  test('scholar: the Casorso field keeps its book club without a fabricated school wall', () => {
    const tx=2754, ty=5566, N=WorldGen.cellsPerEdgeForTile(ty);
    const edge=WorldGen.tileEdgeMeters(WorldGen.latOfRowCentre(ty)), cellM=edge/N;
    const r=WorldGen.rasterizeTile(MVT.decodeTile(FIXTURE_TILES['2754_5566']),N,tx,ty,edge);
    const booths=r.objects.filter(o=>o.kind==='chest' && o._poiAt==='1312,3693');
    assert.eq(booths.length,1,'the source school survives occupancy and POI deduplication');
    const booth=booths[0];
    assert.eq(chestLook(booth).texKey,'macro_scholar');
    assert.falsy(isSpent(booth,spentSets(null,{opened:[booth.id]})),'legacy opened saves keep the counter visible');
    const ix=Math.floor(booth.x/cellM)-tx*N, iy=Math.floor(booth.y/cellM)-ty*N;
    assert.falsy(WorldGen.isBuildingTerrain(r.grid[iy*N+ix]),'outside the school');
    const sourceX=Math.floor(1312*N/4096), sourceY=Math.floor(3693*N/4096);
    const owner=r.owners[sourceY*N+sourceX];
    assert.eq(owner,0,'the school POI marks open ground, not a physical building');
  });

  test('scholar: an open-ground school keeps its booth without inventing a building', () => {
    const T = WorldGen.T;
    const r = WorldGen.rasterizeTile([
      { name: 'landcover', features: [{ type: 3, tags: { class: 'grass' },
        geom: [[{ x: -64, y: -64 }, { x: 4160, y: -64 }, { x: 4160, y: 4160 }, { x: -64, y: 4160 }, { x: -64, y: -64 }]] }] },
      { name: 'poi', features: [{ type: 1, tags: { class: 'school', name: 'Test School' }, geom: [[{ x: 2048, y: 2048 }]] }] },
    ], 64, 0, 0, 640);
    const chests = r.objects.filter((o) => o.kind === 'chest');
    assert.eq(chests.length, 1, 'one booth');
    const booth = chests[0];
    assert.eq(macroFor(booth).kind, 'scholar', 'the school is the scholar\'s booth');
    const N = 64, cellM = 640 / N;
    const ix = Math.floor(booth.x / cellM), iy = Math.floor(booth.y / cellM);
    const at = (x, y) => r.grid[y * N + x];
    assert.falsy(WorldGen.isBuildingTerrain(at(ix, iy)), 'the booth is not inside the block');
    let block = 0, commercial = 0;
    for (let i = 0; i < N * N; i++) { if (r.grid[i] === T.BUILDING_LARGE) block++; if (r.grid[i] === T.COMMERCIAL) commercial++; }
    assert.eq(block, 0, 'a school POI does not establish a building footprint');
    assert.eq(commercial, 0, 'no concrete pyramid pad any more');
    assert.eq(r.objects.filter(o => o.kind === 'tower').length, 0, 'no invented castle towers');
  });

  test('macro: a chapel is minted for a church only — a synagogue, mosque or temple mints nothing', () => {
    const r = (tags) => WorldGen.rasterizeTile([
      { name: 'landcover', features: [{ type: 3, tags: { class: 'grass', subclass: 'park' },
        geom: [[{ x: -64, y: -64 }, { x: 4160, y: -64 }, { x: 4160, y: 4160 }, { x: -64, y: 4160 }, { x: -64, y: -64 }]] }] },
      { name: 'poi', features: [{ type: 1, tags, geom: [[{ x: 2048, y: 2048 }]] }] },
    ], 64, 0, 0, 640).objects.filter((o) => o.kind === 'chest' && !o.chestTopUp);
    assert.eq(r({ class: 'place_of_worship', subclass: 'christian' }).map((o) => macroFor(o) && macroFor(o).kind).join(), 'chapel');
    for (const faith of ['jewish', 'muslim', 'buddhist', 'hindu']) {
      assert.eq(r({ class: 'place_of_worship', subclass: faith }).length, 0, `${faith}: no chest, no chapel`);
    }
    assert.eq(r({ class: 'place_of_worship' }).length, 0, 'no faith given and no church name: nothing');
  });
})();
