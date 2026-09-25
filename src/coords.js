// Canonical coordinate helpers. All cross-module ABSOLUTE-cell keys flow
// through here so the tile-pixel basis used by drawCells and save-state
// stays unified (see CLAUDE.md / past coord-drift bugs).
//
// Depends on:
//   scene fields: startWorldM, mPerPx, originPx, cellsPerTile, and optionally
//   cellsForRow(ty) (the game's per-row grid; absent = one uniform grid).
//
// Exports as globals:
//   cellKeyFromAbsCell(absIX, absIY)         — "ix_iy"
//   distM2(ax, ay, bx, by)                   — compare-only squared distance
//   localMetersToTilePx(scene, mx, my)       — the player frame → tile-pixel space
//   worldMetersToTilePx(scene, wmx, wmy)     — …and absolute metres → the same
//   localMetersToTile / worldMetersToTile    — the TILE either of those falls in
//   eachTile3x3(tx, ty, fn)                  — the 3×3 tile ring, in row order
//   gamePt(p, renderScale)                   — a canvas-px pointer in LOGICAL px
//   rowCells / rowCellPx / rowCellM(scene, ty) — a tile ROW's own grid
//   tileCellToAbs / absCellToTile            — (tx,ty,ix,iy) ⇄ absolute cell
//   absRowOf / absRowStart / absColShift     — the per-row absolute encoding
//   absCellOffset / absCellDelta             — neighbour / distance across seams
//   worldMetersToTileCell / tileCellCenterMeters — metres ⇄ a tile's own cell
//   viewAnchorAbsCell / viewBand / viewBandKey — the drawn window across a seam
//   worldMetersToAbsCell(scene, wmx, wmy)    — { cellIX, cellIY }
//   absCellCenterMeters(scene, cellIX, cellIY) — { x, y }
//   sameAbsCell(scene, ax, ay, bx, by)       — do both points share a cell?
//   peekM(scene)                             — the peek-drag camera offset
//   viewAnchorWorldM(scene)                  — world point the viewport centres on
//   viewAnchorCell(scene)                    — that point's { tx, ty, cx, cy }
//   overlayFrame(scene, entryReady)          — a geometry overlay's draw frame
//   overlayProjection(scene, fracX, fracY)   — …and its cell-snapped projection
//   timedOverlayRebuild(label, fn)           — one rebuild under the boot profiler
//   lonLatToLocalM(scene, lon, lat)          — a GPS fix in playerM's frame
//   localMToLonLat(scene, mx, my)            — and back out to lon/lat
//   REACH_CORNER_PX / ReachCorner            — the lit boundary's corner rule

function cellKeyFromAbsCell(absIX, absIY) {
  return `${absIX}_${absIY}`;
}

// Pixel size of one REFERENCE cell in z=14 tile-pixel space — the frame's own
// legacy grid (scene.cellsPerTile, sized from START_LAT). A tile's REAL grid
// is its row's (rowCells below); this is what a stub scene with no per-row
// grid uses everywhere, and what the absolute-cell encoding is anchored on.
function cellPxSize(scene) {
  return WorldGen.TILE_PX / scene.cellsPerTile;
}

// ─── Per-row cell grids (CLAUDE.md: "Every player sees the SAME generated
// world") ──────────────────────────────────────────────────────────────────────
// A tile's grid is the TILE's: WorldGen.cellsPerEdgeForTile(ty) cells an edge,
// from its own row's latitude — NOT the save's scene.cellsPerTile. The two
// agree on almost every row, but not all: rows ~20 km apart step by one cell.
//
// scene.cellsForRow(ty) is the row's cell count (the game sets it to
// WorldGen.cellsPerEdgeForTile). A scene without it — every headless stub —
// is UNIFORM: every row is scene.cellsPerTile and every function below
// collapses to the old one-grid arithmetic exactly.
function rowCells(scene, ty) {
  const f = scene.cellsForRow;
  return f ? f(ty) : scene.cellsPerTile;
}
// One cell of row ty, in z=14 tile px.
function rowCellPx(scene, ty) {
  return WorldGen.TILE_PX / rowCells(scene, ty);
}
// One cell of row ty, in FRAME metres (the save's tileEdgeM over the row's
// count) — what a metre⇄cell step inside a tile of that row uses, never the
// nominal scene.cellM. A stub scene with no grid at all falls back to cellM.
function rowCellM(scene, ty) {
  const n = rowCells(scene, ty);
  return (n > 0 && scene.tileEdgeM > 0) ? scene.tileEdgeM / n : scene.cellM;
}

