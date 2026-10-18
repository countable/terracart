// Headless tests for src/coords.js
//
// Regression guard for:
//   11190b4 — house edge taps "just out of reach"
//   538c4ab — reach honours the lit cell, not just the foot cell
//   1818543 — reach shrinks with depth
//   f98eb04 — low energy shrinks reach
//
// All globals (cellKeyFromAbsCell, cellPxSize, worldMetersToAbsCell,
// absCellCenterMeters, playerReachCell, reachCells, reachRadiusM,
// cellInReach, WorldGen) are injected by run.js.

// ── Bridge: VIEW_CELLS is defined in app.js which is not in the headless bundle.
// We stub it here with its known constant value (11) so reachRadiusM's Potion
// of Reach branch can execute. If the value ever changes in app.js the potion
// test below will catch the drift.
if (typeof VIEW_CELLS === 'undefined') globalThis.VIEW_CELLS = 11;

// ── Scene fixture ─────────────────────────────────────────────────────────────
// We use simple round numbers so assertions can be computed by hand.
// WorldGen.TILE_PX = 256 (always, it's the MVT standard).
// We pick cellsPerTile = 51 to match a typical mid-latitude value,
// but for arithmetic simplicity we also test with cellsPerTile = 1.
//
// The key scene shape (learned from src/coords.js + src/app.js):
//   scene.startWorldM   — world origin in metres
//   scene.mPerPx        — metres per pixel
//   scene.originPx      — pixel origin {x, y}
//   scene.cellsPerTile  — cells per tile edge
//   scene.cellM         — metres per cell (WorldGen.CELL_M = 5)
//   scene.playerM       — {x, y} player offset from startWorldM
//   scene.feetOffsetM   — feet-offset in metres (≈ 2.2 m)
//   scene.depth         — underground depth (0 = surface)
//   scene.save          — { energy, reachUpgrades, reachPotionUntil }

function makeCoordScene(over) {
  // mPerPx: at z=14 near equator, ~9.55 m/px; pick 10 for clean maths.
  // originPx: put the world pixel origin at (1000, 2000).
  // startWorldM = originPx * mPerPx = (10000, 20000).
  // cellsPerTile = 51 (worldgen default near many cities),
  //   → cellPxSize = 256/51 ≈ 5.02 px, cellM ≈ 50.2 m per cell (we
  //     decouple cellPxSize from cellM: they represent different unit spaces).
  // For arithmetic tests we override to cellsPerTile = 1 so cellPxSize = 256 px.
  const base = {
    startWorldM: { x: 10000, y: 20000 },
    mPerPx: 10,
    originPx: { x: 1000, y: 2000 },
    cellsPerTile: 51,
    cellM: 5,               // WorldGen.CELL_M
    playerM: { x: 0, y: 0 },
    feetOffsetM: 2.2,       // (14/CELL_PX)*cellM ≈ 2.2 m
    depth: 0,
    save: { energy: 100, reachUpgrades: 0 },
  };
  return Object.assign({}, base, over);
}

// ── cellKeyFromAbsCell ────────────────────────────────────────────────────────

test('cellKeyFromAbsCell: formats as "ix_iy"', () => {
  assert.eq(cellKeyFromAbsCell(0, 0), '0_0');
  assert.eq(cellKeyFromAbsCell(3, 7), '3_7');
  assert.eq(cellKeyFromAbsCell(-1, -2), '-1_-2');
  assert.eq(cellKeyFromAbsCell(100, 200), '100_200');
});

test('cellKeyFromAbsCell: large coordinates stringify correctly', () => {
  assert.eq(cellKeyFromAbsCell(99999, 12345), '99999_12345');
});

// ── cellPxSize ────────────────────────────────────────────────────────────────

test('cellPxSize: returns TILE_PX / cellsPerTile', () => {
  // WorldGen.TILE_PX = 256 (constant)
  const s = makeCoordScene({ cellsPerTile: 51 });
  const expected = WorldGen.TILE_PX / 51;
  assert.eq(cellPxSize(s), expected);
});

