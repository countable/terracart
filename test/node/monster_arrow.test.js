// monster_arrow.test.js — the goblin archer shoots a visible arrow at the player.
//
// What this suite is defending:
//
//  1. A RANGED MONSTER'S ARROW IS A BOW ARROW AT THE TURRET'S CADENCE. It is
//     spawned through the same spawnShot the player and the turrets use
//     (same speed, range, streak; stops in rock) and fires once per
//     MONSTER_SHOT_INTERVAL_MS, which IS the turret's interval.
//
//  2. THE LANES NEVER MIX. A hostile shot sweeps the PLAYER (stepShots'
//     opts.hostileTargets) and never the enemy list; a friendly shot sweeps
//     enemies and never the player — whatever order they sit in.
//
//  3. THE HIT LANDS ON THE PLAYER'S ENERGY, through _shotHitsPlayer, with the
//     shield potion applied at impact — pinned as app.js source text, along
//     with the archer branch firing INSTEAD of the melee leech.

(function () {
const CELL = 7;
const goblin = (id, x, y) => ({ kind: 'goblin', id, x, y });
const player = (x, y) => ({ id: 'player', x, y });
const flyAll = (shots, enemies, hostile, onHit) => {
  let live = shots;
  let guard = 0;
  while (live.length && guard++ < 10000) {
    live = Combat.stepShots(live, 1 / 60, enemies, Combat.HIT_RADIUS_CELLS * CELL, onHit,
      { cellM: CELL, hostileTargets: hostile });
  }
  return live;
};

test('monster arrow: a bow arrow, hostile, at the turret cadence, one hit of the table', () => {
  assert.eq(Combat.MONSTER_SHOT_INTERVAL_MS, Combat.TURRET.fireIntervalMs,
    'an archer and a turret trade arrows at the same pace');
  const shot = Combat.monsterShot(0, 0, 3 * CELL, 0, CELL, 6);
  assert.truthy(shot, 'fires');
  assert.eq(shot.slot, 'bow', 'a bow arrow');
  assert.truthy(shot.hostile, 'flagged hostile');
  assert.eq(shot.damage, 6, 'carries the damage it was handed — the kind\'s dmg');
  assert.eq(shot.speedMps, Combat.SHOT.bow.speedCps * CELL, 'the bow\'s speed');
  assert.eq(shot.rangeM, Combat.SHOT.bow.rangeCells * CELL, 'the bow\'s range');
  assert.falsy(shot.pierce, 'stops in the first thing it hits');
  assert.truthy(shot.vx === 1 && shot.vy === 0, 'lined up on the player');
  assert.eq(shot.aimDistM, 3 * CELL, 'aim distance stamped');
  assert.eq(shot.color, Combat.HOSTILE_ARROW_COLOR, 'drawn in the hostile colour');
  assert.truthy(shot.color !== Combat.SHOT.bow.color, 'which is not the player\'s arrow colour');
  assert.eq(Combat.monsterShot(5, 5, 5, 5, CELL, 6), null, 'an archer standing on the player has no heading');
});

test('monster arrow: a hostile shot hits the player and never the pack', () => {
  const me = player(3 * CELL, 0);
  const packmate = goblin('mate', 1.5 * CELL, 0);      // stands right on the line of fire
  const shot = Combat.monsterShot(0, 0, me.x, me.y, CELL, 6);
  const hits = [];
  flyAll([shot], [packmate], [me], (t, s) => hits.push(t.id + ':' + (s.hostile ? 'hostile' : 'friendly')));
  assert.eq(hits.join(','), 'player:hostile', 'the arrow flew through its packmate and struck the player');
});

test('monster arrow: a friendly shot never hits the player, even fired straight at them', () => {
  const me = player(3 * CELL, 0);
  const foe = goblin('f', 6 * CELL, 0);
  const shot = Combat.spawnShot('bow', 0, 0, { x: 1, y: 0 }, CELL, 5);
  const hits = [];
  flyAll([shot], [foe], [me], (t) => hits.push(t.id));
  assert.eq(hits.join(','), 'f', 'passes the player marker on the way and strikes the foe');
});

test('monster arrow: both lanes in one list, each finds only its own target', () => {
  const me = player(4 * CELL, 0);
  const foe = goblin('f', 4 * CELL, 4 * CELL);
  const hostile = Combat.monsterShot(0, 0, me.x, me.y, CELL, 6);
  const friendly = Combat.spawnShot('bow', 0, 0, { x: 1, y: 1 }, CELL, 5);
  const hits = [];
  flyAll([friendly, hostile], [foe], [me], (t, s) => hits.push((s.hostile ? 'H>' : 'F>') + t.id));
  assert.eq(hits.sort().join(','), 'F>f,H>player');
});

test('monster arrow: with no player target handed over it flies its range harmlessly', () => {
  const shot = Combat.monsterShot(0, 0, 3 * CELL, 0, CELL, 6);
  const hits = [];
  const left = flyAll([shot], [goblin('f', 3 * CELL, 0)], undefined, (t) => hits.push(t.id));
  assert.eq(hits.length, 0, 'nothing struck — not even the foe standing where the player was');
  assert.eq(left.length, 0, 'spent at range');
});

test('monster arrow: a hostile arrow stops in rock like any other', () => {
  const me = player(4 * CELL, 0);
  const shot = Combat.monsterShot(0, 0, me.x, me.y, CELL, 6);
  const wall = (x) => x >= 2 * CELL && x < 3 * CELL;
  const hits = [];
  let live = [shot];
  let guard = 0;
  while (live.length && guard++ < 10000) {
    live = Combat.stepShots(live, 1 / 60, [], Combat.HIT_RADIUS_CELLS * CELL, (t) => hits.push(t.id),
      { cellM: CELL, hostileTargets: [me], blocked: (x) => wall(x) });
  }
  assert.eq(hits.length, 0, 'the wall took it');
});

// ── The app.js call sites ───────────────────────────────────────────────────
test('monster arrow: app.js — a ranged kind shoots instead of leeching, and the hit lands on energy', () => {
  const app = APP_JS_SRC;
  assert.truthy(/if \(clear && m\.range > 1 && ddx \* ddx \+ ddy \* ddy <= R \* R\s*\n\s*&& \(!c\._nextShotT \|\| now >= c\._nextShotT\)\) \{/.test(app),
    'a ranged monster fires on its own clock, inside its range, with a clear line');
  assert.truthy(/c\._nextShotT = now \+ Combat\.MONSTER_SHOT_INTERVAL_MS;/.test(app),
    'at the turret cadence');
  // The slower cadence costs no damage per minute: one arrow carries the hits
  // the leech would have landed in the same time, derived from the two
  // cadences rather than typed in.
  assert.truthy(/const MONSTER_ARROW_HITS = Combat\.MONSTER_SHOT_INTERVAL_MS \/ MONSTER_HIT_MS;/.test(app),
    'MONSTER_ARROW_HITS is the ratio of the two cadences');
  assert.truthy(/const dmg = m\.dmg \* MONSTER_ARROW_HITS \* Combat\.eliteMul\(c\) \* Difficulty\.get\(\)\.enemyDmgMul;/.test(app),
    'and the arrow carries that many hits');
  const hitMs = Number(app.match(/const MONSTER_HIT_MS = (\d+);/)[1]);
  assert.eq(Combat.MONSTER_SHOT_INTERVAL_MS / hitMs, 5, 'five hits an arrow at today\'s cadences');
  assert.truthy(/const shot = Combat\.monsterShot\(c\.x, c\.y, px, py, this\.cellM, dmg, MONSTER_ARROW_HITS\);\s*\n\s*if \(shot\) this\._shots\.push\(shot\);/.test(app),
    'the arrow joins the one shot list, carrying its hit COUNT as well as its damage');
  assert.truthy(/\} else if \(clear && m\.range <= 1 && ddx \* ddx \+ ddy \* ddy <= R \* R/.test(app),
    'the melee leech is now for range-1 kinds only — an archer never double-dips');
  assert.truthy(/const playerTarget = \{ id: 'player', x: px, y: py \};/.test(app),
    'the player is the hostile target, at the feet');
  assert.truthy(/\(target, shot\) => \(shot\.hostile \? this\._shotHitsPlayer\(shot\)\s*\n\s*: this\._damageEnemy\(target, shot\.damage\)\)/.test(app),
    'a hostile hit routes to the player, a friendly one to the foe');
  assert.truthy(/hostileTargets: \[playerTarget\]/.test(app), 'and is handed to stepShots');
  const hit = app.slice(app.indexOf('  _shotHitsPlayer(shot) {'), app.indexOf('  _turretFire('));
  assert.truthy(hit.length > 0, '_shotHitsPlayer exists');
  assert.truthy(/const shielded = \(this\.save\.shieldPotionUntil \?\? 0\) > now \? Math\.ceil\(shot\.damage \/ 2\) : shot\.damage;/.test(hit),
    'the shield potion halves it at impact');
  // …and worn armour soaks what is left, PER HIT of the bundle — mitigating
  // the whole volley in one lump would make the slow archer the one foe
  // armour barely helps against, which is exactly the parity
  // MONSTER_ARROW_HITS exists to preserve.
  assert.truthy(/const dmg = Combat\.playerDamage\(shielded, this\.save\.armor, shot\.hits\);/.test(hit),
    'armour soaks each carried hit, not the bundle');
  assert.truthy(/this\.save\.energy = Math\.max\(0, before - dmg\);/.test(hit), 'it comes off energy');
  assert.truthy(/this\._monsterDmgAccum = \(this\._monsterDmgAccum \|\| 0\) \+ \(before - this\.save\.energy\);/.test(hit),
    'and rolls into the monsters-hit flash');
});
})();