// ─── The ABSOLUTE cell encoding ──────────────────────────────────────────────
// Every per-cell key in the save (tilled, dug walls, placed rocks) and every
// "cell next door" walk is an absolute (cellIX, cellIY). With one grid for the
// whole world that was floor(tile px / cell px) on both axes. With a grid per
// ROW it is:
//   cellIY = rowStart(ty) + iy        — rows stacked contiguously, so the row
//                                       below a seam starts exactly one past
//                                       the last row above it
//   cellIX = tx * N(ty) + ix + colShift(ty)
// anchored on the frame's REFERENCE tile (the one holding originPx) and its
// reference count Nref = scene.cellsPerTile: rowStart(ty) = ty*Nref plus the
// sum of (N(r) - Nref) over the rows between the reference row and ty, and
// colShift(ty) = -refTx * (N(ty) - Nref). So on every row whose N equals Nref
// both terms are ZERO and the encoding is the old one bit for bit — a save's
// keys stay where they were, and the keys of a row that DOES differ start
// where the reference column's cells did.
//
// What the encoding is NOT: a uniform lattice. Columns of two rows with
// different N do not line up (their cells differ in width by ~0.4%), so
// cellIX + 1 is the next cell ALONG a row, but "the cell below" across a row
// seam is a POSITION question — absCellOffset / absCellDelta answer it via
// tile px, never cellIX arithmetic.
function _cellRef(scene) {
  const T = WorldGen.TILE_PX;
  return {
    tx: Math.floor(scene.originPx.x / T),
    ty: Math.floor(scene.originPx.y / T),
  };
}
function _rowMemo(scene) {
  const nref = scene.cellsPerTile;
  const refTy = Math.floor(scene.originPx.y / WorldGen.TILE_PX);
  let m = scene._absRowMemo;
  if (!m || m.nref !== nref || m.refTy !== refTy || m.fn !== scene.cellsForRow) {
    m = { nref, refTy, fn: scene.cellsForRow, start: new Map() };
    scene._absRowMemo = m;
  }
  return m;
}
// First absolute cellIY of tile row ty.
function absRowStart(scene, ty) {
  const nref = scene.cellsPerTile;
  if (!scene.cellsForRow) return ty * nref;
  const m = _rowMemo(scene);
  let v = m.start.get(ty);
  if (v !== undefined) return v;
  let s = 0;
  if (ty > m.refTy) { for (let r = m.refTy; r < ty; r++) s += rowCells(scene, r) - nref; }
  else { for (let r = ty; r < m.refTy; r++) s -= rowCells(scene, r) - nref; }
  v = ty * nref + s;
  m.start.set(ty, v);
  return v;
}
// Constant added to tx * N(ty) + ix to make row ty's absolute cellIX.
function absColShift(scene, ty) {
  if (!scene.cellsForRow) return 0;
  const d = rowCells(scene, ty) - scene.cellsPerTile;
  return d === 0 ? 0 : -Math.floor(scene.originPx.x / WorldGen.TILE_PX) * d;
}
// Which tile row holds absolute cellIY.
function absRowOf(scene, cellIY) {
  const nref = scene.cellsPerTile;
  let ty = Math.floor(cellIY / nref);
  if (!scene.cellsForRow) return ty;
  while (absRowStart(scene, ty) > cellIY) ty--;
  while (absRowStart(scene, ty + 1) <= cellIY) ty++;
  return ty;
}

