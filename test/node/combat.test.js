// combat.test.js — the fight maths in src/combat.js.
//
// What this suite is defending:
//
//  1. KILL TIMES WERE INHERITED, NOT RE-TUNED. The old fight was a timer that
//     ran for `toolDurationMs × hp/15`. When it became hit points, the damage
//     rate had to be chosen so the same weapon still takes the same time to
//     kill the same foe. That identity (dps = 15000/durMs) is the whole reason
//     the ladder is derived rather than hand-picked, so it is pinned here — if
//     someone "tunes" combat by editing a number in combat.js, these fail.
//
//  2. THE ENEMY SET IS NOT THE DEFEATABLE SET. Crows and deer are defeatable
//     but are NOT enemies: nothing auto-fires at them and no shot can hit
//     them, so hunting stays a deliberate tap. A slime TAMED with a sapphire
//     (id 'released_…') is a pet and must never be shot at either. Both were
//     easy to get wrong, and getting either wrong turns the auto-fire into
//     something that kills your pets and your game while you walk past.
//
//  3. A SHOT THAT PASSES A FOE HITS IT, AND A SHOT THAT DOESN'T, DOESN'T —
//     including at range, where the compass heading is coarse.
//
// The monster stat table lives in app.js, which this headless runner doesn't
// load — but run.js lifts the table out as text and registers it through the
// same seam app.js uses, so the REAL one is already in hand here.
//
// This file used to register a synthetic three-kind copy instead. Every test
// file shares one vm scope and this one loads early, so that copy overwrote the
// real registration for the whole suite, and any later test that asked Combat
// how much HP a monster had got an answer from a hand-written stand-in. Assert
// the real table arrived rather than replacing it.
if (!MONSTERS || !MONSTERS.goblin) throw new Error('run.js did not lift the MONSTERS table');
if (Combat.creatureMaxHp('goblin') !== MONSTERS.goblin.hp) {
  throw new Error('combat.js is not answering from the real MONSTERS table — '
    + 'run.js must register it, and nothing may register a copy over it');
}

const COMBAT_CELL_M = 7;

// ── Enemy classification ────────────────────────────────────────────────────

test('combat: cave monsters and the wild slime are enemies', () => {
  for (const kind of ['cave_slime', 'purple_slime', 'goblin', 'slime']) {
    assert.truthy(Combat.isEnemyKind(kind), `${kind} should be an enemy kind`);
  }
});

test('combat: game and livestock are NOT enemies (hunting stays a tap)', () => {
  for (const kind of ['crow', 'deer', 'rabbit', 'chicken', 'cow', 'cat', 'dog', 'butterfly']) {
    assert.truthy(!Combat.isEnemyKind(kind), `${kind} must not be shot at`);
  }
});

test('combat: a TAMED slime is a pet, not a target', () => {
  assert.truthy(Combat.isEnemy({ kind: 'slime', id: 'slime_7' }), 'a wild slime is a foe');
  assert.truthy(!Combat.isEnemy({ kind: 'slime', id: 'released_slime_7' }),
    'a sapphire-tamed slime must never be auto-fired at');
});

// ── HP ──────────────────────────────────────────────────────────────────────

test('combat: max HP comes from the monster table, then the fauna ladder', () => {
  assert.eq(Combat.creatureMaxHp('goblin'), 25, 'monster table wins');
  assert.eq(Combat.creatureMaxHp('slime'), 15, 'surface slime baseline');
  assert.eq(Combat.creatureMaxHp('dog'), 40, 'pet-combat ladder still answered here');
  assert.eq(Combat.creatureMaxHp('nonesuch'), 10, 'unknown kind falls back');
});

test('combat: HP seeds itself from the kind and floors at zero', () => {
  const c = { kind: 'goblin', id: 'g1' };
  assert.eq(Combat.hp(c), 25, 'first read seeds full HP');
  assert.eq(Combat.damage(c, 10), 15, 'damage subtracts');
  assert.eq(Combat.hpFraction(c), 15 / 25, 'fraction tracks the pool');
  assert.eq(Combat.damage(c, 999), 0, 'never goes negative');
  assert.eq(Combat.hpFraction(c), 0, 'a dead foe reads empty, not negative');
});

// ── The inherited kill-time identity ────────────────────────────────────────

test('combat: melee dps reproduces the OLD timed wheel exactly', () => {
  // Old wheel: toolDurationMs(relics,'sword') × hp/15 ms to kill an hp-point
  // foe. New: hp / meleeDps(relics) seconds. They must agree for every tier
  // AND for bare hands.
  for (const tier of [0, 1, 2, 3, 4, 5, 6, 7]) {
    const relics = tier ? { sword: { tier } } : {};
    const durMs = toolDurationMs(relics, tier ? 'sword' : null);
    for (const hp of [6, 15, 25]) {
      const oldMs = durMs * (hp / 15);
      const newMs = (hp / Combat.meleeDps(relics)) * 1000;
      assert.inRange(newMs - oldMs, -0.001, 0.001,
        `tier ${tier} vs ${hp} HP: ${newMs} ms should match the old ${oldMs} ms`);
    }
  }
});

