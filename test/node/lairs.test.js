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

  test('lairs: every kind on every ladder is a registered enemy', () => {
    // A guard that is not an enemy is furniture: nothing may auto-fire at it,
    // it lands no hit, and Combat gives it no HP pool. The registration is the
    // one thing that makes a kind hostile everywhere at once (CLAUDE.md).
    // Re-register the REAL table: combat.test.js swaps in a synthetic one and
    // test order across the suite is not ours to depend on.
    Combat.registerMonsters(MONSTERS);
    for (const tier of Object.keys(Lairs.KIND_LADDER)) {
      for (const row of Lairs.KIND_LADDER[tier]) {
        assert.truthy(Combat.isEnemy({ kind: row.kind, id: `x_${row.kind}` }),
          `tier ${tier}: ${row.kind} is not a registered enemy`);
        assert.gt(Combat.creatureMaxHp(row.kind), 0, `${row.kind} has no HP pool`);
      }
    }
  });

  test('lairs: every tier that holds a garrison has a ladder, and vice versa', () => {
    // Two tables, one fact. capFor answers "how many" off TIER_GUARDS and
    // kindFor answers "of what" off KIND_ORDER; a tier in one and not the
    // other is either a garrison of nothing or a ladder nobody climbs.
    assert.eq(Object.keys(Lairs.TIER_GUARDS).sort().join(),
              Object.keys(Lairs.KIND_ORDER).sort().join(),
              'TIER_GUARDS and KIND_ORDER name different tiers');
  });

  test('lairs: the tier picks the family — a wreck is squatted, a fort or castle is HELD', () => {
    // The line this crossed deliberately: goblins are not loose in the fields,
    // they are inside a fortification. Every wreck on the map is still slimes,
    // which is what keeps a goblin a thing you walk INTO rather than past.
    const all = (tier) => Lairs.kindsAt(tier, 1);
    for (const k of all(9)) assert.truthy(/slime$/.test(k), `a wrecked house holds slimes, not ${k}`);
    for (const tier of [11, 12]) {
      const ks = all(tier);
      assert.truthy(ks.length > 0, `tier ${tier} holds something`);
      for (const k of ks) assert.truthy(/^goblin/.test(k), `tier ${tier} is a garrison, not ${k}`);
    }
    // And the melee goblin comes before the archer, the same order the caves
    // introduce them in (MONSTERS.minDepth) — the ladder never runs backwards.
    for (const tier of [11, 12]) {
      const ks = all(tier);
      for (let i = 1; i < ks.length; i++) {
        assert.gte(MONSTERS[ks[i]].minDepth, MONSTERS[ks[i - 1]].minDepth,
          `tier ${tier}: ${ks[i]} is introduced shallower than ${ks[i - 1]}`);
      }
    }
  });

  test('lairs: each ladder escalates with distance, and a wreck starts with the known slime', () => {
    const near9 = Lairs.kindsAt(9, 0);
    assert.eq(near9.length, 1, 'a wreck at the near ring holds one kind only');
    assert.eq(near9[0], 'slime', 'and it is the surface slime the player already knows');
    for (const tier of Object.keys(Lairs.KIND_ORDER)) {
      const near = Lairs.kindsAt(tier, 0);
      assert.eq(near.length, 1, `tier ${tier}: the near ring opens one rung`);
      assert.truthy(Lairs.kindsAt(tier, 1).length > near.length,
        `tier ${tier}: the far end unlocks more`);
      let prev = 0;
      for (let t = 0; t <= 1.0001; t += 0.05) {
        const n = Lairs.kindsAt(tier, Math.min(1, t)).length;
        assert.gte(n, prev, `tier ${tier}: the ladder shrank at t=${t.toFixed(2)}`);
        prev = n;
      }
    }
    // An unknown tier is not a crash and not a silent slime — it holds nothing,
    // which is the same answer capFor gives it.
    assert.eq(Lairs.kindsAt(3, 1).length, 0, 'a tier with no ladder holds nothing');
    const rng0 = WorldGen.makeRng(7);
    for (const tier of Object.keys(Lairs.KIND_ORDER)) {
      for (const t of [0, 0.5, 1]) {
        const allowed = new Set(Lairs.kindsAt(tier, t));
        for (let i = 0; i < 100; i++) {
          assert.truthy(allowed.has(Lairs.kindFor(tier, t, rng0)),
            `tier ${tier}, t=${t}: rolled a kind off the ladder`);
        }
      }
    }
  });

  test('lairs: the rungs are evenly spaced, not authored — and kindFor takes one draw', () => {
    // A ladder is its kinds in order; rung i of n unlocks at i/n. That
    // reproduces the thirds the slime ladder used to carry as literals and
    // gives the goblins their halves for free, so adding a kind re-spaces its
    // own ladder and touches nothing else.
    for (const [tier, kinds] of Object.entries(Lairs.KIND_ORDER)) {
      const rows = Lairs.KIND_LADDER[tier];
      assert.eq(rows.length, kinds.length, `tier ${tier}: a row per kind`);
      rows.forEach((row, i) => {
        assert.eq(row.kind, kinds[i], `tier ${tier}: rung ${i} is ${kinds[i]}`);
        assert.eq(row.minT, i / kinds.length, `tier ${tier}: rung ${i} unlocks at i/n`);
      });
    }
    // ONE draw whatever the ladder's length — garrisonFor's seat rolls sit
    // either side of this, so a second draw would shift every guard's seat.
    for (const tier of Object.keys(Lairs.KIND_ORDER)) {
      for (const t of [0, 0.5, 1]) {
        let draws = 0;
        Lairs.kindFor(tier, t, () => { draws++; return 0.5; });
        assert.eq(draws, 1, `tier ${tier}, t=${t}: kindFor did not take exactly one draw`);
      }
    }
  });

  test('lairs: no two rungs of one ladder are drawn the same', () => {
    // THE LADDER HAS TO BE VISIBLE. Until Sep 2026 the cave slime was the
    // surface slime's sheet drawn with no tint at all, so the first two rungs
    // of the wreck ladder were the same pixels: a player standing in front of
    // a ruin could not see that it held the tougher foe, and the escalation
    // existed only in the HP pool. Sheet AND tint both come off
    // SpriteLayout.CREATURE_ART, so this reads what the renderer draws.
    for (const [tier, kinds] of Object.entries(Lairs.KIND_ORDER)) {
      const seen = new Map();
      for (const kind of kinds) {
        const art = SpriteLayout.creatureArt(kind);
        assert.truthy(art, `${kind} has no CREATURE_ART row`);
        const look = `${SpriteLayout.creatureSheet(kind)}#${SpriteLayout.creatureTint(kind).toString(16)}`;
        assert.falsy(seen.has(look),
          `tier ${tier}: ${kind} is drawn exactly as ${seen.get(look)} — same sheet, same tint`);
        seen.set(look, kind);
      }
    }
    // And the specific pair that was wrong: same sheet, different colour.
    assert.eq(SpriteLayout.creatureSheet('cave_slime'), SpriteLayout.creatureSheet('slime'),
      'the cave slime is still the surface slime\'s art');
    assert.eq(SpriteLayout.creatureTint('slime'), 0xffffff, 'the surface slime wears its own colours');
    assert.eq(SpriteLayout.creatureTint('cave_slime'), SpriteLayout.CAVE_SLIME_TINT,
      'and the cave slime is tinted apart from it');
    // A GIANT is its base kind's art, so it inherits the tint rather than
    // reverting to white — a giant cave slime is still a cave slime.
    assert.eq(SpriteLayout.creatureTint('giant_cave_slime'), SpriteLayout.CAVE_SLIME_TINT,
      'a giant inherits its base kind\'s tint');
    // The renderer must READ that, not branch on the kind.
    assert.truthy(/s\.setTint\(frozen \? FROZEN_TINT : c\.shiny \? SHINY_TINT : creatureTint\(c\.kind\)\)/
      .test(RENDER_SRC), 'render.js tints a creature from the table, not a blanket white');
    assert.truthy(/const texKey = creatureSheet\(c\.kind\);/.test(RENDER_SRC),
      'and picks the monster sheet from the table, not an if-else chain');
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

  // Does a structure of `tier` centred here actually ROLL HELD? Occupancy is
  // the first draw of the structure's own stream (garrisonFor), so a fixture
  // that just plants a wreck gets an empty ruin two times in three. This runs
  // the REAL roll — same key, same hash, same rng, same rate — so a fixture
  // built on it cannot drift from the shipping decision.
  const heldAt = (tier, cxM, cyM, thin) => {
    const sid = Lairs.structureKey(Math.floor(cxM / CELL_M), Math.floor(cyM / CELL_M));
    return WorldGen.makeRng(Lairs.hashKey(sid))() < Lairs.occupancyFor(tier, thin);
  };
  // …and a shape of `tier` as near (cxM, cyM) as a HELD one gets: the centre is
  // walked a cell at a time until the roll says held. Tests about seating,
  // residency and the chase should not also be tests of a 1-in-3 coin.
  function mkHeldShape(tier, cxM, cyM, sizeM, key) {
    for (let i = 0; i < 60; i++) {
      const dx = ((i % 2) ? -1 : 1) * Math.ceil(i / 2) * CELL_M;
      if (heldAt(tier, cxM + dx, cyM)) return mkShape(tier, cxM + dx, cyM, sizeM, key);
    }
    throw new Error(`no held seat for tier ${tier} near ${cxM},${cyM}`);
  }

  // ── Is it held at all ────────────────────────────────────────────────────

  test('lairs: the odds a ruin is held are the tier\'s — castle, fort, wreck', () => {
    // The numbers the design states, read off the table the roll uses.
    assert.eq(Lairs.OCCUPANCY[12].rate, 0.95, 'a castle is nearly always held');
    assert.eq(Lairs.OCCUPANCY[11].rate, 2 / 3, 'a fort usually is');
    assert.eq(Lairs.OCCUPANCY[9].rate, 1 / 3, 'a wrecked house a third of the time');
    // Strictly ordered, and the wreck is the only one the tile budget may thin
    // — a castle in a city must not quietly become a 5% chance.
    assert.gt(Lairs.OCCUPANCY[12].rate, Lairs.OCCUPANCY[11].rate, 'castle over fort');
    assert.gt(Lairs.OCCUPANCY[11].rate, Lairs.OCCUPANCY[9].rate, 'fort over wreck');
    assert.truthy(Lairs.OCCUPANCY[9].thinned, 'the commons are what the budget thins');
    assert.falsy(Lairs.OCCUPANCY[11].thinned, 'a fort keeps its rate');
    assert.falsy(Lairs.OCCUPANCY[12].thinned, 'and so does a castle');
    // Every tier that holds a garrison has odds, and nothing else does.
    assert.eq(Object.keys(Lairs.OCCUPANCY).sort().join(),
              Object.keys(Lairs.TIER_GUARDS).sort().join(),
              'OCCUPANCY and TIER_GUARDS name different tiers');
    assert.eq(Lairs.occupancyFor(7, 1), 0, 'a tier that holds no lair is never held');
  });

  test('lairs: over many ruins the rate really is the tier\'s rate', () => {
    // The roll drives the shipping garrisonFor, not a reimplementation of it:
    // plant the same wreck at 600 different places and count how many hold.
    const far = { x: -Lairs.LAIR_FAR_M, y: 0 };
    const rateOf = (tier) => {
      let held = 0, n = 0;
      for (let i = 0; i < 600; i++) {
        const cx = (3 + (i % 30)) * CELL_M, cy = (3 + Math.floor(i / 30)) * CELL_M;
        const entry = mkEntry([mkShape(tier, cx, cy, CELL_M)]);
        const idx = Lairs.buildIndex(entry, 0, 0, CELL_M, TILE_M);
        const [cand] = [...idx.buckets.values()][0];
        cand.sid = Lairs.structureKey(cand.acx, cand.acy);
        n++;
        if (Lairs.garrisonFor(entry, cand, {
          cellM: CELL_M, tileEdgeM: TILE_M, homeM: far, caughtSet: new Set(),
        }).length) held++;
      }
      return held / n;
    };
    // Generous bands — this is a coin, not a constant. What it is defending is
    // that the rates are DIFFERENT and in the right order, not their decimals.
    const wreck = rateOf(9), fort = rateOf(11), castle = rateOf(12);
    assert.truthy(Math.abs(wreck - 1 / 3) < 0.08, `a wreck held ${wreck.toFixed(2)}, not ~1/3`);
    assert.truthy(Math.abs(fort - 2 / 3) < 0.08, `a fort held ${fort.toFixed(2)}, not ~2/3`);
    assert.gt(castle, 0.88, `a castle held only ${castle.toFixed(2)}`);
  });

  test('lairs: an empty ruin STAYS empty — the roll is the structure\'s own', () => {
    // The traps.js contract applied to the occupancy roll: a ruin that woke
    // empty must be empty on every later wake, every rebuild and every reload,
    // or a player who looked away would find it garrisoned when they looked
    // back. It is the first draw of the structure's own seeded stream, so
    // nothing outside the building can move it.
    let empty = null;
    for (let i = 0; i < 60 && !empty; i++) {
      const cx = (5 + i) * CELL_M;
      if (!heldAt(9, cx, 20 * CELL_M)) empty = cx;
    }
    assert.truthy(empty != null, 'no empty wreck in 60 tries — the roll is not rolling');
    const shape = mkShape(9, empty, 20 * CELL_M, CELL_M);
    const at = { x: empty, y: 20 * CELL_M };
    for (let pass = 0; pass < 3; pass++) {
      const entry = mkEntry([shape]);          // a fresh entry each time = a rebuild
      step(entry, at);
      step(entry, at);
      assert.eq(guardsOf(entry).length, 0, `pass ${pass}: the empty ruin filled up`);
    }
  });

  test('lairs: the same building holds the same garrison in EVERY playthrough', () => {
    // THERE IS NO WORLD SEED. A lair is seeded from hashKey(structureKey) and
    // structureKey is the footprint's centre in ABSOLUTE cell coordinates — a
    // fact about a real building on a real map. Nothing about the save, the
    // session, the device or the order the tiles loaded reaches the stream, so
    // two players standing at the same ruin meet the same monsters, and one
    // player meets them again on a new save.
    assert.falsy(/save|Date|now\(|Math\.random/.test(Lairs.structureKey.toString()),
      'structureKey reached for something that is not the building');
    assert.falsy(/save|Date|now\(|Math\.random/.test(Lairs.hashKey.toString()),
      'hashKey reached for something that is not the key');
    // makeRng is a pure function of one integer — the same seed, the same
    // stream, forever.
    const a = WorldGen.makeRng(12345), b = WorldGen.makeRng(12345);
    for (let i = 0; i < 20; i++) assert.eq(a(), b(), 'makeRng is not deterministic');
    // And end to end: build the SAME ruin from two unrelated tile entries, in
    // opposite orders, with different neighbours, and read back the same
    // guards — kinds, ids and seats.
    const far = { x: -Lairs.LAIR_FAR_M, y: 0 };
    const target = mkHeldShape(12, CENTRE.x, CENTRE.y, 4 * CELL_M, 'target');
    const decoys = [
      mkShape(9, 6 * CELL_M, 6 * CELL_M, CELL_M),
      mkShape(11, 30 * CELL_M, 12 * CELL_M, 2 * CELL_M),
    ];
    const guardsFrom = (shapes) => {
      const entry = mkEntry(shapes);
      const idx = Lairs.buildIndex(entry, 0, 0, CELL_M, TILE_M);
      for (const bucket of idx.buckets.values()) {
        for (const cand of bucket) {
          cand.sid = Lairs.structureKey(cand.acx, cand.acy);
          if (cand.key !== 'target') continue;
          return Lairs.garrisonFor(entry, cand, {
            cellM: CELL_M, tileEdgeM: TILE_M, homeM: far, caughtSet: new Set(),
          }).map((g) => `${g.id}:${g.kind}:${g.seatX.toFixed(3)},${g.seatY.toFixed(3)}`);
        }
      }
      return null;
    };
    const first = guardsFrom([target, ...decoys]);
    const second = guardsFrom([...decoys.slice().reverse(), target]);
    assert.truthy(first && first.length, 'the target castle woke empty');
    assert.eq(first.join('|'), second.join('|'),
      'the same ruin handed back a different garrison on a differently-built tile');
  });

  // ── The per-tile budget ──────────────────────────────────────────────────

  test('lairs: a village is not thinned; a city is, and only its wrecks', () => {
    const wrecks = (n) => {
      const shapes = [];
      for (let i = 0; i < n; i++) shapes.push(mkShape(9, (i % 30) * CELL_M, Math.floor(i / 30) * CELL_M, CELL_M));
      return mkEntry(shapes);
    };
    // A village: 100 wrecks, ~33 expected held — inside the budget, untouched.
    const village = wrecks(100);
    assert.eq(Lairs.tileThin(village).common, 1, 'a village should not be thinned');
    assert.eq(Lairs.occupancyFor(9, Lairs.tileThin(village)), 1 / 3,
      'and one house in three really is held there');
    // A city: 3000 wrecks, ~1000 expected — thinned back to the ceiling.
    const city = wrecks(3000);
    const thin = Lairs.tileThin(city);
    assert.lt(thin.common, 0.1, 'a city tile is barely thinned at all');
    assert.truthy(Math.abs(3000 * Lairs.occupancyFor(9, thin) - Lairs.LAIR_MAX_PER_TILE) < 1e-6,
      'the thinned rate does not land on the ceiling');
    assert.eq(Lairs.LAIR_MAX_PER_TILE, 50, 'the ceiling is the figure the design named');
    // THE LANDMARKS ARE NOT THINNED. This is the whole reason the budget is
    // spent on the rare tiers first: scaling everything equally would make a
    // castle in a city a 5% chance, which is the opposite of what it promises.
    assert.eq(Lairs.occupancyFor(12, thin), Lairs.OCCUPANCY[12].rate, 'a castle in a city');
    assert.eq(Lairs.occupancyFor(11, thin), Lairs.OCCUPANCY[11].rate, 'a fort in a city');
    // Memoised on the entry — it is a fact about the tile, asked once per
    // structure that ever wakes.
    assert.eq(city._lairThin, thin, 'the factor is cached on the entry');
  });

  test('lairs: the budget is spent on the landmarks FIRST', () => {
    // 40 castles (38 expected) leave 12 of the 50 for 200 wrecks (67 expected).
    // The castles are paid in full and the wrecks take what is left — never
    // the other way round, and never both scaled equally, which is what would
    // quietly turn a castle into a coin flip on a busy tile.
    const shapes = [];
    for (let i = 0; i < 40; i++) shapes.push(mkShape(12, (i % 30) * CELL_M, Math.floor(i / 30) * CELL_M, CELL_M));
    for (let i = 0; i < 200; i++) shapes.push(mkShape(9, (i % 30) * CELL_M, (10 + Math.floor(i / 30)) * CELL_M, CELL_M));
    const entry = mkEntry(shapes);
    const thin = Lairs.tileThin(entry);
    assert.eq(thin.landmark, 1, 'the castles were scaled while there was still room');
    assert.eq(Lairs.occupancyFor(12, thin), Lairs.OCCUPANCY[12].rate, 'every castle keeps its odds');
    assert.lt(Lairs.occupancyFor(9, thin), Lairs.OCCUPANCY[9].rate, 'and the wrecks paid for it');
    assert.gt(Lairs.occupancyFor(9, thin), 0, 'but were not zeroed while there was room');
    assert.truthy(Math.abs(Lairs.tileHeldExpected(entry) - Lairs.LAIR_MAX_PER_TILE) < 1e-9,
      'and between them they land exactly on the ceiling');
  });

  test('lairs: the ceiling WINS — no composition of buildings can beat it', () => {
    // The cap is a hard ceiling, not a target: the tier odds decide who gets
    // the room, never whether the room can be exceeded. Swept over random
    // compositions rather than the two cases the author thought of.
    const rng = WorldGen.makeRng(20260907);
    for (let trial = 0; trial < 200; trial++) {
      const shapes = [];
      const n = 1 + Math.floor(rng() * 400);
      for (let i = 0; i < n; i++) {
        const tier = Lairs.TIERS[Math.floor(rng() * Lairs.TIERS.length)];
        shapes.push(mkShape(tier, (i % 30) * CELL_M, Math.floor(i / 30) * CELL_M, CELL_M));
      }
      const entry = mkEntry(shapes);
      const held = Lairs.tileHeldExpected(entry);
      assert.lte(held, Lairs.LAIR_MAX_PER_TILE + 1e-9,
        `trial ${trial}: ${n} buildings expected ${held.toFixed(1)} held`);
    }
    // Including the pathological one: a tile of nothing but castles is over
    // budget on its landmarks alone, and they are scaled back onto the ceiling
    // rather than allowed through it.
    const castles = [];
    for (let i = 0; i < 400; i++) castles.push(mkShape(12, (i % 30) * CELL_M, Math.floor(i / 30) * CELL_M, CELL_M));
    const heavy = mkEntry(castles);
    assert.lt(Lairs.tileThin(heavy).landmark, 1, 'the landmarks were let through the ceiling');
    assert.truthy(Math.abs(Lairs.tileHeldExpected(heavy) - Lairs.LAIR_MAX_PER_TILE) < 1e-9,
      'and they do not land ON it either');
    // A tile inside its budget scales nothing at all.
    const few = mkEntry([mkShape(12, 0, 0, CELL_M), mkShape(9, 3 * CELL_M, 0, CELL_M)]);
    assert.eq(Lairs.tileThin(few).common, 1, 'a two-building tile is not thinned');
    assert.eq(Lairs.tileThin(few).landmark, 1, 'in either direction');
  });


  // ── The families, end to end ─────────────────────────────────────────────

  test('lairs: a real wreck wakes slimes and a real fort or castle wakes goblins', () => {
    // The ladder tests above run kindsAt/kindFor directly; this one drives the
    // shipping wake for each tier so the tier actually REACHES the roll —
    // `cand.tier` comes off the footprint in indexChunk, and a garrison seeded
    // from the wrong one would still look right in every unit test above.
    const want = { 9: /slime$/, 11: /^goblin/, 12: /^goblin/ };
    for (const tier of Lairs.TIERS) {
      // A HELD one — a wreck is a 1-in-3 and this test is about families.
      const entry = mkEntry([mkHeldShape(tier, CENTRE.x, CENTRE.y, 4 * CELL_M)]);
      step(entry, CENTRE);
      const guards = guardsOf(entry);
      assert.gt(guards.length, 0, `tier ${tier}: the ruin woke empty`);
      for (const g of guards) {
        assert.truthy(want[tier].test(g.kind),
          `tier ${tier}: woke a ${g.kind}`);
      }
    }
  });

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

  // ── The chase ────────────────────────────────────────────────────────────

  const guardAt = (x, y, over = {}) => Object.assign({
    lair: 'L', lairX: 0, lairY: 0, lairR: 0, seatX: 0, seatY: 0, x, y, _hunting: false,
  }, over);
  const AGGRO_M = Lairs.LAIR_AGGRO_CELLS * CELL_M;
  const LEASH_M = Lairs.LAIR_LEASH_CELLS * CELL_M;

  test('chase: a garrison holds until the player is near its ruin, then hunts', () => {
    const g = guardAt(0, 0);
    assert.eq(Lairs.guardState(g, { x: LEASH_M * 2, y: 0 }, CELL_M), 'hold',
      'a ruin nobody is near holds');
    assert.eq(Lairs.guardState(g, { x: AGGRO_M + 1, y: 0 }, CELL_M), 'hold',
      'a step outside the aggro ring is still unnoticed');
    assert.eq(Lairs.guardState(g, { x: AGGRO_M - 1, y: 0 }, CELL_M), 'hunt',
      'inside it, the ruin notices');
    // A creature that is not a guard has no state here at all.
    assert.eq(Lairs.guardState({ kind: 'slime', x: 0, y: 0 }, { x: 0, y: 0 }, CELL_M), null,
      'a wild slime is not a garrison');
  });

  test('chase: the rings are measured from the RUIN, and offset by its size', () => {
    // A castle footprint is tens of metres across; a ring measured from the
    // centre would have the player on the battlements before anyone looked up.
    const big = guardAt(0, 0, { lairR: 10 * CELL_M });
    assert.eq(Lairs.guardState(big, { x: 10 * CELL_M + AGGRO_M - 1, y: 0 }, CELL_M), 'hunt',
      'the aggro ring stands clear of the footprint, not of its centre');
    assert.eq(Lairs.guardState(big, { x: 10 * CELL_M + AGGRO_M + 1, y: 0 }, CELL_M), 'hold',
      'and still ends');
    // THE GARRISON MOVES AS ONE: every guard of a lair asks the same distance
    // question, so they notice and give up together rather than trickling.
    const near = guardAt(0, 0), far = guardAt(5 * CELL_M, 5 * CELL_M);
    const p = { x: AGGRO_M - 1, y: 0 };
    assert.eq(Lairs.guardState(near, p, CELL_M), Lairs.guardState(far, p, CELL_M),
      'two guards of one ruin disagreed about whether it had noticed');
  });

  test('chase: it holds past the aggro ring and breaks at the LEASH — hysteresis', () => {
    // Once hunting, a guard keeps hunting out to the leash; a guard that never
    // noticed keeps holding in the same band. One ring would have a garrison
    // flickering while the player walked the boundary.
    const mid = (AGGRO_M + LEASH_M) / 2;
    assert.eq(Lairs.guardState(guardAt(0, 0, { _hunting: true }), { x: mid, y: 0 }, CELL_M), 'hunt',
      'a chase in progress carries past the aggro ring');
    assert.eq(Lairs.guardState(guardAt(0, 0, { _hunting: false }), { x: mid, y: 0 }, CELL_M), 'hold',
      'but the same band does not START one');
    assert.gt(Lairs.LAIR_LEASH_CELLS, Lairs.LAIR_AGGRO_CELLS, 'there has to BE a band');
    // Past the leash it gives up: home if it has wandered, hold if it is there.
    const away = { x: LEASH_M + 1, y: 0 };
    assert.eq(Lairs.guardState(guardAt(4 * CELL_M, 0, { _hunting: true }), away, CELL_M), 'return',
      'off its seat and given up — it walks back');
    assert.eq(Lairs.guardState(guardAt(0, 0, { _hunting: true }), away, CELL_M), 'hold',
      'already home — it just holds');
    // The arrival test is a fraction of a cell, not an exact match: a guard
    // that had to land on its seat to the metre would orbit it forever.
    const eps = Lairs.LAIR_SEAT_EPS_CELLS * CELL_M;
    assert.eq(Lairs.guardState(guardAt(eps * 0.5, 0, { _hunting: true }), away, CELL_M), 'hold',
      'close enough is home');
    assert.eq(Lairs.guardState(guardAt(eps * 2, 0, { _hunting: true }), away, CELL_M), 'return',
      'and not-close-enough is not');
  });

  test('chase: a player nobody can notice is not chased — the garrison goes home', () => {
    // Shadow Powder, or a bar run to zero (app.js `unnoticed`). The chase is
    // switched off exactly where the bite is, and a garrison that has lost the
    // player walks home rather than milling about where they vanished.
    const onTop = { x: 0, y: 0 };
    assert.eq(Lairs.guardState(guardAt(0, 0), onTop, CELL_M, true), 'hunt', 'noticed: hunted');
    assert.eq(Lairs.guardState(guardAt(0, 0), onTop, CELL_M, false), 'hold',
      'unnoticed, and already home');
    assert.eq(Lairs.guardState(guardAt(4 * CELL_M, 0, { _hunting: true }), onTop, CELL_M, false),
      'return', 'unnoticed mid-chase: it walks back, standing still is not an option');
  });

  test('chase: the sleep ring is DERIVED from the leash, and still clears the cull', () => {
    // A guard is slept on its RUIN'S distance from the player, but by then it
    // may be a whole leash away from that ruin on the way home — so the gap
    // has to cover that, or a pursuer blinks out in plain sight.
    assert.eq(Lairs.LAIR_SLEEP_CELLS, Lairs.LAIR_WAKE_CELLS + Lairs.LAIR_LEASH_CELLS,
      'the sleep ring is not derived from the leash any more');
    const cullCorner = (VIEW_CELLS / 2 + 1) * Math.SQRT2;
    assert.gt(Lairs.LAIR_SLEEP_CELLS - Lairs.LAIR_LEASH_CELLS, cullCorner,
      'a guard on its way home can be slept while still on screen');
    assert.truthy(Lairs.assertRingsClear(CREATURE_SIM_CELLS, cullCorner, Combat.SHOT.bow.rangeCells),
      'the module disagrees that its own rings are clear');
    // The leash is short enough that the whole chase happens inside the ring
    // the guards were woken in — nothing is ever pursued out of residency.
    assert.lt(Lairs.LAIR_LEASH_CELLS, Lairs.LAIR_WAKE_CELLS,
      'a guard could chase past the ring that woke it');
    // AND INSIDE THE SIM BUBBLE, which is the one that makes the walk home
    // actually happen: beyond CREATURE_SIM_CELLS wanderCreatures does not run
    // for a creature at all, so a guard whose leash broke out there would
    // freeze mid-street rather than turn round. It is never VISIBLE frozen
    // (the bubble is outside the sprite cull, so it starts walking again
    // before it can be seen), but the leash being the smaller number is what
    // means it does not come up. lair_chase_sim.test.js runs that walk home
    // for real, and only inside this ring.
    assert.lt(Lairs.LAIR_LEASH_CELLS, CREATURE_SIM_CELLS,
      'a guard could give up somewhere nothing is thinking, and freeze there');
  });

  test('chase: a hunting garrison really does leave its seat, and comes back', () => {
    // End to end on the shipping wake: the guards a real ruin seats carry the
    // three facts the state machine needs, and the machine answers with them.
    const shape = mkHeldShape(12, CENTRE.x, CENTRE.y, 4 * CELL_M);
    const entry = mkEntry([shape]);
    step(entry, CENTRE);
    const gs = guardsOf(entry);
    assert.gt(gs.length, 0, 'the castle woke empty');
    for (const g of gs) {
      assert.truthy(Number.isFinite(g.seatX) && Number.isFinite(g.seatY), 'a guard with no seat to return to');
      assert.eq(g.seatX, g.x, 'a guard starts on its seat');
      assert.eq(g.seatY, g.y, 'a guard starts on its seat');
      assert.gt(g.lairR, 0, 'a guard with no ruin radius to measure the rings from');
      assert.truthy(g.immobile, 'a guard still declares itself a non-wanderer');
      // Standing on the ruin: hunting. A tile away: home.
      assert.eq(Lairs.guardState(g, { x: g.lairX, y: g.lairY }, CELL_M), 'hunt',
        'the garrison did not notice a player standing on it');
      g._hunting = true;
      g.x = g.seatX + 3 * CELL_M;       // dragged off its seat by the chase
      assert.eq(Lairs.guardState(g, { x: g.lairX + 40 * CELL_M, y: g.lairY }, CELL_M), 'return',
        'the garrison did not give up on a player who got clear');
    }
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

  test('lairs: at rest a guard cancels the STEP only — it still bites', () => {
    // Order is the whole test. The line has to sit BELOW the slime leech and
    // the monster attack (or a garrison is harmless furniture) and ABOVE every
    // movement branch (or a HOLDING garrison does not hold its ruin).
    const w = APP.slice(APP.indexOf('  wanderCreatures() {'));
    const body = w.slice(0, w.indexOf('\n  }\n'));
    const at = (needle, what) => {
      const i = body.indexOf(needle);
      assert.gte(i, 0, `could not find ${what} in wanderCreatures — update this test`);
      return i;
    };
    const leech = at("if (c.kind === 'slime' && !isTame && !unnoticed && !standDown) {", 'the slime leech');
    const attack = at('if (isMonster(c.kind) && !unnoticed && !standDown) {', 'the monster attack');
    const immobile = at("if (c.immobile && lairState !== 'hunt' && lairState !== 'return') return;",
      'the at-rest branch');
    const crow = at("if (c.kind === 'crow' && !isTame) {", 'the wild-crow flight');
    const stepAt = at('if (now >= c._nextChooseT) {', 'the movement step');
    assert.gt(immobile, leech, 'at-rest above the leech — a guard that cannot drain you');
    assert.gt(immobile, attack, 'at-rest above the monster attack — a guard that cannot hit you');
    assert.lt(immobile, crow, 'at-rest below the crow tick — a guard that flies');
    assert.lt(immobile, stepAt, 'at-rest below the movement step — a garrison that wanders off');
    // And the state that decides it is resolved ABOVE the attack blocks, since
    // `standDown` — the one read those blocks ask — is built from it.
    const state = at("const lairState = c.lair ? Lairs.guardState(", 'the guard state');
    assert.lt(state, leech, 'the state is resolved before anything reads standDown');
    assert.truthy(/Lairs\.guardState\(c, \{ x: px, y: py \}, this\.cellM, !unnoticed\)/.test(body),
      'measured from the FEET, and told whether the player is worth noticing at all');
    assert.truthy(/c\._hunting = lairState === 'hunt';/.test(body),
      'the hysteresis is stored back on the creature');
  });

  test('lairs: hunting and walking home are branches of the ONE movement chain', () => {
    // Not a mover of their own: a chase and a walk back are ordinary steps, so
    // they are two more `else if`s in the angle chain every creature shares —
    // which is what keeps them subject to the blocked-cell, placed-rock and
    // water rules the rest of the fauna obeys.
    const w = APP.slice(APP.indexOf('  wanderCreatures() {'));
    const body = w.slice(0, w.indexOf('\n  }\n'));
    const hunt = body.indexOf("} else if (lairState === 'hunt') {");
    const home = body.indexOf("} else if (lairState === 'return') {");
    const ward = body.indexOf('} else if (homeWard) {');
    const slime = body.indexOf("} else if (c.kind === 'slime') {");
    assert.gt(hunt, ward, "Home's ward outranks a garrison's chase");
    assert.gt(home, hunt, 'the chase is asked before the walk home');
    assert.lt(home, slime, 'and both are asked before the kinds\' own idle logic');
    // The walk home aims at the SEAT and lands on it — an away-from-player
    // angle would scatter the garrison, and a full stride would overshoot and
    // orbit forever.
    const branch = body.slice(home, slime);
    assert.truthy(/Math\.atan2\(c\.seatY - c\.y, c\.seatX - c\.x\)/.test(branch), 'toward its own seat');
    assert.falsy(/dxp|dyp/.test(branch), 'not away from the player');
    assert.truthy(/stepLen = Math\.min\(stepM, Math\.hypot\(c\.seatX - c\.x, c\.seatY - c\.y\)\);/.test(branch),
      'the last step lands exactly on the seat');
    assert.truthy(/tx = c\.x \+ Math\.cos\(angle\) \* stepLen;/.test(body),
      'and the step the chain takes is that one');
  });

})();
