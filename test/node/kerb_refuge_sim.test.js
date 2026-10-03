// THE KERB, RUN — the safety audit's refuge test (owner, Sep 2026).
//
// "There must never be a need, or an advantage, to step onto a road to get
// away from an enemy." The rules (creature_ai.js THE KERB, worldgen
// ROAD_CLASS_MAJOR_BUFFER):
//   · nothing hostile steps onto a major road's band;
//   · a FAST mover (isFastMover — over BRISK_WALK_MPS) never
//     steps into the kerb buffer, never spawns in it (the spawn gate's KERB
//     reason, 'fastEnemy' / 'fastFauna'), and a ghost never glides into it;
//   · a player whose feet are in the buffer is where every chase ends
//     (`kerbTurn`): every hostile stands down and turns away.
// Because the band lies inside the buffer, the carriageway buys exactly what
// the pavement beside it buys — so for EVERY hostile kind, stepping onto the
// road is never better than walking along the verge.
//
// Like lair_chase_sim.test.js, this runs the REAL wanderCreatures (run.js
// __wander) on a stub scene over a SYNTHETIC STREET: one tile, a major band
// two cells wide across it, its kerb buffer stamped exactly as worldgen
// stamps the bits. Everything here is behaviour, not text.
(function () {

const CELL = 7;                        // WorldGen.CELL_M
const N = 64;
const EDGE = N * CELL;
const BAND_ROWS = [30, 31];
const BUF = Math.ceil(WorldGen.MAJOR_BUFFER_CELLS);   // 2.5 → 3 whole rows each side
const VERGE_ROW = BAND_ROWS[1] + 2;    // on the pavement, inside the buffer
const OPEN_ROW = 45;                   // open ground, far from the road
const TICK_MS = 100;
const B = WorldGen.ROAD_CLASS_MAJOR_BAND, K = WorldGen.ROAD_CLASS_MAJOR_BUFFER;

function street() {
  const roadClass = new Uint8Array(N * N);
  for (let y = 0; y < N; y++) {
    const band = BAND_ROWS.includes(y);
    const buf = y >= BAND_ROWS[0] - BUF && y <= BAND_ROWS[1] + BUF;
    for (let x = 0; x < N; x++) roadClass[y * N + x] = (band ? B : 0) | (buf ? K : 0);
  }
  return { cellsPerEdge: N, roadClass, grid: new Uint8Array(N * N), creatures: [] };
}
const rowOf = (c) => Math.floor(c.y / CELL);
const bits = (entry, c) => entry.roadClass[rowOf(c) * N + Math.floor(c.x / CELL)] || 0;
const at = (col, row) => ({ x: (col + 0.5) * CELL, y: (row + 0.5) * CELL });

// A bag with something in it for a food thief (the gull) to take — a huge
// stack, so every snatch counts and none runs it dry.
const BAG_BERRIES = 1e6;
function mkScene(entry, creature, feet) {
  const scene = {
    cellM: CELL, depth: 0, tileEdgeM: EDGE,
    save: { energy: 1e6, money: 1e6, inv: [{ id: 'berry', count: BAG_BERRIES }], caught: [], armor: {}, planted: [], fires: [], released: [], reachUpgrades: 0 },
    startWorldM: { x: 0, y: 0 }, playerM: { x: feet.x, y: feet.y }, feetOffsetM: 0,
    // Home a world away, so the safe area (EnemySpawns.homeAllows) hides
    // nothing: this harness is about the kerb, not about Home.
    _starterTrailAnchor: () => ({ x: -1e6, y: 0 }),
    originPx: { x: 0, y: 0 }, mPerPx: CELL, cellsPerTile: WorldGen.TILE_PX,
    viewCenterX: 0, viewCenterY: 0, _shots: [], _laid: 0,
    isShadowActive: () => false,
    isUnnoticed() { return this.isShadowActive() || Combat.playerDowned(this.save.energy); },
    homeWorldPos: () => null, _castleWardPoints: () => [],
    playerToWorldCell: () => ({ tx: 0, ty: 0, ix: 0, iy: 0 }),
    cellAt: () => ({ loaded: true, type: 0 }),   // walkable everywhere; only the road bits differ
    _cellBlocked: () => false, _nearAny: () => false, placedRockSet: null,
    _damageEnemy: () => false, resolveDefeat: () => {},
    _popEnergy: () => {}, _warnIfTiring: () => {}, _flashPlayerHit: () => {}, _closeShopOnHit: () => {},
    _losePlayerEnergy(d) { const b = this.save.energy; this.save.energy = Math.max(0, b - d); return b - this.save.energy; },
    _trapperLay() { this._laid++; },
    // A THIEF'S snatch (the raven's coins, the gull's food —
    // Combat.incomingTheft) banked the way app.js _losePlayerToThief banks
    // it: off the purse or out of the bag, the thief sated.
    _losePlayerToThief(take, c) {
      const taken = take.what === 'coins' ? (this.save.money -= take.n, take.n) : Inventory.remove(this.save, take.id, take.n);
      if (taken > 0) Combat.bankTheft(this.save, c);
      return taken;
    },
    updateEnergyDOM: () => {}, flash: () => {}, _wildCrowTick: () => {},
  };
  scene.creatures = [creature];
  return scene;
}
function tick(scene, entry) {
  const realNear = WorldGen.forEachItemNear, realGet = WorldGen.tileCache.get, realNow = performance.now;
  scene._simT = (scene._simT || 1e6) + TICK_MS;
  const t = scene._simT;
  WorldGen.forEachItemNear = (what, tx, ty, fn) => { if (what === 'creatures') for (const c of scene.creatures.slice()) fn(c, 0, 0); };
  WorldGen.tileCache.get = (k) => (k === WorldGen.tileKey(0, 0) ? entry : undefined);
  try { performance.now = () => t; __wander.call(scene); } finally {
    WorldGen.forEachItemNear = realNear; WorldGen.tileCache.get = realGet; performance.now = realNow;
  }
}
// Everything a hostile can do TO the player: energy off the bar, an arrow
// loosed, a snare laid, coins snatched from the purse, food out of the bag.
const attacks = (s) => (1e6 - s.save.energy) + s._shots.length + s._laid + (1e6 - s.save.money) + (BAG_BERRIES - Inventory.count(s.save, 'berry'));

// Every hostile the SURFACE can hold, off the tables that seat them (never a
// hand list — a kind added to the roster or a lair ladder is audited here the
// moment it exists): every EnemyRoster row with a `surface` habitat (the wild
// encounter budget, the park plants, the night's ghost), every kind on a
// Lairs.KIND_ORDER ladder (ruins, gates, cafés, barricades, the burned row's
// fire slime), the wild slime, every hostile the fauna spawner seats (the
// raven) — plus a hunted deer while it is angry, as a free foe, a lair guard
// and a bounty foe.
const KINDS = [...new Set(['slime',
  ...EnemyRoster.ROWS.filter((row) => row.surface).map((row) => row.id),
  // …and every hostile the SHORE seats by its own rule (the gull), and every
  // one the FAUNA spawner seats (the raven).
  ...SHORE_FAUNA_ORDER.filter((kind) => Combat.isEnemyKind(kind)),
  ...FAUNA_ORDER.filter((kind) => Combat.isEnemyKind(kind)),
  ...Object.values(Lairs.KIND_ORDER).flat()])];
function foes() {
  const out = KINDS.map((kind) => ({ label: kind, make: (p) => ({ kind, id: `${kind}_0_0_1`, x: p.x, y: p.y }) }));
  out.push({ label: 'hunted deer', make: (p) => ({ kind: 'deer', id: 'deer_0_0_1', x: p.x, y: p.y, _rageUntil: Date.now() + 1e9 }) });
  out.push({ label: 'lair goblin', make: (p) => ({ kind: 'goblin', id: 'lair_x_0', x: p.x, y: p.y, immobile: true,
    lair: 'x', lairX: p.x, lairY: p.y, lairR: 0, seatX: p.x, seatY: p.y }) });
  out.push({ label: 'bounty goblin', make: (p) => ({ kind: 'goblin', id: 'guildfoe_0_0_1_0', x: p.x, y: p.y, bounty: 'b' }) });
  return out;
}
const atNight = (f) => { const was = window.__DAYLIGHT; window.__DAYLIGHT = 0; try { return f(); } finally { window.__DAYLIGHT = was; } };

// Walk the player from `from` along `path(t)` for `seconds`, recording the
// foe's every position. Returns { scene, trace }.
function walk(spec, foeAt, path, seconds) {
  return atNight(() => {
    const entry = street();
    const c = spec.make(foeAt);
    const scene = mkScene(entry, c, path(0));
    const trace = [];
    for (let ms = 0; ms < seconds * 1000; ms += TICK_MS) {
      const p = path(ms / 1000);
      scene.playerM.x = p.x; scene.playerM.y = p.y;
      tick(scene, entry);
      if (!scene.save.caught.includes(c.id)) trace.push({ x: c.x, y: c.y, b: bits(entry, c) });
    }
    return { scene, trace, c, entry };
  });
}
// Along a row, eastward at a walk (WALK_M_S).
const along = (row, col0 = 8) => (t) => ({ x: (col0 + 0.5) * CELL + WALK_M_S * t, y: (row + 0.5) * CELL });

test('kerb: the synthetic street carries worldgen\'s bits — the band inside its buffer', () => {
  const e = street();
  assert.truthy(e.roadClass[BAND_ROWS[0] * N] & B && e.roadClass[BAND_ROWS[0] * N] & K, 'the band is inside the buffer');
  assert.truthy(e.roadClass[VERGE_ROW * N] & K && !(e.roadClass[VERGE_ROW * N] & B), 'the verge row: buffer, not band');
  assert.falsy(e.roadClass[OPEN_ROW * N], 'open ground: neither');
  assert.eq(WorldGen.MAJOR_BUFFER_CELLS, 2.5, 'about one base reach (coords.js reachCells, 2.5 cells)');
});

test('kerb: the harness bites — every mobile hostile attacks a player in open ground', () => {
  // Without this the test below could pass for the wrong reason: a sim in
  // which nothing ever attacks anybody.
  for (const spec of foes()) {
    if (EnemyRoster.get(spec.label)?.attackType === 'none') continue;
    const r = walk(spec, at(10, OPEN_ROW + 1), () => at(10, OPEN_ROW), 30);
    assert.gt(attacks(r.scene), 0, `${spec.label}: attacked a player standing in the open`);
  }
});

test('kerb: for EVERY hostile, stepping onto the road is never better than walking the verge', () => {
  for (const spec of foes()) {
    // The foe starts on the open-ground side, as close as any of them may be
    // seated (a fast foe never spawns in the buffer): one row past its edge.
    const start = at(8, BAND_ROWS[1] + BUF + 2);
    const verge = walk(spec, start, along(VERGE_ROW), 40);
    const road = walk(spec, start, along(BAND_ROWS[0]), 40);
    assert.lte(attacks(verge.scene), attacks(road.scene),
      `${spec.label}: the verge cost ${attacks(verge.scene)}, the road ${attacks(road.scene)}`);
    assert.eq(attacks(verge.scene), 0, `${spec.label}: nothing lands on a player walking the pavement`);
    for (const r of [verge, road]) {
      assert.falsy(r.trace.some((p) => p.b & B), `${spec.label}: never set foot on the band`);
    }
  }
});

test('kerb: a fast foe never crosses into the buffer — the chase ends at its edge', () => {
  for (const spec of foes()) {
    const c = spec.make(at(0, 0));
    const fast = isFastMover(c, CELL);
    // Chase a player who walks from open ground to the kerb and waits there.
    const path = (t) => {
      const from = at(10, BAND_ROWS[1] + BUF + 6), to = at(10, VERGE_ROW);
      const k = Math.min(1, (t * WALK_M_S) / Math.hypot(to.x - from.x, to.y - from.y));
      return { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k };
    };
    const r = walk(spec, at(10, BAND_ROWS[1] + BUF + 10), path, 60);
    if (fast) assert.falsy(r.trace.some((p) => p.b & K), `${spec.label} (fast) stepped into the kerb buffer`);
    assert.falsy(r.trace.some((p) => p.b & B), `${spec.label}: never on the band`);
  }
});

test('kerb: a foe hunting a player ACROSS the road never cuts over it — the band refused, the buffer too if fast', () => {
  // The player stands on the far pavement's outer edge (outside the buffer,
  // so nothing turns back): the straight line to them crosses the road, and
  // only the refused cells stop a foe taking it. Also exercises the idle
  // wander of a foe that has not seen them yet.
  const far = at(10, BAND_ROWS[0] - BUF - 1);
  let crossed = 0;
  for (const spec of foes()) {
    const c = spec.make(at(0, 0));
    const fast = isFastMover(c, CELL);
    const r = walk(spec, at(10, BAND_ROWS[1] + BUF + 1), () => far, 60);
    assert.falsy(r.trace.some((p) => p.b & B), `${spec.label}: never on the band`);
    if (fast) assert.falsy(r.trace.some((p) => p.b & K), `${spec.label} (fast) stepped into the kerb buffer`);
    else if (r.trace.some((p) => p.b & K)) crossed++;
    if (!fast) {
      // A slow foe may stand on the pavement: start it right at the band's
      // edge and let it hunt / wander there — it still never sets foot on it.
      const edge = walk(spec, at(10, BAND_ROWS[1] + 1), () => far, 60);
      assert.falsy(edge.trace.some((p) => p.b & B), `${spec.label}: from the kerb, never on the band`);
      if (edge.trace.some((p) => rowOf(p) === BAND_ROWS[1] + 1 && Math.abs(p.x - edge.trace[0].x) > CELL)) crossed++;
    }
  }
  assert.gt(crossed, 0, 'the harness bites: a slow foe does walk into the buffer toward them');
});

test('kerb: the fast kinds are the ones that out-run a walk, off the roster\'s own numbers', () => {
  const pace = (kind, over = {}) => foeChaseMps({ kind, ...over }, CELL);
  assert.gt(KINDS.length, 15, `the merged roster is audited (${KINDS.length} kinds)`);
  // ONE TABLE: a roster kind's chase pace IS the quickest speed its movement
  // row declares (base, charge, lunge, peak flight) — no list of fast kinds.
  for (const row of EnemyRoster.ROWS) {
    const mv = row.movement;
    const declared = Math.max(...Object.keys(mv).filter((k) => /peedMetersPerSecond$/.test(k)).map((k) => mv[k]));
    assert.eq(pace(row.id), declared, `${row.id}: paced off its row`);
    assert.eq(isFastMover({ kind: row.id }, CELL), declared > BRISK_WALK_MPS, `${row.id}: fast iff it out-runs a brisk walk`);
  }
  assert.truthy(BRISK_WALK_MPS > WALK_M_S, 'the line is a BRISK walk, over the stick\'s pace');
  assert.eq(pace('slime'), EnemyRoster.get('slime').movement.chargeSpeedMetersPerSecond, 'the wild slime at its charge');
  assert.lt(pace('slime'), BRISK_WALK_MPS, 'under a brisk walk: the wild slime is NOT fast (owner, Sep 2026)');
  assert.falsy(isFastMover({ kind: 'slime' }, CELL), 'so it is no fast foe');
  assert.lt(pace('zombie'), BRISK_WALK_MPS, 'a zombie you out-walk');
  assert.lt(pace('fire_slime'), BRISK_WALK_MPS, 'the fire slime too (its own combat row)');
  assert.gt(pace('goblin'), BRISK_WALK_MPS, 'a goblin runs');
  assert.gt(pace('bat'), BRISK_WALK_MPS, 'a bat swoops');
  assert.eq(pace('ghost'), Combat.GHOST_SPEED_MPS, 'a ghost glides at its row\'s mps');
  assert.gt(pace('deer'), BRISK_WALK_MPS, 'a hunted deer charges');
  // FAUNA: fast off their own gait / bolt rows (faunaTopMps) — the spawn
  // class follows (creatureSpawnClass), never a list of kinds.
  assert.gt(faunaTopMps('deer', CELL), BRISK_WALK_MPS, 'a deer bolts');
  assert.lt(faunaTopMps('cow', CELL), BRISK_WALK_MPS, 'a cow ambles');
  assert.eq(creatureSpawnClass('deer'), 'fastFauna', 'a deer is fast fauna');
  assert.eq(creatureSpawnClass('cat'), 'fauna', 'a cat is fauna');
  assert.eq(creatureSpawnClass('slime'), 'enemy', 'the wild slime a slow foe');
  assert.eq(creatureSpawnClass('goblin'), 'fastEnemy', 'a goblin a fast one');
  assert.truthy(WorldGen.SPAWN_CLASS_BLOCKS.fastEnemy & WorldGen.SPAWN_WHY.KERB, 'fast foes refuse the kerb');
  assert.truthy(WorldGen.SPAWN_CLASS_BLOCKS.fastFauna & WorldGen.SPAWN_WHY.KERB, 'fast fauna too');
  assert.truthy(WorldGen.SPAWN_CLASS_BLOCKS.reward & WorldGen.SPAWN_WHY.KERB, 'and a find you walk to (src/scenic.js)');
  for (const cls of ['enemy', 'fauna', 'npc', 'headstone', 'attractor', 'cave', 'minor']) {
    assert.falsy(WorldGen.SPAWN_CLASS_BLOCKS[cls] & WorldGen.SPAWN_WHY.KERB, `${cls}: not kept off the kerb`);
  }
});

test('kerb: the rules live on the lanes that exist (source pins)', () => {
  const w = SCENE_SRC.slice(SCENE_SRC.indexOf('  wanderCreatures() {'));
  assert.truthy(/const kerbLeash = inKerbAt\(this, px, py\);/.test(w), 'read once per tick, off the FEET');
  assert.truthy(/const standDown = frightened \|\| psychotic \|\| warded \|\| wanderOff \|\| kerbTurn \|\|/.test(w), 'a reason in standDown');
  assert.truthy(/Lairs\.guardState\(c, \{ x: px, y: py \}, this\.cellM, !unnoticed && !kerbTurn\)/.test(w), 'a guard gives up');
  assert.truthy(/if \(road & WorldGen\.ROAD_CLASS_MAJOR_BAND\) continue;/.test(w), 'the band is a refused cell');
  const spawn = SCENE_SRC.slice(SCENE_SRC.indexOf('  spawnInTile(entry, tx, ty) {'));
  assert.truthy(/roadClass: entry\.roadClass,/.test(spawn), 'the shared spawn options carry the bits');
  // The buffer is the spawn gate's KERB reason (entry.spawnWhy): each animal
  // or foe is seated at its own class (creatureSpawnClass — a fast one
  // refuses the kerb), a lair point an 'attractor'.
  assert.truthy(/spawnWhy: entry\.spawnWhy,/.test(spawn), 'the shared spawn options carry the gate');
  assert.truthy(/const spClass = creatureSpawnClass\(kindStr\);/.test(spawn), 'the class comes from each creature kind');
  assert.truthy(/if \(!WorldGen\.isSpawnCell\(genGrid, N, N, cx, cy, seatOpts, spClass\)\) return;/.test(spawn), 'fast fauna and foes are dropped from the buffer');
  assert.truthy(/const faunaSpawnOpts = \{ \.\.\._spawnOpts, occupied: null \};/.test(spawn), 'fauna overlap retains every ground and kerb restriction');
  assert.truthy(/&& isFastMover\(c, this\.cellM\)/.test(w), 'only a FAST mover is kept out of the buffer');
  assert.truthy(/relocateToSpawnCell\(genGrid, N, N, ix, iy, lairOpts, LAIR_POINT_SLACK_CELLS, 'attractor'\)/.test(spawn), 'and every lair candidate');
  assert.falsy(/BANDIT_STORY\.attracts/.test(SCENE_SRC), 'no animal is pulled onto a major verge');
});

test('kerb: isSpawnCell(…, \'fastEnemy\') (any foe — the fast row) is the spawn rule minus the buffer', () => {
  const e = street();
  const opts = { roadMask: null, occupied: new Set(), roadClass: e.roadClass };
  const g = e.grid;   // GRASS
  assert.truthy(WorldGen.isSpawnCell(g, N, N, 5, VERGE_ROW, opts), 'the verge is a spawn cell (scenery, pickups)');
  assert.falsy(WorldGen.isSpawnCell(g, N, N, 5, VERGE_ROW, opts, 'fastEnemy'), 'but no foe or animal seat');
  assert.truthy(WorldGen.isSpawnCell(g, N, N, 5, OPEN_ROW, opts, 'fastEnemy'), 'open ground takes one');
  assert.truthy(WorldGen.isSpawnCell(g, N, N, 5, VERGE_ROW, { ...opts, roadClass: null }, 'fastEnemy'), 'no bits, no buffer');
  assert.truthy(WorldGen.isSpawnCell(g, N, N, 5, VERGE_ROW, opts, 'enemy'), 'a SLOW foe may take the verge');
  assert.falsy(WorldGen.isSpawnCell(g, N, N, 5, VERGE_ROW, opts, 'fastFauna'), 'a fast animal may not');
});

test('kerb: a ghost never rises in the buffer', () => {
  const e = street();
  const scene = mkScene(e, { kind: 'slime', id: 'x', x: 0, y: 0 }, at(10, VERGE_ROW));
  const realGet = WorldGen.tileCache.get, realNear = WorldGen.forEachItemNear;
  WorldGen.tileCache.get = () => e;
  WorldGen.forEachItemNear = () => {};
  try {
    const p = at(10, BAND_ROWS[0]);
    assert.eq(__raiseGhostAt(scene, p.x, p.y, 1, 'hs'), null, 'on the band: refused');
    const q = at(10, OPEN_ROW);
    assert.truthy(__raiseGhostAt(scene, q.x, q.y, 2, 'hs'), 'open ground: risen');
  } finally { WorldGen.tileCache.get = realGet; WorldGen.forEachItemNear = realNear; }
});

// ── SAME SIDE: nothing time-sensitive across a major road ─────────────────
function sideScene(entry, feet) {
  return { cellM: CELL, depth: 0, tileEdgeM: EDGE, startWorldM: { x: 0, y: 0 }, playerM: { x: feet.x, y: feet.y } };
}
function withStreet(entry, f) {
  const realGet = WorldGen.tileCache.get;
  WorldGen.tileCache.get = (k) => (k === WorldGen.tileKey(0, 0) ? entry : undefined);
  try { return f(); } finally { WorldGen.tileCache.get = realGet; }
}

test('same side: the flood stops at the band — the far pavement is the other side', () => {
  const e = street();
  e._spawned = true;
  withStreet(e, () => {
    const s = sideScene(e, at(20, VERGE_ROW + 3));
    const near = at(24, VERGE_ROW), far = at(20, BAND_ROWS[0] - 2);
    assert.truthy(sameSideAs(s, near.x, near.y), 'this pavement: same side');
    assert.falsy(sameSideAs(s, far.x, far.y), 'across the road: not');
    const road = at(20, BAND_ROWS[0]);
    assert.falsy(sameSideAs(s, road.x, road.y), 'the road itself: not');
    // Standing IN the road, the nearest side is the one that counts, never both.
    const inRoad = sideScene(e, at(20, BAND_ROWS[1]));
    const n = sameSideAs(inRoad, near.x, near.y), f = sameSideAs(inRoad, far.x, far.y);
    assert.truthy(n !== f, 'in the road: one side, not both');
  });
});

test('same side: walkableDestination (the bounty\'s seat) never lands across the road', () => {
  const e = street();
  e._spawned = true;
  e._spawnOpts = { roadMask: null, occupied: new Set(), roadClass: e.roadClass };
  withStreet(e, () => {
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
      const feet = at(20, VERGE_ROW + 4);
      const s = sideScene(e, feet);
      const d = walkableDestination(s, feet.x, feet.y, 5, { seed, cls: 'fastEnemy' });
      assert.truthy(d, `${seed}: a seat`);
      assert.gt(d.iy, BAND_ROWS[1], `${seed}: on the player's side (row ${d.iy})`);
      assert.falsy(e.roadClass[d.iy * N + d.ix] & K, `${seed}: a foe seat is off the kerb buffer`);
    }
  });
});

test('same side: the timed rewards read it, and none waits under ten minutes', () => {
  const app = SCENE_SRC;
  const burst = app.slice(app.indexOf('  _coinBurstInteract(sx, sy, poi) {'), app.indexOf('  _coinCellsNearPlayer(count, r, taken) {'));
  assert.truthy(/sameSideAs\(this, /.test(burst), 'the coin burst');
  assert.truthy(/const COIN_BURST_LIFE_MS = 10 \* 60 \* 1000;/.test(app), 'coins wait ten minutes');
  const spawn = app.slice(app.indexOf('  _spawnGuildBounty(b, now = Date.now()) {'));
  assert.truthy(/cls: packClass,/.test(spawn.slice(0, 1000)), 'the bounty seats as its foes (walkableDestination is same-side)');
  const tickB = app.slice(app.indexOf('  _tickGuildBounty() {'));
  const body = tickB.slice(0, tickB.indexOf('\n  }\n'));
  assert.falsy(/CREATURE_SIM_CELLS/.test(body), 'the bounty has no walk-away leash');
  assert.truthy(/gb\.day !== utcDayKey\(\)/.test(body), 'it waits until the UTC day turns');
});

})();
