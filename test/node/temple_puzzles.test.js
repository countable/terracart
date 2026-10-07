(() => {
  const P = TemplePuzzles;
  test('temple puzzles: rejects sizes outside each authored range', () => {
    for (const kind of P.KINDS) {
      const [min, max] = P.SIZE_RANGES[kind];
      assert.eq(P.create({ kind, size: min - 1 }), null);
      assert.eq(P.create({ kind, size: max + 1 }), null);
      for (let size = min; size <= max; size++) assert.truthy(P.create({ kind, size }));
    }
  });
  test('temple puzzles: every block board has a legal color-matched solution', () => {
    for (let size = 5; size <= 9; size++) {
      let s = P.create({ kind: 'blocks', size });
      const before = JSON.stringify(s);
      const moved = P.move(s, 1, 0);
      assert.eq(JSON.stringify(s), before, 'actions must not mutate input');
      s = moved;
      for (let i = 1; i < size - 4; i++) s = P.move(s, 1, 0);
      while (s.player.x > 1) s = P.move(s, -1, 0);
      while (s.player.y > 1) s = P.move(s, 0, -1);
      for (let i = 0; i < size - 4; i++) s = P.move(s, 1, 0);
      assert.eq(s.status, 'won');
    }
  });
  test('temple puzzles: secret path preview expires and wrong turns reset it', () => {
    let s = P.create({ kind: 'path', size: 7 });
    assert.eq(P.move(s, 0, -1).player.y, s.player.y, 'cannot walk during preview');
    s = P.tick(s, 3);
    assert.eq(s.phase, 'walk'); assert.eq(s.revealRemaining, 0);
    s = P.move(s, 1, 0);
    assert.eq(s.phase, 'reveal'); assert.eq(s.pathIndex, 0);
    s = P.tick(s, 3);
    for (const p of s.path.slice(1)) s = P.move(s, p.x - s.player.x, p.y - s.player.y);
    assert.eq(s.status, 'won');
  });
  test('temple puzzles: all three tower ladders remain reachable around obstacles', () => {
    let s = P.create({ kind: 'tower', size: 7 }, {enemyHp:43});
    for (let round = 1; round <= 3; round++) {
      assert.eq(s.round, round);
      assert.truthy(s.enemies.every(e => e.hp === 43), 'configured health applies to every round');
      // BFS proves authored obstacles leave a route even with guard starting cells.
      const queue = [{ p: s.player, route: [] }], seen = new Set(); let route;
      while (queue.length) {
        const { p, route: r } = queue.shift(), key = `${p.x},${p.y}`;
        if (seen.has(key)) continue; seen.add(key);
        if (p.x === s.ladder.x && p.y === s.ladder.y) { route = r; break; }
        for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          const n = { x:p.x+dx, y:p.y+dy };
          if (n.x < 0 || n.y < 0 || n.x >= s.size || n.y >= s.size || [...s.walls,...s.enemies].some(o => o.x === n.x && o.y === n.y)) continue;
          queue.push({ p:n, route:[...r,[dx,dy]] });
        }
      }
      assert.truthy(route, 'ladder has a path');
      for (const [dx, dy] of route) s = P.move(s, dx, dy);
    }
    assert.eq(s.status, 'won');
  });
  test('temple puzzles: combat respects compass aim, walls and frost', () => {
    let s = P.create({ kind: 'ballista', size: 7 });
    s.enemies = [{ id:'drone', x:3, y:1, hp:40, maxHp:40, frost:0 }];
    s = P.attack(s, {x:1,y:0}, 20);
    assert.eq(s.enemies[0].hp, 40);
    s = P.tick(s, .5); s = P.attack(s, {x:0,y:-1}, 20);
    assert.eq(s.enemies[0].hp, 40, 'damage waits for projectile impact');
    s = P.tick(s, .3);
    assert.eq(s.enemies[0].hp, 20); assert.truthy(s.enemies[0].frost > 0);
    const y = s.enemies[0].y;
    s = P.tick(s, .5); assert.eq(s.enemies[0].y, y);
    s.walls = [{x:3,y:2}]; s = P.attack(s, {x:0,y:-1}, 20);
    s = P.tick(s, .4);
    assert.eq(s.enemies[0].hp, 20, 'walls block traveling shots at impact');
    assert.eq(s.status, 'playing', 'a partial defense is not a win');
  });
  test('temple puzzles: unattended defense fails and all drones can be defeated', () => {
    const failed = P.tick(P.create({kind:'ballista'}), 60);
    assert.eq(failed.status, 'lost'); assert.eq(failed.centerHp, 0);
    let s = P.create({kind:'ballista'});
    for (let i = 0; i < 400 && s.status === 'playing'; i++) {
      s = P.tick(s, .1);
      if (s.enemies.length) {
        const e = s.enemies[0];
        s = P.attack(s, {x:e.x-s.player.x,y:e.y-s.player.y}, 100);
      }
    }
    assert.eq(s.status, 'won'); assert.eq(s.defeated, 12);
  });
  test('temple puzzles: high unsigned seeds spawn all drones and remain winnable', () => {
    for (const seed of [2147483648, 2147483649, 3000000000, 4294967295]) {
      let s = P.create({kind:'ballista', seed});
      for (let i = 0; i < 400 && s.status === 'playing'; i++) {
        s = P.tick(s, .1);
        if (s.enemies.length) {
          const e = s.enemies[0];
          s = P.attack(s, {x:e.x-s.player.x, y:e.y-s.player.y}, 100);
        }
      }
      assert.eq(s.status, 'won', `seed ${seed}`);
      assert.eq(s.spawned, 12);
      assert.eq(s.defeated, 12);
    }
  });
  test('temple puzzles: seeded secret routes are deterministic, distinct and solvable', () => {
    const signatures = new Set();
    for (let seed = 0; seed < 6; seed++) {
      let s = P.create({kind:'path',size:7,seed});
      signatures.add(JSON.stringify(s.path));
      assert.eq(JSON.stringify(s.path), JSON.stringify(P.create({kind:'path',size:7,seed}).path));
      s = P.tick(s, 3);
      for (const p of s.path.slice(1)) s = P.move(s, p.x - s.player.x, p.y - s.player.y);
      assert.eq(s.status,'won');
    }
    assert.eq(signatures.size, 6);
  });
  test('temple puzzles: duel uses configured health and damage and can end', () => {
    let s = P.create({kind:'duel'}, {playerHp:50,enemyHp:25,enemyDamage:9});
    assert.eq(s.player.hp,50); assert.eq(s.enemies[0].hp,25);
    const e = s.enemies[0];
    s = P.attack(s, {x:e.x-s.player.x,y:e.y-s.player.y},25);
    assert.eq(s.status,'won');
  });
})();

test('temple puzzles: leaving any moving platform falls instead of blocking, and re-entry resets', () => {
  for (const kind of ['blocks', 'duel', 'tower', 'path']) {
    const original = TemplePuzzles.create({kind, size:7}, {enemyHp:65});
    original.player.x = 0; original.player.y = 0; original.revealRemaining = 0;
    const fallen = TemplePuzzles.move(original, -1, 0);
    assert.eq(fallen.status, 'fallen', kind);
    assert.eq(original.status, 'playing');
    assert.eq(TemplePuzzles.tick(fallen, 10).status, 'fallen');
    assert.eq(TemplePuzzles.create({kind, size:7}).status, 'playing');
  }
});
