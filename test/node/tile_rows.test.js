// A tile's cell grid is its ROW's (CLAUDE.md "Every player sees the SAME
// generated world"): WorldGen.cellsPerEdgeForTile(ty), never the save's
// scene.cellsPerTile (START_LAT's count). The two agree on most rows, but
// every ~15 rows (~20 km) the row count steps by one — and a save anchored
// near such a seam has tiles on BOTH grids in view at once.
//
// This pins coords.js' per-row machinery against a real seam: a save at
// 49.80°N whose home row (5570) has 226 cells an edge — the legacy count —
// while the row just north of it (5569) builds 225.
//   · metres ⇄ (tx, ty, ix, iy) ⇄ absolute cell round-trip on both rows
//   · the absolute encoding is contiguous across the seam and the OLD one on
//     the reference row (a save's keys stay put)
//   · sameAbsCell / the reach test across the seam
//   · the drawn window: a band on the other grid tiles seamlessly — no gap,
//     no overlap, no cell drawn twice or skipped — within a hair of its true
//     position
//   · the fog masks are sized per tile, and survive a flush / reload
// …plus the two stream rules the refactor landed with it: a cave's spawn
// anchors ignore a player's own `_synthetic` stairs, and the pest amnesty
// takes no extra draws.

(function () {
const LAT = 49.80, LON = -123.1;
const T = WorldGen.TILE_PX;

function rowsScene(over) {
  const originPx = WorldGen.lonLatToWorldPx(LON, LAT, WorldGen.Z);
  const mPerPx = WorldGen.metersPerPixel(LAT, WorldGen.Z);
  return Object.assign({
    originPx, mPerPx,
    startWorldM: { x: originPx.x * mPerPx, y: originPx.y * mPerPx },
    cellsPerTile: WorldGen.cellsPerEdgeForLat(LAT),
    cellsForRow: WorldGen.cellsPerEdgeForTile,
    tileEdgeM: WorldGen.tileEdgeMeters(LAT),
    cellM: WorldGen.CELL_M,
    playerM: { x: 0, y: 0 }, feetOffsetM: 0, depth: 0,
    save: { energy: 100, reachUpgrades: 0 },
    viewCenterX: 400, viewCenterY: 300,
  }, over);
}

const S = rowsScene();
const HOME_TX = Math.floor(S.originPx.x / T);
const HOME_TY = Math.floor(S.originPx.y / T);
// The nearest row seam whose grid steps, and the rows either side of it.
let SEAM = null;
for (let d = 0; d < 40 && SEAM == null; d++) {
  for (const t of [HOME_TY - d, HOME_TY + d]) {
    if (WorldGen.cellsPerEdgeForTile(t) !== WorldGen.cellsPerEdgeForTile(t + 1)) { SEAM = t; break; }
  }
}
const UP = SEAM, DN = SEAM + 1;                    // tile rows above / below the seam
const NUP = WorldGen.cellsPerEdgeForTile(UP), NDN = WorldGen.cellsPerEdgeForTile(DN);

// Put the player's FEET on a world point.
const at = (s, wx, wy) => { s.playerM = { x: wx - s.startWorldM.x, y: wy - s.startWorldM.y }; return s; };

test('tile rows: the fixture straddles a grid step next to a legacy-sized home row', () => {
  assert.truthy(SEAM != null, 'found a seam near home');
  assert.truthy(NUP !== NDN, `rows ${UP}/${DN} differ (${NUP} vs ${NDN})`);
  assert.truthy(NUP !== S.cellsPerTile || NDN !== S.cellsPerTile,
    'one side of it is NOT the save\'s legacy cellsPerTile');
  assert.eq(rowCells(S, UP), NUP, 'coords asks the row, not the save');
  assert.eq(rowCells(S, DN), NDN, 'on both sides');
});

test('tile rows: metres ⇄ tile cell ⇄ absolute cell round-trip on BOTH rows', () => {
  for (const ty of [UP, DN]) {
    const N = rowCells(S, ty);
    for (const tx of [HOME_TX - 1, HOME_TX, HOME_TX + 3]) {
      for (const ix of [0, 1, (N >> 1), N - 2, N - 1]) {
        for (const iy of [0, 1, (N >> 1), N - 1]) {
          const m = tileCellCenterMeters(S, tx, ty, ix, iy);
          const t = worldMetersToTileCell(S, m.x, m.y);
          assert.eq(`${t.tx},${t.ty},${t.ix},${t.iy},${t.n}`, `${tx},${ty},${ix},${iy},${N}`,
            `centre of ${tx}/${ty} (${ix},${iy}) resolves back to it`);
          // Anywhere inside the cell, not just its centre.
          const cm = S.tileEdgeM / N;
          const t2 = worldMetersToTileCell(S, m.x + 0.45 * cm, m.y - 0.45 * cm);
          assert.eq(`${t2.ix},${t2.iy}`, `${ix},${iy}`, 'a point near the corner is still in it');
          const a = tileCellToAbs(S, tx, ty, ix, iy);
          const back = absCellToTile(S, a.cellIX, a.cellIY);
          assert.eq(`${back.tx},${back.ty},${back.ix},${back.iy}`, `${tx},${ty},${ix},${iy}`,
            'the absolute key decodes to the same tile cell');
          const c = absCellCenterMeters(S, a.cellIX, a.cellIY);
          assert.lt(Math.hypot(c.x - m.x, c.y - m.y), 1e-6, 'and centres at the same point');
        }
      }
    }
  }
});

test('tile rows: the absolute encoding is contiguous across the seam, unique, and the old one on a legacy row', () => {
  const tx = HOME_TX;
  const lastUp = tileCellToAbs(S, tx, UP, 10, NUP - 1);
  const firstDn = tileCellToAbs(S, tx, DN, 10, 0);
  assert.eq(firstDn.cellIY, lastUp.cellIY + 1, 'the row below the seam starts one past the last row above it');
  // A point a hair either side of the seam lands in those two rows.
  const seamY = S.startWorldM.y + (DN * T - S.originPx.y) * S.mPerPx;
  const xM = S.startWorldM.x + (tx * T + 100 - S.originPx.x) * S.mPerPx;
  assert.eq(worldMetersToAbsCell(S, xM, seamY - 0.01).cellIY, lastUp.cellIY, 'just north: the upper row\'s last');
  assert.eq(worldMetersToAbsCell(S, xM, seamY + 0.01).cellIY, firstDn.cellIY, 'just south: the lower row\'s first');
  // No two tile cells share a key, across the seam and along the rows.
  const seen = new Set();
  for (const ty of [UP - 1, UP, DN, DN + 1]) {
    const N = rowCells(S, ty);
    for (const tx2 of [HOME_TX - 1, HOME_TX, HOME_TX + 1]) {
      for (const ix of [0, 1, N - 1]) {
        for (const iy of [0, N - 1]) {
          const a = tileCellToAbs(S, tx2, ty, ix, iy);
          const k = cellKeyFromAbsCell(a.cellIX, a.cellIY);
          assert.falsy(seen.has(k), `key ${k} is unique`);
          seen.add(k);
        }
      }
    }
  }
  // On every row whose grid IS the save's reference count, the key is the
  // pre-per-row one bit for bit — tilled / dug / placed-rock keys stay put.
  const nref = S.cellsPerTile;
  const legacyRow = [UP, DN, HOME_TY].find((t) => rowCells(S, t) === nref);
  assert.truthy(legacyRow != null, 'a row on the legacy grid is in the fixture');
  for (const tx2 of [HOME_TX, HOME_TX + 2]) {
    const a = tileCellToAbs(S, tx2, legacyRow, 7, 9);
    assert.eq(`${a.cellIX},${a.cellIY}`, `${tx2 * nref + 7},${legacyRow * nref + 9}`,
      'tx*N+ix, ty*N+iy exactly as before');
    const m = tileCellCenterMeters(S, tx2, legacyRow, 7, 9);
    const p = worldMetersToTilePx(S, m.x, m.y);
    const cps = T / nref;
    const w = worldMetersToAbsCell(S, m.x, m.y);
    assert.eq(`${w.cellIX},${w.cellIY}`, `${Math.floor(p.x / cps)},${Math.floor(p.y / cps)}`,
      'and the metre conversion is the old floor(px / cps)');
  }
});

test('tile rows: sameAbsCell and the player\'s cell on both sides of the seam', () => {
  for (const [ty, N] of [[UP, NUP], [DN, NDN]]) {
    const cm = S.tileEdgeM / N;
    for (const iy of [0, N - 1]) {
      const m = tileCellCenterMeters(S, HOME_TX, ty, 40, iy);
      assert.truthy(sameAbsCell(S, m.x, m.y, m.x + 0.3 * cm, m.y - 0.3 * cm), 'two points in one cell');
      assert.falsy(sameAbsCell(S, m.x, m.y, m.x + 0.8 * cm, m.y), 'the next cell over is another');
      // The player standing on that cell centre is in that cell.
      const s = at(rowsScene(), m.x, m.y);
      const p = localMetersToTilePx(s, s.playerM.x, s.playerM.y);
      const pc = tilePxToTileCellF(s, p.x, p.y);
      assert.eq(`${pc.tx},${pc.ty},${Math.floor(pc.cx)},${Math.floor(pc.cy)}`, `${HOME_TX},${ty},40,${iy}`,
        'playerToWorldCell\'s arithmetic lands on the cell');
      const rc = playerReachCell(s);
      const a = tileCellToAbs(s, HOME_TX, ty, 40, iy);
      assert.eq(`${rc.cellIX},${rc.cellIY}`, `${a.cellIX},${a.cellIY}`, 'and so does the reach cell');
    }
  }
  const seamY = S.startWorldM.y + (DN * T - S.originPx.y) * S.mPerPx;
  const xM = S.startWorldM.x + (HOME_TX * T + 100 - S.originPx.x) * S.mPerPx;
  assert.falsy(sameAbsCell(S, xM, seamY - 0.01, xM, seamY + 0.01), 'the seam separates two cells');
});

test('tile rows: neighbours and reach across the seam are measured by POSITION', () => {
  // From the last row above the seam, the cell (dx, 1) is the lower row's cell
  // under the point dx cells across — never cellIX + dx on the other grid.
  const a = tileCellToAbs(S, HOME_TX, UP, 120, NUP - 1);
  const ca = absCellCenterPx(S, a.cellIX, a.cellIY);
  const cpsUp = T / NUP, cpsDn = T / NDN;
  for (let dx = -4; dx <= 4; dx++) {
    const b = absCellOffset(S, a.cellIX, a.cellIY, dx, 1);
    const t = absCellToTile(S, b.cellIX, b.cellIY);
    assert.eq(`${t.ty},${t.iy}`, `${DN},0`, 'one row down is the lower tile\'s first row');
    const cb = absCellCenterPx(S, b.cellIX, b.cellIY);
    assert.lte(Math.abs(cb.x - (ca.x + dx * cpsUp)), cpsDn / 2 + 1e-9,
      `dx ${dx}: the nearest cell to the point ${dx} cells across`);
    const d = absCellDelta(S, a.cellIX, a.cellIY, b.cellIX, b.cellIY);
    assert.eq(d.dy, 1, 'and the delta back says one row');
    assert.lte(Math.abs(d.dx - dx), 1, 'and about dx columns');
  }
  // The reach: standing on the upper row's last cell, the cell straight below
  // (across the seam) is one cell away, as it looks.
  const m = absCellCenterMeters(S, a.cellIX, a.cellIY);
  const s = at(rowsScene(), m.x, m.y);
  const below = absCellOffset(s, a.cellIX, a.cellIY, 0, 1);
  assert.truthy(cellInReach(s, below.cellIX, below.cellIY), 'the cell across the seam is in reach');
  const far = absCellOffset(s, a.cellIX, a.cellIY, 0, 6);
  assert.falsy(cellInReach(s, far.cellIX, far.cellIY), 'six rows down is not');
  // Raw cellIX arithmetic across the seam would be far off: the rows' column
  // shift is not zero here (the fixture is not on the reference column).
});

// The drawn window: slot (ox, oy) of a band on another grid draws cell
// baseCellIX + ox + band.dX at the slot's x + band.phaseX.
function windowCheck(s, label) {
  const pc = viewAnchorCell(s);
  const base = viewAnchorAbsCell(s, pc);
  const fracX = pc.cx - Math.floor(pc.cx), fracY = pc.cy - Math.floor(pc.cy);
  const nA = rowCells(s, pc.ty), cpsA = T / nA;
  const ax = pc.tx * T + pc.cx * cpsA, ay = pc.ty * T + pc.cy * cpsA;
  let sawOther = false;
  let prevRowCell = null;
  for (let oy = -6; oy <= 6; oy++) {
    const aY = base.cellIY + oy;
    const band = viewBand(s, pc, aY);
    let prev = null;
    for (let ox = -6; ox <= 6; ox++) {
      const aX = base.cellIX + ox + band.dX;
      const t = absCellToTile(s, aX, aY);
      if (t.n !== nA) sawOther = true;
      else assert.eq(band.dX + ':' + band.phaseX, '0:0', `${label}: a row on the anchor's grid is the plain slot grid`);
      const cps = T / t.n;
      // Where the slot draws it (unrounded) vs where the cell truly is, both
      // in anchor-row cells from the anchor.
      const drawnX = (ox - fracX) + band.phaseX / CELL_PX;
      const trueX = (t.tx * T + t.ix * cps - ax) / cpsA;
      const drawnY = (oy - fracY);
      const trueY = (t.ty * T + t.iy * cps - ay) / cpsA;
      assert.lt(Math.abs(drawnX - trueX), 0.05, `${label}: slot (${ox},${oy}) x within a hair of the cell`);
      assert.lt(Math.abs(drawnY - trueY), 0.05, `${label}: slot (${ox},${oy}) y within a hair of the cell`);
      if (prev) {
        // Consecutive slots are consecutive cells (no gap, no cell twice) and
        // are drawn exactly one CELL_PX apart (no overlap, no seam).
        const nextOf = prev.ix + 1 === prev.n ? `${prev.tx + 1},0` : `${prev.tx},${prev.ix + 1}`;
        assert.eq(`${t.tx},${t.ix}`, nextOf, `${label}: slot ${ox} follows slot ${ox - 1}`);
        const x1 = cellScreenXY(s, ox, oy, fracX, fracY, band.phaseX).x;
        const x0 = cellScreenXY(s, ox - 1, oy, fracX, fracY, band.phaseX).x;
        assert.eq(x1 - x0, CELL_PX, `${label}: drawn edge to edge`);
      }
      prev = t;
    }
    // Consecutive rows are consecutive tile rows / cell rows — across the seam too.
    const rowCell = absCellToTile(s, base.cellIX + band.dX, aY);
    if (prevRowCell) {
      const want = prevRowCell.iy + 1 === prevRowCell.n ? `${prevRowCell.ty + 1},0` : `${prevRowCell.ty},${prevRowCell.iy + 1}`;
      assert.eq(`${rowCell.ty},${rowCell.iy}`, want, `${label}: row ${oy} follows row ${oy - 1}`);
    }
    prevRowCell = rowCell;
  }
  assert.truthy(sawOther, `${label}: the window really crosses onto the other grid`);
}

test('tile rows: the drawn window tiles seamlessly across the seam (anchor BELOW it)', () => {
  const m = tileCellCenterMeters(S, HOME_TX + 2, DN, 57, 2);
  windowCheck(at(rowsScene(), m.x + 1.3, m.y + 2.1), 'below');
});

test('tile rows: …and with the anchor ABOVE it, far from the reference column', () => {
  const m = tileCellCenterMeters(S, HOME_TX + 9, UP, 200, NUP - 3);
  windowCheck(at(rowsScene(), m.x - 2.2, m.y + 0.7), 'above');
});

test('tile rows: a uniform view is the plain slot grid, with no band key', () => {
  const m = tileCellCenterMeters(S, HOME_TX, DN, 100, 100);
  const s = at(rowsScene(), m.x, m.y);
  const pc = viewAnchorCell(s);
  const base = viewAnchorAbsCell(s, pc);
  assert.eq(viewBandKey(s, pc, base.cellIY, (VIEW_CELLS - 1) / 2), '', 'nothing off-grid in view');
  const near = at(rowsScene(), ...(() => { const q = tileCellCenterMeters(S, HOME_TX, DN, 100, 1); return [q.x, q.y]; })());
  const pn = viewAnchorCell(near);
  assert.truthy(viewBandKey(near, pn, viewAnchorAbsCell(near, pn).cellIY, (VIEW_CELLS - 1) / 2) !== '',
    'a view across the seam carries a band key (the cached overlays rebuild on it)');
});

test('tile rows: fog masks are sized by each tile\'s own row, and survive a flush', () => {
  const s = rowsScene();
  const geom = {
    rowCells: (ty) => rowCells(s, ty),
    absToTile: (ax, ay) => absCellToTile(s, ax, ay),
    offset: (ax, ay, dx, dy) => absCellOffset(s, ax, ay, dx, dy),
  };
  const save = {};
  Fog.init(save, s.cellsPerTile, geom);
  const a = tileCellToAbs(s, HOME_TX, UP, 60, NUP - 1);
  assert.truthy(Fog.revealDisc(a.cellIX, a.cellIY, 2), 'a disc across the seam reveals');
  const mUp = Fog.maskFor(HOME_TX, UP), mDn = Fog.maskFor(HOME_TX, DN);
  assert.eq(mUp.length, Math.ceil(NUP * NUP / 8), 'the upper mask is its row\'s size');
  assert.eq(mDn.length, Math.ceil(NDN * NDN / 8), 'the lower mask is its row\'s size');
  assert.truthy(Fog.seen(HOME_TX, UP, 60, NUP - 1), 'the centre is seen');
  assert.truthy(Fog.seen(HOME_TX, DN, absCellToTile(s, absCellOffset(s, a.cellIX, a.cellIY, 0, 2).cellIX,
    a.cellIY + 2).ix, 1), 'two rows down, across the seam, is seen');
  Fog.flush(save);
  const off = [UP, DN].filter((t) => rowCells(s, t) !== s.cellsPerTile);
  for (const t of off) {
    assert.eq(save.fog.n && save.fog.n[`${HOME_TX}/${t}`], rowCells(s, t), 'a row off the reference grid records its width');
  }
  // Reload: the masks come back, at their own widths.
  Fog.init(save, s.cellsPerTile, geom);
  assert.truthy(Fog.seen(HOME_TX, UP, 60, NUP - 1), 'upper survives the round trip');
  assert.eq(Fog.maskFor(HOME_TX, DN).length, Math.ceil(NDN * NDN / 8), 'lower too');
  // A mask written at a width its row no longer has is dropped, not mis-indexed.
  const k = `${HOME_TX}/${UP}`;
  const bad = { fog: { w: save.fog.w, tiles: { [k]: save.fog.tiles[k] }, n: { [k]: NUP + 1 } } };
  Fog.init(bad, s.cellsPerTile, geom);
  assert.eq(Fog.maskFor(HOME_TX, UP), null, 'wrong width → dropped');
  Fog.init({}, s.cellsPerTile, geom);
});

// ── A player's own stairs never move the cave population (task: synthetic
// stairs). spawnCaveCreatures anchors on — and refuses seats around — the
// level's GENERATED objects only; a `_synthetic` up-stair (Home's, the
// starter ladder's) only culls what lands on its own cell.
test('tile rows: cave spawns ignore a player\'s _synthetic stairs', () => {
  const BODY = SPAWN_CAVE_SRC.replace(/\n\s*\}\s*$/, '');
  const N = 120, edge = N * 5;
  const mk = () => {
    const grid = new Array(N * N).fill(24);
    const gen = [{ kind: 'staircase', dir: 'up', x: 30 * 5 + 2.5, y: 30 * 5 + 2.5, id: 'gen_up' }];
    return { cellsPerEdge: N, tileEdgeM: edge, grid, baseGrid: grid.slice(), objects: gen.slice(), genObjects: gen };
  };
  const run = (entry) => {
    new Function('entry', 'tx', 'ty', 'depth', BODY)
      .call({ tileEdgeM: edge, save: { caught: [] } }, entry, 3, 4, 2);
    return entry;
  };
  const plain = run(mk());
  const own = mk();
  // The player's own up-stair (Home / ladder), 80 cells away from the
  // generated one, on a cell the live grid also re-floored.
  const synth = { kind: 'staircase', dir: 'up', x: 90 * 5 + 2.5, y: 80 * 5 + 2.5, id: 'homeup_2_3_4_90_80', _synthetic: true };
  own.objects.push(synth);
  run(own);
  const onSynth = (c) => Math.floor(c.x / 5) === 90 && Math.floor(c.y / 5) === 80;
  const ids = (e) => e.creatures.filter((c) => !onSynth(c)).map((c) => `${c.id}@${c.x},${c.y}`).join('|');
  assert.eq(ids(own), ids(plain), 'the same monsters and rabbits, in the same places');
  assert.falsy(own.creatures.some(onSynth), 'and none stands on the player\'s stair');
  const coins = (e) => (e.coinDrops || []).filter((c) => !onSynth(c)).map((c) => c.id + '@' + c.x + ',' + c.y).join('|');
  assert.eq(coins(own), coins(plain), 'the same coins');
  const traps = (e) => (e.traps || []).filter((t) => !onSynth(t)).map((t) => t.id).join('|');
  assert.eq(traps(own), traps(plain), 'the same traps');
  // Without a genObjects snapshot the pass still drops `_synthetic` anchors.
  const legacy = mk(); delete legacy.genObjects; legacy.objects.push(synth);
  run(legacy);
  assert.eq(ids(legacy), ids(plain), 'a synthetic stair is never an anchor, snapshot or not');
});

// ── The pest amnesty takes no extra draws (task: shared stream). A pest drawn
// into the zone is DROPPED after its attempt, so the draws that follow are
// the ones every other player's world makes.
test('tile rows: the pest-free zone leaves the tile\'s later draws unchanged', () => {
  const N = 16;
  const entry = { grid: new Array(N * N).fill(0) };
  const drawsWith = (pestFree) => {
    let n = 0;
    const seq = [0.1, 0.1, 0.9, 0.9, 0.5, 0.5, 0.3, 0.7];
    const rng = () => seq[(n++) % seq.length];
    const creatures = [];
    const factory = new Function(
      'rng', 'N', 'pestFree', 'entry', '_spawnOpts', 'tx', 'ty', 'caughtSet', 'creatures',
      'cellM', 'genGrid',
      'return (kindWant, classesOK, idx, kindStr) => {\n' + TRY_PLACE_SRC + '\n};');
    const tryPlace = factory.call({ tileEdgeM: N * 7 }, rng, N, pestFree, entry, {}, 0, 0,
      new Set(), creatures, 7, entry.grid);
    tryPlace('slime', new Set([0]), 0, 'slime');
    const after = n;
    tryPlace('slime', new Set([0]), 1, 'slime');
    return { first: after, total: n, creatures };
  };
  const zone = { has: (ix, iy) => ix === 1 && iy === 1 };   // the first draw's cell
  const free = drawsWith(null), graced = drawsWith(zone);
  assert.eq(graced.first, free.first, 'the pest in the zone took exactly the draws it takes anywhere');
  assert.eq(graced.total, free.total, 'and every later draw is the one everyone else makes');
  assert.eq(free.creatures.length, 2, 'without the zone both slimes stand');
  assert.eq(graced.creatures.length, 1, 'with it, the one in the zone is simply not there');
});
})();
