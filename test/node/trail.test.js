// Cobble trails — the segment arithmetic (src/trail.js) and the worldgen
// naming pass that decides WHICH cells belong to which trail.
//
// app.js can't load headlessly (it needs Phaser), which is exactly why the
// arithmetic lives in trail.js: these run the real shipping numbers, not a
// copy of them that would drift the moment someone retunes the feel.

// ── The segment ladder ────────────────────────────────────────────────────
(() => {
  const T = Trail;
  const S = T.SEGMENT_CELLS;

  test('trail: the segment cap is 20 stones', () => {
    // The user-facing promise: a long trail asks for 20 at a time, not all
    // of itself. Pinned as a literal so a retune is a deliberate edit here.
    assert.eq(S, 20, 'SEGMENT_CELLS');
  });

  test('trail: a short trail counts against its own length', () => {
    // The canonical example: a 9-cell trail reads 1/9 … 9/9, never 1/20.
    for (let c = 1; c <= 9; c++) {
      const p = T.progress(9, c);
      assert.eq(p.pos, c, `stone ${c} is at position ${c}`);
      assert.eq(p.target, 9, 'and the target is the trail itself');
    }
  });

  test('trail: a long trail counts in 20s and restarts', () => {
    assert.eq(T.progress(45, 1).target, 20, 'first segment wants 20');
    assert.eq(T.progress(45, 20).pos, 20, 'stone 20 closes it');
    assert.eq(T.progress(45, 21).pos, 1, 'stone 21 restarts the count');
    assert.eq(T.progress(45, 21).target, 20, 'second segment wants 20 too');
    assert.eq(T.progress(45, 41).pos, 1, 'and again at 41');
    assert.eq(T.progress(45, 41).target, 5, 'but the remainder only wants 5');
    assert.eq(T.progress(45, 45).pos, 5, 'the last stone closes the remainder');
  });

  test('trail: prizes = ceil(length / 20)', () => {
    for (const [total, want] of [[1, 1], [8, 1], [20, 1], [21, 2], [40, 2],
                                 [41, 3], [45, 3], [200, 10]]) {
      assert.eq(T.maxPrizes(total), want, `a ${total}-cell trail offers ${want}`);
    }
  });

  test('trail: a prize lands on every segment boundary, remainder included', () => {
    // 45 cells: paid at 20, at 40, and again when the final 5 are lit.
    const paid = [];
    let last = 0;
    for (let c = 1; c <= 45; c++) {
      const n = T.prizesEarned(45, c);
      if (n > last) { paid.push(c); last = n; }
    }
    assert.eq(paid.join(','), '20,40,45', 'prizes at 20 / 40 / 45');
    assert.eq(last, T.maxPrizes(45), 'and they add up to the trail\'s total');
  });

  test('trail: an exact multiple pays no extra prize at the end', () => {
    // 40 cells is two full segments — the remainder branch must not fire a
    // third one when the last stone is also the 40th.
    assert.eq(T.prizesEarned(40, 40), 2, 'two prizes, not three');
    assert.eq(T.prizesEarned(40, 40), T.maxPrizes(40), 'matches the ceiling');
  });

  test('trail: prizes never exceed the ceiling, even over-claimed', () => {
    // Defensive: a stale save could carry more stones than the rebuilt tile's
    // trail has cells. It must not mint prizes out of that.
    assert.eq(T.prizesEarned(9, 99), T.maxPrizes(9), 'capped at the ceiling');
    assert.eq(T.prizesEarned(0, 5), 0, 'a zero-length trail pays nothing');
    assert.eq(T.prizesEarned(20, 0), 0, 'and an unwalked one pays nothing');
  });

  test('trail: a stub too short to be worth walking pays nothing', () => {
    // Every cobble cell is named now (roads included), so without this floor
    // a two-cell service stub would pop the full treasure ceremony.
    assert.eq(T.MIN_TRAIL_CELLS, 8, 'the floor');
    assert.falsy(T.qualifies(7), 'a 7-cell stub does not qualify');
    assert.truthy(T.qualifies(8), 'an 8-cell trail does');
  });
})();