test('cellPxSize: with cellsPerTile=1 the cell is one full tile wide (256 px)', () => {
  const s = makeCoordScene({ cellsPerTile: 1 });
  assert.eq(cellPxSize(s), 256);
});

test('cellPxSize: with cellsPerTile=256 the cell is exactly 1 px', () => {
  const s = makeCoordScene({ cellsPerTile: 256 });
  assert.eq(cellPxSize(s), 1);
});

// ── worldMetersToAbsCell ↔ absCellCenterMeters round-trips ───────────────────

// Helper: given a world-metre point, map it to a cell and back to that cell's
// centre, then verify the same cell comes back.
function roundTripCell(scene, wmx, wmy) {
  const { cellIX, cellIY } = worldMetersToAbsCell(scene, wmx, wmy);
  const centre = absCellCenterMeters(scene, cellIX, cellIY);
  const back = worldMetersToAbsCell(scene, centre.x, centre.y);
  return { cellIX, cellIY, centre, back };
}

test('round-trip: cell centre maps back to the same cell (origin)', () => {
  const s = makeCoordScene({ cellsPerTile: 1 });
  const { cellIX, cellIY, back } = roundTripCell(s, 10000, 20000);
  assert.eq(back.cellIX, cellIX, 'X round-trip');
  assert.eq(back.cellIY, cellIY, 'Y round-trip');
});

test('round-trip: arbitrary interior point maps to a cell whose centre maps back to same cell', () => {
  const s = makeCoordScene({ cellsPerTile: 51 });
  // Pick a point that is not on the grid origin.
  const { back, cellIX, cellIY } = roundTripCell(s, 10137, 20842);
  assert.eq(back.cellIX, cellIX, 'X round-trip');
  assert.eq(back.cellIY, cellIY, 'Y round-trip');
});

test('round-trip: multiple arbitrary points, all round-trip consistently', () => {
  const s = makeCoordScene({ cellsPerTile: 51 });
  const points = [
    [10000, 20000], [10500, 20500], [12345, 23456],
    [9999, 19999],  [10001, 20001],
  ];
  for (const [wmx, wmy] of points) {
    const { back, cellIX, cellIY } = roundTripCell(s, wmx, wmy);
    assert.eq(back.cellIX, cellIX, `X round-trip at (${wmx},${wmy})`);
    assert.eq(back.cellIY, cellIY, `Y round-trip at (${wmx},${wmy})`);
  }
});

test('worldMetersToAbsCell: uses floor so points left of centre map to the same cell', () => {
  // With cellsPerTile=1, cellPxSize=256, mPerPx=10 → cell is 2560 m wide.
  // startWorldM=(10000,20000), originPx=(1000,2000).
  // A point at wmx=10000 → wx = 1000 + (10000-10000)/10 = 1000 px
  // cellIX = floor(1000/256) = 3.
  // A point slightly left: wmx=9999 → wx=999.9 px → cellIX=floor(999.9/256)=3 (same).
  // A point at wmx=9000 → wx=900 → cellIX=floor(900/256)=3 (still 3 because 768..1023 → 3).
  const s = makeCoordScene({ cellsPerTile: 1 });
  const at10000 = worldMetersToAbsCell(s, 10000, 20000);
  const at10001 = worldMetersToAbsCell(s, 10001, 20000);
  // Both are in the same cell (cell 3 along X).
  assert.eq(at10000.cellIX, at10001.cellIX, 'adjacent metres land in same cell');
});

test('worldMetersToAbsCell: next tile boundary jumps cellIX by cellsPerTile', () => {
  // With cellsPerTile=51 and mPerPx=10:
  // cellPxSize = 256/51 px per cell
  // tileWidth in metres = 256 * mPerPx = 2560 m
  // Stepping one full tile width east should increment by 51 cells.
  const s = makeCoordScene({ cellsPerTile: 51 });
  const tileWidthM = WorldGen.TILE_PX * s.mPerPx;  // 2560 m
  const a = worldMetersToAbsCell(s, s.startWorldM.x, s.startWorldM.y);
  const b = worldMetersToAbsCell(s, s.startWorldM.x + tileWidthM, s.startWorldM.y);
  assert.eq(b.cellIX - a.cellIX, 51, 'one tile east = +51 cells');
  assert.eq(b.cellIY, a.cellIY,      'Y unchanged');
});

