// Procedural road and path geometry — draws center squares + directional arms
// onto the terrain Graphics object, replacing the cobble-sprite overlay.
//
// Each road/path cell draws:
//   • A center square (always, even for isolated cells)
//   • One arm per connected orthogonal neighbor, each reaching the cell edge
//
// Arms stay within the cell — the neighbor cell draws a matching arm back, so
// connections are seamless at the shared boundary with no bleed or gaps.
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
  //   g        — Phaser Graphics (cellGfx, already cleared this frame)
  //   sx, sy   — integer pixel top-left of the cell
  //   type     — terrain code
  //   mask     — 4-bit neighbor flags: N=1, E=2, S=4, W=8
  function drawRoadCell(g, sx, sy, type, mask) {
    const W   = ROAD_WIDTH[type] || 10;
    const hw  = W >> 1;           // half road-width
    const cx  = sx + HALF;        // pixel center x
    const cy  = sy + HALF;        // pixel center y

    const N = mask & 1;
    const E = mask & 2;
    const S = mask & 4;
    const W8 = mask & 8;

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
  }

  root.RoadRender = { drawRoadCell, isAnyRoad, ROAD_WIDTH, ROAD_COLOR };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.RoadRender;
})(typeof window !== 'undefined' ? window : globalThis);
