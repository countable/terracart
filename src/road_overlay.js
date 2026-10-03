// Original OSM road geometry overlay.
//
// The world's roads reach the player as CELLS: worldgen rasterizes each
// `transportation` line from the vector tile into a one-cell-wide band of
// ROAD/PATH tiles (see worldgen.js classifyLine / paintLine). That's a lossy
// step — a diagonal way becomes a staircase, two ways closer than a cell weld
// together. This layer draws the SOURCE linework straight from the decoded
// MVT features on top of the map, as a soft brown band, so the rasterized
// roads can be eyeballed against the real ways they came from. Parking-lot
// lanes draw no band: they are cut out of entry.layers before this reads it
// (WorldGen.isLotLane / pruneLotLanesSteps) — a parking lot reads as open
// ground with its treasure X on it, not as asphalt. Railways are drawn in slate
// instead of earth — the
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
//     startWorldM, playerM, cellM, cellsPerTile / cellsForRow (coords.js), depth,
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
  // Warm, muted earth brown rather than black: the ways read as packed track
  // over the biome colours, in the same family as the cobble the rasterizer
  // paints, and the cobblestone texture below needs a quiet base.
  // ROAD_COLOR (carriageways) is desaturated further AND darkened so a paved
  // street reads as a harder surface than a dirt path, not just a wider band.
  const PATH_COLOR = 0x948b75;
  const ROAD_COLOR = 0x79766c;
  const ALPHA = 0.61;    // reads as a band without hiding the map
  const MVT_EXTENT = 4096;

  // WorldGen.PATH_CLASSES itself, so a way that rasterizes as a footpath also
  // overlays as one.
  const PATH_CLASSES = WorldGen.PATH_CLASSES;

  // Rail is not road: the rasterizer has no tier for it, so the overlay says
  // otherwise with cold steel-slate. The
  // classes are OpenMapTiles' rail family (`rail` covers heavy rail and its
  // subclasses; `transit` covers tram / subway / light_rail).
  const RAIL_CLASSES = new Set(['rail', 'transit']);
  const RAIL_COLOR = 0x838a8c;

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

  // A polyline pushed `off` to its left (negative: right), each vertex along
  // the mean of its two segment normals. Pure; the carpet strips use it.
  function offsetLine(pts, off) {
    const n = pts.length, out = [];
    const norm = (a, b) => {
      const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy);
      return l > 1e-9 ? { x: -dy / l, y: dx / l } : null;
    };
    for (let i = 0; i < n; i++) {
      const a = i > 0 ? norm(pts[i - 1], pts[i]) : null, b = i < n - 1 ? norm(pts[i], pts[i + 1]) : null;
      let nx = (a ? a.x : 0) + (b ? b.x : 0), ny = (a ? a.y : 0) + (b ? b.y : 0);
      const l = Math.hypot(nx, ny);
      if (l < 1e-9) { out.push({ x: pts[i].x, y: pts[i].y }); continue; }
      nx /= l; ny /= l;
      const k = a && b ? Math.max(0.5, nx * a.x + ny * a.y) : 1;   // cap the mitre
      out.push({ x: pts[i].x + nx * off / k, y: pts[i].y + ny * off / k });
    }
    return out;
  }

  // ── Carpet emblems ───────────────────────────────────────────────────────
  // A carpet row's repeating mark (StreetVariants carpetEmblemFor), stamped
  // down the strip's centre line every CARPET_EMBLEM_STEP_PX of run. Drawn
  // UPRIGHT on screen, not turned with the road: an emblem reads as one only
  // the right way up. Shapes are polylines in px about the stamp point, sized
  // to sit inside the 0.6-cell strip.
  const CARPET_EMBLEM_STEP_PX = 32;   // one crown a cell
  const CARPET_EMBLEM_W_PX = 1.5;
  const CARPET_EMBLEMS = {
    // The ancient religion's diamond; the crown below belongs to its rulers.
    diamond: [[{ x: 0, y: -5 }, { x: 4, y: 0 }, { x: 0, y: 5 }, { x: -4, y: 0 }, { x: 0, y: -5 }]],
    // A simple three-point crown on a band.
    crown: [[{ x: -5, y: 3 }, { x: -5, y: -3 }, { x: -2.5, y: 0 }, { x: 0, y: -4 },
      { x: 2.5, y: 0 }, { x: 5, y: -3 }, { x: 5, y: 3 }, { x: -5, y: 3 }]],
  };
  function emitCarpetEmblems(g, run, emblem) {
    const shape = emblem && CARPET_EMBLEMS[emblem.kind];
    if (!shape) return;
    let next = CARPET_EMBLEM_STEP_PX / 2;
    for (let i = 1; i < run.length; i++) {
      const ax = run[i - 1].x, ay = run[i - 1].y;
      const dx = run[i].x - ax, dy = run[i].y - ay;
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) continue;
      while (next <= len) {
        const cx = ax + dx / len * next, cy = ay + dy / len * next;
        for (const poly of shape) {
          g.decorPath(CARPET_EMBLEM_W_PX, emblem.ink, poly.map((p) => ({ x: cx + p.x, y: cy + p.y })));
        }
        next += CARPET_EMBLEM_STEP_PX;
      }
      next -= len;
    }
  }

  // Shared by the map and dashboard: translucent nested strokes soften the
  // edge without requiring Canvas filters or a separate preview-only blur.
  function emitCarpetStrip(g, run, variant, cellPx = CELL_PX) {
    const style = global.StreetVariants?.carpetStyleFor(variant);
    if (!style || run.length < 2 || !g.decorPath) return;
    const w = style.widthCells * cellPx;
    const feather = style.featherCells * cellPx;
    if (feather > 0) {
      const layers = 8;
      for (let i = layers; i >= 0; i--) {
        g.decorPath(w + 2 * feather * i / layers, style.color, run, 0.16);
      }
    } else g.decorPath(w, style.color, run);
    emitCarpetEmblems(g, run, style.emblem);
  }

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

  // Cells the overlay must not paint over, punched out of the finished canvas
  // (see keepOut below): WATER, so the linework stays on land instead of
  // laying a brown band across a lake wherever a bridge or a shoreline way
  // runs, and the three BUILDING tiers (WorldGen.isBuildingTerrain), whose
  // floors — a house's boards, the castle's court paving — should read as the
  // top surface there rather than having a road drawn across them.
  const WATER_T = WorldGen.T.WATER;

  // The big ways (motorway / trunk / primary, worldgen's ROAD_LG tier) are
  // stroked half again as wide as their carriageway so the road hierarchy
  // stays legible. That weighting lives in WorldGen.roadOverlayWidthM, NOT here: worldgen
  // stamps its no-spawn road mask from the same function, so the ground drawn
  // as road and the ground barred from spawning are the same ground by
  // construction. Widening a band here alone would put rocks back in the
  // traffic.

  // Stroke width for one way: the width it covers on the ground, drawn at the
  // map's own scale (one cell = scene.cellM metres = CELL_PX pixels). No
  // fallback width: a private number here is exactly the drift between "drawn
  // as road" and roadMask that the shared function exists to prevent.
  function widthPxFor(scene, tags) {
    const m = WorldGen.roadOverlayWidthM(tags || {});
    return Math.max(1, (m / scene.cellM) * CELL_PX);
  }

  // Fixed-seed LCG, not Math.random: the pattern tiles are identical every
  // session.
  //
  // NOT textures.js' seededRand: it divides by 0xffffffff rather than 2^32 (so
  // it can return exactly 1.0) and shares no stream with this one; changing
  // either divisor re-rolls the baked tiles. Left apart on purpose.
  function lcg(seed) {
    return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  }

  // ── Cobblestone ──────────────────────────────────────────────────────────
  // ONE small tile of little rounded stones is drawn once, made into a
  // repeating canvas pattern, and painted over the finished network in a
  // SINGLE source-atop fillRect — so it lands only on pixels a way already
  // covers, at one fill per rebuild however many ways are on screen (a
  // patterned strokeStyle per way would pay per stroke and texture joins
  // unevenly). Rebuilds only run on a cell crossing or tile load.
  //
  // Every mark is monochrome black/white at low alpha composited source-atop,
  // so the texture only MODULATES light/dark and never introduces a new hue.
  //
  // Each stone is an IRREGULAR polygon with a plain dark edge and no gloss; a
  // round stone with highlight/shadow dots read as a tray of bubbles.
  const STONE_TILE_PX = SpriteLayout.CELL_PX; // repeat every cell
  const STONE_COLS = 4, STONE_ROWS = 4;    // small stones — a 4×4 grid per tile
  const STONE_GROUT_ALPHA = 0.16;    // dark wash first — the seams between stones
  const STONE_EDGE_ALPHA = 0.30;     // dark outline stroke around each stone
  const STONE_FACE_ALPHA_MIN = 0.06; // per-stone face tone varies within this
  const STONE_FACE_ALPHA_MAX = 0.16; // range so neighbours don't read identical
  // ── Rough edges ──────────────────────────────────────────────────────────
  // A clean vector edge reads as tape over the map, so the silhouette is
  // nibbled, in stroke passes at commit time:
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
  // The noise tile is world-phased exactly like the cobbles, so the bites sit
  // still on the road as the player walks.
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
    // Grout wash: a faint dark tone over the whole tile first, so the margin
    // between stones reads as a recessed seam.
    cx.fillStyle = `rgba(0,0,0,${STONE_GROUT_ALPHA})`;
    cx.fillRect(0, 0, STONE_TILE_PX, STONE_TILE_PX);
    cx.lineWidth = 1;
    const cellW = STONE_TILE_PX / STONE_COLS, cellH = STONE_TILE_PX / STONE_ROWS;
    for (let row = 0; row < STONE_ROWS; row++) {
      for (let col = 0; col < STONE_COLS; col++) {
        // Jitter each stone's centre so the repeat doesn't read as a grid.
        const jx = (rnd() - 0.5) * cellW * 0.3;
        const jy = (rnd() - 0.5) * cellH * 0.3;
        const px = col * cellW + cellW / 2 + jx;
        const py = row * cellH + cellH / 2 + jy;
        const r = Math.min(cellW, cellH) * 0.42;
        const sides = 6 + Math.floor(rnd() * 3);
        cx.beginPath();
        for (let i = 0; i < sides; i++) {
          const ang = (i / sides) * Math.PI * 2;
          const rr = r * (0.7 + rnd() * 0.45);
          const vx = px + Math.cos(ang) * rr, vy = py + Math.sin(ang) * rr;
          if (i === 0) cx.moveTo(vx, vy); else cx.lineTo(vx, vy);
        }
        cx.closePath();
        // Flat face at a per-stone alpha so neighbours read as separate pavers.
        const faceAlpha = STONE_FACE_ALPHA_MIN + rnd() * (STONE_FACE_ALPHA_MAX - STONE_FACE_ALPHA_MIN);
        cx.fillStyle = `rgba(255,255,255,${faceAlpha})`;
        cx.fill();
        cx.strokeStyle = `rgba(0,0,0,${STONE_EDGE_ALPHA})`;
        cx.stroke();
      }
    }
    stoneCanvas = c;
    return stoneCanvas;
  }

  // ── Weathering ───────────────────────────────────────────────────────────
  // One more pattern tile, laid source-atop after the stones, carrying the
  // marks of a neglected street: hairline cracks with a pale lifted lip, damp
  // patches, lichen/dust blooms and dark pits where a stone has gone.
  //
  // The alphas are bold on purpose: the whole canvas is shown at ALPHA (0.61),
  // so a mark drawn at 0.3 arrives as 0.18 and reads as nothing. Fixed-seed
  // and world-phased through texturePhase like the stones.
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

  // A soft round bloom: a radial gradient falling to zero over its bounding square.
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
  // one: the base pass draws every way in full and the restored pass paints
  // the rebuilt metres on top of it.
  //
  // Near-black, the one thing the biome palette never contains, so a restored
  // street reads as a different surface from far off. Paths restore to dark
  // packed earth instead (basalt setts would read as a road). Rail never
  // restores.
  const RESTORED_ALPHA = 0.92;         // near-opaque: the rebuilt street is the surface
  const RESTORED_ROAD_COLOR = 0x161412;
  const RESTORED_PATH_COLOR = 0x2e2620;
  const RESTORED_TEX_KEY = 'roadgeom_restored';
  const restoredColorFor = (tags) =>
    (PATH_CLASSES.has((tags && tags.class) || '') ? RESTORED_PATH_COLOR : RESTORED_ROAD_COLOR);

  // The clean cobble tile: brick-staggered courses of small rounded setts on a
  // pale mortar wash. Its regularity IS the restoration. Paths get the same
  // tile with the mortar wash halved (packed earth has little mortar).
  const CLEAN_TILE_PX = 32;
  // Bright enough to read as mortar lines from across the street without
  // competing with the setts (lower and the band reads as one flat slab).
  const CLEAN_MORTAR_ALPHA = 0.22;
  const CLEAN_PATH_MORTAR_MUL = 0.5;
  const CLEAN_COLS = 6, CLEAN_ROWS = 8;   // 6 setts across, 8 courses down
  const CLEAN_SETT_R = 1.6;          // corner radius
  const CLEAN_GAP_X = 1.5, CLEAN_GAP_Y = 1.2;   // mortar gaps between setts, px
  const CLEAN_TONE_MIN = 0.05, CLEAN_TONE_MAX = 0.12;  // per-stone tone
  // The top bevel catch-light: lower reads as texture noise, not a highlight.
  const CLEAN_BEVEL_ALPHA = 0.24;
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

  // One sett: body, a slight per-stone tone, and a catch-light on its top edge.
  function paintSett(cx, x, y, w, h, tone, stoneColor) {
    cx.fillStyle = stoneColor || '#000';
    roundRectPath(cx, x, y, w, h, CLEAN_SETT_R); cx.fill();
    cx.fillStyle = `rgba(255,255,255,${tone})`;
    roundRectPath(cx, x, y, w, h, CLEAN_SETT_R); cx.fill();
    cx.fillStyle = `rgba(255,255,255,${CLEAN_BEVEL_ALPHA})`;
    roundRectPath(cx, x + 0.5, y + 0.5, w - 1, h * CLEAN_BEVEL_H, 1); cx.fill();
  }

  function paintCleanTile(cx, size, mortarAlpha, stoneColor, pattern, accent) {
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
        paintSett(cx, x, y, w, h, tone, stoneColor);
        // A staggered course's last sett runs off the right edge; draw it again
        // one tile to the LEFT so the pattern meets itself where it repeats.
        if (x + w > S) paintSett(cx, x - S, y, w, h, tone, stoneColor);
      }
    }
  }

  function paintSpots(cx, size, accent) {
    cx.fillStyle = accent || '#d7dba3';
    cx.globalAlpha = 0.65;
    for (const [x, y, r] of [[0.18, 0.21, 0.09], [0.67, 0.38, 0.13], [0.35, 0.77, 0.08], [0.88, 0.88, 0.06]]) {
      cx.beginPath(); cx.arc(x * size, y * size, r * size, 0, Math.PI * 2); cx.fill();
    }
    cx.globalAlpha = 1;
  }

  // Shared preview swatch uses the same authored tiles and palette as the game.
  function paintPavementTile(cx, size, isPath, restored, variant) {
    const palette = global.StreetVariants?.VARIANT_BY_ID[variant]?.stone;
    const color = palette?.[restored ? 'restored' : 'weathered'];
    cx.fillStyle = color || cssOf(restored ? (isPath ? RESTORED_PATH_COLOR : RESTORED_ROAD_COLOR) : (isPath ? PATH_COLOR : ROAD_COLOR));
    cx.fillRect(0, 0, size, size);
    if (restored) paintCleanTile(cx, size, CLEAN_MORTAR_ALPHA * (isPath ? CLEAN_PATH_MORTAR_MUL : 1), color);
    else { const tile = stoneTile(); if (tile) cx.drawImage(tile, 0, 0, size, size); }
    if (palette?.pattern === 'spots') paintSpots(cx, size, palette.accent);
  }

  const cleanCanvas = {};
  function cleanTile(isPath, stoneColor, pattern, accent) {
    const k = `${isPath ? 'path' : 'road'}:${stoneColor || '#000'}:${pattern || ''}:${accent || ''}`;
    if (cleanCanvas[k] !== undefined) return cleanCanvas[k];
    cleanCanvas[k] = null;
    if (typeof document === 'undefined') return cleanCanvas[k];
    const c = document.createElement('canvas');
    c.width = c.height = CLEAN_TILE_PX;
    const cx = c.getContext('2d');
    if (!cx) return cleanCanvas[k];
    paintCleanTile(cx, CLEAN_TILE_PX, CLEAN_MORTAR_ALPHA * (isPath ? CLEAN_PATH_MORTAR_MUL : 1), stoneColor);
    if (pattern === 'spots') paintSpots(cx, CLEAN_TILE_PX, accent);
    cleanCanvas[k] = c;
    return cleanCanvas[k];
  }

  // ── The STREET LAMP ──────────────────────────────────────────────────────
  // The lamp a restored street carries every Streets.lampSpacingM() metres of
  // it; the light it throws is lighting.js's `cobble` row, and app.js puts
  // both on the SAME point.
  //
  // IT STANDS ON THE POINT: the plinth's footprint, the ground shadow and the
  // pool of glow sit on the square's GROUND LINE (LAMP_GROUND_FRAC, where
  // app.js seats the sprite's origin) and the post rises above it. Centring
  // the LANTERN on the point instead would stand the plinth a lamp's height
  // off its ground.
  //
  // IT BURNS AT THE LANTERN: the world point stays the foot, but the light
  // lighting.js stamps is LIFTED off it by LAMP_LANTERN_RISE_CELLS (a draw-space
  // lift, never a second position), so the cookie comes out of the glass.
  //
  // The FOOTPRINT stands the lamp clear of the carriageway (LAMP_FOOT_R_CELLS
  // → app.js STREET_LAMP_R_CELLS → Streets.lampOffsetM): one value draws the
  // plinth and seats the lamp on the verge.
  //
  // ART AS WELL AS LIGHT: the lightmap is MULTIPLIED over the world, so at
  // noon a light alone is invisible; gilded ironwork reads at any hour.
  //
  // Baked ONCE into a texture (app.js). The glow is a real radial gradient and
  // the outline an OPAQUE bronze: translucent strokes composite with
  // themselves wherever sections meet.
  //
  // TWO COLOURS: the ironwork is UI_LAMP_GOLD (what it is MADE of); what it
  // SHEDS is UI_LAMP_GLOW (glass, bloom, pool), shared with lighting.js's
  // `cobble` row so paint and cookie can't drift apart.
  const LAMP_TEX_PX = 128;         // baked square — drawn at ~77px, so it supersamples
  const LAMP_DRAW_CELLS = 2.4;     // …drawn this many cells across, glow and post included
  // WHERE THE GROUND IS in the square, as a fraction of its height (app.js
  // seats the sprite's origin there). It is BELOW the middle because a lamp is
  // mostly post; the pool and shadow need only the room a flattened pool takes
  // (LAMP_HALO_FRAC x LAMP_HALO_SQUASH).
  const LAMP_GROUND_FRAC = 0.62;
  const LAMP_FOOT_FRAC = 0.085;    // the plinth's half-width, as a fraction of the square
  // …so the lamp's FOOTPRINT covers this much ground, in CELLS.
  const LAMP_FOOT_R_CELLS = LAMP_DRAW_CELLS * LAMP_FOOT_FRAC;
  const LAMP_HALO_FRAC = 0.30;     // the pool of glow on the ground, as a fraction of the square
  const LAMP_HALO_A = 0.36;        // …its alpha at the foot
  // THE VIEW. The lamp is drawn as the map is looked at: from LAMP_VIEW_DEG
  // above the ground, an orthographic view. Everything that lies FLAT (the
  // pool, the shadow, the top face and underside of every section of the
  // turn) is a circle squashed by LAMP_VIEW_K = sin(view); everything that
  // STANDS is shortened by cos(view). The profile below was authored as seen
  // from LAMP_AUTHORED_DEG (a lamp seen nearly side-on — a street of masts),
  // so its heights go through LAMP_TILT, one linear map about the ground line.
  // Change the look of the angle HERE, never by retyping the table.
  const LAMP_VIEW_DEG = 45;
  const LAMP_AUTHORED_DEG = 15;
  const LAMP_VIEW_K = Math.sin(LAMP_VIEW_DEG * Math.PI / 180);
  const LAMP_TILT = Math.cos(LAMP_VIEW_DEG * Math.PI / 180) / Math.cos(LAMP_AUTHORED_DEG * Math.PI / 180);
  const LAMP_HALO_SQUASH = LAMP_VIEW_K; // …and how flat it lies: light on a road, not a ball of it
  const LAMP_BLOOM_FRAC = 0.18;    // the bloom around the lit glass
  const LAMP_BLOOM_A = 0.46;
  const LAMP_GLASS_A = 0.96;       // the glass at its hot core
  const LAMP_SHADOW_A = 0.34;      // the ground shadow's alpha
  const LAMP_EDGE_MIX = 0.68;      // how far the outline bronze is mixed toward the ink
  // Every section's rim bulge — a quadratic's control point, so twice the
  // depth it reaches: the rim of a circle seen from LAMP_VIEW_DEG above.
  const LAMP_UNDER = 2 * LAMP_VIEW_K;
  const LAMP_DARK_CELLS = { road: 0.64, path: 0.584 };
  const LAMP_SITE_R_CELLS = Math.max(LAMP_FOOT_R_CELLS,
    LAMP_DARK_CELLS.road / 2, LAMP_DARK_CELLS.path / 2);

  // Pure geometry shared by generation, preview and live lamps. Includes
  // every future lamp site regardless of player restoration or brightness.
  function lampSitesForTile(tx, ty, entry) {
    const out = [];
    const tileEdgeM = entry.tileEdgeM;
    if (typeof Streets === 'undefined' || !entry.layers || !(tileEdgeM > 0)) return out;
    const ox = tx * tileEdgeM, oy = ty * tileEdgeM;
    const tileKey = WorldGen.tileKey(tx, ty);
    // The stone's radius in metres, in this tile's own basis.
    const cellM = (entry.cellsPerEdge > 0) ? tileEdgeM / entry.cellsPerEdge : WorldGen.CELL_M;
    const footRM = LAMP_SITE_R_CELLS * cellM;
    // LANTERN ROW (src/street_variants.js) is this lane, denser: a line whose
    // street rolled 'lantern' stands its lamps at StreetVariants.lampSpacingFor.
    // The index keys lines by (feature, line) position in this same layer.
    // THE GLOW is StreetVariants.lampGlowFor(rec), else UI_LAMP_GLOW; resolved
    // ONCE per lamp onto `glow`, which both the baked art (streetLampTexKey)
    // and the light (Lighting.collectLamps) read.
    const lineRecs = new Map();
    const hasVariants = typeof StreetVariants !== 'undefined';
    if (entry.streetIndex && hasVariants) {
      for (const rec of entry.streetIndex.lines) lineRecs.set(`${rec.fi}:${rec.li}`, rec);
    }
    for (const layer of entry.layers) {
      if (layer.name !== 'transportation') continue;
      const extent = layer.extent || 4096;
      const mvtToM = tileEdgeM / extent;
      for (let fi = 0; fi < layer.features.length; fi++) {
        const f = layer.features[fi];
        if (f.type !== 2 || !f.geom) continue;          // lines only
        const cls = (f.tags && f.tags.class) || '';
        if (cls === 'rail' || cls === 'transit') continue;
        if (WorldGen.isParkingAisle(f.tags)) continue;
        const tier = WorldGen.classifyLine ? WorldGen.classifyLine('transportation', f.tags || {}) : null;
        // How far off the centreline this way's lamps stand: its band's
        // half-width plus the stone (per feature: it depends on class only).
        const offM = Streets.lampOffsetM(WorldGen.roadOverlayWidthM(f.tags || {}), footRM);
        for (let i = 0; i < f.geom.length; i++) {
          const line = f.geom[i];
          if (!line || line.length < 2) continue;
          const rec = lineRecs.get(`${fi}:${i}`) || null;
          // How this line lays its lamps (Streets.lampLayFor): Lantern Row's
          // spacing, else a WALKING PATH's, else the street's. `spacingM` rides
          // on every lamp as the gap it was laid at (length / count), the
          // metres a living-lamp visit pays (Streets.lampCredit).
          const baseLay = Streets.lampLayFor(f.tags || {},
            (rec && rec.variant === 'lantern') ? StreetVariants.lampSpacingFor('lantern') : 0);
          const spans = Streets.tileSpans(line, mvtToM, extent);
          if (!spans.length) continue;
          const lineKey = Streets.lineKey(f, i);
          const path = Streets.isWalkingPath(f.tags || {});
          const styles = hasVariants ? StreetVariants.lineStyles(entry, f, fi, i, mvtToM)
            : [{ a: 0, b: Streets.lineLengthM(line, mvtToM), variant: null }];
          for (const style of styles) {
            const lay = { ...baseLay, spacingM: hasVariants
              ? StreetVariants.lampSpacingFor(style.variant, Streets.lampLayFor(f.tags || {}).spacingM)
              : baseLay.spacingM };
            const part = Streets.subLineM(line, mvtToM, style.a, style.b);
            const at = Streets.lampsAlong(part, 1, lay.spacingM, lay.minLenM);
            if (!at.length) continue;
            const spacingM = (style.b - style.a) / at.length;
            const creditM = Streets.lampCreditM(spacingM, path);
            const glow = (hasVariants && StreetVariants.lampGlowFor({ variant: style.variant, size: style.size })) || UI_LAMP_GLOW;
            for (const offset of at) {
              const sM = style.a + offset;
              if (!Streets.covers(spans, sM)) continue;
              const q = Streets.pointAtM(line, mvtToM, sM, offM);
              if (!q) continue;
              const zoneGlow = typeof ZoneVariants !== 'undefined'
                ? ZoneVariants.lampGlowAt(entry, Math.floor(q.x / cellM), Math.floor(q.y / cellM)) : null;
              out.push({ tileKey, lineKey, tier, glow: zoneGlow || glow, s: sM, x: ox + q.x, y: oy + q.y, spacingM, path, creditM,
                         id:`lamp_${tileKey}|${lineKey}@${Math.round(sM)}` });
            }
          }
        }
      }
    }
    return out;
  }

  // Reserve every grid cell touched by the larger of a dark stone and lit
  // lamp foot. These cells belong only to the street dressing pass, not the
  // general spawn gate: no phantom object or persistent occupancy is added.
  function lampReservedCells(tx, ty, entry) {
    const cells = new Set(), N = entry.cellsPerEdge;
    if (!(N > 0) || !(entry.tileEdgeM > 0)) return cells;
    const cellM = entry.tileEdgeM / N, r = LAMP_SITE_R_CELLS;
    for (const lamp of lampSitesForTile(tx, ty, entry)) {
      const x = (lamp.x - tx * entry.tileEdgeM) / cellM;
      const y = (lamp.y - ty * entry.tileEdgeM) / cellM;
      for (let iy = Math.max(0, Math.floor(y - r)); iy <= Math.min(N - 1, Math.floor(y + r)); iy++) {
        for (let ix = Math.max(0, Math.floor(x - r)); ix <= Math.min(N - 1, Math.floor(x + r)); ix++) {
          const dx = Math.max(ix - x, 0, x - ix - 1);
          const dy = Math.max(iy - y, 0, y - iy - 1);
          if (dx * dx + dy * dy <= r * r) cells.add(iy * N + ix);
        }
      }
    }
    return cells;
  }

  const LAMP_INK = (typeof UI_LAMP_GLOW === 'string') ? UI_LAMP_GLOW : '#9a8cff';
  const LAMP_GOLD = (typeof UI_LAMP_GOLD === 'string') ? UI_LAMP_GOLD : '#d9a441';
  const LAMP_DARK = [28, 24, 20];  // the outline ink every sprite in here is drawn with

  // THE PROFILE — the lamp as a lathe turns it, listed top to bottom (as
  // authored, from LAMP_AUTHORED_DEG; lampTilt stands it at LAMP_VIEW_DEG). Each
  // row is one section: its top and bottom edge and its half-width at each, all
  // as fractions of the baked square, with the ground at LAMP_GROUND_FRAC.
  // `tone` lightens (+) or darkens (−) the gild; `curve` bows its sides out (a
  // torus) or in (the flare of the base); `cap` strokes the visible top ring
  // of a piece wider than the one above it.
  //
  // The rows are drawn BOTTOM UP (paintLamp walks the table backwards): each
  // piece STANDS ON the top face of the one below it and is nearer the eye, so
  // it covers that face's middle and leaves its rim showing. The moulding band
  // and the cross-arm are drawn after the column they wrap. The lit glass is
  // not here (it is not metal); it is painted between the skirt and the eaves.
  //
  // HOW TALL. Every row was pulled toward the ground line by one linear map
  // about LAMP_GROUND_FRAC (×0.85), which preserves every overlap and the
  // rhythm of the mouldings; widths are untouched. A lamp near tree height
  // (1.5 cells; the square is LAMP_DRAW_CELLS across) made a restored street a
  // row of masts. The table rises 0.529 (the lantern was lengthened for the
  // 45° view so the eaves leave the glass showing), and LAMP_TILT stands it
  // about 0.39. Retune the HEIGHT by re-mapping the table the same way, never by moving
  // LAMP_GROUND_FRAC — that line is where the lamp STANDS (app.js seats the
  // sprite on it), not how tall it is.
  const lampTilt = (y) => LAMP_GROUND_FRAC - (LAMP_GROUND_FRAC - y) * LAMP_TILT;
  const LAMP_PROFILE = [
    { y0: 0.119, y1: 0.182, w0: 0.015, w1: 0.058, tone: -0.18, curve: -0.30 }, // the crown
    { y0: 0.180, y1: 0.199, w0: 0.068, w1: 0.060, tone: 0.30, cap: true },     // its eaves
    { y0: 0.304, y1: 0.339, w0: 0.058, w1: 0.030, tone: -0.10, curve: -0.28 }, // the lantern's skirt
    { y0: 0.338, y1: 0.353, w0: 0.036, w1: 0.030, tone: 0.28, curve: 0.35 },   // the collar under it
    { y0: 0.350, y1: 0.528, w0: 0.013, w1: 0.019, tone: 0 },                   // the column
    { y0: 0.426, y1: 0.440, w0: 0.023, w1: 0.023, tone: 0.25, curve: 0.35 },   // a moulding band on it
    { y0: 0.518, y1: 0.562, w0: 0.020, w1: 0.054, tone: -0.05, curve: -0.45 }, // the base's flare
    { y0: 0.560, y1: 0.588, w0: 0.060, w1: 0.068, tone: 0.22, curve: 0.15, cap: true }, // its step
    { y0: 0.586, y1: 0.620, w0: 0.074, w1: 0.085, tone: -0.12, curve: 0.10, cap: true }, // the plinth
  ].map((s) => ({ ...s, y0: lampTilt(s.y0), y1: lampTilt(s.y1) }));
  // The lit glass, in the same units — wider at its foot, like every lantern.
  const LAMP_GLASS = { y0: lampTilt(0.196), y1: lampTilt(0.305), w0: 0.038, w1: 0.056 };
  // The finial over the crown, and the cross-arm under the lantern: the two
  // pieces that are not sections of the turn.
  const LAMP_FINIAL = { cy: lampTilt(0.107), r: 0.016 };
  const LAMP_ARM = { y0: lampTilt(0.363), y1: lampTilt(0.375), w: 0.066, ball: 0.014 };
  const LAMP_BAND_ROW = 5, LAMP_COLUMN_ROW = 4, LAMP_SKIRT_ROW = 2;
  // WHERE THE LIGHT COMES OUT: the lit glass's midline, and how far that is
  // ABOVE the lamp's point, in CELLS. Derived from the profile above, so a
  // re-mapped table takes the light with it: one number, two readers
  // (paintLamp's bloom and Lighting.collectLamps).
  const LAMP_LANTERN_FRAC = (LAMP_GLASS.y0 + LAMP_GLASS.y1) / 2;
  const LAMP_LANTERN_RISE_CELLS = (LAMP_GROUND_FRAC - LAMP_LANTERN_FRAC) * LAMP_DRAW_CELLS;

  const lampRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const lampMix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

  // `glowHex` ('#rrggbb') is the colour the lamp SHEDS (the lamp entry's
  // `glow`, the same value Lighting.collectLamps throws); absent or malformed,
  // LAMP_INK. The ironwork stays UI_LAMP_GOLD whatever the street.
  const lampGlowHex = (g) => ((typeof g === 'string' && /^#[0-9a-f]{6}$/i.test(g)) ? g : LAMP_INK);
  function paintLamp(cx, size, glowHex, broken = false) {
    const S = size || LAMP_TEX_PX;
    const c = S / 2;
    const gy = S * LAMP_GROUND_FRAC;          // the ground: where the lamp stands
    const r = S * LAMP_FOOT_FRAC;             // the plinth's half-width
    const lw = Math.max(1, S * 0.012);
    const glow = lampRgb(lampGlowHex(glowHex)), gold = lampRgb(LAMP_GOLD);
    const edge = lampMix(gold, LAMP_DARK, LAMP_EDGE_MIX);
    const rgba = (c3, al) => {
      // Weathered broken metal retains the standing lamp's hue and shading.
      if (broken) {
        const grey = c3[0] * .2126 + c3[1] * .7152 + c3[2] * .0722;
        c3 = c3.map(v => Math.round(grey + (v - grey) * .35));
      }
      return `rgba(${c3[0]},${c3[1]},${c3[2]},${al})`;
    };
    // Crisp ochre/gold bands for the metal only; glass, bloom and light stay continuous.
    const metalRamp = [[76,48,24],[108,67,29],[155,101,38],gold,[230,215,163]];
    const shade = (t) => {
      const target = t >= 0 ? lampMix(gold, [255,244,214], Math.min(1,t))
        : lampMix(gold,LAMP_DARK,Math.min(1,-t));
      const distance = a => a.reduce((sum,v,k) => sum + (v-target[k]) ** 2,0);
      return metalRamp.reduce((best,ink) => distance(ink) < distance(best) ? ink : best);
    };
    // A hard stop on either side of each band keeps small faces readable at map scale.
    const metal = (x0, x1, t) => {
      const g = cx.createLinearGradient(x0, 0, x1, 0);
      const bands = [[0,.18,t-.30],[.18,.42,t+.42],[.42,.77,t],[.77,1,t-.45]];
      for (const [from,to,tone] of bands) {
        const ink = rgba(shade(tone),1);
        g.addColorStop(from,ink); g.addColorStop(to,ink);
      }
      return g;
    };
    // One section of the turn: bowed sides, the far rim of its top face
    // arching away from the viewer and the near rim of its underside bulging
    // toward them — both circles seen from LAMP_VIEW_DEG above.
    const sectionPath = (y0, y1, w0, w1, curve) => {
      const k = (curve || 0) * (w0 + w1) / 2;
      const ym = (y0 + y1) / 2, wm = (w0 + w1) / 2 + k;
      cx.beginPath();
      cx.moveTo(c - w0, y0);
      cx.quadraticCurveTo(c - wm, ym, c - w1, y1);
      cx.quadraticCurveTo(c, y1 + w1 * LAMP_UNDER, c + w1, y1);
      cx.quadraticCurveTo(c + wm, ym, c + w0, y0);
      cx.quadraticCurveTo(c, y0 - w0 * LAMP_UNDER, c - w0, y0);
      cx.closePath();
    };
    // The TOP FACE of a piece wider than the one it carries: the whole
    // circle, seen from above — what makes a stack of castings read as looked
    // DOWN on rather than across.
    const topFace = (y0, w0, tone) => {
      cx.beginPath();
      cx.moveTo(c - w0, y0);
      cx.quadraticCurveTo(c, y0 - w0 * LAMP_UNDER, c + w0, y0);
      cx.quadraticCurveTo(c, y0 + w0 * LAMP_UNDER, c - w0, y0);
      cx.closePath();
      cx.fillStyle = metal(c - w0, c + w0, tone);
      cx.fill();
      strokeEdge();
    };
    const strokeEdge = () => { cx.lineWidth = lw; cx.strokeStyle = rgba(edge, 1); cx.stroke(); };
    // THE LIT GLASS: white-hot up-left of its middle (the corner every sprite
    // is lit from), falling to the lamp's glow at the frame, with two mullions
    // so it reads as glazing rather than a hole in the post.
    const glass = () => {
      const y0 = S * LAMP_GLASS.y0, y1 = S * LAMP_GLASS.y1;
      const w0 = S * LAMP_GLASS.w0, w1 = S * LAMP_GLASS.w1;
      const my = (y0 + y1) / 2;
      sectionPath(y0, y1, w0, w1, 0.06);
      const g = cx.createRadialGradient(c - w1 * 0.38, my - (y1 - y0) * 0.22, 0,
                                        c, my, Math.max(w1, (y1 - y0) / 2));
      g.addColorStop(0, `rgba(255,253,247,${LAMP_GLASS_A})`);
      g.addColorStop(0.5, rgba(glow, 0.95));
      g.addColorStop(1, rgba(glow, 0.82));
      cx.fillStyle = g;
      cx.fill();
      strokeEdge();
      cx.lineWidth = lw * 0.8;
      cx.strokeStyle = rgba(edge, 1);
      for (const t of [-0.34, 0.34]) {
        cx.beginPath();
        cx.moveTo(c + w0 * t, y0 + lw * 0.5);
        cx.lineTo(c + w1 * t, y1 - lw * 0.5);
        cx.stroke();
      }
    };

    if (!broken) {
    // 1. THE POOL: a flat ellipse of glow on the ground, falling to nothing;
    //    it says "lit" at noon when the lightmap has nothing to multiply.
    cx.save();
    cx.translate(c, gy);
    cx.scale(1, LAMP_HALO_SQUASH);
    const hr = S * LAMP_HALO_FRAC;
    const pool = cx.createRadialGradient(0, 0, 0, 0, 0, hr);
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      pool.addColorStop(t, rgba(glow, (LAMP_HALO_A * (1 - t) * (1 - t)).toFixed(4)));
    }
    cx.fillStyle = pool;
    cx.fillRect(-hr, -hr, hr * 2, hr * 2);
    cx.restore();
    // 2. THE BLOOM around the glass, laid BEFORE the ironwork so the metal stays metal.
    const gcy = S * LAMP_LANTERN_FRAC;
    const br = S * LAMP_BLOOM_FRAC;
    const bloom = cx.createRadialGradient(c, gcy, 0, c, gcy, br);
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      bloom.addColorStop(t, rgba(glow, (LAMP_BLOOM_A * (1 - t) * (1 - t)).toFixed(4)));
    }
    cx.fillStyle = bloom;
    cx.fillRect(c - br, gcy - br, br * 2, br * 2);
    }
    // 3. THE GROUND SHADOW, thrown down-right of the plinth and squashed flat.
    cx.fillStyle = `rgba(${LAMP_DARK[0]},${LAMP_DARK[1]},${LAMP_DARK[2]},${LAMP_SHADOW_A})`;
    cx.beginPath();
    cx.ellipse(c + r * 0.40, gy + r * 0.26, r * 1.25, r * 1.25 * LAMP_VIEW_K, 0, 0, Math.PI * 2);
    cx.fill();
    // 4. THE TURN, BOTTOM UP (see LAMP_PROFILE), with the glass painted between
    //    the skirt and the eaves and the band held back until the column is up.
    const order = [];
    for (let i = LAMP_PROFILE.length - 1; i >= 0; i--) {
      if (i === LAMP_BAND_ROW) continue;
      order.push(i);
      if (i === LAMP_COLUMN_ROW) order.push(LAMP_BAND_ROW);
    }
    for (const i of order) {
      if (broken && i < LAMP_COLUMN_ROW) continue;
      const s = LAMP_PROFILE[i];
      const y0 = s.y0 * S, y1 = s.y1 * S, w0 = s.w0 * S, w1 = s.w1 * S;
      if (broken && i === LAMP_COLUMN_ROW) {
        const cut = lampTilt(.402) * S;
        cx.beginPath();
        cx.moveTo(c - w0, cut - lw);
        cx.lineTo(c - w0 * .2, cut + lw * 1.4);
        cx.lineTo(c + w0 * .4, cut + lw * .4);
        cx.lineTo(c + w0, cut + lw * 2);
        cx.lineTo(c + w1, y1);
        cx.quadraticCurveTo(c, y1 + w1 * LAMP_VIEW_K, c - w1, y1);
        cx.closePath();
      } else sectionPath(y0, y1, w0, w1, s.curve);
      cx.fillStyle = metal(c - Math.max(w0, w1), c + Math.max(w0, w1), s.tone || 0);
      cx.fill();
      strokeEdge();
      // The top face of a piece wider than the one it carries, catching the light.
      if (s.cap) topFace(y0, w0 - lw * 0.5, (s.tone || 0) + 0.35);
      if (i === LAMP_SKIRT_ROW) glass();
      // The CROSS-ARM goes on once the column is up: a bar with a ball at each
      // end, under the lantern.
      if (!broken && i === LAMP_BAND_ROW) {
        const ay0 = S * LAMP_ARM.y0, ay1 = S * LAMP_ARM.y1, aw = S * LAMP_ARM.w;
        const ah = ay1 - ay0, amy = (ay0 + ay1) / 2, ab = S * LAMP_ARM.ball;
        cx.beginPath();
        cx.moveTo(c - aw, ay0); cx.lineTo(c + aw, ay0);
        cx.quadraticCurveTo(c + aw + ah * 0.7, amy, c + aw, ay1);
        cx.lineTo(c - aw, ay1);
        cx.quadraticCurveTo(c - aw - ah * 0.7, amy, c - aw, ay0);
        cx.closePath();
        cx.fillStyle = metal(c - aw, c + aw, 0.10); cx.fill(); strokeEdge();
        for (const sx of [-1, 1]) {
          cx.beginPath(); cx.arc(c + sx * aw, amy, ab, 0, Math.PI * 2);
          cx.fillStyle = metal(c + sx * aw - ab, c + sx * aw + ab, 0.20); cx.fill(); strokeEdge();
        }
      }
    }
    if (broken) return;
    // 5. THE FINIAL: the ball on the crown, the top of the whole lamp.
    const fr = S * LAMP_FINIAL.r, fy = S * LAMP_FINIAL.cy;
    cx.beginPath(); cx.arc(c, fy, fr, 0, Math.PI * 2);
    cx.fillStyle = metal(c - fr, c + fr, 0.15); cx.fill(); strokeEdge();
  }

  // Baked into the existing cobble sheet's dark-lamp frames by the art tool.
  // Uses the same 45-degree profile, plinth and moulding as the restored lamp.
  function paintBrokenLamp(cx, size) { paintLamp(cx, size, undefined, true); }

  // The kerb: a hairline pale line along the outer edge of a restored band.
  // Painted by re-stroking the run pale at full width and
  // covering all but the outer pixel back up (see commitRestored).
  const KERB_ALPHA = 0.12;
  const KERB_INSET_PX = 2;

  // ── The patch is SOFT ────────────────────────────────────────────────────
  // A rebuilt stretch is a REPAIR, not a decal: its silhouette is feathered so
  // the new surface fades out where the player's dwell stopped.
  //
  // The blur is applied to the patch's ALPHA ONLY: a mask of the same strokes,
  // blurred, composited `destination-in` over the finished layer (blurring the
  // drawn layer would smear the clean setts into grey mush).
  //
  // AT FULL WIDTH, and the radius is a FRACTION of the band. A Gaussian leaves
  // its half-maximum on the original edge, so the patch stays exactly as wide
  // as the band it repairs. A fixed radius would eat a narrow way alive (a
  // footpath is a third the width of a street and would never reach full
  // alpha), so each band width is blurred by its own radius, capped at
  // RESTORED_BLUR_PX.
  //
  // Canvas2D `filter` is the only gradient primitive available. Where it is
  // missing the hard edge ships — never a stack of alpha strokes, which
  // composite with THEMSELVES where a path doubles back.
  //
  // Measured: at these numbers a footway (~9px at 7 m cells) fades over 4px
  // and keeps 93% alpha down its spine, a street (~23px) fades over 9px. Past
  // a third the narrow ways stop reaching full alpha.
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
  //   • ROUND CAPS + JOINS: Phaser's Graphics has no lineCap/lineJoin control.
  //   • NO DOUBLED JOINTS: a translucent stroke composites with ITSELF where a
  //     path doubles back, stacking into a dark blot. Here the whole network is
  //     drawn OPAQUE into an offscreen canvas and the image is shown at ALPHA.
  // The texture covers the viewport plus PAD on each side (the culler's pad),
  // and the container scrolls it for the sub-cell offset. TWO canvases live in
  // scene.roadGeomContainer: the dilapidated base and the restored pass over
  // it; they share the recording front-end below and differ only in commit().
  const TEX_KEY = 'roadgeom_overlay';

  // A scratch canvas the size of a pass's texture, for patterns that must land
  // on SOME of the network: a pattern fill is a whole-canvas operation, so the
  // strokes to mask against are replayed here, the pattern composited against
  // them, and the layer drawn back onto the real canvas.
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

  // World-phased pattern fill (shared by stones, edge noise, weathering and
  // setts): translating by the phase pins the tile to the world, and the fill
  // runs a tile wider on every side to cover what the shift pushes off. The
  // phase is kept UNWRAPPED on the pass and wrapped per tile here — tiles
  // differ in size (32 and 64), and a phase wrapped to the wrong one would
  // jump the pattern whenever the camera crossed a cell.
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
      // World origin's position in this canvas — see patternFill.
      phaseX: 0, phaseY: 0,
    };
    let curStyle = { w: 1, c: ROAD_COLOR };
    let curPts = null;
    pass.target = {
      clear() {
        pass.ops = []; pass.decorOps = []; pass.erases = []; curPts = null;
        ctx.clearRect(0, 0, size, size);
      },
      // The alpha is carried by the IMAGE, so strokes are always opaque and
      // the alpha argument is deliberately ignored.
      lineStyle(w, c, alpha, pavement) { curStyle = { w, c: c == null ? ROAD_COLOR : c, ...pavement }; },
      beginPath() { curPts = []; },
      moveTo(x, y) { curPts.push(x - originX, y - originY); },
      lineTo(x, y) { curPts.push(x - originX, y - originY); },
      strokePath() {
        if (curPts && curPts.length >= 4) pass.ops.push({ ...curStyle, pts: curPts });
        curPts = null;
      },
      // Punch a cell-sized hole in the finished band. Recorded and applied
      // after every paint pass, since an immediate clearRect would be
      // repainted by the repair pass.
      eraseRect(x, y, w, h) { pass.erases.push([x - originX, y - originY, w, h]); },
      // Track furniture (ties + rails): stroked plain in commit() after the
      // gravel (stays crisp) and before the erases (keep-out punches it out).
      decorPath(w, c, pts, alpha = 1) {
        if (pts && pts.length >= 2) {
          pass.decorOps.push({ w, c, alpha, pts: pts.map((p) => ({ x: p.x - originX, y: p.y - originY })) });
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
    // Fringe pass at true width, then eat random bites out of everything.
    strokeOps(ctx, pass.ops, 0);
    const noise = patternOf(ctx, pass.pats, 'edge', edgeNoiseTile());
    if (noise && pass.ops.length) {
      patternFill(ctx, pass, noise, 'destination-out', STONE_TILE_PX);
      // Repair the interior: the bites survive only in the outer fringe.
      strokeOps(ctx, pass.ops, -EDGE_FRINGE_PX);
    }
    // source-atop keeps the stones inside the nibbled silhouette; laid BEFORE
    // the track furniture so ties and rails stay untextured.
    const stones = patternOf(ctx, pass.pats, 'stone', stoneTile());
    if (stones) patternFill(ctx, pass, stones, 'source-atop', STONE_TILE_PX);
    for (const row of global.StreetVariants?.STREET_VARIANTS || []) {
      if (row.stone?.pattern !== 'spots') continue;
      const ops = pass.ops.filter((op) => op.variant === row.id);
      if (!ops.length) continue;
      const layer = scratchLayer(size);
      if (!layer) continue;
      const tile = document.createElement('canvas'); tile.width = tile.height = STONE_TILE_PX;
      paintSpots(tile.getContext('2d'), STONE_TILE_PX, row.stone.accent);
      const pat = layer.ctx.createPattern(tile, 'repeat');
      strokeOps(layer.ctx, ops, 0);
      if (pat) patternFill(layer.ctx, pass, pat, 'source-in', STONE_TILE_PX);
      ctx.save(); ctx.globalCompositeOperation = 'source-atop';
      ctx.drawImage(layer.canvas, 0, 0); ctx.restore();
    }
    // Weathering, on the ROADS only (rail is ballast). The road ops alone are
    // replayed on a scratch layer, the tile composited 'source-in' against
    // THAT, and the result drawn back source-atop (re-stroking the rail runs
    // plain would wipe their gravel, and a clip can't be built from a stroke).
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
      ctx.globalAlpha = op.alpha;
      ctx.lineWidth = op.w;
      ctx.strokeStyle = cssOf(op.c);
      ctx.beginPath();
      ctx.moveTo(op.pts[0].x, op.pts[0].y);
      for (let i = 1; i < op.pts.length; i++) ctx.lineTo(op.pts[i].x, op.pts[i].y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // Applied LAST so the keep-out holes punch through band, gravel, cracks and track.
    for (const [x, y, w, h] of pass.erases) ctx.clearRect(x, y, w, h);
    pass.tex.refresh();
  }

  // ── The restored pass ────────────────────────────────────────────────────
  // No edge NIBBLE: a rebuilt street is whole. Its outline is feathered as a
  // last step (see "The patch is SOFT") so the setts stay clean.
  // Roads and paths are laid as SEPARATE layers because their clean tiles
  // differ and a pattern fill is a whole-canvas operation. Roads go down first
  // so a footpath crossing a street reads on top.
  function commitRestored(pass) {
    const { ctx, size } = pass;
    ctx.clearRect(0, 0, size, size);
    // Palette colours are not identities: a dark hedge road and park path
    // may share black stone but still need their own mortar and pattern.
    const themes = new Map();
    for (const op of pass.ops) {
      const key = `${!!op.isPath}|${op.variant || ''}`;
      if (!themes.has(key)) themes.set(key, { isPath: !!op.isPath, variant: op.variant, ops: [] });
      themes.get(key).ops.push(op);
    }
    for (const { isPath, variant, ops } of [...themes.values()].sort((a, b) => Number(a.isPath) - Number(b.isPath))) {
      const palette = global.StreetVariants?.VARIANT_BY_ID[variant]?.stone;
      const stoneColor = palette?.restored, pattern = palette?.pattern, accent = palette?.accent;
      if (!ops.length) continue;
      const layer = scratchLayer(size);
      if (!layer) break;
      const lx = layer.ctx;
      const tile = cleanTile(isPath, stoneColor, pattern, accent);
      const pat = tile && lx.createPattern(tile, 'repeat');
      strokeOps(lx, ops, 0);
      if (pat) patternFill(lx, pass, pat, 'source-atop', CLEAN_TILE_PX);
      // The kerb: wash the band pale, cover all but the outer pixel back up,
      // then re-lay the setts, leaving a hairline light edge.
      lx.save();
      lx.globalCompositeOperation = 'source-atop';
      strokeOps(lx, ops, 0, `rgba(255,255,255,${KERB_ALPHA})`);
      strokeOps(lx, ops, -KERB_INSET_PX);
      lx.restore();
      if (pat) patternFill(lx, pass, pat, 'source-atop', CLEAN_TILE_PX);
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
    // The live Graphics (drawLive) belongs above both images.
    const c = scene.roadGeomContainer;
    if (scene.roadLiveGfx && c && c.bringToTop) c.bringToTop(scene.roadLiveGfx);
    return pass.target;
  }

  // Prefer a scene-provided Graphics-shaped object (the headless tests inject
  // one); otherwise build the canvas adapter. The restored pass has no fallback.
  function strokeTarget(scene) {
    return scene.roadGeomGfx || canvasTarget(scene);
  }
  function restoredTarget(scene) {
    return scene.roadRestoredGfx || canvasRestoredTarget(scene);
  }

  function invalidate(scene) {
    if (scene) scene._roadGeomKey = null;
  }

  // The world→screen transform is a pure translation, so the geometry is drawn
  // ONCE at the cell-snapped camera position and the container is scrolled by
  // the sub-cell fraction every frame.
  function draw(scene) {
    const g = strokeTarget(scene);
    if (!g) return;
    const container = scene.roadGeomContainer;
    // Always on at the surface; only depth gates it (cave tiles have no MVT layers).
    const on = (scene.depth ?? 0) === 0;
    if (container) container.setVisible(on);
    if (!on) {
      if (scene._roadGeomKey !== null) {
        g.clear();
        if (g.commit) g.commit();
        // Only an already-existing restored pass is blanked, never built here.
        const r = scene.roadRestoredGfx || scene._roadRestoredTarget;
        if (r) { r.clear(); if (r.commit) r.commit(); }
        scene._roadGeomKey = null;
      }
      return;
    }

    // Camera anchor, not the body (coords.js overlayFrame → viewAnchorCell).
    // The rebuild key is the snapped anchor cell plus which of the 3×3 tiles
    // have their MVT layers, so a tile that finishes loading (or is rebuilt)
    // repaints even while the player stands still.
    const { fracX, fracY, baseCellIX, baseCellIY, tiles, ready } =
      overlayFrame(scene, (entry) => !!entry.layers);
    // The STREETS epoch, bumped by Streets.restore, repaints the restored
    // canvas after a restore and moves only when something changed.
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
  // The band has no business on open water or a building's floor. Both are
  // cell-shaped, so the whole network is drawn first and the offending cells
  // punched back out (one clearRect per cell, only on a rebuild).
  //
  // The projection is the cell-snapped one the strokes use: the cell `ox`
  // columns east and `oy` rows south of the player's own cell lands at
  // (viewCenterX + ox*CELL_PX, viewCenterY + oy*CELL_PX). Only the padded
  // viewport is walked.
  function keepOut(scene, g, baseCellIX, baseCellIY) {
    if (!g.eraseRect || baseCellIX == null) return;
    // The building half only applies while buildings ARE their cells. In
    // polygonal mode (building_overlay.js) the footprint is drawn from its
    // source ring ABOVE this layer, so punching cells out would cut a staircase
    // of holes in the road. Water is unconditional.
    const polyB = typeof BuildingOverlay !== 'undefined' && BuildingOverlay.enabled();
    const PAD = CELL_PX * 2;
    const minX = scene.viewLeft - PAD, maxX = scene.viewLeft + scene.viewSize + PAD;
    const minY = scene.viewTop  - PAD, maxY = scene.viewTop  + scene.viewSize + PAD;
    const ox0 = Math.floor((minX - scene.viewCenterX) / CELL_PX);
    const ox1 = Math.ceil((maxX - scene.viewCenterX) / CELL_PX);
    const oy0 = Math.floor((minY - scene.viewCenterY) / CELL_PX);
    const oy1 = Math.ceil((maxY - scene.viewCenterY) / CELL_PX);
    // Each row is read on ITS tile row's grid (coords.js), with the row band's
    // column shift and screen phase (viewBand) across a seam whose grid differs
    // from the anchor's — the cells drawCells paints in those slots.
    const pc = scene.cellsForRow ? viewAnchorCell(scene) : null;
    const t0 = {};
    // Tile lookups are memoised: a padded viewport spans at most 4 tiles.
    let curTX = null, curTY = null, curGrid = null;
    for (let oy = oy0; oy <= oy1; oy++) {
      const acy = baseCellIY + oy;
      const band = viewBand(scene, pc, acy);
      absCellToTile(scene, baseCellIX + band.dX, acy, t0);
      const ty = t0.ty, iy = t0.iy, N = t0.n;
      const shift = absColShift(scene, ty);
      const phase = Math.round(band.phaseX);
      for (let ox = ox0; ox <= ox1; ox++) {
        const lx = baseCellIX + ox + band.dX - shift;
        const tx = Math.floor(lx / N), ix = lx - tx * N;
        if (tx !== curTX || ty !== curTY) {
          curTX = tx; curTY = ty;
          const e = WorldGen.tileCache.get(WorldGen.tileKey(tx, ty));
          curGrid = (e && e.grid) || null;
        }
        if (!curGrid) continue;
        const t = curGrid[iy * N + ix];
        if (t !== WATER_T && (polyB || !WorldGen.isBuildingTerrain(t))) continue;
        g.eraseRect(scene.viewCenterX + ox * CELL_PX + phase,
                    scene.viewCenterY + oy * CELL_PX, CELL_PX, CELL_PX);
      }
    }
  }

  // Split one polyline (WORLD METRES) into runs of consecutive ON-SCREEN
  // segments and hand each to `add`; a run breaks wherever a segment is wholly
  // outside the padded viewport (else the skip draws a straight shortcut).
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
  // crossing a motorway reads on top. Sorted rather than insertion-ordered so
  // draw order doesn't depend on tile load order; ties break on colour and
  // pavement identity.
  function strokeBuckets(g, runsByStyle, alpha) {
    const styles = [...runsByStyle.values()]
      .sort((a, b) => (b.widthPx - a.widthPx) || (a.color - b.color)
        || (Number(!!a.isPath) - Number(!!b.isPath)) || String(a.variant || '').localeCompare(String(b.variant || '')));
    for (const { widthPx, color, runs, variant, isPath } of styles) {
      g.lineStyle(widthPx, color, alpha, { variant, isPath });
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
  // Lot lanes normally never reach here (WorldGen.isLotLane); the check below
  // is belt and braces for a layer that skipped the rasterizer.
  function eachTransportLine(tiles, fn) {
    for (const { tx, ty, entry } of tiles) {
      const tileEdgeM = entry.tileEdgeM;
      const originMx = tx * tileEdgeM;
      const originMy = ty * tileEdgeM;
      const tileKey = WorldGen.tileKey(tx, ty);
      for (const layer of entry.layers) {
        if (layer.name !== 'transportation') continue;
        const mvtToM = tileEdgeM / (layer.extent || MVT_EXTENT);
        for (let fi = 0; fi < layer.features.length; fi++) {
          const f = layer.features[fi];
          if (f.type !== 2 || !f.geom) continue;   // lines only (2 = LineString)
          if (WorldGen.isLotLane(f.tags)) continue;
          for (let i = 0; i < f.geom.length; i++) {
            const line = f.geom[i];
            if (!line || line.length < 2) continue;
            fn(f, line, i, mvtToM, originMx, originMy, tileKey, entry, fi);
          }
        }
      }
    }
  }

  function rebuild(scene, tiles, fracX, fracY, baseCellIX, baseCellIY) {
    // Cell-snapped projection from the camera anchor (the container re-applies
    // the sub-cell offset) and the padded cull bounds. Both passes share it, so
    // the restored metres land exactly on the band they were restored from.
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

    // Ways are collected into runs of ON-SCREEN segments, bucketed by stroke
    // STYLE (width, colour and pavement), and stroked as PATHS: segment-by-
    // segment drawing leaves a notch at every bend.
    const runsByStyle = new Map();   // width, colour, variant and path kind → runs
    const railRuns = [];             // rail-class runs, for the track furniture pass
    const carpets = [];              // themed verge strips (StreetVariants row.carpet)
    const addRun = (widthPx, color, run, isRail, variant, isPath) => {
      if (run.length < 2) return;
      const k = `${widthPx}|${color}|${variant || ''}|${!!isPath}`;
      let bucket = runsByStyle.get(k);
      if (!bucket) { bucket = { widthPx, color, variant, isPath, runs: [] }; runsByStyle.set(k, bucket); }
      bucket.runs.push(run);
      if (isRail) railRuns.push(run);
    };

    eachTransportLine(tiles, (f, line, i, mvtToM, originMx, originMy, tileKey, entry, fi) => {
      const widthPx = widthPxFor(scene, f.tags);
      const color = colorFor(f.tags);
      const isRail = RAIL_CLASSES.has((f.tags && f.tags.class) || '');
      const styles = !isRail && global.StreetVariants && global.Streets
        ? StreetVariants.lineStyles(entry, f, fi, i, mvtToM) : null;
      for (const style of styles || [null]) {
        const sub = style ? Streets.subLineM(line, mvtToM, style.a, style.b) : line.map((p) => ({ x: p.x * mvtToM, y: p.y * mvtToM }));
        const hex = style && StreetVariants.stoneColorFor(style.variant, false);
        const tint = hex ? parseInt(hex.slice(1), 16) : color;
        const pts = sub.map((p) => ({ x: originMx + p.x, y: originMy + p.y }));
        emitRuns(pts, proj, (run) => addRun(widthPx, tint, run, isRail, style?.variant, PATH_CLASSES.has(f.tags?.class)));
        if (style && StreetVariants.carpetStyleFor(style.variant)) carpets.push({ pts, variant: style.variant,
          halfM: (widthPx / CELL_PX) * scene.cellM / 2 });
      }
    });

    strokeBuckets(g, runsByStyle, ALPHA);
    // Dress the railways as track, only where the target can draw decor.
    if (g.decorPath) for (const run of railRuns) emitRailDecor(scene, g, run);
    // Carpet strips either side of the road on the verge cell (so the keep-out
    // trims them like the track), then the row's emblem down each strip.
    if (g.decorPath) for (const { pts, variant, halfM } of carpets) {
      const off = halfM + scene.cellM / 2;
      for (const side of [1, -1]) {
        emitRuns(offsetLine(pts, side * off), proj, (run) => {
          emitCarpetStrip(g, run, variant);
        });
      }
    }
    keepOut(scene, g, baseCellIX, baseCellIY);
    // Anchor the stone pattern to the world, so walking scrolls the texture
    // with the road rather than under it.
    if (g.texturePhase) g.texturePhase(projX(0), projY(0));
    // Upload the finished canvas once, after every way is on it.
    if (g.commit) g.commit();
  }

  // ── The restored metres ──────────────────────────────────────────────────
  // Same walk, but each line is asked what the player has REBUILT of it: an
  // interval list of metres from the save through Streets. Each interval
  // becomes its own exact sub-polyline, so a restored stretch ends where the
  // dwell ended rather than at the nearest vertex. Rail is skipped.
  function rebuildRestored(scene, tiles, proj, baseCellIX, baseCellIY) {
    const g = restoredTarget(scene);
    if (!g) return;
    g.clear();
    const { projX, projY } = proj;
    const S = (typeof Streets !== 'undefined') ? Streets : null;
    if (S && scene.save) {
      const runsByStyle = new Map();
      const addRun = (widthPx, color, run, variant, isPath) => {
        if (run.length < 2) return;
        const k = `${widthPx}|${color}|${variant || ''}|${!!isPath}`;
        let bucket = runsByStyle.get(k);
        if (!bucket) { bucket = { widthPx, color, variant, isPath, runs: [] }; runsByStyle.set(k, bucket); }
        bucket.runs.push(run);
      };
      eachTransportLine(tiles, (f, line, i, mvtToM, originMx, originMy, tileKey, entry, fi) => {
        if (RAIL_CLASSES.has((f.tags && f.tags.class) || '')) return;
        const list = S.restoredList(scene.save, tileKey, S.lineKey(f, i));
        if (!list || !list.length) return;
        const widthPx = widthPxFor(scene, f.tags);
        const color = restoredColorFor(f.tags);
        const styles = global.StreetVariants ? StreetVariants.lineStyles(entry, f, fi, i, mvtToM) : [{ a: 0, b: Infinity }];
        for (const style of styles) for (const iv of S.intersect(list, [[style.a, style.b]])) {
          const hex = global.StreetVariants && StreetVariants.stoneColorFor(style.variant);
          const tint = hex ? parseInt(hex.slice(1), 16) : color;
          const sub = S.subLineM(line, mvtToM, iv[0], iv[1]);
          if (!sub || sub.length < 2) continue;
          const pts = sub.map((p) => ({ x: originMx + p.x, y: originMy + p.y }));
          emitRuns(pts, proj, (run) => addRun(widthPx, tint, run, style.variant, PATH_CLASSES.has(f.tags?.class)));
        }
      });
      strokeBuckets(g, runsByStyle, RESTORED_ALPHA);
    }
    keepOut(scene, g, baseCellIX, baseCellIY);
    if (g.texturePhase) g.texturePhase(projX(0), projY(0));
    if (g.commit) g.commit();
  }

  // A round cap/join for a stroked polyline that never paints ground the
  // stroke already covers. Only two shapes are MISSING from a butt-capped,
  // mitred `strokePath()`:
  //   • the half-disc beyond each END (its straight side sits on the butt
  //     edge, so it adds no overlap);
  //   • the WEDGE on the OUTER side of each interior bend. The INNER side is
  //     already covered by overlap inside Phaser's own strokePath.
  // Each cap/join comes back as one FAN — `[centre, ...arc points]`, for one
  // `g.fillPoints(fan, true)` — never a full circle, which would
  // double-composite its alpha (see the note above drawLive).
  //
  // Pure and exported so test/node/road_overlay.test.js can pin the geometry.
  function roundJoinFans(pts, r, arcSteps = 8) {
    const n = pts && pts.length;
    if (!(n >= 2) || !(r > 0)) return [];
    const dirOf = (a, b) => {
      const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
      return len > 1e-6 ? { x: dx / len, y: dy / len } : null;
    };
    const left = (d) => ({ x: -d.y, y: d.x });
    const fan = (cx, cy, a0, sweep) => {
      const steps = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / arcSteps)));
      const out = [{ x: cx, y: cy }];
      for (let s = 0; s <= steps; s++) {
        const a = a0 + sweep * (s / steps);
        out.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
      }
      return out;
    };
    const dirs = [];
    for (let i = 0; i < n - 1; i++) dirs.push(dirOf(pts[i], pts[i + 1]));
    const out = [];
    // END CAPS: a half-disc bulging AWAY from the line, from one normal to the
    // other (π), through the line's own extended direction.
    const firstDir = dirs.find((d) => d);
    if (firstDir) {
      const n0 = left(firstDir);
      out.push(fan(pts[0].x, pts[0].y, Math.atan2(n0.y, n0.x), Math.PI));
    }
    const lastDir = [...dirs].reverse().find((d) => d);
    if (lastDir) {
      const nL = left(lastDir);
      out.push(fan(pts[n - 1].x, pts[n - 1].y, Math.atan2(-nL.y, -nL.x), Math.PI));
    }
    // INTERIOR JOINS: the turn's signed angle says which way the path bends
    // and by how much; the wedge sits on the side OPPOSITE the turn, swept by
    // that angle from that side's normal, which lands on the next segment's
    // normal by construction.
    for (let i = 1; i < n - 1; i++) {
      const dPrev = dirs[i - 1], dNext = dirs[i];
      if (!dPrev || !dNext) continue;
      const cross = dPrev.x * dNext.y - dPrev.y * dNext.x;
      const dot = dPrev.x * dNext.x + dPrev.y * dNext.y;
      const turn = Math.atan2(cross, dot);
      if (Math.abs(turn) < 1e-4) continue;   // colinear — nothing missing
      const sign = turn > 0 ? -1 : 1;
      const nPrev = left(dPrev);
      const ox = sign * nPrev.x, oy = sign * nPrev.y;
      out.push(fan(pts[i].x, pts[i].y, Math.atan2(oy, ox), turn));
    }
    return out;
  }

  // ── The live pass ────────────────────────────────────────────────────────
  // Everything the overlay draws that changes EVERY frame: the dwell preview
  // and the white shine down a freshly rebuilt stretch. Too costly for the
  // canvases, so a plain Phaser Graphics, cleared and re-stroked per frame
  // (usually 0–10 short runs).
  //
  // Seating: points go through scene.worldMetersToScreen (the camera-anchored
  // projection, so a peek drag carries the preview with the ground). The
  // Graphics sits INSIDE roadGeomContainer, which draw() moves by the sub-cell
  // scroll that worldMetersToScreen already accounts for, so the container's
  // offset is subtracted back out or the preview would run half a cell ahead.
  //
  // Phaser's Graphics has no lineCap/lineJoin control, so a stroked path alone
  // ends in a hard butt and notches every bend, unlike the round canvas bands
  // under it. A filled circle per vertex would double-composite its alpha on
  // the stroke (the same trap the canvas passes dodge), so roundJoinFans fills
  // only what a butt-capped, mitred stroke is MISSING.
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
      const alpha = run.alpha == null ? 1 : run.alpha;
      const widthPx = widthPxFor(scene, run.tags);
      g.lineStyle(widthPx, color, alpha);
      g.beginPath();
      const sx = [], sy = [];
      for (let i = 0; i < pts.length; i++) {
        const s = scene.worldMetersToScreen(pts[i].x, pts[i].y);
        const x = s.x - ox, y = s.y - oy;
        sx.push(x); sy.push(y);
        if (i) g.lineTo(x, y); else g.moveTo(x, y);
      }
      g.strokePath();
      // ROUND CAPS + JOINS: only the ground the stroke MISSED (see above).
      const pt = [];
      for (let i = 0; i < sx.length; i++) pt.push({ x: sx[i], y: sy[i] });
      const fans = roundJoinFans(pt, widthPx / 2);
      if (fans.length) {
        g.fillStyle(color, alpha);
        for (const fan of fans) g.fillPoints(fan, true);
      }
    }
  }

  global.RoadOverlay = { lampSitesForTile, lampReservedCells, LAMP_DARK_CELLS, LAMP_SITE_R_CELLS, draw, invalidate, drawLive, colorFor, paintWeatherTile, paintCleanTile, paintPavementTile, cleanTile, CLEAN_TILE_PX, CLEAN_PATH_MORTAR_MUL,
                         offsetLine, emitCarpetStrip, emitCarpetEmblems, CARPET_EMBLEMS, CARPET_EMBLEM_STEP_PX, paintLamp, paintBrokenLamp, lampGlowHex, LAMP_TEX_PX, LAMP_DRAW_CELLS, LAMP_FOOT_R_CELLS, LAMP_GROUND_FRAC,
                         LAMP_LANTERN_FRAC, LAMP_LANTERN_RISE_CELLS, LAMP_VIEW_K,
                         RESTORED_BLUR_PX, RESTORED_BLUR_FRAC, blurForWidth, softenEdge,
                         CLEAN_MORTAR_ALPHA, CLEAN_BEVEL_ALPHA, roundJoinFans };
})(window);
