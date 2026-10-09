// THE POTION OF GRIP — the Rust totem's boon in a T1 bottle.
//
// Drinking it pulls the totem's own `melee` lever (Shrines.extend, the one
// writer of every lever): Combat.trainingBonus adds the melee and archery
// drill (+5 damage) while it runs, the `melee` row of Buffs.KINDS counts it
// down as "Grip", and a bottle on top of a totem visit EXTENDS the one
// countdown rather than stacking. app.js can't load headlessly, so the drink
// is lifted as source text (the same harness as hardworking_potion.test.js).
(function () {
const T0 = 1_700_000_000_000;
const ID = 'grip_potion';
const app = SCENE_SRC;
const APP_TABLES = (() => {
  const grab = (name) => {
    const m = SCENE_SRC.match(new RegExp('\\nconst ' + name + ' = \\{[\\s\\S]*?\\n\\};'));
    assert.truthy(m, name + ' table in app.js');
    return m[0];
  };
  return grab('SUMMON_HOOK') + grab('TIMED_BUFF_HOOKS');
})();
function method(name) {
  const start = app.indexOf('\n  ' + name + '(');
  const end = app.indexOf('\n  }\n', start);
  assert.truthy(start >= 0 && end > start, `found ${name}`);
  return new Function(APP_TABLES + '\nreturn ({' + app.slice(start, end + 4) + '})[' + JSON.stringify(name) + ']')();
}
function clock(fn) {
  const old = Date.now; let now = T0; Date.now = () => now;
  try { fn(t => { now = t; }); } finally { Date.now = old; }
}
function scene(count = 2) {
  return { save: { energy: 100, inv: [{ id: ID, count }], selSlot: 0 }, modals: 0,
    _selectedConsumable: method('_selectedConsumable'), _spendScroll: method('_spendScroll'),
    _consumeSelected: method('_consumeSelected'), _finishInventoryChange: method('_finishInventoryChange'),
    buildInventoryDOM() {}, showMessageModal() { this.modals++; } };
}

test('grip potion: a T1 magic item, drunk and never thrown, with its own icon', () => {
  const it = ITEM_BY_ID[ID];
  assert.truthy(it, 'registered');
  assert.eq(it.kind, 'magic'); assert.eq(it.baseTier, 1); assert.eq(BASE_TIER[ID], 1);
  assert.falsy(isPotion(ID), 'no recipient effect to throw at a creature');
  assert.gt(PRICES[ID], 0);
  assert.truthy(ITEM_EFFECTS[ID]);
  const src = MINERAL_ICON_SHEET[ID];
  assert.eq(src.sheet, 'icon_grip_potion');
  assert.truthy(new RegExp("icon_grip_potion: \\{ url: 'assets/Icons/Items/GripPotion\\.png'").test(app), 'ICON_SHEETS row');
  const row = CONSUMABLE_SPEC[ID];
  assert.eq(row.verb, 'Drink'); assert.eq(row.buff, 'melee');
  assert.eq(Shrines.LEVERS[Shrines.SHRINE_KINDS.rust_totem.lever], row.buff, 'the totem\'s own lever');
  assert.lt(row.durationMs, Shrines.SHRINE_KINDS.rust_totem.durationMs, 'shorter than the totem\'s visit');
  assert.includes(row.used.body(null, row), '+5 melee and archery damage', 'the dialog reads the drill');
  assert.includes(Shops.themedStock('potion', 1), ID, 'the T1 magic shop stocks it');
});

test('grip potion: the drink adds the drill to melee and archery, extends the totem\'s, and is spent once', () => clock(setNow => {
  const s = scene();
  const use = method('_useTimedBuff');
  const drink = function () { return use.call(this, ID); };
  const drill = Combat.TRAINING_KINDS.melee.drill;
  assert.eq(drill, 5, '+5 damage');
  const melee0 = Combat.trainingBonus(s.save, 'melee', T0), ranged0 = Combat.trainingBonus(s.save, 'ranged', T0);
  assert.eq(drink.call(s), true);
  assert.eq(Inventory.count(s.save, ID), 1);
  assert.eq(s.modals, 1, 'the drink dialog');
  assert.eq(s.save.boonUntil.melee, T0 + CONSUMABLE_SPEC[ID].durationMs);
  assert.eq(Combat.trainingBonus(s.save, 'melee', T0), melee0 + drill, 'melee +5');
  assert.eq(Combat.trainingBonus(s.save, 'ranged', T0), ranged0 + Combat.TRAINING_KINDS.ranged.drill, 'archery too');
  assert.eq(Combat.trainingBonus(s.save, 'magic', T0), 0, 'magic is not a grip');
  assert.eq(Combat.trainingBonus(s.save, 'melee', T0 + CONSUMABLE_SPEC[ID].durationMs), melee0, 'and no longer afterwards');
  const rows = Buffs.active(s.save, s, T0);
  assert.eq(rows.length, 1); assert.eq(rows[0].id, 'melee'); assert.eq(rows[0].name, Shrines.SHRINE_KINDS.rust_totem.boon);
  Shrines.grant(s.save, 'rust_totem', T0);
  const totem = s.save.boonUntil.melee;
  setNow(T0 + 10_000);
  assert.eq(drink.call(s), true);
  assert.eq(s.save.boonUntil.melee, totem + CONSUMABLE_SPEC[ID].durationMs, 'banked on top of the totem\'s spell, never stacked');
  assert.eq(Combat.trainingBonus(s.save, 'melee', T0 + 10_000), melee0 + drill, 'one drill, however many sources');
  assert.eq(Inventory.count(s.save, ID), 0);
  assert.eq(drink.call(s), false, 'empty selection');
}));
})();
