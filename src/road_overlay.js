// Original OSM road geometry overlay.
//
// The world's roads reach the player as CELLS: worldgen rasterizes each
// `transportation` line from the vector tile into a one-cell-wide band of
// ROAD/PATH tiles (see worldgen.js classifyLine / paintLine). That's a lossy
// step — a diagonal way becomes a staircase, two ways closer than a cell weld
// together, and parking aisles are dropped entirely. This layer draws the
// SOURCE linework straight from the decoded MVT features on top of the map, as
// a soft brown band, so the rasterized roads can be eyeballed against the real
// ways they came from. Railways are drawn in slate instead of earth — the
// rasterizer has no rail tier, so without that they'd read as ordinary
// streets. The band is punched out over water and over building floors (see
// "Keep-out"), and the layer itself sits UNDER the cobbles, so the stones the
// rasterizer actually laid always read on top of the linework they came from.
//
// Each way is stroked at its class's real-world width (WorldGen.roadWidthM)
// drawn to the map's scale, so the band covers roughly the ground the road
// covers: with 7 m cells a 5 m residential street is a little under one cell
// wide, a 12 m motorway a little under two. The large tier (motorway / trunk
// / primary) is then drawn 50% wider still, so the trunk network stands out
// from the streets feeding it. A small-stone cobblestone pattern is stamped
// over the finished linework in one pass, giving the bands a paved texture
// for the cost of a single fill (see "Cobblestone" below).
//
// Depends on:
//   scene fields (read-only): roadGeomGfx, roadGeomContainer, save,
//     startWorldM, playerM, cellM, cellsPerTile, depth,
//     viewCenterX/Y, viewLeft, viewTop, viewSize
//     helper: playerToWorldCell()
//   worldgen.js — WorldGen.tileCache, WorldGen.Z, WorldGen.roadWidthM;
//                 per-tile `entry.layers` (the raw decoded MVT layers),
//                 `entry.tileEdgeM`, and `entry.grid` (for the keep-out pass)
//   app.js consts — CELL_PX
//
// Exports as globals:
//   RoadOverlay.draw(scene)      — per-frame entry point (cheap when cached)
//   RoadOverlay.isOn(scene)      — is the overlay enabled for this save?
//   RoadOverlay.invalidate(scene)— force a rebuild on the next draw
(function (global) {
  // Warm earth brown rather than black: the ways read as packed track over the
  // biome colours instead of as a shadow, and they sit in the same family as
  // the cobble the rasterizer paints. Muted well off the saturated brown it
  // started as — over the greens and tans of the biome paint a chromatic band
  // competed with the map instead of sitting under it, and the cobblestone
  // texture below needs a quiet base to read against.
  const COLOR = 0x614b3a;
  const ALPHA = 0.61;    // reads as a band without hiding the map
  const MVT_EXTENT = 4096;

  // Rail is not road. It arrives in the same `transportation` layer and the
  // rasterizer has no tier for it, so a railway lands on the map as an
  // ordinary street — which is exactly why the overlay has to say otherwise:
  // cold steel-slate instead of the warm earth every road tier shares. The
  // classes are OpenMapTiles' rail family (`rail` covers heavy rail and its
  // subclasses; `transit` covers tram / subway / light_rail).
  const RAIL_CLASSES = new Set(['rail', 'transit']);
  const RAIL_COLOR = 0x565d69;
  const colorFor = (tags) => RAIL_CLASSES.has((tags && tags.class) || '') ? RAIL_COLOR : COLOR;
  const cssOf = (c) => '#' + (c >>> 0).toString(16).padStart(6, '0');

  // Cells the overlay must not paint over, punched out of the finished canvas
  // (see keepOut below): WATER, so the linework stays on land instead of
  // laying a brown band across a lake wherever a bridge or a shoreline way
  // runs, and the three BUILDING tiers, whose floors — a house's boards, the
  // castle's court paving — should read as the top surface there rather than
  // having a road drawn across them.
  const WATER_T = 3;
  const BUILDING_T = new Set([9, 11, 12]);
  // Fallback widths (metres) if WorldGen.roadWidthM is somehow unavailable —
  // the shared table lives there so the overlay and the rasterizer agree.
  const FALLBACK_WIDTH_M = 5;

  // The big ways — motorway / trunk / primary, exactly worldgen's ROAD_LG
  // tier — are stroked half again as wide as their measured carriageway.
  // Their real widths are already the largest on the map, but at map scale
  // they still read as ribbons barely wider than the residential streets
  // feeding them; the extra weight puts the road hierarchy back so the trunk
  // routes are legible at a glance. Everything else keeps its true width.
  const LARGE_CLASSES = new Set(['motorway', 'trunk', 'primary']);
  const LARGE_SCALE = 1.5;

  // Stroke width for one way: its real-world carriageway width, drawn at the
  // map's own scale (one cell = scene.cellM metres = CELL_PX pixels). So a 5 m
  // residential street lands just inside the single cell the rasterizer paints
  // for it, and a 12 m motorway visibly spills past that cell on both sides —
  // by half again as much once LARGE_SCALE is applied to the top tier.
  function widthPxFor(scene, tags) {
    const m = (typeof WorldGen !== 'undefined' && typeof WorldGen.roadWidthM === 'function')
      ? WorldGen.roadWidthM(tags || {})
      : FALLBACK_WIDTH_M;
    const scale = LARGE_CLASSES.has((tags && tags.class) || '') ? LARGE_SCALE : 1;
    return Math.max(1, (m / scene.cellM) * CELL_PX * scale);
  }

  // ── Cobblestone ──────────────────────────────────────────────────────────
  // A flat band of colour reads as a sticker laid over the map. The texture
  // costs nothing per way: ONE small tile of little rounded stones is drawn
  // once, made into a repeating canvas pattern, and painted over the finished
  // network in a SINGLE source-atop fillRect — so it lands only on pixels a
  // way already covers, whatever shape the network is, and the per-rebuild
  // cost is that one fill no matter how many ways are on screen. (The
  // obvious alternative — a patterned strokeStyle per way — pays for the
  // pattern on every stroke, and still can't texture the joins evenly.)
  // Rebuilds are already rare: the pass only runs when the camera crosses a
  // cell or a tile finishes loading, never per frame.
  //
  // Every mark is monochrome black/white at low alpha, composited with
  // source-atop onto the caller's own stroke colour (earth for roads, slate
  // for rail) — so the texture only MODULATES light/dark, never introduces a
  // new hue. That's what keeps a cobbled road the same warm brown it always
  // was instead of a grey stone pattern pasted over a brown band.
  const STONE_TILE_PX = 32;          // repeat every cell
  const STONE_COLS = 4, STONE_ROWS = 4;    // small stones — a 4×4 grid per tile
  const STONE_GROUT_ALPHA = 0.16;  // dark wash first — the seams between stones
  const STONE_FACE_ALPHA  = 0.14;  // lighter fill over most of each stone
  const STONE_HILITE_ALPHA = 0.22; // small bright fleck, upper-left of each stone
  const STONE_SHADOW_ALPHA = 0.20; // small dark fleck, lower-right — gives it a curve
  let stoneCanvas;
  function stoneTile() {
    if (stoneCanvas !== undefined) return stoneCanvas;
    stoneCanvas = null;
    if (typeof document === 'undefined') return stoneCanvas;
    const c = document.createElement('canvas');
    c.width = c.height = STONE_TILE_PX;
    const cx = c.getContext('2d');
    if (!cx) return stoneCanvas;
    // Fixed-seed LCG, not Math.random: the tile is identical every session, so
    // the roads can't shimmer differently between one load and the next.
    let seed = 0x2f6b4a;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    // Grout wash: paint the WHOLE tile with a faint dark tone first, so the
    // margin between stones reads as a recessed seam rather than bare road
    // colour showing through — the same "cut into the ground" cue the pad
    // texture's side-face bevel uses.
    cx.fillStyle = `rgba(0,0,0,${STONE_GROUT_ALPHA})`;
    cx.fillRect(0, 0, STONE_TILE_PX, STONE_TILE_PX);
    const cellW = STONE_TILE_PX / STONE_COLS, cellH = STONE_TILE_PX / STONE_ROWS;
    for (let row = 0; row < STONE_ROWS; row++) {
      for (let col = 0; col < STONE_COLS; col++) {
        // Jitter each stone's centre + radius a little so the grid doesn't
        // read as one perfectly uniform tile once it repeats across a road.
        const jx = (rnd() - 0.5) * cellW * 0.3;
        const jy = (rnd() - 0.5) * cellH * 0.3;
        const r = Math.min(cellW, cellH) * 0.36 * (0.85 + rnd() * 0.3);
        const px = col * cellW + cellW / 2 + jx;
        const py = row * cellH + cellH / 2 + jy;
        cx.beginPath();
        cx.arc(px, py, r, 0, Math.PI * 2);
        cx.fillStyle = `rgba(255,255,255,${STONE_FACE_ALPHA})`;
        cx.fill();
        // Highlight + shadow on opposite corners, so each pebble reads as
        // faintly domed rather than a flat painted disc.
        cx.beginPath();
        cx.arc(px - r * 0.3, py - r * 0.3, r * 0.4, 0, Math.PI * 2);
        cx.fillStyle = `rgba(255,255,255,${STONE_HILITE_ALPHA})`;
        cx.fill();
        cx.beginPath();
        cx.arc(px + r * 0.3, py + r * 0.3, r * 0.4, 0, Math.PI * 2);
        cx.fillStyle = `rgba(0,0,0,${STONE_SHADOW_ALPHA})`;
        cx.fill();
      }
    }
    stoneCanvas = c;
    return stoneCanvas;
  }

  // ── Stroke target ────────────────────────────────────────────────────────
  // The overlay strokes into a Graphics-SHAPED object: clear / lineStyle /
  // beginPath / moveTo / lineTo / strokePath, plus an optional commit() once
  // the pass is done. In the game that's the canvas-2D adapter below; the
  // headless tests inject their own recording stub as scene.roadGeomGfx.
  //
  // Why canvas 2D rather than a Phaser Graphics:
  //   • ROUND CAPS + JOINS. Phaser's Graphics has no lineCap/lineJoin control,
  //     so every way ended in a hard square butt and every bend showed a notch.
  //   • NO DOUBLED JOINTS. A translucent stroke composites with ITSELF wherever
  //     a path doubles back over its own width — at every junction and sharp
  //     bend — stacking 31% on 31% into a dark blot. Here the whole network is
  //     drawn OPAQUE into an offscreen canvas and the resulting image is shown
  //     at ALPHA, so overlaps are opaque-on-opaque and the band stays even.
  // The texture covers the viewport plus PAD on each side (the same pad the
  // culler keeps), and the container scrolls it for the sub-cell offset.
  const TEX_KEY = 'roadgeom_overlay';
  function canvasTarget(scene) {
    if (typeof document === 'undefined' || !scene.textures || !scene.roadGeomContainer) return null;
    if (scene._roadGeomTarget) return scene._roadGeomTarget;
    const pad = CELL_PX * 2;
    const size = Math.ceil(scene.viewSize + pad * 2);
    const originX = scene.viewLeft - pad, originY = scene.viewTop - pad;
    if (scene.textures.exists(TEX_KEY)) scene.textures.remove(TEX_KEY);
    const tex = scene.textures.createCanvas(TEX_KEY, size, size);
    if (!tex) return null;
    const ctx = tex.getContext();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const img = scene.add.image(originX, originY, TEX_KEY).setOrigin(0, 0).setAlpha(ALPHA);
    scene.roadGeomContainer.add(img);
    // Stone pattern + its phase, built on first commit and kept for the life
    // of the target. The texture canvas is screen-fixed while the ways slide
    // across it, so an un-phased pattern would swim over the roads as the
    // player walks; the phase pins it to the world instead.
    let stonePattern;
    let phaseX = 0, phaseY = 0;
    // Rounded, not just wrapped: a fractional translate makes the canvas
    // resample the stone tile, which softens the pebble edges into mush and
    // re-blurs them differently on every rebuild. Whole pixels keep the
    // cobblestones as crisp as the rest of the art.
    const wrap = (v) => ((Math.round(v) % STONE_TILE_PX) + STONE_TILE_PX) % STONE_TILE_PX;
    const target = {
      clear() { ctx.clearRect(0, 0, size, size); },
      // The alpha is carried by the IMAGE (see above), so the stroke itself is
      // always opaque; the colour is the caller's (earth for roads, slate for
      // rail) and the alpha argument is deliberately ignored here.
      lineStyle(w, c) { ctx.lineWidth = w; ctx.strokeStyle = cssOf(c == null ? COLOR : c); },
      beginPath() { ctx.beginPath(); },
      moveTo(x, y) { ctx.moveTo(x - originX, y - originY); },
      lineTo(x, y) { ctx.lineTo(x - originX, y - originY); },
      strokePath() { ctx.stroke(); },
      // Punch a cell-sized hole in what's been drawn so far. Used for the
      // water / building keep-out; clearRect rather than a destination-out
      // fill so the hole is exact and costs nothing to composite.
      eraseRect(x, y, w, h) { ctx.clearRect(x - originX, y - originY, w, h); },
      // Screen position the world origin projected to this pass — the stone
      // pattern is anchored there, so it sits still on the road while the road moves.
      texturePhase(x, y) { phaseX = wrap(x - originX); phaseY = wrap(y - originY); },
      commit() {
        if (stonePattern === undefined) {
          const tile = stoneTile();
          stonePattern = (tile && ctx.createPattern(tile, 'repeat')) || null;
        }
        if (stonePattern) {
          ctx.save();
          // source-atop keeps the stones inside what's already drawn, so they
          // never leak off the ways into empty canvas.
          ctx.globalCompositeOperation = 'source-atop';
          ctx.fillStyle = stonePattern;
          // The pattern rides the current transform, so translating by the
          // phase moves the stones with the world. Fill a tile wider on every
          // side to cover what that shift pushes off the canvas.
          ctx.translate(phaseX, phaseY);
          ctx.fillRect(-STONE_TILE_PX, -STONE_TILE_PX, size + STONE_TILE_PX * 2, size + STONE_TILE_PX * 2);
          ctx.restore();
        }
        tex.refresh();
      },
    };
    scene._roadGeomTarget = target;
    return target;
  }
  // Prefer a scene-provided Graphics-shaped object (the headless tests inject
  // one); otherwise build the canvas adapter.
  function strokeTarget(scene) {
    return scene.roadGeomGfx || canvasTarget(scene);
  }

  // Overlay is ON unless the save explicitly turned it off, so an existing
  // save picks it up without a migration.
  function isOn(scene) {
    return !!scene && scene.save?.roadGeomOverlay !== false;
  }

  function invalidate(scene) {
    if (scene) scene._roadGeomKey = null;
  }

  // Same trick the dashed grid + biome borders use: the world→screen transform
  // is a pure translation, so the geometry is drawn ONCE at the cell-snapped
  // camera position and the container is scrolled by the sub-cell fraction
  // every frame. Without it this pass would re-stroke a few thousand segments
  // per frame just to move them a pixel.
  function draw(scene) {
    const g = strokeTarget(scene);
    if (!g) return;
    const container = scene.roadGeomContainer;
    const on = isOn(scene) && (scene.depth ?? 0) === 0;
    if (container) container.setVisible(on);
    if (!on) {
      if (scene._roadGeomKey !== null) {
        g.clear();
        if (g.commit) g.commit();
        scene._roadGeomKey = null;
      }
      return;
    }

    const pc = scene.playerToWorldCell();
    const fracX = pc.cx - Math.floor(pc.cx);
    const fracY = pc.cy - Math.floor(pc.cy);
    const baseCellIX = pc.tx * scene.cellsPerTile + Math.floor(pc.cx);
    const baseCellIY = pc.ty * scene.cellsPerTile + Math.floor(pc.cy);

    // Rebuild key: the snapped camera cell plus which of the 3×3 tiles have
    // their MVT layers in hand — so a tile that finishes loading (or gets
    // evicted and rebuilt) repaints even while the player stands still.
    const tiles = [];
    let ready = '';
    for (let dty = -1; dty <= 1; dty++) {
      for (let dtx = -1; dtx <= 1; dtx++) {
        const tx = pc.tx + dtx, ty = pc.ty + dty;
        const entry = WorldGen.tileCache.get(`${WorldGen.Z}/${tx}/${ty}`);
        if (!entry || !entry.layers || !entry.tileEdgeM) continue;
        tiles.push({ tx, ty, entry });
        ready += `${dtx}${dty}|`;
      }
    }
    const key = `${baseCellIX},${baseCellIY},${ready}`;
    if (key !== scene._roadGeomKey) {
      scene._roadGeomKey = key;
      rebuild(scene, tiles, fracX, fracY, baseCellIX, baseCellIY);
    }
    if (container) container.setPosition(-fracX * CELL_PX, -fracY * CELL_PX);
  }

  // ── Keep-out ─────────────────────────────────────────────────────────────
  // The overlay is a band painted over the GROUND, so it has no business on
  // the two things that aren't ground: open water and a building's floor.
  // Both are cell-shaped, so rather than clipping every stroke we draw the
  // whole network first and punch the offending cells back out afterwards —
  // one clearRect per keep-out cell, and only on a rebuild.
  //
  // The projection is the same cell-snapped one the strokes use: with the
  // container carrying the sub-cell offset, the cell `ox` columns east and
  // `oy` rows south of the player's own cell lands at exactly
  // (viewCenterX + ox*CELL_PX, viewCenterY + oy*CELL_PX). Only the padded
  // viewport is walked — the same pad the culler keeps.
  function keepOut(scene, g, baseCellIX, baseCellIY) {
    if (!g.eraseRect || baseCellIX == null) return;
    const PAD = CELL_PX * 2;
    const minX = scene.viewLeft - PAD, maxX = scene.viewLeft + scene.viewSize + PAD;
    const minY = scene.viewTop  - PAD, maxY = scene.viewTop  + scene.viewSize + PAD;
    const ox0 = Math.floor((minX - scene.viewCenterX) / CELL_PX);
    const ox1 = Math.ceil((maxX - scene.viewCenterX) / CELL_PX);
    const oy0 = Math.floor((minY - scene.viewCenterY) / CELL_PX);
    const oy1 = Math.ceil((maxY - scene.viewCenterY) / CELL_PX);
    const N = scene.cellsPerTile;
    // Tile lookups are memoised across the row-major walk: a padded viewport
    // spans at most 4 tiles, so this is 4 Map.gets instead of one per cell.
    let curTX = null, curTY = null, curGrid = null;
    for (let oy = oy0; oy <= oy1; oy++) {
      const acy = baseCellIY + oy;
      const ty = Math.floor(acy / N), iy = acy - ty * N;
      for (let ox = ox0; ox <= ox1; ox++) {
        const acx = baseCellIX + ox;
        const tx = Math.floor(acx / N), ix = acx - tx * N;
        if (tx !== curTX || ty !== curTY) {
          curTX = tx; curTY = ty;
          const e = WorldGen.tileCache.get(`${WorldGen.Z}/${tx}/${ty}`);
          curGrid = (e && e.grid) || null;
        }
        if (!curGrid) continue;
        const t = curGrid[iy * N + ix];
        if (t !== WATER_T && !BUILDING_T.has(t)) continue;
        g.eraseRect(scene.viewCenterX + ox * CELL_PX,
                    scene.viewCenterY + oy * CELL_PX, CELL_PX, CELL_PX);
      }
    }
  }

  function rebuild(scene, tiles, fracX, fracY, baseCellIX, baseCellIY) {
    const g = strokeTarget(scene);
    g.clear();
    const pWorldX = scene.startWorldM.x + scene.playerM.x;
    const pWorldY = scene.startWorldM.y + scene.playerM.y;
    // Cell-snapped projection (the container re-applies the sub-cell offset).
    const projX = (wmx) => scene.viewCenterX + ((wmx - pWorldX) / scene.cellM) * CELL_PX + fracX * CELL_PX;
    const projY = (wmy) => scene.viewCenterY + ((wmy - pWorldY) / scene.cellM) * CELL_PX + fracY * CELL_PX;
    // Cull generously — a segment whose endpoints both sit outside the padded
    // viewport can still cross it, so the pad is a full cell wider than the
    // sub-cell scroll can ever reveal.
    const PAD = CELL_PX * 2;
    const minX = scene.viewLeft - PAD, maxX = scene.viewLeft + scene.viewSize + PAD;
    const minY = scene.viewTop  - PAD, maxY = scene.viewTop  + scene.viewSize + PAD;

    // Ways are collected into runs of consecutive ON-SCREEN segments, bucketed
    // by stroke STYLE (width + colour), and stroked as PATHS rather than loose
    // segments: a wide band drawn segment-by-segment leaves a notch at every
    // bend, and one lineStyle per style beats one per feature.
    const runsByStyle = new Map();   // "widthPx|color" -> { widthPx, color, runs }
    const addRun = (widthPx, color, run) => {
      if (run.length < 2) return;
      const k = `${widthPx}|${color}`;
      let bucket = runsByStyle.get(k);
      if (!bucket) { bucket = { widthPx, color, runs: [] }; runsByStyle.set(k, bucket); }
      bucket.runs.push(run);
    };

    for (const { tx, ty, entry } of tiles) {
      const tileEdgeM = entry.tileEdgeM;
      const originMx = tx * tileEdgeM;
      const originMy = ty * tileEdgeM;
      for (const layer of entry.layers) {
        if (layer.name !== 'transportation') continue;
        const mvtToM = tileEdgeM / (layer.extent || MVT_EXTENT);
        for (const f of layer.features) {
          if (f.type !== 2 || !f.geom) continue;   // lines only (2 = LineString)
          const widthPx = widthPxFor(scene, f.tags);
          const color = colorFor(f.tags);
          for (const line of f.geom) {
            if (!line || line.length < 2) continue;
            let px = projX(originMx + line[0].x * mvtToM);
            let py = projY(originMy + line[0].y * mvtToM);
            let run = [{ x: px, y: py }];
            for (let i = 1; i < line.length; i++) {
              const qx = projX(originMx + line[i].x * mvtToM);
              const qy = projY(originMy + line[i].y * mvtToM);
              const offscreen =
                (px < minX && qx < minX) || (px > maxX && qx > maxX) ||
                (py < minY && qy < minY) || (py > maxY && qy > maxY);
              if (offscreen) {
                // Break the path here — the skipped stretch would otherwise be
                // drawn as a straight shortcut across the viewport.
                addRun(widthPx, color, run);
                run = [{ x: qx, y: qy }];
              } else {
                run.push({ x: qx, y: qy });
              }
              px = qx; py = qy;
            }
            addRun(widthPx, color, run);
          }
        }
      }
    }

    // Widest first, so a narrow street crossing a motorway still reads as its
    // own stroke on top. Sorted rather than insertion-ordered so the draw order
    // doesn't depend on which tile happened to load first; ties (same width,
    // different colour) break on the colour so the order is fully determined.
    const styles = [...runsByStyle.values()]
      .sort((a, b) => (b.widthPx - a.widthPx) || (a.color - b.color));
    for (const { widthPx, color, runs } of styles) {
      g.lineStyle(widthPx, color, ALPHA);
      for (const run of runs) {
        g.beginPath();
        g.moveTo(run[0].x, run[0].y);
        for (let i = 1; i < run.length; i++) g.lineTo(run[i].x, run[i].y);
        g.strokePath();
      }
    }
    // Land only, and never over a floor: punch the keep-out cells back out.
    keepOut(scene, g, baseCellIX, baseCellIY);
    // Anchor the stone pattern to the world before it's laid down: the world origin's
    // screen position in THIS pass tells the target how far to phase the
    // pattern, so walking scrolls the texture with the road rather than under
    // it. (projX/projY are cheap and this is once per rebuild.)
    if (g.texturePhase) g.texturePhase(projX(0), projY(0));
    // Upload the finished canvas once, after every way is on it — not per
    // stroke. No-op for the tests' recording stub.
    if (g.commit) g.commit();
  }

  global.RoadOverlay = { draw, isOn, invalidate };
})(window);
