// Headless tests for the starter-home provisioning POLICY
// (src/home.js › HomeArea.planStarterProvision + friends). The seating half
// lives in app.js (_provisionStarterHome) and needs a tile; everything that
// decides WHAT the home area owes a new player is pure and lives here.
//
// The problem being solved: the starter ladder assumes there is something to
// chop, something to mine, and a wreck to rebuild near spawn. The real map
// promises none of it — a parkland spawn has no OSM buildings at all (so step
// 4 can never fire), while a downtown spawn is full of large hardwoods that
// want a Gold axe the player will not own for hours.

// Locals are prefixed — every *.test.js shares ONE VM context, so a bare
// `SH_CELL_M` or `house` collides with another file's.
const SH_HA = HomeArea;
const SH_CELL_M = 7;
// Objects are positioned by their distance from the anchor in CELLS.
const shAt = (cells, extra) => ({ x: cells * SH_CELL_M, y: 0, ...extra });
const shPlan = (objects) => SH_HA.planStarterProvision(objects, 0, 0, SH_CELL_M);

// A tree/rock/house the way worldgen emits it.
const shBigMaple  = (c, id) => shAt(c, { kind: 'tree', species: 'maple', size: 'large', id: id || `m${c}` });
const shSmallPine = (c, id) => shAt(c, { kind: 'tree', species: 'pine',  size: 'small', id: id || `p${c}` });
const shOreRock   = (c, id) => shAt(c, { kind: 'mineralrock', yieldTier: 5, requiredTier: 4, id: id || `o${c}` });
const shPlainRock = (c, id) => shAt(c, { kind: 'mineralrock', yieldTier: 1, requiredTier: 1, id: id || `r${c}` });
const shHouse     = (c, id) => shAt(c, { kind: 'house', tier: 9, id: id || `h${c}` });

// n objects spread around the ring band. Laying them out along one axis at
// `12 + i` walks straight out of the home area once the quota is large, so
// they must be placed by bearing and radius instead.
function shInRing(n, make) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const r = SH_HA.RING_MIN_CELLS + (i % (SH_HA.RING_MAX_CELLS - SH_HA.RING_MIN_CELLS + 1));
    // Walk the CHEBYSHEV ring, not a circle: at 45 degrees a circle of radius
    // 11 rounds to offset 8, which is inside the pocket, not the ring band.
    const per = 8 * r;
    const t = Math.floor((i * per) / Math.max(1, n));
    let cx, cy;
    if (t < 2 * r)      { cx = -r + t;             cy = -r; }
    else if (t < 4 * r) { cx = r;                  cy = -r + (t - 2 * r); }
    else if (t < 6 * r) { cx = r - (t - 4 * r);    cy = r; }
    else                { cx = -r;                 cy = r - (t - 6 * r); }
    const o = make(i);
    o.x = cx * SH_CELL_M;
    o.y = cy * SH_CELL_M;
    // A shiny tree is pinned to the Gold-axe tier and cannot be tamed, so one
    // landing in a fixture quietly drops it from the count. Shift the id until
    // it isn't shiny — the fixture is about quantity, not shiny handling.
    for (let n = 0; o.kind === 'tree' && isShiny(o.id, SHINY_RATE.tree); n++) o.id += `_${n}`;
    out.push(o);
  }
  return out;
}
// Run fn against a chosen quota. The capping and nearest-first RULES have to
// hold whatever the shipped numbers are, and only bite when the neighbourhood
// offers more candidates than the quota is short by — so they need a quota
// small enough for that to be true.
function shWithQuota(quota, fn) {
  const real = SH_HA.QUOTA;
  SH_HA.QUOTA = Object.assign({}, real, quota);
  try { return fn(); } finally { SH_HA.QUOTA = real; }
}

// ── Classification ────────────────────────────────────────────────────────

test('starter home: a small softwood is bare-hands, a large hardwood is not', () => {
  assert.eq(treeAxeReqTier(shSmallPine(3)), 0, 'small pine needs no axe');
  assert.truthy(SH_HA.isStarterTree(shSmallPine(3)), 'small pine is starter-usable');
  assert.gt(treeAxeReqTier(shBigMaple(3)), 0, 'large maple needs an axe');
  assert.falsy(SH_HA.isStarterTree(shBigMaple(3)), 'large maple is not starter-usable');
});

test('starter home: only a T1 deposit is bare-hands rock', () => {
  assert.truthy(SH_HA.isStarterRock(shPlainRock(3)), 'T1 is plain rock');
  assert.falsy(SH_HA.isStarterRock(shOreRock(3)), 'T5 ore is pick-gated');
});

test('starter home: forts and civic slabs are not wrecks to rebuild', () => {
  assert.truthy(SH_HA.isStarterWreck(shHouse(3)), 'a plain small house wrecks');
  assert.falsy(SH_HA.isStarterWreck(shAt(3, { kind: 'house', tier: 11, id: 'f' })), 'fort');
  assert.falsy(SH_HA.isStarterWreck(shAt(3, { kind: 'house', tier: 12, id: 'c' })), 'civic slab');
});

// ── Modify, don't crowd ───────────────────────────────────────────────────

test('starter home: taming edits the natural in place instead of adding one', () => {
  const tree = shBigMaple(12);
  assert.truthy(SH_HA.makeStarterUsable(tree), 'reports a change');
  assert.truthy(SH_HA.isStarterTree(tree), 'the street tree is now choppable');
  const rock = shOreRock(12);
  assert.truthy(SH_HA.makeStarterUsable(rock), 'reports a change');
  assert.truthy(SH_HA.isStarterRock(rock), 'the outcrop is now breakable');
  assert.falsy(SH_HA.makeStarterUsable(shSmallPine(12)), 'already usable → no change');
});

