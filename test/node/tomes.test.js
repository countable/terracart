// THE TOMES and the VISTA RULE.
//
// Special books (Books.png spare frames) replace the story Book in any
// chest whose tier meets their own: the books group admits by baseTier
// (ChestThemes.eligible) and pickItem takes the TOP tier present, so a T3+
// book chest hands a tome and never the plain Book. Reading one channels the
// original potions or a wall of flame, once a UTC day, and consumes nothing.
//
// The vista rule (same change-set): a grail chest holds treasure only —
// equipment, relics or magic items; never tools, produce or field
// supplies, anywhere in the fallback chain (which is why every vista
// fallback terminates at 'antidote', a T1 magic potion that can never be
// empty).
(function () {
  const APP = globalThis.APP_JS_SRC || '';

  function seeded(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  test('tomes: registered books have icons, tiers and prices', () => {
    for (const [id, tier, price] of [['tome_sight', 3, 90], ['tome_raven', 4, 170], ['tome_storm', 5, 300], ['tome_firewall', 4, 170]]) {
      const it = ITEM_BY_ID[id];
      assert.truthy(it, `${id} registered`);
      assert.eq(it.kind, 'supply', `${id}: book family, out of the magic pools`);
      assert.eq(BASE_TIER[id], tier, `${id}: tier`);
      assert.eq(PRICES[id], price, `${id}: price`);
      assert.truthy(MINERAL_ICON_SHEET[id] && MINERAL_ICON_SHEET[id].sheet === 'icon_book', `${id}: a Books.png frame`);
      assert.truthy(ITEM_EFFECTS[id], `${id}: a description`);
    }
  });

  test('tomes: the books group hands a tome, never the story Book, at tier', () => {
    const ids = ChestThemes.resolve('books', 4, { theme: 'civic', depth: 0 }).ids;
    assert.truthy(ids.includes('book') && ids.includes('tome_sight') && ids.includes('tome_raven'),
      'eligible at T4: the Book and the tomes up to its tier');
    // Top tier present wins: a T4 book chest never hands the plain Book.
    const rng = seeded(77);
    const seen = new Set();
    for (let i = 0; i < 300; i++) seen.add(ChestThemes.pickItem(ChestThemes.resolve('books', 4, { theme: 'civic', depth: 0 }), 4, rng));
    assert.eq([...seen].sort().join('|'), 'tome_firewall|tome_raven', 'T4 rolls both T4 tomes');
    seen.clear();
    for (let i = 0; i < 300; i++) seen.add(ChestThemes.pickItem(ChestThemes.resolve('books', 5, { theme: 'civic', depth: 0 }), 5, rng));
    assert.eq([...seen].join('|'), 'tome_storm', 'T5 rolls only the T5 tome');
    seen.clear();
    for (let i = 0; i < 300; i++) seen.add(ChestThemes.pickItem(ChestThemes.resolve('books', 1, { theme: 'school', depth: 0 }), 1, rng));
    assert.eq([...seen].join('|'), 'book', 'a school T1 chest still hands the story Book');
    assert.eq(ChestThemes.cap('tome_storm'), 1, 'a tome is one per chest');
    assert.eq(ChestThemes.cap('tome_firewall'), 1, 'a wall of fire tome is one per chest');
  });

  test('tomes: read once a UTC day, channel the potion below, consume nothing', () => {
    for (const [method, id] of [['readTomeSight', 'tome_sight'], ['readTomeRaven', 'tome_raven'], ['readTomeStorm', 'tome_storm']]) {
      const m = APP.match(new RegExp(`\\n  ${method}\\(\\) \\{\\n([\\s\\S]*?)\\n  \\}\\n`));
      assert.truthy(m, `${method} exists`);
      assert.falsy(/_finishConsumable/.test(m[1]), `${method}: the tome is never consumed`);
      assert.truthy(new RegExp(`sel\\.id !== '${id}'`).test(m[1]), `${method}: only a selected ${id}`);
      assert.truthy(/_tomeReady\('/.test(m[1]), `${method}: gated on the day ledger`);
    }
    assert.truthy(/_tomeReady\(id\) \{[\s\S]*?save\.tomeDays\?\.\[id\]\) === utcDayKey/.test(APP),
      'the gate reads save.tomeDays against today');
    assert.truthy(/shortDuration\(msToNextUtcDay\(\)\)/.test(APP), 'a refused reading shows its wait');
    assert.truthy(/reachPotionUntil = Date\.now\(\) \+ REACH_POTION_MS;/.test(APP.match(/\n  readTomeSight\(\) \{\n[\s\S]*?\n  \}\n/)[0]),
      'the sight tome channels the reach potion');
    assert.truthy(/spiritRavenUntil = Date\.now\(\) \+ SPIRIT_RAVEN_MS;/.test(APP.match(/\n  readTomeRaven\(\) \{\n[\s\S]*?\n  \}\n/)[0]),
      'the raven tome channels the raven potion');
    assert.truthy(/THUNDER_DMG/.test(APP.match(/\n  readTomeStorm\(\) \{\n[\s\S]*?\n  \}\n/)[0]),
      'the storm tome strikes like thunder');
    assert.truthy(/No foe in sight — tome kept/.test(APP), 'the storm tome refuses to spend on an empty screen');
  });

  test('vista: grails hold treasure only - no tools, produce or field supplies', () => {
    const banned = new Set(['potato', 'berry', 'cress', 'egg', 'milk', 'rope', 'trap_kit', 'torch', 'honey',
      'can', 'hoe', 'rod', 'bugnet', 'bags']);   // produce, supplies, noncombat gear slots
    const rng = seeded(4242);
    const save = { relics: {}, armor: {} };
    let rolled = 0;
    for (let i = 0; i < 1500; i++) {
      const r = pickReward('chest:vista', save, rng, { tier: 4, depth: 0 });
      if (!r) continue;
      rolled++;
      if (r.slot) assert.falsy(banned.has(r.slot), `vista never hands the tool slot ${r.slot}`);
      else if (r.kind === 'item') assert.falsy(banned.has(r.id), `vista never hands ${r.id}`);
    }
    assert.truthy(rolled > 1400, 'the picker produced a full sample');
    const complete = {
      inv: ITEMS.filter(item => item.kind === 'unique_relic').map(item => ({ id: item.id, count: 1 })),
      relics: Object.fromEntries(Object.keys(RELIC_DEFS).map(slot => [slot, { tier: 7 }])),
      armor: Object.fromEntries(Object.keys(ARMOR_DEFS).map(slot => [slot, { tier: 7 }])),
    };
    for (const inventory of [save, complete]) for (const tier of [1, 2, 3, 4, 5]) for (const depth of [0, 1]) {
      for (let i = 0; i < 150; i++) {
        const r = pickChestReward('vista', inventory, rng, { tier, depth });
        assert.falsy(r.kind === 'gold', 'vista never cashes out equipment');
        assert.eq(r.consolation, 0);
        if (r.kind === 'item') assert.includes(['magic', 'unique_relic'], ITEM_BY_ID[r.id].kind);
        else assert.eq(r.kind, 'armor');
        if (inventory === complete) assert.eq(ITEM_BY_ID[r.id].kind, 'magic', 'exhausted collection still gives magic');
      }
    }
    // The chain's terminals are magic or coins, never restorative produce:
    // every vista fallback names 'antidote'.
    assert.eq(ChestThemes.groups.gems.fallback.vista, 'antidote', 'gems falls back to a potion');
    assert.eq(ChestThemes.groups.healing.fallback.vista, 'antidote', 'healing falls back to a potion');
    assert.eq(ChestThemes.themes.vista.t1Fallback, 'antidote', 'the terminal is a T1 potion');
    assert.eq(ChestThemes.themes.vista.weights.noncombatGear, undefined, 'no noncombat tool lane in vista');
    assert.eq(ChestThemes.themes.vista.weights.protectiveGear, 45, 'equipment is a main grail reward');
  });
})();
