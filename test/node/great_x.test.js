// The GREAT X — loot.js GREAT_X / treasureContextFor and its loot_contexts.js
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
  assert.eq(treasureContextFor({ great: false }), 'treasure:default');
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

test('great X: a tenth of every X mark is great, keyed off its id', () => {
  assert.eq(GREAT_X.share, 1 / 10);
  assert.eq(isGreatX({ id: 'treasure_x_3_4_5_6' }), isGreatX({ id: 'treasure_x_3_4_5_6' }), 'deterministic');
  assert.eq(isGreatX({ id: 'x', great: true }), true, 'a mark may say so itself');
  assert.eq(isGreatX({ id: 'x', great: false }), false);
  let great = 0;
  const n = 20000;
  for (let i = 0; i < n; i++) if (isGreatX({ id: WorldGen.cellId(i % 2 ? 'treasure_x' : 't_park', 3, 4, i % 211, i) })) great++;
  const rate = great / n;
  assert.truthy(Math.abs(rate - GREAT_X.share) < GREAT_X.share * 0.15, 'rate ' + rate + ' near the share');
});