test('starter home: an untameable shiny tree is not counted as provision', () => {
  // A shiny is pinned to the Gold-axe tier by its id, so respeciating it can't
  // help. Find one, then prove the audit neither tames it nor counts it.
  let shiny = null;
  for (let i = 0; i < 5000 && !shiny; i++) {
    const t = shSmallPine(12, `shiny_probe_${i}`);
    if (isShiny(t.id, SHINY_RATE.tree)) shiny = t;
  }
  assert.truthy(shiny, 'found a shiny id to test with');
  assert.falsy(SH_HA.canBeStarterUsable(shiny), 'a shiny cannot be tamed');
  const p = shPlan([shiny]);
  assert.eq(p.downgrade.length, 0, 'not queued for a pointless downgrade');
  assert.eq(p.need.tree, SH_HA.QUOTA.tree, 'and it buys the player nothing');
});

// ── The audit ─────────────────────────────────────────────────────────────

test('starter home: a bare spawn owes the player the whole quota', () => {
  const p = shPlan([]);
  assert.eq(p.need.tree, SH_HA.QUOTA.tree, 'trees');
  assert.eq(p.need.rock, SH_HA.QUOTA.rock, 'rocks');
  assert.eq(p.need.wreck, SH_HA.QUOTA.wreck, 'wrecks');
  assert.eq(p.need.ladder, SH_HA.QUOTA.ladder, 'and a way down');
  assert.truthy(p.tokens.tree && p.tokens.rock, 'and both pocket tokens');
});

// ── The way down ──────────────────────────────────────────────────────────
// A new player should have the underground within sight of home. Worldgen
// scatters cave entrances at ~30% per residential rock cluster with a per-tile
// guarantee, but "somewhere on a 222-cell tile" is not "in the ring" — so the
// home area audits for one of its own.

test('starter home: a cave entrance already in the area is not doubled up', () => {
  const p = shPlan([shAt(12, { kind: 'staircase', dir: 'down', id: 'sd' })]);
  assert.eq(p.need.ladder, 0, 'the neighbourhood already supplies the way down');
});

test('starter home: an entrance out past the home area does not count', () => {
  // The per-tile guarantee can drop one anywhere on a ~222-cell tile. A mine
  // mouth a quarter-mile away is not a way down "at home".
  const p = shPlan([shAt(SH_HA.RING_MAX_CELLS + 5, { kind: 'staircase', dir: 'down', id: 'sd' })]);
  assert.eq(p.need.ladder, SH_HA.QUOTA.ladder, 'still owed one in the ring');
});

test('starter home: an up-staircase is not an entrance', () => {
  // Every cave level carries an up-stair at the home cell (_ensureHomeUpStair).
  // Counting it would convince the audit the surface has a mine mouth it
  // hasn't got — and the player would have no way down at all.
  const p = shPlan([shAt(12, { kind: 'staircase', dir: 'up', id: 'su' })]);
  assert.eq(p.need.ladder, SH_HA.QUOTA.ladder, 'an exit is not an entrance');
});

test('starter home: a rich neighbourhood is left alone', () => {
  const objs = [
    ...shInRing(SH_HA.QUOTA.tree,  (i) => shSmallPine(12, `t${i}`)),
    ...shInRing(SH_HA.QUOTA.rock,  (i) => shPlainRock(12, `k${i}`)),
    ...shInRing(SH_HA.QUOTA.wreck, (i) => shHouse(13, `w${i}`)),
  ];
  const p = shPlan(objs);
  assert.eq(p.need.tree, 0, 'no trees needed');
  assert.eq(p.need.rock, 0, 'no rocks needed');
  assert.eq(p.need.wreck, 0, 'no wrecks needed');
  assert.eq(p.downgrade.length, 0, 'nothing to tame');
});

test('starter home: unusable naturals are tamed, not supplemented', () => {
  // A downtown spawn: plenty of trees and rock, all of it out of a beginner's
  // reach. The right answer is to bring them down, not to add more beside them.
  const objs = [
    ...shInRing(SH_HA.QUOTA.tree, (i) => shBigMaple(12, `t${i}`)),
    ...shInRing(SH_HA.QUOTA.rock, (i) => shOreRock(12, `k${i}`)),
  ];
  const p = shPlan(objs);
  assert.eq(p.need.tree, 0, 'the hardwoods cover the tree quota once tamed');
  assert.eq(p.need.rock, 0, 'the ore covers the rock quota once tamed');
  assert.eq(p.downgrade.length, SH_HA.QUOTA.tree + SH_HA.QUOTA.rock, 'every one queued');
  for (const o of p.downgrade) SH_HA.makeStarterUsable(o);
  const after = shPlan(objs);
  assert.eq(after.downgrade.length, 0, 'and the audit settles after one pass');
});

test('starter home: the rural case — no buildings means synthesized wrecks', () => {
  // The reason this exists: with no OSM building anywhere near, ladder step 4
  // ("Rebuild a neighbour") has nothing to act on and the run stalls.
  const p = shPlan([shSmallPine(12), shPlainRock(13)]);
  assert.eq(p.need.wreck, SH_HA.QUOTA.wreck, 'every wreck has to be provided');
});

// ── Pocket vs ring ────────────────────────────────────────────────────────

