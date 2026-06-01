// Canonical coordinate helpers. All cross-module ABSOLUTE-cell keys flow
// through here so the tile-pixel basis used by drawCells and save-state
// stays unified (see CLAUDE.md / past coord-drift bugs).
//
// Depends on:
//   scene fields: startWorldM, mPerPx, originPx, cellsPerTile.
//
// Exports as globals:
//   cellKeyFromAbsCell(absIX, absIY)         — "ix_iy"
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

// SINGLE SOURCE OF TRUTH for the player's reach radius, in metres. Everything
// that asks "can the player reach here?" funnels through this — the visual
// silhouette (render.js drawCells), the cell-tap gate (cellInReach below), and
// the object/creature/treasure far-gate (interact.js tooFar) — so the lit area
// and every tap-accept test stay byte-identical and can't drift.
//
// Reach now STARTS at 2 cells and grows to 5 via the Magic Shrine: each of the
// six delivery-gated shrine reach upgrades (save.reachUpgrades, 0..6) adds half
// a cell (2 + 0.5×6 = 5). Below 30% energy you lose a full cell (floored at 1);
// at 0 energy you can't reach at all. The +1 m epsilon matches the historical
// 3-cell = 16 m radius, so the cardinal-N cell is always included with a hair
// of margin and the silhouette reads as a rounded diamond at every level.
function reachCells(scene) {
  const upgrades = scene.save?.reachUpgrades ?? 0;
  return Math.min(5, 2 + 0.5 * upgrades);
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
  const maxEnergy = scene.save?.maxEnergy ?? 100;
  let cells = reachCells(scene);
  // Below 30% energy reach shrinks by one whole cell (never below 1).
  if ((energy / maxEnergy) < 0.30) cells = Math.max(1, cells - 1);
  return cells * scene.cellM + 1;
}

// "Is this absolute cell within the player's reach?" Both drawCells (visual
// reach silhouette) and interact.js' cell-resolve tap test call this — keeps
// the lit area and the tap-accept area byte-identical regardless of intra-cell
// player position, FP drift, or rounding mode.
function cellInReach(scene, cellIX, cellIY) {
  const reachM = reachRadiusM(scene);
  if (reachM <= 0) return false;
  const p = playerReachCell(scene);
  const dx = (cellIX - p.cellIX) * scene.cellM;
  const dy = (cellIY - p.cellIY) * scene.cellM;
  return dx * dx + dy * dy <= reachM * reachM;
}
