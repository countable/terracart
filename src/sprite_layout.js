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
//
// Creatures are exempt from the rule (they're moving actors), but their drawn
// geometry lives here too — see CREATURE_ART near the bottom — so the sprite,
// its shadow and the work-progress wheel all read one table.
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
    'pine_tree:3':     { fw: 32, fh: 48, minX: 0,  minY: 2,  maxX: 32, maxY: 48 },
    'birch_tree:3':    { fw: 32, fh: 48, minX: 0,  minY: 2,  maxX: 32, maxY: 48 },
    'mahogany_tree:3': { fw: 32, fh: 48, minX: 0,  minY: 1,  maxX: 32, maxY: 46 },
    'bushes:0':        { fw: 48, fh: 32, minX: 9,  minY: 0,  maxX: 41, maxY: 32 },
    'apple_tree:0':    { fw: 32, fh: 48, minX: 12, minY: 43, maxX: 20, maxY: 46 },
    'apple_tree:2':    { fw: 32, fh: 48, minX: 5,  minY: 14, maxX: 29, maxY: 48 },
    'apple_tree:4':    { fw: 32, fh: 48, minX: 0,  minY: 1,  maxX: 32, maxY: 47 },
    'apple_tree:5':    { fw: 32, fh: 48, minX: 0,  minY: 1,  maxX: 32, maxY: 47 },
    'peach_tree:0':    { fw: 32, fh: 48, minX: 12, minY: 42, maxX: 20, maxY: 46 },
    'peach_tree:2':    { fw: 32, fh: 48, minX: 5,  minY: 14, maxX: 28, maxY: 48 },
    'peach_tree:3':    { fw: 32, fh: 48, minX: 0,  minY: 2,  maxX: 32, maxY: 48 },
    'peach_tree:4':    { fw: 32, fh: 48, minX: 0,  minY: 2,  maxX: 32, maxY: 48 },
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

  // ── Fruit-tree crowns ────────────────────────────────────────────────────
  // A fruit tree that is BEARING wears the fruit as its own little sprite on
  // the canopy (render.js's fruit pass) rather than the tree swapping to its
  // sheet's fruiting frame — so a pick takes the fruit away, it doesn't change
  // the tree.
  //
  // That overlay has to sit on the LEAFY MASS, and the leafy mass is not the
  // art's full bounds: those run on down through the trunk to the root base,
  // and their midline lands on bare bark. CROWN_BOUNDS is the canopy box of
  // the mature frame each species renders — the rows above where the leaves
  // give out and the trunk begins.
  // GENERATED — `node tools/sprite_audit.js --emit-bounds` prints it beneath
  // ART_BOUNDS; the audit re-derives it from the real PNGs (canopy = down to
  // the first row past the widest whose span drops under half that width) and
  // fails if this table has drifted from the art.
  const CROWN_BOUNDS = {
    'apple_tree:4': { fw: 32, fh: 48, minX: 0, minY: 1, maxX: 32, maxY: 34 },
    'peach_tree:3': { fw: 32, fh: 48, minX: 0, minY: 2, maxX: 32, maxY: 35 },
  };

  // Offset in screen px from a fruit tree sprite's ANCHOR (its x/y — wherever
  // the seat pass put it) to the centre of its crown, which is where the fruit
  // goes. Derived from the art the tree is actually drawing and the origin /
  // scale it drew at, so a re-seated, re-scaled or re-framed tree carries its
  // fruit with it instead of leaving it behind at a hand-picked offset.
  // Returns null for a frame with no crown box — a sprout or a young tree
  // can't be bearing, so it never needs one.
  function fruitCrownOffset(texKey, frame, originX, originY, scaleX, scaleY) {
    const c = CROWN_BOUNDS[`${texKey}:${frame}`];
    if (!c) return null;
    return {
      dxPx: ((c.minX + c.maxX) / 2 - originX * c.fw) * scaleX,
      dyPx: ((c.minY + c.maxY) / 2 - originY * c.fh) * scaleY,
    };
  }

  // ── Creatures ────────────────────────────────────────────────────────────
  // Creatures are EXEMPT from the seat rule above (they're moving actors, and
  // they're drawn feet-anchored so a cow can tower over its cell). But the
  // work-progress wheel still has to be placed against their art, so the
  // geometry the renderer draws them with lives here too, in one table:
  //
  //   fw/fh   frame size on the sheet
  //   scale   render scale
  //   foot    origin Y as a fraction of the frame — the row that sits on the
  //           ground line (render.js setOrigin(0.5, foot))
  //   float   constant lift off the ground line: crows perch above their tile,
  //           butterflies and bats hover. NOT the idle hop, which is animated
  //           in render.js — the wheel deliberately ignores the bob so it
  //           doesn't jitter while a slime bounces under it.
  //   minY/maxY  trimmed opaque rows of the REFERENCE frame (frame 0, the rest
  //           pose — sibling frames agree to within a pixel), max EXCLUSIVE.
  //
  // render.js reads scale/foot/float from here so the drawn sprite and the
  // wheel can't drift apart, and `node tools/sprite_audit.js` re-decodes the
  // real PNGs to check minY/maxY hasn't drifted from the art.
  const CREATURE_ART = {
    chicken:       { fw: 16, fh: 16, scale: 1.20, foot: 16 / 16, float: 0,  minY: 0,  maxY: 16 },
    cow:           { fw: 32, fh: 32, scale: 1.50, foot: 32 / 32, float: 0,  minY: 13, maxY: 32 },
    cat:           { fw: 32, fh: 32, scale: 1.30, foot: 29 / 32, float: 0,  minY: 18, maxY: 29 },
    dog:           { fw: 32, fh: 32, scale: 1.30, foot: 29 / 32, float: 0,  minY: 15, maxY: 29 },
    deer:          { fw: 32, fh: 32, scale: 1.30, foot: 31 / 32, float: 0,  minY: 11, maxY: 31 },
    rabbit:        { fw: 16, fh: 16, scale: 1.50, foot: 16 / 16, float: 0,  minY: 3,  maxY: 16 },
    crow:          { fw: 32, fh: 32, scale: 1.30, foot: 31 / 32, float: 13, minY: 18, maxY: 31 },
    butterfly:     { fw: 16, fh: 16, scale: 2.00, foot: 12 / 16, float: 15, minY: 6,  maxY: 12 },
    slime:         { fw: 32, fh: 32, scale: 1.20, foot: 21 / 32, float: 0,  minY: 10, maxY: 21 },
    // Underground monsters. cave_slime reuses the slime sheet (tinted) but has
    // never had a CREATURE_FOOT entry, so it draws on the blanket 0.9 origin —
    // recorded here as it renders TODAY rather than "fixed", so this table
    // stays a description of what's on screen. (It does mean the cave slime
    // hangs ~10 px above its own contact shadow; worth a separate look.)
    cave_slime:    { fw: 32, fh: 32, scale: 1.25, foot: 0.9,     float: 0,  minY: 10, maxY: 21 },
    purple_slime:  { fw: 32, fh: 32, scale: 0.95, foot: 21 / 32, float: 8,  minY: 10, maxY: 21 },
    goblin:        { fw: 32, fh: 32, scale: 1.25, foot: 27 / 32, float: 0,  minY: 9,  maxY: 27 },
    goblin_archer: { fw: 32, fh: 32, scale: 1.25, foot: 26 / 32, float: 0,  minY: 6,  maxY: 26 },
  };
  // Every creature is drawn this far below its projected cell centre, so its
  // art bottom lands on the centre of its contact shadow (render.js).
  const CREATURE_GROUND_DY = 2;
  // Fallback for a kind with no entry: the flat offset the wheel used before
  // this table existed.
  const CREATURE_WHEEL_FALLBACK_DY = -11;
  // The work wheel's ring radius, as app.js strokes it. The dark backing disc
  // behind the ring is drawn one pixel larger, so the wheel's OUTER edge is
  // CREATURE_WHEEL_R + 1 — that outer figure is what the seating below has to
  // clear, and what tools/sprite_audit.js measures. Kept here so the number
  // that DRAWS the wheel and the number that PLACES it can't drift apart.
  const CREATURE_WHEEL_R = 9;

  // The enemy HEALTH BAR (app.js _drawEnemyHealthBar). Sized to the wheel's
  // diameter so the two combat readouts feel like one family, but drawn as a
  // BAR so health never reads as the work wheel: the wheel is a ring that
  // sits ON the animal, the bar is a strip that floats ABOVE it.
  const HEALTH_BAR_W = 18;      // bar width, px — the wheel's stroked diameter
  const HEALTH_BAR_H = 3;       // bar height, px
  const HEALTH_BAR_GAP = 2;     // clear sky between the crown and the bar

  // Vertical origin the renderer should anchor `kind` at (fraction of frame).
  function creatureFoot(kind) {
    const a = CREATURE_ART[kind];
    return a ? a.foot : 0.9;
  }

  // THE CREATURE WHEEL RULE: the work-progress wheel RESTS ON the animal's
  // CROWN — the top row of its visible art, at rest. The ring's top edge sits
  // on that row, so the whole wheel reads as sitting on the animal rather than
  // straddling its outline.
  //
  // This used to centre the wheel ON the crown, which put a full radius — ten
  // pixels — of ring in the empty sky above every animal, for every kind. That
  // is what read as "too high": the overshoot was a constant 10 px, so it was
  // wrong everywhere, and wrong by a far bigger FRACTION of a 12 px butterfly
  // than of a 28 px cow, which is why some animals looked worse than others.
  // Seating the ring's top edge on the crown removes exactly that overshoot.
  //
  // The clamp is what keeps it honest at both ends of the size range. An
  // animal shorter than the wheel's diameter has nowhere to put a full radius
  // without the ring sliding off its feet, so the drop is capped at half the
  // art's height and the wheel centres on the animal's midline instead. A flat
  // offset can do neither: the -21 px this replaced hugged a cow's head, floated
  // clear above a chicken, and sat down at a perched crow's feet.
  //
  // Returns the offset in screen px from the creature's projected cell centre
  // to the wheel centre (negative = up the screen).
  function creatureWheelDy(kind) {
    const a = CREATURE_ART[kind];
    if (!a) return CREATURE_WHEEL_FALLBACK_DY;
    const anchorY = CREATURE_GROUND_DY - a.float;      // where the origin lands
    const artTop = anchorY - (a.foot * a.fh - a.minY) * a.scale;
    const artH = (a.maxY - a.minY) * a.scale;
    // Outer edge of the wheel — the backing disc, not the stroked ring.
    return artTop + Math.min(CREATURE_WHEEL_R + 1, artH / 2);
  }

  // THE HEALTH BAR RULE: the bar floats a fixed sliver of sky ABOVE the kind's
  // crown — the top row of its visible art, at rest — so it hovers over the
  // head like a name-plate rather than sitting on the body the way the work
  // wheel does. Same table, same crown, different side of it: derived per kind
  // from CREATURE_ART exactly like creatureWheelDy, never a flat offset (a
  // flat offset is what floated the old wheel 4 px above a chicken and parked
  // it at a crow's feet).
  //
  // Returns the offset in screen px from the creature's projected cell centre
  // to the bar's TOP edge (negative = up the screen).
  function creatureHealthBarTop(kind) {
    const a = CREATURE_ART[kind];
    if (!a) {
      // No art entry: hang the bar over where the fallback wheel's outer edge
      // would be, so an unknown kind still reads sanely.
      return CREATURE_WHEEL_FALLBACK_DY - (CREATURE_WHEEL_R + 1)
        - HEALTH_BAR_GAP - HEALTH_BAR_H;
    }
    const anchorY = CREATURE_GROUND_DY - a.float;
    const artTop = anchorY - (a.foot * a.fh - a.minY) * a.scale;
    return artTop - HEALTH_BAR_GAP - HEALTH_BAR_H;
  }

  const api = {
    CELL_PX, ART_BOUNDS, seatInCell,
    CROWN_BOUNDS, fruitCrownOffset,
    CREATURE_ART, CREATURE_GROUND_DY, CREATURE_WHEEL_R,
    HEALTH_BAR_W, HEALTH_BAR_H, HEALTH_BAR_GAP,
    creatureFoot, creatureWheelDy, creatureHealthBarTop,
  };
  root.SpriteLayout = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
