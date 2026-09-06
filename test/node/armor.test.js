// armor.test.js — what a worn set is FOR.
//
// Until Sep 2026 armour raised the max-energy CAP: each piece added
// `energyPerTier × tier` to the bar, so a Frost chestplate was worth exactly
// as much to a player who never met a slime as to one who lived underground.
// It soaks INCOMING DAMAGE now, and this file is that rule's audit.
//
// The rule, in one place:
//
//   • what one worn piece is worth is ITS TIER (items.js armorSlotReduction) —
//     every slot pays the same for a tier, so a set is just the sum of its
//     four (armorReduction);
//   • a blow spends that pool over Combat.MITIGATION_ROUNDS passes: soak up to
//     HALF the damage, halve what is LEFT of the pool, soak up to half of what
//     is left of the blow, four times over;
//   • halves round DOWN, and Combat.MIN_PLAYER_DAMAGE is the floor — no
//     attack ever lands for nothing, however good the armour.
//
// THE TWO THINGS THAT KEEP THE LADDER LEGIBLE, both learned the hard way in a
// day when armour shipped soaking tier SQUARED out of a pool handed to every
// round afresh:
//
//   1. THE SCALE MATCHES THE DAMAGE. Every blow in the game is 1..4 base,
//      doubled for an elite and again on hard — 1..16 in total. A quadratic
//      per-piece soak put a full Frost set at 196 against that, and every tier
//      from Iron up flattened every hit to the floor: the whole ladder above
//      Wood was invisible. Linear keeps the pool (1..28) beside the damage.
//   2. THE POOL IS SPENT, NOT RE-CHARGED. Handing each round the full halved
//      pool lets P soak P + P/2 + P/4 + P/8 ≈ 1.9P — a Wood SET removed seven
//      points, more than most blows are worth. Total soak is capped at the
//      pool now, and the halving decays the UNSPENT remainder instead.
//
// And it is still NOT IN THE CAP: Energy.maxEnergy must not learn about armour
// again — the tests below pin that both ways round.
//
// Everything here runs the SHIPPING functions; the three app.js call sites
// (the slime leech, the monster melee, the archer's arrow) can't be loaded
// headlessly, so they are pinned as source text at the bottom.

// ── The per-piece number ────────────────────────────────────────────────────

test('armor: one piece soaks ITS TIER, whatever slot it is', () => {
  for (let t = 0; t <= 7; t++) {
    assert.eq(armorSlotReduction(t), t, `T${t} soaks ${t}`);
  }
  // Slots are interchangeable: a T4 helmet and a T4 chestplate soak the same.
  // (They differ in PRICE — ARMOR_DEFS.baseCost — not in what they do.)
  for (const slot of Object.keys(ARMOR_DEFS)) {
    assert.eq(armorReduction({ [slot]: { tier: 4 } }), 4, `a T4 ${slot} soaks 4`);
  }
});

test('armor: the soak is LINEAR — it lives on the same scale as the damage', () => {
  // The reason it is not quadratic. Every blow the game can land is a kind's
  // dmg (1..4) doubled for an elite and doubled again on hard: 16 at the very
  // worst. A pool that runs to 196 flattens all of that to the floor from
  // Iron up; one that runs to 28 leaves every rung visible.
  const WORST_BLOW = 16;
  const fullSet = (t) => { const a = {}; for (const s of Object.keys(ARMOR_DEFS)) a[s] = { tier: t }; return a; };
  assert.eq(armorReduction(fullSet(7)), 28, 'the biggest pool in the game is 28');
  assert.lt(armorReduction(fullSet(7)), WORST_BLOW * 2,
    'and it stays within sight of the worst blow — a quadratic pool would be 12x it');
  // Every tier of a SINGLE piece is a distinct answer against that worst blow,
  // which is the property the quadratic version destroyed.
  const seen = new Set();
  for (let t = 0; t <= 7; t++) seen.add(Combat.playerDamage(WORST_BLOW, { helmet: { tier: t } }));
  assert.eq(seen.size, 8, 'all eight rungs of a single piece are distinguishable');
});

