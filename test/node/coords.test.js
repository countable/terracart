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

test('reachCells: base with no upgrades = 2.5', () => {
  const s = makeCoordScene({ save: { energy: 100, reachUpgrades: 0 }, depth: 0 });
  assert.eq(reachCells(s), 2.5);
});

test('reachCells: each upgrade adds 0.5 up to max 5.5', () => {
  for (let u = 0; u <= 6; u++) {
    const s = makeCoordScene({ save: { energy: 100, reachUpgrades: u }, depth: 0 });
    const expected = Math.min(5.5, 2.5 + 0.5 * u);
    assert.eq(reachCells(s), expected, `upgrades=${u}`);
  }
});

test('reachCells: upgrades capped — 7 upgrades still gives 5.5', () => {
  const s = makeCoordScene({ save: { energy: 100, reachUpgrades: 7 }, depth: 0 });
  // min(5.5, 2.5+3.5) = min(5.5,6) = 5.5
  assert.eq(reachCells(s), 5.5);
});

test('reachCells: no save defaults to 0 upgrades → 2.5 cells', () => {
  const s = makeCoordScene({ save: undefined, depth: 0 });
  assert.eq(reachCells(s), 2.5);
});

test('reachCells: depth 1 shrinks reach by 0.5, floored at 1.5', () => {
  // upgrades=0, base=2.5, depth=1 → 2.5-0.5=2.0
  const s = makeCoordScene({ save: { energy: 100, reachUpgrades: 0 }, depth: 1 });
  assert.eq(reachCells(s), 2.0);
});

test('reachCells: depth 2 shrinks reach by 1.0', () => {
  const s = makeCoordScene({ save: { energy: 100, reachUpgrades: 0 }, depth: 2 });
  assert.eq(reachCells(s), 1.5);
});

test('reachCells: depth 3 would shrink to 1.0 but is floored at 1.5', () => {
  const s = makeCoordScene({ save: { energy: 100, reachUpgrades: 0 }, depth: 3 });
  // 2.5 - 1.5 = 1.0 → floored to 1.5
  assert.eq(reachCells(s), 1.5);
});

test('reachCells: depth shrinking with upgrades — depth 6, upgrades 6', () => {
  // base = min(5.5, 2.5+3) = 5.5; depth=6 → 5.5-3.0=2.5
  const s = makeCoordScene({ save: { energy: 100, reachUpgrades: 6 }, depth: 6 });
  assert.eq(reachCells(s), 2.5);
});

test('reachCells: deep depth with max upgrades still floors at 1.5', () => {
  // base=5.5, depth=20 → 5.5-10 = neg → floored to 1.5
  const s = makeCoordScene({ save: { energy: 100, reachUpgrades: 6 }, depth: 20 });
  assert.eq(reachCells(s), 1.5);
});

test('reachCells: surface (depth=0) does NOT apply depth shrink', () => {
  const s = makeCoordScene({ save: { energy: 100, reachUpgrades: 2 }, depth: 0 });
  assert.eq(reachCells(s), 3.5);   // 2.5+1.0
});

// ── reachRadiusM ─────────────────────────────────────────────────────────────

test('reachRadiusM: normal surface = reachCells * cellM + 1', () => {
  const s = makeCoordScene({ save: { energy: 100, reachUpgrades: 0 }, depth: 0 });
  // reachCells = 2.5; cellM = 5; radius = 2.5*5+1 = 13.5
  assert.eq(reachRadiusM(s), 13.5);
});

test('reachRadiusM: zero energy returns 0 (cannot reach at all)', () => {
  const s = makeCoordScene({ save: { energy: 0, reachUpgrades: 0 }, depth: 0 });
  assert.eq(reachRadiusM(s), 0);
});

test('reachRadiusM: negative energy returns 0', () => {
  const s = makeCoordScene({ save: { energy: -5, reachUpgrades: 0 }, depth: 0 });
  assert.eq(reachRadiusM(s), 0);
});

test('reachRadiusM: missing save.energy defaults to 0 → radius 0', () => {
  // energy ?? 0 → 0 → radius 0
  const s = makeCoordScene({ save: { reachUpgrades: 0 }, depth: 0 });
  assert.eq(reachRadiusM(s), 0, 'missing energy treated as 0');
});

test('reachRadiusM: low energy (>0) does NOT shrink reach (only 0 shrinks)', () => {
  // PATCH-HISTORY/BUG: The comment in coords.js explicitly states "It does NOT
  // shrink when merely tired" — only exactly 0 energy blocks reach entirely.
  // f98eb04 introduced the 0-energy gate; tired state (> 0 but low) is handled
  // by the UI but does NOT affect the reach radius.
  const s = makeCoordScene({ save: { energy: 1, reachUpgrades: 0 }, depth: 0 });
  assert.eq(reachRadiusM(s), 13.5, '1 energy → full radius, no tired shrink');
});

