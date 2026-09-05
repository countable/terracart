// Single source of truth for every texture the game loads.
// preload() in app.js walks this object; per-asset post-processing
// (alpha-keying, manual frame registration) lives in onLoad callbacks.
const ASSETS = {
  idle:    { kind: 'spritesheet', path: 'assets/Character/Idle.png',           frameWidth: 32, frameHeight: 32 },
  walk:    { kind: 'spritesheet', path: 'assets/Character/Walk.png',           frameWidth: 32, frameHeight: 32 },
  trees:   { kind: 'spritesheet', path: 'assets/Objects/Maple Tree.png',       frameWidth: 32, frameHeight: 48 },
  house:   {
    kind: 'image', path: 'assets/Objects/House.png',
    // House.png is a tileset (two houses + detail bits). Register a single
    // "front" frame for the right-hand cabin so we only render that.
    onLoad: (scene) => { scene.textures.get('house').add('front', 0, 148, 3, 72, 95); },
  },
  // Chicken Red.png is 64×32: a 4-col × 2-row grid of 16×16 frames (NOT
  // 2× 32×32 like its filename + the cow sheet might suggest). Loading at
  // 32×32 made every "frame" a 2×2 cluster of mini-chickens — so each
  // spawned chicken rendered as four. 16×16 plus a 2× scale in render.js
  // keeps the visual footprint comparable to the cow. Frames {0, 1} on
  // the top row form the idle animation pair.
  chicken: { kind: 'spritesheet', path: 'assets/Farm Animals/Chicken Red.png',        frameWidth: 16, frameHeight: 16 },
  cow:     { kind: 'spritesheet', path: 'assets/Farm Animals/Female Cow Brown.png',   frameWidth: 32, frameHeight: 32 },
  // trunk.png: 32x64, two 32x32 frames stacked. Frame 0 = closed, frame 1 = open (lid up).
  chest:   { kind: 'spritesheet', path: 'assets/Objects/trunk.png',            frameWidth: 32, frameHeight: 32 },
  // Market stall — a "produce stand" POI sprite (80×80 per frame). One frame
  // per product family (awning colour): 0 fruit, 1 veg, 2 meat, 3 fish,
  // 4 coffee/bakery, 5 dairy/egg, 6 flowers. See produceStandFor() in loot.js.
  market_stand: { kind: 'spritesheet', path: 'assets/Objects/market_stand.png?v=1', frameWidth: 80, frameHeight: 80 },
  // Crops sheet: 9 cols x 16 rows of 16x16 cells. Each crop = one row.
  // In-world growth: col 0 (sprout) -> col 4 (harvestable). Inventory: col 7 produce, col 8 seed.
  crops:   {
    kind: 'spritesheet', path: 'assets/Objects/Crops.png', frameWidth: 16, frameHeight: 16,
    // Source PNG has a solid white background — alpha-key near-white pixels to transparent.
    onLoad: (scene) => {
      const tex = scene.textures.get('crops');
      const src = tex.getSourceImage();
      const c = document.createElement('canvas');
      c.width = src.width; c.height = src.height;
      const ctx = c.getContext('2d');
      ctx.drawImage(src, 0, 0);
      const data = ctx.getImageData(0, 0, c.width, c.height);
      for (let i = 0; i < data.data.length; i += 4) {
        if (data.data[i] > 240 && data.data[i+1] > 240 && data.data[i+2] > 240) {
          data.data[i+3] = 0;
        }
      }
      ctx.putImageData(data, 0, 0);
      scene.textures.remove('crops');
      scene.textures.addSpriteSheet('crops', c, { frameWidth: 16, frameHeight: 16 });
    },
  },
  // Spring Crops sheet (224x128, 14x8 of 16x16 frames). Used by crops whose
  // art lives here (e.g. potato) — see CROP_SPRITE override below.
  springcrops: { kind: 'spritesheet', path: 'assets/Objects/Spring Crops.png',  frameWidth: 16, frameHeight: 16 },
  cobble:      { kind: 'spritesheet', path: 'assets/Objects/Road copiar.png',   frameWidth: 16, frameHeight: 16 },
  // Bridge Beach — 128×224 = 8 cols × 14 rows of 16×16 frames. Wooden plank
  // tiles for pier rendering (transportation:pier OSM lines). Rows 0-3 are a
  // big multi-cell bridge structure; rows 4-13 are pairs of standalone 3-cell
  // horizontal bridges. Renderer uses frame 33 (row 4, col 1) — the middle
  // plank of a horizontal bridge with no end-caps — as the standard pier cell.
  pier:        { kind: 'spritesheet', path: 'assets/Objects/Wilderness/Bridge Beach.png', frameWidth: 16, frameHeight: 16 },
  // Wilderness art — all copied out of the gitignored Sprites/ source dump
  // into Objects/Wilderness/ so the tree can build without the raw asset pack.
  // Misc 16x16 prop — single boxed crate from the Singles tileset.
  box:         { kind: 'image', path: 'assets/Objects/Wilderness/Box_Single_16x16.png' },
  // Forest critters. Sheets are 16x16 frames; renderer picks frames as needed.
  // Deer + Crow sheets are 32×32 frames despite living in a "Wilderness"
  // folder that mostly holds 16×16 props. Loading them as 16×16 sliced each
  // body into a 2×2 quadrant grid; render.js only ever showed the bottom-right
  // quadrant (a leg / tail tip) and the body itself sat invisible in the
  // upper cells. 32×32 + a scale ~1.0 matches the cow's visual footprint.
  deer:        { kind: 'spritesheet', path: 'assets/Objects/Wilderness/Deer Idle.png',       frameWidth: 32, frameHeight: 32 },
  rabbit:      { kind: 'spritesheet', path: 'assets/Objects/Wilderness/Rabbit White.png',    frameWidth: 16, frameHeight: 16 },
  crow:        { kind: 'spritesheet', path: 'assets/Objects/Wilderness/Crow.png',            frameWidth: 32, frameHeight: 32 },
  butterfly:   { kind: 'spritesheet', path: 'assets/Objects/Wilderness/Azure Butterfly.png', frameWidth: 16, frameHeight: 16 },
  // Slime — energy-leeching pest. 'Slime Green.png' is a 128×384 sheet of
  // 32×32 frames (4 cols × 12 rows): row 0 (frames 0-3) is the idle squish
  // cycle the renderer loops; lower rows are move/death poses we don't use.
  slime:         { kind: 'spritesheet', path: 'assets/Enemy/Slime Green.png',   frameWidth: 32, frameHeight: 32 },
  // Underground monster sheets. Goblins: 32×32 frames, 6 cols × 3 rows — row 0 (frames 0-5) is the walk cycle.
  purple_slime:  { kind: 'spritesheet', path: 'assets/Enemy/Purple Slime.png',  frameWidth: 32, frameHeight: 32 },
  goblin:        { kind: 'spritesheet', path: 'assets/Enemy/Goblin.png',        frameWidth: 32, frameHeight: 32 },
  goblin_archer: { kind: 'spritesheet', path: 'assets/Enemy/Goblin Archer.png', frameWidth: 32, frameHeight: 32 },
  // Fruit trees — 32x48 frames (2 cells wide x 3 cells tall), same shape as
  // Maple (32 wide). Each tree spans a 32px column; slicing at 16 split every
  // tree in half (the odd 16px frame was just the right half of a tree).
  apple_tree:   { kind: 'spritesheet', path: 'assets/Objects/Wilderness/Apple Tree.png',   frameWidth: 32, frameHeight: 48 },
  peach_tree:   { kind: 'spritesheet', path: 'assets/Objects/Wilderness/Peach Tree.png',   frameWidth: 32, frameHeight: 48 },
  // Wood/forest tree species — the art is a growth-stage strip where each
  // tree is ~1.5 cells TALL (canopy + trunk + root base). The sheets are
  // 96px tall: the top 48px are the standing tree, the bottom 48px hold
  // separate ground decorations (snow piles / extra saplings / the autumn
  // variants). Slicing at 32×32 cut every tree in half — frame 4 showed
  // canopy only, no trunk. Slicing 32×48 captures the WHOLE tree per column
  // (every standing tree's roots end by row 48 on all three sheets — see
  // tools/sprite_audit.js) and NOTHING below it: Pine/Birch 256×96 → 8 frames
  // (cols 0–7, row 0), Mahogany 384×96 → 12 frames. Column index = growth
  // stage; render.js uses col 3 (a full mature green tree on every sheet).
  // These were sliced 32×64 until Sep 2026, and on the birch sheet the tip of
  // the red autumn tree in the lower band rises to row 62 — inside the frame.
  // The trimmed art bounds then ran to the frame's very bottom, so the seat
  // pass took that tip for the trunk base: the birch sat 16px too high in its
  // cell with a sliver of red foliage under its roots.
  pine_tree:     { kind: 'spritesheet', path: 'assets/Objects/Wilderness/Pine Tree.png',     frameWidth: 32, frameHeight: 48 },
  birch_tree:    { kind: 'spritesheet', path: 'assets/Objects/Wilderness/Birch Tree.png',    frameWidth: 32, frameHeight: 48 },
  mahogany_tree: { kind: 'spritesheet', path: 'assets/Objects/Wilderness/Mahogany Tree.png', frameWidth: 32, frameHeight: 48 },
  // Fantasy Mushroom sheet (96x288) — declared as spritesheet so renderer can pick any single 32x32 mushroom.
  mushroom_world: { kind: 'spritesheet', path: 'assets/Objects/Wilderness/Fantasy Mushroom.png', frameWidth: 32, frameHeight: 32 },
  // Mineral-bearing rocks — 176x272 sheet of 16x16 frames.
  mineralrock:    { kind: 'spritesheet', path: 'assets/Objects/Wilderness/stone with minerals.png', frameWidth: 16, frameHeight: 16 },
  // Stone pillar — 16×32 (1 cell wide × 2 tall): a fluted column with cap +
  // stepped base. Originally sliced from a gitignored source sheet, but the
  // slice rect clipped the column's top and left edge ("pole art is cut off"),
  // so the art was redrawn complete and symmetric in the same palette. Used as
  // a purely decorative stand-in for OSM utility poles / posts (power=pole,
  // man_made=mast, barrier=bollard, highway=street_lamp) — no interaction.
  // Authored at 16px-per-cell, so RENDER_SPEC.pole draws it at scale 2.0 to
  // match the game's 32px cell (1 cell wide × ~2 tall — a full-height pole).
  pillar:         { kind: 'image', path: 'assets/Objects/Wilderness/pillar.png?v=2' },
  // Stone well — the in-game stand-in for OSM amenity=fountain points. Tapping
  // it refills the watering can like a water tile (see interact.js 'well'
  // branch).
  //
  // The PNG is 48×32 and holds the roofed well (opaque x2..29) PLUS a
  // hoist arm and bucket jutting off its right side (x30..36, only 6 rows
  // tall). Drawn whole, that arm is a ~6px orange-and-grey nub floating
  // beside the well at game scale, and — because the sprite is seated by its
  // ART bounds — it also dragged the well itself ~4px off the centre of its
  // own cell. Loading the file as a 30px-wide sheet takes frame 0 = the well
  // alone, so what's drawn is the well, centred.
  well:           { kind: 'spritesheet', path: 'assets/Objects/Wilderness/well.png?v=2',
                    frameWidth: 30, frameHeight: 32 },
  // Wizard tower — 320×208 sheet, 4 cols × 2 rows of 80×104.
  // Top row = 4 tower variants (blue-ivy, purple-ivy, blue-clean, purple-clean).
  // Wizard houses (role 'wizard') use frame 3 (fully-restored purple-clean).
  shrine:      { kind: 'spritesheet', path: 'assets/Objects/Houses/wizard.png', frameWidth: 80, frameHeight: 104 },
  // Shell collectible — 48×64 = 3×4 of 16×16 frames (12 distinct shell
  // variants). Spawns as wildplant-style debris on sand cells (and rarely
  // near water polygons). frame index is hashed off the spawn cell.
  shell_sheet: { kind: 'spritesheet', path: 'assets/Icons/Fish/Sea/Creatures/Shell.png', frameWidth: 16, frameHeight: 16 },
  // Scarecrow — 48×48 single-image prop (straw-man on a cross-pole). Pole base
  // anchors at origin (0.5, 1) so it stands on its placement cell; the render
  // spec scales the 48px art down to ~one cell. ?v= busts the SW/browser cache.
  scarecrow:   { kind: 'image', path: 'assets/Objects/Scarecrow_16x16.png?v=1' },
  // ALL props seasons — 352×192 = 22 cols × 12 rows of 16×16 frames.
  // Spring/autumn/winter/aqua grass tufts, ferns, wildflowers, mushrooms,
  // pebbles, logs. Wildplants pick a frame via CROP_SPRITE { sheet: 'props',
  // custom: true, frame: N }. Frame 0 (top-left small grass tuft) replaces
  // the procedural longgrass texture.
  props:       { kind: 'spritesheet', path: 'assets/Objects/Wilderness/Props.png', frameWidth: 16, frameHeight: 16 },
  // Lush round bushes — 144×288 = 3 cols × 9 rows of 48×32 frames. Replaces
  // the old bare-twig Props.png frame as the in-world shrub wildplant art.
  // (The rows are 32px tall, not 48 — slicing at 48 made frame 0 grab one
  // bush PLUS the top half of the bush below it: "1.5 copies" of the sprite.)
  bushes:      { kind: 'spritesheet', path: 'assets/Objects/Wilderness/bushes.png', frameWidth: 48, frameHeight: 32 },
  // Animated campfire — 96×32 = 6 cols × 1 row of 16×32 frames. Lit by burning
  // a coal on bare ground (see interact.js 'light-fire'); the _fire render spec
  // cycles the 6 frames for a flicker. Repels slimes + slowly restores energy.
  bonfire:     { kind: 'spritesheet', path: 'assets/Objects/Wilderness/bonfire.png', frameWidth: 16, frameHeight: 32 },
  // 7_Pickup_Items — 224×160 = 14 cols × 10 rows of 16×16 frames. Veggies,
  // fruits, fish, junk pulls (boot at row 6 col 4), sticks, logs, stars.
  // Currently used for the fishing-junk boot icon.
  pickup:      { kind: 'spritesheet', path: 'assets/Objects/Pickup_Items.png', frameWidth: 16, frameHeight: 16 },
  // Wood logs — 48×16 sheet, 3 frames of 16×16 (brown / grey / amber
  // bark variants with little green sprigs). Sliced out of Sprites/
  // 7_Pickup_Items_16x16.png row 8 cols 0-2 — the bottom row of the
  // OBJECTS section. The previous wood.png (4-frame stack-growth pile
  // from Sprites/unused/Objects/Props/wood.png) had water tinting in it
  // that read poorly on grass. Renderer picks frame = min(2, qty - 1)
  // so the variant cycles with stack size. Inventory icon uses frame 2.
  wood:        {
    kind: 'spritesheet', path: 'assets/Objects/Wilderness/wood.png', frameWidth: 16, frameHeight: 16,
    // wood.png ships with a solid white background (RGB ≈ 248,248,248)
    // that reads as a "white outline" around each log when rendered on
    // the grass terrain. Alpha-key near-white pixels to transparent —
    // same trick crops.png uses.
    onLoad: (scene) => {
      const tex = scene.textures.get('wood');
      const src = tex.getSourceImage();
      const c = document.createElement('canvas');
      c.width = src.width; c.height = src.height;
      const ctx = c.getContext('2d');
      ctx.drawImage(src, 0, 0);
      const data = ctx.getImageData(0, 0, c.width, c.height);
      for (let i = 0; i < data.data.length; i += 4) {
        if (data.data[i] > 240 && data.data[i+1] > 240 && data.data[i+2] > 240) {
          data.data[i+3] = 0;
        }
      }
      ctx.putImageData(data, 0, 0);
      scene.textures.remove('wood');
      scene.textures.addSpriteSheet('wood', c, { frameWidth: 16, frameHeight: 16 });
    },
  },
  // Themed-house sprites (sliced top-left out of NPC house sheets in
  // Sprites/unused/Objects/Exterior/Houses/NPCS houses). Each replaces the
  // generic tinted 'house' for a specific role — see render.js' house key
  // function. Anchored at origin (0.5, 0.9) like the base house.
  house_blacksmith: { kind: 'image', path: 'assets/Objects/Houses/blacksmith.png' },
  house_trader:     { kind: 'image', path: 'assets/Objects/Houses/trader.png' },
  house_market:     { kind: 'image', path: 'assets/Objects/Houses/market.png' },
  house_fort:       { kind: 'image', path: 'assets/Objects/Houses/fort.png' },
  house_trailer:    { kind: 'image', path: 'assets/Objects/Houses/trailer.png' },
  // Wreck: every tier-9 small house starts out as one of these until the
  // player brings the restoration materials. Single sprite shared across
  // all roles — what the wreck WILL become is hidden until restoration.
  // ?v= cache-bust: Wreck.png was re-cropped (trimmed 14px of empty bottom
  // padding so the foot-anchor seats it on the ground instead of floating
  // above its shadow). Bump this when the art changes again — the service
  // worker + browser HTTP cache key on the full URL, so the new query forces
  // a fresh fetch instead of serving the stale image.
  house_wreck:      { kind: 'image', path: 'assets/Objects/Houses/Wreck.png?v=1' },
};

window.ASSETS = ASSETS;
