// Drive the shipping food action as well as the wall-clock regeneration core.
(function () {
  const T0 = 1_700_000_000_000;
  function lift(name) {
    const start = SCENE_SRC.indexOf(`\n  ${name}(`);
    const end = SCENE_SRC.indexOf('\n  }\n', start);
    return new Function('return ({' + SCENE_SRC.slice(start, end + 4) + '})')()[name];
  }
  const eat = lift('eatSelected'), effects = lift('_consumeFoodEffects');
  function scene(id) {
    return {
      save: { inv: [{ id, count: 1 }], selSlot: 0, energy: 10, vigourUpgrades: 100 },
      _zeroEnergyLocked: () => false, _consumeFoodEffects: effects,
      getMaxEnergy() { return Energy.maxEnergy(this.save); },
      buildInventoryDOM() {}, updateEnergyDOM() {}, flashLoot(text) { this.lastFlash = text; },
    };
  }
  const totals = { minnow: 7, bass: 20, trout: 60, salmon: 100, goldenfish: 180,
    grilled_minnow: 11, grilled_bass: 30, grilled_trout: 90, grilled_salmon: 150, grilled_goldenfish: 270 };

  test('fish: every raw and grilled meal starts three-minute regeneration with no instant healing', () => {
    assert.eq(Energy.FISH_REGEN_MS, 180000);
    for (const [id, total] of Object.entries(totals)) {
      const s = scene(id);
      assert.eq(Energy.fishRegenTotal(id), total, id);
      assert.eq(FOOD_ENERGY[id], total, 'the food table owns the total');
      assert.truthy(eat.call(s));
      assert.eq(s.save.energy, 10, `${id}: no instant heal, even on first taste`);
      assert.eq(s.save.fishRegen.total, total);
      assert.eq(s.save.fishRegen.until - s.save.fishRegen.startedAt, 180000);
      assert.eq(Inventory.count(s.save, id), 0);
      assert.includes(s.save.eaten, id);
      assert.includes(s.lastFlash, `Regen: ${total}⚡ over 3m`);
      for (const line of s.lastFlash.split('\n')) assert.lte([...line].length, MAP_MSG_MAX, line);
      assert.falsy(s.lastFlash.startsWith('+'), 'feedback never promises instant healing');
      assert.truthy(Energy.eatCooldownLeft(s.save) > 0);
    }
    assert.eq(Energy.fishRegenTotal('grilled_meat'), 0);
    assert.eq(Energy.fishRegenTotal('roast_onion'), 0);
  });

  test('fish: frame fractions deliver exactly each total, including the frame beyond expiry', () => {
    for (const [id, total] of Object.entries(totals)) {
      const save = { energy: 10, vigourUpgrades: 100 };
      Energy.startFishRegen(save, id, T0);
      assert.eq(Energy.tickFishRegen(save, T0), 0);
      for (let ms = 17; ms < Energy.FISH_REGEN_MS; ms += 17) {
        Energy.tickFishRegen(save, T0 + ms);
        assert.eq(save.energy, Math.floor(save.energy));
        assert.lte(save.energy, 10 + total);
      }
      Energy.tickFishRegen(save, T0 + Energy.FISH_REGEN_MS + 100);
      assert.eq(save.energy, 10 + total, id);
      assert.falsy(save.fishRegen, 'expired dose removed only after final payout');
      assert.eq(Energy.tickFishRegen(save, T0 + Energy.FISH_REGEN_MS + 10000), 0);
    }
  });

  test('fish: save reload retains fractional progress and pays only the remaining elapsed dose', () => {
    let save = { energy: 0, vigourUpgrades: 100 };
    Energy.startFishRegen(save, 'minnow', T0);
    Energy.tickFishRegen(save, T0 + 10000); // less than one pip
    assert.eq(save.energy, 0);
    save = JSON.parse(JSON.stringify(save));
    Energy.tickFishRegen(save, T0 + 60000);
    assert.eq(save.energy, 2);
    save = JSON.parse(JSON.stringify(save));
    Energy.tickFishRegen(save, T0 + 300000); // backgrounded beyond expiry
    assert.eq(save.energy, 7);
    assert.eq(Energy.tickFishRegen(save, T0 + 300000), 0);
  });

  test('fish: equal and stronger doses replace; weaker fish cannot refresh stronger regeneration', () => {
    const save = { energy: 0, vigourUpgrades: 100 };
    Energy.startFishRegen(save, 'salmon', T0);
    Energy.tickFishRegen(save, T0 + 90000);
    assert.eq(save.energy, 50);
    const original = JSON.stringify(save.fishRegen);
    assert.eq(Energy.fishRegenWait(save, 'minnow', T0 + 90000), 90000);
    assert.falsy(Energy.startFishRegen(save, 'minnow', T0 + 90000));
    assert.eq(JSON.stringify(save.fishRegen), original);
    assert.truthy(Energy.startFishRegen(save, 'salmon', T0 + 90000));
    assert.eq(save.energy, 50, 'refresh itself heals nothing');
    assert.eq(save.fishRegen.paid, 0);
    Energy.tickFishRegen(save, T0 + 270000);
    assert.eq(save.energy, 150, 'replacement pays only its own new dose');
    assert.truthy(Energy.startFishRegen(save, 'minnow', T0 + 270000));
    assert.truthy(Energy.startFishRegen(save, 'goldenfish', T0 + 280000));
    assert.eq(save.fishRegen.total, 180);
    assert.eq(save.fishRegen.until, T0 + 460000);
  });

  test('fish: refused weak meals do not consume food, grant first taste or arm cooldown', () => {
    const s = scene('minnow');
    Energy.startFishRegen(s.save, 'goldenfish');
    const before = JSON.stringify(s.save);
    assert.falsy(eat.call(s));
    assert.eq(JSON.stringify(s.save), before);
  });

  test('fish: a full bar discards elapsed healing, and clock rollback never repays it', () => {
    const save = { energy: 100 };
    Energy.startFishRegen(save, 'trout', T0);
    assert.eq(Energy.tickFishRegen(save, T0 + 90000), 0);
    Energy.set(save, 10);
    assert.eq(Energy.tickFishRegen(save, T0 + 60000), 0);
    assert.eq(Energy.tickFishRegen(save, T0 + 90000), 0);
    Energy.tickFishRegen(save, T0 + 180000);
    assert.eq(save.energy, 40, 'only the final half remains');
  });

  test('fish: one status countdown and runtime tick independent of resting or combat', () => {
    const save = {};
    Energy.startFishRegen(save, 'bass', T0);
    const row = Buffs.active(save, {}, T0 + 1000).find(b => b.id === 'fish');
    assert.truthy(row); assert.eq(row.remainingMs, 179000);
    assert.eq(Buffs.active(save, {}, T0 + 180000).some(b => b.id === 'fish'), false);
    assert.includes(SCENE_SRC, 'this._tickShrineRegen(dt);\n    this._tickFishRegen();');
    const s = scene('bass');
    Energy.startFishRegen(s.save, 'bass', T0);
    s._workProgress = {}; s.playerMoving = true;
    lift('_tickFishRegen').call(s, T0 + 180000);
    assert.eq(s.save.energy, 30);
    assert.includes(SCENE_SRC, 'Energy.fishRegenWait(this.save, sel?.id)');
    assert.includes(SCENE_SRC, '`${eatVerb} ${restore}⚡/${shortDuration(Energy.FISH_REGEN_MS)}`');
  });

  test('peach: restores ordinary food energy and clears all debuffs, preserving positive buffs', () => {
    const s = scene('worldpeach');
    for (const id of Object.keys(Conditions.DEFINITIONS)) Conditions.apply(s.save, id);
    s.save.coffeeUntil = Date.now() + 60000;
    Energy.startFishRegen(s.save, 'bass');
    const fish = JSON.stringify(s.save.fishRegen), coffee = s.save.coffeeUntil;
    assert.truthy(eat.call(s));
    assert.eq(s.save.energy, 10 + FOOD_ENERGY.worldpeach);
    assert.falsy(Conditions.hasDebuffs(s.save, s));
    assert.falsy(Conditions.active(s.save, 'pinned'), 'the trap pin too');
    assert.eq(JSON.stringify(s.save.fishRegen), fish);
    assert.eq(s.save.coffeeUntil, coffee);
    assert.eq(Inventory.count(s.save, 'worldpeach'), 0);
    assert.includes(s.save.eaten, 'worldpeach');
    assert.truthy(Energy.eatCooldownLeft(s.save) > 0);
  });

  test('peach: refused eating never cleanses', () => {
    for (const refusal of ['cooldown', 'locked', 'empty']) {
      const s = scene('worldpeach');
      Conditions.apply(s.save, 'poison');
      if (refusal === 'cooldown') Energy.startEatCooldown(s.save);
      if (refusal === 'locked') s._zeroEnergyLocked = () => true;
      if (refusal === 'empty') s.save.inv[0].count = 0;
      const before = JSON.stringify(s.save);
      assert.falsy(eat.call(s));
      assert.eq(JSON.stringify(s.save), before);
    }
  });
})();
