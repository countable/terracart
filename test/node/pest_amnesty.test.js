// The pest amnesty (src/starter.js › pestFreeZone + app.js's fauna spawner + the crow
// pump). Formerly the first-day slime amnesty — same zone, two changes: crows
// are covered too, and it ends at the FIRST HARVEST instead of on a clock.
//
// A slime sits on your crops and drains 3 energy a second, a crow eats the
// crop outright, and the opening session is the one stretch a player has
// nothing to answer either with: no weapon, no relic, an empty bag, and a
// ladder telling them to stand still and till. So until the save's first crop
// is harvested (save.hasHarvested) the spawner seats no slime or crow near the
// starting anchor. (The crop-raiding crow pump used to read this grace too;
// it is hard-mode-only now, so on easy — the only mode with a grace to serve —
// it never runs at all. difficulty.test.js owns that gate.)
//
// Two things have to be true or the rule is worse than useless: it has to end
// (a permanent pest-free home is a different game — bringing in the first crop
// is the ladder's own proof the player has the loop), and it has to be about
// WHERE, not HOW MANY — the tile keeps its pests, they just live further out.
// The zone resolver is the scene's wrapper, handed over by run.js; the spawner's use of it
// and the pump's gate are one line each, pinned below against the source text
// run.js hands over (PEST_FREE_GUARD_SRC / CROW_PUMP_GATE_SRC).

