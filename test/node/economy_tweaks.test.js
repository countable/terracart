// Economy audit follow-ups (2026-09-27): the first harvest of each crop banks a memory; a cow
// takes CREATURE_BEHAVIOUR's catchMul (2) times the net's time; and no gear
// roll hands out unique jewelry.
(function () {
test('economy: the first harvest of each crop is a memory, keyed by crop', () => {
  assert.truthy(/scene\._bankDiscovery\?\.\(`harvest:\$\{p\.crop\}`,/.test(INTERACT_SRC),
    'banked through the one ledger, once per crop');
});

test('economy: a cow takes twice the netting; everything else the net\'s own time', () => {
  assert.eq(SpriteLayout.creatureCatchMul('cow'), 2);
  assert.eq(SpriteLayout.creatureCatchMul('chicken'), 1);
  assert.eq(SpriteLayout.creatureCatchMul('butterfly'), 1);
  assert.truthy(/catchMs \*= SpriteLayout\.creatureCatchMul\(target\.kind\);/.test(INTERACT_SRC), 'read by the catch');
});

test('economy: no gear roll ever hands out unique jewelry', () => {
  let seed = 7;
  const rng = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < 3000; i++) {
    const r = rollGearUpgrade(rng, {}, 1 + (i % 4), {});
    assert.truthy(!r || !['ring', 'amulet'].includes(r.slot), 'jewelry came out of a gear roll');
  }
});
})();
