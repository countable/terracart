// The cave-enemy difficulty rule (src/app.js › MONSTERS + CAVE_ENEMY_MUL).
//
// The first slime is the tutorial. The wild surface slime is the only enemy
// above ground and the first one anybody meets — a crop pest you can walk away
// from. Every enemy BEYOND it is underground, met by a player who went looking
// for it, and those are twice the foe: double HP, double damage.
//
// The rule is applied as one multiplier over the authored baseline rather than
// as retuned numbers, so what these tests defend is that it is applied — once,
// to the two stats it is about, and to every kind in the table including any
// added later. run.js lifts both the doubled table and the baseline literal out
// of app.js, so this runs against the real shipping numbers.

// Wrapped in an IIFE: every *.test.js shares one global scope in the runner.
(() => {
  const msKinds = Object.keys(MONSTERS_BASELINE);

  test('cave enemies: the table is authored at a baseline and doubled from it', () => {
    assert.eq(CAVE_ENEMY_MUL, 2, 'double, per the rule');
    assert.gt(msKinds.length, 0, 'there are kinds to check');
    for (const kind of msKinds) {
      const base = MONSTERS_BASELINE[kind], live = MONSTERS[kind];
      assert.truthy(live, `${kind} survives into the live table`);
      assert.eq(live.hp, base.hp * CAVE_ENEMY_MUL, `${kind} hp is doubled`);
      assert.eq(live.dmg, base.dmg * CAVE_ENEMY_MUL, `${kind} dmg is doubled`);
    }
  });

  test('cave enemies: doubling touches HP and damage, nothing else', () => {
    // Range, speed, depth gating and spawn weight are not difficulty knobs the
    // rule is about — doubling a goblin archer's REACH, or its share of the
    // spawn table, would be a different (and much worse) game.
    for (const kind of msKinds) {
      const base = MONSTERS_BASELINE[kind], live = MONSTERS[kind];
      for (const k of ['range', 'speed', 'minDepth', 'weight', 'name']) {
        assert.eq(live[k], base[k], `${kind}.${k} is untouched`);
      }
    }
  });

  test('cave enemies: every one of them hurts, and none is free to kill', () => {
    // A kind added to the table with no stats would slip through the loop as
    // NaN and quietly become unkillable / harmless.
    for (const kind of msKinds) {
      assert.gt(MONSTERS[kind].hp, 0, `${kind} has HP`);
      assert.gt(MONSTERS[kind].dmg, 0, `${kind} deals damage`);
    }
  });

  test('cave enemies: the first slime is NOT one of them', () => {
    // The surface slime is the tutorial fight and keeps its own numbers: it is
    // fauna, not a monster-table kind, so the multiplier can never reach it.
    assert.falsy(MONSTERS.slime, 'the surface slime is not in the monster table');
    assert.eq(Combat.creatureMaxHp('slime'), 15, 'and still has its 15 HP');
  });

  test('cave enemies: a doubled foe still pays a bounty, and a bigger one', () => {
    // monsterBounty derives from hp, so doubling the pool doubles the wage for
    // a fight that now takes twice as long. Relational, not a pinned number.
    for (const kind of msKinds) {
      const base = Math.max(1, Math.round(MONSTERS_BASELINE[kind].hp * MONSTER_COIN_PER_HP));
      assert.gte(monsterBounty(kind, 0), base, `${kind} pays at least what it used to`);
    }
  });
})();