test('absCellCenterMeters: centre of adjacent cells are exactly cellPxSize*mPerPx apart', () => {
  const s = makeCoordScene({ cellsPerTile: 51 });
  const cps = cellPxSize(s);
  const expectedSpacingM = cps * s.mPerPx;
  const c0 = absCellCenterMeters(s, 10, 10);
  const c1 = absCellCenterMeters(s, 11, 10);
  const diff = c1.x - c0.x;
  // Allow floating-point tolerance.
  assert.inRange(diff, expectedSpacingM - 1e-9, expectedSpacingM + 1e-9, 'cell spacing in X');
});

// ── playerReachCell ───────────────────────────────────────────────────────────

test('playerReachCell: at origin (playerM={0,0}) feet land in a deterministic cell', () => {
  const s = makeCoordScene({ cellsPerTile: 51 });
  const rc = playerReachCell(s);
  // wx = originPx.x + 0/mPerPx = 1000
  // wy = originPx.y + feetOffsetM/mPerPx = 2000 + 2.2/10 = 2000.22
  const cps = cellPxSize(s);
  const expectedIX = Math.floor(1000 / cps);
  const expectedIY = Math.floor(2000.22 / cps);
  assert.eq(rc.cellIX, expectedIX, 'IX at origin');
  assert.eq(rc.cellIY, expectedIY, 'IY at origin');
});

test('playerReachCell: feetOffsetM shifts cellIY south from body cell', () => {
  // Put the player right at a cell boundary in Y so feet push into next cell.
  // With cellsPerTile=1, cps=256, mPerPx=10:
  // Body wx=1000, wy=2000 → cellIY=floor(2000/256)=7.
  // Feet wy=2000.22 → still 7 (0.22 << 256). Good — feet in same cell by default.
  // Now put player so body is at wy = 2048 (a cell boundary exactly):
  // playerM.y must give wy=2048 px → playerM.y = (2048-2000)*10 = 480 m.
  // Feet at wy=2048.22 → cellIY=floor(2048.22/256)=8. Body at 7, feet at 8.
  const s = makeCoordScene({ cellsPerTile: 1, feetOffsetM: 2.2 });
  // wy for body = originPx.y + playerM.y/mPerPx = 2000 + playerM.y/10
  // We want body to sit on boundary between cell 7 and 8: wy_body = 8*256=2048
  // playerM.y = (2048 - 2000)*10 = 480
  s.playerM = { x: 0, y: 480 };
  const rc = playerReachCell(s);
  // feet: wy = 2000 + (480 + 2.2)/10 = 2000 + 48.22 = 2048.22 → cell 8
  assert.eq(rc.cellIY, 8, 'feet in cell below when on boundary');
});

test('playerReachCell: moving player east by one full cell width shifts cellIX by 1', () => {
  const s = makeCoordScene({ cellsPerTile: 51 });
  const cps = cellPxSize(s);            // px per cell
  const cellWidthM = cps * s.mPerPx;   // metres per cell
  const base = playerReachCell(s);
  s.playerM = { x: cellWidthM, y: 0 };
  const moved = playerReachCell(s);
  assert.eq(moved.cellIX - base.cellIX, 1, 'one cell east shifts IX by 1');
  // IY should be the same (only X moved).
  assert.eq(moved.cellIY, base.cellIY, 'IY unchanged');
});

// ── reachCells ────────────────────────────────────────────────────────────────

