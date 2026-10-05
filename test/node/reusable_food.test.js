// Exercise the shipping food action: reusable healing still shares the bite gate.
const foodActionStart = SCENE_SRC.indexOf('\n  eatSelected() {');
const foodActionEnd = SCENE_SRC.indexOf('\n  }\n', foodActionStart);
const reusableEat = new Function('return ({' + SCENE_SRC.slice(foodActionStart, foodActionEnd + 4) + '}).eatSelected')();
const effectStart = SCENE_SRC.indexOf('\n  _consumeFoodEffects(id,');
const effectEnd = SCENE_SRC.indexOf('\n  }\n', effectStart);
const reusableFoodEffects = new Function('return ({' + SCENE_SRC.slice(effectStart, effectEnd + 4) + '})._consumeFoodEffects')();
function gobletScene(id = 'goblet') {
  return {
    save: { inv: [{ id, count: 1 }], selSlot: 0, energy: 20, eaten: [id] },
    _zeroEnergyLocked: () => false,
    _consumeFoodEffects: reusableFoodEffects,
    getMaxEnergy() { return Energy.maxEnergy(this.save); },
    buildInventoryDOM() {}, updateEnergyDOM() {}, flashLoot() {},
  };
}
test('goblet heals five repeatedly, stays in inventory, and shares food cooldown', () => {
  const s = gobletScene();
  assert.eq(reusableEat.call(s), true);
  assert.eq(s.save.energy, 25);
  assert.eq(s.save.inv[0].count, 1);
  assert.eq(reusableEat.call(s), false);
  assert.eq(s.save.energy, 25);
  Energy.startEatCooldown(s.save, Date.now() - Energy.EAT_COOLDOWN_MS);
  assert.eq(reusableEat.call(s), true);
  assert.eq(s.save.energy, 30);
  assert.eq(s.save.inv[0].count, 1);
});
test('goblet respects maximum health and cannot be used from an empty stack', () => {
  const s = gobletScene();
  s.save.energy = s.getMaxEnergy() - 2;
  assert.eq(reusableEat.call(s), true);
  assert.eq(s.save.energy, s.getMaxEnergy());
  s.save.inv[0].count = 0;
  Energy.startEatCooldown(s.save, Date.now() - Energy.EAT_COOLDOWN_MS);
  assert.eq(reusableEat.call(s), false);
});
test('ordinary food is still consumed', () => {
  const s = gobletScene('potato');
  assert.eq(reusableEat.call(s), true);
  assert.eq(s.save.inv.filter(slot => slot.id === 'potato' && slot.count > 0).length, 0);
});
test('downed eating: grass and every ordinary food refuse in both modes without side effects', () => {
  const previous = Difficulty.mode();
  try {
    for (const mode of [Difficulty.EASY, Difficulty.HARD]) {
      Difficulty.setMode(mode);
      for (const id of Object.keys(FOOD_ENERGY)) {
        const s = gobletScene(id);
        Object.assign(s.save, { mode, energy: 0, eaten: [] });
        const before = JSON.stringify(s.save);
        assert.eq(reusableEat.call(s), false, mode + ': ' + id + ' cannot revive');
        assert.eq(JSON.stringify(s.save), before, 'no healing, item use, first taste, buff or cooldown');
      }
    }
  } finally { Difficulty.setMode(previous); }
});
test('downed eating: the feather revives in either mode and grass works only after revival', () => {
  const previous = Difficulty.mode();
  try {
    for (const mode of [Difficulty.EASY, Difficulty.HARD]) {
      Difficulty.setMode(mode);
      const s = gobletScene('crow_feather');
      Object.assign(s.save, { mode, energy: 0 });
      assert.truthy(reusableEat.call(s));
      assert.eq(s.save.energy, FEATHER_REVIVE_ENERGY);
      assert.eq(Inventory.count(s.save, 'crow_feather'), 0);
      s.save.inv = [{ id: 'longgrass', count: 1 }]; s.save.selSlot = 0;
      assert.falsy(reusableEat.call(s), 'revival still starts the shared bite cooldown');
      Energy.startEatCooldown(s.save, Date.now() - Energy.EAT_COOLDOWN_MS);
      assert.truthy(reusableEat.call(s));
      assert.eq(s.save.energy, FEATHER_REVIVE_ENERGY + FOOD_ENERGY.longgrass);
      assert.eq(Inventory.count(s.save, 'longgrass'), 0);
      s.save.inv = [{ id: 'crow_feather', count: 1 }]; s.save.selSlot = 0;
      Energy.startEatCooldown(s.save, Date.now() - Energy.EAT_COOLDOWN_MS);
      assert.falsy(reusableEat.call(s), 'a feather cannot heal a living player');
      assert.eq(Inventory.count(s.save, 'crow_feather'), 1);
    }
  } finally { Difficulty.setMode(previous); }
});
