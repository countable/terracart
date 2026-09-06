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
// Depends on:
//   scene fields (read-only): roadGeomGfx, roadGeomContainer, save,
//     startWorldM, playerM, cellM, cellsPerTile, depth,
//     viewCenterX/Y, viewLeft, viewTop, viewSize
//     helper: playerToWorldCell()
//   worldgen.js — WorldGen.tileCache, WorldGen.Z, WorldGen.roadOverlayWidthM,
//                 WorldGen.PATH_CLASSES, WorldGen.tileKey,
//                 WorldGen.T / WorldGen.isBuildingTerrain (the keep-out);
//                 per-tile `entry.layers` (the raw decoded MVT layers),
//                 `entry.tileEdgeM`, and `entry.grid` (for the keep-out pass)
//   coords.js — overlayFrame / overlayProjection / timedOverlayRebuild (the
//               camera-anchored draw frame both geometry overlays share)
//   sprite_layout.js — SpriteLayout.CELL_PX
//   app.js consts — CELL_PX
//
// Exports as globals:
//   RoadOverlay.draw(scene)      — per-frame entry point (cheap when cached)
//   RoadOverlay.invalidate(scene)— force a rebuild on the next draw
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
    // The pass is RECORDED rather than stroked immediately: the rough-edge
    // nibble needs the whole network twice (fringe pass, then the narrower
    // repair pass — see "Rough edges" above), so commit() replays the buffer.
    // rebuild()'s calling contract is unchanged — the tests' recording stub
    // and this adapter see the exact same one-pass sequence.
    let ops = [];      // { w, c, pts: [x0,y0, x1,y1, …] } per stroked path
    let decorOps = []; // { w, c, pts: [{x,y}…] } track furniture, drawn after the gravel
    let erases = [];   // [x, y, w, h] keep-out holes, applied after all paint
    let curStyle = { w: 1, c: ROAD_COLOR };
    let curPts = null;
    // World-phased pattern fill (stones and edge noise share the anchoring):
    // translating by the phase pins the tile to the world, and the fill runs a
    // tile wider on every side to cover what the shift pushes off the canvas.
    const patternFill = (pattern, composite) => {
      ctx.save();
      ctx.globalCompositeOperation = composite;
      ctx.fillStyle = pattern;
      ctx.translate(phaseX, phaseY);
      ctx.fillRect(-STONE_TILE_PX, -STONE_TILE_PX, size + STONE_TILE_PX * 2, size + STONE_TILE_PX * 2);
      ctx.restore();
    };
    // One replay of the recorded network. `widthDelta` widens (fringe) or
    // narrows (repair) every path; the floor keeps a hairline way from
    // vanishing outright in the repair pass.
    const strokeAll = (widthDelta) => {
      for (const op of ops) {
        ctx.lineWidth = Math.max(1, op.w + widthDelta);
        ctx.strokeStyle = cssOf(op.c);
        ctx.beginPath();
        ctx.moveTo(op.pts[0], op.pts[1]);
        for (let i = 2; i < op.pts.length; i += 2) ctx.lineTo(op.pts[i], op.pts[i + 1]);
        ctx.stroke();
      }
    };
    let edgeNoisePattern;
    const target = {
      clear() { ops = []; decorOps = []; erases = []; curPts = null; ctx.clearRect(0, 0, size, size); },
      // The alpha is carried by the IMAGE (see above), so the stroke itself is
      // always opaque; the colour is the caller's (earth for roads, slate for
      // rail) and the alpha argument is deliberately ignored here.
      lineStyle(w, c) { curStyle = { w, c: c == null ? ROAD_COLOR : c }; },
      beginPath() { curPts = []; },
      moveTo(x, y) { curPts.push(x - originX, y - originY); },
      lineTo(x, y) { curPts.push(x - originX, y - originY); },
      strokePath() {
        if (curPts && curPts.length >= 4) ops.push({ w: curStyle.w, c: curStyle.c, pts: curPts });
        curPts = null;
      },
      // Punch a cell-sized hole in the finished band. Recorded and applied
      // after both stroke passes — an immediate clearRect would be repainted
      // by the repair pass; clearRect rather than a destination-out fill so
      // the hole is exact and costs nothing to composite.
      eraseRect(x, y, w, h) { erases.push([x - originX, y - originY, w, h]); },
      // Track furniture (railway ties + rails). Stroked plain in commit() —
      // after the gravel so it stays crisp, before the erases so the keep-out
      // cells punch it out along with the ballast.
      decorPath(w, c, pts) {
        if (pts && pts.length >= 2) {
          decorOps.push({ w, c, pts: pts.map((p) => ({ x: p.x - originX, y: p.y - originY })) });
        }
      },
      // Screen position the world origin projected to this pass — the stone
      // pattern is anchored there, so it sits still on the road while the road moves.
      texturePhase(x, y) { phaseX = wrap(x - originX); phaseY = wrap(y - originY); },
      commit() {
        ctx.clearRect(0, 0, size, size);
        // Fringe pass at true width, then eat random bites out of everything…
        strokeAll(0);
        if (edgeNoisePattern === undefined) {
          const tile = edgeNoiseTile();
          edgeNoisePattern = (tile && ctx.createPattern(tile, 'repeat')) || null;
        }
        if (edgeNoisePattern && ops.length) {
          patternFill(edgeNoisePattern, 'destination-out');
          // …and repair the interior: the bites survive only in the outer
          // EDGE_FRINGE_PX of each band, which is the rough edge.
          strokeAll(-EDGE_FRINGE_PX);
        }
        if (stonePattern === undefined) {
          const tile = stoneTile();
          stonePattern = (tile && ctx.createPattern(tile, 'repeat')) || null;
        }
        // source-atop keeps the stones inside what's already drawn — the
        // nibbled silhouette included — so they never leak off the ways. Laid
        // BEFORE the track furniture, so ties and rails stay untextured.
        if (stonePattern) patternFill(stonePattern, 'source-atop');
        for (const op of decorOps) {
          ctx.lineWidth = op.w;
          ctx.strokeStyle = cssOf(op.c);
          ctx.beginPath();
          ctx.moveTo(op.pts[0].x, op.pts[0].y);
          for (let i = 1; i < op.pts.length; i++) ctx.lineTo(op.pts[i].x, op.pts[i].y);
          ctx.stroke();
        }
        // Land only, and never over a floor — applied LAST so the keep-out
        // holes punch through band, gravel and track alike.
        for (const [x, y, w, h] of erases) ctx.clearRect(x, y, w, h);
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
    const key = `${baseCellIX},${baseCellIY},${ready}`;
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

  function rebuild(scene, tiles, fracX, fracY, baseCellIX, baseCellIY) {
    const g = strokeTarget(scene);
    g.clear();
    // Cell-snapped projection from the camera anchor (the container re-applies
    // the sub-cell offset) and the padded cull bounds — a segment whose
    // endpoints both sit outside the padded viewport can still cross it, so
    // the pad is a full cell wider than the sub-cell scroll can ever reveal.
    const { projX, projY, minX, maxX, minY, maxY } = overlayProjection(scene, fracX, fracY);

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
          const isRail = RAIL_CLASSES.has((f.tags && f.tags.class) || '');
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
                addRun(widthPx, color, run, isRail);
                run = [{ x: qx, y: qy }];
              } else {
                run.push({ x: qx, y: qy });
              }
              px = qx; py = qy;
            }
            addRun(widthPx, color, run, isRail);
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

  global.RoadOverlay = { draw, invalidate };
})(window);
