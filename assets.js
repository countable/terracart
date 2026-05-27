// Single source of truth for every texture the game loads.
// preload() in app.js walks this object; per-asset post-processing
// (alpha-keying, manual frame registration) lives in onLoad callbacks.
const ASSETS = {
  idle:    { kind: 'spritesheet', path: 'Character/Idle.png',           frameWidth: 32, frameHeight: 32 },
  walk:    { kind: 'spritesheet', path: 'Character/Walk.png',           frameWidth: 32, frameHeight: 32 },
  trees:   { kind: 'spritesheet', path: 'Objects/Maple Tree.png',       frameWidth: 32, frameHeight: 48 },
  house:   {
    kind: 'image', path: 'Objects/House.png',
    // House.png is a tileset (two houses + detail bits). Register a single
    // "front" frame for the right-hand cabin so we only render that.
    onLoad: (scene) => { scene.textures.get('house').add('front', 0, 148, 3, 72, 95); },
  },
  chicken: { kind: 'spritesheet', path: 'Farm Animals/Chicken Red.png',        frameWidth: 32, frameHeight: 32 },
  cow:     { kind: 'spritesheet', path: 'Farm Animals/Female Cow Brown.png',   frameWidth: 32, frameHeight: 32 },
  // chest.png is 32x32 with one chest per row (centered horizontally, ~16px wide with 8px padding).
  // Frames: 0 = closed, 1 = open.
  chest:   { kind: 'spritesheet', path: 'Objects/chest.png',            frameWidth: 32, frameHeight: 16 },
  // Crops sheet: 9 cols x 16 rows of 16x16 cells. Each crop = one row.
  // In-world growth: col 0 (sprout) -> col 4 (harvestable). Inventory: col 7 produce, col 8 seed.
  crops:   {
    kind: 'spritesheet', path: 'Objects/Crops.png', frameWidth: 16, frameHeight: 16,
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
  springcrops: { kind: 'spritesheet', path: 'Objects/Spring Crops.png',  frameWidth: 16, frameHeight: 16 },
  cobble:      { kind: 'spritesheet', path: 'Objects/Road copiar.png',   frameWidth: 16, frameHeight: 16 },
  // Wilderness art — all copied out of the gitignored Sprites/ source dump
  // into Objects/Wilderness/ so the tree can build without the raw asset pack.
  // Misc 16x16 prop — single boxed crate from the Singles tileset.
  box:         { kind: 'image', path: 'Objects/Wilderness/Box_Single_16x16.png' },
  // Forest critters. Sheets are 16x16 frames; renderer picks frames as needed.
  deer:        { kind: 'spritesheet', path: 'Objects/Wilderness/Deer Idle.png',       frameWidth: 16, frameHeight: 16 },
  rabbit:      { kind: 'spritesheet', path: 'Objects/Wilderness/Rabbit Brown.png',    frameWidth: 16, frameHeight: 16 },
  crow:        { kind: 'spritesheet', path: 'Objects/Wilderness/Crow.png',            frameWidth: 16, frameHeight: 16 },
  butterfly:   { kind: 'spritesheet', path: 'Objects/Wilderness/Azure Butterfly.png', frameWidth: 16, frameHeight: 16 },
  // Fruit trees — 16x48 frames (1 cell wide x 3 cells tall), same shape as Maple.
  apple_tree:   { kind: 'spritesheet', path: 'Objects/Wilderness/Apple Tree.png',   frameWidth: 16, frameHeight: 48 },
  cherry_tree:  { kind: 'spritesheet', path: 'Objects/Wilderness/Cherry Tree.png',  frameWidth: 16, frameHeight: 48 },
  peach_tree:   { kind: 'spritesheet', path: 'Objects/Wilderness/Peach Tree.png',   frameWidth: 16, frameHeight: 48 },
  banana_tree:  { kind: 'spritesheet', path: 'Objects/Wilderness/Banana Tree.png',  frameWidth: 16, frameHeight: 48 },
  orange_tree:  { kind: 'spritesheet', path: 'Objects/Wilderness/Orange Tree.png',  frameWidth: 16, frameHeight: 48 },
  mango_tree:   { kind: 'spritesheet', path: 'Objects/Wilderness/Mango Tree.png',   frameWidth: 16, frameHeight: 48 },
  coconut_tree: { kind: 'spritesheet', path: 'Objects/Wilderness/Coconut tree.png', frameWidth: 16, frameHeight: 48 },
  apricot_tree: { kind: 'spritesheet', path: 'Objects/Wilderness/Apricot Tree.png', frameWidth: 16, frameHeight: 48 },
  // Fantasy Mushroom sheet (96x288) — declared as spritesheet so renderer can pick any single 32x32 mushroom.
  mushroom_world: { kind: 'spritesheet', path: 'Objects/Wilderness/Fantasy Mushroom.png', frameWidth: 32, frameHeight: 32 },
  // Mineral-bearing rocks — 176x272 sheet of 16x16 frames.
  mineralrock:    { kind: 'spritesheet', path: 'Objects/Wilderness/stone with minerals.png', frameWidth: 16, frameHeight: 16 },
  // Gem inventory icons — 7×4 sheet of 16×16 frames. Sapphire / ruby /
  // emerald previously rendered as emoji-dot fallbacks (🔵/🔴/🟢) which on
  // most platforms read as plain coloured circles. inventoryIconSource()
  // resolves the named gems to specific frames in this sheet.
  gems:        { kind: 'spritesheet', path: 'Icons/RPG icons/Extras/Gemstones.png', frameWidth: 16, frameHeight: 16 },
  // Coal — 2×2 sheet, frame 0 is the standard piece.
  coal_icon:   { kind: 'spritesheet', path: 'Icons/RPG icons/Extras/Coal.png',      frameWidth: 16, frameHeight: 16 },
  // Bars and ores — 256×64 = 16 cols × 4 rows of 16×16 frames. We treat
  // the first row as bars in tier order (copper, iron, gold, platinum,
  // crimson, frost). Ore frames in the lower rows are skipped — mineralrocks
  // drop bars directly, no smelting step.
  bars:        { kind: 'spritesheet', path: 'Icons/RPG icons/Extras/Bars and ores.png', frameWidth: 16, frameHeight: 16 },
  // Magic Crafting Shrine — 288×144 = 6 cols × 3 rows of 48×48 stone-altar
  // variants. Each shrine level uses a different frame so the altar visibly
  // evolves: L1 → frame 0, L7 → frame 6 (top-row left-to-right). Anchored
  // at (0.5, 1.0) so the base sits on the placement cell.
  shrine:      { kind: 'spritesheet', path: 'Objects/Wilderness/Altar.png', frameWidth: 48, frameHeight: 48 },
  // Shell collectible — 48×64 = 3×4 of 16×16 frames (12 distinct shell
  // variants). Spawns as wildplant-style debris on sand cells (and rarely
  // near water polygons). frame index is hashed off the spawn cell.
  shell_sheet: { kind: 'spritesheet', path: 'Icons/Fish/Sea/Creatures/Shell.png', frameWidth: 16, frameHeight: 16 },
  // Scarecrow — 32×32 single-image prop (proper straw-man with hat & cross-
  // pole). Pole base anchors at origin (0.5, 1) so it stands on its
  // placement cell.
  scarecrow:   { kind: 'image', path: 'Objects/scarcrow.png' },
};

window.ASSETS = ASSETS;
