// Deterministic, renderer-independent grove trials. Coordinates are local cells.
(function (root) {
  'use strict';
  const SIZE_RANGES = Object.freeze({ blocks: [5, 9], tower: [7, 9], path: [5, 9], duel: [5, 9], ballista: [7, 9], maze: [7, 9] });
  const KINDS = Object.freeze(Object.keys(SIZE_RANGES));
  // A trial kind's own foe, when a plan names none (plan.enemyKind — the
  // churchyard's reaper): the roster row the scene draws, prices and paces it
  // from. The maze is Medusa's (her row's `gaze` is the trial's petrify).
  const TRIAL_FOE = Object.freeze({ maze: 'medusa' });
  const foeKind = plan => plan?.enemyKind || TRIAL_FOE[plan?.kind] || null;
  // How long the hidden way's route shows on the sky floor before it fades.
  const PATH_REVEAL_SECONDS = 5;
  // What each win proves, shown when a trial completes (Temples.complete).
  // An authored foe (plan.enemyKind) names its own fight.
  const WIN_CONDITIONS = Object.freeze({
    blocks: 'Both chromatic stones rest on their matching pressure plates.',
    tower: 'All three golden ladders climbed.',
    path: 'The hidden route walked from A to B without a wrong step.',
    duel: 'The elite grove champion defeated.',
    ballista: 'Every wall drone destroyed before the heart fell.',
    maze: 'The golden ladder reached through the gorgon’s maze.',
    giant_reaper: 'The giant reaper defeated.',
  });
  const winCondition = plan => WIN_CONDITIONS[plan?.enemyKind] || WIN_CONDITIONS[plan?.kind] || 'The temple trial completed.';
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
  // ── THE GORGON'S MAZE ──────────────────────────────────────────────────
  // A perfect maze carved on the odd lattice of the square (walls on every
  // even row and column and round the rim, so nothing falls off it), seeded
  // off the plan like every trial. The player starts bottom-left, the golden
  // ladder waits top-right, and Medusa stands in the lattice cell farthest
  // from the start, stalking a step down the maze toward the player on her
  // own cadence (mazeStep). HER GAZE (gazeTick): while the player's facing —
  // the compass heading the scene hands tick() — lies within her row's
  // `halfAngleDeg` of the line to her, within `cells` and with no wall
  // between, the player is PETRIFIED (conditions.js: the row's duration,
  // topped up, never stacked — and landed at most once per
  // APPLY_DEBOUNCE_MS, the one dose-a-second rule every status keeps).
  // Stone can neither step nor strike; the ladder wins the trial.
  function mazeRandom(seed) {
    let t = (seed >>> 0) + 0x9e3779b9;
    return () => {
      t = (t + 0x6d2b79f5) >>> 0;
      let r = Math.imul(t ^ (t >>> 15), 1 | t);
      r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }
  function mazeBoard(s) {
    // The lattice: odd rows and columns from 1 to `last` (n - 2 when the
    // square is odd; one short of it, behind a double wall, when it is even).
    const n = s.size, last = (n - 2) % 2 ? n - 2 : n - 3;
    const random = mazeRandom(s.seed), open = new Set(), key = (x, y) => `${x},${y}`;
    const start = { x: 1, y: last };
    const stack = [start]; open.add(key(start.x, start.y));
    while (stack.length) {
      const at = stack[stack.length - 1];
      const next = [[2, 0], [-2, 0], [0, 2], [0, -2]]
        .map(([dx, dy]) => ({ x: at.x + dx, y: at.y + dy, wx: at.x + dx / 2, wy: at.y + dy / 2 }))
        .filter(p => p.x >= 1 && p.y >= 1 && p.x <= last && p.y <= last && !open.has(key(p.x, p.y)));
      if (!next.length) { stack.pop(); continue; }
      const to = next[Math.floor(random() * next.length)];
      open.add(key(to.wx, to.wy)); open.add(key(to.x, to.y));
      stack.push({ x: to.x, y: to.y });
    }
    s.walls = [];
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (!open.has(key(x, y))) s.walls.push({ x, y });
    s.player.x = start.x; s.player.y = start.y;
    // `gazeAt`: the trial second the gaze last landed (null: never) — the
    // state is JSON, so no -Infinity here.
    s.player.petrified = 0; s.player.gazeAt = null;
    s.ladder = { x: last, y: 1 };
    // Medusa's seat: the lattice cell farthest down the maze from the start
    // that is not the ladder's.
    const distance = mazeDistances(s, start);
    let seat = null;
    for (const [k, d] of distance) {
      const [x, y] = k.split(',').map(Number);
      if (x % 2 === 0 || y % 2 === 0 || same({ x, y }, s.ladder) || same({ x, y }, start)) continue;
      if (!seat || d > seat.d || (d === seat.d && (y < seat.y || (y === seat.y && x < seat.x)))) seat = { x, y, d };
    }
    s.enemies = [enemy('medusa', seat.x, seat.y, 45)];
  }
  // Breadth-first walking distances from `from` through the open cells.
  function mazeDistances(s, from) {
    const key = p => `${p.x},${p.y}`, distance = new Map([[key(from), 0]]), queue = [from];
    for (let i = 0; i < queue.length; i++) {
      const p = queue[i], d = distance.get(key(p));
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const q = { x: p.x + dx, y: p.y + dy };
        if (!inside(s, q) || occupied(s.walls, q) || distance.has(key(q))) continue;
        distance.set(key(q), d + 1); queue.push(q);
      }
    }
    return distance;
  }
  // One step of Medusa's stalk: the neighbouring open cell nearest the
  // player by maze distance, never onto the player's own cell.
  function mazeStep(s, e) {
    const distance = mazeDistances(s, s.player);
    let best = null;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const q = { x: e.x + dx, y: e.y + dy }, d = distance.get(`${q.x},${q.y}`);
      if (d == null || d === 0 || occupied(s.enemies, q)) continue;
      if (!best || d < best.d) best = { ...q, d };
    }
    if (best) { e.x = best.x; e.y = best.y; }
  }
  // Is the straight line between two cell centres free of walls?
  function sightClear(s, a, b) {
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 4));
    for (let i = 1; i < steps; i++) {
      const p = { x: Math.round(a.x + (b.x - a.x) * i / steps), y: Math.round(a.y + (b.y - a.y) * i / steps) };
      if (occupied(s.walls, p)) return false;
    }
    return true;
  }
  const gazeRow = () => root.EnemyRoster?.get(TRIAL_FOE.maze)?.gaze || { condition: 'petrified', cells: 5, halfAngleDeg: 35 };
  const petrifySeconds = () => (root.Conditions?.DEFINITIONS?.petrified?.durationMs ?? 5000) / 1000;
  const debounceSeconds = () => (root.Conditions?.APPLY_DEBOUNCE_MS ?? 1000) / 1000;
  // Does the player's facing meet Medusa's gaze this instant?
  function gazeMeets(s, facing) {
    const m = s.enemies.find(e => e.id === 'medusa');
    const length = Math.hypot(facing?.x, facing?.y);
    if (!m || !Number.isFinite(length) || !length) return false;
    const vx = m.x - s.player.x, vy = m.y - s.player.y, dist = Math.hypot(vx, vy), gaze = gazeRow();
    if (!dist || dist > gaze.cells) return false;
    const cos = (facing.x * vx + facing.y * vy) / (length * dist);
    return cos >= Math.cos(gaze.halfAngleDeg * Math.PI / 180) - 1e-9 && sightClear(s, s.player, m);
  }
  function gazeTick(s, facing) {
    if (s.kind !== 'maze') return;
    s.player.petrified = Math.max(0, (s.player.petrified || 0) - .1);
    if (!gazeMeets(s, facing)) return;
    if (s.player.gazeAt != null && s.elapsed - s.player.gazeAt < debounceSeconds() - 1e-9) return;
    s.player.gazeAt = s.elapsed;
    s.player.petrified = Math.max(s.player.petrified, petrifySeconds());
    s.event = 'The gorgon’s gaze turns you to stone!';
  }
  const stone = s => s.kind === 'maze' && s.player.petrified > 0;
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
    else if (kind === 'maze') mazeBoard(s);
    else if (kind === 'path') {
      s.path = [];
      const bend = 2 + (Math.floor(s.seed / 2) % (size - 4));
      for (let y = size - 2; y >= bend; y--) s.path.push({ x: 1, y });
      for (let x = 2; x <= size - 2; x++) s.path.push({ x, y: bend });
      for (let y = bend - 1; y >= 1; y--) s.path.push({ x: size - 2, y });
      if (s.seed % 2) s.path = s.path.map(p => ({ x:size - 1 - p.x, y:p.y }));
      s.pointA = { ...s.path[0] }; s.pointB = { ...s.path[s.path.length - 1] };
      s.player.x = s.pointA.x; s.player.y = s.pointA.y;
      s.pathIndex = 0; s.revealRemaining = PATH_REVEAL_SECONDS; s.phase = 'reveal';
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
    if (stone(s)) { s.event = 'You are stone. Wait for it to pass.'; return s; }
    const to = { x: s.player.x + dx, y: s.player.y + dy };
    if (!inside(s, to)) {
      s.status = 'fallen'; s.event = 'You fall back to the ground. Enter the temple to try again.';
      return s;
    }
    if (occupied(s.walls, to) || occupied(s.enemies, to)) return s;
    const block = s.blocks.find(b => same(b, to));
    if (block) {
      const next = root.PushBlocks.destination(block, dx, dy, p =>
        !inside(s, p) || occupied(s.walls, p) || occupied(s.blocks, p) || occupied(s.enemies, p));
      if (!next) return s;
      block.x = next.x; block.y = next.y;
    }
    if (s.kind === 'path') {
      if (!same(to, s.path[s.pathIndex + 1] || {})) {
        s.player.x = s.pointA.x; s.player.y = s.pointA.y; s.pathIndex = 0;
        s.revealRemaining = PATH_REVEAL_SECONDS; s.phase = 'reveal'; s.event = 'The path faded. Memorize it and try again.';
        return s;
      }
      s.pathIndex++;
      if (s.pathIndex === s.path.length - 1) { s.status = 'won'; s.event = 'Temple trial complete.'; }
    }
    s.player.x = to.x; s.player.y = to.y;
    if (s.kind === 'maze' && same(s.player, s.ladder)) { s.status = 'won'; s.event = 'Out of the maze!'; return s; }
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
      if (s.kind === 'maze') { mazeStep(s, e); continue; }
      const steps = [{ x: e.x + Math.sign(target.x - e.x), y: e.y }, { x: e.x, y: e.y + Math.sign(target.y - e.y) }];
      const to = steps.find(p => !same(p, e) && !occupied(s.walls, p) && !occupied(s.enemies, p) && !same(p, s.player));
      // Drones reach the defended center; the mounted player occupies that cell.
      if (s.kind === 'ballista' && distance === 1) { e.x = target.x; e.y = target.y; }
      else if (to) { e.x = to.x; e.y = to.y; }
    }
  }
  /** tick uses seconds. Discrete 0.1-second simulation makes spawn/combat timing
   * independent of render frame rate. Callers should pause ticking in dialogs.
   * options.facing is the player's facing (the compass heading) for the maze's gaze. */
  function tick(state, dt, options = {}) {
    const s = copy(state); s.event = '';
    if (s.status !== 'playing' || !Number.isFinite(dt) || dt <= 0) return s;
    s.pendingTime = (s.pendingTime || 0) + dt;
    while (s.pendingTime + 1e-9 >= .1 && s.status === 'playing') {
      s.pendingTime = Math.max(0, s.pendingTime - .1); s.elapsed += .1;
      s.cooldown = Math.max(0, s.cooldown - .1);
      gazeTick(s, options.facing);
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
    if (s.status !== 'playing' || s.cooldown > 1e-8 || !Number.isFinite(length) || !length || !(damage > 0) || !Number.isFinite(damage) || stone(s)) return s;
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
  root.TemplePuzzles = { KINDS, SIZE_RANGES, TRIAL_FOE, foeKind, PATH_REVEAL_SECONDS, WIN_CONDITIONS, winCondition, create, move, tick, attack, gazeMeets, mazeDistances };
})(typeof window !== 'undefined' ? window : globalThis);