test('reachCells: each upgrade unlocks only the next group of overlapping cells', () => {
  for (const depth of [0, 1, 2, 6, 20]) for (const cellM of [3, 5, 7]) {
    const s = reachScene({ depth, cellM, cellsPerTile: WorldGen.TILE_PX / cellM,
      playerM: { x: cellM / 2, y: cellM / 2 } });
    for (let upgrade = 1; upgrade <= 6; upgrade++) {
      s.save.reachUpgrades = upgrade - 1;
      const before = reachRadiusM(s) / cellM;
      s.save.reachUpgrades = upgrade;
      const after = reachRadiusM(s) / cellM;
      const added = [];
      for (let x = -9; x <= 9; x++) for (let y = -9; y <= 9; y++) {
        const distance = Math.hypot(Math.max(0, Math.abs(x) - .5), Math.max(0, Math.abs(y) - .5));
        if (distance >= before && distance < after) added.push(distance);
      }
      assert.gt(added.length, 0, 'every upgrade unlocks cells even at depth');
      assert.lt(Math.max(...added) - Math.min(...added), 1e-10, 'only one distance group unlocks');
      assert.lt(after - added[0], 1e-5, 'radius barely crosses the next threshold');
    }
    s.save.reachUpgrades = 6;
    const capped = reachCells(s);
    s.save.reachUpgrades = 7;
    assert.eq(reachCells(s), capped, 'six-upgrade cap');
  }
});

// ── reachRadiusM ─────────────────────────────────────────────────────────────

test('reachRadiusM: normal surface preserves the old reachable footprint', () => {
  const s = reachScene({ save: { energy: 100, reachUpgrades: 0 }, depth: 0 });
  // Radius stops before touching the old out-of-reach diagonal (2,2).
  assert.eq(reachRadiusM(s), (Math.hypot(1.5, 1.5) - 1e-6) * 5);
});

test('reachRadiusM: zero energy returns 0 (cannot reach at all)', () => {
  const s = reachScene({ save: { energy: 0, reachUpgrades: 0 }, depth: 0 });
  assert.eq(reachRadiusM(s), 0);
});

test('reachRadiusM: negative energy returns 0', () => {
  const s = reachScene({ save: { energy: -5, reachUpgrades: 0 }, depth: 0 });
  assert.eq(reachRadiusM(s), 0);
});

test('reachRadiusM: missing save.energy defaults to 0 → radius 0', () => {
  // energy ?? 0 → 0 → radius 0
  const s = reachScene({ save: { reachUpgrades: 0 }, depth: 0 });
  assert.eq(reachRadiusM(s), 0, 'missing energy treated as 0');
});

test('reachRadiusM: low energy (>0) does NOT shrink reach (only 0 shrinks)', () => {
  // PATCH-HISTORY/BUG: The comment in coords.js explicitly states "It does NOT
  // shrink when merely tired" — only exactly 0 energy blocks reach entirely.
  // f98eb04 introduced the 0-energy gate; tired state (> 0 but low) is handled
  // by the UI but does NOT affect the reach radius.
  const s = reachScene({ save: { energy: 1, reachUpgrades: 0 }, depth: 0 });
  assert.eq(reachRadiusM(s), (Math.hypot(1.5, 1.5) - 1e-6) * 5, '1 energy → full radius, no tired shrink');
});

test('reachRadiusM: upgrades increase radius', () => {
  for (let u = 0; u <= 6; u++) {
    const s = reachScene({ save: { energy: 100, reachUpgrades: u }, depth: 0 });
    const expected = reachCells(s) * s.cellM + 1;
    assert.eq(reachRadiusM(s), expected, `upgrades=${u}`);
  }
});

test('reachRadiusM: depth shrinks radius', () => {
  // Depth 1 preserves the original 13-cell footprint.
  const s = reachScene({ save: { energy: 100, reachUpgrades: 0 }, depth: 1 });
  assert.lt(Math.abs(reachRadiusM(s) - (Math.hypot(1.5, .5) - 1e-6) * 5), 1e-12);
});

test('reachRadiusM: depth=3 preserves the original nine-cell footprint', () => {
  const s = reachScene({ save: { energy: 100, reachUpgrades: 0 }, depth: 3 });
  assert.eq(reachRadiusM(s), (1.5 - 1e-6) * 5);
});