test('combat: bow and staff no longer shorten the melee wheel', () => {
  // They shoot instead — a player carrying only ranged weapons swings at the
  // bare-handed rung, and the shots are what make up the difference.
  const bare = Combat.meleeDps({});
  assert.eq(Combat.meleeDps({ bow: { tier: 7 }, staff: { tier: 7 } }), bare,
    'ranged weapons must not feed melee');
  assert.truthy(Combat.meleeDps({ sword: { tier: 1 } }) > bare, 'a sword does');
});

test('combat: a shot carries its tier\'s melee rate SPLIT across the ranged slots', () => {
  for (const slot of Combat.RANGED_SLOTS) {
    for (const tier of [1, 4, 7]) {
      const relics = { [slot]: { tier } };
      const want = Math.max(1, Math.round(Combat.dpsForDurationMs(toolDurationMs(relics, slot))
                            / Combat.RANGED_SLOTS.length * Combat.FIRE_INTERVAL_MS / 1000));
      assert.eq(Combat.shotDamage(relics, slot), want,
        `${slot} T${tier} shot should carry its share of its own rate`);
    }
  }
  // Wood → 2, frost → 25: the ladder in concrete, so a silent regression in
  // TOOL_DURATION_MS shows up as a combat failure too. Wood's rung is 4000 ms,
  // i.e. 3.75 HP/s of melee; halved across bow+staff that is 1.875, which the
  // per-shot rounding in shotDamage carries to 2.
  assert.eq(Combat.shotDamage({ bow: { tier: 1 } }, 'bow'), 2, 'wood bow');
  assert.eq(Combat.shotDamage({ bow: { tier: 7 } }, 'bow'), 25, 'frost bow');
});

test('combat: the whole ranged loadout equals ONE melee weapon of its tier', () => {
  // The point of the split. Shots fire themselves, from across the screen,
  // while you walk — and the slots stack. Carrying every ranged weapon there
  // is must therefore land what a single sword of that tier lands, not one
  // sword per slot. Checked against the melee rate the sword itself reads.
  for (let tier = 1; tier <= 7; tier++) {
    const relics = {};
    for (const slot of Combat.RANGED_SLOTS) relics[slot] = { tier };
    const loadout = Combat.RANGED_SLOTS
      .reduce((sum, slot) => sum + Combat.shotDamage(relics, slot), 0)
      * (1000 / Combat.FIRE_INTERVAL_MS);
    const sword = Combat.meleeDps({ sword: { tier } });
    // Per-shot rounding is the only slack: at most half a point per slot, per
    // second. Anything wider than that means the split has drifted.
    const slack = Combat.RANGED_SLOTS.length * 0.5 * (1000 / Combat.FIRE_INTERVAL_MS);
    assert.lt(Math.abs(loadout - sword), slack + 1e-9,
      `T${tier}: every ranged weapon at once lands ${loadout}/s against a sword's ${sword}/s`);
  }
});

test('combat: a single ranged weapon is worth LESS than the sword of its tier', () => {
  // The complaint this split answers: a wooden bow was killing as fast as a
  // wooden sword while asking nothing of the player. Pinned as an inequality
  // rather than a number so retuning TOOL_DURATION_MS can't quietly undo it.
  for (let tier = 1; tier <= 7; tier++) {
    const dps = Combat.shotDamage({ bow: { tier } }, 'bow') * (1000 / Combat.FIRE_INTERVAL_MS);
    assert.lt(dps, Combat.meleeDps({ sword: { tier } }),
      `a T${tier} bow alone should not match a T${tier} sword`);
  }
});

test('combat: an empty weapon slot fires nothing at all', () => {
  assert.eq(Combat.shotDamage({}, 'bow'), 0, 'no bow, no arrows');
  assert.eq(Combat.shotDamage({ sword: { tier: 7 } }, 'staff'), 0, 'a sword is not a staff');
});

// ── Shots in flight ─────────────────────────────────────────────────────────

test('combat: a shot flies along the compass heading, normalised', () => {
  // A heading need not arrive as a unit vector (this.facing is smoothed), and
  // an un-normalised one would make shot speed depend on sensor magnitude.
  const s = Combat.spawnShot('bow', 0, 0, { x: 0, y: 3 }, COMBAT_CELL_M, 5);
  assert.inRange(Math.hypot(s.vx, s.vy) - 1, -1e-9, 1e-9, 'heading normalised');
  Combat.stepShots([s], 1, [], 99, () => {});
  assert.inRange(s.y - Combat.SHOT.bow.speedCps * COMBAT_CELL_M, -1e-9, 1e-9,
    'one second of flight = one second of speed, due south');
  assert.inRange(s.x, -1e-9, 1e-9, 'no drift off the heading');
});