// (tx, ty, ix, iy) on the tile's own grid → absolute cell.
function tileCellToAbs(scene, tx, ty, ix, iy) {
  if (!scene.cellsForRow) {
    const N = scene.cellsPerTile;
    return { cellIX: tx * N + ix, cellIY: ty * N + iy };
  }
  const N = rowCells(scene, ty);
  return { cellIX: tx * N + ix + absColShift(scene, ty), cellIY: absRowStart(scene, ty) + iy };
}
// Absolute cell → { tx, ty, ix, iy, n } (n = that tile's cells per edge). Pass
// `out` to fill a scratch object instead of allocating (per-cell hot loops).
function absCellToTile(scene, cellIX, cellIY, out) {
  const o = out || {};
  let ty, N, lx, ly;
  if (!scene.cellsForRow) {
    N = scene.cellsPerTile;
    ty = Math.floor(cellIY / N);
    ly = cellIY - ty * N;
    lx = cellIX;
  } else {
    ty = absRowOf(scene, cellIY);
    N = rowCells(scene, ty);
    ly = cellIY - absRowStart(scene, ty);
    lx = cellIX - absColShift(scene, ty);
  }
  const tx = Math.floor(lx / N);
  o.tx = tx; o.ty = ty; o.ix = lx - tx * N; o.iy = ly; o.n = N;
  return o;
}

// Tile px → absolute cell, the one floor every metre→cell conversion shares.
function tilePxToAbsCell(scene, px, py) {
  if (!scene.cellsForRow) {
    const cps = cellPxSize(scene);
    return { cellIX: Math.floor(px / cps), cellIY: Math.floor(py / cps) };
  }
  const ty = Math.floor(py / WorldGen.TILE_PX);
  const N = rowCells(scene, ty);
  const cps = WorldGen.TILE_PX / N;
  return {
    cellIX: Math.floor(px / cps) + absColShift(scene, ty),
    cellIY: Math.floor(py / cps) + (absRowStart(scene, ty) - ty * N),
  };
}
// Absolute cell → the tile px of its CENTRE.
function absCellCenterPx(scene, cellIX, cellIY) {
  if (!scene.cellsForRow) {
    const cps = cellPxSize(scene);
    return { x: (cellIX + 0.5) * cps, y: (cellIY + 0.5) * cps };
  }
  const ty = absRowOf(scene, cellIY);
  const N = rowCells(scene, ty);
  const cps = WorldGen.TILE_PX / N;
  return {
    x: (cellIX - absColShift(scene, ty) + 0.5) * cps,
    y: (cellIY - (absRowStart(scene, ty) - ty * N) + 0.5) * cps,
  };
}

// The cell (dx, dy) cells away from an absolute cell, as a POSITION: along a
// row (or between rows sharing a grid) it is plain addition; into a row whose
// grid differs it is the cell of that row whose centre is nearest the point
// dx cells across, measured in the starting row's cells.
function absCellOffset(scene, cellIX, cellIY, dx, dy) {
  const tIY = cellIY + dy;
  if (!scene.cellsForRow) return { cellIX: cellIX + dx, cellIY: tIY };
  const ty0 = absRowOf(scene, cellIY);
  const ty1 = dy === 0 ? ty0 : absRowOf(scene, tIY);
  const n0 = rowCells(scene, ty0), n1 = rowCells(scene, ty1);
  if (n0 === n1) return { cellIX: cellIX + dx, cellIY: tIY };
  const T = WorldGen.TILE_PX;
  const px = (cellIX - absColShift(scene, ty0) + 0.5 + dx) * (T / n0);
  const lx = Math.round(px / (T / n1) - 0.5);
  return { cellIX: lx + absColShift(scene, ty1), cellIY: tIY };
}
// How many cells (dx, dy) cell B sits from cell A, in A's row's cells — the
// inverse question. dy is exact (rows are stacked contiguously); dx across a
// grid change rounds the centre-to-centre distance to whole cells.
function absCellDelta(scene, aIX, aIY, bIX, bIY) {
  const dy = bIY - aIY;
  if (!scene.cellsForRow) return { dx: bIX - aIX, dy };
  const tyA = absRowOf(scene, aIY);
  const tyB = dy === 0 ? tyA : absRowOf(scene, bIY);
  const nA = rowCells(scene, tyA), nB = rowCells(scene, tyB);
  if (nA === nB) return { dx: bIX - aIX, dy };
  const T = WorldGen.TILE_PX;
  const ax = (aIX - absColShift(scene, tyA) + 0.5) * (T / nA);
  const bx = (bIX - absColShift(scene, tyB) + 0.5) * (T / nB);
  return { dx: Math.round((bx - ax) / (T / nA)), dy };
}

