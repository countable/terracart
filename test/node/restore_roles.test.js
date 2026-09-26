// Which role a rebuilt wreck takes (houses.js Houses.preseedRestoreRole): the
// fixed opening run by restore order — blacksmith, trader, house, market — the
// wizard at the 15th, the address-derived Shops.shopType otherwise, and a
// blacksmith on the next rebuild of any save that has none.

(function () {
const ROLES = Houses.PRESEED_RESTORE_ROLES;
const role = (save, order, house) => Houses.preseedRestoreRole(save, order, house);
const plainHouse = { kind: 'house', tier: 9, address: 3 };   // shopType → null

test('restore roles: the opening run, then the address, and the wizard at 15', () => {
  assert.eq(JSON.stringify(ROLES), JSON.stringify({ 0: 'blacksmith', 1: 'trader', 2: 'plain', 3: 'market', 14: 'wizard' }),
    'no plain-house override at rebuilds 5 and 6');
  const s = { restoredHouses: { a: 'blacksmith' }, starterBlacksmithId: 'a' };
  assert.eq(role(s, 1, plainHouse), 'trader');
  assert.eq(role(s, 4, { kind: 'house', tier: 9, address: 16 }), 'market', 'rebuild 5 follows its address');
  assert.eq(role(s, 5, plainHouse), 'plain', 'a plain address stays plain');
  assert.eq(role(s, 14, plainHouse), 'wizard');
});

test('restore roles: a save with no blacksmith gets one on its next rebuild', () => {
  assert.eq(role({ restoredHouses: { a: 'trader', b: 'plain', c: true } }, 3, plainHouse), 'blacksmith', 'whatever slot it is');
  assert.eq(role({ restoredHouses: {} }, 0, plainHouse), 'blacksmith', 'a new save: slot 0 anyway');
  assert.eq(role({ restoredHouses: { a: 'trader', z: 'blacksmith' } }, 3, plainHouse), 'market', 'once there is one, the run resumes');
});

test('restore roles: the scene keeps a same-named wrapper over Houses', () => {
  // interact.js and the restore modal call it on the scene; the rule is houses.js.
  assert.truthy(/_preseedRestoreRole\(order, house\) \{ return Houses\.preseedRestoreRole\(this\.save, order, house\); \}/.test(APP_JS_SRC),
    'app.js delegates to Houses.preseedRestoreRole');
});
})();
