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

// Fallback fill for cells whose terrain type has no COLORS entry (and for the
// diagonal-neighbour colour painted into rounded corners). Matches the grass
// tone so an unmapped type reads as a green field rather than a black gap.
const GRASS_FALLBACK_COLOR = 0x479757;   // matches COLORS[0] grass (shore-matched)

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

// Hide every pooled sprite from startIdx onward — the trailing slots a render
// pass didn't reuse this frame. Centralizes the "drain the rest of the pool"
// loop that each manual render block repeats.
function hidePoolFrom(pool, startIdx) {
  for (let i = startIdx; i < pool.length; i++) pool[i].setVisible(false);
}

// Swap a sprite's texture only when it differs — skips Phaser's redundant
// texture-rebind work on the common frame where the key is unchanged.
function setTextureIfDifferent(s, key) {
  if (s.texture.key !== key) s.setTexture(key);
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
  hidePoolFrom(pool, i);
};

Render.drawCells = function drawCells(scene) {
  const g = scene.cellGfx;
  g.clear();
  // Castle ramparts split across TWO layers so towers (objectsContainer) sort
  // correctly per edge: the FRONT (south) wall draws ABOVE objects (towers read
  // as standing behind it), while the BACK (north) wall + the E/W SIDE walls
  // draw BELOW objects (towers stand in front of the top wall; side walls sit
  // under everything). Both cleared in lockstep with cellGfx so nothing desyncs.
  const gf = scene.rampartFrontGfx || g;   // front (south) wall — ABOVE objects
  const gb = scene.rampartBackGfx  || g;   // back (north) + side walls — BELOW objects
  if (gf !== g) gf.clear();
  if (gb !== g && gb !== gf) gb.clear();
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
  // PIER (terrain code 23) — wooden walkway over water (OSM transportation:pier).
  // Reuses the cobblePool slot for the overlay sprite but swaps its texture
  // from 'cobble' to 'pier' (assets/Objects/Wilderness/Bridge Beach.png, 8×14 of
  // 16×16 frames). Frame 20 = row 2 col 4 = an interior tile of the continuous
  // plank-deck band (frames 16-23): 100% opaque wood, no baked-in water, no
  // gaps, no support posts — so it tiles edge-to-edge across adjacent pier
  // cells (vertical OR horizontal runs) as clean decking. The earlier choice
  // (frame 33) was a bridge-span tile with baked-in blue water + a diagonal
  // support leg + transparent holes, which rendered as fragmented "docks with
  // posts and water patches" instead of a solid walkway. Pier cells are NOT
  // roads (no road-letter labels) and NOT paths (no path-stone activation tint).
  const PIER = 23;
  const PIER_FRAME = 20;
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
  const FLAT_ROUNDABLE = new Set([3, 5, 7, 8, 9, 10, 11, 12, 13, 14, 25]);   // water, residential, all roads, path, all buildings, rock, cave wall
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
      // Broken rock cells used to revert to type 0 (grass) — that flipped
      // the cell green while the mineralrock-overlay 'after' hook
      // separately darkened the rock sprite. The visual mismatch
      // ("rubble" flash on a grass-coloured tile) confused players. Now
      // we keep type=10 so the broken cell still reads as rock terrain;
      // the dimmed mineralrock sprite alone signals "spent".
      // For ROAD cells, inherit the color of the nearest non-road neighbor so the cobbles
      // sit on top of the surrounding zone (residential/grass/etc) instead of a hard gray strip.
      let color = COLORS[type] ?? GRASS_FALLBACK_COLOR;
      if (isRoad(type) || type === PATH) {
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
        if (tl) { g.fillStyle(COLORS[tnw] ?? GRASS_FALLBACK_COLOR, 1); g.fillRect(sx, sy, CORNER_R, CORNER_R); }
        if (tr) { g.fillStyle(COLORS[tne] ?? GRASS_FALLBACK_COLOR, 1); g.fillRect(sx + CELL_PX - CORNER_R, sy, CORNER_R, CORNER_R); }
        if (bl) { g.fillStyle(COLORS[tsw] ?? GRASS_FALLBACK_COLOR, 1); g.fillRect(sx, sy + CELL_PX - CORNER_R, CORNER_R, CORNER_R); }
        if (br) { g.fillStyle(COLORS[tse] ?? GRASS_FALLBACK_COLOR, 1); g.fillRect(sx + CELL_PX - CORNER_R, sy + CELL_PX - CORNER_R, CORNER_R, CORNER_R); }
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
      // Tilling is a surface-only activity (cave floor isn't tillable). Gate the
      // overlay on depth 0 so surface farm plots don't bleed through onto the
      // underground levels directly below them (same GPS-mirrored cell coords).
      let isTilled = (scene.depth ?? 0) === 0 && scene.tilledSet && scene.tilledSet.has(tilledKey);
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
      // WATER (type 3) gets a Wang-autotile lookup instead of a procedural
      // variant: the cardinal-neighbour mask picks one of 9 frames from the
      // 'terrains' spritesheet so water-grass borders show hand-drawn edges
      // instead of a hard colour cut. Rare mask values (peninsula / strip /
      // isolated — 7 of 16) fall back to the centre fill. See
      // WATER_AUTOTILE_FRAME in textures.js for the mapping.
      //
      // Seam caveat: T() returns 0 (grass) for unloaded neighbour tiles, so
      // a water cell at a not-yet-loaded tile edge will briefly render the
      // wrong edge frame until the adjacent MVT tile arrives. Self-corrects
      // on the next frame after load — not worth special-casing today.
      {
        const ns = scene.noisePool[noiseIdx++];
        const h = (absCellIX * 2246822519) ^ (absCellIY * 3266489917);
        let texKey = null;
        let texFrame; // undefined = use whole-image; defined = sheet frame index
        if (isTilled) {
          texKey = `tilled_${Math.abs(h) % TILLED_VARIANTS}`;
        } else if (type === 3) {
          // 8-neighbour BLOB autotile (see WATER_BLOB in textures.js). Bit set
          // = that neighbour is also water. Convention: TL=1,T=2,TR=4,L=8,R=16,
          // BL=32,B=64,BR=128. The blob draws inner corners the old cardinal
          // Wang could not — closing the shore gaps.
          const W = (t) => (t === 3 ? 1 : 0);
          const mask = W(T(col - 1, row - 1)) * 1
                     + W(T(col,     row - 1)) * 2
                     + W(T(col + 1, row - 1)) * 4
                     + W(T(col - 1, row    )) * 8
                     + W(T(col + 1, row    )) * 16
                     + W(T(col - 1, row + 1)) * 32
                     + W(T(col,     row + 1)) * 64
                     + W(T(col + 1, row + 1)) * 128;
          texKey = 'autotiles';
          texFrame = WATER_BLOB[mask] ?? WATER_BLOB_CENTER;
        } else if (type === 2) {
          // SAND beaches — same 8-neighbour blob (SAND_BLOB in textures.js),
          // drawing grass edges where sand meets any non-sand neighbour. Sand
          // sits between grass and water; this rounds it off against everything
          // (a thin grass/wet strip at the waterline — the dedicated water↔sand
          // tiles are a later refinement). Bit set = neighbour is also sand.
          const S = (t) => (t === 2 ? 1 : 0);
          const mask = S(T(col - 1, row - 1)) * 1
                     + S(T(col,     row - 1)) * 2
                     + S(T(col + 1, row - 1)) * 4
                     + S(T(col - 1, row    )) * 8
                     + S(T(col + 1, row    )) * 16
                     + S(T(col - 1, row + 1)) * 32
                     + S(T(col,     row + 1)) * 64
                     + S(T(col + 1, row + 1)) * 128;
          texKey = 'autotiles';
          texFrame = SAND_BLOB[mask] ?? SAND_BLOB_CENTER;
        } else {
          // PATH cells render the biome they were painted over (recorded in
          // worldgen's pathUnder) so a footpath reads as stepping-stones on the
          // existing ground rather than carving out a path-coloured patch. The
          // cobble pebble overlay still draws on top (cobblePool below). Falls
          // back to the path's own base if there's no record or the under-biome
          // has no texture (e.g. commercial/industrial concrete pads).
          let baseType = type;
          if (type === PATH) {
            const N = scene.cellsPerTile;
            const txp = Math.floor(absCellIX / N);
            const typ = Math.floor(absCellIY / N);
            const lix = absCellIX - txp * N;
            const liy = absCellIY - typ * N;
            const e = WorldGen.tileCache.get(`${WorldGen.Z}/${txp}/${typ}`);
            const u = e && e.pathUnder && e.pathUnder[`${lix}_${liy}`];
            if (u != null && BIOME_TEX[u]) baseType = u;
          }
          const spec = BIOME_TEX[baseType];
          if (spec) texKey = `biome${baseType}_${Math.abs(h) % spec.variants}`;
        }
        if (texKey) {
          if (texFrame !== undefined) ns.setTexture(texKey, texFrame);
          else ns.setTexture(texKey);
          // setTexture changes the sprite's intrinsic width/height to match
          // the new frame. Procedural biome textures are baked at CELL_PX so
          // the original setDisplaySize(CELL_PX, CELL_PX) still produces the
          // right size, but the 'terrains' sheet frames are 16×16 — without
          // re-applying displaySize, water cells would render at half size.
          ns.setDisplaySize(CELL_PX, CELL_PX)
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
            // centre the glyph in the cobble; x sits at cell centre (the prior
            // +1 nudge read 1px too far right).
            lt.setText(info.char).setPosition(sx + CELL_PX / 2, sy + CELL_PX / 2 - 2)
              .setRotation(0).setVisible(true);
          } else {
            lt.setVisible(false);
          }
        } else {
          lt.setVisible(false);
        }
      }

      // Cobblestone overlay — dense cluster for ROAD, sparse single pebble for
      // PATH, wooden plank for PIER. All three share the cobblePool slot but
      // PIER swaps the sprite's texture from 'cobble' to 'pier' (Bridge Beach).
      {
        const cs = scene.cobblePool[cobbleIdx++];
        // Single frame per type — no per-cell randomization, so a road of one
        // class reads as one consistent surface across all its cells.
        const isPier = (type === PIER);
        const frame = isPier ? PIER_FRAME
                     : isRoad(type) ? ROAD_FRAME[type]
                     : (type === PATH ? PATH_FRAME : null);
        if (frame != null && !isTilled) {
          // Roads get bumped up 10% so the cobble cluster reads as a real
          // surface texture instead of pixel speckle. Paths + piers stay at
          // cell size — the plank art is meant to tile edge-to-edge across
          // adjacent pier cells, so upscaling would break the seam.
          const size = isRoad(type) ? CELL_PX * 1.10 : CELL_PX;
          // Named-path stones that the player has tapped / stepped onto
          // pick up a blue tint to signal progress. _isPathStoneActive
          // is null-safe (returns false in test mode or before save state
          // exists), so this check is always cheap. PIER is excluded —
          // piers are not named paths and the plank shouldn't tint blue.
          let tint = 0xffffff;
          if (type === PATH && typeof scene._isPathStoneActive === 'function') {
            const { tx: ctx, ty: cty } = scene.playerToWorldCell();
            // Cells outside the player's own tile fall back to the cell's
            // tile coords — paths span tile seams, and we want consistent
            // tinting across the boundary.
            const N = scene.cellsPerTile;
            const tx2 = Math.floor(absCellIX / N);
            const ty2 = Math.floor(absCellIY / N);
            if (scene._isPathStoneActive(tx2, ty2, absCellIX, absCellIY)) {
              tint = 0x88aaff;   // soft blue
            }
          }
          // Swap texture key — 'pier' for plank, 'cobble' for everything else.
          // Pool sprites are created with the 'cobble' texture so reassign
          // each frame; Phaser short-circuits if the key is already current.
          cs.setTexture(isPier ? 'pier' : 'cobble', frame);
          cs.setFrame(frame)
            .setDisplaySize(size, size)
            .setPosition(Math.round(sx + CELL_PX / 2), Math.round(sy + CELL_PX / 2))
            .setTint(tint)
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
      // Tier 12 (castle) — STONE RAMPART. The front (south) and back (north)
      // walls carry bold merlons that rise UP from the wall line with clear
      // crenel gaps, aligned across cells. The side (east/west) walls aren't
      // toothed — they read as a dashed shadow line hugging the wall edge, its
      // dashes on the same merlon grid so they line up with the crests.
      // Drawn INSTEAD of the tier-9/12 extrusion + outline below.
      if (type === 12) {
        const STONE_LITE = 0xb9bcc2, STONE_BODY = 0x8f9298,
              STONE_SHADOW = 0x5a5d63, STONE_DARK = 0x303134;
        // STONE_FACE — the tall extruded N/S wall faces use a darker stone than
        // the lit battlement tops (STONE_BODY), so the wall mass reads with depth
        // instead of looking washed-out/too-light against the light castle floor.
        const STONE_FACE = 0x7e8188;
        // STONE_SIDE — the E/W side-wall crenel dashes: a soft mid-grey (much
        // lighter than the old STONE_SHADOW) so the gaps between the side merlons
        // aren't harshly dark.
        const STONE_SIDE = 0x7a7d84;
        const MERLONS = 4, SPAN = CELL_PX / MERLONS;   // 8px span, divides the cell evenly so teeth tile
        const MW = 4, MOFF = (SPAN - MW) >> 1;         // 4px tooth centred → clear 4px crenel gaps
        const TOOTH_H = 4;       // merlon height ≈ tooth width (4px) — squat, proportioned crenel
        const CREN = 2;          // crenel-level wall (the gaps still show a low parapet)
        const WALL = 6;          // south wall-face height (the lit 3-D extrusion)
        // Ramparts split front vs back/side across two layers (gf above objects,
        // gb below) so towers sort per-edge. The wall stone is a light masonry
        // material that reads against the lighter castle floor.
        // Horizontal battlement crest: a low parapet at `baseY` with merlons
        // rising UP from it, drawn into the supplied graphics layer `gx`. Teeth
        // share the SPAN grid on every wall so front/back crenellations line up.
        const crestH = (gx, x, baseY) => {
          gx.fillStyle(STONE_BODY, 1);   gx.fillRect(x, baseY - CREN, CELL_PX, CREN);
          gx.fillStyle(STONE_SHADOW, 1); gx.fillRect(x, baseY - 1, CELL_PX, 1);
          for (let i = 0; i < MERLONS; i++) {
            const mx = x + i * SPAN + MOFF;
            gx.fillStyle(STONE_BODY, 1);   gx.fillRect(mx, baseY - TOOTH_H, MW, TOOTH_H);
            gx.fillStyle(STONE_LITE, 1);   gx.fillRect(mx, baseY - TOOTH_H, MW, 1);
            gx.fillStyle(STONE_SHADOW, 1); gx.fillRect(mx + MW - 1, baseY - TOOTH_H + 1, 1, TOOTH_H - 1);
          }
        };
        // South / front wall → FRONT layer (above objects). Darker extruded face
        // hangs BELOW the cell, grounded by a 1px dark shadow line at its far
        // (bottom) edge; the lit battlement crest rises up from the bottom edge.
        if (!isB(T(col, row + 1))) {
          gf.fillStyle(STONE_FACE, 1); gf.fillRect(sx, sy + CELL_PX, CELL_PX, WALL);
          gf.fillStyle(STONE_DARK, 1); gf.fillRect(sx, sy + CELL_PX + WALL - 1, CELL_PX, 1);
          crestH(gf, sx, sy + CELL_PX);
        }
        // North / back wall → BACK layer (below objects). Same tall extruded face
        // as the front, mirrored to rise ABOVE the cell's top edge, crest on top
        // so the back reads as tall as the front. No dark grounding line here: at
        // the TOP edge it read as an unwanted hard line, not a contact shadow.
        if (!isB(T(col, row - 1))) {
          gb.fillStyle(STONE_FACE, 1); gb.fillRect(sx, sy - WALL, CELL_PX, WALL);
          crestH(gb, sx, sy - WALL);
        }
        // Side walls → BACK layer (below objects). No protruding teeth; a light
        // stone edge hugs the wall with shadow dashes on the merlon span so they
        // align with the front/back crests. SIDE_W is the band thickness (4px).
        const SIDE_W = 4;
        const sideShade = (x, innerX) => {
          gb.fillStyle(STONE_BODY, 1);   gb.fillRect(x, sy, SIDE_W, CELL_PX);
          gb.fillStyle(STONE_SIDE, 1);
          for (let i = 0; i < MERLONS; i++) gb.fillRect(x, sy + i * SPAN + MOFF, SIDE_W, MW);
          // 1px darker line on the wall's INTERIOR edge so the side wall reads as
          // a distinct band instead of blurring into the adjacent floor / wall.
          gb.fillStyle(STONE_SHADOW, 1); gb.fillRect(innerX, sy, 1, CELL_PX);
        };
        if (!isB(T(col - 1, row))) sideShade(sx, sx + SIDE_W - 1);
        if (!isB(T(col + 1, row))) sideShade(sx + CELL_PX - SIDE_W, sx + CELL_PX - SIDE_W);
        continue;
      }
      // South wall: tier-specific extrusion, a darker shade of the building
      // tier colour projected one cell downward.
      if (!isB(T(col, row + 1))) {
        const hex = SOUTH_FACE_COLOR[type] || 0x444444;
        g.fillStyle(hex, 0.95);
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
  // feet, so reach depends only on which cell they're standing in (a fixed
  // number of cells in each cardinal direction — independent of intra-cell
  // position). For each reachable cell, draw only the sides whose neighbour is
  // NOT reachable. Result is the staircase silhouette of the reach region.
  // Visual reach: delegate to the shared cellInReach helper (coords.js)
  // so the lit area on screen and the tap-accept area in interact.js are
  // computed from the same integer-cell math. Earlier this path used a
  // local hypotenuse check against a separately computed feet-cell row,
  // and the user reported the leftmost lit cell occasionally flashing
  // "too far" — eliminating the duplicated math closes any way for the
  // two to drift (intra-cell fracY rounding, FP slop, basis mismatch).
  // cellInReach handles reach via coords.js reachRadiusM: 0 energy = no reach,
  // otherwise the radius is 2.5 cells growing to 5.5 via shrine upgrades, then
  // shrunk half a cell per level underground (floored at 1.5). isReach delegates
  // entirely so the visual outline and tap-accept are always byte-identical.
  const isReach = (col, row) => {
    const absIX = baseCellIX + (col - half);
    const absIY = baseCellIY + (row - half);
    return cellInReach(scene, absIX, absIY);
  };
  // Darken every cell OUTSIDE the reach area so the player's eye lands on
  // what's actionable. Done before the outline so the white border sits on
  // top of the dim band, not under it. Underground the dim is much stronger —
  // the lit reach area reads as a torch bubble in the surrounding dark rock —
  // and it deepens by half a step per level so each descent feels darker.
  const depth = scene.depth ?? 0;
  const dimAlpha = depth > 0 ? Math.min(0.88, 0.74 + 0.06 * (depth - 1)) : 0.22;
  g.fillStyle(0x000000, dimAlpha);
  for (let row = -1; row <= VIEW_CELLS; row++) {
    for (let col = -1; col <= VIEW_CELLS; col++) {
      if (isReach(col, row)) continue;
      const ox = col - half, oy = row - half;
      const sx = Math.round(scene.viewCenterX + (ox - fracX + 0.5) * CELL_PX - CELL_PX / 2);
      const sy = Math.round(scene.viewCenterY + (oy - fracY + 0.5) * CELL_PX - CELL_PX / 2);
      g.fillRect(sx, sy, CELL_PX, CELL_PX);
    }
  }
  // Underground the torch bubble itself is dimmer than full daylight — lay a
  // faint black wash over the lit reach cells too (the surrounding rock is far
  // darker still, so the bubble stays clearly readable). Deepens slightly per
  // level, like the surrounding dim, so descents feel progressively gloomier.
  if (depth > 0) {
    const litDim = Math.min(0.40, 0.26 + 0.03 * (depth - 1));
    g.fillStyle(0x000000, litDim);
    for (let row = -1; row <= VIEW_CELLS; row++) {
      for (let col = -1; col <= VIEW_CELLS; col++) {
        if (!isReach(col, row)) continue;
        const ox = col - half, oy = row - half;
        const sx = Math.round(scene.viewCenterX + (ox - fracX + 0.5) * CELL_PX - CELL_PX / 2);
        const sy = Math.round(scene.viewCenterY + (oy - fracY + 0.5) * CELL_PX - CELL_PX / 2);
        g.fillRect(sx, sy, CELL_PX, CELL_PX);
      }
    }
  }
  // Low energy tints the lit range pink — the Inner Light guttering as the
  // player tires. Energy doesn't shrink reach (coords.js reachRadiusM — only
  // depth does), but this pink wash is the cue that you're running low and
  // should rest before energy hits 0 (where you can't reach at all).
  // Skipped while a Potion of Reach pins the whole view lit (energy ignored).
  const energy = scene.save?.energy ?? 0;
  const maxEnergy = scene.save?.maxEnergy ?? 100;
  const potionLit = (scene.save?.reachPotionUntil ?? 0) > Date.now();
  if (!potionLit && energy > 0 && (energy / maxEnergy) < 0.30) {
    g.fillStyle(0xff5fa2, 0.16);
    for (let row = -1; row <= VIEW_CELLS; row++) {
      for (let col = -1; col <= VIEW_CELLS; col++) {
        if (!isReach(col, row)) continue;
        const ox = col - half, oy = row - half;
        const sx = Math.round(scene.viewCenterX + (ox - fracX + 0.5) * CELL_PX - CELL_PX / 2);
        const sy = Math.round(scene.viewCenterY + (oy - fracY + 0.5) * CELL_PX - CELL_PX / 2);
        g.fillRect(sx, sy, CELL_PX, CELL_PX);
      }
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
    const s = 5.1;   // 15% smaller than the old 6px; X is symmetric so the centroid (cx,cy) is unchanged.
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
        if (entry.extraTreasures) for (const tr of entry.extraTreasures) drawX(tr);
      }
    }
  }
};

Render.drawObjects = function drawObjects(scene) {
  // Resolve the starter shop id as soon as the spawn tile's houses have
  // loaded, so the trailer sprite + Home tint apply on first render (rather
  // than waiting for the player to tap a house). Runs every frame until it
  // locks in — not just while the id is unset — so a stale/far memo from an
  // older save repairs itself. Cheap once locked (the _starterShopOk early-
  // out inside ensureStarterShopId).
  if (scene.ensureStarterShopId) scene.ensureStarterShopId();
  // Re-inject the synthetic starter trailer (if any) into its owning tile —
  // worldgen never emits it, so it must be re-added after reloads / eviction.
  if (scene.ensureStarterTrailerObject) scene.ensureStarterTrailerObject();
  const halfM = (VIEW_CELLS / 2 + 1) * scene.cellM;
  const pWorldX = scene.startWorldM.x + scene.playerM.x;
  const pWorldY = scene.startWorldM.y + scene.playerM.y;
  // Per-object screen projection: world-meter delta (dx, dy from the player)
  // → screen pixels. Every sprite/label/diamond in this pass shares the exact
  // same projection, so define it once here (viewCenterX/Y, cellM, CELL_PX are
  // all in scope for the whole function).
  const project = (dx, dy) => ({
    sx: scene.viewCenterX + (dx / scene.cellM) * CELL_PX,
    sy: scene.viewCenterY + (dy / scene.cellM) * CELL_PX,
  });
  const objList = [], creatureList = [], plantedList = [];
  const pickedSet = new Set(scene.save.picked || []);
  // Deterministic chest dedupe by game cell. A chest's id is already cell-snapped
  // (`c_<roundedCellX>_<roundedCellY>`), so the same POI duplicated across adjacent
  // tiles — and any two chests that land in the same 5 m cell — collapse to a single
  // crate. The key is derived from world position, so *which* copy survives no longer
  // depends on tile-iteration or load order: that order-dependence is what made crates
  // blink in and out as you walked (worst in dense areas like Seattle where many
  // same-named/same-class POIs sit close together). We intentionally no longer collapse
  // distinct POIs that merely share a name within ~40 m — those are different crates and
  // now both stay visible.
  const seenCell = new Set();
  const cellKey = (o) => Math.floor(o.x / scene.cellM) + '_' + Math.floor(o.y / scene.cellM);
  const isDupChest = (o) => {
    const k = cellKey(o);
    if (seenCell.has(k)) return true;
    seenCell.add(k);
    return false;
  };
  // Iterate only the player's 3×3 tile neighbourhood instead of every entry
  // in WorldGen.tileCache. The cache grows unboundedly as the player walks —
  // a long-running session can hold 50+ visited tiles with ~50k objects each,
  // so iterating-all here was a per-frame O(visited-items) cost (this caused
  // the random hangs the user reported). 9 tiles strictly cover the 11-cell
  // viewport (a tile is `cellsPerTile` cells, far bigger than VIEW_CELLS).
  // Save.caught is rebuilt to a Set once per frame for O(1) lookups.
  const caughtSet = new Set(scene.save.caught || []);
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
  // Planted crops are tagged with the depth they were sown at (surface = 0 for
  // legacy saves). Only draw the ones that belong to the level you're standing
  // on, so surface farms don't render underground (and future cave crops won't
  // render on the surface).
  const _curDepth = scene.depth ?? 0;
  for (const p of scene.save.planted) {
    if ((p.depth ?? 0) !== _curDepth) continue;
    const dx = p.x - pWorldX, dy = p.y - pWorldY;
    if (Math.abs(dx) > halfM || Math.abs(dy) > halfM) continue;
    plantedList.push({ p, dx, dy });
  }
  // Placed rockfruit stones — overlay the produce icon on each cell in placedRockSet
  // so the player can see what's there. The cell terrain is already rendered as rock
  // (type 10) by drawCells; this adds the visual icon on top.
  if (scene.placedRockSet && _curDepth === 0) {
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
  // Placed campfires (burned from a coal) render like scarecrows — through the
  // shared object pool so they depth-sort and clip with everything else.
  const fireList = (scene.save.fires || []).map(fr => ({
    o: { kind: '_fire', x: fr.x, y: fr.y, id: `fire_${fr.x.toFixed(2)}_${fr.y.toFixed(2)}` },
    dx: fr.x - pWorldX, dy: fr.y - pWorldY,
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
  const pickedSetObj = new Set(scene.save.picked || []);
  const brokenRockSet = scene.brokenRockSet || new Set();
  const filteredObj = objList.filter(({ o }) =>
    !(o.kind === 'chest' && openedSet.has(o.id)) &&
    !(o.kind === 'tree'  && (o.chopped || choppedSet.has(o.id))) &&
    // Mined-out mineralrocks vanish. Previously they hung around as a
    // dimmed sprite that flashed "spent" on tap — now they just clear,
    // matching how chopped trees and opened chests already disappear.
    // save.brokenRocks still tracks them so re-rasterizing the tile
    // (cache evict + walk back) doesn't respawn them.
    !(o.kind === 'mineralrock' && brokenRockSet.has(o.id)) &&
    // Ground stacks vanish once picked up. Same key (save.picked) as the
    // wildplant pickup tracking, so existing UIs / saves don't grow a new field.
    !(o.kind === 'groundstack' && pickedSetObj.has(o.id))
  );
  // Merge in placed scarecrows so they go through the same sprite pool +
  // depth sort as other world objects. Their RENDER_SPEC entry (kind
  // '_scarecrow') anchors the pole base on the placement cell.
  for (const sc of scarecrowList) filteredObj.push(sc);
  for (const fr of fireList) filteredObj.push(fr);
  filteredObj.sort((a, b) => a.dy - b.dy);
  // Per-kind render spec — `key` is the texture key (or fn(o) for variants),
  // `frame` (optional) picks a specific frame (literal | fn(o)), `origin`/`scale`
  // are passed straight to Phaser. Lookup-on-miss returns null and the sprite
  // hides — used for variants that haven't baked yet.
  // Lowtier chests (chestTier === 1) render the `box` sprite instead of the
  // chest sprite. The save.opened filter above already removes opened chests
  // from objList, so this branch only ever sees unopened ones.
  const _chestIsBox = (o) => {
    if (o.crate) return true;   // starter supply crates always use the box sprite
    const tier = (typeof chestTier === 'function') ? chestTier(o.poiClass) : 2;
    return tier === 1;
  };
  // Coin-burst POIs (ATM + bicycle_parking): tapping them spills a burst of
  // collectible coins, so they render as a "pot of gold" instead of a chest.
  const _isCoinBurst = (o) => o.poiClass === 'atm' || o.poiClass === 'bicycle_parking';
  const MINERALROCK_COLS = 11;
  // Pick the themed-sprite role for a 'house' object. 'plain' falls back
  // to the generic 'house' texture (the tinted shared sprite). Order
  // matters: starter wins over tier wins over shopType — so a tier-11
  // fort that happens to also be the starter shop renders as a trailer.
  //
  // 'wreck' is the universal pre-restoration role for tier-9 houses:
  // any non-restored, non-starter, non-fort house renders as the wreck
  // sprite. Once the player feeds it the right materials at
  // shopInteract, it goes into save.restoredHouses and reverts to its
  // "true" role (plain / blacksmith / etc.).
  const _restored = scene.save.restoredHouses || {};
  const _houseTrueRole = (o) => {
    if (scene.save.starterShopId && scene.save.starterShopId === o.id) return 'trailer';
    if (o.tier === 11) return 'fort';
    // Frozen restore-order role: 'blacksmith' | 'trader' | 'market' | 'wizard',
    // or null → plain residential.
    const t = (typeof scene.houseShopRole === 'function') ? scene.houseShopRole(o) : null;
    return t || 'plain';
  };
  const _houseRole = (o) => {
    const trueRole = _houseTrueRole(o);
    // Forts (tier 11) and the starter trailer skip wreck status — forts
    // are civic structures, the trailer is the player's already-furnished
    // home. Everything else (plain residential + themed tier-9 shops) is
    // a wreck until restored.
    if (trueRole === 'fort' || trueRole === 'trailer') return trueRole;
    if (_restored[o.id]) return trueRole;
    return 'wreck';
  };
  // ── Tree size + fruit-tree growth helpers (shared by the specs below) ──
  // Four discrete in-game size tiers from the DeepForest crown size class —
  // the smallest ('bush') renders as a bush, the rest as trees. OSM trees (no
  // size) fall back to crown_m, then the flat species scale. (Authoritative
  // copy lives in util.js TREE_SIZE_MUL; treeScale() applies it.)
  const TREE_SIZE_MUL = { bush: 0.42, small: 0.64, medium: 1.15, large: 1.55 };
  // Fruit-tree life-cycle frames, in 32px-wide frame indices (sheets are sliced
  // 32×48 — see assets.js; each tree is a full 32px column, NOT 16). The Apple
  // and Peach sheets DON'T share a layout, so map each explicitly:
  //   apple (15 frames): 0 sprout, 2 young, 4 mature-green, 5 blossom, 7 fruiting (apples).
  //   peach (13 frames): 0 sprout, 2 young, 3 mature-green, 4 blossom, 5 fruiting (peaches).
  // (Higher frames are seasonal / stump / white-matte cells — NOT live trees.)
  const FRUIT_FRAMES = {
    apple: { grow: [0, 2, 4, 5, 7], fruit: 7, bare: 4 },
    peach: { grow: [0, 2, 3, 4, 5], fruit: 5, bare: 3 },
  };
  const _ftSpec = (o) => FRUIT_FRAMES[o.species === 'peach' ? 'peach' : 'apple'];
  const FRUIT_STAGE_MS = 3 * 60 * 1000;   // 3 min/stage → ~12 min sprout→fruit
  const FRUIT_RESPAWN_MS = 24 * 60 * 60 * 1000;   // fruit yields once per 24h
  // Growth stage 0..4 of a planted sapling from elapsed real time.
  const _ftStage = (o) => Math.min(4,
    Math.floor((Date.now() - (o.planted_t || 0)) / FRUIT_STAGE_MS));
  const _ftPicked = (o) => {
    const fp = scene.save.fruitPicked;
    const at = fp && fp[o.id];
    return at && Date.now() - at < FRUIT_RESPAWN_MS;
  };
  // Gentle hue nudge: lighten the sampled crown colour halfway to white so the
  // multiplicative tint shifts the sprite's hue without darkening it to mud.
  const _crownTint = (hex) => {
    if (typeof hex !== 'string' || hex[0] !== '#' || hex.length < 7) return 0xffffff;
    let r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    if (isNaN(r) || isNaN(g) || isNaN(b)) return 0xffffff;
    r = (r + 255) >> 1; g = (g + 255) >> 1; b = (b + 255) >> 1;
    return (r << 16) | (g << 8) | b;
  };

  const RENDER_SPEC = {
    // Houses pick their texture by role — the generic 'house' frame stays
    // as the fallback for plain residential. Themed sprites (sliced top-
    // left from NPC house sheets, see Objects/Houses/):
    //   - starter shop  → trailer    (the player's home/RV)
    //   - blacksmith    → blacksmith (forge with chimney + sign)
    //   - trader        → trader     (Fishman-style awning house)
    //   - fort tier 11  → fort       (the school — big civic stone building)
    // The 'house' texture is a tileset with a registered 'front' sub-frame;
    // the themed PNGs are single-image, so frame must be undefined for them.
    // Tint is suppressed for themed houses (the sprite is already distinct)
    // in the post-config block further down — see the `themedHouse` flag.
    house:  {
      key: (o) => {
        const role = _houseRole(o);
        if (role === 'plain')  return 'house';
        if (role === 'wizard') return 'shrine';   // wizard tower reuses wizard.png
        return `house_${role}`;
      },
      // Plain houses pick the 'front' sub-rect of the house tileset; wizard
      // towers pick the fully-restored top-row tower frame (frame 3) of the
      // shrine sheet; other themed PNGs are single-image (frame undefined).
      frame: (o) => {
        const role = _houseRole(o);
        if (role === 'plain')  return 'front';
        if (role === 'wizard') return 3;
        return undefined;
      },
      // Anchor the sprite by its BOTTOM-MIDDLE so the house's base sits on the
      // building footprint's centroid (the house x/y is that centroid) — the
      // body then rises north over the outline instead of floating off it.
      // dyPx nudges the base just BELOW the centroid; the taller wizard tower
      // is foot-seated at the cell's front edge like the standalone shrine.
      origin: [0.5, 1.0],
      dyPx: (o) => (_houseRole(o) === 'wizard' ? CELL_PX * 0.5 : 2),
      scale: (o) => {
        const role = _houseRole(o);
        // Fort PNG is ~3× the others — scale down so it still reads as a
        // building, not a wall. Plain / blacksmith / trader / trailer / wizard
        // share 0.6 so they look like neighbours from the same village.
        return role === 'fort' ? 0.35 : 0.6;
      } },
    // sy is the cell CENTRE, so a foot-anchored (0.95) tower drawn there floats
    // ~2/3 of a cell up into the tile above — leaving its collision cell (the
    // castle wall it stands on) exposed as an empty-looking blocked space below
    // it. Nudge the foot down to the cell's front (bottom) edge — same trick as
    // trees — so the tower stands inside its own single cell.
    tower:  { key: 'tower',                  origin: [0.5, 0.95], scale: 1.0, dyPx: CELL_PX * 0.5 - 2 },
    // Placed scarecrow — 48×48 image, centred in its cell (origin 0.5,0.5, no
    // foot nudge). scale 0.455 puts the figure at ~0.68 of a cell (48 × 0.455 ≈
    // 22px inside the 32px cell) — 30% larger than the old 0.35 it read too
    // small at, while still fitting inside its single cell (QC rule).
    _scarecrow: { key: 'scarecrow', origin: [0.5, 0.5], scale: 0.455, seat: true },
    // Cave staircase — baked 32×32 (one cell), centred. 'down' on the surface &
    // each cave level leads deeper; 'up' returns. Texture picked by direction.
    staircase: { key: (o) => (o.dir === 'up' ? 'stair_up' : 'stair_down'),
                 origin: [0.5, 0.5], scale: 1.0 },
    // Placed campfire — 16×32 art, foot-anchored near the logs so the flame
    // rises up out of the cell (like a small tree). The 6-frame sheet is cycled
    // by `frame` each render (~130 ms/frame) for a continuous flicker. scale 1.1
    // → ~18px wide, comfortably inside one 32px cell (QC: one-cell interactable).
    // Seat off the logs (seatFrame 0) so the flickering flame doesn't bob the
    // sprite vertically frame-to-frame; the flame still rises out the top.
    _fire: { key: 'bonfire',
             frame: () => Math.floor(performance.now() / 130) % 6,
             origin: [0.5, 0.82], scale: 1.1, dyPx: CELL_PX * 0.38, seat: true, seatFrame: 0 },
    // Per-polygon species — maple uses the original 32×48 sheet with the
    // variant->frame growth-stage pick. Pine/birch/mahogany use their own
    // sheets sliced 32×64 (see assets.js) so the WHOLE tree — canopy + trunk
    // + root base — fits in one frame. Column 3 is a full mature green tree
    // on every species sheet. Origin sits a touch above the very bottom
    // because the 64px frame includes a few px of empty space under the roots.
    tree:   { key: (o) => {
                // Smallest crown tier renders as a bush, not a tree.
                if (treeSizeClass(o) === 'bush') return 'bushes';
                if (o.species === 'pine')     return 'pine_tree';
                if (o.species === 'birch')    return 'birch_tree';
                if (o.species === 'mahogany') return 'mahogany_tree';
                return 'trees'; // maple (default)
              },
              frame: (o) => {
                // bushes.png frame 0 is the lush top-left green bush.
                if (treeSizeClass(o) === 'bush') return 0;
                if (o.species && o.species !== 'maple') return 3;
                // Maple sheet: frames 0 and 4 are STUMPS (cut/dead); only
                // 1=sprout, 2=young, 3=mature are live trees. Clamp to 1..3 so a
                // standing tree never renders as a stump. Detected trees carry a
                // real size class → always mature (frame 3); their variety comes
                // from the size-class scale, not the growth-stage frame.
                if (o.size) return 3;
                return Phaser.Math.Clamp(o.variant || 2, 1, 3);
              },
              origin: (o) => {
                if (treeSizeClass(o) === 'bush') return [0.5, 0.9];
                return (o.species && o.species !== 'maple') ? [0.5, 0.92] : [0.5, 0.95];
              },
              // Shared with the harvest gating in interact.js (util.treeScale)
              // so a tree's visual size and the axe tier it demands stay in
              // lockstep — bigger sprite, sturdier axe, more wood. treeScale
              // honours the discrete o.size crown class too. (One deliberate
              // exception: maples render 10% smaller via MAPLE_VISUAL_MUL while
              // their size class keys off the un-shrunk treeBaseScale, so the
              // visual shrink doesn't change a maple's axe tier or wood yield.)
              // Bushes use the 48×32 bushes sheet — render at a fixed small
              // scale (≈21px, comfortably inside one 32px cell) independent of
              // the species/canopy tree scale. Larger tiers use treeScale.
              scale:  (o) => treeSizeClass(o) === 'bush' ? 0.45 : treeScale(o),
              // Placement obeys the "one cell" rule via the seat pass (see the
              // render loop + src/sprite_layout.js): each tree is seated from
              // its trimmed art bounds so the trunk base sits 1px above the
              // cell's bottom edge (or centred when it fits) and the canopy
              // rises into the tiles above without spilling into the cell
              // below — automatically across species sheets (maple 32×48 vs
              // the 32×64 pine/birch/mahogany root padding) and size classes.
              seat: true,
              // Sampled crown colour → a subtle hue tint (DeepForest trees only).
              // Bushes are one uniform type — skip the per-tree crown tint so
              // every bush renders as the same plain green sprite (an odd
              // sampled colour otherwise made some bushes look broken).
              after: (s, o) => {
                if (o.crown_color && treeSizeClass(o) !== 'bush') s.setTint(_crownTint(o.crown_color));
              } },
    chest:  { key: (o) => _isCoinBurst(o) ? 'potofgold'
                        : (produceStandFor(o) ? 'market_stand'
                        : (_chestIsBox(o) ? 'box' : 'chest')),
              // box.png is single-frame; chest.png is 2-frame (0 closed, 1 open).
              // We only see unopened chests here, so frame 0 in both cases.
              // Coin-burst POIs (ATM + bicycle_parking) render the procedural
              // 'potofgold' canvas texture (textures.js makePotOfGoldTexture),
              // which is single-frame — so leave `frame` undefined for them,
              // exactly like the themed-house sprites. The pot art is already
              // gold, so no tint is applied. Produce stands pick the market_stand
              // awning frame for their product family (see produceStandFor).
              frame: (o) => { const st = produceStandFor(o);
                              return _isCoinBurst(o) ? undefined : (st ? st.frame : 0); },
              // Stand: 80×80 stall art, foot-anchored like a small house so its
              // body rises north over the POI cell.
              origin: (o) => produceStandFor(o) ? [0.5, 1.0]
                           : (_isCoinBurst(o) ? [0.5, 0.95] : [0.5, 0.9]),
              // Crate (box sprite) renders 15% smaller than the chest: 2.0 → 1.7.
              scale: (o) => produceStandFor(o) ? 0.6 : (_isCoinBurst(o) ? 1.4 : (_chestIsBox(o) ? 1.7 : 2.0)),
              dxPx: (o) => _isCoinBurst(o) ? 4 : 0,
              // The crate is foot-anchored (origin y 0.9), so shrinking it pulls
              // the art's centroid down toward that anchor. Lift the crate back
              // up by (0.5-0.9)·16·(1.7-2.0) = 1.92px so its centroid stays put.
              dyPx: (o) => produceStandFor(o) ? 2 : (_isCoinBurst(o) ? 8 : (_chestIsBox(o) ? -1.92 : 0)),
              // Plain chests + crates obey the "one cell" rule (centred); produce
              // stands and the pot-of-gold are structure-like and stay foot-anchored.
              seat: (o) => !produceStandFor(o) && !_isCoinBurst(o) },
    fruittree: { key: (o) => `${o.species === 'peach' ? 'peach' : 'apple'}_tree`,
              frame: (o) => {
                const fr = _ftSpec(o);
                if (o.planted) {
                  // Planted sapling grows through the art's life-cycle frames.
                  const st = _ftStage(o);
                  if (st >= 4 && _ftPicked(o)) return fr.bare;  // regrowing
                  return fr.grow[st];
                }
                // Wild (detected/orchard) trees are mature & fruiting; show the
                // fruitless mature frame briefly after a pick.
                return _ftPicked(o) ? fr.bare : fr.fruit;
              },
              origin: [0.5, 0.95],
              scale: (o) => {
                const base = 0.85;
                if (o.planted) return base * (0.5 + 0.125 * _ftStage(o));  // 0.5→1.0
                // Wild fruit trees always render at full (mature) size — their
                // o.size crown class no longer shrinks them.
                return base;
              },
              // Fruit trees stand 10% taller than their width — stretch Y only.
              // The seat pass measures the stretched art so the trunk base
              // still lands 1px above the cell edge.
              scaleYMul: 1.10,
              // Placement obeys the "one cell" rule (seat pass, src/sprite_layout.js).
              seat: true,
              after: (s, o) => {
                // Dim a wild tree only while its fruit is regrowing; a planted
                // sapling that hasn't matured yet is full-alpha (it's growing,
                // not picked).
                const dim = _ftPicked(o) && (!o.planted || _ftStage(o) >= 4);
                s.setAlpha(dim ? 0.7 : 1);
              } },
    mineralrock: { key: 'mineralrock',
              // Sheet: 11 cols × 17 rows = 187 frames. We restrict ourselves
              // to the SMALL rock variants only — other rows have boulder-
              // sized art that visibly bleeds past the 16 × 16 frame at
              // scale 1.6. Two safe pickranges:
              //   PLAIN → row 15, cols 3..6 (the four "nice vanilla" rocks
              //           the user identified; 4 vars). Used by cave rock AND
              //           T1 ore — T1 shows no visible ore, it's just plain
              //           rock that happens to yield a little copper.
              //   ORE   → row 0, the ore-stone per yield tier. The top row is
              //           ore stones in tier order starting at copper — copper
              //           col 0 (T2), iron 1 (T3), gold 2 (T4), platinum 3
              //           (T5), col 4 unused, crimson 5 (T6), frost 6 (T7) —
              //           so the rock you see matches the bar it drops.
              frame: (o) => {
                const tier = o.yieldTier || o.requiredTier || 1;
                // Cave rock and T1 ore both render as a plain rock variant.
                if (o.caveVariant != null || tier <= 1) {
                  const v = o.caveVariant != null
                    ? (o.caveVariant % 4)
                    : (((Math.round(o.x) + Math.round(o.y)) % 4) + 4) % 4;
                  return 15 * MINERALROCK_COLS + (3 + v);   // cols 3..6
                }
                // T2-T7 → ore-stone column. Index by yieldTier; col 4 is
                // skipped in the art (copper 0, iron 1, gold 2, platinum 3,
                // crimson 5, frost 6).
                const ORE_COL_BY_TIER = [0, 0, 0, 1, 2, 3, 5, 6];
                const col = ORE_COL_BY_TIER[tier] ?? 0;
                return 0 * MINERALROCK_COLS + col;
              },
              // Origin (0.5, 0.5) — centre the sprite in its cell. The
              // previous (0.5, 0.9) foot-anchor was meant for standing
              // creatures; on a flat ground-resting rock it shoved the
              // 26-display-px sprite ~11 px into the cell ABOVE, so rocks
              // read as off-centre by almost a whole cell.
              // Seat per the "one cell" rule — centres the small rock art in
              // its cell (the art sits low in the 16px frame). origin/dyPx
              // below are the no-SpriteLayout fallback.
              origin: [0.5, 0.5], scale: 1.6, seat: true },
    // Stone pillar — decorative stand-in for OSM utility poles / posts. The
    // SHORT 16×32 sprite at scale 1.0 is exactly one cell (CELL_PX = 32px)
    // tall, so it sits inside a single square cell, foot-anchored near the
    // cell's front edge. Purely decorative: no interact.js branch matches
    // 'pole', so taps fall through.
    // pillar.png's column art fills only the LEFT half of its 16px frame
    // (cols 0–8; 9–15 are transparent), so a frame-centred origin (0.5) drew
    // the pole shoved to one side ("right half only"). Anchor the origin at the
    // art's true horizontal centre (~0.25 of the frame) so the pole sits
    // centred on its cell.
    pole:   { key: 'pillar', origin: [0.25, 0.95], scale: 1.0, dyPx: CELL_PX * 0.4, seat: true },
    // Stone well — decorative landmark for OSM amenity=fountain points. The
    // 48×32 PNG's art is NOT frame-centred: its content occupies x:[2..36], so
    // its visual centre is at 19.5/48 ≈ 0.41, not 0.5 — anchoring at 0.5 shoved
    // the well ~6px left of its cell. originX 0.41 centres the well art on the
    // cell. originY 0.62 + dyPx CELL_PX*0.18 seats the squat well body on its
    // tile (a full foot-anchor floated it up). scale 1.18 trims it slightly so
    // it doesn't overspill its cell. Tap refills the watering can (interact.js).
    well:   { key: 'well', origin: [0.406, 0.62], scale: 0.9, dxPx: 6, dyPx: CELL_PX * 0.43 - 2, seat: true },
    // Magic Crafting Shrine — wizard's house 80×104 sprite, top-row frames
    // 0-3 (blue-ivy, purple-ivy, blue-clean, purple-clean). Pairs of shrine
    // levels share a frame so the tower visibly upgrades: L1-2→0, L3-4→1,
    // L5-6→2, L7→3 (fully restored).
    shrine: { key: 'shrine',
              frame: (o) => {
                const lvl = Math.min(7, Math.max(1, scene.save.shrineLevel || 1));
                return Math.min(3, Math.floor((lvl - 1) / 2));
              },
              origin: [0.5, 1.0], scale: 0.6, dyPx: CELL_PX * 0.5 },
    // Ground stack — an item id + qty sitting on the map. Texture +
    // frame come from inventoryIconSource(itemId) so any item with an
    // inventory icon can sit on the ground without per-kind plumbing.
    // For wood (the 4-frame stack sheet) we override the frame to
    // visualise stack size: frame = clamp(qty - 1, 0, 3).
    groundstack: {
      key: (o) => (inventoryIconSource(o.itemId) || {}).sheet || 'wood',
      frame: (o) => {
        // Wood sheet is 3 frames (brown / grey / amber log variants); the
        // frame cycles with qty so the sprite changes as the stack grows.
        if (o.itemId === 'wood') return Math.min(2, Math.max(0, (o.qty || 1) - 1));
        return (inventoryIconSource(o.itemId) || {}).frame ?? 0;
      },
      origin: [0.5, 0.9], scale: 1.8,
    },
  };
  // Soft contact shadows under buildings (houses + towers). Rendered into
  // shadowContainer — z-ordered just below objectsContainer — so each
  // building reads as resting on the ground rather than floating. The shadow
  // is a feathered dark ellipse placed at the building's ground foot, sized
  // to the building footprint (forts widest, towers slimmest).
  if (scene.shadowPool && scene.shadowContainer) {
    const shadowList = filteredObj.filter(({ o }) => o.kind === 'house' || o.kind === 'tower');
    Render.renderPool(scene, scene.shadowPool, scene.shadowContainer, shadowList, (s, item) => {
      const { o, dx, dy } = item;
      const { sx, sy } = project(dx, dy);
      setTextureIfDifferent(s, 'bldg_shadow');
      // The shadow ellipse is CENTRE-anchored (origin 0.5,0.5). Placing its
      // centre AT the sprite base (sy+2) therefore left the ellipse's whole
      // lower half — ~10px — dangling below the foot, reading as a detached
      // shadow on the ground with the house floating above it. Lift the centre
      // ABOVE the base so the bulk tucks behind/under the building and only a
      // thin contact crescent shows at the foot, grounding it. Taller/wider
      // buildings (fort) lift less since their footprint is broader.
      let w = CELL_PX * 1.5, dyFoot = -4;
      if (o.kind === 'tower') { w = CELL_PX * 1.1; dyFoot = 2; }
      else if (_houseRole(o) === 'fort') { w = CELL_PX * 2.4; dyFoot = -2; }
      s.setOrigin(0.5, 0.5)
       .setDisplaySize(w, w * 0.42)
       .setPosition(Math.round(sx), Math.round(sy) + dyFoot)
       .setAlpha(0.5).setTint(0xffffff);
    });
  }
  Render.renderPool(scene, scene.objectPool, scene.objectsContainer, filteredObj, (s, item) => {
    const { o, dx, dy } = item;
    const { sx, sy } = project(dx, dy);
    const spec = RENDER_SPEC[o.kind];
    if (!spec) return;
    const texKey = typeof spec.key === 'function' ? spec.key(o) : spec.key;
    if (texKey == null || !scene.textures.exists(texKey)) { s.setVisible(false); return; }
    setTextureIfDifferent(s, texKey);
    let frameVal;
    if (spec.frame !== undefined) {
      frameVal = typeof spec.frame === 'function' ? spec.frame(o) : spec.frame;
      if (s.frame.name !== frameVal) s.setFrame(frameVal);
    }
    // Specialty-shop houses pick up a tint (sooty grey, red, etc.); the
    // table lives in shops.js so adding a new shop type is one-file work.
    // Themed-sprite houses (blacksmith/trader/fort/trailer) DON'T tint —
    // the sprite itself signals the role; tinting would discolour the art.
    // Starter still gets the gold tint (in case the trailer sprite isn't
    // available the player still spots the inaugural shop), but the
    // themed-house branch already returned 'plain' for non-themed roles.
    let tint = 0xffffff;
    if (o.kind === 'house' && _houseRole(o) === 'plain') {
      tint = Shops.shopTint(o) || 0xffffff;
    }
    // Rare shiny flora — trees + fruit trees get the warm yellow sheen so the
    // player can spot a shiny harvest from across the tile.
    if ((o.kind === 'tree' || o.kind === 'fruittree') && isShiny(o.id, SHINY_RATE.tree)) {
      tint = SHINY_TINT;
    }
    // Per-biome tint for primary interactables (e.g. rusty mineralrock on an
    // industrial lot) — only when nothing more specific (shop/shiny) already
    // tinted it. The cell's terrain was stamped as `_biome` at worldgen time.
    // A spec.after hook (e.g. mineralrock tier shading) may still override.
    if (tint === 0xffffff && typeof BiomeProfiles !== 'undefined' && o._biome != null) {
      const bt = BiomeProfiles.tint(o._biome, o.kind);
      if (bt) tint = bt;
    }
    const scl = typeof spec.scale === 'function' ? spec.scale(o) : spec.scale;
    const origin = typeof spec.origin === 'function' ? spec.origin(o) : spec.origin;
    const scaleYMul = typeof spec.scaleYMul === 'function' ? spec.scaleYMul(o) : (spec.scaleYMul || 1);
    let dyPx = typeof spec.dyPx === 'function' ? spec.dyPx(o) : (spec.dyPx || 0);
    let dxPx = typeof spec.dxPx === 'function' ? spec.dxPx(o) : (spec.dxPx || 0);
    // "One cell" placement rule (single source of truth: src/sprite_layout.js).
    // Non-building world sprites are seated from their trimmed art bounds so
    // they sit centred in their cell — or, when taller than a cell, with the
    // bottom 1px above the cell's bottom edge — and never spill into the cell
    // below; horizontally always centred. seatFrame pins the bounds lookup to
    // a stable frame for animated sheets (e.g. the flickering bonfire) so the
    // art doesn't bob frame-to-frame.
    const wantSeat = typeof spec.seat === 'function' ? spec.seat(o) : spec.seat;
    const SL = (typeof window !== 'undefined' && window.SpriteLayout) || null;
    if (wantSeat && SL) {
      const bframe = spec.seatFrame !== undefined ? spec.seatFrame : (frameVal ?? 0);
      const bb = SL.ART_BOUNDS[`${texKey}:${bframe}`];
      if (bb) {
        const seat = SL.seatInCell(bb, origin[0], origin[1], scl, scl * scaleYMul);
        dxPx = seat.dxPx; dyPx = seat.dyPx;
      }
    }
    s.setOrigin(origin[0], origin[1])
     .setScale(scl, scl * scaleYMul)
     .setPosition(Math.round(sx) + dxPx, Math.round(sy) + dyPx)
     .setAlpha(1).setTint(tint);
    // Per-kind post-config hook — runs AFTER the generic alpha/tint reset so
    // hooks can override (e.g. mineralrock darkening, fruittree picked-dim).
    if (typeof spec.after === 'function') spec.after(s, o);
  });

  // POI pads — one rounded, slightly-oversized concrete slab under every
  // pad-bearing chest. The pad image is anchored so its cell centre lines up
  // with the chest's ground point (the slab spills ~10% past the cell).
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
    const { sx, sy } = project(dx, dy);
    setTextureIfDifferent(s, texKey);
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
  // 1px outline around the glyphs — same hue as the stone bg but 10%
  // darker (RGB × 0.9 → rgb(182,185,191)) so the text "sits in" the
  // tablet rather than floating on its surface.
  const LABEL_STROKE   = 'rgb(182,185,191)';
  const LABEL_STROKE_W = 1;
  // Labels persist even on opened chests so the player can still read what the place is.
  const chestLabels = objList.filter(({ o }) =>
    o.kind === 'chest' && (o.name || POI_CLASS_FALLBACK[o.poiClass]));
  let li = 0;
  for (const item of chestLabels) {
    const { o, dx, dy } = item;
    const { sx, sy } = project(dx, dy);
    let tx = scene.chestLabelPool[li];
    if (!tx) {
      tx = scene.add.text(0, 0, '', {
        font: 'bold 10px monospace',
        color: LABEL_INK, backgroundColor: LABEL_BG,
        stroke: LABEL_STROKE, strokeThickness: LABEL_STROKE_W,
        padding: { x: 4, y: 3 },
      }).setOrigin(0.5, 0).setDepth(50);
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
    // Lowtier crates (the `box` sprite) get white lettering with a soft drop
    // shadow and NO stone plank — the label floats over the crate like the
    // house signs do. Higher-tier chests keep the blue-on-stone tablet. The
    // pool is shared across both kinds, so set the full style every frame.
    if (_chestIsBox(o)) {
      tx.setColor('#ffffff');
      tx.setBackgroundColor(null);
      tx.setStroke('#000000', 0);
      tx.setShadow(1, 1, 'rgba(0,0,0,0.75)', 2, true, true);
    } else {
      tx.setColor(LABEL_INK);
      tx.setBackgroundColor(LABEL_BG);
      tx.setStroke(LABEL_STROKE, LABEL_STROKE_W);
      tx.setShadow(0, 0, 'rgba(0,0,0,0)', 0, false, false);
    }
    // Always full opacity — opened chests keep their concrete-pad label
     // legible (per user: the dimmed-after-open look made closed shops read
     // as inactive). The opened/closed state is already conveyed by the
     // chest sprite frame + the tier-diamond disappearing.
    tx.setAlpha(1);
    li++;
  }
  hidePoolFrom(scene.chestLabelPool, li);

  // Specialty-shop labels above small-house shops (markets / blacksmiths /
  // traders). Plain coloured glyphs with a dark stroke + hard drop shadow —
  // no background plank — so the lettering floats over the building art.
  // Lettering colour comes from Shops.shopInk so each shop type's signage
  // matches its house tint at a glance.
  const SHOP_STROKE    = '#2a1408';                  // near-black wood shadow around glyphs
  const SHOP_DROP      = 'rgba(0,0,0,0.65)';         // hard drop shadow under the sign
  // Starter shop labels as "Home" — it's no longer a shop, but the player
  // should still spot their base across the map. Shops.shopLabel() returns
  // null for non-shopType houses, so we wrap it here so the renderer can
  // also handle the starter case without changing the Shops module.
  // Display labels for the role-keyed shop signs. Restore-order roles no longer
  // track the street address, so the label comes from the role rather than
  // Shops.shopLabel (which is address-derived and would mislabel them).
  const _ROLE_LABEL = {
    blacksmith: 'Blacksmith', trader: 'Trader', market: 'Market', wizard: 'Wizard',
  };
  const _houseSignText = (o) => {
    // Wrecks have no sign — their identity is hidden until the player
    // restores them. Once _houseRole stops returning 'wreck', the
    // sign re-emerges with the correct shop / house label.
    if (_houseRole(o) === 'wreck') return null;
    if (scene.save.starterShopId && scene.save.starterShopId === o.id) return 'Home';
    // Forced scarecrow shop — signed only while it still has one to sell.
    // After the sale it reverts to its underlying role (handled below).
    if (scene.save.scarecrowShopId && scene.save.scarecrowShopId === o.id
        && !scene.save.scarecrowShopUsed) {
      return `Scarecrows ${Shops.toRoman((o.address ?? 0) + 1)}`;
    }
    // Frozen restore-order shop role (blacksmith / trader / market / wizard).
    const role = (typeof scene.houseShopRole === 'function') ? scene.houseShopRole(o) : null;
    if (role && _ROLE_LABEL[role]) {
      return `${_ROLE_LABEL[role]} ${Shops.toRoman((o.address ?? 0) + 1)}`;
    }
    // No specialty? Still give the building a label so the map reads as a
    // populated street instead of rows of anonymous huts. Roman-numeral
    // suffix from address+1 keeps consistency with the shop labels above.
    const roman = Shops.toRoman((o.address ?? 0) + 1);
    if (o.tier === 12) return `Castle ${roman}`;
    if (o.tier === 11) return `Fort ${roman}`;
    if (o.tier === 9) {
      // Plain residential — the delivery callout (wishlist icons while hungry,
      // a happy face once fed) is drawn by the DOM produce-sign overlay below,
      // not as emoji text. Fall back to a plain "House III" label only for
      // non-host tier-9 buildings that have no callout to show.
      if (_houseIsHost(o)) return null;   // the roof bubble handles it
      return `House ${roman}`;
    }
    return null;
  };
  // True if this house is a residential delivery host — a plain tier-9 home
  // (not a wreck, the player's own home, the starter smithy, a scarecrow shop,
  // or any specialty shop) that asks for produce bundles. Hosts always show a
  // roof callout: a wishlist while hungry, a happy face once fed for the day.
  const _houseIsHost = (o) => {
    if (!o || o.kind !== 'house' || o.tier !== 9) return false;
    if (_houseRole(o) === 'wreck') return false;                          // hidden until restored
    if (scene.save.starterShopId && scene.save.starterShopId === o.id) return false;             // Home
    if (scene.save.scarecrowShopId && scene.save.scarecrowShopId === o.id
        && !scene.save.scarecrowShopUsed) return false;                   // active scarecrow shop (text sign instead)
    // Any frozen shop role (blacksmith / trader / market / wizard, incl. the
    // starter smithy) is a storefront, not a residential delivery host.
    if (typeof scene.houseShopRole === 'function' && scene.houseShopRole(o)) return false;
    const wanted = (typeof scene.wantedProduce === 'function') ? scene.wantedProduce(o) : [];
    return wanted.length > 0;
  };
  // Sign ink for themed houses → matches the role's primary colour (same
  // hue we mix into the brick base under each one), so the label and the
  // foundation read as the same "house identity" at a glance. Plain houses /
  // forts / castles fall back to neutral inks below.
  const _ROLE_INK = {
    trailer:    '#a8b0c0',
    blacksmith: '#c25a3a',
    trader:     '#ffae5c',
    market:     '#5ddcc0',
    wizard:     '#b98cff',   // arcane violet
  };
  // Fallback inks for the non-specialty building kinds.
  const _CASTLE_INK = '#e0c060';   // gold — fits the "vault" flavor
  const _FORT_INK   = '#9aa49a';   // mossy stone — military
  const _HOUSE_INK  = '#d6c9a8';   // warm parchment — plain residential
  const _houseSignInk = (o) => {
    if (scene.save.starterShopId && scene.save.starterShopId === o.id) return _ROLE_INK.trailer;
    if (scene.save.scarecrowShopId && scene.save.scarecrowShopId === o.id
        && !scene.save.scarecrowShopUsed) return '#cdb07a';   // straw-gold scarecrow sign
    const t = (typeof scene.houseShopRole === 'function') ? scene.houseShopRole(o) : null;
    if (t && _ROLE_INK[t]) return _ROLE_INK[t];
    if (o.tier === 12) return _CASTLE_INK;
    if (o.tier === 11) return _FORT_INK;
    if (o.tier === 9)  return _HOUSE_INK;
    return Shops.shopInk(o);
  };
  // Lighten any #rgb / #rrggbb sign colour 30% toward white. Applied to every
  // house label so the whole set of signs reads a shade brighter against the
  // building art. Non-hex inputs pass through unchanged.
  const _lighten30 = (col) => {
    if (typeof col !== 'string' || col[0] !== '#') return col;
    let h = col.slice(1);
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    if (h.length !== 6) return col;
    const n = parseInt(h, 16);
    const r = (n >> 16) & 0xff, g = (n >> 8) & 0xff, b = n & 0xff;
    const lr = Math.round(r + (255 - r) * 0.30);
    const lg = Math.round(g + (255 - g) * 0.30);
    const lb = Math.round(b + (255 - b) * 0.30);
    return '#' + ((1 << 24) | (lr << 16) | (lg << 8) | lb).toString(16).slice(1);
  };
  const shopHouses = filteredObj.filter(({ o }) => o.kind === 'house' && _houseSignText(o));
  let sli = 0;
  for (const item of shopHouses) {
    const { o, dx, dy } = item;
    const { sx, sy } = project(dx, dy);
    let tx = scene.shopLabelPool[sli];
    if (!tx) {
      tx = scene.add.text(0, 0, '', {
        font: 'bold 9px monospace',
        stroke: SHOP_STROKE, strokeThickness: 2,
      }).setOrigin(0.5, 0).setDepth(50);
      // Drop-shadow offset down-right with no blur so the sign reads as a
      // hung wooden plank, not a glowing rune. shadowFill=true paints the
      // shadow onto the glyph fill (and the wider stroke extends the
      // silhouette so the shadow visually sits behind the whole letter).
      tx.setShadow(1, 2, SHOP_DROP, 0, true, true);
      scene.objectsContainer.add(tx);
      scene.shopLabelPool.push(tx);
    }
    // House sprite origin is [0.5, 0.9] — sy is roughly the building's foot.
    // Anchor the label TOP just below sy so the sign tucks under the
    // building, almost touching the doorstep (origin set to [0.5, 0] at
    // pool creation so position y = label top). +5 follows the house
    // sprite's own dyPx so the sign stays glued to the doorstep.
    tx.setText(_houseSignText(o))
      .setColor(_lighten30(_houseSignInk(o)))
      .setPosition(Math.round(sx), Math.round(sy + 7) + 5)
      .setVisible(true);
    sli++;
  }
  hidePoolFrom(scene.shopLabelPool, sli);

  // Residential delivery plaques — the wanted-produce wishlist drawn as real
  // item ICONS instead of emoji text. Uses the same mechanism as flashLoot's
  // loot icon: pooled <div>s appended to <body> (NOT #game, whose CSS
  // transform would become the containing block for position:fixed) and
  // projected over each house foot every frame against #game's scaled rect.
  // Icon contents are (re)built only when a house's wishlist or the display
  // scale changes; thereafter we just reposition. Cheap per frame.
  {
    const gameEl = document.getElementById('game');
    scene._produceSignPool = scene._produceSignPool || [];
    const pool = scene._produceSignPool;
    // Remove the DOM nodes when the scene tears down (Phaser pools die with
    // the scene, but these live in <body>, so clean them up explicitly).
    if (gameEl && !scene._produceSignCleanup) {
      scene._produceSignCleanup = true;
      // Reset the guard on teardown so the listeners re-register if the scene
      // is ever soft-restarted (no such path today, but cheap insurance —
      // otherwise a restarted scene would leak its <body> overlays).
      const drop = () => { for (const s of pool) s.el && s.el.remove(); pool.length = 0; scene._produceSignCleanup = false; };
      scene.events.once('shutdown', drop);
      scene.events.once('destroy', drop);
    }
    // While a full-screen dialog is open, suppress the wishlist callouts.
    // They live in <body> (z-index 4), but every modal is appended inside
    // #game, whose CSS transform makes it a stacking context with effective
    // z-index:auto — so the modal's higher internal z-index can NOT paint
    // over a positive-z-index body child, and the bubble pokes through the
    // dim. A correctly layered callout would sit under the modal dim
    // (invisible) anyway, so just hide them. Skipping the build loop leaves
    // psi at 0, so the hide-tail below collapses the whole pool. Add new
    // full-screen modal ids here if more are introduced.
    const MODAL_IDS = ['offer-modal', 'chest-reward-modal', 'message-modal', 'stats-modal'];
    const dialogOpen = MODAL_IDS.some((id) => document.getElementById(id));
    let psi = 0;
    if (gameEl && !dialogOpen) {
      const rect = gameEl.getBoundingClientRect();
      const scale = rect.width / W;            // uniform CSS scale (W = game px width)
      const ICON_GAME = 16;                    // per-icon side in game px (callout bubble)
      const sizePx = Math.max(8, Math.round(ICON_GAME * scale));  // displayed px
      // Paint one callout `parts` segment (see scene.roofCalloutSpec for the
      // segment vocabulary). Items render as real sprites; everything else is
      // small non-item chrome (emoji / qty / arrow / progress badges), all
      // sized off the icon scale so the bubble stays proportional.
      const buildCalloutPart = (part) => {
        if (part.t === 'icon') {
          return (scene.renderItemIcon && scene.renderItemIcon(part.id, sizePx, 'block'))
            || document.createElement('span');
        }
        if (part.t === 'emoji') {
          // Abstract, non-item glyphs (😊 / 🔒 / 🔆) — allowed as UI chrome (QC §1).
          const d = document.createElement('div');
          d.textContent = part.s;
          d.style.cssText = `font-size:${sizePx}px;line-height:1;`;
          return d;
        }
        if (part.t === 'qty' || part.t === 'text') {
          const d = document.createElement('div');
          d.textContent = part.s;
          d.style.cssText = `font:700 ${Math.max(7, Math.round(sizePx * 0.7))}px ui-monospace,monospace;`
            + 'color:#333;line-height:1;';
          return d;
        }
        if (part.t === 'arrow') {
          // Give→get marker for the trader barter (want → offer).
          const d = document.createElement('div');
          d.textContent = '→';
          d.style.cssText = `font-size:${Math.round(sizePx * 0.85)}px;line-height:1;color:#777;`;
          return d;
        }
        if (part.t === 'badges') {
          // A row of progress pips — filled = earned, hollow = still owed.
          const wrap = document.createElement('div');
          wrap.style.cssText = 'display:flex;gap:2px;align-items:center;';
          const d = Math.max(4, Math.round(sizePx * 0.5));
          for (let i = 0; i < (part.total || 0); i++) {
            const pip = document.createElement('div');
            pip.style.cssText = `width:${d}px;height:${d}px;border-radius:50%;`
              + (i < (part.filled || 0)
                  ? 'background:#e0c060;border:1px solid #b8943a;'      // earned — gold
                  : 'background:#ddd;border:1px solid #bbb;');          // owed — grey
            wrap.appendChild(pip);
          }
          return wrap;
        }
        return document.createElement('span');
      };
      for (const it of filteredObj) {
        // One source of truth for what floats over a building: roofCalloutSpec
        // returns null (no bubble) or { key, parts } — a delivery host's
        // wishlist / happy face, a sealed castle's unlock progress, a trader's
        // barter, or the wizard tower's Discovery demand. The renderer stays
        // dumb: it just paints the parts and memoizes on the key.
        const spec = scene.roofCalloutSpec ? scene.roofCalloutSpec(it.o) : null;
        if (!spec) continue;
        const { sx, sy } = project(it.dx, it.dy);
        let slot = pool[psi];
        if (!slot) {
          const el = document.createElement('div');
          // White rounded callout — a little speech bubble that floats above the
          // building roof (where the old open/busy pip used to sit). The downward
          // tail is a separate child triangle added during the content rebuild.
          el.style.cssText = 'position:fixed;left:0;top:0;display:flex;gap:3px;'
            + 'align-items:center;padding:3px 5px;background:#fff;border-radius:7px;'
            + 'border:1px solid rgba(0,0,0,0.18);box-shadow:0 1px 3px rgba(0,0,0,0.4);'
            + 'pointer-events:none;z-index:4;will-change:transform;';
          document.body.appendChild(el);
          slot = { el, key: null };
          pool.push(slot);
        }
        // Rebuild contents only when the spec key or the icon size changes — the
        // spec is memoized per building, so this is normally a no-op per frame.
        const key = spec.key + '|' + sizePx;
        if (slot.key !== key) {
          slot.el.replaceChildren();
          for (const part of spec.parts) slot.el.appendChild(buildCalloutPart(part));
          // Downward tail — a CSS triangle absolutely positioned at the bubble's
          // bottom centre so it points at the building. position:absolute keeps
          // it out of the flex flow, so it doesn't shift the content row.
          const tail = document.createElement('div');
          tail.style.cssText = 'position:absolute;left:50%;bottom:-5px;width:0;height:0;'
            + 'border-left:5px solid transparent;border-right:5px solid transparent;'
            + 'border-top:6px solid #fff;transform:translateX(-50%);'
            + 'filter:drop-shadow(0 1px 0 rgba(0,0,0,0.18));';
          slot.el.appendChild(tail);
          slot.key = key;
        }
        // Float the bubble ABOVE the building roof: translate(-50%,-100%) anchors
        // it by its bottom-centre at sy-18 — where the old open pip tucked — so
        // the bubble and its tail rise above the building like a callout.
        const px = rect.left + sx * scale;
        const py = rect.top  + (sy - 18) * scale;
        slot.el.style.transform = `translate(${Math.round(px)}px, ${Math.round(py)}px) translate(-50%, -100%)`;
        slot.el.style.display = 'flex';
        psi++;
      }
    }
    for (; psi < pool.length; psi++) pool[psi].el.style.display = 'none';
  }

  // Per-house readiness pip — sits just above each house / tower sprite and
  // shows either "✓ open" (this shop can take a deal right now) or "Xm"
  // (the wall-clock minutes until the hour bucket rolls over). Skipped for:
  //   • Castles + the starter blacksmith (dealCap=Infinity) — no busy state
  //     to communicate, so absence of a pip means "always open".
  //   • Unrestored wreck houses — they have no shop function until rebuilt,
  //     so the pip would read as a lie ("open" for a building you can't
  //     trade with). The restore modal is the affordance instead.
  // Styling: green ink on white plaque with a hard black border so the pip
  // reads against any biome colour, anchored top-left and offset 10 px
  // further left from the house's foot point.
  const houseObjs = filteredObj.filter(({ o }) => o.kind === 'house' || o.kind === 'tower');
  let hri = 0;
  for (const item of houseObjs) {
    const { o, dx, dy } = item;
    if (typeof scene.shopReadiness !== 'function') break;
    const info = scene.shopReadiness(o);
    // Unlimited-deal shops never need a "busy" badge; the absence of a pip
    // is itself the signal that they're always open. (Castles/towers and the
    // starter blacksmith report dealCap === Infinity here.)
    if (info.dealCap === Infinity) continue;
    // The player's own starting building (home / trailer) isn't a timed shop
    // to the player — no open/busy pip on your own house.
    if (scene.save.starterShopId && scene.save.starterShopId === o.id) continue;
    // Wrecks aren't shops yet — the pip would read as a contradiction.
    if (typeof scene._isHouseWreck === 'function' && scene._isHouseWreck(o)) continue;
    // Sealed castles (delivery gate not yet met) aren't open for business —
    // a "ready" pip would lie about the lock. (Castles report dealCap Infinity
    // and bail above, but keep this for safety.)
    if (typeof scene._isBuildingSealed === 'function' && scene._isBuildingSealed(o)) continue;
    // Locked forts (not yet unsealed with wood) aren't trading either — skip
    // the pip until the player pays the quartermaster.
    if (typeof scene._isFortLocked === 'function' && scene._isFortLocked(o)) continue;
    // Any building that floats a roof callout — a delivery host's wishlist, a
    // trader's barter, or the wizard tower's demand — owns the roofline where
    // this pip would sit (see the produce-sign block above), so it skips the
    // separate open/busy pip entirely to avoid stacking two plaques.
    if (typeof scene.roofCalloutSpec === 'function' && scene.roofCalloutSpec(o)) continue;
    const { sx, sy } = project(dx, dy);
    let tx = scene.shopReadyPool[hri];
    if (!tx) {
      // Small, quiet label — italic sans-serif at 8 px on a parchment-cream
      // plaque. Deliberately a different visual family from the house's
      // bold-monospace wooden sign hanging below it, so the two don't
      // compete: the name sign owns the building's identity, this label is
      // a secondary "open/closed" tag.
      tx = scene.add.text(0, 0, '', {
        font: 'italic 8px ui-serif, "Times New Roman", serif',
        padding: { x: 3, y: 1 },
      }).setOrigin(0.5, 1).setDepth(51);
      scene.objectsContainer.add(tx);
      scene.shopReadyPool.push(tx);
    }
    const label = info.ready ? 'open' : `${info.waitMin}m`;
    // Sepia ink on cream parchment for "open"; dim rust on cream for
    // "busy". Muted to read as a tag, not a callout.
    const ink = info.ready ? '#3a6b2f' : '#7a3838';
    tx.setText(label)
      .setColor(ink)
      .setBackgroundColor('#f3e9c6')
      // Origin (0.5, 1): y is the plaque's bottom. sy is the house's foot
      // anchor; sy - 20 tucks the tag just above the roofline. -10 on x
      // nudges it slightly off-centre so it reads as hanging from a
      // bracket on the left side rather than dead-centred on the gable.
      .setPosition(Math.round(sx) - 10, Math.round(sy) - 20)
      .setVisible(true);
    // Soft, low-opacity drop shadow so the tag looks like it hangs in
    // front of the building rather than being painted onto it. NOT the
    // hard 1-px outline of the previous version — that competed too
    // hard with the house sign's stroked block lettering.
    tx.setShadow(1, 1, 'rgba(0,0,0,0.45)', 0, true, true);
    hri++;
  }
  hidePoolFrom(scene.shopReadyPool, hri);

  // Chest tier indicators: chunky bordered diamond above each unopened chest.
  // Drawn into the top-most tierGfx layer so it ALWAYS reads above the chest sprite,
  // labels, and pads — never gets occluded.
  // Crates (the `box` sprite — starter supply crates and tier-1 chests) are
  // excluded: the gem is a treasure-chest cue, so it shouldn't float over a crate.
  const chestObjs = filteredObj.filter(({ o }) => o.kind === 'chest' && !_chestIsBox(o));
  const g = scene.tierGfx;
  g.clear();
  for (const item of chestObjs) {
    const { o, dx, dy } = item;
    const { sx, sy } = project(dx, dy);
    const tier = chestTier(o.poiClass);
    const color = CHEST_TIER_COLOR[tier];
    if (color == null) continue;   // tier 1 → no gem
    const cx = Math.round(sx + 1);   // +2px right (was sx - 1)
    const cy = Math.round(sy - 15);  // +3px down (was sy - 18)
    const r = 4.8;   // 20% smaller (was 6)
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

  // ── Coin drops (ATM / bicycle_parking burst). Walked across the same
  // 3×3-tile neighbourhood as objects/wildplants above. Expired coins
  // (now >= expiresAt) are spliced out of the in-memory entry.coinDrops
  // array right here at render time — they're ephemeral so we don't need
  // a separate sweep timer.
  const coinList = [];
  const _coinNow = Date.now();
  for (let dty = -1; dty <= 1; dty++) {
    for (let dtx = -1; dtx <= 1; dtx++) {
      const entry = WorldGen.tileCache.get(`${WorldGen.Z}/${pc.tx + dtx}/${pc.ty + dty}`);
      if (!entry || !entry.coinDrops || entry.coinDrops.length === 0) continue;
      // Filter-out expired coins by rewriting the array in place.
      let w = 0;
      for (let r = 0; r < entry.coinDrops.length; r++) {
        const c = entry.coinDrops[r];
        if (c.expiresAt && c.expiresAt <= _coinNow) continue;
        entry.coinDrops[w++] = c;
        const dx = c.x - pWorldX, dy = c.y - pWorldY;
        if (Math.abs(dx) > halfM || Math.abs(dy) > halfM) continue;
        coinList.push({ c, dx, dy });
      }
      entry.coinDrops.length = w;
    }
  }
  if (scene.coinPool && scene.coinContainer) {
    Render.renderPool(scene, scene.coinPool, scene.coinContainer, coinList, (s, item) => {
      const { c, dx, dy } = item;
      const { sx, sy } = project(dx, dy);
      setTextureIfDifferent(s, 'coin_drop');
      // Tiny pulse: scale oscillates ~0.9..1.1 over ~800ms based on now+id-hash
      // so each coin breathes out of phase with its neighbours.
      const idH = (c.id || '').length * 2654435761;
      const phase = ((_coinNow + idH) % 800) / 800;     // 0..1
      const pulse = 1.0 + 0.12 * Math.sin(phase * Math.PI * 2);
      s.setOrigin(0.5, 0.5)
       .setScale(1.5 * pulse)
       .setPosition(Math.round(sx), Math.round(sy))
       .setAlpha(1).setTint(0xffffff);
    });
  }

  const _shinyNow = Date.now();
  Render.renderPool(scene, scene.plantedPool, scene.plantedContainer, plantedList, (s, item) => {
    const { p, dx, dy } = item;
    const { sx, sy } = project(dx, dy);
    // Rare shiny wild flora gets the warm sheen; everything else (farmed crops,
    // placed rocks) renders untinted. Pooled sprites keep their last tint, so
    // set it explicitly every frame. A flat gold multiply on already-green
    // flora reads too subtly (the player can't spot a shiny harvest), so a
    // shiny plant also TWINKLES: its tint shimmers between warm gold and a
    // pale near-white gold while it gently pulses in scale. Motion + brightness
    // are renderer-agnostic (Phaser.AUTO may fall back to canvas, so a WebGL
    // glow FX wouldn't be reliable) and make a shiny plant unmistakable.
    const isShinyFlora = !!(p.wildId && isShiny(p.wildId, SHINY_RATE.flora));
    let shinyScale = 1;
    if (isShinyFlora) {
      // Desync each plant's twinkle off a stable per-id phase so a field of
      // shinys shimmers out of step rather than blinking in unison.
      const idH = ((p.wildId || '').length * 2654435761) >>> 0;
      const phase = ((_shinyNow + idH) % 1100) / 1100;          // 0..1
      const wave = 0.5 + 0.5 * Math.sin(phase * Math.PI * 2);  // 0..1
      shinyScale = 1.0 + 0.12 * wave;                           // 1.00..1.12 size pulse
      // Lerp the tint between deep gold and a bright pale gold (toward white,
      // which under a multiply tint brightens the sprite back up — a glint).
      const lo = SHINY_TINT, hi = 0xfff6cc;
      const lr = (lo >> 16) & 0xff, lg = (lo >> 8) & 0xff, lb = lo & 0xff;
      const hr = (hi >> 16) & 0xff, hg = (hi >> 8) & 0xff, hb = hi & 0xff;
      const r = Math.round(lr + (hr - lr) * wave);
      const g = Math.round(lg + (hg - lg) * wave);
      const b = Math.round(lb + (hb - lb) * wave);
      s.setTint((r << 16) | (g << 8) | b);
    } else {
      // Per-biome flora tint (golden field grass, swampy reeds, …) — the cell's
      // terrain was stamped onto the wildplant at worldgen time (`_biome`). Falls
      // back to no tint (0xffffff) when the biome has no tint for this crop.
      const bt = (typeof BiomeProfiles !== 'undefined' && p._biome != null)
        ? BiomeProfiles.tint(p._biome, p.crop) : null;
      s.setTint(bt || 0xffffff);
    }
    // Placed rockfruit stones use the produce-icon frame directly (col PRODUCE_COL)
    // rather than the in-world growth art. Stage clamping is skipped.
    if (p._placedRock) {
      const frame = (CROP_ROW['rockfruit'] ?? 4) * CROPS_SHEET_COLS + PRODUCE_COL;
      setTextureIfDifferent(s, 'crops');
      s.setFrame(frame);
      // Centre on the rock cell (0.5, 0.5) — this is the produce icon, not a
      // bottom-weighted stage-0 seed frame, so the foot-anchor (0.5, 0.85)
      // used to float it ~11px above the cell centre (same fix as the planted
      // sprites below).
      s.setOrigin(0.5, 0.5).setScale(2).setPosition(Math.round(sx), Math.round(sy));
      return;
    }
    const stage = Math.min(MAX_GROWTH_STAGE, p.stage ?? 0);
    const ov = CROP_SPRITE[p.crop];
    if (ov && ov.custom) {
      // Custom-sheet wildplants. Some are single-frame (longgrass,
      // mushroom), others have N visual variants picked off a stable
      // per-item hash so the same world cell always renders the same
      // shell / pebble / etc. but the field reads as varied. ov.frame
      // overrides the default 0 — needed for sheets whose first cell
      // is empty (mushroom_world's frame 0 is fully transparent).
      setTextureIfDifferent(s, ov.sheet);
      if (ov.variants && ov.variants > 1) {
        // Hash off the wildplant's stable _ix/_iy (or wildId for picked
        // entries) so the variant survives reloads.
        const h = ((p._ix ?? 0) * 73856093) ^ ((p._iy ?? 0) * 19349663)
                ^ ((p.wildId || '').length * 2654435761);
        s.setFrame(Math.abs(h) % ov.variants);
      } else {
        s.setFrame(ov.frame ?? 0);
      }
    } else if (ov && ov.sheet === 'springcrops') {
      // Spring Crops: col 0 = seed (stage 0), cols 1..4 = growth (4 = mature).
      const frame = ov.row * SPRING_CROPS_COLS + stage;
      setTextureIfDifferent(s, 'springcrops');
      s.setFrame(frame);
    } else {
      const row = CROP_ROW[p.crop] ?? 1;
      // In-world growth uses cols 0..5 of the crop's row.
      const frame = row * CROPS_SHEET_COLS + stage;
      setTextureIfDifferent(s, 'crops');
      s.setFrame(frame);
    }
    // 16×16 frame, scale 2 = 32×32 display. Centre the sprite in its cell
    // (origin 0.5, 0.5) — the earlier (0.5, 0.85) "foot-anchor" was meant
    // for character-like sprites but on flat ground tiles (longgrass,
    // flowers, wildplants) it shifted the sprite 11 px above the cell
    // centre, which the user spotted as "not centered in tiles".
    //
    // Exception: Crops.png seed frames (stage 0, default crops sheet) only
    // have pixels in the bottom half of their 16×16 cell — Crops.png draws
    // the seed sitting "on the ground". Centering that frame visually puts
    // the seed at the bottom of the tile. Stage 0 only: use the old
    // foot-anchor (0.5, 0.85) so the visible seed lands near the cell
    // centre. Stages 1+ grow upward and look right centered.
    const isCropsSheet = !ov || (!ov.custom && ov.sheet !== 'springcrops');
    const oy = (stage === 0 && isCropsSheet) ? 0.85 : 0.5;
    const cropScl = ((ov && ov.scale != null) ? ov.scale : 2) * shinyScale;
    s.setOrigin(0.5, oy).setScale(cropScl).setPosition(Math.round(sx), Math.round(sy));
  });

  // Growth-timer corner badges: for a watered, still-growing crop, render the
  // minutes-until-next-stage in the top-left of its cell. ✓ when the timer
  // has expired (player just needs to tap to advance). Hidden for wildplants
  // (no watered_t), seeds (stage 0 + unwatered), and mature crops.
  // Uses a parallel Phaser.Text pool — Render.renderPool only creates sprites.
  const STAGE_HOLD_MS = Crops.STAGE_HOLD_MS;   // single source of truth in crops.js
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
    const { sx, sy } = project(dx, dy);
    const remaining = STAGE_HOLD_MS - (now - p.watered_t);
    const label = remaining <= 0 ? '✓' : String(Math.max(1, Math.ceil(remaining / 60000)));
    // Bottom-right of the tile, inset 1px so the badge sits just inside the
    // cell border (origin (1,1) was set at pool creation).
    t.setText(label)
     .setPosition(Math.round(sx + CELL_PX / 2), Math.round(sy + CELL_PX / 2))
     .setColor(remaining <= 0 ? '#a7ffb0' : '#ffffff')
     .setAlpha(0.8)
     .setVisible(true);
    ti++;
  }
  hidePoolFrom(scene.plantedTimerPool, ti);

  // Heart overlay — a small 💗 floats above every tame (released_) creature
  // so the player can spot their pets at a glance. Pool is created lazily.
  scene._petHeartPool = scene._petHeartPool || [];
  const tameList = creatureList.filter(item => typeof item.c.id === 'string' && item.c.id.startsWith('released_'));
  let hi = 0;
  for (const item of tameList) {
    const { c, dx, dy } = item;
    const { sx, sy } = project(dx, dy);
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
  hidePoolFrom(scene._petHeartPool, hi);

  Render.renderPool(scene, scene.creaturePool, scene.creaturesContainer, creatureList, (s, item) => {
    const { c, dx, dy } = item;
    const { sx, sy } = project(dx, dy);
    if (c.kind === 'cow') {
      if (s.texture.key !== 'cow') { s.setTexture('cow'); s.play('cow-idle'); }
      // Cow is the biggest farm animal — needs to read larger than the
      // 32×32 cat/dog/deer/crow which all sit at 1.30. Bumped to 1.50
      // (48 px effective) so the cow visibly dwarfs the pets.
      s.setOrigin(0.5, 0.9).setScale(1.50).setPosition(Math.round(sx), Math.round(sy));
      s.setFlipX(!!c._faceFlip);
    } else if (c.kind === 'cat' || c.kind === 'dog') {
      // 32×32 RPG-Maker pet body sheet. Row 0 (frames 0..3) is the idle
      // cycle defined in app.js. Both pets at 1.3 — the dog sheet's frame
      // fills more of its 32×32 cell than the cat's does, so they read as
      // visually similar despite sharing the scalar.
      const animKey = c.kind === 'cat' ? 'cat-idle' : 'dog-idle';
      const sc = 1.3;
      if (s.texture.key !== c.kind) { s.setTexture(c.kind); s.play(animKey); }
      s.setOrigin(0.5, 0.9).setScale(sc).setPosition(Math.round(sx), Math.round(sy));
      s.setFlipX(!!c._faceFlip);
    } else if (c.kind === 'deer') {
      // 32×32 sheet (see assets.js comment) → scale 1.3, a touch under cow.
      // Row 0 frames 0-1 are the side-view idle pose.
      if (s.texture.key !== 'deer') { s.anims?.stop(); s.setTexture('deer', 0); }
      s.setFrame(0);
      s.setOrigin(0.5, 0.9).setScale(1.3).setPosition(Math.round(sx), Math.round(sy));
      s.setFlipX(!!c._faceFlip);
    } else if (c.kind === 'rabbit') {
      // 16×16 sheet → 1.5× (per user). Reads a touch smaller than the
      // chicken's 1.20 + cow's 1.20 because the rabbit's per-frame footprint
      // fills less of its 16×16 cell.
      if (s.texture.key !== 'rabbit') { s.anims?.stop(); s.setTexture('rabbit', 0); }
      s.setFrame(0);
      s.setOrigin(0.5, 0.9).setScale(1.5).setPosition(Math.round(sx), Math.round(sy));
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
    } else if (isMonster(c.kind)) {
      // Placeholder art: underground monsters reuse the slime sheet, recoloured
      // per kind via the unified setTint() below. Same idle squish loop + a
      // continuous hop; flyers (bats) float higher and bob faster so they read
      // as airborne. Swap in a dedicated sheet later by giving the kind its own
      // texture key here + an assets.js entry.
      const m = MONSTERS[c.kind];
      if (s.texture.key !== 'slime') { s.anims?.stop(); s.setTexture('slime', 0); }
      s.setFrame(Math.floor(performance.now() / 160) % 4);
      if (c._hopSeed == null) {
        let h = 0; const id = c.id || '';
        for (let k = 0; k < id.length; k++) h = (h * 31 + id.charCodeAt(k)) >>> 0;
        c._hopSeed = h % 600;
      }
      const period = m.fly ? 320 : 600;
      const ph = ((performance.now() + c._hopSeed) % period) / period;
      const hopPx = Math.abs(Math.sin(ph * Math.PI)) * (m.fly ? 10 : 6);
      const floatPx = m.fly ? 8 : 0;   // bats hover off the floor
      s.setOrigin(0.5, 0.9).setScale(m.fly ? 0.95 : 1.25)
       .setPosition(Math.round(sx), Math.round(sy) - Math.round(hopPx) - floatPx);
      s.setFlipX(!!c._faceFlip);
    } else if (c.kind === 'slime') {
      // 32×32 sheet; row 0 (frames 0-3) is the idle squish loop. A continuous
      // vertical hop — phase-offset per slime via a cached id hash — gives the
      // chicken-like bounce even while idle; slimes are always jiggling.
      if (s.texture.key !== 'slime') { s.anims?.stop(); s.setTexture('slime', 0); }
      s.setFrame(Math.floor(performance.now() / 160) % 4);
      if (c._hopSeed == null) {
        let h = 0; const id = c.id || '';
        for (let k = 0; k < id.length; k++) h = (h * 31 + id.charCodeAt(k)) >>> 0;
        c._hopSeed = h % 600;
      }
      const ph = ((performance.now() + c._hopSeed) % 600) / 600;   // 0..1 per hop
      const hopPx = Math.abs(Math.sin(ph * Math.PI)) * 6;          // arc up to 6 px
      s.setOrigin(0.5, 0.9).setScale(1.2).setPosition(Math.round(sx), Math.round(sy) - Math.round(hopPx));
      s.setFlipX(!!c._faceFlip);
    } else {
      // Chicken sheet is 16×16 (see assets.js note). Per user: +20% from the
      // Per user → 1.20 (still well under the cow's 1.20 because the chicken
      // sheet is 16×16 while the cow is 32×32 — same scalar, half the size).
      if (s.texture.key !== 'chicken') { s.setTexture('chicken'); s.play('chicken-idle'); }
      s.setOrigin(0.5, 0.9).setScale(1.20).setPosition(Math.round(sx), Math.round(sy));
      s.setFlipX(!!c._faceFlip);
    }
    // Rare shiny animals wear the warm sheen; underground monsters wear their
    // per-kind placeholder tint. Pooled sprites keep their last tint, so set an
    // explicit colour every frame (white for the common, plain case).
    s.setTint(isMonster(c.kind) ? MONSTERS[c.kind].tint
            : c.shiny ? SHINY_TINT : 0xffffff);
  });

  // Renderer-AGNOSTIC shiny markers. The gold setTint() above (and on trees /
  // wild flora) is a WebGL multiply that silently does NOTHING under Phaser's
  // Canvas fallback, so on those devices a shiny animal/plant looked identical
  // to a plain one — players reported never seeing shinies. Float a baked-gold
  // sparkle above every shiny entity instead: its colour is in the texture and
  // it animates with pure transforms (scale / alpha / rotation + a small bob),
  // both of which render under WebGL and Canvas alike. The existing tint/twinkle
  // stays as an extra flourish where WebGL is available.
  const sparkList = [];
  const pushSpark = (it, id) => sparkList.push({ dx: it.dx, dy: it.dy, id: id || '' });
  for (const it of creatureList) if (it.c.shiny) pushSpark(it, it.c.id);
  for (const it of plantedList) {
    if (it.p.wildId && isShiny(it.p.wildId, SHINY_RATE.flora)) pushSpark(it, it.p.wildId);
  }
  // Iterate filteredObj, NOT objList: a chopped shiny tree is still in objList
  // (so it depth-sorts / tracks state) but is dropped from filteredObj and so
  // renders no sprite. Sparking off objList left a gold sparkle hovering over
  // the now-empty cell — the "sparkle on the road with nothing under it" bug.
  for (const it of filteredObj) {
    if ((it.o.kind === 'tree' || it.o.kind === 'fruittree') && isShiny(it.o.id, SHINY_RATE.tree)) {
      pushSpark(it, it.o.id);
    }
  }
  const _sparkNow = Date.now();
  Render.renderPool(scene, scene.sparkPool, scene.sparkContainer, sparkList, (s, item) => {
    setTextureIfDifferent(s, 'shiny_spark');
    const { sx, sy } = project(item.dx, item.dy);
    // Desync each marker's twinkle off a stable per-id phase so a cluster of
    // shinies shimmers out of step rather than blinking in unison.
    let h = 0; const id = item.id;
    for (let k = 0; k < id.length; k++) h = (h * 31 + id.charCodeAt(k)) >>> 0;
    const phase = ((_sparkNow + (h % 1300)) % 1300) / 1300;        // 0..1
    const wave = 0.5 + 0.5 * Math.sin(phase * Math.PI * 2);        // 0..1
    const bob = Math.round(2 * Math.sin(phase * Math.PI * 2));     // -2..2 px
    const scl = 0.5 + 0.30 * wave;                                 // ~16..~26px from 32px tex
    // Pin the sparkle's TOP to the cell's top edge (origin is centred, so add
    // half the scaled height) so it sits AT THE TOP of, but INSIDE, the cell —
    // growing downward as it twinkles instead of floating above the cell.
    const halfH = 16 * scl;                                        // half the scaled 32px texture
    const yTop = sy - CELL_PX / 2 + 1;                             // cell top, 1px inset
    s.setOrigin(0.5, 0.5)
     .setScale(scl)
     .setAlpha(0.55 + 0.45 * wave)
     .setAngle(phase * 360)                                        // slow shimmer spin
     .setTint(0xffffff)
     .setPosition(Math.round(sx), Math.round(yTop + halfH + bob));
  });
};
