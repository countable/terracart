// Deterministic, renderer-independent grove trials. Coordinates are local cells.
(function (root) {
  'use strict';
  const SIZE_RANGES = Object.freeze({ blocks: [5, 9], tower: [7, 9], path: [5, 9], duel: [5, 9], ballista: [7, 9] });
  const KINDS = Object.freeze(Object.keys(SIZE_RANGES));
  const seedNumber = value => {
    if (Number.isFinite(value)) return Math.abs(Math.trunc(value));
    let hash = 0; for (const ch of String(value || '')) hash = (Math.imul(hash, 31) + ch.charCodeAt(0)) >>> 0;
    return hash;
  };
  const same = (a, b) => a.x === b.x && a.y === b.y;
  const copy = state => JSON.parse(JSON.stringify(state));
  const inside = (s, p) => p.x >= 0 && p.y >= 0 && p.x < s.size && p.y < s.size;
  const occupied = (list, p) => list.some(o => same(o, p));
  function enemy(id, x, y, hp, elite = false) { return { id, x, y, hp, maxHp: hp, elite, frost: 0 }; }
  function towerRound(s) {
    const n = s.size, gap = s.round % 2 ? 1 : n - 2;
    s.player.x = 1; s.player.y = n - 2;
    s.ladder = { x: n - 2, y: 1 };
    s.walls = [];
    for (let x = 0; x < n; x++) if (x !== gap) s.walls.push({ x, y: Math.floor(n / 2) });
    s.enemies = [enemy(`guard-${s.round}`, n - 2, n - 2, 18 + s.round * 6)];
    if (s.round === 3) s.enemies.push(enemy('guard-top', 2, 1, 24));
    if (s.config.enemyHp > 0) for (const e of s.enemies) e.hp = e.maxHp = s.config.enemyHp;
  }
  /** create({kind,size=7,seed=0}) returns JSON-serializable state. Invalid sizes
   * return null so generation can skip trials that do not fit a park. */
  function create(plan, options = {}) {
    const kind = plan?.kind, size = plan?.size ?? 7, range = SIZE_RANGES[kind];
    if (!range || !Number.isInteger(size) || size < range[0] || size > range[1]) return null;
    const c = Math.floor(size / 2);
    const s = { kind, size, seed: seedNumber(plan.seed), status: 'playing', elapsed: 0,
      player: { x: 1, y: size - 2, hp: options.playerHp ?? 100 }, config: options, walls: [], blocks: [], plates: [],
      enemies: [], shots: [], cooldown: 0, stepClock: 0, round: 1, event: '' };
    if (kind === 'blocks') {
      s.blocks = [{ x: 2, y: 1, color: 'red' }, { x: 2, y: size - 2, color: 'blue' }];
      s.plates = [{ x: size - 2, y: 1, color: 'red' }, { x: size - 2, y: size - 2, color: 'blue' }];
    } else if (kind === 'tower') towerRound(s);
    else if (kind === 'path') {
      s.path = [];
      const bend = 2 + (Math.floor(s.seed / 2) % (size - 4));
      for (let y = size - 2; y >= bend; y--) s.path.push({ x: 1, y });
      for (let x = 2; x <= size - 2; x++) s.path.push({ x, y: bend });
      for (let y = bend - 1; y >= 1; y--) s.path.push({ x: size - 2, y });
      if (s.seed % 2) s.path = s.path.map(p => ({ x:size - 1 - p.x, y:p.y }));
      s.pointA = { ...s.path[0] }; s.pointB = { ...s.path[s.path.length - 1] };
      s.player.x = s.pointA.x; s.player.y = s.pointA.y;
      s.pathIndex = 0; s.revealRemaining = 3; s.phase = 'reveal';
    } else if (kind === 'duel') s.enemies = [enemy(plan.enemyKind || 'elite', size - 2, 1, 100, !plan.enemyKind)];
    else {
      s.player.x = c; s.player.y = c; s.center = { x: c, y: c };
      s.centerHp = 100; s.spawned = 0; s.defeated = 0; s.totalDrones = 12; s.spawnClock = 0;
    }
    for (const e of s.enemies) { if (options.enemyHp > 0) e.hp = e.maxHp = options.enemyHp; }
    return s;
  }
  function finish(s) {
    if (s.player.hp <= 0 || s.centerHp <= 0) { s.status = 'lost'; s.event = 'Trial failed. Try again.'; }
    else if ((s.kind === 'blocks' && s.blocks.every(b => s.plates.some(p => same(b, p) && b.color === p.color)))
      || (s.kind === 'duel' && !s.enemies.length)
      || (s.kind === 'ballista' && s.defeated >= s.totalDrones)) {
      s.status = 'won'; s.event = 'Temple trial complete.';
    }
    return s;
  }
  /** All actions return a fresh state, never mutate their input. Movement is a
   * single cardinal cell. Walls, monsters and other blocks stop block pushes. */
  function move(state, dx, dy) {
    const s = copy(state); s.event = '';
    if (s.status !== 'playing' || Math.abs(dx) + Math.abs(dy) !== 1 || !Number.isInteger(dx) || !Number.isInteger(dy)
      || s.kind === 'ballista' || (s.kind === 'path' && s.revealRemaining > 0)) return s;
    const to = { x: s.player.x + dx, y: s.player.y + dy };
    if (!inside(s, to)) {
      s.status = 'fallen'; s.event = 'You fall back to the ground. Enter the temple to try again.';
      return s;
    }
    if (occupied(s.walls, to) || occupied(s.enemies, to)) return s;
    const block = s.blocks.find(b => same(b, to));
    if (block) {
      const next = { x: block.x + dx, y: block.y + dy };
      if (!inside(s, next) || occupied(s.walls, next) || occupied(s.blocks, next) || occupied(s.enemies, next)) return s;
      block.x = next.x; block.y = next.y;
    }
    if (s.kind === 'path') {
      if (!same(to, s.path[s.pathIndex + 1] || {})) {
        s.player.x = s.pointA.x; s.player.y = s.pointA.y; s.pathIndex = 0;
        s.revealRemaining = 3; s.phase = 'reveal'; s.event = 'The path faded. Memorize it and try again.';
        return s;
      }
      s.pathIndex++;
      if (s.pathIndex === s.path.length - 1) { s.status = 'won'; s.event = 'Temple trial complete.'; }
    }
    s.player.x = to.x; s.player.y = to.y;
    if (s.kind === 'tower' && same(s.player, s.ladder)) {
      if (s.round === 3) { s.status = 'won'; s.event = 'Three ladders climbed!'; }
      else { s.round++; towerRound(s); s.event = `Tower stage ${s.round} of 3`; }
    }
    return finish(s);
  }
  function enemyStep(s) {
    for (const e of s.enemies) {
      if (e.frost > 0) continue;
      const target = s.kind === 'ballista' ? s.center : s.player;
      const distance = Math.abs(e.x - target.x) + Math.abs(e.y - target.y);
      if (distance <= (s.kind === 'ballista' ? 0 : 1)) {
        if (s.kind === 'ballista') s.centerHp = Math.max(0, s.centerHp - 10);
        else s.player.hp = Math.max(0, s.player.hp - (s.config.enemyDamage ?? (e.elite ? 12 : 7)));
        continue;
      }
      const steps = [{ x: e.x + Math.sign(target.x - e.x), y: e.y }, { x: e.x, y: e.y + Math.sign(target.y - e.y) }];
      const to = steps.find(p => !same(p, e) && !occupied(s.walls, p) && !occupied(s.enemies, p) && !same(p, s.player));
      // Drones reach the defended center; the mounted player occupies that cell.
      if (s.kind === 'ballista' && distance === 1) { e.x = target.x; e.y = target.y; }
      else if (to) { e.x = to.x; e.y = to.y; }
    }
  }
  /** tick uses seconds. Discrete 0.1-second simulation makes spawn/combat timing
   * independent of render frame rate. Callers should pause ticking in dialogs. */
  function tick(state, dt) {
    const s = copy(state); s.event = '';
    if (s.status !== 'playing' || !Number.isFinite(dt) || dt <= 0) return s;
    s.pendingTime = (s.pendingTime || 0) + dt;
    while (s.pendingTime + 1e-9 >= .1 && s.status === 'playing') {
      s.pendingTime = Math.max(0, s.pendingTime - .1); s.elapsed += .1;
      s.cooldown = Math.max(0, s.cooldown - .1);
      s.shots = s.shots.filter(shot => {
        if (!shot.projectile) return (shot.ttl -= .1) > 0;
        const distance = Math.min(shot.remaining, shot.speed * .1);
        // Sweep the segment so fast bolts cannot tunnel through a drone.
        let nearest = distance + 1e-8, victim = null, wall = false;
        for (const target of [...s.walls, ...s.enemies]) {
          const rx = target.x - shot.x, ry = target.y - shot.y;
          const along = rx * shot.dx + ry * shot.dy;
          const across = Math.abs(rx * shot.dy - ry * shot.dx);
          if (along >= -.3 && along <= nearest && across < .5) {
            nearest = Math.max(0, along); victim = target; wall = s.walls.includes(target);
          }
        }
        if (victim) {
          if (!wall) {
            victim.hp -= shot.damage; victim.frost = 1.5;
            if (victim.hp <= 0) { s.enemies = s.enemies.filter(e => e !== victim); s.defeated++; }
          }
          return false;
        }
        shot.x += shot.dx * distance; shot.y += shot.dy * distance;
        shot.remaining -= distance;
        return shot.remaining > 1e-8 && inside(s, shot);
      });
      for (const e of s.enemies) e.frost = Math.max(0, e.frost - .1);
      if (s.kind === 'path') {
        s.revealRemaining = Math.max(0, s.revealRemaining - .1);
        if (s.revealRemaining < 1e-8) { s.revealRemaining = 0; s.phase = 'walk'; }
      }
      if (s.kind === 'ballista') {
        s.spawnClock += .1;
        if (s.spawnClock + 1e-9 >= 2 && s.spawned < s.totalDrones) {
          s.spawnClock -= 2;
          const c = Math.floor(s.size / 2), positions = [[c, 0], [s.size - 1, c], [c, s.size - 1], [0, c]];
          const [x, y] = positions[(s.spawned + s.seed) % 4];
          if (!occupied(s.enemies, { x, y })) { s.enemies.push(enemy(`drone-${s.spawned}`, x, y, 20)); s.spawned++; }
        }
      }
      s.stepClock += .1;
      if (s.stepClock + 1e-9 >= (s.config.enemyStepSeconds ?? 1)) {
        s.stepClock -= s.config.enemyStepSeconds ?? 1; enemyStep(s);
      }
      finish(s);
    }
    return s;
  }
  /** attack(state,{x,y},damage) fires along a normalized compass vector. Pass
   * the equipped bow damage, or frost-bow damage for the mounted ballista.
   * Melee rays stop at walls and the nearest enemy. Ballista bolts travel at
   * config.shotSpeed cells/second and apply frost damage only on impact. */
  function attack(state, direction, damage) {
    const s = copy(state); s.event = '';
    const length = Math.hypot(direction?.x, direction?.y);
    if (s.status !== 'playing' || s.cooldown > 1e-8 || !Number.isFinite(length) || !length || !(damage > 0) || !Number.isFinite(damage)) return s;
    const d = { x: direction.x / length, y: direction.y / length };
    s.cooldown = s.config.shotInterval ?? .45;
    if (s.kind === 'ballista') {
      const range = s.config.shotRange ?? s.size * Math.SQRT2;
      s.shots.push({ x:s.player.x, y:s.player.y, dx:d.x, dy:d.y, range:.6,
        remaining:range, speed:s.config.shotSpeed ?? 7, damage, frost:true, projectile:true });
      return s;
    }
    let range = s.config.shotRange ?? s.size * Math.SQRT2, victim = null;
    const projection = p => ({ along: (p.x - s.player.x) * d.x + (p.y - s.player.y) * d.y,
      across: Math.abs((p.x - s.player.x) * d.y - (p.y - s.player.y) * d.x) });
    for (const w of s.walls) { const p = projection(w); if (p.along > 0 && p.across < .5) range = Math.min(range, p.along); }
    for (const e of s.enemies) {
      const p = projection(e);
      if (p.along >= 0 && p.along < range && p.across < .5) { range = p.along; victim = e; }
    }
    s.shots.push({ x: s.player.x, y: s.player.y, dx: d.x, dy: d.y, range, ttl: .25, frost: s.kind === 'ballista' });
    if (victim) {
      victim.hp -= damage;
      if (s.kind === 'ballista') victim.frost = 1.5;
      if (victim.hp <= 0) { s.enemies = s.enemies.filter(e => e !== victim); if (s.kind === 'ballista') s.defeated++; }
    }
    return finish(s);
  }
  root.TemplePuzzles = { KINDS, SIZE_RANGES, create, move, tick, attack };
})(typeof window !== 'undefined' ? window : globalThis);
