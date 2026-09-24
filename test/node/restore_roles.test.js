// Which role a rebuilt wreck takes (app.js _preseedRestoreRole): the fixed
// opening run by restore order — blacksmith, trader, house, market — the
// wizard at the 15th, the address-derived Shops.shopType otherwise, and a
// blacksmith on the next rebuild of any save that has none.

(function () {
const lift = (sig) => {
  const start = APP_JS_SRC.indexOf('\n  ' + sig);
  const end = start < 0 ? -1 : APP_JS_SRC.indexOf('\n  }\n', start);
  assert.truthy(start > 0 && end > start, `found ${sig} in app.js`);
  return APP_JS_SRC.slice(start + 1, end + 4);
};
const table = APP_JS_SRC.match(/const PRESEED_RESTORE_ROLES = (\{[\s\S]*?\});/);
const ROLES = (0, eval)('(' + table[1] + ')');
const M = (0, eval)('(function (PRESEED_RESTORE_ROLES) { return {\n'
  + [lift('_preseedRestoreRole(order, house) {'), lift('_hasBlacksmith() {')].join(',\n')
  + '\n}; })')(ROLES);
const scene = (save) => Object.assign(Object.create(M), { save });
const plainHouse = { kind: 'house', tier: 9, address: 3 };   // shopType → null

test('restore roles: the opening run, then the address, and the wizard at 15', () => {
  assert.eq(JSON.stringify(ROLES), JSON.stringify({ 0: 'blacksmith', 1: 'trader', 2: 'plain', 3: 'market', 14: 'wizard' }),
    'no plain-house override at rebuilds 5 and 6');
  const s = scene({ restoredHouses: { a: 'blacksmith' }, starterBlacksmithId: 'a' });
  assert.eq(s._preseedRestoreRole(1, plainHouse), 'trader');
  assert.eq(s._preseedRestoreRole(4, { kind: 'house', tier: 9, address: 16 }), 'market', 'rebuild 5 follows its address');
  assert.eq(s._preseedRestoreRole(5, plainHouse), 'plain', 'a plain address stays plain');
  assert.eq(s._preseedRestoreRole(14, plainHouse), 'wizard');
});

test('restore roles: a save with no blacksmith gets one on its next rebuild', () => {
  const s = scene({ restoredHouses: { a: 'trader', b: 'plain', c: true } });
  assert.eq(s._preseedRestoreRole(3, plainHouse), 'blacksmith', 'whatever slot it is');
  assert.eq(scene({ restoredHouses: {} })._preseedRestoreRole(0, plainHouse), 'blacksmith', 'a new save: slot 0 anyway');
  const has = scene({ restoredHouses: { a: 'trader', z: 'blacksmith' } });
  assert.eq(has._preseedRestoreRole(3, plainHouse), 'market', 'once there is one, the run resumes');
});
})();
