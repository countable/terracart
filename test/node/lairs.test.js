// DERELICT LAIRS — the hard-mode garrison squatting in an unclaimed ruin
// (src/lairs.js), plus the two places app.js has to meet it: the spawn pass
// that seats them and the one line in wanderCreatures that keeps them still.
//
// Three things this file exists to hold:
//
//   THE NUMBERS ARE DERIVED. A house 1, a fort 2, a castle 3 at the near ring
//   and a castle 15 at a kilometre are the ONLY authored figures; the ramp
//   between them and the other two tiers' ceilings fall out of the table. So
//   the tests re-derive rather than restate — a retuned TIER_GUARDS row moves
//   every figure here with it, and a fudge factor added inside the module
//   fails instead of quietly changing the curve.
//
//   THE DRAW MUST NOT SEE THE SAVE. Lairs are generated, never stored (the
//   traps.js contract), so killing one guard may remove exactly that guard and
//   must not move any other. That is the invariant the seat loop's comment is
//   about, and it is the easiest one in the module to break.
//
//   THEY MUST STILL BITE. `immobile` cancels the movement step and nothing
//   else. The pin below is on the ORDER of the line in wanderCreatures: above
//   the leech and the monster attack it would make a garrison harmless.
(function () {

  const APP = APP_JS_SRC;
  const CELL_M = 7;
  const NEAR_M = Lairs.LAIR_MIN_HOME_CELLS * CELL_M;

  // ── The curve ────────────────────────────────────────────────────────────

  test('lairs: nothing is seated inside the ring around home', () => {
    for (const tier of Lairs.TIER_ORDER) {
      assert.eq(Lairs.capFor(tier, 0, CELL_M), 0, `tier ${tier}: home itself`);
      assert.eq(Lairs.capFor(tier, NEAR_M, CELL_M), 0, `tier ${tier}: ON the ring is still inside`);
      assert.eq(Lairs.capFor(tier, NEAR_M - 1, CELL_M), 0, `tier ${tier}: a metre short`);
      assert.gt(Lairs.capFor(tier, NEAR_M + 1, CELL_M), 0, `tier ${tier}: a metre past it holds one`);
    }
  });

  test('lairs: the named figures at the near ring — house 1, fort 2, castle 3', () => {
    // Just past the ring, where the ramp has barely started: the cap is the
    // tier's own authored figure, which is what the design named.
    const at = (tier) => Lairs.capFor(tier, NEAR_M + 0.5, CELL_M);
    assert.eq(at(9), Lairs.TIER_GUARDS[9], 'a wrecked house holds its figure');
    assert.eq(at(11), Lairs.TIER_GUARDS[11], 'a fort holds its figure');
    assert.eq(at(12), Lairs.TIER_GUARDS[12], 'a castle holds its figure');
    // And those figures are the ones the design asked for.
    assert.eq(Lairs.TIER_GUARDS[9], 1, 'house: 1');
    assert.eq(Lairs.TIER_GUARDS[11], 2, 'fort: 2');
    assert.eq(Lairs.TIER_GUARDS[12], 3, 'castle: 3');
  });

  test('lairs: the ramp maxes at a kilometre, and the ceiling is the castle', () => {
    const far = Lairs.LAIR_FAR_M;
    assert.eq(Lairs.capFor(12, far, CELL_M), Lairs.LAIR_MAX_PER_STRUCTURE,
      'a castle at the far ring holds the ceiling');
    assert.eq(Lairs.LAIR_MAX_PER_STRUCTURE, 15, 'the ceiling is the figure the design named');
    // Past the far ring nothing grows any further — the ramp is clamped, not
    // extrapolated, or a lair two towns over would hold hundreds.
    assert.eq(Lairs.capFor(12, far * 4, CELL_M), Lairs.LAIR_MAX_PER_STRUCTURE,
      'four kilometres out is the same as one');
    // The other tiers scale by the SAME factor rather than by figures of their
    // own: that is what makes FAR_MUL derived instead of three more knobs.
    for (const tier of Lairs.TIER_ORDER) {
      assert.eq(Lairs.capFor(tier, far, CELL_M),
        Math.round(Lairs.TIER_GUARDS[tier] * Lairs.FAR_MUL),
        `tier ${tier} reaches its base times the one multiplier`);
    }
    assert.eq(Lairs.FAR_MUL, Lairs.LAIR_MAX_PER_STRUCTURE / Lairs.MAX_TIER_GUARDS,
      'FAR_MUL is derived from the ceiling and the table, never typed');
  });

  test('lairs: bigger is always more, further is always more', () => {
    // Monotonic in both axes at every step — a ruin that got SAFER further out
    // would invert the whole point of the mechanic.
    for (let d = NEAR_M + 1; d <= Lairs.LAIR_FAR_M; d += 13) {
      const house = Lairs.capFor(9, d, CELL_M);
      const fort = Lairs.capFor(11, d, CELL_M);
      const castle = Lairs.capFor(12, d, CELL_M);
      assert.gte(fort, house, `at ${d}m a fort is never lighter than a house`);
      assert.gte(castle, fort, `at ${d}m a castle is never lighter than a fort`);
      for (const tier of Lairs.TIER_ORDER) {
        assert.gte(Lairs.capFor(tier, d + 13, CELL_M), Lairs.capFor(tier, d, CELL_M),
          `tier ${tier} never thins out further from home`);
      }
    }
  });

  test('lairs: a tier the table does not name holds nothing', () => {
    // Terrain codes that are not buildings, and building tiers nobody authored:
    // the table is the whole list, so a new tier is an explicit decision.
    for (const tier of [0, 5, 7, 10, 13, 99, undefined, null]) {
      assert.eq(Lairs.capFor(tier, Lairs.LAIR_FAR_M, CELL_M), 0, `tier ${tier}: no lair`);
    }
  });

  // ── The roll ─────────────────────────────────────────────────────────────

  test('lairs: the roll never exceeds the cap and never empties a lair', () => {
    const rng = WorldGen.makeRng(12345);
    for (let cap = 1; cap <= Lairs.LAIR_MAX_PER_STRUCTURE; cap++) {
      for (let i = 0; i < 200; i++) {
        const n = Lairs.countFor(cap, rng);
        assert.lte(n, cap, `cap ${cap}: rolled over the cap`);
        assert.gte(n, 1, `cap ${cap}: rolled an empty lair — a held ruin holds something`);
      }
    }
  });

  test('lairs: the small tiers are exact, the big ones vary', () => {
    const rng = WorldGen.makeRng(999);
    const seen = (cap) => {
      const s = new Set();
      for (let i = 0; i < 400; i++) s.add(Lairs.countFor(cap, rng));
      return s;
    };
    // "A house has 1, a fort has 2" is a promise, not an average: the slack
    // floors to zero at those caps, so they are always exactly their figure.
    assert.eq([...seen(1)].join(), '1', 'a house always holds exactly one');
    assert.eq([...seen(2)].join(), '2', 'a fort always holds exactly two');
    // "A castle TYPICALLY has 3" — so the cap is in the spread, and so is less.
    const castle = seen(3);
    assert.truthy(castle.has(3), 'a castle can hold its full three');
    assert.truthy(castle.size > 1, 'and is not a fixed number either');
    // A maxed castle spans a real range rather than always handing over 15.
    const maxed = seen(Lairs.LAIR_MAX_PER_STRUCTURE);
    assert.truthy(maxed.has(Lairs.LAIR_MAX_PER_STRUCTURE), 'the ceiling is reachable');
    assert.truthy(maxed.size >= 4, 'a maxed lair is a range, not a constant');
  });

  test('lairs: countFor takes exactly one draw, whatever the cap', () => {
    // The module documents this so a caller can reason about the stream; a
    // second draw here would shift every seat that follows.
    for (const cap of [1, 2, 3, 8, 15]) {
      let draws = 0;
      const rng = () => { draws++; return 0.5; };
      Lairs.countFor(cap, rng);
      assert.lte(draws, 1, `cap ${cap}: countFor drew more than once`);
    }
  });

  // ── What is in it ────────────────────────────────────────────────────────

  test('lairs: every kind on the ladder is a registered enemy', () => {
    // A guard that is not an enemy is furniture: nothing may auto-fire at it,
    // it lands no hit, and Combat gives it no HP pool. The registration is the
    // one thing that makes a kind hostile everywhere at once (CLAUDE.md).
    // Re-register the REAL table: combat.test.js swaps in a synthetic one and
    // test order across the suite is not ours to depend on.
    Combat.registerMonsters(MONSTERS);
    for (const row of Lairs.KIND_LADDER) {
      assert.truthy(Combat.isEnemy({ kind: row.kind, id: `x_${row.kind}` }),
        `${row.kind} is not a registered enemy`);
      assert.gt(Combat.creatureMaxHp(row.kind), 0, `${row.kind} has no HP pool`);
    }
  });

  test('lairs: the type ladder escalates with distance, and starts with the known slime', () => {
    const near = Lairs.kindsAt(0);
    assert.eq(near.length, 1, 'a lair at the near ring holds one kind only');
    assert.eq(near[0], 'slime', 'and it is the surface slime the player already knows');
    const far = Lairs.kindsAt(1);
    assert.truthy(far.length > near.length, 'the far end unlocks more than the near end');
    // Monotonic: a kind never disappears further out.
    let prev = 0;
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const n = Lairs.kindsAt(Math.min(1, t)).length;
      assert.gte(n, prev, `the ladder shrank at t=${t.toFixed(2)}`);
      prev = n;
    }
    // Every kind the roller can return is on the ladder for that distance.
    const rng = WorldGen.makeRng(7);
    for (const t of [0, 0.5, 1]) {
      const allowed = new Set(Lairs.kindsAt(t));
      for (let i = 0; i < 200; i++) {
        assert.truthy(allowed.has(Lairs.kindFor(t, rng)), `t=${t}: rolled a kind off the ladder`);
      }
    }
  });

  // ── The pass ─────────────────────────────────────────────────────────────
  // A synthetic tile driven through the REAL WorldGen.isSpawnCell and the REAL
  // makeRng — the same technique fauna_spawn.test.js uses.

  const N = 40;                        // cells per edge (small, so tests are quick)
  const TILE_M = N * CELL_M;

  // A tile of open grass with one road column, and `shapes` building polygons.
  function mkEntry(shapes, opts = {}) {
    const grid = new Uint8Array(N * N);           // 0 = GRASS, walkable
    const roadMask = new Uint8Array(N * N);
    if (opts.roadCol != null) {
      for (let y = 0; y < N; y++) roadMask[y * N + opts.roadCol] = 1;
    }
    if (opts.water) for (const [x, y] of opts.water) grid[y * N + x] = 3;   // T.WATER
    return { grid, roadMask, cellsPerEdge: N, tileEdgeM: TILE_M, buildingShapes: shapes };
  }

  // A square footprint of `sizeM` metres centred on the tile-local point.
  function mkShape(tier, cxM, cyM, sizeM, key) {
    const h = sizeM / 2;
    return {
      tier, areaM2: sizeM * sizeM, key: key || `k_${tier}_${Math.round(cxM)}_${Math.round(cyM)}`,
      ring: new Float32Array([cxM - h, cyM - h, cxM + h, cyM - h, cxM + h, cyM + h, cxM - h, cyM + h]),
    };
  }

  // Home far enough away that the whole tile is well past the near ring.
  const HOME = { x: -Lairs.LAIR_FAR_M, y: 0 };
  function run(entry, over = {}) {
    return Lairs.spawnForTile(entry, 0, 0, Object.assign({
      cellM: CELL_M, tileEdgeM: TILE_M, homeM: HOME,
      isClaimed: () => false, caughtSet: new Set(),
      spawnOpts: { roadMask: entry.roadMask },
    }, over));
  }

  test('lairs: a garrison is seated, immobile, off the footprint and inside the tile', () => {
    const box = mkShape(12, 20 * CELL_M, 20 * CELL_M, 4 * CELL_M);
    const out = run(mkEntry([box]));
    assert.truthy(out.length > 0, 'a castle a kilometre out holds nothing');
    for (const g of out) {
      assert.truthy(g.immobile === true, 'a guard that can walk is not a garrison');
      assert.truthy(g.x >= 0 && g.x < TILE_M && g.y >= 0 && g.y < TILE_M,
        'a guard was seated outside the tile it belongs to');
      // Clear of the building's own footprint — nothing stands on a footing.
      const lx = g.x, ly = g.y;
      const half = 2 * CELL_M;
      const inside = Math.abs(lx - 20 * CELL_M) < half && Math.abs(ly - 20 * CELL_M) < half;
      assert.falsy(inside, 'a guard was seated on the building it guards');
    }
  });

  test('lairs: NOTHING is seated on a road cell (the shared spawn rule, mask included)', () => {
    // The road invariant (CLAUDE.md): a spawner that reads terrain instead of
    // the mask is told "grass" for a cell the overlay paints as asphalt. This
    // tile's mask covers a column the GRID still calls grass, so a pass that
    // skipped the mask would seat guards straight onto it.
    const shapes = [];
    for (let i = 0; i < 6; i++) shapes.push(mkShape(12, (18 + i) * CELL_M, (5 + i * 5) * CELL_M, 3 * CELL_M));
    const entry = mkEntry(shapes, { roadCol: 20 });
    const out = run(entry);
    assert.truthy(out.length > 0, 'nothing was placed — the test proves nothing');
    for (const g of out) {
      const ix = Math.floor(g.x / CELL_M), iy = Math.floor(g.y / CELL_M);
      assert.falsy(entry.roadMask[iy * N + ix], `guard on a road cell at ${ix},${iy}`);
      assert.truthy(WorldGen.isSpawnCell(entry.grid, N, N, ix, iy, { roadMask: entry.roadMask }),
        `guard on a cell the shared rule refuses at ${ix},${iy}`);
    }
  });

  test('lairs: a claimed structure holds nothing', () => {
    const shapes = [mkShape(12, 20 * CELL_M, 20 * CELL_M, 4 * CELL_M, 'mine')];
    assert.truthy(run(mkEntry(shapes)).length > 0, 'unclaimed, it is held');
    assert.eq(run(mkEntry(shapes), { isClaimed: (k) => k === 'mine' }).length, 0,
      'a ruin the player has taken back still held monsters');
  });

  test('lairs: a structure inside the home ring holds nothing', () => {
    const shapes = [mkShape(12, 20 * CELL_M, 20 * CELL_M, 4 * CELL_M)];
    const near = { x: 20 * CELL_M, y: 20 * CELL_M };     // home ON the castle
    assert.eq(run(mkEntry(shapes), { homeM: near }).length, 0,
      'a lair was seated inside the safe ring around home');
  });

  test('lairs: no anchor yet means no lair, not a crash', () => {
    const shapes = [mkShape(12, 20 * CELL_M, 20 * CELL_M, 4 * CELL_M)];
    for (const home of [null, undefined, {}, { x: NaN, y: 0 }]) {
      assert.eq(run(mkEntry(shapes), { homeM: home }).length, 0, 'placed without an anchor to measure from');
    }
  });

  test('lairs: the draw is deterministic — same tile, same garrison', () => {
    const shapes = [];
    for (let i = 0; i < 5; i++) shapes.push(mkShape(11, (6 + i * 6) * CELL_M, 20 * CELL_M, 3 * CELL_M));
    const a = run(mkEntry(shapes));
    const b = run(mkEntry(shapes));
    assert.eq(JSON.stringify(a), JSON.stringify(b), 'two builds of one tile laid different garrisons');
  });

  test('lairs: killing a guard removes THAT guard and moves no other', () => {
    // The invariant the seat loop is written around. If the roll or the seat
    // skipped a defeated guard, its draws would come out of the stream and
    // every guard laid after it would move — the world rearranging itself
    // behind the player, which is what "generated, never stored" rules out.
    const shapes = [];
    for (let i = 0; i < 5; i++) shapes.push(mkShape(11, (6 + i * 6) * CELL_M, 20 * CELL_M, 3 * CELL_M));
    const before = run(mkEntry(shapes));
    assert.truthy(before.length >= 4, 'need a few guards for this to mean anything');
    const victim = before[1].id;
    const after = run(mkEntry(shapes), { caughtSet: new Set([victim]) });
    assert.eq(after.length, before.length - 1, 'exactly one guard should be gone');
    assert.falsy(after.some((g) => g.id === victim), 'the defeated guard came back');
    assert.eq(JSON.stringify(after), JSON.stringify(before.filter((g) => g.id !== victim)),
      'clearing one guard moved the others — the stream saw the save');
  });

  test('lairs: ids are stable, unique and tile-keyed', () => {
    const shapes = [mkShape(12, 20 * CELL_M, 20 * CELL_M, 4 * CELL_M)];
    const out = Lairs.spawnForTile(mkEntry(shapes), 3, -7, {
      cellM: CELL_M, tileEdgeM: TILE_M, homeM: HOME,
      isClaimed: () => false, caughtSet: new Set(),
      spawnOpts: { roadMask: null },
    });
    const ids = new Set(out.map((g) => g.id));
    assert.eq(ids.size, out.length, 'two guards share an id — one kill would drop both');
    for (const g of out) {
      assert.truthy(/^lair_3_-7_\d+_\d+$/.test(g.id), `id is not tile-keyed: ${g.id}`);
      // save.caught keeps a defeat forever, so an id must never look tamed.
      assert.falsy(g.id.startsWith('released_'), 'a guard id must not read as a pet');
    }
  });

  test('lairs: the tile budget holds, and the landmarks are paid first', () => {
    // A dense tile: every tier-9 house is a wreck (app.js _isHouseWreck), so
    // "derelict" is very nearly "building" and an uncapped pass would seat
    // thousands. The budget caps the total; the largest tiers spend it first.
    const shapes = [];
    for (let y = 2; y < N - 2; y += 2) {
      for (let x = 2; x < N - 2; x += 2) shapes.push(mkShape(9, x * CELL_M, y * CELL_M, CELL_M));
    }
    const castleAt = shapes.length;
    shapes.push(mkShape(12, 30 * CELL_M, 30 * CELL_M, 4 * CELL_M, 'castle'));
    const out = run(mkEntry(shapes));
    assert.lte(out.length, Lairs.LAIR_TILE_BUDGET, 'the tile budget was blown');
    assert.truthy(out.length > 0, 'the budget starved the tile entirely');
    // The castle was pushed in LAST but is paid FIRST, so it is held even
    // though hundreds of houses would otherwise have spent the budget.
    assert.truthy(out.some((g) => g.id === `lair_0_0_${castleAt}_0`),
      'the castle went unguarded while the wrecked houses ate the budget');
  });

  test('lairs: a bound budget is spread over the tile, not spent in one corner', () => {
    // worldgen lists building polygons in broadly spatial order, so a budget
    // spent front-to-back would garrison one corner and leave the rest empty.
    const shapes = [];
    for (let y = 2; y < N - 2; y += 2) {
      for (let x = 2; x < N - 2; x += 2) shapes.push(mkShape(9, x * CELL_M, y * CELL_M, CELL_M));
    }
    const out = run(mkEntry(shapes));
    assert.eq(out.length, Lairs.LAIR_TILE_BUDGET, 'this tile should bind the budget exactly');
    const xs = out.map((g) => g.x), ys = out.map((g) => g.y);
    const spanX = Math.max(...xs) - Math.min(...xs);
    const spanY = Math.max(...ys) - Math.min(...ys);
    assert.gte(spanX, TILE_M * 0.7, 'the garrisons bunched along x');
    assert.gte(spanY, TILE_M * 0.7, 'the garrisons bunched along y');
    // And they are spread through it, not merely at two opposite ends: every
    // quarter of the tile carries some.
    for (const q of [0, 1, 2, 3]) {
      const inQ = out.filter((g) => Math.floor(g.y / (TILE_M / 4)) === q).length;
      assert.gt(inQ, 0, `quarter ${q} of the tile holds no lair at all`);
    }
  });

  test('lairs: a ruin with nowhere to stand holds fewer, not somewhere wrong', () => {
    // Ringed by water: every seat attempt is refused, and the answer is an
    // empty ruin rather than a guard pushed onto the lake.
    const water = [];
    for (let y = 14; y <= 26; y++) for (let x = 14; x <= 26; x++) water.push([x, y]);
    const shapes = [mkShape(12, 20 * CELL_M, 20 * CELL_M, 4 * CELL_M)];
    assert.eq(run(mkEntry(shapes, { water })).length, 0, 'a guard was seated on water');
  });

  // ── The two call sites in app.js ─────────────────────────────────────────

  test('lairs: the spawn pass is hard-mode only, and measured from the frozen anchor', () => {
    const call = APP.slice(APP.indexOf('// DERELICT LAIRS'), APP.indexOf('entry._spawned = true;'));
    assert.truthy(call.includes('Difficulty.get().derelictLairs'),
      'the pass must read the mode flag — easy has no lairs at all');
    assert.truthy(call.includes('Lairs.spawnForTile'), 'the module owns the placement');
    assert.truthy(call.includes('this._starterTrailAnchor()'),
      'distance must come from the FROZEN anchor, not a live Home that can move');
    assert.falsy(call.includes('homeWorldPos'),
      'homeWorldPos would re-rank every ruin the moment Home is adopted elsewhere');
    assert.truthy(call.includes('spawnOpts: _spawnOpts'),
      'the pass must get the tile\'s own spawn options — that is where the road mask is');
    assert.truthy(call.includes('caughtSet'), 'a defeated guard must not be re-seated');
    // Both modes are declared, so the flag is a real difference and not a
    // field only one profile carries.
    assert.falsy(Difficulty.PROFILES.easy.derelictLairs, 'easy: a ruin is scenery');
    assert.truthy(Difficulty.PROFILES.hard.derelictLairs, 'hard: a ruin is held');
  });

  test('lairs: immobile cancels the STEP only — the guard still bites', () => {
    // Order is the whole test. The line has to sit BELOW the slime leech and
    // the monster attack (or a garrison is harmless furniture) and ABOVE every
    // movement branch (or it does not hold its ruin).
    const w = APP.slice(APP.indexOf('  wanderCreatures() {'));
    const body = w.slice(0, w.indexOf('\n  }\n'));
    const at = (needle, what) => {
      const i = body.indexOf(needle);
      assert.gte(i, 0, `could not find ${what} in wanderCreatures — update this test`);
      return i;
    };
    const leech = at("if (c.kind === 'slime' && !isTame && !shadowed && !homeWard) {", 'the slime leech');
    const attack = at('if (isMonster(c.kind) && !shadowed && !homeWard) {', 'the monster attack');
    const immobile = at('if (c.immobile) return;', 'the immobile branch');
    const crow = at("if (c.kind === 'crow' && !isTame) {", 'the wild-crow flight');
    const step = at('if (now >= c._nextChooseT) {', 'the movement step');
    assert.gt(immobile, leech, 'immobile above the leech — a guard that cannot drain you');
    assert.gt(immobile, attack, 'immobile above the monster attack — a guard that cannot hit you');
    assert.lt(immobile, crow, 'immobile below the crow tick — a guard that flies');
    assert.lt(immobile, step, 'immobile below the movement step — a garrison that wanders off');
  });

})();
