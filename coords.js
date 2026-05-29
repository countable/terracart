// Canonical coordinate helpers. All cross-module ABSOLUTE-cell keys flow
// through here so the tile-pixel basis used by drawCells and save-state
// stays unified (see CLAUDE.md / past coord-drift bugs).
//
// Depends on:
//   scene fields: startWorldM, mPerPx, originPx, cellsPerTile.
//
// Exports as globals:
//   cellKeyFromAbsCell(absIX, absIY)         — "ix_iy"
//   cellKeyFromWorldMeters(scene, wmx, wmy)  — "ix_iy"
//   worldMetersToAbsCell(scene, wmx, wmy)    — { cellIX, cellIY }
//   absCellCenterMeters(scene, cellIX, cellIY) — { x, y }

function cellKeyFromAbsCell(absIX, absIY) {
  return `${absIX}_${absIY}`;
}

// Pixel size of one game cell in z=14 tile-pixel space. One tile is
// WorldGen.TILE_PX (256) px wide and holds scene.cellsPerTile cells.
function cellPxSize(scene) {
  return WorldGen.TILE_PX / scene.cellsPerTile;
}

function worldMetersToAbsCell(scene, wmx, wmy) {
  const wx = scene.originPx.x + (wmx - scene.startWorldM.x) / scene.mPerPx;
  const wy = scene.originPx.y + (wmy - scene.startWorldM.y) / scene.mPerPx;
  const cps = cellPxSize(scene);
  return {
    cellIX: Math.floor(wx / cps),
    cellIY: Math.floor(wy / cps),
  };
}

function absCellCenterMeters(scene, cellIX, cellIY) {
  const cps = cellPxSize(scene);
  const wx = (cellIX + 0.5) * cps;
  const wy = (cellIY + 0.5) * cps;
  return {
    x: scene.startWorldM.x + (wx - scene.originPx.x) * scene.mPerPx,
    y: scene.startWorldM.y + (wy - scene.originPx.y) * scene.mPerPx,
  };
}

function cellKeyFromWorldMeters(scene, wmx, wmy) {
  const { cellIX, cellIY } = worldMetersToAbsCell(scene, wmx, wmy);
  return cellKeyFromAbsCell(cellIX, cellIY);
}

// Player's "reach origin" — the absolute cell the visual reach silhouette
// and every too-far gate measure distance from. X is the body cell column
// (no horizontal feet offset); Y is the FEET cell row (feetOffsetM south
// of the body), so the reach snaps when the visible feet cross a gridline.
// Returns { cellIX, cellIY }.
function playerReachCell(scene) {
  const wx = scene.originPx.x + scene.playerM.x / scene.mPerPx;
  const wy = scene.originPx.y + (scene.playerM.y + scene.feetOffsetM) / scene.mPerPx;
  const cps = cellPxSize(scene);
  return {
    cellIX: Math.floor(wx / cps),
    cellIY: Math.floor(wy / cps),
  };
}

// One source of truth for "is this absolute cell within the player's reach?"
// Both drawCells (visual reach silhouette) and interact.js' cell-resolve tap
// test call this — keeps the lit area and the tap-accept area byte-identical
// regardless of intra-cell player position, FP drift, or rounding mode.
function cellInReach(scene, cellIX, cellIY) {
  const p = playerReachCell(scene);
  const dx = (cellIX - p.cellIX) * scene.cellM;
  const dy = (cellIY - p.cellIY) * scene.cellM;
  return dx * dx + dy * dy <= scene.REACH_CELL_M * scene.REACH_CELL_M;
}
