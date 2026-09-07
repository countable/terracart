// DERELICT LAIRS — the hard-mode garrison squatting in an unclaimed ruin
// (src/lairs.js), plus the two places app.js has to meet it: the residency
// pass that wakes them and the one line in wanderCreatures that keeps them
// still.
//
// Four things this file exists to hold:
//
//   THE NUMBERS ARE DERIVED. A house 1, a fort 2, a castle 3 at the near ring
//   and a castle 15 at a kilometre are the ONLY authored figures; the ramp
//   between them and the other two tiers' ceilings fall out of the table. So
//   the tests re-derive rather than restate — a retuned TIER_GUARDS row moves
//   every figure here with it, and a fudge factor added inside the module
//   fails instead of quietly changing the curve.
//
//   A GARRISON BELONGS TO ITS BUILDING, NOT ITS TILE. It is seeded from the
//   footprint's own absolute-cell key, so waking a ruin at any time, in any
//   order, from any tile build, hands back the same monsters. That is what
//   makes residency safe, and every "does it depend on X" test below is
//   checking that nothing has crept back into the seed.
//
//   THE WAKE RING HAS TO CLEAR EVERY OTHER RING. If a garrison could be woken
//   inside the sim bubble, the sprite cull or bow range, the player would
//   watch a ruin fill up — or shoot at one that was still empty.
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
    for (const tier of Lairs.TIERS) {
      assert.eq(Lairs.capFor(tier, 0, CELL_M), 0, `tier ${tier}: home itself`);
      assert.eq(Lairs.capFor(tier, NEAR_M, CELL_M), 0, `tier ${tier}: ON the ring is still inside`);
      assert.eq(Lairs.capFor(tier, NEAR_M - 1, CELL_M), 0, `tier ${tier}: a metre short`);
      assert.gt(Lairs.capFor(tier, NEAR_M + 1, CELL_M), 0, `tier ${tier}: a metre past it holds one`);
    }
  });

  test('lairs: the named figures at the near ring — house 1, fort 2, castle 3', () => {
    const at = (tier) => Lairs.capFor(tier, NEAR_M + 0.5, CELL_M);
    assert.eq(at(9), Lairs.TIER_GUARDS[9], 'a wrecked house holds its figure');
    assert.eq(at(11), Lairs.TIER_GUARDS[11], 'a fort holds its figure');
    assert.eq(at(12), Lairs.TIER_GUARDS[12], 'a castle holds its figure');
    assert.eq(Lairs.TIER_GUARDS[9], 1, 'house: 1');
    assert.eq(Lairs.TIER_GUARDS[11], 2, 'fort: 2');
    assert.eq(Lairs.TIER_GUARDS[12], 3, 'castle: 3');
  });

  test('lairs: the ramp maxes at a kilometre, and the ceiling is the castle', () => {
    const far = Lairs.LAIR_FAR_M;
    assert.eq(Lairs.capFor(12, far, CELL_M), Lairs.LAIR_MAX_PER_STRUCTURE,
      'a castle at the far ring holds the ceiling');
    assert.eq(Lairs.LAIR_MAX_PER_STRUCTURE, 15, 'the ceiling is the figure the design named');
    // Clamped, not extrapolated, or a lair two towns over would hold hundreds.
    assert.eq(Lairs.capFor(12, far * 4, CELL_M), Lairs.LAIR_MAX_PER_STRUCTURE,
      'four kilometres out is the same as one');
    for (const tier of Lairs.TIERS) {
      assert.eq(Lairs.capFor(tier, far, CELL_M),
        Math.round(Lairs.TIER_GUARDS[tier] * Lairs.FAR_MUL),
        `tier ${tier} reaches its base times the one multiplier`);
    }
    assert.eq(Lairs.FAR_MUL, Lairs.LAIR_MAX_PER_STRUCTURE / Lairs.MAX_TIER_GUARDS,
      'FAR_MUL is derived from the ceiling and the table, never typed');
  });

  test('lairs: bigger is always more, further is always more', () => {
    for (let d = NEAR_M + 1; d <= Lairs.LAIR_FAR_M; d += 13) {
      const house = Lairs.capFor(9, d, CELL_M);
      const fort = Lairs.capFor(11, d, CELL_M);
      const castle = Lairs.capFor(12, d, CELL_M);
      assert.gte(fort, house, `at ${d}m a fort is never lighter than a house`);
      assert.gte(castle, fort, `at ${d}m a castle is never lighter than a fort`);
      for (const tier of Lairs.TIERS) {
        assert.gte(Lairs.capFor(tier, d + 13, CELL_M), Lairs.capFor(tier, d, CELL_M),
          `tier ${tier} never thins out further from home`);
      }
    }
  });

  test('lairs: a tier the table does not name holds nothing', () => {
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
    // "A house has 1, a fort has 2" is a promise, not an average.
    assert.eq([...seen(1)].join(), '1', 'a house always holds exactly one');
    assert.eq([...seen(2)].join(), '2', 'a fort always holds exactly two');
    const castle = seen(3);
    assert.truthy(castle.has(3), 'a castle can hold its full three');
    assert.truthy(castle.size > 1, 'and is not a fixed number either');
    const maxed = seen(Lairs.LAIR_MAX_PER_STRUCTURE);
    assert.truthy(maxed.has(Lairs.LAIR_MAX_PER_STRUCTURE), 'the ceiling is reachable');
    assert.truthy(maxed.size >= 4, 'a maxed lair is a range, not a constant');
  });

  test('lairs: countFor takes exactly one draw, whatever the cap', () => {
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
    assert.truthy(Lairs.kindsAt(1).length > near.length, 'the far end unlocks more');
    let prev = 0;
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const n = Lairs.kindsAt(Math.min(1, t)).length;
      assert.gte(n, prev, `the ladder shrank at t=${t.toFixed(2)}`);
      prev = n;
    }
    const rng = WorldGen.makeRng(7);
    for (const t of [0, 0.5, 1]) {
      const allowed = new Set(Lairs.kindsAt(t));
      for (let i = 0; i < 200; i++) {
        assert.truthy(allowed.has(Lairs.kindFor(t, rng)), `t=${t}: rolled a kind off the ladder`);
      }
    }
  });

  // ── A synthetic tile, driven through the REAL isSpawnCell and makeRng ────

  const N = 40;                        // cells per edge (small, so tests are quick)
  const TILE_M = N * CELL_M;

  function mkEntry(shapes, opts = {}) {
    const grid = new Uint8Array(N * N);           // 0 = GRASS, walkable
    const roadMask = new Uint8Array(N * N);
    if (opts.roadCol != null) for (let y = 0; y < N; y++) roadMask[y * N + opts.roadCol] = 1;
    if (opts.water) for (const [x, y] of opts.water) grid[y * N + x] = 3;   // T.WATER
    return {
      grid, roadMask, cellsPerEdge: N, tileEdgeM: TILE_M,
      buildingShapes: shapes, creatures: [],
      _spawnOpts: { roadMask },      // what spawnInTile stashes for this pass
    };
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
  const CENTRE = { x: 20 * CELL_M, y: 20 * CELL_M };

  // Run one residency pass over a single-tile ring with the player at `at`.
  function step(entry, at, over = {}) {
    return Lairs.stepResidency([{ entry, tx: 0, ty: 0 }], Object.assign({
      cellM: CELL_M, tileEdgeM: TILE_M, playerM: at, homeM: HOME,
      isClaimed: () => false, caughtSet: new Set(),
    }, over));
  }
  const guardsOf = (entry) => entry.creatures.filter((c) => c.lair);

  // ── The rings ────────────────────────────────────────────────────────────

  test('lairs: the wake ring clears the sim bubble, the sprite cull and bow range', () => {
    // Every number here is owned by another module. A garrison woken inside
    // any of these rings is one the player was already able to see or shoot.
    const cullCorner = (VIEW_CELLS / 2 + 1) * Math.SQRT2;      // render.js halfM box
    const bow = Combat.SHOT.bow.rangeCells;
    assert.gt(Lairs.LAIR_WAKE_CELLS, CREATURE_SIM_CELLS,
      'a guard could start thinking before it exists');
    assert.gt(Lairs.LAIR_WAKE_CELLS, cullCorner,
      'a guard could be woken inside the viewport — the player watches it appear');
    assert.gt(Lairs.LAIR_WAKE_CELLS, bow,
      'an arrow could reach a ruin that has not been woken yet');
    assert.gt(Lairs.LAIR_SLEEP_CELLS, Lairs.LAIR_WAKE_CELLS,
      'one ring instead of two would thrash a garrison on and off in place');
    // And the module agrees with this file about what it is clearing.
    assert.truthy(Lairs.assertRingsClear(CREATURE_SIM_CELLS, cullCorner, bow),
      'the module\'s own ring check disagrees with the numbers');
  });

  test('lairs: a ruin outside the wake ring holds nothing until you approach', () => {
    const entry = mkEntry([mkShape(12, CENTRE.x, CENTRE.y, 4 * CELL_M)]);
    const far = { x: CENTRE.x + (Lairs.LAIR_WAKE_CELLS + 3) * CELL_M, y: CENTRE.y };
    step(entry, far);
    assert.eq(guardsOf(entry).length, 0, 'a ruin woke from outside the wake ring');
    step(entry, CENTRE);
    assert.truthy(guardsOf(entry).length > 0, 'standing on the ruin did not wake it');
  });

  test('lairs: walking away sleeps the garrison, walking back brings the same one', () => {
    const entry = mkEntry([mkShape(12, CENTRE.x, CENTRE.y, 4 * CELL_M)]);
    step(entry, CENTRE);
    const woke = JSON.stringify(guardsOf(entry));
    assert.truthy(guardsOf(entry).length > 0, 'nothing woke — the test proves nothing');
    // Inside the sleep ring: still standing. Hysteresis is the whole point —
    // a garrison must not blink out the moment the wake ring is crossed.
    step(entry, { x: CENTRE.x + (Lairs.LAIR_WAKE_CELLS + 1) * CELL_M, y: CENTRE.y });
    assert.truthy(guardsOf(entry).length > 0, 'slept inside the sleep ring');
    step(entry, { x: CENTRE.x + (Lairs.LAIR_SLEEP_CELLS + 2) * CELL_M, y: CENTRE.y });
    assert.eq(guardsOf(entry).length, 0, 'walking away did not sleep the garrison');
    step(entry, CENTRE);
    assert.eq(JSON.stringify(guardsOf(entry)), woke,
      'the ruin held different monsters the second time you walked up to it');
  });

  test('lairs: a repeated pass in place neither duplicates nor re-rolls', () => {
    const entry = mkEntry([mkShape(12, CENTRE.x, CENTRE.y, 4 * CELL_M)]);
    step(entry, CENTRE);
    const first = JSON.stringify(guardsOf(entry));
    for (let i = 0; i < 5; i++) step(entry, CENTRE);
    assert.eq(JSON.stringify(guardsOf(entry)), first,
      'standing still duplicated or re-rolled the garrison');
  });

  // ── The seed belongs to the building ─────────────────────────────────────

  test('lairs: a garrison depends on its own building and nothing else', () => {
    // Same footprint, wildly different neighbours and list order. If the seed
    // had any tile-level ordering left in it, these would differ.
    const target = mkShape(12, CENTRE.x, CENTRE.y, 4 * CELL_M, 'target');
    const alone = mkEntry([target]);
    const crowded = mkEntry([
      mkShape(9, 8 * CELL_M, 8 * CELL_M, CELL_M),
      mkShape(11, 12 * CELL_M, 30 * CELL_M, 2 * CELL_M),
      target,
      mkShape(9, 31 * CELL_M, 9 * CELL_M, CELL_M),
    ]);
    step(alone, CENTRE);
    step(crowded, CENTRE);
    const mine = (e) => JSON.stringify(e.creatures.filter((c) => c.lair === guardsOf(alone)[0].lair));
    assert.truthy(guardsOf(alone).length > 0, 'nothing woke — the test proves nothing');
    assert.eq(mine(crowded), mine(alone),
      'the neighbours moved this ruin\'s garrison — the seed is not the building');
  });

  test('lairs: killing a guard removes THAT guard and moves no other', () => {
    // Per-structure seeding makes this structural rather than a discipline:
    // there is no shared stream for a defeated guard to take numbers out of.
    const entry = mkEntry([mkShape(12, CENTRE.x, CENTRE.y, 4 * CELL_M)]);
    step(entry, CENTRE);
    const before = guardsOf(entry);
    assert.truthy(before.length >= 2, 'need a few guards for this to mean anything');
    const victim = before[0].id;
    const fresh = mkEntry([mkShape(12, CENTRE.x, CENTRE.y, 4 * CELL_M)]);
    step(fresh, CENTRE, { caughtSet: new Set([victim]) });
    const after = guardsOf(fresh);
    assert.eq(after.length, before.length - 1, 'exactly one guard should be gone');
    assert.falsy(after.some((g) => g.id === victim), 'the defeated guard came back');
    assert.eq(JSON.stringify(after), JSON.stringify(before.filter((g) => g.id !== victim)),
      'clearing one guard moved the others');
  });

  test('lairs: the id is keyed on the building, not on its index in the tile', () => {
    // The polygon list is not stable — a rebuild that adds an Overpass
    // building shifts every index after it — so an index-keyed id would let a
    // guard the player had killed come back under a new name.
    const target = mkShape(12, CENTRE.x, CENTRE.y, 4 * CELL_M, 'target');
    const first = mkEntry([target]);
    const shifted = mkEntry([mkShape(9, 8 * CELL_M, 8 * CELL_M, CELL_M), target]);
    step(first, CENTRE);
    step(shifted, CENTRE);
    const idsAt = (e) => guardsOf(e).filter((g) => g.lair === guardsOf(first)[0].lair)
      .map((g) => g.id).sort().join();
    assert.eq(idsAt(shifted), idsAt(first), 'the ids moved with the polygon order');
    for (const g of guardsOf(first)) {
      assert.truthy(/^lair_-?\d+_-?\d+_\d+$/.test(g.id), `id is not building-keyed: ${g.id}`);
      // save.caught keeps a defeat forever, so an id must never look tamed.
      assert.falsy(g.id.startsWith('released_'), 'a guard id must not read as a pet');
    }
    assert.eq(new Set(guardsOf(first).map((g) => g.id)).size, guardsOf(first).length,
      'two guards share an id — one kill would drop both');
  });

  // ── Where they stand ─────────────────────────────────────────────────────

  test('lairs: a garrison is immobile, off the footprint and inside the tile', () => {
    const entry = mkEntry([mkShape(12, CENTRE.x, CENTRE.y, 4 * CELL_M)]);
    step(entry, CENTRE);
    const gs = guardsOf(entry);
    assert.truthy(gs.length > 0, 'a castle a kilometre out holds nothing');
    for (const g of gs) {
      assert.truthy(g.immobile === true, 'a guard that can walk is not a garrison');
      assert.truthy(g.x >= 0 && g.x < TILE_M && g.y >= 0 && g.y < TILE_M,
        'a guard was seated outside the tile it belongs to');
      const half = 2 * CELL_M;
      assert.falsy(Math.abs(g.x - CENTRE.x) < half && Math.abs(g.y - CENTRE.y) < half,
        'a guard was seated on the building it guards');
    }
  });

  test('lairs: NOTHING is seated on a road cell (the shared spawn rule, mask included)', () => {
    // The road invariant (CLAUDE.md): a spawner that reads terrain instead of
    // the mask is told "grass" for a cell the overlay paints as asphalt. This
    // tile's mask covers a column the GRID still calls grass.
    const shapes = [];
    for (let i = 0; i < 6; i++) shapes.push(mkShape(12, (18 + i) * CELL_M, (16 + i) * CELL_M, 3 * CELL_M));
    const entry = mkEntry(shapes, { roadCol: 20 });
    step(entry, CENTRE);
    const gs = guardsOf(entry);
    assert.truthy(gs.length > 0, 'nothing was placed — the test proves nothing');
    for (const g of gs) {
      const ix = Math.floor(g.x / CELL_M), iy = Math.floor(g.y / CELL_M);
      assert.falsy(entry.roadMask[iy * N + ix], `guard on a road cell at ${ix},${iy}`);
      assert.truthy(WorldGen.isSpawnCell(entry.grid, N, N, ix, iy, entry._spawnOpts),
        `guard on a cell the shared rule refuses at ${ix},${iy}`);
    }
  });

  test('lairs: a ruin with nowhere to stand holds fewer, not somewhere wrong', () => {
    const water = [];
    for (let y = 14; y <= 26; y++) for (let x = 14; x <= 26; x++) water.push([x, y]);
    const entry = mkEntry([mkShape(12, CENTRE.x, CENTRE.y, 4 * CELL_M)], { water });
    step(entry, CENTRE);
    assert.eq(guardsOf(entry).length, 0, 'a guard was seated on water');
  });

  test('lairs: a claimed structure holds nothing', () => {
    const shapes = [mkShape(12, CENTRE.x, CENTRE.y, 4 * CELL_M, 'mine')];
    const open = mkEntry(shapes);
    step(open, CENTRE);
    assert.truthy(guardsOf(open).length > 0, 'unclaimed, it is held');
    const claimed = mkEntry(shapes);
    step(claimed, CENTRE, { isClaimed: (k) => k === 'mine' });
    assert.eq(guardsOf(claimed).length, 0, 'a ruin the player has taken back still held monsters');
  });

  test('lairs: a structure inside the home ring holds nothing', () => {
    const entry = mkEntry([mkShape(12, CENTRE.x, CENTRE.y, 4 * CELL_M)]);
    step(entry, CENTRE, { homeM: { x: CENTRE.x, y: CENTRE.y } });
    assert.eq(guardsOf(entry).length, 0, 'a lair was seated inside the safe ring around home');
  });

  test('lairs: no anchor yet means no lair, not a crash', () => {
    for (const home of [null, undefined, {}, { x: NaN, y: 0 }]) {
      const entry = mkEntry([mkShape(12, CENTRE.x, CENTRE.y, 4 * CELL_M)]);
      step(entry, CENTRE, { homeM: home });
      assert.eq(guardsOf(entry).length, 0, 'woke without an anchor to measure from');
    }
  });

  test('lairs: a tile whose spawn pass has not run is skipped, not approximated', () => {
    // Without the tile's shared spawn options there is no road mask, and the
    // road rule is not something to guess at — the pass waits a beat instead.
    const entry = mkEntry([mkShape(12, CENTRE.x, CENTRE.y, 4 * CELL_M)]);
    entry._spawnOpts = null;
    step(entry, CENTRE);
    assert.eq(guardsOf(entry).length, 0, 'woke a tile before its spawn options existed');
  });

  // ── Population ───────────────────────────────────────────────────────────

  test('lairs: what is alive tracks the PLAYER, not what the tile contains', () => {
    // The whole point of residency. Every tier-9 house is a wreck, so a city
    // tile is thousands of eligible ruins; only the ones around the player may
    // ever be creatures.
    const shapes = [];
    for (let y = 2; y < N - 2; y += 2) {
      for (let x = 2; x < N - 2; x += 2) shapes.push(mkShape(9, x * CELL_M, y * CELL_M, CELL_M));
    }
    const entry = mkEntry(shapes);
    assert.truthy(shapes.length > 200, 'the fixture should be a dense tile');
    step(entry, CENTRE);
    const gs = guardsOf(entry);
    assert.truthy(gs.length > 0, 'a dense tile woke nothing at all');
    assert.lte(gs.length, Lairs.LAIR_LIVE_MAX + Lairs.LAIR_MAX_PER_STRUCTURE,
      'the live cap did not hold');
    // And every one of them is inside the wake ring, not scattered over the tile.
    const wakeM = Lairs.LAIR_WAKE_CELLS * CELL_M;
    for (const g of gs) {
      assert.lte(Math.hypot(g.lairX - CENTRE.x, g.lairY - CENTRE.y), wakeM + 1e-6,
        'a guard is alive for a ruin outside the wake ring');
    }
  });

  test('lairs: the cap refuses new wakes — it never un-wakes what is standing', () => {
    // A garrison already in front of the player must not blink out because
    // they walked toward a different ruin.
    const shapes = [];
    for (let y = 2; y < N - 2; y += 2) {
      for (let x = 2; x < N - 2; x += 2) shapes.push(mkShape(9, x * CELL_M, y * CELL_M, CELL_M));
    }
    const entry = mkEntry(shapes);
    step(entry, CENTRE);
    const held = new Set(guardsOf(entry).map((g) => g.id));
    assert.truthy(held.size > 0, 'nothing woke — the test proves nothing');
    // A short step: everything still inside the sleep ring must still be here.
    const near = { x: CENTRE.x + 3 * CELL_M, y: CENTRE.y };
    step(entry, near);
    const sleepM = Lairs.LAIR_SLEEP_CELLS * CELL_M;
    const now = new Set(guardsOf(entry).map((g) => g.id));
    for (const g of guardsOf(entry)) held.delete(g.id);
    // Anything that left must have left by DISTANCE, never to make room.
    for (const id of held) {
      assert.falsy(now.has(id), 'bookkeeping error in the test');
    }
    const stillNear = guardsOf(entry).every((g) =>
      Math.hypot(g.lairX - near.x, g.lairY - near.y) <= sleepM + 1e-6);
    assert.truthy(stillNear, 'a guard survived past the sleep ring');
  });

  test('lairs: a cleared ruin is not re-rolled on every pass', () => {
    // A ruin whose guards are all dead holds no creatures, and one ringed by
    // water never had any. Neither may be woken again and again for the rest
    // of the session — that is a wasted roll per ruin per pass, forever.
    const water = [];
    for (let y = 14; y <= 26; y++) for (let x = 14; x <= 26; x++) water.push([x, y]);
    const entry = mkEntry([mkShape(12, CENTRE.x, CENTRE.y, 4 * CELL_M)], { water });
    const first = step(entry, CENTRE);
    assert.eq(first.woken, 0, 'the drowned ruin seated somebody');
    for (let i = 0; i < 3; i++) {
      assert.eq(step(entry, CENTRE).woken, 0, 'a ruin that woke empty was woken again');
    }
    assert.truthy(entry._lairResident.size > 0, 'an empty wake left no record of itself');
  });

  test('lairs: a wound survives a sleep and a wake', () => {
    // Within a session, stepping out of the wake ring and back must not heal
    // a garrison — that would make retreating a free reset. Across a reload it
    // does heal, like every other creature (combat.js `_hp` is in memory only).
    const entry = mkEntry([mkShape(12, CENTRE.x, CENTRE.y, 4 * CELL_M)]);
    const hpMemo = new Map();
    step(entry, CENTRE, { hpMemo });
    const hurt = guardsOf(entry)[0];
    hurt._hp = 3;
    const id = hurt.id;
    step(entry, { x: CENTRE.x + (Lairs.LAIR_SLEEP_CELLS + 2) * CELL_M, y: CENTRE.y }, { hpMemo });
    assert.eq(guardsOf(entry).length, 0, 'the garrison did not sleep');
    step(entry, CENTRE, { hpMemo });
    const back = guardsOf(entry).find((g) => g.id === id);
    assert.truthy(back, 'the wounded guard did not come back');
    assert.eq(back._hp, 3, 'walking out of range and back healed the garrison');
  });

  // ── The index ────────────────────────────────────────────────────────────

  test('lairs: the index holds structures, not creatures, and buckets them', () => {
    const shapes = [];
    for (let y = 2; y < N - 2; y += 2) {
      for (let x = 2; x < N - 2; x += 2) shapes.push(mkShape(9, x * CELL_M, y * CELL_M, CELL_M));
    }
    shapes.push(mkShape(7, 5 * CELL_M, 5 * CELL_M, CELL_M));   // not a lair tier
    const idx = Lairs.buildIndex(mkEntry(shapes), 0, 0, CELL_M, TILE_M);
    let n = 0;
    for (const b of idx.buckets.values()) n += b.length;
    assert.eq(n, shapes.length - 1, 'the index took in a tier that holds no lair');
    assert.truthy(idx.buckets.size > 1, 'every structure landed in one bucket — the grid is not gridding');
    assert.eq(idx.bucketM, Lairs.LAIR_BUCKET_CELLS * CELL_M, 'the bucket is the documented size');
  });

  test('lairs: the index is SLICED — no pass walks a whole city in one frame', () => {
    // The only pass over every building on the tile, and it runs in update(),
    // which has no slicer of its own. A dense tile built in one go is a dropped
    // frame the first time the player walks into a city.
    const shapes = [];
    for (let i = 0; i < Lairs.LAIR_INDEX_CHUNK * 3 + 7; i++) {
      const x = 2 + (i % (N - 4)), y = 2 + (Math.floor(i / (N - 4)) % (N - 4));
      shapes.push(mkShape(9, x * CELL_M, y * CELL_M, CELL_M));
    }
    const entry = mkEntry(shapes);
    let passes = 0;
    while (!(entry._lairIndex && entry._lairIndex.done)) {
      Lairs.indexFor(entry, 0, 0, CELL_M, TILE_M);
      if (++passes > 50) break;
    }
    assert.gte(passes, 4, 'the whole tile was indexed in one pass — the slicing is gone');
    assert.truthy(entry._lairIndex.done, 'the index never finished');
    let n = 0;
    for (const b of entry._lairIndex.buckets.values()) n += b.length;
    assert.eq(n, shapes.length, 'slicing dropped or double-counted footprints');
    // And a half-built index is usable, not a crash or an empty answer: the
    // ruins it has taken in already wake normally.
    const half = mkEntry(shapes);
    Lairs.indexFor(half, 0, 0, CELL_M, TILE_M);
    assert.falsy(half._lairIndex.done, 'the fixture should not finish in one slice');
    step(half, CENTRE);        // must not throw
  });

  test('lairs: a footprint over the seam is seated against its OWN tile', () => {
    // A building whose centre sits a hair the wrong side of the tile boundary
    // must still be measured against the grid it was indexed from, or its
    // guards land against the neighbour's origin.
    const edge = mkShape(12, (N - 1) * CELL_M, 20 * CELL_M, 4 * CELL_M);
    const entry = mkEntry([edge]);
    const idx = Lairs.buildIndex(entry, 3, -2, CELL_M, TILE_M);
    const [cand] = [...idx.buckets.values()][0];
    assert.eq(cand.ox, 3 * TILE_M, 'the candidate forgot its own tile origin (x)');
    assert.eq(cand.oy, -2 * TILE_M, 'the candidate forgot its own tile origin (y)');
  });

  // ── The two call sites in app.js ─────────────────────────────────────────

  test('lairs: the residency pass is hard-mode, surface, throttled, off the feet', () => {
    const call = APP.slice(APP.indexOf('// DERELICT LAIRS — hard mode only. Wake'),
                           APP.indexOf('this.wanderCreatures();'));
    assert.truthy(call.includes('Difficulty.get().derelictLairs'),
      'the pass must read the mode flag — easy has no lairs at all');
    assert.truthy(call.includes('Lairs.stepResidency'), 'the module owns residency');
    assert.truthy(call.includes('(this.depth || 0) === 0'),
      'the world is GPS-mirrored — a cave level must not wake the ruins above it');
    assert.truthy(/_lastLairT/.test(call), 'the pass must be throttled, not run every frame');
    // The camera rule: a peek drag must not wake a ruin the player has not
    // walked to, so the pass is measured off playerM and never the anchor.
    assert.truthy(call.includes('this.startWorldM.x + this.playerM.x'),
      'residency must be measured from the feet');
    assert.falsy(/viewAnchor|peekM|viewCenter/.test(call), 'the camera crept into the wake ring');
    assert.truthy(call.includes('this._starterTrailAnchor()'),
      'distance must come from the FROZEN anchor, not a live Home that can move');
    assert.falsy(call.includes('homeWorldPos'),
      'the live Home resolver would re-rank every ruin the moment Home moves');
    assert.truthy(call.includes('caughtSet'), 'a defeated guard must not be woken again');
    assert.falsy(Difficulty.PROFILES.easy.derelictLairs, 'easy: a ruin is scenery');
    assert.truthy(Difficulty.PROFILES.hard.derelictLairs, 'hard: a ruin is held');
  });

  test('lairs: spawnInTile seats no garrison — it only stashes the spawn options', () => {
    // The eager pass is gone. What the tile build owes residency is the ONE
    // shared spawn options object (the road rule must not be re-derived), and
    // nothing else.
    const spawn = APP.slice(APP.indexOf('  spawnInTile(entry, tx, ty) {'),
                            APP.indexOf('entry._spawned = true;'));
    assert.truthy(spawn.includes('entry._spawnOpts = _spawnOpts;'),
      'residency has no road mask without this');
    assert.falsy(/Lairs\.(spawnForTile|garrisonFor|stepResidency)/.test(spawn),
      'the tile build is seating garrisons again — that is the population bug');
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
    const stepAt = at('if (now >= c._nextChooseT) {', 'the movement step');
    assert.gt(immobile, leech, 'immobile above the leech — a guard that cannot drain you');
    assert.gt(immobile, attack, 'immobile above the monster attack — a guard that cannot hit you');
    assert.lt(immobile, crow, 'immobile below the crow tick — a guard that flies');
    assert.lt(immobile, stepAt, 'immobile below the movement step — a garrison that wanders off');
  });

})();
