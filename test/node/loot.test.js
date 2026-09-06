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

test('reconcileRelicOffer: armor kind reconciles against save.armor, never downgrades', () => {
  // Fixed-payload armor chests (interactables.js fixedChestReward) must not
  // hand back a lower tier than what's already equipped.
  const save = { relics: {}, armor: { helmet: { tier: 4 } } };
  const upgrade = reconcileRelicOffer({ kind: 'armor', slot: 'helmet', tier: 6, jackpot: 0 }, save, () => 0.99);
  assert.eq(upgrade.kind, 'armor', 'a real upgrade is handed over as armor');
  assert.eq(upgrade.tier, 6, 'upgrade keeps the rolled tier');
  const dupe = reconcileRelicOffer({ kind: 'armor', slot: 'helmet', tier: 2, jackpot: 0 }, save, () => 0.99);
  assert.truthy(dupe.kind === 'armor' || dupe.kind === 'gold', 'never a bare relic kind for an armor offer');
  assert.truthy(dupe.tier >= 4, 'never resolves below the tier already equipped');
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

// ── opts.rollBonus — the walk's extra chain steps ─────────────────────────
// A cobble-trail prize costs ~200 m of walking, so it rolls the lowtier T4
// curve plus Trail.PRIZE_ROLL_BONUS extra boost steps. A bonus step buys TIER
// and nothing else: it lifts a roll toward the context's ceiling, never above
// it, and never into the stack.
test('pickReward: a roll bonus lifts the average TIER', () => {
  const N = 600;
  const save = () => ({ relics: {}, armor: {} });
  const meanTier = (bonus) => {
    let sum = 0, n = 0;
    for (let s = 1; s <= N; s++) {
      const r = pickReward('chest:lowtier', save(), seeded(s * 2246822519),
                           { tier: 4, rollBonus: bonus });
      if (r && r.kind === 'item') { sum += r.tier; n++; }
    }
    return n ? sum / n : 0;
  };
  const base = meanTier(0);
  const bonused = meanTier(Trail.PRIZE_ROLL_BONUS);
  assert.gt(bonused, base, `bonused ${bonused} > base ${base}`);
});

// THE "× 2" BUG. A bonus step used to be an ordinary chain step, and an
// ordinary step with no tier headroom left falls through to a QUANTITY
// bracket. The trail rolls the T4 lowtier curve, which already spends its own
// chain reaching chainMax — so every bonus step landed on the stack and the
// prize ceremony offered "× 2" of a T4 item on roughly every other prize. The
// quantity a walk pays is the chest curve's own; only WHAT it pays improves.
test('pickReward: a roll bonus never buys quantity', () => {
  const N = 400;
  const save = () => ({ relics: {}, armor: {} });
  // Same seeds, same context, bonus vs none: the bonus may move the tier (and
  // with it which item is picked), but it must never make the stack BIGGER
  // than the tier's own bracket roll would. Pin it where the old code was
  // worst — a bonus far past the chain cap.
  const qtyHist = (bonus) => {
    const hist = new Map();
    for (let s = 1; s <= N; s++) {
      const r = pickReward('chest:lowtier', save(), seeded(s * 7919),
                           { tier: 4, rollBonus: bonus });
      if (r && r.kind === 'item') hist.set(r.qty, (hist.get(r.qty) || 0) + 1);
    }
    return hist;
  };
  const items = (h) => [...h.values()].reduce((a, b) => a + b, 0);
  const ones = (h) => (h.get(1) || 0) / items(h);
  const plain = qtyHist(0);
  const walked = qtyHist(Trail.PRIZE_ROLL_BONUS_MAX);
  // A single item was the commonest outcome of a plain chest and has to stay
  // an ordinary outcome of a walk. Under the old rule the only singles left
  // were the classes that discard brackets outright (consumable, animal) —
  // roughly a fifth as many — because every bonus step bought a bracket for
  // everything else.
  assert.gt(walked.get(1) || 0, 0, 'a walk can still pay a single item');
  assert.gt(ones(walked), ones(plain) / 2,
    `singles stay common (${ones(walked).toFixed(2)} vs ${ones(plain).toFixed(2)})`);
});

test('pickReward: a roll bonus cannot break the context ceiling', () => {
  // The lowtier T4 curve caps items at maxTier 7 and the chain at chainMax 4;
  // a bonus is more steps, not a bigger cap.
  for (let s = 1; s <= 300; s++) {
    const r = pickReward('chest:lowtier', { relics: {}, armor: {} },
                         seeded(s * 40503), { tier: 4, rollBonus: 5 });
    if (r && r.kind === 'item') {
      assert.truthy(r.tier <= 7, `tier ${r.tier} stays inside the ceiling`);
      assert.truthy(r.qty >= 1, 'and the stack is real');
    }
  }
});

test('pickReward: no bonus asked for is the old roll, exactly', () => {
  // Every other caller passes no rollBonus and must be untouched by it.
  const a = pickReward('chest:lowtier', { relics: {}, armor: {} }, seeded(99), { tier: 4 });
  const b = pickReward('chest:lowtier', { relics: {}, armor: {} }, seeded(99),
                       { tier: 4, rollBonus: 0 });
  assert.eq(JSON.stringify(a), JSON.stringify(b), 'rollBonus 0 changes nothing');
});