test('starter home: stock out in the ring still leaves the pocket needing tokens', () => {
  const objs = [shSmallPine(SH_HA.RING_MIN_CELLS), shPlainRock(SH_HA.RING_MIN_CELLS + 1)];
  const p = shPlan(objs);
  assert.truthy(p.tokens.tree, 'a tree in the ring is not the pocket example');
  assert.truthy(p.tokens.rock, 'nor is a rock');
});

test('starter home: something already in the pocket satisfies its token', () => {
  const p = shPlan([shSmallPine(SH_HA.POCKET_CELLS - 1), shPlainRock(SH_HA.POCKET_CELLS - 1)]);
  assert.falsy(p.tokens.tree, 'the pocket already shows a tree');
  assert.falsy(p.tokens.rock, 'and a rock');
});

test('starter home: anything past the ring is out of the home area entirely', () => {
  const far = SH_HA.RING_MAX_CELLS + 5;
  const p = shPlan([shSmallPine(far), shPlainRock(far), shHouse(far)]);
  assert.eq(p.need.tree, SH_HA.QUOTA.tree, 'a distant tree provisions nothing');
  assert.eq(p.need.rock, SH_HA.QUOTA.rock, 'nor a distant rock');
  assert.eq(p.need.wreck, SH_HA.QUOTA.wreck, 'nor a distant house');
});

test('starter home: the pocket sits inside the ring, and both are non-empty', () => {
  assert.lt(SH_HA.POCKET_CELLS, SH_HA.RING_MIN_CELLS, 'ring starts outside the pocket');
  assert.lt(SH_HA.RING_MIN_CELLS, SH_HA.RING_MAX_CELLS, 'the ring has width');
  for (const k of ['tree', 'rock', 'wreck']) assert.gt(SH_HA.QUOTA[k], 0, `${k} quota`);
});

test('starter home: a rolled synthetic find keeps its slot and its tier', () => {
  // An earlier pass seated this rock and deliberately rolled it ore-bearing.
  // The audit must treat it as provisioned — not seat a replacement beside it,
  // and never hand it to makeStarterUsable to be flattened back to plain.
  const ore = shAt(12, { kind: 'mineralrock', yieldTier: 3, requiredTier: 2,
    id: 'starter_rock_x', _synthetic: true });
  const bigTree = shAt(13, { kind: 'tree', species: 'pine', size: 'medium',
    id: 'starter_tree_x', _synthetic: true });
  const plan = shPlan([ore, bigTree]);
  assert.eq(plan.need.rock, SH_HA.QUOTA.rock - 1, 'the rolled rock fills its quota slot');
  assert.eq(plan.need.tree, SH_HA.QUOTA.tree - 1, 'the rolled tree fills its quota slot');
  assert.falsy(plan.downgrade.includes(ore), 'the find is never downgraded back to plain');
  assert.falsy(plan.downgrade.includes(bigTree), 'nor the bigger tree');
  // The same objects WITHOUT the synthetic stamp are the real neighbourhood,
  // and stay downgrade candidates exactly as before.
  const wild = shPlan([shAt(12, { kind: 'mineralrock', yieldTier: 3, requiredTier: 2, id: 'wild' })]);
  assert.truthy(wild.downgrade.some(o => o.id === 'wild'), 'a real ore rock can still be tamed');
});