test('reachRadiusM: Potion of Reach (active) overrides everything → VIEW_CELLS * cellM', () => {
  // VIEW_CELLS = 11 (app.js); cellM = 5 → radius = 55 m.
  // The potion overrides even zero energy.
  const future = Date.now() + 60 * 1000;
  const s = reachScene({
    save: { energy: 0, reachUpgrades: 0, reachPotionUntil: future },
    depth: 5,
  });
  // VIEW_CELLS is stubbed to 11 at the top of this file (app.js is not in the bundle).
  // Formula: VIEW_CELLS * scene.cellM = 11 * 5 = 55 m.
  const radius = reachRadiusM(s);
  assert.eq(radius, 55, 'potion radius = VIEW_CELLS * cellM = 11 * 5 = 55 m');
});

test('reachRadiusM: expired Potion of Reach (past) does NOT override — normal reach applies', () => {
  const past = Date.now() - 1000;
  const s = reachScene({
    save: { energy: 100, reachUpgrades: 0, reachPotionUntil: past },
    depth: 0,
  });
  assert.eq(reachRadiusM(s), (Math.hypot(1.5, 1.5) - 1e-6) * 5, 'expired potion → normal radius');
});

// ── cellInReach — core correctness ───────────────────────────────────────────

// We use a simple scene where the player stands at the reach-cell origin and
// we can compute exact distances in cell units.
function reachScene(over) {
  return Object.assign({
    startWorldM: { x: 0, y: 0 }, originPx: { x: 0, y: 0 },
    mPerPx: 1, cellsPerTile: WorldGen.TILE_PX / 5, cellM: 5,
    playerM: { x: 2.5, y: 2.5 }, feetOffsetM: 0, depth: 0,
    save: { energy: 100, reachUpgrades: 0 },
  }, over);
}

test('cellInReach: origin cell (0,0) is always reachable', () => {
  const s = reachScene();
  assert.truthy(cellInReach(s, 0, 0), 'origin cell always in reach');
});

test('cellInReach: zero energy → nothing reachable', () => {
  const s = reachScene({ save: { energy: 0, reachUpgrades: 0 } });
  assert.falsy(cellInReach(s, 0, 0), 'origin not reachable at zero energy');
  assert.falsy(cellInReach(s, 1, 0), 'adjacent cell not reachable at zero energy');
});

test('cellInReach: cardinal cell 1 away is reachable (base reach 2.5 cells)', () => {
  // The first cardinal neighbour remains inside the calibrated circle.
  const s = reachScene();
  assert.truthy(cellInReach(s, 1, 0), 'E neighbour reachable');
  assert.truthy(cellInReach(s, -1, 0), 'W neighbour reachable');
  assert.truthy(cellInReach(s, 0, 1), 'S neighbour reachable');
  assert.truthy(cellInReach(s, 0, -1), 'N neighbour reachable');
});

test('cellInReach: cardinal cell 2 away is reachable (base reach 2.5 cells)', () => {
  // The second cardinal neighbour remains partially covered.
  const s = reachScene();
  assert.truthy(cellInReach(s, 2, 0), '2 cells E reachable');
  assert.truthy(cellInReach(s, 0, 2), '2 cells S reachable');
});

test('cellInReach: partially lit cells are reachable; unlit cells are not', () => {
  const s = reachScene();
  for (const [x, y] of [[2, 0], [-2, 0], [0, 2], [2, 1]]) {
    assert.truthy(cellInReach(s, x, y), 'edge or corner overlaps the circle');
  }
  for (const [x, y] of [[3, 0], [2, 2], [3, 3]]) {
    assert.falsy(cellInReach(s, x, y), 'entire cell outside circle');
  }
  s.depth = 2;
  assert.truthy(cellInReach(s, 1, 1), 'partially lit cell reachable underground');
  assert.falsy(cellInReach(s, 2, 2), 'unlit diagonal unreachable underground');
});

test('cellInReach: Potion of Reach makes distant cells reachable', () => {
  // Potion radius >> 50 m; cell (8,0): dist=40 m.
  const future = Date.now() + 60_000;
  const s = reachScene({
    save: { energy: 100, reachUpgrades: 0, reachPotionUntil: future },
  });
  assert.truthy(cellInReach(s, 8, 0), 'potion lets player reach 8 cells away');
});

