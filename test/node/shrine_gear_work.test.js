// Work clocks and temporary equipment use real scene entry points; ownership
// and tier gates must not inherit a boon merely because it speeds a wheel.
(function () {
  const lift = (name) => {
    const at = SCENE_SRC.indexOf(`  ${name}(`);
    const end = SCENE_SRC.indexOf('\n  }', at);
    assert.truthy(at >= 0 && end > at, `${name} scene method exists`);
    return new Function('Gear', 'performance', `return ({${SCENE_SRC.slice(at, end + 4)}}).${name};`)(Gear, { now: () => 10 });
  };

  test('Harvest: mine, chop, till, fish and catch wheels run at triple speed', () => {
    const scene = { save: { boonUntil: { work: Date.now() + 900000 } }, _setWorkProgressIcon() {} };
    const start = lift('startWorkProgress');
    for (const slot of ['pickaxe', 'axe', 'hoe', 'fishing_rod', 'net', null]) {
      start.call(scene, 0, 0, () => {}, 9000, 3, slot);
      assert.eq(scene._workProgress.durationMs, 3000, `${slot || 'untooled'} work is tripled`);
      assert.eq(scene._workProgress.energyRefund, 3, 'speed does not change the paid cost');
    }
    lift('startCatchProgress').call(scene, { x: 1, y: 2 }, 6000, () => {}, () => {}, 'net');
    assert.eq(scene._workProgress.durationMs, 2000, 'the separate live catch wheel is tripled too');
  });

  test('Drill: the real work entry point speeds mining only', () => {
    const scene = { save: { boonUntil: { mining: Date.now() + 60000 } }, _setWorkProgressIcon() {} };
    const start = lift('startWorkProgress');
    start.call(scene, 0, 0, () => {}, 9000, 3, 'pickaxe');
    assert.eq(scene._workProgress.durationMs, toolDurationMs({ pickaxe: { tier: 7 } }, 'pickaxe'));
    assert.eq(scene._workProgress.energyRefund, 3);
    start.call(scene, 0, 0, () => {}, 9000, 3, 'axe');
    assert.eq(scene._workProgress.durationMs, 9000);
  });

  test('Harvest: expiry restores duration, with no tier or combat changes', () => {
    const save = { relics: { pickaxe: { tier: 1 }, axe: { tier: 1 }, sword: { tier: 2 } }, boonUntil: { work: 100 } };
    const before = JSON.stringify(save.relics);
    assert.eq(Gear.workDurationMs(save, 9000, 99), 3000);
    assert.eq(Gear.workDurationMs(save, 9000, 100), 9000);
    assert.eq(Gear.workDurationMs(save, 9000, 101), 9000);
    assert.eq(JSON.stringify(Gear.effectiveRelics(save, 99)), before);
    assert.eq(toolDurationMs(Gear.effectiveRelics(save, 99), 'sword'), toolDurationMs(save.relics, 'sword'), 'combat ladder is unchanged');
    save.boonUntil.work = Date.now() + 900000;
    const ore = { kind: 'mineralrock', yieldTier: 6, requiredTier: 5 };
    const tree = { kind: 'tree', species: 'maple', size: 'large' };
    assert.truthy(INTERACTABLES.mineralrock.gate(ore, save), 'high-tier ore remains blocked');
    assert.truthy(INTERACTABLES.tree.gate(tree, save), 'large hardwood remains blocked');
    assert.eq(JSON.stringify(save.relics), before, 'owned tools remain unchanged');
  });

  test('Ember: lends a T6 staff without granting it, then restores equipment and selection', () => {
    const save = { relics: { bow: { tier: 2 } }, activeWeapon: 'bow', boonUntil: { wand: 100 } };
    const before = JSON.stringify(save.relics);
    assert.eq(Gear.effectiveRelics(save, 99).staff.tier, 6);
    assert.eq(Gear.activeWeapon(save, 99), 'staff', 'the new boon starts ready to fire');
    assert.eq(Gear.activeWeapon(save, 100), 'bow');
    assert.falsy(Gear.effectiveRelics(save, 100).staff);
    assert.eq(JSON.stringify(save.relics), before, 'no inventory mutation');
    assert.eq(save.activeWeapon, 'bow', 'saved weapon preference is preserved');
    assert.eq(Combat.shotDamage(Gear.effectiveRelics(save, 99), 'staff'), Combat.shotDamage({ staff: { tier: 6 } }, 'staff'), 'damage uses the same effective tier as art');
  });

  test('Ember: keeps a stronger staff and allows weapon switching during the boon', () => {
    const save = { relics: { staff: { tier: 7 }, bow: { tier: 2 } }, activeWeapon: 'bow', boonUntil: { wand: 100 } };
    assert.eq(Gear.effectiveRelics(save, 99).staff.tier, 7);
    assert.truthy(Gear.selectWeapon(save, 'bow', 99));
    assert.eq(Gear.activeWeapon(save, 99), 'bow');
    assert.truthy(Gear.selectWeapon(save, 'staff', 99));
    assert.eq(Gear.activeWeapon(save, 99), 'staff');
    assert.eq(Gear.activeWeapon(save, 100), 'bow', 'prior selection returns on expiry');
    assert.falsy(Gear.selectWeapon(save, 'sword', 99), 'cannot select an unowned weapon');
    save.boonUntil.wand = 200;
    assert.eq(Gear.activeWeapon(save, 101), 'staff', 'a later boon starts ready again');
    assert.eq(Gear.effectiveRelics(save, 200).staff.tier, 7, 'owned staff survives expiry');
  });
})();
