// Per-frame draw pipeline — extracted from app.js. Owns the cell-grid paint
// (terrain, tilled overlay, road cobbles, reach silhouette, treasure X marks)
// and the dynamic sprite-pool dance for chests / planted / wild plants /
// creatures / labels / tier diamonds.
//
// The scene retains thin method forwarders (drawCells / drawObjects /
// renderPool / worldMetersToScreen / screenToWorldMeters) so existing call
// sites — including interact.js, the update() loop, and test/tests.js —
// continue to work without churn.
//
// Depends on:
//   app.js       — MapScene fields used per-frame (read unless noted):
//                    Graphics:   cellGfx, tierGfx
//                    Containers: terrainContainer, objectsContainer,
//                                padContainer, plantedContainer,
//                                creaturesContainer
//                    Pools:      cobblePool, noisePool, padPool,
//                                letterPool, objectPool, padPool,
//                                plantedPool, creaturePool, chestLabelPool
//                                (chestLabelPool may be pushed to)
//                    View:       viewCenterX/Y, viewLeft, viewTop, viewSize
//                    World:      startWorldM, playerM, cellM, tileEdgeM,
//                                cellsPerTile, feetOffsetM, REACH_CELL_M,
//                                originPx, mPerPx
//                    State:      tilledSet, placedRockSet, brokenRockSet,
//                                save (.foundTreasures, .planted, .picked,
//                                .caught, .opened, .tilled — and .tilled is
//                                written-back when self-healing orphaned
//                                tilled cells)
//                    Helpers:    playerToWorldCell, neighborNonRoadColor,
//                                absCellCenterMeters
//                    Phaser:     this.add, this.textures
//   worldgen.js  — WorldGen.tileCache, WorldGen.Z
//   crops.js     — (crop frame layouts via items.js)
//   textures.js  — BIOME_TEX, TILLED_COLOR, TILLED_VARIANTS, PAD_SHAPES
//   items.js     — CROP_SPRITE, CROP_ROW, CROPS_SHEET_COLS,
//                  SPRING_CROPS_COLS, MAX_GROWTH_STAGE
//   loot.js      — POI_CLASS_FALLBACK, CHEST_TIER_COLOR,
//                  padShapeKeyForPoi, chestTier, rusticifyName
//   save.js      — persistSave (used by drawCells self-heal path)
//   app.js consts — VIEW_CELLS, CELL_PX, COLORS, isTillable
//
// Exports as globals:
//   Render.drawCells(scene)
//   Render.drawObjects(scene)
//   Render.renderPool(scene, pool, container, list, configure)
//   worldMetersToScreen(scene, wmx, wmy) → { x, y }
//   screenToWorldMeters(scene, sx, sy)   → { x, y }
//
// (The scene also keeps one-line methods that forward to these — that's the
// pattern other scene code and tests use.)

const Render = {};

function worldMetersToScreen(scene, wmx, wmy) {
  const pWorldX = scene.startWorldM.x + scene.playerM.x;
  const pWorldY = scene.startWorldM.y + scene.playerM.y;
  return {
    x: scene.viewCenterX + ((wmx - pWorldX) / scene.cellM) * CELL_PX,
    y: scene.viewCenterY + ((wmy - pWorldY) / scene.cellM) * CELL_PX,
  };
}

function screenToWorldMeters(scene, sx, sy) {
  const dx = (sx - scene.viewCenterX) / CELL_PX * scene.cellM;
  const dy = (sy - scene.viewCenterY) / CELL_PX * scene.cellM;
  return {
    x: scene.startWorldM.x + scene.playerM.x + dx,
    y: scene.startWorldM.y + scene.playerM.y + dy,
  };
}

Render.renderPool = function renderPool(scene, pool, container, list, configure) {
  let i = 0;
  for (const item of list) {
    let s = pool[i];
    if (!s) {
      s = scene.add.sprite(0, 0, 'idle', 0);
      container.add(s);
      pool.push(s);
    }
    s.setVisible(true);
    configure(s, item);
    i++;
  }
  for (; i < pool.length; i++) pool[i].setVisible(false);
};