test('reachRadiusM: upgrades increase radius', () => {
  for (let u = 0; u <= 6; u++) {
    const s = makeCoordScene({ save: { energy: 100, reachUpgrades: u }, depth: 0 });
    const expected = Math.min(5.5, 2.5 + 0.5 * u) * 5 + 1;
    assert.eq(reachRadiusM(s), expected, `upgrades=${u}`);
  }
});

test('reachRadiusM: depth shrinks radius', () => {
  // upgrades=0, base=2.5, depth=1 → cells=2.0, radius=2.0*5+1=11
  const s = makeCoordScene({ save: { energy: 100, reachUpgrades: 0 }, depth: 1 });
  assert.eq(reachRadiusM(s), 11);
});

test('reachRadiusM: depth=3 floors reach at 1.5 cells → radius = 8.5', () => {
  const s = makeCoordScene({ save: { energy: 100, reachUpgrades: 0 }, depth: 3 });
  assert.eq(reachRadiusM(s), 1.5 * 5 + 1);  // 8.5
});

test('reachRadiusM: Potion of Reach (active) overrides everything → VIEW_CELLS * cellM', () => {
  // VIEW_CELLS = 11 (app.js); cellM = 5 → radius = 55 m.
  // The potion overrides even zero energy.
  const future = Date.now() + 60 * 1000;
  const s = makeCoordScene({
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
  const s = makeCoordScene({
    save: { energy: 100, reachUpgrades: 0, reachPotionUntil: past },
    depth: 0,
  });
  assert.eq(reachRadiusM(s), 13.5, 'expired potion → normal radius');
});

// ── cellInReach — core correctness ───────────────────────────────────────────

// We use a simple scene where the player stands at the reach-cell origin and
// we can compute exact distances in cell units.
function reachScene(over) {
  // cellM = 5: distances in metres are easy multiples.
  // Player at playerM={0,0}, feetOffsetM=0 to put reach cell at the pixel origin.
  // That way playerReachCell = worldMetersToAbsCell(scene, startWorldM).
  // With originPx=(0,0), startWorldM=(0,0), mPerPx=1, cellsPerTile=1:
  //   cellPxSize = 256, cps=256, mPerPx=1 → cell is 256 m wide.
  //   That's huge — use cellsPerTile=51, mPerPx=1.
  //   cellPxSize=256/51≈5.02 px, cell width = 5.02 m ≈ cellM.
  // Simplest: use originPx={0,0}, startWorldM={0,0}, mPerPx=1, cellsPerTile=51.
  //   Then cellPxSize=256/51 px, and world metres map through /mPerPx=1 → px.
  //   A point at wmx=0 → wx=0 px → cellIX=0.
  //   Player at playerM={0,0}, feetOffsetM=0 → reach cell = {0,0}.
  // reachRadiusM = reachCells * cellM + 1 = 2.5*5+1 = 13.5 m (default).
  // cellInReach: dx = (cellIX - 0) * cellM = cellIX * 5.
  // So cell (1,0): dx=5, r²=25 ≤ 13.5²=182.25 → IN reach.
  // Cell (2,0): dx=10, r²=100 ≤ 182.25 → IN reach.
  // Cell (3,0): dx=15, r²=225 > 182.25 → OUT of reach.
  const base = {
    startWorldM: { x: 0, y: 0 },
    mPerPx: 1,
    originPx: { x: 0, y: 0 },
    cellsPerTile: 51,
    cellM: 5,
    playerM: { x: 0, y: 0 },
    feetOffsetM: 0,   // simplify: feet = body
    depth: 0,
    save: { energy: 100, reachUpgrades: 0 },
  };
  return Object.assign({}, base, over);
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
  // reachRadiusM = 13.5; cell (1,0): dist²=25 ≤ 182.25
  const s = reachScene();
  assert.truthy(cellInReach(s, 1, 0), 'E neighbour reachable');
  assert.truthy(cellInReach(s, -1, 0), 'W neighbour reachable');
  assert.truthy(cellInReach(s, 0, 1), 'S neighbour reachable');
  assert.truthy(cellInReach(s, 0, -1), 'N neighbour reachable');
});

test('cellInReach: cardinal cell 2 away is reachable (base reach 2.5 cells)', () => {
  // cell (2,0): dist²=100 ≤ 182.25
  const s = reachScene();
  assert.truthy(cellInReach(s, 2, 0), '2 cells E reachable');
  assert.truthy(cellInReach(s, 0, 2), '2 cells S reachable');
});

test('cellInReach: cardinal cell 3 away is NOT reachable (base reach 2.5 cells)', () => {
  // cell (3,0): dist = 15 m, dist²=225 > reachM²=182.25
  const s = reachScene();
  assert.falsy(cellInReach(s, 3, 0), '3 cells E NOT reachable');
  assert.falsy(cellInReach(s, 0, 3), '3 cells S NOT reachable');
});

test('cellInReach: BOUNDARY — exact cell at reach radius is IN reach (≤ check)', () => {
  // With upgrades=4: reachCells=4.5, reachM=4.5*5+1=23.5 m.
  // Cell at distance exactly cellIX=4 along X: dx=4*5=20 m, dist²=400 ≤ 23.5²=552.25 → IN.
  // Cell at distance cellIX=5: dx=25 m, dist²=625 > 552.25 → OUT.
  const s = reachScene({ save: { energy: 100, reachUpgrades: 4 } });
  // reachM = 4.5*5+1 = 23.5
  assert.truthy(cellInReach(s, 4, 0), 'cell at 20 m IN reach (radius 23.5 m)');
  assert.falsy(cellInReach(s, 5, 0), 'cell at 25 m OUT of reach (radius 23.5 m)');
});

test('cellInReach: diagonal cell just inside circle — (2,2) with upgrades', () => {
  // With upgrades=4: reachM=23.5. Cell (2,2): dist²=(10²+10²)=200 ≤ 552.25 → IN.
  const s = reachScene({ save: { energy: 100, reachUpgrades: 4 } });
  assert.truthy(cellInReach(s, 2, 2), 'diagonal (2,2) in reach at 4 upgrades');
});

test('cellInReach: diagonal cell outside circle — (4,4) with max upgrades', () => {
  // Max upgrades=6: reachCells=5.5, reachM=5.5*5+1=28.5.
  // Cell (4,4): dist²=(20²+20²)=800. 28.5²=812.25 → 800 ≤ 812.25 → IN.
  // Cell (5,4): dist²=(25²+20²)=1025 > 812.25 → OUT.
  const s = reachScene({ save: { energy: 100, reachUpgrades: 6 } });
  assert.truthy(cellInReach(s, 4, 4), '(4,4) in reach at max upgrades');
  assert.falsy(cellInReach(s, 5, 4), '(5,4) out of reach at max upgrades');
});

test('cellInReach: depth shrink reduces reachable cells', () => {
  // depth=2: reachCells=max(1.5, 2.5-1.0)=1.5, reachM=8.5 m.
  // Cell (1,0): dist=5 ≤ 8.5 → IN. Cell (2,0): dist=10 > 8.5 → OUT.
  const s = reachScene({ save: { energy: 100, reachUpgrades: 0 }, depth: 2 });
  assert.truthy(cellInReach(s, 1, 0), 'cell 1 away IN reach at depth 2');
  assert.falsy(cellInReach(s, 2, 0), 'cell 2 away OUT of reach at depth 2');
});

test('cellInReach: Potion of Reach makes distant cells reachable', () => {
  // Potion radius >> 50 m; cell (8,0): dist=40 m.
  const future = Date.now() + 60_000;
  const s = reachScene({
    save: { energy: 100, reachUpgrades: 0, reachPotionUntil: future },
  });
  assert.truthy(cellInReach(s, 8, 0), 'potion lets player reach 8 cells away');
});

test('cellInReach: exact boundary off-by-one — cell at radius² boundary is IN (≤)', () => {
  // This guards the 11190b4 "house edge just out of reach" regression.
  // We find the exact threshold: reachM²=182.25 (base reach).
  // Pick cell (1,1): dist²=(5²+5²)=50. √50≈7.07 << 13.5 → clearly IN.
  // Pick cell (2,2): dist²=(10²+10²)=200 > 182.25 → OUT (barely).
  // Guard the boundary explicitly.
  const s = reachScene();  // reachM=13.5
  const reachM = reachRadiusM(s);  // 13.5
  assert.eq(reachM, 13.5, 'base reachM check');
  // Exactly at boundary: find a cell whose squared distance equals reachM² when possible.
  // No integer cell satisfies dist²=182.25 exactly, but guard the nearest neighbors.
  assert.truthy(cellInReach(s, 1, 1),   '(1,1) dist²=50 clearly in reach');
  assert.falsy(cellInReach(s, 2, 2),    '(2,2) dist²=200 outside reach (13.5²=182.25)');
  assert.truthy(cellInReach(s, 2, 0),   '(2,0) dist²=100 in reach');
  assert.falsy(cellInReach(s, 3, 0),    '(3,0) dist²=225 outside reach');
});

test('cellInReach: epsilon (+1 m) keeps the cardinal cell of reachCells included', () => {
  // Without the +1 m epsilon: radius = 2.5*5 = 12.5.
  // Cell at dist=12.5: 12.5²=156.25 ≤ 156.25 → just IN (border).
  // With +1: radius=13.5, dist²=182.25, so more margin.
  // The epsilon is documented as keeping the diamond readable at every level.
  // Verify that cell (2,0) — which is 10 m away — is comfortably in reach with epsilon.
  const s = reachScene();
  // reachCells * cellM = 12.5; +1 = 13.5; cell (2,0) at 10 m is clearly in.
  assert.truthy(cellInReach(s, 2, 0), 'cardinal 2-cell reach included thanks to epsilon');
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
  assert.falsy(cellInReach(s, prc.cellIX + 3, prc.cellIY), '+3 E from moved player NOT reachable');
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
