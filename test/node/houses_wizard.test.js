// Wizard tower identity (houses.js): the Wizard Tower card is offered from
// the thirtieth restore (Houses.BUILD_OPTIONS / STORY_RESTORES.firstTower) and
// raises the FIRST tower; a second is offered only from the fifty-second with
// 21 memories home, once the first stands. Old unstamped saves keep the
// identities their original schedule gave them (wizardTowerIds).
(function () {
function saveWith(restores, memories) {
  return { restoredHouses: Object.fromEntries(Array.from({ length: restores }, (_, i) =>
    ['house:' + i, i === 0 ? 'blacksmith' : i === 14 ? 'wizard' : 'plain'])),
    discovered: Object.fromEntries(Array.from({ length: memories }, (_, i) => ['memory:' + i, 1])) };
}
const offersWizard = (save) => Houses.buildOptions(save, null).some((r) => r.key === 'wizard');
// Restore the next house as the wizard card when it is on offer, else a house.
function restore(save, order, key = offersWizard(save) ? 'wizard' : 'plain') {
  const house = { kind: 'house', tier: 9, id: 'house:' + order, address: 3 };
  Houses.restoreAs(save, house, key);
  return house;
}

test('wizard towers: the card is offered from the thirtieth restore and raises the first', () => {
  const save = saveWith(1, 30);
  for (let i = 1; i < 29; i++) {
    assert.falsy(offersWizard(save), `no tower on offer at restore ${i + 1}`);
    assert.falsy(restore(save, i).id === Houses.wizardTowerIds(save).firstId);
  }
  assert.truthy(offersWizard(save), 'on offer at the thirtieth');
  const first = restore(save, 29);
  assert.eq(Houses.wizardTowerIdentity(save, first), 'first');
  assert.eq(save.restoredHouses[first.id], 'wizard');
  for (let i = 30; i < 51; i++) {
    assert.falsy(offersWizard(save), `no second tower before the fifty-second (restore ${i + 1})`);
    const next = restore(save, i);
    assert.eq(save.restoredHouses[next.id], 'plain');
    assert.eq(Houses.wizardTowerIdentity(save, next), null);
  }
  assert.truthy(offersWizard(save), 'the second is on offer at the fifty-second with 30 memories');
});

test('wizard towers: the tower may wait — the thirtieth need not be it', () => {
  const save = saveWith(29, 0); save.restoredHouses['house:14'] = 'plain';   // no legacy tower
  assert.truthy(offersWizard(save), 'on offer at the thirtieth');
  const house = restore(save, 29, 'plain');
  assert.eq(save.restoredHouses[house.id], 'plain');
  assert.truthy(offersWizard(save), 'still on offer for the next');
  assert.eq(Houses.wizardTowerIdentity(save, restore(save, 30)), 'first');
  assert.falsy(offersWizard(save), 'and gone once it stands');
});

test('wizard towers: second requires both restore index51 and lifetime21, then stays fixed', () => {
  for (const [order, memories, expected] of [[50, 21, 'plain'], [51, 20, 'plain'], [51, 21, 'wizard'], [55, 21, 'wizard']]) {
    const save = saveWith(order, memories), house = restore(save, order);
    assert.eq(save.restoredHouses[house.id], expected, `order ${order}, memories ${memories}`);
    assert.eq(Houses.wizardTowerIdentity(save, house), expected === 'wizard' ? 'second' : null);
    if (expected === 'wizard') {
      save.memories = 0;
      const reloaded = JSON.parse(JSON.stringify(save));
      assert.eq(Houses.wizardTowerIdentity(reloaded, house), 'second');
      assert.falsy(offersWizard(reloaded), 'no third tower');
      const later = restore(reloaded, order + 1);
      assert.eq(reloaded.restoredHouses[later.id], 'plain');
      assert.eq(Houses.wizardTowerIds(reloaded).secondId, house.id);
    }
  }
});

test('wizard towers: an early fifty-second restoration remains plain; the next eligible restoration relocates', () => {
  const save = saveWith(51, 20), plain = restore(save, 51);
  assert.eq(save.restoredHouses[plain.id], 'plain');
  save.discovered.next = 1;
  assert.eq(Houses.restoreAs(save, plain, 'wizard'), null, 'never relabel a restored residence');
  assert.eq(Houses.wizardTowerIds(save).secondId, null);
  const next = restore(save, 52);
  assert.eq(Houses.wizardTowerIdentity(save, next), 'second');
});

test('wizard towers: legacy random towers use deterministic canonical identities without mutating queries', () => {
  const save = saveWith(30, 21);
  save.restoredHouses['house:7'] = 'wizard';
  save.restoredHouses['house:20'] = 'wizard';
  save.restoredHouses['house:26'] = 'wizard';
  save.restoredHouses['house:28'] = 'wizard';
  const before = JSON.stringify(save);
  assert.eq(Houses.wizardTowerIds(save).firstId, 'house:14');
  assert.eq(Houses.wizardTowerIds(save).secondId, 'house:26');
  assert.eq(Houses.wizardTowerIdentity(save, { id: 'house:20' }), null);
  assert.eq(JSON.stringify(save), before, 'read-only migration lookup');
  Houses.registerWizardTower(save, { id: 'house:29' });
  assert.eq(save.wizardTowers.firstId, 'house:14');
  assert.eq(save.wizardTowers.secondId, 'house:26');
});

test('wizard towers: legacy extra towers before index25 do not satisfy relocation', () => {
  const save = saveWith(29, 21);
  save.restoredHouses['house:20'] = 'wizard';
  assert.eq(Houses.wizardTowerIds(save).secondId, null);
  assert.falsy(offersWizard(save), 'the legacy first stands, and the second is not due');
  for (let i = 29; i < 51; i++) assert.eq(save.restoredHouses[restore(save, i).id], 'plain', `restore ${i + 1} stays plain`);
  const second = restore(save, 51);
  assert.eq(Houses.wizardTowerIdentity(save, second), 'second');
});

test('wizard towers: missing first tower catches up without treating it as the second', () => {
  const save = saveWith(52, 30); save.restoredHouses['house:14'] = 'plain';
  const first = restore(save, 52);
  assert.eq(Houses.wizardTowerIdentity(save, first), 'first');
  assert.eq(Houses.wizardTowerIds(save).secondId, null);
  assert.eq(Houses.wizardTowerIdentity(save, restore(save, 53)), 'second');
});
test('wizard towers: stamped first and explicit missing second avoid ledger scans during rendering', () => {
  const save = { wizardTowers: { firstId: 'first', secondId: null },
    restoredHouses: new Proxy({}, { ownKeys() { throw new Error('unexpected house scan'); } }),
    discovered: new Proxy({}, { ownKeys() { throw new Error('unexpected memory scan'); } }) };
  assert.eq(Houses.wizardTowerIds(save).firstId, 'first');
  assert.eq(Houses.wizardTowerIds(save).secondId, null);
  assert.eq(Houses.wizardTowerIdentity(save, { id: 'first' }), 'first');
});
})();
