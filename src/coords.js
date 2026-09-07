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
  const tilePx = WorldGen.TILE_PX;
  const tx = Math.floor(wx / tilePx);
  const ty = Math.floor(wy / tilePx);
  const cps = tilePx / scene.cellsPerTile;
  return { tx, ty, cx: (wx - tx * tilePx) / cps, cy: (wy - ty * tilePx) / cps };
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
  const baseCellIX = pc.tx * scene.cellsPerTile + Math.floor(pc.cx);
  const baseCellIY = pc.ty * scene.cellsPerTile + Math.floor(pc.cy);
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
// the wizard tower's Inner Light (see app.js) — trimmed by REACH_SCALE, the
// ambient light mask's own dial. Underground the bubble is
// smothered: each level down trims it by half a cell, floored at 1.5 so the
// immediate ring is always workable — so each descent both darkens the
// surroundings (render.js) AND tightens the lit reach. It does NOT shrink
// when merely tired; the special cases are the Potion of Reach (lights the
// whole view) and 0 energy (you can't reach at all).
// The +1 m epsilon keeps the cardinal cell included with a hair of margin so the
// silhouette reads as a rounded diamond at every level.
//
// REACH_SCALE dims only the SURFACE ladder (the base and every upgrade step)
// — the underground half-cell-per-level taper and its 1.5-cell safety floor
// stay absolute, so a deep cave is exactly as workable as it always was and
// the "half a cell less for every level you descend" tip stays true; the
// dial is felt as a smaller starting bubble that reaches the same floor a
// little sooner.
const REACH_SCALE = 0.85;   // -15% on the ambient light mask that shows reach
function reachCells(scene) {
  const upgrades = scene.save?.reachUpgrades ?? 0;
  const base = Math.min(5.5, 2.5 + 0.5 * upgrades) * REACH_SCALE;
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
