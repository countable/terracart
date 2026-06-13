// Procedural road and path geometry — bakes per-shape canvas textures (black
// cobblestone for vehicle roads, yellowish dirt for footpaths) and stamps them
// per cell, replacing the old flat-colour Graphics rectangles.
//
// Each road/path cell shows:
//   • A center pad (always, even for isolated cells)
//   • One arm per connected orthogonal neighbor, reaching the cell edge
//   • A corner-quadrant fill per "solid" diagonal (both flanking orthogonals
//     AND the diagonal between them are road) — this merges multi-cell-wide
//     roads into one continuous surface instead of parallel strips joined by
//     ladder rungs
//
// The silhouette is painted as a chain of slightly jittered discs along each
// arm's spine, which gives the surface the requested ROUGH, WINDY edge. The
// jitter is PINNED TO ZERO at the cell boundary (and the boundary stamp is a
// disc of exactly the nominal half-width), so the neighbour cell's matching
// arm meets it seamlessly — the wobble lives strictly inside the cell.
//
// Textures are baked lazily per (type, normalized mask, variant) and cached in
// the Phaser texture manager; render.js alternates two variants by cell parity
// so long straights don't visibly repeat one wobble pattern.
//
// "Connected" = any road or path type (asymmetric widths create natural tapers
// at junctions between tiers — e.g. a 4px path arm entering a 10px road arm).
//
// Terrain codes: PATH=8, ROAD=7, ROAD_MD=14, ROAD_LG=13

