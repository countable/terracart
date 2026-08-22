// The reward for killing a cave monster.
//
// Before this existed a monster dropped NOTHING — you paid the work wheel and
// the energy it drained off you, and got a flash message — so the only rational
// play was to walk around every monster you met. A kill now pays coins, always,
// and one in ten also drops a buried-treasure roll.
//
// The bounty is DERIVED from the kind's `hp` (the same number that sets the
// wheel length) rather than hand-tuned per kind, and these tests pin that
// property, not the individual numbers: a tougher foe must never pay less than
// an easier one, and a kind added to MONSTERS must be priced the moment it has
// stats. MONSTERS / monsterBounty are lifted out of app.js by run.js.

// One shared vm scope holds every *.test.js, so the fixture stays in an IIFE.
(function () {

test('bounty: every monster kind pays something', () => {
  const kinds = Object.keys(MONSTERS);
  assert.gt(kinds.length, 0, 'there are monsters to price');
  for (const k of kinds) {
    assert.gte(monsterBounty(k, 1), 1, `${k} pays at least a coin`);
  }
});

test('bounty: a tougher kind never pays less than an easier one', () => {
  // The whole reason the bounty is derived from hp: hand-tuned numbers drift
  // until the 25-HP goblin quietly pays less than the 6-HP purple slime.
  const byHp = Object.keys(MONSTERS).sort((a, b) => MONSTERS[a].hp - MONSTERS[b].hp);
  for (let i = 1; i < byHp.length; i++) {
    const lo = byHp[i - 1], hi = byHp[i];
    assert.gte(monsterBounty(hi, 1), monsterBounty(lo, 1),
      `${hi} (${MONSTERS[hi].hp}hp) vs ${lo} (${MONSTERS[lo].hp}hp)`);
  }
});

test('bounty: the coins track the HP that sets the wheel length', () => {
  for (const [kind, m] of Object.entries(MONSTERS)) {
    assert.eq(monsterBounty(kind, 0), Math.max(1, Math.round(m.hp * MONSTER_COIN_PER_HP)),
      `${kind} at the surface is its HP share`);
  }
});

test('bounty: descending pays more for the same monster', () => {
  const kind = Object.keys(MONSTERS)[0];
  const shallow = monsterBounty(kind, 1);
  const deep = monsterBounty(kind, 9);
  assert.gt(deep, shallow, 'level 9 beats level 1');
  // A climb, not a jackpot — the depth term must not swamp the kind's own
  // worth, or every monster reads as identical loot at the bottom.
  assert.lt(deep - shallow, 10, 'the depth climb stays a trickle');
});

test('bounty: a depthless or unknown call is still safe', () => {
  const kind = Object.keys(MONSTERS)[0];
  assert.gte(monsterBounty(kind), 1, 'no depth argument');
  assert.gte(monsterBounty(kind, null), 1, 'null depth');
  assert.gte(monsterBounty(kind, -3), 1, 'a negative depth never eats the coins');
  assert.eq(monsterBounty('not_a_monster', 3), 0, 'a non-monster is worth nothing');
});

test('bounty: the treasure drop stays a surprise, not the wage', () => {
  assert.gt(MONSTER_TREASURE_CHANCE, 0, 'it can happen');
  assert.lt(MONSTER_TREASURE_CHANCE, 0.25, 'but rarely enough to stay a surprise');
});

test('bounty: only cave monsters draw one — surface fauna keep their drops', () => {
  // Crow and deer pay in feathers and meat, and the surface slime is a crop
  // pest whose reward is the crop it stops eating. None of them are in
  // MONSTERS, so none of them collect a bounty.
  for (const k of ['crow', 'deer', 'slime', 'cow', 'chicken']) {
    assert.falsy(isMonster(k), `${k} is not a cave monster`);
    assert.eq(monsterBounty(k, 5), 0, `${k} draws no bounty`);
  }
});

})();
