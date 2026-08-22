// The reward for defeating an ENEMY.
//
// Before this existed a foe dropped NOTHING — you paid the work wheel and the
// energy it drained off you, and got a flash message — so the only rational
// play was to walk around every one you met. A kill now pays coins, always, and
// one in ten cave monsters also drops a buried-treasure roll.
//
// "Always" was once narrower than it sounds: the bounty read the cave-monster
// table, so the SURFACE SLIME — a thing that fights you and eats your crops —
// was fought for free. It is priced off Combat.isEnemyKind now, the one
// definition of "attacks you", so no hostile kind can end up outside the wage
// again. Crow and deer are game, not enemies: they pay in feathers and meat.
//
// The bounty is DERIVED from the kind's `hp` (the same number that sets the
// wheel length) rather than hand-tuned per kind, and these tests pin that
// property, not the individual numbers: a tougher foe must never pay less than
// an easier one, and a kind added to MONSTERS must be priced the moment it has
// stats. MONSTERS / enemyBounty are lifted out of app.js by run.js.

// One shared vm scope holds every *.test.js, so the fixture stays in an IIFE.
(function () {

test('bounty: every monster kind pays something', () => {
  const kinds = Object.keys(MONSTERS);
  assert.gt(kinds.length, 0, 'there are monsters to price');
  for (const k of kinds) {
    assert.gte(enemyBounty(k, 1), 1, `${k} pays at least a coin`);
  }
});

test('bounty: EVERY enemy pays, the surface slime included', () => {
  // The gap this closes. The slime is the one enemy that is not a cave
  // monster, so it is the one a table-driven bounty silently skipped — and
  // it's the first enemy a new player ever fights.
  for (const k of Object.keys(Combat.FAUNA_HP).concat(Object.keys(MONSTERS))) {
    if (!Combat.isEnemyKind(k)) continue;
    assert.gte(enemyBounty(k, 0), 1, `${k} attacks you, so it pays`);
  }
  assert.truthy(Combat.isEnemyKind('slime'), 'the surface slime is an enemy');
  assert.gte(enemyBounty('slime', 0), 1, 'and it draws a bounty like any other');
});

test('bounty: a tougher kind never pays less than an easier one', () => {
  // The whole reason the bounty is derived from hp: hand-tuned numbers drift
  // until the 25-HP goblin quietly pays less than the 6-HP purple slime.
  // Every enemy is ranked together, monsters and the slime alike — they are
  // now on one ladder, so the ordering has to hold across it.
  const kinds = Object.keys(MONSTERS).concat(Object.keys(Combat.FAUNA_HP))
    .filter((k) => Combat.isEnemyKind(k));
  const byHp = kinds.sort((a, b) => Combat.creatureMaxHp(a) - Combat.creatureMaxHp(b));
  for (let i = 1; i < byHp.length; i++) {
    const lo = byHp[i - 1], hi = byHp[i];
    assert.gte(enemyBounty(hi, 1), enemyBounty(lo, 1),
      `${hi} (${Combat.creatureMaxHp(hi)}hp) vs ${lo} (${Combat.creatureMaxHp(lo)}hp)`);
  }
});

test('bounty: the coins track the HP that sets the wheel length', () => {
  for (const [kind, m] of Object.entries(MONSTERS)) {
    assert.eq(enemyBounty(kind, 0), Math.max(1, Math.round(m.hp * ENEMY_COIN_PER_HP)),
      `${kind} at the surface is its HP share`);
  }
  // …and the HP the bounty reads is the HP the FIGHT reads. One source, so a
  // kind's price and the pool you have to chew through can't drift apart.
  for (const kind of Object.keys(MONSTERS).concat(['slime'])) {
    assert.eq(enemyBounty(kind, 0),
      Math.max(1, Math.round(Combat.creatureMaxHp(kind) * ENEMY_COIN_PER_HP)),
      `${kind} is priced off Combat.creatureMaxHp`);
  }
});

test('bounty: the monster table is what combat.js is answering from', () => {
  // enemyBounty asks Combat for HP, and Combat only knows the monster stats
  // because app.js hands the table over. If that registration ever moved out
  // of the lifted block these numbers would all quietly become the fauna
  // ladder's 10-HP default — right here AND in the game.
  for (const [kind, m] of Object.entries(MONSTERS)) {
    assert.eq(Combat.creatureMaxHp(kind), m.hp, `${kind} HP reaches combat.js`);
  }
});

test('bounty: descending pays more for the same monster', () => {
  const kind = Object.keys(MONSTERS)[0];
  const shallow = enemyBounty(kind, 1);
  const deep = enemyBounty(kind, 9);
  assert.gt(deep, shallow, 'level 9 beats level 1');
  // A climb, not a jackpot — the depth term must not swamp the kind's own
  // worth, or every monster reads as identical loot at the bottom.
  assert.lt(deep - shallow, 10, 'the depth climb stays a trickle');
});

test('bounty: the surface adds nothing on top of the kind itself', () => {
  // Depth 0 is where the slime lives, so the depth climb must contribute
  // exactly zero there rather than rounding a free coin into every kill.
  assert.eq(enemyBounty('slime', 0),
    Math.max(1, Math.round(Combat.creatureMaxHp('slime') * ENEMY_COIN_PER_HP)),
    'a surface kill is its HP share and nothing more');
});

test('bounty: a depthless or unknown call is still safe', () => {
  const kind = Object.keys(MONSTERS)[0];
  assert.gte(enemyBounty(kind), 1, 'no depth argument');
  assert.gte(enemyBounty(kind, null), 1, 'null depth');
  assert.gte(enemyBounty(kind, -3), 1, 'a negative depth never eats the coins');
  assert.eq(enemyBounty('not_a_monster', 3), 0, 'a kind nobody has heard of is worth nothing');
});

test('bounty: the treasure drop stays a surprise, not the wage', () => {
  assert.gt(MONSTER_TREASURE_CHANCE, 0, 'it can happen');
  assert.lt(MONSTER_TREASURE_CHANCE, 0.25, 'but rarely enough to stay a surprise');
});

test('bounty: GAME draws none — crow and deer keep their drops', () => {
  // Hunting is a choice, and its reward is the feather or the meat. Livestock
  // aren't fought at all. None of them attack you, so none of them are enemies
  // and none collect a wage.
  for (const k of ['crow', 'deer', 'cow', 'chicken']) {
    assert.falsy(Combat.isEnemyKind(k), `${k} is not an enemy`);
    assert.eq(enemyBounty(k, 5), 0, `${k} draws no bounty`);
  }
});

})();
