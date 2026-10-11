// The GREAT X — loot.js GREAT_X / treasureContextFor and its rarity.js
// 'treasure:great' pool: a thick dark-red X mark whose dig pays only gold, a
// tool or weapon, or other equipment.

function seededGreat(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('great X: a flagged mark rolls the great pool, any other the ordinary one', () => {
  assert.eq(treasureContextFor({ great: true }), GREAT_X.context);
  assert.eq(treasureContextFor({}), 'treasure:default');
  assert.eq(treasureContextFor(null), 'treasure:default');
  assert.truthy(LOOT_CONTEXTS[GREAT_X.context], 'the context exists');
  assert.eq(Object.keys(LOOT_CONTEXTS[GREAT_X.context].classBias).sort().join(','), 'cash,gear,relic');
});

test('great X: every dig is gold or equipment, and it beats the ordinary X', () => {
  const ctx = LOOT_CONTEXTS[GREAT_X.context], plain = LOOT_CONTEXTS['treasure:default'];
  assert.gt(ctx.chainMax, plain.chainMax, 'a higher tier ceiling than the ordinary X');
  assert.gt(ctx.relicCap, 0, 'relics are reachable');
  const seen = new Set();
  for (let seed = 1; seed <= 400; seed++) {
    const r = pickReward(GREAT_X.context, { relics: {}, armor: {} }, seededGreat(seed));
    assert.truthy(r, 'seed ' + seed + ' produced a reward');
    const ok = r.kind === 'gold' || r.kind === 'relic' || r.kind === 'armor'
      || (r.kind === 'item' && r.cls === 'unique_relic');
    assert.truthy(ok, `seed ${seed}: ${r.kind} ${r.id || r.slot || ''} is gold or equipment`);
    seen.add(r.kind === 'gold' && !r.slot ? 'gold' : r.kind);
  }
  assert.truthy(seen.has('gold') && seen.has('relic') && seen.has('armor'), 'all three shapes turn up: ' + [...seen]);
});

test('great X: a share of the scatter is great, keyed off the cell hash', () => {
  assert.eq(isGreatXCell(3, 4, 5, 6), isGreatXCell(3, 4, 5, 6), 'deterministic');
  assert.gt(GREAT_X.share, 0);
  assert.lt(GREAT_X.share, 1);
  let great = 0, n = 0;
  for (let cx = 0; cx < 100; cx++) for (let cy = 0; cy < 100; cy++, n++) {
    if (isGreatXCell(3, 4, cx, cy)) great++;
  }
  const rate = great / n;
  assert.truthy(Math.abs(rate - GREAT_X.share) < GREAT_X.share * 0.25, 'rate ' + rate + ' near the share');
});