test('armor: the pool is the sum over the worn set, and empties cleanly', () => {
  assert.eq(armorReduction(null), 0, 'no armour at all');
  assert.eq(armorReduction({}), 0, 'no armour worn');
  assert.eq(armorReduction({ helmet: null, chest: null, legs: null, boots: null }), 0,
    'four empty slots — the shape savemigrate backfills');
  assert.eq(armorReduction({ helmet: { tier: 1 }, boots: { tier: 2 } }), 1 + 2,
    'additive across slots');
  const full = {};
  for (const slot of Object.keys(ARMOR_DEFS)) full[slot] = { tier: 7 };
  assert.eq(armorReduction(full), 4 * 7, 'a full Frost set is 28');
});

test('armor: a slot or tier the catalog does not know contributes nothing', () => {
  assert.eq(armorReduction({ cloak: { tier: 7 } }), 0, 'there is no cloak slot');
  assert.eq(armorReduction({ helmet: { tier: 99 } }), 0, 'and no tier 99');
  assert.eq(armorReduction({ helmet: { tier: 0 } }), 0, 'tier 0 is not worn armour');
});

// ── The ladder ──────────────────────────────────────────────────────────────

test('armor: the ladder soaks half, halves what is LEFT of the pool, four times', () => {
  // Walked by hand against the rule, so the loop can't quietly change shape.
  // pool 4 vs a 10-damage blow:
  //   round 1  half=5, the pool of 4 covers 4 → 6 left; 0 of the pool
  //            survives, so it halves to 0 and the rest is a no-op
  //                                          → 6
  assert.eq(Combat.mitigate(10, 4), 6, 'the worked example');
  // pool 12 vs the same blow — here the pool OUTLASTS a round, so the halving
  // of the remainder is what is being measured:
  //   round 1  half=5, soak 5 → 5 left; 7 survives, halved → 3
  //   round 2  half=2, soak 2 → 3 left; 1 survives, halved → 0
  //                                    → 3
  assert.eq(Combat.mitigate(10, 12), 3, 'a surviving pool is halved, not re-handed');
  assert.eq(Combat.MITIGATION_ROUNDS, 4, 'four rounds, as specified');
  assert.eq(Combat.MIN_PLAYER_DAMAGE, 1, 'and a floor of one');
});

test('armor: THE POOL IS SPENT, NOT RE-CHARGED — total soak never exceeds it', () => {
  // The bug that made every tier above Wood identical: each round used to be
  // handed the whole halved pool afresh, so a pool of P soaked up to
  // P + P/2 + P/4 + P/8 ≈ 1.9P. A full Wood set (4) took SEVEN points off a
  // blow — more than most blows in this game are worth — and everything from
  // Iron up bottomed out at the floor whatever it cost.
  for (let pool = 0; pool <= 40; pool++) {
    for (let d = 1; d <= 120; d++) {
      const soaked = d - Combat.mitigate(d, pool);
      assert.lte(soaked, pool, `pool ${pool} soaked ${soaked} of a ${d}-damage blow`);
    }
  }
});

test('armor: a T1 piece is a flat −1 on every blow it can bite', () => {
  // The anchor the whole scale hangs off: one Wood piece, one point of damage,
  // every single time. If this stops being exactly −1 the pool has started
  // multiplying itself again.
  for (let d = 2; d <= 400; d++) {
    assert.eq(Combat.mitigate(d, 1), d - 1, `a T1 piece takes exactly 1 off ${d}`);
  }
  assert.eq(Combat.mitigate(1, 1), 1, 'except against a 1-damage hit, which is the floor');
});

test('armor: no armour changes nothing', () => {
  for (const d of [1, 2, 3, 7, 12, 40, 160]) {
    assert.eq(Combat.mitigate(d, 0), d, `${d} through a bare body is ${d}`);
  }
});

test('armor: halves round DOWN, so a small blow is never soaked away', () => {
  // 1 damage: half is 0 every round — the pool never gets to spend a thing.
  assert.eq(Combat.mitigate(1, 1000), 1, 'a 1-damage hit is untouched by any pool');
  // 3 damage (the surface slime's leech) against a lone Wood helmet:
  //   half=1, soak 1 → 2 left; nothing survives, so that is the answer.
  assert.eq(Combat.mitigate(3, 1), 2, 'the slime leech, one Wood piece');
  // 5 damage: 2 soaked, then 1, then 1 → 1.
  assert.eq(Combat.mitigate(5, 1000), 1, '5 → the floor');
});

