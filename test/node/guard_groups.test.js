// GUARD GROUPS — the authored garrisons of src/lairs.js (Lairs.GROUPS, owner,
// Oct 2026): a horde, a decoy with orcs behind, an archer line, a ghost
// burst, the splitting slime, a bat swarm, a gull swarm, an elite alone and
// an elite with minions — plus the kinds that exist only for them (the goblin
// runt, the splitting slime, the storm gull) and the paces doubled the same
// day (every goblin and orc; the bats to the ceiling). A group is a HOUSE'S
// or a CASTLE'S (owner): a wreck's are one or two and ring the walls, a
// castle's are the big ones and start inside the keep; a fort takes none.
//
// What is pinned:
//   · THE TABLE: every member is a registered enemy with art, behaviour and a
//     pool; every tier named holds a lair; an `elite` member can be one; a
//     ghost member is dormant (proximityCells); the biggest group stays well
//     inside the live cap.
//   · THE DRAWS: groupFor is ONE draw (rate and pick off the same number),
//     seatPolar is TWO per try whatever the placement, so the plain garrison
//     and every group spend the stream alike.
//   · THE WAKE, END TO END: the real garrisonFor through stepResidency on a
//     synthetic tile — a horde of runts round the walls, the decoy out front
//     with its orcs opposite and told different notice rings, the elite shiny
//     in the knot, the ghosts over the roof, the gulls only by the shore.
//   · THE SPLIT: enemySplit on a stub scene — half the pool each side, a cell
//     away, the twin's id and lair fields, the bounty share, the cooldown and
//     the floor; and the two damage lanes that call it.
(function () {
  const CELL_M = 7, N = 40, TILE_M = N * CELL_M;
  const TAU = Math.PI * 2;
  Combat.registerMonsters(MONSTERS);

  function mkEntry(shapes, opts = {}) {
    const grid = new Uint8Array(N * N);
    // Paint each footprint as building ground, as a real tile would.
    for (const sh of shapes) {
      const r = sh.ring;
      for (let y = Math.floor(r[1] / CELL_M); y < Math.ceil(r[5] / CELL_M); y++) {
        for (let x = Math.floor(r[0] / CELL_M); x < Math.ceil(r[4] / CELL_M); x++) {
          if (x >= 0 && y >= 0 && x < N && y < N) grid[y * N + x] = WorldGen.T.BUILDING;
        }
      }
    }
    const roadMask = new Uint8Array(N * N);
    const entry = { grid, roadMask, cellsPerEdge: N, tileEdgeM: TILE_M, buildingShapes: shapes, creatures: [],
      _spawnOpts: { roadMask } };
    if (opts.shore) entry.scenic = { shore: { mask: opts.shore } };
    return entry;
  }
  function mkShape(tier, cxM, cyM, sizeM) {
    const h = sizeM / 2;
    // These fixtures exercise held groups, so use the guard-eligible Citadel.
    // Group RNG remains seeded from the unchanged tile/cell structureKey.
    const key = tier === 12 ? 'citadel' : `k_${tier}_${Math.round(cxM)}_${Math.round(cyM)}`;
    return { tier, areaM2: sizeM * sizeM, key,
      ring: new Float32Array([cxM - h, cyM - h, cxM + h, cyM - h, cxM + h, cyM + h, cxM - h, cyM + h]) };
  }
  const HOME = { x: -5000, y: 0 };
  const CENTRE = { x: 20 * CELL_M, y: 20 * CELL_M };
  function step(entry, at) {
    return Lairs.stepResidency([{ entry, tx: 0, ty: 0 }], { cellM: CELL_M, tileEdgeM: TILE_M, playerM: at,
      homeM: HOME, isClaimed: () => false, caughtSet: new Set() });
  }
  const guardsOf = (entry) => entry.creatures.filter((c) => c.lair);
  // The first three draws of a structure's stream, as garrisonFor takes them
  // (held?, strength, group?) — which group this ruin would take, or null.
  const groupAt = (tier, cxM, cyM, coastal) => {
    const sid = Lairs.structureKey(0, 0, Math.floor(cxM / CELL_M), Math.floor(cyM / CELL_M));
    const rng = WorldGen.makeRng(Lairs.hashKey(sid));
    if (rng() >= Lairs.occupancyFor(tier)) return false;
    const t = rng();
    return Lairs.groupFor(tier, t, rng, coastal);
  };
  // A shape near (cxM, cyM) whose ruin takes the NAMED group.
  function mkGroupShape(name, tier, sizeM, coastal = false) {
    for (let i = 0; i < 400; i++) {
      const dx = ((i % 2) ? -1 : 1) * Math.ceil(i / 2) * CELL_M;
      const dy = Math.floor(i / 40) * CELL_M;
      const cx = CENTRE.x + (dx % (14 * CELL_M)), cy = CENTRE.y + dy;
      if (groupAt(tier, cx, cy, coastal) === name) return mkShape(tier, cx, cy, sizeM);
    }
    throw new Error(`no seat takes group ${name} at tier ${tier}`);
  }
  // Woken on HARD (no group cap — Difficulty lairGuardMax; the easy test
  // below sets its own), so the whole composition stands.
  const wakeGroup = (name, tier, sizeM = 4 * CELL_M, opts = {}) => {
    const prev = Difficulty.mode();
    Difficulty.setMode(opts.mode || 'hard');
    try {
      const shape = mkGroupShape(name, tier, sizeM, !!opts.shore);
      const entry = mkEntry([shape], opts);
      step(entry, { x: shape.ring[0] + sizeM / 2, y: shape.ring[1] + sizeM / 2 });
      return { entry, guards: guardsOf(entry), shape, cx: shape.ring[0] + sizeM / 2, cy: shape.ring[1] + sizeM / 2 };
    } finally { Difficulty.setMode(prev); }
  };

  // ── The table ────────────────────────────────────────────────────────────
  test('guard groups: the owner\'s nine compositions are all in the table', () => {
    const G = Lairs.GROUPS;
    const has = (name, kinds) => {
      assert.truthy(G[name], `${name} is a group`);
      assert.eq(G[name].members.map((m) => m.kind).join(), kinds, `${name}'s members`);
    };
    has('horde', 'goblin_runt');                 // a horde of 15 weak goblins
    assert.eq(Lairs.memberCount(G.horde.members[0], 12), 15, 'fifteen of them');
    has('decoy', 'goblin,orc');                  // a decoy goblin with fast orcs behind
    has('archers', 'archer_goblin');             // a group of just archers
    has('ghosts', 'ghost');                      // a burst of ghosts
    has('haunting', 'ghost');                    // …and a wreck's pair
    has('splitter', 'split_slime');              // the slime that replicates when damaged
    has('bats', 'bat');                          // a swarm of bats
    has('roost', 'bat');                         // …and a wreck's pair
    has('gulls', 'storm_gull');                  // a swarm of seagulls
    assert.truthy(G.gulls.coastal, 'the gulls are a shore wreck\'s');
    has('elite_orc', 'orc');                     // one strong guy, elite
    has('elite_soldier', 'skeleton_soldier');
    has('warband', 'orc,goblin_runt');           // an elite with minions
    has('honour_guard', 'skeleton_soldier,skeleton');
    for (const name of ['elite_orc', 'elite_soldier', 'warband', 'honour_guard']) {
      assert.truthy(G[name].members[0].elite, `${name}: the elite leads the member order`);
    }
  });

  test('guard groups: a group is a house\'s or a castle\'s — a wreck\'s small and outside, a castle\'s inside the keep, a fort\'s none', () => {
    const inside = new Set(['core', 'floor', 'front', 'behind', 'cloud']);
    for (const [name, g] of Object.entries(Lairs.GROUPS)) {
      assert.eq(g.tiers.length, 1, `${name}: one tier, never both`);
      const habitat = Object.hasOwn(Lairs.HABITAT_TIER_GUARDS, g.tiers[0]);
      assert.truthy(g.tiers[0] === 9 || g.tiers[0] === 12 || habitat, `${name}: a house's, a castle's or a habitat site's, never a fort's`);
      const n = Lairs.expandGroup(name, g.tiers[0]).length;
      if (g.tiers[0] === 9 || habitat) {
        assert.lte(n, 4, `${name}: a wreck's group is small (${n})`);
        for (const m of g.members) assert.truthy(m.place === 'ring' || m.place === 'cloud', `${name}: a wreck's guards sit round or over it, never on its floor`);
      } else {
        for (const m of g.members) assert.truthy(inside.has(m.place), `${name}: a castle's guards start inside the keep (${m.place})`);
      }
    }
    const house = Object.values(Lairs.GROUPS).filter((g) => g.tiers[0] === 9);
    assert.gte(house.filter((g) => Lairs.expandGroup(Object.keys(Lairs.GROUPS).find((k) => Lairs.GROUPS[k] === g), 9).length <= 2).length, house.length / 2,
      'a wreck\'s groups are usually one or two');
    assert.eq(Lairs.groupRows(11, 1, true).length, 0, 'a fort offers no group');
    assert.eq(Lairs.GROUP_RATE[11], undefined);
    let draws = 0;
    assert.eq(Lairs.groupFor(11, 1, () => { draws++; return 0; }, true), null, 'a fort rolls plain');
    assert.eq(draws, 1, 'but still spends the one draw, so its seats start where every tier\'s do');
  });

  test('guard groups: every member is a registered enemy with art, behaviour and a pool; every tier holds a lair', () => {
    const places = new Set(['ring', 'core', 'floor', 'front', 'behind', 'cloud']);
    for (const [name, g] of Object.entries(Lairs.GROUPS)) {
      assert.truthy(g.label && g.story, `${name}: a label and a line for the design sheet`);
      assert.gt(g.tiers.length, 0, `${name}: holds somewhere`);
      for (const tier of g.tiers) assert.truthy(Lairs.TIERS.includes(tier) || Object.hasOwn(Lairs.HABITAT_TIER_GUARDS, tier), `${name}: tier ${tier} is a building or a habitat tier`);
      for (const tier of g.tiers) if (typeof tier === 'string') assert.eq(Lairs.TIER_GROUP[tier], name, `${name}: a habitat tier always takes its group`);
      assert.inRange(g.minT || 0, 0, 0.9, `${name}: minT leaves strong ruins something to take`);
      for (const m of g.members) {
        assert.truthy(Combat.isEnemy({ kind: m.kind, id: `x_${m.kind}` }), `${name}: ${m.kind} is a registered enemy`);
        assert.gt(Combat.creatureMaxHp(m.kind), 0, `${m.kind} has a pool`);
        assert.truthy(SpriteLayout.creatureArt(m.kind), `${m.kind} has art`);
        assert.truthy(SpriteLayout.creatureWanders(m.kind), `${m.kind} thinks`);
        assert.truthy(places.has(m.place), `${name}: ${m.place} is a placement`);
        if (m.elite) assert.truthy(Combat.monster(m.kind).eliteEligible, `${name}: ${m.kind} can be an elite`);
        if (m.kind === 'ghost') assert.gt(m.proximityCells, 0, `${name}: a ghost member is dormant until approached`);
        if (m.place === 'cloud') assert.truthy(Lairs.flies(m.kind), `${name}: only a flier hangs in a cloud`);
        for (const tier of g.tiers) assert.gt(Lairs.memberCount(m, tier), 0, `${name}: ${m.kind} has a count at tier ${tier}`);
      }
      for (const tier of g.tiers) {
        const n = Lairs.expandGroup(name, tier).length;
        assert.inRange(n, 1, Lairs.LAIR_LIVE_MAX / 2, `${name} at tier ${tier}: ${n} guards`);
      }
    }
    for (const tier of Object.keys(Lairs.GROUP_RATE).map(Number)) {
      assert.gt(Lairs.groupRows(tier, 1, true).length, 1, `tier ${tier} offers more than one group`);
      assert.inRange(Lairs.GROUP_RATE[tier], 0.05, 0.95, `tier ${tier}: a group is a share of ruins, not all of them`);
    }
    // The kinds that exist only for groups are seated by nothing else.
    for (const kind of ['goblin_runt', 'split_slime', 'storm_gull']) {
      const row = EnemyRoster.get(kind);
      assert.falsy(row.surface, `${kind} is in no surface pool`);
      assert.falsy(row.cave, `${kind} is in no cave bag`);
      assert.falsy(Combat.onQuestBoard(kind), `${kind} is never a board job`);
    }
  });

  // ── The draws ────────────────────────────────────────────────────────────
  test('guard groups: groupFor is one draw — the rate and the pick off the same number', () => {
    for (const tier of Object.keys(Lairs.GROUP_RATE).map(Number)) {
      for (const t of [0, 0.5, 1]) {
        let draws = 0;
        Lairs.groupFor(tier, t, () => { draws++; return 0.5; }, true);
        assert.eq(draws, 1, `tier ${tier}, t=${t}: one draw`);
      }
      const rate = Lairs.GROUP_RATE[tier];
      assert.eq(Lairs.groupFor(tier, 1, () => rate, true), null, 'at the rate: the plain garrison');
      assert.eq(Lairs.groupFor(tier, 1, () => 0.999, true), null, 'past it: plain');
      const rows = Lairs.groupRows(tier, 1, true);
      assert.eq(Lairs.groupFor(tier, 1, () => 0, true), rows[0], 'the first number takes the first row');
      assert.eq(Lairs.groupFor(tier, 1, () => rate * 0.999, true), rows[rows.length - 1], 'the last takes the last');
      // Every eligible row is reachable, and nothing else is.
      const seen = new Set();
      for (let i = 0; i < 1000; i++) { const g = Lairs.groupFor(tier, 1, () => (i / 1000) * rate, true); if (g) seen.add(g); }
      assert.eq([...seen].sort().join(), rows.slice().sort().join(), `tier ${tier}: every row is reachable`);
    }
    assert.eq(Lairs.groupFor('cafe', 1, () => 0, true), null, 'a street tier takes no group');
    // Strength gates: a weak castle offers no horde or elite.
    assert.falsy(Lairs.groupRows(12, 0.1, false).includes('horde'), 'a weak castle has no horde');
    assert.falsy(Lairs.groupRows(12, 0.1, false).includes('elite_orc'), 'nor an elite');
    assert.truthy(Lairs.groupRows(12, 0.9, false).includes('horde'), 'a strong one does');
    // The gulls only by the shore.
    assert.falsy(Lairs.groupRows(9, 1, false).includes('gulls'), 'inland: no gulls');
    assert.truthy(Lairs.groupRows(9, 1, true).includes('gulls'), 'by the shore: gulls');
  });

  test('guard groups: seatPolar takes two draws a try for every placement, and places as it says', () => {
    const facing = 1.0;
    for (const place of ['ring', 'core', 'floor', 'front', 'behind', 'cloud']) {
      let draws = 0;
      Lairs.seatPolar({ place, idx: 0, of: 1 }, 0, facing, () => { draws++; return 0.5; });
      assert.eq(draws, 2, `${place}: two draws`);
    }
    const mid = () => 0.5;
    const front = Lairs.seatPolar({ place: 'front', idx: 0, of: 1 }, 0, facing, mid);
    const behind = Lairs.seatPolar({ place: 'behind', idx: 0, of: 1 }, 0, facing, mid);
    assert.lt(Math.abs(front.ang - facing), 1e-9, 'front is the facing');
    assert.lt(Math.abs(behind.ang - facing - Math.PI), 1e-9, 'behind is opposite');
    for (const place of ['core', 'floor', 'front', 'behind']) {
      const p = Lairs.seatPolar({ place, idx: 0, of: 1 }, 0, facing, mid);
      assert.truthy(p.core, `${place} may stand on the floor`);
      assert.eq(p.base, place === 'core' ? 'core' : 'floor', `${place} is measured on the ${place === 'core' ? 'knot' : 'floor'}`);
    }
    assert.lte(Lairs.seatPolar({ place: 'front', idx: 0, of: 1 }, 0, facing, () => 0.999).rMul, 1, 'the front wall is inside the floor');
    const cloud = Lairs.seatPolar({ place: 'cloud', idx: 0, of: 1 }, 0, facing, mid);
    assert.truthy(cloud.over, 'a cloud may hang over the roof');
    assert.inRange(cloud.rMul, 0.3, 1.2);
    // The radii the bases name: a floor disc inside the walls, a cloud just
    // over them, a ring outside the corner.
    const r = Lairs.seatRadii(28, 21, 7);
    assert.eq(r.core, 10.5); assert.eq(r.floor, 17.5); assert.eq(r.cloud, 24.5);
    assert.lt(r.floor, 21, 'the floor disc fits inside the shorter wall');
    assert.gt(r.ring, Math.hypot(28, 21), 'the ring is outside the corner');
    // A ring band spreads a horde two deep.
    const deep = Lairs.seatPolar({ place: 'ring', idx: 0, of: 1, band: [1, 1.9] }, 0, facing, () => 0.99);
    assert.gt(deep.rMul, 1.8, 'the far edge of the band');
    // The plain garrison's seating is the ring row with no band.
    const plain = Lairs.seatPolar({ place: 'ring', idx: 1, of: 4 }, 0, facing, mid);
    assert.lt(Math.abs(plain.ang - TAU / 4), 1e-9, 'spaced by its index over the count');
    assert.lt(Math.abs(plain.rMul - 1.175), 1e-9, 'the ring, 1..1.35');
  });

  test('guard groups: expandGroup lays the members out in order, counted by tier', () => {
    const horde = Lairs.expandGroup('horde', 12);
    assert.eq(horde.length, 15);
    assert.truthy(horde.every((s) => s.kind === 'goblin_runt' && s.of === 15), 'fifteen runts, each spaced over fifteen');
    const decoy = Lairs.expandGroup('decoy', 12);
    assert.eq(decoy.map((s) => s.kind).join(), 'goblin,orc,orc,orc', 'the decoy first — easy wakes it and one orc');
    assert.eq(decoy[0].aggroCells, 6); assert.eq(decoy[1].aggroCells, 2);
    assert.eq(Lairs.expandGroup('haunting', 9).length, 2, 'two ghosts over a wreck');
    assert.eq(Lairs.expandGroup('ghosts', 12).length, 7, 'seven over a castle');
    assert.eq(Lairs.expandGroup('nothing', 9).length, 0);
  });

  // ── The wake, end to end ─────────────────────────────────────────────────
  const HALF = 3 * CELL_M;    // the test castle: six cells a side
  const insideKeep = (g, cx, cy) => Math.abs(g.x - cx) <= HALF && Math.abs(g.y - cy) <= HALF;
  test('guard groups: a horde wakes fifteen runts inside the keep, every one a guard that may walk out', () => {
    const { guards, cx, cy } = wakeGroup('horde', 12, 2 * HALF);
    assert.gte(guards.length, 13, `the horde woke ${guards.length} — a six-cell keep should seat nearly all fifteen`);
    for (const g of guards) {
      assert.eq(g.kind, 'goblin_runt'); assert.eq(g.group, 'horde');
      assert.truthy(g.immobile && g.lair, 'a guard');
      assert.truthy(insideKeep(g, cx, cy), 'inside the keep, as a castle\'s garrison starts');
      assert.truthy(g.keepHW > 0 && g.keepHH > 0, 'and it may cross its own floor to come out');
      assert.eq(g.aggroCells, Lairs.LAIR_CORE_AGGRO_CELLS, 'it notices the near player, as the keep does');
    }
    assert.eq(new Set(guards.map((g) => g.id)).size, guards.length, 'every runt its own id');
  });

  test('guard groups: the decoy stands at the front wall with a long notice ring; the orcs at the back, told to wait', () => {
    const { guards, cx, cy } = wakeGroup('decoy', 12, 2 * HALF);
    const decoy = guards.find((g) => g.kind === 'goblin'), orcs = guards.filter((g) => g.kind === 'orc');
    assert.truthy(decoy, 'the decoy woke');
    assert.gte(orcs.length, 2, 'the orcs woke');
    assert.eq(decoy.aggroCells, 6, 'the decoy notices from six cells past the walls');
    for (const o of orcs) {
      assert.eq(o.aggroCells, 2, 'an orc waits until you are two cells off');
      // Opposite side of the ruin from the decoy.
      const dot = (decoy.x - cx) * (o.x - cx) + (decoy.y - cy) * (o.y - cy);
      assert.lt(dot, 0, 'an orc stands at the far wall from the decoy');
      assert.truthy(insideKeep(o, cx, cy), 'inside the keep');
    }
    assert.truthy(insideKeep(decoy, cx, cy), 'the decoy too: it runs OUT at you');
    assert.eq(guards[0].kind, 'goblin', 'the decoy is guard 0, so easy mode wakes it');
  });

  test('guard groups: an elite stands shiny in the knot; its minions ring the walls', () => {
    const lone = wakeGroup('elite_orc', 12, 2 * HALF);
    assert.eq(lone.guards.length, 1, 'one strong one');
    assert.truthy(lone.guards[0].shiny && Combat.isElite(lone.guards[0]), 'and it is an elite');
    assert.eq(Combat.maxHp(lone.guards[0]), Combat.creatureMaxHp('orc') * Combat.ELITE_MUL, 'twice the pool');
    assert.lte(Math.hypot(lone.guards[0].x - lone.cx, lone.guards[0].y - lone.cy), Lairs.LAIR_CORE_SPREAD_CELLS * CELL_M + 1e-6, 'in the knot');
    assert.truthy(lone.guards[0].keepHW > 0, 'and it may cross its own floor to come out');
    const band = wakeGroup('warband', 12, 2 * HALF);
    const orc = band.guards.find((g) => g.kind === 'orc'), runts = band.guards.filter((g) => g.kind === 'goblin_runt');
    assert.truthy(orc && orc.shiny, 'the warband\'s orc is the elite');
    assert.gte(runts.length, 4, 'with its runts');
    for (const r of runts) {
      assert.falsy(r.shiny && !isShiny(r.id, SHINY_RATE.monster), 'a runt is shiny only off its id');
      assert.truthy(insideKeep(r, band.cx, band.cy), 'about the floor of the keep');
    }
    assert.eq(band.guards[0].kind, 'orc', 'the elite is guard 0, so easy mode wakes it');
  });

  test('guard groups: the ghosts hang over the roof, dormant until approached; the bats and gulls cloud the ruin', () => {
    const ghosts = wakeGroup('ghosts', 12, 2 * HALF);
    assert.gte(ghosts.guards.length, 5, 'the burst woke');
    const cloudR = Lairs.seatRadii(HALF, HALF, CELL_M).cloud * 1.2 + 1e-6;
    for (const g of ghosts.guards) {
      assert.eq(g.kind, 'ghost'); assert.eq(g.proximityCells, 4, 'dormant until you are four cells off');
      assert.lte(Math.hypot(g.x - ghosts.cx, g.y - ghosts.cy), cloudR, 'over the keep');
    }
    const pair = wakeGroup('haunting', 9);
    assert.eq(pair.guards.length, 2, 'a wreck\'s pair');
    for (const g of pair.guards) { assert.eq(g.kind, 'ghost'); assert.eq(g.proximityCells, 4); }
    const bats = wakeGroup('bats', 12, 2 * HALF);
    assert.gte(bats.guards.length, 8, `the swarm woke ${bats.guards.length}`);
    for (const b of bats.guards) assert.eq(b.kind, 'bat');
    assert.eq(wakeGroup('roost', 9).guards.length, 2, 'a wreck roosts a pair');
    // The gulls: a shore wreck only — the same ruin inland rolls something else.
    const shore = new Uint8Array(N * N).fill(1);
    const gulls = wakeGroup('gulls', 9, 4 * CELL_M, { shore });
    assert.gte(gulls.guards.length, 3, 'the flock woke');
    for (const g of gulls.guards) assert.eq(g.kind, 'storm_gull');
    const inland = mkEntry([gulls.shape]);
    step(inland, { x: gulls.cx, y: gulls.cy });
    assert.falsy(guardsOf(inland).some((g) => g.kind === 'storm_gull'), 'no shore, no gulls');
    assert.falsy(Lairs.nearShore(inland, { ix: 20, iy: 20, halfW: 14, halfH: 14 }, N, CELL_M));
    assert.truthy(Lairs.nearShore(gulls.entry, { ix: 20, iy: 20, halfW: 14, halfH: 14 }, N, CELL_M));
  });

  test('guard groups: a grouped ruin is the same ruin for everyone, and the easy cap wakes its head', () => {
    const a = wakeGroup('decoy', 12), b = wakeGroup('decoy', 12);
    const sig = (gs) => gs.map((g) => `${g.id}:${g.kind}:${g.x.toFixed(2)},${g.y.toFixed(2)}:${g.aggroCells}`).join('|');
    assert.eq(sig(a.guards), sig(b.guards), 'two wakes, one garrison');
    const easy = wakeGroup('horde', 12, 2 * HALF, { mode: 'easy' });
    assert.eq(easy.guards.length, Difficulty.PROFILES.easy.lairGuardMax, 'easy wakes the cap');
    assert.eq(easy.guards.map((g) => g.id).join(), wakeGroup('horde', 12, 2 * HALF).guards.slice(0, 2).map((g) => g.id).join(),
      'the first two of the world\'s fifteen, in their seats');
  });

  // ── The paces ────────────────────────────────────────────────────────────
  test('guard groups: goblins and orcs run at twice their old pace; the bats sit on the ceiling', () => {
    const mps = (k) => EnemyRoster.get(k).movement.speedMetersPerSecond;
    assert.eq(mps('goblin'), 7); assert.eq(mps('goblin_archer'), 5.6); assert.eq(mps('goblin_trapper'), 5.4);
    assert.eq(mps('farmer_goblin'), 4.4); assert.eq(mps('club_goblin'), 5); assert.eq(mps('spear_goblin'), 3.6);
    assert.eq(mps('archer_goblin'), 4); assert.eq(mps('bomb_goblin'), 5.2);
    assert.eq(mps('orc'), 3); assert.eq(mps('orc_mage'), 3); assert.eq(mps('orc_shaman'), 3);
    assert.eq(mps('bat'), WILD_SPEED_CEILING_MPS, 'twice 5.5 would clear the ceiling: the bat sits on it');
    assert.eq(mps('vampire_bat'), WILD_SPEED_CEILING_MPS);
    assert.eq(mps('goblin_runt'), 5, 'a runt runs as a club goblin');
    for (const k of ['goblin', 'orc', 'goblin_runt', 'bat', 'storm_gull']) {
      assert.eq(creatureSpawnClass(k), 'fastEnemy', `${k} is a fast foe: kept off the kerb`);
    }
    assert.eq(creatureSpawnClass('split_slime'), 'enemy', 'the splitting slime oozes');
  });

  // ── The kinds ────────────────────────────────────────────────────────────
  test('guard groups: the runt is a small club goblin, the storm gull the gull\'s sheet gone grey, the split slime ice-blue', () => {
    const runt = SpriteLayout.creatureArt('goblin_runt'), club = SpriteLayout.creatureArt('club_goblin');
    assert.eq(runt.sheet, club.sheet, 'the runt is drawn from the club goblin\'s sheet');
    assert.lt(Math.abs(runt.scale - club.scale * EnemyRoster.MINI_SCALE), 1e-9, 'at the Mini scale');
    assert.eq(runt.directions, club.directions, 'and walks its directions');
    assert.eq(EnemyRoster.get('goblin_runt').tier, 1, 'a runt is a tier-1 foe: welcome near Home');
    const gull = SpriteLayout.creatureArt('gull'), storm = SpriteLayout.creatureArt('storm_gull');
    for (const k of ['fw', 'fh', 'scale', 'foot', 'float', 'minY', 'maxY', 'airborne']) assert.eq(storm[k], gull[k], `storm gull ${k}`);
    assert.eq(storm.sheet, 'storm_gull', 'its own baked texture (the palette)');
    assert.truthy(EnemyRoster.get('storm_gull').palette, 'a palette of its own');
    assert.falsy(Combat.theftKind('storm_gull'), 'it pecks; it does not steal');
    assert.eq(SpriteLayout.creatureArt('split_slime').sheet, 'split_slime', 'the splitting slime has its own palette sheet');
    assert.eq(SpriteLayout.creatureArt('split_slime').hopRow, SpriteLayout.creatureArt('slime').hopRow, 'and hops as a slime');
    assert.eq(EnemyRoster.get('split_slime').ability.type, 'split');
  });

  // ── The split ────────────────────────────────────────────────────────────
  function splitScene(entry) {
    return {
      cellM: CELL_M, tileEdgeM: TILE_M, depth: 0,
      save: { energy: 100, caught: [], armor: {}, planted: [], fires: [], released: [] },
      playerM: { x: 0, y: CENTRE.y },
      originPx: { x: 0, y: 0 }, mPerPx: CELL_M, cellsPerTile: WorldGen.TILE_PX, startWorldM: { x: 0, y: 0 },
      cellAt: () => ({ loaded: true, type: 0 }), _cellBlocked: () => false, _nearAny: () => false, placedRockSet: null,
      viewCenterX: 0, viewCenterY: 0, flash() {},
    };
  }
  function withTile(entry, fn) {
    const key = WorldGen.tileKey(0, 0), had = WorldGen.tileCache.get(key);
    WorldGen.tileCache.set(key, entry);
    try { return fn(); } finally { if (had) WorldGen.tileCache.set(key, had); else WorldGen.tileCache.delete(key); }
  }
  test('split slime: a blow divides it — half the pool each side, a cell away, the twin a guard of the same ruin', () => {
    const entry = { cellsPerEdge: N, tileEdgeM: TILE_M, grid: new Uint8Array(N * N), creatures: [] };
    const c = { kind: 'split_slime', id: 'lair_0_0_20_20_0', x: CENTRE.x, y: CENTRE.y, _hp: 32,
      immobile: true, lair: '0_0_20_20', lairX: CENTRE.x, lairY: CENTRE.y, lairR: 10, seatX: CENTRE.x, seatY: CENTRE.y };
    entry.creatures.push(c);
    const scene = splitScene(entry);
    withTile(entry, () => {
      // The blow comes from the west: the halves flank north and south.
      const twin = enemySplit(scene, c, 0, CENTRE.y, 1000);
      assert.truthy(twin, 'it divided');
      assert.eq(c._hp, 16); assert.eq(twin._hp, 16);
      assert.eq(twin.kind, 'split_slime'); assert.eq(twin.id, 'lair_0_0_20_20_0_s1');
      assert.lt(Math.abs(c.x - CENTRE.x), 1e-6); assert.lt(Math.abs(twin.x - CENTRE.x), 1e-6);
      assert.lt(Math.abs(Math.abs(c.y - CENTRE.y) - CELL_M), 1e-6, 'one half a cell to one side');
      assert.lt(Math.abs(Math.abs(twin.y - CENTRE.y) - CELL_M), 1e-6, 'the other a cell to the other');
      assert.lt(Math.abs(c.y - twin.y) - 2 * CELL_M, 1e-6, 'on opposite sides');
      assert.eq(twin.lair, c.lair); assert.eq(twin.lairX, c.lairX); assert.truthy(twin.immobile, 'a guard of the same ruin');
      assert.eq(twin.seatX, twin.x); assert.eq(c.seatX, c.x, 'each half walks home to where it now stands');
      assert.eq(c._splitShare, 0.5); assert.eq(twin._splitShare, 0.5, 'the bounty is shared');
      assert.falsy(twin.shiny, 'a half is never an elite');
      assert.truthy(entry.creatures.includes(twin), 'the twin stands in the tile');
      // The cooldown: the melee wheel's next frame divides nothing.
      assert.eq(enemySplit(scene, c, 0, CENTRE.y, 1100), null, 'within the cooldown');
      // After it: 16 → 8 + 8, then 8 → 4 + 4, then a 4 is under twice minHp.
      const t2 = enemySplit(scene, c, 0, c.y, 3000);
      assert.truthy(t2); assert.eq(c._hp, 8); assert.eq(t2._hp, 8); assert.eq(t2.id, 'lair_0_0_20_20_0_s2'); assert.eq(t2._splitShare, 0.25);
      const t3 = enemySplit(scene, c, 0, c.y, 5000);
      assert.truthy(t3); assert.eq(c._hp, 4); assert.eq(t3._hp, 4); assert.eq(t3._splitShare, 0.125);
      assert.eq(enemySplit(scene, c, 0, c.y, 7000), null, 'a 4 does not divide (minHp 4, twice over)');
      const total = entry.creatures.reduce((s, o) => s + o._hp, 0);
      assert.eq(total, 32, 'the pool is conserved across the lineage');
      const share = entry.creatures.reduce((s, o) => s + o._splitShare, 0);
      assert.lt(Math.abs(share - 1), 1e-9, 'and so is the bounty');
      // A twin's twin is the lineage's too, with the lineage's serial.
      const t4 = enemySplit(scene, twin, 0, twin.y, 9000);
      assert.truthy(t4); assert.eq(t4.id, 'lair_0_0_20_20_0_s4'); assert.eq(t4._splitRoot, c.id);
      // A killed twin's id is never minted again.
      scene.save.caught.push('lair_0_0_20_20_0_s5');
      const t5 = enemySplit(scene, t4, 0, t4.y, 11000);
      assert.truthy(t5); assert.eq(t5.id, 'lair_0_0_20_20_0_s6', 'skipped the caught serial');
    });
  });

  test('split slime: a blocked flank splits along the blow; nothing open, no split; another kind never divides', () => {
    const entry = { cellsPerEdge: N, tileEdgeM: TILE_M, grid: new Uint8Array(N * N), creatures: [] };
    const c = { kind: 'split_slime', id: 's', x: CENTRE.x, y: CENTRE.y, _hp: 20 };
    entry.creatures.push(c);
    const scene = splitScene(entry);
    withTile(entry, () => {
      // North and south blocked: the halves step along the line of the blow.
      scene._cellBlocked = (x, y) => Math.abs(y - CENTRE.y) > CELL_M / 2;
      const twin = enemySplit(scene, c, 0, CENTRE.y, 1000);
      assert.truthy(twin, 'divided along the blow');
      assert.lt(Math.abs(c.y - CENTRE.y), 1e-6); assert.lt(Math.abs(twin.y - CENTRE.y), 1e-6);
      assert.lt(Math.abs(Math.abs(c.x - twin.x) - 2 * CELL_M), 1e-6);
      // Everything blocked: the slime just takes the blow.
      scene._cellBlocked = () => true;
      assert.eq(enemySplit(scene, c, 0, c.y, 5000), null);
      assert.eq(c._hp, 10, 'untouched by the refused split');
    });
    const goblin = { kind: 'goblin', id: 'g', x: CENTRE.x, y: CENTRE.y, _hp: 48 };
    assert.eq(enemySplit(splitScene(entry), goblin, 0, CENTRE.y, 1000), null, 'a goblin has no split ability');
  });

  test('split slime: the damage lane divides it on a blow but not on lava, light, burns or obstacles; the pet bite too; the bounty by share', () => {
    const dmg = SCENE_SRC.slice(SCENE_SRC.indexOf('_damageEnemy(c, amount, source = \'player\', options = {}) {'));
    assert.truthy(/if \(dealt > 0 && !\['lava', 'light', 'burn', 'obstacle'\]\.includes\(source\)\) \{\s*const from = options\.from \|\| this\.playerM[^;]*;\s*if \(enemySplit\(this, c, from\.x, from\.y, now\)/.test(dmg),
      '_damageEnemy divides a surviving splitting slime on a blow, never on the ground\'s damage');
    assert.truthy(/if \(tgt\._hp > 0\) enemySplit\(this, tgt, c\.x, c\.y, now\);/.test(SCENE_SRC),
      'a pet\'s bite divides it too, away from the pet');
    assert.truthy(/Combat\.enemyBounty\(victim\.kind, this\.depth, Combat\.powerMul\(victim\) \* \(victim\._splitShare \?\? 1\)\)/.test(SCENE_SRC),
      'resolveDefeat pays a half by its share');
    // Whole lineage, one wage: the shares' bounties sum to about one slime's.
    const whole = Combat.enemyBounty('split_slime', 0, 1);
    const halves = Combat.enemyBounty('split_slime', 0, 0.5) * 2;
    assert.inRange(halves, whole - 1, whole + 1, 'two halves pay one slime, to the rounding');
  });
})();
