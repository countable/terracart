// ─────────────────────────────────────────────────────────────────────────
// Sprite layout — the ONE place the "one cell" placement rule lives.
//
// THE RULE (audited by tools/sprite_audit.js, documented in CLAUDE.md):
//   For every world sprite EXCEPT buildings (house / tower / produce stands
//   / pot-of-gold) and moving/animated actors (creatures):
//     1. The sprite's visible art must NEVER cross the cell's bottom edge.
//     2. If the art FITS in the cell (height <= one cell) it is centred
//        vertically in the cell.
//     3. If it does NOT fit, its bottom is seated exactly 1px above the
//        cell bottom.
//     4. The art is always centred horizontally on the cell.
//
// "Visible art" = the opaque, trimmed bounding box of the actual pixels in a
// frame — NOT the frame box, since many sheets carry transparent padding. The
// trimmed bounds for every frame the renderer seats live in ART_BOUNDS below;
// regenerate them with `node tools/sprite_audit.js --emit-bounds` whenever the
// art changes (the audit fails if this table drifts from the real PNGs).
//
// seatInCell() turns a frame's trimmed bounds + its origin/scale into the
// (dxPx, dyPx) nudge — relative to the projected cell CENTRE — that satisfies
// the rule. render.js applies it; the audit replays it to verify compliance.
// ─────────────────────────────────────────────────────────────────────────
(function (root) {
  'use strict';
  const CELL_PX = 32;

  // Trimmed opaque bounds per "<textureKey>:<frameIndex>" (max EXCLUSIVE).
  // GENERATED — see `node tools/sprite_audit.js --emit-bounds`.
  const ART_BOUNDS = {
    'trees:1':         { fw: 32, fh: 48, minX: 11, minY: 34, maxX: 20, maxY: 46 },
    'trees:2':         { fw: 32, fh: 48, minX: 7,  minY: 14, maxX: 27, maxY: 47 },
    'trees:3':         { fw: 32, fh: 48, minX: 0,  minY: 1,  maxX: 32, maxY: 47 },
    'pine_tree:3':     { fw: 32, fh: 64, minX: 0,  minY: 2,  maxX: 32, maxY: 48 },
    'birch_tree:3':    { fw: 32, fh: 64, minX: 0,  minY: 2,  maxX: 32, maxY: 64 },
    'mahogany_tree:3': { fw: 32, fh: 64, minX: 0,  minY: 1,  maxX: 32, maxY: 46 },
    'bushes:0':        { fw: 48, fh: 32, minX: 9,  minY: 0,  maxX: 41, maxY: 32 },
    'apple_tree:0':    { fw: 32, fh: 48, minX: 12, minY: 43, maxX: 20, maxY: 46 },
    'apple_tree:2':    { fw: 32, fh: 48, minX: 5,  minY: 14, maxX: 29, maxY: 48 },
    'apple_tree:4':    { fw: 32, fh: 48, minX: 0,  minY: 1,  maxX: 32, maxY: 47 },
    'apple_tree:5':    { fw: 32, fh: 48, minX: 0,  minY: 1,  maxX: 32, maxY: 47 },
    'apple_tree:7':    { fw: 32, fh: 48, minX: 0,  minY: 1,  maxX: 32, maxY: 47 },
    'peach_tree:0':    { fw: 32, fh: 48, minX: 12, minY: 42, maxX: 20, maxY: 46 },
    'peach_tree:2':    { fw: 32, fh: 48, minX: 5,  minY: 14, maxX: 28, maxY: 48 },
    'peach_tree:3':    { fw: 32, fh: 48, minX: 0,  minY: 2,  maxX: 32, maxY: 48 },
    'peach_tree:4':    { fw: 32, fh: 48, minX: 0,  minY: 2,  maxX: 32, maxY: 48 },
    'peach_tree:5':    { fw: 32, fh: 48, minX: 0,  minY: 2,  maxX: 32, maxY: 48 },
    'chest:0':         { fw: 32, fh: 32, minX: 1,  minY: 8,  maxX: 32, maxY: 31 },
    'box:0':           { fw: 16, fh: 16, minX: 0,  minY: 0,  maxX: 16, maxY: 16 },
    'mineralrock:168': { fw: 16, fh: 16, minX: 1,  minY: 5,  maxX: 16, maxY: 15 },
    'mineralrock:169': { fw: 16, fh: 16, minX: 3,  minY: 6,  maxX: 12, maxY: 14 },
    'mineralrock:170': { fw: 16, fh: 16, minX: 3,  minY: 6,  maxX: 13, maxY: 14 },
    'mineralrock:171': { fw: 16, fh: 16, minX: 1,  minY: 4,  maxX: 14, maxY: 15 },
    'mineralrock:0':   { fw: 16, fh: 16, minX: 2,  minY: 4,  maxX: 13, maxY: 14 },
    'mineralrock:1':   { fw: 16, fh: 16, minX: 2,  minY: 4,  maxX: 13, maxY: 14 },
    'mineralrock:2':   { fw: 16, fh: 16, minX: 2,  minY: 4,  maxX: 13, maxY: 14 },
    'mineralrock:3':   { fw: 16, fh: 16, minX: 2,  minY: 4,  maxX: 13, maxY: 14 },
    'mineralrock:5':   { fw: 16, fh: 16, minX: 2,  minY: 4,  maxX: 13, maxY: 14 },
    'mineralrock:6':   { fw: 16, fh: 16, minX: 2,  minY: 4,  maxX: 13, maxY: 14 },
    'well:0':          { fw: 30, fh: 32, minX: 2,  minY: 0,  maxX: 30, maxY: 32 },
    'pillar:0':        { fw: 16, fh: 32, minX: 1,  minY: 0,  maxX: 15, maxY: 28 },
    'scarecrow:0':     { fw: 48, fh: 48, minX: 3,  minY: 8,  maxX: 45, maxY: 47 },
    'bonfire:0':       { fw: 16, fh: 32, minX: 1,  minY: 9,  maxX: 14, maxY: 31 },
  };

  // Given a frame's trimmed bounds (max exclusive), its origin (anchor as a
  // fraction of the frame box) and its X/Y scale, return the { dxPx, dyPx }
  // offset from the projected cell CENTRE that places the art per the rule.
  // `fits` is returned for callers/tests that care which branch was taken.
  function seatInCell(box, originX, originY, scaleX, scaleY, cellPx) {
    cellPx = cellPx || CELL_PX;
    const artBottomLocal = box.maxY - originY * box.fh;       // px below anchor
    const artMidLocal    = (box.minY + box.maxY) / 2 - originY * box.fh;
    const artHeight      = (box.maxY - box.minY) * scaleY;
    const fits = artHeight <= cellPx;
    // Vertical: centre when it fits, else seat the bottom 1px above the edge.
    const dyPx = fits ? -artMidLocal * scaleY
                      : (cellPx / 2 - 1) - artBottomLocal * scaleY;
    // Horizontal: always centre the art on the cell.
    const artMidX = (box.minX + box.maxX) / 2 - originX * box.fw;
    const dxPx = -artMidX * scaleX;
    return { dxPx, dyPx, fits };
  }

  const api = { CELL_PX, ART_BOUNDS, seatInCell };
  root.SpriteLayout = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