test('armor: four halvings is the ceiling — an infinite pool still bites', () => {
  // Round-down halving takes a blow d → ceil(d/2) each round, so four rounds
  // can never take it below ceil(ceil(ceil(ceil(d/2)/2)/2)/2). Nothing anyone
  // can wear beats that — armour asymptotes at 1/16th of a blow, never at
  // nothing, so no kit ever makes the player untouchable.
  const ceilFour = (d) => { let x = d; for (let i = 0; i < 4; i++) x = Math.ceil(x / 2); return x; };
  const HUGE = 1e9;
  for (const d of [1, 2, 3, 5, 8, 13, 16, 17, 32, 100, 160]) {
    const floorHit = Math.max(Combat.MIN_PLAYER_DAMAGE, ceilFour(d));
    assert.eq(Combat.mitigate(d, HUGE), floorHit, `${d} bottoms out at ${floorHit}`);
    assert.gte(Combat.mitigate(d, HUGE), Combat.MIN_PLAYER_DAMAGE, 'never zero');
    assert.gte(Combat.mitigate(d, HUGE), d / 16, 'never past 1/16th of the blow');
  }
});

test('armor: more armour is never worse armour', () => {
  // Monotone in the pool at every damage the game can deal — a hard-mode
  // elite giant's melee is well inside this range, and an archer's bundle is
  // mitigated per hit rather than whole.
  for (let d = 1; d <= 60; d++) {
    let prev = Infinity;
    for (let pool = 0; pool <= 200; pool++) {
      const got = Combat.mitigate(d, pool);
      assert.lte(got, prev, `d=${d}: pool ${pool} soaked less than pool ${pool - 1}`);
      prev = got;
    }
  }
});

test('armor: a real ladder of sets against a real blow', () => {
  // A heavy hit (a hard-mode elite's melee is in this range) as the player's
  // kit improves. The point of the table is that the curve is smooth and the
  // endgame is not immunity.
  const setOf = (tier) => {
    const a = {};
    for (const slot of Object.keys(ARMOR_DEFS)) a[slot] = { tier };
    return a;
  };
  // The worst blow in the game — a kind's 4 dmg, doubled elite, doubled hard,
  // then some. EVERY rung has to tell here, or the ladder is decoration.
  const hit = (tier) => Combat.playerDamage(24, tier ? setOf(tier) : null);
  assert.eq(hit(0), 24, 'bare — the whole blow');
  let prev = hit(0);
  for (let t = 1; t <= 7; t++) {
    assert.lt(hit(t), prev, `a T${t} set beats a T${t - 1} one against a heavy blow`);
    prev = hit(t);
  }
  assert.gte(hit(7), Combat.MIN_PLAYER_DAMAGE, 'and a Frost set still gets bitten');
  // A single piece separates every rung too, which is what a player upgrading
  // one slot at a time actually experiences.
  const one = (tier) => Combat.playerDamage(24, { chest: { tier } });
  prev = 24;
  for (let t = 1; t <= 7; t++) { assert.lt(one(t), prev, `one T${t} piece beats one T${t - 1}`); prev = one(t); }
  // The small blows a new player actually meets bottom out fast, and that is
  // right: the surface slime's 3-a-second leech is down to the floor in a full
  // Wood set. Four pieces of armour SHOULD make the weakest foe a non-event.
  assert.eq(Combat.playerDamage(3, setOf(1)), Combat.MIN_PLAYER_DAMAGE,
    'a Wood set already takes the slime leech to 1 — and never past it');
});

test('armor: playerDamage reads the pool off the worn set', () => {
  assert.eq(Combat.playerDamage(10, { helmet: { tier: 2 } }), Combat.mitigate(10, 2),
    'the T2 helmet is a pool of 2');
  assert.eq(Combat.playerDamage(10, null), 10, 'no set = no soak');
  assert.eq(Combat.playerDamage(0, { helmet: { tier: 2 } }), 0,
    'a non-attack is not rounded up to the floor');
});

