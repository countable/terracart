// Exercise the shipping food action: reusable healing still shares the bite gate.
const foodActionStart = APP_JS_SRC.indexOf('\n  eatSelected() {');
const foodActionEnd = APP_JS_SRC.indexOf('\n  }\n', foodActionStart);
const reusableEat = new Function('return ({' + APP_JS_SRC.slice(foodActionStart, foodActionEnd + 4) + '}).eatSelected')();
const effectStart = APP_JS_SRC.indexOf('\n  _consumeFoodEffects(id,');
const effectEnd = APP_JS_SRC.indexOf('\n  }\n', effectStart);
const reusableFoodEffects = new Function('return ({' + APP_JS_SRC.slice(effectStart, effectEnd + 4) + '})._consumeFoodEffects')();
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
