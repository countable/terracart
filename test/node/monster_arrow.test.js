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
  // The trigger and the cadence consts are wanderCreatures' (scene_creatures.js,
  // the SceneCreatures mixin); the shot list and _shotHitsPlayer are app.js's.
  const app = APP_JS_SRC + '\n' + SCENE_CREATURES_SRC;
  assert.truthy(CREATURE_AI_SRC.includes("if (row.attackType === 'projectile')"));
  assert.truthy(CREATURE_AI_SRC.includes('raw * row.attackHits, row.attackHits'));
  assert.truthy(CREATURE_AI_SRC.includes('enemyAttackReady(c, row, now, eligible)'));
  assert.eq(EnemyRoster.get('goblin_archer').attackHits, 1);
  assert.falsy(CREATURE_AI_SRC.includes('enemyDmgMul'), 'Hard belongs to the recipient at impact');
  assert.truthy(/const playerTarget = \{ id: 'player', x: px, y: py \};/.test(app),
    'the player is the hostile target, at the feet');
  assert.truthy(/\(target, shot\) => \(shot\.hostile \? this\._shotHitsPlayer\(shot\)\s*\n\s*: this\._damageEnemy\(target, shot\.damage, Combat\.shotSource\(shot\)\)\)/.test(app),
    'a hostile hit routes to the player, a friendly one to the foe');
  assert.truthy(/hostileTargets: \[playerTarget\]/.test(app), 'and is handed to stepShots');
  const hit = app.slice(app.indexOf('  _shotHitsPlayer(shot) {'), app.indexOf('  _turretFire('));
  assert.truthy(hit.length > 0, '_shotHitsPlayer exists');
  assert.truthy(/const dmg = Combat\.incomingDamage\(this\.save, shot\.damage, shot\.hits\);/.test(hit),
    'shield expiry and per-hit armour resolve together at impact');
  const body = app.match(/\n  _shotHitsPlayer\(shot\) \{([\s\S]*?)\n  \}\n/)[1];
  assert.truthy(/this\._monsterDmgAccum = \(this\._monsterDmgAccum \|\| 0\)\s*\+ this\._losePlayerEnergy\(dmg, \{ closeShop: true \}\);/.test(body),
    'it comes off energy, and rolls into the monsters-hit flash');
});

// Attack ranges are declared independently of the player's equipment.
test('monster arrow: the ranged trigger radius comes from the enemy row', () => {
  assert.truthy(CREATURE_AI_SRC.includes('dist <= row.range * scene.cellM'));
  assert.eq(EnemyRoster.get('goblin_archer').range, 3);
  assert.eq(EnemyRoster.get('succubus').range, 4);
  assert.falsy(CREATURE_AI_SRC.includes("rangeCellsFor('staff'"));
});
})();
