// Original OSM road geometry overlay.
//
// The world's roads reach the player as CELLS: worldgen rasterizes each
// `transportation` line from the vector tile into a one-cell-wide band of
// ROAD/PATH tiles (see worldgen.js classifyLine / paintLine). That's a lossy
// step — a diagonal way becomes a staircase, two ways closer than a cell weld
// together, and parking aisles are dropped entirely. This layer draws the
// SOURCE linework straight from the decoded MVT features on top of the map, in
// black at 9% alpha, so the rasterized roads can be eyeballed against the real
// ways they came from.
//
// Each way is stroked at its class's real-world width (WorldGen.roadWidthM)
// drawn to the map's scale, so the band covers roughly the ground the road
// covers: a 5 m residential street is one cell wide, a 12 m motorway more
// than two.
//
// Depends on:
//   scene fields (read-only): roadGeomGfx, roadGeomContainer, save,
//     startWorldM, playerM, cellM, cellsPerTile, depth,
//     viewCenterX/Y, viewLeft, viewTop, viewSize
//     helper: playerToWorldCell()
//   worldgen.js — WorldGen.tileCache, WorldGen.Z, WorldGen.roadWidthM;
//                 per-tile `entry.layers` (the raw decoded MVT layers)
//                 and `entry.tileEdgeM`
//   app.js consts — CELL_PX
//
// Exports as globals:
//   RoadOverlay.draw(scene)      — per-frame entry point (cheap when cached)
//   RoadOverlay.isOn(scene)      — is the overlay enabled for this save?
//   RoadOverlay.invalidate(scene)— force a rebuild on the next draw
(function (global) {
  const COLOR = 0x000000;
  const ALPHA = 0.09;    // black @ 9% — faint enough to read the map through
  const MVT_EXTENT = 4096;
  // Fallback widths (metres) if WorldGen.roadWidthM is somehow unavailable —
  // the shared table lives there so the overlay and the rasterizer agree.
  const FALLBACK_WIDTH_M = 5;

  // Stroke width for one way: its real-world carriageway width, drawn at the
  // map's own scale (one cell = scene.cellM metres = CELL_PX pixels). So a 5 m
  // residential street covers exactly the one cell the rasterizer paints for
  // it, and a 12 m motorway visibly covers more than two.
  function widthPxFor(scene, tags) {
    const m = (typeof WorldGen !== 'undefined' && typeof WorldGen.roadWidthM === 'function')
      ? WorldGen.roadWidthM(tags || {})
      : FALLBACK_WIDTH_M;
    return Math.max(1, (m / scene.cellM) * CELL_PX);
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
    const g = scene.roadGeomGfx;
    if (!g) return;
    const container = scene.roadGeomContainer;
    const on = isOn(scene) && (scene.depth ?? 0) === 0;
    if (container) container.setVisible(on);
    if (!on) {
      if (scene._roadGeomKey !== null) { g.clear(); scene._roadGeomKey = null; }
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
      rebuild(scene, tiles, fracX, fracY);
    }
    if (container) container.setPosition(-fracX * CELL_PX, -fracY * CELL_PX);
  }

  function rebuild(scene, tiles, fracX, fracY) {
    const g = scene.roadGeomGfx;
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
    // by stroke width, and stroked as PATHS rather than loose segments: a wide
    // band drawn segment-by-segment leaves a notch at every bend, and one
    // lineStyle per width beats one per feature.
    const runsByWidth = new Map();   // widthPx -> [ [{x,y},…], … ]
    const addRun = (widthPx, run) => {
      if (run.length < 2) return;
      let runs = runsByWidth.get(widthPx);
      if (!runs) { runs = []; runsByWidth.set(widthPx, runs); }
      runs.push(run);
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
                addRun(widthPx, run);
                run = [{ x: qx, y: qy }];
              } else {
                run.push({ x: qx, y: qy });
              }
              px = qx; py = qy;
            }
            addRun(widthPx, run);
          }
        }
      }
    }

    // Widest first, so a narrow street crossing a motorway still reads as its
    // own stroke on top. Sorted rather than insertion-ordered so the draw order
    // doesn't depend on which tile happened to load first.
    for (const widthPx of [...runsByWidth.keys()].sort((a, b) => b - a)) {
      g.lineStyle(widthPx, COLOR, ALPHA);
      for (const run of runsByWidth.get(widthPx)) {
        g.beginPath();
        g.moveTo(run[0].x, run[0].y);
        for (let i = 1; i < run.length; i++) g.lineTo(run[i].x, run[i].y);
        g.strokePath();
      }
    }
  }

  global.RoadOverlay = { draw, isOn, invalidate };
})(window);
