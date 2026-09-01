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
//   sameAbsCell(scene, ax, ay, bx, by)       — do both points share a cell?
//   lonLatToLocalM(scene, lon, lat)          — a GPS fix in playerM's frame
//   localMToLonLat(scene, mx, my)            — and back out to lon/lat

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
// Reach depends on the Inner Light the player controls, dimmed by the dark as
// they descend. On the surface it starts at 2.5 cells and grows to 5.5 via the
// six +0.5-cell upgrades (save.reachUpgrades, 0..6) fed by the Magic Shrine and
// the wizard tower's Inner Light (see app.js). Underground the bubble is
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
  const dx = (cellIX - p.cellIX) * scene.cellM;
  const dy = (cellIY - p.cellIY) * scene.cellM;
  return dx * dx + dy * dy <= reachM * reachM;
}

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