// Compare-only squared distance between two points — avoids the sqrt. Lives
// here rather than in util.js because both points are METRES in one of the two
// frames below, and every caller (interact.js' reach prefilters, app.js'
// nearest-thing scans) is asking a coordinate question.
function distM2(ax, ay, bx, by) { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; }

// ─── Metres → TILE-PIXEL space ───────────────────────────────────────────────
// Everything that indexes a tile or a cell floors out of z=14 tile-pixel space,
// and there are exactly TWO metre frames that reach it:
//
//   LOCAL   metres from the projection origin — scene.playerM, scene.gpsM, the
//           viewport offsets. Zero is scene.startWorldM.
//   WORLD   absolute metres — every object, creature and wildplant x/y, which
//           are tx * tileEdgeM + …
//
// The world frame is the local one shifted by startWorldM, so worldMetersTo*
// is localMetersTo* with that subtraction and nothing else. app.js used to
// spell each of these out by hand at five call sites, each with its own
// arrangement of originPx / mPerPx / TILE_PX — which is exactly the coord
// drift this file exists to prevent.
function localMetersToTilePx(scene, mx, my) {
  return {
    x: scene.originPx.x + mx / scene.mPerPx,
    y: scene.originPx.y + my / scene.mPerPx,
  };
}
function worldMetersToTilePx(scene, wmx, wmy) {
  return localMetersToTilePx(scene, wmx - scene.startWorldM.x, wmy - scene.startWorldM.y);
}
function tilePxToTile(px, py) {
  return {
    tx: Math.floor(px / WorldGen.TILE_PX),
    ty: Math.floor(py / WorldGen.TILE_PX),
  };
}
function localMetersToTile(scene, mx, my) {
  const p = localMetersToTilePx(scene, mx, my);
  return tilePxToTile(p.x, p.y);
}
function worldMetersToTile(scene, wmx, wmy) {
  const p = worldMetersToTilePx(scene, wmx, wmy);
  return tilePxToTile(p.x, p.y);
}

// The 3×3 ring of tiles around one — the shape every "what is near the player"
// scan walks (tile loading, the lair residency step, the street sweep, the
// street lamps, the road-id debug dump). Row order (dty outer, dtx inner), so
// a scan that keeps the first hit keeps the same one it always did.
function eachTile3x3(tx, ty, fn) {
  for (let dty = -1; dty <= 1; dty++) {
    for (let dtx = -1; dtx <= 1; dtx++) fn(tx + dtx, ty + dty, dtx, dty);
  }
}

// A Phaser pointer's position in LOGICAL px. Phaser reports pointer positions
// in CANVAS px — the backing store, which is renderScale× the logical grid (see
// app.js' canvas-resolution note by W/H) — while every gate downstream is
// logical: the drag slop, the peek metres, interactTap's cell hit test,
// Multiplayer.consumeTap. So a pointer converts here, once, on the way in, and
// there is one place to look when the map stops answering taps.
function gamePt(p, renderScale) {
  return { x: p.x / renderScale, y: p.y / renderScale };
}

function worldMetersToAbsCell(scene, wmx, wmy) {
  const p = worldMetersToTilePx(scene, wmx, wmy);
  return tilePxToAbsCell(scene, p.x, p.y);
}

function absCellCenterMeters(scene, cellIX, cellIY) {
  const c = absCellCenterPx(scene, cellIX, cellIY);
  return {
    x: scene.startWorldM.x + (c.x - scene.originPx.x) * scene.mPerPx,
    y: scene.startWorldM.y + (c.y - scene.originPx.y) * scene.mPerPx,
  };
}

// A world point's tile and cell on THAT tile's own grid: { tx, ty, ix, iy, n }.
// The answer to "which cell of which tile's arrays is this?" — never
// floor(metres / cellM).
function worldMetersToTileCell(scene, wmx, wmy) {
  const c = worldMetersToAbsCell(scene, wmx, wmy);
  return absCellToTile(scene, c.cellIX, c.cellIY);
}
// Centre of cell (ix, iy) of tile (tx, ty), in world metres.
function tileCellCenterMeters(scene, tx, ty, ix, iy) {
  const c = tileCellToAbs(scene, tx, ty, ix, iy);
  return absCellCenterMeters(scene, c.cellIX, c.cellIY);
}