// ── The seating half, against the real shipping method ────────────────────
// _provisionStarterHome lives on the Phaser scene class; run.js lifts it out
// so these drive the actual code that ships, not a transcription. It turns the
// audit above into objects on real cells and freezes the result on the save.
(() => {
  const T = { GRASS: 0, WATER: 3, ROAD: 7, BUILDING: 9 };
  const N = 60;                      // cells per tile edge — room for the ring
  const CELL_M = 7;
  const SPAWN = 30;                  // mid-tile, so the whole ring fits

  function makeScene(over = {}) {
    const cellPx = WorldGen.TILE_PX / N;
    return Object.assign({
      save: {},
      cellM: CELL_M,
      tileEdgeM: N * CELL_M,
      cellsPerTile: N,
      mPerPx: CELL_M / cellPx,
      originPx: { x: 0, y: 0 },
      startWorldM: { x: 0, y: 0 },
    }, StarterHomeMethods, over);
  }
  const makeEntry = (fill = T.GRASS, objects = []) => ({
    cellsPerEdge: N,
    grid: new Uint8Array(N * N).fill(fill),
    objects,
    wildplants: [],
  });
  const run = (scene, entry) =>
    scene._provisionStarterHome(entry, 0, 0, SPAWN, SPAWN, new Set());
  const added = (entry) => entry.objects.filter(o => String(o.id).startsWith('starter_'));
  const cellsOut = (o) => Math.max(Math.abs(o.x / CELL_M - (SPAWN + 0.5)),
                                   Math.abs(o.y / CELL_M - (SPAWN + 0.5)));

  test('starter home seating: a bare tile gets the whole quota, and freezes it', () => {
    const scene = makeScene(), entry = makeEntry();
    run(scene, entry);
    const objs = added(entry);
    const trees = objs.filter(o => o.kind === 'tree');
    const rocks = objs.filter(o => o.kind === 'mineralrock');
    const houses = objs.filter(o => o.kind === 'house');
    assert.eq(trees.length, SH_HA.QUOTA.tree, 'trees seated');
    assert.eq(rocks.length, SH_HA.QUOTA.rock, 'rocks seated');
    assert.eq(houses.length, SH_HA.QUOTA.wreck, 'wrecks seated');
    assert.truthy(scene.save.starterHome, 'frozen on the save');
    assert.eq(scene.save.starterHome.placed.length, objs.length, 'every placement recorded');
  });

  test('starter home seating: mostly beginner-usable, with the occasional better find', () => {
    // The ring fill rolls rarity like a real deposit (WorldGen.rollSurfaceRockTier
    // for rocks; the same ~10% share grows a tree a size up), so the home area
    // holds the occasional ore-bearing rock or bigger tree instead of a hundred
    // identical props. The GUARANTEE that survives: plain, bare-hands items stay
    // the strong majority, every rolled rock keeps the deposit's pick pairing,
    // and every rolled tree is a bigger home softwood — a payday, not a wall.
    const scene = makeScene(), entry = makeEntry();
    run(scene, entry);
    const objs = added(entry);
    const trees = objs.filter(o => o.kind === 'tree');
    const rocks = objs.filter(o => o.kind === 'mineralrock');
    const plainTrees = trees.filter(o => SH_HA.isStarterTree(o));
    const plainRocks = rocks.filter(o => SH_HA.isStarterRock(o));
    assert.gt(plainTrees.length, trees.length * 0.6, 'bare-hands trees stay the strong majority');
    assert.gt(plainRocks.length, rocks.length * 0.6, 'bare-hands rocks stay the strong majority');
    // A quota of 50+50 at a ~10% roll makes an all-plain outcome astronomically
    // unlikely — and the roll is seeded, so this fixture's answer never flakes.
    assert.gt(trees.length + rocks.length - plainTrees.length - plainRocks.length, 0,
      'at least one better find actually rolled');
    for (const o of rocks) {
      if (SH_HA.isStarterRock(o)) continue;
      assert.inRange(o.yieldTier, 2, 7, `${o.id} rolled a real deposit tier`);
      assert.eq(o.requiredTier, Math.max(1, o.yieldTier - 1),
        `${o.id} keeps the deposit's pick pairing`);
    }
    for (const o of trees) {
      if (SH_HA.isStarterTree(o)) continue;
      assert.truthy(o.size === 'medium' || o.size === 'large', `${o.id} grew a size up`);
      assert.eq(o.species, SH_HA.STARTER_TREE.species,
        `${o.id} stays the home softwood`);
    }
    for (const o of objs) {
      if (o.kind === 'house') assert.truthy(SH_HA.isStarterWreck(o), `${o.id} is a rebuildable wreck`);
    }
  });

  test('starter home seating: the pocket tokens never roll — the lessons stay bare-handed', () => {
    // The token pair is what the first chop and the first mine are performed
    // on; a token that rolled ore would gate the tutorial behind a pick the
    // player cannot own yet.
    const scene = makeScene(), entry = makeEntry();
    run(scene, entry);
    for (const o of added(entry)) {
      if (cellsOut(o) > SH_HA.POCKET_CELLS) continue;
      if (o.kind === 'tree') assert.truthy(SH_HA.isStarterTree(o), `${o.id} choppable bare-handed`);
      if (o.kind === 'mineralrock') assert.truthy(SH_HA.isStarterRock(o), `${o.id} breakable bare-handed`);
    }
  });

  test('starter home seating: a rolled find survives the freeze and the rebuild', () => {
    // The roll happens ONCE, at seat time, and is frozen into the record — a
    // rebuild must reproduce the same rock at the same tier, not re-roll the
    // world under the player's feet.
    const scene = makeScene(), entry = makeEntry();
    run(scene, entry);
    const rolled = added(entry).filter(o =>
      (o.kind === 'mineralrock' && !SH_HA.isStarterRock(o)) ||
      (o.kind === 'tree' && !SH_HA.isStarterTree(o)));
    assert.gt(rolled.length, 0, 'this fixture rolled at least one better find');
    const before = JSON.stringify(rolled.map(o => [o.id, o.yieldTier, o.requiredTier, o.size]));
    // Rebuild: a fresh entry, same frozen save — everything re-injects from
    // the records.
    const entry2 = makeEntry();
    run(scene, entry2);
    const again = new Map(added(entry2).map(o => [o.id, o]));
    const after = JSON.stringify(rolled.map(o => {
      const r = again.get(o.id);
      return r ? [r.id, r.yieldTier, r.requiredTier, r.size] : null;
    }));
    assert.eq(after, before, 'same finds, same tiers, same sizes');
  });

  test('surface deposit roll: the shared odds are a plain majority with a real ore tail', () => {
    // WorldGen.rollSurfaceRockTier is the single source the residential
    // deposits and the starter provisioner both draw from. Pin its shape:
    // ~90% plain (SURFACE_PLAIN_ROCK_P), every ore tier reachable, and the
    // requiredTier = yieldTier − 1 pairing the mining gate expects.
    const rng = WorldGen.makeRng(0xDEADBEE);
    const seen = new Array(8).fill(0);
    let plain = 0;
    const DRAWS = 20000;
    for (let i = 0; i < DRAWS; i++) {
      const t = WorldGen.rollSurfaceRockTier(rng);
      assert.eq(t.requiredTier, Math.max(1, t.yieldTier - 1), 'pick pairing holds');
      seen[t.yieldTier]++;
      if (t.yieldTier <= 1) plain++;
    }
    const plainFrac = plain / DRAWS;
    assert.inRange(plainFrac, WorldGen.SURFACE_PLAIN_ROCK_P - 0.02,
      WorldGen.SURFACE_PLAIN_ROCK_P + 0.05, `plain stays the majority (${plainFrac})`);
    for (let tier = 2; tier <= 7; tier++) {
      assert.gt(seen[tier], 0, `tier ${tier} is reachable`);
    }
    // Rarer tiers stay rarer: copper outnumbers the frost end.
    assert.gt(seen[2], seen[7], 'the tail actually tapers');
  });

  test('starter home seating: a bare tile gets exactly one way down, in the ring', () => {
    const scene = makeScene(), entry = makeEntry();
    run(scene, entry);
    const stairs = added(entry).filter(o => o.kind === 'staircase');
    assert.eq(stairs.length, 1, 'one entrance, not none and not a field of them');
    assert.eq(stairs[0].dir, 'down', 'it descends');
    assert.eq(stairs[0].depth, 0, 'and it stands on the surface');
    const d = cellsOut(stairs[0]);
    assert.inRange(d, SH_HA.RING_MIN_CELLS, SH_HA.RING_MAX_CELLS,
      'seated in the resource ring — a short walk out, not in the tidy pocket');
  });

  test('starter home seating: the entrance survives a rebuild', () => {
    // The frozen record is what re-injects it when the tile rasterizes again;
    // a way down that vanished on reload would be worse than never having one.
    const scene = makeScene(), entry = makeEntry();
    run(scene, entry);
    const before = added(entry).find(o => o.kind === 'staircase');
    assert.truthy(before, 'seated on the first pass');
    assert.truthy(scene.save.starterHome.placed.some(r => r.k === 'ladder'), 'frozen on the save');
    const rebuilt = makeEntry();
    run(scene, rebuilt);
    const after = added(rebuilt).filter(o => o.kind === 'staircase');
    assert.eq(after.length, 1, 'exactly one after the rebuild');
    assert.eq(after[0].id, before.id, 'the same entrance, not a new one beside it');
    assert.eq(after[0].x, before.x, 'in the same place');
    assert.eq(after[0].y, before.y, 'in the same place');
  });

  test('starter home seating: a neighbourhood with its own entrance gets no second one', () => {
    const scene = makeScene();
    const own = { kind: 'staircase', dir: 'down', depth: 0, id: 'osm_stair',
      x: (SPAWN + 12.5) * CELL_M, y: (SPAWN + 0.5) * CELL_M };
    const entry = makeEntry(T.GRASS, [own]);
    run(scene, entry);
    const stairs = entry.objects.filter(o => o.kind === 'staircase');
    assert.eq(stairs.length, 1, 'the one worldgen already placed');
    assert.eq(stairs[0].id, 'osm_stair', 'and it is that one');
    assert.falsy(scene.save.starterHome.placed.some(r => r.k === 'ladder'), 'nothing synthesized');
  });

  test('starter home seating: one tree and one rock land in the pocket, the rest outside', () => {
    const scene = makeScene(), entry = makeEntry();
    run(scene, entry);
    const objs = added(entry);
    const inPocket = objs.filter(o => cellsOut(o) <= SH_HA.POCKET_CELLS);
    assert.eq(inPocket.filter(o => o.kind === 'tree').length, SH_HA.TOKEN.tree, 'one token tree');
    assert.eq(inPocket.filter(o => o.kind === 'mineralrock').length, SH_HA.TOKEN.rock, 'one token rock');
    assert.eq(inPocket.filter(o => o.kind === 'house').length, 0, 'no house crowds the pocket');
    for (const o of objs.filter(o => cellsOut(o) > SH_HA.POCKET_CELLS)) {
      assert.inRange(cellsOut(o), SH_HA.RING_MIN_CELLS - 0.5, SH_HA.RING_MAX_CELLS + 0.5,
        `${o.id} sits in the ring`);
    }
  });

  test('starter home seating: nothing is seated in the Home trailer moat', () => {
    const scene = makeScene(), entry = makeEntry();
    run(scene, entry);
    for (const o of added(entry)) {
      assert.gt(cellsOut(o), 1, `${o.id} clear of the trailer moat`);
    }
  });

  test('starter home seating: nothing is seated on water, road or a building', () => {
    const scene = makeScene(), entry = makeEntry();
    // Pave the whole ring's north half and flood the south — the seater has to
    // find the remaining ground rather than dropping a tree in the river.
    for (let cy = 0; cy < N; cy++) {
      for (let cx = 0; cx < N; cx++) {
        if (cy < SPAWN) entry.grid[cy * N + cx] = T.ROAD;
        else if (cy > SPAWN + 12) entry.grid[cy * N + cx] = T.WATER;
      }
    }
    run(scene, entry);
    const objs = added(entry);
    assert.gt(objs.length, 0, 'still seated something');
    for (const o of objs) {
      const cx = Math.floor(o.x / CELL_M), cy = Math.floor(o.y / CELL_M);
      const t = entry.grid[cy * N + cx];
      assert.truthy(t !== T.ROAD && t !== T.WATER && t !== T.BUILDING,
        `${o.id} on terrain ${t}`);
    }
  });

  test('starter home seating: a rebuild re-applies the frozen set, and adds nothing new', () => {
    const scene = makeScene(), entry = makeEntry();
    run(scene, entry);
    const first = added(entry).map(o => o.id).sort().join(',');
    const frozen = JSON.stringify(scene.save.starterHome);
    // The tile rebuilds from scratch — worldgen output has none of our objects.
    const rebuilt = makeEntry();
    run(scene, rebuilt);
    assert.eq(added(rebuilt).map(o => o.id).sort().join(','), first, 'same ids come back');
    assert.eq(JSON.stringify(scene.save.starterHome), frozen, 'the freeze is not rewritten');
  });

  test('starter home seating: re-running on a tile that still has them is a no-op', () => {
    const scene = makeScene(), entry = makeEntry();
    run(scene, entry);
    const n = entry.objects.length;
    run(scene, entry);
    assert.eq(entry.objects.length, n, 'no duplicates injected');
  });

  test('starter home seating: a tamed street tree is re-tamed after a rebuild', () => {
    // The regression this guards: worldgen regenerates the natural at its
    // original tier every rebuild, so without re-applying the downgrade the
    // player's one choppable tree quietly turns back into a hardwood.
    const scene = makeScene();
    const maple = () => ({ kind: 'tree', species: 'maple', size: 'large', id: 'real_maple',
      x: (SPAWN + 12.5) * CELL_M, y: (SPAWN + 0.5) * CELL_M });
    const entry = makeEntry(T.GRASS, [maple()]);
    run(scene, entry);
    assert.truthy(SH_HA.isStarterTree(entry.objects.find(o => o.id === 'real_maple')), 'tamed');
    assert.includes(scene.save.starterHome.tamed, 'real_maple', 'recorded as tamed');
    const rebuilt = makeEntry(T.GRASS, [maple()]);          // back at full tier
    run(scene, rebuilt);
    assert.truthy(SH_HA.isStarterTree(rebuilt.objects.find(o => o.id === 'real_maple')),
      're-tamed on rebuild');
  });

  test('starter home seating: a veteran save is never provisioned', () => {
    // A veteran save: the ladder is finished (Quests.starterHidden → true).
    const scene = makeScene({ save: { starter: { step: 99, done: {}, dismissed: false } } });
    const entry = makeEntry();
    run(scene, entry);
    assert.eq(added(entry).length, 0, 'nothing seated');
    assert.falsy(scene.save.starterHome, 'and nothing frozen');
  });

  test('starter home seating: a finished player keeps the home they were given', () => {
    // Frozen while onboarding, then the ladder completes — the placements must
    // keep coming back rather than dissolving into bare map.
    const scene = makeScene(), entry = makeEntry();
    run(scene, entry);
    const before = added(entry).map(o => o.id).sort().join(',');
    scene.save.starter = { step: 99, done: {}, dismissed: false };   // ladder finished
    const rebuilt = makeEntry();
    run(scene, rebuilt);
    assert.eq(added(rebuilt).map(o => o.id).sort().join(','), before, 'still there');
  });

  test('starter home seating: a wooded spawn still gets its pocket pair', () => {
    // The reported bug, end to end: trees and rocks already in the ring meant
    // nothing at all was seated, so the cleared pocket around Home stayed bare.
    const scene = makeScene();
    const objs = [];
    for (let i = 0; i < 12; i++) objs.push({ kind: 'tree', species: 'oak', id: `wt${i}`,
      x: (SPAWN + 12 + (i % 4)) * CELL_M, y: (SPAWN + i - 6) * CELL_M });
    for (let i = 0; i < 5; i++)  objs.push({ kind: 'mineralrock', yieldTier: 4, requiredTier: 3,
      id: `wr${i}`, x: (SPAWN - 13 - i) * CELL_M, y: (SPAWN + i) * CELL_M });
    const entry = makeEntry(T.GRASS, objs);
    run(scene, entry);
    const seated = added(entry);
    const inPocket = seated.filter(o => cellsOut(o) <= SH_HA.POCKET_CELLS);
    assert.eq(inPocket.filter(o => o.kind === 'tree').length, 1, 'a tree in sight of Home');
    assert.eq(inPocket.filter(o => o.kind === 'mineralrock').length, 1, 'and a rock');
    for (const o of inPocket) {
      assert.gte(cellsOut(o), SH_HA.TOKEN_MIN_CELLS - 0.5, `${o.id} not right in the doorway`);
    }
    // Whatever the quota adds out in the ring, the pocket gets exactly its
    // token pair — never a pile of them in the player's front garden.
    assert.eq(inPocket.length, 2, 'the pocket holds the token pair and nothing more');
  });

  test('starter home seating: the ring surrounds home, it is not a line', () => {
    // The bug this guards: the obvious ring scan (for dy… for dx… take the
    // first free cell) walks the ring in order and drops EVERY item on its
    // north row two cells apart. Walking north tripped over all of them;
    // walking any other direction found nothing. Measured on the real seater.
    const scene = makeScene(), entry = makeEntry();
    run(scene, entry);
    const ring = added(entry).filter(o => cellsOut(o) > SH_HA.POCKET_CELLS);
    assert.gte(ring.length, 4, 'enough ring items to judge the spread');
    const ys = new Set(ring.map(o => Math.round(o.y / CELL_M)));
    const xs = new Set(ring.map(o => Math.round(o.x / CELL_M)));
    assert.gt(ys.size, 1, 'not all on one row');
    assert.gt(xs.size, 1, 'not all in one column');
    // Every compass quadrant a player might set off in should hold something.
    const quads = new Set(ring.map((o) => {
      const dx = o.x / CELL_M - (SPAWN + 0.5), dy = o.y / CELL_M - (SPAWN + 0.5);
      return (dy < 0 ? 'N' : 'S') + (dx < 0 ? 'W' : 'E');
    }));
    assert.gte(quads.size, 3, `ring spans ${quads.size} quadrants: ${[...quads].join(',')}`);
  });

  test('starter home seating: the two pocket tokens sit apart, not side by side', () => {
    const scene = makeScene(), entry = makeEntry();
    run(scene, entry);
    const tok = added(entry).filter(o => cellsOut(o) <= SH_HA.POCKET_CELLS);
    assert.eq(tok.length, 2, 'a tree and a rock');
    const gap = Math.max(Math.abs(tok[0].x - tok[1].x), Math.abs(tok[0].y - tok[1].y)) / CELL_M;
    assert.gte(gap, SH_HA.TOKEN_MIN_CELLS, 'placed on opposite sides of the door');
  });

  test('starter home seating: a spawn near a tile seam still gets a ring all round', () => {
    // The bug this guards: seating was clamped to the anchor's own tile, so a
    // spawn within ring-distance of a seam lost that whole arc — measured on a
    // real spawn at cell iy=213 of a 222-cell tile, the entire southern side
    // came out bare. Worse, the quota was then satisfied by the directions it
    // COULD reach, so no later pass ever wanted to fill the gap.
    const scene = makeScene();
    const NEAR_EDGE = N - 9;                      // 9 cells of room to the south
    const south = makeEntry();                    // the tile across the seam
    const key = `${WorldGen.Z}/0/1`;
    WorldGen.tileCache.set(key, south);
    try {
      const entry = makeEntry();
      scene.save.starterCratesAt = { x: (SPAWN + 0.5) * CELL_M, y: (NEAR_EDGE + 0.5) * CELL_M };
      scene._provisionStarterHome(entry, 0, 0, SPAWN, NEAR_EDGE, new Set());
      const mine = entry.objects.filter(o => String(o.id).startsWith('starter_'));
      const theirs = south.objects.filter(o => String(o.id).startsWith('starter_'));
      assert.gt(theirs.length, 0, 'items seated across the seam into the neighbour tile');
      // And the arc really is southern: past the anchor tile's own bottom edge.
      for (const o of theirs) {
        assert.gt(o.y, N * CELL_M, `${o.id} lies south of the seam`);
      }
      assert.gt(mine.length, 0, 'the anchor tile still holds its share');
    } finally {
      WorldGen.tileCache.delete(key);
    }
  });

  test('starter home seating: it waits for the map around spawn before planning', () => {
    // Planning against half a map spends the whole quota on the reachable
    // directions. With no neighbour tiles loaded and the anchor near an edge,
    // the pass should defer rather than freeze a lopsided plan.
    const scene = makeScene();
    const entry = makeEntry();
    scene.save.starterCratesAt = { x: (SPAWN + 0.5) * CELL_M, y: (N - 9 + 0.5) * CELL_M };
    scene._provisionStarterHome(entry, 0, 0, SPAWN, N - 9, new Set());
    assert.falsy(scene.save.starterHome, 'nothing frozen while the area is still streaming');
    assert.eq(added(entry).length, 0, 'and nothing seated');
  });

  test('starter home seating: only the tile holding the anchor plans', () => {
    // A neighbour tile sees the anchor outside its bounds; it must not start a
    // second, competing provision.
    const scene = makeScene(), entry = makeEntry();
    scene._provisionStarterHome(entry, 0, 0, -40, -40, new Set());
    assert.eq(added(entry).length, 0, 'no seating from a neighbour tile');
    assert.falsy(scene.save.starterHome, 'nothing frozen');
  });
})();

