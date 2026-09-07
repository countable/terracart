// STREET RESTORATION arithmetic (src/streets.js) — the exact metres.
//
// Everything the player restores is a pair of float arclengths along one line
// of one OSM way, so every bug in here is invisible until it is a street that
// lights where nobody walked or refuses to light where they did. These run the
// shipping module: no Phaser, no scene, no copies of the maths.
//
// Prefixed `st` — the *.test.js files share one lexical scope (see run.js).

(() => {
  const S = Streets;

  // A tile at the real numbers: 4096 MVT units across a 611.5 m edge, 7 m
  // cells (the shipping cellM at z14 on a 51-cell tile is near enough).
  const EXTENT = 4096;
  const EDGE_M = 4096;               // 1 MVT unit = 1 m, so every expectation
  const MVT_TO_M = EDGE_M / EXTENT;  // below reads in the same units it is drawn in
  const CELL_M = 10;

  const pt = (x, y) => ({ x, y });
  const near = (a, b, eps, m) => assert.inRange(a, b - eps, b + eps, m || 'near');
  const shape = (list) => list.map((iv) => `${round(iv[0])}..${round(iv[1])}`).join(' ');
  const round = (n) => Math.round(n * 1e6) / 1e6;

  // ── lineKey ───────────────────────────────────────────────────────────
  const feat = (id, cls, ...lines) => ({ id, tags: { class: cls }, geom: lines });

  test('streets key: the same line keys the same, every time', () => {
    // The save is keyed on this. A key that drifted between two boots would
    // orphan every street the player has restored.
    const f = feat(12345, 'residential', [pt(0, 0), pt(100, 0), pt(100, 100)]);
    const k = S.lineKey(f, 0);
    assert.eq(S.lineKey(f, 0), k, 'twice in a row');
    // A different OBJECT with the same content keys the same too — the tile
    // cache hands back a freshly decoded feature after every rebuild.
    const again = feat(12345, 'residential', [pt(0, 0), pt(100, 0), pt(100, 100)]);
    assert.eq(S.lineKey(again, 0), k, 'a re-decoded copy of the same way');
    assert.truthy(/^12345:[0-9a-f]{8}$/.test(k), `id in the clear plus 8 hex: ${k}`);
  });

  test('streets key: the id alone is not the key', () => {
    // A quarter of the transportation features on a real tile are MERGED
    // multi-lines — one shipped with 42 disconnected lines over 6.8 km. Keying
    // on the feature would weld every one of them into a single street.
    const f = feat(7, 'primary',
      [pt(0, 0), pt(100, 0)],
      [pt(900, 900), pt(1000, 900)]);
    assert.truthy(S.lineKey(f, 0) !== S.lineKey(f, 1), 'two lines of one feature differ');
  });

  test('streets key: class, ends and vertex count each move it', () => {
    const base = feat(7, 'primary', [pt(0, 0), pt(50, 0), pt(100, 0)]);
    const k = S.lineKey(base, 0);
    const moved = [
      ['class', feat(7, 'footway', [pt(0, 0), pt(50, 0), pt(100, 0)])],
      ['first vertex', feat(7, 'primary', [pt(1, 0), pt(50, 0), pt(100, 0)])],
      ['last vertex', feat(7, 'primary', [pt(0, 0), pt(50, 0), pt(101, 0)])],
      ['vertex count', feat(7, 'primary', [pt(0, 0), pt(25, 0), pt(50, 0), pt(100, 0)])],
    ];
    for (const [what, f] of moved) {
      assert.truthy(S.lineKey(f, 0) !== k, `a different ${what} keys differently`);
    }
  });

  test('streets key: lineIdx changes nothing except which line it names', () => {
    // The same way rasterizes into two tiles and can land at a different index
    // in each; it has to restore as ONE street.
    const a = feat(7, 'primary', [pt(0, 0), pt(100, 0)]);
    const b = feat(7, 'primary', [pt(500, 500), pt(600, 500)], [pt(0, 0), pt(100, 0)]);
    assert.eq(S.lineKey(b, 1), S.lineKey(a, 0), 'index 1 of one, index 0 of the other');
    // …and a missing line does not throw; it keys as the empty line.
    assert.truthy(typeof S.lineKey(a, 9) === 'string', 'an index past the end still keys');
  });

  // ── Lengths and points ────────────────────────────────────────────────
  test('streets: a line is as long as its segments', () => {
    const line = [pt(0, 0), pt(300, 400), pt(300, 500)];
    assert.eq(S.lineLengthM(line, MVT_TO_M), 600, '3-4-5 plus a hundred');
    assert.eq(S.lineLengthM([pt(5, 5)], MVT_TO_M), 0, 'one vertex is no line');
    assert.eq(S.lineLengthM(null, MVT_TO_M), 0, 'and neither is nothing');
  });

  test('streets: pointAtM walks the line and clamps at both ends', () => {
    const line = [pt(0, 0), pt(100, 0), pt(100, 100)];
    assert.eq(S.pointAtM(line, MVT_TO_M, 0).x, 0, 'the start');
    near(S.pointAtM(line, MVT_TO_M, 50).x, 50, 1e-9, 'halfway down the first leg');
    assert.eq(S.pointAtM(line, MVT_TO_M, 50).y, 0);
    // Past the corner: 100 m along the first leg, 30 up the second.
    near(S.pointAtM(line, MVT_TO_M, 130).x, 100, 1e-9, 'round the corner');
    near(S.pointAtM(line, MVT_TO_M, 130).y, 30, 1e-9);
    assert.eq(S.pointAtM(line, MVT_TO_M, -50).x, 0, 'before the start clamps to it');
    assert.eq(S.pointAtM(line, MVT_TO_M, 9999).y, 100, 'past the end clamps to it');
    assert.eq(S.pointAtM([], MVT_TO_M, 0), null, 'no vertices, no point');
  });

  test('streets: subLineM interpolates its ends and keeps the bends', () => {
    // The whole point of arclength intervals: a restored run follows the
    // street's real corners instead of cutting across them.
    const line = [pt(0, 0), pt(100, 0), pt(100, 100)];
    const mid = S.subLineM(line, MVT_TO_M, 50, 150);
    assert.eq(mid.length, 3, 'start, the corner, end');
    near(mid[0].x, 50, 1e-9, 'the start is interpolated');
    assert.eq(mid[1].x, 100, 'the corner vertex survives');
    assert.eq(mid[1].y, 0);
    near(mid[2].y, 50, 1e-9, 'and the end is interpolated');
    // Wholly inside one leg: two points, no vertices.
    assert.eq(S.subLineM(line, MVT_TO_M, 10, 20).length, 2, 'a run inside one leg');
    // The full line comes back whole.
    assert.eq(S.subLineM(line, MVT_TO_M, 0, 200).length, 3, 'the whole line');
  });

  test('streets: an empty run draws nothing at all', () => {
    // s0 === s1 gives [], NOT a doubled point: a zero-length run is nothing to
    // stroke, and two identical points would put a round-cap dot on a street
    // the player never restored.
    const line = [pt(0, 0), pt(100, 0)];
    assert.eq(S.subLineM(line, MVT_TO_M, 40, 40).length, 0, 'a zero-length range');
    assert.eq(S.subLineM(line, MVT_TO_M, 60, 40).length, 0, 'an inverted range');
    assert.eq(S.subLineM(line, MVT_TO_M, 200, 300).length, 0, 'a range past the end');
    // Clamped, not refused: a run that overhangs the end is trimmed to it.
    const over = S.subLineM(line, MVT_TO_M, 50, 300);
    assert.eq(over.length, 2);
    assert.eq(over[1].x, 100, 'trimmed to the last vertex');
  });

  // ── tileSpans ─────────────────────────────────────────────────────────
  test('streets tile: a line inside the square is all of it', () => {
    const line = [pt(100, 100), pt(1100, 100)];
    assert.eq(shape(S.tileSpans(line, MVT_TO_M, EXTENT)), '0..1000', 'the whole thousand metres');
  });

  test('streets tile: the buffer past the square belongs to the neighbour', () => {
    // MVT geometry runs past [0, extent] into the tile buffer, and the SAME
    // metres come back inside the next tile's copy of the way. Paying for them
    // twice is how a way that crosses an edge would count double.
    const out = [pt(EXTENT - 200, 50), pt(EXTENT + 800, 50)];
    assert.eq(shape(S.tileSpans(out, MVT_TO_M, EXTENT)), '0..200', 'only the metres inside');
    const before = [pt(-500, 50), pt(500, 50)];
    assert.eq(shape(S.tileSpans(before, MVT_TO_M, EXTENT)), '500..1000', 'and only from the edge in');
  });

  test('streets tile: a line that leaves and comes back gives two spans', () => {
    // A ring road that clips the corner of the tile, leaves, and re-enters.
    const line = [pt(100, 50), pt(-100, 50), pt(-100, 150), pt(100, 150), pt(300, 150)];
    const spans = S.tileSpans(line, MVT_TO_M, EXTENT);
    assert.eq(spans.length, 2, 'two separate stretches of this tile');
    // In for 100 m, out for 300, then back in for the last 300 — and the last
    // two segments, which touch at 500 m, come back as ONE run.
    assert.eq(shape(spans), '0..100 400..700', 'in and out and in again');
  });

  test('streets tile: a line wholly outside the square is nothing', () => {
    assert.eq(S.tileSpans([pt(-500, -500), pt(-100, -400)], MVT_TO_M, EXTENT).length, 0,
      'off the corner');
    assert.eq(S.tileSpans([pt(EXTENT + 10, 100), pt(EXTENT + 900, 100)], MVT_TO_M, EXTENT).length, 0,
      'past the far edge');
    assert.eq(S.tileSpans([pt(0, 0)], MVT_TO_M, EXTENT).length, 0, 'one vertex is no line');
  });

  test('streets tile: a way running along the edge belongs to the tile', () => {
    // Touching counts — the same rule the road mask stamps with. A street on
    // the boundary otherwise restores in neither tile.
    assert.eq(shape(S.tileSpans([pt(0, 0), pt(0, 500)], MVT_TO_M, EXTENT)), '0..500',
      'straight down the west edge');
  });

  // ── reachIntervals ────────────────────────────────────────────────────
  // A 3×3 block of cells in reach, centred on cell (5,5): metres 50..80 on
  // both axes at CELL_M = 10.
  const box = (x0, x1, y0, y1) => (ix, iy) => ix >= x0 && ix <= x1 && iy >= y0 && iy <= y1;

  test('streets reach: a straight line through the block pays exact metres', () => {
    // Along y = 55 (cell row 5), from well west to well east. Cells 4..6 are in
    // reach, i.e. metres 40..70 of the tile — 30 m of it, starting 40 m along.
    const line = [pt(0, 55), pt(1000, 55)];
    const got = S.reachIntervals(line, MVT_TO_M, CELL_M, box(4, 6, 4, 6));
    assert.eq(shape(got), '40..70', 'three cells, exactly');
    assert.eq(got.length, 1, 'and merged into ONE run, not three');
  });

  test('streets reach: nothing outside the block is ever paid', () => {
    const away = [pt(0, 500), pt(1000, 500)];
    assert.eq(S.reachIntervals(away, MVT_TO_M, CELL_M, box(4, 6, 4, 6)).length, 0,
      'a street on the far side of the tile');
    assert.eq(S.reachIntervals([pt(0, 55)], MVT_TO_M, CELL_M, box(4, 6, 4, 6)).length, 0,
      'one vertex is no line');
    assert.eq(S.reachIntervals(away, MVT_TO_M, 0, box(4, 6, 4, 6)).length, 0,
      'and a zero cell size answers nothing rather than dividing by it');
  });

  test('streets reach: a street that clips ONE corner cell pays only that clip', () => {
    // The case sampling gets wrong: the line crosses the very corner of cell
    // (4,4) — metres 40..50 on both axes — and nothing else in reach. Exact
    // traversal charges the sliver; a sampler at any fixed step misses it or
    // pays for the whole cell.
    const line = [pt(30, 59), pt(59, 30)];       // the anti-diagonal, clipping (4,4)
    const got = S.reachIntervals(line, MVT_TO_M, CELL_M, box(4, 4, 4, 4));
    assert.eq(got.length, 1, 'one sliver');
    const len = S.totalM(got);
    assert.gt(len, 0, 'it really does clip the cell');
    // The chord of x+y=89 across [40,50]² runs from (40,49) to (49,40):
    // 9√2 ≈ 12.728 m.
    near(len, 9 * Math.SQRT2, 1e-6, 'the exact chord, not the whole cell');
    assert.lt(len, CELL_M * Math.SQRT2, 'and less than the cell diagonal');
  });

  test('streets reach: a diagonal is measured along the street, not the grid', () => {
    // 45° through the 3×3 block: it enters at (40,40) and leaves at (70,70),
    // which is 30√2 m of street even though it is only 3 cells wide.
    const line = [pt(0, 0), pt(1000, 1000)];
    const got = S.reachIntervals(line, MVT_TO_M, CELL_M, box(4, 6, 4, 6));
    assert.eq(got.length, 1, 'one unbroken run through the block');
    near(S.totalM(got), 30 * Math.SQRT2, 1e-6, 'measured along the carriageway');
    near(got[0][0], 40 * Math.SQRT2, 1e-6, 'starting where it enters');
  });

  test('streets reach: a street that leaves the block and returns pays twice', () => {
    // Out of the block over the middle of its run and back in — two runs, not
    // one, so the dwell can ripen them independently.
    const line = [pt(45, 55), pt(45, 200), pt(65, 200), pt(65, 55)];
    const got = S.reachIntervals(line, MVT_TO_M, CELL_M, box(4, 6, 4, 6));
    assert.eq(got.length, 2, 'two stretches of the same street');
  });

  test('streets reach: what is paid never exceeds the street', () => {
    // The invariant a traversal bug breaks first: every piece is charged once.
    const lines = [
      [pt(0, 55), pt(1000, 55)],
      [pt(0, 0), pt(1000, 1000)],
      [pt(3, 7), pt(140, 91), pt(21, 200), pt(-40, 12)],
      [pt(-500, -500), pt(900, 640), pt(120, 33)],
    ];
    for (const line of lines) {
      const all = S.reachIntervals(line, MVT_TO_M, CELL_M, () => true);
      const len = S.lineLengthM(line, MVT_TO_M);
      near(S.totalM(all), len, 1e-6, 'everything in reach is the whole line');
      assert.lte(S.totalM(all), len + 1e-6, 'and never more than the line');
      const some = S.reachIntervals(line, MVT_TO_M, CELL_M, box(-2, 4, -2, 4));
      assert.lte(S.totalM(some), len + 1e-6, 'nor is a subset');
    }
  });

  // ── Interval algebra ──────────────────────────────────────────────────
  test('streets intervals: merging sorts, joins and drops the empties', () => {
    assert.eq(shape(S.mergeIntervals([[5, 7], [0, 2]])), '0..2 5..7', 'sorted');
    assert.eq(shape(S.mergeIntervals([[0, 5], [3, 9]])), '0..9', 'overlapping');
    assert.eq(shape(S.mergeIntervals([[0, 5], [5, 9]])), '0..9', 'TOUCHING joins — one street');
    assert.eq(shape(S.mergeIntervals([[0, 9], [3, 4]])), '0..9', 'nested vanishes into its parent');
    assert.eq(S.mergeIntervals([[4, 4]]).length, 0, 'empty is dropped');
    assert.eq(S.mergeIntervals([[9, 4]]).length, 0, 'and so is inverted');
    assert.eq(S.mergeIntervals([[0, NaN], null, [1, 2]]).length, 1, 'junk is dropped, not thrown on');
    assert.eq(S.mergeIntervals(null).length, 0, 'nothing merges to nothing');
    // The input is never mutated — the sight holds these arrays between frames.
    const src = [[5, 7], [0, 2]];
    S.mergeIntervals(src);
    assert.eq(src[0][0], 5, 'the caller keeps its own list');
  });

  test('streets intervals: intersect keeps only what both hold', () => {
    assert.eq(shape(S.intersect([[0, 10]], [[4, 6]])), '4..6', 'nested');
    assert.eq(shape(S.intersect([[0, 5]], [[5, 9]])), '', 'touching share no metres');
    assert.eq(shape(S.intersect([[0, 10]], [[2, 4], [6, 8]])), '2..4 6..8', 'two bites');
    assert.eq(shape(S.intersect([[0, 4], [6, 10]], [[2, 8]])), '2..4 6..8', 'and from both sides');
    assert.eq(S.intersect([[0, 10]], []).length, 0, 'nothing intersects to nothing');
  });

  test('streets intervals: subtract takes the middle out', () => {
    assert.eq(shape(S.subtract([[0, 10]], [[4, 6]])), '0..4 6..10', 'a hole in the middle');
    assert.eq(shape(S.subtract([[0, 10]], [[0, 10]])), '', 'all of it');
    assert.eq(shape(S.subtract([[0, 10]], [[10, 20]])), '0..10', 'a neighbour takes nothing');
    assert.eq(shape(S.subtract([[0, 10]], [[-5, 3]])), '3..10', 'an overhang trims the front');
    assert.eq(shape(S.subtract([[0, 10]], [])), '0..10', 'nothing taken');
    assert.eq(shape(S.subtract([[0, 4], [6, 10]], [[2, 8]])), '0..2 8..10', 'across two runs');
  });

  test('streets intervals: union and totalM', () => {
    assert.eq(shape(S.union([[0, 4]], [[4, 9]])), '0..9', 'two halves of one street');
    assert.eq(shape(S.union([[0, 4]], [[6, 9]])), '0..4 6..9', 'and two that are not');
    assert.eq(S.totalM([[0, 4], [6, 9]]), 7, 'summed');
    assert.eq(S.totalM([]), 0);
    assert.eq(S.totalM(null), 0, 'and nothing is zero metres, not NaN');
  });

  test('streets intervals: the save form round-trips', () => {
    const list = [[0, 4.5], [6, 9.25]];
    assert.eq(S.flatten(list).join(','), '0,4.5,6,9.25', 'flat pairs');
    assert.eq(shape(S.unflatten(S.flatten(list))), shape(list), 'and back again');
    assert.eq(S.unflatten([]).length, 0);
    assert.eq(S.unflatten(null).length, 0);
    assert.eq(shape(S.unflatten([0, 4, 9])), '0..4', 'a truncated save drops the half pair');
    assert.eq(shape(S.unflatten([6, 9, 0, 4])), '0..4 6..9', 'and comes back sorted');
  });

  // ── The dwell ─────────────────────────────────────────────────────────
  const DWELL = 2000;

  test('streets sight: nothing ripens before the dwell is up', () => {
    const sight = S.createSight();
    sight.snapshot(0, 'k', [[0, 100]]);
    assert.eq(sight.ripe(0, DWELL, 'k').length, 0, 'the instant it came into sight');
    assert.eq(sight.ripe(1999, DWELL, 'k').length, 0, 'a millisecond short');
    assert.eq(sight.ripe(500, DWELL, 'nobody').length, 0, 'and an unwatched key is empty');
  });

  test('streets sight: the whole window in sight ripens', () => {
    const sight = S.createSight();
    sight.snapshot(0, 'k', [[0, 100]]);
    assert.eq(shape(sight.ripe(2000, DWELL, 'k')), '0..100', 'at exactly the dwell');
    assert.eq(shape(sight.ripe(5000, DWELL, 'k')), '0..100', 'and after it');
  });

  test('streets sight: a stretch that left mid-window is not ripe', () => {
    // The rule is CONTINUOUS sight. A street the player walked past, turned
    // away from and came back to has not been watched for two seconds.
    const sight = S.createSight();
    sight.snapshot(0, 'k', [[0, 100]]);
    sight.snapshot(1000, 'k', []);          // out of reach — the clock is dropped
    assert.eq(sight.keys().length, 0, 'and the key with it');
    sight.snapshot(1200, 'k', [[0, 100]]);  // back again
    assert.eq(sight.ripe(3000, DWELL, 'k').length, 0, 'only 1800 ms of the window');
    assert.eq(shape(sight.ripe(3200, DWELL, 'k')), '0..100', 'two full seconds later it is ripe');
  });

  test('streets sight: only the metres held for the WHOLE window ripen', () => {
    // The reach slid along the street: 0..100 was in sight, then only 60..140.
    // What has been watched throughout is the overlap, and nothing else — the
    // rest starts its own clock from where it came in.
    const sight = S.createSight();
    sight.snapshot(0, 'k', [[0, 100]]);
    sight.snapshot(1000, 'k', [[60, 140]]);
    assert.eq(shape(sight.ripe(2000, DWELL, 'k')), '60..100', 'the intersection only');
    // Once the older snapshot has aged out of the window entirely, the newer
    // stretch is the whole answer.
    assert.eq(shape(sight.ripe(3000, DWELL, 'k')), '60..140', 'a second later, all of it');
  });

  test('streets sight: a stretch that shrank to nothing ripens nothing', () => {
    const sight = S.createSight();
    sight.snapshot(0, 'k', [[0, 50]]);
    sight.snapshot(500, 'k', [[80, 120]]);   // no overlap at all
    assert.eq(sight.ripe(2000, DWELL, 'k').length, 0, 'they share no metres');
  });

  test('streets sight: pruning keeps the boundary snapshot', () => {
    // The snapshot that was CURRENT when the window opened is what says what
    // was in sight at that instant; prune it and the street can never ripen.
    const sight = S.createSight();
    for (let t = 0; t <= 10000; t += 100) sight.snapshot(t, 'k', [[0, 100]]);
    assert.eq(shape(sight.ripe(10000, DWELL, 'k')), '0..100', 'ripe over a long watch');
    // Asked again at the same instant — the prune must not have eaten the
    // boundary out from under the second call.
    assert.eq(shape(sight.ripe(10000, DWELL, 'k')), '0..100', 'and ripe again');
    assert.eq(shape(sight.ripe(10500, DWELL, 'k')), '0..100', 'and still ripe later');
  });

  test('streets sight: ripeAll reports every street that is ready, and only those', () => {
    const sight = S.createSight();
    sight.snapshot(0, 'a', [[0, 100]]);
    sight.snapshot(0, 'b', [[0, 50]]);
    sight.snapshot(1500, 'c', [[0, 10]]);    // too new
    const all = sight.ripeAll(2000, DWELL);
    assert.eq(all.length, 2, 'two ripe');
    const byKey = Object.fromEntries(all.map((r) => [r.key, shape(r.intervals)]));
    assert.eq(byKey.a, '0..100');
    assert.eq(byKey.b, '0..50');
    assert.eq(byKey.c, undefined, 'the newcomer waits its turn');
    assert.eq(sight.ripeAll(0, DWELL).length, 0, 'nothing is ripe at the start');
  });

  test('streets sight: drop and clear forget the clock', () => {
    const sight = S.createSight();
    sight.snapshot(0, 'a', [[0, 100]]);
    sight.snapshot(0, 'b', [[0, 100]]);
    sight.drop('a');
    assert.eq(sight.keys().join(','), 'b', 'a is forgotten');
    assert.eq(sight.ripe(9000, DWELL, 'a').length, 0, 'and starts over when it returns');
    sight.clear();
    assert.eq(sight.keys().length, 0, 'and clear forgets the lot');
    assert.eq(sight.ripeAll(9000, DWELL).length, 0);
  });

  test('streets sight: what it hands back is a copy', () => {
    // app.js restores straight out of this list; mutating it must not rewrite
    // what the sight still believes it is watching.
    const sight = S.createSight();
    sight.snapshot(0, 'k', [[0, 100]]);
    const got = sight.ripe(2000, DWELL, 'k');
    got[0][1] = 5;
    assert.eq(shape(sight.ripe(2000, DWELL, 'k')), '0..100', 'the sight is unharmed');
  });

  // ── The save ──────────────────────────────────────────────────────────
  const TK = '14/8190/5443';
  const LK = '12345:deadbeef';

  test('streets save: nothing restored reads as nothing', () => {
    assert.eq(S.restoredList({}, TK, LK).length, 0, 'an empty save');
    assert.eq(S.restoredList(null, TK, LK).length, 0, 'and no save at all');
    assert.eq(S.epoch({}), 0, 'the epoch starts at zero');
    assert.eq(S.epoch(null), 0);
  });

  test('streets save: restoring banks the metres and stores them flat', () => {
    const save = {};
    const out = S.restore(save, TK, LK, [[0, 40]]);
    assert.eq(out.addedM, 40, 'forty metres of street');
    assert.eq(shape(out.newly), '0..40', 'all of it new');
    assert.eq(save.streets[TK][LK].join(','), '0,40', 'stored as flat pairs');
    assert.eq(shape(S.restoredList(save, TK, LK)), '0..40', 'and read back as a list');
    assert.eq(S.epoch(save), 1, 'the epoch moved');
  });

  test('streets save: only the metres NOT already restored are paid', () => {
    const save = {};
    S.restore(save, TK, LK, [[0, 40]]);
    const again = S.restore(save, TK, LK, [[20, 60]]);
    assert.eq(again.addedM, 20, 'the twenty new metres only');
    assert.eq(shape(again.newly), '40..60', 'and it says which twenty');
    assert.eq(shape(S.restoredList(save, TK, LK)), '0..60', 'unioned into one run');
    assert.eq(save.streets[TK][LK].join(','), '0,60', 'and stored as one pair, not two');
  });

  test('streets save: restoring the same street again pays nothing and moves nothing', () => {
    // The sweep re-offers ripe metres every frame. If a repeat bumped the
    // epoch the overlay would rebuild both its canvases every frame forever.
    const save = {};
    S.restore(save, TK, LK, [[0, 40]]);
    const ep = S.epoch(save);
    const again = S.restore(save, TK, LK, [[10, 30]]);
    assert.eq(again.addedM, 0, 'no metres');
    assert.eq(again.newly.length, 0, 'and nothing new to shine');
    assert.eq(S.epoch(save), ep, 'and the epoch is exactly where it was');
    assert.eq(S.restore(save, TK, LK, []).addedM, 0, 'an empty offer pays nothing too');
    assert.eq(S.epoch(save), ep);
  });

  test('streets save: two halves restored apart join into one run', () => {
    // The metres are the point: a street walked from each end has no seam.
    const save = {};
    S.restore(save, TK, LK, [[0, 50]]);
    S.restore(save, TK, LK, [[80, 120]]);
    assert.eq(shape(S.restoredList(save, TK, LK)), '0..50 80..120', 'two runs so far');
    const join = S.restore(save, TK, LK, [[45, 85]]);
    assert.eq(join.addedM, 30, 'only the gap is paid');
    assert.eq(shape(S.restoredList(save, TK, LK)), '0..120', 'and the street is whole');
  });

  test('streets save: tiles and lines keep their own rows', () => {
    const save = {};
    const OTHER = '14/8190/5444';
    S.restore(save, TK, LK, [[0, 10]]);
    S.restore(save, TK, '7:cafebabe', [[0, 20]]);
    S.restore(save, OTHER, LK, [[0, 30]]);
    assert.eq(S.totalM(S.restoredList(save, TK, LK)), 10);
    assert.eq(S.totalM(S.restoredList(save, TK, '7:cafebabe')), 20);
    assert.eq(S.totalM(S.restoredList(save, OTHER, LK)), 30, 'the same way in the next tile');
    assert.eq(S.epoch(save), 3, 'three restores, three bumps');
  });

  test('streets save: an empty row is swept up rather than saved forever', () => {
    const save = { streets: { [TK]: { [LK]: [], other: [0, 5] } } };
    S.restore(save, TK, LK, []);
    assert.eq(save.streets[TK][LK], undefined, 'the empty row is gone');
    assert.eq(save.streets[TK].other.join(','), '0,5', 'the real one is not');
    assert.eq(S.epoch(save), 0, 'and housekeeping is not a restore');
    // The last row going leaves no empty tile behind either.
    const lone = { streets: { [TK]: { [LK]: [] } } };
    S.restore(lone, TK, LK, []);
    assert.eq(lone.streets[TK], undefined, 'the tile goes with its last street');
  });

  test('streets save: a junk save is read, not crashed on', () => {
    assert.eq(S.restoredList({ streets: 5 }, TK, LK).length, 0, 'streets is not an object');
    assert.eq(S.restoredList({ streets: { [TK]: null } }, TK, LK).length, 0, 'nor is the tile');
    const save = { streets: { [TK]: 7 } };
    assert.eq(S.restore(save, TK, LK, [[0, 10]]).addedM, 10, 'a junk tile row is replaced');
    assert.eq(save.streets[TK][LK].join(','), '0,10');
    assert.eq(S.restore(null, TK, LK, [[0, 10]]).addedM, 0, 'and no save restores nothing');
  });

  // ── The whole loop, end to end ────────────────────────────────────────
  test('streets: a walk down a street restores exactly the metres walked', () => {
    // A straight residential way across the tile, the player standing beside
    // it with a 3×3 reach, holding still for the dwell. What restores is the
    // three cells of street in reach — not the way, not the cells.
    const f = feat(4242, 'residential', [pt(0, 55), pt(1000, 55)]);
    const line = f.geom[0];
    const key = S.lineKey(f, 0);
    const save = {};
    const sight = S.createSight();
    const seen = S.intersect(
      S.reachIntervals(line, MVT_TO_M, CELL_M, box(4, 6, 4, 6)),
      S.tileSpans(line, MVT_TO_M, EXTENT));
    const fresh = S.subtract(seen, S.restoredList(save, TK, key));
    sight.snapshot(0, `${TK}|${key}`, fresh);
    assert.eq(sight.ripeAll(1000, DWELL).length, 0, 'a second is not enough');
    const ripe = sight.ripeAll(2000, DWELL);
    assert.eq(ripe.length, 1, 'the street ripens');
    const out = S.restore(save, TK, key, ripe[0].intervals);
    assert.eq(out.addedM, 30, 'thirty metres, which is what the reach covered');
    // …and the run the overlay strokes is that exact stretch of the street.
    const pts = S.subLineM(line, MVT_TO_M, out.newly[0][0], out.newly[0][1]);
    assert.eq(pts.length, 2, 'a straight run');
    near(pts[0].x, 40, 1e-9, 'from 40 m');
    near(pts[1].x, 70, 1e-9, 'to 70 m');
    // Standing there another second earns nothing more.
    const round2 = S.restore(save, TK, key, ripe[0].intervals);
    assert.eq(round2.addedM, 0, 'the street is already clean');
  });
})();