// Tile px → { tx, ty, cx, cy }: the tile, and the FRACTIONAL cell inside it on
// its own grid. The shape playerToWorldCell / viewAnchorCell return.
function tilePxToTileCellF(scene, wx, wy) {
  const tilePx = WorldGen.TILE_PX;
  const tx = Math.floor(wx / tilePx);
  const ty = Math.floor(wy / tilePx);
  const cps = scene.cellsForRow ? rowCellPx(scene, ty) : cellPxSize(scene);
  return { tx, ty, cx: (wx - tx * tilePx) / cps, cy: (wy - ty * tilePx) / cps };
}

// Do two world points fall in the SAME absolute cell? The single answer to
// "did this tap land on that thing's tile?", used by every cell-bounded tap
// target in interact.js. Cell membership — never a radius — so a hit area can
// physically not spill into the neighbouring cells the way a disk centred on
// an object's foot does.
function sameAbsCell(scene, ax, ay, bx, by) {
  const a = worldMetersToAbsCell(scene, ax, ay);
  const b = worldMetersToAbsCell(scene, bx, by);
  return a.cellIX === b.cellIX && a.cellIY === b.cellIY;
}

// ─── The CAMERA ANCHOR ───────────────────────────────────────────────────────
// The camera normally sits on the player: every world→screen projection in
// render.js and the two geometry overlays measures from the player's world
// position, which is why the character is drawn at the dead centre of the
// viewport and never moves.
//
// A PEEK DRAG (app.js `_peek*`) slides the camera off the player for a moment
// so you can look at the ground just past the edge of the map. It is a CAMERA
// offset and nothing else: `playerM` is untouched, so reach, tap gates, fog
// reveal, tile loading and every other gameplay test still measure from the
// body. The rule is therefore: anything that asks "where do I DRAW this?"
// measures from the anchor below, and anything that asks "where IS the player?"
// keeps using playerM / playerToWorldCell().
//
// scene.peekM is optional — a stub scene in the headless tests won't have it,
// and then the anchor collapses to the player exactly as before.
const _NO_PEEK = { x: 0, y: 0 };
function peekM(scene) {
  return scene.peekM || _NO_PEEK;
}

// The world point (metres, same frame as an object's x/y) the viewport centres
// on. worldMetersToScreen / screenToWorldMeters are both defined against it.
function viewAnchorWorldM(scene) {
  const p = peekM(scene);
  return {
    x: scene.startWorldM.x + scene.playerM.x + p.x,
    y: scene.startWorldM.y + scene.playerM.y + p.y,
  };
}

// The anchor's tile + intra-tile cell address — the origin of the drawn window.
// Same shape as scene.playerToWorldCell() (which is this with no peek), so a
// pass can swap one for the other and keep its fracX/fracY / baseCellI* maths.
function viewAnchorCell(scene) {
  const p = peekM(scene);
  const wx = scene.originPx.x + (scene.playerM.x + p.x) / scene.mPerPx;
  const wy = scene.originPx.y + (scene.playerM.y + p.y) / scene.mPerPx;
  return tilePxToTileCellF(scene, wx, wy);
}

// The anchor's absolute cell — the (baseCellIX, baseCellIY) every drawn window
// offsets its slots from.
function viewAnchorAbsCell(scene, pc) {
  return tileCellToAbs(scene, pc.tx, pc.ty, Math.floor(pc.cx), Math.floor(pc.cy));
}

