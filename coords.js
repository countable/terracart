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

function worldMetersToAbsCell(scene, wmx, wmy) {
  const wx = scene.originPx.x + (wmx - scene.startWorldM.x) / scene.mPerPx;
  const wy = scene.originPx.y + (wmy - scene.startWorldM.y) / scene.mPerPx;
  const cellPxSize = 256 / scene.cellsPerTile;
  return {
    cellIX: Math.floor(wx / cellPxSize),
    cellIY: Math.floor(wy / cellPxSize),
  };
}

function absCellCenterMeters(scene, cellIX, cellIY) {
  const cellPxSize = 256 / scene.cellsPerTile;
  const wx = (cellIX + 0.5) * cellPxSize;
  const wy = (cellIY + 0.5) * cellPxSize;
  return {
    x: scene.startWorldM.x + (wx - scene.originPx.x) * scene.mPerPx,
    y: scene.startWorldM.y + (wy - scene.originPx.y) * scene.mPerPx,
  };
}

function cellKeyFromWorldMeters(scene, wmx, wmy) {
  const { cellIX, cellIY } = worldMetersToAbsCell(scene, wmx, wmy);
  return cellKeyFromAbsCell(cellIX, cellIY);
}
