// THE TOMES (Oct 2026, expanded).
//
// Eight permanent books are scholar prizes. A tome's spell is HALF its
// potion's (items.js TOME_MUL, the row's `tome.mul`: half duration, half
// damage or restore); its
// cooldowns are the SHARED 1 h activation lock (TOME_COOLDOWN_MS, every tome
// locked by reading any one) plus its OWN magic cooldown (CONSUMABLE_SPEC
// cooldownMs, power-scaled: 2 h / 8 h / 24 h). Home refreshes both; the
// enchanter halves both; nothing is ever consumed.
(function () {
  const APP = globalThis.SCENE_SRC || '';

  const ROSTER = [
    ['tome_reach', 'Tome of Reach', 3, 160, 2 * 3600e3],
    ['tome_speed', 'Tome of Speed', 3, 160, 2 * 3600e3],
    ['tome_shielding', 'Tome of Shielding', 3, 160, 2 * 3600e3],
    ['tome_healing', 'Tome of Healing', 3, 160, 2 * 3600e3],
    ['tome_raven', 'Tome of the Raven', 4, 400, 8 * 3600e3],
    ['tome_blight', 'Tome of Blight', 4, 400, 8 * 3600e3],
    ['tome_fire_wall', 'Wall of Fire Tome', 4, 400, 8 * 3600e3],
    ['tome_thunder', 'Tome of Thunder', 5, 1000, 24 * 3600e3],
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
    // Every tome but the Wall of Fire is read by ONE method, _readTome, off
    // its row's `tome` column; the firewall keeps its own geometry spell.
    const m = (sig) => SCENE_SRC.match(new RegExp(`\\n  ${sig} \\{\\n([\\s\\S]*?)\\n  \\}\\n`));
    const read = m('_readTome\\(id\\)');
    assert.truthy(read, '_readTome exists');
    assert.falsy(/_finishConsumable|_spendScroll|_consumeSelected/.test(read[1]), '_readTome: never consumed');
    assert.truthy(/this\._selectedConsumable\(id\)/.test(read[1]), '_readTome: only the selected tome');
    assert.truthy(/this\._tomeReady\(id\)/.test(read[1]), '_readTome: gated');
    assert.truthy(/spend: false/.test(read[1]), '_readTome: the potion lane spends nothing');
    for (const [id] of ROSTER) {
      if (id === 'tome_fire_wall') {
        const fw = m('readTomeFirewall\\(\\)');
        assert.truthy(fw && /_tomeReady\('tome_fire_wall'\)/.test(fw[1]) && !/_finishConsumable/.test(fw[1]), 'the firewall tome: gated, never consumed');
        continue;
      }
      const t = CONSUMABLE_SPEC[id].tome;
      assert.truthy(t && CONSUMABLE_SPEC[t.of] && typeof t.flash === 'string', `${id}: a tome column (of, flash)`);
    }
    assert.truthy(/const TOME_COOLDOWN_MS = 60 \* 60 \* 1000;/.test(APP), 'the shared lock is one hour');
    assert.truthy(/save\.tomeReadyAt = now \+ TOME_COOLDOWN_MS \* mul/.test(APP), 'stamped once per read, all tomes');
    assert.truthy(/tomeMagicCd \|\|= \{\}\)\[id\] = now \+ \(CONSUMABLE_SPEC\[id\]\?\.cooldownMs \|\| 0\) \* mul/.test(APP),
      'the own cooldown stamps the spec length');
    assert.truthy(/this\.flashAtPlayer\(Macros\.waitLine\(wait\.line, wait\.ms\)\)/.test(APP), 'refusals show their wait, on the player');
    assert.truthy(/tomeUsable\(id\) \{ return !this\._tomeWait\(id\); \}/.test(APP), 'the button greys on the same wait');
    assert.truthy(/isRestingAtHome\(x, y\)\) return null;/.test(APP), 'Home refreshes both');
    assert.truthy(/noun: 'tome'/.test(read[1]), 'the storm tome refuses an empty screen with "tome kept"');
  });

  test('tomes: a tome\'s spell is HALF its potion\'s', () => {
    assert.eq(TOME_MUL, 0.5, 'one owning multiplier (items.js)');
    for (const [id] of ROSTER) if (CONSUMABLE_SPEC[id].tome) assert.eq(CONSUMABLE_SPEC[id].tome.mul, TOME_MUL, `${id}: the one multiplier`);
    const read = SCENE_SRC.match(/\n  _readTome\(id\) \{\n([\s\S]*?)\n  \}\n/)[1];
    assert.truthy(/this\._useTimedBuff\(t\.of, \{ mul: t\.mul, spend: false \}\)/.test(read), 'a timed buff: the dose halves');
    assert.truthy(/spec\.durationMs \* mul/.test(SCENE_SRC), '…in _useTimedBuff');
    assert.truthy(/this\._restoreEnergy\(Math\.floor\(of\.energy \* t\.mul\)\)/.test(read), 'the heal halves');
    assert.truthy(/damage: Math\.floor\(of\.damage \* t\.mul\)/.test(read), 'thunder damage halves');
    assert.falsy(/TOME_EFFECT_MUL|TOME_THUNDER_DMG|TOME_HEALING_ENERGY/.test(APP), 'no second multiplier or derived constant in app.js');
  });

  test('vista: grails hold treasure only - no tools, produce or field supplies', () => {
    const banned = new Set(['potato', 'berry', 'cress', 'egg', 'milk', 'rope', 'trap_disarm_kit', 'torch', 'taming_potion',
      'watering_can', 'hoe', 'fishing_rod', 'net', 'bag']);
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