// ─── Drawing a window that crosses a row seam ────────────────────────────────
// The drawn window is a fixed grid of CELL_PX slots around the anchor cell:
// slot (ox, oy) holds absolute cell (baseCellIX + ox, baseCellIY + oy). That
// is exact on every row sharing the anchor row's grid. A row band whose grid
// DIFFERS (a cellsPerEdgeForTile step inside the view) has its own column
// phase: viewBand says which of its cells sits in the anchor's column (`dX`,
// added to baseCellIX + ox) and how far its cells' true left edges sit from
// the anchor grid's slots (`phaseX`, screen px added to the slot's x). Rows
// stay on the slot grid vertically — the seam is a tile edge, which is a slot
// edge on both sides — and each band's cells are drawn CELL_PX apart from its
// own true origin, so the band tiles seamlessly; the ~0.4% size difference
// drifts it < 0.03 cell across the whole view.
const _SAME_BAND = Object.freeze({ dX: 0, phaseX: 0 });
function viewBand(scene, pc, cellIY) {
  if (!scene.cellsForRow) return _SAME_BAND;
  const ty = absRowOf(scene, cellIY);
  if (ty === pc.ty) return _SAME_BAND;
  const n = rowCells(scene, ty);
  const nA = rowCells(scene, pc.ty);
  if (n === nA) return _SAME_BAND;
  const T = WorldGen.TILE_PX;
  const cpsA = T / nA, cps = T / n;
  const ax = pc.tx * T + pc.cx * cpsA;          // the anchor, in tile px
  const lx = Math.floor(ax / cps);              // the band's cell under it
  const baseIX = tileCellToAbs(scene, pc.tx, pc.ty, Math.floor(pc.cx), 0).cellIX;
  return {
    dX: lx + absColShift(scene, ty) - baseIX,
    phaseX: ((lx * cps - ax) / cpsA + (pc.cx - Math.floor(pc.cx))) * CELL_PX,
  };
}

// A string naming every row band of the drawn ring (VIEW_CELLS + 4 rows
// around the anchor) that is off the anchor's grid — '' on a uniform view,
// which is every view not within a few cells of a row seam whose grid steps.
// A pass that caches geometry on the anchor cell adds it to its key: a band's
// column can step without the anchor cell changing.
function viewBandKey(scene, pc, baseCellIY, half) {
  if (!scene.cellsForRow) return '';
  const R = VIEW_CELLS + 4;
  let k = '';
  for (let r = 0; r < R; r++) {
    const b = viewBand(scene, pc, baseCellIY + (r - 2 - half));
    if (b.dX || b.phaseX) k += r + ':' + b.dX + ':' + Math.round(b.phaseX) + '|';
  }
  return k;
}

// ─── The geometry overlays' frame ───────────────────────────────────────────
// road_overlay.js and building_overlay.js both cache a canvas drawn at the
// cell-snapped CAMERA ANCHOR and scroll it by the sub-cell fraction every
// frame, rebuilding only when the anchor crosses a cell or a tile's data
// lands. They open their draw() identically, so the opening lives here once:
// the anchor's cell, its sub-cell fraction, the absolute base cell the pass
// projects from, and the 3×3 ring of tiles whose data is in hand — which is
// also the readiness half of each overlay's cache key. `entryReady(entry)` is
// the overlay's own test (the decoded MVT layers for the roads, the source
// building rings for the footprints); a tile with no tileEdgeM is never ready.
function overlayFrame(scene, entryReady) {
  const pc = viewAnchorCell(scene);
  const fracX = pc.cx - Math.floor(pc.cx);
  const fracY = pc.cy - Math.floor(pc.cy);
  const { cellIX: baseCellIX, cellIY: baseCellIY } = viewAnchorAbsCell(scene, pc);
  const tiles = [];
  let ready = '';
  for (let dty = -1; dty <= 1; dty++) {
    for (let dtx = -1; dtx <= 1; dtx++) {
      const tx = pc.tx + dtx, ty = pc.ty + dty;
      const entry = WorldGen.tileCache.get(WorldGen.tileKey(tx, ty));
      if (!entry || !entry.tileEdgeM || !entryReady(entry)) continue;
      tiles.push({ tx, ty, entry });
      ready += `${dtx}${dty}|`;
    }
  }
  // A row band off the anchor's grid can step without the anchor cell moving,
  // so its layout is part of the cache key too ('' on a uniform view).
  const bands = viewBandKey(scene, pc, baseCellIY, (VIEW_CELLS - 1) / 2);
  if (bands) ready += '#' + bands;
  return { pc, fracX, fracY, baseCellIX, baseCellIY, tiles, ready };
}

// The rebuild's projection: world metres → screen px, measured from the
// camera anchor and snapped to the cell (the container re-applies the
// sub-cell offset), plus the padded viewport the pass culls against — a full
// cell wider than the sub-cell scroll can ever reveal, on every side.
function overlayProjection(scene, fracX, fracY) {
  const a = viewAnchorWorldM(scene);
  const projX = (wmx) => scene.viewCenterX + ((wmx - a.x) / scene.cellM) * CELL_PX + fracX * CELL_PX;
  const projY = (wmy) => scene.viewCenterY + ((wmy - a.y) / scene.cellM) * CELL_PX + fracY * CELL_PX;
  const PAD = CELL_PX * 2;
  return {
    projX, projY,
    minX: scene.viewLeft - PAD, maxX: scene.viewLeft + scene.viewSize + PAD,
    minY: scene.viewTop  - PAD, maxY: scene.viewTop  + scene.viewSize + PAD,
  };
}

