(function () {
const T0 = 1_700_000_000_000;
const ID = 'stoneskin_potion';
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

test('stoneskin: drinking uses the shared timer, survives reload and extends one armour bonus', () => clock(setNow => {
  const s = scene(), spec = CONSUMABLE_SPEC[ID];
  assert.eq(ITEM_BY_ID[ID].kind, 'magic');
  assert.eq(BASE_TIER[ID], 2);
  assert.includes(Shops.themedStock('potion', 2), ID);
  assert.eq(MINERAL_ICON_SHEET[ID].sheet, 'icon_potions');
  assert.truthy(ITEM_EFFECTS[ID]);
  assert.eq(method('_useTimedBuff').call(s, ID), true);
  assert.eq(Inventory.count(s.save, ID), 1);
  assert.eq(Combat.armorBonus(s.save, T0), spec.armorBonus);
  s.save = JSON.parse(JSON.stringify(s.save));
  setNow(T0 + 10000);
  assert.eq(method('_useTimedBuff').call(s, ID), true);
  assert.eq(Buffs.until('stoneskin', s.save), T0 + 2 * spec.durationMs);
  assert.eq(Combat.armorBonus(s.save), spec.armorBonus);
  assert.eq(Buffs.active(s.save, s).filter(b => b.id === 'stoneskin').length, 1);
  assert.eq(Combat.armorBonus(s.save, T0 + 2 * spec.durationMs), 0);
  assert.falsy(method('_useTimedBuff').call(s, ID), 'empty bottle stack');
}));

test('stoneskin: joins worn armour per hit, after shielding and before difficulty', () => {
  const save = { energy: 100, mode: 'hard', armor: { helmet: { tier: 2 } } };
  Buffs.extend(save, null, 'stoneskin', 120000, T0);
  const pool = armorReduction(save.armor) + CONSUMABLE_SPEC.stoneskin_potion.armorBonus;
  assert.eq(Combat.incomingDamage(save, 40, 2, T0), 2 * Combat.mitigate(20, pool) * 2.5);
  Buffs.extend(save, null, 'shield', 120000, T0);
  assert.eq(Combat.incomingDamage(save, 40, 2, T0), 2 * Combat.mitigate(10, pool) * 2.5);
  assert.eq(Combat.playerDamageRate(20, save.armor, 0.1, { save, now: T0, mode: 'hard' }),
    Combat.mitigate(20, pool) * 2.5 * 0.1);
  assert.eq(Combat.incomingDamage(save, 40, 2, T0 + 120000),
    Combat.playerDamage(40, save.armor, 2, 'hard'), 'expired bonus and shielding');
});
})();