test('cellInReach: playerReachCell shifts correctly when player moves', () => {
  // Move player to cell (3,0) and check that cells relative to new position
  // are reachable, not relative to origin.
  const s = reachScene();
  const cps = cellPxSize(s);
  const cellWidthM = cps * s.mPerPx;  // metres per cell ≈ 5.02 m
  // Move 3 cells east.
  s.playerM = { x: 3 * cellWidthM, y: 0 };
  const prc = playerReachCell(s);
  // Cell 1 east of player's new reach origin should be reachable.
  assert.truthy(cellInReach(s, prc.cellIX + 1, prc.cellIY), '+1 E from moved player reachable');
  // Cell 3 east of player's origin should NOT be reachable.
  assert.falsy(cellInReach(s, prc.cellIX + 4, prc.cellIY), '+4 E from moved player NOT reachable');
});

// ── reachCells / reachRadiusM consistency ─────────────────────────────────────

test('reachCells and reachRadiusM are consistent: radius = cells*cellM + 1', () => {
  const cases = [
    { reachUpgrades: 0, depth: 0, energy: 100 },
    { reachUpgrades: 3, depth: 0, energy: 100 },
    { reachUpgrades: 6, depth: 0, energy: 100 },
    { reachUpgrades: 0, depth: 1, energy: 100 },
    { reachUpgrades: 0, depth: 2, energy: 100 },
  ];
  for (const c of cases) {
    const s = makeCoordScene({
      save: { energy: c.energy, reachUpgrades: c.reachUpgrades },
      depth: c.depth,
    });
    const cells = reachCells(s);
    const radius = reachRadiusM(s);
    const expectedRadius = cells * s.cellM + 1;
    assert.eq(radius, expectedRadius, `cells=${cells}, depth=${c.depth}, upg=${c.reachUpgrades}`);
  }
});

// ── GPS ⇄ local metres (lonLatToLocalM / localMToLonLat) ─────────────────────
// The map is Web-Mercator; a GPS fix has to be projected the same way or the
// player stands somewhere they aren't. These pin that the conversion IS the
// map's own projection, and that it stays exact far from the origin — the flat
// metres-per-degree version it replaced drifted with latitude, which is how a
// save still anchored at the default home reported its player kilometres from
// where they stood (both on their own map and on the multiplayer wire).
function mercScene(lon, lat) {
  const originPx = WorldGen.lonLatToWorldPx(lon, lat, WorldGen.Z);
  const mPerPx = WorldGen.metersPerPixel(lat, WorldGen.Z);
  return {
    originPx, mPerPx,
    cellsPerTile: WorldGen.cellsPerEdgeForLat(lat), cellM: WorldGen.CELL_M,
    startWorldM: { x: originPx.x * mPerPx, y: originPx.y * mPerPx },
    playerM: { x: 0, y: 0 },
  };
}

test('lonLatToLocalM puts the origin fix at (0,0) and round-trips', () => {
  const sc = mercScene(-119.4787, 49.85438);
  const at0 = lonLatToLocalM(sc, -119.4787, 49.85438);
  assert.inRange(at0.x, -1e-6, 1e-6);
  assert.inRange(at0.y, -1e-6, 1e-6);
  for (const [lon, lat] of [[-119.4787, 49.85438], [-119.47, 49.86], [-122.15, 37.4222], [11.61, 48.152]]) {
    const m = lonLatToLocalM(sc, lon, lat);
    const ll = localMToLonLat(sc, m.x, m.y);
    assert.inRange(ll.lon - lon, -1e-9, 1e-9);
    assert.inRange(ll.lat - lat, -1e-9, 1e-9);
  }
});