// ── Home is not a wreck ───────────────────────────────────────────────────

test('starter home: the player\'s own Home never counts as a wreck to rebuild', () => {
  // Home is a plain tier-9 house by data, but renders as the trailer and can
  // never be restored — counting it would leave a rural spawn one wreck short
  // of being able to finish ladder step 4.
  const home = shHouse(3, 'starter_trailer');
  assert.falsy(SH_HA.isStarterWreck(home, 'starter_trailer'), 'excluded when it is Home');
  assert.truthy(SH_HA.isStarterWreck(home, 'some_other_house'), 'a neighbour still counts');
  const p = SH_HA.planStarterProvision([home], 0, 0, SH_CELL_M, { homeId: 'starter_trailer' });
  assert.eq(p.need.wreck, SH_HA.QUOTA.wreck, 'Home provisions no part of the wreck quota');
});

// ── The wooded-spawn bugs ─────────────────────────────────────────────────
// Both of these shipped once and were caught by a player: on a spawn with
// trees and rocks already in the ring, the quota was satisfied out there, so
// (a) no token was placed and the CLEARED pocket around Home stayed bare —
// nothing to chop or mine in sight of the front door — and (b) every unusable
// natural in range was queued for downgrade, flattening a wooded street into
// saplings to supply four of them.

