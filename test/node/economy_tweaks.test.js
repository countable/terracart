// Economy audit follow-ups (2026-09-27): the first harvest of each crop banks a memory; a cow
// takes twice the netting (its HP: a catch's difficulty is HP × 2); and no gear
// roll hands out unique jewelry.
(function () {
test('economy: the first harvest of each crop is a memory, keyed by crop', () => {
  assert.truthy(/scene\._bankDiscovery\?\.\(`harvest:\$\{p\.crop\}`,/.test(INTERACT_SRC),
    'banked through the one ledger, once per crop');
});

test('economy: a cow and a horse take twice the netting, through their HP', () => {
  const save = { relics: {} };
  const at = (kind) => Pets.catchMs(save, { kind });
  assert.eq(at('cow'), 2 * at('chicken')); assert.eq(at('horse'), 2 * at('chicken'));
  assert.eq(at('butterfly'), at('chicken'));
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