test('a fix lands on the map cell the map itself draws it in, near and far', () => {
  const sc = mercScene(-119.4787, 49.85438);
  // Whatever the distance, absolute metres = z=14 world px × mPerPx — the same
  // frame every object, tile and cell in the save lives in.
  for (const [lon, lat] of [[-119.4780, 49.8550], [-119.20, 50.30], [-113.49, 53.55]]) {
    const m = lonLatToLocalM(sc, lon, lat);
    const px = WorldGen.lonLatToWorldPx(lon, lat, WorldGen.Z);
    assert.inRange((sc.startWorldM.x + m.x) / sc.mPerPx - px.x, -1e-6, 1e-6);
    assert.inRange((sc.startWorldM.y + m.y) / sc.mPerPx - px.y, -1e-6, 1e-6);
  }
});

test('north/south is where the flat approximation drifts — metres, then kilometres', () => {
  const sc = mercScene(-119.4787, 49.85438);
  const MPD = 111320;                       // the old flat metres-per-degree
  const flat = (lon, lat) => ({
    x: (lon - -119.4787) * MPD * Math.cos(49.85438 * Math.PI / 180),
    y: -(lat - 49.85438) * MPD,
  });
  // Same longitude line: x agrees exactly, so the whole error is north/south.
  const near = lonLatToLocalM(sc, -119.4787, 49.90);      // ~5 km north
  assert.inRange(Math.abs(near.y - flat(-119.4787, 49.90).y), 1, 12);
  // Edmonton — a save marooned at the default origin while its player is a
  // province away. The old projection put them kilometres off the map: far
  // enough that nobody standing beside them saw them, and their own farm sat
  // in the wrong neighbourhood.
  const far = lonLatToLocalM(sc, -113.4938, 53.5461);
  assert.gt(Math.abs(far.y - flat(-113.4938, 53.5461).y), 10000);
});

test('two saves anchored at different latitudes agree on where a peer is', () => {
  // The multiplayer wire is this same metre frame ÷ mPerPx (multiplayer.js
  // toWorldPx). Exactness is what lets a player whose save is anchored
  // somewhere else entirely still show up standing next to you.
  const mine = mercScene(-119.4787, 49.85438);
  const theirs = mercScene(-113.4938, 53.5461);     // home capture landed elsewhere
  const spot = { lon: -119.4790, lat: 49.85460 };   // where we're both standing
  const theirM = lonLatToLocalM(theirs, spot.lon, spot.lat);
  const wirePx = {
    x: (theirs.startWorldM.x + theirM.x) / theirs.mPerPx,
    y: (theirs.startWorldM.y + theirM.y) / theirs.mPerPx,
  };
  // Their px, read back in MY save's metre frame (Multiplayer.fromWorldPx).
  const wm = { x: wirePx.x * mine.mPerPx, y: wirePx.y * mine.mPerPx };
  const mineM = lonLatToLocalM(mine, spot.lon, spot.lat);
  assert.inRange(wm.x - (mine.startWorldM.x + mineM.x), -1e-6, 1e-6);
  assert.inRange(wm.y - (mine.startWorldM.y + mineM.y), -1e-6, 1e-6);
});

test('cellInReach: moving within a cell moves the circle without waiting for a crossing', () => {
  const s = reachScene();
  s.playerM.x = 1;
  assert.falsy(cellInReach(s, 2, 2), 'southeast cell starts outside');
  assert.truthy(cellInReach(s, -2, 2), 'southwest cell starts inside');
  s.playerM.x = 4;
  assert.truthy(cellInReach(s, 2, 2), 'southeast cell enters before the player crosses a cell');
  assert.falsy(cellInReach(s, -2, 2), 'southwest cell leaves before the crossing');
  s.peekM = { x: 500, y: -500 };
  assert.truthy(cellInReach(s, 2, 2), 'camera peeks cannot move interaction reach');
});

