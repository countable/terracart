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
// streets — and then dressed as actual TRACK: timber ties across the slate
// ballast and two steel rails along it (see "Train tracks" below).
// The band is punched out over water and over building floors (see
// "Keep-out"), and the layer itself sits UNDER the cobbles, so the stones the
// rasterizer actually laid always read on top of the linework they came from.
//
// Each way is stroked at the width it covers on the ground
// (WorldGen.roadOverlayWidthM — the class's real-world carriageway from
// WorldGen.roadWidthM, with the large tier's weighting applied) drawn to the
// map's scale, so the band covers roughly the ground the road covers: with
// 7 m cells a 5 m residential street is a little under one cell wide, a 12 m
// motorway a little under two. The large tier (motorway / trunk / primary)
// is then drawn 50% wider still, so the trunk network stands out from the
// streets feeding it. A small-stone cobblestone pattern is stamped over the
// finished linework in one pass, giving the bands a paved texture for the
// cost of a single fill (see "Cobblestone" below).
//
// The band is DILAPIDATED by default — cracked, damp, lichened, missing the
// odd stone (see "Weathering") — and the stretches the player has restored
// (src/streets.js: exact float metre intervals along each way, kept in the
// save) are drawn AGAIN on a second canvas above it in clean near-black
// cobble with a hairline kerb (see "Restored"), its outline feathered so the
// patch reads as a repair blending into the band rather than a decal laid on
// it. So a street reads as rebuilt exactly as far as the player has rebuilt
// it, down to the metre.
//
// Depends on:
//   scene fields (read-only): roadGeomGfx, roadRestoredGfx (headless only),
//     roadGeomContainer, roadLiveGfx (created here), save,
//     startWorldM, playerM, cellM, cellsPerTile, depth,
//     viewCenterX/Y, viewLeft, viewTop, viewSize
//     helpers: playerToWorldCell(), worldMetersToScreen() (drawLive only)
//   worldgen.js — WorldGen.tileCache, WorldGen.Z, WorldGen.roadOverlayWidthM,
//                 WorldGen.PATH_CLASSES, WorldGen.tileKey,
//                 WorldGen.T / WorldGen.isBuildingTerrain (the keep-out);
//                 per-tile `entry.layers` (the raw decoded MVT layers),
//                 `entry.tileEdgeM`, and `entry.grid` (for the keep-out pass)
//   coords.js — overlayFrame / overlayProjection / timedOverlayRebuild (the
//               camera-anchored draw frame both geometry overlays share)
//   streets.js — Streets.lineKey / restoredList / subLineM / epoch (the
//               restored intervals). OPTIONAL: every use is guarded, so the
//               base pass still draws if the module isn't loaded. The save's
//               `streets` object is NEVER read directly — only through these.
//   sprite_layout.js — SpriteLayout.CELL_PX
//   app.js consts — CELL_PX
//
// Exports as globals:
//   RoadOverlay.draw(scene)      — per-frame entry point (cheap when cached)
//   RoadOverlay.invalidate(scene)— force a rebuild on the next draw
//   RoadOverlay.drawLive(scene, runs) — per-frame overlay strokes (the dwell
//                                  preview + the restore shine), on a Graphics
//   RoadOverlay.paintWeatherTile / paintCleanTile — the two procedural tiles,
//                                  exported so the headless suite can run them
//                                  against a recording 2D context
(function (global) {
  // Warm earth brown rather than black: the ways read as packed track over the
  // biome colours instead of as a shadow, and they sit in the same family as
  // the cobble the rasterizer paints. Muted well off the saturated brown it
  // started as — over the greens and tans of the biome paint a chromatic band
  // competed with the map instead of sitting under it, and the cobblestone
  // texture below needs a quiet base to read against.
  //
  // PATH_COLOR is that same brown, desaturated a little (footways/tracks are
  // still packed earth, just less saturated than the original chromatic
  // brown). ROAD_COLOR — vehicle carriageways — is desaturated further AND
  // darkened, so a paved street reads as a visibly different, harder surface
  // than a dirt path instead of the same band at a different width.
  const PATH_COLOR = 0x5c4b3f;
  const ROAD_COLOR = 0x3a322c;
  const ALPHA = 0.61;    // reads as a band without hiding the map
  const MVT_EXTENT = 4096;

  // Same class list worldgen's classifyLine uses to paint T.PATH cells —
  // WorldGen.PATH_CLASSES itself, so a way that rasterizes as a footpath also
  // overlays as one and the two lists can't drift apart.
  const PATH_CLASSES = WorldGen.PATH_CLASSES;

  // Rail is not road. It arrives in the same `transportation` layer and the
  // rasterizer has no tier for it, so a railway lands on the map as an
  // ordinary street — which is exactly why the overlay has to say otherwise:
  // cold steel-slate instead of the warm earth every road tier shares. The
  // classes are OpenMapTiles' rail family (`rail` covers heavy rail and its
  // subclasses; `transit` covers tram / subway / light_rail).
  const RAIL_CLASSES = new Set(['rail', 'transit']);
  const RAIL_COLOR = 0x565d69;

  // ── Train tracks ─────────────────────────────────────────────────────────
  // A railway is not a paved band. Its slate stroke stays (it reads as the
  // ballast bed once the stone pattern is gravelled over it), but the rebuild
  // also lays TIMBER TIES across the bed and TWO STEEL RAILS along it, so a
  // railway finally looks like one instead of a grey street. The furniture
  // goes through the stroke target's OPTIONAL decorPath: the canvas adapter
  // draws decor after the gravel pass (crisp — no cobble texture, no edge
  // nibble) and before the keep-out erases (so track never crosses water or a
  // floor); a target without decorPath — the headless test stub — just gets
  // the plain band, exactly the pre-tracks look. Sizes are in METRES so the
  // track keeps its proportions at any latitude's cell size.
  const RAIL_GAUGE_M = 1.8;    // rail-to-rail spread — a touch over standard gauge, for legibility
  const TIE_LEN_M = 2.8;       // tie length across the bed
  const TIE_SPACING_M = 2.2;   // one tie every ~2 m of run
  const TIE_W_PX = 2;
  const RAIL_W_PX = 1.5;
  const TIE_COLOR = 0x463526;      // creosote timber
  const RAIL_STEEL = 0xb9c2cd;     // light steel — reads against the slate ballast

  // Offset a polyline sideways by `off` px (+ = left of travel). Per-vertex
  // mitered normals so the two rails stay parallel through bends; the miter is
  // capped at 2× so a hairpin vertex can't fling a rail off the ballast.
  function offsetPolyline(run, off) {
    const n = run.length;
    const segN = [];
    for (let i = 0; i < n - 1; i++) {
      const dx = run[i + 1].x - run[i].x, dy = run[i + 1].y - run[i].y;
      const l = Math.hypot(dx, dy) || 1;
      segN.push({ x: -dy / l, y: dx / l });
    }
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = i > 0 ? segN[i - 1] : segN[0];
      const b = i < n - 1 ? segN[i] : segN[n - 2];
      const sx = a.x + b.x, sy = a.y + b.y;
      const sl = Math.hypot(sx, sy);
      let ox, oy;
      if (sl < 1e-6) { ox = b.x; oy = b.y; }           // 180° reversal — fall back
      else {
        // |a+b| = 2·cos(θ/2), and the miter length is off / cos(θ/2) — so
        // scaling the normalized sum by min(2, 2/|a+b|) is exactly that, capped.
        const scale = Math.min(2, 2 / sl);
        ox = (sx / sl) * scale; oy = (sy / sl) * scale;
      }
      out.push({ x: run[i].x + ox * off, y: run[i].y + oy * off });
    }
    return out;
  }

  // Emit one rail run's furniture: ties by arclength, then the two rails.
  function emitRailDecor(scene, g, run) {
    const pxPerM = CELL_PX / scene.cellM;
    const halfGauge = (RAIL_GAUGE_M / 2) * pxPerM;
    const halfTie = (TIE_LEN_M / 2) * pxPerM;
    const tieStep = TIE_SPACING_M * pxPerM;
    let next = tieStep / 2;   // distance along the run to the next tie
    for (let i = 1; i < run.length; i++) {
      const ax = run[i - 1].x, ay = run[i - 1].y;
      let dx = run[i].x - ax, dy = run[i].y - ay;
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) continue;
      dx /= len; dy /= len;
      const nx = -dy, ny = dx;
      while (next <= len) {
        const cx = ax + dx * next, cy = ay + dy * next;
        g.decorPath(TIE_W_PX, TIE_COLOR, [
          { x: cx - nx * halfTie, y: cy - ny * halfTie },
          { x: cx + nx * halfTie, y: cy + ny * halfTie },
        ]);
        next += tieStep;
      }
      next -= len;
    }
    g.decorPath(RAIL_W_PX, RAIL_STEEL, offsetPolyline(run, -halfGauge));
    g.decorPath(RAIL_W_PX, RAIL_STEEL, offsetPolyline(run, halfGauge));
  }
  const colorFor = (tags) => {
    const c = (tags && tags.class) || '';
    if (RAIL_CLASSES.has(c)) return RAIL_COLOR;
    if (PATH_CLASSES.has(c)) return PATH_COLOR;
    return ROAD_COLOR;
  };
  // Colour ints become canvas strings through util.js's cssOf.

  // Cells the overlay must not paint over, punched out of the finished canvas
  // (see keepOut below): WATER, so the linework stays on land instead of
  // laying a brown band across a lake wherever a bridge or a shoreline way
  // runs, and the three BUILDING tiers (WorldGen.isBuildingTerrain), whose
  // floors — a house's boards, the castle's court paving — should read as the
  // top surface there rather than having a road drawn across them.
  const WATER_T = WorldGen.T.WATER;

  // The big ways — motorway / trunk / primary, exactly worldgen's ROAD_LG
  // tier — are stroked half again as wide as their measured carriageway.
  // Their real widths are already the largest on the map, but at map scale
  // they still read as ribbons barely wider than the residential streets
  // feeding them; the extra weight puts the road hierarchy back so the trunk
  // routes are legible at a glance. Everything else keeps its true width.
  // That weighting lives in WorldGen.roadOverlayWidthM, NOT here: worldgen
  // stamps its no-spawn road mask from the same function, so the ground drawn
  // as road and the ground barred from spawning are the same ground by
  // construction. Widening a band here alone would put rocks back in the
  // traffic.

  // Stroke width for one way: the width it covers on the ground, drawn at the
  // map's own scale (one cell = scene.cellM metres = CELL_PX pixels). So a 5 m
  // residential street lands just inside the single cell the rasterizer paints
  // for it, and a 12 m motorway visibly spills past that cell on both sides —
  // by half again as much once the large tier's weighting is applied.
  // No fallback width: this module already reads WorldGen at load
  // (PATH_CLASSES above), and a private number here is exactly the drift
  // between "drawn as road" and roadMask that the shared function exists to
  // prevent.
  function widthPxFor(scene, tags) {
    const m = WorldGen.roadOverlayWidthM(tags || {});
    return Math.max(1, (m / scene.cellM) * CELL_PX);
  }

  // Fixed-seed LCG, not Math.random: the pattern tiles below are identical
  // every session, so the roads can't shimmer differently between one load
  // and the next. (textures.js keeps its own copy for its own tiles.)
  function lcg(seed) {
    return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
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
  //
  // Each stone is an IRREGULAR polygon, not a circle — a perfect circle with
  // a centred highlight/shadow pair is the standard way to draw a glossy
  // sphere, so the first version of this (round + a highlight dot on one
  // side, a shadow dot on the other) read as a tray of bubbles instead of
  // paving. A lumpy 6–8-sided outline plus a plain dark edge stroke (no
  // gloss) is what actually reads as a small flat stone.
  const STONE_TILE_PX = SpriteLayout.CELL_PX; // repeat every cell
  const STONE_COLS = 4, STONE_ROWS = 4;    // small stones — a 4×4 grid per tile
  const STONE_GROUT_ALPHA = 0.16;    // dark wash first — the seams between stones
  const STONE_EDGE_ALPHA = 0.30;     // dark outline stroke around each stone
  const STONE_FACE_ALPHA_MIN = 0.06; // per-stone face tone varies within this
  const STONE_FACE_ALPHA_MAX = 0.16; // range so neighbours don't read identical
  // ── Rough edges ──────────────────────────────────────────────────────────
  // A stroked band ends in a perfectly clean vector edge, which reads as tape
  // laid over the map rather than a surface worn into it. The roughness is a
  // silhouette nibble, done in two stroke passes at commit time:
  //   1. the whole network is stroked at its TRUE width — the outer
  //      EDGE_FRINGE_PX of that stroke is the sacrificial fringe;
  //   2. a pre-baked noise tile is pattern-filled over the canvas with
  //      destination-out, eating random bites out of everything;
  //   3. the network is stroked AGAIN at width − EDGE_FRINGE_PX, repairing
  //      every interior pixel. The bites survive only in the outer fringe, so
  //      the edge meanders between the full and the reduced width.
  // The nibble works INWARD from the true width on purpose: the drawn band
  // never exceeds WorldGen.roadOverlayWidthM, so the ground drawn as road
  // stays inside the ground the no-spawn road mask covers (QC rule).
  // Cost: one extra stroke pass + one pattern fill, only on the rare rebuilds
  // (cell crossings / tile loads) — nothing per frame. The noise tile is
  // world-phased exactly like the cobbles, so the bites sit still on the road
  // instead of crawling along the edge as the player walks.
  const EDGE_FRINGE_PX = 3;          // ~1.5px per side — subtle, not torn
  const EDGE_NOISE_COVERAGE = 0.45;  // fraction of the fringe eaten
  let edgeNoiseCanvas;
  function edgeNoiseTile() {
    if (edgeNoiseCanvas !== undefined) return edgeNoiseCanvas;
    edgeNoiseCanvas = null;
    if (typeof document === 'undefined') return edgeNoiseCanvas;
    const c = document.createElement('canvas');
    c.width = c.height = STONE_TILE_PX;
    const cx = c.getContext('2d');
    if (!cx) return edgeNoiseCanvas;
    // Fixed seed, same reason as the stones: identical bites every session.
    const rnd = lcg(0x9e3779b9);
    // 2×2 blocks, not per-pixel speckle: single-pixel noise erodes the fringe
    // into grey fuzz, while coarser bites leave an edge that visibly meanders.
    // A few 1px singles on top break the blockiness.
    cx.fillStyle = '#000';   // colour is irrelevant to destination-out; alpha is the knife
    for (let by = 0; by < STONE_TILE_PX; by += 2) {
      for (let bx = 0; bx < STONE_TILE_PX; bx += 2) {
        if (rnd() < EDGE_NOISE_COVERAGE) cx.fillRect(bx, by, 2, 2);
      }
    }
    for (let i = 0; i < 48; i++) {
      cx.fillRect(Math.floor(rnd() * STONE_TILE_PX), Math.floor(rnd() * STONE_TILE_PX), 1, 1);
    }
    edgeNoiseCanvas = c;
    return edgeNoiseCanvas;
  }

  let stoneCanvas;
  function stoneTile() {
    if (stoneCanvas !== undefined) return stoneCanvas;
    stoneCanvas = null;
    if (typeof document === 'undefined') return stoneCanvas;
    const c = document.createElement('canvas');
    c.width = c.height = STONE_TILE_PX;
    const cx = c.getContext('2d');
    if (!cx) return stoneCanvas;
    const rnd = lcg(0x2f6b4a);
    // Grout wash: paint the WHOLE tile with a faint dark tone first, so the
    // margin between stones reads as a recessed seam rather than bare road
    // colour showing through — the same "cut into the ground" cue the pad
    // texture's side-face bevel uses.
    cx.fillStyle = `rgba(0,0,0,${STONE_GROUT_ALPHA})`;
    cx.fillRect(0, 0, STONE_TILE_PX, STONE_TILE_PX);
    cx.lineWidth = 1;
    const cellW = STONE_TILE_PX / STONE_COLS, cellH = STONE_TILE_PX / STONE_ROWS;
    for (let row = 0; row < STONE_ROWS; row++) {
      for (let col = 0; col < STONE_COLS; col++) {
        // Jitter each stone's centre a little so the grid doesn't read as one
        // perfectly uniform tile once it repeats across a road.
        const jx = (rnd() - 0.5) * cellW * 0.3;
        const jy = (rnd() - 0.5) * cellH * 0.3;
        const px = col * cellW + cellW / 2 + jx;
        const py = row * cellH + cellH / 2 + jy;
        const r = Math.min(cellW, cellH) * 0.42;
        // Lumpy outline: N vertices at a jittered radius, not a circle.
        const sides = 6 + Math.floor(rnd() * 3);
        cx.beginPath();
        for (let i = 0; i < sides; i++) {
          const ang = (i / sides) * Math.PI * 2;
          const rr = r * (0.7 + rnd() * 0.45);
          const vx = px + Math.cos(ang) * rr, vy = py + Math.sin(ang) * rr;
          if (i === 0) cx.moveTo(vx, vy); else cx.lineTo(vx, vy);
        }
        cx.closePath();
        // Flat face — no gradient, no gloss — at a per-stone alpha so
        // neighbouring stones read as separately-set pavers.
        const faceAlpha = STONE_FACE_ALPHA_MIN + rnd() * (STONE_FACE_ALPHA_MAX - STONE_FACE_ALPHA_MIN);
        cx.fillStyle = `rgba(255,255,255,${faceAlpha})`;
        cx.fill();
        // A plain dark edge, not a shadow blob, is what separates one stone
        // from the next.
        cx.strokeStyle = `rgba(0,0,0,${STONE_EDGE_ALPHA})`;
        cx.stroke();
      }
    }
    stoneCanvas = c;
    return stoneCanvas;
  }

  // ── Weathering ───────────────────────────────────────────────────────────
  // The dilapidated band is more than a faded colour: it is CRACKED. One more
  // pattern tile, laid source-atop after the stones (so it lands on the ways
  // and nowhere else), carrying the four marks a neglected street shows from
  // above — jagged hairline cracks with a pale lifted lip beside them, soft
  // dark damp patches, pale lichen/dust blooms, and a couple of dark pits
  // where a stone has gone altogether.
  //
  // The alphas are bold on purpose: the whole canvas is shown at ALPHA (0.61),
  // so a mark drawn at 0.3 arrives at the player as 0.18 and reads as nothing.
  // Fixed-seed LCG like the stones — identical every session — and world-
  // phased through the same texturePhase, so the cracks sit still on the road
  // instead of crawling along it as the player walks.
  //
  // RAIL gets none of it: a railway's band is ballast, not paving, and it is
  // already dressed with ties and rails. See commitBase for how the fill is
  // held off the rail runs.
  const WEATHER_TILE_PX = 64;
  const WEATHER_CRACK_ALPHA = 0.85;   // the crack itself: 1px, near-black
  const WEATHER_LIP_ALPHA = 0.18;     // the pale lifted lip beside it
  const WEATHER_DAMP_ALPHA = 0.38;    // soft dark damp patches
  const WEATHER_LICHEN_ALPHA = 0.16;  // pale lichen / dust blooms
  const WEATHER_PIT_ALPHA = 0.6;      // a missing stone
  const WEATHER_LICHEN_N = 3, WEATHER_DAMP_N = 2, WEATHER_CRACK_N = 3, WEATHER_PIT_N = 2;

  // A soft round bloom: a radial gradient falling to zero, painted over its
  // own bounding square (cheaper than a clipped arc and softer at the rim).
  function weatherBlob(cx, x, y, r, rgb, alpha) {
    const g = cx.createRadialGradient(x, y, 0, x, y, r);
    if (!g || !g.addColorStop) return;
    g.addColorStop(0, `rgba(${rgb},${alpha})`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    cx.fillStyle = g;
    cx.fillRect(x - r, y - r, 2 * r, 2 * r);
  }

  // Paint one weathering tile into an arbitrary 2D context. Split out from the
  // canvas builder below so the headless suite can run the real drawing code
  // against a recording context (textures.js' tiles are tested the same way).
  function paintWeatherTile(cx, size) {
    const S = size || WEATHER_TILE_PX;
    const rnd = lcg(0x51ed27);
    for (let i = 0; i < WEATHER_LICHEN_N; i++)
      weatherBlob(cx, rnd() * S, rnd() * S, 5 + rnd() * 6, '255,255,255', WEATHER_LICHEN_ALPHA);
    for (let i = 0; i < WEATHER_DAMP_N; i++)
      weatherBlob(cx, rnd() * S, rnd() * S, 6 + rnd() * 7, '0,0,0', WEATHER_DAMP_ALPHA);
    // Cracks: a random walk that turns a little at every step, drawn twice —
    // the pale lip one pixel down-right of the dark crack, so the split reads
    // as an edge lifting rather than a pencil line.
    cx.lineWidth = 1;
    for (let i = 0; i < WEATHER_CRACK_N; i++) {
      let x = rnd() * S, y = rnd() * S, a = rnd() * Math.PI * 2;
      const pts = [[x, y]];
      const n = 5 + Math.floor(rnd() * 5);
      for (let k = 0; k < n; k++) {
        a += (rnd() - 0.5) * 1.4;
        const l = 3 + rnd() * 5;
        x += Math.cos(a) * l; y += Math.sin(a) * l;
        pts.push([x, y]);
      }
      cx.strokeStyle = `rgba(255,255,255,${WEATHER_LIP_ALPHA})`;
      cx.beginPath();
      for (let j = 0; j < pts.length; j++) {
        if (j) cx.lineTo(pts[j][0] + 1, pts[j][1] + 1); else cx.moveTo(pts[j][0] + 1, pts[j][1] + 1);
      }
      cx.stroke();
      cx.strokeStyle = `rgba(0,0,0,${WEATHER_CRACK_ALPHA})`;
      cx.beginPath();
      for (let j = 0; j < pts.length; j++) {
        if (j) cx.lineTo(pts[j][0], pts[j][1]); else cx.moveTo(pts[j][0], pts[j][1]);
      }
      cx.stroke();
    }
    // …and a couple of missing stones.
    for (let i = 0; i < WEATHER_PIT_N; i++) {
      cx.fillStyle = `rgba(0,0,0,${WEATHER_PIT_ALPHA})`;
      cx.beginPath();
      cx.ellipse(rnd() * S, rnd() * S, 3.5, 2.5, rnd() * 3, 0, Math.PI * 2);
      cx.fill();
    }
  }

  let weatherCanvas;
  function weatherTile() {
    if (weatherCanvas !== undefined) return weatherCanvas;
    weatherCanvas = null;
    if (typeof document === 'undefined') return weatherCanvas;
    const c = document.createElement('canvas');
    c.width = c.height = WEATHER_TILE_PX;
    const cx = c.getContext('2d');
    if (!cx) return weatherCanvas;
    paintWeatherTile(cx, WEATHER_TILE_PX);
    weatherCanvas = c;
    return weatherCanvas;
  }

  // ── Restored ─────────────────────────────────────────────────────────────
  // A restored stretch is drawn on its OWN canvas, laid over the dilapidated
  // one, so the two looks never have to be reconciled inside a single band:
  // the base pass draws every way in full and the restored pass paints the
  // rebuilt metres on top of it, edge to edge.
  //
  // Near-black rather than "clean grey": the point of the restored street is
  // that it reads as a different surface from a hundred metres away, and the
  // one thing the biome palette never contains is black. Paths restore to
  // dark packed earth instead — a footway that turned into basalt setts would
  // read as a road. Rail never restores at all.
  const RESTORED_ALPHA = 0.92;         // near-opaque: the rebuilt street is the surface
  const RESTORED_ROAD_COLOR = 0x161412;
  const RESTORED_PATH_COLOR = 0x2e2620;
  const RESTORED_TEX_KEY = 'roadgeom_restored';
  const restoredColorFor = (tags) =>
    (PATH_CLASSES.has((tags && tags.class) || '') ? RESTORED_PATH_COLOR : RESTORED_ROAD_COLOR);

  // The clean cobble tile: brick-staggered courses of small rounded setts on a
  // pale mortar wash. Smaller and far more regular than the dilapidated
  // stones — that regularity IS the restoration, so it is drawn as a laid
  // course grid rather than the base pass's jittered lumps. Paths get the same
  // tile with the mortar wash halved (packed earth has no mortar to speak of).
  const CLEAN_TILE_PX = 32;
  const CLEAN_MORTAR_ALPHA = 0.20;   // pale, so the seams read as clean lines on the black
  const CLEAN_PATH_MORTAR_MUL = 0.5;
  const CLEAN_COLS = 6, CLEAN_ROWS = 8;   // 6 setts across, 8 courses down
  const CLEAN_SETT_R = 1.6;          // corner radius
  const CLEAN_GAP_X = 1.5, CLEAN_GAP_Y = 1.2;   // mortar gaps between setts, px
  const CLEAN_TONE_MIN = 0.05, CLEAN_TONE_MAX = 0.12;  // per-stone tone
  const CLEAN_BEVEL_ALPHA = 0.22;    // top bevel catch-light
  const CLEAN_BEVEL_H = 0.45;        // …over the upper 45% of the sett

  function roundRectPath(cx, x, y, w, h, r) {
    cx.beginPath();
    cx.moveTo(x + r, y);
    cx.lineTo(x + w - r, y);
    cx.quadraticCurveTo(x + w, y, x + w, y + r);
    cx.lineTo(x + w, y + h - r);
    cx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    cx.lineTo(x + r, y + h);
    cx.quadraticCurveTo(x, y + h, x, y + h - r);
    cx.lineTo(x, y + r);
    cx.quadraticCurveTo(x, y, x + r, y);
    cx.closePath();
  }

  // One sett: black body, a slight per-stone tone so neighbours aren't
  // identical, and a catch-light along its top edge.
  function paintSett(cx, x, y, w, h, tone) {
    cx.fillStyle = '#000';
    roundRectPath(cx, x, y, w, h, CLEAN_SETT_R); cx.fill();
    cx.fillStyle = `rgba(255,255,255,${tone})`;
    roundRectPath(cx, x, y, w, h, CLEAN_SETT_R); cx.fill();
    cx.fillStyle = `rgba(255,255,255,${CLEAN_BEVEL_ALPHA})`;
    roundRectPath(cx, x + 0.5, y + 0.5, w - 1, h * CLEAN_BEVEL_H, 1); cx.fill();
  }

  function paintCleanTile(cx, size, mortarAlpha) {
    const S = size || CLEAN_TILE_PX;
    const rnd = lcg(0xc0bb1e);
    cx.fillStyle = `rgba(255,255,255,${mortarAlpha == null ? CLEAN_MORTAR_ALPHA : mortarAlpha})`;
    cx.fillRect(0, 0, S, S);
    const sw = S / CLEAN_COLS, sh = S / CLEAN_ROWS;
    for (let row = 0; row < CLEAN_ROWS; row++) {
      const off = (row % 2) * (sw / 2);   // brick stagger
      for (let col = 0; col < CLEAN_COLS; col++) {
        const x = col * sw + off + CLEAN_GAP_X / 2, y = row * sh + CLEAN_GAP_Y / 2;
        const w = sw - CLEAN_GAP_X, h = sh - CLEAN_GAP_Y;
        const tone = CLEAN_TONE_MIN + rnd() * (CLEAN_TONE_MAX - CLEAN_TONE_MIN);
        paintSett(cx, x, y, w, h, tone);
        // A staggered course's last sett runs off the tile's right edge; draw
        // that same stone again one tile to the LEFT so the pattern meets
        // itself where it repeats. The tile is CLEAN_COLS setts wide by
        // construction — the wrap is a second copy, not a seventh stone.
        if (x + w > S) paintSett(cx, x - S, y, w, h, tone);
      }
    }
  }

  const cleanCanvas = {};
  function cleanTile(isPath) {
    const k = isPath ? 'path' : 'road';
    if (cleanCanvas[k] !== undefined) return cleanCanvas[k];
    cleanCanvas[k] = null;
    if (typeof document === 'undefined') return cleanCanvas[k];
    const c = document.createElement('canvas');
    c.width = c.height = CLEAN_TILE_PX;
    const cx = c.getContext('2d');
    if (!cx) return cleanCanvas[k];
    paintCleanTile(cx, CLEAN_TILE_PX, CLEAN_MORTAR_ALPHA * (isPath ? CLEAN_PATH_MORTAR_MUL : 1));
    cleanCanvas[k] = c;
    return cleanCanvas[k];
  }

  // ── The LAMP STONE ───────────────────────────────────────────────────────
  // The glowing cobble a restored street carries every Streets.lampSpacingM()
  // metres of it — the stone itself; the light it throws is lighting.js's
  // `cobble` row and app.js places both on the same point.
  //
  // WHY ART AS WELL AS LIGHT. The lightmap is MULTIPLIED over the world, so at
  // noon (a near-white map) a light alone is invisible and the lamps would
  // simply not exist by day. The stone is therefore painted: it reads as a
  // pale sett with a hot core at any hour, and after dark the cookie over it
  // is what makes it a lamp.
  //
  // Baked ONCE into a texture (app.js) rather than stroked per frame, for the
  // reason at the top of this file — and its halo is a real radial gradient
  // rather than a stack of translucent rings, which is the same rule again
  // (a translucent ring composites with its neighbours and blotches).
  //
  // UI_STREET_INK, the colour a restored street is MADE of, so the lamp, the
  // chips that fly off the carriageway and the counter over it are one
  // material — the same one constant lighting.js's row reads.
  const LAMP_TEX_PX = 64;          // baked square; the halo fills it
  const LAMP_DRAW_CELLS = 1.5;     // …drawn this many cells across, halo included
  const LAMP_STONE_FRAC = 0.16;    // the stone's radius, as a fraction of the square
  const LAMP_CORE_A = 0.85;        // the hot core's alpha at the centre
  const LAMP_HALO_A = 0.42;        // …and the halo's, just outside the stone
  const LAMP_RIM_A = 0.35;         // the stone's dark rim: what makes it a STONE by day
  const LAMP_INK = (typeof UI_STREET_INK === 'string') ? UI_STREET_INK : '#e8e2d6';

  function paintLampStone(cx, size) {
    const S = size || LAMP_TEX_PX;
    const c = S / 2;
    const r = S * LAMP_STONE_FRAC;
    const ink = LAMP_INK;
    const rgb = [1, 3, 5].map((i) => parseInt(ink.slice(i, i + 2), 16));
    const a = (al) => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${al})`;
    // The halo: brightest just outside the stone, gone by the edge of the
    // square. Quadratic falloff, the same shape lighting.js bakes its cookies
    // with, so the painted glow and the light over it agree.
    const g = cx.createRadialGradient(c, c, 0, c, c, c);
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      g.addColorStop(t, a((LAMP_HALO_A * (1 - t) * (1 - t)).toFixed(4)));
    }
    cx.fillStyle = g;
    cx.fillRect(0, 0, S, S);
    // The stone: the sett itself, near-white at its middle and the street's
    // own ink at its edge, with a dark rim so it still reads as a laid stone
    // in daylight rather than as a smudge of light.
    const core = cx.createRadialGradient(c, c, 0, c, c, r);
    core.addColorStop(0, `rgba(255,253,247,${LAMP_CORE_A})`);
    core.addColorStop(0.55, a(0.92));
    core.addColorStop(1, a(0.78));
    cx.fillStyle = core;
    cx.beginPath(); cx.arc(c, c, r, 0, Math.PI * 2); cx.fill();
    cx.lineWidth = Math.max(1, S * 0.02);
    cx.strokeStyle = `rgba(28,24,20,${LAMP_RIM_A})`;
    cx.beginPath(); cx.arc(c, c, r, 0, Math.PI * 2); cx.stroke();
  }

  // The kerb: a hairline pale line along the outer edge of a restored band —
  // the one cue that says "this street has a built edge" rather than "this
  // street is darker". Painted by re-stroking the run pale at full width and
  // covering all but the outer pixel back up (see commitRestored).
  const KERB_ALPHA = 0.12;
  const KERB_INSET_PX = 2;

  // ── The patch is SOFT ────────────────────────────────────────────────────
  // A rebuilt stretch is a REPAIR, not a decal. Its silhouette against the
  // dilapidated band underneath is feathered rather than cut, and the round
  // caps its ends already carry read as a proper lozenge once the corners go
  // soft — so where the player's dwell stopped is a place the new surface
  // fades out, not a guillotined edge across the carriageway.
  //
  // The blur is applied to the patch's ALPHA ONLY: a mask of the same strokes,
  // blurred, composited `destination-in` over the finished layer. Blurring the
  // drawn layer itself would smear the clean setts into grey mush, which is
  // the one thing the restored look is FOR.
  //
  // AT FULL WIDTH, and the radius is a FRACTION of the band. A Gaussian leaves
  // its half-maximum on the original edge, so blurring the true width keeps
  // the patch exactly as wide as the band it repairs — nothing is stroked in
  // to compensate. What a fixed radius WOULD do is eat a narrow way alive: a
  // footpath is a third the width of a street, and at the radius a carriageway
  // wants its centre never reaches full alpha, so the whole path would restore
  // ghostly. So each band width is blurred by its own radius, capped at
  // RESTORED_BLUR_PX for the wide ones.
  //
  // Canvas2D `filter` is the only gradient primitive available here (the same
  // reason lighting.js bakes its cookies on a canvas). Where it is missing the
  // softening is skipped and the hard edge ships — never a stack of alpha
  // strokes standing in for it: a translucent stroke composites with ITSELF
  // wherever a path doubles back, so a hand-rolled feather would blotch at
  // every junction, which is the same trap the opaque-then-alpha rule at the
  // top of this file exists to avoid.
  //
  // Measured against a real canvas rather than guessed: at these two numbers a
  // footway (~9px at 7 m cells) fades over 4px and keeps 93% alpha down its
  // spine, a residential street (~23px) fades over 9px and stays solid. Push
  // the fraction past a third and the narrow ways stop reaching full alpha at
  // all — which is the restored footpath going ghostly, not softer.
  const RESTORED_BLUR_PX = 5;          // the widest feather any band gets
  const RESTORED_BLUR_FRAC = 0.32;     // …and never more than this much of its own width

  const blurForWidth = (w) => Math.min(RESTORED_BLUR_PX, Math.max(0, w) * RESTORED_BLUR_FRAC);

  function supportsFilter(ctx) {
    if (!ctx || typeof ctx.filter !== 'string') return false;
    try {
      ctx.filter = 'blur(1px)';
      const ok = ctx.filter !== 'none';
      ctx.filter = 'none';
      return ok;
    } catch (e) { return false; }
  }

  // Feather `layer`'s alpha out across the edge of its own outline. One pass
  // per band WIDTH, since the radius is derived from it. No-op (hard edge
  // kept) where the platform can't blur.
  function softenEdge(layer, size, ops) {
    const mask = scratchLayer(size);
    if (!mask || !ops.length || !supportsFilter(mask.ctx)) return;
    const byWidth = new Map();
    for (const op of ops) {
      if (!byWidth.has(op.w)) byWidth.set(op.w, []);
      byWidth.get(op.w).push(op);
    }
    for (const [w, group] of byWidth) {
      mask.ctx.filter = `blur(${blurForWidth(w).toFixed(2)}px)`;
      strokeOps(mask.ctx, group, 0, '#000');
    }
    mask.ctx.filter = 'none';
    layer.ctx.save();
    layer.ctx.globalCompositeOperation = 'destination-in';
    layer.ctx.drawImage(mask.canvas, 0, 0);
    layer.ctx.restore();
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
  // There are TWO of these canvases now, both in scene.roadGeomContainer: the
  // dilapidated base (added first) and the restored pass over it. They share
  // the recording front-end below — the difference is entirely in commit().
  const TEX_KEY = 'roadgeom_overlay';

  // A scratch canvas the size of a pass's texture. Needed wherever a pattern
  // must land on SOME of the network instead of all of it: a pattern fill is
  // a whole-canvas operation, so the strokes it should mask against are
  // replayed here on their own, the pattern is composited against THOSE, and
  // the finished layer is drawn back onto the real canvas.
  function scratchLayer(size) {
    if (typeof document === 'undefined') return null;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const cx = c.getContext('2d');
    if (!cx) return null;
    cx.lineCap = 'round';
    cx.lineJoin = 'round';
    return { canvas: c, ctx: cx };
  }

  // One replay of a recorded op list. `delta` widens (fringe) or narrows
  // (repair / kerb) every path; the floor keeps a hairline way from vanishing
  // outright. `css` overrides the recorded colour (the kerb's pale pass).
  function strokeOps(ctx, ops, delta, css) {
    for (const op of ops) {
      ctx.lineWidth = Math.max(1, op.w + delta);
      ctx.strokeStyle = css || cssOf(op.c);
      ctx.beginPath();
      ctx.moveTo(op.pts[0], op.pts[1]);
      for (let i = 2; i < op.pts.length; i += 2) ctx.lineTo(op.pts[i], op.pts[i + 1]);
      ctx.stroke();
    }
  }

  // World-phased pattern fill (stones, edge noise, weathering and the clean
  // setts all share the anchoring): translating by the phase pins the tile to
  // the world, and the fill runs a tile wider on every side to cover what the
  // shift pushes off the canvas. The phase is kept UNWRAPPED on the pass and
  // wrapped per tile here — the tiles are different sizes (32 and 64), and a
  // phase wrapped to the wrong one would jump the pattern half a tile every
  // time the camera crossed a cell.
  function patternFill(ctx, pass, pattern, composite, tilePx) {
    const wrap = (v) => ((v % tilePx) + tilePx) % tilePx;
    ctx.save();
    ctx.globalCompositeOperation = composite;
    ctx.fillStyle = pattern;
    ctx.translate(wrap(pass.phaseX), wrap(pass.phaseY));
    ctx.fillRect(-tilePx, -tilePx, pass.size + tilePx * 2, pass.size + tilePx * 2);
    ctx.restore();
  }

  // Patterns belong to the context that made them, so they are cached per pass.
  function patternOf(ctx, cache, name, tile) {
    if (cache[name] === undefined) cache[name] = (tile && ctx.createPattern(tile, 'repeat')) || null;
    return cache[name];
  }

  // The recording front-end shared by both canvases: a Graphics-shaped object
  // whose strokes are buffered as ops (the passes below need the network more
  // than once) and replayed by commit().
  function beginCanvasPass(scene, texKey, alpha) {
    if (typeof document === 'undefined' || !scene.textures || !scene.roadGeomContainer) return null;
    const pad = CELL_PX * 2;
    const size = Math.ceil(scene.viewSize + pad * 2);
    const originX = scene.viewLeft - pad, originY = scene.viewTop - pad;
    if (scene.textures.exists(texKey)) scene.textures.remove(texKey);
    const tex = scene.textures.createCanvas(texKey, size, size);
    if (!tex) return null;
    const ctx = tex.getContext();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const img = scene.add.image(originX, originY, texKey).setOrigin(0, 0).setAlpha(alpha);
    scene.roadGeomContainer.add(img);
    const pass = {
      ctx, tex, size, originX, originY, image: img,
      ops: [], decorOps: [], erases: [], pats: {},
      // Screen position the world origin projected to in this pass, relative
      // to the canvas — see patternFill.
      phaseX: 0, phaseY: 0,
    };
    let curStyle = { w: 1, c: ROAD_COLOR };
    let curPts = null;
    pass.target = {
      clear() {
        pass.ops = []; pass.decorOps = []; pass.erases = []; curPts = null;
        ctx.clearRect(0, 0, size, size);
      },
      // The alpha is carried by the IMAGE (see above), so the stroke itself is
      // always opaque; the colour is the caller's (earth for roads, slate for
      // rail, near-black for a restored street) and the alpha argument is
      // deliberately ignored here.
      lineStyle(w, c) { curStyle = { w, c: c == null ? ROAD_COLOR : c }; },
      beginPath() { curPts = []; },
      moveTo(x, y) { curPts.push(x - originX, y - originY); },
      lineTo(x, y) { curPts.push(x - originX, y - originY); },
      strokePath() {
        if (curPts && curPts.length >= 4) pass.ops.push({ w: curStyle.w, c: curStyle.c, pts: curPts });
        curPts = null;
      },
      // Punch a cell-sized hole in the finished band. Recorded and applied
      // after every paint pass — an immediate clearRect would be repainted
      // by the repair pass; clearRect rather than a destination-out fill so
      // the hole is exact and costs nothing to composite.
      eraseRect(x, y, w, h) { pass.erases.push([x - originX, y - originY, w, h]); },
      // Track furniture (railway ties + rails). Stroked plain in commit() —
      // after the gravel so it stays crisp, before the erases so the keep-out
      // cells punch it out along with the ballast.
      decorPath(w, c, pts) {
        if (pts && pts.length >= 2) {
          pass.decorOps.push({ w, c, pts: pts.map((p) => ({ x: p.x - originX, y: p.y - originY })) });
        }
      },
      texturePhase(x, y) { pass.phaseX = Math.round(x - originX); pass.phaseY = Math.round(y - originY); },
    };
    return pass;
  }

  // ── The dilapidated pass ─────────────────────────────────────────────────
  function commitBase(pass) {
    const { ctx, size } = pass;
    ctx.clearRect(0, 0, size, size);
    // Fringe pass at true width, then eat random bites out of everything…
    strokeOps(ctx, pass.ops, 0);
    const noise = patternOf(ctx, pass.pats, 'edge', edgeNoiseTile());
    if (noise && pass.ops.length) {
      patternFill(ctx, pass, noise, 'destination-out', STONE_TILE_PX);
      // …and repair the interior: the bites survive only in the outer
      // EDGE_FRINGE_PX of each band, which is the rough edge.
      strokeOps(ctx, pass.ops, -EDGE_FRINGE_PX);
    }
    // source-atop keeps the stones inside what's already drawn — the
    // nibbled silhouette included — so they never leak off the ways. Laid
    // BEFORE the track furniture, so ties and rails stay untextured.
    const stones = patternOf(ctx, pass.pats, 'stone', stoneTile());
    if (stones) patternFill(ctx, pass, stones, 'source-atop', STONE_TILE_PX);
    // Weathering, on the ROADS only. A rail band is ballast and gets none, but
    // the stone pattern above is one fill over the whole network — there is no
    // per-way pass to opt out of. So the cracks are masked instead: the road
    // ops alone are replayed on a scratch layer, the tile is composited
    // 'source-in' against THAT (pattern ∩ roads), and the result is drawn back
    // source-atop. One extra layer per rebuild — and rebuilds are rare — where
    // re-stroking the rail runs plain afterwards would have wiped their gravel
    // off with the cracks, and a clip path can't be built from a stroke at all.
    // Rail is identified by its colour: RAIL_COLOR has exactly one source.
    const roadOps = pass.ops.filter((op) => op.c !== RAIL_COLOR);
    if (roadOps.length) {
      const layer = scratchLayer(size);
      const tile = weatherTile();
      if (layer && tile) {
        // The repaired width, so weathering never lands in the nibbled fringe.
        strokeOps(layer.ctx, roadOps, -EDGE_FRINGE_PX);
        const pat = layer.ctx.createPattern(tile, 'repeat');
        if (pat) {
          patternFill(layer.ctx, pass, pat, 'source-in', WEATHER_TILE_PX);
          ctx.save();
          ctx.globalCompositeOperation = 'source-atop';
          ctx.drawImage(layer.canvas, 0, 0);
          ctx.restore();
        }
      }
    }
    for (const op of pass.decorOps) {
      ctx.lineWidth = op.w;
      ctx.strokeStyle = cssOf(op.c);
      ctx.beginPath();
      ctx.moveTo(op.pts[0].x, op.pts[0].y);
      for (let i = 1; i < op.pts.length; i++) ctx.lineTo(op.pts[i].x, op.pts[i].y);
      ctx.stroke();
    }
    // Land only, and never over a floor — applied LAST so the keep-out
    // holes punch through band, gravel, cracks and track alike.
    for (const [x, y, w, h] of pass.erases) ctx.clearRect(x, y, w, h);
    pass.tex.refresh();
  }

  // ── The restored pass ────────────────────────────────────────────────────
  // No edge NIBBLE here — the ragged bites the base pass eats out of its own
  // band are what "dilapidated" looks like, and a rebuilt street is whole.
  // Its outline is still SOFT rather than sharp (see "The patch is SOFT"): the
  // patch is finished crisp and then feathered as a last step, so the setts
  // stay clean while the silhouette melts into the band it sits on.
  // Roads and paths are laid as two SEPARATE layers because their clean tiles
  // differ (the path's mortar is halved) and a pattern fill is a whole-canvas
  // operation — one fill after both were stroked would texture the roads
  // twice. Roads go down first so a footpath crossing a street reads on top,
  // matching the base pass's widest-first order.
  function commitRestored(pass) {
    const { ctx, size } = pass;
    ctx.clearRect(0, 0, size, size);
    for (const isPath of [false, true]) {
      const want = isPath ? RESTORED_PATH_COLOR : RESTORED_ROAD_COLOR;
      const ops = pass.ops.filter((op) => op.c === want);
      if (!ops.length) continue;
      const layer = scratchLayer(size);
      if (!layer) break;
      const lx = layer.ctx;
      const tile = cleanTile(isPath);
      const pat = tile && lx.createPattern(tile, 'repeat');
      strokeOps(lx, ops, 0);
      if (pat) patternFill(lx, pass, pat, 'source-atop', CLEAN_TILE_PX);
      // The kerb: wash the whole band pale, cover all but the outer pixel
      // back up in the band colour, then re-lay the setts over the repair.
      // What survives is a hairline light edge — a built kerb, not an outline.
      lx.save();
      lx.globalCompositeOperation = 'source-atop';
      strokeOps(lx, ops, 0, `rgba(255,255,255,${KERB_ALPHA})`);
      strokeOps(lx, ops, -KERB_INSET_PX);
      lx.restore();
      if (pat) patternFill(lx, pass, pat, 'source-atop', CLEAN_TILE_PX);
      // …and last, melt the silhouette's edge into the band under it.
      softenEdge(layer, size, ops);
      ctx.drawImage(layer.canvas, 0, 0);
    }
    for (const [x, y, w, h] of pass.erases) ctx.clearRect(x, y, w, h);
    pass.tex.refresh();
  }

  function canvasTarget(scene) {
    if (scene._roadGeomTarget) return scene._roadGeomTarget;
    const pass = beginCanvasPass(scene, TEX_KEY, ALPHA);
    if (!pass) return null;
    pass.target.commit = () => commitBase(pass);
    scene._roadGeomTarget = pass.target;
    return pass.target;
  }

  function canvasRestoredTarget(scene) {
    if (scene._roadRestoredTarget) return scene._roadRestoredTarget;
    const pass = beginCanvasPass(scene, RESTORED_TEX_KEY, RESTORED_ALPHA);
    if (!pass) return null;
    pass.target.commit = () => commitRestored(pass);
    scene._roadRestoredTarget = pass.target;
    // The live Graphics (drawLive) belongs above both images; if it was
    // created before this pass existed, put it back on top.
    const c = scene.roadGeomContainer;
    if (scene.roadLiveGfx && c && c.bringToTop) c.bringToTop(scene.roadLiveGfx);
    return pass.target;
  }

  // Prefer a scene-provided Graphics-shaped object (the headless tests inject
  // one); otherwise build the canvas adapter. The restored pass has no
  // fallback: a scene that provides no roadRestoredGfx and can't build a
  // canvas simply doesn't get one (the base band still draws).
  function strokeTarget(scene) {
    return scene.roadGeomGfx || canvasTarget(scene);
  }
  function restoredTarget(scene) {
    return scene.roadRestoredGfx || canvasRestoredTarget(scene);
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
    // Always on at the surface — the ☰ toggle it once had is gone (the band
    // IS how roads look now, not a debug aid). Only depth gates it: cave
    // tiles have no MVT layers to stroke.
    const on = (scene.depth ?? 0) === 0;
    if (container) container.setVisible(on);
    if (!on) {
      if (scene._roadGeomKey !== null) {
        g.clear();
        if (g.commit) g.commit();
        // Only a restored pass that already EXISTS is blanked — underground
        // there is nothing to restore, so there is no reason to build one.
        const r = scene.roadRestoredGfx || scene._roadRestoredTarget;
        if (r) { r.clear(); if (r.commit) r.commit(); }
        scene._roadGeomKey = null;
      }
      return;
    }

    // Camera anchor, not the body — a peek drag repaints the bands over the
    // ground they belong to (coords.js overlayFrame → viewAnchorCell). The
    // rebuild key below is the snapped anchor cell, so a peek that crosses a
    // cell boundary repaints exactly as walking across one does — plus which
    // of the 3×3 tiles have their MVT layers in hand, so a tile that finishes
    // loading (or gets evicted and rebuilt) repaints even while the player
    // stands still.
    const { fracX, fracY, baseCellIX, baseCellIY, tiles, ready } =
      overlayFrame(scene, (entry) => !!entry.layers);
    // …and the STREETS epoch, which Streets.restore bumps whenever a stretch
    // is newly rebuilt. That's what repaints the restored canvas the frame
    // after a restore — and, because it only moves when something changed,
    // what keeps a standing player from repainting either canvas per frame.
    const epoch = (typeof Streets !== 'undefined' && scene.save) ? Streets.epoch(scene.save) : 0;
    const key = `${baseCellIX},${baseCellIY},${ready},${epoch}`;
    if (key !== scene._roadGeomKey) {
      scene._roadGeomKey = key;
      timedOverlayRebuild('road overlay rebuild',
        () => rebuild(scene, tiles, fracX, fracY, baseCellIX, baseCellIY));
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
    // The building half of the keep-out only applies while buildings ARE their
    // cells. In polygonal mode (building_overlay.js) those cells are painted as
    // plain ground and the footprint is drawn from its source ring in a layer
    // ABOVE this one — so punching them out would cut a staircase of holes in
    // the road wherever a building's old cells fell, next to a polygon that
    // covers the band by itself. Water is unconditional either way.
    const polyB = typeof BuildingOverlay !== 'undefined' && BuildingOverlay.enabled();
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
          const e = WorldGen.tileCache.get(WorldGen.tileKey(tx, ty));
          curGrid = (e && e.grid) || null;
        }
        if (!curGrid) continue;
        const t = curGrid[iy * N + ix];
        if (t !== WATER_T && (polyB || !WorldGen.isBuildingTerrain(t))) continue;
        g.eraseRect(scene.viewCenterX + ox * CELL_PX,
                    scene.viewCenterY + oy * CELL_PX, CELL_PX, CELL_PX);
      }
    }
  }

  // Split one polyline (WORLD METRES) into runs of consecutive ON-SCREEN
  // segments and hand each to `add`. A run is broken wherever a segment is
  // wholly outside the padded viewport — the skipped stretch would otherwise
  // be drawn as a straight shortcut across the view.
  function emitRuns(pts, proj, add) {
    const { projX, projY, minX, maxX, minY, maxY } = proj;
    let px = projX(pts[0].x), py = projY(pts[0].y);
    let run = [{ x: px, y: py }];
    for (let i = 1; i < pts.length; i++) {
      const qx = projX(pts[i].x), qy = projY(pts[i].y);
      const offscreen =
        (px < minX && qx < minX) || (px > maxX && qx > maxX) ||
        (py < minY && qy < minY) || (py > maxY && qy > maxY);
      if (offscreen) { add(run); run = [{ x: qx, y: qy }]; }
      else run.push({ x: qx, y: qy });
      px = qx; py = qy;
    }
    add(run);
  }

  // Stroke a style-bucketed collection — widest first, so a narrow street
  // crossing a motorway still reads as its own stroke on top. Sorted rather
  // than insertion-ordered so the draw order doesn't depend on which tile
  // happened to load first; ties (same width, different colour) break on the
  // colour so the order is fully determined.
  function strokeBuckets(g, runsByStyle, alpha) {
    const styles = [...runsByStyle.values()]
      .sort((a, b) => (b.widthPx - a.widthPx) || (a.color - b.color));
    for (const { widthPx, color, runs } of styles) {
      g.lineStyle(widthPx, color, alpha);
      for (const run of runs) {
        g.beginPath();
        g.moveTo(run[0].x, run[0].y);
        for (let i = 1; i < run.length; i++) g.lineTo(run[i].x, run[i].y);
        g.strokePath();
      }
    }
  }

  // Iterate every transportation LINE of every tile in the frame:
  // fn(feature, line, lineIdx, mvtToM, originMx, originMy, tileKey).
  function eachTransportLine(tiles, fn) {
    for (const { tx, ty, entry } of tiles) {
      const tileEdgeM = entry.tileEdgeM;
      const originMx = tx * tileEdgeM;
      const originMy = ty * tileEdgeM;
      const tileKey = WorldGen.tileKey(tx, ty);
      for (const layer of entry.layers) {
        if (layer.name !== 'transportation') continue;
        const mvtToM = tileEdgeM / (layer.extent || MVT_EXTENT);
        for (const f of layer.features) {
          if (f.type !== 2 || !f.geom) continue;   // lines only (2 = LineString)
          for (let i = 0; i < f.geom.length; i++) {
            const line = f.geom[i];
            if (!line || line.length < 2) continue;
            fn(f, line, i, mvtToM, originMx, originMy, tileKey);
          }
        }
      }
    }
  }

  function rebuild(scene, tiles, fracX, fracY, baseCellIX, baseCellIY) {
    // Cell-snapped projection from the camera anchor (the container re-applies
    // the sub-cell offset) and the padded cull bounds — a segment whose
    // endpoints both sit outside the padded viewport can still cross it, so
    // the pad is a full cell wider than the sub-cell scroll can ever reveal.
    // Both passes share it, so the restored metres land exactly on the band
    // they were restored from.
    const proj = overlayProjection(scene, fracX, fracY);
    rebuildBase(scene, tiles, proj, baseCellIX, baseCellIY);
    rebuildRestored(scene, tiles, proj, baseCellIX, baseCellIY);
  }

  // ── The dilapidated network ──────────────────────────────────────────────
  function rebuildBase(scene, tiles, proj, baseCellIX, baseCellIY) {
    const g = strokeTarget(scene);
    if (!g) return;
    g.clear();
    const { projX, projY } = proj;

    // Ways are collected into runs of consecutive ON-SCREEN segments, bucketed
    // by stroke STYLE (width + colour), and stroked as PATHS rather than loose
    // segments: a wide band drawn segment-by-segment leaves a notch at every
    // bend, and one lineStyle per style beats one per feature.
    const runsByStyle = new Map();   // "widthPx|color" -> { widthPx, color, runs }
    const railRuns = [];             // rail-class runs, for the track furniture pass
    const addRun = (widthPx, color, run, isRail) => {
      if (run.length < 2) return;
      const k = `${widthPx}|${color}`;
      let bucket = runsByStyle.get(k);
      if (!bucket) { bucket = { widthPx, color, runs: [] }; runsByStyle.set(k, bucket); }
      bucket.runs.push(run);
      if (isRail) railRuns.push(run);
    };

    eachTransportLine(tiles, (f, line, i, mvtToM, originMx, originMy) => {
      const widthPx = widthPxFor(scene, f.tags);
      const color = colorFor(f.tags);
      const isRail = RAIL_CLASSES.has((f.tags && f.tags.class) || '');
      const pts = line.map((p) => ({ x: originMx + p.x * mvtToM, y: originMy + p.y * mvtToM }));
      emitRuns(pts, proj, (run) => addRun(widthPx, color, run, isRail));
    });

    strokeBuckets(g, runsByStyle, ALPHA);
    // Dress the railways as track — ties + rails over the ballast band. Only
    // when the target can draw decor (the canvas adapter); the headless test
    // stub gets the plain band.
    if (g.decorPath) for (const run of railRuns) emitRailDecor(scene, g, run);
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

  // ── The restored metres ──────────────────────────────────────────────────
  // Same walk, but each line is asked what the player has REBUILT of it: an
  // interval list of metres along the line, from the save through Streets (the
  // raw save shape is never read here). Each interval becomes its own exact
  // sub-polyline, so a restored stretch ends where the player's dwell ended
  // rather than at the nearest vertex.
  //
  // Rail is skipped outright: a railway is not a street to rebuild.
  function rebuildRestored(scene, tiles, proj, baseCellIX, baseCellIY) {
    const g = restoredTarget(scene);
    if (!g) return;
    g.clear();
    const { projX, projY } = proj;
    const S = (typeof Streets !== 'undefined') ? Streets : null;
    if (S && scene.save) {
      const runsByStyle = new Map();
      const addRun = (widthPx, color, run) => {
        if (run.length < 2) return;
        const k = `${widthPx}|${color}`;
        let bucket = runsByStyle.get(k);
        if (!bucket) { bucket = { widthPx, color, runs: [] }; runsByStyle.set(k, bucket); }
        bucket.runs.push(run);
      };
      eachTransportLine(tiles, (f, line, i, mvtToM, originMx, originMy, tileKey) => {
        if (RAIL_CLASSES.has((f.tags && f.tags.class) || '')) return;
        const list = S.restoredList(scene.save, tileKey, S.lineKey(f, i));
        if (!list || !list.length) return;
        const widthPx = widthPxFor(scene, f.tags);
        const color = restoredColorFor(f.tags);
        for (const iv of list) {
          const sub = S.subLineM(line, mvtToM, iv[0], iv[1]);
          if (!sub || sub.length < 2) continue;
          const pts = sub.map((p) => ({ x: originMx + p.x, y: originMy + p.y }));
          emitRuns(pts, proj, (run) => addRun(widthPx, color, run));
        }
      });
      strokeBuckets(g, runsByStyle, RESTORED_ALPHA);
    }
    keepOut(scene, g, baseCellIX, baseCellIY);
    if (g.texturePhase) g.texturePhase(projX(0), projY(0));
    if (g.commit) g.commit();
  }

  // ── The live pass ────────────────────────────────────────────────────────
  // Everything the overlay draws that changes EVERY frame: the dwell preview
  // creeping along a street the player is standing over, and the minty-green
  // shine that runs down a stretch the moment it is rebuilt. Those can't live on
  // either canvas — a canvas rebuild is a hundred strokes and a handful of
  // pattern fills, and this changes sixty times a second — so they go on a
  // plain Phaser Graphics, cleared and re-stroked per frame. Usually 0–10
  // short runs.
  //
  // Two things to know about the seating:
  //   • the points are projected through scene.worldMetersToScreen — the
  //     camera-anchored projection, so a peek drag carries the preview with
  //     the ground, exactly as it carries the bands;
  //   • the Graphics sits INSIDE roadGeomContainer (so it stays above both
  //     images and inside the same mask), and draw() moves that container by
  //     the sub-cell scroll every frame — which worldMetersToScreen already
  //     accounts for. So the container's own offset is subtracted back out,
  //     or the preview would run half a cell ahead of the band under it.
  // Phaser's Graphics has no lineCap, so these runs end square where the
  // canvas bands end round; at preview alphas that is not worth a second
  // canvas.
  function drawLive(scene, runs) {
    const container = scene.roadGeomContainer;
    let g = scene.roadLiveGfx;
    if (!g) {
      if (!container || !scene.add || typeof scene.add.graphics !== 'function') return;
      g = scene.add.graphics();
      scene.roadLiveGfx = g;
      container.add(g);
      if (container.bringToTop) container.bringToTop(g);
    }
    g.clear();
    if (!runs || !runs.length || typeof scene.worldMetersToScreen !== 'function') return;
    const ox = container ? (container.x || 0) : 0;
    const oy = container ? (container.y || 0) : 0;
    for (const run of runs) {
      const pts = run && run.pts;
      if (!pts || pts.length < 2) continue;
      const color = run.colour == null ? restoredColorFor(run.tags) : run.colour;
      g.lineStyle(widthPxFor(scene, run.tags), color, run.alpha == null ? 1 : run.alpha);
      g.beginPath();
      for (let i = 0; i < pts.length; i++) {
        const s = scene.worldMetersToScreen(pts[i].x, pts[i].y);
        if (i) g.lineTo(s.x - ox, s.y - oy); else g.moveTo(s.x - ox, s.y - oy);
      }
      g.strokePath();
    }
  }

  global.RoadOverlay = { draw, invalidate, drawLive, paintWeatherTile, paintCleanTile,
                         paintLampStone, LAMP_TEX_PX, LAMP_DRAW_CELLS,
                         RESTORED_BLUR_PX, RESTORED_BLUR_FRAC, blurForWidth, softenEdge };
})(window);
