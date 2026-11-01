// A weapon's or armour piece's stat sheet (Combat.gearStats): the figures the
// inventory detail dialog and a counter's gear offer print on the piece. Each
// is read off the function the fight runs on, so the sheet can never say one
// number while the fight deals another.
(function () {
  const sheet = (kind, slot, tier, opts) => Object.fromEntries(Combat.gearStats(kind, slot, tier, opts).map(r => [r.label, r.value]));

  test('gear stats: a melee weapon shows its blow, reach and cadence off the combat ladder', () => {
    const sword = sheet('relic', 'sword', 1);
    assert.eq(Object.keys(sword).join(','), 'Damage,Range,Attack speed');
    assert.eq(sword.Damage, `${Math.round(Combat.meleeSwingDamage({ sword: { tier: 1 } }, 1, undefined, 'sword') * 10) / 10} a blow`);
    assert.eq(sword.Damage, '3.8 a blow', 'Wood: 15000 / 4000 ms over a 1 s beat');
    assert.eq(sword.Range, `${Combat.MELEE_REACH_CELLS} cells`);
    assert.eq(sword['Attack speed'], 'every 1 s');
    assert.eq(sheet('relic', 'sword', 7).Damage, '50 a blow', 'Frost: the top rung');
    assert.eq(sheet('relic', 'sword', 1, { playerClass: 'enforcer' }).Damage, '8.8 a blow', 'the enforcer\'s class bonus is on the sheet');
    const lance = sheet('relic', 'lance', 3);
    assert.eq(lance.Damage, sheet('relic', 'sword', 3).Damage, 'a lance blow is the sword\'s');
    assert.eq(lance.Range, `${Combat.MELEE_REACH_CELLS * 2} cells`);
    assert.eq(lance['Attack speed'], 'every 2 s (every 1 s mounted)');
    assert.eq(sheet('relic', 'dagger', 1).Range, '0.5 cells', 'the dagger\'s 0.45, to a tenth');
    assert.eq(sheet('relic', 'sword', 1, { cellM: 2 }).Range, '1.2 m', 'a cell size prints the reach in metres');
  });

  test('gear stats: a ranged weapon shows its shot, range and beat', () => {
    const bow = sheet('relic', 'bow', 2, { reachCells: 3 });
    assert.eq(bow.Damage, `${Combat.shotDamage({ bow: { tier: 2 } }, 'bow')} a shot`);
    assert.eq(bow.Range, `${Combat.rangeCellsFor('bow', 3)} cells`);
    assert.eq(bow['Attack speed'], 'every 2 s');
    assert.eq(sheet('relic', 'bow', 2, { playerClass: 'hunter' }).Damage, `${Combat.shotDamage({ bow: { tier: 2 } }, 'bow', 'hunter')} a shot`);
    assert.eq(sheet('relic', 'bow', 2).Range, `${Combat.SHOT.bow.rangeCells} cells`, 'no live reach: the flat range');
    const staff = sheet('relic', 'staff', 1);
    assert.eq(staff.Damage, '5 a shot', 'a Wood bolt');
    assert.eq(staff['Attack speed'], 'every 5 s');
    assert.eq(sheet('relic', 'musket', 1).Damage, sheet('relic', 'musket', 5).Damage, 'the musket\'s fixed damage tier');
  });

  test('gear stats: armour shows its rating; tools, bags and the amulet show nothing', () => {
    for (const slot of Object.keys(ARMOR_DEFS)) {
      assert.eq(JSON.stringify(Combat.gearStats('armor', slot, 4)), JSON.stringify([{ label: 'Armour', value: String(armorSlotReduction(4)) }]), slot);
    }
    for (const slot of ['pickaxe', 'axe', 'hoe', 'watering_can', 'net', 'fishing_rod', 'bag', 'amulet']) {
      assert.eq(Combat.gearStats('relic', slot, 3).length, 0, slot);
    }
    assert.eq(Combat.gearStats('relic', 'sword', 0).length, 0, 'no piece, no sheet');
    assert.eq(Combat.gearStatLines('armor', 'helmet', 2).join('|'), 'Armour: 2');
  });

  test('gear stats: the detail dialog and both counters read the sheet off the scene', () => {
    assert.truthy(/this\._effectLineEl\(nameLbl, def\.blurb,[\s\S]{0,200}?this\.gearStatLines\(g\.kind, g\.slot, tier\)\)\);/.test(SCENE_SRC),
      'the inventory detail dialog carries the sheet');
    assert.truthy(/gearStatLines\(kind, slot, tier\) \{\s*return Combat\.gearStatLines\(kind, slot, tier,\s*\{ playerClass: this\.save\?\.playerClass, reachCells: reachCells\(this\), cellM: this\.cellM \}\);/.test(SCENE_SRC),
      'the scene passes its calling, live reach and cell size');
    assert.eq((SCENE_SRC.match(/this\.gearStatsHTML\(offer\.kind, offer\.slot, offer\.tier\)/g) || []).length, 2,
      'the stall gear counter and the relic shop both print it');
  });
})();