Render.drawCells = function drawCells(scene) {
  const g = scene.cellGfx;
  g.clear();
  const half = (VIEW_CELLS - 1) / 2;
  const pc = scene.playerToWorldCell();
  const fracX = pc.cx - Math.floor(pc.cx);
  const fracY = pc.cy - Math.floor(pc.cy);
  // Player's absolute cell index in the unified tile-pixel basis. All per-cell
  // state lookups (tilled, watered) must derive from this same basis or they'll
  // drift relative to the rendered cell positions.
  const baseCellIX = pc.tx * scene.cellsPerTile + Math.floor(pc.cx);
  const baseCellIY = pc.ty * scene.cellsPerTile + Math.floor(pc.cy);
  let cobbleIdx = 0;
  let noiseIdx = 0;
  let letterIdx = 0;
  // Road copiar.png is a 5x4 grid of 16×16 frames. Only frames 0-8, 10-11,
  // 15-16 contain art. Each road tier picks ONE frame so the same road class
  // reads visually consistent across cells; different tiers look distinct.
  //   - ROAD_LG (motorway/trunk/primary): frame 0 — biggest, densest cluster
  //   - ROAD_MD (secondary/tertiary):     frame 5 — medium cluster
  //   - ROAD (minor/service/street):      frame 1 — small cluster
  //   - PATH:                             frame 3 — single small pebble
  const ROAD_FRAME = { 7: 1, 13: 0, 14: 5 };
  const PATH_FRAME = 3;
  const ROAD = 7, ROAD_LG = 13, ROAD_MD = 14;
  const PATH = 8;
  const isRoad = (t) => t === ROAD || t === ROAD_LG || t === ROAD_MD;
  // Pre-compute a ring of cell types (VIEW_CELLS+4) — that's the visible 11×11
  // PLUS a 1-cell halo of pre-rendered cells (so the player never sees a black
  // gap at the viewport edge mid-step) PLUS another 1-cell halo for per-corner
  // rounding to read its diagonal neighbor.
  const RING = VIEW_CELLS + 4;
  const types = new Int8Array(RING * RING);
  for (let r = 0; r < RING; r++) {
    for (let c = 0; c < RING; c++) {
      const wcx = pc.cx + (c - 2 - half) + pc.tx * scene.cellsPerTile;
      const wcy = pc.cy + (r - 2 - half) + pc.ty * scene.cellsPerTile;
      const N = scene.cellsPerTile;
      const tx2 = Math.floor(wcx / N);
      const ty2 = Math.floor(wcy / N);
      // Integer-modulo for the local cell index — guard against FP drift that can
      // produce ix==N (out-of-bounds → silent grass fallback) at exact tile seams.
      const ix2 = ((Math.floor(wcx) % N) + N) % N;
      const iy2 = ((Math.floor(wcy) % N) + N) % N;
      const e2 = WorldGen.tileCache.get(`${WorldGen.Z}/${tx2}/${ty2}`);
      types[r * RING + c] = (e2 && e2.grid) ? (e2.grid[iy2 * N + ix2] || 0) : 0;
    }
  }
  const T = (c, r) => types[(r + 2) * RING + (c + 2)];   // c,r in -1..VIEW_CELLS (rendered range), -2..VIEW_CELLS+1 reads still valid for halo
  // Flat-only types (no tileset art) get rounded corners at zone boundaries.
  const FLAT_ROUNDABLE = new Set([3, 5, 7, 8, 9, 10, 11, 12, 13, 14]);   // water, residential, all roads, path, all buildings, rock
  const CORNER_R = 6;
  // Render a 1-cell halo beyond the visible VIEW_CELLS×VIEW_CELLS so the player
  // never sees a black bar at the viewport edge while sliding between cells.
  // The mask clips the halo to the visible viewport.
  for (let row = -1; row <= VIEW_CELLS; row++) {
    for (let col = -1; col <= VIEW_CELLS; col++) {
      const ox = col - half;
      const oy = row - half;
      // Per-cell state override: placed rockfruit rocks render as ROCK (10),
      // broken natural rocks revert to GRASS (0). cellKey here matches the
      // tile-pixel basis used for tilled / planted state.
      const _absIX = baseCellIX + ox;
      const _absIY = baseCellIY + oy;
      const _cellKey = cellKeyFromAbsCell(_absIX, _absIY);
      let type = T(col, row);
      if (scene.placedRockSet && scene.placedRockSet.has(_cellKey)) type = 10;
      else if (type === 10 && scene.brokenRockSet && scene.brokenRockSet.has(_cellKey)) type = 0;
      // For ROAD cells, inherit the color of the nearest non-road neighbor so the cobbles
      // sit on top of the surrounding zone (residential/grass/etc) instead of a hard gray strip.
      let color = COLORS[type] ?? 0x5fa84a;
      if (isRoad(type)) {
        const wcx = pc.cx + ox + pc.tx * scene.cellsPerTile;
        const wcy = pc.cy + oy + pc.ty * scene.cellsPerTile;
        color = scene.neighborNonRoadColor(wcx, wcy) ?? color;
      }
      const sx = Math.round(scene.viewCenterX + (ox - fracX + 0.5) * CELL_PX - CELL_PX / 2);
      const sy = Math.round(scene.viewCenterY + (oy - fracY + 0.5) * CELL_PX - CELL_PX / 2);

      // Per-corner rounding: a corner rounds only when both orthogonal neighbors AND the
      // diagonal are a different type (avoids notches between two already-square zones).
      // Sprite-art zones cover the full 32×32 box, so we skip rounding there entirely.
      let tl = 0, tr = 0, bl = 0, br = 0;
      if (FLAT_ROUNDABLE.has(type)) {
        const tn = T(col, row - 1), ts_ = T(col, row + 1);
        const tw = T(col - 1, row), te = T(col + 1, row);
        const tnw = T(col - 1, row - 1), tne = T(col + 1, row - 1);
        const tsw = T(col - 1, row + 1), tse = T(col + 1, row + 1);
        if (tn !== type && tw !== type && tnw !== type) tl = CORNER_R;
        if (tn !== type && te !== type && tne !== type) tr = CORNER_R;
        if (ts_ !== type && tw !== type && tsw !== type) bl = CORNER_R;
        if (ts_ !== type && te !== type && tse !== type) br = CORNER_R;
        // Paint diagonal-neighbor color in each rounded corner first so the pixels
        // revealed outside the curve are the correct adjacent-zone colour.
        if (tl) { g.fillStyle(COLORS[tnw] ?? 0x5fa84a, 1); g.fillRect(sx, sy, CORNER_R, CORNER_R); }
        if (tr) { g.fillStyle(COLORS[tne] ?? 0x5fa84a, 1); g.fillRect(sx + CELL_PX - CORNER_R, sy, CORNER_R, CORNER_R); }
        if (bl) { g.fillStyle(COLORS[tsw] ?? 0x5fa84a, 1); g.fillRect(sx, sy + CELL_PX - CORNER_R, CORNER_R, CORNER_R); }
        if (br) { g.fillStyle(COLORS[tse] ?? 0x5fa84a, 1); g.fillRect(sx + CELL_PX - CORNER_R, sy + CELL_PX - CORNER_R, CORNER_R, CORNER_R); }
      }
      g.fillStyle(color, 1);
      if (tl || tr || bl || br) {
        g.fillRoundedRect(sx, sy, CELL_PX, CELL_PX, { tl, tr, bl, br });
      } else {
        g.fillRect(sx, sy, CELL_PX, CELL_PX);
      }

      // (Building outlines are drawn in a second pass after every cell is
      // filled — drawing them inline gets overpainted by the next cell's
      // fillRect on the shared boundary, leaving missing segments.)

      // Tilled check — use the same tile-pixel basis as cell rendering.
      const absCellIX = baseCellIX + ox;
      const absCellIY = baseCellIY + oy;
      const tilledKey = cellKeyFromAbsCell(absCellIX, absCellIY);
      let isTilled = scene.tilledSet && scene.tilledSet.has(tilledKey);
      // Self-heal: if a cell is marked tilled but its actual terrain is non-tillable
      // (e.g. an old save where a GPS jump tilled an unloaded-then-building cell),
      // silently drop it — UNLESS a planted crop still references this cell. Removing
      // the tilled flag from under a live plant produces an "occupied: crop" orphan.
      if (isTilled && !isTillable(type)) {
        const cc = absCellCenterMeters(scene, absCellIX, absCellIY);
        const hasPlant = scene.save.planted.some(pp =>
          Math.abs(pp.x - cc.x) < 0.1 && Math.abs(pp.y - cc.y) < 0.1);
        if (!hasPlant) {
          scene.tilledSet.delete(tilledKey);
          scene.save.tilled = [...scene.tilledSet];
          persistSave(scene.save);
          isTilled = false;
        }
      }
      let isWatered = false;
      if (isTilled) {
        const c = absCellCenterMeters(scene, absCellIX, absCellIY);
        for (const pp of scene.save.planted) {
          if (pp.watered_t && Math.abs(pp.x - c.x) < 0.1 && Math.abs(pp.y - c.y) < 0.1) {
            isWatered = true; break;
          }
        }
      }

      // Repaint base color for tilled cells (yellow-brown soil, replaces underlying terrain color).
      if (isTilled) {
        g.fillStyle(TILLED_COLOR, 1);
        if (tl || tr || bl || br) {
          g.fillRoundedRect(sx, sy, CELL_PX, CELL_PX, { tl, tr, bl, br });
        } else {
          g.fillRect(sx, sy, CELL_PX, CELL_PX);
        }
      }

      // Procedural texture overlay for every ground cell.
      {
        const ns = scene.noisePool[noiseIdx++];
        const h = (absCellIX * 2246822519) ^ (absCellIY * 3266489917);
        let texKey = null;
        if (isTilled) {
          texKey = `tilled_${Math.abs(h) % TILLED_VARIANTS}`;
        } else {
          const spec = BIOME_TEX[type];
          if (spec) texKey = `biome${type}_${Math.abs(h) % spec.variants}`;
        }
        if (texKey) {
          ns.setTexture(texKey)
            .setPosition(Math.round(sx), Math.round(sy))
            .setVisible(true);
        } else {
          ns.setVisible(false);
        }
      }

      // Embossed road-name letter — one per road/path cell, low-alpha "carved" look.
      {
        const lt = scene.letterPool[letterIdx++];
        // Skip PATH (small 2-stone cobble) — too cramped for legible letters.
        if (!isTilled && isRoad(type)) {
          // Look up letter for this cell from its owning tile.
          const wcxL = pc.cx + ox + pc.tx * scene.cellsPerTile;
          const wcyL = pc.cy + oy + pc.ty * scene.cellsPerTile;
          const tx2 = Math.floor(wcxL / scene.cellsPerTile);
          const ty2 = Math.floor(wcyL / scene.cellsPerTile);
          const ix2 = Math.floor(wcxL - tx2 * scene.cellsPerTile);
          const iy2 = Math.floor(wcyL - ty2 * scene.cellsPerTile);
          const entry = WorldGen.tileCache.get(`${WorldGen.Z}/${tx2}/${ty2}`);
          const info = entry && entry.roadLetters && entry.roadLetters[`${ix2}_${iy2}`];
          if (info) {
            // Keep letters upright — rotating them per-segment makes them hard to read at small sizes.
            // Phaser Text textures include the font's internal padding (typically
            // baseline gap + a 1-2px buffer). y still nudged -2 to optically
            // centre the glyph in the cobble; x shifted +1 right of cell centre
            // so the letter rides the cobble rather than its left gutter.
            lt.setText(info.char).setPosition(sx + CELL_PX / 2 + 1, sy + CELL_PX / 2 - 2)
              .setRotation(0).setVisible(true);
          } else {
            lt.setVisible(false);
          }
        } else {
          lt.setVisible(false);
        }
      }

      // Cobblestone overlay — dense cluster for ROAD, sparse single pebble for PATH.
      {
        const cs = scene.cobblePool[cobbleIdx++];
        // Single frame per type — no per-cell randomization, so a road of one
        // class reads as one consistent surface across all its cells.
        const frame = isRoad(type) ? ROAD_FRAME[type]
                     : (type === PATH ? PATH_FRAME : null);
        if (frame != null && !isTilled) {
          cs.setFrame(frame)
            .setPosition(Math.round(sx + CELL_PX / 2), Math.round(sy + CELL_PX / 2))
            .setVisible(true);
        } else {
          cs.setVisible(false);
        }
      }

      // Subtle darker tint for watered tilled cells (just enough to read as damp soil).
      if (isWatered) {
        g.fillStyle(0x000000, 0.22);
        g.fillRect(Math.round(sx), Math.round(sy), CELL_PX, CELL_PX);
      }
    }
  }
  // Building outline pass — runs AFTER all cells are filled so a neighbour
  // cell's fillRect can't overpaint the shared boundary. For each building cell,
  // stroke each side whose 4-neighbour isn't itself a building.
  const isB = (t) => t === 9 || t === 11 || t === 12;
  // Pseudo-3D extrusion: building footprints are the "top surface", and the
  // south-facing edge of each building cell gets a 5px-tall darker wall projected
  // downward, painted on top of the row below. Other edges get a thin black tint
  // to keep the silhouette crisp.
  // Wall face = 40% brightness of the footprint colour (60% darker) — deep
  // shadow under the lit top surface, but with enough hue to read as the
  // building's own material rather than a generic dark stripe.
  const SOUTH_FACE_COLOR = { 9: 0x472d24, 11: 0x3c2e22, 12: 0x36373a };
  // Houses get a 4px wall + 1px silhouette outline. Civic slabs (LARGE) keep
  // the thicker 5px wall and 3px outline to read at their bigger footprint scale.
  const SOUTH_FACE_PX = { 9: 4, 11: 4, 12: 5 };
  for (let row = -1; row <= VIEW_CELLS; row++) {
    for (let col = -1; col <= VIEW_CELLS; col++) {
      const type = T(col, row);
      if (!isB(type)) continue;
      const ox = col - half, oy = row - half;
      const sx = Math.round(scene.viewCenterX + (ox - fracX + 0.5) * CELL_PX - CELL_PX / 2);
      const sy = Math.round(scene.viewCenterY + (oy - fracY + 0.5) * CELL_PX - CELL_PX / 2);
      // Tier 11 (mid-rise) — palisade-fenced wood floor: pointed pickets along every
      // perimeter edge, no silhouette/extrusion. Drawn instead of tier 9/12 styling.
      if (type === 11) {
        const WOOD_BODY = 0xa67434, WOOD_SHADOW = 0x6b4520, WOOD_TIP = 0x3a240e;
        const PICKETS = 8, PW = 4;   // 8 pickets × 4px = 32px = CELL_PX
        // South: pickets stand below the cell, tips touching the cell edge.
        if (!isB(T(col, row + 1))) {
          for (let i = 0; i < PICKETS; i++) {
            const px = sx + i * PW;
            g.fillStyle(WOOD_BODY, 1);   g.fillRect(px, sy + CELL_PX, 3, 5);
            g.fillStyle(WOOD_SHADOW, 1); g.fillRect(px + 2, sy + CELL_PX, 1, 5);
            g.fillStyle(WOOD_TIP, 1);    g.fillRect(px + 1, sy + CELL_PX - 1, 1, 1);
          }
        }
        // North/East/West: 3px palisade-top strip with dark stripes between pickets.
        const stripeH = (x, y) => {
          g.fillStyle(WOOD_BODY, 1);   g.fillRect(x, y, CELL_PX, 3);
          g.fillStyle(WOOD_SHADOW, 1); g.fillRect(x, y + 2, CELL_PX, 1);
          g.fillStyle(WOOD_TIP, 1);
          for (let i = 1; i < PICKETS; i++) g.fillRect(x + i * PW - 1, y, 1, 3);
        };
        const stripeV = (x, y) => {
          g.fillStyle(WOOD_BODY, 1);   g.fillRect(x, y, 3, CELL_PX);
          g.fillStyle(WOOD_SHADOW, 1); g.fillRect(x + 2, y, 1, CELL_PX);
          g.fillStyle(WOOD_TIP, 1);
          for (let i = 1; i < PICKETS; i++) g.fillRect(x, y + i * PW - 1, 3, 1);
        };
        if (!isB(T(col, row - 1))) stripeH(sx, sy);
        if (!isB(T(col - 1, row))) stripeV(sx, sy);
        if (!isB(T(col + 1, row))) stripeV(sx + CELL_PX - 3, sy);
        continue;
      }
      // South wall: tier-specific extrusion, darker shade of the building tier.
      if (!isB(T(col, row + 1))) {
        g.fillStyle(SOUTH_FACE_COLOR[type] || 0x444444, 0.95);
        g.fillRect(sx, sy + CELL_PX, CELL_PX, SOUTH_FACE_PX[type] || 4);
      }
      // Outer border — fillRect for independent H (4 px) / V (2 px) thickness.
      // Vertical bars start below the top bar so corners are never double-painted
      // (double 50% alpha at the same pixel makes corners darker / look rounded).
      const B = 1;               // left / right border: 1 px
      const BT = type === 12 ? 2 : 1;  // top border: 2 px for LARGE (castle), 1 px otherwise
      g.fillStyle(0x000000, 0.5);
      if (!isB(T(col, row - 1))) g.fillRect(sx,               sy, CELL_PX, BT);
      if (!isB(T(col - 1, row))) g.fillRect(sx,               sy, B, CELL_PX);
      if (!isB(T(col + 1, row))) g.fillRect(sx + CELL_PX - B, sy, B, CELL_PX);
    }
  }
  // Reach indicator — subtle white outline tracing only the outer edge of the
  // reachable area. The origin is the PLAYER'S CURRENT CELL CENTRE, not their
  // feet, so reach depends only on which cell they're standing in (3 cells in
  // each cardinal direction, always — independent of intra-cell position).
  // For each reachable cell, draw only the sides whose neighbour is NOT
  // reachable. Result is the staircase silhouette of the reach region.
  const R2 = scene.REACH_CELL_M * scene.REACH_CELL_M;
  // Reach is centred on the FEET CELL, not the body cell. The body sprite
  // renders at viewport centre (col=half, row=half), but its feet sit
  // feetOffsetM south. Centering the reach on the feet means the outline
  // snaps to a new row exactly when the visible feet cross a cell line —
  // not half a cell earlier (when the body crosses) as it used to.
  const feetCellsBelowBody = Math.floor(pc.cy + scene.feetOffsetM / scene.cellM) - Math.floor(pc.cy);
  const reachOriginRow = half + feetCellsBelowBody;
  const isReach = (col, row) => {
    const ox = col - half, oy = row - reachOriginRow;
    const dxM = ox * scene.cellM;
    const dyM = oy * scene.cellM;
    return dxM * dxM + dyM * dyM <= R2;
  };
  // Darken every cell OUTSIDE the reach area so the player's eye lands on
  // what's actionable. Done before the outline so the white border sits on
  // top of the dim band, not under it.
  g.fillStyle(0x000000, 0.22);
  for (let row = -1; row <= VIEW_CELLS; row++) {
    for (let col = -1; col <= VIEW_CELLS; col++) {
      if (isReach(col, row)) continue;
      const ox = col - half, oy = row - half;
      const sx = Math.round(scene.viewCenterX + (ox - fracX + 0.5) * CELL_PX - CELL_PX / 2);
      const sy = Math.round(scene.viewCenterY + (oy - fracY + 0.5) * CELL_PX - CELL_PX / 2);
      g.fillRect(sx, sy, CELL_PX, CELL_PX);
    }
  }
  g.lineStyle(3, 0xffffff, 0.3);
  for (let row = -1; row <= VIEW_CELLS; row++) {
    for (let col = -1; col <= VIEW_CELLS; col++) {
      if (!isReach(col, row)) continue;
      const ox = col - half, oy = row - half;
      const sx = Math.round(scene.viewCenterX + (ox - fracX + 0.5) * CELL_PX - CELL_PX / 2);
      const sy = Math.round(scene.viewCenterY + (oy - fracY + 0.5) * CELL_PX - CELL_PX / 2);
      const top = !isReach(col, row - 1);
      const bot = !isReach(col, row + 1);
      const lft = !isReach(col - 1, row);
      const rgt = !isReach(col + 1, row);
      if (top) g.lineBetween(sx, sy, sx + CELL_PX, sy);
      if (bot) g.lineBetween(sx, sy + CELL_PX, sx + CELL_PX, sy + CELL_PX);
      if (lft) g.lineBetween(sx, sy, sx, sy + CELL_PX);
      if (rgt) g.lineBetween(sx + CELL_PX, sy, sx + CELL_PX, sy + CELL_PX);
    }
  }

  // Grid lines align with cell edges. Cells are positioned at
  //   sx = viewCenterX + (ox - fracX) * CELL_PX  (cell center)
  //   left edge = sx - CELL_PX/2 = viewLeft + CELL_PX/2 + (j - fracX) * CELL_PX
  // so grid lines need the same +CELL_PX/2 offset.
  g.lineStyle(1, 0x000000, 0.08);
  const xShift = -fracX * CELL_PX + CELL_PX / 2;
  const yShift = -fracY * CELL_PX + CELL_PX / 2;
  for (let i = -1; i <= VIEW_CELLS + 1; i++) {
    const x = Math.round(scene.viewLeft + i * CELL_PX + xShift);
    const y = Math.round(scene.viewTop  + i * CELL_PX + yShift);
    g.lineBetween(x, scene.viewTop, x, scene.viewTop + scene.viewSize);
    g.lineBetween(scene.viewLeft, y, scene.viewLeft + scene.viewSize, y);
  }

  // Treasure marks — subtle X on the ground (unfound only).
  const pWorldX = scene.startWorldM.x + scene.playerM.x;
  const pWorldY = scene.startWorldM.y + scene.playerM.y;
  const halfM = (VIEW_CELLS / 2 + 1) * scene.cellM;
  const found = new Set(scene.save.foundTreasures || []);
  g.lineStyle(2, 0x2a1d10, 0.55);
  const drawX = (tr) => {
    if (!tr || found.has(tr.id)) return;
    const dx = tr.x - pWorldX, dy = tr.y - pWorldY;
    if (Math.abs(dx) > halfM || Math.abs(dy) > halfM) return;
    const cx = scene.viewCenterX + (dx / scene.cellM) * CELL_PX;
    const cy = scene.viewCenterY + (dy / scene.cellM) * CELL_PX;
    const s = 6;
    g.lineBetween(Math.round(cx - s), Math.round(cy - s), Math.round(cx + s), Math.round(cy + s));
    g.lineBetween(Math.round(cx + s), Math.round(cy - s), Math.round(cx - s), Math.round(cy + s));
  };
  // Treasure marks — only check the player's 3×3 tile neighbourhood. drawX
  // already culls by viewport, but iterating all cached tiles every frame
  // gets expensive once a session has visited many tiles.
  {
    const tpc = scene.playerToWorldCell();
    for (let dty = -1; dty <= 1; dty++) {
      for (let dtx = -1; dtx <= 1; dtx++) {
        const entry = WorldGen.tileCache.get(`${WorldGen.Z}/${tpc.tx + dtx}/${tpc.ty + dty}`);
        if (!entry) continue;
        drawX(entry.treasure);
        if (entry.parkingTreasures) for (const tr of entry.parkingTreasures) drawX(tr);
      }
    }
  }
};