test('armor: a bundled arrow is soaked PER HIT, not per bundle', () => {
  // A goblin archer's arrow carries MONSTER_ARROW_HITS hits of the table in
  // one projectile so its damage per minute matches the melee cadence it
  // stands in for. Mitigating the lump would hand that parity straight back:
  // one big blow loses proportionally less to a small pool than five small
  // ones do.
  const worn = { helmet: { tier: 1 } };            // a pool of 1
  const perHit = Combat.mitigate(6, 1);
  assert.eq(Combat.playerDamage(30, worn, 5), 5 * perHit,
    'five hits of 6 are soaked five times over');
  assert.lt(Combat.playerDamage(30, worn, 5), Combat.mitigate(30, 1) + 1,
    'and that is strictly kinder than soaking the bundle once');
  assert.eq(Combat.playerDamage(30, worn, 1), Combat.mitigate(30, 1),
    'hits defaults to a single blow');
});

// ── Armour is NOT the energy cap ────────────────────────────────────────────

test('armor: the max-energy cap has no idea armour exists', () => {
  const worn = {};
  for (const slot of Object.keys(ARMOR_DEFS)) worn[slot] = { tier: 7 };
  assert.eq(Energy.maxEnergy({ armor: worn }), STARTING_ENERGY,
    'a full Frost set does not lengthen the bar');
  assert.eq(Energy.maxEnergy({ armor: worn, eaten: ['nut', 'berry'] }), STARTING_ENERGY + 2,
    'only the first-taste bonus moves it');
  // The retired function must not come back under its old name either.
  assert.eq(typeof globalThis.maxEnergyFromArmor, 'undefined',
    'maxEnergyFromArmor is gone, not merely unused');
});

test('armor: no source still folds a gear bonus into the cap', () => {
  assert.falsy(/energyPerTier\s*[:=]/.test(ITEMS_JS_SRC),
    'ARMOR_DEFS carries no per-slot energy number any more');
  assert.falsy(/maxEnergyFromArmor\s*\(/.test(APP_JS_SRC),
    'app.js never asks armour for a cap');
});

// ── The three call sites (app.js can't load headlessly) ─────────────────────

test('armor: every blow on the player is soaked before it reaches the bar', () => {
  const app = APP_JS_SRC;
  // 1. The surface slime's leech.
  assert.truthy(/const slimeDmg = Combat\.playerDamage\(slimeRaw, this\.save\.armor\);/.test(app),
    'the slime leech is mitigated');
  // 2. A cave monster's melee.
  assert.truthy(/const monDmg = Combat\.playerDamage\(shielded, this\.save\.armor\);/.test(app),
    'the monster melee is mitigated');
  // 3. A goblin archer's arrow, per carried hit.
  assert.truthy(/const dmg = Combat\.playerDamage\(shielded, this\.save\.armor, shot\.hits\);/.test(app),
    'the arrow is mitigated per hit');
  // The mode and the potion scale the blow BEFORE armour spends against it,
  // so a hard-mode hit is soaked as a hard-mode hit. Pinned by ordering: the
  // shielded/raw value is computed first at each site.
  assert.truthy(app.indexOf('const slimeRaw =') < app.indexOf('const slimeDmg ='),
    'the mode/potion scaling comes first, armour soaks the result');
});

test('armor: what a piece soaks is printed ON the piece', () => {
  // The description surfaces (CLAUDE.md: what an item DOES is written on the
  // item). Both read armorSlotReduction rather than re-deriving the tier — one
  // table, both sides, so the number shown is the number spent.
  const app = APP_JS_SRC;
  assert.truthy(/armorSlotReduction\(tierOrZero\)/.test(app),
    'the Stats panel row quotes the real per-piece soak');
  assert.truthy(/armorSlotReduction\(offer\.tier\)/.test(app),
    'and so does a shop/castle offer before you buy');
  assert.falsy(/max energy['`]/.test(app.slice(app.indexOf('showStatsModal()'),
                                               app.indexOf('showStatsModal()') + 3000)),
    'no "+N max energy" row survives on an armour slot');
});
