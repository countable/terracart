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
//  4. THE STAFF SEEKS, THE BOW DOESN'T. A staff bolt is loosed at the NEAREST
//     enemy in range whatever way the body faces (SHOT.staff.aim), while an
//     arrow still flies down the compass. The staff used to fire along the
//     compass too, and a spell that missed because a phone compass sat a few
//     degrees off read as broken — so the aim mode is pinned, and so is the
//     hold-fire when the nearest foe is beyond the bolt's range (each bolt
//     costs energy; one that could never arrive would just burn it).
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
  // Read the goblin's HP FROM the table rather than pinning a number here: the
  // table is the source (and CAVE_ENEMY_MUL doubles every kind in it), so a
  // literal would only pin how stale this copy is. What is being tested is
  // which source answers, not what the number happens to be.
  assert.eq(Combat.creatureMaxHp('goblin'), MONSTERS.goblin.hp, 'monster table wins');
  assert.eq(Combat.creatureMaxHp('slime'), 15, 'surface slime baseline (fauna, not the table)');
  assert.eq(Combat.creatureMaxHp('dog'), 40, 'pet-combat ladder still answered here');
  assert.eq(Combat.creatureMaxHp('nonesuch'), 10, 'unknown kind falls back');
});

test('combat: HP seeds itself from the kind and floors at zero', () => {
  const full = MONSTERS.goblin.hp;
  const c = { kind: 'goblin', id: 'g1' };
  assert.eq(Combat.hp(c), full, 'first read seeds full HP');
  assert.eq(Combat.damage(c, 10), full - 10, 'damage subtracts');
  assert.eq(Combat.hpFraction(c), (full - 10) / full, 'fraction tracks the pool');
  assert.eq(Combat.damage(c, 9999), 0, 'never goes negative');
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

test('combat: a shot carries its tier\'s FULL melee-equivalent rate, weighted by kind', () => {
  // Only one weapon ever fights at a time (save.activeWeapon, app.js), so a
  // shot no longer splits its rate across the ranged slots — there is nothing
  // to split against once bow and staff can't both be firing. SHOT_DMG_MUL is
  // a deliberate difference in KIND, not a stacking guard: the staff hits
  // double, priced in energy per bolt.
  for (const slot of Combat.RANGED_SLOTS) {
    for (const tier of [1, 4, 7]) {
      const relics = { [slot]: { tier } };
      const want = Math.max(1, Math.round(Combat.dpsForDurationMs(toolDurationMs(relics, slot))
                            * (Combat.SHOT_DMG_MUL[slot] || 1)
                            * Combat.FIRE_INTERVAL_MS / 1000));
      assert.eq(Combat.shotDamage(relics, slot), want,
        `${slot} T${tier} shot should carry its own full, kind-weighted rate`);
    }
  }
  // The ladder in concrete, so a silent regression in TOOL_DURATION_MS or the
  // fire beat shows up as a combat failure too. Wood's rung is 4000 ms, i.e.
  // 3.75 HP/s of melee; over the 2 s beat that's 7.5 per arrow (rounds to 8),
  // and the staff's double weight makes 15.
  assert.eq(Combat.shotDamage({ bow: { tier: 1 } }, 'bow'), 8, 'wood bow');
  assert.eq(Combat.shotDamage({ bow: { tier: 7 } }, 'bow'), 100, 'frost bow');
  assert.eq(Combat.shotDamage({ staff: { tier: 1 } }, 'staff'), 15, 'wood staff — double the arrow');
});

test('combat: the fire beat is 2 s, and the delivered rate is beat-independent', () => {
  // One shot every two seconds — each shot is an event, not a stream. Pinned
  // because shotDamage scales by the interval: changing the beat must change
  // per-shot damage, never the delivered rate.
  assert.eq(Combat.FIRE_INTERVAL_MS, 2000, 'one shot per 2 s');
});

test('combat: staff doubles the bow — per shot and per second', () => {
  for (let tier = 1; tier <= 7; tier++) {
    const bowShot = Combat.shotDamage({ bow: { tier } }, 'bow');
    const staffShot = Combat.shotDamage({ staff: { tier } }, 'staff');
    // Per-shot rounding gives ±1 of slack around the exact 2×.
    assert.lt(Math.abs(staffShot - 2 * bowShot), 1.5,
      `T${tier}: staff shot ${staffShot} should be ~double the arrow's ${bowShot}`);
  }
  // And the staff pays for it: every bolt draws energy; arrows are free.
  assert.eq(Combat.SHOT.staff.energyCost, 1, 'a bolt costs 1 energy');
  assert.falsy(Combat.SHOT.bow.energyCost, 'an arrow costs none');
});

test('combat: staff bolts pierce — every foe on the line is struck once, arrows stop', () => {
  const foes = [
    { kind: 'goblin', id: 'near', x: 15, y: 0 },
    { kind: 'goblin', id: 'far',  x: 35, y: 0 },
  ];
  const run = (slot) => {
    let live = [Combat.spawnShot(slot, 0, 0, { x: 1, y: 0 }, COMBAT_CELL_M, 3)];
    const struck = [];
    let steps = 0;
    while (live.length && steps++ < 6000) {
      live = Combat.stepShots(live, 1 / 60, foes, Combat.HIT_RADIUS_CELLS * COMBAT_CELL_M,
        (e) => struck.push(e.id));
    }
    return struck;
  };
  assert.eq(run('bow').join(','), 'near', 'an arrow stops in the first foe');
  assert.eq(run('staff').join(','), 'near,far', 'a bolt passes through and strikes both, once each');
});

test('combat: staff bolts ignore walls; arrows do not', () => {
  const wallFrom = 2 * COMBAT_CELL_M;
  const wall = { blocked: (x) => x >= wallFrom && x < wallFrom + COMBAT_CELL_M, cellM: COMBAT_CELL_M };
  const behind = { kind: 'goblin', id: 'behind', x: 5 * COMBAT_CELL_M, y: 0 };
  const run = (slot) => {
    let live = [Combat.spawnShot(slot, 0, 0, { x: 1, y: 0 }, COMBAT_CELL_M, 3)];
    let hits = 0, steps = 0;
    while (live.length && steps++ < 6000) {
      live = Combat.stepShots(live, 1 / 60, [behind], Combat.HIT_RADIUS_CELLS * COMBAT_CELL_M,
        () => hits++, wall);
    }
    return hits;
  };
  assert.eq(run('bow'), 0, 'the arrow dies at the rock');
  assert.eq(run('staff'), 1, 'the bolt sails over it');
});

test('combat: a single active bow matches the sword of its tier; the staff doubles it', () => {
  // Exclusivity (only save.activeWeapon fights) is what makes pricing either
  // ranged weapon at its full rate safe: a bow can no longer stack with a
  // staff, so there's nothing left for a split to guard against. The bow
  // lands what a sword of its tier does; the staff lands double, and pays
  // energy per bolt for the difference.
  for (let tier = 1; tier <= 7; tier++) {
    const perSec = 1000 / Combat.FIRE_INTERVAL_MS;
    const bowDps = Combat.shotDamage({ bow: { tier } }, 'bow') * perSec;
    const staffDps = Combat.shotDamage({ staff: { tier } }, 'staff') * perSec;
    const sword = Combat.meleeDps({ sword: { tier } });
    // Per-shot rounding is the only slack: half a point per shot, per beat.
    const slack = 0.5 * perSec + 1e-9;
    assert.lt(Math.abs(bowDps - sword), slack, `T${tier}: bow alone should land what a sword does`);
    assert.lt(Math.abs(staffDps - 2 * sword), 2 * slack, `T${tier}: staff alone should land DOUBLE a sword`);
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

// ── Walls ───────────────────────────────────────────────────────────────────
// A shot used to ignore the world completely, so underground a bow or staff
// fired straight through solid rock: a player could stand facing a blank cave
// wall and clear the tunnel on the other side of it. combat.js knows nothing
// about the map, so the caller hands over the collision test — app.js gives it
// the same one the body walks against.

// A wall band across the flight path, from `x0` to `x1` metres.
const combatWall = (x0, x1) => ({
  blocked: (x) => x >= x0 && x < x1,
  cellM: COMBAT_CELL_M,
});

test('combat: a shot stops at a cave wall instead of flying through it', () => {
  const wallFrom = 4 * COMBAT_CELL_M;               // one cell of rock, 4 cells out
  const behind = { kind: 'goblin', id: 'behind', x: 7 * COMBAT_CELL_M, y: 0 };
  const shot = Combat.spawnShot('bow', 0, 0, { x: 1, y: 0 }, COMBAT_CELL_M, 9);
  let live = [shot], hits = 0, steps = 0;
  while (live.length && steps++ < 6000) {
    live = Combat.stepShots(live, 1 / 60, [behind], Combat.HIT_RADIUS_CELLS * COMBAT_CELL_M,
      () => hits++, combatWall(wallFrom, wallFrom + COMBAT_CELL_M));
  }
  assert.eq(hits, 0, 'the foe in the next tunnel is not hit');
  assert.eq(live.length, 0, 'and the shot is spent, not flying on');
  assert.falsy(shot.x > wallFrom, `stopped at the rock face, not inside it (x=${shot.x})`);
  assert.gt(shot.x, wallFrom - COMBAT_CELL_M, 'and it did fly up to the wall');
});

test('combat: the wall only shields what is behind it', () => {
  // The foe standing in front of the same wall is still perfectly shootable —
  // the rule is line of fire, not "no shooting near walls".
  const wallFrom = 4 * COMBAT_CELL_M;
  const inFront = { kind: 'goblin', id: 'front', x: 2 * COMBAT_CELL_M, y: 0 };
  let live = [Combat.spawnShot('bow', 0, 0, { x: 1, y: 0 }, COMBAT_CELL_M, 9)];
  let hits = 0, steps = 0;
  while (live.length && steps++ < 6000) {
    live = Combat.stepShots(live, 1 / 60, [inFront], Combat.HIT_RADIUS_CELLS * COMBAT_CELL_M,
      () => hits++, combatWall(wallFrom, wallFrom + COMBAT_CELL_M));
  }
  assert.eq(hits, 1, 'the foe on this side of the wall takes it');
});

test('combat: a long frame cannot step over a wall', () => {
  // dt is whatever the browser hands us — a backgrounded tab or a stalled
  // frame can deliver a step several cells long. Sampling the segment (rather
  // than testing only where the shot lands) is what keeps rock solid then.
  const wallFrom = 3 * COMBAT_CELL_M;
  const behind = { kind: 'goblin', id: 'behind', x: 6 * COMBAT_CELL_M, y: 0 };
  const shot = Combat.spawnShot('bow', 0, 0, { x: 1, y: 0 }, COMBAT_CELL_M, 9);
  // One second of flight is 4.5 cells — clean over a one-cell wall in a single
  // step if the flight weren't sampled.
  const live = Combat.stepShots([shot], 1, [behind], Combat.HIT_RADIUS_CELLS * COMBAT_CELL_M,
    () => { throw new Error('a shot reached through the wall'); },
    combatWall(wallFrom, wallFrom + COMBAT_CELL_M));
  assert.eq(live.length, 0, 'the shot died at the wall');
  assert.falsy(shot.x > wallFrom, `and never crossed it (x=${shot.x})`);
});

test('combat: a ranged monster needs the same clear line you do', () => {
  // The goblin archer reaches 3 cells. Through rock that is a foe you often
  // cannot see draining your energy from inside a wall — the exact shot the
  // player was just stopped from taking.
  const wall = (x) => x >= 2 * COMBAT_CELL_M && x < 3 * COMBAT_CELL_M;
  assert.falsy(Combat.lineOfFire(0, 0, 4 * COMBAT_CELL_M, 0, wall, COMBAT_CELL_M),
    'no shot through the wall');
  assert.truthy(Combat.lineOfFire(0, 0, 1.5 * COMBAT_CELL_M, 0, wall, COMBAT_CELL_M),
    'a clear three cells is still a clear shot');
  // Around it: the wall is one band, so a line that never crosses it is clear.
  assert.truthy(Combat.lineOfFire(0, 0, 0, 4 * COMBAT_CELL_M, wall, COMBAT_CELL_M),
    'a line that misses the rock is clear');
});

test('combat: line of fire holds at the endpoints and with no world test', () => {
  // The two bodies are standing on floor by definition, so their own cells
  // never block. And with no test supplied nothing blocks at all (the surface).
  const everywhere = () => true;
  assert.truthy(Combat.lineOfFire(0, 0, 0, 0, everywhere, COMBAT_CELL_M),
    'a foe on top of you is not shielded by its own cell');
  assert.truthy(Combat.lineOfFire(0, 0, 50, 0, null, COMBAT_CELL_M), 'no test → clear');
});

test('combat: with no world test a shot is unobstructed (the surface)', () => {
  // Above ground nothing stops an arrow — you can shoot over a fence, a hedge
  // or a river — so app.js hands over a test that always answers false there.
  // Passing no test at all must behave the same way.
  const foe = { kind: 'goblin', id: 'g1', x: 5 * COMBAT_CELL_M, y: 0 };
  let live = [Combat.spawnShot('bow', 0, 0, { x: 1, y: 0 }, COMBAT_CELL_M, 9)];
  let hits = 0, steps = 0;
  while (live.length && steps++ < 6000) {
    live = Combat.stepShots(live, 1 / 60, [foe], Combat.HIT_RADIUS_CELLS * COMBAT_CELL_M,
      () => hits++, { blocked: () => false, cellM: COMBAT_CELL_M });
  }
  assert.eq(hits, 1, 'a shot that is never blocked still hits');
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

// ── Aiming: the staff seeks, the bow doesn't ────────────────────────────────

test('combat: the staff aims at the nearest foe, the bow along the compass', () => {
  assert.eq(Combat.SHOT.staff.aim, 'nearest', 'the staff seeks');
  assert.eq(Combat.SHOT.bow.aim, 'compass', 'the bow is aimed by turning');
  const near = { kind: 'goblin', id: 'near', x: 0,  y: -14 };   // two cells north
  const far  = { kind: 'goblin', id: 'far',  x: 28, y: 0 };     // four cells east
  const facing = { x: 1, y: 0 };                                // body faces east
  const bow = Combat.shotHeading('bow', 0, 0, facing, [far, near], COMBAT_CELL_M);
  assert.eq(bow, facing, 'the bow fires where the compass points, foes or not');
  const staff = Combat.shotHeading('staff', 0, 0, facing, [far, near], COMBAT_CELL_M);
  assert.truthy(staff && staff.x === 0 && staff.y === -14,
    'the staff turns its back on the compass and lines up on the nearest foe');
});

test('combat: a staff bolt lands on the nearest foe, not the one you face', () => {
  const near = { kind: 'goblin', id: 'near', x: 0,  y: -14 };
  const far  = { kind: 'goblin', id: 'far',  x: 28, y: 0 };
  const heading = Combat.shotHeading('staff', 0, 0, { x: 1, y: 0 }, [far, near], COMBAT_CELL_M);
  let live = [Combat.spawnShot('staff', 0, 0, heading, COMBAT_CELL_M, 3)];
  const struck = [];
  while (live.length) {
    live = Combat.stepShots(live, 1 / 60, [near, far], Combat.HIT_RADIUS_CELLS * COMBAT_CELL_M,
      (e) => struck.push(e.id));
  }
  assert.eq(struck.join(','), 'near', 'the bolt went north to the near foe and never east');
});

test('combat: the staff holds fire while the nearest foe is beyond its range', () => {
  const beyond = { kind: 'goblin', id: 'b', x: (Combat.SHOT.staff.rangeCells + 1) * COMBAT_CELL_M, y: 0 };
  assert.eq(Combat.shotHeading('staff', 0, 0, { x: 1, y: 0 }, [beyond], COMBAT_CELL_M), null,
    'no heading → no bolt, no energy spent');
  const inside = { kind: 'goblin', id: 'i', x: (Combat.SHOT.staff.rangeCells - 1) * COMBAT_CELL_M, y: 0 };
  assert.truthy(Combat.shotHeading('staff', 0, 0, { x: 1, y: 0 }, [beyond, inside], COMBAT_CELL_M),
    'one steps inside → it fires');
  assert.eq(Combat.shotHeading('staff', 0, 0, { x: 1, y: 0 }, [], COMBAT_CELL_M), null,
    'nothing on screen → nothing to aim at');
  assert.eq(Combat.aimAtNearest(5, 5, [{ x: 5, y: 5 }]), null,
    'a foe standing on your feet gives no direction, and no shot stuck on them');
});

test('combat: the staff still needs no compass at all', () => {
  // A player whose phone has no heading yet (facing zero-length) can still
  // cast: the staff's heading comes from the foe, not the sensor.
  const foe = { kind: 'goblin', id: 'f', x: 14, y: 14 };
  const h = Combat.shotHeading('staff', 0, 0, { x: 0, y: 0 }, [foe], COMBAT_CELL_M);
  assert.truthy(h && Combat.spawnShot('staff', 0, 0, h, COMBAT_CELL_M, 1), 'fires with a dead compass');
  assert.eq(Combat.spawnShot('bow', 0, 0, Combat.shotHeading('bow', 0, 0, { x: 0, y: 0 }, [foe], COMBAT_CELL_M), COMBAT_CELL_M, 1),
    null, 'the bow, with no heading, still cannot');
});

// ── Bolt size by tier ───────────────────────────────────────────────────────

test('combat: a staff bolt grows with the tier, Wood base to double at Frost', () => {
  assert.eq(Combat.boltScale('staff', 1), 1, 'Wood is the base size');
  assert.eq(Combat.boltScale('staff', Combat.MAX_TIER), Combat.BOLT_MAX_TIER_MUL, 'Frost is the cap');
  let prev = 0;
  for (let t = 1; t <= Combat.MAX_TIER; t++) {
    const sc = Combat.boltScale('staff', t);
    assert.truthy(sc > prev, `tier ${t} is bigger than tier ${t - 1}`);
    prev = sc;
  }
  assert.eq(Combat.boltScale('staff', undefined), 1, 'no tier → Wood');
  assert.eq(Combat.boltScale('staff', 99), Combat.BOLT_MAX_TIER_MUL, 'over the top clamps to Frost');
  assert.eq(Combat.boltScale('bow', 7), 1, 'an arrow is an arrow at every tier');
});

test('combat: the radius a bolt HITS with and the radius it DRAWS share one scale', () => {
  const wood  = Combat.spawnShot('staff', 0, 0, { x: 1, y: 0 }, COMBAT_CELL_M, 1, 1);
  const frost = Combat.spawnShot('staff', 0, 0, { x: 1, y: 0 }, COMBAT_CELL_M, 1, 7);
  assert.inRange(wood.radiusM - Combat.HIT_RADIUS_CELLS * COMBAT_CELL_M, -1e-9, 1e-9,
    'a Wood bolt sweeps the old flat hit radius');
  assert.inRange(wood.dotPx - Combat.SHOT.staff.dotPx, -1e-9, 1e-9, 'and draws at the base dot');
  const mul = Combat.BOLT_MAX_TIER_MUL;
  assert.inRange(frost.radiusM / wood.radiusM - mul, -1e-9, 1e-9, 'Frost sweeps ×mul');
  assert.inRange(frost.dotPx / wood.dotPx - mul, -1e-9, 1e-9, 'and draws ×mul — the same number');
  const arrow = Combat.spawnShot('bow', 0, 0, { x: 1, y: 0 }, COMBAT_CELL_M, 1, 7);
  assert.inRange(arrow.radiusM - Combat.HIT_RADIUS_CELLS * COMBAT_CELL_M, -1e-9, 1e-9,
    'a Frost arrow still sweeps the flat compass radius');
  assert.eq(arrow.dotPx, 0, 'an arrow is a streak, not a dot');
});

test('combat: a Frost bolt sweeps up a foe a Wood bolt flies past', () => {
  // A foe standing 1.5 cells off the line: outside a Wood bolt's 0.9-cell
  // sweep, inside a Frost bolt's 1.8.
  const off = { kind: 'goblin', id: 'off', x: 28, y: 1.5 * COMBAT_CELL_M };
  const fly = (tier) => {
    let live = [Combat.spawnShot('staff', 0, 0, { x: 1, y: 0 }, COMBAT_CELL_M, 1, tier)];
    const struck = [];
    while (live.length) {
      live = Combat.stepShots(live, 1 / 60, [off], Combat.HIT_RADIUS_CELLS * COMBAT_CELL_M,
        (e) => struck.push(e.id));
    }
    return struck.join(',');
  };
  assert.eq(fly(1), '', 'Wood: a miss');
  assert.eq(fly(7), 'off', 'Frost: the wider bolt catches it — its own radius wins over the flat one handed in');
});

// ── Health ring ─────────────────────────────────────────────────────────────

test('combat: the health tint reads full → hurt → nearly dead', () => {
  const full = Combat.healthColor(1);
  const hurt = Combat.healthColor(0.4);
  const dying = Combat.healthColor(0.1);
  assert.truthy(full !== hurt && hurt !== dying && full !== dying,
    'three distinct bands — the ring has to say how the fight is going');
});
