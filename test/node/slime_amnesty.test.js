// The first-day slime amnesty (src/app.js › _slimeFreeZone + the fauna spawner).
//
// A slime sits on your crops and drains 3 energy a second, and day one is the
// one day a player has nothing to answer it with: no weapon, no relic, an empty
// bag, and a ladder telling them to stand still and till. So for a save's first
// day the spawner seats no slime near the starting anchor.
//
// Two things have to be true or the rule is worse than useless: it has to end
// (a permanent slime-free home is a different game), and it has to be about
// WHERE, not HOW MANY — the tile keeps its slimes, they just live further out.
// The zone resolver is lifted out of app.js by run.js; the spawner's use of it
// is one line, `if (kind === 'slime' && zone && zone.has(cx, cy)) continue`.

(() => {
  const SA_CELL_M = 7;
  const SA_N = 220;                       // cells per tile edge, near the real one
  const SA_TILE_M = SA_N * SA_CELL_M;
  const saHoursAgo = (h) => Date.now() - h * 60 * 60 * 1000;

  // Scene stub with the anchor `cells` cells into tile (0,0).
  function saScene(over = {}) {
    return Object.assign({
      cellM: SA_CELL_M,
      tileEdgeM: SA_TILE_M,
      startWorldM: { x: 100 * SA_CELL_M, y: 100 * SA_CELL_M },
      save: { startedAt: Date.now() },
    }, over);
  }
  const saZone = (scene, tx = 0, ty = 0) => slimeFreeZone.call(scene, tx, ty);

  test('slime amnesty: a fresh save gets a slime-free home area', () => {
    const zone = saZone(saScene());
    assert.truthy(zone, 'the grace period is running');
    assert.eq(zone.cx, 100, 'centred on the anchor cell (x)');
    assert.eq(zone.cy, 100, 'centred on the anchor cell (y)');
    assert.truthy(zone.has(100, 100), 'home itself is inside it');
    assert.truthy(zone.has(100 + SLIME_FREE_CELLS, 100), 'and so is the far edge');
    assert.falsy(zone.has(100 + SLIME_FREE_CELLS + 1, 100), 'one cell past it is not');
    assert.falsy(zone.has(100, 100 - SLIME_FREE_CELLS - 1), 'in any direction');
  });

  test('slime amnesty: it covers everything day one asks the player to walk to', () => {
    // The trail runs a screen out (the relic chest at VIEW_CELLS) and the
    // starter home seats its trees and wrecks out to RING_MAX_CELLS. A grace
    // radius shorter than those would leave slimes standing on the tutorial.
    assert.gte(SLIME_FREE_CELLS, HomeArea.RING_MAX_CELLS, 'covers the home ring');
    assert.gte(SLIME_FREE_CELLS, VIEW_CELLS, 'and the walk to the relic chest');
  });

  test('slime amnesty: it ENDS — a day later the map is itself again', () => {
    assert.falsy(saZone(saScene({ save: { startedAt: saHoursAgo(25) } })),
      'past the first day there is no zone at all');
    assert.truthy(saZone(saScene({ save: { startedAt: saHoursAgo(23) } })),
      'still on inside the day');
    // The boundary is the constant, not a hand-picked hour.
    assert.eq(FIRST_DAY_MS, 24 * 60 * 60 * 1000, 'one real day');
  });

  test('slime amnesty: an undated save gets no grace', () => {
    // Every load runs SaveMigrate.stampStartedAt, which dates a played save to
    // the epoch — so a veteran can never fall into the grace period. A save
    // that somehow arrives undated is treated the same way.
    assert.falsy(saZone(saScene({ save: {} })), 'no date, no zone');
    assert.falsy(saZone(saScene({ save: { startedAt: 0 } })), 'the epoch is long past');
    assert.falsy(saZone(saScene({ save: null })), 'and a missing save is not a crash');
  });

  test('slime amnesty: it follows the frozen trail anchor, not the projection origin', () => {
    // A save whose home capture landed somewhere else plays around
    // starterCratesAt, not startWorldM (see _starterTrailAnchor). The clear
    // area has to be where the player actually is.
    const scene = saScene({
      save: { startedAt: Date.now(), starterCratesAt: { x: 40 * SA_CELL_M, y: 60 * SA_CELL_M } },
    });
    const zone = saZone(scene);
    assert.eq(zone.cx, 40, 'centred on the anchor, not the origin (x)');
    assert.eq(zone.cy, 60, 'centred on the anchor, not the origin (y)');
  });

  test('slime amnesty: a tile away from home is untouched', () => {
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

  test('slime amnesty: the tile next door still shares the edge of it', () => {
    // An anchor near a seam has to clear ground on BOTH sides of it, or the
    // slimes simply queue up over the line.
    const scene = saScene({
      save: { startedAt: Date.now(), starterCratesAt: { x: 5 * SA_CELL_M, y: 5 * SA_CELL_M } },
    });
    const west = saZone(scene, -1, 0);          // the tile to the west of home
    assert.truthy(west.has(SA_N - 1, 5), 'the cell just over the seam is covered');
    assert.falsy(west.has(SA_N - SLIME_FREE_CELLS - 10, 5), 'and the far side of it is not');
  });
})();