test('starting circle: matches the old reachable cells at every base depth', () => {
  for (const cellM of [3, 5, 7, 8]) for (const depth of [0, 1, 2, 6]) for (const blinded of [false, true]) {
    const s = reachScene({ cellM, depth, cellsPerTile: WorldGen.TILE_PX / cellM,
      playerM: { x: cellM / 2, y: cellM / 2 } });
    const base = Math.max(1.5, 2.5 - depth * .5);
    if (blinded) Conditions.apply(s.save, 'blinded');
    const oldRadius = (blinded ? Math.max(1, base * .5) : base) * cellM + 1;
    let count = 0;
    for (let x = -6; x <= 6; x++) for (let y = -6; y <= 6; y++) {
      const expected = Math.hypot(x, y) * cellM <= oldRadius;
      assert.eq(cellInReach(s, x, y), expected, `old footprint at ${x},${y}, depth ${depth}, cellM ${cellM}`);
      if (expected) count++;
    }
    if (depth === 0 && cellM === 7 && !blinded) assert.eq(count, 21, 'original surface footprint');
  }
});

test('reach upgrades: projected cells and row seams unlock one actual distance group per rung', () => {
  for (const iy of [100, 224, 225]) for (const depth of [0, 2, 6]) for (const blinded of [false, true]) {
    const s = reachScene({ cellM: 7, cellsPerTile: 225, mPerPx: 7.008915070782029 * 225 / WorldGen.TILE_PX,
      cellsForRow: row => row <= 0 ? 225 : 224, depth });
    const p = absCellCenterMeters(s, 100, iy);
    s.playerM = { ...p };
    if (blinded) Conditions.apply(s.save, 'blinded');
    const cells = [];
    for (let y = -8; y <= 8; y++) {
      const c = absCellOffset(s, 100, iy, 0, y);
      for (let x = -8; x <= 8; x++) cells.push({ cellIX: c.cellIX + x, cellIY: c.cellIY });
    }
    const reachable = () => new Set(cells.filter(c => cellInReach(s, c.cellIX, c.cellIY)).map(c => `${c.cellIX},${c.cellIY}`));
    let before = reachable();
    for (let rung = 1; rung <= 6; rung++) {
      s.save.reachUpgrades = rung;
      const after = reachable();
      for (const key of before) assert.truthy(after.has(key), 'upgrades never remove reachable cells');
      const added = cells.filter(c => after.has(`${c.cellIX},${c.cellIY}`) && !before.has(`${c.cellIX},${c.cellIY}`));
      assert.gt(added.length, 0, `projected row ${iy}, depth ${depth}, blind ${blinded}, rung ${rung} adds cells`);
      const distances = added.map(c => {
        const centre = absCellCenterMeters(s, c.cellIX, c.cellIY);
        const half = WorldGen.TILE_PX / rowCells(s, absRowOf(s, c.cellIY)) * s.mPerPx / 2;
        return Math.hypot(Math.max(0, Math.abs(centre.x - p.x) - half), Math.max(0, Math.abs(centre.y - p.y) - half));
      });
      assert.lt(Math.max(...distances) - Math.min(...distances), 1e-4, 'one projected distance group per upgrade');
      before = after;
    }
  }
});

test('reach threshold cache follows projected grid width', () => {
  const s = reachScene({ cellM: 7, cellsPerTile: 225, mPerPx: 7.008915070782029 * 225 / WorldGen.TILE_PX,
    save: { energy: 100, reachUpgrades: 1 } });
  const centrePlayer = () => { s.playerM = absCellCenterMeters(s, 100, 100); };
  centrePlayer();
  const first = reachRadiusM(s);
  s.save.reachUpgrades = 0;
  const base = reachRadiusM(s);
  s.save.reachUpgrades = 1;
  assert.truthy(cellInReach(s, 102, 102), 'first upgrade reaches projected diagonal');
  s.mPerPx *= 1.01;
  centrePlayer();
  assert.gt(reachRadiusM(s), first, 'projection scale invalidates cached radius');
  assert.truthy(cellInReach(s, 102, 102), 'diagonal remains unlocked with new projection');
  const second = reachRadiusM(s);
  s.cellsPerTile = 224;
  centrePlayer();
  assert.gt(reachRadiusM(s), second, 'row cell count invalidates cached radius');
  assert.truthy(cellInReach(s, 102, 102), 'diagonal remains unlocked on new grid');
  s.save.reachUpgrades = 0;
  assert.eq(reachRadiusM(s), base, 'projection changes preserve the established base radius');
});