// One overlay rebuild, ticked into the boot profiler under `label` when the
// profiler is on. Only the rebuild is timed — draw() runs every frame, but
// the key check only rebuilds on a cell crossing or a tile load, so the
// cheap early-out frames never touch the tick.
function timedOverlayRebuild(label, fn) {
  const B = window.__boot;
  if (!B) { fn(); return; }
  const t0 = performance.now();
  fn();
  B.tick(label, performance.now() - t0);
}

// Player's "reach origin" — the absolute cell the visual reach silhouette
// and every too-far gate measure distance from. X is the body cell column
// (no horizontal feet offset); Y is the FEET cell row (feetOffsetM south
// of the body), so the reach snaps when the visible feet cross a gridline.
// feetOffsetM is 0 in the game now — the sprite is seated with its feet ON
// playerM (app.js create()) — but the term stays so the rule reads as
// "the feet", and so a scene that seats them elsewhere still gets it right.
// Returns { cellIX, cellIY }.
function playerReachCell(scene) {
  const wx = scene.originPx.x + scene.playerM.x / scene.mPerPx;
  const wy = scene.originPx.y + (scene.playerM.y + scene.feetOffsetM) / scene.mPerPx;
  return tilePxToAbsCell(scene, wx, wy);
}

// SINGLE SOURCE OF TRUTH for the player's reach radius, in metres. Everything
// that asks "can the player reach here?" funnels through this — the visual
// silhouette (render.js drawCells), the cell-tap gate (cellInReach below), and
// the object/creature/treasure far-gate (interact.js tooFar) — so the lit area
// and every tap-accept test stay byte-identical and can't drift.
//
// Reach depends on the Inner Light the player controls, dimmed by the dark as
// they descend. On the surface it starts at 2.5 cells and grows to 5.5 via the
// six +0.5-cell upgrades (save.reachUpgrades, 0..6) bought as the wizard
// tower's Inner Light track (wizard.js TRACKS). Underground the bubble is
// smothered: each level down trims it by half a cell, floored at 1.5 so the
// immediate ring is always workable — so each descent both darkens the
// surroundings (render.js) AND tightens the lit reach. It does NOT shrink when
// merely tired; the special cases are the Potion of Reach (lights the whole
// view) and 0 energy (you can't reach at all).
// The +1 m epsilon keeps the cardinal cell included with a hair of margin so the
// silhouette reads as a rounded diamond at every level.
function reachCells(scene) {
  const upgrades = scene.save?.reachUpgrades ?? 0;
  const base = Math.min(5.5, 2.5 + 0.5 * upgrades);
  const depth = scene.depth ?? 0;
  if (depth > 0) return Math.max(1.5, base - 0.5 * depth);
  return base;
}
function reachRadiusM(scene) {
  // Potion of Reach (T2 consumable): for its duration the whole visible view
  // is lit + reachable, regardless of energy. The radius covers the furthest
  // drawn cell — render.js darkens cells from -1..VIEW_CELLS (offsets -6..6
  // from the centre), so the far corner sits at √2·6·cellM ≈ 42 m; VIEW_CELLS·
  // cellM (55 m) clears it with margin so every on-screen cell reads as lit.
  if ((scene.save?.reachPotionUntil ?? 0) > Date.now()) {
    return VIEW_CELLS * scene.cellM;
  }
  const energy = scene.save?.energy ?? 0;
  if (energy <= 0) return 0;
  return reachCells(scene) * scene.cellM + 1;
}