(() => {
  const SA_CELL_M = 7;
  const SA_N = 220;                       // cells per tile edge, near the real one
  const SA_TILE_M = SA_N * SA_CELL_M;

  // Scene stub with the anchor `cells` cells into tile (0,0).
  function saScene(over = {}) {
    return Object.assign({
      cellM: SA_CELL_M,
      tileEdgeM: SA_TILE_M,
      startWorldM: { x: 100 * SA_CELL_M, y: 100 * SA_CELL_M },
      save: { hasHarvested: false },
    }, over);
  }
  const saZone = (scene, tx = 0, ty = 0) => pestFreeZone.call(scene, tx, ty);

  test('pest amnesty: a save that has never harvested gets a pest-free home area', () => {
    const zone = saZone(saScene());
    assert.truthy(zone, 'the grace period is running');
    assert.eq(zone.cx, 100, 'centred on the anchor cell (x)');
    assert.eq(zone.cy, 100, 'centred on the anchor cell (y)');
    assert.truthy(zone.has(100, 100), 'home itself is inside it');
    assert.truthy(zone.has(100 + PEST_FREE_CELLS, 100), 'and so is the far edge');
    assert.falsy(zone.has(100 + PEST_FREE_CELLS + 1, 100), 'one cell past it is not');
    assert.falsy(zone.has(100, 100 - PEST_FREE_CELLS - 1), 'in any direction');
  });

  test('pest amnesty: it covers everything the opening asks the player to walk to', () => {
    // The trail runs a screen out (the relic chest at VIEW_CELLS) and the
    // starter home seats its trees and wrecks out to RING_MAX_CELLS. A grace
    // radius shorter than those would leave pests standing on the tutorial.
    assert.gte(PEST_FREE_CELLS, HomeArea.RING_MAX_CELLS, 'covers the home ring');
    assert.gte(PEST_FREE_CELLS, VIEW_CELLS, 'and the walk to the relic chest');
  });

  test('pest amnesty: it ENDS — the first harvest makes the map itself again', () => {
    assert.falsy(saZone(saScene({ save: { hasHarvested: true } })),
      'once a crop is in there is no zone at all');
    assert.truthy(saZone(saScene({ save: { hasHarvested: false } })),
      'still on while the first crop is ahead');
    // A save the migration somehow never reached reads as un-harvested — safe
    // only because SaveMigrate.stampHarvested settles the flag on every load
    // before any tile spawns (savemigrate.test.js pins that a PLAYED legacy
    // save is stamped true, so a veteran can never wake up to this grace).
    assert.truthy(saZone(saScene({ save: {} })), 'an unstamped save still has the grace ahead');
    assert.falsy(saZone(saScene({ save: null })), 'and a missing save is not a crash');
  });

  test('pest amnesty: the spawner DROPS both pests, and only pests', () => {
    // The spawner's whole use of the zone is one line; run.js hands its source
    // text over so this can't drift silently. Both pest kinds must be in it —
    // checking one and shipping was exactly the previous gap. It CULLS
    // (`return`), never re-rolls (`continue`): a re-roll takes extra draws out
    // of the tile's shared stream, so every later spawn on the tile moved for
    // the one player with a grace running (CLAUDE.md "Every player sees the
    // SAME generated world" — per-player state may hide a thing, never move
    // the others).
    assert.truthy(PEST_FREE_GUARD_SRC.includes("kindStr === 'slime'"), 'slimes are dropped');
    assert.truthy(PEST_FREE_GUARD_SRC.includes("kindStr === 'crow'"), 'and so are crows');
    assert.truthy(PEST_FREE_GUARD_SRC.includes('return'), 'culled');
    assert.falsy(PEST_FREE_GUARD_SRC.includes('continue'), 'never re-rolled onto another cell');
  });

  test('pest amnesty: the zone never changes the tile\'s draw count', () => {
    // The guard sits AFTER the attempt has drawn its cell and passed every
    // world rule — the same place the caught-id check culls — so a player
    // inside a grace takes exactly the draws everyone else takes, and every
    // later tryPlace / treasure roll on the tile lands where it does for them.
    const src = SPAWN_IN_TILE_SRC;
    const tp = src.indexOf('const tryPlace =');
    const guardAt = src.indexOf(PEST_FREE_GUARD_SRC, tp);
    assert.gt(tp, -1, 'tryPlace found');
    assert.gt(guardAt, -1, 'the guard is inside tryPlace');
    const drawY = src.indexOf('const cy = Math.floor(rng() * N);', tp);
    const spawnRule = src.indexOf('WorldGen.isSpawnCell(', tp);
    const caught = src.indexOf('if (caughtSet.has(id)) return;', tp);
    assert.lt(drawY, guardAt, 'after the cell is drawn');
    assert.lt(spawnRule, guardAt, 'after the shared spawn rule accepts it');
    assert.lt(caught, guardAt, 'beside the per-player caught cull');
    // And nothing between the draw and the push re-draws on the zone's say.
    const body = src.slice(tp, src.indexOf('creatures.push(', tp));
    assert.eq((body.match(/pestFree\.has\(/g) || []).length, 1, 'the zone is asked once, in the guard');
  });

  test('pest amnesty: the crow pump is off in the mode that has the grace', () => {
    // The pump spawns a crow just off-screen that flies to the nearest crop, so
    // a zone check on its spawn point would be theatre. It used to be gated on
    // the save flag instead; now it is a MODE difference (Difficulty cropPests,
    // hard only), which subsumes the grace — easy, the only mode a grace could
    // apply to, never pumps at any point in the save. The amnesty's own job is
    // unchanged: the SPAWNER still keeps both pests away from home until the
    // first harvest, in both modes.
    assert.truthy(CROW_PUMP_GATE_SRC.includes('hasCrowCrop'),
      'still only pumps when there is a crop worth raiding');
    assert.truthy(CROW_PUMP_GATE_SRC.includes('cropPests'),
      'and only in the mode that dispatches crows');
    assert.falsy(CROW_PUMP_GATE_SRC.includes('hasHarvested'),
      'the retired grace clause is not left dangling in the gate');
    assert.falsy(Difficulty.PROFILES.easy.cropPests, 'easy: no crow is ever dispatched');
  });

  test('pest amnesty: it follows the frozen trail anchor, not the projection origin', () => {
    // A save whose home capture landed somewhere else plays around
    // starterCratesAt, not startWorldM (see _starterTrailAnchor). The clear
    // area has to be where the player actually is.
    const scene = saScene({
      save: { hasHarvested: false, starterCratesAt: { x: 40 * SA_CELL_M, y: 60 * SA_CELL_M } },
    });
    const zone = saZone(scene);
    assert.eq(zone.cx, 40, 'centred on the anchor, not the origin (x)');
    assert.eq(zone.cy, 60, 'centred on the anchor, not the origin (y)');
  });

  test('pest amnesty: a tile away from home is untouched', () => {
    // The centre comes back in TILE-LOCAL cells and is free to be off the tile
    // — which is what makes a neighbouring tile answer "no" everywhere without
    // a special case, and what keeps the amnesty working across a seam.
    const zone = saZone(saScene(), 3, 3);
    assert.truthy(zone, 'the grace period is still running');
    let inside = 0;
    for (let cy = 0; cy < SA_N; cy += 5) {
      for (let cx = 0; cx < SA_N; cx += 5) if (zone.has(cx, cy)) inside++;
    }
    assert.eq(inside, 0, 'no cell of a distant tile is inside the zone');
  });

  test('pest amnesty: the tile next door still shares the edge of it', () => {
    // An anchor near a seam has to clear ground on BOTH sides of it, or the
    // pests simply queue up over the line.
    const scene = saScene({
      save: { hasHarvested: false, starterCratesAt: { x: 5 * SA_CELL_M, y: 5 * SA_CELL_M } },
    });
    const west = saZone(scene, -1, 0);          // the tile to the west of home
    assert.truthy(west.has(SA_N - 1, 5), 'the cell just over the seam is covered');
    assert.falsy(west.has(SA_N - PEST_FREE_CELLS - 10, 5), 'and the far side of it is not');
  });
})();
