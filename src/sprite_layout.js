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
// its shadow and the work-progress wheel all read one table. CREATURE_BEHAVIOUR
// beside it is the same idea pointed at what a kind DOES rather than how it
// draws: one row per kind, read by the wander loop, the tap handler and the
// kill payout, so none of them has to spell a kind out by name. Neither table
// decides whether a kind is HOSTILE — that is combat.js's MONSTERS registry, read
// through Combat.isEnemy.
// ─────────────────────────────────────────────────────────────────────────
(function (root) {
  'use strict';
  const CELL_PX = 32;
  const roster = root.EnemyRoster || (typeof require === 'function' ? require('./enemy_roster.js') : null);

  // Trimmed opaque bounds per "<textureKey>:<frameIndex>" (max EXCLUSIVE).
  // GENERATED — see `node tools/sprite_audit.js --emit-bounds`.
  const ART_BOUNDS = {
    'gas_mushroom_small:0': { fw: 16, fh: 16, minX: 3, minY: 4, maxX: 13, maxY: 15 },
    'gas_mushroom_large:0': { fw: 24, fh: 24, minX: 1, minY: 1, maxX: 23, maxY: 23 },
    'bone_cache:0': { fw: 16, fh: 16, minX: 1, minY: 4, maxX: 15, maxY: 14 },
    'cave_props:0': { fw: 24, fh: 24, minX: 3, minY: 8, maxX: 24, maxY: 24 },
    'cave_props:1': { fw: 24, fh: 24, minX: 3, minY: 2, maxX: 24, maxY: 24 },
    'cave_props:6': { fw: 24, fh: 24, minX: 3, minY: 1, maxX: 24, maxY: 23 },
    'cave_props:17': { fw: 24, fh: 24, minX: 1, minY: 5, maxX: 23, maxY: 23 },
    'cave_props:24': { fw: 24, fh: 21, minX: 2, minY: 3, maxX: 22, maxY: 20 },
    'cave_props:25': { fw: 24, fh: 23, minX: 2, minY: 5, maxX: 22, maxY: 22 },
    'cave_props:26': { fw: 24, fh: 24, minX: 2, minY: 3, maxX: 22, maxY: 20 },
    'cave_props:27': { fw: 24, fh: 24, minX: 2, minY: 3, maxX: 22, maxY: 20 },
    'cave_props:28': { fw: 24, fh: 24, minX: 2, minY: 3, maxX: 22, maxY: 20 },
    'cave_props:29': { fw: 24, fh: 24, minX: 2, minY: 3, maxX: 22, maxY: 20 },
    'poison_vent_inactive:0': { fw: 24, fh: 24, minX: 4, minY: 14, maxX: 20, maxY: 23 },
    'beach_palms:0': { fw: 16, fh: 16, minX: 4, minY: 9, maxX: 10, maxY: 15 },
    'beach_palms:1': { fw: 16, fh: 16, minX: 6, minY: 9, maxX: 12, maxY: 15 },
    'beach_palms:2': { fw: 16, fh: 16, minX: 2, minY: 0, maxX: 15, maxY: 15 },
    'beach_palms:3': { fw: 16, fh: 16, minX: 2, minY: 0, maxX: 15, maxY: 15 },
    'beach_palms:4': { fw: 16, fh: 16, minX: 1, minY: 0, maxX: 14, maxY: 15 },
    'beach_palms:5': { fw: 16, fh: 16, minX: 1, minY: 0, maxX: 14, maxY: 15 },
    'trees:1': { fw: 32, fh: 48, minX: 11, minY: 37, maxX: 21, maxY: 48 },
    'trees:2': { fw: 32, fh: 48, minX: 7, minY: 16, maxX: 25, maxY: 48 },
    'trees:3': { fw: 32, fh: 48, minX: 0, minY: 1, maxX: 32, maxY: 48 },
    'pine_tree:1': { fw: 32, fh: 48, minX: 12, minY: 36, maxX: 19, maxY: 46 },
    'pine_tree:2': { fw: 32, fh: 48, minX: 4, minY: 14, maxX: 27, maxY: 48 },
    'pine_tree:3': { fw: 32, fh: 48, minX: 0, minY: 2, maxX: 32, maxY: 48 },
    'bushes:0': { fw: 48, fh: 32, minX: 9, minY: 0, maxX: 41, maxY: 32 },
    'apple_tree:0': { fw: 32, fh: 48, minX: 12, minY: 43, maxX: 20, maxY: 46 },
    'apple_tree:2': { fw: 32, fh: 48, minX: 5, minY: 14, maxX: 29, maxY: 48 },
    'apple_tree:4': { fw: 32, fh: 48, minX: 0, minY: 1, maxX: 32, maxY: 47 },
    'apple_tree:5': { fw: 32, fh: 48, minX: 0, minY: 1, maxX: 32, maxY: 47 },
    'worldpeach_tree:0': { fw: 32, fh: 48, minX: 12, minY: 42, maxX: 20, maxY: 46 },
    'worldpeach_tree:2': { fw: 32, fh: 48, minX: 5, minY: 14, maxX: 28, maxY: 48 },
    'worldpeach_tree:3': { fw: 32, fh: 48, minX: 0, minY: 2, maxX: 32, maxY: 48 },
    'worldpeach_tree:4': { fw: 32, fh: 48, minX: 0, minY: 2, maxX: 32, maxY: 48 },
    'chest:0': { fw: 16, fh: 16, minX: 1, minY: 4, maxX: 15, maxY: 15 },
    'box:0': { fw: 16, fh: 16, minX: 0, minY: 0, maxX: 16, maxY: 16 },
    'shrine_spirit:0': { fw: 16, fh: 16, minX: 2, minY: 1, maxX: 14, maxY: 15 },
    'shrine_spirit:1': { fw: 16, fh: 16, minX: 2, minY: 0, maxX: 14, maxY: 14 },
    'shrine_spirit:2': { fw: 16, fh: 16, minX: 2, minY: 0, maxX: 14, maxY: 14 },
    'shrine_spirit:3': { fw: 16, fh: 16, minX: 2, minY: 1, maxX: 14, maxY: 15 },
    'crystal_cluster:0': { fw: 16, fh: 16, minX: 1, minY: 2, maxX: 15, maxY: 14 },
    'mineralrock:168': { fw: 16, fh: 16, minX: 1, minY: 5, maxX: 16, maxY: 15 },
    'mineralrock:169': { fw: 16, fh: 16, minX: 3, minY: 6, maxX: 12, maxY: 14 },
    'mineralrock:170': { fw: 16, fh: 16, minX: 3, minY: 6, maxX: 13, maxY: 14 },
    'mineralrock:171': { fw: 16, fh: 16, minX: 1, minY: 4, maxX: 14, maxY: 15 },
    'mineralrock:0': { fw: 16, fh: 16, minX: 2, minY: 4, maxX: 13, maxY: 14 },
    'mineralrock:1': { fw: 16, fh: 16, minX: 2, minY: 4, maxX: 13, maxY: 14 },
    'mineralrock:2': { fw: 16, fh: 16, minX: 2, minY: 4, maxX: 13, maxY: 14 },
    'mineralrock:3': { fw: 16, fh: 16, minX: 2, minY: 4, maxX: 13, maxY: 14 },
    'mineralrock:5': { fw: 16, fh: 16, minX: 2, minY: 4, maxX: 13, maxY: 14 },
    'mineralrock:7': { fw: 16, fh: 16, minX: 2, minY: 4, maxX: 13, maxY: 14 },
    'approved_charred_stakes:0': { fw: 24, fh: 24, minX: 1, minY: 4, maxX: 23, maxY: 23 },
    'well:0': { fw: 30, fh: 32, minX: 2, minY: 0, maxX: 30, maxY: 32 },
    'pillar:0': { fw: 24, fh: 24, minX: 6, minY: 1, maxX: 18, maxY: 23 },
    'scarecrow:0': { fw: 48, fh: 48, minX: 3, minY: 8, maxX: 45, maxY: 47 },
    'bonfire:0': { fw: 16, fh: 32, minX: 1, minY: 9, maxX: 14, maxY: 31 },
    'torch:0': { fw: 16, fh: 32, minX: 5, minY: 5, maxX: 12, maxY: 32 },
    'waystone:0': { fw: 16, fh: 16, minX: 0, minY: 1, maxX: 16, maxY: 16 },
    'tar:0': { fw: 16, fh: 16, minX: 1, minY: 6, maxX: 15, maxY: 15 },
    'grove_votive:0': { fw: 24, fh: 24, minX: 2, minY: 1, maxX: 21, maxY: 23 },
    'zone_objects:1': { fw: 24, fh: 24, minX: 6, minY: 1, maxX: 18, maxY: 23 },
    'zone_objects:4': { fw: 24, fh: 24, minX: 1, minY: 1, maxX: 22, maxY: 23 },
    'zone_objects:5': { fw: 24, fh: 24, minX: 1, minY: 5, maxX: 23, maxY: 19 },
    'zone_objects:6': { fw: 24, fh: 24, minX: 5, minY: 1, maxX: 18, maxY: 23 },
    'zone_objects:7': { fw: 24, fh: 24, minX: 1, minY: 4, maxX: 23, maxY: 19 },
    'zone_objects:34': { fw: 24, fh: 24, minX: 1, minY: 1, maxX: 23, maxY: 22 },
    'zone_objects:37': { fw: 24, fh: 24, minX: 1, minY: 2, maxX: 23, maxY: 22 },
    'zone_objects:38': { fw: 24, fh: 24, minX: 2, minY: 1, maxX: 22, maxY: 23 },
    'zone_objects:39': { fw: 24, fh: 24, minX: 1, minY: 2, maxX: 23, maxY: 22 },
    'zone_objects:40': { fw: 24, fh: 24, minX: 1, minY: 1, maxX: 23, maxY: 23 },
    'zone_objects:54': { fw: 24, fh: 24, minX: 3, minY: 1, maxX: 21, maxY: 23 },
    'zone_objects:58': { fw: 24, fh: 24, minX: 1, minY: 1, maxX: 22, maxY: 23 },
    'zone_objects:59': { fw: 24, fh: 24, minX: 1, minY: 2, maxX: 23, maxY: 22 },
    'zone_objects:61': { fw: 24, fh: 24, minX: 1, minY: 2, maxX: 23, maxY: 21 },
    'zone_objects:64': { fw: 24, fh: 24, minX: 1, minY: 5, maxX: 23, maxY: 23 },
    'zone_objects:65': { fw: 24, fh: 24, minX: 1, minY: 3, maxX: 23, maxY: 23 },
    'zone_objects:66': { fw: 24, fh: 24, minX: 1, minY: 5, maxX: 23, maxY: 23 },
    'zone_objects:67': { fw: 24, fh: 24, minX: 1, minY: 6, maxX: 23, maxY: 23 },
    'zone_objects:68': { fw: 24, fh: 24, minX: 1, minY: 5, maxX: 23, maxY: 23 },
    'zone_objects:69': { fw: 24, fh: 24, minX: 1, minY: 4, maxX: 23, maxY: 23 },
    'zone_objects:70': { fw: 24, fh: 24, minX: 1, minY: 4, maxX: 23, maxY: 23 },
    'zone_objects:71': { fw: 24, fh: 24, minX: 1, minY: 5, maxX: 23, maxY: 23 },
    'zone_berry_bush:0': { fw: 24, fh: 24, minX: 1, minY: 1, maxX: 23, maxY: 22 },
    'reef_coral:0': { fw: 24, fh: 24, minX: 1, minY: 1, maxX: 23, maxY: 23 },
    'reef_coral:1': { fw: 24, fh: 24, minX: 1, minY: 1, maxX: 23, maxY: 22 },
    'reef_coral:2': { fw: 24, fh: 24, minX: 2, minY: 1, maxX: 22, maxY: 23 },
    'reef_coral:3': { fw: 24, fh: 24, minX: 1, minY: 1, maxX: 22, maxY: 23 },
    'reef_coral:4': { fw: 24, fh: 24, minX: 1, minY: 2, maxX: 23, maxY: 22 },
    'reef_coral:5': { fw: 24, fh: 24, minX: 1, minY: 3, maxX: 23, maxY: 21 },
    'reef_coral:6': { fw: 24, fh: 24, minX: 2, minY: 1, maxX: 22, maxY: 23 },
    'reef_coral:7': { fw: 24, fh: 24, minX: 1, minY: 1, maxX: 22, maxY: 23 },
    'vista_scope:0': { fw: 16, fh: 24, minX: 0, minY: 0, maxX: 15, maxY: 24 },
    'shrines:0': { fw: 16, fh: 24, minX: 1, minY: 1, maxX: 15, maxY: 23 },
    'shrines:1': { fw: 16, fh: 24, minX: 1, minY: 1, maxX: 14, maxY: 23 },
    'shrines:2': { fw: 16, fh: 24, minX: 1, minY: 7, maxX: 15, maxY: 23 },
    'shrines:3': { fw: 16, fh: 24, minX: 1, minY: 1, maxX: 15, maxY: 23 },
    'shrines:4': { fw: 16, fh: 24, minX: 1, minY: 5, maxX: 15, maxY: 23 },
    'shrines:5': { fw: 16, fh: 24, minX: 2, minY: 1, maxX: 13, maxY: 23 },
    'shrines:6': { fw: 16, fh: 24, minX: 1, minY: 3, maxX: 15, maxY: 23 },
    'shrines:7': { fw: 16, fh: 24, minX: 1, minY: 3, maxX: 15, maxY: 23 },
    'shrines:8': { fw: 16, fh: 24, minX: 1, minY: 8, maxX: 15, maxY: 23 },
    'shrines:9': { fw: 16, fh: 24, minX: 1, minY: 8, maxX: 15, maxY: 23 },
    'beehive:0': { fw: 16, fh: 16, minX: 2, minY: 3, maxX: 14, maxY: 14 },
    'barrel:0': { fw: 24, fh: 24, minX: 3, minY: 1, maxX: 20, maxY: 23 },
    'clay_pot:0': { fw: 24, fh: 24, minX: 1, minY: 1, maxX: 22, maxY: 23 },
    'clay_pot_smashed:0': { fw: 24, fh: 24, minX: 1, minY: 4, maxX: 23, maxY: 19 },
    'bike_rack:0': { fw: 16, fh: 16, minX: 0, minY: 0, maxX: 15, maxY: 16 },
    'signpost:0': { fw: 16, fh: 16, minX: 0, minY: 1, maxX: 16, maxY: 16 },
    'gatepost:0': { fw: 16, fh: 16, minX: 0, minY: 1, maxX: 16, maxY: 16 },
  };

  // Scales the 14px-wide gold chest to a ~22px visible footprint.
  const CHEST_SCALE = 1.6;

  // Cosmetic only: each POI keeps its appearance across reloads and save overlays.
  const GROVE_SHRINE_ART = [
    { key: 'grove_votive', frame: 0, scale: 4 / 3, name: 'Stone votive' },
  ];
  // One centered shrine object, reserving a 3×3-cell footprint.
  const SHIPWRECK_SHRINE_ART = { key: 'shipwreck_shrine', frame: 0, extentCells: 3,
    scale: CELL_PX * 3 / 192, name: 'Shipwreck' };
  // The ten shrine kinds (src/shrines.js — a row's `frame` picks its art on
  // this one sheet). The frames are listed for the sprite audit, which loads
  // this file without Shrines; shrines.test.js pins every row's frame here.
  const SHRINE_KIND_ART = { key: 'shrines', scale: 1.6, frames: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] };
  function groveShrineArt(o) {
    if (o?.shrineKind === 'drill') return { key: 'cave_props', frame: 6, scale: 4 / 3, name: 'Drill construct' };
    if (o?._shrineArt === 'shipwreck') return SHIPWRECK_SHRINE_ART;
    const kind = o?.shrineKind && root.Shrines && root.Shrines.SHRINE_KINDS[o.shrineKind];
    if (kind) return { key: SHRINE_KIND_ART.key, frame: kind.frame, scale: SHRINE_KIND_ART.scale, name: kind.name };
    return GROVE_SHRINE_ART[root.fnv1a(String(o?.id ?? '') + '#shrine') % GROVE_SHRINE_ART.length];
  }

  // ── Plain rock: what the art SHOWS is what it DROPS ───────────────────────
  // The four "plain rock" looks (row 15, cols 3..6 of the mineralrock sheet)
  // are NOT interchangeable: col 3 draws a PAIR of stones — a small one
  // overlapping a larger one — and cols 4..6 draw a single stone.
  //
  // `stones` is the art's promise of quantity: render.js picks the frame from
  // `col` and interactables.js rolls the yield off `stones`, so the rock you
  // see and the count you get can't drift apart.
  //
  // NOTE the pair is a SINGLE connected blob, so no pixel pass can count it —
  // `stones` is authored, not measured. The tripwire if the sheet is re-cut is
  // the ART_BOUNDS drift check in tools/sprite_audit.js (it pins
  // 'mineralrock:168' at 15px wide against the singles' 9-13).
  const PLAIN_ROCK_VARIANTS = [
    { col: 3, stones: 2 },   // a pair — small stone overlapping a larger one
    { col: 4, stones: 1 },   // single, small
    { col: 5, stones: 1 },   // single, small
    { col: 6, stones: 1 },   // single, chunkier
  ];
  // Row 15 of the sheet (11 cols) holds the small rock variants; the other rows
  // are boulder-sized art that bleeds past the 16×16 frame at render scale.
  const PLAIN_ROCK_ROW = 15, MINERALROCK_COLS = 11;
  // The one look every churchyard rock wears (src/zones.js): the chunky
  // single stone — one stone drawn, one stone paid.
  const CHURCHYARD_ROCK_VARIANT = 3;

  // Which variant a given plain rock wears. Stable per rock: a cave rock keys
  // off its caveVariant, a surface rock off a hash of its ID (util.js fnv1a,
  // salted '#rock' so it never moves in step with the other id-keyed looks).
  // The id is the rock's tile + tile-grid cell, so every player sees — and
  // mines — the same variant (metres are in each save's own frame, so never
  // key off them). BOTH callers go through here — the frame in render.js and
  // the yield in interactables.js.
  // An explicit `rockVariant` (an index into the table) wins over both: a
  // generator that wants ONE look for a whole place — the churchyard's rocks
  // (src/zones.js, CHURCHYARD_ROCK_VARIANT) — says so on the rock, and the
  // frame and the drop both follow it through here.
  function plainRockVariant(o) {
    const n = PLAIN_ROCK_VARIANTS.length;
    if (o && o.rockVariant != null) return PLAIN_ROCK_VARIANTS[((o.rockVariant % n) + n) % n];
    const v = (o && o.caveVariant != null)
      ? (((o.caveVariant % n) + n) % n)
      : (root.fnv1a(String((o && o.id) ?? '') + '#rock') % n);
    return PLAIN_ROCK_VARIANTS[v];
  }
  // Sheet frame index for a plain rock — what render.js draws.
  function plainRockFrame(o) {
    return PLAIN_ROCK_ROW * MINERALROCK_COLS + plainRockVariant(o).col;
  }
  // How many stones the art shows — what interactables.js pays out.
  function plainRockStones(o) { return plainRockVariant(o).stones; }

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
  // A BEARING fruit tree wears the fruit as its own little sprite on the
  // canopy (render.js's fruit pass), so a pick takes the fruit away without
  // changing the tree. The overlay must sit on the LEAFY MASS, not the art's
  // full bounds (whose midline lands on bare bark): CROWN_BOUNDS is the canopy
  // box of the mature frame each species renders.
  // GENERATED — `node tools/sprite_audit.js --emit-bounds` prints it beneath
  // ART_BOUNDS; the audit re-derives it from the real PNGs (canopy = down to
  // the first row past the widest whose span drops under half that width) and
  // fails if this table has drifted from the art.
  const CROWN_BOUNDS = {
    'apple_tree:4': { fw: 32, fh: 48, minX: 0, minY: 1, maxX: 32, maxY: 34 },
    'worldpeach_tree:3': { fw: 32, fh: 48, minX: 0, minY: 2, maxX: 32, maxY: 35 },
  };

  // Offset in screen px from a fruit tree sprite's ANCHOR (its x/y — wherever
  // the seat pass put it) to the centre of its crown, which is where the fruit
  // goes. Derived from the art and the origin / scale it drew at, so a
  // re-seated or re-scaled tree carries its fruit with it. Returns null for a
  // frame with no crown box (a sprout or young tree can't be bearing).
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
  //           butterflies and bats hover. NOT the idle hop (animated in
  //           render.js); the wheel ignores the bob so it doesn't jitter.
  //   minY/maxY  trimmed opaque rows of the REFERENCE frame (frame 0, the rest
  //           pose — sibling frames agree to within a pixel), max EXCLUSIVE.
  //   sheet   the assets.js texture key the kind is DRAWN FROM (every row has
  //           one), and `frames` the length of its row-0 cycle where the
  //           renderer animates it. Two kinds may name the SAME sheet (the
  //           cave slime is the surface slime's art); `tint` is then the only
  //           thing that tells them apart.
  //   tint    the multiply colour the sprite is drawn in — absent means the
  //           art's own colours (0xffffff). See the cave slime's row.
  //
  // render.js reads sheet/frames/scale/foot/float/tint from here so the drawn
  // sprite and the wheel can't drift apart, and `node tools/sprite_audit.js`
  // re-decodes the real PNGs (resolving `sheet` through assets.js) to check
  // minY/maxY hasn't drifted from the art.

  // THE CAVE SLIME'S TINT. The cave slime has no art of its own (the surface
  // slime's sheet), and the lair KIND LADDER (src/lairs.js: surface slime near,
  // cave slime a third out, purple slime two thirds) would otherwise escalate
  // INVISIBLY. A tint is what the game already uses to say "a different thing"
  // (the elite's SHINY_TINT, the frozen ICE).
  //   The VALUE is constrained. A Phaser tint MULTIPLIES, and the sheet's body
  // is #7ec433 — lime with almost no blue — so no tint can make it cold or
  // pale and the only free axis is hue. It goes to OLIVE (#7e7e30), not
  // darker: the lightmap multiplies too, so a merely darker slime reads as
  // one STANDING IN SHADOW. Same luminance, different hue is the one change a
  // player can read at noon and underground alike.
  const CAVE_SLIME_TINT = 0xffa4f0;
  // THE TRAPPER'S TINT — the goblin sheet drawn RED, for the cave slime's
  // reasons: no art of its own, third rung of the garrison ladder (lairs.js),
  // must not read as the melee goblin. The goblin's body is #4ca32b, so strip
  // green and blue and let the red carry — a rust-red goblin.
  const TRAPPER_TINT = 0xff4a3a;
  // THE FIRE SLIME (a burned row's foe — StreetVariants, lairs.js 'burned') —
  // the surface slime's sheet taken to RUST-ORANGE by the cave slime's
  // reasoning: strip green toward half and blue to nothing for an ember-brown
  // slime, distinct from the lime surface and olive cave ones.
  const FIRE_SLIME_TINT = 0xff5a28;
  // The ghost keeps its translucent body and cold halo with its own artwork.
  // GHOST_TINT colours only the halo; the supplied body needs no tint.
  const GHOST_TINT = 0xc8d8ff;
  const GHOST_ALPHA = 0.6;
  // The SPIRIT RAVEN (the Scroll of the Raven's ally) is the crow drawn at half
  // opacity — see its CREATURE_ART row. Its own constant: a retune of the foe
  // ghost must not quietly retune your ally.
  const SPIRIT_RAVEN_ALPHA = 0.5;
  // Its GLOW: a faint cold halo drawn ABOVE the lightmap (render.js,
  // ghostGlowContainer), so a ghost can be seen coming across the dark. It is
  // NOT a light (no Lighting.KINDS row; brightnessAt never sees it). `px` is
  // its diameter, `alpha` its peak; the colour is GHOST_TINT's, baked into the
  // 'ghost_glow' texture (app.js create()).
  const GHOST_GLOW = { px: 34, alpha: 0.5 };

  // ── WHAT THE RENDERER DOES WITH THE SHEET ─────────────────────────────────
  // Beside the geometry (sheet / frame size / scale / foot / float / trimmed
  // rows) each row says how its art MOVES (not a branch in render.js):
  //   anim      a Phaser animation key (app.js create() defines them). The
  //             sheet is set and the anim played; the renderer steps no frames.
  //   frameMs   ms per frame when the renderer steps the row-0 cycle itself,
  //             over `frames` (which is therefore a COUNT OF REAL ART, listed
  //             per row — see the frame-index rule in CLAUDE.md).
  //   hop       a code-drawn continuous bounce, phase-offset per creature off
  //             its id (HOP_MS / HOP_PX, creatureHop), e.g. a ghost bob.
  //   hopRow    the sheet DRAWS a hop in this row (`cols` frames a row):
  //             played on a beat while the creature is moving (hopFrameMs a
  //             frame, then hopRestMs on idle frame 0), the idle row-0 cycle
  //             while it sits (creatureHopRow). The slimes.
  //   airborne  it flies: its contact shadow reads smaller and fainter.
  // A row with neither `anim` nor `frameMs` is drawn at rest, on frame 0.
  //
  // Two beats are shared: CREATURE_FRAME_MS is what every stepped kind runs at
  // unless it says otherwise, and SLIME_FRAME_MS is HALF that rate (the ooze
  // reads as a slow swell, not a flutter — the surface slime covers ground at
  // its row's pace, enemy_roster.js `slime`). Derived from the common beat, and
  // BOTH rows on the slime sheet read it.
  const CREATURE_FRAME_MS = 160;
  const SLIME_FRAME_MS = CREATURE_FRAME_MS * 2;
  // Default code-bounce beat; art rows can override its height and duration.
  const HOP_MS = 600, HOP_PX = 6;
  // The slime sheets DRAW their hop: rows in threes (idle 0-2, HOP 3-5, move
  // 6-8, splat 9-11), and row 3 rises ~6px over frames 1-2 and lands squashed
  // on frame 3. A slime oozes on row 0 while it sits and plays row 3 across
  // each step (`hopRow`, creatureHopRow; render.js times it to the step), not
  // the code bounce on top of the idle ooze.
  const SLIME_HOP_ROW = 3;
  // A slime's step is a long glide (app.js: 5 s / its speed), so one hop can't
  // span it: while it moves it hops on a beat — the row's frames at
  // SLIME_HOP_FRAME_MS each, then SLIME_HOP_REST_MS on idle frame 0.
  const SLIME_HOP_FRAME_MS = 150;
  const SLIME_HOP_REST_MS = 600;
  // Ordinary citizen sheets share six real frames in each directional row:
  // front, back, left, right. Dialog portraits use the same front-facing art.
  const NPC_FRAME = { width: 48, height: 48, cols: 6, frames: [0, 1, 2, 3, 4, 5], portraitFrame: 0 };
  const NPC_SHEETS = [
    { idle: 'npc_0_idle', walk: 'npc_0_walk', path: 'assets/NPC/Citizen_woman01_idle.png' },
    { idle: 'npc_1_idle', walk: 'npc_1_walk', path: 'assets/NPC/Citizen_woman02_idle.png' },
    { idle: 'npc_2_idle', walk: 'npc_2_walk', path: 'assets/NPC/Citizen_woman03_idle.png' },
    // The named trailer neighbours keep the citizen art, one sheet each and
    // untinted, so each is recognisable; Tilly is the believer's sheet at
    // CHILD_SCALE (NPC.STORY_ROLES artScale).
    { role: 'warden', idle: 'npc_2_idle', walk: 'npc_2_walk', path: 'assets/NPC/Citizen_woman03_idle.png', tint: 0xffffff },
    { role: 'witness', idle: 'npc_1_idle', walk: 'npc_1_walk', path: 'assets/NPC/Citizen_woman02_idle.png', tint: 0xffffff },
    { role: 'believer', idle: 'npc_0_idle', walk: 'npc_0_walk', path: 'assets/NPC/Citizen_woman01_idle.png', tint: 0xffffff },
    { role: 'wanderer', idle: 'npc_0_idle', walk: 'npc_0_walk', path: 'assets/NPC/Citizen_woman01_idle.png', tint: 0xffffff },
    // Ayo in human form (the stranger): white hair, slate cloth, baked by
    // tools/art/import_ayo_human.py from the citizen sheet.
    { role: 'stranger', idle: 'npc_ayo_human_idle', walk: 'npc_ayo_human_walk', path: 'assets/NPC/Ayo_human_idle.png', tint: 0xffffff },
    { role: 'archaeologist', idle: 'orrin_idle', walk: 'orrin_walk', path: 'assets/NPC/Orrin_old_man_idle.png', cols: 4, frames: [0, 1, 2, 3], tint: 0xffffff, portraitY: 90 },
    // Every neighbour role has its own look: one sheet per label, so a role
    // shown in several cultures (Peddler, Lamplighter) looks the same in each.
    // tools/art/import_npc_art.py seats them in 4x4 cells of 48px and bakes
    // the citizen palette into them; assets.js preloads them from here.
    // `portraitY` lowers the smaller heads in the dialog portrait, as Orrin's.
    ...[
      ['scout', ['village'], 'wayfinder', 90], ['scout', ['farm'], 'fieldwalker', 90], ['scout', ['market'], 'town_guide', 99],
      ['scout', ['woodland'], 'ranger', 90], ['scout', ['shrine'], 'shrine_warden', 90], ['scout', ['grove'], 'fox_tracker', 90],
      ['merchant', ['village', 'market'], 'peddler', 90], ['merchant', ['farm'], 'seed_seller', 99],
      ['trader', ['village'], 'barterer', 90], ['trader', ['farm'], 'harvest_trader', 99], ['trader', ['market'], 'market_trader', 99],
      ['trader', ['woodland'], 'forager', 99], ['trader', ['shrine'], 'shrine_trader', 99], ['trader', ['grove'], 'fox_trader', 90],
      ['scholar', ['village'], 'storykeeper', 99], ['scholar', ['woodland'], 'lorekeeper', 99], ['scholar', ['shrine'], 'shrine_lorekeeper', 99],
      ['scholar', ['grove'], 'fox_storyteller', 90],
      ['mason', ['village'], 'mason', 90], ['mason', ['farm'], 'barn_raiser', 99], ['mason', ['market'], 'stonemason', 99],
      ['lamplighter', ['village', 'market'], 'lamplighter', 99],
      ['keeper', ['shrine'], 'shrine_keeper', 99], ['keeper', ['grove'], 'den_keeper', 90],
    ].map(([role, cultures, slug, portraitY]) => ({ role, cultures, idle: `npc_${slug}_idle`, walk: `npc_${slug}_walk`,
      path: `assets/NPC/${slug}_idle.png`, cols: 4, frames: [0, 1, 2, 3], tint: 0xffffff, portraitY })),
  ];
  function npcSheet(c) {
    return NPC_SHEETS.find(sheet => sheet.role && sheet.role === c.role && (!sheet.cultures || sheet.cultures.includes(c.culture)))
      || NPC_SHEETS[c.npcVariant] || NPC_SHEETS[0];
  }
  function npcAppearance(c, now) {
    const sheets = npcSheet(c);
    const frames = sheets.frames || NPC_FRAME.frames;
    const dx = (c._targetX ?? c.x) - (c._startX ?? c.x);
    const dy = (c._targetY ?? c.y) - (c._startY ?? c.y);
    const moving = !!c._moving && (dx !== 0 || dy !== 0);
    // World Y and the projection both increase south.
    const row = dx || dy ? (Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 2 : 3) : (dy < 0 ? 1 : 0)) : 0;
    const beat = moving ? 260 : 550;
    return {
      sheet: moving ? sheets.walk : sheets.idle,
      frame: row * (sheets.cols || NPC_FRAME.cols) + frames[Math.floor(now / beat) % frames.length],
      tint: sheets.tint ?? c.tint ?? 0xffffff,
    };
  }
  const CREATURE_ART = {
    npc:           { sheet: 'npc_0_idle', frames: 6, fw: 48, fh: 48, scale: 0.98, foot: 32 / 48, float: 0, minY: 12, maxY: 32 },
    chicken:       { sheet: 'chicken',   anim: 'chicken-idle', fw: 16, fh: 16, scale: 1.20, foot: 16 / 16, float: 0,  minY: 0,  maxY: 16 },
    cow:           { sheet: 'cow',       anim: 'cow-idle',     fw: 32, fh: 32, scale: 1.30, foot: 32 / 32, float: 0,  minY: 13, maxY: 32 },
    cat:           { sheet: 'cat',       anim: 'cat-idle',     fw: 32, fh: 32, scale: 1.30, foot: 29 / 32, float: 0,  minY: 18, maxY: 29 },
    dog:           { sheet: 'dog',       anim: 'dog-idle',     fw: 32, fh: 32, scale: 1.30, foot: 29 / 32, float: 0,  minY: 15, maxY: 29 },
    deer:          { sheet: 'deer',      fw: 32, fh: 32, scale: 1.30, foot: 31 / 32, float: 0,  minY: 11, maxY: 31 },
    rabbit:        { sheet: 'rabbit',    fw: 16, fh: 16, scale: 1.50, foot: 16 / 16, float: 0,  minY: 3,  maxY: 16 },
    // The shiny egg's peaceful hatchling shares the dragon poses, with its
    // own green palette. Baby growth supplies the instance's half scale.
    green_dragon:  { sheet: 'green_dragon', frameMs: 180, fw: 32, fh: 32, scale: 1.0, foot: 28 / 32, float: 0, minY: 2, maxY: 28,
                     directions: {
                       down: { idle: [0], move: [1, 2, 3] },
                       up: { idle: [4], move: [5, 6, 7] },
                       left: { idle: [8], move: [9, 10, 11] },
                       right: { idle: [12], move: [13, 14, 15] } } },
    // The shore crab: 'Crab.png' is 3 cols x 4 rows of 16px frames (front,
    // back, right, left); the front row's three frames are its scuttle cycle,
    // stepped at the common creature beat.
    crab:          { sheet: 'crab',      frames: 3, frameMs: CREATURE_FRAME_MS, fw: 16, fh: 16, scale: 1.20, foot: 15 / 16, float: 0,  minY: 1,  maxY: 15 },
    // Horse and sea turtle carry directional rows, so they face where they
    // walk (wanderCreatures stamps the facing for any kind with `directions`).
    // The horse authors its right side; the turtle its left.
    horse:         { sheet: 'horse',     frameMs: 200, fw: 32, fh: 32, scale: 1.30, foot: 25 / 32, float: 0,  minY: 9,  maxY: 25,
                     directionSideFacing: 'right', directions: {
                       down: { idle: [0, 1, 2, 3], move: [4, 5, 6, 7] },
                       side: { idle: [8, 9, 10, 11], move: [12, 13, 14, 15] },
                       up:   { idle: [16, 17, 18, 19], move: [20, 21, 22, 23] } } },
    sea_turtle:        { sheet: 'sea_turtle',    frameMs: CREATURE_FRAME_MS, fw: 16, fh: 16, scale: 1.30, foot: 14 / 16, float: 0,  minY: 1,  maxY: 14,
                     directionSideFacing: 'left', directions: {
                       down: { idle: [6], move: [6, 7] },
                       side: { idle: [2], move: [2, 3] },
                       up:   { idle: [0], move: [0, 1] } } },
    crow:          { sheet: 'crow',      airborne: true, fw: 32, fh: 32, scale: 1.30, foot: 31 / 32, float: 13, minY: 18, maxY: 31 },
    // The spirit raven is the CROW'S SHEET: every geometry column matches the
    // crow row (wheel / tap / health-bar seating read these); only the alpha
    // differs (SPIRIT_RAVEN_ALPHA).
    spirit_raven:  { sheet: 'crow',      airborne: true, fw: 32, fh: 32, scale: 1.30, foot: 31 / 32, float: 13, minY: 18, maxY: 31, alpha: SPIRIT_RAVEN_ALPHA },
    // The gull is the CROW'S SHEET recoloured (its roster row's `palette`,
    // baked into the 'gull' texture at load — assets.js); same geometry. It
    // steals FOOD (the roster row's `steals`).
    gull:          { sheet: 'gull',      airborne: true, fw: 32, fh: 32, scale: 1.30, foot: 31 / 32, float: 13, minY: 18, maxY: 31 },
    // The STORM GULL (a wreck's gull swarm — lairs.js GROUPS) is the crow sheet
    // under its own grey ramp (roster `palette`, baked into 'storm_gull'). A
    // hostile kind (combat.js MONSTERS); the row exists so the 32px roster
    // branch below keeps the crow's seating rather than the 16px default.
    storm_gull:    { sheet: 'storm_gull', airborne: true, fw: 32, fh: 32, scale: 1.30, foot: 31 / 32, float: 13, minY: 18, maxY: 31 },
    // The raven, the coin thief: the crow's sheet under an inky blue-violet ramp.
    raven:         { sheet: 'raven',     airborne: true, fw: 32, fh: 32, scale: 1.30, foot: 31 / 32, float: 13, minY: 18, maxY: 31 },
    // The butterfly's 7 frames are the sheet's whole top row, stepped faster
    // than the common creature beat — a flutter, not a plod.
    butterfly:     { sheet: 'butterfly', frames: 7, frameMs: 100, airborne: true, fw: 16, fh: 16, scale: 2.00, foot: 12 / 16, float: 15, minY: 6,  maxY: 12 },
    slime:         { sheet: 'slime',     frames: 4, frameMs: SLIME_FRAME_MS, hopRow: SLIME_HOP_ROW, hopFrameMs: SLIME_HOP_FRAME_MS, hopRestMs: SLIME_HOP_REST_MS, cols: 4, fw: 32, fh: 32, scale: 1.20, foot: 21 / 32, float: 0,  minY: 10, maxY: 21 },
    // Underground monsters. The cave slime is the SURFACE SLIME'S SHEET — same
    // file, same frames, same trimmed rows — so everything the art decides has
    // to match the row above it, and the one thing that may differ is the
    // tint: one body cannot have two ground lines.
    cave_slime:    { sheet: 'slime',     frames: 4, frameMs: SLIME_FRAME_MS, hopRow: SLIME_HOP_ROW, hopFrameMs: SLIME_HOP_FRAME_MS, hopRestMs: SLIME_HOP_REST_MS, cols: 4, fw: 32, fh: 32, scale: 1.25, foot: 21 / 32, float: 0,  minY: 10, maxY: 21, tint: CAVE_SLIME_TINT },
    // The purple slime is a SLIME: it oozes at the slime beat and sits on its
    // own shadow (not a flyer's quick bounce, which read as a bat). Its combat
    // `fly` (combat.js) is a MOVEMENT trait, never a look.
    purple_slime:  { sheet: 'purple_slime',  frames: 4, frameMs: SLIME_FRAME_MS * 2, hopRow: SLIME_HOP_ROW, hopFrameMs: SLIME_HOP_FRAME_MS, hopRestMs: SLIME_HOP_REST_MS, cols: 4, fw: 32, fh: 32, scale: 0.95, foot: 21 / 32, float: 0,  minY: 10, maxY: 21 },
    // The fire slime is the SURFACE SLIME'S SHEET too — every geometry column
    // matches the slime row; the tint is the one thing that differs.
    fire_slime:    { sheet: 'fire_slime',     frames: 4, frameMs: SLIME_FRAME_MS, hopRow: SLIME_HOP_ROW, hopFrameMs: SLIME_HOP_FRAME_MS, hopRestMs: SLIME_HOP_REST_MS, cols: 4, fw: 32, fh: 32, scale: 1.20, foot: 21 / 32, float: 0,  minY: 10, maxY: 21, tint: FIRE_SLIME_TINT },
    // Goblins use their six-frame walk cycle without an added body bounce.
    goblin:        { sheet: 'goblin',        frames: 6, frameMs: CREATURE_FRAME_MS, fw: 32, fh: 32, scale: 1.25, foot: 27 / 32, float: 0,  minY: 9,  maxY: 27 },
    goblin_archer: { sheet: 'goblin_archer', frames: 6, frameMs: CREATURE_FRAME_MS, fw: 32, fh: 32, scale: 1.25, foot: 26 / 32, float: 0,  minY: 6,  maxY: 26 },
    // The trapper is the GOBLIN'S SHEET; only the tint differs (TRAPPER_TINT).
    goblin_trapper: { sheet: 'goblin',       frames: 6, frameMs: CREATURE_FRAME_MS, fw: 32, fh: 32, scale: 1.25, foot: 27 / 32, float: 0,  minY: 9,  maxY: 27, tint: TRAPPER_TINT },
  };
  // New art consists of four 16px idle frames. Bounds measured from frame 0;
  // the audit checks these against the shipped pixels. Old 32px goblins and
  // purple slime retain their existing geometry and animation.
  // Opt-in layouts, verified against the supplied sheets. Their side poses
  // face opposite ways: the 16px families face left, goblins face right.
  // Never infer direction support from image dimensions or frame count.
  const frameRun = (start, count) => Array.from({ length: count }, (_, i) => start + i);
  const CREATURE_DIRECTION_LAYOUTS = {
    enemy48: { directionSideFacing: 'left', directions: {
      down: { idle: frameRun(0, 4), move: frameRun(12, 4), attack: frameRun(24, 4) },
      side: { idle: frameRun(4, 4), move: frameRun(16, 4), attack: frameRun(28, 4) },
      up:   { idle: frameRun(8, 4), move: frameRun(20, 4), attack: frameRun(32, 4) },
    } },
    goblin18: { directionSideFacing: 'right', directions: {
      down: { idle: [0], move: frameRun(0, 6) },
      up:   { idle: [6], move: frameRun(6, 6) },
      side: { idle: [12], move: frameRun(12, 6) },
    } },
  };
  const enemyBounds = { bat: [3, 11],
    vampire_bat: [3, 11], spider: [1, 16], poison_spider: [1, 16],
    ghost: [1, 15], pink_ghost: [1, 15] };
  // Color is a species identity, so catching and releasing keep distinct stacks.
  const BUTTERFLY_VARIANTS = [
    { id: 'amber_butterfly', name: 'Amber Butterfly', zones: ['GRASS'], palette: { shadow: '#594014', mid: '#e6a62d', highlight: '#fff1ae', gamma: 0.65 } },
    { id: 'pink_butterfly', name: 'Rose Butterfly', zones: ['PARK', 'GROVE'], palette: { shadow: '#592344', mid: '#df719f', highlight: '#ffe4ef', gamma: 0.65 } },
    { id: 'azure_butterfly', name: 'Azure Butterfly', zones: ['WETLAND'], palette: null },
    { id: 'violet_butterfly', name: 'Violet Butterfly', zones: ['SCHOOL', 'PLAYGROUND'], palette: { shadow: '#38245e', mid: '#9975dc', highlight: '#eee1ff', gamma: 0.65 } },
  ];
  const butterflyByKind = Object.fromEntries(BUTTERFLY_VARIANTS.map(row => [row.id, row]));
  function butterflyKindForTerrain(terrain, terrainKinds) {
    return BUTTERFLY_VARIANTS.find(row => row.zones.some(zone => terrainKinds[zone] === terrain))?.id || 'azure_butterfly';
  }
  const GIANT_PREFIX = 'giant_';
  const GIANT_ART_SCALE = roster?.GIANT_SCALE ?? 1.6;
  function isGiantKind(kind) { return roster?.get(kind)?.variantType === 'Giant'
    || (typeof kind === 'string' && kind.startsWith(GIANT_PREFIX)); }
  function baseKind(kind) { return butterflyByKind[kind] ? 'butterfly' : roster?.get(kind) ? roster.baseKind(kind)
    : isGiantKind(kind) ? kind.slice(GIANT_PREFIX.length) : kind; }
  // Identical unmodified atlases share one Phaser texture and its frame table.
  // Palette copies stay independent; authored frame numbers and roster paths
  // remain unchanged for DOM icons, tools and directional animation.
  const rosterSheets = new Map();
  if (roster) for (const row of roster.ROWS) {
    if (row.variantOf) continue;
    const old = CREATURE_ART[row.id];
    const fw = row.art.frameWidth, fh = row.art.frameHeight;
    const [minY, maxY] = row.art.bounds || enemyBounds[row.id] || [0, 16];
    const flying = row.permanentBuffs?.includes('flight') === true;
    const ghost = row.movement.pattern === 'ghost_glide';
    CREATURE_ART[row.id] = fw === 32 && old ? { ...old, sheet: row.id === 'goblin_trapper' ? 'goblin' : row.id }
      : { sheet: row.id, frames: 4, frameMs: row.art.frameMs ?? (flying ? 120 : 240),
        // 2× a 16px sheet, trimmed by the row's own `artScale` (the slimes:
        // at the full 2× a pest stood as tall as a goblin).
        fw, fh, scale: 2 * (row.artScale ?? 1), foot: maxY / fh, minY, maxY,
        ...(row.art.attackFrames ? { attackFrames: row.art.attackFrames } : {}),
        // An EIGHT-WAY parts atlas (the serpent's): the frame is the row's
        // column for the creature's heading (creatureAppearance).
        ...(row.art.octantRow != null ? { octantRow: row.art.octantRow, octantFlip: !!row.art.octantFlip } : {}),
        float: flying ? 6 : 0, airborne: flying,
        ...(ghost ? { hop: true, hopMs: 1600, hopPx: 3,
          alpha: GHOST_ALPHA, glow: GHOST_GLOW } : {}) };
    Object.assign(CREATURE_ART[row.id], CREATURE_DIRECTION_LAYOUTS[row.art.directionLayout]);
    if (row.art.directions) Object.assign(CREATURE_ART[row.id], { directions: row.art.directions, directionSideFacing: row.art.directionSideFacing });
    const art = CREATURE_ART[row.id];
    if (!row.palette && art.sheet === row.id) {
      const source = `${row.art.path}:${fw}:${fh}`;
      if (!rosterSheets.has(source)) rosterSheets.set(source, art.sheet);
      art.sheet = rosterSheets.get(source);
    }
    CREATURE_ART[row.id].tint = row.tint ? parseInt(row.tint.slice(1), 16) : (fw === 32 && old?.tint) || 0xffffff;
  }
  CREATURE_ART.summoned_skeleton = { ...CREATURE_ART.skeleton };
  CREATURE_ART.summoned_wraith = { ...CREATURE_ART.ghost };
  CREATURE_ART.pirate_mercenary = { ...CREATURE_ART.pirate_captain };
  // A revealed shrine spirit is a stationary discovery object, not a foe.
  // Preserve the native blue-white sprite and its four-frame idle cycle.
  const SHRINE_SPIRIT_ART = { ...CREATURE_ART.ghost, sheet: 'shrine_spirit' };
  const _giantArt = {};
  function creatureArt(kind) {
    if (CREATURE_ART[kind]) return CREATURE_ART[kind];
    if (_giantArt[kind]) return _giantArt[kind];
    if (butterflyByKind[kind]) return (_giantArt[kind] = { ...CREATURE_ART.butterfly,
      sheet: butterflyByKind[kind].palette ? kind : 'butterfly' });
    const row = roster?.get(kind);
    const base = CREATURE_ART[baseKind(kind)];
    if (!base || (!row?.variantOf && !isGiantKind(kind))) return undefined;
    const scale = row?.variantType === 'Mini' ? roster.MINI_SCALE
      : isGiantKind(kind) ? GIANT_ART_SCALE : 1;
    // A row's own `artScale` trims its body on top of the variant scale (the
    // giant slime's stretched pixels read too coarse at the full 1.6×).
    return (_giantArt[kind] = { ...base, scale: base.scale * scale * (row?.artScale ?? 1),
      sheet: row && (row.palette || row.tint) ? row.id : base.sheet,
      tint: row?.tint ? parseInt(row.tint.slice(1), 16) : base.tint });
  }

  // ── CREATURE BEHAVIOUR ────────────────────────────────────────────────────
  // What a kind DOES, beside CREATURE_ART's what a kind LOOKS LIKE, read
  // through the same baseKind resolution so a giant inherits its base kind's
  // habits as it inherits its art.
  //
  // NOT the enemy registry: whether a kind is HOSTILE is combat.js's MONSTERS
  // table, asked through Combat.isEnemy, and nothing here may answer that. A
  // row says what thinks at all, what bolts from you and how far, what a tame
  // pet hunts, what is GAME (crow + deer — netted, never shot at), what a kill
  // drops, what a farm animal gives, what a scarecrow turns back.
  //
  // Separate from CREATURE_ART because tools/sprite_audit.js re-decodes the
  // PNGs behind every art row, and a dog's prey list can't be measured off a
  // sheet.
  //
  // The GAIT rows spell out wanderCreatures' per-kind pacing:
  //   stepMs     ms one hop's animation takes (default: the loop's STEP_MS)
  //   stepCells  how far that hop carries it, in cells (default 1)
  //   pauseMs    [base, spread] it sits still for between hops (default none)
  //   flee       the same three for a BOLT, plus:
  //     cells    the player inside this many cells spooks it (absent: nothing
  //              about the player's position alone makes this kind bolt)
  //     escapes  the two-minute window a failed net-catch arms (_escapingUntil)
  //              makes it bolt as well — the butterfly, the one kind that
  //              window is ever stamped on
  //     jitter   the spread on the away-from-the-player angle, in radians
  //   tameSettles  the quick gait above is a WILD animal's wariness; a tame
  //              one drops it and joins the base wander. A butterfly flits
  //              either way.
  // A FOE's gait is NOT here: every enemy_roster.js row moves by its own
  // `movement` (creature_ai.js rosterEnemyMove); the loop below only gives
  // each row `wanders` (and `haunts` for a ghost) so the sim thinks for it.
  //
  // Animal production and the Book read the same cooldown.
  const ANIMAL_INTERACTION = Object.freeze({
    produceCooldownMs: 60 * 60 * 1000,
    petBoostMs: 10 * 60 * 1000,
    doubleYieldChance: 0.5,
  });
  const CREATURE_BEHAVIOUR = {
    npc:           { wanders: true },
    // 6 s a step: 20% slower than the shared 5 s wander beat.
    chicken:       { wanders: true, stepMs: 6000, produce: { item: 'egg', shinyItem: 'shiny_egg', verb: 'laid' } },
    // A cow takes twice the netting — through its HP (combat.js FAUNA_HP: a
    // catch's difficulty is current HP × 2, Pets.catchMs).
    cow:           { wanders: true, produce: { item: 'milk', verb: 'milked' } },
    // The shore crab is the chicken's row on the beach: tamed with its
    // favourite (items.js ANIMAL_FOOD.crab) or netted; a fed one gives a SHELL.
    // Seated only on shore sand (scene_creatures.js, biome_profiles.js SHORE_FAUNA).
    crab:          { animal: true, wanders: true, concealment: 'stealthy', produce: { item: 'shell', verb: 'shed' } },
    // The horse is the cow's row without the milk: twice the netting (its HP),
    // tamed with the cow's favourite (items.js ANIMAL_FOOD.horse). In the bag
    // it is a mount (items.js HORSE_RIDE).
    horse:         { wanders: true },
    green_dragon:  { animal: true, wanders: true, follows: true },
    // A PET is a kind that hunts FOR you once tame — not a kind that can be
    // tamed (any animal can, and a sapphire tames a slime). `prey` is the
    // hoisted Set the per-step scan reads, so it allocates nothing.
    cat:           { wanders: true, concealment: 'stealthy', pet: true, follows: true, prey: new Set(['crow']) },
    dog:           { wanders: true, pet: true, prey: new Set(['deer', 'slime']) },
    // BOLT PACES sit under the speed ceiling WITH the shiny factor
    // (creature_ai.js WILD_SPEED_CEILING_MPS / SHINY_SPEED_MUL: 10 / 1.5, so
    // a plain bolt stays under ~6.6 m/s). The deer: 1.2 cells (8.4 m) in
    // 1.3 s ≈ 6.5 m/s, a committed run. A hunted deer RUNS (owner, Oct 2026):
    // the net's wheel races its bolt, and it never turns on the hunter.
    deer:          { wanders: true, game: true, drop: 'meat', raidsCrops: true,
                     avoids: ['scarecrow'], tameSettles: true,
                     flee: { cells: 5, jitter: 0.6, stepMs: 1300, stepCells: 1.2 } },
    // The rabbit: half-cell hops in 0.9 s idling (3.9 m/s) and a bolt of 0.6
    // cells (4.2 m) in 650 ms ≈ 6.5 m/s, quick short hops with a breath between.
    rabbit:        { wanders: true, tameSettles: true,
                     stepMs: 900, stepCells: 0.5, pauseMs: [700, 1300],
                     flee: { cells: 4, jitter: 1.1, stepMs: 650, stepCells: 0.6,
                             pauseMs: [80, 120] } },
    // These birds also have hostile roster movement, but remain wild animals.
    gull:          { animal: true },
    raven:         { animal: true },
    crow:          { wanders: true, game: true, drop: 'crow_feather', raidsCrops: true, avoids: ['scarecrow'] },
    // THE SPIRIT RAVEN — summoned by the Scroll or Tome of the Raven (app.js
    // readRavenScroll / readTomeRaven, kept by _tickSpiritRaven) for
    // SPIRIT_RAVEN_MS. It is a PET's hunt by another reason, not a second
    // hunter: wanderCreatures' pet scan runs for it (`summoned`), asks huntsPrey (creature_ai.js) what it may
    // take — `preysOnFoes`: every Combat.isEnemy foe and every pest deer,
    // where a pet's `prey` is a list of kinds — and its kill pays as the pet's
    // ('pet', Combat.isPlayerKill). It FOLLOWS its summoner while nothing is in
    // range (the cat's `follows` lane, its timer armed for the raven's whole
    // life). Its stepMs is one bite a second (Combat.MELEE_INTERVAL_MS — the
    // pet fight resolves once per step), the slime's own cadence. Its PACE is
    // the stride, not the beat: 0.7 of a cell a hop is 4.9 m/s, over every
    // ground foe's chase but the goblins' (5.8 m/s; a goblin pursues, so it comes
    // to the raven) and no blur beside a walking player. Slow it by the
    // stride; the beat is the bite. It is NOT an
    // enemy (no MONSTERS row), NOT game, and NOT tappable (interact.js skips a
    // `summoned` kind: there is nothing to catch, tame or pet).
    spirit_raven:  { wanders: true, summoned: true, preysOnFoes: true, follows: true, stepMs: 1000, stepCells: 0.7 },
    summoned_skeleton: { wanders: true, summoned: true, preysOnFoes: true, follows: true,
      get stepMs() { return EnemyRoster.get('skeleton').damageIntervalSeconds * 1000; }, stepCells: 0.7 },
    summoned_wraith: { wanders: true, summoned: true, preysOnFoes: true, follows: true, stepMs: 1000, stepCells: 0.7 },
    mercenary: { wanders: true, summoned: true, preysOnFoes: true, follows: true, meleeWeapon: 'sword', biteMul: 1 / 3,
      get stepMs() { return EnemyRoster.get('goblin').damageIntervalSeconds * 1000; }, stepCells: 0.7 },
    // `maxMps` is the kind's hard top speed, m/s (a butterfly never outpaces
    // 6 m/s) — over its gait, its bolt and the net wheel's flee. A shiny's cap
    // rises by its own SHINY_SPEED_MUL (9 m/s), so the quickening still shows
    // (creatureMaxMps). Its base numbers sit under that cap on their own (7 m
    // in 1.4 s = 5 m/s idling; 1.15 cells, 8 m, in 1.35 s ≈ 6 m/s bolting), so
    // the cap is a stated number, not what paces it.
    butterfly:     { wanders: true, pollinates: true, stepMs: 1400, maxMps: 6,
                     flee: { escapes: true, jitter: 1.2, stepMs: 1350, stepCells: 1.15 } },
    // A fire slime's kill (player or pet) hands over a flint (items.js
    // 'flint_shard') — the tar yard's thematic prize, on top of its bounty
    // coin. (A Tint variant of the slime with a row of its own here: the drop
    // is its.)
    fire_slime:    { wanders: true, drop: 'flint_shard' },
    // A trapper's kill (by the player or their pet — resolveDefeat pays a drop
    // only then) hands over a Magic Trap, on top of the bounty coin; an
    // enemy's drop is ON TOP of the wage, never instead of it.
    goblin_trapper: { wanders: true, drop: 'magic_trap' },
  };
  // The sea turtle is the rabbit's row on the beach (seated by
  // biome_profiles.js SHORE_FAUNA): the same hops, bolt and settling, read
  // from the rabbit's row so the two cannot drift.
  CREATURE_BEHAVIOUR.sea_turtle = CREATURE_BEHAVIOUR.rabbit;
  CREATURE_BEHAVIOUR.pirate_mercenary = CREATURE_BEHAVIOUR.mercenary;
  // Every roster base kind thinks (`wanders`); a ghost moves by its own mover
  // (creature_ai.js ghostTick — hover, then a committed rush at the player,
  // over any terrain; a touch spends it; light burns it): `haunts` is what
  // hands it there instead of the step chain. A variant reads its base row
  // unless it has a row of its own above (the fire slime's drop).
  if (roster) for (const row of roster.ROWS) {
    if (row.variantOf) continue;
    CREATURE_BEHAVIOUR[row.id] = { ...CREATURE_BEHAVIOUR[row.id], wanders: true,
      ...(row.movement.pattern === 'ghost_glide' ? { haunts: true } : {}) };
  }
  function creatureBehaviour(kind) { return CREATURE_BEHAVIOUR[kind] || CREATURE_BEHAVIOUR[baseKind(kind)]; }
  // Does this kind think at all? wanderCreatures culls on it before anything
  // else, so a kind with no row is furniture.
  function creatureWanders(kind) { return !!creatureBehaviour(kind)?.wanders; }
  // Does this kind move by the ghost's mover rather than the step chain?
  function creatureHaunts(kind) { return !!creatureBehaviour(kind)?.haunts; }
  // A tame one of these hunts for its owner (cat, dog) — see `prey`.
  function isPet(kind) { return !!creatureBehaviour(kind)?.pet; }
  // GAME: taken by a tap on the hunt wheel, with the bug net. Deliberately NOT
  // Combat.isEnemy's business — nothing auto-fires at game and no shot may hit
  // it, or hunting stops being a choice (CLAUDE.md).
  function isGame(kind) { return !!creatureBehaviour(kind)?.game; }
  // What a tame pet of this kind hunts, as a Set — null for everything else.
  function creaturePrey(kind) { return creatureBehaviour(kind)?.prey || null; }
  // The one item a kill of this kind drops (resolveDefeat), or null. An enemy
  // pays its bounty whether or not it has a drop (the trapper has both) —
  // the bounty is Combat's question, not this table's.
  function creatureDrop(kind) { return creatureBehaviour(kind)?.drop || null; }
  // What a fed farm animal gives — { item, verb } — or null.
  function creatureProduce(kind) { return creatureBehaviour(kind)?.produce || null; }
  // How much longer than the net's own time this kind takes to catch — 1 for
  // everything but the rows that say otherwise (interact.js catch).
  // Is this kind SUMMONED — a temporary ally conjured by a potion (the spirit
  // raven)? It hunts for the player without being tame, and is never a tap
  // target.
  function isSummoned(kind) { return !!creatureBehaviour(kind)?.summoned; }
  // Does this hunter take every FOE (Combat.isEnemy) and every pest deer,
  // rather than a `prey` list of kinds? creature_ai.js huntsPrey answers it.
  function preysOnFoes(kind) { return !!creatureBehaviour(kind)?.preysOnFoes; }
  // Does a petted or hired follower trail the player while its timer is live?
  function creatureFollows(kind) { return !!creatureBehaviour(kind)?.follows; }
  // Is a target cell within a ward of `what` ('scarecrow') refused to it?
  function creatureAvoids(kind, what) {
    const a = creatureBehaviour(kind)?.avoids;
    return !!a && a.indexOf(what) >= 0;
  }

  // Every creature is drawn this far below its projected cell centre, so its
  // art bottom lands on the centre of its contact shadow (render.js).
  const CREATURE_GROUND_DY = 2;
  // Fallback for a kind with no entry.
  const CREATURE_WHEEL_FALLBACK_DY = -11;
  // The work wheel's ring radius, as app.js strokes it. The dark backing disc
  // is one pixel larger, so the OUTER edge is CREATURE_WHEEL_R + 1 — what the
  // seating below clears and tools/sprite_audit.js measures. One number draws
  // and places the wheel.
  const CREATURE_WHEEL_R = 9;

  // The enemy HEALTH BAR (app.js _drawEnemyHealthBar). Sized to the wheel's
  // diameter but drawn as a BAR floating ABOVE the animal, so health never
  // reads as the work wheel (a ring ON the animal).
  const HEALTH_BAR_W = 18;      // bar width, px — the wheel's stroked diameter
  const HEALTH_BAR_H = 3;       // bar height, px
  const HEALTH_BAR_GAP = 2;     // clear sky between the crown and the bar

  // Vertical origin the renderer should anchor `kind` at (fraction of frame).
  function creatureFoot(kind) {
    const a = creatureArt(kind);
    return a ? a.foot : 0.9;
  }
  // `inst` is the INSTANCE's own size on top of its kind's (creatureInstScale
  // — a softened lair guard is drawn smaller); omitted, 1. Every reader of the
  // art's size below takes it, so the wheel, the health bar and the tap box
  // stay on the drawn body.
  // A kind's hard top speed, m/s (its row's `maxMps`), or Infinity.
  function creatureMaxMps(kind) { return creatureBehaviour(kind)?.maxMps ?? Infinity; }
  function creatureScale(kind, inst = 1) { return (creatureArt(kind)?.scale ?? 1) * inst; }
  // A BABY PET (items.js BABY_KINDS — found in a nest bush or hatched from an
  // egg, then released): a tame creature RAISED by the player (`raised`),
  // born the moment it was set down (`born`, epoch ms, saved on its
  // save.released row). Drawn at half size until it has grown for `growMs`
  // and eaten `feeds` favourite meals: then full size and twice its kind's HP
  // and bite (combat.js raisedMul). Size and power both read isBabyPet.
  const PET_BABY = Object.freeze({ scale: 0.5, growMs: 7 * 24 * 60 * 60 * 1000, feeds: 7 });
  function isBabyPet(c, now = Date.now()) {
    return !!(c && c.raised && Number.isFinite(c.born)) && ((now - c.born) < PET_BABY.growMs || (c.favouriteFeeds || 0) < PET_BABY.feeds);
  }
  // One creature's own size multiplier (its instance art scale), or 1; a baby
  // pet's is halved. Every reader of a creature's drawn size comes through
  // here, so the whole body shrinks together.
  function creatureInstScale(c, now) {
    return (c._artScale ?? c.artScale ?? 1) * (isBabyPet(c, now) ? PET_BABY.scale : 1)
      * (root.Combat?.isElite(c) ? 1.15 : 1)
      * (root.PotionEffects ? root.PotionEffects.scaleMul(c) : 1);
  }
  function creatureFloat(kind) { return creatureArt(kind)?.float ?? 0; }
  // The sheet a kind is drawn from, and how many frames of its row-0 cycle the
  // renderer runs (a giant shares its base kind's, via creatureArt).
  function creatureSheet(kind) { return creatureArt(kind)?.sheet ?? null; }
  function creatureFrames(kind) { return creatureArt(kind)?.frames ?? 1; }
  // HOW the sheet moves: the Phaser anim key to play (null = the renderer
  // steps the cycle itself) and the ms per frame while it does (0 = drawn at
  // rest on frame 0).
  function creatureAnim(kind) { return creatureArt(kind)?.anim ?? null; }
  function creatureFrameMs(kind) { return creatureArt(kind)?.frameMs ?? 0; }
  // A timed attack may select an authored cycle; other creatures keep their
  // existing idle cycle. Both clocks are performance.now() in the sim/render.
  function legacyCreatureFrame(c, now) {
    const hopRow = creatureHopRow(c.kind);
    const tStep = hopRow && c._stepT0 != null ? now - c._stepT0 : -1;
    const stepping = tStep >= 0 && tStep < (c._hopMs || 0)
      && (c._targetX !== c._startX || c._targetY !== c._startY);
    if (stepping) return hopRowFrame(hopRow, tStep + (c._hopSeed ?? 0));
    const art = creatureArt(c.kind);
    const frameMs = art?.frameMs ?? 0;
    const tick = frameMs ? Math.floor(now / frameMs) : 0;
    const attack = now < (c._attackUntil ?? 0) ? art?.attackFrames : null;
    if (attack && c._attackT0 != null && c._attackUntil > c._attackT0) {
      const progress = Math.max(0, (now - c._attackT0) / (c._attackUntil - c._attackT0));
      return attack[Math.min(attack.length - 1, Math.floor(progress * attack.length))];
    }
    return attack ? attack[tick % attack.length] : tick % (art?.frames ?? 1);
  }

  // A stopped creature keeps its last facing. Motion is stamped by the sim
  // only after a displacement succeeds; aiming may turn without walking.
  const CREATURE_MOVE_GRACE_MS = 200;
  // The DRAWN facing turns only once a new one has been WANTED for this long
  // without a break: a foe on a diagonal wants left / down / left frame to
  // frame, and each contradiction restarts the wait, so it keeps its pose
  // instead of flickering. Art only: movement and aim read dx/dy, never the facing.
  const CREATURE_FACE_HOLD_MS = 1000;
  // The facing is kept until the motion is this far (radians) past the
  // diagonal into another quarter.
  const CREATURE_FACE_HYSTERESIS = 0.35;
  const FACE_AXIS = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 };
  function wantedFacing(c, dx, dy) {
    const cur = c._facing;
    if (cur in FACE_AXIS) {
      let off = Math.abs(Math.atan2(dy, dx) - FACE_AXIS[cur]) % (2 * Math.PI);
      if (off > Math.PI) off = 2 * Math.PI - off;
      if (off <= Math.PI / 4 + CREATURE_FACE_HYSTERESIS) return cur;
    }
    return Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'up' : 'down');
  }
  function faceCreature(c, dx, dy, now = performance.now()) {
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.hypot(dx, dy) < 1e-6) return false;
    const facing = wantedFacing(c, dx, dy);
    // The mirror of an art with no side row: a side facing names it; front
    // and back keep the last one unless the motion clearly leans a way.
    const flip = facing === 'left' || facing === 'right' ? facing === 'left'
      : Math.abs(dx) > 0.5 * Math.abs(dy) ? dx < 0 : !!c._faceFlip;
    if (!c._facing) { c._facing = facing; c._faceFlip = flip; return true; }
    if (facing === c._facing && flip === c._faceFlip) { c._facePendingT = null; return true; }
    if (c._facePendingT == null || c._facePending !== facing || c._facePendingFlip !== flip) {
      c._facePending = facing; c._facePendingFlip = flip; c._facePendingT = now;
    } else if (now - c._facePendingT >= CREATURE_FACE_HOLD_MS) {
      c._facing = facing; c._faceFlip = flip; c._facePendingT = null;
    }
    return true;
  }
  function updateCreatureFacing(c, dx, dy, now) {
    if (faceCreature(c, dx, dy, now)) c._moveUntil = now + CREATURE_MOVE_GRACE_MS;
  }
  function creatureAppearance(c, now) {
    const art = creatureArt(c.kind);
    // Columns E, SE, S, SW, W, NW, N, NE off `_heading` (radians, world
    // metres, y to the south); a tail tip is drawn pointing back (octantFlip).
    if (art?.octantRow != null) {
      const o = Math.round((Number.isFinite(c._heading) ? c._heading : 0) / (Math.PI / 4));
      return { frame: art.octantRow * 8 + ((((o + (art.octantFlip ? 4 : 0)) % 8) + 8) % 8), flipX: false };
    }
    const facing = c._facing || 'down';
    const side = facing === 'left' || facing === 'right';
    const explicitSide = side && art?.directions?.[facing];
    const directional = explicitSide || art?.directions?.[side ? 'side' : facing];
    // Missing poses keep the existing animation and horizontal mirroring.
    if (!directional) return { frame: legacyCreatureFrame(c, now), flipX: !!c._faceFlip };
    const attacking = now < (c._attackUntil ?? 0) && directional.attack?.length;
    const moving = now < (c._moveUntil ?? 0);
    const frames = (attacking ? directional.attack : moving ? directional.move : null)
      || directional.idle;
    if (!frames?.length) return { frame: legacyCreatureFrame(c, now), flipX: !!c._faceFlip };
    let index = art.frameMs ? Math.floor(now / art.frameMs) % frames.length : 0;
    if (attacking && c._attackT0 != null && c._attackUntil > c._attackT0) {
      const progress = Math.max(0, (now - c._attackT0) / (c._attackUntil - c._attackT0));
      index = Math.min(frames.length - 1, Math.floor(progress * frames.length));
    }
    return { frame: frames[index], flipX: !explicitSide && side && facing !== art.directionSideFacing };
  }
  function creatureCycleFrame(c, now) { return creatureAppearance(c, now).frame; }

  // The code bounce a hopping kind wears: { ms, px } (null if it doesn't).
  function creatureHop(kind) {
    const a = creatureArt(kind);
    if (!a?.hop) return null;
    return { ms: a.hopMs ?? HOP_MS, px: a.hopPx ?? HOP_PX };
  }
  // The sheet row a kind DRAWS its hop in: { row, cols, frames, frameMs,
  // restMs } (null if its art has none).
  function creatureHopRow(kind) {
    const a = creatureArt(kind);
    if (a?.hopRow == null) return null;
    return { row: a.hopRow, cols: a.cols || a.frames || 1, frames: a.frames || 1,
             frameMs: a.hopFrameMs || 150, restMs: a.hopRestMs || 0 };
  }
  // Which frame a hop-row kind shows `t` ms into a move: the hop row's frames
  // on the beat, then idle frame 0 for the rest.
  function hopRowFrame(hr, t) {
    const hopLen = hr.frames * hr.frameMs;
    const k = Math.max(0, t) % (hopLen + hr.restMs);
    return k < hopLen ? hr.row * hr.cols + Math.floor(k / hr.frameMs) : 0;
  }
  function creatureAirborne(kind) { return !!creatureArt(kind)?.airborne; }
  // The multiply colour a kind is drawn in — white for art that is already its
  // own colour. The ONLY thing separating two kinds that share a sheet (see
  // CAVE_SLIME_TINT); a giant inherits its base kind's.
  function creatureTint(kind) { return creatureArt(kind)?.tint ?? 0xffffff; }
  // How opaque a kind is drawn — 1 for everything but a row that says
  // otherwise (the ghost). Set every frame by the renderer: sprites are pooled.
  function creatureAlpha(kind) { return creatureArt(kind)?.alpha ?? 1; }
  // A kind's non-lighting halo ({ px, alpha }), or null — the ghost's only.
  function creatureGlow(kind) { return creatureArt(kind)?.glow || null; }

  // THE CREATURE WHEEL RULE: the work-progress wheel RESTS ON the animal's
  // CROWN — the top row of its visible art, at rest — so it reads as sitting
  // on the animal rather than straddling its outline. (Centring it on the
  // crown would put a full radius of ring in empty sky, a far bigger fraction
  // of a 12 px butterfly than of a 28 px cow.)
  //
  // The clamp covers small animals: one shorter than the wheel's diameter has
  // nowhere to put a full radius, so the drop is capped at half the art's
  // height and the wheel centres on the animal's midline. A flat offset can do
  // neither.
  //
  // Returns the offset in screen px from the creature's projected cell centre
  // to the wheel centre (negative = up the screen).
  function creatureWheelDy(kind, inst = 1) {
    const a = creatureArt(kind);
    if (!a) return CREATURE_WHEEL_FALLBACK_DY;
    const sc = a.scale * inst;
    const anchorY = CREATURE_GROUND_DY - a.float;      // where the origin lands
    const artTop = anchorY - (a.foot * a.fh - a.minY) * sc;
    const artH = (a.maxY - a.minY) * sc;
    // Outer edge of the wheel — the backing disc, not the stroked ring.
    return artTop + Math.min(CREATURE_WHEEL_R + 1, artH / 2);
  }

  // THE HEALTH BAR RULE: the bar floats a fixed sliver of sky ABOVE the kind's
  // crown like a name-plate, where the work wheel sits ON the body. Derived per
  // kind from CREATURE_ART exactly like creatureWheelDy, never a flat offset.
  //
  // Returns the offset in screen px from the creature's projected cell centre
  // to the bar's TOP edge (negative = up the screen).
  function creatureHealthBarTop(kind, inst = 1) {
    const a = creatureArt(kind);
    if (!a) {
      // No art entry: hang the bar over the fallback wheel's outer edge.
      return CREATURE_WHEEL_FALLBACK_DY - (CREATURE_WHEEL_R + 1)
        - HEALTH_BAR_GAP - HEALTH_BAR_H;
    }
    const anchorY = CREATURE_GROUND_DY - a.float;
    const artTop = anchorY - (a.foot * a.fh - a.minY) * a.scale * inst;
    return artTop - HEALTH_BAR_GAP - HEALTH_BAR_H;
  }

  // THE TAP BOX (interact.js tap-creature): the vertical span of the kind's
  // VISIBLE art, in screen px from its projected point (negative = up), read
  // off the same row the renderer draws from — scale, foot, float and the
  // trimmed minY/maxY, giant-aware via creatureArt — so the tappable body is
  // the drawn body. The top reaches the peak of a hop (the code bounce's
  // HOP_PX, or the ~HOP_PX rise a slime's hop row draws). Returns null for a
  // kind with no art row.
  function creatureTapSpanPx(kind, inst = 1) {
    const a = creatureArt(kind);
    if (!a) return null;
    const anchorY = CREATURE_GROUND_DY - a.float;
    const hopPx = creatureHop(kind)?.px ?? (a.hopRow != null ? HOP_PX : 0);
    return {
      top: anchorY - (a.foot * a.fh - a.minY) * a.scale * inst - hopPx,
      bottom: anchorY + (a.maxY - a.foot * a.fh) * a.scale * inst,
    };
  }

  // Cyan player sheets use authored left AND right poses. Keep frame lists
  // explicit: the Mage's last two columns are blank in its walking rows.
  const playerDirections = (cols, walkCols) => Object.fromEntries(
    ['down', 'up', 'right', 'left'].map((dir, row) => [dir, {
      idle: [row * cols], walk: walkCols.map(col => row * cols + col),
    }]));
  const PLAYER_ART = {
    farmer: { sheet: 'player_farmer', path: 'assets/Character/FarmerCyan.png', fw: 16, fh: 16, scale: 1.5, footDrop: 6, directions: playerDirections(5, [1, 2, 3, 4]) },
    hunter: { sheet: 'player_hunter', path: 'assets/Character/BowmanCyan.png', fw: 16, fh: 16, scale: 1.5, footDrop: 7, directions: playerDirections(5, [1, 2, 3, 4]) },
    runner: { sheet: 'player_runner', path: 'assets/Character/AssasinCyan.png', fw: 16, fh: 16, scale: 1.5, footDrop: 7, directions: playerDirections(5, [1, 2, 3, 4]) },
    enforcer: { sheet: 'player_enforcer', path: 'assets/Character/SwordsmanCyan.png', fw: 16, fh: 16, scale: 1.5, footDrop: 6, directions: playerDirections(5, [1, 2, 3, 4]) },
    enchanter: { sheet: 'player_enchanter', path: 'assets/Character/MageCyan.png', fw: 16, fh: 16, scale: 1.5, footDrop: 6, directions: playerDirections(6, [0, 1, 2, 3]) },
    mounted: { sheet: 'player_mounted', path: 'assets/Character/CyanKnight.png', fw: 32, fh: 32, scale: 1.25, footDrop: 9,
      directions: Object.fromEntries(['down', 'right', 'left', 'up'].map((dir, row) => [dir, {
        idle: [0, 1, 2, 3].map(col => row * 12 + col),
        walk: [4, 5, 6, 7].map(col => row * 12 + col),
      }])) },
  };
  // A hired swordsman uses the existing player sheet and directional frames.
  const mercenaryArt = PLAYER_ART.enforcer;
  CREATURE_ART.mercenary = { sheet: mercenaryArt.sheet, fw: mercenaryArt.fw, fh: mercenaryArt.fh,
    scale: mercenaryArt.scale, foot: 14 / 16, minY: 2, maxY: 14, float: 0,
    frameMs: CREATURE_FRAME_MS,
    directions: Object.fromEntries(Object.entries(mercenaryArt.directions).map(([key, frames]) =>
      [key, { idle: frames.idle, move: frames.walk }])) };
  // Derived from the save's class, bicycle expiry and riding (items.js
  // isRiding — only counts while a horse is in the bag): no second skin flag
  // to leave stuck after an effect ends.
  function playerArt(save, now = Date.now()) {
    if ((save?.bikeUntil ?? 0) > now) return PLAYER_ART.mounted;
    if (typeof isRiding === 'function' && isRiding(save)) return PLAYER_ART.mounted;
    return Object.hasOwn(PLAYER_ART, save?.playerClass) && save.playerClass !== 'mounted'
      ? PLAYER_ART[save.playerClass] : PLAYER_ART.farmer;
  }

  const api = {
    CELL_PX, ART_BOUNDS, seatInCell, PLAYER_ART, playerArt, CHEST_SCALE,
    GROVE_SHRINE_ART, SHIPWRECK_SHRINE_ART, SHRINE_KIND_ART, SHRINE_SPIRIT_ART, groveShrineArt,
    PLAIN_ROCK_VARIANTS, CHURCHYARD_ROCK_VARIANT, plainRockVariant, plainRockFrame, plainRockStones,
    CROWN_BOUNDS, fruitCrownOffset,
    NPC_FRAME, NPC_SHEETS, npcSheet, npcAppearance,
    CREATURE_ART, CREATURE_GROUND_DY, CREATURE_WHEEL_R,
    CREATURE_BEHAVIOUR, ANIMAL_INTERACTION, creatureBehaviour, creatureWanders, creatureHaunts, isPet, isGame,
    creaturePrey, creatureDrop, creatureProduce, creatureFollows, creatureAvoids, isSummoned, preysOnFoes,
    creatureAppearance, faceCreature, CREATURE_FACE_HOLD_MS, CREATURE_MOVE_GRACE_MS, updateCreatureFacing, CREATURE_DIRECTION_LAYOUTS,
    creatureAnim, creatureFrameMs, creatureCycleFrame, creatureHop, creatureHopRow, hopRowFrame, creatureAirborne,
    HOP_MS, HOP_PX, SLIME_HOP_ROW, SLIME_HOP_FRAME_MS, SLIME_HOP_REST_MS,
    HEALTH_BAR_W, HEALTH_BAR_H, HEALTH_BAR_GAP,
    BUTTERFLY_VARIANTS, butterflyKindForTerrain, GIANT_PREFIX, GIANT_ART_SCALE, isGiantKind, baseKind, creatureArt,
    CAVE_SLIME_TINT, TRAPPER_TINT, FIRE_SLIME_TINT, GHOST_TINT, GHOST_ALPHA, GHOST_GLOW, SPIRIT_RAVEN_ALPHA, creatureSheet, creatureFrames, creatureTint, creatureAlpha, creatureGlow,
    creatureFoot, creatureScale, creatureInstScale, PET_BABY, isBabyPet, creatureMaxMps, creatureFloat, creatureWheelDy, creatureHealthBarTop, creatureTapSpanPx,
  };
  root.SpriteLayout = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