// A lush spawn: plenty out in the ring, nothing in the cleared pocket.
const shWooded = () => {
  const objs = [];
  for (let i = 0; i < 12; i++) objs.push(shAt(12 + (i % 5), { kind: 'tree', species: 'oak', id: `wt${i}`, y: i * SH_CELL_M }));
  for (let i = 0; i < 5; i++)  objs.push(shAt(13 + i, { kind: 'mineralrock', yieldTier: 4, requiredTier: 3, id: `wr${i}`, y: -i * SH_CELL_M }));
  return objs;
};

test('starter home: a lush ring still owes the pocket its token pair', () => {
  // A ring that fully satisfies the quota, and a pocket that is empty because
  // the clearing pass strips it. The tokens must still be owed.
  const objs = [
    ...shInRing(SH_HA.QUOTA.tree, (i) => shSmallPine(12, `lt${i}`)),
    ...shInRing(SH_HA.QUOTA.rock, (i) => shPlainRock(12, `lk${i}`)),
  ];
  const p = shPlan(objs);
  assert.eq(p.need.tree, 0, 'the ring covers the tree quota');
  assert.eq(p.need.rock, 0, 'and the rock quota');
  assert.truthy(p.tokens.tree, 'but the cleared pocket still needs a tree');
  assert.truthy(p.tokens.rock, 'and a rock');
});

