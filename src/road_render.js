// Procedural road and path geometry — draws center squares + directional arms
// onto the road Graphics layer, replacing the cobble-sprite overlay.
//
// Each road/path cell draws:
//   • A center square (always, even for isolated cells)
//   • One arm per connected orthogonal neighbor, each reaching the cell edge
//   • A corner-quadrant fill per "solid" diagonal (both flanking orthogonals
//     AND the diagonal between them are road) — this merges multi-cell-wide
//     roads into one continuous surface instead of parallel strips joined by
//     ladder rungs
//
// All geometry stays within the cell — the neighbor cell draws a matching arm
// back, so connections are seamless at the shared boundary with no bleed or
// gaps. Diagonal Bresenham steps don't need special handling here: worldgen's
// paintLine is 4-connected, so every diagonal step has a real elbow cell.
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
  // into a solid highway surface. PATH at 4px reads as a narrow gravel track.
  const ROAD_WIDTH = {
    8:  4,   // PATH    — narrow gravel/dirt track
    7:  10,  // ROAD    — quiet residential street
    14: 18,  // ROAD_MD — secondary / town road
    13: 30,  // ROAD_LG — highway (fills nearly the full cell)
  };

  // Surface colours — warm-to-cool progression, all dark enough to contrast
  // with the warm biome palette while staying recognisably "road".
  const ROAD_COLOR = {
    8:  0xc4b896,  // PATH    — sandy warm gravel
    7:  0x847c72,  // ROAD    — warm mid-grey asphalt
    14: 0x6e6a7a,  // ROAD_MD — cooler grey
    13: 0x4a4858,  // ROAD_LG — dark highway asphalt
  };

  // Thin darker outline drawn 1px wider than the surface on every side,
  // giving road edges a crisp kerb line against the biome background.
  const CURB_COLOR = {
    8:  0x9e9478,
    7:  0x504840,
    14: 0x48444e,
    13: 0x28263a,
  };

  // isAnyRoad — used by render.js to build the neighbor mask.
  // Exported so render.js doesn't duplicate the terrain-code list.
  function isAnyRoad(t) {
    return t === 7 || t === 8 || t === 13 || t === 14;
  }

  // Draw procedural road geometry for one cell.
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
  // three orientations come free via 90° sprite rotation (lossless).
  function makeElbowTextures(scene) {
    const hex = (c) => '#' + c.toString(16).padStart(6, '0');
    for (const type of [8, 7, 14, 13]) {
      const key = 'roadelbow_' + type;
      if (scene.textures.exists(key)) continue;
      const tex = scene.textures.createCanvas(key, CELL_PX, CELL_PX);
      const ctx = tex.getContext();
      const W = ROAD_WIDTH[type], hw = W / 2, CW = W + 2, chw = CW / 2;
      const cx = HALF, cy = HALF;
      // One layer = N-arm rect + E-arm rect + quarter-disc pie pivoted on the
      // bend's inner corner (flat pie edges flush with both arms; the arc
      // rounds the outer corner). Curb layer first, surface on top leaves
      // the 1px kerb ring visible along the whole bend.
      const layer = (color, h) => {
        ctx.fillStyle = color;
        ctx.fillRect(cx - h, 0, 2 * h, cy - h);          // N arm
        ctx.fillRect(cx + h, cy - h, CELL_PX, 2 * h);    // E arm
        ctx.beginPath();
        ctx.moveTo(cx + h, cy - h);                      // inner-corner pivot
        ctx.arc(cx + h, cy - h, 2 * h, Math.PI / 2, Math.PI);
        ctx.closePath();
        ctx.fill();
      };
      layer(hex(CURB_COLOR[type]), chw);
      layer(hex(ROAD_COLOR[type]), hw);
      tex.refresh();
    }
  }

  root.RoadRender = { drawRoadCell, elbowAngle, makeElbowTextures, isAnyRoad, ROAD_WIDTH, ROAD_COLOR };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.RoadRender;
})(typeof window !== 'undefined' ? window : globalThis);
