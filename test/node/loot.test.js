// Headless tests for the loot engine (src/rarity.js pickReward) — the
// chest/treasure path that IS luck-aware. Uses a seeded PRNG so every roll is
// deterministic and the assertions never flake.

// mulberry32 — tiny deterministic PRNG so a (seed → reward) mapping is stable.
function seeded(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const REWARD_KINDS = new Set(['item', 'relic', 'armor', 'gold']);

test('pickReward: returns a structurally valid reward for chest:lowtier', () => {
  const r = pickReward('chest:lowtier', { relics: {}, armor: {} }, seeded(1), { tier: 2 });
  assert.truthy(r, 'a reward was produced');
  assert.truthy(REWARD_KINDS.has(r.kind), 'kind is one of item/relic/armor/gold (' + r.kind + ')');
});

test('pickReward: item rewards reference real catalog entries with qty ≥ 1', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const r = pickReward('chest:lowtier', { relics: {}, armor: {} }, seeded(seed), { tier: 3 });
    assert.truthy(r && REWARD_KINDS.has(r.kind), 'valid reward shape for seed ' + seed);
    if (r.kind === 'item') {
      assert.truthy(ITEM_BY_ID[r.id], 'item id "' + r.id + '" exists in the catalog');
      assert.gte(r.qty, 1, 'item qty at least 1');
    }
  }
});

test('pickReward: deterministic for a fixed seed (rng is threaded through)', () => {
  const a = pickReward('chest:commerce', { relics: {}, armor: {} }, seeded(42), { tier: 2 });
  const b = pickReward('chest:commerce', { relics: {}, armor: {} }, seeded(42), { tier: 2 });
  assert.eq(JSON.stringify(a), JSON.stringify(b), 'same seed → same reward');
});

test('pickReward: treasure context also yields a valid reward', () => {
  const r = pickReward('treasure:default', { relics: {}, armor: {} }, seeded(7));
  assert.truthy(r && REWARD_KINDS.has(r.kind), 'treasure produced a valid reward');
});

test('pickReward: the ring nudges loot rarer on average (statistical, large N)', () => {
  // Ring luck lowers qtyP so chain steps tier-up more often. Over many rolls the
  // mean item tier with a T7 ring should not be LOWER than with no ring. Uses a
  // big N + a generous margin so it's a smoke test for the wiring, not a knife-edge.
  const N = 600;
  const meanTier = (save) => {
    let sum = 0, n = 0;
    for (let s = 1; s <= N; s++) {
      const r = pickReward('chest:park', save, seeded(s * 2654435761), { tier: 2 });
      if (r && r.kind === 'item' && typeof r.tier === 'number') { sum += r.tier; n++; }
    }
    return n ? sum / n : 0;
  };
  const base = meanTier({ relics: {}, armor: {} });
  const ringed = meanTier({ relics: { ring: { tier: 7 } }, armor: {} });
  assert.gte(ringed + 1e-9, base, `ring mean tier ${ringed} >= base ${base}`);
});
