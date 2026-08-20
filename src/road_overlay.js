// Original OSM road geometry overlay.
//
// The world's roads reach the player as CELLS: worldgen rasterizes each
// `transportation` line from the vector tile into a one-cell-wide band of
// ROAD/PATH tiles (see worldgen.js classifyLine / paintLine). That's a lossy
// step — a diagonal way becomes a staircase, two ways closer than a cell weld
// together, and parking aisles are dropped entirely. This layer draws the
// SOURCE linework straight from the decoded MVT features on top of the map, as
// a soft brown band at 31% alpha, so the rasterized roads can be eyeballed
// against the real ways they came from.
//
// Each way is stroked at its class's real-world width (WorldGen.roadWidthM)
// drawn to the map's scale, so the band covers roughly the ground the road
// covers: with 7 m cells a 5 m residential street is a little under one cell
// wide, a 12 m motorway a little under two. The large tier (motorway / trunk
// / primary) is then drawn 50% wider still, so the trunk network stands out
// from the streets feeding it. A grain pattern is stamped over the finished
// linework in one pass, giving the bands a packed-dirt mottle for the cost of
// a single fill (see "Grain" below).
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
  // Warm earth brown rather than black: the ways read as packed track over the
  // biome colours instead of as a shadow, and they sit in the same family as
  // the cobble the rasterizer paints. Muted well off the saturated brown it
  // started as — over the greens and tans of the biome paint a chromatic band
  // competed with the map instead of sitting under it, and the grain below
  // needs a quiet base to read against.
  const COLOR = 0x614b3a;
  const COLOR_CSS = '#614b3a';
  const ALPHA = 0.31;    // 31% — reads as a band without hiding the map
  const MVT_EXTENT = 4096;
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

  // ── Grain ────────────────────────────────────────────────────────────────
  // A flat band of colour reads as a sticker laid over the map. The grain is
  // a packed-dirt mottle that costs nothing per way: ONE small noise tile is
  // generated once, made into a repeating canvas pattern, and painted over
  // the finished network in a SINGLE source-atop fillRect — so it lands only
  // on pixels a way already covers, whatever shape the network is, and the
  // per-rebuild cost is that one fill no matter how many ways are on screen.
  // (The obvious alternative — a patterned strokeStyle per way — pays for the
  // pattern on every stroke, and still can't texture the joins evenly.)
  // Rebuilds are already rare: the pass only runs when the camera crosses a
  // cell or a tile finishes loading, never per frame.
  const GRAIN_PX = 32;        // repeat every cell — grain, not a visible weave
  const GRAIN_ALPHA = 0.22;   // before the layer's own 31% knocks it back
  let grainCanvas;
  function grainTile() {
    if (grainCanvas !== undefined) return grainCanvas;
    grainCanvas = null;
    if (typeof document === 'undefined') return grainCanvas;
    const c = document.createElement('canvas');
    c.width = c.height = GRAIN_PX;
    const cx = c.getContext('2d');
    if (!cx) return grainCanvas;
    const img = cx.createImageData(GRAIN_PX, GRAIN_PX);
    const d = img.data;
    // Fixed-seed LCG, not Math.random: the tile is identical every session, so
    // the roads can't shimmer differently between one load and the next.
    let seed = 0x2f6b4a;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < GRAIN_PX * GRAIN_PX; i++) {
      const n = rnd();
      // Two thirds of the pixels stay clear — a fleck here and there mottles
      // the band, where texturing every pixel would just be static.
      if (n < 0.66) continue;
      const light = n > 0.88;
      const v = light ? 255 : 0;
      d[i * 4] = v; d[i * 4 + 1] = v; d[i * 4 + 2] = v;
      // Light flecks are the highlights on the grit: fewer and fainter than
      // the dark ones, so the band still darkens the map overall.
      d[i * 4 + 3] = Math.round(255 * GRAIN_ALPHA * (light ? 0.6 : 1));
    }
    cx.putImageData(img, 0, 0);
    grainCanvas = c;
    return grainCanvas;
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
    // Grain pattern + its phase, built on first commit and kept for the life
    // of the target. The texture canvas is screen-fixed while the ways slide
    // across it, so an un-phased pattern would swim over the roads as the
    // player walks; the phase pins it to the world instead.
    let grainPattern;
    let phaseX = 0, phaseY = 0;
    // Rounded, not just wrapped: a fractional translate makes the canvas
    // resample the noise tile, which softens the 1 px flecks into mush and
    // re-blurs them differently on every rebuild. Whole pixels keep the grain
    // as crisp as the rest of the art.
    const wrap = (v) => ((Math.round(v) % GRAIN_PX) + GRAIN_PX) % GRAIN_PX;
    const target = {
      clear() { ctx.clearRect(0, 0, size, size); },
      // Colour + alpha are the module's constants for every way; the alpha is
      // carried by the IMAGE (see above), so the stroke itself is opaque.
      lineStyle(w) { ctx.lineWidth = w; ctx.strokeStyle = COLOR_CSS; },
      beginPath() { ctx.beginPath(); },
      moveTo(x, y) { ctx.moveTo(x - originX, y - originY); },
      lineTo(x, y) { ctx.lineTo(x - originX, y - originY); },
      strokePath() { ctx.stroke(); },
      // Screen position the world origin projected to this pass — the grain is
      // anchored there, so it sits still on the road while the road moves.
      texturePhase(x, y) { phaseX = wrap(x - originX); phaseY = wrap(y - originY); },
      commit() {
        if (grainPattern === undefined) {
          const tile = grainTile();
          grainPattern = (tile && ctx.createPattern(tile, 'repeat')) || null;
        }
        if (grainPattern) {
          ctx.save();
          // source-atop keeps the grain inside what's already drawn, so it
          // never leaks off the ways into empty canvas.
          ctx.globalCompositeOperation = 'source-atop';
          ctx.fillStyle = grainPattern;
          // The pattern rides the current transform, so translating by the
          // phase moves the grain with the world. Fill a tile wider on every
          // side to cover what that shift pushes off the canvas.
          ctx.translate(phaseX, phaseY);
          ctx.fillRect(-GRAIN_PX, -GRAIN_PX, size + GRAIN_PX * 2, size + GRAIN_PX * 2);
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
      rebuild(scene, tiles, fracX, fracY);
    }
    if (container) container.setPosition(-fracX * CELL_PX, -fracY * CELL_PX);
  }

  function rebuild(scene, tiles, fracX, fracY) {
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
    // Anchor the grain to the world before it's laid down: the world origin's
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
