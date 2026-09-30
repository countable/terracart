(function () {
function saveWith(restores, memories) {
  return { restoredHouses: Object.fromEntries(Array.from({ length: restores }, (_, i) =>
    ['house:' + i, i === 0 ? 'blacksmith' : i === 14 ? 'wizard' : 'plain'])),
    discovered: Object.fromEntries(Array.from({ length: memories }, (_, i) => ['memory:' + i, 1])) };
}
function restore(save, order, address = 3) {
  const house = { kind: 'house', tier: 9, id: 'house:' + order, address };
  save.restoredHouses[house.id] = Houses.preseedRestoreRole(save, order, house);
  Houses.registerWizardTower(save, house, order);
  return house;
}

test('wizard towers: first is the fifteenth restore and random addresses cannot add story towers', () => {
  const save = saveWith(1, 30);
  const real = Shops.shopType;
  Shops.shopType = () => 'wizard';
  try {
    for (let i = 1; i < 14; i++) assert.falsy(restore(save, i).id === Houses.wizardTowerIds(save).firstId);
    const first = restore(save, 14);
    assert.eq(Houses.wizardTowerIdentity(save, first), 'first');
    assert.eq(save.restoredHouses[first.id], 'wizard');
    for (let i = 15; i < 25; i++) {
      const next = restore(save, i);
      assert.eq(save.restoredHouses[next.id], 'plain');
      assert.eq(Houses.wizardTowerIdentity(save, next), null);
    }
  } finally { Shops.shopType = real; }
});

test('wizard towers: second requires both restore index25 and lifetime21, then stays fixed', () => {
  for (const [order, memories, expected] of [[24, 21, 'plain'], [25, 20, 'plain'], [25, 21, 'wizard'], [29, 21, 'wizard']]) {
    const save = saveWith(order, memories), house = restore(save, order);
    assert.eq(save.restoredHouses[house.id], expected, `order ${order}, memories ${memories}`);
    assert.eq(Houses.wizardTowerIdentity(save, house), expected === 'wizard' ? 'second' : null);
    if (expected === 'wizard') {
      save.memories = 0;
      const reloaded = JSON.parse(JSON.stringify(save));
      assert.eq(Houses.wizardTowerIdentity(reloaded, house), 'second');
      const later = restore(reloaded, order + 1);
      assert.eq(reloaded.restoredHouses[later.id], 'plain');
      assert.eq(Houses.wizardTowerIds(reloaded).secondId, house.id);
    }
  }
});

test('wizard towers: an early twenty-sixth restoration remains plain; next eligible restoration relocates', () => {
  const save = saveWith(25, 20), plain = restore(save, 25);
  save.discovered.next = 1;
  assert.eq(Houses.preseedRestoreRole(save, 25, plain), 'plain', 'never relabel a restored residence');
  assert.eq(Houses.wizardTowerIds(save).secondId, null);
  const next = restore(save, 26);
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
  Houses.registerWizardTower(save, { id: 'house:29' }, 29);
  assert.eq(save.wizardTowers.firstId, 'house:14');
  assert.eq(save.wizardTowers.secondId, 'house:26');
});

test('wizard towers: legacy extra towers before index25 do not satisfy relocation', () => {
  const save = saveWith(29, 21);
  save.restoredHouses['house:20'] = 'wizard';
  assert.eq(Houses.wizardTowerIds(save).secondId, null);
  const second = restore(save, 29);
  assert.eq(Houses.wizardTowerIdentity(save, second), 'second');
});

test('wizard towers: missing first tower catches up without treating it as the second', () => {
  const save = saveWith(27, 30); save.restoredHouses['house:14'] = 'plain';
  const first = restore(save, 27);
  assert.eq(Houses.wizardTowerIdentity(save, first), 'first');
  assert.eq(Houses.wizardTowerIds(save).secondId, null);
  assert.eq(Houses.wizardTowerIdentity(save, restore(save, 28)), 'second');
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