test('starter home: taming is capped at the shortfall, not the whole street', () => {
  const objs = shWooded();
  const p = shWithQuota({ tree: 4, rock: 3 },
    () => SH_HA.planStarterProvision(objs, 0, 0, SH_CELL_M, {}));
  assert.eq(p.downgrade.length, 4 + 3, 'exactly the shortfall is tamed');
  assert.lt(p.downgrade.length, objs.length, 'the rest of the neighbourhood is left alone');
  // And what survives untouched really is still full-tier woodland.
  for (const o of p.downgrade) SH_HA.makeStarterUsable(o);
  const untouched = objs.filter(o => o.kind === 'tree' && !SH_HA.isStarterTree(o));
  assert.gt(untouched.length, 0, 'real trees remain real trees');
});

test('starter home: the nearest usable candidates are the ones tamed', () => {
  // Taming should reach for what the player will walk past first.
  const objs = [];
  for (let i = 0; i < 8; i++) {
    objs.push(shAt(SH_HA.RING_MAX_CELLS - i, { kind: 'tree', species: 'oak', id: `d${i}` }));
  }
  const WANT = 4;
  const p = shWithQuota({ tree: WANT, rock: 0 },
    () => SH_HA.planStarterProvision(objs, 0, 0, SH_CELL_M, {}));
  const tamedIds = new Set(p.downgrade.map(o => o.id));
  assert.eq(tamedIds.size, WANT, 'only the shortfall is tamed');
  // d7 is closest (RING_MAX-7), d0 furthest — the closest WANT should win.
  for (let i = 0; i < WANT; i++) {
    assert.truthy(tamedIds.has(`d${7 - i}`), `d${7 - i} is among the nearest and should be tamed`);
  }
});

