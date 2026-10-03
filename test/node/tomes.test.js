// THE TOMES (Oct 2026, expanded).
//
// Eight permanent books are scholar prizes. A tome's spell is HALF its
// potion's (TOME_EFFECT_MUL: half duration, half damage or restore); its
// cooldowns are the SHARED 1 h activation lock (TOME_COOLDOWN_MS, every tome
// locked by reading any one) plus its OWN magic cooldown (CONSUMABLE_SPEC
// cooldownMs, power-scaled: 2 h / 8 h / 24 h). Home refreshes both; the
// enchanter halves both; nothing is ever consumed.
(function () {
  const APP = globalThis.SCENE_SRC || '';

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

  test('tomes: book chests keep supplying story Books at every tier', () => {
    for (let tier = 1; tier <= 7; tier++) {
      const resolved = ChestThemes.resolve('books', tier, { theme: 'school', depth: 0 });
      assert.eq(resolved.ids.join(), 'book', `T${tier}: only the story Book`);
      assert.eq(ChestThemes.pickItem(resolved, tier, () => 0.5), 'book');
    }
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
