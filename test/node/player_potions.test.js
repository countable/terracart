// Real scene entry points with only rendering/UI stubbed.
(function () {
  const T0 = 1_700_000_000_000;
  function method(name) {
    const start = SCENE_SRC.indexOf('\n  ' + name + '(');
    const end = SCENE_SRC.indexOf('\n  }\n', start);
    assert.truthy(start >= 0 && end > start, `found ${name}`);
    const constants = ['SHIELD_POTION_MS', 'SPEED_POTION_MS', 'BLIGHT_MS', 'TOME_EFFECT_MUL', 'REACH_POTION_MS']
      .map(name => SCENE_SRC.match(new RegExp('^const ' + name + ' = .*;$', 'm'))[0]).join('\n');
    return new Function(constants + '\nreturn ({'
      + SCENE_SRC.slice(start, end + 4) + '})[' + JSON.stringify(name) + ']')();
  }
  function clock(fn) {
    const old = Date.now;
    let now = T0;
    Date.now = () => now;
    try { fn(t => { now = t; }); } finally { Date.now = old; }
  }
  function scene(id, count = 2) {
    return {
      save: { energy: 100, inv: [{ id, count }], selSlot: 0 },
      _finishConsumable: method('_finishConsumable'),
      _losePlayerEnergy: method('_losePlayerEnergy'),
      buildInventoryDOM() {}, updateEnergyDOM() {}, _syncPlayerSkin() {},
      showMessageModal() {}, _flashPlayerHit() {}, _closeShopOnHit() {},
      _warnIfTiring() {}, _popEnergy() {}, flash() {},
    };
  }

  test('player potions: revised tiers, prices and explicit potion membership', () => {
    for (const [id, tier, price] of [['protection_potion', 2, 40], ['shield_potion', 5, 250],
      ['time_potion', 7, 800], ['immortal_potion', 7, 800]]) {
      assert.eq(BASE_TIER[id], tier, id);
      assert.eq(PRICES[id], price, id);
      assert.truthy(isPotion(id), id);
    }
    assert.eq(BASE_TIER.fire_resistance_potion, 4);
    for (const id of ['honey', 'antidote', 'elixir', 'reach_potion', 'vigor_potion', 'speed_potion',
      'blight_potion', 'revive_potion', 'resurrection_potion', 'giant_potion', 'shrinking_potion']) {
      assert.truthy(isPotion(id), `${id} can be thrown as a potion`);
    }
    assert.eq(ITEM_BY_ID.honey.name, 'Potion of Taming');
    for (const id of ['thunder_scroll', 'raven_scroll']) {
      assert.falsy(isPotion(id), `${id}: is a scroll`);
      assert.truthy(ITEM_BY_ID[id].name.includes('Scroll'));
      assert.falsy(CONSUMABLE_SPEC[id].channel, 'scrolls cannot be channeled as potions');
    }
  });

  test('player potions: protection and shielding use the strongest reduction, with exact expiry', () => {
    const save = { energy: 100, mode: 'normal', protectionPotionUntil: T0 + 60_000 };
    assert.eq(Combat.incomingDamage(save, 40, 1, T0), 30);
    save.shieldPotionUntil = T0 + 30_000;
    assert.eq(Combat.incomingDamage(save, 40, 1, T0), 20, 'strongest only');
    assert.eq(Combat.incomingDamage(save, 40, 1, T0 + 30_000), 30);
    assert.eq(Combat.incomingDamage(save, 40, 1, T0 + 60_000), 40);
  });

  test('player potions: drinks consume once, refresh duration and do not stack', () => clock(setNow => {
    for (const [id, key, duration] of [
      ['protection_potion', 'protectionPotionUntil', 60_000],
      ['shield_potion', 'shieldPotionUntil', 60_000],
      ['speed_potion', 'speedPotionUntil', CONSUMABLE_SPEC.speed_potion.durationMs],
      ['blight_potion', 'blightPotionUntil', CONSUMABLE_SPEC.blight_potion.durationMs],
      ['immortal_potion', 'immortalPotionUntil', 60_000],
      ['fire_resistance_potion', 'fireResistancePotionUntil', 180_000],
    ]) {
      setNow(T0);
      const s = scene(id);
      const drink = method(CONSUMABLE_SPEC[id].method);
      assert.eq(drink.call(s), true, id);
      assert.eq(Inventory.count(s.save, id), 1);
      assert.eq(s.save[key], T0 + duration);
      setNow(T0 + 10_000);
      assert.eq(drink.call(s), true);
      assert.eq(s.save[key], T0 + 10_000 + duration);
      assert.eq(Inventory.count(s.save, id), 0);
      assert.eq(drink.call(s), false, 'empty selection cannot refresh');
    }
  }));

  test('player potions: immortal blocks blows, direct damage, explosions and poison but permits stamina spending', () => clock(setNow => {
    const s = scene('immortal_potion');
    method('drinkImmortalPotion').call(s);
    Conditions.apply(s.save, 'poison', T0);
    assert.truthy(Conditions.damageImmune(s.save, T0 + 59_999));
    assert.eq(Combat.incomingDamage(s.save, 10000, 1, T0), 0);
    assert.eq(s._losePlayerEnergy(10000), 0);
    assert.eq(method('_potionBlast').call(s, 10000), 0);
    assert.eq(Conditions.fireDamage(s.save, 10000, T0), 0);
    Conditions.tick(s.save, 2000, { now: T0 + 2000 });
    assert.eq(s.save.energy, 100);
    assert.eq(Energy.spend(s.save, 7).spent, 7, 'immunity does not make actions free');
    setNow(T0 + 60_000);
    assert.falsy(Conditions.damageImmune(s.save));
    assert.eq(s._losePlayerEnergy(5), 5, 'damage resumes at expiry');
    assert.eq(s.save.energy, 88);
  }));

  test('player potions: immortal prevents both a trap bite and sustained trap bleed', () => clock(() => {
    const s = Object.assign(scene('immortal_potion'), {
      startWorldM: { x: 0, y: 0 }, originPx: { x: 0, y: 0 }, cellsPerTile: 16,
      _trapCellKey: '0_0_3_4', _trapHere: { id: 'potion_test_trap', x: 15, y: 20 },
      playerToWorldCell: () => ({ tx: 0, ty: 0, cx: 3, cy: 4 }),
      playerScreen: () => null, _painFlash() {}, _storySplashOnce() {},
    });
    method('drinkImmortalPotion').call(s);
    const tick = method('_tickTraps');
    tick.call(s, 0.1);
    tick.call(s, 2);
    assert.eq(s.save.energy, 100);
  }));

  test('player potions: Time clears buffs, debuffs and item cooldowns while preserving progression and world clocks', () => clock(() => {
    const s = scene('time_potion');
    Object.assign(s.save, { giantPotionUntil: T0 + 180_000, immortalPotionUntil: T0 + 60_000,
      protectionPotionUntil: T0 + 60_000, fireResistancePotionUntil: T0 + 180_000,
      eatReadyAt: T0 + 10_000, tomeDays: { tome_sight: '2023-11-14' },
      tomeReadyAt: T0 + 3600_000, tomeMagicCd: { tome_sight: T0 + 3600_000 },
      training: { melee: 3 }, tipsRead: 12, coinBurstClaimed: { 'inn:test': T0 } });
    Object.assign(s, { _throwReadyAt: T0 + 1000, _nextBlowT: T0 + 1000,
      _nextShotT: { bow: T0 + 1000 }, _staffCharge: {} });
    Conditions.apply(s.save, 'pinned', T0);
    Conditions.apply(s.save, 'poison', T0);
    assert.eq(method('drinkTimePotion').call(s), true);
    assert.eq(Inventory.count(s.save, 'time_potion'), 1);
    for (const key of ['giantPotionUntil', 'immortalPotionUntil', 'protectionPotionUntil',
      'fireResistancePotionUntil', 'eatReadyAt', 'tomeDays', 'tomeReadyAt', 'tomeMagicCd']) assert.falsy(s.save[key], key);
    assert.falsy(Conditions.hasDebuffs(s.save, s));
    assert.eq(s._throwReadyAt, 0);
    assert.eq(s._nextBlowT, 0);
    assert.eq(Object.keys(s._nextShotT).length, 0);
    assert.eq(s._staffCharge, null);
    assert.falsy(Conditions.active(s.save, 'pinned'));
    assert.eq(s.save.training.melee, 3);
    assert.eq(s.save.tipsRead, 12);
    assert.eq(s.save.coinBurstClaimed['inn:test'], T0, 'world reward ledger is preserved');
  }));

  test('player potions: throwing launches an effect flask, spends on a miss and respects the shared cooldown', () => clock(() => {
    const s = Object.assign(scene('protection_potion'), {
      startWorldM: { x: 0, y: 0 }, playerM: { x: 0, y: 0 }, facing: { x: 1, y: 0 },
      cellM: 10, _shots: [], isShadowActive: () => false,
      throwCooldownLeft: method('throwCooldownLeft'), canThrowItem: method('canThrowItem'),
    });
    const launch = method('_throwItem');
    assert.eq(launch.call(s, 'protection_potion'), true);
    assert.eq(s._shots.length, 1);
    assert.eq(s._shots[0].potionId, 'protection_potion');
    assert.eq(s._shots[0].damage, 0);
    assert.eq(Inventory.count(s.save, 'protection_potion'), 1, 'spent without requiring a target');
    assert.truthy(s.throwCooldownLeft() > 0);
    assert.eq(launch.call(s, 'protection_potion'), false);
    assert.eq(Inventory.count(s.save, 'protection_potion'), 1);
  }));

  test('player potions: HUD offers Throw beside Drink, updates cooldown and removes Throw for a scroll', () => clock(() => {
    const original = { getElementById: document.getElementById, createElement: document.createElement, body: document.body };
    const buttons = new Map();
    document.getElementById = id => buttons.get(id);
    document.createElement = () => ({ style: {}, dataset: {}, handlers: {},
      addEventListener(name, fn) { this.handlers[name] = fn; },
      remove() { buttons.delete(this.id); } });
    document.body = { appendChild(button) { buttons.set(button.id, button); } };
    try {
      const s = Object.assign(scene('protection_potion'), {
        iconSpanHTML: () => '', throwActionLabel: method('throwActionLabel'),
        throwCooldownLeft: method('throwCooldownLeft'), canThrowItem: method('canThrowItem'),
        syncConsumableButton: method('syncConsumableButton'), isShadowActive: () => false,
        _throwItem(id) { this.thrown = id; this._throwReadyAt = Date.now() + 1000; },
      });
      s.syncConsumableButton();
      assert.truthy(buttons.has('consumable-btn'), 'Drink remains available');
      const button = buttons.get('potion-throw-btn');
      assert.truthy(button);
      assert.eq(button.disabled, false);
      button.handlers.click({ stopPropagation() {} });
      assert.eq(s.thrown, 'protection_potion');
      assert.eq(button.disabled, true);
      s.save.inv[0] = { id: 'thunder_scroll', count: 1 };
      s.syncConsumableButton();
      assert.falsy(buttons.has('potion-throw-btn'), 'Thunder scroll cannot be thrown as a potion');
    } finally { Object.assign(document, original); }
  }));

  // Every drink method must actually run (the Potion of Reach once threw a
  // ReferenceError on every sip because no test called it).
  test('player potions: the Potion of Reach is drinkable — the timer is set and one flask spent', () => {
    clock(set => {
      set(T0);
      const s = scene('reach_potion');
      const drink = method('drinkReachPotion');
      assert.truthy(drink.call(s), 'drunk');
      assert.eq(s.save.reachPotionUntil, T0 + CONSUMABLE_SPEC.reach_potion.durationMs, 'the reach timer is set from the one constant');
      assert.eq(s.save.inv[0].count, 1, 'one flask spent');
    });
  });
})();