Render.drawObjects = function drawObjects(scene) {
  // Resolve the starter shop id as soon as any tile with houses has loaded,
  // so the yellow tint can apply on first render (rather than waiting for the
  // player to actually tap a house). Cheap once memoized — early-out is the
  // null check inside ensureStarterShopId.
  if (!scene.save.starterShopId && scene.ensureStarterShopId) scene.ensureStarterShopId();
  const halfM = (VIEW_CELLS / 2 + 1) * scene.cellM;
  const pWorldX = scene.startWorldM.x + scene.playerM.x;
  const pWorldY = scene.startWorldM.y + scene.playerM.y;
  const objList = [], creatureList = [], plantedList = [];
  const pickedSet = new Set(scene.save.picked || []);
  // Cross-tile POI dedupe — MVT duplicates the same POI across adjacent tile borders, and
  // an OSM area POI can be represented multiple times with up to ~15m offsets. We dedupe
  // by ident (name || poiClass) + a distance check (< DEDUPE_R) instead of a fixed-bucket
  // hash, so near-duplicates at unfortunate coords still collapse.
  const DEDUPE_R2 = 40 * 40;
  const seenByIdent = new Map(); // ident → [{x, y}, ...]
  const isDupChest = (o) => {
    const ident = o.name || o.poiClass;
    if (!ident) return false;
    let list = seenByIdent.get(ident);
    if (list) {
      for (const p of list) {
        if ((p.x - o.x) * (p.x - o.x) + (p.y - o.y) * (p.y - o.y) < DEDUPE_R2) return true;
      }
    } else {
      list = [];
      seenByIdent.set(ident, list);
    }
    list.push({ x: o.x, y: o.y });
    return false;
  };
  // Iterate only the player's 3×3 tile neighbourhood instead of every entry
  // in WorldGen.tileCache. The cache grows unboundedly as the player walks —
  // a long-running session can hold 50+ visited tiles with ~50k objects each,
  // so iterating-all here was a per-frame O(visited-items) cost (this caused
  // the random hangs the user reported). 9 tiles strictly cover the 11-cell
  // viewport (a tile is `cellsPerTile` cells, far bigger than VIEW_CELLS).
  // Save.caught is rebuilt to a Set once per frame for O(1) lookups.
  const caughtSet = new Set(scene.save.caught);
  const pc = scene.playerToWorldCell();
  for (let dty = -1; dty <= 1; dty++) {
    for (let dtx = -1; dtx <= 1; dtx++) {
      const entry = WorldGen.tileCache.get(`${WorldGen.Z}/${pc.tx + dtx}/${pc.ty + dty}`);
      if (!entry) continue;   // tile not loaded yet
      if (entry.objects) {
        for (const o of entry.objects) {
          const dx = o.x - pWorldX, dy = o.y - pWorldY;
          if (Math.abs(dx) > halfM || Math.abs(dy) > halfM) continue;
          if (o.kind === 'chest' && isDupChest(o)) continue;
          // Picked flowers stay gone — skip rendering them.
          if (o.kind === 'flora' && o.id && pickedSet.has(o.id)) continue;
          objList.push({ o, dx, dy });
        }
      }
      if (entry.creatures) {
        for (const c of entry.creatures) {
          if (caughtSet.has(c.id)) continue;
          const dx = c.x - pWorldX, dy = c.y - pWorldY;
          if (Math.abs(dx) > halfM || Math.abs(dy) > halfM) continue;
          creatureList.push({ c, dx, dy });
        }
      }
      // Wild plants render as planted crops at the mature stage (col 4).
      if (entry.wildplants) {
        for (const wp of entry.wildplants) {
          if (pickedSet.has(wp.id)) continue;
          const dx = wp.x - pWorldX, dy = wp.y - pWorldY;
          if (Math.abs(dx) > halfM || Math.abs(dy) > halfM) continue;
          plantedList.push({ p: { x: wp.x, y: wp.y, crop: wp.crop, stage: MAX_GROWTH_STAGE, wildId: wp.id }, dx, dy });
        }
      }
    }
  }
  for (const p of scene.save.planted) {
    const dx = p.x - pWorldX, dy = p.y - pWorldY;
    if (Math.abs(dx) > halfM || Math.abs(dy) > halfM) continue;
    plantedList.push({ p, dx, dy });
  }
  // Placed rockfruit stones — overlay the produce icon on each cell in placedRockSet
  // so the player can see what's there. The cell terrain is already rendered as rock
  // (type 10) by drawCells; this adds the visual icon on top.
  if (scene.placedRockSet) {
    for (const key of scene.placedRockSet) {
      const [ixStr, iyStr] = key.split('_');
      const absIX = parseInt(ixStr, 10), absIY = parseInt(iyStr, 10);
      const { x, y } = absCellCenterMeters(scene, absIX, absIY);
      const dx = x - pWorldX, dy = y - pWorldY;
      if (Math.abs(dx) > halfM || Math.abs(dy) > halfM) continue;
      plantedList.push({ p: { x, y, crop: 'rockfruit', _placedRock: true }, dx, dy });
    }
  }
  // Placed scarecrows render as world objects — 3-cell-tall single image,
  // anchored at the base so it appears to stand on the cell. Pool reuses
  // objectPool slots so it integrates with depth-sort and viewport clip.
  const scarecrowList = (scene.save.scarecrows || []).map(sc => ({
    o: { kind: '_scarecrow', x: sc.x, y: sc.y, id: `scarecrow_${sc.x.toFixed(2)}_${sc.y.toFixed(2)}` },
    dx: sc.x - pWorldX, dy: sc.y - pWorldY,
  })).filter(item => Math.abs(item.dx) <= halfM && Math.abs(item.dy) <= halfM);

  // Filter out chopped trees and (already-)opened chests handled in inner loop above? Do it here.
  // Hide objects that are temporarily gone:
  //  - chopped trees
  //  - opened chests (the chest, its pad, label, and tier diamond all vanish
  //    until the chest refills — keyed by save.opened including o.id)
  const openedSet = new Set(scene.save.opened);
  // Trees flag o.chopped = true in-memory when the chop progress wheel completes
  // (cheap), AND now also persist into save.chopped so a tile re-rasterize
  // doesn't regrow them. Check both — save.chopped is the source of truth.
  const choppedSet = new Set(scene.save.chopped || []);
  const filteredObj = objList.filter(({ o }) =>
    !(o.kind === 'chest' && openedSet.has(o.id)) &&
    !(o.kind === 'tree'  && (o.chopped || choppedSet.has(o.id)))
  );
  // Merge in placed scarecrows so they go through the same sprite pool +
  // depth sort as other world objects. Their RENDER_SPEC entry (kind
  // '_scarecrow') anchors the pole base on the placement cell.
  for (const sc of scarecrowList) filteredObj.push(sc);
  filteredObj.sort((a, b) => a.dy - b.dy);
  // Per-kind render spec — `key` is the texture key (or fn(o) for variants),
  // `frame` (optional) picks a specific frame (literal | fn(o)), `origin`/`scale`
  // are passed straight to Phaser. Lookup-on-miss returns null and the sprite
  // hides — used for flora variants that haven't baked yet.
  // Lowtier chests (chestTier === 1) render the `box` sprite instead of the
  // chest sprite. The save.opened filter above already removes opened chests
  // from objList, so this branch only ever sees unopened ones.
  const _chestIsBox = (o) => {
    const tier = (typeof chestTier === 'function') ? chestTier(o.poiClass) : 2;
    return tier === 1;
  };
  // Cheap deterministic hash on a string id — used for mineralrock column pick.
  const _idHash = (id) => {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return h;
  };
  const MINERALROCK_COLS = 11;
  const RENDER_SPEC = {
    house:  { key: 'house', frame: 'front', origin: [0.5, 0.9],  scale: 0.6 },
    tower:  { key: 'tower',                  origin: [0.5, 0.95], scale: 1.0 },
    // Placed scarecrow — 32×32 image with the pole base at the bottom of the
    // sprite; origin (0.5, 1) anchors that base on the placement cell.
    _scarecrow: { key: 'scarecrow', origin: [0.5, 1.0], scale: 1.0 },
    tree:   { key: 'trees', frame: (o) => Phaser.Math.Clamp(o.variant || 2, 0, 4),
              origin: [0.5, 0.95], scale: 0.85 },
    chest:  { key: (o) => _chestIsBox(o) ? 'box' : 'chest',
              // box.png is single-frame; chest.png is 2-frame (0 closed, 1 open).
              // We only see unopened chests here, so frame 0 in both cases.
              frame: 0, origin: [0.5, 0.9], scale: 2.0 },
    fruittree: { key: (o) => `${o.species}_tree`, frame: 0,
              origin: [0.5, 0.95], scale: 0.85,
              after: (s, o) => {
                // Dim picked fruit trees so the player can see they haven't
                // re-ripened yet. Picked state lives in save.picked keyed by id.
                const picked = scene.save.picked && scene.save.picked.includes(o.id);
                s.setAlpha(picked ? 0.55 : 1);
              } },
    mineralrock: { key: 'mineralrock',
              // Sheet: 11 cols × 17 rows = 187 frames. Row picked by tier
              // (T1=row 0 … T7=row 12, step 2 so adjacent tiers look distinct),
              // col deterministic on id-hash so each rock stays visually stable.
              frame: (o) => {
                const row = Math.min(16, ((o.requiredTier || 1) - 1) * 2);
                const col = _idHash(o.id || '') % MINERALROCK_COLS;
                return row * MINERALROCK_COLS + col;
              },
              origin: [0.5, 0.9], scale: 1.6,
              after: (s, o) => {
                // Already-broken rocks (tracked by absolute-cell key in
                // brokenRockSet, same pattern as natural rocks in drawCells)
                // tint dark + half alpha so they read as "spent".
                const cellIX = Math.round((o.x - scene.startWorldM.x) / scene.cellM - 0.5);
                const cellIY = Math.round((o.y - scene.startWorldM.y) / scene.cellM - 0.5);
                const key = cellKeyFromAbsCell(cellIX, cellIY);
                const broken = scene.brokenRockSet && scene.brokenRockSet.has(key);
                s.setAlpha(broken ? 0.5 : 1);
                s.setTint(broken ? 0x555555 : 0xffffff);
              } },
    // Flora (flower decals) live ON the ground tile, not standing on it —
    // centre the sprite in the cell so the petals land where the cell does.
    flora:  { key: (o) => `flora_${o.deco}_${o.variant ?? 0}`,
              origin: [0.5, 0.5],  scale: 1.8 },
    // Magic Crafting Shrine — 48×48 altar sprite. Frame = current shrine
    // level so the altar visibly evolves as the player levels it up:
    //   L1 → frame 0  (plain stone)
    //   L7 → frame 6  (glowing high-rune altar)
    // Slightly larger than other objects so it reads as a landmark.
    shrine: { key: 'shrine',
              frame: (o) => {
                const lvl = Math.min(7, Math.max(1, scene.save.shrineLevel || 1));
                return lvl - 1;
              },
              origin: [0.5, 1.0], scale: 0.85 },
  };
  Render.renderPool(scene, scene.objectPool, scene.objectsContainer, filteredObj, (s, item) => {
    const { o, dx, dy } = item;
    const sx = scene.viewCenterX + (dx / scene.cellM) * CELL_PX;
    const sy = scene.viewCenterY + (dy / scene.cellM) * CELL_PX;
    const spec = RENDER_SPEC[o.kind];
    if (!spec) return;
    const texKey = typeof spec.key === 'function' ? spec.key(o) : spec.key;
    if (texKey == null || !scene.textures.exists(texKey)) { s.setVisible(false); return; }
    if (s.texture.key !== texKey) s.setTexture(texKey);
    if (spec.frame !== undefined) {
      const f = typeof spec.frame === 'function' ? spec.frame(o) : spec.frame;
      if (s.frame.name !== f) s.setFrame(f);
    }
    // Specialty-shop houses pick up a tint (sooty grey, red, etc.); the
    // table lives in shops.js so adding a new shop type is one-file work.
    // Starter-shop yellow overrides the specialty tint so the player can
    // spot the inaugural shop from a tile away.
    let tint = 0xffffff;
    if (o.kind === 'house') {
      if (scene.save.starterShopId && scene.save.starterShopId === o.id) {
        tint = 0xffe066;
      } else {
        tint = Shops.shopTint(o) || 0xffffff;
      }
    }
    s.setOrigin(spec.origin[0], spec.origin[1])
     .setScale(spec.scale)
     .setPosition(Math.round(sx), Math.round(sy))
     .setAlpha(1).setTint(tint);
    // Per-kind post-config hook — runs AFTER the generic alpha/tint reset so
    // hooks can override (e.g. mineralrock darkening, fruittree picked-dim).
    if (typeof spec.after === 'function') spec.after(s, o);
  });

  // POI shape-pads — each POI type gets a distinct concrete-pad SHAPE.
  // The chest sits in the shape's designated cell; the pad image is anchored
  // so that cell's centre lines up with the chest's ground point.
  // lowtier POIs (bus stops/intersections/fuel/etc.) skip the pad entirely.
  // Pads persist even when the chest is opened — only the chest itself disappears.
  const padList = [];
  for (const item of objList) {
    const { o, dx, dy } = item;
    if (o.kind !== 'chest') continue;
    const shapeKey = padShapeKeyForPoi(o.poiClass);
    if (!shapeKey) continue;
    const shape = PAD_SHAPES[shapeKey];
    if (!shape) continue;
    padList.push({ o, dx, dy, texKey: `pad_${shapeKey}`, shape });
  }
  Render.renderPool(scene, scene.padPool, scene.padContainer, padList, (s, item) => {
    const { o, dx, dy, texKey, shape } = item;
    const sx = scene.viewCenterX + (dx / scene.cellM) * CELL_PX;
    const sy = scene.viewCenterY + (dy / scene.cellM) * CELL_PX;
    if (s.texture.key !== texKey) s.setTexture(texKey);
    // Origin = the chest cell's centre within the pad image, so that the
    // pad's chest cell sits exactly at the chest's ground point (sx, sy).
    const [cc, cr] = shape.chest;
    s.setOrigin((cc + 0.5) / shape.cols, (cr + 0.5) / shape.rows)
     .setScale(1)
     .setPosition(Math.round(sx), Math.round(sy));
    // Pads persist even when the chest is opened — only the chest sprite + tier
    // diamond disappear. The pad always renders (objList includes opened chests).
    // Fully opaque — earlier 0.92 made pads read as slightly washed out
    // against the terrain underneath, which dulled the POI signage too.
    s.setAlpha(1);
    s.setTint(0xffffff);
  });

  // POI name labels above chests. One uniform style for all labels:
  // white text on a translucent grey bg, with a soft black drop shadow on
  // the text. Fallback labels (unnamed POIs) render smaller, with tighter
  // padding so they read as secondary descriptors.
  // Light stone tablet with vivid saturated blue writing. Clean and flat —
  // no glow, no chisel stroke — just bright royal blue on pale stone for
  // maximum legibility. ~5:1 contrast on the chosen tone (WCAG AA).
  const LABEL_BG       = 'rgb(202,206,212)';       // pale cool stone
  const LABEL_INK      = '#1a3fbf';                // vivid royal blue
  const LABEL_STROKE   = null;                     // no chisel highlight
  const LABEL_GLOW     = null;                     // no halo
  // Labels persist even on opened chests so the player can still read what the place is.
  const chestLabels = objList.filter(({ o }) =>
    o.kind === 'chest' && (o.name || POI_CLASS_FALLBACK[o.poiClass]));
  let li = 0;
  for (const item of chestLabels) {
    const { o, dx, dy } = item;
    const sx = scene.viewCenterX + (dx / scene.cellM) * CELL_PX;
    const sy = scene.viewCenterY + (dy / scene.cellM) * CELL_PX;
    let tx = scene.chestLabelPool[li];
    if (!tx) {
      tx = scene.add.text(0, 0, '', {
        font: 'bold 10px monospace',
        color: LABEL_INK, backgroundColor: LABEL_BG,
        padding: { x: 4, y: 3 },
      }).setOrigin(0.5, 0).setDepth(50);
      // Glow + stroke intentionally NOT applied — flat solid blue on stone
      // reads cleaner than the earlier chisel-and-halo variant.
      scene.objectsContainer.add(tx);
      scene.chestLabelPool.push(tx);
    }
    // Named POIs get their rusticified name; unnamed POIs fall back to a
    // class-based descriptor in brackets (e.g. "(Chapel)", "(Practice Field)").
    const isFallback = !o.name;
    const label = isFallback
      ? `(${POI_CLASS_FALLBACK[o.poiClass]})`
      : rusticifyName(o.name);
    // Anchored just below the chest sprite (chest bottom ≈ sy + 3 after origin+scale).
    tx.setText(label).setPosition(Math.round(sx), Math.round(sy + 4)).setVisible(true);
    // Switch font size + padding live: fallback labels are smaller.
    tx.setFontSize(isFallback ? 9 : 11);
    tx.setPadding(isFallback ? 2 : 3, isFallback ? 1 : 2);
    tx.setColor(LABEL_INK);
    tx.setBackgroundColor(LABEL_BG);
    // Always full opacity — opened chests keep their concrete-pad label
     // legible (per user: the dimmed-after-open look made closed shops read
     // as inactive). The opened/closed state is already conveyed by the
     // chest sprite frame + the tier-diamond disappearing.
    tx.setAlpha(1);
    li++;
  }
  for (; li < scene.chestLabelPool.length; li++) scene.chestLabelPool[li].setVisible(false);

  // Specialty-shop labels above small-house shops (markets / blacksmiths /
  // traders). Painted-wood signage — warm brown plank, deep-wood stroke
  // around each glyph, and a hard drop-shadow below the lettering so the
  // sign reads as carved/painted (NOT the glowing cyan rune tablets used
  // for POI chests). Lettering colour comes from Shops.shopInk so each
  // shop type's signage matches its house tint at a glance.
  const SHOP_INK_BG    = 'rgb(96,64,40)';            // warm dark wood plank
  const SHOP_STROKE    = '#2a1408';                  // near-black wood shadow around glyphs
  const SHOP_DROP      = 'rgba(0,0,0,0.65)';         // hard drop shadow under the sign
  const shopHouses = filteredObj.filter(({ o }) => o.kind === 'house' && Shops.shopLabel(o));
  let sli = 0;
  for (const item of shopHouses) {
    const { o, dx, dy } = item;
    const sx = scene.viewCenterX + (dx / scene.cellM) * CELL_PX;
    const sy = scene.viewCenterY + (dy / scene.cellM) * CELL_PX;
    let tx = scene.shopLabelPool[sli];
    if (!tx) {
      tx = scene.add.text(0, 0, '', {
        font: 'bold 9px monospace',
        backgroundColor: SHOP_INK_BG,
        padding: { x: 4, y: 2 },
        stroke: SHOP_STROKE, strokeThickness: 2,
      }).setOrigin(0.5, 1).setDepth(50);
      // Drop-shadow offset down-right with no blur so the sign reads as a
      // hung wooden plank, not a glowing rune. shadowFill=true paints the
      // shadow onto the glyph fill (and the wider stroke extends the
      // silhouette so the shadow visually sits behind the whole letter).
      tx.setShadow(1, 2, SHOP_DROP, 0, true, true);
      scene.objectsContainer.add(tx);
      scene.shopLabelPool.push(tx);
    }
    // House sprite origin is [0.5, 0.9] with scale 0.6 — its top sits roughly
    // height*0.6*0.9 above sy. Anchor the label just above that.
    tx.setText(Shops.shopLabel(o))
      .setColor(Shops.shopInk(o))
      .setPosition(Math.round(sx), Math.round(sy - 26))
      .setVisible(true);
    sli++;
  }
  for (; sli < scene.shopLabelPool.length; sli++) scene.shopLabelPool[sli].setVisible(false);

  // Chest tier indicators: chunky bordered diamond above each unopened chest.
  // Drawn into the top-most tierGfx layer so it ALWAYS reads above the chest sprite,
  // labels, and pads — never gets occluded.
  const chestObjs = filteredObj.filter(({ o }) => o.kind === 'chest');
  const g = scene.tierGfx;
  g.clear();
  for (const item of chestObjs) {
    const { o, dx, dy } = item;
    const sx = scene.viewCenterX + (dx / scene.cellM) * CELL_PX;
    const sy = scene.viewCenterY + (dy / scene.cellM) * CELL_PX;
    const tier = chestTier(o.poiClass);
    const color = CHEST_TIER_COLOR[tier];
    if (color == null) continue;   // tier 1 → no gem
    const cx = Math.round(sx - 1);
    const cy = Math.round(sy - 18);
    const r = 6;     // 20% smaller (was 8)
    // 1) Outer dark halo — fattens the diamond so it stands out on any bg.
    g.fillStyle(0x000000, 0.55);
    g.fillTriangle(cx, cy - (r + 2), cx + (r + 2), cy, cx, cy + (r + 2));
    g.fillStyle(0x000000, 0.55);
    g.fillTriangle(cx, cy - (r + 2), cx - (r + 2), cy, cx, cy + (r + 2));
    // 2) Filled coloured diamond — re-set fillStyle before each fillTriangle to
    // dodge a Phaser quirk where the state can be reset between calls.
    g.fillStyle(color, 1);
    g.fillTriangle(cx, cy - r, cx + r, cy, cx, cy + r);
    g.fillStyle(color, 1);
    g.fillTriangle(cx, cy - r, cx - r, cy, cx, cy + r);
    // 3) Thin black outline (1 px — was 2)
    g.lineStyle(1, 0x000000, 1);
    g.beginPath();
    g.moveTo(cx, cy - r); g.lineTo(cx + r, cy);
    g.lineTo(cx, cy + r); g.lineTo(cx - r, cy);
    g.closePath();
    g.strokePath();
  }

  Render.renderPool(scene, scene.plantedPool, scene.plantedContainer, plantedList, (s, item) => {
    const { p, dx, dy } = item;
    const sx = scene.viewCenterX + (dx / scene.cellM) * CELL_PX;
    const sy = scene.viewCenterY + (dy / scene.cellM) * CELL_PX;
    // Placed rockfruit stones use the produce-icon frame directly (col PRODUCE_COL)
    // rather than the in-world growth art. Stage clamping is skipped.
    if (p._placedRock) {
      const frame = (CROP_ROW['rockfruit'] ?? 4) * CROPS_SHEET_COLS + PRODUCE_COL;
      if (s.texture.key !== 'crops') s.setTexture('crops');
      s.setFrame(frame);
      s.setOrigin(0.5, 0.85).setScale(2).setPosition(Math.round(sx), Math.round(sy));
      return;
    }
    const stage = Math.min(MAX_GROWTH_STAGE, p.stage ?? 0);
    const ov = CROP_SPRITE[p.crop];
    if (ov && ov.custom) {
      // Custom-sheet wildplants. Some are single-frame (longgrass,
      // mushroom), others have N visual variants picked off a stable
      // per-item hash so the same world cell always renders the same
      // shell / pebble / etc. but the field reads as varied.
      if (s.texture.key !== ov.sheet) s.setTexture(ov.sheet);
      if (ov.variants && ov.variants > 1) {
        // Hash off the wildplant's stable _ix/_iy (or wildId for picked
        // entries) so the variant survives reloads.
        const h = ((p._ix ?? 0) * 73856093) ^ ((p._iy ?? 0) * 19349663)
                ^ ((p.wildId || '').length * 2654435761);
        s.setFrame(Math.abs(h) % ov.variants);
      } else {
        s.setFrame(0);
      }
    } else if (ov && ov.sheet === 'springcrops') {
      // Spring Crops: col 0 = seed (stage 0), cols 1..4 = growth (4 = mature).
      const frame = ov.row * SPRING_CROPS_COLS + stage;
      if (s.texture.key !== 'springcrops') s.setTexture('springcrops');
      s.setFrame(frame);
    } else {
      const row = CROP_ROW[p.crop] ?? 1;
      // In-world growth uses cols 0..5 of the crop's row.
      const frame = row * CROPS_SHEET_COLS + stage;
      if (s.texture.key !== 'crops') s.setTexture('crops');
      s.setFrame(frame);
    }
    // 16×16 frame, scale 2 = 32×32 display. Centre the sprite in its cell
    // (origin 0.5, 0.5) — the earlier (0.5, 0.85) "foot-anchor" was meant
    // for character-like sprites but on flat ground tiles (longgrass,
    // flowers, wildplants) it shifted the sprite 11 px above the cell
    // centre, which the user spotted as "not centered in tiles".
    s.setOrigin(0.5, 0.5).setScale(2).setPosition(Math.round(sx), Math.round(sy));
  });

  // Growth-timer corner badges: for a watered, still-growing crop, render the
  // minutes-until-next-stage in the top-left of its cell. ✓ when the timer
  // has expired (player just needs to tap to advance). Hidden for wildplants
  // (no watered_t), seeds (stage 0 + unwatered), and mature crops.
  // Uses a parallel Phaser.Text pool — Render.renderPool only creates sprites.
  const STAGE_HOLD_MS = 60 * 60 * 1000;
  const now = Date.now();
  const timerList = plantedList.filter(({ p }) =>
    !p.wildId && (p.stage ?? 0) < MAX_GROWTH_STAGE && p.watered_t);
  let ti = 0;
  for (const { p, dx, dy } of timerList) {
    let t = scene.plantedTimerPool[ti];
    if (!t) {
      // Origin (1,1) anchors the badge at its bottom-right — set once at pool
      // creation rather than every frame (it doesn't vary by item).
      t = scene.add.text(0, 0, '', {
        font: 'bold 9px ui-monospace, monospace',
        color: '#ffffff', backgroundColor: 'rgba(0,0,0,0.7)',
        padding: { x: 2, y: 1 },
      }).setOrigin(1, 1).setDepth(60);
      scene.plantedContainer.add(t);
      scene.plantedTimerPool.push(t);
    }
    const sx = scene.viewCenterX + (dx / scene.cellM) * CELL_PX;
    const sy = scene.viewCenterY + (dy / scene.cellM) * CELL_PX;
    const remaining = STAGE_HOLD_MS - (now - p.watered_t);
    const label = remaining <= 0 ? '✓' : String(Math.max(1, Math.ceil(remaining / 60000)));
    // Bottom-right of the tile, inset 1px so the badge sits just inside the
    // cell border (origin (1,1) was set at pool creation).
    t.setText(label)
     .setPosition(Math.round(sx + CELL_PX / 2 - 1), Math.round(sy + CELL_PX / 2 - 1))
     .setColor(remaining <= 0 ? '#a7ffb0' : '#ffffff')
     .setVisible(true);
    ti++;
  }
  for (; ti < scene.plantedTimerPool.length; ti++) scene.plantedTimerPool[ti].setVisible(false);

  // Heart overlay — a small 💗 floats above every tame (released_) creature
  // so the player can spot their pets at a glance. Pool is created lazily.
  scene._petHeartPool = scene._petHeartPool || [];
  const tameList = creatureList.filter(item => typeof item.c.id === 'string' && item.c.id.startsWith('released_'));
  let hi = 0;
  for (const item of tameList) {
    const { c, dx, dy } = item;
    const sx = scene.viewCenterX + (dx / scene.cellM) * CELL_PX;
    const sy = scene.viewCenterY + (dy / scene.cellM) * CELL_PX;
    let t = scene._petHeartPool[hi];
    if (!t) {
      t = scene.add.text(0, 0, '💗', { font: '10px ui-monospace, monospace' })
        .setOrigin(0.5, 1).setDepth(60);
      scene.creaturesContainer.add(t);
      scene._petHeartPool.push(t);
    }
    // Float the heart ~16 px above the creature's anchor point. Tame creatures
    // sit at origin (0.5, 0.9) so anchor.y is roughly the ground; the heart
    // hovers just above the body.
    t.setPosition(Math.round(sx), Math.round(sy) - 22).setVisible(true);
    hi++;
  }
  for (; hi < scene._petHeartPool.length; hi++) scene._petHeartPool[hi].setVisible(false);

  Render.renderPool(scene, scene.creaturePool, scene.creaturesContainer, creatureList, (s, item) => {
    const { c, dx, dy } = item;
    const sx = scene.viewCenterX + (dx / scene.cellM) * CELL_PX;
    const sy = scene.viewCenterY + (dy / scene.cellM) * CELL_PX;
    if (c.kind === 'cow') {
      if (s.texture.key !== 'cow') { s.setTexture('cow'); s.play('cow-idle'); }
      s.setOrigin(0.5, 0.9).setScale(1.1).setPosition(Math.round(sx), Math.round(sy));
      s.setFlipX(!!c._faceFlip);
    } else if (c.kind === 'cat' || c.kind === 'dog') {
      // 32×32 RPG-Maker pet body sheet. Row 0 (frames 0..3) is the idle
      // cycle defined in app.js. Cat ~1.3 reads at proper "cat-size" next to
      // the cow; dog stays 1.0 since the sheet's frame fills more of its
      // 32×32 cell (dog is naturally chunkier than the cat sprite).
      const animKey = c.kind === 'cat' ? 'cat-idle' : 'dog-idle';
      const sc = c.kind === 'cat' ? 1.3 : 1.0;
      if (s.texture.key !== c.kind) { s.setTexture(c.kind); s.play(animKey); }
      s.setOrigin(0.5, 0.9).setScale(sc).setPosition(Math.round(sx), Math.round(sy));
      s.setFlipX(!!c._faceFlip);
    } else if (c.kind === 'deer') {
      // 32×32 sheet (see assets.js comment) → scale 1.1, matches cow.
      // Row 0 frames 0-1 are the side-view idle pose.
      if (s.texture.key !== 'deer') { s.anims?.stop(); s.setTexture('deer', 0); }
      s.setFrame(0);
      s.setOrigin(0.5, 0.9).setScale(1.1).setPosition(Math.round(sx), Math.round(sy));
      s.setFlipX(!!c._faceFlip);
    } else if (c.kind === 'rabbit') {
      // 16×16 sheet → 1.8× (a touch smaller than chicken — they're rabbits).
      if (s.texture.key !== 'rabbit') { s.anims?.stop(); s.setTexture('rabbit', 0); }
      s.setFrame(0);
      s.setOrigin(0.5, 0.9).setScale(1.8).setPosition(Math.round(sx), Math.round(sy));
      s.setFlipX(!!c._faceFlip);
    } else if (c.kind === 'crow') {
      // 32×32 sheet (see assets.js comment). Row 0 frames 0-4 are the ground
      // strut; row 1 is intentionally empty in the source PNG; row 2 is the
      // take-off flap. Float 14 px above the ground tile. Scale 1.3 reads as
      // a proper bird next to the cow rather than a tiny pebble.
      if (s.texture.key !== 'crow') { s.anims?.stop(); s.setTexture('crow', 0); }
      s.setFrame(0);
      s.setOrigin(0.5, 0.9).setScale(1.3).setPosition(Math.round(sx), Math.round(sy) - 14);
      s.setFlipX(!!c._faceFlip);
    } else if (c.kind === 'butterfly') {
      // 16×16 7-frame sheet → 2.0×, ~100 ms/frame.
      if (s.texture.key !== 'butterfly') { s.anims?.stop(); s.setTexture('butterfly', 0); }
      s.setFrame(Math.floor(performance.now() / 100) % 7);
      s.setOrigin(0.5, 0.9).setScale(2.0).setPosition(Math.round(sx), Math.round(sy) - 8);
      s.setFlipX(!!c._faceFlip);
    } else {
      // Chicken sheet is 16×16 (see assets.js note). Scale 1.5× lands it
      // around 24 px — visibly smaller than the cow (32×32 × 1.1 ≈ 35 px),
      // which matches the real-life size relationship. 2× looked huge
      // because chicken_red.png's per-frame chicken is bigger relative to
      // its cell than the cow's is.
      if (s.texture.key !== 'chicken') { s.setTexture('chicken'); s.play('chicken-idle'); }
      s.setOrigin(0.5, 0.9).setScale(1.5).setPosition(Math.round(sx), Math.round(sy));
      s.setFlipX(!!c._faceFlip);
    }
  });
};