test('combat: a zero-length heading refuses to fire (no shot stuck on your feet)', () => {
  assert.eq(Combat.spawnShot('bow', 0, 0, { x: 0, y: 0 }, COMBAT_CELL_M, 5), null, 'zero heading');
  assert.eq(Combat.spawnShot('bow', 0, 0, null, COMBAT_CELL_M, 5), null, 'missing heading');
});

test('combat: a shot hits the foe it passes and is consumed', () => {
  const foe = { kind: 'goblin', id: 'g1', x: 20, y: 0 };
  const shot = Combat.spawnShot('bow', 0, 0, { x: 1, y: 0 }, COMBAT_CELL_M, 9);
  const hits = [];
  let live = [shot];
  // Step in 60 fps slices until it either hits or flies out its range.
  for (let i = 0; i < 600 && live.length; i++) {
    live = Combat.stepShots(live, 1 / 60, [foe], Combat.HIT_RADIUS_CELLS * COMBAT_CELL_M,
      (e, s) => hits.push([e, s]));
  }
  assert.eq(hits.length, 1, 'exactly one hit');
  assert.eq(hits[0][0], foe, 'on the foe in the way');
  assert.eq(hits[0][1].damage, 9, 'carrying its damage');
  assert.eq(live.length, 0, 'and the shot is spent');
});

test('combat: a shot that misses expires at its range instead of flying forever', () => {
  const foe = { kind: 'goblin', id: 'g1', x: 20, y: 40 };   // well off the heading
  let live = [Combat.spawnShot('bow', 0, 0, { x: 1, y: 0 }, COMBAT_CELL_M, 9)];
  let hits = 0;
  let steps = 0;
  while (live.length && steps++ < 6000) {
    live = Combat.stepShots(live, 1 / 60, [foe], Combat.HIT_RADIUS_CELLS * COMBAT_CELL_M, () => hits++);
  }
  assert.eq(hits, 0, 'nothing hit');
  assert.eq(live.length, 0, 'the shot expired');
  assert.truthy(steps < 6000, 'and it expired promptly, at its range');
});

test('combat: the hit box is forgiving enough for a phone compass', () => {
  // The heading comes off a device compass, so a strict hit box would read as
  // "the bow is broken". A foe 8 cells out must still be hit from a few
  // degrees off — but a foe a couple of cells to the SIDE must not be.
  const rangeM = Combat.SHOT.bow.rangeCells * COMBAT_CELL_M;
  const fire = (aimDeg, foe) => {
    const a = aimDeg * Math.PI / 180;
    let live = [Combat.spawnShot('bow', 0, 0, { x: Math.cos(a), y: Math.sin(a) }, COMBAT_CELL_M, 1)];
    let hit = false;
    while (live.length) {
      live = Combat.stepShots(live, 1 / 60, [foe], Combat.HIT_RADIUS_CELLS * COMBAT_CELL_M,
        () => { hit = true; });
    }
    return hit;
  };
  const far = { kind: 'goblin', id: 'g1', x: rangeM * 0.9, y: 0 };
  assert.truthy(fire(0, far), 'dead-on hits');
  assert.truthy(fire(4, far), '4° off still hits a foe near max range');
  assert.truthy(!fire(45, far), '45° off misses — aim still matters');
  // Two cells to the side, dead ahead aim: a clean miss.
  assert.truthy(!fire(0, { kind: 'goblin', id: 'g2', x: rangeM * 0.5, y: 2 * COMBAT_CELL_M }),
    'a foe two cells off the line is not hit');
});

test('combat: the nearest foe on the line takes the shot', () => {
  const near = { kind: 'goblin', id: 'near', x: 15, y: 0 };
  const far  = { kind: 'goblin', id: 'far',  x: 40, y: 0 };
  let live = [Combat.spawnShot('bow', 0, 0, { x: 1, y: 0 }, COMBAT_CELL_M, 3)];
  const struck = [];
  while (live.length) {
    live = Combat.stepShots(live, 1 / 60, [near, far], Combat.HIT_RADIUS_CELLS * COMBAT_CELL_M,
      (e) => struck.push(e.id));
  }
  assert.eq(struck.join(','), 'near', 'the front rank takes it, and it stops there');
});

// ── Health ring ─────────────────────────────────────────────────────────────

test('combat: the health tint reads full → hurt → nearly dead', () => {
  const full = Combat.healthColor(1);
  const hurt = Combat.healthColor(0.4);
  const dying = Combat.healthColor(0.1);
  assert.truthy(full !== hurt && hurt !== dying && full !== dying,
    'three distinct bands — the ring has to say how the fight is going');
});