// ── Water spawns ──────────────────────────────────────────────────────────
// A pier, a marina, a riverbank — or an outright island. The seater only ever
// places onto existing ground, so before the escalating search an all-water
// ring seated NOTHING: no wreck to rebuild, so ladder step 4 could never fire
// and there was no blacksmith to spend the starter crates on.
(() => {
  const WATER = 3, GRASS = 0;
  const N = 120, CELL_M = 7, SPAWN = 60;    // big enough to hold the wide band

  // A tile that is all water except beyond `shoreAt` cells from spawn.
  function makeSea(shoreAt) {
    const grid = new Uint8Array(N * N).fill(WATER);
    if (shoreAt != null) {
      for (let cy = 0; cy < N; cy++) {
        for (let cx = 0; cx < N; cx++) {
          if (Math.max(Math.abs(cx - SPAWN), Math.abs(cy - SPAWN)) > shoreAt) grid[cy * N + cx] = GRASS;
        }
      }
    }
    return { cellsPerEdge: N, grid, objects: [], wildplants: [] };
  }
  function makeSeaScene() {
    const cellPx = WorldGen.TILE_PX / N;
    return Object.assign({
      save: {}, cellM: CELL_M, tileEdgeM: N * CELL_M, cellsPerTile: N,
      mPerPx: CELL_M / cellPx, originPx: { x: 0, y: 0 }, startWorldM: { x: 0, y: 0 },
    }, StarterHomeMethods);
  }
  const seated = (e) => e.objects.filter(o => String(o.id).startsWith('starter_'));
  const terrainUnder = (e, o) =>
    e.grid[Math.floor(o.y / CELL_M) * N + Math.floor(o.x / CELL_M)];

  test('starter home seating: a water spawn reaches out to the nearest shore', () => {
    // Dry land only past 25 cells — well beyond RING_MAX_CELLS (16).
    const scene = makeSeaScene(), entry = makeSea(25);
    scene._provisionStarterHome(entry, 0, 0, SPAWN, SPAWN, new Set());
    const got = seated(entry);
    // Summed off QUOTA rather than spelled out, so adding a kind to the quota
    // (the `ladder` entrance was the one that caught this) doesn't read as a
    // failure here. The pocket tokens come OUT of the tree/rock quota — they
    // decrement `need` — so the total is exactly the quota.
    const quotaTotal = Object.values(SH_HA.QUOTA).reduce((a, b) => a + b, 0);
    assert.eq(got.length, quotaTotal, 'the full quota is still supplied');
    assert.eq(got.filter(o => o.kind === 'house').length, SH_HA.QUOTA.wreck,
      'including the wrecks the ladder needs');
    for (const o of got) {
      assert.eq(terrainUnder(entry, o), GRASS, `${o.id} stands on dry land, not water`);
      const d = Math.max(Math.abs(o.x / CELL_M - (SPAWN + 0.5)), Math.abs(o.y / CELL_M - (SPAWN + 0.5)));
      assert.gt(d, 25, `${o.id} is out past the water`);
      assert.inRange(d, 0, SH_HA.RING_MAX_ESCALATED_CELLS + 1, `${o.id} within the escalated reach`);
    }
    assert.truthy(scene.save.starterHome.done, 'and the plan reports itself finished');
  });

  test('starter home seating: no shore in reach fails quietly and stops trying', () => {
    // Nothing can be placed on open water, and nothing should be: the point of
    // the bound is that a hopeless spawn cannot spin forever or paint over the
    // player's real coastline.
    const scene = makeSeaScene();
    for (let i = 0; i < 8; i++) {
      const entry = makeSea(null);            // water everywhere
      scene._provisionStarterHome(entry, 0, 0, SPAWN, SPAWN, new Set());
      assert.eq(seated(entry).length, 0, 'nothing seated on open water');
    }
    assert.inRange((scene.save.starterHome || {}).tries || 0, 0, 4,
      'gives up rather than retrying forever');
  });
})();
