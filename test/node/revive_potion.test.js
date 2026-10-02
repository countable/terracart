// Revival potions: drunk while DOWN (zero energy, either mode) to get back up
// where you fell - the Potion of Revival (T3) at 30% of the bar, the
// Potion of Resurrection (T5) at 60%. (The Crow Feather is a flat 1 energy,
// FEATHER_REVIVE_ENERGY, and is EATEN, through the hard-mode lockout.) One table (items.js REVIVE_ITEM_FRAC)
// is read by the drink, the ✦ line and the Drink dialog.
//
// The drink is a Phaser scene method, so it is lifted and RUN on a stub scene
// the way trail.test.js runs the trail prize — what it actually does to the
// bar, not a transcription of it.

(function () {
const app = SCENE_SRC;

test('revive potions: T3 at 30%, T5 at 60%, both drunk not eaten', () => {
  assert.eq(REVIVE_ITEM_FRAC.revive_potion, CONSUMABLE_SPEC.revive_potion.energyFrac,
    'Revival runtime derives its 30% from the consumable owner');
  assert.eq(REVIVE_ITEM_FRAC.resurrection_potion, CONSUMABLE_SPEC.resurrection_potion.energyFrac,
    'Resurrection runtime derives its 60% from the consumable owner');
  assert.eq(CONSUMABLE_SPEC.revive_potion.energyFrac, 0.30);
  assert.eq(CONSUMABLE_SPEC.resurrection_potion.energyFrac, 0.60);
  assert.eq(FEATHER_REVIVE_ENERGY, 1, 'the Crow Feather with a flat 1 energy');
  assert.eq(BASE_TIER.revive_potion, 3, 'Revival is tier 3');
  assert.eq(BASE_TIER.resurrection_potion, 5, 'Resurrection is tier 5');
  for (const id of ['revive_potion', 'resurrection_potion']) {
    assert.eq(ITEM_BY_ID[id]?.kind, 'magic', `${id} is a consumable`);
    assert.eq(FOOD_ENERGY[id], undefined, `${id} never reaches the Eat button`);
    assert.gt(PRICES[id], 0, `${id} has a price`);
    assert.falsy(/\d|%/.test(ITEM_EFFECTS[id]), `${id}: the item hints at revival without exact effects`);
    assert.eq(CONSUMABLE_SPEC[id].method, 'drinkRevivePotion',
      `the Drink button offers ${id}`);
  }
  assert.truthy(Shops.themedStock('potion', 3).includes('revive_potion'), 'a T3 potion shop stocks Revival');
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
  assert.eq(r.save.energy, 36, '30% of a 120 bar');
  assert.eq(r.popped[0], 36, 'and the gain pops on the player');
  assert.eq(r.save.inv[0].count, 0, 'the flask is used up');
  assert.eq(drink('resurrection_potion', 0, 120).save.energy, 72, 'Resurrection: 60%');
  assert.eq(drink('revive_potion', 0, 89).save.energy, 27, 'rounded like every revive (26.7 → 27)');
  assert.eq(drink('crow_feather', 0, 120).out, false, 'the feather is eaten, never drunk');
});

test('revive potions: refused above zero, so they are never a top-up', () => {
  const r = drink('resurrection_potion', 5, 120);
  assert.eq(r.out, false, 'refused');
  assert.eq(r.save.energy, 5, 'bar untouched');
  assert.eq(r.save.inv[0].count, 1, 'flask kept');
  assert.falsy(CONSUMABLE_SPEC.resurrection_potion.usable({ save: { energy: 5 } }),
    'the Drink dialog greys its button on the same downed test');
  assert.truthy(/canAfford: typeof entry\.usable === 'function' \? entry\.usable\(this, entry\) : true,/.test(app),
    'and the dialog reads it');
});
})();