// "Is this absolute cell within the player's reach?" Both drawCells (visual
// reach silhouette) and interact.js' cell-resolve tap test call this — keeps
// the lit area and the tap-accept area byte-identical regardless of intra-cell
// player position, FP drift, or rounding mode.
function cellInReach(scene, cellIX, cellIY) {
  const reachM = reachRadiusM(scene);
  if (reachM <= 0) return false;
  const p = playerReachCell(scene);
  // Whole cells from the reach cell — across a row whose grid differs, by
  // position (absCellDelta), never raw cellIX arithmetic.
  const d = absCellDelta(scene, p.cellIX, p.cellIY, cellIX, cellIY);
  const dx = d.dx * scene.cellM;
  const dy = d.dy * scene.cellM;
  return dx * dx + dy * dy <= reachM * reachM;
}

// ─── The lit boundary's corners ──────────────────────────────────────────────
// The reach silhouette is a staircase of whole cells, and the lightmap plateau
// (lighting.js draw()) draws its edge — the bright area's sharp boundary, and
// since Sep 2026 the tap affordance itself. Its corners are rounded by
// REACH_CORNER_PX — a smidge, so the edge reads as a shape rather than a grid.
// The rule lives here rather than in the pass that uses it because it used to
// have TWO readers: a white outline (render.js drawCells) was stroked over the
// same staircase, and the line could not be allowed to round a corner the
// light left square. The line is gone (the plateau is lit brightly enough to
// carry the affordance alone), so `shortenH` / `shortenV` — which said where a
// stroked EDGE stopped short of a round — went with it: a filled path needs no
// such thing, its arcTo does the shortening. What stays is the corner
// classification, which is the part that decides the SHAPE.
//
// Look at one corner of a reach cell with three flags:
//   h — the neighbour across the corner's VERTICAL edge (left / right) is out
//       of reach, i.e. that vertical edge is exposed
//   v — the neighbour across the corner's HORIZONTAL edge (above / below) is
//       out of reach, i.e. that horizontal edge is exposed
//   d — the DIAGONAL cell is in reach
// Then the corner is one of:
//   convex   both edges exposed — an OUTER corner, rounded off inside the cell.
//   fillet   the horizontal edge exposed, the cell beside lit and the diagonal
//            too — an INNER corner, where the diagonal cell's vertical edge
//            meets this cell's horizontal one. A fillet of radius R is added in
//            the empty cell above / below. The diagonal cell sees the same
//            corner with h and v swapped; only the cell whose HORIZONTAL edge
//            is exposed owns the fillet, so it is drawn once.
//   (else)   square — the edge runs straight through it.
const REACH_CORNER_PX = 2;
const ReachCorner = {
  R: REACH_CORNER_PX,
  convex: (h, v) => h && v,
  fillet: (h, v, d) => v && !h && d,
};

// ─── GPS ⇄ the local metre frame ─────────────────────────────────────────────
// The world is drawn in Web-Mercator: every tile, object and cell lives at
// `z=14 world px × mPerPx` metres, where mPerPx is frozen at the ORIGIN's
// latitude (app.js create()). So the only correct way to put a GPS fix on that
// map is to project it the same way — lon/lat → world px → metres.
//
// The old conversion was a flat lat/lon → metres approximation anchored at the
// origin. It agrees with Mercator AT the origin and drifts as you walk away
// from it, because Mercator's scale grows with latitude: ~2 m out at 5 km
// north, ~17 km out for a save still anchored at the default home while its
// player is a province away (home capture never landed). That drift is what
// stood a player somewhere they weren't — on their own map, and on the
// multiplayer wire, which is this same metre frame divided by mPerPx.
//
//   lonLatToLocalM(scene, lon, lat) — { x, y } in playerM's frame (metres from
//                                     the projection origin; + is east / south)
//   localMToLonLat(scene, mx, my)   — the exact inverse, { lon, lat }
function lonLatToLocalM(scene, lon, lat) {
  const p = WorldGen.lonLatToWorldPx(lon, lat, WorldGen.Z);
  return {
    x: p.x * scene.mPerPx - scene.startWorldM.x,
    y: p.y * scene.mPerPx - scene.startWorldM.y,
  };
}
function localMToLonLat(scene, mx, my) {
  const n = (1 << WorldGen.Z) * WorldGen.TILE_PX;
  const px = (scene.startWorldM.x + mx) / scene.mPerPx;
  const py = (scene.startWorldM.y + my) / scene.mPerPx;
  return {
    lon: px / n * 360 - 180,
    lat: Math.atan(Math.sinh(Math.PI * (1 - 2 * py / n))) * 180 / Math.PI,
  };
}
