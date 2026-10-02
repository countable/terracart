// THE TOMES (Oct 2026, expanded).
//
// Eight permanent books replace the story Book in
// any book chest whose tier meets their own (the books group admits by
// baseTier, pickItem takes the top tier present). A tome's spell is HALF its
// potion's (TOME_EFFECT_MUL: half duration, half damage or restore); its
// cooldowns are the SHARED 1 h activation lock (TOME_COOLDOWN_MS, every tome
// locked by reading any one) plus its OWN magic cooldown (CONSUMABLE_SPEC
// cooldownMs, power-scaled: 2 h / 8 h / 24 h). Home refreshes both; the
// enchanter halves both; nothing is ever consumed.
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

  const ROSTER = [
    ['tome_sight', 'Tome of Reach', 3, 160, 2 * 3600e3],
    ['tome_speed', 'Tome of Speed', 3, 160, 2 * 3600e3],
    ['tome_shield', 'Tome of Shielding', 3, 160, 2 * 3600e3],
    ['tome_healing', 'Tome of Healing', 3, 160, 2 * 3600e3],
    ['tome_raven', 'Tome of the Raven', 4, 400, 8 * 3600e3],
    ['tome_blight', 'Tome of Blight', 4, 400, 8 * 3600e3],
    ['tome_firewall', 'Wall of Fire Tome', 4, 400, 8 * 3600e3],
    ['tome_storm', 'Tome of Thunder', 5, 1000, 24 * 3600e3],
  ];

  test('tomes: eight registered, named, unique, tiered, priced, framed', () => {
    for (const [id, name, tier, price, cd] of ROSTER) {
      const it = ITEM_BY_ID[id];
      assert.truthy(it, `${id} registered`);
      assert.eq(it.name, name, `${id}: name`);
      assert.eq(it.kind, 'unique_relic', `${id}: a unique relic - never drops twice, never stacks`);
      assert.eq(BASE_TIER[id], tier, `${id}: tier`);
      assert.eq(PRICES[id], price, `${id}: price`);

      assert.truthy(MINERAL_ICON_SHEET[id]?.sheet === 'icon_book', `${id}: a Books.png frame`);
      assert.eq(CONSUMABLE_SPEC[id].cooldownMs, cd, `${id}: power-scaled own cooldown`);
      assert.truthy(ITEM_EFFECTS[id], `${id}: a description`);
    }
  });

  test('tomes: the books group hands tomes, never the story Book, at tier', () => {
    const res = (tier) => ChestThemes.resolve('books', tier, { theme: 'civic', depth: 0 });
    for (const tier of [1, 2]) {
      assert.eq(res(tier).ids.join(), 'book', `T${tier}: only the story Book`);
    }
    const rng = seeded(77);
    const seen = new Set();
    for (let i = 0; i < 400; i++) seen.add(ChestThemes.pickItem(res(3), 3, rng));
    assert.eq([...seen].sort().join(), ['tome_healing', 'tome_shield', 'tome_sight', 'tome_speed'].sort().join(),
      'T3 rolls only the T3 tomes');
    seen.clear();
    for (let i = 0; i < 400; i++) seen.add(ChestThemes.pickItem(res(4), 4, rng));
    assert.eq([...seen].sort().join(), ['tome_blight', 'tome_firewall', 'tome_raven'].sort().join(),
      'T4 rolls all three T4 tomes');
    seen.clear();
    for (let i = 0; i < 400; i++) seen.add(ChestThemes.pickItem(res(5), 5, rng));
    assert.eq([...seen].join(), 'tome_storm', 'T5 rolls only the T5 tome');
    assert.eq(ChestThemes.cap('tome_storm'), 1, 'a tome is one per chest');
    assert.eq(ChestThemes.cap('tome_firewall'), 1, 'a wall of fire tome is one per chest');
    const carried = { inv: [{ id: 'tome_sight', count: 1 }] };
    assert.falsy(ChestThemes.eligible('books', 3, { theme: 'civic', save: carried }).includes('tome_sight'),
      'a carried tome never drops again');
    assert.truthy(ChestThemes.eligible('books', 1, { theme: 'school', save: { inv: [] } }).includes('book'),
      'a school T1 chest still hands the story Book');
  });

  test('tomes: the shared hour lock, the own cooldown, and nothing consumed', () => {
    for (const [, , , , cd] of ROSTER.slice(0, 3)) {
      assert.eq(cd, 2 * 3600e3, 'the T3 ladder rung');
    }
    const m = (name) => SCENE_SRC.match(new RegExp(`\\n  ${name}\\(\\) \\{\\n([\\s\\S]*?)\\n  \\}\\n`));
    for (const [id] of ROSTER) {
      const method = ['tome_sight', 'tome_raven', 'tome_storm'].includes(id)
        ? { tome_sight: 'readTomeSight', tome_raven: 'readTomeRaven', tome_storm: 'readTomeStorm' }[id]
        : { tome_speed: 'readTomeSpeed', tome_shield: 'readTomeShield', tome_healing: 'readTomeHealing', tome_blight: 'readTomeBlight', tome_firewall: 'readTomeFirewall' }[id];
      const r = m(method);
      assert.truthy(r, `${method} exists`);
      assert.falsy(/_finishConsumable/.test(r[1]), `${method}: never consumed`);
      assert.truthy(new RegExp(`sel\\.id !== '${id}'`).test(r[1]), `${method}: only a selected ${id}`);
      assert.truthy(/_tomeReady\('/.test(r[1]), `${method}: gated`);
    }
    assert.truthy(/const TOME_COOLDOWN_MS = 60 \* 60 \* 1000;/.test(APP), 'the shared lock is one hour');
    assert.truthy(/save\.tomeReadyAt = now \+ TOME_COOLDOWN_MS \* mul/.test(APP), 'stamped once per read, all tomes');
    assert.truthy(/tomeMagicCd \|\|= \{\}\)\[id\] = now \+ \(CONSUMABLE_SPEC\[id\]\?\.cooldownMs \|\| 0\) \* mul/.test(APP),
      'the own cooldown stamps the spec length');
    assert.truthy(/shortDuration\(shared\)|shortDuration\(own\)/.test(APP), 'refusals show their wait');
    assert.truthy(/isRestingAtHome\(px, py\)/.test(APP), 'Home refreshes both');
    assert.truthy(/No foe in sight — tome kept/.test(APP), 'the storm tome refuses an empty screen');
  });

  test('tomes: a tome\'s spell is HALF its potion\'s', () => {
    assert.truthy(/const TOME_EFFECT_MUL = 0\.5;/.test(APP), 'one owning multiplier');
    for (const c of ['REACH_POTION_MS', 'SPIRIT_RAVEN_MS', 'SPEED_POTION_MS', 'SHIELD_POTION_MS', 'BLIGHT_MS'])
      assert.truthy(new RegExp(c + ' \\* TOME_EFFECT_MUL').test(APP), `${c} halves in the tome`);
    assert.truthy(/const TOME_THUNDER_DMG = Math\.floor\(THUNDER_DMG \* TOME_EFFECT_MUL\);/.test(APP), 'thunder damage halves');
    assert.truthy(/const TOME_HEALING_ENERGY = Math\.floor\(VIGOR_POTION_ENERGY \* TOME_EFFECT_MUL\);/.test(APP), 'the heal halves');
  });

  test('vista: grails hold treasure only - no tools, produce or field supplies', () => {
    const banned = new Set(['potato', 'berry', 'cress', 'egg', 'milk', 'rope', 'trap_kit', 'torch', 'honey',
      'can', 'hoe', 'rod', 'bugnet', 'bags']);
    const rng = seeded(4242);
    const save = { relics: {}, armor: {} };
    let rolled = 0;
    for (let i = 0; i < 1500; i++) {
      const r = pickReward('chest:vista', save, rng, { tier: 5, depth: 0 });
      if (!r) continue;
      rolled++;
      if (r.slot) assert.falsy(banned.has(r.slot), `vista never hands the tool slot ${r.slot}`);
      else if (r.kind === 'item') assert.falsy(banned.has(r.id), `vista never hands ${r.id}`);
    }
    assert.truthy(rolled > 1400, 'the picker produced a full sample');
    assert.eq(ChestThemes.groups.gems.fallback.vista, 'antidote', 'gems falls back to a potion');
    assert.eq(ChestThemes.groups.healing.fallback.vista, 'antidote', 'healing falls back to a potion');
    assert.eq(ChestThemes.themes.vista.t1Fallback, 'antidote', 'the terminal is a T1 potion');
    assert.eq(ChestThemes.themes.vista.weights.noncombatGear, undefined, 'no noncombat tool lane in vista');
    assert.eq(ChestThemes.themes.vista.weights.protectiveGear, 45, 'armour is the equipment lane');
  });
})();
