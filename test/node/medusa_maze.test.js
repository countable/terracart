// Medusa and the gorgon's maze: the grove temple's maze trial, her gaze,
// the petrified stone and the one-dose-a-second clock it shares.
(() => {
  const P = TemplePuzzles;
  const route = (s, from, to) => {
    const distance = P.mazeDistances({ ...s, enemies: [] }, from);
    return distance.get(`${to.x},${to.y}`);
  };
  // An open 7-cell floor with Medusa and the player placed by hand.
  const open = (player, medusa, extra = {}) => {
    const s = P.create({ kind: 'maze', size: 7, seed: 3 }, extra);
    s.walls = []; s.player.x = player.x; s.player.y = player.y;
    s.enemies[0].x = medusa.x; s.enemies[0].y = medusa.y;
    return s;
  };

  test('medusa: a trial-only roster row whose gaze table the maze reads', () => {
    const row = EnemyRoster.get('medusa');
    assert.eq(row.art.path, 'assets/Enemy/spr_mini_monsters_spritesheet.png');
    assert.eq(row.art.directions.down.idle[0], 1200);
    assert.eq(row.art.directions.left.move[0], 1230);
    assert.eq(row.art.directions.right.move[0], 1260);
    assert.eq(row.art.directions.up.move[0], 1290);
    assert.eq(row.surface, null); assert.eq(row.cave, null);
    assert.eq(row.board, false, 'off the quest board');
    assert.falsy(Combat.boardKind?.('medusa'));
    assert.eq(row.gaze.condition, 'petrified');
    assert.gt(row.gaze.cells, 0); assert.gt(row.gaze.halfAngleDeg, 0);
    assert.truthy(Conditions.DEFINITIONS[row.gaze.condition], 'the gaze lands a real status row');
    assert.eq(P.TRIAL_FOE.maze, 'medusa');
    assert.eq(P.foeKind({ kind: 'maze' }), 'medusa');
    assert.eq(P.foeKind({ kind: 'duel', enemyKind: 'giant_reaper' }), 'giant_reaper', 'an authored foe wins');
    assert.eq(P.foeKind({ kind: 'duel' }), null);
    assert.truthy(P.KINDS.includes('maze'));
    assert.eq(P.SIZE_RANGES.maze.join(), '7,9');
    assert.truthy(P.winCondition({ kind: 'maze' }).includes('ladder'));
  });

  test('maze: the shared braid read as passages, rimmed, solvable at every size, Medusa farthest from both ends', () => {
    let detours = 0, draws = 0;
    for (let size = 7; size <= 9; size++) for (let seed = 0; seed < 25; seed++) {
      const s = P.create({ kind: 'maze', size, seed });
      draws++;
      assert.eq(JSON.stringify(s), JSON.stringify(P.create({ kind: 'maze', size, seed })), 'deterministic');
      const w = size % 2 ? size : size - 1;
      const braid = CaveAreas.mazeBraid({ ...P.MAZE_BRAID, width: w, height: w, seed: seed * P.MAZE_DRAWS + s.mazeDraw });
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const passage = x < w && y < w && braid.has(y * w + x);
        assert.eq(s.walls.some(c => c.x === x && c.y === y), !passage,
          `${size}/${seed}: the braid's lines are the passages, everything else wall`);
      }
      for (let i = 0; i < size; i++) for (const p of [{ x: i, y: 0 }, { x: i, y: size - 1 }, { x: 0, y: i }, { x: size - 1, y: i }]) {
        assert.truthy(s.walls.some(c => c.x === p.x && c.y === p.y), `${size}/${seed}: the rim is wall`);
      }
      assert.eq(s.player.x, 1); assert.eq(s.player.y, w - 2);
      assert.eq(s.ladder.x, w - 2); assert.eq(s.ladder.y, 1);
      const walk = route(s, s.player, s.ladder);
      assert.truthy(walk > 0, `${size}/${seed}: the ladder can be reached`);
      if (walk >= (w - 3) * 2 + P.MAZE_DETOUR_CELLS) detours++;
      const m = s.enemies[0];
      assert.eq(m.id, 'medusa'); assert.eq(s.enemies.length, 1);
      assert.falsy(s.walls.some(c => c.x === m.x && c.y === m.y), 'on open floor');
      assert.falsy(m.x === s.ladder.x && m.y === s.ladder.y);
      assert.gte(route(s, s.player, m), P.MEDUSA_START_CELLS, 'never on top of the player at the start');
      const ranks = P.mazeSeatRank({ ...s, enemies: [] }, s.player, s.ladder), hers = ranks.get(`${m.x},${m.y}`);
      assert.truthy(hers);
      for (const rank of ranks.values()) assert.lte(rank.apart, hers.apart, `${size}/${seed}: no open cell is farther from both ends`);
      assert.eq(s.player.petrified, 0);
    }
    assert.gt(detours, draws * 0.7, `most draws find a braid with a real detour (${detours}/${draws})`);
  });

  test('maze: the gaze needs facing within the cone, within reach and in clear sight', () => {
    const gaze = EnemyRoster.get('medusa').gaze;
    let s = open({ x: 1, y: 3 }, { x: 4, y: 3 });
    assert.truthy(P.gazeMeets(s, { x: 1, y: 0 }), 'straight at her');
    assert.truthy(P.gazeMeets(s, { x: 1, y: Math.tan((gaze.halfAngleDeg - 1) * Math.PI / 180) }), 'inside the cone');
    assert.falsy(P.gazeMeets(s, { x: 1, y: Math.tan((gaze.halfAngleDeg + 1) * Math.PI / 180) }), 'outside it');
    assert.falsy(P.gazeMeets(s, { x: -1, y: 0 }), 'back turned');
    assert.falsy(P.gazeMeets(s, { x: 0, y: 1 }), 'side on');
    assert.falsy(P.gazeMeets(s, null), 'no facing, no gaze');
    assert.falsy(P.gazeMeets(s, { x: 0, y: 0 }));
    s.walls = [{ x: 2, y: 3 }];
    assert.falsy(P.gazeMeets(s, { x: 1, y: 0 }), 'a wall between');
    s = open({ x: 1, y: 3 }, { x: 1 + gaze.cells, y: 3 });
    assert.truthy(P.gazeMeets(s, { x: 1, y: 0 }), 'at the edge of her reach');
    s.enemies[0].x = 2 + gaze.cells;
    assert.falsy(P.gazeMeets(s, { x: 1, y: 0 }), 'past it');
    s.enemies = [];
    assert.falsy(P.gazeMeets(s, { x: 1, y: 0 }), 'no Medusa, no gaze');
  });

  test('maze: her gaze turns the player to stone for five seconds, topped up once a second, never stacked', () => {
    const duration = Conditions.DEFINITIONS.petrified.durationMs / 1000, window = Conditions.APPLY_DEBOUNCE_MS / 1000;
    let s = open({ x: 1, y: 3 }, { x: 4, y: 3 }, { enemyStepSeconds: 100 });
    s = P.tick(s, .1, { facing: { x: -1, y: 0 } });
    assert.eq(s.player.petrified, 0, 'looking away is safe');
    s = P.tick(s, .1, { facing: { x: 1, y: 0 } });
    assert.lt(Math.abs(s.player.petrified - duration), 1e-9, 'stone for the row\'s duration');
    assert.truthy(s.event.includes('stone'));
    const before = s.player;
    const held = P.move(s, 0, -1);
    assert.eq(held.player.x, before.x); assert.eq(held.player.y, before.y);
    assert.truthy(held.event.includes('stone'), 'stone cannot step');
    const swing = P.attack(s, { x: 1, y: 0 }, 50);
    assert.eq(swing.enemies[0].hp, s.enemies[0].hp, 'stone cannot strike');
    assert.eq(swing.cooldown, s.cooldown);
    s = P.tick(s, .5, { facing: { x: 1, y: 0 } });
    assert.lt(Math.abs(s.player.petrified - (duration - .5)), 1e-9, 'inside the window the gaze does not re-land');
    s = P.tick(s, window - .5, { facing: { x: 1, y: 0 } });
    assert.lt(Math.abs(s.player.petrified - duration), 1e-9, 'a second on it tops back up — never past the duration');
    s = P.tick(s, duration + .1, { facing: { x: -1, y: 0 } });
    assert.eq(s.player.petrified, 0, 'it passes');
    const free = P.move(s, 0, -1);
    assert.eq(free.player.y, 2, 'and the body walks again');
    const m = free.enemies[0], at = { x: m.x - free.player.x, y: m.y - free.player.y };
    assert.lt(P.attack(free, at, 5).enemies[0].hp, m.hp, 'and strikes again');
  });

  test('maze: Medusa stalks a step down the maze each cadence and strikes when adjacent', () => {
    let s = P.create({ kind: 'maze', size: 9, seed: 7 }, { enemyStepSeconds: 2, enemyDamage: 9 });
    const m = () => s.enemies[0];
    const far = route(s, s.player, m());
    s = P.tick(s, 1.9, { facing: { x: 0, y: -1 } });
    assert.eq(route(s, s.player, m()), far, 'not yet');
    s = P.tick(s, .1, { facing: { x: 0, y: -1 } });
    assert.eq(route(s, s.player, m()), far - 1, 'one step nearer by maze distance');
    assert.falsy(s.walls.some(w => w.x === m().x && w.y === m().y), 'never into a wall');
    let close = open({ x: 1, y: 3 }, { x: 2, y: 3 }, { enemyStepSeconds: 1, enemyDamage: 9 });
    close = P.tick(close, 1, { facing: { x: -1, y: 0 } });
    assert.eq(close.player.hp, 91, 'adjacent, she bites for the configured blow');
    assert.eq(close.enemies[0].x, 2, 'and holds her cell');
  });

  test('maze: reaching the golden ladder wins the trial', () => {
    let s = P.create({ kind: 'maze', size: 7, seed: 11 });
    s.enemies = [];
    const distance = P.mazeDistances(s, s.ladder);
    let guard = 0;
    while (!(s.player.x === s.ladder.x && s.player.y === s.ladder.y) && guard++ < 200) {
      const here = distance.get(`${s.player.x},${s.player.y}`);
      const step = [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([dx, dy]) => distance.get(`${s.player.x + dx},${s.player.y + dy}`) === here - 1);
      s = P.move(s, step[0], step[1]);
    }
    assert.eq(s.status, 'won');
    assert.truthy(s.event.includes('maze'));
  });

  test('maze scene: Medusa priced and paced off her row, the facing fed to the gaze, stone neither strikes nor moves', () => {
    const previousPhaser = globalThis.Phaser;
    globalThis.Phaser = { Scene: class {} };
    try {
      let trial;
      const source = { save: { energy: 100, relics: {} }, scene: {
        manager: { getScene() {}, add(_key, scene) { trial = scene; } }, pause() {}, resume() {} } };
      TempleScene.enter(source, {}, { kind: 'maze', size: 7, seed: 0, x: 0, y: 0, cellM: 7 });
      trial.draw = () => {};
      trial.restartTrial();
      const row = Combat.monster('medusa');
      assert.eq(trial.state.enemies[0].hp, Combat.maxHp({ kind: 'medusa' }));
      assert.eq(trial.state.config.enemyDamage, Combat.playerDamage(row.dmg, undefined, 1));
      assert.eq(trial.state.config.enemyStepSeconds, row.damageIntervalSeconds);
      // Open floor, Medusa three cells east, the body facing her.
      trial.state.walls = []; trial.state.player.x = 1; trial.state.player.y = 3;
      trial.state.enemies[0].x = 4; trial.state.enemies[0].y = 3; trial.state.enemies[0].hp = trial.state.enemies[0].maxHp = 1000;
      trial.aim = { x: 1, y: 0 };
      trial.update(0, 100);
      assert.gt(trial.state.player.petrified, 0, 'the scene hands the facing to the gaze');
      trial.state.enemies[0].x = 2;
      trial.attackClock = 0;
      trial.update(0, 100);
      assert.eq(trial.state.enemies[0].hp, 1000, 'stone lands no blow on the adjacent gorgon');
      trial.state.player.petrified = 0; trial.attackClock = 0; trial.aim = { x: -1, y: 0 };
      trial.update(0, 100);
      assert.lt(trial.state.enemies[0].hp, 1000, 'free again, the weapon strikes her as in the duel');
    } finally { globalThis.Phaser = previousPhaser; }
  });

  test('maze: the sandbox seats a Medusa to look at', () => {
    const built = Sandbox.buildForTest({ cellsPerEdge: 128, tx: 3, ty: 4 });
    assert.truthy(built.entry.creatures.some(c => c.kind === 'medusa'));
  });
})();