(function (root) {
  'use strict';

  const CELL_PX = 32;
  const HALF    = CELL_PX / 2;   // 16 px — center offset from cell top-left

  // Surface width in pixels per terrain type (out of 32px cell).
  // ROAD_LG at 30px leaves 1px margin each side; two adjacent cells merge
  // into a solid highway surface. PATH at 4px reads as a narrow dirt track.
  const ROAD_WIDTH = {
    8:  4,   // PATH    — narrow dirt track
    7:  14,  // ROAD    — quiet residential street (was 10: read too narrow)
    14: 18,  // ROAD_MD — secondary / town road
    13: 30,  // ROAD_LG — highway (fills nearly the full cell)
  };

  // Flat base colours — used by the Graphics fallback (no texture manager) and
  // as the tone the patterns are built around. Roads are black cobble now;
  // paths are yellowish dirt.
  const ROAD_COLOR = {
    8:  0xc9a35a,  // PATH    — yellowish dirt
    7:  0x2e2e36,  // ROAD    — charcoal cobble
    14: 0x26262e,  // ROAD_MD — darker cobble
    13: 0x1e1e26,  // ROAD_LG — near-black cobble
  };

  // Thin darker outline drawn 1px wider than the surface on every side,
  // giving road edges a crisp kerb line against the biome background.
  const CURB_COLOR = {
    8:  0x97793a,  // dirt edge — darker packed earth
    7:  0x0d0d12,
    14: 0x0b0b10,
    13: 0x09090e,
  };

  // Per-stone fill tones for the cobble pattern, per tier (all read "black",
  // residential streets a shade lighter so they aren't pitch holes at night).
  const COBBLE_TONES = {
    7:  ['#2a2a32', '#30303a', '#34343e', '#2c2e38', '#262630'],
    14: ['#22222a', '#282832', '#2c2c36', '#242630', '#1e1e28'],
    13: ['#1a1a22', '#20202a', '#24242e', '#1c1e28', '#16161e'],
  };
  const COBBLE_JOINT = { 7: '#0d0d12', 14: '#0b0b10', 13: '#09090e' };

  // Dirt-path mottling tones around the 0xc9a35a base.
  const DIRT_BASE  = '#c9a35a';
  const DIRT_TONES = ['#bd9549', '#d4b069', '#b08a40', '#dcb978', '#c39c4f'];

  // isAnyRoad — used by render.js to build the neighbor mask.
  // Exported so render.js doesn't duplicate the terrain-code list.
  function isAnyRoad(t) {
    return t === 7 || t === 8 || t === 13 || t === 14;
  }

  // Tiny deterministic RNG so a given (type, mask, variant) always bakes the
  // same wobble + stone layout across sessions and devices.
  function mulberry(seed) {
    let s = seed >>> 0 || 1;
    return () => {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const hex = (c) => '#' + c.toString(16).padStart(6, '0');

  // ── Pattern painters ───────────────────────────────────────────────────────
  // Fill the whole 32×32 ctx with the tier's surface pattern; the caller masks
  // it down to the road silhouette afterwards (destination-in).
  function paintPattern(ctx, type, rng) {
    if (type === 8) {
      // Yellowish dirt: warm base + mottled blotches + a few small pebbles.
      ctx.fillStyle = DIRT_BASE;
      ctx.fillRect(0, 0, CELL_PX, CELL_PX);
      for (let i = 0; i < 42; i++) {
        ctx.fillStyle = DIRT_TONES[(rng() * DIRT_TONES.length) | 0];
        const x = (rng() * CELL_PX) | 0, y = (rng() * CELL_PX) | 0;
        const s = 1 + ((rng() * 2) | 0);
        ctx.fillRect(x, y, s, s);
      }
      // Sparse pebbles — slightly grey against the dirt.
      for (let i = 0; i < 4; i++) {
        ctx.fillStyle = rng() < 0.5 ? '#9b8a62' : '#8a7445';
        ctx.fillRect((rng() * CELL_PX) | 0, (rng() * CELL_PX) | 0, 2, 1);
      }
      return;
    }
    // Black cobblestones: staggered rounded stones over a near-black joint
    // colour, each stone value-jittered with a faint top highlight + bottom
    // shade so the surface reads as laid stone, not flat paint.
    const tones = COBBLE_TONES[type] || COBBLE_TONES[7];
    ctx.fillStyle = COBBLE_JOINT[type] || '#0b0b10';
    ctx.fillRect(0, 0, CELL_PX, CELL_PX);
    const SW = 8, SH = 6;          // stone pitch (stones 7×5 + a 1px joint)
    for (let row = -1; row * SH < CELL_PX + SH; row++) {
      const xoff = (row & 1) ? SW / 2 : 0;
      for (let col = -1; col * SW < CELL_PX + SW; col++) {
        const x = col * SW + xoff + 1, y = row * SH + 1;
        const w = SW - 1, h = SH - 1;
        ctx.fillStyle = tones[(rng() * tones.length) | 0];
        // Rounded stone: plain rect + corner nicks kept in joint colour reads
        // rounded at this scale without path arcs.
        ctx.fillRect(x, y, w, h);
        ctx.fillStyle = COBBLE_JOINT[type] || '#0b0b10';
        ctx.fillRect(x, y, 1, 1);
        ctx.fillRect(x + w - 1, y, 1, 1);
        ctx.fillRect(x, y + h - 1, 1, 1);
        ctx.fillRect(x + w - 1, y + h - 1, 1, 1);
        // Relief: light top edge, dark bottom edge.
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        ctx.fillRect(x + 1, y, w - 2, 1);
        ctx.fillStyle = 'rgba(0,0,0,0.28)';
        ctx.fillRect(x + 1, y + h - 1, w - 2, 1);
      }
    }
  }

  // ── Wobbled silhouette ─────────────────────────────────────────────────────
  // Disc-chain silhouette of the cell's road shape. `jit` holds one jitter
  // array per arm (precomputed so the curb and surface passes wobble in
  // lockstep and the kerb ring stays a constant 1px). Jitter is scaled to 0
  // approaching the cell boundary so neighbouring cells always meet at the
  // nominal width — the wobble can never open a seam.
  const ARM_STEP = 2;
  const ARM_STEPS = HALF / ARM_STEP;          // stamps per arm (t = 0 .. HALF)
  const ARMS = [                              // [dx, dy] spine direction per bit
    { bit: 1, dx: 0,  dy: -1 },               // N
    { bit: 2, dx: 1,  dy: 0  },               // E
    { bit: 4, dx: 0,  dy: 1  },               // S
    { bit: 8, dx: -1, dy: 0  },               // W
  ];
  function makeJitters(rng, amp) {
    // One jitter value per stamp per arm, in [-amp, +amp].
    return ARMS.map(() => {
      const a = [];
      for (let i = 0; i <= ARM_STEPS; i++) a.push((rng() * 2 - 1) * amp);
      return a;
    });
  }
  // Pin factor: 1 in the cell interior, fading to 0 over the last 5px before
  // the boundary (t = HALF) so the seam stamp is exactly nominal width.
  const pin = (t) => Math.max(0, Math.min(1, (HALF - t) / 5));

  function silhouettePath(ctx, mask, r, jit, quad) {
    ctx.beginPath();
    ctx.moveTo(HALF + r, HALF);
    ctx.arc(HALF, HALF, r, 0, Math.PI * 2);
    for (let a = 0; a < ARMS.length; a++) {
      const arm = ARMS[a];
      if (!(mask & arm.bit)) continue;
      for (let i = 0; i <= ARM_STEPS; i++) {
        const t = i * ARM_STEP;
        const rr = Math.max(1, r + jit[a][i] * pin(t));
        const x = HALF + arm.dx * t, y = HALF + arm.dy * t;
        ctx.moveTo(x + rr, y);
        ctx.arc(x, y, rr, 0, Math.PI * 2);
      }
    }
    // Inner-corner quadrants for solid diagonals (interior — no wobble).
    const N = mask & 1, E = mask & 2, S = mask & 4, W8 = mask & 8;
    if (N && E  && (mask & 16))  ctx.rect(HALF + quad.in, 0,              quad.q, quad.q);
    if (S && E  && (mask & 32))  ctx.rect(HALF + quad.in, HALF + quad.in, quad.q, quad.q);
    if (S && W8 && (mask & 64))  ctx.rect(0,              HALF + quad.in, quad.q, quad.q);
    if (N && W8 && (mask & 128)) ctx.rect(0,              0,              quad.q, quad.q);
    ctx.fill();
  }

  // Normalize a neighbour mask for texture caching: a diagonal bit only
  // matters when both flanking orthogonals are set (it then makes the corner
  // quadrant solid), so clear meaningless diagonals to collapse equivalent
  // masks onto one baked texture.
  function normalizeMask(mask) {
    const o = mask & 15;
    let nm = o;
    if ((o & 3)  === 3  && (mask & 16))  nm |= 16;   // N+E
    if ((o & 6)  === 6  && (mask & 32))  nm |= 32;   // E+S
    if ((o & 12) === 12 && (mask & 64))  nm |= 64;   // S+W
    if ((o & 9)  === 9  && (mask & 128)) nm |= 128;  // W+N
    return nm;
  }

  // Lazily bake (and cache in the Phaser texture manager) the textured,
  // rough-edged road-cell image for this tier + connection shape. Returns the
  // texture key, or null when baking isn't possible (no DOM canvas — the
  // caller then falls back to drawRoadCell's flat Graphics geometry).
  function ensureRoadCellTexture(scene, type, mask, variant) {
    if (!scene || !scene.textures || typeof document === 'undefined') return null;
    const nm = normalizeMask(mask);
    const key = `roadcell_${type}_${nm}_${variant & 1}`;
    if (scene.textures.exists(key)) return key;
    const tex = scene.textures.createCanvas(key, CELL_PX, CELL_PX);
    if (!tex) return null;
    const ctx = tex.getContext();
    ctx.clearRect(0, 0, CELL_PX, CELL_PX);
    const rng = mulberry((type * 0x9E3779B1) ^ (nm * 0x85EBCA77) ^ ((variant & 1) * 0xC2B2AE35));
    const hw = (ROAD_WIDTH[type] || 10) / 2;
    const jit = makeJitters(rng, type === 8 ? 1.0 : 1.4);
    // Curb layer — same wobble, 1px fatter, so the kerb ring stays even.
    ctx.fillStyle = hex(CURB_COLOR[type] || 0x0d0d12);
    silhouettePath(ctx, nm, hw + 1, jit, { in: hw + 1, q: HALF - hw - 1 });
    // Surface layer — full-cell pattern masked down to the wobbled silhouette.
    const off = document.createElement('canvas');
    off.width = off.height = CELL_PX;
    const octx = off.getContext('2d');
    paintPattern(octx, type, rng);
    octx.globalCompositeOperation = 'destination-in';
    octx.fillStyle = '#fff';
    silhouettePath(octx, nm, hw, jit, { in: hw, q: HALF - hw });
    ctx.drawImage(off, 0, 0);
    tex.refresh();
    return key;
  }

  // Draw procedural road geometry for one cell — flat-colour Graphics
  // FALLBACK, used only when the texture manager isn't available. The shapes
  // mirror the baked textures' nominal (un-wobbled) geometry.
  //
  //   g        — Phaser Graphics (roadGfx, already cleared this frame)
  //   sx, sy   — integer pixel top-left of the cell
  //   type     — terrain code
  //   mask     — 8-bit neighbor flags: N=1, E=2, S=4, W=8,
  //              NE=16, SE=32, SW=64, NW=128
  function drawRoadCell(g, sx, sy, type, mask) {
    const W   = ROAD_WIDTH[type] || 10;
    const hw  = W >> 1;           // half road-width
    const cx  = sx + HALF;        // pixel center x
    const cy  = sy + HALF;        // pixel center y

    const N = mask & 1;
    const E = mask & 2;
    const S = mask & 4;
    const W8 = mask & 8;
    // A diagonal is "solid" when both flanking orthogonals and the diagonal
    // itself are road — the four cells form a block, so the corner quadrant
    // between the two arms belongs to the road surface.
    const NE = N && E  && (mask & 16);
    const SE = S && E  && (mask & 32);
    const SW = S && W8 && (mask & 64);
    const NW = N && W8 && (mask & 128);

    // ── Curb layer — 1px wider on each side, drawn first so the road surface
    //    covers the interior and only the 1px kerb edge remains visible.
    const CW  = W + 2;
    const chw = CW >> 1;
    g.fillStyle(CURB_COLOR[type], 1);
    g.fillRect(cx - chw, cy - chw, CW,   CW);    // center
    if (N)  g.fillRect(cx - chw,  sy,        CW,   HALF);  // N arm
    if (S)  g.fillRect(cx - chw,  sy + HALF, CW,   HALF);  // S arm
    if (E)  g.fillRect(sx + HALF, cy - chw,  HALF, CW);    // E arm
    if (W8) g.fillRect(sx,        cy - chw,  HALF, CW);    // W arm

    // ── Road surface — drawn on top of curb, W px wide.
    g.fillStyle(ROAD_COLOR[type], 1);
    g.fillRect(cx - hw, cy - hw, W,    W);       // center
    if (N)  g.fillRect(cx - hw,   sy,        W,    HALF);  // N arm
    if (S)  g.fillRect(cx - hw,   sy + HALF, W,    HALF);  // S arm
    if (E)  g.fillRect(sx + HALF, cy - hw,   HALF, W);     // E arm
    if (W8) g.fillRect(sx,        cy - hw,   HALF, W);     // W arm

    // ── Inner-corner fill — close the quadrant gap between two arms when the
    //    diagonal is solid. Without this a 2-cell-wide road reads as two
    //    parallel strips linked by rungs; with it the block merges into one
    //    surface (also covers the now-interior kerb lines drawn above).
    const q = HALF - hw;          // quadrant size: arm edge → cell corner
    if (NE) g.fillRect(cx + hw, sy,      q, q);
    if (SE) g.fillRect(cx + hw, cy + hw, q, q);
    if (SW) g.fillRect(sx,      cy + hw, q, q);
    if (NW) g.fillRect(sx,      sy,      q, q);
  }

  // Pure L-bend detection. Returns the sprite rotation (degrees) that maps
  // the canonical N+E elbow texture onto this cell's orientation, or -1 when
  // the cell isn't a pure elbow (straights, junctions, dead ends — or a
  // block corner whose between-diagonal is solid road: that corner quadrant
  // belongs to the merged surface, so the square geometry is correct there).
  function elbowAngle(mask) {
    const o = mask & 15;
    if (o === 3)  return (mask & 16)  ? -1 : 0;    // N+E (diag NE solid → no)
    if (o === 6)  return (mask & 32)  ? -1 : 90;   // E+S
    if (o === 12) return (mask & 64)  ? -1 : 180;  // S+W
    if (o === 9)  return (mask & 128) ? -1 : 270;  // W+N
    return -1;
  }

  // Bake one 32×32 elbow texture per road tier (canonical orientation: arms
  // N + E, rounded outer corner at SW). Canvas 2D fills the arc with proper
  // antialiasing at bake time, so the curve stays smooth even though the
  // game runs with pixelArt (no runtime AA — Graphics-drawn arcs staircase,
  // which is why the elbow is a texture and not vector geometry). The other
  // three orientations come free via 90° sprite rotation (lossless). The
  // surface fill is the same cobble/dirt pattern the straight cells bake, so
  // bends match seamlessly.
  function makeElbowTextures(scene) {
    for (const type of [8, 7, 14, 13]) {
      const key = 'roadelbow_' + type;
      if (scene.textures.exists(key)) continue;
      const tex = scene.textures.createCanvas(key, CELL_PX, CELL_PX);
      const ctx = tex.getContext();
      const W = ROAD_WIDTH[type], hw = W / 2, CW = W + 2, chw = CW / 2;
      const cx = HALF, cy = HALF;
      // One layer = N-arm rect + E-arm rect + quarter-disc pie pivoted on the
      // bend's inner corner (flat pie edges flush with both arms; the arc
      // rounds the outer corner). Curb layer first, patterned surface on top
      // leaves the 1px kerb ring visible along the whole bend.
      //
      // Built as ONE path with a single fill: the surface pass masks the
      // pattern with destination-in, and under that op each fill() composites
      // separately — three sequential fills would each erase everything
      // outside themselves, leaving the intersection (≈ nothing), which is
      // why elbows used to render as flat curb colour with no cobble/dirt
      // pattern.
      const layer = (c2, color, h) => {
        c2.fillStyle = color;
        c2.beginPath();
        c2.rect(cx - h, 0, 2 * h, cy - h);              // N arm
        c2.rect(cx + h, cy - h, CELL_PX, 2 * h);        // E arm
        c2.moveTo(cx + h, cy - h);                      // inner-corner pivot
        c2.arc(cx + h, cy - h, 2 * h, Math.PI / 2, Math.PI);
        c2.closePath();
        c2.fill();
      };
      layer(ctx, hex(CURB_COLOR[type]), chw);
      if (typeof document !== 'undefined') {
        const off = document.createElement('canvas');
        off.width = off.height = CELL_PX;
        const octx = off.getContext('2d');
        paintPattern(octx, type, mulberry(type * 0x9E3779B1));
        octx.globalCompositeOperation = 'destination-in';
        layer(octx, '#fff', hw);
        ctx.drawImage(off, 0, 0);
      } else {
        layer(ctx, hex(ROAD_COLOR[type]), hw);
      }
      tex.refresh();
    }
  }

  root.RoadRender = { drawRoadCell, elbowAngle, makeElbowTextures, isAnyRoad,
    ensureRoadCellTexture, normalizeMask, ROAD_WIDTH, ROAD_COLOR };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.RoadRender;
})(typeof window !== 'undefined' ? window : globalThis);
