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
  assert.truthy(p.tokens.tree && p.tokens.rock, 'and both pocket tokens');
});

test('starter home: a rich neighbourhood is left alone', () => {
  const objs = [];
  for (let i = 0; i < SH_HA.QUOTA.tree; i++)  objs.push(shSmallPine(12 + i, `t${i}`));
  for (let i = 0; i < SH_HA.QUOTA.rock; i++)  objs.push(shPlainRock(12 + i, `k${i}`));
  for (let i = 0; i < SH_HA.QUOTA.wreck; i++) objs.push(shHouse(13 + i, `w${i}`));
  const p = shPlan(objs);
  assert.eq(p.need.tree, 0, 'no trees needed');
  assert.eq(p.need.rock, 0, 'no rocks needed');
  assert.eq(p.need.wreck, 0, 'no wrecks needed');
  assert.eq(p.downgrade.length, 0, 'nothing to tame');
});

test('starter home: unusable naturals are tamed, not supplemented', () => {
  // A downtown spawn: plenty of trees and rock, all of it out of a beginner's
  // reach. The right answer is to bring them down, not to add more beside them.
  const objs = [];
  for (let i = 0; i < SH_HA.QUOTA.tree; i++) objs.push(shBigMaple(12 + i, `t${i}`));
  for (let i = 0; i < SH_HA.QUOTA.rock; i++) objs.push(shOreRock(12 + i, `k${i}`));
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

  test('starter home seating: everything it seats is usable by a beginner', () => {
    const scene = makeScene(), entry = makeEntry();
    run(scene, entry);
    for (const o of added(entry)) {
      if (o.kind === 'tree') assert.truthy(SH_HA.isStarterTree(o), `${o.id} choppable bare-handed`);
      if (o.kind === 'mineralrock') assert.truthy(SH_HA.isStarterRock(o), `${o.id} breakable bare-handed`);
      if (o.kind === 'house') assert.truthy(SH_HA.isStarterWreck(o), `${o.id} is a rebuildable wreck`);
    }
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
    // The quota was already met out there, so no extra ring stock is added.
    assert.eq(seated.filter(o => o.kind === 'tree').length, 1, 'no surplus trees');
    assert.eq(seated.filter(o => o.kind === 'mineralrock').length, 1, 'no surplus rocks');
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
  const p = SH_HA.planStarterProvision(shWooded(), 0, 0, SH_CELL_M, {});
  assert.eq(p.need.tree, 0, 'the ring covers the tree quota');
  assert.eq(p.need.rock, 0, 'and the rock quota');
  assert.truthy(p.tokens.tree, 'but the cleared pocket still needs a tree');
  assert.truthy(p.tokens.rock, 'and a rock');
});

test('starter home: taming is capped at the shortfall, not the whole street', () => {
  const objs = shWooded();
  const p = SH_HA.planStarterProvision(objs, 0, 0, SH_CELL_M, {});
  assert.eq(p.downgrade.length, SH_HA.QUOTA.tree + SH_HA.QUOTA.rock,
    'exactly the quota is tamed');
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
  const p = SH_HA.planStarterProvision(objs, 0, 0, SH_CELL_M, {});
  const tamedIds = new Set(p.downgrade.map(o => o.id));
  // d7 is closest (RING_MAX-7), d0 furthest — the closest QUOTA.tree win.
  for (let i = 0; i < SH_HA.QUOTA.tree; i++) {
    assert.truthy(tamedIds.has(`d${7 - i}`), `d${7 - i} is among the nearest and should be tamed`);
  }
});
