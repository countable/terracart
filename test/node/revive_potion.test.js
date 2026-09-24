// Revival potions: drunk while DOWN (zero energy, either mode) to get back up
// where you fell — the Potion of Revival (T2) at a tenth of the bar, the
// Potion of Resurrection (T5) at half. One table (items.js REVIVE_POTION_FRAC)
// is read by the drink, the ✦ line and the Drink dialog.
//
// The drink is a Phaser scene method, so it is lifted and RUN on a stub scene
// the way trail.test.js runs the trail prize — what it actually does to the
// bar, not a transcription of it.

(function () {
const app = APP_JS_SRC;

test('revive potions: T2 at 10%, T5 at 50%, both drunk not eaten', () => {
  assert.eq(REVIVE_POTION_FRAC.revive_potion, 0.10, 'Revival stands you up with a tenth');
  assert.eq(REVIVE_POTION_FRAC.resurrection_potion, 0.50, 'Resurrection with half');
  assert.eq(BASE_TIER.revive_potion, 2, 'Revival is tier 2');
  assert.eq(BASE_TIER.resurrection_potion, 5, 'Resurrection is tier 5');
  for (const id of Object.keys(REVIVE_POTION_FRAC)) {
    assert.eq(ITEM_BY_ID[id]?.kind, 'consumable', `${id} is a consumable`);
    assert.eq(FOOD_ENERGY[id], undefined, `${id} never reaches the Eat button`);
    assert.gt(PRICES[id], 0, `${id} has a price`);
    assert.truthy(ITEM_EFFECTS[id].includes(`${revivePct(id)}%`), `${id}'s ✦ line prints its own number`);
    assert.truthy(new RegExp(`${id}: +\\{ verb: 'Drink', method: 'drinkRevivePotion'`).test(app),
      `the Drink button offers ${id}`);
  }
  assert.truthy(Shops.themedStock('potion', 2).includes('revive_potion'), 'a T2 potion shop stocks Revival');
  assert.truthy(Shops.themedStock('potion', 5).includes('resurrection_potion'), 'a T5 one stocks Resurrection');
});

const body = (() => {
  const a = app.indexOf('  drinkRevivePotion() {');
  const b = app.indexOf('\n  }\n', a);
  assert.truthy(a > 0 && b > a, 'found drinkRevivePotion');
  return app.slice(a + '  drinkRevivePotion() {'.length, b);
})();

const drink = (id, energy, max = 120) => {
  const popped = [];
  const save = { energy, inv: [{ id, count: 1 }], selSlot: 0 };
  const scene = {
    save,
    getMaxEnergy: () => max,
    _popEnergy: (d) => popped.push(d),
    updateEnergyDOM() {},
    _finishConsumable: (title, text) => { save.inv[0].count--; return { title, text }; },
  };
  const getSelectedSlot = (s) => s.inv[s.selSlot];
  const out = new Function('getSelectedSlot', body).call(scene, getSelectedSlot);
  return { out, save, popped };
};

test('revive potions: down → up at the potion\'s share of the bar', () => {
  const r = drink('revive_potion', 0, 120);
  assert.eq(r.save.energy, 12, 'a tenth of a 120 bar');
  assert.eq(r.popped[0], 12, 'and the gain pops on the player');
  assert.eq(r.save.inv[0].count, 0, 'the flask is used up');
  assert.eq(drink('resurrection_potion', 0, 120).save.energy, 60, 'Resurrection: half');
});

test('revive potions: refused above zero, so they are never a top-up', () => {
  const r = drink('resurrection_potion', 5, 120);
  assert.eq(r.out, false, 'refused');
  assert.eq(r.save.energy, 5, 'bar untouched');
  assert.eq(r.save.inv[0].count, 1, 'flask kept');
  assert.truthy(/usable: \(\) => Combat\.playerDowned\(this\.save\.energy\)/.test(app),
    'the Drink dialog greys its button on the same downed test');
  assert.truthy(/canAfford: typeof entry\.usable === 'function' \? entry\.usable\(\) : true,/.test(app),
    'and the dialog reads it');
});
})();
