// Three combat additions (Oct 2026):
//   · the T6 SCROLL OF MOONBEAM — an 8 s instant beam along the facing,
//     10/s to every foe in its line (Combat.beamHits, scene _tickMoonbeam);
//   · LIFESTEAL — bats drink a share of each blow past their max
//     (Combat.feed), the Vampire Ring gives 20% of a melee blow back as
//     energy; neither draws anything from the undead (Combat.isUndead);
//   · BLINDED — a ghost's touch halves the player's light and reach for 15 s
//     (Conditions.DEFINITIONS.blinded, Conditions.lightMul).
(function () {
  function method(name) {
    const start = SCENE_SRC.indexOf('\n  ' + name + '(');
    const end = SCENE_SRC.indexOf('\n  }\n', start);
    assert.truthy(start >= 0 && end > start, `found ${name}`);
    return new Function('return ({' + SCENE_SRC.slice(start, end + 4) + '})[' + JSON.stringify(name) + ']')();
  }

  test('moonbeam: a T6 magic scroll with its own icon, cast through its method', () => {
    const it = ITEM_BY_ID.moonbeam_scroll, spec = CONSUMABLE_SPEC.moonbeam_scroll;
    assert.truthy(it && it.kind === 'magic' && it.scroll, 'a magic scroll');
    assert.eq(BASE_TIER.moonbeam_scroll, 6);
    assert.eq(spec.durationMs, 8000);
    assert.eq(spec.dps, 10);
    assert.eq(spec.method, 'useMoonbeamScroll');
    assert.gt(PRICES.moonbeam_scroll, 0);
    assert.truthy(ITEM_EFFECTS.moonbeam_scroll && ITEM_GUIDE_TIPS.moonbeam_scroll, 'described');
    assert.eq(MINERAL_ICON_SHEET.moonbeam_scroll.sheet, 'icon_moonbeam_scroll');
    assert.truthy(/icon_moonbeam_scroll: \{ url: 'assets\/Icons\/Items\/MoonbeamScroll\.png'/.test(SCENE_SRC), 'both icon tables');
    assert.eq(Buffs.KINDS.moonbeam.scene, '_moonbeamUntil', 'its timer is a Buffs row');
    assert.truthy(ChestThemes.groups.combatMagic.ids.includes('moonbeam_scroll'), 'a combat-magic chest can hold it');
  });

  test('moonbeam: the beam pierces — every unit near the segment, none past its end or beside it', () => {
    const units = [{ id: 'a', x: 2, y: 0 }, { id: 'b', x: 9, y: 0.4 }, { id: 'c', x: 5, y: 3 }, { id: 'd', x: 12, y: 0 }, { id: 'e', x: -1, y: 0 }];
    assert.eq(Combat.beamHits(0, 0, 10, 0, 0.5, units).map(u => u.id).join(','), 'a,b');
  });

  test('moonbeam: each frame burns dps × dt into every foe in line, armour or no, while its row runs', () => {
    const spec = CONSUMABLE_SPEC.moonbeam_scroll;
    const foes = [{ id: 'near', x: 8, y: 0 }, { id: 'far', x: 40, y: 0 }, { id: 'off', x: 8, y: 20 }, { id: 'past', x: 80, y: 0 }];
    const hits = [];
    const nowWall = Date.now();
    const s = {
      cellM: 8, save: { energy: 50 }, facing: { x: 1, y: 0 },
      _moonbeamUntil: nowWall + spec.durationMs, _moonbeamLastT: performance.now() - 100,
      startWorldM: { x: 0, y: 0 }, playerM: { x: 0, y: 0 },
      isShadowActive: () => false,
      _enemiesWhere(where) { return foes.filter(where); },
      _damageEnemy(c, amount, source, opts) { hits.push({ id: c.id, amount, source, opts }); return false; },
      _moonbeamSegment: method('_moonbeamSegment'),
    };
    method('_tickMoonbeam').call(s);
    assert.eq(hits.map(h => h.id).sort().join(','), 'far,near', 'the line holds both; nothing beside it or past its range');
    for (const h of hits) {
      assert.inRange(h.amount, spec.dps * 0.09, spec.dps * 0.25, 'dps over the frame');
      assert.eq(h.source, 'player');
      assert.truthy(h.opts.bypassArmor, 'armour does not turn moonlight');
    }
    hits.length = 0;
    s._moonbeamUntil = nowWall - 1;
    s._moonbeamLastT = performance.now() - 100;
    method('_tickMoonbeam').call(s);
    assert.eq(hits.length, 0, 'over when its row runs out');
  });

  test('undead: the bones, the risen and the spirits — variants inherit it', () => {
    for (const kind of ['zombie', 'skeleton', 'lich', 'ghost', 'pink_ghost', 'giant_skeleton', 'ash_zombie', 'giant_lich'])
      assert.truthy(Combat.isUndead(kind), kind + ' is undead');
    for (const kind of ['slime', 'bat', 'vampire_bat', 'goblin', 'necromancer']) assert.falsy(Combat.isUndead(kind), kind + ' lives');
    assert.truthy(Combat.isUndead({ kind: 'skeleton' }), 'asks a unit too');
  });

  test('lifesteal: a bat feeds past its max; nothing is drawn from the undead', () => {
    assert.gt(EnemyRoster.get('bat').lifesteal, 0);
    assert.gt(EnemyRoster.get('vampire_bat').lifesteal, 0);
    const bat = { kind: 'vampire_bat', id: 'b1' };
    const max = Combat.maxHp(bat);
    Combat.feed(bat, Combat.lifestealHeal(EnemyRoster.get('vampire_bat').lifesteal, 10, null));
    assert.eq(Combat.hp(bat), max + 10 * EnemyRoster.get('vampire_bat').lifesteal, 'over its max');
    assert.eq(Combat.lifestealHeal(0.5, 10, { kind: 'zombie' }), 0, 'the dead give nothing');
    assert.eq(Combat.lifestealHeal(0, 10, null), 0);
    // A blow that lands on the player feeds the attacker (foeBlowLands).
    const swoop = { kind: 'bat', id: 'b2' };
    const scene = { save: { energy: 100, armor: {} }, _losePlayerEnergy: (d) => d };
    const lost = foeBlowLands(scene, swoop, 10, { mitigated: true });
    assert.eq(Combat.hp(swoop), Combat.maxHp(swoop) + lost * EnemyRoster.get('bat').lifesteal, 'the bat drank the blow');
  });

  test('vampire ring: a carried unique ring — 20% of a melee blow back, never from the undead', () => {
    const it = ITEM_BY_ID.vampire_ring;
    assert.truthy(it && it.kind === 'unique_relic' && it.uniqueJewelry, 'unique jewelry');
    assert.gt(BASE_TIER.vampire_ring, 0);
    assert.truthy(ITEM_EFFECTS.vampire_ring);
    assert.eq(MINERAL_ICON_SHEET.vampire_ring.sheet, 'icon_rings');
    assert.eq(jewelryMeleeLifesteal({}), 0);
    assert.eq(jewelryMeleeLifesteal({ inv: [{ id: 'vampire_ring', count: 1 }] }), 0.2);
    assert.truthy(/jewelryMeleeLifesteal\(this\.save\)/.test(SCENE_SRC), 'the melee strike asks it');
    assert.truthy(EnemyRoster.get('vampire_bat').eliteDrops.some(d => d.id === 'vampire_ring'), 'an elite vampire bat may drop it');
  });

  test('blinded: a ghost touch halves light and reach for 15 s; the cure clears it', () => {
    const def = Conditions.DEFINITIONS.blinded;
    assert.eq(def.durationMs, 15000);
    assert.eq(def.lightMul, 0.5);
    for (const kind of ['ghost', 'pink_ghost']) assert.eq(EnemyRoster.get(kind).condition, 'blinded', kind + ' blinds');
    const save = { energy: 100, reachUpgrades: 6 };
    const scene = { save, depth: 0, cellM: 8 };
    const whole = reachRadiusM(scene);
    assert.eq(Conditions.lightMul(save), 1);
    Conditions.apply(save, 'blinded');
    assert.eq(Conditions.lightMul(save), 0.5);
    assert.lt(reachRadiusM(scene), whole, 'blindness shrinks the base before upgrade steps');
    assert.eq(Lighting.playerLightMul(scene), 0.5, 'half the light');
    const deep = { save, depth: 9, cellM: 8 };
    assert.gt(reachRadiusM(deep), 8 + 1, 'upgrades still expand the minimum blinded base');
    Conditions.tick(save, 15000);
    assert.falsy(Conditions.active(save, 'blinded'), 'fifteen seconds');
    Conditions.apply(save, 'blinded');
    assert.truthy(Conditions.useAntidote(save) && Conditions.lightMul(save) === 1, 'an antidote clears it');
  });
})();
