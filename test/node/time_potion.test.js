(function () {
  function fixture() {
    const calls = [];
    const scene = {
      save: { energy: 40 }, calls,
      _applyDragonSkin(on) { calls.push(['dragon', on]); this._dragonActive = on; },
      _syncPlayerSkin() { calls.push(['skin']); },
      _tickSpiritRaven() { calls.push(['raven', this.save.spiritRavenUntil]); },
      _updatePlayerAura() { calls.push(['aura']); },
      updateEnergyDOM() {}, _syncStatusRow() {}, syncEatButton() {}, syncConsumableButton() {},
    };
    return scene;
  }

  test('time potion: T7 drink resets the player and consumes exactly its own flask', () => {
    assert.eq(BASE_TIER.time_potion, 7);
    assert.eq(PRICES.time_potion, 800);
    assert.eq(CONSUMABLE_SPEC.time_potion.method, 'drinkTimePotion');
    const lift = name => {
      const start = SCENE_SRC.indexOf('\n  ' + name + '(');
      assert.truthy(start >= 0, name);
      const end = SCENE_SRC.indexOf('\n  }\n', start);
      return new Function('return ({' + SCENE_SRC.slice(start, end + 4) + '})[' + JSON.stringify(name) + ']')();
    };
    const scene = fixture();
    scene.save.inv = [{ id: 'time_potion', count: 2 }];
    scene.save.selSlot = 0;
    scene.save.eatReadyAt = Date.now() + 10000;
    scene._finishConsumable = lift('_finishConsumable');
    scene._consumeSelected = lift('_consumeSelected');
    scene._selectedConsumable = lift('_selectedConsumable');
    scene._finishInventoryChange = lift('_finishInventoryChange');
    scene.buildInventoryDOM = () => {};
    scene.showMessageModal = () => {};
    const drink = lift('drinkTimePotion');
    assert.eq(drink.call(scene), true);
    assert.eq(Inventory.count(scene.save, 'time_potion'), 1);
    assert.eq(Energy.canEat(scene.save), true);
    assert.eq(drink.call(scene), true, 'no new cooldown is imposed');
    assert.eq(Inventory.count(scene.save, 'time_potion'), 0);
    assert.eq(drink.call(scene), false, 'an empty selection cannot reset again');
  });

  test('time potion: clears player effects, debuffs, portable book and combat cooldowns', () => {
    const scene = fixture(), save = scene.save, until = Date.now() + 600_000;
    for (const row of Object.values(Buffs.KINDS)) {
      if (row.save) save[row.save] = until;
      if (row.scene) scene[row.scene] = until;
    }
    Object.assign(save, {
      boonUntil: { regen: until, melee: until }, trainingDrills: { melee: until, energy: until },
      fishRegen: { total: 50, paid: 10, startedAt: Date.now(), until },
      treasureCompass: { targetId: 'treasure', until },
      tomeReadyAt: until, tomeMagicCd: { tome_sight: until, tome_storm: until },
      eatReadyAt: until, tomeDays: { tome_sight: utcDayKey(new Date()), tome_storm: utcDayKey(new Date()) },
      fireDamageRemainder: 0.75,
      conditions: { poison: { remainingMs: 60_000, nextTickMs: 2000 }, burning: { remainingMs: 5000, nextTickMs: 1000 }, pinned: { remainingMs: 3000 } },
    });
    Object.assign(scene, { pairyCompass: { targetId: 'chest', until },
      _throwReadyAt: until, _nextBlowT: until, _nextShotT: { bow: until, staff: until },
      _staffCharge: 0.4, _igniteNextT: until, _dragonActive: true, _dragonBuffActive: true });
    assert.eq(PlayerTime.reset(scene), true);
    for (const row of Object.values(Buffs.KINDS)) {
      if (row.save) assert.eq(save[row.save], undefined, row.save);
      if (row.scene) assert.eq(scene[row.scene], 0, row.scene);
    }
    for (const key of ['boonUntil', 'trainingDrills', 'fishRegen', 'treasureCompass', 'eatReadyAt', 'tomeDays', 'tomeReadyAt', 'tomeMagicCd']) {
      assert.eq(save[key], undefined, key);
    }
    assert.eq(Object.keys(save.conditions).length, 0);
    assert.eq(save.fireDamageRemainder, 0);
    assert.eq(scene.pairyCompass, null);
    assert.eq(scene._throwReadyAt, 0);
    assert.eq(scene._nextBlowT, 0);
    assert.eq(Object.keys(scene._nextShotT).length, 0);
    assert.eq(scene._staffCharge, null);
    assert.eq(scene._igniteNextT, 0);
    assert.eq(scene._dragonBuffActive, false);
    assert.truthy(scene.calls.some(([kind, on]) => kind === 'dragon' && on === false));
    assert.truthy(scene.calls.some(([kind, timer]) => kind === 'raven' && timer === undefined));
    assert.truthy(scene.calls.some(([kind]) => kind === 'aura'));
    assert.eq(save.energy, 40, 'reset never heals');
  });

  test('time potion: permanent progression and world clocks survive while temporary max HP is removed', () => {
    const scene = fixture(), until = Date.now() + 600_000;
    const permanent = {
      training: { melee: 3, energy: 2 }, vigourUpgrades: 4, eaten: ['potato'], tipsRead: 12,
      playerClass: 'enchanter', money: 987, inv: [{ id: 'time_potion', count: 1 }],
      opened: ['chest1'], caught: ['deer1'], lastProduce: { cow1: until },
      coinBurstClaimed: { shrine120261002: 1 }, shopState: { trader1: { bucket: 12, deals: 1, dealAt: until } },
      sapphireReturn: { fromDepth: 0, depth: 1, until }, mercenaryUntil: until,
      companionState: { mercenary: { hp: 20, restUntil: until } },
    };
    Object.assign(scene.save, permanent);
    const expected = JSON.stringify(permanent), ordinaryMax = Energy.maxEnergy(scene.save);
    Object.assign(scene.save, { giantPotionUntil: until, trainingDrills: { energy: until }, energy: ordinaryMax + 150 });
    PlayerTime.reset(scene);
    assert.eq(scene.save.energy, ordinaryMax, 'removing Giant and Stamina clamps HP');
    const after = Object.fromEntries(Object.keys(permanent).map(key => [key, scene.save[key]]));
    assert.eq(JSON.stringify(after), expected, 'world and permanent records are unchanged');
    PlayerTime.reset(scene);
    assert.eq(scene.save.energy, ordinaryMax, 'repeat reset is harmless');
  });

  test('time potion: an active spirit raven retires through the ordinary companion lifecycle', () => {
    const scene = fixture();
    const raven = { id: 'time-test-raven', kind: 'spirit_raven', x: 0, y: 0 };
    Object.assign(scene, { _spiritRaven: raven, startWorldM: { x: 0, y: 0 }, playerM: { x: 0, y: 0 },
      cellM: 5, playerToWorldCell: () => ({ tx: 0, ty: 0 }), flashAtWorld() {},
      _tickSpiritRaven() { Companions.tick(this, 'spirit_raven'); } });
    scene.save.spiritRavenUntil = Date.now() + 600_000;
    const oldForEach = WorldGen.forEachItemNear;
    WorldGen.forEachItemNear = (kind, tx, ty, visit) => visit(raven);
    try {
      PlayerTime.reset(scene);
      assert.eq(scene._spiritRaven, null);
      assert.truthy(scene.save.caught.includes(raven.id), 'retired summon is hidden by the normal caught set');
    } finally { WorldGen.forEachItemNear = oldForEach; }
  });
})();