// ── Which cells belong to which trail, through the real rasterizer ────────
(function () {
const T = WorldGen.T;
const CPE = 64;
const TILE_EDGE_M = CPE * 7;
const EXTENT = 4096;
const CELL_MVT = EXTENT / CPE;
const cellToMvt = (c) => c * CELL_MVT + CELL_MVT / 2;
const line = (cells) => cells.map(([cx, cy]) => ({ x: cellToMvt(cx), y: cellToMvt(cy) }));
const whole = () => line([[0, 0], [CPE - 1, 0], [CPE - 1, CPE - 1], [0, CPE - 1]]);

// A park with a named footpath across the middle and a named street down the
// side, crossing each other — the case that a plain flood fill over the cobble
// mask gets wrong (it would merge both into one component).
function build() {
  return WorldGen.rasterizeTile([
    { name: 'landuse', features: [
      { type: 3, tags: { class: 'park' }, geom: [whole()] },
    ] },
    { name: 'transportation', features: [
      { type: 2, tags: { class: 'path' },   geom: [line([[8, 30], [56, 30]])] },
      { type: 2, tags: { class: 'street' }, geom: [line([[30, 8], [30, 56]])] },
    ] },
    { name: 'transportation_name', features: [
      { type: 2, tags: { name: 'Mill Lane' },  geom: [line([[8, 30], [56, 30]])] },
      { type: 2, tags: { name: 'Oak Street' }, geom: [line([[30, 8], [30, 56]])] },
    ] },
  ], CPE, 0, 0, TILE_EDGE_M);
}

const ROADISH = new Set([T.ROAD, T.ROAD_MD, T.ROAD_LG, T.PATH]);

test('trail names: a ROAD cell is claimable, not just a path cell', () => {
  // This is the whole "road cobbles work too now" change: before it, only
  // terrain 8 landed in pathNames and a street lit nothing.
  const e = build();
  let roadNamed = 0;
  for (let cy = 0; cy < CPE; cy++) {
    for (let cx = 0; cx < CPE; cx++) {
      const t = e.grid[cy * CPE + cx];
      if (t !== T.PATH && ROADISH.has(t) && e.pathNames[`${cx}_${cy}`]) roadNamed++;
    }
  }
  assert.gt(roadNamed, 20, 'the street\'s cells carry a trail name');
});

test('trail names: every cobble cell gets a name, and nothing else does', () => {
  const e = build();
  for (let cy = 0; cy < CPE; cy++) {
    for (let cx = 0; cx < CPE; cx++) {
      const t = e.grid[cy * CPE + cx];
      const named = !!e.pathNames[`${cx}_${cy}`];
      if (ROADISH.has(t)) assert.truthy(named, `cobble ${cx},${cy} is named`);
      else assert.falsy(named, `non-cobble ${cx},${cy} is not`);
    }
  }
});

test('trail names: two crossing streets stay two trails', () => {
  // A flood fill over the cobble mask would swallow both into one component
  // at the junction — a 400-cell blob with a single name. The wavefront keeps
  // each way's own identity.
  const e = build();
  const names = new Set(Object.values(e.pathNames));
  assert.truthy(names.has('Mill Lane'), 'the footpath kept its name');
  assert.truthy(names.has('Oak Street'), 'and the street kept its own');
  // Each name owns a run of cells long enough to actually pay out.
  const count = (n) => Object.values(e.pathNames).filter((v) => v === n).length;
  assert.gt(count('Mill Lane'), Trail.MIN_TRAIL_CELLS, 'Mill Lane is walkable');
  assert.gt(count('Oak Street'), Trail.MIN_TRAIL_CELLS, 'so is Oak Street');
});

test('trail names: an unnamed way still becomes its own trail', () => {
  // No transportation_name layer at all: the synthetic pass has to name the
  // component, or the way would be unclaimable.
  const e = WorldGen.rasterizeTile([
    { name: 'landuse', features: [
      { type: 3, tags: { class: 'park' }, geom: [whole()] },
    ] },
    { name: 'transportation', features: [
      { type: 2, tags: { class: 'path' }, geom: [line([[8, 20], [56, 20]])] },
    ] },
  ], CPE, 0, 0, TILE_EDGE_M);
  const names = new Set(Object.values(e.pathNames));
  assert.eq(names.size, 1, 'one trail');
  const only = [...names][0];
  assert.truthy(only.startsWith('trail#'), `synthetic id, got "${only}"`);
});
})();
