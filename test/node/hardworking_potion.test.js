// THE POTION OF HARDWORKING — the Harvest Idol's boon in a T1 bottle.
//
// Drinking it pulls the idol's own `work` lever (Shrines.extend, the one
// writer of every lever) for five minutes: every work wheel runs at
// Shrines.WORK_SPEED_MUL (gear.js workDurationMs), the `work` row of
// Buffs.KINDS counts it down as "Hardworking", and a potion on top of a
// visit EXTENDS the one countdown rather than stacking. app.js can't load
// headlessly, so the drink is lifted as source text.
(function () {
const T0 = 1_700_000_000_000;
const ID = 'hardworking_potion';
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

test('hardworking potion: a T1 magic item, drunk and never thrown', () => {
  const it = ITEM_BY_ID[ID];
  assert.truthy(it, 'registered');
  assert.eq(it.kind, 'magic'); assert.eq(it.baseTier, 1); assert.eq(BASE_TIER[ID], 1);
  assert.falsy(isPotion(ID), 'no recipient effect to throw at a creature');
  assert.gt(PRICES[ID], 0);
  assert.truthy(ITEM_EFFECTS[ID]);
  const src = MINERAL_ICON_SHEET[ID];
  assert.eq(src.sheet, 'icon_potions'); assert.eq(src.frame, 14);
  assert.falsy(Object.entries(MINERAL_ICON_SHEET).some(([id, r]) => id !== ID && r.sheet === src.sheet && r.frame === src.frame), 'its own frame');
  const row = CONSUMABLE_SPEC[ID];
  assert.eq(row.verb, 'Drink'); assert.eq(row.buff, 'work');
  assert.eq(row.durationMs, 5 * 60 * 1000, 'five minutes');
  assert.lt(row.durationMs, Shrines.SHRINE_KINDS.harvest_idol.durationMs, 'shorter than the idol\'s visit');
  assert.includes(Shops.themedStock('potion', 1), ID, 'the T1 magic shop stocks it');
});

test('hardworking potion: Buffs.extend is the one lever writer, for the idol and the bottle alike', () => {
  const save = {};
  assert.truthy(Shrines.extend(save, 'work', 1000, T0));
  assert.eq(save.boonUntil.work, T0 + 1000);
  assert.truthy(Shrines.extend(save, 'work', 500, T0 + 100), 'a shorter pull inside a longer one');
  assert.eq(save.boonUntil.work, T0 + 1500, 'adds to the time left (Buffs.laterOf); strength never stacks');
  assert.truthy(Shrines.grant(save, 'harvest_idol', T0 + 200));
  assert.eq(save.boonUntil.work, T0 + 1500 + Shrines.SHRINE_KINDS.harvest_idol.durationMs, 'grant goes through the same writer');
  assert.truthy(Shrines.extend(save, 'shield', 1000, T0), 'a potion-field lever writes its field');
  assert.eq(save.shieldPotionUntil, T0 + 1000);
  const scene = {};
  Shrines.extend(save, 'light', 1000, T0, scene);
  assert.eq(scene._torchUntil, T0 + 1000, 'a scene lever writes the scene');
  assert.falsy(Shrines.extend(save, 'pairy', 1000, T0), 'an instant lever has nothing to extend');
  assert.falsy(Shrines.extend(save, 'nope', 1000, T0));
  assert.truthy(/return extend\(save, row\.lever, row\.durationMs, now, scene\);/.test(Shrines.grant.toString()));
});

test('hardworking potion: the drink pulls the work lever for five minutes, extends the idol\'s, and is spent once', () => clock(setNow => {
  const s = scene();
  assert.eq(CONSUMABLE_SPEC[ID].buff, 'work', 'the idol\'s own lever, by its Buffs row');
  const use = method('_useTimedBuff');
  const drink = function () { return use.call(this, ID); };
  assert.eq(drink.call(s), true);
  assert.eq(Inventory.count(s.save, ID), 1);
  assert.eq(s.modals, 1, 'the drink dialog');
  assert.eq(s.save.boonUntil.work, T0 + CONSUMABLE_SPEC[ID].durationMs);
  assert.truthy(Shrines.leverActive(s.save, 'work', T0));
  // Every wheel runs at the idol's pace, from the one multiplier.
  assert.eq(Gear.workDurationMs(s.save, 9000, T0), 9000 / Shrines.WORK_SPEED_MUL);
  assert.eq(Gear.workDurationMs(s.save, 9000, T0 + CONSUMABLE_SPEC[ID].durationMs), 9000, 'and no longer afterwards');
  // The countdown is the idol's row, named by its boon word.
  const rows = Buffs.active(s.save, s, T0);
  assert.eq(rows.length, 1); assert.eq(rows[0].id, 'work'); assert.eq(rows[0].name, Shrines.SHRINE_KINDS.harvest_idol.boon);
  // On top of a fresh idol visit the drink EXTENDS the idol's spell (owner,
  // Oct 2026 — Buffs.extend: max(now, until) + duration, nothing thrown away).
  Shrines.grant(s.save, 'harvest_idol', T0);
  const idol = s.save.boonUntil.work;
  setNow(T0 + 10_000);
  assert.eq(drink.call(s), true);
  assert.eq(s.save.boonUntil.work, idol + CONSUMABLE_SPEC[ID].durationMs, 'the bottle is banked on top of the idol\'s spell');
  assert.eq(Inventory.count(s.save, ID), 0);
  assert.eq(drink.call(s), false, 'empty selection');
  const t = scene(1);
  setNow(idol + 1000);
  t.save.boonUntil = { work: idol };
  assert.eq(drink.call(t), true);
  assert.eq(t.save.boonUntil.work, idol + 1000 + CONSUMABLE_SPEC[ID].durationMs, 'runs from now once the idol\'s has lapsed');
  const wrong = scene(); wrong.save.inv[0].id = 'wood';
  assert.eq(drink.call(wrong), false);
  assert.falsy(wrong.save.boonUntil);
  assert.truthy(/Buffs\.extend\(this\.save, this, buff, spec\.durationMs \* mul\);/.test(app) && Buffs.KINDS.work.boon === 'work',
    'the drink pulls the lever through the one writer (the `work` row of Buffs.KINDS), never boonUntil by hand');
  assert.eq((app.match(/boonUntil\.work\s*=/g) || []).length, 0, 'no hand-written work expiry in the scene');
}));
})();
