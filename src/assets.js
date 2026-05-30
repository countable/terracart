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
  // chest.png is 32x32 with one chest per row (centered horizontally, ~16px wide with 8px padding).
  // Frames: 0 = closed, 1 = open.
  chest:   { kind: 'spritesheet', path: 'assets/Objects/chest.png',            frameWidth: 32, frameHeight: 16 },
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
      // Now that the alpha-keyed 'crops' image is available, bake per-crop plaque textures.
      makePlaqueTextures(scene);
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
  slime:       { kind: 'spritesheet', path: 'assets/Enemy/Slime Green.png',                  frameWidth: 32, frameHeight: 32 },
  // Fruit trees — 16x48 frames (1 cell wide x 3 cells tall), same shape as Maple.
  apple_tree:   { kind: 'spritesheet', path: 'assets/Objects/Wilderness/Apple Tree.png',   frameWidth: 16, frameHeight: 48 },
  cherry_tree:  { kind: 'spritesheet', path: 'assets/Objects/Wilderness/Cherry Tree.png',  frameWidth: 16, frameHeight: 48 },
  peach_tree:   { kind: 'spritesheet', path: 'assets/Objects/Wilderness/Peach Tree.png',   frameWidth: 16, frameHeight: 48 },
  banana_tree:  { kind: 'spritesheet', path: 'assets/Objects/Wilderness/Banana Tree.png',  frameWidth: 16, frameHeight: 48 },
  orange_tree:  { kind: 'spritesheet', path: 'assets/Objects/Wilderness/Orange Tree.png',  frameWidth: 16, frameHeight: 48 },
  mango_tree:   { kind: 'spritesheet', path: 'assets/Objects/Wilderness/Mango Tree.png',   frameWidth: 16, frameHeight: 48 },
  coconut_tree: { kind: 'spritesheet', path: 'assets/Objects/Wilderness/Coconut tree.png', frameWidth: 16, frameHeight: 48 },
  apricot_tree: { kind: 'spritesheet', path: 'assets/Objects/Wilderness/Apricot Tree.png', frameWidth: 16, frameHeight: 48 },
  // Wood/forest tree species — the art is a growth-stage strip where each
  // tree is ~1.5–2 cells TALL (canopy + trunk + root base). The sheets are
  // 96px tall: rows 0–1 (top 64px) are the standing tree, row 2 (bottom 32px)
  // holds separate ground decorations (snow piles / extra saplings). Slicing
  // at 32×32 cut every tree in half — frame 4 showed canopy only, no trunk.
  // Slicing 32×64 captures the WHOLE tree per column: Pine/Birch 256×96 → 8
  // frames (cols 0–7), Mahogany 384×96 → 12 frames. Column index = growth
  // stage; render.js uses col 3 (a full mature green tree on every sheet).
  pine_tree:     { kind: 'spritesheet', path: 'assets/Objects/Wilderness/Pine Tree.png',     frameWidth: 32, frameHeight: 64 },
  birch_tree:    { kind: 'spritesheet', path: 'assets/Objects/Wilderness/Birch Tree.png',    frameWidth: 32, frameHeight: 64 },
  mahogany_tree: { kind: 'spritesheet', path: 'assets/Objects/Wilderness/Mahogany Tree.png', frameWidth: 32, frameHeight: 64 },
  // Fantasy Mushroom sheet (96x288) — declared as spritesheet so renderer can pick any single 32x32 mushroom.
  mushroom_world: { kind: 'spritesheet', path: 'assets/Objects/Wilderness/Fantasy Mushroom.png', frameWidth: 32, frameHeight: 32 },
  // Mineral-bearing rocks — 176x272 sheet of 16x16 frames.
  mineralrock:    { kind: 'spritesheet', path: 'assets/Objects/Wilderness/stone with minerals.png', frameWidth: 16, frameHeight: 16 },
  // Stone pillar — 16×32 (1 cell wide × 2 tall) sliced from the gitignored
  // Sprites/unused/Objects/Exterior/Deep Forest/Stone structures.png (col 8,
  // rows 9-10: the SHORT fluted column with cap + stepped base). Used as a
  // purely decorative stand-in for OSM utility poles / posts (power=pole,
  // man_made=mast, barrier=bollard, highway=street_lamp) — no interaction.
  // At scale 1.0 it's exactly one cell (32px) tall, so it foot-anchors inside
  // a single square cell.
  pillar:         { kind: 'image', path: 'assets/Objects/Wilderness/pillar.png' },
  // Stone well — 48×32 single image (Sprites Well_Usable_16x16: a roofed well
  // with bucket). The in-game stand-in for OSM amenity=fountain points. Tapping
  // it refills the watering can like a water tile (see interact.js 'well'
  // branch). Foot-anchored near the base so it stands on its cell.
  well:           { kind: 'image', path: 'assets/Objects/Wilderness/well.png' },
  // Magic Crafting Shrine — 192×128 = 4 cols × 2 rows of 48×64 water-fountain
  // variants. Each shrine level picks a different frame (row-major) so the
  // fountain visibly evolves: L1 → frame 0, L7 → frame 6. Anchored at
  // (0.5, 1.0) so the base sits on the placement cell.
  shrine:      { kind: 'spritesheet', path: 'assets/Objects/Wilderness/Water fountain.png', frameWidth: 48, frameHeight: 64 },
  // Shell collectible — 48×64 = 3×4 of 16×16 frames (12 distinct shell
  // variants). Spawns as wildplant-style debris on sand cells (and rarely
  // near water polygons). frame index is hashed off the spawn cell.
  shell_sheet: { kind: 'spritesheet', path: 'assets/Icons/Fish/Sea/Creatures/Shell.png', frameWidth: 16, frameHeight: 16 },
  // Scarecrow — 32×32 single-image prop (proper straw-man with hat & cross-
  // pole). Pole base anchors at origin (0.5, 1) so it stands on its
  // placement cell.
  scarecrow:   { kind: 'image', path: 'assets/Objects/scarecrow.png' },
  // ALL props seasons — 352×192 = 22 cols × 12 rows of 16×16 frames.
  // Spring/autumn/winter/aqua grass tufts, ferns, wildflowers, mushrooms,
  // pebbles, logs. Wildplants pick a frame via CROP_SPRITE { sheet: 'props',
  // custom: true, frame: N }. Frame 0 (top-left small grass tuft) replaces
  // the procedural longgrass texture.
  props:       { kind: 'spritesheet', path: 'assets/Objects/Wilderness/Props.png', frameWidth: 16, frameHeight: 16 },
  // Terrains autotile sheet — 512×368 = 32 cols × 23 rows of 16×16 frames.
  // Copied out of the gitignored Sprites/1_Terrains_16x16.png dump into tracked
  // Objects/Terrains_16x16.png (same convention as the Wilderness art above).
  // Contains clean 3×3 Wang autotile
  // blocks for several overlays (brown soil, sand, water, wood planks, dirt)
  // sitting on a green-grass base, plus 4 "extras" per overlay (peninsula /
  // strip / isolated) further to the right. The render.js noisePool branch
  // reads WATER_AUTOTILE_FRAME (in textures.js) to pick a frame per cell
  // based on the cardinal-neighbour mask. Only WATER (type 3) uses the sheet
  // today; SAND, FARMLAND, BUILDING_MED are easy follow-ups since every
  // overlay shares the same 3×3 Wang geometry — just different col/row.
  terrains: { kind: 'spritesheet', path: 'assets/Objects/Terrains_16x16.png', frameWidth: 16, frameHeight: 16 },
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
    kind: 'spritesheet', path: 'assets/Objects/wood.png', frameWidth: 16, frameHeight: 16,
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
