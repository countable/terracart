// Headless tests for the gear core (src/gear.js) — equip rules, the relic/armor
// offer roll, and the forge/smelt recipes extracted from app.js.

// Deterministic PRNG for the offer roll.
function seeded(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('equip: a relic just sets its slot to the tier', () => {
  const save = { relics: {}, armor: {}, energy: 50, maxEnergy: 100 };
  Gear.equip(save, 'relic', 'pick', 3);
  assert.eq(save.relics.pick.tier, 3);
  assert.eq(save.energy, 50, 'relics don’t touch energy');
});

test('equip: armor raises maxEnergy and grants the headroom delta', () => {
  const save = { relics: {}, armor: {}, energy: 100, maxEnergy: 100 };
  Gear.equip(save, 'armor', 'helmet', 3);
  assert.gt(save.maxEnergy, 100, 'helmet raised the cap');
  assert.eq(save.energy, save.maxEnergy, 'current energy bumped by the same delta');
});

test('equip: a SECOND armor piece bumps by its own delta, not the whole max', () => {
  const save = { relics: {}, armor: {}, energy: 100, maxEnergy: 100 };
  Gear.equip(save, 'armor', 'helmet', 3);
  const afterHelmet = save.maxEnergy;
  // Spend some energy, then equip boots — only the boots' delta is granted.
  save.energy = 5;
  Gear.equip(save, 'armor', 'boots', 2);
  const delta = save.maxEnergy - afterHelmet;
  assert.gt(delta, 0, 'boots raised the cap further');
  assert.eq(save.energy, 5 + delta, 'energy bumped by the boots delta only');
});

test('equip: a weapon relic (sword/bow/staff) becomes the active weapon', () => {
  // Only one weapon fights at a time (combat.js) — the newest one obtained or
  // upgraded wins by default (app.js WEAPON_SLOTS / Gear.WEAPON_SLOTS).
  const save = { relics: {}, armor: {} };
  Gear.equip(save, 'relic', 'sword', 1);
  assert.eq(save.activeWeapon, 'sword', 'first weapon obtained becomes active');
  Gear.equip(save, 'relic', 'bow', 1);
  assert.eq(save.activeWeapon, 'bow', 'a later weapon obtained switches to it');
  Gear.equip(save, 'relic', 'sword', 4);
  assert.eq(save.activeWeapon, 'sword', 'upgrading an owned weapon re-activates it');
});

test('equip: a non-weapon relic never touches activeWeapon', () => {
  const save = { relics: {}, armor: {}, activeWeapon: 'bow' };
  Gear.equip(save, 'relic', 'pick', 3);
  Gear.equip(save, 'armor', 'helmet', 2);
  assert.eq(save.activeWeapon, 'bow', 'gathering tools and armor are not weapons');
});

test('buildRelicOffer: returns a usable upgrade with a positive price', () => {
  const save = { relics: {}, armor: {} };
  const offer = Gear.buildRelicOffer(save, seeded(1));
  assert.truthy(offer, 'an offer exists when slots are empty');
  assert.truthy(offer.kind === 'relic' || offer.kind === 'armor');
  assert.gt(offer.tier, 0);
  assert.gt(offer.price, 0, 'priced');
});

test('buildRelicOffer: never offers a tier ≤ what the player already owns', () => {
  // Max everything out → no upgrade possible → null.
  const maxed = { relics: {}, armor: {} };
  for (const slot of Object.keys(RELIC_DEFS)) maxed.relics[slot] = { tier: 7 };
  for (const slot of Object.keys(ARMOR_DEFS)) maxed.armor[slot] = { tier: 7 };
  assert.eq(Gear.buildRelicOffer(maxed, seeded(2)), null, 'fully maxed → no offer');
  // A T5 pick → any pick offer must be T6+.
  const save = { relics: { pick: { tier: 5 } }, armor: {} };
  for (let s = 1; s <= 40; s++) {
    const o = Gear.buildRelicOffer(save, seeded(s));
    if (o && o.kind === 'relic' && o.slot === 'pick') assert.gt(o.tier, 5, 'pick offer beats the owned T5');
  }
});

test('buildRelicOffer: deterministic for a fixed seed', () => {
  const save = () => ({ relics: {}, armor: {} });
  const a = Gear.buildRelicOffer(save(), seeded(42));
  const b = Gear.buildRelicOffer(save(), seeded(42));
  assert.eq(JSON.stringify(a), JSON.stringify(b));
});

test('buildRelicOffer: castle pricing collapses toward par as Bow tier climbs', () => {
  const base = { relics: {}, armor: {} };
  const bowed = { relics: { bow: { tier: 7 } }, armor: {} };
  // Compare the SAME pick by using a seed that lands on a non-bow slot, summed
  // over many seeds: mean castle price with a T7 bow should be < without.
  let sumBase = 0, sumBow = 0, n = 0;
  for (let s = 1; s <= 200; s++) {
    const o1 = Gear.buildRelicOffer(base, seeded(s), { isCastle: true });
    const o2 = Gear.buildRelicOffer(bowed, seeded(s), { isCastle: true });
    if (o1 && o2 && o1.slot === o2.slot && o1.tier === o2.tier && o1.slot !== 'bow') {
      sumBase += o1.price; sumBow += o2.price; n++;
    }
  }
  assert.gt(n, 0, 'had comparable offers');
  assert.lt(sumBow, sumBase, 'a maxed Bow discounts castle prices');
});

test('blacksmithRecipe: tools use the tier bar (≥5), jewelry uses gems+bar', () => {
  assert.eq(Gear.blacksmithRecipe('relic', 'pick', 0), null, 'tier 0 → no recipe');
  const wood = Gear.blacksmithRecipe('relic', 'pick', 1);
  assert.eq(JSON.stringify(wood), JSON.stringify([{ id: 'wood', qty: 5 }]), 'T1 pick = 5 wood');
  const iron = Gear.blacksmithRecipe('relic', 'pick', 3);
  assert.eq(JSON.stringify(iron), JSON.stringify([{ id: 'iron_bar', qty: 5 }]), 'T3 pick = 5 iron');
  assert.eq(Gear.blacksmithRecipe('relic', 'ring', 1), null, 'no wooden jewelry');
  const ringT3 = Gear.blacksmithRecipe('relic', 'ring', 3);
  assert.eq(ringT3[0].id, 'ruby', 'ring uses rubies');
  assert.eq(ringT3[0].qty, 2, 'geometric ramp: 2^(3-2)=2');
  assert.eq(ringT3[1].id, 'iron_bar', 'plus the tier bar');
});

test('smeltingRecipe + smeltUnlockedBars: T5+ bars, always available', () => {
  assert.eq(Gear.smeltingRecipe('iron_bar'), null, 'mined bars aren’t smeltable');
  assert.truthy(Gear.smeltingRecipe('frost_bar'), 'frost is smeltable');
  // The crafting shrine was removed — smelting is always available at the
  // blacksmith, so all three T5+ bars are unlocked with no shrine-level gate.
  assert.eq(
    JSON.stringify(Gear.smeltUnlockedBars()),
    JSON.stringify(['platinum_bar', 'crimson_bar', 'frost_bar']),
    'all three T5+ bars unlocked',
  );
});
